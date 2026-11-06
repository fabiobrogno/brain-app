#!/usr/bin/env node
// scripts/erzeuge-symbole.mjs — erzeugt Ressourcen/studio/symbole.js aus Lucide (lucide-static, ISC).
//   Quelle:  Werkzeuge/symbole/node_modules/lucide-static/icons/<name>.svg   (Version fest in Werkzeuge/symbole/package.json; dort `npm ci`)
//   Ziel:    Ressourcen/studio/symbole.js   (Pfade stehen direkt in der Datei: keine Bibliothek und kein CDN zur Laufzeit)
// Aufruf:  node scripts/erzeuge-symbole.mjs            schreibt die Datei
//          node scripts/erzeuge-symbole.mjs --pruefen  prüft nur, ob die Datei zum Ergebnis passt (Exit 1 sonst; auch Tests/Node/symbole.test.mjs)
// Die Datei nie von Hand ändern: Änderungen gehören in die Tabelle ABBILDUNG unten (Kortex-Name → Lucide-Name) und dann neu erzeugen.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), "..");
export const ZIEL = join(WURZEL, "Ressourcen", "studio", "symbole.js");
const PAKET = join(WURZEL, "Werkzeuge", "symbole", "node_modules", "lucide-static");

// Kortex-Name (so rufen ihn die Aufrufer) → Lucide-Name. Ein Objekt { lucide, voll } füllt die Fläche (ausgefüllter Stern),
// ein Objekt { eigen } ist ein eigenes Zeichen im Lucide-Raster (24×24, runde Enden).
export const ABBILDUNG = {
  // Konzepte (Entwurf „Symbole“): ein Zeichen je Bedeutung, überall gleich
  vault: "library-big", // Vaults
  frage: "message-circle-question", // Rückfragen
  buch: "book-open", // Wissen
  funke: "sparkles", // Frag
  verlauf: "history",
  darstellung: "palette", // Einstellungen: Darstellung (neuer Name; "sonne"/"mond" bleiben für Hell/Dunkel)
  ki: "bot", // Einstellungen: KI & Konten
  automatik: "sprout", // Einstellungen: Pflege & Automatik
  erweitert: "wrench", // Einstellungen: Erweitert
  marke: { eigen: "marke" }, // die Windung der App (wie das App-Symbol): Willkommen, Über Kortex (Kopf), leerer Vault
  "kortex-spirale": { eigen: "kortex-spirale" }, // Einstellungen: Über Kortex (Navigation)
  // Rest
  inbox: "inbox", notiz: "file-text", archiv: "archive", filter: "list-filter", ordner: "folder", "ordner-offen": "folder-open",
  "ordner-plus": "folder-plus", plus: "plus", suche: "search", sortierung: "arrow-up-down",
  sonne: "sun", stern: "star", "stern-voll": { lucide: "star", voll: true }, haken: "check", "kreis-haken": "circle-check", schliessen: "x",
  "chevron-rechts": "chevron-right", "chevron-unten": "chevron-down", "chevron-auf-ab": "chevrons-up-down",
  zahnrad: "settings", mond: "moon", zweig: "git-branch", wolke: "cloud", sync: "refresh-cw", commit: "git-commit-horizontal",
  claude: "asterisk", herz: "heart", schild: "shield-check", link: "link", extern: "external-link", gliederung: "list",
  breite: "move-horizontal", code: "code", eigenschaften: "panel-right", seitenleiste: "panel-left",
  blitz: "zap", warnung: "triangle-alert", info: "info", sanduhr: "hourglass", balken: "chart-no-axes-column", tacho: "gauge", uhr: "clock",
  rakete: "rocket", zitat: "quote", wuerfel: "box", person: "user", waage: "scale", thema: "tag", kopieren: "copy",
  "pfeil-links": "arrow-left", stecker: "plug", vorlage: "layout-template", klonen: "git-fork", laptop: "laptop", schloss: "lock",
  gehirn: "brain", punkt: { eigen: "punkt" }, ansicht: "eye", telefon: "smartphone", papierkorb: "trash-2", aufgaben: "list-checks",
  punkte: "ellipsis", kalender: "calendar", stift: "pen-line", "wolke-hoch": "cloud-upload", "wolke-runter": "cloud-download",
  "wolke-aus": "cloud-off", "ansicht-zeilen": "rows-3", "ansicht-spalten": "columns-2", pfeil: "arrow-right",
  "pfeil-oben": "arrow-up", "pfeil-unten": "arrow-down", glocke: "bell", handy: "smartphone", zuruecksetzen: "rotate-ccw",
  tastatur: "keyboard",
};

// Eigene Zeichen im Lucide-Raster. Die Spirale ist fest gerechnet (zwei Windungen, nach außen wachsend), damit der Pfad stabil bleibt.
function spirale() {
  let d = "";
  const N = 140;
  for (let i = 0; i <= N; i++) {
    const t = i / N, a = t * Math.PI * 2 * 2.15 - Math.PI / 2, r = 1.1 + 8.9 * t;
    d += (i ? "L" : "M") + (12 + r * Math.cos(a)).toFixed(2) + " " + (12 + r * Math.sin(a)).toFixed(2);
  }
  return `<path d="${d}"/>`;
}
const EIGEN = {
  "kortex-spirale": spirale,
  marke: () => `<path d="M10.935 5.565H15.435a2.145 2.145 0 010 4.29H8.565a2.145 2.145 0 000 4.29h6.87a2.145 2.145 0 010 4.29H10.935"/>`, // Windung der App (bisher im 16er Raster, hier mit 1,5 auf das 24er Raster gebracht)
  punkt: () => `<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>`,
};

function lucideInnen(name) {
  const svg = readFileSync(join(PAKET, "icons", `${name}.svg`), "utf8");
  const m = /<svg[^>]*>([\s\S]*?)<\/svg>/.exec(svg);
  if (!m) throw new Error(`lucide-static: ${name}.svg ohne <svg>`);
  return m[1].replace(/<!--[\s\S]*?-->/g, "").replace(/\s+/g, " ").replace(/\s*\/>/g, "/>").replace(/>\s+</g, "><").trim();
}
const fuelle = (markup) => markup.replace(/<(path|circle|rect|polyline|polygon|ellipse)\b/g, '<$1 fill="currentColor"');

export function lucideVersion() { return JSON.parse(readFileSync(join(PAKET, "package.json"), "utf8")).version; }
export function lucideNamen() { return [...new Set(Object.values(ABBILDUNG).map((v) => (typeof v === "string" ? v : v.lucide)).filter(Boolean))].sort(); }

export function baueSymbole() {
  const zeilen = Object.entries(ABBILDUNG).map(([name, spec]) => {
    let markup;
    if (typeof spec === "string") markup = lucideInnen(spec);
    else if (spec.eigen) markup = EIGEN[spec.eigen]();
    else markup = spec.voll ? fuelle(lucideInnen(spec.lucide)) : lucideInnen(spec.lucide);
    return `  ${/^[a-z]+$/.test(name) ? name : JSON.stringify(name)}: ${JSON.stringify(markup)},`;
  });
  return `// ERZEUGT von scripts/erzeuge-symbole.mjs — nicht von Hand ändern (Tests/Node/symbole.test.mjs prüft es).
// Das einzige Symbol-Set des Studios: Lucide ${lucideVersion()} (ISC-Lizenz, siehe THIRD-PARTY-NOTICES.md), 24×24-Raster, Linie in currentColor,
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
${zeilen.join("\n")}
};

export const symbolNamen = Object.keys(ICONS);

export function symbol(name, groesse = GROESSE.norm, { farbe } = {}) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", \`0 0 \${RASTER} \${RASTER}\`);
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
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes("--pruefen")) {
    let ist = "";
    try { ist = readFileSync(ZIEL, "utf8"); } catch { /* fehlt */ }
    if (ist !== baueSymbole()) { console.error(`${ZIEL} passt nicht zum Ergebnis der Erzeugung: node scripts/erzeuge-symbole.mjs ausführen.`); process.exit(1); }
    console.log("symbole.js ist aktuell.");
  } else { writeFileSync(ZIEL, baueSymbole()); console.log(`geschrieben: ${ZIEL}`); }
}
