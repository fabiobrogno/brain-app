#!/usr/bin/env node
// scripts/erzeuge-gemeinsam-kopien.mjs — erzeugt die Studio-Kopien gemeinsamer Logik (das Studio lädt nur aus seinem eigenen Ordner).
//   Quelle:  Ressourcen/gemeinsam/<name>.mjs   (die einzige Quelle; Werkstatt und MCP importieren sie, Tests prüfen sie)
//   Ziel:    Ressourcen/studio/<name>.js        (Kopie mit Kopfzeile „ERZEUGT …“)
// Aufruf:   node scripts/erzeuge-gemeinsam-kopien.mjs            schreibt die Dateien
//           node scripts/erzeuge-gemeinsam-kopien.mjs --pruefen  prüft nur, ob die Kopien zur Quelle passen (Exit 1 sonst; auch Tests/Node/gemeinsam-kopien.test.mjs)
// (Die Tastenkürzel haben ihr eigenes Skript: erzeuge-tastenkuerzel.mjs.) Importe zwischen den Modulen sind relativ und gleich benannt („./zeit.mjs“ → „./zeit.js“).
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), "..");
export const MODULE = ["zeit", "wikilink", "kurzformen", "vorlagen", "kontingent-regeln"];
export const quelle = (name) => join(WURZEL, "Ressourcen", "gemeinsam", `${name}.mjs`);
export const ziel = (name) => join(WURZEL, "Ressourcen", "studio", `${name}.js`);
export const baueKopie = (name) =>
  `// ERZEUGT von scripts/erzeuge-gemeinsam-kopien.mjs aus Ressourcen/gemeinsam/${name}.mjs — nicht von Hand ändern.\n`
  + readFileSync(quelle(name), "utf8").replace(/(from\s+")\.\/([\w-]+)\.mjs(")/g, "$1./$2.js$3");

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes("--pruefen")) {
    for (const name of MODULE) {
      let ist = "";
      try { ist = readFileSync(ziel(name), "utf8"); } catch { /* fehlt */ }
      if (ist !== baueKopie(name)) { console.error(`${ziel(name)} passt nicht zur Quelle: node scripts/erzeuge-gemeinsam-kopien.mjs ausführen.`); process.exit(1); }
    }
    console.log("Studio-Kopien der gemeinsamen Module sind aktuell.");
  } else for (const name of MODULE) { writeFileSync(ziel(name), baueKopie(name)); console.log(`geschrieben: ${ziel(name)}`); }
}
