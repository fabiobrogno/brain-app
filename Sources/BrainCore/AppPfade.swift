import Foundation

/// Alle Orte der App unter ~/Library/Application Support/Kortex (App-Spec §5.2/§5.3). Basis injizierbar für Tests.
/// Bis zur Umbenennung hieß der Ordner `Brain`; `SupportMigration` zieht ihn beim Start einmalig um.
public struct AppPfade: Sendable, Equatable {
    public let basis: URL

    public init(basis: URL) { self.basis = basis }

    /// Name des Support-Ordners (neu) und des früheren Ordners (nur für die Migration).
    public static let ordnerName = "Kortex"
    public static let altOrdnerName = "Brain"

    /// `BRAIN_APP_SUPPORT` lenkt für Tests und Rauchtests auf einen eigenen Ordner um. Ein relativer Wert wird auf den
    /// Arbeitsordner bezogen (nie stillschweigend verworfen: sonst würde ein Testlauf den ECHTEN Support-Ordner nutzen).
    public static func standard(umgebung: [String: String] = ProcessInfo.processInfo.environment,
                                arbeitsordner: String = FileManager.default.currentDirectoryPath) -> AppPfade {
        if let test = umlenkung(umgebung, arbeitsordner: arbeitsordner) { return AppPfade(basis: test) }
        return AppPfade(basis: applicationSupport().appendingPathComponent(ordnerName, isDirectory: true))
    }

    /// Der Ordner aus `BRAIN_APP_SUPPORT` (absolut gemacht, bereinigt) oder nil, wenn die Variable fehlt oder leer ist.
    static func umlenkung(_ umgebung: [String: String], arbeitsordner: String) -> URL? {
        guard let wert = umgebung["BRAIN_APP_SUPPORT"], !wert.isEmpty else { return nil }
        let absolut = wert.hasPrefix("/") ? wert : arbeitsordner + "/" + wert
        return URL(fileURLWithPath: absolut, isDirectory: true).standardizedFileURL
    }

    public static func applicationSupport() -> URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    }

    /// Der frühere Support-Ordner (`…/Application Support/Brain`) — nil, wenn `BRAIN_APP_SUPPORT` auf einen eigenen Ordner
    /// umlenkt (Tests, Rauchtests: dort wird nie migriert und der echte Ordner nie angefasst).
    public static func altBasis(umgebung: [String: String] = ProcessInfo.processInfo.environment) -> URL? {
        if umlenkung(umgebung, arbeitsordner: "/") != nil { return nil }
        return applicationSupport().appendingPathComponent(altOrdnerName, isDirectory: true)
    }

    public var konfiguration: URL { basis.appendingPathComponent("config.json") }
    /// Vault-Liste des Studios (vom Backend geführt, die App liest nur).
    public var vaultListe: URL { basis.appendingPathComponent("vaults.json") }
    /// Gedächtnis des Assistenten „Kortex einrichten“ (`EinrichtungsSpeicher`).
    public var einrichtung: URL { basis.appendingPathComponent("einrichtung.json") }
    public var nodeOrdner: URL { basis.appendingPathComponent("node", isDirectory: true) }
    public var binOrdner: URL { basis.appendingPathComponent("bin", isDirectory: true) }
    public var node: URL { binOrdner.appendingPathComponent("node") }
    /// Kopien des Kerns je App-Version: `kern/<appVersion>/` (Kern = die Brain-Logik aus dem App-Paket, `Ressourcen/kern`).
    public var kernOrdner: URL { basis.appendingPathComponent("kern", isDirectory: true) }
    /// Stabiler Pfad auf die aktive Kern-Version (atomarer Symlink); Hooks, MCP, git-Hooks und LaunchAgent nutzen nur diesen.
    public var kern: URL { binOrdner.appendingPathComponent("kern") }
    /// Der Starter `kortex`: führt `bin/node bin/kern/brain.mjs` mit allen Argumenten aus.
    public var starter: URL { binOrdner.appendingPathComponent("kortex") }
    /// Merker „Hinweis zu den zwei Ordnern Brain/Kortex wurde schon gezeigt“ (`SupportMigration.anzuzeigenderHinweis`).
    public var ordnerHinweisMerker: URL { basis.appendingPathComponent(".brain-ordner-hinweis-gezeigt") }
    public var logs: URL { basis.appendingPathComponent("logs", isDirectory: true) }

    public func legeAn() throws {
        for ordner in [basis, nodeOrdner, kernOrdner, binOrdner, logs] {
            try FileManager.default.createDirectory(at: ordner, withIntermediateDirectories: true)
        }
    }
}
