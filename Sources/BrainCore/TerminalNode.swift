import Foundation

/// Das Node, mit dem das Terminal (Login-Shell) die Brain-Hooks startet — die App gibt es als BRAIN_NODE an das
/// Kit weiter, damit gerenderte Pfade (AGENTS.md) nicht auf das App-Node umspringen.
public enum TerminalNode {
    public static func finde(shell: URL = URL(fileURLWithPath: "/bin/zsh"), zeitlimit: Duration = .seconds(3)) async -> URL? {
        guard let r = try? await ProzessLauf.starte(shell, ["-lc", "command -v node"], zeitlimit: zeitlimit), r.code == 0 else { return nil }
        let pfad = r.ausgabe.split(separator: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .last(where: { $0.hasPrefix("/") })
        guard let pfad, FileManager.default.isExecutableFile(atPath: pfad) else { return nil }
        return URL(fileURLWithPath: pfad)
    }
}
