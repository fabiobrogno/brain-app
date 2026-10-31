// Aktivitätsprotokoll (P8a): Format, Begrenzung, Rotation, Drossel, Zustand (gelesen/zurückgenommen) — gemeinsam/aktivitaet.mjs.
// Nur Wegwerf-Ordner. Der Kern hat denselben Abschnitt (kern/aktivitaet.mjs): Parität im eigenen Test.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmp, pfad } from "./hilfe.mjs";

const A = await import(pfad("gemeinsam", "aktivitaet.mjs"));
const neu = () => { const support = tmp("akt-support-"), vault = tmp("akt-vault-"); return { support, vault, kennung: A.kennungVault(vault) }; };
const HASH = "a".repeat(64);

test("Ein Ereignis wird als eine JSON-Zeile geschrieben und wieder gelesen (Zeit, Art, Konto, Programm, Vault, Text, Pfade, Rückgängig)", () => {
  const { support, vault, kennung } = neu();
  const e = A.schreibeEreignis(support, vault, { art: "ablage-aufgabe", konto: "k_0123abcd", programm: "claude", quelle: "ki:claude-code", wer: "Claude Code · Privat", vaultName: "Kortex",
    text: "hat eine Aufgabe angelegt.", pfade: ["05_aufgaben/2026-10-31-x.md"], rueckgaengig: { art: "ablage-entfernen", pfad: "05_aufgaben/2026-10-31-x.md", hash: HASH } });
  assert.ok(e && /^a_[0-9a-z]+_[0-9a-f]{6}$/.test(e.id));
  const datei = A.ereignisDatei(support, kennung);
  assert.equal(readFileSync(datei, "utf8").trim().split("\n").length, 1);
  assert.equal((statSync(datei).mode & 0o777), 0o600, "nur für den Nutzer lesbar");
  const [l] = A.leseEreignisse(support, kennung);
  assert.equal(l.v, 1); assert.equal(l.art, "ablage-aufgabe"); assert.equal(l.vault, kennung); assert.equal(l.konto, "k_0123abcd"); assert.equal(l.programm, "claude");
  assert.equal(l.wer, "Claude Code · Privat"); assert.equal(l.vaultName, "Kortex"); assert.deepEqual(l.pfade, ["05_aufgaben/2026-10-31-x.md"]);
  assert.deepEqual(l.rueckgaengig, { art: "ablage-entfernen", pfad: "05_aufgaben/2026-10-31-x.md", hash: HASH });
  assert.ok(Number.isFinite(Date.parse(l.zeit)));
});

test("Die Kennung ist der Hash des echten Pfads: stabil, 16 Hex, je Vault verschieden", () => {
  const a = neu(), b = neu();
  assert.match(a.kennung, /^[0-9a-f]{16}$/); assert.equal(A.kennungVault(a.vault), a.kennung); assert.notEqual(a.kennung, b.kennung);
  assert.equal(A.kennungVault(a.vault), A.kennungVault(join(a.vault, "..", a.vault.split("/").pop())), "auch über einen anderen Weg zum selben Ordner");
});

test("Begrenzung: unbekannte Art wird verworfen; Text, Pfade, Konto und Schlüsselformen werden bereinigt — nie ein Geheimnis im Protokoll", () => {
  const { support, vault, kennung } = neu();
  assert.equal(A.schreibeEreignis(support, vault, { art: "gibt-es-nicht", text: "x" }), null);
  A.schreibeEreignis(support, vault, { art: "abweisung", konto: "k_ZZ", programm: "Bad Name!", grund: "Böse Zeichen", text: `a\nb${String.fromCharCode(0x2028)}c ghp_${"A".repeat(30)} sk-${"b".repeat(30)} Bearer ${"c".repeat(24)} ${"x".repeat(500)}`,
    pfade: ["ok/a.md", "../draussen.md", "/abs.md", "a//b.md", "a\\b.md", "x".repeat(400), "mit\u0000nul.md", ...Array.from({ length: 20 }, (_, i) => `n${i}.md`)],
    rueckgaengig: { art: "ablage-entfernen", pfad: "../x", hash: HASH } });
  const [l] = A.leseEreignisse(support, kennung);
  assert.equal(l.konto, null); assert.equal(l.programm, null); assert.equal(l.grund, undefined);
  assert.ok(l.text.length <= 240); assert.ok(!/ghp_|sk-b|Bearer ccc/.test(l.text), l.text); assert.match(l.text, /\[entfernt\]/); assert.ok(!/[\n]/.test(l.text) && !l.text.includes(String.fromCharCode(0x2028)));
  assert.equal(l.pfade[0], "ok/a.md"); assert.ok(l.pfade.length <= 10); assert.ok(l.pfade.every((p) => !p.startsWith("/") && !p.includes("..") && !p.includes("\\") && !p.includes("//") && p.length <= 300));
  assert.equal(l.rueckgaengig, undefined, "ein Pfad außerhalb des Vaults gibt keine Rückgängig-Möglichkeit");
  const zeile = readFileSync(A.ereignisDatei(support, kennung), "utf8");
  assert.ok(zeile.length < 4000, "eine Zeile bleibt unter 4 KB");
});

test("Rotation: über der Grenze wird die Datei zur Vorfassung (.alt); Lesen liefert beide in Reihenfolge, die Größe bleibt begrenzt, nichts geht verloren", () => {
  const { support, vault, kennung } = neu();
  for (let i = 0; i < 60; i++) A.schreibeEreignis(support, vault, { art: "ablage-notiz", text: `Eintrag ${String(i).padStart(3, "0")} ${"y".repeat(100)}`, zeit: new Date(Date.UTC(2026, 9, 31, 8, 0, i)).toISOString() }, { maxBytes: 3000 });
  const datei = A.ereignisDatei(support, kennung);
  assert.ok(existsSync(`${datei}.alt`), "es gibt eine Vorfassung");
  const groesse = (d) => (existsSync(d) ? statSync(d).size : 0);
  assert.ok(groesse(datei) <= 3000 + 500, "die aktuelle Datei bleibt klein");
  const alle = A.leseEreignisse(support, kennung);
  assert.ok(alle.length >= 10 && alle.length <= 60, `${alle.length}`); // die letzten ~2 Dateien; ältere fallen beim zweiten Rotieren weg (Begrenzung)
  const nr = alle.map((e) => Number(/Eintrag (\d+)/.exec(e.text)[1]));
  assert.deepEqual(nr, [...nr].sort((a, b) => a - b), "aufsteigend");
  assert.equal(nr.at(-1), 59, "das Neueste ist da");
  assert.ok(readdirSync(join(support, "aktivitaet")).every((n) => n === `${kennung}.jsonl` || n === `${kennung}.jsonl.alt`));
  // zweite Rotation ersetzt die Vorfassung (kein Wachstum ohne Ende)
  for (let i = 60; i < 400; i++) A.schreibeEreignis(support, vault, { art: "ablage-notiz", text: `Eintrag ${i} ${"y".repeat(100)}` }, { maxBytes: 3000 });
  assert.ok(groesse(`${datei}.alt`) < 3000 + 500 && groesse(datei) < 3000 + 500);
});

test("Lesen: seit (ausschließlich), Arten, limit; kaputte Zeilen und fremde Formen werden übersprungen", () => {
  const { support, vault, kennung } = neu();
  const z = (s) => new Date(Date.UTC(2026, 9, 31, 8, 0, s)).toISOString();
  for (const [i, art] of ["ablage-aufgabe", "abweisung", "pflege", "abweisung"].entries()) A.schreibeEreignis(support, vault, { art, text: art, zeit: z(i) });
  writeFileSync(A.ereignisDatei(support, kennung), `${readFileSync(A.ereignisDatei(support, kennung), "utf8")}{kaputt\n{"v":2,"id":"x","art":"pflege","zeit":"2026-10-31T09:00:00Z"}\n[]\n`);
  assert.equal(A.leseEreignisse(support, kennung).length, 4);
  assert.deepEqual(A.leseEreignisse(support, kennung, { arten: ["abweisung"] }).map((e) => e.zeit), [z(1), z(3)]);
  assert.deepEqual(A.leseEreignisse(support, kennung, { seit: z(1) }).map((e) => e.art), ["pflege", "abweisung"]);
  assert.deepEqual(A.leseEreignisse(support, kennung, { limit: 1 }).map((e) => e.zeit), [z(3)]);
  assert.deepEqual(A.leseEreignisse(support, "nicht-da", {}), []);
  assert.deepEqual(A.leseEreignisse(support, "0".repeat(16), {}), []);
});

test("Drossel: dieselbe Meldung (gleicher Schlüssel) wird innerhalb der Zeit nur einmal geschrieben, ein anderer Schlüssel oder eine abgelaufene Zeit schreibt wieder", () => {
  const { support, vault, kennung } = neu();
  const w = (schluessel, sekunden = 600, zeit) => A.schreibeEreignis(support, vault, { art: "abweisung", text: "x", ...(zeit ? { zeit } : {}) }, { drossel: { schluessel, sekunden } });
  assert.ok(w("a")); assert.equal(w("a"), null); assert.ok(w("b"));
  assert.equal(A.leseEreignisse(support, kennung).length, 2);
  // ein Ereignis aus der Vergangenheit zählt nicht mehr
  const { support: s2, vault: v2, kennung: k2 } = neu();
  A.schreibeEreignis(s2, v2, { art: "abweisung", text: "x", zeit: new Date(Date.now() - 3600_000).toISOString() }, { drossel: { schluessel: "a", sekunden: 600 } });
  assert.ok(A.schreibeEreignis(s2, v2, { art: "abweisung", text: "x" }, { drossel: { schluessel: "a", sekunden: 600 } }));
  assert.equal(A.leseEreignisse(s2, k2).length, 2);
});

test("Schreiben wirft nie (Support-Ordner unbrauchbar, kein Text, kein Vault)", () => {
  const { vault } = neu();
  const datei = join(tmp("akt-datei-"), "keinOrdner"); writeFileSync(datei, "x");
  assert.equal(A.schreibeEreignis(datei, vault, { art: "pflege", text: "x" }), null);
  assert.equal(A.schreibeEreignis("", vault, { art: "pflege", text: "x" }), null);
  assert.equal(A.schreibeEreignis(null, vault, { art: "pflege", text: "x" }), null);
  assert.equal(A.schreibeEreignis(tmp(), "/gibt/es/nicht/so", { art: "pflege", text: "x" })?.art, "pflege", "auch ein Vault-Pfad, den es nicht gibt, hat eine Kennung");
});

test("Zustand „gelesen“ und „zurückgenommen“: gelesenBis und einzelne Ids; Ids, die nicht mehr im Protokoll stehen, fallen heraus", () => {
  const { support, vault, kennung } = neu();
  const e1 = A.schreibeEreignis(support, vault, { art: "abweisung", text: "1", zeit: "2026-10-31T08:00:00.000Z" });
  const e2 = A.schreibeEreignis(support, vault, { art: "abweisung", text: "2", zeit: "2026-10-31T09:00:00.000Z" });
  let z = A.leseZustand(support, kennung);
  assert.deepEqual(z, { gelesenBis: null, gelesen: [], zurueck: {}, wieder: {} });
  assert.equal(A.istGelesen(z, e1), false);
  z = A.aendereZustand(support, kennung, (s) => { s.gelesenBis = "2026-10-31T08:30:00.000Z"; s.gelesen.push(e2.id, "a_weg_000000"); s.zurueck[e1.id] = "2026-10-31T10:00:00.000Z"; s.zurueck["a_weg_000000"] = "x"; });
  assert.equal(A.istGelesen(z, e1), true); assert.equal(A.istGelesen(z, e2), true);
  assert.deepEqual(z.gelesen, [e2.id]); assert.deepEqual(Object.keys(z.zurueck), [e1.id]);
  assert.deepEqual(A.leseZustand(support, kennung), z);
  // kaputte Datei → leerer Zustand, nie ein Fehler
  writeFileSync(join(support, "aktivitaet", `${kennung}.zustand.json`), "{nope");
  assert.deepEqual(A.leseZustand(support, kennung), { gelesenBis: null, gelesen: [], zurueck: {}, wieder: {} });
});

test("Anzeige: „Claude Code · Privat“ aus Programm und Kontoname; ohne Konto aus dem Namen des MCP-Clients; sonst „Eine KI“", () => {
  assert.equal(A.werText({ programm: "claude", kontoName: "Privat" }), "Claude Code · Privat");
  assert.equal(A.werText({ programm: "codex" }), "Codex");
  assert.equal(A.werText({ klient: "claude-code" }), "Claude Code");
  assert.equal(A.werText({ klient: "Mein Werkzeug 2" }), "Eine KI", "ein Client-Name, den Kortex nicht kennt, steht nie als Freitext in der Anzeige");
  assert.equal(A.werText({ klient: "unbekannt" }), "Eine KI");
  assert.equal(A.werText({}), "Eine KI");
  assert.equal(A.programmAnzeige("cursor-agent"), "Cursor");
});

test("Jede Ereignisart hat einen Schalter der Mitteilungen (oder bewusst keinen), und der Schalter gibt es in den Einstellungen der App", async () => {
  const { APP_SCHEMA } = await import(pfad("gemeinsam", "app-einstellungen.mjs"));
  assert.deepEqual(Object.keys(A.ART_SCHALTER).sort(), [...A.ARTEN].sort());
  for (const [art, schalter] of Object.entries(A.ART_SCHALTER)) if (schalter !== null) assert.ok(Object.hasOwn(APP_SCHEMA, schalter), `${art} → ${schalter}`);
  assert.equal(A.ART_SCHALTER.abweisung, "mitteilungenAbgewiesen"); assert.equal(A.ART_SCHALTER.rueckgaengig, null);
});

test("k5: rotiert wird nur unter einer Sperrdatei — hält ein anderer Prozess sie, wird nicht rotiert (die Vorfassung wird nie überschrieben); eine verwaiste Sperre gilt nach 10 s nicht mehr", async () => {
  const { utimesSync } = await import("node:fs");
  const { support, vault, kennung } = neu();
  const datei = A.ereignisDatei(support, kennung);
  const schreibeViele = (n) => { for (let i = 0; i < n; i++) A.schreibeEreignis(support, vault, { art: "pflege", text: `n ${i} ${"y".repeat(100)}` }, { maxBytes: 2000 }); };
  schreibeViele(1);
  writeFileSync(`${datei}.lock`, ""); // ein anderer Prozess rotiert gerade
  schreibeViele(30);
  assert.equal(existsSync(`${datei}.alt`), false, "unter fremder Sperre wird nicht rotiert");
  assert.ok(statSync(datei).size > 2000);
  const alt = new Date(Date.now() - 30_000); utimesSync(`${datei}.lock`, alt, alt); // verwaist
  schreibeViele(1);
  schreibeViele(2);
  assert.ok(existsSync(`${datei}.alt`));
  assert.equal(existsSync(`${datei}.lock`), false, "die Sperre wird immer freigegeben");
});
