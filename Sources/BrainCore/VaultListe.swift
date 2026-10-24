import Foundation

/// `<support>/vaults.json` — die Liste der Vaults, geführt vom Backend (Werkstatt). Die App liest sie nur: für den Status
/// in der Menüleiste und die Übersicht. Format: `{ "vaults":[{"name","pfad","farbe"}], "aktiv":"<pfad>" }`. Gelesen wird wie in
/// der Werkstatt (`gemeinsam/vaults.mjs`): nur Einträge mit absolutem Text-`pfad` zählen (Pfade lexikalisch bereinigt, Doppelte —
/// ohne Groß/klein und Unicode-Form — nur einmal), und `aktiv` gilt nur, wenn es einem dieser Einträge entspricht.
public struct VaultListe: Equatable, Sendable {
    public struct Eintrag: Equatable, Sendable {
        public let name: String?
        public let pfad: String
        public let farbe: String?
    }

    public let vaults: [Eintrag]
    /// Pfad des aktiven Vaults — der `pfad` des passenden Eintrags in `vaults` —, sonst nil.
    public let aktiv: String?

    /// Fehlt die Datei oder ist sie kein JSON-Objekt → nil. `vaults` muss ein Array sein (sonst gilt die Liste als leer);
    /// Einträge ohne absoluten Text-`pfad` werden übersprungen. `aktiv` zählt nur, wenn es einem Eintrag entspricht:
    /// `{"vaults":"x","aktiv":"/p"}` ergibt eine leere Liste ohne aktiven Vault.
    public static func lade(_ pfade: AppPfade) -> VaultListe? {
        guard let daten = try? Data(contentsOf: pfade.vaultListe),
              let wurzel = try? JSONSerialization.jsonObject(with: daten) as? [String: Any] else { return nil }
        var gesehen = Set<[String]>()
        var eintraege: [Eintrag] = []
        for roh in wurzel["vaults"] as? [Any] ?? [] {
            guard let d = roh as? [String: Any], let p = d["pfad"] as? String, istAbsolut(p) else { continue }
            let pfad = bereinigt(p)
            guard gesehen.insert(gefaltet(pfad)).inserted else { continue }
            eintraege.append(Eintrag(name: d["name"] as? String, pfad: pfad, farbe: d["farbe"] as? String))
        }
        let aktiv = (wurzel["aktiv"] as? String).flatMap { a -> String? in
            guard istAbsolut(a) else { return nil }
            let ziel = gefaltet(bereinigt(a))
            return eintraege.first { gefaltet($0.pfad) == ziel }?.pfad
        }
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
        let ziel = Self.gefaltet(Self.bereinigt(vault.path))
        let treffer = vaults.first { Self.gefaltet($0.pfad) == ziel }
        if let n = treffer?.name?.trimmingCharacters(in: .whitespacesAndNewlines), !n.isEmpty { return n }
        return vault.lastPathComponent
    }

    private static func istAbsolut(_ p: String) -> Bool { p.hasPrefix("/") && !p.contains("\0") }

    /// Wie `path.resolve` in Node: rein lexikalisch — leere Teile und `.` entfallen, `..` geht eine Ebene hoch (nie über `/`).
    static func bereinigt(_ pfad: String) -> String {
        var teile: [Substring] = []
        for t in pfad.split(separator: "/", omittingEmptySubsequences: true) {
            if t == "." { continue }
            if t == ".." { _ = teile.popLast(); continue }
            teile.append(t)
        }
        return "/" + teile.joined(separator: "/")
    }

    /// Vergleichsform je Pfadteil wie `falte` in der Werkstatt: APFS unterscheidet weder Groß/klein noch NFC/NFD.
    private static func gefaltet(_ pfad: String) -> [String] {
        pfad.split(separator: "/").map { $0.precomposedStringWithCanonicalMapping.lowercased() }
    }
}
