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

@Test func kindUmgebungSetztVorgabenNachDerBereinigung() {
    let vault = URL(fileURLWithPath: "/tmp/Mein Brain")
    let env = NodeUmgebung.fuerKind(basis: ["NODE_OPTIONS": "--inspect", "PATH": "/usr/bin", "BRAIN_VAULT": "/fremd"],
                                    vault: vault, vorgaben: ["BRAIN_APP_SUPPORT": "/support", "BRAIN_NODE": "/n"])
    #expect(env["NODE_OPTIONS"] == nil)
    #expect(env["BRAIN_VAULT"] == "/tmp/Mein Brain")
    #expect(env["BRAIN_APP_SUPPORT"] == "/support")
    #expect(env["PATH"]?.hasSuffix("/usr/bin") == true)
}

@Test func zeitlimitJePfad() {
    #expect(BrueckenVerbindung.zeitlimit(fuerPfad: "/api/git/sync") == .seconds(400))
    #expect(BrueckenVerbindung.zeitlimit(fuerPfad: "/api/git/sync?x=1") == .seconds(400))
    #expect(BrueckenVerbindung.zeitlimit(fuerPfad: "/api/git/status") == .seconds(90))
    #expect(BrueckenVerbindung.zeitlimit(fuerPfad: "/api/git/commit") == .seconds(90))
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
