// Formatieren im Editor (Runde 3b): fett, kursiv, Code, durchgestrichen, Link, Überschriften, Listen — als Umschalter auf Auswahl bzw. am Cursor —
// und Einfügen aus der Zwischenablage (HTML → Markdown, ⇧⌘V als reiner Text, Link auf Auswahl). Eigenes Modul, damit editor.js klein bleibt.
// Die Befehle ändern nur den Text (Markdown-Zeichen); sie gelten in der Vorschau wie im Rohtext. Das Kürzel kommt aus dem Register (tastenkuerzel-register.json),
// die Anmeldung steht in app.js; hier gibt es keine Tasten.
import * as CM from "./vendor/codemirror.bundle.js";
import { htmlZuMarkdown, hatStruktur } from "./html-markdown.js";

const { EditorSelection, Text } = CM;

// Marken der Auszeichnungen und der Knoten, in denen sie im Markdown-Baum stehen
export const MARKEN = {
  fett: { marke: "**", knoten: "StrongEmphasis", zeichen: "EmphasisMark" },
  kursiv: { marke: "*", knoten: "Emphasis", zeichen: "EmphasisMark" },
  durch: { marke: "~~", knoten: "Strikethrough", zeichen: "StrikethroughMark" },
  code: { marke: "`", knoten: "InlineCode", zeichen: "CodeMark" },
};

// Der kleinste Knoten dieser Art, der [von, bis] umschließt (auch wenn der Rand genau an der Marke liegt)
function umschliessend(state, name, von, bis) {
  const baum = CM.syntaxTree(state);
  for (const seite of [1, -1, 0]) {
    for (let n = baum.resolveInner(von, seite); n; n = n.parent) if (n.name === name && n.from <= von && n.to >= bis) return n;
  }
  return null;
}
const markenDe = (knoten, zeichen) => { const m = []; for (let c = knoten.firstChild; c; c = c.nextSibling) if (c.name === zeichen) m.push(c); return m; };

// Zeilenweise Teilstücke der Auswahl ohne Leerraum am Rand (Markdown-Marken dürfen nicht an Leerzeichen kleben)
function stuecke(state, von, bis) {
  const aus = [];
  for (let l = state.doc.lineAt(von); ; l = state.doc.line(l.number + 1)) {
    const a = Math.max(von, l.from), b = Math.min(bis, l.to);
    const t = state.doc.sliceString(a, b);
    const lead = t.length - t.trimStart().length, trail = t.length - t.trimEnd().length;
    if (t.trim()) aus.push([a + lead, b - trail]);
    if (l.to >= bis || l.number >= state.doc.lines) break;
  }
  return aus;
}

// Umschalter für fett/kursiv/durchgestrichen/Code. → Transaktionsangabe (changes, selection) oder null
export function umschalten(state, art) {
  const { marke, knoten, zeichen } = MARKEN[art];
  return state.changeByRange((r) => {
    // 1. Liegt die Auswahl schon in einer solchen Auszeichnung: Marken entfernen
    const k = umschliessend(state, knoten, r.from, r.to);
    if (k) {
      const m = markenDe(k, zeichen);
      if (m.length >= 2) {
        const erste = m[0], letzte = m[m.length - 1];
        const changes = [{ from: erste.from, to: erste.to }, { from: letzte.from, to: letzte.to }];
        const cs = state.changes(changes);
        return { changes, range: EditorSelection.range(cs.mapPos(r.anchor, 1), cs.mapPos(r.head, -1)) };
      }
    }
    // 2. Leere Auswahl: das Wort am Cursor, sonst zwei Marken mit Cursor dazwischen
    let von = r.from, bis = r.to;
    if (r.empty) {
      const w = state.wordAt(r.head);
      if (w) { von = w.from; bis = w.to; }
      else { const t = marke + marke; return { changes: { from: r.head, insert: t }, range: EditorSelection.cursor(r.head + marke.length) }; }
    }
    const teile = stuecke(state, von, bis);
    if (!teile.length) return { range: r };
    const rahmen = art === "code" && state.doc.sliceString(von, bis).includes("`") ? "``" : marke;
    const changes = teile.flatMap(([a, b]) => [{ from: a, insert: rahmen }, { from: b, insert: rahmen }]);
    const cs = state.changes(changes);
    return { changes, range: EditorSelection.range(cs.mapPos(teile[0][0], 1), cs.mapPos(teile[teile.length - 1][1], -1)) };
  });
}

// ---- Zeilenbefehle (Überschrift, Liste)
const KOPF = /^(#{1,6})[ \t]+/;
const LISTE = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/;
const AUFGABE = /^([ \t]*)[-*+][ \t]+\[[ xX]\][ \t]+/;
const PUNKT = /^([ \t]*)[-*+][ \t]+(?!\[[ xX]\][ \t])/;
const NUMMER = /^([ \t]*)\d+[.)][ \t]+/;

// Zeilen der Auswahl (jede nur einmal; ohne die Zeile, in der eine mehrzeilige Auswahl am Anfang endet)
function auswahlZeilen(state) {
  const nr = new Set();
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number;
    let b = state.doc.lineAt(r.to).number;
    if (!r.empty && b > a && r.to === state.doc.line(b).from) b--;
    for (let n = a; n <= b; n++) nr.add(n);
  }
  return [...nr].sort((x, y) => x - y).map((n) => state.doc.line(n));
}
export function ueberschriftAmCursor(state) {
  const l = state.doc.lineAt(state.selection.main.head);
  const m = KOPF.exec(l.text);
  return m ? m[1].length : 0;
}
// Nur der Zeilenanfang wird ersetzt (der Text der Zeile bleibt unberührt, der Cursor wandert mit nach hinten)
function anfaenge(state, liste) {
  const changes = liste.filter((c) => state.doc.sliceString(c.from, c.to) !== c.insert);
  if (!changes.length) return null;
  const cs = state.changes(changes);
  return { changes: cs, selection: EditorSelection.create(state.selection.ranges.map((r) => EditorSelection.range(cs.mapPos(r.anchor, 1), cs.mapPos(r.head, 1))), state.selection.mainIndex), userEvent: "input.format" };
}
export function ueberschrift(state, stufe) {
  const zeilen = auswahlZeilen(state).filter((l) => l.text.trim() || zeilen0(state));
  const aktuell = zeilen.filter((l) => l.text.trim()).map((l) => (KOPF.exec(l.text)?.[1].length || 0));
  const ziel = aktuell.length && aktuell.every((s) => s === stufe) ? 0 : stufe; // war es schon so: zurück zum Absatz
  return anfaenge(state, zeilen.map((l) => {
    const m = KOPF.exec(l.text) || LISTE.exec(l.text);
    return { from: l.from, to: l.from + (m ? m[0].length : 0), insert: ziel ? "#".repeat(ziel) + " " : "" };
  }));
}
const zeilen0 = (state) => state.selection.ranges.every((r) => r.empty); // der Cursor allein in einer leeren Zeile darf sie zur Überschrift machen

const MARKE_LISTE = { punkt: PUNKT, nummer: NUMMER, aufgabe: AUFGABE };
export function artAmCursor(state) {
  const l = state.doc.lineAt(state.selection.main.head).text;
  return AUFGABE.test(l) ? "aufgabe" : PUNKT.test(l) ? "punkt" : NUMMER.test(l) ? "nummer" : null;
}
export function liste(state, art) {
  const alle = auswahlZeilen(state);
  const zeilen = alle.filter((l) => l.text.trim() || (alle.length === 1));
  if (!zeilen.length) return null;
  const befuellt = zeilen.filter((l) => l.text.trim());
  const schonSo = befuellt.length > 0 && befuellt.every((l) => MARKE_LISTE[art].test(l.text));
  let n = 0;
  return anfaenge(state, zeilen.map((l) => {
    const m = LISTE.exec(l.text) || KOPF.exec(l.text);
    const einzug = /^[ \t]*/.exec(l.text)[0];
    const alt = m ? m[0].length : einzug.length;
    if (schonSo) return { from: l.from, to: l.from + alt, insert: einzug };
    n++;
    return { from: l.from, to: l.from + alt, insert: einzug + (art === "nummer" ? `${n}. ` : art === "aufgabe" ? "- [ ] " : "- ") };
  }));
}

// ---- Link
const ADRESSE = /^(https?:\/\/|mailto:)\S+$/i;
export function link(state) {
  return state.changeByRange((r) => {
    // Liegt die Auswahl in einem Link: den Link auflösen, der Text bleibt
    const k = umschliessend(state, "Link", r.from, r.to);
    if (k) {
      const marken = [];
      for (let c = k.firstChild; c; c = c.nextSibling) marken.push(c);
      const zu = marken.find((c) => c.name === "LinkMark" && state.doc.sliceString(c.from, c.to) === "]");
      const auf = marken[0];
      if (auf?.name === "LinkMark" && zu) {
        const changes = [{ from: auf.from, to: auf.to }, { from: zu.from, to: k.to }];
        const cs = state.changes(changes);
        return { changes, range: EditorSelection.range(cs.mapPos(r.anchor, 1), cs.mapPos(r.head, -1)) };
      }
    }
    const text = state.doc.sliceString(r.from, r.to);
    if (!r.empty && ADRESSE.test(text.trim())) { // markierte Adresse: Link mit Platzhaltertext, der Text ist gleich zum Überschreiben markiert
      const neu = `[Linktext](${text.trim()})`;
      return { changes: { from: r.from, to: r.to, insert: neu }, range: EditorSelection.range(r.from + 1, r.from + 1 + "Linktext".length) };
    }
    if (!r.empty) { // Text markiert: die Adresse kommt dahinter, der Platzhalter ist markiert
      const neu = `[${text}](https://)`;
      const a = r.from + text.length + 3;
      return { changes: { from: r.from, to: r.to, insert: neu }, range: EditorSelection.range(a, a + "https://".length) };
    }
    const w = state.wordAt(r.head);
    if (w) { const t = state.doc.sliceString(w.from, w.to); const a = w.from + t.length + 3; return { changes: { from: w.from, to: w.to, insert: `[${t}](https://)` }, range: EditorSelection.range(a, a + "https://".length) }; }
    return { changes: { from: r.head, insert: "[Linktext](https://)" }, range: EditorSelection.range(r.head + 1, r.head + 1 + "Linktext".length) };
  });
}

// ---- Befehle auf einer View
const sende = (view, spec) => { if (!spec || view.state.readOnly) return false; view.dispatch({ ...spec, userEvent: spec.userEvent || "input.format", scrollIntoView: true }); view.focus(); return true; };
export const BEFEHLE = {
  fett: (v) => sende(v, umschalten(v.state, "fett")),
  kursiv: (v) => sende(v, umschalten(v.state, "kursiv")),
  code: (v) => sende(v, umschalten(v.state, "code")),
  durchgestrichen: (v) => sende(v, umschalten(v.state, "durch")),
  link: (v) => sende(v, link(v.state)),
  ueberschrift1: (v) => sende(v, ueberschrift(v.state, 1)),
  ueberschrift2: (v) => sende(v, ueberschrift(v.state, 2)),
  ueberschrift3: (v) => sende(v, ueberschrift(v.state, 3)),
  ueberschrift4: (v) => sende(v, ueberschrift(v.state, 4)),
  listePunkt: (v) => sende(v, liste(v.state, "punkt")),
  listeNummer: (v) => sende(v, liste(v.state, "nummer")),
  listeAufgabe: (v) => sende(v, liste(v.state, "aufgabe")),
};

// Welche Auszeichnungen gelten an der Auswahl? (für die Format-Leiste) → { fett, kursiv, durch, code, link, ueberschrift, liste }
export function zustandAnAuswahl(state) {
  const r = state.selection.main;
  const z = { ueberschrift: ueberschriftAmCursor(state), liste: artAmCursor(state), link: !!umschliessend(state, "Link", r.from, r.to) };
  for (const [k, m] of Object.entries(MARKEN)) z[k] = !!umschliessend(state, m.knoten, r.from, r.to);
  return z;
}

// ---- Einfügen
// merker: ⇧⌘V (Befehl „Als reinen Text einfügen“) merkt sich für einen Augenblick, dass das nächste Einfügen reiner Text sein soll
const NUR_TEXT_MS = 1500;
let nurTextBis = 0;
export const merkeNurText = () => { nurTextBis = Date.now() + NUR_TEXT_MS; };
export const vergissNurText = () => { nurTextBis = 0; };
export const nurTextAktiv = () => Date.now() < nurTextBis;

const imCode = (state, pos) => {
  for (let n = CM.syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) if (n.name === "FencedCode" || n.name === "InlineCode" || n.name === "CodeBlock") return true;
  return false;
};
const alsDokumentText = (state, text) => text.replace(/\r\n|\r|\n/g, state.lineBreak);

export function fuegeTextEin(view, text) {
  if (view.state.readOnly) return false;
  view.dispatch({ ...view.state.replaceSelection(view.state.toText(alsDokumentText(view.state, text))), userEvent: "input.paste", scrollIntoView: true });
  return true;
}

// Erweiterung: Einfügen. ctx.bildEinfuegen?.(datei, view) → true, wenn die Anwendung ein Bild selbst ablegt (Anhänge); ctx.bildAdresse?.(src, alt) → Markdown für ein eingebettetes Bild
export function einfuegenErweiterung(ctx = {}) {
  return CM.EditorView.domEventHandlers({
    paste(e, view) {
      const cd = e.clipboardData;
      if (!cd || view.state.readOnly) return false;
      const html = cd.getData("text/html"), text = cd.getData("text/plain");
      const pos = view.state.selection.main.head;
      if (nurTextAktiv()) {
        nurTextBis = 0;
        if (!text) return false;
        e.preventDefault(); return fuegeTextEin(view, text);
      }
      // Bild aus der Zwischenablage (Bildschirmfoto): die Anwendung legt es als Anhang ab; ohne sie bleibt nichts zu tun
      if (!text && !html && cd.files?.length && ctx.bildEinfuegen) {
        const datei = [...cd.files].find((f) => /^image\//.test(f.type));
        if (datei && ctx.bildEinfuegen(datei, view)) { e.preventDefault(); return true; }
      }
      const r = view.state.selection.main;
      // Adresse über markiertem Text: Link daraus machen
      if (!r.empty && ADRESSE.test(text.trim()) && !html.includes("<a ") && view.state.doc.lineAt(r.from).number === view.state.doc.lineAt(r.to).number && !imCode(view.state, r.from)) {
        e.preventDefault();
        const sel = view.state.sliceDoc(r.from, r.to);
        return fuegeTextEin(view, `[${sel}](${text.trim()})`);
      }
      if (!html || !hatStruktur(html) || imCode(view.state, pos)) return false; // sonst gilt der Standard (reiner Text)
      const md = htmlZuMarkdown(html, { bild: ctx.bildAdresse });
      if (!md) return false;
      e.preventDefault();
      // Ein Block (Tabelle, Überschrift, Liste) beginnt in einer eigenen Zeile
      const zeile = view.state.doc.lineAt(r.from);
      const vorne = /^(\||#{1,6} |[-*+] |\d+\. |```|>)/.test(md) && view.state.sliceDoc(zeile.from, r.from).trim() ? "\n\n" : "";
      return fuegeTextEin(view, vorne + md);
    },
  });
}

// Für Tests und die Format-Leiste: Text einer Transaktionsangabe anwenden, ohne View
export const wende = (state, spec) => (spec ? state.update(spec).state : state);
export { Text };
