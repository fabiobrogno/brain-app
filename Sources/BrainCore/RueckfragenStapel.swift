import Foundation

/// Reihenfolge der Beantwortung: immer die erste offene Frage, nach dem Speichern sofort die nächste.
public struct RueckfragenStapel: Equatable, Sendable {
    public private(set) var offen: [Rueckfrage]
    public private(set) var beantwortet = 0
    /// Rückfragen über dem Deckel: warten, bis Platz ist.
    public let wartend: Int

    public init(_ liste: RueckfragenListe) {
        offen = liste.fragen
        wartend = liste.wartend
    }

    public var aktuell: Rueckfrage? { offen.first }
    public var istLeer: Bool { offen.isEmpty }

    /// Nach erfolgreichem Speichern der Antwort auf die aktuelle Frage.
    public mutating func aktuelleErledigt() {
        guard !offen.isEmpty else { return }
        offen.removeFirst()
        beantwortet += 1
    }

    /// Frage ans Ende stellen („später“), ohne zu antworten.
    public mutating func aktuelleZurueckstellen() {
        guard offen.count > 1 else { return }
        offen.append(offen.removeFirst())
    }

    /// „Frage 2 von 5“ (zählt die schon beantworteten mit).
    public var fortschritt: String {
        "Frage \(beantwortet + 1) von \(beantwortet + offen.count)"
    }
}

public enum RueckfragenText {
    /// Zeile im Menü; nie nur eine Zahl.
    public static func zaehler(_ anzahl: Int?) -> String {
        switch anzahl {
        case nil: return "Rückfragen: unbekannt"
        case 0?: return "Keine Rückfragen offen"
        case 1?: return "1 Rückfrage offen"
        case let n?: return "\(n) Rückfragen offen"
        }
    }

    /// Kurzfassung des letzten Tageslaufs für die Berichtsansicht.
    public static func tageslauf(_ t: TageslaufKurz?) -> String {
        guard let t else { return "Noch kein Tageslauf." }
        let z = t.zahlen ?? .init()
        let probe = (t.modus == "probe" || t.schalter == "probe") ? "Probelauf, es wurde nichts geändert: " : ""
        var s = "\(probe)\(z.uebernommen) übernommen · \(z.aussortiert) aussortiert · \(z.rueckfragen) Rückfragen offen"
        if let f = t.fehlerquote { s += " · Fehlerquote \(f.fehler)/\(f.geprueft)" }
        if let a = t.autostufe, a != "normal" { s += " · Autostufe: \(a)" }
        return s
    }
}
