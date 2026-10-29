import Foundation

/// Eine Zuführung (Connector, Importordner, Sammelstelle) laut Wächter des Kits.
public struct Zufuehrung: Decodable, Equatable, Sendable {
    public let name: String
    public let pfad: String?
    /// `ok`, `fehlt`, `nicht-lesbar`, `still`, `config` — und was das Kit später dazu erfindet: alles außer `ok` ist ein Problem.
    public let status: String
    public let letzterLauf: String?
    /// Das Kit schreibt `Number()` ungerundet (z. B. 1.5): als Kommazahl lesen, sonst machte ein Wert die ganze Datei unlesbar.
    public let alterTage: Double?
    public let maxAlterTage: Double?

    public var istProblem: Bool { status != "ok" }

    var letzterLaufDatum: String? { Self.datumText(letzterLauf) }

    /// „20.10.2026“ aus `2026-10-20T08:00:00Z` (nur das Datum, keine Zeitzonenrechnung); nil, wenn es kein Datum ist.
    static func datumText(_ iso: String?) -> String? {
        guard let l = iso, l.count >= 10 else { return nil }
        let teile = l.prefix(10).split(separator: "-")
        guard teile.count == 3, teile[0].count == 4, teile[1].count == 2, teile[2].count == 2,
              teile.allSatisfy({ $0.allSatisfy(\.isNumber) }) else { return nil }
        return "\(teile[2]).\(teile[1]).\(teile[0])"
    }

    /// Satz fürs Menü; nil bei `ok`. Sagt, was los ist — nie nur eine Zahl.
    public var menueZeile: String? {
        guard istProblem else { return nil }
        switch status {
        case "still":
            let seit = letzterLaufDatum.map { " seit \($0)" } ?? ""
            let alter = alterTage.map { t -> String in let n = Int(t.rounded()); return " (\(n) \(n == 1 ? "Tag" : "Tage"))" } ?? ""
            return "Zuführung „\(name)“ steht\(seit) still\(letzterLaufDatum == nil ? "" : alter)"
        case "fehlt": return "Zuführung „\(name)“: Pfad fehlt"
        case "nicht-lesbar": return "Zuführung „\(name)“: nicht lesbar (Rechte prüfen)"
        case "config": return "Zuführung „\(name)“: Eintrag unvollständig (kein Pfad)"
        default: return "Zuführung „\(name)“: Problem (\(status))"
        }
    }
}

/// Stand der Zuführungen: die Statusdatei `<vault>/.logs/zufuehrungen.json`, die der Wächter des Kits schreibt (Kit-PR #13, FBL-93).
/// Die App liest sie nur — sie ist Daten und wird auch ohne Vertrauen in den Vault gelesen.
///
/// Format (Version 1): `{ "version", "erstellt", "probleme", "zufuehrungen": [{ "name", "pfad", "status", "letzterLauf", "alterTage", "maxAlterTage" }] }`.
/// Gezählt werden die Einträge selbst, nicht das Feld `probleme`.
public enum ZufuehrungenStand: Equatable, Sendable {
    /// Keine Statusdatei (Kit ohne Wächter, noch kein Lauf, keine Zuführungen eingetragen): neutral, kein Fehler.
    case keine
    /// Die Datei ist da, ließ sich aber nicht lesen (kaputt, zu groß, Symlink, unbekannte Form): sichtbar, nie still.
    case unlesbar
    /// `veraltet`: die Datei ist viel älter als der Wächter sie schreiben müsste — der Wächter läuft nicht mehr (siehe `veraltetNach`).
    case stand(erstellt: String?, eintraege: [Zufuehrung], veraltet: Bool)

    private struct Datei: Decodable {
        let erstellt: String?
        let zufuehrungen: [Zufuehrung]
    }

    static let hoechstGroesse = 1_000_000
    static let dateiName = ".logs/zufuehrungen.json"
    static let tagSekunden = 86_400.0
    static let mindestFrist = 14.0
    static let standardMaxAlter = 7.0

    /// Ab wie vielen Tagen eine Statusdatei als veraltet gilt: mindestens 14 Tage, sonst das Doppelte des größten `maxAlterTage`.
    static func veraltetNach(_ eintraege: [Zufuehrung]) -> Double {
        let groesstes = eintraege.map { $0.maxAlterTage ?? standardMaxAlter }.max() ?? standardMaxAlter
        return max(mindestFrist, 2 * groesstes)
    }

    /// `jetzt` ist nur für Tests einstellbar. Ein fehlendes oder unlesbares `erstellt`, oder eines in der Zukunft, gilt nicht als veraltet
    /// (ohne Zeitpunkt lässt sich das Alter nicht beurteilen).
    public static func lade(vault: URL, jetzt: Date = Date(), fm: FileManager = .default) -> ZufuehrungenStand {
        let ordner = vault.appendingPathComponent(".logs")
        let url = vault.appendingPathComponent(dateiName)
        // Ein Symlink (Ordner oder Datei) zählt als „da, aber nicht lesbar“: nicht aus dem Vault heraus lesen, aber auch nicht so tun,
        // als gäbe es nichts.
        if (try? fm.destinationOfSymbolicLink(atPath: ordner.path)) != nil { return .unlesbar }
        var istOrdner: ObjCBool = false
        if fm.fileExists(atPath: ordner.path, isDirectory: &istOrdner), !istOrdner.boolValue { return .unlesbar }
        guard (try? fm.destinationOfSymbolicLink(atPath: url.path)) == nil else { return .unlesbar }
        guard fm.fileExists(atPath: url.path) else { return .keine }
        // Größe vor dem Lesen prüfen, damit eine riesige Datei nie komplett in den Speicher kommt.
        guard let werte = try? url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey]), werte.isRegularFile == true,
              let groesse = werte.fileSize, groesse <= hoechstGroesse,
              let daten = try? Data(contentsOf: url), daten.count <= hoechstGroesse,
              let datei = try? JSONDecoder().decode(Datei.self, from: daten) else { return .unlesbar }
        var veraltet = false
        if let e = datei.erstellt, let zeit = ISO8601DateFormatter().date(from: e) {
            veraltet = jetzt.timeIntervalSince(zeit) > veraltetNach(datei.zufuehrungen) * tagSekunden
        }
        return .stand(erstellt: datei.erstellt, eintraege: datei.zufuehrungen, veraltet: veraltet)
    }

    /// Einträge mit Problem (nur bei einem gelesenen Stand).
    public var probleme: [Zufuehrung] {
        if case .stand(_, let e, _) = self { return e.filter(\.istProblem) }
        return []
    }

    /// Ist die Statusdatei veraltet (der Wächter läuft nicht mehr)?
    public var istVeraltet: Bool {
        if case .stand(_, _, let v) = self { return v }
        return false
    }

    /// Wie viele Dinge die Menüleiste melden muss: Probleme, ein veralteter Stand, bei unlesbarer Datei eins (die Datei selbst).
    public var problemAnzahl: Int {
        switch self {
        case .keine: return 0
        case .unlesbar: return 1
        case .stand: return probleme.count + (istVeraltet ? 1 : 0)
        }
    }

    /// Kurztitel für die Menüleiste; nil, wenn nichts zu melden ist.
    public var warnung: String? {
        switch self {
        case .keine: return nil
        case .unlesbar: return "Zuführungs-Status nicht lesbar"
        case .stand:
            if istVeraltet { return "Zuführungs-Wächter läuft nicht" }
            let p = probleme
            switch p.count {
            case 0: return nil
            case 1: return p[0].status == "still" ? "Zuführung „\(p[0].name)“ steht still" : "Zuführung „\(p[0].name)“ mit Problem"
            case let n: return "\(n) Zuführungen mit Problem"
            }
        }
    }

    /// Zeilen fürs Menü, je Problem eine.
    public var menueZeilen: [String] {
        switch self {
        case .keine: return []
        case .unlesbar: return ["Zuführungs-Status nicht lesbar (\(Self.dateiName))"]
        case .stand(let erstellt, _, let veraltet):
            let alt = veraltet ? ["Zuführungs-Status vom \(Zufuehrung.datumText(erstellt) ?? "unbekanntem Datum") — Wächter läuft nicht"] : []
            return alt + probleme.compactMap(\.menueZeile)
        }
    }
}

extension StatusAnzeige {
    /// ⚠ in der Menüleiste, wenn eine Zuführung still steht — aber nur, wo sonst „in Ordnung“ (✓) stünde. Jeder andere Zustand
    /// (✕ Problem, 🔒, ?, schon ⚠) behält seine Aussage; die Zeilen im Menü nennen die Zuführung trotzdem.
    public func mit(zufuehrungen: ZufuehrungenStand) -> StatusAnzeige {
        guard zeichen == "✓", let titel = zufuehrungen.warnung else { return self }
        return StatusAnzeige(symbol: "exclamationmark.triangle", zeichen: "⚠", titel: titel)
    }
}
