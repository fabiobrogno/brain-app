// gemeinsam/ki-antworten.mjs — Größe und Form der Antworten, die die KI-Werkzeuge (MCP) zurückgeben. Reine Funktionen, ohne Dateizugriff:
// Seiten seitenweise lesen (Gliederung, Abschnitt, Zeilen), Suchausschnitt um den Treffer, Kontext-Paket begrenzen.
// Ziel (Token-Paket 1): jede Antwort hat eine feste Obergrenze, damit eine lange Seite nicht den ganzen Kontext füllt.
import { leseKopf } from "./pruefung.mjs";

// ───────────────────────────── Grenzen (Zeichen; die Tests prüfen sie auf der Fixture) ─────────────────────────────
export const LESEN_GRENZE = 6000;     // ab dieser Seitenlänge gibt brain_lesen nur noch Gliederung und Anfang
export const LESEN_ANFANG = 4000;     // so viel vom Anfang kommt dann mit
export const LESEN_TEIL_MAX = 6000;   // Obergrenze für einen Abschnitt bzw. einen Zeilenbereich
export const GLIEDERUNG_MAX = 40;     // Überschriften in der Gliederung
export const SUCHE_STANDARD = 5;
export const SUCHE_MAX = 20;
export const AUSZUG_MAX = 100;
export const KONTEXT_SEITEN = 4;
export const KONTEXT_LIMIT = 2000;
export const KONTEXT_SATZ = 160;

const kuerze = (s, n) => (s.length <= n ? s : `${s.slice(0, Math.max(1, n - 1)).trimEnd()}…`);
const falteText = (s) => String(s).normalize("NFC").toLowerCase();

// ───────────────────────────── Lesen ─────────────────────────────
// Überschriften (# bis ######) außerhalb von Code-Zäunen und Frontmatter → [{ zeile (1-basiert), ebene, text }]
export function gliederung(zeilen) {
  const text = Array.isArray(zeilen) ? zeilen : String(zeilen).split(/\r?\n/);
  const aus = [];
  let zaun = null;
  for (let i = leseKopf(text.join("\n")).bis; i < text.length; i++) {
    const z = text[i];
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(z);
    if (f) { if (!zaun) zaun = f[1][0]; else if (f[1][0] === zaun) zaun = null; continue; }
    if (zaun) continue;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(z);
    if (m) aus.push({ zeile: i + 1, ebene: m[1].length, text: m[2].trim() });
  }
  return aus;
}

function gliederungText(gl) {
  if (!gl.length) return "Gliederung: keine Überschriften.";
  const mind = Math.min(...gl.map((h) => h.ebene));
  const zeilen = gl.slice(0, GLIEDERUNG_MAX).map((h, i) => `${"  ".repeat(h.ebene - mind)}${i + 1}. ${kuerze(h.text, 70)} (Z. ${h.zeile})`);
  if (gl.length > GLIEDERUNG_MAX) zeilen.push(`… und ${gl.length - GLIEDERUNG_MAX} weitere Überschriften (Abschnitt dann mit dem Text der Überschrift wählen)`);
  return `Gliederung (abschnitt = Nummer oder Text der Überschrift):\n${zeilen.join("\n")}`;
}

const ganzzahl = (w, name) => {
  if (w === undefined || w === null) return null;
  const n = typeof w === "number" ? w : /^\s*\d+\s*$/.test(String(w)) ? Number(w) : NaN;
  if (!Number.isInteger(n) || n < 1) { const e = new Error(`Der Parameter „${name}“ muss eine ganze Zahl ab 1 sein.`); e.eingabe = true; throw e; }
  return n;
};
const eingabeFehler = (t) => Object.assign(new Error(t), { eingabe: true });

// Findet die Überschrift zu `abschnitt` (Nummer in der Gliederung oder Text: erst gleich, dann Anfang, dann enthalten).
function suchAbschnitt(gl, abschnitt) {
  const roh = String(abschnitt).trim();
  if (/^\d+$/.test(roh)) return gl[Number(roh) - 1] || null;
  const w = falteText(roh.replace(/^#+\s*/, ""));
  if (!w) return null;
  const t = (h) => falteText(h.text);
  return gl.find((h) => t(h) === w) || gl.find((h) => t(h).startsWith(w)) || gl.find((h) => t(h).includes(w)) || null;
}

// Zeilen [von..bis] (1-basiert, einschließlich) als Text, höchstens LESEN_TEIL_MAX Zeichen. → { text, bis (letzte gezeigte Zeile) }
function zeilenBereich(zeilen, von, bis) {
  const aus = [];
  let n = 0, letzte = von - 1;
  for (let i = von - 1; i < bis; i++) {
    const z = zeilen[i];
    if (n + z.length + 1 > LESEN_TEIL_MAX) {
      if (!aus.length) { aus.push(kuerze(z, LESEN_TEIL_MAX)); letzte = i + 1; }
      break;
    }
    aus.push(z); n += z.length + 1; letzte = i + 1;
  }
  return { text: aus.join("\n"), bis: letzte };
}

// → { teil: false, text } (ganze Seite) oder { teil: true, text, hinweis, vorspann? } (Anfang samt Gliederung als vorspann bzw. Abschnitt/Zeilen).
// Wirft einen Error mit `eingabe: true` bei ungültigen Parametern (der Aufrufer macht daraus eine Fehlermeldung).
export function leseAntwort(inhalt, { abschnitt, von, bis } = {}) {
  const zeilen = String(inhalt).split(/\r?\n/);
  const gesamt = zeilen.length > 1 && zeilen[zeilen.length - 1] === "" ? zeilen.length - 1 : zeilen.length;
  const hatAbschnitt = abschnitt !== undefined && abschnitt !== null && String(abschnitt).trim() !== "";
  const vonN = ganzzahl(von, "von"), bisN = ganzzahl(bis, "bis");
  if (hatAbschnitt && (vonN || bisN)) throw eingabeFehler("Bitte entweder „abschnitt“ oder „von“/„bis“ angeben, nicht beides.");

  if (hatAbschnitt) {
    const gl = gliederung(zeilen);
    const h = suchAbschnitt(gl, abschnitt);
    if (!h) throw eingabeFehler(`Den Abschnitt „${kuerze(String(abschnitt), 60)}“ gibt es in dieser Seite nicht.\n${gliederungText(gl)}`);
    const naechste = gl.find((x) => x.zeile > h.zeile && x.ebene <= h.ebene);
    const ende = Math.min(gesamt, naechste ? naechste.zeile - 1 : gesamt);
    const r = zeilenBereich(zeilen, h.zeile, ende);
    const weiter = r.bis < ende ? `Der Abschnitt geht weiter: von=${r.bis + 1} bis=${ende}.` : "";
    return { teil: true, text: r.text, hinweis: `Abschnitt „${kuerze(h.text, 70)}“, Zeilen ${h.zeile}–${r.bis} von ${gesamt}.${weiter ? ` ${weiter}` : ""}` };
  }
  if (vonN || bisN) {
    const a = vonN || 1;
    if (a > gesamt) throw eingabeFehler(`Die Seite hat nur ${gesamt} Zeilen (von=${a}).`);
    const b = Math.min(gesamt, bisN || gesamt);
    if (b < a) throw eingabeFehler("„bis“ darf nicht vor „von“ liegen.");
    const r = zeilenBereich(zeilen, a, b);
    const weiter = r.bis < b ? ` Weiter: von=${r.bis + 1} bis=${b}.` : r.bis < gesamt ? ` Weiter: von=${r.bis + 1}.` : "";
    return { teil: true, text: r.text, hinweis: `Zeilen ${a}–${r.bis} von ${gesamt}.${weiter}` };
  }
  if (String(inhalt).length < LESEN_GRENZE) return { teil: false, text: String(inhalt) };

  // lange Seite: Gliederung + Anfang (an einer Zeilengrenze geschnitten)
  const gl = gliederung(zeilen);
  let n = 0, ende = 0;
  while (ende < gesamt && n + zeilen[ende].length + 1 <= LESEN_ANFANG) { n += zeilen[ende].length + 1; ende++; }
  const anfang = ende === 0 ? kuerze(zeilen[0], LESEN_ANFANG) : zeilen.slice(0, ende).join("\n");
  if (ende === 0) ende = 1;
  const hinweis = `Lange Seite (${String(inhalt).length} Zeichen, ${gesamt} Zeilen): oben Gliederung und Zeilen 1–${ende}. Weiterlesen mit brain_lesen (gleicher pfad) und abschnitt="<Nummer oder Überschrift>" oder von=${ende + 1} bis=<Zeile>.`;
  return { teil: true, vorspann: gliederungText(gl), text: anfang, hinweis, ende };
}

// ───────────────────────────── Suche ─────────────────────────────
export const sucheWoerter = (frage) => [...new Set(falteText(frage).match(/[\p{L}\p{N}]+/gu) || [])];

// Beste Zeile im Textkörper (nie im Frontmatter) zu den Suchwörtern → { zeile (1-basiert), auszug (≤ AUSZUG_MAX + 2 Zeichen) }
export function suchAuszug(text, woerter) {
  const zeilen = String(text).split(/\r?\n/);
  const start = leseKopf(String(text)).bis;
  const gewicht = (w) => (w.length >= 4 ? 1 : 0.25);
  let beste = -1, punkte = 0, pos = 0;
  for (let i = start; i < zeilen.length; i++) {
    const k = falteText(zeilen[i]).replace(/\s+/g, " ").trim();
    if (!k.trim()) continue;
    const toks = k.match(/[\p{L}\p{N}]+/gu) || [];
    let p = 0, erste = Infinity;
    for (const w of woerter) {
      if (toks.some((t) => t === w || (w.length >= 4 && t.startsWith(w)))) { p += gewicht(w); const x = k.indexOf(w); if (x >= 0 && x < erste) erste = x; }
    }
    if (/^\s*#/.test(zeilen[i])) p *= 0.6; // Überschrift wiederholt meist nur den Titel: eine Textzeile mit gleich vielen Treffern gewinnt
    if (p > punkte) { punkte = p; beste = i; pos = Number.isFinite(erste) ? erste : 0; }
  }
  if (beste < 0) { // nichts im Text (Treffer kam über Titel oder Beschreibung): erste Textzeile, lieber keine Überschrift
    beste = zeilen.findIndex((l, i) => i >= start && l.trim() && !/^\s*#/.test(l));
    if (beste < 0) beste = zeilen.findIndex((l, i) => i >= start && l.trim());
    if (beste < 0) return { zeile: Math.min(zeilen.length, start + 1) || 1, auszug: "" };
    pos = 0;
  }
  const z = zeilen[beste].trim().replace(/\s+/g, " ");
  let von = Math.max(0, Math.min(pos, z.length) - 30);
  if (von > 0) von = z.lastIndexOf(" ", von) + 1; // an einer Wortgrenze beginnen
  let bis = Math.min(z.length, von + AUSZUG_MAX);
  if (bis < z.length) { const l = z.lastIndexOf(" ", bis); if (l > von + 40) bis = l; } // und enden
  return { zeile: beste + 1, auszug: (von > 0 ? "… " : "") + z.slice(von, bis).trim() + (bis < z.length ? " …" : "") };
}

// Text der Trefferliste, wie die KI sie sieht. treffer: [{ pfad, titel, stufe (Text), zeile, auszug }]
export function sucheText(treffer, { mehr = false } = {}) {
  if (!treffer.length) return "Keine Treffer.";
  const zeilen = treffer.map((t, i) => `${i + 1}. ${t.pfad} — ${kuerze(t.titel, 60)} [${t.stufeText}]\n   Z.${t.zeile}: ${t.auszug}`);
  zeilen.push(`Weiter: brain_lesen mit abschnitt oder von/bis.${mehr ? " Mehr: anzahl." : ""}`);
  return zeilen.join("\n");
}

// ───────────────────────────── Kontext-Paket ─────────────────────────────
// Begrenzt die Trefferliste von brain_kontext: höchstens KONTEXT_SEITEN Seiten, je ein Satz, insgesamt KONTEXT_LIMIT Zeichen.
// treffer: bereits sortiert [{ pfad, titel, stand, stufeText, verfallen, satz }] → { text, seiten (die genannten Pfade) }
export function begrenzeKontext(treffer, projekt) {
  const zeilen = [], seiten = [];
  let laenge = 0;
  for (const t of treffer.slice(0, KONTEXT_SEITEN)) {
    const satz = t.satz ? kuerze(t.satz, KONTEXT_SATZ) : "";
    const z = `${zeilen.length + 1}. ${t.pfad} — ${kuerze(t.titel, 80)}\n   Stand ${t.stand} · ${t.stufeText}${t.verfallen ? " · Stand verfallen" : ""}${satz ? `\n   ${satz}` : ""}`;
    if (zeilen.length && laenge + z.length + 1 > KONTEXT_LIMIT - 200) break; // Platz für Kopf und Schluss lassen
    zeilen.push(z); laenge += z.length + 1; seiten.push(t.pfad);
  }
  const rest = treffer.length - zeilen.length;
  const kopf = `Kortex-Kontext zu „${kuerze(String(projekt), 60)}“ (${zeilen.length} Seite(n); Details mit brain_lesen):`;
  const fuss = rest > 0 ? `\n(+${rest} weitere; brain_suchen)` : "";
  return { text: `${kopf}\n${zeilen.join("\n")}${fuss}`.slice(0, KONTEXT_LIMIT), seiten };
}
