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
    #expect(d.herkunft == .start && d.erledigt == ["ki"] && d.version == 2 && d.ablaufVersion == 2, "wird beim Lesen auf Fassung 2 umgerechnet")
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

// MARK: Fassung 2: ablaufVersion und letzterSchritt, Umrechnung alter Dateien

private func schreibe(_ json: String) throws -> EinrichtungsSpeicher {
    let s = EinrichtungsSpeicher(pfade: AppPfade(basis: tempOrdner()))
    try json.write(to: s.datei, atomically: true, encoding: .utf8)
    return s
}

@Test func neueDateiTraegtFassung2OhneSchritt() throws {
    let s = EinrichtungsSpeicher(pfade: AppPfade(basis: tempOrdner()))
    try s.speichere(EinrichtungsDatei())
    let roh = try String(contentsOf: s.datei, encoding: .utf8)
    #expect(roh.contains("\"ablaufVersion\" : 2") && roh.contains("\"version\" : 2"))
    #expect(!roh.contains("letzterSchritt"), "nil wird nicht geschrieben")
    let d = try #require(s.lade())
    #expect(d.letzterSchritt == nil && d.ablaufVersion == 2)
}

@Test func letzterSchrittUeberlebtSpeichernUndLesen() throws {
    let s = EinrichtungsSpeicher(pfade: AppPfade(basis: tempOrdner()))
    try s.speichere(EinrichtungsDatei(letzterSchritt: .ki))
    #expect(s.lade()?.letzterSchritt == .ki)
    #expect(try String(contentsOf: s.datei, encoding: .utf8).contains("\"letzterSchritt\" : \"ki\""))
}

@Test func alteDateiOhneAblaufVersionWirdUmgerechnetUndBehaeltIhrenStand() throws {
    // Datei aus Fassung 1 (E1 und früher): fertig, „Später“ und Herkunft bleiben; es gibt keinen Schritt, der sicher erledigt wäre
    let s = try schreibe(#"{"version":1,"abgeschlossen":true,"automatischAus":false,"erledigt":[],"uebersprungen":[],"herkunft":"menue"}"#)
    let d = try #require(s.lade())
    #expect(d.version == 2 && d.ablaufVersion == 2 && d.letzterSchritt == nil)
    #expect(d.abgeschlossen && !d.automatischAus && d.herkunft == .menue)
    // „Später“ gewählt: erscheint weiter nicht von selbst
    let spaeter = try schreibe(#"{"version":1,"abgeschlossen":false,"automatischAus":true}"#)
    #expect(spaeter.lade()?.automatischAus == true && spaeter.sollErscheinen(hatVault: false) == false)
}

@Test func alteDateiRechnetErledigteSchritteInDenWeitestenNeuenSchrittUm() throws {
    let a = try #require(try schreibe(#"{"abgeschlossen":false,"erledigt":["vault"]}"#).lade())
    #expect(a.letzterSchritt == .vault)
    let b = try #require(try schreibe(#"{"abgeschlossen":false,"erledigt":["vault","ki"]}"#).lade())
    #expect(b.letzterSchritt == .ki)
    let c = try #require(try schreibe(#"{"abgeschlossen":false,"erledigt":["ki"],"uebersprungen":["github"]}"#).lade())
    #expect(c.letzterSchritt == .sicherung, "alter Name „github“ zählt als Sicherung, der weiteste gewinnt")
    let d = try #require(try schreibe(#"{"abgeschlossen":false,"erledigt":["willkommen","fertig","unbekannt"]}"#).lade())
    #expect(d.letzterSchritt == nil, "unbekannte Namen ändern nichts")
}

@Test func dateiMitFassung2WirdNichtNochEinmalUmgerechnet() throws {
    let s = try schreibe(#"{"version":2,"ablaufVersion":2,"letzterSchritt":"vault","erledigt":["ki"]}"#)
    #expect(s.lade()?.letzterSchritt == .vault, "erledigt zählt nur bei alten Dateien")
}

@Test func unbekannterSchrittOderNeuereFassungBleibtLesbar() throws {
    let s = try schreibe(#"{"version":2,"ablaufVersion":2,"letzterSchritt":"irgendwas"}"#)
    #expect(s.lade()?.letzterSchritt == nil)
    let neu = try schreibe(#"{"version":9,"ablaufVersion":9,"letzterSchritt":"sicherung"}"#)
    #expect(neu.lade()?.letzterSchritt == .sicherung && neu.lade()?.ablaufVersion == 9, "eine neuere Datei wird nicht angefasst")
}

@Test func umrechnungSchreibtErstBeimNaechstenSpeichernZurueck() throws {
    let s = try schreibe(#"{"abgeschlossen":false,"erledigt":["vault"]}"#)
    #expect(try String(contentsOf: s.datei, encoding: .utf8).contains("ablaufVersion") == false, "Lesen ändert die Datei nie")
    try s.speichere(try #require(s.lade()))
    #expect(try String(contentsOf: s.datei, encoding: .utf8).contains("\"ablaufVersion\" : 2"))
    #expect(s.lade()?.letzterSchritt == .vault)
}

@Test func schritteSindGeordnetUndHabenEinenNaechsten() {
    #expect(EinrichtungsSchritt.vault < .ki && EinrichtungsSchritt.ki < .sicherung)
    #expect(EinrichtungsSchritt.vault.naechster == .ki && EinrichtungsSchritt.ki.naechster == .sicherung && EinrichtungsSchritt.sicherung.naechster == nil)
}
