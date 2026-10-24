import AppKit
import SwiftUI
import BrainCore

/// Zustand und Abläufe der App (App-Spec §9.1/§10, Studio-v2-Spec §2): Laufzeit installieren, Studio immer öffnen, den
/// aktiven Vault aus `<support>/vaults.json` lesen (Rückfall `config.json`), Status zeigen, Fenster öffnen. Die Vault-Liste
/// führt das Backend (Werkstatt); die App liest sie nur und schreibt nie ins Brain. Code aus dem Vault (`brain status`, die
/// Kit-Brücke der Übersicht) läuft nur, wenn die Vertrauensprüfung (`KitVertrauen`, Spec §8) unmittelbar vorher „erlaubt“ sagt.
@MainActor
final class AppZustand: ObservableObject {
    @Published private(set) var anzeige = StatusAnzeige.fuer(nil, fehler: "Wird vorbereitet …")
    @Published private(set) var status: BrainStatus?
    /// Aktiver Vault (nil = keiner gewählt; das Studio zeigt dann „Willkommen“).
    @Published private(set) var vault: URL?
    @Published private(set) var vaultName: String?
    /// Hat der aktive Vault das Brain-Kit (`.tools/brain.mjs`)? Nur dann gibt es Kit-Status und die Übersicht.
    @Published private(set) var kitVorhanden = false
    /// Hat der Nutzer dem aktiven Vault vertraut (letzte Prüfung `{"erlaubt":true}`)? Bis zur ersten Prüfung und nach jedem
    /// Vault-Wechsel `false`. Nur ein Anhaltspunkt für Menü und Anzeige — gestartet wird Kit-Code immer nach einer frischen Prüfung.
    @Published private(set) var kitErlaubt = false

    let pfade: AppPfade
    let log: AppLog
    private let argumente = StartArgumente.lies(CommandLine.arguments)
    /// Studio (Editor, Werkstatt-Brücke) und Übersicht (Kit-Ansicht, Kit-Brücke).
    private let studio: FensterSteuerung
    private let uebersicht: FensterSteuerung
    private var node: URL?
    private var brainNode = ""
    /// Stand der Laufzeit-Prüfung beim Start (Prüfsumme der Node-Datei, rund 120 MB, kann dauern). Erst nach abgeschlossener
    /// Prüfung urteilt die App; vorher heißt es „wird vorbereitet“, nie „bitte neu installieren“.
    private enum LaufzeitStand { case wirdVorbereitet, bereit, fehlgeschlagen }
    private var laufzeitStand = LaufzeitStand.wirdVorbereitet
    /// Rückfall-Fenster, falls die Laufzeit fehlt (sonst gibt es keinen Einrichtungsdialog mehr).
    private var hinweisFenster: NSWindow?
    private var taktgeber: Task<Void, Never>?
    private var statusLauf = 0
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
    private var werkstattUmgebung: [String: String] { umgebung.merging(["BRAIN_APP_SUPPORT": pfade.basis.path]) { _, neu in neu } }

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

    /// Vor jedem Start der Kit-Brücke (auch nach einem Absturz): frisch fragen, sonst läuft nichts aus dem Vault.
    private func kitStartPruefung(_ vault: URL) -> @Sendable () async -> Bool {
        let vertrauen = self.vertrauen
        let log = self.log
        return {
            guard let vertrauen else { log.schreibe("kit-start-abgelehnt nein \(KitErlaubnis.Grund.pruefungFehlt.rawValue)"); return false }
            let erlaubnis = await vertrauen.pruefe(vault: vault)
            if !erlaubnis.istErlaubt { log.schreibe("kit-start-abgelehnt \(erlaubnis.logText)") }
            return erlaubnis.istErlaubt
        }
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
        pruefeVaultWechsel()
        log.schreibe(vault.map { "vault \($0.path)" } ?? "kein-vault")
        taktgeber = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(15 * 60))
                await self?.aktualisiere()
            }
        }
        // Das Studio öffnet immer — auch ohne Vault (dann zeigt es „Willkommen“); der Status wird danach gelesen.
        oeffneStudio()
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
        kitErlaubt = false // das Vertrauen gilt für genau einen Vault; die nächste Prüfung entscheidet neu
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

    func aktualisiere() async {
        guard let node else { return }
        pruefeVaultWechsel()
        // Nur das Ergebnis des neuesten Laufs für den aktuellen Ordner gilt (langsame ältere Läufe werden verworfen).
        statusLauf += 1
        let lauf = statusLauf
        guard let vault else {
            status = nil
            anzeige = .keinVault
            return
        }
        switch VaultAuswahl.pruefe(vault) {
        case .fehlt:
            status = nil
            kitErlaubt = false
            anzeige = .problem("Vault-Ordner nicht gefunden")
            return
        case .keinBrain:
            status = nil
            kitErlaubt = false
            anzeige = .ohneKit
            log.schreibe("status ohne-kit")
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
            kitErlaubt = true
            status = s
            anzeige = .fuer(s)
            log.schreibe("status \(s.zustand.rawValue)")
        case .nichtAbrufbar(let grund):
            kitErlaubt = true // erlaubt, nur `brain status` ging schief
            status = nil
            anzeige = .fuer(nil, fehler: "Status gerade nicht abrufbar")
            log.schreibe("status-fehler \(grund)")
        case .gesperrt(let grund):
            kitErlaubt = false
            status = nil
            anzeige = .kitNichtErlaubt
            log.schreibe("status kit-nicht-erlaubt \(grund.rawValue)")
            // Wurde das Vertrauen entzogen (oder der Code geändert), während die Übersicht offen ist: zu — ihre Brücke ist Kit-Code.
            if uebersicht.istOffen {
                uebersicht.schliesse()
                log.schreibe("uebersicht-geschlossen kit-nicht-erlaubt")
            }
        }
    }

    // MARK: Fenster

    /// Was `oeffneFenster` ergeben hat — die Aktion `ansicht` meldet es der Seite als `grund`.
    enum UebersichtErgebnis: Equatable {
        case geoeffnet
        case keinKit
        case nichtVertraut
    }

    /// Übersicht = bisherige Kit-Ansicht (3D/Karten); braucht ein Kit im aktiven Vault UND das Vertrauen des Nutzers in diesen
    /// Vault: Die Vertrauensprüfung läuft jedes Mal frisch, bevor ein Fenster entsteht (und danach vor jedem Start der Kit-Brücke,
    /// siehe `kitStartPruefung`). Ohne Vertrauen öffnet nichts.
    @discardableResult
    func oeffneFenster() async -> UebersichtErgebnis {
        guard let node, let vault = vaultFrisch(), VaultAuswahl.pruefe(vault) == .ok else { return .keinKit }
        let erlaubnis: KitErlaubnis
        if let vertrauen { erlaubnis = await vertrauen.pruefe(vault: vault) } else { erlaubnis = .nein(.pruefungFehlt) }
        // Wechselte der Vault während der Prüfung, gilt ihr Ergebnis nicht mehr.
        guard Self.gleich(vaultFrisch(), vault) else { return .keinKit }
        if Self.gleich(self.vault, vault) { kitErlaubt = erlaubnis.istErlaubt }
        guard erlaubnis.istErlaubt else {
            log.schreibe("uebersicht-abgelehnt kit-\(erlaubnis.logText)")
            if uebersicht.istOffen { uebersicht.schliesse() }
            return .nichtVertraut
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
            // Das Backend hat das Vertrauen geändert: frisch prüfen, Status neu lesen — und die Übersicht schließen, falls das
            // Vertrauen entzogen wurde (`aktualisiere`). Die Antwort wartet nicht auf `brain status`.
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
        w.title = "Brain kann nicht starten"
        w.styleMask = [.titled, .closable]
        w.isReleasedWhenClosed = false
        w.center()
        hinweisFenster = w
        w.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }

    /// Vor ⌘Q: das Studio sichert zuerst seine Eingaben (siehe `FensterSteuerung.darfSchliessen`).
    func darfBeenden() async -> Bool { await studio.darfSchliessen() }

    func beende() {
        taktgeber?.cancel()
        studio.schliesse()
        uebersicht.schliesse()
    }
}
