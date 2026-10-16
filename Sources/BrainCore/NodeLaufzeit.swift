import Foundation
import CryptoKit

public struct NodeManifest: Codable, Equatable, Sendable {
    public let version: String
    public let sha256: String
}

public enum LaufzeitFehler: Error, Equatable {
    case manifestFehlt
    case pruefsummeFalsch(erwartet: String, ist: String)
    case symlinkFehlgeschlagen
}

/// Kopiert das mitgelieferte Node aus dem App-Paket nach Application Support/Brain/node/<version>/ und setzt
/// bin/node als stabilen Symlink darauf (App-Spec §5.2 Baustein 2, §11). Idempotent; prüft die SHA-256 vor und
/// nach dem Kopieren; entfernt ein Quarantäne-Kennzeichen, damit Terminal-Hooks das Node ohne Rückfrage starten.
public struct NodeLaufzeit: Sendable {
    public let quelle: URL
    public let pfade: AppPfade

    public init(quelle: URL, pfade: AppPfade) {
        self.quelle = quelle
        self.pfade = pfade
    }

    public func manifest() throws -> NodeManifest {
        guard let daten = try? Data(contentsOf: quelle.appendingPathComponent("manifest.json")) else {
            throw LaufzeitFehler.manifestFehlt
        }
        return try JSONDecoder().decode(NodeManifest.self, from: daten)
    }

    @discardableResult
    public func installiere() throws -> URL {
        let m = try manifest()
        try pfade.legeAn()
        let fm = FileManager.default
        let zielOrdner = pfade.nodeOrdner.appendingPathComponent(m.version, isDirectory: true)
        let zielNode = zielOrdner.appendingPathComponent("bin/node")
        if !(fm.fileExists(atPath: zielNode.path) && (try? Self.sha256(zielNode)) == m.sha256) {
            let quellNode = quelle.appendingPathComponent("bin/node")
            let ist = try Self.sha256(quellNode)
            guard ist == m.sha256 else { throw LaufzeitFehler.pruefsummeFalsch(erwartet: m.sha256, ist: ist) }
            let tmp = pfade.nodeOrdner.appendingPathComponent(".\(m.version).\(UUID().uuidString)", isDirectory: true)
            try fm.createDirectory(at: tmp.appendingPathComponent("bin"), withIntermediateDirectories: true)
            try fm.copyItem(at: quellNode, to: tmp.appendingPathComponent("bin/node"))
            let lizenz = quelle.appendingPathComponent("LICENSE")
            if fm.fileExists(atPath: lizenz.path) { try fm.copyItem(at: lizenz, to: tmp.appendingPathComponent("LICENSE")) }
            removexattr(tmp.appendingPathComponent("bin/node").path, "com.apple.quarantine", 0)
            if fm.fileExists(atPath: zielOrdner.path) { try fm.removeItem(at: zielOrdner) }
            try fm.moveItem(at: tmp, to: zielOrdner)
            let kopiert = try Self.sha256(zielNode)
            guard kopiert == m.sha256 else { throw LaufzeitFehler.pruefsummeFalsch(erwartet: m.sha256, ist: kopiert) }
        }
        // bin/node atomar umbiegen: neuen Symlink daneben anlegen, dann per rename(2) ersetzen
        let neu = pfade.binOrdner.appendingPathComponent(".node.\(UUID().uuidString)")
        try fm.createSymbolicLink(atPath: neu.path, withDestinationPath: zielNode.path)
        guard rename(neu.path, pfade.node.path) == 0 else {
            try? fm.removeItem(at: neu)
            throw LaufzeitFehler.symlinkFehlgeschlagen
        }
        return pfade.node
    }

    static func sha256(_ url: URL) throws -> String {
        let daten = try Data(contentsOf: url, options: .mappedIfSafe)
        return SHA256.hash(data: daten).map { String(format: "%02x", $0) }.joined()
    }
}
