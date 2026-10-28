import AppKit
import SwiftUI
import BrainCore

/// Zustand und Abläufe der App (App-Spec §9.1/§10, Studio-v2-Spec §2): Laufzeit installieren, Studio immer öffnen, den
/// aktiven Vault aus `<support>/vaults.json` lesen (Rückfall `config.json`), Status zeigen, Fenster öffnen. Die Vault-Liste
/// führt das Backend (Werkstatt); die App liest sie nur und schreibt nie ins Brain. Code aus dem Vault (`brain status`, die
/// Kit-Brücke der Übersicht) läuft nur, wenn die Vertrauensprüfung (`KitVertrauen`, Spec §8) unmittelbar vorher „erlaubt“ sagt.
/// Gilt die Freigabe nicht mehr (Abgleich hat Kit-Code geändert, Vertrauen entzogen, Ordner oder Kit weg), schließt eine offene
/// Übersicht — bei einem technischen Prüffehler erst nach einer Wiederholung (`UebersichtRegel`).
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
    /// Hat der aktive Vault das Brain-Kit (`.tools/brain.mjs`)? Nur dann gibt es Kit-Status und die Übersicht.
    @Published private(set) var kitVorhanden = false
    /// Was die letzte Vertrauensprüfung für den aktiven Vault ergab: erlaubt, ausdrücklich nicht freigegeben oder die Prüfung
    /// selbst ist gescheitert. Bis zur ersten Prüfung und nach jedem Vault-Wechsel `.unbekannt`. Nur ein Anhaltspunkt für Menü und
    /// Anzeige — gestartet wird Kit-Code immer nach einer frischen Prüfung.
    @Published private(set) var kitStand = KitStand.unbekannt
    /// Hat der Nutzer dem aktiven Vault vertraut (letzte Prüfung `{"erlaubt":true}`)?
    var kitErlaubt: Bool { kitStand == .erlaubt }

    let pfade: AppPfade
    let log: AppLog
    private let argumente = StartArgumente.lies(CommandLine.arguments)
    /// Was die Menüleiste zeigt: der Kit-Status, bei stillstehender Zuführung als ⚠ (nur dort, wo sonst ✓ stünde).
    var menueAnzeige: StatusAnzeige { anzeige.mit(zufuehrungen: zufuehrungen) }
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
    /// Rückfall-Fenster, falls die Laufzeit fehlt (sonst gibt es keinen Einrichtungsdialog mehr).
    private var hinweisFenster: NSWindow?
    private var taktgeber: Task<Void, Never>?
    private var statusLauf = 0
    /// Die eine Wiederholung nach einem technischen Prüffehler (`UebersichtRegel.wiederholungsFrist`); höchstens eine wartet.
    private var pruefWiederholung: Task<Void, Never>?
    /// `--vault` (Entwicklung, Rauchtest) gilt, bis die Oberfläche einen Vault wechselt; danach gilt vaults.json.
    private var vaultVorgabe: URL?

    init() {
        let p = AppPfade.standard()
        let l = AppLog(pfade: p)
        pfade = p
        log = l
        studio = FensterSteuerung(log: l, oberflaeche: .studio)
        uebersicht = FensterSteuerung(log: l, oberflaeche: .app)
        vaultVorgabe = argumente.vault
    }

    /// Werkstatt-Skript im App-Paket (`BRAIN_APP_WERKSTATT` lenkt nur in Debug-Builds für Entwicklung um).
    private var werkstattSkript: URL? {
        #if DEBUG
        if let dev = ProcessInfo.processInfo.environment["BRAIN_APP_WERKSTATT"], dev.hasPrefix("/") { return URL(fileURLWithPath: dev) }
        #endif
        return Bundle.main.resourceURL?.appendingPathComponent("werkstatt/werkstatt.mjs")
    }

    var istStudioOffen: Bool { studio.istOffen }

    private var umgebung: [String: String] { ["BRAIN_NODE": brainNode] }
    /// Die Werkstatt liest und schreibt `vaults.json` und ihren Kit-Vertrauens-Merker (`vertrauen.json`) im echten
    /// Application-Support-Ordner der App.
    /// Die öffentliche GitHub-Client-ID (Info.plist `KortexGitHubClientID`) geht per Umgebung an die Werkstatt; die ID ist öffentlich (kein Client-Secret); leer/fehlt = Anmeldung ausgeblendet.
    private var werkstattUmgebung: [String: String] {
        var env = umgebung.merging(["BRAIN_APP_SUPPORT": pfade.basis.path]) { _, neu in neu }
        if let id = Bundle.main.object(forInfoDictionaryKey: "KortexGitHubClientID") as? String, !id.isEmpty { env["KORTEX_GITHUB_CLIENT_ID"] = id }
        return env
    }

    /// Die Vertrauensprüfung: gebündeltes Node + `werkstatt/vertrauen-pruefen.mjs` neben der Werkstatt, `BRAIN_APP_SUPPORT` wie bei
    /// der Werkstatt (derselbe Merker `vertrauen.json`). nil, solange die Laufzeit fehlt — dann gilt „nicht erlaubt“.
    private var vertrauen: KitVertrauen? {
        guard let node, let werkstatt = werkstattSkript else { return nil }
        return KitVertrauen(node: node, pruefSkript: KitVertrauen.pruefSkript(werkstatt: werkstatt),
                            umgebung: werkstattUmgebung, arbeitsordner: pfade.basis)
    }

    /// Menü „Übersicht“: Kit da UND Vault vertraut.
    var uebersichtMoeglich: Bool { kitVorhanden && kitErlaubt }

    private static func gleich(_ a: URL?, _ b: URL?) -> Bool { a?.standardizedFileURL.path == b?.standardizedFileURL.path }

    /// Vor jedem Start der Kit-Brücke (auch nach einem Absturz): frisch fragen, sonst läuft nichts aus dem Vault. Ein „nein“ geht
    /// auch an `startAbgelehnt`: Stand, Anzeige und die offene Übersicht dürfen nicht weiter so tun, als gälte die Freigabe.
    private func kitStartPruefung(_ vault: URL) -> @Sendable () async -> Bool {
        let vertrauen = self.vertrauen
        let log = self.log
        return { [weak self] in
            let erlaubnis: KitErlaubnis
            if let vertrauen { erlaubnis = await vertrauen.pruefe(vault: vault) } else { erlaubnis = .nein(.pruefungFehlt) }
            if !erlaubnis.istErlaubt {
                log.schreibe("kit-start-abgelehnt \(erlaubnis.logText)")
                Task { @MainActor in self?.startAbgelehnt(vault: vault, erlaubnis) }
            }
            return erlaubnis.istErlaubt
        }
    }

    /// Die Vorab-Prüfung vor einem Start der Kit-Brücke hat „nein“ gesagt (Absturz-Neustart, Seite lädt nach).
    private func startAbgelehnt(vault: URL, _ erlaubnis: KitErlaubnis) {
        guard Self.gleich(self.vault, vault), Self.gleich(vaultFrisch(), vault) else { return }
        uebernehme(erlaubnis)
    }

    // MARK: Ergebnis der Vertrauensprüfung

    /// Wendet das Ergebnis einer Vertrauensprüfung für den aktuellen Vault an (Studio-v2-Spec §8, Review SW-2/SW-5): Stand und Anzeige,
    /// die offene Übersicht (ihre Kit-Brücke ist Code aus dem Vault) und die eine Wiederholung nach einem technischen Fehler.
    /// „Nicht freigegeben“ schließt die Übersicht sofort. Ein technischer Fehler (Prüfung fehlt, Start, Zeit, Ausgabe) lässt sie
    /// zunächst offen, zeigt „Kit-Prüfung fehlgeschlagen“ — nie „bitte freigeben“ — und prüft nach `UebersichtRegel.wiederholungsFrist`
    /// noch einmal; scheitert auch die Wiederholung (`zweiterVersuch`), schließt die Übersicht (ohne Beleg gilt „nein“).
    /// Bei „erlaubt“ ändert sich nur der Stand: Status und Anzeige setzt der Aufrufer.
    private func uebernehme(_ erlaubnis: KitErlaubnis, zweiterVersuch: Bool = false) {
        kitStand = KitStand(erlaubnis)
        guard case .nein(let grund) = erlaubnis else {
            wiederholungAbbrechen()
            return
        }
        status = nil
        switch UebersichtRegel.folge(fuer: erlaubnis, zweiterVersuch: zweiterVersuch) {
        case .offenLassen:
            break
        case .schliessen:
            wiederholungAbbrechen()
            anzeige = grund.istTechnisch ? .kitPruefungFehlgeschlagen : .kitNichtErlaubt
            schliesseUebersicht(grund: grund.istTechnisch ? "pruefung-fehlgeschlagen" : "kit-nicht-erlaubt")
        case .spaeterNochmalPruefen:
            anzeige = .kitPruefungFehlgeschlagen
            planeWiederholung()
        }
    }

    /// Schließt die Übersicht, falls sie offen ist — ihre Kit-Brücke läuft nur mit Vertrauen, Kit und Ordner.
    private func schliesseUebersicht(grund: String) {
        guard uebersicht.istOffen else { return }
        uebersicht.schliesse()
        log.schreibe("uebersicht-geschlossen \(grund)")
    }

    /// Die eine Wiederholung nach einem technischen Prüffehler. Läuft schon eine, bleibt sie (ein Schwall fehlschlagender Starts
    /// schiebt sie nicht immer weiter hinaus); ein neuer, eigener Abruf (`aktualisiere`) ersetzt sie.
    private func planeWiederholung() {
        guard pruefWiederholung == nil else { return }
        log.schreibe("kit-pruefung-wiederholung in \(UebersichtRegel.wiederholungsFrist.components.seconds)s")
        pruefWiederholung = Task { [weak self] in
            try? await Task.sleep(for: UebersichtRegel.wiederholungsFrist)
            guard !Task.isCancelled, let self else { return }
            self.pruefWiederholung = nil
            await self.aktualisiere(zweiterVersuch: true)
        }
    }

    private func wiederholungAbbrechen() {
        pruefWiederholung?.cancel()
        pruefWiederholung = nil
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
        // Testschalter (Selbstfoto): abgelehnte Werte ins Log, Erscheinungsbild gilt gleich für die ganze App.
        for hinweis in argumente.hinweise { log.schreibe(hinweis) }
        if let b = argumente.testErscheinungsbild {
            NSApp.appearance = NSAppearance(named: b == .dunkel ? .darkAqua : .aqua)
            log.schreibe("test-erscheinungsbild \(b.rawValue)")
        }
        do {
            node = try await laufzeit()
            laufzeitStand = .bereit
        } catch {
            laufzeitStand = .fehlgeschlagen
            anzeige = .problem("Die mitgelieferte Laufzeit fehlt oder ist beschädigt — bitte die App neu installieren.")
            log.schreibe("laufzeit-fehler \(error)")
            zeigeEinrichtung()
            return
        }
        brainNode = (await TerminalNode.finde())?.path ?? pfade.node.path
        // nur lesend, löst nie Apples Installationsdialog aus; in eigener Aufgabe, damit ein hängendes xcode-select den Start nicht aufhält
        let startLog = log
        Task { startLog.schreibe("git \(await GitPruefer().pruefe().logText)") }
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
    private func laufzeit() async throws -> URL {
        #if DEBUG
        if let dev = ProcessInfo.processInfo.environment["BRAIN_APP_NODE"], dev.hasPrefix("/") {
            return URL(fileURLWithPath: dev)
        }
        #endif
        guard let ressourcen = Bundle.main.resourceURL else { throw LaufzeitFehler.manifestFehlt }
        let laufzeit = NodeLaufzeit(quelle: ressourcen.appendingPathComponent("node-runtime"), pfade: pfade)
        return try await Task.detached { try laufzeit.installiere() }.value
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

    /// Liest den aktiven Vault neu. Wechselt er, gehört die offene Übersicht (Kit-Brücke) zum alten Vault und wird
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
        kitStand = .unbekannt // das Vertrauen gilt für genau einen Vault; die nächste Prüfung entscheidet neu
        wiederholungAbbrechen() // eine wartende Wiederholung gehörte zum alten Vault
        anzeige = neu == nil ? .keinVault : StatusAnzeige.fuer(nil, fehler: "Wird geprüft …")
        if alt != nil { uebersicht.schliesse() }
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

    /// Status-Abruf: Vault neu lesen, Vertrauen frisch prüfen, bei „erlaubt“ `brain status` lesen — und die Übersicht schließen, sobald
    /// die Freigabe nicht mehr gilt (Studio-v2-Spec §8, Review SW-2): Das Vertrauen kann zwischen zwei Abrufen entfallen sein (Abgleich
    /// hat Kit-Code geändert, Freigabe entzogen), der Ordner oder das Kit können fehlen. Gerufen wird er beim Start, im Takt, aus
    /// dem Menü, nach jedem Schließen eines Fensters und auf `vault-gewechselt` und `vertrauen-geaendert` der Oberfläche.
    func aktualisiere() async {
        wiederholungAbbrechen() // ein eigener Abruf ersetzt die wartende Wiederholung (er bekommt bei Bedarf seine eigene)
        await aktualisiere(zweiterVersuch: false)
    }

    /// `zweiterVersuch`: die eine Wiederholung nach einem technischen Prüffehler — scheitert auch sie, schließt die Übersicht.
    private func aktualisiere(zweiterVersuch: Bool) async {
        guard let node else { return }
        pruefeVaultWechsel()
        // Nur das Ergebnis des neuesten Laufs für den aktuellen Ordner gilt (langsame ältere Läufe werden verworfen).
        statusLauf += 1
        let lauf = statusLauf
        guard let vault else {
            status = nil
            zufuehrungen = .keine
            kitStand = .unbekannt
            anzeige = .keinVault
            return
        }
        // Reine Datei (kein Kit-Code, kein Prozess): bei jedem Abruf frisch lesen, auch wenn das Kit gesperrt ist.
        zufuehrungen = ZufuehrungenStand.lade(vault: vault)
        switch VaultAuswahl.pruefe(vault) {
        case .fehlt:
            status = nil
            kitStand = .unbekannt
            anzeige = .problem("Vault-Ordner nicht gefunden")
            schliesseUebersicht(grund: "vault-fehlt") // ohne Ordner keine Kit-Brücke (SW-2)
            return
        case .keinBrain:
            status = nil
            kitStand = .unbekannt
            anzeige = .ohneKit
            log.schreibe("status ohne-kit")
            schliesseUebersicht(grund: "kein-kit") // Kit weg (z. B. nach einem Abgleich): die Übersicht ist kein Kit mehr (SW-2)
            return
        case .ok:
            break
        }
        // Kit-Code läuft nur mit Vertrauen: die Prüfung und der Start von `brain status` gehören zusammen (`KitVertrauen.status`).
        let abruf: KitAbruf
        if let vertrauen {
            abruf = await vertrauen.status(BrainBefehl(node: node, vault: vault, umgebung: umgebung))
        } else {
            abruf = .gesperrt(.pruefungFehlt)
        }
        guard lauf == statusLauf, Self.gleich(self.vault, vault) else { return }
        switch abruf {
        case .status(let s):
            uebernehme(.erlaubt)
            status = s
            anzeige = .fuer(s)
            log.schreibe("status \(s.zustand.rawValue)")
        case .nichtAbrufbar(let grund):
            uebernehme(.erlaubt) // erlaubt, nur `brain status` ging schief
            status = nil
            anzeige = .fuer(nil, fehler: "Status gerade nicht abrufbar")
            log.schreibe("status-fehler \(grund)")
        case .gesperrt(let grund):
            let erlaubnis = KitErlaubnis.nein(grund)
            if grund.istTechnisch {
                // Nicht „bitte freigeben“: die Prüfung selbst ist gescheitert. Der Grund steht nur hier im Protokoll.
                log.schreibe("status kit-pruefung-fehlgeschlagen \(grund.rawValue)" + (zweiterVersuch ? " endgueltig" : ""))
            } else {
                log.schreibe("status kit-nicht-erlaubt \(grund.rawValue)")
            }
            // Wurde das Vertrauen entzogen (oder der Code geändert), während die Übersicht offen ist: zu — ihre Brücke ist Kit-Code.
            uebernehme(erlaubnis, zweiterVersuch: zweiterVersuch)
        }
    }

    // MARK: Fenster

    /// Was `oeffneFenster` ergeben hat — die Aktion `ansicht` meldet es der Seite als `grund`.
    enum UebersichtErgebnis: Equatable {
        case geoeffnet
        case keinKit
        case nichtVertraut
        /// Die Vertrauensprüfung selbst ist gescheitert (kein „bitte freigeben“): Grund `pruefung-fehlgeschlagen`.
        case pruefungFehlgeschlagen
    }

    /// Übersicht = bisherige Kit-Ansicht (3D/Karten); braucht ein Kit im aktiven Vault UND das Vertrauen des Nutzers in diesen
    /// Vault: Die Vertrauensprüfung läuft jedes Mal frisch, bevor ein Fenster entsteht (und danach vor jedem Start der Kit-Brücke,
    /// siehe `kitStartPruefung`). Ohne Vertrauen öffnet nichts; ihr Ergebnis geht durch `uebernehme` (Anzeige, offene Übersicht).
    @discardableResult
    func oeffneFenster() async -> UebersichtErgebnis {
        guard let node, let vault = vaultFrisch(), VaultAuswahl.pruefe(vault) == .ok else { return .keinKit }
        let erlaubnis: KitErlaubnis
        if let vertrauen { erlaubnis = await vertrauen.pruefe(vault: vault) } else { erlaubnis = .nein(.pruefungFehlt) }
        // Wechselte der Vault während der Prüfung, gilt ihr Ergebnis nicht mehr.
        guard Self.gleich(vaultFrisch(), vault) else { return .keinKit }
        let vorher = kitStand
        if Self.gleich(self.vault, vault) {
            uebernehme(erlaubnis)
            // Eben noch „nicht erlaubt“ oder „Prüfung fehlgeschlagen“, jetzt erlaubt: Menü und Status nachziehen.
            if erlaubnis.istErlaubt, vorher != .erlaubt { Task { await aktualisiere() } }
        }
        guard erlaubnis.istErlaubt else {
            log.schreibe("uebersicht-abgelehnt kit-\(erlaubnis.logText)")
            return erlaubnis.istTechnischerFehler ? .pruefungFehlgeschlagen : .nichtVertraut
        }
        uebersicht.oeffne(node: node, vault: vault, umgebung: umgebung, fluechtig: argumente.fluechtig,
                          vorStart: kitStartPruefung(vault))
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
                      test: argumente.studioTestlauf ? argumente : nil, fluechtig: argumente.fluechtig)
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
            case .nichtVertraut: return ["ok": false, "grund": "nicht-vertraut"] as [String: Any]
            case .pruefungFehlgeschlagen: return ["ok": false, "grund": "pruefung-fehlgeschlagen"] as [String: Any]
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
            guard let url = await studio.waehleOrdner(titel: titel, vorschlag: vorschlag) else { return nil }
            return ["pfad": url.path]
        case .vaultGewechselt:
            log.schreibe("aktion vault-gewechselt")
            vaultGewechselt()
            return ok
        case .vertrauenGeaendert:
            // Das Backend hat das Vertrauen geändert — durch die Freigabe, ihren Entzug oder einen Abgleich, der Kit-Code oder Hooks
            // verändert hat (Info neu geladen, `vertrauen.erlaubt` ist von true auf false gekippt): frisch prüfen, Status neu lesen
            // und die Übersicht schließen, wenn nicht (mehr) erlaubt (`aktualisiere`). Die Antwort wartet nicht auf `brain status`.
            log.schreibe("aktion vertrauen-geaendert")
            Task { await aktualisiere() }
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

    /// Offene Rückfragen laut letztem Status (kein eigenes Polling); nil = unbekannt oder älteres Kit.
    var rueckfragenAnzahl: Int? { status?.zahlen.rueckfragen }

    /// Startet `.tools/brain.mjs` aus dem Vault — also Kit-Code: nur nach frischer Vertrauensprüfung (Vertrauen v2, Review FBL-34).
    func oeffneRueckfragen() {
        guard let vault = vaultFrisch(), node != nil, VaultAuswahl.pruefe(vault) == .ok else { zeigeEinrichtung(); return }
        Task {
            let erlaubnis: KitErlaubnis
            if let vertrauen { erlaubnis = await vertrauen.pruefe(vault: vault) } else { erlaubnis = .nein(.pruefungFehlt) }
            guard Self.gleich(vaultFrisch(), vault) else { return }
            uebernehme(erlaubnis)
            guard erlaubnis.istErlaubt else {
                log.schreibe("rueckfragen-abgelehnt kit-\(erlaubnis.logText)")
                return
            }
            zeigeRueckfragenFenster(vault: vault)
        }
    }

    private func zeigeRueckfragenFenster(vault: URL) {
        guard let node else { return }
        if let rueckfragenFenster {
            rueckfragenFenster.makeKeyAndOrderFront(nil)
            NSApp.activate()
            return
        }
        let modell = RueckfragenModell(befehl: BrainBefehl(node: node, vault: vault, umgebung: umgebung),
                                       tageslauf: status?.tageslauf, log: log) { [weak self] in
            Task { await self?.aktualisiere() }
        }
        let w = NSWindow(contentViewController: NSHostingController(rootView: RueckfragenAnsicht(modell: modell)))
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
        let w = NSWindow(contentViewController: NSHostingController(rootView: EinrichtungsAnsicht(zustand: self)))
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
        let dienste = WerkstattDienste(pfade: pfade) { methode, pfad, body in
            try await bruecke.anfrage(methode: methode, pfad: pfad, body: body)
        }
        let modell = EinrichtungsModell(dienste: dienste, speicher: EinrichtungsSpeicher(pfade: pfade), log: log)
        let vaultVorher = vaultFrisch()
        let w = NSWindow(contentViewController: NSHostingController(rootView: EinrichtungsAssistentAnsicht(modell: modell)))
        w.title = "Kortex einrichten"
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
        taktgeber?.cancel()
        wiederholungAbbrechen()
        studio.schliesse()
        uebersicht.schliesse()
        rueckfragenFenster?.close()
    }
}
