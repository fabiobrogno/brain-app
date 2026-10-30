import Foundation

/// Was „Schnell erfassen“ ablegen soll. `titel` gilt nur für Aufgaben; bei einer Notiz steht alles in `text` (die Werkstatt macht den
/// Titel aus der ersten Zeile, genau wie bei „Schnell merken“ und `brain_merken`).
public struct Erfassung: Equatable, Sendable {
    public var art: ErfassungsArt
    public var titel: String
    public var text: String
    public var prioritaet: ErfassungsPrioritaet?
    /// `JJJJ-MM-TT`
    public var faellig: String?
    public var vault: URL

    public init(art: ErfassungsArt, titel: String = "", text: String, prioritaet: ErfassungsPrioritaet? = nil, faellig: String? = nil, vault: URL) {
        self.art = art
        self.titel = titel
        self.text = text
        self.prioritaet = prioritaet
        self.faellig = faellig
        self.vault = vault
    }
}

public struct ErfassenFehler: Error, Equatable, Sendable {
    public let meldung: String
    /// Der Vault ist nicht als deiner bestätigt („Nur ansehen“): schreiben darf Kortex hier nicht.
    public let nichtVertraut: Bool

    public init(_ meldung: String, nichtVertraut: Bool = false) {
        self.meldung = meldung
        self.nichtVertraut = nichtVertraut
    }
}

/// Legt eine Erfassung im Vault ab und liefert den Pfad der neuen Datei (relativ zum Vault).
public protocol ErfassenSpeicher: Sendable {
    func speichere(_ erfassung: Erfassung) async throws -> String
}

/// Der echte Weg, ohne geöffnetes Studio: Für jedes Speichern startet die App kurz eine eigene Werkstatt für den gewählten Vault
/// (dieselbe, die auch das Studio nutzt) und beendet sie danach wieder. Die Werkstatt ruft denselben Code wie das Studio:
///  - Aufgabe: `POST /api/aufgaben` → `legeAn` aus `kern/aufgaben.mjs`. Die Quelle ist immer `mensch` (die Werkstatt setzt sie fest),
///    in einem nicht bestätigten Vault antwortet sie mit 409 `nicht-vertraut`.
///  - Notiz: `POST /api/merken` → derselbe Weg wie „Schnell merken“ und `brain_merken`: Datei in `00_inbox/`.
/// Die Eingabe geht als JSON hin, nie als Kommandozeile — ein Titel wie `--text` bleibt so einfach ein Titel.
public struct WerkstattErfassenSpeicher: ErfassenSpeicher {
    public typealias BrueckeFuer = @Sendable (URL) -> BrueckenVerbindung
    private let bruecke: BrueckeFuer

    public init(bruecke: @escaping BrueckeFuer) { self.bruecke = bruecke }

    public func speichere(_ e: Erfassung) async throws -> String {
        let (pfad, koerper) = Self.anfrage(fuer: e)
        let verbindung = bruecke(e.vault)
        let antwort: BrueckenAntwort
        do {
            antwort = try await verbindung.anfrage(methode: "POST", pfad: pfad, body: try JSONSerialization.data(withJSONObject: koerper))
        } catch {
            await verbindung.beende()
            throw ErfassenFehler(WerkstattDienste.verbindungsfehler(error).meldung)
        }
        await verbindung.beende()
        do {
            let j = try WerkstattDienste.auswerten(antwort)
            guard let datei = j["pfad"] as? String, !datei.isEmpty else { throw ErfassenFehler("Die Antwort des Hintergrunddienstes war unvollständig.") }
            return datei
        } catch let fehler as EinrichtungsFehler {
            throw ErfassenFehler(fehler.meldung, nichtVertraut: fehler.art == "nicht-vertraut")
        }
    }

    /// Route und Körper der Anfrage (ohne Prozess, einzeln testbar).
    static func anfrage(fuer e: Erfassung) -> (pfad: String, koerper: [String: Any]) {
        switch e.art {
        case .aufgabe:
            var k: [String: Any] = ["titel": e.titel]
            if !e.text.isEmpty { k["text"] = e.text }
            if let p = e.prioritaet { k["prioritaet"] = p.rawValue }
            if let f = e.faellig { k["faellig"] = f }
            return ("/api/aufgaben", k)
        case .notiz:
            return ("/api/merken", ["text": e.text])
        }
    }
}
