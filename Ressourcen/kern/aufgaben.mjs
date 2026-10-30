// aufgaben.mjs — Aufgaben im Vault: je Aufgabe EINE Markdown-Datei im Ordner `aufgaben` (Standard 05_aufgaben, siehe pfade.mjs ordner()).
// Mensch (Studio, Kommandozeile) und KI (MCP, Skill) nutzen dieselbe Datei. Es gibt keine Index- oder Reihenfolge-Datei: die Spalte steht im Feld
// `status`, die Stelle in der Spalte im Feld `rang` (Zahl) der Aufgabe selbst. So ändert ein Verschieben genau EINE Datei — zwei Geräte, die
// verschiedene Karten bewegen, geraten beim Git-Abgleich nie in Konflikt. Format und Begründung: docs/plaene/aufgaben.md.
//
// Dieses Modul ist die einzige Stelle, die das Format kennt (Kommandozeile, Werkstatt und MCP rufen es auf). Der Teil oben ist rein (Text rein, Text
// raus), der Teil unten liest und schreibt Dateien: nur Dateien direkt im Aufgaben-Ordner, nie Verweise, atomar (Temp-Datei + Umbenennen).
import { readFileSync, readdirSync, lstatSync, mkdirSync, writeFileSync, renameSync, unlinkSync, linkSync, realpathSync, openSync, readSync, closeSync } from "node:fs";
import { join, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { ordner } from "./pfade.mjs";

export const STATUS = ["offen", "in-arbeit", "warten", "erledigt"];
export const PRIORITAET = ["niedrig", "normal", "hoch"];
export const STANDARD_ORDNER = "05_aufgaben";
export const RANG_SCHRITT = 1000;
export const ARCHIV_ORDNER = "archiv";   // Unterordner des Aufgaben-Ordners: erledigte Aufgaben wandern hierher (nie gelöscht)
export const ARCHIV_TAGE = 30;           // „alle erledigten älter als …“: Standard in Tagen
const MAX_DATEI = 256 * 1024;          // Bytes: größere Dateien werden nicht gelesen
const MAX_NEU = MAX_DATEI - 16 * 1024; // Bytes: so groß darf eine geschriebene Datei höchstens werden (Reserve für spätere Änderungen)
const MAX_TITEL = 200;
const MAX_TEXT = 100_000;              // Bytes (UTF-8), nicht Zeichen
const MAX_BEZUG = 20;
const MAX_BEZUG_LAENGE = 200;
export const MAX_DATEIEN = 5000;       // so viele Aufgaben liest eine Liste höchstens; darüber meldet sie `abgeschnitten`
const KOPF_BYTES = 2048;               // Kopf-Lesen (Zähler, Rang, Auflisten für die KI): nur der Anfang jeder Datei

// Fehler mit Statuscode: 400 Eingabe, 404 gibt es nicht, 409 Konflikt, 422 Datei unlesbar
export class AufgabeFehler extends Error {
  constructor(meldung, code = 400) { super(meldung); this.code = code; }
}

// ---------------------------------------------------------------------------------------------------------------------
// Rein: Daten, Text

export const heuteBerlin = (d = new Date()) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
export const zeitstempel = (d = new Date()) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
export function istDatum(s) {
  const m = ISO.exec(String(s ?? ""));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export function slug(s, max = 50) {
  const t = String(s).toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/, "");
  return t || "aufgabe";
}

// Eine Zeile ohne Steuerzeichen: C0/C1 und Zeilentrenner werden zu Leerzeichen, Bidi-Zeichen (Umkehr der Leserichtung) verschwinden.
const einzeilig = (s, max) => String(s ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
  .replace(/\s+/g, " ").trim().slice(0, max);
// Dateinamen, die in Listen und KI-Antworten nichts zu suchen haben (Zeilenumbruch, Steuer- und Bidi-Zeichen)
const UNSICHERER_NAME = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
const falte = (x) => String(x).normalize("NFC").toLowerCase();

// Wert in den Kopf schreiben: schlichter Text bleibt schlicht, alles mit Sonderzeichen kommt in Anführungszeichen (nur \" und \\ als Escapes —
// so liest es auch der Notiz-Index des Studios).
const SCHLICHT = /^[^\s\-?:,[\]{}#&*!|>'"%@`\\][^:#"'[\]{}\\]*$/u;
export function kopfWert(s) {
  const t = String(s);
  if (SCHLICHT.test(t) && t === t.trim()) return t;
  return `"${t.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
function kopfLesen(w) {
  w = String(w).trim();
  let m;
  if ((m = /^"((?:[^"\\]|\\.)*)"/.exec(w))) return m[1].replace(/\\(["\\])/g, "$1");
  if ((m = /^'((?:[^']|'')*)'/.exec(w))) return m[1].replace(/''/g, "'");
  return w.replace(/\s+#.*$/, "").trim();
}

// Kopf (Frontmatter) zerlegen: { felder: {schluessel: rohwert}, ende: Index der schließenden --- , zeilen, eol } oder null
function zerlege(text) {
  const bom = text.startsWith("﻿") ? "﻿" : "";
  const roh = bom ? text.slice(1) : text;
  const zeilen = roh.split("\n");
  const eol = zeilen[0].endsWith("\r") ? "\r\n" : "\n";
  const z = (i) => (zeilen[i] ?? "").replace(/\r$/, "");
  if (z(0) !== "---") return null;
  let ende = -1;
  for (let i = 1; i < zeilen.length; i++) if (z(i) === "---") { ende = i; break; }
  if (ende < 0) return null;
  const felder = {};
  for (let i = 1; i < ende; i++) {
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(z(i));
    if (!m) continue;
    const j = blockEnde((x) => z(x), i, ende);
    // Block-Skalar („titel: >“) und Block-Liste („bezug:“ + „- …“): die Folgezeilen gehören zum Wert
    felder[m[1]] = j > i + 1 && (m[2].trim() === "" || /^[>|][+-]?\s*$/.test(m[2])) ? Array.from({ length: j - i - 1 }, (_, k) => z(i + 1 + k).trim().replace(/^-\s+/, "- ")).join(" ") : m[2];
    i = j - 1;
  }
  return { felder, ende, zeilen, eol, bom };
}
// Index hinter der letzten Folgezeile des Schlüssels in Zeile i (eingerückt, oder bei leerem Wert auch „- …“); i + 1, wenn es keine gibt.
function blockEnde(z, i, ende) {
  const m = /^[A-Za-z_][\w-]*\s*:\s*(.*)$/.exec(z(i));
  const leer = !!m && (m[1].trim() === "" || /^[>|][+-]?\s*$/.test(m[1]));
  let j = i + 1;
  if (!leer) return j;
  while (j < ende && (/^[ \t]+\S/.test(z(j)) || (m[1].trim() === "" && /^-\s/.test(z(j))))) j++;
  return j;
}

function normStatus(s) {
  const t = String(s ?? "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  return STATUS.includes(t) ? t : null;
}
function normPrio(s) {
  const t = String(s ?? "").trim().toLowerCase();
  return PRIORITAET.includes(t) ? t : null;
}
function zahl(s) {
  if (s === undefined || s === null || String(s).trim() === "") return null;
  const n = Number(String(s).trim());
  return Number.isFinite(n) ? n : null;
}
function bezugAus(roh) {
  const aus = [];
  for (const m of String(roh ?? "").matchAll(/\[\[([^\]\n|]+?)(?:\|[^\]\n]*)?\]\]/g)) {
    const ziel = einzeilig(m[1], MAX_BEZUG_LAENGE);
    if (ziel && !aus.includes(ziel)) aus.push(ziel);
  }
  return aus.slice(0, MAX_BEZUG);
}

// Eine Aufgaben-Datei lesen. Gibt null zurück, wenn es keine Aufgabe ist (kein Kopf oder `typ` ist nicht „aufgabe“).
// Unbekannte oder fehlende Werte werden freundlich ergänzt (status → offen, prioritaet → normal), damit auch eine von Hand
// oder von einer anderen App geschriebene Datei als Karte erscheint.
export function parseAufgabe(text, pfad = "") {
  const k = zerlege(String(text));
  if (!k || kopfLesen(k.felder.typ ?? "").toLowerCase() !== "aufgabe") return null;
  const f = k.felder;
  const koerper = k.zeilen.slice(k.ende + 1).join("\n").replace(/\r\n/g, "\n").replace(/^\n+|\s+$/g, "");
  const datei = String(pfad).split("/").pop().replace(/\.md$/i, "");
  const faellig = kopfLesen(f.faellig ?? "");
  const quelle = kopfLesen(f.quelle ?? "") || "mensch";
  const titel = einzeilig(kopfLesen(f.titel ?? ""), MAX_TITEL)
    || einzeilig((/^#\s+(.+)$/m.exec(koerper) || [])[1] || "", MAX_TITEL)
    || datei.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/-/g, " ") || "Aufgabe";
  return {
    pfad, titel,
    status: normStatus(kopfLesen(f.status ?? "")) || "offen",
    prioritaet: normPrio(kopfLesen(f.prioritaet ?? "")) || "normal",
    faellig: istDatum(faellig) ? faellig : null,
    rang: zahl(kopfLesen(f.rang ?? "")),
    erstellt: kopfLesen(f.erstellt ?? "") || null,
    geaendert: kopfLesen(f.geaendert ?? "") || null,
    quelle: pruefeQuelle(quelle, { still: true }),
    bezug: bezugAus(f.bezug),
    text: koerper,
  };
}

// quelle: „mensch“ oder „ki:<programm>“ (Programm oder Konto, z. B. ki:claude-code). Alles andere wird zu „mensch“ (still) bzw. abgelehnt.
export function pruefeQuelle(q, { still = false } = {}) {
  const t = String(q ?? "").trim().toLowerCase();
  if (!t || t === "mensch") return "mensch";
  const m = /^ki:(.+)$/.exec(t);
  if (m) {
    const name = m[1].trim().replace(/[^a-z0-9._@-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    if (name) return `ki:${name}`;
  }
  if (still) return "mensch";
  throw new AufgabeFehler("Die Quelle ist „mensch“ oder „ki:<programm>“, zum Beispiel ki:claude-code.");
}

// Quelle für Aufgaben, die über die Kommandozeile entstehen: nicht frei wählbar, sondern aus der Umgebung abgeleitet. Läuft der Befehl in einem KI-Programm
// (Claude Code setzt CLAUDECODE=1, die Gemini-CLI GEMINI_CLI=1, Codex CODEX_SANDBOX/CODEX_CI), steht ki:<programm> dort, sonst mensch. Nur im Testmodus
// (BRAIN_TESTMODUS=1) gilt BRAIN_QUELLE.
export function quelleAusUmgebung(env = process.env) {
  if (env.BRAIN_TESTMODUS === "1" && env.BRAIN_QUELLE) return pruefeQuelle(env.BRAIN_QUELLE);
  if (env.CLAUDECODE === "1") return "ki:claude-code";
  if (env.GEMINI_CLI === "1") return "ki:gemini";
  if (env.CODEX_SANDBOX || env.CODEX_CI) return "ki:codex";
  return "mensch";
}

// Eingaben prüfen und bereinigen. Wirft AufgabeFehler (400). Nicht genannte Felder bleiben ungesetzt.
export function pruefeEingabe(e = {}) {
  const aus = {};
  if (e.titel !== undefined) {
    if (typeof e.titel !== "string") throw new AufgabeFehler("Der Titel muss Text sein.");
    const t = einzeilig(e.titel, MAX_TITEL);
    if (!t) throw new AufgabeFehler("Bitte einen Titel angeben.");
    aus.titel = t;
  }
  if (e.status !== undefined) {
    const s = normStatus(e.status);
    if (!s) throw new AufgabeFehler(`Der Status ist einer von: ${STATUS.join(", ")}.`);
    aus.status = s;
  }
  if (e.prioritaet !== undefined) {
    const p = normPrio(e.prioritaet);
    if (!p) throw new AufgabeFehler(`Die Priorität ist eine von: ${PRIORITAET.join(", ")}.`);
    aus.prioritaet = p;
  }
  if (e.faellig !== undefined) {
    if (e.faellig === null || e.faellig === "") aus.faellig = null;
    else if (typeof e.faellig === "string" && istDatum(e.faellig.trim())) aus.faellig = e.faellig.trim();
    else throw new AufgabeFehler("Fällig als Datum angeben, zum Beispiel 2026-11-03.");
  }
  if (e.rang !== undefined) {
    if (typeof e.rang !== "number" || !Number.isFinite(e.rang) || Math.abs(e.rang) > 1e12) throw new AufgabeFehler("Der Rang muss eine Zahl sein.");
    aus.rang = Number(e.rang.toFixed(6));
  }
  if (e.quelle !== undefined) aus.quelle = pruefeQuelle(e.quelle);
  if (e.text !== undefined) {
    if (typeof e.text !== "string") throw new AufgabeFehler("Der Text muss Text sein.");
    if (Buffer.byteLength(e.text, "utf8") > MAX_TEXT) throw new AufgabeFehler("Der Text ist zu lang (höchstens 100 KB).");
    aus.text = e.text.replace(/\r\n/g, "\n").replace(/^\n+|\s+$/g, "");
  }
  if (e.bezug !== undefined) {
    const liste = Array.isArray(e.bezug) ? e.bezug : [e.bezug];
    const ziele = [];
    for (const b of liste) {
      const ziel = einzeilig(String(b ?? "").trim().replace(/^\[\[|\]\]$/g, "").replace(/[\][|"\\]/g, ""), MAX_BEZUG_LAENGE);
      if (ziel && !ziele.includes(ziel)) ziele.push(ziel);
    }
    aus.bezug = ziele.slice(0, MAX_BEZUG);
  }
  return aus;
}

const bezugZeile = (liste) => `[${liste.map((b) => `"[[${b}]]"`).join(", ")}]`;

// Text einer neuen Aufgabe. `felder` ist schon geprüft (pruefeEingabe); jetzt = Date.
export function baueText(felder, jetzt = new Date()) {
  const f = felder;
  const zeit = zeitstempel(jetzt);
  const kopf = [
    "---", "typ: aufgabe", `titel: ${kopfWert(f.titel)}`, `status: ${f.status || "offen"}`, `prioritaet: ${f.prioritaet || "normal"}`,
    ...(f.faellig ? [`faellig: ${f.faellig}`] : []),
    `rang: ${f.rang ?? RANG_SCHRITT}`, `erstellt: ${zeit}`, `geaendert: ${zeit}`, `quelle: ${f.quelle || "mensch"}`,
    ...(f.bezug && f.bezug.length ? [`bezug: ${bezugZeile(f.bezug)}`] : []),
    "---",
  ];
  const text = `${kopf.join("\n")}\n${f.text ? `\n${f.text}\n` : ""}`;
  if (Buffer.byteLength(text, "utf8") > MAX_NEU) throw new AufgabeFehler("Die Aufgabe wäre zu groß (höchstens etwa 240 KB).");
  return text;
}

// Felder im Kopf einer bestehenden Aufgabe ändern, zeilengenau: der Rest der Datei (Text, Zeilenenden, fremde Felder) bleibt Byte für Byte.
// `felder` ist geprüft; null entfernt ein Feld (nur faellig, bezug). `geaendert` wird immer neu gesetzt.
export function setzeFelder(text, felder, jetzt = new Date()) {
  const k = zerlege(text);
  if (!k) throw new AufgabeFehler("Der Kopf dieser Datei ist nicht lesbar. Es wurde nichts geändert.", 422);
  const { eol, bom } = k;
  const kopf = k.zeilen.slice(0, k.ende), rest = k.zeilen.slice(k.ende);
  const cr = eol === "\r\n" ? "\r" : "";
  const gesetzt = (schluessel, wert) => {
    const treffer = kopf.map((z, n) => (n > 0 && new RegExp(`^${schluessel}\\s*:`).test(z) ? n : -1)).filter((n) => n >= 0);
    // ein Schlüssel samt seinen Folgezeilen (Block-Liste, Block-Skalar) wird ersetzt bzw. entfernt — nichts bleibt als Waise stehen
    const bis = (n) => blockEnde((x) => kopf[x].replace(/\r$/, ""), n, kopf.length);
    if (wert === null) { for (const n of treffer.reverse()) kopf.splice(n, bis(n) - n); return; }
    const neu = `${schluessel}: ${wert}${cr}`;
    if (treffer.length) {
      for (const n of treffer.slice(1).reverse()) kopf.splice(n, bis(n) - n);
      kopf.splice(treffer[0], bis(treffer[0]) - treffer[0], neu);
    } else kopf.push(neu);
  };
  if (felder.titel !== undefined) gesetzt("titel", kopfWert(felder.titel));
  if (felder.status !== undefined) gesetzt("status", felder.status);
  if (felder.prioritaet !== undefined) gesetzt("prioritaet", felder.prioritaet);
  if (felder.faellig !== undefined) gesetzt("faellig", felder.faellig);
  if (felder.rang !== undefined) gesetzt("rang", String(felder.rang));
  if (felder.bezug !== undefined) gesetzt("bezug", felder.bezug.length ? bezugZeile(felder.bezug) : null);
  gesetzt("geaendert", zeitstempel(jetzt));
  let neuText = bom + [...kopf, ...rest].join("\n");
  if (felder.text !== undefined) {
    const zeilen = [...kopf, rest[0]].join("\n");
    neuText = `${bom}${zeilen}${eol}${felder.text ? `${eol}${felder.text.replace(/\n/g, eol)}${eol}` : ""}`;
  }
  if (Buffer.byteLength(neuText, "utf8") > MAX_DATEI) throw new AufgabeFehler("Die Aufgabe wäre zu groß. Es wurde nichts geändert.", 422);
  return neuText;
}

// Reihenfolge: nach rang (ohne Rang ans Ende), dann nach Anlegen, dann nach Pfad — gleich auf jedem Gerät.
export function vergleiche(a, b) {
  const ra = a.rang ?? Infinity, rb = b.rang ?? Infinity;
  if (ra !== rb) return ra < rb ? -1 : 1;
  const ea = a.erstellt || "", eb = b.erstellt || "";
  if (ea !== eb) return ea < eb ? -1 : 1;
  return a.pfad < b.pfad ? -1 : a.pfad > b.pfad ? 1 : 0;
}
export const sortiere = (liste) => [...liste].sort(vergleiche);

// Rang für eine neue Aufgabe am Ende ihrer Spalte.
export function rangAmEnde(liste, status) {
  const raenge = liste.filter((a) => a.status === status && a.rang !== null).map((a) => a.rang);
  return raenge.length ? Math.floor(Math.max(...raenge)) + RANG_SCHRITT : RANG_SCHRITT;
}

// Stelle in einer Spalte, in der die Karte zwischen `davor` und `danach` (Aufgaben dieser Spalte oder null) landet. Gibt { rang, umnummerieren } zurück:
// Im Regelfall bekommt NUR die bewegte Karte einen neuen Rang (Mitte der Nachbarn). Haben die Nachbarn denselben oder fast denselben Rang
// (zwei Geräte haben gleichzeitig angelegt), ist zwischen ihnen kein Platz: dann wird die Spalte neu durchnummeriert (umnummerieren = [{pfad, rang}]).
export function plane(spalte, bewegt, davorPfad, danachPfad) {
  const rest = sortiere(spalte.filter((a) => a.pfad !== bewegt));
  const finde = (p) => (p ? rest.findIndex((a) => a.pfad === p) : -1);
  let i;
  if (davorPfad && finde(davorPfad) >= 0) i = finde(davorPfad) + 1;
  else if (danachPfad && finde(danachPfad) >= 0) i = finde(danachPfad);
  else i = rest.length;
  const v = rest[i - 1] ?? null, n = rest[i] ?? null;
  const rv = v ? v.rang : null, rn = n ? n.rang : null;
  const luecke = rv !== null && rn !== null ? rn - rv : Infinity;
  if ((v && rv === null) || (n && rn === null)) return nummeriere(rest, i);   // Nachbarn ohne Rang
  if (luecke < 1e-4) return nummeriere(rest, i);
  let rang;
  if (!v && !n) rang = RANG_SCHRITT;
  else if (!v) rang = rn - RANG_SCHRITT;
  else if (!n) rang = rv + RANG_SCHRITT;
  else rang = (rv + rn) / 2;
  return { rang: Number(rang.toFixed(6)), umnummerieren: [] };
}
function nummeriere(rest, i) {
  const neu = [...rest.slice(0, i), null, ...rest.slice(i)];
  let rang = 0, eigener = RANG_SCHRITT;
  const umnummerieren = [];
  for (const a of neu) {
    rang += RANG_SCHRITT;
    if (a === null) { eigener = rang; continue; }
    if (a.rang !== rang) umnummerieren.push({ pfad: a.pfad, rang });
  }
  return { rang: eigener, umnummerieren };
}

// Zähler für Menüleiste und Seitenleiste: offen = noch nicht erledigt; überfällig = offen und Fälligkeit vor heute.
export function zaehleAus(liste, heute = heuteBerlin()) {
  let offen = 0, ueberfaellig = 0;
  for (const a of liste) {
    if (a.status === "erledigt") continue;
    offen++;
    if (a.faellig && a.faellig < heute) ueberfaellig++;
  }
  return { offen, ueberfaellig };
}

// Kompakte Darstellung (für KI-Antworten): eine Zeile je Aufgabe.
export function zeile(a, { heute = heuteBerlin() } = {}) {
  const teile = [`[${a.status}]`, a.prioritaet === "normal" ? "" : a.prioritaet, einzeilig(a.pfad, 300), a.titel];
  if (a.faellig) teile.push(`(fällig ${a.faellig}${a.status !== "erledigt" && a.faellig < heute ? ", überfällig" : ""})`);
  return teile.filter(Boolean).join(" ");
}

export function dateiname(titel, jetzt = new Date()) {
  return `${heuteBerlin(jetzt)}-${slug(titel, 50)}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Dateien

export function ordnerName(vault) {
  try { return ordner(vault).aufgaben || STANDARD_ORDNER; } catch { return STANDARD_ORDNER; }
}

// Der Ordner auf der Platte: Groß-/Kleinschreibung kann von der Konfiguration abweichen (macOS, Windows) — dann gilt der Name, wie er auf der Platte steht.
// Ein Verweis (Symlink) wird nie benutzt, auch keiner innerhalb des Vaults (sonst landeten Aufgaben z. B. im Wiki). Fehlt der Ordner, wird er nur auf Wunsch angelegt.
function ordnerAbs(vault, { anlegen = false } = {}) {
  const gewollt = ordnerName(vault);
  let namen = [];
  try { namen = readdirSync(vault); } catch { throw new AufgabeFehler("Der Vault-Ordner ist nicht lesbar.", 422); }
  const vorhanden = namen.find((n) => n === gewollt) ?? namen.find((n) => falte(n) === falte(gewollt)) ?? null;
  const name = vorhanden ?? gewollt;
  const abs = join(vault, name);
  if (vorhanden) {
    let st;
    try { st = lstatSync(abs); } catch { throw new AufgabeFehler(`Der Ordner „${name}“ ist nicht lesbar.`, 422); }
    if (st.isSymbolicLink()) throw new AufgabeFehler(`„${name}“ ist ein Verweis und wird nicht benutzt: Aufgaben liegen als echter Ordner direkt im Vault.`, 403);
    if (!st.isDirectory()) throw new AufgabeFehler(`„${name}“ ist eine Datei, kein Ordner.`, 422);
  } else {
    if (!anlegen) return { name, abs, da: false };
    try { mkdirSync(abs); } catch (e) { if (e.code !== "EEXIST") throw e; }
  }
  let echt, wurzel;
  try { echt = realpathSync(abs); wurzel = realpathSync(vault); } catch { throw new AufgabeFehler(`Der Ordner „${name}“ ist nicht lesbar.`, 422); }
  if (falte(echt) !== falte(join(wurzel, name))) throw new AufgabeFehler(`Der Ordner „${name}“ liegt nicht direkt im Vault und wird nicht benutzt.`, 403);
  return { name, abs, da: true };
}

function leseDatei(abs) {
  const st = lstatSync(abs);
  if (!st.isFile() || st.size > MAX_DATEI) return null;
  return readFileSync(abs, "utf8");
}
// Nur der Anfang einer Datei (der Kopf): genug für Status, Rang, Titel — ohne große Texte zu lesen. Ist der Kopf länger, gilt die ganze Datei.
function leseKopfDatei(abs) {
  const st = lstatSync(abs);
  if (!st.isFile() || st.size > MAX_DATEI) return null;
  if (st.size <= KOPF_BYTES) return readFileSync(abs, "utf8");
  let fd;
  try {
    fd = openSync(abs, "r");
    const b = Buffer.alloc(KOPF_BYTES);
    const n = readSync(fd, b, 0, KOPF_BYTES, 0);
    const zeilen = b.subarray(0, n).toString("utf8").split("\n").slice(0, -1);   // die letzte Zeile ist angeschnitten
    const t = zeilen.join("\n");
    if (zerlege(t)) return t;
  } finally { if (fd !== undefined) try { closeSync(fd); } catch { /* egal */ } }
  return readFileSync(abs, "utf8");
}

// Alle Aufgaben (sortiert nach rang). Eine unlesbare Datei wird übersprungen, nie ein Fehler für die ganze Liste. kopf: nur die Köpfe lesen (text bleibt leer).
// Mehr als MAX_DATEIEN Dateien: die neuesten (nach Dateiname = Datum) kommen in die Liste, `abgeschnitten` ist true.
export function liste(vault, { kopf = false } = {}) {
  const o = ordnerAbs(vault);
  const leer = [];
  leer.abgeschnitten = false;
  if (!o.da) return leer;
  let namen;
  try { namen = readdirSync(o.abs); } catch { return leer; }
  namen = namen.filter((n) => /\.md$/i.test(n) && !n.startsWith(".") && !n.startsWith("_") && !UNSICHERER_NAME.test(n)).sort().reverse();
  const abgeschnitten = namen.length > MAX_DATEIEN;
  const aus = [];
  for (const n of namen.slice(0, MAX_DATEIEN)) {
    let text; try { text = kopf ? leseKopfDatei(join(o.abs, n)) : leseDatei(join(o.abs, n)); } catch { continue; }
    if (text === null) continue;
    const a = parseAufgabe(text, `${o.name}/${n}`);
    if (a) aus.push(kopf ? { ...a, text: "" } : a);
  }
  const r = sortiere(aus);
  r.abgeschnitten = abgeschnitten;
  return r;
}

function schreibeAtomar(abs, text) {
  const tmp = join(abs, "..", `.brain-tmp-${process.pid}-${randomBytes(4).toString("hex")}`);
  try { writeFileSync(tmp, text, { flag: "wx", mode: 0o644 }); renameSync(tmp, abs); }
  catch (e) { try { unlinkSync(tmp); } catch { /* weg */ } throw e; }
}

// Felder in eine bestehende Datei schreiben. Vor dem Ersetzen wird der Inhalt noch einmal verglichen: hat in der Zwischenzeit ein anderer Prozess die Datei
// geändert (Studio und Kommandozeile gleichzeitig), wird die Änderung auf den neuen Stand angewendet, nicht auf den alten. Gibt den neuen Text zurück.
function aendereDatei(abs, felder, jetzt, gelesen) {
  let text = gelesen;
  for (let versuch = 0; versuch < 3; versuch++) {
    const neu = setzeFelder(text, felder, jetzt);
    let aktuell;
    try { aktuell = leseDatei(abs); } catch { throw new AufgabeFehler("Diese Aufgabe gibt es nicht (mehr).", 404); }
    if (aktuell === text) { schreibeAtomar(abs, neu); return neu; }
    if (aktuell === null) throw new AufgabeFehler("Das ist keine gewöhnliche Datei.", 422);
    text = aktuell;
  }
  throw new AufgabeFehler("Die Aufgabe wird gerade von jemand anderem geändert. Bitte noch einmal versuchen.", 409);
}

// Neue Aufgabe. e: { titel, text?, prioritaet?, faellig?, status?, quelle?, bezug?, rang? }. Gibt { pfad, aufgabe } zurück.
// Der Rang am Ende der Spalte kommt aus den Köpfen der vorhandenen Aufgaben (keine Datei wird ganz gelesen); der Dateiname ist über `wx` eindeutig.
export function legeAn(vault, e, { jetzt = new Date() } = {}) {
  const f = pruefeEingabe(e);
  if (!f.titel) throw new AufgabeFehler("Bitte einen Titel angeben.");
  const o = ordnerAbs(vault, { anlegen: true });
  if (f.rang === undefined) {
    const vorhanden = liste(vault, { kopf: true });
    if (vorhanden.abgeschnitten) throw new AufgabeFehler(`Es gibt schon mehr als ${MAX_DATEIEN} Aufgaben. Bitte erst erledigte aufräumen oder archivieren.`, 409);
    f.rang = rangAmEnde(vorhanden, f.status || "offen");
  }
  const text = baueText(f, jetzt);
  const stamm = dateiname(f.titel, jetzt);
  for (let i = 1; i < 1000; i++) {
    const name = `${stamm}${i === 1 ? "" : "-" + i}.md`;
    try { writeFileSync(join(o.abs, name), text, { flag: "wx", mode: 0o644 }); }
    catch (err) { if (err.code === "EEXIST") continue; throw err; }
    const pfad = `${o.name}/${name}`;
    return { pfad, aufgabe: parseAufgabe(text, pfad) };
  }
  throw new AufgabeFehler("Es gibt schon zu viele Aufgaben mit diesem Titel.", 409);
}

// Pfad einer Aufgabe auflösen: „05_aufgaben/x.md“, „x.md“, „x“ oder ein eindeutiger Namensteil. Wirft 404/400.
export function findePfad(vault, eingabe) {
  const roh = String(eingabe ?? "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!roh) throw new AufgabeFehler("Bitte die Aufgabe angeben (Pfad oder Dateiname).");
  if (UNSICHERER_NAME.test(roh)) throw new AufgabeFehler("Der Name enthält ungültige Zeichen.");
  const alle = liste(vault, { kopf: true });
  const name = ordnerName(vault);
  const mitEndung = /\.md$/i.test(roh) ? roh : `${roh}.md`;
  const voll = mitEndung.includes("/") ? mitEndung : `${name}/${mitEndung}`;
  const genau = alle.find((a) => falte(a.pfad) === falte(voll));
  if (genau) return genau.pfad;
  if (roh.includes("/")) throw new AufgabeFehler(`Diese Aufgabe gibt es nicht: ${einzeilig(roh, 200)}`, 404);
  const gesucht = falte(roh).replace(/\.md$/, "");
  const teil = alle.filter((a) => falte(a.pfad.split("/").pop()).includes(gesucht));
  if (teil.length === 1) return teil[0].pfad;
  if (teil.length > 1) throw new AufgabeFehler(`„${einzeilig(roh, 200)}“ passt auf mehrere Aufgaben (${teil.slice(0, 3).map((a) => einzeilig(a.pfad.split("/").pop(), 100)).join(", ")} …). Bitte genauer angeben.`, 409);
  throw new AufgabeFehler(`Diese Aufgabe gibt es nicht: ${einzeilig(roh, 200)}`, 404);
}

// Felder einer Aufgabe ändern. e: { titel?, status?, prioritaet?, faellig?, rang?, bezug?, text? } plus platz: { davor, danach } (Pfade) für die Stelle in der
// Spalte. basisText: Text, den der Aufrufer gesehen hat (nur wenn er Änderungen von anderswo erkennen will; sonst gilt immer der aktuelle Stand).
// Gibt { pfad, aufgabe, geaendert: [pfad …] } zurück (geaendert nennt auch Karten, die beim Neu-Nummerieren mitgezogen wurden).
export function aendere(vault, pfad, e, { jetzt = new Date(), basisText, zwischen } = {}) {
  const { platz, ...rest } = e || {};
  const f = pruefeEingabe(rest);
  const o = ordnerAbs(vault);
  if (!o.da) throw new AufgabeFehler("Diese Aufgabe gibt es nicht.", 404);
  const m = /^([^/]+)\/([^/]+\.md)$/i.exec(String(pfad ?? "").replace(/\\/g, "/"));
  if (!m || falte(m[1]) !== falte(o.name) || m[2].startsWith(".") || m[2].startsWith("_") || UNSICHERER_NAME.test(m[2])) throw new AufgabeFehler("Das ist keine Aufgabe in diesem Vault.", 400);
  const rel = `${o.name}/${m[2]}`;   // Ordnername wie auf der Platte
  const abs = join(o.abs, m[2]);
  let text;
  try { text = leseDatei(abs); } catch { throw new AufgabeFehler("Diese Aufgabe gibt es nicht (mehr).", 404); }
  if (text === null) throw new AufgabeFehler("Das ist keine gewöhnliche Datei.", 422);
  if (basisText !== undefined && basisText !== text) throw new AufgabeFehler("Die Aufgabe wurde inzwischen geändert (zum Beispiel auf einem anderen Gerät). Bitte neu laden.", 409);
  const alt = parseAufgabe(text, rel);
  if (!alt) throw new AufgabeFehler("Diese Datei ist keine Aufgabe (typ: aufgabe fehlt).", 422);
  const geaendert = [rel];
  const zielStatus = f.status ?? alt.status;
  // Spalte gewechselt oder Stelle genannt, aber kein fester Rang → Rang aus der Stelle berechnen (ohne Stelle: ans Ende der neuen Spalte)
  if (f.rang === undefined && (platz || zielStatus !== alt.status)) {
    const alle = liste(vault, { kopf: true });
    const gleich = (a, b) => falte(a) === falte(b);
    const nachbar = (p) => (typeof p === "string" && p ? alle.find((a) => gleich(a.pfad, p))?.pfad ?? null : null);
    if (platz) {
      const p = plane(alle.filter((a) => a.status === zielStatus), rel, nachbar(platz.davor), nachbar(platz.danach));
      f.rang = p.rang;
      for (const u of p.umnummerieren) {
        const fabs = join(o.abs, u.pfad.split("/").pop());
        let t; try { t = leseDatei(fabs); } catch { continue; }
        if (t !== null) { aendereDatei(fabs, { rang: u.rang }, jetzt, t); geaendert.push(u.pfad); }
      }
    } else f.rang = rangAmEnde(alle.filter((a) => a.pfad !== rel), zielStatus);
  }
  if (typeof zwischen === "function") zwischen();   // Testhaken: ein anderer Prozess ändert die Datei zwischen Lesen und Schreiben
  aendereDatei(abs, f, jetzt, text);
  return { pfad: rel, aufgabe: parseAufgabe(readFileSync(abs, "utf8"), rel), geaendert };
}

// ---------------------------------------------------------------------------------------------------------------------
// Archivieren: eine erledigte Aufgabe wandert unverändert (Byte für Byte) in `<aufgaben-ordner>/archiv/`. Es wird nichts gelöscht und nichts überschrieben
// (gibt es den Namen dort schon, bekommt die Datei ein „-2“, „-3“ …). Das Board und die Zähler lesen nur die Dateien DIREKT im Aufgaben-Ordner und sehen das Archiv
// darum nie; im Notiz-Index zählt der Ordner als Archiv. Dieselben Schutzregeln wie beim Aufgaben-Ordner: nie ein Verweis, nie außerhalb des Vaults.

// Der Archiv-Ordner unterhalb des Aufgaben-Ordners (echter Ordner, kein Verweis, direkt darin). Fehlt er, wird er nur auf Wunsch angelegt.
function archivAbs(o, { anlegen = false } = {}) {
  let namen = [];
  try { namen = readdirSync(o.abs); } catch { throw new AufgabeFehler(`Der Ordner „${o.name}“ ist nicht lesbar.`, 422); }
  const vorhanden = namen.find((n) => n === ARCHIV_ORDNER) ?? namen.find((n) => falte(n) === falte(ARCHIV_ORDNER)) ?? null;
  const name = vorhanden ?? ARCHIV_ORDNER;
  const abs = join(o.abs, name);
  if (vorhanden) {
    let st;
    try { st = lstatSync(abs); } catch { throw new AufgabeFehler(`Der Ordner „${name}“ ist nicht lesbar.`, 422); }
    if (st.isSymbolicLink()) throw new AufgabeFehler(`„${o.name}/${name}“ ist ein Verweis und wird nicht benutzt: Das Archiv liegt als echter Ordner im Aufgaben-Ordner.`, 403);
    if (!st.isDirectory()) throw new AufgabeFehler(`„${o.name}/${name}“ ist eine Datei, kein Ordner.`, 422);
  } else {
    if (!anlegen) return { name, abs, da: false };
    try { mkdirSync(abs); } catch (e) { if (e.code !== "EEXIST") throw e; }
  }
  let echt, eltern;
  try { echt = realpathSync(abs); eltern = realpathSync(o.abs); } catch { throw new AufgabeFehler(`Der Ordner „${name}“ ist nicht lesbar.`, 422); }
  if (falte(echt) !== falte(join(eltern, name))) throw new AufgabeFehler(`Der Ordner „${o.name}/${name}“ liegt nicht direkt im Aufgaben-Ordner und wird nicht benutzt.`, 403);
  return { name, abs, da: true };
}

// Datei `von` unter einem freien Namen in `zielOrdner` ablegen, ohne etwas zu überschreiben: erst ein zweiter Name (harter Verweis; schlägt bei einem
// vorhandenen Ziel fehl), dann fällt der alte Name weg. So gibt es keinen Augenblick ohne Datei. Ging die Quelle zwischendurch an einen anderen Prozess
// (atomar ersetzt), wird nichts entfernt und der Vorgang abgebrochen. Ohne harte Verweise (manche Laufwerke) gilt Umbenennen mit vorheriger Prüfung.
function legeUnterFreiemNamenAb(von, zielOrdner, name) {
  const stamm = name.replace(/\.md$/i, "");
  for (let i = 1; i < 1000; i++) {
    const ziel = join(zielOrdner, `${stamm}${i === 1 ? "" : "-" + i}.md`);
    try {
      linkSync(von, ziel);
    } catch (e) {
      if (e.code === "EEXIST") continue;
      if (!["EPERM", "ENOTSUP", "EXDEV", "EMLINK", "ENOSYS", "EOPNOTSUPP"].includes(e.code)) throw e;
      try { lstatSync(ziel); continue; } catch { /* frei */ }
      renameSync(von, ziel);
      return ziel;
    }
    let gleich = false;
    try { gleich = lstatSync(von).ino === lstatSync(ziel).ino; } catch { /* Quelle weg */ }
    if (!gleich) { try { unlinkSync(ziel); } catch { /* weg */ } throw new AufgabeFehler("Die Aufgabe wurde inzwischen geändert. Es wurde nichts verschoben.", 409); }
    unlinkSync(von);
    return ziel;
  }
  throw new AufgabeFehler("Im Archiv gibt es schon zu viele Dateien mit diesem Namen.", 409);
}

// Eine erledigte Aufgabe archivieren. Gibt { von, pfad, aufgabe } zurück (pfad = neuer Ort im Archiv). Nicht erledigte Aufgaben bleiben auf dem Board (409).
export function archiviere(vault, pfad) {
  const o = ordnerAbs(vault);
  if (!o.da) throw new AufgabeFehler("Diese Aufgabe gibt es nicht.", 404);
  const m = /^([^/]+)\/([^/]+\.md)$/i.exec(String(pfad ?? "").replace(/\\/g, "/"));
  if (!m || falte(m[1]) !== falte(o.name) || m[2].startsWith(".") || m[2].startsWith("_") || UNSICHERER_NAME.test(m[2])) throw new AufgabeFehler("Das ist keine Aufgabe in diesem Vault.", 400);
  const rel = `${o.name}/${m[2]}`;
  const abs = join(o.abs, m[2]);
  let text;
  try { text = leseDatei(abs); } catch { throw new AufgabeFehler("Diese Aufgabe gibt es nicht (mehr).", 404); }
  if (text === null) throw new AufgabeFehler("Das ist keine gewöhnliche Datei.", 422);
  const a = parseAufgabe(text, rel);
  if (!a) throw new AufgabeFehler("Diese Datei ist keine Aufgabe (typ: aufgabe fehlt).", 422);
  if (a.status !== "erledigt") throw new AufgabeFehler("Archiviert werden nur erledigte Aufgaben.", 409);
  const archiv = archivAbs(o, { anlegen: true });
  const ziel = legeUnterFreiemNamenAb(abs, archiv.abs, m[2]);
  const neu = `${o.name}/${archiv.name}/${ziel.split(sep).pop()}`;
  return { von: rel, pfad: neu, aufgabe: { ...a, pfad: neu } };
}

// Alle erledigten Aufgaben archivieren, die seit mehr als `tage` Tagen nicht mehr geändert wurden (Änderungszeit aus dem Kopf; ohne lesbares Datum bleibt die
// Aufgabe stehen). Gibt { tage, archiviert: [{ von, pfad }], uebersprungen: n } zurück; eine einzelne Aufgabe, die sich nicht verschieben lässt, stoppt die anderen nicht.
export function archiviereAlte(vault, { tage = ARCHIV_TAGE, jetzt = new Date() } = {}) {
  if (typeof tage !== "number" || !Number.isInteger(tage) || tage < 1 || tage > 3650) throw new AufgabeFehler("Die Tage müssen eine ganze Zahl von 1 bis 3650 sein.");
  const grenze = jetzt.getTime() - tage * 86400000;
  const archiviert = [];
  let uebersprungen = 0;
  for (const a of liste(vault, { kopf: true })) {
    if (a.status !== "erledigt") continue;
    const t = Date.parse(a.geaendert || a.erstellt || "");
    if (!Number.isFinite(t) || t >= grenze) continue;
    try { const r = archiviere(vault, a.pfad); archiviert.push({ von: r.von, pfad: r.pfad }); }
    catch (e) { if (e instanceof AufgabeFehler) uebersprungen++; else throw e; }
  }
  return { tage, archiviert, uebersprungen };
}

export const zaehle = (vault, heute) => zaehleAus(liste(vault, { kopf: true }), heute);
