import AppKit
import SwiftUI
import BrainCore

/// Zustand und Abläufe der App (App-Spec §9.1/§10, Studio-v2-Spec §2): Laufzeit installieren, Studio immer öffnen, den
/// aktiven Vault aus `<support>/vaults.json` lesen (Rückfall `config.json`), Status zeigen, Fenster öffnen. Die Vault-Liste
/// führt das Backend (Werkstatt); die App liest sie nur und schreibt nie ins Brain. Alle Kern-Aufrufe (`brain status`, Rückfragen,
/// Ansicht-Brücke der Übersicht) gehen über den gebündelten, per Manifest geprüften Kern (`pfade.kern` = `bin/kern`) mit
/// ausdrücklichem `--vault`; im Vault liegen nur Daten, ein altes `.tools/` dort wird nie ausgeführt. Ist der Kern nicht bereit,
/// zeigt die App eine klare Meldung (`kernBereitschaft`) statt irgendwohin auszuweichen (Kern-Umzug P4).
@MainActor
final class AppZustand: ObservableObject {
    @Published private(set) var anzeige = StatusAnzeige.fuer(nil, fehler: "Wird vorbereitet …")
    @Published private(set) var status: BrainStatus?
    /// Stand der Zuführungen aus `<vault>/.logs/zufuehrungen.json` (Wächter des Kits, FBL-93/94). Reine Datei, kein Kit-Code: gelesen
    /// wird sie bei jedem Status-Abruf, auch ohne Vertrauen. Fehlt sie, ist das neutral.
    @Published private(set) var zufuehrungen = ZufuehrungenStand.keine
    /// Aktiver Vault (nil = keiner gewählt; das Studio zeigt dann „Willkommen“).
    @Published private(set) var vault: URL?
    @Published private(set) var vaultName: String?
    /// Ist der aktive Vault ein Brain im Sinne des Kerns (`brain.config.json`)? Nur dann gibt es Kern-Status, Übersicht und Rückfragen.
    @Published private(set) var kitVorhanden = false
    /// Vertraut Kortex dem aktiven Vault? Nur zum Anzeigen im Menü („Nur ansehen“); gelesen aus dem Merker der Werkstatt, nie geschrieben.
    @Published private(set) var vertrauen: VaultVertrauen?

    let pfade: AppPfade
    let log: AppLog
    private let argumente = StartArgumente.lies(CommandLine.arguments)
    /// Was die Menüleiste zeigt: der Kit-Status, bei stillstehender Zuführung als ⚠ (nur dort, wo sonst ✓ stünde).
    var menueAnzeige: StatusAnzeige { anzeige.mit(zufuehrungen: zufuehrungen) }
    /// Statuszeilen im Kopf des Menüs: Vault mit Namen, Zustand, Vertrauen („Nur ansehen“), offene Zahlen, Warnungen (Darstellung in `MenueStatus`).
    var menueZeilen: [MenueZeile] {
        MenueStatus.zeilen(vaultName: vaultName, anzeige: menueAnzeige, vertrauen: vertrauen, zahlen: status?.zahlen,
                           entwicklerVault: status?.quellVault == true, kernMeldung: kernBereitschaft.meldung,
                           zufuehrungsZeilen: zufuehrungen.menueZeilen, aufgaben: status?.aufgaben)
    }
    /// Studio (Editor, Werkstatt-Brücke) und Übersicht (Kit-Ansicht, Kit-Brücke).
    private let studio: FensterSteuerung
    private let uebersicht: FensterSteuerung
    private var node: URL?
    private var brainNode = ""
    private var rueckfragenFenster: NSWindow?
    private var rueckfragenModell: RueckfragenModell?
    /// Assistent „Kortex einrichten“: Fenster, Modell und seine eigene Werkstatt-Verbindung (ohne Vault, liest vaults.json).
    private var assistentFenster: NSWindow?
    private var assistentModell: EinrichtungsModell?
    private var assistentBruecke: BrueckenVerbindung?
    /// Beobachter für das Schließen des Assistenten-Fensters; wird beim Schließen wieder abgemeldet.
    private var assistentBeobachter: NSObjectProtocol?
    /// Hat der Assistent beim Start das Studio verdrängt? Dann öffnet es sich, wenn er zugeht.
    private var assistentVerdraengtStudio = false
    /// Stand der Laufzeit-Prüfung beim Start (Prüfsumme der Node-Datei, rund 120 MB, kann dauern). Erst nach abgeschlossener
    /// Prüfung urteilt die App; vorher heißt es „wird vorbereitet“, nie „bitte neu installieren“.
    private enum LaufzeitStand { case wirdVorbereitet, bereit, fehlgeschlagen }
    private var laufzeitStand = LaufzeitStand.wirdVorbereitet
    /// Ergebnis des einmaligen Umzugs `Application Support/Brain` → `Kortex` (beim Start gelesen, danach protokolliert/angezeigt).
    private var supportMigration = SupportMigration.Ergebnis.nichtNoetig
    private var supportAltBasis: URL?
    /// Stand des Kerns (Brain-Logik im App-Paket) nach dem Start: fehlt der Ordner im Paket, ist er „nicht enthalten“ — kein Fehler.
    @Published private(set) var kernStatus = Laufzeit.KernStatus.nichtEnthalten
    #if DEBUG
    /// Nur Entwicklung (`swift run`, `BRAIN_APP_KERN`=absoluter Ordner, zusammen mit `BRAIN_APP_NODE`): ein Kern-Ordner statt `bin/kern`.
    private var kernEntwicklung: URL?
    #endif
    /// Der Pfad, über den die App den Kern aufruft: der stabile `bin/kern` (in Debug-Builds optional `BRAIN_APP_KERN`).
    var kernPfad: URL {
        #if DEBUG
        if let k = kernEntwicklung { return k }
        #endif
        return pfade.kern
    }
    /// Darf die App den Kern benutzen? Sonst steht in `meldung`, was der Nutzer tun kann.
    var kernBereitschaft: KernBereitschaft { KernBereitschaft.pruefe(kernStatus, kern: kernPfad) }
    /// Rückfall-Fenster, falls die Laufzeit fehlt (sonst gibt es keinen Einrichtungsdialog mehr).
    private var hinweisFenster: NSWindow?
    private var taktgeber: Task<Void, Never>?
    private var statusLauf = 0
    /// `--vault` (Entwicklung, Rauchtest) gilt, bis die Oberfläche einen Vault wechselt; danach gilt vaults.json.
    private var vaultVorgabe: URL?

    /// Vorschau „wie frisch installiert“ (`--vorschau <Ordner>`): nil im normalen Start.
    let vorschau: VorschauModus?

    init() {
        // Vorschau zuerst und fail-closed: ungültiger Ordner, fehlende Umlenkung des Benutzerordners oder die echte Bundle-ID beenden
        // die App, bevor sie irgendwo etwas liest oder schreibt. Danach zeigt alles (Support, Logs, Kindprozesse) in den Vorschau-Ordner.
        var v: VorschauModus?
        if let fehler = argumente.vorschauFehler { Self.vorschauAbbruch([fehler]) }
        if let modus = argumente.vorschau {
            // Erst prüfen, dann anlegen: nur setenv, keine Dateien.
            modus.inProzessSetzen()
            let probleme = modus.schutzFehlerImProzess()
            if !probleme.isEmpty { Self.vorschauAbbruch(probleme + ["Bitte scripts/vorschau.sh benutzen."]) }
            do { try modus.vorbereiten() } catch { Self.vorschauAbbruch(["Der Vorschau-Ordner ließ sich nicht vorbereiten: \(error.localizedDescription)"]) }
            v = modus
        }
        vorschau = v
        let p = v?.pfade ?? AppPfade.standard()
        // Vor allem anderen (auch vor dem Log, das den Ordner anlegt): Brain → Kortex einmalig umbenennen. Mit
        // `BRAIN_APP_SUPPORT` (Tests, Vorschau) gibt es keinen alten Ordner — dort wird nie migriert.
        if v == nil, let alt = AppPfade.altBasis() {
            supportMigration = SupportMigration.migriere(alt: alt, neu: p.basis)
            supportAltBasis = alt
        }
        let l = AppLog(pfade: p)
        pfade = p
        log = l
        studio = FensterSteuerung(log: l, oberflaeche: .studio)
        uebersicht = FensterSteuerung(log: l, oberflaeche: .app)
        vaultVorgabe = argumente.vault
    }

    private static func vorschauAbbruch(_ gruende: [String]) -> Never {
        let text = (["Kortex-Vorschau abgebrochen — es wurde nichts verändert:"] + gruende.map { "  - " + $0 }).joined(separator: "\n") + "\n"
        FileHandle.standardError.write(Data(text.utf8))
        exit(2)
    }

    /// Werkstatt-Skript im App-Paket (`BRAIN_APP_WERKSTATT` lenkt nur in Debug-Builds für Entwicklung um).
    private var werkstattSkript: URL? {
        #if DEBUG
        if let dev = ProcessInfo.processInfo.environment["BRAIN_APP_WERKSTATT"], dev.hasPrefix("/") { return URL(fileURLWithPath: dev) }
        #endif
        return Bundle.main.resourceURL?.appendingPathComponent("werkstatt/werkstatt.mjs")
    }

    var istStudioOffen: Bool { studio.istOffen }

    private var umgebung: [String: String] {
        ["BRAIN_NODE": brainNode].merging(vorschau?.kindVorgaben ?? [:]) { _, neu in neu }
    }
    /// Die Werkstatt liest und schreibt `vaults.json` und den Vertrauens-Merker (`vertrauen.json`, Workspace-Trust je Vault; der Kern liest
    /// ihn nur) im echten Application-Support-Ordner der App.
    /// Die öffentliche GitHub-Client-ID (Info.plist `KortexGitHubClientID`) geht per Umgebung an die Werkstatt; die ID ist öffentlich (kein Client-Secret); leer/fehlt = Anmeldung ausgeblendet.
    private var werkstattUmgebung: [String: String] {
        // BRAIN_MCP_NODE: der stabile Node-Pfad (<support>/bin/node), den die Werkstatt in neue MCP-Einträge schreibt.
        // KORTEX_KERN_PFAD: der stabile Kern-Pfad (<support>/bin/kern) für Gesundheit/Rückfragen der Werkstatt und die neuen MCP-Einträge.
        var env = umgebung.merging(["BRAIN_APP_SUPPORT": pfade.basis.path, "BRAIN_MCP_NODE": pfade.node.path,
                                    "KORTEX_KERN_PFAD": kernPfad.path]) { _, neu in neu }
        if let id = Bundle.main.object(forInfoDictionaryKey: "KortexGitHubClientID") as? String, !id.isEmpty { env["KORTEX_GITHUB_CLIENT_ID"] = id }
        return env
    }

    /// Menü „Übersicht“: der Vault ist ein Brain UND der Kern ist bereit.
    var uebersichtMoeglich: Bool { kitVorhanden && kernBereitschaft.istBereit }
    /// „Vault umstellen …“ im Menü (P7c): nur bei gemeldeten Altlasten; die Umstellung selbst läuft im Studio (`StudioBefehl.umstellung`).
    var umstellungAngeboten: Bool { MenueStatus.bietetUmstellungAn(hatVault: vault != nil, status: status) }

    private static func gleich(_ a: URL?, _ b: URL?) -> Bool { a?.standardizedFileURL.path == b?.standardizedFileURL.path }

    /// Vor jedem Start der Kern-Brücke (auch nach einem Absturz): ist der Kern noch bereit (Link und Brücke da)? Sonst startet nichts.
    private func kernStartPruefung() -> @Sendable () async -> Bool {
        let kern = kernPfad
        let log = self.log
        return {
            let da = FileManager.default.fileExists(atPath: kern.appendingPathComponent("ansicht/bruecke.mjs").path)
            if !da { log.schreibe("kern-start-abgelehnt \(kern.path)") }
            return da
        }
    }

    /// Schließt die Übersicht, falls sie offen ist — ihre Brücke läuft nur mit bereitem Kern und einem Brain-Vault.
    private func schliesseUebersicht(grund: String) {
        guard uebersicht.istOffen else { return }
        uebersicht.schliesse()
        log.schreibe("uebersicht-geschlossen \(grund)")
    }

    func starte() async {
        signal(SIGPIPE, SIG_IGN)
        try? pfade.legeAn()
        // Nach Aktionen im Fenster (Vorschlag übernehmen, Konflikt entscheiden) den Menüstatus auffrischen.
        for f in [studio, uebersicht] {
            f.beiGeschlossen = { [weak self] in Task { await self?.aktualisiere() } }
            f.beiAktion = { [weak self] aktion in await self?.fuehreAus(aktion) }
            f.aktuellerVault = { [weak self] in self?.vaultFrisch() }
        }
        log.schreibe("start")
        log.schreibe(supportMigration.protokollZeile)
        if let alt = supportAltBasis,
           let text = SupportMigration.anzuzeigenderHinweis(supportMigration, alt: alt, neu: pfade.basis, merker: pfade.ordnerHinweisMerker) {
            zeigeHinweis(titel: "Kortex: Hinweis zum Ordner „Brain“", text: text)
        }
        // Testschalter (Selbstfoto): abgelehnte Werte ins Log, Erscheinungsbild gilt gleich für die ganze App.
        for hinweis in argumente.hinweise { log.schreibe(hinweis) }
        if let b = argumente.testErscheinungsbild {
            NSApp.appearance = NSAppearance(named: b == .dunkel ? .darkAqua : .aqua)
            log.schreibe("test-erscheinungsbild \(b.rawValue)")
        }
        do {
            let ergebnis = try await laufzeit()
            node = ergebnis.node
            kernStatus = ergebnis.kern
            log.schreibe("kern \(ergebnis.kern)")
            if let m = kernBereitschaft.meldung { log.schreibe("kern-nicht-bereit \(m)") }
            for meldung in ergebnis.meldungen { log.schreibe("laufzeit-fehler \(meldung)") }
            if !ergebnis.meldungen.isEmpty {
                zeigeHinweis(titel: "Kortex: Laufzeit unvollständig", text: ergebnis.meldungen.joined(separator: "\n\n"))
            }
            laufzeitStand = .bereit
        } catch {
            laufzeitStand = .fehlgeschlagen
            anzeige = .problem("Die mitgelieferte Laufzeit fehlt oder ist beschädigt — bitte die App neu installieren.")
            log.schreibe("laufzeit-fehler \(error)")
            zeigeEinrichtung()
            return
        }
        // Vorschau: nicht die Login-Shell des echten Nutzers (liest dessen Dotfiles) nach node fragen — das App-Node genügt.
        brainNode = vorschau != nil ? pfade.node.path : ((await TerminalNode.finde())?.path ?? pfade.node.path)
        if let v = vorschau { log.schreibe("vorschau \(v.ordner.path) mit-ki=\(v.mitKi) ohne-git=\(v.ohneGit)") }
        // nur lesend, löst nie Apples Installationsdialog aus; in eigener Aufgabe, damit ein hängendes xcode-select den Start nicht aufhält
        let startLog = log
        let gitPruefer = vorschau?.gitPruefer() ?? GitPruefer()
        Task { startLog.schreibe("git \(await gitPruefer.pruefe().logText)") }
        pruefeVaultWechsel()
        log.schreibe(vault.map { "vault \($0.path)" } ?? "kein-vault")
        taktgeber = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(15 * 60))
                await self?.aktualisiere()
            }
        }
        // Das Studio öffnet immer — auch ohne Vault (dann zeigt es „Willkommen“); der Status wird danach gelesen. Nur beim ersten
        // Start auf einem Mac ohne Vault (oder nach einem abgebrochenen Assistenten) kommt zuerst der Assistent „Kortex einrichten“
        // und das Studio nach ihm. Testläufe (Rauchtest, Selbstfoto, `--vault`) zeigen ihn nie.
        if argumente.assistentDarfErscheinen, EinrichtungsSpeicher(pfade: pfade).sollErscheinen(hatVault: vault != nil) {
            assistentVerdraengtStudio = true
            zeigeAssistent(wiederholung: false)
        } else {
            oeffneStudio()
        }
        if argumente.fensterOeffnen { Task { await oeffneFenster() } }
        if let s = argumente.schliessenNach { Task { try? await Task.sleep(for: s); studio.schliesse(); uebersicht.schliesse() } }
        if let s = argumente.beendenNach {
            // Per Timer statt Task: Bei offenem Studio wartet `terminate` in einer eigenen Schleife auf die Antwort der
            // Oberfläche (`applicationShouldTerminate` → terminateLater). Aus einem Task heraus (Block der Haupt-Warteschlange)
            // käme diese Antwort nie an — die App bliebe hängen. ⌘Q aus dem Menü hat das Problem nicht.
            let timer = Timer(timeInterval: Double(s.components.seconds), repeats: false) { _ in
                MainActor.assumeIsolated { NSApp.terminate(nil) }
            }
            RunLoop.main.add(timer, forMode: .common)
        }
        await aktualisiere()
    }

    /// Die Prüfsumme der Node-Datei (rund 120 MB) wird abseits des Main-Threads gerechnet.
    private func laufzeit() async throws -> Laufzeit.Ergebnis {
        #if DEBUG
        if let dev = ProcessInfo.processInfo.environment["BRAIN_APP_NODE"], dev.hasPrefix("/") {
            if let k = ProcessInfo.processInfo.environment["BRAIN_APP_KERN"], k.hasPrefix("/") {
                kernEntwicklung = URL(fileURLWithPath: k)
                return Laufzeit.Ergebnis(node: URL(fileURLWithPath: dev), kern: .bereit(version: "dev", ordner: URL(fileURLWithPath: k)),
                                         starter: pfade.starter, starterFehler: nil)
            }
            return Laufzeit.Ergebnis(node: URL(fileURLWithPath: dev), kern: .nichtEnthalten, starter: pfade.starter, starterFehler: nil)
        }
        #endif
        guard let ressourcen = Bundle.main.resourceURL else { throw LaufzeitFehler.manifestFehlt }
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        let laufzeit = Laufzeit(ressourcen: ressourcen, appVersion: version, pfade: pfade)
        return try await Task.detached { try laufzeit.installiere() }.value
    }

    /// Sichtbarer Hinweis (Fehler dürfen nie still bleiben). Als eigener Task, damit der Start nicht am Fenster hängt.
    private func zeigeHinweis(titel: String, text: String) {
        log.schreibe("hinweis \(titel)")
        guard !argumente.fluechtig else { return } // Testläufe: nur ins Log, kein Modalfenster
        Task { @MainActor in
            let alert = NSAlert()
            alert.alertStyle = .warning
            alert.messageText = titel
            alert.informativeText = text
            alert.addButton(withTitle: "OK")
            NSApp.activate()
            alert.runModal()
        }
    }

    // MARK: Aktiver Vault

    /// Der aktive Vault jetzt: `--vault` (nur Entwicklung/Rauchtest), sonst `aktiv` aus vaults.json, sonst config.json.
    /// Ist vaults.json da, aber gerade nicht lesbar (das Backend schreibt sie eben), bleibt der bisherige Vault — kein
    /// kurzer Sprung auf den Vault aus config.json.
    private func vaultFrisch() -> URL? {
        if let vorgabe = vaultVorgabe { return vorgabe }
        if vault != nil, FileManager.default.fileExists(atPath: pfade.vaultListe.path), VaultListe.lade(pfade) == nil { return vault }
        return VaultListe.aktiverVault(pfade)
    }

    /// Liest den aktiven Vault neu. Wechselt er, gehört die offene Übersicht (Kern-Brücke) zum alten Vault und wird
    /// geschlossen; der Status wird zurückgesetzt. Gibt zurück, ob sich der Vault geändert hat.
    @discardableResult
    private func pruefeVaultWechsel() -> Bool {
        let neu = vaultFrisch()
        kitVorhanden = neu.map { VaultAuswahl.pruefe($0) == .ok } ?? false
        vaultName = neu.map { VaultListe.lade(pfade)?.anzeigename(fuer: $0) ?? $0.lastPathComponent }
        let alt = vault
        guard alt?.standardizedFileURL.path != neu?.standardizedFileURL.path else { return false }
        vault = neu
        status = nil
        vertrauen = nil
        anzeige = neu == nil ? .keinVault : StatusAnzeige.fuer(nil, fehler: "Wird geprüft …")
        if alt != nil { uebersicht.schliesse() } // die offene Übersicht gehört zum alten Vault
        log.schreibe("vault-wechsel \(neu?.path ?? "keiner")")
        return true
    }

    /// Aktion `vault-gewechselt`: das Backend hat vaults.json geändert — ab jetzt gilt sie wieder (nicht mehr `--vault`).
    private func vaultGewechselt() {
        vaultVorgabe = nil
        // Eine abgestürzte Werkstatt startet ab jetzt ohne `--vault` neu und liest vaults.json (nicht den alten Vault).
        studio.vaultArgumentEntfernen()
        pruefeVaultWechsel()
        Task { await aktualisiere() }
    }

    /// Status-Abruf: Vault neu lesen und `brain status` des gebündelten Kerns lesen (mit `--vault`). Ist der Kern nicht bereit, zeigt die
    /// Menüleiste die Meldung dazu (nie ein Ausweichen auf Code im Vault); fehlt dem Ordner `brain.config.json`, ist er „nur Studio“.
    /// Gerufen wird er beim Start, im Takt, aus dem Menü, nach jedem Schließen eines Fensters und auf `vault-gewechselt` und
    /// `vertrauen-geaendert` der Oberfläche.
    func aktualisiere() async {
        guard let node else { return }
        pruefeVaultWechsel()
        // Nur das Ergebnis des neuesten Laufs für den aktuellen Ordner gilt (langsame ältere Läufe werden verworfen).
        statusLauf += 1
        let lauf = statusLauf
        guard let vault else {
            status = nil
            zufuehrungen = .keine
            vertrauen = nil
            anzeige = .keinVault
            return
        }
        // Reine Dateien (kein Prozess): bei jedem Abruf frisch lesen.
        zufuehrungen = ZufuehrungenStand.lade(vault: vault)
        vertrauen = VaultVertrauen.lade(vault: vault, support: pfade.basis)
        switch VaultAuswahl.pruefe(vault) {
        case .fehlt:
            status = nil
            anzeige = .problem("Vault-Ordner nicht gefunden")
            schliesseUebersicht(grund: "vault-fehlt")
            return
        case .keinBrain:
            status = nil
            anzeige = .ohneKit
            log.schreibe("status ohne-konfiguration")
            schliesseUebersicht(grund: "kein-brain")
            return
        case .ok:
            break
        }
        if case .nichtBereit(let meldung) = kernBereitschaft {
            status = nil
            anzeige = .kernNichtBereit(meldung)
            log.schreibe("status kern-nicht-bereit")
            schliesseUebersicht(grund: "kern-nicht-bereit")
            return
        }
        let ergebnis: Result<BrainStatus, Error>
        do { ergebnis = .success(try await BrainBefehl(node: node, kern: kernPfad, vault: vault, umgebung: umgebung).status()) }
        catch { ergebnis = .failure(error) }
        guard lauf == statusLauf, Self.gleich(self.vault, vault) else { return }
        switch ergebnis {
        case .success(let s):
            status = s
            anzeige = .fuer(s)
            log.schreibe("status \(s.zustand.rawValue)")
        case .failure(let fehler):
            status = nil
            anzeige = .fuer(nil, fehler: "Status gerade nicht abrufbar")
            log.schreibe("status-fehler \(fehler)")
        }
    }

    // MARK: Fenster

    /// Was `oeffneFenster` ergeben hat — die Aktion `ansicht` meldet es der Seite als `grund`.
    enum UebersichtErgebnis: Equatable {
        case geoeffnet
        /// Der Ordner ist kein Brain (`brain.config.json` fehlt) oder es ist kein Vault gewählt: Grund `kein-kit`.
        case keinKit
        /// Der gebündelte Kern ist nicht bereit: Grund `kern-nicht-bereit`.
        case kernNichtBereit
    }

    /// Übersicht = Ansicht des gebündelten Kerns (3D/Karten); braucht einen Brain-Vault (`brain.config.json`) und einen bereiten
    /// Kern. Die Brücke läuft aus `bin/kern`, nie aus dem Vault; vor jedem Start prüft `kernStartPruefung`, ob der Kern noch da ist.
    @discardableResult
    func oeffneFenster() async -> UebersichtErgebnis {
        guard let node, let vault = vaultFrisch(), VaultAuswahl.pruefe(vault) == .ok else { return .keinKit }
        guard kernBereitschaft.istBereit else {
            log.schreibe("uebersicht-abgelehnt kern-nicht-bereit")
            return .kernNichtBereit
        }
        uebersicht.oeffne(node: node, vault: vault, kern: kernPfad, umgebung: umgebung, fluechtig: argumente.fluechtig,
                          vorschau: vorschau != nil, vorStart: kernStartPruefung())
        return .geoeffnet
    }

    /// Das Studio öffnet immer. Ohne `--vault` startet die Werkstatt ohne Vault-Argument und liest vaults.json selbst —
    /// so bleibt der Vault auch nach einem Neustart der Werkstatt der zuletzt in der Oberfläche gewählte.
    func oeffneStudio() {
        guard let node else {
            // Erst nach abgeschlossener Prüfung urteilen: Solange die mitgelieferte Laufzeit noch vorbereitet wird, öffnet `starte()`
            // das Studio von selbst, sobald sie bereit ist — ein Klick (Dock, Menü) in dieser Zeit ist kein Grund zur Neuinstallation.
            if laufzeitStand == .fehlgeschlagen { zeigeEinrichtung() }
            else { log.schreibe("studio-wartet laufzeit-wird-vorbereitet") }
            return
        }
        studio.oeffne(node: node, vault: vaultVorgabe, skript: werkstattSkript, umgebung: werkstattUmgebung, arbeitsordner: pfade.basis,
                      test: argumente.studioTestlauf ? argumente : nil, fluechtig: argumente.fluechtig, vorschau: vorschau != nil)
    }

    /// Menübefehl (⌘N, ⌘⇧M, Vault …, Gehe zu …) an die Studio-Oberfläche; öffnet das Studio, wenn es zu ist.
    func sende(_ befehl: StudioBefehl) {
        if !studio.istOffen { oeffneStudio() }
        // Noch nicht offen (die Laufzeit wird vorbereitet): der Befehl hat keinen Empfänger — nicht still verschwinden lassen.
        guard studio.istOffen else { log.schreibe("befehl-verworfen \(befehl.rawValue) studio-nicht-offen"); return }
        studio.sende(befehl)
    }

    /// Geprüfte Aktion aus dem Nachrichtenkanal `aktion` (Prüfung in `AppAktion`); der Rückgabewert geht als Antwort an die Seite.
    private func fuehreAus(_ aktion: AppAktion) async -> Any? {
        let ok: [String: Any] = ["ok": true]
        switch aktion {
        case .ansicht:
            log.schreibe("aktion ansicht")
            switch await oeffneFenster() {
            case .geoeffnet: return ok
            case .keinKit: return ["ok": false, "grund": "kein-kit"] as [String: Any]
            case .kernNichtBereit: return ["ok": false, "grund": "kern-nicht-bereit"] as [String: Any]
            }
        case .ordnerZeigen(let url):
            log.schreibe("aktion ordner-zeigen")
            NSWorkspace.shared.activateFileViewerSelecting([url])
            return ok
        case .extern(let url):
            log.schreibe("aktion extern")
            NSWorkspace.shared.open(url)
            return ok
        case .ordnerWaehlen(let titel, let vorschlag):
            log.schreibe("aktion ordner-waehlen")
            guard let url = await studio.waehleOrdner(titel: titel, vorschlag: vorschlag, startort: vorschau?.home) else { return nil }
            return ["pfad": url.path]
        case .vaultGewechselt:
            log.schreibe("aktion vault-gewechselt")
            vaultGewechselt()
            return ok
        case .vertrauenGeaendert:
            // Das Backend hat das Vertrauen in den Vault geändert (Workspace-Trust): Der Kern arbeitet ohne Vertrauen ohne git, darum den
            // Status neu lesen. Die Antwort wartet nicht auf `brain status`.
            log.schreibe("aktion vertrauen-geaendert")
            Task { await aktualisiere() }
            return ok
        case .statusAuffrischen:
            // Live-Aktualisierung: im Vault hat sich etwas geändert (Aufgaben, Posteingang …). Bewusst ohne Log: kommt bei jeder Änderung.
            planeStatusAuffrischung()
            return ok
        case .titel(let text):
            // Bewusst ohne Log: Die Oberfläche meldet den Titel bei jeder Notiz (Notiztitel gehören nicht ins Protokoll).
            studio.setzeTitel(text)
            return ok
        case .fehler(let text, let ort):
            // JavaScript-Fehler der Studio-Oberfläche (Fehlerhaken): ohne Hinweis darauf bliebe ein weißes Fenster stumm.
            log.schreibe("js-fehler \(ort) \(text)")
            return ok
        }
    }

    /// Live-Aktualisierung: Meldungen des Studios („im Vault hat sich etwas geändert“) bündeln und drosseln, dann den Status (Zähler der Menüleiste) neu lesen.
    private var auffrischung = StatusAuffrischung()
    private func planeStatusAuffrischung() {
        guard let wann = auffrischung.anfordern(jetzt: Date()) else { return } // ein Lauf ist schon geplant: er liest ohnehin den neuesten Stand
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(max(0, wann.timeIntervalSinceNow)))
            guard let self else { return }
            self.auffrischung.gelaufen(jetzt: Date())
            await self.aktualisiere()
        }
    }

    /// Offene Rückfragen laut letztem Status (kein eigenes Polling); nil = unbekannt oder älteres Kit.
    var rueckfragenAnzahl: Int? { status?.zahlen.rueckfragen }

    /// Öffnet das Rückfragen-Fenster (`brain rueckfragen` des gebündelten Kerns, `--vault` ausdrücklich). Kern nicht bereit: Hinweis
    /// mit der Meldung, das Fenster öffnet nicht.
    func oeffneRueckfragen() {
        guard let vault = vaultFrisch(), node != nil, VaultAuswahl.pruefe(vault) == .ok else { zeigeEinrichtung(); return }
        guard kernBereitschaft.istBereit else {
            log.schreibe("rueckfragen-abgelehnt kern-nicht-bereit")
            zeigeHinweis(titel: "Kortex: Kern nicht bereit", text: kernBereitschaft.meldung ?? "")
            return
        }
        zeigeRueckfragenFenster(vault: vault)
    }

    private func zeigeRueckfragenFenster(vault: URL) {
        guard let node else { return }
        if let rueckfragenFenster {
            rueckfragenFenster.makeKeyAndOrderFront(nil)
            NSApp.activate()
            return
        }
        let modell = RueckfragenModell(befehl: BrainBefehl(node: node, kern: kernPfad, vault: vault, umgebung: umgebung),
                                       tageslauf: status?.tageslauf, log: log) { [weak self] in
            Task { await self?.aktualisiere() }
        }
        let w = NSWindow(contentViewController: NSHostingController(rootView: RueckfragenAnsicht(modell: modell).kortexAkzent()))
        w.title = "Rückfragen"
        w.styleMask = [.titled, .closable]
        w.isReleasedWhenClosed = false
        w.center()
        rueckfragenModell = modell
        rueckfragenFenster = w
        NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: w, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                let m = self.rueckfragenModell
                self.rueckfragenFenster = nil
                self.rueckfragenModell = nil
                Task { await m?.schliesse() }
            }
        }
        w.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }

    func zeigeOrdner() {
        if let vault = vaultFrisch() { NSWorkspace.shared.activateFileViewerSelecting([vault]) }
    }

    func zeigeProtokoll() {
        NSWorkspace.shared.open(pfade.logs)
    }

    /// Rückfall: nur wenn das Studio nicht starten kann, weil die mitgelieferte Laufzeit fehlt.
    func zeigeEinrichtung() {
        if let hinweisFenster {
            hinweisFenster.makeKeyAndOrderFront(nil)
            NSApp.activate()
            return
        }
        let w = NSWindow(contentViewController: NSHostingController(rootView: EinrichtungsAnsicht(zustand: self).kortexAkzent()))
        w.title = "Kortex kann nicht starten"
        w.styleMask = [.titled, .closable]
        w.isReleasedWhenClosed = false
        w.center()
        hinweisFenster = w
        w.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }

    // MARK: Assistent „Kortex einrichten“

    /// Zeigt den Assistenten (beim ersten Start von selbst, sonst über das Menü). Er hat eine eigene Werkstatt-Verbindung ohne
    /// Vault: sie führt dieselben Routen aus wie das Studio und liest/schreibt dieselbe `vaults.json`. Ein offenes Fenster kommt nur nach vorn.
    func zeigeAssistent(wiederholung: Bool = true) {
        if let assistentFenster {
            assistentFenster.makeKeyAndOrderFront(nil)
            NSApp.activate()
            return
        }
        guard let node, let skript = werkstattSkript else {
            // Ohne Laufzeit gibt es nichts, womit der Assistent arbeiten könnte.
            log.schreibe("assistent-nicht-moeglich laufzeit-fehlt")
            zeigeEinrichtung()
            return
        }
        let bruecke = BrueckenVerbindung(node: node, vault: nil, skript: skript, umgebung: werkstattUmgebung, arbeitsordner: pfade.basis)
        let dienste = WerkstattDienste(pfade: pfade, git: vorschau?.gitPruefer() ?? GitPruefer(),
                                       home: vorschau?.home ?? FileManager.default.homeDirectoryForCurrentUser) { methode, pfad, body in
            try await bruecke.anfrage(methode: methode, pfad: pfad, body: body)
        }
        let modell = EinrichtungsModell(dienste: dienste, speicher: EinrichtungsSpeicher(pfade: pfade), log: log, vorschau: vorschau)
        let vaultVorher = vaultFrisch()
        let w = NSWindow(contentViewController: NSHostingController(rootView: EinrichtungsAssistentAnsicht(modell: modell).kortexAkzent()))
        w.title = vorschau == nil ? "Kortex einrichten" : "Kortex einrichten — Vorschau"
        w.styleMask = [.titled, .closable]
        w.isReleasedWhenClosed = false
        w.center()
        assistentFenster = w
        assistentModell = modell
        assistentBruecke = bruecke
        modell.beiSchliessen = { [weak w] in w?.close() }
        modell.beiStudioOeffnen = { [weak w] in w?.close() }
        assistentBeobachter = NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: w, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.assistentGeschlossen(vaultVorher: vaultVorher) }
        }
        log.schreibe("assistent-offen wiederholung=\(wiederholung)")
        modell.starte(wiederholung: wiederholung)
        w.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }

    /// Der Assistent ist zu (fertig, „Später“, Fenster geschlossen oder App-Wechsel): Verbindung beenden, und das Studio muss den
    /// neuen Vault kennen — es hat seine Werkstatt mit dem alten Stand gestartet, also neu öffnen, wenn sich der Vault geändert hat.
    private func assistentGeschlossen(vaultVorher: URL?) {
        if let beobachter = assistentBeobachter { NotificationCenter.default.removeObserver(beobachter) }
        assistentBeobachter = nil
        let fertig = assistentModell?.istFertig ?? false
        assistentModell?.beende()
        let bruecke = assistentBruecke
        Task { await bruecke?.beende() }
        assistentFenster = nil
        assistentModell = nil
        assistentBruecke = nil
        let verdraengt = assistentVerdraengtStudio
        assistentVerdraengtStudio = false
        log.schreibe("assistent-zu fertig=\(fertig)")
        let geaendert = !Self.gleich(vaultVorher, vaultFrisch())
        if geaendert { vaultGewechselt() }
        Task {
            if geaendert, studio.istOffen {
                // Ungespeicherte Eingaben im Studio zuerst sichern lassen (wie bei ⌘Q); sagt der Nutzer „nein“, bleibt es offen.
                guard await studio.darfSchliessen() else { return }
                studio.schliesse()
                oeffneStudio()
            } else if !studio.istOffen, fertig || verdraengt {
                oeffneStudio()
            }
        }
    }

    /// Vor ⌘Q: das Studio sichert zuerst seine Eingaben (siehe `FensterSteuerung.darfSchliessen`).
    func darfBeenden() async -> Bool { await studio.darfSchliessen() }

    func beende() {
        vorschau?.raeumeDefaultsAuf() // nur die Einstellungen der Vorschau-Kennung; die echte App bleibt unberührt
        taktgeber?.cancel()
        studio.schliesse()
        uebersicht.schliesse()
        rueckfragenFenster?.close()
    }
}
