import Foundation
import Combine

/// Ein Vault, in den „Schnell erfassen“ speichern kann.
public struct ErfassenVault: Equatable, Identifiable, Sendable {
    public let name: String
    public let url: URL
    public var id: String { url.path }

    public init(name: String, url: URL) {
        self.name = name
        self.url = url
    }

    /// Alle Vaults aus der Liste der Werkstatt (`vaults.json`), die es noch gibt, und der aktive. Nur lesend.
    public static func lade(_ pfade: AppPfade, home: URL = FileManager.default.homeDirectoryForCurrentUser) -> (liste: [ErfassenVault], aktiv: URL?) {
        let aktiv = VaultListe.aktiverVault(pfade, home: home)
        let verzeichnis = VaultListe.lade(pfade, home: home)
        var liste: [ErfassenVault] = []
        for e in verzeichnis?.vaults ?? [] {
            var istOrdner: ObjCBool = false
            guard FileManager.default.fileExists(atPath: e.pfad, isDirectory: &istOrdner), istOrdner.boolValue else { continue }
            let url = URL(fileURLWithPath: e.pfad, isDirectory: true)
            liste.append(ErfassenVault(name: verzeichnis?.anzeigename(fuer: url) ?? url.lastPathComponent, url: url))
        }
        // Der aktive Vault kann (nur Rückfall `config.json`) fehlen in der Liste: dann trotzdem anbieten.
        if let aktiv, !liste.contains(where: { gleich($0.url, aktiv) }) {
            liste.insert(ErfassenVault(name: verzeichnis?.anzeigename(fuer: aktiv) ?? aktiv.lastPathComponent, url: aktiv), at: 0)
        }
        return (liste, aktiv)
    }

    static func gleich(_ a: URL, _ b: URL) -> Bool { a.standardizedFileURL.path == b.standardizedFileURL.path }
}

/// Zustand und Ablauf des Fensters „Schnell erfassen“ — ohne Oberfläche, darum einzeln testbar. Das Fenster (SwiftUI) zeigt ihn nur an.
@MainActor
public final class ErfassenModell: ObservableObject {
    public enum Zustand: Equatable, Sendable {
        case bereit
        case speichert
        /// Name des Vaults, in dem es liegt.
        case gespeichert(vault: String)
        case fehler(String)
    }

    /// Fälligkeit: erkannt aus dem Text, bewusst keine oder ein gewähltes Datum (`JJJJ-MM-TT`).
    public enum FaelligWahl: Equatable, Sendable {
        case automatisch
        case keine
        case datum(String)
    }

    @Published public var text = ""
    @Published public var art: ErfassungsArt
    /// nil = so, wie es im Text steht (oder normal).
    @Published public var prioritaetWahl: ErfassungsPrioritaet?
    @Published public var faelligWahl = FaelligWahl.automatisch
    /// Die Kurzformen im Text erkennen (Priorität, Fälligkeit). Der Nutzer kann eine erkannte Kurzform als gewöhnlichen Text lassen.
    @Published public var erkennePrioritaet = true
    @Published public var erkenneFaelligkeit = true
    @Published public private(set) var vaults: [ErfassenVault] = []
    /// Pfad des gewählten Ziel-Vaults (nil = keiner verfügbar).
    @Published public var zielPfad: String?
    @Published public private(set) var zustand = Zustand.bereit
    /// Zählt hoch, wenn das Eingabefeld den Fokus bekommen soll (jedes Mal, wenn das Fenster erscheint).
    @Published public private(set) var fokusAnfrage = 0
    /// Das Kürzel zum Öffnen des Fensters und eine Meldung dazu (belegt, vom System vergeben …).
    @Published public private(set) var kuerzel: Tastenkuerzel
    @Published public var kuerzelMeldung: String?
    @Published public var kuerzelAendern = false

    /// Das Fenster soll sich schließen (nach „Gespeichert“ oder mit Esc).
    public var beiSchliessen: (() -> Void)?
    /// Übergibt ein neues Kürzel an die Verwaltung; Rückgabe: Fehlertext oder nil.
    public var aendereKuerzel: ((Tastenkuerzel) -> String?)?

    private let speicher: ErfassenSpeicher
    private let vaultQuelle: () -> (liste: [ErfassenVault], aktiv: URL?)
    private let vertrauen: (URL) -> VaultVertrauen
    private let heute: () -> Date
    private let kalender: Calendar
    private let warte: (Duration) async -> Void
    private let merkeArt: (ErfassungsArt) -> Void
    /// Wie lange „Gespeichert in …“ stehen bleibt, bevor sich das Fenster schließt.
    private let bestaetigungsdauer: Duration

    public init(art: ErfassungsArt = .aufgabe, kuerzel: Tastenkuerzel = .standard, speicher: ErfassenSpeicher,
                vaultQuelle: @escaping () -> (liste: [ErfassenVault], aktiv: URL?),
                vertrauen: @escaping (URL) -> VaultVertrauen,
                heute: @escaping () -> Date = { Date() }, kalender: Calendar = .current,
                warte: @escaping (Duration) async -> Void = { try? await Task.sleep(for: $0) },
                bestaetigungsdauer: Duration = .milliseconds(900),
                merkeArt: @escaping (ErfassungsArt) -> Void = { _ in }) {
        self.art = art
        self.kuerzel = kuerzel
        self.speicher = speicher
        self.vaultQuelle = vaultQuelle
        self.vertrauen = vertrauen
        self.heute = heute
        self.kalender = kalender
        self.warte = warte
        self.bestaetigungsdauer = bestaetigungsdauer
        self.merkeArt = merkeArt
        ladeVaults()
    }

    // MARK: Anzeige

    public var ziel: ErfassenVault? { vaults.first { $0.id == zielPfad } }

    /// Erkannte Kurzformen (nur bei Aufgaben).
    public var entwurf: Kurzformen.Ergebnis {
        Kurzformen.lies(bereinigt(text), heute: heute(), kalender: kalender, prioritaet: erkennePrioritaet, faellig: erkenneFaelligkeit)
    }

    public var wirksamePrioritaet: ErfassungsPrioritaet? { prioritaetWahl ?? entwurf.prioritaet }

    public var wirksameFaelligkeit: String? {
        switch faelligWahl {
        case .automatisch: return entwurf.faellig
        case .keine: return nil
        case .datum(let d): return d
        }
    }

    /// `JJJJ-MM-TT` für heute plus `tage` (für die Schnellwahl der Fälligkeit).
    public func isoIn(tage: Int) -> String {
        let tag = kalender.date(byAdding: .day, value: tage, to: kalender.startOfDay(for: heute())) ?? heute()
        let c = kalender.dateComponents([.year, .month, .day], from: tag)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// Der nächste Montag (wie „nächste Woche“ in den Kurzformen).
    public func naechsteWoche() -> String? { Kurzformen.lies("x nächste Woche", heute: heute(), kalender: kalender).faellig }

    public func faelligText(_ iso: String) -> String { Kurzformen.faelligText(iso, heute: heute(), kalender: kalender) }

    public var kannSpeichern: Bool { !bereinigt(text).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && zustand != .speichert }

    /// Hinweis, warum nicht gespeichert werden kann (Vault fehlt, nur ansehen) — schon vor dem Klick.
    public var zielHinweis: String? {
        guard let ziel else { return "Kein Vault gewählt. Wähle in Kortex einen Vault aus (Menü → Vault wechseln …)." }
        return vertrauen(ziel.url) == .vertraut ? nil : Self.nurAnsehenText(ziel.name)
    }

    static func nurAnsehenText(_ name: String) -> String {
        "„\(name)“ ist nur zum Ansehen freigegeben. Bestätige den Vault im Studio unter Einstellungen, dann kannst du hier speichern."
    }

    // MARK: Ablauf

    /// Beim Erscheinen: Vaults neu lesen, Fehlermeldung und Bestätigung weg, Fokus ins Feld. Der Entwurf bleibt stehen (ein Esc darf
    /// keinen Gedanken kosten); nur nach dem Speichern ist das Feld leer.
    public func vorbereiten() {
        ladeVaults()
        if case .speichert = zustand { return }
        zustand = .bereit
        kuerzelAendern = false
        fokusAnfrage += 1
    }

    public func ladeVaults() {
        let q = vaultQuelle()
        vaults = q.liste
        if let z = zielPfad, q.liste.contains(where: { $0.id == z }) { return }
        zielPfad = q.aktiv.flatMap { a in q.liste.first { ErfassenVault.gleich($0.url, a) }?.id } ?? q.liste.first?.id
    }

    public func schliesse() { beiSchliessen?() }

    public func speichere() async {
        guard zustand != .speichert else { return }
        let roh = bereinigt(text)
        guard !roh.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { zustand = .fehler("Schreib erst etwas auf."); return }
        guard let ziel else { zustand = .fehler(zielHinweis ?? "Kein Vault gewählt."); return }
        guard vertrauen(ziel.url) == .vertraut else { zustand = .fehler(Self.nurAnsehenText(ziel.name)); return }
        let erfassung: Erfassung
        switch baue(roh, ziel: ziel.url) {
        case .success(let e): erfassung = e
        case .failure(let f): zustand = .fehler(f.meldung); return
        }
        zustand = .speichert
        do {
            _ = try await speicher.speichere(erfassung)
        } catch {
            zustand = .fehler((error as? ErfassenFehler)?.meldung ?? "Das Speichern hat nicht geklappt: \(error.localizedDescription)")
            return
        }
        merkeArt(art)
        text = ""
        prioritaetWahl = nil
        faelligWahl = .automatisch
        erkennePrioritaet = true
        erkenneFaelligkeit = true
        zustand = .gespeichert(vault: ziel.name)
        await warte(bestaetigungsdauer)
        // Hat der Nutzer in der Zwischenzeit weitergemacht (neuer Text), bleibt das Fenster.
        if case .gespeichert = zustand { beiSchliessen?() }
    }

    /// Eingabe bearbeitet: das Feld zeigt wieder „bereit“, sobald getippt wird.
    public func eingabeGeaendert() {
        switch zustand {
        case .fehler, .gespeichert: zustand = .bereit
        default: break
        }
    }

    /// Neues Kürzel wählen (aus dem Aufnahmefeld). Bei einem Fehler bleibt das Aufnahmefeld offen und zeigt den Text.
    public func waehleKuerzel(_ neu: Tastenkuerzel) {
        if let fehler = aendereKuerzel?(neu) {
            kuerzelMeldung = fehler
        } else {
            kuerzel = neu
            beendeKuerzelAendern()
        }
    }

    public func beendeKuerzelAendern() {
        kuerzelAendern = false
        kuerzelMeldung = nil
        fokusAnfrage += 1
    }

    public func setzeKuerzel(_ k: Tastenkuerzel) { kuerzel = k }

    // MARK: Aufbau der Erfassung

    func baue(_ roh: String, ziel: URL) -> Result<Erfassung, ErfassenFehler> {
        switch art {
        case .notiz:
            return .success(Erfassung(art: .notiz, text: roh.trimmingCharacters(in: .whitespacesAndNewlines), vault: ziel))
        case .aufgabe:
            let k = entwurf
            var titel = k.titel
            var rest = k.text
            guard !titel.isEmpty else { return .failure(ErfassenFehler("Die Aufgabe braucht einen Titel.")) }
            if titel.count > Self.hoechstTitel {
                // Ein langer Gedanke wird nicht abgeschnitten: Der Titel wird gekürzt, die ganze Zeile steht im Text der Aufgabe.
                rest = rest.isEmpty ? titel : titel + "\n\n" + rest
                titel = Self.kuerze(titel)
            }
            return .success(Erfassung(art: .aufgabe, titel: titel, text: rest, prioritaet: wirksamePrioritaet, faellig: wirksameFaelligkeit, vault: ziel))
        }
    }

    static let hoechstTitel = 120

    static func kuerze(_ s: String) -> String {
        let ende = s.index(s.startIndex, offsetBy: hoechstTitel - 1)
        var kopf = String(s[..<ende])
        if let leer = kopf.lastIndex(of: " "), kopf.distance(from: kopf.startIndex, to: leer) > hoechstTitel / 2 { kopf = String(kopf[..<leer]) }
        return kopf.trimmingCharacters(in: .whitespaces) + "…"
    }

    /// Zeilentrenner von Unicode (U+2028/2029) werden zu gewöhnlichen Zeilenumbrüchen.
    func bereinigt(_ s: String) -> String {
        s.replacingOccurrences(of: "\u{2028}", with: "\n").replacingOccurrences(of: "\u{2029}", with: "\n")
    }
}
