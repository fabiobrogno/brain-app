// tageslauf/autostufe.mjs — Fehlerquote und Autostufe (Spec §6.3), selbstregelnd, Zustand in .logs/tageslauf/autostufe.json.
// Fehler: Stichprobe „stimmt nicht", Rücknahme einer automatischen Übernahme, W7 auf einer automatisch geschriebenen Stelle.
// Geprüft: diese + beantwortete Stichproben + „bewährt" (automatische Übernahme > 30 Tage, seitdem als Hinweis gezeigt,
// ohne Beanstandung). Quote über die letzten 40 Prüfungen: > 5 % → eng, > 15 % → aus. Strenger nur, wenn seit dem letzten
// Wechsel ein neuer Fehler kam (sonst schaukelt es); eine Stufe zurück nach 20 Prüfungen in Folge ohne Fehler seit dem Wechsel.
// Lernmodus (B2.2): Gibt es noch keinen Zustand, beginnt ein ECHTER Lauf mit der Einstellung autostufeStart (Standard „aus“; Zustand angelegt, Grund „start“) — der Tageslauf
// schreibt dann anfangs nichts selbst, die markierten Rückfragen sind der Rückweg (Antworten zählen als Prüfungen, nach 20 in Folge eine Stufe hoch). Ein vorhandener Zustand bleibt
// unangetastet; die Probe legt nie einen Zustand an, rechnet aber mit dem Startwert. „grund: start“ bleibt im Zustand, solange die Stufe nicht wechselt (Lernmodus = aus + start).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { TL_DIR, lesePruefungen, merkePruefung, notiere, autoUebernahmen } from "./protokoll.mjs";

export const STUFEN = ["normal", "eng", "aus"];
export const FENSTER = 40, ENG_AB = 0.05, AUS_AB = 0.15, ZURUECK_NACH = 20, BEWAEHRT_TAGE = 30;
export const START_GRUND = "start";
const ANFANG = "1970-01-01T00:00:00.000Z";
const datei = (vault) => join(TL_DIR(vault), "autostufe.json");
const rang = (s) => STUFEN.indexOf(s);

export function quote(pruefungen) {
  const l = pruefungen.slice(-FENSTER);
  return { fehler: l.filter((p) => p.fehler).length, geprueft: l.length };
}
// Prüfungen in Folge ohne Fehler, ganz am Ende der Liste der Prüfungen seit dem Wechsel (seit).
const folgeOhneFehler = (seitWechsel) => { let n = 0; for (let i = seitWechsel.length - 1; i >= 0 && !seitWechsel[i].fehler; i--) n++; return n; };
// Startstufe aus den Einstellungen des Laufs (ctx.werte.autostufeStart); alles Unbekannte ist „aus“ (fail-safe: lieber zu vorsichtig).
const startStufe = (werte) => (STUFEN.includes(werte?.autostufeStart) ? werte.autostufeStart : "aus");
// Lernmodus = die Stufe „aus“ stammt aus dem Start, nicht aus Fehlern.
export const istLernmodus = (z) => z?.stufe === "aus" && z?.grund === START_GRUND;
export function naechsteAutostufe(z, pruefungen, jetztIso) {
  const stufeAlt = STUFEN.includes(z?.stufe) ? z.stufe : "normal";
  // grund „start“ bleibt, solange die Stufe bleibt; jeder Wechsel (unten) liefert einen Zustand ohne Grund.
  const alt = { stufe: stufeAlt, seit: z?.seit || ANFANG, ...(z?.grund === START_GRUND && STUFEN.includes(z?.stufe) ? { grund: START_GRUND } : {}) };
  const q = quote(pruefungen);
  const anteil = q.geprueft ? q.fehler / q.geprueft : 0;
  const ziel = anteil > AUS_AB ? "aus" : anteil > ENG_AB ? "eng" : "normal";
  const seitWechsel = pruefungen.filter((p) => String(p.zeit) > alt.seit);
  if (rang(ziel) > rang(alt.stufe) && seitWechsel.some((p) => p.fehler)) return { stufe: ziel, seit: jetztIso, quote: q };
  const folge = folgeOhneFehler(seitWechsel);
  if (alt.stufe !== "normal" && folge >= ZURUECK_NACH) return { stufe: STUFEN[rang(alt.stufe) - 1], seit: jetztIso, quote: q };
  return { ...alt, quote: q };
}

// Gespeicherter Zustand oder null (Datei fehlt, kaputt, unbekannte Stufe).
function leseZustand(vault) {
  try { const z = JSON.parse(readFileSync(datei(vault), "utf8")); if (STUFEN.includes(z.stufe)) return z; } catch {}
  return null;
}
// Leser ohne Lauf-Kontext: ohne Zustand „normal“ (es gibt noch keinen Lauf, der etwas anderes entschieden hätte).
export function ladeAutostufe(vault) {
  return leseZustand(vault) || { stufe: "normal", seit: ANFANG };
}
// Zustand für einen Lauf: der gespeicherte, sonst der Startzustand (ctx.werte.autostufeStart, Grund start). Der Start beginnt JETZT — ältere Prüfungen
// (z. B. nach gelöschter autostufe.json) zählen nicht für den Rückweg, sonst ließe sich der Lernmodus mit alten fehlerfreien Prüfungen überspringen.
const startZustand = (ctx) => ({ stufe: startStufe(ctx.werte), seit: new Date(ctx.jetzt).toISOString(), grund: START_GRUND });
const zustandFuer = (ctx) => leseZustand(ctx.vault) || startZustand(ctx);
export function aktualisiereAutostufe(ctx) {
  const vorhanden = leseZustand(ctx.vault);
  const alt = vorhanden || startZustand(ctx);
  const jetztIso = new Date(ctx.jetzt).toISOString();
  const pruefungen = lesePruefungen(ctx.vault);
  let neu = naechsteAutostufe(alt, pruefungen, jetztIso);
  // Ohne Zustand: lockern nur mit Prüfungen seit dem Start (oben), die Bremse aus ALTEN Fehlern gilt aber weiter — eine gelöschte oder
  // kaputte autostufe.json darf frühere Fehler nicht vergessen machen.
  if (!vorhanden) {
    const streng = naechsteAutostufe({ ...alt, seit: ANFANG }, pruefungen, jetztIso);
    if (rang(streng.stufe) > rang(alt.stufe)) neu = streng;
  }
  ctx.autostufe = neu.stufe;
  ctx.quote = neu.quote;
  ctx.lernmodus = istLernmodus(neu);
  if (neu.stufe !== alt.stufe) notiere(ctx, { id: "autostufe", stufe: "autostufe", ziel: neu.stufe, grund: `${alt.stufe} → ${neu.stufe} (Fehlerquote ${neu.quote.fehler}/${neu.quote.geprueft})` });
  else if (!vorhanden && neu.stufe !== "normal") notiere(ctx, { id: "autostufe", stufe: "autostufe", ziel: neu.stufe, grund: `Start bei ${neu.stufe}${ctx.lernmodus ? " (Lernmodus)" : ""} — Einstellung autostufeStart` });
  if (!ctx.probe) { mkdirSync(TL_DIR(ctx.vault), { recursive: true }); writeFileSync(datei(ctx.vault), JSON.stringify(neu, null, 2) + "\n"); }
  return neu;
}
// Stufe sofort auf mindestens `ziel` setzen (nie lockern), z. B. nach einem „stimmt nicht“ in der Einschwingphase. Gleiche Datei und gleiches Format wie
// aktualisiereAutostufe — `seit` ist der Zeitpunkt des Wechsels, naechsteAutostufe regelt alles Weitere (strenger nur bei einem NEUEN Fehler, zurück
// erst nach 20 Prüfungen in Folge ohne Fehler seit dem Wechsel). → true, wenn sich die Stufe geändert hat.
export function erzwingeAutostufe(ctx, ziel, grund = "") {
  const alt = zustandFuer(ctx);
  if (rang(alt.stufe) >= rang(ziel)) { ctx.autostufe = alt.stufe; return false; }
  const neu = { stufe: ziel, seit: new Date(ctx.jetzt).toISOString(), quote: quote(lesePruefungen(ctx.vault)) };
  ctx.autostufe = neu.stufe;
  ctx.quote = neu.quote;
  ctx.lernmodus = false;
  notiere(ctx, { id: "autostufe", stufe: "autostufe", ziel: neu.stufe, grund: `${alt.stufe} → ${neu.stufe}${grund ? ` (${grund})` : ""}` });
  if (!ctx.probe) { mkdirSync(TL_DIR(ctx.vault), { recursive: true }); writeFileSync(datei(ctx.vault), JSON.stringify(neu, null, 2) + "\n"); }
  return true;
}
// Rückweg aus eng/aus: wie viele Prüfungen in Folge ohne Fehler seit dem Wechsel schon da sind und wie viele noch fehlen (ZURUECK_NACH). normal → null.
// Prüfungen sind Stichproben, Rücknahmen, W7, „bewährt“ und die Antworten auf Rückfragen, die nur wegen der Autostufe gestellt wurden (art rueckweg).
export function rueckwegStand(vault) {
  const z = ladeAutostufe(vault);
  if (z.stufe === "normal") return null;
  const folge = folgeOhneFehler(lesePruefungen(vault).filter((p) => String(p.zeit) > z.seit));
  return { stufe: z.stufe, folge, noch: Math.max(0, ZURUECK_NACH - folge) };
}
export const stichprobenJeWoche = (stufe) => (stufe === "normal" ? 2 : 4);

export function bewaehrtePruefungen(ctx, { aktionen = [], pruefungen = [], nutzung = new Map() } = {}) {
  const schon = new Set(pruefungen.map((p) => p.ref).filter(Boolean));
  const beanstandet = new Set(pruefungen.filter((p) => p.fehler && p.seite).map((p) => p.seite));
  let n = 0;
  for (const a of autoUebernahmen(aktionen)) {
    const t = Date.parse(a.zeit), ref = `bewaehrt:${a.id}`;
    if (!(ctx.jetzt - t > BEWAEHRT_TAGE * 86400e3) || schon.has(ref) || beanstandet.has(a.ziel)) continue;
    if (!(nutzung.get(a.ziel) || []).some((z) => z > t)) continue;
    merkePruefung(ctx, { art: "bewaehrt", fehler: false, ref, seite: a.ziel, aktion: a.id });
    schon.add(ref);
    n++;
  }
  return n;
}
