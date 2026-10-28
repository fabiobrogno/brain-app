// Verbindung zur Werkstatt: in der App über den Nachrichtenkanal (brain://), im Browser per fetch.
import { T } from "./texte.js";

const kanal = (() => {
  const w = window;
  return w.location.protocol === "brain:" && w.webkit?.messageHandlers?.brain?.postMessage ? w.webkit.messageHandlers.brain : null;
})();

function fehler(meldung, status, daten) {
  const e = new Error(meldung);
  e.status = status;
  e.daten = daten || null;
  return e;
}

async function anfrage(methode, pfad, daten) {
  if (kanal) {
    let r;
    try { r = await kanal.postMessage({ methode, pfad, daten: daten === undefined ? null : daten }); }
    catch { throw fehler(T.fehler.verbindung, 0); }
    const status = typeof r?.status === "number" ? r.status : 0;
    let wert = null;
    try { wert = typeof r?.body === "string" ? JSON.parse(r.body) : null; } catch { wert = null; }
    if (status < 200 || status >= 300) throw fehler(wert?.fehler || T.fehler.allgemein, status, wert);
    return wert;
  }
  let antwort;
  try {
    antwort = await fetch(pfad, {
      method: methode,
      headers: daten === undefined ? {} : { "Content-Type": "application/json" },
      body: daten === undefined ? undefined : JSON.stringify(daten),
      cache: "no-store",
    });
  } catch { throw fehler(T.fehler.verbindung, 0); }
  let wert = null;
  try { wert = await antwort.json(); } catch { wert = null; }
  if (!antwort.ok) throw fehler(wert?.fehler || T.fehler.allgemein, antwort.status, wert);
  return wert;
}

const q = (o) => {
  const s = Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  return s ? "?" + s : "";
};

export const api = {
  info: () => anfrage("GET", "/api/info"),
  baum: () => anfrage("GET", "/api/baum"),
  datei: (pfad) => anfrage("GET", "/api/datei" + q({ pfad })),
  speichern: (pfad, inhalt, basisHash) => anfrage("PUT", "/api/datei", { pfad, inhalt, basisHash }),
  neu: (ordner, titel) => anfrage("POST", "/api/neu", { ordner, titel }),
  merken: (text, titel) => anfrage("POST", "/api/merken", titel ? { text, titel } : { text }),
  // ---- Posteingang sichten: je Aktion ein Git-Commit (Antwort: pfad, ziel, commit = sha oder null ohne Git)
  verwerfen: (pfad) => anfrage("POST", "/api/posteingang/verwerfen", { pfad }),
  zurueckstellen: (pfad, tage) => anfrage("POST", "/api/posteingang/spaeter", tage === null ? { pfad, bis: null } : { pfad, tage }),
  uebernehmen: (pfad, ziel) => anfrage("POST", "/api/posteingang/uebernehmen", { pfad, ziel }),
  suche: (frage) => anfrage("GET", "/api/suche" + q({ q: frage })),
  pruefung: (pfad) => anfrage("GET", "/api/pruefung" + q({ pfad })),
  gesundheit: () => anfrage("GET", "/api/gesundheit"),
  rueckfragen: () => anfrage("GET", "/api/rueckfragen"),
  status: () => anfrage("GET", "/api/git/status"),
  commit: (nachricht, dateien) => anfrage("POST", "/api/git/commit", { nachricht, dateien }),
  sync: () => anfrage("POST", "/api/git/sync", {}),
  verlauf: (pfad, max) => anfrage("GET", "/api/git/verlauf" + q({ pfad, max })),
  diff: (pfad, sha) => anfrage("GET", "/api/git/diff" + q({ pfad, sha })),
  fassung: (pfad, sha) => anfrage("GET", "/api/git/fassung" + q({ pfad, sha })),
  // vault = der Pfad, den die Frage gezeigt hat: die Werkstatt erlaubt nur, wenn DAS ihr offener Vault ist (sonst 409 art „anderer-vault“)
  kitVertrauen: (erlauben, vault) => anfrage("POST", "/api/kit/vertrauen", { erlauben: !!erlauben, ...(typeof vault === "string" && vault ? { vault } : {}) }),
  mcpVerbinden: ({ umstellen } = {}) => anfrage("POST", "/api/mcp/verbinden", umstellen ? { ziel: "claude", umstellen: true } : { ziel: "claude" }),
  // ---- v2: Index, Typen, Ansichten, Kontext, Verlauf des Repos
  notizen: () => anfrage("GET", "/api/notizen"),
  notizKontext: (pfad) => anfrage("GET", "/api/notiz/kontext" + q({ pfad })),
  typen: () => anfrage("GET", "/api/typen"),
  ansichten: () => anfrage("GET", "/api/ansichten"),
  gitLog: ({ max, vor } = {}) => anfrage("GET", "/api/git/log" + q({ max, vor })),
  gitRemote: (url) => anfrage("POST", "/api/git/remote", { url }),
  // ---- v2: Vaults, KI, Probe
  vaults: () => anfrage("GET", "/api/vaults"),
  vaultAktiv: (pfad) => anfrage("POST", "/api/vaults/aktiv", { pfad }),
  vaultNeu: (art, name, ordner) => anfrage("POST", "/api/vaults/neu", ordner ? { art, name, ordner } : { art, name }),
  vaultOeffnen: (pfad, extra) => anfrage("POST", "/api/vaults/oeffnen", { pfad, ...(extra || {}) }),
  vaultKlonen: (url, ordner) => anfrage("POST", "/api/vaults/klonen", ordner ? { url, ordner } : { url }),
  vaultEntfernen: (pfad) => anfrage("POST", "/api/vaults/entfernen", { pfad }),
  kiErkennen: () => anfrage("GET", "/api/ki/erkennen"),
  kitHooks: () => anfrage("POST", "/api/kit/hooks", {}),
  // ---- GitHub-Anmeldung per Gerätecode (nie ein Token in einer Antwort)
  githubAnmelden: () => anfrage("POST", "/api/github/anmelden", {}),
  githubZustand: () => anfrage("GET", "/api/github/anmelden"),
  githubKonto: () => anfrage("GET", "/api/github/konto"),
  githubAbmelden: () => anfrage("POST", "/api/github/abmelden", {}),
  probe: (frage) => anfrage("POST", "/api/probe", { frage }),
};

// Aktion an die App (kein Datenweg); im Browser still ohne Wirkung.
export function aktion(name, wert) {
  try { window.webkit?.messageHandlers?.aktion?.postMessage(wert === undefined ? { aktion: name } : { aktion: name, wert }); return true; }
  catch { return false; }
}
export const inApp = () => !!window.webkit?.messageHandlers?.aktion;
// Aktion mit Antwort der App (z. B. "ordner-waehlen" → {pfad}|null). Im Browser: undefined.
export async function aktionMitAntwort(name, wert) {
  const hnd = window.webkit?.messageHandlers?.aktion;
  if (!hnd) return undefined;
  try { return await hnd.postMessage(wert === undefined ? { aktion: name } : { aktion: name, wert }); }
  catch { return undefined; }
}

// ---- Fehlerformen
// Git gesperrt (Spec §8): die Git-Routen antworten 409 { fehler, gitGesperrt: true }, bis der Nutzer dem Vault vertraut.
export const gitGesperrt = (e) => e?.status === 409 && e?.daten?.gitGesperrt === true;
// Vertrauen für einen anderen Vault als den offenen: die Werkstatt hat nichts erlaubt (409 { fehler, art: "anderer-vault" }).
export const andererVault = (e) => e?.status === 409 && e?.daten?.art === "anderer-vault";
// Ausgang unklar: status 0 = die Brücke hat die Frist gerissen (oder der Dienst ist weg), 504 = die Werkstatt hat ihre Frist gerissen und zurückgenommen.
export const ausgangUnklar = (e) => e?.status === 0 || e?.status === 504;
// Text dazu: die Werkstatt sagt bei 504 selbst, was passiert ist („nichts verändert“); sonst der allgemeine Satz
export const zeitText = (e) => (e?.status === 504 && e.message && e.message !== T.fehler.allgemein ? e.message : T.fehler.dauertLaenger);
// Nach unklarem Ausgang den Stand neu holen: Info, Vault-Liste, Git-Status. ok = die Werkstatt antwortet wieder.
export async function ladeStandNeu() {
  const [info, vaults, git] = await Promise.allSettled([api.info(), api.vaults(), api.status()]);
  const wert = (r) => (r.status === "fulfilled" ? r.value : null);
  const gesperrt = git.status === "rejected" && gitGesperrt(git.reason) ? { repo: true, gesperrt: true, grund: git.reason.daten?.fehler || null } : null;
  return { ok: info.status === "fulfilled" && !!info.value, info: wert(info), vaults: wert(vaults), git: wert(git) || gesperrt };
}
