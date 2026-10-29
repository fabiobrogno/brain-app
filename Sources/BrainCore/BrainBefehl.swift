import Foundation

/// Führt `<node> <kern>/brain.mjs --vault <vault> <argumente>` aus (App-Spec §5.2: die App ruft nur brain.mjs-Befehle).
/// `kern` ist der stabile Pfad `Support/Kortex/bin/kern` (Symlink auf den gebündelten, per Manifest geprüften Kern, `AppPfade.kern`);
/// der Vault enthält nur Daten und wird nie ausgeführt. Der Vault geht ausdrücklich als `--vault` UND als `BRAIN_VAULT` mit.
public struct BrainBefehl: Sendable {
    public let node: URL
    public let kern: URL
    public let vault: URL
    public let umgebung: [String: String]

    public init(node: URL, kern: URL, vault: URL, umgebung: [String: String] = [:]) {
        self.node = node
        self.kern = kern
        self.vault = vault
        self.umgebung = umgebung
    }

    /// Das Skript des Kerns (`<kern>/brain.mjs`).
    public static func skript(kern: URL) -> URL { kern.appendingPathComponent("brain.mjs") }

    /// Die Argumente für Node: `<kern>/brain.mjs --vault <vault> <argumente>`. `--vault` steht vor dem Befehl; der Kern nimmt es
    /// an beliebiger Stelle aus der Kommandozeile (`pfade.mjs`).
    public static func nodeArgumente(kern: URL, vault: URL, _ argumente: [String]) -> [String] {
        [skript(kern: kern).path, "--vault", vault.path] + argumente
    }

    /// Wohin die Kindprozesse greifen dürfen, wenn vom PATH des Starters nichts Brauchbares übrig bleibt.
    static let systemOrdner = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"]

    /// Eine GUI-App startet mit Minimal-PATH — Homebrew- und /usr/local-Programme (z. B. git) müssen auffindbar sein.
    /// Übernommen werden nur absolute Einträge. Ein leerer oder relativer Eintrag (`.`, `node_modules/.bin`, `~/bin`) löst Node
    /// (libuv) und jede Shell gegen das Arbeitsverzeichnis des KINDES auf — und das ist bei der Vertrauensprüfung und bei den
    /// Git-Aufrufen der Werkstatt ein fremder, noch nie freigegebener Vault: Läge dort ein `git`, liefe es vor dem echten, schon
    /// bevor der Nutzer vertraut hat (Studio-v2-Spec §8, Review SW-3). Bleibt nichts übrig, gelten die Systemordner.
    public static func pfadMitStandardOrdnern(_ pfad: String?) -> String {
        var vorhanden = (pfad ?? "").split(separator: ":").map(String.init).filter { $0.hasPrefix("/") }
        if vorhanden.isEmpty { vorhanden = systemOrdner }
        let fehlend = ["/opt/homebrew/bin", "/usr/local/bin"].filter { !vorhanden.contains($0) }
        return (fehlend + vorhanden).joined(separator: ":")
    }

    public func fuehreAus(_ argumente: [String], zeitlimit: Duration = .seconds(20)) async throws -> BefehlErgebnis {
        let env = NodeUmgebung.fuerKind(vault: vault, vorgaben: umgebung)
        return try await ProzessLauf.starte(node, Self.nodeArgumente(kern: kern, vault: vault, argumente),
                                            umgebung: env, ordner: vault, zeitlimit: zeitlimit)
    }

    public func status(zeitlimit: Duration = .seconds(20)) async throws -> BrainStatus {
        try BrainStatus.aus(ausgabe: try await fuehreAus(["status", "--json"], zeitlimit: zeitlimit).ausgabe)
    }
}
