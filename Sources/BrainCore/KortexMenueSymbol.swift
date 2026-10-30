import Foundation
import CoreGraphics

/// Die Windung der App als Menüleisten-Symbol (einfarbig, ohne Fläche; das System färbt das Template-Bild hell/dunkel).
/// Gewählt ist Entwurf 3 „Windung“ (`Ressourcen/icon-entwuerfe/kortex-3-windung-v2a.svg`, 30.10.2026): ein durchgehender Strang, der sich in
/// Bahnen faltet und im Umriss ein Gehirn von oben andeutet, links und rechts ein Spalt. Für 18 pt ist die Windung vereinfacht (vier Bahnen
/// je Seite statt sechs, spiegelgleich, dickerer Strich); dieselbe Geometrie hat die Kleinvariante des App-Icons (`kortex-3-windung-klein.svg`)
/// und das Studio-Symbol `marke`.
///
/// Nur Geometrie und Zeichnung (CoreGraphics, UI-unabhängig), damit Tests sie ohne SwiftUI prüfen; `KortexMenueBild` in der App
/// macht daraus das `NSImage`. Alle Maße in Einheiten, y nach unten (wie im SVG), Mitte des Symbols im Ursprung.
public enum KortexMenueSymbol {
    /// Punkt in Einheiten.
    public struct P: Equatable, Sendable {
        public let x: Double
        public let y: Double
        public init(_ x: Double, _ y: Double) { self.x = x; self.y = y }
    }

    /// Ein Stück der Mittellinie: gerade Bahn oder Halbkreis-Wendung (Bauch nach links/rechts, von oben nach unten oder umgekehrt).
    public enum Abschnitt: Equatable, Sendable {
        case bahn(von: P, nach: P)
        case wendung(mitte: P, bauchRechts: Bool, abwaerts: Bool)
    }

    /// Halber Reihenabstand = Radius jeder Wendung.
    public static let radius: Double = 1.1
    /// Strichstärke.
    public static let kantenbreite: Double = 1.15
    /// Abstand der Außenscheitel (äußerster Punkt der Mittellinie) von der Mitte.
    public static let aussen: Double = 4.3
    /// Abstand der Innenscheitel (am Spalt) von der Mitte.
    public static let innen: Double = 0.85
    /// Abstand der freien Enden oben von der Mitte.
    public static let freiesEnde: Double = 0.95
    /// Zahl der Bahnen je Seite (die unterste läuft durch).
    public static let bahnen = 4

    /// Anteil der Bildgröße, den die längere Seite des Symbols füllt (der Rest ist Luft).
    public static let fuellAnteil: Double = 0.9

    /// Höhe der Bahn `i` (0 oben).
    static func y(_ i: Int) -> Double { (Double(i) - Double(bahnen - 1) / 2) * 2 * radius }

    /// Mittellinie als Folge von Abschnitten, von oben links über die untere Brücke nach oben rechts.
    public static var abschnitte: [Abschnitt] {
        let r = radius, wa = aussen - r, gi = innen + r
        return [
            .bahn(von: P(-freiesEnde, y(0)), nach: P(-wa, y(0))),
            .wendung(mitte: P(-wa, y(0) + r), bauchRechts: false, abwaerts: true),
            .bahn(von: P(-wa, y(1)), nach: P(-gi, y(1))),
            .wendung(mitte: P(-gi, y(1) + r), bauchRechts: true, abwaerts: true),
            .bahn(von: P(-gi, y(2)), nach: P(-wa, y(2))),
            .wendung(mitte: P(-wa, y(2) + r), bauchRechts: false, abwaerts: true),
            .bahn(von: P(-wa, y(3)), nach: P(wa, y(3))),
            .wendung(mitte: P(wa, y(2) + r), bauchRechts: true, abwaerts: false),
            .bahn(von: P(wa, y(2)), nach: P(gi, y(2))),
            .wendung(mitte: P(gi, y(1) + r), bauchRechts: false, abwaerts: false),
            .bahn(von: P(gi, y(1)), nach: P(wa, y(1))),
            .wendung(mitte: P(wa, y(0) + r), bauchRechts: true, abwaerts: false),
            .bahn(von: P(wa, y(0)), nach: P(freiesEnde, y(0))),
        ]
    }

    /// Mitte eines Abschnitts (Bahn: Mitte der Strecke; Wendung: Scheitel des Bogens), in Einheiten.
    public static func scheitel(_ a: Abschnitt) -> P {
        switch a {
        case let .bahn(von, nach): return P((von.x + nach.x) / 2, (von.y + nach.y) / 2)
        case let .wendung(mitte, bauchRechts, _): return P(mitte.x + (bauchRechts ? radius : -radius), mitte.y)
        }
    }

    /// Umriss samt Strichstärke (Einheiten): halbe Breite und halbe Höhe um die Mitte.
    static var halbeAusdehnung: (breit: Double, hoch: Double) {
        (aussen + kantenbreite / 2, abs(y(0)) + kantenbreite / 2)
    }

    /// Maßstab (Punkte je Einheit) für ein quadratisches Bild der Seitenlänge `groesse`: die längere Seite füllt `fuellAnteil`.
    public static func massstab(groesse: Double) -> Double {
        let a = halbeAusdehnung
        return groesse * fuellAnteil / (2 * max(a.breit, a.hoch))
    }

    /// Punkt in Einheiten → Bildpunkt, y nach OBEN (CoreGraphics/AppKit, nicht gespiegelt), Symbol mittig.
    public static func bildpunkt(_ p: P, groesse: Double) -> CGPoint {
        let s = massstab(groesse: groesse)
        return CGPoint(x: groesse / 2 + p.x * s, y: groesse / 2 - p.y * s)
    }

    /// Zeichnet das Symbol in Schwarz (nur die Deckkraft zählt für ein Template-Bild) in den Bereich `groesse` × `groesse`
    /// ab Ursprung (0, 0) des Kontexts; y nach oben.
    public static func zeichne(in ctx: CGContext, groesse: Double) {
        let s = massstab(groesse: groesse)
        ctx.saveGState()
        ctx.setStrokeColor(CGColor(gray: 0, alpha: 1))
        ctx.setLineWidth(kantenbreite * s)
        ctx.setLineCap(.round)
        ctx.setLineJoin(.round)
        ctx.beginPath()
        for (i, a) in abschnitte.enumerated() {
            switch a {
            case let .bahn(von, nach):
                if i == 0 { ctx.move(to: bildpunkt(von, groesse: groesse)) }
                ctx.addLine(to: bildpunkt(nach, groesse: groesse))
            case let .wendung(mitte, bauchRechts, abwaerts):
                // Bildkoordinaten sind y nach oben: oben = 90°, unten = 270° (−90°), rechts = 0°, links = 180°.
                let m = bildpunkt(mitte, groesse: groesse)
                let von = abwaerts ? Double.pi / 2 : -Double.pi / 2
                let bis = -von
                // Bauch rechts: oben (90°) → rechts (0°) → unten (−90°) fällt, also im Uhrzeigersinn; bauch links steigt.
                let imUhrzeiger = bauchRechts == abwaerts
                ctx.addArc(center: m, radius: radius * s, startAngle: CGFloat(von), endAngle: CGFloat(bis), clockwise: imUhrzeiger)
            }
        }
        ctx.strokePath()
        ctx.restoreGState()
    }
}
