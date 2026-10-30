// test-umstellung-probelauf.mjs — Paket P7b: der Probelauf an einer Kopie (Plan docs/plaene/p7-umstellung.md Abschnitt 2).
// Geprüft wird: alle Kriterien grün an einem Kit-Vault mit vielen Altlasten; das Original bleibt Byte für Byte unberührt (Kriterium 9, hier zusätzlich als Baumvergleich);
// ohne --ja nur ein Plan; der Merker gilt nur für denselben Stand; rote Fälle; Rückfall des Kopierers; nichts verlässt die Kopie (kein launchctl, kein Netz).
// Nur Temp-HOME, Temp-Support, eigene globale git-Konfiguration; launchctl/claude/codex nur als Attrappe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { umstellungsFixture } from "./umstellung-hilfe.mjs";
import { baumStand, GEHEIM } from "./fixture-altvault.mjs";
import { probelauf, kopiereVault } from "../umstellung/probelauf.mjs";
import { phaseA } from "../umstellung/phase-a.mjs";
import { leseProbelaufMerker } from "../umstellung/probelauf-merker.mjs";
import { liesProtokoll } from "../umstellung/protokoll.mjs";

const ALT = ["kit-versioniert", "hookspath-relativ", "credential-helper", "hooks-alt-sh", "mcp-claude-alt", "plist-alt-dieser", "backup-pfad-gueltig", "zwei-profile", "agents-versioniert"];
const status = (r, nr) => r.kriterien.find((c) => c.nr === nr);

test("Probelauf: alle Kriterien grün, Original unberührt, Merker geschrieben, Kopie gelöscht, kein Wert im Protokoll", async () => {
  const h = umstellungsFixture(ALT);
  try {
    const z = h.z();
    const vorher = baumStand(h.a.vault, h.a.home, h.gitGlobal);
    const r = await probelauf(z, { bestaetigt: true });
    assert.equal(r.ok, true, JSON.stringify(r.kriterien));
    for (const nr of [1, 2, 3, 4, 5, 6, 7, 8, 9]) assert.equal(status(r, nr).status, "gruen", `Kriterium ${nr}: ${JSON.stringify(status(r, nr))}`);
    assert.equal(baumStand(h.a.vault, h.a.home, h.gitGlobal), vorher, "Original (Vault, HOME, globale git-Konfiguration) Byte für Byte unverändert");
    assert.equal(h.zeilen(h.log).length, 0, "kein launchctl im Probelauf");
    assert.equal(h.zeilen(h.mcpLog).length, 0, "kein claude/codex im Probelauf");
    const m = leseProbelaufMerker(z);
    assert.equal(m.ergebnis, "gruen");
    assert.ok(m.fingerabdruck && m.entscheidungen);
    assert.equal(r.kopieBehalten, null, "nach Erfolg wird die Kopie gelöscht");
    const prot = JSON.stringify(liesProtokoll(z));
    assert.ok(!prot.includes(GEHEIM) && !prot.includes(h.a.vault), "keine Werte, keine Pfade im Protokoll");
    assert.ok(liesProtokoll(z).some((e) => e.lauf === "probe"));
  } finally { h.weg(); }
});

test("Probelauf ohne --ja: nur der Plan, nichts geschrieben", async () => {
  const h = umstellungsFixture(ALT);
  try {
    const z = h.z();
    const vorher = baumStand(h.a.basis);
    const r = await probelauf(z, {});
    assert.equal(r.plan, true);
    assert.equal(baumStand(h.a.basis), vorher);
    await assert.rejects(phaseA(z, { bestaetigt: true }), /Probelauf/);
    assert.equal(baumStand(h.a.basis), vorher, "Phase A ohne Probelauf schreibt nichts");
  } finally { h.weg(); }
});

test("Merker gilt nur für denselben Stand: eine Änderung an Claude-Einstellungen entwertet ihn", async () => {
  const h = umstellungsFixture(ALT);
  try {
    const z = h.z();
    const erst = await probelauf(z, { bestaetigt: true });
    assert.equal(erst.ok, true, JSON.stringify(erst.kriterien) + JSON.stringify(erst.schritte));
    const s = join(h.a.home, ".claude", "settings.json");
    writeFileSync(s, readFileSync(s, "utf8").replace(/\n$/, "") + "\n\n");
    await assert.rejects(phaseA(z, { bestaetigt: true }), /Seit dem Probelauf/);
  } finally { h.weg(); }
});

test("Rot: gesperrter git-Schlüssel ohne Verschieben → Kriterium 3 rot, kein Merker, Kopie bleibt", async () => {
  const h = umstellungsFixture(["credential-helper"]);
  try {
    const z = h.z();
    const r = await probelauf(z, { bestaetigt: true, entscheidungen: { gitSchluessel: false } });
    assert.equal(r.ok, false);
    assert.equal(status(r, 3).status, "rot");
    assert.equal(status(r, 3).grund, "git-gesperrt");
    assert.equal(leseProbelaufMerker(z), null);
    assert.ok(r.kopieBehalten && existsSync(r.kopieBehalten.kopie), "die Kopie bleibt zur Ansicht");
    assert.equal(status(r, 9).status, "gruen", "auch der rote Probelauf lässt das Original unberührt");
  } finally { h.weg(); }
});

test("Kopierer: Rückfall auf den Nachbarordner und auf die volle Kopie (einspritzbarer Kopierer, EXDEV)", async () => {
  const h = umstellungsFixture(["kit-versioniert"]);
  try {
    const z = h.z();
    const versuche = [];
    const kopierer = (q, ziel, opt) => {
      versuche.push({ ziel, art: opt.art });
      if (versuche.length === 1) { const e = new Error("EXDEV"); e.code = "EXDEV"; throw e; }
      return kopiereVault(q, ziel, { art: "voll" });
    };
    // ohne ausdrückliche Zustimmung gibt es nie eine Kopie neben dem Vault (nur Temp): der zweite Versuch ist die volle Kopie in Temp
    const r0 = await probelauf(z, { bestaetigt: true, kopierer });
    assert.equal(r0.ok, true, JSON.stringify(r0.kriterien));
    assert.equal(versuche.length, 2);
    assert.ok(!versuche[1].ziel.startsWith(dirname(h.a.vault) + "/kortex-probelauf-"), "kein Nachbarordner ohne Zustimmung");
    versuche.length = 0;
    const r = await probelauf(z, { bestaetigt: true, kopierer, entscheidungen: { nachbarkopie: true } });
    assert.equal(r.ok, true, JSON.stringify(r.kriterien));
    assert.equal(versuche.length, 2);
    assert.ok(versuche[1].ziel.startsWith(dirname(h.a.vault) + "/kortex-probelauf-"), "zweiter Versuch im Nachbarordner");
    assert.ok(!readdirSync(dirname(h.a.vault)).some((n) => n.startsWith("kortex-probelauf-")), "der Nachbarordner ist wieder weg");
    const alle = [];
    const k2 = (q, ziel) => { alle.push(ziel); const e = new Error("EXDEV"); e.code = "EXDEV"; if (alle.length < 3) throw e; return kopiereVault(q, ziel, { art: "voll" }); };
    const r2 = await probelauf(z, { bestaetigt: true, kopierer: k2, entscheidungen: { nachbarkopie: true } });
    assert.equal(r2.kopieArt, "voll");
  } finally { h.weg(); }
});

test("Pfad mit Leerzeichen, ' und Umlaut: Probelauf grün", async () => {
  const h = umstellungsFixture(["pfad-sonderzeichen", "kit-versioniert", "credential-helper", "hooks-alt-sh"]);
  try {
    const r = await probelauf(h.z(), { bestaetigt: true });
    assert.equal(r.ok, true, JSON.stringify(r.kriterien));
  } finally { h.weg(); }
});
