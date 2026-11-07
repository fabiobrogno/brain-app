// electron/export-schreiben.mjs — Export für die Electron-Hülle (Aktionen `export-speichern`, `export-pdf`): Prüfung des Bündels und Schreiben nach dem Speichern-Dialog.
// Dieselben Regeln wie Sources/BrainCore/ExportBuendel.swift (Mac-App): nur relative, harmlose Pfade, begrenzte Größe, nie durch einen Symlink und nie aus dem gewählten Ort heraus.
// Reine Logik ohne `import "electron"`: Tests/Node/export-huelle.test.mjs prüft sie ohne Electron.
import { mkdirSync, writeFileSync, renameSync, lstatSync, realpathSync, existsSync, unlinkSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { randomBytes } from "node:crypto";

export const MAX_DATEIEN = 2000, MAX_BYTES = 96 * 1024 * 1024, MAX_PFAD = 240, MAX_TIEFE = 16, MAX_HTML = 80 * 1024 * 1024, MAX_TEIL_TEXT = 8 * 1024 * 1024;
const STEUER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

export function sicherePfad(p) {
  if (typeof p !== "string" || !p || [...p].length > MAX_PFAD || p.startsWith("/")) return false;
  const teile = p.split("/");
  if (teile.length > MAX_TIEFE) return false;
  return teile.every((t) => t && t !== "." && t !== ".." && !t.startsWith(".") && !/[\\:\0]/.test(t) && !STEUER.test(t));
}
export function dateiname(n) {
  if (typeof n !== "string") return null;
  const t = n.trim();
  if (!t || [...t].length > 120 || t.startsWith(".") || /[\/\\:\0]/.test(t) || STEUER.test(t)) return null;
  return t;
}

// → { name, haupt, ordner, dateien: [{ pfad, daten: Buffer }] } | null
export function pruefeBuendel(w) {
  if (!w || typeof w !== "object" || Array.isArray(w)) return null;
  const name = dateiname(w.name);
  if (!name || !sicherePfad(w.haupt) || !Array.isArray(w.dateien) || !w.dateien.length || w.dateien.length > MAX_DATEIEN) return null;
  if (w.ordner !== undefined && w.ordner !== null && typeof w.ordner !== "boolean") return null;
  const ordner = w.ordner === true;
  const dateien = [], gesehen = new Set();
  let gesamt = 0;
  for (const e of w.dateien) {
    if (!e || typeof e !== "object" || !sicherePfad(e.pfad) || gesehen.has(e.pfad.toLowerCase())) return null;
    gesehen.add(e.pfad.toLowerCase());
    let daten;
    if (typeof e.text === "string") daten = Buffer.from(e.text, "utf8");
    else if (typeof e.base64 === "string" && /^[A-Za-z0-9+/]*={0,2}$/.test(e.base64)) daten = Buffer.from(e.base64, "base64");
    else return null;
    gesamt += daten.length;
    if (gesamt > MAX_BYTES) return null;
    dateien.push({ pfad: e.pfad, daten });
  }
  if (!ordner && !dateien.some((d) => d.pfad === w.haupt)) return null;
  return { name, haupt: w.haupt, ordner, dateien };
}
// → { name, html } | null
export function pruefePdf(w) {
  if (!w || typeof w !== "object" || Array.isArray(w) || typeof w.html !== "string" || !w.html || Buffer.byteLength(w.html) > MAX_HTML) return null;
  const n = dateiname(w.name);
  if (!n) return null;
  return { name: /\.pdf$/i.test(n) ? n : `${n}.pdf`, html: w.html };
}
// → { name, text } | null (für spätere Hüllen mit Teilen-Menü; die Electron-Hülle kennt `teilen` nicht)
export function pruefeTeilen(w) {
  if (!w || typeof w !== "object" || typeof w.text !== "string" || Buffer.byteLength(w.text) > MAX_TEIL_TEXT) return null;
  const n = dateiname(w.name);
  return n ? { name: n, text: w.text } : null;
}

const TEXTENDUNG = /\.(md|html|pdf|zip)$/i;
const istVerweis = (p) => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };
function echt(p) { try { return realpathSync.native(p); } catch { return p; } }
const innerhalb = (p, wurzel) => { const a = echt(p), b = echt(wurzel); return a === b || a.startsWith(b.endsWith("/") || b.endsWith("\\") ? b : b + (process.platform === "win32" ? "\\" : "/")); };

// Schreibt atomar (Temp-Datei im selben Ordner, dann umbenennen)
export function schreibeAtomar(ziel, daten) {
  const tmp = join(dirname(ziel), `.kortex-export-${process.pid}-${randomBytes(4).toString("hex")}`);
  try { writeFileSync(tmp, daten, { flag: "wx", mode: 0o644 }); renameSync(tmp, ziel); }
  catch (e) { try { unlinkSync(tmp); } catch { /* schon weg */ } throw e; }
}

/**
 * Schreibt das Bündel an den gewählten Ort `ziel` (Speichern-Dialog). Einzeldatei: die Hauptdatei kommt an `ziel`, alle anderen relativ zum Ordner daneben.
 * Ordner: `ziel` wird der Ordner, der erste Pfadteil jeder Datei steht für ihn. Texte (.md .html .pdf .zip) werden ersetzt (der Dialog hat bestätigt); alles andere (Bilder mit Kurz-Hash)
 * nur, wenn es fehlt. Wirft { grund: "ausserhalb" | "verweis" }.
 */
export function schreibeBuendel(b, ziel) {
  const basis = b.ordner ? ziel : dirname(ziel);
  if (b.ordner) mkdirSync(ziel, { recursive: true });
  for (const d of b.dateien) {
    let teile = d.pfad.split("/");
    let ist;
    if (!b.ordner && d.pfad === b.haupt) ist = ziel;
    else { if (b.ordner) teile = teile.slice(1); if (!teile.length) continue; ist = join(basis, ...teile); }
    mkdirSync(dirname(ist), { recursive: true });
    if (!innerhalb(dirname(ist), basis)) throw Object.assign(new Error("ausserhalb"), { grund: "ausserhalb" });
    if (existsSync(ist) || istVerweis(ist)) {
      if (istVerweis(ist)) throw Object.assign(new Error("verweis"), { grund: "verweis" });
      if (!TEXTENDUNG.test(basename(ist))) continue; // Bild mit Kurz-Hash: gleicher Name = gleicher Inhalt
    }
    schreibeAtomar(ist, d.daten);
  }
  return basename(ziel);
}
