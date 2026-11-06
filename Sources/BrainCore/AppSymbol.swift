import AppKit
import Foundation

/// Das wählbare Dock-Symbol (Einstellungen → Darstellung → „App-Symbol“). Gespeichert wird die Wahl in `<Support>/einstellungen.json`
/// (Schlüssel `appSymbol`, gemeinsam mit dem Studio: `gemeinsam/app-einstellungen.mjs`). `standard` heißt: die App setzt kein eigenes Bild, das Dock
/// zeigt `AppIcon.icns` aus dem Paket. Die anderen vier liegen als `.icns` unter `Contents/Resources/AppSymbole/` (erzeugt von
/// `scripts/erzeuge-app-symbole.mjs`) und gelten nur zur Laufzeit über `NSApp.applicationIconImage` — die App schreibt nie in ihr eigenes Paket
/// (sonst bräche die Signatur und damit Sparkle).
public enum AppSymbol: String, CaseIterable, Equatable, Sendable {
    case standard, dunkel, graphit, papier, smaragd

    public static let schluessel = "appSymbol"
    public static let ordnerName = "AppSymbole"

    /// Name der Datei im Ordner `AppSymbole`; `standard` hat keine.
    public var dateiName: String? { self == .standard ? nil : "\(rawValue).icns" }

    /// Wert aus der Einstellung oder der Brücke; unbekannt → nil (der Aufrufer behält dann das, was gilt).
    public init?(wert: Any?) {
        guard let s = wert as? String, let v = AppSymbol(rawValue: s) else { return nil }
        self = v
    }

    /// Liest `<support>/einstellungen.json`. Nie ein Fehler: Datei fehlt/kaputt, Schlüssel fehlt oder hat einen unbekannten Wert → `standard`.
    public static func lies(supportOrdner: URL) -> AppSymbol {
        let datei = supportOrdner.appendingPathComponent("einstellungen.json")
        guard let daten = try? Data(contentsOf: datei), daten.count <= 1_000_000,
              let json = try? JSONSerialization.jsonObject(with: daten) as? [String: Any] else { return .standard }
        return AppSymbol(wert: json[schluessel]) ?? .standard
    }

    /// Das Bild für `NSApp.applicationIconImage`: `nil` für `standard` (zurück auf das Symbol des Pakets) und wenn die Datei fehlt oder nicht lesbar ist.
    public func bild(ressourcen: URL?) -> NSImage? {
        guard let name = dateiName, let ressourcen else { return nil }
        let datei = ressourcen.appendingPathComponent(Self.ordnerName, isDirectory: true).appendingPathComponent(name)
        guard let b = NSImage(contentsOf: datei), b.isValid, !b.representations.isEmpty else { return nil }
        return b
    }
}
