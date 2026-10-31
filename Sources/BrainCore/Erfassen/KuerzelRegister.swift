import Foundation

/// Ein Befehl aus dem Register der Tastenkürzel (Paket P10).
public struct KuerzelBefehl: Equatable, Sendable {
    public let id: String
    public let name: String
    public let text: String
    public let gruppe: String
    /// Gilt auch, wenn ein anderes Programm vorne ist (die App meldet es per Carbon beim System an).
    public let global: Bool
    /// Standardkürzel in der gemeinsamen Schreibweise („Shift+Cmd+M“); `nil` = ab Werk ohne Kürzel.
    public let standard: String?
    /// Name des Menübefehls im Studio (`StudioBefehl.rawValue`), wenn der Befehl auch im Menü der App steht.
    public let menue: String?
}

/// Ein Kürzel, das nicht frei vergeben werden darf (macOS oder ein fester Eintrag in den Menüs von Kortex).
public struct KuerzelReserviert: Equatable, Sendable {
    public let kuerzel: String
    public let grund: String
    /// „macOS“ oder „Kortex“
    public let von: String
}

/// Das Register aller Tastenkürzel: dieselbe Datei wie im Studio und in der Werkstatt (`Ressourcen/gemeinsam/tastenkuerzel-register.json`, im App-Paket
/// `Contents/Resources/gemeinsam/tastenkuerzel-register.json`). Studio, Menüs der App und globale Kürzel lesen alle diese eine Quelle; hier steht nichts doppelt.
public struct KuerzelRegister: Equatable, Sendable {
    public let tasten: [String]
    public let befehle: [KuerzelBefehl]
    public let reserviert: [KuerzelReserviert]

    public func befehl(_ id: String) -> KuerzelBefehl? { befehle.first { $0.id == id } }
    /// Der Befehl, der im Studio unter diesem Menü-Namen läuft (`StudioBefehl.rawValue`).
    public func befehl(menue: String) -> KuerzelBefehl? { befehle.first { $0.menue == menue } }
    public func reserviertGrund(_ text: String) -> KuerzelReserviert? { reserviert.first { $0.kuerzel == text } }

    /// Die reservierten Kürzel als Systemkürzel (für `KuerzelPruefung`: dieselbe Prüfung wie bei den Kürzeln, die macOS selbst vergibt).
    public var reserviertAlsSystem: [SystemKuerzel] {
        reserviert.compactMap { r in
            guard let k = Tastenkuerzel(kanonisch: r.kuerzel) else { return nil }
            return SystemKuerzel(name: r.grund, taste: k.taste, umschalter: k.umschalter)
        }
    }

    public enum Fehler: Error, Equatable { case ungueltig(String) }

    private struct RohBefehl: Decodable {
        let id: String, name: String, text: String, gruppe: String
        let global: Bool?
        let standard: String?
        let menue: String?
    }
    private struct RohReserviert: Decodable { let kuerzel: String, grund: String, von: String? }
    private struct Roh: Decodable { let schema: Int; let tasten: [String]; let befehle: [RohBefehl]; let reserviert: [RohReserviert] }

    public static func laden(daten: Data) throws -> KuerzelRegister {
        let roh = try JSONDecoder().decode(Roh.self, from: daten)
        guard roh.schema == 1 else { throw Fehler.ungueltig("schema \(roh.schema)") }
        return KuerzelRegister(
            tasten: roh.tasten,
            befehle: roh.befehle.map { KuerzelBefehl(id: $0.id, name: $0.name, text: $0.text, gruppe: $0.gruppe, global: $0.global ?? false, standard: $0.standard, menue: $0.menue) },
            reserviert: roh.reserviert.map { KuerzelReserviert(kuerzel: $0.kuerzel, grund: $0.grund, von: $0.von ?? "macOS") })
    }

    private final class Zwischen: @unchecked Sendable {
        private let sperre = NSLock()
        private var werte: [String: KuerzelRegister] = [:]
        func hole(_ schluessel: String) -> KuerzelRegister? { sperre.lock(); defer { sperre.unlock() }; return werte[schluessel] }
        func setze(_ schluessel: String, _ r: KuerzelRegister) { sperre.lock(); defer { sperre.unlock() }; werte[schluessel] = r }
    }
    private static let zwischen = Zwischen()

    /// Das Register aus `<ressourcen>/gemeinsam/tastenkuerzel-register.json` (App-Paket: `Contents/Resources`, Repo: `Ressourcen`); `nil`, wenn die Datei fehlt oder nicht lesbar ist.
    public static func laden(ressourcen: URL?) -> KuerzelRegister? {
        guard let ressourcen else { return nil }
        let datei = ressourcen.appendingPathComponent("gemeinsam", isDirectory: true).appendingPathComponent("tastenkuerzel-register.json")
        if let r = zwischen.hole(datei.path) { return r }
        guard let daten = try? Data(contentsOf: datei), let r = try? laden(daten: daten) else { return nil }
        zwischen.setze(datei.path, r)
        return r
    }
}

// MARK: Gemeinsame Schreibweise („Ctrl+Alt+Shift+Cmd+Taste“) ↔ Tastenkuerzel

extension Tastenkuerzel {
    /// Namen der Tasten in der gemeinsamen Schreibweise, wenn sie nicht einfach das Zeichen sind (Rest: das Zeichen selbst bzw. „F1“ …).
    private static let sondernamen: [UInt32: String] = [
        36: "Return", 48: "Tab", 49: "Space", 115: "Home", 116: "PageUp", 117: "Delete", 119: "End", 121: "PageDown",
        123: "Left", 124: "Right", 125: "Down", 126: "Up",
    ]

    /// Tastencode → Name in der gemeinsamen Schreibweise (wie `tasten` im Register).
    static let kanonischeNamen: [UInt32: String] = {
        var t: [UInt32: String] = [:]
        for (code, name) in tastenNamen { t[code] = sondernamen[code] ?? name }
        return t
    }()
    private static let codeZuName: [String: UInt32] = Dictionary(uniqueKeysWithValues: kanonischeNamen.map { ($0.value, $0.key) })

    /// „Shift+Cmd+M“ → Kürzel. `nil`, wenn die Schreibweise nicht stimmt (falsche Reihenfolge, unbekannte Taste …).
    public init?(kanonisch text: String) {
        let teile = text.split(separator: "+", omittingEmptySubsequences: false).map(String.init)
        guard let name = teile.last, let code = Self.codeZuName[name] else { return nil }
        let reihe = ["Ctrl", "Alt", "Shift", "Cmd"]
        var u: Umschalter = []
        var letzter = -1
        for t in teile.dropLast() {
            guard let i = reihe.firstIndex(of: t), i > letzter else { return nil }
            letzter = i
            switch t {
            case "Ctrl": u.insert(.control)
            case "Alt": u.insert(.option)
            case "Shift": u.insert(.shift)
            default: u.insert(.command)
            }
        }
        self.init(taste: code, umschalter: u)
    }

    /// Das Kürzel in der gemeinsamen Schreibweise; `nil` bei einer Taste, die das Register nicht kennt.
    public var kanonisch: String? {
        guard let name = Self.kanonischeNamen[taste] else { return nil }
        var teile: [String] = []
        if umschalter.contains(.control) { teile.append("Ctrl") }
        if umschalter.contains(.option) { teile.append("Alt") }
        if umschalter.contains(.shift) { teile.append("Shift") }
        if umschalter.contains(.command) { teile.append("Cmd") }
        return (teile + [name]).joined(separator: "+")
    }

    /// Zeichen für `NSMenuItem.keyEquivalent` bzw. `KeyEquivalent` (Buchstaben klein; Pfeile und F-Tasten als Funktionstasten-Zeichen). `nil`, wenn die Taste im Menü nicht geht.
    public var menueZeichen: String? {
        guard let name = Self.kanonischeNamen[taste] else { return nil }
        if name.count == 1 { return name.lowercased() }
        let funktion: [String: UInt32] = ["Up": 0xF700, "Down": 0xF701, "Left": 0xF702, "Right": 0xF703, "Delete": 0xF728, "Home": 0xF729, "End": 0xF72B, "PageUp": 0xF72C, "PageDown": 0xF72D]
        switch name {
        case "Space": return " "
        case "Return": return "\r"
        case "Tab": return "\t"
        default:
            if let f = funktion[name], let s = Unicode.Scalar(f) { return String(Character(s)) }
            if name.hasPrefix("F"), let n = Int(name.dropFirst()), (1...20).contains(n), let s = Unicode.Scalar(0xF703 + UInt32(n)) { return String(Character(s)) } // F1 = 0xF704
            return nil
        }
    }
}
