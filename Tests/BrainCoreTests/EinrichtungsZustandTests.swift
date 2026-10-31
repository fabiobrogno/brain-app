import Testing
import Foundation
@testable import BrainCore

// MARK: Speicher

@Test func speicherSchreibtUndLiestDieDatei() throws {
    let ordner = tempOrdner()
    let s = EinrichtungsSpeicher(pfade: AppPfade(basis: ordner))
    #expect(s.lade() == nil)
    let d = EinrichtungsDatei(abgeschlossen: true, automatischAus: false, erledigt: ["ki"], uebersprungen: ["github"])
    try s.speichere(d)
    #expect(s.lade() == d)
    #expect(s.datei.lastPathComponent == "einrichtung.json")
}

@Test func speicherLegtFehlendenOrdnerAn() throws {
    let s = EinrichtungsSpeicher(datei: tempOrdner().appendingPathComponent("neu/tief/einrichtung.json"))
    try s.speichere(EinrichtungsDatei())
    #expect(s.lade() == EinrichtungsDatei())
}

@Test func kaputteDateiGiltAlsNochNieGelaufen() throws {
    let ordner = tempOrdner()
    let s = EinrichtungsSpeicher(pfade: AppPfade(basis: ordner))
    try "{kaputt".write(to: s.datei, atomically: true, encoding: .utf8)
    #expect(s.lade() == nil)
}

// MARK: Erscheint der Assistent von selbst?

@Test func ersterStartOhneVaultZeigtDenAssistenten() {
    let s = EinrichtungsSpeicher(pfade: AppPfade(basis: tempOrdner()))
    #expect(s.sollErscheinen(hatVault: false))
}

@Test func ersterStartMitBestehendemVaultLaesstBestandsnutzerInRuhe() {
    let s = EinrichtungsSpeicher(pfade: AppPfade(basis: tempOrdner()))
    #expect(!s.sollErscheinen(hatVault: true))
}

@Test func abgebrochenerAssistentErscheintWiederAuchMitVault() throws {
    // z. B. Vault ist schon angelegt, die KI-Verbindung fehlt noch
    let s = EinrichtungsSpeicher(pfade: AppPfade(basis: tempOrdner()))
    try s.speichere(EinrichtungsDatei(abgeschlossen: false))
    #expect(s.sollErscheinen(hatVault: true))
    #expect(s.sollErscheinen(hatVault: false))
}

@Test func abgebrochenerMenuLaufErscheintNurOhneVaultWieder() throws {
    let s = EinrichtungsSpeicher(pfade: AppPfade(basis: tempOrdner()))
    try s.speichere(EinrichtungsDatei(abgeschlossen: false, herkunft: .menue))
    #expect(!s.sollErscheinen(hatVault: true))
    #expect(s.sollErscheinen(hatVault: false))
    try s.speichere(EinrichtungsDatei(abgeschlossen: false, herkunft: .start))
    #expect(s.sollErscheinen(hatVault: true))
}

@Test func dateiOhneNeueFelderBleibtLesbar() throws {
    // Datei aus einer früheren Fassung: ohne „herkunft“, ohne „version“
    let s = EinrichtungsSpeicher(pfade: AppPfade(basis: tempOrdner()))
    try #"{"abgeschlossen":false,"automatischAus":false,"erledigt":["ki"],"uebersprungen":[]}"#.write(to: s.datei, atomically: true, encoding: .utf8)
    let d = try #require(s.lade())
    #expect(d.herkunft == .start && d.erledigt == ["ki"] && d.version == 1)
    try #"{"herkunft":"irgendwas","abgeschlossen":true}"#.write(to: s.datei, atomically: true, encoding: .utf8)
    #expect(s.lade()?.herkunft == .start && s.lade()?.abgeschlossen == true)
    #expect(s.lade()?.erledigt == [])
}

@Test func fertigerOderBeiseiteGelegterAssistentErscheintNichtVonSelbst() throws {
    let s = EinrichtungsSpeicher(pfade: AppPfade(basis: tempOrdner()))
    try s.speichere(EinrichtungsDatei(abgeschlossen: true))
    #expect(!s.sollErscheinen(hatVault: false))
    try s.speichere(EinrichtungsDatei(abgeschlossen: false, automatischAus: true))
    #expect(!s.sollErscheinen(hatVault: false))
}
