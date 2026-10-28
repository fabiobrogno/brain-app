// gemeinsam/nutzung.mjs — lokale Nutzungsmessung (FBL-72): welche Seiten die KI per MCP abruft.
// Der MCP-Server hängt je Werkzeugaufruf eine Zeile an <vault>/.logs/mcp.log, im Format des Kits (hint.log):
//   <UTC-Zeit, 19 Zeichen> sid=mcp werkzeug=brain_lesen hits=<encodeURIComponent(Seiten, Tab-getrennt)>|- ms=<n> ok=<0|1>
// `hits=` ist dasselbe Feld wie im Hinweis-Log des Kits; das Kit kann diese Datei später mit seinem hitsSeiten() mitzählen.
// Ohne Telemetrie: nichts verlässt den Rechner, die Datei liegt in .logs/ (per .gitignore nicht im Git). Gespeichert werden nur
// Werkzeugname und Seitenpfade — nie Suchbegriffe, Texte oder Inhalte. Schreibfehler sind still (ein Protokoll darf nie eine
// MCP-Antwort brechen); gelesen wird defensiv (kaputte Zeilen werden übersprungen).
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const LOG_ORDNER = ".logs";
export const LOG_DATEI = "mcp.log";
// Rotation wie beim Hinweis-Log des Kits: erst ab ~150 KB lesen; über 2000 Zeilen → die letzten 1000 behalten.
export const ROTATION = { bytes: 150_000, max: 2000, behalte: 1000 };
const MAX_SEITEN_JE_ZEILE = 20;
const MAX_LESEN = 2 * 1024 * 1024; // so große Dateien liest die Auswertung höchstens (Rotation hält sie weit darunter)

const sauberesWerkzeug = (w) => String(w || "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 40) || "unbekannt";

// Hängt eine Zeile an und rotiert. Wirft nie.
export function protokolliere(wurzel, eintrag) {
  try {
    const { werkzeug, seiten = [], ok = true, ms = 0, jetzt = new Date() } = eintrag || {};
    const liste = [...new Set((Array.isArray(seiten) ? seiten : []).filter((s) => typeof s === "string" && s && !/[\t\r\n]/.test(s)))].slice(0, MAX_SEITEN_JE_ZEILE);
    const hits = liste.length ? encodeURIComponent(liste.join("\t")) : "-";
    const dauer = Number.isFinite(ms) && ms >= 0 ? Math.round(ms) : 0;
    const ordner = join(wurzel, LOG_ORDNER);
    const datei = join(ordner, LOG_DATEI);
    mkdirSync(ordner, { recursive: true });
    appendFileSync(datei, `${jetzt.toISOString().slice(0, 19)} sid=mcp werkzeug=${sauberesWerkzeug(werkzeug)} hits=${hits} ms=${dauer} ok=${ok ? 1 : 0}\n`);
    if (statSync(datei).size > ROTATION.bytes) {
      const zeilen = readFileSync(datei, "utf8").split("\n").filter(Boolean);
      if (zeilen.length > ROTATION.max) {
        const tmp = `${datei}.${process.pid}.tmp`;
        writeFileSync(tmp, zeilen.slice(-ROTATION.behalte).join("\n") + "\n");
        try { renameSync(tmp, datei); } catch { try { unlinkSync(tmp); } catch { /* egal */ } }
      }
    }
  } catch { /* Protokoll ist Beiwerk */ }
}

// Zerlegt das hits=-Feld wie hitsSeiten() des Kits (neu: ein URI-kodiertes Token mit Tab als Trenner; alt: je Seite kodiert, Komma).
export function seitenAusHits(roh) {
  const r = String(roh ?? "");
  if (!r || r === "-") return [];
  const dek = (x) => { try { return decodeURIComponent(x); } catch { return x; } };
  const ganz = dek(r);
  return (ganz.includes("\t") ? ganz.split("\t") : r.split(",").map(dek)).map((t) => t.trim()).filter(Boolean);
}

// Liest das Protokoll → [{ zeit (ms), zeitIso, werkzeug, seiten, ok }]. Fehlende oder kaputte Datei → [].
export function leseProtokoll(wurzel) {
  let inhalt;
  try {
    const datei = join(wurzel, LOG_ORDNER, LOG_DATEI);
    const st = statSync(datei);
    if (!st.isFile() || st.size > MAX_LESEN) return [];
    inhalt = readFileSync(datei, "utf8");
  } catch { return []; }
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

// Auswertung: meistgenutzte Seiten (nach Abrufen, dann zuletzt) und Wiki-Seiten, die im Protokoll nie vorkommen.
// wikiSeiten = die Seiten, die als „nie genutzt“ in Frage kommen (der Aufrufer filtert Generiertes heraus).
export function wertAus(wurzel, wikiSeiten = [], { top = 10, maxNie = 50 } = {}) {
  const zeilen = leseProtokoll(wurzel);
  const wiki = [...new Set(wikiSeiten)].sort((a, b) => a.localeCompare(b, "de"));
  if (!zeilen.length) return { protokoll: false, aufrufe: 0, seit: null, bis: null, werkzeuge: {}, meistgenutzt: [], nieGenutzt: [], nieGenutztGesamt: 0, wikiSeiten: wiki.length };
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
  const zeiten = zeilen.map((z) => z.zeit);
  return {
    protokoll: true, aufrufe, seit: zeilen.find((z) => z.zeit === Math.min(...zeiten)).zeitIso, bis: zeilen.find((z) => z.zeit === Math.max(...zeiten)).zeitIso,
    werkzeuge, meistgenutzt: meist, nieGenutzt: nie.slice(0, maxNie), nieGenutztGesamt: nie.length, wikiSeiten: wiki.length,
  };
}
