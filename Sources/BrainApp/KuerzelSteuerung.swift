import AppKit
import SwiftUI
import BrainCore

/// Tastenkürzel der App (Paket P10): liest das Register (`Ressourcen/gemeinsam/tastenkuerzel-register.json`) und die eigenen Kürzel (`<Support>/tastenkuerzel.json`,
/// geschrieben vom Studio über die Werkstatt), meldet die globalen Kürzel (Carbon, ohne Bedienungshilfen-Recht) beim System an und stellt die Menüs um.
/// Das Studio meldet jede Änderung mit der Aktion `kuerzel-geaendert`; dann liest die App die Datei neu — ohne Neustart. Ein globales Kürzel prüft das Studio vor dem
/// Speichern mit `kuerzel-global`: die App meldet es an oder nennt den Grund (vom System belegt, reserviert, von einem anderen Programm gehalten).
/// In Vorschau und Testläufen meldet die App nie ein globales Kürzel an (es gehört der echten App); die Menüs folgen der Belegung trotzdem.
@MainActor
final class KuerzelSteuerung: ObservableObject {
    private let pfade: AppPfade
    private let log: AppLog
    private let globalErlaubt: Bool
    let register: KuerzelRegister?
    private(set) var belegung: KuerzelBelegung?
    private(set) var globale: GlobaleKuerzel?
    /// Zählt hoch, wenn sich die Belegung geändert hat (das Menü der Menüleiste zeichnet sich neu).
    @Published private(set) var stand = 0
    /// Das Hauptmenü der App neu belegen (setzt `AppDelegat`).
    var beiMenueAenderung: (() -> Void)?
    /// Die Belegung für „Schnell erfassen“ hat sich geändert (das schwebende Fenster zeigt sie an).
    var beiErfassenKuerzel: ((Tastenkuerzel) -> Void)?

    init(pfade: AppPfade, log: AppLog, globalErlaubt: Bool, ressourcen: URL? = Bundle.main.resourceURL) {
        self.pfade = pfade
        self.log = log
        self.globalErlaubt = globalErlaubt
        self.register = KuerzelRegister.laden(ressourcen: ressourcen)
        if let register {
            KuerzelBelegung.uebernimmAlteDatei(register: register, pfade: pfade)
            belegung = KuerzelBelegung.laden(register: register, pfade: pfade)
            if globalErlaubt {
                var kennung: UInt32 = 0
                let g = GlobaleKuerzel(register: register, system: { SystemKuerzelLeser.ausSystem() }, fabrik: { _ in kennung += 1; return CarbonKuerzel(kennung: kennung) })
                g.beiAenderung = { [weak self] id, k in self?.speichereAusApp(id, k) }
                globale = g
            }
        } else {
            log.schreibe("kuerzel-register fehlt")
        }
    }

    /// Meldet die globalen Kürzel an (`aktionen`: id → was beim Druck geschieht). Rückgabe: je Befehl ein Hinweis, wenn etwas nicht ging.
    @discardableResult
    func starte(aktionen: [String: @MainActor () -> Void]) -> [String: String] {
        guard let globale, let belegung else { log.schreibe("kuerzel-global aus (Vorschau, Testlauf oder ohne Register)"); return [:] }
        for (id, a) in aktionen { globale.setzeAktion(id, a) }
        let hinweise = globale.wendeAn(belegung, start: true)
        for (id, k) in globale.angemeldet { log.schreibe("kuerzel-global \(id) \(k.anzeige)") }
        for (id, h) in hinweise { log.schreibe("kuerzel-hinweis \(id) \(h)") }
        return hinweise
    }

    func beende() { globale?.beende() }

    /// `tastenkuerzel.json` hat sich geändert: neu lesen, globale Kürzel und Menüs auf die neue Belegung bringen. Rückgabe wie `starte`.
    @discardableResult
    func neuLesen() -> [String: String] {
        guard let register else { return [:] }
        let neu = KuerzelBelegung.laden(register: register, pfade: pfade)
        let fehler = globale?.wendeAn(neu) ?? [:]
        uebernimm(neu)
        for (id, h) in fehler { log.schreibe("kuerzel-hinweis \(id) \(h)") }
        return fehler
    }

    /// Antwort auf die Aktion `kuerzel-global`: geht dieses Kürzel für diesen globalen Befehl? (nil = abmelden). Meldet es bei Erfolg gleich an.
    func pruefeGlobal(id: String, text: String?) -> [String: Any] {
        func nein(_ t: String) -> [String: Any] { ["ok": false, "text": t] }
        guard let register, let befehl = register.befehl(id), befehl.global else { return nein("Dieses Kürzel gibt es nicht.") }
        var k: Tastenkuerzel?
        if let text {
            guard let kk = Tastenkuerzel(kanonisch: text) else { return nein("Diese Taste lässt sich nicht als Kürzel verwenden.") }
            k = kk
        }
        guard let globale else { return ["ok": true] } // Vorschau oder Testlauf: nichts anmelden
        if let fehler = globale.setze(id, k, speichern: false) { log.schreibe("kuerzel-global abgelehnt \(id)"); return nein(fehler) }
        log.schreibe("kuerzel-global geprueft \(id) \(k?.anzeige ?? "aus")")
        return ["ok": true]
    }

    /// Das Erfassen-Fenster hat sein Kürzel geändert: prüfen, anmelden, speichern. Rückgabe: nil bei Erfolg, sonst der Text für das Fenster.
    func aendereAusErfassen(_ k: Tastenkuerzel) -> String? {
        guard let globale else { return "Das Tastenkürzel ist in dieser Sitzung nicht aktiv (Vorschau oder Testlauf)." }
        return globale.setze("schnell-erfassen", k, speichern: true)
    }

    /// Das Kürzel für „Schnell erfassen“ (Standard ⌃⌥Leertaste), wie es im Fenster angezeigt wird.
    var kuerzelFuerErfassen: Tastenkuerzel { belegung?.kuerzel("schnell-erfassen") ?? .standard }

    private func speichereAusApp(_ id: String, _ k: Tastenkuerzel?) {
        guard let register else { return }
        let e: KuerzelBelegung.Eigenes? = k.flatMap { $0.kanonisch }.map { .kuerzel($0) } ?? .ohne
        if KuerzelBelegung.speichere(id: id, e, register: register, pfade: pfade) {
            log.schreibe("kuerzel geaendert \(id) \(k?.anzeige ?? "aus")")
            uebernimm(KuerzelBelegung.laden(register: register, pfade: pfade))
        } else {
            log.schreibe("kuerzel nicht-gespeichert \(id)")
        }
    }

    private func uebernimm(_ neu: KuerzelBelegung) {
        belegung = neu
        stand += 1
        beiMenueAenderung?()
        beiErfassenKuerzel?(kuerzelFuerErfassen)
    }

    // MARK: Menüs

    /// Das Kürzel eines Menüeintrags: nur, wenn der Befehl es hat, die Taste im Menü geht und kein anderer Befehl Vorrang hat (ein Kürzel gehört im Menü einem Eintrag).
    func menueKuerzel(_ id: String) -> (zeichen: String, masken: NSEvent.ModifierFlags)? {
        guard let belegung, let k = belegung.kuerzel(id), let text = k.kanonisch, belegung.gewinner()[text] == id, let z = k.menueZeichen else { return nil }
        var m: NSEvent.ModifierFlags = []
        if k.umschalter.contains(.control) { m.insert(.control) }
        if k.umschalter.contains(.option) { m.insert(.option) }
        if k.umschalter.contains(.shift) { m.insert(.shift) }
        if k.umschalter.contains(.command) { m.insert(.command) }
        return (z, m)
    }

    /// Die Menü-Id des Befehls, der im Studio unter diesem Namen läuft (`StudioBefehl.rawValue`).
    func befehlId(menue: String) -> String? { register?.befehl(menue: menue)?.id }

    /// Dasselbe für SwiftUI (Menü der Menüleiste).
    func swiftUIKuerzel(_ id: String) -> KeyboardShortcut? {
        guard let m = menueKuerzel(id), m.zeichen.count == 1, let c = m.zeichen.first else { return nil }
        let taste: KeyEquivalent
        switch c {
        case " ": taste = .space
        case "\r": taste = .return
        case "\t": taste = .tab
        default:
            guard c.unicodeScalars.allSatisfy({ !($0.value >= 0xF700 && $0.value <= 0xF8FF) }) else { return nil } // Funktionstasten: nur im Hauptmenü
            taste = KeyEquivalent(c)
        }
        var e: EventModifiers = []
        if m.masken.contains(.control) { e.insert(.control) }
        if m.masken.contains(.option) { e.insert(.option) }
        if m.masken.contains(.shift) { e.insert(.shift) }
        if m.masken.contains(.command) { e.insert(.command) }
        return KeyboardShortcut(taste, modifiers: e)
    }
}
