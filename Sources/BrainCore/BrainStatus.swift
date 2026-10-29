import Foundation

public enum StatusFehler: Error, Equatable { case leereAusgabe }

/// Ergebnis von `brain status --json` (Kern, status.mjs).
public struct BrainStatus: Decodable, Equatable, Sendable {
    public enum Zustand: String, Codable, Sendable { case ok, hinweis, problem }
    public struct Zahlen: Decodable, Equatable, Sendable {
        public let vorschlaege: Int
        public let konflikte: Int
        public let abgelaufen: Int
        public let zuTun: Int
        /// Offene Rückfragen (B2-Kit); fehlt bei älteren Kits.
        public let rueckfragen: Int?
    }
    public let version: String
    public let quellVault: Bool
    public let zustand: Zustand
    public let meldungen: [String]
    public let zahlen: Zahlen
    /// Letzter Tageslauf (B2-Kit); fehlt bei älteren Kits oder wenn noch keiner lief.
    public let tageslauf: TageslaufKurz?

    /// Liest die letzte nicht-leere Zeile (frühere Zeilen könnten Hinweise anderer Module sein).
    public static func aus(ausgabe: String) throws -> BrainStatus {
        guard let zeile = ausgabe.split(separator: "\n")
            .last(where: { !$0.trimmingCharacters(in: .whitespaces).isEmpty }) else { throw StatusFehler.leereAusgabe }
        return try JSONDecoder().decode(BrainStatus.self, from: Data(zeile.utf8))
    }
}

/// Was die Menüleiste zeigt — immer Symbol + Text, nie nur Farbe (App-Spec §10).
public struct StatusAnzeige: Equatable, Sendable {
    public let symbol: String
    public let zeichen: String
    public let titel: String

    public init(symbol: String, zeichen: String, titel: String) {
        self.symbol = symbol
        self.zeichen = zeichen
        self.titel = titel
    }

    public static func problem(_ text: String) -> StatusAnzeige {
        StatusAnzeige(symbol: "xmark.octagon", zeichen: "✕", titel: text)
    }

    /// Studio läuft, aber es ist noch kein Vault gewählt (Willkommen).
    public static let keinVault = StatusAnzeige(symbol: "questionmark.circle", zeichen: "?", titel: "Kein Vault gewählt")

    /// Ordner ohne `brain.config.json` (kein Brain-Vault für den Kern): für das Studio völlig in Ordnung, es gibt nur keine
    /// Kern-Prüfungen (Status, Übersicht, Rückfragen). Ein altes `.tools/` im Vault spielt dafür keine Rolle.
    public static let ohneKit = StatusAnzeige(symbol: "checkmark.circle", zeichen: "✓", titel: "Ordner ohne brain.config.json — nur Studio")

    /// Der gebündelte Kern ist nicht bereit (fehlt im Paket, Prüfung gescheitert, Link kaputt): kein stiller Rückgriff auf Code im
    /// Vault, sondern eine klare Meldung. `text` ist die Erklärung (siehe `KernBereitschaft`).
    public static func kernNichtBereit(_ text: String) -> StatusAnzeige {
        StatusAnzeige(symbol: "exclamationmark.octagon", zeichen: "✕", titel: text)
    }

    /// Reste des Vertrauensmodells für Kern-Aufrufe (bis P5): Die App zeigt sie nicht mehr an, der gebündelte Kern braucht keine Freigabe.
    public static let kitNichtErlaubt = StatusAnzeige(symbol: "lock", zeichen: "🔒", titel: "Kit nicht erlaubt")
    public static let kitPruefungFehlgeschlagen = StatusAnzeige(symbol: "lock.trianglebadge.exclamationmark", zeichen: "⚠",
                                                                titel: "Kit-Prüfung fehlgeschlagen")

    public static func fuer(_ status: BrainStatus?, fehler: String? = nil) -> StatusAnzeige {
        guard let s = status else {
            return StatusAnzeige(symbol: "questionmark.circle", zeichen: "?", titel: fehler ?? "Status unbekannt")
        }
        switch s.zustand {
        case .ok:
            return StatusAnzeige(symbol: "checkmark.circle", zeichen: "✓", titel: "Alles in Ordnung")
        case .hinweis:
            // zuTun enthält die Vorschläge bereits (Kit) — nicht noch einmal addieren.
            let n = s.zahlen.zuTun
            let titel = n == 0 ? (s.meldungen.first ?? "Bitte kurz ansehen") : (n == 1 ? "1 Sache wartet" : "\(n) Sachen warten")
            return StatusAnzeige(symbol: "exclamationmark.triangle", zeichen: "⚠", titel: titel)
        case .problem:
            return problem(s.meldungen.first ?? "Es gibt ein Problem")
        }
    }
}
