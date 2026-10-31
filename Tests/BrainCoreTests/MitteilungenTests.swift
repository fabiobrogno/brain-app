import Testing
import Foundation
@testable import BrainCore

// Mitteilungen und Aktivität (P8a): alles ohne echten Mitteilungsdienst, ohne Schlafen und ohne echte Uhr.
// Die Uhr ist eine feste, von Hand vorgestellte Zeit; Dateien liegen nur in Temp-Ordnern.

private let t0 = Date(timeIntervalSince1970: 1_800_000_000)

/// Feste, von Hand vorgestellte Uhr.
private final class Uhr: @unchecked Sendable {
    private let sperre = NSLock()
    private var stand: Date
    init(_ start: Date = t0) { stand = start }
    var jetzt: Date { sperre.lock(); defer { sperre.unlock() }; return stand }
    func vor(_ sekunden: TimeInterval) { sperre.lock(); stand = stand.addingTimeInterval(sekunden); sperre.unlock() }
}

/// Attrappe für den Mitteilungsdienst des Systems.
private final class AttrappenZentrum: MitteilungsZentrum, @unchecked Sendable {
    private let sperre = NSLock()
    private var _erlaubt = true
    private var _fragen = 0
    private var _zugestellt: [Mitteilung] = []
    private var _zurueck: [[String]] = []
    var erlaubt: Bool { get { sperre.lock(); defer { sperre.unlock() }; return _erlaubt } set { sperre.lock(); _erlaubt = newValue; sperre.unlock() } }
    var fragenAnzahl: Int { sperre.lock(); defer { sperre.unlock() }; return _fragen }
    var zugestellt: [Mitteilung] { sperre.lock(); defer { sperre.unlock() }; return _zugestellt }
    var zurueckgezogen: [[String]] { sperre.lock(); defer { sperre.unlock() }; return _zurueck }
    func fragen() async -> Bool { sperre.lock(); defer { sperre.unlock() }; _fragen += 1; return _erlaubt }
    func zustellen(_ m: Mitteilung) async { sperre.lock(); _zugestellt.append(m); sperre.unlock() }
    func zurueckziehen(kennungen: [String]) async { sperre.lock(); _zurueck.append(kennungen); sperre.unlock() }
}

private var zaehlerId = 0
private func ereignis(_ art: String, wer: String? = "Claude Code", vault: String? = "aaaaaaaaaaaaaaaa", grund: String? = nil, text: String = "tut etwas.",
                      nach sekunden: TimeInterval = 1, anzahl: Int? = nil, rueckgaengig: Bool = false) -> AktivitaetsEreignis {
    zaehlerId += 1
    return AktivitaetsEreignis(id: "a_test_\(zaehlerId)", zeit: t0.addingTimeInterval(sekunden), art: art, vault: vault, vaultName: "Kortex", wer: wer, grund: grund,
                               text: text, anzahl: anzahl, istRueckgaengigFaehig: rueckgaengig)
}

private func planer(_ uhr: Uhr, regeln: MitteilungsPlaner.Regeln = .init()) -> MitteilungsPlaner {
    MitteilungsPlaner(regeln: regeln, start: uhr.jetzt, jetzt: { uhr.jetzt })
}

private let alleAn: MitteilungsEinstellungen = {
    var e = MitteilungsEinstellungen()
    e.nurImHintergrund = false
    e.pflege = true
    return e
}()

// MARK: Einstellungen und Tabelle

@Test func artSchalterTabelleIstVollstaendig() {
    // (Art, Name des Schalters) wie im Vertrag; `rueckgaengig` hat keinen
    let tabelle: [(String, String)] = [
        ("ablage-aufgabe", "mitteilungenAbgelegt"), ("ablage-notiz", "mitteilungenAbgelegt"), ("aenderung", "mitteilungenAbgelegt"),
        ("abweisung", "mitteilungenAbgewiesen"),
        ("sicherung-konflikt", "mitteilungenSicherung"), ("sicherung-fehler", "mitteilungenSicherung"),
        ("pflege-fehler", "mitteilungenRueckfragen"), ("anmeldung-abgelaufen", "mitteilungenRueckfragen"),
        ("pflege", "mitteilungenPflege"),
    ]
    #expect(MitteilungsEinstellungen.artSchalter == Dictionary(uniqueKeysWithValues: tabelle))
    for (art, schalter) in tabelle {
        var an = MitteilungsEinstellungen()
        an.abgelegt = true; an.abgewiesen = true; an.sicherung = true; an.rueckfragen = true; an.pflege = true
        #expect(an.erlaubt(art: art), "\(art) an")
        // Nur der eigene Schalter entscheidet: aus → keine Mitteilung; alle anderen aus → mit eigenem Schalter an trotzdem erlaubt
        var aus = an
        switch schalter {
        case "mitteilungenAbgelegt": aus.abgelegt = false
        case "mitteilungenAbgewiesen": aus.abgewiesen = false
        case "mitteilungenSicherung": aus.sicherung = false
        case "mitteilungenRueckfragen": aus.rueckfragen = false
        default: aus.pflege = false
        }
        #expect(!aus.erlaubt(art: art), "\(art) aus")
        for andere in tabelle where andere.1 != schalter {
            #expect(aus.erlaubt(art: andere.0), "\(andere.0) bleibt, wenn nur \(schalter) aus ist")
        }
    }
    #expect(!alleAn.erlaubt(art: "rueckgaengig"), "Rückgängig ist nie eine Mitteilung")
    #expect(!alleAn.erlaubt(art: "etwas-neues"), "unbekannte Art: nie")
}

@Test func standardwerteWieImVertrag() {
    let e = MitteilungsEinstellungen.standard
    #expect(e.nurImHintergrund && e.abgelegt && e.abgewiesen && e.sicherung && e.rueckfragen && e.kontingent)
    #expect(!e.ton && !e.pflege)
    #expect(e.erlaubt(art: "ablage-aufgabe") && e.erlaubt(art: "abweisung") && e.erlaubt(art: "sicherung-fehler") && e.erlaubt(art: "anmeldung-abgelaufen"))
    #expect(!e.erlaubt(art: "pflege"))
}

@Test func artSchalterGleichInNodeUndSwift() throws {
    // Parität mit `ART_SCHALTER` in gemeinsam/aktivitaet.mjs
    let mjs = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("Ressourcen/gemeinsam/aktivitaet.mjs")
    let quelle = try String(contentsOf: mjs, encoding: .utf8)
    let start = try #require(quelle.range(of: "export const ART_SCHALTER = {"))
    let ende = try #require(quelle.range(of: "};", range: start.upperBound..<quelle.endIndex))
    let block = String(quelle[start.upperBound..<ende.lowerBound])
    let muster = try NSRegularExpression(pattern: #"(?:"([a-z-]+)"|([a-z]+)):\s*(?:"([A-Za-z]+)"|null)"#)
    var node: [String: String] = [:]
    var ohne: [String] = []
    for m in muster.matches(in: block, range: NSRange(block.startIndex..., in: block)) {
        let art = Range(m.range(at: 1), in: block).map { String(block[$0]) } ?? Range(m.range(at: 2), in: block).map { String(block[$0]) }
        let schalter = Range(m.range(at: 3), in: block).map { String(block[$0]) }
        if let art, let schalter { node[art] = schalter } else if let art { ohne.append(art) }
    }
    #expect(!node.isEmpty)
    #expect(node == MitteilungsEinstellungen.artSchalter)
    #expect(ohne == ["rueckgaengig"])
}

@Test func einstellungenLesen() throws {
    let s = tempOrdner("Support")
    // Datei fehlt → Standard
    #expect(MitteilungsEinstellungen.lies(supportOrdner: s) == .standard)
    func schreibe(_ text: String) throws { try text.write(to: s.appendingPathComponent("einstellungen.json"), atomically: true, encoding: .utf8) }
    // kaputt → Standard
    try schreibe("{nicht json")
    #expect(MitteilungsEinstellungen.lies(supportOrdner: s) == .standard)
    // kein Objekt → Standard
    try schreibe("[true, false]")
    #expect(MitteilungsEinstellungen.lies(supportOrdner: s) == .standard)
    // teilweise: nur die genannten Schlüssel ändern sich, der Rest bleibt Standard
    try schreibe(#"{"theme":"dunkel","mitteilungenAbgelegt":false,"mitteilungenPflege":true,"mitteilungenTon":true}"#)
    var erwartet = MitteilungsEinstellungen.standard
    erwartet.abgelegt = false; erwartet.pflege = true; erwartet.ton = true
    #expect(MitteilungsEinstellungen.lies(supportOrdner: s) == erwartet)
    // ungültige Werte (Text, Zahl, null, Objekt) → Standard dieses Schlüssels
    try schreibe(#"{"mitteilungenAbgelegt":"nein","mitteilungenAbgewiesen":0,"mitteilungenSicherung":null,"mitteilungenRueckfragen":{"a":1},"mitteilungenNurImHintergrund":false}"#)
    var teil = MitteilungsEinstellungen.standard
    teil.nurImHintergrund = false
    #expect(MitteilungsEinstellungen.lies(supportOrdner: s) == teil)
    // alle ausdrücklich
    try schreibe(#"{"mitteilungenNurImHintergrund":false,"mitteilungenTon":true,"mitteilungenAbgelegt":false,"mitteilungenAbgewiesen":false,"mitteilungenRueckfragen":false,"mitteilungenSicherung":false,"mitteilungenKontingent":false,"mitteilungenPflege":true}"#)
    let alle = MitteilungsEinstellungen.lies(supportOrdner: s)
    #expect(!alle.nurImHintergrund && alle.ton && !alle.abgelegt && !alle.abgewiesen && !alle.rueckfragen && !alle.sicherung && !alle.kontingent && alle.pflege)
}

// MARK: Ereignis und Ziel

@Test func ereignisAusEinerProtokollzeile() throws {
    let zeile = #"{"v":1,"id":"a_mvw5l1mb_688653","zeit":"2026-10-31T08:42:40.115Z","art":"ablage-aufgabe","vault":"0123456789abcdef","vaultName":"Kortex","konto":"k_0123abcd","programm":"claude","quelle":"ki:claude-code","wer":"Claude Code · Privat","werkzeug":"brain_suchen","mindest":"posteingang","anzahl":1,"text":"hat eine Aufgabe angelegt.","pfade":["05_aufgaben/x.md"],"rueckgaengig":{"art":"ablage-entfernen","pfad":"05_aufgaben/x.md","hash":"abc"},"dk":"x"}"#
    let e = try JSONDecoder().decode(AktivitaetsEreignis.self, from: Data(zeile.utf8))
    #expect(e.id == "a_mvw5l1mb_688653" && e.art == "ablage-aufgabe" && e.vault == "0123456789abcdef" && e.vaultName == "Kortex")
    #expect(e.wer == "Claude Code · Privat" && e.text == "hat eine Aufgabe angelegt." && e.pfade == ["05_aufgaben/x.md"] && e.anzahl == 1)
    #expect(e.konto == "k_0123abcd" && e.programm == "claude" && e.grund == nil)
    #expect(e.istRueckgaengigFaehig)
    #expect(abs(e.zeit.timeIntervalSince1970 - 1_793_436_160.115) < 0.001 || e.zeit == AktivitaetsZeit.lies("2026-10-31T08:42:40.115Z"))
    // ohne rueckgaengig / mit null / mit false: nicht rückgängig-fähig; Zeit ohne Millisekunden geht auch
    for rest in [#""#, #","rueckgaengig":null"#, #","rueckgaengig":false"#] {
        let z = #"{"v":1,"id":"a_1","zeit":"2026-10-31T08:42:40Z","art":"pflege","text":"x""# + rest + "}"
        let e2 = try JSONDecoder().decode(AktivitaetsEreignis.self, from: Data(z.utf8))
        #expect(!e2.istRueckgaengigFaehig, "\(rest)")
        #expect(e2.wer == nil && e2.vault == nil && e2.pfade.isEmpty)
    }
    // Ereignis-Strom: Bool
    let strom = try JSONDecoder().decode(AktivitaetsEreignis.self, from: Data(#"{"id":"a_2","zeit":"2026-10-31T08:42:40Z","art":"aenderung","text":"x","rueckgaengig":true}"#.utf8))
    #expect(strom.istRueckgaengigFaehig)
    // Pflichtfelder
    for kaputt in [#"{"id":"a_3","zeit":"gestern","art":"pflege","text":"x"}"#, #"{"zeit":"2026-10-31T08:42:40Z","art":"pflege"}"#, #"{"id":"","zeit":"2026-10-31T08:42:40Z","art":"pflege"}"#] {
        #expect((try? JSONDecoder().decode(AktivitaetsEreignis.self, from: Data(kaputt.utf8))) == nil, "\(kaputt)")
    }
    // Rundreise
    let neu = try JSONDecoder().decode(AktivitaetsEreignis.self, from: JSONEncoder().encode(e))
    #expect(neu == e)
}

@Test func zielAbbildungUndUserInfo() throws {
    #expect(MitteilungsZiel.fuer(art: "ablage-aufgabe") == .aufgaben)
    #expect(MitteilungsZiel.fuer(art: "ablage-notiz") == .posteingang)
    for art in ["aenderung", "abweisung", "pflege", "pflege-fehler", "sicherung-konflikt", "sicherung-fehler", "anmeldung-abgelaufen", "rueckgaengig", "neu"] {
        #expect(MitteilungsZiel.fuer(art: art) == .aktivitaet, "\(art)")
    }
    #expect(MitteilungsZiel.aufgaben.befehl == .aufgaben)
    #expect(MitteilungsZiel.posteingang.befehl == .posteingang)
    #expect(MitteilungsZiel.aktivitaet.befehl == .aktivitaet)
    #expect(StudioBefehl.aktivitaet.rawValue == "aktivitaet")
    let info = MitteilungsZiel.aufgaben.userInfo(vault: "0123456789abcdef", id: "a_1", art: "ablage-aufgabe")
    #expect(info["vault"] == "0123456789abcdef" && info["id"] == "a_1" && info["art"] == "ablage-aufgabe" && info["ziel"] == "aufgaben")
    #expect(MitteilungsZiel.lies(userInfo: info) == .aufgaben)
    // über den Mitteilungsdienst kommt es als [AnyHashable: Any] zurück
    let zurueck = Dictionary(uniqueKeysWithValues: info.map { (AnyHashable($0.key), $0.value as Any) })
    #expect(MitteilungsZiel.lies(userInfo: zurueck) == .aufgaben)
    // ungültiges Ziel → nach Art; fremde Mitteilung → nil
    #expect(MitteilungsZiel.lies(userInfo: ["kortex": "1", "ziel": "boese", "art": "ablage-notiz"]) == .posteingang)
    #expect(MitteilungsZiel.lies(userInfo: ["kortex": "1"]) == .aktivitaet)
    #expect(MitteilungsZiel.lies(userInfo: ["ziel": "aufgaben"]) == nil)
    #expect(MitteilungsZiel.lies(userInfo: [:]) == nil)
}

@Test func probeAktionNurImStudio() {
    #expect(AppAktion.pruefe(["aktion": "mitteilung-probe"], vault: nil, oberflaeche: .studio) == .mitteilungProbe)
    #expect(AppAktion.pruefe(["aktion": "mitteilung-probe"], vault: nil, oberflaeche: .app) == nil)
    #expect(AppAktion.pruefe(["aktion": "mitteilung-probe"], vault: nil) == nil)
    let p = Mitteilung.probe(ton: false)
    #expect(p.istProbe && p.ziel == .aktivitaet && p.userInfo["probe"] == "1" && MitteilungsZiel.lies(userInfo: p.userInfo) == .aktivitaet)
}

// MARK: Planer

@Test func zweiAufgabenWerdenEineMitteilung() {
    let uhr = Uhr(); let p = planer(uhr)
    p.aufnehmen([ereignis("ablage-aufgabe", text: "hat eine Aufgabe angelegt."), ereignis("ablage-aufgabe", text: "hat eine Aufgabe angelegt.")], einstellungen: alleAn)
    uhr.vor(5)
    let m = p.faelligeMitteilungen(einstellungen: alleAn, istVorne: false)
    #expect(m.count == 1)
    #expect(m.first?.titel == "Claude Code")
    #expect(m.first.map { "\($0.titel) \($0.text)" } == "Claude Code hat 2 Aufgaben angelegt.")
    #expect(m.first?.ziel == .aufgaben)
    #expect(m.first?.userInfo["ziel"] == "aufgaben" && m.first?.userInfo["vault"] == "aaaaaaaaaaaaaaaa")
    #expect(m.first?.untertitel == "Kortex")
}

@Test func einzelneEreignisseBehaltenIhrenText() {
    let uhr = Uhr(); let p = planer(uhr)
    p.aufnehmen([ereignis("ablage-aufgabe", text: "hat eine Aufgabe angelegt.")], einstellungen: alleAn)
    uhr.vor(5)
    #expect(p.faelligeMitteilungen(einstellungen: alleAn, istVorne: false).first?.text == "hat eine Aufgabe angelegt.")
    // Systemereignis ohne Handelnden: Titel „Kortex“, der ganze Satz als Text, Ziel Aktivität
    p.aufnehmen([ereignis("sicherung-fehler", wer: nil, text: "Die Sicherung ist fehlgeschlagen.")], einstellungen: alleAn)
    uhr.vor(5)
    let s = p.faelligeMitteilungen(einstellungen: alleAn, istVorne: false)
    #expect(s.count == 1 && s[0].titel == "Kortex" && s[0].text == "Die Sicherung ist fehlgeschlagen." && s[0].ziel == .aktivitaet)
}

@Test func notizenUndAnzahlWerdenGezaehlt() {
    let uhr = Uhr(); let p = planer(uhr)
    p.aufnehmen([ereignis("ablage-notiz", anzahl: 2), ereignis("ablage-notiz")], einstellungen: alleAn)
    uhr.vor(5)
    let m = p.faelligeMitteilungen(einstellungen: alleAn, istVorne: false)
    #expect(m.count == 1 && m[0].text == "hat 3 Notizen im Posteingang abgelegt." && m[0].ziel == .posteingang)
}

@Test func gleicheAbweisungenWerdenGesammelt() {
    let uhr = Uhr(); let p = planer(uhr)
    p.aufnehmen((0..<3).map { _ in ereignis("abweisung", grund: "gesperrt", text: "wollte den Vault lesen und wurde abgewiesen.") }, einstellungen: alleAn)
    uhr.vor(5)
    let m = p.faelligeMitteilungen(einstellungen: alleAn, istVorne: false)
    #expect(m.count == 1 && m[0].text == "wurde 3-mal abgewiesen." && m[0].titel == "Claude Code" && m[0].ziel == .aktivitaet)
}

@Test func verschiedeneHandelndeUndVaultsBleibenGetrennt() {
    let uhr = Uhr(); let p = planer(uhr)
    p.aufnehmen([ereignis("ablage-aufgabe", wer: "Claude Code"), ereignis("ablage-aufgabe", wer: "Codex"),
                 ereignis("ablage-aufgabe", wer: "Claude Code", vault: "bbbbbbbbbbbbbbbb"), ereignis("ablage-notiz", wer: "Claude Code")], einstellungen: alleAn)
    uhr.vor(5)
    #expect(p.faelligeMitteilungen(einstellungen: alleAn, istVorne: false).count == 4)
}

@Test func sammelfensterErstDanachGenauEine() {
    let uhr = Uhr(); let p = planer(uhr)
    p.aufnehmen([ereignis("ablage-aufgabe")], einstellungen: alleAn)
    uhr.vor(4.9)
    #expect(p.faelligeMitteilungen(einstellungen: alleAn, istVorne: false).isEmpty, "davor keine Zustellung")
    #expect(p.wartende == 1)
    uhr.vor(0.1)
    #expect(p.faelligeMitteilungen(einstellungen: alleAn, istVorne: false).count == 1, "genau am Fensterende genau eine")
    #expect(p.faelligeMitteilungen(einstellungen: alleAn, istVorne: false).isEmpty, "nicht noch einmal")
    #expect(p.wartende == 0)
    // ein Nachzügler im Fenster kommt in dieselbe Mitteilung
    let p2 = planer(uhr)
    p2.aufnehmen([ereignis("ablage-aufgabe", nach: uhr.jetzt.timeIntervalSince(t0) + 1)], einstellungen: alleAn)
    uhr.vor(3)
    p2.aufnehmen([ereignis("ablage-aufgabe", nach: uhr.jetzt.timeIntervalSince(t0) + 1)], einstellungen: alleAn)
    uhr.vor(2)
    let m = p2.faelligeMitteilungen(einstellungen: alleAn, istVorne: false)
    #expect(m.count == 1 && m[0].text == "hat 2 Aufgaben angelegt.")
}

@Test func ausgeschalteteArtenMeldenNie() {
    let uhr = Uhr(); let p = planer(uhr)
    var e = alleAn
    e.abgelegt = false
    p.aufnehmen([ereignis("ablage-aufgabe"), ereignis("ablage-notiz"), ereignis("aenderung"), ereignis("abweisung", grund: "stufe")], einstellungen: e)
    uhr.vor(60)
    let m = p.faelligeMitteilungen(einstellungen: e, istVorne: false)
    #expect(m.count == 1 && m[0].userInfo["art"] == "abweisung")
    // Schalter nach der Aufnahme ausgeschaltet: wirkt auch auf schon gesammelte Ereignisse
    let p2 = planer(uhr)
    p2.aufnehmen([ereignis("abweisung", grund: "stufe")], einstellungen: alleAn)
    uhr.vor(5)
    var aus = alleAn
    aus.abgewiesen = false
    #expect(p2.faelligeMitteilungen(einstellungen: aus, istVorne: false).isEmpty)
    // Pflege ist standardmäßig aus
    let p3 = planer(uhr)
    p3.aufnehmen([ereignis("pflege", wer: nil)], einstellungen: .standard)
    uhr.vor(5)
    #expect(p3.faelligeMitteilungen(einstellungen: .standard, istVorne: false).isEmpty)
}

@Test func rueckgaengigUndFrueheEreignisseWerdenNieGemeldet() {
    let uhr = Uhr(); let p = planer(uhr)
    p.aufnehmen([ereignis("rueckgaengig"), ereignis("ablage-aufgabe", nach: -1), ereignis("ablage-aufgabe", nach: -3600)], einstellungen: alleAn)
    uhr.vor(60)
    #expect(p.faelligeMitteilungen(einstellungen: alleAn, istVorne: false).isEmpty)
    #expect(p.wartende == 0)
    // genau zum Start zählt noch
    p.aufnehmen([ereignis("ablage-aufgabe", nach: 0)], einstellungen: alleAn)
    uhr.vor(5)
    #expect(p.faelligeMitteilungen(einstellungen: alleAn, istVorne: false).count == 1)
}

@Test func nurImHintergrundUnterdrueckenBeiVorneDieMitteilung() {
    let uhr = Uhr()
    var e = alleAn
    e.nurImHintergrund = true
    let p = planer(uhr)
    p.aufnehmen([ereignis("ablage-aufgabe")], einstellungen: e)
    uhr.vor(5)
    #expect(p.faelligeMitteilungen(einstellungen: e, istVorne: true).isEmpty, "vorne: das Studio zeigt den Toast, keine macOS-Mitteilung")
    #expect(p.wartende == 0, "und sie kommt auch später nicht nach")
    p.aufnehmen([ereignis("ablage-aufgabe")], einstellungen: e)
    uhr.vor(5)
    #expect(p.faelligeMitteilungen(einstellungen: e, istVorne: false).count == 1, "nicht vorne: Mitteilung")
    // Schalter aus: auch vorne eine Mitteilung
    var vorneAuch = e
    vorneAuch.nurImHintergrund = false
    p.aufnehmen([ereignis("ablage-aufgabe")], einstellungen: vorneAuch)
    uhr.vor(5)
    #expect(p.faelligeMitteilungen(einstellungen: vorneAuch, istVorne: true).count == 1)
    // Ton folgt dem Schalter
    var mitTon = vorneAuch
    mitTon.ton = true
    p.aufnehmen([ereignis("ablage-aufgabe")], einstellungen: mitTon)
    uhr.vor(5)
    #expect(p.faelligeMitteilungen(einstellungen: mitTon, istVorne: false).first?.ton == true)
}

@Test func drosselungSammeltDenRestEinmal() {
    let uhr = Uhr(); let p = planer(uhr)
    let sechs = (1...6).map { ereignis("aenderung", wer: "KI \($0)", text: "hat etwas geändert.") }
    p.aufnehmen(sechs, einstellungen: alleAn)
    uhr.vor(5)
    let erste = p.faelligeMitteilungen(einstellungen: alleAn, istVorne: false)
    #expect(erste.count == 4, "höchstens 4 je Minute")
    #expect(erste.map(\.titel) == ["KI 1", "KI 2", "KI 3", "KI 4"])
    #expect(Set(erste.map(\.kennung)).count == 4)
    // Sofort danach: noch kein Platz, nichts geht verloren und nichts kommt doppelt
    #expect(p.faelligeMitteilungen(einstellungen: alleAn, istVorne: false).isEmpty)
    uhr.vor(30)
    #expect(p.faelligeMitteilungen(einstellungen: alleAn, istVorne: false).isEmpty)
    // Nach einer Minute: genau eine Sammelmitteilung für die zwei übrigen
    uhr.vor(30)
    let sammel = p.faelligeMitteilungen(einstellungen: alleAn, istVorne: false)
    #expect(sammel.count == 1 && sammel[0].titel == "Kortex" && sammel[0].text == "Weitere 2 Mitteilungen in Kortex." && sammel[0].ziel == .aktivitaet)
    uhr.vor(120)
    #expect(p.faelligeMitteilungen(einstellungen: alleAn, istVorne: false).isEmpty, "die Sammelmeldung kommt nur einmal")
    // Eine einzelne übrige
    let p2 = planer(uhr)
    p2.aufnehmen((1...5).map { ereignis("aenderung", wer: "KI \($0)", nach: uhr.jetzt.timeIntervalSince(t0) + 1) }, einstellungen: alleAn)
    uhr.vor(5)
    #expect(p2.faelligeMitteilungen(einstellungen: alleAn, istVorne: false).count == 4)
    uhr.vor(60)
    #expect(p2.faelligeMitteilungen(einstellungen: alleAn, istVorne: false).first?.text == "Eine weitere Mitteilung in Kortex.")
}

@Test func gleicheAbweisungNurAlleZehnMinuten() {
    let uhr = Uhr(); let p = planer(uhr)
    func abweisung(_ grund: String = "gesperrt", wer: String = "Claude Code") -> AktivitaetsEreignis {
        ereignis("abweisung", wer: wer, grund: grund, text: "wurde abgewiesen.", nach: uhr.jetzt.timeIntervalSince(t0) + 0.5)
    }
    func versuche(_ e: AktivitaetsEreignis) -> Int {
        p.aufnehmen([e], einstellungen: alleAn)
        uhr.vor(5)
        return p.faelligeMitteilungen(einstellungen: alleAn, istVorne: false).count
    }
    #expect(versuche(abweisung()) == 1)
    #expect(versuche(abweisung()) == 0, "dieselbe Abweisung 5 s später: still")
    #expect(versuche(abweisung("stufe")) == 1, "anderer Grund: neue Meldung")
    #expect(versuche(abweisung(wer: "Codex")) == 1, "anderer Handelnder: neue Meldung")
    uhr.vor(590) // seit der ersten Mitteilung sind jetzt gut 600 s vergangen
    #expect(versuche(abweisung()) == 1, "nach 10 Minuten wieder")
    #expect(versuche(abweisung()) == 0)
}

@Test func unterdrueckteAbweisungVerbrauchtKeinKontingent() {
    let uhr = Uhr()
    var regeln = MitteilungsPlaner.Regeln()
    regeln.maxProMinute = 1
    let p = planer(uhr, regeln: regeln)
    p.aufnehmen([ereignis("abweisung", grund: "gesperrt", text: "wurde abgewiesen.")], einstellungen: alleAn)
    uhr.vor(5)
    #expect(p.faelligeMitteilungen(einstellungen: alleAn, istVorne: false).count == 1)
    uhr.vor(60)
    p.aufnehmen([ereignis("abweisung", grund: "gesperrt", text: "wurde abgewiesen.", nach: uhr.jetzt.timeIntervalSince(t0) + 1)], einstellungen: alleAn)
    uhr.vor(5)
    #expect(p.faelligeMitteilungen(einstellungen: alleAn, istVorne: false).isEmpty)
    // Keine Sammelmitteilung für etwas, das bewusst still blieb
    uhr.vor(120)
    #expect(p.faelligeMitteilungen(einstellungen: alleAn, istVorne: false).isEmpty)
}

// MARK: Leser

private func zeile(_ art: String = "ablage-aufgabe", id: String, zeit: Date = t0.addingTimeInterval(1), wer: String = "Claude Code") -> String {
    let o: [String: Any] = ["v": 1, "id": id, "zeit": AktivitaetsZeit.text(zeit), "art": art, "vault": "0123456789abcdef", "wer": wer,
                            "text": "hat eine Aufgabe angelegt.", "pfade": []]
    return String(decoding: try! JSONSerialization.data(withJSONObject: o, options: [.sortedKeys]), as: UTF8.self)
}

private func haengeAn(_ text: String, an datei: URL) {
    try? FileManager.default.createDirectory(at: datei.deletingLastPathComponent(), withIntermediateDirectories: true)
    if !FileManager.default.fileExists(atPath: datei.path) { FileManager.default.createFile(atPath: datei.path, contents: nil) }
    let h = try! FileHandle(forWritingTo: datei)
    defer { try? h.close() }
    _ = try! h.seekToEnd()
    try! h.write(contentsOf: Data(text.utf8))
}

@Test func leserMeldetNurNeuesAbDemStart() {
    let s = tempOrdner("Support")
    let datei = s.appendingPathComponent("aktivitaet/0123456789abcdef.jsonl")
    haengeAn(zeile(id: "a_alt_1") + "\n" + zeile(id: "a_alt_2") + "\n", an: datei)
    let leser = AktivitaetsLeser(supportOrdner: s)
    #expect(leser.neueEreignisse().isEmpty, "was beim Start schon im Protokoll steht, wird nie gemeldet")
    haengeAn(zeile(id: "a_neu_1") + "\n", an: datei)
    #expect(leser.neueEreignisse().map(\.id) == ["a_neu_1"])
    #expect(leser.neueEreignisse().isEmpty, "nicht noch einmal")
    haengeAn(zeile(id: "a_neu_2") + "\n" + zeile(id: "a_neu_3") + "\n", an: datei)
    #expect(leser.neueEreignisse().map(\.id) == ["a_neu_2", "a_neu_3"])
}

@Test func leserOhneOrdnerUndMitNeuerDatei() {
    let s = tempOrdner("Support")
    let leser = AktivitaetsLeser(supportOrdner: s)
    #expect(leser.neueEreignisse().isEmpty, "Ordner fehlt: kein Fehler")
    // ein Vault bekommt sein erstes Protokoll nach dem Start: alles darin ist neu
    haengeAn(zeile(id: "a_1") + "\n", an: s.appendingPathComponent("aktivitaet/ffffffffffffffff.jsonl"))
    #expect(leser.neueEreignisse().map(\.id) == ["a_1"])
    // andere Dateien im Ordner zählen nicht
    haengeAn(zeile(id: "a_2") + "\n", an: s.appendingPathComponent("aktivitaet/ffffffffffffffff.jsonl.alt"))
    haengeAn("{}\n", an: s.appendingPathComponent("aktivitaet/ffffffffffffffff.zustand.json"))
    #expect(leser.neueEreignisse().isEmpty)
}

@Test func leserWartetAufDasZeilenende() {
    let s = tempOrdner("Support")
    let datei = s.appendingPathComponent("aktivitaet/0123456789abcdef.jsonl")
    haengeAn("", an: datei)
    let leser = AktivitaetsLeser(supportOrdner: s)
    let ganz = zeile(id: "a_halb")
    let teilpunkt = ganz.index(ganz.startIndex, offsetBy: ganz.count / 2)
    haengeAn(String(ganz[..<teilpunkt]), an: datei)
    #expect(leser.neueEreignisse().isEmpty, "halbe Zeile wartet")
    haengeAn(String(ganz[teilpunkt...]), an: datei)
    #expect(leser.neueEreignisse().isEmpty, "ohne Zeilenende noch nicht fertig")
    haengeAn("\n" + zeile(id: "a_danach"), an: datei)
    #expect(leser.neueEreignisse().map(\.id) == ["a_halb"], "die ganze Zeile kommt genau einmal, die nächste halbe wartet")
    haengeAn("\n", an: datei)
    #expect(leser.neueEreignisse().map(\.id) == ["a_danach"])
}

@Test func leserUeberspringtKaputtesUndUeberlanges() {
    let s = tempOrdner("Support")
    let datei = s.appendingPathComponent("aktivitaet/0123456789abcdef.jsonl")
    haengeAn("", an: datei)
    let leser = AktivitaetsLeser(supportOrdner: s)
    let lang = #"{"v":1,"id":"a_lang","zeit":"2026-10-31T08:42:40Z","art":"pflege","text":""# + String(repeating: "x", count: 9000) + #""}"#
    haengeAn("das ist kein json\n" + "{\"id\":\"a_ohne_art\"}\n" + "\n" + lang + "\n" + zeile(id: "a_ok") + "\n", an: datei)
    #expect(leser.neueEreignisse().map(\.id) == ["a_ok"])
    // eine überlange Zeile, die noch nicht zu Ende ist, wird nicht ewig gesammelt und verschluckt den Rest nicht
    haengeAn(String(repeating: "y", count: 20_000), an: datei)
    #expect(leser.neueEreignisse().isEmpty)
    haengeAn(String(repeating: "y", count: 100) + "\n" + zeile(id: "a_nach_lang") + "\n", an: datei)
    #expect(leser.neueEreignisse().map(\.id) == ["a_nach_lang"])
}

@Test func leserErkenntRotation() throws {
    let s = tempOrdner("Support")
    let ordner = s.appendingPathComponent("aktivitaet", isDirectory: true)
    let datei = ordner.appendingPathComponent("0123456789abcdef.jsonl")
    haengeAn((1...5).map { zeile(id: "a_alt_\($0)") + "\n" }.joined(), an: datei)
    let leser = AktivitaetsLeser(supportOrdner: s)
    #expect(leser.neueEreignisse().isEmpty)
    // Rotation wie im Backend: Datei → .alt, neue Datei beginnt von vorn (klein, andere Datei)
    try FileManager.default.moveItem(at: datei, to: ordner.appendingPathComponent("0123456789abcdef.jsonl.alt"))
    haengeAn(zeile(id: "a_rot_1") + "\n", an: datei)
    #expect(leser.neueEreignisse().map(\.id) == ["a_rot_1"], "kleiner als die gemerkte Position: von vorn lesen")
    haengeAn(zeile(id: "a_rot_2") + "\n", an: datei)
    #expect(leser.neueEreignisse().map(\.id) == ["a_rot_2"])
    // Abschneiden derselben Datei (gleiche Nummer, kürzer) gilt auch als Rotation
    let h = try FileHandle(forWritingTo: datei)
    try h.truncate(atOffset: 0)
    try h.close()
    haengeAn(zeile(id: "a_rot_3") + "\n", an: datei)
    #expect(leser.neueEreignisse().map(\.id) == ["a_rot_3"])
    // Die Datei verschwindet und kommt wieder: neu von vorn
    try FileManager.default.removeItem(at: datei)
    #expect(leser.neueEreignisse().isEmpty)
    haengeAn(zeile(id: "a_rot_4") + "\n", an: datei)
    #expect(leser.neueEreignisse().map(\.id) == ["a_rot_4"])
}

@Test func leserMeldetDieselbeKennungNurEinmal() {
    let s = tempOrdner("Support")
    let datei = s.appendingPathComponent("aktivitaet/0123456789abcdef.jsonl")
    haengeAn("", an: datei)
    let leser = AktivitaetsLeser(supportOrdner: s)
    haengeAn(zeile(id: "a_doppelt") + "\n" + zeile(id: "a_doppelt") + "\n", an: datei)
    #expect(leser.neueEreignisse().count == 1)
}

// MARK: Ablauf (Leser + Planer + Zentrum)

@Test func ablaufStelltNachDemSammelfensterGenauEineMitteilungZu() async {
    let s = tempOrdner("Support")
    let datei = s.appendingPathComponent("aktivitaet/0123456789abcdef.jsonl")
    haengeAn(zeile(id: "a_alt") + "\n", an: datei)
    let uhr = Uhr()
    let zentrum = AttrappenZentrum()
    var e = alleAn
    e.nurImHintergrund = true
    nonisolated(unsafe) var einstellungen = e
    nonisolated(unsafe) var vorne = false
    let ablauf = MitteilungsAblauf(leser: AktivitaetsLeser(supportOrdner: s), planer: planer(uhr), zentrum: zentrum,
                                   einstellungen: { einstellungen }, istVorne: { vorne })
    // Ruhe: nichts zu tun, die Erlaubnis wird nicht gefragt
    #expect(await ablauf.takt().isEmpty)
    #expect(zentrum.fragenAnzahl == 0)
    // zwei neue Aufgaben
    haengeAn(zeile(id: "a_1") + "\n" + zeile(id: "a_2") + "\n", an: datei)
    uhr.vor(1)
    #expect(await ablauf.takt().isEmpty, "im Sammelfenster")
    #expect(zentrum.fragenAnzahl == 0, "Erlaubnis erst, wenn eine Mitteilung ansteht")
    uhr.vor(5)
    let m = await ablauf.takt()
    #expect(m.count == 1)
    #expect(zentrum.fragenAnzahl == 1)
    #expect(zentrum.zugestellt == m)
    #expect(m.first.map { "\($0.titel) \($0.text)" } == "Claude Code hat 2 Aufgaben angelegt.")
    #expect(m.first?.ziel.befehl == .aufgaben)
    #expect(await ablauf.takt().isEmpty && zentrum.zugestellt.count == 1)

    // Kortex vorne und „nur im Hintergrund“: keine Mitteilung, und die Erlaubnis wird auch nicht gefragt
    vorne = true
    haengeAn(zeile(id: "a_3") + "\n", an: datei)
    uhr.vor(6)
    #expect(await ablauf.takt().isEmpty)
    uhr.vor(6)
    #expect(await ablauf.takt().isEmpty)
    #expect(zentrum.zugestellt.count == 1 && zentrum.fragenAnzahl == 1)

    // Schalter frisch pro Takt: Aufgaben ausgeschaltet → still
    vorne = false
    einstellungen.abgelegt = false
    haengeAn(zeile(id: "a_4") + "\n", an: datei)
    uhr.vor(6)
    #expect(await ablauf.takt().isEmpty)
    #expect(zentrum.zugestellt.count == 1)

    // Wieder an und nicht vorne: wieder eine
    einstellungen.abgelegt = true
    haengeAn(zeile("ablage-notiz", id: "a_5") + "\n", an: datei)
    uhr.vor(1)
    _ = await ablauf.takt()
    uhr.vor(6)
    let n = await ablauf.takt()
    #expect(n.count == 1 && n[0].ziel == .posteingang && zentrum.zugestellt.count == 2)

    // beim Hinschauen verschwinden die Mitteilungen dieser Sitzung aus dem Mitteilungszentrum
    await ablauf.ziehtZugestelltesZurueck()
    #expect(zentrum.zurueckgezogen.count == 1 && Set(zentrum.zurueckgezogen[0]) == Set(zentrum.zugestellt.map(\.kennung)))
    await ablauf.ziehtZugestelltesZurueck()
    #expect(zentrum.zurueckgezogen.count == 1, "nichts mehr zurückzuziehen")
}

@Test func ablaufOhneErlaubnisStelltNichtZu() async {
    let s = tempOrdner("Support")
    let datei = s.appendingPathComponent("aktivitaet/0123456789abcdef.jsonl")
    haengeAn("", an: datei)
    let uhr = Uhr()
    let zentrum = AttrappenZentrum()
    zentrum.erlaubt = false
    let ablauf = MitteilungsAblauf(leser: AktivitaetsLeser(supportOrdner: s), planer: planer(uhr), zentrum: zentrum, einstellungen: { alleAn }, istVorne: { false })
    haengeAn(zeile(id: "a_1") + "\n", an: datei)
    _ = await ablauf.takt()
    uhr.vor(6)
    #expect(await ablauf.takt().isEmpty)
    #expect(zentrum.fragenAnzahl == 1 && zentrum.zugestellt.isEmpty)
}
