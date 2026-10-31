import Testing
import Foundation
@testable import BrainCore

/// Ende-zu-Ende mit der echten Werkstatt (Node) im Testmodus: temporärer Support- und Vault-Ordner, nie das echte ~/brain.
/// Läuft nur, wenn `node` im PATH liegt und das Skript im Repo gefunden wird (sonst übersprungen).
private func repoWurzel() -> URL {
    URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
}

private func findeNode() -> URL? {
    let pfad = ProcessInfo.processInfo.environment["PATH"] ?? ""
    return pfad.split(separator: ":").map { URL(fileURLWithPath: String($0)).appendingPathComponent("node") }
        .first { FileManager.default.isExecutableFile(atPath: $0.path) }
}

private let werkstattSkript = repoWurzel().appendingPathComponent("Ressourcen/werkstatt/werkstatt.mjs")
private let moeglich = findeNode() != nil && FileManager.default.fileExists(atPath: werkstattSkript.path)

@Test(.enabled(if: moeglich)) func echteWerkstattLegtVaultAnUndDieDiensteErkennenEs() async throws {
    let node = try #require(findeNode())
    let support = tempOrdner("support")
    let pfade = AppPfade(basis: support)
    let ziel = tempOrdner("home").appendingPathComponent("Mein Brain", isDirectory: true)
    let bruecke = BrueckenVerbindung(node: node, vault: nil, skript: werkstattSkript,
                                     umgebung: ["BRAIN_APP_SUPPORT": support.path, "BRAIN_TESTMODUS": "1"], arbeitsordner: support)
    let dienste = WerkstattDienste(pfade: pfade, home: ziel.deletingLastPathComponent()) { m, p, b in try await bruecke.anfrage(methode: m, pfad: p, body: b) }
    defer { Task { await bruecke.beende() } }

    // GitHub ist ohne Client-ID „nicht verfügbar“, die KI-Suche antwortet mit der Liste.
    let konto = try await dienste.githubKonto()
    #expect(konto.verfuegbar == false)
    let kis = try await dienste.erkenneKIs()
    #expect(kis.contains { $0.id == "claude" })

    // Vault anlegen: die Werkstatt richtet Ordner und Versionsverlauf ein, die App sieht ihn danach in vaults.json.
    let vault = try await dienste.legeVaultAn(art: .leer, name: "Mein Brain", ordner: ziel.path)
    #expect(FileManager.default.fileExists(atPath: ziel.appendingPathComponent(".git").path))
    #expect(vault.name == "Mein Brain")

    // Die App liest den Vault aus derselben vaults.json wie die Werkstatt.
    let gelesen = await dienste.aktiverVault()
    #expect(gelesen?.name == "Mein Brain")
    #expect(gelesen?.git == true)

    // Ein Fehler der Werkstatt kommt als lesbarer Text an: derselbe Ordner ist jetzt belegt.
    await #expect(throws: EinrichtungsFehler.self) { try await dienste.legeVaultAn(art: .leer, name: nil, ordner: ziel.path) }
}
