// Ansichten für „Nichts geht verloren“ (alles ohne innerHTML, Zeilen-Vergleich und Wort-Markierung kommen aus der Konflikt-Ansicht, konflikt.js):
//  · baueKonfliktAnsicht — kompakt im Banner-Bereich über dem Editor: die Stellen, an denen du und ein anderes Programm dasselbe geändert habt, je Stelle
//    Meine / Andere / Beide / Zusammenführen (Drei-Wege-Zusammenführung, Daten vom Server: gemeinsam/merge3.mjs)
//  · baueVergleich — zwei Texte untereinander verglichen (Entwurf ↔ gespeicherte Fassung)
import { h } from "./hilfen.js";
import { knopf as baueKnopf, textbereich } from "./bausteine.js";
import { zeilenAbschnitte, zeilenPaare, zeileEl, parseZeile } from "./konflikt.js";
import { TN } from "./texte-fremd.js";

const ohneCR = (z) => String(z).replace(/\r?\n$/, "").replace(/\r$/, ""); // Zeilenende der Werkstatt-Zeilen (\n, \r\n) abschneiden: angezeigt wird nur der Text
const zeilenVon = (t) => String(t ?? "").replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
const KONTEXT = 2;       // so viele unveränderte Zeilen vor und nach einer Stelle
const MAX_VERGLEICH = 4000;

// Eine Spalte aus Zeilen: wie in der Konflikt-Ansicht (Überschriften, Listen, Kästchen), leere Seite als „(nichts)“
function spalte(zeilen, wortSet) {
  if (!zeilen.length) return [h("span", { klasse: "fr-nichts", text: TN.konflikt.leer })];
  return zeilen.map((z, i) => zeileEl(parseZeile(ohneCR(z)), wortSet?.[i] ?? null, false));
}
// Zwei Seiten einer Stelle nebeneinander: Zeilen derselben Position, die sich ähneln, werden Wort für Wort markiert (zeilenPaare)
function zweiSpalten(links, rechts) {
  const reihen = zeilenPaare({ mac: links.map(ohneCR), anderes: rechts.map(ohneCR) });
  const l = h("div", { klasse: "fr-spalte l" }), r = h("div", { klasse: "fr-spalte r" });
  if (!reihen.length) { l.append(...spalte([])); r.append(...spalte([])); return [l, r]; }
  for (const z of reihen) {
    l.append(z.l ? h("div", { klasse: "fr-z" }, zeileEl(z.l, z.ml, z.boxD)) : h("div", { klasse: "fr-z fr-luecke" }));
    r.append(z.r ? h("div", { klasse: "fr-z" }, zeileEl(z.r, z.mr, z.boxD)) : h("div", { klasse: "fr-z fr-luecke" }));
  }
  return [l, r];
}
const kontext = (zeilen) => zeilen.length ? h("div", { klasse: "fr-kontext" }, zeilen.map((z) => h("div", { text: ohneCR(z) || " " }))) : null;
const kontextAn = (w, zeilen) => { const k = kontext(zeilen); if (k) w.append(k); };

// teile: Abschnitte vom Server ({t:"gleich"|"auto", z} | {t:"konflikt", meine, andere}); quelle: Name der anderen Seite.
// beiFertig(auswahl: ["meine"|"andere"|"beide"|{text}]) · beiSpaeter()
export function baueKonfliktAnsicht({ teile, quelle, beiFertig, beiSpaeter }) {
  const bloecke = [];
  teile.forEach((t, i) => { if (t.t === "konflikt") bloecke.push({ i, t }); });
  const auto = teile.filter((t) => t.t === "auto").length;
  const wahl = new Array(bloecke.length).fill(null);
  const eigen = bloecke.map((b) => ({ text: [...b.t.meine, ...b.t.andere].map(ohneCR).join("\n"), offen: false }));
  // Text für die Werkstatt (gilt dort wörtlich): Das Eingabefeld zeigt Zeilen ohne Zeilenende; hier bekommen sie es zurück — \r\n in einer CRLF-Datei, sonst \n.
  // Die letzte Zeile bekommt es, wenn der Block nicht das Dateiende ist oder seine Zeilen vorher schon eines hatten.
  const textFuerWerkstatt = (k) => {
    const t = eigen[k].text;
    if (t === "") return "";
    const orig = [...bloecke[k].t.meine, ...bloecke[k].t.andere];
    const crlf = teile.some((x) => (x.z || [...(x.meine || []), ...(x.andere || [])]).some((z) => /\r\n$/.test(String(z))));
    const eol = crlf ? "\r\n" : "\n";
    const amEnde = bloecke[k].i === teile.length - 1, letzteMitUmbruch = /\n$/.test(String(orig[orig.length - 1] ?? ""));
    return t.split("\n").map((x, i, alle) => x + (i < alle.length - 1 || !amEnde || letzteMitUmbruch ? eol : "")).join("");
  };
  const wurzel = h("section", { klasse: "fr-konflikt", "data-banner": "fremd-konflikt", role: "region", "aria-label": TN.konflikt.titel(quelle) });
  const kopf = h("div", { klasse: "fr-kopf" },
    h("div", { klasse: "b-text" }, h("div", { klasse: "b-titel", text: TN.konflikt.titel(quelle) }), h("div", { klasse: "b-sub", text: TN.konflikt.text(bloecke.length, auto) })));
  const liste = h("div", { klasse: "fr-bloecke" });
  const fuss = h("div", { klasse: "fr-fuss" });
  const status = h("span", { klasse: "fr-status", role: "status" });
  const speichern = baueKnopf({ text: TN.konflikt.speichern, variante: "primaer", aktion: "fremd-speichern", aufKlick: () => { if (!wahl.includes(null)) beiFertig(wahl.map((w, k) => (w === "text" ? { text: textFuerWerkstatt(k) } : w))); } });
  const spaeter = baueKnopf({ text: TN.konflikt.spaeter, aktion: "fremd-spaeter", aufKlick: () => beiSpaeter?.() });
  const karten = [];

  const gewaehltText = (k) => (wahl[k] ? TN.konflikt.gewaehlt[wahl[k]] : "");
  function aktualisiere() {
    const offen = wahl.filter((w) => w === null).length;
    status.textContent = offen ? TN.konflikt.offen(offen) : "";
    speichern.disabled = offen > 0;
    karten.forEach((k, idx) => {
      for (const [art, b] of Object.entries(k.knoepfe)) b.setAttribute("aria-pressed", String(wahl[idx] === art));
      k.stand.textContent = gewaehltText(idx);
      k.karte.dataset.gewaehlt = wahl[idx] || "";
      k.eigenBox.hidden = !eigen[idx].offen;
    });
  }
  bloecke.forEach((b, k) => {
    const davor = teile[b.i - 1], danach = teile[b.i + 1];
    const [l, r] = zweiSpalten(b.t.meine, b.t.andere);
    const knoepfe = {};
    const mache = (art, text) => { knoepfe[art] = baueKnopf({ text, groesse: "s", aktion: `fremd-${art}`, daten: { "data-block": String(k) }, aufKlick: () => { wahl[k] = art; eigen[k].offen = false; aktualisiere(); } }); return knoepfe[art]; };
    const zus = baueKnopf({ text: TN.konflikt.zusammen, groesse: "s", aktion: "fremd-zusammen", daten: { "data-block": String(k) }, aufKlick: () => { eigen[k].offen = true; wahl[k] = null; aktualisiere(); ta.fokus(); } });
    knoepfe.text = zus;
    const ta = textbereich({ wert: eigen[k].text, label: TN.konflikt.eigenTitel, minZeilen: 3, maxZeilen: 10, daten: { "data-feld": "fremd-text" }, beiEingabe: (v) => { eigen[k].text = v; } });
    const uebernehmen = baueKnopf({ text: TN.konflikt.eigenUebernehmen, variante: "primaer", groesse: "s", aktion: "fremd-eigen-ok", aufKlick: () => { eigen[k].text = ta.textarea.value; wahl[k] = "text"; eigen[k].offen = false; aktualisiere(); } });
    const zurueck = baueKnopf({ text: TN.konflikt.eigenAbbrechen, groesse: "s", aktion: "fremd-eigen-zurueck", aufKlick: () => { eigen[k].offen = false; aktualisiere(); } });
    const eigenBox = h("div", { klasse: "fr-eigen", hidden: true }, h("div", { klasse: "fr-eigen-titel", text: TN.konflikt.eigenTitel }), ta.el, h("div", { klasse: "fr-eigen-akt" }, zurueck, uebernehmen));
    const stand = h("span", { klasse: "fr-gewaehlt", role: "status" });
    const karte = h("div", { klasse: "fr-block", "data-block": String(k) },
      h("div", { klasse: "fr-block-kopf" }, h("b", { text: TN.konflikt.stelle(k + 1, bloecke.length) }), stand),
      davor && davor.z ? kontext(davor.z.slice(-KONTEXT)) : null,
      h("div", { klasse: "fr-zwei" },
        h("div", { klasse: "fr-titel l", text: TN.konflikt.meineTitel }), h("div", { klasse: "fr-titel r", text: TN.konflikt.andereTitel(quelle) }), l, r),
      danach && danach.z ? kontext(danach.z.slice(0, KONTEXT)) : null,
      h("div", { klasse: "fr-akt" }, mache("meine", TN.konflikt.meine), mache("andere", TN.konflikt.andere), mache("beide", TN.konflikt.beide), zus),
      eigenBox);
    karten.push({ karte, knoepfe, stand, eigenBox });
    liste.append(karte);
  });
  fuss.append(status, h("span", { klasse: "fr-fuss-abstand" }), spaeter, speichern);
  const alle = bloecke.length > 1 ? h("div", { klasse: "fr-alle" }, h("span", { text: "Alle:" }),
    ...["meine", "andere", "beide"].map((art) => baueKnopf({ text: TN.konflikt[art], groesse: "s", variante: "leise", aktion: `fremd-alle-${art}`, aufKlick: () => { wahl.fill(art); eigen.forEach((e) => { e.offen = false; }); aktualisiere(); } }))) : null;
  wurzel.append(...[kopf, alle, liste, h("p", { klasse: "fr-hinweis leise", text: TN.konflikt.hinweisGesperrt }), fuss].filter(Boolean));
  aktualisiere();
  return { el: wurzel, fokus: () => karten[0]?.knoepfe.meine.focus() };
}

// Zwei Texte vergleichen (links: Platte, rechts: Entwurf). Gleiche Zeilen werden bis auf zwei am Rand eingeklappt.
export function baueVergleich(links, rechts, { linksTitel, rechtsTitel } = {}) {
  const a = zeilenVon(links), b = zeilenVon(rechts);
  const wurzel = h("div", { klasse: "fr-vergleich", "data-vergleich": "" });
  if (a.length > MAX_VERGLEICH || b.length > MAX_VERGLEICH) { wurzel.append(h("p", { klasse: "leise", text: `${a.length} ↔ ${b.length} Zeilen` })); return wurzel; }
  const segs = zeilenAbschnitte(a, b);
  if (!segs.some((s) => s.t === "block")) { wurzel.append(h("p", { klasse: "leise", text: TN.entwurf.gleich })); return wurzel; }
  wurzel.append(h("div", { klasse: "fr-zwei" }, h("div", { klasse: "fr-titel l", text: linksTitel || "" }), h("div", { klasse: "fr-titel r", text: rechtsTitel || "" })));
  segs.forEach((s, i) => {
    if (s.t === "same") {
      const erste = i === 0, letzte = i === segs.length - 1;
      const n = s.z.length;
      if (n <= KONTEXT * 2 + 1) { kontextAn(wurzel, s.z); return; }
      if (!erste) kontextAn(wurzel, s.z.slice(0, KONTEXT));
      wurzel.append(h("div", { klasse: "fr-gleich", text: `… ${n - (erste ? 0 : KONTEXT) - (letzte ? 0 : KONTEXT)} gleiche Zeilen …` }));
      if (!letzte) kontextAn(wurzel, s.z.slice(-KONTEXT));
      return;
    }
    const [l, r] = zweiSpalten(s.mac, s.anderes);
    wurzel.append(h("div", { klasse: "fr-zwei fr-stelle" }, l, r));
  });
  return wurzel;
}
