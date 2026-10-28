import Testing
import Foundation
@testable import BrainCore

/// Statusdatei des Kit-Wächters (`.logs/zufuehrungen.json`, Kit-PR #13 / FBL-93).
private let dateiJSON = #"""
{ "version": 1, "erstellt": "2026-10-28T09:00:00Z", "probleme": 2,
  "zufuehrungen": [
    { "name": "Notizen-Sync", "pfad": "~/Sync/notizen", "status": "still", "letzterLauf": "2026-10-20T08:00:00Z", "alterTage": 8, "maxAlterTage": 7 },
    { "name": "Mail-Import", "pfad": "/gibt/es/nicht", "status": "fehlt", "letzterLauf": null, "alterTage": null, "maxAlterTage": 7 },
    { "name": "Browser", "pfad": "~/B", "status": "ok", "letzterLauf": "2026-10-28T08:00:00Z", "alterTage": 0, "maxAlterTage": 7 }
  ] }
"""#

/// Feste „Jetzt“-Zeit für alle Tests: 28.10.2026, 10:00 UTC (eine Stunde nach `erstellt` der Beispieldatei).
private let jetzt = ISO8601DateFormatter().date(from: "2026-10-28T10:00:00Z")!
private func laden(_ vault: URL, jetzt: Date = jetzt) -> ZufuehrungenStand { ZufuehrungenStand.lade(vault: vault, jetzt: jetzt) }

private func vaultMitDatei(_ inhalt: String?) -> URL {
    let vault = tempOrdner()
    if let inhalt {
        let logs = vault.appendingPathComponent(".logs", isDirectory: true)
        try! FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true)
        try! inhalt.write(to: logs.appendingPathComponent("zufuehrungen.json"), atomically: true, encoding: .utf8)
    }
    return vault
}

@Test func fehlendeDateiIstNeutralKeinFehler() {
    let s = laden(vaultMitDatei(nil))
    #expect(s == .keine)
    #expect(s.problemAnzahl == 0)
    #expect(s.warnung == nil)
    #expect(s.menueZeilen.isEmpty)
}

@Test func dateiWirdGelesenUndProblemeWerdenAusDenEintraegenGezaehlt() {
    let s = laden(vaultMitDatei(dateiJSON))
    guard case .stand(let erstellt, let eintraege, let veraltet) = s else { Issue.record("Stand erwartet: \(s)"); return }
    #expect(erstellt == "2026-10-28T09:00:00Z")
    #expect(!veraltet)
    #expect(eintraege.count == 3)
    #expect(s.problemAnzahl == 2)
    #expect(s.warnung == "2 Zuführungen mit Problem")
    #expect(s.menueZeilen == ["Zuführung „Notizen-Sync“ steht seit 20.10.2026 still (8 Tage)", "Zuführung „Mail-Import“: Pfad fehlt"])
}

@Test func nurDieEintraegeZaehlenNichtDieZahlProblemeAusDerDatei() {
    // „probleme“ ist nur eine Bequemlichkeit des Kits: ein falscher Wert darf weder ⚠ erzwingen noch verhindern.
    let ok = #"{"version":1,"erstellt":"2026-10-28T09:00:00Z","probleme":5,"zufuehrungen":[{"name":"A","pfad":"x","status":"ok","letzterLauf":null,"alterTage":0,"maxAlterTage":7}]}"#
    #expect(laden(vaultMitDatei(ok)).problemAnzahl == 0)
    let still = #"{"version":1,"probleme":0,"zufuehrungen":[{"name":"A","pfad":"x","status":"still","alterTage":1}]}"#
    #expect(laden(vaultMitDatei(still)).problemAnzahl == 1)
}

@Test func einEintragHatEinenEinzelnenSatz() {
    let s = laden(vaultMitDatei(#"{"version":1,"zufuehrungen":[{"name":"Sync","pfad":"p","status":"still","letzterLauf":"2026-10-27T01:00:00Z","alterTage":1,"maxAlterTage":1}]}"#))
    #expect(s.warnung == "Zuführung „Sync“ steht still")
    #expect(s.menueZeilen == ["Zuführung „Sync“ steht seit 27.10.2026 still (1 Tag)"])
}

@Test func einzelnesProblemOhneStillstandWirdNichtAlsStillstandBezeichnet() {
    let s = laden(vaultMitDatei(#"{"version":1,"zufuehrungen":[{"name":"Mail","pfad":"p","status":"fehlt"}]}"#))
    #expect(s.warnung == "Zuführung „Mail“ mit Problem")
}

@Test func alleStatusWerteHabenEinenSatzUnbekanntesIstEinProblem() {
    func zeile(_ status: String) -> String {
        let s = laden(vaultMitDatei(
            #"{"version":1,"zufuehrungen":[{"name":"Q","pfad":"p","status":"\#(status)","letzterLauf":null,"alterTage":null}]}"#))
        return s.menueZeilen.first ?? "(keine)"
    }
    #expect(zeile("nicht-lesbar") == "Zuführung „Q“: nicht lesbar (Rechte prüfen)")
    #expect(zeile("config") == "Zuführung „Q“: Eintrag unvollständig (kein Pfad)")
    #expect(zeile("still") == "Zuführung „Q“ steht still")
    #expect(zeile("kaputt-neu") == "Zuführung „Q“: Problem (kaputt-neu)")
    #expect(zeile("ok") == "(keine)")
}

@Test func kaputteOderUnlesbareDateiIstEinSichtbarerFehlerNieStill() {
    for inhalt in ["kein json", "", "[]", #"{"version":1}"#, #"{"version":1,"zufuehrungen":[{"pfad":"x"}]}"#] {
        let s = laden(vaultMitDatei(inhalt))
        #expect(s == .unlesbar, "Inhalt: \(inhalt)")
        #expect(s.problemAnzahl == 1)
        #expect(s.warnung == "Zuführungs-Status nicht lesbar")
        #expect(s.menueZeilen == ["Zuführungs-Status nicht lesbar (.logs/zufuehrungen.json)"])
    }
}

@Test func leereListeIstInOrdnung() {
    let s = laden(vaultMitDatei(#"{"version":1,"erstellt":"2026-10-28T09:00:00Z","probleme":0,"zufuehrungen":[]}"#))
    #expect(s.problemAnzahl == 0)
    #expect(s.warnung == nil)
}

@Test func uebergrosseDateiUndSymlinkWerdenNichtGelesen() throws {
    #expect(laden(vaultMitDatei(String(repeating: " ", count: 1_100_000))) == .unlesbar)
    // Symlink aus dem Vault heraus: nicht folgen — und nicht so tun, als gäbe es nichts
    let vault = tempOrdner()
    let ziel = tempOrdner().appendingPathComponent("fremd.json")
    try dateiJSON.write(to: ziel, atomically: true, encoding: .utf8)
    let logs = vault.appendingPathComponent(".logs", isDirectory: true)
    try FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true)
    try FileManager.default.createSymbolicLink(at: logs.appendingPathComponent("zufuehrungen.json"), withDestinationURL: ziel)
    #expect(laden(vault) == .unlesbar)
}

@Test func menueleisteZeigtWarnungNurWennSonstAllesInOrdnung() throws {
    let ok = StatusAnzeige.fuer(try BrainStatus.aus(ausgabe: #"{"version":"1","quellVault":false,"zustand":"ok","meldungen":[],"zahlen":{"vorschlaege":0,"konflikte":0,"abgelaufen":0,"zuTun":0}}"#))
    #expect(ok.zeichen == "✓")
    let stand = laden(vaultMitDatei(dateiJSON))
    let warn = ok.mit(zufuehrungen: stand)
    #expect(warn.zeichen == "⚠")
    #expect(warn.symbol == "exclamationmark.triangle")
    #expect(warn.titel == "2 Zuführungen mit Problem")
    // neutral: nichts ändert sich
    #expect(ok.mit(zufuehrungen: .keine) == ok)
    // ein Problem- oder Sperr-Zustand behält seine Aussage (✕ steht über ⚠)
    for anders in [StatusAnzeige.problem("x"), .keinVault, .kitNichtErlaubt, .kitPruefungFehlgeschlagen] {
        #expect(anders.mit(zufuehrungen: stand) == anders)
    }
    // ein bereits gelber Status bleibt (⚠ ist schon da, die Zeilen im Menü nennen die Zuführung)
    let hinweis = StatusAnzeige(symbol: "exclamationmark.triangle", zeichen: "⚠", titel: "2 Sachen warten")
    #expect(hinweis.mit(zufuehrungen: stand) == hinweis)
    // „Vault ohne Kit“ (✓) zeigt die Warnung ebenfalls
    #expect(StatusAnzeige.ohneKit.mit(zufuehrungen: stand).zeichen == "⚠")
}

@Test func kommazahlenInDerDateiMachenSieNichtUnlesbar() {
    // Das Kit schreibt maxAlterTage/alterTage mit Number() ungerundet, z. B. 1.5.
    let s = laden(vaultMitDatei(#"{"version":1,"erstellt":"2026-10-28T09:00:00Z","zufuehrungen":[{"name":"Sync","pfad":"p","status":"still","letzterLauf":"2026-10-26T20:00:00Z","alterTage":1.5,"maxAlterTage":1.5},{"name":"B","pfad":"q","status":"ok","letzterLauf":null,"alterTage":0.25,"maxAlterTage":0.5}]}"#))
    #expect(s != .unlesbar)
    #expect(s.problemAnzahl == 1)
    #expect(s.menueZeilen == ["Zuführung „Sync“ steht seit 26.10.2026 still (2 Tage)"])
    // ganze Zahlen bleiben wie gehabt
    let eins = laden(vaultMitDatei(#"{"version":1,"zufuehrungen":[{"name":"S","pfad":"p","status":"still","letzterLauf":"2026-10-27T01:00:00Z","alterTage":1,"maxAlterTage":1}]}"#))
    #expect(eins.menueZeilen == ["Zuführung „S“ steht seit 27.10.2026 still (1 Tag)"])
}

@Test func symlinkAlsLogsOrdnerOderLogsAlsDateiIstUnlesbar() throws {
    let fremd = tempOrdner()
    try FileManager.default.createDirectory(at: fremd.appendingPathComponent(".logs"), withIntermediateDirectories: true)
    try dateiJSON.write(to: fremd.appendingPathComponent(".logs/zufuehrungen.json"), atomically: true, encoding: .utf8)
    let vault = tempOrdner()
    try FileManager.default.createSymbolicLink(at: vault.appendingPathComponent(".logs"), withDestinationURL: fremd.appendingPathComponent(".logs"))
    #expect(laden(vault) == .unlesbar)
    let datei = tempOrdner()
    try "x".write(to: datei.appendingPathComponent(".logs"), atomically: true, encoding: .utf8)
    #expect(laden(datei) == .unlesbar)
    // ein normaler Vault ohne .logs bleibt neutral
    #expect(laden(tempOrdner()) == .keine)
}

@Test func veralteteStatusdateiMeldetDassDerWaechterNichtLaeuft() {
    // Frist: max(14 Tage, 2 × größtes maxAlterTage)
    func datei(erstellt: String, max: String = "7") -> String {
        #"{"version":1,"erstellt":"\#(erstellt)","probleme":0,"zufuehrungen":[{"name":"A","pfad":"x","status":"ok","letzterLauf":"2026-10-27T00:00:00Z","alterTage":1,"maxAlterTage":\#(max)}]}"#
    }
    // 13 Tage alt: noch in der Frist
    #expect(!laden(vaultMitDatei(datei(erstellt: "2026-10-15T10:00:00Z"))).istVeraltet)
    // 15 Tage alt: veraltet — ⚠ und Zeile, obwohl kein Eintrag ein Problem hat
    let alt = laden(vaultMitDatei(datei(erstellt: "2026-10-13T09:00:00Z")))
    #expect(alt.istVeraltet)
    #expect(alt.problemAnzahl == 1)
    #expect(alt.warnung == "Zuführungs-Wächter läuft nicht")
    #expect(alt.menueZeilen == ["Zuführungs-Status vom 13.10.2026 — Wächter läuft nicht"])
    // bei großem maxAlterTage (30) ist die Frist 60 Tage
    #expect(!laden(vaultMitDatei(datei(erstellt: "2026-09-13T09:00:00Z", max: "30"))).istVeraltet)
    #expect(laden(vaultMitDatei(datei(erstellt: "2026-08-20T09:00:00Z", max: "30"))).istVeraltet)
    // die Menüleiste zeigt ⚠ statt ✓
    #expect(StatusAnzeige.ohneKit.mit(zufuehrungen: alt).zeichen == "⚠")
    #expect(StatusAnzeige.ohneKit.mit(zufuehrungen: alt).titel == "Zuführungs-Wächter läuft nicht")
    // veraltet UND Problem: beide Zeilen, der Stand-Hinweis zuerst
    let beides = laden(vaultMitDatei(#"{"version":1,"erstellt":"2026-10-01T09:00:00Z","zufuehrungen":[{"name":"A","pfad":"x","status":"fehlt"}]}"#))
    #expect(beides.problemAnzahl == 2)
    #expect(beides.menueZeilen == ["Zuführungs-Status vom 01.10.2026 — Wächter läuft nicht", "Zuführung „A“: Pfad fehlt"])
    // ohne oder mit kaputtem „erstellt“, oder in der Zukunft: kein Alarm (Alter nicht beurteilbar)
    #expect(!laden(vaultMitDatei(#"{"version":1,"zufuehrungen":[]}"#)).istVeraltet)
    #expect(!laden(vaultMitDatei(datei(erstellt: "gestern"))).istVeraltet)
    #expect(!laden(vaultMitDatei(datei(erstellt: "2027-01-01T00:00:00Z"))).istVeraltet)
}
