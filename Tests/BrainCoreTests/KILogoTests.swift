import Testing
import Foundation
import AppKit
@testable import BrainCore

private func ressourcenOrdner() -> URL {
    URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("Ressourcen", isDirectory: true)
}

/// Alle Logos, die eine Datei haben, werden gefunden und als Bild geladen (macOS liest SVG über NSImage).
@Test func logosMitDateiWerdenGefundenUndGeladen() throws {
    let mitDatei = KiZiel.allCases.filter { $0.logoDatei != nil }
    #expect(Set(mitDatei) == Set(KiZiel.allCases).subtracting([.codex]), "alle außer Codex haben ein Logo")
    for ki in mitDatei {
        let url = try #require(KILogoQuelle.url(ki, ressourcen: ressourcenOrdner()), "Logo für \(ki.name) fehlt")
        let bild = try #require(NSImage(contentsOf: url), "Logo für \(ki.name) lässt sich nicht laden")
        #expect(bild.size.width > 0 && bild.size.height > 0)
        let text = try String(contentsOf: url, encoding: .utf8)
        #expect(text.contains("viewBox=\"0 0 24 24\"") && text.contains("<path"))
        #expect(!text.lowercased().contains("<script"))
    }
}

/// Codex: kein lizenziertes Vektor-Logo vorhanden, also Initiale statt Bild (HERKUNFT.md erklärt warum).
@Test func codexHatKeinLogoUndZeigtDieInitiale() {
    #expect(KILogoQuelle.url(.codex, ressourcen: ressourcenOrdner()) == nil)
    #expect(KiZiel.codex.initiale == "C")
    #expect(KiZiel.cursor.initiale == "C" && KiZiel.claude.initiale == "C")
}

@Test func fehlendeRessourcenGebenNilStattAbsturz() {
    #expect(KILogoQuelle.url(.claude, ressourcen: nil) == nil)
    #expect(KILogoQuelle.url(.claude, ressourcen: FileManager.default.temporaryDirectory.appendingPathComponent("gibt-es-nicht-\(UUID().uuidString)")) == nil)
}

/// Jede SVG im Logo-Ordner hat einen Eintrag in HERKUNFT.md (Quelle und Lizenz sind dokumentiert).
@Test func jedesLogoIstInHerkunftBelegt() throws {
    let ordner = ressourcenOrdner().appendingPathComponent("logos", isDirectory: true)
    let herkunft = try String(contentsOf: ordner.appendingPathComponent("HERKUNFT.md"), encoding: .utf8)
    for ki in KiZiel.allCases {
        if let d = ki.logoDatei { #expect(herkunft.contains(d), "\(d) fehlt in HERKUNFT.md") }
    }
    #expect(herkunft.contains("CC0"))
    #expect(herkunft.contains("Marken gehören den jeweiligen Inhabern"))
}
