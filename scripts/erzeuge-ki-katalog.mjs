#!/usr/bin/env node
// scripts/erzeuge-ki-katalog.mjs — erzeugt Ressourcen/studio/ki-katalog.js aus dem KI-Katalog.
//   Quelle:  Ressourcen/gemeinsam/ki-katalog.json (+ die Logo-Dateien in Ressourcen/logos)
//   Ziel:    Ressourcen/studio/ki-katalog.js (das Studio lädt nur aus seinem eigenen Ordner und braucht die Logos sofort und ohne Netz)
// Aufruf:    node scripts/erzeuge-ki-katalog.mjs            schreibt die Datei
//            node scripts/erzeuge-ki-katalog.mjs --pruefen  prüft nur, ob die Datei zum Katalog passt (Exit 1 sonst; auch Tests/Node/ki-katalog.test.mjs)
// Die Logos werden hier nur eingelesen, nie verändert: SVG → Text mit der Ansicht (viewBox) aus dem Katalog, PNG → data:-Adresse.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ladeKatalog, logoVon, LOGO_ORDNER } from "../Ressourcen/gemeinsam/ki-katalog.mjs";

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), "..");
export const ZIEL = join(WURZEL, "Ressourcen", "studio", "ki-katalog.js");

/** Sicherheitsprüfung für eine SVG-Datei; gibt Fehlertexte zurück (leer = sauber). */
export function pruefeSvg(text) {
  const f = [];
  const t = text.toLowerCase();
  if (!/^<svg[\s>]/.test(text.trim())) f.push("beginnt nicht mit <svg");
  if (!/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(text)) f.push("xmlns fehlt");
  if (!/\sviewbox="[^"]+"/i.test(text)) f.push("viewBox fehlt");
  for (const [muster, grund] of [[/<script/, "script"], [/<foreignobject/, "foreignObject"], [/\son[a-z]+\s*=/, "Ereignis-Attribut"], [/<image[\s>]/, "eingebettetes Bild"],
    [/@import/, "@import"], [/<!doctype|<!entity|<\?xml/, "DOCTYPE/Entity/XML-Deklaration"], [/url\(\s*['"]?(?!#)/, "url() nach außen"], [/javascript:/, "javascript:"],
    [/<style[\s>]/, "style-Element"], [/<use[\s>]/, "use-Element"]]) if (muster.test(t)) f.push(grund);
  for (const m of text.matchAll(/(?:xlink:)?href\s*=\s*"([^"]*)"/g)) if (!m[1].startsWith("#")) f.push(`externer Verweis ${m[1].slice(0, 40)}`);
  return f;
}

/** Ersetzt das viewBox-Attribut der Wurzel; alles andere bleibt Zeichen für Zeichen gleich. */
export function mitAnsicht(text, ansicht) {
  const m = /^(<svg\b[^>]*?\sviewBox=")([^"]*)(")/i.exec(text.trim());
  if (!m) throw new Error("SVG ohne viewBox an der Wurzel");
  return text.trim().replace(m[0], m[1] + ansicht + m[3]);
}

export function baueStudioKatalog() {
  const katalog = ladeKatalog();
  const eintraege = katalog.map((e) => {
    const o = { id: e.id, name: e.name, art: e.art, beliebt: e.beliebt, verbindbar: e.verbindbar, website: e.website };
    const l = logoVon(e, katalog);
    if (l) {
      const pfad = join(LOGO_ORDNER, l.datei);
      if (l.datei.endsWith(".svg")) {
        const text = readFileSync(pfad, "utf8");
        const fehler = pruefeSvg(text);
        if (fehler.length) throw new Error(`${l.datei}: ${fehler.join(", ")}`);
        // <title> und role="img" gehören zur Datei (Simple Icons), nicht in die Seite: den Namen trägt der Rahmen (kiLogo) — sonst läse ein Screenreader ihn doppelt
        const svg = mitAnsicht(text, l.ansicht).replace(/\r?\n\s*/g, "").replace(/<title>[^<]*<\/title>/, "").replace(/^(<svg\b[^>]*?)\srole="img"/, "$1")
          .replace(/^<svg\b[^>]*>/, (wurzel) => wurzel.replace(/\s(?:width|height)="[^"]*"/g, "")); // die Größe setzt die Seite
        o.logo = { modus: l.modus, farbe: l.farbe, svg };
      } else {
        o.logo = { modus: l.modus, farbe: l.farbe, bild: "data:image/png;base64," + readFileSync(pfad).toString("base64") };
      }
    } else o.logo = null;
    return o;
  });
  const kopf = `// GENERIERT von scripts/erzeuge-ki-katalog.mjs aus Ressourcen/gemeinsam/ki-katalog.json und Ressourcen/logos — nicht von Hand ändern
// (node scripts/erzeuge-ki-katalog.mjs schreibt die Datei neu; Tests/Node/ki-katalog.test.mjs und die Vorprüfung melden, wenn sie nicht mehr passt).
// Der Katalog: Terminal-KIs, Editoren und Apps mit KI, in Anzeige-Reihenfolge. Logos lokal mitgeliefert, nie aus dem Netz (Herkunft: Ressourcen/logos/HERKUNFT.md).
// Die Marken gehören den jeweiligen Inhabern, Nutzung nur zur Kennzeichnung der Integration.
`;
  return `${kopf}export const KATALOG = [\n${eintraege.map((e) => "  " + JSON.stringify(e)).join(",\n")},\n];\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const neu = baueStudioKatalog();
  if (process.argv.includes("--pruefen")) {
    let alt = "";
    try { alt = readFileSync(ZIEL, "utf8"); } catch { /* fehlt */ }
    if (alt !== neu) { console.error("Ressourcen/studio/ki-katalog.js passt nicht zum Katalog — node scripts/erzeuge-ki-katalog.mjs ausführen."); process.exit(1); }
    console.log("ki-katalog.js passt zum Katalog.");
  } else {
    writeFileSync(ZIEL, neu);
    console.log(`geschrieben: ${ZIEL} (${(neu.length / 1024).toFixed(0)} KB)`);
  }
}
