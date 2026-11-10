// Schrägstrich-Menü: Erkennen des „/…“ und unscharfes Filtern (reine Regeln, ohne Editor).
import test from "node:test";
import assert from "node:assert/strict";
import { findeAusloeser, filtere, heuteText } from "../../Ressourcen/studio/schraegstrich-logik.js";
import { TSM } from "../../Ressourcen/studio/texte-schraegstrich.js";

const E = Object.keys(TSM.eintraege).map((id) => ({ id, titel: TSM.eintraege[id], woerter: TSM.woerter[id] }));
const ids = (f) => filtere(E, f).map((e) => e.id);

test("Auslöser: Zeilenanfang und nach Leerzeichen; nicht in Wort, Adresse oder Pfad", () => {
  assert.deepEqual(findeAusloeser("/"), { vonSpalte: 0, filter: "" });
  assert.deepEqual(findeAusloeser("Text /h2"), { vonSpalte: 5, filter: "h2" });
  assert.equal(findeAusloeser("und/oder"), null);
  assert.equal(findeAusloeser("https://x"), null);
  assert.equal(findeAusloeser("a /b/c"), null);
  assert.equal(findeAusloeser("/ab cd"), null); // Leerzeichen beendet den Filter
  assert.equal(findeAusloeser("ab /c", "def"), null); // Cursor mitten im Wort
  assert.deepEqual(findeAusloeser("ab /c", " def"), { vonSpalte: 3, filter: "c" });
});

test("Filter: deutsch, englisch, Umlaute egal, unscharf; leer = alle in Menüreihenfolge", () => {
  assert.equal(ids("")[0], "text");
  assert.equal(ids("").length, E.length);
  assert.equal(ids("h2")[0], "h2");
  assert.deepEqual(ids("überschrift"), ["h1", "h2", "h3"]);
  assert.deepEqual(ids("ueberschrift"), ["h1", "h2", "h3"]);
  assert.equal(ids("todo")[0], "aufgabe");
  assert.equal(ids("table")[0], "tabelle");
  assert.equal(ids("tbl")[0], "tabelle");
  assert.deepEqual(ids("zzzq"), []);
});

test("Datum heute: JJJJ-MM-TT", () => {
  assert.equal(heuteText(new Date(2026, 10, 9)), "2026-11-09");
});
