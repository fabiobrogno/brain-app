// gemeinsam/ki-katalog.mjs — der Katalog der KI-Programme (Terminal-KIs, Editoren und Apps mit KI) als EINZIGE Quelle.
// Die Daten stehen in ki-katalog.json (neben dieser Datei). Genutzt von:
//   - dem Kern/der Werkstatt (Erkennung: gemeinsam/ki.mjs → erkenneKatalog; ki-programme/programme.mjs → Erkennung der Einstellungsdateien),
//   - dem Studio (Ressourcen/studio/ki-katalog.js wird daraus von scripts/erzeuge-ki-katalog.mjs erzeugt; ein Test prüft, dass es stimmt),
//   - Swift (Sources/BrainCore/KiKatalog.swift liest dieselbe JSON-Datei; KILogoQuelle nimmt Logo-Datei, Ansicht und Farbe von dort).
// Logos: Ressourcen/logos/<datei> (Herkunft je Datei: Ressourcen/logos/HERKUNFT.md).
//
// Eintrag:
//   id          stabiler Name (bei verbindbaren KIs gleich dem Wert `ziel` bei POST /api/mcp/verbinden)
//   name        Anzeigename
//   art         "terminal" (Programm im Terminal) | "app" (Mac-App) | "editor" (Editor/IDE mit KI)
//   befehle     Programmnamen im PATH, an denen die Erkennung das Programm findet (leer = nur App)
//   apps        Namen der Mac-Apps in /Applications bzw. ~/Applications (leer = nur Befehl)
//   website     offizielle Seite
//   beliebt     true = steht ohne Aufklappen zur Wahl, wenn nichts erkannt wurde (Reihenfolge der Liste)
//   verbindbar  true = Kortex kann sich dort selbst eintragen (ki-programme/programme.mjs bzw. claude/codex über deren Befehl)
//   logo        { datei, modus, farbe, ansicht } oder null (kein echtes Logo: die Oberfläche zeigt die Initiale)
//                 datei   Dateiname in Ressourcen/logos (svg oder png)
//                 modus   "einfarbig" (Textfarbe) | "marke" (eine Markenfarbe, `farbe`) | "bild" (mehrfarbig bzw. PNG, unverändert)
//                 farbe   "#RRGGBB" bei "marke", sonst null
//                 ansicht "x y breite höhe": viewBox für die Darstellung einer SVG (Quadrat um die Glyphe, Füllung nach Tintendichte), sonst null
//   teilt_logo  statt `logo`: nimmt das Logo eines anderen Eintrags (Claude Desktop zeigt das Zeichen von Claude)
//
// Herkunft des Katalogs: Muster der Programmliste von Orca (https://github.com/stablyai/orca, src/shared/tui-agent-config.ts und
// src/renderer/src/lib/agent-catalog-entries-*.ts @9bccd67, MIT, Copyright (c) 2026 Lovecast Inc.; Text in THIRD-PARTY-NOTICES.md).
// Keine Abhängigkeiten.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
export const KATALOG_DATEI = join(HIER, "ki-katalog.json");
export const LOGO_ORDNER = join(HIER, "..", "logos");

export const ARTEN = ["terminal", "app", "editor"];
export const MODI = ["einfarbig", "marke", "bild"];

const ID_OK = /^[a-z0-9][a-z0-9-]*$/;
const BEFEHL_OK = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const APP_OK = /^[A-Za-z0-9][A-Za-z0-9 ._-]*\.app$/;
const ANSICHT_OK = /^-?\d+(\.\d+)? -?\d+(\.\d+)? \d+(\.\d+)? \d+(\.\d+)?$/;
const DATEI_OK = /^[a-z0-9][a-z0-9-]*\.(svg|png)$/;

/** Prüft die Struktur eines Katalogs; gibt eine Liste von Fehlertexten zurück (leer = in Ordnung). */
export function pruefeKatalog(k) {
  const f = [];
  if (!k || typeof k !== "object" || !Array.isArray(k.eintraege)) return ["Katalog hat keine Liste `eintraege`"];
  if (k.schema !== 1) f.push("schema muss 1 sein");
  const ids = new Set();
  for (const [i, e] of k.eintraege.entries()) {
    const wo = `eintraege[${i}] (${e?.id})`;
    if (!e || typeof e !== "object") { f.push(`${wo}: kein Objekt`); continue; }
    if (typeof e.id !== "string" || !ID_OK.test(e.id)) f.push(`${wo}: id ungültig`);
    else if (ids.has(e.id)) f.push(`${wo}: id doppelt`);
    else ids.add(e.id);
    if (typeof e.name !== "string" || !e.name.trim() || e.name.length > 40) f.push(`${wo}: name fehlt oder zu lang (höchstens 40 Zeichen, damit er ohne Umbruch passt)`);
    if (!ARTEN.includes(e.art)) f.push(`${wo}: art muss ${ARTEN.join(" | ")} sein`);
    if (!Array.isArray(e.befehle) || !e.befehle.every((b) => typeof b === "string" && BEFEHL_OK.test(b))) f.push(`${wo}: befehle ungültig`);
    if (!Array.isArray(e.apps) || !e.apps.every((a) => typeof a === "string" && APP_OK.test(a))) f.push(`${wo}: apps ungültig`);
    if (Array.isArray(e.befehle) && Array.isArray(e.apps) && !e.befehle.length && !e.apps.length) f.push(`${wo}: weder Befehl noch App zur Erkennung`);
    if (typeof e.website !== "string" || !/^https:\/\/[^\s]+$/.test(e.website)) f.push(`${wo}: website muss eine https-Adresse sein`);
    if (typeof e.beliebt !== "boolean") f.push(`${wo}: beliebt muss true/false sein`);
    if (typeof e.verbindbar !== "boolean") f.push(`${wo}: verbindbar muss true/false sein`);
    const hatLogo = e.logo !== undefined && e.logo !== null;
    if (e.teilt_logo !== undefined) {
      if (hatLogo || typeof e.teilt_logo !== "string") f.push(`${wo}: teilt_logo und logo schließen sich aus`);
    } else if (e.logo === undefined) f.push(`${wo}: logo fehlt (null, wenn es kein echtes Logo gibt)`);
    if (hatLogo) {
      const l = e.logo;
      if (typeof l.datei !== "string" || !DATEI_OK.test(l.datei)) f.push(`${wo}: logo.datei ungültig`);
      if (!MODI.includes(l.modus)) f.push(`${wo}: logo.modus muss ${MODI.join(" | ")} sein`);
      if (l.modus === "marke" ? !/^#[0-9A-Fa-f]{6}$/.test(l.farbe || "") : l.farbe !== null) f.push(`${wo}: logo.farbe nur bei modus "marke" (#RRGGBB)`);
      const svg = typeof l.datei === "string" && l.datei.endsWith(".svg");
      if (svg ? !(typeof l.ansicht === "string" && ANSICHT_OK.test(l.ansicht)) : l.ansicht !== null) f.push(`${wo}: logo.ansicht gehört zu SVG-Dateien ("x y w h"), bei PNG null`);
      if (!svg && l.modus === "marke") f.push(`${wo}: PNG kann keine Markenfarbe tragen`);
    }
  }
  for (const e of k.eintraege) if (typeof e?.teilt_logo === "string" && !ids.has(e.teilt_logo)) f.push(`${e.id}: teilt_logo zeigt auf unbekannte id ${e.teilt_logo}`);
  return f;
}

let zwischen = null;
/** Der Katalog (einmal gelesen und geprüft; ein kaputter Katalog ist ein Programmierfehler und wirft). */
export function ladeKatalog() {
  if (zwischen) return zwischen;
  const k = JSON.parse(readFileSync(KATALOG_DATEI, "utf8"));
  const fehler = pruefeKatalog(k);
  if (fehler.length) throw new Error("ki-katalog.json ist fehlerhaft: " + fehler.join("; "));
  zwischen = Object.freeze(k.eintraege.map((e) => Object.freeze(e)));
  return zwischen;
}

export const katalogEintrag = (id) => ladeKatalog().find((e) => e.id === id) || null;

/** Das Logo eines Eintrags (folgt `teilt_logo`), sonst null. */
export function logoVon(eintrag, katalog = ladeKatalog()) {
  if (!eintrag) return null;
  if (eintrag.teilt_logo) return logoVon(katalog.find((e) => e.id === eintrag.teilt_logo), katalog);
  return eintrag.logo || null;
}
