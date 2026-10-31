// Logos der KIs im Studio — aus dem KI-Katalog (ki-katalog.js, erzeugt aus Ressourcen/gemeinsam/ki-katalog.json und Ressourcen/logos).
// Keine Fremdbibliothek, kein Netz: jedes Logo ist als SVG-Text bzw. als eingebettetes PNG mitgeliefert (Herkunft und Lizenz je Datei:
// Ressourcen/logos/HERKUNFT.md). Die Marken gehören den jeweiligen Inhabern, Nutzung nur zur Kennzeichnung der Integration.
//
// Einheitliche Größe: jede SVG hat im Katalog eine eigene ANSICHT (viewBox), die um die Glyphe zentriert ist und deren Füllung im Quadrat nach
// der Tintendichte abgestuft ist (dichte Formen kleiner, luftige größer); PNGs sind beim Erzeugen so beschnitten und aufgefüllt. Die Form
// selbst wird nie verzerrt. Farbe (Feld modus): "einfarbig" = Textfarbe, "marke" = eine Markenfarbe (nur wenn sie auf Hell UND Dunkel mindestens
// 3:1 Kontrast hat), "bild" = die Farben der Datei. Dieselben Regeln gelten in der App (Sources/BrainCore/KILogoQuelle.swift).
//
// kiLogoMarkup("claude")  -> SVG-/IMG-Text (oder null, wenn es für diese KI kein Logo gibt)
// kiLogo("claude", 16)    -> <span class="ki-logo" data-ki-logo="claude" role="img" aria-label="Claude Code" title="Claude Code">…</span>
//   { dekorativ: true }   -> steht das Logo neben dem Namen, bekommt es aria-hidden statt role/aria-label (der Name wird nicht doppelt vorgelesen)
// Eine KI ohne echtes Logo bekommt die Initiale in einem neutralen Kreis; eine unbekannte KI (nicht im Katalog) liefert null: der Aufrufer behält sein Symbol.
import { KATALOG } from "./ki-katalog.js";

const NACH_ID = new Map(KATALOG.map((e) => [e.id, e]));
// Andere Namen derselben KI (Befehlsname der Erkennung)
const ALIAS = { "claude-code": "claude", "cursor-agent": "cursor" };

/** Alle KIs des Katalogs in Anzeige-Reihenfolge: { id, name, art, beliebt, verbindbar, website, logo }. */
export const kiKatalog = () => KATALOG;

export const kiLogoId = (id) => {
  const k = ALIAS[id] || id;
  return NACH_ID.has(k) ? k : null;
};

export const kiEintrag = (id) => NACH_ID.get(kiLogoId(id)) || null;

export const kiLogoName = (id) => kiEintrag(id)?.name ?? null;

// Name in Sätzen („Claude hat eine Aufgabe angelegt“): meist der Katalogname, bei Claude Code kurz „Claude“
const KURZ = { claude: "Claude" };
export const kiKurzname = (id) => { const e = kiEintrag(id); return e ? (KURZ[e.id] ?? e.name) : null; };

export function kiLogoMarkup(id, groesse = 16) {
  const logo = kiEintrag(id)?.logo;
  if (!logo) return null;
  // PNG: mehrfarbig unverändert als Bild; einfarbig (schwarz mit Alpha) als Maske, die in der Textfarbe gefüllt wird (hell wie dunkel lesbar)
  if (logo.bild && logo.modus === "einfarbig") return `<span class="ki-maske" style="--ki-maske:url(${logo.bild})" aria-hidden="true"></span>`;
  if (logo.bild) return `<img src="${logo.bild}" width="${groesse}" height="${groesse}" alt="" draggable="false">`;
  const fuellung = logo.modus === "bild" ? "" : ' fill="currentColor"';
  return logo.svg.replace(/^<svg/, `<svg width="${groesse}" height="${groesse}"${fuellung} focusable="false" aria-hidden="true"`);
}

export function kiLogo(id, groesse = 16, { dekorativ = false } = {}) {
  const e = kiEintrag(id);
  if (!e) return null;
  const el = document.createElement("span");
  el.className = `ki-logo ki-logo-${e.id}`;
  el.dataset.kiLogo = e.id;
  el.title = e.name;
  el.style.setProperty("--ki-logo-groesse", `${groesse}px`);
  if (e.logo?.modus === "marke") el.style.color = e.logo.farbe;
  if (dekorativ) el.setAttribute("aria-hidden", "true");
  else { el.setAttribute("role", "img"); el.setAttribute("aria-label", e.name); }
  const markup = kiLogoMarkup(e.id, groesse);
  if (markup) el.innerHTML = markup; // aus dem erzeugten Katalog (geprüft: keine Skripte, keine Verweise nach außen), keine Daten von außen
  else { el.classList.add("ki-logo-initiale"); el.dataset.initiale = e.name.slice(0, 1); }
  return el;
}
