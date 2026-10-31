import Foundation

/// Ergebnis der schnellen Zählung im gewählten Ordner: Notizen (`.md`, `.txt`) und Unterordner.
public struct OrdnerZaehlung: Equatable, Sendable {
    public var notizen = 0
    public var ordner = 0
    /// Die Zählung wurde abgebrochen (Zeit oder Menge): die Zahlen sind ein Mindeststand.
    public var mehr = false

    public init(notizen: Int = 0, ordner: Int = 0, mehr: Bool = false) {
        self.notizen = notizen
        self.ordner = ordner
        self.mehr = mehr
    }
}

/// Begrenzte, schnelle Zählung für die Anzeige nach der Ordner-Wahl („12 Notizen in 3 Ordnern“). Liest nur Verzeichnisse.
/// Versteckte Einträge (Name beginnt mit „.“) und `node_modules` zählen nicht und werden nicht betreten; symbolischen Links folgt sie nie
/// (sie zählen auch selbst nicht). Nach `zeitlimit` oder `maxEintraege` besuchten Einträgen bricht sie ab (`mehr`).
/// Läuft synchron und gehört abseits des Main-Threads aufgerufen.
public enum OrdnerZaehler {
    public static let zeitlimit: TimeInterval = 1.5
    public static let maxEintraege = 20_000
    static let notizEndungen: Set<String> = ["md", "txt"]

    public static func zaehle(_ wurzel: URL, zeitlimit: TimeInterval = OrdnerZaehler.zeitlimit, maxEintraege: Int = OrdnerZaehler.maxEintraege,
                              jetzt: () -> Date = { Date() }) -> OrdnerZaehlung {
        var z = OrdnerZaehlung()
        let ende = jetzt().addingTimeInterval(zeitlimit)
        let schluessel: [URLResourceKey] = [.isDirectoryKey, .isSymbolicLinkKey]
        guard let e = FileManager.default.enumerator(at: wurzel, includingPropertiesForKeys: schluessel, options: [.skipsHiddenFiles]) else { return z }
        var besucht = 0
        while let u = e.nextObject() as? URL {
            besucht += 1
            if besucht > maxEintraege || jetzt() >= ende { z.mehr = true; break }
            let v = try? u.resourceValues(forKeys: Set(schluessel))
            if v?.isSymbolicLink == true { continue }
            if v?.isDirectory == true {
                if u.lastPathComponent == "node_modules" { e.skipDescendants(); continue }
                z.ordner += 1
            } else if notizEndungen.contains(u.pathExtension.lowercased()) {
                z.notizen += 1
            }
        }
        return z
    }
}

/// Antwort der Aktion `ordner-waehlen`: `{pfad}` und, wo es zutrifft, `breit: {name, vorschlag?}` (der Ort ist als Vault zu breit),
/// `notizen`, `ordner` und `mehr: true` (Zählung abgebrochen). Ältere Aufrufer lesen nur `pfad`.
public enum OrdnerWahlAntwort {
    public static func baue(pfad: URL, home: URL, zaehlung: OrdnerZaehlung?) -> [String: Any] {
        var a: [String: Any] = ["pfad": pfad.path]
        if let b = VaultAuswahl.breiterOrt(pfad, home: home) {
            var breit: [String: Any] = ["name": b.name]
            if let v = b.vorschlag { breit["vorschlag"] = v.path }
            a["breit"] = breit
        }
        if let z = zaehlung {
            a["notizen"] = z.notizen
            a["ordner"] = z.ordner
            if z.mehr { a["mehr"] = true }
        }
        return a
    }
}
