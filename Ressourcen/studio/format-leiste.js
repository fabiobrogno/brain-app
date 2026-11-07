// Schwebende Format-Leiste (Runde 3b): eine kleine Leiste über markiertem Text — Fett, Kursiv, Durchgestrichen, Code, Link | Überschrift 1–3 | Aufzählung, Nummerierung, Aufgabe.
// Stil wie bei Orca und Notion, aber aus eigenen Bausteinen (format-leiste.css, Tokens des Studios). Sie erscheint erst, wenn die Maustaste los ist; Klicks darauf nehmen
// dem Editor weder Fokus noch Auswahl (mousedown wird abgefangen). Abschaltbar unter Einstellungen → Darstellung (ctx.formatLeiste?.() → false).
import * as CM from "./vendor/codemirror.bundle.js";
import { BEFEHLE, zustandAnAuswahl } from "./formatieren.js";
import { TF3 } from "./texte-format.js";
import { symbol } from "./symbole.js";

const TX = TF3.format;
const MAX_ZEICHEN = 4000; // über sehr langer Auswahl hat die Leiste nichts zu tun

// [Befehl, Beschriftung, Inhalt, Klasse, Zustandsschlüssel (Wert)]
const GRUPPEN = [
  [
    ["fett", TX.fett, () => "B", "fl-fett", "fett"],
    ["kursiv", TX.kursiv, () => "I", "fl-kursiv", "kursiv"],
    ["durchgestrichen", TX.durchgestrichen, () => "S", "fl-durch", "durch"],
    ["code", TX.code, () => symbol("code", 15), "", "code"],
    ["link", TX.link, () => symbol("link", 15), "", "link"],
  ],
  [
    ["ueberschrift1", TX.ueberschrift(1), () => "H1", "fl-text", ["ueberschrift", 1]],
    ["ueberschrift2", TX.ueberschrift(2), () => "H2", "fl-text", ["ueberschrift", 2]],
    ["ueberschrift3", TX.ueberschrift(3), () => "H3", "fl-text", ["ueberschrift", 3]],
  ],
  [
    ["listePunkt", TX.listePunkt, () => "•", "fl-text", ["liste", "punkt"]],
    ["listeNummer", TX.listeNummer, () => "1.", "fl-text", ["liste", "nummer"]],
    ["listeAufgabe", TX.listeAufgabe, () => symbol("aufgaben", 15), "", ["liste", "aufgabe"]],
  ],
];

export function formatLeiste(ctx = {}) {
  return CM.ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view;
      this.gedrueckt = false;
      this.el = null;
      this.knoepfe = [];
      this.plan = 0;
      this.hoch = () => { if (this.gedrueckt) { this.gedrueckt = false; this.plane(); } };
      this.runter = (e) => { if (e.button === 0 && !this.el?.contains(e.target)) { this.gedrueckt = true; this.verberge(); } };
      this.scroll = () => { if (this.el?.dataset.offen === "ja") this.plane(); };
      view.dom.addEventListener("mousedown", this.runter);
      view.dom.ownerDocument.addEventListener("mouseup", this.hoch, true);
      view.scrollDOM.addEventListener("scroll", this.scroll, { passive: true });
      window.addEventListener("resize", this.scroll);
    }
    update(u) {
      if (u.selectionSet || u.docChanged || u.focusChanged || u.geometryChanged || u.viewportChanged) this.plane();
    }
    destroy() {
      cancelAnimationFrame(this.plan);
      this.view.dom.removeEventListener("mousedown", this.runter);
      this.view.dom.ownerDocument.removeEventListener("mouseup", this.hoch, true);
      this.view.scrollDOM.removeEventListener("scroll", this.scroll);
      window.removeEventListener("resize", this.scroll);
      this.el?.remove();
    }
    plane() {
      cancelAnimationFrame(this.plan);
      this.plan = requestAnimationFrame(() => this.zeige());
    }
    baue() {
      const el = document.createElement("div");
      el.className = "format-leiste";
      el.setAttribute("role", "toolbar");
      el.setAttribute("aria-label", TX.leiste);
      el.dataset.offen = "nein";
      GRUPPEN.forEach((g, i) => {
        if (i) { const t = document.createElement("span"); t.className = "fl-trenner"; t.setAttribute("role", "separator"); el.append(t); }
        for (const [befehl, name, inhalt, klasse, schluessel] of g) {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "fl-knopf " + klasse;
          b.dataset.befehl = befehl;
          b.title = name; b.setAttribute("aria-label", name); b.setAttribute("aria-pressed", "false");
          const c = inhalt();
          if (typeof c === "string") b.textContent = c; else b.append(c);
          b.addEventListener("mousedown", (e) => { e.preventDefault(); if (e.button === 0) { BEFEHLE[befehl](this.view); this.plane(); } });
          b.addEventListener("click", (e) => e.preventDefault());
          b.tabIndex = -1;
          el.append(b);
          this.knoepfe.push([b, schluessel]);
        }
      });
      el.addEventListener("mousedown", (e) => e.preventDefault());
      document.body.append(el);
      return el;
    }
    verberge() {
      cancelAnimationFrame(this.plan);
      if (this.el && this.el.dataset.offen !== "nein") this.el.dataset.offen = "nein";
    }
    zeige() {
      const v = this.view, st = v.state, r = st.selection.main;
      const an = ctx.formatLeiste?.() !== false && !r.empty && !this.gedrueckt && v.hasFocus && !st.readOnly && st.selection.ranges.length === 1 && r.to - r.from <= MAX_ZEICHEN
        && document.documentElement.dataset.einrichtung !== "offen";
      if (!an || !st.doc.sliceString(r.from, r.to).trim()) { this.verberge(); return; }
      const a = v.coordsAtPos(r.from, 1), b = v.coordsAtPos(r.to, -1);
      if (!a || !b) { this.verberge(); return; }
      if (!this.el) this.el = this.baue();
      const z = zustandAnAuswahl(st);
      for (const [knopf, s] of this.knoepfe) {
        const an2 = Array.isArray(s) ? z[s[0]] === s[1] : !!z[s];
        const alt = knopf.getAttribute("aria-pressed");
        if (alt !== String(an2)) knopf.setAttribute("aria-pressed", String(an2));
      }
      const el = this.el;
      const rand = v.scrollDOM.getBoundingClientRect();
      // Sichtbarer Teil der Auswahl liegt außerhalb des Editors (weggescrollt): keine Leiste
      if (b.bottom < rand.top || a.top > rand.bottom) { this.verberge(); return; }
      el.dataset.offen = "ja";
      const w = el.offsetWidth, h = el.offsetHeight;
      const mitte = a.top === b.top ? (a.left + b.right) / 2 : a.left + 40;
      let links = Math.min(Math.max(mitte - w / 2, rand.left + 8), Math.max(rand.left + 8, rand.right - w - 8));
      let oben = a.top - h - 8;
      if (oben < rand.top + 4) oben = Math.min(b.bottom + 8, rand.bottom - h - 4);
      el.style.left = Math.round(links) + "px";
      el.style.top = Math.round(oben) + "px";
    }
  });
}
