// Vorschlagskarten im Posteingang (K3, docs/plaene/ki-runde.md). Unter jedem Eintrag liegt eine ruhige Zeile: „n Vorschläge“ (lokal berechnet, ohne KI, nichts verlässt den Mac) und „Mit KI“. Ein Klick auf die Zeile
// klappt die Karten auf: Übernehmen · „Warum?“ (der Beleg wörtlich hervorgehoben) · Verwerfen. Duplikate zeigt „Vergleichen“ nebeneinander. In der Leiste über der Liste holt „Für alle“ die KI-Vorschläge der
// ersten höchstens 10 Einträge nacheinander (Fortschritt, Abbruch, Kontingent-Zeile). Die KI handelt nie: „Übernehmen“ schickt der Werkstatt nur Kennung und Token; sie führt die Aktion über den vorhandenen
// sicheren Weg aus (Journal, Rückgängig). Alle KI-Texte erscheinen als Text (textContent), nie als HTML.
// Keine Layoutsprünge: die Zeile ist von Anfang an da (feste Höhe), neue Vorschläge ändern nur die Zahl darin; die Karten klappen nur auf einen Klick auf und gleiten dabei (nie unter der Maus weg).
import { h, toast, dialog } from "./hilfen.js";
import { knopf as baueKnopf } from "./bausteine.js";
import { symbol } from "./symbole.js";
import { api } from "./api.js";
import { ruhig } from "./bewegung.js";
import { TK } from "./texte-posteingang-ki.js";
import { TV } from "./texte-ki-vorschlag.js";
import { TN } from "./texte-erwaehnungen.js";
import { kiStatus, oeffneEinwilligung, kontingentZeile, wasWirdGesendet, starteVorschlag, starteStapel } from "./ki-vorschlag.js";

const GRENZE_STAPEL = 10;
const runden = (n) => Math.max(100, Math.round(n / 100) * 100);
const neuZ = () => ({ lokal: null, lokalLaedt: false, stampWar: null, stamp: null, ki: null, nr: 0, offen: false, verworfen: new Set(), warum: new Set(), gesendetOffen: false, veraltet: false, schonDa: new Set() });
const phasen = new Set(["laeuft", "wartet"]);

// S: Zustand des Studios · ctx: posteingangCtx aus app.js (offenerPfad, sichereVorWechsel, sperre, nachAktion) · oeffne(pfad) · liste(): die Einträge, die der Posteingang gerade zeigt
export function erzeugePosteingangKi({ S, ctx, oeffne, liste }) {
  const zu = new Map(); // Pfad → Zustand dieses Eintrags (lebt, solange derselbe Vault offen ist)
  const ZU = (pfad) => { let z = zu.get(pfad); if (!z) zu.set(pfad, z = neuZ()); return z; };
  let bereit = null, bereitFehler = false, st = kiStatus(null), vaultMerk = null, vaultNr = 0, ktVoll = false, ktZeile = null, sigLeiste = "";
  let stapel = null, uhr = 0, gerade = new Set(); // gerade: Pfade mit laufender Übernahme

  // ---------- Status (Konto, Einwilligung, Sperre) ----------
  // Anderer Vault als beim letzten Mal: alles Gemerkte gehört dem alten und wird vergessen (sofort, nicht erst nach der Antwort der Werkstatt)
  const pruefeVault = () => { if (vaultMerk !== (S.info?.vault || null)) vergessen(S.info?.vault || null); };
  const sigStatus = () => JSON.stringify([st.sichtbar, st.gesperrt, st.konto?.id, st.konto?.abo, st.einwilligung]);
  async function frisch() {
    pruefeVault();
    const nr = vaultNr, davor = sigStatus();
    let neu = null;
    try { neu = await api.kiVorschlagBereit(); } catch { neu = null; }
    if (nr !== vaultNr) return st;
    bereit = neu; bereitFehler = neu === null; st = kiStatus(bereit);
    zeichneLeiste();
    if (sigStatus() !== davor) alleZeichnen(); // nur wenn sich für die Knöpfe etwas ändert
    return st;
  }
  const grenze = () => bereit?.grenzen?.stapel || GRENZE_STAPEL;
  const kiNeinNotiz = (n) => n.kiNein === true;
  function sperrGrund(n) {
    if (st.gesperrt) return TN.ki_zusammenfassen.gesperrt[st.gesperrt];
    if (n && kiNeinNotiz(n)) return TK.zeile.kiNein;
    if (ktVoll) return TK.zeile.voll;
    return null;
  }
  const kiBeschaeftigt = () => !!stapel && stapel.phase === "laeuft";

  // ---------- Lokale Vorschläge (ohne KI, ohne Konto): gesammelt abgefragt ----------
  let warteschlange = new Map(), lokalTimer = 0;
  function fordereLokal(n) {
    const z = ZU(n.pfad);
    if (z.lokal !== null && z.stamp !== (n.geaendert ?? null)) { z.lokal = null; z.lokalLaedt = false; } // der Eintrag hat sich geändert: neu berechnen
    if (z.lokal !== null || z.lokalLaedt) return;
    z.lokalLaedt = true; z.stampWar = n.geaendert ?? null;
    warteschlange.set(n.pfad, true);
    clearTimeout(lokalTimer); lokalTimer = setTimeout(leereLokal, 60);
  }
  async function leereLokal() {
    const pfade = [...warteschlange.keys()].slice(0, 40);
    for (const p of pfade) warteschlange.delete(p);
    if (!pfade.length) return;
    const nr = vaultNr;
    let r = null;
    try { r = await api.kiVorschlagLokal(pfade); } catch { r = null; }
    if (nr !== vaultNr) return;
    for (const p of pfade) {
      const z = ZU(p);
      z.lokal = r && r.eintraege && Array.isArray(r.eintraege[p]) ? r.eintraege[p] : []; z.lokalLaedt = false; z.stamp = z.stampWar;
      zeichne(p);
    }
    if (warteschlange.size) lokalTimer = setTimeout(leereLokal, 0);
  }

  // ---------- Welche Vorschläge sieht man? (lokal und KI, ohne Verworfene und Doppelte) ----------
  function sichtbare(z) {
    const aus = [], gesehen = new Set();
    for (const v of [...(z.lokal || []), ...(z.ki && z.ki.phase === "ergebnis" ? z.ki.vorschlaege : [])]) {
      if (z.verworfen.has(v.schluessel) || gesehen.has(v.schluessel)) continue;
      gesehen.add(v.schluessel); aus.push(v);
    }
    return aus;
  }
  const hatPanel = (z) => sichtbare(z).length > 0 || (z.ki && ["laeuft", "fehler", "abgebrochen", "ergebnis"].includes(z.ki.phase));

  // ---------- Zeichnen ----------
  const alleWurzeln = (pfad) => [...document.querySelectorAll("[data-pk-pfad]")].filter((w) => w.dataset.pkPfad === pfad);
  function zeichne(pfad, opt) { for (const w of alleWurzeln(pfad)) zeichneWurzel(w, opt); }
  function alleZeichnen() { for (const w of document.querySelectorAll("[data-pk-pfad]")) zeichneWurzel(w); }

  // Der Bereich einer Karte: Zeile (immer da) + Panel (nur auf Klick offen)
  function bereich(n) {
    pruefeVault();
    const w = h("div", { klasse: "pk", "data-pk": "", "data-pk-pfad": n.pfad, role: "group", "aria-label": TK.bereich });
    w._n = n;
    for (const ev of ["click", "dblclick", "contextmenu"]) w.addEventListener(ev, (e) => e.stopPropagation()); // gehört nicht der Karte: kein Öffnen der Notiz, kein Kartenmenü (die Pfeiltasten der Liste ignorieren .pk selbst)
    w.addEventListener("dragstart", (e) => { e.preventDefault(); e.stopPropagation(); });
    fordereLokal(n);
    zeichneWurzel(w);
    return w;
  }

  function zeichneWurzel(w, { animiere = false } = {}) {
    const n = w._n, z = ZU(n.pfad);
    const sicht = sichtbare(z), kiP = z.ki?.phase;
    const panelId = w.dataset.pkId || (w.dataset.pkId = `pk-${Math.random().toString(36).slice(2, 8)}`);
    const offen = z.offen && hatPanel(z);
    // Zeile
    const arbeitet = phasen.has(kiP);
    const text = z.lokal === null ? TK.zeile.laedt : sicht.length ? TK.zeile.anzahl(sicht.length) : kiP === "laeuft" ? TK.zeile.arbeitet : kiP === "wartet" ? TK.zeile.wartet : TK.zeile.keine;
    const klickbar = hatPanel(z);
    const chip = h("button", { type: "button", klasse: "pk-chip" + (sicht.length ? " hat" : "") + (arbeitet ? " arbeitet" : ""), "data-aktion": "pk-auf", "data-pk-fokus": "auf", disabled: !klickbar || null, "aria-expanded": String(offen), "aria-controls": panelId,
      title: klickbar ? (offen ? TK.zeile.zuTitel : TK.zeile.aufTitel) : null,
      aufClick: () => { z.offen = !z.offen; zeichneWurzel(w, { animiere: true }); } },
      h("span", { klasse: "pk-chip-sym", "aria-hidden": "true" }, symbol(arbeitet ? "funke" : "inbox", 12)), h("span", { klasse: "pk-chip-text", text }), klickbar ? h("span", { klasse: "pk-pfeil", "aria-hidden": "true" }, symbol("chevron-unten", 11)) : null);
    let kiKnopf = null;
    if (st.sichtbar) {
      const grund = sperrGrund(n);
      kiKnopf = h("button", { type: "button", klasse: "pk-ki", "data-aktion": "pk-ki", "data-pk-fokus": "ki", disabled: !!grund || arbeitet || kiBeschaeftigt() || gerade.has(n.pfad) || null, title: grund || TK.zeile.kiTitel,
        aufClick: () => klickKi(n) }, symbol("funke", 12), h("span", { text: kiP === "ergebnis" ? TK.zeile.kiNoch : TK.zeile.ki }));
    }
    const zeile = h("div", { klasse: "pk-zeile" }, chip, kiKnopf);
    // Panel
    const fokus = document.activeElement && w.contains(document.activeElement) ? document.activeElement.dataset?.pkFokus || document.activeElement.dataset?.pkId || null : null;
    const altPanel = w.querySelector(".pk-panel");
    const vorher = altPanel && !altPanel.hidden ? altPanel.offsetHeight : 0;
    const panel = h("div", { klasse: "pk-panel", id: panelId, role: "region", "aria-label": TK.bereich, hidden: !offen });
    if (offen) panel.append(...baueInhalt(n, z, w));
    w.replaceChildren(zeile, panel);
    if (fokus) { const ziel = [...w.querySelectorAll("[data-pk-fokus],[data-pk-id]")].find((e) => (e.dataset.pkFokus || e.dataset.pkId) === fokus); ziel?.focus?.({ preventScroll: true }); }
    // Gleiten statt springen: nur, wenn der Nutzer selbst auf- oder zuklappt oder sich ein offenes Panel ändert
    if (!ruhig() && w.isConnected && (animiere || vorher) && (offen || vorher)) {
      const nachher = offen ? panel.offsetHeight : 0;
      if (vorher !== nachher) {
        panel.hidden = false; panel.style.overflow = "hidden";
        const a = panel.animate([{ height: `${vorher}px`, opacity: vorher ? 1 : 0 }, { height: `${nachher}px`, opacity: nachher ? 1 : 0 }], { duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" });
        const fertig = () => { panel.style.overflow = ""; panel.hidden = !offen; };
        a.onfinish = fertig; a.oncancel = fertig;
      }
    }
  }

  function baueInhalt(n, z, w) {
    const teile = [];
    const kiP = z.ki?.phase;
    if (z.veraltet) teile.push(h("div", { klasse: "pk-meldung", "data-pk-veraltet": "", role: "status" }, h("span", { klasse: "pk-meldung-sym", "aria-hidden": "true" }, symbol("warnung", 14)), h("p", { text: TK.karte.veraltet }),
      baueKnopf({ text: TK.karte.neuHolen, groesse: "s", symbol: "zuruecksetzen", aktion: "pk-neu", daten: { "data-pk-fokus": "neu" }, disabled: !!sperrGrund(n) || null, aufKlick: () => { z.veraltet = false; z.ki = null; z.lokal = null; z.lokalLaedt = false; fordereLokal(n); klickKi(n); } })));
    if (kiP === "laeuft") teile.push(laufBlock(n, z));
    for (const v of sichtbare(z)) teile.push(baueVs(n, z, v));
    if (kiP === "fehler" || kiP === "abgebrochen") teile.push(h("div", { klasse: "pk-meldung", role: "status" }, h("p", { "data-pk-meldung": "", text: kiP === "abgebrochen" ? TV.lauf.abgebrochen : z.ki.text }),
      baueKnopf({ text: TV.lauf.nochEinmal, groesse: "s", aktion: "pk-noch", daten: { "data-pk-fokus": "noch" }, disabled: !!sperrGrund(n) || null, aufKlick: () => klickKi(n) })));
    if (kiP === "ergebnis") {
      const e = z.ki;
      if (!e.vorschlaege.length) teile.push(h("p", { klasse: "pk-leer", "data-pk-leer": "", text: TK.lauf.nichts }));
      else if (!sichtbare(z).length) teile.push(h("p", { klasse: "pk-leer", text: TK.lauf.nichtsMehr }));
      teile.push(h("div", { klasse: "pk-fuss" },
        h("span", { klasse: "pk-meta", "data-pk-meta": "", text: TK.lauf.meta(e.modell === "haiku" || !e.modell ? "Claude Haiku" : e.modell, e.konto, e.tokens) }),
        e.vorschau ? h("span", { klasse: "pk-marke", "data-pk-vorschau": "", text: TK.lauf.vorschauMarke }) : null,
        e.gesendet ? wasWirdGesendet({ gesendet: e.gesendet, offen: z.gesendetOffen, beiUmschalten: (auf) => { z.gesendetOffen = auf; } }) : null,
        e.vorschlaege.length ? h("button", { type: "button", klasse: "pk-link", "data-aktion": "pk-alle-verwerfen", "data-pk-fokus": "alle", text: TK.lauf.alleVerwerfen, aufClick: () => { for (const v of sichtbare(z)) z.verworfen.add(v.schluessel); zeichneWurzel(w, { animiere: true }); } }) : null));
    }
    return teile;
  }

  function laufBlock(n, z) {
    const e = z.ki;
    if (e.ausStapel) return h("div", { klasse: "pk-lauf", "data-pk-lauf": "", role: "status" }, h("div", { klasse: "pk-balken", "aria-hidden": "true" }, h("i")), h("p", { klasse: "pk-lauf-text", text: TK.lauf.ausStapel }));
    return h("div", { klasse: "pk-lauf", "data-pk-lauf": "", role: "status" },
      h("div", { klasse: "pk-balken", "aria-hidden": "true" }, h("i")),
      h("p", { klasse: "pk-lauf-text", "data-pk-zeit": "", text: e.wirdAbgebrochen ? TV.lauf.abbrechen + " …" : e.gesendet ? TV.lauf.arbeitet(Math.floor((Date.now() - e.start) / 1000)) : TV.lauf.startet }),
      e.gesendet ? wasWirdGesendet({ gesendet: e.gesendet, offen: z.gesendetOffen, beiUmschalten: (auf) => { z.gesendetOffen = auf; } }) : null,
      baueKnopf({ text: TV.lauf.abbrechen, groesse: "s", aktion: "pk-abbrechen", daten: { "data-pk-fokus": "abbrechen" }, disabled: !!e.wirdAbgebrochen, aufKlick: () => { e.wirdAbgebrochen = true; zeichne(n.pfad); e.lauf?.abbrechen(); } }));
  }

  // Eine Vorschlagskarte
  function baueVs(n, z, v) {
    const A = TK.art[v.art] || TK.art.verlinken;
    const veraltet = z.veraltet && v.quelle === "ki";
    const arbeitet = !!v.arbeitet;
    const warumOffen = z.warum.has(v.id);
    const el = h("article", { klasse: "pk-karte", "data-pk-art": v.art, "data-pk-vs": v.id, "data-pk-quelle": v.quelle || "ki", ...(veraltet ? { "data-zustand": "veraltet" } : {}) });
    el.append(h("div", { klasse: "pk-kopf" }, h("span", { klasse: "pk-sym", "aria-hidden": "true" }, symbol(A.symbol, 14)),
      h("div", { klasse: "pk-titel" }, h("span", { klasse: "pk-art", text: A.titel }), h("span", { klasse: "pk-text", "data-pk-text": "", text: v.beschriftung })),
      h("button", { type: "button", klasse: "pk-x", "data-aktion": "pk-verwerfen", "data-pk-fokus": `x-${v.id}`, "aria-label": TK.karte.verwerfen, title: TK.karte.verwerfen, disabled: arbeitet || null,
        aufClick: () => { z.verworfen.add(v.schluessel); zeichne(n.pfad, { animiere: true }); } }, symbol("schliessen", 12))));
    if (v.art === "aufgabe" && v.aufgabe) el.append(h("p", { klasse: "pk-detail", "data-pk-detail": "" }, h("b", { text: `„${v.aufgabe.text}“` }), v.aufgabe.faellig ? h("span", { klasse: "pk-faellig", text: TK.karte.faellig(datumKurz(v.aufgabe.faellig)) }) : null));
    if (v.art === "tags" && v.tags) el.append(h("p", { klasse: "pk-detail pk-tags", "data-pk-detail": "" }, v.tags.map((t) => h("span", { klasse: "pk-tag", text: `#${t}` }))));
    el.append(h("div", { klasse: "pk-marken" },
      v.quelle === "lokal" ? h("span", { klasse: "pk-marke ohne", text: TK.karte.ohneKi }) : h("span", { klasse: `pk-marke ${v.sicherheit === "hoch" ? "hoch" : "mittel"}`, text: v.sicherheit === "hoch" ? TK.karte.hoch : TK.karte.mittel })));
    const ok = baueKnopf({ text: arbeitet ? TK.karte.arbeitet : A.uebernehmen, groesse: "s", variante: v.art === "duplikat" ? "sekundaer" : "primaer", aktion: "pk-ok", daten: { "data-pk-fokus": `ok-${v.id}` }, disabled: veraltet || arbeitet || null, aufKlick: () => uebernehmen(n, z, v) });
    if (arbeitet) ok.setAttribute("aria-busy", "true");
    const knoepfe = h("div", { klasse: "pk-knoepfe" });
    if (v.art === "duplikat" && v.ziel) knoepfe.append(baueKnopf({ text: TK.karte.vergleichen, groesse: "s", symbol: "ansicht-spalten", aktion: "pk-vergleichen", disabled: arbeitet || null, aufKlick: () => oeffneVergleich(n, z, v) }));
    knoepfe.append(ok,
      h("button", { type: "button", klasse: "pk-link", "data-aktion": "pk-warum", "data-pk-fokus": `warum-${v.id}`, "aria-expanded": String(warumOffen), text: warumOffen ? TK.karte.warumZu : TK.karte.warum,
        aufClick: () => { if (z.warum.has(v.id)) z.warum.delete(v.id); else z.warum.add(v.id); zeichne(n.pfad, { animiere: true }); } }),);
    el.append(knoepfe);
    if (warumOffen) {
      const wr = v.warum || { vor: "", treffer: v.beleg || "", nach: "" };
      el.append(h("div", { klasse: "pk-warum", "data-pk-warum": "" },
        h("p", { klasse: "pk-label", text: v.art === "duplikat" && v.quelle === "lokal" ? TK.karte.labelTitel : TK.karte.labelStelle }),
        h("blockquote", { klasse: "pk-zitat" }, wr.vor || "", h("mark", { text: wr.treffer }), wr.nach || ""),
        h("p", { klasse: "pk-label", text: v.quelle === "lokal" ? TK.karte.labelBegruendung : TK.karte.labelBegruendungKi }),
        h("p", { klasse: "pk-begruendung", text: v.begruendung }),
        v.ziel && v.ziel.art === "notiz" ? h("button", { type: "button", klasse: "pk-link", "data-aktion": "pk-ziel", text: TK.karte.zielOeffnen, aufClick: () => oeffne(v.ziel.pfad) }) : null));
    }
    return el;
  }
  function datumKurz(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso); return m ? `${Number(m[3])}.${Number(m[2])}.` : iso; }

  // ---------- Duplikat: beide Texte nebeneinander ----------
  function oeffneVergleich(n, z, v) {
    const spalte = (titel, pfad) => {
      const pre = h("pre", { klasse: "pk-vgl-text", tabindex: "0", text: TK.vergleich.laedt });
      api.datei(pfad).then((r) => { pre.textContent = String(r?.inhalt ?? "").slice(0, 30000); }).catch(() => { pre.textContent = TK.vergleich.fehler; });
      return h("section", { klasse: "pk-vgl-spalte" }, h("div", { klasse: "pk-vgl-kopf" }, h("b", { text: titel }), h("span", { klasse: "pk-vgl-pfad", text: pfad })), pre);
    };
    const d = dialog({ titel: TK.vergleich.titel, satz: TK.vergleich.hinweis, breit: true, rumpf: h("div", { klasse: "pk-vgl" }, spalte(TK.vergleich.dieser, n.pfad), spalte(TK.vergleich.anderer, v.ziel.pfad)),
      knoepfe: [baueKnopf({ text: TK.vergleich.schliessen, aktion: "pk-vgl-zu", aufKlick: () => d.schliessen() }), baueKnopf({ text: TK.art.duplikat.uebernehmen, variante: "primaer", aktion: "pk-vgl-ok", aufKlick: () => { d.schliessen(); uebernehmen(n, z, v); } })] });
    d.box.dataset.dialog = "pk-vergleich";
  }

  // ---------- Übernehmen: nur Kennung und Token an die Werkstatt ----------
  async function uebernehmen(n, z, v) {
    if (v.arbeitet || gerade.has(n.pfad)) return;
    v.arbeitet = true; gerade.add(n.pfad); zeichne(n.pfad); zeichneLeiste();
    const pfad = n.pfad;
    let frei = () => {};
    try {
      if (ctx.offenerPfad() === pfad && !(await ctx.sichereVorWechsel())) return; // ungespeicherten Text zuerst sichern; scheitert das, passiert nichts
      frei = ctx.sperre(pfad);
      let r;
      try { r = await api.kiVorschlagAnwenden(v.id, v.token); } finally { frei(); frei = () => {}; }
      // Vorschlag verbraucht; hat Kortex den Eintrag geändert, gelten die übrigen weiter (neue Token)
      for (const g of r.geschwister || []) { const s = [...(z.lokal || []), ...(z.ki?.vorschlaege || [])].find((x) => x.id === g.id); if (s) s.token = g.token; }
      z.verworfen.add(v.schluessel);
      const weg = r.art === "verschieben" || r.art === "duplikat";
      await ctx.nachAktion({ weg: weg ? pfad : null, neuLaden: weg ? [] : [pfad] });
      toast(TK.toast.uebernommen[r.art] || TK.toast.uebernommen.verlinken, r.rueckgaengig ? { ms: 12000, aktion: { text: TK.karte.rueckgaengig, tun: () => zurueckNehmen(n, z, v) } } : { ms: 5000 });
    } catch (err) {
      const art = err?.daten?.art;
      if (art === "veraltet" || art === "abgelaufen" || art === "unbekannt" || art === "token") {
        if (v.quelle === "lokal") { z.lokal = null; z.lokalLaedt = false; toast(TK.toast.neuBerechnet); fordereLokal(n); } else z.veraltet = true;
      } else if (art === "nichts-zu-tun") { z.verworfen.add(v.schluessel); toast(err.message || TK.toast.schonDa); }
      else toast(err?.message || TK.toast.fehler, { fehler: true });
      await ctx.nachAktion({}); // Stand neu holen
    } finally { v.arbeitet = false; gerade.delete(pfad); zeichne(pfad); zeichneLeiste(); }
  }
  async function zurueckNehmen(n, z, v) {
    try {
      await api.kiVorschlagZurueck(v.id);
      z.verworfen.delete(v.schluessel); z.lokal = null; z.lokalLaedt = false; z.ki = null; // die Vorschläge sind verbraucht: neu berechnen, die KI nur auf Klick
      await ctx.nachAktion({ neuLaden: [n.pfad] });
      toast(TK.toast.zurueck, { ms: 4000 });
      zeichne(n.pfad);
    } catch (err) { toast(err?.message || TK.toast.zurueckFehler, { fehler: true }); }
  }

  // ---------- KI holen: Einwilligung → Lauf ----------
  async function klickKi(n) {
    const z = ZU(n.pfad);
    if (phasen.has(z.ki?.phase) || kiBeschaeftigt()) return;
    await frisch();
    if (!st.sichtbar || sperrGrund(n)) return;
    if (!st.einwilligung) { einwilligen(() => startEinzeln(n)); return; }
    startEinzeln(n);
  }
  function einwilligen(danach) {
    const funktionen = (bereit?.funktionen || []).filter((f) => f === "zusammenfassung" || f === "posteingang" || f === "text");
    oeffneEinwilligung({ api, bereit, vault: S.info?.vault || "", vaultName: S.info?.name || "", funktionen: funktionen.length ? funktionen : ["posteingang"], nachher: async () => { await frisch(); if (st.einwilligung && !ktVoll) danach(); } });
  }
  function startUhr() {
    if (uhr) return;
    uhr = setInterval(() => {
      const aktiv = [...zu.values()].some((z) => z.ki?.phase === "laeuft" && z.ki.gesendet);
      if (!aktiv) { clearInterval(uhr); uhr = 0; return; }
      for (const t of document.querySelectorAll("[data-pk-zeit]")) {
        const w = t.closest("[data-pk-pfad]"); const e = w && ZU(w.dataset.pkPfad).ki;
        if (e && e.phase === "laeuft" && e.gesendet && !e.wirdAbgebrochen) t.textContent = TV.lauf.arbeitet(Math.floor((Date.now() - e.start) / 1000));
      }
    }, 1000);
  }
  function setzeErgebnis(z, e, start) {
    const tokens = Object.values(e.tokens || {}).reduce((a, b) => a + (Number(b) || 0), 0);
    if (e.ok) z.ki = { ...start, phase: "ergebnis", vorschlaege: (e.vorschlaege || []).map((v) => ({ ...v, quelle: "ki" })), tokens: tokens > 0 ? runden(tokens) : 0, vorschau: e.vorschau === true };
    else if (e.abgebrochen) z.ki = { ...start, phase: "abgebrochen" };
    else z.ki = { ...start, phase: "fehler", text: e.fehler || TV.lauf.fehlerAllgemein, vorschau: e.vorschau === true };
  }
  function startEinzeln(n) {
    const z = ZU(n.pfad), mein = ++z.nr, pfad = n.pfad;
    const start = { start: Date.now(), gesendet: null, wirdAbgebrochen: false, lauf: null, modell: "haiku", konto: st.konto?.name || "" };
    z.ki = { ...start, phase: "laeuft" }; z.offen = true; z.veraltet = false;
    zeichne(pfad, { animiere: true }); zeichneLeiste(); startUhr();
    const l = starteVorschlag({ api, wiederholeBeiLaeuft: true, eingabe: { funktion: "posteingang", pfad, konto: st.konto.id },
      beiStart: (s) => { if (z.nr !== mein || !z.ki) return; z.ki.gesendet = s.gesendet; z.ki.konto = s.konto?.name || z.ki.konto; zeichne(pfad); } });
    z.ki.lauf = l; start.lauf = l;
    l.fertig.then(({ start: s, ergebnis }) => {
      if (z.nr !== mein) return;
      setzeErgebnis(z, ergebnis, { ...start, gesendet: s?.gesendet || z.ki?.gesendet || null, konto: s?.konto?.name || start.konto });
      z.ki.lauf = null;
      zeichne(pfad, { animiere: true }); zeichneLeiste();
    }).catch(async (err) => {
      if (z.nr !== mein) return;
      z.ki = { ...start, phase: "fehler", text: err?.message || TV.lauf.fehlerAllgemein, lauf: null };
      zeichne(pfad, { animiere: true }); zeichneLeiste();
      if (err?.daten?.art === "einwilligung" || err?.daten?.art === "einwilligung-konto") await frisch();
    });
  }

  // ---------- Leiste: „Für alle“ ----------
  const leiste = h("div", { klasse: "pk-leiste", "data-pk-leiste": "", role: "group", "aria-label": TK.leiste, hidden: true });
  function stapelPfade() {
    const alle = (liste() || []).filter((n) => n && n.bereich === "inbox" && !n.generiert && !kiNeinNotiz(n));
    const ohne = alle.filter((n) => ZU(n.pfad).ki?.phase !== "ergebnis");
    const basis = ohne.length ? ohne : alle;
    return { pfade: basis.slice(0, grenze()).map((n) => n.pfad), gesamt: basis.length, alleHaben: !ohne.length && alle.length > 0 };
  }
  function zeichneLeiste() {
    pruefeVault();
    const sp = stapelPfade();
    // Solange die Werkstatt noch nicht geantwortet hat, hält die Leiste ihren Platz (unsichtbar): kommt das Konto dazu, springt die Liste nicht
    if (bereit === null && !bereitFehler) {
      leiste.hidden = sp.gesamt === 0; leiste.classList.add("platz");
      if (sigLeiste !== "platz") { sigLeiste = "platz"; leiste.replaceChildren(h("div", { klasse: "pk-leiste-kopf" }), h("div", { klasse: "pk-leiste-fuss" })); }
      return;
    }
    leiste.classList.remove("platz");
    const laeuft = kiBeschaeftigt();
    const sichtbar = st.sichtbar && (sp.gesamt > 0 || !!stapel);
    const sig = JSON.stringify([sichtbar, st.sichtbar, st.konto?.id, st.konto?.abo, st.gesperrt, laeuft, sp.gesamt, sp.alleHaben, ktVoll, stapel && [stapel.phase, stapel.erledigt, stapel.von, stapel.text, stapel.wirdAbgebrochen, stapel.ausgenommen, stapel.vorschlaege], gerade.size]);
    leiste.hidden = !sichtbar;
    if (sig === sigLeiste) return;
    sigLeiste = sig;
    if (!st.sichtbar) { ktZeile?.stopp(); ktZeile = null; leiste.replaceChildren(); return; }
    if (!ktZeile || ktZeile.konto !== st.konto?.id) {
      ktZeile?.stopp();
      const kz = ktZeile = kontingentZeile({ api, konto: st.konto.id, abo: st.konto.abo || null, name: "pk-kontingent", beiAenderung: (x) => { const alt = ktVoll; ktVoll = !!x.voll; if (alt !== ktVoll) { zeichneLeiste(); alleZeichnen(); } } });
      kz.konto = st.konto.id;
    }
    const grund = st.gesperrt ? TN.ki_zusammenfassen.gesperrt[st.gesperrt] : ktVoll ? TK.zeile.voll : null;
    // Immer zwei Zeilen (Knopf bzw. Abbrechen mit Balken · Text bzw. Kontingent): die Leiste ändert ihre Höhe nie, die Liste darunter bleibt, wo sie ist
    let kopf, fuss;
    if (laeuft) {
      kopf = [baueKnopf({ text: stapel.wirdAbgebrochen ? TK.stapel.wirdAbgebrochen : TK.stapel.abbrechen, groesse: "s", aktion: "pk-stapel-abbrechen", disabled: !!stapel.wirdAbgebrochen, aufKlick: abbrechenStapel }),
        h("div", { klasse: "pk-balken", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(stapel.von), "aria-valuenow": String(stapel.erledigt) }, h("i", { style: `width:${Math.max(6, Math.round((stapel.erledigt / Math.max(1, stapel.von)) * 100))}%` }))];
      fuss = h("span", { klasse: "pk-fuss-text", role: "status", "data-pk-fortschritt": "", text: stapel.wirdAbgebrochen ? TK.stapel.wirdAbgebrochen : TK.stapel.arbeitet(Math.min(stapel.erledigt + 1, stapel.von), stapel.von) });
    } else {
      const text = sp.alleHaben ? TK.stapel.knopfNoch(sp.pfade.length) : sp.gesamt > grenze() ? TK.stapel.knopfGekappt(grenze()) : TK.stapel.knopf(sp.pfade.length);
      kopf = [h("button", { type: "button", klasse: "pk-alle", "data-aktion": "pk-alle", disabled: !!grund || !sp.pfade.length || gerade.size > 0 || null, title: grund || TK.stapel.titel(grenze()), aufClick: klickStapel }, symbol("funke", 13), h("span", { text }))];
      fuss = stapel && stapel.text ? h("span", { klasse: "pk-fuss-text", "data-pk-stapel-text": "", role: "status", text: stapel.text }) : grund ? h("span", { klasse: "pk-fuss-text", text: grund }) : ktZeile.knoten;
    }
    leiste.replaceChildren(h("div", { klasse: "pk-leiste-kopf" }, kopf), h("div", { klasse: "pk-leiste-fuss" }, fuss));
  }
  async function klickStapel() {
    if (kiBeschaeftigt()) return;
    await frisch();
    if (!st.sichtbar || st.gesperrt || ktVoll) return;
    if (!st.einwilligung) { einwilligen(() => starteAlle()); return; }
    starteAlle();
  }
  function starteAlle() {
    const { pfade } = stapelPfade();
    if (!pfade.length || kiBeschaeftigt()) return;
    const mein = { phase: "laeuft", von: pfade.length, erledigt: 0, pfade, wirdAbgebrochen: false, ausgenommen: 0, vorschlaege: 0, text: "", handle: null, konto: st.konto?.name || "" };
    stapel = mein;
    for (const p of pfade) { const z = ZU(p); z.nr++; z.ki = { phase: "wartet", ausStapel: true, start: Date.now(), modell: "haiku", konto: mein.konto }; z.veraltet = false; }
    zeichneLeiste(); alleZeichnen();
    const l = starteStapel({ api, eingabe: { funktion: "posteingang", pfade, konto: st.konto.id }, beiStand: (s) => wendeStandAn(mein, s) });
    mein.handle = l;
    l.fertig.then((s) => { if (stapel !== mein) return; wendeStandAn(mein, s); schliesseStapel(mein, s); })
      .catch(async (err) => {
        if (stapel !== mein) return;
        for (const p of pfade) { const z = ZU(p); if (phasen.has(z.ki?.phase)) z.ki = null; }
        mein.phase = "fertig"; mein.text = err?.message || TV.lauf.fehlerAllgemein; mein.handle = null;
        zeichneLeiste(); alleZeichnen();
        if (err?.daten?.art === "einwilligung" || err?.daten?.art === "einwilligung-konto") await frisch();
      });
  }
  function wendeStandAn(mein, s) {
    if (stapel !== mein) return;
    mein.erledigt = s.erledigt || 0; mein.ausgenommen = s.ausgenommen || 0;
    let vorschlaege = 0;
    for (const p of mein.pfade) {
      const z = ZU(p), e = s.eintraege?.[p];
      if (e) {
        if (z.ki && z.ki.stapelErg === e) { if (e.ok) vorschlaege += (e.vorschlaege || []).length; continue; }
        const start = { start: z.ki?.start || Date.now(), gesendet: null, modell: "haiku", konto: s.konto?.name || mein.konto, stapelErg: e };
        if (e.ausgenommen) z.ki = null;
        else setzeErgebnis(z, e, start);
        if (z.ki && z.ki.phase === "abgebrochen") z.ki = null;
        if (e.ok) vorschlaege += (e.vorschlaege || []).length;
        zeichne(p);
      } else if (s.aktuell === p && z.ki && z.ki.phase !== "laeuft") { z.ki = { ...z.ki, phase: "laeuft", ausStapel: true }; zeichne(p); }
    }
    mein.vorschlaege = vorschlaege;
    zeichneLeiste();
  }
  function schliesseStapel(mein, s) {
    mein.handle = null; mein.phase = "fertig";
    for (const p of mein.pfade) { const z = ZU(p); if (phasen.has(z.ki?.phase)) { z.ki = null; zeichne(p); } } // was nicht mehr drankam, wartet nicht länger
    const fertigeEintraege = mein.pfade.filter((p) => ZU(p).ki?.phase === "ergebnis").length;
    const teile = [];
    if (s.abgebrochen && !s.verloren) teile.push(TK.stapel.abgebrochen(s.erledigt || 0, mein.von));
    else if (s.gestoppt) teile.push(TK.stapel.gestoppt(s.gestoppt));
    else if (!s.verloren) teile.push(TK.stapel.fertig(fertigeEintraege, mein.vorschlaege));
    if (mein.ausgenommen) teile.push(TK.stapel.ausgenommen(mein.ausgenommen));
    mein.text = teile.join(" ");
    zeichneLeiste(); alleZeichnen();
  }
  function abbrechenStapel() {
    if (!stapel || stapel.phase !== "laeuft" || stapel.wirdAbgebrochen) return;
    stapel.wirdAbgebrochen = true; zeichneLeiste();
    stapel.handle?.abbrechen();
  }

  // ---------- Vault gewechselt / Ende ----------
  function vergessen(neuerVault = null) {
    vaultNr++; vaultMerk = neuerVault;
    stapel?.handle?.abbrechen(); stapel = null;
    for (const z of zu.values()) z.ki?.lauf?.abbrechen?.();
    zu.clear(); gerade = new Set(); warteschlange = new Map(); clearTimeout(lokalTimer);
    clearInterval(uhr); uhr = 0; ktVoll = false; ktZeile?.stopp(); ktZeile = null; sigLeiste = ""; leiste.replaceChildren(); leiste.hidden = true;
    bereit = null; bereitFehler = false; st = kiStatus(null);
  }
  window.addEventListener("pagehide", () => { stapel?.handle?.abbrechen(); for (const z of zu.values()) z.ki?.lauf?.abbrechen?.(); });

  return { leiste, bereich, laden: frisch, aktualisiere: zeichneLeiste, vergessen, _zustand: () => ({ zu, stapel, st }) };
}
