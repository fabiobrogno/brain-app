import Testing
import Foundation
@testable import BrainCore

private let listeJSON = #"""
{"fragen":[{"id":"rf-20261021-widerspruch-a1b2c3","typ":"widerspruch","header":"Widerspruch","frage":"Was gilt auf Server.md?","beschreibung":"A: „Port 8080“ (Quelle: wiki)\nB: „Port 9090“ (Quelle: sitzung)","seite":"20_wiki/Server.md","optionen":[{"wahl":"a","label":"A gilt","wirkung":"Die Wiki-Zeile bleibt."},{"wahl":"b","label":"B gilt","wirkung":"Neu."},{"wahl":"weiss-nicht","label":"Weiß nicht","wirkung":"Nichts."}]},{"id":"rf-20261021-heikel-d4e5f6","typ":"heikel","header":"Prüfen","frage":"Übernehmen?","beschreibung":"","seite":"","optionen":[{"wahl":"uebernehmen","label":"Übernehmen"},{"wahl":"verwerfen","label":"Verwerfen"}]}],"wartend":3}
"""#

@Test func listeWirdAusDerLetztenZeileGelesen() throws {
    let l = try RueckfragenListe.aus(ausgabe: "Hinweis vorab\n\(listeJSON)\n\n")
    #expect(l.fragen.count == 2)
    #expect(l.wartend == 3)
    #expect(l.fragen[0].optionen.map(\.wahl) == ["a", "b", "weiss-nicht"])
    #expect(l.fragen[0].belegZeilen == ["A: „Port 8080“ (Quelle: wiki)", "B: „Port 9090“ (Quelle: sitzung)"])
    #expect(l.fragen[1].optionen[0].wirkung == "")   // fehlende Felder sind kein Fehler
    #expect(l.fragen[1].belegZeilen.isEmpty)
}

@Test func leereOderKaputteAusgabeWirdAlsFehlerGemeldet() {
    #expect(throws: RueckfragenFehler.leereAusgabe) { _ = try RueckfragenListe.aus(ausgabe: "\n  \n") }
    #expect(throws: DecodingError.self) { _ = try RueckfragenListe.aus(ausgabe: "kein json") }
    #expect(throws: DecodingError.self) { _ = try RueckfragenListe.aus(ausgabe: #"{"wartend":1}"#) }
}

@Test func leereListeIstGueltig() throws {
    let l = try RueckfragenListe.aus(ausgabe: #"{"fragen":[],"wartend":0}"#)
    #expect(RueckfragenStapel(l).istLeer)
}

@Test func stapelGehtFrageFuerFrageDurch() throws {
    var s = RueckfragenStapel(try RueckfragenListe.aus(ausgabe: listeJSON))
    #expect(s.aktuell?.typ == "widerspruch")
    #expect(s.fortschritt == "Frage 1 von 2")
    s.aktuelleZurueckstellen()
    #expect(s.aktuell?.typ == "heikel")
    s.aktuelleErledigt()
    #expect(s.aktuell?.typ == "widerspruch")
    #expect(s.fortschritt == "Frage 2 von 2")
    s.aktuelleZurueckstellen()   // einzige Frage: bleibt
    #expect(s.aktuell?.typ == "widerspruch")
    s.aktuelleErledigt()
    #expect(s.istLeer)
    s.aktuelleErledigt()         // leer: kein Absturz
    #expect(s.beantwortet == 2)
}

@Test func zaehlerTexte() {
    #expect(RueckfragenText.zaehler(nil) == "Rückfragen: unbekannt")
    #expect(RueckfragenText.zaehler(0) == "Keine Rückfragen offen")
    #expect(RueckfragenText.zaehler(1) == "1 Rückfrage offen")
    #expect(RueckfragenText.zaehler(7) == "7 Rückfragen offen")
}

@Test func statusOhneRueckfragenBlockBleibtLesbar() throws {
    let alt = #"{"version":"0.5.1","quellVault":false,"zustand":"ok","meldungen":[],"zahlen":{"vorschlaege":0,"konflikte":0,"abgelaufen":0,"zuTun":0}}"#
    let s = try BrainStatus.aus(ausgabe: alt)
    #expect(s.zahlen.rueckfragen == nil)
    #expect(s.tageslauf == nil)
}

@Test func statusMitRueckfragenUndTageslauf() throws {
    let neu = #"{"version":"0.7.0","quellVault":false,"zustand":"hinweis","meldungen":[],"zahlen":{"vorschlaege":0,"konflikte":0,"abgelaufen":0,"zuTun":2,"rueckfragen":2},"tageslauf":{"schalter":"an","modus":"an","status":"ok","zeit":"2026-10-21T04:10:00Z","letzterErfolg":"2026-10-21T04:10:00Z","autostufe":"normal","fehlerquote":{"fehler":0,"geprueft":12},"zahlen":{"uebernommen":7,"aussortiert":31,"rueckfragenNeu":3,"rueckfragen":3}}}"#
    let s = try BrainStatus.aus(ausgabe: neu)
    #expect(s.zahlen.rueckfragen == 2)
    #expect(s.tageslauf?.fehlerquote == Fehlerquote(fehler: 0, geprueft: 12))
    #expect(RueckfragenText.tageslauf(s.tageslauf) == "7 übernommen · 31 aussortiert · 3 Rückfragen offen · Fehlerquote 0/12")
}

@Test func tageslaufTextProbeUndAutostufe() {
    let t = TageslaufKurz(schalter: "probe", modus: "probe", status: "ok", zeit: nil, autostufe: "eng", fehlerquote: nil, zahlen: .init(uebernommen: 1, aussortiert: 2, rueckfragen: 0))
    #expect(RueckfragenText.tageslauf(t) == "Probelauf, es wurde nichts geändert: 1 übernommen · 2 aussortiert · 0 Rückfragen offen · Autostufe: eng")
    #expect(RueckfragenText.tageslauf(nil) == "Noch kein Tageslauf.")
}

// MARK: Befehle gegen ein falsches „node“ mit Fake-Ausgaben des Kits

private func fakeKit(_ skriptKoerper: String) -> BrainBefehl {
    BrainBefehl(node: skript("#!/bin/bash\n\(skriptKoerper)\n", name: "node", in: tempOrdner()), vault: tempOrdner("Mein Brän"))
}

@Test func rueckfragenListeUeberBrainBefehl() async throws {
    // $1 = brain.mjs, $2/$3 = Befehl
    let b = fakeKit("[ \"$2 $3\" = \"rueckfragen liste\" ] || exit 9\ncat <<'EOF'\n\(listeJSON)\nEOF")
    let l = try await b.rueckfragen()
    #expect(l.fragen.count == 2)
}

@Test func antwortUebergibtIdWahlUndNotiz() async throws {
    let b = fakeKit("printf '%s|' \"${@:2}\" > \"$BRAIN_VAULT/args.txt\"")
    try await b.antworte(id: "rf-1-heikel-abc", wahl: "uebernehmen", notiz: "  passt so \n")
    let s = try String(contentsOf: b.vault.appendingPathComponent("args.txt"), encoding: .utf8)
    #expect(s == "rueckfragen|antwort|rf-1-heikel-abc|uebernehmen|passt so|")
}

@Test func antwortOhneNotizGibtKeinLeeresArgument() async throws {
    let b = fakeKit("printf '%s|' \"${@:2}\" > \"$BRAIN_VAULT/args.txt\"")
    try await b.antworte(id: "rf-1-web-abc", wahl: "verwerfen")
    let s = try String(contentsOf: b.vault.appendingPathComponent("args.txt"), encoding: .utf8)
    #expect(s == "rueckfragen|antwort|rf-1-web-abc|verwerfen|")
}

@Test func kitFehlerKommtAlsAlltagsmeldung() async {
    let b = fakeKit("echo 'Diese Rückfrage gibt es nicht (mehr).' >&2\necho 'Stack: x' >&2\nexit 1")
    await #expect(throws: RueckfragenFehler.abgelehnt("Diese Rückfrage gibt es nicht (mehr).")) {
        try await b.antworte(id: "rf-1-web-abc", wahl: "verwerfen")
    }
}

@Test func unsaubereIdOderWahlWirdNichtAnsKitGereicht() async {
    let b = fakeKit("exit 0")
    await #expect(throws: RueckfragenFehler.self) { try await b.antworte(id: "../x", wahl: "a") }
    await #expect(throws: RueckfragenFehler.self) { try await b.antworte(id: "rf-1-web-abc", wahl: "--evil") }
    await #expect(throws: RueckfragenFehler.self) { try await b.antworte(id: "", wahl: "a") }
}

@Test func antwortenAnwendenRuftNurAntwortenLosgeloest() async throws {
    let b = fakeKit("printf '%s|' \"${@:2}\" > \"$BRAIN_VAULT/args.txt\"")
    try await b.antwortenAnwenden()
    let s = try String(contentsOf: b.vault.appendingPathComponent("args.txt"), encoding: .utf8)
    #expect(s == "tageslauf|--nur-antworten|--losgeloest|")
}

@Test func zurueckNimmtNurEchteLaufNummern() async throws {
    let b = fakeKit("printf '%s|' \"${@:2}\" > \"$BRAIN_VAULT/args.txt\"\necho 'Zurückgenommen: 3 Änderung(en)'")
    let text = try await b.nimmZurueck(lauf: "20261021-041000")
    #expect(text == "Zurückgenommen: 3 Änderung(en)")
    let s = try String(contentsOf: b.vault.appendingPathComponent("args.txt"), encoding: .utf8)
    #expect(s == "zurueck|20261021-041000|")
    await #expect(throws: RueckfragenFehler.ungueltigeLauf) { _ = try await b.nimmZurueck(lauf: "--alle") }
    await #expect(throws: RueckfragenFehler.ungueltigeLauf) { _ = try await b.nimmZurueck(lauf: "rf-1-web-abc") }
}

@Test func zurueckFehlerKommtAlsMeldung() async {
    let b = fakeKit("echo 'Der Tageslauf läuft gerade — bitte gleich noch einmal versuchen.' >&2\nexit 1")
    await #expect(throws: RueckfragenFehler.abgelehnt("Der Tageslauf läuft gerade — bitte gleich noch einmal versuchen.")) {
        _ = try await b.nimmZurueck(lauf: "20261021-041000")
    }
}

// MARK: Tagesbericht

private func berichtVault(_ dateien: [String: String]) -> URL {
    let vault = tempOrdner()
    let ordner = vault.appendingPathComponent(".logs/tageslauf", isDirectory: true)
    try! FileManager.default.createDirectory(at: ordner, withIntermediateDirectories: true)
    for (n, t) in dateien { try! t.write(to: ordner.appendingPathComponent(n), atomically: true, encoding: .utf8) }
    return vault
}

@Test func tagesberichtNimmtDenNeuestenMitLaufNummer() throws {
    let v = berichtVault(["2026-10-20.md": "## Lauf 20261020-041000", "2026-10-21.md": "# Bericht\n## Lauf 20261021-041000\nrückgängig: brain zurueck 20261021-041000",
                          "letzter.json": "{}", "aktionen.jsonl": ""])
    let b = try #require(Tagesbericht.lade(vault: v))
    #expect(b.datei == "2026-10-21.md")
    #expect(b.lauf == "20261021-041000")
    #expect(b.kannZurueck)
}

@Test func tagesberichtNimmtDenLetztenLaufAbschnitt() throws {
    let text = "# Bericht\n## Lauf 20261021-041000\n- Titel 20991231-235959 übernommen\n## Lauf 20261021-183000\n- nur Antworten\n"
    let b = try #require(Tagesbericht.lade(vault: berichtVault(["2026-10-21.md": text])))
    #expect(b.lauf == "20261021-183000")
}

@Test func laufNummerImFliesstextZaehltNicht() {
    #expect(Tagesbericht.lauf(in: "Lauf 20261021-041000\nsiehe ## Lauf 20261021-041000 oben") == nil)
}

@Test func probeBerichtKannNichtZurueck() throws {
    let v = berichtVault(["2026-10-21-probe.md": "würde 3 übernehmen 20261021-041000"])
    let b = try #require(Tagesbericht.lade(vault: v))
    #expect(b.istProbe)
    #expect(!b.kannZurueck)
}

@Test func berichtOhneLaufNummerHatKeinZurueck() throws {
    let b = try #require(Tagesbericht.lade(vault: berichtVault(["2026-10-21.md": "nichts"])))
    #expect(b.lauf == nil && !b.kannZurueck)
}

@Test func keinBerichtOrdnerGibtNil() {
    #expect(Tagesbericht.lade(vault: tempOrdner()) == nil)
    #expect(Tagesbericht.lade(vault: berichtVault(["letzter.json": "{}"])) == nil)
}
