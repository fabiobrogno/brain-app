import Foundation

/// Zeilen-Log unter <basis>/logs/app.log, rotierend (App-Spec §5.3: höchstens 5 × 1 MB). Wirft nie.
public final class AppLog: @unchecked Sendable {
    private let datei: URL
    private let maxBytes: Int
    private let maxDateien: Int
    private let sperre = NSLock()

    public init(pfade: AppPfade, maxBytes: Int = 1_000_000, maxDateien: Int = 5) {
        self.datei = pfade.logs.appendingPathComponent("app.log")
        self.maxBytes = maxBytes
        self.maxDateien = max(2, maxDateien)
    }

    public func schreibe(_ zeile: String, zeit: Date = Date()) {
        sperre.lock(); defer { sperre.unlock() }
        let fm = FileManager.default
        try? fm.createDirectory(at: datei.deletingLastPathComponent(), withIntermediateDirectories: true)
        rotiereFallsNoetig()
        let einzeilig = zeile.replacingOccurrences(of: "\n", with: " ")
        let daten = Data("\(ISO8601DateFormatter().string(from: zeit)) \(einzeilig)\n".utf8)
        if let h = try? FileHandle(forWritingTo: datei) {
            defer { try? h.close() }
            _ = try? h.seekToEnd()
            try? h.write(contentsOf: daten)
        } else {
            try? daten.write(to: datei)
        }
    }

    private func rotiereFallsNoetig() {
        let fm = FileManager.default
        guard let groesse = (try? fm.attributesOfItem(atPath: datei.path))?[.size] as? Int, groesse >= maxBytes else { return }
        let letzte = maxDateien - 1
        try? fm.removeItem(atPath: datei.path + ".\(letzte)")
        if letzte >= 2 {
            for i in stride(from: letzte - 1, through: 1, by: -1) {
                try? fm.moveItem(atPath: datei.path + ".\(i)", toPath: datei.path + ".\(i + 1)")
            }
        }
        try? fm.moveItem(atPath: datei.path, toPath: datei.path + ".1")
    }
}
