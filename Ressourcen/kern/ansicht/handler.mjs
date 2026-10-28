// .tools/ansicht/handler.mjs — die Daten-Handler der Ansicht, transportunabhängig. dienst.mjs (HTTP) und
// bruecke.mjs (Brain-App, stdin/stdout) erzeugen sich je eine eigene Instanz mit eigenem Daten-/Modul-Cache.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { laufErgebnis } from "./dienst-lib.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
const DATEN_TTL_MS = 10 * 1000;

export function erzeugeHandler() {
  // ---- Handler: Module werden erst bei Bedarf geladen. Fehlt ein Modul oder sein Export (paralleler Task noch
  // nicht da), meldet die Route 503 „nicht verfügbar“ statt abzustürzen.
  const modulCache = new Map();
  const nichtVerfuegbar = () => Object.assign(new Error("nicht verfügbar"), { code: 503 });
  async function ladeModul(rel) {
    if (!modulCache.has(rel)) modulCache.set(rel, import(pathToFileURL(join(HIER, rel)).href).catch(() => null));
    const mod = await modulCache.get(rel);
    if (!mod) { modulCache.delete(rel); throw nichtVerfuegbar(); } // später nachgeliefertes Modul erneut versuchen
    return mod;
  }
  async function exportVon(rel, name) {
    const mod = await ladeModul(rel);
    if (typeof mod[name] !== "function") throw nichtVerfuegbar();
    return mod[name];
  }

  // Ansichtsdaten als Objekt: baueAnsichtsDaten (Task 3), sonst aus der von erzeugeAnsichtsDaten geschriebenen
  // data.js (Präfix „window.BRAIN_DATA = “ abschneiden). Cache: bis datenSchluessel sich ändert, sonst 10 s.
  let datenCache = null; // { schluessel, zeit, daten }
  async function daten(v) {
    const mod = await ladeModul("./daten.mjs");
    const schluessel = typeof mod.datenSchluessel === "function" ? await mod.datenSchluessel(v) : null;
    if (datenCache) {
      const frisch = schluessel != null ? datenCache.schluessel === schluessel : Date.now() - datenCache.zeit < DATEN_TTL_MS;
      if (frisch) return datenCache.daten;
    }
    let ergebnis;
    if (typeof mod.baueAnsichtsDaten === "function") ergebnis = await mod.baueAnsichtsDaten(v);
    else if (typeof mod.erzeugeAnsichtsDaten === "function") ergebnis = ausDataJs(mod.erzeugeAnsichtsDaten(v).pfad);
    else throw nichtVerfuegbar();
    datenCache = { schluessel, zeit: Date.now(), daten: ergebnis };
    return ergebnis;
  }
  function ausDataJs(pfad) {
    const text = readFileSync(pfad, "utf8");
    const marke = "window.BRAIN_DATA = ";
    const i = text.indexOf(marke);
    if (i < 0) throw new Error("data.js ohne Daten");
    return JSON.parse(text.slice(i + marke.length).trim().replace(/;$/, ""));
  }

  // Ist die Claude-Code-CLI auf diesem Rechner? Dieselbe Suche wie die Ernte (eine Quelle der Wahrheit:
  // ernte.mjs#findeClaude) — nur nachsehen, nie starten.
  async function claudeGefunden() {
    try { return !!(await exportVon("../ernte.mjs", "findeClaude"))(); } catch { return false; }
  }

  const handler = {
    daten,
    einstellungenLesen: async (v) => ({ ...(await exportVon("../einstellungen.mjs", "leseAutomatik"))(v), claudeGefunden: await claudeGefunden() }),
    // Nach erfolgreichem Schreiben/Entscheiden ist der Daten-Cache sofort veraltet (Config/Vorschlagsordner).
    // Ändert sich ichKarte, AGENTS.md im Vault neu rendern (Final-Review #1) — Fehler dabei nie fatal.
    einstellungenSchreiben: async (v, werte, stand) => {
      const lies = await exportVon("../einstellungen.mjs", "leseAutomatik");
      const vorher = lies(v).werte.ichKarte;
      const r = await (await exportVon("../einstellungen.mjs", "schreibeAutomatik"))(v, werte, stand);
      datenCache = null;
      if (lies(v).werte.ichKarte !== vorher) { try { await (await exportVon("../einstellungen.mjs", "rendereAgentsDatei"))(v); } catch {} }
      return r;
    },
    analyse: async (v) => (await exportVon("../analyse.mjs", "analyse"))(v),
    vorschlaegeListe: async (v) => (await exportVon("../vorschlaege.mjs", "listeVorschlaege"))(v),
    vorschlagEntscheiden: async (v, id, aktion) => {
      const r = await (await exportVon("../vorschlaege.mjs", "entscheide"))(v, id, aktion);
      datenCache = null;
      return r;
    },
    gelesen: async (v, seitMs) => (await exportVon("../werkzeug-log.mjs", "leseGelesen"))(v, seitMs),
    // Pflegebericht (aus dem Cache .logs/pflege-bericht.json, neu nur bei geändertem Schlüssel — W1-Review #6) +
    // offene Konflikte (aus den Ansichtsdaten D.konflikte; fehlen sie dort, liest pflege.mjs selbst) + Status des
    // Pflege-Laufs (claude da? läuft gerade? Kosten des letzten Laufs — T6-Bedenken 1).
    pflege: async (v) => {
      const mod = await ladeModul("../pflege.mjs");
      if (typeof mod.pflegebericht !== "function") throw nichtVerfuegbar();
      const bericht = typeof mod.aktuellerBericht === "function" ? await mod.aktuellerBericht(v) : await mod.pflegebericht(v);
      let konflikte = null;
      try { const d = await daten(v); if (Array.isArray(d?.konflikte)) konflikte = d.konflikte; } catch {}
      if (!konflikte) konflikte = typeof mod.offeneKonflikte === "function" ? mod.offeneKonflikte(v) : [];
      if (typeof mod.markiereEntschieden === "function") konflikte = mod.markiereEntschieden(v, konflikte);
      let lauf = null;
      try { lauf = (await exportVon("../pflegelauf.mjs", "pflegeLaufStatus"))(v); } catch { lauf = null; }
      return { ...bericht, konflikte, lauf };
    },
    konfliktEntscheiden: async (v, seite, nr, wahl, notiz, fingerabdruck = null) => {
      const r = await (await exportVon("../entscheidungen.mjs", "schreibeEntscheidung"))(v, { seite, nr, wahl, notiz, fingerabdruck });
      datenCache = null;
      return r;
    },
    // Pflege-Lauf mit KI (Task 3) losgelöst starten — fehlt pflegelauf.mjs, meldet die Route 503 „nicht verfügbar“.
    // Nicht gestartet (W1-Review #15): „läuft schon“ → 409, „claude fehlt“ → 503, sonst → 500 — jeweils mit grund.
    pflegeLauf: async (v) => {
      return laufErgebnis(await (await exportVon("../pflegelauf.mjs", "starteLosgeloest"))(v));
    },
  };

  return handler;
}
