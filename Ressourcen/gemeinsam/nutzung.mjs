// gemeinsam/nutzung.mjs — lokale Nutzungsmessung (FBL-72): welche Seiten die KI per MCP abruft.
// Der MCP-Server hängt je Werkzeugaufruf eine Zeile an <vault>/.logs/mcp.log, im Format des Kits (hint.log):
//   <UTC-Zeit, 19 Zeichen> sid=mcp werkzeug=brain_lesen hits=<encodeURIComponent(Seiten, Tab-getrennt)>|- ms=<n> ok=<0|1>
// `hits=` ist dasselbe Feld wie im Hinweis-Log des Kits; das Kit kann diese Datei später mit seinem hitsSeiten() mitzählen.
// Ohne Telemetrie: nichts verlässt den Rechner. Gespeichert werden nur Werkzeugname und Seitenpfade — nie Suchbegriffe, Texte oder
// Inhalte. Die App-eigene Probe-Frage und der Selbsttest laufen mit BRAIN_NUTZUNG=aus und zählen nicht als KI-Nutzung.
//
// Git: Wo .gitignore `.logs/` nicht kennt, würde die Datei im Commit-Dialog auftauchen. Darum legt protokolliere() mit dem Ordner
// `.logs/.gitignore` (Inhalt `*`) an; die Datei ignoriert auch sich selbst, `git status` bleibt sauber.
// Schreiben: Symlinks (Ordner oder Datei) werden nie verfolgt. Fehler sind still — ein Protokoll darf nie eine MCP-Antwort brechen.
// Lesen: fehlende Datei = leer; eine Datei, die da ist und sich nicht lesen lässt, ist ein Fehler (wertAus meldet ihn), nie „leer“.
// Rotation: nach Zeilen (> 2000 → die letzten 1000) UND nach Größe (> 1 MB → hinten höchstens 512 KB behalten), damit lange Zeilen
// (Suche mit 20 Treffern) die Lesegrenze nie überschreiten; gelesen werden notfalls nur die letzten 2 MB.
// Bekannte Grenze: Mehrere MCP-Server-Prozesse (je KI-Client einer) rotieren ohne Sperre. Eine Zeile, die genau zwischen Lesen und
// Umbenennen eines anderen Prozesses angehängt wird, geht verloren — bei einem Zählprotokoll hinnehmbar, bewusst keine Sperrdatei.
import { openSync, closeSync, writeSync, readSync, fstatSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, constants } from "node:fs";
import { join } from "node:path";

export const LOG_ORDNER = ".logs";
export const LOG_DATEI = "mcp.log";
export const ROTATION = { bytes: 150_000, max: 2000, behalte: 1000, harteGrenze: 1_000_000, zielBytes: 512 * 1024 };
const MAX_SEITEN_JE_ZEILE = 20;
const MAX_LESEN = 2 * 1024 * 1024;

const sauberesWerkzeug = (w) => String(w || "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 40) || "unbekannt";
const nurOrdner = (p) => { try { const s = lstatSync(p); return s.isDirectory() && !s.isSymbolicLink(); } catch { return false; } };

// Hängt eine Zeile an und rotiert. Wirft nie.
export function protokolliere(wurzel, eintrag) {
  try {
    const { werkzeug, seiten = [], ok = true, ms = 0, jetzt = new Date() } = eintrag || {};
    const liste = [...new Set((Array.isArray(seiten) ? seiten : []).filter((s) => typeof s === "string" && s && !/[\t\r\n]/.test(s)))].slice(0, MAX_SEITEN_JE_ZEILE);
    const hits = liste.length ? encodeURIComponent(liste.join("\t")) : "-";
    const dauer = Number.isFinite(ms) && ms >= 0 ? Math.round(ms) : 0;
    const ordner = join(wurzel, LOG_ORDNER);
    const datei = join(ordner, LOG_DATEI);
    try { lstatSync(ordner); } catch { mkdirSync(ordner, { recursive: true }); }
    if (!nurOrdner(ordner)) return; // Symlink oder Datei statt Ordner: nichts schreiben
    try { writeFileSync(join(ordner, ".gitignore"), "*\n", { flag: "wx" }); } catch { /* gibt es schon */ }
    const fd = openSync(datei, constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | (constants.O_NOFOLLOW || 0), 0o644);
    let groesse;
    try {
      writeSync(fd, `${jetzt.toISOString().slice(0, 19)} sid=mcp werkzeug=${sauberesWerkzeug(werkzeug)} hits=${hits} ms=${dauer} ok=${ok ? 1 : 0}\n`);
      groesse = fstatSync(fd).size;
    } finally { closeSync(fd); }
    if (groesse > ROTATION.bytes) rotiere(datei, groesse);
  } catch { /* Protokoll ist Beiwerk */ }
}

function rotiere(datei, groesse) {
  if (!lstatSync(datei).isFile()) return;
  const zeilen = readFileSync(datei, "utf8").split("\n").filter(Boolean);
  if (zeilen.length <= ROTATION.max && groesse <= ROTATION.harteGrenze) return;
  let behalten = zeilen.slice(-ROTATION.behalte);
  let bytes = behalten.reduce((n, z) => n + Buffer.byteLength(z) + 1, 0);
  let weg = 0;
  while (bytes > ROTATION.zielBytes && weg < behalten.length - 1) { bytes -= Buffer.byteLength(behalten[weg]) + 1; weg++; }
  behalten = behalten.slice(weg);
  const tmp = `${datei}.${process.pid}.tmp`;
  writeFileSync(tmp, behalten.join("\n") + "\n");
  try { renameSync(tmp, datei); } catch { try { unlinkSync(tmp); } catch { /* egal */ } }
}

// Zerlegt das hits=-Feld wie hitsSeiten() des Kits (neu: ein URI-kodiertes Token mit Tab als Trenner; alt: je Seite kodiert, Komma).
export function seitenAusHits(roh) {
  const r = String(roh ?? "");
  if (!r || r === "-") return [];
  const dek = (x) => { try { return decodeURIComponent(x); } catch { return x; } };
  const ganz = dek(r);
  return (ganz.includes("\t") ? ganz.split("\t") : r.split(",").map(dek)).map((t) => t.trim()).filter(Boolean);
}

// Liest das Protokoll → [{ zeit (ms), zeitIso, werkzeug, seiten, ok }]. Fehlende Datei → []. Eine vorhandene, aber nicht lesbare Datei
// (Symlink, kein normaler Ordner/Datei, Rechte) wirft. Ist sie größer als MAX_LESEN, zählen die letzten 2 MB.
export function leseProtokoll(wurzel) {
  const ordner = join(wurzel, LOG_ORDNER);
  const datei = join(ordner, LOG_DATEI);
  let ls;
  try { if (!lstatSync(ordner).isDirectory()) throw new Error("kein Ordner"); } catch (e) {
    if (e && e.code === "ENOENT") return [];
    throw new Error("Das Protokoll liegt nicht in einem normalen Ordner (.logs ist ein Verweis oder eine Datei) und wird nicht gelesen.");
  }
  try { ls = lstatSync(datei); } catch (e) { if (e && e.code === "ENOENT") return []; throw new Error("Das Protokoll ließ sich nicht öffnen."); }
  if (!ls.isFile()) throw new Error("Das Protokoll ist keine normale Datei und wird nicht gelesen.");
  let inhalt;
  try {
    const fd = openSync(datei, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const st = fstatSync(fd);
      const n = Math.min(st.size, MAX_LESEN);
      const puffer = Buffer.alloc(n);
      let gelesen = 0;
      while (gelesen < n) { const k = readSync(fd, puffer, gelesen, n - gelesen, st.size - n + gelesen); if (!k) break; gelesen += k; }
      inhalt = puffer.subarray(0, gelesen).toString("utf8");
      if (st.size > MAX_LESEN) inhalt = inhalt.slice(inhalt.indexOf("\n") + 1); // angeschnittene erste Zeile weg
    } finally { closeSync(fd); }
  } catch { throw new Error("Das Protokoll ließ sich nicht lesen."); }
  const aus = [];
  for (const z of inhalt.split(/\r?\n/)) {
    const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}) /.exec(z);
    if (!m) continue;
    const zeit = Date.parse(`${m[1]}Z`);
    if (Number.isNaN(zeit)) continue;
    const feld = (k) => { const x = new RegExp(`(?:^| )${k}=(\\S*)`).exec(z); return x ? x[1] : ""; };
    aus.push({ zeit, zeitIso: `${m[1]}Z`, werkzeug: feld("werkzeug") || "unbekannt", seiten: seitenAusHits(feld("hits")), ok: feld("ok") !== "0" });
  }
  return aus;
}

// Auswertung: meistgenutzte Seiten (nach Aufrufen, dann zuletzt) und Wiki-Seiten, die im Protokoll nie vorkommen.
// wikiSeiten = die Seiten, die als „nie genutzt“ in Frage kommen (der Aufrufer filtert Generiertes heraus).
// Ist das Protokoll nicht lesbar: { fehler: "…" } statt „leer“ — die Oberfläche zeigt den Fehler.
export function wertAus(wurzel, wikiSeiten = [], { top = 10, maxNie = 50 } = {}) {
  const wiki = [...new Set(wikiSeiten)].sort((a, b) => a.localeCompare(b, "de"));
  const leer = { protokoll: false, fehler: null, aufrufe: 0, seit: null, bis: null, werkzeuge: {}, meistgenutzt: [], nieGenutzt: [], nieGenutztGesamt: 0, wikiSeiten: wiki.length };
  let zeilen;
  try { zeilen = leseProtokoll(wurzel); } catch (e) { return { ...leer, fehler: String((e && e.message) || e) }; }
  if (!zeilen.length) return leer;
  const zaehler = new Map();
  const werkzeuge = {};
  let aufrufe = 0;
  for (const z of zeilen) {
    if (!z.ok) continue;
    aufrufe++;
    werkzeuge[z.werkzeug] = (werkzeuge[z.werkzeug] || 0) + 1;
    for (const s of new Set(z.seiten)) {
      const e = zaehler.get(s) || { pfad: s, anzahl: 0, zuletzt: 0 };
      e.anzahl++; if (z.zeit > e.zuletzt) e.zuletzt = z.zeit;
      zaehler.set(s, e);
    }
  }
  const meist = [...zaehler.values()].sort((a, b) => b.anzahl - a.anzahl || b.zuletzt - a.zuletzt || a.pfad.localeCompare(b.pfad, "de"))
    .slice(0, top).map((e) => ({ pfad: e.pfad, anzahl: e.anzahl, zuletzt: new Date(e.zuletzt).toISOString().slice(0, 19) + "Z" }));
  const nie = wiki.filter((p) => !zaehler.has(p));
  const erste = zeilen.reduce((a, z) => (z.zeit < a.zeit ? z : a)), letzte = zeilen.reduce((a, z) => (z.zeit > a.zeit ? z : a));
  return { ...leer, protokoll: true, aufrufe, seit: erste.zeitIso, bis: letzte.zeitIso, werkzeuge, meistgenutzt: meist, nieGenutzt: nie.slice(0, maxNie), nieGenutztGesamt: nie.length };
}
