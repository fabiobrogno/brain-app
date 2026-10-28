// .tools/tests/test-heikel.mjs — Heikel-Erkennung (heikel.mjs): je Grund Positive, viele Negative, Mehrfach-Gründe,
// Reihenfolge, Wortgrenzen, Umlaute/Groß-Klein, Eingabe-Härte. Köder (erfundene Zugangsdaten) erst zur Laufzeit zusammengesetzt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { istHeikel } from "../heikel.mjs";

const j = (...t) => t.join("");

// Genau diese Gründe, in genau dieser Reihenfolge (heikel = mindestens ein Grund)
function pruefe(text, ...erwartet) {
  assert.deepEqual(istHeikel(text), { heikel: erwartet.length > 0, gruende: erwartet }, text);
}

// ---------- geld ----------
const GELD = [
  "Der Toner kostet jetzt 24,90 €",
  "Die Marge liegt bei 18 %",
  "Rechnung 4711 wurde gestern bezahlt",
  "Der Einkaufspreis ist gestiegen",
  "Preis 0 €",
  "Das Budget für Q4 steht",
  "Wir geben 20 % Rabatt auf alle Tonerkartuschen",
  "Ab 1.200,- gibt es Mengenrabatt",
  "The price changed to $5",
  "Revenue was flat in Q3",
  "Die Provision beträgt 5 % vom Nettoumsatz",
  "Das Angebot gilt bis Freitag",
  "Die Gehaltsabrechnung läuft am 25.",
  "Es fällt eine Bearbeitungsgebühr an",
  "Die Zahlung kam per Überweisung",
];
for (const text of GELD) test(`geld: ${text}`, () => pruefe(text, "geld"));

test("geld: Betragsformen mit Währung", () => {
  for (const b of ["12,50 €", "€ 12", "12 EUR", "$5", "5 USD", "100 Euro", "1.200,-", "12,– EUR", "€12", "12€",
    "3 Cent", "1,5 Mio. €", "EUR 12", "12.50 USD", "£9"]) pruefe(`Betrag ${b}`, "geld");
});

test("geld: Preis ist immer geld (auch ohne Zahl, auch Preis 0 €), auch Komposita und englisch", () => {
  for (const w of ["Preis", "Preise", "Preisänderung", "Aufpreis", "Mietpreise", "price", "pricing", "cost", "costs",
    "invoice", "revenue", "margin", "fee", "discount", "salary", "Kosten", "Gehalt", "Lohn", "Umsatz", "Marge",
    "Budget", "Rabatt", "Gebühr", "Provision", "Angebot", "Zahlung"]) pruefe(`Thema ${w}`, "geld");
});

test("geld (W5): Beträge ohne Währungszeichen — Dezimalkomma mit zwei Stellen, k/tsd/Mio, Kaufmannswörter auch in Komposita", () => {
  for (const t of [
    "EK 4,20, VK 12,99", "UVP 29,99", "Miete 1.200 im Monat", "Stundensatz 85", "Jahresbudget 50k", "Mindestbestellwert 25",
    "Deckungsbeitrag 3,10", "Der Toner TN-2420 liegt im VK bei 12,99.", "Die Kaution beträgt 3 Monatsmieten.",
    "Wir haben 2,4 Mio Ertrag gemacht.", "Es kommen 800 tsd dazu", "Rabattiert auf 1.200,50", "Der Tagessatz liegt bei 400",
    "Die Stundensätze steigen", "Der Warenwert muss über 40 liegen", "Der Auftragswert beträgt 5000", "Kaltmiete 650",
    "Die Mieten steigen", "Der UVP ist gesenkt", "ek 3,5 vk 7", "Das Quartalsbudget wurde gekürzt", "Kosten pro Stück 0,75",
  ]) pruefe(t, "geld");
});

test("geld (W5): Zahlen, Versionen und Wörter, die nur so ähnlich sind, bleiben unheikel", () => {
  for (const t of [
    "Welle 3 ist live", "Node 26.3.0 ist installiert", "Kit 0.5.1 ist veröffentlicht", "Der Kontext hat 250k Tokens", "Der Lauf braucht 2 Mio Tokens",
    "Die Datei hat 50kB", "Das Ersatzteil liegt im Regal", "Der Einsatz beginnt um 8", "Absatz 3 steht im Text", "Datensatz 12 ist kaputt",
    "Satz 4 ist zu lang", "Der Wert 12 ist gültig", "Der Messwert liegt bei 5", "Der Grenzwert ist 10", "Der Mittelwert beträgt 3",
    "Das Mietauto steht vor der Tür", "Die Version 1,5 ist draußen", "Die Version 1,234 ist draußen", "Zeile 12,5 im Log",
    "Das Frontmatter braucht name und description", "Der Rahmen hat 12 Mitglieder", "Sek 5 und Vokabel 3", "Die Ekliptik ist gezeichnet",
  ]) pruefe(t);
});

test("geld: Prozent allein ist kein Geld, Prozent mit Marge/Rabatt/Provision schon", () => {
  pruefe("Das Skript deckt 90 % der Fälle ab");
  pruefe("Die Abdeckung liegt bei 85 Prozent");
  pruefe("Marge 18 %", "geld");
  pruefe("12 Prozent Rabatt", "geld");
  pruefe("3 % Provision", "geld");
});

// ---------- recht ----------
const RECHT = [
  "Ab 1.11. gilt die neue DSGVO-Vorlage",
  "Der Vertrag mit dem Lieferanten läuft bis Ende 2027",
  "Die AGB wurden im Oktober angepasst",
  "Auf der Seite fehlt das Impressum",
  "Nach § 312g gilt eine Frist von 14 Tagen",
  "Der Anwalt prüft die Abmahnung",
  "The contract excludes liability",
  "Die Datenschutzerklärung wurde aktualisiert",
  "Das Gesetz tritt 2027 in Kraft",
  "Für die Lizenz gelten besondere Bedingungen",
  "Das Widerrufsrecht gilt 14 Tage",
  "Die Haftung ist auf Vorsatz beschränkt",
];
for (const text of RECHT) test(`recht: ${text}`, () => pruefe(text, "recht"));

test("recht: weitere Wörter (deutsch + englisch)", () => {
  for (const w of ["GDPR", "Klage", "Sammelklage", "Gewährleistung", "Widerruf", "Impressum", "Compliance", "Verträge",
    "Arbeitsvertrag", "rechtlich", "Lizenzbedingungen", "lawsuit", "legal", "liability", "contract", "Abmahnung",
    "Kündigung", "Gesetze", "gesetzlich", "§ 5", "§§ 5 ff."]) pruefe(`Thema ${w}`, "recht");
});

// ---------- person ----------
const PERSON = [
  "Kunde Schmidt hat angerufen",
  "Frau Meier ist ab Montag nicht erreichbar",
  "Der Bewerber startet am 1.12.",
  "Das Geburtsdatum fehlt im Formular",
  "Die Lieferadresse wurde geändert",
  `Anfragen gehen an ${j("max.muster", "@", "example", ".test")}`,
  `Rückruf unter ${j("0171 ", "1234567")}`,
  "Mitarbeiterin Lena ist krank",
  "Der Kunde wartet auf eine Antwort",
  "Herr Dr. Brandt macht die Einarbeitung",
];
for (const text of PERSON) test(`person: ${text}`, () => pruefe(text, "person"));

test("person: PII-Filter (E-Mail, Telefon, IBAN, Anschrift) schlägt an", () => {
  pruefe(j("Konto ", "DE89 ", "3704 0044 ", "0532 0130 00"), "person");
  pruefe(j("Sitz: Muster", "straße 12"), "person");
  pruefe(j("Sitz in Beispielburg, ", "12345 Musterstadt"), "person");
  pruefe(j("Tel. +49 ", "171 ", "2345678"), "person");
});

test("person: Kunde mit Eigenname-Muster, Vorname allein nicht", () => {
  pruefe("Kundin Müller hat reklamiert", "person");
  pruefe("Kunde: Schulz", "person");
  pruefe("Bewerberin Anna Schwarz kommt am Dienstag", "person");
  pruefe("Anna mag kurze Antworten");
  pruefe("Lena und Max arbeiten am Brain-Kit");
});

// ---------- zugang ----------
const ZUGANG = [
  "Der Shop läuft auf dem Server hetzner-2",
  "Das Passwort wurde geändert",
  "Zugangsdaten liegen in Infisical",
  "Die Datenbank läuft auf 10.0.0.5:27017",
  "Deploy per kubectl auf die Produktion",
  "Der API-Key steht in der .env-Datei",
  "Login nur noch mit Admin-Konto",
  "SSH-Zugriff nur für root",
  "Connection String steht im Tresor",
  "The server uses a self-signed certificate",
  "Die Kiste hört auf 192.168.1.20",
  "Die Kiste hört auf 2001:db8::1",
  "Erreichbar über db1:5432",
  "Die Verbindung geht an shop.example.com:8443",
  "Das Live-System ist erreichbar",
];
for (const text of ZUGANG) test(`zugang: ${text}`, () => pruefe(text, "zugang"));

test("zugang: Secret-Muster (ohne jedes Stichwort) schlagen an", () => {
  pruefe(`Nutze ${j("ghp_", "a1B2".repeat(9))} weiter`, "zugang");
  pruefe(`Zugriff mit ${j("AKIA", "A".repeat(16))}`, "zugang");
  pruefe(j("Aufruf mit Authoriz", "ation: Bea", "rer abc123def456"), "zugang");   // Köder zur Laufzeit zusammengesetzt (publish-check)
});

test("zugang: weitere Wörter (deutsch + englisch)", () => {
  for (const w of ["Passwort", "Kennwort", "Zugang", "Login", "Token", "API-Schlüssel", "Secret", "SSH", "Host", "hostname",
    "Produktion", "Prod-Umgebung", "Datenbank", "DB-URL", "kubectl", "Infisical", "root", "admin", "password",
    "credentials", "Zugangsdaten", "Produktivsystem", "Live-Umgebung", "MongoDB", "localhost"]) pruefe(`Thema ${w}`, "zugang");
});

// ---------- Grenzfälle (bewusst) ----------
test("Grenzfall: live allein ist kein zugang, Produktion/Live-System schon", () => {
  pruefe("Welle 3 der Stammdaten ist live");
  pruefe("Die Seite geht morgen live");
  pruefe("Welle 3 geht in die Produktion", "zugang");
  pruefe("Das Live-System läuft", "zugang");
});

test("Grenzfall: Token ist zugang, außer eine Zahl steht direkt davor (LLM-Zählung)", () => {
  pruefe("Der Token läuft morgen ab", "zugang");
  pruefe("Der Lauf braucht 0 Tokens");
  pruefe("Der Kontext hat 250k Tokens");
  pruefe("Der API-Token läuft ab", "zugang");
});

test("Grenzfall: Preis ist immer geld, auch Preis 0 €; Kosten/kostet auch ohne Betrag", () => {
  pruefe("Preis 0 €", "geld");
  pruefe("Das Debuggen kostet viel Zeit", "geld");
  pruefe("Der Download ist kostenlos", "geld");
});

test("Grenzfall: IPv4 nur mit Oktetten bis 255; Uhrzeiten und Versionen sind keine Adresse", () => {
  pruefe("Version 999.1.1.1 und Stand 2026.10.21");
  pruefe("Meeting von 10:30 bis 11:45 Uhr");
  pruefe("Die Version 1.2.3 ist draußen");
  pruefe("Gateway 10.0.0.1", "zugang");
});

test("Grenzfall: Kunde allein ist person, Kundenservice als Wort nicht", () => {
  pruefe("Der Kundenservice-MCP liefert Tickets");
  pruefe("Kunden melden sich per Mail", "person");
});

// ---------- Negative ----------
const NEGATIV = [
  "Die Tests laufen mit node --test",
  "Welle 3 der Stammdaten ist live",
  "Die App heißt vorläufig Brain",
  "Wiki-Seiten haben höchstens 150 Zeilen",
  "Der Hook prüft beim Read passende Regeln",
  "Anna mag kurze Antworten",
  "Der Observer-Hook reagiert auf Dateiänderungen",
  "Das Flag ist gesetzt",
  "Das lohnt sich",
  "Die Berechnung der Dauer ist einfach",
  "Der Tageslauf startet um 03:30 Uhr",
  "Die Version 0.7 enthält das Modul heikel.mjs",
  "Der Ghost-Modus zeigt Vorschläge an",
  "Die Suche nutzt qmd mit einem lokalen Index",
  "Die Klasse wurde umbenannt",
  "Sitzungen enden mit einem Handoff",
  "Die Karte wurde am Raster ausgerichtet",
  "Der Zustand wurde gehalten",
  "Beim Belohnen zählt die Zeile",
  "Die Margerite blüht im Mai",
  "Skills liegen unter .claude/skills",
  "Das Frontmatter braucht name und description",
];
for (const text of NEGATIV) test(`negativ: ${text}`, () => pruefe(text));

// ---------- Mehrfach-Gründe, Reihenfolge, Dubletten ----------
test("Mehrfach-Gründe in fester Reihenfolge geld, recht, person, zugang", () => {
  pruefe("Der Vertrag mit Kunde Schmidt sieht 5 % Rabatt vor", "geld", "recht", "person");
  pruefe("Kunde Schmidt zahlt 12 € laut Vertrag, Zugang per SSH", "geld", "recht", "person", "zugang");
  pruefe("Der Anwalt bekommt die Zugangsdaten", "recht", "zugang");
  pruefe("Passwort für den Server in Infisical; Rechnung folgt", "geld", "zugang");
  pruefe("Frau Meier hat die Kündigung erhalten", "recht", "person");
});

test("Reihenfolge hängt nicht von der Stellung im Text ab", () => {
  pruefe("Server-Passwort, danach Preis 5 €", "geld", "zugang");
  pruefe("Login für Kunde Schmidt, Vertrag und Preis", "geld", "recht", "person", "zugang");
});

test("keine Doppelten, auch bei vielen Treffern desselben Grundes", () => {
  pruefe("Preis Kosten Rechnung Gehalt Marge 12 € 5 USD Rabatt", "geld");
  pruefe("Vertrag AGB DSGVO Anwalt Klage § 5", "recht");
});

// ---------- Wortgrenzen, Umlaute, Groß/Klein ----------
test("Groß/Klein egal", () => {
  pruefe("PREIS", "geld");
  pruefe("preis", "geld");
  pruefe("dsgvo", "recht");
  pruefe("DSGVO", "recht");
  pruefe("PASSWORT", "zugang");
  pruefe("GEBÜHR", "geld");
});

test("Umlaute und ihre Umschreibungen, auch zerlegt (NFD, wie unter macOS)", () => {
  pruefe("Gebühr", "geld");
  pruefe("Gebuehr", "geld");
  pruefe("Gebühr", "geld");
  pruefe("Gewährleistung", "recht");
  pruefe("Gewährleistung", "recht");
  pruefe("Kuendigung", "recht");
  pruefe("Zugänge", "zugang");
  pruefe("Zugänge", "zugang");
  pruefe("Löhne", "geld");
  pruefe("Passwörter", "zugang");
});

test("Wortgrenzen: Treffer mitten im Wort zählen nicht", () => {
  pruefe("Belohnung");
  pruefe("Observer");
  pruefe("Ghost");
  pruefe("gesetzt");
  pruefe("Berechnung");
  pruefe("Margerite");
  pruefe("Klasse");
  pruefe("ausgerichtet");
  pruefe("Redistribution");
  pruefe("Hochrechnung");
  pruefe("Schlüsselwort");
  pruefe("Haftnotiz");
});

test("Wortgrenzen: Komposita mit dem Stichwort am Wortende zählen", () => {
  pruefe("Versandkosten", "geld");
  pruefe("Einkaufsrechnung", "geld");
  pruefe("Mindestlohn", "geld");
  pruefe("Webserver", "zugang");
  pruefe("Landgericht", "recht");
  pruefe("Primärschlüssel", "zugang");
});

// ---------- Eingabe-Härte ----------
test("leerer oder kein String → nicht heikel, keine Gründe", () => {
  const leer = { heikel: false, gruende: [] };
  for (const x of ["", "   ", "\n\t", null, undefined, 42, 0, true, {}, [], ["Preis"], () => "Preis"]) {
    assert.deepEqual(istHeikel(x), leer, String(x));
  }
});

test("Rückgabe: genau { heikel, gruende }, gruende ist ein frisches Array aus bekannten Werten", () => {
  const r = istHeikel("Preis, Vertrag, Kunde Schmidt, Server");
  assert.deepEqual(Object.keys(r).sort(), ["gruende", "heikel"]);
  assert.equal(r.heikel, true);
  assert.deepEqual(r.gruende, ["geld", "recht", "person", "zugang"]);
  r.gruende.push("x");
  assert.deepEqual(istHeikel("Preis, Vertrag, Kunde Schmidt, Server").gruende, ["geld", "recht", "person", "zugang"]);
});

test("der Fundtext wird nie zurückgegeben (nur Gründe)", () => {
  const geheim = j("ghp_", "a1B2".repeat(9));
  assert.ok(!JSON.stringify(istHeikel(`Nutze ${geheim}`)).includes(geheim));
});

// Fakten sind kurz. Die Obergrenze 20000 Zeichen deckt auch Fehleingaben ab; der E-Mail-Teil von pii-muster.mjs wächst
// bei einem einzigen, sehr langen Wort quadratisch (außerhalb dieses Moduls), deshalb hier nicht 200000.
test("lange Texte bleiben schnell (keine Regex-Explosion)", () => {
  const t0 = Date.now();
  istHeikel("a".repeat(20000));
  istHeikel("1".repeat(20000));
  istHeikel("ab ".repeat(7000));
  istHeikel("1.".repeat(10000));
  istHeikel("Preis ".repeat(3000));
  assert.ok(Date.now() - t0 < 5000, `zu langsam: ${Date.now() - t0} ms`);
});

test("zu lange Texte gelten immer als heikel", () => {
  assert.equal(istHeikel("Welle 3 ist live. ".repeat(600)).heikel, true);
  assert.equal(istHeikel("Welle 3 ist live.").heikel, false);
});
