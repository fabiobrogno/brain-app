// Darstellung (Paket „Darstellung“): EINE Stelle für alles, was das Aussehen von Kortex bestimmt — Farbschemata, Akzentfarben, Dichte, Schrift, Größe, Zeilenbreite, Symbole.
// Werte und Verhalten stammen aus dem freigegebenen Prototyp (kortex-design.html, „Darstellung & Einstellungen“).
// Rein: keine Nebenwirkung beim Import, nichts davon braucht den DOM außer `wendeDarstellungAn` (die Werte kommen aus `einstellungen.json`, siehe gemeinsam/app-einstellungen.mjs;
// Tests/Node/darstellung.test.mjs prüft, dass Schema und diese Listen übereinstimmen). Die Palettenwerte stehen in schemata.css (`[data-pal="hell-papier"]` usw.).

// Akzentfarben: [id, Name, Wert in Hell, Wert in Dunkel]. Hell-Werte sind so gewählt, dass die Farbe als Text auf Papier, Seite und Karte mindestens 4,5:1 erreicht
// (Prototyp-Werte Blau #2563eb, Violett #9333ea, Rosa #db2777, Rot #dc2626, Orange #ea580c, Bernstein #b7791f, Grün #16a34a liegen auf der Seitenfläche von Papier/Kontrast unter 4,5:1 und sind minimal abgedunkelt; Test: Tests/Oberflaeche/darstellung.spec.mjs).
export const AKZENTE = [
  ["indigo", "Indigo", "#5b4ed6", "#a89fff"],
  ["blau", "Blau", "#1e5eea", "#7aa7ff"],
  ["violett", "Violett", "#9231ea", "#c79bff"],
  ["rosa", "Rosa", "#c6216b", "#ff8cc3"],
  ["rot", "Rot", "#cd2121", "#ff8a80"],
  ["orange", "Orange", "#b64409", "#ffa766"],
  ["bernstein", "Bernstein", "#8f5e18", "#f5c451"],
  ["gruen", "Grün", "#107a37", "#6ee09a"],
  ["graphit", "Graphit", "#3f3f46", "#d4d4d8"],
];
export const SCHEMATA = {
  hell: [["standard", "Standard"], ["papier", "Papier"], ["kontrast", "Kontrast hoch"]],
  dunkel: [["standard", "Standard"], ["graphit", "Graphit"], ["mitternacht", "Mitternacht"], ["kontrast", "Kontrast hoch"]],
};
export const ERSCHEINUNGEN = ["hell", "dunkel", "system"];
// Dichte (5 Stufen): Zeilenhöhe der Listen, Innenabstand der Zeilen, Zeilenabstand im Editor
export const ZEILE = [24, 26, 28, 31, 34];
export const INNEN = [6, 9, 11, 14, 17];
export const ZEILENABSTAND = [1.5, 1.6, 1.68, 1.78, 1.9];
export const OBERFLAECHEN = [90, 100, 110, 125];
// Breite der Lesespalte im Editor (px, inkl. Innenabstand); „voll“ nutzt die ganze Breite. „normal“ und „breit“ sind die Werte der früheren Schalter „Breite Textspalte“.
export const BREITEN = { schmal: 660, normal: 820, breit: 1080, voll: null };
export const BREITEN_NAMEN = [["schmal", "Schmal"], ["normal", "Normal"], ["breit", "Breit"], ["voll", "Voll"]];
export const SCHRIFT_GROESSE = { min: 12, max: 22 };

const GEIST = '"Geist", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif';
// Editor-Schrift: Geist, die Serifenschrift des Systems (macOS: New York), die Festbreitenschrift des Systems (macOS: SF Mono). Auf anderen Systemen heißen sie neutral „Serif“ und „Mono“.
export const EDITOR_SCHRIFTEN = {
  geist: { stapel: GEIST, name: () => "Geist" },
  serif: { stapel: 'ui-serif, "New York", "Iowan Old Style", Georgia, serif', name: (mac) => (mac ? "New York" : "Serif") },
  mono: { stapel: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', name: (mac) => (mac ? "SF Mono" : "Mono") },
};
export const CODE_SCHRIFTEN = {
  geist: { stapel: '"Geist Mono", ui-monospace, "SF Mono", Menlo, monospace', name: () => "Geist Mono" },
  system: { stapel: 'ui-monospace, "SF Mono", Menlo, monospace', name: (mac) => (mac ? "SF Mono" : "Mono") },
  menlo: { stapel: 'Menlo, Monaco, Consolas, monospace', name: (mac) => (mac ? "Menlo" : "Konsole") },
};
// Farben der Kacheln („Symbole: farbig“) je Bereich stehen in darstellung.css (Seite „Einstellungen“ und Seitenleiste)

export const STANDARD = {
  erscheinung: "system", schemaHell: "standard", schemaDunkel: "standard", akzent: "indigo", dichte: 2, editorSchrift: "geist", schriftgroesse: 16, oberflaeche: 100,
  zeilenbreite: "normal", codeSchrift: "geist", symbole: "einfarbig", seitenleisteDurchscheinend: true, bewegung: "system",
};
// Die Schlüssel, die „Darstellung zurücksetzen“ auf den Anfang stellt (Notizen, Vault-Einstellungen und das Dock-Symbol bleiben)
export const DARSTELLUNGS_SCHLUESSEL = Object.keys(STANDARD);

// ---------- Farbrechnung (WCAG) ----------
const kanal = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
export const hexZuRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
export const luminanz = (rgb) => { const [r, g, b] = Array.isArray(rgb) ? rgb : hexZuRgb(rgb); return 0.2126 * kanal(r) + 0.7152 * kanal(g) + 0.0722 * kanal(b); };
export function kontrast(a, b) {
  const [x, y] = [luminanz(a), luminanz(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
// Text auf einer Akzentfläche: schwarz oder weiß, je nachdem, was mehr Kontrast gibt (immer ≥ 4,5:1, wenn die Farbe weder zu mittel noch zu grell ist; der Test prüft jede Kombination)
export const textAufAkzent = (farbe) => (kontrast(farbe, "#ffffff") >= kontrast(farbe, "#0a0a0a") ? "#ffffff" : "#0a0a0a");

// ---------- Auflösen ----------
export const wert = (werte, k) => (werte && werte[k] !== undefined && werte[k] !== null ? werte[k] : STANDARD[k]);
// „Wie macOS“ (system) folgt dem Hell/Dunkel des Systems
export const loeseModus = (erscheinung, systemDunkel) => (erscheinung === "hell" ? "hell" : erscheinung === "dunkel" ? "dunkel" : systemDunkel ? "dunkel" : "hell");
export function loesePalette(werte, systemDunkel) {
  const modus = loeseModus(wert(werte, "erscheinung"), systemDunkel);
  const schema = modus === "hell" ? wert(werte, "schemaHell") : wert(werte, "schemaDunkel");
  const liste = SCHEMATA[modus];
  return { modus, schema: liste.some(([id]) => id === schema) ? schema : "standard", pal: `${modus}-${liste.some(([id]) => id === schema) ? schema : "standard"}` };
}
export function akzentFarbe(id, modus) {
  const a = AKZENTE.find((x) => x[0] === id) || AKZENTE[0];
  return modus === "hell" ? a[2] : a[3];
}

// → { pal, modus, theme (data-theme: light | dark | null), variablen: { "--akzent": … }, attribute: { "data-symbole": … } } — ohne DOM, damit es getestet werden kann
export function berechne(werte, { systemDunkel = false, mac = true } = {}) {
  const { modus, pal } = loesePalette(werte, systemDunkel);
  const farbe = akzentFarbe(wert(werte, "akzent"), modus);
  const dichte = Math.min(4, Math.max(0, Math.round(Number(wert(werte, "dichte")))));
  const breite = BREITEN[wert(werte, "zeilenbreite")];
  const editor = EDITOR_SCHRIFTEN[wert(werte, "editorSchrift")] || EDITOR_SCHRIFTEN.geist;
  const code = CODE_SCHRIFTEN[wert(werte, "codeSchrift")] || CODE_SCHRIFTEN.geist;
  const oberflaeche = OBERFLAECHEN.includes(Number(wert(werte, "oberflaeche"))) ? Number(wert(werte, "oberflaeche")) : 100;
  const g = Math.min(SCHRIFT_GROESSE.max, Math.max(SCHRIFT_GROESSE.min, Math.round(Number(wert(werte, "schriftgroesse")))));
  return {
    pal, modus,
    theme: wert(werte, "erscheinung") === "hell" ? "light" : wert(werte, "erscheinung") === "dunkel" ? "dark" : null,
    variablen: {
      "--akzent": farbe, "--akzent-text": textAufAkzent(farbe),
      "--zeile": `${ZEILE[dichte]}px`, "--innen": `${INNEN[dichte]}px`, "--ed-zeilenabstand": String(ZEILENABSTAND[dichte]),
      "--schrift-text": editor.stapel, "--editor-schrift": `${g}px`, "--lesebreite-wahl": breite ? `${breite}px` : "none", "--mono": code.stapel, "--ui-zoom": String(oberflaeche / 100),
    },
    attribute: {
      "data-symbole": wert(werte, "symbole") === "farbig" ? "farbig" : "einfarbig",
      "data-breite": wert(werte, "zeilenbreite"),
      "data-bewegung": wert(werte, "bewegung") === "reduziert" ? "reduziert" : null,
      "data-glas-wahl": wert(werte, "seitenleisteDurchscheinend") ? "an" : "aus",
    },
  };
}

// Schreibt das Ergebnis an das Wurzelelement. Wechselt nur, was sich geändert hat (kein Flackern). Liefert das Ergebnis von `berechne`.
export function wendeDarstellungAn(werte, { wurzel = document.documentElement, systemDunkel, mac = true } = {}) {
  const sd = systemDunkel ?? (typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches);
  const p = berechne(werte, { systemDunkel: sd, mac });
  if (wurzel.dataset.pal !== p.pal) wurzel.dataset.pal = p.pal;
  if (p.theme) { if (wurzel.dataset.theme !== p.theme) wurzel.dataset.theme = p.theme; } else delete wurzel.dataset.theme;
  for (const [k, v] of Object.entries(p.variablen)) if (wurzel.style.getPropertyValue(k) !== v) wurzel.style.setProperty(k, v);
  for (const [k, v] of Object.entries(p.attribute)) { if (v === null) wurzel.removeAttribute(k); else if (wurzel.getAttribute(k) !== v) wurzel.setAttribute(k, v); }
  return p;
}

// Schneller Start: die zuletzt angewendeten Werte liegen im Browserspeicher, damit die erste Zeichnung schon stimmt (die Wahrheit bleibt einstellungen.json)
const CACHE = "brain-studio.darstellung";
export function leseCache() { try { const j = JSON.parse(localStorage.getItem(CACHE)); return j && typeof j === "object" ? j : null; } catch { return null; } }
export function schreibeCache(werte) {
  try { localStorage.setItem(CACHE, JSON.stringify(Object.fromEntries(DARSTELLUNGS_SCHLUESSEL.map((k) => [k, wert(werte, k)])))); } catch { /* ohne Speicher */ }
}

// Alte Wahl aus dem Browserspeicher (Thema „theme“: system|hell|dunkel, Lesebreite „breit“) → Patch für die Einstellungen. Nur, was noch auf dem Standard steht, wird übernommen,
// damit eine Änderung von außen (CLI, anderes Fenster) nie überschrieben wird.
export function migriereAlteWahl({ theme, breit } = {}, aktuell = {}) {
  const patch = {};
  if (ERSCHEINUNGEN.includes(theme) && theme !== "system" && wert(aktuell, "erscheinung") === STANDARD.erscheinung) patch.erscheinung = theme;
  if (breit === true && wert(aktuell, "zeilenbreite") === STANDARD.zeilenbreite) patch.zeilenbreite = "breit";
  return patch;
}
