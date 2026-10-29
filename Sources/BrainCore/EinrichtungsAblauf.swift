import Foundation

/// Was die Oberfläche zu einem KI-Ziel zeigt.
public struct KiZeile: Equatable, Sendable {
    public enum Status: Equatable, Sendable {
        case nichtGefunden
        case bereit
        case verbindet
        case verbunden(schon: Bool)
        /// Die KI-App hat schon einen anderen Eintrag „brain“: nur mit Ja des Nutzers umstellen.
        case umstellenFragen
        case fehler(String, befehl: String?)
    }

    public let ziel: KiZiel
    public var programm: KiProgramm?
    public var status: Status

    public var istVerbunden: Bool {
        if case .verbunden = status { return true }
        return false
    }
}

public enum GitHubAnzeige: Equatable, Sendable {
    case unbekannt
    /// In dieser Version nicht eingerichtet (keine Client-ID): der Schritt entfällt.
    case nichtVerfuegbar
    case abgemeldet
    case startet
    case wartet(GitHubGeraetecode)
    case angemeldet(login: String?)
    case abgelaufen
    case abgelehnt(grund: String?)
}

public enum ProbeAnzeige: Equatable, Sendable {
    case offen
    case laeuft
    case ok(ProbeErgebnis)
    /// Die Suche antwortet, das Brain ist aber noch leer.
    case leer
    case fehler(String)
}

public enum ReposAnzeige: Equatable, Sendable {
    case nichtGeladen
    case laedt
    case geladen(GitHubRepoListe)
    case fehler(String)
}

/// Stand des Schritts „Sicherung“ (privates GitHub-Repository).
public struct SicherungAnzeige: Equatable, Sendable {
    /// Eigene private Repositories für „Vorhandenes wählen“.
    public var repos = ReposAnzeige.nichtGeladen
    /// Text, solange angelegt, geprüft oder gesendet wird; sonst nil.
    public var arbeitet: String?
    /// Erledigt: so ist es ausgegangen (nil, wenn das Remote schon vorher da war).
    public var ergebnis: SicherungErgebnis?
    /// Erledigt: mit diesem Repository ist das Brain verbunden („besitzer/name“); nil bei einem schon vorhandenen Remote.
    public var verbundenMit: String?
    /// Das Remote war schon eingetragen, bevor der Assistent es angefasst hat.
    public var schonVerbunden = false
    /// Das neue Repository ist angelegt, aber das Verbinden ist gescheitert: ein neuer Versuch legt NICHT noch eines an.
    public var angelegt: GitHubRepo?
    /// Das gewählte Repository hat eine andere Geschichte als das Brain: nichts wurde verändert, der Nutzer bekommt eine Erklärung
    /// und kann stattdessen ein neues anlegen.
    public var konflikt: String?
    /// Die Sicherung ist gerade nicht möglich (Git gesperrt, losgelöster Kopf, keine Version, Stand nicht lesbar …): Erklärung für den
    /// Nutzer. Dann wurde und wird bei GitHub nichts angelegt.
    public var blockiert: String?
    /// „Name schon vergeben“: der Name, zu dem das gleichnamige eigene private Repository angeboten wird.
    public var vergebenerName: String?

    public init() {}

    public var istVerbunden: Bool { ergebnis != nil || schonVerbunden }
}

/// Stand der Eintragungen im Schritt „KI verbinden“ (Hooks bei Claude Code, Prüfung vor dem Speichern, Hintergrunddienst).
public struct VerdrahtungsAnzeige: Equatable, Sendable {
    /// nil: noch nicht gelesen oder nicht lesbar — dann zeigt die Oberfläche den Block nicht.
    public var stand: VerdrahtungsStand?
    /// Welcher Eintrag gerade geschrieben oder herausgenommen wird.
    public var arbeitet: Verdrahtung?
    public var fehler: [Verdrahtung: String] = [:]
    /// Im Vault ist schon ein anderer Hook-Ordner eingetragen: Rückfrage, ob er ersetzt werden soll.
    public var gitFragtErsetzen = false
    /// Die vom Nutzer gewählten Claude-Profile (Pfade). nil: noch nicht gewählt — dann gilt das Standardprofil `~/.claude`, falls es eines gibt
    /// (oder das einzige gefundene). Die Auswahl gilt für das Eintragen der Hooks UND für das Verbinden von Claude Code (MCP).
    public var gewaehlteProfile: [String]?

    public init() {}

    /// Die gefundenen Profile (leer, solange der Stand nicht gelesen ist).
    public var profile: [ClaudeProfil] { stand?.profile ?? [] }
    /// Die tatsächlich gewählten Profile: die Auswahl, sonst die Voreinstellung — nur Profile, die es (noch) gibt.
    public var auswahl: [String] {
        let da = profile.map(\.pfad)
        if let g = gewaehlteProfile { return da.filter { g.contains($0) } }
        if let standard = profile.first(where: \.standard) { return [standard.pfad] }
        return profile.count == 1 ? da : []
    }
}

/// Alles, was die Oberfläche zusätzlich zur Schrittfolge anzeigt.
public struct EinrichtungsAnzeige: Equatable, Sendable {
    public var git: GitStand?
    public var gitPrueftGerade = false
    public var vault: VaultInfo?
    /// Text, solange ein Vault angelegt, geöffnet oder geklont wird; sonst nil.
    public var vaultArbeitet: String?
    public var github = GitHubAnzeige.unbekannt
    public var sicherung = SicherungAnzeige()
    public var kis: [KiZeile] = []
    public var kiSuchtGerade = false
    public var verdrahtung = VerdrahtungsAnzeige()
    public var probe = ProbeAnzeige.offen

    public init() {}
}

/// Der Ablauf des Assistenten „Kortex einrichten“: stellt aus der Wirklichkeit fest, was schon erledigt ist (git da? Vault aktiv?
/// GitHub-Konto im Schlüsselbund?), springt über Erledigtes, führt die Aktionen des Nutzers über `EinrichtungsDienste` aus, hält
/// Fehler sichtbar und merkt sich den Stand in `einrichtung.json` (Wiederaufnahme nach Abbruch). Er kennt keine Oberfläche:
/// jede Änderung geht über `beiAenderung` an sie.
@MainActor
public final class EinrichtungsAblauf {
    /// Suchbegriff der Probe. Er steht in jedem Brain aus der Vorlage; die Probe prüft den Weg, nicht den Inhalt.
    public static let probeFrage = "Vault"

    public private(set) var zustand = EinrichtungsZustand()
    public private(set) var anzeige = EinrichtungsAnzeige()
    public private(set) var abgeschlossen = false
    public private(set) var automatischAus = false
    /// Woher dieser Lauf kam; steht in `einrichtung.json` (siehe `EinrichtungsHerkunft`).
    public private(set) var herkunft = EinrichtungsHerkunft.start
    /// Die eine laufende Wartezeit auf Apples Installation — Mehrfachklicks auf „Erneut prüfen“ schließen sich ihr an.
    private var gitWarteAufgabe: Task<GitStand, Never>?

    private let dienste: EinrichtungsDienste
    private let speicher: EinrichtungsSpeicher?
    private let schlafe: @Sendable (Duration) async -> Void
    private let log: (String) -> Void
    private let beiAenderung: @MainActor (EinrichtungsZustand, EinrichtungsAnzeige) -> Void
    /// Schritte, deren Eingangsprüfung in dieser Sitzung schon lief (damit „Zurück“ nicht gleich wieder weiterspringt).
    private var geprueft: Set<EinrichtungsSchritt> = []
    private var githubLauf = 0

    public init(dienste: EinrichtungsDienste, speicher: EinrichtungsSpeicher?,
                schlafe: @escaping @Sendable (Duration) async -> Void = { try? await Task.sleep(for: $0) },
                log: @escaping (String) -> Void = { _ in },
                beiAenderung: @escaping @MainActor (EinrichtungsZustand, EinrichtungsAnzeige) -> Void) {
        self.dienste = dienste
        self.speicher = speicher
        self.schlafe = schlafe
        self.log = log
        self.beiAenderung = beiAenderung
    }

    // MARK: Start

    /// Beginnt oder setzt fort. `wiederholung` (Menü „Kortex einrichten …“) zeigt KI und Probe noch einmal; Erledigtes aus der
    /// Wirklichkeit (git, Vault, GitHub-Konto) geht auch dann ohne Klick vorbei.
    public func starte(wiederholung: Bool = false) async {
        let datei = speicher?.lade()
        automatischAus = datei?.automatischAus ?? false
        herkunft = wiederholung ? .menue : .start
        let neuAnfangen = wiederholung || datei?.abgeschlossen == true
        zustand = neuAnfangen ? EinrichtungsZustand() : EinrichtungsZustand(gespeichert: datei)
        abgeschlossen = false
        anzeige = EinrichtungsAnzeige()
        geprueft = []
        githubLauf += 1
        melde()
        await fortfahren()
    }

    /// Prüft jeden Schritt, der dran kommt, einmal beim Betreten; Erledigtes rückt den nächsten nach.
    private func fortfahren() async {
        while let s = zustand.aktuell, !geprueft.contains(s) {
            geprueft.insert(s)
            await betrete(s)
        }
        if zustand.istFertig { abgeschlossen = true }
        sichere()
        melde()
    }

    private func betrete(_ s: EinrichtungsSchritt) async {
        switch s {
        case .git: await pruefeGitSchritt()
        case .vault: await pruefeVaultSchritt()
        case .github: await pruefeGitHubSchritt()
        case .sicherung: await pruefeSicherungSchritt()
        case .ki: await erkenneKIsSchritt()
        case .probe: await fuehreProbeAus()
        }
    }

    // MARK: git

    public func pruefeGit() async {
        await pruefeGitSchritt()
        await fortfahren()
    }

    private func pruefeGitSchritt() async {
        anzeige.gitPrueftGerade = true
        melde()
        wendeAn(await dienste.gitStand())
        anzeige.gitPrueftGerade = false
        melde()
        // Läuft die Installation schon (z. B. nach einem Neustart der App mittendrin), wird auf sie gewartet.
        if anzeige.git == .installiertGerade { await wendeAnNachWarten() }
    }

    /// Wartet auf Apples Installation. Es gibt immer nur EINE Wartezeit: wer währenddessen noch einmal prüft (Doppelklick auf
    /// „Erneut prüfen“, Wiederaufnahme), schließt sich ihr an, statt eine weitere Schleife zu starten.
    private func wendeAnNachWarten() async {
        let aufgabe: Task<GitStand, Never>
        if let laufende = gitWarteAufgabe {
            aufgabe = laufende
        } else {
            let dienste = self.dienste
            aufgabe = Task { await dienste.gitWarten() }
            gitWarteAufgabe = aufgabe
        }
        let stand = await aufgabe.value
        gitWarteAufgabe = nil
        wendeAn(stand)
        melde()
    }

    private func wendeAn(_ stand: GitStand) {
        anzeige.git = stand
        switch stand {
        case .vorhanden:
            zustand.meldeErledigt(.git)
        case .fehlt, .installiertGerade:
            zustand.loescheFehler(.git)
        case .defekt(let m):
            zustand.meldeFehler(.git, "git ist da, läuft aber nicht: \(m)")
        case .nichtPruefbar(let m):
            zustand.meldeFehler(.git, "Die Prüfung von git ist fehlgeschlagen: \(m)")
        }
    }

    /// Löst Apples Installationsdialog aus und wartet, bis git da ist (oder der Dialog zugemacht wurde).
    public func installiereGit() async {
        zustand.loescheFehler(.git)
        anzeige.gitPrueftGerade = true
        melde()
        let start = await dienste.gitInstallationStarten()
        anzeige.gitPrueftGerade = false
        switch start {
        case .dialogAusgeloest:
            anzeige.git = .installiertGerade
            melde()
            await wendeAnNachWarten()
        case .schonInstalliert:
            wendeAn(await dienste.gitStand())
        case .fehlgeschlagen(let m):
            anzeige.git = .fehlt
            zustand.meldeFehler(.git, m)
        }
        await fortfahren()
    }

    // MARK: Vault

    private func pruefeVaultSchritt() async {
        if let v = await dienste.aktiverVault() {
            anzeige.vault = v
            zustand.meldeErledigt(.vault)
        }
    }

    public func legeVaultAn(art: NeuerVaultArt = .vorlage, name: String?, ordner: String?) async {
        await vaultAktion("Dein Vault wird angelegt …") { try await self.dienste.legeVaultAn(art: art, name: name, ordner: ordner) }
    }

    public func oeffneOrdner(pfad: String, versionsverlaufEinschalten: Bool) async {
        await vaultAktion("Ordner wird geöffnet …") {
            try await self.dienste.oeffneOrdner(pfad: pfad, versionsverlaufEinschalten: versionsverlaufEinschalten)
        }
    }

    public func klone(url: String, ordner: String? = nil) async {
        await vaultAktion("Wird von GitHub geladen …") { try await self.dienste.klone(url: url, ordner: ordner, name: nil) }
    }

    private func vaultAktion(_ text: String, _ aktion: () async throws -> VaultInfo) async {
        guard anzeige.vaultArbeitet == nil else { return }
        anzeige.vaultArbeitet = text
        zustand.loescheFehler(.vault)
        melde()
        do {
            let v = try await aktion()
            anzeige.vault = v
            zustand.meldeErledigt(.vault)
            log("einrichtung vault-bereit")
        } catch {
            zustand.meldeFehler(.vault, Self.text(error))
            log("einrichtung vault-fehler")
        }
        anzeige.vaultArbeitet = nil
        await fortfahren()
    }

    // MARK: GitHub

    private func pruefeGitHubSchritt() async {
        do {
            let konto = try await dienste.githubKonto()
            if !konto.verfuegbar {
                anzeige.github = .nichtVerfuegbar
                zustand.uebergehe(.github) // entfällt nur in dieser Version: nicht merken, beim nächsten Mal neu beurteilen
            } else if konto.angemeldet {
                anzeige.github = .angemeldet(login: konto.login)
                zustand.meldeErledigt(.github)
            } else {
                anzeige.github = .abgemeldet
            }
        } catch {
            anzeige.github = .abgemeldet
            zustand.meldeFehler(.github, Self.text(error))
        }
    }

    /// Für die Karte „Von GitHub klonen“ im Vault-Schritt: private Repositories brauchen die Anmeldung schon vor dem GitHub-Schritt.
    /// Liest den Kontostand einmal (danach gilt `anzeige.github`); ist man angemeldet, entfällt der GitHub-Schritt später ohne Klick.
    public func ladeGitHubStand() async {
        guard anzeige.github == .unbekannt else { return }
        await pruefeGitHubSchritt()
        await fortfahren()
    }

    /// Fordert den Gerätecode an und fragt dann regelmäßig nach, bis die Anmeldung fertig, abgelehnt oder abgelaufen ist.
    /// Kehrt auch bei Abbruch (`brecheGitHubAb`) oder abgebrochener Aufgabe zurück.
    public func meldeBeiGitHubAn() async {
        githubLauf += 1
        let lauf = githubLauf
        zustand.loescheFehler(.github)
        anzeige.github = .startet
        melde()
        do {
            let code = try await dienste.githubAnmelden()
            guard lauf == githubLauf else { return }
            anzeige.github = .wartet(code)
            melde()
        } catch {
            anzeige.github = .abgemeldet
            zustand.meldeFehler(.github, Self.text(error))
            melde()
            return
        }
        var aufeinanderFehler = 0
        while lauf == githubLauf, !Task.isCancelled {
            await schlafe(.seconds(2))
            guard lauf == githubLauf, !Task.isCancelled else { return }
            let stand: GitHubAnmeldung
            do {
                stand = try await dienste.githubStatus()
                aufeinanderFehler = 0
            } catch {
                // kurz weg (Schlaf, WLAN): weiter versuchen, aber nicht endlos still
                aufeinanderFehler += 1
                if aufeinanderFehler >= 5 {
                    anzeige.github = .abgemeldet
                    zustand.meldeFehler(.github, Self.text(error))
                    melde()
                    return
                }
                continue
            }
            guard lauf == githubLauf else { return }
            switch stand {
            case .wartet(let c): anzeige.github = .wartet(c); melde()
            case .fertig(let login):
                anzeige.github = .angemeldet(login: login)
                zustand.meldeErledigt(.github)
                log("einrichtung github-angemeldet")
                await fortfahren()
                return
            case .abgelaufen: anzeige.github = .abgelaufen; melde(); return
            case .abgelehnt(let g): anzeige.github = .abgelehnt(grund: g); melde(); return
            case .keine:
                // Die Werkstatt weiß nichts mehr von dieser Anmeldung (sie wurde neu gestartet): nicht still zurückspringen.
                anzeige.github = .abgemeldet
                zustand.meldeFehler(.github, "Die Anmeldung wurde unterbrochen (der Hintergrunddienst wurde neu gestartet). Bitte melde dich noch einmal an.")
                melde()
                return
            }
        }
    }

    /// Bricht das Warten auf den Code ab.
    public func brecheGitHubAb() async {
        githubLauf += 1
        anzeige.github = .abgemeldet
        melde()
        do { try await dienste.githubAbbrechen() } catch { zustand.meldeFehler(.github, Self.text(error)); melde() }
    }

    // MARK: Sicherung

    /// Schritt „Sicherung“: Sind Remote und Upstream da, ist er erledigt. Ohne GitHub-Anmeldung in dieser Version oder ohne
    /// Versionsverlauf (Ordner ohne git) entfällt er — nur in der Anzeige (`uebergehe`), nicht in `einrichtung.json`.
    private func pruefeSicherungSchritt() async {
        if anzeige.vault?.git == false {
            zustand.uebergehe(.sicherung)
            return
        }
        let vor = await dienste.sicherungVorpruefung()
        if vor == .gesichert {
            anzeige.sicherung.schonVerbunden = true
            zustand.meldeErledigt(.sicherung)
            return
        }
        // Noch keine Sicherung: ob ein GitHub-Konto da ist, entscheidet, was die Oberfläche anbietet.
        if anzeige.github == .unbekannt { await pruefeGitHubSchritt() }
        if anzeige.github == .nichtVerfuegbar {
            zustand.uebergehe(.sicherung)
            return
        }
        anzeige.sicherung.blockiert = vor.blockiertText
    }

    /// „Erneut prüfen“, wenn die Sicherung blockiert ist (z. B. nachdem der Nutzer das Brain im Studio freigegeben hat).
    public func pruefeSicherungNeu() async {
        guard anzeige.sicherung.arbeitet == nil else { return }
        anzeige.sicherung.arbeitet = "Dein Vault wird geprüft …"
        melde()
        _ = await vorpruefungOk()
        anzeige.sicherung.arbeitet = nil
        await fortfahren()
    }

    /// Frische Vorprüfung unmittelbar vor dem Anlegen oder Verbinden. true = es darf weitergehen. Blockiert sie, wird NICHTS bei
    /// GitHub angelegt; ist alles schon verbunden, ist der Schritt erledigt.
    private func vorpruefungOk() async -> Bool {
        switch await dienste.sicherungVorpruefung() {
        case .bereit:
            anzeige.sicherung.blockiert = nil
            return true
        case .gesichert:
            anzeige.sicherung.blockiert = nil
            anzeige.sicherung.schonVerbunden = true
            zustand.meldeErledigt(.sicherung)
            return false
        case .blockiert(let text):
            anzeige.sicherung.blockiert = text
            return false
        }
    }

    /// Liest die eigenen privaten Repositories (für „Vorhandenes wählen“).
    public func ladeRepos() async {
        if case .laedt = anzeige.sicherung.repos { return }
        anzeige.sicherung.repos = .laedt
        melde()
        do {
            anzeige.sicherung.repos = .geladen(try await dienste.githubRepos())
        } catch {
            anzeige.sicherung.repos = .fehler(Self.text(error))
            if (error as? EinrichtungsFehler)?.status == 401 { anzeige.github = .abgemeldet }
        }
        melde()
    }

    /// „Neues privates Repository“: prüft ZUERST, ob sich das Brain verbinden lässt, legt dann das Repository an (immer privat) und
    /// verbindet. Scheitert das Verbinden, bleibt das angelegte Repository gemerkt — der nächste Versuch mit demselben Namen legt kein
    /// zweites an.
    public func sichereMitNeuemRepo(name roh: String) async {
        guard anzeige.sicherung.arbeitet == nil else { return }
        let name = roh.trimmingCharacters(in: .whitespacesAndNewlines)
        if let f = RepoName.fehler(name) {
            zustand.meldeFehler(.sicherung, f)
            melde()
            return
        }
        zustand.loescheFehler(.sicherung)
        anzeige.sicherung.konflikt = nil
        anzeige.sicherung.vergebenerName = nil
        anzeige.sicherung.arbeitet = "Dein Vault wird geprüft …"
        melde()
        guard await vorpruefungOk() else {
            anzeige.sicherung.arbeitet = nil
            await fortfahren()
            return
        }
        if let schon = anzeige.sicherung.angelegt, schon.name == name {
            await verbindeRepo(schon)
            return
        }
        anzeige.sicherung.arbeitet = "Dein privates Repository wird angelegt …"
        melde()
        do {
            let repo = try await dienste.githubRepoAnlegen(name: name)
            anzeige.sicherung.angelegt = repo
            log("einrichtung sicherung-repo-angelegt")
            await verbindeRepo(repo)
        } catch {
            let f = error as? EinrichtungsFehler
            zustand.meldeFehler(.sicherung, Self.text(error))
            if f?.art == "name-vergeben" { anzeige.sicherung.vergebenerName = name }
            if f?.status == 401 { anzeige.github = .abgemeldet }
            anzeige.sicherung.arbeitet = nil
            log("einrichtung sicherung-anlegen-fehler")
            melde()
        }
    }

    /// „Vorhandenes wählen“: verbindet das Brain mit einem eigenen privaten Repository. Hat es eine andere Geschichte, wird nichts
    /// überschrieben (die Werkstatt vergleicht vor dem Senden und sendet nie mit Gewalt): der Nutzer bekommt eine Erklärung.
    public func sichereMitRepo(_ repo: GitHubRepo) async {
        guard anzeige.sicherung.arbeitet == nil else { return }
        zustand.loescheFehler(.sicherung)
        anzeige.sicherung.konflikt = nil
        anzeige.sicherung.vergebenerName = nil
        anzeige.sicherung.arbeitet = "Dein Vault wird geprüft …"
        melde()
        guard await vorpruefungOk() else {
            anzeige.sicherung.arbeitet = nil
            await fortfahren()
            return
        }
        await verbindeRepo(repo)
    }

    /// Nach „Name schon vergeben“: das gleichnamige EIGENE PRIVATE Repository nehmen (aus der Liste der Werkstatt; ein öffentliches
    /// oder fremdes kommt dort nie vor).
    public func nimmGleichnamigesRepo() async {
        guard anzeige.sicherung.arbeitet == nil, let name = anzeige.sicherung.vergebenerName else { return }
        if case .geladen = anzeige.sicherung.repos {} else { await ladeRepos() }
        if case .geladen(let liste) = anzeige.sicherung.repos, let r = liste.repos.first(where: { $0.name.lowercased() == name.lowercased() }) {
            await sichereMitRepo(r)
        } else {
            zustand.meldeFehler(.sicherung, "Ein Repository „\(name)“ gibt es zwar, aber es ist nicht privat oder gehört nicht zu deinem Konto. Wähle einen anderen Namen.")
            anzeige.sicherung.vergebenerName = nil
            melde()
        }
    }

    /// Nach der Erklärung zum fremden Repository: zurück zur Auswahl.
    public func schliesseKonfliktAb() {
        anzeige.sicherung.konflikt = nil
        melde()
    }

    private func verbindeRepo(_ repo: GitHubRepo) async {
        anzeige.sicherung.arbeitet = "Dein Vault wird mit GitHub verbunden und gesendet … Das kann bei einem großen Vault einige Minuten dauern."
        melde()
        do {
            let e = try await dienste.verbindeSicherung(besitzer: repo.besitzer, name: repo.name)
            anzeige.sicherung.ergebnis = e
            anzeige.sicherung.verbundenMit = repo.vollerName
            anzeige.sicherung.angelegt = nil
            log("einrichtung sicherung-ok \(e.rawValue)")
        } catch let f as EinrichtungsFehler {
            if let art = f.art, Self.konfliktArten.contains(art) {
                anzeige.sicherung.konflikt = f.meldung
            } else if f.art == "blockiert" {
                anzeige.sicherung.blockiert = f.meldung
            } else {
                zustand.meldeFehler(.sicherung, Self.sicherungsText(f))
                if f.status == 403 || f.status == 401 { anzeige.github = .abgemeldet }
            }
            log("einrichtung sicherung-fehler")
        } catch {
            zustand.meldeFehler(.sicherung, Self.text(error))
            log("einrichtung sicherung-fehler")
        }
        anzeige.sicherung.arbeitet = nil
        melde()
    }

    /// Fehlerarten von `POST /api/git/remote`, bei denen das Repository nicht zum Brain passt (nichts wurde verändert).
    private static let konfliktArten: Set<String> = ["fremd", "auseinander", "zweigname"]

    /// Zugriffsfehler beim Senden: Alltagstext statt „Schlüsselbund oder SSH-Schlüssel“.
    static func sicherungsText(_ f: EinrichtungsFehler) -> String {
        if f.status == 403 || f.status == 401 {
            return "GitHub hat den Zugriff verweigert. Melde dich bitte noch einmal bei GitHub an und versuche es dann erneut."
        }
        return f.meldung
    }

    // MARK: KI

    private func erkenneKIsSchritt() async {
        anzeige.kiSuchtGerade = true
        zustand.loescheFehler(.ki)
        melde()
        do {
            let liste = try await dienste.erkenneKIs()
            anzeige.kis = KiZiel.verbindbar.map { ziel in
                let programm = liste.first { $0.id == ziel.agentId }
                let vorher = anzeige.kis.first { $0.ziel == ziel }?.status
                let status: KiZeile.Status = (programm?.gefunden ?? false) ? (vorher.flatMap { $0 == .nichtGefunden ? nil : $0 } ?? .bereit) : .nichtGefunden
                return KiZeile(ziel: ziel, programm: programm, status: status)
            }
        } catch {
            zustand.meldeFehler(.ki, Self.text(error))
        }
        anzeige.kiSuchtGerade = false
        await ladeVerdrahtung()
    }

    // MARK: Verdrahtung (Hooks, Prüfung vor dem Speichern, Hintergrunddienst)

    /// Liest, was eingetragen ist. Ein Lesefehler ist kein Hindernis für den Schritt: der Block bleibt dann einfach unsichtbar.
    public func ladeVerdrahtung() async {
        do { anzeige.verdrahtung.stand = try await dienste.verdrahtungsStand() } catch { anzeige.verdrahtung.stand = nil }
        melde()
    }

    /// Trägt einen Eintrag ein (`an`) oder nimmt ihn heraus. Nur auf ausdrücklichen Klick des Nutzers. Fehler bleiben sichtbar und lassen
    /// den Stand, wie er war (die Installer schreiben atomar und legen vorher eine Sicherung an).
    public func schalte(_ was: Verdrahtung, an: Bool, ersetzen: Bool = false) async {
        guard anzeige.verdrahtung.arbeitet == nil else { return }
        anzeige.verdrahtung.fehler[was] = nil
        anzeige.verdrahtung.gitFragtErsetzen = false
        let profile = anzeige.verdrahtung.auswahl
        if was == .claude, profile.isEmpty {
            anzeige.verdrahtung.fehler[was] = "Wähle bitte mindestens ein Claude-Profil aus."
            melde()
            return
        }
        anzeige.verdrahtung.arbeitet = was
        melde()
        do {
            anzeige.verdrahtung.stand = try await dienste.verdrahte(was, an: an, ersetzen: ersetzen, profile: profile)
            log("einrichtung verdrahtung \(was.rawValue) \(an ? "an" : "aus")")
        } catch let e as EinrichtungsFehler {
            if was == .git, an, e.status == 409, e.art == "anders" {
                anzeige.verdrahtung.gitFragtErsetzen = true
            } else {
                anzeige.verdrahtung.fehler[was] = e.meldung
            }
            log("einrichtung verdrahtung-fehler \(was.rawValue)")
        } catch {
            anzeige.verdrahtung.fehler[was] = Self.text(error)
            log("einrichtung verdrahtung-fehler \(was.rawValue)")
        }
        anzeige.verdrahtung.arbeitet = nil
        melde()
    }

    /// Ein Claude-Profil an- oder abwählen (gilt für Hooks und für das Verbinden von Claude Code).
    public func waehleProfil(_ pfad: String, gewaehlt: Bool) {
        var liste = anzeige.verdrahtung.auswahl
        liste.removeAll { $0 == pfad }
        if gewaehlt { liste.append(pfad) }
        anzeige.verdrahtung.gewaehlteProfile = liste
        melde()
    }

    /// „Nicht ersetzen“: die Rückfrage zum fremden Hook-Ordner wird geschlossen, nichts verändert.
    public func lehneGitErsetzenAb() {
        anzeige.verdrahtung.gitFragtErsetzen = false
        melde()
    }

    public func sucheKIsNeu() async {
        await erkenneKIsSchritt()
        melde()
    }

    public func verbinde(_ ziel: KiZiel, umstellen: Bool = false) async {
        setzeKi(ziel, .verbindet)
        melde()
        do {
            // Claude Code: in jedem gewählten Profil (Standardprofil → ~/.claude.json, andere → <Profil>/.claude.json). Ohne gefundene Profile wie bisher ohne Angabe.
            var ziele: [String?] = [nil]
            if ziel == .claude, !anzeige.verdrahtung.profile.isEmpty {
                let gewaehlt = anzeige.verdrahtung.auswahl
                guard !gewaehlt.isEmpty else { throw EinrichtungsFehler("Wähle bitte mindestens ein Claude-Profil aus.") }
                ziele = gewaehlt
            }
            var alleSchon = true
            for profil in ziele {
                if try await dienste.verbinde(ziel, umstellen: umstellen, profil: profil) != .schonVerbunden { alleSchon = false }
            }
            setzeKi(ziel, .verbunden(schon: alleSchon))
            zustand.loescheFehler(.ki)
            log("einrichtung ki-verbunden \(ziel.rawValue)")
        } catch let e as EinrichtungsFehler {
            setzeKi(ziel, e.istAndererEintrag && !umstellen ? .umstellenFragen : .fehler(e.meldung, befehl: e.befehl))
        } catch {
            setzeKi(ziel, .fehler(Self.text(error), befehl: nil))
        }
        melde()
    }

    /// Der Nutzer will den fremden Eintrag nicht ersetzen.
    public func lehneUmstellenAb(_ ziel: KiZiel) {
        setzeKi(ziel, .bereit)
        melde()
    }

    private func setzeKi(_ ziel: KiZiel, _ status: KiZeile.Status) {
        guard let i = anzeige.kis.firstIndex(where: { $0.ziel == ziel }) else { return }
        anzeige.kis[i].status = status
    }

    // MARK: Probe

    public func starteProbe() async {
        await fuehreProbeAus()
        await fortfahren()
    }

    private func fuehreProbeAus() async {
        anzeige.probe = .laeuft
        zustand.loescheFehler(.probe)
        melde()
        do {
            let r = try await dienste.probe(frage: Self.probeFrage)
            anzeige.probe = r.treffer.isEmpty ? .leer : .ok(r)
            zustand.meldeErledigt(.probe)
            log("einrichtung probe-ok treffer=\(r.treffer.count)")
        } catch {
            anzeige.probe = .fehler(Self.text(error))
            zustand.meldeFehler(.probe, Self.text(error))
            log("einrichtung probe-fehler")
        }
    }

    // MARK: Navigation

    /// Darf der Nutzer vom aktuellen Schritt aus weiter? (Erledigt in der Wirklichkeit, auch wenn der Schritt gerade noch einmal gezeigt wird.)
    public func kannWeiter(_ s: EinrichtungsSchritt) -> Bool {
        switch s {
        case .git: return anzeige.git?.istVorhanden ?? false
        case .vault: return anzeige.vault != nil
        case .github:
            switch anzeige.github {
            case .angemeldet, .nichtVerfuegbar: return true
            default: return false
            }
        case .sicherung: return anzeige.sicherung.istVerbunden
        case .ki: return anzeige.kis.contains { $0.istVerbunden }
        case .probe:
            switch anzeige.probe {
            case .ok, .leer: return true
            default: return false
            }
        }
    }

    public func weiter() async {
        guard let s = zustand.aktuell, kannWeiter(s) else { return }
        zustand.meldeErledigt(s)
        await fortfahren()
    }

    public func ueberspringe() async {
        guard let s = zustand.aktuell else { return }
        if s == .github { githubLauf += 1 }
        zustand.ueberspringe(s)
        await fortfahren()
    }

    /// Einen Schritt zurück (Schritte, die in dieser Version oder für diesen Vault entfallen, werden dabei übergangen).
    public func zurueck() async {
        guard var s = zustand.vorherigerSchritt else { return }
        let alle = EinrichtungsSchritt.allCases
        while entfaellt(s) {
            // Dieser Schritt entfällt: einen weiter zurück.
            guard let i = alle.firstIndex(of: s), i > 0 else { return }
            s = alle[i - 1]
        }
        if s == .github { githubLauf += 1 }
        guard zustand.geheZu(s) else { return }
        // KI und Probe laufen beim erneuten Betreten wieder; git, Vault und GitHub zeigen den Stand, ohne gleich weiterzuspringen.
        if s.ausWirklichkeit { geprueft.insert(s) } else { geprueft.remove(s) }
        await fortfahren()
    }

    /// Schritte, die es hier nicht gibt: GitHub und Sicherung ohne eingerichtete Anmeldung, Sicherung für einen Ordner ohne git.
    private func entfaellt(_ s: EinrichtungsSchritt) -> Bool {
        switch s {
        case .github: return anzeige.github == .nichtVerfuegbar
        case .sicherung: return anzeige.github == .nichtVerfuegbar || anzeige.vault?.git == false
        default: return false
        }
    }

    /// „Später“: der Assistent erscheint nicht mehr von selbst (das Menü bietet ihn weiter an).
    public func spaeter() {
        automatischAus = true
        beendeWarten()
        sichere()
    }

    /// Fenster zu: Stand sichern, laufendes Warten beenden.
    public func schliesse() {
        beendeWarten()
        sichere()
    }

    private func beendeWarten() {
        githubLauf += 1
        gitWarteAufgabe?.cancel()
    }

    // MARK: Hilfen

    private func sichere() {
        guard let speicher else { return }
        do { try speicher.speichere(zustand.datei(abgeschlossen: abgeschlossen, automatischAus: automatischAus, herkunft: herkunft)) } catch {
            log("einrichtung speichern-fehlgeschlagen \(error.localizedDescription)")
        }
    }

    private func melde() { beiAenderung(zustand, anzeige) }

    static func text(_ fehler: Error) -> String {
        if let e = fehler as? EinrichtungsFehler { return e.meldung }
        return "Das hat nicht geklappt: \(fehler.localizedDescription)"
    }
}
