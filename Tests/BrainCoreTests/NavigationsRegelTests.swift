import Testing
import Foundation
@testable import BrainCore

private func url(_ s: String) -> URL { URL(string: s)! }

@Test func eigeneOberflaecheIstErlaubt() {
    #expect(NavigationsRegel.entscheide(url("brain://app/index.html"), hauptrahmen: true, vomNutzer: false) == .erlauben)
    #expect(NavigationsRegel.entscheide(url("brain://anders/x"), hauptrahmen: true, vomNutzer: true) == .abbrechen)
}

@Test func fremdeLinksOeffnenNurAufKlickImBrowser() {
    let u = url("https://example.com/seite")
    #expect(NavigationsRegel.entscheide(u, hauptrahmen: true, vomNutzer: true) == .extern(u))
    #expect(NavigationsRegel.entscheide(u, hauptrahmen: true, vomNutzer: false) == .abbrechen)
    #expect(NavigationsRegel.entscheide(u, hauptrahmen: false, vomNutzer: true) == .abbrechen)
    #expect(NavigationsRegel.entscheide(u, hauptrahmen: false, vomNutzer: false) == .abbrechen)
}

@Test func httpUndMailtoWerdenAuchBeiKlickAbgebrochen() {
    #expect(NavigationsRegel.entscheide(url("http://example.com/seite"), hauptrahmen: true, vomNutzer: true) == .abbrechen)
    #expect(NavigationsRegel.entscheide(url("mailto:a@example.com"), hauptrahmen: true, vomNutzer: true) == .abbrechen)
}

@Test func allesAndereWirdAbgebrochen() {
    for s in ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,hi", "ftp://x/y"] {
        #expect(NavigationsRegel.entscheide(URL(string: s), hauptrahmen: true, vomNutzer: true) == .abbrechen, "\(s)")
    }
    #expect(NavigationsRegel.entscheide(nil, hauptrahmen: true, vomNutzer: true) == .abbrechen)
}

@Test func pfadBehaeltQueryUndKodierung() {
    #expect(SchemaAntwort.pfad(von: url("brain://app/index.html")) == "/index.html")
    #expect(SchemaAntwort.pfad(von: url("brain://app/")) == "/")
    #expect(SchemaAntwort.pfad(von: url("brain://app")) == "/")
    #expect(SchemaAntwort.pfad(von: url("brain://app/api/gelesen?seit=1")) == "/api/gelesen?seit=1")
    #expect(SchemaAntwort.pfad(von: url("brain://app/%2e%2e/x")) == "/%2e%2e/x")
}

@Test func antwortTraegtStatusKopfUndLaenge() {
    let a = BrueckenAntwort(status: 404, headers: ["Content-Type": "text/plain"], body: Data("weg".utf8))
    let r = SchemaAntwort.antwort(url: url("brain://app/x"), aus: a)
    #expect(r.statusCode == 404)
    #expect(r.value(forHTTPHeaderField: "Content-Type") == "text/plain")
    #expect(r.value(forHTTPHeaderField: "Content-Length") == "3")
    let k = SchemaAntwort.kanalAntwort(a)
    #expect(k["status"] as? Int == 404)
    #expect(k["body"] as? String == "weg")
}

@Test func kanalNachrichtenWerdenStrengGeprueft() throws {
    let get = try SchemaAntwort.anfrage(ausNachricht: ["methode": "get", "pfad": "/api/daten", "daten": NSNull()])
    #expect(get.methode == "GET")
    #expect(get.body == nil)
    let put = try SchemaAntwort.anfrage(ausNachricht: ["methode": "PUT", "pfad": "/api/einstellungen", "daten": ["werte": ["a": 1]]])
    #expect(String(decoding: try #require(put.body), as: UTF8.self) == #"{"werte":{"a":1}}"#)
    #expect(throws: SchemaAntwort.AnfrageFehler.ungueltig) { try SchemaAntwort.anfrage(ausNachricht: ["methode": "GET", "pfad": "/index.html"]) }
    #expect(throws: SchemaAntwort.AnfrageFehler.ungueltig) { try SchemaAntwort.anfrage(ausNachricht: ["methode": "DELETE", "pfad": "/api/daten"]) }
    #expect(throws: SchemaAntwort.AnfrageFehler.ungueltig) { try SchemaAntwort.anfrage(ausNachricht: "kein objekt") }
}

@Test func zuGrosserKoerperWirdSofortAbgelehnt() throws {
    let gross = String(repeating: "a", count: SchemaAntwort.maxKoerper)
    #expect(throws: SchemaAntwort.AnfrageFehler.zuGross) {
        try SchemaAntwort.anfrage(ausNachricht: ["methode": "PUT", "pfad": "/api/einstellungen", "daten": ["text": gross]])
    }
    let klein = String(repeating: "a", count: 1000)
    _ = try SchemaAntwort.anfrage(ausNachricht: ["methode": "PUT", "pfad": "/api/einstellungen", "daten": ["text": klein]])
    #expect(SchemaAntwort.AnfrageFehler.zuGross.meldung.contains("zu groß"))
}

@Test func fehlerSeiteIstAlltagssprachlichOhneTechnik() throws {
    let url = try #require(URL(string: "brain://app/index.html"))
    #expect(SchemaAntwort.istHauptdokument(url))
    #expect(SchemaAntwort.istHauptdokument(try #require(URL(string: "brain://app/"))))
    #expect(!SchemaAntwort.istHauptdokument(try #require(URL(string: "brain://app/app.js"))))
    let seite = SchemaAntwort.fehlerSeite(url: url)
    #expect(seite.antwort.statusCode == 503)
    #expect(seite.antwort.value(forHTTPHeaderField: "Content-Length") == String(seite.body.count))
    let text = String(decoding: seite.body, as: UTF8.self)
    #expect(text.contains("Die Ansicht konnte nicht starten."))
    #expect(text.contains("&#10005;"))
    #expect(!text.contains("Error") && !text.contains("<script"))
}

@Test func apiPfadeSindUeberDasSchemaNichtErreichbar() throws {
    for p in ["brain://app/api/daten", "brain://app/api", "brain://app/API/daten", "brain://app/api/gelesen?seit=1"] {
        #expect(SchemaAntwort.istApiPfad(try #require(URL(string: p))), "\(p)")
    }
    for p in ["brain://app/index.html", "brain://app/apiary.js", "brain://app/vendor/api.js"] {
        #expect(!SchemaAntwort.istApiPfad(try #require(URL(string: p))), "\(p)")
    }
}
