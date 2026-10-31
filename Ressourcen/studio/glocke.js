// Glocke in der Kopfzeile und Mitteilungsliste (Paket P8b). Die Daten liefert mitteilungen.js (P8a: liste, ungelesen, abonniere, markiereGelesen, rueckgaengig);
// hier steht nur, was der Nutzer sieht: der Knopf mit der Zahl der ungelesenen Meldungen (höchstens „9+“, live über abonniere) und das Panel darunter:
// gruppiert nach Heute / Gestern / Früher, je Eintrag Logo des Programms, kurzer Satz, Zeit und Aktionen (Ansehen, Rückgängig mit derselben Rückfrage wie in den
// Einstellungen, Wiederherstellen), Filter Alle / Abweisungen / KI-Ablagen / Sicherung, „Alle als gelesen“, leerer Zustand, Link zum Aktivitätsprotokoll.
// Tastatur: ⌘⇧B (Register: „mitteilungen“, angemeldet in app.js), im Panel ↑ ↓ (Eintrag), Enter (Hauptaktion), Esc (zu, Fokus zurück auf die Glocke).
// Muster: Orca NotificationCardStack (Aktionen im Hinweis) und der freigegebene Prototyp (app.html, #mitteil=1). Kein innerHTML mit fremden Daten: alles über h().
//   const g = erzeugeGlocke({ mitteilungen, api, beiAnsehen(ziel), beiEinstellungen({ bereich, ziel }) });  g.umschalten() · g.oeffne() · g.schliesse() · g.istOffen()
// Dieses Modul rührt beim Laden nichts im DOM an (der Knopf wird erst in erzeugeGlocke gebaut).
import { h, dialog, toast } from "./hilfen.js";
import { symbol, GROESSE } from "./symbole.js";
import { knopf as baueKnopf } from "./bausteine.js";
import { oeffnePopover } from "./popover.js";
import { kiLogo, kiLogoId } from "./ki-logos.js";
import { relativ, datumZeit } from "./format.js";
import { zeilenText, fuehreWiederherstellenAus, zielVon } from "./mitteilungen.js";
import { TM } from "./texte-mitteilungen.js";
import { TG } from "./texte-glocke.js";
import * as kz from "./tastenkuerzel.js";

export const FILTER = ["alle", "abweisungen", "ablagen", "sicherung"];
const ARTEN_FILTER = {
  alle: null,
  abweisungen: new Set(["abweisung"]),
  ablagen: new Set(["ablage-aufgabe", "ablage-notiz", "aenderung"]),
  sicherung: new Set(["sicherung-konflikt", "sicherung-fehler"]),
};

// ---------------------------------------------------------------- reine Funktionen (auch für Tests)
export const zahlText = (n) => TG.zahl(Math.max(0, Math.floor(Number(n) || 0)));
export const passtZuFilter = (filter, e) => !ARTEN_FILTER[filter] || ARTEN_FILTER[filter].has(e?.art);
// Heute / Gestern / Früher nach dem Kalendertag auf diesem Mac
export function tagesGruppe(zeit, jetzt = new Date()) {
  const t = new Date(zeit);
  if (Number.isNaN(t.getTime())) return "frueher";
  const tag = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((tag(jetzt) - tag(t)) / 86400000);
  return diff <= 0 ? "heute" : diff === 1 ? "gestern" : "frueher";
}
const HM = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
export function zeitText(zeit, gruppe) {
  const t = new Date(zeit);
  if (Number.isNaN(t.getTime())) return "";
  if (gruppe === "heute") return relativ(t);
  if (gruppe === "gestern") return TG.gestern(HM.format(t));
  return datumZeit(t);
}
// Die Ereignisse der Liste, neueste zuerst; „rueckgaengig“ ist nur die Bestätigung eines Klicks und gehört nicht in die Liste
export function sichtbar(ereignisse, filter = "alle") {
  return (Array.isArray(ereignisse) ? ereignisse : []).filter((e) => e && typeof e.art === "string" && e.art !== "rueckgaengig" && passtZuFilter(filter, e))
    .sort((a, b) => (Date.parse(b.zeit) || 0) - (Date.parse(a.zeit) || 0));
}
export function gruppiereNachTag(ereignisse, jetzt = new Date()) {
  const gruppen = [];
  for (const e of ereignisse) {
    const g = tagesGruppe(e.zeit, jetzt);
    let z = gruppen.find((x) => x.id === g);
    if (!z) { z = { id: g, eintraege: [] }; gruppen.push(z); }
    z.eintraege.push(e);
  }
  return gruppen;
}
export const istLeseverbotHinweis = (e) => e?.art === "abweisung" && e?.grund === "gelesen-ohne-leseverbot";
// Wer hat es getan: ohne Namen und mit kleinem Anfangsbuchstaben („hat eine Aufgabe angelegt.“) beginnt der Satz mit „Eine KI“
export function satzVon(e) {
  const t = zeilenText(e);
  const klein = /^\p{Ll}/u.test(t.satz);
  return { wer: t.wer || (klein ? TM.eineKi : null), satz: t.satz || "", rest: t.rest || "" };
}
const artSymbol = (art) => (/^sicherung/.test(art) ? "wolke" : /^pflege/.test(art) ? "sanduhr" : art === "anmeldung-abgelaufen" ? "schloss" : art === "abweisung" ? "schild" : "funke");

// ---------------------------------------------------------------- Knopf und Panel
export function erzeugeGlocke({ mitteilungen, api, beiAnsehen, beiEinstellungen, knopfId = "knopf-glocke" } = {}) {
  const knopf = document.getElementById(knopfId);
  const zahl = h("span", { klasse: "glocke-zahl", "aria-hidden": "true", hidden: true });
  if (knopf) knopf.replaceChildren(symbol("glocke", GROESSE.norm), zahl);
  let filter = "alle";
  let offen = null; // { box, zu, liste, ... }
  let zuletzt = 0;
  const wartet = new Set(); // Ids, die gerade wiederhergestellt werden

  const ungelesen = () => Math.max(0, mitteilungen.ungelesen() || 0);
  function beschrifte() {
    if (!knopf) return;
    const n = ungelesen();
    const taste = kz.anzeige("mitteilungen");
    knopf.setAttribute("aria-label", TG.knopf(n));
    knopf.title = TG.knopfTitel(taste);
    const k = kz.kuerzelVon("mitteilungen");
    if (k) knopf.setAttribute("aria-keyshortcuts", k.replace("Cmd", "Meta").replace("Ctrl", "Control")); else knopf.removeAttribute("aria-keyshortcuts");
    zahl.hidden = n === 0;
    zahl.textContent = n ? zahlText(n) : "";
    if (n > zuletzt) { zahl.classList.remove("hupf"); void zahl.offsetWidth; zahl.classList.add("hupf"); }
    zuletzt = n;
  }
  mitteilungen.abonniere(() => { beschrifte(); if (offen) zeichne(); });
  kz.beiAenderung(beschrifte);
  beschrifte();

  // ---- Aktionen
  const merkeGelesen = (ids) => { mitteilungen.markiereGelesen({ ids }).catch(() => { /* der Zähler stimmt beim nächsten Abruf wieder */ }); };
  const gehe = (fn, e) => { if (e && e.gelesen === false && e.id) merkeGelesen([e.id]); schliesse(false); fn(); };

  function bestaetigeRueckgaengig(e) {
    const pfad = Array.isArray(e.pfade) && e.pfade[0] ? e.pfade[0] : "";
    const B = TM.bestaetigen;
    schliesse(false);
    const ja = baueKnopf({ text: B.ja, variante: "primaer", aktion: "glocke-zurueck-ja", aufKlick: () => { d.schliessen(); mitteilungen.rueckgaengig([e.id]); } });
    const d = dialog({ titel: B.titel, satz: B.satz, rumpf: [h("p", { klasse: "dialog-pfad" }, h("code", { text: pfad })), h("p", { klasse: "dialog-satz", text: B.kopie })],
      knoepfe: [baueKnopf({ text: B.nein, aktion: "glocke-zurueck-nein", aufKlick: () => d.schliessen() }), ja] });
    d.box.dataset.dialog = "aktivitaet-zurueck";
  }
  async function stelleWiederHer(e) {
    if (wartet.has(e.id)) return;
    wartet.add(e.id); zeichne();
    const r = await fuehreWiederherstellenAus(api, e.id);
    wartet.delete(e.id);
    toast(r.ok ? TM.wiederhergestellt : r.meldung, { fehler: !r.ok, ms: r.ok ? 3200 : 7000 });
    await mitteilungen.ladeNeu();
    zeichne();
  }
  async function alleGelesen() {
    try { await mitteilungen.markiereGelesen({ alle: true }); }
    catch { toast(TG.fehlerGelesen, { fehler: true, ms: 5000 }); }
  }

  // Aktionen eines Eintrags: [{ id, text, label, primaer, tun }]. Die erste ist die Hauptaktion (Enter auf dem Eintrag).
  function aktionenVon(e) {
    const t = satzVon(e), wer = `${t.wer ? t.wer + " " : ""}${t.satz}`;
    const liste = [];
    if (istLeseverbotHinweis(e)) { /* der Knopf steht im Hinweis */ }
    else if (e.art === "abweisung") liste.push({ id: "rechte", text: TG.rechteAnsehen, label: TG.mitSatz(TG.rechteAnsehen, wer), tun: () => gehe(() => beiEinstellungen?.({ bereich: "ki", ziel: "ki-zugriff" }), e) });
    else if (e.art === "anmeldung-abgelaufen") liste.push({ id: "anmelden", text: TG.neuAnmelden, label: TG.mitSatz(TG.neuAnmelden, wer), tun: () => gehe(() => beiEinstellungen?.({ bereich: "ki", ziel: "ki-konten" }), e) });
    else liste.push({ id: "ansehen", text: TG.ansehen, label: TG.mitSatz(TG.ansehen, wer), tun: () => gehe(() => beiAnsehen?.(zielVon(e.art), [e]), e) });
    if (e.rueckgaengigMoeglich === true && !e.zurueckgenommen) liste.push({ id: "zurueck", text: TM.rueckgaengig, label: TM.rueckgaengigLang(wer), tun: () => { if (e.gelesen === false) merkeGelesen([e.id]); bestaetigeRueckgaengig(e); } });
    if (e.wiederherstellenMoeglich === true) liste.push({ id: "wieder", text: TM.wiederherstellen, label: TM.wiederherstellenLang(wer), tun: () => stelleWiederHer(e), disabled: wartet.has(e.id) });
    return liste;
  }

  // ---- Zeichnen
  function logoVon(e) {
    const inner = e.programm && kiLogoId(e.programm) ? kiLogo(e.programm, 16, { dekorativ: true }) : symbol(artSymbol(e.art), 14);
    return h("span", { klasse: "gl-logo", "aria-hidden": "true" }, inner);
  }
  function eintrag(e, gruppe) {
    const t = satzVon(e);
    const abw = e.art === "abweisung";
    const ohneVerbot = istLeseverbotHinweis(e);
    const aktionen = aktionenVon(e);
    const meta = [];
    if (abw) meta.push(h("span", { klasse: "gl-marke " + (ohneVerbot ? "warn" : "abw") }, symbol(ohneVerbot ? "warnung" : "schild", 11), TG.marke[ohneVerbot ? "gelesen" : "abgewiesen"]));
    meta.push(h("time", { datetime: e.zeit, title: datumZeit(e.zeit), "data-zeit": gruppe, text: zeitText(e.zeit, gruppe) }));
    if (e.vaultName) meta.push(h("span", { text: TM.vault(e.vaultName) }));
    if (e.zurueckgenommen) meta.push(h("span", { text: TG.zurueckgenommen }));
    const ungelesenE = e.gelesen === false;
    const zeile = h("div", { klasse: "gl-eintrag" + (abw ? (ohneVerbot ? " leseverbot" : " abweisung") : "") + (ungelesenE ? " neu" : ""), role: "listitem", tabindex: "-1", "data-id": e.id || null, "data-art": e.art, "data-grund": e.grund || null },
      logoVon(e),
      h("div", { klasse: "gl-text" },
        h("div", { klasse: "gl-satz" }, ungelesenE ? h("span", { klasse: "gl-punkt", role: "img", "aria-label": TG.ungelesen }) : null, t.wer ? h("b", { text: t.wer }) : null, t.wer ? " " : null, t.satz || TG.ohneText),
        t.rest && !ohneVerbot ? h("div", { klasse: "gl-rest", text: t.rest }) : null,
        h("div", { klasse: "gl-meta" }, meta.flatMap((m, i) => (i ? [h("span", { klasse: "gl-sep", "aria-hidden": "true", text: "·" }), m] : [m]))),
        ohneVerbot ? h("div", { klasse: "gl-hinweis", "data-kx": "leseverbot-hinweis" }, symbol("warnung", 14), h("span", { text: TG.leseverbot.hinweis }),
          baueKnopf({ text: TG.leseverbot.knopf, groesse: "s", aktion: "glocke-leseverbot", aufKlick: () => gehe(() => beiEinstellungen?.({ bereich: "ki", ziel: "ki-schutz" }), e) })) : null,
        aktionen.length ? h("div", { klasse: "gl-aktionen" }, aktionen.map((a, i) => baueKnopf({ text: a.text, label: a.label, groesse: "s", variante: i === 0 ? "sekundaer" : "leise", aktion: "glocke-" + a.id, disabled: a.disabled, aufKlick: a.tun }))) : null));
    return zeile;
  }
  function leerZustand() {
    const T = filter === "alle" ? TG.leer : TG.leerFilter[filter];
    return h("div", { klasse: "gl-leer", "data-kx": "glocke-leer" }, h("span", { klasse: "gl-leer-zeichen" }, symbol("glocke", GROESSE.gross)), h("div", { klasse: "gl-leer-titel", text: T.titel }), h("p", { text: T.text }));
  }
  function zeichne() {
    if (!offen) return;
    const { box, liste, alle, chips } = offen;
    // Fokus merken: derselbe Eintrag (und Knopf) behält ihn nach dem Neuzeichnen
    const a = document.activeElement;
    const eintragA = a?.closest?.(".gl-eintrag");
    const merk = liste.contains(a) ? { id: eintragA?.dataset.id || null, aktion: a?.dataset?.aktion || null, nr: [...liste.querySelectorAll(".gl-eintrag")].indexOf(eintragA) } : null;
    const oben = liste.scrollTop;
    const n = ungelesen();
    alle.disabled = n === 0;
    for (const [f, b] of chips) b.setAttribute("aria-pressed", String(f === filter));
    const ereignisse = sichtbar(mitteilungen.ereignisse(), filter);
    const jetzt = new Date();
    if (!ereignisse.length) liste.replaceChildren(leerZustand());
    else liste.replaceChildren(...gruppiereNachTag(ereignisse, jetzt).flatMap((g) => [
      h("div", { klasse: "gl-gruppe", role: "presentation", text: TG.gruppen[g.id] }),
      ...g.eintraege.map((e) => eintrag(e, g.id)),
    ]));
    liste.scrollTop = oben;
    if (merk) {
      const alleZeilen = [...liste.querySelectorAll(".gl-eintrag")];
      const zeile = (merk.id && alleZeilen.find((x) => x.dataset.id === merk.id)) || alleZeilen[Math.min(Math.max(merk.nr, 0), alleZeilen.length - 1)] || null;
      const ziel = (merk.aktion && zeile?.querySelector(`[data-aktion="${merk.aktion}"]:not(:disabled)`)) || zeile || box;
      ziel.focus({ preventScroll: true });
    }
  }

  function bewege(richtung, aktuell) {
    const zeilen = [...offen.liste.querySelectorAll(".gl-eintrag")];
    if (!zeilen.length) return;
    const i = aktuell ? zeilen.indexOf(aktuell) : -1;
    const j = richtung === "anfang" ? 0 : richtung === "ende" ? zeilen.length - 1 : i === -1 ? (richtung > 0 ? 0 : zeilen.length - 1) : Math.min(zeilen.length - 1, Math.max(0, i + richtung));
    zeilen[j].focus({ preventScroll: false });
    zeilen[j].scrollIntoView({ block: "nearest" });
  }
  function beiTaste(ev) {
    if (!offen) return false;
    const a = document.activeElement;
    const zeile = a?.closest?.(".gl-eintrag") || null;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") { bewege(ev.key === "ArrowDown" ? 1 : -1, zeile); return true; }
    if (ev.key === "Home" && (zeile || a === offen.box)) { bewege("anfang"); return true; }
    if (ev.key === "End" && (zeile || a === offen.box)) { bewege("ende"); return true; }
    if ((ev.key === "ArrowLeft" || ev.key === "ArrowRight") && a?.closest?.(".gl-filter")) {
      const chips = [...offen.chips.values()], i = chips.indexOf(a);
      if (i === -1) return false;
      chips[(i + (ev.key === "ArrowRight" ? 1 : chips.length - 1)) % chips.length].focus();
      return true;
    }
    if (ev.key === "Tab") { // das Panel ist ein Dialog: Tab dreht am Ende um, statt hinter dem Panel zu landen
      const tab = [...offen.box.querySelectorAll("button:not(:disabled)")];
      if (!tab.length) return false;
      if (!ev.shiftKey && a === tab[tab.length - 1]) { tab[0].focus(); return true; }
      if (ev.shiftKey && (a === tab[0] || a === offen.box)) { tab[tab.length - 1].focus(); return true; }
      return false;
    }
    if (ev.key === "Enter" && a === zeile && zeile) { zeile.querySelector(".gl-aktionen button:not(:disabled), .gl-hinweis button:not(:disabled)")?.click(); return true; }
    return false;
  }

  let zeitTimer = null;
  function oeffne() {
    if (offen || !knopf) return;
    const chips = new Map(FILTER.map((f) => [f, h("button", { type: "button", klasse: "gl-chip", "aria-pressed": String(f === filter), "data-filter": f, text: TG.filter[f], aufClick: () => { filter = f; zeichne(); } })]));
    const alle = baueKnopf({ text: TG.alleGelesen, variante: "leise", groesse: "s", aktion: "glocke-alle-gelesen", aufKlick: alleGelesen });
    const einst = h("button", { type: "button", klasse: "knopf-icon klein", "data-aktion": "glocke-einstellungen", title: TG.einstellungen, "aria-label": TG.einstellungen, aufClick: () => gehe(() => beiEinstellungen?.({ bereich: "mitteilungen", ziel: null })) }, symbol("zahnrad", GROESSE.text));
    const liste = h("div", { klasse: "gl-liste", role: "list", "aria-label": TG.listeName });
    const fuss = h("button", { type: "button", klasse: "gl-link", "data-aktion": "glocke-protokoll", aufClick: () => gehe(() => beiAnsehen?.("protokoll", [])) }, h("span", { text: TG.protokoll }), symbol("chevron-rechts", 12));
    const box = h("div", { klasse: "glocke", role: "dialog", "aria-label": TG.titel, tabindex: "-1", "data-kx": "glocke" },
      h("div", { klasse: "gl-kopf" }, h("b", { text: TG.titel }), alle, einst),
      h("div", { klasse: "gl-filter", role: "group", "aria-label": TG.filterName }, [...chips.values()]),
      liste,
      h("div", { klasse: "gl-fuss" }, fuss));
    const p = oeffnePopover(knopf, box, { rechts: true, abstand: 8, tabSchliesst: false, fokusVerlustSchliesst: true, beiTaste, beiZu: () => { offen = null; clearInterval(zeitTimer); } });
    offen = { box, zu: p.zu, liste, alle, chips };
    zeichne();
    // Frische Zeiten, solange das Panel offen ist (nur die Texte, kein Neuzeichnen: der Fokus bleibt)
    zeitTimer = setInterval(() => { for (const t of liste.querySelectorAll("time[data-zeit]")) t.textContent = zeitText(t.getAttribute("datetime"), t.dataset.zeit); }, 30000);
    const erste = liste.querySelector(".gl-eintrag");
    (erste || box).focus({ preventScroll: true });
    p.platz?.();
    mitteilungen.ladeNeu(); // aktueller Stand der Werkstatt (der Zähler und die Liste ziehen über abonniere nach)
  }
  function schliesse(fokus = false) { offen?.zu(fokus); }
  const umschalten = () => { if (offen) schliesse(true); else oeffne(); };
  knopf?.addEventListener("click", umschalten);
  return { oeffne, schliesse, umschalten, istOffen: () => !!offen, zeichne, beschrifte };
}
