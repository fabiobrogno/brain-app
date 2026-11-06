import Testing
import Foundation
import CoreGraphics
@testable import BrainCore

// MARK: Prüfung der Aktionen der Einrichtung (Overlay im Studio)

@Test func gitAktionenGeltenNurFuerDasStudio() {
    for name in ["git-pruefen", "git-installieren"] {
        let erwartet: AppAktion = name == "git-pruefen" ? .gitPruefen : .gitInstallieren
        #expect(AppAktion.pruefe(["aktion": name], vault: nil, oberflaeche: .studio) == erwartet, "\(name)")
        // ein Wert dazu ändert nichts
        #expect(AppAktion.pruefe(["aktion": name, "wert": "egal"], vault: nil, oberflaeche: .studio) == erwartet, "\(name)")
        #expect(AppAktion.pruefe(["aktion": name], vault: nil, oberflaeche: .app) == nil, "\(name)")
        #expect(AppAktion.pruefe(["aktion": name], vault: nil) == nil, "\(name): ohne Angabe gilt die strengste Herkunft")
    }
    for name in ["git_pruefen", "gitPruefen", "git-pruefen ", "Git-pruefen", "git"] {
        #expect(AppAktion.pruefe(["aktion": name], vault: nil, oberflaeche: .studio) == nil, "\(name)")
    }
}

@Test func kopierenNimmtNurEinzeiligenDruckbarenTextBis400Zeichen() {
    func pruefe(_ wert: Any?, _ o: Oberflaeche = .studio) -> AppAktion? {
        var n: [String: Any] = ["aktion": "kopieren"]
        if let wert { n["wert"] = wert }
        return AppAktion.pruefe(n, vault: nil, oberflaeche: o)
    }
    #expect(pruefe("ABCD-1234") == .kopieren("ABCD-1234"))
    #expect(pruefe("claude mcp add brain -- /pfad/zu kern \"mit Leerzeichen\" ä ö ü") != nil)
    #expect(pruefe(String(repeating: "a", count: 400)) == .kopieren(String(repeating: "a", count: 400)))
    #expect(pruefe(String(repeating: "a", count: 401)) == nil, "zu lang")
    #expect(pruefe("") == nil, "leer")
    #expect(pruefe("   ") == nil, "nur Leerraum")
    #expect(pruefe("zwei\nZeilen") == nil, "mehrzeilig")
    #expect(pruefe("zwei\rZeilen") == nil)
    #expect(pruefe("Tab\there") == nil, "Steuerzeichen")
    #expect(pruefe("Null\u{0}Byte") == nil)
    #expect(pruefe("Escape\u{1B}[31m") == nil)
    #expect(pruefe("Zeilentrenner\u{2028}hier") == nil)
    #expect(pruefe("Absatz\u{2029}hier") == nil)
    #expect(pruefe("RTL\u{202E}umschalter") == nil, "Formatzeichen")
    #expect(pruefe("Delete\u{7F}") == nil)
    #expect(pruefe(nil) == nil)
    #expect(pruefe(42) == nil)
    #expect(pruefe(["a": "b"]) == nil)
    #expect(pruefe("ABCD-1234", .app) == nil, "nur das Studio")
}

@Test func einrichtungEndeKenntNurFertigUndSpaeter() {
    func pruefe(_ wert: Any?, _ o: Oberflaeche = .studio) -> AppAktion? {
        var n: [String: Any] = ["aktion": "einrichtung-ende"]
        if let wert { n["wert"] = wert }
        return AppAktion.pruefe(n, vault: nil, oberflaeche: o)
    }
    #expect(pruefe(["art": "fertig"]) == .einrichtungEnde(.fertig))
    #expect(pruefe(["art": "spaeter"]) == .einrichtungEnde(.spaeter))
    #expect(pruefe(["art": "Fertig"]) == nil)
    #expect(pruefe(["art": "später"]) == nil)
    #expect(pruefe(["art": "abbrechen"]) == nil)
    #expect(pruefe(["art": ""]) == nil)
    #expect(pruefe(["art": 1]) == nil)
    #expect(pruefe(["art": NSNull()]) == nil)
    #expect(pruefe([String: Any]()) == nil, "ohne art")
    #expect(pruefe("fertig") == nil, "kein Objekt")
    #expect(pruefe(nil) == nil)
    #expect(pruefe(NSNull()) == nil)
    #expect(pruefe(["art": "fertig"], .app) == nil, "nur das Studio")
}

@Test func einrichtungOeffnenKenntNurDieDreiEinstiegeUndDieVierWege() {
    func pruefe(_ wert: Any?, _ o: Oberflaeche = .studio) -> AppAktion? {
        var n: [String: Any] = ["aktion": "einrichtung-oeffnen"]
        if let wert { n["wert"] = wert }
        return AppAktion.pruefe(n, vault: nil, oberflaeche: o)
    }
    #expect(pruefe(nil) == .einrichtungOeffnen(ab: nil))
    #expect(pruefe(NSNull()) == .einrichtungOeffnen(ab: nil))
    #expect(pruefe([String: Any]()) == .einrichtungOeffnen(ab: nil))
    #expect(pruefe(["ab": NSNull()]) == .einrichtungOeffnen(ab: nil))
    #expect(pruefe(["ab": "vault"]) == .einrichtungOeffnen(ab: .vault))
    #expect(pruefe(["ab": "sicherung"]) == .einrichtungOeffnen(ab: .sicherung))
    #expect(pruefe(["ab": "ki"]) == .einrichtungOeffnen(ab: .ki))
    #expect(pruefe(["ab": "probe"]) == nil, "nicht in der Liste")
    #expect(pruefe(["ab": "Vault"]) == nil)
    #expect(pruefe(["ab": ""]) == nil)
    #expect(pruefe(["ab": 3]) == nil)
    #expect(pruefe("vault") == nil, "kein Objekt")
    #expect(pruefe(["ab": "vault"], .app) == nil, "nur das Studio")
    #expect(pruefe(nil, .app) == nil)
    // Weg: aus dem leeren Zustand („Neuer Vault“, „Ordner öffnen“)
    for w in EinrichtungsWeg.allCases { #expect(pruefe(["weg": w.rawValue]) == .einrichtungOeffnen(ab: nil, weg: w)) }
    #expect(pruefe(["weg": NSNull()]) == .einrichtungOeffnen(ab: nil))
    #expect(pruefe(["ab": "ki", "weg": "neu"]) == .einrichtungOeffnen(ab: .ki, weg: .neu))
    #expect(pruefe(["weg": "Neu"]) == nil)
    #expect(pruefe(["weg": "x'); alert(1); ('"]) == nil, "nichts aus der Liste kommt nie in den Befehl")
    #expect(pruefe(["weg": 1]) == nil)
}

// MARK: Antwortform von git-pruefen und git-installieren

@Test func gitPruefenAntwortHatDenStandUndNurWasVorhandenIst() {
    let ok = GitAntwort.pruefen(.vorhanden(pfad: "/usr/bin/git", version: "2.39.5 (Apple Git-154)"))
    #expect(ok["stand"] as? String == "vorhanden")
    #expect(ok["version"] as? String == "2.39.5 (Apple Git-154)")
    #expect(ok["meldung"] == nil)
    #expect(ok.count == 2, "der Pfad gehört nicht in die Antwort")

    let leereVersion = GitAntwort.pruefen(.vorhanden(pfad: "/usr/bin/git", version: ""))
    #expect(leereVersion["version"] == nil, "version nur, wenn vorhanden")

    let fehlt = GitAntwort.pruefen(.fehlt)
    #expect(fehlt["stand"] as? String == "fehlt" && fehlt.count == 1)
    let gerade = GitAntwort.pruefen(.installiertGerade)
    #expect(gerade["stand"] as? String == "installiert" && gerade.count == 1)

    let defekt = GitAntwort.pruefen(.defekt("Die Xcode-Lizenz ist noch nicht akzeptiert."))
    #expect(defekt["stand"] as? String == "defekt")
    #expect(defekt["meldung"] as? String == "Die Xcode-Lizenz ist noch nicht akzeptiert.")
    #expect(defekt["version"] == nil)

    let nicht = GitAntwort.pruefen(.nichtPruefbar("Zeitlimit überschritten"))
    #expect(nicht["stand"] as? String == "nicht-pruefbar")
    #expect(nicht["meldung"] as? String == "Zeitlimit überschritten")

    #expect(GitAntwort.pruefen(.defekt("  \n"))["meldung"] == nil, "leere Meldung entfällt")
    let lang = GitAntwort.pruefen(.defekt(String(repeating: "x", count: 1000)))
    #expect((lang["meldung"] as? String)?.count == 400, "Meldung gekürzt")
}

@Test func gitInstallierenAntwortEntsprichtDemVertrag() {
    let ausgeloest = GitAntwort.installieren(.dialogAusgeloest)
    #expect(ausgeloest["ok"] as? Bool == true && ausgeloest["stand"] as? String == "installiert" && ausgeloest["meldung"] == nil)
    let schon = GitAntwort.installieren(.schonInstalliert)
    #expect(schon["ok"] as? Bool == true && schon["stand"] as? String == "vorhanden" && schon["meldung"] == nil)
    let schief = GitAntwort.installieren(.fehlgeschlagen("Der Installationsdialog von Apple ließ sich nicht öffnen: Code 1"))
    #expect(schief["ok"] as? Bool == false)
    #expect(schief["stand"] as? String == "fehlt")
    #expect(schief["meldung"] as? String == "Der Installationsdialog von Apple ließ sich nicht öffnen: Code 1")
}

// MARK: Stand von einrichtung.json nach dem Ende

@Test func fertigSchliesstDenAssistentenAbUndSchaltetAutomatikAus() {
    let vorher = EinrichtungsDatei(abgeschlossen: false, automatischAus: true, erledigt: ["ki"], uebersprungen: ["github"], herkunft: .menue)
    let d = EinrichtungsOverlay.datei(nach: .fertig, vorher: vorher, herkunft: .start)
    #expect(d.abgeschlossen && !d.automatischAus)
    #expect(d.herkunft == .start)
    #expect(d.erledigt == ["ki"] && d.uebersprungen == ["github"], "alte Felder bleiben erhalten")
    #expect(EinrichtungsOverlay.datei(nach: .fertig, vorher: nil, herkunft: .menue).abgeschlossen)
}

@Test func spaeterSetztAutomatischAusUndLaesstAbgeschlossenStehen() {
    let neu = EinrichtungsOverlay.datei(nach: .spaeter, vorher: nil, herkunft: .start)
    #expect(neu.automatischAus && !neu.abgeschlossen)
    let fertigGewesen = EinrichtungsOverlay.datei(nach: .spaeter, vorher: EinrichtungsDatei(abgeschlossen: true), herkunft: .menue)
    #expect(fertigGewesen.automatischAus && fertigGewesen.abgeschlossen, "abgeschlossen bleibt, wie es war")
    #expect(fertigGewesen.herkunft == .menue)
}

@Test func fensterZuOhneWahlMerktNurDieHerkunftUndMachtBeimNaechstenStartWeiter() throws {
    let d = EinrichtungsOverlay.datei(nach: nil, vorher: nil, herkunft: .start)
    #expect(!d.abgeschlossen && !d.automatischAus && d.herkunft == .start)
    let s = EinrichtungsSpeicher(pfade: AppPfade(basis: tempOrdner()))
    try s.speichere(d)
    #expect(s.sollErscheinen(hatVault: false) && s.sollErscheinen(hatVault: true), "kein „Später“: er macht weiter")
    // aus dem Menü geöffnet und geschlossen: mit Vault nicht bei jedem Start
    try s.speichere(EinrichtungsOverlay.datei(nach: nil, vorher: s.lade(), herkunft: .menue))
    #expect(!s.sollErscheinen(hatVault: true))
    // „Später“ und „Fertig“ lassen ihn nicht mehr von selbst erscheinen
    try s.speichere(EinrichtungsOverlay.datei(nach: .spaeter, vorher: s.lade(), herkunft: .start))
    #expect(!s.sollErscheinen(hatVault: false))
    let f = EinrichtungsSpeicher(pfade: AppPfade(basis: tempOrdner()))
    try f.speichere(EinrichtungsOverlay.datei(nach: .fertig, vorher: f.lade(), herkunft: .start))
    #expect(!f.sollErscheinen(hatVault: false))
}

@Test func fensterZuOhneWahlMitAktivemVaultGiltAlsEingerichtet() throws {
    let d = EinrichtungsOverlay.datei(nach: nil, vorher: nil, herkunft: .start, vaultAktiv: true)
    #expect(d.abgeschlossen && !d.automatischAus, "Vault da = eingerichtet; Sicherung und KI sind freiwillig")
    let ohne = EinrichtungsOverlay.datei(nach: nil, vorher: nil, herkunft: .start, vaultAktiv: false)
    #expect(!ohne.abgeschlossen)
    let s = EinrichtungsSpeicher(pfade: AppPfade(basis: tempOrdner()))
    try s.speichere(d)
    #expect(!s.sollErscheinen(hatVault: true) && !s.sollErscheinen(hatVault: false))
    // „Später“ nach einem schon fertigen Lauf lässt abgeschlossen stehen
    #expect(EinrichtungsOverlay.datei(nach: .spaeter, vorher: d, herkunft: .menue, vaultAktiv: true).abgeschlossen)
}

@Test func gitZwischenablageUndEndeGehoerenZurEinrichtung() {
    #expect(EinrichtungsOverlay.nurAusEinrichtung(.gitPruefen))
    #expect(EinrichtungsOverlay.nurAusEinrichtung(.gitInstallieren))
    #expect(EinrichtungsOverlay.nurAusEinrichtung(.kopieren("WDJB-MJHT")))
    #expect(EinrichtungsOverlay.nurAusEinrichtung(.einrichtungEnde(.fertig)))
    #expect(EinrichtungsOverlay.nurAusEinrichtung(.einrichtungSchritt(.ki)))
    #expect(!EinrichtungsOverlay.nurAusEinrichtung(.einrichtungSitzung(offen: true)), "die Meldung der Seite selbst geht immer, sonst ließe sich nie bestätigen")
    #expect(!EinrichtungsOverlay.nurAusEinrichtung(.vaultGewechselt))
    #expect(!EinrichtungsOverlay.nurAusEinrichtung(.ordnerWaehlen(titel: nil, vorschlag: nil)))
    #expect(!EinrichtungsOverlay.nurAusEinrichtung(.einrichtungOeffnen(ab: nil)), "das Öffnen selbst geht immer (Karte, Menü)")
}

@Test func dieRechteDerAktionenFolgenDemOffenenOverlayNichtEinemFenster() {
    let eigen: [AppAktion] = [.gitPruefen, .gitInstallieren, .kopieren("ABCD-1234"), .einrichtungEnde(.fertig), .einrichtungEnde(.spaeter), .einrichtungSchritt(.vault)]
    let frei: [AppAktion] = [.vaultGewechselt, .statusAuffrischen, .ordnerWaehlen(titel: nil, vorschlag: nil), .einrichtungOeffnen(ab: nil), .mitteilungProbe, .einrichtungSitzung(offen: true), .einrichtungSitzung(offen: false)]
    var s = EinrichtungsSitzung()
    #expect(!s.offen)
    for a in eigen { #expect(!s.erlaubt(a), "zu: \(a)") }
    for a in frei { #expect(s.erlaubt(a), "zu: \(a)") }
    let neu = s.oeffne(automatisch: true, vaultVorher: nil)
    #expect(neu)
    // angefordert, aber die Seite hat das Overlay noch nicht bestätigt: die Rechte der Einrichtung gelten noch nicht
    for a in eigen { #expect(!s.erlaubt(a), "angefordert, nicht bestätigt: \(a)") }
    for a in frei { #expect(s.erlaubt(a), "angefordert: \(a)") }
    let bestaetigt = s.bestaetige()
    #expect(bestaetigt)
    for a in eigen + frei { #expect(s.erlaubt(a), "offen: \(a)") }
    // zweites Öffnen: kein neuer Lauf, Herkunft und Vault bleiben
    let nochmal = s.oeffne(automatisch: false, vaultVorher: URL(fileURLWithPath: "/x"))
    #expect(!nochmal)
    #expect(s.herkunft == .start && s.vaultVorher == nil)
    let lauf = s.beende()
    #expect(lauf?.herkunft == .start && lauf?.vaultVorher == nil)
    #expect(!s.offen)
    for a in eigen { #expect(!s.erlaubt(a), "nach dem Ende: \(a)") }
    let nochEins = s.beende()
    #expect(nochEins == nil, "ein zweites Ende tut nichts")
}

@Test func einrichtungAusDemMenueMerktHerkunftUndVaultVorher() {
    var s = EinrichtungsSitzung()
    let vault = URL(fileURLWithPath: "/Users/x/Kortex")
    let offen = s.oeffne(automatisch: false, vaultVorher: vault)
    #expect(offen)
    let lauf = s.beende()
    #expect(lauf?.herkunft == .menue && lauf?.vaultVorher == vault)
    #expect(s.vaultVorher == nil)
}

@Test func externOeffnetBeiOffenemOverlayNurGitHubUeberHttps() {
    var s = EinrichtungsSitzung()
    let fremd = URL(string: "https://example.org/docs")!
    let github = URL(string: "https://github.com/login/device")!
    #expect(s.externErlaubt(fremd), "zu: das übrige Studio öffnet seine Links wie bisher")
    _ = s.oeffne(automatisch: false, vaultVorher: nil)
    #expect(s.externErlaubt(fremd), "angefordert, nicht bestätigt: kein Overlay, kein Zwang auf GitHub")
    _ = s.bestaetige()
    #expect(s.externErlaubt(github))
    #expect(!s.externErlaubt(fremd))
    #expect(!s.externErlaubt(URL(string: "http://github.com/login/device")!))
}

@Test func ausDemEinrichtungsfensterOeffnetExternNurGitHubUeberHttps() {
    #expect(EinrichtungsOverlay.externErlaubt(URL(string: "https://github.com/login/device")!))
    #expect(EinrichtungsOverlay.externErlaubt(URL(string: "https://www.github.com/login/device")!))
    #expect(!EinrichtungsOverlay.externErlaubt(URL(string: "http://github.com/login/device")!))
    #expect(!EinrichtungsOverlay.externErlaubt(URL(string: "https://github.com.evil.example/login/device")!))
    #expect(!EinrichtungsOverlay.externErlaubt(URL(string: "https://evil.example/github.com")!))
    #expect(!EinrichtungsOverlay.externErlaubt(URL(string: "file:///etc/passwd")!))
}

// MARK: Startentscheidung: erster Start = Studio MIT Overlay, nie ein Assistentenfenster

@Test func ersterStartOeffnetDasStudioMitEinrichtung() throws {
    let speicher = EinrichtungsSpeicher(pfade: AppPfade(basis: tempOrdner()))
    // frischer Mac: keine Datei, kein Vault, normaler Start
    #expect(EinrichtungsStart.entscheide(darfErscheinen: true, sollErscheinen: speicher.sollErscheinen(hatVault: false)) == .studioMitEinrichtung)
    // Testläufe und `--vault` zeigen sie nie, auch nicht auf einem frischen Mac
    #expect(EinrichtungsStart.entscheide(darfErscheinen: false, sollErscheinen: speicher.sollErscheinen(hatVault: false)) == .studio)
    // wer die App schon nutzt (Vault da, nie gelaufen): nur das Studio
    #expect(EinrichtungsStart.entscheide(darfErscheinen: true, sollErscheinen: speicher.sollErscheinen(hatVault: true)) == .studio)
}

@Test func nachSpaeterUndFertigBleibtDasStudioAllein() throws {
    let s = EinrichtungsSpeicher(pfade: AppPfade(basis: tempOrdner()))
    try s.speichere(EinrichtungsOverlay.datei(nach: .spaeter, vorher: nil, herkunft: .start))
    #expect(EinrichtungsStart.entscheide(darfErscheinen: true, sollErscheinen: s.sollErscheinen(hatVault: false)) == .studio)
    let f = EinrichtungsSpeicher(pfade: AppPfade(basis: tempOrdner()))
    try f.speichere(EinrichtungsOverlay.datei(nach: .fertig, vorher: nil, herkunft: .start))
    #expect(EinrichtungsStart.entscheide(darfErscheinen: true, sollErscheinen: f.sollErscheinen(hatVault: true)) == .studio)
}

@Test func mittendrinBeendeteEinrichtungMachtBeimNaechstenStartImStudioWeiter() throws {
    let s = EinrichtungsSpeicher(pfade: AppPfade(basis: tempOrdner()))
    // geöffnet (Datei steht ab dem Öffnen da), Studio geschlossen ohne Wahl und ohne Vault
    try s.speichere(EinrichtungsOverlay.datei(nach: nil, vorher: s.lade(), herkunft: .start))
    try s.speichere(EinrichtungsOverlay.datei(nach: nil, vorher: s.lade(), herkunft: .start, vaultAktiv: false))
    #expect(EinrichtungsStart.entscheide(darfErscheinen: true, sollErscheinen: s.sollErscheinen(hatVault: false)) == .studioMitEinrichtung)
}

// MARK: Befehl der Menüs an das Studio

@Test func derBefehlEinrichtungTraegtEinstiegUndWegNurAusFestenListen() {
    #expect(StudioBefehl.einrichtung.rawValue == "einrichtung")
    #expect(StudioBefehl.einrichtung.skript == "window.studio?.befehl('einrichtung')")
    #expect(StudioBefehl.einrichtung(ab: nil, weg: nil) == "window.studio?.befehl('einrichtung')")
    #expect(StudioBefehl.einrichtung(ab: .sicherung) == "window.studio?.befehl('einrichtung', {\"ab\":\"sicherung\"})")
    #expect(StudioBefehl.einrichtung(ab: nil, weg: .neu) == "window.studio?.befehl('einrichtung', {\"weg\":\"neu\"})")
    #expect(StudioBefehl.einrichtung(ab: .ki, weg: .oeffnen) == "window.studio?.befehl('einrichtung', {\"ab\":\"ki\",\"weg\":\"oeffnen\"})")
    for ab in EinrichtungsEinstieg.allCases { #expect(StudioBefehl.einrichtung(ab: ab).range(of: "^[^;]*$", options: .regularExpression) != nil) }
}

@Test func startHinweisKommtAlsJsonNieAlsEingebauterText() {
    let s = StudioHinweis.skript(titel: "Ordner „Brain“", text: "Pfad: /Users/x/it's \"quoted\"\n</script>')); alert(1);//")
    #expect(s.hasPrefix("window.studio?.hinweis({"))
    #expect(s.hasSuffix("})"))
    // der Text steckt als JSON-Zeichenkette darin: Anführungszeichen und Zeilenumbruch sind maskiert
    #expect(s.contains("\\\"quoted\\\"") && s.contains("\\n"))
    let teile = s.dropFirst("window.studio?.hinweis(".count).dropLast()
    let obj = try? JSONSerialization.jsonObject(with: Data(teile.utf8)) as? [String: String]
    #expect(obj?["titel"] == "Ordner „Brain“")
    #expect(obj?["text"]?.hasSuffix("alert(1);//") == true)
}

// MARK: Ordner-Wahl: Zählung und Antwort

private func baueOrdner() throws -> URL {
    let w = tempOrdner("zaehlung")
    let fm = FileManager.default
    func datei(_ pfad: String) throws {
        let u = w.appendingPathComponent(pfad)
        try fm.createDirectory(at: u.deletingLastPathComponent(), withIntermediateDirectories: true)
        try "x".write(to: u, atomically: true, encoding: .utf8)
    }
    try datei("a.md")
    try datei("b.TXT")
    try datei("bild.png")
    try datei("unter/c.md")
    try datei("unter/tief/d.md")
    try datei(".versteckt/e.md")
    try datei(".f.md")
    try datei("node_modules/paket/g.md")
    return w
}

@Test func zaehlerZaehltNotizenUndOrdnerOhneVersteckteUndNodeModules() throws {
    let w = try baueOrdner()
    let z = OrdnerZaehler.zaehle(w)
    #expect(z == OrdnerZaehlung(notizen: 4, ordner: 2, mehr: false), "a.md, b.TXT, unter/c.md, unter/tief/d.md; Ordner unter und unter/tief")
}

@Test func zaehlerFolgtKeinenSymlinks() throws {
    let w = try baueOrdner()
    let draussen = tempOrdner("draussen")
    try "x".write(to: draussen.appendingPathComponent("fremd.md"), atomically: true, encoding: .utf8)
    try FileManager.default.createSymbolicLink(at: w.appendingPathComponent("link-ordner"), withDestinationURL: draussen)
    try FileManager.default.createSymbolicLink(at: w.appendingPathComponent("link.md"), withDestinationURL: draussen.appendingPathComponent("fremd.md"))
    #expect(OrdnerZaehler.zaehle(w) == OrdnerZaehlung(notizen: 4, ordner: 2, mehr: false), "weder der Link noch sein Ziel zählen")
}

@Test func zaehlerBrichtBeiZuvielenEintraegenAb() throws {
    let w = tempOrdner("viele")
    for i in 0..<30 { try "x".write(to: w.appendingPathComponent("n\(i).md"), atomically: true, encoding: .utf8) }
    let z = OrdnerZaehler.zaehle(w, maxEintraege: 10)
    #expect(z.mehr)
    #expect(z.notizen == 10 && z.ordner == 0, "bis dahin Gezähltes bleibt: \(z)")
    #expect(OrdnerZaehler.zaehle(w, maxEintraege: 30) == OrdnerZaehlung(notizen: 30, ordner: 0, mehr: false))
}

@Test func zaehlerBrichtNachDemZeitlimitAb() throws {
    let w = tempOrdner("langsam")
    for i in 0..<20 { try "x".write(to: w.appendingPathComponent("n\(i).md"), atomically: true, encoding: .utf8) }
    // Die Uhr springt bei jeder Abfrage um eine Sekunde: nach dem Limit von 2,5 s ist Schluss.
    nonisolated(unsafe) var t = Date(timeIntervalSince1970: 1_000_000)
    let z = OrdnerZaehler.zaehle(w, zeitlimit: 2.5, jetzt: { t = t.addingTimeInterval(1); return t })
    #expect(z.mehr)
    #expect(z.notizen < 20)
}

@Test func zaehlerAufFehlendemOrdnerIstLeer() {
    let weg = FileManager.default.temporaryDirectory.appendingPathComponent("gibt-es-nicht-\(UUID().uuidString)")
    #expect(OrdnerZaehler.zaehle(weg) == OrdnerZaehlung())
}

@Test func ordnerWahlAntwortEnthaeltPfadZahlenUndBreitenHinweis() throws {
    let home = tempOrdner("home")
    let ordner = home.appendingPathComponent("Mein Vault")
    try FileManager.default.createDirectory(at: ordner, withIntermediateDirectories: true)
    let einfach = OrdnerWahlAntwort.baue(pfad: ordner, home: home, zaehlung: OrdnerZaehlung(notizen: 3, ordner: 1))
    #expect(einfach["pfad"] as? String == ordner.path)
    #expect(einfach["notizen"] as? Int == 3 && einfach["ordner"] as? Int == 1)
    #expect(einfach["breit"] == nil && einfach["mehr"] == nil, "nur, wenn zutreffend")

    let dokumente = home.appendingPathComponent("Documents")
    let breit = OrdnerWahlAntwort.baue(pfad: dokumente, home: home, zaehlung: OrdnerZaehlung(notizen: 7, ordner: 2, mehr: true))
    let b = try #require(breit["breit"] as? [String: Any])
    #expect(b["name"] as? String == "Dokumente")
    #expect(b["vorschlag"] as? String == dokumente.appendingPathComponent("Kortex").path)
    #expect(breit["mehr"] as? Bool == true)

    let cloud = OrdnerWahlAntwort.baue(pfad: home.appendingPathComponent("Library/CloudStorage"), home: home, zaehlung: nil)
    let c = try #require(cloud["breit"] as? [String: Any])
    #expect(c["name"] as? String == "Cloud-Speicher" && c["vorschlag"] == nil, "vorschlag nur, wenn es einen gibt")
    #expect(cloud["notizen"] == nil && cloud["ordner"] == nil)
}

// MARK: Sitzung: die Seite bestätigt, ein Neuladen nimmt die Rechte zurück

@Test func ohneAnforderungBestaetigtDieSeiteNichts() {
    var s = EinrichtungsSitzung()
    let b = s.bestaetige()
    #expect(!b, "nie angefordert: nichts wird freigegeben")
    #expect(!s.erlaubt(.gitPruefen))
    let z = s.seiteMeldetZu()
    #expect(!z)
}

@Test func neuladenDerSeiteNimmtDieRechteZurueckUndBeendetDenBestaetigtenLauf() {
    var s = EinrichtungsSitzung()
    _ = s.oeffne(automatisch: false, vaultVorher: nil)
    let b = s.bestaetige()
    #expect(b && s.erlaubt(.kopieren("X")))
    // die Seite wird neu geladen und meldet beim Start „zu“: die Rechte sind weg, und der Lauf gilt als beendet (die App ruft dann `beende()`)
    let zu = s.seiteMeldetZu()
    #expect(zu, "war bestätigt: der Lauf endet")
    #expect(!s.erlaubt(.kopieren("X")) && !s.erlaubt(.einrichtungEnde(.fertig)))
    let lauf = s.beende()
    #expect(lauf != nil)
    #expect(!s.offen && !s.bestaetigt)
}

@Test func einBootMeldetZuVorDemBefehlLaesstDenAngefordertenLaufOffen() {
    // erster Start: die App fordert an, die Seite lädt noch und meldet beim Booten „zu“ — das ist nicht das Ende des Laufs
    var s = EinrichtungsSitzung()
    _ = s.oeffne(automatisch: true, vaultVorher: nil)
    let zu = s.seiteMeldetZu()
    #expect(!zu)
    #expect(s.offen)
    let b = s.bestaetige()
    #expect(b, "danach öffnet die Seite das Overlay und bestätigt")
    #expect(s.erlaubt(.gitPruefen))
}

@Test func einNeuerLaufMussNeuBestaetigtWerden() {
    var s = EinrichtungsSitzung()
    _ = s.oeffne(automatisch: false, vaultVorher: nil)
    _ = s.bestaetige()
    _ = s.beende()
    _ = s.oeffne(automatisch: false, vaultVorher: nil)
    #expect(!s.erlaubt(.gitPruefen), "ein neuer Lauf beginnt unbestätigt")
}

@Test func sitzungUndSchrittKommenNurVomStudioMitFestenWerten() {
    func pruefe(_ name: String, _ wert: Any?, _ o: Oberflaeche = .studio) -> AppAktion? {
        var n: [String: Any] = ["aktion": name]
        if let wert { n["wert"] = wert }
        return AppAktion.pruefe(n, vault: nil, oberflaeche: o)
    }
    #expect(pruefe("einrichtung-sitzung", ["offen": true]) == .einrichtungSitzung(offen: true))
    #expect(pruefe("einrichtung-sitzung", ["offen": false]) == .einrichtungSitzung(offen: false))
    #expect(pruefe("einrichtung-sitzung", ["offen": "ja"]) == nil)
    #expect(pruefe("einrichtung-sitzung", nil) == nil)
    #expect(pruefe("einrichtung-sitzung", ["offen": true], .app) == nil, "nur das Studio")
    for s in EinrichtungsSchritt.allCases { #expect(pruefe("einrichtung-schritt", ["schritt": s.rawValue]) == .einrichtungSchritt(s)) }
    #expect(pruefe("einrichtung-schritt", ["schritt": "fertig"]) == nil)
    #expect(pruefe("einrichtung-schritt", ["schritt": "Vault"]) == nil)
    #expect(pruefe("einrichtung-schritt", "vault") == nil)
    #expect(pruefe("einrichtung-schritt", nil) == nil)
    #expect(pruefe("einrichtung-schritt", ["schritt": "ki"], .app) == nil, "nur das Studio")
}

// MARK: Fortsetzen: letzterSchritt und Einstieg

@Test func einSchrittRuecktNurVorwaertsUndMerktDieHerkunft() {
    var d = EinrichtungsOverlay.datei(schritt: .vault, vorher: nil, herkunft: .start)
    #expect(d.letzterSchritt == .vault && d.herkunft == .start && d.ablaufVersion == 2)
    d = EinrichtungsOverlay.datei(schritt: .sicherung, vorher: d, herkunft: .start)
    #expect(d.letzterSchritt == .sicherung)
    d = EinrichtungsOverlay.datei(schritt: .ki, vorher: d, herkunft: .menue)
    #expect(d.letzterSchritt == .sicherung, "nie zurück")
    #expect(d.herkunft == .menue)
}

@Test func derEinstiegFolgtDemLetztenSchrittUndDemVerlangten() {
    func e(_ ab: EinrichtungsEinstieg? = nil, _ weg: EinrichtungsWeg? = nil, vault: Bool, _ letzter: EinrichtungsSchritt? = nil, datei: Bool = true) -> EinrichtungsEinstieg? {
        EinrichtungsOverlay.einstieg(ab: ab, weg: weg, vaultDa: vault, datei: datei ? EinrichtungsDatei(letzterSchritt: letzter) : nil)
    }
    #expect(e(vault: false) == nil, "ohne Vault beginnt die Seite beim Vault")
    #expect(e(nil, .oeffnen, vault: false, datei: false) == nil)
    #expect(e(.sicherung, vault: false) == .sicherung, "ein verlangter Einstieg gilt immer")
    #expect(e(nil, .neu, vault: true) == nil, "mit Weg beginnt die Seite beim Vault")
    #expect(e(vault: true, datei: false) == .ki, "Vault da, kein Stand: bei der KI")
    #expect(e(vault: true, .vault) == .ki)
    #expect(e(vault: true, .ki) == .sicherung)
    #expect(e(vault: true, .sicherung) == .ki, "alles erledigt: das Menü beginnt wieder bei der KI")
}
