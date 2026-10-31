import Testing
import Foundation
import AppKit
@testable import BrainCore

// Tastenkürzel (Paket P10): das Register als einzige Quelle (Studio liest dieselbe Datei), die gemeinsame Schreibweise, die wirksame Belegung mit `tastenkuerzel.json`,
// die globalen Kürzel mit Neuanmeldung bei Änderung und die abgelehnten Kürzel (reserviert, vom System vergeben, von einem anderen Programm gehalten).
// Alles in Wegwerf-Ordnern; die Registrierung beim System läuft über eine Attrappe — nur ein Test meldet ein selten benutztes Kürzel wirklich an.

private func ressourcen() -> URL {
    URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("Ressourcen", isDirectory: true)
}

private func register() throws -> KuerzelRegister {
    try #require(KuerzelRegister.laden(ressourcen: ressourcen()), "Ressourcen/gemeinsam/tastenkuerzel-register.json fehlt oder ist nicht lesbar")
}

private func pfade() -> AppPfade { AppPfade(basis: tempOrdner("Support")) }

// MARK: Register

@Test func dasRegisterLaesstSichLadenUndHatDieBekanntenBefehle() throws {
    let r = try register()
    #expect(Set(r.befehle.map(\.id)).count == r.befehle.count, "ids eindeutig")
    #expect(r.befehl("schnell-erfassen")?.global == true)
    #expect(r.befehl("schnell-erfassen")?.standard == "Ctrl+Alt+Space")
    #expect(r.befehl("frage-global")?.standard == nil && r.befehl("kortex-zeigen")?.standard == nil)
    #expect(r.befehl("neue-notiz")?.standard == "Cmd+N" && r.befehl("neue-notiz")?.menue == "neu")
    #expect(r.befehl(menue: "palette")?.id == "palette")
    #expect(r.befehle.filter(\.global).map(\.id) == ["schnell-erfassen", "frage-global", "kortex-zeigen"])
}

@Test func dieTastenDesRegistersSindGenauDieTastenDerApp() throws {
    // Studio und App benennen die Tasten gleich: sonst gälte ein im Studio aufgenommenes Kürzel in den Menüs nicht
    let r = try register()
    #expect(Set(r.tasten) == Set(Tastenkuerzel.kanonischeNamen.values))
    #expect(Set(r.tasten).count == r.tasten.count)
    for name in r.tasten {
        let k = try #require(Tastenkuerzel(kanonisch: "Cmd+\(name)"), "\(name)")
        #expect(k.kanonisch == "Cmd+\(name)")
    }
}

@Test func jedesStandardkuerzelDesRegistersIstGueltigUndNichtReserviert() throws {
    let r = try register()
    for b in r.befehle {
        guard let s = b.standard else { continue }
        let k = try #require(Tastenkuerzel(kanonisch: s), "\(b.id): \(s)")
        #expect(k.kanonisch == s)
        #expect(KuerzelPruefung.pruefe(k, system: r.reserviertAlsSystem) == nil, "\(b.id): \(s) darf nicht reserviert sein")
    }
}

@Test func dieReservierteListeNenntCmdQCmdTabUndCmdLeertaste() throws {
    let r = try register()
    for t in ["Cmd+Q", "Cmd+Tab", "Cmd+Space"] { #expect(r.reserviertGrund(t) != nil, "\(t)") }
    #expect(r.reserviertGrund("Cmd+E")?.von == "Kortex")
    for e in r.reserviert { #expect(Tastenkuerzel(kanonisch: e.kuerzel) != nil, "\(e.kuerzel)") }
}

// MARK: Schreibweise

@Test func dieSchreibweiseGiltInBeideRichtungen() {
    #expect(Tastenkuerzel(kanonisch: "Ctrl+Alt+Space") == .standard)
    #expect(Tastenkuerzel.standard.kanonisch == "Ctrl+Alt+Space")
    #expect(Tastenkuerzel(kanonisch: "Shift+Cmd+M") == Tastenkuerzel(taste: 46, umschalter: [.shift, .command]))
    #expect(Tastenkuerzel(taste: 46, umschalter: [.command, .shift, .control, .option]).kanonisch == "Ctrl+Alt+Shift+Cmd+M")
    #expect(Tastenkuerzel(kanonisch: "Cmd+,")?.taste == 43)
    #expect(Tastenkuerzel(kanonisch: "Alt+Cmd+Left")?.kanonisch == "Alt+Cmd+Left")
    #expect(Tastenkuerzel(kanonisch: "Ctrl+F12")?.kanonisch == "Ctrl+F12")
    for falsch in ["Cmd+Shift+M", "Cmd+Cmd+M", "Cmd+", "Cmd+m", "Cmd+Esc", "Cmd+Backspace", "Strg+M", "", "M+Cmd", "Cmd++", "+"] {
        #expect(Tastenkuerzel(kanonisch: falsch) == nil, "\(falsch)")
    }
}

@Test func dasMenuezeichenFolgtDerTaste() {
    #expect(Tastenkuerzel(kanonisch: "Cmd+N")?.menueZeichen == "n")
    #expect(Tastenkuerzel(kanonisch: "Cmd+,")?.menueZeichen == ",")
    #expect(Tastenkuerzel(kanonisch: "Cmd+4")?.menueZeichen == "4")
    #expect(Tastenkuerzel(kanonisch: "Cmd+Space")?.menueZeichen == " ")
    #expect(Tastenkuerzel(kanonisch: "Cmd+Return")?.menueZeichen == "\r")
    #expect(Tastenkuerzel(kanonisch: "Cmd+Left")?.menueZeichen == "\u{F702}")
    #expect(Tastenkuerzel(kanonisch: "Cmd+F1")?.menueZeichen == "\u{F704}")
    #expect(Tastenkuerzel(kanonisch: "Cmd+F5")?.menueZeichen == "\u{F708}")
}

// MARK: Belegung und Datei

@Test func ohneDateiGiltDerStandardDesRegisters() throws {
    let r = try register()
    let b = KuerzelBelegung.laden(register: r, pfade: pfade())
    #expect(b.text("schnell-erfassen") == "Ctrl+Alt+Space")
    #expect(b.kuerzel("schnell-erfassen") == .standard)
    #expect(b.text("frage-global") == nil)
    #expect(b.text("palette") == "Cmd+K")
    #expect(!b.istGeaendert("palette"))
    #expect(b.gewinner()["Cmd+K"] == "palette")
}

@Test func eigenesUndOhneKuerzelAusDerDatei_UngueltigesWirdIgnoriert() throws {
    let r = try register(), p = pfade()
    try FileManager.default.createDirectory(at: p.basis, withIntermediateDirectories: true)
    let json = #"{"schema":1,"kuerzel":{"neue-notiz":"Cmd+T","palette":null,"gibtsnicht":"Cmd+X","frage":"kaputt","info":5}}"#
    try json.write(to: KuerzelBelegung.datei(p), atomically: true, encoding: .utf8)
    let b = KuerzelBelegung.laden(register: r, pfade: p)
    #expect(b.text("neue-notiz") == "Cmd+T" && b.istGeaendert("neue-notiz"))
    #expect(b.text("palette") == nil && b.istGeaendert("palette"))
    #expect(b.text("frage") == "Cmd+J", "ungültig = Standard")
    #expect(b.text("info") == "Alt+Cmd+I")
    // kaputte Datei → Standardwerte, kein Fehler
    try "{ kein json".write(to: KuerzelBelegung.datei(p), atomically: true, encoding: .utf8)
    #expect(KuerzelBelegung.laden(register: r, pfade: p).text("neue-notiz") == "Cmd+N")
}

@Test func beiDoppelterBelegungGewinntDasGeaenderteKuerzel() throws {
    let r = try register()
    let b = KuerzelBelegung(register: r, eigenes: ["neue-notiz": .kuerzel("Cmd+K")]) // wie „Trotzdem nehmen“
    #expect(b.gewinner()["Cmd+K"] == "neue-notiz")
    #expect(KuerzelBelegung(register: r).gewinner()["Cmd+K"] == "palette")
}

@Test func speichernSchreibtNurDieAbweichungUndLaesstDieRestlichenEintraegeStehen() throws {
    let r = try register(), p = pfade()
    #expect(KuerzelBelegung.speichere(id: "neue-notiz", .kuerzel("Cmd+T"), register: r, pfade: p))
    #expect(KuerzelBelegung.speichere(id: "palette", .ohne, register: r, pfade: p))
    var j = try #require(try JSONSerialization.jsonObject(with: Data(contentsOf: KuerzelBelegung.datei(p))) as? [String: Any])
    #expect(j["schema"] as? Int == 1)
    #expect((j["kuerzel"] as? [String: Any])?["neue-notiz"] as? String == "Cmd+T")
    #expect((j["kuerzel"] as? [String: Any])?["palette"] is NSNull)
    // gleich dem Standard → Eintrag entfällt; ohne Eintrag bleibt nichts → Datei weg
    #expect(KuerzelBelegung.speichere(id: "neue-notiz", .kuerzel("Cmd+N"), register: r, pfade: p))
    j = try #require(try JSONSerialization.jsonObject(with: Data(contentsOf: KuerzelBelegung.datei(p))) as? [String: Any])
    #expect((j["kuerzel"] as? [String: Any])?.keys.sorted() == ["palette"])
    #expect(KuerzelBelegung.speichere(id: "palette", nil, register: r, pfade: p))
    #expect(!FileManager.default.fileExists(atPath: KuerzelBelegung.datei(p).path))
    #expect(!KuerzelBelegung.speichere(id: "gibtsnicht", .ohne, register: r, pfade: p))
    #expect(!KuerzelBelegung.speichere(id: "neue-notiz", .kuerzel("Cmd+Esc"), register: r, pfade: p))
}

@Test func eineKaputteDateiWirdNieUeberschrieben() throws {
    let r = try register(), p = pfade()
    try FileManager.default.createDirectory(at: p.basis, withIntermediateDirectories: true)
    try "{ kein json".write(to: KuerzelBelegung.datei(p), atomically: true, encoding: .utf8)
    #expect(!KuerzelBelegung.speichere(id: "neue-notiz", .kuerzel("Cmd+T"), register: r, pfade: p))
    #expect(try String(contentsOf: KuerzelBelegung.datei(p), encoding: .utf8) == "{ kein json")
}

@Test func dasAlteKuerzelAusSchnellErfassenJsonWandertEinmaligInDieNeueDatei() throws {
    let r = try register(), p = pfade()
    try ErfassenEinstellungen(kuerzel: Tastenkuerzel(taste: 14, umschalter: [.control, .option, .command]), art: .notiz).speichere(p)
    KuerzelBelegung.uebernimmAlteDatei(register: r, pfade: p)
    #expect(KuerzelBelegung.laden(register: r, pfade: p).text("schnell-erfassen") == "Ctrl+Alt+Cmd+E")
    let alt = ErfassenEinstellungen.lade(p)
    #expect(alt.kuerzel == nil && alt.art == .notiz, "nur das Kürzel zieht um, die Art bleibt")
    // zurücksetzen auf den Standard (im Studio) bringt das alte nicht zurück
    #expect(KuerzelBelegung.speichere(id: "schnell-erfassen", nil, register: r, pfade: p))
    KuerzelBelegung.uebernimmAlteDatei(register: r, pfade: p)
    #expect(KuerzelBelegung.laden(register: r, pfade: p).text("schnell-erfassen") == "Ctrl+Alt+Space")
}

@Test func einAltesKuerzelDasDemStandardGleichtLegtKeineDateiAn() throws {
    let r = try register(), p = pfade()
    try ErfassenEinstellungen(kuerzel: .standard).speichere(p)
    KuerzelBelegung.uebernimmAlteDatei(register: r, pfade: p)
    #expect(!FileManager.default.fileExists(atPath: KuerzelBelegung.datei(p).path))
    #expect(ErfassenEinstellungen.lade(p).kuerzel == nil)
}

// MARK: Globale Kürzel — Neuanmeldung ohne Neustart

/// Eine GlobaleKuerzel-Anlage mit Attrappen je Befehl; `belegt` lässt die Anmeldung bestimmter Kürzel scheitern (ein anderes Programm hält sie).
@MainActor private func anlage(system: [SystemKuerzel] = [], belegt: [Tastenkuerzel] = []) throws -> (g: GlobaleKuerzel, regs: Box, ausgeloest: Ausloeser) {
    let reg = try register()
    let box = Box(), aus = Ausloeser()
    let g = GlobaleKuerzel(register: reg, system: { system }, fabrik: { _ in
        let f = FalscheRegistrierung()
        f.belegt = belegt
        box.liste.append(f)
        return f
    })
    for id in ["schnell-erfassen", "frage-global", "kortex-zeigen"] { g.setzeAktion(id) { aus.liste.append(id) } }
    return (g, box, aus)
}
@MainActor private final class Box { var liste: [FalscheRegistrierung] = [] }
@MainActor private final class Ausloeser { var liste: [String] = [] }

@MainActor @Test func beimStartWirdDasStandardkuerzelAngemeldetUndLoestSeineAktionAus() throws {
    let (g, regs, aus) = try anlage()
    let b = KuerzelBelegung(register: try register())
    #expect(g.wendeAn(b, start: true).isEmpty)
    #expect(g.angemeldet == ["schnell-erfassen": .standard], "die anderen globalen Befehle haben ab Werk kein Kürzel")
    #expect(regs.liste.count == 1)
    regs.liste[0].druecke()
    #expect(aus.liste == ["schnell-erfassen"])
}

@MainActor @Test func einGeaendertesKuerzelWirdOhneNeustartNeuAngemeldet() throws {
    let (g, regs, aus) = try anlage()
    let r = try register()
    g.wendeAn(KuerzelBelegung(register: r), start: true)
    let alt = regs.liste[0]
    // Das Studio hat tastenkuerzel.json geändert → die App liest neu → wendeAn
    let neu = KuerzelBelegung(register: r, eigenes: ["schnell-erfassen": .kuerzel("Ctrl+Alt+Cmd+E")])
    #expect(g.wendeAn(neu).isEmpty)
    #expect(g.angemeldet["schnell-erfassen"] == Tastenkuerzel(taste: 14, umschalter: [.control, .option, .command]))
    #expect(alt.angemeldet == Tastenkuerzel(taste: 14, umschalter: [.control, .option, .command]), "dieselbe Anmeldung wird umgestellt, nicht verdoppelt")
    alt.druecke()
    #expect(aus.liste == ["schnell-erfassen"])
    // ein zweites globales Kürzel bekommt seine eigene Anmeldung
    let drei = KuerzelBelegung(register: r, eigenes: ["schnell-erfassen": .kuerzel("Ctrl+Alt+Cmd+E"), "frage-global": .kuerzel("Ctrl+Alt+Cmd+J")])
    #expect(g.wendeAn(drei).isEmpty)
    #expect(Set(g.angemeldet.keys) == ["schnell-erfassen", "frage-global"])
    #expect(regs.liste.count == 2)
    regs.liste[1].druecke()
    #expect(aus.liste == ["schnell-erfassen", "frage-global"])
}

@MainActor @Test func keinKuerzelMeldetAbUndSpaeterWiederAn() throws {
    let (g, regs, _) = try anlage()
    let r = try register()
    g.wendeAn(KuerzelBelegung(register: r), start: true)
    #expect(g.wendeAn(KuerzelBelegung(register: r, eigenes: ["schnell-erfassen": .ohne])).isEmpty)
    #expect(g.angemeldet.isEmpty)
    #expect(regs.liste[0].angemeldet == nil, "beim System abgemeldet")
    #expect(g.wendeAn(KuerzelBelegung(register: r)).isEmpty)
    #expect(g.angemeldet["schnell-erfassen"] == .standard)
}

@MainActor @Test func reservierteKuerzelWerdenAbgelehntUndDasAlteBleibtAngemeldet() throws {
    let (g, regs, _) = try anlage()
    let r = try register()
    g.wendeAn(KuerzelBelegung(register: r), start: true)
    // KuerzelBelegung nimmt auch Reserviertes an (die Datei ist nur eine Datei) — die Anmeldung weist es ab
    for (text, grund) in [("Cmd+Q", "Kortex beenden"), ("Cmd+Tab", "Zwischen Programmen wechseln"), ("Cmd+Space", "Spotlight")] {
        let fehler = g.wendeAn(KuerzelBelegung(register: r, eigenes: ["schnell-erfassen": .kuerzel(text)]))
        #expect(fehler["schnell-erfassen"]?.contains(grund) == true, "\(text): \(fehler)")
        #expect(g.angemeldet["schnell-erfassen"] == .standard, "\(text): das alte Kürzel bleibt")
        #expect(regs.liste[0].angemeldet == .standard)
    }
    // ebenso beim Prüfen aus dem Studio (kuerzel-global)
    let k = try #require(Tastenkuerzel(kanonisch: "Cmd+Q"))
    #expect(g.setze("schnell-erfassen", k, speichern: false)?.contains("Kortex beenden") == true)
}

@MainActor @Test func einKuerzelOhneControlOderBefehlWirdAbgelehnt() throws {
    let (g, _, _) = try anlage()
    g.wendeAn(KuerzelBelegung(register: try register()), start: true)
    let k = try #require(Tastenkuerzel(kanonisch: "Alt+Space"))
    #expect(g.setze("schnell-erfassen", k, speichern: false)?.contains("⌃ (Control) oder ⌘") == true)
}

@MainActor @Test func einVomSystemVergebenesKuerzelWirdBeiEinerAenderungAbgelehnt() throws {
    let spotlight = SystemKuerzel(name: "Spotlight-Suche", taste: 40, umschalter: [.control, .option, .command]) // ⌃⌥⌘K, nur für den Test
    let (g, regs, _) = try anlage(system: [spotlight])
    g.wendeAn(KuerzelBelegung(register: try register()), start: true)
    let fehler = g.wendeAn(KuerzelBelegung(register: try register(), eigenes: ["schnell-erfassen": .kuerzel("Ctrl+Alt+Cmd+K")]))
    #expect(fehler["schnell-erfassen"]?.contains("Spotlight-Suche") == true)
    #expect(g.angemeldet["schnell-erfassen"] == .standard && regs.liste[0].angemeldet == .standard)
}

@MainActor @Test func einVonEinemAnderenProgrammGehaltenesKuerzelWirdGemeldetUndDasAlteBleibt() throws {
    let gehalten = try #require(Tastenkuerzel(kanonisch: "Ctrl+Alt+Cmd+J"))
    let (g, regs, _) = try anlage(belegt: [gehalten])
    let r = try register()
    g.wendeAn(KuerzelBelegung(register: r), start: true)
    let fehler = g.wendeAn(KuerzelBelegung(register: r, eigenes: ["schnell-erfassen": .kuerzel("Ctrl+Alt+Cmd+J")]))
    #expect(fehler["schnell-erfassen"]?.contains("belegt") == true, "\(fehler)")
    #expect(g.angemeldet["schnell-erfassen"] == .standard)
    #expect(regs.liste[0].angemeldet == .standard, "nach dem gescheiterten Versuch hängt das alte wieder")
    // ein neues globales Kürzel (noch ohne Anmeldung) mit demselben Problem: abgelehnt, nichts angemeldet
    #expect(g.setze("frage-global", gehalten, speichern: false)?.contains("belegt") == true)
    #expect(g.angemeldet["frage-global"] == nil)
}

@MainActor @Test func einVomSystemNachtraeglichBelegtesKuerzelGiltBeimStartTrotzdemMitHinweis() throws {
    let system = SystemKuerzel(name: "Nächste Eingabequelle", taste: 49, umschalter: [.control, .option])
    let (g, _, _) = try anlage(system: [system])
    let hinweise = g.wendeAn(KuerzelBelegung(register: try register()), start: true)
    #expect(hinweise["schnell-erfassen"]?.contains("Nächste Eingabequelle") == true)
    #expect(g.angemeldet["schnell-erfassen"] == .standard, "wie bisher: angemeldet, wenn das System es zulässt, mit Warnung")
}

@MainActor @Test func dieAppSelbstMeldetEineAenderungUndDieDateiBekommtSie() throws {
    // Änderung im schwebenden Erfassen-Fenster: prüfen, anmelden — `beiAenderung` bekommt den Wert, damit der Aufrufer die Datei schreibt
    let (g, _, _) = try anlage()
    let r = try register(), p = pfade()
    g.wendeAn(KuerzelBelegung(register: r), start: true)
    var gemeldet: [(String, Tastenkuerzel?)] = []
    g.beiAenderung = { id, k in gemeldet.append((id, k)); KuerzelBelegung.speichere(id: id, k.flatMap { $0.kanonisch }.map { .kuerzel($0) } ?? .ohne, register: r, pfade: p) }
    let neu = try #require(Tastenkuerzel(kanonisch: "Ctrl+Alt+Cmd+E"))
    #expect(g.setze("schnell-erfassen", neu, speichern: true) == nil)
    #expect(gemeldet.count == 1 && gemeldet[0].0 == "schnell-erfassen" && gemeldet[0].1 == neu)
    #expect(KuerzelBelegung.laden(register: r, pfade: p).kuerzel("schnell-erfassen") == neu)
    // ein Fehler meldet nichts
    #expect(g.setze("schnell-erfassen", try #require(Tastenkuerzel(kanonisch: "Cmd+Q")), speichern: true) != nil)
    #expect(gemeldet.count == 1)
    // und das Prüfen aus dem Studio (speichern: false) schreibt nichts
    #expect(g.setze("schnell-erfassen", .standard, speichern: false) == nil)
    #expect(gemeldet.count == 1)
}

@MainActor @Test func nurGlobaleBefehleMitAktionLassenSichAnmelden() throws {
    let (g, _, _) = try anlage()
    let k = try #require(Tastenkuerzel(kanonisch: "Ctrl+Alt+Cmd+N"))
    #expect(g.setze("neue-notiz", k, speichern: false) != nil, "ein Studio-Befehl ist kein globales Kürzel")
    #expect(g.setze("gibtsnicht", k, speichern: false) != nil)
}

// MARK: Echter Test: ein belegtes Kürzel beim System

/// Meldet ⌃⌥⌘F19 über `GlobaleKuerzel` wirklich beim System an (Carbon, ohne Recht) — ein zweites Objekt und ein zweiter globaler Befehl bekommen „belegt“, solange es gehalten wird.
/// Nur mit Bildschirm-Sitzung.
@MainActor @Test(.enabled(if: NSScreen.main != nil)) func einEchtBelegtesKuerzelMeldetGlobaleKuerzelMitGrund() throws {
    let reg = try register()
    var kennung: UInt32 = 100
    let g = GlobaleKuerzel(register: reg, system: { [] }, fabrik: { _ in kennung += 1; return CarbonKuerzel(kennung: kennung) })
    for id in ["schnell-erfassen", "frage-global", "kortex-zeigen"] { g.setzeAktion(id) {} }
    let k = try #require(Tastenkuerzel(kanonisch: "Ctrl+Alt+Cmd+F19"))
    defer { g.beende() }
    #expect(g.setze("schnell-erfassen", k, speichern: false) == nil)
    let fremd = CarbonKuerzel(kennung: 7)
    #expect(throws: KuerzelFehler.belegt) { try fremd.registriere(k, aktion: {}) } // wie ein anderes Programm, das es hält
    let text = g.setze("frage-global", k, speichern: false)
    #expect(text?.contains("belegt") == true, "\(String(describing: text))")
    #expect(g.angemeldet["frage-global"] == nil)
    #expect(g.setze("schnell-erfassen", nil, speichern: false) == nil) // abmelden gibt es frei
    #expect(g.setze("frage-global", k, speichern: false) == nil)
}

// MARK: Aktionen des Studios

@Test func dieAktionenDerKuerzelGeltenNurFuerDasStudio() throws {
    let v = tempOrdner("Vault")
    #expect(AppAktion.pruefe(["aktion": "kuerzel-geaendert"], vault: v, oberflaeche: .studio) == .kuerzelGeaendert)
    #expect(AppAktion.pruefe(["aktion": "kuerzel-geaendert"], vault: v) == nil, "die Übersicht darf das nicht")
    let w: [String: Any] = ["id": "schnell-erfassen", "kuerzel": "Ctrl+Alt+Space"]
    #expect(AppAktion.pruefe(["aktion": "kuerzel-global", "wert": w], vault: v, oberflaeche: .studio) == .kuerzelGlobal(id: "schnell-erfassen", kuerzel: "Ctrl+Alt+Space"))
    #expect(AppAktion.pruefe(["aktion": "kuerzel-global", "wert": w], vault: v) == nil)
    #expect(AppAktion.pruefe(["aktion": "kuerzel-global", "wert": ["id": "frage-global", "kuerzel": NSNull()] as [String: Any]], vault: v, oberflaeche: .studio) == .kuerzelGlobal(id: "frage-global", kuerzel: nil))
    #expect(AppAktion.pruefe(["aktion": "kuerzel-global", "wert": ["id": "frage-global"] as [String: Any]], vault: v, oberflaeche: .studio) == .kuerzelGlobal(id: "frage-global", kuerzel: nil))
    for schlecht in [["id": "Böse Id", "kuerzel": "Cmd+K"], ["id": "../x", "kuerzel": "Cmd+K"], ["id": "", "kuerzel": "Cmd+K"], ["id": "a", "kuerzel": String(repeating: "x", count: 41)], ["id": "a", "kuerzel": ""]] as [[String: Any]] {
        #expect(AppAktion.pruefe(["aktion": "kuerzel-global", "wert": schlecht], vault: v, oberflaeche: .studio) == nil, "\(schlecht)")
    }
    #expect(AppAktion.pruefe(["aktion": "kuerzel-global", "wert": "text"], vault: v, oberflaeche: .studio) == nil)
}
