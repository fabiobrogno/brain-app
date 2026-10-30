import Foundation
import Darwin

/// Einmaliger Umzug des Support-Ordners von `…/Application Support/Brain` nach `…/Application Support/Kortex`.
/// Sicherheitsregeln: nur umbenennen (ein einziger `rename`, kein Kopieren/Löschen von Inhalt), nie etwas überschreiben,
/// jeder Fehlschlag wird zurückgegeben (nie still) — die App zeigt ihn an und protokolliert ihn.
///
/// Nach dem Umbenennen bleibt ein relativer Rückwärts-Symlink `Brain → Kortex` zurück: Bereits eingetragene Pfade
/// (MCP-Einträge bei Claude Code, Codex, Cursor nennen `…/Brain/node/<ver>/bin/node`, Hooks nennen `…/Brain/bin/…`) laufen
/// so weiter, bis sie umgestellt sind. Ein Symlink statt Ordner: `symlink(2)` scheitert, wenn an der Stelle schon etwas liegt.
public enum SupportMigration {
    public enum Ergebnis: Equatable, Sendable {
        /// Es gibt keinen alten Ordner (frische Installation oder schon migriert) — nichts zu tun.
        case nichtNoetig
        /// `Brain` wurde atomar in `Kortex` umbenannt; `Brain` ist jetzt ein Symlink auf `Kortex`.
        case umbenannt
        /// Umbenannt, aber der Rückwärts-Symlink ließ sich nicht anlegen (Fehlertext des Systems): alte Pfade in
        /// Einstellungen anderer Programme laufen nicht weiter und müssen neu verbunden werden.
        case umbenanntOhneLink(String)
        /// `Brain` und `Kortex` existieren beide: nichts wurde angefasst. Die App nutzt `Kortex`, der Nutzer entscheidet.
        case beideVorhanden
        /// Das Umbenennen ist gescheitert (Fehlertext des Systems); `Brain` ist unverändert.
        case fehlgeschlagen(String)

        /// Hinweis für den Nutzer; nil, wenn nichts zu sagen ist.
        public func hinweis(alt: URL, neu: URL) -> String? {
            switch self {
            case .nichtNoetig, .umbenannt: return nil
            case .umbenanntOhneLink(let grund):
                return "Der Ordner „\(alt.path)“ wurde nach „\(neu.path)“ umbenannt. Ein Verweis vom alten Namen auf den neuen ließ sich nicht anlegen (\(grund)). "
                    + "Falls Claude Code, Codex oder Cursor Kortex nicht mehr finden, verbinde sie im Studio unter „KI verbinden“ neu."
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
            case .umbenanntOhneLink(let g): return "support-migration umbenannt, Rückwärts-Link FEHLER \(g)"
            case .beideVorhanden: return "support-migration beide-vorhanden (nichts verändert)"
            case .fehlgeschlagen(let g): return "support-migration FEHLER \(g)"
            }
        }
    }

    /// Migriert `alt` → `neu`.
    ///  - Vorhandensein wird mit `lstat` geprüft (ein Symlink als `Brain` zählt als vorhanden, auch wenn er ins Leere zeigt).
    ///  - Ist `alt` schon der Rückwärts-Symlink auf `neu` (früherer Umzug), ist nichts zu tun.
    ///  - Ein leerer `neu`-Ordner (Rest eines früheren Starts) steht dem Umzug nicht im Weg: `rmdir` entfernt nur Leeres.
    ///  - Umbenannt wird mit `RENAME_EXCL`: Taucht `neu` zwischen Prüfung und Umbenennen auf, scheitert es, statt etwas zu ersetzen.
    ///  - Verliert eine zweite App-Instanz das Rennen (`alt` ist inzwischen weg), ist das kein Fehler.
    public static func migriere(alt: URL, neu: URL) -> Ergebnis {
        migriere(alt: alt, neu: neu, umbenennen: { von, nach in
            renamex_np(von, nach, UInt32(RENAME_EXCL)) == 0 ? 0 : errno
        })
    }

    /// Wie oben; `umbenennen` liefert 0 oder den errno-Wert (nur für Tests austauschbar).
    static func migriere(alt: URL, neu: URL, umbenennen: (String, String) -> Int32) -> Ergebnis {
        guard existiert(alt) else { return .nichtNoetig }
        if zeigtAuf(alt, ziel: neu) { return .nichtNoetig }
        if existiert(neu) {
            // Nur ein echter, leerer Ordner weicht; alles andere (Inhalt, Symlink, Datei) bleibt und ist „beide vorhanden“.
            var st = stat()
            guard lstat(neu.path, &st) == 0, (st.st_mode & S_IFMT) == S_IFDIR, rmdir(neu.path) == 0 else { return .beideVorhanden }
        }
        let fehler = umbenennen(alt.path, neu.path)
        if fehler == 0 {
            // Relativer Rückwärts-Link (`Brain → Kortex`): bleibt gültig, wenn der Application-Support-Ordner selbst wandert.
            if symlink(neu.lastPathComponent, alt.path) != 0 { return .umbenanntOhneLink(String(cString: strerror(errno))) }
            return .umbenannt
        }
        if fehler == EEXIST { return .beideVorhanden }
        if fehler == ENOENT, !existiert(alt) { return .nichtNoetig } // eine andere Instanz war schneller
        return .fehlgeschlagen(String(cString: strerror(fehler)))
    }

    /// Hinweistext, der jetzt angezeigt werden soll. „Beide vorhanden“ erscheint nur einmal (Merker-Datei in `neu`), danach nur
    /// im Protokoll; alle anderen Hinweise (Fehler) erscheinen, solange sie zutreffen.
    public static func anzuzeigenderHinweis(_ ergebnis: Ergebnis, alt: URL, neu: URL, merker: URL) -> String? {
        guard let text = ergebnis.hinweis(alt: alt, neu: neu) else { return nil }
        guard ergebnis == .beideVorhanden else { return text }
        if existiert(merker) { return nil }
        try? FileManager.default.createDirectory(at: merker.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? Data("gezeigt\n".utf8).write(to: merker) // Schlägt das fehl, erscheint der Hinweis eben noch einmal — besser als nie
        return text
    }

    private static func existiert(_ url: URL) -> Bool {
        var st = stat()
        return lstat(url.path, &st) == 0
    }

    /// Ist `link` ein Symlink, der auf `ziel` zeigt (relativ oder absolut)?
    private static func zeigtAuf(_ link: URL, ziel: URL) -> Bool {
        guard let dest = try? FileManager.default.destinationOfSymbolicLink(atPath: link.path) else { return false }
        let aufgeloest = dest.hasPrefix("/") ? URL(fileURLWithPath: dest) : URL(fileURLWithPath: dest, relativeTo: link.deletingLastPathComponent())
        return aufgeloest.standardizedFileURL.path == ziel.standardizedFileURL.path
    }
}
