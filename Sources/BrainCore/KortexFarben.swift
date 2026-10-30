import Foundation

/// Die eine Akzentfarbe von Kortex (Tinte-Violett) — Hex-Werte ohne `#`, gleich für App (SwiftUI) und Studio (CSS `--akzent`).
/// Quelle der Wahrheit für die Oberfläche ist `Ressourcen/studio/studio.css`; ein Test hält beide Seiten gleich.
/// Hell und dunkel sind einzeln auf Kontrast abgestimmt: Beschriftung auf einem Akzent-Knopf erreicht WCAG AA (≥ 4,5 : 1).
public enum KortexFarben {
    /// Akzent als Fläche oder Schrift: im hellen Erscheinungsbild dunkel genug für Text auf Weiß, im dunklen hell genug für Text auf Grau.
    public static let akzentHell = "5B4ED6"
    public static let akzentDunkel = "A89FFF"
    /// Beschriftung auf einer Akzent-Fläche (Knopf).
    public static let akzentTextHell = "FFFFFF"
    public static let akzentTextDunkel = "14112E"

    /// Kontrastverhältnis zweier Farben nach WCAG 2.x (1 … 21). Ungültige Hex-Werte ergeben 0.
    public static func kontrast(_ a: String, _ b: String) -> Double {
        guard let la = leuchtdichte(a), let lb = leuchtdichte(b) else { return 0 }
        let (hell, dunkel) = (max(la, lb), min(la, lb))
        return (hell + 0.05) / (dunkel + 0.05)
    }

    /// Rot-, Grün-, Blauanteil 0 … 1 aus „RRGGBB“.
    public static func komponenten(_ hex: String) -> (r: Double, g: Double, b: Double)? {
        guard hex.count == 6, let w = UInt32(hex, radix: 16) else { return nil }
        return (Double((w >> 16) & 0xFF) / 255, Double((w >> 8) & 0xFF) / 255, Double(w & 0xFF) / 255)
    }

    private static func leuchtdichte(_ hex: String) -> Double? {
        guard let c = komponenten(hex) else { return nil }
        func lin(_ x: Double) -> Double { x <= 0.03928 ? x / 12.92 : pow((x + 0.055) / 1.055, 2.4) }
        return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
    }
}
