import Foundation

/// `<support>/vaults.json` — die Liste der Vaults, geführt vom Backend (Werkstatt). Die App liest sie nur: für den Status
/// in der Menüleiste und die Übersicht. Format: `{ "vaults":[{"name","pfad","farbe"}], "aktiv":"<pfad>" }`.
public struct VaultListe: Equatable, Sendable {
    public struct Eintrag: Equatable, Sendable {
        public let name: String?
        public let pfad: String
        public let farbe: String?
    }

    public let vaults: [Eintrag]
    /// Pfad des aktiven Vaults (nur absolute Pfade), sonst nil.
    public let aktiv: String?

    /// Fehlt die Datei oder ist sie kein JSON-Objekt → nil. Einzelne kaputte Einträge werden übersprungen.
    public static func lade(_ pfade: AppPfade) -> VaultListe? {
        guard let daten = try? Data(contentsOf: pfade.vaultListe),
              let wurzel = try? JSONSerialization.jsonObject(with: daten) as? [String: Any] else { return nil }
        let eintraege: [Eintrag] = (wurzel["vaults"] as? [Any] ?? []).compactMap { roh in
            guard let d = roh as? [String: Any], let p = d["pfad"] as? String, istAbsolut(p) else { return nil }
            return Eintrag(name: d["name"] as? String, pfad: p, farbe: d["farbe"] as? String)
        }
        let aktiv = (wurzel["aktiv"] as? String).flatMap { istAbsolut($0) ? $0 : nil }
        return VaultListe(vaults: eintraege, aktiv: aktiv)
    }

    /// Der aktive Vault der App: `aktiv` aus vaults.json. Nur wenn es vaults.json noch nicht gibt (oder sie unlesbar ist),
    /// gilt der Vault aus `config.json` — danach ist vaults.json maßgeblich, auch mit `aktiv: null` (Vault entfernt,
    /// nichts gewählt; ein alter config.json-Eintrag darf nicht wiederkehren).
    public static func aktiverVault(_ pfade: AppPfade) -> URL? {
        let pfad: String?
        if let liste = lade(pfade) { pfad = liste.aktiv } else { pfad = AppEinstellungen.lade(pfade).vault }
        guard let pfad, istAbsolut(pfad) else { return nil }
        return URL(fileURLWithPath: pfad, isDirectory: true)
    }

    /// Anzeigename: der Name aus der Liste, sonst der Ordnername.
    public func anzeigename(fuer vault: URL) -> String {
        let ziel = vault.standardizedFileURL.path
        let treffer = vaults.first { URL(fileURLWithPath: $0.pfad).standardizedFileURL.path == ziel }
        if let n = treffer?.name?.trimmingCharacters(in: .whitespacesAndNewlines), !n.isEmpty { return n }
        return vault.lastPathComponent
    }

    private static func istAbsolut(_ p: String) -> Bool { p.hasPrefix("/") && !p.contains("\0") }
}
