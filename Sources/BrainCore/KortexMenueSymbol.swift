import Foundation
import CoreGraphics

/// Das Netz-K der App als Menüleisten-Symbol (einfarbig, ohne Fläche; das System färbt das Template-Bild hell/dunkel).
/// Gewählt ist Entwurf 2 „Netz“ (`Ressourcen/icon-entwuerfe/kortex-2-netz.svg`, 30.10.2026): fünf Knoten, ein großer Kern mit
/// Stamm nach oben/unten und zwei Armen. Für 18 pt sind die Kanten dicker und die Knoten kleiner als im App-Icon, damit zwischen den
/// Knoten noch Linie zu sehen ist (die Dreiknoten-Fassung wirkt wie ein Teilen-Symbol, nicht wie ein K).
///
/// Nur Geometrie und Zeichnung (CoreGraphics, UI-unabhängig), damit Tests sie ohne SwiftUI prüfen; `KortexMenueBild` in der App
/// macht daraus das `NSImage`. Die Maße stammen aus den Knotenabständen des Entwurfs (Stamm 216 über/unter dem Kern, Arme 294 daneben).
public enum KortexMenueSymbol {
    /// Knoten relativ zum Kern, y nach unten (wie im SVG), samt Radius.
    public struct Knoten: Equatable, Sendable {
        public let x: Double
        public let y: Double
        public let radius: Double
    }

    /// 0 Stamm oben, 1 Stamm unten, 2 Arm oben, 3 Arm unten, 4 Kern.
    public static let knoten: [Knoten] = [
        Knoten(x: 0, y: -216, radius: 70),
        Knoten(x: 0, y: 216, radius: 70),
        Knoten(x: 294, y: -216, radius: 74),
        Knoten(x: 294, y: 216, radius: 74),
        Knoten(x: 0, y: 0, radius: 104),
    ]

    /// Kanten als Knotenpaare: Stamm (oben–unten, durch den Kern) und die beiden Arme vom Kern aus.
    public static let kanten: [(von: Int, nach: Int)] = [(0, 1), (4, 2), (4, 3)]

    /// Kantenbreite in denselben Einheiten wie die Knotenabstände.
    public static let kantenbreite: Double = 64

    /// Anteil der Bildhöhe, den das Symbol füllt (der Rest ist Luft oben und unten).
    public static let hoehenAnteil: Double = 0.88

    /// Umriss aller Knoten (Einheiten des Entwurfs).
    static var umriss: (minX: Double, maxX: Double, minY: Double, maxY: Double) {
        (knoten.map { $0.x - $0.radius }.min()!, knoten.map { $0.x + $0.radius }.max()!,
         knoten.map { $0.y - $0.radius }.min()!, knoten.map { $0.y + $0.radius }.max()!)
    }

    /// Maßstab (Punkte je Einheit) für ein quadratisches Bild der Seitenlänge `groesse`.
    public static func massstab(groesse: Double) -> Double {
        let u = umriss
        return groesse * hoehenAnteil / (u.maxY - u.minY)
    }

    /// Mittelpunkt eines Knotens im Bild, y nach OBEN (CoreGraphics/AppKit, nicht gespiegelt), Symbol mittig.
    public static func mittelpunkt(_ i: Int, groesse: Double) -> CGPoint {
        let u = umriss, s = massstab(groesse: groesse), k = knoten[i]
        return CGPoint(x: groesse / 2 + (k.x - (u.minX + u.maxX) / 2) * s,
                       y: groesse / 2 - (k.y - (u.minY + u.maxY) / 2) * s)
    }

    /// Zeichnet das Symbol in Schwarz (nur die Deckkraft zählt für ein Template-Bild) in den Bereich `groesse` × `groesse`
    /// ab Ursprung (0, 0) des Kontexts; y nach oben.
    public static func zeichne(in ctx: CGContext, groesse: Double) {
        let s = massstab(groesse: groesse)
        ctx.saveGState()
        ctx.setFillColor(CGColor(gray: 0, alpha: 1))
        ctx.setStrokeColor(CGColor(gray: 0, alpha: 1))
        ctx.setLineWidth(kantenbreite * s)
        ctx.setLineCap(.round)
        for kante in kanten {
            ctx.move(to: mittelpunkt(kante.von, groesse: groesse))
            ctx.addLine(to: mittelpunkt(kante.nach, groesse: groesse))
            ctx.strokePath()
        }
        for i in knoten.indices {
            let m = mittelpunkt(i, groesse: groesse), r = knoten[i].radius * s
            ctx.fillEllipse(in: CGRect(x: m.x - r, y: m.y - r, width: 2 * r, height: 2 * r))
        }
        ctx.restoreGState()
    }
}
