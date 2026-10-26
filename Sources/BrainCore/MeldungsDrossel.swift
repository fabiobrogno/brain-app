import Foundation

/// Lässt höchstens `grenze` Meldungen durch; alles darüber wird verworfen, und nur die erste verworfene Meldung löst einen einzigen
/// Hinweis „gedrosselt“ aus. Je Fensterleben eine Instanz (die App legt sie mit dem Fenster an): Die Seite kann sonst mit
/// `postMessage({aktion:"fehler", …})` in einer Schleife das Protokoll (5 × 1 MB) in Sekunden wegrotieren und die Diagnosezeilen
/// verdrängen, die erklären, warum etwas nicht startet (Review SW-7). Die Grenze in `fehlerhaken.js` ist nur Höflichkeit der
/// eigenen Seite und setzt sich bei jedem Seitenladen zurück — Schutz gibt erst diese Zählung auf der Swift-Seite.
public struct MeldungsDrossel: Equatable, Sendable {
    public enum Urteil: Equatable, Sendable {
        /// Innerhalb der Grenze: ins Protokoll.
        case durchlassen
        /// Die erste Meldung über der Grenze: verwerfen und GENAU EINMAL festhalten, dass gedrosselt wird.
        case ersteDrosselung
        /// Alle weiteren: stillschweigend verwerfen.
        case verwerfen
    }

    public let grenze: Int
    /// Wie viele Meldungen schon durchgelassen wurden (nie mehr als `grenze`).
    public private(set) var durchgelassen = 0
    public private(set) var gedrosselt = false

    public init(grenze: Int) { self.grenze = max(0, grenze) }

    public mutating func melde() -> Urteil {
        if durchgelassen < grenze { durchgelassen += 1; return .durchlassen }
        if !gedrosselt { gedrosselt = true; return .ersteDrosselung }
        return .verwerfen
    }
}
