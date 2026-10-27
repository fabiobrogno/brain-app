import Foundation

// Vertrag mit dem Kit (B2: rueckfragen.mjs, zurueck.mjs, status.mjs, Spec Lernkreislauf §5.3/§5.4).
// Alles, was das Format des Kits kennt, steht in dieser Datei — ändert sich der echte Kit-Code, wird nur hier angepasst.

public enum RueckfragenFehler: Error, Equatable {
    case leereAusgabe
    /// Meldung des Kits (stderr, erste Zeile), alltagstauglich und ohne Stacktrace.
    case abgelehnt(String)
    case ungueltigeLauf
}

/// Eine mögliche Antwort. `wahl` ist der Wert für `brain rueckfragen antwort <id> <wahl>`.
public struct RueckfrageOption: Decodable, Equatable, Sendable, Identifiable {
    public let wahl: String
    public let label: String
    public let wirkung: String
    public var id: String { wahl }

    public init(wahl: String, label: String, wirkung: String = "") {
        self.wahl = wahl
        self.label = label
        self.wirkung = wirkung
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: Schluessel.self)
        wahl = try c.decode(String.self, forKey: .wahl)
        label = try c.decode(String.self, forKey: .label)
        wirkung = try c.decodeIfPresent(String.self, forKey: .wirkung) ?? ""
    }
    private enum Schluessel: String, CodingKey { case wahl, label, wirkung }
}

/// Eine offene Rückfrage (Ausgabe von `brain rueckfragen liste`, je Eintrag `fuerSkill`).
public struct Rueckfrage: Decodable, Equatable, Sendable, Identifiable {
    public let id: String
    public let typ: String
    public let header: String
    public let frage: String
    /// Enthält Zitat und Quelle bzw. A/B als Fließtext (Zeilen getrennt durch \n).
    public let beschreibung: String
    public let seite: String
    public let optionen: [RueckfrageOption]

    public init(id: String, typ: String, header: String, frage: String, beschreibung: String = "",
                seite: String = "", optionen: [RueckfrageOption]) {
        self.id = id
        self.typ = typ
        self.header = header
        self.frage = frage
        self.beschreibung = beschreibung
        self.seite = seite
        self.optionen = optionen
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: Schluessel.self)
        id = try c.decode(String.self, forKey: .id)
        typ = try c.decode(String.self, forKey: .typ)
        header = try c.decodeIfPresent(String.self, forKey: .header) ?? ""
        frage = try c.decode(String.self, forKey: .frage)
        beschreibung = try c.decodeIfPresent(String.self, forKey: .beschreibung) ?? ""
        seite = try c.decodeIfPresent(String.self, forKey: .seite) ?? ""
        optionen = try c.decode([RueckfrageOption].self, forKey: .optionen)
    }
    private enum Schluessel: String, CodingKey { case id, typ, header, frage, beschreibung, seite, optionen }

    /// Zeilen der Beschreibung ohne Leerzeilen — die Ansicht zeigt sie als Beleg.
    public var belegZeilen: [String] {
        beschreibung.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }
}

public struct RueckfragenListe: Decodable, Equatable, Sendable {
    public let fragen: [Rueckfrage]
    /// Rückfragen über dem Deckel (10): warten und werden nicht gezeigt.
    public let wartend: Int

    public init(fragen: [Rueckfrage], wartend: Int = 0) {
        self.fragen = fragen
        self.wartend = wartend
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: Schluessel.self)
        fragen = try c.decode([Rueckfrage].self, forKey: .fragen)
        wartend = try c.decodeIfPresent(Int.self, forKey: .wartend) ?? 0
    }
    private enum Schluessel: String, CodingKey { case fragen, wartend }

    /// Liest die letzte nicht-leere Zeile (das Kit gibt die Liste als eine JSON-Zeile aus).
    public static func aus(ausgabe: String) throws -> RueckfragenListe {
        try JSONDecoder().decode(RueckfragenListe.self, from: Data(try letzteZeile(ausgabe).utf8))
    }
}

/// Fehlerquote der Selbstbremse (`fehler` von `geprueft` automatischen Übernahmen).
public struct Fehlerquote: Decodable, Equatable, Sendable {
    public let fehler: Int
    public let geprueft: Int
}

/// Kurzform des letzten Tageslaufs: Block `tageslauf` in `brain status --json` (bzw. `.logs/tageslauf/letzter.json`).
public struct TageslaufKurz: Decodable, Equatable, Sendable {
    public struct Zahlen: Decodable, Equatable, Sendable {
        public let uebernommen: Int
        public let aussortiert: Int
        public let rueckfragen: Int

        public init(uebernommen: Int = 0, aussortiert: Int = 0, rueckfragen: Int = 0) {
            self.uebernommen = uebernommen
            self.aussortiert = aussortiert
            self.rueckfragen = rueckfragen
        }

        public init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: Schluessel.self)
            uebernommen = try c.decodeIfPresent(Int.self, forKey: .uebernommen) ?? 0
            aussortiert = try c.decodeIfPresent(Int.self, forKey: .aussortiert) ?? 0
            rueckfragen = try c.decodeIfPresent(Int.self, forKey: .rueckfragen) ?? 0
        }
        private enum Schluessel: String, CodingKey { case uebernommen, aussortiert, rueckfragen }
    }
    /// Schalter in der Konfiguration: aus | probe | an.
    public let schalter: String?
    /// Lauf-Modus: an | probe.
    public let modus: String?
    /// ok | teilweise | ohne-ki | abgebrochen | fehler.
    public let status: String?
    public let zeit: String?
    public let autostufe: String?
    public let fehlerquote: Fehlerquote?
    public let zahlen: Zahlen?
}

public enum Rueckfragen {
    /// Die Lauf-Nummer des Kits (`JJJJMMTT-HHMMSS`) — nur so wird sie an `brain zurueck` weitergereicht.
    public static func istLaufNummer(_ text: String) -> Bool {
        text.range(of: #"^\d{8}-\d{6}$"#, options: .regularExpression) != nil
    }

    /// Antwort-Wahl und Rückfrage-ID kommen aus dem Kit; als Befehlsargument nur schlichte Zeichen zulassen.
    static func istSchlicht(_ text: String) -> Bool {
        !text.isEmpty && text.range(of: #"^[A-Za-z0-9][A-Za-z0-9-]{0,80}$"#, options: .regularExpression) != nil
    }
}

func letzteZeile(_ ausgabe: String) throws -> String {
    guard let zeile = ausgabe.split(separator: "\n").last(where: { !$0.trimmingCharacters(in: .whitespaces).isEmpty })
    else { throw RueckfragenFehler.leereAusgabe }
    return String(zeile)
}

extension BrainBefehl {
    /// `brain rueckfragen liste` — eine Abfrage, kein Polling (die App ruft sie beim Öffnen der Ansicht auf).
    public func rueckfragen(zeitlimit: Duration = .seconds(20)) async throws -> RueckfragenListe {
        let r = try await fuehreAus(["rueckfragen", "liste"], zeitlimit: zeitlimit)
        guard r.code == 0 else { throw RueckfragenFehler.abgelehnt(Self.meldung(r)) }
        return try RueckfragenListe.aus(ausgabe: r.ausgabe)
    }

    /// `brain rueckfragen antwort <id> <wahl> [notiz]` — wird sofort gespeichert; angewendet wird später (siehe `antwortenAnwenden`).
    public func antworte(id: String, wahl: String, notiz: String = "", zeitlimit: Duration = .seconds(20)) async throws {
        guard Rueckfragen.istSchlicht(id), Rueckfragen.istSchlicht(wahl) else { throw RueckfragenFehler.abgelehnt("Diese Antwort passt nicht.") }
        let n = notiz.trimmingCharacters(in: .whitespacesAndNewlines)
        let r = try await fuehreAus(["rueckfragen", "antwort", id, wahl] + (n.isEmpty ? [] : [n]), zeitlimit: zeitlimit)
        guard r.code == 0 else { throw RueckfragenFehler.abgelehnt(Self.meldung(r)) }
    }

    /// Stößt das Anwenden gespeicherter Antworten an (wie der Skill `/rueckfragen` am Ende): löst sich vom Aufrufer.
    public func antwortenAnwenden(zeitlimit: Duration = .seconds(20)) async throws {
        let r = try await fuehreAus(["tageslauf", "--nur-antworten", "--losgeloest"], zeitlimit: zeitlimit)
        guard r.code == 0 else { throw RueckfragenFehler.abgelehnt(Self.meldung(r)) }
    }

    /// `brain zurueck <lauf>` — nimmt die automatischen Übernahmen eines Laufs zurück (git revert, nichts wird umgeschrieben).
    public func nimmZurueck(lauf: String, zeitlimit: Duration = .seconds(120)) async throws -> String {
        guard Rueckfragen.istLaufNummer(lauf) else { throw RueckfragenFehler.ungueltigeLauf }
        let r = try await fuehreAus(["zurueck", lauf], zeitlimit: zeitlimit)
        guard r.code == 0 else { throw RueckfragenFehler.abgelehnt(Self.meldung(r)) }
        return r.ausgabe.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Erste nicht-leere Zeile von stderr (das Kit schreibt dort einen Alltagssatz), sonst ein Standardtext.
    static func meldung(_ r: BefehlErgebnis) -> String {
        r.fehler.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.first { !$0.isEmpty }
            ?? "Das hat gerade nicht geklappt."
    }
}
