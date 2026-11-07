#!/usr/bin/env node
// scripts/erzeuge-electron-symbole.mjs — die fünf App-Symbole (standard, dunkel, graphit, papier, smaragd) als PNG und ICO für die Electron-Hülle (Windows/Linux, Paket W2b).
//   Quelle:  dieselben SVGs wie die Mac-Symbole (scripts/erzeuge-app-symbole.mjs: Ressourcen/icon-entwuerfe/kortex-3-windung*.svg und varianten/*.svg) — keine zweite Farbpalette.
//   Ziel:    electron/symbole/<name>.png  (256 px, Symbol des Fensters und des Starters)
//            electron/symbole/<name>.ico  (16/32/48/64/128/256 px als PNG-Bilder in einer ICO-Datei; 16 und 32 px aus der Kleinvariante, wie bei der .icns)
//            electron/symbole/tray-<name>.png  (32 px aus der Kleinvariante: Tray-Symbol, Electron skaliert auf die Größe des Systems)
// Aufruf:  node scripts/erzeuge-electron-symbole.mjs            erzeugen (braucht rsvg-convert: brew install librsvg)
//          node scripts/erzeuge-electron-symbole.mjs --pruefen  prüft nur: alle Dateien da, PNG-Kopf, ICO-Verzeichnis (Exit 1 sonst; auch Tests/Node/electron-symbole.test.mjs)
// Die erzeugten Dateien nie von Hand ändern.
import { readFileSync, writeFileSync, mkdirSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { NAMEN, VARIANTEN_ORDNER, QUELLE_GROSS, QUELLE_KLEIN, pngMasse } from "./erzeuge-app-symbole.mjs";

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), "..");
export const ZIEL = join(WURZEL, "electron", "symbole");
export const GROESSEN_ICO = [[16, true], [32, true], [48, false], [64, false], [128, false], [256, false]]; // [Pixel, aus der Kleinvariante]
export const PNG_PIXEL = 256, TRAY_PIXEL = 32;

const quelle = (name, klein) => (name === "standard" ? (klein ? QUELLE_KLEIN : QUELLE_GROSS) : join(VARIANTEN_ORDNER, `kortex-${name}${klein ? "-klein" : ""}.svg`));

/** ICO mit PNG-Bildern (seit Windows Vista erlaubt): Kopf, Verzeichnis (16 Byte je Bild), dann die PNG-Daten. 256 px steht im Verzeichnis als 0. */
export function baueIco(bilder) {
  const kopf = Buffer.alloc(6 + 16 * bilder.length);
  kopf.writeUInt16LE(0, 0); kopf.writeUInt16LE(1, 2); kopf.writeUInt16LE(bilder.length, 4);
  let offset = kopf.length;
  bilder.forEach(({ px, png }, i) => {
    const o = 6 + 16 * i;
    kopf.writeUInt8(px >= 256 ? 0 : px, o); kopf.writeUInt8(px >= 256 ? 0 : px, o + 1); kopf.writeUInt8(0, o + 2); kopf.writeUInt8(0, o + 3);
    kopf.writeUInt16LE(1, o + 4); kopf.writeUInt16LE(32, o + 6); kopf.writeUInt32LE(png.length, o + 8); kopf.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([kopf, ...bilder.map((b) => b.png)]);
}
/** Liest das Verzeichnis einer ICO-Datei → [{ breite, hoehe, laenge, offset }] oder null (keine gültige ICO). */
export function leseIco(daten) {
  if (daten.length < 6 || daten.readUInt16LE(0) !== 0 || daten.readUInt16LE(2) !== 1) return null;
  const n = daten.readUInt16LE(4), aus = [];
  if (!n || daten.length < 6 + 16 * n) return null;
  for (let i = 0; i < n; i++) {
    const o = 6 + 16 * i, laenge = daten.readUInt32LE(o + 8), offset = daten.readUInt32LE(o + 12);
    if (offset + laenge > daten.length) return null;
    aus.push({ breite: daten[o] || 256, hoehe: daten[o + 1] || 256, laenge, offset });
  }
  return aus;
}

function erzeuge() {
  mkdirSync(ZIEL, { recursive: true });
  const env = { PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" }; // nur PATH, nichts aus der Umgebung des Aufrufers
  const tmp = mkdtempSync(join(tmpdir(), "kortex-electron-symbole-"));
  const png = (svg, px) => { const aus = join(tmp, `${px}-${Math.random().toString(36).slice(2)}.png`); execFileSync("rsvg-convert", ["-w", String(px), "-h", String(px), svg, "-o", aus], { env }); return readFileSync(aus); };
  try {
    for (const n of NAMEN) {
      writeFileSync(join(ZIEL, `${n}.png`), png(quelle(n, false), PNG_PIXEL));
      writeFileSync(join(ZIEL, `tray-${n}.png`), png(quelle(n, true), TRAY_PIXEL));
      writeFileSync(join(ZIEL, `${n}.ico`), baueIco(GROESSEN_ICO.map(([px, klein]) => ({ px, png: png(quelle(n, klein), px) }))));
      console.log(`Gebaut: electron/symbole/${n}.png, tray-${n}.png, ${n}.ico`);
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

/** Liste der Abweichungen (leer = alles stimmt). Die Pixel werden nicht verglichen (hängt von librsvg ab). */
export function pruefe() {
  const fehler = [];
  for (const n of NAMEN) {
    for (const [datei, px] of [[`${n}.png`, PNG_PIXEL], [`tray-${n}.png`, TRAY_PIXEL]]) {
      const pfad = join(ZIEL, datei);
      if (!existsSync(pfad)) { fehler.push(`symbole/${datei} fehlt (node scripts/erzeuge-electron-symbole.mjs)`); continue; }
      const m = pngMasse(readFileSync(pfad));
      if (!m || m[0] !== px || m[1] !== px) fehler.push(`symbole/${datei} ist kein ${px}-px-PNG`);
    }
    const ico = join(ZIEL, `${n}.ico`);
    if (!existsSync(ico)) { fehler.push(`symbole/${n}.ico fehlt`); continue; }
    const daten = readFileSync(ico), v = leseIco(daten);
    if (!v) { fehler.push(`symbole/${n}.ico ist keine gültige ICO`); continue; }
    const soll = GROESSEN_ICO.map(([px]) => px);
    if (v.map((b) => b.breite).join() !== soll.join()) fehler.push(`symbole/${n}.ico enthält die Größen ${v.map((b) => b.breite).join("/")}, erwartet ${soll.join("/")}`);
    for (const b of v) { const m = pngMasse(daten.subarray(b.offset, b.offset + b.laenge)); if (!m || m[0] !== b.breite || m[1] !== b.hoehe) fehler.push(`symbole/${n}.ico: Bild ${b.breite} px ist kein passendes PNG`); }
  }
  return fehler;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes("--pruefen")) {
    const f = pruefe();
    if (f.length) { console.error(f.join("\n")); process.exit(1); }
    console.log("Electron-Symbole sind vollständig.");
  } else erzeuge();
}
