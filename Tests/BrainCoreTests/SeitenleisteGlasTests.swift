import Foundation
import Testing
@testable import BrainCore

@Test func seitenleisteGlasLiestEinstellungMitStandardAn() throws {
    let o = FileManager.default.temporaryDirectory.appendingPathComponent("glas-lesen-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: o, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: o) }
    #expect(SeitenleisteGlas.lies(supportOrdner: o) == true, "Datei fehlt")
    let datei = o.appendingPathComponent("einstellungen.json")
    try Data(#"{"seitenleisteDurchscheinend":false}"#.utf8).write(to: datei)
    #expect(SeitenleisteGlas.lies(supportOrdner: o) == false)
    try Data(#"{"seitenleisteDurchscheinend":true}"#.utf8).write(to: datei)
    #expect(SeitenleisteGlas.lies(supportOrdner: o) == true)
    try Data(#"{"seitenleisteDurchscheinend":0}"#.utf8).write(to: datei)
    #expect(SeitenleisteGlas.lies(supportOrdner: o) == true, "Zahl ist kein Boolean")
    try Data("{kaputt".utf8).write(to: datei)
    #expect(SeitenleisteGlas.lies(supportOrdner: o) == true, "kaputt")
}

@Test func fensterDurchscheinendNurImStudioUndNurMitBoolean() {
    for b in [true, false] {
        #expect(AppAktion.pruefe(["aktion": "fenster-durchscheinend", "wert": b], vault: nil, oberflaeche: .studio) == .fensterDurchscheinend(b))
        #expect(AppAktion.pruefe(["aktion": "fenster-durchscheinend", "wert": b], vault: nil, oberflaeche: .app) == nil)
        #expect(AppAktion.pruefe(["aktion": "fenster-durchscheinend", "wert": b], vault: nil) == nil)
    }
    for ungueltig: Any in ["true", "", 1, 0, ["a": 1]] {
        #expect(AppAktion.pruefe(["aktion": "fenster-durchscheinend", "wert": ungueltig], vault: nil, oberflaeche: .studio) == nil)
    }
    #expect(AppAktion.pruefe(["aktion": "fenster-durchscheinend"], vault: nil, oberflaeche: .studio) == nil)
}
