import Testing
import Foundation
import AppKit
import CoreGraphics
@testable import BrainCore

/// App-Logo „Windung“ (Entwurf 3, Originalfassung, gewählt am 30.10.2026): Menüleisten-Symbol (Geometrie und Zeichnung), App-Icon im Bundle, Einbau-Skripte.
private let repo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

private func text(_ pfad: String) throws -> String {
    try String(contentsOf: repo.appendingPathComponent(pfad), encoding: .utf8)
}

/// Rendert das Menüleisten-Symbol als Alpha-Bild (Zeilen von oben nach unten) in `punkt * faktor` Pixeln.
private func alphaBild(punkt: Int, faktor: Int) throws -> (px: Int, alpha: [UInt8]) {
    let px = punkt * faktor
    var daten = [UInt8](repeating: 0, count: px * px * 4)
    let ok = daten.withUnsafeMutableBytes { roh -> Bool in
        guard let ctx = CGContext(data: roh.baseAddress, width: px, height: px, bitsPerComponent: 8, bytesPerRow: px * 4,
                                  space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
        KortexMenueSymbol.zeichne(in: ctx, groesse: Double(px))
        return true
    }
    #expect(ok)
    // CGContext legt Zeile 0 oben ab (Speicherreihenfolge), y des Kontexts zeigt aber nach oben: Zeile = px - 1 - y.
    return (px, stride(from: 3, to: daten.count, by: 4).map { daten[$0] })
}

private func alphaBei(_ b: (px: Int, alpha: [UInt8]), _ p: CGPoint) -> UInt8 {
    let x = min(max(Int(p.x), 0), b.px - 1), y = min(max(Int(p.y), 0), b.px - 1)
    return b.alpha[(b.px - 1 - y) * b.px + x]
}

private typealias P = KortexMenueSymbol.P

@Test(arguments: [1, 2, 3])
func menueSymbolIstBeiAllenAufloesungenLesbar(faktor: Int) throws {
    let b = try alphaBild(punkt: 18, faktor: faktor)
    let px = Double(b.px)
    func bild(_ p: P) -> CGPoint { KortexMenueSymbol.bildpunkt(p, groesse: px) }

    // Der Strang ist durchgehend: Mitte jedes Abschnitts (Bahn oder Wendung) ist (bis auf Kantenglättung bei 1x) deckend.
    for a in KortexMenueSymbol.abschnitte {
        #expect(alphaBei(b, bild(KortexMenueSymbol.scheitel(a))) >= 200, "Abschnitt \(a) bei \(faktor)x unterbrochen")
    }
    // Luft: Zwischen je zwei Bahnen bleibt Hintergrund (Mitte der Taschen), sonst wird aus der Windung ein Block (Röhre).
    let s = 2 * KortexMenueSymbol.radius
    for i in 0..<(KortexMenueSymbol.bahnen - 1) {
        let t = P(0, KortexMenueSymbol.y(i) + s / 2)
        #expect(alphaBei(b, bild(t)) <= 60, "Tasche \(i) bei \(faktor)x zugelaufen")
    }
    // Ecken sind leer (kein Hintergrund, nur das Zeichen).
    for ecke in [CGPoint(x: 0, y: 0), CGPoint(x: px - 1, y: 0), CGPoint(x: 0, y: px - 1), CGPoint(x: px - 1, y: px - 1)] {
        #expect(alphaBei(b, ecke) == 0)
    }
    // Füllgrad: sichtbar, aber nicht zugelaufen.
    let anteil = Double(b.alpha.reduce(0) { $0 + Int($1) }) / (255 * px * px)
    #expect(anteil > 0.18 && anteil < 0.45, "Füllgrad \(anteil) bei \(faktor)x")
    // Außenmaße: die längere Seite (Höhe) füllt etwa 90 % des Bildes, mittig.
    var minX = b.px, maxX = -1, minY = b.px, maxY = -1
    for y in 0..<b.px { for x in 0..<b.px where b.alpha[y * b.px + x] > 127 { minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y) } }
    let hoehe = Double(maxY - minY + 1) / px
    #expect(abs(hoehe - KortexMenueSymbol.fuellAnteil) <= 1.5 / px + 0.01, "Höhe \(hoehe) bei \(faktor)x")
    #expect(abs((minY + maxY + 1) - b.px) <= 2 && abs((minX + maxX + 1) - b.px) <= 2, "Symbol nicht mittig bei \(faktor)x")
}

/// Die Windung ist oben und unten spiegelgleich (erste und letzte Bahn, zweite und dritte Bahn).
@Test func menueSymbolIstObenUndUntenSpiegelgleich() throws {
    let b = try alphaBild(punkt: 18, faktor: 3)
    for y in 0..<b.px / 2 { for x in 0..<b.px {
        let oben = Int(b.alpha[y * b.px + x]), unten = Int(b.alpha[(b.px - 1 - y) * b.px + x])
        #expect(abs(oben - unten) <= 3, "Zeile \(y), Spalte \(x)")
    } }
}

@Test func menueSymbolIstEineDurchgehendeLinieMitVierBahnen() {
    let a = KortexMenueSymbol.abschnitte
    // Abschnitte hängen lückenlos aneinander (Ende des einen = Anfang des nächsten), also eine einzige Linie.
    func anfang(_ x: KortexMenueSymbol.Abschnitt) -> P {
        switch x {
        case let .bahn(von, _): return von
        case let .wendung(m, _, ab): return P(m.x, m.y + (ab ? -1 : 1) * KortexMenueSymbol.radius)
        }
    }
    func ende(_ x: KortexMenueSymbol.Abschnitt) -> P {
        switch x {
        case let .bahn(_, nach): return nach
        case let .wendung(m, _, ab): return P(m.x, m.y + (ab ? 1 : -1) * KortexMenueSymbol.radius)
        }
    }
    for i in 1..<a.count {
        let e = ende(a[i - 1]), n = anfang(a[i])
        #expect(abs(e.x - n.x) < 1e-9 && abs(e.y - n.y) < 1e-9, "Lücke vor Abschnitt \(i)")
    }
    let bahnen = a.filter { if case .bahn = $0 { return true } else { return false } }
    #expect(KortexMenueSymbol.bahnen == 4 && bahnen.count == 4 && a.count - bahnen.count == 3, "vier Bahnen, drei Wendungen")
    // Die Wendungen wechseln die Seite (rechts, links, rechts): Serpentine, nicht Spirale.
    let seiten = a.compactMap { x -> Bool? in if case let .wendung(_, rechts, _) = x { return rechts } else { return nil } }
    #expect(seiten == [true, false, true])
    // Luft: Zwischen zwei Bahnen ist mindestens 80 % der Strichstärke frei (dünne Linie, mehr Luft statt Schlauch/Heizkörper).
    let luft = 2 * KortexMenueSymbol.radius - KortexMenueSymbol.kantenbreite
    #expect(luft >= 0.8 * KortexMenueSymbol.kantenbreite, "Luft \(luft)")
    // Die Bahnen sind länger als die Wendungen breit sind.
    #expect(KortexMenueSymbol.spanne > 2 * KortexMenueSymbol.radius)
}

/// Die App benutzt das Symbol als Template (System färbt es) und kennt keinen Rückfall auf das alte K oder das Netz.
@Test func menueBildIstTemplateUndNutztDieWindung() throws {
    let quelle = try text("Sources/BrainApp/Kortex.swift")
    #expect(quelle.contains("KortexMenueSymbol.zeichne(") && quelle.contains("bild.isTemplate = true"))
    #expect(!quelle.contains("kortex-c-k") && !quelle.contains("kortex-2-netz"), "Altes K oder Netz ist noch im Code")
}

// MARK: App-Icon

@Test func appIconIstEinGueltigesIcnsMitAllenGroessen() throws {
    let url = repo.appendingPathComponent("Ressourcen/AppIcon.icns")
    let daten = try Data(contentsOf: url)
    #expect(daten.prefix(4) == Data("icns".utf8))
    let bild = try #require(NSImage(contentsOf: url), "AppIcon.icns lässt sich nicht laden")
    let breiten = Set(bild.representations.map(\.pixelsWide))
    for erwartet in [16, 32, 64, 128, 256, 512, 1024] { #expect(breiten.contains(erwartet), "Größe \(erwartet) px fehlt im Icon") }
}

@Test func infoPlistUndBauSkriptLegenDasIconInsPaket() throws {
    #expect(try text("Ressourcen/Info.plist").contains("<key>CFBundleIconFile</key><string>AppIcon</string>"))
    let bau = try text("scripts/baue-app.sh")
    #expect(bau.contains("cp Ressourcen/AppIcon.icns \"$NEU/Contents/Resources/AppIcon.icns\""))
    #expect(bau.contains("\"$ordner\" = \"icon-entwuerfe\" ] && continue"), "Entwürfe dürfen nicht ins Paket")
    #expect(try text("scripts/veroeffentlichen.sh").contains("Contents/Resources/AppIcon.icns"))
}

@Test func iconSkriptBautAusDerWindungMitKleinvariante() throws {
    let skript = try text("scripts/baue-icon.sh")
    #expect(skript.contains("kortex-3-windung.svg") && skript.contains("kortex-3-windung-klein.svg"))
    #expect(!skript.contains("kortex-c-k") && !skript.contains("kortex-2-netz"))
    // Die Netz-Dateien bleiben als Archiv im Entwurfsordner.
    for datei in ["kortex-3-windung.svg", "kortex-3-windung.png", "kortex-3-windung-klein.svg", "kortex-3-windung-menue.svg", "kortex-3-windung-v2a.svg",
                  "kortex-3-windung-v2b.svg", "kortex-3-windung-v2c.svg", "kortex-2-netz.svg", "kortex-2-netz-klein.svg"] {
        #expect(FileManager.default.fileExists(atPath: repo.appendingPathComponent("Ressourcen/icon-entwuerfe/\(datei)").path), "\(datei) fehlt")
    }
    let readme = try text("Ressourcen/icon-entwuerfe/README.md")
    #expect(readme.contains("Original-Windung") && readme.contains("30.10.2026") && readme.contains("Netz") && readme.contains("verworfen"), "Die Wahl ist nicht dokumentiert")
}
