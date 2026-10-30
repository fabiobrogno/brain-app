import Testing
import Foundation
@testable import BrainCore

/// Eine Akzentfarbe für App und Studio: gleiche Werte, Kontrast nach WCAG AA.
private let repo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

@Test func kontrastBekannteWerte() {
    #expect(abs(KortexFarben.kontrast("000000", "FFFFFF") - 21) < 0.001)
    #expect(abs(KortexFarben.kontrast("FFFFFF", "FFFFFF") - 1) < 0.001)
    #expect(KortexFarben.kontrast("kaputt", "FFFFFF") == 0)
}

@Test func schriftAufAkzentKnopfErreichtAAInHellUndDunkel() {
    #expect(KortexFarben.kontrast(KortexFarben.akzentTextHell, KortexFarben.akzentHell) >= 4.5)
    #expect(KortexFarben.kontrast(KortexFarben.akzentTextDunkel, KortexFarben.akzentDunkel) >= 4.5)
}

@Test func akzentAlsSchriftBleibtAufDenFlaechenLesbar() {
    // hell: Akzent auf Weiß (Editor, Dialoge); dunkel: Akzent auf dem dunklen Grund des Studios (#191814) und der App (~#1E1E1E)
    #expect(KortexFarben.kontrast(KortexFarben.akzentHell, "FFFFFF") >= 4.5)
    #expect(KortexFarben.kontrast(KortexFarben.akzentDunkel, "191814") >= 4.5)
    #expect(KortexFarben.kontrast(KortexFarben.akzentDunkel, "1E1E1E") >= 4.5)
}

@Test func studioNutztDieselbenFarbwerteWieDieApp() throws {
    let css = try String(contentsOf: repo.appendingPathComponent("Ressourcen/studio/studio.css"), encoding: .utf8)
    func token(_ name: String) -> (hell: String, dunkel: String)? {
        guard let r = css.range(of: "--\(name): light-dark(#", options: []) else { return nil }
        let rest = css[r.upperBound...]
        guard let ende = rest.firstIndex(of: ")") else { return nil }
        let teile = "#" + rest[..<ende]
        let werte = teile.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "#", with: "").uppercased() }
        return werte.count == 2 ? (werte[0], werte[1]) : nil
    }
    let akzent = try #require(token("akzent"))
    #expect(akzent.hell == KortexFarben.akzentHell)
    #expect(akzent.dunkel == KortexFarben.akzentDunkel)
    let text = try #require(token("akzent-text"))
    #expect(text.hell == KortexFarben.akzentTextHell)
    #expect(text.dunkel == KortexFarben.akzentTextDunkel)
}

@Test func studioDefiniertDenAkzentNurEinmal() throws {
    // Kein zweiter Farbton als „Akzent“ in den Studio-Stilen: --akzent wird nur in studio.css festgelegt.
    let ordner = repo.appendingPathComponent("Ressourcen/studio")
    let css = try FileManager.default.contentsOfDirectory(atPath: ordner.path).filter { $0.hasSuffix(".css") }
    for datei in css {
        let text = try String(contentsOf: ordner.appendingPathComponent(datei), encoding: .utf8)
        let festlegungen = text.components(separatedBy: "\n").filter { $0.range(of: #"^\s*--akzent\s*:"#, options: .regularExpression) != nil }
        #expect(festlegungen.count == (datei == "studio.css" ? 1 : 0), "\(datei)")
    }
}
