#!/usr/bin/env node
// scripts/erzeuge-tastenkuerzel.mjs — erzeugt Ressourcen/studio/tastenkuerzel-register.js aus dem Register der Tastenkürzel.
//   Quelle:  Ressourcen/gemeinsam/tastenkuerzel-register.json (die einzige Quelle; die App liest sie direkt, die Werkstatt auch)
//   Ziel:    Ressourcen/studio/tastenkuerzel-register.js (das Studio lädt nur aus seinem eigenen Ordner und braucht das Register sofort, vor jeder Anfrage an die Werkstatt)
// Aufruf:   node scripts/erzeuge-tastenkuerzel.mjs            schreibt die Datei
//           node scripts/erzeuge-tastenkuerzel.mjs --pruefen  prüft nur, ob die Datei zum Register passt (Exit 1 sonst; auch Tests/Node/tastenkuerzel.test.mjs)
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), "..");
export const QUELLE = join(WURZEL, "Ressourcen", "gemeinsam", "tastenkuerzel-register.json");
export const ZIEL = join(WURZEL, "Ressourcen", "studio", "tastenkuerzel-register.js");

export function baueStudioRegister() {
  const r = JSON.parse(readFileSync(QUELLE, "utf8")); // (der Hinweis gehört in die Quelle, nicht in die Oberfläche)
  const zeilen = (liste) => liste.map((x) => `    ${JSON.stringify(x)}`).join(",\n");
  return `// ERZEUGT von scripts/erzeuge-tastenkuerzel.mjs aus Ressourcen/gemeinsam/tastenkuerzel-register.json — nicht von Hand ändern.\n`
    + `// Das Register aller Tastenkürzel (Befehle, Standard, reservierte Kürzel); die Logik steht in tastenkuerzel-logik.js.\n`
    + `export const REGISTER = {\n  "schema": ${JSON.stringify(r.schema)},\n  "tasten": ${JSON.stringify(r.tasten)},\n`
    + `  "gruppen": [\n${zeilen(r.gruppen)}\n  ],\n  "befehle": [\n${zeilen(r.befehle)}\n  ],\n  "reserviert": [\n${zeilen(r.reserviert)}\n  ]\n};\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const soll = baueStudioRegister();
  if (process.argv.includes("--pruefen")) {
    let ist = "";
    try { ist = readFileSync(ZIEL, "utf8"); } catch { /* fehlt */ }
    if (ist !== soll) { console.error("studio/tastenkuerzel-register.js passt nicht zum Register: node scripts/erzeuge-tastenkuerzel.mjs ausführen."); process.exit(1); }
    console.log("studio/tastenkuerzel-register.js ist aktuell.");
  } else {
    writeFileSync(ZIEL, soll);
    console.log(`geschrieben: ${ZIEL}`);
  }
}
