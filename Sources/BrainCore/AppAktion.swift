import Foundation

/// Aktionen der Oberfläche an die App (Nachrichtenkanal `aktion`, mit Antwort an die Seite, aber kein Datenweg). Die Prüfung
/// hier ist die einzige Stelle, die Werte der Seite in etwas Ausführbares verwandelt: nur bekannte Aktionen, Pfade nur im Vault,
/// nur https. `ordner-waehlen`, `vault-gewechselt`, `vertrauen-geaendert`, `status-auffrischen`, `titel`, `fehler` und die Aktionen des
/// Einrichtungs-Assistenten (`git-pruefen`, `git-installieren`, `kopieren`, `einrichtung-ende`, `einrichtung-oeffnen`) gelten nur für
/// das Studio (Host `studio`, auch das Fenster „Kortex einrichten“) — die Übersicht (Seite des Kerns) darf nur `ansicht`, `ordner-zeigen`
/// und `extern`.
public enum AppAktion: Equatable, Sendable {
    case ansicht
    case ordnerZeigen(URL)
    case extern(URL)
    /// Ordner-Dialog (nur Ordner, „Neuer Ordner“ erlaubt) als Sheet am Studio; Antwort `{pfad}` oder `null`.
    case ordnerWaehlen(titel: String?, vorschlag: URL?)
    /// Das Backend hat den aktiven Vault gewechselt (steht in vaults.json): Menüleiste auffrischen, Übersicht schließen.
    case vaultGewechselt
    /// Das Backend hat das Vertrauen in den Vault geändert (`POST /api/vertrauen`, Workspace-Trust): Der Kern arbeitet in einem nicht
    /// vertrauten Vault ohne git (Menüleiste und Übersicht zeigen dann andere Werte), darum liest die App den Status neu. Nur das Studio
    /// darf das melden — die Übersicht (Seite des Kerns) soll keine Status-Läufe anstoßen können.
    case vertrauenGeaendert
    /// Das Studio hat über die Live-Aktualisierung gemerkt, dass sich im Vault etwas geändert hat (Aufgaben, Notizen, Posteingang, Git): die App liest
    /// den Status für die Menüleiste neu — gebündelt und gedrosselt (`StatusAuffrischung`). Trägt keine Daten; nur das Studio darf das melden.
    case statusAuffrischen
    /// Fenstertitel des Studios (nil = Standardtitel).
    case titel(String?)
    /// JavaScript-Fehler der Studio-Oberfläche (Fehlerhaken, `fehlerhaken.js`): nur fürs App-Log, kein Datenweg.
    /// `ort` = Datei:Zeile:Spalte ohne Query und ohne Leerzeichen, `text` einzeilig und gekürzt.
    case fehler(text: String, ort: String)
    /// Einrichtungs-Assistent: Stand von git prüfen (löst nie einen Dialog aus); Antwort `GitAntwort.pruefen`.
    case gitPruefen
    /// Einrichtungs-Assistent: Apples Installationsdialog für die Befehlszeilenwerkzeuge auslösen; Antwort `GitAntwort.installieren`.
    case gitInstallieren
    /// Text in die Zwischenablage (Gerätecode, Konfigurationsbefehl): einzeilig, druckbar, 1…`maxKopieren` Zeichen.
    case kopieren(String)
    /// Der Assistent ist am Ende („Fertig“ oder „Später“); nur wirksam, wenn das Einrichtungsfenster offen ist und die Aktion von dort kommt.
    case einrichtungEnde(EinrichtungsEnde)
    /// Das Einrichtungsfenster öffnen (wie das Menü „Kortex einrichten …“), optional ab einer Stelle.
    case einrichtungOeffnen(ab: EinrichtungsEinstieg?)

    /// Längen- und Zeichenbegrenzung für Texte der Seite (Fenstertitel, Dialog-Hinweis).
    static let maxTitel = 120
    static let maxHinweis = 200
    static let maxFehlertext = 300
    static let maxFehlerort = 120
    /// Längster Text für `kopieren` (Gerätecode, Konfigurationsbefehl).
    public static let maxKopieren = 400
    /// So viele `fehler`-Meldungen schreibt die App je Fensterleben ins Protokoll (wie `MAX_MELDUNGEN` in `fehlerhaken.js`), danach
    /// einmal „js-fehler gedrosselt“ und der Rest wird verworfen (`MeldungsDrossel`, Review SW-7).
    public static let maxFehlerJeFenster = 20

    /// `{aktion:"ansicht"}`, `{aktion:"ordner-zeigen", wert:<rel. Pfad>}`, `{aktion:"extern", wert:<https-URL>}`,
    /// `{aktion:"ordner-waehlen", wert:{titel?, vorschlag?}}`, `{aktion:"vault-gewechselt"}`, `{aktion:"vertrauen-geaendert"}`,
    /// `{aktion:"titel", wert:<Text>}`, `{aktion:"fehler", wert:{text, ort?}}`, `{aktion:"git-pruefen"}`, `{aktion:"git-installieren"}`,
    /// `{aktion:"kopieren", wert:<Text>}`, `{aktion:"einrichtung-ende", wert:{art:"fertig"|"spaeter"}}`,
    /// `{aktion:"einrichtung-oeffnen", wert?:{ab?:"vault"|"sicherung"|"ki"}}`.
    /// Ohne Angabe gilt die strengste Herkunft (Übersicht): die Studio-Aktionen muss man ausdrücklich freischalten.
    public static func pruefe(_ nachricht: Any, vault: URL?, oberflaeche: Oberflaeche = .app) -> AppAktion? {
        guard let d = nachricht as? [String: Any], let name = d["aktion"] as? String else { return nil }
        let wert = d["wert"]
        switch name {
        case "ansicht":
            return .ansicht
        case "ordner-zeigen":
            guard let vault, let relativ = wert as? String else { return nil }
            return ortImVault(relativ, vault: vault).map { .ordnerZeigen($0) }
        case "extern":
            guard let w = wert as? String, let u = URL(string: w), u.scheme?.lowercased() == "https",
                  let h = u.host, !h.isEmpty else { return nil }
            return .extern(u)
        case "ordner-waehlen":
            return oberflaeche == .studio ? pruefeOrdnerWaehlen(wert) : nil
        case "vault-gewechselt":
            return oberflaeche == .studio ? .vaultGewechselt : nil
        case "vertrauen-geaendert":
            return oberflaeche == .studio ? .vertrauenGeaendert : nil
        case "status-auffrischen":
            return oberflaeche == .studio ? .statusAuffrischen : nil
        case "titel":
            return oberflaeche == .studio ? pruefeTitel(wert) : nil
        case "fehler":
            return oberflaeche == .studio ? pruefeFehler(wert) : nil
        case "git-pruefen":
            return oberflaeche == .studio ? .gitPruefen : nil
        case "git-installieren":
            return oberflaeche == .studio ? .gitInstallieren : nil
        case "kopieren":
            return oberflaeche == .studio ? pruefeKopieren(wert) : nil
        case "einrichtung-ende":
            return oberflaeche == .studio ? pruefeEinrichtungEnde(wert) : nil
        case "einrichtung-oeffnen":
            return oberflaeche == .studio ? pruefeEinrichtungOeffnen(wert) : nil
        default:
            return nil
        }
    }

    /// `wert` fehlt/null → Standard; sonst ein Objekt. Unbrauchbare Einzelwerte (kein Text, kein absoluter Pfad) werden
    /// ignoriert — sie ändern nur den Startort bzw. den Hinweis des Dialogs, nie etwas im Dateisystem.
    private static func pruefeOrdnerWaehlen(_ wert: Any?) -> AppAktion? {
        guard let wert, !(wert is NSNull) else { return .ordnerWaehlen(titel: nil, vorschlag: nil) }
        guard let d = wert as? [String: Any] else { return nil }
        let titel = (d["titel"] as? String).flatMap { einzeilig($0, max: maxHinweis) }
        let vorschlag = (d["vorschlag"] as? String).flatMap { absoluterOrdner($0) }
        return .ordnerWaehlen(titel: titel, vorschlag: vorschlag)
    }

    /// (Nicht `titel` nennen: ein gleichnamiger statischer Helfer verdeckt den Enum-Fall und `.titel(nil)` riefe sich selbst auf.)
    private static func pruefeTitel(_ wert: Any?) -> AppAktion? {
        guard let wert, !(wert is NSNull) else { return .titel(nil) }
        guard let s = wert as? String else { return nil }
        return .titel(einzeilig(s, max: maxTitel))
    }

    /// `wert` = Objekt mit `text` (Pflicht, sonst verworfen) und `ort` (fehlt oder unbrauchbar → „unbekannt“). Nur Text, der in
    /// eine Logzeile kommt: einzeilig und gekürzt, der Ort ohne Leerzeichen und ohne Query/Fragment (Notiztitel gehören nicht ins Protokoll).
    private static func pruefeFehler(_ wert: Any?) -> AppAktion? {
        guard let d = wert as? [String: Any], let text = d["text"] as? String else { return nil }
        let ort = (d["ort"] as? String).flatMap { fehlerort($0) } ?? "unbekannt"
        return .fehler(text: einzeilig(text, max: maxFehlertext) ?? "(ohne Text)", ort: ort)
    }

    /// Text für die Zwischenablage: 1…`maxKopieren` Zeichen, einzeilig und nur druckbar. Anders als bei Titeln wird nichts bereinigt,
    /// sondern abgelehnt (Steuer-, Format- und Zeilentrennzeichen, leer oder nur Leerraum, zu lang): in die Zwischenablage kommt genau
    /// das, was die Seite zeigt, oder nichts.
    private static func pruefeKopieren(_ wert: Any?) -> AppAktion? {
        guard let s = wert as? String, !s.isEmpty, s.count <= maxKopieren,
              !s.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        for u in s.unicodeScalars {
            switch u.properties.generalCategory {
            case .control, .format, .lineSeparator, .paragraphSeparator, .surrogate, .privateUse, .unassigned: return nil
            default: continue
            }
        }
        return .kopieren(s)
    }

    /// `wert` = Objekt mit `art` = `fertig` oder `spaeter` (Pflicht, nichts anderes).
    private static func pruefeEinrichtungEnde(_ wert: Any?) -> AppAktion? {
        guard let d = wert as? [String: Any], let art = d["art"] as? String, let ende = EinrichtungsEnde(rawValue: art) else { return nil }
        return .einrichtungEnde(ende)
    }

    /// `wert` fehlt/null/leeres Objekt → ohne Einstieg; `ab` muss, wenn es da ist, einer der drei Einstiege sein, sonst wird abgelehnt.
    private static func pruefeEinrichtungOeffnen(_ wert: Any?) -> AppAktion? {
        guard let wert, !(wert is NSNull) else { return .einrichtungOeffnen(ab: nil) }
        guard let d = wert as? [String: Any] else { return nil }
        guard let roh = d["ab"], !(roh is NSNull) else { return .einrichtungOeffnen(ab: nil) }
        guard let name = roh as? String, let ab = EinrichtungsEinstieg(rawValue: name) else { return nil }
        return .einrichtungOeffnen(ab: ab)
    }

    /// Ort einer Meldung für die Logzeile `js-fehler <ort> <text>`: der erste Teil bis zu einem Leerzeichen, `?` oder `#`.
    static func fehlerort(_ text: String) -> String? {
        guard let einzeiler = einzeilig(text, max: maxFehlerort) else { return nil }
        let ort = einzeiler.prefix { $0 != " " && $0 != "?" && $0 != "#" }
        return ort.isEmpty ? nil : String(ort)
    }

    /// Text für Fenster und Dialoge: Steuer-, Format- (u. a. Rechts-nach-links-Umschalter) und Zeilentrennzeichen entfallen
    /// bzw. werden zu Leerzeichen, Ränder weg, auf `max` Zeichen gekürzt. Leer → nil.
    static func einzeilig(_ text: String, max: Int) -> String? {
        var ergebnis = ""
        for s in text.unicodeScalars {
            switch s.properties.generalCategory {
            case .control, .lineSeparator, .paragraphSeparator: ergebnis.unicodeScalars.append(" ")
            case .format: continue
            default: ergebnis.unicodeScalars.append(s)
            }
        }
        let gekuerzt = String(ergebnis.trimmingCharacters(in: .whitespaces).prefix(max)).trimmingCharacters(in: .whitespaces)
        return gekuerzt.isEmpty ? nil : gekuerzt
    }

    /// Absoluter Ordnerpfad (auch `~` und `~/…`); nie relativ, nie mit NUL.
    static func absoluterOrdner(_ text: String, home: URL = FileManager.default.homeDirectoryForCurrentUser) -> URL? {
        var p = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if p == "~" { p = home.path } else if p.hasPrefix("~/") { p = home.path + String(p.dropFirst(1)) }
        guard p.hasPrefix("/"), !p.contains("\0") else { return nil }
        return URL(fileURLWithPath: p, isDirectory: true).standardizedFileURL
    }

    /// Startort für den Ordner-Dialog: der Vorschlag, sonst der tiefste vorhandene Ordner darüber (z. B. `~/Brain`, das noch
    /// nicht existiert → Home), sonst `fallback`.
    public static func startort(fuer vorschlag: URL?, fallback: URL) -> URL {
        guard var ordner = vorschlag?.standardizedFileURL else { return fallback }
        var istOrdner: ObjCBool = false
        while !(FileManager.default.fileExists(atPath: ordner.path, isDirectory: &istOrdner) && istOrdner.boolValue) {
            let darueber = ordner.deletingLastPathComponent()
            if darueber.path == ordner.path { return fallback }
            ordner = darueber
        }
        return ordner
    }

    /// Relativer Pfad → Datei im Vault. Kein absoluter Pfad, kein `..`, kein NUL; nach dem Auflösen von Symlinks
    /// muss das Ziel im (aufgelösten) Vault liegen.
    static func ortImVault(_ relativ: String, vault: URL) -> URL? {
        guard !relativ.isEmpty, !relativ.hasPrefix("/"), !relativ.contains("\0") else { return nil }
        let teile = relativ.split(separator: "/", omittingEmptySubsequences: true)
        guard !teile.isEmpty, !teile.contains("..") else { return nil }
        let wurzel = aufgeloest(vault)
        let ziel = aufgeloest(vault.appendingPathComponent(relativ))
        guard ziel.path.hasPrefix(wurzel.path + "/") else { return nil }
        return ziel
    }

    /// Symlinks auflösen, auch wenn die Datei selbst (noch) fehlt: der tiefste vorhandene Ordner wird aufgelöst,
    /// der Rest angehängt (`resolvingSymlinksInPath` allein löst nicht vorhandene Pfade nicht zuverlässig auf).
    static func aufgeloest(_ url: URL) -> URL {
        var vorhanden = url.standardizedFileURL
        var rest: [String] = []
        while !FileManager.default.fileExists(atPath: vorhanden.path), vorhanden.path != "/" {
            rest.insert(vorhanden.lastPathComponent, at: 0)
            vorhanden = vorhanden.deletingLastPathComponent()
        }
        var ergebnis = vorhanden.resolvingSymlinksInPath()
        for teil in rest { ergebnis.appendPathComponent(teil) }
        return ergebnis.standardizedFileURL
    }
}

/// Befehle der App-Menüs an die Studio-Oberfläche (`window.studio.befehl(name)`); nur diese Namen werden gesendet.
/// Die Namen (rawValue) sind der Vertrag mit der Oberfläche — nur Kleinbuchstaben und Bindestriche, damit sie nie
/// aus dem JavaScript-Text ausbrechen können.
public enum StudioBefehl: String, Sendable, CaseIterable {
    case neu, merken
    case vaultOeffnen = "vault-oeffnen"
    case vaultWechseln = "vault-wechseln"
    case infospalte, verlauf
    case hellDunkel = "hell-dunkel"
    case posteingang, alle, wissen, palette
    /// Menüleiste „Abgleichen“ (Neues holen, eigene Änderungen senden) und „Einstellungen …“ (⌘,): öffnet im Studio die Seite „Einstellungen“ (P5; früher das Zahnrad-Menü der Statusleiste,
    /// das es weiter gibt). Ein natives Einstellungsfenster gab es nie — die Seite im Studio ist der einzige Ort.
    case abgleichen = "sync"
    case einstellungen
    /// Menüleiste „Vault umstellen …“ (nur, wenn der Status Altlasten meldet): öffnet im Studio die Umstellungs-Ansicht (P7c).
    case umstellung
    /// Aufgaben-Board öffnen (Menü „Gehe zu“, Menüleiste bei offenen Aufgaben) und „Aufgabe erfassen …“ (Board mit Eingabefeld im Fokus).
    case aufgaben
    case aufgabeErfassen = "aufgabe-erfassen"

    public var skript: String { "window.studio?.befehl('\(rawValue)')" }

    /// Der Eintrag „Einstellungen …“ im Hauptmenü „Kortex“ und in der Menüleiste: Titel, Taste (⌘ plus diese Taste) und Befehl stehen hier an einer Stelle,
    /// damit beide Menüs und der Test dasselbe meinen.
    public static let einstellungenEintrag = StudioMenueEintrag(titel: "Einstellungen …", taste: ",", befehl: .einstellungen)
}

/// Ein Menüeintrag, der einen `StudioBefehl` auslöst (mit ⌘ als Umschalttaste, sonst keine).
public struct StudioMenueEintrag: Equatable, Sendable {
    public let titel: String
    public let taste: String
    public let befehl: StudioBefehl
}
