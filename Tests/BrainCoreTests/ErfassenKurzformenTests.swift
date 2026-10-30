import Testing
import Foundation
@testable import BrainCore

/// Freitag, 30. Oktober 2026 (14 Uhr, Berlin) — die Kurzformen rechnen von diesem Tag aus.
let erfassenKalender: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "Europe/Berlin")!
    c.locale = Locale(identifier: "de_DE")
    return c
}()
let erfassenHeute = erfassenKalender.date(from: DateComponents(year: 2026, month: 10, day: 30, hour: 14))!

private func lies(_ text: String, prio: Bool = true, faellig: Bool = true) -> Kurzformen.Ergebnis {
    Kurzformen.lies(text, heute: erfassenHeute, kalender: erfassenKalender, prioritaet: prio, faellig: faellig)
}

@Test func derTestTagIstEinFreitag() {
    #expect(erfassenKalender.component(.weekday, from: erfassenHeute) == 6)
}

// MARK: Priorität

@Test func prioritaetAlsEigenesWortWirdErkanntUndAusDemTitelGenommen() {
    let a = lies("Steuer machen !hoch")
    #expect(a.titel == "Steuer machen" && a.prioritaet == .hoch && a.prioritaetWort == "!hoch")
    #expect(lies("!niedrig Blumen gießen").prioritaet == .niedrig)
    #expect(lies("Blumen !normal gießen").titel == "Blumen gießen")
    #expect(lies("Zahnarzt anrufen !!").prioritaet == .hoch)
    #expect(lies("Zahnarzt !HOCH,").prioritaet == .hoch, "Groß/klein und Komma am Ende sind egal")
}

@Test func prioritaetImWortOderAlleinBleibtText() {
    #expect(lies("Das ist wichtig!hoch").prioritaet == nil)
    #expect(lies("Super!!").prioritaet == nil, "„!!“ zählt nur als eigenes Wort")
    let nur = lies("!hoch")
    #expect(nur.titel == "!hoch" && nur.prioritaet == nil, "bliebe sonst kein Titel")
}

@Test func prioritaetErkennungLaesstSichAusschalten() {
    let e = lies("Steuer machen !hoch", prio: false)
    #expect(e.prioritaet == nil && e.titel == "Steuer machen !hoch")
}

// MARK: Fälligkeit

@Test func heuteMorgenUebermorgenAmEndeOderAmAnfang() {
    let a = lies("Steuer machen morgen")
    #expect(a.titel == "Steuer machen" && a.faellig == "2026-10-31" && a.faelligWort == "morgen")
    #expect(lies("morgen Steuer machen").faellig == "2026-10-31")
    #expect(lies("Steuer machen übermorgen").faellig == "2026-11-01")
    #expect(lies("Steuer machen uebermorgen").faellig == "2026-11-01")
    #expect(lies("heute Müll rausbringen").faellig == "2026-10-30")
    #expect(lies("Müll rausbringen Heute.").faellig == "2026-10-30", "Satzzeichen am Ende stören nicht")
}

@Test func wochentageMeinenImmerDenNaechsten() {
    #expect(lies("Bericht bis Montag").faellig == "2026-11-02")
    #expect(lies("Montag Bericht schreiben").faellig == "2026-11-02")
    #expect(lies("Bericht Samstag").faellig == "2026-10-31")
    #expect(lies("Bericht Freitag").faellig == "2026-11-06", "heute ist Freitag: der nächste Freitag")
    #expect(lies("Sonntag Kuchen backen").faellig == "2026-11-01")
}

@Test func inTagenWochenUndNaechsteWoche() {
    #expect(lies("in 3 Tagen Zahnarzt").faellig == "2026-11-02")
    #expect(lies("Zahnarzt anrufen in 2 Wochen").faellig == "2026-11-13")
    #expect(lies("Zahnarzt in 1 Tag").faellig == "2026-10-31")
    #expect(lies("Bericht nächste Woche").faellig == "2026-11-02", "nächster Montag")
    #expect(lies("Bericht naechste Woche").faelligWort == "naechste Woche")
    #expect(lies("Zahnarzt in drei Tagen").faellig == nil, "Zahlwörter werden nicht gelesen")
}

@Test func datumMitMarkierungUndNachBisUndFaellig() {
    #expect(lies("Rechnung @12.11.").faellig == "2026-11-12")
    #expect(lies("Rechnung @morgen bezahlen").titel == "Rechnung bezahlen")
    #expect(lies("@freitag Vertrag senden").faellig == "2026-11-06")
    #expect(lies("Rechnung bis zum 15.11.2026 zahlen").faellig == "2026-11-15")
    #expect(lies("Rechnung bis zum 15.11.2026 zahlen").titel == "Rechnung zahlen")
    #expect(lies("Rechnung fällig morgen zahlen").titel == "Rechnung zahlen")
    #expect(lies("Rechnung fällig: Montag").faellig == "2026-11-02")
    #expect(lies("Rechnung @3.11.26").faellig == "2026-11-03", "zweistelliges Jahr")
}

@Test func datumOhneJahrIstDasNaechsteMalUndUngueltigesWirdIgnoriert() {
    #expect(lies("Steuer @1.10.").faellig == "2027-10-01", "der 1.10. ist schon vorbei: nächstes Jahr")
    #expect(lies("Steuer @30.10.").faellig == "2026-10-30", "heute zählt noch")
    let kaputt = lies("Steuer @31.02.")
    #expect(kaputt.faellig == nil && kaputt.titel == "Steuer @31.02.")
    #expect(lies("Steuer @gestern").faellig == nil)
}

@Test func isoDatumAmRandOderMitMarkierung() {
    #expect(lies("2026-11-03 Steuer").faellig == "2026-11-03")
    #expect(lies("Steuer 2026-11-03").faellig == "2026-11-03")
    #expect(lies("Steuer 2026-13-45").faellig == nil)
}

@Test func nichtsAuslosenWoNichtsGemeintIst() {
    #expect(lies("Version 2.3 testen").faellig == nil)
    #expect(lies("Update auf 2.3.").faellig == nil, "ein Zahlenpunkt ohne @ oder „bis“ ist kein Datum")
    #expect(lies("Der Morgen danach war ruhig").faellig == nil, "mitten im Satz nur mit @ oder „bis“")
    #expect(lies("Gestern war Montag im Büro").faellig == nil)
    let allein = lies("morgen")
    #expect(allein.titel == "morgen" && allein.faellig == nil, "bliebe sonst kein Titel")
    #expect(lies("bis morgen").titel == "bis morgen")
}

@Test func prioritaetUndFaelligkeitZusammen() {
    let e = lies("morgen Steuer machen !niedrig")
    #expect(e.titel == "Steuer machen" && e.prioritaet == .niedrig && e.faellig == "2026-10-31")
}

@Test func faelligkeitErkennungLaesstSichAusschalten() {
    let e = lies("Steuer machen morgen", faellig: false)
    #expect(e.faellig == nil && e.titel == "Steuer machen morgen")
}

@Test func nurDieErsteZeileWirdGelesenDerRestBleibtText() {
    let e = lies("\n\n  Steuer morgen !hoch  \nDetails mit morgen und !hoch\n\nLetzte Zeile\n")
    #expect(e.titel == "Steuer" && e.prioritaet == .hoch && e.faellig == "2026-10-31")
    #expect(e.text == "Details mit morgen und !hoch\n\nLetzte Zeile")
    #expect(lies("Eins\r\nZwei").text == "Zwei")
    #expect(lies("").titel == "" && lies("  \n ").titel == "")
}

@Test func faelligTextIstLesbar() {
    func t(_ iso: String) -> String { Kurzformen.faelligText(iso, heute: erfassenHeute, kalender: erfassenKalender) }
    #expect(t("2026-10-30") == "heute")
    #expect(t("2026-10-31") == "morgen")
    #expect(t("2026-11-03") == "Di., 03.11.")
    #expect(t("2027-01-04") == "Mo., 04.01.2027")
    #expect(t("kaputt") == "kaputt")
}

@Test func dieRegelnImHilfetextNennenAlleKurzformen() {
    let alle = Kurzformen.regeln.joined(separator: " ")
    for wort in ["!hoch", "!niedrig", "!!", "@morgen", "bis morgen", "fällig", "übermorgen", "in 3 Tagen", "nächste Woche"] {
        #expect(alle.contains(wort), "Hilfetext erwähnt „\(wort)“ nicht")
    }
}
