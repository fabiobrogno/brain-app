import Foundation

/// Ein Tastenkürzel für „Schnell erfassen“: eine Taste (virtueller Tastencode, `kVK_*`) und die Umschalttasten ⌃ ⌥ ⇧ ⌘.
/// Gespeichert wird der Code, nicht der Buchstabe — so gilt das Kürzel unabhängig von der Tastaturbelegung. Die Namen in `anzeige`
/// stammen aus einer festen Tabelle (US-Belegung der Buchstaben- und Zifferntasten; Leertaste, Pfeile, F-Tasten sind überall gleich).
public struct Tastenkuerzel: Codable, Equatable, Sendable {
    public struct Umschalter: OptionSet, Codable, Equatable, Sendable {
        public let rawValue: Int
        public init(rawValue: Int) { self.rawValue = rawValue }
        public static let control = Umschalter(rawValue: 1)
        public static let option = Umschalter(rawValue: 2)
        public static let shift = Umschalter(rawValue: 4)
        public static let command = Umschalter(rawValue: 8)
    }

    public var taste: UInt32
    public var umschalter: Umschalter

    public init(taste: UInt32, umschalter: Umschalter) {
        self.taste = taste
        self.umschalter = umschalter
    }

    /// Standard: ⌃⌥Leertaste. Kein Systemkürzel in der Grundeinstellung von macOS (⌃Leertaste und ⌘Leertaste sind belegt; ⌃⌥Leertaste
    /// ist nur bei eingeschaltetem „Nächste Eingabequelle“ in den Tastatur-Einstellungen vergeben — das erkennt `KuerzelPruefung`).
    public static let standard = Tastenkuerzel(taste: 49, umschalter: [.control, .option])

    /// Modifikatorbits von Carbon (`controlKey` 0x1000, `optionKey` 0x0800, `shiftKey` 0x0200, `cmdKey` 0x0100).
    public var carbonUmschalter: UInt32 {
        var m: UInt32 = 0
        if umschalter.contains(.control) { m |= 0x1000 }
        if umschalter.contains(.option) { m |= 0x0800 }
        if umschalter.contains(.shift) { m |= 0x0200 }
        if umschalter.contains(.command) { m |= 0x0100 }
        return m
    }

    /// „⌃⌥Leertaste“ — Umschalter in der Reihenfolge des Systems (⌃ ⌥ ⇧ ⌘), dann der Name der Taste.
    public var anzeige: String { umschalterText + (Self.tastenNamen[taste] ?? "Taste \(taste)") }

    public var umschalterText: String {
        (umschalter.contains(.control) ? "⌃" : "") + (umschalter.contains(.option) ? "⌥" : "")
            + (umschalter.contains(.shift) ? "⇧" : "") + (umschalter.contains(.command) ? "⌘" : "")
    }

    /// Kann diese Taste ein Kürzel sein? Esc und Löschen brauchen wir zum Abbrechen und Zurücksetzen beim Aufnehmen; unbekannte Codes
    /// (Medientasten, Sondertasten) lassen wir weg, weil wir sie nicht benennen könnten.
    public static func tasteErlaubt(_ code: UInt32) -> Bool { code != 53 && code != 51 && tastenNamen[code] != nil }

    /// Tastencode → Name. Quelle: die `kVK_*`-Konstanten (HIToolbox/Events.h).
    static let tastenNamen: [UInt32: String] = {
        var t: [UInt32: String] = [
            0: "A", 1: "S", 2: "D", 3: "F", 4: "H", 5: "G", 6: "Z", 7: "X", 8: "C", 9: "V", 11: "B", 12: "Q", 13: "W", 14: "E", 15: "R",
            16: "Y", 17: "T", 18: "1", 19: "2", 20: "3", 21: "4", 22: "6", 23: "5", 24: "=", 25: "9", 26: "7", 27: "-", 28: "8", 29: "0",
            30: "]", 31: "O", 32: "U", 33: "[", 34: "I", 35: "P", 37: "L", 38: "J", 39: "'", 40: "K", 41: ";", 42: "\\", 43: ",", 44: "/",
            45: "N", 46: "M", 47: ".", 50: "`",
            36: "Return", 48: "Tab", 49: "Leertaste",
            115: "Pos1", 116: "Bild ↑", 117: "Entf ⌦", 119: "Ende", 121: "Bild ↓", 123: "←", 124: "→", 125: "↓", 126: "↑",
        ]
        let fTasten: [UInt32: Int] = [122: 1, 120: 2, 99: 3, 118: 4, 96: 5, 97: 6, 98: 7, 100: 8, 101: 9, 109: 10, 103: 11, 111: 12,
                                      105: 13, 107: 14, 113: 15, 106: 16, 64: 17, 79: 18, 80: 19, 90: 20]
        for (code, n) in fTasten { t[code] = "F\(n)" }
        return t
    }()
}
