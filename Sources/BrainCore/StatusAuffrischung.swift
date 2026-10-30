import Foundation

/// Live-Aktualisierung der Menüleiste: Das Studio meldet jede Änderung im Vault (`status-auffrischen`), die App liest dann den Status neu
/// (`brain status`, Zähler der Aufgaben und des Posteingangs). Viele Meldungen kurz hintereinander (Claude legt zehn Aufgaben an) werden zu EINEM
/// Lauf gebündelt, und zwischen zwei Läufen liegt mindestens `mindestAbstand` — so entsteht keine Dauerlast. Rein, ohne Uhr und ohne Prozess:
/// der Aufrufer gibt die Zeit mit und wartet selbst bis zum genannten Zeitpunkt.
public struct StatusAuffrischung: Sendable, Equatable {
    /// So lange wird nach der ersten Meldung gewartet, damit weitere Meldungen in denselben Lauf fallen.
    public let verzoegerung: TimeInterval
    /// Frühester Abstand zwischen dem Beginn eines Laufs und dem nächsten.
    public let mindestAbstand: TimeInterval
    private var geplantFuer: Date?
    private var letzterLauf: Date?

    public init(verzoegerung: TimeInterval = 1.5, mindestAbstand: TimeInterval = 5) {
        self.verzoegerung = max(0, verzoegerung)
        self.mindestAbstand = max(0, mindestAbstand)
    }

    /// Eine Meldung ist eingetroffen. Rückgabe: der Zeitpunkt, zu dem ein Lauf starten soll — oder `nil`, wenn schon einer geplant ist
    /// (der liest den dann neuesten Stand und deckt diese Meldung mit ab).
    public mutating func anfordern(jetzt: Date) -> Date? {
        if geplantFuer != nil { return nil }
        var wann = jetzt.addingTimeInterval(verzoegerung)
        if let letzter = letzterLauf {
            let fruehestens = letzter.addingTimeInterval(mindestAbstand)
            if wann < fruehestens { wann = fruehestens }
        }
        geplantFuer = wann
        return wann
    }

    /// Der geplante Lauf beginnt jetzt: ab der nächsten Meldung wird neu geplant.
    public mutating func gelaufen(jetzt: Date) {
        letzterLauf = jetzt
        geplantFuer = nil
    }

    /// Ist gerade ein Lauf geplant? (Tests, Diagnose)
    public var istGeplant: Bool { geplantFuer != nil }
}
