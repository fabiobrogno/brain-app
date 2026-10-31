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
        zustand.kuerzel.beiMenueAenderung = { [weak self] in self?.stelleMenueUm() } // ein geändertes Kürzel gilt sofort in den Menüs
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

    /// Eintrag, der einen `StudioBefehl` an die Oberfläche schickt. Das Kürzel kommt aus dem Register der Tastenkürzel (Standard + eigene), nie von Hand: so stimmen Menü, Studio und
    /// die Einstellungen immer überein. Ein Befehl ohne Kürzel (oder ohne Eintrag im Register) hat im Menü keines.
    private func befehl(_ titel: String, _ befehl: StudioBefehl) -> NSMenuItem {
        let e = eintrag(titel, #selector(sendeBefehl(_:)), "", [])
        e.representedObject = befehl.rawValue
        if let id = zustand.kuerzel.befehlId(menue: befehl.rawValue) {
            e.identifier = NSUserInterfaceItemIdentifier(Self.kuerzelPraefix + id)
            wendeKuerzelAn(e)
        }
        return e
    }

    private static let kuerzelPraefix = "kuerzel:"

    /// Setzt Taste und Umschalter eines Eintrags aus der Belegung (kein Kürzel → leer).
    private func wendeKuerzelAn(_ e: NSMenuItem) {
        guard let roh = e.identifier?.rawValue, roh.hasPrefix(Self.kuerzelPraefix) else { return }
        if let m = zustand.kuerzel.menueKuerzel(String(roh.dropFirst(Self.kuerzelPraefix.count))) {
            e.keyEquivalent = m.zeichen
            e.keyEquivalentModifierMask = m.masken
        } else {
            e.keyEquivalent = ""
            e.keyEquivalentModifierMask = []
        }
    }

    /// Nach einer Änderung der Kürzel: alle Menüeinträge aus dem Register neu belegen.
    func stelleMenueUm() {
        func geh(_ menue: NSMenu) {
            for e in menue.items { wendeKuerzelAn(e); if let u = e.submenu { geh(u) } }
        }
        if let m = NSApp.mainMenu { geh(m) }
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
            eintrag("Kortex einrichten …", #selector(assistentOeffnen), "e"),
            .separator(),
            // ⌘, öffnet im Studio die Seite „Einstellungen“ (nicht mehr nur bei geöffnetem Menüleisten-Menü); wie alle Kürzel dieser Befehle aus dem Register
            befehl(StudioBefehl.einstellungenEintrag.titel, StudioBefehl.einstellungenEintrag.befehl),
            .separator(),
            standard("Kortex ausblenden", #selector(NSApplication.hide(_:)), "h"),
            .separator(),
            standard("Kortex beenden", #selector(NSApplication.terminate(_:)), "q"),
        ]))
        haupt.addItem(menue("Ablage", [
            befehl("Neue Notiz", .neu),
            befehl("Schnell merken", .merken),
            befehl("Aufgabe erfassen …", .aufgabeErfassen),
            .separator(),
            befehl("Vault öffnen …", .vaultOeffnen),
            befehl("Vault wechseln", .vaultWechseln),
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
            befehl("Eigenschaften ein-/ausblenden", .infospalte),
            befehl("Verlauf ein-/ausblenden", .verlauf),
            .separator(),
            befehl("Hell/Dunkel umschalten", .hellDunkel),
        ]))
        haupt.addItem(menue("Gehe zu", [
            befehl("Posteingang", .posteingang),
            befehl("Alle Notizen", .alle),
            befehl("Wissen", .wissen),
            befehl("Aufgaben", .aufgaben),
            .separator(),
            befehl("Befehlspalette", .palette),
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
            MenueInhalt(zustand: delegat.zustand, kuerzel: delegat.zustand.kuerzel, updater: delegat.updater)
        } label: {
            MenueSymbol(zustand: delegat.zustand)
        }
    }
}
