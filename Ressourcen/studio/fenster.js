// Titelleiste der App-Fenster (Studio, Einstellungen, Assistent): Das Fenster hat keine eigene Titelleiste mehr, der Inhalt läuft darunter (fullSizeContentView),
// die Ampel sitzt in der Seitenleiste. `-webkit-app-region` gibt es in WKWebView nicht — darum meldet die Seite das Greifen der Kopfzeile selbst:
//   · Maustaste in einem leeren Teil der obersten Zeile → Aktion `fenster-ziehen` (die App lässt das Fenster mit der Maus folgen),
//   · Doppelklick dort → Aktion `fenster-zoom` (die App tut, was die Systemeinstellung für die Titelleiste sagt: Zoomen, Ablegen oder nichts).
// Die App setzt vor dem Laden zwei CSS-Variablen am <html>: `--ampel-platz` (Breite der Ampel samt Luft, links in der Seitenleiste freizuhalten) und
// `--ampel-hoehe` (Höhe der Kopfzeile, in der sie sitzt). Im Vollbild und im Browser sind beide 0 bzw. fehlen — dann tut dieses Modul nichts.
// In der Vorschau (`data-vorschau` am <html> = Text) zeigt die Kopfzeile eine schmale Plakette statt eines eigenen Streifens.
import { aktion } from "./api.js";

// Was in der Kopfzeile bedienbar ist, wird nie zum Griff: Knöpfe, Felder, Menüs, Dialoge, Griffe der Spaltenbreite, alles mit Zeigerhand; eigene Ausnahmen mit data-nicht-ziehen.
const BEDIENBAR = 'button, a, input, select, textarea, summary, label, [role="button"], [role="menuitem"], [role="tab"], [role="switch"], [role="checkbox"], [role="slider"], '
  + '[role="separator"], [role="dialog"]:not([data-einstellungen]), [role="menu"], [role="listbox"], [contenteditable="true"], [contenteditable=""], dialog, .cm-editor, .griff, [class*="schleier"], [data-nicht-ziehen]';

/** Höhe der Kopfzeile, in der die Ampel sitzt (0 = keine: Browser oder Vollbild). */
export function ampelHoehe() {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ampel-hoehe")) || 0;
}

/** Ist dies ein Mausdruck, der das Fenster greifen soll? (Reine Prüfung, auch für Tests.) */
export function istGriff(e) {
  if (e.button !== 0 || e.defaultPrevented) return false;
  const hoehe = ampelHoehe();
  if (!hoehe || e.clientY >= hoehe || e.clientY < 0) return false;
  const ziel = e.target;
  if (!(ziel instanceof Element) || ziel.closest(BEDIENBAR)) return false;
  return getComputedStyle(ziel).cursor !== "pointer"; // alles, was die Seite als anklickbar zeigt (z. B. Brotkrumen), bleibt klickbar
}

let eingebaut = false;
/** Baut das Greifen der Kopfzeile ein (einmal je Seite). */
export function installiereFensterKopf() {
  if (eingebaut) return;
  eingebaut = true;
  document.addEventListener("mousedown", (e) => {
    if (!istGriff(e)) return;
    e.preventDefault(); // keine Textauswahl, kein Fokuswechsel durch das Ziehen
    aktion(e.detail >= 2 ? "fenster-zoom" : "fenster-ziehen");
  });
}

/** Text der Vorschau-Plakette ("" = dies ist nicht die Vorschau). */
export const vorschauText = () => document.documentElement.dataset.vorschau || "";

/** Die schmale Plakette „Vorschau — nichts wird gespeichert“ für die Kopfzeile; null außerhalb der Vorschau. `fest`: schwebt oben rechts (Assistent). */
export function vorschauPille(fest = false) {
  const text = vorschauText();
  if (!text) return null;
  const el = document.createElement("span");
  el.className = "vorschau-pille" + (fest ? " fest" : "");
  el.setAttribute("role", "note");
  el.title = text;
  el.dataset.vorschauPille = "";
  const punkt = document.createElement("i");
  punkt.setAttribute("aria-hidden", "true");
  const t = document.createElement("span");
  t.textContent = text;
  el.append(punkt, t);
  return el;
}
