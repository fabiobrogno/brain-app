#!/usr/bin/env node
// ernte.mjs — Hintergrund-Ernte: Claude-Code-Transkript → Haiku (claude -p) → Vorschläge in
// <inbox>/_vorschlaege/. Läuft losgelöst vom Hook (Task 11), nie in der Sitzung. Zugangsdaten werden vor
// dem Senden zeilenweise und nach der Antwort je Vorschlag herausgefiltert. Höchstens ein Lauf zugleich.
// CLI: node ernte.mjs --art stand|fakt --transkript <pfad> --sid <id> --cwd <pfad> [--auftrag <name>.json] [vault]
//      node ernte.mjs --nachernte --transkript <pfad> --sid <id> --cwd <pfad> [--max-fenster N] [vault]   (ganze Sitzung in Fenstern neu ernten)
// Gibt nie etwas aus; Ergebnis steht in .logs/ernte.log. Nur Node-Standardbibliothek.
// Aufruf von claude (Final-Review #3): schlank — keine Werkzeuge, keine MCP-Server, eigener kurzer Systemprompt,
// keine gespeicherte Sitzung, JSON-Ausgabe; die Token-Zahlen aus `usage` landen im ernte.log (tokEin/tokAus).
// „fakt" je Sitzung (Final-Review #2): .logs/ernte/<sid>.fakt merkt sich erst NACH einem erfolgreichen Lauf, bis
// zu welchem Byte das Transkript geerntet ist; der nächste Lauf derselben Sitzung erntet nur den neuen Teil.
// Nach-Ernte (nach dem Probelauf über echten Altbestand): `nachernte: true` / `--nachernte` erntet eine Sitzung OHNE die Byte-Marke
// (.fakt wird weder gelesen noch geschrieben) komplett neu — die GANZE Sitzung in Fenstern à ~24 000 Zeichen (höchstens `maxFenster`,
// Standard 8, sonst gleichmäßig verteilt), je Fenster ein Aufruf, immer art fakt, alle B1-Prüfungen gegen das ganze Transkript; Vorschläge
// mit `nachernte: true`, exakte Dubletten einer Sitzung nur einmal. Fortschritt je Fenster und Erfolg merkt .logs/ernte/nachernte/<sid>
// (Sammelbefehl: nachernte.mjs; Aufräumen im Tageslauf).
// Auftrags-Marke (Final-Review #5): .logs/ernte/offen/<name>.json wird nach Abschluss entfernt (außer „läuft schon").
// B1 (Beleg je Fakt, §4.1): Haiku liefert je Vorschlag eine Zeile „Zitat: …“. Node sucht das Zitat im ganzen Verlauf
// (beleg.mjs) und speichert nur belegte Vorschläge mit zitat/herkunft/fundstelle; ohne Treffer → ohneBeleg, nur KI
// (Assistent, eingespielter Kontext, eigenes Brain) → nurKi. Damit Haiku auch Werkzeug-Ergebnisse zitieren kann,
// gehen gefilterte Werkzeug-Ausgaben (tool/web, ohne Fehler, ohne eigenes Brain, ohne Zugangs-/Kundendaten) mit.
import {
  openSync, readSync, fstatSync, closeSync, writeFileSync, unlinkSync, statSync, mkdirSync,
  mkdtempSync, rmSync, realpathSync, readFileSync, readdirSync, accessSync, constants as fsc,
} from "node:fs";
import { join, delimiter, dirname, extname, isAbsolute, win32 } from "node:path";
import { createHash } from "node:crypto";
import { tmpdir, homedir } from "node:os";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findeSecrets, ohneSecrets, hatSecretsImKontext } from "./secrets-muster.mjs";
import { hatPii } from "./pii-muster.mjs";
import { parseZeile } from "./verlauf.mjs";
import { istSystemNachricht } from "./hint-core.mjs";
import { findeZitat, fundstellen, ladeTranskript, normalisiere } from "./beleg.mjs";
import {
  sperrPfade, markiereEigenes, webAdresse, baueFundstelle, ohneEingespieltes, ergebnisText, aussageGedeckt, worktreePfade, wikiTexte, zitatImWiki, kernsatz, MAX_ZITAT,
} from "./beleg-ernte.mjs";
import { haengeAn, zeitstempel } from "./logs.mjs";
import { leseAutomatik } from "./einstellungen.mjs";
import { schreibeVorschlag } from "./vorschlaege.mjs";
import { nenntThema, THEMA_GRUND } from "./thema-ausschluss.mjs";
import { vaultPfadOderEnde, entferneBom } from "./pfade.mjs";

export const MAX_TRANSKRIPT = 24000;
export const MIN_PROMPTS = 5;
export const MAX_JE_WERKZEUG = 800;           // je Werkzeug-Ausgabe im Haiku-Input (Anfang)
export const MAX_WERKZEUGE = 8000;            // alle Werkzeug-Ausgaben zusammen (neueste zuerst), Teil der 24 000
export const WERKZEUG_KOPF = "\n--- WERKZEUG-AUSGABEN ---\n\n";
const MAX_LESEN = 8 * 1024 * 1024;            // nur das Ende großer Transkripte lesen
const LOCK_ALT_MS = 5 * 60 * 1000;
const ZEITLIMIT_MS = 120000;

// Fester Auftrag — bewusst knapp (Eingabe-Budget ≤ 8k Tokens inkl. Transkript). Geht als --system-prompt an
// claude (ersetzt den großen Claude-Code-Systemprompt); der Verlauf kommt über stdin (VERLAUF_KOPF + Text).
export const VERLAUF_KOPF = "--- VERLAUF ---\n\n";
export function auftrag(art) {
  const gemeinsam = [
    "Du liest unten den Verlauf einer Arbeitssitzung (Nutzer und Assistent) und darunter Werkzeug-Ausgaben.",
    "Schreibe NIE Zugangsdaten, Passwörter, Tokens, Schlüssel, Adressen, Telefonnummern oder Kundendaten.",
    "Belege jeden Vorschlag: letzte Zeile genau \"Zitat: <Auszug>\" — ein wörtlicher Auszug (12 bis 300 Zeichen, eine Zeile)",
    "aus einer Zeile, die mit \"Nutzer:\" oder \"Werkzeug (…):\" beginnt. Aussagen des Assistenten belegen nichts.",
    // nach dem Probelauf über echten Altbestand (Haiku schrieb mehr Details, als sein kurzes Zitat trug → 0 Übernahmen)
    "Ein Fakt (beim Stand: der Kernsatz) = genau das, was sein Zitat wörtlich trägt. Das Zitat ist ein zusammenhängender Auszug",
    "(bevorzugt ganze Sätze oder Zeilen, bis 300 Zeichen), der ALLE Namen, Zahlen, Daten und Verneinungen des Fakts enthält.",
    "Passt nicht alles in ein Zitat: teile den Fakt (jeder Teil bekommt ein eigenes Zitat) oder lass das Detail weg.",
    "Kein Zitat, das nur das Thema berührt. Nutzer-Reaktionen (Lob, Ärger, „ok“, „mach weiter“) sind nie Beleg für einen Sachverhalt.",
    "Findest du keinen solchen Auszug, lass den Vorschlag weg.",
    "Ausgabeformat je Vorschlag genau: eine Zeile \"### <Titel>\", darunter der Text, zuletzt die Zitat-Zeile. Sonst nichts.",
    "Gibt es nichts Neues, antworte nur: NICHTS",
  ];
  const kern = art === "stand"
    ? ["Aufgabe: Fasse den aktuellen Arbeitsstand als EINEN Vorschlag zusammen: was erledigt ist, was offen ist,",
       "nächster Schritt. Höchstens 12 Zeilen, Titel höchstens 60 Zeichen.",
       "Die ERSTE Zeile ist ein Kernsatz (der wichtigste Sachverhalt), den das Zitat vollständig trägt; weitere Zeilen sind optional."]
    : ["Aufgabe: Nenne höchstens 5 dauerhaft nützliche Fakten oder Entscheidungen aus der Sitzung (keine Plaudereien,",
       "nichts Vorübergehendes). Je Fakt 1–2 Sätze, nicht mehr, als das Zitat trägt. Titel höchstens 60 Zeichen."];
  return [...kern, ...gemeinsam].join("\n");
}

const fwd = (p) => String(p).split("\\").join("/");
const ohneGit = (env) => Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith("GIT_")));
// Variablen, die an die LAUFENDE Claude-Sitzung binden (verschachtelte Sitzung, Messaging der Eltern-Sitzung).
// Konfiguration (ANTHROPIC_*, CLAUDE_CODE_USE_BEDROCK, CLAUDE_CODE_GIT_BASH_PATH …) bleibt erhalten.
const SITZUNGS_VARIABLE = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_PROJECT_DIR|CLAUDE_ENV_FILE|CLAUDE_CODE_(SESSION_ID|ENTRYPOINT|SSE_PORT|MESSAGING_\w*|PARENT_\w*|TRANSCRIPT\w*))$/;
export function kindUmgebung(env = process.env) {
  const out = {};
  for (const [k, w] of Object.entries(ohneGit(env))) if (!SITZUNGS_VARIABLE.test(k)) out[k] = w;
  out.BRAIN_ERNTE = "1";
  return out;
}

// ---------- claude finden ----------

function istAusfuehrbar(p) {
  try { if (!statSync(p).isFile()) return false; accessSync(p, fsc.X_OK); return true; } catch { return false; }
}
function istDatei(p) { try { return statSync(p).isFile(); } catch { return false; } }

// npm-Paket neben claude.cmd (Windows-npm-Layout) → Einstiegsskript bzw. native exe.
function ausCmdShim(dir) {
  const paket = join(dir, "node_modules", "@anthropic-ai", "claude-code");
  try {
    const pkg = JSON.parse(readFileSync(join(paket, "package.json"), "utf8"));
    const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.claude;
    if (!bin) return null;
    const ziel = join(paket, bin);
    if (!istDatei(ziel)) return null;
    if (extname(ziel).toLowerCase() === ".exe") return { befehl: ziel, args: [] };
    return { befehl: process.execPath, args: [ziel] };
  } catch { return null; }
}

// { befehl, args } | null. Nie über eine Shell. Testhaken BRAIN_CLAUDE=<skript> → node <skript>.
export function findeClaude({ plattform = process.platform, pfad = process.env.PATH ?? "", env = process.env, home = homedir() } = {}) {
  if (env.BRAIN_CLAUDE) return { befehl: process.execPath, args: [env.BRAIN_CLAUDE] };
  if (plattform === "win32") {
    const dirs = String(pfad).split(";").filter(Boolean);
    for (const dir of dirs) { const exe = join(dir, "claude.exe"); if (istDatei(exe)) return { befehl: exe, args: [] }; }
    for (const dir of dirs) { if (istDatei(join(dir, "claude.cmd"))) { const r = ausCmdShim(dir); if (r) return r; } }
    const nativ = join(home, ".local", "bin", "claude.exe");
    return istDatei(nativ) ? { befehl: nativ, args: [] } : null;
  }
  for (const dir of String(pfad).split(delimiter).filter(Boolean)) {
    const p = join(dir, "claude");
    if (istAusfuehrbar(p)) return { befehl: p, args: [] };
  }
  for (const p of [join(home, ".local", "bin", "claude"), join(home, ".claude", "local", "claude")]) {
    if (istAusfuehrbar(p)) return { befehl: p, args: [] };
  }
  return null;
}

// ---------- ausgeschlossene Ordner ----------

function normPfad(p, plattform) {
  let s = fwd(p).replace(/\/+$/, "");
  return plattform === "darwin" || plattform === "win32" ? s.toLowerCase() : s;
}
function varianten(p, home) {
  let s = String(p || "").trim();
  if (!s) return [];
  if (s === "~" || s.startsWith("~/") || s.startsWith("~\\")) s = join(home, s.slice(1));
  const out = [s];
  try { out.push(realpathSync(s)); } catch {}
  return out;
}
export function istAusgeschlossen(cwd, liste, { plattform = process.platform, home = homedir() } = {}) {
  if (!Array.isArray(liste) || !liste.length) return false;
  const cs = varianten(cwd, home).map(p => normPfad(p, plattform));
  for (const eintrag of liste) {
    for (const e of varianten(eintrag, home).map(p => normPfad(p, plattform))) {
      if (!e) continue;
      if (cs.some(c => c === e || c.startsWith(e + "/"))) return true;
    }
  }
  return false;
}

// ---------- Transkript ----------

// Gemeinsame Helfer (v0.4): Session-Auswerter (lektionen.mjs) und Pflege-Lauf (pflegelauf.mjs) nutzen denselben
// JSONL-Leser, denselben schlanken Haiku-Aufruf (rufeHaiku) und dieselbe Usage-Auswertung (leseClaudeAntwort).

// Ab Byte `ab` (Zeilengrenze eines früheren Laufs; 0 = Anfang), höchstens die letzten MAX_LESEN Bytes.
// → { zeilen, bis }: bis = Byte hinter der letzten vollständigen Zeile (eine unvollständige letzte Zeile, die
// gerade geschrieben wird, zählt erst beim nächsten Lauf). Ist die Datei kürzer als `ab` (ersetzt), gilt 0.
export function leseEnde(pfad, ab = 0) {
  const fd = openSync(pfad, "r");
  try {
    const groesse = fstatSync(fd).size;
    if (!(ab >= 0) || ab > groesse) ab = 0;
    const start = Math.max(ab, groesse - MAX_LESEN);
    const buf = Buffer.alloc(groesse - start);
    readSync(fd, buf, 0, buf.length, start);
    let ende = buf.lastIndexOf(0x0a) + 1;
    // Rest ohne Zeilenende: nur mitnehmen, wenn er schon vollständiges JSON ist (Datei ohne letztes \n).
    if (ende < buf.length) { try { JSON.parse(buf.subarray(ende).toString("utf8")); ende = buf.length; } catch {} }
    const zeilen = entferneBom(buf.subarray(0, ende).toString("utf8")).split(/\r?\n/);
    if (start > ab) zeilen.shift();              // mitten in einer Zeile begonnen
    return { zeilen, bis: start + ende };
  } finally { closeSync(fd); }
}

// Verlauf (Nutzer/Assistent) + gefilterte Werkzeug-Ausgaben ab Byte `ab`, höchstens die letzten 8 MB.
// → { prompts: echte Nutzer-Prompts, text: Verlauf, werkzeuge: Werkzeug-Abschnitt (≤ MAX_WERKZEUGE), bis: gelesen bis Byte }
// Werkzeug-Ausgaben: nur Zeilen, in denen beleg.mjs eine Fundstelle mit Herkunft tool/web sieht — nach markiereEigenes
// (Fehler, unbekannte Aufrufe, eigenes Brain `sperr` → ki), also dieselbe Regel wie bei der Zitat-Prüfung. Der Text kommt
// roh aus der Zeile: ohne eingespielte Blöcke; Zeilen mit Zugangs-/Kundendaten fallen weg, im Zweifel die ganze Ausgabe.
// Zeilen ohne uuid (keine Fundstelle möglich) gehen nicht mit.
function werkzeugAusgabe(inhalt) {
  const zeilen = ohneSecrets(ohneEingespieltes(ergebnisText(inhalt))).split("\n").filter((z) => z.trim() && !hatPii(z));
  const t = zeilen.join("\n").trim();
  if (!t || hatSecretsImKontext(t) || hatPii(t)) return "";
  return t.slice(0, MAX_JE_WERKZEUG);
}
// Stufe-0-Reduktion (gemeinsam für die normale Ernte und die Nach-Ernte): `objekte` = Zeilen des Transkripts, `markiert` = dieselben
// nach markiereEigenes (Werkzeug-Ergebnisse eigener Herkunft sind zu KI-Text geworden). → { prompts, einheiten } — einheiten in
// Zeitfolge: { art: "text" | "werkzeug", text }. Werkzeug-Ausgaben wandern mit der Zeit ihrer Zeile (uuid) in die Reihenfolge.
function reduziere(objekte, markiert, { mcpVertraut = [] } = {}) {
  const quelle = new Map();   // uuid → Werkzeugname, wo beleg.mjs tool/web sieht
  for (const f of fundstellen(markiert, { mcpVertraut })) {
    if ((f.herkunft === "tool" || f.herkunft === "web") && f.uuid && !quelle.has(f.uuid)) quelle.set(f.uuid, f.werkzeug || "?");
  }
  const stelle = new Map();   // uuid → erster Index in objekte
  objekte.forEach((o, i) => { const u = String(o?.uuid ?? ""); if (u && !stelle.has(u)) stelle.set(u, i); });
  const einheiten = [];
  let prompts = 0;
  for (const o of markiert) {
    if (o?.type !== "user" || o.isSidechain || !quelle.has(String(o.uuid ?? "")) || !Array.isArray(o.message?.content)) continue;
    for (const b of o.message.content) {
      if (b?.type !== "tool_result") continue;
      const t = werkzeugAusgabe(b.content);
      if (t) einheiten.push({ pos: stelle.get(String(o.uuid)) ?? Number.MAX_SAFE_INTEGER, art: "werkzeug", text: `Werkzeug (${quelle.get(String(o.uuid))}): ${t}` });
    }
  }
  objekte.forEach((m, i) => {
    const c = m.message?.content;
    const intern = m.isMeta || m.isCompactSummary || m.isSidechain;
    if ((m.type !== "user" && m.type !== "assistant") || intern) return;
    let texte = [];
    if (typeof c === "string") texte = [c];
    else if (Array.isArray(c)) {
      if (m.type === "user" && c.some(x => x?.type === "tool_result")) return;
      texte = c.filter(x => x?.type === "text" && typeof x.text === "string").map(x => x.text);
    }
    texte = texte.map(t => ohneEingespieltes(t)).filter(t => t && !t.startsWith("<") && !istSystemNachricht(t));
    if (!texte.length) return;
    if (m.type === "user") {
      if (texte.every(t => t.startsWith("/"))) return;   // Slash-Befehle zählen nicht
      prompts++;
    }
    const wer = m.type === "user" ? "Nutzer" : "Assistent";
    for (const t of texte) {
      const sauber = ohneSecrets(t).trim();   // Zeilen mit Zugangsdaten, private Schlüssel als ganzer Block
      if (sauber) einheiten.push({ pos: i, art: "text", text: `${wer}: ${sauber}` });
    }
  });
  einheiten.sort((x, y) => x.pos - y.pos);   // stabil: gleiche Stelle behält die Einlese-Reihenfolge
  return { prompts, einheiten };
}

export function leseTranskript(pfad, { ab = 0, sperr = [], mcpVertraut = [] } = {}) {
  const { zeilen, bis } = leseEnde(pfad, ab);
  const objekte = zeilen.map(parseZeile).filter(Boolean);
  const markiert = markiereEigenes(objekte, { sperr });
  const { prompts, einheiten } = reduziere(objekte, markiert, { mcpVertraut });
  const teile = einheiten.filter((e) => e.art === "text").map((e) => e.text);
  const werkzeugTeile = einheiten.filter((e) => e.art === "werkzeug").map((e) => e.text);
  // Werkzeug-Ausgaben: neueste zuerst ins Budget, dann wieder in Zeitfolge.
  const gewaehlt = [];
  let laenge = 0;
  for (let i = werkzeugTeile.length - 1; i >= 0; i--) {
    const l = werkzeugTeile[i].length + 2;
    if (laenge + l > MAX_WERKZEUGE) break;
    gewaehlt.unshift(werkzeugTeile[i]);
    laenge += l;
  }
  const werkzeuge = gewaehlt.join("\n\n");
  const budget = MAX_TRANSKRIPT - (werkzeuge ? WERKZEUG_KOPF.length + werkzeuge.length + 1 : 0);
  let text = teile.join("\n\n");
  if (text.length > budget) {
    text = text.slice(-budget);
    const nl = text.indexOf("\n");
    if (nl >= 0) text = text.slice(nl + 1);              // halbe erste Zeile weg
  }
  return { prompts, text, werkzeuge, bis };
}

// Nach-Ernte: das GANZE Transkript (nicht nur die letzten 8 MB) in aufeinanderfolgende Fenster zerlegen. Je Fenster dieselbe
// Budgetlogik wie bei der normalen Ernte: Verlauf + Werkzeug-Ausgaben ≤ MAX_TRANSKRIPT, Werkzeug-Ausgaben ≤ MAX_WERKZEUGE (weitere
// Ausgaben eines vollen Fensters entfallen), je Ausgabe ≤ MAX_JE_WERKZEUG. Ein einzelner Eintrag über dem Budget wird vorn abgeschnitten.
export function schneideFenster(einheiten, { budget = MAX_TRANSKRIPT, werkzeugMax = MAX_WERKZEUGE } = {}) {
  const fenster = [];
  let teile = [], werk = [], vl = 0, wl = 0;
  const passt = (v, w) => v + (w ? WERKZEUG_KOPF.length + w : 0) <= budget;
  const schliesse = () => {
    if (teile.length) fenster.push({ text: teile.join("\n\n"), werkzeuge: werk.join("\n\n") });   // nur Werkzeug-Ausgaben ohne Verlauf nützen nichts
    teile = []; werk = []; vl = 0; wl = 0;
  };
  for (const e of einheiten) {
    const t = e.art === "text" && e.text.length + 2 > budget - 200 ? e.text.slice(0, budget - 200) : e.text;
    const l = t.length + 2;
    if (e.art === "werkzeug") {
      if (wl + l > werkzeugMax) continue;
      if (!passt(vl, wl + l) && (teile.length || werk.length)) schliesse();
      werk.push(t); wl += l;
    } else {
      if (!passt(vl + l, wl) && (teile.length || werk.length)) schliesse();
      teile.push(t); vl += l;
    }
  }
  schliesse();
  return fenster;
}

export const MAX_FENSTER = 8;   // Standard: Fenster je Sitzung bei der Nach-Ernte
// Welche der n Fenster geerntet werden: alle, wenn n ≤ max; sonst max gleichmäßig über die Sitzung verteilte (erstes und letztes dabei).
export function waehleFenster(n, max = MAX_FENSTER) {
  if (!(n > 0)) return [];
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  if (max <= 1) return [n - 1];
  return Array.from({ length: max }, (_, k) => Math.round((k * (n - 1)) / (max - 1)));
}

// Das ganze Transkript für die Nach-Ernte: { prompts, fenster: [{ text, werkzeuge }], markiert } — `markiert` ist die Zeilenliste für
// die Zitat-Suche über das ganze Transkript (Herkunft, Selbstbestätigung). Wirft bei unlesbarer Datei.
export function leseFenster(pfad, { sperr = [], mcpVertraut = [] } = {}) {
  statSync(pfad);
  const objekte = ladeTranskript(pfad);
  const markiert = markiereEigenes(objekte, { sperr });
  const { prompts, einheiten } = reduziere(objekte, markiert, { mcpVertraut });
  return { prompts, fenster: schneideFenster(einheiten), markiert };
}

// ---------- Antwort ----------

const ZITAT_ZEILE = /^[*_>\s-]*zitat[*_]*\s*:[*_]*\s*(.*)$/i;
const VORSATZ = /^(?:nutzer|werkzeug\s*\([^)]*\))\s*:\s*/i;
const HUELLEN = [["\"", "\""], ["„", "“"], ["“", "”"], ["«", "»"], ["‚", "‘"], ["'", "'"]];
// „Zitat: Werkzeug (Bash): „…““ → der reine Auszug (Vorsatz und eine äußere Anführungs-Hülle weg, zweimal).
export function saubereZitat(roh) {
  let z = String(roh ?? "").trim();
  for (let i = 0; i < 2; i++) {
    z = z.replace(VORSATZ, "").trim();
    for (const [a, b] of HUELLEN) if (z.length >= 2 && z.startsWith(a) && z.endsWith(b)) { z = z.slice(a.length, -b.length).trim(); break; }
  }
  return z;
}

export function parseAntwort(ausgabe, art) {
  const t = String(ausgabe || "").replace(/\r\n?/g, "\n").trim();
  if (!t || /^NICHTS\b/.test(t)) return [];
  const out = [];
  for (const block of t.split(/^###[ \t]+/m).slice(1)) {
    const [kopf, ...rest] = block.split("\n");
    const titel = kopf.trim().slice(0, 60);
    let zitat = "";
    const zeilen = [];
    for (const z of rest) {
      const m = ZITAT_ZEILE.exec(z.trim());
      if (m) { if (!zitat) zitat = saubereZitat(m[1]); continue; }   // die Zitat-Zeile gehört nicht zum Text
      zeilen.push(z);
    }
    let text = zeilen.join("\n").trim();
    if (art === "stand") text = text.split("\n").slice(0, 12).join("\n");
    if (titel && text) out.push({ titel, text, zitat });
  }
  return out.slice(0, art === "stand" ? 1 : 5);
}

// claude -p --output-format json → { text, tokens: {ein, aus} | null, fehler }. Defensiv: kein JSON oder kein
// `result` → Rohtext bzw. leer; ohne `usage` keine Token-Zahl (dann bleibt nur die Zeichenzählung im Log).
export function leseClaudeAntwort(stdout) {
  const roh = String(stdout || "");
  let j = null;
  try { j = JSON.parse(roh); } catch {}
  if (!j || typeof j !== "object" || Array.isArray(j)) return { text: roh, tokens: null, fehler: null };
  const n = (x) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Math.round(Number(x)) : 0);
  const u = j.usage && typeof j.usage === "object" ? j.usage : null;
  const tokens = u && (u.input_tokens != null || u.output_tokens != null)
    ? { ein: n(u.input_tokens) + n(u.cache_creation_input_tokens) + n(u.cache_read_input_tokens), aus: n(u.output_tokens), cache: n(u.cache_read_input_tokens) }
    : null;
  return { text: typeof j.result === "string" ? j.result : "", tokens, fehler: j.is_error === true ? "claude meldet Fehler" : null };
}

// Die Argumente für claude: Prompt kommt über stdin. --tools "" = keine eingebauten Werkzeuge,
// --strict-mcp-config + leere --mcp-config = keine MCP-Server (auch nicht aus ~/.claude.json/Connectors),
// --system-prompt ersetzt den Claude-Code-Systemprompt, --no-session-persistence legt kein Sitzungsprotokoll an.
// `modell`: Standard haiku; der Richter des Tageslaufs (richter.mjs) fragt sonnet. Nur [a-z0-9.-] zählt, alles andere fällt auf haiku zurück.
export function haikuArgs(systemPrompt, modell = "haiku") {
  const m = /^[a-z0-9.-]{1,30}$/.test(String(modell)) ? String(modell) : "haiku";
  return ["-p", "--model", m, "--tools", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
    "--system-prompt", systemPrompt, "--no-session-persistence", "--setting-sources", "project", "--output-format", "json"];
}
export function claudeArgs(art) {
  return haikuArgs(auftrag(art));
}

// ---------- Marken ----------

const ERNTE_DIR = (vault) => join(vault, ".logs", "ernte");
export const NACHERNTE_DIR = (vault) => join(ERNTE_DIR(vault), "nachernte");
const reinSidVon = (sid) => String(sid || "").replace(/[^\w-]/g, "").slice(0, 64);
export const AUFTRAG_NAME = /^[\w-]{1,80}\.json$/;
function leseFaktStand(vault, sid) {
  if (!sid) return 0;
  try { const b = Number(JSON.parse(readFileSync(join(ERNTE_DIR(vault), `${sid}.fakt`), "utf8")).bis); return b > 0 ? b : 0; }
  catch { return 0; }
}
function schreibeFaktStand(vault, sid, bis) {
  if (!sid) return;
  try { mkdirSync(ERNTE_DIR(vault), { recursive: true }); writeFileSync(join(ERNTE_DIR(vault), `${sid}.fakt`), JSON.stringify({ bis }) + "\n"); } catch {}
}

// Nach-Ernte-Marken: .logs/ernte/nachernte/<sid> = { status: "ok", vorschlaege, fenster, gesehen, zeit } | { status: "uebersprungen", grund, zeit }
// | { status: "laeuft", groesse, fenster, gewaehlt, fertig, vorschlaege, gesehen, zeit } (Zwischenstand je Fenster).
// Nur „ok“ zählt als nachgeerntet (Tageslauf-Aufräumen); ok und uebersprungen überspringt der Sammelbefehl, „laeuft“ setzt er fort.
export function leseNachernteMarke(vault, sid) {
  const rein = reinSidVon(sid);
  if (!rein) return null;
  try { const m = JSON.parse(readFileSync(join(NACHERNTE_DIR(vault), rein), "utf8")); return m && typeof m === "object" ? m : null; } catch { return null; }
}
export function leseNachernteMarken(vault) {
  const out = new Map();
  let namen = [];
  try { namen = readdirSync(NACHERNTE_DIR(vault)); } catch { return out; }
  for (const n of namen) { const m = leseNachernteMarke(vault, n); if (m && reinSidVon(n) === n) out.set(n, m); }
  return out;
}
export function schreibeNachernteMarke(vault, sid, daten) {
  const rein = reinSidVon(sid);
  if (!rein) return false;
  try { mkdirSync(NACHERNTE_DIR(vault), { recursive: true }); writeFileSync(join(NACHERNTE_DIR(vault), rein), JSON.stringify(daten) + "\n"); return true; } catch { return false; }
}
// Fertig = erledigt für den Sammelbefehl: erfolgreich (ok) oder dauerhaft übersprungen. „laeuft“ = angefangen, wird fortgesetzt.
export const nachernteFertig = (m) => m?.status === "ok" || m?.status === "uebersprungen";

// ---------- Lock ----------

export function nimmLock(datei, jetzt) {
  mkdirSync(dirname(datei), { recursive: true });
  for (let versuch = 0; versuch < 2; versuch++) {
    try { writeFileSync(datei, `${process.pid}\n`, { flag: "wx" }); return true; }
    catch (e) {
      if (e.code !== "EEXIST") return false;
      let alt = false;
      try { alt = jetzt - statSync(datei).mtimeMs > LOCK_ALT_MS; } catch { continue; }
      if (!alt) return false;
      try { unlinkSync(datei); } catch {}
    }
  }
  return false;
}

// ---------- Lauf ----------

// Fester, leerer Arbeitsordner je Vault (Final-Review #9): claude legt je Arbeitsordner einen Projekteintrag an —
// mit einem festen Ordner bleibt es bei einem statt einem je Lauf. Vor dem Lauf frisch angelegt (nur wir, 0700);
// gelingt das nicht (z. B. fremder Ordner gleichen Namens im geteilten /tmp), Rückfall auf einen Zufallsordner.
// `zweck` (v0.4): eigener fester Ordner je Aufgabe (z. B. "lektion", "pflege"), damit parallele Läufe von Ernte,
// Session-Auswerter und Pflege-Lauf einander den Arbeitsordner nicht wegräumen. Ohne zweck: wie bisher.
export function arbeitsOrdner(vault, zweck = "") {
  const z = String(zweck || "").replace(/[^a-z0-9]/g, "").slice(0, 20);
  return join(tmpdir(), `brain-ernte-${createHash("sha256").update(fwd(vault)).digest("hex").slice(0, 12)}${z ? `-${z}` : ""}`);
}
function legeArbeitsOrdnerAn(vault, zweck = "") {
  const fest = arbeitsOrdner(vault, zweck);
  try { rmSync(fest, { recursive: true, force: true }); mkdirSync(fest, { mode: 0o700 }); return fest; } catch {}
  return mkdtempSync(join(tmpdir(), "brain-ernte-"));
}

function rufeClaude(claudeBefehl, art, eingabe, vault) {
  return rufeHaiku(claudeBefehl, auftrag(art), eingabe, vault);
}

// Schlanker Haiku-Aufruf mit eigenem Systemprompt; Eingabe über stdin. → { ausgabe } | { fehler }.
export function rufeHaiku(claudeBefehl, systemPrompt, eingabe, vault, { zweck = "", modell = "haiku" } = {}) {
  return new Promise((resolve) => {
    let arbeitsDir;
    try { arbeitsDir = legeArbeitsOrdnerAn(vault, zweck); }
    catch { resolve({ fehler: "kein Temp-Ordner" }); return; }
    const aufraeumen = () => { try { rmSync(arbeitsDir, { recursive: true, force: true }); } catch {} };
    let kind;
    try {
      kind = execFile(claudeBefehl.befehl,
        [...claudeBefehl.args, ...haikuArgs(systemPrompt, modell)],
        { cwd: arbeitsDir, env: kindUmgebung(), timeout: ZEITLIMIT_MS,
          windowsHide: true, maxBuffer: 1024 * 1024, encoding: "utf8" },
        (err, stdout) => {
          aufraeumen();
          if (err) resolve({ fehler: err.killed ? "Zeitlimit" : (err.code === "ENOENT" ? "claude nicht startbar" : `Exit ${err.code ?? "?"}`) });
          else resolve({ ausgabe: String(stdout || "") });
        });
    } catch { aufraeumen(); resolve({ fehler: "claude nicht startbar" }); return; }
    kind.stdin?.on("error", () => {});
    kind.stdin?.end(eingabe);
  });
}

// auftragsMarke: Name einer Datei unter .logs/ernte/offen/ (vom Auslöser angelegt) — wird nach dem Lauf entfernt,
// egal ob ok, fehler oder übersprungen; nur bei „läuft schon" bleibt sie für einen späteren Lauf liegen.
// nachernte: true → Nach-Ernte der GANZEN Sitzung in Fenstern (nachernteLauf), sonst die laufende Ernte (ernteLauf).
export async function ernte(vault, opt = {}) {
  const r = await (opt.nachernte ? nachernteLauf(vault, opt) : ernteLauf(vault, opt));
  const name = String(opt.auftragsMarke || "");
  if (AUFTRAG_NAME.test(name) && r.grund !== "läuft schon") {
    try { unlinkSync(join(ERNTE_DIR(vault), "offen", name)); } catch {}
  }
  return r;
}

// Schlüssel für „exakte Dublette innerhalb einer Sitzung“: gleicher normalisierter Titel + gleiches normalisiertes Zitat.
const dublettenSchluessel = (titel, zitat) =>
  createHash("sha256").update(`${normalisiere(titel).toLowerCase()}\0${normalisiere(zitat).toLowerCase()}`).digest("hex").slice(0, 16);

// Log-Anhang „ thema=N“ nur bei Treffern des Themen-Ausschlusses (sonst bleibt die Zeile, wie sie war).
const themaZahl = (n) => (n.thema ? ` thema=${n.thema}` : "");

// Prüfreihenfolge je Vorschlag: Themen-Ausschluss (ernteOhneThema, eigene Zahl) → dann (B1): Zugangs-/Kundendaten → verworfen; Zitat fehlt, zu kurz/lang (beleg.mjs: 12–300)
// oder nicht im Verlauf → ohneBeleg; nur KI → nurKi; Fakt (beim Stand: der Kernsatz), dessen Aussage Zahl/Datum/Uhrzeit/Verneinung nennt,
// die das Zitat nicht hat → ungedeckt (zählt auch als ohneBeleg); schon geschrieben (gesehen, nur Nach-Ernte) → dubletten; sonst speichern.
// Gesucht wird im GANZEN Verlauf. `geladen` hält die Zeilenliste (alle) und die Wiki-Texte (wiki) für mehrere Aufrufe.
function pruefeUndSpeichere(vault, { antwortText, art, cwd, sid, reinSid, jetzt, nachernte = false, werte, sperr, geladen, gesehen = null }) {
  const ids = [];
  const n = { verworfen: 0, ohneBeleg: 0, nurKi: 0, ungedeckt: 0, dubletten: 0, thema: 0 };
  for (const v of parseAntwort(antwortText, art)) {
    // Themen-Ausschluss (ernteOhneThema): ein Vorschlag, der ein ausgeschlossenes Wort nennt, wird gar nicht erst angelegt. Gezählt wird
    // nur die Zahl — das Wort und der Vorschlag stehen in keinem Log.
    if (nenntThema(werte.ernteOhneThema, v.titel, v.text, v.zitat)) { n.thema++; continue; }
    if (findeSecrets(`${v.titel}\n${v.text}\n${v.zitat}`).length || hatSecretsImKontext(v.zitat) || hatPii(v.zitat)) { n.verworfen++; continue; }
    geladen.alle ??= markiereEigenes(ladeTranskript(geladen.transkript), { sperr });
    const fund = v.zitat ? findeZitat(geladen.alle, v.zitat, { mcpVertraut: werte.mcpVertraut }) : null;
    if (!fund) { n.ohneBeleg++; continue; }
    // Steht das Zitat schon wörtlich im eigenen Wiki, ist es Brain-Inhalt — gleich auf welchem Weg es zurückkam.
    geladen.wiki ??= wikiTexte(vault);
    if (fund.herkunft === "ki" || zitatImWiki(v.zitat, geladen.wiki)) { n.nurKi++; continue; }
    // Fakt: Titel + Text gegen das Zitat. Stand: nur der Kernsatz (erste Zeile) — ein Stand fasst bis zu 12 Zeilen zusammen,
    // die kann kein 300-Zeichen-Zitat Zahl für Zahl decken; geschrieben und geprüft wird später ebenfalls nur der Kernsatz.
    if (!aussageGedeckt(art === "stand" ? kernsatz(v.text) : `${v.titel}\n${v.text}`, v.zitat).gedeckt) { n.ohneBeleg++; n.ungedeckt++; continue; }
    const schluessel = gesehen ? dublettenSchluessel(v.titel, v.zitat) : null;
    if (schluessel && gesehen.has(schluessel)) { n.dubletten++; continue; }
    try {
      ids.push(schreibeVorschlag(vault, {
        art, titel: v.titel, text: v.text, ordner: cwd, sitzung: sid,
        zitat: v.zitat.replace(/\s+/g, " ").trim().slice(0, MAX_ZITAT), herkunft: fund.herkunft,
        fundstelle: baueFundstelle({ sitzung: reinSid, uuid: fund.uuid, zeit: fund.zeit }),
        quelleUrl: fund.herkunft === "web" ? webAdresse(geladen.alle, fund.uuid) : "", nachernte,
      }, new Date(jetzt)));
      if (schluessel) gesehen.add(schluessel);
    } catch (e) { if (e?.grund === THEMA_GRUND) n.thema++; else n.verworfen++; }   // zentraler Guard in schreibeVorschlag (z. B. Wort nur in der Quellen-Adresse)
  }
  return { ids, n };
}

async function ernteLauf(vault, { art, transkript, sid = "", cwd = "", claudeBefehl = findeClaude(), jetzt = Date.now() } = {}) {
  const ergebnis = (status, grund, vorschlaege = []) => ({ status, ...(grund ? { grund } : {}), vorschlaege });
  if (process.env.BRAIN_ERNTE === "1") return ergebnis("uebersprungen", "Selbstaufruf");
  const reinSid = reinSidVon(sid);
  const log = join(vault, ".logs", "ernte.log");
  const protokoll = (status, ein, aus, extra = "") =>
    haengeAn(log, `${zeitstempel(new Date(jetzt))} art=${art} status=${status} ein=${ein} aus=${aus}${extra}`);
  const tokFeld = (t) => (t ? ` tokEin=${t.ein} tokAus=${t.aus}` : "");
  try {
    if (art !== "stand" && art !== "fakt") return ergebnis("fehler", "unbekannte Art");
    // Fail-closed: ohne lesbare Config oder ohne bekannten Arbeitsordner lässt sich ernteNichtIn nicht prüfen.
    const { werte, fehler } = leseAutomatik(vault);
    if (fehler) return ergebnis("uebersprungen", "Config nicht lesbar");
    if (!cwd || !(isAbsolute(cwd) || win32.isAbsolute(cwd))) return ergebnis("uebersprungen", "Ordner unbekannt");
    if (istAusgeschlossen(cwd, werte.ernteNichtIn)) return ergebnis("uebersprungen", "ausgeschlossener Ordner");

    if (typeof transkript !== "string" || !transkript) return ergebnis("uebersprungen", "Transkript nicht lesbar");
    const lock = join(ERNTE_DIR(vault), "lauf.lock");
    if (!nimmLock(lock, jetzt)) return ergebnis("uebersprungen", "läuft schon");
    try {
      // Erst unter dem Lock lesen, bis wohin diese Sitzung schon geerntet ist — so ernten zwei Läufe derselben
      // Sitzung nie denselben Teil doppelt.
      const ab = art === "fakt" ? leseFaktStand(vault, reinSid) : 0;
      let gelesen;
      const sperr = sperrPfade(vault, [...werte.ernteNichtIn, ...worktreePfade(vault)]);
      try { gelesen = leseTranskript(transkript, { ab, sperr, mcpVertraut: werte.mcpVertraut }); } catch { return ergebnis("uebersprungen", "Transkript nicht lesbar"); }
      if (ab > 0 && gelesen.bis <= ab) return ergebnis("uebersprungen", "nichts Neues");
      // Folgelauf derselben Sitzung: die Sitzung war schon lang genug, ein neuer Prompt reicht.
      if (gelesen.prompts < (ab > 0 ? 1 : MIN_PROMPTS)) return ergebnis("uebersprungen", "zu kurze Sitzung");
      if (!gelesen.text) return ergebnis("uebersprungen", "kein Text");
      if (!claudeBefehl) { protokoll("fehler", 0, 0, " grund=claude-fehlt"); return ergebnis("fehler", "claude nicht gefunden"); }

      const eingabe = VERLAUF_KOPF + gelesen.text + "\n" + (gelesen.werkzeuge ? WERKZEUG_KOPF + gelesen.werkzeuge + "\n" : "");
      const einZeichen = auftrag(art).length + eingabe.length;
      const r = await rufeClaude(claudeBefehl, art, eingabe, vault);
      const antwort = r.fehler ? null : leseClaudeAntwort(r.ausgabe);
      const fehler = r.fehler || antwort.fehler;
      if (fehler) {
        protokoll("fehler", einZeichen, 0, `${tokFeld(antwort?.tokens)} grund=${encodeURIComponent(fehler)}`);
        return ergebnis("fehler", fehler);
      }
      const { ids, n } = pruefeUndSpeichere(vault, { antwortText: antwort.text, art, cwd, sid, reinSid, jetzt, werte, sperr, geladen: { transkript, alle: null, wiki: null } });
      protokoll("ok", einZeichen, antwort.text.length, `${tokFeld(antwort.tokens)} vorschlaege=${ids.length} verworfen=${n.verworfen} ohneBeleg=${n.ohneBeleg} nurKi=${n.nurKi} ungedeckt=${n.ungedeckt}${themaZahl(n)}`);
      if (art === "fakt") schreibeFaktStand(vault, reinSid, gelesen.bis);
      return ergebnis("ok", null, ids);
    } finally { try { unlinkSync(lock); } catch {} }
  } catch {
    protokoll("fehler", 0, 0, " grund=intern");
    return ergebnis("fehler", "interner Fehler");
  }
}

// Nach-Ernte einer Sitzung (nur Fakten): die GANZE Sitzung in Fenstern à ~24 000 Zeichen, je Fenster ein Haiku-Aufruf mit allen
// B1-Prüfungen gegen das ganze Transkript. Mehr als `maxFenster` Fenster → gleichmäßig über die Sitzung verteilte Auswahl. Ohne die
// Byte-Marke (.fakt). Fortschritt je Fenster in .logs/ernte/nachernte/<sid> (status „laeuft“ mit fertig/gewaehlt/groesse/gesehen):
// ein abgebrochener Lauf (Budget, Fehler, Sperre) setzt dort an; ändert sich die Transkript-Größe, beginnt er von vorn — die
// gesehenen Schlüssel (normalisierter Titel + Zitat) verhindern auch dann doppelte Vorschläge.
// → { status: "ok" | "teilweise" (grund budget) | "uebersprungen" | "fehler", grund?, vorschlaege: [ids dieses Aufrufs], aufrufe }
async function nachernteLauf(vault, { transkript, sid = "", cwd = "", claudeBefehl = findeClaude(), jetzt = Date.now(), maxFenster = MAX_FENSTER, maxAufrufe = Infinity } = {}) {
  const art = "fakt";   // ein Stand eines alten Laufs überholte den neueren Stand der Seite — nur Fakten werden nachgeerntet
  const ids = [];
  let aufrufe = 0;
  const ergebnis = (status, grund) => ({ status, ...(grund ? { grund } : {}), vorschlaege: ids, aufrufe });
  if (process.env.BRAIN_ERNTE === "1") return ergebnis("uebersprungen", "Selbstaufruf");
  const reinSid = reinSidVon(sid);
  const zeit = () => new Date(jetzt).toISOString().slice(0, 19) + "Z";
  const log = join(vault, ".logs", "ernte.log");
  const protokoll = (status, ein, aus, extra = "", fenster = "") =>
    haengeAn(log, `${zeitstempel(new Date(jetzt))} art=${art} status=${status} ein=${ein} aus=${aus}${extra} nachernte=1${fenster ? ` fenster=${fenster}` : ""}`);
  const tokFeld = (t) => (t ? ` tokEin=${t.ein} tokAus=${t.aus}` : "");
  // Dauerhafte Gründe zum Überspringen: ein weiterer Versuch änderte nichts → Marke „uebersprungen“ (Fehler/Sperre: keine Marke).
  const dauerhaft = (grund) => { schreibeNachernteMarke(vault, reinSid, { status: "uebersprungen", grund, zeit: zeit() }); return ergebnis("uebersprungen", grund); };
  try {
    if (!reinSid) return ergebnis("uebersprungen", "Sitzung unbekannt");   // ohne Sitzung keine Marke → nie ernten
    const { werte, fehler } = leseAutomatik(vault);
    if (fehler) return ergebnis("uebersprungen", "Config nicht lesbar");
    if (!cwd || !(isAbsolute(cwd) || win32.isAbsolute(cwd))) return ergebnis("uebersprungen", "Ordner unbekannt");
    if (istAusgeschlossen(cwd, werte.ernteNichtIn)) return dauerhaft("ausgeschlossener Ordner");
    if (typeof transkript !== "string" || !transkript) return ergebnis("uebersprungen", "Transkript nicht lesbar");

    const sperr = sperrPfade(vault, [...werte.ernteNichtIn, ...worktreePfade(vault)]);
    let gelesen, groesse;
    try { groesse = statSync(transkript).size; gelesen = leseFenster(transkript, { sperr, mcpVertraut: werte.mcpVertraut }); } catch { return ergebnis("uebersprungen", "Transkript nicht lesbar"); }
    if (gelesen.prompts < MIN_PROMPTS) return dauerhaft("zu kurze Sitzung");
    if (!gelesen.fenster.length) return dauerhaft("kein Text");
    const gewaehlt = waehleFenster(gelesen.fenster.length, maxFenster);

    const alt = leseNachernteMarke(vault, reinSid);
    const weiter = alt?.status === "laeuft" && alt.groesse === groesse && Array.isArray(alt.fertig) && JSON.stringify(alt.gewaehlt) === JSON.stringify(gewaehlt);
    const fertig = new Set(weiter ? alt.fertig : []);
    const gesehen = new Set(Array.isArray(alt?.gesehen) ? alt.gesehen.filter((x) => typeof x === "string") : []);
    let summe = weiter ? Number(alt.vorschlaege) || 0 : 0;
    const merke = (ok) => schreibeNachernteMarke(vault, reinSid, ok
      ? { status: "ok", vorschlaege: summe, fenster: gewaehlt.length, gesehen: [...gesehen], zeit: zeit() }
      : { status: "laeuft", groesse, fenster: gewaehlt.length, gewaehlt, fertig: [...fertig].sort((a, b) => a - b), vorschlaege: summe, gesehen: [...gesehen], zeit: zeit() });

    const lock = join(ERNTE_DIR(vault), "lauf.lock");
    const geladen = { transkript, alle: gelesen.markiert, wiki: null };
    for (const [k, idx] of gewaehlt.entries()) {
      if (fertig.has(idx)) continue;
      if (aufrufe >= maxAufrufe) return ergebnis("teilweise", "budget");
      if (!claudeBefehl) { protokoll("fehler", 0, 0, " grund=claude-fehlt"); return ergebnis("fehler", "claude nicht gefunden"); }
      // Die Sperre gilt je Fenster: eine laufende Ernte aus dem Hook kommt zwischen zwei Fenstern dran.
      if (!nimmLock(lock, jetzt)) return ergebnis("uebersprungen", "läuft schon");
      try {
        const f = gelesen.fenster[idx];
        const eingabe = VERLAUF_KOPF + f.text + "\n" + (f.werkzeuge ? WERKZEUG_KOPF + f.werkzeuge + "\n" : "");
        const einZeichen = auftrag(art).length + eingabe.length;
        const nr = `${k + 1}/${gewaehlt.length}`;
        aufrufe++;
        const r = await rufeClaude(claudeBefehl, art, eingabe, vault);
        const antwort = r.fehler ? null : leseClaudeAntwort(r.ausgabe);
        const fehlerText = r.fehler || antwort.fehler;
        if (fehlerText) {
          protokoll("fehler", einZeichen, 0, `${tokFeld(antwort?.tokens)} grund=${encodeURIComponent(fehlerText)}`, nr);
          return ergebnis("fehler", fehlerText);
        }
        const { ids: neu, n } = pruefeUndSpeichere(vault, { antwortText: antwort.text, art, cwd, sid, reinSid, jetzt, nachernte: true, werte, sperr, geladen, gesehen });
        ids.push(...neu);
        summe += neu.length;
        fertig.add(idx);
        protokoll("ok", einZeichen, antwort.text.length, `${tokFeld(antwort.tokens)} vorschlaege=${neu.length} verworfen=${n.verworfen} ohneBeleg=${n.ohneBeleg} nurKi=${n.nurKi} ungedeckt=${n.ungedeckt} dubletten=${n.dubletten}${themaZahl(n)}`, nr);
        merke(false);
      } finally { try { unlinkSync(lock); } catch {} }
    }
    merke(true);
    return ergebnis("ok");
  } catch {
    protokoll("fehler", 0, 0, " grund=intern");
    return ergebnis("fehler", "interner Fehler");
  }
}

// ---------- CLI ----------

export function nachernteZeile(sid, r) {
  const n = r.vorschlaege?.length ?? 0;
  if (r.status === "ok") return `Nach-Ernte ${sid}: ok, ${n} ${n === 1 ? "Vorschlag" : "Vorschläge"}.`;
  if (r.status === "uebersprungen") return `Nach-Ernte ${sid}: übersprungen (${r.grund}).`;
  return `Nach-Ernte ${sid}: Fehler (${r.grund}).`;
}
const SCHALTER = new Set(["nachernte"]);   // Flags ohne Wert
export function leseArgs(argv) {
  const flags = {}, rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const name = a.slice(2);
      if (SCHALTER.has(name)) flags[name] = true; else { flags[name] = argv[i + 1]; i++; }
    } else rest.push(a);
  }
  return { flags, vault: rest[0] || vaultPfadOderEnde([]) };
}

const selbst = fileURLToPath(import.meta.url);
let aufruf = "";
try { aufruf = realpathSync(process.argv[1] || ""); } catch {}
if (aufruf && aufruf === realpathSync(selbst)) {
  const { flags, vault } = leseArgs(process.argv.slice(2));
  const mf = Number(flags["max-fenster"]);
  const r = await ernte(vault, { art: flags.art, transkript: flags.transkript, sid: flags.sid || "", cwd: flags.cwd || "", auftragsMarke: flags.auftrag || "", nachernte: flags.nachernte === true,
    ...(Number.isInteger(mf) && mf >= 1 && mf <= 100 ? { maxFenster: mf } : {}) });
  // Die Ernte aus dem Hook bleibt stumm (Ergebnis im ernte.log); die Nach-Ernte von Hand meldet eine Zeile.
  if (flags.nachernte === true) console.log(nachernteZeile(flags.sid || "?", r));
  process.exitCode = r.status === "fehler" ? 1 : 0;
}
