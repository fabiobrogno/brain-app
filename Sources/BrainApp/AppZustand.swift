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
    private let fenster: FensterSteuerung
    private var node: URL?
    private var brainNode = ""
    private var einrichtung: NSWindow?
    private var taktgeber: Task<Void, Never>?

    init() {
        let p = AppPfade.standard()
        let l = AppLog(pfade: p)
        pfade = p
        log = l
        fenster = FensterSteuerung(log: l)
    }

    private var umgebung: [String: String] { ["BRAIN_NODE": brainNode] }

    func starte() async {
        signal(SIGPIPE, SIG_IGN)
        log.schreibe("start")
        do {
            node = try laufzeit()
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
        taktgeber = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(15 * 60))
                await self?.aktualisiere()
            }
        }
        if argumente.fensterOeffnen { oeffneFenster() }
        if let s = argumente.schliessenNach { Task { try? await Task.sleep(for: s); fenster.schliesse() } }
        if let s = argumente.beendenNach { Task { try? await Task.sleep(for: s); NSApp.terminate(nil) } }
    }

    private func laufzeit() throws -> URL {
        if let dev = ProcessInfo.processInfo.environment["BRAIN_APP_NODE"], dev.hasPrefix("/") {
            return URL(fileURLWithPath: dev)
        }
        guard let ressourcen = Bundle.main.resourceURL else { throw LaufzeitFehler.manifestFehlt }
        return try NodeLaufzeit(quelle: ressourcen.appendingPathComponent("node-runtime"), pfade: pfade).installiere()
    }

    func verbinde(_ ordner: URL, merken: Bool = true) async {
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
    }

    func aktualisiere() async {
        guard let vault, let node else { return }
        guard VaultAuswahl.pruefe(vault) == .ok else {
            status = nil
            anzeige = .problem("Brain-Ordner nicht gefunden")
            return
        }
        do {
            let s = try await BrainBefehl(node: node, vault: vault, umgebung: umgebung).status()
            status = s
            anzeige = .fuer(s)
            log.schreibe("status \(s.zustand.rawValue)")
        } catch {
            status = nil
            anzeige = .fuer(nil, fehler: "Status gerade nicht abrufbar")
            log.schreibe("status-fehler \(error)")
        }
    }

    func oeffneFenster() {
        guard let vault, let node, VaultAuswahl.pruefe(vault) == .ok else { zeigeEinrichtung(); return }
        fenster.oeffne(node: node, vault: vault, umgebung: umgebung)
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
        fenster.schliesse()
    }
}
