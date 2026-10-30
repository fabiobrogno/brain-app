import Foundation

/// Der Beispiel-Vault aus „Erst mal ausprobieren“: Kortex legt ihn selbst aus der Vorlage an (lokal, ohne Netz). Er heißt eindeutig
/// „Kortex-Beispiel“ und liegt neben dem eigenen Vault, nie darin.
public enum BeispielVault {
    public static let name = "Kortex-Beispiel"

    /// Der erste freie Ordner `<home>/Kortex-Beispiel`, sonst `Kortex-Beispiel 2`, `… 3` (nichts Vorhandenes wird angefasst).
    public static func ordner(home: URL, vorhanden: (String) -> Bool = { FileManager.default.fileExists(atPath: $0) }) -> URL {
        let basis = home.appendingPathComponent(name, isDirectory: true)
        for n in 1..<1000 {
            let p = n == 1 ? basis : home.appendingPathComponent("\(name) \(n)", isDirectory: true)
            if !vorhanden(p.path) { return p }
        }
        return basis
    }
}
