// Editor: CodeMirror 6 auf dem ROHEN Markdown-Text. Live-Vorschau nur per Dekorationen.
// Der Text bleibt bytegleich: Zeilenende (CRLF) wird erkannt und beim Lesen wieder zusammengesetzt.
import * as CM from "./vendor/codemirror.bundle.js";
import { T } from "./texte.js";

const { EditorState, EditorSelection, EditorView, Decoration, ViewPlugin, WidgetType, StateField, StateEffect, GutterMarker, gutter, keymap } = CM;

const WIKI = /\[\[([^\[\]\n|#]+)(#[^\[\]\n|]*)?(\|[^\[\]\n]*)?\]\]/g;

// ---------- Frontmatter ----------
export function frontmatterBereich(text) {
  if (!text.startsWith("---")) return null;
  const m = /^---[ \t]*\r?\n/.exec(text);
  if (!m) return null;
  const re = /^(---|\.\.\.)[ \t]*$/gm;
  re.lastIndex = m[0].length;
  const ende = re.exec(text);
  if (!ende) return null;
  const inhalt = text.slice(m[0].length, ende.index);
  const felder = inhalt.split(/\r?\n/).filter((z) => /^[A-Za-z0-9_\-äöüÄÖÜ]+\s*:/.test(z)).length;
  return { von: 0, bis: ende.index + ende[0].length, felder };
}

const fmUmschalten = StateEffect.define(); // Wert = zugeklappt (true) oder offen (false)

class FmWidget extends WidgetType {
  constructor(n) { super(); this.n = n; }
  eq(a) { return a.n === this.n; }
  toDOM(view) {
    const d = document.createElement("div");
    d.className = "cm-fm-zu";
    d.setAttribute("role", "button");
    d.tabIndex = 0;
    d.innerHTML = `<span class="cm-fm-pfeil">›</span><span>${T.editor.frontmatter(this.n)}</span>`;
    const auf = () => view.dispatch({ effects: fmUmschalten.of(false) });
    d.addEventListener("mousedown", (e) => { e.preventDefault(); auf(); });
    d.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); auf(); } });
    // Abstand nach unten als Innenabstand einer Hülle: CodeMirror misst Block-Widgets ohne Außenabstand
    const huelle = document.createElement("div");
    huelle.className = "cm-fm-huelle";
    huelle.append(d);
    return huelle;
  }
  ignoreEvent() { return true; }
}
class FmKopf extends WidgetType {
  constructor(n) { super(); this.n = n; }
  eq(a) { return a.n === this.n; }
  toDOM(view) {
    const d = document.createElement("div");
    d.className = "cm-fm-auf";
    d.setAttribute("role", "button");
    d.innerHTML = `<span class="cm-fm-pfeil offen">›</span><span>${T.editor.frontmatter(this.n)}</span>`;
    d.addEventListener("mousedown", (e) => { e.preventDefault(); view.dispatch({ effects: fmUmschalten.of(true) }); });
    return d;
  }
  ignoreEvent() { return true; }
}

function fmDekos(state, eingeklappt) {
  const text = state.doc.toString();
  const b = frontmatterBereich(text);
  if (!b) return Decoration.none;
  if (eingeklappt) {
    return Decoration.set([Decoration.replace({ widget: new FmWidget(b.felder), block: true }).range(b.von, b.bis)]);
  }
  const liste = [Decoration.widget({ widget: new FmKopf(b.felder), block: true, side: -1 }).range(0)];
  const l1 = state.doc.lineAt(b.von).number, l2 = state.doc.lineAt(b.bis).number;
  for (let n = l1; n <= l2; n++) liste.push(Decoration.line({ class: "cm-fm" }).range(state.doc.line(n).from));
  return Decoration.set(liste, true);
}

const fmFeld = StateField.define({
  create(state) { return { zu: true, deko: fmDekos(state, true) }; },
  update(w, tr) {
    let zu = w.zu;
    for (const e of tr.effects) if (e.is(fmUmschalten)) zu = e.value;
    if (zu === w.zu && !tr.docChanged) return w;
    return { zu, deko: fmDekos(tr.state, zu) };
  },
  provide: (f) => EditorView.decorations.from(f, (w) => w.deko),
});

// ---------- Live-Vorschau ----------
class Punkt extends WidgetType {
  eq() { return true; }
  toDOM() { const s = document.createElement("span"); s.className = "cm-punkt"; s.textContent = "•"; return s; }
}
const verstecken = Decoration.replace({});

function aktiveZeilen(state) {
  const s = new Set();
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number, b = state.doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) s.add(n);
  }
  return s;
}

function vorschau(view, ctx) {
  const { state } = view;
  const doc = state.doc;
  const aktiv = aktiveZeilen(state);
  const fokus = view.hasFocus;
  const liste = [];
  const roh = !!ctx.roh?.();
  const zeileAktiv = (pos) => roh || (fokus && aktiv.has(doc.lineAt(pos).number));
  const fm = frontmatterBereich(doc.toString());
  const fmBis = fm ? fm.bis : -1;
  const zeilenKlasse = new Map(); // Zeilenanfang -> Klassen

  const klasse = (pos, k) => {
    const l = doc.lineAt(pos).from;
    zeilenKlasse.set(l, (zeilenKlasse.get(l) || "") + " " + k);
  };

  for (const { from, to } of view.visibleRanges) {
    const von = Math.max(from, fmBis + 1);
    if (von > to) continue;
    // Wikilinks zuerst, damit Markdown-Marken darin ausgespart werden
    const wiki = [];
    const text = doc.sliceString(von, to);
    WIKI.lastIndex = 0;
    let m;
    while ((m = WIKI.exec(text))) {
      const a = von + m.index, b = a + m[0].length;
      wiki.push([a, b]);
      const ziel = m[1].trim();
      const da = ctx.wikiAufloesen(ziel);
      const innen = zeileAktiv(a);
      const klassen = "cm-wiki" + (da ? "" : " cm-wiki-fehlt");
      const wf = da ? ctx.wikiFarbe?.(da) : null;
      liste.push(Decoration.mark({ class: klassen, attributes: wf ? { "data-ziel": ziel, style: `--wiki:${wf}` } : { "data-ziel": ziel } }).range(a + 2, b - 2));
      if (!innen) {
        liste.push(verstecken.range(a, a + 2));
        liste.push(verstecken.range(b - 2, b));
        if (m[3]) liste.push(verstecken.range(a + 2, a + 2 + m[1].length + (m[2] ? m[2].length : 0) + 1));
      } else {
        liste.push(Decoration.mark({ class: "cm-wiki-klammer" }).range(a, a + 2));
        liste.push(Decoration.mark({ class: "cm-wiki-klammer" }).range(b - 2, b));
      }
    }
    const imWiki = (p) => wiki.some(([a, b]) => p >= a && p < b);

    CM.syntaxTree(state).iterate({
      from: von, to,
      enter: (n) => {
        const name = n.name;
        if (n.from < fmBis + 1 && fm) return;
        if ((name === "Link" || name === "Image") && imWiki(n.from)) return false;
        if (/^ATXHeading[1-6]$/.test(name)) { klasse(n.from, "cm-h" + name.slice(10)); return; }
        if (name === "SetextHeading1") { klasse(n.from, "cm-h1"); return; }
        if (name === "SetextHeading2") { klasse(n.from, "cm-h2"); return; }
        if (name === "HeaderMark") {
          if (doc.sliceString(n.from, n.to).startsWith("#")) {
            const ende = doc.sliceString(n.to, n.to + 1) === " " ? n.to + 1 : n.to;
            if (!zeileAktiv(n.from)) liste.push(verstecken.range(n.from, ende));
            else liste.push(Decoration.mark({ class: "cm-marke" }).range(n.from, n.to));
          }
          return;
        }
        if (name === "StrongEmphasis") { liste.push(Decoration.mark({ class: "cm-fett" }).range(n.from, n.to)); return; }
        if (name === "Emphasis") { liste.push(Decoration.mark({ class: "cm-kursiv" }).range(n.from, n.to)); return; }
        if (name === "Strikethrough") { liste.push(Decoration.mark({ class: "cm-durch" }).range(n.from, n.to)); return; }
        if (name === "EmphasisMark" || name === "StrikethroughMark") {
          if (!zeileAktiv(n.from)) liste.push(verstecken.range(n.from, n.to));
          else liste.push(Decoration.mark({ class: "cm-marke" }).range(n.from, n.to));
          return;
        }
        if (name === "InlineCode") { liste.push(Decoration.mark({ class: "cm-code" }).range(n.from, n.to)); return; }
        if (name === "CodeMark" && n.node.parent?.name === "InlineCode") {
          if (!zeileAktiv(n.from)) liste.push(verstecken.range(n.from, n.to));
          return;
        }
        if (name === "FencedCode") {
          const l1 = doc.lineAt(n.from).number, l2 = doc.lineAt(n.to).number;
          for (let i = l1; i <= l2; i++) {
            const k = "cm-codeblock" + (i === l1 ? " cm-codeblock-anfang" : "") + (i === l2 ? " cm-codeblock-ende" : "");
            const lf = doc.line(i).from;
            zeilenKlasse.set(lf, (zeilenKlasse.get(lf) || "") + " " + k);
          }
          return;
        }
        if (name === "Blockquote") {
          const l1 = doc.lineAt(n.from).number, l2 = doc.lineAt(n.to).number;
          for (let i = l1; i <= l2; i++) { const lf = doc.line(i).from; zeilenKlasse.set(lf, (zeilenKlasse.get(lf) || "") + " cm-zitat"); }
          return;
        }
        if (name === "QuoteMark") { liste.push(Decoration.mark({ class: "cm-marke" }).range(n.from, n.to)); return; }
        if (name === "HorizontalRule") { klasse(n.from, "cm-trenner"); return; }
        if (name === "ListMark") {
          const t = doc.sliceString(n.from, n.to);
          if (/^[-*+]$/.test(t) && !zeileAktiv(n.from)) liste.push(Decoration.replace({ widget: new Punkt() }).range(n.from, n.to));
          else liste.push(Decoration.mark({ class: "cm-listenmarke" }).range(n.from, n.to));
          return;
        }
        if (name === "Link") { liste.push(Decoration.mark({ class: "cm-link" }).range(n.from, n.to)); return; }
        if (name === "LinkMark" || name === "URL") {
          if (imWiki(n.from)) return;
          const p = n.node.parent?.name;
          if (p !== "Link" && p !== "Image") return;
          if (!zeileAktiv(n.from)) liste.push(verstecken.range(n.from, n.to));
          else liste.push(Decoration.mark({ class: "cm-marke" }).range(n.from, n.to));
          return;
        }
      },
    });
  }
  for (const [pos, k] of zeilenKlasse) liste.push(Decoration.line({ class: k.trim() }).range(pos));
  // Verstecken-Bereiche dürfen sich nicht überlappen: sortieren und Überlappendes verwerfen
  liste.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);
  const sauber = [];
  let letzteEnde = -1;
  for (const r of liste) {
    const ersetzt = r.value.spec && (r.value.spec.widget || r.value === verstecken || r.value.point);
    if (ersetzt && r.from < letzteEnde) continue;
    sauber.push(r);
    if (ersetzt) letzteEnde = Math.max(letzteEnde, r.to);
  }
  return Decoration.set(sauber, true);
}

function vorschauPlugin(ctx) {
  return ViewPlugin.fromClass(class {
    constructor(view) { this.deko = vorschau(view, ctx); }
    update(u) {
      if (u.docChanged || u.selectionSet || u.viewportChanged || u.focusChanged || u.transactions.some((t) => t.effects.some((e) => e.is(neuZeichnen))) || CM.syntaxTree(u.startState) !== CM.syntaxTree(u.state)) {
        this.deko = vorschau(u.view, ctx);
      }
    }
  }, { decorations: (v) => v.deko });
}
const neuZeichnen = StateEffect.define();

// ---------- Prüf-Randmarken ----------
const signaleSetzen = StateEffect.define();
const signaleFeld = StateField.define({
  create: () => new Map(),
  update(w, tr) {
    for (const e of tr.effects) if (e.is(signaleSetzen)) {
      const m = new Map();
      for (const s of e.value) if (s.zeile) m.set(s.zeile, s);
      return m;
    }
    return w;
  },
});
class SignalMarke extends GutterMarker {
  constructor(s) { super(); this.s = s; }
  eq(o) { return o.s === this.s; }
  toDOM() {
    const d = document.createElement("span");
    d.className = "cm-signal cm-signal-" + (this.s.stufe || "gelb");
    d.title = this.s.text || "";
    return d;
  }
}
const signalRand = gutter({
  class: "cm-signale",
  lineMarker(view, line) {
    const nr = view.state.doc.lineAt(line.from).number;
    const s = view.state.field(signaleFeld).get(nr);
    return s ? new SignalMarke(s) : null;
  },
  lineMarkerChange: (u) => u.transactions.some((t) => t.effects.some((e) => e.is(signaleSetzen))),
  initialSpacer: () => new SignalMarke({ stufe: "gelb" }),
});

// ---------- Fließende Absätze ----------
// Fest umbrochene Absätze (Zeilen à ~100 Zeichen, Fortsetzungen eingerückt) werden als fließender Text gezeigt: jeder weiche
// Zeilenumbruch samt Einrückung der Folgezeile erscheint als EIN Leerzeichen. Reine Darstellung, der Text im Dokument bleibt
// wie er ist (Speichern, Zeilenenden, Rückgängig). Ersetzungen über Zeilenumbrüche dürfen nicht aus einem ViewPlugin kommen,
// darum ein StateField; der Fokus gehört nicht zum State und kommt per focusChangeEffect hinein.
const fokusGeaendert = StateEffect.define();

class Leerzeichen extends WidgetType {
  eq() { return true; }
  toDOM() { const s = document.createElement("span"); s.className = "cm-umbruch"; s.textContent = " "; return s; }
  ignoreEvent() { return false; } // Klick darauf setzt den Cursor wie in Text
}
const weicherUmbruch = Decoration.replace({ widget: new Leerzeichen() });

// Hier wird nie verbunden: Zitate/Callouts, Code, HTML, Tabellen, Link-Definitionen. Überschriften sind keine Absatz-Knoten,
// der Datei-Kopf wird unten ausgespart.
const KEIN_FLIESSTEXT = new Set(["Blockquote", "FencedCode", "CodeBlock", "HTMLBlock", "CommentBlock", "ProcessingInstructionBlock", "Table", "LinkReference"]);
const ABSATZ_KNOTEN = new Set(["Paragraph", "Task"]); // Task = Text eines Aufgaben-Listenpunkts („- [ ] …“)
const leerzeichen = (z) => z === " " || z === "\t";

// Alle Absätze mit weichen Umbrüchen, unabhängig von Auswahl und Fokus: [{ von, bis, umbrueche: [[von, bis], …] }].
// Ein Bereich reicht vom Ende der Zeile (samt Leerzeichen davor, es bleibt genau eines sichtbar) bis zum Text der Folgezeile.
function absatzSpannen(state) {
  const doc = state.doc;
  const signale = state.field(signaleFeld);
  const fm = doc.sliceString(0, 3) === "---" ? frontmatterBereich(doc.toString()) : null;
  const fmBis = fm ? fm.bis : -1;
  const liste = [];
  let harte = null; // Enden der harten Umbrüche (HardBreak) im Absatz, den wir gerade durchlaufen
  CM.syntaxTree(state).iterate({
    enter: (n) => {
      if (harte) { if (n.name === "HardBreak") harte.add(n.to); return; }
      if (KEIN_FLIESSTEXT.has(n.name)) return false;
      if (ABSATZ_KNOTEN.has(n.name)) harte = new Set();
    },
    leave: (n) => {
      if (!harte || !ABSATZ_KNOTEN.has(n.name)) return;
      const hart = harte;
      harte = null;
      if (n.from <= fmBis) return; // Datei-Kopf
      const z1 = doc.lineAt(n.from).number, z2 = doc.lineAt(n.to).number;
      if (z1 === z2) return;
      for (let nr = z1; nr <= z2; nr++) if (signale.has(nr)) return; // Prüf-Signal: Randmarke und Hervorhebung bleiben sichtbar
      const umbrueche = [];
      for (let nr = z1; nr < z2; nr++) {
        const z = doc.line(nr), folge = doc.line(nr + 1);
        if (hart.has(z.to + 1)) continue; // harter Umbruch bleibt sichtbar
        let a = z.text.length;
        while (a > 0 && leerzeichen(z.text[a - 1])) a--;
        let b = 0;
        while (b < folge.text.length && leerzeichen(folge.text[b])) b++;
        if (b === folge.text.length) continue; // leere Zeile gehört nie zu einem Absatz
        umbrueche.push([Math.max(z.from + a, n.from), folge.from + b]);
      }
      if (umbrueche.length) liste.push({ von: n.from, bis: n.to, umbrueche });
    },
  });
  return liste;
}

// Aktiver Absatz bleibt roh: Auswahl im Absatz bei Fokus im Editor; Rohmodus verbindet gar nichts.
const absatzAktiv = (w, state, a) => w.fokus && state.selection.ranges.some((r) => r.from <= a.bis && r.to >= a.von);
function absatzDeko(w, state) {
  if (w.roh) return Decoration.none;
  const bereiche = [];
  for (const a of w.absaetze) {
    if (absatzAktiv(w, state, a)) continue;
    for (const [von, bis] of a.umbrueche) bereiche.push(weicherUmbruch.range(von, bis));
  }
  return Decoration.set(bereiche, true);
}

// Doppel-/Dreifachklick in einem verbundenen Absatz: der erste Klick schaltet ihn auf roh, der Text darunter springt. Ab dem
// zweiten Klick träfe man sonst das neue Bild statt des Wortes, auf das man gezeigt hat; darum zählt die Stelle des ersten Klicks
// (Doppelklick = Wort, Dreifachklick = der Absatz, wie ihn der erste Klick zeigte). Alles andere bleibt Standard.
function mehrfachKlick(feld) {
  let erster = null; // { pos, x, y, absatz } des ersten Klicks einer Folge; absatz nur, wenn er in einen verbundenen Absatz ging
  return [
    EditorView.domEventHandlers({
      mousedown(e, view) {
        if (e.button !== 0 || e.detail !== 1) return false;
        const w = view.state.field(feld);
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }, false);
        const a = pos == null ? null : w.absaetze.find((x) => x.von <= pos && pos <= x.bis);
        erster = { pos, x: e.clientX, y: e.clientY, absatz: a && !w.roh && !absatzAktiv(w, view.state, a) ? a : null };
        return false;
      },
    }),
    EditorView.mouseSelectionStyle.of((view, e) => {
      if (e.button !== 0 || e.detail < 2 || !erster?.absatz || Math.hypot(e.clientX - erster.x, e.clientY - erster.y) > 6) return null;
      const bereich = e.detail === 2 ? view.state.wordAt(erster.pos) : { from: erster.absatz.von, to: Math.min(erster.absatz.bis + 1, view.state.doc.length) };
      if (!bereich) return null;
      return { get: () => EditorSelection.single(bereich.from, bereich.to), update: () => false };
    }),
  ];
}

function absatzFeld(ctx) {
  return StateField.define({
    create(state) {
      const w = { roh: !!ctx.roh?.(), fokus: false, signale: state.field(signaleFeld), absaetze: absatzSpannen(state) };
      w.deko = absatzDeko(w, state);
      return w;
    },
    update(w, tr) {
      let { roh, fokus } = w, neuDeko = false;
      for (const e of tr.effects) {
        if (e.is(fokusGeaendert) && e.value !== fokus) { fokus = e.value; neuDeko = true; }
        else if (e.is(neuZeichnen)) { roh = !!ctx.roh?.(); neuDeko = true; }
      }
      const signale = tr.state.field(signaleFeld);
      const neuBerechnen = tr.docChanged || signale !== w.signale || CM.syntaxTree(tr.state) !== CM.syntaxTree(tr.startState);
      const auswahl = fokus && !roh && !tr.startState.selection.eq(tr.state.selection);
      if (!neuBerechnen && !neuDeko && !auswahl) return w;
      const neu = { roh, fokus, signale, absaetze: neuBerechnen ? absatzSpannen(tr.state) : w.absaetze };
      neu.deko = absatzDeko(neu, tr.state);
      return neu;
    },
    provide: (f) => [
      EditorView.decorations.from(f, (w) => w.deko),
      EditorView.atomicRanges.of((view) => view.state.field(f).deko), // Cursor springt über den versteckten Umbruch samt Einrückung
      EditorView.focusChangeEffect.of((_state, fokus) => fokusGeaendert.of(fokus)),
      mehrfachKlick(f),
    ],
  });
}

// ---------- Autovervollständigung für [[ ----------
function wikiQuelle(ctx) {
  return (cc) => {
    const m = cc.matchBefore(/\[\[[^\[\]\n]*$/);
    if (!m) return null;
    const getippt = m.text.slice(2).toLowerCase();
    const dateien = ctx.wikiZiele();
    const treffer = dateien
      .map((d) => {
        const n = d.name.toLowerCase(), p = d.pfad.toLowerCase();
        const rang = !getippt ? 2 : n.startsWith(getippt) ? 0 : n.includes(getippt) ? 1 : p.includes(getippt) ? 3 : 9;
        return { d, rang };
      })
      .filter((x) => x.rang < 9)
      .sort((a, b) => a.rang - b.rang || a.d.name.localeCompare(b.d.name, "de"))
      .slice(0, 40);
    return {
      from: m.from + 2,
      filter: false,
      options: treffer.map(({ d }) => ({
        label: d.name,
        detail: d.ordner,
        type: "text",
        apply: (view, _c, von, bis) => {
          const nach = view.state.sliceDoc(bis, bis + 2);
          view.dispatch({
            changes: { from: von, to: bis, insert: d.name + (nach === "]]" ? "" : "]]") },
            selection: { anchor: von + d.name.length + 2 },
            userEvent: "input.complete",
          });
        },
      })),
    };
  };
}

// ---------- Aufbau ----------
export function erstelleEditor(eltern, ctx) {
  let schreibschutzFeld = new CM.Compartment();
  const erweiterungen = (zeilenende) => [
    ...(zeilenende && zeilenende !== "\n" ? [EditorState.lineSeparator.of(zeilenende)] : []),
    CM.history(),
    CM.closeBrackets(),
    CM.drawSelection(),
    CM.highlightSelectionMatches(),
    CM.search({ top: true }),
    CM.markdown({ base: CM.markdownLanguage }),
    EditorView.lineWrapping,
    fmFeld,
    signaleFeld,
    signalRand,
    absatzFeld(ctx),
    vorschauPlugin(ctx),
    CM.autocompletion({ override: [wikiQuelle(ctx)], icons: false, tooltipClass: () => "cm-wikiliste" }),
    keymap.of([
      { key: "Mod-s", run: () => { ctx.speichernJetzt(); return true; }, preventDefault: true },
      ...CM.closeBracketsKeymap, ...CM.completionKeymap, ...CM.searchKeymap, ...CM.historyKeymap, ...CM.defaultKeymap, CM.indentWithTab,
    ]),
    schreibschutzFeld.of([]),
    EditorView.contentAttributes.of({ "aria-label": "Notiz", spellcheck: "true", autocorrect: "on", autocapitalize: "sentences" }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) ctx.geaendert();
      if (u.selectionSet) ctx.cursor?.(u.state);
    }),
    EditorView.domEventHandlers({
      mousedown(e) {
        const t = e.target.closest?.(".cm-wiki");
        if (t && e.button === 0 && !e.altKey) {
          e.preventDefault();
          ctx.wikiOeffnen(t.getAttribute("data-ziel"));
          return true;
        }
        return false;
      },
    }),
  ];

  let ende = "\n";
  const view = new EditorView({ parent: eltern, state: EditorState.create({ doc: "", extensions: erweiterungen("\n") }) });

  return {
    view,
    zeilenende: () => ende,
    // Lädt Text als neuen Zustand (eigene Rückgängig-Liste). Zeilenende wird erkannt.
    setzeText(text, { nurLesen = false } = {}) {
      ende = text.includes("\r\n") ? "\r\n" : (text.includes("\r") && !text.includes("\n") ? "\r" : "\n");
      const b = frontmatterBereich(text);
      const state = EditorState.create({
        doc: text,
        selection: { anchor: b ? Math.min(text.length, b.bis + 1) : 0 },
        extensions: erweiterungen(ende),
      });
      view.setState(state);
      if (ctx.roh?.()) view.dispatch({ effects: fmUmschalten.of(false) });
      // Der neue State kennt den Fokus noch nicht: den Ist-Stand eintragen (sonst bliebe der Absatz am Cursor verbunden)
      view.dispatch({ effects: [schreibschutzFeld.reconfigure(nurLesen ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []), fokusGeaendert.of(view.hasFocus)] });
    },
    // Originaltext mit ursprünglichen Zeilenenden
    text() { return view.state.sliceDoc(0, view.state.doc.length, view.state.lineBreak); },
    ersetzeAlles(text) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, userEvent: "input.wiederherstellen" });
    },
    setzeSignale(liste) { view.dispatch({ effects: signaleSetzen.of(liste || []) }); },
    zeichneNeu() { view.dispatch({ effects: neuZeichnen.of(null) }); },
    springeZu(zeile) {
      const n = Math.max(1, Math.min(view.state.doc.lines, zeile));
      const l = view.state.doc.line(n);
      view.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: "center" }) });
      view.focus();
    },
    suchen() { view.focus(); CM.openSearchPanel(view); },
    fokus() { view.focus(); },
    // Rohtext: alle Markierungen sichtbar, Datei-Kopf aufgeklappt (der Text selbst bleibt unverändert)
    setzeRoh() { view.dispatch({ effects: [fmUmschalten.of(!ctx.roh?.()), neuZeichnen.of(null)] }); },
  };
}
