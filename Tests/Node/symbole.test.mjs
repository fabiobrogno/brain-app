// Symbole: Ressourcen/studio/symbole.js ist ERZEUGT (scripts/erzeuge-symbole.mjs aus Lucide) und darf nicht von Hand geändert werden;
// jeder Name, den das Studio anfordert, muss es geben; die bisherigen Kortex-Namen bleiben alle erhalten (die Aufrufer ändern sich nicht).
// Der Vergleich braucht das Paket: `npm ci` in Werkzeuge/symbole (die CI tut es). Lokal ohne Paket wird er übersprungen, in der CI nie.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { baueSymbole, ABBILDUNG, ZIEL, lucideNamen } from "../../scripts/erzeuge-symbole.mjs";

const W = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const STUDIO = join(W, "Ressourcen", "studio");
const paketDa = existsSync(join(W, "Werkzeuge", "symbole", "node_modules", "lucide-static", "package.json"));
const ueberspringen = !paketDa && !process.env.CI;
const { symbolNamen, GROESSE, strichPx } = await import(pathToFileURL(ZIEL).href);

test("symbole.js stimmt Byte für Byte mit der Erzeugung überein (nicht von Hand ändern)", { skip: ueberspringen && "lucide-static fehlt: npm ci in Werkzeuge/symbole" }, () => {
  assert.equal(readFileSync(ZIEL, "utf8"), baueSymbole(), "symbole.js wurde von Hand geändert oder die Erzeugung nicht ausgeführt: node scripts/erzeuge-symbole.mjs");
});

test("jeder Lucide-Name der Zuordnung existiert im Paket, Version ist fest eingetragen", { skip: ueberspringen && "lucide-static fehlt" }, () => {
  const paket = JSON.parse(readFileSync(join(W, "Werkzeuge", "symbole", "package.json"), "utf8"));
  assert.match(paket.devDependencies["lucide-static"], /^\d+\.\d+\.\d+$/, "lucide-static muss exakt festgelegt sein (ohne ^ oder ~)");
  const fehlt = lucideNamen().filter((n) => !existsSync(join(W, "Werkzeuge", "symbole", "node_modules", "lucide-static", "icons", `${n}.svg`)));
  assert.deepEqual(fehlt, []);
});

test("die bisherigen Kortex-Namen sind alle noch da", () => {
  const alt = `inbox notiz archiv filter ordner ordner-offen ordner-plus plus suche sortierung verlauf stern stern-voll haken kreis-haken schliessen
    chevron-rechts chevron-unten chevron-auf-ab zahnrad mond sonne zweig wolke sync commit claude herz schild link extern gliederung breite code
    eigenschaften seitenleiste vault frage blitz funke warnung info sanduhr balken uhr rakete buch zitat wuerfel person waage thema kopieren
    pfeil-links stecker vorlage klonen laptop schloss gehirn marke punkt ansicht telefon papierkorb aufgaben punkte kalender stift wolke-hoch
    wolke-runter wolke-aus ansicht-zeilen ansicht-spalten pfeil pfeil-oben pfeil-unten glocke handy zuruecksetzen tastatur`.split(/\s+/);
  assert.deepEqual(alt.filter((n) => !symbolNamen.includes(n)), []);
  assert.deepEqual(symbolNamen, Object.keys(ABBILDUNG));
});

test("Strichstärke: 1,5 px bis 16 px, 1,75 px ab 18 px; Größen 12/14/16/18/20/24", () => {
  assert.deepEqual(GROESSE, { klein: 12, text: 14, norm: 16, mittel: 18, gross: 20, kachel: 24 });
  for (const g of [12, 14, 16]) assert.equal(strichPx(g), 1.5, `${g}`);
  for (const g of [18, 20, 24, 56]) assert.equal(strichPx(g), 1.75, `${g}`);
});

// Namen, die das Studio anfordert: symbol("x"…), symbol(c ? "a" : "b"…), symbol: "x" / symbolName: "x" / sym: "x" (auch mit Auswahl), data-sym="x".
function ersterArgument(text, ab) { // Text der ersten Argumentliste-Position nach "symbol(" bis zum Komma/Klammerende auf Ebene 0
  let tiefe = 0, i = ab;
  for (; i < text.length; i++) {
    const c = text[i];
    if ("([{".includes(c)) tiefe++;
    else if (")]}".includes(c)) { if (tiefe === 0) break; tiefe--; }
    else if (c === "," && tiefe === 0) break;
    else if (c === '"' || c === "'" || c === "`") { const e = text.indexOf(c, i + 1); if (e < 0) break; i = e; }
  }
  return text.slice(ab, i);
}
const woerter = (ausdruck) => [...ausdruck.matchAll(/(?<![=!]=\s*|=\s*)"([a-z][a-z-]*)"/g)].map((m) => m[1]); // Vergleichswerte (=== "ok") sind keine Namen

function angeforderteNamen() {
  const treffer = new Map(); // name → Dateien
  const merke = (name, datei) => treffer.set(name, [...(treffer.get(name) || []), datei]);
  for (const datei of readdirSync(STUDIO).filter((n) => /\.(js|html)$/.test(n))) {
    if (["symbole.js", "ki-katalog.js", "marken.js"].includes(datei)) continue;
    const text = readFileSync(join(STUDIO, datei), "utf8");
    for (const m of text.matchAll(/\bsymbol\(/g)) for (const n of woerter(ersterArgument(text, m.index + m[0].length))) merke(n, datei);
    for (const m of text.matchAll(/\b(?:symbol|symbolName|sym|schildSymbol)\s*:\s*/g)) for (const n of woerter(ersterArgument(text, m.index + m[0].length))) merke(n, datei);
    for (const m of text.matchAll(/data-sym["']?\s*[=:]\s*"([a-z][a-z-]*)"/g)) merke(m[1], datei);
  }
  for (const m of readFileSync(join(W, "Ressourcen", "gemeinsam", "notizen.mjs"), "utf8").matchAll(/symbol: "([a-z-]+)"/g)) merke(m[1], "gemeinsam/notizen.mjs");
  return treffer;
}

test("jeder Symbolname, den das Studio anfordert, ist in symbole.js definiert", () => {
  const treffer = angeforderteNamen();
  assert.ok(treffer.size > 50, `zu wenige Namen gefunden (${treffer.size}) — Suchmuster prüfen`);
  const fehlt = [...treffer].filter(([n]) => !symbolNamen.includes(n)).map(([n, d]) => `${n} (${[...new Set(d)].join(", ")})`);
  assert.deepEqual(fehlt, []);
});

test("die Konzepte aus dem Entwurf haben ihre Lucide-Zeichen", () => {
  const soll = { vault: "library-big", frage: "message-circle-question", buch: "book-open", funke: "sparkles", verlauf: "history",
    darstellung: "palette", ki: "bot", automatik: "sprout", erweitert: "wrench" };
  for (const [k, l] of Object.entries(soll)) assert.equal(ABBILDUNG[k], l, k);
  const einst = readFileSync(join(STUDIO, "texte-einstellungen.js"), "utf8");
  for (const [id, sym] of Object.entries({ vaults: "vault", darstellung: "darstellung", ki: "ki", automatik: "automatik", erweitert: "erweitert", ueber: "kortex-spirale" })) {
    assert.match(einst, new RegExp(`id: "${id}", [^\\n]*symbol: "${sym}"`), `Einstellungen: ${id}`);
  }
});
