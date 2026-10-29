#!/usr/bin/env node
// nachernte.mjs — Sammelbefehl der Nach-Ernte (nach dem Probelauf über echten Altbestand): erntet alle gesicherten
// Transkripte <vault>/.logs/transkript-sicherung/*.jsonl nacheinander noch einmal, mit dem schärferen Auftrag (ernte.mjs
// --nachernte: ohne Byte-Marke, nur Fakten, alle B1-Prüfungen, Vorschläge mit nachernte: true). Jede Sitzung wird GANZ geerntet:
// in Fenstern à ~24 000 Zeichen, je Fenster ein Haiku-Aufruf, höchstens --max-fenster je Sitzung (Standard 8; mehr Fenster →
// gleichmäßig über die Sitzung verteilt). Das Budget zählt alle Aufrufe (Standard 250). Fortschritt je Sitzung und Fenster merkt
// .logs/ernte/nachernte/<sid>: erledigte Sitzungen werden übersprungen, angefangene setzen beim nächsten Lauf fort. Der
// Arbeitsordner (cwd) steht im Transkript. Neueste Sitzung zuerst.
// Die alten Vorschläge ohne Zitat räumt danach der Tageslauf (Schritt „Aufräumen“) ins Archiv: ersetzt-durch-nachernte.
// CLI: node nachernte.mjs [vault] [--budget-aufrufe N] [--max-fenster N] [--zaehlen]      (auch: brain nachernte …)
//      Exit 0 (auch bei Budget-Ende) · 1 claude fehlt/fällt aus · 64 Aufruf falsch.
// Nur Node-Standardbibliothek.
import { readdirSync, lstatSync, openSync, readSync, fstatSync, closeSync, realpathSync } from "node:fs";
import { join, isAbsolute, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { vaultPfadOderEnde, entferneBom } from "./pfade.mjs";
import { leseAutomatik } from "./einstellungen.mjs";
import { ernte, findeClaude, istAusgeschlossen, leseNachernteMarken, leseNachernteMarke, schreibeNachernteMarke, nachernteFertig, MAX_FENSTER } from "./ernte.mjs";

export const STANDARD_AUFRUFE = 250;
export const STANDARD_FENSTER = MAX_FENSTER;   // Fenster je Sitzung
const MAX_AUFRUFE = 10000, MAX_FENSTER_OBERGRENZE = 100;
const FEHLER_FOLGE = 3;          // so viele claude-Fehler in Folge → Schluss (offline, claude kaputt)
const KOPF_BYTES = 1024 * 1024;  // so viel vom Anfang eines Transkripts nach Arbeitsordnern durchsuchen
const ENDE_BYTES = 256 * 1024;   // und vom Ende (Wechsel des Ordners mitten in der Sitzung)
const DATEI = /^([\w-]{1,64})\.jsonl$/;

// Gesicherte Transkripte, neueste zuerst. Nur echte Dateien mit Sitzungs-Namen (keine Symlinks, keine Leerzeichen).
export function findeTranskripte(vault) {
  const dir = join(vault, ".logs", "transkript-sicherung");
  let namen = [];
  try { namen = readdirSync(dir); } catch { return []; }
  const out = [];
  for (const n of namen) {
    const m = DATEI.exec(n);
    if (!m) continue;
    const pfad = join(dir, n);
    try { const st = lstatSync(pfad); if (st.isFile()) out.push({ sid: m[1], pfad, mtime: st.mtimeMs }); } catch {}
  }
  return out.sort((a, b) => b.mtime - a.mtime || a.sid.localeCompare(b.sid));
}

// Alle verschiedenen Arbeitsordner (cwd), die das Transkript nennt — der erste ist der Start-Ordner. Gelesen werden Anfang und
// Ende der Datei; angeschnittene Zeilen werden ignoriert. Nur absolute Pfade zählen.
export function sitzungsOrdner(pfad) {
  const out = [];
  let fd;
  try { fd = openSync(pfad, "r"); } catch { return out; }
  try {
    const groesse = fstatSync(fd).size;
    const lies = (start, laenge) => {
      const buf = Buffer.alloc(laenge);
      return buf.subarray(0, readSync(fd, buf, 0, laenge, start)).toString("utf8");
    };
    const stuecke = [entferneBom(lies(0, Math.min(groesse, KOPF_BYTES)))];
    if (groesse > KOPF_BYTES) { const ab = Math.max(KOPF_BYTES, groesse - ENDE_BYTES); stuecke.push(lies(ab, groesse - ab)); }
    for (const st of stuecke) {
      for (const z of st.split("\n")) {
        if (!z.includes('"cwd"')) continue;
        try {
          const c = JSON.parse(z)?.cwd;
          if (typeof c === "string" && (isAbsolute(c) || win32.isAbsolute(c)) && !out.includes(c)) out.push(c);
        } catch { /* angeschnittene Zeile */ }
      }
    }
  } catch { /* unlesbar → keine Ordner */ } finally { closeSync(fd); }
  return out;
}

// → { gesamt, erledigt, geerntet, vorschlaege, uebersprungen, fehler, aufrufe, offen, abbruch }
// abbruch: null | "budget" | "läuft schon" | "claude-fehlt" | "claude-fehler" | "config".
// Optionen: budget (Aufrufe gesamt, Standard 250), maxFenster (je Sitzung, Standard 8), claudeBefehl (Test), jetzt (Test), nurZaehlen,
// versuche/warteMs/warte (Wartezeit,
// wenn gerade eine andere Ernte läuft — dieselbe Sperre wie bei der Ernte aus dem Hook).
export async function nachernteAlle(vault, { budget = STANDARD_AUFRUFE, maxFenster = STANDARD_FENSTER, claudeBefehl, jetzt, nurZaehlen = false, versuche = 12, warteMs = 5000,
  warte = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  if (!Number.isInteger(budget) || budget < 1 || budget > MAX_AUFRUFE) throw new Error(`Budget: eine ganze Zahl von 1 bis ${MAX_AUFRUFE} nötig`);
  if (!Number.isInteger(maxFenster) || maxFenster < 1 || maxFenster > MAX_FENSTER_OBERGRENZE) throw new Error(`Fenster je Sitzung: eine ganze Zahl von 1 bis ${MAX_FENSTER_OBERGRENZE} nötig`);
  const alle = findeTranskripte(vault);
  const marken = leseNachernteMarken(vault);
  const liste = alle.filter((t) => !nachernteFertig(marken.get(t.sid)));   // angefangene („laeuft“) setzen fort
  const r = { gesamt: alle.length, erledigt: alle.length - liste.length, geerntet: 0, vorschlaege: 0, uebersprungen: 0, fehler: 0, aufrufe: 0, offen: liste.length, abbruch: null };
  if (nurZaehlen || !liste.length) return r;
  // Fail-closed wie die Ernte: ohne lesbare Config lässt sich ernteNichtIn nicht prüfen.
  const { werte, fehler: configFehler } = leseAutomatik(vault);
  if (configFehler) { r.abbruch = "config"; return r; }
  const claude = claudeBefehl === undefined ? findeClaude() : claudeBefehl;
  if (!claude) { r.abbruch = "claude-fehlt"; return r; }
  const zeit = () => jetzt ?? Date.now();
  let fehlerFolge = 0;
  for (const t of liste) {
    if (r.aufrufe >= budget) { r.abbruch = "budget"; break; }
    const ordner = sitzungsOrdner(t.pfad);
    if (!ordner.length) { r.uebersprungen++; continue; }   // keine Marke: vielleicht fehlt der Ordner nur in dieser Sicherung
    // Auch ein späterer Ordner zählt: wer mitten in der Sitzung in einen ausgeschlossenen Ordner wechselt, wird nicht geerntet.
    if (ordner.some((o) => istAusgeschlossen(o, werte.ernteNichtIn))) {
      schreibeNachernteMarke(vault, t.sid, { status: "uebersprungen", grund: "ausgeschlossener Ordner", zeit: new Date(zeit()).toISOString().slice(0, 19) + "Z" });
      r.uebersprungen++; r.offen--;
      continue;
    }
    let e, versuch = 0;
    for (;;) {
      e = await ernte(vault, { nachernte: true, transkript: t.pfad, sid: t.sid, cwd: ordner[0], claudeBefehl: claude, jetzt: zeit(), maxFenster, maxAufrufe: budget - r.aufrufe });
      r.aufrufe += e.aufrufe ?? 0;
      r.vorschlaege += e.vorschlaege?.length ?? 0;   // auch die Fenster einer nur teilweise geernteten Sitzung
      if (e.grund !== "läuft schon" || ++versuch >= versuche) break;
      await warte(warteMs);
    }
    if (e.grund === "läuft schon") { r.abbruch = "läuft schon"; break; }
    if (e.status === "ok") { r.geerntet++; fehlerFolge = 0; }
    else if (e.status === "teilweise") { r.abbruch = "budget"; break; }   // Fenster blieben offen: Budget alle, nächster Lauf macht weiter
    else if (e.status === "uebersprungen") r.uebersprungen++;
    else {
      r.fehler++;
      if (e.grund === "claude nicht gefunden") { r.abbruch = "claude-fehlt"; break; }
      if (++fehlerFolge >= FEHLER_FOLGE) { r.abbruch = "claude-fehler"; break; }
      continue;
    }
    if (nachernteFertig(leseNachernteMarke(vault, t.sid))) r.offen--;
  }
  return r;
}

const ABBRUCH_TEXT = { budget: "Budget aufgebraucht", "läuft schon": "es läuft gerade eine andere Ernte", "claude-fehlt": "claude nicht gefunden",
  "claude-fehler": "claude fällt aus", config: "Einstellungen unlesbar" };
export function zusammenfassung(r, { budget = STANDARD_AUFRUFE, zaehlen = false } = {}) {
  if (zaehlen) return `Nach-Ernte: ${r.gesamt} Sitzungen, ${r.erledigt} erledigt, ${r.offen} offen.`;
  return `Nach-Ernte: geerntet ${r.geerntet} Sitzungen (${r.vorschlaege} Vorschläge) · übersprungen ${r.uebersprungen} · Fehler ${r.fehler}`
    + ` · KI-Aufrufe ${r.aufrufe} von ${budget} · noch offen ${r.offen}${r.abbruch ? ` — ${ABBRUCH_TEXT[r.abbruch] || r.abbruch}` : ""}.`;
}

export function leseArgs(argv) {
  const o = { vault: null, budget: STANDARD_AUFRUFE, maxFenster: STANDARD_FENSTER, zaehlen: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--zaehlen") { o.zaehlen = true; continue; }
    if (a === "--budget-aufrufe") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 1 || n > MAX_AUFRUFE) throw new Error("--budget-aufrufe braucht eine ganze Zahl");
      o.budget = n;
      continue;
    }
    if (a === "--max-fenster") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 1 || n > MAX_FENSTER_OBERGRENZE) throw new Error("--max-fenster braucht eine ganze Zahl");
      o.maxFenster = n;
      continue;
    }
    if (!a.startsWith("--") && !o.vault) { o.vault = a; continue; }
    throw new Error(`Unbekannte Angabe: ${a}`);
  }
  return o;
}

const selbst = fileURLToPath(import.meta.url);
let aufruf = "";
try { aufruf = realpathSync(process.argv[1] || ""); } catch {}
if (aufruf && aufruf === realpathSync(selbst)) {
  let o;
  try { o = leseArgs(process.argv.slice(2)); }
  catch (e) {
    console.error(`${e.message}\nNutzung: brain nachernte [--budget-aufrufe N] [--max-fenster N] [--zaehlen]   (Standard ${STANDARD_AUFRUFE} Aufrufe, ${STANDARD_FENSTER} Fenster je Sitzung)`);
    process.exit(64);
  }
  const r = await nachernteAlle(o.vault || vaultPfadOderEnde([]), { budget: o.budget, maxFenster: o.maxFenster, nurZaehlen: o.zaehlen });
  console.log(zusammenfassung(r, { budget: o.budget, zaehlen: o.zaehlen }));
  process.exitCode = r.abbruch === "claude-fehlt" || r.abbruch === "claude-fehler" ? 1 : 0;
}
