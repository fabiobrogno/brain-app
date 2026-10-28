import Foundation

/// Wie es um git auf diesem Mac steht (App-Spec §9.1 Schritt 3, §10 „git fehlt / kaputt“). Die Einrichtung zeigt genau diese
/// Zustände; keiner davon ist ein stiller Fehler.
public enum GitStand: Equatable, Sendable {
    /// git ist da und antwortet. `pfad` ist das echte Programm, `version` z. B. `2.39.5 (Apple Git-154)`.
    case vorhanden(pfad: String, version: String)
    /// Keine Befehlszeilenwerkzeuge (Command Line Tools) und kein Xcode: `/usr/bin/git` ist nur Apples Stellvertreter, der beim
    /// Aufruf den Installationsdialog öffnet — er wird hier nie gestartet.
    case fehlt
    /// Der Installationsdialog von Apple wurde ausgelöst (oder läuft noch); git ist noch nicht fertig installiert.
    case installiertGerade
    /// Die Werkzeuge sind eingerichtet, aber git läuft nicht (z. B. Xcode-Lizenz nicht akzeptiert). `String` = Meldung von git.
    case defekt(String)
    /// Die Prüfung selbst ließ sich nicht ausführen (`xcode-select` startet nicht oder hängt). `String` = Grund.
    case nichtPruefbar(String)

    public var istVorhanden: Bool {
        if case .vorhanden = self { return true }
        return false
    }

    /// Kurztext für Logzeilen (ohne Meldungstexte von git, die Pfade enthalten können).
    public var logText: String {
        switch self {
        case .vorhanden(_, let v): return "vorhanden \(v)"
        case .fehlt: return "fehlt"
        case .installiertGerade: return "installiert-gerade"
        case .defekt: return "defekt"
        case .nichtPruefbar: return "nicht-pruefbar"
        }
    }
}

/// Ergebnis von `GitPruefer.starteInstallation`.
public enum GitInstallationStart: Equatable, Sendable {
    /// Apples Dialog „Befehlszeilenentwicklerwerkzeuge installieren“ wurde angefordert.
    case dialogAusgeloest
    /// Es gibt git schon (oder `xcode-select` meldet die Werkzeuge als installiert) — es wurde kein Dialog ausgelöst.
    case schonInstalliert
    /// `xcode-select --install` ging schief. `String` = Meldung, für die Anzeige gedacht.
    case fehlgeschlagen(String)
}

/// Startet ein Programm mit Argumenten und liefert Exit-Code und Ausgaben. Standard ist `ProzessLauf`; Tests setzen eigene Antworten ein.
public typealias GitProzess = @Sendable (_ programm: URL, _ argumente: [String]) async throws -> BefehlErgebnis

/// Prüft, ob git nutzbar ist, löst bei Bedarf Apples Installationsdialog aus und prüft neu. Rein lesend außer
/// `starteInstallation`. Wichtig: Auf einem Mac ohne Befehlszeilenwerkzeuge öffnet schon ein Aufruf von `/usr/bin/git` den
/// Installationsdialog. Deshalb wird git erst gestartet, nachdem `xcode-select -p` ein Entwicklerverzeichnis mit einem echten
/// `git` gezeigt hat — die Prüfung selbst löst nie einen Dialog aus.
public actor GitPruefer {
    static let xcodeSelect = URL(fileURLWithPath: "/usr/bin/xcode-select")
    /// Das git, das die Werkstatt aus dem PATH startet.
    static let systemGit = "/usr/bin/git"
    static let pgrep = URL(fileURLWithPath: "/usr/bin/pgrep")
    /// Prozessname der Installations-App von Apple (läuft, solange der Dialog offen ist oder installiert wird).
    static let installerName = "Install Command Line Developer Tools"

    private let starte: GitProzess
    private let istAusfuehrbar: @Sendable (String) -> Bool
    private let jetzt: @Sendable () -> Date
    private let anlaufzeit: TimeInterval
    private var angefordert: Date?

    /// - Parameters:
    ///   - anlaufzeit: So lange nach dem Auslösen gilt „installiert gerade“ auch dann, wenn der Installer-Prozess noch nicht
    ///     sichtbar ist (der Dialog braucht einen Moment).
    public init(starte: @escaping GitProzess = { try await ProzessLauf.starte($0, $1, zeitlimit: .seconds(10)) },
                istAusfuehrbar: @escaping @Sendable (String) -> Bool = { FileManager.default.isExecutableFile(atPath: $0) },
                jetzt: @escaping @Sendable () -> Date = { Date() },
                anlaufzeit: TimeInterval = 20) {
        self.starte = starte
        self.istAusfuehrbar = istAusfuehrbar
        self.jetzt = jetzt
        self.anlaufzeit = anlaufzeit
    }

    /// Der aktuelle Stand. Löst keinen Dialog aus.
    public func pruefe() async -> GitStand {
        let pfad: String?
        do { pfad = try await entwicklerverzeichnis() } catch {
            return .nichtPruefbar(Self.beschreibe(error))
        }
        if let pfad {
            // Erst wenn das Entwicklerverzeichnis ein echtes git enthält, löst `/usr/bin/git` keinen Dialog mehr aus. Gefragt wird dann
            // genau das Programm, das auch die Werkstatt startet: Bei Xcode.app ohne akzeptierte Lizenz läuft das echte git im
            // Entwicklerverzeichnis noch, `/usr/bin/git` aber nicht.
            if istAusfuehrbar(pfad + "/usr/bin/git") { return await frageVersion(Self.systemGit) }
        }
        return await installiertJetzt() ? .installiertGerade : .fehlt
    }

    /// Löst Apples Installationsdialog aus (`xcode-select --install`) — aber nur, wenn git wirklich fehlt. Danach meldet `pruefe()`
    /// `.installiertGerade`, bis git da ist oder der Dialog abgebrochen wurde.
    public func starteInstallation() async -> GitInstallationStart {
        switch await pruefe() {
        case .vorhanden: return .schonInstalliert
        case .installiertGerade: return .dialogAusgeloest // läuft schon: nicht noch einen Dialog öffnen
        case .defekt, .nichtPruefbar, .fehlt: break
        }
        let r: BefehlErgebnis
        do { r = try await starte(Self.xcodeSelect, ["--install"]) } catch {
            return .fehlgeschlagen("Der Installationsdialog von Apple ließ sich nicht öffnen: \(Self.beschreibe(error))")
        }
        let text = (r.fehler + "\n" + r.ausgabe).trimmingCharacters(in: .whitespacesAndNewlines)
        if r.code == 0 {
            angefordert = jetzt()
            return .dialogAusgeloest
        }
        if text.localizedCaseInsensitiveContains("already installed") { return .schonInstalliert }
        let erste = text.split(separator: "\n").first.map(String.init) ?? "Code \(r.code)"
        return .fehlgeschlagen("Der Installationsdialog von Apple ließ sich nicht öffnen: \(erste)")
    }

    /// Prüft in Abständen neu, solange die Installation läuft. Endet bei jedem anderen Stand sofort: `.vorhanden` (fertig),
    /// `.fehlt` (Dialog abgebrochen), `.defekt` oder `.nichtPruefbar`. Nach `hoechstens` Prüfungen oder wenn die Aufgabe
    /// abgebrochen wird, kommt der letzte Stand zurück (dann ggf. noch `.installiertGerade`).
    public func warteAufGit(alle abstand: Duration = .seconds(3), hoechstens: Int = 1200,
                            schlafe: @Sendable (Duration) async -> Void = { try? await Task.sleep(for: $0) }) async -> GitStand {
        var stand = await pruefe()
        var n = 1
        while stand == .installiertGerade, n < hoechstens, !Task.isCancelled {
            await schlafe(abstand)
            stand = await pruefe()
            n += 1
        }
        return stand
    }

    // MARK: Einzelschritte

    /// Pfad aus `xcode-select -p`, wenn es einen gibt und der Ordner existiert; sonst nil. Wirft nur, wenn der Aufruf selbst scheitert.
    private func entwicklerverzeichnis() async throws -> String? {
        let r = try await starte(Self.xcodeSelect, ["-p"])
        guard r.code == 0 else { return nil } // Exit 2: „kein Entwicklerverzeichnis gewählt“
        let zeile = r.ausgabe.split(separator: "\n").first.map { $0.trimmingCharacters(in: .whitespaces) } ?? ""
        return zeile.hasPrefix("/") ? zeile : nil
    }

    private func frageVersion(_ programm: String) async -> GitStand {
        let r: BefehlErgebnis
        do { r = try await starte(URL(fileURLWithPath: programm), ["--version"]) } catch {
            return .defekt("git antwortet nicht: \(Self.beschreibe(error))")
        }
        if r.code == 0, let version = Self.version(aus: r.ausgabe) { return .vorhanden(pfad: programm, version: version) }
        let text = r.fehler.isEmpty ? r.ausgabe : r.fehler
        if text.localizedCaseInsensitiveContains("license") {
            return .defekt("Die Xcode-Lizenz ist noch nicht akzeptiert. Öffne Xcode einmal und bestätige die Lizenz — oder führe im Terminal „sudo xcodebuild -license accept“ aus.")
        }
        let grund = text.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.first { !$0.isEmpty }
        return .defekt(grund ?? "git beendete sich mit Code \(r.code)")
    }

    /// Läuft der Installationsdialog oder die Installation? Entweder ist der Installer-Prozess sichtbar, oder das Auslösen ist
    /// erst kurz her. Ein Fehler beim Nachsehen zählt als „nein“ (dann steht dort `.fehlt` mit dem Knopf zum erneuten Auslösen).
    private func installiertJetzt() async -> Bool {
        if let r = try? await starte(Self.pgrep, ["-f", Self.installerName]), r.code == 0 { return true }
        if let a = angefordert, jetzt().timeIntervalSince(a) < anlaufzeit { return true }
        return false
    }

    // MARK: Auswertung

    /// `git version 2.39.5 (Apple Git-154)` → `2.39.5 (Apple Git-154)`; nil, wenn die Ausgabe nicht so beginnt.
    static func version(aus ausgabe: String) -> String? {
        guard let zeile = ausgabe.split(separator: "\n").first.map({ $0.trimmingCharacters(in: .whitespaces) }),
              zeile.hasPrefix("git version ") else { return nil }
        let v = zeile.dropFirst("git version ".count).trimmingCharacters(in: .whitespaces)
        return v.isEmpty ? nil : v
    }

    private static func beschreibe(_ fehler: Error) -> String {
        switch fehler {
        case BefehlFehler.zeitUeberschritten: return "Zeitlimit überschritten"
        case BefehlFehler.startFehlgeschlagen(let t): return t
        default: return String(describing: fehler)
        }
    }
}
