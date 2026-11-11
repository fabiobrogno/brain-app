// R4-5: Der Schnitt langer Absätze im Parser (editor-lange-absaetze.js) ändert den Syntaxbaum nur für echte Riesen-Absätze.
// Tabellen, Link-Definitionen, Codezäune, Listen, Zitate und Normales bleiben gleich, auch wenn sie länger als die Schnittlänge sind.
import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const studio = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "Ressourcen", "studio");
const CM = await import(pathToFileURL(join(studio, "vendor", "codemirror.bundle.js")).href);
const { langeAbsaetze, ABSATZ_SCHNITT, LANGE_ZEILE } = await import(pathToFileURL(join(studio, "editor-lange-absaetze.js")).href);
const mit = CM.markdown({ base: CM.markdownLanguage, extensions: [langeAbsaetze] }).language.parser;
const ohne = CM.markdown({ base: CM.markdownLanguage }).language.parser;
const baum = (p, t, namen) => { const o = []; p.parse(t).iterate({ enter: (n) => { if (!namen || namen.includes(n.name)) o.push(`${n.name}[${n.from},${n.to}]`); } }); return o.join(" "); };

const GROSS = ABSATZ_SCHNITT * 2;
const fixturen = {
  tabelle: "# T\n\n| a | b |\n| --- | --- |\n" + "| zelle eins | zelle zwei |\n".repeat(Math.ceil(GROSS / 25)) + "\nDanach Text.\n",
  linkdefinitionen: Array.from({ length: Math.ceil(GROSS / 30) }, (_, i) => `[ref${i}]: https://example.org/${i}`).join("\n") + "\n\nText.\n",
  codezaun: "```js\n" + "const x = 1;\n".repeat(Math.ceil(GROSS / 13)) + "```\n\nText.\n",
  liste: "- punkt\n".repeat(Math.ceil(GROSS / 8)) + "\nText.\n",
  html: "<div>\n" + "<p>zeile</p>\n".repeat(Math.ceil(GROSS / 13)) + "</div>\n\nText.\n",
  frontmatter: "---\ntitel: x\ntags: [a, b]\n---\n\n# Titel\n\nKurzer Absatz mit [[Link]].\n",
  normal: "# Titel\n\nEin Absatz mit [[Wikilink]] und **fett** und [Text](https://example.org).\nZweite Zeile.\n\n- a\n- b\n\n| x | y |\n| - | - |\n| 1 | 2 |\n",
};

for (const [name, text] of Object.entries(fixturen)) {
  test(`gleicher Syntaxbaum mit und ohne Schnitt: ${name}`, () => {
    assert.equal(baum(mit, text), baum(ohne, text));
  });
}

test("Tabelle über der Schnittlänge bleibt EIN Table-Knoten über die ganze Tabelle", () => {
  const t = fixturen.tabelle;
  assert.ok(t.length > ABSATZ_SCHNITT);
  const tabellen = baum(mit, t, ["Table"]).split(" ");
  assert.equal(tabellen.length, 1);
  const ende = Number(/,(\d+)\]/.exec(tabellen[0])[1]);
  assert.ok(ende >= t.indexOf("\nDanach") - 1, `Table endet erst vor dem Folgetext (${ende})`);
  assert.equal(baum(mit, t, ["Paragraph"]), baum(ohne, t, ["Paragraph"]));
});

test("Riesen-Absatz ohne Leerzeile wird im Syntaxbaum geschnitten; Klammern einer einzigen Riesenzeile lösen keine Links auf", () => {
  const absatz = Array.from({ length: 2000 }, (_, i) => `wort ${i} [[Seite ${i}]] und mehr`).join("\n") + "\n";
  assert.equal(baum(ohne, absatz, ["Paragraph"]).split(" ").length, 1);
  const teile = baum(mit, absatz, ["Paragraph"]).split(" ");
  assert.ok(teile.length > 3, `geschnitten: ${teile.length}`);
  const zeile = "x [[a]] [b](u) ".repeat(Math.ceil(LANGE_ZEILE / 14) + 10);
  assert.equal(baum(mit, zeile, ["Link", "Image"]), "");
});

test("Zitat mit einem Riesen-Absatz bleibt EIN Blockquote (nur der Absatz darin wird geschnitten)", () => {
  const t = "> zitat zeile\n".repeat(Math.ceil(GROSS / 14)) + "\nText.\n";
  assert.equal(baum(mit, t, ["Blockquote"]), baum(ohne, t, ["Blockquote"]));
});
