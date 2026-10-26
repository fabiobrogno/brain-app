import Foundation

/// Antwort der Vertrauensprüfung (Studio-v2-Spec §8): Darf Code aus diesem Vault laufen? Sicherer Standard ist „nein“ —
/// nur die genaue Ausgabe `{"erlaubt":true}` bei Exit 0 ergibt `.erlaubt`; fehlende Prüfung, Zeitüberschreitung, Absturz und jede
/// andere Ausgabe sind ein „nein“ mit Grund (der Grund steht nur im Log, nie im Dialog).
public enum KitErlaubnis: Equatable, Sendable {
    case erlaubt
    case nein(Grund)

    public enum Grund: String, Equatable, Sendable {
        /// Die Prüfung sagt ausdrücklich `{"erlaubt":false}` (noch nicht freigegeben, Ordner ersetzt oder Code geändert).
        case nichtFreigegeben = "nicht-freigegeben"
        /// `vertrauen-pruefen.mjs` fehlt im App-Paket (oder ist nicht lesbar).
        case pruefungFehlt = "pruefung-fehlt"
        case startFehlgeschlagen = "start-fehlgeschlagen"
        case zeitueberschreitung = "zeitueberschreitung"
        /// Exit-Code ≠ 0 oder eine Ausgabe, die nicht genau `{"erlaubt":true}` bzw. `{"erlaubt":false}` ist.
        case unerwarteteAusgabe = "unerwartete-ausgabe"

        /// Nur `nichtFreigegeben` ist eine Antwort der Prüfung („der Nutzer vertraut diesem Vault nicht [mehr]“); alles andere
        /// ist ein technischer Fehler beim Prüfen selbst.
        public var istTechnisch: Bool { self != .nichtFreigegeben }
    }

    public var istErlaubt: Bool { self == .erlaubt }

    /// Ein „nein“ aus technischem Grund: Die Prüfung konnte nichts über das Vertrauen sagen (fehlt, Start, Zeit, unerwartete
    /// Ausgabe). Gestartet wird dann genauso nichts — aber es ist keine Antwort des Nutzers, und die Oberfläche darf nicht „bitte
    /// freigeben“ sagen (Review SW-5).
    public var istTechnischerFehler: Bool {
        if case .nein(let g) = self { return g.istTechnisch }
        return false
    }

    /// Kurztext für Logzeilen: `erlaubt` oder `nein <grund>`.
    public var logText: String {
        switch self {
        case .erlaubt: return "erlaubt"
        case .nein(let g): return "nein \(g.rawValue)"
        }
    }
}

/// Ergebnis von `KitVertrauen.status`: gesperrt (das Kit wurde nicht angefasst), der gelesene Status oder — erlaubt, aber
/// `brain status` ging schief (Zeitlimit, Absturz, unlesbare Ausgabe) — nur ein Fehlertext fürs Log.
public enum KitAbruf: Equatable, Sendable {
    case gesperrt(KitErlaubnis.Grund)
    case status(BrainStatus)
    case nichtAbrufbar(String)
}

/// Fragt vor jedem Start von Kit-Code (`brain.mjs status`, Kit-Brücke der Übersicht), ob der Nutzer dem Vault vertraut:
/// `<node> <App-Ressourcen>/werkstatt/vertrauen-pruefen.mjs <vault>` (gebündeltes Node, saubere Umgebung, `BRAIN_APP_SUPPORT`
/// wie bei der Werkstatt, höchstens 5 s). Die CLI liest denselben Merker (`<support>/vertrauen.json`) mit derselben Logik wie die
/// Werkstatt und startet nichts aus dem Vault; die Entscheidung liegt dort, Swift fragt nur.
public struct KitVertrauen: Sendable {
    public let node: URL
    public let pruefSkript: URL
    public let umgebung: [String: String]
    public let arbeitsordner: URL?
    /// Wie lange eine Prüfung höchstens dauern darf (Standard `zeitlimit`, 5 s). Die App nimmt immer den Standard; nur Tests geben
    /// mehr: Auf einem ausgelasteten Mac braucht schon der erste Start eines frisch geschriebenen Skripts mitunter Sekunden, und ein
    /// Test, der etwas anderes prüft, soll daran nicht scheitern.
    public let pruefZeitlimit: Duration

    public static let skriptName = "vertrauen-pruefen.mjs"
    public static let zeitlimit = Duration.seconds(5)
    /// Die einzige Ausgabe, die als Erlaubnis gilt.
    static let ausgabeErlaubt = #"{"erlaubt":true}"#
    static let ausgabeNichtErlaubt = #"{"erlaubt":false}"#

    public init(node: URL, pruefSkript: URL, umgebung: [String: String] = [:], arbeitsordner: URL? = nil,
                pruefZeitlimit: Duration = KitVertrauen.zeitlimit) {
        self.node = node
        self.pruefSkript = pruefSkript
        self.umgebung = umgebung
        self.arbeitsordner = arbeitsordner
        self.pruefZeitlimit = pruefZeitlimit
    }

    /// Die Prüfung liegt neben der Werkstatt: `<Ressourcen>/werkstatt/vertrauen-pruefen.mjs`.
    public static func pruefSkript(werkstatt: URL) -> URL {
        werkstatt.deletingLastPathComponent().appendingPathComponent(skriptName)
    }

    /// Ausgabe und Exit-Code → Erlaubnis. Nur Exit 0 mit genau `{"erlaubt":true}` (umgebende Leerzeichen/Zeilenenden egal) erlaubt.
    static func auswerten(code: Int32, ausgabe: String) -> KitErlaubnis {
        guard code == 0 else { return .nein(.unerwarteteAusgabe) }
        switch ausgabe.trimmingCharacters(in: .whitespacesAndNewlines) {
        case ausgabeErlaubt: return .erlaubt
        case ausgabeNichtErlaubt: return .nein(.nichtFreigegeben)
        default: return .nein(.unerwarteteAusgabe)
        }
    }

    /// Fragt die Prüfung für diesen Vault (frisch, ohne Zwischenspeicher). Wirft nie: jeder Fehler ist ein „nein“. `zeitlimit` nil =
    /// `pruefZeitlimit` (Standard 5 s).
    public func pruefe(vault: URL, zeitlimit: Duration? = nil) async -> KitErlaubnis {
        guard FileManager.default.isReadableFile(atPath: pruefSkript.path) else { return .nein(.pruefungFehlt) }
        // Ohne Vault in der Umgebung: der Vault ist nur das Argument, ein geerbtes BRAIN_VAULT soll hier nichts lenken.
        let env = NodeUmgebung.fuerKind(vault: nil, vorgaben: umgebung)
        do {
            let r = try await ProzessLauf.starte(node, [pruefSkript.path, vault.path], umgebung: env, ordner: arbeitsordner,
                                                 zeitlimit: zeitlimit ?? pruefZeitlimit)
            return Self.auswerten(code: r.code, ausgabe: r.ausgabe)
        } catch BefehlFehler.zeitUeberschritten {
            return .nein(.zeitueberschreitung)
        } catch {
            return .nein(.startFehlgeschlagen)
        }
    }

    /// `brain status --json` des Kits — nur, wenn die Prüfung unmittelbar vorher `{"erlaubt":true}` geliefert hat; sonst wird
    /// `brain.mjs` nicht gestartet (`.gesperrt`). Prüfung und Start gehören zusammen, damit kein alter Befund gilt. Wirft nie.
    public func status(_ befehl: BrainBefehl, zeitlimit: Duration = .seconds(20)) async -> KitAbruf {
        switch await pruefe(vault: befehl.vault) {
        case .nein(let grund):
            return .gesperrt(grund)
        case .erlaubt:
            do { return .status(try await befehl.status(zeitlimit: zeitlimit)) } catch { return .nichtAbrufbar("\(error)") }
        }
    }
}
