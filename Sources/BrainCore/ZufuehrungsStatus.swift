import Foundation

/// Statusdatei des Zuführungs-Wächters (Kit, `.logs/zufuehrungen.json`): welche Quellen still stehen.
public struct ZufuehrungsStatus: Decodable, Equatable, Sendable {
    public struct Eintrag: Decodable, Equatable, Sendable {
        public let name: String
        public let status: String
        public let alterTage: Int?

        public init(name: String, status: String, alterTage: Int? = nil) {
            self.name = name
            self.status = status
            self.alterTage = alterTage
        }

        public var istProblem: Bool { status != "ok" }

        /// Kurzer Grund in Alltagssprache: welche Quelle, was fehlt.
        public var grund: String {
            switch status {
            case "fehlt": return "\(name): Ordner oder Datei fehlt"
            case "nicht-lesbar": return "\(name): keine Leserechte"
            case "still":
                guard let t = alterTage else { return "\(name): lange nichts Neues" }
                return "\(name): seit \(t) \(t == 1 ? "Tag" : "Tagen") nichts Neues"
            case "config": return "\(name): Eintrag in der Einstellung unvollständig"
            default: return "\(name): \(status)"
            }
        }
    }

    public let zufuehrungen: [Eintrag]

    public init(zufuehrungen: [Eintrag]) { self.zufuehrungen = zufuehrungen }

    /// Einträge mit Problem; `probleme` aus der Datei wird bewusst nicht benutzt — die Einträge sind die Wahrheit.
    public var probleme: [Eintrag] { zufuehrungen.filter(\.istProblem) }

    public static func pfad(vault: URL) -> URL {
        vault.appendingPathComponent(".logs", isDirectory: true).appendingPathComponent("zufuehrungen.json")
    }

    /// Fehlende, leere oder kaputte Datei → `nil` (kein ⚠, kein Absturz).
    public static func lade(vault: URL) -> ZufuehrungsStatus? {
        guard let daten = try? Data(contentsOf: pfad(vault: vault)) else { return nil }
        return try? JSONDecoder().decode(ZufuehrungsStatus.self, from: daten)
    }
}
