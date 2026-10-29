import Testing
import Foundation
@testable import BrainCore

/// Echte Brücke aus dem gebündelten Kern (`Ressourcen/kern`, wie im App-Paket) mit einer Kopie der Kern-Fixture als Vault; ohne Node
/// werden die Tests übersprungen (außer `BRAIN_TEST_REQUIRE=1`: dann scheitert `umgebungIstVorhandenWennErzwungen`).
enum BrueckenUmgebung {
    /// Wurzel des Repos (diese Datei liegt unter `Tests/BrainCoreTests/`).
    static let repo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    /// Der Kern wie die App ihn aufruft (`bin/kern`); in den Tests direkt der Ordner `Ressourcen/kern`.
    static let kern = repo.appendingPathComponent("Ressourcen/kern", isDirectory: true)
    static let node: URL? = {
        let kandidaten = [ProcessInfo.processInfo.environment["BRAIN_TEST_NODE"], "/opt/homebrew/bin/node", "/usr/local/bin/node"]
        for p in kandidaten.compactMap({ $0 }) where FileManager.default.isExecutableFile(atPath: p) { return URL(fileURLWithPath: p) }
        return nil
    }()
    static var verfuegbar: Bool {
        node != nil && FileManager.default.fileExists(atPath: kern.appendingPathComponent("ansicht/bruecke.mjs").path)
    }

    /// Test-Brain: Kopie der Kern-Fixture (mit `brain.config.json`), KEIN `.tools`; Name mit Leerzeichen und Umlaut.
    static func vault() throws -> URL {
        let v = tempOrdner("Test Brän")
        let fixture = repo.appendingPathComponent("Tests/Kern/fixture")
        for name in try FileManager.default.contentsOfDirectory(atPath: fixture.path) {
            try FileManager.default.copyItem(at: fixture.appendingPathComponent(name), to: v.appendingPathComponent(name))
        }
        return v
    }

    static func verbindung() throws -> BrueckenVerbindung {
        BrueckenVerbindung(node: node!, vault: try vault(), kern: kern)
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
        #expect(BrueckenUmgebung.verfuegbar, "BRAIN_TEST_REQUIRE=1, aber Node oder der Kern fehlen (BRAIN_TEST_NODE)")
    }
}

@Suite(.enabled(if: BrueckenUmgebung.verfuegbar, "braucht Node und den Kern unter Ressourcen/kern"))
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
        let datei = BrueckenUmgebung.kern.appendingPathComponent("ansicht/vendor/three.bundle.js").path
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
        let b = BrueckenVerbindung(node: URL(fileURLWithPath: "/gibt/es/nicht"), vault: try BrueckenUmgebung.vault(), kern: BrueckenUmgebung.kern)
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
        return BrueckenVerbindung(node: node, vault: ordner, kern: ordner)
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

    @Test func beendenSchliesstWartendeAnfrageMitGeschlossenUndStartetNichtNeu() async throws {
        let ordner = tempOrdner("Zaehler")
        let zaehler = ordner.appendingPathComponent("starts.txt")
        let node = skript("#!/bin/sh\necho x >> '\(zaehler.path)'\necho '{\"bereit\":true,\"version\":\"attrappe\"}'\nexec cat > /dev/null\n",
                          name: "node", in: ordner)
        let b = BrueckenVerbindung(node: node, vault: ordner, kern: ordner)
        try await b.starte()
        let laufend = Task { () -> BrueckenFehler? in
            do { _ = try await b.anfrage(methode: "GET", pfad: "/", zeitlimit: .seconds(60)); return nil }
            catch { return error as? BrueckenFehler }
        }
        while await b.offeneAnfragen == 0 { await Task.yield() }
        await b.beende()
        #expect(await laufend.value == .geschlossen)
        // Auch spaetere Anfragen scheitern sofort mit .geschlossen (nicht .beendet) — der Aufrufer versucht nichts neu.
        await #expect(throws: BrueckenFehler.geschlossen) { _ = try await b.anfrage(methode: "GET", pfad: "/") }
        await #expect(throws: BrueckenFehler.geschlossen) { try await b.starte() }
        try await Task.sleep(for: .milliseconds(300))
        let starts = try String(contentsOf: zaehler, encoding: .utf8).split(separator: "\n").count
        #expect(starts == 1)
        #expect(await b.pid == nil)
    }

    @Test func brueckeErhaeltStandardOrdnerImPfad() async throws {
        let ordner = tempOrdner("PfadTest")
        let node = skript("#!/bin/sh\nprintf '{\"bereit\":true,\"version\":\"%s\"}\\n' \"$PATH\"\nexec cat > /dev/null\n",
                          name: "node", in: ordner)
        let b = BrueckenVerbindung(node: node, vault: ordner, kern: ordner, umgebung: ["PATH": "/usr/bin:/bin"])
        try await b.starte()
        let pfad = try #require(await b.version)
        #expect(pfad == "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
        await b.beende()
    }

    /// Auch die Brücken (Werkstatt, Kern) laufen mit einem Vault als Arbeitsverzeichnis: kein relativer PATH-Eintrag (Review SW-3).
    @Test func brueckeErhaeltKeinenRelativenPfad() async throws {
        let ordner = tempOrdner("RelativerPfad")
        let node = skript("#!/bin/sh\nprintf '{\"bereit\":true,\"version\":\"%s\"}\\n' \"$PATH\"\nexec cat > /dev/null\n",
                          name: "node", in: ordner)
        let b = BrueckenVerbindung(node: node, vault: ordner, kern: ordner, umgebung: ["PATH": ".:node_modules/.bin:/usr/bin:/bin:"])
        try await b.starte()
        #expect(try #require(await b.version) == "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
        await b.beende()
    }
}
