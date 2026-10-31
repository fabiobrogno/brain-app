import Testing
import Foundation
@testable import BrainCore

@Test func umgebungEntferntUmlenkendeVariablen() {
    let roh = ["NODE_OPTIONS": "--require /tmp/x.js", "NODE_PATH": "/tmp", "ELECTRON_RUN_AS_NODE": "1",
               "DYLD_INSERT_LIBRARIES": "/tmp/x.dylib", "DYLD_LIBRARY_PATH": "/tmp", "LD_PRELOAD": "/tmp/x.so",
               "NODE_TLS_REJECT_UNAUTHORIZED": "0", "NODE_EXTRA_CA_CERTS": "/etc/ca.pem", "HOME": "/Users/x", "PATH": "/usr/bin"]
    let env = NodeUmgebung.bereinigt(roh)
    #expect(Set(env.keys) == ["NODE_EXTRA_CA_CERTS", "HOME", "PATH"])
}

@Test func umgebungEntferntAlleGitVariablen() {
    // GIT_*: Konfiguration, Hooks, SSH- und Askpass-Programme — die Werkstatt setzt selbst, was Git braucht
    let roh = ["GIT_SSH_COMMAND": "ssh -o ProxyCommand=x", "GIT_ASKPASS": "/tmp/x", "GIT_CONFIG_GLOBAL": "/tmp/c", "GIT_DIR": "/tmp/d",
               "GIT_EDITOR": "vim", "GIT_EXEC_PATH": "/tmp/e", "GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "core.hooksPath",
               "GIT_CONFIG_VALUE_0": "/tmp/h", "GIT_": "leer", "GITHUB_USER": "x", "GITX": "1", "HOME": "/Users/x", "PATH": "/usr/bin"]
    let env = NodeUmgebung.bereinigt(roh)
    // nur der Präfix „GIT_“ — andere Namen, die mit „GIT“ beginnen, bleiben
    #expect(Set(env.keys) == ["GITHUB_USER", "GITX", "HOME", "PATH"])
    // auch über die Kind-Umgebung
    let kind = NodeUmgebung.fuerKind(basis: roh, vault: nil, vorgaben: ["BRAIN_APP_SUPPORT": "/s"])
    #expect(kind.keys.filter { $0.hasPrefix("GIT_") }.isEmpty)
    #expect(kind["BRAIN_APP_SUPPORT"] == "/s")
}

@Test func testmodusGehtNurInDebugBuildsAnKindprozesse() {
    let roh = ["BRAIN_TESTMODUS": "1", "PATH": "/usr/bin"]
    #expect(NodeUmgebung.bereinigt(roh, testmodusWeitergeben: false)["BRAIN_TESTMODUS"] == nil)
    #expect(NodeUmgebung.bereinigt(roh, testmodusWeitergeben: true)["BRAIN_TESTMODUS"] == "1")
    // Der Standard hängt am Build: Release gibt ihn nie weiter (`swift test` läuft als Debug-Build)
    #if DEBUG
    #expect(NodeUmgebung.testmodusWeitergeben)
    #expect(NodeUmgebung.bereinigt(roh)["BRAIN_TESTMODUS"] == "1")
    #else
    #expect(!NodeUmgebung.testmodusWeitergeben)
    #expect(NodeUmgebung.bereinigt(roh)["BRAIN_TESTMODUS"] == nil)
    #endif
}

@Test func releaseGibtTestmodusAuchAusDenVorgabenNichtWeiter() {
    let env = NodeUmgebung.fuerKind(basis: ["BRAIN_TESTMODUS": "1", "PATH": "/usr/bin"], vault: nil,
                                    vorgaben: ["BRAIN_TESTMODUS": "1", "BRAIN_APP_SUPPORT": "/s"], testmodusWeitergeben: false)
    #expect(env["BRAIN_TESTMODUS"] == nil)
    #expect(env["BRAIN_APP_SUPPORT"] == "/s")
    let debug = NodeUmgebung.fuerKind(basis: ["BRAIN_TESTMODUS": "1", "PATH": "/usr/bin"], vault: nil, vorgaben: [:], testmodusWeitergeben: true)
    #expect(debug["BRAIN_TESTMODUS"] == "1")
}

@Test func kindUmgebungSetztVorgabenNachDerBereinigung() {
    let vault = URL(fileURLWithPath: "/tmp/Mein Brain")
    let env = NodeUmgebung.fuerKind(basis: ["NODE_OPTIONS": "--inspect", "PATH": "/usr/bin", "BRAIN_VAULT": "/fremd"],
                                    vault: vault, vorgaben: ["BRAIN_APP_SUPPORT": "/support", "BRAIN_NODE": "/n"])
    #expect(env["NODE_OPTIONS"] == nil)
    #expect(env["BRAIN_VAULT"] == "/tmp/Mein Brain")
    #expect(env["BRAIN_APP_SUPPORT"] == "/support")
    #expect(env["PATH"]?.hasSuffix("/usr/bin") == true)
}

@Test func kindUmgebungGibtNurAbsolutePfadEintraegeWeiter() {
    // aus der Umgebung des Starters (App aus einem Terminal gestartet, `open --env PATH=…`)
    let geerbt = NodeUmgebung.fuerKind(basis: ["PATH": "node_modules/.bin:/opt/homebrew/bin:/usr/bin:/bin"], vault: nil, vorgaben: [:])
    #expect(geerbt["PATH"] == "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin")
    // ... und ebenso aus den Vorgaben der App, die den geerbten Wert überschreiben
    let vorgabe = NodeUmgebung.fuerKind(basis: ["PATH": "/usr/bin"], vault: URL(fileURLWithPath: "/tmp/Mein Brain"), vorgaben: ["PATH": ".:./bin:/usr/bin"])
    #expect(vorgabe["PATH"] == "/opt/homebrew/bin:/usr/local/bin:/usr/bin")
    // fehlt PATH ganz, gelten die Systemordner
    #expect(NodeUmgebung.fuerKind(basis: [:], vault: nil, vorgaben: [:])["PATH"] == "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin")
    // sonst kommt nichts dazu (ohne Vault auch kein BRAIN_VAULT)
    #expect(Set(geerbt.keys) == ["PATH"])
}

@Test func zeitlimitJePfad() {
    #expect(BrueckenVerbindung.zeitlimit(fuerPfad: "/api/git/sync") == .seconds(400))
    #expect(BrueckenVerbindung.zeitlimit(fuerPfad: "/api/git/sync?x=1") == .seconds(400))
    #expect(BrueckenVerbindung.zeitlimit(fuerPfad: "/api/git/status") == .seconds(90))
    #expect(BrueckenVerbindung.zeitlimit(fuerPfad: "/api/git/commit") == .seconds(90))
    #expect(BrueckenVerbindung.zeitlimit(fuerPfad: "/api/github/repos") == .seconds(45))
    #expect(BrueckenVerbindung.zeitlimit(fuerPfad: "/api/github/repo-anlegen") == .seconds(45), "Token 15 s + Anfrage 15 s im Worst Case")
    #expect(BrueckenVerbindung.zeitlimit(fuerPfad: "/api/sicherung/verbinden") == .seconds(180))
    #expect(BrueckenVerbindung.zeitlimit(fuerPfad: "/api/sicherung/bereit") == .seconds(90))
    #expect(BrueckenVerbindung.zeitlimit(fuerPfad: "/api/umstellung/probelauf") == .seconds(46 * 60), "der Probelauf kopiert den Vault und braucht Minuten")
    #expect(BrueckenVerbindung.zeitlimit(fuerPfad: "/api/umstellung/phase-a") == .seconds(46 * 60))
    #expect(BrueckenVerbindung.zeitlimit(fuerPfad: "/api/umstellung/phase-b") == .seconds(46 * 60), "Phase B kopiert im Probelauf den Vault und notfalls den alten Werkzeug-Ordner über eine Laufwerksgrenze")
    #expect(BrueckenVerbindung.zeitlimit(fuerPfad: "/api/umstellung/rueckweg/") == .seconds(46 * 60))
    #expect(BrueckenVerbindung.zeitlimit(fuerPfad: "/api/umstellung/befund") == .seconds(75))
    #expect(BrueckenVerbindung.zeitlimit(fuerPfad: "/api/umstellung/stand?x=1") == .seconds(75))
    #expect(BrueckenVerbindung.zeitlimit(fuerPfad: "/api/umstellung/kopie-loeschen") == .seconds(75))
    #expect(BrueckenVerbindung.zeitlimit(fuerPfad: "/api/umstellungx") == .seconds(30))
    #expect(BrueckenVerbindung.zeitlimit(fuerPfad: "/api/notiz") == .seconds(30))
    #expect(BrueckenVerbindung.zeitlimit(fuerPfad: "/api/gitx") == .seconds(30))
}

@Test func neuversuchNurFuerLesendeMethoden() {
    for m in ["GET", "get", "HEAD"] { #expect(BrueckenVerbindung.darfWiederholen(methode: m)) }
    for m in ["POST", "PUT", "DELETE", "PATCH"] { #expect(!BrueckenVerbindung.darfWiederholen(methode: m)) }
}

/// Ein POST nach Brückenabsturz wird nicht wiederholt (sonst doppelte Notiz/Commit): Fehler `.beendet` geht durch.
@Test func postNachAbsturzWirdNichtWiederholt() async throws {
    guard let node = BrueckenUmgebung.node else { return }
    let ordner = tempOrdner()
    let skriptURL = skript("process.exit(1)\n", name: "stirbt.mjs", in: ordner)
    let b = BrueckenVerbindung(node: node, vault: ordner, skript: skriptURL)
    // Startet nicht (kein „bereit“) → startFehlgeschlagen; wichtig ist nur: kein Hängen, Fehler wird gemeldet.
    await #expect(throws: (any Error).self) {
        _ = try await b.anfrageMitNeuversuch(methode: "POST", pfad: "/api/notiz", body: Data("{}".utf8))
    }
    await b.beende()
}

/// 7-MB-Körper (base64 ≈ 9,3 MB je Zeile) laufen in beide Richtungen durch die Brücke.
@Test func grosseKoerperLaufenDurchDieBruecke() async throws {
    guard let node = BrueckenUmgebung.node else { return }
    let ordner = tempOrdner()
    let echo = skript("""
    console.log(JSON.stringify({ bereit: true, version: 't' }));
    let puffer = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => {
      puffer += d;
      let i;
      while ((i = puffer.indexOf('\\n')) >= 0) {
        const a = JSON.parse(puffer.slice(0, i)); puffer = puffer.slice(i + 1);
        process.stdout.write(JSON.stringify({ id: a.id, status: 200, headers: {}, body: a.body }) + '\\n');
      }
    });
    """, name: "echo.mjs", in: ordner)
    let b = BrueckenVerbindung(node: node, vault: ordner, skript: echo)
    let body = Data(repeating: 0x61, count: 7 * 1024 * 1024)
    let a = try await b.anfrage(methode: "PUT", pfad: "/api/notiz", body: body, zeitlimit: .seconds(60))
    #expect(a.status == 200)
    #expect(a.body == body)
    await b.beende()
}

@Test func testSchalterGehenNurInDebugBuildsAnKindprozesse() {
    let schalter = ["KORTEX_VAULT_VERTRAUT": "alle", "KORTEX_KERN_UNSTABIL_ERLAUBT": "1", "KORTEX_STARTER_PFAD": "/x/kortex", "KORTEX_KERN_TEMP_WURZELN": "",
                    "BRAIN_GIT_PROGRAMM": "/x/git", "BRAIN_GIT_HOOKS_ERLAUBT": "/x/hooks", "KORTEX_DIENST_PLATTFORM": "darwin"]
    let roh = schalter.merging(["PATH": "/usr/bin", "HOME": "/h"]) { a, _ in a }
    let release = NodeUmgebung.bereinigt(roh, testmodusWeitergeben: false)
    for k in schalter.keys { #expect(release[k] == nil, "\(k) darf im Release nicht in den Kindprozess") }
    #expect(release["HOME"] == "/h")
    let kindRelease = NodeUmgebung.fuerKind(basis: roh, vault: nil, vorgaben: schalter, testmodusWeitergeben: false)
    for k in schalter.keys { #expect(kindRelease[k] == nil, "\(k) auch nicht als Vorgabe") }
    let debug = NodeUmgebung.bereinigt(roh, testmodusWeitergeben: true)
    for (k, v) in schalter { #expect(debug[k] == v) }
}
