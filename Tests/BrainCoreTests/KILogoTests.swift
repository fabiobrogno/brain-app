import Testing
import Foundation
import AppKit
@testable import BrainCore

private func ressourcenOrdner() -> URL {
    URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("Ressourcen", isDirectory: true)
}

/// Jeder Katalog-Eintrag mit Logo: die Datei wird gefunden, lässt sich als Bild laden (macOS liest SVG über NSImage) und ist sauber (keine Skripte).
@Test func logosMitDateiWerdenGefundenUndGeladen() throws {
    let k = try #require(KiKatalog.laden(ressourcen: ressourcenOrdner()))
    #expect(k.eintraege.count >= 40, "der Katalog führt die KIs von Orca (Terminal-KIs) plus Editoren und Apps")
    var mitLogo = 0
    for e in k.eintraege {
        guard let l = k.logo(e.id) else { continue }
        mitLogo += 1
        let u = ressourcenOrdner().appendingPathComponent("logos/\(l.datei)")
        #expect(FileManager.default.isReadableFile(atPath: u.path), "Logo für \(e.name) fehlt: \(l.datei)")
        let bild = try #require(NSImage(contentsOf: u), "Logo für \(e.name) lässt sich nicht laden")
        #expect(bild.size.width > 0 && bild.size.height > 0)
        if l.istSVG {
            let text = try String(contentsOf: u, encoding: .utf8).lowercased()
            #expect(text.contains("viewbox=") && !text.contains("<script") && !text.contains("<foreignobject") && !text.contains("<image"), Comment(rawValue: l.datei))
        }
    }
    #expect(mitLogo >= 35, "fast jede KI hat ein echtes Logo")
    // alle verbindbaren KIs des Assistenten haben eines
    for ki in KiZiel.allCases { #expect(ki.logo(ressourcen: ressourcenOrdner()) != nil, Comment(rawValue: ki.name)) }
}

@Test func fehlendeRessourcenGebenNilStattAbsturz() {
    #expect(KILogoQuelle.url(.claude, ressourcen: nil) == nil)
    #expect(KILogoQuelle.url(.claude, ressourcen: FileManager.default.temporaryDirectory.appendingPathComponent("gibt-es-nicht-\(UUID().uuidString)")) == nil)
    #expect(KiKatalog.laden(ressourcen: nil) == nil)
}

/// Der Katalog wird streng gelesen: ein unbekannter Modus oder ein falsches Schema ist ein Fehler, kein stilles Weglassen.
@Test func katalogWirdStrengGelesen() throws {
    func roh(_ eintrag: String, schema: Int = 1) -> Data {
        Data(#"{"schema":\#(schema),"eintraege":[\#(eintrag)]}"#.utf8)
    }
    let gut = ##"{"id":"a","name":"A","art":"terminal","befehle":["a"],"apps":[],"website":"https://a.example","beliebt":true,"verbindbar":false,"logo":{"datei":"a.svg","modus":"marke","farbe":"#112233","ansicht":"0 0 24 24"}}"##
    let k = try KiKatalog.laden(daten: roh(gut))
    #expect(k.logo("a") == KiLogoInfo(datei: "a.svg", modus: .marke, farbeHex: "112233", ansicht: "0 0 24 24"))
    #expect(throws: KiKatalog.Fehler.self) { try KiKatalog.laden(daten: roh(gut, schema: 2)) }
    #expect(throws: KiKatalog.Fehler.self) { try KiKatalog.laden(daten: roh(gut.replacingOccurrences(of: "marke", with: "bunt"))) }
    #expect(throws: KiKatalog.Fehler.self) { try KiKatalog.laden(daten: roh(gut.replacingOccurrences(of: "terminal", with: "kuehlschrank"))) }
    // geteiltes Logo: Claude Desktop zeigt das Zeichen von Claude
    let geteilt = gut + #",{"id":"b","name":"B","art":"app","befehle":[],"apps":["B.app"],"website":"https://b.example","beliebt":false,"verbindbar":false,"teilt_logo":"a"}"#
    #expect(try KiKatalog.laden(daten: roh(geteilt)).logo("b")?.datei == "a.svg")
}

/// Jede Logo-Datei des Katalogs hat einen Eintrag in HERKUNFT.md (Quelle und Lizenz sind dokumentiert).
@Test func jedesLogoIstInHerkunftBelegt() throws {
    let ordner = ressourcenOrdner().appendingPathComponent("logos", isDirectory: true)
    let herkunft = try String(contentsOf: ordner.appendingPathComponent("HERKUNFT.md"), encoding: .utf8)
    let k = try #require(KiKatalog.laden(ressourcen: ressourcenOrdner()))
    for e in k.eintraege {
        if let d = e.logo?.datei { #expect(herkunft.contains(d), "\(d) fehlt in HERKUNFT.md") }
    }
    #expect(herkunft.contains("CC0"))
    #expect(herkunft.contains("Marken gehören den jeweiligen Inhabern"))
}
