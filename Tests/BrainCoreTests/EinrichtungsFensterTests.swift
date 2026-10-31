import Testing
import Foundation
import CoreGraphics
@testable import BrainCore

// MARK: Prüfung der Aktionen des Einrichtungs-Assistenten

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

@Test func einrichtungOeffnenKenntNurDieDreiEinstiege() {
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

// MARK: Fenstergröße und Adresse

@Test func einrichtungsFensterIstFest1120Mal720() {
    #expect(EinrichtungsFenster.groesse(sichtbar: CGSize(width: 2560, height: 1415)) == CGSize(width: 1120, height: 720))
    // genau an der Grenze: 1168 − 48 = 1120, 768 − 48 = 720
    #expect(EinrichtungsFenster.groesse(sichtbar: CGSize(width: 1168, height: 768)) == CGSize(width: 1120, height: 720))
}

@Test func einrichtungsFensterBleibtKleinerAlsDerSichtbareBildschirm() {
    // 13"-MacBook: sichtbare Fläche etwa 1440 x 875 → Höhe 827 genügt, Breite 1120 passt
    #expect(EinrichtungsFenster.groesse(sichtbar: CGSize(width: 1440, height: 875)) == CGSize(width: 1120, height: 720))
    // kleiner Bildschirm: Rand 48 je Achse, je Achse einzeln
    #expect(EinrichtungsFenster.groesse(sichtbar: CGSize(width: 1024, height: 700)) == CGSize(width: 976, height: 652))
    #expect(EinrichtungsFenster.groesse(sichtbar: CGSize(width: 1600, height: 700)) == CGSize(width: 1120, height: 652))
    #expect(EinrichtungsFenster.groesse(sichtbar: CGSize(width: 1000, height: 1200)) == CGSize(width: 952, height: 720))
}

@Test func einrichtungsFensterWirdNieKleinerAlsDasMinimum() {
    #expect(EinrichtungsFenster.groesse(sichtbar: CGSize(width: 300, height: 200)) == EinrichtungsFenster.minimum)
    #expect(EinrichtungsFenster.groesse(sichtbar: .zero) == EinrichtungsFenster.minimum)
    #expect(EinrichtungsFenster.minimum.width < EinrichtungsFenster.wunschgroesse.width && EinrichtungsFenster.minimum.height < EinrichtungsFenster.wunschgroesse.height)
}

@Test func einrichtungsAdresseLiegtAufDemHostStudio() {
    let ohne = EinrichtungsFenster.url()
    #expect(ohne.absoluteString == "brain://studio/einrichtung.html", "ohne Einstieg keine Query")
    #expect(Oberflaeche.fuer(host: ohne.host) == .studio)
    for ab in EinrichtungsEinstieg.allCases {
        let u = EinrichtungsFenster.url(ab: ab)
        #expect(u.absoluteString == "brain://studio/einrichtung.html?ab=\(ab.rawValue)")
        #expect(SchemaAntwort.pfad(von: u) == "/einrichtung.html?ab=\(ab.rawValue)", "die Query geht an die Werkstatt")
        #expect(EinrichtungsFenster.istSeite(u))
        #expect(SchemaAntwort.istHauptdokument(u), "bei einem Ladefehler gibt es die Fehlerseite statt eines leeren Fensters")
        #expect(NavigationsRegel.entscheide(u, hauptrahmen: true, vomNutzer: false, oberflaeche: .studio) == .erlauben)
        #expect(NavigationsRegel.entscheide(u, hauptrahmen: true, vomNutzer: false, oberflaeche: .app) == .abbrechen)
    }
    #expect(!SchemaAntwort.istHauptdokument(URL(string: "brain://studio/studio.css")!))
    #expect(!SchemaAntwort.istHauptdokument(URL(string: "brain://app/einrichtung.html")!), "nur auf dem Host studio")
}

// MARK: Stand von einrichtung.json nach dem Ende

@Test func fertigSchliesstDenAssistentenAbUndSchaltetAutomatikAus() {
    let vorher = EinrichtungsDatei(abgeschlossen: false, automatischAus: true, erledigt: ["ki"], uebersprungen: ["github"], herkunft: .menue)
    let d = EinrichtungsFenster.datei(nach: .fertig, vorher: vorher, herkunft: .start)
    #expect(d.abgeschlossen && !d.automatischAus)
    #expect(d.herkunft == .start)
    #expect(d.erledigt == ["ki"] && d.uebersprungen == ["github"], "alte Felder bleiben erhalten")
    #expect(EinrichtungsFenster.datei(nach: .fertig, vorher: nil, herkunft: .menue).abgeschlossen)
}

@Test func spaeterSetztAutomatischAusUndLaesstAbgeschlossenStehen() {
    let neu = EinrichtungsFenster.datei(nach: .spaeter, vorher: nil, herkunft: .start)
    #expect(neu.automatischAus && !neu.abgeschlossen)
    let fertigGewesen = EinrichtungsFenster.datei(nach: .spaeter, vorher: EinrichtungsDatei(abgeschlossen: true), herkunft: .menue)
    #expect(fertigGewesen.automatischAus && fertigGewesen.abgeschlossen, "abgeschlossen bleibt, wie es war")
    #expect(fertigGewesen.herkunft == .menue)
}

@Test func fensterZuOhneWahlMerktNurDieHerkunftUndMachtBeimNaechstenStartWeiter() throws {
    let d = EinrichtungsFenster.datei(nach: nil, vorher: nil, herkunft: .start)
    #expect(!d.abgeschlossen && !d.automatischAus && d.herkunft == .start)
    let s = EinrichtungsSpeicher(pfade: AppPfade(basis: tempOrdner()))
    try s.speichere(d)
    #expect(s.sollErscheinen(hatVault: false) && s.sollErscheinen(hatVault: true), "kein „Später“: er macht weiter")
    // aus dem Menü geöffnet und geschlossen: mit Vault nicht bei jedem Start
    try s.speichere(EinrichtungsFenster.datei(nach: nil, vorher: s.lade(), herkunft: .menue))
    #expect(!s.sollErscheinen(hatVault: true))
    // „Später“ und „Fertig“ lassen ihn nicht mehr von selbst erscheinen
    try s.speichere(EinrichtungsFenster.datei(nach: .spaeter, vorher: s.lade(), herkunft: .start))
    #expect(!s.sollErscheinen(hatVault: false))
    let f = EinrichtungsSpeicher(pfade: AppPfade(basis: tempOrdner()))
    try f.speichere(EinrichtungsFenster.datei(nach: .fertig, vorher: f.lade(), herkunft: .start))
    #expect(!f.sollErscheinen(hatVault: false))
}

@Test func fensterZuOhneWahlMitAktivemVaultGiltAlsEingerichtet() throws {
    let d = EinrichtungsFenster.datei(nach: nil, vorher: nil, herkunft: .start, vaultAktiv: true)
    #expect(d.abgeschlossen && !d.automatischAus, "Vault da = eingerichtet; Sicherung und KI sind freiwillig")
    let ohne = EinrichtungsFenster.datei(nach: nil, vorher: nil, herkunft: .start, vaultAktiv: false)
    #expect(!ohne.abgeschlossen)
    let s = EinrichtungsSpeicher(pfade: AppPfade(basis: tempOrdner()))
    try s.speichere(d)
    #expect(!s.sollErscheinen(hatVault: true) && !s.sollErscheinen(hatVault: false))
    // „Später“ nach einem schon fertigen Lauf lässt abgeschlossen stehen
    #expect(EinrichtungsFenster.datei(nach: .spaeter, vorher: d, herkunft: .menue, vaultAktiv: true).abgeschlossen)
}

@Test func gitZwischenablageUndEndeGeltenNurAusDemEinrichtungsfenster() {
    #expect(EinrichtungsFenster.nurAusEinrichtung(.gitPruefen))
    #expect(EinrichtungsFenster.nurAusEinrichtung(.gitInstallieren))
    #expect(EinrichtungsFenster.nurAusEinrichtung(.kopieren("WDJB-MJHT")))
    #expect(EinrichtungsFenster.nurAusEinrichtung(.einrichtungEnde(.fertig)))
    #expect(!EinrichtungsFenster.nurAusEinrichtung(.vaultGewechselt))
    #expect(!EinrichtungsFenster.nurAusEinrichtung(.ordnerWaehlen(titel: nil, vorschlag: nil)))
}

@Test func ausDemEinrichtungsfensterOeffnetExternNurGitHubUeberHttps() {
    #expect(EinrichtungsFenster.externErlaubt(URL(string: "https://github.com/login/device")!))
    #expect(EinrichtungsFenster.externErlaubt(URL(string: "https://www.github.com/login/device")!))
    #expect(!EinrichtungsFenster.externErlaubt(URL(string: "http://github.com/login/device")!))
    #expect(!EinrichtungsFenster.externErlaubt(URL(string: "https://github.com.evil.example/login/device")!))
    #expect(!EinrichtungsFenster.externErlaubt(URL(string: "https://evil.example/github.com")!))
    #expect(!EinrichtungsFenster.externErlaubt(URL(string: "file:///etc/passwd")!))
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
