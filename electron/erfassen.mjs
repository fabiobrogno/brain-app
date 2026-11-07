// electron/erfassen.mjs — das Fenster „Schnell erfassen“ der Electron-Hülle (Paket W2b), reine Logik OHNE `import "electron"`. Ablauf wie ErfassenModell.swift / ErfassenPlatzierung.swift:
// Aufgabe (Kurzformen für Priorität und Fälligkeit, gemeinsam/kurzformen.mjs — dieselbe Datei wie in der Werkstatt) oder Notiz (Posteingang); gespeichert wird über dieselben Routen wie im Studio
// (POST /api/aufgaben, POST /api/merken), die Quelle setzt die Werkstatt fest, in einem nicht bestätigten Vault antwortet sie 409 `nicht-vertraut`. Die Eingabe geht als JSON hin.
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export const BREITE = 560, HOEHE = 276;
export const MAX_TEXT = 20_000;
export const MAX_TITEL = 120;
export const ARTEN = ["aufgabe", "notiz"];
export const PRIORITAETEN = ["niedrig", "normal", "hoch"];

/** Wo das Fenster erscheint: waagerecht mittig, oben im sichtbaren Bereich (Abstand 14 % der Höhe, zwischen 48 und 180), ganz im Bereich. `sichtbar` = { x, y, width, height } (Koordinaten wie Electron: Ursprung oben links). */
export function erfassenRahmen(sichtbar, groesse = { width: BREITE, height: HOEHE }) {
  const abstand = Math.min(180, Math.max(48, sichtbar.height * 0.14));
  let x = sichtbar.x + sichtbar.width / 2 - groesse.width / 2;
  let y = sichtbar.y + abstand;
  x = Math.max(sichtbar.x, Math.min(x, sichtbar.x + sichtbar.width - groesse.width));
  y = Math.max(sichtbar.y, Math.min(y, sichtbar.y + sichtbar.height - groesse.height));
  return { x: Math.round(x), y: Math.round(y), width: groesse.width, height: groesse.height };
}

const nurAnsehenText = (name) => `„${name}“ ist nur zum Ansehen freigegeben. Bestätige den Vault im Studio unter Einstellungen, dann kannst du hier speichern.`;
export const KEIN_VAULT = "Kein Vault gewählt. Wähle in Kortex einen Vault aus (Menü → Vault wechseln …).";
export const hinweisFuerVault = ({ name, erlaubt }) => (!name ? KEIN_VAULT : erlaubt ? null : nurAnsehenText(name));

const kuerze = (s) => { let kopf = Array.from(s).slice(0, MAX_TITEL - 1).join(""); const i = kopf.lastIndexOf(" "); if (i > MAX_TITEL / 2) kopf = kopf.slice(0, i); return `${kopf.trim()}…`; };
const bereinigt = (s) => s.replace(/[\u2028\u2029]/g, "\n"); // Zeilentrenner von Unicode werden zu Zeilenumbrüchen
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Prüft die Eingabe des Fensters (kommt aus der Seite, also nie vertrauen) → { ok:true, wert } | { ok:false, text } */
export function pruefeEingabe(e) {
  if (!e || typeof e !== "object" || Array.isArray(e)) return { ok: false, text: "Ungültige Eingabe." };
  if (!ARTEN.includes(e.art) || typeof e.text !== "string" || e.text.length > MAX_TEXT) return { ok: false, text: "Ungültige Eingabe." };
  const prio = e.prioritaet ?? null, faellig = e.faellig ?? "auto";
  if (prio !== null && !PRIORITAETEN.includes(prio)) return { ok: false, text: "Ungültige Eingabe." };
  if (faellig !== "auto" && faellig !== "keine" && !(typeof faellig === "string" && ISO.test(faellig))) return { ok: false, text: "Ungültige Eingabe." };
  return { ok: true, wert: { art: e.art, text: e.text, prioritaet: prio, faellig, erkennePrioritaet: e.erkennePrioritaet !== false, erkenneFaelligkeit: e.erkenneFaelligkeit !== false } };
}

/** Route und Körper (ErfassenModell.baue + WerkstattErfassenSpeicher.anfrage) → { pfad, koerper } | { fehler }. `liesKurzformen` aus gemeinsam/kurzformen.mjs; `heute` = Kalendertag (nur für Tests). */
export function baueAnfrage(wert, { liesKurzformen, heute } = {}) {
  const roh = bereinigt(wert.text);
  if (!roh.trim()) return { fehler: "Schreib erst etwas auf." };
  if (wert.art === "notiz") return { pfad: "/api/merken", koerper: { text: roh.trim() } };
  const k = liesKurzformen(roh, { heute, prioritaet: wert.erkennePrioritaet, faellig: wert.erkenneFaelligkeit });
  let titel = k.titel, rest = k.text;
  if (!titel) return { fehler: "Die Aufgabe braucht einen Titel." };
  if (Array.from(titel).length > MAX_TITEL) { rest = rest ? `${titel}\n\n${rest}` : titel; titel = kuerze(titel); } // ein langer Gedanke wird nicht abgeschnitten: ganze Zeile im Text der Aufgabe
  const koerper = { titel };
  if (rest) koerper.text = rest;
  const prio = wert.prioritaet ?? k.prioritaet;
  if (prio) koerper.prioritaet = prio;
  const faellig = wert.faellig === "auto" ? k.faellig : wert.faellig === "keine" ? null : wert.faellig;
  if (faellig) koerper.faellig = faellig;
  return { pfad: "/api/aufgaben", koerper };
}

/** Antwort der Werkstatt → { ok:true, vault } | { ok:false, text } (wie WerkstattAntwort.auswerten / EinrichtungsFehler: 409 nicht-vertraut → „nur zum Ansehen“) */
export function antwortAus({ status, json }, vaultName) {
  if (status >= 200 && status < 300 && typeof json?.pfad === "string" && json.pfad) return { ok: true, vault: vaultName };
  if (status === 409 && json?.art === "nicht-vertraut") return { ok: false, text: nurAnsehenText(vaultName), nichtVertraut: true };
  const text = typeof json?.fehler === "string" && json.fehler ? json.fehler.slice(0, 300) : "Das Speichern hat nicht geklappt.";
  return { ok: false, text: status >= 200 && status < 300 ? "Die Antwort des Hintergrunddienstes war unvollständig." : text };
}

// ───────────── Einstellungen des Fensters: <support>/schnell-erfassen.json { art?, kuerzel? } (dieselbe Datei wie die Mac-App; kaputt oder fehlend → Standard) ─────────────
const DATEI = "schnell-erfassen.json";
export function leseErfassenEinstellungen(support) {
  try { const j = JSON.parse(readFileSync(join(support, DATEI), "utf8")); return j && typeof j === "object" && !Array.isArray(j) ? j : {}; } catch { return {}; }
}
export const leseArt = (support) => { const a = leseErfassenEinstellungen(support).art; return ARTEN.includes(a) ? a : "aufgabe"; };
/** Merkt die zuletzt benutzte Art; andere Schlüssel der Datei (z. B. das Kürzel der Mac-App) bleiben erhalten. */
export function merkeArt(support, art) {
  if (!ARTEN.includes(art)) return false;
  try {
    mkdirSync(support, { recursive: true });
    const datei = join(support, DATEI), tmp = `${datei}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ ...leseErfassenEinstellungen(support), art }, null, 2) + "\n");
    renameSync(tmp, datei);
    return true;
  } catch { return false; }
}
