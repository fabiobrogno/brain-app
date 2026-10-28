import Testing
import Foundation
@testable import BrainCore

// Alle Tests arbeiten in Temp-Ordnern; der echte ~/Library/Application Support/Brain wird nie angefasst.

private func schreibeDatei(_ inhalt: String, in ordner: URL, name: String = "config.json") {
    try! FileManager.default.createDirectory(at: ordner, withIntermediateDirectories: true)
    try! inhalt.write(to: ordner.appendingPathComponent(name), atomically: true, encoding: .utf8)
}

private func lies(_ ordner: URL, name: String = "config.json") -> String? {
    try? String(contentsOf: ordner.appendingPathComponent(name), encoding: .utf8)
}

private func paar() -> (alt: URL, neu: URL, eltern: URL) {
    let eltern = tempOrdner("Application Support")
    return (eltern.appendingPathComponent("Brain", isDirectory: true), eltern.appendingPathComponent("Kortex", isDirectory: true), eltern)
}

@Test func nurAltVorhandenWirdUmbenannt() {
    let (alt, neu, _) = paar()
    schreibeDatei("{\"a\":1}", in: alt)
    schreibeDatei("log", in: alt.appendingPathComponent("logs"), name: "app.log")
    #expect(SupportMigration.migriere(alt: alt, neu: neu) == .umbenannt)
    #expect(!FileManager.default.fileExists(atPath: alt.path))
    #expect(lies(neu) == "{\"a\":1}")
    #expect(lies(neu.appendingPathComponent("logs"), name: "app.log") == "log")
}

@Test func keinAltNichtNoetig() {
    let (alt, neu, _) = paar()
    #expect(SupportMigration.migriere(alt: alt, neu: neu) == .nichtNoetig)
    #expect(!FileManager.default.fileExists(atPath: neu.path))
}

@Test func nurNeuVorhandenNichtNoetig() {
    let (alt, neu, _) = paar()
    schreibeDatei("neu", in: neu)
    #expect(SupportMigration.migriere(alt: alt, neu: neu) == .nichtNoetig)
    #expect(lies(neu) == "neu")
}

@Test func beideVorhandenNichtsWirdUeberschrieben() {
    let (alt, neu, _) = paar()
    schreibeDatei("alt", in: alt)
    schreibeDatei("neu", in: neu)
    let e = SupportMigration.migriere(alt: alt, neu: neu)
    #expect(e == .beideVorhanden)
    #expect(lies(alt) == "alt")
    #expect(lies(neu) == "neu")
    // sichtbarer Hinweis nennt beide Ordner, Protokollzeile ist gesetzt
    let hinweis = e.hinweis(alt: alt, neu: neu)
    #expect(hinweis?.contains(alt.path) == true && hinweis?.contains(neu.path) == true)
    #expect(e.protokollZeile.contains("beide-vorhanden"))
}

@Test func beideVorhandenAuchWennNeuLeerIst() {
    // rename(2) würde einen leeren Zielordner ersetzen; die Migration darf das nicht
    let (alt, neu, _) = paar()
    schreibeDatei("alt", in: alt)
    try! FileManager.default.createDirectory(at: neu, withIntermediateDirectories: true)
    #expect(SupportMigration.migriere(alt: alt, neu: neu) == .beideVorhanden)
    #expect(lies(alt) == "alt")
    #expect(lies(neu) == nil)
}

@Test func zweiterLaufNachMigrationIstHarmlos() {
    let (alt, neu, _) = paar()
    schreibeDatei("x", in: alt)
    #expect(SupportMigration.migriere(alt: alt, neu: neu) == .umbenannt)
    #expect(SupportMigration.migriere(alt: alt, neu: neu) == .nichtNoetig)
    #expect(lies(neu) == "x")
}

@Test func altAlsSymlinkWirdMitUmbenannt() throws {
    let (alt, neu, eltern) = paar()
    let echt = eltern.appendingPathComponent("Echt", isDirectory: true)
    schreibeDatei("echt", in: echt)
    try FileManager.default.createSymbolicLink(at: alt, withDestinationURL: echt)
    #expect(SupportMigration.migriere(alt: alt, neu: neu) == .umbenannt)
    #expect(lies(neu) == "echt")
    #expect(lies(echt) == "echt")
}

@Test func haengenderSymlinkAlsAltZaehltAlsVorhanden() throws {
    let (alt, neu, _) = paar()
    try FileManager.default.createSymbolicLink(atPath: alt.path, withDestinationPath: "/gibt/es/nicht")
    schreibeDatei("neu", in: neu)
    #expect(SupportMigration.migriere(alt: alt, neu: neu) == .beideVorhanden)
}

@Test func fehlschlagWirdGemeldetUndAltBleibt() {
    let (alt, _, eltern) = paar()
    schreibeDatei("alt", in: alt)
    let neu = eltern.appendingPathComponent("gibtsNicht/Kortex", isDirectory: true) // Elternordner fehlt: rename scheitert
    let e = SupportMigration.migriere(alt: alt, neu: neu)
    guard case .fehlgeschlagen(let grund) = e else { Issue.record("erwartet .fehlgeschlagen, war \(e)"); return }
    #expect(!grund.isEmpty)
    #expect(lies(alt) == "alt")
    #expect(e.hinweis(alt: alt, neu: neu)?.contains(grund) == true)
    #expect(e.protokollZeile.contains("FEHLER"))
}

@Test func erfolgUndNichtNoetigSindStill() {
    let (alt, neu, _) = paar()
    #expect(SupportMigration.Ergebnis.umbenannt.hinweis(alt: alt, neu: neu) == nil)
    #expect(SupportMigration.Ergebnis.nichtNoetig.hinweis(alt: alt, neu: neu) == nil)
}
