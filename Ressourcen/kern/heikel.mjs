// heikel.mjs — Heikel-Erkennung für den Tageslauf (Spec §4.3): Ein „heikler“ Fakt wird NIE automatisch ins
// Wiki übernommen, sondern geht als Rückfrage an den Menschen. Regelbasiert, 0 Tokens, nur Node-Standardbibliothek.
//
//   istHeikel(text) → { heikel: boolean, gruende: Array<"geld"|"recht"|"person"|"zugang"> }
//
// gruende: ohne Doppelte, feste Reihenfolge geld, recht, person, zugang. Leerer Text oder kein String → { false, [] }.
// Es wird nie der getroffene Text zurückgegeben, nur der Grund.
//
// Grundsatz: LIEBER ZU OFT HEIKEL ALS ZU SELTEN. Eine unnötige Rückfrage kostet Sekunden, ein falscher Preis im Wiki
// kostet Vertrauen. Deutsch und englisch; Groß/Klein egal; Wortgrenzen mit Unicode (nicht \b, das kennt keine Umlaute);
// Eingabe wird auf NFC gebracht (macOS liefert Umlaute oft zerlegt).
//
// Bewusste Grenzfälle (alle in test-heikel.mjs festgenagelt):
//  - geld:   „Preis“ ist IMMER geld (auch „Preis 0 €“, auch Komposita wie „Aufpreis“). Kosten/kostet/kostenlos ebenso,
//            auch ohne Betrag („kostet viel Zeit“ ist bewusst heikel). „Angebot“ ist immer geld (nicht nur kaufmännisch).
//            Prozent allein („90 % Abdeckung“) ist NICHT geld; „18 % Marge“ schon (das Wort Marge reicht). „$“ nur mit Ziffer.
//            „Berechnung“, „Belohnung“, „gehalten“, „lohnt“ sind NICHT geld; „Margerite“ auch nicht.
//            Beträge ohne Währungszeichen: „4,20“/„12,99“ (Komma, genau zwei Stellen), „50k“, „800 tsd“, „2,4 Mio“ (nicht „250k Tokens“);
//            EK, VK, UVP, Budget, Miete, Kaution, Deckungsbeitrag, Geld-Komposita auf …satz (Stundensatz) und …wert (Bestellwert) — auch
//            als Teilwort („Jahresbudget“). NICHT geld: „1,5“, „1,234“, Versionen („26.3.0“), Ersatz, Einsatz, Datensatz, Messwert.
//  - recht:  „gesetzt“ ist kein Gesetz (nur Gesetz/Gesetze/gesetzlich …); „ausgerichtet“ ist kein Gericht; „Haftnotiz“ ist
//            keine Haftung; „garantiert“ ist keine Garantie. Jede „Lizenz“ gilt als recht (auch MIT-Lizenz).
//  - person: „Kunde/Kunden/Kundin“ allein reicht (auch ohne Namen), „Kundenservice“ als Kompositum nicht; Kundennummer,
//            -konto, -daten schon. Ein Vorname allein („Anna mag kurze Antworten“) ist NICHT person. Jede „Adresse“ zählt
//            (auch „Speicheradresse“). Datei- und Rechteangaben („Schreibrechte“) sind nicht person.
//  - zugang: „live“ allein ist NICHT zugang („Welle 3 ist live“), „Produktion“, „prod“, „Live-System“ schon.
//            „Server“, „Host“, „Datenbank“, „root“, „admin“ sind immer zugang (auch „MCP-Server“), „Observer“ und „Ghost“
//            nicht. „Token“ ist zugang, außer eine Zahl steht direkt davor („0 Tokens“, „250k Tokens“ = LLM-Zählung).
//            „Zugang“ ja, „Zugriff“ und eine URL allein nein. IPv4 (Oktette ≤ 255) ja, auch eine vierteilige Version wie
//            „1.2.3.4“; IPv6 nur mit mindestens vier Gruppen oder „::“. Uhrzeiten (10:30) sind kein Port.
//  Muster-Quellen: person nutzt hatPii aus pii-muster.mjs, zugang nutzt hatSecretsImKontext aus secrets-muster.mjs.
import { hatPii } from "./pii-muster.mjs";
import { hatSecretsImKontext } from "./secrets-muster.mjs";

// ---------- Bausteine (alle Muster laufen auf kleingeschriebenem, NFC-normalisiertem Text) ----------
const WA = "(?<![\\p{L}\\p{N}])"; // Wortanfang
const WE = "(?![\\p{L}\\p{N}])"; // Wortende
const baue = (src) => new RegExp(src, "u");
// Ganzes Wort (exakte Formen)
const wort = (alt) => baue(`${WA}(?:${alt})${WE}`);
// Wort BEGINNT mit dem Stamm, danach beliebige Endung oder Zusammensetzung
const anfang = (alt) => baue(`${WA}(?:${alt})\\p{L}*`);
// Stamm irgendwo im Wort (Kompositum davor, höchstens 40 Buchstaben, damit die Suche linear bleibt)
const enthaelt = (alt) => baue(`${WA}\\p{L}{0,40}(?:${alt})\\p{L}*`);
const trifft = (muster, t) => muster.some((r) => r.test(t));

// ---------- geld ----------
const GELD = [
  /€|£/u,
  // Zahl dann Währung: „12,50 €“, „12 EUR“, „100 Euro“, „5 USD“, „3 Cent“, „5 $“
  baue("\\d[\\d.,]{0,20}\\s{0,3}(?:\\$|(?:eur|euro|euros|usd|dollar|dollars|gbp|chf|franken|cent|cents|ct)(?![\\p{L}\\p{N}]))"),
  baue("\\$\\s?\\d"), // „$5“ (ein „$“ ohne Ziffer ist Shell/Regex, kein Geld)
  baue(`${WA}(?:eur|usd|gbp|chf)\\s?\\d`), // „EUR 12“
  baue("\\d{1,15}(?:\\.\\d{3}){0,6},\\s?[-–—]"), // „1.200,-“, „12,–“
  // Beträge ohne Währungszeichen (W5): „4,20“, „12,99“, „1.200,50“ (Dezimalkomma, genau zwei Stellen; „1,5“ und „1,234“ nicht);
  // „50k“, „800 tsd“, „2,4 Mio“ (außer „250k Tokens“ — LLM-Zählung, siehe TOKEN_ZAHL)
  baue("(?<![\\d,])\\d+,\\d{2}(?![\\p{N}])"),
  baue(`${WA}\\d+\\s?(?:k|tsd|mio)${WE}(?!\\s{0,3}tokens?${WE})`),
  wort("ek|vk|uvp"), // Einkaufs-/Verkaufspreis, unverbindliche Preisempfehlung
  // Kaufmännische Wörter. Prozent wird nicht eigens geprüft: Marge/Rabatt/Provision lösen für sich allein aus.
  enthaelt("preis|kost(?:en|et|ete|eten|spielig)|gebühr|gebuehr|rabatt|umsatz|zahlung|vergütung|verguetung|überweisung|"
    + "ueberweisung|erstattung|mehrwertsteuer|umsatzsteuer|steuersatz|kontostand|honorar|provision|angebot|budget|miete|kaution|"
    + "deckungsbeitrag"),
  // Satz- und Wert-Komposita nur mit Geld-Vorsilbe: Stundensatz, Tagessatz, Bestellwert, Warenwert … — NICHT Ersatz, Einsatz,
  // Absatz, Datensatz, Messwert, Grenzwert, Mittelwert
  enthaelt("(?:stunden|tages|monats|wochen|jahres|verrechnungs|kilometer|pauschal|regel|mindest|höchst|hoechst|netto|brutto|"
    + "arbeits|tarif|honorar|personal|provisions|gebühren|gebuehren|aufschlags|zuschlags)(?:satz|sätze|saetze)"),
  enthaelt("(?:bestell|waren|auftrags|einkaufs|verkaufs|rechnungs|netto|brutto|warenkorb|liefer|versand|zeit|buch|markt|streit|"
    + "rest|sach|gegen|listen|geld|kauf|mindest|höchst|hoechst|freigrenz)wert"),
  baue(`${WA}(?:\\p{L}{0,40}[ns])?rechnung\\p{L}*`), // Rechnung, Einkaufsrechnung; NICHT Berechnung/Hochrechnung/Verrechnung
  anfang("abrechn|bezahl|auszahl|rückzahl|rueckzahl|skonto|aufschlag|zuschlag|zuschuss|spesen|tarif|bonus|prämie|praemie|"
    + "mahnung|gutschrift|kredit|finanz|schulden|darlehen|teuer|teure|billig|günstig|guenstig|gehälter|gehaelter"),
  baue(`${WA}gehalt(?!e[nt])\\p{L}*`), // Gehalt, Gehaltsabrechnung; NICHT gehalten/gehaltet
  baue(`${WA}\\p{L}{0,40}(?:brutto|netto|grund|monats|jahres|einstiegs|anfangs)gehalt\\p{L}*`),
  baue(`${WA}lohn(?!t(?![\\p{L}])|en(?![\\p{L}])|end|ens)\\p{L}*`), // Lohn, Lohnabrechnung; NICHT lohnt/lohnen/lohnend
  baue(`${WA}\\p{L}{0,40}(?:stunden|monats|brutto|netto|mindest|tarif|arbeits|wochen|tages|jahres)lohn\\p{L}*`),
  wort("löhne|löhnen|loehne|loehnen"),
  baue(`${WA}\\p{L}{0,40}marge(?:n|ns)?${WE}|${WA}margen\\p{L}*`), // Marge, Handelsmarge; NICHT Margerite
  baue(`${WA}\\p{L}{0,40}gewinn(?:e|es|s)?${WE}`), // Gewinn, Reingewinn; NICHT gewinnen
  wort("zahlt|zahlte|zahlten|zins|zinsen|zinssatz|mwst|ust"),
  // englisch
  wort("price|prices|priced|pricing|cost|costs|costly|invoice|invoices|invoiced|revenue|margin|margins|fee|fees|discount|"
    + "discounts|discounted|salary|salaries|wage|wages|payment|payments|payroll|payout|payouts|pay|pays|paid|billing|billed|"
    + "bill|bills|refund|refunds|profit|profits|commission|commissions|expensive|cheap|cheaper|tax|taxes|vat"),
];

// ---------- recht ----------
const RECHT = [
  baue(`${WA}\\p{L}{0,40}vertr(?:ag|äg|aeg)\\p{L}*`), // Vertrag, Verträge, Arbeitsvertrag, Vertragspartner
  wort("agbs?|avv|nda|bgb|hgb|uwg|bdsg|ttdsg|ddg|tmg|eula"),
  enthaelt("dsgvo|gdpr|datenschutz|abmahn|anwalt|anwält|anwaelt|widerruf|impressum|lizenz|gewährleistung|gewaehrleistung|"
    + "haftung|haftpflicht|rechtlich|compliance|schadensersatz|schadenersatz|insolvenz|mahnbescheid|strafanzeige|kündig|"
    + "kuendig|verjährung|verjaehrung|rechtsstreit|rechtslage|rechtsgrundlage|rechtsberatung|rechtssicher|rechtsabteilung|"
    + "rechtsverstoß|rechtsverstoss|rechtswidrig|rechtsprechung|nutzungsbedingung|geschäftsbedingung|geschaeftsbedingung|"
    + "(?:urheber|marken|arbeits|datenschutz|wettbewerbs|steuer|handels|gesellschafts|miet|verbraucher|widerrufs|rückgabe|"
    + "rueckgabe|kauf|vertrags|straf|zivil|patent|presse|persönlichkeits|persoenlichkeits)recht"),
  anfang("haftet|haften|haftbar|urteil|garantie(?!r)"),
  baue(`${WA}\\p{L}{0,40}gericht(?:e|en|s)?${WE}|${WA}gerichts\\p{L}*`), // Gericht, Amtsgericht; NICHT ausgerichtet
  baue(`${WA}\\p{L}{0,40}klage(?:n)?${WE}|${WA}verklag\\p{L}*|${WA}klag(?:t|te|ten)${WE}`), // Klage, Sammelklage; NICHT Klasse
  // Gesetz, Gesetze, gesetzlich, Gesetzgeber; NICHT gesetzt/gesetzte
  baue(`${WA}\\p{L}{0,40}gesetz(?:e|en|buch|geber\\p{L}*|gebung|lich\\p{L}*|es\\p{L}*)?${WE}`),
  baue("§\\s?\\d|§§"),
  baue("paragra(?:f|ph)\\s?\\d"),
  // englisch
  wort("contracts?|contractual|legal|illegal|legally|liability|liable|lawsuits?|lawyers?|attorneys?|law|laws|compliance|gdpr|"
    + "copyright|trademarks?|sued|sue|licen[cs]e|licen[cs]es|licensed|licensing"),
  baue("terms of (?:service|use)"),
];

// ---------- person (zusätzlich zum PII-Filter) ----------
// Titel/Rolle + Eigenname („Frau Meier“, „Kunde Schmidt“, „Dr. Brandt“): braucht die Großschreibung, läuft auf dem Original.
const EIGENNAME = baue(
  "(?<![\\p{L}\\p{N}])(?:Herr|Frau|Hr|Fr|Dr|Prof|Kunde|Kundin|Mitarbeiter|Mitarbeiterin|Bewerber|Bewerberin|Ansprechpartner|"
  + "Ansprechpartnerin|Lieferant|Lieferantin|Chef|Chefin|Inhaber|Inhaberin|Geschäftsführer|Geschäftsführerin|Mr|Mrs|Ms|"
  + "Employee|Applicant|Customer)\\.?:?\\s+(?:(?:Herr|Frau|Dr|Prof)\\.?\\s+)*\\p{Lu}\\p{Ll}{2,}");
const PERSON = [
  wort("kunde|kunden|kundin|kundinnen|kundschaft|customers?|käufer|kaeufer|käuferin|käuferinnen|besteller|bestellerin|"
    + "ansprechpartner|ansprechpartnerin|ansprechpartnerinnen|employees?|applicants?|iban|bic|dob|birthday|birthdate|"
    + "birthplace|birth|address(?:es)?"),
  anfang("kunden(?:nummer|konto|daten|name|akte|adresse|karte)|mitarbeiter|bewerber|bewerbung|azubi|praktikant|personalakte|"
    + "personalnummer|personaldaten|personalgespräch|personalgespraech|lebenslauf|arbeitszeugnis|betriebsrat|krank|schwanger|"
    + "elternzeit|geburtsdatum|geburtstag|geburtsort|geburtsname|geboren|telefonnummer|handynummer|rufnummer|mobilnummer|"
    + "faxnummer|durchwahl|kontonummer|bankverbindung|kreditkarte|sozialversicherung|steuer-?id|personalausweis|reisepass|"
    + "führerschein|fuehrerschein|anschrift|wohnort|wohnsitz|wohnhaft|postleitzahl|privatadresse|vorname|nachname|familienname"),
  enthaelt("adress"), // Adresse, Lieferadresse, IP-Adresse, Mailadresse
];

// ---------- zugang (zusätzlich zu den Secret-Mustern) ----------
const ZUGANG = [
  enthaelt("passw(?:or)?[td]|passwör|passwoer|kennwort|kennwör|passphrase|credential|zugangsdat|anmeldedat|logindat|zugang|zugäng|zugaeng"),
  wort("log-?ins?|logins|einloggen|eingeloggt|oauth|2fa|mfa|totp|sso|ssh|sudo|root|ftp|sftp|ftps|rdp|vnc|telnet|vpn|prod|pin-?code"),
  anfang("einlogg|anmeldename|benutzername|nutzername|username|admin|produktion|production|umgebungsvariable|environment-?variable|env-?var"),
  wort("tokens?"), // Zahl direkt davor („0 Tokens“) wird vorher entfernt, siehe hatZugang
  baue(`${WA}\\p{L}{0,40}schl(?:ü|ue)ssel(?:n)?${WE}`), // Schlüssel, API-Schlüssel, Primärschlüssel; NICHT Schlüsselwort
  wort("api[- ]?keys?|apikeys?|private[- ]?keys?|secret[- ]?keys?|access[- ]?keys?|ssh[- ]?keys?|license[- ]?keys?|key[- ]?pairs?"),
  wort("secrets?"),
  baue(`${WA}\\p{L}{0,40}(?<!ob)server\\p{L}*`), // Server, Webserver, Servername; NICHT Observer
  wort("host|hosts|hostname|hostnamen|hosting|hoster|localhost|vhost|webhost|webhosting"),
  baue(`${WA}(?:produktiv|live)[- ]?(?:system|umgebung|daten|datenbank|server|betrieb|environment|database|data)\\p{L}*`),
  enthaelt("datenbank|database"),
  wort("db|dbs|dsn|mongodb|mongo|postgres|postgresql|mysql|mariadb|sqlite|mssql|redis|db-?url|connection[- ]?strings?|verbindungsstring"),
  wort("kubectl|kubeconfig|kubernetes|k8s|infisical"),
  baue("(?<![\\p{L}\\p{N}])\\.env(?![\\p{L}\\p{N}])"),
  // Host:Port — der Host muss Buchstaben UND (Punkt, Ziffer oder Bindestrich) haben, sonst wäre „10:30“ oder „Hinweis:80“ ein Treffer
  baue(`${WA}(?:localhost|[\\p{L}\\p{N}-]+(?:\\.[\\p{L}\\p{N}-]+)+|\\p{L}+[\\p{N}-][\\p{L}\\p{N}-]*):\\d{2,5}${WE}`),
  // IPv6: mindestens vier Gruppen oder ein „::“ zwischen Hexgruppen
  baue("(?<![\\p{L}\\p{N}:])(?:[0-9a-f]{1,4}:){4,7}[0-9a-f]{1,4}(?![\\p{L}\\p{N}:])"),
  baue("(?<![\\p{L}\\p{N}:])(?:[0-9a-f]{1,4}:){1,6}:(?:[0-9a-f]{1,4})?(?![\\p{L}\\p{N}:])"),
];
const IPV4 = /(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?!\d|\.\d)/g;
// Zahl + „Tokens“ = LLM-Zählung („0 Tokens“, „250k Tokens“), kein Zugangs-Token
const TOKEN_ZAHL = /\d[\d.,]{0,20}\s{0,3}(?:k|m|mio|tsd)?\s{0,3}tokens?(?![\p{L}\p{N}])/gu;

function hatIpv4(t) {
  for (const m of t.matchAll(IPV4)) if ([1, 2, 3, 4].every((i) => Number(m[i]) <= 255)) return true;
  return false;
}

const hatGeld = (t) => trifft(GELD, t);
const hatRecht = (t) => trifft(RECHT, t);
const hatPerson = (original, t) => hatPii(original) || EIGENNAME.test(original) || trifft(PERSON, t);
const hatZugang = (original, t) =>
  hatSecretsImKontext(original) || hatIpv4(t) || trifft(ZUGANG, t.replace(TOKEN_ZAHL, " "));

// Fakten sind kurz (Vorschläge ≤ 6000 Zeichen). Längeres wird nur bis MAX_LAENGE geprüft und gilt in jedem Fall als
// heikel — lieber eine Rückfrage zu viel; außerdem bleibt so der quadratische E-Mail-Teil von pii-muster begrenzt.
export const MAX_LAENGE = 8000;

export function istHeikel(text) {
  if (typeof text !== "string" || !text.trim()) return { heikel: false, gruende: [] };
  const zuLang = text.length > MAX_LAENGE;
  const original = (zuLang ? text.slice(0, MAX_LAENGE) : text).normalize("NFC");
  const t = original.toLowerCase();
  const gruende = [];
  if (hatGeld(t)) gruende.push("geld");
  if (hatRecht(t)) gruende.push("recht");
  if (hatPerson(original, t)) gruende.push("person");
  if (hatZugang(original, t)) gruende.push("zugang");
  return { heikel: zuLang || gruende.length > 0, gruende };
}
