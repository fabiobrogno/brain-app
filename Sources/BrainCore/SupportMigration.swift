import Foundation
import Darwin

/// Einmaliger Umzug des Support-Ordners von `…/Application Support/Brain` nach `…/Application Support/Kortex`.
/// Sicherheitsregeln: nur umbenennen (ein einziger `rename`, kein Kopieren/Löschen), nie etwas überschreiben, jeder
/// Fehlschlag wird zurückgegeben (nie still) — die App zeigt ihn an und protokolliert ihn.
public enum SupportMigration {
    public enum Ergebnis: Equatable, Sendable {
        /// Es gibt keinen alten Ordner (frische Installation oder schon migriert) — nichts zu tun.
        case nichtNoetig
        /// `Brain` wurde atomar in `Kortex` umbenannt.
        case umbenannt
        /// `Brain` und `Kortex` existieren beide: nichts wurde angefasst. Die App nutzt `Kortex`, der Nutzer entscheidet.
        case beideVorhanden
        /// Das Umbenennen ist gescheitert (Fehlertext des Systems); `Brain` ist unverändert.
        case fehlgeschlagen(String)

        /// Hinweis für den Nutzer; nil, wenn nichts zu sagen ist.
        public func hinweis(alt: URL, neu: URL) -> String? {
            switch self {
            case .nichtNoetig, .umbenannt: return nil
            case .beideVorhanden:
                return "Es gibt zwei Ordner: „\(alt.path)“ (alt) und „\(neu.path)“ (neu). Kortex nutzt nur den neuen und hat den alten nicht angefasst. "
                    + "Falls im alten noch Einstellungen oder Vault-Listen liegen, die du brauchst, kopiere sie von Hand in den neuen."
            case .fehlgeschlagen(let grund):
                return "Der Ordner „\(alt.path)“ konnte nicht nach „\(neu.path)“ umbenannt werden: \(grund). "
                    + "Er ist unverändert; Kortex startet mit einem neuen, leeren Ordner."
            }
        }

        public var protokollZeile: String {
            switch self {
            case .nichtNoetig: return "support-migration nicht-noetig"
            case .umbenannt: return "support-migration umbenannt"
            case .beideVorhanden: return "support-migration beide-vorhanden (nichts verändert)"
            case .fehlgeschlagen(let g): return "support-migration FEHLER \(g)"
            }
        }
    }

    /// Migriert `alt` → `neu`. Vorhandensein wird mit `lstat` geprüft (ein Symlink als `Brain` zählt als vorhanden, auch
    /// wenn er ins Leere zeigt). Das Umbenennen läuft mit `RENAME_EXCL`: Taucht `neu` zwischen Prüfung und Umbenennen auf,
    /// scheitert es, statt einen (leeren) Ordner zu ersetzen.
    public static func migriere(alt: URL, neu: URL) -> Ergebnis {
        guard existiert(alt) else { return .nichtNoetig }
        guard !existiert(neu) else { return .beideVorhanden }
        if renamex_np(alt.path, neu.path, UInt32(RENAME_EXCL)) == 0 { return .umbenannt }
        let fehler = errno
        if fehler == EEXIST { return .beideVorhanden }
        return .fehlgeschlagen(String(cString: strerror(fehler)))
    }

    private static func existiert(_ url: URL) -> Bool {
        var st = stat()
        return lstat(url.path, &st) == 0
    }
}
