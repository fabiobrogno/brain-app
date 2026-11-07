// electron/navigation.mjs — welche Adressen das Studiofenster laden und öffnen darf (reine Logik, ohne Electron; Test: Tests/Node/electron-huelle.test.mjs).
// Wie NavigationsRegel.swift: das Fenster zeigt nur die eigene Seite (kortex://studio/…); alles andere geht nie ins Fenster, sondern höchstens (http/https) in den Standardbrowser.
export const SCHEMA = "kortex";
export const HOST = "studio";
export const START_URL = `${SCHEMA}://${HOST}/`;
export const ANMELDE_DOMAENEN = ["claude.ai", "claude.com", "anthropic.com", "openai.com", "chatgpt.com"];

const lies = (adresse) => { try { return new URL(String(adresse)); } catch { return null; } };

// Die eigene Seite: kortex://studio/… (kein Benutzer, kein anderer Host, kein Port)
export function istEigeneAdresse(adresse) {
  const u = lies(adresse);
  return !!u && u.protocol === `${SCHEMA}:` && u.hostname === HOST && u.port === "" && u.username === "" && u.password === "";
}

const hostIn = (host, liste) => liste.some((d) => host === d || host.endsWith("." + d));
const istGithub = (host) => /^(www\.)?github\.com$/i.test(host);

/**
 * Darf diese Adresse im Standardbrowser geöffnet werden? → { ok:true, url } | { ok:false, grund:"adresse-nicht-erlaubt" }
 * `nurHttps` (Aktion `extern`): nur https; sonst (Links in der Seite) auch http. Bei offener Einrichtung nur GitHub (Gerätecode) und die Anmelde-Domänen.
 */
export function externPruefen(adresse, { nurHttps = true, einrichtungOffen = false } = {}) {
  const nein = { ok: false, grund: "adresse-nicht-erlaubt" };
  const u = lies(adresse);
  if (!u || !u.hostname) return nein;
  if (u.protocol !== "https:" && !(!nurHttps && u.protocol === "http:")) return nein;
  if (u.username || u.password) return nein;
  const host = u.hostname.toLowerCase();
  if (einrichtungOffen && !(istGithub(host) || hostIn(host, ANMELDE_DOMAENEN))) return nein;
  return { ok: true, url: u.href };
}
