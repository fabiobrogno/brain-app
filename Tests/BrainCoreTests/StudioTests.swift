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
        "posteingang", "alle", "wissen", "palette",
    ])
    #expect(StudioBefehl(rawValue: "vault-wechseln") == .vaultWechseln)
    #expect(StudioBefehl(rawValue: "unbekannt") == nil)
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
    for aktion in ["ordner-waehlen", "vault-gewechselt", "titel"] {
        #expect(AppAktion.pruefe(["aktion": aktion, "wert": "x"], vault: v, oberflaeche: .app) == nil, "\(aktion)")
        #expect(AppAktion.pruefe(["aktion": aktion], vault: v, oberflaeche: .studio) != nil, "\(aktion)")
    }
    // Die bisherigen drei bleiben in beiden Fenstern erlaubt
    #expect(AppAktion.pruefe(["aktion": "ansicht"], vault: v, oberflaeche: .app) == .ansicht)
    #expect(AppAktion.pruefe(["aktion": "extern", "wert": "https://example.com"], vault: v, oberflaeche: .app) != nil)
    #expect(AppAktion.pruefe(["aktion": "ordner-zeigen", "wert": "a.md"], vault: v, oberflaeche: .app) != nil)
}

@Test func ohneAngabeGiltDieStrengsteHerkunft() {
    // Wer die Herkunft vergisst, bekommt nur die drei alten Aktionen — nie Ordner-Dialog, Vault-Wechsel oder Titel.
    for aktion in ["ordner-waehlen", "vault-gewechselt", "titel"] {
        #expect(AppAktion.pruefe(["aktion": aktion], vault: nil) == nil, "\(aktion)")
    }
    #expect(AppAktion.pruefe(["aktion": "ansicht"], vault: nil) == .ansicht)
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
    // lang laufende Routen: Vault klonen 330 s, Remote hinzufügen 150 s, Abgleich 400 s
    #expect(limit("/api/vaults/klonen") == .seconds(330))
    #expect(limit("/api/git/remote") == .seconds(150))
    #expect(limit("/api/git/sync") == .seconds(400))
    // Query, Schrägstrich am Ende und Groß/klein ändern die Zuordnung nicht
    #expect(limit("/api/vaults/klonen?x=1") == .seconds(330))
    #expect(limit("/api/vaults/klonen/") == .seconds(330))
    #expect(limit("/API/Vaults/Klonen") == .seconds(330))
    #expect(limit("/api/git/remote?x=1") == .seconds(150))
    #expect(limit("/api/git/remote/") == .seconds(150))
    #expect(limit("/api/git/sync?x=1") == .seconds(400))
    // Unterpfade und ähnliche Namen bekommen NICHT die lange Frist
    #expect(limit("/api/vaults/klonen/x") == .seconds(30))
    #expect(limit("/api/vaults/klonenx") == .seconds(30))
    #expect(limit("/api/git/remote/x") == .seconds(90))
    #expect(limit("/api/git/remotes") == .seconds(90))
    #expect(limit("/api/git/sync/x") == .seconds(90))
    // übrige Git-Routen 90 s, alles andere 30 s (auch die übrigen Vault-Routen)
    for pfad in ["/api/git/status", "/api/git/commit", "/api/git/verlauf?pfad=a.md", "/api/git/log?max=50", "/api/git/diff"] {
        #expect(limit(pfad) == .seconds(90), "\(pfad)")
    }
    for pfad in ["/api/vaults", "/api/vaults/aktiv", "/api/vaults/neu", "/api/vaults/oeffnen", "/api/vaults/entfernen",
                 "/api/info", "/api/notizen", "/api/notiz/kontext?pfad=a.md", "/api/probe", "/api/ki/erkennen", "/index.html"] {
        #expect(limit(pfad) == .seconds(30), "\(pfad)")
    }
    // Schreibende Anfragen werden nach einem Brückenabsturz nie wiederholt (kein doppeltes Klonen/Pushen)
    #expect(!BrueckenVerbindung.darfWiederholen(methode: "POST"))
    #expect(!BrueckenVerbindung.darfWiederholen(methode: "PUT"))
}

// MARK: Fenstermaße

@Test func studioFensterMasseUndStartgroesse() {
    #expect(StudioFenster.minimum == CGSize(width: 1100, height: 700))
    #expect(StudioFenster.standard == CGSize(width: 1440, height: 900))
    // großer Bildschirm: Standard; kleiner: nie größer als sichtbar; winzig: nie unter dem Minimum
    #expect(StudioFenster.startgroesse(sichtbar: CGSize(width: 2560, height: 1415)) == CGSize(width: 1440, height: 900))
    #expect(StudioFenster.startgroesse(sichtbar: CGSize(width: 1280, height: 775)) == CGSize(width: 1280, height: 775))
    #expect(StudioFenster.startgroesse(sichtbar: CGSize(width: 1000, height: 600)) == CGSize(width: 1100, height: 700))
    // gemerkte Größe aus 0.2.0 (Minimum war 900×600) wird angehoben, größere bleibt
    #expect(StudioFenster.mindestens(CGSize(width: 900, height: 600)) == CGSize(width: 1100, height: 700))
    #expect(StudioFenster.mindestens(CGSize(width: 1600, height: 650)) == CGSize(width: 1600, height: 700))
    #expect(StudioFenster.standardTitel == "Brain Studio")
}

// MARK: Brücken-Argumente

@Test func standardArgumenteSindDieKitBruecke() {
    let v = URL(fileURLWithPath: "/tmp/Mein Brain", isDirectory: true)
    #expect(BrueckenVerbindung.startArgumente(skript: nil, vault: v) == ["/tmp/Mein Brain/.tools/ansicht/bruecke.mjs", "/tmp/Mein Brain"])
    #expect(BrueckenVerbindung.kitSkript(vault: v).path == "/tmp/Mein Brain/.tools/ansicht/bruecke.mjs")
}

@Test func ohneVaultGibtEsNurDasSkript() {
    let w = URL(fileURLWithPath: "/Applications/Brain.app/Contents/Resources/werkstatt/werkstatt.mjs")
    #expect(BrueckenVerbindung.startArgumente(skript: w, vault: nil) == [w.path])
    // Kit-Brücke ohne Vault gibt es nicht; ohne alles: nichts zu starten
    #expect(BrueckenVerbindung.startArgumente(skript: nil, vault: nil) == [])
}

@Test func eigenesSkriptErsetztDieKitBruecke() {
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
