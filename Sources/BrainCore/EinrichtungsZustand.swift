import Foundation

// Gedächtnis des Einrichtungs-Assistenten „Kortex einrichten“ (Web-Seite `brain://studio/einrichtung.html`): nur die Datei
// `<support>/einrichtung.json` und die Frage, ob der Assistent beim Start von selbst erscheinen soll. Die Schritte selbst führt die Seite;
// früher stand hier die Zustandsmaschine des SwiftUI-Assistenten (entfallen).

/// Die drei Schritte des Ablaufs (Overlay im Studio), in dieser Reihenfolge. Die Namen sind der Vertrag mit der Oberfläche (Aktion `einrichtung-schritt`, Befehl `einrichtung`).
public enum EinrichtungsSchritt: String, Codable, Sendable, CaseIterable, Comparable {
    case vault
    case ki
    case sicherung

    public static func < (a: Self, b: Self) -> Bool { allCases.firstIndex(of: a)! < allCases.firstIndex(of: b)! }

    /// Der Schritt danach (nil nach der Sicherung).
    public var naechster: EinrichtungsSchritt? {
        let i = Self.allCases.firstIndex(of: self)! + 1
        return i < Self.allCases.count ? Self.allCases[i] : nil
    }
}

public enum EinrichtungsHerkunft: String, Codable, Sendable {
    /// Beim Start von selbst erschienen (erster Start oder Wiederaufnahme).
    case start
    /// Vom Nutzer über das Menü „Kortex einrichten …“ geöffnet.
    case menue
}

/// `<support>/einrichtung.json` — das Gedächtnis des Assistenten. Nur, was sich nicht aus der Wirklichkeit ablesen lässt.
public struct EinrichtungsDatei: Codable, Equatable, Sendable {
    /// Aktuelle Fassung der Datei (2: `ablaufVersion` und `letzterSchritt`) und des Ablaufs (2: Vault · KI · Sicherung, kein „Fertig“-Bild).
    public static let aktuelleVersion = 2
    public static let aktuelleAblaufVersion = 2

    public var version = EinrichtungsDatei.aktuelleVersion
    /// Welcher Ablauf hat diese Datei geschrieben? Ändert sich der Ablauf (andere Schritte), rechnet `lade()` alte Stände um, statt sie falsch zu lesen.
    public var ablaufVersion = EinrichtungsDatei.aktuelleAblaufVersion
    /// Der zuletzt ERLEDIGTE Schritt (nie rückwärts): das Overlay macht beim nächsten Öffnen mit dem Schritt danach weiter. nil = noch keiner.
    public var letzterSchritt: EinrichtungsSchritt?
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
                herkunft: EinrichtungsHerkunft = .start, letzterSchritt: EinrichtungsSchritt? = nil) {
        self.letzterSchritt = letzterSchritt
        self.abgeschlossen = abgeschlossen
        self.automatischAus = automatischAus
        self.erledigt = erledigt
        self.uebersprungen = uebersprungen
        self.herkunft = herkunft
    }

    private enum CodingKeys: String, CodingKey { case version, ablaufVersion, letzterSchritt, abgeschlossen, automatischAus, erledigt, uebersprungen, herkunft }

    /// Fehlende Felder (Datei aus einer anderen Version) bekommen ihren Standardwert; ein unbekannter Wert bei `herkunft` zählt als `.start`.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = try c.decodeIfPresent(Int.self, forKey: .version) ?? 1
        // Ohne `ablaufVersion` (Dateien vor Fassung 2) galt der alte Ablauf: Willkommen · Vault · Sicherung · KI · Fertig.
        ablaufVersion = try c.decodeIfPresent(Int.self, forKey: .ablaufVersion) ?? 1
        // Ein unbekannter Schritt (Datei aus einer neueren Fassung) zählt als „noch keiner“.
        letzterSchritt = (try c.decodeIfPresent(String.self, forKey: .letzterSchritt)).flatMap(EinrichtungsSchritt.init(rawValue:))
        abgeschlossen = try c.decodeIfPresent(Bool.self, forKey: .abgeschlossen) ?? false
        automatischAus = try c.decodeIfPresent(Bool.self, forKey: .automatischAus) ?? false
        erledigt = try c.decodeIfPresent([String].self, forKey: .erledigt) ?? []
        uebersprungen = try c.decodeIfPresent([String].self, forKey: .uebersprungen) ?? []
        herkunft = (try c.decodeIfPresent(String.self, forKey: .herkunft)).flatMap(EinrichtungsHerkunft.init(rawValue:)) ?? .start
    }

    /// Rechnet eine Datei des alten Ablaufs (`ablaufVersion` < 2) in den neuen um: `letzterSchritt` ist der am weitesten erledigte der drei Schritte aus `erledigt` und `uebersprungen`
    /// (alte Namen: `vault`, `ki`, `sicherung`, `github` zählt als Sicherung), sonst nil; `version` und `ablaufVersion` werden 2. `abgeschlossen`, `automatischAus` und
    /// `herkunft` bleiben, wie sie waren — wer fertig war oder „Später“ gewählt hatte, wird nicht wieder überfallen. Eine Datei mit `ablaufVersion` 2 bleibt unverändert.
    public func umgerechnet() -> EinrichtungsDatei {
        guard ablaufVersion < Self.aktuelleAblaufVersion else { return self }
        var d = self
        d.version = Self.aktuelleVersion
        d.ablaufVersion = Self.aktuelleAblaufVersion
        let alt: [String: EinrichtungsSchritt] = ["vault": .vault, "ki": .ki, "sicherung": .sicherung, "github": .sicherung]
        let erledigteSchritte = (erledigt + uebersprungen).compactMap { alt[$0] }
        d.letzterSchritt = ([letzterSchritt].compactMap { $0 } + erledigteSchritte).max()
        return d
    }
}

/// Liest und schreibt `einrichtung.json`. Eine fehlende oder kaputte Datei heißt „noch nie gelaufen“ — nie ein Absturz.
public struct EinrichtungsSpeicher: Sendable {
    public let datei: URL

    public init(pfade: AppPfade) { datei = pfade.einrichtung }
    public init(datei: URL) { self.datei = datei }

    public func lade() -> EinrichtungsDatei? {
        guard let daten = try? Data(contentsOf: datei) else { return nil }
        return (try? JSONDecoder().decode(EinrichtungsDatei.self, from: daten))?.umgerechnet()
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
