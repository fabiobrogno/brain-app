// .tools/tests/test-gesundheit.mjs — Gesundheits-Wächter (tageslauf/gesundheit.mjs): jede der fünf Prüfungen grün/gelb/rot mit Fixtures
// (Fake-hint.log, Fake-hint-eval.log, Fake-SQLite-Index, Fake-Dienst), Fehlergrenze (eine Prüfung wirft → der Rest läuft), Messlatte-Takt,
// Einhängen in den Tageslauf (Bericht, letzter.json, gesundheit.json), Startzeile nur bei Warnung, CLI. Nie echtes ~/brain, nie echtes qmd.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync, utimesSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { isoliere, neuerTestVault, legeVorschlagAn, fakeKi, FAKE_BEFEHL, JETZT, KIT } from "./tageslauf-hilfe.mjs";
import { tempVault, tempOrdner, hook } from "./verlauf-fixture.mjs";
const G = await import("../tageslauf/gesundheit.mjs");
const P = await import("../tageslauf/protokoll.mjs");
const { tageslauf } = await import("../tageslauf.mjs");
isoliere();
const TAG = 86400e3, STUNDE = 3600e3;

// ---------- Hilfen ----------
const gruen = () => ({ text: "ok", befunde: [], stufe: "gruen", daten: {} });
const ALLE = ["messlatte", "hinweis", "index", "dienst", "rueckstand"];
// Nur EINE Prüfung echt laufen lassen, die anderen als grüne Attrappen — so prüft jeder Test genau eine Zuständigkeit.
async function nur(id, v, { haken = {}, ...opt } = {}) {
  const stubs = Object.fromEntries(ALLE.filter((x) => x !== id).map((x) => [x, gruen]));
  const g = await G.gesundheit(v, { jetzt: JETZT, ...opt, haken: { ...haken, pruefungen: { ...stubs, ...(haken.pruefungen || {}) } } });
  return g.pruefungen.find((p) => p.id === id);
}
function vaultMit({ automatik = {}, hinweis, suche, extra = {} } = {}) {
  const v = tempVault();
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ automatik, ...(hinweis ? { hinweis } : {}), ...(suche ? { suche } : {}), ...extra }));
  mkdirSync(join(v, ".logs"), { recursive: true });
  return v;
}
const logDatei = (v, name, text) => { mkdirSync(join(v, ".logs"), { recursive: true }); writeFileSync(join(v, ".logs", name), text); };
const iso = (ms) => new Date(ms).toISOString().slice(0, 19);   // Zeitstempel wie im hint.log/hooks.log (UTC, ohne Z)
const isoZ = (ms) => new Date(ms).toISOString();              // Zeitstempel wie in der qmd-Datenbank (mit Z)
// Eine hint.log-Zeile wie brain-hint.mjs sie schreibt, `vor` Sekunden vor JETZT.
const hz = (vor, sid, { len = 100 + vor, weg = "dienst", treffer = false, unterdrueckt = 0, dienst = "", ms = 800 } = {}) =>
  `${iso(JETZT - vor * 1000)} sid=${sid} len=${len} weg=${weg}${dienst ? ` dienst=${dienst}` : ""} top=0.500 zeichen=${treffer ? 120 : 0} hits=${treffer ? "09_wiki%2Fa.md" : "-"} unterdrueckt=${unterdrueckt} kalt=0 refresh=0 ms=${ms}`;
const fz = (vor, sid, code = "ETIMEDOUT") => `${iso(JETZT - vor * 1000)} sid=${sid} fehler=${code} kalt=0 refresh=0 ms=4003`;
const evalZeile = (datum, positiv, ok, still = "20/20") => `hint-eval ${datum} positiv=${positiv} still=${still} kontrolle=29/30 holdout=27/30 p95ms=900 ok=${ok}`;
const kurzListe = (p) => p.befunde.map((b) => b.kurz);

// ---------- 2 Hinweis-Wege ----------
test("hinweis: Weg mit ≥ 20 Prompts und 0 Treffern → rot, mit 19 oder mit einem Treffer nicht; unterdrückte Treffer zählen als Treffer", async () => {
  const v = vaultMit();
  const zeilen = [];
  for (let i = 0; i < 20; i++) zeilen.push(hz(100 + i, "s1", { weg: "dienst-vektor" }));   // 20 Prompts, kein Treffer
  for (let i = 0; i < 19; i++) zeilen.push(hz(300 + i, "s2", { weg: "vektor" }));          // 19 Prompts, kein Treffer → unter der Grenze
  for (let i = 0; i < 25; i++) zeilen.push(hz(500 + i, "s3", { weg: "dienst", treffer: i === 0 }));  // 25 Prompts, 1 Treffer
  for (let i = 0; i < 22; i++) zeilen.push(hz(700 + i, "s4", { weg: "kalt-rerank", unterdrueckt: i === 3 ? 1 : 0 }));   // nur „unterdrückt“ → fand etwas
  logDatei(v, "hint.log", zeilen.join("\n") + "\n");
  const p = await nur("hinweis", v);
  assert.equal(p.stufe, "rot");
  assert.deepEqual(kurzListe(p), ["Weg dienst-vektor 0 Treffer/24 h"]);
  assert.deepEqual(Object.fromEntries(Object.entries(p.daten.wege).map(([w, x]) => [w, [x.prompts, x.treffer]])),
    { "dienst-vektor": [20, 0], vektor: [19, 0], dienst: [25, 1], "kalt-rerank": [22, 1] });
  assert.match(p.text, /dienst-vektor 20 \(0 mit Treffer\)/);
  // Mehrere leere Wege stehen zusammen in einem Befund
  logDatei(v, "hint.log", [...Array(20).keys()].flatMap((i) => [hz(100 + i, "a", { weg: "dienst-vektor" }), hz(100 + i, "b", { weg: "vektor", len: 5 + i })]).join("\n"));
  assert.deepEqual(kurzListe(await nur("hinweis", v)), ["Wege dienst-vektor, vektor 0 Treffer/24 h"]);
});

test("hinweis: Fehler-/Timeout-Anteil > 10 % → rot (ab 10 Zeilen), genau 10 % und wenige Zeilen nicht; Dienst-Timeout zählt, Dienst nicht erreichbar nicht", async () => {
  const v = vaultMit();
  const gute = (n, ab = 100) => Array.from({ length: n }, (_, i) => hz(ab + i, "g", { treffer: true, len: 200 + i }));
  logDatei(v, "hint.log", [...gute(9), fz(50, "x")].join("\n"));                     // 1/10 = 10 % → noch in Ordnung
  assert.equal((await nur("hinweis", v)).stufe, "gruen");
  logDatei(v, "hint.log", [...gute(8), fz(50, "x"), fz(60, "y")].join("\n"));        // 2/10 = 20 %
  let p = await nur("hinweis", v);
  assert.equal(p.stufe, "rot");
  assert.deepEqual(kurzListe(p), ["Hinweis-Fehler/Timeouts 20 % (2/10)"]);
  logDatei(v, "hint.log", [...gute(8), hz(50, "t", { dienst: "ETIMEDOUT", len: 1 }), hz(60, "t", { dienst: "ETIMEDOUT", len: 2 })].join("\n"));
  assert.equal((await nur("hinweis", v)).stufe, "rot", "Timeout des Dienstes (Rückfall lieferte trotzdem) zählt mit");
  logDatei(v, "hint.log", [...gute(8), hz(50, "t", { dienst: "EDIENST", len: 1 }), hz(60, "t", { dienst: "EDIENST", len: 2 })].join("\n"));
  p = await nur("hinweis", v);
  assert.equal(p.stufe, "gruen", "Dienst nicht erreichbar ist kein Hook-Fehler (der Rückfall hat geliefert)");
  assert.equal(p.daten.dienstAus, 2);
  logDatei(v, "hint.log", [fz(50, "x"), fz(60, "y"), fz(70, "z")].join("\n"));      // 100 %, aber nur 3 Zeilen
  assert.equal((await nur("hinweis", v)).stufe, "gruen", "unter 10 Zeilen kein Fehler-Anteil");
});

test("hinweis: Doppelaufrufe (gleiche sid+len binnen 3 s) → gelb; 4 s, andere len oder andere sid nicht", async () => {
  const v = vaultMit();
  logDatei(v, "hint.log", [hz(100, "s1", { len: 136 }), hz(100, "s1", { len: 136 }), hz(90, "s1", { len: 137 }), hz(86, "s1", { len: 137 }),
    hz(50, "s1", { len: 5 }), hz(50, "s2", { len: 5 })].join("\n"));
  let p = await nur("hinweis", v);
  assert.equal(p.stufe, "gelb");
  assert.deepEqual(kurzListe(p), ["1 Doppelaufruf/24 h (Hook doppelt eingetragen?)"], "nur das Paar gleicher Sekunde; 4 s Abstand und verschiedene sid zählen nicht");
  logDatei(v, "hint.log", [hz(100, "s1", { len: 136 }), hz(99, "s1", { len: 136 }), hz(97, "s1", { len: 136 })].join("\n"));
  assert.equal((await nur("hinweis", v)).daten.doppelt, 2, "drei Aufrufe binnen 3 s je Schritt → 2 Doppelaufrufe");
  logDatei(v, "hint.log", [hz(100, "s1", { len: 136 }), hz(50, "s1", { len: 136 })].join("\n"));
  assert.equal((await nur("hinweis", v)).stufe, "gruen");
});

test("hinweis: nur die letzten 24 h, p95 der ms, Zählung je Weg im Bericht; leeres/fehlendes Log und Hinweise „aus“ sind grün", async () => {
  const v = vaultMit();
  const ms = Array.from({ length: 20 }, (_, i) => (i + 1) * 100);   // 100 … 2000 → p95 (Nearest-Rank) = 19. Wert = 1900
  logDatei(v, "hint.log", [hz(26 * 3600, "alt", { weg: "vektor", ms: 9999 }),
    ...ms.map((m, i) => hz(100 + i * 10, "s", { len: 10 + i, treffer: true, ms: m }))].join("\n"));
  const p = await nur("hinweis", v);
  assert.equal(p.stufe, "gruen");
  assert.equal(p.daten.zeilen, 20, "die Zeile von vor 26 h zählt nicht");
  assert.equal(p.daten.p95ms, 1900);
  assert.match(p.text, /p95 1,9 s/);
  assert.equal((await nur("hinweis", vaultMit())).stufe, "gruen", "kein hint.log");
  logDatei(v, "hint.log", "");
  assert.match((await nur("hinweis", v)).text, /keine Prompts/);
  const aus = vaultMit({ automatik: { hinweise: "aus" } });
  logDatei(aus, "hint.log", Array.from({ length: 30 }, (_, i) => hz(100 + i, "s", { weg: "vektor", len: i })).join("\n"));
  assert.match((await nur("hinweis", aus)).text, /ausgeschaltet/);
  assert.equal((await nur("hinweis", aus)).stufe, "gruen");
});

// Befund 4: Läuft der SessionStart-Hook (hooks.log: „--- <lokale Zeit> session-start“), aber der UserPromptSubmit-Hook schreibt nichts (hint.log leer/fehlt), meldet der Wächter das.
const lokal = (ms) => { const d = new Date(ms), p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };   // wie session-start.mjs (formatLokal)
const sz = (vor) => `--- ${lokal(JETZT - vor * 1000)} session-start`;
test("hinweis: Sitzungsstarts in 24 h, aber 0 Zeilen in hint.log → gelb „Hinweis-Hook läuft nicht (N Sitzungsstarts, 0 Hinweis-Aufrufe)“ (Hook gar nicht eingetragen)", async () => {
  const v = vaultMit();
  logDatei(v, "hooks.log", [sz(7200), "2026-10-22T01:00:00 suchdienst start pid=1 warm", sz(3600), sz(60), sz(30 * 3600)].join("\n") + "\n");   // 3 Starts im Fenster, einer von vor 30 h zählt nicht
  let p = await nur("hinweis", v);                                            // kein hint.log
  assert.equal(p.stufe, "gelb");
  assert.deepEqual(kurzListe(p), ["Hinweis-Hook läuft nicht (3 Sitzungsstarts, 0 Hinweis-Aufrufe)"]);
  assert.equal(p.daten.sitzungsstarts, 3);
  logDatei(v, "hint.log", "");                                                // leeres hint.log: dasselbe
  assert.deepEqual(kurzListe(await nur("hinweis", v)), ["Hinweis-Hook läuft nicht (3 Sitzungsstarts, 0 Hinweis-Aufrufe)"]);
  logDatei(v, "hint.log", hz(30 * 3600, "alt", { treffer: true }) + "\n");    // nur eine alte Zeile (> 24 h): zählt als „0 Hinweis-Aufrufe in 24 h“
  assert.equal((await nur("hinweis", v)).stufe, "gelb");
  logDatei(v, "hooks.log", `${sz(3600)}\n${sz(60)}\n`);
  assert.deepEqual(kurzListe(await nur("hinweis", v)), ["Hinweis-Hook läuft nicht (2 Sitzungsstarts, 0 Hinweis-Aufrufe)"], "ab zwei Sitzungsstarts");
});

// N6: EIN Sitzungsstart ohne Prompt (frisch geöffnet, noch nichts getippt) ist kein „Hinweis-Hook läuft nicht“ — erst ab zwei Starts in 24 h; dort, wo hooks.log die Quelle trägt
// („session-start source=…“), zählen nur echte Neustarts (startup), nicht Wiederaufnahme/Kompaktierung/clear derselben Sitzung.
test("hinweis (N6): ein einzelner Sitzungsstart ohne hint.log ist kein Fehlalarm; erst ab zwei Starts mit source=startup (bzw. ohne Quelle) in 24 h → gelb", async () => {
  const v = vaultMit();
  logDatei(v, "hooks.log", `${sz(60)}\n`);
  const eins = await nur("hinweis", v);
  assert.equal(eins.stufe, "gruen", "ein Start: nur ein ruhiger Tag");
  assert.deepEqual(kurzListe(eins), []);
  logDatei(v, "hooks.log", `${sz(3600)}\n${sz(60)}\n`);
  assert.equal((await nur("hinweis", v)).stufe, "gelb", "zwei Starts");
  // mit Quelle: startup zählt, alles andere (compact, resume, clear) ist dieselbe Sitzung
  logDatei(v, "hooks.log", `${sz(3600)} source=startup\n${sz(600)} source=compact\n${sz(60)} source=resume\n${sz(30)} source=clear\n`);
  assert.equal((await nur("hinweis", v)).stufe, "gruen", "ein Neustart + Kompaktierung/Wiederaufnahme/clear: kein Fehlalarm");
  logDatei(v, "hooks.log", `${sz(3600)} source=startup\n${sz(600)} source=compact\n${sz(60)} source=startup\n`);
  assert.deepEqual(kurzListe(await nur("hinweis", v)), ["Hinweis-Hook läuft nicht (2 Sitzungsstarts, 0 Hinweis-Aufrufe)"]);
  assert.equal(G.zaehleSitzungsstarts(`${sz(60)} source=startup\n${sz(30)}\n${sz(20)} source=compact\n`, { jetzt: JETZT }), 2, "ohne Quelle zählt als Start (heutiges Format von session-start.mjs)");
});

test("hinweis: der Hook-Lauf wird erkannt, wo er Spuren hinterlässt — hint.log-Zeile oder Intent-Gate-Zeile in 24 h → grün; ohne Sitzungsstarts oder mit „hinweise aus“ nie gelb", async () => {
  const v = vaultMit();
  logDatei(v, "hooks.log", `${sz(3600)}\n${sz(60)}\n`);
  logDatei(v, "hint.log", `${hz(100, "s", { treffer: true })}\n`);
  assert.equal((await nur("hinweis", v)).stufe, "gruen", "Hinweis-Aufruf da");
  logDatei(v, "hint.log", "");
  logDatei(v, "intent-gate.log", `${iso(JETZT - 100 * 1000)} sid=abcd1234 len=5 gate=ohne-wissensbedarf\n`);
  assert.equal((await nur("hinweis", v)).stufe, "gruen", "der Hook lief (nur Bestätigungs-Prompts: Intent-Gate, kein hint.log)");
  assert.equal((await nur("hinweis", vaultMit())).stufe, "gruen", "ohne Sitzungsstarts ist ein leeres hint.log nur ein ruhiger Tag");
  const aus = vaultMit({ automatik: { hinweise: "aus" } });
  logDatei(aus, "hooks.log", `${sz(60)}\n`);
  assert.equal((await nur("hinweis", aus)).stufe, "gruen", "Hinweise sind ausgeschaltet");
  assert.match((await nur("hinweis", aus)).text, /ausgeschaltet/);
});

// ---------- 1 Messlatte ----------
test("messlatte: ok=0 → rot „Messlatte verfehlt (73/81)“; im Ziel und frisch → grün", async () => {
  const v = vaultMit();
  logDatei(v, "hint-eval.log", [evalZeile("2026-10-03", "57/61", 0), evalZeile("2026-10-09", "73/81", 0)].join("\n") + "\n");
  let p = await nur("messlatte", v, { jetzt: Date.parse("2026-10-10T03:00:00Z") });
  assert.equal(p.stufe, "rot");
  assert.deepEqual(kurzListe(p), ["Messlatte verfehlt (73/81)"]);
  assert.match(p.text, /09\.10\.: Treffer 73\/81.*verfehlt \(ok=0\)/);
  logDatei(v, "hint-eval.log", evalZeile("2026-10-21", "80/92", 1) + "\n");
  p = await nur("messlatte", v);
  assert.equal(p.stufe, "gruen");
  assert.match(p.text, /im Ziel/);
});

test("messlatte: ok=1, aber mehr Fehlschläge als der letzte bestandene Lauf → gelb; ein verfehlter Lauf dazwischen ist keine Latte (eval-regel.mjs)", async () => {
  const v = vaultMit();
  logDatei(v, "hint-eval.log", [evalZeile("2026-10-19", "80/81", 1), evalZeile("2026-10-20", "60/81", 0), evalZeile("2026-10-21", "75/81", 1)].join("\n") + "\n");
  const p = await nur("messlatte", v);
  assert.equal(p.stufe, "gelb");
  assert.deepEqual(kurzListe(p), ["Messlatte schlechter als zuletzt (75/81 statt 80/81)"]);
  logDatei(v, "hint-eval.log", [evalZeile("2026-10-19", "75/81", 1), evalZeile("2026-10-20", "60/81", 0), evalZeile("2026-10-21", "75/81", 1)].join("\n") + "\n");
  assert.equal((await nur("messlatte", v)).stufe, "gruen", "gleich gut wie der letzte bestandene Lauf");
});

test("messlatte: letzter Lauf älter als 7 Tage → gelb; noch nie gemessen → gelb; Takt „aus“ meldet kein Alter und keine fehlende Messung", async () => {
  const v = vaultMit();
  logDatei(v, "hint-eval.log", evalZeile("2026-10-14", "80/92", 1) + "\n");
  assert.equal((await nur("messlatte", v)).stufe, "gelb", "8 Tage");
  assert.deepEqual(kurzListe(await nur("messlatte", v)), ["Messlatte seit 8 Tagen nicht gelaufen"]);
  logDatei(v, "hint-eval.log", evalZeile("2026-10-15", "80/92", 1) + "\n");
  assert.equal((await nur("messlatte", v)).stufe, "gruen", "genau 7 Tage sind noch in Ordnung");
  const aus = vaultMit({ automatik: { gesundheitMesslatte: "aus" } });
  logDatei(aus, "hint-eval.log", evalZeile("2026-09-01", "80/92", 1) + "\n");
  assert.equal((await nur("messlatte", aus)).stufe, "gruen", "Takt aus: kein Alter-Alarm");
  logDatei(aus, "hint-eval.log", evalZeile("2026-09-01", "70/92", 0) + "\n");
  assert.equal((await nur("messlatte", aus)).stufe, "rot", "…aber ein verfehltes Ergebnis zählt weiter");
  const leer = vaultMit();
  const p = await nur("messlatte", leer);
  assert.deepEqual([p.stufe, kurzListe(p)], ["gelb", ["Messlatte noch nie gemessen (brain messlatte)"]]);
  assert.equal((await nur("messlatte", vaultMit({ automatik: { gesundheitMesslatte: "aus" } }))).stufe, "gruen");
});

test("messlatte: Takt täglich/wöchentlich/aus — wann die Messlatte wirklich läuft; „nein“ misst nie, „ja“ immer; Dauer wird festgehalten", async () => {
  const mitLauf = async (automatik, vorhandenesDatum, modus) => {
    const v = vaultMit({ automatik });
    if (vorhandenesDatum) logDatei(v, "hint-eval.log", evalZeile(vorhandenesDatum, "80/92", 1) + "\n");
    let gerufen = 0;
    const haken = { messlatte: (vault, o) => { gerufen++; assert.equal(vault, v); appendFileSync(join(vault, ".logs", "hint-eval.log"), evalZeile(o.jetzt.toISOString().slice(0, 10), "82/92", 1) + "\n"); } };
    const p = await nur("messlatte", v, { messlatte: modus, haken });
    return { gerufen, p };
  };
  assert.equal((await mitLauf({}, null, "takt")).gerufen, 1, "täglich (Standard), noch nie gemessen");
  assert.equal((await mitLauf({}, "2026-10-21", "takt")).gerufen, 1, "täglich: letzter Lauf gestern");
  assert.equal((await mitLauf({}, "2026-10-22", "takt")).gerufen, 0, "täglich: heute schon gemessen (JETZT = 22.10.)");
  assert.equal((await mitLauf({ gesundheitMesslatte: "woechentlich" }, "2026-10-17", "takt")).gerufen, 0, "wöchentlich: 5 Tage");
  assert.equal((await mitLauf({ gesundheitMesslatte: "woechentlich" }, "2026-10-15", "takt")).gerufen, 1, "wöchentlich: 7 Tage");
  assert.equal((await mitLauf({ gesundheitMesslatte: "aus" }, null, "takt")).gerufen, 0, "aus");
  assert.equal((await mitLauf({}, null, "nein")).gerufen, 0, "CLI ohne --messlatte bewertet nur");
  const ja = await mitLauf({ gesundheitMesslatte: "aus" }, "2026-10-22", "ja");
  assert.equal(ja.gerufen, 1, "--messlatte erzwingt den Lauf, auch bei Takt aus");
  assert.equal(typeof ja.p.daten.dauerMs, "number");
  assert.match(ja.p.text, /jetzt gemessen in \d+,\d s/);
  assert.match(ja.p.text, /22\.10\.: Treffer 82\/92/, "bewertet wird das frische Ergebnis");
});

test("messlatte: wirft das Messen, steht „lief nicht“ als Warnung — das vorhandene Ergebnis wird trotzdem bewertet; unter node --test startet ohne Haken nichts Echtes", async () => {
  const v = vaultMit();
  logDatei(v, "hint-eval.log", evalZeile("2026-10-09", "73/81", 0) + "\n");
  const p = await nur("messlatte", v, { messlatte: "takt", haken: { messlatte: () => { throw new Error("Hook kaputt"); } } });
  assert.equal(p.stufe, "rot");
  assert.deepEqual(kurzListe(p), ["Messlatte lief nicht (Hook kaputt)", "Messlatte verfehlt (73/81)", "Messlatte seit 13 Tagen nicht gelaufen"]);
  const ohne = vaultMit();
  const q = await nur("messlatte", ohne, { messlatte: "ja" });   // kein Haken, NODE_TEST_CONTEXT gesetzt → kein echter Lauf
  assert.equal(q.daten.gelaufen, false);
  assert.equal(existsSync(join(ohne, ".logs", "hint-eval.log")), false);
});

// ---------- 3 Suchindex ----------
// Attrappe der SQLite-Schnittstelle (get/alle/close) — die echte SQL-Abfrage prüft der Test mit node:sqlite weiter unten.
const fakeDb = ({ docs = [{ collection: "brain", n: 50 }, { collection: "brainkarten", n: 10 }], vektoren = 100, verwaist = 10, spaet = isoZ(JETZT - STUNDE), dokMax = isoZ(JETZT - STUNDE) } = {}) => () => ({
  alle: (sql) => { assert.match(sql, /FROM documents WHERE active = 1 GROUP BY collection/); return docs; },
  get: (sql) => {
    if (/NOT EXISTS/.test(sql)) return { n: verwaist };
    if (/FROM content_vectors/.test(sql)) return { n: vektoren, spaet };
    if (/FROM documents/.test(sql)) return { m: dokMax };
    throw new Error(`unbekannte Abfrage: ${sql}`);
  },
  close: () => {},
});
const indexVault = (opt = {}) => { const v = vaultMit(opt); const db = join(v, "index.sqlite"); writeFileSync(db, "x"); return { v, db }; };

test("index: verwaiste Vektoren — bis 50 % grün, darüber gelb mit dem Befehl zum Aufräumen (der nie von selbst läuft)", async () => {
  const { v, db } = indexVault();
  let p = await nur("index", v, { haken: { dbPfad: db, oeffneDb: fakeDb({ vektoren: 100, verwaist: 50 }) } });
  assert.equal(p.stufe, "gruen", "genau 50 % ist nicht „mehr als die Hälfte“");
  assert.match(p.text, /100 Vektoren, davon 50 verwaist \(50 %\) · 60 aktive Dokumente \(10 Karten\)/);
  p = await nur("index", v, { haken: { dbPfad: db, oeffneDb: fakeDb({ vektoren: 8690, verwaist: 6915 }) } });
  assert.equal(p.stufe, "gelb");
  assert.deepEqual(kurzListe(p), ["80 % der Vektoren verwaist (qmd cleanup)"]);
  assert.match(p.text, /Aufräumen täte: qmd cleanup \(entfernt 6915 verwaiste Vektoren, nie automatisch\)/);
  assert.deepEqual([p.daten.vektoren, p.daten.verwaist, p.daten.dokumente, p.daten.karten], [8690, 6915, 60, 10]);
  assert.equal((await nur("index", v, { haken: { dbPfad: db, oeffneDb: fakeDb({ vektoren: 0, verwaist: 0 }) } })).stufe, "gruen", "leerer Index: keine Division durch 0");
});

test("index: Karten-Sammlung folgt der Config (hinweis.collection); Index älter als neueste Wiki-Änderung + 24 h → gelb", async () => {
  const { v, db } = indexVault({ hinweis: { collection: "meinekarten" } });
  const wiki = join(v, "09_wiki", "thema.md");
  writeFileSync(wiki, "# T\n");
  const setzeWiki = (ms) => utimesSync(wiki, ms / 1000, ms / 1000);
  const haken = (indexMs) => ({ dbPfad: db, oeffneDb: fakeDb({ docs: [{ collection: "meinekarten", n: 7 }], spaet: isoZ(indexMs), dokMax: isoZ(indexMs) }) });
  setzeWiki(JETZT);
  let p = await nur("index", v, { haken: haken(JETZT - 30 * STUNDE) });
  assert.equal(p.daten.karten, 7);
  assert.equal(p.stufe, "gelb");
  assert.deepEqual(kurzListe(p), ["Suchindex 1 Tage älter als das Wiki (brain refresh)"]);
  assert.equal((await nur("index", v, { haken: haken(JETZT - 23 * STUNDE) })).stufe, "gruen", "23 h Verzug sind in Ordnung");
  // Der Erfolgsstempel des Refresh zählt als Lebenszeichen: frischer Stempel → kein Alarm, obwohl die DB-Zeiten alt sind
  writeFileSync(join(v, ".logs", "search-refreshed"), "");
  utimesSync(join(v, ".logs", "search-refreshed"), JETZT / 1000, JETZT / 1000);
  assert.equal((await nur("index", v, { haken: haken(JETZT - 30 * STUNDE) })).stufe, "gruen");
  // Kein Wiki-Inhalt → nichts zu vergleichen
  const leer = indexVault();
  assert.equal((await nur("index", leer.v, { haken: { dbPfad: leer.db, oeffneDb: fakeDb({ spaet: isoZ(JETZT - 90 * STUNDE), dokMax: isoZ(JETZT - 90 * STUNDE) }) } })).stufe, "gruen");
});

test("index: Datei fehlt → rot; Profil „minimal“ → grün ohne Index; kein SQLite-Zugriff → Fehlergrenze (gelb), nie ein Absturz", async () => {
  const v = vaultMit();
  const p = await nur("index", v, { haken: { dbPfad: join(v, "fehlt.sqlite") } });
  assert.equal(p.stufe, "rot");
  assert.deepEqual(kurzListe(p), ["Suchindex fehlt (brain refresh)"]);
  const min = vaultMit({ suche: { profil: "minimal" } });
  assert.equal((await nur("index", min, { haken: { dbPfad: join(min, "fehlt.sqlite") } })).stufe, "gruen");
  const { v: v2, db } = indexVault();
  const g = await G.gesundheit(v2, { jetzt: JETZT, haken: { pruefungen: Object.fromEntries(ALLE.filter((x) => x !== "index").map((x) => [x, gruen])),
    dbPfad: db, oeffneDb: () => { throw new Error("kein lesender SQLite-Zugriff möglich"); } } });
  const q = g.pruefungen.find((x) => x.id === "index");
  assert.equal(q.stufe, "gelb");
  assert.match(q.befunde[0].kurz, /^Prüfung Suchindex lief nicht: kein lesender SQLite-Zugriff/);
});

let DatabaseSync = null;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch {}
test("index: echte SQLite-Datei mit qmd-Schema — gleiche Zählung wie qmd cleanup, die Datei bleibt byte- und ordnergleich (rein lesend)", { skip: !DatabaseSync && "node:sqlite fehlt (Node < 22.5)" }, async () => {
  const v = vaultMit();
  const dir = tempOrdner("qmd");
  const db = join(dir, "index.sqlite");
  const d = new DatabaseSync(db);
  d.exec(`CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, collection TEXT NOT NULL, path TEXT NOT NULL, title TEXT NOT NULL, hash TEXT NOT NULL,
    created_at TEXT NOT NULL, modified_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE content_vectors (hash TEXT NOT NULL, seq INTEGER NOT NULL DEFAULT 0, pos INTEGER NOT NULL DEFAULT 0, model TEXT NOT NULL, embedded_at TEXT NOT NULL, PRIMARY KEY (hash, seq));`);
  const doc = d.prepare("INSERT INTO documents (collection, path, title, hash, created_at, modified_at, active) VALUES (?, ?, 't', ?, ?, ?, ?)");
  const vek = d.prepare("INSERT INTO content_vectors (hash, seq, model, embedded_at) VALUES (?, ?, 'm', ?)");
  const t = (h) => isoZ(JETZT - h * STUNDE);
  doc.run("brain", "a.md", "h1", t(5), t(5), 1);          // aktiv, hat 2 Vektoren
  doc.run("brainkarten", "k.md", "h2", t(4), t(3), 1);    // aktiv, 1 Vektor
  doc.run("brainkarten", "alt.md", "h3", t(9), t(9), 0);   // inaktiv → seine Vektoren sind verwaist
  vek.run("h1", 0, t(5)); vek.run("h1", 1, t(5)); vek.run("h2", 0, t(2));
  vek.run("h3", 0, t(9)); vek.run("h9", 0, t(9)); vek.run("h9", 1, t(9));   // h3 inaktiv, h9 ohne Dokument
  d.close();
  const vorher = (() => { const h = createHash("sha256").update(readFileSync(db)).digest("hex"); return `${h}|${readdirSync(dir).sort().join(",")}`; })();
  const p = await nur("index", v, { haken: { dbPfad: db } });
  assert.deepEqual([p.daten.vektoren, p.daten.verwaist, p.daten.dokumente, p.daten.karten], [6, 3, 2, 1], "h3 (inaktives Dokument) und h9 (kein Dokument) sind verwaist, h1/h2 nicht");
  assert.equal(p.stufe, "gruen", "3 von 6 = genau 50 %");
  const nachher = (() => { const h = createHash("sha256").update(readFileSync(db)).digest("hex"); return `${h}|${readdirSync(dir).sort().join(",")}`; })();
  assert.equal(nachher, vorher, "nur gelesen: Inhalt unverändert, keine -wal/-shm/-journal-Dateien dazugekommen");
  // Ein Vektor mehr ohne Dokument → über der Hälfte
  const d2 = new DatabaseSync(db);
  d2.prepare("INSERT INTO content_vectors (hash, seq, model, embedded_at) VALUES ('h10', 0, 'm', ?)").run(t(1));
  d2.close();
  const q = await nur("index", v, { haken: { dbPfad: db } });
  assert.deepEqual([q.stufe, q.daten.verwaist, q.daten.vektoren], ["gelb", 4, 7]);
});

// ---------- 4 Suchdienst ----------
const DIENST_CFG = { hinweis: { rerankSchwelle: 0.55 } };
const dienstLogZeile = (vor, was) => `${iso(JETZT - vor * 1000)} suchdienst ${was}`;
const fehlerCode = (code) => async () => { throw Object.assign(new Error("Suchdienst"), { code }); };
const dienstHaken = (frage, extra = {}) => ({ frageDienst: frage, istGesperrt: () => false, pidLebt: () => false, ...extra });

test("dienst: nicht eingeschaltet (kein rerankSchwelle) → grün, es wird gar nicht gefragt", async () => {
  const v = vaultMit();
  let gefragt = 0;
  const p = await nur("dienst", v, { haken: dienstHaken(async () => { gefragt++; return []; }) });
  assert.equal(p.stufe, "gruen");
  assert.match(p.text, /nicht eingeschaltet/);
  assert.equal(gefragt, 0);
});

test("dienst: antwortet → grün; wärmt auf → grün; Hänger, Socket-Pfad zu lang, Fehlercode, Sperre → gelb", async () => {
  const v = vaultMit(DIENST_CFG);
  let p = await nur("dienst", v, { haken: dienstHaken(async (vault, payload, opt) => { assert.equal(payload.query, "aufwärmen"); assert.ok(opt.antwortMs <= 2500); return []; }) });
  assert.deepEqual([p.stufe, /antwortet \(\d+ ms\)/.test(p.text)], ["gruen", true]);
  assert.equal((await nur("dienst", v, { haken: dienstHaken(fehlerCode("EWARM")) })).stufe, "gruen");
  p = await nur("dienst", v, { haken: dienstHaken(fehlerCode("ETIMEDOUT")) });
  assert.deepEqual([p.stufe, kurzListe(p)], ["gelb", ["Suchdienst antwortet nicht (Hänger)"]]);
  assert.deepEqual(kurzListe(await nur("dienst", v, { haken: dienstHaken(fehlerCode("ESOCKPFAD")) })), ["Suchdienst: Socket-Pfad zu lang"]);
  assert.deepEqual(kurzListe(await nur("dienst", v, { haken: dienstHaken(fehlerCode("EQMD")) })), ["Suchdienst-Fehler EQMD"]);
  p = await nur("dienst", v, { haken: dienstHaken(async () => [], { istGesperrt: () => true }) });
  assert.deepEqual([p.stufe, kurzListe(p)], ["gelb", ["Suchdienst nach Hänger gesperrt (10 min)"]]);
});

test("dienst: nicht erreichbar — nie gestartet und sauber beendet (ende-Zeile) ist grün; Start ohne ende-Zeile und toter Prozess → gelb", async () => {
  const v = vaultMit(DIENST_CFG);
  const haken = dienstHaken(fehlerCode("EDIENST"));
  assert.equal((await nur("dienst", v, { haken })).stufe, "gruen", "kein hooks.log");
  logDatei(v, "hooks.log", `--- 2026-10-22 session-start\n${dienstLogZeile(9000, "start pid=111 warm")}\n${dienstLogZeile(5000, "ende grund=leerlauf")}\n`);
  let p = await nur("dienst", v, { haken });
  assert.deepEqual([p.stufe, /ruht \(zuletzt beendet .*Grund leerlauf\)/.test(p.text)], ["gruen", true]);
  logDatei(v, "hooks.log", `${dienstLogZeile(9000, "start pid=111 warm")}\n${dienstLogZeile(5000, "ende grund=sigterm")}\n${dienstLogZeile(3000, "start pid=222 warm")}\n`);
  p = await nur("dienst", v, { haken });
  assert.deepEqual([p.stufe, kurzListe(p)], ["gelb", ["Suchdienst endete ohne ende-Zeile (Absturz?)"]]);
  assert.match(p.text, /Prozess 222 weg/);
  p = await nur("dienst", v, { haken: dienstHaken(fehlerCode("EDIENST"), { pidLebt: (pid) => pid === 222 }) });
  assert.deepEqual(kurzListe(p), ["Suchdienst-Prozess läuft, Socket antwortet nicht"], "Prozess lebt noch, der Socket schweigt");
  logDatei(v, "hooks.log", `${dienstLogZeile(3000, "start pid=222 warm")}\n${dienstLogZeile(2000, "ende grund=sigterm")}\n${dienstLogZeile(1000, "start pid=333 aufwaermen-fehler=EQMD")}\n`);
  assert.equal(kurzListe(await nur("dienst", v, { haken })).length, 1, "die LETZTE Zeile entscheidet");
});

test("dienst: echter Unix-Socket — ein kleiner Fake-Dienst antwortet, dienst-client.mjs wird wirklich benutzt", async (t) => {
  const net = await import("node:net");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const v = mkdtempSync(join(tmpdir(), "bg-")) + "/v";
  mkdirSync(join(v, ".logs"), { recursive: true });
  writeFileSync(join(v, "brain.config.json"), JSON.stringify(DIENST_CFG));
  const sock = join(v, ".logs", "suchdienst.sock");
  if (Buffer.byteLength(sock) > 100) return t.skip("Socket-Pfad zu lang für diese Temp-Umgebung");
  const server = net.createServer((c) => { c.on("data", () => c.end(JSON.stringify({ ok: true, results: [] }) + "\n")); });
  await new Promise((ja) => server.listen(sock, ja));
  try {
    const p = await G.gesundheit(v, { jetzt: JETZT, haken: { pruefungen: Object.fromEntries(ALLE.filter((x) => x !== "dienst").map((x) => [x, gruen])) } });
    const d = p.pruefungen.find((x) => x.id === "dienst");
    assert.deepEqual([d.stufe, /antwortet \(\d+ ms\)/.test(d.text)], ["gruen", true], d.text);
  } finally { await new Promise((ja) => server.close(ja)); }
  const danach = await G.gesundheit(v, { jetzt: JETZT, haken: { pruefungen: Object.fromEntries(ALLE.filter((x) => x !== "dienst").map((x) => [x, gruen])) } });
  assert.match(danach.pruefungen.find((x) => x.id === "dienst").text, /läuft nicht|ruht/, "Server weg → nicht erreichbar, kein Absturz");
});

// ---------- 5 Rückstand ----------
const KASTEN = "> [!KONFLIKT] offen — Du entscheidest\n> A: \"eins\" — Quelle: [[qa]]\n> B: \"zwei\" — Quelle: [[qb]]\n";
function rueckstandVault(schwellen, { fakten = 3, lektionen = 2, inbox = 2, konflikte = 1 } = {}) {
  const v = vaultMit({ automatik: schwellen });
  for (let i = 0; i < fakten; i++) legeVorschlagAn(v, { id: `f${i}`, titel: `Fakt ${i}` });
  for (let i = 0; i < lektionen; i++) legeVorschlagAn(v, { id: `l${i}`, art: "lektion", titel: `Lektion ${i}` });
  for (let i = 0; i < inbox; i++) { mkdirSync(join(v, "00_inbox"), { recursive: true }); writeFileSync(join(v, "00_inbox", `n${i}.md`), "# n\n"); }
  mkdirSync(join(v, "00_inbox", "_rueckfragen"), { recursive: true });
  writeFileSync(join(v, "00_inbox", "_rueckfragen", "q.md"), "# keine Inbox-Quelle\n");   // Systemordner zählt nicht
  for (let i = 0; i < konflikte; i++) writeFileSync(join(v, "09_wiki", `seite${i}.md`), `# S${i}\n\n${KASTEN}`);
  return v;
}

test("rueckstand: Zahlen wie beim Sitzungsstart (Vorschläge ohne Lektionen, Inbox ohne Systemordner) — ab der Schwelle gelb, darunter grün", async () => {
  const v = rueckstandVault({ gesundheitVorschlaege: 3, gesundheitLektionen: 2, gesundheitInbox: 2, gesundheitKonflikte: 1 });
  let p = await nur("rueckstand", v);
  assert.deepEqual([p.daten.vorschlaege, p.daten.lektionen, p.daten.inbox, p.daten.konflikte], [3, 2, 2, 1]);
  assert.equal(p.stufe, "gelb");
  assert.deepEqual(kurzListe(p), ["3 Vorschläge warten", "2 Lektionen warten", "2 Inbox-Dateien warten", "Konflikte auf 1 Seite(n)"], "„ab“ heißt: die Schwelle selbst warnt schon");
  p = await nur("rueckstand", rueckstandVault({ gesundheitVorschlaege: 4, gesundheitLektionen: 3, gesundheitInbox: 3, gesundheitKonflikte: 2 }));
  assert.deepEqual([p.stufe, p.befunde.length], ["gruen", 0], "eins unter jeder Schwelle");
  assert.match(p.text, /Vorschläge 3 \(ab 4\) · Lektionen 2 \(ab 3\) · Inbox-Dateien 2 \(ab 3\) · Konflikte auf Seiten 1 \(ab 2\)/);
});

test("rueckstand: Standard-Schwellen 200/30/15/1; Schwelle 0 = nie warnen; entschiedene Konflikte zählen nicht", async () => {
  const klein = rueckstandVault({}, { fakten: 199, lektionen: 29, inbox: 14, konflikte: 0 });
  assert.equal((await nur("rueckstand", klein)).stufe, "gruen", "eins unter den Standard-Schwellen");
  const voll = rueckstandVault({}, { fakten: 200, lektionen: 30, inbox: 15, konflikte: 1 });
  assert.equal((await nur("rueckstand", voll)).befunde.length, 4, "genau auf den Standard-Schwellen");
  const nie = rueckstandVault({ gesundheitVorschlaege: 0, gesundheitLektionen: 0, gesundheitInbox: 0, gesundheitKonflikte: 0 }, { fakten: 500, lektionen: 99, inbox: 99, konflikte: 3 });
  const p = await nur("rueckstand", nie);
  assert.deepEqual([p.stufe, p.daten.vorschlaege, p.daten.konflikte], ["gruen", 500, 3]);
  assert.match(p.text, /\(nie warnen\)/);
});

// ---------- Fehlergrenze ----------
test("Fehlergrenze: wirft eine Prüfung, steht „Prüfung X lief nicht: …“ als Warnung da und die übrigen vier laufen weiter", async () => {
  const v = vaultMit();
  const gelaufen = [];
  const merke = (id) => () => { gelaufen.push(id); return gruen(); };
  const g = await G.gesundheit(v, { jetzt: JETZT, haken: { pruefungen: {
    messlatte: merke("messlatte"), hinweis: () => { throw new Error("hint.log unlesbar\nzweite Zeile"); }, index: merke("index"),
    dienst: async () => { throw Object.assign(new Error("Socket weg"), { code: "EX" }); }, rueckstand: merke("rueckstand"),
  } } });
  assert.deepEqual(gelaufen, ["messlatte", "index", "rueckstand"]);
  assert.equal(g.pruefungen.length, 5);
  assert.equal(g.warnungen, 2);
  assert.equal(g.ampel, "gelb");
  const h = g.pruefungen.find((p) => p.id === "hinweis");
  assert.deepEqual([h.stufe, h.befunde[0].kurz, h.text], ["gelb", "Prüfung Hinweis-Wege lief nicht: hint.log unlesbar zweite Zeile", "lief nicht: hint.log unlesbar zweite Zeile"]);
  assert.equal(g.pruefungen.find((p) => p.id === "dienst").befunde[0].kurz, "Prüfung Suchdienst lief nicht: Socket weg");
  // Ein Ergebnis ohne befunde-Liste ist auch ein Fehler der Prüfung, kein Absturz
  const k = await G.gesundheit(v, { jetzt: JETZT, haken: { pruefungen: { ...Object.fromEntries(ALLE.map((x) => [x, gruen])), index: () => ({ text: "x" }) } } });
  assert.equal(k.warnungen, 1);
  assert.match(k.pruefungen.find((p) => p.id === "index").befunde[0].kurz, /^Prüfung Suchindex lief nicht/);
});

test("gesundheit: Texte mit Zugangsdaten-Mustern gelangen nie in den Stand (Fehlertext einer Prüfung), das JSON bleibt gültig", async () => {
  const v = vaultMit();
  const g = await G.gesundheit(v, { jetzt: JETZT, haken: { pruefungen: { ...Object.fromEntries(ALLE.map((x) => [x, gruen])),
    // Das Muster wird erst zur Laufzeit zusammengesetzt: der Quelltext selbst darf für die Veröffentlichungs-Prüfung kein Secret enthalten.
    dienst: () => { throw new Error(["Verbindung mit", "api" + "_key=" + "abcdef0123456789abcdef", "scheiterte"].join(" ")); } } } });
  G.schreibeGesundheit(v, g);
  const roh = readFileSync(join(v, ".logs", "tageslauf", "gesundheit.json"), "utf8");
  assert.doesNotMatch(roh, /abcdef0123456789/);
  assert.match(JSON.parse(roh).pruefungen.find((p) => p.id === "dienst").befunde[0].kurz, /Zugangsdaten entfernt/);
});

test("gesundheit: jede Prüfung ist schnell, die Gesamtampel ist die schlimmste Stufe, Zahl der Warnungen zählt Befunde", async () => {
  const v = vaultMit();
  const g = await G.gesundheit(v, { jetzt: JETZT, haken: { pruefungen: {
    messlatte: () => ({ text: "m", befunde: [{ stufe: "rot", kurz: "a" }, { stufe: "gelb", kurz: "b" }], daten: {} }),
    hinweis: gruen, index: () => ({ text: "i", befunde: [{ stufe: "gelb", kurz: "c" }] }), dienst: gruen, rueckstand: gruen } } });
  assert.deepEqual([g.ampel, g.warnungen, g.version], ["rot", 3, 1]);
  assert.deepEqual(g.pruefungen.map((p) => p.stufe), ["rot", "gruen", "gelb", "gruen", "gruen"]);
  assert.ok(g.pruefungen.every((p) => typeof p.ms === "number"));
  assert.equal(g.zeit, new Date(JETZT).toISOString());
});

// ---------- Startzeile ----------
const stand = (befunde, zeit = new Date(JETZT).toISOString()) => ({ version: 1, zeit, ampel: befunde.length ? "gelb" : "gruen", warnungen: befunde.length,
  pruefungen: [{ id: "x", name: "X", stufe: befunde.length ? "gelb" : "gruen", text: "t", befunde, daten: {}, ms: 1 }] });
const b = (stufe, kurz) => ({ stufe, kurz });

test("gesundheitsZeile: nur bei Warnungen, genau eine Zeile im Format der Spec, rote zuerst", () => {
  const v = vaultMit();
  assert.equal(G.gesundheitsZeile(v, { jetzt: JETZT }), null, "noch kein Stand");
  G.schreibeGesundheit(v, stand([]));
  assert.equal(G.gesundheitsZeile(v, { jetzt: JETZT }), null, "grün: nichts (Kontext sparen)");
  G.schreibeGesundheit(v, stand([b("gelb", "Doppelaufrufe"), b("rot", "Messlatte verfehlt (73/81)"), b("rot", "Weg dienst-vektor 0 Treffer/24 h")]));
  const z = G.gesundheitsZeile(v, { jetzt: JETZT });
  assert.equal(z, "Kortex-Gesundheit: ⚠ 3 — Messlatte verfehlt (73/81) · Weg dienst-vektor 0 Treffer/24 h · Doppelaufrufe — Details: brain gesundheit");
  assert.ok(!z.includes("\n"));
});

test("gesundheitsZeile: lange Listen werden gekürzt („+N weitere“), Schalter aus → nichts, alter Stand nennt das Datum, kaputte Datei → null", () => {
  const v = vaultMit();
  G.schreibeGesundheit(v, stand(Array.from({ length: 12 }, (_, i) => b("gelb", `Befund Nummer ${i} mit etwas längerem Text`))));
  const z = G.gesundheitsZeile(v, { jetzt: JETZT });
  assert.match(z, /^Kortex-Gesundheit: ⚠ 12 — Befund Nummer 0 /);
  assert.match(z, / · \+\d+ weitere — Details: brain gesundheit$/);
  assert.ok(z.length < 420 && !z.includes("\n"), String(z.length));
  const aus = vaultMit({ automatik: { gesundheit: false } });
  G.schreibeGesundheit(aus, stand([b("rot", "kaputt")]));
  assert.equal(G.gesundheitsZeile(aus, { jetzt: JETZT }), null);
  const alt = vaultMit();
  G.schreibeGesundheit(alt, stand([b("gelb", "Doppelaufrufe")], new Date(JETZT - 2 * TAG).toISOString()));
  assert.match(G.gesundheitsZeile(alt, { jetzt: JETZT }), /Doppelaufrufe \(Stand 20\.10\.\) — Details/);
  writeFileSync(join(alt, ".logs", "tageslauf", "gesundheit.json"), "{kaputt");
  assert.equal(G.gesundheitsZeile(alt, { jetzt: JETZT }), null);
});

test("gesundheitsZeile: der Wächter, der nicht mehr wacht, ist selbst eine Warnung (Stand > 3 Tage, Tageslauf nicht aus) — bei Tageslauf aus nicht", () => {
  const stalt = stand([], new Date(JETZT - 4 * TAG).toISOString());
  const v = vaultMit({ automatik: { tageslauf: "an" } });
  G.schreibeGesundheit(v, stalt);
  assert.equal(G.gesundheitsZeile(v, { jetzt: JETZT }), "Kortex-Gesundheit: ⚠ 1 — Prüfung seit 4 Tagen nicht gelaufen (Tageslauf prüfen; von Hand: brain gesundheit)");
  const aus = vaultMit({ automatik: { tageslauf: "aus" } });
  G.schreibeGesundheit(aus, stalt);
  assert.equal(G.gesundheitsZeile(aus, { jetzt: JETZT }), null);
  const probe = vaultMit();   // Standard tageslauf: probe → läuft auch
  G.schreibeGesundheit(probe, stalt);
  assert.match(G.gesundheitsZeile(probe, { jetzt: JETZT }), /seit 4 Tagen nicht gelaufen/);
});

const start = (v, source = "startup") => hook("session-start.mjs", { session_id: "s", source, cwd: v }, { vault: v, env: { BRAIN_SESSION_NUR_STATUS: "1" } }).stdout;

test("Sitzungsstart: genau eine Gesundheits-Zeile bei Warnung; bei Grün, ausgeschaltet und nach Kompaktierung nichts", () => {
  const v = vaultMit();
  assert.doesNotMatch(start(v), /Kortex-Gesundheit/, "kein Stand");
  G.schreibeGesundheit(v, stand([], new Date().toISOString()));   // frischer Stand: der Test hing sonst an der echten Uhr (JETZT = 22.10.)
  assert.doesNotMatch(start(v), /Kortex-Gesundheit/, "grün");
  G.schreibeGesundheit(v, stand([b("rot", "Messlatte verfehlt (73/81)"), b("gelb", "Doppelaufrufe")], new Date().toISOString()));
  const aus = start(v);
  assert.equal(aus.split("\n").filter((z) => z.startsWith("Kortex-Gesundheit")).length, 1);
  assert.match(aus, /^Kortex-Gesundheit: ⚠ 2 — Messlatte verfehlt \(73\/81\) · Doppelaufrufe — Details: brain gesundheit$/m);
  assert.doesNotMatch(start(v, "compact"), /Kortex-Gesundheit/, "nach einer Kompaktierung nicht noch einmal");
  const abgeschaltet = vaultMit({ automatik: { gesundheit: false } });
  G.schreibeGesundheit(abgeschaltet, stand([b("rot", "x")], new Date().toISOString()));
  assert.doesNotMatch(start(abgeschaltet), /Kortex-Gesundheit/);
});

test("N6: session-start schreibt die Quelle in hooks.log (session-start source=…); der Wächter zählt nur source=startup — alte Zeilen ohne Quelle gelten wie bisher als Start", () => {
  const v = vaultMit();
  for (const [sid, source] of [["a", "startup"], ["b", "resume"], ["c", "clear"], ["d", "compact"], ["e", "x; rm -rf"]]) hook("session-start.mjs", { session_id: sid, source, cwd: v }, { vault: v, env: { BRAIN_SESSION_NUR_STATUS: "1" } });
  const log = readFileSync(join(v, ".logs", "hooks.log"), "utf8");
  const quellen = log.split("\n").filter((z) => /^--- \S+ \S+ session-start/.test(z)).map((z) => /source=(\S+)$/.exec(z)?.[1]);
  assert.deepEqual(quellen.sort(), ["andere", "clear", "compact", "resume", "startup"], "jede Zeile trägt die Quelle; Unbekanntes bereinigt");
  assert.equal(G.zaehleSitzungsstarts(log, { jetzt: Date.now() }), 1, "nur der echte Start zählt");
  // alte Zeilen ohne Quelle zählen wie bisher, gemischt mit neuen
  const gemischt = `${sz(7200)}\n${sz(3600)} source=resume\n${sz(60)} source=startup\n${sz(30)} source=compact\n`;
  assert.equal(G.zaehleSitzungsstarts(gemischt, { jetzt: JETZT }), 2);
});

test("Sitzungsstart: die Inbox-Zeile bleibt unverändert (Zählung jetzt aus vault-dateien.mjs, Systemordner zählen nicht)", () => {
  const v = vaultMit();
  mkdirSync(join(v, "00_inbox", "_vorschlaege"), { recursive: true });
  mkdirSync(join(v, "00_inbox", "_rueckfragen"), { recursive: true });
  mkdirSync(join(v, "00_inbox", "unter"), { recursive: true });
  writeFileSync(join(v, "00_inbox", "a.md"), "# a\n");
  writeFileSync(join(v, "00_inbox", "unter", "b.md"), "# b\n");
  writeFileSync(join(v, "00_inbox", "_rueckfragen", "q.md"), "# q\n");
  writeFileSync(join(v, "00_inbox", ".versteckt"), "x");
  assert.match(start(v), /^Kortex-Inbox: 2 Datei\(en\) warten auf \/ingest\.$/m);
});

// ---------- Tageslauf ----------
const messHaken = (zaehler) => (vault, o) => {
  zaehler.n++;
  mkdirSync(join(vault, ".logs"), { recursive: true });
  appendFileSync(join(vault, ".logs", "hint-eval.log"), evalZeile(o.jetzt.toISOString().slice(0, 10), "80/92", 1) + "\n");
};
const lauf = (v, opt = {}) => tageslauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT, ...opt });
const TL = (v, name) => join(v, ".logs", "tageslauf", name);

test("Tageslauf: ein Abschnitt „### Gesundheit“ mit allen fünf Prüfungen, Messlatte nach Takt gelaufen, Stand und letzter.json geschrieben, Lauf bleibt „ok“", async () => {
  fakeKi([]);
  const v = neuerTestVault({ automatik: { tageslauf: "an", einschwingen: 0 } });
  const z = { n: 0 };
  const r = await lauf(v, { haken: { gesundheit: { messlatte: messHaken(z), pruefungen: { index: () => ({ text: "x", befunde: [b("gelb", "80 % der Vektoren verwaist (qmd cleanup)")], daten: {} }) } } } });
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.equal(z.n, 1, "Standardtakt täglich: einmal gemessen");
  const bericht = readFileSync(join(v, r.bericht), "utf8");
  const abschnitt = bericht.split("### Gesundheit\n")[1].split("\n###")[0].trim().split("\n");
  assert.equal(abschnitt.length, 6, abschnitt.join("\n"));
  assert.match(abschnitt[0], /^- 🟡 Gesamt gelb: 1 Warnung$/);
  assert.deepEqual(abschnitt.slice(1).map((x) => x.match(/· ([^—]+) —/)[1].trim()), ["Messlatte", "Hinweis-Wege", "Suchindex", "Suchdienst", "Rückstand"]);
  assert.match(abschnitt[3], /^- 🟡 gelb · Suchindex — x ⇒ 80 % der Vektoren verwaist \(qmd cleanup\)$/);
  assert.match(abschnitt[1], /^- 🟢 grün · Messlatte — 22\.10\.: Treffer 80\/92.*im Ziel.*jetzt gemessen in \d,\d s/);
  assert.match(bericht, /### Gesundheit[\s\S]*### Fehler/, "vor dem Fehler-Abschnitt");
  const g = JSON.parse(readFileSync(TL(v, "gesundheit.json"), "utf8"));
  assert.deepEqual([g.ampel, g.warnungen, g.pruefungen.length], ["gelb", 1, 5]);
  assert.deepEqual(P.leseLetzter(v).gesundheit, { zeit: g.zeit, ampel: "gelb", warnungen: 1 });
  assert.match(G.gesundheitsZeile(v, { jetzt: JETZT }), /^Kortex-Gesundheit: ⚠ 1 — 80 % der Vektoren verwaist \(qmd cleanup\)/);
  // zweiter Lauf am selben Tag: die Messlatte ist heute schon gelaufen
  await lauf(v, { jetzt: JETZT + 3600e3, haken: { gesundheit: { messlatte: messHaken(z) } } });
  assert.equal(z.n, 1);
});

test("Tageslauf: wirft eine Gesundheits-Prüfung, bleibt der Lauf „ok“ (kein „teilweise“) und der Bericht nennt es", async () => {
  fakeKi([]);
  const v = neuerTestVault({ automatik: { tageslauf: "an", einschwingen: 0 } });
  const r = await lauf(v, { haken: { gesundheit: { messlatte: messHaken({ n: 0 }), pruefungen: { hinweis: () => { throw new Error("kaputt"); } } } } });
  assert.equal(r.status, "ok");
  assert.equal(P.leseLetzter(v).status, "ok");
  assert.match(readFileSync(join(v, r.bericht), "utf8"), /🟡 gelb · Hinweis-Wege — lief nicht: kaputt ⇒ Prüfung Hinweis-Wege lief nicht: kaputt/);
});

test("Tageslauf: Schalter gesundheit aus → kein Abschnitt, kein Stand, nichts gemessen; „nur Antworten“ prüft nicht", async () => {
  fakeKi([]);
  const z = { n: 0 };
  const haken = { gesundheit: { messlatte: messHaken(z) } };
  const aus = neuerTestVault({ automatik: { tageslauf: "an", einschwingen: 0, gesundheit: false } });
  const r = await lauf(aus, { haken });
  assert.equal(r.status, "ok");
  assert.doesNotMatch(readFileSync(join(aus, r.bericht), "utf8"), /### Gesundheit/);
  assert.equal(existsSync(TL(aus, "gesundheit.json")), false);
  assert.equal("gesundheit" in P.leseLetzter(aus), false);
  const antworten = neuerTestVault({ automatik: { tageslauf: "an", einschwingen: 0 } });
  const r2 = await lauf(antworten, { nurAntworten: true, haken });
  assert.doesNotMatch(readFileSync(join(antworten, r2.bericht), "utf8"), /### Gesundheit/);
  assert.equal(existsSync(TL(antworten, "gesundheit.json")), false);
  assert.equal(z.n, 0);
});

test("Tageslauf im Probemodus: der Wächter läuft trotzdem (nur Logs/Stand, nichts im Wiki), Bericht „…-probe.md“", async () => {
  fakeKi([]);
  const v = neuerTestVault({ automatik: {} });   // Standard tageslauf: probe
  const r = await lauf(v, { haken: { gesundheit: { messlatte: messHaken({ n: 0 }) } } });
  assert.equal(r.modus, "probe");
  assert.match(r.bericht, /-probe\.md$/);
  assert.match(readFileSync(join(v, r.bericht), "utf8"), /### Gesundheit/);
  assert.ok(existsSync(TL(v, "gesundheit.json")));
});

// ---------- CLI ----------
const cli = (v, ...args) => spawnSync(process.execPath, [join(KIT, "tageslauf", "gesundheit.mjs"), v, ...args], { encoding: "utf8", env: { ...process.env, BRAIN_VAULT: "" } });

test("CLI: --json/--trocken speichert nichts, ohne --trocken wird der Stand geschrieben; Exit 0 bei Grün, 2 bei Warnungen, 64 bei unbekannter Angabe", () => {
  // Suchprofil minimal, Hinweise aus, Dienst aus, kein Rückstand → alles grün (ohne echtes qmd)
  const gruenVault = vaultMit({ automatik: { hinweise: "aus", gesundheitMesslatte: "aus" }, suche: { profil: "minimal" } });
  let r = cli(gruenVault, "--json", "--trocken");
  assert.equal(r.status, 0, r.stderr);
  const g = JSON.parse(r.stdout);
  assert.deepEqual([g.ampel, g.warnungen, g.pruefungen.map((p) => p.id)], ["gruen", 0, ALLE]);
  assert.equal(existsSync(TL(gruenVault, "gesundheit.json")), false, "--trocken");
  r = cli(gruenVault);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^Kortex-Gesundheit \d\d\.\d\d\.: alles in Ordnung\n🟢 Messlatte: /);
  assert.ok(existsSync(TL(gruenVault, "gesundheit.json")));
  // mit Befund: kaputtes Messlatte-Ergebnis → Exit 2
  const rot = vaultMit({ automatik: { hinweise: "aus" }, suche: { profil: "minimal" } });
  logDatei(rot, "hint-eval.log", evalZeile(new Date().toISOString().slice(0, 10), "73/81", 0) + "\n");
  r = cli(rot, "--trocken");
  assert.equal(r.status, 2);
  assert.match(r.stdout, /Kortex-Gesundheit \d\d\.\d\d\.: ⚠ 1 Warnung\n🔴 Messlatte: /);
  assert.match(r.stdout, /⇒ Messlatte verfehlt \(73\/81\)/);
  r = cli(rot, "--quatsch");
  assert.equal(r.status, 64);
  assert.match(r.stderr, /Nutzung: brain gesundheit/);
});

test("brain gesundheit: der Unterbefehl reicht Angaben und Exit-Code durch", () => {
  const v = vaultMit({ automatik: { hinweise: "aus", gesundheitMesslatte: "aus" }, suche: { profil: "minimal" } });
  const r = spawnSync(process.execPath, [join(KIT, "brain.mjs"), "gesundheit", "--json", "--trocken"], { encoding: "utf8", env: { ...process.env, BRAIN_VAULT: v } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).ampel, "gruen");
});
