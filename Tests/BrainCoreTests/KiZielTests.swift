import Testing
import Foundation
@testable import BrainCore

private func ressourcen() -> URL {
    URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("Ressourcen", isDirectory: true)
}

private func lies(_ rel: String) throws -> String {
    try String(contentsOf: ressourcen().appendingPathComponent(rel), encoding: .utf8)
}

/// Alle Treffer von `muster` (Gruppe 1) in `text`.
private func treffer(_ muster: String, in text: String) throws -> [String] {
    let re = try NSRegularExpression(pattern: muster)
    return re.matches(in: text, range: NSRange(text.startIndex..., in: text)).compactMap { m in
        Range(m.range(at: 1), in: text).map { String(text[$0]) }
    }
}

// MARK: Ziele gegen die Werkstatt

/// Die Ziele in Swift und die Beschreibungen der Werkstatt (`ki-programme/programme.mjs`) sind dieselbe Liste: gleiche Namen, gleicher Dateiort.
@Test func zieleStimmenMitDerWerkstattUeberein() throws {
    let js = try lies("werkstatt/ki-programme/programme.mjs")
    let ids = try treffer(#"\{ id: "([a-z-]+)", name: ""#, in: js)
    let namen = try treffer(#"\{ id: "[a-z-]+", name: "([^"]+)""#, in: js)
    let orte = try treffer(#"anzeige: "([^"]+)""#, in: js)
    #expect(ids.count == 7 && namen.count == 7 && orte.count == 7)
    // Reihenfolge der Werkstatt: cursor, claude-desktop, gemini, copilot, zed, opencode, warp
    let dateiZiele = KiZiel.verbindbar.filter { $0.dateiOrt != nil }
    #expect(Set(dateiZiele.map(\.ziel)) == Set(ids))
    for (i, id) in ids.enumerated() {
        let ziel = try #require(dateiZiele.first { $0.ziel == id }, "Ziel \(id) fehlt in Swift")
        #expect(ziel.name == namen[i], Comment(rawValue: id))
        #expect(ziel.dateiOrt == orte[i], Comment(rawValue: id))
    }
    // Claude Code und Codex laufen über ihren Befehl, nicht über eine Datei
    #expect(KiZiel.claude.dateiOrt == nil && KiZiel.codex.dateiOrt == nil)
}

@Test func zieleSindEindeutigUndHabenTexte() {
    #expect(Set(KiZiel.allCases.map(\.ziel)).count == KiZiel.allCases.count)
    #expect(Set(KiZiel.allCases.map(\.name)).count == KiZiel.allCases.count)
    #expect(KiZiel.claudeDesktop.ziel == "claude-desktop" && KiZiel.claudeDesktop.agentId == "claude-desktop")
    for z in KiZiel.allCases where z.dateiOrt != nil {
        #expect(z.kopierHinweis.contains(z.dateiOrt!), Comment(rawValue: z.name))
        #expect(z.dateiOrt!.hasPrefix("~/"))
    }
    #expect(KiZiel.claude.kopierHinweis.contains("Terminal"))
}

@Test func programmeMitEinstellungsdateiKommenAusDerWerkstattListe() {
    let liste = WerkstattDienste.programme(aus: [
        "agenten": [["id": "claude", "name": "Claude Code", "version": "2.1.0", "pfad": "/x/claude"]],
        "programme": [
            ["id": "claude-desktop", "name": "Claude Desktop", "gefunden": true, "version": "1.4.2", "quelle": "app"],
            ["id": "gemini", "name": "Gemini CLI", "gefunden": false, "version": NSNull(), "quelle": NSNull()],
        ],
        "cursorDa": false,
    ])
    #expect(liste.map(\.id) == ["claude", "claude-desktop", "gemini", "cursor"], "Cursor bleibt zuletzt")
    #expect(liste[1] == KiProgramm(id: "claude-desktop", name: "Claude Desktop", version: "1.4.2", gefunden: true))
    #expect(liste[2].gefunden == false && liste[2].version == nil)
    // ältere Werkstatt ohne `programme`: nichts Neues gefunden
    #expect(WerkstattDienste.programme(aus: ["agenten": []]).map(\.id) == ["cursor"])
}

/// OpenCode und Gemini stehen als Agent (nur Befehl) UND als Programm (auch App): es zählt der Eintrag aus `programme`, die Version bleibt erhalten.
@Test func agentUndProgrammMitDerselbenIdWerdenZusammengefuehrt() {
    let liste = WerkstattDienste.programme(aus: [
        "agenten": [["id": "opencode", "name": "OpenCode", "version": NSNull(), "pfad": NSNull()],
                    ["id": "gemini", "name": "Gemini CLI", "version": "0.12.3", "pfad": "/x/gemini"]],
        "programme": [["id": "opencode", "name": "OpenCode", "gefunden": true, "version": NSNull(), "quelle": "app"],
                      ["id": "gemini", "name": "Gemini CLI", "gefunden": true, "version": NSNull(), "quelle": "cli"]],
        "cursorDa": false,
    ])
    #expect(liste.map(\.id) == ["opencode", "gemini", "cursor"])
    #expect(liste[0].gefunden, "nur die App ist da: trotzdem gefunden")
    #expect(liste[1] == KiProgramm(id: "gemini", name: "Gemini CLI", version: "0.12.3", gefunden: true), "Version aus dem Agenten")
}

// MARK: Logos

private func ansichtZahlen(_ s: String) -> [Double] { s.split(separator: " ").compactMap { Double($0) } }

@Test func ansichtenSindQuadratischUndLiegenUmDieGlypheNeuAngelegt() {
    for ki in KiZiel.allCases {
        guard let a = ki.logoAnsicht else { #expect(ki.logoDatei == nil); continue }
        let z = ansichtZahlen(a)
        #expect(z.count == 4 && z[2] == z[3] && z[2] >= 24, "Quadrat, nie kleiner als die Zeichenfläche: \(ki.name)")
        // die Mitte der Zeichenfläche (12, 12) liegt in der Mitte der Ansicht — die Glyphen von Simple Icons sind auf 24×24 zentriert
        #expect(abs(z[0] + z[2] / 2 - 12) < 0.02 && abs(z[1] + z[3] / 2 - 12) < 0.02, Comment(rawValue: ki.name))
    }
}

/// Die Daten für die Darstellung sind die Datei mit anderem `viewBox` — der Pfad bleibt Zeichen für Zeichen derselbe.
@Test func logoDatenAendernNurDenViewBox() throws {
    for ki in KiZiel.allCases where ki.logoDatei != nil {
        let url = try #require(KILogoQuelle.url(ki, ressourcen: ressourcen()))
        let original = try String(contentsOf: url, encoding: .utf8)
        let daten = try #require(KILogoQuelle.daten(ki, ressourcen: ressourcen()), Comment(rawValue: ki.name))
        let neu = try #require(String(data: daten, encoding: .utf8))
        #expect(neu == original.replacingOccurrences(of: "viewBox=\"0 0 24 24\"", with: "viewBox=\"\(ki.logoAnsicht!)\""))
        #expect(neu.contains(try #require(treffer(#"<path d="([^"]+)""#, in: original).first)))
    }
    #expect(KILogoQuelle.daten(.codex, ressourcen: ressourcen()) == nil)
    #expect(KILogoQuelle.daten(.claude, ressourcen: nil) == nil)
}

/// Die Zahlen im Studio (`ki-logos.js`) und hier sind dieselben, sonst sähe dasselbe Logo in App und Studio verschieden groß aus.
@Test func ansichtenGleichenDenenImStudio() throws {
    let js = try lies("studio/ki-logos.js")
    let block = try #require(js.components(separatedBy: "export const ANSICHT = {").last?.components(separatedBy: "};").first)
    let eintraege = try treffer(#"(\w+): "[-\d. ]+""#, in: block)
    #expect(eintraege.count == 7)
    for name in eintraege {
        let wert = try #require(treffer("\(name): \"([-\\d. ]+)\"", in: block).first)
        let ki: KiZiel = try #require(KiZiel.allCases.first { ($0.logoDatei ?? "") == "\(name).svg" })
        #expect(ki.logoAnsicht == wert, Comment(rawValue: name))
    }
    // und die Pfaddaten im Studio sind die der Dateien
    for ki in KiZiel.allCases {
        guard let datei = ki.logoDatei else { continue }
        let svg = try String(contentsOf: ressourcen().appendingPathComponent("logos/\(datei)"), encoding: .utf8)
        let d = try #require(treffer(#"<path d="([^"]+)""#, in: svg).first)
        #expect(js.contains("\"\(d)\""), Comment(rawValue: datei))
    }
}

/// Markenfarbe nur bei mindestens 3:1 Kontrast auf Weiß UND auf dem dunklen Fenster (#1E1E1E); sonst Textfarbe. Die schwarzen und die zu
/// dunklen oder zu hellen Marken (Zed, Warp) stehen deshalb einfarbig.
@Test func markenfarbeNurBeiAusreichendemKontrastAufHellUndDunkel() {
    func luminanz(_ hex: String) -> Double {
        let w = UInt32(hex, radix: 16) ?? 0
        func k(_ v: UInt32) -> Double { let c = Double(v) / 255; return c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
        return 0.2126 * k((w >> 16) & 0xFF) + 0.7152 * k((w >> 8) & 0xFF) + 0.0722 * k(w & 0xFF)
    }
    func kontrast(_ a: String, _ b: String) -> Double { let x = max(luminanz(a), luminanz(b)), y = min(luminanz(a), luminanz(b)); return (x + 0.05) / (y + 0.05) }
    for ki in KiZiel.allCases {
        if let f = ki.logoFarbeHex {
            #expect(kontrast(f, "FFFFFF") >= 3 && kontrast(f, "1E1E1E") >= 3, Comment(rawValue: ki.name))
        }
    }
    #expect(Set(KiZiel.allCases.filter { $0.logoFarbeHex != nil }) == [.claude, .claudeDesktop, .gemini])
    // diese Marken wären auf einem der beiden Hintergründe unter 3:1 und bleiben deshalb einfarbig
    #expect(kontrast("084CCF", "1E1E1E") < 3 && kontrast("01A4FF", "FFFFFF") < 3)
}
