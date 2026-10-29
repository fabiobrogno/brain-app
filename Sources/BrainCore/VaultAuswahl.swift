import Foundation

public enum VaultPruefung: Equatable, Sendable { case ok, fehlt, keinBrain }

/// Ist ein Ordner ein Brain? (App-Spec §9.1, „Vorhandenes Brain verbinden“) — rein lesend. Ein Vault ist ein Ordner mit
/// `brain.config.json` (wie `pruefeVault` im Kern): Vorhanden-Sein von Daten genügt, ein altes `.tools/` im Vault zählt nicht und
/// wird nicht gebraucht.
public enum VaultAuswahl {
    public static let marke = "brain.config.json"

    public static func pruefe(_ ordner: URL) -> VaultPruefung {
        var istOrdner: ObjCBool = false
        guard FileManager.default.fileExists(atPath: ordner.path, isDirectory: &istOrdner), istOrdner.boolValue else { return .fehlt }
        var istDatei: ObjCBool = false
        let konfig = ordner.appendingPathComponent(marke).path
        return FileManager.default.fileExists(atPath: konfig, isDirectory: &istDatei) && !istDatei.boolValue ? .ok : .keinBrain
    }

    public static func vorschlag(home: URL = FileManager.default.homeDirectoryForCurrentUser) -> URL? {
        // isDirectory: false — sonst hängt URL bei existierenden Ordnern einen „/“ an und Vergleiche scheitern.
        [home.appendingPathComponent("brain", isDirectory: false), home.appendingPathComponent("Documents/Brain", isDirectory: false)]
            .first { pruefe($0) == .ok }
    }

    public static func meldung(_ p: VaultPruefung) -> String? {
        switch p {
        case .ok: return nil
        case .fehlt: return "Brain-Ordner nicht gefunden"
        case .keinBrain: return "Dieser Ordner ist kein Brain — darin fehlt brain.config.json"
        }
    }
}
