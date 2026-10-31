// Das einzige Symbol-Set des Studios (16×16-Raster, Linie in currentColor, runde Enden und Ecken). Keine Fremdbibliothek, keine gemischten Quellen:
// Marken-Logos (GitHub, Claude, Cursor) stehen getrennt in marken.js und ki-logos.js.
// symbol("ordner", GROESSE.norm) liefert ein <svg>-Element; ein unbekannter Name liefert ein leeres svg.
//
// Einheitliche Maße: Die Strichstärke ist in jeder Größe gleich (1,5 px auf dem Bildschirm), darum wird sie aus der Größe zurückgerechnet.
// Größen nur aus dieser Tabelle nehmen: klein (12: Chevrons, Schließen), text (14: neben Text, Statusleiste, Menü),
// norm (16: Seitenleiste, Werkzeugleiste, Listen), gross (20: Karten, Kacheln), kachel (24: leere Zustände, Kopf einer Seite).
export const STRICH = 1.5;
export const GROESSE = Object.freeze({ klein: 12, text: 14, norm: 16, gross: 20, kachel: 24 });
const p = (d, extra = "") => `<path d="${d}" ${extra}/>`;
const c = (x, y, r, extra = "") => `<circle cx="${x}" cy="${y}" r="${r}" ${extra}/>`;
const voll = 'fill="currentColor" stroke="none"';
const punkt = (x, y, r = 1) => c(x, y, r, voll); // Punkt für Ausrufezeichen, Listen, Löcher

const FOLDER = "M2 4.5a1 1 0 011-1h3l1.3 1.5H13a1 1 0 011 1v6a1 1 0 01-1 1H3a1 1 0 01-1-1v-7.5z";
const WUERFEL = p("M8 1.8l5.5 3v6.4l-5.5 3-5.5-3V4.8z") + p("M2.5 4.8L8 7.8l5.5-3M8 7.8v6.4");
const KARTEN = "M3 3.5h4.2c.5 0 .8.3.8.8v8.7c0-.5-.4-.8-.8-.8H3zm10 0H8.8c-.5 0-.8.3-.8.8v8.7c0-.5.4-.8.8-.8H13z";

const ICONS = {
  inbox: p("M2.5 9.5l1.6-5a1 1 0 011-.7h5.8a1 1 0 011 .7l1.6 5v2.3a1 1 0 01-1 1H3.5a1 1 0 01-1-1V9.5zm0 0h3.2l.6 1.4h3.4l.6-1.4h3.2"),
  notiz: p("M4 2.5h5l3.5 3.5v7a1 1 0 01-1 1H4a1 1 0 01-1-1v-9.5a1 1 0 011-1z") + p("M9 2.5V6h3.5M5.5 8.5h5M5.5 11h3.2"),
  archiv: p("M2.5 3.5h11v3h-11z") + p("M3.5 6.5v6a1 1 0 001 1h7a1 1 0 001-1v-6M6.5 9h3"),
  filter: p("M2.5 3h11l-4.2 5v4.5l-2.6-1.5V8z"),
  ordner: p(FOLDER),
  "ordner-offen": p("M2.5 12.5v-8a1 1 0 011-1h2.8l1.2 1.4h5a1 1 0 011 1v1.6") + p("M2.5 12.5l1.7-5a1 1 0 01.95-.7h9.05a.6.6 0 01.57.8l-1.6 4.9a1 1 0 01-.95.7H2.5z"),
  "ordner-plus": p(FOLDER) + p("M8 7v3.4M6.3 8.7h3.4"),
  plus: p("M8 3.5v9M3.5 8h9"),
  suche: c(7, 7, 4.5) + p("M10.5 10.5L14 14"),
  sortierung: p("M4.5 3v10M2.5 11l2 2 2-2M9 4h4.5M9 7.5h3M9 11h1.6"),
  verlauf: p("M1.8 8h2.6l1.7-4.6 3.3 9.2L11.1 8h3.1"),
  stern: p("M8 2.2l1.7 3.6 3.9.5-2.9 2.7.8 3.9L8 10.9l-3.5 2 .8-3.9L2.4 6.3l3.9-.5z"),
  "stern-voll": p("M8 2.2l1.7 3.6 3.9.5-2.9 2.7.8 3.9L8 10.9l-3.5 2 .8-3.9L2.4 6.3l3.9-.5z", 'fill="currentColor"'),
  haken: p("M3.5 8.5l3 3 6-6.5"),
  "kreis-haken": c(8, 8, 5.8) + p("M5.5 8.2l1.8 1.8 3.2-3.4"),
  schliessen: p("M4 4l8 8M12 4l-8 8"),
  "chevron-rechts": p("M6 3.5l4.5 4.5L6 12.5"),
  "chevron-unten": p("M3.5 6l4.5 4.5L12.5 6"),
  "chevron-auf-ab": p("M5 6.3L8 3.5l3 2.8M5 9.7l3 2.8 3-2.8"),
  zahnrad: p("M6.9 1.8h2.2l.4 1.7c.4.1.8.3 1.1.6l1.6-.6 1.1 1.9-1.3 1.2c.1.4.1.8 0 1.2l1.3 1.2-1.1 1.9-1.6-.6c-.3.3-.7.5-1.1.6l-.4 1.7H6.9l-.4-1.7c-.4-.1-.8-.3-1.1-.6l-1.6.6-1.1-1.9 1.3-1.2a3.2 3.2 0 010-1.2L2.7 4.8l1.1-1.9 1.6.6c.3-.3.7-.5 1.1-.6z") + c(8, 8, 2),
  mond: p("M13 9.4A5.5 5.5 0 116.6 3a4.4 4.4 0 006.4 6.4z"),
  sonne: c(8, 8, 2.6) + p("M8 1.8v1.5M8 12.7v1.5M1.8 8h1.5M12.7 8h1.5M3.6 3.6l1 1M11.4 11.4l1 1M12.4 3.6l-1 1M4.6 11.4l-1 1"),
  zweig: c(4.5, 3.8, 1.6) + c(4.5, 12.2, 1.6) + c(11.5, 6, 1.6) + p("M4.5 5.4v5.2M11.5 7.6v.1c0 1.6-1.4 2.4-3.4 2.7-1.3.2-2.3.6-3 1.2"),
  wolke: p("M4.8 12.2a3 3 0 01-.4-5.97 4 4 0 017.7 1 2.5 2.5 0 01-.6 4.97z"),
  sync: p("M13 6.5A5 5 0 004.2 4.9M3 3v2.5h2.5M3 9.5A5 5 0 0011.8 11.1M13 13v-2.5h-2.5"),
  commit: c(8, 8, 2.4) + p("M1.8 8h3.8M10.4 8h3.8"),
  claude: p("M8 1.8v12.4M2.6 4.9l10.8 6.2M2.6 11.1L13.4 4.9M1.8 8h12.4"),
  herz: p("M8 13.5S2.5 10 2.5 6.2A2.9 2.9 0 018 5a2.9 2.9 0 015.5 1.2C13.5 10 8 13.5 8 13.5z"),
  schild: p("M8 2l5 1.8v3.8c0 3-2.1 5.2-5 6.4-2.9-1.2-5-3.4-5-6.4V3.8z") + p("M5.8 8l1.6 1.6 2.9-3"),
  link: p("M6.8 9.2a2.6 2.6 0 003.7 0l2-2a2.6 2.6 0 00-3.7-3.7l-.6.6M9.2 6.8a2.6 2.6 0 00-3.7 0l-2 2a2.6 2.6 0 003.7 3.7l.6-.6"),
  extern: p("M9 3h4v4M13 3L7.5 8.5M11.5 9.5v2.5a1 1 0 01-1 1h-6a1 1 0 01-1-1v-6a1 1 0 011-1H7"),
  gliederung: p("M6.3 4h7.2M6.3 8h7.2M6.3 12h7.2") + punkt(2.8, 4, 1) + punkt(2.8, 8, 1) + punkt(2.8, 12, 1),
  breite: p("M2.5 3v10M13.5 3v10M5.7 8h4.6M7.2 6.3L5.5 8l1.7 1.7M8.8 6.3L10.5 8 8.8 9.7"),
  code: p("M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5M9 3.5l-2 9"),
  eigenschaften: p("M3.5 3h9A1.5 1.5 0 0114 4.5v7a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7A1.5 1.5 0 013.5 3z") + p("M10 3v10"),
  seitenleiste: p("M3.5 3h9A1.5 1.5 0 0114 4.5v7a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7A1.5 1.5 0 013.5 3z") + p("M6 3v10"),
  vault: p("M3 3h10a1 1 0 011 1v7.5a1 1 0 01-1 1H3a1 1 0 01-1-1V4a1 1 0 011-1z") + p("M4.5 12.5v1M11.5 12.5v1") + c(8.4, 7.7, 1.9),
  frage: p("M3 3h10a1 1 0 011 1v6a1 1 0 01-1 1H8.8L5.6 13.8V11H3a1 1 0 01-1-1V4a1 1 0 011-1z") + p("M6.1 6.2h3.8M6.1 8.2h2.2"),
  funke: p("M7 2.2l1.2 3.4 3.4 1.2-3.4 1.2L7 11.4 5.8 8 2.4 6.8l3.4-1.2z") + p("M12.3 10.4v3M10.8 11.9h3"),
  warnung: p("M8 2.5l6 10.5H2z") + p("M8 6.4v3.2") + punkt(8, 11.7, .9),
  info: c(8, 8, 5.8) + p("M8 7.5v3.6") + punkt(8, 5.1, .9),
  sanduhr: p("M4.5 2.5h7M4.5 13.5h7M5 2.5c0 3 2.2 3.9 3 5.5.8-1.6 3-2.5 3-5.5M5 13.5c0-3 2.2-3.9 3-5.5.8 1.6 3 2.5 3 5.5"),
  balken: p("M3.5 13V8.5M8 13V3M12.5 13V6"),
  uhr: c(8, 8, 5.8) + p("M8 4.8V8l2.2 1.3"),
  rakete: p("M9.6 3.2c1.6-1 3.2-1.1 3.2-1.1s.1 1.6-1 3.2l-4 4.1-2.2-2.2z") + p("M5.2 8.4l-2-.4 1.6-2 1.8.2M7.6 10.8l.4 2 2-1.6-.2-1.8M4.3 11.7c-.8.5-1.1 1.7-1.1 2.1.5 0 1.6-.3 2.1-1.1"),
  buch: p(KARTEN),
  zitat: p("M5.8 4.5C4 4.8 3 6 3 8v3.5h3.3V8.3H4.4c0-1.3.6-2 1.4-2.2zM12.8 4.5C11 4.8 10 6 10 8v3.5h3.3V8.3h-1.9c0-1.3.6-2 1.4-2.2z"),
  wuerfel: WUERFEL,
  person: c(8, 5.5, 2.6) + p("M3 13.5c.4-2.6 2.4-4 5-4s4.6 1.4 5 4"),
  waage: p("M8 2.5v11M4.5 13.5h7M3 5.5h10M3 5.5L1.6 9.2a2 2 0 003.8 0zM13 5.5l-1.4 3.7a2 2 0 003.8 0z"),
  thema: p("M2.5 8.2V3.5h4.7l6.3 6.3a1 1 0 010 1.4l-3.3 3.3a1 1 0 01-1.4 0L2.5 8.2z") + punkt(5.6, 5.9, 1),
  kopieren: p("M5.5 5.5h7a1 1 0 011 1v7a1 1 0 01-1 1h-7a1 1 0 01-1-1v-7a1 1 0 011-1z") + p("M3.5 10.5H3a1 1 0 01-1-1v-7a1 1 0 011-1h7a1 1 0 011 1V3"),
  "pfeil-links": p("M13 8H3M7 4L3 8l4 4"),
  stecker: p("M6 2.5v3M10 2.5v3M4.5 5.5h7v2.2A3.5 3.5 0 018 11.2a3.5 3.5 0 01-3.5-3.5zM8 11.2v2.3"),
  vorlage: p("M4 2.5h8A1.5 1.5 0 0113.5 4v8a1.5 1.5 0 01-1.5 1.5H4A1.5 1.5 0 012.5 12V4A1.5 1.5 0 014 2.5z") + p("M2.5 6h11M6 6v7.5"),
  klonen: c(5, 4, 1.6) + c(11, 4, 1.6) + c(8, 12, 1.6) + p("M5 5.6v.8a2 2 0 002 2h2a2 2 0 002-2v-.8M8 8.4v2"),
  laptop: p("M3.5 4h9a1 1 0 011 1v5.5h-11V5a1 1 0 011-1zM1.5 12h13"),
  schloss: p("M4.5 7h7a1 1 0 011 1v4.5a1 1 0 01-1 1h-7a1 1 0 01-1-1V8a1 1 0 011-1zM5.5 7V5.3a2.5 2.5 0 015 0V7"),
  gehirn: p("M8 3.2v9.6M8 3.2a2.2 2.2 0 00-4.1 1A2.3 2.3 0 002.5 8a2.3 2.3 0 001.4 3.8A2.2 2.2 0 008 12.8M8 3.2a2.2 2.2 0 014.1 1A2.3 2.3 0 0113.5 8a2.3 2.3 0 01-1.4 3.8A2.2 2.2 0 018 12.8"),
  marke: p("M7.29 3.71H10.29a1.43 1.43 0 010 2.86H5.71a1.43 1.43 0 000 2.86h4.58a1.43 1.43 0 010 2.86H7.29"), // Windung der App (Entwurf 3 „Windung“, vereinfacht): eine durchgehende Linie in vier Bahnen
  punkt: c(8, 8, 3, voll),
  ansicht: p("M2 8s2.2-4.5 6-4.5S14 8 14 8s-2.2 4.5-6 4.5S2 8 2 8z") + c(8, 8, 1.8),
  laptop: p("M3.5 4.5a1 1 0 011-1h7a1 1 0 011 1v5.5h-9zM2 12h12") + p("M2 12l.5.8a1 1 0 00.9.5h9.2a1 1 0 00.9-.5L14 12"),
  telefon: `<rect x="4.5" y="1.8" width="7" height="12.4" rx="1.8"/>` + p("M7 12h2"),
  papierkorb: p("M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8a1 1 0 001 .9h3.8a1 1 0 001-.9l.6-8"),
  aufgaben: p("M2.5 4.4l1.2 1.2 2.1-2.4M2.5 10l1.2 1.2 2.1-2.4M8.5 4.6h5M8.5 10.2h5"),
  punkte: punkt(3.5, 8, 1.1) + punkt(8, 8, 1.1) + punkt(12.5, 8, 1.1),
  kalender: p("M3.5 3.5h9a1 1 0 011 1v8a1 1 0 01-1 1h-9a1 1 0 01-1-1v-8a1 1 0 011-1zM2.5 6.5h11M5.5 2v3M10.5 2v3"),
  stift: p("M10.5 3.2l2.3 2.3-7 7-2.8.5.5-2.8z"),
  "wolke-hoch": p("M4.8 12.2a3 3 0 01-.4-5.97 4 4 0 017.7 1 2.5 2.5 0 01-.6 4.97z") + p("M8 11V7.2M6.3 8.9L8 7.2l1.7 1.7"),
  "wolke-runter": p("M4.8 12.2a3 3 0 01-.4-5.97 4 4 0 017.7 1 2.5 2.5 0 01-.6 4.97z") + p("M8 7.2V11M6.3 9.3L8 11l1.7-1.7"),
  "wolke-aus": p("M4.8 12.2a3 3 0 01-.4-5.97 4 4 0 017.7 1 2.5 2.5 0 01-.6 4.97z") + p("M2.5 2.5l11 11"),
  "ansicht-zeilen": p("M3 4.5h10M3 8h10M3 11.5h10"),
  "ansicht-spalten": p("M3.5 3h9a1 1 0 011 1v8a1 1 0 01-1 1h-9a1 1 0 01-1-1V4a1 1 0 011-1z") + p("M8 3v10"),
  pfeil: p("M3 8h10M9 4l4 4-4 4"),
  "pfeil-oben": p("M8 13V3M4 7l4-4 4 4"),
  "pfeil-unten": p("M8 3v10M4 9l4 4 4-4"),
  // Einstellungen (P5): Bereiche der Seitenleiste
  glocke: p("M3.8 11.2c.9-.8 1.2-1.8 1.2-3.2V6.6a3 3 0 016 0V8c0 1.4.3 2.4 1.2 3.2zM6.6 13.4a1.5 1.5 0 002.8 0"),
  handy: p("M5 2h6a1 1 0 011 1v10a1 1 0 01-1 1H5a1 1 0 01-1-1V3a1 1 0 011-1z") + p("M7 12h2"),
  zuruecksetzen: p("M3.2 8.2A4.8 4.8 0 108 3.2H5.2") + p("M7 1.2L5 3.2l2 2"),
  tastatur: p("M2.5 4.5h11a1 1 0 011 1v5a1 1 0 01-1 1h-11a1 1 0 01-1-1v-5a1 1 0 011-1z") + p("M4.5 7h.01M7 7h.01M9.5 7h.01M12 7h.01M5 9.5h6"),
};

export const symbolNamen = Object.keys(ICONS);

export function symbol(name, groesse = GROESSE.norm) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", String(groesse));
  svg.setAttribute("height", String(groesse));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", String(Math.round((STRICH * 16 / groesse) * 1000) / 1000)); // gleiche Strichstärke in jeder Größe
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("sym");
  const markup = ICONS[name];
  if (markup) svg.innerHTML = markup;
  return svg;
}
