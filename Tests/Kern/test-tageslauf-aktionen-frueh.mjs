// .tools/tests/test-tageslauf-aktionen-frueh.mjs — Befund #7: Die Übernahme-Aktionen stehen direkt nach dem Merge in aktionen.jsonl
// (append + fsync, noch vor Verschieben/Aufräumen) — auch wenn der Lauf danach hart stirbt, findet `brain zurueck <lauf>` sie.
// Der finally-Pfad schreibt nichts doppelt. Einschwingen/Autostufe/Stichproben bleiben dabei konsistent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { isoliere, neuerTestVault, fakeKi, git, JETZT, FAKE_BEFEHL } from "./tageslauf-hilfe.mjs";
import { SEITE, REGELN, aufbau, lauf } from "./lauf-hilfe.mjs";
import { mitEigenemCache, hartAbbrechen, alteSperre } from "./abbruch-hilfe.mjs";
const P = await import("../tageslauf/protokoll.mjs");
const R = await import("../rueckfragen.mjs");
const Zr = await import("../tageslauf/zurueck.mjs");
isoliere();

const aktionenDatei = (v) => join(P.TL_DIR(v), "aktionen.jsonl");
const zeilen = (v) => readFileSync(aktionenDatei(v), "utf8").split("\n").filter(Boolean).map((z) => JSON.parse(z));
const ctxFuer = (v, opt = {}) => P.neuerLauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT, ...opt });

// ------------------------------------------------------------------------------------------------ protokoll.mjs
test("schreibeAktionen: schreibt nur, was noch nicht draußen ist — zweimal aufgerufen steht jede Aktion genau einmal", () => {
  const v = neuerTestVault();
  const ctx = ctxFuer(v);
  P.notiere(ctx, { id: "a", stufe: "uebernehmen" });
  P.schreibeAktionen(ctx, { sicher: true });
  P.notiere(ctx, { id: "b", stufe: "warten" });
  P.schreibeAktionen(ctx);
  P.schreibeAktionen(ctx);
  assert.deepEqual(zeilen(v).map((a) => a.id), ["a", "b"]);
});

test("schreibeAktionen: scheitert das Schreiben, rückt der Zähler nicht vor — der nächste Aufruf holt es nach", () => {
  const v = neuerTestVault();
  const ctx = ctxFuer(v);
  P.notiere(ctx, { id: "a", stufe: "uebernehmen" });
  mkdirSync(join(v, ".logs"), { recursive: true });
  writeFileSync(join(v, ".logs", "tageslauf"), "ich bin eine Datei, kein Ordner");   // TL_DIR lässt sich nicht anlegen
  assert.throws(() => P.schreibeAktionen(ctx, { sicher: true }));
  assert.equal(ctx.aktionenGeschrieben, 0);
});

test("Probe schreibt in probe-aktionen.jsonl, nie in aktionen.jsonl — auch zweimal ohne Doppelung", () => {
  const v = neuerTestVault();
  const ctx = ctxFuer(v, { probe: true });
  P.notiere(ctx, { id: "p", stufe: "uebernehmen" });
  P.schreibeAktionen(ctx);
  P.schreibeAktionen(ctx);
  assert.ok(!existsSync(aktionenDatei(v)));
  assert.equal(readFileSync(join(P.TL_DIR(v), "probe-aktionen.jsonl"), "utf8").split("\n").filter(Boolean).length, 1);
});

test("Nachtrag: ein erst später bekanntes Feld wird in die schon geschriebene Aktion eingeschmolzen; ohne Gegenstück verfällt er; vor dem Schreiben geht es mit der Zeile raus", () => {
  const v = neuerTestVault();
  const ctx = ctxFuer(v);
  const a = P.notiere(ctx, { id: "a", stufe: "uebernehmen", commit: "c1", verschoben: null });
  P.schreibeAktionen(ctx, { sicher: true });
  P.haengeNachtragAn(ctx, a, { verschoben: "90_archiv/vorschlaege-uebernommen/a.md" });
  const b = P.notiere(ctx, { id: "b", stufe: "uebernehmen", commit: "c2", verschoben: null });
  P.haengeNachtragAn(ctx, b, { verschoben: "90_archiv/vorschlaege-uebernommen/b.md" });   // b steht noch nicht in der Datei
  P.schreibeAktionen(ctx);
  assert.equal(zeilen(v).filter((z) => z.nachtrag).length, 1, "nur für a gibt es eine Nachtrag-Zeile");
  const l = P.leseAktionen(v);
  assert.deepEqual(l.map((x) => [x.id, x.verschoben]), [["a", "90_archiv/vorschlaege-uebernommen/a.md"], ["b", "90_archiv/vorschlaege-uebernommen/b.md"]]);
  assert.ok(l.every((x) => x.nachtrag === undefined), "Nachtrag-Zeilen tauchen nicht als eigene Aktion auf");
  writeFileSync(aktionenDatei(v), `${JSON.stringify({ lauf: "L", id: "waise", stufe: "uebernehmen", nachtrag: true, verschoben: "x" })}\n`);
  assert.deepEqual(P.leseAktionen(v), [], "Nachtrag ohne Gegenstück verfällt");
});

// ------------------------------------------------------------------------------------------------ normaler Lauf
test("normaler Lauf: jede Aktion steht genau einmal in aktionen.jsonl; verschoben (nach dem Verschieben bekannt) ist trotzdem im Protokoll", async () => {
  const v = aufbau({ automatik: { tageslauf: "an" } });
  fakeKi(REGELN);
  const r = await lauf(v);
  assert.equal(r.status, "ok", JSON.stringify(r));
  const roh = readFileSync(aktionenDatei(v), "utf8").split("\n").filter(Boolean);
  assert.equal(new Set(roh).size, roh.length, "keine doppelte Zeile");
  const echt = zeilen(v).filter((z) => !z.nachtrag);
  const schluessel = echt.map((z) => `${z.id}|${z.stufe}|${z.typ || ""}|${z.grund || ""}`);
  assert.equal(new Set(schluessel).size, schluessel.length, `jede Aktion nur einmal: ${schluessel.join(" ; ")}`);
  const uebernommen = P.leseAktionen(v).filter((a) => a.stufe === "uebernehmen");
  assert.deepEqual(uebernommen.map((a) => a.id).sort(), ["g1", "n1"]);
  assert.ok(uebernommen.every((a) => /^[0-9a-f]{40}$/.test(a.commit) && a.auto === true));
  assert.ok(uebernommen.every((a) => /^90_archiv\/vorschlaege-uebernommen\/(g1|n1)\.md$/.test(a.verschoben)), "verschoben steht im Protokoll");
  assert.ok(existsSync(join(v, uebernommen[0].verschoben)));
});

// ------------------------------------------------------------------------------------------------ harter Abbruch
test("Lauf nach dem Merge hart abgebrochen (SIGKILL beim Verschieben): die Übernahmen stehen im Protokoll, `brain zurueck <lauf>` nimmt sie zurück", () => mitEigenemCache(async () => {
  const v = aufbau({ automatik: { tageslauf: "an", einschwingen: 0 } });
  fakeKi(REGELN);
  hartAbbrechen(v);
  assert.equal(git(v, "log", "--format=%s", "main").split("\n").filter((s) => /^auto\(/.test(s)).length, 2, "beide Übernahmen sind in main");
  assert.ok(existsSync(join(v, "00_inbox", "_vorschlaege", "g1.md")), "g1 wurde nie verschoben — der Lauf starb davor");
  const a = P.leseAktionen(v).filter((x) => x.stufe === "uebernehmen");
  assert.deepEqual(a.map((x) => x.id).sort(), ["g1", "n1"], "Aktionen stehen trotz Absturz in aktionen.jsonl");
  assert.ok(a.every((x) => /^[0-9a-f]{40}$/.test(x.commit) && x.auto === true));
  assert.ok(!P.leseLetzter(v), "der Lauf kam nie bis zum Abschluss");
  alteSperre(v);
  const r = Zr.nimmZurueck(v, { lauf: a[0].lauf, jetzt: JETZT + 3600e3 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.zurueck, 2);
  assert.doesNotMatch(readFileSync(join(v, SEITE), "utf8"), /belege\/2026-10\/(g1|n1)/);
}));

test("Wochen-Stichprobe fragt Übernahmen desselben Laufs nicht ab (wie bisher: frühestens beim nächsten Lauf), obwohl sie jetzt früh im Protokoll stehen", async () => {
  const v = aufbau({ automatik: { tageslauf: "an", einschwingen: 0 } });
  fakeKi(REGELN);
  const r = await lauf(v);
  assert.equal(r.zahlen.uebernommen, 2);
  assert.deepEqual(R.listeRueckfragen(v).filter((x) => x.typ === "stichprobe"), [], "keine Stichprobe aus demselben Lauf");
  const r2 = await lauf(v, { jetzt: JETZT + 3600e3 });
  assert.equal(r2.status, "ok", JSON.stringify(r2));
  assert.ok(R.listeRueckfragen(v).filter((x) => x.typ === "stichprobe").length > 0, "beim nächsten Lauf kommen sie dran");
});
