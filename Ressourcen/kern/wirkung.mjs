#!/usr/bin/env node
// wirkung.mjs — K15 „Alltags-Wirkung messen" (Spec §12.2, §13.2). Wertet lokal die Claude-Code-Verläufe der
// letzten N Tage aus: Nutzer-Nachrichten gegen feste Musterlisten, Rückbezüge, Kompaktierungen, Brain-Hinweise mit
// späterer Korrektur und den Anteil großer Werkzeug-Ausgaben (> 5 KB) am Verlaufstext. 0 Tokens.
// Gespeichert werden NUR Zahlen (.logs/wirkung.jsonl), nie Text. Musterlisten = 1:1 die Auswertung vom 16.10.2026
// (an.py/an2.py), Version MUSTER_VERSION. Ändert sich eine Liste, steigt die Version — Messungen verschiedener
// Versionen werden nie verglichen. Achtung: \b ist in JavaScript nur ASCII — die Node-Zahlen sind deshalb nur mit
// Node-Messungen vergleichbar (Messprotokoll docs/messungen/2026-10-16-m2a-wirkung-ausgang.md im App-Repo).
// CLI: node wirkung.mjs <vault> [--tage=30] [--bis=JJJJ-MM-TT] [--wurzel=<ordner>]… [--zeitlimit=<s>] [--json] [--speichern]
import { readdirSync, statSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  jeEintrag, nutzerNachricht, assistentText, werkzeugAufrufe, werkzeugErgebnisse, kompaktierung, hookAusgabe,
} from "./verlauf.mjs";
import { haengeAn, zeitstempel } from "./logs.mjs";
import { vaultPfadOderEnde, kernVersion } from "./pfade.mjs";

export const MUSTER_VERSION = "v1";
export const GRUPPEN = {
  kontext: { name: "Kontext/Gedächtnis", re: /wie gestern|wo waren wir|wei(ß|ss)t du noch|hab ich (doch )?(schon )?(gesagt|erwähnt)|schon mal gesagt|vergessen|erinner|letzte[nr]? (session|sitzung)|wie besprochen|merk dir/iu },
  falsch: { name: "falsch/stimmt nicht", re: /\bfalsch\b|stimmt (so )?nicht|\bnein\b|nicht richtig|das ist (so )?nicht|quatsch|unsinn/iu },
  wiederholt: { name: "Wiederholung/nochmal", re: /schon wieder|nochmal|noch mal|immer wieder/iu },
  regelbruch: { name: "Regelbruch", re: /warum hast du|wieso hast du|hab ich (dir )?doch|nicht so\b|das sollst du nicht|sollte(st)? du nicht|ich hatte (doch )?gesagt|regel/iu },
  ungeprueft: { name: "ungeprüft/kaputt", re: /nicht (geprüft|getestet|fertig)|funktioniert nicht|geht nicht|klappt nicht|fehler|kaputt|prüf(e)? (das )?(nochmal|erst)|belege|beweis/iu },
  stil: { name: "Rückfragen/Stil", re: /frag nicht|nicht (so )?viel(e)? fragen|zu lang|kürzer|zu viel|nerv|einfach machen|mach einfach|hör auf/iu },
  werkzeug: { name: "Werkzeug/Modell/Tokens", re: /subagent|agent|modell|opus|sonnet|haiku|token|zu teuer|kosten/iu },
  freigabe: { name: "Freigabe/Sicherheit", re: /freigabe|ohne (frage|rückfrage)|nicht ohne|ohne mich|erlaubnis|prod\b|produktion|secret|passwort|api.?key/iu },
};
export const RUECKBEZUG = /wie besprochen|weiter mit|letzte[nr]? (session|sitzung)|handoff|session_|weitermachen|wo waren wir|stand der|zuletzt|vorhin|gestern/iu;
export const HINWEIS_KORREKTUR = /stimmt (so )?nicht|\bfalsch\b|brain-feedback|das war falsch/iu;
export const GROSS_BYTES = 5 * 1024;
export const MAX_ZEICHEN_MUSTER = 600;   // wie an.py: nur Nachrichten < 600 Zeichen gegen die Gruppen prüfen
export const RAUSCHBAND = Object.freeze({ absolutJe100: 1.0, relativ: 0.25, minNachrichten: 500 });
export const ANTEIL_HOCH = 0.3;
const TAG_MS = 86400000, MONAT_MS = 30 * TAG_MS;
export const WIRKUNG_LOG = (vault) => join(vault, ".logs", "wirkung.jsonl");
const LAUF_MARKE = (vault) => join(vault, ".logs", "wirkung.laeuft");
const runde = (x, stellen = 1) => { const f = 10 ** stellen; return Math.round(x * f) / f; };
const zahl = (x) => String(x).replace(".", ",");

// Alle <home>/.claude*/projects (z. B. ~/.claude und ein zweites Konto wie ~/.claude-zwei), jede echte Wurzel nur einmal.
export function transkriptWurzeln({ home = homedir() } = {}) {
  const out = [], gesehen = new Set();
  let namen = [];
  try { namen = readdirSync(home).filter((n) => n.startsWith(".claude")).sort(); } catch { return out; }
  for (const n of namen) {
    const p = join(home, n, "projects");
    try {
      if (!statSync(p).isDirectory()) continue;
      const echt = realpathSync(p);
      if (gesehen.has(echt)) continue;
      gesehen.add(echt);
      out.push(p);
    } catch {}
  }
  return out;
}

// <wurzel>/<projekt>/*.jsonl mit mtime im Fenster (Subagenten liegen tiefer und zählen nicht — wie ex.py).
export function transkripte(wurzeln, { tage = 30, bisMs = Date.now() } = {}) {
  const vonMs = bisMs - tage * TAG_MS, out = [];
  for (const w of wurzeln) {
    let projekte = [];
    try { projekte = readdirSync(w, { withFileTypes: true }).filter((e) => e.isDirectory()); } catch { continue; }
    for (const p of projekte) {
      let dateien = [];
      try { dateien = readdirSync(join(w, p.name)).filter((n) => n.endsWith(".jsonl")); } catch { continue; }
      for (const d of dateien) {
        const f = join(w, p.name, d);
        // +5000: mtime hat Bruchteile von ms, Date.now() nicht — frisch geschriebene Dateien fielen sonst zufällig heraus.
        try { const m = statSync(f).mtimeMs; if (m >= vonMs && m <= bisMs + 5000) out.push(f); } catch {}
      }
    }
  }
  return out.sort();
}

export function leerZaehler() {
  return {
    dateien: 0, sitzungen: 0, nachrichten: 0, befehle: 0,
    gruppen: Object.fromEntries(Object.keys(GRUPPEN).map((k) => [k, { n: 0, s: 0 }])),
    rueckbezug: { n: 0, s: 0, start: 0 },
    kompakt: { auto: 0, manuell: 0 },
    hinweise: { n: 0, s: 0, korrektur: 0 },
    ausgaben: { gross: 0, zeichenGross: 0, zeichenAlle: 0, anteil: 0, jeWerkzeug: { bash: 0, read: 0, mcp: 0, andere: 0 } },
    unvollstaendig: false,
  };
}
const gruppeVon = (name) => (name === "Bash" ? "bash" : name === "Read" ? "read" : /^mcp__/.test(name) ? "mcp" : "andere");

// Zählt EINEN Verlauf in z hinein. Sitzungs-Zahlen (s) zählen je Verlauf höchstens einmal.
// „Hinweis mit späterer Korrektur" je Sitzung wie an2.py: ein Brain-Hinweis und danach eine Korrektur-Nachricht.
export async function zaehleTranskript(pfad, z = leerZaehler(), { fristMs = Infinity } = {}) {
  const namen = new Map();
  const s = { nachrichten: 0, gruppen: new Set(), rueck: false, hinweis: false, korrektur: false };
  const r = await jeEintrag(pfad, (o) => {
    const k = kompaktierung(o);
    if (k) { z.kompakt[k]++; return; }
    const h = hookAusgabe(o);
    if (h) {
      if (h.ereignis === "UserPromptSubmit" && h.text.startsWith("Brain-Treffer")) { z.hinweise.n++; s.hinweis = true; }
      return;
    }
    if (o.type === "assistant") {
      z.ausgaben.zeichenAlle += assistentText(o).length;
      for (const a of werkzeugAufrufe(o)) { namen.set(a.id, a.name); z.ausgaben.zeichenAlle += JSON.stringify(a.input).length; }
      return;
    }
    for (const e of werkzeugErgebnisse(o)) {
      z.ausgaben.zeichenAlle += e.text.length;
      if (Buffer.byteLength(e.text, "utf8") > GROSS_BYTES) {
        z.ausgaben.gross++;
        z.ausgaben.zeichenGross += e.text.length;
        z.ausgaben.jeWerkzeug[gruppeVon(namen.get(e.id) || "")] += e.text.length;
      }
    }
    const m = nutzerNachricht(o);
    if (!m) return;
    if (m.befehl) { z.befehle++; return; }
    const erste = s.nachrichten === 0;
    s.nachrichten++;
    z.nachrichten++;
    z.ausgaben.zeichenAlle += m.text.length;
    if (m.text.length < MAX_ZEICHEN_MUSTER) {
      for (const [id, g] of Object.entries(GRUPPEN)) if (g.re.test(m.text)) { z.gruppen[id].n++; s.gruppen.add(id); }
    }
    if (RUECKBEZUG.test(m.text)) { z.rueckbezug.n++; s.rueck = true; if (erste) z.rueckbezug.start++; }
    if (s.hinweis && HINWEIS_KORREKTUR.test(m.text)) s.korrektur = true;
  }, { fristMs });
  if (!r.vollstaendig) z.unvollstaendig = true;
  if (s.nachrichten) z.sitzungen++;
  for (const id of s.gruppen) z.gruppen[id].s++;
  if (s.rueck) z.rueckbezug.s++;
  if (s.hinweis) z.hinweise.s++;
  if (s.korrektur) z.hinweise.korrektur++;
  return z;
}

export async function messeWirkung({ wurzeln = transkriptWurzeln(), tage = 30, bisMs = Date.now(), zeitlimitMs = 120000, kitVersion = "?" } = {}) {
  const t0 = Date.now(), z = leerZaehler();
  for (const f of transkripte(wurzeln, { tage, bisMs })) {
    const rest = zeitlimitMs - (Date.now() - t0);
    if (rest <= 0) { z.unvollstaendig = true; break; }
    z.dateien++;
    await zaehleTranskript(f, z, { fristMs: rest });
  }
  z.ausgaben.anteil = z.ausgaben.zeichenAlle ? runde(z.ausgaben.zeichenGross / z.ausgaben.zeichenAlle, 3) : 0;
  const tag = (ms) => new Date(ms).toISOString().slice(0, 10);
  return {
    zeit: zeitstempel(), muster: MUSTER_VERSION, kit: String(kitVersion), tage,
    von: tag(bisMs - tage * TAG_MS), bis: tag(bisMs), wurzeln: wurzeln.length, ...z,
  };
}

export function je100(m, id) {
  return m?.nachrichten ? runde((100 * (m.gruppen?.[id]?.n || 0)) / m.nachrichten, 1) : 0;
}

// Rauschband (vorab festgelegt, Messprotokoll): echt erst ab ≥ 1,0 je 100 Nachrichten UND ≥ 25 % des Vorwerts,
// beide Zeiträume ≥ 500 Nachrichten, gleiche Musterliste. Sonst „rauschen" bzw. „nichtVergleichbar".
export function vergleiche(vorher, jetzt) {
  const out = {};
  const vergleichbar = !!vorher && !!jetzt && vorher.muster === jetzt.muster
    && vorher.nachrichten >= RAUSCHBAND.minNachrichten && jetzt.nachrichten >= RAUSCHBAND.minNachrichten;
  for (const id of Object.keys(GRUPPEN)) {
    if (!vergleichbar) { out[id] = "nichtVergleichbar"; continue; }
    const a = je100(vorher, id), d = je100(jetzt, id) - a;
    const echt = Math.abs(d) >= RAUSCHBAND.absolutJe100 && Math.abs(d) >= RAUSCHBAND.relativ * a;
    out[id] = !echt ? "rauschen" : d < 0 ? "gesunken" : "gestiegen";
  }
  return out;
}

const TREND = { gesunken: "gesunken", gestiegen: "gestiegen", rauschen: "im Rauschen", nichtVergleichbar: "" };
export function textWirkung(m, vorher = null) {
  const v = vergleiche(vorher, m);
  const z = [];
  z.push(`Alltags-Wirkung (${m.von} bis ${m.bis}, ${m.tage} Tage, Musterliste ${m.muster}): ${m.sitzungen} Sitzungen, `
    + `${m.nachrichten} Nutzer-Nachrichten, ${m.befehle} Befehle${m.unvollstaendig ? " — UNVOLLSTÄNDIG (Zeitlimit)" : ""}`);
  z.push("Nachrichten je Gruppe (je 100 Nachrichten · Anzahl · Sitzungen):");
  for (const [id, g] of Object.entries(GRUPPEN)) {
    const t = TREND[v[id]];
    z.push(`- ${g.name}: ${zahl(je100(m, id))} · ${m.gruppen[id].n} · ${m.gruppen[id].s}${t ? ` — ${t} gegenüber ${vorher.bis}` : ""}`);
  }
  z.push(`Rückbezüge („wo waren wir", „gestern" …): ${m.rueckbezug.n} in ${m.rueckbezug.s} Sitzungen, davon ${m.rueckbezug.start} als erste Nachricht`);
  z.push(`Kompaktierungen: ${m.kompakt.auto + m.kompakt.manuell} (${m.kompakt.auto} automatisch, ${m.kompakt.manuell} manuell)`);
  z.push(`Brain-Hinweise: ${m.hinweise.n} in ${m.hinweise.s} Sitzungen; Sitzungen mit Hinweis und späterer Korrektur: ${m.hinweise.korrektur}`);
  const a = m.ausgaben, pct = (x) => (a.zeichenGross ? Math.round((100 * x) / a.zeichenGross) : 0);
  z.push(`Große Werkzeug-Ausgaben (> 5 KB): ${a.gross}, ${zahl(runde(100 * a.anteil, 1))} % des Verlaufstexts `
    + `(Bash ${pct(a.jeWerkzeug.bash)} %, Read ${pct(a.jeWerkzeug.read)} %, MCP ${pct(a.jeWerkzeug.mcp)} %, andere ${pct(a.jeWerkzeug.andere)} %)`
    + `${a.anteil >= ANTEIL_HOCH ? " — HOCH: Auslagern großer Ausgaben als eigenen Baustein vorschlagen" : ""}`);
  z.push(`Rauschband: eine Änderung gilt erst ab ±${zahl(RAUSCHBAND.absolutJe100)} je 100 Nachrichten und ±${RAUSCHBAND.relativ * 100} %, `
    + `bei ≥ ${RAUSCHBAND.minNachrichten} Nachrichten je Zeitraum. Grobe Musterzählung — nur mit sich selbst vergleichen.`);
  return z.join("\n");
}

// Eine Zeile für den Pflegebericht: die Gruppen, bei denen K2/K11/K12 wirken sollen (Spec §13.2), Pfeil nur
// außerhalb des Rauschbands.
export function kurzWirkung(m, vorher = null) {
  const v = vergleiche(vorher, m);
  const pfeil = (id) => (v[id] === "gesunken" ? " ↓" : v[id] === "gestiegen" ? " ↑" : "");
  const teil = (id, name) => `${name} ${zahl(je100(m, id))}${pfeil(id)}`;
  return `Alltags-Wirkung (${m.von} bis ${m.bis}, ${m.sitzungen} Sitzungen, Musterliste ${m.muster}): je 100 Nachrichten `
    + `${teil("kontext", "Gedächtnis")} · ${teil("regelbruch", "Regelbruch")} · ${teil("wiederholt", "Wiederholungen")} · ${teil("falsch", "„falsch“")}; `
    + `Kompaktierungen ${m.kompakt.auto + m.kompakt.manuell}; große Werkzeug-Ausgaben ${zahl(runde(100 * m.ausgaben.anteil, 0))} % — Details: brain wirkung`;
}

// Nur diese Schlüssel werden gespeichert — alles Zahlen bzw. feste Kennungen (zeit, muster, kit, von, bis).
const SCHLUESSEL = ["zeit", "muster", "kit", "tage", "von", "bis", "wurzeln", "dateien", "sitzungen", "nachrichten", "befehle",
  "gruppen", "rueckbezug", "kompakt", "hinweise", "ausgaben", "unvollstaendig"];
export function nurZahlen(m) { return Object.fromEntries(SCHLUESSEL.map((k) => [k, m[k]])); }
export function speichereMessung(vault, m) {
  haengeAn(WIRKUNG_LOG(vault), JSON.stringify(nurZahlen(m)), { max: 500, behalte: 250 });
}
export function leseMessungen(vault) {
  let t = "";
  try { t = readFileSync(WIRKUNG_LOG(vault), "utf8"); } catch { return []; }
  return t.split("\n").map((z) => {
    try { const o = JSON.parse(z); return o && typeof o === "object" && o.muster ? o : null; } catch { return null; }
  }).filter(Boolean);
}
export function wirkungFuerBericht(vault) {
  const l = leseMessungen(vault);
  return l.length ? { jetzt: l.at(-1), vorher: l.length > 1 ? l.at(-2) : null } : null;
}
// Monatlich: keine Messung oder die letzte ≥ 30 Tage alt; nie, solange ein Lauf läuft (Marke < 1 h).
export function wirkungFaellig(vault, jetzt = Date.now()) {
  try { if (jetzt - statSync(LAUF_MARKE(vault)).mtimeMs < 3600000) return false; } catch {}
  const letzte = leseMessungen(vault).at(-1);
  if (!letzte) return true;
  const ms = Date.parse(`${letzte.zeit}Z`);
  return !Number.isFinite(ms) || jetzt - ms >= MONAT_MS;
}

// ---------- CLI ----------
const HIER = dirname(fileURLToPath(import.meta.url));
const selbst = fileURLToPath(import.meta.url);
let aufruf = "";
try { aufruf = realpathSync(process.argv[1] || ""); } catch {}
if (aufruf && aufruf === realpathSync(selbst)) {
  const args = process.argv.slice(2);
  const werte = (k) => args.filter((a) => a.startsWith(`--${k}=`)).map((a) => a.slice(k.length + 3));
  const vault = args.find((a) => !a.startsWith("--")) || vaultPfadOderEnde([]);
  const tage = Number(werte("tage")[0] || 30);
  const bis = werte("bis")[0];
  const bisMs = bis ? Date.parse(`${bis}T23:59:59`) : Date.now();
  const zeitlimitMs = Number(werte("zeitlimit")[0] || 120) * 1000;
  if (!(tage > 0) || !Number.isFinite(bisMs) || !(zeitlimitMs > 0)) {
    console.error("Nutzung: brain wirkung [--tage=30] [--bis=JJJJ-MM-TT] [--wurzel=<ordner>] [--zeitlimit=<sekunden>] [--json] [--speichern]");
    process.exit(64);
  }
  const speichern = args.includes("--speichern");
  const extra = werte("wurzel");
  const kitVersion = kernVersion();
  try {
    if (speichern) { mkdirSync(join(vault, ".logs"), { recursive: true }); writeFileSync(LAUF_MARKE(vault), ""); }
    const vorher = leseMessungen(vault).at(-1) || null;
    const m = await messeWirkung({ wurzeln: extra.length ? extra : transkriptWurzeln(), tage, bisMs, zeitlimitMs, kitVersion });
    if (speichern) speichereMessung(vault, m);
    console.log(args.includes("--json") ? JSON.stringify(nurZahlen(m)) : textWirkung(m, vorher));
  } catch {
    console.error(`Wirkungs-Messung nicht möglich — ist ${vault} wirklich ein Brain?`);
    process.exitCode = 1;
  } finally {
    if (speichern) try { unlinkSync(LAUF_MARKE(vault)); } catch {}
  }
}
