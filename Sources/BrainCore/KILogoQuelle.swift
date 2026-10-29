import Foundation

/// Welche Logo-Datei zu welcher KI-App gehört (Ordner `Ressourcen/logos`, im App-Paket `Contents/Resources/logos`).
/// UI-unabhängig, damit Tests die Zuordnung ohne SwiftUI prüfen. Die Herkunft der Dateien steht in `Ressourcen/logos/HERKUNFT.md`.
/// Für Codex liegt bewusst keine Datei dabei: es gibt kein sauber lizenziertes Vektor-Logo (siehe HERKUNFT.md), dort zeigt die App die Initiale.
public extension KiZiel {
    /// Dateiname im Logo-Ordner, `nil` = kein Logo vorhanden (Darstellung als Initiale).
    var logoDatei: String? {
        switch self {
        case .claude: return "claude.svg"
        case .cursor: return "cursor.svg"
        case .codex: return nil
        }
    }

    /// Markenfarbe als Hex ohne „#“; `nil` = einfarbig in der Textfarbe der Umgebung (hell/dunkel).
    var logoFarbeHex: String? {
        switch self {
        case .claude: return "D97757"
        case .cursor, .codex: return nil
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
}
