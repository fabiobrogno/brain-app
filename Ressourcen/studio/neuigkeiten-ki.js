// „Mit KI zusammenfassen“ unter der Karte „Was ist neu“ (K1, docs/plaene/ki-runde.md). Die KI schlägt nur vor: sie bekommt Titel, Art, Zeit und Zahlen (nie Inhalte), die Sätze erscheinen als Text
// mit Beleg-Chips (Klick öffnet die Notiz), und „In den Posteingang legen“ schreibt Kortex selbst über den gewohnten Weg (api.merken), nie die KI.
// Ablauf: kein Konto mit Stufe „lesen“ → kein Knopf · keine Einwilligung → Dialog (ki-vorschlag.js) · dann Lauf mit Fortschritt und Abbrechen · Ergebnis.
// Keine Layoutsprünge: der Bereich unter dem Knopf hat vom ersten Klick an eine feste Höhe (Fortschritt und Ergebnis teilen sie, ein langes Ergebnis scrollt darin) und liegt in einem eigenen,
// dauerhaften Knoten, den das Neuzeichnen der Karte nur umhängt, nie neu baut.
import { h, toast } from "./hilfen.js";
import { heuteIso, knopf as baueKnopf } from "./bausteine.js";
import { symbol } from "./symbole.js";
import { api } from "./api.js";
import { TN } from "./texte-erwaehnungen.js";
import { TV } from "./texte-ki-vorschlag.js";
import { kiStatus, oeffneEinwilligung, kontingentZeile, wasWirdGesendet, starteVorschlag } from "./ki-vorschlag.js";
import { baueMerkText } from "./ki-zusammenfassung-text.js";

const runden = (n) => Math.max(100, Math.round(n / 100) * 100);

// S: Zustand des Studios (S.info.vault, S.info.name) · oeffne(pfad): Notiz öffnen · daten(): aktuelle Antwort von /api/neuigkeiten · zeitText(iso): Anzeige des Zeitraums
export function erzeugeKiZusammenfassung({ S, oeffne, daten, zeitText }) {
  const wurzel = h("div", { klasse: "nk-fuss", "data-nk-fuss": "", hidden: true });
  const zeile = h("div", { klasse: "nk-ki-zeile", "data-nk-ki-zeile": "" });
  const panel = h("section", { klasse: "nk-kip", "data-nk-kip": "", "aria-label": TN.ki_zusammenfassen.panel, hidden: true });
  wurzel.append(zeile, panel);

  let bereit = null, st = kiStatus(null), sigZeile = "", ktVoll = false, knopfEl = null, ktZeile = null, prueft = false;
  let zustand = { phase: "ruhig" }, lauf = null, nr = 0, gesendetOffen = false, uhr = 0, vaultMerk = null;

  // ---------- Status (Konto, Einwilligung, Sperre) ----------
  async function frisch() {
    if (vaultMerk !== (S.info?.vault || null)) { vaultMerk = S.info?.vault || null; bereit = null; }
    try { bereit = await api.kiVorschlagBereit(); } catch { bereit = null; }
    st = kiStatus(bereit);
    zeichneZeile();
    return st;
  }
  const verfuegbar = () => st.sichtbar;
  function sperrGrund() {
    if (st.gesperrt) return TN.ki_zusammenfassen.gesperrt[st.gesperrt];
    if (daten()?.leer) return TN.ki_zusammenfassen.nichtsNeu;
    if (ktVoll) return TN.ki_zusammenfassen.kontingentVoll;
    return null;
  }

  // ---------- Zeile: Knopf + Kontingent (oder der Grund, warum er aus ist) ----------
  function zeichneZeile() {
    wurzel.hidden = !st.sichtbar;
    const grund = st.sichtbar ? sperrGrund() : null;
    const sig = JSON.stringify([st.sichtbar, st.gesperrt, st.konto?.id, st.konto?.abo, st.einwilligung, !!grund]);
    if (sig === sigZeile) { if (knopfEl) setzeSperre(); return; }
    sigZeile = sig;
    if (!st.sichtbar) { ktZeile?.stopp(); ktZeile = null; zeile.replaceChildren(); knopfEl = null; return; }
    knopfEl = baueKnopf({ text: TN.ki_zusammenfassen.knopf, groesse: "s", symbol: "funke", aktion: "nk-ki", aufKlick: () => klick() }); // ein gewöhnlicher Knopf wie „Gelesen“
    ktZeile?.stopp();
    const kz = ktZeile = kontingentZeile({ api, konto: st.konto.id, abo: st.konto.abo || null, beiAenderung: (z) => { ktVoll = !!z.voll; setzeSperre(); } });
    zeile.replaceChildren(knopfEl, h("span", { klasse: "nk-ki-grund", "data-nk-ki-grund": "", hidden: true }), kz.knoten);
    setzeSperre();
  }
  function setzeSperre() {
    if (!knopfEl) return;
    const grund = sperrGrund(), laeuft = zustand.phase === "laeuft";
    knopfEl.disabled = !!grund || laeuft;
    knopfEl.title = grund || "";
    const g = zeile.querySelector("[data-nk-ki-grund]"), k = zeile.querySelector("[data-kiv=kontingent]");
    if (g) { g.hidden = !grund; g.textContent = grund || ""; }
    if (k) k.hidden = !!grund && !ktVoll;
  }

  // ---------- Klick: Einwilligung → Lauf ----------
  async function klick() {
    if (zustand.phase === "laeuft" || prueft) return;
    prueft = true;
    try { await frisch(); } finally { prueft = false; }
    if (!st.sichtbar || sperrGrund()) return;
    if (!st.einwilligung) {
      // Die Einwilligung gilt je Vault für alle KI-Vorschläge, darum nennt der Dialog alles, was die Werkstatt anbietet
      const funktionen = (bereit?.funktionen || []).filter((f) => f === "zusammenfassung" || f === "posteingang" || f === "text" || f === "erwaehnungen");
      oeffneEinwilligung({ api, bereit, vault: S.info?.vault || "", vaultName: S.info?.name || "", funktionen: funktionen.length ? funktionen : ["zusammenfassung"], nachher: async () => { await frisch(); if (st.einwilligung && !sperrGrund()) starte(); } });
      return;
    }
    starte();
  }
  function starte() {
    const mein = ++nr, d = daten();
    lauf?.abbrechen();
    zustand = { phase: "laeuft", seit: d?.seit || null, start: Date.now(), gesendet: null, ausgenommen: 0, wirdAbgebrochen: false };
    zeichnePanel(); zeichneZeile();
    clearInterval(uhr); uhr = setInterval(() => { const z = panel.querySelector("[data-nk-kip-zeit]"); if (z && zustand.phase === "laeuft" && zustand.gesendet) z.textContent = TV.lauf.arbeitet(Math.floor((Date.now() - zustand.start) / 1000)); }, 1000);
    const l = starteVorschlag({ api, wiederholeBeiLaeuft: true, eingabe: { funktion: "zusammenfassung", konto: st.konto.id, ...(d?.seit ? { seit: d.seit } : {}) },
      beiStart: (s) => { if (mein !== nr) return; zustand.gesendet = s.gesendet; zustand.ausgenommen = s.ausgenommen || 0; zeichnePanel(); } });
    lauf = l;
    l.fertig.then(({ ergebnis }) => {
      if (mein !== nr) return;
      clearInterval(uhr);
      if (ergebnis.ok) zustand = { ...zustand, phase: "ergebnis", ergebnis };
      else if (ergebnis.abgebrochen) zustand = { ...zustand, phase: "abgebrochen" };
      else zustand = { ...zustand, phase: "fehler", text: ergebnis.fehler || TV.lauf.fehlerAllgemein, vorschau: ergebnis.vorschau === true };
      zeichnePanel(); zeichneZeile();
    }).catch(async (err) => {
      if (mein !== nr) return;
      clearInterval(uhr);
      zustand = { ...zustand, phase: "fehler", text: err?.message || TV.lauf.fehlerAllgemein };
      zeichnePanel(); zeichneZeile();
      if (err?.daten?.art === "einwilligung" || err?.daten?.art === "einwilligung-konto") await frisch(); // die Einwilligung ist weg: der nächste Klick fragt wieder
    });
  }
  function abbrechen() {
    if (zustand.phase !== "laeuft" || zustand.wirdAbgebrochen) return;
    zustand.wirdAbgebrochen = true; zeichnePanel();
    lauf?.abbrechen();
  }
  function schliesse() { nr++; clearInterval(uhr); zustand = { phase: "ruhig" }; panel.hidden = true; panel.replaceChildren(); zeichneZeile(); }

  // ---------- In den Posteingang legen (Kortex schreibt, nicht die KI) ----------
  async function ablegen(knopf) {
    const e = zustand.ergebnis;
    if (!e || zustand.abgelegt) return;
    const { titel, text } = baueMerkText(e, { seitText: zustand.seit ? zeitText(zustand.seit) : "", datum: heuteIso() });
    knopf.setAttribute("aria-busy", "true"); knopf.disabled = true;
    try {
      const r = await api.merken(text, titel);
      zustand.abgelegt = r?.pfad || true;
      toast(TN.ki_zusammenfassen.abgelegt, { aktion: r?.pfad ? { text: TN.ki_zusammenfassen.oeffnen, tun: () => oeffne(r.pfad) } : undefined, ms: 6000 });
    } catch (err) {
      toast(err?.message || TN.ki_zusammenfassen.ablegenFehler, { fehler: true });
      knopf.disabled = false;
    } finally { knopf.removeAttribute("aria-busy"); }
    zeichnePanel();
  }

  // ---------- Bereich unter dem Knopf ----------
  function zeichnePanel() {
    const p = zustand.phase;
    panel.hidden = p === "ruhig";
    if (p === "ruhig") { panel.replaceChildren(); return; }
    panel.dataset.phase = p;
    const marke = (p === "ergebnis" && zustand.ergebnis?.vorschau) || zustand.vorschau ? h("span", { klasse: "nk-kip-marke", "data-nk-kip-marke": "", text: TN.ki_zusammenfassen.vorschauMarke }) : null;
    const tokens = p === "ergebnis" ? Object.values(zustand.ergebnis?.tokens || {}).reduce((a, b) => a + (Number(b) || 0), 0) : 0;
    const kopf = h("div", { klasse: "nk-kip-kopf" }, h("span", { klasse: "nk-kip-titel", text: TN.ki_zusammenfassen.panel }), marke,
      tokens > 0 ? h("span", { klasse: "nk-kip-klein", "data-nk-kip-tokens": "", text: `~${runden(tokens).toLocaleString("de-DE")} Tokens` }) : null,
      p === "laeuft" ? null : h("button", { type: "button", klasse: "nk-kip-zu", "data-aktion": "nk-kip-zu", "aria-label": TN.ki_zusammenfassen.schliessen, title: TN.ki_zusammenfassen.schliessen, aufClick: schliesse }, symbol("schliessen", 12)));
    const gesendet = zustand.gesendet ? wasWirdGesendet({ gesendet: zustand.gesendet, ausgenommen: zustand.ausgenommen, offen: gesendetOffen, beiUmschalten: (auf) => { gesendetOffen = auf; } }) : null;
    let mitte, fuss = [];
    if (p === "laeuft") {
      mitte = h("div", { klasse: "nk-kip-lauf", role: "status" }, h("div", { klasse: "nk-kip-balken", "aria-hidden": "true" }, h("i")),
        h("p", { klasse: "nk-kip-text", "data-nk-kip-zeit": "", text: zustand.wirdAbgebrochen ? TN.ki_zusammenfassen.brichAb : zustand.gesendet ? TV.lauf.arbeitet(Math.floor((Date.now() - zustand.start) / 1000)) : TV.lauf.startet }), gesendet);
      fuss = [baueKnopf({ text: TV.lauf.abbrechen, groesse: "s", aktion: "nk-ki-abbrechen", disabled: zustand.wirdAbgebrochen, aufKlick: abbrechen })];
    } else if (p === "ergebnis") {
      const e = zustand.ergebnis;
      mitte = h("div", { klasse: "nk-kip-ergebnis" }, h("ol", { klasse: "nk-kip-saetze", "data-nk-kip-saetze": "" }, e.saetze.map((s, i) => h("li", { klasse: "nk-kip-satz", "data-nk-satz": String(i) },
        h("span", { klasse: "nk-kip-satz-text", text: s.text }),
        h("span", { klasse: "nk-kip-belege" }, s.belege.map((b) => h("button", { type: "button", klasse: "nk-beleg", "data-nk-beleg": b.pfad, title: `${TN.ki_zusammenfassen.belegOeffnen}: ${b.pfad}`, aufClick: () => oeffne(b.pfad) }, h("span", { text: b.titel }))))))),
        h("p", { klasse: "nk-kip-klein", text: TN.ki_zusammenfassen.pruefHinweis }), gesendet);
      fuss = [
        baueKnopf({ text: zustand.abgelegt ? TN.ki_zusammenfassen.imPosteingang : TN.ki_zusammenfassen.ablegen, groesse: "s", variante: zustand.abgelegt ? "sekundaer" : "primaer", symbol: zustand.abgelegt ? "haken" : "inbox", aktion: "nk-ki-ablegen", disabled: !!zustand.abgelegt, aufKlick: (ev) => ablegen(ev.currentTarget) }),
        baueKnopf({ text: TN.ki_zusammenfassen.neu, groesse: "s", variante: "leise", aktion: "nk-ki-neu", disabled: !!sperrGrund(), aufKlick: () => klick() }),
      ];
    } else {
      mitte = h("div", { klasse: "nk-kip-meldung", role: "status" }, h("p", { klasse: "nk-kip-text", "data-nk-kip-meldung": "", text: p === "abgebrochen" ? TV.lauf.abgebrochen : zustand.text }), gesendet);
      fuss = [baueKnopf({ text: TV.lauf.nochEinmal, groesse: "s", aktion: "nk-ki-neu", disabled: !!sperrGrund(), aufKlick: () => klick() })];
    }
    const flaeche = h("div", { klasse: "nk-kip-mitte", "aria-live": "polite", "data-nk-kip-mitte": "" }, mitte);
    // Weiches Ausblenden nur an den Rändern, hinter denen noch Inhalt liegt (kein angeschnittener Text am Rand, solange nichts zu scrollen ist)
    const raender = () => { flaeche.dataset.oben = flaeche.scrollTop > 2 ? "ja" : "nein"; flaeche.dataset.unten = flaeche.scrollHeight - flaeche.clientHeight - flaeche.scrollTop > 2 ? "ja" : "nein"; };
    flaeche.addEventListener("scroll", raender, { passive: true });
    panel.replaceChildren(kopf, flaeche, h("div", { klasse: "nk-kip-fuss" }, fuss));
    flaeche.scrollTop = 0; raender();
    if (typeof ResizeObserver === "function") new ResizeObserver(raender).observe(flaeche);
  }

  // Vault gewechselt oder Zeitraum geändert: ein laufender Lauf endet, alles Gezeigte gehört zum alten Stand
  function zuruecksetzen() { lauf?.abbrechen(); lauf = null; schliesse(); }
  function vergessen() { zuruecksetzen(); ktZeile?.stopp(); ktZeile = null; prueft = false; bereit = null; st = kiStatus(null); sigZeile = ""; ktVoll = false; knopfEl = null; vaultMerk = null; zeile.replaceChildren(); wurzel.hidden = true; gesendetOffen = false; }
  window.addEventListener("pagehide", () => { if (zustand.phase === "laeuft") lauf?.abbrechen(); });

  return { knoten: wurzel, laden: frisch, verfuegbar, aktualisiere: zeichneZeile, zuruecksetzen, vergessen, _zustand: () => zustand };
}
