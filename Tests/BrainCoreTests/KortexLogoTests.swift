import Testing
import Foundation
import AppKit
import CoreGraphics
@testable import BrainCore

/// App-Logo „Windung“ (Entwurf 3, Fassung v2a, gewählt am 30.10.2026): Menüleisten-Symbol (Geometrie und Zeichnung), App-Icon im Bundle, Einbau-Skripte.
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
    // Luft: Zwischen den Bahnen bleibt Hintergrund (Mitte der Taschen zwischen zwei Bahnen), und der Spalt in der Mitte ist leer.
    let s = 2 * KortexMenueSymbol.radius, gi = KortexMenueSymbol.innen + KortexMenueSymbol.radius
    let taschen = [P(-(gi + 0.4), KortexMenueSymbol.y(0) + s / 2), P(-(gi + 0.4), KortexMenueSymbol.y(1) + s / 2), P(-(gi + 0.4), KortexMenueSymbol.y(2) + s / 2),
                   P(gi + 0.4, KortexMenueSymbol.y(0) + s / 2), P(gi + 0.4, KortexMenueSymbol.y(1) + s / 2), P(gi + 0.4, KortexMenueSymbol.y(2) + s / 2),
                   P(0, KortexMenueSymbol.y(0)), P(0, KortexMenueSymbol.y(1)), P(0, KortexMenueSymbol.y(2))]
    for t in taschen {
        // Der Spalt zwischen den freien Enden oben ist schmal (gut 1 pt); bei 1x ist er weniger als ein Pixel breit und wird nur halb sichtbar.
        let grenze = (t == P(0, KortexMenueSymbol.y(0)) && faktor == 1) ? 130 : 60
        #expect(Int(alphaBei(b, bild(t))) <= grenze, "Tasche \(t) bei \(faktor)x zugelaufen")
    }
    // Ecken sind leer (kein Hintergrund, nur das Zeichen).
    for ecke in [CGPoint(x: 0, y: 0), CGPoint(x: px - 1, y: 0), CGPoint(x: 0, y: px - 1), CGPoint(x: px - 1, y: px - 1)] {
        #expect(alphaBei(b, ecke) == 0)
    }
    // Füllgrad: sichtbar, aber nicht zugelaufen.
    let anteil = Double(b.alpha.reduce(0) { $0 + Int($1) }) / (255 * px * px)
    #expect(anteil > 0.18 && anteil < 0.45, "Füllgrad \(anteil) bei \(faktor)x")
    // Außenmaße: die längere Seite (Breite) füllt etwa 90 % des Bildes, mittig.
    var minX = b.px, maxX = -1, minY = b.px, maxY = -1
    for y in 0..<b.px { for x in 0..<b.px where b.alpha[y * b.px + x] > 127 { minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y) } }
    let breite = Double(maxX - minX + 1) / px
    #expect(abs(breite - KortexMenueSymbol.fuellAnteil) <= 1.5 / px + 0.01, "Breite \(breite) bei \(faktor)x")
    #expect(abs((minY + maxY + 1) - b.px) <= 2 && abs((minX + maxX + 1) - b.px) <= 2, "Symbol nicht mittig bei \(faktor)x")
}

@Test func menueSymbolIstLinksUndRechtsSpiegelgleich() throws {
    let b = try alphaBild(punkt: 18, faktor: 3)
    for y in 0..<b.px { for x in 0..<b.px / 2 {
        let links = Int(b.alpha[y * b.px + x]), rechts = Int(b.alpha[y * b.px + (b.px - 1 - x)])
        #expect(abs(links - rechts) <= 3, "Zeile \(y), Spalte \(x)")
    } }
}

@Test func menueSymbolIstEinStrangMitVierBahnenUndKlarerLuft() {
    let a = KortexMenueSymbol.abschnitte
    // Abschnitte hängen lückenlos aneinander (Ende des einen = Anfang des nächsten), also ein einziger Strang.
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
    let wendungen = a.count - bahnen.count
    #expect(KortexMenueSymbol.bahnen == 4 && wendungen == 6 && bahnen.count == 7, "vier Reihen je Seite: sechs Wendungen, sieben Bahnstücke")
    // Luft: Zwischen zwei Bahnen ist mindestens 80 % der Strichstärke frei, sonst verschmilzt die Windung bei 18 pt zu einem Block (Heizkörper-Effekt).
    let luft = 2 * KortexMenueSymbol.radius - KortexMenueSymbol.kantenbreite
    #expect(luft >= 0.8 * KortexMenueSymbol.kantenbreite, "Luft \(luft)")
    // Spalt zwischen den Innenscheiteln und den freien Enden: sichtbar, aber schmaler als die Bahn-Luft.
    #expect(2 * KortexMenueSymbol.innen - KortexMenueSymbol.kantenbreite >= 0.4)
    #expect(2 * KortexMenueSymbol.freiesEnde - KortexMenueSymbol.kantenbreite >= 0.4)
    // Außenscheitel liegen weiter draußen als die Innenscheitel; die Bahnen dazwischen sind länger als die Strichstärke.
    #expect(KortexMenueSymbol.aussen - KortexMenueSymbol.radius - (KortexMenueSymbol.innen + KortexMenueSymbol.radius) > KortexMenueSymbol.kantenbreite)
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
    #expect(skript.contains("kortex-3-windung-v2a.svg") && skript.contains("kortex-3-windung-klein.svg"))
    #expect(!skript.contains("kortex-c-k") && !skript.contains("kortex-2-netz"))
    // Die Netz-Dateien bleiben als Archiv im Entwurfsordner.
    for datei in ["kortex-3-windung-v2a.svg", "kortex-3-windung-v2a.png", "kortex-3-windung-klein.svg", "kortex-3-windung-menue.svg",
                  "kortex-3-windung-v2b.svg", "kortex-3-windung-v2c.svg", "kortex-3-windung.svg", "kortex-2-netz.svg", "kortex-2-netz-klein.svg"] {
        #expect(FileManager.default.fileExists(atPath: repo.appendingPathComponent("Ressourcen/icon-entwuerfe/\(datei)").path), "\(datei) fehlt")
    }
    let readme = try text("Ressourcen/icon-entwuerfe/README.md")
    #expect(readme.contains("Windung") && readme.contains("30.10.2026") && readme.contains("Netz") && readme.contains("verworfen"), "Die Wahl ist nicht dokumentiert")
}
