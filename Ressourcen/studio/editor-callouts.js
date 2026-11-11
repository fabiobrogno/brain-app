// Callouts im Editor (R4-2): `> [!typ] Titel` als farbiger Hinweiskasten mit Symbol, faltbar mit `-` / `+`.
// Reine Darstellung per Dekoration: der Text bleibt bytegleich. Zeilenhöhe und Einrückung ändern sich nie, wenn der Cursor hineinläuft:
// die Zitatmarken `>` der Folgezeilen sind unsichtbar statt entfernt (gleiche Breite), nur die Kopfzeile wechselt zwischen Symbol+Titel und Rohtext.
// Ein zugeklapptes Callout versteckt seinen Rumpf (atomar, wie der Datei-Kopf); Klick auf Symbol oder Pfeil klappt es auf und zu, Mod-Alt-[ / Mod-Alt-] per Tastatur.
import * as CM from "./vendor/codemirror.bundle.js";
import { parseKopf, istZu, bekannt } from "./callout-logik.js";
import { T } from "./texte.js";

const { EditorState, StateField, StateEffect, Decoration, WidgetType, EditorView, Prec, keymap, EditorSelection } = CM;

const umschalten = StateEffect.define(); // Wert = Anfang des Callouts im Dokument
const fokusEffekt = StateEffect.define();

// Callouts auf oberster Ebene und in Listen (nicht in Zitaten): [{ von, bis, kopf, marken: [{ von, bis }], titelAb }]
export function findeCallouts(state) {
  const doc = state.doc, liste = [];
  CM.syntaxTree(state).iterate({
    enter: (n) => {
      if (n.name === "Document" || n.name === "BulletList" || n.name === "OrderedList" || n.name === "ListItem") return;
      if (n.name === "Blockquote") {
        const l1 = doc.lineAt(n.from);
        const kopf = parseKopf(doc.sliceString(n.from + 1, l1.to));
        if (kopf) {
          // Zitatmarken aller Zeilen (die der Folgezeilen stehen im Absatz, nicht direkt im Zitat), ohne die eines Zitats darin
          const marken = [], bq = n.from;
          CM.syntaxTree(state).iterate({ from: n.from, to: n.to, enter: (c) => {
            if (c.name === "Blockquote" && c.from !== bq) return false;
            if (c.name === "QuoteMark") marken.push({ von: c.from, bis: c.to });
          } });
          liste.push({ von: n.from, bis: n.to, kopf, marken, titelAb: Math.min(l1.to, n.from + 1 + kopf.titelVon) });
        }
      }
      return false;
    },
  });
  return liste;
}

// ---------- Symbole (24er Raster, Linie) ----------
const PFADE = {
  note: "M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z",
  abstract: "M9 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3 M9 2h6v4H9z M8 12h8 M8 16h5",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 16v-4 M12 8h.01",
  todo: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z m9 -10 2 2 4-4",
  tip: "M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5z",
  success: "M20 6 9 17l-5-5",
  question: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3 M12 17h.01",
  warning: "m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z M12 9v4 M12 17h.01",
  failure: "M18 6 6 18 M6 6l12 12",
  danger: "M13 2 3 14h9l-1 8 10-12h-9l1-8z",
  bug: "M8 2l1.9 1.9 M16 2l-1.9 1.9 M9 7V6a3 3 0 0 1 6 0v1 M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6z M12 20v-9 M6 13H2 M18 13h4 M6 17H3 M18 17h3 M6 9 3 7 M18 9l3-2",
  example: "M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01",
  quote: "M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z",
  pfeil: "m6 9 6 6 6-6",
};
function symbolEl(name, klasse) {
  const NS = "http://www.w3.org/2000/svg";
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("width", "16"); s.setAttribute("height", "16"); s.setAttribute("aria-hidden", "true");
  s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "2"); s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round");
  for (const d of PFADE[name].split(" M").map((x, i) => (i ? "M" + x : x))) { const p = document.createElementNS(NS, "path"); p.setAttribute("d", d); s.append(p); }
  if (klasse) s.setAttribute("class", klasse);
  return s;
}

const grossgeschrieben = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const standardTitel = (kopf) => (bekannt(kopf.typ) ? T.editor.callout.arten[kopf.art] : grossgeschrieben(kopf.typ));

class KopfWidget extends WidgetType {
  constructor(ref, art, titel, falt) { super(); this.ref = ref; this.art = art; this.titel = titel; this.falt = falt; }
  eq(o) { return o.art === this.art && o.titel === this.titel && o.falt === this.falt; }
  toDOM(view) {
    const d = document.createElement("span");
    d.className = "cm-callout-symbol";
    d.append(symbolEl(this.art));
    if (this.titel) { const t = document.createElement("span"); t.className = "cm-callout-titel"; t.textContent = this.titel; d.append(t); }
    if (this.falt) macheSchalter(d, view, this.ref);
    return d;
  }
  ignoreEvent() { return !!this.falt; }
}
class PfeilWidget extends WidgetType {
  constructor(ref, zu) { super(); this.ref = ref; this.zu = zu; }
  eq(o) { return o.zu === this.zu; }
  toDOM(view) {
    const d = document.createElement("span");
    d.className = "cm-callout-pfeil" + (this.zu ? " zu" : "");
    d.setAttribute("role", "button");
    d.setAttribute("aria-expanded", String(!this.zu));
    d.setAttribute("aria-label", this.zu ? T.editor.callout.aufklappen : T.editor.callout.zuklappen);
    d.append(symbolEl("pfeil"));
    d.tabIndex = 0;
    macheSchalter(d, view, this.ref);
    return d;
  }
  ignoreEvent() { return true; }
}

// Klick, Enter und Leertaste klappen auf und zu (mousedown hält den Cursor im Text); der Fokus geht danach in den Editor zurück
function macheSchalter(el, view, ref) {
  el.addEventListener("mousedown", (e) => e.preventDefault());
  el.addEventListener("click", (e) => { if (e.button === 0) schalte(view, view.posAtDOM(el), ref); });
  el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); schalte(view, view.posAtDOM(el), ref); view.focus(); } });
}

// Anfang des Callouts, zu dem ein Widget gehört (das Widget steht am Anfang der Kopfzeile)
function schalte(view, pos, ref) {
  const c = view.state.field(ref.feld).liste.find((x) => x.von === pos);
  if (c) view.dispatch({ effects: umschalten.of(c.von) });
}

// ---------- Dekorationen ----------
function baue(ref, state, liste, flips, fokus, roh) {
  if (roh || !liste.length) return { deko: Decoration.none, atomar: Decoration.none, zugeklappt: [] };
  const doc = state.doc;
  const aktiv = new Set();
  if (fokus) for (const r of state.selection.ranges) for (let n = doc.lineAt(r.from).number, e = doc.lineAt(r.to).number; n <= e; n++) aktiv.add(n);
  const alle = [], atomar = [], zugeklappt = [];
  for (const c of liste) {
    const l1 = doc.lineAt(c.von), l2 = doc.lineAt(c.bis);
    const { kopf } = c;
    const klasse = `cm-callout cm-callout-${kopf.art}`;
    const imRumpf = state.selection.ranges.some((r) => r.to > l1.to && r.from <= c.bis);
    const zu = istZu(kopf.falt, flips.has(c.von)) && !imRumpf && l2.number > l1.number;
    const titelDa = !!kopf.titel;
    const kopfAktiv = aktiv.has(l1.number);
    alle.push(Decoration.line({ class: klasse + " cm-callout-anfang" + (zu || l1.number === l2.number ? " cm-callout-ende" : "") + (kopf.falt ? " cm-callout-faltbar" : "") + (zu ? " cm-callout-zu" : "") }).range(l1.from));
    if (kopf.falt) alle.push(Decoration.widget({ widget: new PfeilWidget(ref, zu), side: -1 }).range(c.von));
    if (kopfAktiv) {
      alle.push(Decoration.mark({ class: "cm-marke" }).range(c.von, c.titelAb));
      if (titelDa) alle.push(Decoration.mark({ class: "cm-callout-titel" }).range(c.titelAb, l1.to));
    } else if (titelDa) {
      alle.push(Decoration.replace({ widget: new KopfWidget(ref, kopf.art, "", kopf.falt) }).range(c.von, c.titelAb));
      alle.push(Decoration.mark({ class: "cm-callout-titel" }).range(c.titelAb, l1.to));
    } else {
      alle.push(Decoration.replace({ widget: new KopfWidget(ref, kopf.art, standardTitel(kopf), kopf.falt) }).range(c.von, l1.to));
    }
    if (zu) {
      if (c.bis > l1.to) { const r = Decoration.replace({}).range(l1.to, c.bis); alle.push(r); atomar.push(r); zugeklappt.push({ von: c.von, a: l1.to, b: c.bis }); }
      continue;
    }
    for (let n = l1.number + 1; n <= l2.number; n++) {
      const l = doc.line(n);
      alle.push(Decoration.line({ class: klasse + (n === l2.number ? " cm-callout-ende" : "") }).range(l.from));
    }
    for (const m of c.marken) {
      const nr = doc.lineAt(m.von).number;
      if (nr === l1.number) continue;
      const bis = doc.sliceString(m.bis, m.bis + 1) === " " ? m.bis + 1 : m.bis;
      alle.push(Decoration.mark({ class: aktiv.has(nr) ? "cm-marke" : "cm-callout-marke" }).range(m.von, bis));
    }
  }
  return { deko: Decoration.set(alle, true), atomar: Decoration.set(atomar, true), zugeklappt };
}

export function calloutErweiterung(ctx, { neuZeichnen }) {
  const ref = { feld: null };
  const feld = StateField.define({
    create(state) {
      const w = { liste: findeCallouts(state), flips: new Set(), fokus: false, roh: !!ctx.roh?.() };
      Object.assign(w, baue(ref, state, w.liste, w.flips, w.fokus, w.roh));
      return w;
    },
    update(w, tr) {
      let { flips, fokus, roh } = w, liste = w.liste, neu = false;
      if (tr.docChanged) {
        liste = findeCallouts(tr.state);
        flips = new Set([...flips].map((p) => tr.changes.mapPos(p, 1)));
        neu = true;
      } else if (CM.syntaxTree(tr.state) !== CM.syntaxTree(tr.startState)) { liste = findeCallouts(tr.state); neu = true; }
      for (const e of tr.effects) {
        if (e.is(umschalten)) { flips = new Set(flips); if (flips.has(e.value)) flips.delete(e.value); else flips.add(e.value); neu = true; }
        else if (e.is(fokusEffekt)) { fokus = e.value; neu = true; }
        else if (e.is(neuZeichnen)) { roh = !!ctx.roh?.(); neu = true; }
      }
      if (!neu && !tr.selection) return w;
      const n = { liste, flips, fokus, roh };
      Object.assign(n, baue(ref, tr.state, liste, flips, fokus, roh));
      return n;
    },
    provide: (f) => [
      EditorView.decorations.from(f, (w) => w.deko),
      EditorView.atomicRanges.of((view) => view.state.field(f).atomar),
      EditorView.focusChangeEffect.of((_s, hat) => fokusEffekt.of(hat)),
      // Der versteckte Rumpf eines zugeklappten Callouts wird nie unsichtbar gelöscht (wie der Datei-Kopf): Entf, ⌥⌦ am Kopfende, Auswahl-Löschen usw.
      // werden verworfen und klappen das Callout auf; Eingaben gehen durch und klappen es ebenfalls auf.
      EditorState.transactionFilter.of((tr) => {
        if (!tr.docChanged || !(tr.isUserEvent("delete") || tr.isUserEvent("input"))) return tr;
        const w = tr.startState.field(f, false);
        if (!w || !w.zugeklappt?.length) return tr;
        const getroffen = new Set();
        tr.changes.iterChangedRanges((von, bis) => { for (const z of w.zugeklappt) if (von <= z.b && bis > z.a) getroffen.add(z.von); });
        if (!getroffen.size) return tr;
        const effekte = [...getroffen].map((v) => umschalten.of(v));
        return tr.isUserEvent("delete") ? [{ effects: effekte }] : [tr, { effects: effekte }];
      }),
    ],
  });
  ref.feld = feld;

  // Mod-Alt-[ zuklappen, Mod-Alt-] aufklappen (Cursor in der Kopfzeile oder im Rumpf eines faltbaren Callouts)
  const falte = (zuWunsch) => (view) => {
    const w = view.state.field(feld), pos = view.state.selection.main.head;
    const c = w.liste.find((x) => pos >= x.von && pos <= x.bis && x.kopf.falt);
    if (!c) return false;
    const l1 = view.state.doc.lineAt(c.von);
    const jetztZu = istZu(c.kopf.falt, w.flips.has(c.von)) && !(pos > l1.to);
    if (jetztZu === zuWunsch) return true;
    // Zuklappen mit dem Cursor im Rumpf: der Cursor geht erst an das Ende der Kopfzeile, sonst bliebe das Callout offen
    const standardZu = c.kopf.falt === "-";
    const flip = w.flips.has(c.von);
    const brauchtFlip = (standardZu !== zuWunsch) !== flip; // soll der Zustand getauscht werden?
    view.dispatch({ effects: brauchtFlip ? [umschalten.of(c.von)] : [], ...(zuWunsch && pos > l1.to ? { selection: EditorSelection.cursor(l1.to) } : {}) });
    return true;
  };
  return { felder: [feld, Prec.high(keymap.of([{ key: "Mod-Alt-[", run: falte(true) }, { key: "Mod-Alt-]", run: falte(false) }]))], feld };
}
