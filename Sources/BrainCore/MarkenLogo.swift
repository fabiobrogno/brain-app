import Foundation

/// Marken-Logos für Dienste, mit denen Kortex sich verbindet (derzeit GitHub). Gleiche Mechanik wie `KILogoQuelle` für die KI-Apps,
/// aber unabhängig davon: UI-unabhängig, damit Tests die Zuordnung ohne SwiftUI prüfen. Die Dateien liegen in `Ressourcen/logos`
/// (im App-Paket `Contents/Resources/logos`); ihre Herkunft, Lizenz (CC0, Simple Icons) und der Markenhinweis stehen in
/// `Ressourcen/logos/HERKUNFT.md`. Das Studio benutzt dieselben Pfaddaten (`Ressourcen/studio/marken.js`).
public enum MarkenLogo: String, CaseIterable, Sendable {
    case github

    /// Name der Marke (Beschriftung für Bedienungshilfen und Tooltip).
    public var name: String {
        switch self {
        case .github: return "GitHub"
        }
    }

    /// Dateiname im Logo-Ordner.
    public var logoDatei: String {
        switch self {
        case .github: return "github.svg"
        }
    }

    /// Markenfarbe als Hex ohne „#“; `nil` = einfarbig in der Textfarbe der Umgebung (hell/dunkel).
    public var logoFarbeHex: String? {
        switch self {
        case .github: return nil
        }
    }

    /// Rückfall, wenn kein Logo geladen werden kann.
    public var initiale: String { String(name.prefix(1)).uppercased() }

    /// Ort der Logo-Datei unterhalb von `ressourcen` (`Contents/Resources` der App bzw. `Ressourcen/` im Repo), falls sie existiert.
    public func url(ressourcen: URL? = Bundle.main.resourceURL) -> URL? {
        guard let ressourcen else { return nil }
        let u = ressourcen.appendingPathComponent("logos", isDirectory: true).appendingPathComponent(logoDatei)
        return FileManager.default.isReadableFile(atPath: u.path) ? u : nil
    }
}
