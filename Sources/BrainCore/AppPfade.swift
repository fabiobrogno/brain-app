import Foundation

/// Alle Orte der App unter ~/Library/Application Support/Brain (App-Spec §5.2/§5.3). Basis injizierbar für Tests.
public struct AppPfade: Sendable, Equatable {
    public let basis: URL

    public init(basis: URL) { self.basis = basis }

    /// `BRAIN_APP_SUPPORT` (nur absolute Pfade) lenkt für Tests und Rauchtests auf einen eigenen Ordner um.
    public static func standard(umgebung: [String: String] = ProcessInfo.processInfo.environment) -> AppPfade {
        if let test = umgebung["BRAIN_APP_SUPPORT"], test.hasPrefix("/") {
            return AppPfade(basis: URL(fileURLWithPath: test, isDirectory: true))
        }
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return AppPfade(basis: support.appendingPathComponent("Brain", isDirectory: true))
    }

    public var konfiguration: URL { basis.appendingPathComponent("config.json") }
    /// Vault-Liste des Studios (vom Backend geführt, die App liest nur).
    public var vaultListe: URL { basis.appendingPathComponent("vaults.json") }
    /// Gedächtnis des Assistenten „Kortex einrichten“ (`EinrichtungsSpeicher`).
    public var einrichtung: URL { basis.appendingPathComponent("einrichtung.json") }
    public var nodeOrdner: URL { basis.appendingPathComponent("node", isDirectory: true) }
    public var binOrdner: URL { basis.appendingPathComponent("bin", isDirectory: true) }
    public var node: URL { binOrdner.appendingPathComponent("node") }
    public var logs: URL { basis.appendingPathComponent("logs", isDirectory: true) }

    public func legeAn() throws {
        for ordner in [basis, nodeOrdner, binOrdner, logs] {
            try FileManager.default.createDirectory(at: ordner, withIntermediateDirectories: true)
        }
    }
}
