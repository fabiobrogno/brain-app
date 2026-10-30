// Aufgaben-Board: Kanban mit den Spalten Offen · In Arbeit · Warten · Erledigt. Jede Karte ist eine Markdown-Datei im Vault (Format: docs/plaene/aufgaben.md);
// das Board liest sie über GET /api/aufgaben und ändert sie über PATCH /api/aufgaben/<pfad> — je Änderung genau eine Datei.
// Bedienung: Karte ziehen (Maus) oder Alt+Pfeiltasten (Tastatur), Enter öffnet die Datei im Editor, das Menü „⋯“ (auch Rechtsklick) ändert Spalte, Priorität, Fälligkeit.
// Kein innerHTML mit Daten aus dem Vault: alles läuft über h()/textContent.
import { h } from "./hilfen.js";
import { symbol } from "./symbole.js";
import { kiLogo, kiLogoName } from "./ki-logos.js";
import { oeffneMenue } from "./menue.js";
import { TA } from "./texte-aufgaben.js";

export const SPALTEN = ["offen", "in-arbeit", "warten", "erledigt"];
const FILTER_STANDARD = { prio: "alle", quelle: "alle", faellig: "alle" };
const TAG = 86400000;

// ---------- Datum ----------
const heuteIso = () => new Date().toLocaleDateString("sv-SE");
const plusTage = (iso, n) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d + n).toLocaleDateString("sv-SE"); };
const datumText = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short" }).format(new Date(y, m - 1, d)); };

// Fälligkeit für die Karte: { text, ueber } oder null. Erledigte zeigen das Datum nur still (nie „überfällig“).
export function faelligInfo(a, heute = heuteIso()) {
  if (!a.faellig) return null;
  const datum = datumText(a.faellig);
  if (a.status === "erledigt") return { text: datum, ueber: false };
  if (a.faellig < heute) return { text: `${TA.faellig.ueberfaellig} · ${datum}`, ueber: true };
  if (a.faellig === heute) return { text: TA.faellig.heute, ueber: false, heute: true };
  if (a.faellig === plusTage(heute, 1)) return { text: TA.faellig.morgen, ueber: false };
  return { text: datum, ueber: false };
}

// ---------- Reihenfolge und Filter ----------
export function vergleiche(a, b) {
  const ra = a.rang ?? Infinity, rb = b.rang ?? Infinity;
  if (ra !== rb) return ra < rb ? -1 : 1;
  const ea = a.erstellt || "", eb = b.erstellt || "";
  if (ea !== eb) return ea < eb ? -1 : 1;
  return a.pfad < b.pfad ? -1 : a.pfad > b.pfad ? 1 : 0;
}
export function passt(a, f, heute = heuteIso()) {
  if (f.prio !== "alle" && a.prioritaet !== f.prio) return false;
  if (f.quelle === "mensch" && a.quelle !== "mensch") return false;
  if (f.quelle === "ki" && !String(a.quelle).startsWith("ki:")) return false;
  if (f.faellig === "ohne") return !a.faellig;
  if (f.faellig !== "alle") {
    const d = a.faellig;
    if (!d) return false;
    if (f.faellig === "ueberfaellig") return d < heute && a.status !== "erledigt";
    if (f.faellig === "heute") return d === heute;
    if (f.faellig === "woche") return d >= heute && d <= plusTage(heute, 7);
  }
  return true;
}
// Erledigt und seit mehr als TA.tage Tagen nicht mehr geändert → eingeklappt
const istAlt = (a) => a.status === "erledigt" && Number.isFinite(Date.parse(a.geaendert)) && Date.parse(a.geaendert) < Date.now() - TA.tage * TAG;

// ---------- Kleine Bausteine ----------
function quelleEl(quelle) {
  if (String(quelle).startsWith("ki:")) {
    const id = quelle.slice(3);
    const name = kiLogoName(id) || id.charAt(0).toUpperCase() + id.slice(1);
    const text = TA.quelle.ki(name);
    return h("span", { klasse: "au-quelle ki", title: text, role: "img", "aria-label": text, "data-quelle": quelle }, kiLogo(id, 14, { dekorativ: true }) || symbol("funke", 14));
  }
  return h("span", { klasse: "au-quelle", title: TA.quelle.mensch, role: "img", "aria-label": TA.quelle.mensch, "data-quelle": "mensch" }, symbol("person", 14));
}
function prioEl(prio) {
  if (prio === "normal") return null;
  return h("span", { klasse: `au-chip prio ${prio}`, "data-prio": prio }, symbol(prio === "hoch" ? "pfeil-oben" : "pfeil-unten", 12), h("span", { text: TA.prio[prio] }));
}

// ctx: { api, toast(text, {fehler}), oeffneDatei(pfad), fragVertrauen(), istNichtVertraut(e), lokal: { lies(name, fallback), schreib(name, wert) } }
export function baueAufgaben(host, ctx) {
  const { api } = ctx;
  const st = { liste: [], vertraut: true, geladen: false, fehler: null, filter: { ...FILTER_STANDARD, ...(ctx.lokal.lies("aufgabenFilter", {}) || {}) },
    alteZeigen: false, drag: null, fokusPfad: null, neuPfad: null, ladeNr: 0, weg: false };
  for (const k of Object.keys(FILTER_STANDARD)) if (typeof st.filter[k] !== "string") st.filter[k] = FILTER_STANDARD[k];

  // Änderungen laufen nacheinander: schnelles Ziehen mehrerer Karten darf sich nicht überholen.
  // Solange eine Änderung unterwegs ist, wird nicht nachgeladen (das ließe die Karte kurz zurückspringen); danach holt `fertig` es nach.
  let kette = Promise.resolve(), unterwegs = 0, nachladen = false;
  const reihe = (fn) => {
    unterwegs++;
    const lauf = kette.then(fn);
    kette = lauf.catch(() => {}).then(() => { if (--unterwegs === 0 && nachladen && !st.weg) { nachladen = false; lade({ leise: true }); } });
    return lauf;
  };

  // ---------- Gerüst (einmal gebaut) ----------
  const eingabe = h("input", { type: "text", klasse: "au-eingabe", "data-aufgabe-eingabe": "", placeholder: TA.erfassen.platzhalter, "aria-label": TA.erfassen.label,
    maxlength: "200", autocomplete: "off", spellcheck: "false" });
  const form = h("form", { klasse: "au-erfassen", novalidate: "", aufSubmit: (e) => { e.preventDefault(); erfasse(); } },
    symbol("plus", 16), eingabe, h("button", { type: "submit", klasse: "knopf primaer", "data-aufgabe-anlegen": "", text: TA.erfassen.knopf }));
  const zahlEl = h("span", { klasse: "au-zahl", "data-aufgaben-zahl": "" });
  const waehle = (name, label, optionen) => {
    const sel = h("select", { "data-filter": name, "aria-label": label, aufChange: (e) => { st.filter[name] = e.target.value; ctx.lokal.schreib("aufgabenFilter", st.filter); zeichne(); } },
      optionen.map(([w, t]) => h("option", { value: w, text: t })));
    sel.value = st.filter[name];
    return h("label", { klasse: "au-filter-feld" }, h("span", { text: label }), sel);
  };
  const reset = h("button", { type: "button", klasse: "knopf-text au-reset", "data-filter-reset": "", text: TA.filter.zuruecksetzen, hidden: true, aufClick: () => { Object.assign(st.filter, FILTER_STANDARD); ctx.lokal.schreib("aufgabenFilter", st.filter); syncFilter(); zeichne(); } });
  const filterEl = h("div", { klasse: "au-filter", role: "group", "aria-label": TA.filter.label },
    waehle("prio", TA.filter.prio, [["alle", TA.filter.alle], ["hoch", TA.prio.hoch], ["normal", TA.prio.normal], ["niedrig", TA.prio.niedrig]]),
    waehle("quelle", TA.filter.quelle, [["alle", TA.filter.alle], ["mensch", TA.filter.mensch], ["ki", TA.filter.ki]]),
    waehle("faellig", TA.filter.faellig, [["alle", TA.filter.alle], ["ueberfaellig", TA.filter.ueberfaellig], ["heute", TA.filter.heute], ["woche", TA.filter.woche], ["ohne", TA.filter.ohne]]),
    reset);
  const syncFilter = () => { filterEl.querySelectorAll("select").forEach((s) => { s.value = st.filter[s.dataset.filter]; }); };
  const hinweis = h("div", { klasse: "au-hinweis", role: "status", hidden: true, "data-aufgaben-hinweis": "" },
    symbol("schild", 16), h("span", { text: TA.nichtVertraut }), h("button", { type: "button", klasse: "knopf", text: TA.bestaetigen, aufClick: () => ctx.fragVertrauen() }));
  const ansage = h("div", { klasse: "au-ansage", role: "status", "aria-live": "polite" });
  const brett = h("div", { klasse: "au-brett", "data-aufgaben-brett": "" });
  const wurzel = h("section", { klasse: "au", "aria-label": TA.titel, "data-ansicht": "aufgaben" },
    h("header", { klasse: "au-kopf" },
      h("div", { klasse: "au-titelzeile" }, h("h2", { klasse: "au-titel-h" }, symbol("aufgaben", 18), h("span", { text: TA.titel })), zahlEl),
      form, filterEl, hinweis),
    brett, ansage);
  host.replaceChildren(wurzel);

  // ---------- Daten ----------
  async function lade({ leise = false } = {}) {
    if (unterwegs > 0 && st.geladen) { nachladen = true; return; }
    const nr = ++st.ladeNr;
    try {
      const r = await api.aufgaben();
      if (st.weg || nr !== st.ladeNr) return;
      st.liste = Array.isArray(r?.aufgaben) ? r.aufgaben : [];
      st.vertraut = r?.vertraut !== false;
      st.fehler = null;
    } catch (e) {
      if (st.weg || nr !== st.ladeNr) return;
      if (!leise || !st.geladen) st.fehler = e.message || TA.fehler.laden;
    }
    st.geladen = true;
    if (!st.drag) zeichne();
  }
  const finde = (pfad) => st.liste.find((a) => a.pfad === pfad);
  const spalteVon = (status, mitFilter = true) => st.liste.filter((a) => a.status === status && (!mitFilter || passt(a, st.filter))).sort(vergleiche);
  const sichtbarInSpalte = (status) => {
    const alle = spalteVon(status);
    if (status !== "erledigt") return { karten: alle, alte: 0 };
    const frisch = alle.filter((a) => !istAlt(a));
    return st.alteZeigen ? { karten: alle, alte: alle.length - frisch.length } : { karten: frisch, alte: alle.length - frisch.length };
  };

  // ---------- Zeichnen ----------
  function karteEl(a, status, nr, von) {
    const f = faelligInfo(a);
    const prio = prioEl(a.prioritaet);
    const mehr = h("button", { type: "button", klasse: "au-mehr", "data-aufgabe-menue": "", "aria-label": TA.karte.menue, title: TA.karte.menue, tabindex: "-1",
      aufClick: (ev) => { ev.stopPropagation(); oeffneKartenMenue(a, mehr); } }, symbol("punkte", 14));
    const el = h("article", { klasse: "au-karte" + (f?.ueber ? " ueberfaellig" : "") + (st.neuPfad === a.pfad ? " neu" : ""), role: "listitem", tabindex: "0", draggable: st.vertraut ? "true" : "false",
      "data-karte-aufgabe": "", "data-pfad": a.pfad, "data-status": a.status, "data-prio": a.prioritaet, "data-quelle": a.quelle,
      "aria-label": `${a.titel}. ${TA.spalten[status]}, Platz ${nr} von ${von}.${f ? ` ${f.text}.` : ""}`, title: `${a.titel}\n${TA.karte.hinweisTasten}`,
      aufClick: () => ctx.oeffneDatei(a.pfad),
      aufContextmenu: (ev) => { ev.preventDefault(); oeffneKartenMenue(a, mehr); },
      aufDragstart: (ev) => dragStart(ev, a, el),
      aufDragend: () => dragEnde() },
      h("div", { klasse: "au-karte-kopf" }, h("div", { klasse: "au-titel", text: a.titel }), mehr),
      a.vorschau ? h("div", { klasse: "au-vorschau", text: a.vorschau }) : null,
      h("div", { klasse: "au-meta" },
        prio,
        f ? h("span", { klasse: "au-chip faellig" + (f.ueber ? " ueber" : "") + (f.heute ? " heute" : ""), "data-faellig": a.faellig }, symbol(f.ueber ? "warnung" : "kalender", 12), h("span", { text: f.text })) : null,
        h("span", { klasse: "au-abstand" }), quelleEl(a.quelle)));
    return el;
  }
  function spalteEl(status) {
    const { karten, alte } = sichtbarInSpalte(status);
    const zahl = String(karten.length);
    const liste = h("div", { klasse: "au-karten", role: "list", "aria-label": TA.spalten[status], "data-spalte-karten": status },
      karten.map((a, i) => karteEl(a, status, i + 1, karten.length)));
    if (!karten.length) liste.append(h("div", { klasse: "au-spalte-leer", text: TA.spalteLeer }));
    const fuss = status === "erledigt" && alte > 0
      ? h("button", { type: "button", klasse: "knopf-text au-alte", "data-alte-umschalten": "", "aria-pressed": String(st.alteZeigen), text: st.alteZeigen ? TA.erledigtAlteZu : TA.erledigtAlte(alte),
        aufClick: () => { st.alteZeigen = !st.alteZeigen; zeichne(); } })
      : null;
    const el = h("section", { klasse: "au-spalte", "data-spalte": status, "aria-label": TA.spalten[status] },
      h("header", { klasse: "au-spalte-kopf" }, h("span", { klasse: `au-punkt ${status}`, "aria-hidden": "true" }), h("h3", { text: TA.spalten[status] }), h("span", { klasse: "au-spalte-zahl", text: zahl })),
      liste, fuss);
    el.addEventListener("dragover", (ev) => dragUeber(ev, el, status));
    el.addEventListener("dragleave", (ev) => { if (!el.contains(ev.relatedTarget)) { el.classList.remove("ziel"); entferneMarke(); } });
    el.addEventListener("drop", (ev) => dragAblegen(ev));
    return el;
  }
  function zeichne() {
    const heute = heuteIso();
    let offen = 0, ueber = 0;
    for (const a of st.liste) if (a.status !== "erledigt") { offen++; if (a.faellig && a.faellig < heute) ueber++; }
    zahlEl.textContent = TA.zahl(offen, ueber);
    zahlEl.classList.toggle("warn", ueber > 0);
    hinweis.hidden = st.vertraut;
    eingabe.disabled = !st.vertraut;
    const aktiv = Object.keys(FILTER_STANDARD).some((k) => st.filter[k] !== FILTER_STANDARD[k]);
    reset.hidden = !aktiv;
    // Fokus merken: nach dem Neuzeichnen kommt er auf dieselbe Karte zurück
    const fokus = st.fokusPfad || (host.contains(document.activeElement) ? document.activeElement.closest?.("[data-karte-aufgabe]")?.dataset.pfad : null);
    st.fokusPfad = null;
    if (st.fehler && !st.liste.length) {
      brett.replaceChildren(h("div", { klasse: "au-leer", "data-aufgaben-fehler": "" }, symbol("warnung", 22), h("h3", { text: TA.fehler.laden }), h("p", { text: st.fehler }),
        h("button", { type: "button", klasse: "knopf", text: "Neu laden", aufClick: () => lade() })));
      return;
    }
    if (st.geladen && !st.liste.length) {
      brett.replaceChildren(h("div", { klasse: "au-leer", "data-aufgaben-leer": "" }, symbol("aufgaben", 28), h("h3", { text: TA.leer.titel }), h("p", { text: TA.leer.text })));
      return;
    }
    const sichtbar = SPALTEN.reduce((n, s) => n + sichtbarInSpalte(s).karten.length, 0);
    brett.replaceChildren(...SPALTEN.map(spalteEl));
    if (aktiv && !sichtbar) brett.prepend(h("div", { klasse: "au-leer klein", "data-aufgaben-gefiltert": "" }, h("p", { text: TA.filter.keine })));
    if (fokus) brett.querySelector(`[data-karte-aufgabe][data-pfad="${CSS.escape(fokus)}"]`)?.focus({ preventScroll: false });
    if (st.neuPfad) { const neu = st.neuPfad; setTimeout(() => { if (st.neuPfad === neu) st.neuPfad = null; }, 1600); }
  }

  // ---------- Anlegen ----------
  async function erfasse() {
    const titel = eingabe.value.trim();
    if (!titel) { ansage.textContent = TA.erfassen.leer; eingabe.focus(); return; }
    if (!st.vertraut) { ctx.fragVertrauen(); return; }
    try {
      const r = await reihe(() => api.aufgabeNeu({ titel }));
      st.liste.push(r.aufgabe);
      st.neuPfad = r.pfad;
      eingabe.value = "";
      zeichne();
      ctx.toast(TA.erfassen.angelegt(r.aufgabe.titel));
      ctx.beiAenderung?.();
    } catch (e) { behandleFehler(e, TA.fehler.anlegen); }
    eingabe.focus();
  }
  function behandleFehler(e, standard) {
    if (ctx.istNichtVertraut(e)) { st.vertraut = false; zeichne(); ctx.fragVertrauen(); return; }
    ctx.toast(e?.message || standard, { fehler: true });
  }

  // ---------- Ändern ----------
  // felder: an die Werkstatt; lokal: sofort sichtbarer Stand; platz: { davor, danach } (Pfade) für die Stelle in der Spalte
  async function aendere(a, felder, { lokal, platz, zielText } = {}) {
    const vorher = { ...a };
    Object.assign(a, lokal || felder);
    st.fokusPfad = a.pfad;
    zeichne();
    try {
      const r = await reihe(() => api.aufgabeAendern(a.pfad, platz ? { ...felder, platz } : felder));
      if (r.geaendert && r.geaendert.length > 1) await lade({ leise: true });
      else { Object.assign(a, r.aufgabe); st.fokusPfad = a.pfad; zeichne(); }
      ctx.beiAenderung?.();
      if (zielText) {
        const sp = spalteVon(a.status), i = sp.findIndex((x) => x.pfad === a.pfad);
        ansage.textContent = TA.ansage.verschoben(a.titel, zielText, i + 1, sp.length);
      }
    } catch (e) {
      Object.assign(a, vorher);
      st.fokusPfad = a.pfad;
      zeichne();
      behandleFehler(e, TA.fehler.speichern);
      lade({ leise: true });
    }
  }
  // Rang für die sofortige Anzeige (die Werkstatt rechnet danach den endgültigen)
  function rangLokal(davor, danach) {
    const r1 = davor?.rang ?? null, r2 = danach?.rang ?? null;
    if (r1 !== null && r2 !== null) return r1 < r2 ? (r1 + r2) / 2 : r1 + 0.0001;
    if (r1 !== null) return r1 + 1000;
    if (r2 !== null) return r2 - 1000;
    return 1000;
  }
  function verschiebe(a, status, davorPfad, danachPfad) {
    if (!st.vertraut) { ctx.fragVertrauen(); return; }
    const davor = davorPfad ? finde(davorPfad) : null, danach = danachPfad ? finde(danachPfad) : null;
    // nichts zu tun, wenn die Karte schon genau dort steht
    const alle = spalteVon(a.status), i = alle.findIndex((x) => x.pfad === a.pfad);
    if (status === a.status && (alle[i - 1]?.pfad ?? null) === (davorPfad ?? null) && (alle[i + 1]?.pfad ?? null) === (danachPfad ?? null)) return;
    aendere(a, { status }, { lokal: { status, rang: rangLokal(davor, danach) }, platz: { davor: davorPfad || null, danach: danachPfad || null }, zielText: TA.spalten[status] });
  }

  // ---------- Menü an der Karte ----------
  function oeffneKartenMenue(a, anker) {
    if (!st.vertraut) { ctx.fragVertrauen(); return; }
    const heute = heuteIso();
    const setzeFaellig = (iso) => aendere(a, { faellig: iso });
    oeffneMenue(anker, [
      { gruppe: TA.karte.verschieben },
      ...SPALTEN.map((s) => ({ name: TA.spalten[s], id: `spalte-${s}`, haken: a.status === s, tun: () => { if (a.status !== s) aendere(a, { status: s }, { lokal: { status: s, rang: 1e12 }, zielText: TA.spalten[s] }); } })),
      { trenner: true }, { gruppe: TA.karte.prioritaet },
      ...["hoch", "normal", "niedrig"].map((p) => ({ name: TA.prio[p], id: `prio-${p}`, haken: a.prioritaet === p, tun: () => { if (a.prioritaet !== p) aendere(a, { prioritaet: p }); } })),
      { trenner: true }, { gruppe: TA.karte.faelligGruppe },
      { name: TA.karte.faelligHeute, id: "faellig-heute", symbol: "kalender", tun: () => setzeFaellig(heute) },
      { name: TA.karte.faelligMorgen, id: "faellig-morgen", symbol: "kalender", tun: () => setzeFaellig(plusTage(heute, 1)) },
      { name: TA.karte.faelligWoche, id: "faellig-woche", symbol: "kalender", tun: () => setzeFaellig(plusTage(heute, 7)) },
      ...(a.faellig ? [{ name: TA.karte.faelligKein, id: "faellig-kein", symbol: "schliessen", tun: () => setzeFaellig(null) }] : []),
      { trenner: true },
      { name: TA.karte.oeffnen, id: "oeffnen", symbol: "notiz", tun: () => ctx.oeffneDatei(a.pfad) },
    ], { rechts: true });
  }

  // ---------- Ziehen mit der Maus ----------
  let marke = null;
  function entferneMarke() { marke?.remove(); marke = null; }
  function dragStart(ev, a, el) {
    if (!st.vertraut) { ev.preventDefault(); return; }
    st.drag = { pfad: a.pfad, ziel: null };
    ev.dataTransfer.effectAllowed = "move";
    ev.dataTransfer.setData("text/plain", a.pfad);
    setTimeout(() => el.classList.add("zieht"), 0);
  }
  function dragEnde() {
    st.drag = null; entferneMarke();
    brett.querySelectorAll(".zieht").forEach((e) => e.classList.remove("zieht"));
    brett.querySelectorAll(".ziel").forEach((e) => e.classList.remove("ziel"));
    zeichne(); // Änderungen von außen, die während des Ziehens kamen, nachholen
  }
  function dragUeber(ev, el, status) {
    if (!st.drag) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "move";
    const behaelter = el.querySelector(".au-karten");
    const karten = [...behaelter.querySelectorAll(".au-karte:not(.zieht)")];
    const i = karten.findIndex((k) => { const r = k.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2; });
    const vor = i < 0 ? null : karten[i];
    st.drag.ziel = { status, davor: (i < 0 ? karten[karten.length - 1] : karten[i - 1])?.dataset.pfad ?? null, danach: vor?.dataset.pfad ?? null };
    brett.querySelectorAll(".au-spalte.ziel").forEach((e) => { if (e !== el) e.classList.remove("ziel"); });
    el.classList.add("ziel");
    if (!marke) marke = h("div", { klasse: "au-marke", "aria-hidden": "true" });
    behaelter.querySelector(".au-spalte-leer")?.remove();
    if (vor) behaelter.insertBefore(marke, vor); else behaelter.append(marke);
  }
  function dragAblegen(ev) {
    if (!st.drag) return;
    ev.preventDefault();
    const { pfad, ziel } = st.drag;
    entferneMarke();
    st.drag = null;
    const a = finde(pfad);
    if (a && ziel) verschiebe(a, ziel.status, ziel.davor, ziel.danach);
    else zeichne();
  }

  // ---------- Tastatur ----------
  brett.addEventListener("keydown", (ev) => {
    const el = ev.target.closest?.("[data-karte-aufgabe]");
    if (!el || ev.target !== el) return;
    const a = finde(el.dataset.pfad);
    if (!a) return;
    const sp = SPALTEN.indexOf(a.status);
    const karten = [...brett.querySelectorAll(`[data-spalte-karten="${a.status}"] [data-karte-aufgabe]`)];
    const i = karten.indexOf(el);
    if (ev.key === "Enter" && !ev.altKey) { ev.preventDefault(); ctx.oeffneDatei(a.pfad); return; }
    if (ev.key === "ContextMenu" || (ev.key === "F10" && ev.shiftKey)) { ev.preventDefault(); oeffneKartenMenue(a, el); return; }
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(ev.key)) return;
    ev.preventDefault();
    if (ev.altKey) { // verschieben
      if (!st.vertraut) { ctx.fragVertrauen(); return; }
      if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
        const ziel = SPALTEN[sp + (ev.key === "ArrowRight" ? 1 : -1)];
        if (ziel) { const zk = spalteVon(ziel); verschiebe(a, ziel, zk[zk.length - 1]?.pfad ?? null, null); }
      } else if (ev.key === "ArrowUp" && i > 0) verschiebe(a, a.status, karten[i - 2]?.dataset.pfad ?? null, karten[i - 1].dataset.pfad);
      else if (ev.key === "ArrowDown" && i < karten.length - 1) verschiebe(a, a.status, karten[i + 1].dataset.pfad, karten[i + 2]?.dataset.pfad ?? null);
      return;
    }
    if (ev.key === "ArrowDown") karten[i + 1]?.focus();
    else if (ev.key === "ArrowUp") karten[i - 1]?.focus();
    else {
      for (let s = sp + (ev.key === "ArrowRight" ? 1 : -1); s >= 0 && s < SPALTEN.length; s += ev.key === "ArrowRight" ? 1 : -1) {
        const k = [...brett.querySelectorAll(`[data-spalte-karten="${SPALTEN[s]}"] [data-karte-aufgabe]`)];
        if (k.length) { k[Math.min(i, k.length - 1)].focus(); break; }
      }
    }
  });
  eingabe.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { eingabe.value = ""; eingabe.blur(); } });

  zeichne();
  return {
    lade,
    fokusErfassen: () => { eingabe.focus(); eingabe.select(); },
    zerstoere: () => { st.weg = true; entferneMarke(); host.replaceChildren(); },
    // Stand von außen (Index hat sich geändert): leise nachladen, aber nicht mitten im Ziehen
    aktualisiere: () => { if (!st.drag) return lade({ leise: true }); },
    liste: () => st.liste,
  };
}
