// .tools/beleg.mjs — Beleg-Prüfung (Lernkreislauf-Spec §4.1): steht das Zitat wörtlich im Claude-Code-Transkript,
// und woher stammt die Fundstelle (du · tool · web · ki)? Regelbasiert, keine KI. Grundsatz: im Zweifel ki oder
// null — eingespielter Kontext (system-reminder, Hook-Ausgaben, Skill-Texte, Zusammenfassungen) darf nie als
// Aussage des Nutzers zählen, sonst bestätigt sich das Brain selbst. Ebenso Claudes eigener Text, der über ein Werkzeug
// zurückkommt (echo, Write → Read, Commit-Text → git log): steht das Zitat schon vorher in einem Assistenten-Segment,
// wird aus tool/web ki (K2). Web-Inhalte über Bash (curl, wget, URL) und MCP-Werkzeuge gelten als web (W2).
// Zeilen lesen über verlauf.mjs (parseZeile).
// Wirft nie; speichert und loggt nichts. Nur Node-Standardbibliothek.
import { readFileSync } from "node:fs";
import { parseZeile } from "./verlauf.mjs";

// Stärke der Herkunft: bei mehreren Fundstellen gewinnt der höchste Rang, bei Gleichstand die früheste.
export const HERKUNFT_RANG = { tool: 3, du: 2, web: 1, ki: 0 };
const RANG_MAX = Math.max(...Object.values(HERKUNFT_RANG));

export const ZITAT_MIN = 12;   // kürzer = Zufallstreffer
export const ZITAT_MAX = 300;  // länger wird abgelehnt, nicht gekürzt

// Zitat und Transkripttext werden gleich geglättet; Groß/Klein bleibt.
export function normalisiere(text) {
  if (typeof text !== "string") return "";
  return text.normalize("NFC")
    .replace(/[„“”«»]/g, '"')
    .replace(/[‚‘’‹›]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/\*{2,}|`/g, "")   // **fett** und `code`: Hervorhebung, nie Inhalt (Haiku gibt Zitate oft mit/ohne wieder)
    .replace(/\s+/g, " ")
    .trim();
}

// JSONL → Objekte; kaputte/halbe Zeilen und Nicht-Objekte entfallen, fehlende Datei → [].
// Byteweise nach Zeilen geteilt: sehr große Verläufe sprengen sonst die Stringgrenze von V8.
export function ladeTranskript(pfad) {
  let buf;
  try { buf = readFileSync(pfad); } catch { return []; }
  const out = [];
  for (let start = 0; start < buf.length;) {
    let ende = buf.indexOf(0x0a, start);
    if (ende < 0) ende = buf.length;
    const o = parseZeile(buf.toString("utf8", start, ende));
    if (o) out.push(o);
    start = ende + 1;
  }
  return out;
}

// ---------- Herkunft ----------

const TOOL_NAMEN = new Set(["Read", "Bash", "BashOutput", "Grep", "Glob", "LS", "NotebookRead"]);
const WEB_NAMEN = new Set(["WebFetch", "WebSearch"]);
// Read-Ergebnisse tragen je Zeile eine Zeilennummer ("   12\t…" oder "12→…"); sie gehört nicht zum Dateiinhalt.
// Nur hier entfernen: bei Bash/Grep/MCP ist eine führende Zahl echter Inhalt.
const MIT_ZEILENNUMMERN = new Set(["Read", "NotebookRead"]);
const ZEILENNUMMER = /^[ \t]*\d+(?:\t|→)/gm;

// Bash holt Web-Inhalt, sobald der Befehl curl, wget oder eine http(s)-Adresse nennt (auch nur zum Lesen: dann eben web).
const WEB_BEFEHL = /(?<![\p{L}\p{N}_-])(?:curl|wget)(?![\p{L}\p{N}_])|https?:\/\//iu;
// MCP-Server liefern fremde Daten, nicht Dateien des Nutzers: web, außer der Werkzeugname steht in `mcpVertraut`
// (Namen oder Präfix mit „*“ am Ende, z. B. "mcp__lager__*").
function mcpVertraut(name, liste) {
  return Array.isArray(liste) && liste.some((e) => typeof e === "string" && e && (e.endsWith("*") ? name.startsWith(e.slice(0, -1)) : e === name));
}

// Werkzeugname (+ Eingabe) → Herkunft des Ergebnisses. Agent, Task, Skill und alles Unbekannte (auch ohne Namen) → ki.
function herkunftVonWerkzeug(name, input, vertraut) {
  if (typeof name !== "string") return "ki";
  if (name === "Bash") return WEB_BEFEHL.test(typeof input?.command === "string" ? input.command : textVon(input)) ? "web" : "tool";
  if (name.startsWith("mcp__")) return mcpVertraut(name, vertraut) ? "tool" : "web";
  if (TOOL_NAMEN.has(name)) return "tool";
  if (WEB_NAMEN.has(name)) return "web";
  return "ki";
}

// Vom Werkzeug in Nutzer-Zeilen eingefügte Blöcke. Kontext → ki; <bash-input> hat der Nutzer selbst eingegeben (du),
// <bash-stdout>/<bash-stderr> ist die Ausgabe dieses Befehls (tool). <command-args> bleibt Nutzertext (vom Nutzer getippt).
// <ide_selection>, <ide_opened_file> & Co. gibt die IDE-Erweiterung mit (Auswahl, geöffnete Datei): Kontext, kein Nutzertext.
const BLOCK_TAG = /<(\/?)(system-reminder|command-message|command-name|local-command-[a-z-]+|ide_[a-z_]+|bash-input|bash-stdout|bash-stderr)>/g;
// Nachrichten, die Claude Code selbst erzeugt, auch wenn sie als „user" im Verlauf stehen.
const FREMDTEXT = /^\s*(<task-notification|<agent-message|\[SYSTEM NOTIFICATION|\[Request interrupted|Another Claude session sent a message|Caveat: The messages below)/i;

function blockHerkunft(art) {
  if (art === "bash-input") return { herkunft: "du", werkzeug: null };
  if (art === "bash-stdout" || art === "bash-stderr") return { herkunft: "tool", werkzeug: "Bash" };
  return { herkunft: "ki", werkzeug: null };
}

// Text → Stücke. Verschachtelte Blöcke gleicher Art zählen mit (der Rest eines äußeren Blocks darf nicht als
// Nutzertext herausfallen); ein nie geschlossener Block gilt bis zum Textende als Kontext (ki).
// `tagRe` (global; Gruppe 1 = „/“ bei Schließ-Etiketten, Gruppe 2 = Art), `rest(text)` und `block(art, inhalt)` liefern
// je ein Stück { herkunft, werkzeug, text }.
function zerlegeBloecke(text, tagRe, rest, block) {
  const out = [];
  const dazu = (s) => { if (s.trim()) out.push(rest(s)); };
  let pos = 0;
  while (pos < text.length) {
    tagRe.lastIndex = pos;
    let auf;
    while ((auf = tagRe.exec(text)) && auf[1]) { /* schließende Etiketten ohne Beginn: Text */ }
    if (!auf) { dazu(text.slice(pos)); break; }
    dazu(text.slice(pos, auf.index));
    const art = auf[2], innenStart = auf.index + auf[0].length;
    let tiefe = 1, ende = -1, nach = -1, m;
    tagRe.lastIndex = innenStart;
    while ((m = tagRe.exec(text))) {
      if (m[2] !== art) continue;
      tiefe += m[1] ? -1 : 1;
      if (tiefe === 0) { ende = m.index; nach = m.index + m[0].length; break; }
    }
    if (ende < 0) { // nie geschlossen
      out.push({ herkunft: "ki", werkzeug: null, text: text.slice(auf.index) });
      break;
    }
    const inhalt = text.slice(innenStart, ende);
    if (inhalt.trim()) out.push(block(art, inhalt));
    pos = nach;
  }
  return out;
}

// Nutzer-Text: Kontext-Blöcke → ki bzw. Bash-Blöcke, der Rest → du (außer Fremdtext von Claude Code).
const zerlegeNutzerText = (text) => zerlegeBloecke(text, BLOCK_TAG,
  (s) => ({ herkunft: FREMDTEXT.test(s) ? "ki" : "du", werkzeug: null, text: s }),
  (art, inhalt) => ({ ...blockHerkunft(art), text: inhalt }));

// Werkzeug-Ergebnis: Claude Code hängt <system-reminder> an (z. B. bei Read) — der Block ist ki, der Rest behält die Herkunft.
const REMINDER_TAG = /<(\/?)(system-reminder)>/g;
const zerlegeErgebnis = (text, herkunft, werkzeug) => zerlegeBloecke(text, REMINDER_TAG,
  (s) => ({ herkunft, werkzeug, text: s }),
  (art, inhalt) => ({ ...blockHerkunft(art), text: inhalt }));

// Alle Strings eines beliebigen Werts (für Zeilen und Blöcke, deren Aufbau wir nicht kennen → ki).
const KOPF_SCHLUESSEL = new Set(["uuid", "parentUuid", "leafUuid", "sessionId", "session_id", "timestamp", "cwd",
  "version", "gitBranch", "entrypoint", "userType", "type"]);
function blaetter(wert, out = [], tiefe = 0) {
  if (typeof wert === "string") out.push(wert);
  else if (tiefe < 24 && wert && typeof wert === "object") {
    for (const v of Array.isArray(wert) ? wert : Object.values(wert)) blaetter(v, out, tiefe + 1);
  }
  return out;
}
const textVon = (wert) => blaetter(wert).join("\n");

function ergebnisText(inhalt) {
  if (typeof inhalt === "string") return inhalt;
  if (!Array.isArray(inhalt)) return "";
  return inhalt.map((x) => (typeof x === "string" ? x : x?.type === "text" && typeof x.text === "string" ? x.text : ""))
    .filter(Boolean).join("\n");
}

// Das Transkript Zeile für Zeile in Textstücke mit Herkunft. Reihenfolge = Reihenfolge im Verlauf; die Werkzeugnamen
// der tool_use-Blöcke stehen immer in früheren assistant-Zeilen.
// `assistent` (nur intern): das Stück steht in einer Assistenten-Zeile (Text, Denken, tool_use-Eingabe) — Claudes eigener Text.
function* stuecke(zeilen, { mcpVertraut: vertraut = [] } = {}) {
  if (!Array.isArray(zeilen)) return;
  const werkzeuge = new Map(); // tool_use_id → { name, input }
  for (const z of zeilen) {
    if (!z || typeof z !== "object" || Array.isArray(z)) continue;
    const uuid = typeof z.uuid === "string" ? z.uuid : null;
    const zeit = typeof z.timestamp === "string" ? z.timestamp : null;
    const stueck = (herkunft, text, werkzeug = null, assistent = false) => (text && text.trim() ? { herkunft, uuid, zeit, werkzeug, text, assistent } : null);
    const inhalt = z.message?.content;

    if (z.type === "assistant") {
      if (typeof inhalt === "string") { const s = stueck("ki", inhalt, null, true); if (s) yield s; continue; }
      for (const b of Array.isArray(inhalt) ? inhalt : []) {
        let text;
        if (b?.type === "text") text = typeof b.text === "string" ? b.text : "";
        else if (b?.type === "thinking") text = typeof b.thinking === "string" ? b.thinking : "";
        else {
          if (b?.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string") werkzeuge.set(b.id, { name: b.name, input: b.input });
          text = textVon(b?.type === "tool_use" ? b.input : b);
        }
        const s = stueck("ki", text, null, true); if (s) yield s;
      }
      continue;
    }

    if (z.type === "user") {
      // Eingespielter oder von Claude Code erzeugter Text (Meta, Zusammenfassung, Hintergrundmeldung, Plugin) ist nie
      // eine Aussage des Nutzers. Zeilen im Nebenzweig schreibt der Assistent (Auftrag an den Subagenten).
      const o = z.origin;
      const fremdeOrigin = o != null && !(typeof o === "object" && o.kind === "human");
      const fremdeRunde = z.turnOrigin != null && z.turnOrigin !== "human";
      const kontext = z.isMeta === true || z.isCompactSummary === true || fremdeOrigin || fremdeRunde;
      const nurKi = kontext || z.isSidechain === true;
      const nutzerText = function* (text) {
        if (nurKi) { const s = stueck("ki", text); if (s) yield s; return; }
        for (const p of zerlegeNutzerText(text)) { const s = stueck(p.herkunft, p.text, p.werkzeug); if (s) yield s; }
      };
      if (typeof inhalt === "string") { yield* nutzerText(inhalt); continue; }
      for (const b of Array.isArray(inhalt) ? inhalt : []) {
        if (b?.type === "text") { if (typeof b.text === "string") yield* nutzerText(b.text); }
        else if (b?.type === "tool_result") {
          const { name = null, input } = werkzeuge.get(b.tool_use_id) ?? {};
          const herkunft = kontext ? "ki" : herkunftVonWerkzeug(name, input, vertraut);
          let text = ergebnisText(b.content);
          if (herkunft === "tool" && MIT_ZEILENNUMMERN.has(name)) text = text.replace(ZEILENNUMMER, "");
          // <system-reminder> im Ergebnis ist eingespielter Kontext (ki); der Rest behält die Herkunft des Werkzeugs.
          const teile = herkunft === "ki" ? [{ herkunft, werkzeug: name, text }] : zerlegeErgebnis(text, herkunft, name);
          for (const p of teile) { const s = stueck(p.herkunft, p.text, p.werkzeug ?? name); if (s) yield s; }
        } else if (b?.type !== "image") { const s = stueck("ki", textVon(b)); if (s) yield s; }
      }
      continue;
    }

    // Alles andere (attachment, system, summary, queue-operation, Hook-Ausgaben, API-Mitschnitte …) → ki
    const rest = {};
    for (const [k, v] of Object.entries(z)) if (!KOPF_SCHLUESSEL.has(k)) rest[k] = v;
    const s = stueck("ki", textVon(rest));
    if (s) yield s;
  }
}

// Transkript → Textstücke { herkunft, uuid, zeit, werkzeug, text } in Verlaufsreihenfolge.
// `mcpVertraut`: Werkzeugnamen (oder Präfixe mit „*“), deren MCP-Ergebnisse als tool statt web zählen.
export function fundstellen(zeilen, opt = {}) {
  return Array.from(stuecke(zeilen, opt), ({ assistent, ...rest }) => rest);
}

// Steht `z` in `text` mit Grenzen? Davor und danach kein Buchstabe und keine Ziffer (Unicode): „bei 150“ steht nicht in
// „bei 1500 Euro“, ein mitten im Wort abgeschnittenes Zitat trifft nichts.
const WORT_ENDE = /[\p{L}\p{N}]$/u, WORT_ANFANG = /^[\p{L}\p{N}]/u;
export function enthaeltMitGrenzen(text, z) {
  for (let i = text.indexOf(z); i !== -1; i = text.indexOf(z, i + 1)) {
    const ende = i + z.length;
    if (!WORT_ENDE.test(text.slice(Math.max(0, i - 2), i)) && !WORT_ANFANG.test(text.slice(ende, ende + 2))) return true;
  }
  return false;
}

// Zitat (12–300 Zeichen normalisiert) als Teilstring mit Wortgrenzen in den normalisierten Stücken suchen.
// Mehrere Treffer: höchster Rang, bei Gleichstand der früheste. Kein Treffer oder Zitat unzulässig → null.
// K2: Ein tool/web-Fund, dessen Zitat schon VORHER in einem Assistenten-Segment steht (Text oder Werkzeug-Eingabe), ist ki —
// Claude hat es selbst geschrieben, das Werkzeug gibt es nur zurück.
export function findeZitat(zeilen, zitat, opt = {}) {
  const z = normalisiere(zitat);
  if (z.length < ZITAT_MIN || z.length > ZITAT_MAX) return null;
  let beste = null, vonClaude = false;
  for (const s of stuecke(zeilen, opt)) {
    if (!enthaeltMitGrenzen(normalisiere(s.text), z)) continue;
    let herkunft = s.herkunft;
    if (s.assistent) vonClaude = true;
    else if (vonClaude && (herkunft === "tool" || herkunft === "web")) herkunft = "ki";
    if (!beste || HERKUNFT_RANG[herkunft] > HERKUNFT_RANG[beste.herkunft]) {
      beste = { herkunft, uuid: s.uuid, zeit: s.zeit, werkzeug: s.werkzeug };
      if (HERKUNFT_RANG[herkunft] === RANG_MAX) break; // stärker geht nicht, der erste ist der früheste
    }
  }
  return beste;
}
