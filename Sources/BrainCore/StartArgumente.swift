import Foundation

/// Start-Argumente für Entwicklung, Rauchtest und Speichermessung (Task 15/16). Unbekanntes wird ignoriert.
public struct StartArgumente: Equatable, Sendable {
    public var vault: URL?
    public var fensterOeffnen = false
    public var schliessenNach: Duration?
    public var beendenNach: Duration?

    public init() {}

    public static func lies(_ argumente: [String]) -> StartArgumente {
        var a = StartArgumente()
        var i = 1
        func wert() -> String? { i + 1 < argumente.count ? argumente[i + 1] : nil }
        func sekunden() -> Duration? { wert().flatMap(Int.init).map { .seconds($0) } }
        while i < argumente.count {
            switch argumente[i] {
            case "--vault":
                if let v = wert(), v.hasPrefix("/") { a.vault = URL(fileURLWithPath: v); i += 1 }
            case "--test-fenster":
                a.fensterOeffnen = true
            case "--test-fenster-schliessen-nach":
                if let s = sekunden() { a.schliessenNach = s; i += 1 }
            case "--test-beenden-nach":
                if let s = sekunden() { a.beendenNach = s; i += 1 }
            default:
                break
            }
            i += 1
        }
        return a
    }
}
