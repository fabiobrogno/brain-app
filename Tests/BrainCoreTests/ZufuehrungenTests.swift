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
    let s = ZufuehrungenStand.lade(vault: vaultMitDatei(nil))
    #expect(s == .keine)
    #expect(s.problemAnzahl == 0)
    #expect(s.warnung == nil)
    #expect(s.menueZeilen.isEmpty)
}

@Test func dateiWirdGelesenUndProblemeWerdenAusDenEintraegenGezaehlt() {
    let s = ZufuehrungenStand.lade(vault: vaultMitDatei(dateiJSON))
    guard case .stand(let erstellt, let eintraege) = s else { Issue.record("Stand erwartet: \(s)"); return }
    #expect(erstellt == "2026-10-28T09:00:00Z")
    #expect(eintraege.count == 3)
    #expect(s.problemAnzahl == 2)
    #expect(s.warnung == "2 Zuführungen mit Problem")
    #expect(s.menueZeilen == ["Zuführung „Notizen-Sync“ steht seit 20.10.2026 still (8 Tage)", "Zuführung „Mail-Import“: Pfad fehlt"])
}

@Test func nurDieEintraegeZaehlenNichtDieZahlProblemeAusDerDatei() {
    // „probleme“ ist nur eine Bequemlichkeit des Kits: ein falscher Wert darf weder ⚠ erzwingen noch verhindern.
    let ok = #"{"version":1,"erstellt":"2026-10-28T09:00:00Z","probleme":5,"zufuehrungen":[{"name":"A","pfad":"x","status":"ok","letzterLauf":null,"alterTage":0,"maxAlterTage":7}]}"#
    #expect(ZufuehrungenStand.lade(vault: vaultMitDatei(ok)).problemAnzahl == 0)
    let still = #"{"version":1,"probleme":0,"zufuehrungen":[{"name":"A","pfad":"x","status":"still","alterTage":1}]}"#
    #expect(ZufuehrungenStand.lade(vault: vaultMitDatei(still)).problemAnzahl == 1)
}

@Test func einEintragHatEinenEinzelnenSatz() {
    let s = ZufuehrungenStand.lade(vault: vaultMitDatei(#"{"version":1,"zufuehrungen":[{"name":"Sync","pfad":"p","status":"still","letzterLauf":"2026-10-27T01:00:00Z","alterTage":1,"maxAlterTage":1}]}"#))
    #expect(s.warnung == "Zuführung „Sync“ steht still")
    #expect(s.menueZeilen == ["Zuführung „Sync“ steht seit 27.10.2026 still (1 Tag)"])
}

@Test func einzelnesProblemOhneStillstandWirdNichtAlsStillstandBezeichnet() {
    let s = ZufuehrungenStand.lade(vault: vaultMitDatei(#"{"version":1,"zufuehrungen":[{"name":"Mail","pfad":"p","status":"fehlt"}]}"#))
    #expect(s.warnung == "Zuführung „Mail“ mit Problem")
}

@Test func alleStatusWerteHabenEinenSatzUnbekanntesIstEinProblem() {
    func zeile(_ status: String) -> String {
        let s = ZufuehrungenStand.lade(vault: vaultMitDatei(
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
        let s = ZufuehrungenStand.lade(vault: vaultMitDatei(inhalt))
        #expect(s == .unlesbar, "Inhalt: \(inhalt)")
        #expect(s.problemAnzahl == 1)
        #expect(s.warnung == "Zuführungs-Status nicht lesbar")
        #expect(s.menueZeilen == ["Zuführungs-Status nicht lesbar (.logs/zufuehrungen.json)"])
    }
}

@Test func leereListeIstInOrdnung() {
    let s = ZufuehrungenStand.lade(vault: vaultMitDatei(#"{"version":1,"erstellt":"2026-10-28T09:00:00Z","probleme":0,"zufuehrungen":[]}"#))
    #expect(s.problemAnzahl == 0)
    #expect(s.warnung == nil)
}

@Test func uebergrosseDateiUndSymlinkWerdenNichtGelesen() throws {
    #expect(ZufuehrungenStand.lade(vault: vaultMitDatei(String(repeating: " ", count: 1_100_000))) == .unlesbar)
    // Symlink aus dem Vault heraus: nicht folgen — und nicht so tun, als gäbe es nichts
    let vault = tempOrdner()
    let ziel = tempOrdner().appendingPathComponent("fremd.json")
    try dateiJSON.write(to: ziel, atomically: true, encoding: .utf8)
    let logs = vault.appendingPathComponent(".logs", isDirectory: true)
    try FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true)
    try FileManager.default.createSymbolicLink(at: logs.appendingPathComponent("zufuehrungen.json"), withDestinationURL: ziel)
    #expect(ZufuehrungenStand.lade(vault: vault) == .unlesbar)
}

@Test func menueleisteZeigtWarnungNurWennSonstAllesInOrdnung() throws {
    let ok = StatusAnzeige.fuer(try BrainStatus.aus(ausgabe: #"{"version":"1","quellVault":false,"zustand":"ok","meldungen":[],"zahlen":{"vorschlaege":0,"konflikte":0,"abgelaufen":0,"zuTun":0}}"#))
    #expect(ok.zeichen == "✓")
    let stand = ZufuehrungenStand.lade(vault: vaultMitDatei(dateiJSON))
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
