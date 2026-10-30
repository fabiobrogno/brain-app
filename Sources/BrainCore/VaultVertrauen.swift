import Foundation

/// Ob Kortex dem aktiven Vault vertraut (Workspace-Trust) — nur zum Anzeigen im Menü. Entschieden wird das nie hier: Der Merker
/// `<support>/vertrauen.json` gehört der Werkstatt (`Ressourcen/gemeinsam/vertrauen.mjs`), die App liest ihn nur und ändert nichts.
/// Im Zweifel („Datei fehlt, kaputt, Ordner ersetzt“) gilt der Vault wie beim Kern als nicht vertraut: „Nur ansehen“.
///
/// Format: `{ "<realpath>": { "seit", "ordner": "dev:ino:birthtimeMs", "quelle" } }`. Gleich wie dort gilt ein Eintrag nur für genau diesen
/// Ordner (Gerät, Inode und Anlagezeit), nicht für einen neuen Ordner am selben Pfad.
public enum VaultVertrauen: Equatable, Sendable {
    case vertraut
    /// Lesen, Suchen und Bearbeiten gehen; kein git, kein Hintergrunddienst, keine Hooks, keine KI-Pflege.
    case nurAnsehen

    static let quellen: Set<String> = ["angelegt", "geklont", "bestaetigt", "migriert"]

    public static func lade(vault: URL, support: URL) -> VaultVertrauen {
        guard let wurzel = echterPfad(vault.path), let kennung = kennung(wurzel),
              let daten = try? Data(contentsOf: support.appendingPathComponent("vertrauen.json")),
              let json = try? JSONSerialization.jsonObject(with: daten) as? [String: Any] else { return .nurAnsehen }
        let ziel = falte(wurzel)
        guard let eintrag = json.first(where: { falte($0.key) == ziel })?.value as? [String: Any],
              let quelle = eintrag["quelle"] as? String, quellen.contains(quelle),
              let ordner = eintrag["ordner"] as? String, gleicherOrdner(ordner, kennung) else { return .nurAnsehen }
        return .vertraut
    }

    // MARK: Hilfen

    /// Kanonischer Pfad (Schreibweise wie auf der Platte), wie `realpathSync.native` der Werkstatt.
    private static func echterPfad(_ pfad: String) -> String? {
        guard let p = realpath(pfad, nil) else { return nil }
        defer { free(p) }
        return String(cString: p)
    }

    /// Ohne Groß/klein und Unicode-Form vergleichen (wie `falte` in der Werkstatt).
    private static func falte(_ s: String) -> String { s.precomposedStringWithCanonicalMapping.lowercased() }

    private struct OrdnerKennung { let geraet: Int64; let inode: UInt64; let anlageMs: Double }

    private static func kennung(_ pfad: String) -> OrdnerKennung? {
        var st = stat()
        guard stat(pfad, &st) == 0, (st.st_mode & S_IFMT) == S_IFDIR else { return nil }
        let ms = Double(st.st_birthtimespec.tv_sec) * 1000 + Double(st.st_birthtimespec.tv_nsec) / 1_000_000
        return OrdnerKennung(geraet: Int64(st.st_dev), inode: UInt64(st.st_ino), anlageMs: ms)
    }

    /// „dev:ino:birthtimeMs“ — die Anlagezeit steht dort als Gleitkommazahl; auf eine Millisekunde genau reicht.
    private static func gleicherOrdner(_ text: String, _ k: OrdnerKennung) -> Bool {
        let teile = text.split(separator: ":", omittingEmptySubsequences: false)
        guard teile.count == 3, let g = Int64(teile[0]), let i = UInt64(teile[1]), let ms = Double(teile[2]) else { return false }
        return g == k.geraet && i == k.inode && abs(ms - k.anlageMs) < 1
    }
}
