// gemeinsam/pruefung.mjs — Prüf-Signale je Wiki-Seite (Studio-Spec §6): nur Regeln, 0 Tokens, kein Plattenzugriff.
// Studio behauptet nie „stimmt“, nur „belegt“ / „ungeprüft“ — die Wahrheit entscheidet der Mensch.

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

// Frontmatter zeilenweise lesen: { felder, bis } — bis = Zahl der Kopfzeilen inkl. beider ---, 0 = kein Kopf.
export function leseKopf(text) {
  const zeilen = text.split(/\r?\n/);
  if (zeilen[0] !== "---") return { felder: {}, bis: 0 };
  const felder = {};
  for (let i = 1; i < zeilen.length; i++) {
    if (zeilen[i] === "---") return { felder, bis: i + 1 };
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(zeilen[i]);
    if (m) felder[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return { felder: {}, bis: 0 }; // nie geschlossen → kein gültiger Kopf
}

export const berlinHeute = (d = new Date()) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

export function istDatum(s) {
  const m = ISO.exec(s || "");
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
export const plusTage = (iso, tage) => {
  const m = ISO.exec(iso);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + tage)).toISOString().slice(0, 10);
};

const KONFLIKT = /^\s*>\s*\[!KONFLIKT\]/i;
// Markierung steht am Zeilenanfang (ggf. nach Listenzeichen, > oder **) und in Großbuchstaben — so wie Lint sie setzt;
// Fließtext, der das Wort nur erwähnt („Befund **PRÜFBEDÜRFTIG**“), zählt nicht.
const PRUEFBEDUERFTIG = /^\s*(?:[-*+>]\s+)*\**\s*PR(?:Ü|UE)FBED(?:Ü|UE)RFTIG\b/;
// Fakt-Zeile laut Schema (09_wiki/_schema.md): Listenzeile mit „ · Stand TT.MM.JJJJ“ und Beleg-Link auf …/belege/….
// Handgeschriebene Stichpunkte (auch unter „## Fakten“) ohne eines dieser beiden Merkmale sind keine Fakt-Zeilen.
// Sobald unter „## Fakten“ mindestens eine Zeile eines der Merkmale trägt, gilt der Abschnitt als Fakt-Format:
// dann zählt jede weitere Listenzeile dort als Fakt-Zeile (ohne Beleg-Link = unbelegt). Ersetzte Zeilen (~~…~~) zählen nicht.
const FAKT_STAND = /^\s*[-*+]\s.*·\s*Stand\s+\d{1,2}\.\d{1,2}\.\d{4}/;
const LISTE = /^\s*[-*+]\s+\S/;
const ERSETZT = /^\s*[-*+]\s+~~/;
const BELEG = /\[\[[^\]]*\/belege\/[^\]]*\]\]/;
const FAKTEN_KOPF = /^##\s+Fakten\s*$/i;

// pfad: Vault-relativ ("/"), text: Dateiinhalt, opts.heute: "JJJJ-MM-TT" (für Tests).
export function pruefeText(pfad, text, opts = {}) {
  const heute = opts.heute || berlinHeute();
  const name = pfad.split("/").pop();
  if (!pfad.startsWith("09_wiki/")) {
    return { stufe: "grau", zusammenfassung: "Notiz — wird erst durch /ingest zu Wissen", signale: [] };
  }
  if (name.startsWith("_")) {
    return { stufe: "grau", zusammenfassung: "Verzeichnis- oder Protokolldatei, keine Wissensseite", signale: [] };
  }
  const signale = [];
  const rot = [], gelb = [];
  const { felder, bis } = leseKopf(text);

  if (felder.zweifel) { signale.push({ art: "zweifel", text: `Zweifel vermerkt: ${felder.zweifel}`, zeile: 1 }); rot.push("Zweifel vermerkt"); }
  if (felder.pruefen_bis !== undefined) {
    if (!istDatum(felder.pruefen_bis)) { /* kein gültiges Datum: nicht werten */ }
    else if (felder.pruefen_bis < heute) { signale.push({ art: "abgelaufen", text: `Prüffrist abgelaufen seit ${felder.pruefen_bis}` }); gelb.push("Prüffrist abgelaufen"); }
  }
  const verfall = /^\d+$/.test(felder.verfall || "") ? +felder.verfall : null;
  if (verfall !== null && istDatum(felder.stand)) {
    const bis_ = plusTage(felder.stand, verfall);
    if (bis_ < heute) { signale.push({ art: "verfall", text: `Stand ${felder.stand} ist nach ${verfall} Tagen verfallen (seit ${bis_})` }); gelb.push("Stand verfallen"); }
  }
  if (name.startsWith("quelle_") && (!felder.quellen_sha || /^\[\s*\]$/.test(felder.quellen_sha))) {
    signale.push({ art: "quellen_sha", text: "Quellen-Prüfsumme (quellen_sha) fehlt", zeile: 1 }); gelb.push("quellen_sha fehlt");
  }

  // Textkörper: Zeilen unter dem Kopf, Code-Blöcke ausgenommen; Zeilennummern bleiben die der ganzen Datei.
  const zeilen = text.split(/\r?\n/);
  let imCode = false, belegt = 0, ohneBeleg = 0, imFakten = false;
  const kandidaten = []; // { zeile, hatMerkmal, belegt, imFakten }
  for (let i = bis; i < zeilen.length; i++) {
    const z = zeilen[i];
    if (/^\s*(```|~~~)/.test(z)) { imCode = !imCode; continue; }
    if (imCode) continue;
    if (/^#{1,6}\s/.test(z)) imFakten = FAKTEN_KOPF.test(z);
    if (KONFLIKT.test(z)) { signale.push({ art: "konflikt", text: "Offener Konflikt-Kasten — du entscheidest", zeile: i + 1 }); rot.push("offener Konflikt"); }
    else if (PRUEFBEDUERFTIG.test(z)) { signale.push({ art: "pruefbeduerftig", text: "Als prüfbedürftig markiert", zeile: i + 1 }); rot.push("prüfbedürftig markiert"); }
    if (!LISTE.test(z) || ERSETZT.test(z)) continue;
    const hatBeleg = BELEG.test(z);
    const merkmal = FAKT_STAND.test(z) || hatBeleg;
    if (merkmal || imFakten) kandidaten.push({ zeile: i + 1, merkmal, hatBeleg, imFakten });
  }
  const faktenFormat = kandidaten.some((k) => k.imFakten && k.merkmal);
  for (const k of kandidaten) {
    if (!k.merkmal && !(k.imFakten && faktenFormat)) continue;
    if (k.hatBeleg) belegt++;
    else { ohneBeleg++; signale.push({ art: "beleg_fehlt", text: "Fakt-Zeile ohne Beleg-Link", zeile: k.zeile }); }
  }
  if (ohneBeleg) gelb.push(`${ohneBeleg} Fakt-Zeile${ohneBeleg > 1 ? "n" : ""} ohne Beleg`);

  // Zusatz-Signale (nicht wertend)
  if (/^true$/i.test(felder.kritisch || "")) signale.push({ art: "kritisch", text: "Kritische Seite — nur von Hand ändern", zeile: 1 });
  if (felder.stand) signale.push({ art: "stand", text: `Stand ${felder.stand}` });
  if (belegt) signale.push({ art: "belegt", text: `${belegt} belegte Fakt-Zeile${belegt > 1 ? "n" : ""}` });
  if (felder.ersetzt_durch) signale.push({ art: "ersetzt", text: `Überholt, ersetzt durch ${felder.ersetzt_durch}` });

  const faktenText = `${belegt} belegte Fakt-Zeile${belegt > 1 ? "n" : ""}`;
  const stufe = rot.length ? "rot" : gelb.length ? "gelb" : belegt ? "gruen" : "ohne";
  const zusammenfassung =
    stufe === "rot" ? `Braucht deine Entscheidung: ${[...new Set(rot)].join(", ")}`
    : stufe === "gelb" ? `Ungeprüft oder abgelaufen: ${[...new Set(gelb)].join(", ")}${belegt ? ` · ${faktenText}` : ""}`
    : stufe === "gruen" ? `Alle ${faktenText}, keine offenen Signale`
    : "Ohne Befund: keine Fakt-Zeilen mit Beleg-Format, keine offenen Signale";
  return { stufe, zusammenfassung, signale };
}
