import Foundation

public struct BefehlErgebnis: Sendable, Equatable {
    public let code: Int32
    public let ausgabe: String
    public let fehler: String
}

public enum BefehlFehler: Error, Equatable {
    case zeitUeberschritten
    case startFehlgeschlagen(String)
}

/// Sammelt eine Pipe ohne blockierendes Lesen (readabilityHandler) — kein Pipe-Stau, kein Hängen, wenn
/// Enkelprozesse die Pipe noch offen halten.
final class PipeSammler: @unchecked Sendable {
    private var daten = Data()
    private var ende = false
    private let sperre = NSLock()
    private let handle: FileHandle

    init(_ handle: FileHandle) {
        self.handle = handle
        handle.readabilityHandler = { [weak self] h in
            let d = h.availableData
            guard let self else { return }
            self.sperre.lock(); defer { self.sperre.unlock() }
            if d.isEmpty { self.ende = true; h.readabilityHandler = nil } else { self.daten.append(d) }
        }
    }
    var fertig: Bool { sperre.lock(); defer { sperre.unlock() }; return ende }
    var wert: Data { sperre.lock(); defer { sperre.unlock() }; return daten }
    func stopp() { handle.readabilityHandler = nil }
}

/// Startet ein Programm, sammelt stdout/stderr und bricht nach dem Zeitlimit ab (App-Spec Review-Fokus 5).
public enum ProzessLauf {
    public static func starte(_ programm: URL, _ argumente: [String], umgebung: [String: String]? = nil,
                              ordner: URL? = nil, zeitlimit: Duration = .seconds(20)) async throws -> BefehlErgebnis {
        let p = Process()
        p.executableURL = programm
        p.arguments = argumente
        if let umgebung { p.environment = umgebung }
        if let ordner { p.currentDirectoryURL = ordner }
        let aus = Pipe(), err = Pipe()
        p.standardOutput = aus
        p.standardError = err
        p.standardInput = FileHandle.nullDevice
        let ausS = PipeSammler(aus.fileHandleForReading)
        let errS = PipeSammler(err.fileHandleForReading)
        do { try p.run() } catch {
            ausS.stopp(); errS.stopp()
            throw BefehlFehler.startFehlgeschlagen(error.localizedDescription)
        }
        let ende = ContinuousClock.now + zeitlimit
        while p.isRunning {
            if ContinuousClock.now >= ende {
                p.terminate()
                ausS.stopp(); errS.stopp()
                throw BefehlFehler.zeitUeberschritten
            }
            try? await Task.sleep(for: .milliseconds(20))
        }
        // Prozess ist fertig: Rest der Pipes bis zum Ende lesen, höchstens 1 s (Enkelprozesse).
        let nachlauf = ContinuousClock.now + .seconds(1)
        while !(ausS.fertig && errS.fertig) && ContinuousClock.now < nachlauf {
            try? await Task.sleep(for: .milliseconds(10))
        }
        ausS.stopp(); errS.stopp()
        return BefehlErgebnis(code: p.terminationStatus,
                              ausgabe: String(decoding: ausS.wert, as: UTF8.self),
                              fehler: String(decoding: errS.wert, as: UTF8.self))
    }
}
