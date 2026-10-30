import AppKit
import SwiftUI
import BrainCore

/// Schwebendes Fenster (Panel): nimmt Tastatureingaben an, ohne Kortex nach vorn zu holen. So bleibt die App darunter aktiv, das Studio
/// springt nicht auf, und beim Schließen liegt der Fokus wieder dort, wo er war.
final class ErfassenPanel: NSPanel {
    var beiEsc: (() -> Void)?

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    /// Esc, wenn gerade kein Eingabefeld zuständig ist (z. B. Fokus auf einem Knopf).
    override func cancelOperation(_ sender: Any?) { beiEsc?() }
}

/// „Schnell erfassen“ von überall: das globale Tastenkürzel (Carbon, ohne Bedienungshilfen-Recht) und das schwebende Fenster.
/// Der Ablauf (Eingabe, Kurzformen, Speichern, Vertrauen) steckt in `BrainCore/Erfassen`; hier sind nur Fenster und Anmeldung.
@MainActor
final class ErfassenSteuerung {
    /// Was zum Speichern gebraucht wird, sobald die Laufzeit bereit ist (Node und Werkstatt-Skript im App-Paket).
    struct Werkstatt {
        let node: URL
        let skript: URL
        let umgebung: [String: String]
    }

    private let pfade: AppPfade
    private let log: AppLog
    /// Nein in der Vorschau und in Testläufen: Dort darf die App kein globales Kürzel belegen (es gehört der echten App).
    private let kuerzelErlaubt: Bool
    private let werkstatt: () -> Werkstatt?
    private let registrierung = CarbonKuerzel()
    private var verwaltung: KuerzelVerwaltung?
    private var modell: ErfassenModell?
    private var panel: ErfassenPanel?
    private var vorherige: NSRunningApplication?
    private var schliesst = false

    init(pfade: AppPfade, log: AppLog, kuerzelErlaubt: Bool, werkstatt: @escaping () -> Werkstatt?) {
        self.pfade = pfade
        self.log = log
        self.kuerzelErlaubt = kuerzelErlaubt
        self.werkstatt = werkstatt
    }

    // MARK: Tastenkürzel

    /// Meldet das Kürzel an (gespeichertes, sonst ⌃⌥Leertaste). Gibt es ein Problem, steht es im Log und im Fenster.
    func starte() {
        guard kuerzelErlaubt else { log.schreibe("erfassen-kuerzel aus (Vorschau oder Testlauf)"); return }
        let v = KuerzelVerwaltung(
            registrierung: registrierung, gespeichert: ErfassenEinstellungen.lade(pfade).kuerzel, system: { SystemKuerzelLeser.ausSystem() },
            sichere: { [pfade] k in
                var e = ErfassenEinstellungen.lade(pfade)
                e.kuerzel = k
                try? e.speichere(pfade)
            },
            aktion: { [weak self] in self?.umschalten() })
        verwaltung = v
        if let hinweis = v.starte() {
            log.schreibe("erfassen-kuerzel-hinweis \(v.kuerzel.anzeige) \(hinweis)")
            modellErzeugenFallsNoetig().kuerzelMeldung = hinweis
        } else {
            log.schreibe("erfassen-kuerzel \(v.kuerzel.anzeige)")
        }
    }

    func beende() {
        verwaltung?.beende()
        panel?.orderOut(nil)
    }

    // MARK: Fenster

    func umschalten() {
        if panel?.isVisible == true, !schliesst { schliesse() } else { zeige() }
    }

    func zeige() {
        let m = modellErzeugenFallsNoetig()
        let p = panelErzeugenFallsNoetig(m)
        if p.isVisible, !schliesst { m.vorbereiten(); p.makeKeyAndOrderFront(nil); return }
        schliesst = false
        let front = NSWorkspace.shared.frontmostApplication
        vorherige = front?.processIdentifier == ProcessInfo.processInfo.processIdentifier ? nil : front
        m.vorbereiten()
        let bildschirm = NSScreen.screens.first { NSMouseInRect(NSEvent.mouseLocation, $0.frame, false) } ?? NSScreen.main
        let ziel = ErfassenPlatzierung.rahmen(sichtbar: bildschirm?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900), groesse: p.frame.size)
        let ruhig = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        p.setFrame(ruhig ? ziel : ziel.offsetBy(dx: 0, dy: 12), display: false)
        p.alphaValue = ruhig ? 1 : 0
        p.makeKeyAndOrderFront(nil)
        if !ruhig {
            NSAnimationContext.runAnimationGroup { ctx in
                ctx.duration = 0.16
                ctx.timingFunction = CAMediaTimingFunction(name: .easeOut)
                p.animator().alphaValue = 1
                p.animator().setFrame(ziel, display: true)
            }
        }
    }

    /// Schließt das Fenster; der Entwurf bleibt im Modell stehen (nur ein Speichern leert das Feld).
    func schliesse() {
        guard let p = panel, p.isVisible, !schliesst else { return }
        schliesst = true
        let zurueck = vorherige
        let fertig = { [weak self] in
            p.orderOut(nil)
            p.alphaValue = 1
            self?.schliesst = false
            // Fokus zurück an die App, in der der Nutzer war (bei einem Panel ohne Aktivierung meist schon dort).
            if let zurueck, !zurueck.isTerminated, NSWorkspace.shared.frontmostApplication?.processIdentifier != zurueck.processIdentifier {
                zurueck.activate()
            }
        }
        if NSWorkspace.shared.accessibilityDisplayShouldReduceMotion { fertig(); return }
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.10
            p.animator().alphaValue = 0
        }, completionHandler: { MainActor.assumeIsolated { fertig() } })
    }

    // MARK: Aufbau

    private func modellErzeugenFallsNoetig() -> ErfassenModell {
        if let modell { return modell }
        let einstellungen = ErfassenEinstellungen.lade(pfade)
        let halter = SteuerungsHalter(self)
        let speicher = AppErfassenSpeicher { await MainActor.run { halter.steuerung?.speicherErzeugen() } }
        let m = ErfassenModell(
            art: einstellungen.art ?? .aufgabe, kuerzel: einstellungen.wirksamesKuerzel, speicher: speicher,
            vaultQuelle: { [pfade] in ErfassenVault.lade(pfade) },
            vertrauen: { [pfade] vault in VaultVertrauen.lade(vault: vault, support: pfade.basis) },
            merkeArt: { [pfade] art in
                var e = ErfassenEinstellungen.lade(pfade)
                e.art = art
                try? e.speichere(pfade)
            })
        m.beiSchliessen = { [weak self] in self?.schliesse() }
        m.aendereKuerzel = { [weak self] k in
            guard let v = self?.verwaltung else { return "Das Tastenkürzel ist in dieser Sitzung nicht aktiv (Vorschau oder Testlauf)." }
            let fehler = v.aendere(k)
            if fehler == nil { self?.log.schreibe("erfassen-kuerzel geaendert \(k.anzeige)") }
            return fehler
        }
        modell = m
        return m
    }

    private func panelErzeugenFallsNoetig(_ m: ErfassenModell) -> ErfassenPanel {
        if let panel { return panel }
        let p = ErfassenPanel(contentRect: NSRect(x: 0, y: 0, width: ErfassenAnsicht.breite, height: ErfassenAnsicht.hoehe),
                              styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        p.title = "Schnell erfassen"
        p.level = .floating
        p.isFloatingPanel = true
        p.hidesOnDeactivate = false
        p.isReleasedWhenClosed = false
        p.becomesKeyOnlyIfNeeded = false
        p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        p.isOpaque = false
        p.backgroundColor = .clear
        p.hasShadow = true
        p.isMovableByWindowBackground = true
        p.beiEsc = { [weak self] in self?.schliesse() }
        let host = NSHostingView(rootView: ErfassenAnsicht(modell: m).kortexAkzent())
        host.frame = NSRect(x: 0, y: 0, width: ErfassenAnsicht.breite, height: ErfassenAnsicht.hoehe)
        p.contentView = host
        p.setContentSize(NSSize(width: ErfassenAnsicht.breite, height: ErfassenAnsicht.hoehe))
        panel = p
        return p
    }

    /// Für jedes Speichern eine eigene, kurzlebige Werkstatt für den gewählten Vault (siehe `WerkstattErfassenSpeicher`).
    private func speicherErzeugen() -> WerkstattErfassenSpeicher? {
        guard let w = werkstatt() else { return nil }
        let arbeitsordner = pfade.basis
        return WerkstattErfassenSpeicher { vault in
            BrueckenVerbindung(node: w.node, vault: vault, skript: w.skript, umgebung: w.umgebung, arbeitsordner: arbeitsordner)
        }
    }
}

/// Reicht die Steuerung (Hauptthread) in eine `@Sendable`-Funktion; benutzt wird sie dort nur über `MainActor.run`.
final class SteuerungsHalter: @unchecked Sendable {
    weak var steuerung: ErfassenSteuerung?
    @MainActor init(_ s: ErfassenSteuerung) { steuerung = s }
}

/// Holt den echten Speicher erst beim Speichern: vorher kann die Laufzeit noch nicht bereit sein.
struct AppErfassenSpeicher: ErfassenSpeicher {
    let hole: @Sendable () async -> WerkstattErfassenSpeicher?

    func speichere(_ erfassung: Erfassung) async throws -> String {
        guard let echt = await hole() else {
            throw ErfassenFehler("Kortex ist noch nicht bereit. Warte einen Moment und versuche es noch einmal.")
        }
        return try await echt.speichere(erfassung)
    }
}
