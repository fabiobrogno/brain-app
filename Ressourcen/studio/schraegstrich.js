// Schrägstrich-Menü im Editor: „/“ am Zeilenanfang oder nach einem Leerzeichen öffnet ein Menü an der Schreibmarke (Text, Überschriften, Listen, Zitat, Codeblock, Trennlinie,
// Tabelle, Bild/Datei, Link zu Notiz, Datum). Weitertippen filtert (unscharf, deutsch und englisch), ↑ ↓ wählen, ⏎ oder Tab übernimmt, Esc schließt und lässt das „/…“ stehen.
// Alle Befehle benutzen die vorhandenen Editor-Bausteine; das „/Filter“ wird mit der Änderung in EINER Transaktion ersetzt (⌘Z stellt den Zustand davor her).
// Eigenes Element am body (wie die Format-Leiste), Fokus und Auswahl bleiben im Editor; Tastatur über einen Fänger auf der Editor-Hülle, damit die Vervollständigung und die
// Standardtasten nichts davon sehen. Position: nach unten, bei Platzmangel nach oben; die Seite bleibt beim Filtern stehen, das Menü hängt beim Scrollen an der Schreibmarke.
import * as CM from "./vendor/codemirror.bundle.js";
import { symbol, GROESSE } from "./symbole.js";
import { TSM } from "./texte-schraegstrich.js";
import * as L from "./schraegstrich-logik.js";
import { tabelleAnderung, tabelleFokus } from "./tabellen.js";

const { EditorSelection, ChangeSet } = CM;
const MAX_HOEHE = 340;   // Höhe der Liste (px, vor dem Zoom)
const BREITE = 288;
const ABSTAND = 6;
const RAND = 8;

// Einträge in der Reihenfolge des Menüs. kz = Id im Kürzel-Register (zeigt das echte Kürzel), md = Markdown-Zeichen als Hinweis, wenn es kein Kürzel gibt.
const EINTRAEGE = [
  { id: "text", gruppe: "text", sym: "text-absatz", art: "text" },
  { id: "h1", gruppe: "text", sym: "ueberschrift-1", art: "h1", kz: "format-ueberschrift-1", md: "#" },
  { id: "h2", gruppe: "text", sym: "ueberschrift-2", art: "h2", kz: "format-ueberschrift-2", md: "##" },
  { id: "h3", gruppe: "text", sym: "ueberschrift-3", art: "h3", kz: "format-ueberschrift-3", md: "###" },
  { id: "aufgabe", gruppe: "listen", sym: "liste-aufgabe", art: "aufgabe", kz: "format-liste-aufgabe", md: "- [ ]" },
  { id: "punkt", gruppe: "listen", sym: "gliederung", art: "punkt", kz: "format-liste-punkt", md: "-" },
  { id: "nummer", gruppe: "listen", sym: "liste-nummer", art: "nummer", kz: "format-liste-nummer", md: "1." },
  { id: "zitat", gruppe: "bloecke", sym: "zitat", art: "zitat", md: ">" },
  { id: "code", gruppe: "bloecke", sym: "code", md: "```" },
  { id: "trennlinie", gruppe: "bloecke", sym: "trennlinie", md: "---" },
  { id: "tabelle", gruppe: "bloecke", sym: "tabelle" },
  { id: "datei", gruppe: "einfuegen", sym: "bild", braucht: "anhaenge" },
  { id: "notiz", gruppe: "einfuegen", sym: "link", md: "[[", braucht: "wikiVorschlaege" },
  { id: "datum", gruppe: "einfuegen", sym: "kalender-tag" },
].map((e) => ({ ...e, titel: TSM.eintraege[e.id], text: TSM.beschreibung[e.id], woerter: TSM.woerter[e.id] }));

let zaehler = 0;
const zoomFaktor = () => parseFloat(document.documentElement.style.getPropertyValue("--ui-zoom")) || 1;

// Steht an der Schreibmarke ein „/…“, das ein Menü öffnen darf? → { von, bis, filter } oder null. Nicht im Datei-Kopf, in Code, in Links und Wikilinks, nicht mitten im Wort.
export function ausloeser(state, kopfBis = null) {
  const r = state.selection.main;
  if (!r.empty || state.selection.ranges.length > 1 || state.readOnly) return null;
  const zeile = state.doc.lineAt(r.head);
  const vor = state.sliceDoc(zeile.from, r.head), nach = state.sliceDoc(r.head, zeile.to);
  const a = L.findeAusloeser(vor, nach);
  if (!a) return null;
  const von = zeile.from + a.vonSpalte;
  if (kopfBis != null && von <= kopfBis) return null;
  const davor = vor.slice(0, a.vonSpalte);
  if ((davor.match(/`/g) || []).length % 2) return null; // in Code in Backticks
  if (/\]\([^)]*$/.test(davor) || /\[\[[^\]]*$/.test(davor)) return null; // in Link oder Wikilink
  for (let n = CM.syntaxTree(state).resolveInner(von, 1); n; n = n.parent) {
    if (/^(FencedCode|CodeBlock|InlineCode|CodeText|CodeInfo|URL|Autolink|HTMLBlock|CommentBlock|Comment|ProcessingInstructionBlock)$/.test(n.name)) return null;
  }
  return { von, bis: r.head, filter: a.filter };
}

// Ersetzt von…bis (das „/Filter“) und wendet die Änderung auf dem Rest an: EINE Transaktion. bauer(zustandOhneFilter) → { changes, selection, … }
function ersetze(view, von, bis, bauer, opt = {}) {
  const davor = view.state;
  const ohne = davor.update({ changes: { from: von, to: bis }, selection: { anchor: von } }).state;
  const spec = bauer ? bauer(ohne) : null;
  const weg = ChangeSet.of({ from: von, to: bis }, davor.doc.length);
  const aenderung = spec?.changes ? weg.compose(spec.changes instanceof ChangeSet ? spec.changes : ohne.changes(spec.changes)) : weg;
  view.dispatch({ changes: aenderung, selection: spec?.selection || EditorSelection.cursor(von), userEvent: opt.userEvent || "input.schraegstrich", scrollIntoView: true });
  view.focus();
  return spec;
}

export function schraegstrichMenue(ctx = {}) {
  return CM.ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view;
      this.id = ++zaehler;
      this.el = null; this.listeEl = null;
      this.offen = false;
      this.von = 0; this.bis = 0; this.filter = "";
      this.liste = []; this.idx = 0;
      this.verworfen = null;
      this.seite = "unten"; this.max = MAX_HOEHE; this.hoehe = 0;
      this.plan = 0; this.dateiFeld = null;
      this.taste = (e) => this.beiTaste(e);
      this.aussen = (e) => { if (this.offen && !this.el.contains(e.target)) { this.verworfen = this.von; this.schliesse(); } };
      this.neuPlanen = () => { if (this.offen) this.plane(); };
      view.dom.addEventListener("keydown", this.taste, true);
      view.dom.ownerDocument.addEventListener("mousedown", this.aussen, true);
      view.scrollDOM.addEventListener("scroll", this.neuPlanen, { passive: true });
      window.addEventListener("resize", this.neuPlanen);
    }
    destroy() {
      cancelAnimationFrame(this.plan);
      this.view.dom.removeEventListener("keydown", this.taste, true);
      this.view.dom.ownerDocument.removeEventListener("mousedown", this.aussen, true);
      this.view.scrollDOM.removeEventListener("scroll", this.neuPlanen);
      window.removeEventListener("resize", this.neuPlanen);
      this.markiere(false);
      this.el?.remove(); this.dateiFeld?.remove();
    }
    kopfBis() { const b = ctx.kopfBereich?.(this.view.state.doc); return b ? b.bis : null; }

    update(u) {
      if (this.verworfen !== null && u.docChanged) this.verworfen = u.changes.mapPos(this.verworfen, -1);
      if (this.offen && u.docChanged) this.von = u.changes.mapPos(this.von, -1);
      if (!this.offen && !u.docChanged) return;
      if (u.focusChanged && !u.view.hasFocus && this.offen) { this.verworfen = this.von; this.schliesse(); return; }
      const a = u.view.composing ? null : ausloeser(u.state, this.kopfBis());
      if (!a) { this.verworfen = null; if (this.offen) this.schliesse(); return; }
      if (this.verworfen === a.von) { if (this.offen) this.schliesse(); return; }
      if (!this.offen) {
        // geöffnet wird nur durch das Tippen des „/“ selbst (nicht beim Bewegen, Einfügen oder Rückgängig)
        const getippt = u.docChanged && u.transactions.some((t) => t.isUserEvent("input.type")) && a.bis - a.von === 1;
        if (!getippt) return;
        this.oeffne(a);
      } else {
        if (a.von !== this.von) { this.schliesse(); return; }
        this.bis = a.bis;
        if (a.filter !== this.filter) { this.filter = a.filter; this.rendere(); }
        this.plane();
      }
    }

    verfuegbar() {
      return EINTRAEGE.filter((e) => !e.braucht || ctx[e.braucht]);
    }
    oeffne(a) {
      this.von = a.von; this.bis = a.bis; this.filter = a.filter;
      if (!this.el) this.baue();
      this.offen = true; this.idx = 0; this.hoehe = 0;
      this.listeEl.style.maxHeight = "";
      this.rendere();
      // Lage (Seite, Höhe) wird gleich nach dem Update gemessen: der Editor erlaubt währenddessen kein Lesen der Geometrie
      this.neu = true;
      this.el.style.visibility = "hidden";
      this.el.dataset.offen = "ja"; this.el.hidden = false;
      this.markiere(true);
      this.plane();
    }
    schliesse() {
      cancelAnimationFrame(this.plan);
      if (!this.offen) return;
      this.offen = false;
      this.markiere(false);
      if (this.el) this.el.dataset.offen = "nein";
    }
    // Zugänglichkeit: Der Editor meldet sich als Kombinationsfeld mit der Liste und dem gewählten Eintrag (wie die Vervollständigung)
    markiere(an) {
      const c = this.view.contentDOM;
      if (an) {
        if (this.rolleAlt === undefined) this.rolleAlt = c.getAttribute("role");
        c.setAttribute("role", "combobox"); c.setAttribute("aria-expanded", "true"); c.setAttribute("aria-haspopup", "listbox");
        c.setAttribute("aria-autocomplete", "list"); c.setAttribute("aria-controls", this.listeEl.id);
        this.aktiv();
      } else if (this.rolleAlt !== undefined) {
        if (this.rolleAlt === null) c.removeAttribute("role"); else c.setAttribute("role", this.rolleAlt);
        this.rolleAlt = undefined;
        for (const a of ["aria-expanded", "aria-haspopup", "aria-autocomplete", "aria-controls", "aria-activedescendant"]) c.removeAttribute(a);
      }
    }

    baue() {
      const el = document.createElement("div");
      el.className = "sm"; el.dataset.offen = "nein"; el.dataset.schraegstrich = ""; el.hidden = true;
      el.style.width = BREITE + "px";
      const liste = document.createElement("div");
      liste.className = "sm-liste"; liste.id = `sm-liste-${this.id}`; liste.setAttribute("role", "listbox"); liste.setAttribute("aria-label", TSM.menue);
      el.append(liste);
      // Klicks nehmen dem Editor weder Fokus noch Auswahl
      el.addEventListener("mousedown", (e) => e.preventDefault());
      liste.addEventListener("click", (e) => {
        const o = e.target.closest?.("[data-eintrag]");
        if (o) this.waehle(Number(o.dataset.index));
      });
      liste.addEventListener("mousemove", (e) => {
        const o = e.target.closest?.("[data-eintrag]");
        if (o && Number(o.dataset.index) !== this.idx) { this.idx = Number(o.dataset.index); this.aktiv(false); }
      });
      document.body.append(el);
      this.el = el; this.listeEl = liste;
    }

    rendere() {
      const alle = this.verfuegbar();
      this.liste = L.filtere(alle, this.filter);
      if (this.idx >= this.liste.length) this.idx = 0;
      const l = this.listeEl;
      const vorher = l.offsetHeight;
      l.replaceChildren();
      l.scrollTop = 0;
      if (!this.liste.length) {
        // Kein Treffer: die Liste bleibt so hoch wie zuvor (kein Sprung)
        l.style.minHeight = (vorher || this.hoehe) + "px";
        const z = document.createElement("div");
        z.className = "sm-leer"; z.setAttribute("role", "option"); z.setAttribute("aria-disabled", "true"); z.setAttribute("aria-selected", "false"); z.id = `sm-leer-${this.id}`;
        z.textContent = TSM.leer;
        l.append(z);
        return;
      }
      l.style.minHeight = "";
      const gruppiert = !this.filter.trim();
      let gruppe = null, box = l;
      this.liste.forEach((e, i) => {
        if (gruppiert && e.gruppe !== gruppe) {
          gruppe = e.gruppe;
          box = document.createElement("div"); box.setAttribute("role", "group"); box.className = "sm-gruppe";
          const kopf = document.createElement("div");
          kopf.className = "sm-kopf"; kopf.id = `sm-kopf-${this.id}-${gruppe}`; kopf.textContent = TSM.gruppen[gruppe];
          box.setAttribute("aria-labelledby", kopf.id);
          box.append(kopf); l.append(box);
        }
        box.append(this.zeile(e, i));
      });
      this.hoehe = l.offsetHeight;
    }
    zeile(e, i) {
      const o = document.createElement("div");
      o.className = "sm-eintrag"; o.id = `sm-opt-${this.id}-${e.id}`; o.dataset.eintrag = e.id; o.dataset.index = String(i);
      o.setAttribute("role", "option"); o.setAttribute("aria-selected", i === this.idx ? "true" : "false");
      const sym = document.createElement("span"); sym.className = "sm-sym"; sym.append(symbol(e.sym, GROESSE.norm));
      const text = document.createElement("span"); text.className = "sm-text";
      const name = document.createElement("span"); name.className = "sm-name"; name.textContent = e.titel;
      text.append(name);
      o.append(sym, text);
      const hinweis = (e.kz && ctx.kuerzel?.(e.kz)) || e.md || "";
      if (hinweis) { const k = document.createElement("span"); k.className = "sm-kz"; k.textContent = hinweis; o.append(k); }
      return o;
    }
    aktiv(scrolle = true) {
      const l = this.listeEl;
      if (!l) return;
      let aktuell = null;
      for (const o of l.querySelectorAll("[data-eintrag]")) {
        const an = Number(o.dataset.index) === this.idx;
        if (o.getAttribute("aria-selected") !== String(an)) o.setAttribute("aria-selected", String(an));
        if (an) aktuell = o;
      }
      const c = this.view.contentDOM;
      if (aktuell) {
        c.setAttribute("aria-activedescendant", aktuell.id);
        if (scrolle) {
          const lo = l.getBoundingClientRect(), eo = aktuell.getBoundingClientRect();
          if (eo.top < lo.top) l.scrollTop -= lo.top - eo.top + 4;
          else if (eo.bottom > lo.bottom) l.scrollTop += eo.bottom - lo.bottom + 4;
          if (this.idx === 0) l.scrollTop = 0; // erster Eintrag: auch die Gruppenüberschrift darüber zeigen
        }
      } else if (l.querySelector(".sm-leer")) c.setAttribute("aria-activedescendant", l.querySelector(".sm-leer").id);
      else c.removeAttribute("aria-activedescendant");
    }

    plane() {
      cancelAnimationFrame(this.plan);
      this.plan = requestAnimationFrame(() => this.setzePos());
    }
    // Das Menü hängt an der Stelle des „/“; die Zoomstufe der Oberfläche (CSS-zoom am body) rechnen wir heraus
    setzePos() {
      if (!this.offen || !this.el) return;
      const v = this.view, el = this.el, z = zoomFaktor();
      const c = v.coordsAtPos(Math.min(this.von, v.state.doc.length));
      const rand = v.scrollDOM.getBoundingClientRect();
      if (!c || c.bottom < rand.top || c.top > rand.bottom) { el.style.visibility = "hidden"; return; }
      const vb = window.innerWidth / z, vh = window.innerHeight / z;
      if (this.neu) {
        // Seite wählen: unten, wenn die ganze Liste darunter passt oder dort mehr Platz ist; sie bleibt, bis das Menü zugeht (kein Springen beim Filtern)
        this.neu = false;
        const voll = Math.min(MAX_HOEHE, this.listeEl.scrollHeight);
        const unten = vh - c.bottom / z - ABSTAND - RAND, oben = c.top / z - ABSTAND - RAND;
        this.seite = unten >= voll || unten >= oben ? "unten" : "oben";
        this.max = Math.max(120, Math.min(MAX_HOEHE, Math.floor(this.seite === "unten" ? unten : oben)));
        el.dataset.seite = this.seite;
        this.listeEl.style.maxHeight = this.max + "px";
      }
      el.style.visibility = "";
      const links = Math.max(RAND, Math.min(c.left / z, vb - BREITE - RAND));
      el.style.left = Math.round(links) + "px";
      if (this.seite === "unten") { el.style.top = Math.round(c.bottom / z + ABSTAND) + "px"; el.style.bottom = "auto"; }
      else { el.style.bottom = Math.round(vh - c.top / z + ABSTAND) + "px"; el.style.top = "auto"; }
    }

    beiTaste(e) {
      if (!this.offen || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      const n = this.liste.length;
      const nimm = () => { e.preventDefault(); e.stopPropagation(); };
      if (e.key === "Escape") { nimm(); this.verworfen = this.von; this.schliesse(); return; }
      if (!n) return; // ohne Treffer gehen alle Tasten an den Editor (⏎ macht einen Zeilenumbruch und schließt das Menü)
      if (e.key === "ArrowDown") { nimm(); this.idx = (this.idx + 1) % n; this.aktiv(); }
      else if (e.key === "ArrowUp") { nimm(); this.idx = (this.idx - 1 + n) % n; this.aktiv(); }
      else if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) { nimm(); this.waehle(this.idx); }
    }

    // Übernimmt den Eintrag: „/Filter“ weg und Wirkung in einer Transaktion
    waehle(i) {
      const e = this.liste[i], v = this.view;
      if (!e || v.state.readOnly) return;
      const { von, bis } = this;
      this.verworfen = null;
      this.schliesse();
      if (e.art) { ersetze(v, von, bis, (s) => L.zeilenAenderung(s, e.art, EditorSelection)); return; }
      switch (e.id) {
        case "code": ersetze(v, von, bis, (s) => L.blockAenderung(s, "```\n\n```", 4, EditorSelection)); break;
        case "trennlinie": ersetze(v, von, bis, (s) => L.blockAenderung(s, "---", null, EditorSelection)); break;
        case "tabelle": {
          const roh = !!ctx.roh?.();
          const a = ersetze(v, von, bis, (s) => tabelleAnderung(s, roh), { userEvent: "input.tabelle" });
          if (!roh && a) tabelleFokus(v, a.von);
          break;
        }
        case "datum": {
          const t = L.heuteText();
          ersetze(v, von, bis, (s) => ({ changes: s.changes({ from: von, insert: t }), selection: EditorSelection.cursor(von + t.length) }));
          break;
        }
        case "notiz":
          // „[[]]“ mit dem Cursor dazwischen; als Eingabe getippt, damit die Vorschläge für [[ von selbst aufgehen
          ersetze(v, von, bis, (s) => ({ changes: s.changes({ from: von, insert: "[[]]" }), selection: EditorSelection.cursor(von + 2) }), { userEvent: "input.type" });
          break;
        case "datei":
          ersetze(v, von, bis, null);
          this.waehleDateien();
          break;
      }
    }
    // Dateiauswahl: ein Dateifeld, das die Hülle (Browser, Electron, Mac-App) selbst öffnet; die Dateien nimmt die Anhang-Logik (hochladen, `![[…]]` einfügen)
    waehleDateien() {
      const A = ctx.anhaenge;
      if (!A) return;
      this.dateiFeld?.remove();
      const f = document.createElement("input");
      f.type = "file"; f.multiple = true; f.tabIndex = -1; f.setAttribute("aria-hidden", "true"); f.dataset.schraegstrichDatei = "";
      f.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
      const fertig = () => { f.remove(); if (this.dateiFeld === f) this.dateiFeld = null; this.view.focus(); };
      f.addEventListener("change", () => { const d = [...f.files]; fertig(); if (d.length) A.dateien(d, null); });
      f.addEventListener("cancel", fertig);
      document.body.append(f);
      this.dateiFeld = f;
      f.click();
    }
  });
}
