import Foundation

public enum ErfassungsArt: String, Codable, CaseIterable, Sendable {
    case aufgabe, notiz

    public var name: String { self == .aufgabe ? "Aufgabe" : "Notiz" }
}

/// Wie wichtig eine Aufgabe ist — dieselben Werte wie im Kern (`PRIORITAET` in `kern/aufgaben.mjs`).
public enum ErfassungsPrioritaet: String, Codable, CaseIterable, Sendable {
    case niedrig, normal, hoch

    public var name: String { rawValue.prefix(1).uppercased() + rawValue.dropFirst() }
}

/// Kurzformen im Text einer Aufgabe: Priorität und Fälligkeit werden beim Tippen erkannt und aus dem Titel genommen.
///
/// Die Regeln sind bewusst eng, damit normaler Text nicht versehentlich etwas auslöst. Sie gelten nur für die ERSTE Zeile (der Titel);
/// weitere Zeilen bleiben unverändert als Text der Aufgabe.
///
/// **Priorität** — ein eigenes Wort: `!hoch`, `!normal`, `!niedrig` oder `!!` (= hoch). Es darf überall in der ersten Zeile stehen.
///
/// **Fälligkeit** — erkannt wird sie in drei Fällen:
///  1. mit Markierung `@`: `@morgen`, `@freitag`, `@12.11.`, `@2026-11-03`;
///  2. nach `bis` oder `fällig` (optional mit `zum`/`am`): `bis morgen`, `fällig Freitag`, `bis zum 12.11.`;
///  3. ohne Markierung ganz am Anfang oder ganz am Ende der Zeile, aber nur als Wort oder ISO-Datum: `morgen Steuer machen`,
///     `Steuer machen übermorgen`, `Zahnarzt anrufen in 3 Tagen`, `Bericht nächste Woche`, `Rechnung 2026-11-03`.
///
/// Erkannte Wörter: `heute`, `morgen`, `übermorgen`, Wochentage (`Montag` … `Sonntag`; immer der NÄCHSTE, auch wenn heute dieser Tag ist),
/// `in N Tagen`, `in N Wochen`, `nächste Woche` (= nächster Montag), `JJJJ-MM-TT`, und nur mit `@` oder `bis`/`fällig`: `TT.MM.`
/// und `TT.MM.JJJJ` (ohne Jahr: das nächste Mal, dass dieser Tag kommt). Bleibt vom Titel nichts übrig, wird nichts erkannt.
public enum Kurzformen {
    public struct Ergebnis: Equatable, Sendable {
        /// Erste Zeile ohne die erkannten Kurzformen (Leerraum zusammengezogen).
        public var titel: String
        /// Alle weiteren Zeilen (Ränder bereinigt); leer, wenn es nur eine Zeile gibt.
        public var text: String
        public var prioritaet: ErfassungsPrioritaet?
        /// `JJJJ-MM-TT`.
        public var faellig: String?
        /// Die erkannten Wörter, wie getippt (für die Anzeige).
        public var prioritaetWort: String?
        public var faelligWort: String?
    }

    /// Die Regeln in einfachen Worten (Hilfe im Fenster).
    public static let regeln: [String] = [
        "!hoch · !normal · !niedrig · !! — Priorität (überall in der ersten Zeile)",
        "@morgen · @freitag · @12.11. · @2026-11-03 — Fälligkeit mit @",
        "bis morgen · fällig Freitag · bis zum 12.11. — Fälligkeit nach „bis“ oder „fällig“",
        "morgen … oder … übermorgen — heute, morgen, übermorgen, Wochentag, in 3 Tagen, in 2 Wochen, nächste Woche, 2026-11-03: ohne Zeichen nur ganz vorn oder hinten",
    ]

    public static func lies(_ eingabe: String, heute: Date = Date(), kalender: Calendar = .current,
                            prioritaet erkennePrio: Bool = true, faellig erkenneFaellig: Bool = true) -> Ergebnis {
        let zeilen = eingabe.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
            .split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        guard let start = zeilen.firstIndex(where: { !$0.trimmingCharacters(in: .whitespaces).isEmpty }) else {
            return Ergebnis(titel: "", text: "")
        }
        let rest = zeilen[(start + 1)...].joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        var woerter = zeilen[start].split(whereSeparator: { $0 == " " || $0 == "\t" }).map(String.init)
        var ergebnis = Ergebnis(titel: "", text: rest)

        if erkennePrio {
            let uebrig = woerter.filter { prio($0) == nil }
            // Besteht die Zeile nur aus Prioritätswörtern, bleibt sie der Titel (nichts erkennen).
            if let erstes = woerter.first(where: { prio($0) != nil }), !uebrig.isEmpty {
                ergebnis.prioritaet = prio(erstes)
                ergebnis.prioritaetWort = erstes
                woerter = uebrig
            }
        }
        if erkenneFaellig, let treffer = faelligIn(woerter, heute: heute, kalender: kalender) {
            ergebnis.faellig = treffer.datum
            ergebnis.faelligWort = treffer.wort
            woerter.removeSubrange(treffer.bereich)
        }
        ergebnis.titel = woerter.joined(separator: " ")
        return ergebnis
    }

    // MARK: Priorität

    private static func prio(_ wort: String) -> ErfassungsPrioritaet? {
        switch wort.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: ",.;:")) {
        case "!hoch", "!!": return .hoch
        case "!normal": return .normal
        case "!niedrig": return .niedrig
        default: return nil
        }
    }

    // MARK: Fälligkeit

    private struct Treffer { let datum: String; let wort: String; let bereich: Range<Int> }

    private static func faelligIn(_ w: [String], heute: Date, kalender: Calendar) -> Treffer? {
        // 1. mit @ und 2. nach „bis“/„fällig“: erste Fundstelle von links
        for i in w.indices {
            let wort = w[i]
            if wort.hasPrefix("@"), wort.count > 1 {
                let rest = String(wort.dropFirst())
                if let d = ausdruck([rest], ab: 0, numerisch: true, heute: heute, kalender: kalender), d.laenge == 1, w.count > 1 {
                    return Treffer(datum: d.datum, wort: wort, bereich: i..<(i + 1))
                }
                continue
            }
            let klein = wort.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: ":"))
            guard klein == "bis" || klein == "fällig" || klein == "faellig" else { continue }
            var j = i + 1
            if j < w.count, ["zum", "am"].contains(w[j].lowercased()) { j += 1 }
            if let d = ausdruck(w, ab: j, numerisch: true, heute: heute, kalender: kalender), w.count > d.laenge + (j - i) {
                let bis = j + d.laenge
                return Treffer(datum: d.datum, wort: w[i..<bis].joined(separator: " "), bereich: i..<bis)
            }
        }
        // 3. ohne Markierung: ganz vorn, sonst ganz hinten
        if let d = ausdruck(w, ab: 0, numerisch: false, heute: heute, kalender: kalender), w.count > d.laenge {
            return Treffer(datum: d.datum, wort: w[0..<d.laenge].joined(separator: " "), bereich: 0..<d.laenge)
        }
        for i in stride(from: max(1, w.count - 4), to: w.count, by: 1) {
            // „bis morgen“ ohne weiteren Text: kein Titel „bis“ mit Datum
            if ["bis", "fällig", "faellig", "zum", "am"].contains(w[i - 1].lowercased().trimmingCharacters(in: CharacterSet(charactersIn: ":"))) { continue }
            if let d = ausdruck(w, ab: i, numerisch: false, heute: heute, kalender: kalender), i + d.laenge == w.count {
                return Treffer(datum: d.datum, wort: w[i...].joined(separator: " "), bereich: i..<w.count)
            }
        }
        return nil
    }

    private static let wochentage: [String: Int] = [
        "sonntag": 1, "montag": 2, "dienstag": 3, "mittwoch": 4, "donnerstag": 5, "freitag": 6, "samstag": 7, "sonnabend": 7,
    ]

    /// Zeichen am Ende eines Worts, die nicht zum Datumswort gehören.
    private static func rein(_ s: String, punkt: Bool) -> String {
        s.trimmingCharacters(in: CharacterSet(charactersIn: punkt ? ",;:!?" : ",;:!?."))
    }

    /// Ein Datumsausdruck ab Wort `i`; `laenge` = wie viele Wörter er belegt. `numerisch` erlaubt `TT.MM.[JJJJ]`.
    private static func ausdruck(_ w: [String], ab i: Int, numerisch: Bool, heute: Date, kalender: Calendar) -> (datum: String, laenge: Int)? {
        guard i < w.count else { return nil }
        let tag0 = kalender.startOfDay(for: heute)
        func plus(_ tage: Int) -> String? { kalender.date(byAdding: .day, value: tage, to: tag0).map { iso($0, kalender) } }
        let a = rein(w[i], punkt: false).lowercased()
        switch a {
        case "heute": return plus(0).map { ($0, 1) }
        case "morgen": return plus(1).map { ($0, 1) }
        case "übermorgen", "uebermorgen": return plus(2).map { ($0, 1) }
        default: break
        }
        if let ziel = wochentage[a] { return plus(naechster(ziel, von: tag0, kalender)).map { ($0, 1) } }
        // „in 3 Tagen“, „in 2 Wochen“, „nächste Woche“
        if a == "in", i + 2 < w.count {
            let n = rein(w[i + 1], punkt: false)
            let einheit = rein(w[i + 2], punkt: false).lowercased()
            if n.count <= 3, let zahl = Int(n), zahl >= 1 {
                if ["tag", "tage", "tagen"].contains(einheit) { return plus(zahl).map { ($0, 3) } }
                if ["woche", "wochen"].contains(einheit) { return plus(zahl * 7).map { ($0, 3) } }
            }
        }
        if ["nächste", "naechste", "nächsten", "naechsten"].contains(a), i + 1 < w.count, rein(w[i + 1], punkt: false).lowercased() == "woche" {
            return plus(naechster(2, von: tag0, kalender)).map { ($0, 2) }
        }
        let z = rein(w[i], punkt: numerisch)
        if let d = isoDatum(z, kalender) { return (d, 1) }
        if numerisch, let d = deutschesDatum(z, heute: tag0, kalender) { return (d, 1) }
        return nil
    }

    /// Tage bis zum NÄCHSTEN Vorkommen des Wochentags (1 = Sonntag … 7 = Samstag); ist heute dieser Tag, sind es 7.
    private static func naechster(_ ziel: Int, von tag: Date, _ k: Calendar) -> Int {
        let heute = k.component(.weekday, from: tag)
        let d = (ziel - heute + 7) % 7
        return d == 0 ? 7 : d
    }

    private static func iso(_ d: Date, _ k: Calendar) -> String {
        let c = k.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    private static func datum(jahr: Int, monat: Int, tag: Int, _ k: Calendar) -> Date? {
        guard let d = k.date(from: DateComponents(year: jahr, month: monat, day: tag)) else { return nil }
        let c = k.dateComponents([.year, .month, .day], from: d)
        return c.year == jahr && c.month == monat && c.day == tag ? d : nil // 31.02. ergäbe sonst den 3. März
    }

    private static func isoDatum(_ s: String, _ k: Calendar) -> String? {
        let t = s.split(separator: "-", omittingEmptySubsequences: false)
        guard t.count == 3, t[0].count == 4, t[1].count == 2, t[2].count == 2,
              let j = Int(t[0]), let m = Int(t[1]), let d = Int(t[2]), datum(jahr: j, monat: m, tag: d, k) != nil else { return nil }
        return s
    }

    private static func deutschesDatum(_ s: String, heute: Date, _ k: Calendar) -> String? {
        var t = s.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        if t.last == "" { t.removeLast() } else if t.count == 2 { return nil } // „3.11“ ohne Schlusspunkt: eher eine Versionsnummer
        guard (t.count == 2 || t.count == 3), t.allSatisfy({ !$0.isEmpty && $0.allSatisfy(\.isNumber) }),
              let tag = Int(t[0]), let monat = Int(t[1]), t[0].count <= 2, t[1].count <= 2 else { return nil }
        let aktuell = k.component(.year, from: heute)
        if t.count == 3 {
            guard t[2].count == 2 || t[2].count == 4, var jahr = Int(t[2]) else { return nil }
            if t[2].count == 2 { jahr += 2000 }
            return datum(jahr: jahr, monat: monat, tag: tag, k).map { iso($0, k) }
        }
        for jahr in [aktuell, aktuell + 1] {
            if let d = datum(jahr: jahr, monat: monat, tag: tag, k), d >= heute { return iso(d, k) }
        }
        return nil
    }

    // MARK: Anzeige

    /// „heute“, „morgen“ oder „Fr., 31.10.“ für ein Datum `JJJJ-MM-TT`; unlesbar → das Datum selbst.
    public static func faelligText(_ iso: String, heute: Date = Date(), kalender: Calendar = .current) -> String {
        let t = iso.split(separator: "-").compactMap { Int($0) }
        guard t.count == 3, let d = datum(jahr: t[0], monat: t[1], tag: t[2], kalender) else { return iso }
        let tage = kalender.dateComponents([.day], from: kalender.startOfDay(for: heute), to: d).day ?? 0
        if tage == 0 { return "heute" }
        if tage == 1 { return "morgen" }
        let kurz = ["", "So.", "Mo.", "Di.", "Mi.", "Do.", "Fr.", "Sa."][kalender.component(.weekday, from: d)]
        return String(format: "%@, %02d.%02d.", kurz, t[2], t[1]) + (t[0] != kalender.component(.year, from: heute) ? String(t[0]) : "")
    }
}
