// Reine Entscheidungslogik des Brain-Hinweises — kein LLM (Spec §3.2); IO nur existsSync für die Überblick-Zeile und
// der Kopf (≤ 4 KB) getroffener Seiten für Gültigkeit und W6 (ersetzt_durch, zweifel — seitenfelder.mjs). Testbar.
import { existsSync, openSync, readSync, closeSync } from "node:fs";
import { gueltigkeit } from "./gueltigkeit.mjs";
import { leseSeitenFelder } from "./seitenfelder.mjs";
import { join, dirname, basename } from "node:path";
import { homedir } from "node:os";
export function qmdToRel(file, map) {
  if (typeof file !== "string") return null;
  return map.paths[file.replace(/^qmd:\/\/[^/]+\//, "")] || null;
}

// Nur echte Fragen/Aufträge abfragen: keine Slash-Commands, keine Kurzantworten.
// Vom Werkzeug erzeugte Nachrichten (Agenten-Berichte, Aufgaben-Meldungen, System-Hinweise) sind keine Fragen der Person:
// nie durchsuchen, nie als Lücke merken.
export function istSystemNachricht(prompt) {
  const p = String(prompt || "").trimStart();
  return /^(<task-notification|<agent-message|<system-reminder|<bash-(input|stdout|stderr)|<local-command|<command-(name|message)|\[SYSTEM NOTIFICATION|\[Request interrupted|Another Claude session sent a message|Caveat: The messages below)/i.test(p);
}
export function shouldQuery(prompt) {
  const p = String(prompt || "").trim();
  if (!p || p.startsWith("/") || p.length < 15 || istSystemNachricht(p)) return false;
  return p.split(/\s+/).filter(w => /\p{L}{3,}/u.test(w)).length >= 3;
}
// Für die Lücken-Liste strenger als shouldQuery: nur echte Wissensfragen (Fragezeichen oder Fragewort am Anfang),
// keine Anweisungen wie „mach …“ oder Plaudersätze — sonst füllt sich die Liste mit Rauschen.
export function istWissensfrage(prompt) {
  const p = String(prompt || "").trim();
  if (!shouldQuery(p)) return false;
  if (/\?\s*$/.test(p) || /\?\s/.test(p)) return true;
  return /^(was|wie|wer|wo|wann|warum|wieso|weshalb|welche[rsmn]?|gibt es|kennst du|weißt du|what|how|who|where|when|why|which|is there|do you know)\b/i.test(p);
}

// Treffer über Schwelle → Wiki-Seiten (Rohquelle → zitierende Seite), dedupliziert, begrenzt.
export function decide(results, map, seen, { schwelle = 0.45, max = 2 } = {}) {
  const out = [];
  for (const r of Array.isArray(results) ? results : []) {
    if (!r || typeof r.score !== "number" || r.score < schwelle) continue;
    const rel = qmdToRel(r.file, map);
    if (!rel) continue;
    const pages = map.pages[rel] ? [rel] : (map.bySource[rel] || []);
    for (const page of pages) {
      if (seen.has(page) || out.some(o => o.page === page)) continue;
      out.push({ page, score: r.score, description: map.pages[page]?.description || "" });
      if (out.length >= max) return out;
    }
  }
  return out;
}

// Anzeigepfad: echter Vault (Home als ~ abgekürzt); ohne Vault nur der vault-relative Pfad.
export function anzeigePfad(vault, rel) {
  if (!vault) return rel;
  const v = String(vault).split("\\").join("/").replace(/\/+$/, ""), h = homedir().split("\\").join("/");
  return `${v === h || v.startsWith(h + "/") ? "~" + v.slice(h.length) : v}/${rel}`;
}
// Kopf einer getroffenen Seite — einmal je Treffer, für Gültigkeit (Spec A) und W6: mindestens 4 KB; beginnt die Seite mit
// Frontmatter, wird bis zum schließenden „---“ weitergelesen (höchstens 64 KB). Schließt es nicht (offen oder länger als
// die Grenze), bekommt der Kopf ein künstliches „---“ — ersetzt_durch/zweifel zählen dann trotzdem (lieber warnen).
const KOPF_MIN = 4096, KOPF_MAX = 64 * 1024;
const FM_ANFANG = /^\uFEFF?---\r?\n/, FM_ENDE = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;   // wie seitenfelder.frontmatterText
function seitenKopf(vault, page) {
  if (!vault || typeof page !== "string" || !page.endsWith(".md")) return "";
  try {
    const fd = openSync(join(vault, ...page.split("/")), "r");
    try {
      const b = Buffer.alloc(KOPF_MAX);
      let n = readSync(fd, b, 0, KOPF_MIN, 0), text = b.subarray(0, n).toString("utf8");
      if (!FM_ANFANG.test(text) || FM_ENDE.test(text)) return text;
      while (n < KOPF_MAX) {   // Frontmatter noch offen: weiterlesen
        const k = readSync(fd, b, n, Math.min(KOPF_MIN, KOPF_MAX - n), n);
        if (k <= 0) break;
        n += k; text = b.subarray(0, n).toString("utf8");
        if (FM_ENDE.test(text)) return text;
      }
      return text + "\n---\n";
    } finally { closeSync(fd); }
  } catch { return ""; }
}
const hatFrontmatter = (kopf) => /^\uFEFF?---\r?\n/.test(kopf);
// Spec A: Treffer auf eine abgelaufene Seite tragen „(abgelaufen seit N Tagen)“ (~5 Tokens). Ausgewertet nur, wenn im
// echten Frontmatter pruefen_bis steht. `verfall` braucht die Commit-Zeit (git) — die fragt der Hinweis-Hook bewusst
// nicht ab (Antwortzeit); solche Seiten bleiben hier ohne Zusatz (Lint/Gehirn zeigen es).
function ablaufAusKopf(kopf, jetzt) {
  if (!hatFrontmatter(kopf) || !/^pruefen_bis:/m.test(kopf)) return "";
  const g = gueltigkeit(kopf, { jetzt });
  if (g.status !== "abgelaufen") return "";
  return ` (abgelaufen seit ${g.tageUeber} ${g.tageUeber === 1 ? "Tag" : "Tagen"})`;
}
export function ablaufZusatz(vault, page, { jetzt = Date.now() } = {}) {
  return ablaufAusKopf(seitenKopf(vault, page), jetzt);
}
const WEB_HERKUNFT = /^herkunft_web:[ \t]*\[[ \t]*"/m;   // B3: Abschnitte aus Web-/KI-Recherche
// W6 (B1): Seiten mit ersetzt_durch nie als aktuell zeigen; zweifel (W7) als PRÜFBEDÜRFTIG. Nur echtes Frontmatter.
export function seitenStatus(vault, page, { jetzt = Date.now() } = {}) {
  const kopf = seitenKopf(vault, page);
  if (!hatFrontmatter(kopf)) return { ersetzt: false, ersetztDurch: null, zusatz: "" };
  const f = leseSeitenFelder(kopf);
  if (f.ersetztDurch !== null) return { ersetzt: true, ersetztDurch: f.ersetztDurch, zusatz: "" };
  return { ersetzt: false, ersetztDurch: null, zusatz: (f.zweifel ? " (PRÜFBEDÜRFTIG: Zweifel)" : "") + ablaufAusKopf(kopf, jetzt) + (WEB_HERKUNFT.test(kopf) ? " (teils laut Web-Recherche)" : "") };
}

function trefferZeile(h, vault, jetzt) {
  const pfad = anzeigePfad(vault, h.page);
  if (h.import) return `- ${pfad} — ${h.description.slice(0, 90)}`;
  const s = seitenStatus(vault, h.page, { jetzt });
  if (s.ersetzt) return `- ${pfad} — ersetzt → ${s.ersetztDurch ? `[[${s.ersetztDurch}]]` : "(Nachfolger fehlt)"}, nicht mehr aktuell`;
  return `- ${pfad}${s.zusatz} — ${h.description.slice(0, 90)}`;
}

export function format(hits, { vault, jetzt = Date.now() } = {}) {
  if (!hits.length) return "";
  let out = "Kortex-Treffer (lokal, ungelesen — nur öffnen, wenn für die Aufgabe relevant):\n" +
    hits.map(h => trefferZeile(h, vault, jetzt)).join("\n");
  // Beide Treffer im selben Themenordner → dessen generierte Übersicht anbieten (nur wenn sie existiert)
  const ordner = [...new Set(hits.map(h => dirname(h.page)))];
  if (vault && hits.length >= 2 && ordner.length === 1 && ordner[0].split("/").length >= 3) {
    const uebersicht = `${ordner[0]}/_${basename(ordner[0])}.md`;
    if (existsSync(join(vault, uebersicht))) out += `\n- Überblick: ${anzeigePfad(vault, uebersicht)}`;
  }
  return out;
}

// Lange Prompts (eingefügte Logs/Texte): Anfang + Ende tragen die Frage, die Mitte meist nicht
export function suchtext(prompt, max = 500) {
  const p = String(prompt || "");
  return p.length <= max ? p : p.slice(0, 300) + " … " + p.slice(-(max - 303));
}

// Für das Log: Wie viele Seiten über Schwelle wurden nur verschwiegen, weil sie in dieser Session schon kamen?
export function countSuppressed(results, map, seen, { schwelle = 0.45 } = {}) {
  const hier = new Set();
  for (const r of Array.isArray(results) ? results : []) {
    if (!r || typeof r.score !== "number" || r.score < schwelle) continue;
    const rel = qmdToRel(r.file, map);
    if (!rel) continue;
    for (const page of map.pages[rel] ? [rel] : (map.bySource[rel] || [])) if (seen.has(page)) hier.add(page);
  }
  return hier.size;
}

// Kurze Anschlussfrage („und beim zweiten?") statt Bestätigung („ja bitte") — nur dann lohnt die vorige Frage als Kontext
const ANSCHLUSS = /^(und|aber|auch|oder|wie|was|welche[rsmn]?|wo|wann|warum|wieso|weshalb|wer|bei|beim|für|mit|ohne|gilt|geht|gibt)\b/i;
export function istFolgefrage(prompt) {
  const p = String(prompt || "").trim();
  if (!p || p.length >= 60 || p.startsWith("/") || p.split(/\s+/).length < 2) return false;
  return p.includes("?") || ANSCHLUSS.test(p);
}

// K3 Intent-Gate (Spec §12.2): Prompts ohne Wissensbedarf — nur Bestätigungs-/Fortsetzungswörter, ≤ 80 Zeichen, ohne
// Fragezeichen („ok“, „ja passt, mach weiter“) — lösen keine Suche und keinen Folgefragen-Rückgriff aus. Unbekannte
// Wörter → false (dann sucht der Hinweis wie bisher; lieber einmal zu viel suchen als Wissen verschweigen).
const OHNE_BEDARF = new Set(("ok okay oki jo ja jap jep jup yes yep nein ne nö no nope danke dank merci thx thanks "
  + "super passt gut prima top perfekt klasse cool schön sauber klar genau stimmt richtig korrekt einverstanden gerne "
  + "bitte weiter weitermachen fortfahren fortsetzen mach machen mache los go continue proceed sure fine done lgtm "
  + "erledigt gemacht freigabe freigegeben alles dann so das es du einfach mal noch auch und sehr jetzt 👍 🙏 ✅")
  .split(/\s+/).filter(Boolean));
export function ohneWissensbedarf(prompt) {
  const p = String(prompt || "").trim();
  if (!p || p.length > 80 || p.includes("?") || p.startsWith("/") || istSystemNachricht(p)) return false;
  const woerter = p.toLowerCase().replace(/[.,!;:…()"'„“”‚‘’»«–—-]+/gu, " ").split(/\s+/).filter(Boolean);
  return woerter.length > 0 && woerter.every((w) => OHNE_BEDARF.has(w));
}

// Brain-Hinweis je Prompt ≤ 600 Zeichen: ganze Treffer in Rangfolge; was nicht passt, fällt weg (nie gekürzt).
export const HINWEIS_MAX = 600;
export function imBudget(hits, formatiere, max = HINWEIS_MAX) {
  const out = [];
  for (const h of hits) if (formatiere([...out, h]).length <= max) out.push(h);
  return out;
}
