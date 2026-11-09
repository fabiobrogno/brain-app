// Wort-Diff und Regeln der KI-Text-Aktionen (K2), rein: byte-treu (CRLF, Umlaute, Emojis), Sperrgründe der Auswahl, Aufgaben unter der Auswahl.
import test from "node:test";
import assert from "node:assert/strict";
import { pfad } from "./hilfe.mjs";

const D = await import(pfad("studio", "wort-diff.js"));
const L = await import(pfad("studio", "ki-text-logik.js"));

const treu = (a, b) => { const d = D.wortDiff(a, b); assert.equal(D.textAlt(d), a, "alt rekonstruierbar"); assert.equal(D.textNeu(d), b, "neu rekonstruierbar"); return d; };

test("Wort-Diff: einfache Änderung, Reihenfolge weg vor neu, Gleiches bleibt Text", () => {
  const d = treu("Das ist ein Test.", "Das ist kein Test.");
  assert.deepEqual(d, [{ t: "gleich", s: "Das ist " }, { t: "weg", s: "ein" }, { t: "neu", s: "kein" }, { t: "gleich", s: " Test." }]);
  assert.equal(D.hatAenderung(treu("gleich", "gleich")), false);
  assert.deepEqual(treu("", "neu"), [{ t: "neu", s: "neu" }]);
  assert.deepEqual(treu("alt", ""), [{ t: "weg", s: "alt" }]);
});

test("Wort-Diff byte-treu: CRLF, Umlaute, Emojis (ZWJ-Folgen, Flaggen, Hauttöne), kombinierende Zeichen, Tabs, Leerraum am Rand", () => {
  const faelle = [
    ["Zeile eins\r\nZeile zwei\r\n\r\nZeile drei", "Zeile eins\r\nZeile 2\r\n\r\nZeile drei"],
    ["Größe: übermäßig schön", "Größe: übermäßig hässlich"],
    ["Familie 👨‍👩‍👧 und Flagge 🇩🇪 und Hand 👍🏽", "Familie 👨‍👩‍👦 und Flagge 🇩🇪 und Hand 👍🏿"],
    ["café au lait", "café au lait"],
    ["\tEingerückt  mit  Doppelleerzeichen  ", "Eingerückt mit Doppelleerzeichen"],
    ["a\rb\nc\r\nd", "a\nb\r\nc\rd"],
    ["- [ ] Aufgabe eins\n- [ ] Aufgabe zwei", "- [x] Aufgabe eins\n- [ ] Aufgabe drei\n- [ ] vier"],
    ["x".repeat(200) + " y", "x".repeat(200) + " z"],
    ["\u{1F600}\u{1F601}", "\u{1F601}\u{1F600}"],
    ["lone \uD83D surrogate", "lone surrogate"],
  ];
  for (const [a, b] of faelle) treu(a, b);
});

test("Wort-Diff: zerlegt nie durch ein Zeichen (jedes Token ist ein ganzes Zeichen samt Anhang)", () => {
  const teile = D.zerlege("👨‍👩‍👧 é 🇩🇪 👍🏽 \r\n");
  assert.equal(teile.join(""), "👨‍👩‍👧 é 🇩🇪 👍🏽 \r\n");
  assert.ok(teile.includes("👨‍👩‍👧"), "ZWJ-Folge bleibt zusammen");
  assert.ok(teile.includes("👍🏽"), "Hautton bleibt am Zeichen");
  assert.ok(teile.includes("\r\n"), "CRLF ist ein Token");
});

test("Wort-Diff: Leerraum zwischen zwei Änderungen verschmilzt (keine Schnipsel), sehr große Eingaben fallen auf „alles ersetzt“", () => {
  const d = treu("a b c", "x y z");
  assert.deepEqual(d, [{ t: "weg", s: "a b c" }, { t: "neu", s: "x y z" }]);
  const wort = (n, p) => Array.from({ length: n }, (_, i) => `${p}${i}`).join(" ");
  const gross = treu(wort(2500, "a"), wort(2500, "b"));
  assert.equal(gross.length, 2);
});

test("Auswahl: Code-Block (auch offener Zaun und ~~~), Tabelle und Kopf sperren; normale Absätze nicht; zu lang und leer", () => {
  const doc = ["---", "titel: x", "---", "Text davor", "", "```js", "const a = 1;", "```", "", "| a | b |", "| - | - |", "| 1 | 2 |", "", "Text danach", "", "~~~", "offen"].join("\n");
  const v = (zeile) => doc.indexOf(zeile);
  const grund = (zeile, ende = zeile) => { const p = L.pruefeAuswahl(doc, v(zeile), v(ende) + ende.length); return p.ok ? "ok" : p.grund; };
  assert.equal(grund("Text davor"), "ok");
  assert.equal(grund("Text danach"), "ok");
  assert.equal(grund("const a = 1;"), "code");
  assert.equal(grund("Text davor", "const a = 1;"), "code", "Auswahl reicht in den Code-Block");
  assert.equal(grund("| a | b |", "| 1 | 2 |"), "tabelle");
  assert.equal(grund("Text danach", "offen"), "code", "nicht geschlossener Zaun reicht bis zum Ende");
  assert.equal(grund("titel: x"), "kopf");
  assert.equal(L.pruefeAuswahl("abc", 0, 0).grund, "leer");
  assert.equal(L.pruefeAuswahl("   ", 0, 3).grund, "leer");
  assert.equal(L.pruefeAuswahl("x".repeat(9000), 0, 9000).grund, "zulang");
  assert.equal(L.pruefeAuswahl("a\nb", 0, 3, { laenge: 9000 }).grund, "zulang", "die Länge zählt mit den Zeilenenden der Datei");
});

test("Zeilenende der Datei auf Antworten der KI anwenden", () => {
  assert.equal(L.mitZeilenende("a\nb\r\nc", "\r\n"), "a\r\nb\r\nc");
  assert.equal(L.mitZeilenende("a\r\nb", "\n"), "a\nb");
});

test("Aufgaben unter der Auswahl: Absatz → Leerzeile davor; Liste → direkt darunter mit gleichem Einzug; folgt Text, bleibt eine Leerzeile", () => {
  const A = [{ text: "Käse kaufen", faellig: "2026-12-01" }, { text: "Brötchen\nholen" }];
  let doc = "Absatz mit Aufgaben.\n\nNächster Absatz.\n";
  let e = L.aufgabenEinfuegung(doc, doc.indexOf("Aufgaben"), A);
  assert.equal(e.pos, "Absatz mit Aufgaben.".length);
  assert.equal(e.einfuegen, "\n\n- [ ] Käse kaufen (fällig 2026-12-01)\n- [ ] Brötchen holen");
  doc = "Absatz\nGleich weiter.\n";
  e = L.aufgabenEinfuegung(doc, 3, A);
  assert.equal(doc.slice(0, e.pos) + e.einfuegen + doc.slice(e.pos), "Absatz\nGleich weiter.\n\n- [ ] Käse kaufen (fällig 2026-12-01)\n- [ ] Brötchen holen\n");
  // Liste: nach der ganzen Liste (samt Fortsetzungen und Unterpunkten), mit dem Einzug der Liste
  doc = "- Punkt eins\n  - Unterpunkt\n  fortsetzung\n- Punkt zwei\n\nDanach.\n";
  e = L.aufgabenEinfuegung(doc, doc.indexOf("Unterpunkt") + 3, [{ text: "A" }]);
  assert.equal(doc.slice(0, e.pos) + e.einfuegen + doc.slice(e.pos), "- Punkt eins\n  - Unterpunkt\n  fortsetzung\n- Punkt zwei\n- [ ] A\n\nDanach.\n");
  doc = "1. eins\n2. zwei\nText";
  e = L.aufgabenEinfuegung(doc, 3, [{ text: "A" }]);
  assert.ok(doc.slice(0, e.pos).endsWith("2. zwei"), "Nummerierung bleibt zusammen");
  // Absatz über mehrere Zeilen: nach dem ganzen Absatz; Zitat: nach dem ganzen Zitat
  doc = "Erste Zeile\nZweite Zeile\n\nNächster.\n";
  e = L.aufgabenEinfuegung(doc, 3, [{ text: "A" }]);
  assert.equal(doc.slice(0, e.pos) + e.einfuegen + doc.slice(e.pos), "Erste Zeile\nZweite Zeile\n\n- [ ] A\n\nNächster.\n");
  doc = "> zitat\n> weiter\n\nEnde\n";
  e = L.aufgabenEinfuegung(doc, 4, [{ text: "A" }]);
  assert.equal(e.pos, "> zitat\n> weiter".length);
  doc = "Satz.\nZweite Zeile.\n";
  e = L.aufgabenEinfuegung(doc, "Satz.\n".length, [{ text: "A" }]); // Auswahl nimmt den Zeilenumbruch mit
  assert.equal(e.pos, "Satz.\nZweite Zeile.".length); // der ganze Absatz
});

test("Anzeige-Diff: NFC und NFD gleicher Wörter erscheinen nicht als Änderung; der rohe Diff bleibt byte-treu", () => {
  const nfd = "Caf\u0065\u0301 au lait", nfc = "Caf\u00e9 au lait";
  assert.equal(D.hatAenderung(D.wortDiffAnzeige(nfd, nfc)), false);
  assert.equal(D.hatAenderung(D.wortDiffAnzeige(nfd, nfc + " noch")), true);
  treu(nfd, nfc);
});
