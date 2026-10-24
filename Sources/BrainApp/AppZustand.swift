import AppKit
import SwiftUI
import BrainCore

/// Zustand und Abläufe der App (App-Spec §9.1/§10, Studio-v2-Spec §2): Laufzeit installieren, Studio immer öffnen, den
/// aktiven Vault aus `<support>/vaults.json` lesen (Rückfall `config.json`), Status zeigen, Fenster öffnen. Die Vault-Liste
/// führt das Backend (Werkstatt); die App liest sie nur und schreibt nie ins Brain.
@MainActor
final class AppZustand: ObservableObject {
    @Published private(set) var anzeige = StatusAnzeige.fuer(nil, fehler: "Wird gestartet …")
    @Published private(set) var status: BrainStatus?
    /// Aktiver Vault (nil = keiner gewählt; das Studio zeigt dann „Willkommen“).
    @Published private(set) var vault: URL?
    @Published private(set) var vaultName: String?
    /// Hat der aktive Vault das Brain-Kit (`.tools/brain.mjs`)? Nur dann gibt es Kit-Status und die Übersicht.
    @Published private(set) var kitVorhanden = false

    let pfade: AppPfade
    let log: AppLog
    private let argumente = StartArgumente.lies(CommandLine.arguments)
    /// Studio (Editor, Werkstatt-Brücke) und Übersicht (Kit-Ansicht, Kit-Brücke).
    private let studio: FensterSteuerung
    private let uebersicht: FensterSteuerung
    private var node: URL?
    private var brainNode = ""
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
        do {
            node = try await laufzeit()
        } catch {
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
        if argumente.fensterOeffnen { oeffneFenster() }
        if let s = argumente.schliessenNach { Task { try? await Task.sleep(for: s); studio.schliesse(); uebersicht.schliesse() } }
        if let s = argumente.beendenNach { Task { try? await Task.sleep(for: s); NSApp.terminate(nil) } }
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
        anzeige = neu == nil ? .keinVault : StatusAnzeige.fuer(nil, fehler: "Wird geprüft …")
        if alt != nil { uebersicht.schliesse() }
        log.schreibe("vault-wechsel \(neu?.path ?? "keiner")")
        return true
    }

    /// Aktion `vault-gewechselt`: das Backend hat vaults.json geändert — ab jetzt gilt sie wieder (nicht mehr `--vault`).
    private func vaultGewechselt() {
        vaultVorgabe = nil
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
            anzeige = .problem("Vault-Ordner nicht gefunden")
            return
        case .keinBrain:
            status = nil
            anzeige = .ohneKit
            log.schreibe("status ohne-kit")
            return
        case .ok:
            break
        }
        do {
            let s = try await BrainBefehl(node: node, vault: vault, umgebung: umgebung).status()
            guard lauf == statusLauf, self.vault == vault else { return }
            status = s
            anzeige = .fuer(s)
            log.schreibe("status \(s.zustand.rawValue)")
        } catch {
            guard lauf == statusLauf, self.vault == vault else { return }
            status = nil
            anzeige = .fuer(nil, fehler: "Status gerade nicht abrufbar")
            log.schreibe("status-fehler \(error)")
        }
    }

    // MARK: Fenster

    /// Übersicht = bisherige Kit-Ansicht (3D/Karten); braucht ein Kit im aktiven Vault. Liefert, ob sie geöffnet wurde.
    @discardableResult
    func oeffneFenster() -> Bool {
        guard let node, let vault = vaultFrisch(), VaultAuswahl.pruefe(vault) == .ok else { return false }
        uebersicht.oeffne(node: node, vault: vault, umgebung: umgebung)
        return true
    }

    /// Das Studio öffnet immer. Ohne `--vault` startet die Werkstatt ohne Vault-Argument und liest vaults.json selbst —
    /// so bleibt der Vault auch nach einem Neustart der Werkstatt der zuletzt in der Oberfläche gewählte.
    func oeffneStudio() {
        guard let node else { zeigeEinrichtung(); return }
        studio.oeffne(node: node, vault: vaultVorgabe, skript: werkstattSkript, umgebung: werkstattUmgebung, arbeitsordner: pfade.basis)
    }

    /// Menübefehl (⌘N, ⌘⇧M, Vault …, Gehe zu …) an die Studio-Oberfläche; öffnet das Studio, wenn es zu ist.
    func sende(_ befehl: StudioBefehl) {
        if !studio.istOffen { oeffneStudio() }
        studio.sende(befehl)
    }

    /// Geprüfte Aktion aus dem Nachrichtenkanal `aktion` (Prüfung in `AppAktion`); der Rückgabewert geht als Antwort an die Seite.
    private func fuehreAus(_ aktion: AppAktion) async -> Any? {
        let ok: [String: Any] = ["ok": true]
        switch aktion {
        case .ansicht:
            log.schreibe("aktion ansicht")
            let antwort: [String: Any] = oeffneFenster() ? ok : ["ok": false, "grund": "kein-kit"]
            return antwort
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
        case .titel(let text):
            // Bewusst ohne Log: Die Oberfläche meldet den Titel bei jeder Notiz (Notiztitel gehören nicht ins Protokoll).
            studio.setzeTitel(text)
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
