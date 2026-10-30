// Bausteine: die eigenen, einheitlichen Bedienelemente des Studios (ersetzen <select>, native Datums- und Textfelder, Systemknöpfe).
// Ohne Fremdbibliothek, offline. Unter jedem Baustein steckt ein echtes <button>/<input>/<textarea>, damit Formulare, Tastatur,
// Screenreader und Tests wie gewohnt funktionieren. Stil: bausteine.css (Tokens aus studio.css, Hell/Dunkel, prefers-reduced-motion).
//
//   auswahl({ optionen, wert, aufAenderung, label, … })     Knopf mit Wert + Chevron, Popover-Liste (ersetzt <select>)
//   filterChip({ label, optionen, wert, standard, … })       „Priorität: Alle ▾“, aktiv farbig, ✕ setzt zurück
//   textfeld({ … }) / textbereich({ … })                      Eingabe mit Fokusring, Löschen-Knopf, Inline-Fehler / automatische Höhe
//   knopf({ … }) + setzeLaedt(knopf, an)                     primär/sekundär/leise/gefährlich, S/M, Spinner ohne Breitensprung
//   segment({ … }), umschalter({ … }), hakenFeld({ … })       Segment-Schalter, Switch, Checkbox/Radio
//   datumsauswahl({ … }) / oeffneDatumsauswahl(anker, …)      Kalender-Popover mit Schnellwahl
//   tooltip(el, text), toast(text, …)
//
// Alle Fabriken geben ein Element zurück (textfeld/textbereich ein Objekt { el, input|textarea, … }), das mit h(…) eingebaut wird.
import { h, toast } from "./hilfen.js";
import { symbol, GROESSE } from "./symbole.js";
import { kiLogo } from "./ki-logos.js";
import { oeffnePopover, schliessePopover, popoverOffen, wenigBewegung } from "./popover.js";
import { TB } from "./texte-bausteine.js";

export { toast, schliessePopover, popoverOffen };

let zaehler = 0;
const neueId = (p) => `bs-${p}-${++zaehler}`;
const klassen = (...k) => k.filter(Boolean).join(" ");
const nurLesen = (id, text) => h("span", { klasse: "bs-nur-lesen", id, text });

// ======================================================= Datum (lokale Tage als „JJJJ-MM-TT“)
export const isoVon = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const vonIso = (iso) => { const [y, m, d] = String(iso).split("-").map(Number); return new Date(y, m - 1, d); };
export const heuteIso = () => isoVon(new Date());
export const plusTage = (iso, n) => { const d = vonIso(iso); d.setDate(d.getDate() + n); return isoVon(d); };
// Montag der nächsten Woche (an einem Montag: der Montag in 7 Tagen)
export const naechsteWocheIso = (iso = heuteIso()) => { const d = vonIso(iso); const wt = (d.getDay() + 6) % 7; return plusTage(iso, 7 - wt); };
const istIso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
export const datumKurz = (iso) => new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", year: "numeric" }).format(vonIso(iso));

// ======================================================= Auswahl (Kern)
// optionen: [{ wert, text, symbol?, logo?, sub? } | { trenner: true }]
function listeBauen(optionen, aktuell, beiWahl) {
  const id = neueId("liste");
  const box = h("div", { klasse: "bs-liste", role: "listbox", id, tabindex: "-1" });
  const eintraege = [];
  optionen.forEach((o, i) => {
    if (o.trenner) { box.append(h("div", { klasse: "bs-trenner", role: "separator" })); return; }
    const el = h("div", { klasse: "bs-opt", role: "option", id: `${id}-${i}`, "aria-selected": String(o.wert === aktuell), "data-wert": o.wert, "data-aktiv": "false",
      aufClick: () => beiWahl(o.wert) },
      o.logo ? kiLogo(o.logo, 16, { dekorativ: true }) : o.symbol ? symbol(o.symbol, GROESSE.text) : null,
      h("span", { klasse: "bs-opt-text", text: o.text }),
      o.sub ? h("span", { klasse: "bs-opt-sub", text: o.sub }) : null,
      h("span", { klasse: "bs-haken-slot", "aria-hidden": "true" }, o.wert === aktuell ? symbol("haken", GROESSE.text) : null));
    el.__wert = o.wert; el.__text = String(o.text);
    box.append(el); eintraege.push(el);
  });
  return { box, eintraege };
}

// Gemeinsame Mechanik von auswahl() und filterChip(): Knopf (role=combobox) + Popover-Liste, Fokus bleibt auf dem Knopf (aria-activedescendant).
function auswahlKern({ knopf, optionen, hole, setze, gleicheBreite = true, rechts = false }) {
  let offen = null, puffer = "", pufferZeit = 0;
  const finde = (w) => optionen.find((o) => !o.trenner && o.wert === w);
  const oeffne = (vorbuchstabe = "") => {
    if (offen) return;
    const aktuell = hole();
    const { box, eintraege } = listeBauen(optionen, aktuell, (w) => { setze(w, true); offen?.zu(true); });
    let idx = Math.max(0, eintraege.findIndex((e) => e.__wert === aktuell));
    const markiere = (i) => {
      idx = (i + eintraege.length) % eintraege.length;
      eintraege.forEach((e, n) => e.setAttribute("data-aktiv", String(n === idx)));
      knopf.setAttribute("aria-activedescendant", eintraege[idx].id);
      eintraege[idx].scrollIntoView({ block: "nearest" });
    };
    const springe = (zeichen) => {
      const jetzt = Date.now();
      puffer = jetzt - pufferZeit > 700 ? zeichen : puffer + zeichen;
      pufferZeit = jetzt;
      const von = puffer.length === 1 ? idx + 1 : idx; // gleicher Buchstabe wiederholt → nächster Treffer
      for (let k = 0; k < eintraege.length; k++) {
        const i = (von + k) % eintraege.length;
        if (eintraege[i].__text.toLowerCase().startsWith(puffer.toLowerCase())) { markiere(i); return; }
      }
    };
    const beiTaste = (ev) => {
      if (ev.target !== knopf) return false;
      if (ev.key === "ArrowDown") { markiere(idx + 1); return true; }
      if (ev.key === "ArrowUp") { markiere(idx - 1); return true; }
      if (ev.key === "Home") { markiere(0); return true; }
      if (ev.key === "End") { markiere(eintraege.length - 1); return true; }
      if (ev.key === "Enter" || ev.key === " ") { if (puffer && ev.key === " " && Date.now() - pufferZeit < 700) { springe(" "); return true; } eintraege[idx].click(); return true; }
      if (ev.key.length === 1 && !ev.metaKey && !ev.ctrlKey && !ev.altKey) { springe(ev.key); return true; }
      return false;
    };
    knopf.setAttribute("aria-controls", box.id);
    box.addEventListener("mousedown", (e) => e.preventDefault()); // der Fokus bleibt auf dem Knopf
    box.addEventListener("pointermove", (e) => { const i = eintraege.indexOf(e.target.closest(".bs-opt")); if (i >= 0 && i !== idx) markiere(i); });
    offen = oeffnePopover(knopf, box, { gleicheBreite, rechts, beiTaste, beiZu: () => { offen = null; knopf.removeAttribute("aria-activedescendant"); knopf.removeAttribute("aria-controls"); } });
    markiere(idx);
    if (vorbuchstabe) springe(vorbuchstabe);
  };
  knopf.addEventListener("click", () => { if (offen) offen.zu(true); else oeffne(); });
  knopf.addEventListener("keyup", (ev) => { if (ev.key === " ") ev.preventDefault(); }); // Leertaste löst sonst beim Loslassen einen Klick aus (Chrome/Firefox)
  knopf.addEventListener("keydown", (ev) => {
    if (offen) return;
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(ev.key)) { ev.preventDefault(); oeffne(); }
    else if (ev.key.length === 1 && !ev.metaKey && !ev.ctrlKey && !ev.altKey) { ev.preventDefault(); oeffne(ev.key); }
  });
  return { finde, oeffne, schliesse: () => offen?.zu() };
}

// Ersetzt <select>. Rückgabe: <span class="bs-auswahl"> mit .value (lesen/setzen), .setze(wert), .knopf (der Combobox-Knopf), verstecktes <input name> für Formulare.
// daten: Attribute für den Knopf (z. B. { "data-feld": "ordner" }). groesse: "s" (28 px) | "m" (32 px).
export function auswahl({ optionen, wert, aufAenderung, label, platzhalter = TB.waehlen, daten = {}, klasse = "", groesse = "m", name, breit = false } = {}) {
  let aktuell = wert ?? optionen.find((o) => !o.trenner)?.wert ?? "";
  const wertId = neueId("wert"), labelId = neueId("label");
  const ikon = h("span", { klasse: "bs-ikon", "aria-hidden": "true" });
  const wertEl = h("span", { klasse: "bs-wert", id: wertId });
  const knopf = h("button", { type: "button", klasse: klassen("bs-auswahl-knopf", `bs-${groesse}`), role: "combobox", "aria-haspopup": "listbox", "aria-expanded": "false",
    "aria-labelledby": label ? `${labelId} ${wertId}` : wertId, ...daten }, ikon, wertEl, h("span", { klasse: "bs-chevron", "aria-hidden": "true" }, symbol("chevron-unten", GROESSE.klein)));
  const versteckt = h("input", { type: "hidden", name });
  const wrap = h("span", { klasse: klassen("bs-auswahl", breit && "breit", klasse) }, label ? nurLesen(labelId, label) : null, knopf, versteckt);
  const zeige = () => {
    const o = optionen.find((x) => !x.trenner && x.wert === aktuell);
    wertEl.textContent = o ? o.text : platzhalter;
    wertEl.classList.toggle("platzhalter", !o);
    ikon.replaceChildren(...(o?.logo ? [kiLogo(o.logo, 16, { dekorativ: true })] : o?.symbol ? [symbol(o.symbol, GROESSE.text)] : []));
    ikon.hidden = !ikon.childNodes.length;
    versteckt.value = aktuell ?? "";
    knopf.dataset.wert = aktuell ?? "";
  };
  const setze = (w, melden = false) => { if (w === aktuell) return; aktuell = w; zeige(); if (melden) aufAenderung?.(w); };
  const kern = auswahlKern({ knopf, optionen, hole: () => aktuell, setze });
  zeige();
  Object.defineProperties(wrap, { value: { get: () => aktuell, set: (v) => setze(v) }, knopf: { value: knopf } });
  wrap.setze = setze;
  wrap.oeffne = kern.oeffne;
  return wrap;
}

// Filter-Chip: „Priorität: Alle ▾“. Weicht der Wert vom Standard ab, ist der Chip in der Akzentfarbe und ein ✕ (im Platz des Chevrons, ohne Breitensprung) setzt zurück.
// Rückgabe: <span class="bs-chip"> mit .value, .setze(wert), .knopf, .aktiv.
export function filterChip({ label, optionen, wert, standard, aufAenderung, daten = {}, groesse = "s" } = {}) {
  const std = standard ?? optionen.find((o) => !o.trenner)?.wert;
  let aktuell = wert ?? std;
  const labelId = neueId("label"), wertId = neueId("wert");
  const wertEl = h("span", { klasse: "bs-chip-wert", id: wertId });
  const knopf = h("button", { type: "button", klasse: klassen("bs-chip-knopf", `bs-${groesse}`), role: "combobox", "aria-haspopup": "listbox", "aria-expanded": "false",
    "aria-labelledby": `${labelId} ${wertId}`, ...daten },
    h("span", { klasse: "bs-chip-label", id: labelId, text: label }), wertEl, h("span", { klasse: "bs-chevron", "aria-hidden": "true" }, symbol("chevron-unten", GROESSE.klein)));
  const weg = h("button", { type: "button", klasse: "bs-chip-x", "aria-label": TB.zuruecksetzen(label), title: TB.zuruecksetzen(label), tabindex: "-1", "data-chip-zurueck": daten["data-filter"] ?? "",
    aufClick: (ev) => { ev.stopPropagation(); setze(std, true); knopf.focus({ preventScroll: true }); } }, symbol("schliessen", GROESSE.klein));
  const wrap = h("span", { klasse: "bs-chip", "data-aktiv": "false" }, knopf, weg);
  const zeige = () => {
    const o = optionen.find((x) => !x.trenner && x.wert === aktuell);
    wertEl.textContent = o ? o.text : String(aktuell);
    const an = aktuell !== std;
    wrap.dataset.aktiv = String(an);
    weg.tabIndex = an ? 0 : -1;
    knopf.dataset.wert = aktuell;
  };
  const setze = (w, melden = false) => { if (w === aktuell) return; aktuell = w; zeige(); if (melden) aufAenderung?.(w); };
  auswahlKern({ knopf, optionen, hole: () => aktuell, setze, gleicheBreite: false });
  zeige();
  Object.defineProperties(wrap, { value: { get: () => aktuell, set: (v) => setze(v) }, knopf: { value: knopf }, aktiv: { get: () => aktuell !== std } });
  wrap.setze = setze;
  return wrap;
}

// ======================================================= Textfeld, Suchfeld, Textbereich
// → { el, input, fehler(text), fokus() }. typ "search" bekommt Lupe und Löschen-Knopf automatisch. Der Fehlertext hängt per aria-describedby am <input>.
export function textfeld({ typ = "text", wert = "", platzhalter, label, loeschbar, symbol: sym, daten = {}, maxlaenge, klasse = "", groesse = "m", beiEingabe, id, autocomplete = "off", beschreibung } = {}) {
  const suche = typ === "search";
  const mitLoeschen = loeschbar ?? suche;
  const feldId = id || neueId("feld"), fehlerId = neueId("fehler");
  const input = h("input", { klasse: "bs-input", type: suche ? "text" : typ, id: feldId, value: wert || null, placeholder: platzhalter, "aria-label": label, maxlength: maxlaenge,
    autocomplete, spellcheck: "false", autocapitalize: "off", role: suche ? "searchbox" : null, "aria-describedby": beschreibung || null, ...daten });
  const loesch = mitLoeschen ? h("button", { type: "button", klasse: "bs-loeschen", "aria-label": TB.loeschen, title: TB.loeschen, tabindex: "-1", hidden: !wert,
    aufMousedown: (e) => e.preventDefault(), aufClick: () => { input.value = ""; sync(); input.focus(); input.dispatchEvent(new Event("input", { bubbles: true })); } }, symbol("schliessen", GROESSE.klein)) : null;
  const fehlerEl = h("div", { klasse: "bs-fehler", id: fehlerId, role: "alert", hidden: true });
  const feld = h("div", { klasse: klassen("bs-feld", `bs-${groesse}`) }, sym || suche ? h("span", { klasse: "bs-feld-symbol" }, symbol(sym || "suche", GROESSE.text)) : null, input, loesch);
  const el = h("div", { klasse: klassen("bs-feldblock", klasse) }, feld, fehlerEl);
  const sync = () => { if (loesch) loesch.hidden = !input.value || input.disabled; };
  input.addEventListener("input", () => { sync(); if (!fehlerEl.hidden) setzeFehler(""); beiEingabe?.(input.value); });
  const setzeFehler = (text) => {
    fehlerEl.hidden = !text; fehlerEl.textContent = text || "";
    input.toggleAttribute("aria-invalid", !!text); if (text) input.setAttribute("aria-invalid", "true");
    const d = [beschreibung, text ? fehlerId : null].filter(Boolean).join(" ");
    if (d) input.setAttribute("aria-describedby", d); else input.removeAttribute("aria-describedby");
    feld.classList.toggle("fehlerhaft", !!text);
  };
  return { el, input, feld, fehler: setzeFehler, sync, fokus: () => input.focus() };
}

// Mehrzeiliges Feld, wächst mit dem Text (zwischen minZeilen und maxZeilen).
export function textbereich({ wert = "", platzhalter, label, minZeilen = 3, maxZeilen = 12, daten = {}, klasse = "", beiEingabe, autofocus } = {}) {
  const textarea = h("textarea", { klasse: "bs-input", rows: String(minZeilen), placeholder: platzhalter, "aria-label": label, spellcheck: "false", autofocus, ...daten });
  textarea.value = wert || "";
  const el = h("div", { klasse: klassen("bs-feld bs-bereich", klasse) }, textarea);
  const passe = () => {
    const cs = getComputedStyle(textarea), zeile = parseFloat(cs.lineHeight) || 19, pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    textarea.style.height = "auto";
    const h2 = Math.min(Math.max(textarea.scrollHeight, minZeilen * zeile + pad), maxZeilen * zeile + pad);
    textarea.style.height = Math.ceil(h2) + "px";
    textarea.style.overflowY = textarea.scrollHeight > h2 + 1 ? "auto" : "hidden";
  };
  textarea.addEventListener("input", () => { passe(); beiEingabe?.(textarea.value); });
  new ResizeObserver(() => { if (textarea.offsetParent) passe(); }).observe(textarea); // sobald sichtbar/breiter
  return { el, textarea, passe, fokus: () => textarea.focus() };
}

// ======================================================= Knöpfe
// variante: "sekundaer" | "primaer" | "leise" | "gefahr"; groesse: "s" (28 px) | "m" (32 px). Mit text und/oder symbol; nur Symbol → quadratisch (label nötig).
export function knopf({ text, variante = "sekundaer", groesse = "m", symbol: sym, aufKlick, typ = "button", daten = {}, titel, label, klasse = "", laedt = false, aktion } = {}) {
  const b = h("button", { type: typ, klasse: klassen("knopf", "bs-knopf", variante !== "sekundaer" && variante, groesse === "s" && "klein", !text && "nur-symbol", klasse),
    title: titel, "aria-label": label, "data-aktion": aktion, ...daten }, sym ? symbol(sym, GROESSE.text) : null, text ? h("span", { klasse: "bs-knopf-text", text }) : null);
  b.addEventListener("click", (ev) => { if (b.getAttribute("aria-busy") === "true") { ev.preventDefault(); ev.stopImmediatePropagation(); } }, true);
  if (aufKlick) b.addEventListener("click", aufKlick);
  if (laedt) setzeLaedt(b, true);
  return b;
}
// Ladezustand: Spinner in der Mitte, Beschriftung bleibt (unsichtbar) stehen → die Breite ändert sich nicht; Klicks werden ignoriert, der Fokus bleibt.
export function setzeLaedt(b, an) {
  b.classList.toggle("laedt", !!an);
  if (an) { b.setAttribute("aria-busy", "true"); b.setAttribute("aria-disabled", "true"); }
  else { b.removeAttribute("aria-busy"); b.removeAttribute("aria-disabled"); }
}

// Segment-Schalter (radiogroup): optionen [{ wert, text, symbol? }]; Pfeiltasten wechseln, die Auswahl gleitet.
export function segment({ optionen, wert, aufAenderung, label, groesse = "m", daten = {} } = {}) {
  let aktuell = wert ?? optionen[0].wert;
  const daumen = h("span", { klasse: "bs-daumen", "aria-hidden": "true" });
  const tasten = optionen.map((o) => h("button", { type: "button", klasse: "bs-seg", role: "radio", "data-wert": o.wert, "aria-checked": "false", tabindex: "-1",
    aufClick: () => waehle(o.wert, true), ...(o.daten || {}) }, o.symbol ? symbol(o.symbol, GROESSE.text) : null, o.text ? h("span", { text: o.text }) : null));
  const el = h("div", { klasse: klassen("bs-segment", `bs-${groesse}`), role: "radiogroup", "aria-label": label, ...daten }, daumen, tasten);
  const positioniere = () => {
    const an = tasten.find((t) => t.dataset.wert === aktuell);
    if (!an || !an.offsetWidth) return;
    el.style.setProperty("--daumen-x", an.offsetLeft + "px"); el.style.setProperty("--daumen-b", an.offsetWidth + "px");
    el.classList.add("bereit");
  };
  const zeige = () => { tasten.forEach((t) => { const an = t.dataset.wert === aktuell; t.setAttribute("aria-checked", String(an)); t.tabIndex = an ? 0 : -1; }); positioniere(); };
  const waehle = (w, melden) => { if (w === aktuell) return; aktuell = w; zeige(); if (melden) aufAenderung?.(w); };
  el.addEventListener("keydown", (ev) => {
    const i = tasten.findIndex((t) => t.dataset.wert === aktuell);
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key];
    if (!d) return;
    ev.preventDefault();
    const n = tasten[(i + d + tasten.length) % tasten.length];
    waehle(n.dataset.wert, true); n.focus();
  });
  new ResizeObserver(positioniere).observe(el);
  zeige();
  Object.defineProperties(el, { value: { get: () => aktuell, set: (v) => waehle(v, false) } });
  return el;
}

// Umschalter (Switch): <button role="switch">. Mit text → <label>-Zeile, die ganze Zeile schaltet.
export function umschalter({ an = false, aufAenderung, label, text, daten = {}, klasse = "" } = {}) {
  let wert = !!an;
  const b = h("button", { type: "button", klasse: klassen("bs-schalter", klasse), role: "switch", "aria-checked": String(wert), "aria-label": text ? null : label, ...daten }, h("span", { klasse: "bs-schalter-knauf" }));
  const setze = (w, melden) => { wert = !!w; b.setAttribute("aria-checked", String(wert)); if (melden) aufAenderung?.(wert); };
  b.addEventListener("click", (ev) => { ev.preventDefault(); setze(!wert, true); });
  Object.defineProperties(b, { an: { get: () => wert, set: (v) => setze(v, false) } });
  if (!text) return b;
  const zeile = h("label", { klasse: "bs-schalter-zeile" }, h("span", { text }), b);
  Object.defineProperties(zeile, { an: { get: () => wert, set: (v) => setze(v, false) }, knopf: { value: b } });
  return zeile;
}

// Checkbox / Radio im eigenen Stil: <label> mit echtem <input> (das Aussehen kommt aus bausteine.css für alle input[type=checkbox|radio] im Studio).
export function hakenFeld({ typ = "checkbox", text, checked = false, name, wert, aufChange, daten = {}, klasse = "" } = {}) {
  const input = h("input", { type: typ, name, value: wert, checked: checked || null, ...daten });
  if (aufChange) input.addEventListener("change", () => aufChange(input.checked, input));
  const el = h("label", { klasse: klassen("bs-haken", klasse) }, input, text ? h("span", { klasse: "bs-haken-text", text }) : null);
  el.input = input;
  return el;
}

// ======================================================= Datumsauswahl
const MONATE = Array.from({ length: 12 }, (_, m) => new Intl.DateTimeFormat("de-DE", { month: "long" }).format(new Date(2026, m, 1)));
const tagLang = (iso) => new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(vonIso(iso));

function kalenderBox({ wert, beiWahl, schnell, kein, zu }) {
  const heute = heuteIso();
  let fokusIso = istIso(wert) ? wert : heute;
  let monat = { j: vonIso(fokusIso).getFullYear(), m: vonIso(fokusIso).getMonth() };
  const titelEl = h("div", { klasse: "bs-kal-titel", "aria-live": "polite" });
  const raster = h("div", { klasse: "bs-kal-raster", role: "grid", "aria-label": TB.datum.kalender });
  const wahl = (iso) => { beiWahl(iso); zu(true); };
  const geheZu = (iso, fokus = true) => {
    fokusIso = iso;
    const d = vonIso(iso);
    if (d.getFullYear() !== monat.j || d.getMonth() !== monat.m) { monat = { j: d.getFullYear(), m: d.getMonth() }; zeichne(); }
    else raster.querySelectorAll("[data-datum]").forEach((t) => { t.tabIndex = t.dataset.datum === iso ? 0 : -1; });
    if (fokus) raster.querySelector(`[data-datum="${iso}"]`)?.focus();
  };
  const verschiebeMonat = (n) => { const d = new Date(monat.j, monat.m + n, 1); monat = { j: d.getFullYear(), m: d.getMonth() }; fokusIso = isoVon(new Date(monat.j, monat.m, Math.min(vonIso(fokusIso).getDate(), 28))); zeichne(); };
  function zeichne() {
    titelEl.textContent = `${MONATE[monat.m]} ${monat.j}`;
    const erster = new Date(monat.j, monat.m, 1);
    const start = plusTage(isoVon(erster), -((erster.getDay() + 6) % 7));
    const kopf = h("div", { klasse: "bs-kal-zeile kopf", role: "row" }, TB.wochentage.map((t) => h("div", { klasse: "bs-kal-wt", role: "columnheader", text: t })));
    const zeilen = [kopf];
    const fokusImMonat = vonIso(fokusIso).getMonth() === monat.m && vonIso(fokusIso).getFullYear() === monat.j;
    for (let w = 0; w < 6; w++) {
      const tage = [];
      for (let t = 0; t < 7; t++) {
        const iso = plusTage(start, w * 7 + t), d = vonIso(iso);
        const draussen = d.getMonth() !== monat.m;
        tage.push(h("button", { type: "button", klasse: klassen("bs-tag", draussen && "draussen", iso === heute && "heute"), role: "gridcell", "data-datum": iso, text: String(d.getDate()),
          "aria-label": tagLang(iso), "aria-selected": String(iso === wert), "aria-current": iso === heute ? "date" : null, tabindex: (fokusImMonat ? iso === fokusIso : iso === isoVon(erster)) ? "0" : "-1",
          aufClick: () => wahl(iso) }));
      }
      zeilen.push(h("div", { klasse: "bs-kal-zeile", role: "row" }, tage));
    }
    raster.replaceChildren(...zeilen);
  }
  raster.addEventListener("keydown", (ev) => {
    const t = ev.target.closest?.("[data-datum]");
    if (!t) return;
    const iso = t.dataset.datum, d = vonIso(iso);
    const ziel = { ArrowLeft: plusTage(iso, -1), ArrowRight: plusTage(iso, 1), ArrowUp: plusTage(iso, -7), ArrowDown: plusTage(iso, 7),
      Home: plusTage(iso, -((d.getDay() + 6) % 7)), End: plusTage(iso, 6 - ((d.getDay() + 6) % 7)),
      PageUp: isoVon(new Date(d.getFullYear(), d.getMonth() - 1, Math.min(d.getDate(), 28))), PageDown: isoVon(new Date(d.getFullYear(), d.getMonth() + 1, Math.min(d.getDate(), 28))) }[ev.key];
    if (ziel) { ev.preventDefault(); geheZu(ziel); }
  });
  const pfeil = (n, name, sym) => h("button", { type: "button", klasse: "bs-kal-nav", "aria-label": name, title: name, "data-kal": n < 0 ? "zurueck" : "vor", aufClick: () => { verschiebeMonat(n); } }, symbol(sym, GROESSE.text));
  const vor = pfeil(-1, TB.datum.vor, "chevron-rechts");
  vor.firstChild.style.transform = "rotate(180deg)";
  const nach = pfeil(1, TB.datum.nach, "chevron-rechts");
  const sch = schnell ? h("div", { klasse: "bs-kal-schnell" },
    [["heute", TB.datum.heute, heute], ["morgen", TB.datum.morgen, plusTage(heute, 1)], ["woche", TB.datum.naechsteWoche, naechsteWocheIso(heute)]]
      .map(([k, t, iso]) => h("button", { type: "button", klasse: "knopf bs-knopf leise klein", "data-schnell": k, "data-datum-schnell": iso, text: t, aufClick: () => wahl(iso) }))) : null;
  const box = h("div", { klasse: "bs-kal", role: "dialog", "aria-label": TB.datum.waehlen },
    sch, h("div", { klasse: "bs-kal-kopf" }, titelEl, vor, nach), raster,
    kein ? h("div", { klasse: "bs-kal-fuss" }, h("button", { type: "button", klasse: "knopf bs-knopf leise klein", "data-kal": "kein", text: TB.datum.kein, aufClick: () => wahl(null) })) : null);
  zeichne();
  return { box, fokus: () => (box.querySelector('[role="gridcell"][tabindex="0"]') || box.querySelector("button"))?.focus() };
}

// Nur das Popover (ohne eigenen Knopf), z. B. aus einem Kontextmenü: beiWahl(iso | null).
export function oeffneDatumsauswahl(anker, { wert = null, beiWahl, beiZu, schnell = true, kein = true, rechts = false } = {}) {
  const k = kalenderBox({ wert, beiWahl, schnell, kein, zu: (f) => p.zu(f) });
  const p = oeffnePopover(anker, k.box, { rechts, tabSchliesst: false, fokusVerlustSchliesst: true, beiZu });
  k.fokus();
  return p;
}

// Knopf mit Datum + Kalender-Popover. Rückgabe: <span class="bs-datum"> mit .value (iso | null), .setze(iso), .knopf.
export function datumsauswahl({ wert = null, aufAenderung, label, platzhalter = TB.datum.keins, schnell = true, kein = true, daten = {}, groesse = "m", name } = {}) {
  let aktuell = istIso(wert) ? wert : null;
  const wertEl = h("span", { klasse: "bs-wert" });
  const knopf = h("button", { type: "button", klasse: klassen("bs-auswahl-knopf", "bs-datum-knopf", `bs-${groesse}`), "aria-haspopup": "dialog", "aria-expanded": "false", "aria-label": label || TB.datum.waehlen, ...daten },
    h("span", { klasse: "bs-ikon", "aria-hidden": "true" }, symbol("kalender", GROESSE.text)), wertEl, h("span", { klasse: "bs-chevron", "aria-hidden": "true" }, symbol("chevron-unten", GROESSE.klein)));
  const versteckt = h("input", { type: "hidden", name });
  const wrap = h("span", { klasse: "bs-auswahl bs-datum" }, knopf, versteckt);
  const zeige = () => {
    wertEl.textContent = aktuell ? datumKurz(aktuell) : platzhalter; wertEl.classList.toggle("platzhalter", !aktuell);
    versteckt.value = aktuell || ""; knopf.dataset.wert = aktuell || "";
    knopf.setAttribute("aria-label", `${label || TB.datum.waehlen}: ${aktuell ? tagLang(aktuell) : platzhalter}`);
  };
  const setze = (w, melden = false) => { const n = istIso(w) ? w : null; if (n === aktuell) return; aktuell = n; zeige(); if (melden) aufAenderung?.(n); };
  let offen = null;
  knopf.addEventListener("click", () => {
    if (offen) { offen.zu(true); return; }
    offen = oeffneDatumsauswahl(knopf, { wert: aktuell, schnell, kein, beiWahl: (iso) => setze(iso, true), beiZu: () => { offen = null; } });
  });
  zeige();
  Object.defineProperties(wrap, { value: { get: () => aktuell, set: (v) => setze(v) }, knopf: { value: knopf } });
  wrap.setze = setze;
  return wrap;
}

// ======================================================= Tooltip
let tippEl = null, tippTimer = 0;
function verbergeTipp() { clearTimeout(tippTimer); tippEl?.remove(); tippEl = null; }
// Verzögert (500 ms) bei Maus, sofort bei Tastaturfokus; verschwindet bei Klick, Blur, Esc. Setzt aria-describedby; ein vorhandenes title wird entfernt (kein doppeltes Tooltip).
export function tooltip(el, text, { verzoegerung = 500 } = {}) {
  let aktuell = text;
  const id = neueId("tipp");
  el.removeAttribute("title");
  el.setAttribute("aria-describedby", id);
  const zeige = () => {
    verbergeTipp();
    tippEl = h("div", { klasse: "bs-tipp", role: "tooltip", id, text: aktuell });
    (document.getElementById("menue-host") || document.body).append(tippEl);
    const a = el.getBoundingClientRect(), bw = tippEl.offsetWidth, bh = tippEl.offsetHeight;
    const unten = a.top - bh - 8 < 8;
    tippEl.style.left = Math.round(Math.max(8, Math.min(a.left + a.width / 2 - bw / 2, window.innerWidth - bw - 8))) + "px";
    tippEl.style.top = Math.round(unten ? a.bottom + 8 : a.top - bh - 8) + "px";
    tippEl.getBoundingClientRect();
    tippEl.classList.add("offen");
  };
  el.addEventListener("pointerenter", (ev) => { if (ev.pointerType === "touch") return; clearTimeout(tippTimer); tippTimer = setTimeout(zeige, verzoegerung); });
  el.addEventListener("pointerleave", verbergeTipp);
  el.addEventListener("pointerdown", verbergeTipp);
  el.addEventListener("focus", () => { if (el.matches(":focus-visible")) zeige(); });
  el.addEventListener("blur", verbergeTipp);
  el.addEventListener("keydown", (ev) => { if (ev.key === "Escape") verbergeTipp(); });
  return { setze: (t) => { aktuell = t; if (tippEl?.id === id) tippEl.textContent = t; }, verberge: verbergeTipp };
}

// ======================================================= Skelett (Platzhalter für Ladevorgänge > 150 ms; blendet per CSS erst nach 150 ms ein)
export const skelett = (klasse = "", hoehe) => { const e = h("div", { klasse: klassen("bs-skelett", klasse), "aria-hidden": "true" }); if (hoehe) e.style.height = hoehe + "px"; return e; };

// Nach einer Aktion den Fokus sauber setzen: erst wenn das Element da ist (nach Neuzeichnen), ohne Scroll-Sprung.
export function fokussiere(el, { scrollen = false } = {}) { if (el && document.contains(el)) el.focus({ preventScroll: !scrollen }); }

// Entprellen: die Funktion läuft erst, wenn ms lang nichts mehr kam. Mit .sofort() sofort und .abbrechen().
export function entprelle(fn, ms = 150) {
  let t = 0;
  const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  f.sofort = (...a) => { clearTimeout(t); fn(...a); };
  f.abbrechen = () => clearTimeout(t);
  return f;
}
export { wenigBewegung };

// Leerer Zustand: ein dezentes Symbol, ein kurzer Satz, höchstens EINE Aktion (Muster aus Orca, MIT; siehe dialoge.css und THIRD-PARTY-NOTICES.md).
// { symbol, titel, text, aktion: { text, tun } | null, daten: { "data-…": "" }, klasse } → <div class="leer-liste">
export function leerBlock({ symbol: sym, titel, text, aktion = null, daten = {}, klasse = "leer-liste" } = {}) {
  return h("div", { klasse, ...daten },
    h("div", { klasse: "zeichen" }, symbol(sym, GROESSE.kachel)),
    h("h3", { text: titel }),
    text ? h("p", { text }) : null,
    aktion ? knopf({ text: aktion.text, aktion: "leer-aktion", aufKlick: aktion.tun }) : null);
}
