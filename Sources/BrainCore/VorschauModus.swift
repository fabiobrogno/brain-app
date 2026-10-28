import Foundation

/// „Vorschau wie frisch installiert“ (`scripts/vorschau.sh`, Schalter `--vorschau <Ordner>`): Die App zeigt sich so, wie sie jemand
/// sieht, der sie gerade installiert hat — und fasst dabei nichts an, was dem echten Nutzer gehört.
///
/// Alles, was die App und ihre Kindprozesse (Node, git, claude …) sonst im Benutzerordner lesen oder schreiben, liegt stattdessen im
/// Vorschau-Ordner:
///
///     <ordner>/support   Application-Support-Ordner der App (`AppPfade`)
///     <ordner>/home      HOME aller Kindprozesse (`.gitconfig`, `.claude.json`, `.config`, Vaults, Zugangsdatei …)
///     <ordner>/bin       PATH der Kindprozesse; mit `--mit-ki` die Platzhalter für claude, codex und cursor-agent
///     <ordner>/tmp       TMPDIR der Kindprozesse
///
/// Die Werte stehen an EINER Stelle (`kindVorgaben`) und gehen als „Vorgaben“ durch `NodeUmgebung.fuerKind` an jeden Node-Kindprozess.
/// Dort gilt: kein `/opt/homebrew/bin`, kein `/usr/local/bin` im PATH (sonst fände die Vorschau das echte claude des Rechners).
/// Die Node-Seite erkennt die Vorschau an `KORTEX_VORSCHAU` und hält sich selbst daran (`gemeinsam/basis.mjs`): Zugangsdaten nur in
/// eine Datei im Vorschau-Ordner statt in den Schlüsselbund, Vaults nur innerhalb des Ordners, KI-Suche nur im Vorschau-Home.
public struct VorschauModus: Equatable, Sendable {
    /// Bundle-ID der echten App. In der Vorschau läuft die App unter einer eigenen (`+ bundleSuffix`): UserDefaults, WebKit-Daten,
    /// gemerkter Fensterzustand und Caches des Systems liegen dann unter einem anderen Namen und werden am Ende gelöscht.
    public static let echteBundleID = "io.github.fbrogno.brain"
    public static let bundleSuffix = ".vorschau"
    public static var vorschauBundleID: String { echteBundleID + bundleSuffix }

    public let ordner: URL
    public let mitKi: Bool
    public let ohneGit: Bool

    public init(ordner: URL, mitKi: Bool = false, ohneGit: Bool = false) {
        self.ordner = ordner
        self.mitKi = mitKi
        self.ohneGit = ohneGit
    }

    public var home: URL { ordner.appendingPathComponent("home", isDirectory: true) }
    public var support: URL { ordner.appendingPathComponent("support", isDirectory: true) }
    public var bin: URL { ordner.appendingPathComponent("bin", isDirectory: true) }
    public var tmp: URL { ordner.appendingPathComponent("tmp", isDirectory: true) }
    public var pfade: AppPfade { AppPfade(basis: support) }

    // MARK: Ordner prüfen

    public enum OrdnerFehler: Error, Equatable, Sendable {
        case nichtAbsolut, zuFlach, ungueltigeZeichen, keinOrdner, enthaeltEchtesHome, keineMarke

        public var beschreibung: String {
            switch self {
            case .nichtAbsolut: return "--vorschau braucht einen absoluten Pfad."
            case .zuFlach: return "--vorschau: Dieser Ordner ist zu hoch oben im Dateisystem."
            case .ungueltigeZeichen: return "--vorschau: Der Pfad darf nur Buchstaben, Ziffern und . _ - + @ = , / enthalten (keine Leerzeichen)."
            case .keinOrdner: return "--vorschau: Den Ordner gibt es nicht. scripts/vorschau.sh legt ihn an."
            case .enthaeltEchtesHome: return "--vorschau: Das ist (oder enthält) der echte Benutzerordner."
            case .keineMarke: return "--vorschau: Das ist kein Vorschau-Ordner (die Marke \(VorschauModus.markeName) fehlt). scripts/vorschau.sh legt ihn an."
            }
        }
    }

    /// Zeichen, die in Pfaden vorkommen dürfen, die in Git-Konfiguration und ssh-Befehle wandern (kein Leerzeichen, kein Anführungszeichen).
    static let erlaubteZeichen = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-+@=,/")

    /// Datei, mit der `scripts/vorschau.sh` einen Vorschau-Ordner kennzeichnet. Ohne sie legt die App nichts an: `--vorschau ~/brain`
    /// würde sonst in einem echten Ordner `home`, `support` und `bin` erzeugen.
    public static let markeName = ".kortex-vorschau"

    /// Der echte Benutzerordner laut Benutzerdatenbank — nie vom Umgebungs-HOME abgeleitet, das die Vorschau ja umlenkt.
    public static func echtesHome() -> String {
        if let pw = getpwuid(getuid()), let dir = pw.pointee.pw_dir { return String(cString: dir) }
        return NSHomeDirectoryForUser(NSUserName()) ?? "/Users/\(NSUserName())"
    }

    /// Absolut, mindestens zwei Ebenen tief, nur unbedenkliche Zeichen, existierender Ordner mit der Marke `.kortex-vorschau`, nicht der
    /// echte Benutzerordner und keiner seiner Vorfahren. Das Ergebnis ist standardisiert (ohne `..`, ohne Schrägstrich am Ende), Verweise werden NICHT aufgelöst:
    /// derselbe Text steht danach in HOME und CFFIXED_USER_HOME.
    public static func pruefeOrdner(_ text: String, echtesHome: String = VorschauModus.echtesHome()) -> Result<URL, OrdnerFehler> {
        guard text.hasPrefix("/") else { return .failure(.nichtAbsolut) }
        guard text.unicodeScalars.allSatisfy({ erlaubteZeichen.contains($0) }) else { return .failure(.ungueltigeZeichen) }
        let url = URL(fileURLWithPath: text, isDirectory: true).standardizedFileURL
        let teile = url.pathComponents.filter { $0 != "/" }
        guard teile.count >= 2 else { return .failure(.zuFlach) }
        var istOrdner: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &istOrdner), istOrdner.boolValue else { return .failure(.keinOrdner) }
        let echt = URL(fileURLWithPath: echtesHome).standardizedFileURL.path
        let echtResolved = URL(fileURLWithPath: echtesHome).resolvingSymlinksInPath().path
        for kandidat in [url.path, url.resolvingSymlinksInPath().path] {
            for h in [echt, echtResolved] where h == kandidat || h.hasPrefix(kandidat + "/") { return .failure(.enthaeltEchtesHome) }
        }
        guard FileManager.default.fileExists(atPath: url.appendingPathComponent(markeName).path) else { return .failure(.keineMarke) }
        return .success(url)
    }

    // MARK: Umgebung der Kindprozesse

    /// ssh ohne Konfiguration, Schlüssel und Agent des Nutzers; bekannte Server in einer Datei im Vorschau-Home. (OpenSSH fragt die
    /// Benutzerdatenbank nach dem Benutzerordner, nicht HOME — ohne diese Optionen läse und schriebe ssh `~/.ssh` des echten Nutzers.)
    var sshBefehl: String {
        "ssh -F /dev/null -o BatchMode=yes -o IdentityFile=/dev/null -o IdentityAgent=none -o IdentitiesOnly=yes "
            + "-o UserKnownHostsFile=\(home.path)/.ssh/known_hosts -o GlobalKnownHostsFile=/dev/null"
    }

    /// Die globale Git-Konfiguration der Vorschau (`GIT_CONFIG_GLOBAL`). Wegen `GIT_CONFIG_NOSYSTEM` gäbe es sonst keinen Credential-Helper,
    /// und das Klonen privater Repositories mit dem in der Vorschau gespeicherten GitHub-Token scheiterte.
    var gitKonfiguration: String {
        "[credential]\n\thelper = store --file=\(zugangsdatei.path)\n"
    }

    /// Pfad der Zugangsdatei, in die `git credential-store` das GitHub-Token der Vorschau schreibt (statt in den Schlüsselbund).
    public var zugangsdatei: URL { home.appendingPathComponent(".git-credentials") }

    /// Alles, was Kindprozesse im Vorschau-Modus bekommen — gilt über `NodeUmgebung.fuerKind` nach der Bereinigung der geerbten Werte.
    public var kindVorgaben: [String: String] {
        let h = home.path
        return [
            "KORTEX_VORSCHAU": ordner.path,
            "BRAIN_APP_SUPPORT": support.path,
            "HOME": h,
            "CFFIXED_USER_HOME": h,
            "TMPDIR": tmp.path + "/",
            "XDG_CONFIG_HOME": h + "/.config",
            "XDG_CACHE_HOME": h + "/.cache",
            "XDG_DATA_HOME": h + "/.local/share",
            "XDG_STATE_HOME": h + "/.local/state",
            "CODEX_HOME": h + "/.codex",
            "GIT_CONFIG_GLOBAL": h + "/.gitconfig",
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_SSH_COMMAND": sshBefehl,
            "PATH": ([bin.path] + BrainBefehl.systemOrdner).joined(separator: ":"),
        ]
    }

    /// Die Vorgaben, die zusätzlich in den Prozess der App selbst gesetzt werden (Kinder mit `environment == nil` erben sie, z. B. `git --version`).
    public func inProzessSetzen() {
        for (k, v) in kindVorgaben { setenv(k, v, 1) }
    }

    // MARK: Schutz

    /// Gründe, warum die App so NICHT starten darf (leer = in Ordnung). Rein berechnet, damit Tests alle Fälle prüfen können.
    /// - `nsHome`: was `NSHomeDirectory()` im laufenden Prozess ergibt (folgt `CFFIXED_USER_HOME`).
    /// - `bundleID`: Kennung der laufenden App (nil bei `swift run` ohne Info.plist: eigener UserDefaults-Bereich, nicht der echte).
    public func schutzFehler(umgebung: [String: String], nsHome: String, bundleID: String?) -> [String] {
        var f: [String] = []
        let h = home.path
        if umgebung["HOME"] != h { f.append("HOME zeigt nicht auf den Vorschau-Ordner") }
        if umgebung["CFFIXED_USER_HOME"] != h { f.append("CFFIXED_USER_HOME zeigt nicht auf den Vorschau-Ordner") }
        if nsHome != h { f.append("Der Benutzerordner des Prozesses ist nicht der Vorschau-Ordner") }
        if let id = bundleID, !id.hasSuffix(Self.bundleSuffix) {
            f.append("Die App läuft unter der echten Kennung \(id); die Vorschau braucht ihre eigene (\(Self.vorschauBundleID))")
        }
        return f
    }

    /// Prüft den laufenden Prozess (Umgebung, `NSHomeDirectory()`, Bundle-ID).
    public func schutzFehlerImProzess() -> [String] {
        schutzFehler(umgebung: ProcessInfo.processInfo.environment, nsHome: NSHomeDirectory(), bundleID: Bundle.main.bundleIdentifier)
    }

    // MARK: Vorbereiten

    /// Legt die Ordner an (und mit `--mit-ki` Platzhalter für Claude Code, Codex und Cursor). Ändert nur Dinge unter `ordner`.
    public func vorbereiten() throws {
        let fm = FileManager.default
        var ordnerListe = [support, home, bin, tmp]
        for sub in [".config", ".cache", ".local/share", ".local/state", ".ssh"] { ordnerListe.append(home.appendingPathComponent(sub, isDirectory: true)) }
        for o in ordnerListe { try fm.createDirectory(at: o, withIntermediateDirectories: true) }
        try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: home.appendingPathComponent(".ssh").path)
        try pfade.legeAn()
        try gitKonfiguration.write(to: home.appendingPathComponent(".gitconfig"), atomically: true, encoding: .utf8)
        if mitKi {
            for d in [".claude", ".codex", ".cursor"] {
                try fm.createDirectory(at: home.appendingPathComponent(d, isDirectory: true), withIntermediateDirectories: true)
            }
            for p in VorschauPlatzhalter.programme {
                let url = bin.appendingPathComponent(p.name)
                try p.skript.write(to: url, atomically: true, encoding: .utf8)
                try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
            }
        }
    }

    // MARK: git

    /// Der Git-Prüfer der Vorschau. Normal: der echte (rein lesend, wie sonst). `--ohne-git`: Es gibt weder Entwicklerwerkzeuge noch einen
    /// Installer — und `xcode-select --install` wird nie ausgeführt, die Anfrage dazu endet in einem Hinweis.
    public func gitPruefer() -> GitPruefer {
        guard ohneGit else { return GitPruefer() }
        return GitPruefer(starte: { programm, argumente in
            if programm.lastPathComponent == "xcode-select", argumente == ["-p"] {
                return BefehlErgebnis(code: 2, ausgabe: "", fehler: "xcode-select: error: unable to get active developer directory")
            }
            if programm.lastPathComponent == "pgrep" { return BefehlErgebnis(code: 1, ausgabe: "", fehler: "") }
            return BefehlErgebnis(code: 1, ausgabe: "", fehler: "In der Vorschau wird nichts installiert. Wer Kortex neu installiert, sieht hier Apples Installationsdialog.")
        })
    }

    // MARK: Aufräumen

    /// Entfernt die Einstellungen der Vorschau-App beim Beenden — und nur die: die echte Kennung wird nie angefasst.
    public func raeumeDefaultsAuf(bundleID: String? = Bundle.main.bundleIdentifier) {
        guard let id = bundleID, Self.darfDefaultsLoeschen(bundleID: id) else { return }
        UserDefaults.standard.removePersistentDomain(forName: id)
    }

    /// Nur die Einstellungen einer Vorschau-Kennung (…vorschau) dürfen gelöscht werden — nie die der echten App.
    public static func darfDefaultsLoeschen(bundleID: String) -> Bool {
        bundleID.hasSuffix(bundleSuffix) && bundleID != echteBundleID && bundleID.count > bundleSuffix.count
    }
}
