// HTML aus der Zwischenablage → Markdown (Runde 3b). Proben: Tests/Node/proben-html (Word, Notion, Browser — so, wie die Programme sie in die Zwischenablage legen).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { htmlZuMarkdown, hatStruktur, sichereAdresse, entitaeten } from "../../Ressourcen/studio/html-markdown.js";

const probe = (n) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "proben-html", n), "utf8");

test("Word: Überschrift, Absatz mit fett/kursiv/Link, Liste mit Unterpunkt, Tabelle — ohne Skripte, Styles, Kopf und Leerabsätze", () => {
  const md = htmlZuMarkdown(probe("word.html"));
  assert.equal(md, [
    "# Projektstand",
    "",
    "Das ist ein **wichtiger** Absatz mit *Betonung* und einem [Link](https://example.org/seite?a=1&b=2).",
    "",
    "- Erster Punkt",
    "  - Unterpunkt",
    "- Zweiter Punkt",
    "",
    "| **Name** | **Rolle** |",
    "| --- | --- |",
    "| Anna | Leitung \\| Technik |",
  ].join("\n"));
  assert.doesNotMatch(md, /boese|alert|Calibri|mso|StartHTML|<|o:p/);
});

test("Notion: Überschriften, Aufgaben, Listen, Zitat, Codeblock, Tabelle mit Ausrichtung, Trenner, Bild", () => {
  const md = htmlZuMarkdown(probe("notion.html"));
  assert.equal(md, [
    "# Sprint 12",
    "",
    "Wir haben **drei Dinge** erledigt, *eines* offen, `npm test` läuft und ~~alt~~ ist weg. Siehe [Plan](https://www.notion.so/team/Plan-1234).",
    "",
    "## Aufgaben",
    "",
    "- [x] Release bauen",
    "- [ ] Doku schreiben",
    "",
    "1. Erstens",
    "2. Zweitens",
    "   - Unterpunkt A",
    "   - Unterpunkt B",
    "",
    "> Ein Zitat über zwei\\",
    "> Zeilen.",
    "",
    "```js",
    "const x = 1;",
    "if (x) {",
    '  console.log("a < b");',
    "}",
    "```",
    "",
    "| Feld | Wert |",
    "| --- | --- |",
    "| Alpha | 1 |",
    "| Beta | 22 |",
    "",
    "---",
    "",
    "Ende ![Ein Bild](https://example.org/bild.png)",
  ].join("\n").replace("| Feld | Wert |\n| --- | --- |", "| Feld | Wert |\n| :--- | ---: |"));
});

test("Browser (Chrome): Stile werden zu fett/kursiv/durchgestrichen, javascript:-Links verlieren das Ziel, Code bleibt eingerückt, Skripte fallen weg", () => {
  const md = htmlZuMarkdown(probe("browser.html"));
  assert.equal(md, [
    "## Installation",
    "",
    "Lade das Paket mit **curl** herunter. Der *Befehl* steht [in der Anleitung](/docs/install) und hier.",
    "",
    "Zeile in div",
    "",
    "Noch eine div",
    "",
    "```",
    "$ npm install",
    "$ npm start",
    "```",
    "",
    "- Lose Liste, Punkt 1",
    "- Punkt 2 mit ~~gestrichen~~",
  ].join("\n"));
  assert.doesNotMatch(md, /steal|color|javascript/);
});

test("Code aus einem Editor (nur Spans mit Farben) hat keine Struktur: dann gilt der reine Text", () => {
  assert.equal(hatStruktur(probe("editor-code.html")), false);
  assert.equal(hatStruktur(probe("word.html")), true);
  assert.equal(hatStruktur(probe("notion.html")), true);
  assert.equal(hatStruktur(probe("browser.html")), true);
  assert.equal(hatStruktur("nur Text"), false);
  assert.equal(hatStruktur("<span style=\"font-weight: 700\">x</span>"), true);
});

test("Tabellen: Kopfzeile aus <th> oder erster Zeile, colspan, Zellen mit Umbruch, Tabelle ohne thead", () => {
  assert.equal(htmlZuMarkdown("<table><tr><td>A</td><td>B</td></tr><tr><td>1</td><td>2<br>3</td></tr></table>"), "| A | B |\n| --- | --- |\n| 1 | 2<br>3 |");
  assert.equal(htmlZuMarkdown("<table><tr><th colspan=2>Titel</th></tr><tr><td>x</td><td>y</td></tr></table>"), "| Titel |  |\n| --- | --- |\n| x | y |");
  assert.equal(htmlZuMarkdown("<table><tr><td align=center>A</td></tr><tr><td align=center>x</td></tr></table>"), "| A |\n| :---: |\n| x |");
});

test("Listen: Verschachtelung, nummeriert mit start, Eintrag mit mehreren Absätzen", () => {
  assert.equal(htmlZuMarkdown("<ul><li>a<ul><li>b<ul><li>c</li></ul></li></ul></li><li>d</li></ul>"), "- a\n  - b\n    - c\n- d");
  assert.equal(htmlZuMarkdown('<ol start="3"><li>drei</li><li>vier</li></ol>'), "3. drei\n4. vier");
  assert.equal(htmlZuMarkdown("<ul><li>eins<p>mehr dazu</p></li></ul>"), "- eins\n\n  mehr dazu");
  // ohne schließende Tags (HTML erlaubt es)
  assert.equal(htmlZuMarkdown("<ul><li>a<li>b</ul>"), "- a\n- b");
});

test("Text: Markdown-Zeichen im Text werden geschützt, Leerraum aufgeräumt, Entitäten gelesen", () => {
  assert.equal(htmlZuMarkdown("<p>5 * 3 = 15 und snake_case_name und _unter_ <b>fett</b></p>"), "5 \\* 3 = 15 und snake_case_name und \\_unter\\_ **fett**");
  assert.equal(htmlZuMarkdown("<p>1. kein Listenpunkt</p><p># keine Überschrift</p>"), "1\\. kein Listenpunkt\n\n\\# keine Überschrift");
  assert.equal(htmlZuMarkdown("<p>a &lt;b&gt; &amp; &auml;&ouml;&uuml; &#8364; &#x1F600;&nbsp;x</p>"), "a \\<b> & äöü € 😀 x");
  assert.equal(htmlZuMarkdown("<p>  viele \n\n   Leerzeichen\t hier </p>"), "viele Leerzeichen hier");
  assert.equal(htmlZuMarkdown("<p><b>fett </b>danach <b>und</b><b> weiter</b></p>"), "**fett** danach **und weiter**");
  assert.equal(htmlZuMarkdown("<p>Code mit `Backtick` <code>a`b</code></p>"), "Code mit \\`Backtick\\` ``a`b``");
  assert.equal(entitaeten("&unbekannt; &amp;amp;"), "&unbekannt; &amp;");
});

test("Überschriften bleiben ohne zusätzliches Fett, Links nur mit erlaubten Zielen", () => {
  assert.equal(htmlZuMarkdown('<h3><b>Titel</b> eins</h3>'), "### Titel eins");
  assert.equal(htmlZuMarkdown('<a href="mailto:a@b.de">Mail</a> <a href="vbscript:x">v</a> <a href="data:text/html,x">d</a> <a href="https://x.org/a(b)">K</a>'), "[Mail](mailto:a@b.de) v d [K](https://x.org/a%28b%29)");
  assert.equal(htmlZuMarkdown('<a href="https://x.org">https://x.org</a>'), "<https://x.org>");
  assert.equal(sichereAdresse(" JaVaScRiPt:alert(1)"), null);
  assert.equal(sichereAdresse("java\nscript:alert(1)"), null);
  assert.equal(sichereAdresse("#abschnitt"), "#abschnitt");
});

test("Bilder: nur http(s) werden Markdown; data:-Bilder entfallen oder gehen an den Hook der Anwendung", () => {
  assert.equal(htmlZuMarkdown('<p><img src="data:image/png;base64,AAAA" alt="x"></p>'), "");
  assert.equal(htmlZuMarkdown('<p>a <img src="data:image/png;base64,AAAA" alt="x"></p>'), "a");
  assert.equal(htmlZuMarkdown('<p><img src="data:image/png;base64,AAAA" alt="x"></p>', { bild: (src, alt) => `![${alt}](anhang/1.png)` }), "![x](anhang/1.png)");
  assert.equal(htmlZuMarkdown('<img src="file:///etc/passwd">'), "");
});

test("Aus fremdem HTML kommt nie HTML heraus: Skripte, Handler, Formulare, iframes und Kommentare fallen weg", () => {
  const boese = '<p onclick="x()">a<script>alert(1)</script><iframe src="https://e.org"></iframe><style>*{}</style><!-- <b>versteckt</b> --><svg><text>svg</text></svg><form><button>Knopf</button></form><textarea>feld</textarea></p><div hidden>weg</div><div style="display:none">auch weg</div><p><img src="x" onerror="y()"></p>';
  assert.equal(htmlZuMarkdown(boese), "a");
  assert.equal(htmlZuMarkdown("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>"), "\\<script>alert(1)\\</script>");
});

test("Leere und kaputte Eingaben ergeben leeren Text, nie einen Fehler", () => {
  for (const x of ["", "<", "<<<>>>", "<p", "<a href=", "<table><tr>", "</p></div>", null, undefined, 5]) assert.doesNotThrow(() => htmlZuMarkdown(x));
  assert.equal(htmlZuMarkdown(""), "");
  assert.equal(htmlZuMarkdown("<table></table>"), "");
});
