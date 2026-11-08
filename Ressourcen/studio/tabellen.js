// Markdown-Tabellen im Editor (Runde 3b): Anzeige als Tabelle (Live-Vorschau), Zellen direkt bearbeiten, Tab/⇧Tab/Enter, Spalten werden beim Schreiben ausgerichtet, Kontextmenü.
// Der Text im Dokument bleibt eine ganz normale Markdown-Tabelle: jede Eingabe in einer Zelle schreibt die ganze Tabelle ausgerichtet zurück (nur die geänderte Stelle wird ersetzt).
// Steht der Cursor in der Tabelle (Rohtext, Klick ins „Als Text bearbeiten“, Pfeiltasten von außen) oder gilt der Rohtext-Modus, bleibt der Quelltext sichtbar; Tab, ⇧Tab und Enter
// arbeiten dort genauso. Die reine Logik steht in tabellen-logik.js (auch in Node getestet), die Bausteine (Menü) kommen aus menue.js.
import * as CM from "./vendor/codemirror.bundle.js";
import * as L from "./tabellen-logik.js";
import { TF3 } from "./texte-format.js";
import { oeffneMenue } from "./menue.js";

const { StateField, Decoration, WidgetType, EditorView, EditorSelection, Prec, keymap } = CM;
const T3 = TF3.tabelle;

// ---------- Tabellen im Dokument finden ----------
// Nur Tabellen auf oberster Ebene (nicht in Listen oder Zitaten): dort stehen sie am Zeilenanfang und ein Block-Widget passt
export function tabellenBereiche(state) {
  const liste = [];
  CM.syntaxTree(state).iterate({ enter: (n) => { if (n.name === "Table") { if (n.node.parent?.name === "Document") liste.push({ von: n.from, bis: n.to }); return false; } } });
  return liste;
}
// Die Tabelle, in der der Cursor steht (Rohtext): { von, bis } oder null
export function tabelleAmCursor(state, pos = state.selection.main.head) {
  for (const b of tabellenBereiche(state)) if (pos >= b.von && pos <= b.bis) return b;
  return null;
}

// ---------- Zeichnen einer Zelle ----------
const AUSZEICHNUNG = /[*`~\[]|<br>/;
const TEIL = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|(\*[^*\n]+\*)|(\[\[[^\]\n]+\]\])|(\[[^\]\n]*\]\([^)\s]*\))|(<br>)/g;
function zeichneInline(el, roh) {
  el.textContent = "";
  let ende = 0;
  const text = (t) => { if (t) el.append(document.createTextNode(t)); };
  const span = (klasse, t) => { const s = document.createElement("span"); s.className = klasse; s.textContent = t; el.append(s); };
  for (const m of roh.matchAll(TEIL)) {
    text(roh.slice(ende, m.index));
    const t = m[0];
    if (m[1]) span("cm-code", t.slice(1, -1));
    else if (m[2]) span("cm-fett", t.slice(2, -2));
    else if (m[3]) span("cm-durch", t.slice(2, -2));
    else if (m[4]) span("cm-kursiv", t.slice(1, -1));
    else if (m[5]) span("cm-wiki", t.slice(2, -2).split("|").pop().replace(/#.*/, ""));
    else if (m[6]) span("cm-link", t.slice(1, t.indexOf("](")));
    else if (m[7]) el.append(document.createElement("br"));
    ende = m.index + t.length;
  }
  text(roh.slice(ende));
}
// Eine Zelle ruhend (gerendert) oder in Bearbeitung (roh) zeigen; das Rohe steht in data-roh
function zeigeZelle(el, roh, bearbeitung) {
  el.dataset.roh = roh;
  if (bearbeitung || !AUSZEICHNUNG.test(roh)) { if (el.textContent !== roh) el.textContent = roh; el.dataset.gerendert = "0"; }
  else { zeichneInline(el, roh); el.dataset.gerendert = "1"; }
}
const rohVon = (el) => (el.dataset.gerendert === "1" ? el.dataset.roh : el.textContent.replace(/[\r\n]+/g, " "));

// ---------- Caret in einer Zelle ----------
function setzeAuswahl(el, von, bis = von) {
  const sel = el.ownerDocument.getSelection();
  const r = el.ownerDocument.createRange();
  const t = el.firstChild;
  if (t && t.nodeType === 3) { r.setStart(t, Math.min(von, t.length)); r.setEnd(t, Math.min(bis, t.length)); } else { r.selectNodeContents(el); r.collapse(false); }
  sel.removeAllRanges(); sel.addRange(r);
}
function auswahlIn(el) {
  const sel = el.ownerDocument.getSelection();
  if (!sel.rangeCount || !el.contains(sel.anchorNode)) return null;
  const r = sel.getRangeAt(0);
  const vor = el.ownerDocument.createRange();
  vor.selectNodeContents(el); vor.setEnd(r.startContainer, r.startOffset);
  const von = vor.toString().length;
  return { von, bis: von + r.toString().length };
}

// ---------- Schreiben in das Dokument ----------
// Achtung: Tabellentext immer mit doc.sliceString (Zeilenumbruch "\n", ein Zeichen = eine Position); state.sliceDoc nähme das Zeilenende der Datei (CRLF = zwei Zeichen) und verschöbe alle Stellen.
const bereichVon = (view, huelle) => {
  let pos;
  try { pos = view.posAtDOM(huelle); } catch { return null; }
  return tabellenBereiche(view.state).find((b) => pos >= b.von && pos <= b.bis) || null;
};
const zeileEnde = (view) => view.state.lineBreak;

// Ändert die Tabelle über ein Modell → Modell; schreibt nur die geänderte Stelle. Gibt den Bereich zurück (oder null)
function aendere(view, b, f, userEvent = "input.tabelle") {
  const alt = view.state.doc.sliceString(b.von, b.bis);
  const m = L.parseTabelle(alt);
  if (!m) return null;
  const m2 = f(m);
  if (!m2 || m2 === m) return b;
  const neu = L.baueTabelle(m2).text;
  const d = L.kleinsteAenderung(alt, neu);
  if (d.von === d.bis && !d.einfuegen) return b;
  view.dispatch({ changes: { from: b.von + d.von, to: b.von + d.bis, insert: d.einfuegen.replace(/\n/g, zeileEnde(view)) }, userEvent });
  return b;
}

// Eine Zelle nach dem Neuzeichnen fokussieren (die Tabelle wird bei Zeilen/Spalten neu gebaut): sucht die Tabelle über ihre Position
function fokussiere(view, von, z, s, waehle = true, versuche = 6) {
  const los = () => {
    for (const huelle of view.dom.querySelectorAll(".cm-tabelle-huelle")) {
      let pos = -1;
      try { pos = view.posAtDOM(huelle); } catch { /* noch nicht eingebaut */ }
      if (pos !== von) continue;
      const zelle = huelle.querySelector(`[data-z="${z}"][data-s="${s}"] .cm-tz`);
      if (!zelle) continue;
      zelle.focus({ preventScroll: false });
      const n = zelle.textContent.length;
      setzeAuswahl(zelle, waehle ? 0 : n, n);
      zelle.scrollIntoView?.({ block: "nearest" });
      return true;
    }
    return false;
  };
  // sofort (die Zelle ist meist schon da, die nächste Taste soll hineingehen), sonst nach dem Zeichnen
  if (los()) return;
  const spaeter = () => { if (!los() && versuche-- > 0) requestAnimationFrame(spaeter); };
  requestAnimationFrame(spaeter);
}

// Aus der Tabelle heraus: Cursor hinter bzw. vor die Tabelle (und in den Editor)
function verlasse(view, b, nachUnten) {
  let pos;
  if (nachUnten) {
    if (b.bis >= view.state.doc.length) { view.dispatch({ changes: { from: b.bis, insert: zeileEnde(view) } }); pos = b.bis + 1; }
    else pos = b.bis + 1;
  } else pos = Math.max(0, b.von - 1);
  view.dispatch({ selection: EditorSelection.cursor(Math.min(pos, view.state.doc.length)), scrollIntoView: true });
  view.focus();
}

// ---------- Kontextmenü ----------
function oeffneZellenMenue(view, huelle, zelle, e) {
  const b = bereichVon(view, huelle);
  if (!b) return;
  const td = zelle.closest("[data-z]");
  const z = +td.dataset.z, s = +td.dataset.s;
  const anker = document.createElement("span");
  anker.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;width:1px;height:1px;pointer-events:none`;
  document.body.append(anker);
  const tun = (f, fokus) => () => { const r = aendere(view, b, f); if (r && fokus) fokussiere(view, b.von, fokus.z, fokus.s); };
  const m = L.parseTabelle(view.state.doc.sliceString(b.von, b.bis));
  const n = m ? m.ausr.length : 1, zeilen = m ? m.zeilen.length : 1;
  const ausr = m?.ausr[s] ?? null;
  const eintraege = [
    { name: T3.zeileOben, id: "tab-zeile-oben", tun: tun((x) => L.zeileEinfuegen(x, Math.max(1, z)), { z: Math.max(1, z), s }) },
    { name: T3.zeileUnten, id: "tab-zeile-unten", tun: tun((x) => L.zeileEinfuegen(x, z + 1), { z: z + 1, s }) },
    ...(z > 0 ? [{ name: T3.zeileLoeschen, id: "tab-zeile-loeschen", gefahr: true, tun: tun((x) => L.zeileLoeschen(x, z), { z: Math.min(z, zeilen - 2), s }) }] : []),
    { trenner: true },
    { name: T3.spalteLinks, id: "tab-spalte-links", tun: tun((x) => L.spalteEinfuegen(x, s), { z, s }) },
    { name: T3.spalteRechts, id: "tab-spalte-rechts", tun: tun((x) => L.spalteEinfuegen(x, s + 1), { z, s: s + 1 }) },
    ...(n > 1 ? [{ name: T3.spalteLoeschen, id: "tab-spalte-loeschen", gefahr: true, tun: tun((x) => L.spalteLoeschen(x, s), { z, s: Math.min(s, n - 2) }) }] : []),
    { trenner: true },
    { gruppe: T3.ausrichtung },
    { name: T3.links, id: "tab-links", haken: ausr === "l", tun: tun((x) => L.ausrichtungSetzen(x, s, "l")) },
    { name: T3.mitte, id: "tab-mitte", haken: ausr === "c", tun: tun((x) => L.ausrichtungSetzen(x, s, "c")) },
    { name: T3.rechts, id: "tab-rechts", haken: ausr === "r", tun: tun((x) => L.ausrichtungSetzen(x, s, "r")) },
    { trenner: true },
    { name: T3.quelltext, id: "tab-quelltext", tun: () => { view.dispatch({ selection: EditorSelection.cursor(b.von), scrollIntoView: true }); view.focus(); } },
    { name: T3.loeschen, id: "tab-loeschen", gefahr: true, tun: () => { const bis = Math.min(view.state.doc.length, b.bis + 1); view.dispatch({ changes: { from: b.von, to: bis }, userEvent: "delete.tabelle" }); } },
  ];
  oeffneMenue(anker, eintraege, { beiZu: () => { anker.remove(); if (zelle.isConnected) zelle.focus({ preventScroll: true }); }, klasse: "tabellen-menue" });
}

// ---------- Das Widget ----------
const ausrKlasse = (a) => (a === "c" ? "center" : a === "r" ? "right" : "left");

function baueZelle(m, z, s) {
  const td = document.createElement(z === 0 ? "th" : "td");
  td.dataset.z = String(z); td.dataset.s = String(s);
  if (z === 0) td.setAttribute("scope", "col");
  td.style.textAlign = ausrKlasse(m.ausr[s]);
  const el = document.createElement("div");
  el.className = "cm-tz";
  el.contentEditable = "plaintext-only";
  if (el.contentEditable !== "plaintext-only") el.contentEditable = "true";
  el.spellcheck = true;
  el.setAttribute("role", "textbox");
  el.setAttribute("aria-label", z === 0 ? T3.kopfzelle(s + 1) : T3.zelle(z, s + 1));
  zeigeZelle(el, m.zeilen[z][s], false);
  td.append(el);
  return td;
}

function baueDom(view, text) {
  const m = L.parseTabelle(text);
  const huelle = document.createElement("div");
  huelle.className = "cm-tabelle-huelle";
  const tab = document.createElement("table");
  tab.className = "cm-tabelle";
  tab.setAttribute("aria-label", T3.beschriftung);
  const kopf = tab.createTHead().insertRow();
  m.zeilen[0].forEach((_, s) => kopf.append(baueZelle(m, 0, s)));
  const rumpf = tab.createTBody();
  for (let z = 1; z < m.zeilen.length; z++) { const tr = rumpf.insertRow(); m.zeilen[z].forEach((_, s) => tr.append(baueZelle(m, z, s))); }
  huelle.append(tab);
  const plus = document.createElement("button");
  plus.type = "button"; plus.className = "cm-tab-plus"; plus.textContent = "+"; plus.title = T3.zeileHinzu; plus.setAttribute("aria-label", T3.zeileHinzu); plus.tabIndex = -1;
  plus.addEventListener("mousedown", (e) => e.preventDefault());
  plus.addEventListener("click", (e) => {
    e.preventDefault();
    const b = bereichVon(view, huelle);
    if (!b) return;
    const anzahl = L.parseTabelle(view.state.doc.sliceString(b.von, b.bis))?.zeilen.length ?? 1;
    aendere(view, b, (x) => L.zeileEinfuegen(x, x.zeilen.length), "input.tabelle");
    fokussiere(view, b.von, anzahl, 0);
  });
  huelle.append(plus);
  verdrahte(view, huelle);
  return huelle;
}

// Gleicher Aufbau (Zeilen, Spalten)? Dann nur die Inhalte nachziehen, die Zelle in Bearbeitung bleibt unberührt
function gleicheForm(dom, m) {
  const zeilen = dom.querySelectorAll("tr");
  if (zeilen.length !== m.zeilen.length) return false;
  return [...zeilen].every((tr) => tr.children.length === m.ausr.length);
}
function gleiche(dom, m) {
  const aktiv = dom.ownerDocument.activeElement;
  dom.querySelectorAll("[data-z]").forEach((td) => {
    const z = +td.dataset.z, s = +td.dataset.s, el = td.firstChild;
    td.style.textAlign = ausrKlasse(m.ausr[s]);
    const neu = m.zeilen[z][s];
    // Die Zelle in Bearbeitung bleibt, wie sie ist (Leerzeichen am Rand zählen in Markdown nicht und gingen sonst beim Tippen verloren); nur ein anderer Text (Rückgängig) ersetzt sie
    if (el === aktiv) { if (el.textContent.trim() !== neu) { el.textContent = neu; setzeAuswahl(el, neu.length); } el.dataset.roh = neu; }
    else if (el.dataset.roh !== neu) zeigeZelle(el, neu, false);
  });
}

class TabellenWidget extends WidgetType {
  constructor(text) { super(); this.text = text; }
  eq(o) { return o.text === this.text; }
  toDOM(view) { return baueDom(view, this.text); }
  updateDOM(dom, view) {
    const m = L.parseTabelle(this.text);
    if (!m || !gleicheForm(dom, m)) return false;
    gleiche(dom, m);
    return true;
  }
  get estimatedHeight() { return (this.text.split("\n").length - 1) * 34 + 20; }
  ignoreEvent() { return true; } // Klicks, Tasten und Auswahl in den Zellen gehören den Zellen, nicht dem Editor
  destroy() { /* nichts aufzuräumen: die Verdrahtung hängt am Element */ }
}

// Tastatur und Maus in den Zellen
function verdrahte(view, huelle) {
  const zelleVon = (e) => e.target.closest?.(".cm-tz");
  const uebernimm = (zelle) => {
    const b = bereichVon(view, huelle);
    if (!b) return;
    const td = zelle.closest("[data-z]");
    const z = +td.dataset.z, s = +td.dataset.s, roh = rohVon(zelle);
    zelle.dataset.roh = roh;
    aendere(view, b, (m) => (m.zeilen[z]?.[s] === roh ? m : L.mitZelle(m, z, s, roh)));
  };
  huelle.addEventListener("focusin", (e) => {
    const zelle = zelleVon(e);
    if (!zelle) return;
    if (zelle.dataset.gerendert === "1") { zeigeZelle(zelle, zelle.dataset.roh, true); setzeAuswahl(zelle, zelle.textContent.length); }
    huelle.classList.add("cm-tabelle-aktiv");
  });
  huelle.addEventListener("focusout", (e) => {
    const zelle = zelleVon(e);
    if (!zelle) return;
    if (!huelle.contains(e.relatedTarget)) huelle.classList.remove("cm-tabelle-aktiv");
    if (!zelle.isConnected) return;
    const roh = rohVon(zelle);
    if (zelle.dataset.gerendert !== "1") { zelle.dataset.roh = roh; zeigeZelle(zelle, roh, false); }
  });
  huelle.addEventListener("input", (e) => { const zelle = zelleVon(e); if (zelle && !e.isComposing) uebernimm(zelle); });
  huelle.addEventListener("compositionend", (e) => { const zelle = zelleVon(e); if (zelle) uebernimm(zelle); });
  huelle.addEventListener("paste", (e) => { // in einer Zelle gibt es nur Text in einer Zeile
    const zelle = zelleVon(e);
    if (!zelle) return;
    e.preventDefault();
    const t = (e.clipboardData?.getData("text/plain") || "").replace(/[\r\n]+/g, " ");
    if (t) { zelle.ownerDocument.execCommand("insertText", false, t); }
  });
  huelle.addEventListener("contextmenu", (e) => {
    const zelle = zelleVon(e);
    if (!zelle) return;
    e.preventDefault();
    oeffneZellenMenue(view, huelle, zelle, e);
  });
  huelle.addEventListener("keydown", (e) => {
    const zelle = zelleVon(e);
    if (!zelle || e.isComposing) return;
    const b = bereichVon(view, huelle);
    if (!b) return;
    const td = zelle.closest("[data-z]");
    const z = +td.dataset.z, s = +td.dataset.s;
    const m = L.parseTabelle(view.state.doc.sliceString(b.von, b.bis));
    if (!m) return;
    const mod = e.metaKey || e.ctrlKey || e.altKey;
    const geh = (ziel) => { e.preventDefault(); e.stopPropagation(); if (ziel) fokussiere(view, b.von, ziel.zeile, ziel.spalte); };
    if (e.key === "Tab" && !mod) {
      const ziel = L.naechsteZelle(m, z, s, e.shiftKey);
      if (!ziel) { e.preventDefault(); verlasse(view, b, false); return; }
      if (ziel.neueZeile) { geh(null); aendere(view, b, (x) => L.zeileEinfuegen(x, x.zeilen.length)); fokussiere(view, b.von, m.zeilen.length, 0); return; }
      geh(ziel);
    } else if (e.key === "Enter" && !mod) {
      e.preventDefault(); e.stopPropagation();
      if (e.shiftKey) return; // eine Zelle hat nur eine Zeile
      const neu = Math.max(1, z + 1);
      aendere(view, b, (x) => L.zeileEinfuegen(x, neu));
      fokussiere(view, b.von, neu, s);
    } else if (e.key === "Escape") {
      e.preventDefault(); e.stopPropagation();
      verlasse(view, b, true);
    } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !mod && !e.shiftKey) {
      const unten = e.key === "ArrowDown", ziel = z + (unten ? 1 : -1);
      e.preventDefault(); e.stopPropagation();
      if (ziel < 0) verlasse(view, b, false);
      else if (ziel >= m.zeilen.length) verlasse(view, b, true);
      else fokussiere(view, b.von, ziel, s, false);
    } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !mod && !e.shiftKey) {
      const a = auswahlIn(zelle), n = zelle.textContent.length;
      if (!a || a.von !== a.bis) return;
      if (e.key === "ArrowLeft" && a.von === 0) { const ziel = L.naechsteZelle(m, z, s, true); if (ziel) { geh(ziel); fokussiere(view, b.von, ziel.zeile, ziel.spalte, false); } }
      else if (e.key === "ArrowRight" && a.von === n) { const ziel = L.naechsteZelle(m, z, s, false); if (ziel && !ziel.neueZeile) { geh(ziel); fokussiere(view, b.von, ziel.zeile, ziel.spalte, false); } }
    }
  });
}

// Formatieren in der Zelle (⌘B, ⌘I …): dieselben Marken wie im Text, auf den Text der Zelle. → true, wenn eine Zelle den Fokus hat
const ZELLEN_MARKEN = { fett: "**", kursiv: "*", code: "`", durch: "~~" };
export const zelleHatFokus = (doc = document) => !!doc.activeElement?.classList?.contains("cm-tz");
export function zelleUmschalten(art, doc = document) {
  const el = doc.activeElement;
  if (!el?.classList?.contains("cm-tz")) return false;
  const a = auswahlIn(el) || { von: el.textContent.length, bis: el.textContent.length };
  const t = el.textContent;
  let neu, von, bis;
  if (art === "link") {
    const sel = t.slice(a.von, a.bis) || "Linktext";
    neu = t.slice(0, a.von) + `[${sel}](https://)` + t.slice(a.bis);
    von = a.von + sel.length + 3; bis = von + 8;
  } else {
    const m = ZELLEN_MARKEN[art];
    if (!m) return false;
    const n = m.length;
    const aussen = t.slice(a.von - n, a.von) === m && t.slice(a.bis, a.bis + n) === m && a.bis > a.von;
    const innen = a.bis - a.von >= 2 * n && t.slice(a.von, a.von + n) === m && t.slice(a.bis - n, a.bis) === m;
    if (aussen) { neu = t.slice(0, a.von - n) + t.slice(a.von, a.bis) + t.slice(a.bis + n); von = a.von - n; bis = a.bis - n; }
    else if (innen) { neu = t.slice(0, a.von) + t.slice(a.von + n, a.bis - n) + t.slice(a.bis); von = a.von; bis = a.bis - 2 * n; }
    else { neu = t.slice(0, a.von) + m + t.slice(a.von, a.bis) + m + t.slice(a.bis); von = a.von + n; bis = a.bis + n; }
  }
  el.textContent = neu;
  setzeAuswahl(el, von, bis);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

// ---------- Zustand und Dekorationen ----------
export function tabellenErweiterung(ctx, { neuZeichnen, fokusGeaendert }) {
  const baue = (state, roh, fokus) => {
    if (roh) return Decoration.none;
    const liste = [];
    for (const b of tabellenBereiche(state)) {
      if (fokus && state.selection.ranges.some((r) => r.head >= b.von && r.head <= b.bis)) continue; // der Cursor ist drin: Quelltext zeigen
      const text = state.doc.sliceString(b.von, b.bis);
      if (!L.parseTabelle(text)) continue;
      liste.push(Decoration.replace({ widget: new TabellenWidget(text), block: true }).range(b.von, b.bis));
    }
    return Decoration.set(liste, true);
  };
  const feld = StateField.define({
    create(state) { const w = { roh: !!ctx.roh?.(), fokus: false }; w.deko = baue(state, w.roh, w.fokus); return w; },
    update(w, tr) {
      let { roh, fokus } = w, neu = false;
      for (const e of tr.effects) {
        if (e.is(fokusGeaendert) && e.value !== fokus) { fokus = e.value; neu = true; }
        else if (e.is(neuZeichnen)) { roh = !!ctx.roh?.(); neu = true; }
      }
      if (!neu && !tr.docChanged && !tr.selection && CM.syntaxTree(tr.state) === CM.syntaxTree(tr.startState)) return w;
      const n = { roh, fokus };
      n.deko = baue(tr.state, roh, fokus);
      return n;
    },
    provide: (f) => EditorView.decorations.from(f, (w) => w.deko),
  });
  return [feld, Prec.high(keymap.of([
    { key: "Tab", run: (v) => rohTab(v, false) },
    { key: "Shift-Tab", run: (v) => rohTab(v, true) },
    { key: "Enter", run: (v) => rohEnter(v) },
  ]))];
}

// ---------- Rohtext: Tab, ⇧Tab, Enter in einer Tabelle ----------
function rohOrt(view) {
  const r = view.state.selection.main;
  if (view.state.readOnly) return null;
  const b = tabelleAmCursor(view.state, r.head);
  if (!b || r.from < b.von || r.to > b.bis) return null; // auch eine markierte Zelle (nach Tab) zählt, solange die Auswahl in der Tabelle bleibt
  const text = view.state.doc.sliceString(b.von, b.bis);
  const m = L.parseTabelle(text);
  if (!m) return null;
  const ort = L.zellenOrt(text, r.head - b.von);
  return { b, m, ort, text };
}
function setzeTabelle(view, b, text, m, ziel) {
  const neu = L.baueTabelle(m);
  const d = L.kleinsteAenderung(text, neu.text);
  const start = neu.starts[ziel.zeile][ziel.spalte];
  const len = L.schuetze(m.zeilen[ziel.zeile][ziel.spalte]).length;
  view.dispatch({
    changes: d.von === d.bis && !d.einfuegen ? undefined : { from: b.von + d.von, to: b.von + d.bis, insert: d.einfuegen.replace(/\n/g, zeileEnde(view)) },
    selection: EditorSelection.range(b.von + start, b.von + start + len),
    userEvent: "input.tabelle", scrollIntoView: true,
  });
}
function rohTab(view, rueckwaerts) {
  const w = rohOrt(view);
  if (!w) return false;
  const { b, m, text } = w;
  let { zeile, spalte } = w.ort;
  spalte = Math.min(spalte, m.ausr.length - 1);
  let ziel;
  if (zeile === "trenner") ziel = rueckwaerts ? { zeile: 0, spalte: m.ausr.length - 1 } : { zeile: 1 < m.zeilen.length ? 1 : 0, spalte: 0 };
  else ziel = L.naechsteZelle(m, zeile, spalte, rueckwaerts) || { zeile: 0, spalte: 0 };
  let neu = m;
  if (ziel.neueZeile) { neu = L.zeileEinfuegen(m, m.zeilen.length); ziel = { zeile: neu.zeilen.length - 1, spalte: 0 }; }
  setzeTabelle(view, b, text, neu, ziel);
  return true;
}
function rohEnter(view) {
  const w = rohOrt(view);
  if (!w || w.ort.zeile === "trenner") return false;
  const { b, m, text, ort } = w;
  const neu = L.zeileEinfuegen(m, Math.max(1, ort.zeile + 1));
  setzeTabelle(view, b, text, neu, { zeile: Math.max(1, ort.zeile + 1), spalte: Math.min(ort.spalte, m.ausr.length - 1) });
  return true;
}

// ---------- Befehl „Tabelle einfügen“ ----------
// Fügt eine Tabelle (3 Spalten, 2 leere Zeilen) als eigenen Block an der Cursorstelle ein, mit Leerzeile davor und danach.
// Danach steht der Cursor in der ersten Überschrift: in der Tabellenansicht (Fokus in der Zelle), im Rohtext mit markiertem Text.
export function fuegeTabelleEin(view, roh = false) {
  if (view.state.readOnly) return false;
  const st = view.state, lb = st.lineBreak, doc = st.doc;
  const zeile = doc.lineAt(st.selection.main.head);
  let pos, vorne = "", hinten = "";
  const nachfolger = zeile.number < doc.lines ? doc.line(zeile.number + 1) : null;
  if (zeile.text.trim()) { pos = zeile.to; vorne = lb + lb; hinten = nachfolger && !nachfolger.text.trim() ? "" : lb; }
  else { pos = zeile.from; const vor = zeile.number > 1 ? doc.line(zeile.number - 1) : null; if (vor && vor.text.trim()) vorne = lb; hinten = lb; }
  const t = L.neueTabelleText("\n");
  const text = vorne + t.text.replace(/\n/g, lb) + hinten;
  const von = pos + vorne.length;
  const erste = t.starts[0][0];
  view.dispatch({
    changes: { from: pos, insert: text },
    selection: roh ? EditorSelection.range(von + erste, von + erste + "Spalte 1".length) : EditorSelection.cursor(von + t.text.length + lb.length),
    userEvent: "input.tabelle", scrollIntoView: true,
  });
  view.focus();
  if (!roh) fokussiere(view, von, 0, 0, true, 10);
  return true;
}
