import Testing
import Foundation
@testable import BrainCore

/// Echte Brücke aus dem Kit-Worktree; ohne Node oder Kit werden die Tests übersprungen
/// (außer `BRAIN_TEST_REQUIRE=1`: dann scheitert `umgebungIstVorhandenWennErzwungen`).
enum BrueckenUmgebung {
    static let kit = URL(fileURLWithPath: ProcessInfo.processInfo.environment["BRAIN_TEST_KIT"] ?? NSHomeDirectory() + "/brain-kit-v0.6")
    static let node: URL? = {
        let kandidaten = [ProcessInfo.processInfo.environment["BRAIN_TEST_NODE"], "/opt/homebrew/bin/node", "/usr/local/bin/node"]
        for p in kandidaten.compactMap({ $0 }) where FileManager.default.isExecutableFile(atPath: p) { return URL(fileURLWithPath: p) }
        return nil
    }()
    static var verfuegbar: Bool {
        node != nil && FileManager.default.fileExists(atPath: kit.appendingPathComponent(".tools/ansicht/bruecke.mjs").path)
    }

    /// Test-Brain: Kopie der Kit-Fixture, `.tools` als Symlink auf das Kit; Name mit Leerzeichen und Umlaut.
    static func vault() throws -> URL {
        let v = tempOrdner("Test Brän")
        let fixture = kit.appendingPathComponent(".tools/tests/fixture")
        for name in try FileManager.default.contentsOfDirectory(atPath: fixture.path) {
            try FileManager.default.copyItem(at: fixture.appendingPathComponent(name), to: v.appendingPathComponent(name))
        }
        try FileManager.default.createSymbolicLink(at: v.appendingPathComponent(".tools"),
                                                   withDestinationURL: kit.appendingPathComponent(".tools"))
        return v
    }

    static func verbindung() throws -> BrueckenVerbindung {
        BrueckenVerbindung(node: node!, vault: try vault())
    }
}

/// Wartet ohne feste Pause (nur Zustandsabfrage), bis das Betriebssystem den Prozessabsturz gemeldet hat.
/// Das Prozessende wird der Verbindung erst danach zugestellt — genau das Fenster, in dem eine neue Anfrage eintrifft.
func wartebisTot(_ b: BrueckenVerbindung) async {
    let frist = ContinuousClock.now + .seconds(10)
    while await b.laeuft, ContinuousClock.now < frist { await Task.yield() }
}

/// Nicht übersprungen: Mit `BRAIN_TEST_REQUIRE=1` (CI, Abnahme) darf die Brücken-Suite nicht still ausfallen.
@Suite struct BrueckenUmgebungTests {
    @Test func umgebungIstVorhandenWennErzwungen() {
        guard ProcessInfo.processInfo.environment["BRAIN_TEST_REQUIRE"] == "1" else { return }
        #expect(BrueckenUmgebung.verfuegbar, "BRAIN_TEST_REQUIRE=1, aber Node oder Kit fehlen (BRAIN_TEST_NODE / BRAIN_TEST_KIT)")
    }
}

@Suite(.enabled(if: BrueckenUmgebung.verfuegbar, "braucht Node und den Kit-Worktree ~/brain-kit-v0.6"))
struct BrueckenVerbindungTests {
    @Test func startetUndLiefertStartseiteUndPing() async throws {
        let b = try BrueckenUmgebung.verbindung()
        try await b.starte()
        #expect(await b.version != nil)
        let start = try await b.anfrage(methode: "GET", pfad: "/")
        #expect(start.status == 200)
        #expect(String(decoding: start.body, as: UTF8.self).contains("api.js"))
        #expect(try await b.anfrage(methode: "GET", pfad: "/api/ping").status == 200)
        await b.beende()
    }

    @Test func parallelAnfragenKommenRichtigZurueck() async throws {
        let b = try BrueckenUmgebung.verbindung()
        try await b.starte()
        try await withThrowingTaskGroup(of: Int.self) { gruppe in
            for _ in 0..<20 { gruppe.addTask { try await b.anfrage(methode: "GET", pfad: "/api/ping").status } }
            for try await status in gruppe { #expect(status == 200) }
        }
        await b.beende()
    }

    @Test func grosseDateiKommtVollstaendigUndBrueckeStartetVonSelbst() async throws {
        let b = try BrueckenUmgebung.verbindung()
        let r = try await b.anfrage(methode: "GET", pfad: "/vendor/three.bundle.js")
        let datei = BrueckenUmgebung.kit.appendingPathComponent(".tools/ansicht/vendor/three.bundle.js").path
        let soll = try #require(try FileManager.default.attributesOfItem(atPath: datei)[.size] as? Int)
        #expect(r.status == 200)
        #expect(r.body.count == soll)
        await b.beende()
    }

    @Test func nachAbsturzStartetDieNaechsteAnfrageNeu() async throws {
        let b = try BrueckenUmgebung.verbindung()
        try await b.starte()
        let alt = try #require(await b.pid)
        kill(alt, SIGKILL)
        await wartebisTot(b)
        #expect(try await b.anfrage(methode: "GET", pfad: "/api/ping").status == 200)
        #expect(await b.pid != alt)
        await b.beende()
    }

    @Test func fehlendesNodeMeldetSichSauber() async throws {
        let b = BrueckenVerbindung(node: URL(fileURLWithPath: "/gibt/es/nicht"), vault: try BrueckenUmgebung.vault())
        await #expect(throws: BrueckenFehler.self) { _ = try await b.anfrage(methode: "GET", pfad: "/") }
    }

    @Test func beendenSchliesstDenProzess() async throws {
        let b = try BrueckenUmgebung.verbindung()
        try await b.starte()
        let pid = try #require(await b.pid)
        await b.beende()
        try await Task.sleep(for: .seconds(1))
        #expect(kill(pid, 0) != 0)
    }
}

/// Mit einer Attrappe statt Node: meldet „bereit“ und beantwortet danach nie etwas — so bleibt eine Anfrage
/// zuverlässig offen, ohne auf Zeitabläufe zu setzen.
@Suite struct BrueckenAbsturzTests {
    static func stummeBruecke() -> BrueckenVerbindung {
        let ordner = tempOrdner("Attrappe")
        let node = skript("#!/bin/sh\necho '{\"bereit\":true,\"version\":\"attrappe\"}'\nexec cat > /dev/null\n",
                          name: "node", in: ordner)
        return BrueckenVerbindung(node: node, vault: ordner)
    }

    @Test func wartendeAnfrageEndetSofortBeiAbsturzUndNeuerAnfrage() async throws {
        let b = Self.stummeBruecke()
        try await b.starte()
        let alt = try #require(await b.pid)
        let alte = Task { () -> BrueckenFehler? in
            do { _ = try await b.anfrage(methode: "GET", pfad: "/", zeitlimit: .seconds(60)); return nil }
            catch { return error as? BrueckenFehler }
        }
        while await b.offeneAnfragen == 0 { await Task.yield() }
        kill(alt, SIGKILL)
        await wartebisTot(b)
        // Sofort eine neue Anfrage (kurzes Limit, die Attrappe antwortet nie): sie startet neu und schließt die alte ab.
        await #expect(throws: BrueckenFehler.zeitUeberschritten) {
            _ = try await b.anfrage(methode: "GET", pfad: "/neu", zeitlimit: .milliseconds(300))
        }
        #expect(await alte.value == .beendet)
        #expect(await b.pid != alt)
        await b.beende()
    }

    @Test func zeitlimitWirdGemeldetUndRaeumtAuf() async throws {
        let b = Self.stummeBruecke()
        await #expect(throws: BrueckenFehler.zeitUeberschritten) {
            _ = try await b.anfrage(methode: "GET", pfad: "/", zeitlimit: .milliseconds(200))
        }
        #expect(await b.offeneAnfragen == 0)
        await b.beende()
    }
}
