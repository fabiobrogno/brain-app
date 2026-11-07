// Editor-Erweiterung für Bilder und Anhänge (Paket 3a, Runde 3): Einfügen und Ziehen von Dateien, Bilder und Chips im Text (Live-Vorschau), Platzhalter für externe Bilder.
// Eigenes Modul, damit editor.js nur eine Zeile braucht. Der Text bleibt bytegleich: `![[datei.png]]` und `![Alt](pfad)` stehen unverändert in der Datei, gezeigt wird nur per Dekoration.
//   · Eigene Zeile (Cursor nicht darin): die Schreibweise wird durch Bild bzw. Chip ersetzt. Cursor in der Zeile (oder Rohtext): der Text bleibt sichtbar, das Bild steht dahinter.
//   · Klick auf ein Bild: Lightbox. Klick auf einen Chip: Datei mit dem Programm des Systems öffnen (Hüllen-Vertrag: anhang-oeffnen).
//   · Externe Bilder (https): Platzhalter, bis der Nutzer klickt (oder die Einstellung „Externe Bilder laden“ an ist); sie laufen über die Werkstatt (/_extern-bild), die Seite bleibt bei img-src 'self'.
import * as CM from "./vendor/codemirror.bundle.js";
import { EINBETTUNG, einbettungAus, lokalerPfad, istBildName, istAnhangName, groesseText } from "./anhang-regeln.js";
import { TAN } from "./texte-anhaenge.js";
import { h } from "./hilfen.js";
import { symbol, GROESSE } from "./symbole.js";

const { Decoration, ViewPlugin, WidgetType, EditorView, StateEffect } = CM;
const neuBauen = StateEffect.define(); // Widgets neu bauen (z. B. nach „Externes Bild laden“)

const MD_BILD = /^!\[([^\]]*)\]\(\s*(<[^>]*>|[^)\s]*)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)$/;
const DATA_BILD = /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/i;
const MAX_DATA = 4 * 1024 * 1024;

function bildMitFehler(box, img, text) {
  box.classList.add("fehlt");
  box.replaceChildren(symbol("warnung", GROESSE.text), h("span", { klasse: "cm-anhang-text", text }));
  img.remove();
}

class BildWidget extends WidgetType {
  // o: { art: "lokal"|"extern"|"data", ziel (Name/Pfad oder Adresse), von, breite, alt, erlaubt }
  constructor(A, o) { super(); this.A = A; this.o = o; }
  eq(b) { const a = this.o, c = b.o; return a.art === c.art && a.ziel === c.ziel && a.von === c.von && a.breite === c.breite && a.alt === c.alt && a.erlaubt === c.erlaubt && this.dahinter === b.dahinter; }
  toDOM(view) {
    const { A, o } = this;
    const name = o.alt || o.ziel.split("/").pop();
    const box = h("span", { klasse: "cm-anhang cm-anhang-bild" + (this.dahinter ? " cm-anhang-dahinter" : ""), "data-ziel": o.ziel, title: TAN.bildOeffnen(name) });
    const img = new Image();
    img.className = "cm-anhang-img";
    img.alt = name; img.decoding = "async"; img.draggable = false;
    if (o.breite) img.style.width = `${o.breite}px`;
    // Die Höhe des Textes ändert sich, sobald das Bild geladen ist: CodeMirror misst neu
    img.addEventListener("load", () => { box.classList.add("geladen"); view.requestMeasure(); });
    img.addEventListener("error", () => { bildMitFehler(box, img, o.art === "extern" ? TAN.externFehler(A.kurzHost(o.ziel)) : TAN.bildFehlt(o.ziel.split("/").pop())); view.requestMeasure(); });
    img.src = o.art === "lokal" ? A.bildUrl(o.ziel, o.von) : o.art === "extern" ? A.externUrl(o.ziel) : o.ziel;
    box.append(img);
    box.addEventListener("mousedown", (e) => {
      e.preventDefault(); // der Cursor bleibt, wo er ist; die Zeile klappt nicht auf
      if (e.button !== 0 || box.classList.contains("fehlt")) return;
      A.lightbox(img.currentSrc || img.src, name);
    });
    return box;
  }
  ignoreEvent() { return true; }
}

class PlatzhalterWidget extends WidgetType {
  constructor(A, adresse, alt) { super(); this.A = A; this.adresse = adresse; this.alt = alt; }
  eq(b) { return b.adresse === this.adresse && b.alt === this.alt && this.dahinter === b.dahinter; }
  toDOM(view) {
    const { A, adresse } = this;
    const nurHttps = !/^https:\/\//i.test(adresse);
    const host = A.kurzHost(adresse);
    const knopf = h("span", { klasse: "cm-anhang cm-anhang-extern" + (nurHttps ? " gesperrt" : "") + (this.dahinter ? " cm-anhang-dahinter" : ""), role: "button", "data-extern": adresse, title: nurHttps ? TAN.externNurHttps : TAN.externText },
      symbol("extern", GROESSE.text),
      h("span", { klasse: "cm-anhang-text" }, h("span", { klasse: "cm-anhang-name", text: TAN.externPlatzhalter(host) }), h("span", { klasse: "cm-anhang-zusatz", text: nurHttps ? TAN.externNurHttps : TAN.externLaden })));
    knopf.addEventListener("mousedown", (e) => { e.preventDefault(); if (e.button === 0 && !nurHttps) A.erlaubeExtern(adresse); });
    return knopf;
  }
  ignoreEvent() { return true; }
}

class DateiWidget extends WidgetType {
  constructor(A, ziel, von) { super(); this.A = A; this.ziel = ziel; this.von = von; }
  eq(b) { return b.ziel === this.ziel && b.von === this.von && this.dahinter === b.dahinter; }
  toDOM(view) {
    const { A, ziel, von } = this;
    const kurz = ziel.split("/").pop();
    const groesse = h("span", { klasse: "cm-anhang-zusatz" });
    const chip = h("span", { klasse: "cm-anhang cm-anhang-chip" + (this.dahinter ? " cm-anhang-dahinter" : ""), role: "button", "data-ziel": ziel, title: TAN.dateiOeffnen(kurz) },
      symbol("notiz", GROESSE.text), h("span", { klasse: "cm-anhang-text" }, h("span", { klasse: "cm-anhang-name", text: kurz }), groesse));
    A.aufloesen(ziel, von).then((r) => {
      if (!r) { chip.classList.add("fehlt"); chip.title = TAN.dateiFehlt(kurz); groesse.textContent = TAN.nichtGefunden; }
      else { chip.dataset.pfad = r.pfad; groesse.textContent = groesseText(r.groesse); }
      view.requestMeasure();
    });
    chip.addEventListener("mousedown", (e) => { e.preventDefault(); if (e.button === 0) A.oeffne(ziel, von); });
    return chip;
  }
  ignoreEvent() { return true; }
}

// Liegt die Stelle in Code (Zaun, eingerückter Block, Inline-Code)? Dort steht `![[x.png]]` nur als Text.
function imCode(state, pos) {
  for (let n = CM.syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) if (n.name === "FencedCode" || n.name === "CodeBlock" || n.name === "InlineCode" || n.name === "CommentBlock") return true;
  return false;
}

function dekos(view, A, ctx) {
  if (ctx.roh?.()) return Decoration.none;
  const { state } = view, doc = state.doc;
  const von = ctx.pfad?.() || "";
  const aktiv = new Set();
  if (view.hasFocus) for (const r of state.selection.ranges) for (let n = doc.lineAt(r.from).number, e = doc.lineAt(r.to).number; n <= e; n++) aktiv.add(n);
  const liste = [];
  const belegt = []; // [von, bis) der Einbettungen: Markdown-Bilder darin zählen nicht
  const setze = (a, b, widget) => {
    if (aktiv.has(doc.lineAt(a).number)) { widget.dahinter = true; liste.push(Decoration.widget({ widget, side: 1 }).range(b)); }
    else liste.push(Decoration.replace({ widget }).range(a, b));
  };
  for (const { from, to } of view.visibleRanges) {
    const a0 = doc.lineAt(from).from, b0 = doc.lineAt(to).to;
    const text = doc.sliceString(a0, b0);
    if (text.includes("![[")) {
      EINBETTUNG.lastIndex = 0;
      let m;
      while ((m = EINBETTUNG.exec(text))) {
        const a = a0 + m.index, b = a + m[0].length;
        const e = einbettungAus(m);
        if (!istAnhangName(e.ziel) || imCode(state, a)) continue;
        belegt.push([a, b]);
        setze(a, b, istBildName(e.ziel) ? new BildWidget(A, { art: "lokal", ziel: e.ziel, von, breite: e.breite, alt: e.alt, erlaubt: true }) : new DateiWidget(A, e.ziel, von));
      }
    }
    if (text.includes("![")) {
      CM.syntaxTree(state).iterate({ from: a0, to: b0, enter: (n) => {
        if (n.name !== "Image") return;
        if (belegt.some(([a, b]) => n.from >= a && n.from < b)) return false;
        const m = MD_BILD.exec(doc.sliceString(n.from, n.to));
        if (!m) return false;
        const alt = m[1].trim();
        let ziel = m[2].replace(/^<|>$/g, "");
        if (!ziel) return false;
        if (DATA_BILD.test(ziel)) { if (ziel.length <= MAX_DATA) setze(n.from, n.to, new BildWidget(A, { art: "data", ziel, von, breite: null, alt, erlaubt: true })); return false; }
        if (/^[a-z][a-z0-9+.-]*:/i.test(ziel) || ziel.startsWith("//")) { // Adresse: nie ungefragt laden
          if (!/^(https?):\/\//i.test(ziel)) return false; // mailto:, file:, javascript: … bleiben Text
          if (A.externErlaubt(ziel) && /^https:/i.test(ziel)) setze(n.from, n.to, new BildWidget(A, { art: "extern", ziel, von, breite: null, alt, erlaubt: true }));
          else setze(n.from, n.to, new PlatzhalterWidget(A, ziel, alt));
          return false;
        }
        const pfad = lokalerPfad(ziel);
        if (!pfad || !istBildName(pfad)) return false; // kein Bild (z. B. ![x](a.pdf)): bleibt, wie es ist
        setze(n.from, n.to, new BildWidget(A, { art: "lokal", ziel: pfad, von, breite: null, alt, erlaubt: true }));
        return false;
      } });
    }
  }
  return Decoration.set(liste, true);
}

const hatDateien = (dt) => !!dt && [...(dt.types || [])].includes("Files");

// A: erzeugeAnhaenge(...) aus anhaenge.js · ctx: { roh(), pfad() }
export function anhangErweiterung(A, ctx) {
  const plugin = ViewPlugin.fromClass(class {
    constructor(view) { this.deko = dekos(view, A, ctx); A.beiNeuZeichnen(() => { try { view.dispatch({ effects: neuBauen.of(null) }); } catch { /* View weg */ } }); }
    update(u) {
      if (u.docChanged || u.selectionSet || u.viewportChanged || u.focusChanged || u.transactions.some((t) => t.effects.length) || CM.syntaxTree(u.startState) !== CM.syntaxTree(u.state)) this.deko = dekos(u.view, A, ctx);
    }
  }, { decorations: (v) => v.deko });

  const handler = EditorView.domEventHandlers({
    paste(e, view) {
      const dt = e.clipboardData;
      if (!dt) return false;
      const dateien = [...(dt.files || [])];
      if (!dateien.length) for (const it of dt.items || []) if (it.kind === "file") { const f = it.getAsFile(); if (f) dateien.push(f); }
      if (dateien.length) {
        // Aus Excel/Word kommt neben dem Text ein Vorschaubild: nur Bilder und dazu Text = der Text gewinnt (Dateien aus dem Finder sind keine Bilder oder haben keinen Fließtext)
        const nurBilder = dateien.every((f) => /^image\//.test(f.type));
        const text = dt.getData("text/plain");
        if (nurBilder && text && text.trim() && !/^(file:\/\/|https?:\/\/)\S+$/.test(text.trim())) return false;
        e.preventDefault();
        A.dateien(dateien, null);
        return true;
      }
      if (hatDateien(dt)) { e.preventDefault(); A.pasteLeerHinweis(); return true; } // „Files“ im Typ, aber keine Bytes: die Hülle gibt sie nicht her
      return false;
    },
    dragover(e, view) {
      if (!hatDateien(e.dataTransfer)) return false;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = "copy"; } catch { /* egal */ }
      view.dom.classList.add("anhang-ziehen");
      return true;
    },
    dragleave(e, view) { if (!view.dom.contains(e.relatedTarget)) view.dom.classList.remove("anhang-ziehen"); return false; },
    dragend(e, view) { view.dom.classList.remove("anhang-ziehen"); return false; },
    drop(e, view) {
      view.dom.classList.remove("anhang-ziehen");
      const dateien = [...(e.dataTransfer?.files || [])];
      if (!dateien.length) { if (hatDateien(e.dataTransfer)) { e.preventDefault(); A.pasteLeerHinweis(); return true; } return false; }
      e.preventDefault();
      A.dateien(dateien, view.posAtCoords({ x: e.clientX, y: e.clientY }));
      return true;
    },
  });
  return [plugin, handler];
}
