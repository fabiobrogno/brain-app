// Posteingang sichten (FBL-68/FBL-71): an jeder Karte „In Seite übernehmen“, „Später“ und „Verwerfen“. Jede Aktion ist in der Werkstatt ein
// einzelner Git-Commit; nichts wird gelöscht (Verwerfen/Übernehmen verschieben die Notiz nach 90_archiv/, Später setzt `spaeter_bis` im Kopf).
// Dieses Modul kennt den Zustand der App nur über `ctx` (aus app.js), damit es ohne Umwege testbar bleibt.
import { T } from "./texte.js";
import { api } from "./api.js";
import { h, dialog, dialogOffen, toast, dateiName, ohneEndung, sucheGrad } from "./hilfen.js";
import { symbol } from "./symbole.js";
import { oeffneMenue } from "./menue.js";
import { textfeld, auswahl, segment, knopf as baueKnopf } from "./bausteine.js";
import { datumKurz } from "./format.js";

const P = T.posteingang;
export const heuteText = () => new Date().toLocaleDateString("sv-SE");
// Datum aus dem Kopf der Notiz (`spaeter_bis: JJJJ-MM-TT`) oder null
export const spaeterBis = (n) => { const w = n?.felder?.spaeter_bis; return typeof w === "string" && /^\d{4}-\d{2}-\d{2}$/.test(w.trim()) ? w.trim() : null; };
export const istZurueckgestellt = (n) => n.bereich === "inbox" && !n.generiert && !!spaeterBis(n) && spaeterBis(n) > heuteText();

const laeuft = new Set(); // Pfade mit laufender Aktion: ein zweiter Klick wartet nicht an, er wird ignoriert

// Gemeinsamer Ablauf: ungespeicherten Text der offenen Notiz sichern, Aktion, Oberfläche aktualisieren, Meldung. Fehler sind nie still.
async function fuehreAus(ctx, n, { tun, fertig, aktion }) {
  if (laeuft.has(n.pfad)) return;
  laeuft.add(n.pfad);
  try {
    if (ctx.offenerPfad() === n.pfad && !(await ctx.sichereVorWechsel())) return;
    // Solange die Werkstatt arbeitet, ist die offene Notiz schreibgeschützt: Getipptes ginge sonst beim Schließen/Neuladen verloren
    const frei = ctx.sperre(n.pfad);
    let r;
    try { r = await tun(); } finally { frei(); }
    // verschoben (r.ziel) → die Notiz ist weg; sonst hat die Werkstatt die Datei selbst geändert (Später: Kopf) → im Editor neu laden
    await ctx.nachAktion({ weg: r.ziel ? n.pfad : null, neuLaden: r.ziel ? [] : [n.pfad] });
    toast(fertig(r), aktion ? { aktion: aktion(r) } : undefined);
    return r;
  } catch (e) {
    toast(e.message, { fehler: true });
    await ctx.nachAktion({}); // Stand neu holen (die Notiz kann inzwischen weg sein, bei unklarem Ausgang sowieso)
  } finally { laeuft.delete(n.pfad); }
}

export function verwerfe(n, ctx) {
  return fuehreAus(ctx, n, { tun: () => api.verwerfen(n.pfad), fertig: () => P.fertigVerworfen(n.titel || P.ohneTitel) });
}

export function zurueckstellen(n, tage, ctx) {
  return fuehreAus(ctx, n, {
    tun: () => api.zurueckstellen(n.pfad, tage),
    fertig: (r) => (r.bis ? P.fertigSpaeter(n.titel || P.ohneTitel, datumKurz(r.bis)) : P.fertigWieder(n.titel || P.ohneTitel)),
  });
}

function oeffneSpaeterMenue(anker, n, ctx) {
  const punkt = (tage, name) => ({ name, symbol: "uhr", id: `spaeter-${tage}`, tun: () => zurueckstellen(n, tage, ctx) });
  const eintraege = [{ gruppe: P.spaeterMenue }, punkt(1, P.morgen), punkt(3, P.dreiTage), punkt(7, P.woche), punkt(30, P.monat)];
  if (istZurueckgestellt(n)) eintraege.push({ trenner: true }, { name: P.wiederZeigen, symbol: "haken", id: "spaeter-weg", tun: () => zurueckstellen(n, null, ctx) });
  oeffneMenue(anker, eintraege);
}

// ---------- In Seite übernehmen ----------
export function oeffneUebernehmen(n, ctx) {
  if (dialogOffen()) return;
  const seiten = ctx.wikiSeiten();
  const bereiche = ctx.wikiBereiche();
  let modus = seiten.length ? "seite" : "neu", gewaehlt = null;
  const fehlerEl = h("div", { klasse: "fehlertext", hidden: true, role: "alert" });
  const sucheFeld = textfeld({ typ: "search", platzhalter: P.seiteSuchen, label: P.seiteSuchen, daten: { "data-feld": "seitensuche" } });
  const suche = sucheFeld.input;
  const liste = h("div", { klasse: "pe-seiten", role: "listbox", "aria-label": P.seiteWaehlen });
  const neuFeld = textfeld({ wert: n.titel || "", platzhalter: P.neuTitel, label: P.neuTitel, daten: { "data-feld": "neuTitel" } });
  const neuTitel = neuFeld.input;
  const bereich = auswahl({ optionen: (bereiche.length ? bereiche : ["wissen"]).map((b) => ({ wert: b, text: b, symbol: "ordner" })), wert: "wissen", label: P.neuBereich, breit: true, daten: { "data-feld": "bereich" } });
  const ok = baueKnopf({ text: P.uebernehmenOk, variante: "primaer", aktion: "uebernehmen-ok", aufKlick: () => tun() });
  ok.disabled = true;
  const seiteBox = h("div", { klasse: "pe-modus", "data-modus-box": "seite" }, sucheFeld.el, liste);
  const neuBox = h("div", { klasse: "pe-modus", "data-modus-box": "neu" },
    h("div", { klasse: "feld" }, h("label", { text: P.neuTitel }), neuFeld.el), h("div", { klasse: "feld" }, h("label", { text: P.neuBereich }), bereich));
  const schalter = segment({ optionen: [{ wert: "seite", text: P.bestehend, daten: { "data-modus": "seite" } }, { wert: "neu", text: P.neu, daten: { "data-modus": "neu" } }], wert: modus, label: P.uebernehmen, aufAenderung: (m) => setze(m) });

  const zeichneListe = () => {
    const q = suche.value.trim();
    const treffer = (q ? seiten.filter((s) => sucheGrad(`${s.titel} ${s.pfad}`, q)) : seiten).slice(0, 40);
    liste.replaceChildren(...(treffer.length ? treffer.map((s) => h("button", { type: "button", klasse: "pe-seite", role: "option", "data-seite": s.pfad, "aria-selected": String(gewaehlt === s.pfad),
      title: s.pfad, aufClick: () => { gewaehlt = s.pfad; zeichneListe(); pruefe(); } }, h("span", { klasse: "pe-titel", text: s.titel }), h("span", { klasse: "pe-pfad", text: s.pfad.replace(/^09_wiki\//, "") })))
      : [h("div", { klasse: "hinweis-leer", text: seiten.length ? P.keineTreffer : P.keineSeiten })]));
  };
  const pruefe = () => { ok.disabled = modus === "seite" ? !gewaehlt : !neuTitel.value.trim(); };
  const setze = (m) => {
    modus = m;
    schalter.value = m;
    seiteBox.hidden = m !== "seite"; neuBox.hidden = m !== "neu";
    pruefe();
    (m === "seite" ? suche : neuTitel).focus();
  };
  const tun = async () => {
    if (ok.disabled || laeuft.has(n.pfad)) return;
    fehlerEl.hidden = true; ok.disabled = true;
    const ziel = modus === "seite" ? { seite: gewaehlt } : { neu: { titel: neuTitel.value.trim(), bereich: bereich.value } };
    laeuft.add(n.pfad);
    try {
      if (ctx.offenerPfad() === n.pfad && !(await ctx.sichereVorWechsel())) { ok.disabled = false; return; }
      if (modus === "seite" && ctx.offenerPfad() === gewaehlt && !(await ctx.sichereVorWechsel())) { ok.disabled = false; return; }
      const frei = [ctx.sperre(n.pfad), modus === "seite" ? ctx.sperre(gewaehlt) : () => {}];
      let r;
      try { r = await api.uebernehmen(n.pfad, ziel); } finally { frei.forEach((f) => f()); }
      d.schliessen();
      await ctx.nachAktion({ weg: n.pfad, neuLaden: [r.seite] });
      toast(P.fertigUebernommen(n.titel || P.ohneTitel, ohneEndung(dateiName(r.seite))), { aktion: { text: P.seiteOeffnen, tun: () => ctx.oeffne(r.seite) } });
    } catch (e) {
      fehlerEl.hidden = false; fehlerEl.textContent = e.message; ok.disabled = false;
      await ctx.nachAktion({}); // die Werkstatt hat zurückgenommen; trotzdem den Stand neu holen
    } finally { laeuft.delete(n.pfad); }
  };
  const d = dialog({ titel: P.uebernehmenTitel(n.titel || P.ohneTitel), breit: true,
    rumpf: [h("div", { klasse: "pe-reiter-leiste" }, schalter), seiteBox, neuBox, h("p", { klasse: "leise", text: P.uebernehmenHinweis }), fehlerEl],
    knoepfe: [baueKnopf({ text: T.commit.abbrechen, aktion: "abbrechen", aufKlick: () => d.schliessen() }), ok] });
  suche.addEventListener("input", zeichneListe);
  neuTitel.addEventListener("input", pruefe);
  for (const el of [suche, neuTitel]) el.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); tun(); } });
  zeichneListe(); setze(modus);
}

// Die drei Knöpfe an der Karte (sichtbar bei Hover, Fokus und Auswahl; Klick öffnet die Notiz nicht)
export function baueAktionen(n, ctx) {
  const knopf = (aktion, sym, titel, tun) => h("button", { klasse: "knopf-icon klein", type: "button", "data-aktion": aktion, title: titel, "aria-label": `${titel}: ${n.titel || P.ohneTitel}`,
    aufClick: (e) => { e.stopPropagation(); tun(e.currentTarget); } }, symbol(sym, 14));
  return h("div", { klasse: "karte-aktionen", role: "group", "aria-label": P.aktionen },
    knopf("uebernehmen", "buch", P.uebernehmen, () => oeffneUebernehmen(n, ctx)),
    knopf("spaeter", "uhr", P.spaeter, (el) => oeffneSpaeterMenue(el, n, ctx)),
    knopf("verwerfen", "papierkorb", P.verwerfen, () => verwerfe(n, ctx)));
}
