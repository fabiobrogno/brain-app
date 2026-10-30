import Foundation

/// Eine Anfrage an die Werkstatt (Methode, Pfad mit Query, Körper) — in der App ist das `BrueckenVerbindung.anfrage`.
public typealias WerkstattAnfrage = @Sendable (_ methode: String, _ pfad: String, _ body: Data?) async throws -> BrueckenAntwort

/// Die echte Umsetzung von `EinrichtungsDienste`: git über `GitPruefer`, den aktiven Vault aus `vaults.json`, alles andere über die
/// Routen der Werkstatt (dieselben wie im Studio: `/api/vaults/…`, `/api/github/…`, `/api/ki/erkennen`, `/api/mcp/verbinden`,
/// `/api/probe`). Die App führt weder Git-Befehle noch Anmeldungen selbst aus und sieht nie ein Token.
public struct WerkstattDienste: EinrichtungsDienste {
    private let pfade: AppPfade
    private let git: GitPruefer
    private let anfrage: WerkstattAnfrage
    private let home: URL

    public init(pfade: AppPfade, git: GitPruefer = GitPruefer(), home: URL = FileManager.default.homeDirectoryForCurrentUser,
                anfrage: @escaping WerkstattAnfrage) {
        self.pfade = pfade
        self.git = git
        self.home = home
        self.anfrage = anfrage
    }

    // MARK: git

    public func gitStand() async -> GitStand { await git.pruefe() }
    public func gitInstallationStarten() async -> GitInstallationStart { await git.starteInstallation() }
    public func gitWarten() async -> GitStand { await git.warteAufGit() }

    // MARK: Vault

    public func aktiverVault() async -> VaultInfo? {
        guard let url = VaultListe.aktiverVault(pfade, home: home) else { return nil }
        var istOrdner: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &istOrdner), istOrdner.boolValue else { return nil }
        let name = VaultListe.lade(pfade, home: home)?.anzeigename(fuer: url) ?? url.lastPathComponent
        let hatGit = FileManager.default.fileExists(atPath: url.appendingPathComponent(".git").path)
        return VaultInfo(name: name, pfad: url.path, git: hatGit)
    }

    public func legeVaultAn(art: NeuerVaultArt, name: String?, ordner: String?) async throws -> VaultInfo {
        var b: [String: Any] = ["art": art.rawValue]
        if let name, !name.isEmpty { b["name"] = name }
        if let ordner, !ordner.isEmpty { b["ordner"] = ordner }
        return try Self.vault(aus: try await rufe("POST", "/api/vaults/neu", b))
    }

    public func oeffneOrdner(pfad: String, versionsverlaufEinschalten: Bool) async throws -> VaultInfo {
        try Self.vault(aus: try await rufe("POST", "/api/vaults/oeffnen", ["pfad": pfad, "gitEinschalten": versionsverlaufEinschalten]))
    }

    public func klone(url: String, ordner: String?, name: String?) async throws -> VaultInfo {
        var b: [String: Any] = ["url": url]
        if let ordner, !ordner.isEmpty { b["ordner"] = ordner }
        if let name, !name.isEmpty { b["name"] = name }
        return try Self.vault(aus: try await rufe("POST", "/api/vaults/klonen", b))
    }

    // MARK: GitHub

    public func githubKonto() async throws -> GitHubKonto {
        let j = try await rufe("GET", "/api/github/konto")
        return GitHubKonto(verfuegbar: j["verfuegbar"] as? Bool ?? false, angemeldet: j["angemeldet"] as? Bool ?? false, login: j["login"] as? String)
    }

    public func githubAnmelden() async throws -> GitHubGeraetecode {
        let j = try await rufe("POST", "/api/github/anmelden", [:])
        guard let code = j["code"] as? String, let url = j["url"] as? String else {
            throw EinrichtungsFehler("GitHub hat keinen Code geliefert. Bitte versuche es noch einmal.")
        }
        return GitHubGeraetecode(code: code, url: url, ablauf: j["ablauf"] as? String)
    }

    public func githubStatus() async throws -> GitHubAnmeldung {
        Self.anmeldung(aus: try await rufe("GET", "/api/github/anmelden"))
    }

    /// Beendet das Warten auf den Code (`/api/github/abbrechen`): nur das Polling der Werkstatt stoppt, der Schlüsselbund wird nie
    /// angefasst — ein vorhandenes oder gerade frisch gespeichertes Konto bleibt.
    public func githubAbbrechen() async throws {
        _ = try await rufe("POST", "/api/github/abbrechen", [:])
    }

    // MARK: Sicherung

    public func sicherungVorpruefung() async -> SicherungVorpruefung {
        do {
            let j = try await rufe("GET", "/api/sicherung/bereit")
            switch j["zustand"] as? String {
            case "gesichert": return .gesichert
            case "bereit": return .bereit
            case "blockiert": return .blockiert((j["text"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Dein Vault kann gerade nicht gesichert werden.")
            default: return .blockiert("Die Antwort des Hintergrunddienstes war unvollständig.")
            }
        } catch {
            // Nicht lesbar heißt NICHT „keine Sicherung“: sonst würde ein Repository angelegt, das sich danach nicht verbinden lässt.
            let grund = (error as? EinrichtungsFehler)?.meldung ?? error.localizedDescription
            return .blockiert("Kortex konnte den Stand deines Vaults nicht prüfen: \(grund) Es wurde nichts bei GitHub angelegt.")
        }
    }

    public func githubRepos() async throws -> GitHubRepoListe {
        let j = try await rufe("GET", "/api/github/repos")
        let repos = (j["repos"] as? [[String: Any]] ?? []).compactMap(Self.repo(aus:))
        return GitHubRepoListe(repos: repos, gekuerzt: (j["gekuerzt"] as? Bool) == true)
    }

    public func githubRepoAnlegen(name: String) async throws -> GitHubRepo {
        let j = try await rufe("POST", "/api/github/repo-anlegen", ["name": name])
        // Die Werkstatt legt nur private Repositories an; meldet sie etwas anderes, wird das Ergebnis nicht verwendet.
        guard (j["privat"] as? Bool) == true, let r = Self.repo(aus: j) else {
            throw EinrichtungsFehler("GitHub hat das Repository nicht wie erwartet angelegt. Schau auf github.com nach, bevor du es noch einmal versuchst.")
        }
        return r
    }

    public func verbindeSicherung(besitzer: String, name: String) async throws -> SicherungErgebnis {
        // Nur besitzer/name: die Adresse baut die Werkstatt selbst (kein Freitext, keine Zugangsdaten).
        let j = try await rufe("POST", "/api/sicherung/verbinden", ["besitzer": besitzer, "name": name])
        return (j["ergebnis"] as? String).flatMap(SicherungErgebnis.init(rawValue:)) ?? .verbunden
    }

    static func repo(aus j: [String: Any]) -> GitHubRepo? {
        guard let name = j["name"] as? String, let besitzer = j["besitzer"] as? String, let url = j["url"] as? String,
              url == "https://github.com/\(besitzer)/\(name).git" else { return nil }
        return GitHubRepo(name: name, besitzer: besitzer, url: url, aktualisiert: j["aktualisiert"] as? String, leer: (j["leer"] as? Bool) == true)
    }

    // MARK: KI

    public func erkenneKIs() async throws -> [KiProgramm] {
        let j = try await rufe("GET", "/api/ki/erkennen?neu=1")
        return Self.programme(aus: j)
    }

    /// Die Liste der Werkstatt als `KiProgramm`e. Cursor bekommt einen eigenen Eintrag „cursor“: die Werkstatt meldet ihn über das
    /// Feld `cursorDa` (App oder `~/.cursor` vorhanden) und/oder den Agenten `cursor-agent` — nicht über einen Agenten „cursor“.
    /// Die Programme mit Einstellungsdatei (Claude Desktop, Gemini CLI, GitHub Copilot, Zed, OpenCode, Warp) stehen in `programme`
    /// (`id`, `name`, `gefunden`, `version`); sie kommen zwischen den Agenten und Cursor.
    static func programme(aus j: [String: Any]) -> [KiProgramm] {
        let agenten = (j["agenten"] as? [[String: Any]] ?? []).compactMap { a -> KiProgramm? in
            guard let id = a["id"] as? String else { return nil }
            return KiProgramm(id: id, name: a["name"] as? String ?? id, version: a["version"] as? String, gefunden: (a["pfad"] as? String) != nil)
        }
        let agent = agenten.first { $0.id == "cursor-agent" }
        let cursor = KiProgramm(id: "cursor", name: "Cursor", version: agent?.gefunden == true ? agent?.version : nil,
                                gefunden: (j["cursorDa"] as? Bool) == true || agent?.gefunden == true)
        let weitere = (j["programme"] as? [[String: Any]] ?? []).compactMap { p -> KiProgramm? in
            guard let id = p["id"] as? String else { return nil }
            return KiProgramm(id: id, name: p["name"] as? String ?? id, version: p["version"] as? String, gefunden: (p["gefunden"] as? Bool) == true)
        }
        // Wer als Agent (Befehl) und als Programm (App oder Befehl) vorkommt, zählt mit dem Eintrag aus `programme`: er kennt auch die App.
        let ids = Set(weitere.map(\.id))
        return agenten.filter { !ids.contains($0.id) } + weitere.map { p in
            let agent = agenten.first { $0.id == p.id }
            return KiProgramm(id: p.id, name: p.name, version: p.version ?? agent?.version, gefunden: p.gefunden || agent?.gefunden == true)
        } + [cursor]
    }

    public func verbinde(_ ziel: KiZiel, umstellen: Bool, profil: String?) async throws -> KiVerbindung {
        try await verbinde(ziel, umstellen: umstellen, profil: profil, zugriff: nil)
    }

    public func verbinde(_ ziel: KiZiel, umstellen: Bool, profil: String?, zugriff: KiStufe?) async throws -> KiVerbindung {
        var b: [String: Any] = ["ziel": ziel.ziel]
        if umstellen { b["umstellen"] = true }
        if ziel == .claude, let profil { b["profil"] = profil }
        if let zugriff { b["zugriff"] = zugriff.rawValue }
        let j = try await rufe("POST", "/api/mcp/verbinden", b)
        return (j["schonVerbunden"] as? Bool) == true ? .schonVerbunden : .verbunden
    }

    public func trenne(_ ziel: KiZiel, profil: String?) async throws -> KiTrennung {
        var b: [String: Any] = ["ziel": ziel.ziel]
        if ziel == .claude, let profil { b["profil"] = profil }
        let j = try await rufe("POST", "/api/mcp/trennen", b)
        return (j["warNichtVerbunden"] as? Bool) == true ? .warNichtVerbunden : .getrennt
    }

    public func konfiguration(fuer ziel: KiZiel?) async throws -> String {
        // Nur die Programme mit Einstellungsdatei haben ein eigenes Format; für Claude Code und Codex gilt das übliche (`mcpServers`).
        let j = try await rufe("GET", ziel?.dateiOrt != nil ? "/api/mcp/konfiguration?ziel=\(ziel!.ziel)" : "/api/mcp/konfiguration")
        guard let text = j["json"] as? String, !text.isEmpty else {
            throw EinrichtungsFehler("Die Antwort des Hintergrunddienstes war unvollständig.")
        }
        return text
    }

    // MARK: Verdrahtung

    public func verdrahtungsStand() async throws -> VerdrahtungsStand {
        Self.verdrahtungsStand(aus: try await rufe("GET", "/api/kern/stand"))
    }

    public func verdrahte(_ was: Verdrahtung, an: Bool, ersetzen: Bool, profile: [String]) async throws -> VerdrahtungsStand {
        try await verdrahte(was, an: an, ersetzen: ersetzen, profile: profile, zugriff: nil)
    }

    public func verdrahte(_ was: Verdrahtung, an: Bool, ersetzen: Bool, profile: [String], zugriff: KiStufe?) async throws -> VerdrahtungsStand {
        var b: [String: Any] = ["was": was.rawValue, "an": an]
        if ersetzen { b["ersetzen"] = true }
        if was == .claude { b["profile"] = profile }
        if was == .claude, an, let zugriff { b["zugriff"] = zugriff.rawValue }
        if was == .dienst, let erstes = profile.first { b["profil"] = erstes }
        let j = try await rufe("POST", "/api/kern/verdrahten", b)
        return Self.verdrahtungsStand(aus: j["stand"] as? [String: Any] ?? [:])
    }

    /// `{ starter: {vorhanden}, profile: [{pfad, name, standard}], claude: {profile: {<pfad>: {aktiv} | {fehler}}}, git: {moeglich, aktiv, fremder}, dienst: {verfuegbar, eingerichtet} }`.
    /// Ein Abschnitt mit `fehler` zählt als „nicht eingetragen“ (die Oberfläche bietet das Eintragen an und zeigt dessen Fehler).
    static func verdrahtungsStand(aus j: [String: Any]) -> VerdrahtungsStand {
        let claudeProfile = (j["claude"] as? [String: Any])?["profile"] as? [String: Any] ?? [:]
        let profile = (j["profile"] as? [[String: Any]] ?? []).compactMap { p -> ClaudeProfil? in
            guard let pfad = p["pfad"] as? String, let name = p["name"] as? String else { return nil }
            let aktiv = ((claudeProfile[pfad] as? [String: Any])?["aktiv"] as? Bool) == true
            return ClaudeProfil(pfad: pfad, name: name, standard: (p["standard"] as? Bool) == true, aktiv: aktiv)
        }
        let versionsverlauf = j["git"] as? [String: Any]
        let dienst = j["dienst"] as? [String: Any]
        return VerdrahtungsStand(
            starterVorhanden: ((j["starter"] as? [String: Any])?["vorhanden"] as? Bool) == true,
            profile: profile,
            gitMoeglich: (versionsverlauf?["moeglich"] as? Bool) == true && versionsverlauf?["fehler"] == nil,
            gitAktiv: (versionsverlauf?["aktiv"] as? Bool) == true,
            gitFremderEintrag: (versionsverlauf?["fremder"] as? Bool) == true,
            dienstVerfuegbar: (dienst?["verfuegbar"] as? Bool) == true,
            dienstAktiv: (dienst?["eingerichtet"] as? Bool) == true)
    }

    // MARK: Probe

    public func probe(frage: String) async throws -> ProbeErgebnis {
        let j = try await rufe("POST", "/api/probe", ["frage": frage])
        let titel = (j["treffer"] as? [[String: Any]] ?? []).compactMap { t -> String? in
            let n = (t["titel"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? (t["pfad"] as? String)
            return n
        }
        return ProbeErgebnis(frage: frage, treffer: titel)
    }

    // MARK: Hilfen

    /// Ruft die Werkstatt auf und liefert das JSON-Objekt der Antwort; jeder Fehler (Verbindung, Status, kein JSON) wird zu einem
    /// `EinrichtungsFehler` mit lesbarem Text.
    func rufe(_ methode: String, _ pfad: String, _ body: [String: Any]? = nil) async throws -> [String: Any] {
        let daten = try body.map { try JSONSerialization.data(withJSONObject: $0) }
        let a: BrueckenAntwort
        do { a = try await anfrage(methode, pfad, daten) } catch {
            throw Self.verbindungsfehler(error)
        }
        return try Self.auswerten(a)
    }

    static func verbindungsfehler(_ fehler: Error) -> EinrichtungsFehler {
        switch fehler {
        case BrueckenFehler.zeitUeberschritten:
            return EinrichtungsFehler("Das hat zu lange gedauert. Bitte versuche es noch einmal.")
        case BrueckenFehler.startFehlgeschlagen, BrueckenFehler.beendet, BrueckenFehler.geschlossen, BrueckenFehler.nichtErlaubt:
            return EinrichtungsFehler("Der Hintergrunddienst von Kortex antwortet nicht. Bitte starte Kortex neu.")
        default:
            return EinrichtungsFehler("Unerwarteter Fehler: \(fehler.localizedDescription)")
        }
    }

    /// 2xx → JSON-Objekt (leerer Körper = leeres Objekt); sonst `EinrichtungsFehler` aus `{fehler, art, befehl}`.
    static func auswerten(_ a: BrueckenAntwort) throws -> [String: Any] {
        let j = (try? JSONSerialization.jsonObject(with: a.body)) as? [String: Any]
        guard (200..<300).contains(a.status) else {
            let meldung = (j?["fehler"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Das hat nicht geklappt (Fehler \(a.status))."
            throw EinrichtungsFehler(meldung, status: a.status, art: j?["art"] as? String, befehl: j?["befehl"] as? String)
        }
        if a.body.isEmpty { return [:] }
        guard let j else { throw EinrichtungsFehler("Die Antwort des Hintergrunddienstes war nicht lesbar.") }
        return j
    }

    static func vault(aus j: [String: Any]) throws -> VaultInfo {
        guard let v = j["vault"] as? [String: Any], let pfad = v["pfad"] as? String else {
            throw EinrichtungsFehler("Die Antwort des Hintergrunddienstes war unvollständig.")
        }
        return VaultInfo(name: v["name"] as? String ?? URL(fileURLWithPath: pfad).lastPathComponent, pfad: pfad,
                         git: (v["git"] as? Bool) ?? (j["git"] as? Bool) ?? false)
    }

    static func anmeldung(aus j: [String: Any]) -> GitHubAnmeldung {
        switch j["zustand"] as? String {
        case "wartet":
            guard let code = j["code"] as? String, let url = j["url"] as? String else { return .keine }
            return .wartet(GitHubGeraetecode(code: code, url: url, ablauf: j["ablauf"] as? String))
        case "fertig": return .fertig(login: j["login"] as? String)
        case "abgelaufen": return .abgelaufen
        case "abgelehnt": return .abgelehnt(grund: j["grund"] as? String)
        default: return .keine
        }
    }
}
