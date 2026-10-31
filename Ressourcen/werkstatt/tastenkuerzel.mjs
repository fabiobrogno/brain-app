// werkstatt/tastenkuerzel.mjs — GET/PUT /api/tastenkuerzel: die eigenen Tastenkürzel (Paket P10, Bereich „Tastenkürzel“ in den Einstellungen).
// Gespeichert wird nur, was vom Standard abweicht, in einer eigenen Datei <support>/tastenkuerzel.json:
//   { "schema": 1, "kuerzel": { "<befehl>": "Cmd+T" | null } }          fehlt ein Befehl, gilt sein Standard; null = bewusst ohne Kürzel
// Die Befehle und ihre Standardkürzel stehen im Register (gemeinsam/tastenkuerzel-register.json) — die einzige Quelle für Studio, Menüs und globale Kürzel der App.
// Die App (Swift) liest dieselbe Datei und dasselbe Register; sie meldet die globalen Kürzel beim System an.
//   GET → { stand, ueberschrieben, belegung, datei, fehler? }             belegung: wirksam je Befehl (Standard + Eigenes)
//   PUT { werte: { id: "Cmd+T" | null }, zurueck: ["id", …] | "alle", stand } → { ok, … } wie GET
// `stand` = SHA-256 der Dateibytes (fehlt die Datei: der Stand des leeren Textes). Hat inzwischen jemand anderes geschrieben (die App, ein zweites Fenster), antwortet die Route
// 409 (art „konflikt“) und die Oberfläche lädt neu. Alles wird geprüft, bevor etwas geschrieben wird; ein Kürzel, das macOS gehört oder nicht gültig ist, gibt 400.
// Doppelt belegte Kürzel sind erlaubt (die Oberfläche fragt vorher „Trotzdem?“). Eine kaputte Datei wird nie überschrieben: lesen liefert die Standardwerte und einen Fehlertext.
import { readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { HttpFehler } from "../gemeinsam/basis.mjs";
import { pruefe, saeubere, wirksam } from "../studio/tastenkuerzel-logik.js";

export const DATEI = "tastenkuerzel.json";
const REGISTER_DATEI = join(dirname(fileURLToPath(import.meta.url)), "..", "gemeinsam", "tastenkuerzel-register.json");
export const ladeRegister = () => JSON.parse(readFileSync(REGISTER_DATEI, "utf8"));

const standVon = (text) => createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
export const LEERER_STAND = standVon("");
const STAND_MUSTER = /^[0-9a-f]{64}$/;

// → { ueberschrieben (gesäubert), stand, fehler (Text oder null) }
export function leseDatei(support, register = ladeRegister()) {
  let text = "";
  try { text = readFileSync(join(support, DATEI), "utf8"); }
  catch (e) { if (e.code !== "ENOENT") return { ueberschrieben: {}, stand: LEERER_STAND, fehler: "Die Datei mit den Tastenkürzeln konnte nicht gelesen werden." }; }
  const stand = standVon(text);
  if (!text.trim()) return { ueberschrieben: {}, stand, fehler: null };
  let j;
  try { j = JSON.parse(text); } catch { j = undefined; }
  if (!j || typeof j !== "object" || Array.isArray(j)) return { ueberschrieben: {}, stand, fehler: "Die Datei mit den Tastenkürzeln ist beschädigt. Kortex nutzt die Standardkürzel, bis sie repariert oder gelöscht ist." };
  return { ueberschrieben: saeubere(register, j.kuerzel), stand, fehler: null };
}

// deps: { support }
export function erzeugeTastenkuerzel({ support }) {
  const register = ladeRegister();
  let reihe = Promise.resolve(); // schreibende Aufrufe laufen nacheinander

  function lesen() {
    const d = leseDatei(support, register);
    return { stand: d.stand, ueberschrieben: d.ueberschrieben, belegung: wirksam(register, d.ueberschrieben), datei: DATEI, ...(d.fehler ? { fehler: d.fehler } : {}) };
  }

  function schreibenInnen(eingabe) {
    if (!eingabe || typeof eingabe !== "object" || Array.isArray(eingabe)) throw new HttpFehler(400, "Die Anfrage ist kein Objekt.");
    const { werte = {}, zurueck = [], stand } = eingabe;
    if (!werte || typeof werte !== "object" || Array.isArray(werte)) throw new HttpFehler(400, "„werte“ muss ein Objekt sein.");
    if (zurueck !== "alle" && !(Array.isArray(zurueck) && zurueck.every((x) => typeof x === "string"))) throw new HttpFehler(400, "„zurueck“ ist eine Liste von Befehlen oder „alle“.");
    if (typeof stand !== "string" || !STAND_MUSTER.test(stand)) throw new HttpFehler(400, "„stand“ fehlt oder ist ungültig: erst lesen (GET), dann mit dem Stand schreiben.");
    const ids = new Map(register.befehle.map((b) => [b.id, b]));
    // 1. alles prüfen, bevor etwas geschrieben wird
    const neu = {};
    for (const [id, w] of Object.entries(werte)) {
      if (!ids.has(id)) throw new HttpFehler(400, `Unbekannter Befehl „${id}“.`);
      if (w === null) { neu[id] = null; continue; }
      const p = typeof w === "string" ? pruefe(register, w) : { ok: false, text: "Ungültiges Kürzel." };
      if (!p.ok) throw new HttpFehler(400, p.text, { art: p.art || "ungueltig", ...(p.grund ? { grund: p.grund } : {}) });
      neu[id] = p.kuerzel;
    }
    if (Array.isArray(zurueck)) for (const id of zurueck) if (!ids.has(id)) throw new HttpFehler(400, `Unbekannter Befehl „${id}“.`);
    const jetzt = leseDatei(support, register);
    if (jetzt.fehler) throw new HttpFehler(500, `Tastenkürzel nicht geschrieben: ${jetzt.fehler}`);
    if (jetzt.stand !== stand) throw new HttpFehler(409, "Die Tastenkürzel wurden zwischenzeitlich geändert — bitte neu laden.", { art: "konflikt" });
    // 2. zusammenführen; was dem Standard entspricht, wird nicht gespeichert
    const zusammen = zurueck === "alle" ? {} : { ...jetzt.ueberschrieben };
    if (Array.isArray(zurueck)) for (const id of zurueck) delete zusammen[id];
    for (const [id, w] of Object.entries(neu)) zusammen[id] = w;
    for (const [id, w] of Object.entries(zusammen)) if ((w ?? null) === (ids.get(id).standard ?? null)) delete zusammen[id];
    const datei = join(support, DATEI);
    if (!Object.keys(zusammen).length) {
      try { unlinkSync(datei); } catch (e) { if (e.code !== "ENOENT") throw new HttpFehler(500, `Schreiben fehlgeschlagen: ${e.code || e.message}`); }
    } else {
      const tmp = `${datei}.${process.pid}.tmp`;
      try { mkdirSync(support, { recursive: true }); writeFileSync(tmp, JSON.stringify({ schema: 1, kuerzel: zusammen }, null, 2) + "\n"); renameSync(tmp, datei); }
      catch (e) { try { unlinkSync(tmp); } catch { /* egal */ } throw new HttpFehler(500, `Schreiben fehlgeschlagen: ${e.code || e.message}`); }
    }
    return { ok: true, ...lesen() };
  }

  const schreiben = (eingabe) => {
    const lauf = reihe.then(() => schreibenInnen(eingabe));
    reihe = lauf.catch(() => {});
    return lauf;
  };
  return { lesen, schreiben };
}
