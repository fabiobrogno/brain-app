import Foundation

public enum NavigationsEntscheidung: Equatable, Sendable {
    case erlauben
    case extern(URL)
    case abbrechen
}

/// Das Fenster zeigt nur die eigene Oberfläche (brain://app). Fremde https-Links öffnen — nur auf Klick, nur im
/// Hauptrahmen — im Standardbrowser; alles andere (auch http und mailto) wird abgebrochen (Review-Fokus 3).
public enum NavigationsRegel {
    public static let schema = "brain"
    public static let host = "app"
    public static let startURL = URL(string: "brain://app/index.html")!

    public static func entscheide(_ url: URL?, hauptrahmen: Bool, vomNutzer: Bool) -> NavigationsEntscheidung {
        guard let url, let s = url.scheme?.lowercased() else { return .abbrechen }
        if s == schema { return url.host == host ? .erlauben : .abbrechen }
        if s == "https" { return hauptrahmen && vomNutzer ? .extern(url) : .abbrechen }
        return .abbrechen
    }
}
