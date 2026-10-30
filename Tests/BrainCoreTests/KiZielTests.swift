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

// MARK: Logos und Katalog

private func katalog() throws -> KiKatalog {
    try #require(KiKatalog.laden(ressourcen: ressourcen()), "Ressourcen/gemeinsam/ki-katalog.json fehlt oder ist nicht lesbar")
}

private func ansichtZahlen(_ s: String) -> [Double] { s.split(separator: " ").compactMap { Double($0) } }

/// Die verbindbaren Ziele in Swift und die Einträge des Katalogs (`verbindbar: true`) sind dieselbe Liste: gleiche ids, Namen und Reihenfolge.
@Test func verbindbareZieleStimmenMitDemKatalogUeberein() throws {
    let k = try katalog()
    let imKatalog = k.eintraege.filter(\.verbindbar)
    #expect(Set(imKatalog.map(\.id)) == Set(KiZiel.verbindbar.map(\.ziel)))
    for ki in KiZiel.allCases {
        let e = try #require(k.eintrag(ki.ziel), "\(ki.ziel) fehlt im Katalog")
        #expect(e.verbindbar && e.name == ki.name, Comment(rawValue: ki.ziel))
    }
    // gleiche Reihenfolge wie im Katalog (Claude Code zuerst)
    #expect(KiZiel.verbindbar.map(\.ziel) == imKatalog.map(\.id).filter { id in KiZiel.verbindbar.contains { $0.ziel == id } })
}

@Test func ansichtenSindQuadratischUndLiegenUmDieGlypheNeuAngelegt() throws {
    for e in try katalog().eintraege {
        guard let l = e.logo else { continue }
        if l.istSVG {
            let z = ansichtZahlen(try #require(l.ansicht, Comment(rawValue: e.id)))
            #expect(z.count == 4 && z[2] == z[3] && z[2] > 0, "Quadrat: \(e.name)")
        } else {
            #expect(l.ansicht == nil, "PNG hat keine Ansicht: \(e.name)")
        }
    }
}

/// Die Daten für die Darstellung sind die Datei mit anderem `viewBox` — alles andere bleibt Zeichen für Zeichen dasselbe.
@Test func logoDatenAendernNurDenViewBox() throws {
    func ohneViewBox(_ s: String) -> String { s.replacingOccurrences(of: #"viewBox="[^"]*""#, with: "", options: .regularExpression) }
    for ki in KiZiel.allCases {
        guard let info = ki.logo(ressourcen: ressourcen()), info.istSVG else { continue }
        let url = try #require(KILogoQuelle.url(ki, ressourcen: ressourcen()))
        let original = try String(contentsOf: url, encoding: .utf8)
        let daten = try #require(KILogoQuelle.daten(ki, ressourcen: ressourcen()), Comment(rawValue: ki.name))
        let neu = try #require(String(data: daten, encoding: .utf8))
        #expect(neu.contains("viewBox=\"\(info.ansicht!)\""), Comment(rawValue: ki.name))
        #expect(ohneViewBox(neu) == ohneViewBox(original), Comment(rawValue: ki.name))
    }
    #expect(KILogoQuelle.daten(.claude, ressourcen: nil) == nil)
    #expect(KILogoQuelle.mitAnsicht("<svg xmlns=\"x\"><path d=\"M0 0\"/></svg>", "0 0 24 24") == nil, "ohne viewBox keine Darstellung")
    #expect(KILogoQuelle.mitAnsicht("<svg viewBox=\"0 0 24 24\"><script>x</script></svg>", "0 0 24 24") == nil, "Skripte nie")
    #expect(KILogoQuelle.mitAnsicht("<svg viewBox=\"0 0 24 24\"><path d=\"M0 0\"/></svg>", "0 0 30 30") == "<svg viewBox=\"0 0 30 30\"><path d=\"M0 0\"/></svg>")
}

/// Das Studio (`ki-katalog.js`, erzeugt von scripts/erzeuge-ki-katalog.mjs) trägt dieselben ids, Namen und Ansichten wie der Katalog, sonst
/// sähe dasselbe Logo in App und Studio verschieden groß aus.
@Test func katalogImStudioGleichtDemKatalog() throws {
    let js = try lies("studio/ki-katalog.js")
    for e in try katalog().eintraege {
        #expect(js.contains("\"id\":\"\(e.id)\",\"name\":\"\(e.name)\""), Comment(rawValue: e.id))
        if let l = e.logo, l.istSVG { #expect(js.contains("viewBox=\\\"\(l.ansicht!)\\\""), Comment(rawValue: e.id)) }
    }
}

/// Markenfarbe nur bei mindestens 3:1 Kontrast auf Weiß UND auf dem dunklen Fenster (#1E1E1E); sonst Textfarbe oder Bild.
@Test func markenfarbeNurBeiAusreichendemKontrastAufHellUndDunkel() throws {
    func luminanz(_ hex: String) -> Double {
        let w = UInt32(hex, radix: 16) ?? 0
        func k(_ v: UInt32) -> Double { let c = Double(v) / 255; return c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
        return 0.2126 * k((w >> 16) & 0xFF) + 0.7152 * k((w >> 8) & 0xFF) + 0.0722 * k(w & 0xFF)
    }
    func kontrast(_ a: String, _ b: String) -> Double { let x = max(luminanz(a), luminanz(b)), y = min(luminanz(a), luminanz(b)); return (x + 0.05) / (y + 0.05) }
    var gesehen = 0
    for e in try katalog().eintraege {
        guard let l = e.logo, l.modus == .marke else { continue }
        let f = try #require(l.farbeHex, Comment(rawValue: e.id))
        #expect(kontrast(f, "FFFFFF") >= 3 && kontrast(f, "1E1E1E") >= 3, Comment(rawValue: e.name))
        gesehen += 1
    }
    #expect(gesehen >= 2, "Claude und Gemini behalten ihre Markenfarbe")
    #expect(KiZiel.claude.logo(ressourcen: ressourcen())?.farbeHex == "D97757" && KiZiel.claudeDesktop.logo(ressourcen: ressourcen())?.farbeHex == "D97757")
    // diese Marken wären auf einem der beiden Hintergründe unter 3:1 und bleiben deshalb einfarbig
    #expect(kontrast("084CCF", "1E1E1E") < 3 && kontrast("01A4FF", "FFFFFF") < 3)
    #expect(KiZiel.zed.logo(ressourcen: ressourcen())?.modus == .einfarbig && KiZiel.warp.logo(ressourcen: ressourcen())?.modus == .einfarbig)
}
