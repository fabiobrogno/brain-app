// gemeinsam/app-einstellungen.mjs — die Einstellungen der App selbst (nicht eines Vaults): <support>/einstellungen.json.
// Was zu einem Vault gehört (Pflege, Automatik, Sicherung …), steht weiter in dessen brain.config.json#automatik (kern/einstellungen.mjs, auch
// `brain einstellungen`); hier liegt nur, was für den ganzen Mac gilt: Darstellung, Mitteilungen. Eine Wahrheit je Wert — die Seite „Einstellungen“
// (werkstatt/einstellungen.mjs) führt beide Speicher in einer Route zusammen.
// Optimistische Sperre wie im Kern: `stand` = SHA-256 der rohen Dateibytes (fehlt die Datei: der Stand des leeren Textes). Geschrieben wird atomar
// (tmp + rename), nur geänderte Werte stehen in der Datei, `null` entfernt einen Wert (zurück auf den Standard). Eine kaputte Datei wird nie
// stillschweigend überschrieben: lesen liefert die Standardwerte und einen Fehlertext, schreiben meldet 500, bis sie repariert oder entfernt ist.
import { readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { HttpFehler } from "./basis.mjs";

export const DATEI = "einstellungen.json";

// Gleiche Form wie das Schema des Kerns (werte | typ + Grenzen), damit die Oberfläche beide gleich behandelt.
export const APP_SCHEMA = {
  // Darstellung (Thema und Lesebreite liegen als Geräte-Wahl im Studio selbst und kommen mit P3 hierher)
  schriftgroesse: { typ: "ganzzahl", min: 13, max: 19, standard: 15 },
  bewegung: { werte: ["system", "reduziert"], standard: "system" },
  // Mitteilungen: gemerkt wird die Wahl jetzt, ausgelöst werden die Mitteilungen mit Paket P8
  mitteilungenNurImHintergrund: { typ: "boolean", standard: true },
  mitteilungenTon: { typ: "boolean", standard: false },
  mitteilungenAbgelegt: { typ: "boolean", standard: true },
  mitteilungenAbgewiesen: { typ: "boolean", standard: true },
  mitteilungenRueckfragen: { typ: "boolean", standard: true },
  mitteilungenSicherung: { typ: "boolean", standard: true },
  mitteilungenKontingent: { typ: "boolean", standard: true },
  mitteilungenPflege: { typ: "boolean", standard: false },
};
export const APP_STANDARD = Object.fromEntries(Object.entries(APP_SCHEMA).map(([k, s]) => [k, s.standard]));

const standVon = (text) => createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
export const LEERER_STAND = standVon("");

export function istGueltig(schema, wert) {
  if (schema.werte) return schema.werte.includes(wert);
  if (schema.typ === "boolean") return typeof wert === "boolean";
  if (schema.typ === "ganzzahl") return Number.isInteger(wert) && wert >= schema.min && wert <= schema.max;
  return false;
}

// → { werte (Standard + Gespeichertes, nur Gültiges), gespeichert (nur was in der Datei steht), stand, fehler (Text oder null) }
export function leseApp(support) {
  const datei = join(support, DATEI);
  let text = "";
  try { text = readFileSync(datei, "utf8"); }
  catch (e) { if (e.code !== "ENOENT") return { werte: { ...APP_STANDARD }, gespeichert: {}, stand: LEERER_STAND, fehler: "Die Einstellungen der App konnten nicht gelesen werden.", text: null }; }
  const stand = standVon(text);
  if (!text.trim()) return { werte: { ...APP_STANDARD }, gespeichert: {}, stand, fehler: null, text };
  let j;
  try { j = JSON.parse(text); } catch { j = undefined; }
  if (!j || typeof j !== "object" || Array.isArray(j)) return { werte: { ...APP_STANDARD }, gespeichert: {}, stand, fehler: "Die Datei mit den Einstellungen der App ist beschädigt. Kortex nutzt die Standardwerte, bis sie repariert oder gelöscht ist.", text };
  const gespeichert = {};
  for (const [k, schema] of Object.entries(APP_SCHEMA)) if (k in j && istGueltig(schema, j[k])) gespeichert[k] = j[k];
  return { werte: { ...APP_STANDARD, ...gespeichert }, gespeichert, stand, fehler: null, text };
}

// Prüft neu gegen das Schema (unbekannt/ungültig → 400, null = zurück auf Standard). Rein, ohne Dateizugriff.
export function pruefeApp(neu) {
  if (neu === null || typeof neu !== "object" || Array.isArray(neu)) throw new HttpFehler(400, "Einstellungen müssen ein Objekt sein.");
  const geprueft = {};
  for (const [k, wert] of Object.entries(neu)) {
    const schema = Object.hasOwn(APP_SCHEMA, k) ? APP_SCHEMA[k] : undefined;
    if (!schema) throw new HttpFehler(400, `Unbekannte Einstellung „${k}“.`);
    if (wert !== null && !istGueltig(schema, wert)) throw new HttpFehler(400, `Ungültiger Wert für „${k}“.`);
    geprueft[k] = wert;
  }
  return geprueft;
}

// Schreibt die geprüften Werte (zusammengeführt mit dem, was schon dort steht). stand = der Stand, auf dem der Nutzer aufbaute: weicht die Datei ab → 409.
export function schreibeApp(support, neu, stand) {
  const geprueft = pruefeApp(neu);
  const jetzt = leseApp(support);
  if (jetzt.fehler) throw new HttpFehler(500, `Einstellungen der App nicht geschrieben: ${jetzt.fehler}`);
  if (jetzt.stand !== String(stand)) throw new HttpFehler(409, "Die Einstellungen wurden zwischenzeitlich geändert — bitte neu laden.", { art: "konflikt" });
  const zusammen = { ...jetzt.gespeichert };
  for (const [k, w] of Object.entries(geprueft)) { if (w === null) delete zusammen[k]; else zusammen[k] = w; }
  const inhalt = Object.keys(zusammen).length ? JSON.stringify(zusammen, null, 2) + "\n" : "";
  mkdirSync(support, { recursive: true });
  const datei = join(support, DATEI), tmp = `${datei}.${process.pid}.tmp`;
  try { writeFileSync(tmp, inhalt); renameSync(tmp, datei); }
  catch (e) { try { unlinkSync(tmp); } catch { /* egal */ } throw new HttpFehler(500, `Schreiben fehlgeschlagen: ${e.code || e.message}`); }
  return { stand: standVon(inhalt) };
}
