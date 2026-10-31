// abgleich-sperre.mjs — EINE Sperre für alles, was den Arbeitsbaum eines Vaults mit dem Server abgleicht: die Hintergrund-Sicherung und das Holen
// des Kerns (backup.mjs), der Abgleich im Studio und die Konfliktlösung (Werkstatt, Kern-Befehl `brain abgleich`). Zwei Prozesse (Kern-Hook, Studio,
// zweites Fenster) dürfen nie gleichzeitig holen, zusammenführen oder senden: das ergäbe halbe Zusammenführungen und doppelte Merge-Commits.
//
// Ablage: <Support>/backup/<Kennung des Vaults>.sperre = { "pid", "zeit" (ms), "art", "marke" } — neben dem Merker (backup.mjs / sicherungsmerker.mjs
// bilden dieselbe Kennung). Genommen wird sie atomar (Datei mit Flag „wx“). Verwaist ist sie, wenn der Prozess nicht mehr lebt (pid) oder die
// Sperre älter als MAX_ALTER_MS ist (ein hängender Lauf; ein Abgleich dauert höchstens einige Minuten, Netzfristen 90 s). Eine verwaiste Sperre
// räumt der nächste weg — dabei gewinnt genau einer (rename), nie beide. Freigeben löscht nur die eigene Sperre (Marke), nie eine fremde.
// Reine Node-Module, keine Abhängigkeiten: die Werkstatt lädt diese Datei aus dem Kern-Ordner (gemeinsam/vault.mjs), der Kern importiert sie direkt.
import { openSync, writeSync, closeSync, readFileSync, renameSync, rmSync, statSync, linkSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

export const MAX_ALTER_MS = 15 * 60_000;
const KAPUTT_MS = 10_000; // eine unlesbare Sperrdatei zählt erst nach so langer Zeit als verwaist (ein anderer Prozess schreibt sie vielleicht gerade)

const lebt = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return !!e && e.code === "EPERM"; } // EPERM: lebt, gehört nur einem anderen Nutzer
};
function lies(datei) {
  try { const o = JSON.parse(readFileSync(datei, "utf8")); return o && typeof o === "object" && !Array.isArray(o) ? o : null; } catch { return null; }
}
const frisch = (o, jetzt) => Number.isFinite(o.zeit) && jetzt - o.zeit < MAX_ALTER_MS && jetzt - o.zeit > -MAX_ALTER_MS;

// → { besetzt: false } | { besetzt: true, pid, zeit, art }. Rein lesend (räumt nichts weg).
export function sperreStand(datei, { jetzt = Date.now() } = {}) {
  const o = lies(datei);
  if (!o) {
    let alt = null; try { alt = jetzt - statSync(datei).mtimeMs; } catch { return { besetzt: false }; } // keine Datei
    return alt > KAPUTT_MS ? { besetzt: false } : { besetzt: true, pid: null, zeit: null, art: null };
  }
  if (!lebt(o.pid) || !frisch(o, jetzt)) return { besetzt: false };
  return { besetzt: true, pid: o.pid, zeit: o.zeit, art: typeof o.art === "string" ? o.art : null };
}

// Nimmt die Sperre. → { ok: true, freigeben() } | { ok: false, von: { pid, zeit, art } }. Wirft nie (ein unbeschreibbarer Support-Ordner
// blockiert nichts: dann ist ok true, freigeben tut nichts — die Sperre ist ein Schutz, kein Tor).
export function nimmSperre(datei, { art = "abgleich", pid = process.pid, jetzt = Date.now() } = {}) {
  const marke = randomBytes(6).toString("hex");
  const inhalt = JSON.stringify({ pid, zeit: jetzt, art, marke }) + "\n";
  const freigeben = () => { const o = lies(datei); if (o && o.marke === marke) { try { rmSync(datei, { force: true }); } catch { /* weg oder nicht löschbar */ } } };
  try { mkdirSync(dirname(datei), { recursive: true }); } catch { return { ok: true, freigeben() {} }; }
  for (let versuch = 0; versuch < 4; versuch++) {
    try {
      const fd = openSync(datei, "wx");
      try { writeSync(fd, inhalt); } finally { closeSync(fd); }
      return { ok: true, freigeben };
    } catch (e) {
      if (!e || e.code !== "EEXIST") return { ok: true, freigeben() {} };
    }
    const alt = lies(datei);
    if (alt && lebt(alt.pid) && frisch(alt, jetzt)) return { ok: false, von: { pid: alt.pid, zeit: alt.zeit, art: typeof alt.art === "string" ? alt.art : null } };
    if (!alt) { // unlesbar: erst nach KAPUTT_MS wegräumen
      let alter = 0; try { alter = jetzt - statSync(datei).mtimeMs; } catch { continue; } // inzwischen weg → noch einmal versuchen
      if (alter <= KAPUTT_MS) return { ok: false, von: { pid: null, zeit: null, art: null } };
    }
    // verwaist: wegräumen. rename ist atomar — nur EINER bekommt die Datei; hat er versehentlich eine inzwischen frische Sperre eines
    // anderen erwischt (zwischen Lesen und rename ersetzt), legt er sie wieder hin (link schlägt fehl, wenn schon eine neue da ist).
    const beiseite = `${datei}.verwaist-${pid}-${marke}`;
    try {
      renameSync(datei, beiseite);
      const gestohlen = lies(beiseite);
      const gleich = (alt === null && gestohlen === null) || (alt && gestohlen && alt.marke === gestohlen.marke && alt.pid === gestohlen.pid);
      if (!gleich && gestohlen && lebt(gestohlen.pid) && frisch(gestohlen, jetzt)) {
        try { linkSync(beiseite, datei); } catch { /* es gibt schon eine neue */ }
        rmSync(beiseite, { force: true });
        return { ok: false, von: { pid: gestohlen.pid, zeit: gestohlen.zeit, art: typeof gestohlen.art === "string" ? gestohlen.art : null } };
      }
      rmSync(beiseite, { force: true });
    } catch { /* ein anderer war schneller */ }
  }
  return { ok: false, von: { pid: null, zeit: null, art: null } };
}
