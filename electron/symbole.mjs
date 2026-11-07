// electron/symbole.mjs — das App-Symbol der Electron-Hülle (Paket W2b), reine Logik OHNE `import "electron"`. Die fünf Symbole (standard, dunkel, graphit, papier, smaragd) liegen als .png und .ico
// in electron/symbole/ (erzeugt von scripts/erzeuge-electron-symbole.mjs aus denselben SVGs wie die Mac-Symbole). Gewählt wird in den Einstellungen (Schlüssel `appSymbol` in einstellungen.json,
// gemeinsam mit dem Studio und der Mac-App); beim Start liest die Hülle ihn selbst, die Aktion `app-symbol` wechselt zur Laufzeit.
// Fenster: Windows nimmt .ico, Linux .png; das Tray-Symbol ist immer eine kleine .png. Unter Windows lässt sich das Symbol der Taskleiste zur Laufzeit nur über das Fenster ändern, das genügt.
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const APP_SYMBOLE = ["standard", "dunkel", "graphit", "papier", "smaragd"];
export const SCHLUESSEL = "appSymbol";
export const ORDNER = join(dirname(fileURLToPath(import.meta.url)), "symbole");

/** Gespeicherte Wahl; nie ein Fehler: fehlt/kaputt/unbekannt → standard (wie AppSymbol.lies in Swift). */
export function leseAppSymbol(support) {
  try {
    const datei = join(support, "einstellungen.json");
    if (statSync(datei).size > 1_000_000) return "standard";
    const j = JSON.parse(readFileSync(datei, "utf8"));
    return j && typeof j === "object" && APP_SYMBOLE.includes(j[SCHLUESSEL]) ? j[SCHLUESSEL] : "standard";
  } catch { return "standard"; }
}

/** Pfade zu den Dateien einer Variante → { fenster, tray } (fenster: .ico unter Windows, sonst .png); null, wenn der Name nicht stimmt oder eine Datei fehlt. */
export function symbolPfade(name, { plattform = process.platform, ordner = ORDNER } = {}) {
  if (!APP_SYMBOLE.includes(name)) return null;
  const fenster = join(ordner, `${name}.${plattform === "win32" ? "ico" : "png"}`), tray = join(ordner, `tray-${name}.png`);
  return existsSync(fenster) && existsSync(tray) ? { fenster, tray } : null;
}
