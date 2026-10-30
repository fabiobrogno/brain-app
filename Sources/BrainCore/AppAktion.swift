import Foundation

/// Aktionen der Oberfläche an die App (Nachrichtenkanal `aktion`, mit Antwort an die Seite, aber kein Datenweg). Die Prüfung
/// hier ist die einzige Stelle, die Werte der Seite in etwas Ausführbares verwandelt: nur bekannte Aktionen, Pfade nur im Vault,
/// nur https. `ordner-waehlen`, `vault-gewechselt`, `vertrauen-geaendert`, `titel` und `fehler` gelten nur für das Studio — die
/// Übersicht (Seite des Kerns) darf nur `ansicht`, `ordner-zeigen` und `extern`.
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
    /// Fenstertitel des Studios (nil = Standardtitel).
    case titel(String?)
    /// JavaScript-Fehler der Studio-Oberfläche (Fehlerhaken, `fehlerhaken.js`): nur fürs App-Log, kein Datenweg.
    /// `ort` = Datei:Zeile:Spalte ohne Query und ohne Leerzeichen, `text` einzeilig und gekürzt.
    case fehler(text: String, ort: String)

    /// Längen- und Zeichenbegrenzung für Texte der Seite (Fenstertitel, Dialog-Hinweis).
    static let maxTitel = 120
    static let maxHinweis = 200
    static let maxFehlertext = 300
    static let maxFehlerort = 120
    /// So viele `fehler`-Meldungen schreibt die App je Fensterleben ins Protokoll (wie `MAX_MELDUNGEN` in `fehlerhaken.js`), danach
    /// einmal „js-fehler gedrosselt“ und der Rest wird verworfen (`MeldungsDrossel`, Review SW-7).
    public static let maxFehlerJeFenster = 20

    /// `{aktion:"ansicht"}`, `{aktion:"ordner-zeigen", wert:<rel. Pfad>}`, `{aktion:"extern", wert:<https-URL>}`,
    /// `{aktion:"ordner-waehlen", wert:{titel?, vorschlag?}}`, `{aktion:"vault-gewechselt"}`, `{aktion:"vertrauen-geaendert"}`,
    /// `{aktion:"titel", wert:<Text>}`, `{aktion:"fehler", wert:{text, ort?}}`.
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
        case "titel":
            return oberflaeche == .studio ? pruefeTitel(wert) : nil
        case "fehler":
            return oberflaeche == .studio ? pruefeFehler(wert) : nil
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
    /// Menüleiste „Abgleichen“ (Neues holen, eigene Änderungen senden) und „Einstellungen“ (Darstellung, KI, Vertrauen) — wie der Knopf in der Statusleiste des Studios.
    case abgleichen = "sync"
    case einstellungen
    /// Menüleiste „Vault umstellen …“ (nur, wenn der Status Altlasten meldet): öffnet im Studio die Umstellungs-Ansicht (P7c).
    case umstellung
    /// Aufgaben-Board öffnen (Menü „Gehe zu“, Menüleiste bei offenen Aufgaben) und „Aufgabe erfassen …“ (Board mit Eingabefeld im Fokus).
    case aufgaben
    case aufgabeErfassen = "aufgabe-erfassen"

    public var skript: String { "window.studio?.befehl('\(rawValue)')" }
}
