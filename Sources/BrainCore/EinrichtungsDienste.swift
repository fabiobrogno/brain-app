import Foundation

// Alles, was der Assistent „Kortex einrichten“ von außen braucht, hinter einem Protokoll: der Ablauf (`EinrichtungsAblauf`) bleibt
// dadurch ohne Prozesse und Netz testbar. Die echte Umsetzung (`WerkstattDienste`) spricht mit der Werkstatt, dem Node-Teil, der
// auch das Studio bedient — dieselben Routen, dieselben Prüfungen, dieselbe Vault-Liste.

/// Ein Fehler, den der Nutzer lesen darf (deutscher Klartext). `art`/`befehl` stammen aus den Fehlerantworten der Werkstatt.
public struct EinrichtungsFehler: Error, Equatable, Sendable {
    public let meldung: String
    /// HTTP-Status der Werkstatt, nil bei Fehlern, die gar nicht erst dort ankamen.
    public let status: Int?
    /// z. B. `anders` (die KI-App hat schon einen anderen Eintrag „brain“).
    public let art: String?
    /// Ein Befehl zum Kopieren, falls der Weg über die App nicht klappt.
    public let befehl: String?

    public init(_ meldung: String, status: Int? = nil, art: String? = nil, befehl: String? = nil) {
        self.meldung = meldung
        self.status = status
        self.art = art
        self.befehl = befehl
    }

    /// Die KI-App hat unter dem Namen „brain“ schon einen anderen Server eingetragen — Umstellen braucht ein Ja des Nutzers.
    public var istAndererEintrag: Bool { status == 409 && art == "anders" }
}

public struct VaultInfo: Equatable, Sendable {
    public let name: String
    public let pfad: String
    /// Ist der Ordner ein Git-Repository (Versionsverlauf an)?
    public let git: Bool

    public init(name: String, pfad: String, git: Bool) {
        self.name = name
        self.pfad = pfad
        self.git = git
    }
}

public enum NeuerVaultArt: String, Sendable {
    /// Brain-Vorlage: Inbox, Wiki, Schema, AGENTS.md, CLAUDE.md, Beispielseiten.
    case vorlage
    /// Leerer Ordner mit Versionsverlauf.
    case leer
}

public struct GitHubKonto: Equatable, Sendable {
    /// Ist die Anmeldung in dieser Version eingerichtet (Client-ID in der Info.plist)? Sonst ist der Schritt unsichtbar.
    public let verfuegbar: Bool
    public let angemeldet: Bool
    public let login: String?

    public init(verfuegbar: Bool, angemeldet: Bool, login: String? = nil) {
        self.verfuegbar = verfuegbar
        self.angemeldet = angemeldet
        self.login = login
    }
}

public struct GitHubGeraetecode: Equatable, Sendable {
    public let code: String
    public let url: String
    public let ablauf: String?

    public init(code: String, url: String, ablauf: String? = nil) {
        self.code = code
        self.url = url
        self.ablauf = ablauf
    }
}

/// Stand der laufenden Anmeldung bei GitHub (nie mit Token — die Werkstatt hat keins in ihren Antworten).
public enum GitHubAnmeldung: Equatable, Sendable {
    case keine
    case wartet(GitHubGeraetecode)
    case fertig(login: String?)
    case abgelaufen
    case abgelehnt(grund: String?)
}

/// Eine auf dem Mac gesuchte KI-App (`GET /api/ki/erkennen`).
public struct KiProgramm: Equatable, Sendable {
    public let id: String
    public let name: String
    public let version: String?
    public let gefunden: Bool

    public init(id: String, name: String, version: String? = nil, gefunden: Bool) {
        self.id = id
        self.name = name
        self.version = version
        self.gefunden = gefunden
    }
}

/// KI-Apps, mit denen sich der Assistent verbinden kann. Hier steht die ganze Liste: wer eine weitere KI-App anbinden will,
/// ergänzt einen Fall (`ziel` = Wert für `POST /api/mcp/verbinden`, in der Werkstatt `Ressourcen/werkstatt/ki-programme/programme.mjs`),
/// trägt Namen, Dateiort und Logo ein und nimmt ihn in `verbindbar` auf. `KiZielTests` vergleicht die Liste mit der Werkstatt.
///
/// Claude Code und Codex trägt Kortex über deren Befehl ein, Cursor und die weiteren Programme (`dateiOrt != nil`) über ihre
/// Einstellungsdatei: additiv, mit Sicherung, atomar, eine kaputte Datei bleibt unberührt.
public enum KiZiel: String, CaseIterable, Sendable {
    case claude, codex, cursor
    case claudeDesktop, gemini, copilot, zed, opencode, warp

    /// Welche Ziele die Werkstatt in dieser Version verbinden kann (`/api/mcp/verbinden`).
    public static let verbindbar: [KiZiel] = [.claude, .codex, .cursor, .claudeDesktop, .gemini, .copilot, .zed, .opencode, .warp]

    /// Name in `KiProgramm.id`. Cursor hat keine eigene Programmdatei in der Liste der Werkstatt (`cursor-agent` ist nur eine
    /// von mehreren Spuren; die App oder `~/.cursor` zählen auch): `WerkstattDienste` bildet daraus den Eintrag „cursor“.
    /// Die weiteren Programme meldet die Werkstatt in `programme` unter genau ihrem `ziel`.
    public var agentId: String { ziel }

    /// Wert des Felds `ziel` bei `POST /api/mcp/verbinden`.
    public var ziel: String {
        switch self {
        case .claude: return "claude"
        case .codex: return "codex"
        case .cursor: return "cursor"
        case .claudeDesktop: return "claude-desktop"
        case .gemini: return "gemini"
        case .copilot: return "copilot"
        case .zed: return "zed"
        case .opencode: return "opencode"
        case .warp: return "warp"
        }
    }

    public var name: String {
        switch self {
        case .claude: return "Claude Code"
        case .codex: return "Codex"
        case .cursor: return "Cursor"
        case .claudeDesktop: return "Claude Desktop"
        case .gemini: return "Gemini CLI"
        case .copilot: return "GitHub Copilot"
        case .zed: return "Zed"
        case .opencode: return "OpenCode"
        case .warp: return "Warp"
        }
    }

    /// Die Einstellungsdatei, in die Kortex sich einträgt (für Menschen, mit „~“); `nil` bei Programmen, die über ihren Befehl eingerichtet werden.
    public var dateiOrt: String? {
        switch self {
        case .claude, .codex: return nil
        case .cursor: return "~/.cursor/mcp.json"
        case .claudeDesktop: return "~/Library/Application Support/Claude/claude_desktop_config.json"
        case .gemini: return "~/.gemini/settings.json"
        case .copilot: return "~/.copilot/mcp-config.json"
        case .zed: return "~/.config/zed/settings.json"
        case .opencode: return "~/.config/opencode/opencode.json"
        case .warp: return "~/.warp/.mcp.json"
        }
    }

    /// Satz über dem Text zum Kopieren, falls das Verbinden nicht klappt: Claude und Codex bekommen einen Terminal-Befehl,
    /// die anderen den Eintrag für ihre Einstellungsdatei.
    public var kopierHinweis: String {
        if let ort = dateiOrt { return "Oder füge diesen Eintrag in \(ort) ein:" }
        return "Oder führe diesen Befehl im Terminal aus:"
    }
}

public enum KiVerbindung: Equatable, Sendable {
    case verbunden
    case schonVerbunden
}

/// Ergebnis von „Trennen“: Kortex hat seinen Eintrag herausgenommen, oder es gab keinen (dann ist nichts zu tun).
public enum KiTrennung: Equatable, Sendable {
    case getrennt
    case warNichtVerbunden
}

/// Wo sich Kortex zusätzlich einträgt (Kern-Umzug P6). Alles läuft über den Starter der App und zeigt nur auf feste Pfade
/// (`bin/kortex`, `bin/kern`) — nach einem App-Update bleibt es gültig. Jeder Eintrag lässt sich wieder herausnehmen.
public enum Verdrahtung: String, CaseIterable, Sendable {
    /// Hooks, Statuszeile und Brain-Befehle in Claude Code (`~/.claude/settings.json`, `~/.claude/commands`).
    case claude
    /// Prüfung auf Passwörter und Schlüssel vor jedem Commit im Vault (`core.hooksPath`).
    case git
    /// Hintergrunddienst (LaunchAgent) für den täglichen Tageslauf.
    case dienst
}

/// Ein Claude-Code-Profil auf diesem Mac: der Ordner `~/.claude` oder `~/.claude-*` im Home (wer mit `CLAUDE_CONFIG_DIR` mehrere Profile nutzt).
/// Die App startet aus dem Finder ohne diese Umgebung und sucht die Profile deshalb selbst.
public struct ClaudeProfil: Equatable, Sendable {
    public let pfad: String
    /// Ordnername, z. B. `.claude-privat`.
    public let name: String
    /// `~/.claude`: das Standardprofil (Konfiguration in `~/.claude.json`, ohne `CLAUDE_CONFIG_DIR`).
    public let standard: Bool
    /// Hooks und Statuszeile von Kortex sind in diesem Profil eingetragen.
    public var aktiv: Bool

    public init(pfad: String, name: String, standard: Bool, aktiv: Bool = false) {
        self.pfad = pfad
        self.name = name
        self.standard = standard
        self.aktiv = aktiv
    }

    /// Anzeigename: `~/.claude-privat`.
    public var anzeigeName: String { "~/\(name)" }
}

/// Was von der Verdrahtung gerade eingetragen ist (`GET /api/kern/stand`).
public struct VerdrahtungsStand: Equatable, Sendable {
    /// Der Starter `bin/kortex` ist da; ohne ihn lässt sich nichts eintragen.
    public var starterVorhanden: Bool
    /// Die gefundenen Claude-Profile (Standardprofil zuerst) mit ihrem Stand; leer, wenn es keine gibt.
    public var profile: [ClaudeProfil]
    /// Der Vault hat einen Versionsverlauf, die Prüfung vor dem Speichern ist also möglich.
    public var gitMoeglich: Bool
    public var gitAktiv: Bool
    /// Im Vault ist schon ein anderer Hook-Ordner eingetragen (wird nur mit ausdrücklichem Ja ersetzt).
    public var gitFremderEintrag: Bool
    public var dienstVerfuegbar: Bool
    public var dienstAktiv: Bool

    public init(starterVorhanden: Bool = false, profile: [ClaudeProfil] = [], gitMoeglich: Bool = false, gitAktiv: Bool = false,
                gitFremderEintrag: Bool = false, dienstVerfuegbar: Bool = false, dienstAktiv: Bool = false) {
        self.starterVorhanden = starterVorhanden
        self.profile = profile
        self.gitMoeglich = gitMoeglich
        self.gitAktiv = gitAktiv
        self.gitFremderEintrag = gitFremderEintrag
        self.dienstVerfuegbar = dienstVerfuegbar
        self.dienstAktiv = dienstAktiv
    }

    /// Sind Hooks und Statuszeile in ALLEN genannten Profilen eingetragen? (Leere Auswahl: nein.)
    public func claudeAktiv(in gewaehlt: [String]) -> Bool {
        !gewaehlt.isEmpty && gewaehlt.allSatisfy { pfad in profile.first { $0.pfad == pfad }?.aktiv == true }
    }

    public func aktiv(_ was: Verdrahtung) -> Bool {
        switch was {
        case .claude: return !profile.isEmpty && profile.allSatisfy(\.aktiv)
        case .git: return gitAktiv
        case .dienst: return dienstAktiv
        }
    }
}

public struct ProbeErgebnis: Equatable, Sendable {
    public let frage: String
    /// Titel (sonst Pfade) der gefundenen Seiten.
    public let treffer: [String]

    public init(frage: String, treffer: [String]) {
        self.frage = frage
        self.treffer = treffer
    }
}

public protocol EinrichtungsDienste: Sendable {
    // git
    func gitStand() async -> GitStand
    func gitInstallationStarten() async -> GitInstallationStart
    func gitWarten() async -> GitStand

    // Vault
    /// Der aktive Vault laut `vaults.json` (Ordner muss existieren), sonst nil.
    func aktiverVault() async -> VaultInfo?
    func legeVaultAn(art: NeuerVaultArt, name: String?, ordner: String?) async throws -> VaultInfo
    func oeffneOrdner(pfad: String, versionsverlaufEinschalten: Bool) async throws -> VaultInfo
    func klone(url: String, ordner: String?, name: String?) async throws -> VaultInfo

    // GitHub (Gerätecode; das Token bleibt im Schlüsselbund)
    func githubKonto() async throws -> GitHubKonto
    func githubAnmelden() async throws -> GitHubGeraetecode
    func githubStatus() async throws -> GitHubAnmeldung
    func githubAbbrechen() async throws

    // Sicherung (privates GitHub-Repository; das Token bleibt in der Werkstatt und im Schlüsselbund)
    /// Vorprüfung VOR dem Anlegen eines Repositories: gesichert (Remote und Upstream), bereit oder blockiert (mit Erklärung).
    /// Ein Fehler beim Lesen des Stands gilt als blockiert, nie als „kein Remote“.
    func sicherungVorpruefung() async -> SicherungVorpruefung
    /// Die eigenen PRIVATEN Repositories des angemeldeten Kontos.
    func githubRepos() async throws -> GitHubRepoListe
    /// Legt ein neues Repository an — immer privat (die Werkstatt erzwingt es).
    func githubRepoAnlegen(name: String) async throws -> GitHubRepo
    /// Verbindet mit dem privaten Repository `besitzer/name`: die Werkstatt prüft noch einmal, dass es privat ist, baut die Adresse selbst,
    /// vergleicht die Historien, sendet (nie mit Gewalt) und setzt erst danach `origin` und den Upstream.
    func verbindeSicherung(besitzer: String, name: String) async throws -> SicherungErgebnis

    // KI
    func erkenneKIs() async throws -> [KiProgramm]
    /// `profil`: nur bei Claude Code — der Pfad eines gefundenen Profils (`VerdrahtungsStand.profile`); nil = Standard wie bisher.
    func verbinde(_ ziel: KiZiel, umstellen: Bool, profil: String?) async throws -> KiVerbindung

    /// Rückweg von `verbinde`: nimmt NUR den Eintrag „brain“ heraus, und nur, wenn er von Kortex stammt. Ein fremder Eintrag bleibt
    /// stehen (Fehler mit `art == "anders"`). Hooks und Statuszeile sind ein eigener Schalter (`verdrahte`).
    func trenne(_ ziel: KiZiel, profil: String?) async throws -> KiTrennung
    /// Konfiguration (JSON) zum Einfügen in ein KI-Programm. Ohne `ziel` im üblichen Format (Feld `mcpServers`), mit `ziel` genau so,
    /// wie dieses Programm den Eintrag in seiner Einstellungsdatei erwartet (`KiZiel.dateiOrt`). Liest nur.
    func konfiguration(fuer ziel: KiZiel?) async throws -> String

    // Verdrahtung (Hooks bei Claude Code, Prüfung vor dem Speichern, Hintergrunddienst)
    /// Was eingetragen ist. Liest nur.
    func verdrahtungsStand() async throws -> VerdrahtungsStand
    /// Trägt ein (`an`) bzw. nimmt heraus und liefert den neuen Stand. `ersetzen`: einen fremden Hook-Ordner im Vault ersetzen.
    /// `profile`: die gewählten Claude-Profile (Pfade); für `.claude` Pflicht, für `.dienst` zählt das erste (das der Dienst für `claude` nutzt).
    func verdrahte(_ was: Verdrahtung, an: Bool, ersetzen: Bool, profile: [String]) async throws -> VerdrahtungsStand

    // Probe
    func probe(frage: String) async throws -> ProbeErgebnis
}
