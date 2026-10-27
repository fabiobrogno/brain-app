import Foundation

public enum NavigationsEntscheidung: Equatable, Sendable {
    case erlauben
    case extern(URL)
    case abbrechen
}

/// Die zwei Oberflächen der App: Host im brain://-Schema bestimmt, welche Brücke antwortet.
public enum Oberflaeche: String, Sendable, CaseIterable {
    /// Studio (Editor) → Werkstatt-Brücke.
    case studio
    /// Übersicht (3D/Karten des Kits) → Kit-Brücke.
    case app

    public var host: String { rawValue }
    public var startURL: URL { URL(string: "brain://\(host)/index.html")! }

    public static func fuer(host: String?) -> Oberflaeche? { allCases.first { $0.host == host } }
}

/// Jedes Fenster zeigt nur die eigene Oberfläche (brain://studio bzw. brain://app). Fremde https-Links öffnen — nur
/// auf Klick, nur im Hauptrahmen — im Standardbrowser; alles andere (auch http und mailto) wird abgebrochen
/// (Review-Fokus 3).
public enum NavigationsRegel {
    public static let schema = "brain"
    public static let host = Oberflaeche.app.host
    public static let startURL = Oberflaeche.app.startURL

    public static func entscheide(_ url: URL?, hauptrahmen: Bool, vomNutzer: Bool, oberflaeche: Oberflaeche = .app) -> NavigationsEntscheidung {
        guard let url, let s = url.scheme?.lowercased() else { return .abbrechen }
        if s == schema { return url.host == oberflaeche.host ? .erlauben : .abbrechen }
        if s == "https" { return hauptrahmen && vomNutzer ? .extern(url) : .abbrechen }
        return .abbrechen
    }
}
