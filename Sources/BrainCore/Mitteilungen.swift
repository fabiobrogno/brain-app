import Foundation

// Mitteilungen und Aktivität (Paket P8a), Swift-Teil. Reine Logik ohne UserNotifications: das Backend schreibt das Aktivitätsprotokoll
// (`<Support>/aktivitaet/<Kennung>.jsonl`, Format in `Ressourcen/gemeinsam/aktivitaet.mjs`), der `AktivitaetsLeser` liest nur NEUE Zeilen,
// der `MitteilungsPlaner` filtert, gruppiert und drosselt, der `MitteilungsAblauf` verbindet beides mit einem `MitteilungsZentrum`
// (in der App: `SystemMitteilungsZentrum` mit `UNUserNotificationCenter`; in Tests eine Attrappe). Nichts hier braucht echte Zeit
// oder einen echten Mitteilungsdienst.

// MARK: Ereignis

/// Ein Eintrag des Aktivitätsprotokolls. Gelesen werden nur die Felder, die Mitteilungen brauchen; Inhalt gibt es im Protokoll nie.
public struct AktivitaetsEreignis: Codable, Equatable, Sendable {
    public var id: String
    public var zeit: Date
    public var art: String
    /// Kennung des Vaults (16 Hex) — Teil des Dateinamens, nicht der Pfad.
    public var vault: String?
    public var vaultName: String?
    public var konto: String?
    public var programm: String?
    /// Der Handelnde („Claude Code · Privat“); fehlt bei Systemereignissen (Sicherung, Pflege).
    public var wer: String?
    public var grund: String?
    /// Der Satz ohne den Handelnden („hat eine Aufgabe angelegt.“); bei Systemereignissen ein ganzer Satz.
    public var text: String
    public var pfade: [String]
    public var anzahl: Int?
    /// Hat das Ereignis einen Rückgängig-Weg? (Im Protokoll steht dazu ein Objekt; hier zählt nur, dass es da ist.)
    public var istRueckgaengigFaehig: Bool

    public init(id: String, zeit: Date, art: String, vault: String? = nil, vaultName: String? = nil, konto: String? = nil, programm: String? = nil,
                wer: String? = nil, grund: String? = nil, text: String = "", pfade: [String] = [], anzahl: Int? = nil, istRueckgaengigFaehig: Bool = false) {
        self.id = id; self.zeit = zeit; self.art = art; self.vault = vault; self.vaultName = vaultName; self.konto = konto; self.programm = programm
        self.wer = wer; self.grund = grund; self.text = text; self.pfade = pfade; self.anzahl = anzahl; self.istRueckgaengigFaehig = istRueckgaengigFaehig
    }

    private enum CodingKeys: String, CodingKey {
        case id, zeit, art, vault, vaultName, konto, programm, wer, grund, text, pfade, anzahl, rueckgaengig
    }

    /// Längste übernommene Texte (das Backend begrenzt selbst; hier noch einmal, damit eine fremde Zeile nie eine Riesenmitteilung baut).
    static let maxKurz = 80
    static let maxText = 300

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let id = try c.decode(String.self, forKey: .id)
        let art = try c.decode(String.self, forKey: .art)
        guard !id.isEmpty, id.count <= 64, !art.isEmpty, art.count <= 40 else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "id/art"))
        }
        let zeitText = try c.decode(String.self, forKey: .zeit)
        guard let zeit = AktivitaetsZeit.lies(zeitText) else {
            throw DecodingError.dataCorrupted(.init(codingPath: [CodingKeys.zeit], debugDescription: "zeit"))
        }
        func kurz(_ k: CodingKeys, _ max: Int) -> String? {
            guard let s = (try? c.decodeIfPresent(String.self, forKey: k)) ?? nil else { return nil }
            let t = String(s.trimmingCharacters(in: .whitespacesAndNewlines).prefix(max))
            return t.isEmpty ? nil : t
        }
        self.id = id
        self.zeit = zeit
        self.art = art
        self.vault = kurz(.vault, 64)
        self.vaultName = kurz(.vaultName, Self.maxKurz)
        self.konto = kurz(.konto, 40)
        self.programm = kurz(.programm, 40)
        self.wer = kurz(.wer, Self.maxKurz)
        self.grund = kurz(.grund, 30)
        self.text = kurz(.text, Self.maxText) ?? ""
        self.pfade = ((try? c.decodeIfPresent([String].self, forKey: .pfade)) ?? nil)?.prefix(10).map { String($0.prefix(300)) } ?? []
        if let n = (try? c.decodeIfPresent(Int.self, forKey: .anzahl)) ?? nil, n >= 1, n <= 9999 { self.anzahl = n } else { self.anzahl = nil }
        // Objekt (Protokollzeile) oder Bool (Ereignis-Strom): da und nicht false/null = rückgängig-fähig.
        if c.contains(.rueckgaengig), (try? c.decodeNil(forKey: .rueckgaengig)) == false {
            self.istRueckgaengigFaehig = (try? c.decode(Bool.self, forKey: .rueckgaengig)) ?? true
        } else {
            self.istRueckgaengigFaehig = false
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(AktivitaetsZeit.text(zeit), forKey: .zeit)
        try c.encode(art, forKey: .art)
        try c.encodeIfPresent(vault, forKey: .vault)
        try c.encodeIfPresent(vaultName, forKey: .vaultName)
        try c.encodeIfPresent(konto, forKey: .konto)
        try c.encodeIfPresent(programm, forKey: .programm)
        try c.encodeIfPresent(wer, forKey: .wer)
        try c.encodeIfPresent(grund, forKey: .grund)
        try c.encode(text, forKey: .text)
        if !pfade.isEmpty { try c.encode(pfade, forKey: .pfade) }
        try c.encodeIfPresent(anzahl, forKey: .anzahl)
        if istRueckgaengigFaehig { try c.encode(true, forKey: .rueckgaengig) }
    }
}

/// Zeitstempel des Protokolls: ISO 8601 in UTC, mit Millisekunden (`2026-10-31T08:42:40.115Z`); ohne Millisekunden wird auch gelesen.
public enum AktivitaetsZeit {
    public static func lies(_ text: String) -> Date? {
        let mit = ISO8601DateFormatter()
        mit.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = mit.date(from: text) { return d }
        let ohne = ISO8601DateFormatter()
        ohne.formatOptions = [.withInternetDateTime]
        return ohne.date(from: text)
    }

    public static func text(_ zeit: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: zeit)
    }
}

// MARK: Schalter

/// Die Schalter aus Einstellungen → Mitteilungen (`<Support>/einstellungen.json`, flache Schlüssel). Fehlende oder ungültige Werte
/// gelten als Standard; eine kaputte oder fehlende Datei ergibt die Standardwerte. Die Zuordnung Art → Schalter ist in
/// `gemeinsam/aktivitaet.mjs` (`ART_SCHALTER`) und im Studio gespiegelt; ein Test prüft alle drei Seiten gegeneinander.
public struct MitteilungsEinstellungen: Equatable, Sendable {
    /// macOS-Mitteilung nur, wenn Kortex nicht vorne ist (sonst zeigt das Studio einen Toast).
    public var nurImHintergrund = true
    public var ton = false
    public var abgelegt = true
    public var abgewiesen = true
    public var rueckfragen = true
    public var sicherung = true
    /// Für später (Kontingent-Warnungen); heute ohne Wirkung.
    public var kontingent = true
    public var pflege = false

    public init() {}

    public static let standard = MitteilungsEinstellungen()
    public static let dateiName = "einstellungen.json"

    /// Art → Name des Schalters in `einstellungen.json`. `rueckgaengig` und unbekannte Arten haben keinen: nie eine Mitteilung.
    public static let artSchalter: [String: String] = [
        "ablage-aufgabe": "mitteilungenAbgelegt", "ablage-notiz": "mitteilungenAbgelegt", "aenderung": "mitteilungenAbgelegt",
        "abweisung": "mitteilungenAbgewiesen",
        "sicherung-konflikt": "mitteilungenSicherung", "sicherung-fehler": "mitteilungenSicherung",
        "pflege-fehler": "mitteilungenRueckfragen", "anmeldung-abgelaufen": "mitteilungenRueckfragen",
        "pflege": "mitteilungenPflege",
    ]

    /// Wert eines Schalters nach seinem Namen in `einstellungen.json`.
    func wert(schalter: String) -> Bool? {
        switch schalter {
        case "mitteilungenNurImHintergrund": return nurImHintergrund
        case "mitteilungenTon": return ton
        case "mitteilungenAbgelegt": return abgelegt
        case "mitteilungenAbgewiesen": return abgewiesen
        case "mitteilungenRueckfragen": return rueckfragen
        case "mitteilungenSicherung": return sicherung
        case "mitteilungenKontingent": return kontingent
        case "mitteilungenPflege": return pflege
        default: return nil
        }
    }

    /// Darf zu dieser Art überhaupt eine Mitteilung entstehen? `rueckgaengig` nie, unbekannte Arten nie.
    public func erlaubt(art: String) -> Bool {
        guard let schalter = Self.artSchalter[art] else { return false }
        return wert(schalter: schalter) ?? false
    }

    private struct Schluessel: CodingKey {
        var stringValue: String
        var intValue: Int? { nil }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { nil }
    }

    /// Liest `<support>/einstellungen.json`. Nie ein Fehler: Datei fehlt/kaputt/kein Objekt → Standard; ein Schlüssel ohne echten
    /// Wahrheitswert (Zahl, Text, null) → Standard dieses Schlüssels.
    public static func lies(supportOrdner: URL) -> MitteilungsEinstellungen {
        let datei = supportOrdner.appendingPathComponent(dateiName)
        guard let daten = try? Data(contentsOf: datei), daten.count <= 1_000_000,
              let roh = try? JSONDecoder().decode(Roh.self, from: daten) else { return standard }
        var e = standard
        func setze(_ k: String, _ ziel: inout Bool) { if let w = roh.werte[k] { ziel = w } }
        setze("mitteilungenNurImHintergrund", &e.nurImHintergrund)
        setze("mitteilungenTon", &e.ton)
        setze("mitteilungenAbgelegt", &e.abgelegt)
        setze("mitteilungenAbgewiesen", &e.abgewiesen)
        setze("mitteilungenRueckfragen", &e.rueckfragen)
        setze("mitteilungenSicherung", &e.sicherung)
        setze("mitteilungenKontingent", &e.kontingent)
        setze("mitteilungenPflege", &e.pflege)
        return e
    }

    /// Alle Wahrheitswerte der obersten Ebene; alles andere (auch Verschachteltes) wird übergangen.
    private struct Roh: Decodable {
        var werte: [String: Bool] = [:]
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: Schluessel.self)
            for k in c.allKeys {
                if let b = try? c.decode(Bool.self, forKey: k) { werte[k.stringValue] = b }
            }
        }
    }
}

// MARK: Ziel des Klicks

/// Wohin ein Klick auf eine Mitteilung führt. Läuft über `userInfo` der Mitteilung (nur Text, keine Pfade, kein Inhalt).
public enum MitteilungsZiel: String, Sendable, Equatable, CaseIterable {
    case aufgaben, posteingang, aktivitaet

    /// ablage-aufgabe → Aufgaben, ablage-notiz → Posteingang, alles andere → Aktivitätsprotokoll.
    public static func fuer(art: String) -> MitteilungsZiel {
        switch art {
        case "ablage-aufgabe": return .aufgaben
        case "ablage-notiz": return .posteingang
        default: return .aktivitaet
        }
    }

    public var befehl: StudioBefehl {
        switch self {
        case .aufgaben: return .aufgaben
        case .posteingang: return .posteingang
        case .aktivitaet: return .aktivitaet
        }
    }

    /// Schlüssel in `userInfo`.
    public static let kennzeichen = "kortex"

    public func userInfo(vault: String?, id: String?, art: String?) -> [String: String] {
        var d = [Self.kennzeichen: "1", "ziel": rawValue]
        if let vault { d["vault"] = vault }
        if let id { d["id"] = id }
        if let art { d["art"] = art }
        return d
    }

    /// Ziel aus dem `userInfo` einer angeklickten Mitteilung; nil, wenn sie nicht von Kortex stammt. Ohne gültiges `ziel` gilt die `art`.
    public static func lies(userInfo: [AnyHashable: Any]) -> MitteilungsZiel? {
        guard (userInfo[kennzeichen] as? String) == "1" else { return nil }
        if let z = userInfo["ziel"] as? String, let ziel = MitteilungsZiel(rawValue: z) { return ziel }
        if let a = userInfo["art"] as? String { return fuer(art: a) }
        return .aktivitaet
    }
}

// MARK: Mitteilung und Zentrum

/// Eine fertige macOS-Mitteilung.
public struct Mitteilung: Equatable, Sendable {
    /// Eindeutig je Mitteilung (Kennung der Anfrage im Mitteilungsdienst).
    public var kennung: String
    /// Gruppe im Mitteilungszentrum (`threadIdentifier`): je Vault und Art-Familie ein Stapel.
    public var gruppe: String
    public var titel: String
    public var untertitel: String?
    public var text: String
    public var ton: Bool
    public var ziel: MitteilungsZiel
    public var userInfo: [String: String]
    /// Probe aus den Einstellungen: erscheint auch, wenn Kortex vorne ist.
    public var istProbe: Bool

    public init(kennung: String, gruppe: String, titel: String, untertitel: String? = nil, text: String, ton: Bool, ziel: MitteilungsZiel,
                userInfo: [String: String], istProbe: Bool = false) {
        self.kennung = kennung; self.gruppe = gruppe; self.titel = titel; self.untertitel = untertitel; self.text = text
        self.ton = ton; self.ziel = ziel; self.userInfo = userInfo; self.istProbe = istProbe
    }

    /// „Probe-Mitteilung senden“ (Einstellungen → Mitteilungen): prüft Erlaubnis und Aussehen; Klick öffnet das Aktivitätsprotokoll.
    public static func probe(ton: Bool, kennung: String = "kortex-probe") -> Mitteilung {
        var info = MitteilungsZiel.aktivitaet.userInfo(vault: nil, id: nil, art: nil)
        info["probe"] = "1"
        return Mitteilung(kennung: kennung, gruppe: "kortex-probe", titel: "Kortex", text: "So sehen Mitteilungen von Kortex aus.", ton: ton,
                          ziel: .aktivitaet, userInfo: info, istProbe: true)
    }
}

/// Der Mitteilungsdienst des Systems — in der App `UNUserNotificationCenter`, in Tests eine Attrappe.
public protocol MitteilungsZentrum: Sendable {
    /// Erlaubnis sicherstellen (beim ersten Mal fragt macOS den Nutzer). true = Mitteilungen dürfen erscheinen.
    func fragen() async -> Bool
    func zustellen(_ m: Mitteilung) async
    func zurueckziehen(kennungen: [String]) async
}

// MARK: Leser

/// Liest die Protokolle `<Support>/aktivitaet/*.jsonl` inkrementell. Beim Anlegen steht jede vorhandene Datei am Ende: gemeldet wird nur,
/// was danach dazukommt. Unvollständige letzte Zeilen warten auf ihr Zeilenende, kaputte und überlange Zeilen (> 8 KB) werden übersprungen,
/// eine Rotation (Datei kleiner als die gemerkte Position oder andere Datei) liest die neue Datei von vorn. Nie ein Fehler.
public final class AktivitaetsLeser {
    public static let maxZeile = 8 * 1024
    /// Höchstens so viel wird je Aufruf und Datei gelesen (der Rest folgt beim nächsten Takt).
    static let maxLesen = 4 * 1024 * 1024
    private static let maxMerkIds = 512

    private struct Stand {
        var position: UInt64
        var dateiNummer: Int?
        /// Eine überlange Zeile ist im Gang: bis zum nächsten Zeilenende verwerfen.
        var verwerfe = false
    }

    private let ordner: URL
    private var staende: [String: Stand] = [:]
    private var gesehen: [String] = []
    private var gesehenMenge: Set<String> = []
    private let kodierer = JSONDecoder()

    public init(supportOrdner: URL) {
        ordner = supportOrdner.appendingPathComponent("aktivitaet", isDirectory: true)
        for name in dateien() {
            if let (groesse, nummer) = eigenschaften(name) { staende[name] = Stand(position: groesse, dateiNummer: nummer) }
        }
    }

    private func dateien() -> [String] {
        ((try? FileManager.default.contentsOfDirectory(atPath: ordner.path)) ?? []).filter { $0.hasSuffix(".jsonl") && !$0.hasPrefix(".") }.sorted()
    }

    private func eigenschaften(_ name: String) -> (UInt64, Int?)? {
        guard let a = try? FileManager.default.attributesOfItem(atPath: ordner.appendingPathComponent(name).path),
              (a[.type] as? FileAttributeType) == .typeRegular, let g = a[.size] as? NSNumber else { return nil }
        return (g.uint64Value, (a[.systemFileNumber] as? NSNumber)?.intValue)
    }

    /// Alles, was seit dem letzten Aufruf (bzw. dem Anlegen) dazugekommen ist, in Dateireihenfolge.
    public func neueEreignisse() -> [AktivitaetsEreignis] {
        var aus: [AktivitaetsEreignis] = []
        let vorhanden = dateien()
        for name in staende.keys where !vorhanden.contains(name) { staende[name] = nil }
        for name in vorhanden {
            guard let (groesse, nummer) = eigenschaften(name) else { continue }
            var stand = staende[name] ?? Stand(position: 0, dateiNummer: nummer) // neue Datei: alles ist neu
            if groesse < stand.position || (stand.dateiNummer != nil && nummer != nil && stand.dateiNummer != nummer) {
                // Rotiert (das Backend benennt die Datei in `<name>.alt` um; die Nummer der Datei bleibt dabei dieselbe): was nach der gemerkten Position noch in der Vorfassung steht,
                // wird einmal nachgelesen, dann beginnt die neue Datei von vorn. Eine andere Datei unter `.alt` (anderer Ursprung) wird nicht angefasst.
                if let alt = eigenschaften(name + ".alt"), let alte = stand.dateiNummer, alt.1 == alte, alt.0 > stand.position {
                    var altStand = Stand(position: stand.position, dateiNummer: alt.1)
                    aus += lies(name + ".alt", stand: &altStand, groesse: alt.0)
                }
                stand = Stand(position: 0, dateiNummer: nummer) // rotiert oder ersetzt: von vorn
            }
            stand.dateiNummer = nummer
            if groesse > stand.position { aus += lies(name, stand: &stand, groesse: groesse) }
            staende[name] = stand
        }
        return aus
    }

    private func lies(_ name: String, stand: inout Stand, groesse: UInt64) -> [AktivitaetsEreignis] {
        guard let h = try? FileHandle(forReadingFrom: ordner.appendingPathComponent(name)) else { return [] }
        defer { try? h.close() }
        let anzahl = Int(min(groesse - stand.position, UInt64(Self.maxLesen)))
        guard (try? h.seek(toOffset: stand.position)) != nil, let daten = try? h.read(upToCount: anzahl), !daten.isEmpty else { return [] }
        let b = [UInt8](daten)
        var start = 0
        if stand.verwerfe {
            guard let i = b.firstIndex(of: 10) else { stand.position += UInt64(b.count); return [] }
            start = i + 1
            stand.verwerfe = false
        }
        var aus: [AktivitaetsEreignis] = []
        while let nl = b[start...].firstIndex(of: 10) {
            let zeile = b[start..<nl]
            start = nl + 1
            guard !zeile.isEmpty, zeile.count <= Self.maxZeile,
                  let e = try? kodierer.decode(AktivitaetsEreignis.self, from: Data(zeile)), merke(e.id) else { continue }
            aus.append(e)
        }
        if b.count - start > Self.maxZeile { start = b.count; stand.verwerfe = true } // endlose Zeile: nicht ewig sammeln
        stand.position += UInt64(start)
        return aus
    }

    /// false, wenn die Kennung schon gemeldet wurde (Schutz gegen doppelte Mitteilungen bei einer Fehldeutung der Rotation).
    private func merke(_ id: String) -> Bool {
        guard gesehenMenge.insert(id).inserted else { return false }
        gesehen.append(id)
        if gesehen.count > Self.maxMerkIds { gesehenMenge.remove(gesehen.removeFirst()) }
        return true
    }
}

// MARK: Planer

/// Entscheidet, wann welche Mitteilung entsteht: Filter nach Schaltern, Sammelfenster (gleiche Art-Familie, gleicher Handelnder, gleicher Vault
/// werden EINE Mitteilung), Drosselung (höchstens `maxProMinute` je Minute, der Rest wird einmal als „Weitere N Mitteilungen“ gesammelt) und
/// Wiederholungspause für gleiche Abweisungen. Die Uhr kommt von außen; hier läuft kein Timer — der Aufrufer ruft `faelligeMitteilungen` im Takt.
public final class MitteilungsPlaner {
    public struct Regeln: Equatable, Sendable {
        /// So lange wird nach dem ersten Ereignis einer Gruppe auf weitere gewartet.
        public var sammelfenster: TimeInterval = 5
        public var maxProMinute = 4
        /// Dieselbe Abweisung (gleicher Handelnder, Vault und Grund) höchstens so oft als Mitteilung.
        public var abweisungsPause: TimeInterval = 600
        /// Namen der KI-Programme, die als Handelnder in Titel und Text stehen dürfen (Katalog der App). Alles andere wird zu „Eine KI“ bzw. „Kortex“:
        /// das Protokoll liegt im Support-Ordner, und ein Programm, das es beschreiben kann, soll keine Freitexte in Mitteilungen des Systems bekommen.
        public var bekannteProgramme: Set<String> = ["Claude Code", "Codex"]
        public init() {}
    }

    private struct Gruppe {
        var schluessel: String
        var aufgenommen: Date
        var ereignisse: [AktivitaetsEreignis]
    }

    private let jetzt: @Sendable () -> Date
    private let regeln: Regeln
    /// Ereignisse mit `zeit` vor diesem Zeitpunkt (Start des Dienstes) werden nie gemeldet.
    public let start: Date
    private var gruppen: [Gruppe] = []
    private var zustellzeiten: [Date] = []
    private var letzteAbweisung: [String: Date] = [:]
    private var ueberzaehlig = 0
    private var zaehler = 0

    public init(regeln: Regeln = Regeln(), start: Date? = nil, jetzt: @escaping @Sendable () -> Date = { Date() }) {
        self.jetzt = jetzt
        self.regeln = regeln
        self.start = start ?? jetzt()
    }

    /// Wie viele Gruppen noch auf ihr Sammelfenster warten (für Tests).
    public var wartende: Int { gruppen.count }

    /// Art-Familie für die Gruppierung. Abweisungen unterscheiden den Grund (gleicher Grund = gleiche Meldung).
    static func familie(_ e: AktivitaetsEreignis) -> String {
        e.art == "abweisung" ? "abweisung-\(e.grund ?? "")" : e.art
    }

    /// Neue Ereignisse aufnehmen. Verworfen wird sofort: `rueckgaengig`, Arten ohne Schalter, ausgeschaltete Arten, Ereignisse vor dem Start.
    public func aufnehmen(_ ereignisse: [AktivitaetsEreignis], einstellungen: MitteilungsEinstellungen) {
        let jetzt = self.jetzt()
        for e in ereignisse {
            guard e.art != "rueckgaengig", einstellungen.erlaubt(art: e.art), e.zeit >= start else { continue }
            let schluessel = [Self.familie(e), e.wer ?? "", e.vault ?? ""].joined(separator: "|")
            if let i = gruppen.firstIndex(where: { $0.schluessel == schluessel }) {
                gruppen[i].ereignisse.append(e)
            } else {
                gruppen.append(Gruppe(schluessel: schluessel, aufgenommen: jetzt, ereignisse: [e]))
            }
        }
    }

    /// Die Mitteilungen, die jetzt entstehen sollen (Gruppen, deren Sammelfenster um ist). `istVorne`: Kortex ist gerade das Programm im
    /// Vordergrund mit sichtbarem Studio — bei `nurImHintergrund` entsteht dann keine macOS-Mitteilung (das Studio zeigt einen Toast).
    public func faelligeMitteilungen(einstellungen: MitteilungsEinstellungen, istVorne: Bool) -> [Mitteilung] {
        let jetzt = self.jetzt()
        zustellzeiten.removeAll { jetzt.timeIntervalSince($0) >= 60 }
        let unterdrueckt = einstellungen.nurImHintergrund && istVorne
        var aus: [Mitteilung] = []

        // Gesammelter Überlauf zuerst: sobald in der Minute wieder Platz ist, genau eine Sammelmitteilung.
        if ueberzaehlig > 0 {
            if unterdrueckt {
                ueberzaehlig = 0
            } else if zustellzeiten.count < regeln.maxProMinute {
                aus.append(sammelmitteilung(ueberzaehlig, ton: einstellungen.ton, jetzt: jetzt))
                zustellzeiten.append(jetzt)
                ueberzaehlig = 0
            }
        }

        let faellig = gruppen.filter { jetzt.timeIntervalSince($0.aufgenommen) >= regeln.sammelfenster }
        gruppen.removeAll { g in faellig.contains { $0.schluessel == g.schluessel } }
        for g in faellig {
            // Schalter können sich zwischen Aufnahme und Ablauf des Fensters geändert haben.
            let ereignisse = g.ereignisse.filter { einstellungen.erlaubt(art: $0.art) }
            guard let erstes = ereignisse.first else { continue }
            if unterdrueckt { continue }
            let abweisungsSchluessel = erstes.art == "abweisung" ? [erstes.wer ?? "", erstes.vault ?? "", erstes.grund ?? ""].joined(separator: "|") : nil
            if let s = abweisungsSchluessel, let zuletzt = letzteAbweisung[s], jetzt.timeIntervalSince(zuletzt) < regeln.abweisungsPause { continue }
            if zustellzeiten.count >= regeln.maxProMinute { ueberzaehlig += 1; continue }
            aus.append(mitteilung(ereignisse, ton: einstellungen.ton, jetzt: jetzt))
            zustellzeiten.append(jetzt)
            if let s = abweisungsSchluessel { letzteAbweisung[s] = jetzt }
        }
        return aus
    }

    private func neueKennung(_ jetzt: Date) -> String {
        zaehler += 1
        return "kortex-\(Int(jetzt.timeIntervalSince1970 * 1000))-\(zaehler)"
    }

    private func sammelmitteilung(_ n: Int, ton: Bool, jetzt: Date) -> Mitteilung {
        let text = n == 1 ? "Eine weitere Mitteilung in Kortex." : "Weitere \(n) Mitteilungen in Kortex."
        return Mitteilung(kennung: neueKennung(jetzt), gruppe: "kortex-sammlung", titel: "Kortex", text: text, ton: ton, ziel: .aktivitaet,
                          userInfo: MitteilungsZiel.aktivitaet.userInfo(vault: nil, id: nil, art: nil))
    }

    /// Der Handelnde, wenn er aus einem bekannten Programm (und höchstens einem kurzen Kontonamen) besteht: „Claude Code · Privat“. Sonst nil.
    func bekannterHandelnder(_ wer: String?) -> String? {
        guard let wer else { return nil }
        let teile = wer.components(separatedBy: " · ")
        guard teile.count <= 2, let programm = teile.first, regeln.bekannteProgramme.contains(programm) else { return nil }
        if teile.count == 2 {
            let konto = teile[1]
            guard !konto.isEmpty, konto.count <= 40, konto.unicodeScalars.allSatisfy({ $0.properties.generalCategory != .control && $0.properties.generalCategory != .format }) else { return nil }
        }
        return wer
    }

    /// Der Satz je Ereignisart: fest, aus Art, Grund und Zahl — nie Freitext aus dem Protokoll.
    static func satz(art: String, grund: String?, anzahl: Int, handelnderBekannt: Bool) -> String {
        switch art {
        case "ablage-aufgabe": return "hat \(anzahl == 1 ? "eine Aufgabe" : "\(anzahl) Aufgaben") angelegt."
        case "ablage-notiz": return "hat \(anzahl == 1 ? "eine Notiz" : "\(anzahl) Notizen") im Posteingang abgelegt."
        case "aenderung": return anzahl == 1 ? "hat eine Aufgabe geändert." : "hat \(anzahl) Aufgaben geändert."
        case "abweisung":
            if grund == "gelesen-ohne-leseverbot" { return "hat in einem gesperrten Vault gelesen. Das Leseverbot ist nicht eingeschaltet." }
            return anzahl == 1 ? "wurde abgewiesen." : "wurde \(anzahl)-mal abgewiesen."
        case "pflege": return "Pflege fertig."
        case "pflege-fehler": return "Die Pflege lief nicht ganz durch."
        case "sicherung-konflikt": return "Sicherung: Die Fassungen auf zwei Geräten widersprechen sich. Löse den Konflikt im Studio."
        case "sicherung-fehler": return "Die Online-Sicherung hat nicht geklappt."
        case "anmeldung-abgelaufen": return "muss sich neu anmelden."
        default: return "Es gibt Neues in Kortex."
        }
    }

    private func mitteilung(_ ereignisse: [AktivitaetsEreignis], ton: Bool, jetzt: Date) -> Mitteilung {
        let erstes = ereignisse[0]
        let letztes = ereignisse[ereignisse.count - 1]
        let gesamt = ereignisse.reduce(0) { $0 + ($1.anzahl ?? 1) }
        let wer = bekannterHandelnder(erstes.wer)
        let handelnder = wer ?? "Eine KI"
        let anzahl = erstes.art == "abweisung" ? ereignisse.count : gesamt
        let text = Self.satz(art: erstes.art, grund: erstes.grund, anzahl: anzahl, handelnderBekannt: wer != nil)
        // Ohne bekannten Handelnden ist der Satz ein Systemsatz („Die Sicherung …“); bei Handelnden-Sätzen steht „Eine KI“ davor.
        let nurGerechnet = ["ablage-aufgabe", "ablage-notiz", "abweisung", "aenderung", "anmeldung-abgelaufen"].contains(erstes.art)
        let anzeige = wer == nil && nurGerechnet ? "\(handelnder) \(text)" : text
        let ziel = MitteilungsZiel.fuer(art: erstes.art)
        return Mitteilung(kennung: neueKennung(jetzt), gruppe: "kortex-\(erstes.vault ?? "alle")-\(Self.familie(erstes))",
                          titel: wer ?? "Kortex", untertitel: erstes.vaultName.map { String($0.unicodeScalars.filter { $0.properties.generalCategory != .control && $0.properties.generalCategory != .format }.prefix(60).map(Character.init)) }, text: anzeige, ton: ton, ziel: ziel,
                          userInfo: ziel.userInfo(vault: erstes.vault, id: letztes.id, art: erstes.art))
    }
}

// MARK: Ablauf

/// Ein Takt des Dienstes: neue Ereignisse lesen, in den Planer geben, Fälliges zustellen. Einstellungen und „ist Kortex vorne“ werden bei
/// jedem Takt frisch erfragt. Die Erlaubnis wird erst gefragt, wenn wirklich eine Mitteilung ansteht (nicht beim Start).
public final class MitteilungsAblauf {
    private let leser: AktivitaetsLeser
    private let planer: MitteilungsPlaner
    private let zentrum: MitteilungsZentrum
    private let einstellungen: () -> MitteilungsEinstellungen
    private let istVorne: () -> Bool
    private var zugestellt: [String] = []

    public init(leser: AktivitaetsLeser, planer: MitteilungsPlaner, zentrum: MitteilungsZentrum,
                einstellungen: @escaping () -> MitteilungsEinstellungen, istVorne: @escaping () -> Bool) {
        self.leser = leser; self.planer = planer; self.zentrum = zentrum; self.einstellungen = einstellungen; self.istVorne = istVorne
    }

    /// Liefert die zugestellten Mitteilungen (für Tests und das App-Log).
    @discardableResult
    public func takt() async -> [Mitteilung] {
        let e = einstellungen()
        planer.aufnehmen(leser.neueEreignisse(), einstellungen: e)
        let faellig = planer.faelligeMitteilungen(einstellungen: e, istVorne: istVorne())
        guard !faellig.isEmpty else { return [] }
        guard await zentrum.fragen() else { return [] }
        for m in faellig {
            await zentrum.zustellen(m)
            zugestellt.append(m.kennung)
        }
        if zugestellt.count > 200 { zugestellt.removeFirst(zugestellt.count - 200) }
        return faellig
    }

    /// Der Nutzer schaut hin (Kortex wurde aktiv): die gezeigten Mitteilungen dieser Sitzung verschwinden aus dem Mitteilungszentrum.
    public func ziehtZugestelltesZurueck() async {
        let k = zugestellt
        zugestellt = []
        if !k.isEmpty { await zentrum.zurueckziehen(kennungen: k) }
    }
}
