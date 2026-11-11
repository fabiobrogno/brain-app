// Code-Blöcke im Editor (R4-2): Syntaxfarben, Zäune nur in der Cursor-Zeile, Sprachmarke und Kopier-Knopf rechts oben.
// Die Sprachen kommen aus dem Bündel (`sprachListe`, jede als eigene Datei, erst bei Bedarf geladen); die Farben sind CSS-Klassen
// (`.syn-*` in editor-darstellung.css), damit Hell/Dunkel und alle Schemata ohne Neuaufbau wechseln. Der Text bleibt bytegleich.
import * as CM from "./vendor/codemirror.bundle.js";
import { T } from "./texte.js";

const { Decoration, WidgetType } = CM;
const t = CM.tags;

// Farben nur im Code der Zäune (nicht im Markdown-Text: dessen Marken, HTML in Absätzen usw. bleiben, wie sie sind). Die Klassen kommen aus den
// Tags der Sprachen; die Farben sind CSS-Variablen (.syn-*).
const FARBE = CM.tagHighlighter([
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword, t.modifier, t.self], class: "syn-kw" },
  { tag: [t.string, t.special(t.string), t.regexp, t.character, t.attributeValue], class: "syn-str" },
  { tag: [t.number, t.integer, t.float, t.bool, t.null, t.atom, t.unit], class: "syn-num" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], class: "syn-com" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], class: "syn-fn" },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName), t.labelName], class: "syn-def" },
  { tag: [t.propertyName, t.attributeName], class: "syn-prop" },
  { tag: [t.className, t.typeName, t.namespace], class: "syn-typ" },
  { tag: [t.tagName, t.angleBracket], class: "syn-tag" },
  { tag: [t.operator, t.compareOperator, t.logicOperator, t.arithmeticOperator, t.updateOperator, t.derefOperator], class: "syn-op" },
  { tag: [t.meta, t.escape], class: "syn-meta" },
  { tag: t.invalid, class: "syn-bad" },
]);
function faerbe(view) {
  const tree = CM.syntaxTree(view.state), liste = [];
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({ from, to, enter: (n) => {
      if (n.name !== "FencedCode") return;
      const text = n.node.getChild("CodeText");
      if (text) CM.highlightTree(tree, FARBE, (a, b, klasse) => { if (b > a) liste.push(Decoration.mark({ class: klasse }).range(a, b)); }, text.from, text.to);
      return false;
    } });
  }
  return Decoration.set(liste, true);
}
export const codeFarben = CM.ViewPlugin.fromClass(class {
  constructor(view) { this.deko = faerbe(view); }
  update(u) { if (u.docChanged || u.viewportChanged || CM.syntaxTree(u.startState) !== CM.syntaxTree(u.state)) this.deko = faerbe(u.view); }
}, { decorations: (v) => v.deko });

// codeLanguages-Funktion für den Markdown-Parser: Sprachmarke des Zauns → Sprache (oder nichts)
export const codeSprachen = (info) => CM.LanguageDescription.matchLanguageName(CM.sprachListe, String(info || "").trim().split(/\s+/)[0], true);

// Der Code eines Blocks ohne Zäune. pos: eine Stelle in der Kopfzeile des Blocks (dort steht das Widget).
export function codeText(state, pos) {
  let n = CM.syntaxTree(state).resolveInner(pos, -1);
  while (n && n.name !== "FencedCode") n = n.parent;
  if (!n) return null;
  const doc = state.doc, l1 = doc.lineAt(n.from).number;
  const zu = n.getChildren("CodeMark");
  const ende = zu.length > 1 ? doc.lineAt(zu[1].from).number - 1 : doc.lineAt(n.to).number;
  if (ende <= l1) return "";
  return doc.sliceString(doc.line(l1 + 1).from, doc.line(ende).to, "\n");
}

function kopiere(text) {
  // Ersatzweg ohne Eingabefeld: das copy-Ereignis von execCommand("copy") bekommt den Text mit
  const nimm = () => new Promise((ok, nein) => {
    const beim = (e) => { e.clipboardData.setData("text/plain", text); e.preventDefault(); };
    document.addEventListener("copy", beim, { once: true });
    let gut = false;
    try { gut = document.execCommand("copy"); } catch { /* nicht erlaubt */ }
    document.removeEventListener("copy", beim);
    gut ? ok() : nein(new Error("kopieren"));
  });
  return navigator.clipboard?.writeText ? navigator.clipboard.writeText(text).catch(nimm) : nimm();
}

const SYMBOL_KOPIE = "M8 8h12v12H8z M4 16V4h12";
const SYMBOL_HAKEN = "M20 6 9 17l-5-5";
function symbol(pfade) {
  const NS = "http://www.w3.org/2000/svg", s = document.createElementNS(NS, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: "14", height: "14", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) s.setAttribute(k, v);
  for (const d of pfade.split(" M").map((x, i) => (i ? "M" + x : x))) { const p = document.createElementNS(NS, "path"); p.setAttribute("d", d); s.append(p); }
  return s;
}

class CodeKopf extends WidgetType {
  constructor(sprache, mitMarke) { super(); this.sprache = sprache; this.mitMarke = mitMarke; }
  eq(o) { return o.sprache === this.sprache && o.mitMarke === this.mitMarke; }
  toDOM(view) {
    const d = document.createElement("span");
    d.className = "cm-code-kopf";
    d.contentEditable = "false";
    if (this.sprache && this.mitMarke) { const m = document.createElement("span"); m.className = "cm-code-sprache"; m.textContent = this.sprache; d.append(m); }
    const k = document.createElement("span");
    k.className = "cm-code-kopieren";
    k.setAttribute("role", "button");
    k.setAttribute("aria-label", T.editor.code.kopieren);
    k.dataset.tippText = T.editor.code.kopieren;
    k.append(symbol(SYMBOL_KOPIE));
    k.addEventListener("mousedown", (e) => {
      e.preventDefault(); // Cursor und Fokus bleiben im Text
      if (e.button !== 0) return;
      const text = codeText(view.state, view.posAtDOM(d));
      if (text === null) return;
      kopiere(text).then(() => {
        k.classList.add("kopiert"); k.replaceChildren(symbol(SYMBOL_HAKEN)); k.setAttribute("aria-label", T.editor.code.kopiert);
        setTimeout(() => { k.classList.remove("kopiert"); k.replaceChildren(symbol(SYMBOL_KOPIE)); k.setAttribute("aria-label", T.editor.code.kopieren); }, 1400);
      }, () => {});
    });
    d.append(k);
    return d;
  }
  ignoreEvent() { return true; }
}

// Zäune und Kopf eines FencedCode-Knotens. Die Zaun-Zeilen bleiben Zeilen (leer statt Text): Zeilenhöhe und Block ändern sich nie,
// wenn der Cursor hinein- oder hinausläuft. verstecken: die gemeinsame leere Ersetzung (editor.js).
export function zaeune(knoten, doc, zeileAktiv, liste, verstecken) {
  const marken = knoten.getChildren("CodeMark");
  if (!marken.length) return;
  const info = knoten.getChild("CodeInfo");
  const sprache = info ? doc.sliceString(info.from, info.to).trim().split(/\s+/)[0] : "";
  const l1 = doc.lineAt(marken[0].from);
  const aktiv = zeileAktiv(l1.from);
  if (!aktiv && l1.to > l1.from) liste.push(verstecken.range(l1.from, l1.to));
  liste.push(Decoration.widget({ widget: new CodeKopf(sprache, !aktiv), side: 1 }).range(l1.to));
  if (marken.length > 1) {
    const l2 = doc.lineAt(marken[1].from);
    if (l2.number !== l1.number && !zeileAktiv(l2.from) && l2.to > l2.from) liste.push(verstecken.range(l2.from, l2.to));
  }
}

// Platzhalter in einer leeren Titelzeile „# “
class Platzhalter extends WidgetType {
  constructor(text) { super(); this.text = text; }
  eq(o) { return o.text === this.text; }
  toDOM() { const s = document.createElement("span"); s.className = "cm-platzhalter"; s.textContent = this.text; s.setAttribute("aria-hidden", "true"); return s; }
  ignoreEvent() { return true; }
}
export const titelPlatzhalter = () => Decoration.widget({ widget: new Platzhalter(T.editor.titelPlatzhalter), side: 1 });

