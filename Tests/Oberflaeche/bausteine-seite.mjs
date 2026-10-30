// Schaufenster aller Bausteine (Ressourcen/studio/bausteine.js) auf einer eigenen Testseite — ohne App und ohne Werkstatt.
// Der Dateiserver aus modul-seite.mjs liefert Ressourcen/studio; die Seite hängt unter /__bausteine.html.
export const BAUSTEIN_SEITE = `<!doctype html><html lang="de"><head><meta charset="utf-8">
<link rel="stylesheet" href="/studio.css"><link rel="stylesheet" href="/bausteine.css">
<style>
 body { overflow: auto; }
 #bs { padding: 28px 32px 40px; display: grid; gap: 22px; max-width: 880px; background: var(--papier); }
 .zeile { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
 h3 { margin: 0 0 8px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--text-3); }
 .breit { width: 300px; }
</style></head><body>
<div id="bs">
  <section><h3>Auswahl</h3><div class="zeile" id="s-auswahl"></div></section>
  <section><h3>Filter-Chips</h3><div class="zeile" id="s-chips"></div></section>
  <section><h3>Textfelder</h3><div class="zeile" id="s-felder"></div></section>
  <section><h3>Knöpfe</h3><div class="zeile" id="s-knoepfe"></div></section>
  <section><h3>Segment, Switch, Checkbox, Radio</h3><div class="zeile" id="s-schalter"></div></section>
  <section><h3>Datum, Tooltip, Toast</h3><div class="zeile" id="s-datum"></div></section>
</div>
<div id="dialog-host"></div><div id="menue-host"></div><div id="toast-host"></div>
<script type="module">
import * as B from "/bausteine.js";
import { h } from "/hilfen.js";
window.__B = B; window.__h = h; window.__ereignis = [];
const log = (n) => (w) => window.__ereignis.push([n, w]);
const $ = (id) => document.getElementById(id);

const ordner = [
  { wert: "00_inbox", text: "00_inbox", symbol: "inbox" }, { wert: "10_notizen", text: "10_notizen", symbol: "ordner" },
  { wert: "20_projekte", text: "20_projekte", symbol: "ordner" }, { wert: "09_wiki", text: "09_wiki", symbol: "buch" },
];
$("s-auswahl").append(
  B.auswahl({ optionen: ordner, wert: "10_notizen", label: "Ordner", aufAenderung: log("ordner"), daten: { "data-test": "ordner" } }),
  B.auswahl({ optionen: [{ wert: "claude", text: "Claude", logo: "claude" }, { wert: "gemini", text: "Gemini", logo: "gemini" }, { wert: "cursor", text: "Cursor", logo: "cursor" }], wert: "claude", label: "KI", groesse: "s", aufAenderung: log("ki"), daten: { "data-test": "ki" } }),
  B.auswahl({ optionen: ordner, wert: "", label: "Leer", platzhalter: "Wählen …", daten: { "data-test": "leer" } }),
);
$("s-chips").append(
  B.filterChip({ label: "Priorität", optionen: [{ wert: "alle", text: "Alle" }, { wert: "hoch", text: "Hoch" }, { wert: "normal", text: "Normal" }, { wert: "niedrig", text: "Niedrig" }], aufAenderung: log("prio"), daten: { "data-filter": "prio" } }),
  B.filterChip({ label: "Quelle", optionen: [{ wert: "alle", text: "Alle" }, { wert: "mensch", text: "Von mir" }, { wert: "ki", text: "Von einer KI" }], wert: "ki", aufAenderung: log("quelle"), daten: { "data-filter": "quelle" } }),
  B.filterChip({ label: "Fällig", optionen: [{ wert: "alle", text: "Alle" }, { wert: "heute", text: "Heute" }, { wert: "woche", text: "Diese Woche" }], aufAenderung: log("faellig"), daten: { "data-filter": "faellig" } }),
);
const f1 = B.textfeld({ label: "Name", platzhalter: "Name der Notiz", daten: { "data-test": "name" }, klasse: "breit", loeschbar: true });
const f2 = B.textfeld({ typ: "search", label: "Suche", platzhalter: "Suchen …", daten: { "data-test": "suche" }, klasse: "breit" });
const f3 = B.textfeld({ label: "Adresse", wert: "https://beispiel", daten: { "data-test": "adresse" }, klasse: "breit" });
f3.fehler("Das ist keine Git-Adresse.");
const f4 = B.textbereich({ label: "Gedanke", platzhalter: "Schreib los …", minZeilen: 2, maxZeilen: 6, daten: { "data-test": "bereich" } });
f4.el.classList.add("breit");
window.__felder = { f1, f2, f3, f4 };
$("s-felder").append(f1.el, f2.el, f3.el, f4.el);
const lade = B.knopf({ text: "Sichern", variante: "primaer", daten: { "data-test": "lade" }, aufKlick: () => window.__ereignis.push(["lade-klick"]) });
$("s-knoepfe").append(
  B.knopf({ text: "Primär", variante: "primaer", daten: { "data-test": "primaer" } }), B.knopf({ text: "Sekundär", daten: { "data-test": "sekundaer" } }),
  B.knopf({ text: "Leise", variante: "leise", daten: { "data-test": "leise" } }), B.knopf({ text: "Löschen", variante: "gefahr", daten: { "data-test": "gefahr" } }),
  B.knopf({ text: "Klein", groesse: "s", daten: { "data-test": "klein" } }), B.knopf({ symbol: "plus", label: "Hinzufügen", groesse: "s", variante: "leise" }), lade,
  B.knopf({ text: "Aus", daten: { "data-test": "aus", disabled: "" } }),
);
window.__lade = lade;
$("s-schalter").append(
  B.segment({ optionen: [{ wert: "liste", text: "Liste" }, { wert: "board", text: "Board" }, { wert: "kalender", text: "Kalender" }], wert: "liste", label: "Ansicht", aufAenderung: log("segment"), daten: { "data-test": "segment" } }),
  B.umschalter({ text: "Benachrichtigungen", an: false, aufAenderung: log("schalter"), daten: { "data-test": "schalter" } }),
  B.hakenFeld({ text: "Mit Anhängen", checked: true, daten: { "data-test": "haken" } }),
  B.hakenFeld({ typ: "radio", name: "r", text: "Eins", wert: "1", checked: true, daten: { "data-test": "radio1" } }),
  B.hakenFeld({ typ: "radio", name: "r", text: "Zwei", wert: "2", daten: { "data-test": "radio2" } }),
);
const tip = B.knopf({ text: "Mit Tooltip", groesse: "s", daten: { "data-test": "tipp" } });
B.tooltip(tip, "Das ist ein Tooltip", { verzoegerung: 120 });
$("s-datum").append(
  B.datumsauswahl({ label: "Fällig", aufAenderung: log("datum"), daten: { "data-test": "datum" } }), tip,
  B.knopf({ text: "Toast", groesse: "s", daten: { "data-test": "toast" }, aufKlick: () => B.toast("Gespeichert.") }),
);
window.__bereit = true;
</script></body></html>`;

export async function oeffneBausteine(page, basis) {
  await page.route(/\/__bausteine\.html$/, (route) => route.fulfill({ contentType: "text/html", body: BAUSTEIN_SEITE }));
  await page.goto(basis + "__bausteine.html");
  await page.waitForFunction(() => window.__bereit === true);
}
