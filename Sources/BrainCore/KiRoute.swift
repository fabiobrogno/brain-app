import Foundation

/// Die Routen `/api/ki/…` an der Brücke des Studios: Programme suchen, Anmeldestatus abfragen, Anmeldung im Terminal öffnen. Sie
/// laufen in der App (Swift), nie in der Werkstatt — `behandle` liefert `nil` für alles andere, das geht dann an die Werkstatt.
///
/// - `GET /api/ki/programme` (`?neu=1` = neu suchen): `{"ok":true,"programme":[…],"gesucht":"…","ausShell":bool}`
/// - `POST /api/ki/anmeldestatus` `{programm, ordner|null}`: `{"zustand":"angemeldet|nicht-angemeldet|unbekannt","grund"?:…}`
/// - `POST /api/ki/anmelden` `{programm, ordner|null}`: `{"ok":true,"anzeige":"CLAUDE_CONFIG_DIR=~/… claude auth login"}`
/// - `POST /api/ki/ordner-papierkorb` `{programm, ordner}`: legt den Ordner eines von Kortex angelegten Kontos über `trashItem` in den Papierkorb (der Finder kann ihn „Zurücklegen“): `{"ok":true}`
/// Fehler: 4xx/5xx mit `{"fehler":"<deutscher Satz mit nächstem Schritt>"}`.
public struct KiRoute: Sendable {
    /// Größe des Bodys, die die Routen annehmen.
    public static let maxBody = 4096

    private let erkennung: KiErkennung
    private let support: URL
    private let home: URL
    private let basisUmgebung: [String: String]
    private let statusZeitlimit: Duration
    private let oeffner: @Sendable (URL) async -> Bool
    private let papierkorb: @Sendable (URL) async -> Bool
    private let anmeldeAbstand: Duration
    private let drossel = KiDrossel()

    /// `oeffner` öffnet das Skript im Terminal (App: Terminal.app per `NSWorkspace`); `true` = geöffnet.
    public init(erkennung: KiErkennung, support: URL, home: URL = FileManager.default.homeDirectoryForCurrentUser,
                basisUmgebung: [String: String] = ProcessInfo.processInfo.environment, statusZeitlimit: Duration = .seconds(10),
                anmeldeAbstand: Duration = .seconds(5),
                papierkorb: @escaping @Sendable (URL) async -> Bool = KiRoute.inDenPapierkorb,
                oeffner: @escaping @Sendable (URL) async -> Bool) {
        self.erkennung = erkennung
        self.support = support
        self.home = home
        self.basisUmgebung = basisUmgebung
        self.statusZeitlimit = statusZeitlimit
        self.oeffner = oeffner
        self.papierkorb = papierkorb
        self.anmeldeAbstand = anmeldeAbstand
    }

    /// Papierkorb des Nutzers über das System (Finder-„Zurücklegen“ geht); nur auf dem Mac.
    @Sendable public static func inDenPapierkorb(_ url: URL) async -> Bool {
        #if os(macOS)
        return (try? FileManager.default.trashItem(at: url, resultingItemURL: nil)) != nil
        #else
        return false
        #endif
    }

    /// `nil` = nicht meine Route (geht an die Werkstatt).
    public func behandle(methode: String, pfad: String, body: Data?) async -> BrueckenAntwort? {
        let teile = pfad.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
        let weg = String(teile.first ?? "")
        let abfrage = teile.count > 1 ? String(teile[1]) : ""
        let erwartet: String
        switch weg {
        case "/api/ki/programme": erwartet = "GET"
        case "/api/ki/anmeldestatus", "/api/ki/anmelden", "/api/ki/ordner-papierkorb": erwartet = "POST"
        default: return nil
        }
        guard methode.uppercased() == erwartet else {
            return Self.fehler(405, "Diese Anfrage ist hier nicht erlaubt. Lade die Seite neu und versuche es erneut.")
        }
        switch weg {
        case "/api/ki/programme":
            let neu = abfrage.split(separator: "&").contains("neu=1")
            var objekt = await erkennung.programme(neu: neu).jsonObjekt()
            objekt["ok"] = true
            return Self.json(200, objekt)
        case "/api/ki/anmeldestatus":
            return await anmeldestatus(body)
        case "/api/ki/ordner-papierkorb":
            return await ordnerInPapierkorb(body)
        default:
            return await anmelden(body)
        }
    }

    // MARK: Anfrage lesen

    private struct Auftrag { let programm: String; let ordner: KiKontoOrdner.Auswahl }
    private struct Abweisung: Error { let antwort: BrueckenAntwort }

    private func lese(_ body: Data?) -> Result<Auftrag, Abweisung> {
        guard let body, !body.isEmpty else { return .failure(Abweisung(antwort: Self.fehler(400, "Die Anfrage war leer. Lade die Seite neu und versuche es erneut."))) }
        guard body.count <= Self.maxBody else { return .failure(Abweisung(antwort: Self.fehler(413, "Die Anfrage war zu groß. Lade die Seite neu und versuche es erneut."))) }
        guard let obj = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any], let programm = obj["programm"] as? String else {
            return .failure(Abweisung(antwort: Self.fehler(400, "Die Anfrage war nicht lesbar. Lade die Seite neu und versuche es erneut.")))
        }
        guard KiKontoOrdner.programme.contains(programm) else {
            return .failure(Abweisung(antwort: Self.fehler(400, "Dieses Programm unterstützt Kortex hier nicht. Wähle Claude Code oder Codex.")))
        }
        var ordnerText: String?
        if let wert = obj["ordner"], !(wert is NSNull) {
            guard let text = wert as? String else {
                return .failure(Abweisung(antwort: Self.fehler(400, "Der Konto-Ordner war ungültig. Wähle einen Ordner aus der Liste.")))
            }
            ordnerText = text
        }
        guard let ordner = KiKontoOrdner.pruefe(programm: programm, ordner: ordnerText, home: home, support: support) else {
            return .failure(Abweisung(antwort: Self.fehler(400, "Dieser Konto-Ordner ist nicht erlaubt oder existiert nicht. Wähle einen Ordner aus der Liste oder lege ein Konto neu an.")))
        }
        return .success(Auftrag(programm: programm, ordner: ordner))
    }

    /// Der gefundene Eintrag des Programms; wurde noch nie gesucht, sucht `programme()` zuerst.
    private func fund(_ programm: String) async -> KiFund? {
        await erkennung.programme().programme.first { $0.id == programm && $0.quelle == "cli" }
    }

    private static func nichtGefunden(_ programm: String) -> BrueckenAntwort {
        fehler(409, "\(KiKonto.anzeigename(programm)) wurde nicht gefunden. Installiere es und klicke dann auf „Neu suchen“.")
    }

    // MARK: Routen

    private func anmeldestatus(_ body: Data?) async -> BrueckenAntwort {
        let auftrag: Auftrag
        switch lese(body) { case .failure(let a): return a.antwort; case .success(let a): auftrag = a }
        guard let fund = await fund(auftrag.programm) else { return Self.nichtGefunden(auftrag.programm) }
        let pfad = await erkennung.loginPfad().eintraege
        let status = await KiKonto.anmeldeStatus(programm: auftrag.programm, ordner: auftrag.ordner, fund: fund,
                                                 basisUmgebung: basisUmgebung, pfadEintraege: pfad, zeitlimit: statusZeitlimit)
        return Self.json(200, status.jsonObjekt())
    }

    /// Höchstens ein Terminal je `anmeldeAbstand` (ein Klickstau oder eine Seite, die sich verhaspelt, öffnet nicht Dutzende Fenster).
    private func anmelden(_ body: Data?) async -> BrueckenAntwort {
        let auftrag: Auftrag
        switch lese(body) { case .failure(let a): return a.antwort; case .success(let a): auftrag = a }
        guard let fund = await fund(auftrag.programm) else { return Self.nichtGefunden(auftrag.programm) }
        guard drossel.erlaube(abstand: anmeldeAbstand) else {
            return Self.fehler(429, "Das Terminal wurde gerade erst geöffnet. Warte einen Moment und klicke dann noch einmal auf „Anmelden …“.")
        }
        let skript: KiAnmeldeSkript
        do {
            skript = try KiAnmelden.vorbereiten(programm: auftrag.programm, ordner: auftrag.ordner, fund: fund, support: support, home: home)
        } catch let f as KiAktionFehler {
            return Self.fehler(500, f.meldung)
        } catch {
            return Self.fehler(500, "Die Anmeldung ließ sich nicht vorbereiten. Versuche es erneut.")
        }
        guard await oeffner(skript.url) else {
            try? FileManager.default.removeItem(at: skript.url.deletingLastPathComponent())
            return Self.fehler(500, "Das Terminal ließ sich nicht öffnen. Öffne es selbst und melde dich dort im Programm an.")
        }
        return Self.json(200, ["ok": true, "anzeige": skript.anzeige])
    }

    /// Nur ein von Kortex angelegter Konto-Ordner (nie das Standardkonto, nie `~/.claude-…`); die Prüfung ist dieselbe wie beim Anmelden plus „liegt direkt in ki-konten-ordner“.
    private func ordnerInPapierkorb(_ body: Data?) async -> BrueckenAntwort {
        guard let body, !body.isEmpty, body.count <= Self.maxBody,
              let obj = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any],
              let programm = obj["programm"] as? String, KiKontoOrdner.programme.contains(programm),
              let ordner = obj["ordner"] as? String,
              let url = KiKontoOrdner.pruefeVerwaltet(programm: programm, ordner: ordner, home: home, support: support) else {
            return Self.fehler(409, "Dieses Konto hat Kortex nicht angelegt. Kortex entfernt nur eigene Konten; dessen Ordner bleibt, wo er ist.")
        }
        guard await papierkorb(url) else {
            return Self.fehler(500, "Der Ordner ließ sich nicht in den Papierkorb legen. Lege ihn im Finder selbst in den Papierkorb und klicke dann auf „Neu suchen“.")
        }
        return Self.json(200, ["ok": true])
    }

    // MARK: Antworten

    private static func json(_ status: Int, _ objekt: [String: Any]) -> BrueckenAntwort {
        let daten = (try? JSONSerialization.data(withJSONObject: objekt, options: [.sortedKeys, .withoutEscapingSlashes])) ?? Data("{}".utf8)
        return BrueckenAntwort(status: status, headers: ["Content-Type": "application/json"], body: daten)
    }

    private static func fehler(_ status: Int, _ satz: String) -> BrueckenAntwort { json(status, ["fehler": satz]) }
}

/// Lässt eine Handlung höchstens einmal je Abstand zu (Anmelden im Terminal).
final class KiDrossel: @unchecked Sendable {
    private let sperre = NSLock()
    private var letzter: ContinuousClock.Instant?

    func erlaube(abstand: Duration) -> Bool {
        sperre.lock(); defer { sperre.unlock() }
        let jetzt = ContinuousClock.now
        if let l = letzter, jetzt - l < abstand { return false }
        letzter = jetzt
        return true
    }
}
