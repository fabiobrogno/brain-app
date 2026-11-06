import Foundation

/// Womit der Einrichtungs-Assistent endet (Aktion `einrichtung-ende`, Wert `{art}`): „Fertig“ oder „Später“.
public enum EinrichtungsEnde: String, Sendable, CaseIterable {
    case fertig
    case spaeter
}

/// Wo der Assistent einsteigt (Aktion `einrichtung-oeffnen`, Wert `{ab}`; Query `?ab=` der Seite).
public enum EinrichtungsEinstieg: String, Sendable, CaseIterable {
    case vault
    case sicherung
    case ki
}

/// Womit die Einrichtung beginnt, wenn sie aus dem leeren Zustand kommt („Neuer Vault“, „Ordner öffnen“): das Willkommen entfällt. Fester Satz an Namen (die Seite kennt dieselben).
public enum EinrichtungsWeg: String, Sendable, CaseIterable {
    case neu
    case beispiel
    case oeffnen
    case klonen
}

/// Was beim Start geschieht (App-Spec §9.1, Ein-Fenster-Plan 4.1): Es gibt immer GENAU EIN Hauptfenster, das Studio. Die Einrichtung ist ein Overlay darin
/// (`#einrichtung-host`), nie ein zweites Fenster; „erscheint von selbst“ heißt nur, dass das Studio nach dem Öffnen den Befehl `einrichtung` bekommt.
public enum EinrichtungsStart: Equatable, Sendable {
    /// Nur das Studio (Testläufe, `--vault`, fertig oder „Später“ gewählt).
    case studio
    /// Das Studio, und sobald es bereit ist, das Overlay „Kortex einrichten“.
    case studioMitEinrichtung

    /// `darfErscheinen`: `StartArgumente.assistentDarfErscheinen` · `sollErscheinen`: `EinrichtungsSpeicher.sollErscheinen(hatVault:)`.
    public static func entscheide(darfErscheinen: Bool, sollErscheinen: Bool) -> EinrichtungsStart {
        darfErscheinen && sollErscheinen ? .studioMitEinrichtung : .studio
    }
}

/// Die Einrichtung „Kortex einrichten“ als Overlay im Studio. Hier stehen nur die reinen Teile (Stand der Datei, wer was darf); die Seite selbst ist `Ressourcen/studio/einrichtung.js`.
public enum EinrichtungsOverlay {
    /// Der Stand von `einrichtung.json` nach dem Ende. `ende` nil = Overlay zu, ohne eine Wahl zu treffen: außer `herkunft` ändert sich
    /// nichts (kein „Später“, damit der Assistent beim nächsten Start weitermacht) — außer es gibt einen aktiven Vault (`vaultAktiv`):
    /// dann gilt das Nötige als eingerichtet (`abgeschlossen`), wie bisher beim Assistenten (Vault da = eingerichtet; Sicherung und KI sind freiwillig).
    /// - fertig: `abgeschlossen`, `automatischAus` aus.
    /// - spaeter: `automatischAus` an; `abgeschlossen` bleibt, wie es war.
    public static func datei(nach ende: EinrichtungsEnde?, vorher: EinrichtungsDatei?, herkunft: EinrichtungsHerkunft, vaultAktiv: Bool = false) -> EinrichtungsDatei {
        var d = vorher ?? EinrichtungsDatei()
        d.herkunft = herkunft
        switch ende {
        case .fertig?: d.abgeschlossen = true; d.automatischAus = false
        case .spaeter?: d.automatischAus = true
        case nil: if vaultAktiv { d.abgeschlossen = true }
        }
        return d
    }

    /// Diese Aktionen der Seite gelten nur, solange das Overlay offen ist (`EinrichtungsSitzung.offen`): git prüfen/installieren, Zwischenablage, Ende (das übrige Studio braucht sie nicht).
    public static func nurAusEinrichtung(_ aktion: AppAktion) -> Bool {
        switch aktion {
        case .gitPruefen, .gitInstallieren, .kopieren, .einrichtungEnde: return true
        default: return false
        }
    }

    /// Bei offenem Overlay öffnet `extern` nur die Adressen der Anmeldung: GitHub (Gerätecode) und die Anmeldeseiten von Claude (claude.ai, claude.com, anthropic.com)
    /// und Codex (openai.com, chatgpt.com) samt Unterdomänen — alles https, ohne Zugangsdaten und Port. Die Adresse kommt aus der Werkstatt
    /// (`gemeinsam/anmeldung.mjs` prüft dieselben Hosts), nie ungeprüft.
    public static func externErlaubt(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "https", let host = url.host?.lowercased() else { return false }
        if url.user != nil || url.password != nil || url.port != nil { return false }
        if host == "github.com" || host == "www.github.com" { return true }
        return anmeldeDomaenen.contains { host == $0 || host.hasSuffix("." + $0) }
    }

    /// Domänen der Anmeldung bei KI-Programmen (E3, Anmelden im Fenster); Gegenstück: `HOSTS` in `Ressourcen/gemeinsam/anmeldung.mjs`.
    static let anmeldeDomaenen = ["claude.ai", "claude.com", "anthropic.com", "openai.com", "chatgpt.com"]
}

/// Antwortformen der Aktionen `git-pruefen` und `git-installieren` (Wörterbücher für die Seite).
public enum GitAntwort {
    /// Name des Stands für die Seite: `vorhanden | fehlt | installiert | defekt | nicht-pruefbar`.
    public static func name(_ stand: GitStand) -> String {
        switch stand {
        case .vorhanden: return "vorhanden"
        case .fehlt: return "fehlt"
        case .installiertGerade: return "installiert"
        case .defekt: return "defekt"
        case .nichtPruefbar: return "nicht-pruefbar"
        }
    }

    /// `git-pruefen`: `{stand, version?, meldung?}` — `version` nur bei `vorhanden` (und nicht leer), `meldung` nur bei `defekt`
    /// und `nicht-pruefbar` (und nicht leer).
    public static func pruefen(_ stand: GitStand) -> [String: Any] {
        var a: [String: Any] = ["stand": name(stand)]
        switch stand {
        case .vorhanden(_, let version): if !version.isEmpty { a["version"] = version }
        case .defekt(let m), .nichtPruefbar(let m): if let t = meldungstext(m) { a["meldung"] = t }
        case .fehlt, .installiertGerade: break
        }
        return a
    }

    /// `git-installieren`: `{ok, stand, meldung?}` — Dialog ausgelöst: ok, „installiert“; schon da: ok, „vorhanden“;
    /// fehlgeschlagen: nicht ok, Stand „fehlt“ und die Meldung.
    public static func installieren(_ start: GitInstallationStart) -> [String: Any] {
        switch start {
        case .dialogAusgeloest: return ["ok": true, "stand": "installiert"]
        case .schonInstalliert: return ["ok": true, "stand": "vorhanden"]
        case .fehlgeschlagen(let m):
            var a: [String: Any] = ["ok": false, "stand": "fehlt"]
            if let t = meldungstext(m) { a["meldung"] = t }
            return a
        }
    }

    /// Meldungen kommen von git bzw. xcode-select: ohne Ränder, höchstens 400 Zeichen; leer = keine Meldung.
    static func meldungstext(_ m: String) -> String? {
        let t = String(m.trimmingCharacters(in: .whitespacesAndNewlines).prefix(400))
        return t.isEmpty ? nil : t
    }
}

/// Buch über die laufende Einrichtung (ein Wert in `AppZustand`): ist das Overlay offen, woher kam der Lauf, welcher Vault war vorher aktiv, wie endete es.
/// Die Rechte der Aktionen hängen daran, nicht mehr an einem Fenster: nur bei offenem Overlay gelten `git-pruefen`, `git-installieren`, `kopieren` und `einrichtung-ende`,
/// und `extern` öffnet dann nur GitHub. Die App setzt `offen`, wenn sie das Overlay anfordert (Befehl `einrichtung`), und nimmt es mit dem Ende zurück.
public struct EinrichtungsSitzung: Equatable, Sendable {
    public private(set) var offen = false
    public private(set) var herkunft = EinrichtungsHerkunft.start
    public private(set) var vaultVorher: URL?

    public init() {}

    /// Beginnt einen Lauf. false = es läuft schon einer (dann kommt das Overlay nur nach vorn; Herkunft und Vault-vorher bleiben).
    @discardableResult
    public mutating func oeffne(automatisch: Bool, vaultVorher: URL?) -> Bool {
        guard !offen else { return false }
        offen = true
        herkunft = automatisch ? .start : .menue
        self.vaultVorher = vaultVorher
        return true
    }

    /// Beendet den Lauf (`einrichtung-ende`, Studio zu, App beendet). nil = es lief keiner.
    public mutating func beende() -> (herkunft: EinrichtungsHerkunft, vaultVorher: URL?)? {
        guard offen else { return nil }
        offen = false
        let r = (herkunft, vaultVorher)
        vaultVorher = nil
        return r
    }

    /// Darf diese Aktion jetzt ausgeführt werden? Aktionen, die nur zur Einrichtung gehören, nur bei offenem Overlay; alles andere immer (die Prüfung der Werte liegt in `AppAktion`).
    public func erlaubt(_ aktion: AppAktion) -> Bool {
        EinrichtungsOverlay.nurAusEinrichtung(aktion) ? offen : true
    }

    /// Darf `extern` diese Adresse öffnen? Bei offenem Overlay nur GitHub (Gerätecode), sonst gilt die Prüfung des Studios selbst.
    public func externErlaubt(_ url: URL) -> Bool {
        offen ? EinrichtungsOverlay.externErlaubt(url) : true
    }
}

/// Hinweise der App beim Start (Ordner „Brain“ umbenannt, Laufzeit unvollständig …) als Banner im Studio statt eines Systemdialogs: `window.studio.hinweis({titel, text})`.
/// Der Text kommt als JSON (nie in einen JavaScript-Text eingebaut), kann also nicht aus dem Aufruf ausbrechen.
public enum StudioHinweis {
    public static func skript(titel: String, text: String) -> String {
        let daten = try? JSONSerialization.data(withJSONObject: ["titel": titel, "text": text], options: [.sortedKeys])
        let json = daten.flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        return "window.studio?.hinweis(\(json))"
    }
}
