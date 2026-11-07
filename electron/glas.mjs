// electron/glas.mjs — „Seitenleiste durchscheinend“ (Paket W2b), reine Logik OHNE `import "electron"`. Möglich ist es nur unter Windows 11 22H2 oder neuer (Build 22621): dort setzt die Hülle
// `backgroundMaterial: "mica"` (BrowserWindow.setBackgroundMaterial) und `data-glas` an der Seite; sonst antwortet die Aktion `fenster-durchscheinend` mit {ok:false, grund:"nicht-verfuegbar"}
// und `data-glas-moeglich` fehlt (die Einstellung bleibt ausgeblendet). Der Wunsch steht in einstellungen.json (`seitenleisteDurchscheinend`, Standard an; wie SeitenleisteGlas.lies in Swift).
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const MIN_BUILD = 22621;
export const SCHLUESSEL = "seitenleisteDurchscheinend";

/** Windows-Build aus os.release() („10.0.22631“) → Zahl oder null (kein Windows, unlesbar). */
export function windowsBuild(release) { const m = /^10\.0\.(\d+)/.exec(String(release)); return m ? Number(m[1]) : null; }
/** Kann dieses System Fenstermaterial? Nur Windows 11 22H2+ (Windows 10 und Linux: nein; am Mac macht das die Swift-App). */
export function glasMoeglich({ plattform = process.platform, release } = {}) { const b = windowsBuild(release); return plattform === "win32" && b !== null && b >= MIN_BUILD; }

/** Gespeicherter Wunsch; nie ein Fehler: fehlt/kaputt/kein Boolean → an. */
export function leseGlasWunsch(support) {
  try {
    const datei = join(support, "einstellungen.json");
    if (statSync(datei).size > 1_000_000) return true;
    const j = JSON.parse(readFileSync(datei, "utf8"));
    return j && typeof j === "object" && typeof j[SCHLUESSEL] === "boolean" ? j[SCHLUESSEL] : true;
  } catch { return true; }
}

/** Skript für die Seite: `data-glas-moeglich` (immer, wenn möglich) und `data-glas` (nur wenn gewünscht) am <html>; ohne Möglichkeit passiert nichts (null). */
export const glasSkript = ({ moeglich, an }) => (moeglich ? `(function(){var r=document.documentElement;r.dataset.glasMoeglich='1';${an ? "r.dataset.glas='1';" : "delete r.dataset.glas;"}})()` : null);
