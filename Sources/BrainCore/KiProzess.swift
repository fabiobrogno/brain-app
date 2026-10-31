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

/// Startet ein Programm mit fester Umgebung, stdin = /dev/null, Zeitlimit und begrenzter Ausgabe. Das Kind läuft in einer EIGENEN Prozessgruppe
/// (`posix_spawn` mit `POSIX_SPAWN_SETPGROUP`): bei Zeitüberschreitung wird die ganze Gruppe beendet (SIGTERM, nach kurzer Frist SIGKILL), auch
/// ein Kind, das selbst Kinder startet und hängt (z. B. ein Shim mit `sleep`). Nie ein anderer Prozess: die Gruppe besteht nur aus dem, was das Kind startet.
enum KiProzess {
    static func laufe(programm: String, argumente: [String], umgebung: [String: String], zeitlimit: Duration,
                      maxByte: Int, stderrEinmischen: Bool) async -> KiProzessErgebnis {
        var rohe: [Int32] = [0, 0]
        guard pipe(&rohe) == 0 else { return .startfehler("pipe") }
        let lesen = rohe[0], schreiben = rohe[1]
        let leer = open("/dev/null", O_RDWR)
        defer { if leer >= 0 { close(leer) } }

        #if canImport(Darwin)
        var aktionen: posix_spawn_file_actions_t? = nil
        #else
        var aktionen = posix_spawn_file_actions_t()
        #endif
        posix_spawn_file_actions_init(&aktionen)
        defer { posix_spawn_file_actions_destroy(&aktionen) }
        posix_spawn_file_actions_adddup2(&aktionen, leer, 0)
        posix_spawn_file_actions_adddup2(&aktionen, schreiben, 1)
        posix_spawn_file_actions_adddup2(&aktionen, stderrEinmischen ? schreiben : leer, 2)
        posix_spawn_file_actions_addclose(&aktionen, lesen)
        posix_spawn_file_actions_addclose(&aktionen, schreiben)

        #if canImport(Darwin)
        var attr: posix_spawnattr_t? = nil
        #else
        var attr = posix_spawnattr_t()
        #endif
        posix_spawnattr_init(&attr)
        defer { posix_spawnattr_destroy(&attr) }
        posix_spawnattr_setflags(&attr, Int16(POSIX_SPAWN_SETPGROUP))
        posix_spawnattr_setpgroup(&attr, 0) // 0 = eigene Gruppe mit der PID des Kindes

        let argv: [UnsafeMutablePointer<CChar>?] = ([programm] + argumente).map { strdup($0) } + [nil]
        let envp: [UnsafeMutablePointer<CChar>?] = umgebung.map { strdup("\($0.key)=\($0.value)") } + [nil]
        defer { for z in argv { free(z) }; for z in envp { free(z) } }

        var pid: pid_t = 0
        let rc = posix_spawn(&pid, programm, &aktionen, &attr, argv, envp)
        close(schreiben) // das Kind hält sein Ende; ohne unseres sieht der Leser das Ende, sobald alle Kinder zu sind
        guard rc == 0 else {
            close(lesen)
            return .startfehler(String(cString: strerror(rc)))
        }
        let sammler = KiKappSammler(FileHandle(fileDescriptor: lesen, closeOnDealloc: true), maximum: maxByte)

        var status: Int32 = 0
        func fertig() -> Bool { waitpid(pid, &status, WNOHANG) == pid }
        let ende = ContinuousClock.now + zeitlimit
        while !fertig() {
            if ContinuousClock.now >= ende {
                kill(-pid, SIGTERM)
                let frist = ContinuousClock.now + .milliseconds(500)
                var weg = false
                while !weg && ContinuousClock.now < frist { weg = fertig(); if !weg { try? await Task.sleep(for: .milliseconds(10)) } }
                kill(-pid, SIGKILL) // auch Enkel, die SIGTERM überstanden haben
                if !weg { _ = waitpid(pid, &status, 0) }
                sammler.stopp()
                return .zeitlimit
            }
            try? await Task.sleep(for: .milliseconds(10))
        }
        // Rest der Pipe bis zum Ende lesen, höchstens 1 s (Enkelprozesse können sie offen halten).
        let nachlauf = ContinuousClock.now + .seconds(1)
        while !sammler.fertig && ContinuousClock.now < nachlauf { try? await Task.sleep(for: .milliseconds(10)) }
        sammler.stopp()
        let code: Int32 = (status & 0x7f) == 0 ? (status >> 8) & 0xff : 128 + (status & 0x7f)
        return .beendet(code: code, ausgabe: sammler.wert)
    }
}
