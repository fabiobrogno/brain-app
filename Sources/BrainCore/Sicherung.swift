import Foundation

// Schritt „Sicherung“ (FBL-88): das Brain mit einem PRIVATEN GitHub-Repository verbinden. Hier liegen die reinen Bausteine ohne Netz und
// ohne Prozesse (Datentypen, Namensregeln); der Ablauf steht in `EinrichtungsAblauf`, die Aufrufe an GitHub in der Werkstatt
// (`gemeinsam/github.mjs`) — die App sieht nie ein Token.

/// Ein eigenes, privates Repository bei GitHub, so wie die Werkstatt es liefert (nur private kommen überhaupt an).
public struct GitHubRepo: Equatable, Sendable, Identifiable {
    public let name: String
    public let besitzer: String
    /// `https://github.com/<besitzer>/<name>.git` — ohne Zugangsdaten; die Anmeldung beim Senden macht der Schlüsselbund.
    public let url: String
    /// ISO-Zeitpunkt des letzten Pushs (oder der letzten Änderung), falls bekannt.
    public let aktualisiert: String?
    /// GitHub meldet Größe 0: das Repository ist (wahrscheinlich) leer.
    public let leer: Bool

    public var id: String { url }
    public var vollerName: String { "\(besitzer)/\(name)" }

    public init(name: String, besitzer: String, url: String, aktualisiert: String? = nil, leer: Bool = false) {
        self.name = name
        self.besitzer = besitzer
        self.url = url
        self.aktualisiert = aktualisiert
        self.leer = leer
    }
}

public struct GitHubRepoListe: Equatable, Sendable {
    public let repos: [GitHubRepo]
    /// Die Liste war sehr lang und wurde nach 1000 Einträgen abgeschnitten.
    public let gekuerzt: Bool

    public init(repos: [GitHubRepo], gekuerzt: Bool = false) {
        self.repos = repos
        self.gekuerzt = gekuerzt
    }
}

/// Was beim Verbinden mit dem Repository passiert ist (`POST /api/git/remote`).
public enum SicherungErgebnis: String, Equatable, Sendable {
    /// Alles Lokale liegt jetzt im Repository (erster Push).
    case gesendet
    /// Das Repository war schon auf dem Stand des Brains (oder der Vault hat noch keine Version): nur verbunden.
    case verbunden
    /// Das Repository war weiter als das Brain: der Stand wurde vorgespult (nichts überschrieben).
    case geholt
}

/// Ergebnis der Vorprüfung (`GET /api/sicherung/bereit`), BEVOR bei GitHub etwas angelegt wird.
public enum SicherungVorpruefung: Equatable, Sendable {
    /// Remote und Upstream sind da: nichts zu tun.
    case gesichert
    /// Das Brain lässt sich verbinden.
    case bereit
    /// Es geht gerade nicht (Git gesperrt, losgelöster Kopf, keine Version, Status nicht lesbar …): ein Satz für den Nutzer.
    case blockiert(String)

    var blockiertText: String? {
        if case .blockiert(let t) = self { return t }
        return nil
    }
}

/// Namensregeln für Repositories bei GitHub und der Vorschlag aus dem Vault-Namen.
public enum RepoName {
    /// Aus dem Namen des Brains: klein, Umlaute ausgeschrieben, alles Unerlaubte wird zu „-“. Leer → „brain“.
    public static func vorschlag(ausVaultName name: String) -> String {
        var s = name.lowercased()
        for (von, nach) in [("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")] { s = s.replacingOccurrences(of: von, with: nach) }
        // übrige Akzente („é“ → „e“); danach zählt nur noch ASCII
        s = s.folding(options: .diacriticInsensitive, locale: Locale(identifier: "en_US_POSIX"))
        var aus = ""
        for z in s.unicodeScalars {
            let ok = (z.value >= 97 && z.value <= 122) || (z.value >= 48 && z.value <= 57) || z == "." || z == "_" || z == "-"
            let zeichen: Character = ok ? Character(z) : "-"
            if zeichen == "-", aus.last == "-" { continue }
            aus.append(zeichen)
        }
        let rand = CharacterSet(charactersIn: "-.")
        aus = aus.trimmingCharacters(in: rand)
        if aus.hasSuffix(".git") { aus = String(aus.dropLast(4)).trimmingCharacters(in: rand) }
        if aus.count > 100 { aus = String(aus.prefix(100)).trimmingCharacters(in: rand) }
        return aus.isEmpty || aus.hasSuffix(".git") ? "brain" : aus
    }

    /// nil = gültig; sonst ein Satz für den Nutzer. Gleiche Regeln wie `repoNameFehler` in der Werkstatt (die prüft noch einmal).
    public static func fehler(_ roh: String) -> String? {
        let name = roh.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty { return "Bitte gib einen Namen für das Repository ein." }
        if name.count > 100 { return "Der Name ist zu lang (höchstens 100 Zeichen)." }
        let erlaubt = name.unicodeScalars.allSatisfy {
            ($0.value >= 97 && $0.value <= 122) || ($0.value >= 65 && $0.value <= 90) || ($0.value >= 48 && $0.value <= 57) || $0 == "." || $0 == "_" || $0 == "-"
        }
        if !erlaubt { return "Im Namen sind nur Buchstaben ohne Umlaute, Ziffern, Bindestrich, Unterstrich und Punkt erlaubt (keine Leerzeichen)." }
        if name == "." || name == ".." || name.lowercased().hasSuffix(".git") { return "Dieser Name ist bei GitHub nicht erlaubt." }
        return nil
    }
}
