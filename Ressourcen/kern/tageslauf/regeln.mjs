// tageslauf/regeln.mjs — Feste Regeln des Tageslaufs, ganz ohne KI (0 Tokens, reine Funktionen, wirft nie).
// Anlass: der Probelauf über den echten Bestand (B2) ergab, dass bei den geplanten automatischen Übernahmen das Zitat stimmte, das URTEIL
// aber nicht: Wunsch/Auftrag statt Fakt, Zahl ohne Messgröße und Zeitraum, Zielseite nach dem Zitat geändert, Seite nur aus der Seitenwahl.
// Leitlinie des Brains: lieber eine Lücke als ein falscher Fakt — aussortieren heißt archivieren (nichts wird gelöscht).
//
//  R1 wunschStattFakt     Titel + Kernsatz sind ein Wunsch, Auftrag, Vorhaben oder offener Punkt → ⚪ aussortieren (wunsch-statt-fakt).
//  R2 zahlOhneBezug       Anteil/Prozent/Geldbetrag/Mengen-Messwert ohne Zeitraum oder Datum → ⚪ aussortieren (zahl-ohne-bezug).
//  R3 seiteNeuerAlsZitat  Die Zielseite wurde NACH dem Zitat von jemand anderem als dem Tageslauf geändert → Rückfrage statt Automatik.
//  R4 istSeitenwahl       Die Zielseite stammt aus der Seitenwahl (ziel.wie === "wahl") → Rückfrage statt Automatik.
//  R5 istAltbestand       Das Zitat (Zeitpunkt der Fundstelle) liegt mehr als ALTBESTAND_TAGE (7) Tage vor dem Lauf, oder der Zeitpunkt fehlt/ist ungültig → Rückfrage statt Automatik.
// R1/R2 laufen früh im Tageslauf (tageslauf.mjs#pruefeVorschlag, direkt nach dem Themen- und Secrets-Ausschluss, vor jedem KI-Aufruf), R3/R4/R5
// sind Bausteine für die Stufe nach dem Richter (der Aufrufer verdrahtet sie).
//
// Grundsatz der Musterlisten: PRÄZISE statt breit. Jedes Muster steht einzeln mit Begründung da; ein Muster, das auch echte Regeln und Fakten träfe
// („Port X muss in der Firewall offen sein“ = Regel, „wird gespeichert“ = Passiv, „Kunden wollen schnelle Lieferung“ = Marktfakt), gehört nicht hinein.
// Was eine Regel verpasst, fängt der Abgleich (Haiku) und der Richter (Sonnet) ab; was sie zu Unrecht trifft, liegt im Archiv, ist aber weg aus der Automatik.
// Die Regeln gelten für art fakt; Stände sind bewusst Momentaufnahmen mit offenen Punkten („Nächster Schritt …“) und ersetzen sich selbst.
import { git, AUTOR } from "./arbeitskopie.mjs";
import { leseFundstelle } from "../beleg-ernte.mjs";
import { frontmatterText } from "../seitenfelder.mjs";

export const WUNSCH_GRUND = "wunsch-statt-fakt";
export const ZAHL_GRUND = "zahl-ohne-bezug";

const ZEICHEN = "\\p{L}\\p{N}";
// Ganzes Wort (Buchstaben, Ziffern und Bindestrich gehören zum Wort — „Soll-Wert“ und „Sollwert“ sind kein Verb).
const wort = (alternativen) => `(?<![${ZEICHEN}-])(?:${alternativen})(?![${ZEICHEN}-])`;
const re = (quelle, flags = "u") => new RegExp(quelle, flags);

// ---------- Sätze ----------
// Abkürzungen, deren Punkt keinen Satz beendet („z. B.“, „ca.“, „Nr.“ …), werden vor dem Teilen geschützt; Dezimalzahlen und Datumsangaben
// haben keinen Leerraum nach dem Punkt und trennen ohnehin nie. Neuer Satz = Satzzeichen + Leerraum + Großbuchstabe, Anführungszeichen, Klammer, Zahl, Markdown-Zeichen.
const KUERZEL = /(?<![\p{L}\p{N}])(?:z\.\s?B|d\.\s?h|u\.\s?a|u\.\s?U|o\.\s?ä|ggf|bzw|usw|etc|evtl|inkl|vgl|ca|Nr|Abb|max|min|Std|Tel|ff|sog|ggü)\./gu;
const PUNKT = "\u2024";
export function saetze(text) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return [];
  return t.replace(KUERZEL, (m) => m.replaceAll(".", PUNKT))
    .split(/(?<=[.!?])\s+(?=[\p{Lu}„"'(\[#`*\d-])/u)
    .map((s) => s.replaceAll(PUNKT, ".").trim()).filter(Boolean);
}
const kernVon = (titel, text) => [String(titel ?? "").trim(), saetze(text)[0] || ""].filter(Boolean).join("\n");

// ---------- R1: Wunsch/Auftrag statt Fakt ----------
// Bereich „kern“ = Titel + erster Satz des Textes (die Kernaussage), „titel“ = nur der Titel. Ein Modalverb im zweiten oder dritten Satz macht aus einem
// Fakt keinen Wunsch („Telegram ist nur für Anna freigegeben. … Die Zwei-Schritt-Bestätigung sollte aktiv sein.“) — das prüft dann der Abgleich.
// gueltig(m, bereichText) darf einen einzelnen Treffer verwerfen (m.index zeigt in bereichText).
const letzteKlausel = (text, ende) => text.slice(0, ende).split(/[.!?;:\n]/).pop();
// Der Kernsatz hält ausdrücklich eine Vorgabe/Entscheidung fest („Die Vorgabe des Nutzers: …“, „beschlossen“, „festgelegt“) — dann ist „soll“ die Form der Regel, nicht
// ein offener Wunsch. „noch nicht festgelegt/entschieden“ ist das Gegenteil und hebt den Wunsch nicht auf.
const ENTSCHIEDEN = re(`(?<![${ZEICHEN}-])Vorgabe|(?<![${ZEICHEN}-])Leitregel|(?<![${ZEICHEN}-])Regel(?![${ZEICHEN}-])|(?<!nicht\\s)(?<!noch\\s)(?<!nie\\s)(?<![${ZEICHEN}-])(?:beschlossen|festgelegt|entschieden|vereinbart)(?![${ZEICHEN}-])`, "iu");
// Nebensatz/Frage („Wer sie nicht sehen soll, bekommt …“, „Wie soll …?“): beschreibt eine Regel, äußert keinen Wunsch.
const IN_FRAGE_ODER_RELATIV = /(?<![\p{L}-])(?:wer|was|wem|wen|wie|wo|wohin|wann|welche[rsmn]?)(?![\p{L}-])/iu;
// Allgemeine Subjekte („Kunden wollen …“, „viele wollen …“) sind kein Wunsch einer bestimmten Person.
const PERSON = "Nutzer(?:in)?|User|Anwender(?:in)?|Chef(?:in)?|Auftraggeber(?:in)?|Kunde|Kundin|Ich|Er";
const FUELLWORT = "(?:(?:noch|auch|gern|gerne|unbedingt|sofort|zuerst|zunächst|jetzt|dann|nur|ebenfalls)\\s+){0,2}";
const ABSICHT_SG = "will|möchte|wollte|wünscht|wünschte|plant|plante|erwägt|überlegt|beabsichtigt|hofft";
const ABSICHT_PL = "wollen|möchten|wollten|wünschen|planen|planten|erwägen|überlegen|beabsichtigen|hoffen";
const AUFGABEN_VERBEN = "aufnehmen|einbauen|prüfen|überprüfen|klären|abklären|ergänzen|anpassen|nachziehen|nachrüsten|umsetzen|einrichten|ermitteln|"
  + "kalkulieren|übernehmen|testen|erweitern|umstellen|einführen|festlegen|entscheiden|besprechen|abstimmen|nachtragen|verbessern|"
  + "überarbeiten|aktualisieren|migrieren|evaluieren|dokumentieren|recherchieren|planen";
// Titel mit einer dieser Marken sind Regeln/Vorgaben, auch wenn sie auf einen Infinitiv enden („Vor jedem Upload prüfen“, „Erst VPN prüfen“, „Nie ungeprüft übernehmen“).
const REGEL_IM_TITEL = re(wort("immer|nie|niemals|nicht|nur|kein(?:e|en|em|er|es)?|stets|erst|sobald|wenn|ohne|jeweils|jede[rsnm]?|zuerst|zunächst|vorher|danach"), "iu");

export const WUNSCH_MUSTER = [
  // „soll“ ist Anforderung, Absicht oder Auftrag — kein Ist-Zustand. „sollte“ ist die Empfehlung/Maßnahme, ebenso nicht Ist-Zustand.
  { id: "soll", bereich: "kern", re: re(wort("soll|sollen|sollte|sollten"), "gu"),
    gueltig: (m, t) => !IN_FRAGE_ODER_RELATIV.test(letzteKlausel(t, m.index)) && !ENTSCHIEDEN.test(t) },
  // Eine bestimmte Person will/möchte/plant etwas („Der Nutzer will …“). Mehrzahlformen nur bei „Wir“; „Nutzer wollen“, „Kunden wollen“ sind Marktfakten.
  { id: "absicht-person", bereich: "kern",
    re: re(`${wort(PERSON)}\\s+${FUELLWORT}${wort(ABSICHT_SG)}|${wort("Wir")}\\s+${FUELLWORT}${wort(`${ABSICHT_SG}|${ABSICHT_PL}`)}`, "u") },
  // „möchte, dass …“ / „will, dass …“: Singular-Absichtsverb + dass = eine Person wünscht etwas, gleich wer.
  { id: "absicht-dass", bereich: "kern", re: re(`${wort("will|möchte|wünscht|wünschte|wollte")}\\s*,?\\s+dass(?![${ZEICHEN}])`, "u") },
  // „gewünscht“, „Wunsch“, „Wunschfunktion“ — außer der Regelform „auf (ausdrücklichen) Wunsch“ („läuft nur auf ausdrücklichen Wunsch des Nutzers“).
  { id: "wunschwort", bereich: "kern", re: re(wort("gewünscht|wünschenswert|Wunsch|Wünsche|Wunschfunktion|Wunschliste"), "gu"),
    gueltig: (m, t) => !/(?:auf|nach)\s+(?:\p{L}+en\s+)?$/iu.test(t.slice(0, m.index)) },
  // „Geplant ist …“, „… ist geplant“, Titel auf „… geplant“. Nicht: „ist nicht geplant“ (Entscheidung), „wie geplant“ (Rückblick), „geplante“ (Adjektiv).
  { id: "geplant", bereich: "kern", re: re(`(?<![${ZEICHEN}-])Geplant\\s+(?:ist|sind)(?![${ZEICHEN}])|${wort("ist|sind")}\\s+(?:(?:noch|bisher|derzeit|bereits)\\s+)?geplant(?![${ZEICHEN}-])`, "u") },
  { id: "geplant-titel", bereich: "titel", re: re(`(?<![${ZEICHEN}-])geplant\\s*[.!?]?$`, "u"), gueltig: (m, t) => !/(?:nicht|kein\p{L}*|nie|wie)\s+$/iu.test(t.slice(0, m.index)) },
  // Vorhaben im Präsens-Passiv: „wird … eingeführt/umgestellt/neu aufgesetzt“. Nicht bei Verneinung („Es wird kein Klick-Protokoll eingeführt“ = Entscheidung).
  // Bewusst NICHT „ausgerollt“/„gebaut“/„angelegt“: „Neue Felder werden zuerst über X ausgerollt“ ist eine feste Reihenfolge (Regel), „wird selbst gebaut“ eine Entscheidung.
  { id: "vorhaben-passiv", bereich: "kern",
    re: re(`${wort("wird|werden")}((?:\\s+[${ZEICHEN}„“"'\`-]+){0,4}?)\\s+(?:eingeführt|umgestellt|neu aufgesetzt)(?![${ZEICHEN}-])`, "gu"),
    gueltig: (m) => !re(wort("nicht|kein(?:e|en|em|er|es)?|nie|niemals"), "iu").test(m[1] || "") },
  // „X werden (eigene) Y.“ — Werden im Sinn von „wird zu“, also eine Absicht/ein Plan („Die Werkzeuge werden eigene Tools.“, „Das wird Pflicht.“).
  // Nur wenn das Nomen den Satz beendet; „werden Dateien angelegt“ (Passiv) und „wird eine Bestätigung verlangt“ treffen nicht.
  { id: "werden-nomen", bereich: "kern",
    re: re(`${wort("wird|werden")}\\s+(?:(?:eigene[nrms]?|ein(?:e[nmrs]?)?|zum|zur)\\s+)?\\p{Lu}[${ZEICHEN}-]*(?:\\s+\\p{Lu}[${ZEICHEN}-]*)?\\s*(?:[.!?:;]|$)`, "mu") },
  // Aufgabenform im Titel: endet auf einen Aufgaben-Infinitiv („… aufnehmen“, „… prüfen“, „… klären“). Regelformen mit immer/nie/nur/erst/vor jeder … gelten nicht.
  // Der Infinitiv muss klein geschrieben sein: „Das Prüfen“ ist ein Nomen.
  { id: "aufgabe-titel", bereich: "titel", re: re(`${wort(AUFGABEN_VERBEN)}\\s*[.!]?$`, "u"), gueltig: (m, t) => !REGEL_IM_TITEL.test(t) },
  // Offene Punkte im Titel: „noch/vorerst offen“, „Entscheidung offen“, „Offene Frage: …“, „steht noch aus“, Fragezeichen am Ende, „noch zu klären“.
  { id: "offen-titel", bereich: "titel",
    re: re(`${wort("noch|vorerst")}\\s+offen|^Offene[rn]?\\s+(?:Entscheidung|Frage|Punkte?|Aufgabe)(?:en)?|${wort("Entscheidung|Frage|Klärung|Freigabe|Antwort|Rückmeldung|Zusage")}(?:en)?(?:\\s+[${ZEICHEN}-]+){0,4}?\\s+(?:ist\\s+|sind\\s+|bleibt\\s+)?offen\\s*[.!]?$|steht\\s+noch\\s+aus|noch\\s+zu\\s+(?:klären|prüfen|entscheiden)|\\?\\s*$`, "iu") },
  // Titel-Präfix: „Ziel: …“, „Ziele: …“, „Ziel „Nachtlauf“: …“, „Idee: …“, „Vorschlag: …“, „Wunsch: …“, „Aufgabe: …“, „Frage: …“ (nicht „Zielbild …“).
  { id: "praefix", bereich: "titel", re: re(`^(?:Ziele?|Idee|Vorschlag|Wunsch|Aufgabe|Auftrag|To-?do|Frage|Plan)(?:\\s+[„"][^“"]*[“"])?\\s*:`, "iu") },
  // Offene Arbeit im Kernsatz: „muss noch …“, „muss … geklärt/geprüft werden“, „muss man noch schauen/prüfen“. Ein bloßes „muss“ ist meist eine Regel und trifft NICHT.
  { id: "muss-noch", bereich: "kern",
    re: re(`${wort("muss|müssen")}\\s+(?:(?:man|er|sie|das|es)\\s+)?noch(?![${ZEICHEN}-])|${wort("muss|müssen")}[^.!?;]{0,60}?(?<![${ZEICHEN}-])(?:geklärt|geprüft|entschieden|erledigt|nachgetragen|abgestimmt|besprochen)\\s+werden|${wort("muss")}\\s+man\\s+(?:schauen|prüfen|klären|überlegen|besprechen|testen|nachsehen|abklären)`, "iu") },
  // Ankündigung ohne Datum: „kommen bald/in Kürze/demnächst“ — Zukunft ohne Zeitpunkt, morgen schon überholt (kurzlebig). „kommt später über Lizenz“ (Fahrplan) trifft nicht.
  { id: "kommt-bald", bereich: "kern", re: re(`${wort("kommt|kommen")}(?:\\s+[${ZEICHEN}-]+){0,3}?\\s+(?:bald|in\\s+Kürze|demnächst)(?![${ZEICHEN}-])`, "iu") },
  // Wunsch im Konjunktiv: „wäre gut/schön/sinnvoll …“, „am besten wäre …“.
  { id: "konjunktiv", bereich: "kern",
    re: re(`${wort("wäre|wären")}\\s+(?:es\\s+)?(?:gut|schön|sinnvoll|wichtig|besser|praktisch|toll|nett|wünschenswert|hilfreich)(?![${ZEICHEN}-])|am\\s+besten\\s+(?:wäre|wär)(?![${ZEICHEN}-])`, "iu") },
];

// Jedes Muster einmal als globale Fassung (matchAll sieht so alle Fundstellen; gueltig() darf einzelne verwerfen).
const GLOBAL = WUNSCH_MUSTER.map((m) => ({ ...m, re: new RegExp(m.re.source, m.re.flags.includes("g") ? m.re.flags : `${m.re.flags}g`) }));
function treffer(bereiche) {
  for (const m of GLOBAL) {
    const text = bereiche[m.bereich];
    if (!text) continue;
    for (const x of text.matchAll(m.re)) if (!m.gueltig || m.gueltig(x, text)) return { id: m.id, stelle: x[0] };
  }
  return null;
}

// → { treffer: boolean, muster?: string, stelle?: string }
export function wunschStattFakt(v) {
  try {
    const t = String(v?.titel ?? "").replace(/\s+/g, " ").trim();
    const hit = treffer({ titel: t, kern: kernVon(t, v?.text) });
    return hit ? { treffer: true, muster: hit.id, stelle: hit.stelle.slice(0, 80) } : { treffer: false };
  } catch { return { treffer: false }; }      // eine Regel darf nie einen Vorschlag blockieren, weil sie selbst kaputt ist — das prüfen Abgleich und Richter
}

// ---------- R2: Zahl ohne Bezug ----------
// Gemeint sind GEMESSENE Werte: Anteil/Prozent, Geldbetrag, Mengen (Anzahl Artikel, Bestellungen, Anfragen …). Ohne Zeitraum oder Datum im Text ist nicht
// erkennbar, wofür sie gelten („58 % der Subagents liefen auf Opus“ — in welchem Zeitraum, nach welcher Zählweise?). Nicht gemeint: Ports, Versionen,
// Datumsangaben, IDs, Hausnummern, Zählungen ohne Einheit — sie haben keine der drei Formen — und Regel-/Konfigurationswerte (Schwellen, Gebühren, Limits,
// „ab 80 €“, „höchstens 1.000“), die eine Entscheidung festhalten statt etwas zu messen.
const NICHT_IN_ZAHL = `(?<![${ZEICHEN}.,/#:-])`;
const MENGEN_NOMEN = "Artikel|Listings?|Bestellungen|Aufträge|Anfragen|Aufrufe|Nutzer|Kunden|Besucher|Zeilen|Einträge|Datensätze|Dateien|PDFs|Bilder|Medien|Tickets|"
  + "Tokens?|Sessions|Sitzungen|Produkte|Positionen|Fälle|Treffer|Nachrichten|Meldungen|Mails|Klicks|Abfahrten|Vorschläge|Vorschlägen|Subagents|Abrufe|Käufe";
const GROSSE_ZAHL = "\\d{1,3}(?:\\.\\d{3})+|\\d{3,}";
export const ZAHL_ARTEN = [
  { art: "prozent", re: re(`${NICHT_IN_ZAHL}\\d{1,3}(?:[.,]\\d+)?\\s?(?:%|Prozent(?:punkte?)?)(?![${ZEICHEN}])`, "gu") },
  { art: "betrag", re: re(`${NICHT_IN_ZAHL}\\d{1,3}(?:\\.\\d{3})*(?:,\\d{1,2})?\\s?(?:€|EUR|Euro|Cent|\\$|USD|Dollar)(?![${ZEICHEN}])|(?<![${ZEICHEN}])[€$]\\s?\\d[\\d.,]*`, "gu") },
  { art: "menge", re: re(`${NICHT_IN_ZAHL}(?:${GROSSE_ZAHL}|\\d+\\s+von\\s+(?:${GROSSE_ZAHL}))\\s+(?:(?:rund|etwa|ca\\.|insgesamt)\\s+)?(?:${MENGEN_NOMEN})(?![${ZEICHEN}-])`, "gu") },
];
// Regel-/Konfigurationswerte im Satz: Schwellen, Gebühren, Limits, Grenzwerte, Vorgaben und Verteilregeln („fließt in“, „5 % jedes Kaufs“) — dort steht eine Entscheidung,
// keine Messung. Geprüft werden nur die Sätze des Textes (der Titel fasst sie zusammen); ein Zeitbezug zählt dagegen auch im Titel.
const REGELWERT = re(`(?<![${ZEICHEN}-])(?:ab|erst|bis\\s+zu|bis|unter|über|mindestens|höchstens|maximal|mehr\\s+als|weniger\\s+als|spätestens|frühestens)(?![${ZEICHEN}-])[^.!?]{0,40}\\d`
  + `|(?<![${ZEICHEN}-])(?:Schwelle|Schwellwert|Grenze|Grenzwert|Limit|Obergrenze|Untergrenze|Deckel|Budget|Gebühr|Gebühren|Rabatt|Provision|Zuschlag|Aufschlag|Tarif|Pauschale|Steuersatz|MwSt|USt|kostenlos|gratis|Versandkosten|begrenzt|gedeckelt|soll|sollen|sollte|muss|müssen|darf|dürfen|fließt|fließen|gehen|geht|zahlt|zahlen|kassiert|erhält|bekommt|abgezogen|einbehalten|jede[rsnm]?|jedes)(?![${ZEICHEN}-])`, "iu");

const MONATE = "Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember|Jan|Feb|Mär|Apr|Jun|Jul|Aug|Sep|Sept|Okt|Nov|Dez";
// Zeitraum oder Datum im Text. Vage Verweise („zuletzt“, „im Auswertungszeitraum“, „aktuell“, „bisher“) zählen bewusst NICHT.
const ZEITBEZUG = [
  re(`(?<![${ZEICHEN}.])\\d{1,2}\\.\\s?\\d{1,2}\\.(?:\\s?\\d{2,4})?(?![${ZEICHEN}]|\\.\\d)`, "u"),             // 14.10. · 08.10.2026   (nicht 0.3.0 oder 10.10.10.10)
  re(`(?<![${ZEICHEN}])\\d{4}-\\d{2}-\\d{2}(?![${ZEICHEN}])`, "u"),                                     // 2026-10-14
  re(`(?<![${ZEICHEN}])(?:19|20)\\d{2}(?![${ZEICHEN}])`, "u"),                                          // Jahreszahl
  re(`(?<![${ZEICHEN}-])(?:${MONATE})\\.?(?![${ZEICHEN}-])`, "u"),                                      // Oktober · Okt.
  re(`(?<![${ZEICHEN}])(?:Q[1-4]|KW\\s?\\d{1,2}|H[12])(?![${ZEICHEN}])`, "u"),
  re(wort("heute|gestern|vorgestern|seit|seitdem|täglich|wöchentlich|monatlich|jährlich|stündlich|nächtlich|letzte[rnms]?|vergangene[rnms]?|vorige[rnms]?|Zeitraum\\s+(?:von|vom|bis)"), "iu"),
  re(`(?<![${ZEICHEN}-])(?:pro|je|am|im|jede[nrsm]?|jedem)\\s+(?:Tag|Woche|Monat|Jahr|Quartal|Stunde|Minute|Sekunde|Morgen|Abend|Nacht)(?![${ZEICHEN}-])`, "iu"),
  re(`(?<![${ZEICHEN}.,])\\d+\\s*(?:Tag(?:e|en)?|Wochen?|Monat(?:e|en)?|Jahr(?:e|en)?|Stunden?|Minuten?)(?![${ZEICHEN}-])`, "iu"),
  re(`(?<![${ZEICHEN}-])(?:Tages|Wochen|Monats|Quartals|Jahres|Stunden)[\\p{Ll}-]+`, "u"),           // Tagesbudget, Monatsumsatz, Jahresumsatz
];
export const hatZeitbezug = (text) => ZEITBEZUG.some((r) => r.test(String(text ?? "")));

// → { treffer: boolean, art?: "prozent"|"betrag"|"menge", zahl?: string }
export function zahlOhneBezug(v) {
  try {
    const t = String(v?.titel ?? "").replace(/\s+/g, " ").trim();
    const alles = `${t}\n${String(v?.text ?? "")}`;
    if (hatZeitbezug(alles)) return { treffer: false };
    for (const satz of saetze(v?.text)) {
      if (!satz || REGELWERT.test(satz)) continue;
      for (const { art, re: r } of ZAHL_ARTEN) {
        const m = satz.match(new RegExp(r.source, r.flags.replace("g", "")));
        if (m) return { treffer: true, art, zahl: m[0].trim() };
      }
    }
    return { treffer: false };
  } catch { return { treffer: false }; }
}

// ---------- Frühe Prüfung (R1, dann R2) ----------
// → null (weiter im Ablauf) | { grund, muster }. Nur Fakten; Stände sind Momentaufnahmen mit offenen Punkten.
export function fruehePruefung(v) {
  try {
    if (!v || v.art !== "fakt") return null;
    const w = wunschStattFakt(v);
    if (w.treffer) return { grund: WUNSCH_GRUND, muster: w.muster };
    const z = zahlOhneBezug(v);
    if (z.treffer) return { grund: ZAHL_GRUND, muster: z.art };
    return null;
  } catch { return null; }
}

// ---------- R4: Herkunft „Seite aus der Seitenwahl“ ----------
// tageslauf.mjs setzt bei Haikus Wahl ziel = { seite, kritisch, wie: "wahl", guete }; die Stufe sieht es als e.ziel.wie.
export const istSeitenwahl = (ziel) => ziel?.wie === "wahl";

// ---------- R3: Zielseite nach dem Zitat geändert ----------
// Zeit der Fundstelle (B1-Format „<sitzung>#<uuid> <ISO-Zeit|?>“) in ms, sonst null (kein/ungültiges Format, Zeit „?“).
export function zitatZeitAusFundstelle(fundstelle) {
  const f = leseFundstelle(fundstelle);
  const ms = f?.zeit ? Date.parse(f.zeit) : NaN;
  return Number.isFinite(ms) ? ms : null;
}
const alsMs = (z) => {
  const ms = z instanceof Date ? z.getTime() : typeof z === "number" ? z : typeof z === "string" && z.trim() ? Date.parse(z) : NaN;
  return Number.isFinite(ms) ? ms : null;
};
const tagVon = (ms) => new Date(ms).toISOString().slice(0, 10);
// Datum aus dem Frontmatter: „2026-10-16“, „2026-10-16T08:00:00Z“ oder „16.10.2026“ (auch in Anführungszeichen). → { ms } (mit Uhrzeit) | { tag } (nur Tag) | null.
function datumAus(wert) {
  const w = String(wert ?? "").trim().replace(/^["']|["']$/g, "");
  let m;
  if ((m = /^(\d{4}-\d{2}-\d{2})[T ]\d{2}:\d{2}/.exec(w))) { const ms = Date.parse(w.includes("T") ? w : w.replace(" ", "T")); return Number.isFinite(ms) ? { ms } : { tag: m[1] }; }
  if ((m = /^(\d{4}-\d{2}-\d{2})$/.exec(w))) return { tag: m[1] };
  if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(w))) return { tag: `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` };
  return null;
}
function frontmatterDatum(text, schluessel) {
  const m = frontmatterText(text).match(new RegExp(`^${schluessel}:[ \\t]*(.*)$`, "m"));
  return m ? datumAus(m[1]) : null;
}

// true, wenn die Zielseite NACH dem Zeitpunkt der Fundstelle geändert wurde (dann kann die Seite den Fakt inzwischen überholt oder schon enthalten haben).
// Gezählt werden nur Commits, die NICHT vom Tageslauf selbst stammen (Autor-Identität AUTOR aus arbeitskopie.mjs; beides muss passen, sonst zählt der Commit mit),
// ungespeicherte Änderungen an der Seite und ein späteres Datum in `stand`/`rev` des Frontmatters (Tagesgenau: erst ein SPÄTERER Tag zählt; die genaue
// Uhrzeit liefert der Commit). Fail-safe: unbekannte Zitatzeit, Seite ohne Verlauf, kein Git, jeder Fehler → true.
export function seiteNeuerAlsZitat(vault, seite, zitatZeit) {
  try {
    const t = alsMs(zitatZeit);
    const rel = String(seite ?? "").split("\\").join("/");
    if (t === null || !rel || rel.startsWith("/") || rel.split("/").includes("..")) return true;
    if (git(vault, vault, ["status", "--porcelain", "--", rel])) return true;                           // ungespeicherte Änderung: sicher neuer
    const log = git(vault, vault, ["log", "--follow", "--format=%cI%x1f%an%x1f%ae", "--", rel]);
    if (!log) return true;                                                                              // nie committet: unbekannt
    for (const zeile of log.split("\n").filter(Boolean)) {
      const [zeit, name, mail] = zeile.split("\u001f");
      if (name === AUTOR.name && mail === AUTOR.email) continue;                                        // vom Tageslauf selbst
      const c = Date.parse(zeit);
      if (!Number.isFinite(c) || c > t) return true;                                                    // ungültige Zeit: unbekannt → neuer
    }
    let text;
    try { text = git(vault, vault, ["show", `HEAD:${rel}`]); } catch { return true; }
    const tag = tagVon(t);
    for (const k of ["stand", "rev"]) {
      const d = frontmatterDatum(text, k);
      if (d && (d.ms !== undefined ? d.ms > t : d.tag > tag)) return true;
    }
    return false;
  } catch { return true; }
}

// ---------- R5: Altbestand ----------
// Anlass: Der Messlauf am echten Bestand ließ nach Richter und R3/R4 genau eine falsche Übernahme durch (eine Aussage der Art „Übrige Felder bleiben im Altsystem“, Zitat vom 15.10.): überholt
// durch SPÄTERE Sitzungen — die Wiki-Seite stammte vom 05.10., also gab es keine Seitenänderung nach dem Zitat (R3), und das Fenster des Richters reicht nicht über alle späteren Sitzungen.
// Beim Altbestand liegt die Wahrheit oft in späteren Sitzungen, die weder der Richter noch das Wiki kennen. Darum nimmt ein Zitat, das mehr als eine Woche alt ist, nie den
// automatischen Weg: Rückfrage (Grund altbestand) statt Übernahme. Frische Zitate (Sitzung der letzten Tage) bleiben automatisch möglich.
export const ALTBESTAND_TAGE = 7;
export const ALTBESTAND_GRUND = "altbestand";
// zitatZeit: ms | Date | ISO-Text (z. B. zitatZeitAusFundstelle); jetzt: Zeitpunkt des Laufs (ms | Date | ISO-Text). „Mehr als 7 Tage“ heißt echt mehr: genau 7 Tage sind noch frisch.
// Fail-safe: fehlender oder ungültiger Zitat-Zeitpunkt (Fundstelle ohne Zeit „?“, kaputtes Format) oder ungültiges Lauf-Datum → alt. Ein Zitat „aus der Zukunft“ (Uhrenabweichung) ist nicht alt.
export function istAltbestand(zitatZeit, jetzt, tage = ALTBESTAND_TAGE) {
  const t = alsMs(zitatZeit), j = alsMs(jetzt);
  if (t === null || j === null) return true;
  return j - t > tage * 86400e3;
}
