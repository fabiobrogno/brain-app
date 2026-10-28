import Foundation

/// Eine Zuführung (Connector, Importordner, Sammelstelle) laut Wächter des Kits.
public struct Zufuehrung: Decodable, Equatable, Sendable {
    public let name: String
    public let pfad: String?
    /// `ok`, `fehlt`, `nicht-lesbar`, `still`, `config` — und was das Kit später dazu erfindet: alles außer `ok` ist ein Problem.
    public let status: String
    public let letzterLauf: String?
    public let alterTage: Int?
    public let maxAlterTage: Int?

    public var istProblem: Bool { status != "ok" }

    /// „20.10.2026“ aus `2026-10-20T08:00:00Z` (nur das Datum, keine Zeitzonenrechnung); nil, wenn es kein Datum ist.
    var letzterLaufDatum: String? {
        guard let l = letzterLauf, l.count >= 10 else { return nil }
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
            let alter = alterTage.map { " (\($0) \($0 == 1 ? "Tag" : "Tage"))" } ?? ""
            return "Zuführung „\(name)“ steht\(seit) still\(letzterLaufDatum == nil ? "" : alter)"
        case "fehlt": return "Zuführung „\(name)“: Pfad fehlt"
        case "nicht-lesbar": return "Zuführung „\(name)“: nicht lesbar (Rechte prüfen)"
        case "config": return "Zuführung „\(name)“: Eintrag unvollständig (kein Pfad)"
        default: return "Zuführung „\(name)“: Problem (\(status))"
        }
    }
}

/// Stand der Zuführungen: die Statusdatei `<vault>/.logs/zufuehrungen.json`, die der Wächter des Kits schreibt (Kit-PR #13, FBL-93).
/// Die App liest sie nur — sie ist Daten, kein Kit-Code, und braucht darum keine Vertrauensprüfung.
///
/// Format (Version 1): `{ "version", "erstellt", "probleme", "zufuehrungen": [{ "name", "pfad", "status", "letzterLauf", "alterTage", "maxAlterTage" }] }`.
/// Gezählt werden die Einträge selbst, nicht das Feld `probleme`.
public enum ZufuehrungenStand: Equatable, Sendable {
    /// Keine Statusdatei (Kit ohne Wächter, noch kein Lauf, keine Zuführungen eingetragen): neutral, kein Fehler.
    case keine
    /// Die Datei ist da, ließ sich aber nicht lesen (kaputt, zu groß, Symlink, unbekannte Form): sichtbar, nie still.
    case unlesbar
    case stand(erstellt: String?, eintraege: [Zufuehrung])

    private struct Datei: Decodable {
        let erstellt: String?
        let zufuehrungen: [Zufuehrung]
    }

    static let hoechstGroesse = 1_000_000
    static let dateiName = ".logs/zufuehrungen.json"

    public static func lade(vault: URL, fm: FileManager = .default) -> ZufuehrungenStand {
        let url = vault.appendingPathComponent(dateiName)
        // Ein Symlink zählt als „da, aber nicht lesbar“: nicht aus dem Vault heraus lesen, aber auch nicht so tun, als gäbe es nichts.
        guard (try? fm.destinationOfSymbolicLink(atPath: url.path)) == nil else { return .unlesbar }
        guard fm.fileExists(atPath: url.path) else { return .keine }
        guard (try? url.resourceValues(forKeys: [.isRegularFileKey]))?.isRegularFile == true,
              let daten = try? Data(contentsOf: url), daten.count <= hoechstGroesse,
              let datei = try? JSONDecoder().decode(Datei.self, from: daten) else { return .unlesbar }
        return .stand(erstellt: datei.erstellt, eintraege: datei.zufuehrungen)
    }

    /// Einträge mit Problem (nur bei einem gelesenen Stand).
    public var probleme: [Zufuehrung] {
        if case .stand(_, let e) = self { return e.filter(\.istProblem) }
        return []
    }

    /// Wie viele Dinge die Menüleiste melden muss: Probleme, bei unlesbarer Datei eins (die Datei selbst).
    public var problemAnzahl: Int {
        switch self {
        case .keine: return 0
        case .unlesbar: return 1
        case .stand: return probleme.count
        }
    }

    /// Kurztitel für die Menüleiste; nil, wenn nichts zu melden ist.
    public var warnung: String? {
        switch self {
        case .keine: return nil
        case .unlesbar: return "Zuführungs-Status nicht lesbar"
        case .stand:
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
        case .stand: return probleme.compactMap(\.menueZeile)
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
