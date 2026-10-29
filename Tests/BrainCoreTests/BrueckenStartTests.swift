import Testing
import Foundation
@testable import BrainCore

/// Zählt Aufrufe aus mehreren Tasks (die Prüfungen vor dem Start).
private final class Zaehler: @unchecked Sendable {
    private let sperre = NSLock()
    private var wert = 0
    @discardableResult func erhoehe() -> Int { sperre.lock(); defer { sperre.unlock() }; wert += 1; return wert }
    var stand: Int { sperre.lock(); defer { sperre.unlock() }; return wert }
}

/// Ein Schalter, den der Test umlegt, während die Brücke ihn aus einer anderen Task liest.
private final class Schalter: @unchecked Sendable {
    private let sperre = NSLock()
    private var ja: Bool
    init(_ ja: Bool) { self.ja = ja }
    var wert: Bool {
        get { sperre.lock(); defer { sperre.unlock() }; return ja }
        set { sperre.lock(); ja = newValue; sperre.unlock() }
    }
}

/// Attrappe statt Node: schreibt je Start „start“, die Argumente (eines je Zeile) und BRAIN_VAULT ins Log, meldet „bereit“ und
/// beantwortet danach nie etwas.
private func protokollierenderNode(in ordner: URL, log: URL) -> URL {
    skript("""
    #!/bin/sh
    echo start >> '\(log.path)'
    for a in "$@"; do echo "arg:$a" >> '\(log.path)'; done
    echo "vault:${BRAIN_VAULT-unset}" >> '\(log.path)'
    echo '{"bereit":true,"version":"attrappe"}'
    exec cat > /dev/null
    """, name: "node", in: ordner)
}

/// Das Log in Blöcke je Prozessstart: [["arg:…", "arg:…", "vault:…"], …]
private func starts(_ log: URL) -> [[String]] {
    let zeilen = ((try? String(contentsOf: log, encoding: .utf8)) ?? "").split(separator: "\n").map(String.init)
    var bloecke: [[String]] = []
    for z in zeilen {
        if z == "start" { bloecke.append([]) } else if !bloecke.isEmpty { bloecke[bloecke.count - 1].append(z) }
    }
    return bloecke
}

// MARK: Prüfung vor dem Start (z. B. „ist der Kern noch bereit?“)

@Test func ohneErlaubnisStartetKeinProzess() async throws {
    let ordner = tempOrdner("Ohne Erlaubnis")
    let log = ordner.appendingPathComponent("starts.txt")
    let b = BrueckenVerbindung(node: protokollierenderNode(in: ordner, log: log), vault: ordner, kern: ordner, vorStart: { false })
    await #expect(throws: BrueckenFehler.nichtErlaubt) { _ = try await b.anfrage(methode: "GET", pfad: "/") }
    await #expect(throws: BrueckenFehler.nichtErlaubt) { _ = try await b.anfrage(methode: "POST", pfad: "/api/x", body: Data("{}".utf8)) }
    // GET mit Neuversuch: „nicht erlaubt“ ist kein Absturz und wird nie wiederholt
    await #expect(throws: BrueckenFehler.nichtErlaubt) { _ = try await b.anfrageMitNeuversuch(methode: "GET", pfad: "/") }
    await #expect(throws: BrueckenFehler.nichtErlaubt) { try await b.starte() }
    #expect(!FileManager.default.fileExists(atPath: log.path), "ohne Erlaubnis entsteht kein Prozess")
    #expect(await b.pid == nil)
    await b.beende()
}

@Test func mitErlaubnisStartetDieBruecke() async throws {
    let ordner = tempOrdner("Mit Erlaubnis")
    let log = ordner.appendingPathComponent("starts.txt")
    let pruefungen = Zaehler()
    let b = BrueckenVerbindung(node: protokollierenderNode(in: ordner, log: log), vault: ordner, kern: ordner, vorStart: { pruefungen.erhoehe(); return true })
    try await b.starte()
    #expect(await b.version == "attrappe")
    try await b.starte() // läuft schon: keine zweite Prüfung, kein zweiter Start
    #expect(pruefungen.stand == 1)
    #expect(starts(log).count == 1)
    await b.beende()
}

@Test func gleichzeitigeStartsTeilenSichEinePruefungUndEinenProzess() async throws {
    let ordner = tempOrdner("Gleichzeitig")
    let log = ordner.appendingPathComponent("starts.txt")
    let pruefungen = Zaehler()
    // Eine langsame Prüfung: während sie läuft, treffen weitere Anfragen ein (die Seite lädt viele Dateien auf einmal).
    let b = BrueckenVerbindung(node: protokollierenderNode(in: ordner, log: log), vault: ordner, kern: ordner, vorStart: {
        pruefungen.erhoehe()
        try? await Task.sleep(for: .milliseconds(300))
        return true
    })
    await withTaskGroup(of: Void.self) { gruppe in
        for _ in 0..<8 { gruppe.addTask { _ = try? await b.anfrage(methode: "GET", pfad: "/", zeitlimit: .milliseconds(1500)) } }
    }
    #expect(pruefungen.stand == 1, "alle wartenden Starts teilen sich EINE Prüfung")
    #expect(starts(log).count == 1, "und einen Prozess")
    await b.beende()
}

@Test func nachAbsturzWirdVorDemNeustartNeuGefragt() async throws {
    let ordner = tempOrdner("Absturz")
    let log = ordner.appendingPathComponent("starts.txt")
    let pruefungen = Zaehler()
    let erlaubt = Schalter(true)
    let b = BrueckenVerbindung(node: protokollierenderNode(in: ordner, log: log), vault: ordner, kern: ordner, vorStart: {
        pruefungen.erhoehe()
        return erlaubt.wert
    })
    try await b.starte()
    let alt = try #require(await b.pid)
    // Das Vertrauen entfällt (Code geändert, Freigabe zurückgenommen), dann stürzt die Brücke ab
    erlaubt.wert = false
    kill(alt, SIGKILL)
    await wartebisTot(b)
    await #expect(throws: BrueckenFehler.nichtErlaubt) { _ = try await b.anfrage(methode: "GET", pfad: "/neu") }
    #expect(pruefungen.stand == 2)
    #expect(starts(log).count == 1, "kein zweiter Prozess ohne Erlaubnis")
    #expect(await b.pid == nil)
    // Mit Erlaubnis startet sie wieder
    erlaubt.wert = true
    await #expect(throws: BrueckenFehler.zeitUeberschritten) { _ = try await b.anfrage(methode: "GET", pfad: "/neu", zeitlimit: .milliseconds(300)) }
    #expect(starts(log).count == 2)
    await b.beende()
}

@Test func geschlossenWaehrendDerPruefungStartetNichts() async throws {
    let ordner = tempOrdner("Geschlossen")
    let log = ordner.appendingPathComponent("starts.txt")
    let b = BrueckenVerbindung(node: protokollierenderNode(in: ordner, log: log), vault: ordner, kern: ordner, vorStart: {
        try? await Task.sleep(for: .milliseconds(400))
        return true
    })
    let anfrage = Task { () -> BrueckenFehler? in
        do { _ = try await b.anfrage(methode: "GET", pfad: "/", zeitlimit: .seconds(5)); return nil }
        catch { return error as? BrueckenFehler }
    }
    try await Task.sleep(for: .milliseconds(100)) // die Prüfung läuft
    await b.beende()
    #expect(await anfrage.value == .geschlossen)
    #expect(!FileManager.default.fileExists(atPath: log.path), "ein Fenster, das zu ist, startet keine Brücke mehr")
}

// MARK: Werkstatt nach einem Vault-Wechsel ohne --vault neu starten

@Test func nachVaultWechselStartetDieWerkstattOhneVaultArgument() async throws {
    let ordner = tempOrdner("Werkstatt Neustart")
    let support = ordner.appendingPathComponent("support", isDirectory: true)
    let vault = ordner.appendingPathComponent("Alter Vault", isDirectory: true)
    for u in [support, vault] { try FileManager.default.createDirectory(at: u, withIntermediateDirectories: true) }
    let log = ordner.appendingPathComponent("starts.txt")
    let werkstatt = URL(fileURLWithPath: "/App/Contents/Resources/werkstatt/werkstatt.mjs")
    let b = BrueckenVerbindung(node: protokollierenderNode(in: ordner, log: log), vault: vault, skript: werkstatt,
                               umgebung: ["BRAIN_APP_SUPPORT": support.path], arbeitsordner: support)
    try await b.starte()
    // Erster Start: wie mit `--vault`
    #expect(starts(log) == [["arg:\(werkstatt.path)", "arg:\(vault.path)", "vault:\(vault.path)"]])
    // Die Oberfläche wechselt den Vault (`vault-gewechselt`) → die App vergisst das Argument; der laufende Prozess bleibt
    await b.ohneVaultArgument()
    #expect(await b.laeuft)
    let alt = try #require(await b.pid)
    kill(alt, SIGKILL)
    await wartebisTot(b)
    try await b.starte()
    // Neustart nach dem Absturz: ohne Vault-Argument und ohne BRAIN_VAULT (die Werkstatt liest vaults.json)
    #expect(starts(log).count == 2)
    #expect(starts(log).last == ["arg:\(werkstatt.path)", "vault:unset"])
    await b.beende()
}

@Test func ohneVaultArgumentLaesstDieKernBrueckeUnberuehrt() async throws {
    // Die Kern-Brücke gehört zu ihrem Vault; ohne Vault gäbe es nichts zu starten.
    let ordner = tempOrdner("Kern Neustart")
    let kern = ordner.appendingPathComponent("bin/kern", isDirectory: true)
    let log = ordner.appendingPathComponent("starts.txt")
    let b = BrueckenVerbindung(node: protokollierenderNode(in: ordner, log: log), vault: ordner, kern: kern)
    try await b.starte()
    await b.ohneVaultArgument()
    let alt = try #require(await b.pid)
    kill(alt, SIGKILL)
    await wartebisTot(b)
    try await b.starte()
    let bloecke = starts(log)
    #expect(bloecke.count == 2)
    #expect(bloecke.last == ["arg:\(BrueckenVerbindung.kernSkript(kern: kern).path)", "arg:--vault", "arg:\(ordner.path)", "vault:\(ordner.path)"])
    await b.beende()
}
