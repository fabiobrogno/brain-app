// Bausteine: die eigenen, einheitlichen Bedienelemente des Studios (ersetzen <select>, native Datums- und Textfelder, Systemknöpfe).
// Ohne Fremdbibliothek, offline. Unter jedem Baustein steckt ein echtes <button>/<input>/<textarea>, damit Formulare, Tastatur,
// Screenreader und Tests wie gewohnt funktionieren. Stil: bausteine.css (Tokens aus studio.css, Hell/Dunkel, prefers-reduced-motion).
//
//   auswahl({ optionen, wert, aufAenderung, label, … })     Knopf mit Wert + Chevron, Popover-Liste (ersetzt <select>)
//   filterChip({ label, optionen, wert, standard, … })       „Priorität: Alle ▾“, aktiv farbig, ✕ setzt zurück
//   textfeld({ … }) / textbereich({ … })                      Eingabe mit Fokusring, Löschen-Knopf, Inline-Fehler / automatische Höhe
//   knopf({ … }) + setzeLaedt(knopf, an) / mitLaden(knopf, fn)   primär/sekundär/leise/gefährlich, S/M/L, Spinner ohne Breitensprung und ohne Flackern
//   segment({ … }), umschalter({ … }), hakenFeld({ … })       Segment-Schalter, Switch, Checkbox/Radio
//   datumsauswahl({ … }) / oeffneDatumsauswahl(anker, …)      Kalender-Popover mit Schnellwahl
//   kiAuswahl({ erkennung, wert, mehrfach, waehlbar, aufAenderung })   Karten der gefundenen KIs + aufklappbare, durchsuchbare Liste aller KIs
//   tooltip(el, text), toast(text, …)
//
// Alle Fabriken geben ein Element zurück (textfeld/textbereich ein Objekt { el, input|textarea, … }), das mit h(…) eingebaut wird.
import { h, toast } from "./hilfen.js";
import { symbol, GROESSE } from "./symbole.js";
import { kiLogo, kiKatalog } from "./ki-logos.js";
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
export function auswahl({ optionen, wert, aufAenderung, label, platzhalter = TB.waehlen, daten = {}, klasse = "", groesse = "m", name, breit = false, disabled = false } = {}) {
  let aktuell = wert ?? optionen.find((o) => !o.trenner)?.wert ?? "";
  const wertId = neueId("wert"), labelId = neueId("label");
  const ikon = h("span", { klasse: "bs-ikon", "aria-hidden": "true" });
  const wertEl = h("span", { klasse: "bs-wert", id: wertId });
  const knopf = h("button", { type: "button", klasse: klassen("bs-auswahl-knopf", `bs-${groesse}`), role: "combobox", "aria-haspopup": "listbox", "aria-expanded": "false",
    "aria-labelledby": label ? `${labelId} ${wertId}` : wertId, disabled: disabled || null, ...daten }, ikon, wertEl, h("span", { klasse: "bs-chevron", "aria-hidden": "true" }, symbol("chevron-unten", GROESSE.klein)));
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
// variante: "sekundaer" | "primaer" | "leise" | "gefahr"; groesse: "s" (28 px) | "m" (32 px) | "l" (36 px, Dialoge/Assistent). Mit text und/oder symbol; nur Symbol → quadratisch (label nötig).
// kinder: weitere Knoten vor dem Text (z. B. Marken-Logo), nach: Knoten hinter dem Text (z. B. Chevron). disabled/hidden/autofocus wie am <button>.
export function knopf({ text, variante = "sekundaer", groesse = "m", symbol: sym, aufKlick, typ = "button", daten = {}, titel, label, klasse = "", laedt = false, aktion, disabled, hidden, autofocus, kinder = [], nach = [] } = {}) {
  const b = h("button", { type: typ, klasse: klassen("knopf", "bs-knopf", variante !== "sekundaer" && variante, groesse === "s" && "klein", groesse === "l" && "gross", !text && !kinder.length && !nach.length && "nur-symbol", klasse),
    title: titel, "aria-label": label, "data-aktion": aktion, disabled: disabled || null, hidden: hidden || null, autofocus: autofocus || null, ...daten },
  sym ? symbol(sym, GROESSE.text) : null, kinder, text ? h("span", { klasse: "bs-knopf-text", text }) : null, nach);
  b.addEventListener("click", (ev) => { if (b.getAttribute("aria-busy") === "true") { ev.preventDefault(); ev.stopImmediatePropagation(); } }, true);
  if (aufKlick) b.addEventListener("click", aufKlick);
  if (laedt) setzeLaedt(b, true);
  return b;
}
// Ladezustand: Beschriftung bleibt (unsichtbar) stehen → die Breite ändert sich nicht; Klicks werden ignoriert, der Fokus bleibt.
// Der Spinner blendet erst nach ~140 ms ein: schnelle Vorgänge flackern nicht.
export function setzeLaedt(b, an) {
  b.classList.toggle("laedt", !!an);
  if (an) { b.setAttribute("aria-busy", "true"); b.setAttribute("aria-disabled", "true"); }
  else { b.removeAttribute("aria-busy"); b.removeAttribute("aria-disabled"); }
}
// Führt fn aus und zeigt am Knopf solange den Ladezustand (auch bei Fehlern wird er wieder zurückgenommen).
export async function mitLaden(b, fn) {
  setzeLaedt(b, true);
  try { return await fn(); } finally { setzeLaedt(b, false); }
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
// { symbol, titel, text, aktion: { text, tun, name?, variante?, groesse? } | null, daten: { "data-…": "" }, klasse } → <div class="leer-liste">
export function leerBlock({ symbol: sym, titel, text, aktion = null, daten = {}, klasse = "leer-liste" } = {}) {
  return h("div", { klasse, ...daten },
    h("div", { klasse: "zeichen" }, symbol(sym, GROESSE.kachel)),
    h("h3", { text: titel }),
    text ? h("p", { text }) : null,
    aktion ? knopf({ text: aktion.text, variante: aktion.variante, groesse: aktion.groesse, aktion: aktion.name || "leer-aktion", aufKlick: aktion.tun }) : null);
}

// ======================================================= Einstellungen (Paket P5): Zeilen-Bausteine der Seite „Einstellungen“ (einstellungen.js, Stil: einstellungen.css)
// Muster: Orca SettingsRow/SettingsSection (settings/SettingsFormControls.tsx @9bccd67, MIT, Lovecast Inc.): Titel + Beschreibung links, Steuerung rechts, Bereich als Karte.
// Schalter, Segment und Menü sind umschalter(), segment() und auswahl() von oben; neu sind hier Zeile, Abschnitt, Textfeld mit Verzögerung, Pfad, Liste und Regler.
// Gespeichert wird sofort (Schalter, Segment, Menü, Regler) oder, bei Textfeldern, 700 ms nach der letzten Eingabe, beim Verlassen des Felds und beim Schließen der Seite.
export const EINSTELL_VERZOEGERUNG_MS = 700;

// Kleine Marke neben einem Titel: „Experiment“, „aus“, „bald“. ton: "" | "ok" | "warn" | "akzent"
export const einstellMarke = (text, ton = "") => h("span", { klasse: klassen("ez-marke", ton && `ez-marke-${ton}`), text });

// Karte mit Zeilen: <div class="ez-karte">
export const einstellKarte = (...kinder) => h("div", { klasse: "ez-karte" }, kinder.flat());

// Eine Einstellung: Titel (+ Marke) und Beschreibung links, Steuerung rechts. hoch: Steuerung oben ausgerichtet (lange Listen). id → data-zeile (Sprungziel, Suche).
export function einstellZeile({ id, titel, text, steuerung = null, hoch = false, marke = null, unten = null, klasse = "" } = {}) {
  const titelEl = h("span", { klasse: "ez-titel", "data-feld": "titel", text: titel });
  const textEl = text ? h("span", { klasse: "ez-text", "data-feld": "text", text }) : null;
  const links = h("div", { klasse: "ez-l" }, h("div", { klasse: "ez-kopf" }, titelEl, marke), textEl, unten);
  const zeile = h("div", { klasse: klassen("ez", hoch && "hoch", klasse), "data-zeile": id }, links, steuerung ? h("div", { klasse: "ez-r" }, steuerung) : null);
  zeile.titelEl = titelEl; zeile.textEl = textEl;
  zeile.originalTitel = titel; zeile.originalText = text || "";
  return zeile;
}

// Abschnitt: Überschrift (+ Satz) und darunter die Karte mit den Zeilen. rechts: Knoten rechts neben der Überschrift.
export function einstellAbschnitt({ id, titel, text, rechts = null, zeilen = [], karte = true } = {}) {
  const kopf = titel || text || rechts ? h("div", { klasse: "ez-abschnitt-kopf" },
    h("div", { klasse: "ez-abschnitt-text" }, titel ? h("h2", { text: titel, "data-feld": "abschnitt-titel" }) : null, text ? h("p", { text }) : null),
    rechts ? h("div", { klasse: "ez-abschnitt-rechts" }, rechts) : null) : null;
  return h("section", { klasse: "ez-abschnitt", "data-abschnitt": id }, kopf, karte ? einstellKarte(zeilen) : h("div", {}, zeilen));
}

// Textfeld einer Einstellung: schreibt 700 ms nach der letzten Eingabe, beim Verlassen und mit .sofort(). pruefe(text) → Fehlertext oder "" (bei Fehler wird nicht gespeichert).
// → { el, input, setze(text), sofort(), offen() }  (offen: es wartet eine Eingabe auf das Speichern)
export function einstellTextfeld({ wert = "", platzhalter, label, mono = false, breite = 240, maxlaenge, pruefe, aufSpeichern, verzoegerung = EINSTELL_VERZOEGERUNG_MS, daten = {} } = {}) {
  let gespeichert = String(wert ?? ""), wartet = false;
  const tf = textfeld({ wert: gespeichert, platzhalter, label, maxlaenge, groesse: "m", klasse: klassen("ez-textfeld", mono && "mono"), daten });
  tf.el.style.width = `${breite}px`;
  const speichere = () => {
    wartet = false;
    const text = tf.input.value.trim();
    if (text === gespeichert) { tf.fehler(""); return; }
    const f = pruefe?.(text) || "";
    tf.fehler(f);
    if (f) return;
    gespeichert = text;
    aufSpeichern?.(text);
  };
  const planen = entprelle(speichere, verzoegerung);
  tf.input.addEventListener("input", () => { wartet = true; planen(); });
  tf.input.addEventListener("blur", () => { if (wartet) planen.sofort(); });
  tf.input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); planen.sofort(); } });
  return {
    el: tf.el, input: tf.input,
    setze: (t) => { gespeichert = String(t ?? ""); if (document.activeElement !== tf.input) tf.input.value = gespeichert; tf.fehler(""); tf.sync?.(); },
    sofort: () => { if (wartet) planen.sofort(); },
    offen: () => wartet,
  };
}

// Pfad: Textfeld in fester Schrift und, wenn die App einen Ordner-Dialog hat, daneben „Wählen …“. waehlen() → Promise<string|null>.
export function einstellPfad({ wert = "", platzhalter, label, waehlen, auswahlText = "Wählen …", pruefe, aufSpeichern, breite = 240 } = {}) {
  const feld = einstellTextfeld({ wert, platzhalter, label, mono: true, breite, pruefe, aufSpeichern });
  const knopfEl = waehlen ? knopf({ text: auswahlText, groesse: "s", aufKlick: async () => { const p = await waehlen(); if (p) { feld.input.value = p; feld.input.dispatchEvent(new Event("input", { bubbles: true })); feld.sofort(); } } }) : null;
  return { ...feld, el: h("div", { klasse: "ez-pfad" }, feld.el, knopfEl) };
}

// Liste von Einträgen (Ordner, Wörter, Werkzeugnamen) als Chips mit ✕ und „+ …“. pruefe(text, liste) → Fehlertext oder "". Jede Änderung ruft aufAenderung(neueListe) sofort.
export function einstellChips({ werte = [], label, platzhalter, mono = false, plusText = "Eintrag", pruefe, aufAenderung, max = 50, textEntfernen = (w) => `${w} entfernen`, textNeu = (w) => `${w} hinzufügen` } = {}) {
  let liste = [...werte];
  const el = h("div", { klasse: "ez-chips", role: "group", "aria-label": label });
  let eingabe = null;
  const aendere = (neu) => { liste = neu; zeichne(); aufAenderung?.([...liste]); };
  const plus = () => {
    const tf = textfeld({ platzhalter, label: textNeu(plusText), groesse: "s", klasse: klassen("ez-chip-feld", mono && "mono"), maxlaenge: 300 });
    eingabe = tf;
    const fertig = (uebernehmen) => {
      if (eingabe !== tf) return;
      const text = tf.input.value.trim();
      if (uebernehmen && text) {
        const f = pruefe?.(text, liste) || (liste.length >= max ? "Die Liste ist voll." : "");
        if (f) { tf.fehler(f); return; }
        eingabe = null; aendere([...liste, text]); return;
      }
      eingabe = null; zeichne();
    };
    tf.input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); fertig(true); } else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); fertig(false); } });
    tf.input.addEventListener("blur", () => setTimeout(() => { if (eingabe === tf && !el.contains(document.activeElement)) fertig(true); }, 120));
    zeichne();
    tf.input.focus();
  };
  function zeichne() {
    const chips = liste.map((w) => h("span", { klasse: klassen("ez-chip", mono && "mono"), "data-eintrag": w },
      h("span", { klasse: "ez-chip-text", text: w }),
      h("button", { type: "button", klasse: "ez-chip-x", "aria-label": textEntfernen(w), title: textEntfernen(w), aufClick: () => aendere(liste.filter((x) => x !== w)) }, symbol("schliessen", GROESSE.klein))));
    el.replaceChildren(...chips, eingabe ? eingabe.el : h("button", { type: "button", klasse: "ez-chip-plus", "data-aktion": "chip-plus", aufClick: plus }, symbol("plus", GROESSE.klein), h("span", { text: plusText })));
  }
  zeichne();
  return { el, setze: (l) => { liste = [...l]; if (!eingabe) zeichne(); }, get liste() { return [...liste]; } };
}

// Regler (Schriftgröße …): <input type="range"> im Stil des Studios, links „A“ klein, rechts „A“ groß, ganz rechts der Wert. aufEingabe beim Ziehen, aufAenderung beim Loslassen.
export function einstellRegler({ min, max, schritt = 1, wert, label, einheit = "px", aufEingabe, aufAenderung, textKlein = "Kleiner", textGross = "Größer", daten = {} } = {}) {
  const feld = h("input", { type: "range", klasse: "ez-regler", min: String(min), max: String(max), step: String(schritt), value: String(wert), "aria-label": label, ...daten });
  const anzeige = h("span", { klasse: "ez-regler-wert", "aria-hidden": "true" });
  const fuelle = () => { feld.style.setProperty("--fuell", `${((Number(feld.value) - min) / (max - min)) * 100}%`); anzeige.textContent = `${feld.value} ${einheit}`; };
  feld.addEventListener("input", () => { fuelle(); aufEingabe?.(Number(feld.value)); });
  feld.addEventListener("change", () => aufAenderung?.(Number(feld.value)));
  fuelle();
  const el = h("div", { klasse: "ez-regler-block" }, h("span", { klasse: "ez-regler-klein", "aria-hidden": "true", title: textKlein, text: "A" }), feld, h("span", { klasse: "ez-regler-gross", "aria-hidden": "true", title: textGross, text: "A" }), anzeige);
  return { el, input: feld, setze: (w) => { feld.value = String(w); fuelle(); } };
}

// ======================================================= KI-Auswahl
// Oben die gefundenen KIs (sonst die beliebten) als große Karten mit Logo, Name und Status; darunter „Weitere KIs anzeigen (N)“ klappt eine
// durchsuchbare, kompakte Liste aller anderen KIs des Katalogs auf (Terminal-KIs, Editoren, Apps; Logos lokal, nie aus dem Netz).
// Muster: Orca, Einrichtung „Agent wählen“ (AgentStep.tsx @9bccd67, MIT, Lovecast Inc.; THIRD-PARTY-NOTICES.md).
//
//   erkennung   { [id]: { gefunden, version } } aus GET /api/ki/erkennen (`katalog`); null = die Suche läuft noch
//   wert        gewählte ids; mehrfach: true = Mehrfachauswahl (Kästchen), false = genau eine (Auswahlkreis)
//   waehlbar    (eintrag) => boolean; nicht wählbare Einträge (Kortex kann sich dort noch nicht eintragen) stehen ausgegraut da
//   aufAenderung(ids)   ids in der Reihenfolge des Katalogs
//   → { el, wert(), setzeWert(ids), setzeErkennung(erkennung), sperre(an), oeffne(), schliesse(), fokus() }
// Tastatur: Tab erreicht die Karten (←→↑↓ wechseln, Leertaste/Enter wählt), den Knopf „Weitere KIs“ (Enter öffnet und setzt den Fokus ins Suchfeld),
// im Suchfeld filtert Tippen, ↓ springt in die Liste; in der Liste ↑↓ Pos1 Ende bewegen, Leertaste/Enter wählt, Tippen geht zurück ins Suchfeld, Esc leert die Suche.
const kiNorm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[\s_-]+/g, "");

export function kiAuswahl({ erkennung = null, wert = [], mehrfach = true, waehlbar = () => true, aufAenderung, label = TB.ki.label, beliebteAnzahl = 8, daten = {}, klasse = "", verbunden = [] } = {}) {
  const katalog = kiKatalog();
  const index = new Map(katalog.map((e, i) => [e.id, i]));
  const S = { erkennung, auswahl: new Set(wert.filter((id) => index.has(id))), q: "", offen: false, obenIds: [], obenGefunden: false, gesperrt: false, verbunden: new Set(verbunden) };
  const fund = (e) => (S.erkennung ? S.erkennung[e.id] : null);
  const gefunden = (e) => fund(e)?.gefunden === true;
  const frei = (e) => !!waehlbar(e);
  const listeWert = () => katalog.map((e) => e.id).filter((id) => S.auswahl.has(id));
  const istVerbunden = (e) => S.verbunden.has(e.id);
  const statusText = (e) => {
    if (istVerbunden(e)) return TB.ki.verbunden; // schon mit Kortex verbunden (nur Anzeige; wählbar bleibt es, etwa um ein Konto oder die Stufe zu ändern)
    if (!S.erkennung) return TB.ki.sucht;
    if (!gefunden(e)) return TB.ki.nichtDa;
    if (!frei(e)) return TB.ki.gefundenNichtVerbindbar;
    return TB.ki.gefunden(fund(e)?.version);
  };

  const rolleKarte = mehrfach ? "checkbox" : "radio";
  const kopfTitel = h("span", { klasse: "ka-titel" });
  const kopfZahl = h("span", { klasse: "ka-zahl" });
  const karten = h("div", { klasse: "ka-karten", role: mehrfach ? "group" : "radiogroup", "aria-label": label });
  const listeId = neueId("ka-liste"), aufId = neueId("ka-auf");
  const suche = textfeld({ typ: "search", platzhalter: TB.ki.suchen, label: TB.ki.suchen, klasse: "ka-suche", beiEingabe: (q) => { S.q = q; zeichneListe(); } });
  const treffer = h("div", { klasse: "bs-nur-lesen", "aria-live": "polite" });
  const leer = h("div", { klasse: "ka-leer", hidden: true });
  const liste = h("div", { klasse: "ka-liste", role: "listbox", id: listeId, "aria-label": TB.ki.alleLabel, "aria-multiselectable": mehrfach ? "true" : null });
  const hinweis = h("div", { klasse: "ka-hinweis", hidden: true, text: TB.ki.nichtWaehlbarHinweis });
  const mehrText = h("span", { klasse: "ka-mehr-text" });
  const mehr = h("button", { type: "button", klasse: "ka-mehr", "aria-expanded": "false", "aria-controls": aufId, "data-aktion": "ki-weitere",
    aufClick: () => (S.offen ? schliesse() : oeffne({ fokus: true })) }, mehrText, h("span", { klasse: "bs-chevron", "aria-hidden": "true" }, symbol("chevron-unten", GROESSE.klein)));
  const innen = h("div", { klasse: "ka-weitere-innen" }, h("div", { klasse: "ka-suchzeile" }, suche.el), liste, leer, hinweis, treffer);
  const aufklapp = h("div", { klasse: "ka-aufklapp", id: aufId, "data-offen": "false", "aria-hidden": "true", inert: true }, innen);
  const el = h("div", { klasse: klassen("ka", klasse), "data-ki-auswahl": "", ...daten },
    h("div", { klasse: "ka-kopf" }, kopfTitel, kopfZahl), karten, mehr, aufklapp);

  // ---- Karten (oben)
  function berechneOben() {
    const alle = S.erkennung ? katalog.filter(gefunden).sort((a, b) => (frei(b) - frei(a)) || (index.get(a.id) - index.get(b.id))) : [];
    const ziel = alle.length ? alle : katalog.filter((e) => e.beliebt);
    S.obenGefunden = alle.length > 0;
    S.obenIds = ziel.slice(0, Math.max(beliebteAnzahl, 1)).map((e) => e.id);
  }
  function karte(e) {
    const ok = frei(e);
    return h("button", { type: "button", klasse: "ka-karte", role: rolleKarte, "aria-checked": "false", "data-ki": e.id, "data-ziel": e.id, "aria-disabled": ok ? null : "true", title: ok ? null : TB.ki.nichtWaehlbarTitel(e.name),
      aufClick: () => wechsle(e.id), aufKeydown: (ev) => kartenTaste(ev) },
      h("span", { klasse: "ka-kachel" }, kiLogo(e.id, 26, { dekorativ: true })),
      h("span", { klasse: "ka-text" }, h("span", { klasse: "ka-name", text: e.name }),
        h("span", { klasse: "ka-status", "data-gefunden": String(gefunden(e)), "data-verbunden": String(istVerbunden(e)) }, istVerbunden(e) ? symbol("kreis-haken", GROESSE.klein) : gefunden(e) ? h("span", { klasse: "ka-punkt", "aria-hidden": "true" }) : null, h("span", { klasse: "ka-status-text", text: statusText(e) }))),
      h("span", { klasse: "ka-haken", "aria-hidden": "true" }, symbol("haken", GROESSE.klein)));
  }
  function zeichneKarten() {
    berechneOben();
    karten.replaceChildren(...S.obenIds.map((id) => karte(katalog[index.get(id)])));
    kopfTitel.textContent = S.obenGefunden ? TB.ki.gefundenTitel : TB.ki.beliebtTitel;
    kopfZahl.textContent = String(S.obenIds.length);
    el.dataset.erkennung = !S.erkennung ? "sucht" : S.obenGefunden ? "gefunden" : "keine";
    syncAuswahl();
  }
  function kartenTaste(ev) {
    const alle = [...karten.querySelectorAll(".ka-karte")];
    const i = alle.indexOf(ev.currentTarget);
    const ziel = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: alle.length - 1 }[ev.key];
    if (ziel === undefined || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    ev.preventDefault();
    alle[Math.min(Math.max(ziel, 0), alle.length - 1)]?.focus();
  }

  // ---- Liste (weitere)
  function suchWert(e, tokens) {
    const heu = kiNorm([e.name, e.id, TB.ki.art[e.art]].join(" "));
    const name = kiNorm(e.name);
    let w = 0;
    for (const t of tokens) {
      const n = kiNorm(t);
      if (!n) continue;
      if (name.startsWith(n)) w += 3; else if (name.includes(n)) w += 2; else if (heu.includes(n)) w += 1; else return -1;
    }
    return w;
  }
  function zeile(e) {
    const ok = frei(e);
    return h("div", { klasse: "ka-zeile", role: "option", id: `${listeId}-${e.id}`, tabindex: "-1", "aria-selected": "false", "aria-disabled": ok ? null : "true", "data-ki": e.id, "data-ziel": e.id,
      title: ok ? null : TB.ki.nichtWaehlbarTitel(e.name), aufClick: () => wechsle(e.id), aufKeydown: (ev) => zeilenTaste(ev) },
      h("span", { klasse: klassen("ka-box", !mehrfach && "rund"), "aria-hidden": "true" }, ok ? symbol("haken", GROESSE.klein) : null),
      h("span", { klasse: "ka-z-logo" }, kiLogo(e.id, 20, { dekorativ: true })),
      h("span", { klasse: "ka-z-name", text: e.name }),
      h("span", { klasse: "ka-art", text: TB.ki.art[e.art] }),
      h("span", { klasse: "ka-z-status", "data-gefunden": String(gefunden(e)), "data-verbunden": String(istVerbunden(e)) }, istVerbunden(e) ? symbol("kreis-haken", GROESSE.klein) : gefunden(e) ? h("span", { klasse: "ka-punkt", "aria-hidden": "true" }) : null, h("span", { text: statusText(e) })));
  }
  function zeichneListe() {
    const rest = katalog.filter((e) => !S.obenIds.includes(e.id));
    const tokens = S.q.trim().split(/\s+/).filter(Boolean);
    const gewertet = rest.map((e) => ({ e, w: tokens.length ? suchWert(e, tokens) : 0 })).filter((x) => x.w >= 0)
      .sort((a, b) => (b.w - a.w) || (gefunden(b.e) - gefunden(a.e)) || (frei(b.e) - frei(a.e)) || (index.get(a.e.id) - index.get(b.e.id)));
    liste.replaceChildren(...gewertet.map((x) => zeile(x.e)));
    const erste = liste.firstElementChild;
    if (erste) erste.tabIndex = 0;
    const q = S.q.trim();
    const oben = q && !gewertet.length ? katalog.filter((e) => S.obenIds.includes(e.id) && suchWert(e, tokens) >= 0) : [];
    leer.hidden = gewertet.length > 0;
    leer.textContent = !gewertet.length ? (oben.length ? TB.ki.schonOben(q) : TB.ki.keine(q)) : "";
    hinweis.hidden = !gewertet.some((x) => !frei(x.e));
    treffer.textContent = q ? TB.ki.treffer(gewertet.length) : "";
    mehrText.textContent = S.offen ? TB.ki.weniger : TB.ki.mehr(rest.length);
    syncAuswahl();
  }
  const leereSuche = () => { suche.input.value = ""; suche.sync(); S.q = ""; zeichneListe(); };
  const tippeInSuche = (aendere) => { suche.input.focus(); suche.input.value = aendere(suche.input.value); suche.input.dispatchEvent(new Event("input", { bubbles: true })); };
  function zeilenTaste(ev) {
    const zeilen = [...liste.querySelectorAll(".ka-zeile")];
    const i = zeilen.indexOf(ev.currentTarget);
    const gehe = (n) => { const z = zeilen[Math.min(Math.max(n, 0), zeilen.length - 1)]; if (z) { for (const x of zeilen) x.tabIndex = -1; z.tabIndex = 0; z.focus(); z.scrollIntoView({ block: "nearest" }); } };
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
    if (ev.key === "ArrowDown") { ev.preventDefault(); gehe(i + 1); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); if (i === 0) suche.input.focus(); else gehe(i - 1); }
    else if (ev.key === "Home") { ev.preventDefault(); gehe(0); }
    else if (ev.key === "End") { ev.preventDefault(); gehe(zeilen.length - 1); }
    else if (ev.key === "PageDown") { ev.preventDefault(); gehe(i + 6); }
    else if (ev.key === "PageUp") { ev.preventDefault(); gehe(i - 6); }
    else if (ev.key === " " || ev.key === "Enter") { ev.preventDefault(); wechsle(ev.currentTarget.dataset.ki); }
    else if (ev.key === "Escape" && S.q) { ev.preventDefault(); ev.stopPropagation(); leereSuche(); suche.input.focus(); }
    else if (ev.key === "Backspace") { ev.preventDefault(); tippeInSuche((v) => v.slice(0, -1)); }
    else if (ev.key.length === 1) { ev.preventDefault(); tippeInSuche((v) => v + ev.key); }
  }
  suche.input.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown") { const z = liste.querySelector(".ka-zeile"); if (z) { ev.preventDefault(); z.focus(); } }
    else if (ev.key === "Enter") { const z = liste.querySelector(".ka-zeile"); if (z && S.q.trim()) { ev.preventDefault(); wechsle(z.dataset.ki); } }
    else if (ev.key === "Escape" && S.q) { ev.preventDefault(); ev.stopPropagation(); leereSuche(); }
  });

  // ---- Zustand
  function syncAuswahl() {
    for (const k of el.querySelectorAll(".ka-karte")) k.setAttribute("aria-checked", String(S.auswahl.has(k.dataset.ki)));
    for (const z of liste.querySelectorAll(".ka-zeile")) z.setAttribute("aria-selected", String(S.auswahl.has(z.dataset.ki)));
  }
  function wechsle(id) {
    const e = katalog[index.get(id)];
    if (!e || !frei(e) || S.gesperrt) return;
    if (mehrfach) { if (S.auswahl.has(id)) S.auswahl.delete(id); else S.auswahl.add(id); }
    else if (S.auswahl.has(id) && S.auswahl.size === 1) return;
    else S.auswahl = new Set([id]);
    syncAuswahl();
    try { aufAenderung?.(listeWert()); } catch (err) { console.error(err); }
  }
  function oeffne({ fokus = false } = {}) {
    S.offen = true;
    mehr.setAttribute("aria-expanded", "true");
    aufklapp.dataset.offen = "true"; aufklapp.removeAttribute("aria-hidden"); aufklapp.inert = false;
    mehrText.textContent = TB.ki.weniger;
    if (fokus) setTimeout(() => suche.input.focus({ preventScroll: true }), wenigBewegung() ? 0 : 60);
  }
  function schliesse() {
    S.offen = false;
    mehr.setAttribute("aria-expanded", "false");
    aufklapp.dataset.offen = "false"; aufklapp.setAttribute("aria-hidden", "true"); aufklapp.inert = true;
    zeichneListe();
  }
  const klappAuf = () => { if (!S.offen && listeWert().some((id) => !S.obenIds.includes(id))) oeffne(); };

  zeichneKarten(); zeichneListe(); klappAuf();
  return {
    el,
    wert: listeWert,
    setzeWert(ids) { S.auswahl = new Set((ids || []).filter((id) => index.has(id))); syncAuswahl(); klappAuf(); },
    setzeErkennung(neu) { S.erkennung = neu; zeichneKarten(); zeichneListe(); klappAuf(); },
    setzeVerbunden(ids) { S.verbunden = new Set(ids || []); zeichneKarten(); zeichneListe(); },
    oeffne, schliesse,
    // Während etwas läuft, das von der Auswahl abhängt: nichts ändern lassen
    sperre(an) { S.gesperrt = !!an; el.toggleAttribute("data-gesperrt", !!an); for (const k of karten.querySelectorAll(".ka-karte")) k.disabled = !!an; },
    fokus() { (karten.querySelector(".ka-karte[aria-checked='true']") || karten.querySelector(".ka-karte") || mehr).focus(); },
  };
}
