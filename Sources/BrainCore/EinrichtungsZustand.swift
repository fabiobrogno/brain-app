import Foundation

// Gedächtnis des Einrichtungs-Assistenten „Kortex einrichten“ (Web-Seite `brain://studio/einrichtung.html`): nur die Datei
// `<support>/einrichtung.json` und die Frage, ob der Assistent beim Start von selbst erscheinen soll. Die Schritte selbst führt die Seite;
// früher stand hier die Zustandsmaschine des SwiftUI-Assistenten (entfallen).

public enum EinrichtungsHerkunft: String, Codable, Sendable {
    /// Beim Start von selbst erschienen (erster Start oder Wiederaufnahme).
    case start
    /// Vom Nutzer über das Menü „Kortex einrichten …“ geöffnet.
    case menue
}

/// `<support>/einrichtung.json` — das Gedächtnis des Assistenten. Nur, was sich nicht aus der Wirklichkeit ablesen lässt.
public struct EinrichtungsDatei: Codable, Equatable, Sendable {
    public var version = 1
    /// Der Assistent ist einmal bis zum Ende durchgelaufen („Fertig“).
    public var abgeschlossen = false
    /// Der Nutzer hat „Später“ gewählt: er erscheint nicht mehr von selbst (das Menü bietet ihn weiter an).
    public var automatischAus = false
    /// Nur noch für ältere Dateien erhalten (Schritte des früheren SwiftUI-Assistenten): wird gelesen und mitgeschrieben, aber nicht mehr ausgewertet.
    public var erledigt: [String] = []
    public var uebersprungen: [String] = []
    /// Woher kam der letzte Lauf? Ein Lauf aus dem Menü wird nie von selbst wieder aufgenommen, wenn es schon einen Vault gibt
    /// (sonst erschiene der Assistent bei jedem Start statt des Studios, nur weil ein Nutzer ihn einmal mittendrin geschlossen hat).
    public var herkunft = EinrichtungsHerkunft.start

    public init(abgeschlossen: Bool = false, automatischAus: Bool = false, erledigt: [String] = [], uebersprungen: [String] = [],
                herkunft: EinrichtungsHerkunft = .start) {
        self.abgeschlossen = abgeschlossen
        self.automatischAus = automatischAus
        self.erledigt = erledigt
        self.uebersprungen = uebersprungen
        self.herkunft = herkunft
    }

    private enum CodingKeys: String, CodingKey { case version, abgeschlossen, automatischAus, erledigt, uebersprungen, herkunft }

    /// Fehlende Felder (Datei aus einer anderen Version) bekommen ihren Standardwert; ein unbekannter Wert bei `herkunft` zählt als `.start`.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = try c.decodeIfPresent(Int.self, forKey: .version) ?? 1
        abgeschlossen = try c.decodeIfPresent(Bool.self, forKey: .abgeschlossen) ?? false
        automatischAus = try c.decodeIfPresent(Bool.self, forKey: .automatischAus) ?? false
        erledigt = try c.decodeIfPresent([String].self, forKey: .erledigt) ?? []
        uebersprungen = try c.decodeIfPresent([String].self, forKey: .uebersprungen) ?? []
        herkunft = (try c.decodeIfPresent(String.self, forKey: .herkunft)).flatMap(EinrichtungsHerkunft.init(rawValue:)) ?? .start
    }
}

/// Liest und schreibt `einrichtung.json`. Eine fehlende oder kaputte Datei heißt „noch nie gelaufen“ — nie ein Absturz.
public struct EinrichtungsSpeicher: Sendable {
    public let datei: URL

    public init(pfade: AppPfade) { datei = pfade.einrichtung }
    public init(datei: URL) { self.datei = datei }

    public func lade() -> EinrichtungsDatei? {
        guard let daten = try? Data(contentsOf: datei) else { return nil }
        return try? JSONDecoder().decode(EinrichtungsDatei.self, from: daten)
    }

    public func speichere(_ d: EinrichtungsDatei) throws {
        try FileManager.default.createDirectory(at: datei.deletingLastPathComponent(), withIntermediateDirectories: true)
        let kodierer = JSONEncoder()
        kodierer.outputFormatting = [.prettyPrinted, .sortedKeys]
        try kodierer.encode(d).write(to: datei, options: .atomic)
    }

    /// Soll der Assistent beim Start von selbst erscheinen?
    /// - Noch nie gelaufen: nur auf einem Mac ohne aktiven Vault (wer die App schon nutzt, wird nicht überfallen; das Menü bietet ihn an).
    /// - Gelaufen und fertig oder mit „Später“ beiseitegelegt: nein.
    /// - Mittendrin abgebrochen (Fenster zu, App beendet, Absturz): ja, er macht dort weiter — außer der Lauf kam aus dem Menü und
    ///   es gibt schon einen Vault: wer die App nutzt und den Assistenten nur nachträglich geöffnet hat, wird nicht bei jedem Start
    ///   damit empfangen.
    public func sollErscheinen(hatVault: Bool) -> Bool {
        guard let d = lade() else { return !hatVault }
        if d.abgeschlossen || d.automatischAus { return false }
        if d.herkunft == .menue && hatVault { return false }
        return true
    }
}
