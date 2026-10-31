import Testing
import Foundation
@testable import BrainCore

// Alles in Temp-Ordnern mit Attrappen; nie ein echtes claude/codex, nie ~/.claude* oder der Schlüsselbund.

// MARK: Konto-Ordner prüfen

@Test func kontoOrdnerNilUndLeerSindStandard() {
    let w = KiTestWelt()
    #expect(KiKontoOrdner.pruefe(programm: "claude", ordner: nil, home: w.home, support: w.support) == .standard)
    #expect(KiKontoOrdner.pruefe(programm: "codex", ordner: "  ", home: w.home, support: w.support) == .standard)
}

@Test func kontoOrdnerErlaubtDirekteKinderVonHomeUndSupport() throws {
    let w = KiTestWelt()
    let fm = FileManager.default
    let h1 = w.home.appendingPathComponent(".claude-arbeit", isDirectory: true), h2 = w.home.appendingPathComponent(".codex-privat", isDirectory: true)
    let konten = w.support.appendingPathComponent("ki-konten-ordner", isDirectory: true)
    let s1 = konten.appendingPathComponent("claude-neu", isDirectory: true), s2 = konten.appendingPathComponent("codex-neu", isDirectory: true)
    for u in [h1, h2, s1, s2] { try fm.createDirectory(at: u, withIntermediateDirectories: true) }
    #expect(KiKontoOrdner.pruefe(programm: "claude", ordner: h1.path, home: w.home, support: w.support) == .ordner(h1))
    #expect(KiKontoOrdner.pruefe(programm: "codex", ordner: h2.path, home: w.home, support: w.support) == .ordner(h2))
    #expect(KiKontoOrdner.pruefe(programm: "claude", ordner: s1.path, home: w.home, support: w.support) == .ordner(s1))
    #expect(KiKontoOrdner.pruefe(programm: "codex", ordner: s2.path, home: w.home, support: w.support) == .ordner(s2))
    // „~“ steht für das Home
    #expect(KiKontoOrdner.pruefe(programm: "claude", ordner: "~/.claude-arbeit", home: w.home, support: w.support) == .ordner(h1))
}

@Test func kontoOrdnerStandardOrdnerIstStandard() throws {
    let w = KiTestWelt()
    // gleich ~/.claude bzw. ~/.codex = Standard, auch wenn der Ordner (noch) nicht existiert
    #expect(KiKontoOrdner.pruefe(programm: "claude", ordner: w.home.appendingPathComponent(".claude").path, home: w.home, support: w.support) == .standard)
    try FileManager.default.createDirectory(at: w.home.appendingPathComponent(".codex"), withIntermediateDirectories: true)
    #expect(KiKontoOrdner.pruefe(programm: "codex", ordner: "~/.codex", home: w.home, support: w.support) == .standard)
}

@Test func kontoOrdnerVerbietetFalschesProgrammFremdeOrteUndLinks() throws {
    let w = KiTestWelt()
    let fm = FileManager.default
    let echt = w.home.appendingPathComponent(".claude-echt")
    try fm.createDirectory(at: echt, withIntermediateDirectories: true)
    // Programm passt nicht zum Namen
    #expect(KiKontoOrdner.pruefe(programm: "codex", ordner: echt.path, home: w.home, support: w.support) == nil)
    // unbekanntes Programm
    #expect(KiKontoOrdner.pruefe(programm: "cursor", ordner: nil, home: w.home, support: w.support) == nil)
    // Symlink (auch auf einen erlaubten Ordner)
    let link = w.home.appendingPathComponent(".claude-link")
    try fm.createSymbolicLink(at: link, withDestinationURL: echt)
    #expect(KiKontoOrdner.pruefe(programm: "claude", ordner: link.path, home: w.home, support: w.support) == nil)
    // `..` und `.`
    #expect(KiKontoOrdner.pruefe(programm: "claude", ordner: w.home.path + "/x/../.claude-echt", home: w.home, support: w.support) == nil)
    #expect(KiKontoOrdner.pruefe(programm: "claude", ordner: w.home.path + "/./.claude-echt", home: w.home, support: w.support) == nil)
    // fremder Ort, relativer Pfad, tiefer als direktes Kind
    #expect(KiKontoOrdner.pruefe(programm: "claude", ordner: "/etc", home: w.home, support: w.support) == nil)
    #expect(KiKontoOrdner.pruefe(programm: "claude", ordner: ".claude-echt", home: w.home, support: w.support) == nil)
    try fm.createDirectory(at: echt.appendingPathComponent("unter"), withIntermediateDirectories: true)
    #expect(KiKontoOrdner.pruefe(programm: "claude", ordner: echt.path + "/unter", home: w.home, support: w.support) == nil)
    // existiert nicht / ist eine Datei
    #expect(KiKontoOrdner.pruefe(programm: "claude", ordner: w.home.path + "/.claude-fehlt", home: w.home, support: w.support) == nil)
    try "x".write(to: w.home.appendingPathComponent(".claude-datei"), atomically: true, encoding: .utf8)
    #expect(KiKontoOrdner.pruefe(programm: "claude", ordner: w.home.path + "/.claude-datei", home: w.home, support: w.support) == nil)
    // Name ohne Zusatz („.claude-“) und mit Sonderzeichen
    try fm.createDirectory(at: w.home.appendingPathComponent(".claude-"), withIntermediateDirectories: true)
    #expect(KiKontoOrdner.pruefe(programm: "claude", ordner: w.home.path + "/.claude-", home: w.home, support: w.support) == nil)
    try fm.createDirectory(at: w.home.appendingPathComponent(".claude-a b"), withIntermediateDirectories: true)
    #expect(KiKontoOrdner.pruefe(programm: "claude", ordner: w.home.path + "/.claude-a b", home: w.home, support: w.support) == nil)
    // Support: Ordner ohne passenden Namen und ki-konten-ordner als Symlink
    let konten = w.support.appendingPathComponent("ki-konten-ordner", isDirectory: true)
    try fm.createDirectory(at: konten.appendingPathComponent("anders"), withIntermediateDirectories: true)
    #expect(KiKontoOrdner.pruefe(programm: "claude", ordner: konten.path + "/anders", home: w.home, support: w.support) == nil)
}

@Test func kontoOrdnerVerbietetSupportUnterordnerAlsSymlink() throws {
    let w = KiTestWelt()
    let fm = FileManager.default
    let fremd = w.ordner("fremd")
    try fm.createDirectory(at: fremd.appendingPathComponent("claude-x"), withIntermediateDirectories: true)
    try fm.createSymbolicLink(at: w.support.appendingPathComponent("ki-konten-ordner"), withDestinationURL: fremd)
    #expect(KiKontoOrdner.pruefe(programm: "claude", ordner: w.support.path + "/ki-konten-ordner/claude-x", home: w.home, support: w.support) == nil)
}

// MARK: Anmeldestatus

private func statusFund(_ koerper: String, programm: String = "claude", in w: KiTestWelt) -> KiFund {
    let bin = w.ordner("statusbin")
    let datei = kiAttrappe(koerper, name: programm, in: bin)
    return KiFund(id: programm, name: programm, art: "terminal", pfad: datei.path, version: nil, quelle: "cli", befehl: programm)
}

private func status(_ koerper: String, programm: String = "claude", ordner: KiKontoOrdner.Auswahl = .standard,
                    basis: [String: String] = [:], zeitlimit: Duration = .seconds(30)) async -> KiAnmeldung {
    let w = KiTestWelt()
    var env = ["PATH": kiSystemPfad]
    for (k, v) in basis { env[k] = v }
    return await KiKonto.anmeldeStatus(programm: programm, ordner: ordner, fund: statusFund(koerper, programm: programm, in: w),
                                       basisUmgebung: env, zeitlimit: zeitlimit)
}

@Test func anmeldeStatusClaude() async {
    let an = await status("echo '{\"loggedIn\":true,\"email\":\"jemand@example.invalid\"}'")
    #expect(an == KiAnmeldung(zustand: "angemeldet"))
    let ohneJson = await status("echo 'Logged in as jemand'")
    #expect(ohneJson.zustand == "angemeldet")
    let aus = await status("echo '{\"loggedIn\":false}'")
    #expect(aus == KiAnmeldung(zustand: "nicht-angemeldet"))
    let fehlercode = await status("echo 'not logged in' >&2; exit 1")
    #expect(fehlercode.zustand == "nicht-angemeldet")
}

@Test func anmeldeStatusGibtNichtsAusDerAusgabeWeiter() async {
    let a = await status("echo '{\"loggedIn\":true,\"email\":\"jemand@example.invalid\",\"token\":\"geheim\"}'")
    #expect(a.grund == nil)
    #expect(!"\(a)".contains("geheim"))
    #expect(!"\(a)".contains("example.invalid"))
}

@Test func anmeldeStatusCodex() async {
    #expect(await status("echo 'Logged in using ChatGPT'", programm: "codex").zustand == "angemeldet")
    #expect(await status("echo 'Not logged in' >&2; exit 1", programm: "codex").zustand == "nicht-angemeldet")
    let unklar = await status("echo 'irgendein Fehler' >&2; exit 2", programm: "codex")
    #expect(unklar.zustand == "unbekannt")
    #expect(unklar.grund != nil)
}

@Test func anmeldeStatusHaengtOderStartetNichtIstUnbekannt() async {
    let start = ContinuousClock.now
    let haengt = await status("exec sleep 30", zeitlimit: .milliseconds(500))
    #expect(ContinuousClock.now - start < .seconds(20)) // üblich: ca. 0,6 s; die Grenze fängt nur ein Warten auf den ganzen sleep 30 ab
    #expect(haengt.zustand == "unbekannt")
    #expect(haengt.grund?.isEmpty == false)

    let fund = KiFund(id: "claude", name: "Claude Code", art: "terminal", pfad: "/nicht/vorhanden/claude", version: nil, quelle: "cli", befehl: "claude")
    let r = await KiKonto.anmeldeStatus(programm: "claude", ordner: .standard, fund: fund, basisUmgebung: ["PATH": kiSystemPfad])
    #expect(r.zustand == "unbekannt")
}

@Test func anmeldeStatusSetztKontoOrdnerNurBeiNichtStandard() async {
    let w = KiTestWelt()
    let ausgabe = w.wurzel.appendingPathComponent("env.txt")
    let fund = statusFund("env > '\(ausgabe.path)'; echo '{\"loggedIn\":true}'", in: w)
    let basis = ["PATH": kiSystemPfad, "CLAUDE_CONFIG_DIR": "/geheim/aus-der-app", "ANTHROPIC_API_KEY": "geheim-key", "CODEX_HOME": "/geheim/codex"]
    _ = await KiKonto.anmeldeStatus(programm: "claude", ordner: .standard, fund: fund, basisUmgebung: basis)
    var text = (try? String(contentsOf: ausgabe, encoding: .utf8)) ?? ""
    #expect(!text.isEmpty)
    #expect(!text.contains("CLAUDE_CONFIG_DIR"))
    #expect(!text.contains("geheim"))
    let konto = w.ordner("konto")
    _ = await KiKonto.anmeldeStatus(programm: "claude", ordner: .ordner(konto), fund: fund, basisUmgebung: basis)
    text = (try? String(contentsOf: ausgabe, encoding: .utf8)) ?? ""
    #expect(text.contains("CLAUDE_CONFIG_DIR=\(konto.path)\n"))
    #expect(!text.contains("geheim"))
    #expect(text.contains("PATH=\((fund.pfad as NSString).deletingLastPathComponent):"))
}

// MARK: Anmelden im Terminal

private func fundIn(_ ordner: URL, name: String = "claude", koerper: String = "echo 'x 1.0.0'") -> KiFund {
    let datei = kiAttrappe(koerper, name: name, in: ordner)
    return KiFund(id: name, name: name, art: "terminal", pfad: datei.path, version: nil, quelle: "cli", befehl: name)
}

@Test func anmeldenSkriptHatInhaltModusUndAnzeige() throws {
    let w = KiTestWelt()
    let konto = w.home.appendingPathComponent(".claude-arbeit", isDirectory: true)
    try FileManager.default.createDirectory(at: konto, withIntermediateDirectories: true)
    let fund = fundIn(w.ordner("bin"))
    let s = try KiAnmelden.vorbereiten(programm: "claude", ordner: .ordner(konto), fund: fund, support: w.support, home: w.home)
    #expect(s.anzeige == "CLAUDE_CONFIG_DIR=~/.claude-arbeit claude auth login")
    #expect(s.url.path.hasPrefix(w.support.appendingPathComponent("ki-anmelden").path + "/"))
    #expect(s.url.pathExtension == "command")
    let attr = try FileManager.default.attributesOfItem(atPath: s.url.path)
    #expect((attr[.posixPermissions] as? NSNumber)?.intValue == 0o700)
    let text = try String(contentsOf: s.url, encoding: .utf8)
    let zeilen = text.split(separator: "\n").map(String.init)
    #expect(zeilen.first == "#!/bin/bash")
    #expect(zeilen.contains("unset CLAUDE_CONFIG_DIR CODEX_HOME ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN CLAUDE_CODE_OAUTH_TOKEN OPENAI_API_KEY CODEX_API_KEY"))
    #expect(zeilen.contains("export CLAUDE_CONFIG_DIR='\(konto.path)'"))
    #expect(zeilen.contains("'\(fund.pfad)' auth login"))
    #expect(text.contains("Fertig. Du kannst dieses Fenster schließen."))
    #expect(text.contains("rm -f \"$0\""))
    #expect(text.contains("read -r -p \"Drücke Return zum Schließen\""))
    // unset kommt vor export und vor dem Programm
    let iUnset = try #require(zeilen.firstIndex { $0.hasPrefix("unset ") }), iExport = try #require(zeilen.firstIndex { $0.hasPrefix("export CLAUDE_CONFIG_DIR") })
    #expect(iUnset < iExport)
}

@Test func anmeldenStandardOrdnerSetztKeineVariableUndCodexNutztLogin() throws {
    let w = KiTestWelt()
    let s = try KiAnmelden.vorbereiten(programm: "codex", ordner: .standard, fund: fundIn(w.ordner("bin"), name: "codex"), support: w.support, home: w.home)
    #expect(s.anzeige == "codex login")
    let text = try String(contentsOf: s.url, encoding: .utf8)
    #expect(!text.contains("export CODEX_HOME"))
    #expect(!text.contains("export CLAUDE_CONFIG_DIR"))
    #expect(text.contains("' login\n"))
    let konto = w.home.appendingPathComponent(".codex-zwei", isDirectory: true)
    try FileManager.default.createDirectory(at: konto, withIntermediateDirectories: true)
    let t = try KiAnmelden.vorbereiten(programm: "codex", ordner: .ordner(konto), fund: fundIn(w.ordner("bin2"), name: "codex"), support: w.support, home: w.home)
    #expect(t.anzeige == "CODEX_HOME=~/.codex-zwei codex login")
}

@Test func anmeldenOhneFundMeldetNaechstenSchritt() {
    let w = KiTestWelt()
    do {
        _ = try KiAnmelden.vorbereiten(programm: "claude", ordner: .standard, fund: nil, support: w.support, home: w.home)
        Issue.record("Fehler erwartet")
    } catch let f as KiAktionFehler {
        #expect(f.meldung == "Claude Code wurde nicht gefunden. Installiere es und klicke dann auf „Neu suchen“.")
    } catch { Issue.record("falscher Fehler \(error)") }
    #expect(!FileManager.default.fileExists(atPath: w.support.appendingPathComponent("ki-anmelden").path))
}

@Test func shellQuoteUndAnzeigePfad() {
    #expect(KiAnmelden.shellQuote("/a b/c") == "'/a b/c'")
    #expect(KiAnmelden.shellQuote("/it's") == "'/it'\\''s'")
    let home = URL(fileURLWithPath: "/Users/x", isDirectory: true)
    #expect(KiAnmelden.anzeigePfad("/Users/x/.claude-a", home: home) == "~/.claude-a")
    #expect(KiAnmelden.anzeigePfad("/Users/x/Library/Application Support/K/konto", home: home) == "'/Users/x/Library/Application Support/K/konto'")
    #expect(KiAnmelden.anzeigePfad("/opt/k/konto", home: home) == "/opt/k/konto")
}

@Test func anmeldenSkriptLaeuftMitSchwierigenPfadenUndRaeumtSichAuf() throws {
    // Programmpfad und Konto-Ordner mit Leerzeichen und Hochkomma; das Skript läuft wirklich (mit Attrappe), stdin = /dev/null.
    let w = KiTestWelt()
    let schwierig = w.ordner("mit Leer zeichen und 'Hochkomma'")
    let spur = w.wurzel.appendingPathComponent("spur.txt")
    let fund = fundIn(schwierig, koerper: "echo \"$CLAUDE_CONFIG_DIR|$ANTHROPIC_API_KEY|$*\" > '\(spur.path)'")
    let konto = w.home.appendingPathComponent(".claude-it's mine", isDirectory: true) // wird von der Prüfung abgelehnt, das Skript quotet trotzdem sicher
    try FileManager.default.createDirectory(at: konto, withIntermediateDirectories: true)
    let s = try KiAnmelden.vorbereiten(programm: "claude", ordner: .ordner(konto), fund: fund, support: w.support, home: w.home)
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/bin/bash")
    p.arguments = [s.url.path]
    p.environment = ["PATH": kiSystemPfad, "ANTHROPIC_API_KEY": "geheim", "CLAUDE_CONFIG_DIR": "/geheim/alt"]
    p.standardInput = FileHandle.nullDevice
    p.standardOutput = FileHandle.nullDevice
    p.standardError = FileHandle.nullDevice
    try p.run()
    p.waitUntilExit()
    #expect(p.terminationStatus == 0)
    let ausgabe = try String(contentsOf: spur, encoding: .utf8)
    #expect(ausgabe == "\(konto.path)||auth login\n")
    // Das Skript hat sich gelöscht.
    #expect(!FileManager.default.fileExists(atPath: s.url.path))
}
