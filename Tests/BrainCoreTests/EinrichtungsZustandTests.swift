import Testing
import Foundation
@testable import BrainCore

private typealias S = EinrichtungsSchritt

// MARK: Schrittfolge

@Test func einrichtungBeginntBeiGitUndFolgtDerFestenReihenfolge() {
    var z = EinrichtungsZustand()
    #expect(S.allCases == [.git, .vault, .github, .ki, .probe])
    var gesehen: [S] = []
    while let s = z.aktuell {
        gesehen.append(s)
        z.meldeErledigt(s)
    }
    #expect(gesehen == S.allCases)
    #expect(z.istFertig)
    #expect(z.fortschritt.fertig == z.fortschritt.gesamt)
}

@Test func erledigtesSpringtZumErstenOffenenSchritt() {
    // Die Wirklichkeit erfüllt git, Vault und GitHub schon (z. B. zweiter Start): nur KI und Probe bleiben.
    var z = EinrichtungsZustand()
    z.meldeErledigt(.vault)
    #expect(z.aktuell == .git, "ein späterer Schritt ändert nichts, solange ein früherer offen ist")
    z.meldeErledigt(.git)
    #expect(z.aktuell == .github)
    z.meldeErledigt(.github)
    #expect(z.aktuell == .ki)
}

@Test func nurWahlfreieSchritteLassenSichUeberspringen() {
    var z = EinrichtungsZustand()
    let okGit = z.ueberspringe(.git)
    #expect(!okGit)
    let okVault = z.ueberspringe(.vault)
    #expect(!okVault)
    #expect(z.aktuell == .git)
    z.meldeErledigt(.git)
    z.meldeErledigt(.vault)
    let okGithub = z.ueberspringe(.github)
    #expect(okGithub)
    #expect(z.stand(.github) == .uebersprungen)
    #expect(z.aktuell == .ki)
    let okKi = z.ueberspringe(.ki), okProbe = z.ueberspringe(.probe)
    #expect(okKi && okProbe)
    #expect(z.istFertig)
}

@Test func einErledigterSchrittWirdNichtZuUebersprungen() {
    var z = EinrichtungsZustand()
    z.meldeErledigt(.git); z.meldeErledigt(.vault); z.meldeErledigt(.github)
    z.meldeErledigt(.ki)
    let okKi = z.ueberspringe(.ki)
    #expect(!okKi)
    #expect(z.stand(.ki) == .erledigt)
}

// MARK: Fehler

@Test func fehlerBleibenSichtbarBisDerSchrittGelingt() {
    var z = EinrichtungsZustand()
    z.meldeFehler(.git, "Apple-Dialog ließ sich nicht öffnen")
    #expect(z.fehler[.git] == "Apple-Dialog ließ sich nicht öffnen")
    #expect(z.aktuell == .git, "ein Fehler bringt den Schritt nie weiter")
    #expect(z.stand(.git) == .offen)
    z.meldeFehler(.git, "zweiter Versuch")
    #expect(z.fehler[.git] == "zweiter Versuch")
    z.meldeErledigt(.git)
    #expect(z.fehler[.git] == nil)
}

@Test func fehlerOhneTextBekommtEinenStandardtext() {
    var z = EinrichtungsZustand()
    z.meldeFehler(.vault, "  \n ")
    #expect(z.fehler[.vault] == "Das hat nicht geklappt.")
    z.loescheFehler(.vault)
    #expect(z.fehler[.vault] == nil)
}

@Test func ueberspringenLoeschtDenFehlerDesSchritts() {
    var z = EinrichtungsZustand()
    z.meldeErledigt(.git); z.meldeErledigt(.vault)
    z.meldeFehler(.github, "GitHub war nicht erreichbar")
    z.ueberspringe(.github)
    #expect(z.fehler[.github] == nil)
}

// MARK: Zurück

@Test func zurueckZeigtEinenFrueherenSchrittWiederUndLaesstSpaetereStehen() {
    var z = EinrichtungsZustand()
    z.meldeErledigt(.git); z.meldeErledigt(.vault)
    #expect(z.aktuell == .github)
    #expect(z.vorherigerSchritt == .vault)
    let gingVault = z.geheZu(.vault)
    #expect(gingVault)
    #expect(z.aktuell == .vault)
    #expect(z.stand(.vault) == .offen)
    #expect(z.vorherigerSchritt == .git)
    let gingProbe = z.geheZu(.probe)
    #expect(!gingProbe, "nach vorn springen geht nicht")
    z.meldeErledigt(.vault)
    #expect(z.aktuell == .github, "danach geht es dort weiter, wo man war")
}

@Test func zurueckAbFertigGehtZumLetztenSchritt() {
    var z = EinrichtungsZustand()
    for s in S.allCases { z.meldeErledigt(s) }
    #expect(z.vorherigerSchritt == .probe)
    let gingZurueck = z.geheZu(.probe)
    #expect(gingZurueck)
    #expect(z.aktuell == .probe)
}

@Test func erstenSchrittGibtEsKeinZurueck() {
    #expect(EinrichtungsZustand().vorherigerSchritt == nil)
}

@Test func wiederholungSetztAllesAufOffen() {
    var z = EinrichtungsZustand()
    for s in S.allCases { z.meldeErledigt(s) }
    z.meldeFehler(.ki, "x")
    z.setzeZurueck()
    #expect(z.aktuell == .git)
    #expect(S.allCases.allSatisfy { z.stand($0) == .offen })
    #expect(z.fehler.isEmpty)
}

// MARK: Wiederaufnahme nach Abbruch

@Test func wiederaufnahmeMerktKiProbeUndUebersprungenesNichtAberWirklichkeitsSchritte() {
    var z = EinrichtungsZustand()
    z.meldeErledigt(.git); z.meldeErledigt(.vault)
    z.ueberspringe(.github)
    z.meldeErledigt(.ki)
    let datei = z.datei(abgeschlossen: false, automatischAus: false)
    #expect(datei.erledigt == ["ki"], "git und Vault werden nicht gemerkt, sondern neu festgestellt")
    #expect(datei.uebersprungen == ["github"])

    let neu = EinrichtungsZustand(gespeichert: datei)
    #expect(neu.stand(.ki) == .erledigt)
    #expect(neu.stand(.github) == .uebersprungen)
    #expect(neu.stand(.git) == .offen && neu.stand(.vault) == .offen)
    #expect(neu.aktuell == .git, "git wird als Erstes wieder geprüft")
}

@Test func gespeicherteDateiMitFremdenWertenBringtNichtsDurcheinander() {
    // git/Vault dürfen weder „erledigt“ noch „übersprungen“ aus der Datei übernehmen
    let datei = EinrichtungsDatei(erledigt: ["git", "vault", "unbekannt", "probe"], uebersprungen: ["git", "vault", "quatsch"])
    let z = EinrichtungsZustand(gespeichert: datei)
    #expect(z.stand(.git) == .offen && z.stand(.vault) == .offen)
    #expect(z.stand(.probe) == .erledigt)
}

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

@Test func fertigerOderBeiseiteGelegterAssistentErscheintNichtVonSelbst() throws {
    let s = EinrichtungsSpeicher(pfade: AppPfade(basis: tempOrdner()))
    try s.speichere(EinrichtungsDatei(abgeschlossen: true))
    #expect(!s.sollErscheinen(hatVault: false))
    try s.speichere(EinrichtungsDatei(abgeschlossen: false, automatischAus: true))
    #expect(!s.sollErscheinen(hatVault: false))
}
