import Foundation

// Muster: Orca src/main/startup/hydrate-shell-path.ts, src/main/agent-command-detection.ts, src/main/agent-cli-version-probe.ts @9bccd67 (MIT, Lovecast Inc.)

/// Ein gefundenes KI-Programm.
public struct KiFund: Equatable, Sendable {
    public let id: String
    public let name: String
    /// "terminal" | "app" | "editor" (Art des Katalogeintrags)
    public let art: String
    /// Datei des Befehls bzw. Ordner der App (`….app`)
    public let pfad: String
    /// Versionsnummer, wenn sie sich ermitteln ließ
    public let version: String?
    /// "cli" | "app"
    public let quelle: String
    /// Name des gefundenen Befehls (nur bei `cli`)
    public let befehl: String?

    public init(id: String, name: String, art: String, pfad: String, version: String?, quelle: String, befehl: String?) {
        self.id = id; self.name = name; self.art = art; self.pfad = pfad; self.version = version; self.quelle = quelle; self.befehl = befehl
    }

    func jsonObjekt() -> [String: Any] {
        var o: [String: Any] = ["id": id, "name": name, "art": art, "pfad": pfad, "quelle": quelle]
        o["version"] = version ?? NSNull()
        o["befehl"] = befehl ?? NSNull()
        return o
    }
}

public struct KiProgrammeErgebnis: Equatable, Sendable {
    /// Nur die gefundenen, in der Reihenfolge des Katalogs.
    public let programme: [KiFund]
    public let gesucht: Date
    /// `true`, wenn der PATH aus der Login-Shell kam; `false` = Rückfall auf den PATH der App.
    public let ausShell: Bool

    public init(programme: [KiFund], gesucht: Date, ausShell: Bool) {
        self.programme = programme; self.gesucht = gesucht; self.ausShell = ausShell
    }

    func jsonObjekt() -> [String: Any] {
        ["programme": programme.map { $0.jsonObjekt() }, "gesucht": ISO8601DateFormatter().string(from: gesucht), "ausShell": ausShell]
    }

    /// `{"programme":[{"id","name","art","pfad","version"|null,"quelle","befehl"|null}],"gesucht":"<ISO8601>","ausShell":bool}`
    public func jsonDaten() -> Data {
        (try? JSONSerialization.data(withJSONObject: jsonObjekt(), options: [.sortedKeys, .withoutEscapingSlashes])) ?? Data("{}".utf8)
    }
}

/// Der PATH der Login-Shell (nur absolute Einträge, in Shell-Reihenfolge).
public struct KiLoginPfad: Equatable, Sendable {
    public let eintraege: [String]
    public let ausShell: Bool
}

/// Findet die KI-Programme des Katalogs auf diesem Rechner: PATH der Login-Shell (eine GUI-App erbt nur einen knappen PATH),
/// Ersatzordner, Apps in `/Applications`. Jeder gefundene Befehl wird mit `--version` auf Lebenszeichen geprüft; tote Shims
/// (Exit ≠ 0, Zeitlimit, nicht startbar) zählen nicht. Apps werden nie gestartet (Version aus `Info.plist`).
/// Gleichzeitige Aufrufe teilen sich einen Lauf; das Ergebnis gilt 10 Minuten (`neu: true` umgeht den Cache).
public actor KiErkennung {
    struct Konfig: Sendable {
        let katalog: KiKatalog
        let shell: String
        let home: URL
        let appOrdner: [URL]
        let ersatzOrdner: [String]
        let basisUmgebung: [String: String]
        let shellZeitlimit: Duration
        let versionZeitlimit: Duration
    }

    static let marke = "__KORTEX_PFAD__"
    /// Ausgabe der Versionsabfrage und des Anmeldestatus: nie mehr als 4 KB behalten.
    static let maxAusgabe = 4096

    private let konfig: Konfig
    private let cacheDauer: Duration
    private var cache: (ergebnis: KiProgrammeErgebnis, bis: ContinuousClock.Instant)?
    private var lauf: Task<KiProgrammeErgebnis, Never>?
    private var pfadCache: KiLoginPfad?
    private var pfadLauf: Task<KiLoginPfad, Never>?

    /// Alles injizierbar, damit Tests ohne echte Programme laufen: `shell` (Standard: `SHELL` der App, sonst `/bin/zsh`), `home`,
    /// `appOrdner` (Standard: `/Applications`, `~/Applications`), `ersatzOrdner` (Standard: Homebrew, `/usr/local/bin`,
    /// `~/.opencode/bin`, `~/.local/bin`), `basisUmgebung` und die Zeitlimits.
    public init(katalog: KiKatalog, shell: String? = nil, home: URL = FileManager.default.homeDirectoryForCurrentUser,
                appOrdner: [URL]? = nil, ersatzOrdner: [String]? = nil,
                basisUmgebung: [String: String] = ProcessInfo.processInfo.environment,
                shellZeitlimit: Duration = .seconds(10), versionZeitlimit: Duration = .seconds(5), cacheDauer: Duration = .seconds(600)) {
        let eigeneShell = shell ?? basisUmgebung["SHELL"].flatMap { $0.hasPrefix("/") ? $0 : nil } ?? "/bin/zsh"
        let apps = appOrdner ?? [URL(fileURLWithPath: "/Applications", isDirectory: true),
                                 home.appendingPathComponent("Applications", isDirectory: true)]
        let ersatz = ersatzOrdner ?? ["/opt/homebrew/bin", "/usr/local/bin", home.path + "/.opencode/bin", home.path + "/.local/bin"]
        self.konfig = Konfig(katalog: katalog, shell: eigeneShell, home: home, appOrdner: apps, ersatzOrdner: ersatz,
                             basisUmgebung: basisUmgebung, shellZeitlimit: shellZeitlimit, versionZeitlimit: versionZeitlimit)
        self.cacheDauer = cacheDauer
    }

    // MARK: Umgebung der Kindprozesse

    /// Diese Variablen lenken KI-Programme auf andere Konten/Ordner oder tragen Schlüssel: Sie kommen nie aus der Umgebung der App
    /// in ein Kind (ein Konto-Ordner wird nur gezielt über `zusatz` gesetzt).
    static let gesperrteVariablen: [String] = [
        "CLAUDE_CONFIG_DIR", "CODEX_HOME", "XDG_CONFIG_HOME", "GIT_CONFIG_GLOBAL", "CURSOR_CONFIG_DIR", "GEMINI_CLI_HOME",
        "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "OPENAI_API_KEY", "CODEX_API_KEY",
    ]

    /// Bereinigte Umgebung: `NodeUmgebung.bereinigt` (ohne Testschalter), dazu die gesperrten KI-Variablen raus; danach `zusatz`.
    public static func kindUmgebung(basis: [String: String] = ProcessInfo.processInfo.environment,
                                    zusatz: [String: String] = [:]) -> [String: String] {
        var env = NodeUmgebung.bereinigt(basis, testmodusWeitergeben: false)
        for name in gesperrteVariablen { env.removeValue(forKey: name) }
        for (k, v) in zusatz { env[k] = v }
        return env
    }

    // MARK: Öffentliche Abfragen

    public func programme(neu: Bool = false) async -> KiProgrammeErgebnis {
        if !neu, let c = cache, ContinuousClock.now < c.bis { return c.ergebnis }
        if let l = lauf { return await l.value }
        let t = Task { await self.suchlauf(neu: neu) }
        lauf = t
        return await t.value
    }

    private func suchlauf(neu: Bool) async -> KiProgrammeErgebnis {
        let pfad = await loginPfad(neu: neu)
        let ergebnis = await Self.suche(konfig, pfad: pfad)
        cache = (ergebnis, ContinuousClock.now + cacheDauer)
        lauf = nil
        return ergebnis
    }

    /// PATH der Login-Shell (`$SHELL -ilc`), pro Instanz zwischengespeichert; ein fehlgeschlagener Lauf wird nicht gemerkt.
    public func loginPfad(neu: Bool = false) async -> KiLoginPfad {
        if !neu, let c = pfadCache { return c }
        if let l = pfadLauf { return await l.value }
        let k = konfig
        let t = Task { await Self.leseShell(k) }
        pfadLauf = t
        let r = await t.value
        pfadLauf = nil
        if r.ausShell { pfadCache = r }
        return r
    }

    // MARK: Login-Shell

    static func leseShell(_ k: Konfig) async -> KiLoginPfad {
        let skript = "printf '%s' \"\(marke)\"\"$PATH\"\"\(marke)\""
        let r = await KiProzess.laufe(programm: k.shell, argumente: ["-ilc", skript], umgebung: kindUmgebung(basis: k.basisUmgebung),
                                      zeitlimit: k.shellZeitlimit, maxByte: 256 * 1024, stderrEinmischen: false)
        if case .beendet(_, let daten) = r, let pfad = pfadAusAusgabe(String(decoding: daten, as: UTF8.self)) {
            return KiLoginPfad(eintraege: pfad, ausShell: true)
        }
        return KiLoginPfad(eintraege: absoluteEintraege(k.basisUmgebung["PATH"] ?? ""), ausShell: false)
    }

    /// Der PATH zwischen den zwei Marken; Ausgaben der Shell-Startdateien davor/danach zählen nicht. `nil`, wenn die Marken fehlen
    /// oder kein absoluter Eintrag übrig bleibt.
    static func pfadAusAusgabe(_ text: String) -> [String]? {
        guard let a = text.range(of: marke), let b = text.range(of: marke, range: a.upperBound..<text.endIndex) else { return nil }
        let eintraege = absoluteEintraege(String(text[a.upperBound..<b.lowerBound]))
        return eintraege.isEmpty ? nil : eintraege
    }

    /// Nur absolute Einträge, ohne Doppelte, in der Reihenfolge des PATH.
    static func absoluteEintraege(_ pfad: String) -> [String] {
        var gesehen = Set<String>()
        return pfad.split(separator: ":", omittingEmptySubsequences: true).map(String.init)
            .filter { $0.hasPrefix("/") && gesehen.insert($0).inserted }
    }

    // MARK: Suche

    static func suche(_ k: Konfig, pfad: KiLoginPfad) async -> KiProgrammeErgebnis {
        var ordner = pfad.eintraege
        for e in k.ersatzOrdner where !ordner.contains(e) { ordner.append(e) }
        var funde: [KiFund] = []
        for eintrag in k.katalog.eintraege {
            if let f = findeApp(eintrag, k) {
                funde.append(f)
            } else if let f = await findeBefehl(eintrag, ordner: ordner, k) {
                funde.append(f)
            }
        }
        return KiProgrammeErgebnis(programme: funde, gesucht: Date(), ausShell: pfad.ausShell)
    }

    private static func findeApp(_ e: KiKatalogEintrag, _ k: Konfig) -> KiFund? {
        for app in e.apps where !app.contains("/") {
            for wurzel in k.appOrdner {
                let url = wurzel.appendingPathComponent(app, isDirectory: true)
                var istOrdner: ObjCBool = false
                guard FileManager.default.fileExists(atPath: url.path, isDirectory: &istOrdner), istOrdner.boolValue else { continue }
                return KiFund(id: e.id, name: e.name, art: e.art.rawValue, pfad: url.path, version: appVersion(url), quelle: "app", befehl: nil)
            }
        }
        return nil
    }

    private static func findeBefehl(_ e: KiKatalogEintrag, ordner: [String], _ k: Konfig) async -> KiFund? {
        let suchPfad = ordner.joined(separator: ":")
        for befehl in e.befehle where !befehl.contains("/") {
            for o in ordner {
                let datei = o + "/" + befehl
                guard istAusfuehrbareDatei(datei) else { continue }
                // Den Ordner des Programms nach vorn: Node-Skripte (`#!/usr/bin/env node`) finden ihr `node` daneben.
                let env = kindUmgebung(basis: k.basisUmgebung, zusatz: ["PATH": o + ":" + suchPfad])
                let r = await KiProzess.laufe(programm: datei, argumente: ["--version"], umgebung: env, zeitlimit: k.versionZeitlimit,
                                              maxByte: maxAusgabe, stderrEinmischen: true)
                guard case .beendet(0, let daten) = r else { continue } // toter Shim: nächster Ordner/Befehl
                return KiFund(id: e.id, name: e.name, art: e.art.rawValue, pfad: datei,
                              version: version(aus: String(decoding: daten, as: UTF8.self)), quelle: "cli", befehl: befehl)
            }
        }
        return nil
    }

    /// Reguläre, ausführbare Datei; Symlinks auf solche Dateien zählen (stat folgt dem Link).
    static func istAusfuehrbareDatei(_ pfad: String) -> Bool {
        var st = stat()
        guard stat(pfad, &st) == 0, (st.st_mode & S_IFMT) == S_IFREG else { return false }
        return access(pfad, X_OK) == 0
    }

    // MARK: Version

    private static let versionsMuster = try? NSRegularExpression(pattern: #"\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.+\-]*)?"#)

    /// Erste Zahl-Folge der ersten nicht leeren Zeile, sonst diese Zeile auf 60 Zeichen gekürzt; `nil` bei leerer Ausgabe.
    static func version(aus ausgabe: String) -> String? {
        guard let zeile = ausgabe.split(whereSeparator: \.isNewline).map({ $0.trimmingCharacters(in: .whitespaces) }).first(where: { !$0.isEmpty })
        else { return nil }
        if let re = versionsMuster, let m = re.firstMatch(in: zeile, range: NSRange(zeile.startIndex..., in: zeile)),
           let r = Range(m.range, in: zeile) {
            return String(zeile[r])
        }
        return String(zeile.prefix(60))
    }

    /// `CFBundleShortVersionString` aus `Contents/Info.plist`; die App wird nicht gestartet.
    static func appVersion(_ app: URL) -> String? {
        let plist = app.appendingPathComponent("Contents/Info.plist")
        guard let daten = try? Data(contentsOf: plist),
              let obj = try? PropertyListSerialization.propertyList(from: daten, options: [], format: nil) as? [String: Any],
              let v = obj["CFBundleShortVersionString"] as? String else { return nil }
        let s = v.trimmingCharacters(in: .whitespacesAndNewlines)
        return s.isEmpty ? nil : String(s.prefix(60))
    }
}
