import Foundation

/// Die globalen Tastenkürzel der App (Befehle des Registers mit `global: true`: „Schnell erfassen“, „Frag deinen Vault“, „Kortex nach vorn holen“).
/// Hält je Befehl eine Anmeldung beim System (`KuerzelVerwaltung`, in Tests mit einer Attrappe als `KuerzelRegistrierung`) und bringt sie auf die
/// Belegung des Registers (Standard + `tastenkuerzel.json`): neu anmelden bei Änderung, abmelden bei „ohne Kürzel“. Kein Neustart nötig.
/// Was nicht geht — vom System vergeben (Tastatur-Einstellungen), von einem anderen Programm belegt, reserviert (⌘Q, ⌘Tab, ⌘Leertaste …), ohne ⌃/⌘ —,
/// kommt als Text zurück; dann bleibt das bisherige Kürzel angemeldet. Registrierung und Systemkürzel sind injizierbar, darum läuft all das ohne echtes Kürzel.
@MainActor
public final class GlobaleKuerzel {
    public typealias Fabrik = @MainActor (String) -> KuerzelRegistrierung

    private let register: KuerzelRegister
    private let fabrik: Fabrik
    private let system: () -> [SystemKuerzel]
    private var aktionen: [String: @MainActor () -> Void] = [:]
    private var verwaltungen: [String: KuerzelVerwaltung] = [:]
    /// Wird mit (id, neues Kürzel) aufgerufen, wenn die App selbst ein Kürzel geändert hat (Erfassen-Fenster) — dort schreibt der Aufrufer die Datei.
    public var beiAenderung: ((String, Tastenkuerzel?) -> Void)?

    /// `system`: die von macOS vergebenen Kürzel (`SystemKuerzelLeser.ausSystem`); die reservierten des Registers kommen immer dazu.
    public init(register: KuerzelRegister, system: @escaping () -> [SystemKuerzel], fabrik: @escaping Fabrik) {
        self.register = register
        self.fabrik = fabrik
        let reserviert = register.reserviertAlsSystem
        self.system = { system() + reserviert }
    }

    /// Was beim Druck des globalen Kürzels geschieht.
    public func setzeAktion(_ id: String, _ aktion: @escaping @MainActor () -> Void) { aktionen[id] = aktion }

    /// Die angemeldeten Kürzel (id → Kürzel), zum Prüfen in Tests und im Log.
    public var angemeldet: [String: Tastenkuerzel] {
        verwaltungen.compactMapValues { $0.angemeldet ? $0.kuerzel : nil }
    }

    public func kuerzel(_ id: String) -> Tastenkuerzel? { verwaltungen[id]?.kuerzel }

    /// Bringt alle globalen Kürzel auf die Belegung. Rückgabe: je Befehl, der nicht ging (oder nur mit Warnung), der Text für den Nutzer.
    /// `start: true` (beim Start der App): Ein Kürzel, das macOS in den Tastatur-Einstellungen nachträglich vergeben hat, wird trotzdem angemeldet, wenn das System es zulässt
    /// (der Nutzer hat es vielleicht bewusst so gewählt) — mit Warnung. Danach, bei jeder Änderung, gilt die strenge Prüfung von `setze`.
    @discardableResult
    public func wendeAn(_ belegung: KuerzelBelegung, start: Bool = false) -> [String: String] {
        var fehler: [String: String] = [:]
        for b in register.befehle where b.global {
            guard let aktion = aktionen[b.id] else { continue }
            let k = belegung.kuerzel(b.id)
            if start, verwaltungen[b.id] == nil, let k {
                let v = KuerzelVerwaltung(registrierung: fabrik(b.id), gespeichert: k, system: system, sichere: { _ in }, aktion: aktion)
                let hinweis = v.starte()
                if v.angemeldet { verwaltungen[b.id] = v }
                if let hinweis { fehler[b.id] = hinweis }
            } else if let f = setze(b.id, k, speichern: false) { fehler[b.id] = f }
        }
        return fehler
    }

    /// Prüft ein Kürzel für einen globalen Befehl und meldet es an (nil = abmelden). Rückgabe: nil bei Erfolg, sonst der Text für den Nutzer; bei einem Fehler bleibt das
    /// bisherige Kürzel angemeldet. `speichern: true` (Erfassen-Fenster der App): `beiAenderung` bekommt die Änderung, damit der Aufrufer die Datei schreibt.
    public func setze(_ id: String, _ neu: Tastenkuerzel?, speichern: Bool) -> String? {
        guard let befehl = register.befehl(id), befehl.global, let aktion = aktionen[id] else { return "Dieses Kürzel gibt es nicht." }
        guard let neu else {
            if let v = verwaltungen.removeValue(forKey: id) { v.beende() }
            if speichern { beiAenderung?(id, nil) }
            return nil
        }
        if let v = verwaltungen[id] {
            let fehler = v.aendere(neu, speichern: false)
            if fehler == nil, speichern { beiAenderung?(id, neu) }
            return fehler
        }
        if let problem = KuerzelPruefung.pruefe(neu, system: system()) { return problem.text }
        let v = KuerzelVerwaltung(registrierung: fabrik(id), gespeichert: neu, system: system, sichere: { _ in }, aktion: aktion)
        let hinweis = v.starte()
        guard v.angemeldet else { v.beende(); return hinweis ?? "Das Kürzel ließ sich nicht anmelden." }
        verwaltungen[id] = v
        if speichern { beiAenderung?(id, neu) }
        return nil
    }

    public func beende() {
        for v in verwaltungen.values { v.beende() }
        verwaltungen.removeAll()
    }
}
