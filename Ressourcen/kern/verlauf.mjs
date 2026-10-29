// verlauf.mjs — Claude-Code-Verläufe (JSONL unter ~/.claude*/projects/<projekt>/<sitzung>.jsonl) lesen.
// Einzige Stelle, die das Zeilenformat kennt (K11 zuletzt, K12 Arbeitsstand, K13 parallel, K15 Wirkung).
// Grundsätze: unbekannte Zeilenarten und kaputte/halbe Zeilen werden still übersprungen (das Format ändert sich mit
// Claude-Code-Versionen); große Dateien nur stückweise (Kopf, Ende ab Byte-Marke) oder als Strom mit Zeitlimit;
// lesende Funktionen werfen nie. Speichert und loggt nichts. Nur Node-Standardbibliothek.
import { openSync, readSync, fstatSync, closeSync, createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { istSystemNachricht } from "./hint-core.mjs";

export const KOPF_MAX = 256 * 1024;
export const STUECK_MAX = 16 * 1024 * 1024;
// Vom Werkzeug eingefügte Blöcke in Nutzer-Zeilen (wie in der Auswertung vom 16.10., ex.py)
const SYSTEM_BLOCK = /<(system-reminder|command-[a-z]+|local-command-[a-z]+)>[\s\S]*?<\/\1>/g;

const ohneBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

// Eine JSONL-Zeile → Objekt, sonst null (leer, kaputt, halb, Array).
export function parseZeile(roh) {
  const z = ohneBom(String(roh ?? "")).replace(/\r$/, "");
  if (z.length < 2 || z[0] !== "{") return null;
  try {
    const o = JSON.parse(z);
    return o && typeof o === "object" && !Array.isArray(o) ? o : null;
  } catch { return null; }
}
const parseAlle = (text) => text.split("\n").map(parseZeile).filter(Boolean);

// Anfang der Datei (höchstens maxBytes), nur vollständige Zeilen.
export function leseKopf(pfad, maxBytes = KOPF_MAX) {
  let fd;
  try {
    fd = openSync(pfad, "r");
    const groesse = fstatSync(fd).size;
    const n = Math.min(groesse, maxBytes);
    const buf = Buffer.alloc(n);
    if (n) readSync(fd, buf, 0, n, 0);
    const ende = n < groesse ? buf.lastIndexOf(0x0a) + 1 : n;
    return { eintraege: parseAlle(buf.subarray(0, ende).toString("utf8")), groesse };
  } catch { return { eintraege: [], groesse: 0 }; }
  finally { if (fd !== undefined) try { closeSync(fd); } catch {} }
}

// Ab Byte `ab` (Zeilengrenze eines früheren Laufs; 0 = Anfang) bis zum Ende, höchstens die letzten maxBytes.
// → { eintraege, bis, abgeschnitten, groesse }: bis = Byte hinter der letzten vollständigen Zeile (eine halbe letzte
// Zeile, die gerade geschrieben wird, zählt erst beim nächsten Lauf); abgeschnitten = Anfang ausgelassen (zu groß).
// Ist die Datei kürzer als `ab` (ersetzt), gilt 0.
export function leseAb(pfad, ab = 0, maxBytes = STUECK_MAX) {
  let fd;
  try {
    fd = openSync(pfad, "r");
    const groesse = fstatSync(fd).size;
    if (!(ab >= 0) || ab > groesse) ab = 0;
    const start = Math.max(ab, groesse - maxBytes);
    const buf = Buffer.alloc(groesse - start);
    if (buf.length) readSync(fd, buf, 0, buf.length, start);
    let ende = buf.lastIndexOf(0x0a) + 1;
    // Rest ohne Zeilenende nur mitnehmen, wenn er schon vollständiges JSON ist (Datei ohne letztes \n).
    if (ende < buf.length && parseZeile(buf.subarray(ende).toString("utf8"))) ende = buf.length;
    const zeilen = buf.subarray(0, ende).toString("utf8").split("\n");
    const abgeschnitten = start > ab;
    if (abgeschnitten) zeilen.shift();                 // mitten in einer Zeile begonnen
    return { eintraege: zeilen.map(parseZeile).filter(Boolean), bis: start + ende, abgeschnitten, groesse };
  } catch { return { eintraege: [], bis: ab, abgeschnitten: false, groesse: 0 }; }
  finally { if (fd !== undefined) try { closeSync(fd); } catch {} }
}

// Ganze Datei als Strom (für K15, Dateien bis Hunderte MB) — fn je gültigem Eintrag. Nach fristMs: Abbruch,
// { vollstaendig: false }. Wirft nie.
export async function jeEintrag(pfad, fn, { fristMs = Infinity, uhr = Date.now } = {}) {
  const ende = uhr() + fristMs;
  let strom;
  try {
    strom = createReadStream(pfad, { encoding: "utf8" });
    const rl = createInterface({ input: strom, crlfDelay: Infinity });
    for await (const z of rl) {
      if (Number.isFinite(fristMs) && uhr() >= ende) { rl.close(); strom.destroy(); return { vollstaendig: false }; }
      const o = parseZeile(z);
      if (o) fn(o);
    }
    return { vollstaendig: true };
  } catch {
    try { strom?.destroy(); } catch {}
    return { vollstaendig: false };
  }
}

// Echte Nutzer-Nachricht → { text }, Slash-Befehl → { befehl }, alles andere (Werkzeug-Ergebnisse, Systemzeilen,
// Nebenzweige/Subagenten, Meta- und Kompaktierungs-Zeilen, Nachrichten anderer Sitzungen) → null.
export function nutzerNachricht(o) {
  if (!o || o.type !== "user" || o.isSidechain || o.isMeta || o.isCompactSummary) return null;
  const c = o.message?.content;
  let t;
  if (typeof c === "string") t = c;
  else if (Array.isArray(c)) {
    if (c.some((x) => x?.type === "tool_result")) return null;
    t = c.filter((x) => x?.type === "text" && typeof x.text === "string").map((x) => x.text).join(" ");
  } else return null;
  const roh = t.trim();
  const b = /^<command-name>\s*\/?([\w:.-]+)/.exec(roh);
  if (b) return { befehl: `/${b[1]}` };
  const ohne = roh.replace(SYSTEM_BLOCK, "").trim();
  if (!ohne || ohne.startsWith("<") || ohne.startsWith("Caveat") || ohne.startsWith("[Request interrupted")) return null;
  if (istSystemNachricht(ohne)) return null;
  // Befehl nur bei „/name" bzw. „/name:untername" — ein Pfad („/Users/…/a.md bitte lesen") ist Text.
  const bf = /^(\/[\w:.-]+)(?:\s|$)/.exec(ohne);
  if (bf) return { befehl: bf[1] };
  return { text: ohne };
}

export function assistentText(o) {
  if (o?.type !== "assistant" || o.isSidechain) return "";
  const c = o.message?.content;
  if (typeof c === "string") return c;
  if (!Array.isArray(c)) return "";
  return c.filter((x) => x?.type === "text" && typeof x.text === "string").map((x) => x.text).join("\n");
}

export function werkzeugAufrufe(o) {
  if (o?.type !== "assistant" || o.isSidechain) return [];
  const c = o.message?.content;
  if (!Array.isArray(c)) return [];
  return c.filter((x) => x?.type === "tool_use" && typeof x.name === "string")
    .map((x) => ({ id: String(x.id ?? ""), name: x.name, input: x.input && typeof x.input === "object" ? x.input : {} }));
}

export function werkzeugErgebnisse(o) {
  if (o?.type !== "user" || o.isSidechain) return [];
  const c = o.message?.content;
  if (!Array.isArray(c)) return [];
  const out = [];
  for (const x of c) {
    if (x?.type !== "tool_result") continue;
    const inhalt = x.content;
    const text = typeof inhalt === "string" ? inhalt
      : Array.isArray(inhalt) ? inhalt.filter((y) => y?.type === "text" && typeof y.text === "string").map((y) => y.text).join("\n") : "";
    out.push({ id: String(x.tool_use_id ?? ""), text, fehler: x.is_error === true });
  }
  return out;
}

// Titel einer Sitzung: selbst vergeben (/rename, --name) oder von Claude Code erzeugt.
export function titelAus(o) {
  if (o?.type === "custom-title" && typeof o.customTitle === "string" && o.customTitle.trim()) return { art: "eigen", titel: o.customTitle.trim() };
  if (o?.type === "ai-title" && typeof o.aiTitle === "string" && o.aiTitle.trim()) return { art: "ki", titel: o.aiTitle.trim() };
  return null;
}

export function kompaktierung(o) {
  if (o?.type !== "system" || o.subtype !== "compact_boundary") return null;
  return o.compactMetadata?.trigger === "manual" ? "manuell" : "auto";
}

// Ausgabe eines Hooks, wie Claude Code sie im Verlauf festhält (attachment.type "hook_success").
export function hookAusgabe(o) {
  const a = o?.type === "attachment" ? o.attachment : null;
  if (!a || a.type !== "hook_success") return null;
  const text = typeof a.content === "string" && a.content ? a.content : typeof a.stdout === "string" ? a.stdout : "";
  return { ereignis: String(a.hookEvent || ""), text };
}

export function zeitVon(o) {
  const ms = Date.parse(o?.timestamp ?? "");
  return Number.isFinite(ms) ? ms : null;
}

// ---------- kleine Text-Helfer (K11, K12, K14, K2) ----------

export function kuerze(text, max) {
  const t = String(text ?? "");
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 11)).trimEnd() + " (gekürzt)";
}

// Ganze Zeilen in Reihenfolge, solange sie ins Budget passen; was nicht passt, wird übersprungen (nie gekürzt).
export function ganzeZeilen(zeilen, max) {
  const out = [];
  let laenge = 0, weggelassen = 0;
  for (const z of zeilen) {
    const l = z.length + (out.length ? 1 : 0);
    if (laenge + l <= max) { out.push(z); laenge += l; } else weggelassen++;
  }
  return { text: out.join("\n"), weggelassen };
}

const zwei = (n) => String(n).padStart(2, "0");
export function datumZeit(ms) {
  if (!Number.isFinite(ms)) return "?";
  const d = new Date(ms);
  return `${zwei(d.getDate())}.${zwei(d.getMonth() + 1)}. ${zwei(d.getHours())}:${zwei(d.getMinutes())}`;
}
export function uhrzeit(ms) {
  if (!Number.isFinite(ms)) return "--:--";
  const d = new Date(ms);
  return `${zwei(d.getHours())}:${zwei(d.getMinutes())}`;
}
