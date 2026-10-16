import Testing
import Foundation
@testable import BrainCore

@Test func schreibtZeilenMitZeitstempelUndOhneZeilenumbruch() throws {
    let p = AppPfade(basis: tempOrdner())
    let log = AppLog(pfade: p)
    log.schreibe("fenster-bereit\nzweite")
    let text = try String(contentsOf: p.logs.appendingPathComponent("app.log"), encoding: .utf8)
    #expect(text.hasSuffix("fenster-bereit zweite\n"))
    #expect(text.split(separator: "\n").count == 1)
}

@Test func rotiertUndBehaeltHoechstensMaxDateien() throws {
    let p = AppPfade(basis: tempOrdner())
    let log = AppLog(pfade: p, maxBytes: 100, maxDateien: 3)
    for i in 0..<40 { log.schreibe("zeile \(i) mit etwas Text") }
    let namen = try FileManager.default.contentsOfDirectory(atPath: p.logs.path).filter { $0.hasPrefix("app.log") }
    #expect(Set(namen).isSubset(of: ["app.log", "app.log.1", "app.log.2"]))
    #expect(namen.contains("app.log.1"))
}
