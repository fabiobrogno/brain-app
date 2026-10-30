import Testing
import Foundation
@testable import BrainCore

private let t0 = Date(timeIntervalSince1970: 1_000_000)

@Test func ersteMeldungPlantEinenLaufNachDerVerzoegerung() {
    var a = StatusAuffrischung(verzoegerung: 1.5, mindestAbstand: 5)
    #expect(a.anfordern(jetzt: t0) == t0.addingTimeInterval(1.5))
    #expect(a.istGeplant)
}

@Test func vieleMeldungenVorDemLaufWerdenZuEinemLauf() {
    var a = StatusAuffrischung(verzoegerung: 1.5, mindestAbstand: 5)
    #expect(a.anfordern(jetzt: t0) != nil)
    for i in 1...20 { #expect(a.anfordern(jetzt: t0.addingTimeInterval(Double(i) * 0.05)) == nil, "Meldung \(i): der geplante Lauf deckt sie ab") }
}

@Test func nachDemLaufGiltDerMindestabstand() {
    var a = StatusAuffrischung(verzoegerung: 1.5, mindestAbstand: 5)
    _ = a.anfordern(jetzt: t0)
    a.gelaufen(jetzt: t0.addingTimeInterval(1.5))
    #expect(!a.istGeplant)
    // Meldung 1 s nach dem Lauf: frühestens 5 s nach dem Lauf, nicht schon nach 1,5 s
    #expect(a.anfordern(jetzt: t0.addingTimeInterval(2.5)) == t0.addingTimeInterval(6.5))
    a.gelaufen(jetzt: t0.addingTimeInterval(6.5))
    // lange danach: wieder nur die Verzögerung
    #expect(a.anfordern(jetzt: t0.addingTimeInterval(100)) == t0.addingTimeInterval(101.5))
}

@Test func dauerfeuerErgibtHoechstensEinenLaufJeMindestabstand() {
    var a = StatusAuffrischung(verzoegerung: 1, mindestAbstand: 5)
    var jetzt = t0
    var laeufe: [Date] = []
    // 60 Sekunden lang alle 0,1 s eine Meldung; ein Lauf passiert, sobald seine Zeit erreicht ist
    var geplant: Date?
    for _ in 0..<600 {
        if let g = geplant, g <= jetzt { a.gelaufen(jetzt: jetzt); laeufe.append(jetzt); geplant = nil }
        if let neu = a.anfordern(jetzt: jetzt) { geplant = neu }
        jetzt = jetzt.addingTimeInterval(0.1)
    }
    #expect(laeufe.count <= 12, "höchstens alle 5 s ein Lauf, war \(laeufe.count)")
    #expect(laeufe.count >= 8, "aber auch nicht ausgehungert: \(laeufe.count)")
    for (x, y) in zip(laeufe, laeufe.dropFirst()) { #expect(y.timeIntervalSince(x) >= 5 - 0.001) }
}

@Test func negativeWerteWerdenBegrenzt() {
    var a = StatusAuffrischung(verzoegerung: -3, mindestAbstand: -1)
    #expect(a.anfordern(jetzt: t0) == t0)
}

@Test func aktionStatusAuffrischenGiltNurFuerDasStudio() {
    #expect(AppAktion.pruefe(["aktion": "status-auffrischen"], vault: nil, oberflaeche: .studio) == .statusAuffrischen)
    // ein Wert dazu ändert nichts — die Aktion trägt keine Daten
    #expect(AppAktion.pruefe(["aktion": "status-auffrischen", "wert": "egal"], vault: nil, oberflaeche: .studio) == .statusAuffrischen)
    // die Übersicht (Seite des Kerns) soll keine Status-Läufe anstoßen können, auch ohne Angabe der Herkunft nicht
    #expect(AppAktion.pruefe(["aktion": "status-auffrischen"], vault: nil, oberflaeche: .app) == nil)
    #expect(AppAktion.pruefe(["aktion": "status-auffrischen"], vault: nil) == nil)
    for name in ["status_auffrischen", "statusAuffrischen", "Status-auffrischen", "status"] {
        #expect(AppAktion.pruefe(["aktion": name], vault: nil, oberflaeche: .studio) == nil, "\(name)")
    }
}

@Test func ereignisAbrufHatEinLangesZeitlimit() {
    #expect(BrueckenVerbindung.zeitlimit(fuerPfad: "/api/ereignisse") == .seconds(40))
    #expect(BrueckenVerbindung.zeitlimit(fuerPfad: "/api/ereignisse?seit=12&epoche=ab&warte=25") == .seconds(40), "Long-Poll: länger als die 30 s der Werkstatt")
    #expect(BrueckenVerbindung.zeitlimit(fuerPfad: "/api/ereignisse/x") == .seconds(30), "nur genau dieser Pfad")
}
