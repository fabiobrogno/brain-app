import Foundation

/// Die Schritte des Assistenten „Kortex einrichten“ in fester Reihenfolge (Nordstern Meilenstein 2, App-Spec §9.1). Eine weitere
/// Stufe (z. B. „Sicherung“, FBL-88) kommt hier als neuer Fall an die richtige Stelle in die Liste; Zustandsmaschine, Speicher
/// und Fortschrittsanzeige richten sich nach `allCases`.
///
/// Reihenfolge: git steht vor dem Vault, weil „Neues Brain“ und „Von GitHub klonen“ git brauchen (Spec §9.1 nennt den Vault zuerst;
/// die Reihenfolge ist hier der Code-Realität angepasst — ist git schon da, geht der Schritt ohne Klick vorbei).
public enum EinrichtungsSchritt: String, CaseIterable, Codable, Sendable {
    case git, vault, github, ki, probe

    public var titel: String {
        switch self {
        case .git: return "git"
        case .vault: return "Vault"
        case .github: return "GitHub"
        case .ki: return "KI"
        case .probe: return "Probe"
        }
    }

    /// git und der Vault sind Pflicht; alles andere darf der Nutzer auslassen (kein Konto, keine KI-App, kein Interesse).
    public var darfUebersprungenWerden: Bool {
        switch self {
        case .git, .vault: return false
        case .github, .ki, .probe: return true
        }
    }

    /// Wird dieser Schritt nach einem Abbruch aus der Wirklichkeit neu festgestellt (git installiert? Vault aktiv? Konto im
    /// Schlüsselbund?) — oder muss der Assistent sich merken, dass er erledigt ist (KI verbunden, Probe bestanden)?
    var ausWirklichkeit: Bool {
        switch self {
        case .git, .vault, .github: return true
        case .ki, .probe: return false
        }
    }
}

public enum SchrittStand: Equatable, Sendable {
    case offen, erledigt, uebersprungen
}

/// Reine Zustandsmaschine des Assistenten — keine Prozesse, keine Dateien, keine Zeit. Sie weiß nur, welcher Schritt dran ist,
/// was erledigt oder übersprungen wurde und welcher Schritt gerade einen Fehler zeigt. Was „erledigt“ heißt, stellt der Ablauf
/// (`EinrichtungsAblauf`) aus der Wirklichkeit fest und meldet es hierher.
public struct EinrichtungsZustand: Equatable, Sendable {
    public private(set) var staende: [EinrichtungsSchritt: SchrittStand]
    /// Der Schritt, der gerade angezeigt wird; nil = alles erledigt oder übersprungen.
    public private(set) var aktuell: EinrichtungsSchritt?
    /// Sichtbarer Fehler je Schritt (Text für den Nutzer). Verschwindet beim nächsten Versuch oder wenn der Schritt erledigt ist.
    public private(set) var fehler: [EinrichtungsSchritt: String]

    /// Frischer Start: alles offen. Mit `gespeichert` (Wiederaufnahme nach Abbruch) gelten die gemerkten Schritte KI und Probe
    /// als erledigt und die vom Nutzer übersprungenen als übersprungen; git, Vault und GitHub stellt der Ablauf neu fest.
    public init(gespeichert: EinrichtungsDatei? = nil) {
        var s = Dictionary(uniqueKeysWithValues: EinrichtungsSchritt.allCases.map { ($0, SchrittStand.offen) })
        if let g = gespeichert {
            for schritt in g.schritte(g.erledigt) where !schritt.ausWirklichkeit { s[schritt] = .erledigt }
            for schritt in g.schritte(g.uebersprungen) where schritt.darfUebersprungenWerden { s[schritt] = .uebersprungen }
        }
        staende = s
        fehler = [:]
        aktuell = nil
        aktuell = ersterOffener
    }

    private var ersterOffener: EinrichtungsSchritt? {
        EinrichtungsSchritt.allCases.first { staende[$0] == .offen }
    }

    public var istFertig: Bool { aktuell == nil }

    public func stand(_ s: EinrichtungsSchritt) -> SchrittStand { staende[s] ?? .offen }

    /// Erledigte und übersprungene Schritte, für die Fortschrittsanzeige.
    public var fortschritt: (fertig: Int, gesamt: Int) {
        (EinrichtungsSchritt.allCases.filter { stand($0) != .offen }.count, EinrichtungsSchritt.allCases.count)
    }

    /// Der Schritt vor `aktuell` (bei fertig: der letzte), nil beim ersten.
    public var vorherigerSchritt: EinrichtungsSchritt? {
        let alle = EinrichtungsSchritt.allCases
        let ziel = aktuell.flatMap { alle.firstIndex(of: $0) } ?? alle.count
        return ziel > 0 ? alle[ziel - 1] : nil
    }

    // MARK: Übergänge

    /// Der Schritt ist erledigt (auch ein späterer, den die Wirklichkeit schon erfüllt) — weiter zum ersten offenen.
    public mutating func meldeErledigt(_ s: EinrichtungsSchritt) {
        staende[s] = .erledigt
        fehler[s] = nil
        aktuell = ersterOffener
    }

    /// Überspringen: nur Schritte, die der Nutzer auslassen darf. Gibt zurück, ob es geklappt hat.
    @discardableResult
    public mutating func ueberspringe(_ s: EinrichtungsSchritt) -> Bool {
        guard s.darfUebersprungenWerden, stand(s) != .erledigt else { return false }
        staende[s] = .uebersprungen
        fehler[s] = nil
        aktuell = ersterOffener
        return true
    }

    /// Der Schritt ist gescheitert: bleibt offen und zeigt `meldung`. Ein leerer Text wird durch einen Standardtext ersetzt —
    /// ein Fehler ohne Text gibt es nicht.
    public mutating func meldeFehler(_ s: EinrichtungsSchritt, _ meldung: String) {
        let text = meldung.trimmingCharacters(in: .whitespacesAndNewlines)
        fehler[s] = text.isEmpty ? "Das hat nicht geklappt." : text
    }

    public mutating func loescheFehler(_ s: EinrichtungsSchritt) { fehler[s] = nil }

    /// Zurück zu einem Schritt, der schon dran war (oder gerade dran ist): er wird wieder angezeigt, Spätere bleiben unberührt.
    /// Vor dem aktuellen Schritt oder nach „fertig“ ist das jeder; auf spätere Schritte kann man nicht springen. Gibt zurück, ob es ging.
    @discardableResult
    public mutating func geheZu(_ s: EinrichtungsSchritt) -> Bool {
        let alle = EinrichtungsSchritt.allCases
        guard let ziel = alle.firstIndex(of: s) else { return false }
        let grenze = aktuell.flatMap { alle.firstIndex(of: $0) } ?? alle.count
        guard ziel <= grenze else { return false }
        staende[s] = .offen
        fehler[s] = nil
        aktuell = s
        return true
    }

    /// Wiederholung über das Menü: KI und Probe werden noch einmal gezeigt, Überspringen-Entscheidungen gelten nicht mehr.
    public mutating func setzeZurueck() {
        for s in EinrichtungsSchritt.allCases { staende[s] = .offen }
        fehler = [:]
        aktuell = ersterOffener
    }

    // MARK: Gedächtnis

    /// Was die nächste Sitzung braucht, um an der richtigen Stelle weiterzumachen.
    public func datei(abgeschlossen: Bool, automatischAus: Bool) -> EinrichtungsDatei {
        let alle = EinrichtungsSchritt.allCases
        return EinrichtungsDatei(abgeschlossen: abgeschlossen, automatischAus: automatischAus,
                                 erledigt: alle.filter { stand($0) == .erledigt && !$0.ausWirklichkeit }.map(\.rawValue),
                                 uebersprungen: alle.filter { stand($0) == .uebersprungen }.map(\.rawValue))
    }
}

/// `<support>/einrichtung.json` — das Gedächtnis des Assistenten. Nur, was sich nicht aus der Wirklichkeit ablesen lässt.
public struct EinrichtungsDatei: Codable, Equatable, Sendable {
    public var version = 1
    /// Der Assistent ist einmal bis zum Ende durchgelaufen.
    public var abgeschlossen = false
    /// Der Nutzer hat „Später“ gewählt: er erscheint nicht mehr von selbst (das Menü bietet ihn weiter an).
    public var automatischAus = false
    /// Schritte, die sich nicht aus der Wirklichkeit ablesen lassen und erledigt sind (KI verbunden, Probe bestanden).
    public var erledigt: [String] = []
    public var uebersprungen: [String] = []

    public init(abgeschlossen: Bool = false, automatischAus: Bool = false, erledigt: [String] = [], uebersprungen: [String] = []) {
        self.abgeschlossen = abgeschlossen
        self.automatischAus = automatischAus
        self.erledigt = erledigt
        self.uebersprungen = uebersprungen
    }

    /// Unbekannte Namen (Datei aus einer anderen Version) werden ignoriert, nicht als Fehler gewertet.
    func schritte(_ namen: [String]) -> [EinrichtungsSchritt] { namen.compactMap(EinrichtungsSchritt.init(rawValue:)) }
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
    /// - Mittendrin abgebrochen (Fenster zu, App beendet, Absturz): ja, er macht dort weiter.
    public func sollErscheinen(hatVault: Bool) -> Bool {
        guard let d = lade() else { return !hatVault }
        return !d.abgeschlossen && !d.automatischAus
    }
}
