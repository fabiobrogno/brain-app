// test-umstellung-fixes.mjs — Paket P7b: die Lücken aus Plan Abschnitt 8.3, die hier geschlossen werden.
//  1. install-git-hooks.mjs erkennt die relative Kit-Form (<Kit-Ordner>/git-hooks) als eigenen Eintrag (vorher Exit 4 „fremd“).
//  2. adapters/claude-code/install.mjs erkennt alte Hook-Befehle auch als ~/…, $HOME/… und im aufgelösten Pfad (realpath) des Vaults.
//  3. install.mjs --vorschau rechnet nur im Speicher.
//  4. Pflege/KI fassen .kortex (Gerätemerker) nie an.
// Nur Temp-HOME und Wegwerf-Ordner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { umstellungsFixture } from "./umstellung-hilfe.mjs";
import { baumStand } from "./fixture-altvault.mjs";
import { kernSkript } from "../umstellung/ziele.mjs";
import { ALT_KIT_ORDNER } from "../pfade.mjs";

const INSTALL = join("adapters", "claude-code", "install.mjs");
const settings = (h, p = ".claude") => JSON.parse(readFileSync(join(h.a.home, p, "settings.json"), "utf8"));
const befehle = (s) => Object.values(s.hooks || {}).flat().flatMap((e) => (e.hooks || []).map((x) => x.command));
const gitC = (h, ...a) => h.a.g(...a).trim();

test("hooks-install: die relative Kit-Form wird ohne --ersetzen umgestellt, mit --aus entfernt; ein fremder Wert bleibt (Exit 4)", () => {
  const h = umstellungsFixture(["hookspath-relativ"]);
  try {
    const z = h.z();
    const stand = kernSkript(z, "install-git-hooks.mjs", [z.vault, "--stand"]);
    assert.deepEqual([JSON.parse(stand.stdout).eigener, JSON.parse(stand.stdout).fremder], [true, false], "relative Form gilt als eigene");
    const r = kernSkript(z, "install-git-hooks.mjs", [z.vault]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(gitC(h, "config", "--local", "core.hooksPath"), join(z.kern, "git-hooks"));
    // --aus nimmt auch die relative Form heraus
    h.a.g("config", "core.hooksPath", `${ALT_KIT_ORDNER}/git-hooks`);
    const aus = kernSkript(z, "install-git-hooks.mjs", [z.vault, "--aus"]);
    assert.equal(aus.status, 0, aus.stderr);
    assert.throws(() => h.a.g("config", "--local", "--get", "core.hooksPath"), /./, "Eintrag ist weg");
    // ./-Schreibweise ebenso
    h.a.g("config", "core.hooksPath", `./${ALT_KIT_ORDNER}/git-hooks`);
    assert.equal(kernSkript(z, "install-git-hooks.mjs", [z.vault]).status, 0);
    // fremd bleibt fremd
    h.a.g("config", "core.hooksPath", ".husky/_");
    assert.equal(kernSkript(z, "install-git-hooks.mjs", [z.vault]).status, 4);
    assert.equal(gitC(h, "config", "--local", "core.hooksPath"), ".husky/_");
  } finally { h.weg(); }
});

for (const fall of ["hooks-alt-home", "hooks-alt-tilde"]) {
  test(`install.mjs: alter Hook in der Schreibweise „${fall}“ wird ersetzt, kein Doppel`, () => {
    const h = umstellungsFixture([fall]);
    try {
      const z = h.z();
      assert.ok(befehle(settings(h)).some((c) => c.includes(`${ALT_KIT_ORDNER}/session-start.sh`)), "Ausgangslage: alter Hook steht da");
      const r = kernSkript(z, INSTALL, [z.vault, "--claude-home", join(h.a.home, ".claude")]);
      assert.equal(r.status, 0, r.stderr);
      const cs = befehle(settings(h));
      assert.ok(!cs.some((c) => c.includes(`${ALT_KIT_ORDNER}/session-start.sh`)), "der alte Hook ist weg");
      assert.equal(cs.filter((c) => c.includes("kortex' hook session-start")).length, 1, "genau ein neuer Eintrag");
    } finally { h.weg(); }
  });
}

test("install.mjs: alter Hook mit dem aufgelösten Pfad (realpath) des Vaults wird auch dann erkannt, wenn der Vault über einen Verweis angegeben wird", () => {
  const h = umstellungsFixture(["hooks-alt-sh", "vault-ueber-verweis"]);
  try {
    const z = h.z();
    const verweis = h.a.vaultVerweis;
    assert.notEqual(realpathSync(verweis), verweis);
    // der alte Hook nennt den aufgelösten Pfad (hooks-alt-sh), der Aufruf den Verweis
    const r = kernSkript(z, INSTALL, [verweis, "--claude-home", join(h.a.home, ".claude")]);
    assert.equal(r.status, 0, r.stderr);
    const cs = befehle(settings(h));
    assert.ok(!cs.some((c) => c.includes(`${ALT_KIT_ORDNER}/session-start.sh`)));
    assert.equal(cs.filter((c) => c.includes("kortex' hook session-start")).length, 1);
  } finally { h.weg(); }
});

test("install.mjs --vorschau: rechnet nur im Speicher, schreibt weder settings.json noch Befehle, meldet Einträge und Restverweise (nur Zahlen)", () => {
  const h = umstellungsFixture(["hooks-alt-sh", "statusline-alt", "restverweis-skript", "hooks-fremd"]);
  try {
    const z = h.z();
    const vor = baumStand(h.a.home);
    const r = kernSkript(z, INSTALL, [z.vault, "--vorschau", "--claude-home", join(h.a.home, ".claude")]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(baumStand(h.a.home), vor, "nichts geschrieben (auch kein Backup, keine Befehle)");
    assert.ok(!existsSync(join(h.a.home, ".claude", "commands")));
    const j = JSON.parse(r.stdout.trim().split("\n").pop());
    assert.equal(j.vorschau, true);
    assert.equal(j.geaendert, true);
    assert.ok(j.eintraege.some((e) => e.ereignis === "SessionStart" && e.aktion !== "entfernt"));
    assert.ok(j.eintraege.some((e) => e.ereignis === "statusLine"));
    assert.equal(j.hooks.neueForm, j.hooks.soll, "nach der Umstellung stehen alle Hooks in neuer Form");
    assert.equal(j.restVerweise, 2, "das eigene Skript und die Umgebungsvariable bleiben als Restverweis (gemeldet, nicht geändert)");
    assert.ok(!r.stdout.includes("GEHEIM"), "keine Werte");
    // idempotent: nach dem echten Eintragen meldet die Vorschau keine Änderung
    assert.equal(kernSkript(z, INSTALL, [z.vault, "--claude-home", join(h.a.home, ".claude")]).status, 0);
    const nach = JSON.parse(kernSkript(z, INSTALL, [z.vault, "--vorschau", "--claude-home", join(h.a.home, ".claude")]).stdout.trim().split("\n").pop());
    assert.equal(nach.geaendert, false);
    assert.deepEqual(nach.eintraege, []);
  } finally { h.weg(); }
});

test(".kortex ist für Pflege und KI gesperrt (Arbeitskopie, KI-Rechte, Inbox-Ziele)", async () => {
  const { sperreAusgeschlossenes } = await import("../tageslauf/pflege-sperre.mjs");
  const h = umstellungsFixture([]);
  try {
    mkdirSync(join(h.a.vault, ".kortex", "geraete"), { recursive: true });
    writeFileSync(join(h.a.vault, ".kortex", "geraete", "abc.json"), '{"name":"x"}');
    const sperre = sperreAusgeschlossenes({ vault: h.a.vault, werte: { ernteNichtIn: [h.a.vault] }, konfigLesbar: true }, h.a.vault);
    assert.ok(!sperre.entfernt.some((p) => p.startsWith(".kortex")), ".kortex wird von der Pflege-Sperre nie durchsucht oder entfernt");
    const { zielGueltig } = await import("../tageslauf/inbox-schritt.mjs");
    assert.equal(zielGueltig(".kortex/geraete/neu.md", { vault: h.a.vault, kopie: h.a.vault, cluster: [".kortex"], quelle: "a.md" }), false);
    const quelle = readFileSync(new URL("../tageslauf/pflege-ki.mjs", import.meta.url), "utf8");
    assert.match(quelle, /KOPIE_GESPERRT = \[[^\]]*"\.kortex\/\*\*"/);
  } finally { h.weg(); }
});
