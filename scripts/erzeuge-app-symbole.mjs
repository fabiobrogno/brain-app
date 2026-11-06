#!/usr/bin/env node
// scripts/erzeuge-app-symbole.mjs — erzeugt die wählbaren Dock-Symbole („Windung“ in fünf Farbwelten) aus dem SVG-Entwurf.
//   Quelle:  Ressourcen/icon-entwuerfe/kortex-3-windung.svg (volle Fassung) und kortex-3-windung-klein.svg (16/32 px, kräftigerer Strich)
//   Ziel:    Ressourcen/icon-entwuerfe/varianten/kortex-<name>.svg und -klein.svg  (erzeugte SVGs, im Repo)
//            Ressourcen/AppSymbole/<name>.icns                                    (landet im Paket unter Contents/Resources/AppSymbole/)
//            Ressourcen/studio/app-symbole/<name>.png                             (128 px, Kacheln in Einstellungen → Darstellung → App-Symbol; auch für „standard“)
// Gleiche Form und Windung wie das Standard-Symbol (AppIcon.icns, violett), nur Farben und Lichtführung ändern sich. „Standard“ hat keine
// eigene Datei: die App setzt dann kein eigenes Bild und das Dock zeigt AppIcon.icns.
// Aufruf:  node scripts/erzeuge-app-symbole.mjs            SVGs schreiben und mit rsvg-convert + iconutil die .icns bauen (macOS, brew install librsvg)
//          node scripts/erzeuge-app-symbole.mjs --pruefen  prüft nur: SVGs = Erzeugung, Standard = Quelle, .icns vorhanden und vollständig (Exit 1 sonst;
//                                                          auch Tests/Node/app-symbole.test.mjs). Die Pixel der .icns werden nicht verglichen (hängt von librsvg ab).
// Die erzeugten Dateien nie von Hand ändern: Farben gehören in PALETTEN unten.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENTWUERFE = join(WURZEL, "Ressourcen", "icon-entwuerfe");
export const VARIANTEN_ORDNER = join(ENTWUERFE, "varianten");
export const SYMBOLE_ORDNER = join(WURZEL, "Ressourcen", "AppSymbole");
export const VORSCHAU_ORDNER = join(WURZEL, "Ressourcen", "studio", "app-symbole");
export const VORSCHAU_PIXEL = 128;
export const QUELLE_GROSS = join(ENTWUERFE, "kortex-3-windung.svg");
export const QUELLE_KLEIN = join(ENTWUERFE, "kortex-3-windung-klein.svg");

// Farben der Quelle (Standard), die je Variante ersetzt werden. Jede Ersetzung muss genau treffen, sonst bricht die Erzeugung ab.
// grund = drei Stufen des Verlaufs (oben links → unten rechts), licht/boden = Innenlicht oben und Schatten unten (Farbe, Deckkraft),
// rand = Lichtkante oben/unten, tinte = Verlauf der Windung (oben → unten), schatten = Körper- und Windungsschatten,
// kante = feiner Rand außen (nur Papier, damit es auf hellem Dock nicht verschwindet), kleinGlyph = Farbe der Windung bei 16/32 px.
export const PALETTEN = {
  standard: null,
  dunkel: {
    grund: ["#404050", "#1B1B23", "#0C0C12"],
    licht: ["#8C8CA8", 0.3], boden: ["#000000", 0.3],
    randOben: ["#FFFFFF", 0.32], randUnten: ["#FFFFFF", 0.1],
    tinte: ["#F1EEFF", "#A99BFF"],
    schatten: ["#000000", "#000000"],
    kleinGlyph: "#C4BAFF",
  },
  graphit: {
    grund: ["#9A9EA8", "#5E626B", "#36393F"],
    licht: ["#FFFFFF", 0.4], boden: ["#0E0F12", 0.26],
    randOben: ["#FFFFFF", 0.6], randUnten: ["#FFFFFF", 0.16],
    tinte: ["#FFFFFF", "#E8E9ED"],
    schatten: ["#0A0B0D", "#15171A"],
    kleinGlyph: "#FFFFFF",
  },
  papier: {
    grund: ["#FFFDF9", "#F4F0E4", "#DAD2BC"],
    licht: ["#FFFFFF", 0.7], boden: ["#7A6A3C", 0.16],
    randOben: ["#FFFFFF", 0.9], randUnten: ["#6B5A2E", 0.22],
    tinte: ["#6D5FEA", "#3E32B0"],
    schatten: ["#5B4A1E", "#2A1F8A"],
    glyphSchattenDeckkraft: 0.2, koerperSchattenDeckkraft: 0.26,
    kante: ["#5A4D2A", 0.26],
    kleinGlyph: "#5B4ED6",
  },
  smaragd: {
    grund: ["#59D4AB", "#139C79", "#0A6350"],
    licht: ["#C4FFEA", 0.46], boden: ["#02261D", 0.24],
    randOben: ["#FFFFFF", 0.65], randUnten: ["#FFFFFF", 0.2],
    tinte: ["#FFFFFF", "#DDF7EC"],
    schatten: ["#021B14", "#04382B"],
    kleinGlyph: "#FFFFFF",
  },
};
export const NAMEN = Object.keys(PALETTEN);
export const NAMEN_OHNE_STANDARD = NAMEN.filter((n) => PALETTEN[n]);

function ersetze(svg, alt, neu) {
  const n = svg.split(alt).length - 1;
  if (n !== 1) throw new Error(`Erzeugung: „${alt.slice(0, 60)}“ kommt ${n}× in der Quelle vor (erwartet: 1×). Quelle und Palette passen nicht mehr zusammen.`);
  return svg.replace(alt, () => neu);
}
const stopp = (offset, farbe, deckkraft) => `<stop offset="${offset}" stop-color="${farbe}"${deckkraft === undefined ? "" : ` stop-opacity="${deckkraft}"`}/>`;
const GRUND_ALT = '<stop offset="0" stop-color="#8F85F7"/><stop offset="0.5" stop-color="#5B4ED6"/><stop offset="1" stop-color="#3A2EA6"/>';

export function variante(name, grossSvg) {
  const p = PALETTEN[name];
  if (p === undefined) throw new Error(`Unbekanntes Symbol: ${name}`);
  if (!p) return grossSvg;
  let s = grossSvg;
  s = ersetze(s, GRUND_ALT, stopp("0", p.grund[0]) + stopp("0.5", p.grund[1]) + stopp("1", p.grund[2]));
  s = ersetze(s, '<stop offset="0" stop-color="#C9C3FF" stop-opacity="0.46"/><stop offset="0.6" stop-color="#C9C3FF" stop-opacity="0"/>',
    stopp("0", p.licht[0], p.licht[1]) + stopp("0.6", p.licht[0], 0));
  s = ersetze(s, '<stop offset="0" stop-color="#0B0830" stop-opacity="0"/><stop offset="1" stop-color="#0B0830" stop-opacity="0.22"/>',
    stopp("0", p.boden[0], 0) + stopp("1", p.boden[0], p.boden[1]));
  s = ersetze(s, '<stop offset="0" stop-color="#FFFFFF" stop-opacity="0.65"/><stop offset="0.35" stop-color="#FFFFFF" stop-opacity="0.08"/><stop offset="0.8" stop-color="#FFFFFF" stop-opacity="0.02"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0.2"/>',
    stopp("0", p.randOben[0], p.randOben[1]) + stopp("0.35", p.randOben[0], +(p.randOben[1] * 0.12).toFixed(3)) + stopp("0.8", p.randUnten[0], 0.02) + stopp("1", p.randUnten[0], p.randUnten[1]));
  s = ersetze(s, '<stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#E3DFFF"/>', stopp("0", p.tinte[0]) + stopp("1", p.tinte[1]));
  s = ersetze(s, 'fill="#0A0724" opacity="0.30"', `fill="${p.schatten[0]}" opacity="${p.koerperSchattenDeckkraft ?? 0.3}"`);
  s = ersetze(s, 'stroke="#1B1470" stroke-width="46"', `stroke="${p.schatten[1]}" stroke-width="46"`);
  if (p.glyphSchattenDeckkraft !== undefined) s = ersetze(s, 'opacity="0.38" filter="url(#glyphSchatten)"', `opacity="${p.glyphSchattenDeckkraft}" filter="url(#glyphSchatten)"`);
  if (p.kante) s = ersetze(s, 'fill="url(#grund)"/>', `fill="url(#grund)" stroke="${p.kante[0]}" stroke-opacity="${p.kante[1]}" stroke-width="3"/>`);
  return s;
}

export function varianteKlein(name, kleinSvg) {
  const p = PALETTEN[name];
  if (p === undefined) throw new Error(`Unbekanntes Symbol: ${name}`);
  if (!p) return kleinSvg;
  let s = kleinSvg;
  s = ersetze(s, GRUND_ALT, stopp("0", p.grund[0]) + stopp("0.5", p.grund[1]) + stopp("1", p.grund[2]));
  s = ersetze(s, 'stroke="#FFFFFF" stroke-width="92.4"', `stroke="${p.kleinGlyph}" stroke-width="92.4"`);
  if (p.kante) s = ersetze(s, 'fill="url(#bg)"/>', `fill="url(#bg)" stroke="${p.kante[0]}" stroke-opacity="${Math.min(1, p.kante[1] * 1.6).toFixed(2)}" stroke-width="6"/>`);
  return s;
}

const les = (pfad) => readFileSync(pfad, "utf8");
/** Alle erzeugten SVGs: Dateiname → Inhalt. */
export function alleSvgs() {
  const gross = les(QUELLE_GROSS), klein = les(QUELLE_KLEIN), aus = {};
  for (const n of NAMEN_OHNE_STANDARD) {
    aus[`kortex-${n}.svg`] = variante(n, gross);
    aus[`kortex-${n}-klein.svg`] = varianteKlein(n, klein);
  }
  return aus;
}

// Größen wie bei AppIcon.icns (scripts/baue-icon.sh): 16/32 px aus der Kleinvariante, alles ab 64 px aus der vollen Fassung.
export const ICONSET = [
  ["icon_16x16.png", 16, true], ["icon_16x16@2x.png", 32, true], ["icon_32x32.png", 32, true], ["icon_32x32@2x.png", 64, false],
  ["icon_128x128.png", 128, false], ["icon_128x128@2x.png", 256, false], ["icon_256x256.png", 256, false], ["icon_256x256@2x.png", 512, false],
  ["icon_512x512.png", 512, false], ["icon_512x512@2x.png", 1024, false],
];
// Kennungen, die das iconset in der .icns ergibt (ic04 = 16, ic11 = 16@2x, ic05 = 32, ic12 = 32@2x, ic07 = 128, ic13 = 128@2x, ic08 = 256, ic14 = 256@2x, ic09 = 512, ic10 = 512@2x)
export const ICNS_KENNUNGEN = ["ic07", "ic08", "ic09", "ic10", "ic11", "ic12", "ic13", "ic14", "ic04", "ic05"];

/** Liest die Kennungen aus einer .icns (Kopf „icns“ + Gesamtlänge, dann Blöcke aus Kennung und Länge); null = keine gültige Datei. */
export function icnsKennungen(daten) {
  if (daten.length < 8 || daten.toString("latin1", 0, 4) !== "icns" || daten.readUInt32BE(4) !== daten.length) return null;
  const k = [];
  for (let o = 8; o + 8 <= daten.length;) {
    const len = daten.readUInt32BE(o + 4);
    if (len < 8) return null;
    k.push(daten.toString("latin1", o, o + 4));
    o += len;
  }
  return k;
}

function schreibeAlles() {
  const svgs = alleSvgs();
  mkdirSync(VARIANTEN_ORDNER, { recursive: true });
  mkdirSync(SYMBOLE_ORDNER, { recursive: true });
  for (const [datei, inhalt] of Object.entries(svgs)) writeFileSync(join(VARIANTEN_ORDNER, datei), inhalt);
  const env = { PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" }; // nur PATH, nichts aus der Umgebung des Aufrufers
  const tmp = mkdtempSync(join(tmpdir(), "kortex-app-symbole-"));
  try {
    for (const n of NAMEN_OHNE_STANDARD) {
      const satz = join(tmp, `${n}.iconset`);
      mkdirSync(satz);
      for (const [datei, px, klein] of ICONSET) {
        const svg = join(VARIANTEN_ORDNER, `kortex-${n}${klein ? "-klein" : ""}.svg`);
        execFileSync("rsvg-convert", ["-w", String(px), "-h", String(px), svg, "-o", join(satz, datei)], { env });
      }
      execFileSync("iconutil", ["-c", "icns", satz, "-o", join(SYMBOLE_ORDNER, `${n}.icns`)], { env });
      console.log(`Gebaut: Ressourcen/AppSymbole/${n}.icns`);
    }
    mkdirSync(VORSCHAU_ORDNER, { recursive: true });
    for (const n of NAMEN) {
      const svg = n === "standard" ? QUELLE_GROSS : join(VARIANTEN_ORDNER, `kortex-${n}.svg`);
      execFileSync("rsvg-convert", ["-w", String(VORSCHAU_PIXEL), "-h", String(VORSCHAU_PIXEL), svg, "-o", join(VORSCHAU_ORDNER, `${n}.png`)], { env });
    }
    console.log("Gebaut: Ressourcen/studio/app-symbole/*.png");
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

/** Breite und Höhe eines PNG (Kopf prüfen); null = kein PNG. */
export function pngMasse(daten) {
  if (daten.length < 24 || daten.toString("latin1", 1, 4) !== "PNG") return null;
  return [daten.readUInt32BE(16), daten.readUInt32BE(20)];
}

/** Liste der Abweichungen (leer = alles stimmt). */
export function pruefe() {
  const fehler = [];
  if (les(QUELLE_GROSS) !== variante("standard", les(QUELLE_GROSS))) fehler.push("Standard weicht von der Quelle ab");
  for (const [datei, soll] of Object.entries(alleSvgs())) {
    const pfad = join(VARIANTEN_ORDNER, datei);
    if (!existsSync(pfad)) fehler.push(`${datei} fehlt (node scripts/erzeuge-app-symbole.mjs)`);
    else if (les(pfad) !== soll) fehler.push(`${datei} stimmt nicht mit der Erzeugung überein (nicht von Hand ändern; neu erzeugen)`);
  }
  for (const n of NAMEN_OHNE_STANDARD) {
    const pfad = join(SYMBOLE_ORDNER, `${n}.icns`);
    if (!existsSync(pfad)) { fehler.push(`AppSymbole/${n}.icns fehlt`); continue; }
    const k = icnsKennungen(readFileSync(pfad));
    if (!k) fehler.push(`AppSymbole/${n}.icns ist keine gültige .icns`);
    else for (const id of ICNS_KENNUNGEN) if (!k.includes(id)) fehler.push(`AppSymbole/${n}.icns enthält ${id} nicht`);
  }
  for (const n of NAMEN) {
    const pfad = join(VORSCHAU_ORDNER, `${n}.png`);
    if (!existsSync(pfad)) { fehler.push(`studio/app-symbole/${n}.png fehlt`); continue; }
    const m = pngMasse(readFileSync(pfad));
    if (!m || m[0] !== VORSCHAU_PIXEL || m[1] !== VORSCHAU_PIXEL) fehler.push(`studio/app-symbole/${n}.png ist kein ${VORSCHAU_PIXEL}-px-PNG`);
  }
  return fehler;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes("--pruefen")) {
    const f = pruefe();
    if (f.length) { console.error(f.join("\n")); process.exit(1); }
    console.log("App-Symbole stimmen mit der Erzeugung überein.");
  } else schreibeAlles();
}
