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
    #expect((try? FileManager.default.destinationOfSymbolicLink(atPath: alt.path)) == "Kortex") // statt des Ordners: Rückwärts-Link
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

@Test func leererNeuOrdnerStehtDemUmzugNichtImWeg() {
    // z. B. ein früherer Start hat Kortex angelegt, bevor migriert wurde
    let (alt, neu, _) = paar()
    schreibeDatei("alt", in: alt)
    try! FileManager.default.createDirectory(at: neu, withIntermediateDirectories: true)
    #expect(SupportMigration.migriere(alt: alt, neu: neu) == .umbenannt)
    #expect(lies(neu) == "alt")
}

@Test func neuMitInhaltBleibtUnangetastetAuchNurMitVersteckterDatei() {
    let (alt, neu, _) = paar()
    schreibeDatei("alt", in: alt)
    schreibeDatei("x", in: neu, name: ".versteckt")
    #expect(SupportMigration.migriere(alt: alt, neu: neu) == .beideVorhanden)
    #expect(lies(alt) == "alt")
    #expect(lies(neu, name: ".versteckt") == "x")
}

@Test func neuAlsDateiOderSymlinkWirdNichtEntfernt() throws {
    let (alt, neu, eltern) = paar()
    schreibeDatei("alt", in: alt)
    try "datei".write(to: neu, atomically: true, encoding: .utf8)
    #expect(SupportMigration.migriere(alt: alt, neu: neu) == .beideVorhanden)
    try FileManager.default.removeItem(at: neu)
    let leer = eltern.appendingPathComponent("Leer", isDirectory: true)
    try FileManager.default.createDirectory(at: leer, withIntermediateDirectories: true)
    try FileManager.default.createSymbolicLink(at: neu, withDestinationURL: leer) // Symlink auf leeren Ordner: nicht anfassen
    #expect(SupportMigration.migriere(alt: alt, neu: neu) == .beideVorhanden)
    #expect(lies(alt) == "alt")
}

@Test func nachDemUmzugGibtEsEinenRelativenRueckwaertsLink() throws {
    // alte Pfade (MCP-Einträge: …/Brain/node/<ver>/bin/node) laufen weiter
    let (alt, neu, _) = paar()
    schreibeDatei("echo hi", in: alt.appendingPathComponent("node/v1/bin"), name: "node")
    #expect(SupportMigration.migriere(alt: alt, neu: neu) == .umbenannt)
    #expect(try FileManager.default.destinationOfSymbolicLink(atPath: alt.path) == "Kortex") // relativ
    #expect(lies(alt.appendingPathComponent("node/v1/bin"), name: "node") == "echo hi") // über den alten Pfad erreichbar
    // Der Link bleibt gültig, wenn der Elternordner umbenannt wird
    let eltern2 = alt.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Verschoben", isDirectory: true)
    try FileManager.default.moveItem(at: alt.deletingLastPathComponent(), to: eltern2)
    #expect(lies(eltern2.appendingPathComponent("Brain/node/v1/bin"), name: "node") == "echo hi")
}

@Test func altIstSchonDerRueckwaertsLinkAufNeu() throws {
    let (alt, neu, _) = paar()
    schreibeDatei("x", in: neu)
    try FileManager.default.createSymbolicLink(atPath: alt.path, withDestinationPath: "Kortex") // relativ
    #expect(SupportMigration.migriere(alt: alt, neu: neu) == .nichtNoetig)
    try FileManager.default.removeItem(at: alt)
    try FileManager.default.createSymbolicLink(atPath: alt.path, withDestinationPath: neu.path) // absolut
    #expect(SupportMigration.migriere(alt: alt, neu: neu) == .nichtNoetig)
    #expect(lies(neu) == "x")
}

@Test func haengenderRueckwaertsLinkOhneNeuMachtNichts() throws {
    // Kortex wurde von Hand gelöscht, Brain→Kortex blieb: kein Umbenennen in einen Selbstverweis
    let (alt, neu, _) = paar()
    try FileManager.default.createSymbolicLink(atPath: alt.path, withDestinationPath: "Kortex")
    #expect(SupportMigration.migriere(alt: alt, neu: neu) == .nichtNoetig)
    #expect(!FileManager.default.fileExists(atPath: neu.path))
    #expect((try? FileManager.default.destinationOfSymbolicLink(atPath: alt.path)) == "Kortex")
}

@Test func linkProblemNachDemUmbenennenWirdGemeldet() {
    // Zwischen rename und symlink legt jemand etwas an den alten Namen: umbenannt bleibt gültig, der Link-Fehler wird gemeldet
    let (alt, neu, _) = paar()
    schreibeDatei("alt", in: alt)
    let e = SupportMigration.migriere(alt: alt, neu: neu, umbenennen: { von, nach in
        guard rename(von, nach) == 0 else { return errno }
        try! "dazwischen".write(toFile: von, atomically: true, encoding: .utf8)
        return 0
    })
    guard case .umbenanntOhneLink(let grund) = e else { Issue.record("erwartet .umbenanntOhneLink, war \(e)"); return }
    #expect(!grund.isEmpty)
    #expect(lies(neu) == "alt")
    #expect(e.hinweis(alt: alt, neu: neu)?.contains(grund) == true)
    #expect(e.protokollZeile.contains("FEHLER"))
}

@Test func verlorenesRennenGegenZweiteInstanzIstKeinFehler() {
    // Die andere Instanz benennt zwischen Prüfung und rename um: rename meldet ENOENT, alt ist weg, neu ist da
    let (alt, neu, _) = paar()
    schreibeDatei("alt", in: alt)
    let e = SupportMigration.migriere(alt: alt, neu: neu, umbenennen: { von, nach in
        _ = rename(von, nach) // die „andere Instanz“
        return ENOENT
    })
    #expect(e == .nichtNoetig)
    #expect(lies(neu) == "alt")
}

@Test func enoentMitBleibendemAltIstEinEchterFehler() {
    let (alt, neu, _) = paar()
    schreibeDatei("alt", in: alt)
    let e = SupportMigration.migriere(alt: alt, neu: neu, umbenennen: { _, _ in ENOENT })
    guard case .fehlgeschlagen = e else { Issue.record("erwartet .fehlgeschlagen, war \(e)"); return }
    #expect(lies(alt) == "alt")
}

@Test func beideVorhandenHinweisErscheintNurEinmal() {
    let (alt, neu, _) = paar()
    let merker = neu.appendingPathComponent(".hinweis")
    let e = SupportMigration.Ergebnis.beideVorhanden
    let erster = SupportMigration.anzuzeigenderHinweis(e, alt: alt, neu: neu, merker: merker)
    #expect(erster?.contains(alt.path) == true)
    #expect(FileManager.default.fileExists(atPath: merker.path)) // Merker liegt im neuen Ordner
    #expect(SupportMigration.anzuzeigenderHinweis(e, alt: alt, neu: neu, merker: merker) == nil)
    #expect(SupportMigration.anzuzeigenderHinweis(e, alt: alt, neu: neu, merker: merker) == nil)
    // Fehler erscheinen weiter, solange sie zutreffen; Erfolg bleibt still
    let f = SupportMigration.Ergebnis.fehlgeschlagen("x")
    #expect(SupportMigration.anzuzeigenderHinweis(f, alt: alt, neu: neu, merker: merker) != nil)
    #expect(SupportMigration.anzuzeigenderHinweis(f, alt: alt, neu: neu, merker: merker) != nil)
    #expect(SupportMigration.anzuzeigenderHinweis(.umbenannt, alt: alt, neu: neu, merker: merker) == nil)
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
