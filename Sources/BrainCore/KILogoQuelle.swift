import Foundation

/// Welche Logo-Datei zu welcher KI-App gehört (Ordner `Ressourcen/logos`, im App-Paket `Contents/Resources/logos`).
/// UI-unabhängig, damit Tests die Zuordnung ohne SwiftUI prüfen. Die Herkunft der Dateien, die Begründung der Farben und der
/// Ansichten steht in `Ressourcen/logos/HERKUNFT.md`.
/// Für Codex liegt bewusst keine Datei dabei: es gibt kein sauber lizenziertes Vektor-Logo (siehe HERKUNFT.md), dort zeigt die App die Initiale.
public extension KiZiel {
    /// Dateiname im Logo-Ordner, `nil` = kein Logo vorhanden (Darstellung als Initiale). Claude Desktop zeigt das Zeichen von Claude.
    var logoDatei: String? {
        switch self {
        case .claude, .claudeDesktop: return "claude.svg"
        case .cursor: return "cursor.svg"
        case .gemini: return "gemini.svg"
        case .copilot: return "copilot.svg"
        case .zed: return "zed.svg"
        case .opencode: return "opencode.svg"
        case .warp: return "warp.svg"
        case .codex: return nil
        }
    }

    /// Markenfarbe als Hex ohne „#“; `nil` = einfarbig in der Textfarbe der Umgebung (hell/dunkel).
    /// Markenfarbe nur, wenn sie auf Hell UND Dunkel mindestens 3:1 Kontrast hat (Claude, Gemini); sonst die Textfarbe (HERKUNFT.md).
    var logoFarbeHex: String? {
        switch self {
        case .claude, .claudeDesktop: return "D97757"
        case .gemini: return "8E75B2"
        case .cursor, .codex, .copilot, .zed, .opencode, .warp: return nil
        }
    }

    /// Ansicht (`viewBox`: x y Breite Höhe) für ein einheitliches Bild im Quadrat: um die Glyphe zentriert, die Füllung nach der
    /// Tintendichte abgestuft (dichte Formen kleiner, luftige größer). Die Form wird nie verzerrt; die Zahlen sind dieselben wie
    /// in `Ressourcen/studio/ki-logos.js` (ein Test vergleicht beide). `nil` = Datei unverändert (kein Logo).
    var logoAnsicht: String? {
        switch self {
        case .claude, .claudeDesktop: return "-2.61 -2.61 29.21 29.21"
        case .cursor: return "-3.28 -3.28 30.55 30.55"
        case .gemini: return "-0.52 -0.52 25.03 25.03"
        case .copilot: return "-1.83 -1.83 27.66 27.66"
        case .zed: return "-3.01 -3.01 30.03 30.03"
        case .opencode: return "-4.08 -4.08 32.16 32.16"
        case .warp: return "-4.35 -4.35 32.7 32.7"
        case .codex: return nil
        }
    }

    /// Rückfall, wenn kein Logo geladen werden kann.
    var initiale: String { String(name.prefix(1)).uppercased() }
}

public enum KILogoQuelle {
    /// Ort der Logo-Datei unterhalb von `ressourcen` (`Contents/Resources` der App bzw. `Ressourcen/` im Repo), falls sie existiert.
    public static func url(_ ki: KiZiel, ressourcen: URL? = Bundle.main.resourceURL) -> URL? {
        guard let datei = ki.logoDatei, let ressourcen else { return nil }
        let u = ressourcen.appendingPathComponent("logos", isDirectory: true).appendingPathComponent(datei)
        return FileManager.default.isReadableFile(atPath: u.path) ? u : nil
    }

    /// Die SVG-Daten für die Darstellung: die Datei, bei der NUR das Attribut `viewBox` der Wurzel durch `logoAnsicht` ersetzt ist
    /// (Pfad und alles andere bleiben Zeichen für Zeichen unverändert). `nil`, wenn es kein Logo gibt oder die Datei unerwartet aussieht.
    public static func daten(_ ki: KiZiel, ressourcen: URL? = Bundle.main.resourceURL) -> Data? {
        guard let u = url(ki, ressourcen: ressourcen), let ansicht = ki.logoAnsicht,
              let text = try? String(contentsOf: u, encoding: .utf8) else { return nil }
        let alt = "viewBox=\"0 0 24 24\""
        guard text.components(separatedBy: alt).count == 2, !text.lowercased().contains("<script") else { return nil }
        return text.replacingOccurrences(of: alt, with: "viewBox=\"\(ansicht)\"").data(using: .utf8)
    }
}
