// aufgaben.mjs — Aufgaben im Vault: je Aufgabe EINE Markdown-Datei im Ordner `aufgaben` (Standard 05_aufgaben, siehe pfade.mjs ordner()).
// Mensch (Studio, Kommandozeile) und KI (MCP, Skill) nutzen dieselbe Datei. Es gibt keine Index- oder Reihenfolge-Datei: die Spalte steht im Feld
// `status`, die Stelle in der Spalte im Feld `rang` (Zahl) der Aufgabe selbst. So ändert ein Verschieben genau EINE Datei — zwei Geräte, die
// verschiedene Karten bewegen, geraten beim Git-Abgleich nie in Konflikt. Format und Begründung: docs/plaene/aufgaben.md.
//
// Dieses Modul ist die einzige Stelle, die das Format kennt (Kommandozeile, Werkstatt und MCP rufen es auf). Der Teil oben ist rein (Text rein, Text
// raus), der Teil unten liest und schreibt Dateien: nur Dateien direkt im Aufgaben-Ordner, nie Verweise, atomar (Temp-Datei + Umbenennen).
import { readFileSync, readdirSync, lstatSync, mkdirSync, writeFileSync, renameSync, unlinkSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { ordner } from "./pfade.mjs";

export const STATUS = ["offen", "in-arbeit", "warten", "erledigt"];
export const PRIORITAET = ["niedrig", "normal", "hoch"];
export const STANDARD_ORDNER = "05_aufgaben";
export const RANG_SCHRITT = 1000;
const MAX_DATEI = 256 * 1024;
const MAX_TITEL = 200;
const MAX_TEXT = 100_000;
const MAX_BEZUG = 20;
const MAX_DATEIEN = 5000;

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

const einzeilig = (s, max) => String(s ?? "").replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

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
    if (m) felder[m[1]] = m[2];
  }
  return { felder, ende, zeilen, eol, bom };
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
    const ziel = m[1].trim();
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
    if (e.text.length > MAX_TEXT) throw new AufgabeFehler("Der Text ist zu lang.");
    aus.text = e.text.replace(/\r\n/g, "\n").replace(/^\n+|\s+$/g, "");
  }
  if (e.bezug !== undefined) {
    const liste = Array.isArray(e.bezug) ? e.bezug : [e.bezug];
    const ziele = [];
    for (const b of liste) {
      const ziel = String(b ?? "").trim().replace(/^\[\[|\]\]$/g, "").replace(/[\]\n[|"\\]/g, "").trim();
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
  return `${kopf.join("\n")}\n${f.text ? `\n${f.text}\n` : ""}`;
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
    if (wert === null) { for (const n of treffer.reverse()) kopf.splice(n, 1); return; }
    const neu = `${schluessel}: ${wert}${cr}`;
    if (treffer.length) { kopf[treffer[0]] = neu; for (const n of treffer.slice(1).reverse()) kopf.splice(n, 1); }
    else kopf.push(neu);
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
  const teile = [`[${a.status}]`, a.prioritaet === "normal" ? "" : a.prioritaet, a.pfad, a.titel];
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

// Absoluter Ordner; wirft, wenn er (als Verweis) aus dem Vault hinauszeigt. Fehlt er, wird er nur auf Wunsch angelegt.
function ordnerAbs(vault, { anlegen = false } = {}) {
  const name = ordnerName(vault);
  const abs = join(vault, name);
  let st = null;
  try { st = lstatSync(abs); } catch { /* fehlt */ }
  if (!st) {
    if (!anlegen) return { name, abs, da: false };
    mkdirSync(abs, { recursive: true });
  } else if (!st.isDirectory() && !st.isSymbolicLink()) throw new AufgabeFehler(`„${name}“ ist eine Datei, kein Ordner.`, 422);
  let echt, wurzel;
  try { echt = realpathSync(abs); wurzel = realpathSync(vault); } catch { throw new AufgabeFehler(`Der Ordner „${name}“ ist nicht lesbar.`, 422); }
  if (echt !== join(wurzel, name) && !echt.startsWith(wurzel + sep)) throw new AufgabeFehler(`Der Ordner „${name}“ zeigt aus dem Vault hinaus und wird nicht benutzt.`, 403);
  return { name, abs, da: true };
}

function leseDatei(abs) {
  const st = lstatSync(abs);
  if (!st.isFile() || st.size > MAX_DATEI) return null;
  return readFileSync(abs, "utf8");
}

// Alle Aufgaben (sortiert nach rang). Eine unlesbare Datei wird übersprungen, nie ein Fehler für die ganze Liste.
export function liste(vault) {
  const o = ordnerAbs(vault);
  if (!o.da) return [];
  let namen;
  try { namen = readdirSync(o.abs); } catch { return []; }
  const aus = [];
  for (const n of namen.slice(0, MAX_DATEIEN)) {
    if (!/\.md$/i.test(n) || n.startsWith(".") || n.startsWith("_")) continue;
    let text; try { text = leseDatei(join(o.abs, n)); } catch { continue; }
    if (text === null) continue;
    const a = parseAufgabe(text, `${o.name}/${n}`);
    if (a) aus.push(a);
  }
  return sortiere(aus);
}

function schreibeAtomar(abs, text) {
  const tmp = join(abs, "..", `.brain-tmp-${process.pid}-${randomBytes(4).toString("hex")}`);
  try { writeFileSync(tmp, text, { flag: "wx", mode: 0o644 }); renameSync(tmp, abs); }
  catch (e) { try { unlinkSync(tmp); } catch { /* weg */ } throw e; }
}

// Neue Aufgabe. e: { titel, text?, prioritaet?, faellig?, status?, quelle?, bezug?, rang? }. Gibt { pfad, aufgabe } zurück.
export function legeAn(vault, e, { jetzt = new Date() } = {}) {
  const f = pruefeEingabe(e);
  if (!f.titel) throw new AufgabeFehler("Bitte einen Titel angeben.");
  const o = ordnerAbs(vault, { anlegen: true });
  if (f.rang === undefined) f.rang = rangAmEnde(liste(vault), f.status || "offen");
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
  const alle = liste(vault);
  const name = ordnerName(vault);
  const mitEndung = /\.md$/i.test(roh) ? roh : `${roh}.md`;
  const voll = mitEndung.includes("/") ? mitEndung : `${name}/${mitEndung}`;
  const genau = alle.find((a) => a.pfad === voll);
  if (genau) return genau.pfad;
  if (roh.includes("/")) throw new AufgabeFehler(`Diese Aufgabe gibt es nicht: ${roh}`, 404);
  const teil = alle.filter((a) => a.pfad.split("/").pop().toLowerCase().includes(roh.toLowerCase().replace(/\.md$/, "")));
  if (teil.length === 1) return teil[0].pfad;
  if (teil.length > 1) throw new AufgabeFehler(`„${roh}“ passt auf mehrere Aufgaben (${teil.slice(0, 3).map((a) => a.pfad.split("/").pop()).join(", ")} …). Bitte genauer angeben.`, 409);
  throw new AufgabeFehler(`Diese Aufgabe gibt es nicht: ${roh}`, 404);
}

// Felder einer Aufgabe ändern. e: { titel?, status?, prioritaet?, faellig?, rang?, bezug?, text? } plus platz: { davor, danach } (Pfade) für die Stelle in der
// Spalte. basisText: Text, den der Aufrufer gesehen hat (nur wenn er Änderungen von anderswo erkennen will; sonst gilt immer der aktuelle Stand).
// Gibt { pfad, aufgabe, geaendert: [pfad …] } zurück (geaendert nennt auch Karten, die beim Neu-Nummerieren mitgezogen wurden).
export function aendere(vault, pfad, e, { jetzt = new Date(), basisText } = {}) {
  const { platz, ...rest } = e || {};
  const f = pruefeEingabe(rest);
  const o = ordnerAbs(vault);
  if (!o.da) throw new AufgabeFehler("Diese Aufgabe gibt es nicht.", 404);
  const rel = String(pfad ?? "").replace(/\\/g, "/");
  const m = /^([^/]+)\/([^/]+\.md)$/i.exec(rel);
  if (!m || m[1] !== o.name || m[2].startsWith(".") || m[2].startsWith("_")) throw new AufgabeFehler("Das ist keine Aufgabe in diesem Vault.", 400);
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
    const alle = liste(vault);
    if (platz) {
      const p = plane(alle.filter((a) => a.status === zielStatus), rel, platz.davor, platz.danach);
      f.rang = p.rang;
      for (const u of p.umnummerieren) {
        const fabs = join(o.abs, u.pfad.split("/").pop());
        const t = leseDatei(fabs);
        if (t !== null) { schreibeAtomar(fabs, setzeFelder(t, { rang: u.rang }, jetzt)); geaendert.push(u.pfad); }
      }
    } else f.rang = rangAmEnde(alle.filter((a) => a.pfad !== rel), zielStatus);
  }
  schreibeAtomar(abs, setzeFelder(text, f, jetzt));
  return { pfad: rel, aufgabe: parseAufgabe(readFileSync(abs, "utf8"), rel), geaendert };
}

export const zaehle = (vault, heute) => zaehleAus(liste(vault), heute);
