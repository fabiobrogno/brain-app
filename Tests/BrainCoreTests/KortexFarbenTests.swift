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
    // Standard-Akzent (Indigo) steht als Rückfall in schemata.css: hell in `:root`, dunkel in `:root[data-pal^="dunkel"]`; die Akzentwahl setzt darstellung.js darüber
    let css = try String(contentsOf: repo.appendingPathComponent("Ressourcen/studio/schemata.css"), encoding: .utf8)
    func werte(_ auswahl: String) -> (akzent: String, text: String)? {
        for zeile in css.components(separatedBy: "\n") where zeile.hasPrefix(auswahl + " {") {
            guard let r = zeile.range(of: #"--akzent: #[0-9a-fA-F]{6}; --akzent-text: #[0-9a-fA-F]{6};"#, options: .regularExpression) else { continue }
            let hex = zeile[r].components(separatedBy: "#").dropFirst().map { String($0.prefix(6)).uppercased() }
            if hex.count == 2 { return (hex[0], hex[1]) }
        }
        return nil
    }
    let hell = try #require(werte(":root"))
    #expect(hell.akzent == KortexFarben.akzentHell)
    #expect(hell.text == KortexFarben.akzentTextHell)
    let dunkel = try #require(werte(":root[data-pal^=\"dunkel\"]"))
    #expect(dunkel.akzent == KortexFarben.akzentDunkel)
    #expect(dunkel.text == KortexFarben.akzentTextDunkel)
}

@Test func studioFestlegtDenStandardAkzentNurInDenSchemata() throws {
    // Kein zweiter Farbton als „Akzent“ in den Studio-Stilen: als Eigenschaft steht --akzent nur in schemata.css (Rückfall je Hell/Dunkel); die Wahl des Nutzers kommt aus darstellung.js.
    let ordner = repo.appendingPathComponent("Ressourcen/studio")
    let css = try FileManager.default.contentsOfDirectory(atPath: ordner.path).filter { $0.hasSuffix(".css") }
    for datei in css {
        let text = try String(contentsOf: ordner.appendingPathComponent(datei), encoding: .utf8)
        let festlegungen = text.components(separatedBy: "\n").filter { $0.range(of: #"(^|[{;])\s*--akzent\s*:"#, options: .regularExpression) != nil }
        #expect(festlegungen.count == (datei == "schemata.css" ? 4 : 0), "\(datei)")
    }
}
