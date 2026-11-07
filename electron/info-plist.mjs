// electron/info-plist.mjs — liest einzelne Textwerte aus Ressourcen/Info.plist (die EINE Quelle für Version und öffentliche GitHub-Client-ID; die Mac-App liest dieselbe Datei als Bundle-Info).
// Bewusst klein: die Datei ist von uns geschrieben, `<key>…</key><string>…</string>` je Eintrag; kein XML-Parser nötig. Reine Logik OHNE `import "electron"`.
import { readFileSync } from "node:fs";

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** → Wert des Schlüssels (getrimmt) oder null. */
export function plistWert(text, schluessel) {
  const m = new RegExp(`<key>${esc(schluessel)}</key>\\s*<string>([^<]*)</string>`).exec(String(text));
  return m ? m[1].trim() : null;
}

export function liesPlist(datei, schluessel) {
  try { return plistWert(readFileSync(datei, "utf8"), schluessel); } catch { return null; }
}

/** Die öffentliche OAuth-Client-ID (kein Geheimnis) → Text oder null, wenn sie fehlt oder nicht wie eine ID aussieht (sie wandert in die Umgebung der Werkstatt). */
export const githubClientId = (datei) => {
  const id = liesPlist(datei, "KortexGitHubClientID");
  return id && /^[A-Za-z0-9._-]{4,100}$/.test(id) ? id : null;
};

/** App-Version (`CFBundleShortVersionString`): Quelle der Paketversion. */
export const appVersion = (datei) => {
  const v = liesPlist(datei, "CFBundleShortVersionString");
  return v && /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(v) ? v : null;
};
