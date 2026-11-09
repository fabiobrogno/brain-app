// Die Karte „Was ist neu“ oben im Posteingang: eine Zusammenfassung seit dem letzten Besuch (oder seit einer gewählten Zeit), nur aus lokalen Daten, ohne KI.
// Die Zahlen rechnet die Werkstatt (GET /api/neuigkeiten, gemeinsam/neuigkeiten.mjs): neue und geänderte Notizen, Aufgaben (neu, erledigt, überfällig), KI-Aktivität aus dem
// Aktivitätsprotokoll (abgelegt, abgewiesen), Abgleich-Stand, Posteingang. Jede Zeile ist anklickbar. „Gelesen“ setzt den Merker (POST /api/neuigkeiten/gelesen).
// „Mit KI zusammenfassen“ (neuigkeiten-ki.js) gibt es nur, wenn ein Claude-Konto mit Stufe „lesen“ oder höher in diesem Vault existiert; das Ergebnis ist ein Vorschlag zum Lesen, nie eine Aktion.
import { h, dateiName, ohneEndung } from "./hilfen.js";
import { symbol } from "./symbole.js";
import { knopf as baueKnopf, auswahl, setzeLaedt } from "./bausteine.js";
import { api } from "./api.js";
import { TN } from "./texte-erwaehnungen.js";
import { erzeugeKiZusammenfassung } from "./neuigkeiten-ki.js";

const FRISCH_MS = 15_000;

function tagesbeginn(zurueckTage = 0) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - zurueckTage); return d.toISOString(); }
export const seitVon = (art) => (art === "heute" ? tagesbeginn(0) : art === "gestern" ? tagesbeginn(1) : art === "woche" ? new Date(Date.now() - 7 * 86400e3).toISOString() : art === "monat" ? new Date(Date.now() - 30 * 86400e3).toISOString() : undefined);
const zeitText = (iso) => new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

// ctx: { S, oeffne(pfad), waehleSicht(sicht), oeffneAktivitaet(), oeffneAbgleich(), ersteKarte() }
export function erzeugeNeuigkeiten(ctx) {
  const { S } = ctx;
  const karte = h("section", { klasse: "nk", "data-nk": "", "aria-label": TN.titel, hidden: true });
  let aufgeklappt = false, letzteSig = null, zeitraum = "besuch", daten = null, geladen = 0, nr = 0, offen = new Set(), fussDa = false;
  const kiZ = erzeugeKiZusammenfassung({ S, oeffne: (p) => ctx.oeffne(p), daten: () => daten, zeitText });

  const titelVon = (pfad, titel) => titel || S.nMap?.get(pfad)?.titel || ohneEndung(dateiName(pfad));
  const chips = (teile) => teile.filter(Boolean).map((t) => h("span", { klasse: "nk-chip" + (t.warn ? " warn" : ""), "data-nk-chip": t.id || null, text: t.text }));
  function zeile({ art, symbolName, name, teile = [], auf, ausklappbar, offenListe, liste, text }) {
    const kopf = h("button", { type: "button", klasse: "nk-zeile", "data-nk-zeile": art, "aria-expanded": ausklappbar ? String(offen.has(art)) : null, aufClick: () => {
      if (ausklappbar) { if (offen.has(art)) offen.delete(art); else offen.add(art); zeichne(daten); } else auf?.();
    } }, h("span", { klasse: "nk-sym" }, symbol(symbolName, 14)), h("span", { klasse: "nk-name", text: name }), h("span", { klasse: "nk-teile" }, text ? h("span", { klasse: "nk-text", text }) : null, chips(teile)),
    ausklappbar ? h("span", { klasse: "nk-pfeil", "aria-hidden": "true" }, symbol("chevron-unten", 12)) : null);
    const wurzel = h("div", { klasse: "nk-block", "data-nk-block": art }, kopf);
    if (ausklappbar && offen.has(art) && liste?.length) wurzel.append(h("div", { klasse: "nk-liste" }, liste.map((e) => h("button", { type: "button", klasse: "nk-eintrag", "data-nk-eintrag": e.pfad || "", title: e.pfad || undefined, aufClick: () => (e.pfad ? ctx.oeffne(e.pfad) : ctx.oeffneAktivitaet()) },
      h("span", { klasse: "nk-eintrag-text", text: e.titel }), e.klein ? h("span", { klasse: "nk-eintrag-klein", text: e.klein }) : null)), offenListe || null));
    return wurzel;
  }

  // Immer dieselbe Höhe (eine Zeile): die Karte schiebt die Liste nicht, wenn Daten eintreffen oder sich ändern. Die Einzelheiten klappen darunter auf.
  function kopfZeile({ zusammen, gelesen = null }) {
    const umschalter = h("button", { type: "button", klasse: "nk-umschalter", "data-nk-kopf": "", "aria-expanded": String(aufgeklappt), title: aufgeklappt ? TN.einklappen : TN.aufklappen,
      aufClick: () => { aufgeklappt = !aufgeklappt; if (daten) zeichne(daten); } },
      h("span", { klasse: "nk-titel", text: TN.titel }), h("span", { klasse: "nk-zusammen", "data-nk-zusammen": "", text: zusammen }), h("span", { klasse: "nk-pfeil", "aria-hidden": "true" }, symbol("chevron-unten", 12)));
    return h("div", { klasse: "nk-kopf" }, umschalter, gelesen);
  }
  function zeichne(r) {
    daten = r;
    if (!r) { karte.hidden = true; return; }
    karte.hidden = false;
    const n = r.notizen, a = r.aufgaben, k = r.ki, sync = r.sync, inbox = r.inbox;
    const zeilen = [];
    if (n && (n.neu || n.geaendert)) zeilen.push(zeile({ art: "notizen", symbolName: "notiz", name: TN.notizen.name, ausklappbar: true,
      teile: [n.neu ? { id: "neu", text: TN.notizen.neu(n.neu) } : null, n.geaendert ? { id: "geaendert", text: TN.notizen.geaendert(n.geaendert) } : null],
      liste: [...n.neuListe.map((e) => ({ pfad: e.pfad, titel: titelVon(e.pfad, e.titel), klein: "neu" })), ...n.geaendertListe.map((e) => ({ pfad: e.pfad, titel: titelVon(e.pfad, e.titel), klein: "geändert" }))],
      offenListe: h("button", { type: "button", klasse: "wert-mehr nk-mehr", "data-nk-alle": "notizen", text: TN.alleZeigen, aufClick: () => ctx.waehleSicht({ art: "bereich", id: "alle" }) }) }));
    if (a && (a.neu || a.erledigt || a.ueberfaellig)) zeilen.push(zeile({ art: "aufgaben", symbolName: "aufgaben", name: TN.aufgaben.name, auf: () => ctx.waehleSicht({ art: "bereich", id: "aufgaben" }),
      teile: [a.neu ? { id: "neu", text: TN.aufgaben.neu(a.neu) } : null, a.erledigt ? { id: "erledigt", text: TN.aufgaben.erledigt(a.erledigt) } : null, a.ueberfaellig ? { id: "ueberfaellig", text: TN.aufgaben.ueberfaellig(a.ueberfaellig), warn: true } : null] }));
    if (k && (k.abgelegt || k.abgewiesen)) zeilen.push(zeile({ art: "ki", symbolName: "funke", name: TN.ki.name, ausklappbar: true,
      teile: [k.abgelegt ? { id: "abgelegt", text: TN.ki.abgelegt(k.abgelegt) } : null, k.abgewiesen ? { id: "abgewiesen", text: TN.ki.abgewiesen(k.abgewiesen), warn: true } : null],
      liste: [...k.abgelegtListe, ...k.abgewiesenListe].map((e) => ({ pfad: e.pfad || null, titel: e.pfad ? titelVon(e.pfad) : (e.text || "Aktivität"), klein: e.art === "abweisung" ? "abgewiesen" : "abgelegt" })),
      offenListe: h("button", { type: "button", klasse: "wert-mehr nk-mehr", "data-nk-alle": "ki", text: TN.ki.quelle, aufClick: () => ctx.oeffneAktivitaet() }) }));
    zeilen.push(zeile({ art: "abgleich", symbolName: "sync", name: TN.abgleich.name, text: sync.text, auf: () => ctx.oeffneAbgleich() }));
    if (inbox) zeilen.push(zeile({ art: "inbox", symbolName: "inbox", name: TN.inbox.name, auf: () => ctx.ersteKarte?.(),
      teile: [{ id: "offen", text: inbox.anzahl ? TN.inbox.offen(inbox.anzahl) : TN.inbox.leer }, inbox.zurueckgestellt ? { id: "spaeter", text: TN.inbox.zurueckgestellt(inbox.zurueckgestellt) } : null] }));

    const hatMarke = !!r.marke;
    const optionen = [{ wert: "besuch", text: hatMarke ? "Seit dem letzten Besuch" : "Seit 7 Tagen" }, { wert: "heute", text: "Seit heute früh" }, { wert: "gestern", text: "Seit gestern früh" }, ...(hatMarke ? [{ wert: "woche", text: "Letzte 7 Tage" }] : []), { wert: "monat", text: "Letzte 30 Tage" }];
    const wahl = auswahl({ optionen, wert: zeitraum, groesse: "s", label: TN.zeitraumTitel, daten: { "data-nk-zeitraum": "" }, aufAenderung: (w) => { zeitraum = w; kiZ.zuruecksetzen(); lade({ erzwingen: true }); } });
    const gelesen = baueKnopf({ text: TN.gelesen, groesse: "s", titel: TN.gelesenTitel, aktion: "nk-gelesen", symbol: "haken", aufKlick: async (ev) => {
      const b = ev.currentTarget; setzeLaedt(b, true);
      try { await api.neuigkeitenGelesen(); zeitraum = "besuch"; await lade({ erzwingen: true }); } catch { /* der Merker bleibt, wie er war */ } finally { setzeLaedt(b, false); }
    } });
    const teileKurz = [n && n.neu ? TN.notizen.neu(n.neu) : null, a && a.ueberfaellig ? TN.aufgaben.ueberfaellig(a.ueberfaellig) : null, k && k.abgelegt ? TN.ki.abgelegt(k.abgelegt) : null, inbox && inbox.anzahl ? `${TN.inbox.name} ${TN.inbox.offen(inbox.anzahl)}` : null].filter(Boolean);
    const kopf = kopfZeile({ zusammen: r.leer && !teileKurz.length ? TN.nichtsNeuKurz : teileKurz.slice(0, 3).join(" · "), gelesen });
    const unter = h("div", { klasse: "nk-unter" }, wahl, h("span", { klasse: "nk-seit", "data-nk-seit": r.seit, text: TN.seit(zeitText(r.seit)) }));
    const rumpf = r.leer
      ? [h("p", { klasse: "nk-leer leise", "data-nk-leer": "", text: TN.nichtsNeu(zeitText(r.seit)) }), ...zeilen]
      : zeilen;
    fussDa = kiZ.verfuegbar();
    const fuss = fussDa ? kiZ.knoten : null;
    karte.classList.toggle("offen", aufgeklappt);
    karte.replaceChildren(kopf, ...(aufgeklappt ? [h("div", { klasse: "nk-inhalt", "data-nk-inhalt": "" }, unter, h("div", { klasse: "nk-zeilen" }, rumpf), ...(fuss ? [fuss] : []))] : []));
    kiZ.aktualisiere();
  }

  let vaultMerk = null;
  async function lade({ erzwingen = false } = {}) {
    if (vaultMerk !== (S.info?.vault || null)) { vergiss(); vaultMerk = S.info?.vault || null; } // anderer Vault: alles von vorn
    if (!erzwingen && daten && Date.now() - geladen < FRISCH_MS) { if (!karte.childElementCount) zeichne(daten); return; } // frisch genug: nichts neu zeichnen (ein offenes Auswahlfeld bleibt)
    const mein = ++nr;
    if (!daten && !karte.childElementCount) { karte.hidden = false; karte.replaceChildren(kopfZeile({ zusammen: TN.laedt })); } // sofort in der endgültigen Höhe da
    try {
      const [r] = await Promise.all([api.neuigkeiten(seitVon(zeitraum)), kiZ.laden()]);
      if (mein !== nr) return;
      geladen = Date.now();
      const sig = JSON.stringify({ ...r, bis: null });
      if (sig === letzteSig && karte.childElementCount) { if (kiZ.verfuegbar() !== fussDa) zeichne(daten); else kiZ.aktualisiere(); return; } // unverändert: kein Neuzeichnen (nur der KI-Fuß, falls sich dort etwas ändert)
      letzteSig = sig;
      zeichne(r);
    } catch { if (mein === nr && !daten) { karte.hidden = true; karte.replaceChildren(); } }
  }
  // Vault gewechselt oder Karte weg: alles vergessen
  function vergiss() { nr++; letzteSig = null; daten = null; geladen = 0; kiZ.vergessen(); fussDa = false; offen = new Set(); zeitraum = "besuch"; karte.replaceChildren(); karte.hidden = true; }
  return { knoten: karte, lade, vergiss };
}
