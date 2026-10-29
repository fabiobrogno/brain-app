#!/usr/bin/env node
// SessionStart: Hintergrund-Refresh (eigener, losgelöster Prozess) + Statusmeldung. Nie blockierend,
// Fehler still ins Log. BRAIN_SESSION_NUR_STATUS=1 (Tests): nur die Statuszeilen, kein Hintergrund.
// v0.3 (nur wenn zutreffend): Ich-Karte (ichKarte), „Projektseite: …" (projektAutomatik), Zahl neuer Vorschläge.
// BRAIN_ERNTE=1 (Selbstaufruf der Ernte) → sofort Ende, keine Ausgabe, kein Hintergrund. Die Kit-Module werden
// erst NACH dieser Prüfung geladen (dynamisches import) — statische Importe würden vorher ausgewertet.
// Liegengebliebene Ernte-Aufträge (.logs/ernte/offen/) startet session-start losgelöst neu (ernte-ausloeser.mjs).
// Gemeinsames Gedächtnis (gedaechtnisTeilen=an): gleicht das Auto-Memory des aktuellen Projekts losgelöst ab (gedaechtnis.mjs).
// v0.4 (nur wenn zutreffend): Wochen-Zeile aus dem Cache des Pflegeberichts (Schalter wochenbericht, einmal je
// 7 Tage, Marke .logs/pflege-woche — gerechnet wird im Hintergrund), „N Entscheidungen warten", „N Lektionen
// warten"; Pflege-Lauf wöchentlich losgelöst anstoßen (Schalter pflegeLauf, nur im Hintergrund-Zweig).
// M2a: Hook-JSON wird EINMAL oben gelesen (EINGABE/QUELLE/SID/CWD/TRANSKRIPT); die Ausgabe wird gesammelt (aus) und am
// Ende mit Gesamtbudget GESAMT_MAX gedruckt. K12: Nach einer Kompaktierung (source "compact") kommt zuerst der wörtliche
// Arbeitsstand dieser Sitzung (.logs/sitzungen/<session_id>.md, geschrieben von kompakt-sichern.mjs).
if (process.env.BRAIN_ERNTE === "1") process.exit(0);
import { appendFileSync, existsSync, statSync, readFileSync, readdirSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
const { vaultPfadOderEnde, ladeConfig, ordner, configFehler, entferneBom } = await import("../../pfade.mjs");
const { leseAutomatik } = await import("../../einstellungen.mjs");
const { listeVorschlaege } = await import("../../vorschlaege.mjs");
const { gitBefehl } = await import("../../werkzeug.mjs");
const { anzeigePfad } = await import("../../hint-core.mjs");

const T = dirname(fileURLToPath(import.meta.url));
const V = vaultPfadOderEnde([], { still: true });
const log = join(V, ".logs", "hooks.log");

// Hook-JSON einmal lesen (cwd, session_id, source, transcript_path, session_title) — K11/K12/K13 und die Projektseite
// brauchen es; stdin lässt sich nur einmal lesen. Steht ganz oben, damit eine Dublette (derselbe Hook aus zwei
// Einstellungsdateien, einmal.mjs) schon vor der ersten Log-Zeile still endet. leseEingabe ist unten als Funktion deklariert (gehoben).
const EINGABE = await leseEingabe();
const QUELLE = typeof EINGABE?.source === "string" ? EINGABE.source : "startup";
const SID = String(EINGABE?.session_id || "").replace(/[^\w-]/g, "").slice(0, 64);
if (!(await import("./einmal.mjs")).ersterAufruf(V, "session-start", { sid: SID, inhalt: QUELLE })) process.exit(0);

function formatLokal(d, sep = " ") {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}${sep}${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

try {
  mkdirSync(join(V, ".logs"), { recursive: true });
  if (existsSync(log)) {
    const zeilen = readFileSync(log, "utf8").split("\n");
    if (zeilen.length > 2000) {
      const tmp = `${log}.${process.pid}.tmp`;
      writeFileSync(tmp, zeilen.slice(-1000).join("\n"));
      renameSync(tmp, log);
    }
  }
  // Die Quelle (startup|resume|clear|compact) steht mit in der Zeile: der Gesundheits-Wächter zählt nur echte Starts (source=startup); Unbekanntes wird zu „andere“ (nie ein freier Text im Log).
  appendFileSync(log, `--- ${formatLokal(new Date())} session-start source=${/^[a-z_-]{1,20}$/.test(QUELLE) ? QUELLE : "andere"}\n`);
} catch {}

if (!existsSync(V)) process.exit(0);

const CWD = resolve(typeof EINGABE?.cwd === "string" && EINGABE.cwd ? EINGABE.cwd : process.cwd());
const TRANSKRIPT = typeof EINGABE?.transcript_path === "string" ? EINGABE.transcript_path : "";
// Ausgabe sammeln statt sofort drucken: am Ende gilt ein Gesamtbudget (Claude Code übernimmt höchstens 10.000 Zeichen).
const AUSGABE = [];
const aus = (t) => { if (t) AUSGABE.push(String(t)); };
const NACH_AUSGABE = [];   // { eintrag, schluessel }: wird nur als gezeigt gemerkt, wenn der Eintrag tatsächlich ausgegeben wurde
const GESAMT_MAX = 9500;

if (!process.env.BRAIN_SESSION_NUR_STATUS) {
  const kind = spawn(process.execPath, [join(T, "session-hintergrund.mjs"), V], {
    detached: true, stdio: "ignore", windowsHide: true, env: { ...process.env, BRAIN_VAULT: V },
  });
  kind.unref();
  // Ernte-Aufträge, deren Lauf mit Claude Code beendet wurde (Windows), jetzt nachholen — Claude läuft ja.
  if (existsSync(join(V, ".logs", "ernte"))) {
    try { (await import("./ernte-ausloeser.mjs")).arbeiteOffeneAb(V); } catch {}
  }
  // Pflege-Lauf mit KI (opt-in, wöchentlich): losgelöst, nie blockierend.
  try {
    if (leseAutomatik(V).werte.pflegeLauf === "woechentlich") (await import("../../pflegelauf.mjs")).starteWennFaellig(V);
  } catch {}
  // Antwort-Messlatte (opt-in, einmal im Monat): losgelöst, nie blockierend.
  try {
    if (leseAutomatik(V).werte.antwortMesslatte === "monatlich") (await import("../../antwort-messlatte.mjs")).starteWennFaellig(V);
  } catch {}
  // Tageslauf (B2, §5.1): Rückfall-Start, falls der Dienst fehlt (dann: wenn fällig) oder seit > 36 h nicht gestartet hat.
  // Losgelöst, nie blockierend; Schalter aus → nichts.
  try { (await import("../../tageslauf/zeitplan.mjs")).starteWennFaellig(V); } catch {}
}

// Sicherheitswarnung der Pflege (Integrität verletzt): immer ZUERST und unabhängig vom Tageslauf-Schalter.
try { aus((await import("../../tageslauf/morgen.mjs")).integritaetsZeile(V)); } catch {}

if (configFehler(V)) aus("Brain: Die Einstellungsdatei brain.config.json ist beschädigt — es gelten Standardwerte. Sag „repariere meine Brain-Einstellungen“.");

// Gesundheits-Wächter (tageslauf/gesundheit.mjs): GENAU EINE Zeile, nur bei Warnungen (grün = nichts); nach einer Kompaktierung nicht noch einmal.
if (QUELLE !== "compact") { try { aus((await import("../../tageslauf/gesundheit.mjs")).gesundheitsZeile(V)); } catch {} }

const automatik = leseAutomatik(V).werte;

// Gemeinsames Gedächtnis (nur gedaechtnisTeilen=an): Abgleich des AKTUELLEN Projekts losgelöst im Hintergrund — der Hook wartet nie.
// Projekt-Schlüssel = Elternordner von transcript_path (gedaechtnis.mjs#starteAbgleichFuerSitzung); ohne ihn passiert nichts.
// Bewusst außerhalb des BRAIN_SESSION_NUR_STATUS-Zweigs: bei Schalter „aus“ (Standard) tut es nie etwas, und die Tests brauchen es einzeln.
if (automatik.gedaechtnisTeilen === "an") { try { (await import("../../gedaechtnis.mjs")).starteAbgleichFuerSitzung({ vault: V, eingabe: EINGABE, werte: automatik }); } catch {} }

const cfg = ladeConfig(V);
const { inbox: inboxName, wiki: wikiName } = ordner(V, cfg);

// Inbox-Dateien, die auf /ingest warten (Zählweise in vault-dateien.mjs, damit der Gesundheits-Wächter dieselbe Zahl sieht).
let INBOX = 0;
try { INBOX = (await import("../../vault-dateien.mjs")).zaehleInboxDateien(join(V, inboxName)); } catch {}
if (INBOX !== 0) aus(`Brain-Inbox: ${INBOX} Datei(en) warten auf /ingest.`);

// v0.4: Wochen-Zeile aus dem Cache der letzten Berechnung (session-hintergrund rechnet den Pflegebericht losgelöst
// nach .logs/pflege-bericht.json — hier 0 Wartezeit, W1-Review #6). Schalter wochenbericht, einmal je 7 Tage.
const WOCHE_MS = 7 * 86400000;
const WOCHE_MARKE = join(V, ".logs", "pflege-woche");
let WOCHE = "";
if (automatik.wochenbericht !== false) {
  try {
    let faellig = true;
    try { faellig = Date.now() - statSync(WOCHE_MARKE).mtimeMs > WOCHE_MS; } catch {}
    if (faellig) WOCHE = await (await import("../../pflegelauf.mjs")).wochenHinweis(V);
  } catch {}
}
// Konfliktzeile: nur Seiten mit noch NICHT entschiedenen Kästen, ohne Symlinks nach außen (W1-Review #7, #16);
// in der Woche mit Wochen-Zeile entfällt sie (die nennt die Konflikte schon).
let KONFLIKTE = 0;
try { KONFLIKTE = (await import("../../entscheidungen.mjs")).offeneKonfliktSeiten(V); } catch {}
if (KONFLIKTE !== 0 && !WOCHE) aus(`Brain-Wiki: offene Konflikte auf ${KONFLIKTE} Seite(n) — Entscheidung nötig (/brain-lint).`);

// Eine Sammelzeile für Pflege (direkt berechnet, nicht aus dem Lint-Cache): Review fällig, offene Rückmeldungen
const M = join(V, ".logs", "letzter-review");
let P = "";
if (!existsSync(M) || (Date.now() - statSync(M).mtimeMs) > 30 * 86400000) P = "Review fällig";
const MISO = existsSync(M) ? formatLokal(statSync(M).mtime, "T") : "0000";
const fbDatei = join(V, ".logs", "feedback.log");
let FB = 0;
if (existsSync(fbDatei)) {
  FB = readFileSync(fbDatei, "utf8").split("\n").filter(z => z.slice(0, 19) > MISO).length;
}
if (FB !== 0) P = P ? `${P}, ${FB} offene Rückmeldung(en)` : `${FB} offene Rückmeldung(en)`;
if (P) aus(`Brain-Pflege: ${P} — /brain-review`);

// ---------- v0.3: Vorschläge, Ich-Karte, Projektseite ----------
// v0.4: Lektions-Vorschläge haben eine eigene Zeile und zählen hier nicht mit.
// B2 (§5.5): Zeigt der scharfe Tageslauf (Schalter „an“) seine Zeile, ersetzt sie die Zähler für Vorschläge und Lektionen.
// Probemodus: die Probe-Zeile kommt dazu, die alten Zeilen bleiben. Schalter „aus“ oder noch kein Lauf: alles wie bisher.
let TAGESLAUF_ZEILE = null;
try { if (automatik.tageslauf !== "aus") TAGESLAUF_ZEILE = (await import("../../tageslauf/morgen.mjs")).morgenZeile(V); } catch {}
const TAGESLAUF_ERSETZT = Boolean(TAGESLAUF_ZEILE) && automatik.tageslauf === "an";
if (TAGESLAUF_ZEILE) aus(TAGESLAUF_ZEILE);
// Einschwingphase: Ohne Tageslauf-Zeile (Schalter „an“, noch kein scharfer Lauf) steht die Angabe allein da — sie ersetzt keinen Zähler (TAGESLAUF_ERSETZT bleibt aus).
else if (automatik.tageslauf === "an") { try { const z = (await import("../../tageslauf/morgen.mjs")).einschwingZeile(V); if (z) aus(z); } catch {} }
let LEKTIONEN_WARTEN = 0;
try {
  const alle = listeVorschlaege(V);
  LEKTIONEN_WARTEN = alle.filter(x => x.art === "lektion").length;
  const n = alle.length - LEKTIONEN_WARTEN;
  if (n > 0 && !TAGESLAUF_ERSETZT) aus(`${n === 1 ? "1 neuer Vorschlag" : `${n} neue Vorschläge`} — im Gehirn prüfen („zeig mir mein Brain“)`);
} catch {}

// ---------- v0.4: Wochen-Zeile, Entscheidungen, Lektionen ----------
if (WOCHE) aus(WOCHE);
function zaehleMd(dir, ohne = () => false) {
  try { return readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile() && e.name.endsWith(".md") && !ohne(e.name)).length; }
  catch { return 0; }
}
const ENTSCHEIDUNGEN = zaehleMd(join(V, inboxName, "_entscheidungen"));
if (ENTSCHEIDUNGEN > 0) aus(`${ENTSCHEIDUNGEN === 1 ? "1 Entscheidung wartet" : `${ENTSCHEIDUNGEN} Entscheidungen warten`} auf Umsetzung — /ingest`);
if (LEKTIONEN_WARTEN > 0 && !TAGESLAUF_ERSETZT) aus(`${LEKTIONEN_WARTEN === 1 ? "1 Lektion wartet" : `${LEKTIONEN_WARTEN} Lektionen warten`} auf Übernahme — im Gehirn unter Vorschläge`);
// (Keine eigene Zeile für übernommene Lektionen — nicht in der Spec, 0-Token-Regel; sie stehen im Pflegebericht.)
// B2: allgemeine Lektionen (ohne „Gilt für“) — höchstens 600 Zeichen, neueste zuerst. Schalter tageslauf „aus“: wie bisher, nichts Neues.
try {
  const allg = automatik.tageslauf === "aus" ? [] : (await import("../../regeln.mjs")).allgemeineLektionen(V);
  if (allg.length) aus(`Brain-Regeln (allgemein):\n${allg.join("\n")}`);
} catch {}

const ICH_MAX = 1500;
function ichKarte(vault, wikiOrdner) {
  let t;
  try { t = entferneBom(readFileSync(join(vault, wikiOrdner, "ich.md"), "utf8")); } catch { return ""; }
  const fm = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.exec(t);
  if (fm) t = t.slice(fm[0].length);
  t = t.replace(/\r\n/g, "\n").trim();
  return t.length > ICH_MAX ? t.slice(0, ICH_MAX).trimEnd() + " …" : t;
}
if (automatik.ichKarte) {
  try { const k = ichKarte(V, wikiName); if (k) aus(`Brain-Ich-Karte (${wikiName}/ich.md):\n${k}`); } catch {}
}

// Hook-JSON (cwd) von stdin — mit kurzer Frist, denn ohne Claude Code (Tests, Hand-Aufruf) kann stdin offen bleiben.
function leseEingabe(ms = 300) {
  if (process.stdin.isTTY) return Promise.resolve({});
  return new Promise((fertig) => {
    const teile = []; let zu = false;
    const ende = () => {
      if (zu) return; zu = true; clearTimeout(uhr);
      try { process.stdin.pause(); } catch {}
      try { fertig(JSON.parse(Buffer.concat(teile).toString("utf8") || "{}")); } catch { fertig({}); }
    };
    const uhr = setTimeout(ende, ms);
    try {
      process.stdin.on("data", (c) => teile.push(c));
      process.stdin.on("end", ende);
      process.stdin.on("error", ende);
    } catch { ende(); }
  });
}

// Gezeigt-Listen (K2/K14) älter als 2 Tage aufräumen — nur beim echten Start.
try { if (QUELLE === "startup") (await import("../../gezeigt.mjs")).raeumeGezeigtAuf(V); } catch {}
// Projektseite (projektAutomatik): genau eine Wiki-Seite zum Ordner-/Repo-Namen; dazu der Steckbrief (K14: Felder
// pruefen/ziel/fallen + Stack frisch aus den Manifesten im Repo, ≤ 1.200 Zeichen). Gemerkt in .logs/gezeigt/, damit
// regeln-lesen.mjs (K2) ihn in dieser Sitzung nicht noch einmal einspielt.
if (automatik.projektAutomatik) {
  try {
    const { gitWurzel, findeProjektseite, steckbrief } = await import("../../projekt.mjs");
    const top = gitWurzel(CWD);
    const namen = [basename(CWD), ...(top ? [basename(top)] : [])];
    const seite = findeProjektseite(V, wikiName, namen);
    if (seite) {
      aus(`Projektseite: ${anzeigePfad(V, seite)}`);
      const sb = steckbrief(V, seite, { wurzel: top });
      aus(sb);
      // Erst nach der Budget-Auswahl (unten) als gezeigt merken — nur wenn der Steckbrief wirklich ausgegeben wird.
      if (SID && sb) NACH_AUSGABE.push({ eintrag: String(sb), schluessel: [`steckbrief:${seite}`, ...(top ? [`repo:${top}`] : [])] });
    }
  } catch {}
}

// ---------- K13: Was läuft parallel (eintragen; beim Start andere Sitzungen im selben Repo nennen) ----------
// Altlasten (Absturz ohne SessionEnd) werden hier aufgeräumt. Nach einer Kompaktierung nur eintragen, nichts melden (die Parallelen gelten dann als nicht gemeldet → nächster Prompt).
if (SID) {
  try {
    const { anmelden, raeumeAuf: laufendAufraeumen, hinweisZeile, titelAusPrompt } = await import("../../laufend.mjs");
    const { projektSchluessel } = await import("../../projekt.mjs");
    laufendAufraeumen(V);
    const titel = typeof EINGABE?.session_title === "string" ? titelAusPrompt(EINGABE.session_title) : null;
    const r = anmelden(V, { sid: SID, schluessel: projektSchluessel(V, CWD), titel, melden: QUELLE !== "compact" });
    if (r && QUELLE !== "compact") aus(hinweisZeile(r.andere));
  } catch {}
}

// ---------- K11: Was war zuletzt (nur beim Start, nicht nach einer Kompaktierung) ----------
if (QUELLE !== "compact" && TRANSKRIPT) {
  try {
    const { wasWarZuletzt } = await import("../../zuletzt.mjs");
    aus(wasWarZuletzt({ transkriptPfad: TRANSKRIPT, sid: SID, cwd: CWD, git: gitBefehl({ cfg }) }));
  } catch {}
}

// ---------- Ausgabe (K12-Budget) ----------
// Claude Code übernimmt SessionStart-stdout bis 10.000 Zeichen (darüber: Datei + 2.000 Zeichen Vorschau, die Claude
// nicht von selbst liest). Gesamt ≤ GESAMT_MAX. Nach einer Kompaktierung steht der Arbeitsstand (≤ 8.000) ZUERST;
// die übrigen Einträge bekommen den Rest — ganze Einträge in Rangfolge, was nicht passt, entfällt ganz.
// Ganze Einträge in Rangfolge: was nicht mehr passt, entfällt ganz (nie mitten im Eintrag gekürzt); ein kürzerer
// späterer Eintrag darf noch passen.
function ganzeEintraege(liste, max) {
  const genommen = [];
  let laenge = 0;
  for (const e of liste) {
    const l = e.length + (genommen.length ? 1 : 0);
    if (laenge + l > max) continue;
    genommen.push(e);
    laenge += l;
  }
  return genommen;
}
let TEXT = "";
try {
  const { lies, raeumeAuf, MAX_EINSPIELEN, kuerzeAnZeile } = await import("../../arbeitsstand.mjs");
  const stand = QUELLE === "compact" && SID ? lies(V, SID)?.text || "" : "";
  let platz = GESAMT_MAX;
  let kopf = "";
  if (stand) {
    kopf = kuerzeAnZeile(stand, MAX_EINSPIELEN);
    platz = Math.max(0, GESAMT_MAX - kopf.length - 2);
  }
  const genommen = ganzeEintraege(AUSGABE, platz);
  const rest = genommen.join("\n");
  TEXT = kopf ? (rest ? `${kopf}\n\n${rest}` : kopf) : rest;
  if (SID && NACH_AUSGABE.length) {
    const { merkeGezeigt } = await import("../../gezeigt.mjs");
    for (const n of NACH_AUSGABE) if (genommen.includes(n.eintrag)) merkeGezeigt(V, SID, ...n.schluessel);
  }
  if (QUELLE === "startup") raeumeAuf(V);
} catch { TEXT = ganzeEintraege(AUSGABE, GESAMT_MAX).join("\n"); }
if (TEXT) process.stdout.write(TEXT + "\n", () => process.exit(0));
else process.exit(0);
