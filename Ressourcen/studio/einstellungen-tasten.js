// Bereich „Tastenkürzel“ der Seite „Einstellungen“ (Paket P10): Liste aller Befehle nach Gruppen, Suche und Filter (Alle / Geändert / Ohne / Konflikte), Klick auf ein Kürzel →
// Aufnahme (zeigt die gedrückten Tasten live, Esc bricht ab, ⌫ entfernt das Kürzel), Konflikt-Hinweis mit dem Namen des anderen Befehls („Abbrechen“ / „Trotzdem nehmen“), Zurücksetzen je
// Zeile und für alle. Gespeichert wird in <Support>/tastenkuerzel.json (GET/PUT /api/tastenkuerzel, mit `stand`), gültig sofort: tastenkuerzel.js hält den Zustand, die App (Swift) meldet
// die globalen Kürzel neu an und stellt die Menüs um. Reservierte Kürzel (⌘Q, ⌘Tab, ⌘Leertaste …) lehnt schon die Aufnahme ab, die App prüft zusätzlich, was macOS selbst belegt.
// Keine nativen Felder: die Aufnahme ist ein Knopf, der auf Tastendrücke hört (kein <input>). Alles über h(), kein innerHTML.
// Ablauf nach Orca (ShortcutsPane.tsx, ShortcutRecorderButton.tsx, ShortcutRowsList.tsx @9bccd67, MIT, Lovecast Inc.): Klick → „Press keys…“, Esc bricht ab, Konflikt „{binding} conflicts with {actions}“,
// „Reset to default“ je Zeile, Filter Alle / Geändert / Ohne / Konflikte, Kürzel in eigener Datei.
import { h, dialog, toast } from "./hilfen.js";
import { symbol, GROESSE } from "./symbole.js";
import { knopf as baueKnopf, segment, textfeld, einstellMarke } from "./bausteine.js";
import * as kz from "./tastenkuerzel.js";
import { TKZ as T } from "./texte-tasten.js";

const L = kz.logik, R = kz.REGISTER;
const befehl = (id) => R.befehle.find((b) => b.id === id);

// Die Abschnitte des Bereichs (eine Zeile je Befehl, aus dem Register) baut L.abschnitteAusRegister; einstellungen.js hängt sie beim Öffnen ins Register der Seite.
export const tastenAbschnitte = () => L.abschnitteAusRegister(R);

const kbds = (teile) => teile.map((t) => h("kbd", { text: t }));
const norm = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// o: { inApp, beiSpeichern(art: "speichert" | "gespeichert" | ""), beiAenderung() }
export function erzeugeTasten(o = {}) {
  const S = { zeilen: new Map(), meldungen: new Map(), aufnahme: null, filter: "alle", suche: "", tot: false, leiste: null, leer: null, alleKnopf: null, aufnahmeAb: null };

  // ---------------------------------------------------------------- Anzeige einer Zeile
  function zeichne(id) {
    const r = S.zeilen.get(id);
    if (!r) return;
    const b = befehl(id);
    const rec = S.aufnahme?.id === id;
    const teile = kz.anzeigeTeile(id);
    const live = rec ? S.aufnahme.teile : null;
    r.feld.replaceChildren(...(rec ? (live.length ? kbds(live) : [h("span", { klasse: "kz-leise", text: T.druecken })]) : teile.length ? kbds(teile) : [h("span", { klasse: "kz-leise", text: T.festlegen })]));
    r.feld.classList.toggle("aufnahme", rec);
    r.feld.dataset.zustand = rec ? "aufnahme" : teile.length ? "belegt" : "leer";
    r.feld.setAttribute("aria-label", T.feldLabel(b.name, teile.join("")));
    r.zurueck.hidden = !kz.geaendert(id);
    const doppelt = kz.konfliktIds().has(id);
    const andere = doppelt ? kz.konflikteFuer(id, kz.kuerzelVon(id)).map((x) => x.name) : [];
    r.doppelt.hidden = !doppelt;
    r.doppelt.title = doppelt ? T.doppeltTitel(andere) : "";
    r.zeile?.classList.toggle("kz-doppelt", doppelt);
    r.zeile?.classList.toggle("kz-geaendert", kz.geaendert(id));
  }
  function zeichneMeldung(id) {
    const r = S.zeilen.get(id);
    if (!r?.meldung) return;
    const m = S.meldungen.get(id);
    if (!m) { r.meldung.hidden = true; r.meldung.replaceChildren(); r.meldung.removeAttribute("data-art"); return; }
    r.meldung.hidden = false;
    r.meldung.dataset.art = m.art;
    r.meldung.setAttribute("role", "alert");
    const akt = m.art === "konflikt"
      ? [baueKnopf({ text: T.abbrechen, variante: "leise", groesse: "s", daten: { "data-aktion": "kz-abbrechen" }, aufKlick: () => zeigeMeldung(id, null) }),
        baueKnopf({ text: T.trotzdem, groesse: "s", daten: { "data-aktion": "kz-trotzdem" }, aufKlick: () => { zeigeMeldung(id, null); uebernehme(id, m.kuerzel); } })]
      : [baueKnopf({ text: T.verstanden, variante: "leise", groesse: "s", daten: { "data-aktion": "kz-verstanden" }, aufKlick: () => zeigeMeldung(id, null) })];
    r.meldung.replaceChildren(h("span", { klasse: "kz-meldung-zeichen", "aria-hidden": "true" }, symbol("warnung", GROESSE.text)), h("span", { klasse: "kz-meldung-text", "data-feld": "meldung", text: m.text }), h("span", { klasse: "kz-meldung-akt" }, akt));
  }
  function zeigeMeldung(id, m) { if (m) S.meldungen.set(id, m); else S.meldungen.delete(id); zeichneMeldung(id); }
  const loescheMeldungen = () => { const ids = [...S.meldungen.keys()]; S.meldungen.clear(); ids.forEach(zeichneMeldung); };
  function zeichneAlle() {
    for (const id of S.zeilen.keys()) zeichne(id);
    if (S.alleKnopf) S.alleKnopf.disabled = kz.anzahlGeaendert() === 0;
    filtere();
  }

  // ---------------------------------------------------------------- Suche und Filter (nur Ansicht; die Suche der ganzen Seite blendet mit [hidden] aus, das hier mit .kz-aus)
  function passt(id) {
    const b = befehl(id), k = kz.kuerzelVon(id);
    if (S.filter === "geaendert" && !kz.geaendert(id)) return false;
    if (S.filter === "ohne" && k) return false;
    if (S.filter === "konflikte" && !kz.konfliktIds().has(id)) return false;
    const q = norm(S.suche).trim();
    if (!q) return true;
    const heu = norm([b.name, b.text, ...(b.woerter || []), kz.anzeige(id), k || ""].join(" "));
    return q.split(/\s+/).every((w) => heu.includes(w));
  }
  function filtere() {
    let sichtbar = 0;
    const abschnitte = new Set();
    for (const [id, r] of S.zeilen) {
      const ok = passt(id);
      r.zeile?.classList.toggle("kz-aus", !ok);
      if (ok) sichtbar++;
      const a = r.zeile?.closest(".ez-abschnitt");
      if (a) abschnitte.add(a);
    }
    for (const a of abschnitte) a.classList.toggle("kz-aus", ![...a.querySelectorAll("[data-zeile]")].some((z) => !z.classList.contains("kz-aus")));
    if (S.leer) {
      const keine = S.zeilen.size > 0 && sichtbar === 0;
      S.leer.hidden = !keine;
      S.leer.textContent = S.filter !== "alle" && !S.suche.trim() ? T.leerFilter[S.filter] : T.leer;
    }
  }

  // ---------------------------------------------------------------- Aufnahme
  function beendeAufnahme() {
    const a = S.aufnahme;
    if (!a) return;
    S.aufnahme = null;
    window.removeEventListener("keydown", a.beiTaste, true);
    window.removeEventListener("keyup", a.beiLoslassen, true);
    document.removeEventListener("pointerdown", a.beiKlick, true);
    window.removeEventListener("blur", a.beiVerlassen);
    S.aufnahmeAb = null;
    zeichne(a.id);
  }
  function starteAufnahme(id) {
    const war = S.aufnahme?.id === id;
    beendeAufnahme();
    loescheMeldungen();
    if (war) return; // ein zweiter Klick auf dasselbe Feld bricht ab
    const b = befehl(id), r = S.zeilen.get(id);
    const opt = { mac: kz.istMac(), physisch: !!b.global }; // globale Kürzel meldet macOS nach dem Ort der Taste
    const a = { id, teile: [] };
    a.beiTaste = (ev) => {
      if (ev.isComposing) return;
      ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
      if (ev.repeat) return;
      if (ev.key === "Escape") { beendeAufnahme(); r.feld.focus({ preventScroll: true }); return; }
      const mods = ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey;
      if (ev.key === "Backspace" && !mods) { beendeAufnahme(); uebernehme(id, null); return; }
      const k = L.ausEreignis(ev, opt);
      if (!k.taste) { a.teile = L.aufnahmeTeile(ev, opt); zeichne(id); return; } // nur Umschalttasten: live anzeigen
      const text = L.formatiere(k);
      const p = L.pruefe(R, text);
      if (!p.ok) { a.teile = []; zeigeMeldung(id, { art: "fehler", text: p.text }); zeichne(id); return; } // Aufnahme bleibt offen: eine andere Kombination versuchen
      zeigeMeldung(id, null);
      const konf = kz.konflikteFuer(id, text);
      beendeAufnahme();
      r.feld.focus({ preventScroll: true });
      if (konf.length) zeigeMeldung(id, { art: "konflikt", kuerzel: text, text: L.konfliktText(L.anzeigeText(text, R), konf) });
      else uebernehme(id, text);
    };
    a.beiLoslassen = (ev) => { if (ev.isComposing) return; ev.preventDefault(); ev.stopPropagation(); a.teile = L.aufnahmeTeile(ev, opt); zeichne(id); };
    a.beiKlick = (ev) => { if (!r.feld.contains(ev.target)) beendeAufnahme(); };
    a.beiVerlassen = () => beendeAufnahme(); // das Fenster hat den Fokus verloren
    S.aufnahme = a;
    window.addEventListener("keydown", a.beiTaste, true);
    window.addEventListener("keyup", a.beiLoslassen, true);
    document.addEventListener("pointerdown", a.beiKlick, true);
    window.addEventListener("blur", a.beiVerlassen);
    r.feld.focus({ preventScroll: true });
    zeichne(id);
  }

  // ---------------------------------------------------------------- Speichern
  // wert: "Cmd+T" | null (ohne Kürzel) | STANDARD (zurück auf den Standard)
  const STANDARD = Symbol("standard");
  async function uebernehme(id, wert) {
    const b = befehl(id);
    const ziel = wert === STANDARD ? (b.standard ?? null) : wert;
    if (b.global) { // die App fragt macOS (belegt? Systemkürzel?) und meldet das Kürzel an, bevor es gespeichert wird
      const p = await kz.pruefeGlobal(id, ziel);
      if (!p.ok) { zeigeMeldung(id, { art: "fehler", text: p.text }); return; }
    }
    o.beiSpeichern?.("speichert");
    try {
      await kz.schreibe(wert === STANDARD ? { zurueck: [id] } : { werte: { [id]: ziel } });
      o.beiSpeichern?.("gespeichert");
      if (ziel === null && wert === null) toast(T.entfernt(b.name), { ms: 2500 });
    } catch (e) { fehler(id, e); }
  }
  function fehler(id, e) {
    o.beiSpeichern?.("");
    if (e?.status === 409 && e?.daten?.art === "konflikt") toast(T.konflikt, { ms: 7000 });
    else if (e?.status === 400 && id) zeigeMeldung(id, { art: "fehler", text: e.message || T.fehlerSpeichern });
    else toast(e?.message || T.fehlerSpeichern, { fehler: true, ms: 6000 });
  }
  function alleZuruecksetzen() {
    const geaendert = R.befehle.filter((b) => kz.geaendert(b.id));
    if (!geaendert.length) return;
    const d = dialog({ titel: T.alleDialog.titel, satz: T.alleDialog.text(geaendert.length), knoepfe: [
      baueKnopf({ text: T.alleDialog.abbrechen, aufKlick: () => d.schliessen() }),
      baueKnopf({ text: T.alleDialog.ja, variante: "primaer", aktion: "kz-alle-ja", aufKlick: async () => {
        d.schliessen();
        const zurueck = [];
        for (const b of geaendert) { // ein globales Standardkürzel, das macOS inzwischen anderweitig vergeben hat, bleibt, wie es ist
          if (b.global) { const p = await kz.pruefeGlobal(b.id, b.standard ?? null); if (!p.ok) { zeigeMeldung(b.id, { art: "fehler", text: p.text }); continue; } }
          zurueck.push(b.id);
        }
        if (!zurueck.length) return;
        o.beiSpeichern?.("speichert");
        try { await kz.schreibe({ zurueck: zurueck.length === geaendert.length ? "alle" : zurueck }); o.beiSpeichern?.("gespeichert"); } catch (e) { fehler(null, e); }
      } })] });
  }

  // ---------------------------------------------------------------- Bausteine für einstellungen.js
  // Steuerung und Marke einer Zeile (vor dem Bau der Zeile); die Meldung hängt nachbau() an die fertige Zeile
  function zeile(z) {
    const id = z.kuerzelId, b = befehl(id);
    const feld = h("button", { type: "button", klasse: "kz-feld", "data-kuerzel": id, "aria-describedby": null, aufClick: () => starteAufnahme(id) });
    const zurueck = baueKnopf({ symbol: "zuruecksetzen", variante: "leise", groesse: "s", label: T.zurueck(b.name), titel: T.zurueckTitel, hidden: true, klasse: "kz-zurueck", daten: { "data-aktion": "kz-zurueck" }, aufKlick: () => uebernehme(id, STANDARD) });
    const doppelt = einstellMarke(T.doppelt, "warn"); doppelt.hidden = true; doppelt.dataset.marke = "doppelt";
    const global = b.global ? einstellMarke(T.global) : null;
    if (global) { global.title = T.globalTitel; global.dataset.marke = "global"; }
    const meldung = h("div", { klasse: "kz-meldung", hidden: true, "data-meldung": id });
    S.zeilen.set(id, { feld, zurueck, doppelt, meldung, zeile: null });
    const steuerung = h("span", { klasse: "kz-steuerung" }, zurueck, feld);
    return { steuerung, marke: h("span", { klasse: "kz-marken" }, global, doppelt) };
  }
  function nachbau(z, el) {
    const r = S.zeilen.get(z.kuerzelId);
    if (!r) return;
    r.zeile = el;
    el.classList.add("ez-kz");
    el.dataset.kuerzel = z.kuerzelId;
    el.append(r.meldung);
    zeichne(z.kuerzelId);
  }
  // Suchfeld, Filter und „Alle zurücksetzen“ über der Liste
  function leiste() {
    const suche = textfeld({ typ: "search", platzhalter: T.suche, label: T.sucheLabel, groesse: "m", klasse: "kz-suche", daten: { "data-kz": "suche" } });
    suche.input.addEventListener("input", () => { S.suche = suche.input.value; filtere(); });
    suche.input.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && suche.input.value) { ev.preventDefault(); ev.stopPropagation(); suche.input.value = ""; suche.input.dispatchEvent(new Event("input", { bubbles: true })); } });
    const filter = segment({ optionen: [["alle", T.filter.alle], ["geaendert", T.filter.geaendert], ["ohne", T.filter.ohne], ["konflikte", T.filter.konflikte]].map(([wert, text]) => ({ wert, text, daten: { "data-kz-filter": wert } })),
      wert: "alle", label: T.filterLabel, groesse: "m", daten: { "data-kz": "filter" }, aufAenderung: (w) => { S.filter = w; filtere(); } });
    S.alleKnopf = baueKnopf({ text: T.alleZurueck, titel: T.alleZurueckTitel, variante: "leise", groesse: "m", disabled: kz.anzahlGeaendert() === 0, daten: { "data-aktion": "kz-alle-zurueck" }, aufKlick: alleZuruecksetzen });
    S.leer = h("p", { klasse: "kz-leer", hidden: true, role: "status", "data-kz": "leer" });
    S.leiste = h("div", { klasse: "kz-leiste" }, h("div", { klasse: "kz-leiste-zeile" }, suche.el, filter, S.alleKnopf), S.leer);
    return S.leiste;
  }

  const abmelden = kz.beiAenderung(() => { if (!S.tot) { zeichneAlle(); o.beiAenderung?.(); } });
  // Geladen? Sonst Stand holen, damit die Zeilen die gespeicherten Kürzel zeigen
  if (!kz.zustand().geladen) kz.lade();
  return {
    zeile, nachbau, leiste, filtere, zeichneAlle,
    ende() { S.tot = true; beendeAufnahme(); abmelden(); S.zeilen.clear(); S.meldungen.clear(); },
    aufnahmeLaeuft: () => !!S.aufnahme,
  };
}
