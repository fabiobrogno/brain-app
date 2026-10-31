import Foundation

/// Ausgang eines kurzen Hilfsprozesses (Versionsabfrage, Login-Shell, Anmeldestatus).
enum KiProzessErgebnis: Equatable, Sendable {
    /// `ausgabe` ist auf `maxByte` begrenzt (der Rest wird gelesen und verworfen, nie gesammelt).
    case beendet(code: Int32, ausgabe: Data)
    case zeitlimit
    case startfehler(String)
}

/// Sammelt eine Pipe, behält aber höchstens `maximum` Byte; der Rest wird gelesen (damit das Kind nicht an einer vollen Pipe hängt)
/// und verworfen.
final class KiKappSammler: @unchecked Sendable {
    private var daten = Data()
    private var ende = false
    private let sperre = NSLock()
    private let handle: FileHandle
    private let maximum: Int

    init(_ handle: FileHandle, maximum: Int) {
        self.handle = handle
        self.maximum = maximum
        handle.readabilityHandler = { [weak self] h in
            let d = h.availableData
            guard let self else { return }
            self.sperre.lock(); defer { self.sperre.unlock() }
            if d.isEmpty {
                self.ende = true
                h.readabilityHandler = nil
            } else if self.daten.count < self.maximum {
                self.daten.append(d.prefix(self.maximum - self.daten.count))
            }
        }
    }
    var fertig: Bool { sperre.lock(); defer { sperre.unlock() }; return ende }
    var wert: Data { sperre.lock(); defer { sperre.unlock() }; return daten }
    func stopp() { handle.readabilityHandler = nil }
}

/// Startet ein Programm mit fester Umgebung, stdin = /dev/null, Zeitlimit und begrenzter Ausgabe. Bei Zeitüberschreitung wird das
/// Kind beendet (SIGTERM, nach kurzer Frist SIGKILL) — nie ein anderer Prozess.
enum KiProzess {
    static func laufe(programm: String, argumente: [String], umgebung: [String: String], zeitlimit: Duration,
                      maxByte: Int, stderrEinmischen: Bool) async -> KiProzessErgebnis {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: programm)
        p.arguments = argumente
        p.environment = umgebung
        p.standardInput = FileHandle.nullDevice
        let aus = Pipe()
        p.standardOutput = aus
        if stderrEinmischen { p.standardError = aus } else { p.standardError = FileHandle.nullDevice }
        let sammler = KiKappSammler(aus.fileHandleForReading, maximum: maxByte)
        do { try p.run() } catch {
            sammler.stopp()
            return .startfehler(error.localizedDescription)
        }
        let ende = ContinuousClock.now + zeitlimit
        while p.isRunning {
            if ContinuousClock.now >= ende {
                p.terminate()
                let frist = ContinuousClock.now + .milliseconds(500)
                while p.isRunning && ContinuousClock.now < frist { try? await Task.sleep(for: .milliseconds(10)) }
                if p.isRunning { kill(p.processIdentifier, SIGKILL) }
                sammler.stopp()
                return .zeitlimit
            }
            try? await Task.sleep(for: .milliseconds(10))
        }
        // Rest der Pipe bis zum Ende lesen, höchstens 1 s (Enkelprozesse können sie offen halten).
        let nachlauf = ContinuousClock.now + .seconds(1)
        while !sammler.fertig && ContinuousClock.now < nachlauf { try? await Task.sleep(for: .milliseconds(10)) }
        sammler.stopp()
        return .beendet(code: p.terminationStatus, ausgabe: sammler.wert)
    }
}
