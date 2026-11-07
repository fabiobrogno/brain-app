// Steuerungen der Seite „Einstellungen → Darstellung“: Erscheinungsbild-Karten mit Mini-Fenster, Farbschemata, Akzentfarben, Editor-Schrift, Schieber, Vorschaukarte.
// Eigene Bausteine, keine nativen Felder. Alles gilt sofort (die Seite ruft nach jeder Änderung `live(werte)`), Werte und Listen stehen in darstellung.js.
// Verhalten wie im freigegebenen Prototyp (kortex-design.html). Gebaut von einstellungen.js über `erzeugeDarstellung(hooks)`.
import { h } from "./hilfen.js";
import { symbol } from "./symbole.js";
import { segment, schieber, auswahl } from "./bausteine.js";
import { AKZENTE, SCHEMATA, EDITOR_SCHRIFTEN, CODE_SCHRIFTEN, BREITEN_NAMEN, OBERFLAECHEN, SCHRIFT_GROESSE, berechne, wert as wertOr, loesePalette, akzentFarbe, textAufAkzent } from "./darstellung.js";
import { TD } from "./texte-darstellung.js";

const systemDunkel = () => typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;

// Mini-Fenster: Seitenleiste links, Text rechts — in der Palette des Schemas (data-pal), Akzent vom Studio geerbt
const miniInnen = () => [
  h("span", { klasse: "dz-sb" }, h("b"), h("b", { klasse: "a" }), h("b"), h("b")),
  h("span", { klasse: "dz-ed" }, h("u", { klasse: "t" }), h("u"), h("u", { klasse: "s" }), h("u", { klasse: "l" }), h("u")),
];
const mini = (pal) => h("span", { klasse: "dz-mini", "data-pal": pal, "aria-hidden": "true" }, miniInnen());
const miniSystem = (hell, dunkel) => h("span", { klasse: "dz-mini dz-sys", "aria-hidden": "true" },
  h("span", { klasse: "dz-voll", "data-pal": dunkel }, miniInnen()), h("span", { klasse: "dz-mini dz-halb", "data-pal": hell }, miniInnen()));

function pfeilTasten(el, knoepfe, aktuellIndex, waehle) {
  el.addEventListener("keydown", (ev) => {
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key];
    if (!d) return;
    ev.preventDefault();
    const i = Math.max(0, aktuellIndex());
    const n = (i + d + knoepfe.length) % knoepfe.length;
    waehle(n); knoepfe[n].focus();
  });
}
const haken = () => h("span", { klasse: "dz-haken", "aria-hidden": "true" }, symbol("haken", 12));
const rollenFokus = (knoepfe, an) => knoepfe.forEach((b, i) => { b.setAttribute("aria-checked", String(i === an)); b.tabIndex = i === an || (an < 0 && i === 0) ? 0 : -1; });

export function erzeugeDarstellung({ wert, aendere, vorschau, mac }) {
  const live = new Set();
  const meldeLive = (werte) => live.forEach((f) => f(werte));
  const w = (k) => wertOr({ [k]: wert(k) }, k);

  // ---- Erscheinungsbild: Hell · Dunkel · Wie macOS (System)
  function erscheinung(z) {
    const k = z.schluessel;
    const def = [["hell", TD.hell, () => mini(`hell-${w("schemaHell")}`)], ["dunkel", TD.dunkel, () => mini(`dunkel-${w("schemaDunkel")}`)], ["system", mac ? TD.systemMac : TD.system, () => miniSystem(`hell-${w("schemaHell")}`, `dunkel-${w("schemaDunkel")}`)]];
    const bilder = def.map(() => h("span", { klasse: "dz-bild" }));
    const knoepfe = def.map(([id, name], i) => h("button", { type: "button", klasse: "dz-karte", role: "radio", "data-wert": id, "aria-checked": "false", aufClick: () => { aendere(k, id); } },
      bilder[i], h("span", { klasse: "dz-name" }, name, haken())));
    const el = h("div", { klasse: "dz-karten dz-drei", role: "radiogroup", "aria-label": z.titel, "data-schluessel": k }, knoepfe);
    const zeige = () => { def.forEach(([, , m], i) => bilder[i].replaceChildren(m())); rollenFokus(knoepfe, def.findIndex(([id]) => id === w(k))); };
    pfeilTasten(el, knoepfe, () => def.findIndex(([id]) => id === w(k)), (i) => aendere(k, def[i][0]));
    live.add(zeige); zeige();
    return { voll: el, reg: { setze: () => zeige() } };
  }

  // ---- Farbschema je Hell / Dunkel
  function schemata(z) {
    const k = z.schluessel, modus = z.modus, liste = SCHEMATA[modus];
    const knoepfe = liste.map(([id, name]) => h("button", { type: "button", klasse: "dz-karte", role: "radio", "data-wert": id, "aria-checked": "false", aufClick: () => aendere(k, id) }, mini(`${modus}-${id}`), h("span", { klasse: "dz-name" }, name, haken())));
    const el = h("div", { klasse: "dz-karten", style: `grid-template-columns: repeat(${liste.length}, minmax(0, 1fr))`, role: "radiogroup", "aria-label": z.titel, "data-schluessel": k }, knoepfe);
    const zeige = () => rollenFokus(knoepfe, liste.findIndex(([id]) => id === w(k)));
    pfeilTasten(el, knoepfe, () => liste.findIndex(([id]) => id === w(k)), (i) => aendere(k, liste[i][0]));
    live.add(zeige); zeige();
    return { voll: el, reg: { setze: () => zeige() } };
  }

  // ---- Akzentfarbe: neun Farbkreise, Name daneben
  function akzent(z) {
    const k = z.schluessel;
    const knoepfe = AKZENTE.map(([id, name]) => h("button", { type: "button", klasse: "dz-farbe", role: "radio", "data-wert": id, "aria-label": name, title: name, "aria-checked": "false", aufClick: () => aendere(k, id) }, symbol("haken", 14)));
    const nm = h("span", { klasse: "dz-lab" });
    const el = h("div", { klasse: "dz-farben", role: "radiogroup", "aria-label": z.titel, "data-schluessel": k }, knoepfe, nm);
    const zeige = () => {
      const modus = loesePalette({ erscheinung: w("erscheinung"), schemaHell: w("schemaHell"), schemaDunkel: w("schemaDunkel") }, systemDunkel()).modus;
      AKZENTE.forEach(([id], i) => { const c = akzentFarbe(id, modus); knoepfe[i].style.setProperty("--c", c); knoepfe[i].style.setProperty("--ct", textAufAkzent(c)); });
      const i = AKZENTE.findIndex(([id]) => id === w(k));
      rollenFokus(knoepfe, i); nm.textContent = AKZENTE[Math.max(0, i)][1];
    };
    pfeilTasten(el, knoepfe, () => AKZENTE.findIndex(([id]) => id === w(k)), (i) => aendere(k, AKZENTE[i][0]));
    live.add(zeige); zeige();
    return { voll: el, reg: { setze: () => zeige() } };
  }

  // ---- Editor-Schrift: Segment, jede Wahl in ihrer Schrift
  function schriftWahl(z) {
    const k = z.schluessel;
    const s = segment({ optionen: Object.entries(EDITOR_SCHRIFTEN).map(([id, f]) => ({ wert: id, text: f.name(mac) })), wert: w(k), label: z.titel, daten: { "data-schluessel": k }, aufAenderung: (v) => aendere(k, v) });
    s.querySelectorAll(".bs-seg").forEach((b) => { b.style.fontFamily = EDITOR_SCHRIFTEN[b.dataset.wert].stapel; });
    return { steuerung: s, reg: { setze: (v) => { s.value = v; } } };
  }
  // ---- Code-Schrift: Menü
  function codeWahl(z) {
    const k = z.schluessel;
    const a = auswahl({ optionen: Object.entries(CODE_SCHRIFTEN).map(([id, f]) => ({ wert: id, text: f.name(mac) })), wert: w(k), label: z.titel, daten: { "data-schluessel": k }, aufAenderung: (v) => aendere(k, v) });
    const wrap = h("span", { klasse: "dz-menue" }, a);
    let aktuell = w(k);
    return { steuerung: wrap, reg: { setze: (v) => { if (v !== aktuell) { aktuell = v; const neu = auswahl({ optionen: Object.entries(CODE_SCHRIFTEN).map(([id, f]) => ({ wert: id, text: f.name(mac) })), wert: v, label: z.titel, daten: { "data-schluessel": k }, aufAenderung: (x) => { aktuell = x; aendere(k, x); } }); wrap.replaceChildren(neu); } } } };
  }
  // ---- Schriftgröße im Editor: Schieber 12–22 pt
  function groesse(z) {
    const k = z.schluessel;
    const v = h("span", { klasse: "dz-wert" });
    const s = schieber({ min: SCHRIFT_GROESSE.min, max: SCHRIFT_GROESSE.max, wert: w(k), label: z.titel, daten: { "data-schluessel": k }, text: (x) => `${x} pt`,
      aufEingabe: (n) => { v.textContent = `${n} pt`; vorschau(k, n); }, aufAenderung: (n) => aendere(k, n) });
    v.textContent = `${w(k)} pt`;
    return { steuerung: h("span", { klasse: "dz-regler" }, h("span", { klasse: "dz-lab", style: "font-size:11px", "aria-hidden": "true", text: "A" }), s.el, h("span", { klasse: "dz-lab", style: "font-size:17px", "aria-hidden": "true", text: "A" }), v),
      reg: { setze: (n) => { s.setze(n); v.textContent = `${n} pt`; }, offen: () => document.activeElement === s.el } };
  }
  // ---- Dichte: Schieber mit fünf Stufen
  function dichte(z) {
    const k = z.schluessel;
    const s = schieber({ min: 0, max: 4, wert: w(k), label: z.titel, striche: true, daten: { "data-schluessel": k }, text: (x) => TD.dichteStufen[x], aufEingabe: (n) => vorschau(k, n), aufAenderung: (n) => aendere(k, n) });
    return { steuerung: h("span", { klasse: "dz-regler" }, h("span", { klasse: "dz-lab", text: TD.kompakt }), s.el, h("span", { klasse: "dz-lab", text: TD.luftig })),
      reg: { setze: (n) => s.setze(n), offen: () => document.activeElement === s.el } };
  }
  // ---- Größe der Oberfläche
  function oberflaeche(z) {
    const k = z.schluessel;
    const s = segment({ optionen: OBERFLAECHEN.map((u) => ({ wert: String(u), text: `${u} %` })), wert: String(w(k)), label: z.titel, daten: { "data-schluessel": k }, aufAenderung: (v) => aendere(k, Number(v)) });
    return { steuerung: s, reg: { setze: (v) => { s.value = String(v); } } };
  }
  // ---- Zeilenbreite
  function zeilenbreite(z) {
    const k = z.schluessel;
    const s = segment({ optionen: BREITEN_NAMEN.map(([id, name]) => ({ wert: id, text: name })), wert: w(k), label: z.titel, daten: { "data-schluessel": k }, aufAenderung: (v) => aendere(k, v) });
    return { steuerung: s, reg: { setze: (v) => { s.value = v; } } };
  }
  // ---- Symbole: einfarbig oder farbige Kacheln
  function symbole(z) {
    const k = z.schluessel;
    const kachel = h("span", { klasse: "dz-kachel", style: "--tint:#5e5ce6", "aria-hidden": "true" }, symbol("vault", 12));
    const s = segment({ optionen: [{ wert: "einfarbig", text: TD.einfarbig, symbol: "vault" }, { wert: "farbig", text: TD.farbig }], wert: w(k), label: z.titel, daten: { "data-schluessel": k }, aufAenderung: (v) => aendere(k, v) });
    s.querySelector('[data-wert="farbig"]')?.prepend(kachel);
    return { steuerung: s, reg: { setze: (v) => { s.value = v; } } };
  }

  // ---- Vorschaukarte oben: ein kleines Fenster in den gewählten Farben, Schrift, Dichte, Breite
  function vorschauKarte() {
    const zeilen = [["Posteingang", "inbox", "#0a84ff", true], ["Notizen", "notiz", "#8e8e93"], ["Aufgaben", "haken", "#30b350"], ["Verlauf", "uhr", "#bf5af2"]];
    const sb = h("div", { klasse: "dz-pv-s" }, h("div", { klasse: "dz-pv-ampel", "aria-hidden": "true" }, h("i"), h("i"), h("i")),
      zeilen.map(([n, sym, tint, a]) => h("div", { klasse: "dz-pv-i" + (a ? " a" : ""), style: `--tint:${tint}` }, h("span", { klasse: "dz-pv-gl" }, symbol(sym, 12)), h("span", { text: n }))));
    const ed = h("div", { klasse: "dz-pv-e" }, h("h4", { text: TD.vorschauTitel }), h("p", {}, TD.vorschauText1, h("a", { text: TD.vorschauLink }), TD.vorschauText2, h("code", { text: "brain frag" }), "."));
    const fenster = h("div", { klasse: "dz-pv-w" }, sb, ed);
    const el = h("div", { klasse: "dz-pv", "data-vorschau": "", "aria-hidden": "true" }, fenster);
    const zeige = (werte = {}) => {
      const p = berechne({ ...Object.fromEntries(Object.keys(werte).map((k) => [k, werte[k]])) }, { systemDunkel: systemDunkel(), mac });
      el.dataset.mode = p.modus === "hell" ? "light" : "dark";
      fenster.dataset.pal = p.pal;
      fenster.dataset.symbole = p.attribute["data-symbole"];
      fenster.dataset.glas = werte.seitenleisteDurchscheinend === false ? "aus" : "an";
      for (const k of ["--akzent", "--akzent-text", "--zeile", "--ed-zeilenabstand", "--schrift-text", "--editor-schrift", "--mono"]) fenster.style.setProperty(k, p.variablen[k]);
      const breite = p.variablen["--lesebreite-wahl"];
      fenster.style.setProperty("--pv-breite", breite === "none" ? "none" : `${Math.round(parseInt(breite, 10) * 0.46)}px`);
    };
    live.add(zeige);
    return { voll: el, zeige };
  }

  return { live, meldeLive, bauer: { erscheinung, schemata, akzent, schriftWahl, codeWahl, groesse, dichte, oberflaeche, zeilenbreite, symbole }, vorschauKarte };
}
