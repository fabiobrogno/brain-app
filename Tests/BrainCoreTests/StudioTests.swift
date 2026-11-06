import Testing
import Foundation
import CoreGraphics
@testable import BrainCore

private func url(_ s: String) -> URL { URL(string: s)! }

// MARK: Navigation und Hosts

@Test func jedesFensterErlaubtNurSeinenHost() {
    #expect(NavigationsRegel.entscheide(url("brain://studio/index.html"), hauptrahmen: true, vomNutzer: false, oberflaeche: .studio) == .erlauben)
    #expect(NavigationsRegel.entscheide(url("brain://app/index.html"), hauptrahmen: true, vomNutzer: false, oberflaeche: .studio) == .abbrechen)
    #expect(NavigationsRegel.entscheide(url("brain://studio/index.html"), hauptrahmen: true, vomNutzer: false, oberflaeche: .app) == .abbrechen)
    // Standard bleibt die Übersicht
    #expect(NavigationsRegel.entscheide(url("brain://app/index.html"), hauptrahmen: true, vomNutzer: false) == .erlauben)
    #expect(NavigationsRegel.entscheide(url("brain://studio/x"), hauptrahmen: true, vomNutzer: true) == .abbrechen)
}

@Test func httpsLinksOeffnenAuchImStudioNurAufKlick() {
    let u = url("https://example.com/")
    #expect(NavigationsRegel.entscheide(u, hauptrahmen: true, vomNutzer: true, oberflaeche: .studio) == .extern(u))
    #expect(NavigationsRegel.entscheide(u, hauptrahmen: true, vomNutzer: false, oberflaeche: .studio) == .abbrechen)
}

@Test func oberflaecheOrdnetHostenZu() {
    #expect(Oberflaeche.fuer(host: "studio") == .studio)
    #expect(Oberflaeche.fuer(host: "app") == .app)
    #expect(Oberflaeche.fuer(host: "anders") == nil)
    #expect(Oberflaeche.fuer(host: nil) == nil)
    #expect(Oberflaeche.studio.startURL.absoluteString == "brain://studio/index.html")
    #expect(NavigationsRegel.startURL == Oberflaeche.app.startURL)
}

// MARK: Aktionen

@Test func aktionAnsichtUndUnbekanntes() {
    let v = tempOrdner("Vault")
    #expect(AppAktion.pruefe(["aktion": "ansicht"], vault: v) == .ansicht)
    #expect(AppAktion.pruefe(["aktion": "loeschen", "wert": "x"], vault: v) == nil)
    #expect(AppAktion.pruefe(["wert": "x"], vault: v) == nil)
    #expect(AppAktion.pruefe("ansicht", vault: v) == nil)
}

@Test func aktionExternNurHttps() {
    let v = tempOrdner("Vault")
    #expect(AppAktion.pruefe(["aktion": "extern", "wert": "https://example.com/a?b=1"], vault: v) == .extern(url("https://example.com/a?b=1")))
    for s in ["http://example.com", "file:///etc/passwd", "javascript:alert(1)", "mailto:a@b.de", "https://", "kein url", ""] {
        #expect(AppAktion.pruefe(["aktion": "extern", "wert": s], vault: v) == nil, "\(s)")
    }
    #expect(AppAktion.pruefe(["aktion": "extern"], vault: v) == nil)
    #expect(AppAktion.pruefe(["aktion": "extern", "wert": 5], vault: v) == nil)
}

@Test func aktionOrdnerZeigenBleibtImVault() throws {
    let v = tempOrdner("Mein Vault")
    let wiki = v.appendingPathComponent("09_wiki")
    try FileManager.default.createDirectory(at: wiki, withIntermediateDirectories: true)
    try "x".write(to: wiki.appendingPathComponent("seite.md"), atomically: true, encoding: .utf8)
    let echt = v.resolvingSymlinksInPath().appendingPathComponent("09_wiki/seite.md")
    #expect(AppAktion.pruefe(["aktion": "ordner-zeigen", "wert": "09_wiki/seite.md"], vault: v) == .ordnerZeigen(echt))
    // Datei darf noch fehlen (z. B. frisch gelöscht) — der Ort bleibt im Vault
    #expect(AppAktion.pruefe(["aktion": "ordner-zeigen", "wert": "00_inbox/neu.md"], vault: v) != nil)
    for s in ["../geheim.txt", "09_wiki/../../x", "/etc/passwd", "", "/", "a/../..", "a\0b"] {
        #expect(AppAktion.pruefe(["aktion": "ordner-zeigen", "wert": s], vault: v) == nil, "\(s)")
    }
    #expect(AppAktion.pruefe(["aktion": "ordner-zeigen"], vault: v) == nil)
}

@Test func aktionOrdnerZeigenFolgtKeinemSymlinkNachDraussen() throws {
    let v = tempOrdner("Vault")
    let draussen = tempOrdner("Draussen")
    try FileManager.default.createSymbolicLink(at: v.appendingPathComponent("link"), withDestinationURL: draussen)
    #expect(AppAktion.pruefe(["aktion": "ordner-zeigen", "wert": "link/datei.md"], vault: v) == nil)
    #expect(AppAktion.pruefe(["aktion": "ordner-zeigen", "wert": "link"], vault: v) == nil)
}

@Test func studioBefehleSindFesteNamen() {
    #expect(StudioBefehl.neu.skript == "window.studio?.befehl('neu')")
    #expect(StudioBefehl.merken.skript == "window.studio?.befehl('merken')")
    #expect(StudioBefehl.infospalte.skript == "window.studio?.befehl('infospalte')")
    #expect(StudioBefehl.vaultOeffnen.skript == "window.studio?.befehl('vault-oeffnen')")
    // Die Namensliste ist der Vertrag mit der Oberfläche — jede Änderung hier muss dort nachgezogen werden.
    #expect(StudioBefehl.allCases.map(\.rawValue) == [
        "neu", "merken", "vault-oeffnen", "vault-wechseln", "infospalte", "verlauf", "hell-dunkel",
        "posteingang", "alle", "wissen", "palette", "sync", "einstellungen", "umstellung", "aufgaben", "aufgabe-erfassen", "aktivitaet", "frage",
        "heute", "vorlage", "zurueck", "vor",
    ])
    #expect(StudioBefehl.aufgabeErfassen.skript == "window.studio?.befehl('aufgabe-erfassen')")
    #expect(StudioBefehl.umstellung.skript == "window.studio?.befehl('umstellung')")
    #expect(StudioBefehl(rawValue: "vault-wechseln") == .vaultWechseln)
    #expect(StudioBefehl(rawValue: "unbekannt") == nil)
}

@Test func einstellungenMenueEintragIstKommaUndOeffnetDieSeiteImStudio() {
    // ⌘, im Hauptmenü „Kortex“ und in der Menüleiste: derselbe Eintrag, derselbe Befehl — das Studio öffnet damit die Seite „Einstellungen“
    let e = StudioBefehl.einstellungenEintrag
    #expect(e.titel == "Einstellungen …")
    #expect(e.taste == ",")
    #expect(e.befehl == .einstellungen)
    #expect(e.befehl.skript == "window.studio?.befehl('einstellungen')")
    #expect(e.taste.count == 1) // KeyEquivalent(Character(…)) in MenueInhalt braucht genau ein Zeichen
}

@Test func befehlsNamenKoennenNieAusDemSkriptTextAusbrechen() {
    for b in StudioBefehl.allCases {
        #expect(b.rawValue.range(of: "^[a-z]+(-[a-z]+)*$", options: .regularExpression) != nil, "\(b.rawValue)")
        #expect(b.skript == "window.studio?.befehl('\(b.rawValue)')")
    }
}

// MARK: Aktionen mit Antwort (Studio v2)

@Test func aktionOrdnerWaehlenMitUndOhneWerte() {
    let v = tempOrdner("Vault")
    #expect(AppAktion.pruefe(["aktion": "ordner-waehlen"], vault: v, oberflaeche: .studio) == .ordnerWaehlen(titel: nil, vorschlag: nil))
    #expect(AppAktion.pruefe(["aktion": "ordner-waehlen", "wert": NSNull()], vault: nil, oberflaeche: .studio) == .ordnerWaehlen(titel: nil, vorschlag: nil))
    #expect(AppAktion.pruefe(["aktion": "ordner-waehlen", "wert": [String: Any]()], vault: nil, oberflaeche: .studio) == .ordnerWaehlen(titel: nil, vorschlag: nil))
    let a = AppAktion.pruefe(["aktion": "ordner-waehlen", "wert": ["titel": "Wo soll dein Brain liegen?", "vorschlag": "/Users/x/Mein Brain"]], vault: nil, oberflaeche: .studio)
    #expect(a == .ordnerWaehlen(titel: "Wo soll dein Brain liegen?", vorschlag: URL(fileURLWithPath: "/Users/x/Mein Brain", isDirectory: true)))
    // ohne Vault ist ordner-waehlen möglich (Willkommen)
    #expect(AppAktion.pruefe(["aktion": "ordner-waehlen"], vault: nil, oberflaeche: .studio) != nil)
}

@Test func aktionOrdnerWaehlenVerwirftFalscheFormenUndIgnoriertUnbrauchbaresEinzelnes() {
    // Wert ist kein Objekt → verworfen
    for wert in ["~/Brain", 5, ["a"], true] as [Any] {
        #expect(AppAktion.pruefe(["aktion": "ordner-waehlen", "wert": wert], vault: nil, oberflaeche: .studio) == nil, "\(wert)")
    }
    // Unbrauchbarer Vorschlag (relativ, kein Text, NUL) → ohne Vorschlag, der Dialog kommt trotzdem
    for vorschlag in ["relativ/pfad", "", 7, "/x\0y"] as [Any] {
        #expect(AppAktion.pruefe(["aktion": "ordner-waehlen", "wert": ["vorschlag": vorschlag]], vault: nil, oberflaeche: .studio)
                == .ordnerWaehlen(titel: nil, vorschlag: nil), "\(vorschlag)")
    }
    // Hinweis: einzeilig, ohne Steuer-/Format-Zeichen, gekürzt, leer → nil
    let titel = AppAktion.pruefe(["aktion": "ordner-waehlen", "wert": ["titel": "Zeile 1\nZeile\u{202E}2"]], vault: nil, oberflaeche: .studio)
    #expect(titel == .ordnerWaehlen(titel: "Zeile 1 Zeile2", vorschlag: nil))
    #expect(AppAktion.pruefe(["aktion": "ordner-waehlen", "wert": ["titel": "  \n "]], vault: nil, oberflaeche: .studio) == .ordnerWaehlen(titel: nil, vorschlag: nil))
    #expect(AppAktion.pruefe(["aktion": "ordner-waehlen", "wert": ["titel": 5]], vault: nil, oberflaeche: .studio) == .ordnerWaehlen(titel: nil, vorschlag: nil))
    if case .ordnerWaehlen(let lang?, _)? = AppAktion.pruefe(["aktion": "ordner-waehlen", "wert": ["titel": String(repeating: "x", count: 500)]], vault: nil, oberflaeche: .studio) {
        #expect(lang.count == AppAktion.maxHinweis)
    } else {
        Issue.record("langer Hinweis wurde nicht gekürzt übernommen")
    }
}

@Test func vorschlagKenntTildeUndWirdAbsolut() {
    let home = URL(fileURLWithPath: "/Users/test", isDirectory: true)
    #expect(AppAktion.absoluterOrdner("~", home: home)?.path == "/Users/test")
    #expect(AppAktion.absoluterOrdner("~/Brain", home: home)?.path == "/Users/test/Brain")
    #expect(AppAktion.absoluterOrdner("/a/b/../c", home: home)?.path == "/a/c")
    #expect(AppAktion.absoluterOrdner("Brain", home: home) == nil)
    #expect(AppAktion.absoluterOrdner("~andere/x", home: home) == nil)
    #expect(AppAktion.absoluterOrdner("", home: home) == nil)
}

@Test func startortIstDerTiefsteVorhandeneOrdner() throws {
    let home = tempOrdner("Home")
    let fallback = tempOrdner("Fallback")
    #expect(AppAktion.startort(fuer: nil, fallback: fallback) == fallback)
    #expect(AppAktion.startort(fuer: home, fallback: fallback).path == home.standardizedFileURL.path)
    // „~/Brain“ gibt es noch nicht → der Ordner darüber
    #expect(AppAktion.startort(fuer: home.appendingPathComponent("Brain/tief/drin"), fallback: fallback).path == home.standardizedFileURL.path)
    // eine Datei ist kein Ordner → der Ordner, in dem sie liegt
    let datei = home.appendingPathComponent("datei.txt")
    try "x".write(to: datei, atomically: true, encoding: .utf8)
    #expect(AppAktion.startort(fuer: datei, fallback: fallback).path == home.standardizedFileURL.path)
}

@Test func aktionVaultGewechseltUndTitel() {
    #expect(AppAktion.pruefe(["aktion": "vault-gewechselt"], vault: nil, oberflaeche: .studio) == .vaultGewechselt)
    #expect(AppAktion.pruefe(["aktion": "titel", "wert": "Mein Brain"], vault: nil, oberflaeche: .studio) == .titel("Mein Brain"))
    #expect(AppAktion.pruefe(["aktion": "titel", "wert": "  Mein\tBrain \n"], vault: nil, oberflaeche: .studio) == .titel("Mein Brain"))
    // leer/ohne Wert/null → Standardtitel; falscher Typ → verworfen
    #expect(AppAktion.pruefe(["aktion": "titel", "wert": "   "], vault: nil, oberflaeche: .studio) == .titel(nil))
    #expect(AppAktion.pruefe(["aktion": "titel"], vault: nil, oberflaeche: .studio) == .titel(nil))
    #expect(AppAktion.pruefe(["aktion": "titel", "wert": NSNull()], vault: nil, oberflaeche: .studio) == .titel(nil))
    #expect(AppAktion.pruefe(["aktion": "titel", "wert": 5], vault: nil, oberflaeche: .studio) == nil)
    #expect(AppAktion.pruefe(["aktion": "titel", "wert": ["a": 1]], vault: nil, oberflaeche: .studio) == nil)
    if case .titel(let t?)? = AppAktion.pruefe(["aktion": "titel", "wert": String(repeating: "ä", count: 400)], vault: nil, oberflaeche: .studio) {
        #expect(t.count == AppAktion.maxTitel)
    } else {
        Issue.record("langer Titel wurde nicht gekürzt übernommen")
    }
}

@Test func neueAktionenGeltenNurFuerDasStudio() {
    // Die Übersicht ist Kit-Code aus dem Vault: kein Ordner-Dialog, kein Vault-Wechsel, kein Fenstertitel.
    let v = tempOrdner("Vault")
    for aktion in ["ordner-waehlen", "vault-gewechselt", "vertrauen-geaendert", "titel"] {
        #expect(AppAktion.pruefe(["aktion": aktion, "wert": "x"], vault: v, oberflaeche: .app) == nil, "\(aktion)")
        #expect(AppAktion.pruefe(["aktion": aktion], vault: v, oberflaeche: .studio) != nil, "\(aktion)")
    }
    // Die bisherigen drei bleiben in beiden Fenstern erlaubt
    #expect(AppAktion.pruefe(["aktion": "ansicht"], vault: v, oberflaeche: .app) == .ansicht)
    #expect(AppAktion.pruefe(["aktion": "extern", "wert": "https://example.com"], vault: v, oberflaeche: .app) != nil)
    #expect(AppAktion.pruefe(["aktion": "ordner-zeigen", "wert": "a.md"], vault: v, oberflaeche: .app) != nil)
}

@Test func aktionVertrauenGeaendertNurImStudio() {
    #expect(AppAktion.pruefe(["aktion": "vertrauen-geaendert"], vault: nil, oberflaeche: .studio) == .vertrauenGeaendert)
    #expect(AppAktion.pruefe(["aktion": "vertrauen-geaendert"], vault: tempOrdner("Vault"), oberflaeche: .studio) == .vertrauenGeaendert)
    // ein Wert dazu ändert nichts — die Aktion trägt keine Daten
    #expect(AppAktion.pruefe(["aktion": "vertrauen-geaendert", "wert": "egal"], vault: nil, oberflaeche: .studio) == .vertrauenGeaendert)
    // Die Übersicht ist Kit-Code aus dem Vault: sie darf das nicht melden — auch ohne Angabe der Herkunft nicht
    #expect(AppAktion.pruefe(["aktion": "vertrauen-geaendert"], vault: nil, oberflaeche: .app) == nil)
    #expect(AppAktion.pruefe(["aktion": "vertrauen-geaendert"], vault: nil) == nil)
    // ähnlich geschriebene Namen sind unbekannt
    for name in ["vertrauen_geaendert", "vertrauenGeaendert", "Vertrauen-geaendert", "vertrauen-geändert", "vertrauen"] {
        #expect(AppAktion.pruefe(["aktion": name], vault: nil, oberflaeche: .studio) == nil, "\(name)")
    }
}

@Test func ohneAngabeGiltDieStrengsteHerkunft() {
    // Wer die Herkunft vergisst, bekommt nur die drei alten Aktionen — nie Ordner-Dialog, Vault-Wechsel oder Titel.
    for aktion in ["ordner-waehlen", "vault-gewechselt", "vertrauen-geaendert", "titel"] {
        #expect(AppAktion.pruefe(["aktion": aktion], vault: nil) == nil, "\(aktion)")
    }
    #expect(AppAktion.pruefe(["aktion": "ansicht"], vault: nil) == .ansicht)
}

// MARK: Fehlerhaken (Aktion `fehler`)

@Test func aktionFehlerNimmtTextUndOrtAn() {
    let wert: [String: Any] = ["text": "TypeError: undefined is not an object", "ort": "app.js:1411:5"]
    #expect(AppAktion.pruefe(["aktion": "fehler", "wert": wert], vault: nil, oberflaeche: .studio)
            == .fehler(text: "TypeError: undefined is not an object", ort: "app.js:1411:5"))
    // ohne Vault ebenso (Willkommen), Ort fehlt oder ist unbrauchbar → „unbekannt“
    #expect(AppAktion.pruefe(["aktion": "fehler", "wert": ["text": "x"]], vault: nil, oberflaeche: .studio) == .fehler(text: "x", ort: "unbekannt"))
    for ort in [5, "", "   ", "?x=1"] as [Any] {
        #expect(AppAktion.pruefe(["aktion": "fehler", "wert": ["text": "x", "ort": ort]], vault: nil, oberflaeche: .studio)
                == .fehler(text: "x", ort: "unbekannt"), "\(ort)")
    }
}

@Test func aktionFehlerKuerztTextUndOrtUndEntferntQueryUndZeilenumbrueche() {
    // Text: einzeilig, Steuer-/Format-Zeichen weg, auf 300 Zeichen gekürzt; leer → Platzhalter
    #expect(AppAktion.pruefe(["aktion": "fehler", "wert": ["text": "Zeile 1\nZeile\u{202E}2\t3"]], vault: nil, oberflaeche: .studio)
            == .fehler(text: "Zeile 1 Zeile2 3", ort: "unbekannt"))
    #expect(AppAktion.pruefe(["aktion": "fehler", "wert": ["text": "  \n "]], vault: nil, oberflaeche: .studio) == .fehler(text: "(ohne Text)", ort: "unbekannt"))
    if case .fehler(let t, _)? = AppAktion.pruefe(["aktion": "fehler", "wert": ["text": String(repeating: "ä", count: 1000)]], vault: nil, oberflaeche: .studio) {
        #expect(t.count == AppAktion.maxFehlertext)
        #expect(AppAktion.maxFehlertext == 300)
    } else {
        Issue.record("langer Fehlertext wurde nicht gekürzt übernommen")
    }
    // Ort: nur bis zum ersten Leerzeichen/Query/Fragment (ein Ort mit Notiztitel in der Query oder Leerzeichen bleibt draußen), gekürzt
    #expect(AppAktion.pruefe(["aktion": "fehler", "wert": ["text": "x", "ort": "app.js?pfad=Meine Notiz.md:3:4"]], vault: nil, oberflaeche: .studio)
            == .fehler(text: "x", ort: "app.js"))
    #expect(AppAktion.pruefe(["aktion": "fehler", "wert": ["text": "x", "ort": "editor.js:12:7 in Meine Notiz"]], vault: nil, oberflaeche: .studio)
            == .fehler(text: "x", ort: "editor.js:12:7"))
    if case .fehler(_, let o)? = AppAktion.pruefe(["aktion": "fehler", "wert": ["text": "x", "ort": String(repeating: "a", count: 500)]], vault: nil, oberflaeche: .studio) {
        #expect(o.count == AppAktion.maxFehlerort)
    } else {
        Issue.record("langer Ort wurde nicht gekürzt übernommen")
    }
}

@Test func aktionFehlerVerwirftFalscheFormen() {
    // ohne Wert, kein Objekt, Text fehlt oder ist kein Text → verworfen
    for wert in [nil, NSNull(), "text", 5, ["x"], ["ort": "app.js:1:1"], ["text": 5], ["text": NSNull()]] as [Any?] {
        var nachricht: [String: Any] = ["aktion": "fehler"]
        if let wert { nachricht["wert"] = wert }
        #expect(AppAktion.pruefe(nachricht, vault: nil, oberflaeche: .studio) == nil, "\(String(describing: wert))")
    }
}

@Test func aktionFehlerGiltNurFuerDasStudio() {
    // Die Übersicht ist Kit-Code aus dem Vault und darf nichts ins App-Log schreiben; ohne Herkunftsangabe gilt dasselbe.
    let v = tempOrdner("Vault")
    let nachricht: [String: Any] = ["aktion": "fehler", "wert": ["text": "x", "ort": "app.js:1:1"]]
    #expect(AppAktion.pruefe(nachricht, vault: v, oberflaeche: .app) == nil)
    #expect(AppAktion.pruefe(nachricht, vault: v) == nil)
    #expect(AppAktion.pruefe(nachricht, vault: v, oberflaeche: .studio) == .fehler(text: "x", ort: "app.js:1:1"))
}

// MARK: Drosselung der Meldung `fehler` (Review SW-7)

@Test func drosselLaesstDieGrenzeDurchUndMeldetDieDrosselungEinmal() {
    var d = MeldungsDrossel(grenze: 3)
    #expect(d.melde() == .durchlassen)
    #expect(d.melde() == .durchlassen)
    #expect(d.melde() == .durchlassen)
    #expect(d.durchgelassen == 3)
    // die vierte ist die erste zu viel: verwerfen und EINMAL melden; danach nur noch stillschweigend verwerfen
    #expect(d.melde() == .ersteDrosselung)
    for _ in 0..<1000 { #expect(d.melde() == .verwerfen) }
    #expect(d.durchgelassen == 3, "die Zahl der durchgelassenen Meldungen wächst nie über die Grenze")
    #expect(d.gedrosselt)
}

@Test func drosselHatJeFensterEinenEigenenZaehler() {
    // Jedes Fenster legt seine Drossel neu an (`FensterSteuerung.oeffne`): Die alte Zählung gilt für das neue Fenster nicht.
    var a = MeldungsDrossel(grenze: 2)
    _ = a.melde(); _ = a.melde(); _ = a.melde()
    var b = MeldungsDrossel(grenze: 2)
    #expect(b.melde() == .durchlassen)
    #expect(a.melde() == .verwerfen)
    // Grenze 0 lässt nichts durch; eine negative Grenze zählt als 0
    var null = MeldungsDrossel(grenze: 0)
    #expect(null.melde() == .ersteDrosselung)
    #expect(MeldungsDrossel(grenze: -5).grenze == 0)
}

@Test func fehlerJeFensterSindWieImFehlerhakenAuf20Begrenzt() {
    // Dieselbe Zahl wie `MAX_MELDUNGEN` in `fehlerhaken.js` — aber hier gilt sie je Fensterleben, nicht je Seitenladen.
    #expect(AppAktion.maxFehlerJeFenster == 20)
    var d = MeldungsDrossel(grenze: AppAktion.maxFehlerJeFenster)
    var durch = 0
    for _ in 0..<500 where d.melde() == .durchlassen { durch += 1 }
    #expect(durch == 20)
}

@Test func ordnerZeigenBrauchtEinenVault() {
    #expect(AppAktion.pruefe(["aktion": "ordner-zeigen", "wert": "09_wiki/seite.md"], vault: nil, oberflaeche: .studio) == nil)
    // andere Aktionen brauchen keinen
    #expect(AppAktion.pruefe(["aktion": "ansicht"], vault: nil, oberflaeche: .studio) == .ansicht)
    #expect(AppAktion.pruefe(["aktion": "extern", "wert": "https://example.com"], vault: nil, oberflaeche: .studio) != nil)
}

// MARK: Zeitlimits je Pfad (Studio v2)

@Test func zeitlimitsDerStudioRouten() {
    func limit(_ pfad: String) -> Duration { BrueckenVerbindung.zeitlimit(fuerPfad: pfad) }
    // lang laufende Routen (Spec §8: Node-Gesamtfristen plus Reserve): Vault öffnen/neu/klonen 330 s, Remote hinzufügen 150 s
    // (Node 120 s), Commit 90 s (Node 75 s), Abgleich 400 s
    for pfad in ["/api/vaults/oeffnen", "/api/vaults/neu", "/api/vaults/klonen"] {
        #expect(limit(pfad) == .seconds(330), "\(pfad)")
    }
    #expect(limit("/api/git/remote") == .seconds(150))
    #expect(limit("/api/git/commit") == .seconds(90))
    #expect(limit("/api/git/sync") == .seconds(400))
    #expect(limit("/api/git/konflikt/loesen") == .seconds(450))
    #expect(limit("/api/git/konflikt") == .seconds(90))
    // Query, Schrägstrich am Ende und Groß/klein ändern die Zuordnung nicht
    for pfad in ["/api/vaults/klonen?x=1", "/api/vaults/klonen/", "/API/Vaults/Klonen",
                 "/api/vaults/oeffnen?x=1", "/api/vaults/oeffnen/", "/API/Vaults/Oeffnen",
                 "/api/vaults/neu?x=1", "/api/vaults/neu/", "/API/VAULTS/NEU"] {
        #expect(limit(pfad) == .seconds(330), "\(pfad)")
    }
    #expect(limit("/api/git/remote?x=1") == .seconds(150))
    #expect(limit("/api/git/remote/") == .seconds(150))
    #expect(limit("/api/git/commit?x=1") == .seconds(90))
    #expect(limit("/api/git/commit/") == .seconds(90))
    #expect(limit("/api/git/sync?x=1") == .seconds(400))
    // Unterpfade und ähnliche Namen bekommen NICHT die lange Frist
    for pfad in ["/api/vaults/klonen/x", "/api/vaults/klonenx", "/api/vaults/oeffnen/x", "/api/vaults/oeffnenx",
                 "/api/vaults/neu/x", "/api/vaults/neue"] {
        #expect(limit(pfad) == .seconds(30), "\(pfad)")
    }
    #expect(limit("/api/git/remote/x") == .seconds(90))
    #expect(limit("/api/git/remotes") == .seconds(90))
    #expect(limit("/api/git/sync/x") == .seconds(90))
    // übrige Git-Routen 90 s, alles andere 30 s (auch die übrigen Vault-Routen)
    for pfad in ["/api/git/status", "/api/git/commit/x", "/api/git/verlauf?pfad=a.md", "/api/git/log?max=50", "/api/git/diff"] {
        #expect(limit(pfad) == .seconds(90), "\(pfad)")
    }
    // Posteingang sichten endet in einem Commit (Node-Frist 75 s): wie der Commit 90 s
    for pfad in ["/api/posteingang/verwerfen", "/api/posteingang/spaeter", "/api/posteingang/uebernehmen"] {
        #expect(limit(pfad) == .seconds(90), "\(pfad)")
    }
    for pfad in ["/api/vaults", "/api/vaults/aktiv", "/api/vaults/entfernen", "/api/info", "/api/kit/vertrauen", "/api/mcp/verbinden",
                 "/api/notizen", "/api/notiz/kontext?pfad=a.md", "/api/probe", "/api/ki/erkennen", "/index.html"] {
        #expect(limit(pfad) == .seconds(30), "\(pfad)")
    }
    // Schreibende Anfragen werden nach einem Brückenabsturz nie wiederholt (kein doppeltes Klonen/Pushen)
    #expect(!BrueckenVerbindung.darfWiederholen(methode: "POST"))
    #expect(!BrueckenVerbindung.darfWiederholen(methode: "PUT"))
}

// MARK: Fenstermaße

@Test func studioFensterMasseUndStartgroesse() {
    #expect(StudioFenster.minimum == CGSize(width: 1100, height: 700))
    #expect(StudioFenster.startMinimum == CGSize(width: 1280, height: 820))
    #expect(StudioFenster.startMaximum == CGSize(width: 1800, height: 1150))
    // 85 % der sichtbaren Fläche je Achse (1920×1055 → 1632×897)
    #expect(StudioFenster.startgroesse(sichtbar: CGSize(width: 1920, height: 1055)) == CGSize(width: 1632, height: 897))
    // 14"-MacBook (sichtbar 1512×944 → 85 % = 1285×802): Breite über der Untergrenze, Höhe auf 820 angehoben
    #expect(StudioFenster.startgroesse(sichtbar: CGSize(width: 1512, height: 944)) == CGSize(width: 1285, height: 820))
    // 13"-MacBook (1440×875): beide Achsen auf der Untergrenze
    #expect(StudioFenster.startgroesse(sichtbar: CGSize(width: 1440, height: 875)) == CGSize(width: 1280, height: 820))
    // riesige Bildschirme: nicht größer als 1800×1150
    #expect(StudioFenster.startgroesse(sichtbar: CGSize(width: 2560, height: 1415)) == CGSize(width: 1800, height: 1150))
    #expect(StudioFenster.startgroesse(sichtbar: CGSize(width: 5120, height: 2800)) == CGSize(width: 1800, height: 1150))
    // kleiner als die Untergrenze: die ganze sichtbare Fläche; winzig: nie unter dem Fenster-Minimum
    #expect(StudioFenster.startgroesse(sichtbar: CGSize(width: 1280, height: 775)) == CGSize(width: 1280, height: 775))
    #expect(StudioFenster.startgroesse(sichtbar: CGSize(width: 1180, height: 760)) == CGSize(width: 1180, height: 760))
    #expect(StudioFenster.startgroesse(sichtbar: CGSize(width: 1000, height: 600)) == CGSize(width: 1100, height: 700))
    // gemerkte Größe aus 0.2.0 (Minimum war 900×600) wird angehoben, größere bleibt
    #expect(StudioFenster.mindestens(CGSize(width: 900, height: 600)) == CGSize(width: 1100, height: 700))
    #expect(StudioFenster.mindestens(CGSize(width: 1600, height: 650)) == CGSize(width: 1600, height: 700))
    #expect(StudioFenster.standardTitel == "Kortex Studio")
}

// MARK: Lage der Fenster (mittig, wiederherstellen, Bildschirm weg)

@Test func startrahmenIstMittigImSichtbarenBereich() {
    // Hauptbildschirm mit Menüleiste oben und Dock unten: sichtbarer Bereich 1920×1055 ab y = 25
    let haupt = CGRect(x: 0, y: 25, width: 1920, height: 1055)
    #expect(StudioFenster.startrahmen(sichtbar: haupt) == CGRect(x: 144, y: 104, width: 1632, height: 897))
    // zweiter Bildschirm rechts davon, tiefer angeordnet (Ursprung nicht bei 0)
    let zweiter = CGRect(x: 1920, y: -400, width: 2560, height: 1440)
    #expect(StudioFenster.startrahmen(sichtbar: zweiter) == CGRect(x: 2300, y: -255, width: 1800, height: 1150))
    // kleiner Bildschirm: das Fenster füllt die sichtbare Fläche (Minimum 1100×700 gilt trotzdem)
    let klein = CGRect(x: 0, y: 0, width: 1280, height: 775)
    #expect(StudioFenster.startrahmen(sichtbar: klein) == klein)
    // Bildschirm kleiner als das Minimum (1024×677 wie auf dem CI-Läufer): das Fenster behält 1100×700, bündig oben links
    let winzig = CGRect(x: 0, y: 25, width: 1024, height: 677)
    #expect(StudioFenster.startrahmen(sichtbar: winzig) == CGRect(x: 0, y: 2, width: 1100, height: 700))
}

@Test func mittigKuerztAufDieFlaeche() {
    let flaeche = CGRect(x: 0, y: 0, width: 1000, height: 600)
    #expect(FensterGeometrie.mittig(CGSize(width: 400, height: 200), in: flaeche) == CGRect(x: 300, y: 200, width: 400, height: 200))
    #expect(FensterGeometrie.mittig(CGSize(width: 1600, height: 900), in: flaeche) == flaeche)
}

@Test func gemerkterRahmenAufVorhandenemBildschirmBleibt() {
    let haupt = CGRect(x: 0, y: 25, width: 1920, height: 1055)
    let zweiter = CGRect(x: 1920, y: 0, width: 2560, height: 1440)
    let rahmen = CGRect(x: 2100, y: 200, width: 1500, height: 900)
    #expect(FensterGeometrie.aufBildschirmHolen(rahmen, bildschirme: [haupt, zweiter]) == rahmen)
    #expect(FensterGeometrie.aufBildschirmHolen(CGRect(x: 100, y: 100, width: 1300, height: 800), bildschirme: [haupt, zweiter]) == CGRect(x: 100, y: 100, width: 1300, height: 800))
}

@Test func verschwundenerBildschirmHoltDasFensterMittigZumHauptbildschirm() {
    let haupt = CGRect(x: 0, y: 25, width: 1440, height: 875)
    // das Fenster lag auf einem zweiten Bildschirm rechts, der jetzt fehlt
    let weg = CGRect(x: 2100, y: 200, width: 1500, height: 900)
    #expect(FensterGeometrie.aufBildschirmHolen(weg, bildschirme: [haupt]) == CGRect(x: 0, y: 25, width: 1440, height: 875), "größer als die Fläche: gekürzt und mittig")
    let kleiner = CGRect(x: 3000, y: -500, width: 1200, height: 700)
    #expect(FensterGeometrie.aufBildschirmHolen(kleiner, bildschirme: [haupt]) == CGRect(x: 120, y: 113, width: 1200, height: 700))
}

@Test func halbAbgeschnittenerRahmenWirdHineingeschoben() {
    let haupt = CGRect(x: 0, y: 25, width: 1440, height: 875)
    // ragt links und unten hinaus
    #expect(FensterGeometrie.aufBildschirmHolen(CGRect(x: -300, y: -100, width: 1200, height: 800), bildschirme: [haupt]) == CGRect(x: 0, y: 25, width: 1200, height: 800))
    // ragt rechts hinaus (Kopf sichtbar)
    #expect(FensterGeometrie.aufBildschirmHolen(CGRect(x: 600, y: 150, width: 1200, height: 700), bildschirme: [haupt]) == CGRect(x: 240, y: 150, width: 1200, height: 700))
    // ragt mit dem Kopf noch zur Hälfte über die Oberkante: wird nach unten geschoben (Menüleiste verdeckt sonst die Ampel)
    #expect(FensterGeometrie.aufBildschirmHolen(CGRect(x: 100, y: 230, width: 1200, height: 690), bildschirme: [haupt]) == CGRect(x: 100, y: 210, width: 1200, height: 690))
    // größer als der Bildschirm: wird verkleinert
    #expect(FensterGeometrie.aufBildschirmHolen(CGRect(x: 0, y: 25, width: 2000, height: 1200), bildschirme: [haupt]) == haupt)
}

@Test func kopfNurAmRandSichtbarGiltAlsVerloren() {
    let haupt = CGRect(x: 0, y: 25, width: 1440, height: 875)
    // nur 10 pt vom Fenster ragen noch in den Bildschirm (links): nicht greifbar → mittig zurück
    let fast = CGRect(x: -1190, y: 100, width: 1200, height: 700)
    #expect(FensterGeometrie.aufBildschirmHolen(fast, bildschirme: [haupt]) == CGRect(x: 120, y: 113, width: 1200, height: 700))
    // Kopf über der Oberkante (nur der Rumpf ragt in den Bildschirm): ebenfalls zurück
    let oben = CGRect(x: 100, y: 880, width: 1200, height: 700)
    #expect(FensterGeometrie.aufBildschirmHolen(oben, bildschirme: [haupt]) == CGRect(x: 120, y: 113, width: 1200, height: 700))
}

@Test func beiZweiBildschirmenGewinntDerMitDemMeistenKopf() {
    let links = CGRect(x: 0, y: 0, width: 1440, height: 900)
    let rechts = CGRect(x: 1440, y: 0, width: 1920, height: 1080)
    // Fenster überspannt die Naht, der größere Teil des Kopfes liegt rechts: es bleibt dort und rutscht ganz hinein
    let r = FensterGeometrie.aufBildschirmHolen(CGRect(x: 1200, y: 100, width: 1400, height: 800), bildschirme: [links, rechts])
    #expect(r == CGRect(x: 1440, y: 100, width: 1400, height: 800))
}

@Test func geholterRahmenWirdNieKleinerAlsDasMinimum() {
    let winzig = CGRect(x: 0, y: 25, width: 1024, height: 677)
    let r = FensterGeometrie.aufBildschirmHolen(CGRect(x: 2000, y: 100, width: 1500, height: 900), bildschirme: [winzig], minimum: StudioFenster.minimum)
    #expect(r == CGRect(x: 0, y: 2, width: 1100, height: 700), "Bildschirm weg, Hauptbildschirm kleiner als das Minimum: Minimum, oben links bündig")
    let r2 = FensterGeometrie.aufBildschirmHolen(CGRect(x: 100, y: 50, width: 1100, height: 700), bildschirme: [winzig], minimum: StudioFenster.minimum)
    #expect(r2.size == StudioFenster.minimum && r2.maxY == winzig.maxY && r2.minX == 0)
}

@Test func ohneBildschirmeBleibtDerRahmen() {
    let r = CGRect(x: 5, y: 6, width: 700, height: 500)
    #expect(FensterGeometrie.aufBildschirmHolen(r, bildschirme: []) == r)
}

// MARK: Titelleiste: Doppelklick und Ampel

@Test func doppelklickAufDieTitelleisteFolgtDerSystemeinstellung() {
    #expect(TitelleistenDoppelklick.aus(einstellung: "Maximize") == .zoomen)
    #expect(TitelleistenDoppelklick.aus(einstellung: nil) == .zoomen, "ohne Einstellung gilt der Standard")
    #expect(TitelleistenDoppelklick.aus(einstellung: "Fill") == .zoomen, "Unbekanntes = Standard")
    #expect(TitelleistenDoppelklick.aus(einstellung: "Minimize") == .ablegen)
    #expect(TitelleistenDoppelklick.aus(einstellung: "None") == .nichts)
}

@Test func ampelSitztMittigInDerKopfzeile() {
    #expect(FensterAmpel.zeile == 44)
    // Knopf 14 pt hoch in einem Fenster von 900 pt: Unterkante = 900 − 44 + 15
    #expect(FensterAmpel.untereKante(knopfHoehe: 14, fensterHoehe: 900) == 871)
    #expect(FensterAmpel.untereKante(knopfHoehe: 16, fensterHoehe: 900) == 870)
    // Platz der Seite: Zoom-Knopf endet bei x = 76 → 76 + 14 Luft = 90
    #expect(FensterAmpel.platz(rechterRandZoom: 76) == 90)
    #expect(FensterAmpel.platz(rechterRandZoom: 76.2) == 91, "auf ganze Punkte aufgerundet")
}

@Test func ampelSkriptSetztNurDieDreiWerteAmHtml() {
    let s = FensterAmpel.skript(platz: 90, hoehe: 44, vorschauText: nil)
    #expect(s.contains("'--ampel-platz','90px'") && s.contains("'--ampel-hoehe','44px'"))
    #expect(!s.contains("vorschau") && !s.contains("glas"))
    #expect(FensterAmpel.skript(platz: 90, hoehe: 44, vorschauText: nil, glas: true).contains("r.dataset.glas='1';"))
    #expect(FensterAmpel.skript(platz: 0, hoehe: 0, vorschauText: nil).contains("'--ampel-platz','0px'"), "Vollbild: kein Platz")
    let v = FensterAmpel.skript(platz: 90, hoehe: 44, vorschauText: "Vorschau — nichts wird gespeichert")
    #expect(v.contains("r.dataset.vorschau='Vorschau — nichts wird gespeichert';"))
    // Anführungszeichen und Zeilenumbrüche können das Skript nicht aufbrechen
    let boese = FensterAmpel.skript(platz: 1, hoehe: 1, vorschauText: "a'b\\c\nd")
    #expect(boese.contains("a\\'b") && !boese.contains("\n"))
}

@Test func fensterAktionenGeltenNurFuerDasStudio() {
    #expect(AppAktion.pruefe(["aktion": "fenster-ziehen"], vault: nil, oberflaeche: .studio) == .fensterZiehen)
    #expect(AppAktion.pruefe(["aktion": "fenster-zoom"], vault: nil, oberflaeche: .studio) == .fensterZoom)
    #expect(AppAktion.pruefe(["aktion": "fenster-ziehen"], vault: nil, oberflaeche: .app) == nil)
    #expect(AppAktion.pruefe(["aktion": "fenster-zoom"], vault: nil) == nil, "ohne Angabe gilt die strengste Herkunft")
    #expect(AppAktion.pruefe(["aktion": "fenster-verschieben"], vault: nil, oberflaeche: .studio) == nil)
}

@Test func darstellungKenntNurHellDunkelSystemUndNurImStudio() {
    for (name, erwartet) in [("hell", FensterDarstellung.hell), ("dunkel", .dunkel), ("system", .system)] {
        #expect(AppAktion.pruefe(["aktion": "darstellung", "wert": name], vault: nil, oberflaeche: .studio) == .darstellung(erwartet), "\(name)")
        #expect(AppAktion.pruefe(["aktion": "darstellung", "wert": name], vault: nil, oberflaeche: .app) == nil, "\(name) nur Studio")
    }
    for ungueltig: Any in ["Hell", "light", "", 1, ["a": 1]] {
        #expect(AppAktion.pruefe(["aktion": "darstellung", "wert": ungueltig], vault: nil, oberflaeche: .studio) == nil)
    }
    #expect(AppAktion.pruefe(["aktion": "darstellung"], vault: nil, oberflaeche: .studio) == nil)
}

// MARK: Brücken-Argumente

@Test func standardArgumenteSindDieBrueckeDesKerns() {
    let v = URL(fileURLWithPath: "/tmp/Mein Brain", isDirectory: true)
    let k = URL(fileURLWithPath: "/tmp/Kortex/bin/kern", isDirectory: true)
    #expect(BrueckenVerbindung.startArgumente(skript: nil, vault: v, kern: k) == ["/tmp/Kortex/bin/kern/ansicht/bruecke.mjs", "--vault", "/tmp/Mein Brain"])
    #expect(BrueckenVerbindung.kernSkript(kern: k).path == "/tmp/Kortex/bin/kern/ansicht/bruecke.mjs")
    // ohne Kern gibt es nichts zu starten — nie ein Ausweichen auf Code im Vault
    #expect(BrueckenVerbindung.startArgumente(skript: nil, vault: v, kern: nil) == [])
    #expect(!BrueckenVerbindung.startArgumente(skript: nil, vault: v, kern: k).contains { $0.contains(".tools") })
}

@Test func ohneVaultGibtEsNurDasSkript() {
    let w = URL(fileURLWithPath: "/Applications/Brain.app/Contents/Resources/werkstatt/werkstatt.mjs")
    #expect(BrueckenVerbindung.startArgumente(skript: w, vault: nil) == [w.path])
    // Kern-Brücke ohne Vault gibt es nicht; ohne alles: nichts zu starten
    #expect(BrueckenVerbindung.startArgumente(skript: nil, vault: nil) == [])
}

@Test func eigenesSkriptErsetztDieKernBruecke() {
    let v = URL(fileURLWithPath: "/tmp/Mein Brain", isDirectory: true)
    let w = URL(fileURLWithPath: "/Applications/Brain.app/Contents/Resources/werkstatt/werkstatt.mjs")
    #expect(BrueckenVerbindung.startArgumente(skript: w, vault: v) == [w.path, "/tmp/Mein Brain"])
}

// MARK: Bridge mit Attrappe (kein Kit nötig)

private let attrappe = """
process.stdout.write(JSON.stringify({bereit:true,version:"test",vaultId:"x",argv:process.argv.slice(2)})+"\\n");
let puffer="";
process.stdin.on("data",d=>{puffer+=d;let i;while((i=puffer.indexOf("\\n"))>=0){const z=puffer.slice(0,i);puffer=puffer.slice(i+1);
const a=JSON.parse(z);const b=Buffer.from(JSON.stringify({pfad:a.pfad,vault:process.argv[2]})).toString("base64");
process.stdout.write(JSON.stringify({id:a.id,status:200,headers:{"Content-Type":"application/json"},body:b})+"\\n");}});
process.stdin.on("end",()=>process.exit(0));
"""

@Suite(.enabled(if: BrueckenUmgebung.node != nil, "braucht ein Node"))
struct EigenesSkriptTests {
    @Test func werkstattAttrappeBeantwortetAnfragen() async throws {
        let ordner = tempOrdner()
        let skriptURL = ordner.appendingPathComponent("werkstatt.mjs")
        try attrappe.write(to: skriptURL, atomically: true, encoding: .utf8)
        let vault = tempOrdner("Vault mit Leerzeichen")
        let b = BrueckenVerbindung(node: BrueckenUmgebung.node!, vault: vault, skript: skriptURL)
        try await b.starte()
        let a = try await b.anfrage(methode: "GET", pfad: "/api/info")
        #expect(a.status == 200)
        let antwort = try #require(try JSONSerialization.jsonObject(with: a.body) as? [String: String])
        #expect(antwort["pfad"] == "/api/info")
        #expect(antwort["vault"] == vault.path)
        await b.beende()
    }

    /// Studio vor der Vault-Wahl: kein Vault-Argument, kein BRAIN_VAULT, BRAIN_APP_SUPPORT bleibt.
    @Test func werkstattStartetOhneVaultArgumentUndOhneBrainVault() async throws {
        let ordner = tempOrdner()
        let ohne = """
        process.stdout.write(JSON.stringify({bereit:true,version:"test"})+"\\n");
        let puffer="";
        process.stdin.on("data",d=>{puffer+=d;let i;while((i=puffer.indexOf("\\n"))>=0){const z=puffer.slice(0,i);puffer=puffer.slice(i+1);
        const a=JSON.parse(z);const b=Buffer.from(JSON.stringify({argv:process.argv.slice(2),brainVault:process.env.BRAIN_VAULT??null,support:process.env.BRAIN_APP_SUPPORT??null,cwd:process.cwd()})).toString("base64");
        process.stdout.write(JSON.stringify({id:a.id,status:200,headers:{},body:b})+"\\n");}});
        process.stdin.on("end",()=>process.exit(0));
        """
        let skriptURL = ordner.appendingPathComponent("werkstatt.mjs")
        try ohne.write(to: skriptURL, atomically: true, encoding: .utf8)
        let support = tempOrdner("Support mit Leerzeichen")
        // (Kein setenv im Test: Tests laufen parallel und starten selbst Prozesse. Das Entfernen eines geerbten BRAIN_VAULT
        // prüft `kindUmgebungOhneVaultEntferntAuchGeerbtesBrainVault` mit eigener Basis-Umgebung.)
        let b = BrueckenVerbindung(node: BrueckenUmgebung.node!, vault: nil, skript: skriptURL,
                                   umgebung: ["BRAIN_APP_SUPPORT": support.path], arbeitsordner: support)
        let a = try await b.anfrage(methode: "GET", pfad: "/api/info")
        let antwort = try #require(try JSONSerialization.jsonObject(with: a.body) as? [String: Any])
        #expect((antwort["argv"] as? [String]) == [])
        #expect(antwort["brainVault"] is NSNull)
        #expect(antwort["support"] as? String == support.path)
        // Arbeitsverzeichnis = Support-Ordner (macOS liefert evtl. den aufgelösten /private-Pfad)
        let cwd = try #require(antwort["cwd"] as? String)
        #expect(URL(fileURLWithPath: cwd).resolvingSymlinksInPath().path == support.resolvingSymlinksInPath().path)
        await b.beende()
    }

    @Test func ohneVaultUndOhneSkriptStartetNichts() async throws {
        let b = BrueckenVerbindung(node: BrueckenUmgebung.node!, vault: nil)
        await #expect(throws: BrueckenFehler.self) { try await b.starte() }
        await b.beende()
    }
}
