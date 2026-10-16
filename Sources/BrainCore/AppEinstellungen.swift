import Foundation

/// Was die App sich merkt (App-Spec §9.1) — in M1 nur der verbundene Brain-Ordner.
public struct AppEinstellungen: Codable, Equatable, Sendable {
    public var vault: String?

    public init(vault: String? = nil) { self.vault = vault }

    /// Fehlt die Datei oder ist sie kaputt → leere Einstellungen (die App zeigt dann die Einrichtung).
    public static func lade(_ pfade: AppPfade) -> AppEinstellungen {
        guard let daten = try? Data(contentsOf: pfade.konfiguration),
              let e = try? JSONDecoder().decode(AppEinstellungen.self, from: daten) else { return AppEinstellungen() }
        return e
    }

    public func speichere(_ pfade: AppPfade) throws {
        try pfade.legeAn()
        let kodierer = JSONEncoder()
        kodierer.outputFormatting = [.prettyPrinted, .sortedKeys]
        try kodierer.encode(self).write(to: pfade.konfiguration, options: .atomic)
    }
}
