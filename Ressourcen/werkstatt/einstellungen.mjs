// werkstatt/einstellungen.mjs — GET/PUT /api/einstellungen: die Seite „Einstellungen“ des Studios (Paket P5).
// Keine zweite Wahrheit: Werte eines Vaults (Pflege, Automatik, Sicherung …) lesen und schreiben über kern/einstellungen.mjs — dieselbe Speicherung
// wie `brain einstellungen` (brain.config.json#automatik, gleiche Prüfung, gleiche optimistische Sperre). Werte der App (Darstellung, Mitteilungen)
// liegen in <support>/einstellungen.json (gemeinsam/app-einstellungen.mjs). Die Route führt beide zusammen:
//   GET → { stand, werte, schema, vault, dateien, fehler }       werte: Standard + Gespeichertes beider Speicher, flach
//   PUT { werte: { schluessel: wert | null }, stand } → { ok, stand, werte, … } wie GET
// `stand` ist „<Stand des Vaults>.<Stand der App>“ (Stand = SHA-256 der Dateibytes, „-“ ohne offenen Vault). Beim Schreiben zählt nur der Stand der
// Speicher, die der Aufruf berührt: ändert jemand anderes (CLI, KI, zweites Fenster) genau diese Datei, antwortet die Route 409 (art „konflikt“) und die
// Oberfläche lädt neu. Alles wird geprüft, bevor etwas geschrieben wird; ein Wert `null` entfernt den Schlüssel (Standard).
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { HttpFehler } from "../gemeinsam/basis.mjs";
import { APP_SCHEMA, DATEI as APP_DATEI, leseApp, pruefeApp, schreibeApp } from "../gemeinsam/app-einstellungen.mjs";

const STAND_MUSTER = /^(?:[0-9a-f]{64}|-)\.[0-9a-f]{64}$/;

// deps: { support, kern: () => Ordner des Kerns }
export function erzeugeEinstellungen({ support, kern }) {
  let modul = null;
  const kernModul = () => (modul ??= import(pathToFileURL(join(kern(), "einstellungen.mjs")).href).catch(() => null));
  let reihe = Promise.resolve(); // schreibende Aufrufe laufen nacheinander (nie zwei zugleich auf denselben Dateien)

  const kernSchema = (m) => Object.fromEntries(Object.entries(m.SCHEMA).map(([k, s]) => [k, { quelle: "vault", ...(s.werte ? { werte: s.werte } : { typ: s.typ, ...(s.min !== undefined ? { min: s.min, max: s.max } : {}) }), standard: s.standard, ...(s.ohneMaske ? { ohneMaske: true } : {}) }]));
  const appSchema = () => Object.fromEntries(Object.entries(APP_SCHEMA).map(([k, s]) => [k, { quelle: "app", ...(s.werte ? { werte: s.werte } : { typ: s.typ, ...(s.min !== undefined ? { min: s.min, max: s.max } : {}) }), standard: s.standard }]));
  const vertraut = (v) => { try { return v.vertrauenStand().erlaubt === true; } catch { return false; } };

  async function lesen(v) {
    const m = v ? await kernModul() : null;
    const app = leseApp(support);
    const fehler = {};
    let a = null;
    if (v) {
      if (!m) fehler.vault = "Die Einstellungen des Vaults konnten nicht gelesen werden: der Kern fehlt.";
      else {
        a = m.leseAutomatik(v.wurzel);
        if (a.fehler) fehler.vault = String(a.fehler);
      }
    }
    if (app.fehler) fehler.app = app.fehler;
    return {
      stand: `${a ? a.stand : "-"}.${app.stand}`,
      werte: { ...(a ? a.werte : (m ? m.STANDARD : {})), ...app.werte },
      schema: { ...(m ? kernSchema(m) : {}), ...appSchema() },
      vault: v ? { name: v.name, pfad: v.wurzel, vertraut: vertraut(v) } : null,
      dateien: { vault: v ? "brain.config.json" : null, app: APP_DATEI },
      ...(Object.keys(fehler).length ? { fehler } : {}),
    };
  }

  async function schreibenInnen(v, eingabe) {
    if (!eingabe || typeof eingabe !== "object" || Array.isArray(eingabe)) throw new HttpFehler(400, "Die Anfrage ist kein Objekt.");
    const { werte, stand } = eingabe;
    if (!werte || typeof werte !== "object" || Array.isArray(werte)) throw new HttpFehler(400, "„werte“ muss ein Objekt sein.");
    if (typeof stand !== "string" || !STAND_MUSTER.test(stand)) throw new HttpFehler(400, "„stand“ fehlt oder ist ungültig: erst lesen (GET), dann mit dem Stand schreiben.");
    const [standVault, standApp] = stand.split(".");
    const m = await kernModul();
    const vaultNeu = {}, appNeu = {};
    for (const [k, w] of Object.entries(werte)) {
      if (Object.hasOwn(APP_SCHEMA, k)) appNeu[k] = w;
      else if (m && Object.hasOwn(m.SCHEMA, k)) vaultNeu[k] = w;
      else throw new HttpFehler(400, `Unbekannte Einstellung „${k}“.`);
    }
    const hatVault = Object.keys(vaultNeu).length > 0, hatApp = Object.keys(appNeu).length > 0;
    if (hatVault) {
      if (!v) throw new HttpFehler(409, "Es ist noch kein Vault geöffnet.", { keinVault: true });
      if (!vertraut(v)) throw new HttpFehler(409, "Dieser Vault ist nur zum Ansehen geöffnet. Vertraue ihm zuerst, dann kannst du seine Einstellungen ändern.", { art: "nicht-vertraut" });
      if (standVault === "-") throw new HttpFehler(409, "Die Einstellungen wurden zwischenzeitlich geändert — bitte neu laden.", { art: "konflikt" });
    }
    // 1. alles prüfen, bevor etwas geschrieben wird (App-Werte rein; Vault-Werte prüft der Kern als Erstes in schreibeAutomatik — ein Fehler dort lässt die Dateien unberührt)
    if (hatApp) pruefeApp(appNeu);
    if (hatApp && hatVault && leseApp(support).stand !== standApp) throw new HttpFehler(409, "Die Einstellungen wurden zwischenzeitlich geändert — bitte neu laden.", { art: "konflikt" });
    // 2. Vault (Kern), danach App
    if (hatVault) {
      const vorherIch = m.leseAutomatik(v.wurzel).werte.ichKarte;
      try { m.schreibeAutomatik(v.wurzel, vaultNeu, standVault); }
      catch (e) { throw new HttpFehler([400, 409, 500].includes(e.code) ? e.code : 500, String(e.message || "Das hat nicht geklappt."), e.code === 409 ? { art: "konflikt" } : {}); }
      // Nicht-Claude-KIs erfahren von der Ich-Karte nur über AGENTS.md: bei einer Änderung wird sie im Vault neu gerendert (wie im Kern, fehlertolerant)
      if (m.leseAutomatik(v.wurzel).werte.ichKarte !== vorherIch) { try { await m.rendereAgentsDatei(v.wurzel); } catch { /* der Rest gilt */ } }
    }
    if (hatApp) schreibeApp(support, appNeu, standApp);
    return { ok: true, ...(await lesen(v)) };
  }

  const schreiben = (v, eingabe) => {
    const lauf = reihe.then(() => schreibenInnen(v, eingabe));
    reihe = lauf.catch(() => {});
    return lauf;
  };
  return { lesen, schreiben };
}
