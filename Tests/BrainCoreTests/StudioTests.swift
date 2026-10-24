import Testing
import Foundation
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
    #expect(StudioBefehl.allCases.count == 3)
}

// MARK: Brücken-Argumente

@Test func standardArgumenteSindDieKitBruecke() {
    let v = URL(fileURLWithPath: "/tmp/Mein Brain", isDirectory: true)
    #expect(BrueckenVerbindung.startArgumente(skript: nil, vault: v) == ["/tmp/Mein Brain/.tools/ansicht/bruecke.mjs", "/tmp/Mein Brain"])
    #expect(BrueckenVerbindung.kitSkript(vault: v).path == "/tmp/Mein Brain/.tools/ansicht/bruecke.mjs")
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
}
