import Testing
import Foundation
import AppKit
import CoreGraphics
@testable import BrainCore

/// App-Logo „Netz“ (Entwurf 2, gewählt am 30.10.2026): Menüleisten-Symbol (Geometrie und Zeichnung), App-Icon im Bundle, Einbau-Skripte.
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

@Test(arguments: [1, 2, 3])
func menueSymbolIstBeiAllenAufloesungenLesbar(faktor: Int) throws {
    let b = try alphaBild(punkt: 18, faktor: faktor)
    let px = Double(b.px)

    // Jeder der fünf Knoten ist ausgefüllt (Mittelpunkt deckend).
    for i in KortexMenueSymbol.knoten.indices {
        #expect(alphaBei(b, KortexMenueSymbol.mittelpunkt(i, groesse: px)) >= 250, "Knoten \(i) bei \(faktor)x nicht ausgefüllt")
    }
    // Die Kanten verbinden: Mitte jeder Kante (Stamm oben–Kern, Kern–Stamm unten, beide Arme) ist (bis auf Kantenglättung bei 1x) deckend.
    for (von, nach) in [(0, 4), (4, 1), (4, 2), (4, 3)] {
        let a = KortexMenueSymbol.mittelpunkt(von, groesse: px), c = KortexMenueSymbol.mittelpunkt(nach, groesse: px)
        #expect(alphaBei(b, CGPoint(x: (a.x + c.x) / 2, y: (a.y + c.y) / 2)) >= 200, "Kante \(von)-\(nach) bei \(faktor)x unterbrochen")
    }
    // Ecken sind leer (kein Hintergrund, nur das Zeichen).
    for ecke in [CGPoint(x: 0, y: 0), CGPoint(x: px - 1, y: 0), CGPoint(x: 0, y: px - 1), CGPoint(x: px - 1, y: px - 1)] {
        #expect(alphaBei(b, ecke) == 0)
    }
    // Füllgrad: sichtbar, aber nicht zugelaufen.
    let anteil = Double(b.alpha.reduce(0) { $0 + Int($1) }) / (255 * px * px)
    #expect(anteil > 0.15 && anteil < 0.45, "Füllgrad \(anteil) bei \(faktor)x")
    // Außenmaße: etwa 88 % der Höhe, mittig.
    var minX = b.px, maxX = -1, minY = b.px, maxY = -1
    for y in 0..<b.px { for x in 0..<b.px where b.alpha[y * b.px + x] > 127 { minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y) } }
    let hoehe = Double(maxY - minY + 1) / px
    #expect(abs(hoehe - KortexMenueSymbol.hoehenAnteil) <= 1.5 / px + 0.01, "Höhe \(hoehe) bei \(faktor)x")
    #expect(abs((minY + maxY + 1) - b.px) <= 1 && abs((minX + maxX + 1) - b.px) <= 2, "Symbol nicht mittig bei \(faktor)x")
}

@Test func menueSymbolIstObenUndUntenSpiegelgleich() throws {
    let b = try alphaBild(punkt: 18, faktor: 3)
    for y in 0..<b.px / 2 { for x in 0..<b.px {
        let oben = Int(b.alpha[y * b.px + x]), unten = Int(b.alpha[(b.px - 1 - y) * b.px + x])
        #expect(abs(oben - unten) <= 2, "Zeile \(y), Spalte \(x)")
    } }
}

@Test func menueSymbolHatFuenfKnotenMitKlarerHierarchie() {
    let k = KortexMenueSymbol.knoten
    #expect(k.count == 5)
    let kern = k[4]
    #expect(kern.x == 0 && kern.y == 0)
    #expect(k.dropLast().allSatisfy { $0.radius < kern.radius }, "Der Kern ist der größte Knoten")
    // Zwischen zwei Knoten bleibt sichtbare Linie (Abstand > Summe der Radien + Kantenbreite/2), sonst verschmilzt das Netz bei 18 pt.
    for (v, n) in KortexMenueSymbol.kanten where v != 0 || n != 1 {
        let a = k[v], c = k[n]
        let abstand = ((a.x - c.x) * (a.x - c.x) + (a.y - c.y) * (a.y - c.y)).squareRoot()
        #expect(abstand > a.radius + c.radius + 20, "Kante \(v)-\(n) zu kurz")
    }
    #expect(KortexMenueSymbol.kantenbreite < 2 * k.dropLast().map(\.radius).min()!, "Kanten dünner als die Knoten")
}

/// Die App benutzt das Symbol als Template (System färbt es) und kennt keinen Rückfall auf das alte K.
@Test func menueBildIstTemplateUndNutztDasNetzSymbol() throws {
    let quelle = try text("Sources/BrainApp/Kortex.swift")
    #expect(quelle.contains("KortexMenueSymbol.zeichne(") && quelle.contains("bild.isTemplate = true"))
    #expect(!quelle.contains("kortex-c-k"), "Altes K-Template ist noch im Code")
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

@Test func iconSkriptBautAusDemNetzEntwurfMitKleinvariante() throws {
    let skript = try text("scripts/baue-icon.sh")
    #expect(skript.contains("kortex-2-netz.svg") && skript.contains("kortex-2-netz-klein.svg"))
    #expect(!skript.contains("kortex-c-k"))
    for datei in ["kortex-2-netz.svg", "kortex-2-netz-klein.svg", "kortex-2-netz.png"] {
        #expect(FileManager.default.fileExists(atPath: repo.appendingPathComponent("Ressourcen/icon-entwuerfe/\(datei)").path), "\(datei) fehlt")
    }
    let readme = try text("Ressourcen/icon-entwuerfe/README.md")
    #expect(readme.contains("Netz") && readme.contains("30.10.2026"), "Die Wahl ist nicht dokumentiert")
}
