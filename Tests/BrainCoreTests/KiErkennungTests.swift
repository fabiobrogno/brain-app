import Testing
import Foundation
@testable import BrainCore

// Alles mit Attrappen in Temp-Ordnern: kein echtes claude/codex, keine echten Orte. Jede Attrappe bricht mit Exit 99 ab, wenn sie
// außerhalb des temporären Ordners läuft.

// MARK: Hilfen (auch von den anderen Ki-Tests benutzt)

/// Ausführbares sh-Skript mit Schutz „nur im Temp-Ordner“.
@discardableResult
func kiAttrappe(_ koerper: String, name: String, in ordner: URL) -> URL {
    let temp = FileManager.default.temporaryDirectory.path
    let schutz = "case \"$0\" in '\(temp)'/*) ;; *) exit 99 ;; esac\n"
    return skript("#!/bin/sh\n" + schutz + koerper + "\n", name: name, in: ordner)
}

/// Nutzbarer PATH für die Attrappen (sh braucht cat, sleep, env, head …).
let kiSystemPfad = "/usr/bin:/bin"

func kiKatalog() -> KiKatalog {
    func eintrag(_ id: String, _ name: String, _ art: String, _ befehle: [String], _ apps: [String]) -> String {
        let b = befehle.map { "\"\($0)\"" }.joined(separator: ","), a = apps.map { "\"\($0)\"" }.joined(separator: ",")
        return "{\"id\":\"\(id)\",\"name\":\"\(name)\",\"art\":\"\(art)\",\"befehle\":[\(b)],\"apps\":[\(a)],\"website\":\"https://x.invalid\",\"beliebt\":true,\"verbindbar\":true}"
    }
    let json = "{\"schema\":1,\"eintraege\":[" + [
        eintrag("claude", "Claude Code", "terminal", ["claude"], []),
        eintrag("codex", "Codex", "terminal", ["codex"], []),
        eintrag("cursor", "Cursor", "editor", ["cursor-agent"], ["Cursor.app"]),
    ].joined(separator: ",") + "]}"
    return try! KiKatalog.laden(daten: Data(json.utf8))
}

/// Attrappen-Shell: schreibt Müll, dann den PATH zwischen den Marken; zählt ihre Läufe in `zaehler`.
func kiShell(pfad: [String], zaehler: URL, in ordner: URL) -> URL {
    kiAttrappe("""
    echo x >> '\(zaehler.path)'
    echo "Willkommen, hier spricht die Startdatei"
    printf '%s' "__KORTEX_PFAD__\(pfad.joined(separator: ":"))__KORTEX_PFAD__"
    echo "Nachspann"
    """, name: "shell", in: ordner)
}

func kiZaehler(_ datei: URL) -> Int {
    ((try? String(contentsOf: datei, encoding: .utf8)) ?? "").split(separator: "\n").count
}

/// Eine Testumgebung: Home, Support, Programmordner, Zähler.
struct KiTestWelt {
    let wurzel = tempOrdner()
    var home: URL { wurzel.appendingPathComponent("home", isDirectory: true) }
    var support: URL { wurzel.appendingPathComponent("support", isDirectory: true) }
    var zaehler: URL { wurzel.appendingPathComponent("zaehler.txt") }

    init() {
        try! FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        try! FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)
    }

    func ordner(_ name: String) -> URL {
        let u = wurzel.appendingPathComponent(name, isDirectory: true)
        try! FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }

    /// Erkennung mit Attrappen-Shell, die `login` als PATH ausgibt; keine Ersatzordner, App-Ordner nur `apps`.
    func erkennung(login: [URL], apps: [URL] = [], shell: URL? = nil, basis: [String: String] = [:],
                   versionZeitlimit: Duration = .seconds(30), shellZeitlimit: Duration = .seconds(30)) -> KiErkennung {
        let s = shell ?? kiShell(pfad: login.map(\.path) + ["/usr/bin", "/bin"], zaehler: zaehler, in: ordner("shellbin"))
        var env = ["PATH": kiSystemPfad, "HOME": home.path]
        for (k, v) in basis { env[k] = v }
        return KiErkennung(katalog: kiKatalog(), shell: s.path, home: home, appOrdner: apps, ersatzOrdner: [], basisUmgebung: env,
                           shellZeitlimit: shellZeitlimit, versionZeitlimit: versionZeitlimit)
    }
}

// MARK: Befehle finden

@Test func erkennungFindetBefehlMitVersion() async {
    let w = KiTestWelt()
    let bin = w.ordner("bin")
    kiAttrappe("echo 'Claude Code 2.1.5 (build 7)'", name: "claude", in: bin)
    let e = await w.erkennung(login: [bin]).programme()
    #expect(e.ausShell)
    #expect(e.programme.count == 1)
    let f = e.programme.first
    #expect(f == KiFund(id: "claude", name: "Claude Code", art: "terminal", pfad: bin.appendingPathComponent("claude").path,
                        version: "2.1.5", quelle: "cli", befehl: "claude"))
}

@Test func erkennungVerwirftTotenShimUndSuchtWeiter() async {
    let w = KiTestWelt()
    let a = w.ordner("a"), b = w.ordner("b")
    kiAttrappe("echo 'kaputt' >&2; exit 1", name: "claude", in: a)
    kiAttrappe("echo '3.0.1'", name: "claude", in: b)
    let e = await w.erkennung(login: [a, b]).programme()
    #expect(e.programme.map(\.pfad) == [b.appendingPathComponent("claude").path])
    #expect(e.programme.first?.version == "3.0.1")
}

@Test func erkennungNurToteShimsErgibtKeinenFund() async {
    let w = KiTestWelt()
    let a = w.ordner("a")
    kiAttrappe("exit 1", name: "claude", in: a)
    try! "kein Skript, keine Rechte".write(to: a.appendingPathComponent("codex"), atomically: true, encoding: .utf8) // nicht ausführbar
    #expect(await w.erkennung(login: [a]).programme().programme.isEmpty)
}

@Test func erkennungVerwirftHaengendenShimNachZeitlimit() async {
    let w = KiTestWelt()
    let a = w.ordner("a"), b = w.ordner("b")
    kiAttrappe("exec sleep 30", name: "codex", in: a)
    let gut = kiAttrappe("echo 'codex 0.9.0'", name: "codex", in: b)
    // Das Zeitlimit gilt auch für die gute Attrappe: der erste Start einer frischen Datei kann auf einem ausgelasteten Rechner (parallele
    // Tests, Virenprüfung des Systems) lange dauern. Deshalb einmal vorab starten.
    _ = await KiProzess.laufe(programm: gut.path, argumente: ["--version"], umgebung: ["PATH": kiSystemPfad], zeitlimit: .seconds(60),
                              maxByte: 4096, stderrEinmischen: true)
    let start = ContinuousClock.now
    let e = await w.erkennung(login: [a, b], versionZeitlimit: .milliseconds(1500)).programme()
    let dauer = ContinuousClock.now - start
    #expect(e.programme.map(\.pfad) == [b.appendingPathComponent("codex").path])
    #expect(dauer < .seconds(30)) // üblich: ca. 1,6 s; die Zeitgrenze selbst prüft erkennungBrichtHaengendesProgrammNachDemZeitlimitAb
}

@Test func erkennungBrichtHaengendesProgrammNachDemZeitlimitAb() async {
    let w = KiTestWelt()
    let haengt = kiAttrappe("exec sleep 30", name: "haengt", in: w.ordner("bin"))
    let start = ContinuousClock.now
    let r = await KiProzess.laufe(programm: haengt.path, argumente: ["--version"], umgebung: ["PATH": kiSystemPfad],
                                  zeitlimit: .milliseconds(300), maxByte: 4096, stderrEinmischen: true)
    #expect(r == .zeitlimit)
    #expect(ContinuousClock.now - start < .seconds(20)) // üblich: unter 1 s; die Grenze fängt nur ein Warten auf den ganzen sleep 30 ab
}

@Test func erkennungFolgtSymlinksAufAusfuehrbareDateien() async {
    let w = KiTestWelt()
    let echt = w.ordner("echt"), bin = w.ordner("bin")
    let ziel = kiAttrappe("echo 'claude 4.2.0'", name: "claude-echt", in: echt)
    try! FileManager.default.createSymbolicLink(at: bin.appendingPathComponent("claude"), withDestinationURL: ziel)
    let e = await w.erkennung(login: [bin]).programme()
    #expect(e.programme.first?.version == "4.2.0")
}

@Test func erkennungBegrenztAusgabeAuf4KB() async {
    let w = KiTestWelt()
    let bin = w.ordner("bin")
    let prog = kiAttrappe("head -c 20000 /dev/zero | tr '\\0' 'a'", name: "gross", in: bin)
    let r = await KiProzess.laufe(programm: prog.path, argumente: [], umgebung: ["PATH": kiSystemPfad], zeitlimit: .seconds(5),
                                  maxByte: KiErkennung.maxAusgabe, stderrEinmischen: true)
    guard case .beendet(0, let daten) = r else { Issue.record("unerwartet: \(r)"); return }
    #expect(daten.count == 4096)
}

@Test func erkennungKuerztVersionszeileOhneZahlAuf60Zeichen() async {
    let w = KiTestWelt()
    let bin = w.ordner("bin")
    kiAttrappe("echo; echo '\(String(repeating: "x", count: 200))'", name: "claude", in: bin)
    let v = await w.erkennung(login: [bin]).programme().programme.first?.version
    #expect(v == String(repeating: "x", count: 60))
}

@Test func versionAusAusgabe() {
    #expect(KiErkennung.version(aus: "\n\ncodex-cli 0.46.0-beta.2 (abc)\nzweite Zeile 9.9\n") == "0.46.0-beta.2")
    #expect(KiErkennung.version(aus: "v12.3") == "12.3")
    #expect(KiErkennung.version(aus: "   \n") == nil)
    #expect(KiErkennung.version(aus: "ohne Zahl") == "ohne Zahl")
}

// MARK: Login-Shell

@Test func erkennungLiestPfadAusLoginShellMitMarkenUndCache() async {
    let w = KiTestWelt()
    let bin = w.ordner("bin")
    kiAttrappe("echo 'claude 1.0.0'", name: "claude", in: bin)
    let e = w.erkennung(login: [bin])
    let pfad = await e.loginPfad()
    #expect(pfad.ausShell)
    #expect(pfad.eintraege == [bin.path, "/usr/bin", "/bin"])
    #expect(kiZaehler(w.zaehler) == 1)
    _ = await e.loginPfad()
    _ = await e.programme()
    #expect(kiZaehler(w.zaehler) == 1) // zweiter Aufruf nutzt den Cache
    _ = await e.loginPfad(neu: true)
    #expect(kiZaehler(w.zaehler) == 2)
    _ = await e.programme(neu: true)
    #expect(kiZaehler(w.zaehler) == 3)
}

@Test func erkennungErgebnisCacheUndNeu() async {
    let w = KiTestWelt()
    let bin = w.ordner("bin")
    kiAttrappe("echo 'claude 1.0.0'", name: "claude", in: bin)
    let e = w.erkennung(login: [bin])
    #expect(await e.programme().programme.count == 1)
    kiAttrappe("echo 'codex 2.0.0'", name: "codex", in: bin)
    #expect(await e.programme().programme.count == 1) // aus dem Cache
    #expect(await e.programme(neu: true).programme.count == 2)
}

@Test func erkennungGleichzeitigeAufrufeTeilenEinenLauf() async {
    let w = KiTestWelt()
    let bin = w.ordner("bin")
    kiAttrappe("echo 'claude 1.0.0'", name: "claude", in: bin)
    let e = w.erkennung(login: [bin])
    let ergebnisse = await withTaskGroup(of: KiProgrammeErgebnis.self) { gruppe in
        for _ in 0..<6 { gruppe.addTask { await e.programme(neu: true) } }
        var alle: [KiProgrammeErgebnis] = []
        for await r in gruppe { alle.append(r) }
        return alle
    }
    #expect(ergebnisse.count == 6)
    #expect(Set(ergebnisse.map(\.gesucht)).count == 1)
    #expect(kiZaehler(w.zaehler) == 1)
}

@Test func erkennungFaelltBeiHaengenderShellAufAppPfadZurueck() async {
    let w = KiTestWelt()
    let bin = w.ordner("bin"), shellOrdner = w.ordner("shellbin")
    kiAttrappe("echo 'claude 1.0.0'", name: "claude", in: bin)
    let haengt = kiAttrappe("exec sleep 30", name: "shell", in: shellOrdner)
    let start = ContinuousClock.now
    let e = await w.erkennung(login: [], shell: haengt, basis: ["PATH": "relativ:\(bin.path):\(kiSystemPfad)"],
                              shellZeitlimit: .milliseconds(1500)).programme()
    #expect(ContinuousClock.now - start < .seconds(30)) // üblich: ca. 1,6 s
    #expect(!e.ausShell)
    #expect(e.programme.first?.id == "claude") // gefunden über den PATH der App
}

@Test func erkennungFaelltBeiShellOhneMarkeZurueck() async {
    let w = KiTestWelt()
    let shellOrdner = w.ordner("shellbin")
    let ohneMarke = kiAttrappe("echo 'nur Müll'", name: "shell", in: shellOrdner)
    let pfad = await w.erkennung(login: [], shell: ohneMarke, basis: ["PATH": "/usr/bin:/bin:."]).loginPfad()
    #expect(!pfad.ausShell)
    #expect(pfad.eintraege == ["/usr/bin", "/bin"])
}

@Test func pfadAusAusgabeNimmtNurAbsoluteEintraege() {
    let text = "Müll\n__KORTEX_PFAD__/a/bin::relativ:/b/bin:.:/a/bin__KORTEX_PFAD__\nRest"
    #expect(KiErkennung.pfadAusAusgabe(text) == ["/a/bin", "/b/bin"])
    #expect(KiErkennung.pfadAusAusgabe("__KORTEX_PFAD__nur:relativ__KORTEX_PFAD__") == nil)
    #expect(KiErkennung.pfadAusAusgabe("__KORTEX_PFAD__/a") == nil)
}

@Test func erkennungNutztErsatzordner() async {
    let w = KiTestWelt()
    let ersatz = w.ordner("ersatz")
    kiAttrappe("echo 'codex 5.5.5'", name: "codex", in: ersatz)
    let shell = kiShell(pfad: ["/usr/bin", "/bin"], zaehler: w.zaehler, in: w.ordner("shellbin"))
    let e = KiErkennung(katalog: kiKatalog(), shell: shell.path, home: w.home, appOrdner: [], ersatzOrdner: [ersatz.path],
                        basisUmgebung: ["PATH": kiSystemPfad], shellZeitlimit: .seconds(30), versionZeitlimit: .seconds(30))
    #expect(await e.programme().programme.first?.version == "5.5.5")
}

// MARK: Apps

@Test func erkennungFindetAppMitVersionAusInfoPlist() async throws {
    let w = KiTestWelt()
    let apps = w.ordner("Applications")
    let inhalt = apps.appendingPathComponent("Cursor.app/Contents", isDirectory: true)
    try FileManager.default.createDirectory(at: inhalt, withIntermediateDirectories: true)
    let plist = try PropertyListSerialization.data(fromPropertyList: ["CFBundleShortVersionString": "1.7.3", "CFBundleName": "Cursor"],
                                                   format: .xml, options: 0)
    try plist.write(to: inhalt.appendingPathComponent("Info.plist"))
    let e = await w.erkennung(login: [], apps: [apps]).programme()
    #expect(e.programme == [KiFund(id: "cursor", name: "Cursor", art: "editor", pfad: apps.appendingPathComponent("Cursor.app").path,
                                   version: "1.7.3", quelle: "app", befehl: nil)])
}

@Test func erkennungAppOhnePlistHatKeineVersionUndHatVorrangVorBefehl() async throws {
    let w = KiTestWelt()
    let apps = w.ordner("Applications"), bin = w.ordner("bin")
    try FileManager.default.createDirectory(at: apps.appendingPathComponent("Cursor.app", isDirectory: true), withIntermediateDirectories: true)
    kiAttrappe("echo 'cursor-agent 9.9.9'", name: "cursor-agent", in: bin)
    let f = await w.erkennung(login: [bin], apps: [apps]).programme().programme.first
    #expect(f?.quelle == "app")
    #expect(f?.version == nil)
}

// MARK: JSON

@Test func ergebnisJsonHatDieVereinbarteForm() throws {
    let datum = Date(timeIntervalSince1970: 1_700_000_000)
    let e = KiProgrammeErgebnis(programme: [
        KiFund(id: "claude", name: "Claude Code", art: "terminal", pfad: "/a/b/claude", version: nil, quelle: "cli", befehl: "claude"),
        KiFund(id: "cursor", name: "Cursor", art: "editor", pfad: "/Applications/Cursor.app", version: "1.0", quelle: "app", befehl: nil),
    ], gesucht: datum, ausShell: true)
    let obj = try #require(JSONSerialization.jsonObject(with: e.jsonDaten()) as? [String: Any])
    #expect(Set(obj.keys) == ["programme", "gesucht", "ausShell"])
    #expect(obj["ausShell"] as? Bool == true)
    #expect(obj["gesucht"] as? String == "2023-11-14T22:13:20Z")
    let liste = try #require(obj["programme"] as? [[String: Any]])
    #expect(Set(liste[0].keys) == ["id", "name", "art", "pfad", "version", "quelle", "befehl"])
    #expect(liste[0]["version"] is NSNull)
    #expect(liste[0]["pfad"] as? String == "/a/b/claude")
    #expect(liste[1]["befehl"] is NSNull)
    #expect(liste[1]["version"] as? String == "1.0")
}

// MARK: Umgebung

@Test func kindUmgebungEntferntKontoVariablenAberBehaeltDenRest() {
    let basis = ["CLAUDE_CONFIG_DIR": "/x", "CODEX_HOME": "/x", "XDG_CONFIG_HOME": "/x", "GIT_CONFIG_GLOBAL": "/x", "CURSOR_CONFIG_DIR": "/x",
                 "GEMINI_CLI_HOME": "/x", "ANTHROPIC_API_KEY": "k", "ANTHROPIC_AUTH_TOKEN": "t", "CLAUDE_CODE_OAUTH_TOKEN": "t",
                 "OPENAI_API_KEY": "k", "CODEX_API_KEY": "k", "NODE_OPTIONS": "--require x", "DYLD_INSERT_LIBRARIES": "/x",
                 "BRAIN_TESTMODUS": "1", "HOME": "/h", "PATH": "/usr/bin"]
    let env = KiErkennung.kindUmgebung(basis: basis)
    #expect(Set(env.keys) == ["HOME", "PATH"])
    let mit = KiErkennung.kindUmgebung(basis: basis, zusatz: ["CLAUDE_CONFIG_DIR": "/konto"])
    #expect(mit["CLAUDE_CONFIG_DIR"] == "/konto")
}

@Test func erkennungGibtKontoVariablenNichtAnProgrammeWeiter() async {
    let w = KiTestWelt()
    let bin = w.ordner("bin")
    let ausgabe = w.wurzel.appendingPathComponent("env.txt")
    kiAttrappe("env > '\(ausgabe.path)'; echo 'claude 1.0.0'", name: "claude", in: bin)
    let basis = ["CLAUDE_CONFIG_DIR": "/geheim/konto", "CODEX_HOME": "/geheim/codex", "GIT_CONFIG_GLOBAL": "/geheim/git",
                 "XDG_CONFIG_HOME": "/geheim/xdg", "CURSOR_CONFIG_DIR": "/geheim/c", "GEMINI_CLI_HOME": "/geheim/g",
                 "ANTHROPIC_API_KEY": "geheim-a", "OPENAI_API_KEY": "geheim-o", "CODEX_API_KEY": "geheim-c",
                 "ANTHROPIC_AUTH_TOKEN": "geheim-t", "CLAUDE_CODE_OAUTH_TOKEN": "geheim-t2", "NODE_OPTIONS": "--require /x.js"]
    let e = await w.erkennung(login: [bin], basis: basis).programme()
    #expect(e.programme.count == 1)
    let text = (try? String(contentsOf: ausgabe, encoding: .utf8)) ?? ""
    #expect(!text.isEmpty)
    #expect(!text.contains("geheim"))
    for name in ["CLAUDE_CONFIG_DIR=", "CODEX_HOME=", "GIT_CONFIG_GLOBAL=", "XDG_CONFIG_HOME=", "NODE_OPTIONS="] { #expect(!text.contains(name)) }
    // Der Ordner des Programms steht vorn im PATH.
    #expect(text.contains("PATH=\(bin.path):"))
}
