import Foundation

/// Einstellung „Seitenleiste durchscheinend“ (Einstellungen → Darstellung): `<Support>/einstellungen.json`, Schlüssel `seitenleisteDurchscheinend`
/// (gemeinsam mit dem Studio: `gemeinsam/app-einstellungen.mjs`). Standard: an.
public enum SeitenleisteGlas {
    public static let schluessel = "seitenleisteDurchscheinend"

    /// Nie ein Fehler: Datei fehlt/kaputt, Schlüssel fehlt oder ist kein Boolean → `true`.
    public static func lies(supportOrdner: URL) -> Bool {
        let datei = supportOrdner.appendingPathComponent("einstellungen.json")
        guard let daten = try? Data(contentsOf: datei), daten.count <= 1_000_000,
              let json = try? JSONSerialization.jsonObject(with: daten) as? [String: Any],
              let n = json[schluessel] as? NSNumber, CFGetTypeID(n) == CFBooleanGetTypeID() else { return true }
        return n.boolValue
    }
}
