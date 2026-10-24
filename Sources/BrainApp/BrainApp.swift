import AppKit
import SwiftUI
import BrainCore

@MainActor
final class AppDelegat: NSObject, NSApplicationDelegate {
    let zustand = AppZustand()

    func applicationDidFinishLaunching(_ notification: Notification) {
        baueMenue()
        Task { await zustand.starte() }
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

    @objc private func neu() { zustand.sende(.neu) }
    @objc private func merken() { zustand.sende(.merken) }
    @objc private func infospalte() { zustand.sende(.infospalte) }
    @objc private func studioOeffnen() { zustand.oeffneStudio() }
    @objc private func uebersichtOeffnen() { zustand.oeffneFenster() }

    /// Eintrag mit eigener Aktion der App.
    private func eintrag(_ titel: String, _ aktion: Selector, _ taste: String = "", _ masken: NSEvent.ModifierFlags = [.command]) -> NSMenuItem {
        let e = NSMenuItem(title: titel, action: aktion, keyEquivalent: taste)
        e.keyEquivalentModifierMask = masken
        e.target = self
        return e
    }

    private func menue(_ titel: String, _ eintraege: [NSMenuItem]) -> NSMenuItem {
        let m = NSMenu(title: titel)
        eintraege.forEach { m.addItem($0) }
        let oben = NSMenuItem(title: titel, action: nil, keyEquivalent: "")
        oben.submenu = m
        return oben
    }

    /// Hauptmenü: Brain, Ablage, Bearbeiten (nötig für Kopieren/Einfügen im WebView), Darstellung, Fenster.
    private func baueMenue() {
        let haupt = NSMenu()
        haupt.addItem(menue("Brain", [
            standard("Brain ausblenden", #selector(NSApplication.hide(_:)), "h"),
            .separator(),
            standard("Brain beenden", #selector(NSApplication.terminate(_:)), "q"),
        ]))
        haupt.addItem(menue("Ablage", [
            eintrag("Neu", #selector(neu), "n"),
            eintrag("Schnell merken", #selector(merken), "m", [.command, .shift]),
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
            eintrag("Infospalte ein-/ausblenden", #selector(infospalte), "i", [.command, .option]),
        ]))
        let fensterMenue = menue("Fenster", [
            eintrag("Studio", #selector(studioOeffnen), "1"),
            eintrag("Übersicht", #selector(uebersichtOeffnen), "2"),
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

@main
struct BrainApp: App {
    @NSApplicationDelegateAdaptor(AppDelegat.self) private var delegat

    var body: some Scene {
        MenuBarExtra {
            MenueInhalt(zustand: delegat.zustand)
        } label: {
            MenueSymbol(zustand: delegat.zustand)
        }
    }
}
