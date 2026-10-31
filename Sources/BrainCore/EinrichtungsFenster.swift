import Foundation
import CoreGraphics

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

/// Das Fenster „Kortex einrichten“: eine Web-Seite der Werkstatt (`brain://studio/einrichtung.html`, Host `studio`) in einem eigenen,
/// festen Fenster. Hier stehen nur die reinen Teile (Adresse, Größe, Stand der Datei); das Fenster selbst baut `FensterSteuerung` (BrainApp).
public enum EinrichtungsFenster {
    /// Pfad der Seite in der Werkstatt (`Ressourcen/studio/einrichtung.html`).
    public static let pfad = "/einrichtung.html"
    /// Inhaltsgröße des Fensters (wie CSS `min(1120px, 100vw - 48px)` x 720); der Rand zum sichtbaren Bildschirm je Achse.
    public static let wunschgroesse = CGSize(width: 1120, height: 720)
    public static let bildschirmRand: CGFloat = 48
    /// Kleiner wird das Fenster nie, auch auf einem winzigen Bildschirm nicht.
    public static let minimum = CGSize(width: 560, height: 420)
    /// Durchsichtiger Zieh-Streifen über der WebView (sie schluckt Klicks in der Titelleiste): Höhe, und ab wo (links bleibt die Ampel
    /// frei) bis zum rechten Rand.
    public static let ziehStreifenHoehe: CGFloat = 40
    public static let ziehStreifenAb: CGFloat = 84

    /// Inhaltsgröße für einen sichtbaren Bildschirm der Größe `sichtbar`: 1120 x 720, aber höchstens die sichtbare Fläche minus 48
    /// je Achse, und nie unter `minimum`.
    public static func groesse(sichtbar: CGSize) -> CGSize {
        CGSize(width: max(minimum.width, min(wunschgroesse.width, sichtbar.width - bildschirmRand)),
               height: max(minimum.height, min(wunschgroesse.height, sichtbar.height - bildschirmRand)))
    }

    /// Adresse der Seite; `ab` hängt `?ab=<vault|sicherung|ki>` an (die Seite liest `location.search`), sonst keine Query.
    public static func url(ab: EinrichtungsEinstieg? = nil) -> URL {
        var k = URLComponents()
        k.scheme = NavigationsRegel.schema
        k.host = Oberflaeche.studio.host
        k.path = pfad
        if let ab { k.queryItems = [URLQueryItem(name: "ab", value: ab.rawValue)] }
        return k.url!
    }

    /// Ist das die Seite des Assistenten (egal mit welcher Query)? Für die Fehlerseite statt eines leeren Fensters.
    public static func istSeite(_ url: URL) -> Bool { url.path == pfad }

    /// Der Stand von `einrichtung.json` nach dem Ende. `ende` nil = Fenster zu, ohne eine Wahl zu treffen: außer `herkunft` ändert sich
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

    /// Diese Aktionen der Seite gelten nur aus dem Einrichtungsfenster: git prüfen/installieren, Zwischenablage, Ende (die Studio-Seite braucht sie nicht).
    public static func nurAusEinrichtung(_ aktion: AppAktion) -> Bool {
        switch aktion {
        case .gitPruefen, .gitInstallieren, .kopieren, .einrichtungEnde: return true
        default: return false
        }
    }

    /// Aus dem Einrichtungsfenster öffnet `extern` nur GitHub (die Adresse des Gerätecodes kommt aus der Werkstatt, nie ungeprüft): https und Host `github.com`.
    public static func externErlaubt(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "https", let host = url.host?.lowercased() else { return false }
        return host == "github.com" || host == "www.github.com"
    }
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
