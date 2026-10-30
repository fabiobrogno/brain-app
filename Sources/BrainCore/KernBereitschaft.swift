import Foundation

/// Darf die App den gebündelten Kern benutzen? Alle Kern-Aufrufe (Status, Rückfragen, Ansicht-Brücke) laufen über den stabilen Pfad
/// `bin/kern` (Symlink auf `kern/<appVersion>/`, vom Start per Manifest geprüft, `Laufzeit.installiereKern`). Ist er nicht bereit,
/// meldet die App das klar; sie weicht NIE auf Code im Vault (`<vault>/.tools`) aus.
public enum KernBereitschaft: Equatable, Sendable {
    case bereit
    /// `meldung` ist ein vollständiger, für Nutzer lesbarer Satz.
    case nichtBereit(meldung: String)

    public var istBereit: Bool { self == .bereit }
    public var meldung: String? {
        if case .nichtBereit(let m) = self { return m }
        return nil
    }

    /// `kern` ist der Pfad, den die App benutzt (`AppPfade.kern`). Selbst bei `.bereit` muss `<kern>/brain.mjs` wirklich da sein
    /// (ein gelöschter oder kaputter Link wäre sonst erst beim Aufruf aufgefallen).
    public static func pruefe(_ status: Laufzeit.KernStatus, kern: URL) -> KernBereitschaft {
        switch status {
        case .nichtEnthalten:
            return .nichtBereit(meldung: "Der Kern von Kortex fehlt im App-Paket — bitte Kortex neu installieren.")
        case .fehler(let f):
            return .nichtBereit(meldung: "\(f.beschreibung) Bitte Kortex neu starten oder neu installieren.")
        case .bereit:
            let skript = kern.appendingPathComponent("brain.mjs").path
            guard FileManager.default.fileExists(atPath: skript) else {
                return .nichtBereit(meldung: "Der Kern ist nicht erreichbar (\(kern.path)/brain.mjs fehlt) — bitte Kortex neu starten.")
            }
            return .bereit
        }
    }
}
