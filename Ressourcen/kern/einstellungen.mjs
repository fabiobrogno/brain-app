// .tools/einstellungen.mjs — Schema + Lesen/Schreiben von brain.config.json#automatik (Steuerzentrale,
// v0.3). Optimistisches Sperren über `stand` (= SHA-256-Hex der rohen Config-Bytes, aus liesConfigRoh in
// pfade.mjs — robuster als mtime, siehe dort): gleichzeitige Änderung durch Maske und KI → 409 statt
// stillem Überschreiben. Übrige Config-Abschnitte bleiben byte-genau erhalten (nur die Neuserialisierung
// ändert Formatierung). Nur Node-Standardbibliothek, keine Abhängigkeiten.
import { writeFileSync, renameSync, unlinkSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { liesConfigRoh } from "./pfade.mjs";
import { normiereWortliste } from "./thema-ausschluss.mjs";

export const SCHEMA = {
  staendeIntervallStunden: { werte: [0, 1, 2, 4], standard: 0 },
  ernteSitzungsende:       { typ: "boolean", standard: false },
  ernteNichtIn:            { typ: "pfadliste", standard: [] },
  // Themen-Ausschluss: Fakten, die eines dieser Wörter (ganzes Wort, Groß/Klein egal) nennen, kommen nie ins Brain — egal aus welchem
  // Ordner (thema-ausschluss.mjs). Gelesen wird großzügig (ein Tippfehler schaltet den Schutz nie ab), geschrieben streng.
  ernteOhneThema:          { typ: "wortliste", standard: [] },
  ichKarte:                { typ: "boolean", standard: false },
  projektAutomatik:        { typ: "boolean", standard: true },
  hinweise:                { werte: ["aus", "niedrig", "mittel", "hoch"], standard: "mittel" },
  liveAufleuchten:         { typ: "boolean", standard: true },
  updateHinweis:           { typ: "boolean", standard: true },
  sicherungTaeglich:       { typ: "boolean", standard: true },
  luecken:                 { typ: "boolean", standard: false },
  // v0.4 „Selbstpflege": Wochen-Zeile beim Sitzungsstart, Pflege-Lauf mit KI, Session-Auswerter (Lektionen).
  wochenbericht:           { typ: "boolean", standard: true },
  pflegeLauf:              { werte: ["aus", "woechentlich"], standard: "aus" },
  lektionen:               { werte: ["aus", "lokal", "mit-ki"], standard: "lokal" },
  // Treffsicherheit: Antwort-Messlatte (antwort-messlatte.mjs) — Haiku beantwortet Testfragen aus <wiki>/_antworten.json.
  antwortMesslatte:        { werte: ["aus", "monatlich"], standard: "aus" },
  // Gemeinsames Gedächtnis (gedaechtnis.mjs): ein abgeglichenes Auto-Memory je Projekt für mehrere Claude-Konten (jedes Konto behält einen echten
  // memory-Ordner). gedaechtnisTeilen an → der Tageslauf gleicht alle Projekte ab, SessionStart/SessionEnd das aktuelle (aus: nur von Hand mit
  // `brain gedaechtnis abgleichen --anwenden`). Wurzel und Konten stehen auch anderen Modulen zur Verfügung (gedaechtnisPfade): ~ und relative
  // Angaben werden erst beim Gebrauch aufgelöst. Standard-Konten: nur ~/.claude (das Kit wird veröffentlicht — weitere Konten trägt man selbst
  // ein). ohneMaske: nur per `brain einstellungen` änderbar, nicht in der Einstellungsmaske (technische Pfade).
  gedaechtnisTeilen:       { werte: ["aus", "an"], standard: "aus" },
  gedaechtnisWurzel:       { typ: "pfad", standard: "~/.claude-gedaechtnis", ohneMaske: true },
  gedaechtnisKonten:       { typ: "pfadliste", standard: ["~/.claude"], ohneMaske: true },
  // B2 Lernkreislauf (Spec 2026-10-21 §5.1/§5.2): Tageslauf aus | probe (rechnet, schreibt nichts) | an; Budget je Lauf.
  tageslauf:               { werte: ["aus", "probe", "an"], standard: "probe" },
  tageslaufBudget:         { werte: ["klein", "normal", "gross"], standard: "normal" },
  // B3 (Spec §7): Pflege-Intelligenz im Tageslauf (Sonnet mit Schutzgeländern) — aus | probe (rechnet, übernimmt nichts) | an.
  pflegeIntelligenz:       { werte: ["aus", "probe", "an"], standard: "aus" },
  // Einschwingphase (tageslauf/einschwingen.mjs): bis N automatische Übernahmen mit „stimmt“ bestätigt sind, schreibt ein echter Lauf nur so viele,
  // wie du gleichzeitig prüfen kannst (jede bekommt sofort eine Stichproben-Rückfrage); der Rest wartet. Die Antworten füllen die Fehlerquote
  // der Autostufe mit echten Daten. 0 = aus.
  einschwingen:            { typ: "ganzzahl", min: 0, max: 1000, standard: 20 },
  // Lernmodus (B2.2, tageslauf/autostufe.mjs): Startstufe der Autostufe für den ERSTEN echten Lauf — nur wenn es noch keinen Autostufen-Zustand gibt. Standard „aus“:
  // der Tageslauf schreibt anfangs nichts selbst, jeder Kandidat nach dem Richter wird eine markierte Rückfrage (deine Antwort zählt als Prüfung); nach 20 bestätigten Urteilen
  // in Folge geht es eine Stufe hoch. „eng“/„normal“ starten gleich vorsichtiger bzw. mit der vollen Automatik. Ein vorhandener Zustand bleibt unangetastet.
  autostufeStart:          { werte: ["aus", "eng", "normal"], standard: "aus" },
  // B1 (W2): MCP-Werkzeuge, deren Ergebnisse die Ernte als eigene Datenquelle (tool) statt als Web-Inhalt (web) zählt.
  // Werkzeugnamen, am Ende ein „*“ steht für „beginnt mit“ (z. B. "mcp__lager__*"). Standard: keins — MCP gilt als web.
  mcpVertraut:             { typ: "namensliste", standard: [] },
  // Gesundheits-Wächter (tageslauf/gesundheit.mjs, 0 Tokens): der Tageslauf prüft Such-Messlatte, Hinweis-Wege, Suchindex, Suchdienst und Rückstand;
  // beim Sitzungsstart steht genau eine Zeile, aber nur bei Warnungen. gesundheit=false schaltet Prüfung und Startzeile ab.
  // gesundheitMesslatte = Takt der Such-Messlatte im Tageslauf (aus: nur das vorhandene Ergebnis wird bewertet).
  // Die vier Zahlen sind Schwellen: ab dieser Zahl wartender Dinge gibt es eine Warnung, 0 = nie warnen.
  gesundheit:              { typ: "boolean", standard: true },
  gesundheitMesslatte:     { werte: ["taeglich", "woechentlich", "aus"], standard: "taeglich" },
  gesundheitVorschlaege:   { typ: "ganzzahl", min: 0, max: 100000, standard: 200 },
  gesundheitLektionen:     { typ: "ganzzahl", min: 0, max: 100000, standard: 30 },
  gesundheitInbox:         { typ: "ganzzahl", min: 0, max: 100000, standard: 15 },
  gesundheitKonflikte:     { typ: "ganzzahl", min: 0, max: 100000, standard: 1 },
    // Traum (tageslauf/traum.mjs): nächtliche Pflege des Gedächtnisses nach dem Muster von Anthropics „Dreams“ — Sonnet liest Gedächtnis + Verläufe der letzten 24 h und
  // schlägt ein bereinigtes Gedächtnis vor (Patch, nie ohne dein Ja). aus | probe (rechnet, zeigt Diffs nur im Bericht, keine Rückfragen) | an (Rückfrage je Projekt).
  traum:                   { werte: ["aus", "probe", "an"], standard: "aus", ohneMaske: true },
  traumProjekteMax:        { typ: "ganzzahl", min: 1, max: 20, standard: 5, ohneMaske: true },
  // Wörter, die nie in einen Traum dürfen (zusätzlich zu ernteOhneThema): Verläufe, Zeilen und Dateien mit einem dieser Wörter sieht die KI nicht.
  traumOhneThema:          { typ: "wortliste", standard: [], ohneMaske: true },
};
export const STANDARD = Object.fromEntries(Object.entries(SCHEMA).map(([k, s]) => [k, s.standard]));

// Budget je Tageslauf (Spec §5.1: 60 KI-Aufrufe und 15 min = „normal"). Was übrig bleibt, kommt beim nächsten Lauf dran.
export const TAGESLAUF_BUDGETS = {
  klein: { aufrufe: 30, minuten: 10 },
  normal: { aufrufe: 60, minuten: 15 },
  gross: { aufrufe: 120, minuten: 30 },
};

// Deltas, NICHT absolute Schwellen (Ruling nach W1-Review: absolute Werte konnten je nach Config unter
// den Standard von "mittel" fallen und so "niedrig" MEHR statt weniger Hinweise zeigen lassen). Der
// Aufrufer addiert den Delta auf cfg.schwelle/cfg.rerankSchwelle (bzw. deren Standardwert, falls die
// Config nichts setzt): "niedrig" erhöht die Schwelle (strenger → nie mehr Hinweise als "mittel"), "hoch"
// senkt sie (lockerer → mehr Hinweise). "mittel" lässt die bestehenden Config-Werte unverändert; "aus"
// unterdrückt den Brain-Hinweis komplett (ausgewertet von den jeweiligen Aufrufern, nicht hier).
export const HINWEIS_SCHWELLEN = {
  niedrig: { schwelle: 0.08, rerankSchwelle: 0.08 },
  mittel: null,
  hoch: { schwelle: -0.06, rerankSchwelle: -0.07 },
};

const dateiPfad = (vault) => join(vault, "brain.config.json");
const fehlerMit = (code, meldung) => Object.assign(new Error(meldung), { code });
const standVon = (text) => createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");

function istGueltig(schema, wert) {
  if (schema.werte) return schema.werte.includes(wert);
  if (schema.typ === "boolean") return typeof wert === "boolean";
  if (schema.typ === "ganzzahl") return Number.isInteger(wert) && wert >= schema.min && wert <= schema.max;
  if (schema.typ === "pfad") return typeof wert === "string" && wert.trim().length >= 1 && wert.length <= 300 && !/[\u0000-\u001f\u007f]/.test(wert);
  if (schema.typ === "pfadliste") {
    return Array.isArray(wert) && wert.length <= 20 && wert.every(p => typeof p === "string" && p.length <= 300);
  }
  if (schema.typ === "namensliste") {
    return Array.isArray(wert) && wert.length <= 20 && wert.every(n => typeof n === "string" && /^[\w.:*-]{1,200}$/.test(n));
  }
  if (schema.typ === "wortliste") {
    return Array.isArray(wert) && wert.length <= 50 && wert.every(w => typeof w === "string" && w.trim().length >= 1 && w.length <= 60 && !/[\u0000-\u001f\u007f]/.test(w));
  }
  return false;
}

// STANDARD, überlagert von Altschlüsseln — nur `hinweis` (alter flacher String, Vorgänger von
// `automatik.hinweise`) wird übernommen, und nur solange `automatik.hinweise` fehlt; `update.auto` hat
// keine neue Entsprechung mehr und wird hier ignoriert —, überlagert von `cfg.automatik` (nur gültige
// Schema-Werte zählen, alles andere wird stillschweigend verworfen statt zu werfen: lesend nie crashen).
export function leseAutomatik(vault) {
  // GENAU EINMAL lesen (liesConfigRoh) statt Inhalt und Fehlerstatus getrennt neu einzulesen — vermeidet
  // das Zeitfenster aus Review-Fund 1 (dreifaches Lesen, dazwischen kann ein nicht-atomarer Schreiber die
  // Datei kurz kaputt/leer hinterlassen).
  const { cfg: geladen, stand, fehler } = liesConfigRoh(vault);
  const cfg = geladen || {};
  const werte = { ...STANDARD };
  const hatNeuenHinweisSchluessel = cfg.automatik && typeof cfg.automatik === "object" && "hinweise" in cfg.automatik;
  if (typeof cfg.hinweis === "string" && !hatNeuenHinweisSchluessel && istGueltig(SCHEMA.hinweise, cfg.hinweis)) {
    werte.hinweise = cfg.hinweis;
  }
  if (cfg.automatik && typeof cfg.automatik === "object" && !Array.isArray(cfg.automatik)) {
    for (const [k, schema] of Object.entries(SCHEMA)) {
      if (!(k in cfg.automatik)) continue;
      // Wortliste (Themen-Ausschluss): ein Schutz, der still ausfällt, ist schlimmer als ein zu strenger — darum großzügig gelesen.
      if (schema.typ === "wortliste") werte[k] = normiereWortliste(cfg.automatik[k]);
      else if (istGueltig(schema, cfg.automatik[k])) werte[k] = cfg.automatik[k];
    }
  }
  return { werte, stand, fehler };
}

// Prüft `neu` gegen SCHEMA (unbekannter Schlüssel/falscher Typ/Wert außerhalb der Liste → 400; ein Wert
// `null` ist immer erlaubt und bedeutet „Schlüssel entfernen, Rückfall auf Standard") — das kostet keinen
// Dateizugriff und läuft darum zuerst. Danach wird die Config GENAU EINMAL gelesen (liesConfigRoh: Bytes,
// `stand` als SHA-256 der Bytes und die geparste Config stammen aus demselben Snapshot — kein Zeitfenster
// mehr, in dem ein zweiter, nicht-atomarer Schreiber unbemerkt dazwischenfunken könnte, siehe Review-Fund
// 1): kaputtes JSON → 500 (ohne gültiges JSON kann nichts sicher geschrieben werden), veralteter `stand`
// → 409. Geschrieben wird ein ZUSAMMENGEFÜHRTER automatik-Abschnitt — `brain einstellungen k=v` (Task 12)
// schickt immer nur einzelne Schlüssel, ein voller Ersatz würde die übrigen stillschweigend auf STANDARD
// zurückwerfen: 1) den vorhandenen cfg.automatik auf gültige Schema-Schlüssel filtern (ungültige Altwerte
// verwerfen), 2) die geprüften neuen Werte darüberlegen (null entfernt den Schlüssel), 3) schreiben.
// Übrige Abschnitte bleiben byte-identisch bis auf die Neuserialisierung. Die Kopie nach
// .logs/config-vorher.json kommt aus genau demselben gelesenen Text (kein erneutes Lesen der Datei).
export function schreibeAutomatik(vault, neu, stand) {
  const datei = dateiPfad(vault);
  if (neu === null || typeof neu !== "object" || Array.isArray(neu)) {
    throw fehlerMit(400, "Einstellungen müssen ein Objekt sein.");
  }
  const geprueft = {};
  for (const [k, wert] of Object.entries(neu)) {
    const schema = Object.hasOwn(SCHEMA, k) ? SCHEMA[k] : undefined;
    if (!schema) throw fehlerMit(400, `Unbekannter Einstellungs-Schlüssel „${k}".`);
    if (wert === null) { geprueft[k] = null; continue; } // Löschen — keine Typprüfung nötig
    if (!istGueltig(schema, wert)) throw fehlerMit(400, `Ungültiger Wert für „${k}".`);
    geprueft[k] = schema.typ === "wortliste" ? normiereWortliste(wert) : wert;
  }
  const { stand: aktuellerStand, text, cfg: geladen, fehler } = liesConfigRoh(vault);
  if (fehler) throw fehlerMit(500, `Config beschädigt, nicht geschrieben: ${fehler}`);
  if (aktuellerStand !== String(stand)) {
    throw fehlerMit(409, "Die Einstellungen wurden zwischenzeitlich geändert — bitte neu laden.");
  }
  const cfg = geladen || {};
  const vorhanden = {};
  if (cfg.automatik && typeof cfg.automatik === "object" && !Array.isArray(cfg.automatik)) {
    for (const [k, schema] of Object.entries(SCHEMA)) {
      if (!(k in cfg.automatik)) continue;
      if (schema.typ === "wortliste") { const l = normiereWortliste(cfg.automatik[k]); if (l.length) vorhanden[k] = l; }   // wie beim Lesen: Handgeschriebenes bleibt erhalten
      else if (istGueltig(schema, cfg.automatik[k])) vorhanden[k] = cfg.automatik[k];
    }
  }
  const zusammengefuehrt = { ...vorhanden };
  for (const [k, wert] of Object.entries(geprueft)) {
    if (wert === null) delete zusammengefuehrt[k]; else zusammengefuehrt[k] = wert;
  }
  cfg.automatik = zusammengefuehrt;
  const inhalt = JSON.stringify(cfg, null, 2) + "\n";
  mkdirSync(join(vault, ".logs"), { recursive: true });
  if (text != null) { try { writeFileSync(join(vault, ".logs", "config-vorher.json"), text); } catch {} }
  schreibeAtomar(datei, inhalt);
  return { ok: true, stand: standVon(inhalt) };
}

// Final-Review #1: Nicht-Claude-KIs (Codex, Gemini, Cursor) erfahren von der Ich-Karte nur über den Satz in
// AGENTS.md ({{WENN:ichKarte}}). Ändert sich ichKarte, rendert der Aufrufer (Dienst-PUT, `brain einstellungen`)
// die AGENTS.md im Vault neu — nur diese Datei, nie etwas unter ~/.claude. Fehlertolerant: → true/false.
export function rendereAgentsDatei(vault) {
  const skript = join(dirname(fileURLToPath(import.meta.url)), "skills-build.mjs");
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  return new Promise((fertig) => {
    try {
      execFile(process.execPath, [skript, vault, "--ziel", "agents", join(vault, "AGENTS.md")],
        { windowsHide: true, timeout: 15000, env }, (err) => fertig(!err));
    } catch { fertig(false); }
  });
}

// Kurzform für Hooks: einzelnen Wert lesen, ohne sich um STANDARD/Altschlüssel/Fehlerfall zu kümmern.
export function wert(vault, schluessel) {
  return leseAutomatik(vault).werte[schluessel];
}

const kurzWarten = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// tmp + rename; unter Windows kann ein paralleler Leser/Virenscanner kurz EPERM/EBUSY/EACCES auslösen —
// bis zu 5× mit 50 ms Pause erneut versuchen, danach als 500 melden (nie stillschweigend aufgeben).
function schreibeAtomar(datei, inhalt) {
  const tmp = `${datei}.${process.pid}.tmp`;
  writeFileSync(tmp, inhalt);
  const konkurrenz = new Set(process.platform === "win32" ? ["EPERM", "EBUSY", "EACCES"] : []);
  for (let versuch = 0; ; versuch++) {
    try { renameSync(tmp, datei); return; }
    catch (e) {
      if (!konkurrenz.has(e.code) || versuch >= 4) {
        try { unlinkSync(tmp); } catch {}
        throw fehlerMit(500, `Schreiben fehlgeschlagen: ${e.message}`);
      }
      kurzWarten(50);
    }
  }
}
