import Foundation

// Auswertung der Antworten der Werkstatt (Node-Teil, der auch das Studio bedient) für die Teile der App, die selbst eine Anfrage stellen
// („Schnell erfassen“). Früher stand das im Dienstprotokoll des SwiftUI-Assistenten; den ersetzt die Web-Seite „Kortex einrichten“.

/// Ein Fehler, den der Nutzer lesen darf (deutscher Klartext). `art`/`befehl` stammen aus den Fehlerantworten der Werkstatt.
public struct EinrichtungsFehler: Error, Equatable, Sendable {
    public let meldung: String
    /// HTTP-Status der Werkstatt, nil bei Fehlern, die gar nicht erst dort ankamen.
    public let status: Int?
    /// z. B. `nicht-vertraut` (der Vault ist noch nicht bestätigt).
    public let art: String?
    /// Ein Befehl zum Kopieren, falls der Weg über die App nicht klappt.
    public let befehl: String?

    public init(_ meldung: String, status: Int? = nil, art: String? = nil, befehl: String? = nil) {
        self.meldung = meldung
        self.status = status
        self.art = art
        self.befehl = befehl
    }
}

public enum WerkstattAntwort {
    /// Ein Fehler beim Aufruf der Werkstatt (Verbindung, Zeit, Prozess) als lesbarer Text.
    static func verbindungsfehler(_ fehler: Error) -> EinrichtungsFehler {
        switch fehler {
        case BrueckenFehler.zeitUeberschritten:
            return EinrichtungsFehler("Das hat zu lange gedauert. Bitte versuche es noch einmal.")
        case BrueckenFehler.startFehlgeschlagen, BrueckenFehler.beendet, BrueckenFehler.geschlossen, BrueckenFehler.nichtErlaubt:
            return EinrichtungsFehler("Der Hintergrunddienst von Kortex antwortet nicht. Bitte starte Kortex neu.")
        default:
            return EinrichtungsFehler("Unerwarteter Fehler: \(fehler.localizedDescription)")
        }
    }

    /// 2xx → JSON-Objekt (leerer Körper = leeres Objekt); sonst `EinrichtungsFehler` aus `{fehler, art, befehl}`.
    static func auswerten(_ a: BrueckenAntwort) throws -> [String: Any] {
        let j = (try? JSONSerialization.jsonObject(with: a.body)) as? [String: Any]
        guard (200..<300).contains(a.status) else {
            let meldung = (j?["fehler"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Das hat nicht geklappt (Fehler \(a.status))."
            throw EinrichtungsFehler(meldung, status: a.status, art: j?["art"] as? String, befehl: j?["befehl"] as? String)
        }
        if a.body.isEmpty { return [:] }
        guard let j else { throw EinrichtungsFehler("Die Antwort des Hintergrunddienstes war nicht lesbar.") }
        return j
    }
}
