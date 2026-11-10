// Schrägstrich-Menü: reine Regeln ohne Editor und ohne DOM (Erkennen des „/…“ in einer Zeile, unscharfes Filtern der Einträge).
import { falteText } from "./suchfalte.js";

export const MAX_FILTER = 24;
// „/“ am Zeilenanfang oder nach Leerraum, danach der Filter (ohne Leerzeichen und ohne weiteren „/“) bis zum Cursor
const AM_ENDE = new RegExp(`(^|\\s)\\/([\\p{L}\\p{N}_+\\-]{0,${MAX_FILTER}})$`, "u");
const WORTZEICHEN = /[\p{L}\p{N}_]/u;

// vor: Text der Zeile bis zum Cursor, nach: Rest der Zeile. → { vonSpalte, filter } (Spalte des „/“ in der Zeile) oder null
export function findeAusloeser(vor, nach = "") {
  const m = AM_ENDE.exec(vor);
  if (!m) return null;
  if (nach && WORTZEICHEN.test(nach[0])) return null; // der Cursor steht mitten in einem Wort („/h|allo“)
  return { vonSpalte: m.index + m[1].length, filter: m[2] };
}

// Wortanfänge: „ueberschrift 2“ → Anfänge der Wörter
const anfaengeVon = (s) => { const a = []; for (const m of s.matchAll(/[^\s\-_]+/g)) a.push(m.index); return a; };
const istTeilfolge = (frage, text) => { let i = 0; for (const z of text) if (z === frage[i] && ++i === frage.length) return true; return false; };

// Wert 0 = kein Treffer; sonst je höher, desto besser
function wert(frage, text) {
  if (text === frage) return 100;
  if (text.startsWith(frage)) return 90;
  if (anfaengeVon(text).some((i) => text.startsWith(frage, i))) return 70;
  if (text.includes(frage)) return 50;
  if (frage.length >= 3 && text[0] === frage[0] && istTeilfolge(frage, text)) return 20;
  return 0;
}

// eintraege: [{ titel, woerter: [], ... }] → gefilterte Liste, beste zuerst (bei gleichem Wert bleibt die Reihenfolge des Menüs). Leere Frage: alle.
export function filtere(eintraege, frage) {
  const f = falteText(String(frage || "").trim());
  if (!f) return eintraege.slice();
  const bewertet = [];
  eintraege.forEach((e, i) => {
    const titel = wert(f, falteText(e.titel));
    const anders = Math.max(0, ...(e.woerter || []).map((w) => wert(f, falteText(w)) * 0.9));
    const w = Math.max(titel, anders);
    if (w > 0) bewertet.push({ e, w, i });
  });
  return bewertet.sort((a, b) => b.w - a.w || a.i - b.i).map((x) => x.e);
}

// Lokales Datum JJJJ-MM-TT (Berliner Zeit = Zeit des Geräts)
export function heuteText(d = new Date()) {
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

// ---- Änderungen an der Zeile / als Block (auf einem Zustand OHNE das „/…“)
const PRAEFIX = /^[ \t]*(?:#{1,6}[ \t]+|(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?|>[ \t]?)/;
export const ZEILEN_ARTEN = { text: "", h1: "# ", h2: "## ", h3: "### ", aufgabe: "- [ ] ", punkt: "- ", nummer: "1. ", zitat: "> " };

// Setzt den Zeilenanfang der Cursorzeile (ersetzt Überschrift-, Listen- oder Zitatzeichen; Einzug bleibt bei Listen und Zitat). → { changes, selection } oder null
export function zeilenAenderung(state, art, EditorSelection) {
  const zeile = state.doc.lineAt(state.selection.main.head);
  const m = PRAEFIX.exec(zeile.text);
  const einzug = /^[ \t]*/.exec(zeile.text)[0];
  const behalteEinzug = art === "aufgabe" || art === "punkt" || art === "nummer" || art === "zitat";
  const neu = (behalteEinzug ? einzug : "") + ZEILEN_ARTEN[art];
  const bis = m ? m[0].length : einzug.length;
  const changes = state.changes([{ from: zeile.from, to: zeile.from + bis, insert: neu }].filter((c) => state.sliceDoc(c.from, c.to) !== c.insert));
  return { changes, selection: EditorSelection.cursor(changes.mapPos(state.selection.main.head, 1)) };
}

// Ein Block (Codezaun, Trennlinie) in einer eigenen Absatzgruppe: Steht in der Zeile Text, kommt er dahinter, sonst an ihre Stelle.
// cursorImBlock: Zeichenzahl ab Blockanfang, bei der der Cursor steht; null = hinter dem Block (in der Folgezeile)
export function blockAenderung(state, text, cursorImBlock, EditorSelection) {
  const lb = state.lineBreak, doc = state.doc;
  const zeile = doc.lineAt(state.selection.main.head);
  const nachfolger = zeile.number < doc.lines ? doc.line(zeile.number + 1) : null;
  let pos, vorne = "", hinten = "";
  if (zeile.text.trim()) { pos = zeile.to; vorne = lb + lb; hinten = nachfolger && !nachfolger.text.trim() ? "" : lb; }
  else {
    pos = zeile.from;
    const vor = zeile.number > 1 ? doc.line(zeile.number - 1) : null;
    if (vor && vor.text.trim()) vorne = lb;
    hinten = lb;
  }
  const t = text.replace(/\n/g, lb);
  const von = pos + vorne.length;
  const ende = cursorImBlock == null ? von + t.length + lb.length : von + cursorImBlock;
  return { changes: state.changes({ from: pos, insert: vorne + t + hinten }), selection: EditorSelection.cursor(ende) };
}
