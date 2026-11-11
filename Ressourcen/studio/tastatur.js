// Tastatur (R4-3): alles ohne Maus, der Fokus ist immer zu sehen, Esc tut überall das Erwartbare.
// Drei kleine Bausteine, die app.js einhängt (eigenes Modul, damit die Pakete der Runde 4 sich nicht in app.js treten):
//  1. Fokus merken und zurückgeben (merkeFokus/gibFokus): ⌘J, ⇧⌘H, ⇧⌘B und andere Panels setzen den Fokus hinein und geben ihn beim Schließen an den Auslöser zurück.
//  2. Bereiche (F6 / ⇧F6): Seitenleiste → Liste → Editor → Info- oder Frag-Spalte, der Reihe nach, unsichtbare werden übersprungen.
//  3. Esc als EIN Stapel: Popover/Menü → Dialog (beide schließen sich selbst, zuerst) → Format-Leiste → Panel (Verlauf, Frag) → Suche → Textauswahl.
//     Jede Schicht sagt nur „bin ich offen“ und „zu“; der Stapel schließt genau die oberste und verbraucht die Taste.
import { dialogOffen } from "./hilfen.js";
import { popoverOffen } from "./popover.js";
import { menueOffen } from "./menue.js";

const FOKUSBAR = "button:not([disabled]), [href], input:not([disabled]):not([type=hidden]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])";
export const sichtbar = (el) => !!el && el.isConnected && !el.hidden && el.getClientRects().length > 0 && el.getBoundingClientRect().width > 1 && getComputedStyle(el).visibility !== "hidden" && !el.closest("[inert], [hidden]");

// ---------- 1. Fokus merken und zurückgeben
const gemerkt = new Map();
export function merkeFokus(schluessel) {
  const a = document.activeElement;
  if (a && a !== document.body && a !== document.documentElement) gemerkt.set(schluessel, a); else gemerkt.delete(schluessel);
}
// Gibt den gemerkten Fokus zurück (wenn das Element noch da und sichtbar ist), sonst an `ersatz`. → das fokussierte Element
export function gibFokus(schluessel, ersatz = null) {
  const a = gemerkt.get(schluessel);
  gemerkt.delete(schluessel);
  const ziel = sichtbar(a) ? a : ersatz;
  ziel?.focus?.({ preventScroll: true });
  return ziel || null;
}
// Fokussiert das erste Element, das zu `selektor` passt, sobald es da ist (Panels laden nach); gibt nach ca. 1,5 s auf. `inWurzel` begrenzt die Suche.
export function fokusSobald(selektor, inWurzel = document, { frist = 90, ersatz = null } = {}) {
  let n = 0;
  const lauf = () => {
    const el = inWurzel.querySelector(selektor);
    if (sichtbar(el)) { el.focus({ preventScroll: true }); return; }
    if (++n >= frist) { if (sichtbar(ersatz)) ersatz.focus({ preventScroll: true }); return; }
    requestAnimationFrame(lauf);
  };
  lauf();
}

// ---------- 2. Bereiche (F6)
// bereiche: [{ id, wurzel: () => Element|null, fokus?: () => void }] in Reihenfolge. Ohne `fokus` geht der Fokus auf das erste bedienbare Element der Wurzel.
export function erzeugeBereiche(bereiche) {
  const sichtbare = () => bereiche.filter((b) => sichtbar(b.wurzel()));
  const aktueller = (liste) => { const a = document.activeElement; return liste.findIndex((b) => b.wurzel()?.contains(a)); };
  const gehe = (b) => {
    if (b.fokus) { b.fokus(); return; }
    const w = b.wurzel();
    (w?.matches?.(FOKUSBAR) ? w : [...(w?.querySelectorAll(FOKUSBAR) || [])].find(sichtbar) || w)?.focus?.({ preventScroll: true });
  };
  const weiter = (richtung = 1) => {
    const liste = sichtbare();
    if (!liste.length) return null;
    const i = aktueller(liste);
    const ziel = liste[i < 0 ? (richtung > 0 ? 0 : liste.length - 1) : (i + richtung + liste.length) % liste.length];
    gehe(ziel);
    return ziel.id;
  };
  const geheZu = (id) => { const b = bereiche.find((x) => x.id === id); if (b) gehe(b); };
  return { weiter, gehe: geheZu, aktuell: () => { const l = sichtbare(); const i = aktueller(l); return i < 0 ? null : l[i].id; }, ids: () => sichtbare().map((b) => b.id) };
}

// ---------- 3. Esc-Stapel
// schichten: [{ id, offen: () => bool, zu: () => void }] von oben (zuerst) nach unten. `gesperrt()` → true: die Taste gehört gerade jemand anderem (Einrichtung, Einstellungen).
// Läuft in der Blasenphase am window: Felder, Popover, Dialoge und Panels mit eigenem Esc kommen vorher dran und verbrauchen die Taste (defaultPrevented / stopPropagation).
export function installiereEscStapel(schichten, { gesperrt = () => false } = {}) {
  const lauf = (e) => {
    if (e.key !== "Escape" || e.defaultPrevented || e.isComposing || e.repeat) return;
    if (gesperrt() || dialogOffen() || popoverOffen() || menueOffen()) return;
    for (const s of schichten) {
      if (!s.offen()) continue;
      e.preventDefault(); e.stopPropagation();
      s.zu();
      return;
    }
  };
  window.addEventListener("keydown", lauf);
  return { schichtenOffen: () => schichten.filter((s) => s.offen()).map((s) => s.id), entferne: () => window.removeEventListener("keydown", lauf) };
}
