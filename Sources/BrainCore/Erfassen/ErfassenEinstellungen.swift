import Foundation

/// Was „Schnell erfassen“ sich merkt: das gewählte Tastenkürzel (fehlt = Standard ⌃⌥Leertaste) und ob zuletzt eine Aufgabe oder eine
/// Notiz erfasst wurde. Eigene Datei `<support>/schnell-erfassen.json`; kaputt oder fehlend ergibt die Standardwerte, nie einen Fehler.
public struct ErfassenEinstellungen: Codable, Equatable, Sendable {
    public var kuerzel: Tastenkuerzel?
    public var art: ErfassungsArt?

    public init(kuerzel: Tastenkuerzel? = nil, art: ErfassungsArt? = nil) {
        self.kuerzel = kuerzel
        self.art = art
    }

    public var wirksamesKuerzel: Tastenkuerzel { kuerzel ?? .standard }

    public static func datei(_ pfade: AppPfade) -> URL { pfade.basis.appendingPathComponent("schnell-erfassen.json") }

    public static func lade(_ pfade: AppPfade) -> ErfassenEinstellungen {
        guard let daten = try? Data(contentsOf: datei(pfade)),
              let e = try? JSONDecoder().decode(ErfassenEinstellungen.self, from: daten) else { return ErfassenEinstellungen() }
        return e
    }

    public func speichere(_ pfade: AppPfade) throws {
        try FileManager.default.createDirectory(at: pfade.basis, withIntermediateDirectories: true)
        let kodierer = JSONEncoder()
        kodierer.outputFormatting = [.prettyPrinted, .sortedKeys]
        try kodierer.encode(self).write(to: Self.datei(pfade), options: .atomic)
    }
}

/// Meldet das Tastenkürzel an und ändert es auf Wunsch. Die Anmeldung beim System läuft über `KuerzelRegistrierung` (in Tests eine
/// Attrappe), die Systemkürzel kommen als Funktion, das Speichern ebenfalls.
@MainActor
public final class KuerzelVerwaltung {
    private let registrierung: KuerzelRegistrierung
    private let system: () -> [SystemKuerzel]
    private let sichere: (Tastenkuerzel?) -> Void
    private let aktion: @MainActor () -> Void
    public private(set) var kuerzel: Tastenkuerzel
    /// Ist das Kürzel gerade beim System angemeldet?
    public private(set) var angemeldet = false

    /// `gespeichert` = das Kürzel aus den Einstellungen (nil = Standard); `sichere` bekommt bei einer Änderung den neuen Wert
    /// (`nil` = zurück auf den Standard).
    public init(registrierung: KuerzelRegistrierung, gespeichert: Tastenkuerzel?, system: @escaping () -> [SystemKuerzel],
                sichere: @escaping (Tastenkuerzel?) -> Void, aktion: @escaping @MainActor () -> Void) {
        self.registrierung = registrierung
        self.kuerzel = gespeichert ?? .standard
        self.system = system
        self.sichere = sichere
        self.aktion = aktion
    }

    /// Meldet das gespeicherte Kürzel beim Start an. Rückgabe: Hinweis für den Nutzer, wenn es nicht ging (belegt, vom System vergeben).
    @discardableResult
    public func starte() -> String? {
        if let problem = KuerzelPruefung.pruefe(kuerzel, system: system()) {
            // Ein vom System belegtes Kürzel melden wir trotzdem an, wenn das Betriebssystem es zulässt: Der Nutzer hat es vielleicht
            // bewusst so gewählt, bevor die Systemeinstellung dazukam. Eine Warnung gibt es aber immer.
            return anmelden() ?? problem.text
        }
        return anmelden()
    }

    /// Setzt ein neues Kürzel. Nur ein gültiges, nicht belegtes wird gespeichert; bei einem Fehler bleibt das alte angemeldet.
    /// Rückgabe: nil bei Erfolg, sonst der Text für den Nutzer.
    /// `speichern: false`: nur prüfen und anmelden (das Studio hat das Kürzel schon in `tastenkuerzel.json` geschrieben oder tut es gleich selbst).
    public func aendere(_ neu: Tastenkuerzel, speichern: Bool = true) -> String? {
        if neu == kuerzel, angemeldet { return nil }
        if let problem = KuerzelPruefung.pruefe(neu, system: system()) { return problem.text }
        let alt = kuerzel
        kuerzel = neu
        if let fehler = anmelden() {
            kuerzel = alt
            _ = anmelden() // das alte wieder anmelden (die Anmeldung des neuen hat es abgemeldet)
            return fehler
        }
        if speichern { sichere(neu == .standard ? nil : neu) }
        return nil
    }

    public func setzeZurueck() -> String? { aendere(.standard) }

    public func beende() {
        registrierung.hebeAuf()
        angemeldet = false
    }

    private func anmelden() -> String? {
        do {
            try registrierung.registriere(kuerzel, aktion: aktion)
            angemeldet = true
            return nil
        } catch {
            angemeldet = false
            return (error as? KuerzelFehler)?.text ?? "Das Kürzel ließ sich nicht anmelden."
        }
    }
}
