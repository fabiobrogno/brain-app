// R4-6 Politur: (1) Suchtreffer ohne Markdown (reine Funktionen aus suche-text.js, samt Umrechnung der Marken), (2) Treffer nach Abdeckung der Suchwörter,
// (3) sichtbare Texte der Oberfläche ohne interne Begriffe (/ingest, „Commit“, „Rechner:“, „Ungelinkte“, Dateinamen in Fußzeilen).
// Aufruf: node --test Tests/Node/politur-texte.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ohneMarkdown, neueMarken, nachAbdeckung, abdeckung } from "../../Ressourcen/studio/suche-text.js";

const WURZEL = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

test("ohneMarkdown: Wikilinks, Links, Hervorhebungen, Rauten, Zitat- und Listenzeichen fallen weg", () => {
  const fall = [
    ["## Heißgetränk **Kaffee** und [[Kaffee|Bohne]]", "Heißgetränk Kaffee und Bohne"],
    ["> Ein Zitat mit [Link](http://x.de) und `code`", "Ein Zitat mit Link und code"],
    ["- [ ] Aufgabe ![[bild.png]] _kursiv_", "Aufgabe bild.png kursiv"],
    ["[[Notiz#Abschnitt]] ~~weg~~ ==markiert==", "Notiz weg markiert"],
    ["1. Erstens und 2*3*4 bleibt", "Erstens und 2*3*4 bleibt"],
    ["snake_case_wort und __fett__", "snake_case_wort und fett"],
    ["Text ohne alles", "Text ohne alles"],
    ["", ""],
  ];
  for (const [roh, soll] of fall) assert.equal(ohneMarkdown(roh).text, soll, roh);
  for (const t of ["**", "[[", "]]", "](", "`"]) assert.ok(!ohneMarkdown("a **b** [[c|d]] [e](f) `g`").text.includes(t), t);
});

test("neueMarken: die Markierung bleibt auf dem Wort, auch wenn Zeichen davor wegfallen", () => {
  const roh = "## Heißgetränk **Kaffee** und [[Kaffee|Bohne]] noch Kaffee";
  const o = ohneMarkdown(roh);
  // Marken auf jedes „Kaffee“ im Original
  const marken = [...roh.matchAll(/Kaffee/g)].map((m) => [m.index, m.index + 6]);
  const neu = neueMarken(marken, o.karte);
  const gefunden = neu.map(([a, b]) => o.text.slice(a, b));
  assert.deepEqual(gefunden, ["Kaffee", "Kaffee"]); // das Ziel „Kaffee“ im Wikilink fällt mit dem Alias weg (der Treffer lag in entfernten Zeichen)
  // Marke auf einem Wikilink-Alias bleibt erhalten
  const r2 = "siehe [[Kaffee|Bohne]] hier";
  const o2 = ohneMarkdown(r2);
  const i = r2.indexOf("Bohne");
  assert.deepEqual(neueMarken([[i, i + 5]], o2.karte).map(([a, b]) => o2.text.slice(a, b)), ["Bohne"]);
});

test("nachAbdeckung: wer mehr verschiedene Suchwörter trägt, steht vorn; sonst bleibt die Reihenfolge", () => {
  const t = (pfad, ...woerter) => ({ pfad, titel: "T", titelMarken: [], stellen: woerter.map((w) => ({ text: w, marken: [[0, w.length]] })) });
  const a = t("a", "Seifenblase"), b = t("b", "Seifenblase", "Zitronenfalter"), c = t("c", "Seifenblase");
  assert.equal(abdeckung(a), 1); assert.equal(abdeckung(b), 2);
  assert.deepEqual(nachAbdeckung([a, b, c]).map((x) => x.pfad), ["b", "a", "c"]);
  assert.deepEqual(nachAbdeckung([a, c]).map((x) => x.pfad), ["a", "c"]);
});

// ---- Sichtbare Texte: keine internen Begriffe
const STUDIO = join(WURZEL, "Ressourcen", "studio");
// Verlauf-Texte gehören zu R4-4 (eigene Prüfung dort)
const AUSGENOMMEN = new Set(["texte-verlauf.js"]);
const ohneKommentare = (code) => code.split("\n").map((z) => z.replace(/(^|\s)\/\/.*$/, "$1")).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
const textDateien = readdirSync(STUDIO).filter((f) => /^texte.*\.js$/.test(f) && !AUSGENOMMEN.has(f));

test("texte*.js: kein /ingest, kein „Commit“, kein „Rechner:“, kein „Ungelinkte“", () => {
  assert.ok(textDateien.length > 10);
  for (const f of textDateien) {
    const code = ohneKommentare(readFileSync(join(STUDIO, f), "utf8"));
    for (const [muster, grund] of [[/\/ingest/, "interner Befehl"], [/\bCommits?\b/, "Git-Wort"], [/Rechner:/, "neutralisiertes „Mac:“"], [/Ungelinkt/, "heißt „Unverlinkte“"], [/brain\.config\.json · einstellungen\.json/, "Dateinamen als Fußzeile"]]) {
      assert.ok(!muster.test(code), `${f}: ${grund} (${muster})`);
    }
  }
});

test("Einstellungen: Fußzeile ohne Dateinamen und ohne zweiten Hinweis „Änderungen gelten sofort“", () => {
  const code = ohneKommentare(readFileSync(join(STUDIO, "einstellungen.js"), "utf8"));
  assert.ok(!/e-status-dateien/.test(code), "Dateinamen in der Statuszeile");
  assert.ok(!/TE\.fuss/.test(code), "zweiter Hinweis unter der Navigation");
  const texte = readFileSync(join(STUDIO, "texte-einstellungen.js"), "utf8");
  assert.ok(!/Mac: Menü/.test(texte), "„Mac: Menü …“ im Updatetext");
});
