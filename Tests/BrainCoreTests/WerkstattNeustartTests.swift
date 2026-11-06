import Testing
import Foundation
@testable import BrainCore

/// Der Hintergrunddienst (Werkstatt) stirbt mitten im Speichern: Die App startet ihn bei der nächsten Anfrage selbst neu (BrueckenVerbindung), ein PUT wird dabei
/// nie wiederholt (es könnte doppelt schreiben) — das Studio zeigt „Speichern gerade nicht möglich“ und speichert in wachsenden Abständen erneut (studio/app.js, `dienstWeg`).
/// Echte Werkstatt (Node), nur Wegwerf-Ordner; die Kindprozesse bekommen eine gesäuberte Umgebung (kein CLAUDE_CONFIG_DIR, CODEX_HOME, XDG_CONFIG_HOME, GIT_CONFIG_GLOBAL, …).
private let werkstattSkript = BrueckenUmgebung.repo.appendingPathComponent("Ressourcen/werkstatt/werkstatt.mjs")
private let moeglich = BrueckenUmgebung.node != nil && FileManager.default.fileExists(atPath: werkstattSkript.path)

private func saubereUmgebung(home: URL) -> [String: String] {
    ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin", "HOME": home.path, "LANG": "de_DE.UTF-8"]
}

private struct Aufbau {
    let vault: URL
    let support: URL
    let bruecke: BrueckenVerbindung
    var datei: URL { vault.appendingPathComponent("a.md") }

    init() throws {
        let home = tempOrdner("home")
        support = tempOrdner("support")
        vault = tempOrdner("Mein Vault")
        try Data("{}\n".utf8).write(to: vault.appendingPathComponent("brain.config.json"))
        try Data("# A\n\nerste Zeile\n".utf8).write(to: vault.appendingPathComponent("a.md"))
        bruecke = BrueckenVerbindung(node: try #require(BrueckenUmgebung.node), vault: vault, skript: werkstattSkript,
                                     umgebung: ["BRAIN_APP_SUPPORT": support.path, "BRAIN_TESTMODUS": "1", "KORTEX_VAULT_VERTRAUT": "alle"],
                                     arbeitsordner: support, basisUmgebung: saubereUmgebung(home: home))
    }

    func lies() async throws -> (hash: String, inhalt: String) {
        let r = try await bruecke.anfrage(methode: "GET", pfad: "/api/datei?pfad=a.md")
        let j = try #require(try JSONSerialization.jsonObject(with: r.body) as? [String: Any])
        return (try #require(j["hash"] as? String), try #require(j["inhalt"] as? String))
    }
    func speichere(_ text: String, hash: String) async throws -> BrueckenAntwort {
        let koerper = try JSONSerialization.data(withJSONObject: ["pfad": "a.md", "inhalt": text, "basisHash": hash])
        return try await bruecke.anfrage(methode: "PUT", pfad: "/api/datei", body: koerper)
    }
}

@Suite(.enabled(if: moeglich, "braucht Node und Ressourcen/werkstatt")) struct WerkstattNeustartTests {
    @Test func nachDemTodDerWerkstattStartetDieNaechsteAnfrageSieNeuUndDasSpeichernGelingt() async throws {
        let a = try Aufbau()
        let (hash, _) = try await a.lies()
        let alt = try #require(await a.bruecke.pid)
        kill(alt, SIGKILL)
        await wartebisTot(a.bruecke)
        // das Studio hat den Text noch im Editor: der erneute Speicherversuch startet den Dienst und schreibt
        let r = try await a.speichere("# A\n\nerste Zeile\nvon Hand ergänzt\n", hash: hash)
        #expect(r.status == 200)
        #expect(await a.bruecke.pid != alt)
        #expect(try String(contentsOf: a.datei, encoding: .utf8) == "# A\n\nerste Zeile\nvon Hand ergänzt\n")
        await a.bruecke.beende()
    }

    @Test func stirbtDieWerkstattWaehrendEinesPutWirdNichtWiederholtUndDieNaechsteAnfrageStartetNeu() async throws {
        // Attrappe, die „bereit“ meldet und nie antwortet: der PUT bleibt zuverlässig offen
        let ordner = tempOrdner("Attrappe")
        let node = skript("#!/bin/sh\necho '{\"bereit\":true,\"version\":\"attrappe\"}'\nexec cat > /dev/null\n", name: "node", in: ordner)
        let b = BrueckenVerbindung(node: node, vault: ordner, kern: ordner)
        try await b.starte()
        let alt = try #require(await b.pid)
        let put = Task { () -> BrueckenFehler? in
            do { _ = try await b.anfrageMitNeuversuch(methode: "PUT", pfad: "/api/datei", body: Data("{}".utf8)); return nil }
            catch { return error as? BrueckenFehler }
        }
        while await b.offeneAnfragen == 0 { await Task.yield() }
        kill(alt, SIGKILL)
        await wartebisTot(b)
        #expect(await put.value == .beendet, "der PUT scheitert, er wird nicht stillschweigend wiederholt")
        #expect(BrueckenVerbindung.darfWiederholen(methode: "PUT") == false)
        // erst die nächste Anfrage (im Studio: der erneute Speicherversuch) startet den Dienst wieder
        await #expect(throws: BrueckenFehler.zeitUeberschritten) { _ = try await b.anfrage(methode: "GET", pfad: "/api/ping", zeitlimit: .milliseconds(300)) }
        #expect(await b.pid != alt)
        await b.beende()
    }
}
