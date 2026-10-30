// adapters/claude-code/einmal.mjs — Hook-Dubletten verhindern: derselbe Hook läuft je Ereignis nur EINMAL.
// Anlass: Läuft ein zweites Claude-Konto (CLAUDE_CONFIG_DIR) mit einem Arbeitsordner, in dem Claude Code die Einstellungen
// des ersten Kontos zusätzlich als Projekt-Einstellung liest, stehen die Brain-Hooks zweimal in der Hook-Liste (einmal über
// node-start.sh, einmal direkt über node). Jeder Hook liefe dann pro Ereignis doppelt, teils gleichzeitig — doppelte
// SessionStart-Meldungen, doppelte hint.log-Zeilen, doppelte Ernte.
//
// Verfahren: Schlüssel = Hook + session_id + Hash des relevanten Inhalts (Prompt-Text, `source`, tool_use_id …; nie der
// Klartext, nur ein Hash im Dateinamen). Der erste Aufruf legt atomar (fs.openSync … "wx") eine Marke unter
// <vault>/.logs/hook-einmal/ an und läuft normal. Existiert die Marke schon und ist jünger als FENSTER_MS (30 s), ist der
// Aufruf eine Dublette (brain-hint: jünger als FENSTER_HINT_MS = 5 s): ersterAufruf() liefert false, der Hook beendet sich sofort — ohne Ausgabe, ohne Seiteneffekt, ohne zu
// warten (die Aufrufe laufen parallel). Eine ältere Marke wird unter einer kurzen Sperre (<marke>.neu, ebenfalls "wx")
// übernommen: Der Sieger der Sperre prüft das Alter noch einmal und erneuert die Marke — zwei gleichzeitige Aufrufe nach
// einer alten Marke laufen so nie beide. Marken älter als 10 min räumt der jeweils erste Aufruf nebenbei weg.
//
// Ablage: .logs/ statt .cache/ — .logs/ steht in jedem Vault in der .gitignore (.cache/ nicht), die Marken sind flüchtig.
//
// BRAIN_EINMAL_FENSTER_MS=<ms> überschreibt das Fenster (Prüfstand): Die Tests haben „Dublette innerhalb des Fensters" bisher gegen die Wanduhr gemessen
// (Marke des ersten Hooks bis Prüfung des dritten Prozesses, jeder mit eigenem Node-Start) — unter Last dehnt sich das über 5 s, und die Wiederholung lief
// fälschlich. Mit einem großen Fenster hängt „Dublette" nicht mehr an der Startzeit der Kindprozesse. Ungesetzt oder ungültig: die festen Fenster oben.
//
// Nie blockierend: jeder Fehler im Guard (Ordner nicht schreibbar, Platte voll, Vault fehlt …) → true, der Hook läuft
// normal weiter. Bewusst KEIN Guard, wenn die session_id fehlt (Hand-Aufruf, Tests: ohne sie lassen sich zwei Sitzungen
// nicht unterscheiden) oder mit „eval-" beginnt (Messlatte/Hint-Eval rufen brain-hint.mjs mit vielen Prompts je eigener
// Sitzungs-ID auf — die dürfen nie unterdrückt werden). BRAIN_EINMAL=aus schaltet den Guard ganz ab (Tests, Notausgang).
import { openSync, closeSync, writeSync, mkdirSync, statSync, readdirSync, unlinkSync, utimesSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

export const FENSTER_MS = 30 * 1000;            // jünger = Dublette (Standard; die Hooks mit eindeutigem Schlüssel — tool_use_id, Quelle, Trigger — vertragen das)
// brain-hint: derselbe Prompt in derselben Sitzung ist kein eindeutiger Schlüssel — wer Esc drückt und denselben Prompt noch einmal sendet, will wieder einen Hinweis.
// Die echten Dubletten (derselbe Hook aus zwei Einstellungsdateien) laufen fast gleichzeitig (beobachtet ~1 s), also genügt ein kurzes Fenster; zusätzlich geht ein
// Ereignis-Merkmal (Größe des Transkripts, brain-hint.mjs) in den Schlüssel.
export const FENSTER_HINT_MS = 5 * 1000;
export const AUFBEWAHREN_MS = 10 * 60 * 1000;   // ältere Marken werden gelöscht
const SPERRE_MS = 5 * 1000;                     // eine Übernahme-Sperre, die älter ist, stammt von einem abgestürzten Aufruf
const MAX_AUFRAEUMEN = 2000;                    // so viele Einträge schaut das Aufräumen höchstens an

export const markenOrdner = (vault) => join(vault, ".logs", "hook-einmal");
export const hashInhalt = (inhalt) => createHash("sha256").update(String(inhalt ?? "")).digest("hex").slice(0, 16);
// Dateiname der Marke: nur Hash (Hook + sid + Inhalt-Hash), nie Klartext
export const markenName = (ereignis, sid, inhalt) =>
  createHash("sha256").update(`${ereignis}\0${sid}\0${hashInhalt(inhalt)}`).digest("hex").slice(0, 40);

// true = angelegt, "da" = gibt es schon; jeder andere Fehler wirft (→ ersterAufruf läuft normal weiter)
function legeAn(pfad, text) {
  try {
    const fd = openSync(pfad, "wx");
    try { writeSync(fd, text); } finally { closeSync(fd); }
    return true;
  } catch (e) {
    if (e && e.code === "EEXIST") return "da";
    throw e;
  }
}

function raeumeAuf(ordner, jetzt) {
  try {
    for (const n of readdirSync(ordner).slice(0, MAX_AUFRAEUMEN)) {
      const p = join(ordner, n);
      try { if (jetzt - statSync(p).mtimeMs > AUFBEWAHREN_MS) unlinkSync(p); } catch {}
    }
  } catch {}
}

// → true: erster Aufruf (normal weiterlaufen) · false: Dublette (still beenden).
// ereignis: Name des Hooks (je Skript eigen, auch wenn zwei Hooks am selben Ereignis hängen — z. B. PreCompact);
// sid: session_id aus dem Hook-JSON; inhalt: was zwei verschiedene Aufrufe derselben Sitzung unterscheidet.
const fensterAusUmgebung = (standard) => { const w = Number(process.env.BRAIN_EINMAL_FENSTER_MS); return Number.isFinite(w) && w > 0 ? w : standard; };
export function ersterAufruf(vault, ereignis, { sid = "", inhalt = "", fensterMs: fensterWunsch = FENSTER_MS, jetzt = Date.now() } = {}) {
  try {
    const fensterMs = fensterAusUmgebung(fensterWunsch);
    const s = String(sid || "");
    if (!s || s.startsWith("eval-") || process.env.BRAIN_EINMAL === "aus" || !vault || !existsSync(vault)) return true;
    const ordner = markenOrdner(vault);
    mkdirSync(ordner, { recursive: true });
    const marke = join(ordner, markenName(ereignis, s, inhalt));
    const text = `${ereignis} pid=${process.pid} ${new Date(jetzt).toISOString()}\n`;
    if (legeAn(marke, text) === true) { raeumeAuf(ordner, jetzt); return true; }

    let alter;
    try { alter = jetzt - statSync(marke).mtimeMs; }
    catch { return legeAn(marke, text) === true; }   // Marke ist inzwischen weg: neu anlegen, sonst war jemand schneller
    if (alter < fensterMs) return false;             // frische Marke: Dublette

    // Veraltete Marke: genau ein Aufruf übernimmt sie (Sperre, danach Alter erneut prüfen)
    const sperre = `${marke}.neu`;
    if (legeAn(sperre, text) !== true) {
      // Ein anderer übernimmt gerade → Dublette. Hängt die Sperre (Absturz), räumen wir sie weg und laufen im Zweifel normal.
      try { if (jetzt - statSync(sperre).mtimeMs > SPERRE_MS) { unlinkSync(sperre); return true; } } catch {}
      return false;
    }
    try {
      let frisch = false;
      try { frisch = jetzt - statSync(marke).mtimeMs < fensterMs; } catch {}
      if (frisch) return false;                      // ein anderer Aufruf hat sie zwischen unserer Prüfung und der Sperre erneuert
      try { utimesSync(marke, new Date(jetzt), new Date(jetzt)); }
      catch { if (legeAn(marke, text) !== true) return false; }
      raeumeAuf(ordner, jetzt);
      return true;
    } finally { try { unlinkSync(sperre); } catch {} }
  } catch { return true; }   // Guard defekt → Hook läuft normal (nie blockieren)
}
