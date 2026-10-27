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
    /// Die Vorab-Prüfung vor dem Prozessstart (`vorStart`, Kit-Brücke: Vertrauen in den Vault) hat „nein“ gesagt — es lief nichts an.
    case nichtErlaubt
}

/// Hält den Node-Prozess einer Brücke (Kit: .tools/ansicht/bruecke.mjs oder Werkstatt: werkstatt.mjs) und ordnet Antworten über die id zu
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
    /// Nur für Brücken mit eigenem Skript änderbar (`ohneVaultArgument`): die Kit-Brücke braucht ihren Vault.
    private var vault: URL?
    private let skript: URL?
    private let arbeitsordner: URL?
    private var argumente: [String]
    private let umgebung: [String: String]
    private let vorStart: (@Sendable () async -> Bool)?
    /// Die laufende Vorab-Prüfung: gleichzeitige Starts (die Seite lädt viele Dateien auf einmal) teilen sich EINE Prüfung.
    private var pruefung: Task<Bool, Never>?
    private var prozess: Process?
    private var eingang: FileHandle?
    private var leser: Task<Void, Never>?
    private var geschlossen = false
    /// Zählt Prozessstarts; ersetzt ObjectIdentifier (die Adresse eines freigegebenen Process kann wiederverwendet werden).
    private var generation = 0
    private var naechsteId = 0
    private var wartend: [Int: CheckedContinuation<BrueckenAntwort, Error>] = [:]
    private var zeitwaechter: [Int: Task<Void, Never>] = [:]
    public private(set) var version: String?

    /// Standard ist die Kit-Brücke des Vaults; mit `skript` startet stattdessen dieses Skript (z. B. die Werkstatt).
    /// Beide sprechen dasselbe JSON-Zeilen-Protokoll und bekommen den Vault-Pfad als ersten Argument nach dem Skript.
    /// Ohne `vault` (nur mit `skript`: die Werkstatt vor der Vault-Wahl) gibt es kein Vault-Argument und kein
    /// `BRAIN_VAULT`; die Werkstatt liest dann `<support>/vaults.json`. `arbeitsordner` ist dann das Arbeitsverzeichnis.
    /// `vorStart` läuft vor JEDEM Prozessstart (auch nach einem Absturz) und muss `true` liefern, sonst startet nichts und die
    /// Anfrage scheitert mit `.nichtErlaubt` — so läuft Kit-Code aus dem Vault nur mit Vertrauen (Studio-v2-Spec §8).
    public init(node: URL, vault: URL?, skript: URL? = nil, umgebung: [String: String] = [:], arbeitsordner: URL? = nil,
                vorStart: (@Sendable () async -> Bool)? = nil) {
        self.node = node
        self.vault = vault
        self.skript = skript
        self.arbeitsordner = arbeitsordner
        self.argumente = Self.startArgumente(skript: skript, vault: vault)
        self.umgebung = umgebung
        self.vorStart = vorStart
    }

    /// Pfad der Kit-Brücke (Ansicht „Übersicht“) im Vault.
    public static func kitSkript(vault: URL) -> URL { vault.appendingPathComponent(".tools/ansicht/bruecke.mjs") }

    /// Argumente für Node: `<skript> <vault>`; ohne Skript die Kit-Brücke; ohne Vault nur `<skript>`.
    /// Ohne Skript und ohne Vault gibt es nichts zu starten (leere Liste).
    static func startArgumente(skript: URL?, vault: URL?) -> [String] {
        guard let ziel = skript ?? vault.map({ kitSkript(vault: $0) }) else { return [] }
        return [ziel.path] + (vault.map { [$0.path] } ?? [])
    }

    /// Arbeitsverzeichnis des Prozesses: der Vault, sonst `arbeitsordner` (nur wenn es ihn gibt), sonst das der App.
    private var startOrdner: URL? {
        if let vault { return vault }
        guard let a = arbeitsordner else { return nil }
        var istOrdner: ObjCBool = false
        return FileManager.default.fileExists(atPath: a.path, isDirectory: &istOrdner) && istOrdner.boolValue ? a : nil
    }

    /// Prozess läuft und nimmt Anfragen an (nach `beende()` nicht mehr).
    public var laeuft: Bool { eingang != nil && (prozess?.isRunning ?? false) }
    public var pid: Int32? { laeuft ? prozess?.processIdentifier : nil }
    /// Anzahl der Anfragen, die noch auf eine Antwort warten (für Tests und Diagnose).
    var offeneAnfragen: Int { wartend.count }

    /// Ohne `vorStart` immer ja; sonst genau eine gemeinsame Prüfung für alle gleichzeitig wartenden Starts.
    private func startErlaubt() async -> Bool {
        guard let vorStart else { return true }
        if let laufend = pruefung { return await laufend.value }
        let aufgabe = Task { await vorStart() }
        pruefung = aufgabe
        let ergebnis = await aufgabe.value
        pruefung = nil
        return ergebnis
    }

    /// Ab jetzt ohne Vault-Argument (und ohne `BRAIN_VAULT`) starten — nur für Brücken mit eigenem Skript (die Werkstatt). Wechselt
    /// die Oberfläche den Vault, steht der gewählte in `vaults.json`; ein Neustart nach einem Absturz darf nicht mit dem alten
    /// `--vault` zurückkehren. Der laufende Prozess bleibt unberührt.
    public func ohneVaultArgument() {
        guard skript != nil, vault != nil else { return }
        vault = nil
        argumente = Self.startArgumente(skript: skript, vault: nil)
    }

    public func starte(zeitlimit: Duration = .seconds(15)) async throws {
        if geschlossen { throw BrueckenFehler.geschlossen }
        if laeuft { return }
        guard !argumente.isEmpty else { throw BrueckenFehler.startFehlgeschlagen("Die Ansicht konnte nicht gestartet werden.") }
        // Vor jedem Start fragen, ob der Code laufen darf; währenddessen kann die Brücke geschlossen oder von einem
        // gleichzeitigen Aufruf schon gestartet worden sein.
        guard await startErlaubt() else { throw BrueckenFehler.nichtErlaubt }
        if geschlossen { throw BrueckenFehler.geschlossen }
        if laeuft { return }
        // Alte, noch wartende Anfragen sofort abschließen — sie bekämen von einem neuen Prozess nie eine Antwort.
        verwerfeAlles()
        signal(SIGPIPE, SIG_IGN)
        version = nil
        let p = Process()
        p.executableURL = node
        p.arguments = argumente
        p.environment = NodeUmgebung.fuerKind(vault: vault, vorgaben: umgebung)
        p.currentDirectoryURL = startOrdner
        let ein = Pipe(), aus = Pipe()
        p.standardInput = ein
        p.standardOutput = aus
        p.standardError = FileHandle.nullDevice
        let (strom, fortsetzung) = AsyncStream.makeStream(of: Data.self)
        aus.fileHandleForReading.readabilityHandler = { h in
            let d = h.availableData
            if d.isEmpty { h.readabilityHandler = nil; fortsetzung.finish() } else { fortsetzung.yield(d) }
        }
        generation += 1
        let kennung = generation
        p.terminationHandler = { [weak self] _ in Task { await self?.prozessEnde(kennung) } }
        do { try p.run() } catch {
            aus.fileHandleForReading.readabilityHandler = nil
            fortsetzung.finish()
            throw BrueckenFehler.startFehlgeschlagen("Die Ansicht konnte nicht gestartet werden.")
        }
        prozess = p
        eingang = ein.fileHandleForWriting
        leser = Task { [weak self] in
            // Zeilen bis ~12 MB (8-MB-Körper als base64 + Hülle): nur neu eingetroffene Bytes nach dem Zeilenende absuchen.
            var puffer = Data()
            var gesucht = 0
            for await stueck in strom {
                puffer.append(stueck)
                while let nl = puffer[(puffer.startIndex + gesucht)...].firstIndex(of: 0x0A) {
                    let zeile = Data(puffer[puffer.startIndex..<nl])
                    puffer.removeSubrange(puffer.startIndex...nl)
                    gesucht = 0
                    await self?.verarbeite(zeile)
                }
                gesucht = puffer.count
            }
        }
        let frist = ContinuousClock.now + zeitlimit
        while version == nil {
            // Wurde der Prozess unterdessen ersetzt oder beendet, ist dieser Start gescheitert.
            guard generation == kennung, let aktuell = prozess, aktuell.isRunning, ContinuousClock.now < frist else {
                if generation == kennung, let aktuell = prozess {
                    if aktuell.isRunning { aktuell.terminate() }
                    verwerfeAlles()
                }
                throw BrueckenFehler.startFehlgeschlagen("Die Ansicht startet nicht.")
            }
            try? await Task.sleep(for: .milliseconds(20))
        }
    }

    /// Zeitlimit je Pfad, immer etwas über der Gesamtfrist, die die Werkstatt selbst einhält (Studio-v2-Spec §8): Vault öffnen,
    /// neu anlegen und klonen (`/api/vaults/oeffnen`, `…/neu`, `…/klonen`; Node-Frist je 300 s) 330 s, Remote hinzufügen
    /// (`/api/git/remote`; Node-Gesamtfrist 120 s, darin Historien-Prüfung und erster Push) 150 s, Commit (`/api/git/commit`;
    /// Node-Frist 75 s) 90 s, Git-Abgleich (`/api/git/sync`) 400 s, übrige `/api/git/…` 90 s, alles andere 30 s. Die Zuordnung
    /// gilt für den Pfad ohne Query; die Einzelpfade nur für genau diesen Pfad (auch mit „/“ am Ende), nicht für Unterpfade.
    /// Läuft ein Limit ab, wird die Anfrage nie wiederholt (`darfWiederholen`): ein zweites POST könnte doppelt klonen oder pushen.
    public static func zeitlimit(fuerPfad pfad: String) -> Duration {
        let ohneQuery = pfad.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? pfad
        let p = ohneQuery.lowercased()
        func ist(_ ziel: String) -> Bool { p == ziel || p == ziel + "/" }
        if ist("/api/vaults/oeffnen") || ist("/api/vaults/neu") || ist("/api/vaults/klonen") { return .seconds(330) }
        if ist("/api/git/sync") { return .seconds(400) }
        if ist("/api/git/remote") { return .seconds(150) }
        if ist("/api/git/commit") { return .seconds(90) }
        if p.hasPrefix("/api/git/") { return .seconds(90) }
        return .seconds(30)
    }

    /// Nur lesende Methoden dürfen nach einem Brückenabsturz erneut gesendet werden — ein wiederholtes POST/PUT/DELETE
    /// könnte eine Notiz oder einen Commit doppelt anlegen.
    public static func darfWiederholen(methode: String) -> Bool { ["GET", "HEAD"].contains(methode.uppercased()) }

    /// Fragt an; endet die Anfrage mit `.beendet` (Brücke kurz zuvor abgestürzt), wird bei GET/HEAD GENAU EINMAL neu
    /// angefragt (startet die Brücke neu). Schreibende Methoden nie; der Fehler geht an den Aufrufer.
    public func anfrageMitNeuversuch(methode: String, pfad: String, body: Data? = nil) async throws -> BrueckenAntwort {
        do {
            return try await anfrage(methode: methode, pfad: pfad, body: body)
        } catch BrueckenFehler.beendet where Self.darfWiederholen(methode: methode) {
            return try await anfrage(methode: methode, pfad: pfad, body: body)
        }
    }

    public func anfrage(methode: String, pfad: String, body: Data? = nil, zeitlimit: Duration? = nil) async throws -> BrueckenAntwort {
        let zeitlimit = zeitlimit ?? Self.zeitlimit(fuerPfad: pfad)
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
    private func prozessEnde(_ kennung: Int) async {
        guard prozess != nil, generation == kennung else { return }
        await leser?.value
        guard prozess != nil, generation == kennung else { return }
        verwerfeAlles()
    }
}
