import Testing
import Foundation
import AppKit
@testable import BrainCore

private func ressourcenOrdner() -> URL {
    URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("Ressourcen", isDirectory: true)
}

/// Jedes Marken-Logo hat eine Datei, die sich als Bild laden lässt (macOS liest SVG über NSImage) und kein Skript enthält.
@Test func markenLogosWerdenGefundenUndGeladen() throws {
    #expect(MarkenLogo.allCases == [.github])
    for marke in MarkenLogo.allCases {
        let url = try #require(marke.url(ressourcen: ressourcenOrdner()), "Logo für \(marke.name) fehlt")
        let bild = try #require(NSImage(contentsOf: url), "Logo für \(marke.name) lässt sich nicht laden")
        #expect(bild.size.width > 0 && bild.size.height > 0)
        let text = try String(contentsOf: url, encoding: .utf8)
        #expect(text.contains("viewBox=\"0 0 24 24\"") && text.contains("<path"))
        #expect(!text.lowercased().contains("<script"))
    }
}

@Test func markenLogoNamenUndRueckfall() {
    #expect(MarkenLogo.github.name == "GitHub")
    #expect(MarkenLogo.github.initiale == "G")
    #expect(MarkenLogo.github.logoFarbeHex == nil) // einfarbig in der Textfarbe
    #expect(MarkenLogo.github.url(ressourcen: nil) == nil)
    #expect(MarkenLogo.github.url(ressourcen: FileManager.default.temporaryDirectory.appendingPathComponent("gibt-es-nicht-\(UUID().uuidString)")) == nil)
}

/// Quelle und Lizenz jedes Marken-Logos stehen in HERKUNFT.md (Simple Icons, CC0, Version).
@Test func jedesMarkenLogoIstInHerkunftBelegt() throws {
    let herkunft = try String(contentsOf: ressourcenOrdner().appendingPathComponent("logos/HERKUNFT.md"), encoding: .utf8)
    for marke in MarkenLogo.allCases {
        #expect(herkunft.contains(marke.logoDatei), "\(marke.logoDatei) fehlt in HERKUNFT.md")
    }
    #expect(herkunft.contains("simple-icons 16.36.0") && herkunft.contains("CC0"))
    #expect(herkunft.contains("Marken gehören den jeweiligen Inhabern"))
}

/// Das Studio (marken.js) und die App (github.svg) zeigen dieselbe Form: die Pfaddaten sind gleich.
@Test func studioUndAppNutzenDieselbenPfaddaten() throws {
    let svg = try String(contentsOf: ressourcenOrdner().appendingPathComponent("logos/github.svg"), encoding: .utf8)
    let js = try String(contentsOf: ressourcenOrdner().appendingPathComponent("studio/marken.js"), encoding: .utf8)
    func pfad(_ text: String, vor: String) -> String? {
        guard let r = text.range(of: vor) else { return nil }
        let rest = text[r.upperBound...]
        guard let ende = rest.firstIndex(of: "\"") else { return nil }
        return String(rest[..<ende])
    }
    let ausSvg = try #require(pfad(svg, vor: "<path d=\""))
    let ausJs = try #require(pfad(js, vor: "github: \""))
    #expect(!ausSvg.isEmpty && ausSvg == ausJs)
}
