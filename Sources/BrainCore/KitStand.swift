import Foundation

/// Was die App über das Vertrauen in den aktiven Vault weiß (Studio-v2-Spec §8). Aus dem Ergebnis der letzten Vertrauensprüfung;
/// nur ein Anhaltspunkt für Menü und Anzeige — Kit-Code startet immer erst nach einer frischen Prüfung.
public enum KitStand: Equatable, Sendable {
    /// Noch nicht geprüft (Start, nach einem Vault-Wechsel) oder gar nicht prüfbar (kein Vault, Ordner fehlt, kein Kit).
    case unbekannt
    /// Die Prüfung sagt `{"erlaubt":true}`.
    case erlaubt
    /// Die Prüfung sagt ausdrücklich nein: noch nicht freigegeben, Ordner ersetzt oder Code geändert — der Nutzer kann im Studio
    /// freigeben.
    case nichtFreigegeben
    /// Die Prüfung selbst ist gescheitert (fehlt, Start, Zeit, unerwartete Ausgabe). Der Nutzer kann daran nichts ändern; den Grund
    /// gibt es im Protokoll. Gestartet wird auch dann nichts.
    case pruefungFehlgeschlagen

    public init(_ erlaubnis: KitErlaubnis) {
        switch erlaubnis {
        case .erlaubt: self = .erlaubt
        case .nein(let grund): self = grund.istTechnisch ? .pruefungFehlgeschlagen : .nichtFreigegeben
        }
    }
}

/// Was mit einer offenen Übersicht (ihre Kit-Brücke ist Code aus dem Vault) geschieht, wenn die Vertrauensprüfung ein Ergebnis hat
/// (Studio-v2-Spec §8, Review SW-2/SW-5): Sagt die Prüfung „nicht freigegeben“, schließt sie sofort. Ein technischer Fehler beim Prüfen
/// (unter Last, Skript fehlt) ist keine Aussage über das Vertrauen: Die Übersicht bleibt zunächst offen, die Prüfung wird nach
/// `wiederholungsFrist` einmal wiederholt, und erst wenn auch sie scheitert, schließt die Übersicht (ohne Beleg gilt „nein“).
public enum UebersichtRegel {
    public enum Folge: Equatable, Sendable {
        case offenLassen
        case schliessen
        /// Technischer Fehler beim ersten Versuch: Übersicht bleibt, in `wiederholungsFrist` noch einmal prüfen.
        case spaeterNochmalPruefen
    }

    public static let wiederholungsFrist = Duration.seconds(10)

    /// `zweiterVersuch`: das Ergebnis stammt aus der einen Wiederholung nach einem technischen Fehler.
    public static func folge(fuer erlaubnis: KitErlaubnis, zweiterVersuch: Bool) -> Folge {
        switch erlaubnis {
        case .erlaubt: return .offenLassen
        case .nein(let grund): return grund.istTechnisch && !zweiterVersuch ? .spaeterNochmalPruefen : .schliessen
        }
    }
}
