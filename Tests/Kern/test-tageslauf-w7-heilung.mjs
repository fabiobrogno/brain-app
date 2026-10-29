// .tools/tests/test-tageslauf-w7-heilung.mjs — Befund #9: Der W7-Stand wird in Schritt 0 fortgeschrieben, das Feld „zweifel“ aber erst nach dem Merge
// geschrieben. Scheitert der Merge, darf der Auftrag nicht verloren sein: offene zweifel-Rückfragen aus W7 (grund w7), deren Seite das Feld noch nicht
// trägt, erzeugen ihren Feld-Auftrag in jedem Lauf neu, bis das Feld steht (Selbstheilung statt Stand-Verschiebung — siehe Kommentar in antworten.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { isoliere, neuerTestVault, seitenText, git, FAKE_BEFEHL, JETZT } from "./tageslauf-hilfe.mjs";
const A = await import("../tageslauf/antworten.mjs");
const T = await import("../tageslauf.mjs");
const R = await import("../rueckfragen.mjs");
const P = await import("../tageslauf/protokoll.mjs");
isoliere();

const SEITE = "09_wiki/projekte/entitaet_alpha.md";
const ctxFuer = (v, opt = {}) => P.neuerLauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT, ...opt });
const vault = (fm = {}) => neuerTestVault({ seiten: { [SEITE]: seitenText({ fm: { name: "alpha", description: "Alpha", ...fm }, rumpf: "# Alpha\n\n- Port 3309 · Stand 01.10.2026 · [[x]]\n" }) } });
const w7Zeile = (uuid, zitat = "Das stimmt nicht, Port ist 3311") => JSON.stringify({ v: 1, seite: SEITE, sitzung: "s9", uuid, zeit: "2026-10-21T12:00:00Z", zitat });
const schreibeW7 = (v, ...zeilen) => { mkdirSync(join(v, ".logs"), { recursive: true }); writeFileSync(join(v, ".logs", "w7.jsonl"), zeilen.join("\n") + "\n", { flag: "a" }); };
const zweifelFrage = (ctx, extra = {}) => R.legeRueckfrageAn(ctx, { typ: "zweifel", frage: "Stimmt entitaet_alpha.md noch?", seite: SEITE, grund: "w7",
  beschreibung: "Nach einem Kortex-Hinweis auf diese Seite kam eine Korrektur:\n„Port ist 3311“\nSitzung s9", ...extra });
const seiteText = (v) => readFileSync(join(v, SEITE), "utf8");

test("offene zweifel-Rückfrage aus W7 ohne gesetztes Feld → der Feld-Auftrag kommt in jedem Lauf wieder; mit gesetztem Feld nicht", () => {
  const v = vault();
  const id = zweifelFrage(ctxFuer(v));
  const r = A.w7Eingang(ctxFuer(v), { aktionen: [] });
  assert.deepEqual(r.auftraege.map((a) => [a.art, a.seite, a.feld, a.ref]), [["feld", SEITE, "zweifel", id]]);
  assert.match(r.auftraege[0].wert, /^2026-10-22: Port ist 3311$/, "Datum der Rückfrage, Zitat aus der Rückfrage");
  assert.equal(r.neu, 0, "keine neue W7-Zeile");
  const nochmal = A.w7Eingang(ctxFuer(v), { aktionen: [] });
  assert.equal(nochmal.auftraege.length, 1, "solange das Feld fehlt, jedes Mal");
  const gesetzt = vault({ zweifel: '"2026-10-22: Port ist 3311"' });
  zweifelFrage(ctxFuer(gesetzt));
  assert.deepEqual(A.w7Eingang(ctxFuer(gesetzt), { aktionen: [] }).auftraege, [], "Feld steht schon → nichts zu tun");
});

test("kein Heilungs-Auftrag: beantwortete Rückfrage, Rückfrage anderen Ursprungs, fehlende/unlesbare Seite, Seite außerhalb des Wikis, kritische Seite", () => {
  const v = vault();
  const ctx = ctxFuer(v);
  const beantwortet = zweifelFrage(ctx);
  R.beantworte(v, beantwortet, "stimmt");
  zweifelFrage(ctx, { grund: "pflege" });                                      // nicht aus W7
  zweifelFrage(ctx, { seite: "09_wiki/gibtsnicht.md" });
  zweifelFrage(ctx, { seite: "brain.config.json" });
  zweifelFrage(ctx, { seite: "09_wiki/../brain.config.json" });
  assert.deepEqual(A.w7Eingang(ctxFuer(v), { aktionen: [] }).auftraege, []);
  for (const wert of ["true", "ja", '"true"', "yes"]) {                         // jeder Wert außer false gilt als kritisch (B1-Vertrag): der Lauf fasst die Seite nie an
    const k = vault({ kritisch: wert });
    zweifelFrage(ctxFuer(k));
    assert.deepEqual(A.w7Eingang(ctxFuer(k), { aktionen: [] }).auftraege, [], `kritisch: ${wert}`);
  }
  const nein = vault({ kritisch: "false" });
  zweifelFrage(ctxFuer(nein));
  assert.equal(A.w7Eingang(ctxFuer(nein), { aktionen: [] }).auftraege.length, 1, "kritisch: false ist nicht kritisch");
});

test("neue W7-Zeile und offene Rückfrage in einem Aufruf: nur ein Auftrag je Seite (die frisch angelegte Rückfrage zählt nicht doppelt)", () => {
  const v = vault();
  schreibeW7(v, w7Zeile("u1"));
  const r = A.w7Eingang(ctxFuer(v), { aktionen: [] });
  assert.equal(r.neu, 1);
  assert.equal(r.auftraege.length, 1);
  const r2 = A.w7Eingang(ctxFuer(v), { aktionen: [] });
  assert.equal(r2.neu, 0);
  assert.equal(r2.auftraege.length, 1, "im nächsten Lauf (Merge war nicht durch) kommt er aus der Rückfrage");
  assert.equal(R.listeRueckfragen(v).filter((x) => x.typ === "zweifel").length, 1, "keine zweite Rückfrage");
});

test("Merge scheitert (lokale Änderung an der Seite) → der nächste Lauf setzt das Feld doch; danach kein weiterer Auftrag", async () => {
  const v = vault();
  schreibeW7(v, w7Zeile("u1"));
  const original = seiteText(v);
  writeFileSync(join(v, SEITE), `${original}\nHandnotiz, noch nicht gespeichert.\n`);
  const lauf = (opt = {}) => T.tageslauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT, nurAntworten: true, ...opt });
  const r1 = await lauf();
  assert.equal(r1.status, "teilweise", JSON.stringify(r1));
  assert.match(r1.grund, /Ungespeicherte/);
  assert.doesNotMatch(seiteText(v), /^zweifel:/m, "Feld nicht gesetzt");
  assert.equal(R.listeRueckfragen(v).filter((x) => x.typ === "zweifel").length, 1, "die Rückfrage gibt es");
  assert.equal(JSON.parse(readFileSync(join(P.TL_DIR(v), "w7-stand.json"), "utf8")).gelesen, 1, "die W7-Zeile gilt als gelesen");
  writeFileSync(join(v, SEITE), original);                                      // Handnotiz weg
  const r2 = await lauf({ jetzt: JETZT + 3600e3 });
  assert.equal(r2.status, "ok", JSON.stringify(r2));
  assert.match(seiteText(v), /^zweifel: .*Das stimmt nicht, Port ist 3311/m, "Feld wurde im nächsten Lauf doch gesetzt");
  assert.match(git(v, "log", "-1", "--format=%s"), /Zweifel nach Korrektur \(W7\)/);
  const commits = git(v, "rev-list", "--count", "HEAD");
  const r3 = await lauf({ jetzt: JETZT + 7200e3 });
  assert.equal(r3.status, "ok");
  assert.equal(git(v, "rev-list", "--count", "HEAD"), commits, "Feld steht → kein weiterer Commit");
  assert.equal(R.listeRueckfragen(v).filter((x) => x.typ === "zweifel").length, 1, "die Rückfrage bleibt bis zu deiner Antwort offen");
});

test("Heilung gilt auch nach Ingest-Sperre und Probe: die Probe schreibt nichts, der scharfe Lauf danach setzt das Feld", async () => {
  const v = vault();
  schreibeW7(v, w7Zeile("u1"));
  writeFileSync(join(v, ".logs", "ingest.lock"), "ingest 1\n");
  const r1 = await T.tageslauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT, nurAntworten: true });
  assert.equal(r1.status, "teilweise");
  assert.match(r1.grund, /ingest/);
  assert.doesNotMatch(seiteText(v), /^zweifel:/m);
  const probe = await T.tageslauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT + 600e3, nurAntworten: true, probe: true });
  assert.equal(probe.modus, "probe");
  assert.doesNotMatch(seiteText(v), /^zweifel:/m, "Probe schreibt nichts");
  writeFileSync(join(v, ".logs", "ingest.lock"), "", { flag: "w" });
  const alt = new Date(Date.now() - 31 * 60e3);
  (await import("node:fs")).utimesSync(join(v, ".logs", "ingest.lock"), alt, alt);
  const r2 = await T.tageslauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT + 3600e3, nurAntworten: true });
  assert.equal(r2.status, "ok", JSON.stringify(r2));
  assert.match(seiteText(v), /^zweifel: /m);
});
