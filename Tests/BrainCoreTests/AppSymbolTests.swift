import Testing
import Foundation
import AppKit
@testable import BrainCore

// Wählbares Dock-Symbol: Wahl → Bild (nil für Standard), Lesen aus einstellungen.json, Brücken-Aktion. Dateien nur in Temp-Ordnern bzw. lesend aus dem Repo.

/// `Ressourcen/` des Repos (die Pakete der App kopieren genau diesen Ordner nach Contents/Resources).
private let ressourcen = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .appendingPathComponent("Ressourcen", isDirectory: true)

@Test func standardHatKeinBildUndKeineDatei() {
    #expect(AppSymbol.standard.dateiName == nil)
    #expect(AppSymbol.standard.bild(ressourcen: ressourcen) == nil, "Standard: kein eigenes Bild, das Dock zeigt AppIcon.icns")
    #expect(AppSymbol.standard.bild(ressourcen: nil) == nil)
}

@Test func jedeAnderePaletteHatEinBildMitDenKleinenGroessen() {
    #expect(AppSymbol.allCases.map(\.rawValue) == ["standard", "dunkel", "graphit", "papier", "smaragd"])
    for s in AppSymbol.allCases where s != .standard {
        #expect(s.dateiName == "\(s.rawValue).icns")
        let bild = s.bild(ressourcen: ressourcen)
        #expect(bild != nil, "\(s.rawValue)")
        let breiten = Set((bild?.representations ?? []).map(\.pixelsWide))
        #expect([16, 32, 64, 128, 256, 512, 1024].allSatisfy(breiten.contains), "\(s.rawValue): \(breiten.sorted())")
    }
}

@Test func fehlendeOderKaputteDateiGibtNilStattAbsturz() {
    let leer = tempOrdner("appsymbol-leer")
    #expect(AppSymbol.dunkel.bild(ressourcen: leer) == nil)
    let kaputt = tempOrdner("appsymbol-kaputt")
    try? FileManager.default.createDirectory(at: kaputt.appendingPathComponent("AppSymbole"), withIntermediateDirectories: true)
    try? Data("kein icns".utf8).write(to: kaputt.appendingPathComponent("AppSymbole/dunkel.icns"))
    #expect(AppSymbol.dunkel.bild(ressourcen: kaputt) == nil)
}

@Test func wertAusDerBrueckeKenntNurDieFuenfNamen() {
    for s in AppSymbol.allCases { #expect(AppSymbol(wert: s.rawValue) == s) }
    for ungueltig: Any? in ["Dunkel", "pink", "", 3, ["a": 1], nil] { #expect(AppSymbol(wert: ungueltig) == nil) }
}

@Test func liestDieWahlAusDerEinstellungsdateiUndFaelltAufStandard() throws {
    let o = tempOrdner("appsymbol-lesen")
    #expect(AppSymbol.lies(supportOrdner: o) == .standard, "Datei fehlt")
    let datei = o.appendingPathComponent("einstellungen.json")
    try Data(#"{"bewegung":"reduziert","appSymbol":"papier"}"#.utf8).write(to: datei)
    #expect(AppSymbol.lies(supportOrdner: o) == .papier)
    try Data(#"{"appSymbol":"pink"}"#.utf8).write(to: datei)
    #expect(AppSymbol.lies(supportOrdner: o) == .standard, "unbekannter Wert")
    try Data(#"{"appSymbol":4}"#.utf8).write(to: datei)
    #expect(AppSymbol.lies(supportOrdner: o) == .standard, "falscher Typ")
    try Data("{kaputt".utf8).write(to: datei)
    #expect(AppSymbol.lies(supportOrdner: o) == .standard, "kaputte Datei")
    try Data("[1,2]".utf8).write(to: datei)
    #expect(AppSymbol.lies(supportOrdner: o) == .standard, "kein Objekt")
}

@Test func appSymbolAktionNurImStudioUndNurMitBekanntemNamen() {
    for s in AppSymbol.allCases {
        #expect(AppAktion.pruefe(["aktion": "app-symbol", "wert": s.rawValue], vault: nil, oberflaeche: .studio) == .appSymbol(s), "\(s.rawValue)")
        #expect(AppAktion.pruefe(["aktion": "app-symbol", "wert": s.rawValue], vault: nil, oberflaeche: .app) == nil, "\(s.rawValue) nur Studio")
        #expect(AppAktion.pruefe(["aktion": "app-symbol", "wert": s.rawValue], vault: nil) == nil, "strengste Herkunft")
    }
    for ungueltig: Any in ["Dunkel", "../dunkel", "", 1, ["a": 1]] {
        #expect(AppAktion.pruefe(["aktion": "app-symbol", "wert": ungueltig], vault: nil, oberflaeche: .studio) == nil)
    }
    #expect(AppAktion.pruefe(["aktion": "app-symbol"], vault: nil, oberflaeche: .studio) == nil)
}
