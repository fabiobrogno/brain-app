import Foundation

/// Ein Kürzel, das macOS selbst vergibt (Systemeinstellungen → Tastatur → Tastaturkurzbefehle). Nur eingeschaltete zählen.
public struct SystemKuerzel: Equatable, Sendable {
    public let name: String
    public let taste: UInt32
    public let umschalter: Tastenkuerzel.Umschalter

    public init(name: String, taste: UInt32, umschalter: Tastenkuerzel.Umschalter) {
        self.name = name
        self.taste = taste
        self.umschalter = umschalter
    }
}

/// Liest die Systemkürzel aus den Einstellungen `com.apple.symbolichotkeys` (Schlüssel `AppleSymbolicHotKeys`). Lesen kostet kein
/// Recht und verändert nichts. Das Format ist nicht öffentlich dokumentiert, darum ist der Leser vorsichtig: Was er nicht versteht,
/// überspringt er (dann fehlt höchstens eine Warnung; registriert wird das Kürzel trotzdem, und ein belegtes meldet Carbon selbst).
public enum SystemKuerzelLeser {
    /// Bekannte Nummern (Auswahl der Kürzel, die wirklich in Frage kommen); alles andere heißt allgemein „Systemkürzel“.
    static let namen: [Int: String] = [
        27: "Fenster desselben Programms wechseln", 28: "Bildschirmfoto sichern", 29: "Bildschirmfoto in die Ablage",
        30: "Bildschirmfoto eines Bereichs sichern", 31: "Bildschirmfoto eines Bereichs in die Ablage",
        32: "Mission Control", 33: "Fenster des Programms zeigen", 36: "Schreibtisch zeigen", 52: "Dock ein-/ausblenden",
        60: "Vorherige Eingabequelle", 61: "Nächste Eingabequelle", 64: "Spotlight-Suche", 65: "Finder-Suche",
        79: "Ein Space nach links", 81: "Ein Space nach rechts", 160: "Launchpad", 175: "Nicht stören", 184: "Bildschirmfoto-Optionen",
        190: "Kurznotiz",
    ]

    /// Die Bits der Umschalttasten in den Einstellungen (wie `NSEvent.ModifierFlags`).
    static let bits: [(Int, Tastenkuerzel.Umschalter)] = [
        (0x20000, .shift), (0x40000, .control), (0x80000, .option), (0x100000, .command),
    ]

    public static func lese(_ symbolisch: [String: Any]?) -> [SystemKuerzel] {
        guard let symbolisch else { return [] }
        var ergebnis: [SystemKuerzel] = []
        for (schluessel, wert) in symbolisch {
            guard let eintrag = wert as? [String: Any],
                  zahl(eintrag["enabled"]).map({ $0 != 0 }) == true,
                  let inhalt = eintrag["value"] as? [String: Any],
                  let parameter = inhalt["parameters"] as? [Any], parameter.count >= 3,
                  let taste = zahl(parameter[1]), taste >= 0, taste < 0xFFFF, taste != 0xFFFF,
                  let maske = zahl(parameter[2]) else { continue }
            let nummer = Int(schluessel)
            var u: Tastenkuerzel.Umschalter = []
            for (bit, wert) in bits where maske & bit != 0 { u.insert(wert) }
            ergebnis.append(SystemKuerzel(name: nummer.flatMap { namen[$0] } ?? "Systemkürzel", taste: UInt32(taste), umschalter: u))
        }
        return ergebnis.sorted { ($0.name, $0.taste) < ($1.name, $1.taste) }
    }

    /// Die Einstellungen des Systems (nur im laufenden Programm; Tests übergeben ein eigenes Wörterbuch an `lese`).
    public static func ausSystem() -> [SystemKuerzel] {
        let wert = CFPreferencesCopyAppValue("AppleSymbolicHotKeys" as CFString, "com.apple.symbolichotkeys" as CFString)
        return lese(wert as? [String: Any])
    }

    private static func zahl(_ wert: Any?) -> Int? {
        if let n = wert as? NSNumber { return n.intValue }
        return nil
    }
}

/// Darf dieses Kürzel gelten? Reine Funktion.
public enum KuerzelPruefung {
    public enum Problem: Equatable, Sendable {
        /// Ohne ⌃ oder ⌘ würde das Kürzel beim Tippen mitspielen (⌥ und ⇧ erzeugen selbst Zeichen).
        case umschalterFehlt
        case tasteUnbekannt
        /// macOS vergibt dieses Kürzel selbst (Name aus den Tastatur-Einstellungen).
        case system(String)

        public var text: String {
            switch self {
            case .umschalterFehlt: return "Bitte mit ⌃ (Control) oder ⌘ (Befehl) kombinieren, sonst stört das Kürzel beim Schreiben."
            case .tasteUnbekannt: return "Diese Taste lässt sich nicht als Kürzel verwenden."
            case .system(let name): return "Dieses Kürzel nutzt macOS bereits („\(name)“). Wähle ein anderes oder schalte es in den Tastatur-Einstellungen aus."
            }
        }
    }

    public static func pruefe(_ k: Tastenkuerzel, system: [SystemKuerzel]) -> Problem? {
        guard Tastenkuerzel.tasteErlaubt(k.taste) else { return .tasteUnbekannt }
        guard k.umschalter.contains(.control) || k.umschalter.contains(.command) else { return .umschalterFehlt }
        if let treffer = system.first(where: { $0.taste == k.taste && $0.umschalter == k.umschalter }) { return .system(treffer.name) }
        return nil
    }
}
