import Testing
import Foundation
@testable import BrainCore

private func brain(_ name: String = "brain", in home: URL) -> URL {
    let v = home.appendingPathComponent(name)
    try! FileManager.default.createDirectory(at: v.appendingPathComponent(".tools"), withIntermediateDirectories: true)
    try! "// stub".write(to: v.appendingPathComponent(".tools/brain.mjs"), atomically: true, encoding: .utf8)
    return v
}

@Test func pruefungErkenntBrainFehlendUndFremd() {
    let home = tempOrdner()
    #expect(VaultAuswahl.pruefe(brain("Mein Brän", in: home)) == .ok)
    #expect(VaultAuswahl.pruefe(home.appendingPathComponent("weg")) == .fehlt)
    #expect(VaultAuswahl.pruefe(home) == .keinBrain)
}

@Test func verschobenerOrdnerGiltAlsFehlend() throws {
    let home = tempOrdner()
    let v = brain(in: home)
    try FileManager.default.moveItem(at: v, to: home.appendingPathComponent("anderswo"))
    #expect(VaultAuswahl.pruefe(v) == .fehlt)
    #expect(VaultAuswahl.meldung(.fehlt) == "Brain-Ordner nicht gefunden")
}

@Test func vorschlagNimmtZuerstTildeBrain() {
    let home = tempOrdner()
    #expect(VaultAuswahl.vorschlag(home: home) == nil)
    let docs = brain("Documents/Brain", in: home)
    #expect(VaultAuswahl.vorschlag(home: home) == docs)
    let tilde = brain("brain", in: home)
    #expect(VaultAuswahl.vorschlag(home: home) == tilde)
}

@Test func einstellungenUeberlebenNeustartUndKaputteDatei() throws {
    let p = AppPfade(basis: tempOrdner())
    #expect(AppEinstellungen.lade(p) == AppEinstellungen())
    try AppEinstellungen(vault: "/Users/x/Mein Brain").speichere(p)
    #expect(AppEinstellungen.lade(p).vault == "/Users/x/Mein Brain")
    try "{ kaputt".write(to: p.konfiguration, atomically: true, encoding: .utf8)
    #expect(AppEinstellungen.lade(p) == AppEinstellungen())
}

@Test func startArgumenteWerdenGelesen() {
    let a = StartArgumente.lies(["BrainApp", "--vault", "/tmp/Test Brain", "--test-fenster",
                                 "--test-fenster-schliessen-nach", "10", "--test-beenden-nach", "40", "-NSIrgendwas", "YES"])
    #expect(a.vault == URL(fileURLWithPath: "/tmp/Test Brain"))
    #expect(a.fensterOeffnen)
    #expect(a.schliessenNach == .seconds(10))
    #expect(a.beendenNach == .seconds(40))
}

@Test func startArgumenteOhneWertOderMitUnsinn() {
    let a = StartArgumente.lies(["BrainApp", "--test-beenden-nach", "abc", "--vault"])
    #expect(a == StartArgumente())
}
