// Markdown-Tabellen (Runde 3b): Zerlegen, Ausrichten, Zeilen/Spalten ändern, Zellenorte — die reine Logik in studio/tabellen-logik.js.
import test from "node:test";
import assert from "node:assert/strict";
import * as L from "../../Ressourcen/studio/tabellen-logik.js";

const TEXT = "| Name | Rolle |\n|:--|--:|\n| Anna | Leitung |\n| Bo | Technik |";

test("Zerlegen: Zellen, Ausrichtung, Schutz von „\\|“, fehlende Ränder, fehlende Zellen", () => {
  const m = L.parseTabelle(TEXT);
  assert.deepEqual(m.zeilen, [["Name", "Rolle"], ["Anna", "Leitung"], ["Bo", "Technik"]]);
  assert.deepEqual(m.ausr, ["l", "r"]);
  assert.deepEqual(L.zerlegeZeile("a | b\\|c | d"), ["a", "b\\|c", "d"]);
  assert.deepEqual(L.zerlegeZeile("| a | |"), ["a", ""]);
  assert.equal(L.parseTabelle("| a | b\\|c |\n| - | - |\n| 1 | 2 |").zeilen[0][1], "b|c");
  // kürzere Zeilen werden aufgefüllt, längere verlieren nichts
  const k = L.parseTabelle("| a | b |\n| - | - |\n| 1 |\n| 1 | 2 | 3 |");
  assert.deepEqual(k.zeilen, [["a", "b", ""], ["1", "", ""], ["1", "2", "3"]]);
  assert.equal(k.ausr.length, 3);
  assert.equal(L.parseTabelle("kein | Tabellentext"), null);
  assert.equal(L.parseTabelle("| a |\n| nicht-trenner |"), null);
});

test("Ausrichten: gleich breite Spalten, Trennzeile mit Doppelpunkten, Zentrieren", () => {
  const m = L.parseTabelle(TEXT);
  const b = L.baueTabelle(m);
  assert.equal(b.text, "| Name |   Rolle |\n| :--- | ------: |\n| Anna | Leitung |\n| Bo   | Technik |");
  // rechtsbündige Spalte füllt links
  assert.match(L.baueTabelle(L.ausrichtungSetzen(m, 1, "r")).zeilen[2], /\|\s+Leitung \|$/);
  assert.equal(L.baueTabelle(L.ausrichtungSetzen(L.parseTabelle("| ab |\n| - |\n| x |"), 0, "c")).text, "| ab  |\n| :-: |\n|  x  |");
  // Pipe im Text wird geschützt und zählt mit
  assert.equal(L.baueTabelle({ zeilen: [["a|b"], ["x"]], ausr: [null] }).text, "| a\\|b |\n| ---- |\n| x    |");
  // Wiederholen ändert nichts (stabil)
  assert.equal(L.baueTabelle(L.parseTabelle(b.text)).text, b.text);
  // breite Zeichen zählen doppelt
  assert.equal(L.breite("日本"), 4);
  assert.equal(L.breite("ä"), 1);
});

test("Zellenorte: Start jeder Zelle im ausgerichteten Text", () => {
  const b = L.baueTabelle(L.parseTabelle(TEXT));
  assert.equal(b.starts.length, 3);
  const text = b.text;
  assert.equal(text.slice(b.starts[0][0], b.starts[0][0] + 4), "Name");
  assert.equal(text.slice(b.starts[0][1], b.starts[0][1] + 5), "Rolle");
  assert.equal(text.slice(b.starts[2][0], b.starts[2][0] + 2), "Bo");
  assert.equal(text.slice(b.starts[2][1], b.starts[2][1] + 7), "Technik");
  // mit CRLF
  const c = L.baueTabelle(L.parseTabelle(TEXT), "\r\n");
  assert.equal(c.text.slice(c.starts[2][1], c.starts[2][1] + 7), "Technik");
});

test("Cursor → Zelle: Zeile (Kopf 0, Trennzeile), Spalte; Rand und Zellenende", () => {
  const t = "| Name | Rolle |\n| --- | --- |\n| Anna | Leitung |";
  assert.deepEqual(L.zellenOrt(t, 3), { zeile: 0, spalte: 0 });
  assert.deepEqual(L.zellenOrt(t, 10), { zeile: 0, spalte: 1 });
  assert.equal(L.zellenOrt(t, 22).zeile, "trenner");
  assert.deepEqual(L.zellenOrt(t, t.length), { zeile: 1, spalte: 2 }); // hinter dem letzten „|“
  assert.deepEqual(L.zellenOrt("a | b\n- | -\nc | d", 4), { zeile: 0, spalte: 1 });
});

test("Zeilen und Spalten einfügen, löschen, verschieben; Kopfzeile bleibt", () => {
  const m = L.parseTabelle(TEXT);
  assert.equal(L.zeileEinfuegen(m, 0).zeilen.length, 4);
  assert.deepEqual(L.zeileEinfuegen(m, 0).zeilen[0], ["Name", "Rolle"]); // über dem Kopf geht nicht: wird nach der Kopfzeile eingefügt
  assert.deepEqual(L.zeileEinfuegen(m, 1).zeilen[1], ["", ""]);
  assert.deepEqual(L.zeileEinfuegen(m, 99).zeilen[3], ["", ""]);
  assert.deepEqual(L.zeileLoeschen(m, 1).zeilen, [["Name", "Rolle"], ["Bo", "Technik"]]);
  assert.equal(L.zeileLoeschen(m, 0), m);
  const s = L.spalteEinfuegen(m, 1);
  assert.deepEqual(s.zeilen[0], ["Name", "Spalte 3", "Rolle"]);
  assert.deepEqual(s.ausr, ["l", null, "r"]);
  assert.deepEqual(L.spalteLoeschen(m, 0).zeilen[1], ["Leitung"]);
  assert.equal(L.spalteLoeschen(L.spalteLoeschen(m, 0), 0).ausr.length, 1); // die letzte Spalte bleibt
  assert.deepEqual(L.spalteVerschieben(m, 0, 1).zeilen[0], ["Rolle", "Name"]);
  assert.deepEqual(L.spalteVerschieben(m, 0, 1).ausr, ["r", "l"]);
  assert.equal(L.mitZelle(m, 1, 0, "Zoe").zeilen[1][0], "Zoe");
  assert.equal(m.zeilen[1][0], "Anna"); // das Alte bleibt unberührt
});

test("Tab-Weg: nächste Zelle, nächste Zeile, neue Zeile am Ende, ⇧Tab rückwärts", () => {
  const m = L.parseTabelle(TEXT);
  assert.deepEqual(L.naechsteZelle(m, 0, 0), { zeile: 0, spalte: 1 });
  assert.deepEqual(L.naechsteZelle(m, 0, 1), { zeile: 1, spalte: 0 });
  assert.deepEqual(L.naechsteZelle(m, 2, 1), { neueZeile: true });
  assert.deepEqual(L.naechsteZelle(m, 1, 0, true), { zeile: 0, spalte: 1 });
  assert.equal(L.naechsteZelle(m, 0, 0, true), null);
});

test("Kleinste Änderung: Anfang und Ende bleiben stehen", () => {
  assert.deepEqual(L.kleinsteAenderung("abcXdef", "abcYYdef"), { von: 3, bis: 4, einfuegen: "YY" });
  assert.deepEqual(L.kleinsteAenderung("abc", "abc"), { von: 3, bis: 3, einfuegen: "" });
  assert.deepEqual(L.kleinsteAenderung("", "x"), { von: 0, bis: 0, einfuegen: "x" });
  assert.deepEqual(L.kleinsteAenderung("aaa", "aa"), { von: 2, bis: 3, einfuegen: "" });
});

test("Neue Tabelle: 3 Spalten, 2 leere Zeilen, ausgerichtet", () => {
  const t = L.neueTabelleText();
  assert.equal(t.zeilen.length, 4);
  assert.equal(t.zeilen[0], "| Spalte 1 | Spalte 2 | Spalte 3 |");
  assert.equal(t.zeilen[1], "| -------- | -------- | -------- |");
  assert.equal(t.zeilen[2], "|          |          |          |");
  assert.ok(L.parseTabelle(t.text));
});
