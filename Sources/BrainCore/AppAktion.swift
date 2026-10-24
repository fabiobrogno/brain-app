import Foundation

/// Aktionen der Oberfläche an die App (Nachrichtenkanal `aktion`, kein Datenweg). Die Prüfung hier ist die einzige
/// Stelle, die Werte der Seite in etwas Ausführbares verwandelt: nur bekannte Aktionen, Pfade nur im Vault, nur https.
public enum AppAktion: Equatable, Sendable {
    case ansicht
    case ordnerZeigen(URL)
    case extern(URL)

    /// `{aktion:"ansicht"}`, `{aktion:"ordner-zeigen", wert:<rel. Pfad>}`, `{aktion:"extern", wert:<https-URL>}`.
    public static func pruefe(_ nachricht: Any, vault: URL) -> AppAktion? {
        guard let d = nachricht as? [String: Any], let name = d["aktion"] as? String else { return nil }
        let wert = d["wert"] as? String
        switch name {
        case "ansicht":
            return .ansicht
        case "ordner-zeigen":
            return wert.flatMap { ortImVault($0, vault: vault) }.map { .ordnerZeigen($0) }
        case "extern":
            guard let w = wert, let u = URL(string: w), u.scheme?.lowercased() == "https",
                  let h = u.host, !h.isEmpty else { return nil }
            return .extern(u)
        default:
            return nil
        }
    }

    /// Relativer Pfad → Datei im Vault. Kein absoluter Pfad, kein `..`, kein NUL; nach dem Auflösen von Symlinks
    /// muss das Ziel im (aufgelösten) Vault liegen.
    static func ortImVault(_ relativ: String, vault: URL) -> URL? {
        guard !relativ.isEmpty, !relativ.hasPrefix("/"), !relativ.contains("\0") else { return nil }
        let teile = relativ.split(separator: "/", omittingEmptySubsequences: true)
        guard !teile.isEmpty, !teile.contains("..") else { return nil }
        let wurzel = aufgeloest(vault)
        let ziel = aufgeloest(vault.appendingPathComponent(relativ))
        guard ziel.path.hasPrefix(wurzel.path + "/") else { return nil }
        return ziel
    }

    /// Symlinks auflösen, auch wenn die Datei selbst (noch) fehlt: der tiefste vorhandene Ordner wird aufgelöst,
    /// der Rest angehängt (`resolvingSymlinksInPath` allein löst nicht vorhandene Pfade nicht zuverlässig auf).
    private static func aufgeloest(_ url: URL) -> URL {
        var vorhanden = url.standardizedFileURL
        var rest: [String] = []
        while !FileManager.default.fileExists(atPath: vorhanden.path), vorhanden.path != "/" {
            rest.insert(vorhanden.lastPathComponent, at: 0)
            vorhanden = vorhanden.deletingLastPathComponent()
        }
        var ergebnis = vorhanden.resolvingSymlinksInPath()
        for teil in rest { ergebnis.appendPathComponent(teil) }
        return ergebnis.standardizedFileURL
    }
}

/// Befehle der App-Menüs an die Studio-Oberfläche (`window.studio.befehl(name)`); nur diese Namen werden gesendet.
public enum StudioBefehl: String, Sendable, CaseIterable {
    case neu, merken, infospalte

    public var skript: String { "window.studio?.befehl('\(rawValue)')" }
}
