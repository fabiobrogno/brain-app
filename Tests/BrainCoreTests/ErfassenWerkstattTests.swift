import Testing
import Foundation
@testable import BrainCore

/// Ende-zu-Ende mit der echten Werkstatt (Node): „Schnell erfassen“ speichert ohne geöffnetes Studio in einen Wegwerf-Vault
/// (Temp-Ordner) mit eigenem Support-Ordner — nie in `~/brain` oder die echten App-Daten. Läuft nur, wenn `node` im PATH liegt.
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

private struct Probe {
    let vault: URL
    let support: URL
    let speicher: WerkstattErfassenSpeicher

    init(vertraut: Bool) throws {
        let node = try #require(findeNode())
        support = tempOrdner("support")
        vault = tempOrdner("Mein Vault")
        try Data("{}\n".utf8).write(to: vault.appendingPathComponent("brain.config.json"))
        let umgebung = ["BRAIN_APP_SUPPORT": support.path, "BRAIN_TESTMODUS": "1", "KORTEX_VAULT_VERTRAUT": vertraut ? "alle" : ""]
        let arbeit = support
        speicher = WerkstattErfassenSpeicher { v in
            BrueckenVerbindung(node: node, vault: v, skript: werkstattSkript, umgebung: umgebung, arbeitsordner: arbeit)
        }
    }

    func dateien(_ ordner: String) -> [URL] {
        ((try? FileManager.default.contentsOfDirectory(at: vault.appendingPathComponent(ordner), includingPropertiesForKeys: nil)) ?? [])
            .filter { $0.pathExtension == "md" }
    }
}

@Test(.enabled(if: moeglich)) func eineAufgabeLandetOhneStudioImVaultMitQuelleMensch() async throws {
    let p = try Probe(vertraut: true)
    let pfad = try await p.speicher.speichere(Erfassung(art: .aufgabe, titel: "--text Steuer machen", text: "Unterlagen im Ordner\nzweite Zeile",
                                                         prioritaet: .hoch, faellig: "2026-10-31", vault: p.vault))
    #expect(pfad.hasPrefix("05_aufgaben/") && pfad.hasSuffix(".md"), "\(pfad)")
    let datei = try String(contentsOf: p.vault.appendingPathComponent(pfad), encoding: .utf8)
    #expect(datei.contains("titel: \"--text Steuer machen\""), "ein Titel mit Bindestrichen bleibt ein Titel\n\(datei)")
    #expect(datei.contains("prioritaet: hoch") && datei.contains("faellig: 2026-10-31") && datei.contains("quelle: mensch"), "\(datei)")
    #expect(datei.contains("Unterlagen im Ordner\nzweite Zeile"))
    #expect(p.dateien("05_aufgaben").count == 1)
}

@Test(.enabled(if: moeglich)) func eineNotizLandetImPosteingangWieSchnellMerken() async throws {
    let p = try Probe(vertraut: true)
    let pfad = try await p.speicher.speichere(Erfassung(art: .notiz, text: "Idee: Kaffee direkt vom Röster\nZweite Zeile", vault: p.vault))
    #expect(pfad.hasPrefix("00_inbox/") && pfad.hasSuffix(".md"), "\(pfad)")
    let datei = try String(contentsOf: p.vault.appendingPathComponent(pfad), encoding: .utf8)
    #expect(datei.hasPrefix("# Idee: Kaffee direkt vom Röster\n") && datei.contains("Zweite Zeile"), "\(datei)")
}

@Test(.enabled(if: moeglich)) func inEinemNichtBestaetigtenVaultSchreibtDieWerkstattKeineAufgabe() async throws {
    let p = try Probe(vertraut: false)
    do {
        _ = try await p.speicher.speichere(Erfassung(art: .aufgabe, titel: "Nicht erlaubt", text: "", vault: p.vault))
        Issue.record("hätte scheitern müssen")
    } catch let f as ErfassenFehler {
        #expect(f.nichtVertraut, "\(f.meldung)")
    }
    #expect(p.dateien("05_aufgaben").isEmpty)
}

@MainActor @Test(.enabled(if: moeglich)) func dasModellSpeichertUeberDieEchteWerkstattUndSchliesst() async throws {
    let p = try Probe(vertraut: true)
    let ziel = ErfassenVault(name: "Mein Vault", url: p.vault)
    var zu = 0
    let modell = ErfassenModell(speicher: p.speicher, vaultQuelle: { ([ziel], ziel.url) }, vertrauen: { _ in .vertraut },
                                heute: { erfassenHeute }, kalender: erfassenKalender, warte: { _ in })
    modell.beiSchliessen = { zu += 1 }
    modell.text = "Zahnarzt anrufen morgen !hoch"
    await modell.speichere()
    #expect(modell.zustand == .gespeichert(vault: "Mein Vault"), "\(modell.zustand)")
    #expect(zu == 1)
    let datei = try String(contentsOf: try #require(p.dateien("05_aufgaben").first), encoding: .utf8)
    #expect(datei.contains("titel: Zahnarzt anrufen") && datei.contains("faellig: 2026-10-31") && datei.contains("prioritaet: hoch"), "\(datei)")
}
