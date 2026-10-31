import Foundation

/// Fehler einer Konto-Aktion; `meldung` ist ein deutscher Satz mit dem nächsten Schritt und darf der Oberfläche gezeigt werden.
public struct KiAktionFehler: Error, Equatable, Sendable {
    public let meldung: String
    public init(_ meldung: String) { self.meldung = meldung }
}

/// Konto-Ordner der KI-Programme (`CLAUDE_CONFIG_DIR` bzw. `CODEX_HOME`). Die Oberfläche darf nur Ordner nennen, die Kortex selbst
/// kennt: direkte Kinder des Home-Ordners (`.claude`, `.claude-*`, `.codex`, `.codex-*`) oder von `<support>/ki-konten-ordner/`
/// (`claude-*`, `codex-*`). Nie ein Symlink, nie `..`, der Ordner muss existieren.
public enum KiKontoOrdner {
    public enum Auswahl: Equatable, Sendable {
        /// kein eigener Ordner: das Programm nimmt seinen Standard (`~/.claude`, `~/.codex`)
        case standard
        case ordner(URL)
    }

    public static let programme: Set<String> = ["claude", "codex"]
    /// Unterordner des Support-Ordners für Konten, die Kortex selbst anlegt.
    public static let supportUnterordner = "ki-konten-ordner"

    /// `nil` = nicht erlaubt (unbekanntes Programm, fremder Ort, Symlink, fehlender Ordner …).
    public static func pruefe(programm: String, ordner: String?, home: URL, support: URL) -> Auswahl? {
        guard programme.contains(programm) else { return nil }
        guard var roh = ordner?.trimmingCharacters(in: .whitespacesAndNewlines), !roh.isEmpty else { return .standard }
        if roh == "~" || roh.hasPrefix("~/") { roh = home.path + roh.dropFirst() }
        guard roh.hasPrefix("/") else { return nil }
        let teile = roh.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        guard let name = teile.last, !teile.contains(".."), !teile.contains("."), nurErlaubteZeichen(name) else { return nil }
        let eltern = "/" + teile.dropLast().joined(separator: "/")
        let pfad = (eltern == "/" ? "" : eltern) + "/" + name

        let homePfade = Set([bereinigt(home.path), bereinigt(home.resolvingSymlinksInPath().path)])
        let supportOrdner = [bereinigt(support.path), bereinigt(support.resolvingSymlinksInPath().path)].map { $0 + "/" + supportUnterordner }
        if homePfade.contains(eltern) {
            let punkt = "." + programm
            if name == punkt { return .standard }
            guard name.hasPrefix(punkt + "-"), name.count > punkt.count + 1 else { return nil }
        } else if supportOrdner.contains(eltern) {
            let vorn = programm + "-"
            guard name.hasPrefix(vorn), name.count > vorn.count else { return nil }
            guard istOrdnerOhneLink(eltern) else { return nil }
        } else {
            return nil
        }
        guard istOrdnerOhneLink(pfad) else { return nil }
        return .ordner(URL(fileURLWithPath: pfad, isDirectory: true))
    }

    private static func bereinigt(_ pfad: String) -> String {
        var p = pfad
        while p.count > 1 && p.hasSuffix("/") { p.removeLast() }
        return p
    }

    private static func nurErlaubteZeichen(_ name: String) -> Bool {
        !name.isEmpty && name.unicodeScalars.allSatisfy {
            ($0.value >= 0x30 && $0.value <= 0x39) || ($0.value >= 0x41 && $0.value <= 0x5A) || ($0.value >= 0x61 && $0.value <= 0x7A)
                || $0 == "." || $0 == "_" || $0 == "-"
        }
    }

    /// Ein Ordner, der selbst kein Symlink ist (lstat).
    static func istOrdnerOhneLink(_ pfad: String) -> Bool {
        var st = stat()
        return lstat(pfad, &st) == 0 && (st.st_mode & S_IFMT) == S_IFDIR
    }

    /// Name der Umgebungsvariablen, die den Konto-Ordner des Programms festlegt.
    static func variable(_ programm: String) -> String { programm == "claude" ? "CLAUDE_CONFIG_DIR" : "CODEX_HOME" }
}

public struct KiAnmeldung: Equatable, Sendable {
    public static let angemeldet = "angemeldet"
    public static let nichtAngemeldet = "nicht-angemeldet"
    public static let unbekannt = "unbekannt"

    /// "angemeldet" | "nicht-angemeldet" | "unbekannt"
    public let zustand: String
    public let grund: String?

    public init(zustand: String, grund: String? = nil) { self.zustand = zustand; self.grund = grund }

    func jsonObjekt() -> [String: Any] {
        var o: [String: Any] = ["zustand": zustand]
        if let grund { o["grund"] = grund }
        return o
    }
}

public enum KiKonto {
    static func anzeigename(_ programm: String) -> String { programm == "claude" ? "Claude Code" : "Codex" }

    /// Fragt das Programm selbst (`claude auth status` bzw. `codex login status`) mit bereinigter Umgebung; nur bei einem
    /// Nicht-Standardordner kommt `CLAUDE_CONFIG_DIR`/`CODEX_HOME` dazu. Kortex liest nie Tokens oder den Schlüsselbund.
    /// `pfadEintraege`: PATH des Kindes (Standard: der PATH der Basisumgebung); der Ordner des Programms steht immer vorn.
    public static func anmeldeStatus(programm: String, ordner: KiKontoOrdner.Auswahl, fund: KiFund,
                                     basisUmgebung: [String: String] = ProcessInfo.processInfo.environment,
                                     pfadEintraege: [String] = [], zeitlimit: Duration = .seconds(10)) async -> KiAnmeldung {
        guard KiKontoOrdner.programme.contains(programm) else {
            return KiAnmeldung(zustand: KiAnmeldung.unbekannt, grund: "Dieses Programm kann Kortex nicht abfragen.")
        }
        var zusatz: [String: String] = [:]
        if case .ordner(let url) = ordner { zusatz[KiKontoOrdner.variable(programm)] = url.path }
        let programmOrdner = (fund.pfad as NSString).deletingLastPathComponent
        let rest = pfadEintraege.isEmpty ? KiErkennung.absoluteEintraege(basisUmgebung["PATH"] ?? "") : pfadEintraege
        zusatz["PATH"] = ([programmOrdner] + rest).joined(separator: ":")
        let argumente = programm == "claude" ? ["auth", "status"] : ["login", "status"]
        // Claude schreibt das Ergebnis als JSON auf stdout (stderr stört das Lesen); bei Codex steht die Meldung ggf. auf stderr.
        let r = await KiProzess.laufe(programm: fund.pfad, argumente: argumente,
                                      umgebung: KiErkennung.kindUmgebung(basis: basisUmgebung, zusatz: zusatz), zeitlimit: zeitlimit,
                                      maxByte: KiErkennung.maxAusgabe, stderrEinmischen: programm == "codex")
        switch r {
        case .zeitlimit:
            return KiAnmeldung(zustand: KiAnmeldung.unbekannt, grund: "Die Abfrage dauerte zu lange. Versuche es gleich noch einmal.")
        case .startfehler:
            return KiAnmeldung(zustand: KiAnmeldung.unbekannt, grund: "\(anzeigename(programm)) ließ sich nicht starten. Klicke auf „Neu suchen“.")
        case .beendet(let code, let daten):
            return auswerten(programm: programm, code: code, ausgabe: daten)
        }
    }

    /// Wertet Exit-Code und Ausgabe aus. Aus der Ausgabe wird nichts weitergegeben (keine E-Mail, kein Konto) — bei Claude wird NUR
    /// das Feld `loggedIn` gelesen, bei Codex nur geprüft, ob „not logged in“ vorkommt.
    static func auswerten(programm: String, code: Int32, ausgabe: Data) -> KiAnmeldung {
        if code == 0 {
            if programm == "claude",
               let obj = try? JSONSerialization.jsonObject(with: ausgabe) as? [String: Any],
               let eingeloggt = obj["loggedIn"] as? Bool, !eingeloggt {
                return KiAnmeldung(zustand: KiAnmeldung.nichtAngemeldet)
            }
            return KiAnmeldung(zustand: KiAnmeldung.angemeldet)
        }
        if programm == "claude" { return KiAnmeldung(zustand: KiAnmeldung.nichtAngemeldet) }
        if String(decoding: ausgabe, as: UTF8.self).lowercased().contains("not logged in") {
            return KiAnmeldung(zustand: KiAnmeldung.nichtAngemeldet)
        }
        return KiAnmeldung(zustand: KiAnmeldung.unbekannt, grund: "Codex meldete keinen eindeutigen Anmeldestatus.")
    }
}

/// Ergebnis von `KiAnmelden.vorbereiten`: das Skript und die Zeile, die die Oberfläche als Hinweis zeigt.
public struct KiAnmeldeSkript: Equatable, Sendable {
    public let url: URL
    /// z. B. `CLAUDE_CONFIG_DIR=~/.claude-arbeit claude auth login` (Home als `~` gekürzt)
    public let anzeige: String
}

public enum KiAnmelden {
    public static let unterordner = "ki-anmelden"

    /// Schreibt ein `.command`-Skript (Modus 0700) nach `<support>/ki-anmelden/<zufällig>/anmelden.command`. Es löscht sich am Ende
    /// selbst. Das Öffnen (Terminal.app) übernimmt der Aufrufer. Ohne Fund: Fehler mit dem nächsten Schritt.
    public static func vorbereiten(programm: String, ordner: KiKontoOrdner.Auswahl, fund: KiFund?, support: URL,
                                   home: URL = FileManager.default.homeDirectoryForCurrentUser) throws -> KiAnmeldeSkript {
        guard KiKontoOrdner.programme.contains(programm) else {
            throw KiAktionFehler("Für dieses Programm kann Kortex keine Anmeldung öffnen. Melde dich direkt im Programm an.")
        }
        guard let fund else {
            throw KiAktionFehler("\(KiKonto.anzeigename(programm)) wurde nicht gefunden. Installiere es und klicke dann auf „Neu suchen“.")
        }
        let argumente = programm == "claude" ? ["auth", "login"] : ["login"]
        let programmOrdner = (fund.pfad as NSString).deletingLastPathComponent

        var zeilen = [
            "#!/bin/bash",
            "# Kortex: Anmeldung für \(KiKonto.anzeigename(programm)). Diese Datei löscht sich am Ende selbst.",
            "unset CLAUDE_CONFIG_DIR CODEX_HOME ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN CLAUDE_CODE_OAUTH_TOKEN OPENAI_API_KEY CODEX_API_KEY",
        ]
        var anzeigeVorn = ""
        if case .ordner(let url) = ordner {
            let variable = KiKontoOrdner.variable(programm)
            zeilen.append("export \(variable)=\(shellQuote(url.path))")
            anzeigeVorn = "\(variable)=\(anzeigePfad(url.path, home: home)) "
        }
        zeilen.append("export PATH=\(shellQuote(programmOrdner)):\"$PATH\"")
        zeilen.append(([shellQuote(fund.pfad)] + argumente).joined(separator: " "))
        zeilen += [
            "echo",
            "echo \"Fertig. Du kannst dieses Fenster schließen.\"",
            "rm -f \"$0\"",
            "rmdir \"$(dirname \"$0\")\" 2>/dev/null",
            "read -r -p \"Drücke Return zum Schließen\" || true",
            "",
        ]

        let fm = FileManager.default
        let wurzel = support.appendingPathComponent(unterordner, isDirectory: true)
        try fm.createDirectory(at: wurzel, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        raeumeAlteAuf(wurzel)
        let ordnerURL = wurzel.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try fm.createDirectory(at: ordnerURL, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        let datei = ordnerURL.appendingPathComponent("anmelden.command")
        do {
            try zeilen.joined(separator: "\n").write(to: datei, atomically: true, encoding: .utf8)
            try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: datei.path)
        } catch {
            try? fm.removeItem(at: ordnerURL)
            throw KiAktionFehler("Das Anmelde-Skript ließ sich nicht anlegen. Prüfe, ob auf der Festplatte noch Platz ist, und versuche es erneut.")
        }
        let anzeige = anzeigeVorn + ([programm] + argumente).joined(separator: " ")
        return KiAnmeldeSkript(url: datei, anzeige: anzeige)
    }

    /// Entfernt Reste früherer Anmeldungen (Fenster geschlossen, bevor das Skript sich löschen konnte), die älter als ein Tag sind.
    static func raeumeAlteAuf(_ wurzel: URL) {
        let fm = FileManager.default
        guard let kinder = try? fm.contentsOfDirectory(at: wurzel, includingPropertiesForKeys: [.contentModificationDateKey]) else { return }
        let grenze = Date().addingTimeInterval(-86_400)
        for k in kinder {
            guard KiKontoOrdner.istOrdnerOhneLink(k.path),
                  let d = try? k.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate, d < grenze else { continue }
            try? fm.removeItem(at: k)
        }
    }

    /// Einfache Anführungszeichen: `'` wird zu `'\''`.
    static func shellQuote(_ text: String) -> String {
        "'" + text.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    /// Pfad für die Anzeige: Home als `~` gekürzt; nur mit Anführungszeichen, wenn Sonderzeichen vorkommen.
    static func anzeigePfad(_ pfad: String, home: URL) -> String {
        let h = home.path
        var text = pfad
        var tilde = false
        if pfad == h { text = ""; tilde = true } else if pfad.hasPrefix(h + "/") { text = String(pfad.dropFirst(h.count)); tilde = true }
        let sicher = text.unicodeScalars.allSatisfy {
            ($0.value >= 0x30 && $0.value <= 0x39) || ($0.value >= 0x41 && $0.value <= 0x5A) || ($0.value >= 0x61 && $0.value <= 0x7A)
                || "_@%+=:,./-".unicodeScalars.contains($0)
        }
        if tilde { return sicher ? "~" + text : shellQuote(pfad) }
        return sicher ? text : shellQuote(text)
    }
}
