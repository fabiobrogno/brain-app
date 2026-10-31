import Testing
import Foundation
@testable import BrainCore

private func antwort(_ status: Int, _ text: String) -> BrueckenAntwort {
    BrueckenAntwort(status: status, headers: [:], body: Data(text.utf8))
}

@Test func erfolgsantwortWirdZumJSONObjektUndLeerZumLeerenObjekt() throws {
    let j = try WerkstattAntwort.auswerten(antwort(200, #"{"pfad":"00_inbox/x.md"}"#))
    #expect(j["pfad"] as? String == "00_inbox/x.md")
    #expect(try WerkstattAntwort.auswerten(antwort(204, "")).isEmpty)
}

@Test func erfolgOhneLesbaresJSONIstEinFehler() {
    #expect(throws: EinrichtungsFehler.self) { try WerkstattAntwort.auswerten(antwort(200, "kein json")) }
}

@Test func fehlerAntwortDerWerkstattWirdZumLesbarenFehler() {
    do {
        _ = try WerkstattAntwort.auswerten(antwort(409, #"{"fehler":"Dieser Vault ist nicht bestätigt.","art":"nicht-vertraut","befehl":"kortex x"}"#))
        Issue.record("erwartet Fehler")
    } catch let e as EinrichtungsFehler {
        #expect(e.meldung == "Dieser Vault ist nicht bestätigt.")
        #expect(e.status == 409 && e.art == "nicht-vertraut" && e.befehl == "kortex x")
    } catch { Issue.record("falscher Fehler \(error)") }
}

@Test func fehlerOhneTextBekommtEinenStandardtextMitStatus() {
    do { _ = try WerkstattAntwort.auswerten(antwort(500, "kaputt")); Issue.record("erwartet Fehler") } catch let e as EinrichtungsFehler {
        #expect(e.meldung.contains("500"))
        #expect(e.art == nil)
    } catch { Issue.record("falscher Fehler") }
}

@Test func verbindungsfehlerWerdenZuKlartext() {
    for (fehler, teil) in [(BrueckenFehler.beendet, "antwortet nicht"), (.startFehlgeschlagen("x"), "antwortet nicht"), (.geschlossen, "antwortet nicht"),
                           (.zeitUeberschritten, "zu lange")] {
        let e = WerkstattAntwort.verbindungsfehler(fehler)
        #expect(e.meldung.contains(teil), "\(fehler)")
        #expect(e.status == nil)
    }
    #expect(WerkstattAntwort.verbindungsfehler(CocoaError(.fileNoSuchFile)).meldung.hasPrefix("Unerwarteter Fehler"))
}
