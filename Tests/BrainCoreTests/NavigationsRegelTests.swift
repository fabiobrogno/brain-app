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
    let get = try #require(SchemaAntwort.anfrage(ausNachricht: ["methode": "get", "pfad": "/api/daten", "daten": NSNull()]))
    #expect(get.methode == "GET")
    #expect(get.body == nil)
    let put = try #require(SchemaAntwort.anfrage(ausNachricht: ["methode": "PUT", "pfad": "/api/einstellungen", "daten": ["werte": ["a": 1]]]))
    #expect(String(decoding: try #require(put.body), as: UTF8.self) == #"{"werte":{"a":1}}"#)
    #expect(SchemaAntwort.anfrage(ausNachricht: ["methode": "GET", "pfad": "/index.html"]) == nil)
    #expect(SchemaAntwort.anfrage(ausNachricht: ["methode": "DELETE", "pfad": "/api/daten"]) == nil)
    #expect(SchemaAntwort.anfrage(ausNachricht: "kein objekt") == nil)
}
