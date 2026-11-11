// Callouts (R4-2): Kopfzeile lesen, Arten und Aliase, Falten. Reine Regeln aus Ressourcen/studio/callout-logik.js.
import test from "node:test";
import assert from "node:assert/strict";
import { parseKopf, artVon, bekannt, istZu, ARTEN } from "../../Ressourcen/studio/callout-logik.js";

test("Kopfzeile: Typ, Faltzeichen, Titel und Spalte des Titels", () => {
  assert.deepEqual(parseKopf(" [!tip] Mein Titel"), { typ: "tip", art: "tip", falt: null, titel: "Mein Titel", titelVon: 8 });
  assert.deepEqual(parseKopf(" [!faq]- Zu"), { typ: "faq", art: "question", falt: "-", titel: "Zu", titelVon: 9 });
  assert.deepEqual(parseKopf(" [!NOTE]+  Offen  "), { typ: "NOTE", art: "note", falt: "+", titel: "Offen", titelVon: 11 });
  const ohne = parseKopf(" [!warning]");
  assert.equal(ohne.titel, "");
  assert.equal(ohne.falt, null);
});

test("Keine Kopfzeile: gewöhnliches Zitat, Link, zu viel Text vor der Marke", () => {
  for (const t of [" Zitat", " [!] leer", " [!x y] Leerzeichen im Typ", " Text [!tip]", "", " [text](url)", " [ ] Aufgabe"]) assert.equal(parseKopf(t), null, t);
});

test("Arten wie in Obsidian: Aliase, Groß-/Kleinschreibung, unbekannt = Notiz", () => {
  for (const [alias, art] of Object.entries({ summary: "abstract", tldr: "abstract", hint: "tip", important: "tip", check: "success", done: "success", help: "question", faq: "question", caution: "warning", attention: "warning", fail: "failure", missing: "failure", error: "danger", cite: "quote" })) assert.equal(artVon(alias), art, alias);
  for (const a of Object.keys(ARTEN)) assert.equal(artVon(a), a);
  assert.equal(artVon("TIP"), "tip");
  assert.equal(artVon("gibtsnicht"), "note");
  assert.equal(bekannt("gibtsnicht"), false);
  assert.equal(bekannt("Hint"), true);
});

test("Falten: „-“ ist zu, „+“ und ohne Zeichen offen, ein Klick tauscht, ohne Zeichen nie zu", () => {
  assert.equal(istZu("-", false), true);
  assert.equal(istZu("-", true), false);
  assert.equal(istZu("+", false), false);
  assert.equal(istZu("+", true), true);
  assert.equal(istZu(null, false), false);
  assert.equal(istZu(null, true), false);
});
