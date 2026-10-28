import Testing
import Foundation
@testable import BrainCore

// Vorschau „wie frisch installiert“: Pfad- und Umgebungsumleitung. Nie das echte HOME: das „echte“ ist hier ein Temp-Ordner.

private func vorschau(mitKi: Bool = false, ohneGit: Bool = false) -> VorschauModus {
    VorschauModus(ordner: tempOrdner("kortex-vorschau"), mitKi: mitKi, ohneGit: ohneGit)
}

private func lies(_ argumente: [String]) -> StartArgumente {
    StartArgumente.lies(["BrainApp"] + argumente, umgebung: [:])
}

// MARK: Ordner prüfen

@Test func vorschauOrdnerMussAbsolutSauberUndVorhandenSein() throws {
    let echt = tempOrdner("echtes-home")
    let ok = tempOrdner("vorschau-ok")
    #expect(try VorschauModus.pruefeOrdner(ok.path, echtesHome: echt.path).get() == ok.standardizedFileURL)
    #expect(throws: VorschauModus.OrdnerFehler.nichtAbsolut) { try VorschauModus.pruefeOrdner("relativ/pfad", echtesHome: echt.path).get() }
    #expect(throws: VorschauModus.OrdnerFehler.ungueltigeZeichen) { try VorschauModus.pruefeOrdner("/tmp/mit leerzeichen", echtesHome: echt.path).get() }
    #expect(throws: VorschauModus.OrdnerFehler.ungueltigeZeichen) { try VorschauModus.pruefeOrdner("/tmp/a'b", echtesHome: echt.path).get() }
    #expect(throws: VorschauModus.OrdnerFehler.zuFlach) { try VorschauModus.pruefeOrdner("/", echtesHome: echt.path).get() }
    #expect(throws: VorschauModus.OrdnerFehler.zuFlach) { try VorschauModus.pruefeOrdner("/tmp", echtesHome: echt.path).get() }
    #expect(throws: VorschauModus.OrdnerFehler.keinOrdner) { try VorschauModus.pruefeOrdner(ok.path + "/gibt-es-nicht", echtesHome: echt.path).get() }
}

@Test func vorschauOrdnerDarfNieDasEchteHomeOderEinVorfahrSein() throws {
    let echt = tempOrdner("echtes-home")
    #expect(throws: VorschauModus.OrdnerFehler.enthaeltEchtesHome) { try VorschauModus.pruefeOrdner(echt.path, echtesHome: echt.path).get() }
    // Vorfahr des echten HOME (hier: der Elternordner)
    #expect(throws: VorschauModus.OrdnerFehler.enthaeltEchtesHome) {
        try VorschauModus.pruefeOrdner(echt.deletingLastPathComponent().path, echtesHome: echt.path).get()
    }
    // ein Ordner IM echten HOME ist erlaubt (Tests, Entwickler), aber nicht gleich HOME
    let darin = echt.appendingPathComponent("vorschau-test", isDirectory: true)
    try FileManager.default.createDirectory(at: darin, withIntermediateDirectories: true)
    #expect(throws: Never.self) { try VorschauModus.pruefeOrdner(darin.path, echtesHome: echt.path).get() }
    // der echte Benutzerordner kommt aus der Benutzerdatenbank, nicht aus HOME
    #expect(VorschauModus.echtesHome().hasPrefix("/"))
}

// MARK: Schalter

@Test func vorschauSchalterWerdenGelesen() {
    let ordner = tempOrdner("v")
    let a = lies(["--vorschau", ordner.path, "--mit-ki", "--ohne-git"])
    #expect(a.vorschauOrdner == ordner.standardizedFileURL)
    #expect(a.vorschauMitKi && a.vorschauOhneGit)
    #expect(a.vorschauFehler == nil)
    #expect(a.vorschau == VorschauModus(ordner: ordner.standardizedFileURL, mitKi: true, ohneGit: true))
    #expect(a.fluechtig, "die Vorschau schreibt nichts in den Web-Speicher der echten App")
    #expect(a.hinweise.isEmpty)
}

@Test func ungueltigeVorschauIstEinFehlerKeinIgnorierterSchalter() {
    for argumente in [["--vorschau"], ["--vorschau", "--mit-ki"], ["--vorschau", "relativ"], ["--vorschau", "/tmp/gibt-es-nicht-\(UUID().uuidString)"]] {
        let a = lies(argumente)
        #expect(a.vorschauFehler != nil, "\(argumente)")
        #expect(a.vorschauOrdner == nil, "\(argumente)")
    }
    // ohne --vorschau ist alles beim Alten
    #expect(lies([]).vorschauFehler == nil)
}

@Test func mitKiUndOhneGitBrauchenDieVorschau() {
    let a = lies(["--mit-ki", "--ohne-git"])
    #expect(!a.vorschauMitKi && !a.vorschauOhneGit)
    #expect(a.hinweise.count == 2)
    #expect(a.vorschau == nil)
}

@Test func vorschauIgnoriertEinenEchtenVault() {
    let a = lies(["--vorschau", tempOrdner("v").path, "--vault", "/Users/jemand/brain"])
    #expect(a.vault == nil)
    #expect(a.hinweise.contains { $0.contains("--vault") })
}

@Test func assistentErscheintInDerVorschauAuchBeiTestschaltern() {
    #expect(lies([]).assistentDarfErscheinen)
    #expect(!lies(["--vault", "/tmp/x"]).assistentDarfErscheinen)
    #expect(!lies(["--test-dunkel"]).assistentDarfErscheinen)
    #expect(!lies(["--test-beenden-nach", "5"]).assistentDarfErscheinen)
    let v = tempOrdner("v").path
    #expect(lies(["--vorschau", v]).assistentDarfErscheinen)
    #expect(lies(["--vorschau", v, "--test-dunkel", "--test-beenden-nach", "5"]).assistentDarfErscheinen)
}

// MARK: Umleitung

@Test func alleKindVorgabenZeigenInDenVorschauOrdner() {
    let v = vorschau()
    let o = v.kindVorgaben
    let ordner = v.ordner.path
    #expect(o["HOME"] == ordner + "/home")
    #expect(o["CFFIXED_USER_HOME"] == ordner + "/home")
    #expect(o["BRAIN_APP_SUPPORT"] == ordner + "/support")
    #expect(o["KORTEX_VORSCHAU"] == ordner)
    #expect(o["XDG_CONFIG_HOME"] == ordner + "/home/.config")
    #expect(o["GIT_CONFIG_GLOBAL"] == ordner + "/home/.gitconfig")
    #expect(o["GIT_CONFIG_NOSYSTEM"] == "1")
    #expect(o["TMPDIR"]?.hasPrefix(ordner + "/tmp") == true)
    #expect(o["CODEX_HOME"] == ordner + "/home/.codex")
    // PATH: erst der Vorschau-Ordner, dann nur System — nie Homebrew oder /usr/local (dort läge das echte claude)
    #expect(o["PATH"] == "\(ordner)/bin:/usr/bin:/bin:/usr/sbin:/sbin")
    // ssh liest weder ~/.ssh/config noch Schlüssel noch Agent des echten Nutzers
    let ssh = o["GIT_SSH_COMMAND"] ?? ""
    #expect(ssh.contains("-F /dev/null") && ssh.contains("IdentityAgent=none") && ssh.contains("IdentityFile=/dev/null"))
    #expect(ssh.contains("UserKnownHostsFile=\(ordner)/home/.ssh/known_hosts"))
    // jeder Pfad in den Vorgaben liegt unter dem Vorschau-Ordner (außer den Systemordnern im PATH und /dev/null)
    for (k, w) in o where k != "PATH" && k != "GIT_SSH_COMMAND" && k != "GIT_CONFIG_NOSYSTEM" {
        if w.hasPrefix("/") { #expect(w.hasPrefix(ordner), "\(k)=\(w)") }
    }
}

@Test func nodeKindBekommtVorschauHomeStattEchtemHomeUndKeinenHomebrewPfad() {
    let v = vorschau()
    let echt = "/Users/echt"
    let basis = ["HOME": echt, "PATH": "/opt/homebrew/bin:\(echt)/.local/bin:/usr/local/bin:/usr/bin", "GIT_CONFIG_GLOBAL": echt + "/.gitconfig",
                 "GIT_SSH_COMMAND": "ssh -i \(echt)/.ssh/id", "SSH_AUTH_SOCK": "/private/tmp/agent", "KORTEX_VORSCHAU": "/etc", "XDG_CONFIG_HOME": echt + "/.config"]
    let env = NodeUmgebung.fuerKind(basis: basis, vault: nil, vorgaben: v.kindVorgaben)
    #expect(env["HOME"] == v.home.path)
    #expect(env["XDG_CONFIG_HOME"] == v.home.path + "/.config")
    #expect(env["GIT_CONFIG_GLOBAL"] == v.home.path + "/.gitconfig")
    #expect(env["GIT_SSH_COMMAND"] == v.kindVorgaben["GIT_SSH_COMMAND"])
    #expect(env["KORTEX_VORSCHAU"] == v.ordner.path, "geerbtes KORTEX_VORSCHAU gilt nie; nur die Vorgabe der App")
    #expect(env["PATH"] == v.kindVorgaben["PATH"])
    #expect(!(env["PATH"] ?? "").contains("homebrew") && !(env["PATH"] ?? "").contains("/usr/local"))
    #expect(!(env["PATH"] ?? "").contains(echt))
    // ohne Vorschau bleibt alles wie bisher (Homebrew vorn)
    let normal = NodeUmgebung.fuerKind(basis: basis, vault: nil, vorgaben: [:])
    #expect(normal["PATH"]?.hasPrefix("/opt/homebrew/bin") == true)
    #expect(normal["KORTEX_VORSCHAU"] == nil)
}

@Test func schutzFehlerMeldetFalschesHomeUndEchteBundleID() {
    let v = vorschau()
    let h = v.home.path
    let gut = ["HOME": h, "CFFIXED_USER_HOME": h]
    #expect(v.schutzFehler(umgebung: gut, nsHome: h, bundleID: VorschauModus.vorschauBundleID).isEmpty)
    #expect(v.schutzFehler(umgebung: gut, nsHome: h, bundleID: nil).isEmpty, "swift run ohne Info.plist: eigener Defaults-Bereich")
    #expect(v.schutzFehler(umgebung: ["HOME": "/Users/echt", "CFFIXED_USER_HOME": h], nsHome: h, bundleID: nil).count == 1)
    #expect(v.schutzFehler(umgebung: ["HOME": h], nsHome: h, bundleID: nil).count == 1)
    #expect(v.schutzFehler(umgebung: gut, nsHome: "/Users/echt", bundleID: nil).count == 1)
    #expect(v.schutzFehler(umgebung: gut, nsHome: h, bundleID: VorschauModus.echteBundleID).count == 1)
    #expect(v.schutzFehler(umgebung: [:], nsHome: "/Users/echt", bundleID: VorschauModus.echteBundleID).count == 4)
}

@Test func nurDieVorschauKennungDarfDefaultsLoeschen() {
    #expect(VorschauModus.darfDefaultsLoeschen(bundleID: "io.github.fbrogno.brain.vorschau"))
    #expect(!VorschauModus.darfDefaultsLoeschen(bundleID: "io.github.fbrogno.brain"))
    #expect(!VorschauModus.darfDefaultsLoeschen(bundleID: ".vorschau"))
    #expect(!VorschauModus.darfDefaultsLoeschen(bundleID: "com.apple.finder"))
    #expect(VorschauModus.vorschauBundleID == "io.github.fbrogno.brain.vorschau")
}

@Test func appPfadeDerVorschauLiegenImVorschauOrdner() {
    let v = vorschau()
    #expect(v.pfade.basis == v.support)
    for u in [v.pfade.konfiguration, v.pfade.vaultListe, v.pfade.einrichtung, v.pfade.nodeOrdner, v.pfade.binOrdner, v.pfade.logs, v.pfade.node] {
        #expect(u.path.hasPrefix(v.ordner.path + "/"), "\(u.path)")
    }
}

// MARK: Vorbereiten

private func alleDateien(unter ordner: URL) -> [String] {
    let e = FileManager.default.enumerator(at: ordner, includingPropertiesForKeys: nil)
    return (e?.allObjects as? [URL] ?? []).map { $0.path }.sorted()
}

@Test func vorbereitenLegtNurUnterDemVorschauOrdnerAnUndLaesstOhneKiAlleKIsWeg() throws {
    let v = vorschau()
    try v.vorbereiten()
    try v.vorbereiten() // idempotent
    for d in ["support", "home", "bin", "tmp", "home/.config", "home/.ssh"] {
        #expect(FileManager.default.fileExists(atPath: v.ordner.appendingPathComponent(d).path), Comment(rawValue: d))
    }
    #expect(try FileManager.default.contentsOfDirectory(atPath: v.bin.path).isEmpty, "frisch installiert: keine KI")
    #expect(!FileManager.default.fileExists(atPath: v.home.appendingPathComponent(".claude").path))
    for p in alleDateien(unter: v.ordner) { #expect(liegtUnter(p, v.ordner), Comment(rawValue: p)) }
}

@Test func mitKiLegtPlatzhalterFuerClaudeCodexUndCursorAn() throws {
    let v = vorschau(mitKi: true)
    try v.vorbereiten()
    #expect(Set(try FileManager.default.contentsOfDirectory(atPath: v.bin.path)) == ["claude", "codex", "cursor-agent"])
    for n in ["claude", "codex", "cursor-agent"] {
        #expect(FileManager.default.isExecutableFile(atPath: v.bin.appendingPathComponent(n).path), Comment(rawValue: n))
    }
    for d in [".claude", ".codex", ".cursor"] { #expect(FileManager.default.fileExists(atPath: v.home.appendingPathComponent(d).path), Comment(rawValue: d)) }
    for p in alleDateien(unter: v.ordner) { #expect(liegtUnter(p, v.ordner), Comment(rawValue: p)) }
}

private func lauf(_ v: VorschauModus, _ programm: String, _ args: [String], home: String? = nil) async throws -> BefehlErgebnis {
    var env = v.kindVorgaben
    if let home { env["HOME"] = home }
    return try await ProzessLauf.starte(v.bin.appendingPathComponent(programm), args, umgebung: env, ordner: v.ordner, zeitlimit: .seconds(10))
}

@Test func platzhalterTunNurWasSieSollenUndNurImVorschauHome() async throws {
    let v = vorschau(mitKi: true)
    try v.vorbereiten()
    #expect(try await lauf(v, "claude", ["--version"]).ausgabe.contains("2.1.0"))
    #expect(try await lauf(v, "codex", ["--version"]).ausgabe.contains("0.50.0"))
    #expect(try await lauf(v, "claude", ["mcp", "get", "brain"]).code == 1, "noch nicht verbunden")
    let add = try await lauf(v, "claude", ["mcp", "add", "-s", "user", "brain", "--", "/pfad/zu/node", "/pfad/brain-mcp.mjs"])
    #expect(add.code == 0)
    #expect(FileManager.default.fileExists(atPath: v.home.appendingPathComponent(".claude.json").path))
    let get = try await lauf(v, "claude", ["mcp", "get", "brain"])
    #expect(get.code == 0)
    #expect(get.ausgabe.contains("Command: /pfad/zu/node") && get.ausgabe.contains("Args: /pfad/brain-mcp.mjs"))
    #expect(try await lauf(v, "claude", ["mcp", "add", "-s", "user", "brain", "--", "x"]).code == 1, "zweites Mal: existiert schon")
    #expect(try await lauf(v, "claude", ["mcp", "remove", "-s", "user", "brain"]).code == 0)
    #expect(try await lauf(v, "claude", ["mcp", "get", "brain"]).code == 1)
}

@Test func platzhalterVerweigernDieArbeitWennHomeNichtImVorschauOrdnerLiegt() async throws {
    let v = vorschau(mitKi: true)
    try v.vorbereiten()
    let echt = tempOrdner("echtes-home")
    let r = try await lauf(v, "claude", ["mcp", "add", "-s", "user", "brain", "--", "x"], home: echt.path)
    #expect(r.code == 97)
    #expect(try FileManager.default.contentsOfDirectory(atPath: echt.path).isEmpty, "im „echten“ HOME entstand nichts")
    // und ohne KORTEX_VORSCHAU erst recht nicht
    var env = v.kindVorgaben
    env["KORTEX_VORSCHAU"] = nil
    env["HOME"] = echt.path
    let r2 = try await ProzessLauf.starte(v.bin.appendingPathComponent("claude"), ["--version"], umgebung: env, zeitlimit: .seconds(10))
    #expect(r2.code == 97)
}

// MARK: git

@Test func ohneGitMeldetFehltUndInstalliertNie() async {
    let v = vorschau(ohneGit: true)
    let p = v.gitPruefer()
    #expect(await p.pruefe() == .fehlt)
    let start = await p.starteInstallation()
    guard case .fehlgeschlagen(let text) = start else { Issue.record("erwartet .fehlgeschlagen, war \(start)"); return }
    #expect(text.contains("Vorschau"), "der Hinweis sagt, dass in der Vorschau nichts installiert wird")
    #expect(await p.pruefe() == .fehlt, "nach dem Klick ist git noch immer nicht da")
}

/// Liegt der Pfad (nach Auflösen von /var nach /private/var) im Ordner?
private func liegtUnter(_ pfad: String, _ ordner: URL) -> Bool {
    URL(fileURLWithPath: pfad).resolvingSymlinksInPath().path.hasPrefix(ordner.resolvingSymlinksInPath().path + "/")
}
