// Aufgaben-Board: Kanban mit den Spalten Offen · In Arbeit · Warten · Erledigt. Jede Karte ist eine Markdown-Datei im Vault (Format: docs/plaene/aufgaben.md);
// das Board liest sie über GET /api/aufgaben und ändert sie über PATCH /api/aufgaben/<pfad> — je Änderung genau eine Datei.
// Bedienung: Karte ziehen (Maus) oder Alt+Pfeiltasten (Tastatur), Enter öffnet die Datei im Editor, das Menü „⋯“ (auch Rechtsklick) ändert Spalte, Priorität, Fälligkeit.
// Kein innerHTML mit Daten aus dem Vault: alles läuft über h()/textContent.
import { h } from "./hilfen.js";
import { symbol, GROESSE } from "./symbole.js";
import { kiLogo, kiLogoName } from "./ki-logos.js";
import { oeffneMenue } from "./menue.js";
import { textfeld, leerBlock, filterChip, knopf, oeffneDatumsauswahl, tooltip, skelett } from "./bausteine.js";
import { wenigBewegung } from "./popover.js";
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

// Erledigt und seit mehr als TA.archiv.tage Tagen nicht mehr geändert → darf ins Archiv (die Werkstatt rechnet beim Archivieren selbst nach)
const archivReifSeit = (a, jetzt = Date.now()) => a.status === "erledigt" && Number.isFinite(Date.parse(a.geaendert)) && Date.parse(a.geaendert) < jetzt - TA.archiv.tage * TAG;

// ---------- Kleine Bausteine ----------
function quelleEl(quelle) {
  if (String(quelle).startsWith("ki:")) {
    const id = quelle.slice(3);
    const name = kiLogoName(id) || id.charAt(0).toUpperCase() + id.slice(1);
    const text = TA.quelle.ki(name);
    return h("span", { klasse: "au-quelle ki", title: text, role: "img", "aria-label": text, "data-quelle": quelle }, kiLogo(id, 14, { dekorativ: true }) || symbol("funke", GROESSE.text));
  }
  return h("span", { klasse: "au-quelle", title: TA.quelle.mensch, role: "img", "aria-label": TA.quelle.mensch, "data-quelle": "mensch" }, symbol("person", GROESSE.text));
}
function prioEl(prio) {
  if (prio === "normal") return null;
  return h("span", { klasse: `au-chip prio ${prio}`, "data-prio": prio }, symbol(prio === "hoch" ? "pfeil-oben" : "pfeil-unten", 12), h("span", { text: TA.prio[prio] }));
}

// ctx: { api, toast(text, {fehler}), oeffneDatei(pfad), fragVertrauen(), istNichtVertraut(e), lokal: { lies(name, fallback), schreib(name, wert) } }
export function baueAufgaben(host, ctx) {
  const { api } = ctx;
  const st = { liste: [], vertraut: true, geladen: false, fehler: null, filter: { ...FILTER_STANDARD, ...(ctx.lokal.lies("aufgabenFilter", {}) || {}) },
    alteZeigen: false, drag: null, fokusPfad: null, neuPfad: null, ladeNr: 0, weg: false, landet: null };
  for (const k of Object.keys(FILTER_STANDARD)) if (typeof st.filter[k] !== "string") st.filter[k] = FILTER_STANDARD[k];

  // Änderungen laufen nacheinander: schnelles Ziehen mehrerer Karten darf sich nicht überholen.
  // Solange eine Änderung unterwegs ist, wird nicht nachgeladen (das ließe die Karte kurz zurückspringen); danach holt `fertig` es nach.
  // aenderNr zählt jede lokale Änderung: ein Nachladen, das vor einer Änderung losging, kommt mit veraltetem Stand zurück und wird verworfen
  // (sonst sprängen Karten zurück). ausstehend: je Karte die noch nicht beantworteten Änderungen — die Antwort einer früheren Änderung darf den
  // sofort sichtbaren Stand einer späteren nicht überschreiben (schnelle Alt+Pfeil-Folgen).
  let kette = Promise.resolve(), unterwegs = 0, nachladen = false, aenderNr = 0;
  const ausstehend = new Map();
  const reihe = (fn) => {
    unterwegs++;
    const lauf = kette.then(fn);
    kette = lauf.catch(() => {}).then(() => { if (--unterwegs === 0 && nachladen && !st.weg) { nachladen = false; lade({ leise: true }); } });
    return lauf;
  };

  // ---------- Gerüst (einmal gebaut) ----------
  const feld = textfeld({ klasse: "au-eingabefeld", symbol: "plus", platzhalter: TA.erfassen.platzhalter, label: TA.erfassen.label, maxlaenge: 200, daten: { "data-aufgabe-eingabe": "" } });
  const eingabe = feld.input;
  const anlegen = knopf({ text: TA.erfassen.knopf, variante: "primaer", typ: "submit", daten: { "data-aufgabe-anlegen": "" } });
  const form = h("form", { klasse: "au-erfassen", novalidate: "", aufSubmit: (e) => { e.preventDefault(); erfasse(); } }, feld.el, anlegen);
  const zahlEl = h("span", { klasse: "au-zahl", "data-aufgaben-zahl": "" });
  // Filter als Chips („Priorität: Alle ▾“): aktive sind farbig, das ✕ setzt zurück
  const chip = (name, label, optionen) => filterChip({ label, optionen: optionen.map(([wert, text]) => ({ wert, text })), wert: st.filter[name], standard: FILTER_STANDARD[name], daten: { "data-filter": name },
    aufAenderung: (w) => { st.filter[name] = w; ctx.lokal.schreib("aufgabenFilter", st.filter); zeichne(); } });
  const chips = {
    prio: chip("prio", TA.filter.prio, [["alle", TA.filter.alle], ["hoch", TA.prio.hoch], ["normal", TA.prio.normal], ["niedrig", TA.prio.niedrig]]),
    quelle: chip("quelle", TA.filter.quelle, [["alle", TA.filter.alle], ["mensch", TA.filter.mensch], ["ki", TA.filter.ki]]),
    faellig: chip("faellig", TA.filter.faellig, [["alle", TA.filter.alle], ["ueberfaellig", TA.filter.ueberfaellig], ["heute", TA.filter.heute], ["woche", TA.filter.woche], ["ohne", TA.filter.ohne]]),
  };
  const syncFilter = () => { for (const k of Object.keys(chips)) chips[k].setze(st.filter[k]); };
  const reset = knopf({ text: TA.filter.zuruecksetzen, variante: "leise", groesse: "s", klasse: "au-reset", daten: { "data-filter-reset": "" },
    aufKlick: () => { Object.assign(st.filter, FILTER_STANDARD); ctx.lokal.schreib("aufgabenFilter", st.filter); syncFilter(); zeichne(); } });
  reset.hidden = true;
  const filterEl = h("div", { klasse: "au-filter", role: "group", "aria-label": TA.filter.label }, chips.prio, chips.quelle, chips.faellig, reset);
  const hinweis = h("div", { klasse: "au-hinweis", role: "status", hidden: true, "data-aufgaben-hinweis": "" },
    symbol("schild", GROESSE.norm), h("span", { text: TA.nichtVertraut }), h("button", { type: "button", klasse: "knopf", text: TA.bestaetigen, aufClick: () => ctx.fragVertrauen() }));
  const ansage = h("div", { klasse: "au-ansage", role: "status", "aria-live": "polite" });
  const brett = h("div", { klasse: "au-brett", "data-aufgaben-brett": "" });
  const wurzel = h("section", { klasse: "au", "aria-label": TA.titel, "data-ansicht": "aufgaben" },
    h("header", { klasse: "au-kopf" },
      h("div", { klasse: "au-titelzeile" }, h("h2", { klasse: "au-titel-h" }, symbol("aufgaben", GROESSE.gross), h("span", { text: TA.titel })), zahlEl),
      form, filterEl, hinweis),
    brett, ansage);
  host.replaceChildren(wurzel);

  // ---------- Daten ----------
  async function lade({ leise = false } = {}) {
    if (unterwegs > 0 && st.geladen) { nachladen = true; return; }
    const nr = ++st.ladeNr, stand = aenderNr;
    try {
      const r = await api.aufgaben();
      if (st.weg || nr !== st.ladeNr) return;
      // Seit dem Start dieses Ladens hat sich hier etwas geändert: der Stand ist veraltet — verwerfen und (sobald nichts mehr unterwegs ist) neu holen
      if (stand !== aenderNr && st.geladen) { if (unterwegs > 0) nachladen = true; else lade({ leise: true }); return; }
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
    const mehr = h("button", { type: "button", klasse: "au-mehr", "data-aufgabe-menue": "", "aria-label": TA.karte.menue, tabindex: "-1",
      aufClick: (ev) => { ev.stopPropagation(); oeffneKartenMenue(a, mehr); } }, symbol("punkte", GROESSE.text));
    tooltip(mehr, TA.karte.menue);
    const vorlaeufig = !!a.vorlaeufig;
    const el = h("article", { klasse: "au-karte" + (f?.ueber ? " ueberfaellig" : "") + (st.neuPfad === a.pfad ? " neu" : "") + (vorlaeufig ? " vorlaeufig" : "") + (st.landet === a.pfad ? " landet" : ""), role: "listitem", tabindex: "0", "data-ziehbar": String(st.vertraut && !vorlaeufig), "aria-busy": vorlaeufig ? "true" : null,
      "data-karte-aufgabe": "", "data-pfad": a.pfad, "data-status": a.status, "data-prio": a.prioritaet, "data-quelle": a.quelle,
      "aria-label": `${a.titel}. ${TA.spalten[status]}, Platz ${nr} von ${von}.${f ? ` ${f.text}.` : ""}`, title: `${a.titel}\n${TA.karte.hinweisTasten}`,
      aufClick: () => { if (!vorlaeufig) ctx.oeffneDatei(a.pfad); },
      aufContextmenu: (ev) => { ev.preventDefault(); if (!vorlaeufig) oeffneKartenMenue(a, mehr); } },
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
    const laedt = !st.geladen; // Skelett statt leerer Spalten: es blendet erst nach 150 ms ein (bausteine.css), schnelle Ladevorgänge flackern nicht
    const liste = h("div", { klasse: "au-karten", role: "list", "aria-label": TA.spalten[status], "data-spalte-karten": status, "aria-busy": laedt ? "true" : null },
      laedt ? [skelett("au-sk-karte"), skelett("au-sk-karte kurz")] : karten.map((a, i) => karteEl(a, status, i + 1, karten.length)));
    if (!laedt && !karten.length) liste.append(h("div", { klasse: "au-spalte-leer", text: TA.spalteLeer }));
    const archivReif = status === "erledigt" && !laedt ? zuArchivieren().length : 0;
    const fuss = status === "erledigt" && (alte > 0 || archivReif > 0)
      ? h("div", { klasse: "au-fuss" },
        alte > 0 ? h("button", { type: "button", klasse: "knopf-text au-alte", "data-alte-umschalten": "", "aria-pressed": String(st.alteZeigen), text: st.alteZeigen ? TA.erledigtAlteZu : TA.erledigtAlte(alte),
          aufClick: () => { st.alteZeigen = !st.alteZeigen; zeichne(); } }) : null,
        archivReif > 0 ? h("button", { type: "button", klasse: "knopf-text au-alte", "data-archiv-alle": "", title: TA.archiv.alleTitel, text: TA.archiv.alle(archivReif),
          aufClick: () => archiviereAlte() }) : null)
      : null;
    const el = h("section", { klasse: "au-spalte", "data-spalte": status, "aria-label": TA.spalten[status] },
      h("header", { klasse: "au-spalte-kopf" }, h("span", { klasse: `au-punkt ${status}`, "aria-hidden": "true" }), h("h3", { text: TA.spalten[status] }), h("span", { klasse: "au-spalte-zahl", text: laedt ? "" : zahl })),
      liste, fuss);
    return el;
  }
  function zeichne() {
    const heute = heuteIso();
    let offen = 0, ueber = 0;
    for (const a of st.liste) if (a.status !== "erledigt") { offen++; if (a.faellig && a.faellig < heute) ueber++; }
    zahlEl.textContent = st.geladen ? TA.zahl(offen, ueber) : "";
    zahlEl.classList.toggle("warn", ueber > 0);
    hinweis.hidden = st.vertraut;
    eingabe.disabled = !st.vertraut;
    const aktiv = Object.keys(FILTER_STANDARD).some((k) => st.filter[k] !== FILTER_STANDARD[k]);
    reset.hidden = !aktiv;
    // Fokus merken: nach dem Neuzeichnen kommt er auf dieselbe Karte zurück
    const fokus = st.fokusPfad || (host.contains(document.activeElement) ? document.activeElement.closest?.("[data-karte-aufgabe]")?.dataset.pfad : null);
    st.fokusPfad = null;
    if (st.fehler && !st.liste.length) {
      brett.replaceChildren(h("div", { klasse: "au-leer", "data-aufgaben-fehler": "" }, symbol("warnung", GROESSE.kachel), h("h3", { text: TA.fehler.laden }), h("p", { text: st.fehler }),
        h("button", { type: "button", klasse: "knopf", text: "Neu laden", aufClick: () => lade() })));
      return;
    }
    if (st.geladen && !st.liste.length) {
      brett.replaceChildren(leerBlock({ klasse: "au-leer", symbol: "aufgaben", titel: TA.leer.titel, text: TA.leer.text, daten: { "data-aufgaben-leer": "" },
        aktion: { text: TA.leer.knopf, tun: () => eingabe.focus() } }));
      return;
    }
    const sichtbar = SPALTEN.reduce((n, s) => n + sichtbarInSpalte(s).karten.length, 0);
    // Scrollstand der Spalten merken: ein Neuzeichnen darf nichts nach oben springen lassen
    const scroll = new Map([...brett.querySelectorAll("[data-spalte-karten]")].map((e) => [e.dataset.spalteKarten, e.scrollTop]));
    brett.replaceChildren(...SPALTEN.map(spalteEl));
    for (const [sp, y] of scroll) { const e = brett.querySelector(`[data-spalte-karten="${sp}"]`); if (e && y) e.scrollTop = y; }
    if (aktiv && !sichtbar) brett.prepend(h("div", { klasse: "au-leer klein", "data-aufgaben-gefiltert": "" }, h("p", { text: TA.filter.keine })));
    if (fokus) brett.querySelector(`[data-karte-aufgabe][data-pfad="${CSS.escape(fokus)}"]`)?.focus({ preventScroll: false });
    if (st.neuPfad) { const neu = st.neuPfad; setTimeout(() => { if (st.neuPfad === neu) st.neuPfad = null; }, 1600); }
  }

  // ---------- Anlegen ----------
  // Optimistisch: die Karte steht sofort da (blass, „vorläufig“), die Werkstatt bestätigt sie mit dem echten Pfad oder sie verschwindet mit Hinweis wieder.
  let tempNr = 0;
  async function erfasse() {
    const titel = eingabe.value.trim();
    if (!titel) { ansage.textContent = TA.erfassen.leer; eingabe.focus(); feld.feld.classList.add("fehlerhaft"); setTimeout(() => feld.feld.classList.remove("fehlerhaft"), 900); return; }
    if (!st.vertraut) { ctx.fragVertrauen(); return; }
    aenderNr++;
    const rangMax = st.liste.filter((x) => x.status === "offen").reduce((m, x) => Math.max(m, Number.isFinite(x.rang) ? x.rang : 0), 0);
    const temp = { pfad: `__neu-${++tempNr}`, titel, status: "offen", prioritaet: "normal", quelle: "mensch", rang: rangMax + 1000, erstellt: "9999", geaendert: "", vorschau: "", faellig: null, vorlaeufig: true };
    st.liste.push(temp);
    st.neuPfad = temp.pfad;
    eingabe.value = ""; feld.sync();
    zeichne();
    brett.querySelector(`[data-spalte-karten="offen"] [data-pfad="${CSS.escape(temp.pfad)}"]`)?.scrollIntoView({ block: "nearest" });
    try {
      const r = await reihe(() => api.aufgabeNeu({ titel }));
      const i = st.liste.indexOf(temp);
      if (i >= 0) st.liste[i] = r.aufgabe; else st.liste.push(r.aufgabe);
      st.neuPfad = null;
      zeichne();
      ctx.toast(TA.erfassen.angelegt(r.aufgabe.titel));
      ctx.beiAenderung?.();
    } catch (e) {
      st.liste = st.liste.filter((x) => x !== temp);
      st.neuPfad = null;
      if (!eingabe.value) { eingabe.value = titel; feld.sync(); } // der Text geht nicht verloren
      zeichne();
      behandleFehler(e, TA.fehler.anlegen);
    }
    eingabe.focus();
  }
  function behandleFehler(e, standard) {
    if (ctx.istNichtVertraut(e)) { st.vertraut = false; zeichne(); ctx.fragVertrauen(); return; }
    ctx.toast(e?.message || standard, { fehler: true });
  }

  // ---------- Archivieren (verschiebt nur, löscht nie) ----------
  const zuArchivieren = () => st.liste.filter((a) => archivReifSeit(a));
  async function archiviere(a) {
    if (!st.vertraut) { ctx.fragVertrauen(); return; }
    aenderNr++;
    try {
      await reihe(() => api.aufgabenArchivieren({ pfad: a.pfad }));
      st.liste = st.liste.filter((x) => x.pfad !== a.pfad);
      zeichne();
      ansage.textContent = TA.archiv.erledigt(a.titel);
      ctx.toast(TA.archiv.erledigt(a.titel));
      ctx.beiAenderung?.();
    } catch (e) { behandleFehler(e, TA.archiv.fehler); lade({ leise: true }); }
  }
  async function archiviereAlte() {
    if (!st.vertraut) { ctx.fragVertrauen(); return; }
    aenderNr++;
    try {
      const r = await reihe(() => api.aufgabenArchivieren({ aelterAlsTage: TA.archiv.tage }));
      const weg = new Set((Array.isArray(r?.archiviert) ? r.archiviert : []).map((x) => x.von)), n = weg.size;
      st.liste = st.liste.filter((x) => !weg.has(x.pfad));
      zeichne();
      lade({ leise: true }); // gleicht mit der Platte ab (die Werkstatt rechnet das Alter selbst)
      ctx.toast(n ? TA.archiv.erledigtViele(n) : TA.archiv.nichts);
      if (n) ctx.beiAenderung?.();
    } catch (e) { behandleFehler(e, TA.archiv.fehler); lade({ leise: true }); }
  }

  // ---------- Ändern ----------
  // felder: an die Werkstatt; lokal: sofort sichtbarer Stand; platz: { davor, danach } (Pfade) für die Stelle in der Spalte
  async function aendere(a, felder, { lokal, platz, zielText } = {}) {
    const vorher = { ...a }, pfad = a.pfad;
    aenderNr++;
    ausstehend.set(pfad, (ausstehend.get(pfad) || 0) + 1);
    // genau einmal abbuchen (Antwort oder Fehler); true = zu dieser Karte ist keine weitere Änderung mehr unterwegs
    let abgebucht = false;
    const bucheAb = () => {
      if (!abgebucht) { abgebucht = true; const n = (ausstehend.get(pfad) || 1) - 1; if (n > 0) ausstehend.set(pfad, n); else ausstehend.delete(pfad); }
      return !ausstehend.has(pfad);
    };
    Object.assign(a, lokal || felder);
    st.fokusPfad = a.pfad;
    zeichne();
    try {
      const r = await reihe(() => api.aufgabeAendern(a.pfad, platz ? { ...felder, platz } : felder));
      const letzte = bucheAb();
      if (r.geaendert && r.geaendert.length > 1) await lade({ leise: true });
      // Die Antwort einer früheren Änderung zeigt den Stand VOR der späteren: nur die letzte Antwort einer Karte wird übernommen
      else if (letzte) { Object.assign(a, r.aufgabe); st.fokusPfad = a.pfad; zeichne(); }
      ctx.beiAenderung?.();
      if (zielText) {
        const sp = spalteVon(a.status), i = sp.findIndex((x) => x.pfad === a.pfad);
        ansage.textContent = TA.ansage.verschoben(a.titel, zielText, i + 1, sp.length);
      }
    } catch (e) {
      bucheAb();
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
    if (!st.vertraut) { ctx.fragVertrauen(); return false; }
    const davor = davorPfad ? finde(davorPfad) : null, danach = danachPfad ? finde(danachPfad) : null;
    // nichts zu tun, wenn die Karte schon genau dort steht
    const alle = spalteVon(a.status), i = alle.findIndex((x) => x.pfad === a.pfad);
    if (status === a.status && (alle[i - 1]?.pfad ?? null) === (davorPfad ?? null) && (alle[i + 1]?.pfad ?? null) === (danachPfad ?? null)) return false;
    aendere(a, { status }, { lokal: { status, rang: rangLokal(davor, danach) }, platz: { davor: davorPfad || null, danach: danachPfad || null }, zielText: TA.spalten[status] });
    return true;
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
      { name: TA.karte.faelligWaehlen, id: "faellig-datum", symbol: "kalender", tun: () => oeffneDatumsauswahl(anker, { wert: a.faellig, rechts: true, beiWahl: setzeFaellig }) },
      ...(a.faellig ? [{ name: TA.karte.faelligKein, id: "faellig-kein", symbol: "schliessen", tun: () => setzeFaellig(null) }] : []),
      { trenner: true },
      { name: TA.karte.oeffnen, id: "oeffnen", symbol: "notiz", tun: () => ctx.oeffneDatei(a.pfad) },
      ...(a.status === "erledigt" ? [{ name: TA.karte.archivieren, id: "archivieren", symbol: "archiv", tun: () => archiviere(a) }] : []),
    ], { rechts: true });
  }

  // ---------- Ziehen mit dem Zeiger ----------
  // Zeiger-Ereignisse statt HTML5-Drag&Drop: die Karte hängt angehoben (Schatten, leicht größer) am Zeiger, ihre Stelle bleibt als Platzhalter stehen, die Nachbarn rücken weich nach
  // (FLIP), die Zielspalte hebt sich, beim Loslassen rastet die Karte ein. Esc bricht ab. Am Rand von Spalte und Brett wird mitgescrollt. Ein Klick nach dem Ziehen wird verschluckt.
  const SCHWELLE = 4;
  let zug = null;
  const istKarte = (e) => !!e && e.classList?.contains("au-karte") && !e.classList.contains("platzhalter");
  function geistVon(el, r) {
    const g = el.cloneNode(true);
    for (const e of [g, ...g.querySelectorAll("*")]) for (const at of [...e.attributes]) if (/^(data-|id$|role$|aria-|tabindex$)/.test(at.name)) e.removeAttribute(at.name);
    g.classList.remove("au-karte", "platzhalter", "neu", "vorlaeufig", "landet");
    g.classList.add("au-schwebt");
    g.setAttribute("aria-hidden", "true"); g.inert = true;
    g.style.width = r.width + "px"; g.style.height = r.height + "px";
    return g;
  }
  brett.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0 || !ev.isPrimary || zug) return;
    const el = ev.target.closest?.("[data-karte-aufgabe]");
    if (!el || el.dataset.ziehbar !== "true" || ev.target.closest(".au-mehr")) return;
    const a = finde(el.dataset.pfad);
    if (!a) return;
    zug = { a, el, x0: ev.clientX, y0: ev.clientY, x: ev.clientX, y: ev.clientY, aktiv: false, ziel: null, raf: 0 };
    document.addEventListener("pointermove", zugBewege);
    document.addEventListener("pointerup", zugLos);
    document.addEventListener("pointercancel", zugAbbruch);
    document.addEventListener("keydown", zugTaste, true);
  });
  function zugAbmelden() {
    document.removeEventListener("pointermove", zugBewege);
    document.removeEventListener("pointerup", zugLos);
    document.removeEventListener("pointercancel", zugAbbruch);
    document.removeEventListener("keydown", zugTaste, true);
    if (zug) cancelAnimationFrame(zug.raf);
  }
  function zugBewege(ev) {
    if (!zug) return;
    zug.x = ev.clientX; zug.y = ev.clientY;
    if (!zug.aktiv) {
      if (Math.hypot(zug.x - zug.x0, zug.y - zug.y0) < SCHWELLE) return;
      zugStart();
    }
    zugAktualisiere();
  }
  function zugStart() {
    const { el } = zug;
    const r = el.getBoundingClientRect();
    zug.aktiv = true;
    zug.versatz = { x: zug.x0 - r.left, y: zug.y0 - r.top };
    zug.geist = geistVon(el, r);
    zug.geist.style.translate = `${r.left}px ${r.top}px`;
    (document.getElementById("menue-host") || document.body).append(zug.geist);
    zug.geist.getBoundingClientRect();
    zug.geist.classList.add("angehoben"); // Anheben: Schatten und Größe gleiten ein
    el.classList.add("platzhalter");
    el.blur();
    st.drag = { pfad: zug.a.pfad, ziel: null };
    document.body.classList.add("au-zieht-aktiv");
    zug.raf = requestAnimationFrame(zugTick);
  }
  // Layout-Mitte einer Karte, unabhängig von laufenden FLIP-Verschiebungen (offsetTop kennt keine Transformationen)
  const mitteY = (liste, k) => liste.getBoundingClientRect().top + k.offsetTop - liste.scrollTop + k.offsetHeight / 2;
  function zugAktualisiere() {
    const { geist, versatz, x, y, el } = zug;
    geist.style.translate = `${x - versatz.x}px ${y - versatz.y}px`;
    const br = brett.getBoundingClientRect();
    let ziel = null;
    if (y >= br.top - 40 && y <= br.bottom + 40 && x >= br.left - 40 && x <= br.right + 40) {
      let best = Infinity;
      for (const sp of brett.querySelectorAll(".au-spalte")) { const r = sp.getBoundingClientRect(); const d = x < r.left ? r.left - x : x > r.right ? x - r.right : 0; if (d < best) { best = d; ziel = sp; } }
    }
    brett.querySelectorAll(".au-spalte.au-ziel").forEach((e) => { if (e !== ziel) e.classList.remove("au-ziel"); });
    if (!ziel) { zug.ziel = null; return; }
    ziel.classList.add("au-ziel");
    const liste = ziel.querySelector(".au-karten");
    const kinder = [...liste.children];
    const karten = kinder.filter(istKarte);
    const vor = karten.find((k) => y < mitteY(liste, k)) || null;
    const schonDort = el.parentNode === liste && (vor ? el.nextElementSibling === vor : !kinder.slice(kinder.indexOf(el) + 1).some(istKarte));
    if (!schonDort) {
      // FLIP: Positionen davor merken, umhängen, die Nachbarn gleiten von alt nach neu
      const alle = [...brett.querySelectorAll(".au-karte")].filter((k) => k !== el);
      const davor = new Map(alle.map((k) => [k, k.getBoundingClientRect()]));
      if (vor) liste.insertBefore(el, vor); else liste.append(el);
      if (!wenigBewegung()) for (const k of alle) {
        const a = davor.get(k), b = k.getBoundingClientRect();
        const dx = a.left - b.left, dy = a.top - b.top;
        if (dx || dy) k.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 170, easing: "cubic-bezier(.16, 1, .3, 1)" });
      }
    }
    const nachbar = (e, richtung) => { for (let n = e[richtung]; n; n = n[richtung]) if (istKarte(n)) return n; return null; };
    zug.ziel = { status: ziel.dataset.spalte, davor: nachbar(el, "previousElementSibling")?.dataset.pfad ?? null, danach: nachbar(el, "nextElementSibling")?.dataset.pfad ?? null };
    st.drag.ziel = zug.ziel;
  }
  // Mitscrollen am Rand: Spalte senkrecht, Brett waagerecht
  function zugTick() {
    if (!zug?.aktiv) return;
    const tempo = (d) => Math.min(18, 3 + d / 4);
    let bewegt = false;
    const sp = brett.querySelector(".au-spalte.au-ziel .au-karten");
    if (sp) {
      const r = sp.getBoundingClientRect(), rand = 56;
      const dy = zug.y < r.top + rand ? -tempo(r.top + rand - zug.y) : zug.y > r.bottom - rand ? tempo(zug.y - (r.bottom - rand)) : 0;
      if (dy) { const vorher = sp.scrollTop; sp.scrollTop += dy; bewegt ||= sp.scrollTop !== vorher; }
    }
    const br = brett.getBoundingClientRect();
    const dx = zug.x < br.left + 64 ? -tempo(br.left + 64 - zug.x) : zug.x > br.right - 64 ? tempo(zug.x - (br.right - 64)) : 0;
    if (dx) { const vorher = brett.scrollLeft; brett.scrollLeft += dx; bewegt ||= brett.scrollLeft !== vorher; }
    if (bewegt) zugAktualisiere();
    zug.raf = requestAnimationFrame(zugTick);
  }
  function zugLos(ev) {
    if (!zug) return;
    if (!zug.aktiv) { zugAbmelden(); zug = null; return; }
    zug.x = ev.clientX; zug.y = ev.clientY;
    zugAktualisiere();
    zugBeenden(zug.ziel);
  }
  function zugAbbruch() { if (zug?.aktiv) zugBeenden(null); else { zugAbmelden(); zug = null; } }
  function zugTaste(ev) { if (ev.key === "Escape" && zug) { ev.preventDefault(); ev.stopPropagation(); zugAbbruch(); } }
  // ziel = null: abgebrochen, die Karte fliegt zurück
  function zugBeenden(ziel) {
    const z = zug;
    zugAbmelden(); zug = null;
    const schlucken = (e) => { e.stopPropagation(); e.preventDefault(); };
    document.addEventListener("click", schlucken, true);
    setTimeout(() => document.removeEventListener("click", schlucken, true), 0);
    document.body.classList.remove("au-zieht-aktiv");
    brett.querySelectorAll(".au-ziel").forEach((e) => e.classList.remove("au-ziel"));
    st.drag = null;
    st.landet = z.a.pfad;
    const bewegt = ziel ? verschiebe(z.a, ziel.status, ziel.davor, ziel.danach) : false;
    if (st.nachZug) { st.nachZug = false; if (unterwegs > 0) nachladen = true; else lade({ leise: true }); } // Live-Ereignis während des Ziehens: jetzt nachholen (nach der eigenen Änderung)
    if (!bewegt) zeichne(); // Platzhalter zurück, Änderungen von außen nachholen
    const neu = brett.querySelector(`[data-karte-aufgabe][data-pfad="${CSS.escape(z.a.pfad)}"]`);
    const fertig = () => { z.geist.remove(); if (st.landet === z.a.pfad) st.landet = null; brett.querySelector(`[data-pfad="${CSS.escape(z.a.pfad)}"]`)?.classList.remove("landet"); };
    if (!neu || wenigBewegung()) { fertig(); return; }
    // Einrasten: die Karte gleitet in die Lücke, Anheben klingt ab
    const r = neu.getBoundingClientRect();
    z.geist.classList.remove("angehoben");
    z.geist.classList.add("landet");
    z.geist.style.translate = `${r.left}px ${r.top}px`;
    let aus = false;
    const einmal = () => { if (!aus) { aus = true; fertig(); } };
    z.geist.addEventListener("transitionend", (e) => { if (e.propertyName === "translate") einmal(); });
    setTimeout(einmal, 260);
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
    zerstoere: () => { st.weg = true; if (zug) { zugAbmelden(); zug.geist?.remove(); zug = null; document.body.classList.remove("au-zieht-aktiv"); st.drag = null; } host.replaceChildren(); },
    // Stand von außen (Index hat sich geändert): leise nachladen, aber nicht mitten im Ziehen
    aktualisiere: () => { if (!st.drag) return lade({ leise: true }); st.nachZug = true; }, // mitten im Ziehen nicht anfassen (die Karte würde springen): nach dem Loslassen nachholen
    liste: () => st.liste,
  };
}
