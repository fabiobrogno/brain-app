import Foundation

/// Führt `<node> <vault>/.tools/brain.mjs <argumente>` aus (App-Spec §5.2: die App ruft nur brain.mjs-Befehle).
public struct BrainBefehl: Sendable {
    public let node: URL
    public let vault: URL
    public let umgebung: [String: String]

    public init(node: URL, vault: URL, umgebung: [String: String] = [:]) {
        self.node = node
        self.vault = vault
        self.umgebung = umgebung
    }

    /// Eine GUI-App startet mit Minimal-PATH — Homebrew- und /usr/local-Programme (z. B. git) müssen auffindbar sein.
    public static func pfadMitStandardOrdnern(_ pfad: String?) -> String {
        let vorhanden = (pfad ?? "").split(separator: ":").map(String.init)
        let fehlend = ["/opt/homebrew/bin", "/usr/local/bin"].filter { !vorhanden.contains($0) }
        return (fehlend + vorhanden).joined(separator: ":")
    }

    public func fuehreAus(_ argumente: [String], zeitlimit: Duration = .seconds(20)) async throws -> BefehlErgebnis {
        var env = ProcessInfo.processInfo.environment
        env["BRAIN_VAULT"] = vault.path
        for (k, v) in umgebung { env[k] = v }
        env["PATH"] = Self.pfadMitStandardOrdnern(env["PATH"])
        return try await ProzessLauf.starte(node, [vault.appendingPathComponent(".tools/brain.mjs").path] + argumente,
                                            umgebung: env, ordner: vault, zeitlimit: zeitlimit)
    }

    public func status(zeitlimit: Duration = .seconds(20)) async throws -> BrainStatus {
        try BrainStatus.aus(ausgabe: try await fuehreAus(["status", "--json"], zeitlimit: zeitlimit).ausgabe)
    }
}
