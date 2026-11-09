// KI-Aktionen auf markiertem Text im Editor (K2, docs/plaene/ki-runde.md): Klarer schreiben, Kürzen, Übersetzen, Aufgaben herausziehen.
// Die KI schlägt nur vor: Gesendet wird die Auswahl plus die Überschrift darüber (die Werkstatt sammelt, ki: nein blockt), das Ergebnis erscheint IMMER zuerst als Wort-Diff in einem Popover am Text.
// „Übernehmen“ ist EINE Editor-Transaktion (⌘Z macht sie in einem Schritt rückgängig); sie ist gesperrt, sobald sich der markierte Text seit der Anfrage geändert hat.
// Einstiege: KI-Knopf der Format-Leiste, Kontextmenü, Befehlspalette (⌘K). Alle öffnen dasselbe Popover (Menü → Lauf → Diff/Aufgaben/Fehler). Tastatur: ↑↓ ⏎ im Menü, ⏎ übernehmen, Esc verwerfen.
// Alle KI-Texte werden als Text gesetzt (textContent), nie als HTML; Warnzeilen baut Kortex selbst.
import { h, toast, dialogOffen } from "./hilfen.js";
import { knopf as baueKnopf, umschalter } from "./bausteine.js";
import { symbol } from "./symbole.js";
import { api } from "./api.js";
import { TK } from "./texte-ki-text.js";
import { TV } from "./texte-ki-vorschlag.js";
import { TN } from "./texte-erwaehnungen.js";
import { kiStatus, oeffneEinwilligung, kontingentZeile, wasWirdGesendet, starteVorschlag } from "./ki-vorschlag.js";
import { wortDiffAnzeige, hatAenderung, wortDiffAnsicht } from "./diff.js";
import * as L from "./ki-text-logik.js";

const AKTION_SYMBOL = { umschreiben: "stift", kuerzen: "gliederung", aufgaben: "aufgaben" };

// S: Zustand des Studios (pfad, bearbeitbar, dirty, info) · ed: der Editor (ed.view) · speichereWarte(): speichert die offene Notiz und wartet · nachAufgaben(): Baum/Git neu lesen
export function erzeugeKiText({ S, ed, speichereWarte, nachAufgaben }) {
  let bereit = null, st = kiStatus(null), geholt = 0, holt = null, vaultMerk = null, ktVoll = false;
  let gruendlich = false, gesendetOffen = false;
  let z = null, pop = null, uhr = 0, lauf = null, kt = null, idx = 0, merkDoc = null, merkBereiche = null;

  // ---------- Status (Konto, Einwilligung, Sperre) ----------
  const melde = () => window.dispatchEvent(new Event("kortex-ki-text"));
  const sig = () => JSON.stringify([st.sichtbar, st.gesperrt, st.konto?.id, st.einwilligung]);
  function frisch(erzwingen = false) {
    const vault = S.info?.vault || null;
    if (vaultMerk !== vault) { vaultMerk = vault; bereit = null; st = kiStatus(null); geholt = 0; }
    if (holt) return holt;
    if (!erzwingen && Date.now() - geholt < 20_000) return Promise.resolve(st);
    const vorher = sig();
    holt = api.kiVorschlagBereit().then((b) => b, () => null).then((b) => {
      bereit = b; st = kiStatus(b); geholt = Date.now(); holt = null;
      if (vorher !== sig()) melde();
      return st;
    });
    return holt;
  }
  const sichtbar = () => { frisch(); return !!(st.sichtbar && S.bearbeitbar); };

  // ---------- Auswahl und ihre Sperrgründe ----------
  function snapshot() {
    const state = ed.view.state, r = state.selection.main;
    if (state.selection.ranges.length !== 1 || r.empty) return null;
    const lb = state.lineBreak;
    return { von: r.from, bis: r.to, text: state.sliceDoc(r.from, r.to, lb), lb, pfad: S.pfad || "" };
  }
  function bereiche() {
    const doc = ed.view.state.doc;
    if (merkDoc !== doc) { merkDoc = doc; merkBereiche = L.gesperrteBereiche(doc.toString()); }
    return merkBereiche;
  }
  function grundAuswahl(snap) {
    if (!snap) return TK.grund.leer;
    if (!S.bearbeitbar) return TK.grund.nurLesen;
    if (!snap.pfad) return TK.grund.ungespeichert;
    const p = L.pruefeAuswahl(ed.view.state.doc.toString(), snap.von, snap.bis, { laenge: snap.text.length, bereiche: bereiche() });
    if (p.ok) return null;
    return p.grund === "zulang" ? TK.grund.zulang(L.MAX_AUSWAHL) : TK.grund[p.grund];
  }
  const grundGesamt = (snap) => (st.gesperrt ? TN.ki_zusammenfassen.gesperrt[st.gesperrt] : null) || grundAuswahl(snap) || (ktVoll ? TN.ki_zusammenfassen.kontingentVoll : null);
  // Für die Format-Leiste: Knopf zeigen? und warum aus?
  const leisteZustand = () => (sichtbar() ? { sichtbar: true, grund: grundGesamt(snapshot()) } : { sichtbar: false, grund: null });

  // ---------- Popover ----------
  const klemme = (p) => Math.max(0, Math.min(ed.view.state.doc.length, p));
  function setzePos() {
    if (!pop || !z) return;
    const el = pop.el, v = ed.view;
    let a, b;
    if (z.anker) a = b = { left: z.anker.x, top: z.anker.y, bottom: z.anker.y };
    else { a = v.coordsAtPos(klemme(z.snap.von), 1); b = v.coordsAtPos(klemme(z.snap.bis), -1); }
    const vw = window.innerWidth, vh = window.innerHeight;
    if (!a || !b) { el.style.visibility = "hidden"; return; }
    const rand = v.scrollDOM.getBoundingClientRect();
    if (!z.anker && (b.bottom < rand.top || a.top > rand.bottom)) { el.style.visibility = "hidden"; return; }
    el.style.visibility = "";
    const breite = el.offsetWidth || 440;
    if (!z.seite) z.seite = vh - b.bottom - 20 >= 360 || vh - b.bottom >= a.top ? "unten" : "oben";
    el.dataset.seite = z.seite;
    el.style.left = Math.round(Math.max(8, Math.min(a.left, vw - breite - 8))) + "px";
    if (z.seite === "unten") {
      const oben = Math.max(8, Math.min(b.bottom + 8, vh - 140));
      el.style.top = Math.round(oben) + "px"; el.style.bottom = "auto"; el.style.maxHeight = Math.max(160, vh - oben - 12) + "px";
    } else {
      const unten = Math.max(8, Math.min(vh - a.top + 8, vh - 140));
      el.style.bottom = Math.round(unten) + "px"; el.style.top = "auto"; el.style.maxHeight = Math.max(160, vh - unten - 12) + "px";
    }
  }
  const beiScroll = () => setzePos();
  function oeffnePop() {
    if (pop) return;
    const el = h("div", { klasse: "kit", role: "dialog", "aria-label": TK.menue, "data-ki-text": "", "data-phase": "menu", "data-offen": "nein" });
    // Klicks nehmen dem Editor weder Fokus noch Auswahl (⌘Z und Tippen gehen weiter an den Editor); nur das Datenpaket bleibt markierbar
    el.addEventListener("mousedown", (e) => { if (!e.target.closest?.(".kiv-paket, .wd")) e.preventDefault(); });
    document.body.append(el);
    pop = { el };
    document.documentElement.dataset.kiTextOffen = "ja";
    document.addEventListener("keydown", taste, true);
    document.addEventListener("mousedown", aussen, true);
    ed.view.scrollDOM.addEventListener("scroll", beiScroll, { passive: true });
    window.addEventListener("resize", beiScroll);
    melde();
  }
  function schliesse() {
    clearInterval(uhr); uhr = 0;
    kt?.stopp?.(); kt = null;
    if (lauf) { lauf.abbrechen(); lauf = null; }
    const war = pop;
    z = null; pop = null;
    if (!war) return;
    document.removeEventListener("keydown", taste, true);
    document.removeEventListener("mousedown", aussen, true);
    ed.view.scrollDOM.removeEventListener("scroll", beiScroll);
    window.removeEventListener("resize", beiScroll);
    delete document.documentElement.dataset.kiTextOffen;
    war.el.dataset.offen = "nein";
    setTimeout(() => war.el.remove(), 130);
    melde();
  }
  // Klick außerhalb: nur das Menü schließt (Lauf und Diff gehören zum Text und bleiben, bis man entscheidet)
  function aussen(e) {
    if (!pop || pop.el.contains(e.target) || dialogOffen()) return;
    if (z?.phase === "menu" && !e.target.closest?.(".format-leiste")) schliesse();
  }

  // ---------- Zeichnen ----------
  const iconKnopf = (zu) => h("button", { type: "button", klasse: "kit-zu", "data-aktion": "ki-text-zu", "aria-label": TK.schliessen, title: TK.schliessen, aufClick: zu }, symbol("schliessen", 12));
  function kopf(titel, { marke = false } = {}) {
    return h("div", { klasse: "kit-kopf" }, h("span", { klasse: "kit-kopf-sym", "aria-hidden": "true" }, symbol("funke", 14)), h("span", { klasse: "kit-titel", "data-ki-text-titel": "", text: titel }),
      marke ? h("span", { klasse: "kit-marke", "data-ki-text-marke": "", text: TK.vorschauMarke }) : null,
      iconKnopf(() => { z?.phase === "ergebnis" || z?.phase === "menu" || z?.phase === "fehler" ? schliesse() : abbrechenUndZu(); ed.view.focus(); }));
  }
  function setze(phase, teile) {
    if (!pop) return;
    pop.el.dataset.phase = phase;
    pop.el.replaceChildren(...teile);
    if (pop.kontextFuss && phase === "menu") pop.el.append(pop.kontextFuss);
    pop.el.setAttribute("aria-label", teile[0]?.querySelector?.(".kit-titel")?.textContent || TK.menue);
    setzePos();
    requestAnimationFrame(() => { if (pop) { setzePos(); pop.el.dataset.offen = "ja"; } });
  }
  const titelFuer = (aktion, sprache) => (aktion === "uebersetzen" ? TK.uebersetzenTitel(TK.sprachen[sprache] || sprache) : TK.aktionen[aktion].titel);

  function zeichne() {
    if (!z || !pop) return;
    kt?.stopp?.(); kt = null;
    ({ menu: zeichneMenue, laeuft: zeichneLauf, ergebnis: zeichneErgebnis, fehler: zeichneFehler })[z.phase]();
  }

  // --- Menü ---
  function zeichneMenue() {
    const grund = grundGesamt(z.snap);
    const gesperrt = !!grund;
    const knoepfe = [];
    const eintrag = (aktion) => {
      const A = TK.aktionen[aktion];
      const b = h("button", { type: "button", klasse: "kit-eintrag", role: "menuitem", "data-ki-aktion": aktion, "data-aktiv": "false", "aria-disabled": gesperrt ? "true" : null, title: grund || "", aufClick: () => { if (!grundGesamt(z.snap)) waehle(aktion); } },
        symbol(AKTION_SYMBOL[aktion], 16), h("span", { klasse: "kit-eintrag-text" }, h("span", { klasse: "kit-eintrag-name", text: A.name }), h("span", { klasse: "kit-eintrag-hinweis", text: A.hinweis })));
      b.addEventListener("mouseenter", () => markiere(knoepfe.indexOf(b)));
      knoepfe.push(b);
      return b;
    };
    const sprachen = L.SPRACHEN.map((s) => {
      const b = h("button", { type: "button", klasse: "kit-chip", role: "menuitem", "data-ki-aktion": "uebersetzen", "data-ki-sprache": s, "data-aktiv": "false", "aria-disabled": gesperrt ? "true" : null, title: grund || "", text: TK.sprachen[s], aufClick: () => { if (!grundGesamt(z.snap)) waehle("uebersetzen", s); } });
      b.addEventListener("mouseenter", () => markiere(knoepfe.indexOf(b)));
      knoepfe.push(b);
      return b;
    });
    const liste = [eintrag("umschreiben"), eintrag("kuerzen"), eintrag("aufgaben")];
    const mitte = [grund ? h("p", { klasse: "kit-grund", "data-ki-text-grund": "", text: grund }) : null, ...liste, h("div", { klasse: "kit-gruppe", text: TK.uebersetzen }), h("div", { klasse: "kit-sprachen" }, sprachen)];
    const modell = umschalter({ an: gruendlich, text: TK.gruendlicher, daten: { "data-ki-gruendlich": "" }, aufAenderung: (a) => { gruendlich = a; } });
    const kz = st.konto ? kontingentZeile({ api, konto: st.konto.id, abo: st.konto.abo || null, beiAenderung: (k) => { if (ktVoll !== !!k.voll) { ktVoll = !!k.voll; if (z?.phase === "menu") { const g = grundGesamt(z.snap); knoepfe.forEach((b) => { b.setAttribute("aria-disabled", g ? "true" : "false"); b.title = g || ""; }); } } } }) : null;
    kt = kz;
    const fuss = h("div", { klasse: "kit-fuss kit-fuss-spalte" }, h("div", { klasse: "kit-gruendlich" }, modell, h("p", { klasse: "kit-klein", text: TK.gruendlicherHinweis })), kz?.knoten || null,
      wasWirdGesendet({ funktionen: ["text"], offen: gesendetOffen, beiUmschalten: (a) => { gesendetOffen = a; } }));
    markiere = (i) => { idx = i; knoepfe.forEach((k, n) => k.setAttribute("data-aktiv", String(n === i))); };
    pop.knoepfe = knoepfe;
    setze("menu", [kopf(TK.menue), h("div", { klasse: "kit-mitte", role: "menu" }, mitte), fuss]);
    markiere(gesperrt ? -1 : 0);
  }
  let markiere = () => {};

  // --- Lauf ---
  function zeichneLauf() {
    const gesendet = z.gesendet ? wasWirdGesendet({ gesendet: z.gesendet, offen: gesendetOffen, beiUmschalten: (a) => { gesendetOffen = a; } }) : null;
    setze("laeuft", [kopf(titelFuer(z.aktion, z.sprache)),
      h("div", { klasse: "kit-mitte", role: "status", "aria-live": "polite" }, h("div", { klasse: "kit-balken", "aria-hidden": "true" }, h("i")),
        h("p", { klasse: "kit-text", "data-ki-text-zeit": "", text: z.wirdAbgebrochen ? TK.lauf.wirdAbgebrochen : z.gesendet ? TK.lauf.zeit(Math.floor((Date.now() - z.start) / 1000)) : TV.lauf.startet }), gesendet),
      h("div", { klasse: "kit-fuss" }, h("span", { klasse: "kit-abstand" }), baueKnopf({ text: TK.lauf.abbrechen, groesse: "s", aktion: "ki-text-abbrechen", disabled: !!z.wirdAbgebrochen, aufKlick: abbrechenUndZu }))]);
  }

  // --- Fehler ---
  function zeichneFehler() {
    setze("fehler", [kopf(titelFuer(z.aktion, z.sprache), { marke: !!z.vorschau }),
      h("div", { klasse: "kit-mitte", role: "status" }, h("p", { klasse: "kit-text", "data-ki-text-meldung": "", text: z.fehler || TV.lauf.fehlerAllgemein })),
      h("div", { klasse: "kit-fuss" }, h("span", { klasse: "kit-abstand" }), baueKnopf({ text: TK.schliessen, groesse: "s", aktion: "ki-text-schliessen", aufKlick: () => { schliesse(); ed.view.focus(); } }),
        baueKnopf({ text: TV.lauf.nochEinmal, groesse: "s", variante: "primaer", aktion: "ki-text-nochmal", aufKlick: nochEinmal }))]);
  }

  // --- Ergebnis: Diff oder Aufgaben ---
  function zeichneErgebnis() {
    const warn = (z.warnungen || []).map((w) => (TK.warnung[w.art] ? h("p", { klasse: "kit-warn", "data-ki-text-warnung": w.art, role: "note" }, symbol("warnung", 14), h("span", { text: TK.warnung[w.art](w) })) : null));
    const sperre = z.gesperrt ? h("p", { klasse: "kit-sperre", "data-ki-text-gesperrt": "", role: "alert" }, symbol("warnung", 14), h("span", { text: TK.diff.geaendert })) : null;
    const gesendet = z.gesendet ? wasWirdGesendet({ gesendet: z.gesendet, offen: gesendetOffen, beiUmschalten: (a) => { gesendetOffen = a; } }) : null;
    const verwerfen = baueKnopf({ text: TK.diff.verwerfen, groesse: "s", aktion: "ki-text-verwerfen", aufKlick: () => { schliesse(); ed.view.focus(); } });
    const neu = baueKnopf({ text: TK.diff.neuAnfragen, groesse: "s", aktion: "ki-text-neu", aufKlick: nochEinmal });
    const tasten = h("span", { klasse: "kit-tasten", "aria-hidden": "true" }, h("span", { text: TK.diff.tasten.uebernehmen }), h("span", { text: TK.diff.tasten.verwerfen }));
    let mitte, fuss;
    if (z.funktion === "aufgaben") {
      if (!z.aufgaben.length) {
        mitte = [h("p", { klasse: "kit-text", "data-ki-text-meldung": "", text: TK.aufgaben.keine }), gesendet];
        fuss = [h("span", { klasse: "kit-abstand" }), baueKnopf({ text: TK.schliessen, groesse: "s", aktion: "ki-text-schliessen", aufKlick: () => { schliesse(); ed.view.focus(); } })];
      } else {
        mitte = [h("ul", { klasse: "kit-aufgaben", "data-ki-text-aufgaben": "", "aria-label": TK.aufgaben.liste }, z.aufgaben.map((a) => h("li", { klasse: "kit-aufgabe", "data-ki-text-aufgabe": "" }, h("span", { klasse: "kit-aufgabe-kaestchen", "aria-hidden": "true" }),
          h("span", { klasse: "kit-aufgabe-text" }, a.text, a.faellig ? h("small", { text: TK.aufgaben.faellig(a.faellig) }) : null)))), sperre,
          ...warn, z.gesperrt ? null : h("p", { klasse: "kit-klein", "data-ki-text-tasten": "", text: TK.aufgaben.tasten }), gesendet];
        fuss = [z.gesperrt ? neu : null, h("span", { klasse: "kit-abstand" }), verwerfen,
          baueKnopf({ text: TK.aufgaben.anlegen(z.aufgaben.length), groesse: "s", aktion: "ki-text-anlegen", disabled: !!z.beschaeftigt, aufKlick: legeAufgabenAn }),
          baueKnopf({ text: TK.aufgaben.einfuegen, groesse: "s", variante: "primaer", aktion: "ki-text-uebernehmen", disabled: !!z.gesperrt || !!z.beschaeftigt, titel: z.gesperrt ? TK.diff.geaendert : undefined, aufKlick: fuegeAufgabenEin })];
      }
    } else if (z.leer) {
      mitte = [h("p", { klasse: "kit-text", "data-ki-text-meldung": "", text: TK.diff.nichtsGeaendert }), gesendet];
      fuss = [h("span", { klasse: "kit-abstand" }), neu, baueKnopf({ text: TK.schliessen, groesse: "s", variante: "primaer", aktion: "ki-text-schliessen", aufKlick: () => { schliesse(); ed.view.focus(); } })];
    } else {
      mitte = [wortDiffAnsicht(z.teile, { label: TK.diff.diffLabel }), ...warn, sperre, gesendet];
      fuss = [z.gesperrt ? neu : tasten, h("span", { klasse: "kit-abstand" }), verwerfen,
        baueKnopf({ text: TK.diff.uebernehmen, groesse: "s", variante: "primaer", aktion: "ki-text-uebernehmen", disabled: !!z.gesperrt, titel: z.gesperrt ? TK.diff.geaendert : undefined, aufKlick: uebernehmeErsatz })];
    }
    setze("ergebnis", [kopf(titelFuer(z.aktion, z.sprache), { marke: !!z.vorschau }), h("div", { klasse: "kit-mitte" }, mitte), h("div", { klasse: "kit-fuss" }, fuss)]);
  }

  // ---------- Ablauf ----------
  function oeffne({ anker = null, aktion = null, sprache = null } = {}) {
    if (z && z.phase !== "menu") return false; // ein Lauf oder Diff steht: erst entscheiden
    const snap = snapshot();
    if (!snap) return false;
    if (z) schliesse();
    gruendlich = false; // Standard ist das kleine Modell; „Gründlicher“ gilt nur für diese Anfrage
    z = { phase: "menu", snap, anker, seite: null, aktion: null, gesperrt: false };
    oeffnePop();
    const vorher = sig();
    frisch().then(() => { if (z?.phase === "menu" && vorher !== sig()) zeichne(); });
    zeichne();
    if (aktion && !grundGesamt(snap)) waehle(aktion, sprache);
    return true;
  }
  async function waehle(aktion, sprache = null) {
    if (!z || z.phase !== "menu" || z.startet) return;
    const mein = z;
    mein.startet = true; // ein Klick, ein Start (Doppelklick, Klick plus ⏎)
    await frisch(true);
    if (z !== mein) return;
    if (!st.sichtbar || st.gesperrt) { mein.startet = false; zeichne(); return; }
    if (!st.einwilligung) {
      // Die Einwilligung gilt je Vault für alle KI-Vorschläge; der Dialog nennt alles, was die Werkstatt anbietet
      const funktionen = (bereit?.funktionen || []).filter((f) => f === "zusammenfassung" || f === "posteingang" || f === "text");
      oeffneEinwilligung({ api, bereit, vault: S.info?.vault || "", vaultName: S.info?.name || "", funktionen: funktionen.length ? funktionen : ["text"],
        nachher: async () => { await frisch(true); if (z === mein && st.einwilligung) starte(aktion, sprache); else if (z === mein) mein.startet = false; }, beiAbbruch: () => { if (z === mein) { mein.startet = false; ed.view.focus(); } } });
      return;
    }
    starte(aktion, sprache);
  }
  async function starte(aktion, sprache) {
    const mein = z;
    if (!mein) return;
    // Die Werkstatt liest den Text aus der Datei: erst speichern
    if (S.dirty) { try { await speichereWarte?.(); } catch { /* unten geprüft */ } }
    if (z !== mein) return;
    const snap = mein.snap;
    if (S.dirty) { Object.assign(mein, { phase: "fehler", aktion, sprache, fehler: TK.grund.ungespeichert, startet: false }); zeichne(); return; }
    if (S.pfad !== snap.pfad || ed.view.state.sliceDoc(klemme(snap.von), klemme(snap.bis), snap.lb) !== snap.text) { schliesse(); return; }
    Object.assign(mein, { phase: "laeuft", aktion, sprache, start: Date.now(), gesendet: null, wirdAbgebrochen: false, gesperrt: false, gesperrtVorher: false, uebernimmt: false, beschaeftigt: false, funktion: aktion === "aufgaben" ? "aufgaben" : "ersatz", warnungen: [], vorschau: false });
    zeichne();
    clearInterval(uhr); uhr = setInterval(() => { const el = pop?.el.querySelector("[data-ki-text-zeit]"); if (el && z === mein && mein.phase === "laeuft" && mein.gesendet && !mein.wirdAbgebrochen) el.textContent = TK.lauf.zeit(Math.floor((Date.now() - mein.start) / 1000)); }, 1000);
    const l = lauf = starteVorschlag({ api, wiederholeBeiLaeuft: true,
      eingabe: { funktion: "text", aktion, ...(aktion === "uebersetzen" ? { sprache } : {}), pfad: snap.pfad, auswahl: snap.text, konto: st.konto.id, ...(gruendlich ? { modell: "mittel" } : {}) },
      beiStart: (s) => { if (z !== mein) return; mein.gesendet = s.gesendet; zeichne(); } });
    const fertig = (f) => { if (z !== mein) return; clearInterval(uhr); lauf = null; f(); zeichne(); };
    l.fertig.then(({ ergebnis }) => fertig(() => {
      if (ergebnis.abgebrochen) { schliesse(); return; }
      if (!ergebnis.ok) { Object.assign(mein, { phase: "fehler", fehler: ergebnis.fehler || TV.lauf.fehlerAllgemein, vorschau: ergebnis.vorschau === true }); return; }
      mein.vorschau = ergebnis.vorschau === true;
      if (ergebnis.funktion === "ersatz") {
        mein.funktion = "ersatz";
        mein.ersatz = L.mitZeilenende(ergebnis.ersatz, snap.lb);
        mein.teile = wortDiffAnzeige(snap.text, mein.ersatz);
        mein.leer = mein.ersatz === snap.text; // „keine Änderung“ nur bei exakt gleichen Zeichen; reine NFC/NFD-Unterschiede zeigt der Diff ohne Markierung
        mein.warnungen = Array.isArray(ergebnis.warnungen) ? ergebnis.warnungen : [];
      } else { mein.funktion = "aufgaben"; mein.aufgaben = Array.isArray(ergebnis.aufgaben) ? ergebnis.aufgaben : []; mein.warnungen = Array.isArray(ergebnis.warnungen) ? ergebnis.warnungen : []; }
      mein.phase = "ergebnis";
      if (mein.gesperrtVorher) mein.gesperrt = true;
    })).catch(async (err) => {
      fertig(() => { Object.assign(mein, { phase: "fehler", fehler: err?.message || TV.lauf.fehlerAllgemein }); });
      if (err?.daten?.art === "einwilligung" || err?.daten?.art === "einwilligung-konto") await frisch(true);
    });
  }
  function abbrechenUndZu() { if (z?.phase === "laeuft") { z.wirdAbgebrochen = true; const l = lauf; lauf = null; l?.abbrechen(); } schliesse(); ed.view.focus(); }
  function nochEinmal() {
    if (!z) return;
    // Gleiche Aktion auf dem Text, wie er jetzt markiert ist; ist nichts markiert (z. B. nach Tippen), gilt die nachgeführte Stelle
    let snap = snapshot();
    if (!snap) { const s = z.snap, st2 = ed.view.state; if (s.bis > s.von && s.bis <= st2.doc.length) snap = { von: s.von, bis: s.bis, text: st2.sliceDoc(s.von, s.bis, st2.lineBreak), lb: st2.lineBreak, pfad: S.pfad || "" }; }
    const { aktion, sprache } = z;
    if (!snap) { schliesse(); return; }
    const grund = grundGesamt(snap);
    if (grund) { z.fehler = grund; z.phase = "fehler"; zeichne(); return; }
    z = { phase: "menu", snap, anker: z.anker, seite: z.seite, aktion: null, gesperrt: false };
    starte(aktion, sprache);
  }

  // ---------- Übernehmen: genau eine Editor-Transaktion ----------
  function textNochDa() {
    const v = ed.view, s = z.snap;
    if (S.pfad !== s.pfad || !S.bearbeitbar || v.state.readOnly) return false;
    try { return s.bis <= v.state.doc.length && v.state.sliceDoc(s.von, s.bis, v.state.lineBreak) === s.text; } catch { return false; }
  }
  function uebernehmeErsatz() {
    if (!z || z.phase !== "ergebnis" || z.funktion !== "ersatz" || z.leer || z.gesperrt) return;
    if (!textNochDa()) { z.gesperrt = true; zeichne(); return; }
    const v = ed.view, s = z.snap, len = v.state.toText(z.ersatz).length;
    z.uebernimmt = true;
    v.dispatch({ changes: { from: s.von, to: s.bis, insert: z.ersatz }, selection: { anchor: s.von, head: s.von + len }, scrollIntoView: true, userEvent: "input.ki" });
    schliesse(); v.focus();
    toast(TK.diff.uebernommen, { ms: 5000 });
  }
  function fuegeAufgabenEin() {
    if (!z || z.phase !== "ergebnis" || z.funktion !== "aufgaben" || z.gesperrt || z.beschaeftigt || !z.aufgaben.length) return;
    if (!textNochDa()) { z.gesperrt = true; zeichne(); return; }
    const v = ed.view, s = z.snap;
    const { pos, einfuegen } = L.aufgabenEinfuegung(v.state.doc.toString(), s.bis, z.aufgaben);
    z.uebernimmt = true;
    v.dispatch({ changes: { from: pos, to: pos, insert: L.mitZeilenende(einfuegen, s.lb) }, selection: { anchor: s.von, head: s.bis }, scrollIntoView: true, userEvent: "input.ki" });
    schliesse(); v.focus();
    toast(TK.aufgaben.eingefuegt, { ms: 5000 });
  }
  // Über die Aufgaben-Liste des Vaults (/api/aufgaben): Kortex legt an, die Texte sind die geprüften der Werkstatt
  async function legeAufgabenAn() {
    if (!z || z.phase !== "ergebnis" || z.funktion !== "aufgaben" || z.beschaeftigt) return;
    const mein = z, liste = mein.aufgaben;
    mein.beschaeftigt = true; zeichne();
    let ok = 0;
    for (const a of liste) {
      try { await api.aufgabeNeu({ titel: a.text, ...(a.faellig ? { faellig: a.faellig } : {}) }); ok++; } catch { break; }
    }
    mein.beschaeftigt = false;
    mein.aufgaben = liste.slice(ok); // nach einem Teilfehler nur noch den Rest (kein doppeltes Anlegen)
    if (ok) nachAufgaben?.();
    if (z === mein) { if (ok === liste.length) { schliesse(); ed.view.focus(); } else zeichne(); }
    toast(ok === liste.length ? TK.aufgaben.angelegt(ok) : ok ? TK.aufgaben.teilweise(ok, liste.length) : TK.aufgaben.anlegenFehler, { fehler: ok !== liste.length, ms: ok === liste.length ? 5000 : 8000 });
  }

  // ---------- Editor meldet Änderungen ----------
  // Das Menü gilt nur für genau diese Auswahl; Lauf und Ergebnis nur für diesen Text: Änderungen im markierten Stück sperren „Übernehmen“, davor/danach schieben nur die Positionen.
  function beiUpdate(u) {
    if (!z) return;
    if (z.phase === "menu") { if (u.docChanged || (u.selectionSet && !(u.state.selection.main.from === z.snap.von && u.state.selection.main.to === z.snap.bis))) schliesse(); return; }
    if (!u.docChanged || z.uebernimmt) return;
    const s = z.snap;
    const beruehrt = u.changes.touchesRange(s.von, s.bis) !== false;
    s.von = u.changes.mapPos(s.von, 1); s.bis = Math.max(s.von, u.changes.mapPos(s.bis, -1));
    if (beruehrt) { z.gesperrt = true; z.gesperrtVorher = z.phase === "laeuft"; if (z.phase === "ergebnis") zeichne(); } else setzePos();
  }
  // Neue Notiz geladen (nicht „Live-Aktualisierung“ derselben): alles Gezeigte gehört zur alten
  function textGeladen({ behalte = false } = {}) { if (!behalte && z) schliesse(); }
  function vergessen() { schliesse(); bereit = null; st = kiStatus(null); geholt = 0; vaultMerk = null; ktVoll = false; }

  // ---------- Tastatur ----------
  function taste(e) {
    if (!z || !pop || dialogOffen() || e.isComposing || e.keyCode === 229) return;
    // Nur Tasten, die zu diesem Popover oder zur markierten Stelle gehören: ⏎/Esc in anderen Feldern oder an anderer Stelle der Notiz bleiben unberührt
    const t = e.target, sel = ed.view.state.selection.main;
    const imPop = pop.el.contains(t), imEd = ed.view.contentDOM.contains(t), lose = t === document.body || t === document.documentElement;
    const anDerStelle = z.phase === "menu" || (sel.from === z.snap.von && sel.to === z.snap.bis);
    if (!(imPop || lose || (imEd && (e.key === "Escape" || anDerStelle)))) return;
    if (imEd && e.key !== "Escape" && !anDerStelle) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (z.phase === "laeuft") abbrechenUndZu(); else { schliesse(); ed.view.focus(); } return; }
    const ohne = !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey;
    if (z.phase === "menu" && pop.knoepfe?.length) {
      const k = pop.knoepfe;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault(); e.stopPropagation();
        markiere(e.key === "ArrowDown" ? (idx + 1) % k.length : (idx - 1 + k.length) % k.length);
      } else if (e.key === "Enter" && ohne) { e.preventDefault(); e.stopPropagation(); if (idx >= 0) k[idx]?.click(); }
    } else if (z.phase === "ergebnis" && e.key === "Enter" && ohne) {
      if (e.target?.closest?.(".kit button, .kiv-paket")) return; // ein fokussierter Knopf bedient sich selbst
      e.preventDefault(); e.stopPropagation();
      if (z.funktion === "aufgaben") fuegeAufgabenEin(); else uebernehmeErsatz();
    }
  }

  // ---------- Einstiege ----------
  // Kontextmenü im Editor: auf der Auswahl ein Menü mit den KI-Aktionen (der Rest des Systemmenüs fehlt dann bewusst nicht: Ausschneiden, Kopieren, Einfügen stehen darunter)
  function kontextmenu(e) {
    if (!sichtbar()) return false;
    if (z && z.phase !== "menu") return false; // ein Lauf oder Diff steht: das Systemmenü bleibt
    const snap = snapshot();
    if (!snap) return false;
    const pos = ed.view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos === null || pos < snap.von || pos > snap.bis) return false;
    e.preventDefault();
    const ok = oeffne({ anker: { x: e.clientX, y: e.clientY } });
    if (ok && pop) {
      const fuss = h("div", { klasse: "kit-fuss", "data-ki-text-kontext": "" }, [["ausschneiden", "cut"], ["kopieren", "copy"], ["einfuegen", "paste"]].map(([k, befehl]) => baueKnopf({ text: TK.kontext[k], groesse: "s", variante: "leise", aktion: `ki-text-${k}`,
        aufKlick: async () => { const v = ed.view; v.focus(); schliesse(); let tat = false; try { tat = document.execCommand(befehl); } catch { /* unten */ } if (!tat && befehl === "paste") { try { const t = await navigator.clipboard.readText(); if (t) v.dispatch({ ...v.state.replaceSelection(t.replace(/\r\n|\r|\n/g, v.state.lineBreak)), userEvent: "input.paste" }); } catch { /* keine Erlaubnis */ } } } })));
      pop.kontextFuss = fuss; pop.el.append(fuss);
    }
    return true;
  }
  // Einträge für die Befehlspalette (⌘K), solange im Editor Text markiert ist: [Name, Kürzel, tun]
  function paletteBefehle() {
    if (!sichtbar()) return [];
    const snap = snapshot();
    if (!snap || grundGesamt(snap)) return [];
    const mit = (aktion, sprache) => () => { ed.view.focus(); setTimeout(() => oeffne({ aktion, sprache }), 0); };
    return [
      ...["umschreiben", "kuerzen", "aufgaben"].map((a) => [TK.palette(TK.aktionen[a].name), "", mit(a)]),
      ...L.SPRACHEN.map((s) => [TK.palette(TK.uebersetzenTitel(TK.sprachen[s])), "", mit("uebersetzen", s)]),
    ];
  }
  window.addEventListener("pagehide", () => { if (z?.phase === "laeuft") lauf?.abbrechen(); });

  return { sichtbar, leisteZustand, frisch, oeffne, schliesse, beiUpdate, textGeladen, kontextmenu, paletteBefehle, vergessen, istOffen: () => !!pop, _zustand: () => z };
}
