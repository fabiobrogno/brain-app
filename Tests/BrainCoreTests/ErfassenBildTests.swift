import Testing
import Foundation
import AppKit
import SwiftUI
@testable import BrainCore

/// Bilder des Fensters „Schnell erfassen“ (hell/dunkel) ohne Fenster auf dem Bildschirm: Die Ansicht wird in einem unsichtbaren Fenster
/// aufgebaut und in eine Bitmap gezeichnet. Mit `KORTEX_BILDER_ORDNER=<absoluter Ordner>` landen die PNGs dort (zum Ansehen); ohne bleibt es
/// bei den Prüfungen. Die App selbst wird dafür nicht gestartet.
@MainActor
private func foto(_ modell: ErfassenModell, dunkel: Bool, name: String) async throws -> NSBitmapImageRep {
    _ = NSApplication.shared
    let rand: CGFloat = 28
    let breite = ErfassenAnsicht.breite + 2 * rand, hoehe = ErfassenAnsicht.hoehe + 2 * rand
    // Ein ruhiger Untergrund wie ein Schreibtisch: das Material des Fensters braucht etwas dahinter.
    let untergrund = LinearGradient(colors: dunkel ? [Color(white: 0.16), Color(white: 0.09)] : [Color(white: 0.86), Color(white: 0.74)],
                                    startPoint: .topLeading, endPoint: .bottomTrailing)
    let inhalt = ZStack { untergrund; ErfassenAnsicht(modell: modell).shadow(color: .black.opacity(0.28), radius: 14, y: 6) }
        .frame(width: breite, height: hoehe)
    let host = NSHostingView(rootView: inhalt)
    let aussehen = NSAppearance(named: dunkel ? .darkAqua : .aqua)
    host.appearance = aussehen
    host.frame = NSRect(x: 0, y: 0, width: breite, height: hoehe)
    let fenster = NSWindow(contentRect: host.frame, styleMask: [.borderless], backing: .buffered, defer: false)
    fenster.appearance = aussehen
    fenster.contentView = host
    host.layoutSubtreeIfNeeded()
    for _ in 0..<6 {
        try await Task.sleep(for: .milliseconds(60))
        host.layoutSubtreeIfNeeded()
    }
    let rep = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
    host.cacheDisplay(in: host.bounds, to: rep)
    if let ordner = ProcessInfo.processInfo.environment["KORTEX_BILDER_ORDNER"], ordner.hasPrefix("/") {
        let ziel = URL(fileURLWithPath: ordner, isDirectory: true)
        try FileManager.default.createDirectory(at: ziel, withIntermediateDirectories: true)
        try #require(rep.representation(using: .png, properties: [:])).write(to: ziel.appendingPathComponent("\(name)-\(dunkel ? "dunkel" : "hell").png"))
    }
    return rep
}

/// Wie viele verschiedene Farben hat das Bild (grob)? Ein leeres oder einfarbiges Bild hätte eine.
private func farbenzahl(_ rep: NSBitmapImageRep) -> Int {
    var farben = Set<UInt32>()
    for y in stride(from: 0, to: rep.pixelsHigh, by: 3) {
        for x in stride(from: 0, to: rep.pixelsWide, by: 3) {
            guard let c = rep.colorAt(x: x, y: y)?.usingColorSpace(.sRGB) else { continue }
            let r = UInt32(c.redComponent * 31), g = UInt32(c.greenComponent * 31), b = UInt32(c.blueComponent * 31)
            farben.insert(r << 10 | g << 5 | b)
        }
    }
    return farben.count
}

/// Kommt die Akzentfarbe von Kortex im Bild vor (Speichern-Knopf)? Mit Toleranz: Das Bild liegt im Farbprofil des Bildschirms.
private func hatAkzent(_ rep: NSBitmapImageRep, dunkel: Bool) -> Bool {
    let hex = dunkel ? KortexFarben.akzentDunkel : KortexFarben.akzentHell
    let soll = KortexFarben.komponenten(hex)!
    for y in stride(from: 0, to: rep.pixelsHigh, by: 2) {
        for x in stride(from: 0, to: rep.pixelsWide, by: 2) {
            // Rohwerte aus dem Bild (kalibriertes RGB); eine Umrechnung nach sRGB würde sie verfälschen.
            guard let c = rep.colorAt(x: x, y: y) else { continue }
            if abs(c.redComponent - soll.r) < 0.05, abs(c.greenComponent - soll.g) < 0.05, abs(c.blueComponent - soll.b) < 0.05 { return true }
        }
    }
    return false
}

@MainActor private func modell(art: ErfassungsArt = .aufgabe, text: String = "", vaults: Int = 1, vertraut: Bool = true) -> ErfassenModell {
    let liste = [ErfassenVault(name: "Privat", url: URL(fileURLWithPath: "/tmp/erfassen-bild/privat")),
                 ErfassenVault(name: "Firma", url: URL(fileURLWithPath: "/tmp/erfassen-bild/firma"))]
    let m = ErfassenModell(art: art, speicher: FalscherSpeicher(), vaultQuelle: { (Array(liste.prefix(vaults)), liste[0].url) },
                           vertrauen: { _ in vertraut ? .vertraut : .nurAnsehen }, heute: { erfassenHeute }, kalender: erfassenKalender)
    m.text = text
    return m
}

@MainActor @Test(arguments: [false, true]) func aufgabeMitErkanntenKurzformen(dunkel: Bool) async throws {
    let rep = try await foto(modell(text: "Steuererklärung machen morgen !hoch\nBelege aus dem Ordner „2026“ holen"), dunkel: dunkel, name: "aufgabe")
    #expect(rep.pixelsWide >= 600 && farbenzahl(rep) > 40, "leeres Bild")
    #expect(hatAkzent(rep, dunkel: dunkel), "Speichern-Knopf in der Kortex-Akzentfarbe fehlt")
}

@MainActor @Test(arguments: [false, true]) func notizLeerMitPlatzhalter(dunkel: Bool) async throws {
    let rep = try await foto(modell(art: .notiz), dunkel: dunkel, name: "notiz-leer")
    #expect(farbenzahl(rep) > 30)
}

@MainActor @Test(arguments: [false, true]) func notizMitMehrerenVaults(dunkel: Bool) async throws {
    let rep = try await foto(modell(art: .notiz, text: "Kaffee direkt vom Röster bestellen — Bohnen für den Winter", vaults: 2), dunkel: dunkel, name: "notiz-vaults")
    #expect(farbenzahl(rep) > 30)
}

@MainActor @Test(arguments: [false, true]) func nurAnsehenZeigtDieMeldung(dunkel: Bool) async throws {
    let rep = try await foto(modell(text: "Etwas aufschreiben", vertraut: false), dunkel: dunkel, name: "nur-ansehen")
    #expect(farbenzahl(rep) > 30)
}

@MainActor @Test(arguments: [false, true]) func gespeichertBestaetigung(dunkel: Bool) async throws {
    let m = modell(text: "Steuererklärung machen morgen")
    m.text = "Steuererklärung machen morgen"
    // Bestätigung stehen lassen: kein Schließen, keine Wartezeit
    m.beiSchliessen = {}
    await m.speichere()
    guard case .gespeichert = m.zustand else { Issue.record("nicht gespeichert: \(m.zustand)"); return }
    m.text = ""
    let rep = try await foto(m, dunkel: dunkel, name: "gespeichert")
    #expect(farbenzahl(rep) > 30)
}

@MainActor @Test(arguments: [false, true]) func kuerzelAendernZeigtDasAufnahmefeld(dunkel: Bool) async throws {
    let m = modell(text: "Ein Gedanke")
    m.kuerzelAendern = true
    m.kuerzelMeldung = "Dieses Kürzel ist schon von einem anderen Programm belegt."
    let rep = try await foto(m, dunkel: dunkel, name: "kuerzel-aendern")
    #expect(farbenzahl(rep) > 30)
}

@MainActor @Test func dieHoeheReichtFuerAlleZeilen() {
    // Kopf 28 + Feld 96+20 + Zeile 26 + Meldung 34 + Fuß ~30 + Abstände 4×12 + Rand 2×16 ≈ 294: knapp unter der festen Höhe darf nichts abgeschnitten werden.
    #expect(ErfassenAnsicht.hoehe >= 270 && ErfassenAnsicht.breite == 560)
}
