// gemeinsam/ki-schema.mjs — feste Ausgabeschemata der KI-Vorschläge und ihre strenge Prüfung (docs/plaene/ki-runde.md, Abschnitt 2.3 Schicht C). Rein, ohne Abhängigkeiten außer tags.mjs/notizen.mjs.
// Grundsatz: Die Antwort der KI ist fremder Text. Kortex prüft sie selbst, auch wenn `--json-schema` sie schon erzwingt — diese Prüfung ist die Grenze, nicht das Schema der CLI.
//   · unbekannte Felder, falsche Typen, zu lange Texte, Steuer-/Formatzeichen (Unicode-Tags, bidi, Null-Breite) → der einzelne Vorschlag fällt weg (fail-closed)
//   · Ziele sind NUR Kennungen aus der Liste, die Kortex mitgeschickt hat (k1…k12, o1…o8, z1…z60, f1…f25), nie Pfade
//   · ein „Beleg“ muss wörtlich (nach NFC- und Leerraum-Normalisierung) im gesendeten Text stehen
//   · ist die Antwort als Ganzes kaputt (kein JSON, falsche Form, Zusatzfelder auf oberster Ebene) → { ok: false } und nichts wird gezeigt
import { pruefeTagName } from "./tags.mjs";
import { istKiNein, istKiNeinWert } from "./notizen.mjs";

export const VERSION = "KORTEX-VORSCHLAG/1";
export const FUNKTIONEN = ["zusammenfassung", "posteingang", "ersatz", "aufgaben", "erwaehnungen"];
// Text-Aktionen des Editors: welche Funktion (Schema) sie benutzen. „aufgaben“ liefert Aufgaben statt Ersatztext.
export const TEXT_AKTIONEN = { umschreiben: "ersatz", kuerzen: "ersatz", uebersetzen: "ersatz", aufgaben: "aufgaben" };
export const SPRACHEN = ["de", "en", "fr", "es", "it"];
export const ARTEN = ["verlinken", "verschieben", "duplikat", "aufgabe", "tags"];

export const LIMITS = {
  saetze: 5, satzText: 240, belegeJeSatz: 4,
  vorschlaege: 3, beleg: 200, begruendung: 160, aufgabeText: 140, tags: 5,
  ersatzZuschlag: 500, aufgabenListe: 10,
  grund: 120,
  kandidaten: 12, ordner: 8, zeilen: 60, fundstellen: 25,
};
export const ID_MUSTER = { kandidat: /^k(?:[1-9]|1[0-2])$/, ordner: /^o[1-8]$/, zeile: /^z(?:[1-9]|[1-5][0-9]|60)$/, fundstelle: /^f(?:[1-9]|1[0-9]|2[0-5])$/ };
export const kandidatIds = (n) => Array.from({ length: Math.min(n, LIMITS.kandidaten) }, (_, i) => `k${i + 1}`);
export const ordnerIds = (n) => Array.from({ length: Math.min(n, LIMITS.ordner) }, (_, i) => `o${i + 1}`);
export const zeilenIds = (n) => Array.from({ length: Math.min(n, LIMITS.zeilen) }, (_, i) => `z${i + 1}`);
export const fundstellenIds = (n) => Array.from({ length: Math.min(n, LIMITS.fundstellen) }, (_, i) => `f${i + 1}`);

// ---------- Text-Hilfen ----------
export const normText = (s) => String(s ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
// Zeichen, die in KI-Text nie vorkommen dürfen: Steuerzeichen (außer \n \t bei mehrzeiligem Text), Unicode-Tags (versteckte Anweisungen), bidi-Steuerung, Null-Breite, BOM.
const GEFAEHRLICH = /(?![\n\r\t])[\p{Cc}\p{Cf}\p{Co}\p{Cn}\u{FE00}-\u{FE0E}\u{E0100}-\u{E01EF}\u{115F}\u{1160}\u{3164}\u{FFA0}\u{34F}]/u;
const ZEILENUMBRUCH = /[\n\r\t\u2028\u2029]/;
// Immer verboten, auch wenn die Auswahl sie hat: Unicode-Tags (versteckte Anweisungen) und bidi-Überschreibungen
const IMMER_VERBOTEN = /[\u{E0000}-\u{E007F}\u202A-\u202E\u2066-\u2069]/u;
const BILD = /\p{Extended_Pictographic}/u;
// Nur Text-Ersatz: unsichtbare Zeichen (z. B. ZWJ, weiches Trennzeichen) sind erlaubt, wenn genau dieses Zeichen schon in der gesendeten Auswahl steht;
// ein ZWJ zwischen zwei Emojis (ggf. mit Variationsselektor) immer. Alles andere bleibt verboten.
function nurErlaubtesUnsichtbar(s, vorbild) {
  if (IMMER_VERBOTEN.test(s)) return false;
  const z = [...s];
  for (let i = 0; i < z.length; i++) {
    const c = z[i];
    if (!GEFAEHRLICH.test(c)) continue;
    if (vorbild.includes(c)) continue;
    if (c === "\u200D") { let j = i - 1; while (j >= 0 && z[j] === "\uFE0F") j--; if (j >= 0 && BILD.test(z[j]) && i + 1 < z.length && BILD.test(z[i + 1])) continue; }
    return false;
  }
  return true;
}
const gueltigerText = (s, max, { mehrzeilig = false, min = 1, vorbild = null } = {}) =>
  typeof s === "string" && s.length >= min && s.length <= max && (vorbild === null ? !GEFAEHRLICH.test(s) : nurErlaubtesUnsichtbar(s, String(vorbild))) && (mehrzeilig || !ZEILENUMBRUCH.test(s));
const istObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const nurFelder = (o, erlaubt) => istObj(o) && Object.keys(o).every((k) => erlaubt.includes(k));
const istDatum = (s) => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const istBeleg = (beleg, text, vorbild = null) => {
  if (!gueltigerText(beleg, LIMITS.beleg, { vorbild })) return false;
  const b = normText(beleg);
  return b.length >= 3 && normText(text).includes(b);
};

// ---------- ki: nein ----------
// Die Prüfung steht in notizen.mjs (der Notiz-Index merkt sich das Ergebnis je Notiz); hier nur weitergereicht.
export { istKiNein, istKiNeinWert };
// Zeile des Notiz-Index: ist die Notiz mit `ki: nein` markiert? (der Index merkt sich das Ergebnis; sonst aus den Front-Matter-Feldern)
export const zeileIstKiNein = (z) => !!z && (z.kiNein === true || (!!z.felder && Object.entries(z.felder).some(([k, w]) => k.normalize("NFC").trim().toLowerCase() === "ki" && istKiNeinWert(w))));

// ---------- JSON aus Text lesen (Rückfall, wenn `structured_output` fehlt) ----------
export function parseJsonAntwort(roh) {
  if (typeof roh !== "string") return null;
  let t = roh.trim();
  if (t.length === 0 || t.length > 200_000) return null;
  const zaun = /^```(?:json|JSON)?\s*\n([\s\S]*?)\n?```$/.exec(t);
  if (zaun) t = zaun[1].trim();
  try { const j = JSON.parse(t); return istObj(j) ? j : null; } catch { return null; }
}

// ---------- Schemas (für `--json-schema`; die Prüfung unten gilt unabhängig davon) ----------
const text = (max, min = 1) => ({ type: "string", minLength: min, maxLength: max });
const aufzaehlung = (liste) => ({ type: "string", enum: liste });
export function schemaFuer(funktion, ctx = {}) {
  const nur = (props, req) => ({ type: "object", properties: props, required: req, additionalProperties: false });
  switch (funktion) {
    case "zusammenfassung":
      return nur({ saetze: { type: "array", maxItems: LIMITS.saetze, items: nur({ text: text(LIMITS.satzText), belege: { type: "array", minItems: 1, maxItems: LIMITS.belegeJeSatz, items: aufzaehlung(ctx.zeilen && ctx.zeilen.length ? ctx.zeilen : zeilenIds(LIMITS.zeilen)) } }, ["text", "belege"]) } }, ["saetze"]);
    case "posteingang": {
      const ziele = [...(ctx.kandidaten || kandidatIds(LIMITS.kandidaten)), ...(ctx.ordner || ordnerIds(LIMITS.ordner))];
      return nur({ vorschlaege: { type: "array", maxItems: LIMITS.vorschlaege, items: nur({
        art: aufzaehlung(ARTEN), ziel: aufzaehlung(ziele),
        aufgabe: nur({ text: text(LIMITS.aufgabeText), faellig: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } }, ["text"]),
        tags: { type: "array", minItems: 1, maxItems: LIMITS.tags, items: text(100) },
        beleg: text(LIMITS.beleg, 3), begruendung: text(LIMITS.begruendung), sicherheit: aufzaehlung(["hoch", "mittel"]),
      }, ["art", "beleg", "begruendung", "sicherheit"]) } }, ["vorschlaege"]);
    }
    case "ersatz":
      return nur({ ersatz: text(Number.isInteger(ctx.auswahlLaenge) ? ctx.auswahlLaenge * 2 + LIMITS.ersatzZuschlag : 20_000, 0) }, ["ersatz"]);
    case "aufgaben":
      return nur({ aufgaben: { type: "array", maxItems: LIMITS.aufgabenListe, items: nur({ text: text(LIMITS.aufgabeText), beleg: text(LIMITS.beleg, 3), faellig: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } }, ["text", "beleg"]) } }, ["aufgaben"]);
    case "erwaehnungen":
      return nur({ urteile: { type: "array", maxItems: LIMITS.fundstellen, items: nur({ id: aufzaehlung(ctx.fundstellen && ctx.fundstellen.length ? ctx.fundstellen : fundstellenIds(LIMITS.fundstellen)), gemeint: aufzaehlung(["ja", "nein", "unklar"]), grund: text(LIMITS.grund) }, ["id", "gemeint", "grund"]) } }, ["urteile"]);
    default:
      return null;
  }
}

// ---------- Prüfung ----------
// Adressen nach außen, Bilder, HTML, Code-Zäune, Front-Matter, neue [[Links]]: was der Ersatz hat und die Auswahl nicht hatte (Plan Schicht D, Warnzeilen).
export function warnungenFuerErsatz(auswahl, ersatz) {
  const a = String(auswahl ?? ""), e = String(ersatz ?? "");
  const w = [];
  const url = (s) => new Set((s.match(/\b(?:https?|ftp|mailto):[^\s)>\]]+|\bwww\.[^\s)>\]]+/gi) || []).map((x) => x.toLowerCase()));
  const neueUrls = [...url(e)].filter((u) => !url(a).has(u));
  if (neueUrls.length) w.push({ art: "link-extern", ziele: neueUrls.slice(0, 5).map((u) => u.replace(/^[a-z]+:\/\//, "").slice(0, 80)) });
  if (/!\[[^\]]*\]\([^)]*\)/.test(e) && !/!\[[^\]]*\]\([^)]*\)/.test(a)) w.push({ art: "bild" });
  if (/<\/?[a-zA-Z][^>]*>/.test(e) && !/<\/?[a-zA-Z][^>]*>/.test(a)) w.push({ art: "html" });
  if (/^ {0,3}(`{3,}|~{3,})/m.test(e) && !/^ {0,3}(`{3,}|~{3,})/m.test(a)) w.push({ art: "code" });
  if (/^---\s*$/m.test(e) && !/^---\s*$/m.test(a)) w.push({ art: "front-matter" });
  const wiki = (s) => new Set((s.match(/\[\[[^\]\n]+\]\]/g) || []).map((x) => x.toLowerCase()));
  const neueWiki = [...wiki(e)].filter((x) => !wiki(a).has(x));
  if (neueWiki.length) w.push({ art: "wikilink", anzahl: neueWiki.length });
  return w;
}

const MIT_VORSCHAU = ["vorschau"]; // der Platzhalter der Vorschau (#88) darf seine Marke mitschicken
const vorschauOk = (o) => !("vorschau" in o) || typeof o.vorschau === "boolean";

// roh: bereits geparstes Objekt. ctx je Funktion:
//   zusammenfassung: { zeilen: [id] }                      posteingang: { eintrag: text, kandidaten: [id], ordner: [id] }
//   ersatz: { auswahl: text }                              aufgaben: { auswahl: text }               erwaehnungen: { fundstellen: [id] }
// → { ok: true, daten: { … nur geprüfte Felder … }, verworfen: n, vorschau?: true } | { ok: false, grund }
export function pruefeAntwort(funktion, roh, ctx = {}) {
  if (!FUNKTIONEN.includes(funktion)) return { ok: false, grund: "funktion" };
  if (!istObj(roh)) return { ok: false, grund: "form" };
  const feld = { zusammenfassung: "saetze", posteingang: "vorschlaege", ersatz: "ersatz", aufgaben: "aufgaben", erwaehnungen: "urteile" }[funktion];
  if (!nurFelder(roh, [feld, ...MIT_VORSCHAU]) || !vorschauOk(roh) || !(feld in roh)) return { ok: false, grund: "form" };
  const marke = roh.vorschau === true ? { vorschau: true } : {};
  if (funktion === "ersatz") {
    const auswahl = String(ctx.auswahl ?? "");
    const max = auswahl.length * 2 + LIMITS.ersatzZuschlag;
    if (!gueltigerText(roh.ersatz, max, { mehrzeilig: true, min: 0, vorbild: auswahl })) return { ok: false, grund: "ersatz" };
    return { ok: true, daten: { ersatz: roh.ersatz.normalize("NFC"), warnungen: warnungenFuerErsatz(auswahl, roh.ersatz) }, verworfen: 0, ...marke };
  }
  const liste = roh[feld];
  if (!Array.isArray(liste)) return { ok: false, grund: "form" };
  const max = { zusammenfassung: LIMITS.saetze, posteingang: LIMITS.vorschlaege, aufgaben: LIMITS.aufgabenListe, erwaehnungen: LIMITS.fundstellen }[funktion];
  const gut = [];
  let verworfen = 0;
  const gesehen = new Set();
  for (const x of liste) {
    const r = pruefeEinzel(funktion, x, ctx);
    if (!r || gut.length >= max) { verworfen++; continue; }
    const k = r.schluessel; delete r.schluessel;
    if (k !== undefined) { if (gesehen.has(k)) { verworfen++; continue; } gesehen.add(k); }
    gut.push(r);
  }
  return { ok: true, daten: { [feld]: gut }, verworfen, ...marke };
}

function pruefeEinzel(funktion, x, ctx) {
  if (!istObj(x)) return null;
  const mengeVon = (l) => new Set(Array.isArray(l) ? l.filter((i) => typeof i === "string") : []);
  if (funktion === "zusammenfassung") {
    if (!nurFelder(x, ["text", "belege"]) || !gueltigerText(x.text, LIMITS.satzText)) return null;
    const zeilen = mengeVon(ctx.zeilen);
    if (!Array.isArray(x.belege) || x.belege.length < 1 || x.belege.length > LIMITS.belegeJeSatz) return null;
    if (!x.belege.every((b) => typeof b === "string" && ID_MUSTER.zeile.test(b) && zeilen.has(b))) return null; // eine unbekannte Kennung: der ganze Satz fällt weg
    return { text: x.text.normalize("NFC"), belege: [...new Set(x.belege)] };
  }
  if (funktion === "erwaehnungen") {
    if (!nurFelder(x, ["id", "gemeint", "grund"]) || !["ja", "nein", "unklar"].includes(x.gemeint) || !gueltigerText(x.grund, LIMITS.grund)) return null;
    if (typeof x.id !== "string" || !ID_MUSTER.fundstelle.test(x.id) || !mengeVon(ctx.fundstellen).has(x.id)) return null;
    return { id: x.id, gemeint: x.gemeint, grund: x.grund.normalize("NFC"), schluessel: x.id };
  }
  if (funktion === "aufgaben") {
    if (!nurFelder(x, ["text", "beleg", "faellig"]) || !gueltigerText(x.text, LIMITS.aufgabeText) || !istBeleg(x.beleg, ctx.auswahl, ctx.auswahl ?? "")) return null;
    if (x.faellig !== undefined && !istDatum(x.faellig)) return null;
    return { text: x.text.normalize("NFC"), beleg: x.beleg.normalize("NFC"), ...(x.faellig ? { faellig: x.faellig } : {}) };
  }
  // posteingang
  if (!nurFelder(x, ["art", "ziel", "aufgabe", "tags", "beleg", "begruendung", "sicherheit"])) return null;
  if (!ARTEN.includes(x.art) || !["hoch", "mittel"].includes(x.sicherheit)) return null;
  if (!gueltigerText(x.begruendung, LIMITS.begruendung) || !istBeleg(x.beleg, ctx.eintrag)) return null;
  const aus = { art: x.art, beleg: x.beleg.normalize("NFC"), begruendung: x.begruendung.normalize("NFC"), sicherheit: x.sicherheit };
  const hat = (k) => x[k] !== undefined;
  if (x.art === "verlinken" || x.art === "duplikat") {
    if (hat("aufgabe") || hat("tags") || typeof x.ziel !== "string" || !ID_MUSTER.kandidat.test(x.ziel) || !mengeVon(ctx.kandidaten).has(x.ziel)) return null;
    aus.ziel = x.ziel;
  } else if (x.art === "verschieben") {
    if (hat("aufgabe") || hat("tags") || typeof x.ziel !== "string" || !ID_MUSTER.ordner.test(x.ziel) || !mengeVon(ctx.ordner).has(x.ziel)) return null;
    aus.ziel = x.ziel;
  } else if (x.art === "aufgabe") {
    if (hat("ziel") || hat("tags") || !nurFelder(x.aufgabe, ["text", "faellig"]) || !gueltigerText(x.aufgabe.text, LIMITS.aufgabeText)) return null;
    if (x.aufgabe.faellig !== undefined && !istDatum(x.aufgabe.faellig)) return null;
    aus.aufgabe = { text: x.aufgabe.text.normalize("NFC"), ...(x.aufgabe.faellig ? { faellig: x.aufgabe.faellig } : {}) };
  } else { // tags
    if (hat("ziel") || hat("aufgabe") || !Array.isArray(x.tags) || x.tags.length < 1 || x.tags.length > LIMITS.tags) return null;
    const tags = [];
    for (const t of x.tags) { const n = pruefeTagName(typeof t === "string" && !GEFAEHRLICH.test(t) ? t : null); if (n === null) return null; if (!tags.includes(n)) tags.push(n); }
    aus.tags = tags;
  }
  aus.schluessel = `${aus.art}|${aus.ziel ?? ""}|${aus.aufgabe ? aus.aufgabe.text : ""}|${aus.tags ? aus.tags.join(",") : ""}`;
  return aus;
}
