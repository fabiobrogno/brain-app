import Testing
import Foundation
@testable import BrainCore

/// Attrappe der WebView: merkt sich, was geladen wurde — so lässt sich `webViewWebContentProcessDidTerminate` ohne WebKit nachstellen
/// (die App ruft in dieser Methode `WebAbsturzBehandlung.prozessBeendet()`).
@MainActor
private final class AttrappenLader: WebLader {
    var geladen: [URL] = []
    var fehlerseiten: [URL] = []
    func lade(_ url: URL) { geladen.append(url) }
    func zeigeFehlerseite(startURL: URL) { fehlerseiten.append(startURL) }
}

private let start = URL(string: "brain://studio/index.html")!

@Test func markeKommtAnDieAdresseUndStehtNieDoppelt() {
    #expect(WebProzessSchutz.mitMarke(start).absoluteString == "brain://studio/index.html?nachAbsturz=1")
    let mitAbfrage = URL(string: "brain://studio/index.html?pfad=a.md")!
    #expect(WebProzessSchutz.mitMarke(mitAbfrage).absoluteString == "brain://studio/index.html?pfad=a.md&nachAbsturz=1")
    #expect(WebProzessSchutz.mitMarke(WebProzessSchutz.mitMarke(start)).absoluteString == "brain://studio/index.html?nachAbsturz=1")
}

@Test func ersterAbsturzLaedtNeuMitMarke() {
    var s = WebProzessSchutz()
    #expect(s.beiAbsturz(startURL: start) == .neuLaden(URL(string: "brain://studio/index.html?nachAbsturz=1")!))
}

@Test func nachDreiAbstuerzenInEinerMinuteKeineSchleifeMehr() {
    var s = WebProzessSchutz(hoechstens: 3, innerhalb: 60)
    let t0 = Date(timeIntervalSince1970: 1_000_000)
    for i in 0..<3 { #expect(s.beiAbsturz(startURL: start, jetzt: t0.addingTimeInterval(Double(i) * 5)) != .fehlerseite) }
    #expect(s.beiAbsturz(startURL: start, jetzt: t0.addingTimeInterval(20)) == .fehlerseite)
    // nach Ablauf des Fensters darf es wieder neu laden
    #expect(s.beiAbsturz(startURL: start, jetzt: t0.addingTimeInterval(80)) == .neuLaden(WebProzessSchutz.mitMarke(start)))
}

@MainActor
@Test func simulierterAbsturzLaedtDieSeiteNeuUndSchreibtInsProtokoll() {
    let lader = AttrappenLader()
    var zeilen: [String] = []
    let b = WebAbsturzBehandlung(startURL: start, lader: lader, schreibe: { zeilen.append($0) })
    b.prozessBeendet()
    #expect(lader.geladen == [URL(string: "brain://studio/index.html?nachAbsturz=1")!])
    #expect(lader.fehlerseiten.isEmpty)
    #expect(zeilen == ["webprozess-beendet neu-laden 1"])
    #expect(b.abstuerze == 1)
}

@MainActor
@Test func immerWiederAbstuerzeEndenInDerFehlerseiteStattInEinerSchleife() {
    let lader = AttrappenLader()
    var jetzt = Date(timeIntervalSince1970: 2_000_000)
    let b = WebAbsturzBehandlung(startURL: start, schutz: WebProzessSchutz(hoechstens: 2, innerhalb: 60), lader: lader, jetzt: { jetzt })
    for _ in 0..<4 { b.prozessBeendet(); jetzt = jetzt.addingTimeInterval(1) }
    #expect(lader.geladen.count == 2)
    #expect(lader.fehlerseiten == [start, start])
}

@MainActor
@Test func einGeschlossenesFensterBleibtNichtAmLebenUndLaedtNichts() {
    var lader: AttrappenLader? = AttrappenLader()
    weak var schwach = lader
    var zeilen: [String] = []
    let b = WebAbsturzBehandlung(startURL: start, lader: lader!, schreibe: { zeilen.append($0) })
    lader = nil
    #expect(schwach == nil, "die Behandlung hält die WebView nur schwach")
    b.prozessBeendet() // darf nichts tun und nicht abstürzen
    #expect(zeilen.count == 1)
}
