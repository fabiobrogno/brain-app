#!/usr/bin/env node
// tageslauf/gesundheit.mjs — Gesundheits-Wächter: das Brain meldet selbst, wenn etwas kaputt ist (0 Tokens, keine KI).
// Hintergrund: Drei Wochen lieferte der Hinweis-Weg „dienst-vektor“ 0 Treffer und die Such-Messlatte fiel durch (ok=0), ohne dass es jemand merkte.
// Fünf schnelle Prüfungen, jede mit eigener Fehlergrenze (wirft eine, steht „Prüfung X lief nicht: …“ als Warnung da, der Rest läuft weiter):
//   1 messlatte   Such-Messlatte im Tageslauf nach Takt (gesundheitMesslatte: taeglich|woechentlich|aus) laufen lassen und bewerten:
//                 rot bei ok=0, gelb bei schlechter als der letzte bestandene Lauf (eval-regel.mjs#positivOk) oder letzter Lauf älter als 7 Tage
//   2 hinweis     .logs/hint.log der letzten 24 h: Anzahl je weg=, Weg mit ≥ 20 Prompts und 0 Treffern (rot), Fehler-/Timeout-Anteil > 10 % (rot),
//                 Doppelaufrufe (gleiche sid+len binnen 3 s, gelb), p95 der ms (nur berichtet) · mindestens zwei Sitzungsstarts in hooks.log (source=startup bzw. ohne Quelle), aber keine Spur des Hinweis-Hooks
//                 (hint.log und intent-gate.log leer) → gelb „Hinweis-Hook läuft nicht (N Sitzungsstarts, 0 Hinweis-Aufrufe)“
//   3 index       qmd-Suchindex rein lesend (SQLite nur lesend geöffnet): Vektoren gegen Dokumente, verwaiste Vektoren > 50 % (gelb), Index älter als
//                 neueste Wiki-Änderung + 24 h (gelb), Index fehlt (rot). Räumt NIE selbst auf — die Warnung nennt den Befehl (qmd cleanup)
//   4 dienst      Suchdienst: antwortet er (dienst-client.mjs)? Endete er zuletzt ohne „ende“-Zeile in hooks.log (abgestürzt/hart beendet)?
//   5 rueckstand  offene Vorschläge, wartende Lektionen, Inbox-Dateien, offene Konflikte gegen Schwellen (gesundheitVorschlaege/-Lektionen/-Inbox/-Konflikte)
// Ampel je Prüfung: gruen · gelb (Auffälligkeit) · rot (liefert nachweislich nichts / Ziel verfehlt). Eine Prüfung kann mehrere Befunde haben;
// „Warnungen“ zählt alle Befunde (gelb + rot).
// Ergebnis: .logs/tageslauf/gesundheit.json (Stand für die Startmeldung) · im Tageslauf-Bericht „### Gesundheit“ (tageslauf.mjs) · Kurzfassung in letzter.json.
// Startmeldung: gesundheitsZeile() — GENAU EINE Zeile, nur bei Warnungen (session-start.mjs); bei grün nichts (Kontext sparen).
// Einstellungen (einstellungen.mjs): gesundheit (an/aus), gesundheitMesslatte, gesundheitVorschlaege/-Lektionen/-Inbox/-Konflikte (0 = nie warnen).
// CLI: node gesundheit.mjs [vault] [--json] [--trocken] [--messlatte]   (brain gesundheit …)
//   --messlatte  die Such-Messlatte jetzt laufen lassen (dauert Minuten; ohne die Angabe wird nur das letzte Ergebnis bewertet)
//   --trocken    Stand nicht speichern (nur anzeigen)         Exit 0 = alles grün, 2 = Warnungen
// Schwere Module (analyse, messlatte, vorschlaege …) werden erst in der jeweiligen Prüfung geladen: die Startmeldung (gesundheitsZeile) bleibt leicht.
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, readdirSync, statSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { vaultPfadOderEnde, ladeConfig, ordner } from "../pfade.mjs";
import { leseAutomatik } from "../einstellungen.mjs";
import { findeSecrets } from "../secrets-muster.mjs";

const STUNDE = 3600e3, TAG = 86400e3;
export const FENSTER_MS = 24 * STUNDE;          // Hinweis-Log: so weit wird zurückgeschaut
export const MIN_PROMPTS_WEG = 20;              // ab so vielen Prompts darf ein Weg nicht bei 0 Treffern stehen
export const MIN_STARTS_OHNE_HINWEIS = 2;       // so viele Sitzungsstarts (hooks.log) ohne jede Hinweis-Spur in 24 h → „Hinweis-Hook läuft nicht“ (EIN Start ohne Prompt ist nur eine frisch geöffnete Sitzung)
export const MIN_ZEILEN_FEHLER = 10;            // Fehleranteil zählt erst ab so vielen Zeilen (sonst warnt 1 von 3)
export const FEHLER_ANTEIL = 0.1;               // Fehler-/Timeout-Anteil über dieser Grenze → Warnung
export const DOPPEL_MS = 3000;                  // gleiche sid+len binnen dieser Zeit = Doppelaufruf
export const VERWAIST_ANTEIL = 0.5;             // mehr verwaiste Vektoren → Warnung
export const INDEX_VERZUG_MS = 24 * STUNDE;     // Index älter als neueste Wiki-Änderung + das → Warnung
export const MESSLATTE_MAX_ALTER_TAGE = 7;      // letzter Messlatte-Lauf älter → Warnung
export const STAND_MAX_ALTER_MS = 3 * TAG;      // Stand der Gesundheit älter (bei laufendem Tageslauf) → die Startzeile sagt es
const SYMBOL = { gruen: "🟢", gelb: "🟡", rot: "🔴" };
const WORT = { gruen: "grün", gelb: "gelb", rot: "rot" };
const RANG = { gruen: 0, gelb: 1, rot: 2 };

const kurz = (s, n = 120) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const p2 = (n) => String(n).padStart(2, "0");
const kurzDatum = (ms) => { const d = new Date(ms); return Number.isNaN(d.getTime()) ? "?" : `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.`; };
const datumIso = (tag) => { const m = String(tag).match(/^\d{4}-(\d{2})-(\d{2})/); return m ? `${m[2]}.${m[1]}.` : String(tag); };
const uhrzeit = (ms) => { const d = new Date(ms); return Number.isNaN(d.getTime()) ? "?" : `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const sek = (ms) => `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
const prozent = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const tageZwischen = (vonTag, bisTag) => Math.round((Date.parse(`${bisTag}T00:00:00Z`) - Date.parse(`${vonTag}T00:00:00Z`)) / TAG);

// Nie Zugangsdaten in den Stand (Fehlertexte aus Dateien/Diensten könnten welche tragen): ein Text mit Treffer wird ersetzt, nicht zeilenweise gekürzt (das JSON bliebe sonst kaputt).
const sauber = (t) => (findeSecrets(t).length ? "(Text mit möglichen Zugangsdaten entfernt)" : t);
const befund = (stufe, text) => ({ stufe, kurz: text });
const schlimmste = (befunde) => befunde.reduce((s, b) => (RANG[b.stufe] > RANG[s] ? b.stufe : s), "gruen");
// Ergebnis einer Prüfung: text = eine Zeile für den Bericht, befunde = die Warnungen (leer = grün), daten = Zahlen zum Weiterverwenden.
const ergebnis = (text, befunde = [], daten = {}) => ({ text: kurz(text, 400), befunde, stufe: schlimmste(befunde), daten });

// ---------- 1 Messlatte ----------
async function pruefeMesslatte(k) {
  const { leseMesslatte } = await import("../analyse.mjs");
  const { positivOk } = await import("../eval-regel.mjs");
  const takt = k.werte.gesundheitMesslatte;
  const heuteTag = new Date(k.jetzt).toISOString().slice(0, 10);
  const befunde = [];
  const daten = { takt, gelaufen: false, dauerMs: null };
  const vorher = leseMesslatte(k.vault).at(-1);
  const faellig = takt === "taeglich" ? !vorher || vorher.datum < heuteTag
    : takt === "woechentlich" ? !vorher || tageZwischen(vorher.datum, heuteTag) >= 7 : false;
  // Unter `node --test` nie die echte Messlatte starten (172 Hook-Prozesse); Tests geben einen Haken mit.
  const darf = k.haken.messlatte || !process.env.NODE_TEST_CONTEXT;
  if (darf && (k.messlatte === "ja" || (k.messlatte === "takt" && faellig))) {
    const messen = k.haken.messlatte || (await import("../messlatte.mjs")).messlatte;
    const t0 = Date.now();
    // macOS: während der Messung nicht einschlafen (sonst Fantasie-Latenzen); -w räumt auf, falls wir vorher sterben
    let wach = null;
    if (process.platform === "darwin" && !k.haken.messlatte) {
      try { wach = spawn("/usr/bin/caffeinate", ["-i", "-s", "-w", String(process.pid)], { stdio: "ignore", detached: true, windowsHide: true }); wach.on("error", () => {}); wach.unref(); } catch {}
    }
    // Nachts ist der Suchdienst meist beendet: erst warm werden lassen, sonst misst die Messlatte den Kaltstart
    if (!k.haken.messlatte && k.cfg?.hinweis?.rerankSchwelle != null) {
      try { await (await import("../dienst-client.mjs")).waermeVor(k.vault); } catch {}
    }
    try { messen(k.vault, { jetzt: new Date(k.jetzt) }); daten.gelaufen = true; }
    catch (e) { befunde.push(befund("gelb", `Messlatte lief nicht (${kurz(e?.message, 60)})`)); }
    finally { try { wach?.kill(); } catch {} }
    daten.dauerMs = Date.now() - t0;
  }
  const verlauf = leseMesslatte(k.vault);
  const l = verlauf.at(-1);
  if (!l) {
    if (takt !== "aus") befunde.push(befund("gelb", "Messlatte noch nie gemessen (brain messlatte)"));
    return ergebnis(takt === "aus" ? "Takt aus, noch keine Messung" : "noch keine Messung vorhanden", befunde, daten);
  }
  daten.letzter = l;
  const alterTage = tageZwischen(l.datum, heuteTag);
  const [pos, n] = l.positiv.split("/").map(Number);
  // Letzter BESTANDENER Lauf vor dem letzten (derselbe Maßstab wie die Hinweis-Abnahme, eval-regel.mjs)
  let logText = "";
  try { logText = readFileSync(join(k.vault, ".logs", "hint-eval.log"), "utf8"); } catch {}
  const evalZeilen = logText.split(/\r?\n/).filter((z) => z.startsWith("hint-eval "));
  const davor = evalZeilen.slice(0, -1).join("\n");
  const bestanden = verlauf.slice(0, -1).filter((v) => v.ok).at(-1);
  let urteil;
  if (!l.ok) { befunde.push(befund("rot", `Messlatte verfehlt (${l.positiv})`)); urteil = "verfehlt (ok=0)"; }
  else if (bestanden && !positivOk({ pos, n, zielPositiv: 0, logText: davor })) {
    befunde.push(befund("gelb", `Messlatte schlechter als zuletzt (${l.positiv} statt ${bestanden.positiv})`)); urteil = `schlechter als der letzte bestandene Lauf (${bestanden.positiv}, ${datumIso(bestanden.datum)})`;
  } else urteil = "im Ziel";
  if (takt !== "aus" && alterTage > MESSLATTE_MAX_ALTER_TAGE) befunde.push(befund("gelb", `Messlatte seit ${alterTage} Tagen nicht gelaufen`));
  const lauf = daten.gelaufen ? `, jetzt gemessen in ${sek(daten.dauerMs)}` : "";
  const vorBest = !l.ok && bestanden ? `; letzter bestandener Lauf ${bestanden.positiv} (${datumIso(bestanden.datum)})` : "";
  return ergebnis(`${datumIso(l.datum)}: Treffer ${l.positiv}, still ${l.still}, Kontrolle ${l.kontrolle}, Holdout ${l.holdout}, p95 ${l.p95ms} ms — ${urteil}${lauf}${vorBest} (Takt ${takt})`, befunde, daten);
}

// ---------- 2 Hinweis-Wege ----------
// Reine Auswertung des Textes von hint.log (testbar). Zeilen: „<ISO ohne Z> sid=<8> len=<n> weg=<w> [dienst=<code>] top= zeichen= hits= unterdrueckt= kalt= refresh= ms=“
// bzw. Fehlerzeilen „<ISO> sid=<8> fehler=<code> kalt= refresh= ms=“ (brain-hint.mjs). Ein Treffer = hits ≠ „-“ oder unterdrückte Treffer (der Weg fand etwas, es kam nur schon).
export function wertHinweisLog(text, { jetzt = Date.now(), fensterMs = FENSTER_MS } = {}) {
  const zeilen = [];
  for (const roh of String(text || "").split(/\r?\n/)) {
    const m = roh.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}) sid=(\S+) (.*)$/);
    if (!m) continue;
    const t = Date.parse(`${m[1]}Z`);
    if (!Number.isFinite(t) || t < jetzt - fensterMs) continue;
    const f = {};
    for (const kv of m[3].split(" ")) { const i = kv.indexOf("="); if (i > 0) f[kv.slice(0, i)] = kv.slice(i + 1); }
    zeilen.push({ t, sid: m[2], f });
  }
  zeilen.sort((a, b) => a.t - b.t);
  const wege = {}, ms = [], zuletzt = new Map();
  let fehler = 0, dienstTimeout = 0, dienstAus = 0, fehlerhaft = 0, doppelt = 0;
  for (const { t, sid, f } of zeilen) {
    let schlecht = false;
    if (f.fehler) { fehler++; schlecht = true; }
    else {
      const w = wege[f.weg || "?"] ||= { prompts: 0, treffer: 0 };
      w.prompts++;
      if ((f.hits && f.hits !== "-") || Number(f.unterdrueckt) > 0) w.treffer++;
      if (f.dienst === "ETIMEDOUT") { dienstTimeout++; schlecht = true; } else if (f.dienst) dienstAus++;
    }
    if (schlecht) fehlerhaft++;
    if (Number.isFinite(Number(f.ms)) && f.ms !== undefined) ms.push(Number(f.ms));
    if (f.len !== undefined) {
      const schluessel = `${sid}|${f.len}`;
      if (zuletzt.has(schluessel) && t - zuletzt.get(schluessel) <= DOPPEL_MS) doppelt++;
      zuletzt.set(schluessel, t);
    }
  }
  ms.sort((a, b) => a - b);
  const p95 = ms.length ? ms[Math.min(ms.length - 1, Math.ceil(0.95 * ms.length) - 1)] : null;
  return { zeilen: zeilen.length, wege, fehler, dienstTimeout, dienstAus, fehlerhaft, doppelt, p95ms: p95 };
}

// Sitzungsstarts der letzten 24 h aus hooks.log: Zeilen „--- <lokale Zeit YYYY-MM-DD HH:MM:SS> session-start“ (session-start.mjs, formatLokal). Reine Auswertung (testbar).
// session-start.mjs schreibt die Quelle mit („session-start source=<startup|resume|clear|compact>“): es zählt nur source=startup — Wiederaufnahme, clear und Kompaktierung sind dieselbe Sitzung.
// Ältere Zeilen ohne Quelle zählen wie bisher als Start (deshalb braucht die Warnung mindestens MIN_STARTS_OHNE_HINWEIS Starts).
export function zaehleSitzungsstarts(text, { jetzt = Date.now(), fensterMs = FENSTER_MS } = {}) {
  let n = 0;
  for (const z of String(text || "").split(/\r?\n/)) {
    const m = z.match(/^--- (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) session-start\b(.*)$/);
    const quelle = m ? /\bsource=(\S+)/.exec(m[3])?.[1] : undefined;
    if (quelle && quelle !== "startup") continue;
    const t = m ? Date.parse(`${m[1]}T${m[2]}`) : NaN;                 // ohne Z = lokale Zeit, wie geschrieben
    if (Number.isFinite(t) && t >= jetzt - fensterMs && t <= jetzt + STUNDE) n++;
  }
  return n;
}
// Zeilen eines Logs (Zeitstempel „<ISO ohne Z, UTC> …“) in den letzten 24 h.
const zeilenImFenster = (text, jetzt) => String(text || "").split(/\r?\n/).filter((z) => { const t = Date.parse(`${z.slice(0, 19)}Z`); return Number.isFinite(t) && t >= jetzt - FENSTER_MS; }).length;
const leseLog = (vault, name) => { try { return readFileSync(join(vault, ".logs", name), "utf8"); } catch { return null; } };

async function pruefeHinweis(k) {
  if (k.werte.hinweise === "aus") return ergebnis("Hinweise sind ausgeschaltet (Einstellung hinweise)");
  const text = leseLog(k.vault, "hint.log");
  const a = text === null ? null : wertHinweisLog(text, { jetzt: k.jetzt });
  if (!a?.zeilen) {
    // Keine Hinweis-Aufrufe in 24 h. Ein ruhiger Tag ist grün — liefen aber Sitzungen (SessionStart-Hook schreibt in hooks.log), ohne dass der UserPromptSubmit-Hook irgendeine
    // Spur hinterlässt (hint.log, Intent-Gate-Log), läuft der Hinweis-Hook nicht (nicht eingetragen, kaputt, falscher Pfad): gelb statt still grün.
    const starts = zaehleSitzungsstarts(leseLog(k.vault, "hooks.log"), { jetzt: k.jetzt });
    const gate = zeilenImFenster(leseLog(k.vault, "intent-gate.log"), k.jetzt);
    if (starts >= MIN_STARTS_OHNE_HINWEIS && !gate) {
      return ergebnis(`${starts} Sitzungsstart${starts === 1 ? "" : "s"} in 24 h, aber keine Hinweis-Aufrufe in hint.log`,
        [befund("gelb", `Hinweis-Hook läuft nicht (${starts} Sitzungsstart${starts === 1 ? "" : "s"}, 0 Hinweis-Aufrufe)`)], { ...(a || {}), zeilen: 0, sitzungsstarts: starts });
    }
    return text === null ? ergebnis("kein hint.log vorhanden (noch kein Prompt)") : ergebnis("keine Prompts in den letzten 24 h", [], a);
  }
  const befunde = [];
  const leer = Object.entries(a.wege).filter(([, w]) => w.prompts >= MIN_PROMPTS_WEG && w.treffer === 0).map(([n]) => n);
  if (leer.length) befunde.push(befund("rot", `${leer.length === 1 ? "Weg" : "Wege"} ${leer.join(", ")} 0 Treffer/24 h`));
  if (a.zeilen >= MIN_ZEILEN_FEHLER && a.fehlerhaft / a.zeilen > FEHLER_ANTEIL) befunde.push(befund("rot", `Hinweis-Fehler/Timeouts ${prozent(a.fehlerhaft, a.zeilen)} % (${a.fehlerhaft}/${a.zeilen})`));
  if (a.doppelt > 0) befunde.push(befund("gelb", `${a.doppelt} Doppelaufruf${a.doppelt === 1 ? "" : "e"}/24 h (Hook doppelt eingetragen?)`));
  const jeWeg = Object.entries(a.wege).sort((x, y) => y[1].prompts - x[1].prompts).map(([n, w]) => `${n} ${w.prompts} (${w.treffer} mit Treffer)`).join(" · ");
  return ergebnis(`24 h, ${a.zeilen} Zeilen: ${jeWeg || "keine"} — Fehler/Timeouts ${a.fehlerhaft} (${prozent(a.fehlerhaft, a.zeilen)} %), Dienst nicht erreichbar ${a.dienstAus}, Doppelaufrufe ${a.doppelt}, p95 ${a.p95ms == null ? "?" : sek(a.p95ms)}`, befunde, a);
}

// ---------- 3 Suchindex ----------
// SQLite NUR LESEND öffnen (nie schreiben, nie qmd-Store/Migration anstoßen): zuerst node:sqlite (Node ≥ 22.5), sonst das better-sqlite3 aus dem
// qmd-Paket (gleicher Node wie qmd selbst). Beide haben prepare().get()/all() → ein kleiner Adapter.
async function oeffneNurLesend(pfad, haken = {}) {
  if (haken.oeffneDb) return haken.oeffneDb(pfad);
  const fehler = [];
  const adapter = (db) => ({ get: (sql) => db.prepare(sql).get(), alle: (sql) => db.prepare(sql).all(), close: () => db.close() });
  try { const { DatabaseSync } = await import("node:sqlite"); return adapter(new DatabaseSync(pfad, { readOnly: true })); }
  catch (e) { fehler.push(`node:sqlite: ${kurz(e?.code || e?.message, 40)}`); }
  try {
    const { createRequire } = await import("node:module");
    const { modulPfad } = await import("../qmd-vector.mjs");
    const Database = createRequire(join(dirname(modulPfad()), "..", "package.json"))("better-sqlite3");
    return adapter(new Database(pfad, { readonly: true, fileMustExist: true }));
  } catch (e) { fehler.push(`better-sqlite3: ${kurz(e?.code || e?.message, 40)}`); }
  throw new Error(`kein lesender SQLite-Zugriff möglich (${fehler.join("; ")})`);
}

// Neueste Änderung einer .md unter dem Wiki (ms) — Maßstab für „der Index müsste das schon kennen“.
function neuesteWikiAenderung(wikiDir) {
  let neu = 0;
  const lauf = (dir) => {
    let eintraege;
    try { eintraege = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of eintraege) {
      if (e.name.startsWith(".")) continue;
      const f = join(dir, e.name);
      if (e.isDirectory()) lauf(f);
      else if (e.name.endsWith(".md")) { try { neu = Math.max(neu, statSync(f).mtimeMs); } catch {} }
    }
  };
  lauf(wikiDir);
  return neu;
}

async function pruefeIndex(k) {
  const profil = k.cfg.suche?.profil || "leicht";
  if (profil === "minimal") return ergebnis("Suchprofil „minimal“ — es gibt keinen Vektorindex");
  const dbPfad = k.haken.dbPfad || process.env.QMD_DB || join(homedir(), ".cache", "qmd", "index.sqlite");
  if (!existsSync(dbPfad)) return ergebnis(`${dbPfad} fehlt — „brain refresh“ baut ihn neu`, [befund("rot", "Suchindex fehlt (brain refresh)")]);
  const db = await oeffneNurLesend(dbPfad, k.haken);
  let docs, vek, verw, dokMax;
  try {
    docs = db.alle("SELECT collection, COUNT(*) AS n FROM documents WHERE active = 1 GROUP BY collection");
    vek = db.get("SELECT COUNT(*) AS n, MAX(embedded_at) AS spaet FROM content_vectors");
    // Wie qmd cleanup zählt: Vektor-Chunks, deren Inhalt kein aktives Dokument mehr trägt
    verw = db.get("SELECT COUNT(*) AS n FROM content_vectors cv WHERE NOT EXISTS (SELECT 1 FROM documents d WHERE d.hash = cv.hash AND d.active = 1)");
    dokMax = db.get("SELECT MAX(modified_at) AS m FROM documents WHERE active = 1");
  } finally { try { db.close(); } catch {} }
  const dokumente = docs.reduce((s, d) => s + Number(d.n), 0);
  const karten = Number(docs.find((d) => d.collection === (k.cfg.hinweis?.collection || "brainkarten"))?.n ?? 0);
  const vektoren = Number(vek.n), verwaist = Number(verw.n);
  const befunde = [];
  if (vektoren > 0 && verwaist / vektoren > VERWAIST_ANTEIL) befunde.push(befund("gelb", `${prozent(verwaist, vektoren)} % der Vektoren verwaist (qmd cleanup)`));
  // Index-Zeit = jüngstes Lebenszeichen: Erfolgsstempel des Refresh, letzte Einbettung, letzte Dokumentänderung im Index
  let stempel = 0; try { stempel = statSync(join(k.vault, ".logs", "search-refreshed")).mtimeMs; } catch {}
  const indexMs = Math.max(stempel, Date.parse(vek.spaet || "") || 0, Date.parse(dokMax.m || "") || 0);
  const wikiMs = neuesteWikiAenderung(join(k.vault, ordner(k.vault, k.cfg).wiki));
  const verzug = wikiMs - indexMs;
  if (wikiMs && verzug > INDEX_VERZUG_MS) befunde.push(befund("gelb", `Suchindex ${Math.floor(verzug / TAG) >= 1 ? `${Math.floor(verzug / TAG)} Tage` : `${Math.floor(verzug / STUNDE)} h`} älter als das Wiki (brain refresh)`));
  const aufraeumen = verwaist > 0 ? ` — Aufräumen täte: qmd cleanup (entfernt ${verwaist} verwaiste Vektoren, nie automatisch)` : "";
  return ergebnis(`${vektoren} Vektoren, davon ${verwaist} verwaist (${prozent(verwaist, vektoren)} %) · ${dokumente} aktive Dokumente (${karten} Karten) · Stand ${indexMs ? `${kurzDatum(indexMs)} ${uhrzeit(indexMs)}` : "unbekannt"}${aufraeumen}`,
    befunde, { vektoren, verwaist, dokumente, karten, indexMs, wikiMs });
}

// ---------- 4 Suchdienst ----------
// Letzte Start-/Ende-Zeile des Dienstes in hooks.log: „<ISO> suchdienst start pid=<n> warm|aufwaermen-fehler=<c>“ / „<ISO> suchdienst ende grund=<g>“.
function dienstLog(vault) {
  let letzte = null;
  try {
    for (const z of readFileSync(join(vault, ".logs", "hooks.log"), "utf8").split(/\r?\n/)) {
      const m = z.match(/^(\S+) suchdienst (start|ende)\b(.*)$/);
      if (!m) continue;
      letzte = { art: m[2], zeit: Date.parse(`${m[1]}Z`), pid: Number(m[3].match(/pid=(\d+)/)?.[1]) || null, grund: m[3].match(/grund=(\S+)/)?.[1] || null };
    }
  } catch {}
  return letzte;
}
const pidLebtStandard = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

async function pruefeDienst(k) {
  if (k.cfg.hinweis?.rerankSchwelle == null) return ergebnis("nicht eingeschaltet (kein rerankSchwelle in der Config) — der Hinweis nutzt nur den Vektor-Weg");
  const { frageDienst, istGesperrt } = await import("../dienst-client.mjs");
  const frage = k.haken.frageDienst || frageDienst;
  const befunde = [];
  let ms = null, code = null;
  const t0 = Date.now();
  // Dieselbe leichte Anfrage wie hint-warm.mjs
  try { await frage(k.vault, { query: "aufwärmen", limit: 1, top: 0 }, { antwortMs: 1500 }); ms = Date.now() - t0; }
  catch (e) { code = e?.code || "EDIENST"; }
  const gesperrt = (k.haken.istGesperrt || istGesperrt)(k.vault);
  if (gesperrt) befunde.push(befund("gelb", "Suchdienst nach Hänger gesperrt (10 min)"));
  const log = dienstLog(k.vault);
  let text;
  if (ms !== null) text = `antwortet (${ms} ms)`;
  else if (code === "EWARM") text = "wärmt noch auf (antwortet gleich)";
  else if (code === "ETIMEDOUT") { text = "nimmt Anfragen an, antwortet aber nicht (Hänger)"; befunde.push(befund("gelb", "Suchdienst antwortet nicht (Hänger)")); }
  else if (code === "ESOCKPFAD") { text = "Socket-Pfad zu lang — der Dienst kann in diesem Vault nicht laufen"; befunde.push(befund("gelb", "Suchdienst: Socket-Pfad zu lang")); }
  else if (code === "EDIENST") {
    if (!log) text = "läuft nicht (noch nie gestartet — er startet beim Bedarf des Hinweises)";
    else if (log.art === "ende") text = `ruht (zuletzt beendet ${kurzDatum(log.zeit)} ${uhrzeit(log.zeit)}, Grund ${log.grund || "?"}) — startet beim nächsten Hinweis neu`;
    else if ((k.haken.pidLebt || pidLebtStandard)(log.pid)) { text = `Prozess ${log.pid} läuft, der Socket antwortet aber nicht`; befunde.push(befund("gelb", "Suchdienst-Prozess läuft, Socket antwortet nicht")); }
    else { text = `endete zuletzt ohne ende-Zeile (Start ${kurzDatum(log.zeit)} ${uhrzeit(log.zeit)}, Prozess ${log.pid} weg) — abgestürzt oder hart beendet`; befunde.push(befund("gelb", "Suchdienst endete ohne ende-Zeile (Absturz?)")); }
  } else { text = `antwortet mit Fehler ${code}`; befunde.push(befund("gelb", `Suchdienst-Fehler ${code}`)); }
  return ergebnis(text + (gesperrt ? " — gesperrt nach Hänger" : ""), befunde, { ms, code, log });
}

// ---------- 5 Rückstand ----------
// Zählweisen wie der Sitzungsstart: Vorschläge = alle ohne Lektionen (listeVorschlaege), Lektionen = art „lektion“, Inbox = zaehleInboxDateien,
// Konflikte = Wiki-Seiten mit offenem, nicht entschiedenem Konflikt-Kasten (offeneKonfliktSeiten).
async function pruefeRueckstand(k) {
  const { listeVorschlaege } = await import("../vorschlaege.mjs");
  const { wartendeInboxDateien } = await import("../vault-dateien.mjs");
  const { offeneKonfliktSeiten } = await import("../entscheidungen.mjs");
  const alle = listeVorschlaege(k.vault);
  const lektionen = alle.filter((v) => v.art === "lektion").length;
  const zahlen = { vorschlaege: alle.length - lektionen, lektionen, inbox: wartendeInboxDateien(k.vault), konflikte: offeneKonfliktSeiten(k.vault) };
  const w = k.werte;
  const befunde = [];
  const pruefe = (n, schwelle, wort) => { if (schwelle > 0 && n >= schwelle) befunde.push(befund("gelb", wort(n))); };
  pruefe(zahlen.vorschlaege, w.gesundheitVorschlaege, (n) => `${n} Vorschläge warten`);
  pruefe(zahlen.lektionen, w.gesundheitLektionen, (n) => `${n} Lektionen warten`);
  pruefe(zahlen.inbox, w.gesundheitInbox, (n) => `${n} Inbox-Dateien warten`);
  pruefe(zahlen.konflikte, w.gesundheitKonflikte, (n) => `Konflikte auf ${n} Seite(n)`);
  const mit = (n, schwelle) => `${n}${schwelle > 0 ? ` (ab ${schwelle})` : " (nie warnen)"}`;
  return ergebnis(`Vorschläge ${mit(zahlen.vorschlaege, w.gesundheitVorschlaege)} · Lektionen ${mit(zahlen.lektionen, w.gesundheitLektionen)} · Inbox-Dateien ${mit(zahlen.inbox, w.gesundheitInbox)} · Konflikte auf Seiten ${mit(zahlen.konflikte, w.gesundheitKonflikte)}`, befunde, zahlen);
}

export const PRUEFUNGEN = [
  { id: "messlatte", name: "Messlatte", lauf: pruefeMesslatte },
  { id: "hinweis", name: "Hinweis-Wege", lauf: pruefeHinweis },
  { id: "index", name: "Suchindex", lauf: pruefeIndex },
  { id: "dienst", name: "Suchdienst", lauf: pruefeDienst },
  { id: "rueckstand", name: "Rückstand", lauf: pruefeRueckstand },
];

// ---------- Ablauf ----------
// opt: jetzt (ms) · messlatte: "nein" (Standard: nur bewerten) | "takt" (Tageslauf: nach Einstellung messen) | "ja" (jetzt messen)
//      haken: Testhaken { pruefungen: { <id>: fn }, messlatte, frageDienst, istGesperrt, pidLebt, oeffneDb, dbPfad }.
// Wirft nie. → { version, zeit, ampel, warnungen, pruefungen: [{ id, name, stufe, text, befunde, daten, ms }] }
export async function gesundheit(vault, opt = {}) {
  const jetzt = opt.jetzt ?? Date.now();
  const haken = opt.haken || {};
  let werte, cfg;
  try { werte = leseAutomatik(vault).werte; cfg = ladeConfig(vault); } catch { werte = leseAutomatik("/nicht/vorhanden").werte; cfg = {}; }
  const k = { vault, jetzt, werte, cfg, haken, messlatte: opt.messlatte || "nein" };
  const liste = [];
  for (const p of PRUEFUNGEN) {
    const t0 = Date.now();
    let r;
    try {
      r = await (haken.pruefungen?.[p.id] || p.lauf)(k);
      if (!r || !Array.isArray(r.befunde)) throw new Error("ungültiges Ergebnis");
    } catch (e) {
      r = ergebnis(`lief nicht: ${kurz(e?.message, 100)}`, [befund("gelb", `Prüfung ${p.name} lief nicht: ${kurz(e?.message, 60)}`)]);
    }
    const befunde = r.befunde.filter((b) => b && typeof b.kurz === "string").map((b) => ({ stufe: b.stufe === "rot" ? "rot" : "gelb", kurz: sauber(kurz(b.kurz, 160)) }));
    liste.push({ id: p.id, name: p.name, stufe: schlimmste(befunde), text: sauber(kurz(r.text, 400)), befunde, daten: r.daten || {}, ms: Date.now() - t0 });
  }
  const warnungen = liste.reduce((s, p) => s + p.befunde.length, 0);
  return { version: 1, zeit: new Date(jetzt).toISOString(), ampel: schlimmste(liste.map((p) => ({ stufe: p.stufe }))), warnungen, pruefungen: liste };
}

// ---------- Stand (für Startmeldung, Bericht, letzter.json) ----------
// Pfad wie TL_DIR in protokoll.mjs — hier nicht importiert, damit der Sitzungsstart leicht bleibt.
const standPfad = (vault) => join(vault, ".logs", "tageslauf", "gesundheit.json");
export function schreibeGesundheit(vault, g) {
  const datei = standPfad(vault);
  mkdirSync(dirname(datei), { recursive: true });
  const tmp = `${datei}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(g, null, 2) + "\n");
  renameSync(tmp, datei);
}
export function leseGesundheit(vault) {
  try {
    const g = JSON.parse(readFileSync(standPfad(vault), "utf8"));
    return g && typeof g === "object" && Array.isArray(g.pruefungen) ? g : null;
  } catch { return null; }
}

// Tageslauf-Schritt (tageslauf.mjs): prüft (Messlatte nach Takt), speichert den Stand und hängt ihn an ctx.gesundheit. Wirft nie, macht den Lauf nie „teilweise“.
export async function gesundheitSchritt(ctx) {
  try {
    if (!leseAutomatik(ctx.vault).werte.gesundheit) return null;
    const g = await gesundheit(ctx.vault, { jetzt: ctx.jetzt, messlatte: "takt", haken: ctx.haken?.gesundheit });
    try { schreibeGesundheit(ctx.vault, g); } catch {}
    ctx.gesundheit = g;
    return g;
  } catch { return null; }
}

// Zeilen für den Tageslauf-Bericht (Abschnitt „### Gesundheit“): je Prüfung eine Zeile. Ohne Ergebnis (nur Antworten / Schalter aus) nichts.
export function gesundheitBerichtZeilen(ctx) {
  const g = ctx?.gesundheit;
  if (!g) return [];
  return ["", "### Gesundheit",
    `- ${SYMBOL[g.ampel]} Gesamt ${WORT[g.ampel]}: ${g.warnungen ? `${g.warnungen} Warnung${g.warnungen === 1 ? "" : "en"}` : "alles in Ordnung"}`,
    ...g.pruefungen.map((p) => `- ${SYMBOL[p.stufe]} ${WORT[p.stufe]} · ${p.name} — ${p.text}${p.befunde.length ? ` ⇒ ${p.befunde.map((b) => b.kurz).join("; ")}` : ""}`)];
}

// Kurzfassung für letzter.json
export const gesundheitKurz = (g) => (g ? { zeit: g.zeit, ampel: g.ampel, warnungen: g.warnungen } : null);

// ---------- Startmeldung ----------
// GENAU EINE Zeile, nur bei Warnungen; rote Befunde zuerst; was nicht mehr in ~300 Zeichen passt, wird „+N weitere“. Läuft der Tageslauf, der Stand ist aber
// älter als 3 Tage, sagt die Zeile das (der Wächter, der nicht mehr wacht, ist selbst eine Warnung). Wirft nie → null.
const ZEILE_MAX = 300;
export function gesundheitsZeile(vault, { jetzt = Date.now() } = {}) {
  try {
    const { werte } = leseAutomatik(vault);
    if (!werte.gesundheit) return null;
    const g = leseGesundheit(vault);
    if (!g) return null;
    const stand = Date.parse(g.zeit);
    if (Number.isFinite(stand) && jetzt - stand > STAND_MAX_ALTER_MS && werte.tageslauf !== "aus") {
      return `Kortex-Gesundheit: ⚠ 1 — Prüfung seit ${Math.floor((jetzt - stand) / TAG)} Tagen nicht gelaufen (Tageslauf prüfen; von Hand: brain gesundheit)`;
    }
    const alle = g.pruefungen.flatMap((p) => (Array.isArray(p.befunde) ? p.befunde : []))
      .filter((b) => b && typeof b.kurz === "string" && b.stufe !== "gruen")
      .map((b, i) => ({ ...b, i })).sort((a, b) => (RANG[b.stufe] - RANG[a.stufe]) || (a.i - b.i));
    if (!alle.length) return null;
    const genannt = [];
    for (const b of alle) {
      const probe = [...genannt, b.kurz].join(" · ");
      if (genannt.length && probe.length > ZEILE_MAX) break;
      genannt.push(b.kurz);
    }
    const rest = alle.length - genannt.length;
    const veraltet = Number.isFinite(stand) && jetzt - stand > 36 * STUNDE ? ` (Stand ${kurzDatum(stand)})` : "";
    return `Kortex-Gesundheit: ⚠ ${alle.length} — ${genannt.join(" · ")}${rest ? ` · +${rest} weitere` : ""}${veraltet} — Details: brain gesundheit`;
  } catch { return null; }
}

// ---------- CLI ----------
export function gesundheitText(g) {
  const kopf = g.warnungen ? `Kortex-Gesundheit ${kurzDatum(Date.parse(g.zeit))}: ⚠ ${g.warnungen} Warnung${g.warnungen === 1 ? "" : "en"}` : `Kortex-Gesundheit ${kurzDatum(Date.parse(g.zeit))}: alles in Ordnung`;
  return [kopf, ...g.pruefungen.map((p) => `${SYMBOL[p.stufe]} ${p.name}: ${p.text}${p.befunde.length ? `\n     ⇒ ${p.befunde.map((b) => b.kurz).join("; ")}` : ""}`)].join("\n");
}

const selbst = fileURLToPath(import.meta.url);
let aufruf = "";
try { aufruf = realpathSync(process.argv[1] || ""); } catch {}
if (aufruf && aufruf === realpathSync(selbst)) {
  const args = process.argv.slice(2);
  const bekannt = new Set(["--json", "--trocken", "--messlatte"]);
  const unbekannt = args.find((a) => a.startsWith("--") && !bekannt.has(a));
  if (unbekannt) { console.error(`Unbekannte Angabe: ${unbekannt}\nNutzung: brain gesundheit [--json] [--trocken] [--messlatte]`); process.exit(64); }
  const vault = vaultPfadOderEnde();
  try {
    const g = await gesundheit(vault, { messlatte: args.includes("--messlatte") ? "ja" : "nein" });
    if (!args.includes("--trocken")) { try { schreibeGesundheit(vault, g); } catch (e) { console.error(`Stand nicht gespeichert: ${kurz(e?.message, 80)}`); } }
    console.log(args.includes("--json") ? JSON.stringify(g) : gesundheitText(g));
    process.exitCode = g.warnungen ? 2 : 0;
  } catch (e) {
    console.error(kurz(e?.message || e, 200));
    process.exitCode = 1;
  }
}
