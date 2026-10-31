import SwiftUI
import AppKit

/// Die Kortex-Farben als SwiftUI-Farben, die dem Erscheinungsbild (hell/dunkel) von selbst folgen. Die Werte stehen in `KortexFarben`
/// (dort auch der Kontrast-Test); die App benutzt sie als `Kortex.akzent` (`Sources/BrainApp/Kortex.swift`).
/// Eine dynamische `NSColor` leistet im Code dasselbe wie ein Asset-Katalog (das Paket entsteht mit SwiftPM, ohne `actool`).
public enum KortexFarbe {
    /// Akzent als Fläche, Linie oder Schrift. Hell `#5B4ED6`, dunkel `#A89FFF`.
    public static let akzent = Color(nsColor: nsFarbe(hell: KortexFarben.akzentHell, dunkel: KortexFarben.akzentDunkel))
    /// Beschriftung auf einer Akzent-Fläche (Kontrast ≥ 4,5 : 1 in beiden Erscheinungsbildern).
    public static let akzentText = Color(nsColor: nsFarbe(hell: KortexFarben.akzentTextHell, dunkel: KortexFarben.akzentTextDunkel))

    public static func nsFarbe(hell: String, dunkel: String) -> NSColor {
        NSColor(name: nil) { erscheinung in
            let istDunkel = erscheinung.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            return farbe(istDunkel ? dunkel : hell)
        }
    }

    private static func farbe(_ hex: String) -> NSColor {
        let c = KortexFarben.komponenten(hex) ?? (0, 0, 0)
        return NSColor(srgbRed: c.r, green: c.g, blue: c.b, alpha: 1)
    }
}
