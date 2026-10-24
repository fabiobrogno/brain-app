// Formatierung: Datum, Größe, Typ-Farben. Alles deutsch (Berliner Zeit der Anzeige = Zeit des Geräts).
import { ausTabelle } from "./hilfen.js";

const DE = "de-DE";
const fmtKurz = new Intl.DateTimeFormat(DE, { day: "numeric", month: "short", year: "numeric" });
const fmtLang = new Intl.DateTimeFormat(DE, { day: "numeric", month: "long", year: "numeric" });
const fmtZeit = new Intl.DateTimeFormat(DE, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function alsDatum(wert) {
  if (wert instanceof Date) return isNaN(wert) ? null : wert;
  if (typeof wert === "number") return new Date(wert);
  if (typeof wert !== "string" || !wert) return null;
  // reine Datumsangabe (JJJJ-MM-TT) lokal lesen, damit sie nicht um einen Tag springt
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(wert.trim());
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(wert);
  return isNaN(d) ? null : d;
}
export const istDatumText = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}.*)?$/.test(s.trim());
export const datumKurz = (w) => { const d = alsDatum(w); return d ? fmtKurz.format(d).replace(/\s+/g, " ") : ""; };
export const datumLang = (w) => { const d = alsDatum(w); return d ? fmtLang.format(d) : ""; };
export const datumZeit = (w) => { const d = alsDatum(w); return d ? fmtZeit.format(d) : ""; };

export function relativ(w) {
  const d = alsDatum(w);
  if (!d) return "";
  const min = Math.floor((Date.now() - d.getTime()) / 60000);
  if (min < 1) return "gerade eben";
  if (min < 60) return min === 1 ? "vor 1 Min" : `vor ${min} Min`;
  const std = Math.floor(min / 60);
  if (std < 24) return std === 1 ? "vor 1 Std" : `vor ${std} Std`;
  const tage = Math.floor(std / 24);
  if (tage === 1) return "gestern";
  if (tage < 14) return `vor ${tage} Tagen`;
  return datumKurz(d);
}

export function bytesText(n) {
  if (!Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toLocaleString(DE, { maximumFractionDigits: 1 })} KB`;
  return `${(n / 1024 / 1024).toLocaleString(DE, { maximumFractionDigits: 1 })} MB`;
}

// Typ-Farben: die Schnittstelle liefert #RRGGBB (oder einen Namen aus unserer ruhigen Palette). Alles andere – auch rgb(…), hsl(…)
// oder Text mit Anhang – gilt nicht und fällt auf die aus dem Namen abgeleitete Standardfarbe zurück.
const PALETTE = {
  blau: "#4a78e0", gruen: "#3a9a68", gelb: "#c99a1e", orange: "#d9772b", rot: "#cc5144", rosa: "#cf5f94",
  violett: "#7a5fd6", lila: "#7a5fd6", tuerkis: "#2a9ba8", grau: "#8b877f", braun: "#9a7350", indigo: "#5b4ed6",
};
const HEX6 = /^#[0-9a-fA-F]{6}$/;
export function typFarbe(f) {
  if (!f || typeof f !== "string") return null;
  const t = f.trim();
  if (HEX6.test(t)) return t;
  return ausTabelle(PALETTE, t.toLowerCase()) || null;
}
// Ableitung aus dem Namen, wenn die Schnittstelle keine Farbe liefert (stabil je Name)
export function farbeAusName(name) {
  const liste = Object.values(PALETTE);
  let s = 0;
  for (const z of String(name || "")) s = (s * 31 + z.codePointAt(0)) >>> 0;
  return liste[s % liste.length];
}
// CSS-Variablen für Karten, Chips und Zeilen eines Typs: direkt auf dem Element gesetzt, nie als zusammengesetzter Stil-Text aus Daten
export function setzeTypFarbe(el, typ) {
  const farbe = typFarbe(typ?.farbe) || (typ?.name ? farbeAusName(typ.name) : null);
  if (!farbe) return el;
  el.style.setProperty("--typ", farbe);
  el.style.setProperty("--typ-text", `color-mix(in srgb, ${farbe} 82%, light-dark(#000, #fff) 18%)`);
  return el;
}
// Symbolnamen der Schnittstelle auf vorhandene Symbole (Unbekanntes → notiz)
export const TYP_SYMBOLE = new Set(["buch", "zitat", "wuerfel", "rakete", "person", "waage", "notiz", "ordner", "thema"]);
export const typSymbol = (name) => (TYP_SYMBOLE.has(name) ? name : "notiz");

export function wortAnzahl(text) {
  const t = String(text || "").replace(/^---[\s\S]*?\n---\s*\n/, "").trim();
  return t ? t.split(/\s+/).length : 0;
}
export const pluralisiere = (n, eins, viele) => `${n} ${n === 1 ? eins : viele}`;
export function hexNachRgb(hex) { const m = /^#([0-9a-f]{6})$/i.exec(hex || ""); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null; }

// Anzeigenamen der bekannten Brain-Typen; sonst erster Buchstabe groß
const TYP_NAMEN = { thema: "Thema", quelle: "Quelle", entitaet: "Entität", projekt: "Projekt", person: "Person", entscheidung: "Entscheidung", vorschlag: "Vorschlag", ueberblick: "Überblick", notiz: "Notiz" };
export function typName(name) {
  const s = String(name || "");
  return ausTabelle(TYP_NAMEN, s.toLowerCase()) || (s ? s[0].toUpperCase() + s.slice(1) : s);
}

// Vorschautext für Karten: Markdown-Zeichen weg, Leerraum geglättet (reine Anzeige, ändert nie die Datei)
export function vorschauText(s) {
  return String(s || "")
    .replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[\[[^\]|]*\|([^\]]+)\]\]/g, "$1")
    .replace(/\[\[([^\]#|]+)(?:#[^\]]*)?\]\]/g, "$1")
    .replace(/^[ \t]{0,3}(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d+[.)][ \t]+)/gm, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?![\w*])/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ").trim();
}

// Textfarbe eines Typs (für Wikilinks im Editor): wie --typ-text der Karten
export function typTextFarbe(typ) {
  const farbe = typFarbe(typ?.farbe) || (typ?.name ? farbeAusName(typ.name) : null);
  return farbe ? `color-mix(in srgb, ${farbe} 82%, light-dark(#000, #fff) 18%)` : null;
}
