// ERZEUGT von scripts/erzeuge-symbole.mjs — nicht von Hand ändern (Tests/Node/symbole.test.mjs prüft es).
// Das einzige Symbol-Set des Studios: Lucide 1.69.0 (ISC-Lizenz, siehe THIRD-PARTY-NOTICES.md), 24×24-Raster, Linie in currentColor,
// runde Enden und Ecken. Die Pfade stehen hier direkt; zur Laufzeit wird nichts geladen. Eigene Zeichen: die Windung der App ("marke") und die Spirale ("kortex-spirale").
// Marken-Logos (GitHub, Claude, Cursor) stehen getrennt in marken.js und ki-logos.js.
// symbol("ordner", GROESSE.norm) liefert ein <svg>-Element; ein unbekannter Name liefert ein leeres svg.
// Der Aufrufer ändert sich nicht: die Namen sind die bisherigen Kortex-Namen, die Zuordnung zu Lucide steht in der Erzeugung.
//
// Einheitliche Maße: Die Strichstärke ist in jeder Größe dieselbe Zahl Bildschirm-Pixel (strichPx): 1,5 px bis 16 px Größe, 1,75 px ab 18 px.
// Größen nur aus dieser Tabelle nehmen: klein (12: Chevrons, Schließen), text (14: neben Text, Statusleiste, Menü),
// norm (16: Seitenleiste, Werkzeugleiste, Listen), mittel (18), gross (20: Karten, Kacheln), kachel (24: leere Zustände, Kopf einer Seite).
// Einfärben: ein Symbol erbt die Textfarbe (currentColor). symbol(name, größe, { farbe }) setzt sie für dieses eine Symbol (Grundlage für spätere Farbkacheln).
export const GROESSE = Object.freeze({ klein: 12, text: 14, norm: 16, mittel: 18, gross: 20, kachel: 24 });
export const RASTER = 24;
export const strichPx = (groesse) => (groesse >= 18 ? 1.75 : 1.5);
export const STRICH = strichPx(GROESSE.norm); // Strichstärke der üblichen Größen (≤ 16 px)

const ICONS = {
  vault: "<rect width=\"8\" height=\"18\" x=\"3\" y=\"3\" rx=\"1\"/><path d=\"M7 3v18\"/><path d=\"M20.4 18.9c.2.5-.1 1.1-.6 1.3l-1.9.7c-.5.2-1.1-.1-1.3-.6L11.1 5.1c-.2-.5.1-1.1.6-1.3l1.9-.7c.5-.2 1.1.1 1.3.6Z\"/>",
  frage: "<path d=\"M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719\"/><path d=\"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3\"/><path d=\"M12 17h.01\"/>",
  buch: "<path d=\"M12 5v16\"/><path d=\"M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z\"/>",
  funke: "<path d=\"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z\"/><path d=\"M20 2v4\"/><path d=\"M22 4h-4\"/><circle cx=\"4\" cy=\"20\" r=\"2\"/>",
  verlauf: "<path d=\"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8\"/><path d=\"M3 3v5h5\"/><path d=\"M12 7v5l4 2\"/>",
  darstellung: "<path d=\"M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z\"/><circle cx=\"13.5\" cy=\"6.5\" r=\".5\" fill=\"currentColor\"/><circle cx=\"17.5\" cy=\"10.5\" r=\".5\" fill=\"currentColor\"/><circle cx=\"6.5\" cy=\"12.5\" r=\".5\" fill=\"currentColor\"/><circle cx=\"8.5\" cy=\"7.5\" r=\".5\" fill=\"currentColor\"/>",
  ki: "<path d=\"M12 8V4H8\"/><rect width=\"16\" height=\"12\" x=\"4\" y=\"8\" rx=\"2\"/><path d=\"M2 14h2\"/><path d=\"M20 14h2\"/><path d=\"M15 13v2\"/><path d=\"M9 13v2\"/>",
  automatik: "<path d=\"M14 9.536V7a4 4 0 0 1 4-4h1.5a.5.5 0 0 1 .5.5V5a4 4 0 0 1-4 4 4 4 0 0 0-4 4c0 2 1 3 1 5a5 5 0 0 1-1 3\"/><path d=\"M4 9a5 5 0 0 1 8 4 5 5 0 0 1-8-4\"/><path d=\"M5 21h14\"/>",
  erweitert: "<path d=\"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z\"/>",
  marke: "<path d=\"M10.935 5.565H15.435a2.145 2.145 0 010 4.29H8.565a2.145 2.145 0 000 4.29h6.87a2.145 2.145 0 010 4.29H10.935\"/>",
  "kortex-spirale": "<path d=\"M12.00 10.90L12.11 10.84L12.24 10.80L12.37 10.76L12.51 10.75L12.66 10.74L12.81 10.76L12.97 10.79L13.12 10.85L13.28 10.92L13.43 11.01L13.57 11.12L13.71 11.25L13.83 11.40L13.94 11.57L14.04 11.75L14.12 11.94L14.18 12.15L14.21 12.37L14.23 12.60L14.22 12.83L14.19 13.07L14.13 13.31L14.04 13.55L13.93 13.78L13.79 14.01L13.63 14.22L13.44 14.42L13.23 14.61L12.99 14.77L12.73 14.92L12.46 15.04L12.17 15.13L11.86 15.19L11.55 15.23L11.22 15.23L10.90 15.20L10.57 15.14L10.24 15.04L9.92 14.91L9.60 14.74L9.30 14.54L9.02 14.31L8.76 14.05L8.52 13.75L8.31 13.43L8.13 13.09L7.98 12.72L7.86 12.34L7.79 11.93L7.75 11.52L7.75 11.10L7.80 10.68L7.89 10.25L8.02 9.83L8.19 9.42L8.41 9.03L8.67 8.65L8.97 8.30L9.30 7.97L9.67 7.67L10.07 7.41L10.51 7.18L10.96 7.00L11.44 6.86L11.94 6.77L12.45 6.72L12.97 6.73L13.49 6.79L14.01 6.89L14.52 7.05L15.02 7.27L15.50 7.53L15.96 7.84L16.39 8.20L16.79 8.60L17.15 9.05L17.46 9.53L17.74 10.05L17.96 10.60L18.13 11.17L18.24 11.76L18.30 12.37L18.30 12.98L18.24 13.60L18.11 14.22L17.93 14.82L17.68 15.41L17.38 15.98L17.02 16.53L16.60 17.04L16.13 17.51L15.62 17.93L15.06 18.31L14.46 18.64L13.82 18.90L13.16 19.11L12.47 19.25L11.77 19.33L11.06 19.33L10.34 19.27L9.63 19.14L8.93 18.93L8.24 18.66L7.58 18.32L6.95 17.91L6.36 17.44L5.81 16.91L5.31 16.33L4.87 15.69L4.49 15.01L4.17 14.29L3.93 13.54L3.75 12.76L3.65 11.96L3.63 11.15L3.69 10.34L3.83 9.53L4.05 8.73L4.34 7.95L4.72 7.19L5.16 6.47L5.68 5.79L6.27 5.17L6.92 4.59L7.62 4.08L8.38 3.64L9.18 3.27L10.03 2.98L10.90 2.76L11.79 2.64L12.70 2.60L13.61 2.65L14.52 2.78L15.42 3.01L16.30 3.32L17.15 3.72L17.96 4.21L18.73 4.77L19.44 5.41L20.09 6.12\"/>",
  inbox: "<polyline points=\"22 12 16 12 14 15 10 15 8 12 2 12\"/><path d=\"M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z\"/>",
  notiz: "<path d=\"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z\"/><path d=\"M14 2v5a1 1 0 0 0 1 1h5\"/><path d=\"M10 9H8\"/><path d=\"M16 13H8\"/><path d=\"M16 17H8\"/>",
  archiv: "<rect width=\"20\" height=\"5\" x=\"2\" y=\"3\" rx=\"1\"/><path d=\"M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8\"/><path d=\"M10 12h4\"/>",
  filter: "<path d=\"M2 5h20\"/><path d=\"M6 12h12\"/><path d=\"M9 19h6\"/>",
  ordner: "<path d=\"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z\"/>",
  "ordner-offen": "<path d=\"m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2\"/>",
  "ordner-plus": "<path d=\"M12 10v6\"/><path d=\"M9 13h6\"/><path d=\"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z\"/>",
  plus: "<path d=\"M5 12h14\"/><path d=\"M12 5v14\"/>",
  suche: "<path d=\"m21 21-4.34-4.34\"/><circle cx=\"11\" cy=\"11\" r=\"8\"/>",
  sortierung: "<path d=\"m21 16-4 4-4-4\"/><path d=\"M17 20V4\"/><path d=\"m3 8 4-4 4 4\"/><path d=\"M7 4v16\"/>",
  sonne: "<circle cx=\"12\" cy=\"12\" r=\"4\"/><path d=\"M12 2v2\"/><path d=\"M12 20v2\"/><path d=\"m4.93 4.93 1.41 1.41\"/><path d=\"m17.66 17.66 1.41 1.41\"/><path d=\"M2 12h2\"/><path d=\"M20 12h2\"/><path d=\"m6.34 17.66-1.41 1.41\"/><path d=\"m19.07 4.93-1.41 1.41\"/>",
  stern: "<path d=\"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z\"/>",
  "stern-voll": "<path fill=\"currentColor\" d=\"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z\"/>",
  haken: "<path d=\"M20 6 9 17l-5-5\"/>",
  "kreis-haken": "<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"m16 9-5.5 5.5L8 12\"/>",
  schliessen: "<path d=\"M18 6 6 18\"/><path d=\"m6 6 12 12\"/>",
  "chevron-rechts": "<path d=\"m9 18 6-6-6-6\"/>",
  "chevron-unten": "<path d=\"m6 9 6 6 6-6\"/>",
  "chevron-auf-ab": "<path d=\"m7 15 5 5 5-5\"/><path d=\"m7 9 5-5 5 5\"/>",
  zahnrad: "<path d=\"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/>",
  mond: "<path d=\"M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401\"/>",
  zweig: "<path d=\"M15 6a9 9 0 0 0-9 9V3\"/><circle cx=\"18\" cy=\"6\" r=\"3\"/><circle cx=\"6\" cy=\"18\" r=\"3\"/>",
  wolke: "<path d=\"M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z\"/>",
  sync: "<path d=\"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8\"/><path d=\"M21 3v5h-5\"/><path d=\"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16\"/><path d=\"M8 16H3v5\"/>",
  commit: "<circle cx=\"12\" cy=\"12\" r=\"3\"/><line x1=\"3\" x2=\"9\" y1=\"12\" y2=\"12\"/><line x1=\"15\" x2=\"21\" y1=\"12\" y2=\"12\"/>",
  claude: "<path d=\"M12 5v14\"/><path d=\"m18.065 8.496-12.125 7\"/><path d=\"m5.94 8.504 12.125 7\"/>",
  herz: "<path d=\"M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5\"/>",
  schild: "<path d=\"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z\"/><path d=\"m9 12 2 2 4-4\"/>",
  link: "<path d=\"M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71\"/><path d=\"M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71\"/>",
  extern: "<path d=\"M15 3h6v6\"/><path d=\"M10 14 21 3\"/><path d=\"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6\"/>",
  gliederung: "<path d=\"M3 5h.01\"/><path d=\"M3 12h.01\"/><path d=\"M3 19h.01\"/><path d=\"M8 5h13\"/><path d=\"M8 12h13\"/><path d=\"M8 19h13\"/>",
  breite: "<path d=\"m18 8 4 4-4 4\"/><path d=\"M2 12h20\"/><path d=\"m6 8-4 4 4 4\"/>",
  code: "<path d=\"m16 18 6-6-6-6\"/><path d=\"m8 6-6 6 6 6\"/>",
  eigenschaften: "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\"/><path d=\"M15 3v18\"/>",
  seitenleiste: "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\"/><path d=\"M9 3v18\"/>",
  blitz: "<path d=\"M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z\"/>",
  warnung: "<path d=\"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3\"/><path d=\"M12 9v4\"/><path d=\"M12 17h.01\"/>",
  info: "<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M12 16v-4\"/><path d=\"M12 8h.01\"/>",
  sanduhr: "<path d=\"M5 22h14\"/><path d=\"M5 2h14\"/><path d=\"M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22\"/><path d=\"M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2\"/>",
  balken: "<path d=\"M5 21v-6\"/><path d=\"M12 21V3\"/><path d=\"M19 21V9\"/>",
  uhr: "<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M12 6v6l4 2\"/>",
  rakete: "<path d=\"M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5\"/><path d=\"M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09\"/><path d=\"M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z\"/><path d=\"M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05\"/>",
  zitat: "<path d=\"M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z\"/><path d=\"M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z\"/>",
  wuerfel: "<path d=\"M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z\"/><path d=\"m3.3 7 8.7 5 8.7-5\"/><path d=\"M12 22V12\"/>",
  person: "<path d=\"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2\"/><circle cx=\"12\" cy=\"7\" r=\"4\"/>",
  waage: "<path d=\"M12 3v18\"/><path d=\"m19 8 3 8a5 5 0 0 1-6 0zV7\"/><path d=\"M3 7h1a17 17 0 0 0 8-2 17 17 0 0 0 8 2h1\"/><path d=\"m5 8 3 8a5 5 0 0 1-6 0zV7\"/><path d=\"M7 21h10\"/>",
  thema: "<path d=\"M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z\"/><circle cx=\"7.5\" cy=\"7.5\" r=\".5\" fill=\"currentColor\"/>",
  kopieren: "<rect width=\"14\" height=\"14\" x=\"8\" y=\"8\" rx=\"2\" ry=\"2\"/><path d=\"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2\"/>",
  "pfeil-links": "<path d=\"m12 19-7-7 7-7\"/><path d=\"M19 12H5\"/>",
  stecker: "<path d=\"M12 22v-5\"/><path d=\"M15 8V2\"/><path d=\"M17 8a1 1 0 0 1 1 1v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1z\"/><path d=\"M9 8V2\"/>",
  vorlage: "<rect width=\"18\" height=\"7\" x=\"3\" y=\"3\" rx=\"1\"/><rect width=\"9\" height=\"7\" x=\"3\" y=\"14\" rx=\"1\"/><rect width=\"5\" height=\"7\" x=\"16\" y=\"14\" rx=\"1\"/>",
  klonen: "<circle cx=\"12\" cy=\"18\" r=\"3\"/><circle cx=\"6\" cy=\"6\" r=\"3\"/><circle cx=\"18\" cy=\"6\" r=\"3\"/><path d=\"M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9\"/><path d=\"M12 12v3\"/>",
  laptop: "<path d=\"M18 5a2 2 0 0 1 2 2v8.526a2 2 0 0 0 .212.897l1.068 2.127a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45l1.068-2.127A2 2 0 0 0 4 15.526V7a2 2 0 0 1 2-2z\"/><path d=\"M20.054 15.987H3.946\"/>",
  schloss: "<rect width=\"18\" height=\"11\" x=\"3\" y=\"11\" rx=\"2\" ry=\"2\"/><path d=\"M7 11V7a5 5 0 0 1 10 0v4\"/>",
  gehirn: "<path d=\"M12 18V5\"/><path d=\"M15 13a4.17 4.17 0 01-3-4 4.17 4.17 0 01-3 4\"/><path d=\"M17.707 6.294A3 3 0 1012 5a3 3 0 10-5.707 1.294\"/><path d=\"M17.996 5.125a4 4 0 012.526 5.77\"/><path d=\"M18 18a4 4 0 002-7.465\"/><path d=\"M19.967 17.482a4 4 0 11-7.967.517 4 4 0 11-7.967-.517\"/><path d=\"M6 18a4 4 0 01-2-7.465\"/><path d=\"M6.004 5.125a4 4 0 00-2.526 5.77\"/>",
  punkt: "<circle cx=\"12\" cy=\"12\" r=\"4\" fill=\"currentColor\" stroke=\"none\"/>",
  ansicht: "<path d=\"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/>",
  telefon: "<rect width=\"14\" height=\"20\" x=\"5\" y=\"2\" rx=\"2\" ry=\"2\"/><path d=\"M12 18h.01\"/>",
  papierkorb: "<path d=\"M10 11v6\"/><path d=\"M14 11v6\"/><path d=\"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6\"/><path d=\"M3 6h18\"/><path d=\"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2\"/>",
  aufgaben: "<path d=\"M13 5h8\"/><path d=\"M13 12h8\"/><path d=\"M13 19h8\"/><path d=\"m3 17 2 2 4-4\"/><path d=\"m3 7 2 2 4-4\"/>",
  punkte: "<circle cx=\"12\" cy=\"12\" r=\"1\"/><circle cx=\"19\" cy=\"12\" r=\"1\"/><circle cx=\"5\" cy=\"12\" r=\"1\"/>",
  kalender: "<path d=\"M8 2v3\"/><path d=\"M16 2v3\"/><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><path d=\"M3 9h18\"/>",
  stift: "<path d=\"M13 21h8\"/><path d=\"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z\"/>",
  "wolke-hoch": "<path d=\"M12 13v8\"/><path d=\"M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242\"/><path d=\"m8 17 4-4 4 4\"/>",
  "wolke-runter": "<path d=\"M12 13v8l-4-4\"/><path d=\"m12 21 4-4\"/><path d=\"M4.393 15.269A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.436 8.284\"/>",
  "wolke-aus": "<path d=\"M10.94 5.274A7 7 0 0 1 15.71 10h1.79a4.5 4.5 0 0 1 4.222 6.057\"/><path d=\"M18.796 18.81A4.5 4.5 0 0 1 17.5 19H9A7 7 0 0 1 5.79 5.78\"/><path d=\"m2 2 20 20\"/>",
  "ansicht-zeilen": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\"/><path d=\"M21 9H3\"/><path d=\"M21 15H3\"/>",
  "ansicht-spalten": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\"/><path d=\"M12 3v18\"/>",
  pfeil: "<path d=\"M5 12h14\"/><path d=\"m12 5 7 7-7 7\"/>",
  "pfeil-oben": "<path d=\"m5 12 7-7 7 7\"/><path d=\"M12 19V5\"/>",
  "pfeil-unten": "<path d=\"M12 5v14\"/><path d=\"m19 12-7 7-7-7\"/>",
  glocke: "<path d=\"M10.268 21a2 2 0 0 0 3.464 0\"/><path d=\"M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326\"/>",
  handy: "<rect width=\"14\" height=\"20\" x=\"5\" y=\"2\" rx=\"2\" ry=\"2\"/><path d=\"M12 18h.01\"/>",
  zuruecksetzen: "<path d=\"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8\"/><path d=\"M3 3v5h5\"/>",
  tastatur: "<path d=\"M10 8h.01\"/><path d=\"M12 12h.01\"/><path d=\"M14 8h.01\"/><path d=\"M16 12h.01\"/><path d=\"M18 8h.01\"/><path d=\"M6 8h.01\"/><path d=\"M7 16h10\"/><path d=\"M8 12h.01\"/><rect width=\"20\" height=\"16\" x=\"2\" y=\"4\" rx=\"2\"/>",
};

export const symbolNamen = Object.keys(ICONS);

export function symbol(name, groesse = GROESSE.norm, { farbe } = {}) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${RASTER} ${RASTER}`);
  svg.setAttribute("width", String(groesse));
  svg.setAttribute("height", String(groesse));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", String(Math.round((strichPx(groesse) * RASTER / groesse) * 1000) / 1000)); // feste Bildschirm-Strichstärke je Größe
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("sym");
  if (farbe) svg.style.color = farbe;
  const markup = ICONS[name];
  if (markup) svg.innerHTML = markup;
  return svg;
}
