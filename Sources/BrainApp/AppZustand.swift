import AppKit
import SwiftUI
import BrainCore

/// Zustand und Abläufe der App (App-Spec §9.1/§10): Laufzeit installieren, Brain verbinden, Status zeigen,
/// Fenster öffnen. Schreibt nie selbst ins Brain — nur `config.json` der App unter Application Support.
@MainActor
final class AppZustand: ObservableObject {
    @Published private(set) var anzeige = StatusAnzeige.fuer(nil, fehler: "Wird gestartet …")
    @Published private(set) var status: BrainStatus?
    @Published private(set) var vault: URL?
    @Published private(set) var brauchtEinrichtung = false

    let pfade: AppPfade
    let log: AppLog
    private let argumente = StartArgumente.lies(CommandLine.arguments)
    /// Studio (Editor, Werkstatt-Brücke) und Übersicht (Kit-Ansicht, Kit-Brücke).
    private let studio: FensterSteuerung
    private let uebersicht: FensterSteuerung
    private var node: URL?
    private var brainNode = ""
    private var einrichtung: NSWindow?
    private var taktgeber: Task<Void, Never>?
    private var statusLauf = 0
    /// Erst nach dem Start öffnet ein späteres Verbinden (Einrichtung) das Studio selbst.
    private var gestartet = false

    init() {
        let p = AppPfade.standard()
        let l = AppLog(pfade: p)
        pfade = p
        log = l
        studio = FensterSteuerung(log: l, oberflaeche: .studio)
        uebersicht = FensterSteuerung(log: l, oberflaeche: .app)
    }

    /// Werkstatt-Skript im App-Paket (`BRAIN_APP_WERKSTATT` lenkt für Entwicklung um).
    private var werkstattSkript: URL? {
        if let dev = ProcessInfo.processInfo.environment["BRAIN_APP_WERKSTATT"], dev.hasPrefix("/") { return URL(fileURLWithPath: dev) }
        return Bundle.main.resourceURL?.appendingPathComponent("werkstatt/werkstatt.mjs")
    }

    var istStudioOffen: Bool { studio.istOffen }

    private var umgebung: [String: String] { ["BRAIN_NODE": brainNode] }

    func starte() async {
        signal(SIGPIPE, SIG_IGN)
        // Nach Aktionen im Fenster (Vorschlag übernehmen, Konflikt entscheiden) den Menüstatus auffrischen.
        for f in [studio, uebersicht] {
            f.beiGeschlossen = { [weak self] in Task { await self?.aktualisiere() } }
            f.beiAktion = { [weak self] in self?.fuehreAus($0) }
        }
        log.schreibe("start")
        do {
            node = try await laufzeit()
        } catch {
            anzeige = .problem("Die mitgelieferte Laufzeit fehlt oder ist beschädigt — bitte die App neu installieren.")
            log.schreibe("laufzeit-fehler \(error)")
            return
        }
        brainNode = (await TerminalNode.finde())?.path ?? pfade.node.path
        let gemerkt = AppEinstellungen.lade(pfade).vault.map { URL(fileURLWithPath: $0) }
        if let gewaehlt = argumente.vault ?? gemerkt {
            await verbinde(gewaehlt, merken: argumente.vault == nil)
        } else {
            zeigeEinrichtung()
        }
        gestartet = true
        taktgeber = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(15 * 60))
                await self?.aktualisiere()
            }
        }
        if vault != nil { oeffneStudio() }
        if argumente.fensterOeffnen { oeffneFenster() }
        if let s = argumente.schliessenNach { Task { try? await Task.sleep(for: s); studio.schliesse(); uebersicht.schliesse() } }
        if let s = argumente.beendenNach { Task { try? await Task.sleep(for: s); NSApp.terminate(nil) } }
    }

    /// Die Prüfsumme der Node-Datei (rund 120 MB) wird abseits des Main-Threads gerechnet.
    private func laufzeit() async throws -> URL {
        if let dev = ProcessInfo.processInfo.environment["BRAIN_APP_NODE"], dev.hasPrefix("/") {
            return URL(fileURLWithPath: dev)
        }
        guard let ressourcen = Bundle.main.resourceURL else { throw LaufzeitFehler.manifestFehlt }
        let laufzeit = NodeLaufzeit(quelle: ressourcen.appendingPathComponent("node-runtime"), pfade: pfade)
        return try await Task.detached { try laufzeit.installiere() }.value
    }

    func verbinde(_ ordner: URL, merken: Bool = true) async {
        // Anderer Ordner bei offenem Fenster: Fenster (samt Brücke) zu, sonst zeigt es weiter das alte Brain.
        if let alt = vault, alt.standardizedFileURL.path != ordner.standardizedFileURL.path {
            studio.schliesse()
            uebersicht.schliesse()
        }
        let pruefung = VaultAuswahl.pruefe(ordner)
        guard pruefung == .ok else {
            vault = nil
            status = nil
            anzeige = .problem(VaultAuswahl.meldung(pruefung) ?? "Brain-Ordner nicht gefunden")
            zeigeEinrichtung()
            return
        }
        vault = ordner
        brauchtEinrichtung = false
        if merken { try? AppEinstellungen(vault: ordner.path).speichere(pfade) }
        log.schreibe("verbunden \(ordner.path)")
        einrichtung?.close()
        einrichtung = nil
        await aktualisiere()
        if gestartet { oeffneStudio() }
    }

    func aktualisiere() async {
        guard let vault, let node else { return }
        // Nur das Ergebnis des neuesten Laufs für den aktuellen Ordner gilt (langsame ältere Läufe werden verworfen).
        statusLauf += 1
        let lauf = statusLauf
        guard VaultAuswahl.pruefe(vault) == .ok else {
            status = nil
            anzeige = .problem("Brain-Ordner nicht gefunden")
            return
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

    /// Übersicht = bisherige Kit-Ansicht (3D/Karten).
    func oeffneFenster() {
        guard let vault, let node, VaultAuswahl.pruefe(vault) == .ok else { zeigeEinrichtung(); return }
        uebersicht.oeffne(node: node, vault: vault, umgebung: umgebung)
    }

    func oeffneStudio() {
        guard let vault, let node, VaultAuswahl.pruefe(vault) == .ok else { zeigeEinrichtung(); return }
        studio.oeffne(node: node, vault: vault, skript: werkstattSkript, umgebung: umgebung)
    }

    /// Menübefehl (⌘N, ⌘⇧M, ⌘⌥I) an die Studio-Oberfläche; öffnet das Studio, wenn es zu ist.
    func sende(_ befehl: StudioBefehl) {
        if !studio.istOffen { oeffneStudio() }
        studio.sende(befehl)
    }

    /// Geprüfte Aktion aus dem Nachrichtenkanal `aktion` (Prüfung in `AppAktion`).
    private func fuehreAus(_ aktion: AppAktion) {
        switch aktion {
        case .ansicht: oeffneFenster()
        case .ordnerZeigen(let url): NSWorkspace.shared.activateFileViewerSelecting([url])
        case .extern(let url): NSWorkspace.shared.open(url)
        }
    }

    func zeigeOrdner() {
        if let vault { NSWorkspace.shared.activateFileViewerSelecting([vault]) }
    }

    func zeigeEinrichtung() {
        brauchtEinrichtung = true
        if let einrichtung {
            einrichtung.makeKeyAndOrderFront(nil)
            NSApp.activate()
            return
        }
        let w = NSWindow(contentViewController: NSHostingController(rootView: EinrichtungsAnsicht(zustand: self)))
        w.title = "Brain verbinden"
        w.styleMask = [.titled, .closable]
        w.isReleasedWhenClosed = false
        w.center()
        einrichtung = w
        w.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }

    func waehleOrdner() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Verbinden"
        panel.directoryURL = vault ?? VaultAuswahl.vorschlag() ?? FileManager.default.homeDirectoryForCurrentUser
        if panel.runModal() == .OK, let url = panel.url { Task { await verbinde(url) } }
    }

    func beende() {
        taktgeber?.cancel()
        studio.schliesse()
        uebersicht.schliesse()
    }
}
