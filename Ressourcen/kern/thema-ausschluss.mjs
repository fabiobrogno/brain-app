// thema-ausschluss.mjs — Themen-Ausschluss (Einstellung automatik.ernteOhneThema): Fakten zu bestimmten, meist privaten
// Themen kommen nie ins Brain, gleich aus welchem Ordner die Sitzung stammt (der Ordner-Ausschluss ernteNichtIn reicht dafür nicht:
// solche Sitzungen laufen im normalen Home-Ordner). Eine Wortliste; ein Wort trifft nur als GANZES Wort — Unicode-Wortgrenzen
// (Buchstaben, Ziffern und Kombinationszeichen gehören zum Wort, alles andere, auch _ und -, trennt), Groß/Klein egal, NFC wie NFD.
// Vor dem Vergleich wird auf BEIDEN Seiten gefaltet (falte): NFKC (Vollbreite, Ligaturen …) und ß/ẞ → ss — das Flag `i` allein hält „STRASSE“
// nicht für „Straße“. Mehrwort-Begriffe („weißes zebra“) passen auf beliebigen Leerraum zwischen den Wörtern. Das Wort steht buchstäblich im Muster
// (kein Regex-Eingriff, kein Aufschaukeln). Fail-closed: geht beim Prüfen etwas schief, gilt das Thema als getroffen.
//
// Geprüft wird an jeder Stelle, an der ein Fakt, Stand, eine Lektion oder ein Korrektur-Signal ins Brain wandern könnte: Ernte,
// Nach-Ernte, Lektionen, W7, Lücken/Fragespur, im Tageslauf vor jedem KI-Aufruf und vor jedem Schreiben. Das Wort selbst gehört
// nie in ein Protokoll, Log oder einen Bericht — dort steht höchstens THEMA_GRUND.

// Grund beim Aussortieren (Archiv 90_archiv/vorschlaege-aussortiert/<grund>/, nie löschen) und in Protokollen.
export const THEMA_GRUND = "thema-ausgeschlossen";

const MAX_WOERTER = 500, MAX_LAENGE = 200;
const WORTZEICHEN = "\\p{L}\\p{N}\\p{M}";
const nfc = (s) => String(s).normalize("NFC");
// Faltung für den Vergleich (Wort UND Text): NFKC, dann ß/ẞ → ss. Die Wörter selbst bleiben in der Liste, wie sie eingetragen wurden.
const falte = (s) => String(s).normalize("NFKC").replace(/[ßẞ]/gu, "ss");

// Rohwert (aus der Config) → bereinigte Liste: ein Text zählt als ein Wort, bei einer Liste nur die nicht leeren Texte,
// Leerraum innen einfach, Dubletten (ohne Groß/Klein) einmal. Großzügig gelesen, damit ein Tippfehler in der Config den Schutz nie abschaltet.
export function normiereWortliste(roh) {
  const liste = typeof roh === "string" ? [roh] : Array.isArray(roh) ? roh : [];
  const gesehen = new Set(), aus = [];
  for (const w of liste) {
    if (typeof w !== "string") continue;
    const t = nfc(w).replace(/\s+/gu, " ").trim().slice(0, MAX_LAENGE).trim();
    const schluessel = t.toLowerCase();
    if (!t || gesehen.has(schluessel)) continue;
    gesehen.add(schluessel);
    aus.push(t);
    if (aus.length >= MAX_WOERTER) break;
  }
  return aus;
}

const maskiere = (s) => s.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");

// → { test(text) } (zustandslos, faltet den Text selbst) | null (keine Wörter).
export function themaMatcher(woerter) {
  const liste = normiereWortliste(woerter);
  if (!liste.length) return null;
  const teile = liste.map((w) => maskiere(falte(w)).replace(/ /g, "\\s+"));
  const re = new RegExp(`(?<![${WORTZEICHEN}])(?:${teile.join("|")})(?![${WORTZEICHEN}])`, "iu");   // ohne g-Flag: kein Zustand zwischen Aufrufen
  return { test: (text) => re.test(falte(text)) };
}

const MERKER = new Map();
function matcherFuer(woerter) {
  const liste = normiereWortliste(woerter);
  if (!liste.length) return null;
  const schluessel = JSON.stringify(liste);
  let m = MERKER.get(schluessel);
  if (!m) {
    m = themaMatcher(liste);
    if (MERKER.size > 20) MERKER.clear();
    MERKER.set(schluessel, m);
  }
  return m;
}

// Nennt irgendeiner der Texte (Titel, Text, Zitat …) ein Wort der Liste? Nicht-Texte werden übersehen.
export function nenntThema(woerter, ...texte) {
  try {
    const m = matcherFuer(woerter);
    if (!m) return false;
    const alles = texte.filter((t) => typeof t === "string").join("\n");
    return alles ? m.test(alles) : false;
  } catch {
    return true;   // fail-closed
  }
}
