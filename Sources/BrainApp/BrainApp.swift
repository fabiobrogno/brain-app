import AppKit
import SwiftUI
import Sparkle
import BrainCore

@MainActor
final class AppDelegat: NSObject, NSApplicationDelegate {
    let zustand = AppZustand()
    /// Sparkle-Updates. Läuft nur im gebauten Paket (mit `SUFeedURL`); bei `swift run` ohne Info.plist startet er nicht.
    /// In der Vorschau startet er nie: kein Update-Abruf im Netz, keine Einstellungen von Sparkle.
    let updater = SPUStandardUpdaterController(
        startingUpdater: Bundle.main.object(forInfoDictionaryKey: "SUFeedURL") != nil && !CommandLine.arguments.contains("--vorschau"),
        updaterDelegate: nil, userDriverDelegate: nil)

    func applicationDidFinishLaunching(_ notification: Notification) {
        baueMenue()
        Task { await zustand.starte() }
    }

    private var beendenLaeuft = false

    /// ⌘Q mit offenem Studio: erst die Oberfläche sichern lassen, dann beenden (oder auf Wunsch abbrechen).
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard zustand.istStudioOffen else { return .terminateNow }
        if beendenLaeuft { return .terminateCancel }
        beendenLaeuft = true
        Task { @MainActor in
            let ja = await zustand.darfBeenden()
            beendenLaeuft = false
            sender.reply(toApplicationShouldTerminate: ja)
        }
        return .terminateLater
    }

    func applicationWillTerminate(_ notification: Notification) {
        zustand.beende()
    }

    /// Fenster zu beendet die App nicht — sie bleibt im Dock und in der Menüleiste.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    /// Dock-Klick ohne sichtbares Fenster öffnet das Studio wieder.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { zustand.oeffneStudio() }
        return true
    }

    // MARK: Menüs

    @objc private func studioOeffnen() { zustand.oeffneStudio() }
    @objc private func assistentOeffnen() { zustand.zeigeAssistent() }
    @objc private func uebersichtOeffnen() { Task { await zustand.oeffneFenster() } }

    /// Alle Befehle an die Studio-Oberfläche laufen über einen Eintrag mit dem Namen in `representedObject`
    /// (`StudioBefehl.rawValue` — die Namensliste steht nur dort).
    @objc private func sendeBefehl(_ sender: NSMenuItem) {
        guard let name = sender.representedObject as? String, let befehl = StudioBefehl(rawValue: name) else { return }
        zustand.sende(befehl)
    }

    /// Eintrag mit eigener Aktion der App.
    private func eintrag(_ titel: String, _ aktion: Selector, _ taste: String = "", _ masken: NSEvent.ModifierFlags = [.command]) -> NSMenuItem {
        let e = NSMenuItem(title: titel, action: aktion, keyEquivalent: taste)
        e.keyEquivalentModifierMask = masken
        e.target = self
        return e
    }

    /// Eintrag, der einen `StudioBefehl` an die Oberfläche schickt.
    private func befehl(_ titel: String, _ befehl: StudioBefehl, _ taste: String = "", _ masken: NSEvent.ModifierFlags = [.command]) -> NSMenuItem {
        let e = eintrag(titel, #selector(sendeBefehl(_:)), taste, masken)
        e.representedObject = befehl.rawValue
        return e
    }

    private func menue(_ titel: String, _ eintraege: [NSMenuItem]) -> NSMenuItem {
        let m = NSMenu(title: titel)
        eintraege.forEach { m.addItem($0) }
        let oben = NSMenuItem(title: titel, action: nil, keyEquivalent: "")
        oben.submenu = m
        return oben
    }

    /// Hauptmenü: Brain, Ablage, Bearbeiten (nötig für Kopieren/Einfügen im WebView), Darstellung, Gehe zu, Fenster.
    private func baueMenue() {
        let haupt = NSMenu()
        let suchen = NSMenuItem(title: "Nach Updates suchen …", action: #selector(SPUStandardUpdaterController.checkForUpdates(_:)), keyEquivalent: "")
        suchen.target = updater
        if zustand.vorschau != nil { suchen.isEnabled = false; suchen.action = nil }
        var kortexEintraege: [NSMenuItem] = []
        if zustand.vorschau != nil {
            let hinweis = NSMenuItem(title: VorschauBand.text, action: nil, keyEquivalent: "")
            hinweis.isEnabled = false
            kortexEintraege += [hinweis, .separator()]
        }
        haupt.addItem(menue("Kortex", kortexEintraege + [
            suchen,
            eintrag("Kortex einrichten …", #selector(assistentOeffnen)),
            .separator(),
            standard("Kortex ausblenden", #selector(NSApplication.hide(_:)), "h"),
            .separator(),
            standard("Kortex beenden", #selector(NSApplication.terminate(_:)), "q"),
        ]))
        haupt.addItem(menue("Ablage", [
            befehl("Neue Notiz", .neu, "n"),
            befehl("Schnell merken", .merken, "m", [.command, .shift]),
            .separator(),
            befehl("Vault öffnen …", .vaultOeffnen, "o", [.command, .shift]),
            befehl("Vault wechseln", .vaultWechseln, "v", [.control, .command]),
            .separator(),
            standard("Fenster schließen", #selector(NSWindow.performClose(_:)), "w"),
        ]))
        haupt.addItem(menue("Bearbeiten", [
            standard("Widerrufen", Selector(("undo:")), "z"),
            standard("Wiederholen", Selector(("redo:")), "z", [.command, .shift]),
            .separator(),
            standard("Ausschneiden", #selector(NSText.cut(_:)), "x"),
            standard("Kopieren", #selector(NSText.copy(_:)), "c"),
            standard("Einsetzen", #selector(NSText.paste(_:)), "v"),
            standard("Alles auswählen", #selector(NSText.selectAll(_:)), "a"),
        ]))
        haupt.addItem(menue("Darstellung", [
            befehl("Eigenschaften ein-/ausblenden", .infospalte, "i", [.command, .option]),
            befehl("Verlauf ein-/ausblenden", .verlauf, "h", [.command, .shift]),
            .separator(),
            befehl("Hell/Dunkel umschalten", .hellDunkel),
        ]))
        haupt.addItem(menue("Gehe zu", [
            befehl("Posteingang", .posteingang, "1"),
            befehl("Alle Notizen", .alle, "2"),
            befehl("Wissen", .wissen, "3"),
            .separator(),
            befehl("Befehlspalette", .palette, "k"),
        ]))
        // Studio und Übersicht mit ⌥⌘1/⌥⌘2 — ⌘1/⌘2 gehören zu „Gehe zu“.
        let fensterMenue = menue("Fenster", [
            eintrag("Studio", #selector(studioOeffnen), "1", [.command, .option]),
            eintrag("Übersicht", #selector(uebersichtOeffnen), "2", [.command, .option]),
            .separator(),
            standard("Im Dock ablegen", #selector(NSWindow.performMiniaturize(_:)), "m"),
        ])
        haupt.addItem(fensterMenue)
        NSApp.mainMenu = haupt
        NSApp.windowsMenu = fensterMenue.submenu
    }

    /// Eintrag für Standard-Aktionen der Responder-Kette (ohne Ziel).
    private func standard(_ titel: String, _ aktion: Selector, _ taste: String = "", _ masken: NSEvent.ModifierFlags = [.command]) -> NSMenuItem {
        let e = NSMenuItem(title: titel, action: aktion, keyEquivalent: taste)
        e.keyEquivalentModifierMask = masken
        return e
    }
}

/// Die Übersicht braucht einen Brain-Vault (`brain.config.json`) und einen bereiten Kern — ohne eins von beiden ist ihr Eintrag
/// ausgegraut.
extension AppDelegat: NSMenuItemValidation {
    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        if item.action == #selector(uebersichtOeffnen) { return zustand.uebersichtMoeglich }
        return true
    }
}

@main
struct BrainApp: App {
    @NSApplicationDelegateAdaptor(AppDelegat.self) private var delegat

    var body: some Scene {
        MenuBarExtra {
            MenueInhalt(zustand: delegat.zustand, updater: delegat.updater)
        } label: {
            MenueSymbol(zustand: delegat.zustand)
        }
    }
}
