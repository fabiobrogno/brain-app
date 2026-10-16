import Foundation

public struct BrueckenAntwort: Sendable, Equatable {
    public let status: Int
    public let headers: [String: String]
    public let body: Data
}

public enum BrueckenFehler: Error, Equatable {
    case startFehlgeschlagen(String)
    case beendet
    /// Die Verbindung wurde bewusst geschlossen (Fenster zu) — kein Neuversuch, kein neuer Prozess.
    case geschlossen
    case zeitUeberschritten
}

/// Hält den Node-Prozess der Ansicht-Brücke (Kit: .tools/ansicht/bruecke.mjs) und ordnet Antworten über die id zu
/// (App-Spec §5.2 Baustein 4). Stirbt die Brücke, scheitern offene Anfragen mit `.beendet`; die nächste Anfrage
/// startet sie neu (Review-Fokus 4) und schließt dabei zuerst alle noch wartenden Anfragen ab, damit keine bis zum
/// Zeitlimit hängt. Schreiben in eine tote Brücke darf die App nie beenden (SIGPIPE aus).
public actor BrueckenVerbindung {
    private struct Roh: Decodable {
        let id: Int?
        let status: Int?
        let headers: [String: String]?
        let body: String?
        let bereit: Bool?
        let version: String?
    }

    /// Intern: Schreiben in die Brücke ist gescheitert (Prozess tot, Prozessende noch nicht gemeldet).
    private struct SchreibFehler: Error {}

    private let node: URL
    private let vault: URL
    private let umgebung: [String: String]
    private var prozess: Process?
    private var eingang: FileHandle?
    private var leser: Task<Void, Never>?
    private var geschlossen = false
    private var naechsteId = 0
    private var wartend: [Int: CheckedContinuation<BrueckenAntwort, Error>] = [:]
    private var zeitwaechter: [Int: Task<Void, Never>] = [:]
    public private(set) var version: String?

    public init(node: URL, vault: URL, umgebung: [String: String] = [:]) {
        self.node = node
        self.vault = vault
        self.umgebung = umgebung
    }

    /// Prozess läuft und nimmt Anfragen an (nach `beende()` nicht mehr).
    public var laeuft: Bool { eingang != nil && (prozess?.isRunning ?? false) }
    public var pid: Int32? { laeuft ? prozess?.processIdentifier : nil }
    /// Anzahl der Anfragen, die noch auf eine Antwort warten (für Tests und Diagnose).
    var offeneAnfragen: Int { wartend.count }

    public func starte(zeitlimit: Duration = .seconds(15)) async throws {
        if geschlossen { throw BrueckenFehler.geschlossen }
        if laeuft { return }
        // Alte, noch wartende Anfragen sofort abschließen — sie bekämen von einem neuen Prozess nie eine Antwort.
        verwerfeAlles()
        signal(SIGPIPE, SIG_IGN)
        version = nil
        let p = Process()
        p.executableURL = node
        p.arguments = [vault.appendingPathComponent(".tools/ansicht/bruecke.mjs").path, vault.path]
        var env = ProcessInfo.processInfo.environment
        env["BRAIN_VAULT"] = vault.path
        for (k, v) in umgebung { env[k] = v }
        env["PATH"] = BrainBefehl.pfadMitStandardOrdnern(env["PATH"])
        p.environment = env
        p.currentDirectoryURL = vault
        let ein = Pipe(), aus = Pipe()
        p.standardInput = ein
        p.standardOutput = aus
        p.standardError = FileHandle.nullDevice
        let (strom, fortsetzung) = AsyncStream.makeStream(of: Data.self)
        aus.fileHandleForReading.readabilityHandler = { h in
            let d = h.availableData
            if d.isEmpty { h.readabilityHandler = nil; fortsetzung.finish() } else { fortsetzung.yield(d) }
        }
        let kennung = ObjectIdentifier(p)
        p.terminationHandler = { [weak self] _ in Task { await self?.prozessEnde(kennung) } }
        do { try p.run() } catch {
            aus.fileHandleForReading.readabilityHandler = nil
            fortsetzung.finish()
            throw BrueckenFehler.startFehlgeschlagen("Die Ansicht konnte nicht gestartet werden.")
        }
        prozess = p
        eingang = ein.fileHandleForWriting
        leser = Task { [weak self] in
            var puffer = Data()
            for await stueck in strom {
                puffer.append(stueck)
                while let nl = puffer.firstIndex(of: 0x0A) {
                    let zeile = Data(puffer[puffer.startIndex..<nl])
                    puffer.removeSubrange(puffer.startIndex...nl)
                    await self?.verarbeite(zeile)
                }
            }
        }
        let frist = ContinuousClock.now + zeitlimit
        while version == nil {
            // Wurde der Prozess unterdessen ersetzt oder beendet, ist dieser Start gescheitert.
            guard let aktuell = prozess, ObjectIdentifier(aktuell) == kennung, aktuell.isRunning, ContinuousClock.now < frist else {
                if let aktuell = prozess, ObjectIdentifier(aktuell) == kennung {
                    if aktuell.isRunning { aktuell.terminate() }
                    verwerfeAlles()
                }
                throw BrueckenFehler.startFehlgeschlagen("Die Ansicht startet nicht.")
            }
            try? await Task.sleep(for: .milliseconds(20))
        }
    }

    public func anfrage(methode: String, pfad: String, body: Data? = nil, zeitlimit: Duration = .seconds(30)) async throws -> BrueckenAntwort {
        // Zweiter Versuch nur, wenn das Schreiben in eine (noch nicht als tot gemeldete) Brücke scheitert.
        for versuch in 0..<2 {
            if geschlossen { throw BrueckenFehler.geschlossen }
            if !laeuft { try await starte() }
            guard let eingang else { throw geschlossen ? BrueckenFehler.geschlossen : BrueckenFehler.beendet }
            naechsteId += 1
            let id = naechsteId
            let objekt: [String: Any] = ["id": id, "methode": methode, "pfad": pfad,
                                         "body": body.map { $0.base64EncodedString() } ?? NSNull()]
            let zeile = try JSONSerialization.data(withJSONObject: objekt) + Data([0x0A])
            do {
                return try await withCheckedThrowingContinuation { (fortsetzung: CheckedContinuation<BrueckenAntwort, Error>) in
                    wartend[id] = fortsetzung
                    do { try eingang.write(contentsOf: zeile) } catch {
                        wartend.removeValue(forKey: id)?.resume(throwing: SchreibFehler())
                        return
                    }
                    zeitwaechter[id] = Task { [weak self] in
                        try? await Task.sleep(for: zeitlimit)
                        if Task.isCancelled { return }
                        await self?.abgelaufen(id)
                    }
                }
            } catch is SchreibFehler {
                verwerfeAlles()
                if versuch == 1 { throw BrueckenFehler.beendet }
            }
        }
        throw BrueckenFehler.beendet
    }

    /// Schließt die Verbindung endgültig: wartende und spätere Anfragen scheitern mit `.geschlossen`, es startet
    /// nie wieder ein Prozess. Ein neues Fenster legt eine neue Verbindung an.
    public func beende() {
        geschlossen = true
        for id in Array(wartend.keys) { schliesse(id, .failure(BrueckenFehler.geschlossen)) }
        try? eingang?.close() // stdin zu → die Brücke beendet sich selbst, nachdem alles geschrieben ist
        eingang = nil
        if let p = prozess {
            Task {
                try? await Task.sleep(for: .seconds(2))
                if p.isRunning { p.terminate() }
            }
        }
    }

    private func verarbeite(_ zeile: Data) {
        guard let r = try? JSONDecoder().decode(Roh.self, from: zeile) else { return }
        if r.bereit == true { version = r.version ?? "?"; return }
        guard let id = r.id else { return }
        schliesse(id, .success(BrueckenAntwort(status: r.status ?? 500, headers: r.headers ?? [:],
                                               body: Data(base64Encoded: r.body ?? "") ?? Data())))
    }

    private func abgelaufen(_ id: Int) {
        schliesse(id, .failure(BrueckenFehler.zeitUeberschritten))
    }

    /// Schließt eine wartende Anfrage genau einmal ab und stoppt ihren Zeitwächter.
    private func schliesse(_ id: Int, _ ergebnis: Result<BrueckenAntwort, Error>) {
        zeitwaechter.removeValue(forKey: id)?.cancel()
        wartend.removeValue(forKey: id)?.resume(with: ergebnis)
    }

    /// Verwirft den aktuellen Prozess samt Leser und schließt alle wartenden Anfragen mit `.beendet` ab.
    private func verwerfeAlles() {
        leser?.cancel()
        leser = nil
        try? eingang?.close()
        eingang = nil
        prozess = nil
        for id in Array(wartend.keys) { schliesse(id, .failure(BrueckenFehler.beendet)) }
    }

    /// Ende eines Brücken-Prozesses. Erst alle noch gelesenen Antworten zustellen, dann den Rest scheitern lassen.
    /// Gehört das Ende zu einem älteren Prozess (schon neu gestartet), wird es ignoriert.
    private func prozessEnde(_ kennung: ObjectIdentifier) async {
        guard let p = prozess, ObjectIdentifier(p) == kennung else { return }
        await leser?.value
        guard let jetzt = prozess, ObjectIdentifier(jetzt) == kennung else { return }
        verwerfeAlles()
    }
}
