// .tools/tests/test-tageslauf-regeln.mjs — Feste Regeln des Tageslaufs (tageslauf/regeln.mjs), reine Funktionen ohne KI:
// R1 wunschStattFakt · R2 zahlOhneBezug · fruehePruefung · R3 seiteNeuerAlsZitat · R4 istSeitenwahl · saetze.
// Beispiele sind erfunden (Gartenteich, Orion); sie bilden die Formen der echten Fehlurteile nach (Wunsch/Auftrag, Messzahl ohne Zeitraum) und die
// Gegenbeispiele, die NICHT getroffen werden dürfen (Regeln, Passiv, Konfigurationswerte, Ports/Versionen/IDs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { isoliere, neuerTestVault, seitenText, git, schreibeSeite } from "./tageslauf-hilfe.mjs";
const R = await import("../tageslauf/regeln.mjs");
const { AUTOR } = await import("../tageslauf/arbeitskopie.mjs");
isoliere();

const w = (titel, text = "Der Teich liegt im Garten.") => R.wunschStattFakt({ titel, text });
const z = (titel, text) => R.zahlOhneBezug({ titel, text });

test("Konstanten: Gründe sind gültige Archiv-Ordnernamen", () => {
  assert.equal(R.WUNSCH_GRUND, "wunsch-statt-fakt");
  assert.equal(R.ZAHL_GRUND, "zahl-ohne-bezug");
  for (const g of [R.WUNSCH_GRUND, R.ZAHL_GRUND]) assert.match(g, /^[a-z0-9-]{1,40}$/);
});

// ---------- saetze ----------
test("saetze: Abkürzungen, Dezimalzahlen, Datumsangaben und Versionen trennen nicht; Satzende vor Großbuchstabe schon", () => {
  assert.deepEqual(R.saetze("Der Filter (z. B. Typ A) kostet ca. 5,50 € und läuft seit 14.10.2026. Danach folgt Version 1.2.3 im Teich."),
    ["Der Filter (z. B. Typ A) kostet ca. 5,50 € und läuft seit 14.10.2026.", "Danach folgt Version 1.2.3 im Teich."]);
  assert.deepEqual(R.saetze("Erster Satz! Zweiter Satz? „Dritter“ Satz."), ["Erster Satz!", "Zweiter Satz?", "„Dritter“ Satz."]);
  assert.deepEqual(R.saetze("  "), []);
  assert.deepEqual(R.saetze(undefined), []);
  assert.deepEqual(R.saetze("Nur ein Satz ohne Punkt"), ["Nur ein Satz ohne Punkt"]);
});

// ---------- R1 ----------
test("R1: Modalverb soll/sollen/sollte im Titel oder Kernsatz = Wunsch/Auftrag/Vorhaben", () => {
  for (const [titel, text, muster] of [
    ["Kacheln sollen löschbar sein", "Der Teich hat Kacheln.", "soll"],
    ["Pumpe leiser", "Die Pumpe soll nachts leiser laufen.", "soll"],
    ["Pumpe leiser", "Die Pumpe sollte nachts leiser laufen, weil die Nachbarn schlafen.", "soll"],
    ["Pumpe leiser", "Die Pumpen sollten gedrosselt werden.", "soll"],
    ["Filter nicht an Strang 2", "Der Filter soll nicht an Strang 2 hängen.", "soll"],
  ]) { const r = w(titel, text); assert.equal(r.treffer, true, `${titel} / ${text}`); assert.equal(r.muster, muster, text); }
});

test("R1: soll in Nebensatz/Frage und Nomen „Soll“ sind kein Wunsch; soll erst im zweiten Satz zählt nicht (Kernsatz-Regel)", () => {
  assert.equal(w("Rechte im Teichportal", "Wer den Preis nicht sehen soll, bekommt die Rolle keine.").treffer, false, "Relativsatz beschreibt eine Regel");
  assert.equal(w("Rechte im Teichportal", "Was die Pumpe tun soll, steht im Handbuch.").treffer, false);
  assert.equal(w("Soll und Haben", "Soll und Haben stimmen überein.").treffer, false, "Nomen Soll");
  assert.equal(w("Soll-Wert", "Der Soll-Wert beträgt fünf.").treffer, false);
  assert.equal(w("Pumpe läuft nachts", "Die Pumpe ist leise. Der Filter soll später getauscht werden.").treffer, false, "zweiter Satz: prüft der Abgleich");
  assert.equal(w("Pumpe läuft nachts", "Die Pumpe ist leise. Der Filter soll später getauscht werden.").treffer, false);
});

test("R1: eine ausdrückliche Vorgabe/Entscheidung im Kernsatz macht „soll“ zur Regel — „noch nicht festgelegt“ nicht", () => {
  assert.equal(w("Nur lesender Zugriff", "Die Vorgabe des Nutzers: Das Portal darf nur lesen und der Bestand soll so bleiben, wie er ist.").treffer, false);
  assert.equal(w("Leitregel Meldungen", "Die Leitregel: Meldungen sollen nie doppelt kommen.").treffer, false);
  assert.equal(w("Filter", "Beschlossen: Der Filter soll im Keller stehen.").treffer, false);
  assert.equal(w("Filter", "Der Filtertyp ist festgelegt, der Filter soll im Keller stehen.").treffer, false);
  assert.equal(w("Preise", "Die Preise sind noch nicht festgelegt und sollen etwas höher liegen.").muster, "soll");
  assert.equal(w("Preise", "Ob die Pumpe getauscht wird, ist noch nicht entschieden; der Filter soll bleiben.").muster, "soll");
});

test("R1: eine bestimmte Person will/möchte/plant etwas; „möchte, dass …“; Mehrzahl nur bei „Wir“", () => {
  for (const [titel, text] of [
    ["Teich vergrößern", "Der Nutzer will den Teich vergrößern."],
    ["Teich vergrößern", "Der Nutzer möchte den Teich auch im Winter nutzen."],
    ["Teich vergrößern", "Die Nutzerin wollte den Filter sofort tauschen."],
    ["Teich vergrößern", "Der Nutzer plant einen zweiten Teich."],
    ["Teich vergrößern", "Der Nutzer erwägt einen zweiten Teich."],
    ["Teich vergrößern", "Wir wollen den Teich vergrößern."],
    ["Pumpe leiser", "Anna möchte, dass die Pumpe leiser läuft."],
    ["Pumpe leiser", "Der Chef will, dass der Filter getauscht wird."],
  ]) assert.equal(w(titel, text).treffer, true, text);
  for (const text of ["Im Januar wollen viele Leute mit Sport anfangen.", "Kunden wollen schnelle Lieferung.", "Nutzer wollen weniger Klicks.",
    "Das Skript will Schreibrechte auf dem Ordner.", "Wer will, kann den Teich sehen."]) assert.equal(w("Marktfakt", text).treffer, false, text);
});

test("R1: Wunschwort im Titel/Kernsatz — aber nicht die Regelform „auf (ausdrücklichen) Wunsch“", () => {
  assert.equal(w("Live-Gang am selben Tag gewünscht").treffer, true);
  assert.equal(w("Wunschfunktion: mehrere Teiche").treffer, true);
  assert.equal(w("Filter", "Ein zweiter Filter wäre wünschenswert.").treffer, true);
  assert.equal(w("Workflows nur auf Anfrage", "Workflows laufen nur auf ausdrücklichen Wunsch des Nutzers.").treffer, false);
  assert.equal(w("Workflows nur auf Anfrage", "Workflows laufen nur auf Wunsch des Nutzers.").treffer, false);
});

test("R1: geplant — „Geplant ist“, „ist geplant“, Titel auf „geplant“; nicht „nicht geplant“, „wie geplant“, „geplante“", () => {
  assert.equal(w("Schalter je Teich", "Geplant ist je ein Schalter für die Pumpe.").treffer, true);
  assert.equal(w("Umstellung", "Die Umstellung ist geplant.").treffer, true);
  assert.equal(w("Umstellung", "Die Umstellung ist noch geplant.").treffer, true);
  assert.equal(w("Snapshots und Konten geplant").treffer, true);
  assert.equal(w("Umstellung", "Die Umstellung ist nicht geplant.").treffer, false);
  assert.equal(w("Umstellung", "Die Umstellung lief wie geplant.").treffer, false);
  assert.equal(w("Umstellung", "Die geplante Umstellung dauerte zwei Stunden.").treffer, false);
  assert.equal(w("Umstellung ist nicht geplant").treffer, false);
});

test("R1: Vorhaben im Passiv (wird … eingeführt/umgestellt) und Werden-Prädikativ (X werden Y.) — nicht normales Passiv, nicht verneint", () => {
  assert.equal(w("Filter", "Der Filter wird nächste Woche eingeführt.").muster, "vorhaben-passiv");
  assert.equal(w("Filter", "Die Pumpen werden schrittweise umgestellt.").muster, "vorhaben-passiv");
  assert.equal(w("Filter", "Der Speicher wird neu aufgesetzt.").muster, "vorhaben-passiv");
  assert.equal(w("Reihenfolge", "Neue Felder werden zuerst über das Portal ausgerollt und erst danach im Connector genutzt.").treffer, false, "feste Reihenfolge = Regel");
  assert.equal(w("Filter", "Es wird kein Klick-Protokoll eingeführt, weil es die Leistung kostet.").treffer, false, "Verneinung = Entscheidung");
  assert.equal(w("Filter", "Die Pumpen werden nicht umgestellt.").treffer, false);
  assert.equal(w("Vier Becken werden Pflanzteiche").muster, "werden-nomen");
  assert.equal(w("Filter", "Die Becken werden eigene Pflanzteiche.").muster, "werden-nomen");
  assert.equal(w("Filter", "Das wird Pflicht.").muster, "werden-nomen");
  for (const text of ["Die Daten werden gespeichert.", "Die Pumpe wird nachts gedrosselt.", "Es werden Dateien angelegt.", "Dann wird eine Bestätigung verlangt.",
    "Werte werden täglich neu berechnet.", "Das Konto wird gesperrt."]) assert.equal(w("Betrieb", text).treffer, false, text);
});

test("R1: Aufgabenform im Titel (… aufnehmen/einbauen/prüfen/klären) — nicht bei Regelformen (immer/nie/nur/erst/vor jedem …)", () => {
  for (const titel of ["Filter im Teich aufnehmen", "Pumpe in den Plan einbauen", "Glasfaseranschluss bei der Telekom prüfen", "Rechte der Rolle klären",
    "Projekt-ID über die Verwaltung ermitteln", "Preis mit den Konditionen kalkulieren", "Zugang bei Admins neu einrichten"]) {
    assert.deepEqual([titel, w(titel).muster], [titel, "aufgabe-titel"]);
  }
  for (const titel of ["Vor jedem Upload prüfen", "Erst VPN prüfen", "Immer zuerst die Doku prüfen", "Nie ungeprüft übernehmen", "Nur freigegebene Texte einbauen",
    "Nach Läufen immer neu starten", "Ohne Freigabe nicht ergänzen"]) assert.equal(w(titel).treffer, false, titel);
  assert.equal(w("Teich prüfen lassen", "Der Teich wurde geprüft.").treffer, false, "nicht am Ende");
  assert.equal(w("Das Prüfen", "Das Prüfen dauert lang.").treffer, false);
});

test("R1: offene Punkte im Titel — „noch/vorerst offen“, „Entscheidung offen“, „Offene Frage:“, Fragezeichen", () => {
  assert.equal(w("Hero-Pumpe noch offen").treffer, true);
  assert.equal(w("Rollen im Team vorerst offen").treffer, true);
  assert.equal(w("Entscheidung zum Filter offen").treffer, true);
  assert.equal(w("Offene Entscheidung: Filtertyp").treffer, true);
  assert.equal(w("Offene Fragen aus dem Review").treffer, true);
  assert.equal(w("Sollen Meldungen in eigene Räume gehen?").treffer, true);
  assert.equal(w("Pumpe", "Wartung steht noch aus.").treffer, false, "nur im Titel");
  assert.equal(w("Port 8080 ist offen").treffer, false, "offen im Sinn von geöffnet");
  assert.equal(w("Der offene Teich im Garten").treffer, false);
});

test("R1: Titel-Präfix Ziel/Ziele/Idee/Vorschlag/Aufgabe/Frage — nicht „Zielbild“", () => {
  for (const titel of ["Ziel: Teich prüfen", "Ziele: Leise, groß, sauber", "Ziel „Nachtlauf“: vollständige Daten", "Idee: zweiter Filter", "Vorschlag: Pumpe tauschen", "Frage: Welcher Filter?"]) {
    assert.deepEqual([titel, w(titel).treffer], [titel, true]);
  }
  assert.equal(w("Zielbild v2: ein Kern mit Bereichen").treffer, false);
  assert.equal(w("Zielversion 26.3").treffer, false);
});

test("R1: offene Arbeit im Kernsatz (muss noch …, muss … geklärt werden, muss man noch schauen) — ein bloßes „muss“ ist eine Regel", () => {
  assert.equal(w("Pumpe", "Die Pumpe muss noch geprüft werden.").muster, "muss-noch");
  assert.equal(w("Pumpe", "Das muss vor dem Winter geklärt werden.").muster, "muss-noch");
  assert.equal(w("Preis", "Dazu muss man noch schauen, was DHL verlangt.").muster, "muss-noch");
  for (const text of ["Port 8080 muss in der Firewall offen sein.", "Die Pumpe muss nachts laufen.", "Jede Änderung muss über den Schreibweg laufen.",
    "Der Merge #590 muss vor #125 gemergt werden.", "Das Sicherheitsdatenblatt ist Pflicht, fehlt es, muss die Ansicht eine Lücke zeigen."]) assert.equal(w("Regel", text).treffer, false, text);
});

test("R1: Ankündigung ohne Datum (kommen bald/in Kürze/demnächst) — nicht „kommt später über Lizenz“", () => {
  assert.equal(w("Neue Pumpen kommen bald").muster, "kommt-bald");
  assert.equal(w("Pumpen", "Für den Teich kommen in Kürze mehrere Pumpen.").muster, "kommt-bald");
  assert.equal(w("Pumpen", "Der Filter kommt demnächst in den Shop.").muster, "kommt-bald");
  assert.equal(w("Premium", "Die Pflege kommt später über die Lizenz.").treffer, false);
  assert.equal(w("Pumpen", "Die Pumpen kommen aus Hamburg.").treffer, false);
  assert.equal(w("Pumpen", "Wer bald kommt, sieht den Teich.").treffer, false, "bald vor kommt");
});

test("R1: Wunsch im Konjunktiv (wäre gut/schön/sinnvoll, am besten wäre)", () => {
  assert.equal(w("Filter", "Es wäre gut, den Filter zu tauschen.").treffer, true);
  assert.equal(w("Filter", "Am besten wäre ein zweiter Filter.").treffer, true);
  assert.equal(w("Filter", "Ein zweiter Filter wäre sinnvoll.").treffer, true);
  assert.equal(w("Filter", "Der Filter wäre im Keller.").treffer, false);
});

test("R1: echte Fakten und Regeln werden nicht getroffen; ohne Titel/Text und kaputte Eingaben wirft nichts", () => {
  for (const [titel, text] of [
    ["Pumpe läuft nachts", "Die Pumpe läuft nachts mit halber Leistung."],
    ["Teichfilter Typ A", "Der Filter Typ A reinigt 20.000 Liter."],
    ["Meldungen nur auf aktuellen Daten", "Der Nutzer verlangt, dass alle Meldungen auf immer aktuellen Daten beruhen."],
    ["Port 8080", "Port 8080 muss in der Firewall offen sein."],
    ["Version 0.3.0 live", "Die Version 0.3.0 ist deployed."],
    ["Keine Branch-Protection", "Branch-Protection wird nicht vorgeschlagen, weil niemand auf Reviews warten muss."],
    ["Loyalty selbst gebaut", "Das Loyalty-Programm wird selbst gebaut."],
    ["Fehlerquote über 5 %", "Steigt die Fehlerquote über 5 %, wird die Übernahme enger."],
  ]) assert.deepEqual([titel, w(titel, text).treffer], [titel, false]);
  for (const eingabe of [undefined, null, {}, { titel: null, text: null }, { titel: 5, text: [] }, "x"]) assert.deepEqual(R.wunschStattFakt(eingabe), { treffer: false });
});

// ---------- R2 ----------
test("R2: Prozent/Anteil, Geldbetrag, Mengen-Messwert ohne Zeitraum oder Datum → Treffer mit Art", () => {
  const hit = z("Pumpen zuletzt 58 % auf Stufe 2", "Im Auswertungszeitraum liefen 58 % der Pumpen auf Stufe zwei und nur 1 % auf Stufe eins.");
  assert.deepEqual([hit.treffer, hit.art], [true, "prozent"], "„zuletzt“ und „Auswertungszeitraum“ sind kein Zeitraum");
  assert.deepEqual(z("Prüfer uneinig", "Die Prüfer waren sich in 74 % der Fälle einig.").art, "prozent");
  assert.deepEqual(z("Umsatz", "Der Umsatz lag bei 12.500 €.").art, "betrag");
  assert.deepEqual(z("Kosten 340 Euro", "Der Betrieb kostet 340 Euro.").art, "betrag");
  assert.deepEqual(z("Katalog", "Der Katalog enthält 1.976 Einträge.").art, "menge");
  assert.deepEqual(z("Bestseller", "Das Modell ist mit 55 von 103 Bestellungen der Bestseller.").art, "menge");
  assert.deepEqual(z("Rückstand", "Es stehen rund 25.000 Anfragen aus.").art, "menge");
  assert.equal(z("Pumpen 58 %", "Die Pumpen laufen gut.").treffer, false, "geprüft werden die Sätze des Textes; der Titel fasst sie nur zusammen");
});

test("R2: ein Zeitraum oder Datum irgendwo im Text nimmt die Regel weg — vage Verweise nicht", () => {
  for (const [titel, text] of [
    ["Pumpen 58 % auf Stufe 2", "Stand 08.10.: 58 % der Pumpen liefen auf Stufe zwei."],
    ["Pumpen 58 % auf Stufe 2", "Am 14.10. liefen 58 % der Pumpen auf Stufe zwei."],
    ["Pumpen 58 % auf Stufe 2", "Im Oktober 2026 liefen 58 % der Pumpen auf Stufe zwei."],
    ["Pumpen 58 % auf Stufe 2", "In den letzten 30 Tagen liefen 58 % der Pumpen auf Stufe zwei."],
    ["Pumpen 58 % auf Stufe 2", "Im Oktober liefen 58 % der Pumpen auf Stufe zwei."],
    ["Pumpen 58 % auf Stufe 2", "Seit dem Umbau laufen 58 % der Pumpen auf Stufe zwei."],
    ["Pumpen 58 % auf Stufe 2", "Im Q3 liefen 58 % der Pumpen auf Stufe zwei."],
    ["Pumpen 58 % auf Stufe 2", "Täglich laufen 58 % der Pumpen auf Stufe zwei."],
    ["Anfragen", "Es kommen etwa 1.800 Anfragen pro Tag."],
    ["Orion kostet 1.200 € im Monat", "Orion kostet 1.200 € im Monat."],
    ["Tagesbudget", "Das Tagesbudget liegt bei 50.000 Tokens."],
    ["Katalog 2026-10-14", "Der Katalog enthält 1.976 Einträge."],
  ]) assert.equal(z(titel, text).treffer, false, `${titel} / ${text}`);
  for (const text of ["Zuletzt liefen 58 % der Pumpen auf Stufe zwei.", "Derzeit laufen 58 % der Pumpen auf Stufe zwei.", "Bisher liefen 58 % der Pumpen auf Stufe zwei.",
    "Im Auswertungszeitraum liefen 58 % der Pumpen auf Stufe zwei."]) assert.equal(z("Pumpen", text).treffer, true, text);
});

test("R2: Regel- und Konfigurationswerte (Schwellen, Gebühren, Limits, „ab 80 €“, „höchstens …“) sind keine Messung", () => {
  for (const [titel, text] of [
    ["Gratisversand ab 80 €", "Der Standardversand ist ab einem Bestellwert von 80 € kostenlos."],
    ["Gebühr", "Die Plattform nimmt 15 % Gebühr."],
    ["Obergrenze", "Die Obergrenze liegt bei 1.000 Anfragen."],
    ["Anfragen", "Die Nachholung umfasst höchstens 25.800 Anfragen."],
    ["Messregel", "Als Wirkung gilt ein Unterschied ab 25 %."],
    ["Annahme", "Der Autopilot startet erst bei 90 % Annahme."],
    ["Fehlerquote", "Die Übernahme wird enger, wenn die Fehlerquote über 5 % steigt."],
    ["Anteil", "Der Anteil soll 80 % betragen."],
    ["Abruf", "Antworten sind auf 200 Einträge begrenzt."],
    ["Abruf", "Bis zu 100 Kampagnen je Abfrage."],
    ["Topf", "Die Hälfte der Gebühren fließt in den Topf. Außerdem gehen 5 % jedes Kaufs dorthin."],
    ["Verteilung", "Die Plattform behält 20 % des Umsatzes ein und zahlt 80 % an den Händler aus."],
  ]) assert.equal(z(titel, text).treffer, false, `${titel} / ${text}`);
});

test("R2: Ports, Versionen, Daten, IDs, Hausnummern, Zählungen ohne Einheit und kleine Zahlen sind keine Messwerte", () => {
  for (const [titel, text] of [
    ["Ports belegt", "Die Ports 30863 bis 30869 sind vergeben."],
    ["Version live", "Version 2.5.1 ist deployed, Commit 4f1c9d8."],
    ["Merge", "PR #324 ist mit Commit 03f3ba1 gemergt, Ticket 12345 ist zu."],
    ["Adresse", "Das NAS hat die Adresse 192.0.2.147 und steht in der Beispielstraße 12."],
    ["Konten", "Das Verfahren scheitert auf allen 6 Konten."],
    ["Tests", "Der Schutz ist mit 4 Tests abgedeckt."],
    ["Seitenzahl", "Das Handbuch hat 340 Seiten."],
    ["Fehlercode", "Das Listing ist durch Fehler 100632 gesperrt."],
  ]) assert.equal(z(titel, text).treffer, false, `${titel} / ${text}`);
});

test("R2: kaputte Eingaben werfen nicht; hatZeitbezug erkennt Datum, Zeitraum, relative Angaben", () => {
  for (const e of [undefined, null, {}, { titel: 1, text: {} }]) assert.deepEqual(R.zahlOhneBezug(e), { treffer: false });
  for (const t of ["am 14.10.", "08.10.2026", "2026-10-14", "im Jahr 2026", "im März", "Okt. 2026", "KW 41", "heute", "gestern", "seit dem Umbau", "pro Tag", "jeden Monat",
    "innerhalb von 3 Tagen", "die letzten Wochen", "Wochenlohn", "Monatsumsatz", "monatlich"]) assert.equal(R.hatZeitbezug(t), true, t);
  for (const t of ["zuletzt", "im Auswertungszeitraum", "aktuell", "bisher", "Version 0.3.0", "10.10.10.10", "Port 8080", "1.200 €", "Seite 12"]) assert.equal(R.hatZeitbezug(t), false, t);
});

// ---------- fruehePruefung ----------
test("fruehePruefung: R1 vor R2, nur Fakten; Stand und Lektion nie", () => {
  const f = (o) => R.fruehePruefung({ art: "fakt", titel: "T", text: "X.", ...o });
  assert.deepEqual(f({ titel: "Kacheln sollen löschbar sein" }), { grund: "wunsch-statt-fakt", muster: "soll" });
  assert.deepEqual(f({ titel: "Pumpen 58 %", text: "58 % liefen auf Stufe zwei." }), { grund: "zahl-ohne-bezug", muster: "prozent" });
  assert.deepEqual(f({ titel: "Pumpen sollen 58 % erreichen", text: "Das ist neu." }), { grund: "wunsch-statt-fakt", muster: "soll" }, "R1 hat Vorrang");
  assert.equal(f({ titel: "Pumpe läuft nachts", text: "Die Pumpe läuft nachts leise." }), null);
  for (const art of ["stand", "lektion", "", undefined]) assert.equal(R.fruehePruefung({ art, titel: "Kacheln sollen löschbar sein", text: "58 % davon." }), null, String(art));
  for (const e of [undefined, null, "x", {}]) assert.equal(R.fruehePruefung(e), null);
});

// ---------- R4 ----------
test("R4: istSeitenwahl erkennt nur ziel.wie === \"wahl\"", () => {
  assert.equal(R.istSeitenwahl({ seite: "09_wiki/a.md", wie: "wahl" }), true);
  for (const wie of ["suche", "alias", "projekt", undefined, "Wahl"]) assert.equal(R.istSeitenwahl({ seite: "x", wie }), false, String(wie));
  for (const ziel of [null, undefined, {}, "wahl"]) assert.equal(R.istSeitenwahl(ziel), false);
});

// ---------- R3 ----------
const SEITE = "09_wiki/wissen/thema_teich.md";
const ISO = (s) => new Date(s).toISOString();
// Commit mit fester Zeit und Identität (Autor- und Committer-Datum), unabhängig von den GIT_*-Filtern der Test-Hilfen.
function commitAm(v, rel, inhalt, zeit, { name = "Anna", mail = "anna@example.com", nachricht = `edit ${rel}` } = {}) {
  mkdirSync(dirname(join(v, rel)), { recursive: true });
  writeFileSync(join(v, rel), inhalt);
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))), GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: mail,
    GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: mail, GIT_AUTHOR_DATE: ISO(zeit), GIT_COMMITTER_DATE: ISO(zeit) };
  execFileSync("git", ["-C", v, "add", "--", rel], { env, stdio: "pipe" });
  execFileSync("git", ["-C", v, "commit", "-qm", nachricht], { env, stdio: "pipe" });
}
const seite = (fm = {}) => seitenText({ fm: { name: "teich", description: "Gartenteich", ...fm }, rumpf: "# Teich\n\nText.\n" });
const ZITAT = Date.parse("2026-10-13T09:00:00Z");
const tageslauf = { name: AUTOR.name, mail: AUTOR.email };

test("R3: Seite nach dem Zitat von einem Menschen geändert → true; davor geändert → false", () => {
  // Der Start-Commit des Test-Vaults trägt das heutige Datum; darum die Historie der Seite in einem leeren Vault mit festen Zeiten aufbauen.
  const v = neuerTestVault({ seiten: {} });
  commitAm(v, SEITE, seite(), "2026-10-01T10:00:00Z");
  commitAm(v, SEITE, seite({ rev: 2 }), "2026-10-12T10:00:00Z");
  assert.equal(R.seiteNeuerAlsZitat(v, SEITE, ZITAT), false, "letzte Änderung vor dem Zitat");
  commitAm(v, SEITE, seite({ rev: 3 }), "2026-10-13T09:00:01Z");
  assert.equal(R.seiteNeuerAlsZitat(v, SEITE, ZITAT), true, "eine Sekunde nach dem Zitat genügt");
  assert.equal(R.seiteNeuerAlsZitat(v, SEITE, Date.parse("2026-10-13T09:00:01Z")), false, "genau zur Commit-Zeit ist nicht später (strikt größer)");
  assert.equal(R.seiteNeuerAlsZitat(v, SEITE, "2026-10-13T09:00:00Z"), true, "ISO-Text als Zitatzeit");
  assert.equal(R.seiteNeuerAlsZitat(v, SEITE, new Date("2026-10-13T09:00:00Z")), true, "Date als Zitatzeit");
});

test("R3: Commits des Tageslaufs zählen nicht — nur wenn Name UND Mail passen; ein Mensch danach zählt wieder", () => {
  const v = neuerTestVault({ seiten: {} });
  commitAm(v, SEITE, seite(), "2026-10-01T10:00:00Z");
  commitAm(v, SEITE, seite({ rev: 2 }), "2026-10-14T10:00:00Z", { name: tageslauf.name, mail: tageslauf.mail, nachricht: "auto(x): Fakt" });
  assert.equal(R.seiteNeuerAlsZitat(v, SEITE, ZITAT), false, "nur der Tageslauf hat die Seite nach dem Zitat geändert");
  commitAm(v, SEITE, seite({ rev: 3 }), "2026-10-15T10:00:00Z", { name: tageslauf.name, mail: "anderer@example.com" });
  assert.equal(R.seiteNeuerAlsZitat(v, SEITE, ZITAT), true, "gleicher Name, andere Mail: kein Tageslauf-Commit (fail-safe)");
  const v2 = neuerTestVault({ seiten: {} });
  commitAm(v2, SEITE, seite(), "2026-10-01T10:00:00Z");
  commitAm(v2, SEITE, seite({ rev: 2 }), "2026-10-14T10:00:00Z", { name: tageslauf.name, mail: tageslauf.mail });
  commitAm(v2, SEITE, seite({ rev: 3 }), "2026-10-15T10:00:00Z");
  assert.equal(R.seiteNeuerAlsZitat(v2, SEITE, ZITAT), true, "danach hat ein Mensch geändert");
});

test("R3: ungespeicherte Änderung an der Seite → true; Seite verschoben (git mv) zählt über --follow", () => {
  const v = neuerTestVault({ seiten: {} });
  commitAm(v, SEITE, seite(), "2026-10-01T10:00:00Z");
  assert.equal(R.seiteNeuerAlsZitat(v, SEITE, ZITAT), false);
  writeFileSync(join(v, SEITE), seite({ rev: 9 }));
  assert.equal(R.seiteNeuerAlsZitat(v, SEITE, ZITAT), true, "Arbeitsverzeichnis weicht ab");
  git(v, "checkout", "--", SEITE);
  assert.equal(R.seiteNeuerAlsZitat(v, SEITE, ZITAT), false);
  const neu = "09_wiki/wissen/thema_teich-neu.md";
  git(v, "mv", SEITE, neu);
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))), GIT_AUTHOR_NAME: "Anna", GIT_AUTHOR_EMAIL: "anna@example.com",
    GIT_COMMITTER_NAME: "Anna", GIT_COMMITTER_EMAIL: "anna@example.com", GIT_AUTHOR_DATE: ISO("2026-10-02T10:00:00Z"), GIT_COMMITTER_DATE: ISO("2026-10-02T10:00:00Z") };
  execFileSync("git", ["-C", v, "commit", "-qm", "umbenannt"], { env, stdio: "pipe" });
  assert.equal(R.seiteNeuerAlsZitat(v, neu, ZITAT), false, "der Umzug liegt vor dem Zitat, der Verlauf davor ebenso");
  assert.equal(R.seiteNeuerAlsZitat(v, neu, Date.parse("2026-10-01T12:00:00Z")), true, "der Umzug liegt nach diesem Zitat");
});

test("R3: stand/rev im Frontmatter — ein späterer TAG zählt, derselbe Tag nicht; Uhrzeit und deutsches Datum werden gelesen", () => {
  const mit = (fm) => { const v = neuerTestVault({ seiten: {} }); commitAm(v, SEITE, seite(fm), "2026-10-01T10:00:00Z"); return v; };
  assert.equal(R.seiteNeuerAlsZitat(mit({ stand: "2026-10-16" }), SEITE, ZITAT), true, "Stand 16.10. > Zitat 13.10.");
  assert.equal(R.seiteNeuerAlsZitat(mit({ stand: "2026-10-13" }), SEITE, ZITAT), false, "derselbe Tag beweist nichts (genau machen die Commits)");
  assert.equal(R.seiteNeuerAlsZitat(mit({ stand: "2026-10-12" }), SEITE, ZITAT), false);
  assert.equal(R.seiteNeuerAlsZitat(mit({ stand: "\"16.10.2026\"" }), SEITE, ZITAT), true, "deutsches Datum in Anführungszeichen");
  assert.equal(R.seiteNeuerAlsZitat(mit({ rev: "2026-10-20" }), SEITE, ZITAT), true, "rev als Datum");
  assert.equal(R.seiteNeuerAlsZitat(mit({ rev: 4 }), SEITE, ZITAT), false, "rev als Zahl sagt nichts über die Zeit");
  assert.equal(R.seiteNeuerAlsZitat(mit({ stand: "2026-10-13T12:00:00Z" }), SEITE, ZITAT), true, "Stand mit Uhrzeit nach dem Zitat");
  assert.equal(R.seiteNeuerAlsZitat(mit({ stand: "2026-10-13T08:00:00Z" }), SEITE, ZITAT), false, "Stand mit Uhrzeit vor dem Zitat");
  assert.equal(R.seiteNeuerAlsZitat(mit({ stand: "morgen" }), SEITE, ZITAT), false, "unlesbares Datum zählt nicht als Beleg, die Commits entscheiden");
});

test("R3: fail-safe — unbekannte Zitatzeit, Seite ohne Verlauf, fehlende Seite, unzulässiger Pfad, kein Git → true", () => {
  const v = neuerTestVault({ seiten: {} });
  commitAm(v, SEITE, seite(), "2026-10-01T10:00:00Z");
  assert.equal(R.seiteNeuerAlsZitat(v, SEITE, ZITAT), false, "Vorbedingung");
  for (const zeit of [null, undefined, "", "?", "gestern", NaN, {}]) assert.equal(R.seiteNeuerAlsZitat(v, SEITE, zeit), true, `Zeit ${String(zeit)}`);
  assert.equal(R.seiteNeuerAlsZitat(v, "09_wiki/wissen/gibt-es-nicht.md", ZITAT), true, "Seite fehlt");
  schreibeSeite(v, "09_wiki/wissen/neu-ungespeichert.md", seite());
  assert.equal(R.seiteNeuerAlsZitat(v, "09_wiki/wissen/neu-ungespeichert.md", ZITAT), true, "nie committet");
  for (const p of ["", null, undefined, "../x.md", "09_wiki/../../x.md", "/etc/passwd"]) assert.equal(R.seiteNeuerAlsZitat(v, p, ZITAT), true, String(p));
  assert.equal(R.seiteNeuerAlsZitat(join(v, "00_inbox-gibt-es-nicht"), SEITE, ZITAT), true, "kein Vault/Git-Verzeichnis");
  assert.equal(R.seiteNeuerAlsZitat(undefined, SEITE, ZITAT), true);
});

test("zitatZeitAusFundstelle: Zeit aus dem B1-Format, sonst null", () => {
  assert.equal(R.zitatZeitAusFundstelle("s1#u-1 2026-10-13T09:07:04.592Z"), Date.parse("2026-10-13T09:07:04.592Z"));
  assert.equal(R.zitatZeitAusFundstelle("s1#u-1 2026-10-13T09:07:04Z"), Date.parse("2026-10-13T09:07:04Z"));
  for (const f of ["s1#u-1 ?", "", "kaputt", undefined, null, "s1#u-1 2026-10-13"]) assert.equal(R.zitatZeitAusFundstelle(f), null, String(f));
  assert.equal(R.seiteNeuerAlsZitat(neuerTestVault({ seiten: {} }), SEITE, R.zitatZeitAusFundstelle("s1#u-1 ?")), true, "unbekannte Zeit → fail-safe");
});
