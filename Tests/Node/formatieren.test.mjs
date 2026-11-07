// Formatieren (Runde 3b): fett/kursiv/Code/durchgestrichen/Link, Überschriften, Listen — die Umschalter in studio/formatieren.js auf einem echten Markdown-Zustand (CodeMirror ohne DOM).
import test from "node:test";
import assert from "node:assert/strict";
import * as CM from "../../Ressourcen/studio/vendor/codemirror.bundle.js";
import * as F from "../../Ressourcen/studio/formatieren.js";

const zustand = (doc, a, b = a) => CM.EditorState.create({ doc, selection: { anchor: a, head: b }, extensions: [CM.markdown({ base: CM.markdownLanguage })] });
const lauf = (doc, a, b, f) => { const s = f(zustand(doc, a, b)); const n = F.wende(zustand(doc, a, b), s); return { doc: n.doc.toString(), von: n.selection.main.from, bis: n.selection.main.to }; };
const text = (doc, wort) => { const i = doc.indexOf(wort); return [i, i + wort.length]; };

test("fett: Auswahl umschließen, Auswahl bleibt innen, zweiter Aufruf nimmt zurück", () => {
  const doc = "ein Wort hier";
  const [a, b] = text(doc, "Wort");
  const r = lauf(doc, a, b, (s) => F.umschalten(s, "fett"));
  assert.equal(r.doc, "ein **Wort** hier");
  assert.equal(r.doc.slice(r.von, r.bis), "Wort");
  const r2 = lauf(r.doc, r.von, r.bis, (s) => F.umschalten(s, "fett"));
  assert.equal(r2.doc, doc);
  assert.equal(r2.doc.slice(r2.von, r2.bis), "Wort");
});

test("Cursor ohne Auswahl: das Wort; zwischen Wörtern: leere Marken mit Cursor dazwischen", () => {
  assert.equal(lauf("ein Wort hier", 6, 6, (s) => F.umschalten(s, "kursiv")).doc, "ein *Wort* hier");
  const r = lauf("a\n\nb", 2, 2, (s) => F.umschalten(s, "fett"));
  assert.equal(r.doc, "a\n****\nb");
  assert.equal(r.von, 4);
});

test("Leerzeichen am Rand der Auswahl bleiben außerhalb der Marken", () => {
  const r = lauf("x  Wort und  y", 1, 13, (s) => F.umschalten(s, "fett"));
  assert.equal(r.doc, "x  **Wort und**  y");
});

test("mehrzeilige Auswahl: jede Zeile bekommt ihre eigenen Marken", () => {
  assert.equal(lauf("eins\nzwei\n\ndrei", 0, 15, (s) => F.umschalten(s, "fett")).doc, "**eins**\n**zwei**\n\n**drei**");
});

test("verschachtelt: kursiv in fett, fett in kursiv; Code, durchgestrichen", () => {
  let r = lauf("**Wort**", 2, 6, (s) => F.umschalten(s, "kursiv"));
  assert.equal(r.doc, "***Wort***");
  r = lauf("***Wort***", 3, 7, (s) => F.umschalten(s, "fett"));
  assert.equal(r.doc, "*Wort*");
  assert.equal(lauf("a b", 0, 1, (s) => F.umschalten(s, "durch")).doc, "~~a~~ b");
  assert.equal(lauf("~~a~~ b", 2, 3, (s) => F.umschalten(s, "durch")).doc, "a b");
  assert.equal(lauf("a b", 2, 3, (s) => F.umschalten(s, "code")).doc, "a `b`");
  assert.equal(lauf("a `b`", 4, 4, (s) => F.umschalten(s, "code")).doc, "a b");
  assert.equal(lauf("a `x` b", 0, 7, (s) => F.umschalten(s, "code")).doc, "``a `x` b``");
});

test("Auswahl samt Marken (Doppelklick auf **Wort**) wird ebenfalls zurückgenommen", () => {
  assert.equal(lauf("a **Wort** b", 2, 10, (s) => F.umschalten(s, "fett")).doc, "a Wort b");
});

test("Überschriften: setzen, ersetzen, zweimal = Absatz, Listenmarke weicht, mehrere Zeilen", () => {
  assert.equal(lauf("Text", 2, 2, (s) => F.ueberschrift(s, 2)).doc, "## Text");
  assert.equal(lauf("## Text", 4, 4, (s) => F.ueberschrift(s, 3)).doc, "### Text");
  assert.equal(lauf("## Text", 4, 4, (s) => F.ueberschrift(s, 2)).doc, "Text");
  assert.equal(lauf("- Punkt", 3, 3, (s) => F.ueberschrift(s, 1)).doc, "# Punkt");
  assert.equal(lauf("a\nb\n\nc", 0, 6, (s) => F.ueberschrift(s, 2)).doc, "## a\n## b\n\n## c");
  // Cursor bleibt im Text
  const r = lauf("Text", 2, 2, (s) => F.ueberschrift(s, 1));
  assert.equal(r.doc.slice(r.von - 1, r.von + 1), "ex"); // der Cursor steht zwischen „e“ und „x“ wie vorher
  assert.equal(lauf("", 0, 0, (s) => F.ueberschrift(s, 1)).doc, "# ");
});

test("Listen: Aufzählung, Nummerierung, Aufgaben, Umschalten zwischen Arten, Einrückung bleibt, Rückweg", () => {
  assert.equal(lauf("a\nb", 0, 3, (s) => F.liste(s, "punkt")).doc, "- a\n- b");
  assert.equal(lauf("- a\n- b", 0, 7, (s) => F.liste(s, "punkt")).doc, "a\nb");
  assert.equal(lauf("- a\n- b", 0, 7, (s) => F.liste(s, "nummer")).doc, "1. a\n2. b");
  assert.equal(lauf("1. a\n2. b", 0, 9, (s) => F.liste(s, "aufgabe")).doc, "- [ ] a\n- [ ] b");
  assert.equal(lauf("- [x] a", 0, 7, (s) => F.liste(s, "punkt")).doc, "- a");
  assert.equal(lauf("  a", 2, 2, (s) => F.liste(s, "punkt")).doc, "  - a");
  assert.equal(lauf("a\n\nb", 0, 4, (s) => F.liste(s, "nummer")).doc, "1. a\n\n2. b");
  assert.equal(lauf("# Titel", 3, 3, (s) => F.liste(s, "punkt")).doc, "- Titel");
  assert.equal(lauf("", 0, 0, (s) => F.liste(s, "aufgabe")).doc, "- [ ] ");
});

test("Link: Text → [Text](https://), Adresse → [Linktext](Adresse), Link am Cursor auflösen, Wort am Cursor", () => {
  let r = lauf("Siehe Kortex hier", 6, 12, (s) => F.link(s));
  assert.equal(r.doc, "Siehe [Kortex](https://) hier");
  assert.equal(r.doc.slice(r.von, r.bis), "https://");
  r = lauf("Siehe [Kortex](https://kortex.app) hier", 10, 10, (s) => F.link(s));
  assert.equal(r.doc, "Siehe Kortex hier");
  r = lauf("Adresse https://x.org/a ok", 8, 23, (s) => F.link(s));
  assert.equal(r.doc, "Adresse [Linktext](https://x.org/a) ok");
  assert.equal(r.doc.slice(r.von, r.bis), "Linktext");
  assert.equal(lauf("ein Wort", 6, 6, (s) => F.link(s)).doc, "ein [Wort](https://)");
  assert.equal(lauf("", 0, 0, (s) => F.link(s)).doc, "[Linktext](https://)");
});

test("Zustand an der Auswahl (Format-Leiste): fett, Überschrift, Liste, Link", () => {
  const z = F.zustandAnAuswahl(zustand("## **Titel**", 6, 8));
  assert.equal(z.fett, true); assert.equal(z.ueberschrift, 2); assert.equal(z.kursiv, false); assert.equal(z.liste, null);
  assert.equal(F.zustandAnAuswahl(zustand("- [ ] a", 6, 7)).liste, "aufgabe");
  assert.equal(F.zustandAnAuswahl(zustand("[a](b)", 1, 2)).link, true);
});
