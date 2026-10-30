import Testing
import Foundation
@testable import BrainCore

/// Ein Vault ist ein Ordner mit `brain.config.json` (wie `pruefeVault` im Kern); `mitTools` legt zusätzlich ein altes `.tools` an.
private func brain(_ name: String = "brain", in home: URL, mitTools: Bool = false) -> URL {
    let v = home.appendingPathComponent(name)
    try! FileManager.default.createDirectory(at: v, withIntermediateDirectories: true)
    try! "{}".write(to: v.appendingPathComponent("brain.config.json"), atomically: true, encoding: .utf8)
    if mitTools {
        try! FileManager.default.createDirectory(at: v.appendingPathComponent(".tools"), withIntermediateDirectories: true)
        try! "// stub".write(to: v.appendingPathComponent(".tools/brain.mjs"), atomically: true, encoding: .utf8)
    }
    return v
}

@Test func pruefungErkenntBrainFehlendUndFremd() {
    let home = tempOrdner()
    #expect(VaultAuswahl.pruefe(brain("Mein Brän", in: home)) == .ok)
    #expect(VaultAuswahl.pruefe(home.appendingPathComponent("weg")) == .fehlt)
    #expect(VaultAuswahl.pruefe(home) == .keinBrain)
}

@Test func vaultErkenntmanAnBrainConfigNichtAnTools() throws {
    let home = tempOrdner()
    // altes .tools/ ohne brain.config.json: kein Vault (der Kern verlangt die Marke)
    let nurTools = home.appendingPathComponent("nur-tools")
    try FileManager.default.createDirectory(at: nurTools.appendingPathComponent(".tools"), withIntermediateDirectories: true)
    try "// stub".write(to: nurTools.appendingPathComponent(".tools/brain.mjs"), atomically: true, encoding: .utf8)
    #expect(VaultAuswahl.pruefe(nurTools) == .keinBrain)
    #expect(VaultAuswahl.meldung(.keinBrain)?.contains("brain.config.json") == true)
    // neuer Vault ohne .tools: ok
    #expect(VaultAuswahl.pruefe(brain("neu", in: home)) == .ok)
    // alter Vault mit .tools UND brain.config.json: weiterhin ok (das .tools wird nur nicht mehr ausgeführt)
    #expect(VaultAuswahl.pruefe(brain("alt", in: home, mitTools: true)) == .ok)
    // brain.config.json als Ordner zählt nicht
    let falsch = home.appendingPathComponent("falsch")
    try FileManager.default.createDirectory(at: falsch.appendingPathComponent("brain.config.json"), withIntermediateDirectories: true)
    #expect(VaultAuswahl.pruefe(falsch) == .keinBrain)
}

@Test func verschobenerOrdnerGiltAlsFehlend() throws {
    let home = tempOrdner()
    let v = brain(in: home)
    try FileManager.default.moveItem(at: v, to: home.appendingPathComponent("anderswo"))
    #expect(VaultAuswahl.pruefe(v) == .fehlt)
    #expect(VaultAuswahl.meldung(.fehlt) == "Vault-Ordner nicht gefunden")
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
