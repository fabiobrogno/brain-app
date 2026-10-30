import Foundation

public enum VaultPruefung: Equatable, Sendable { case ok, fehlt, keinBrain }

/// Ein Ort, der als Vault zu breit ist (Schreibtisch, Dokumente, iCloud-Drive-Wurzel …), samt Erklärung und einem Unterordner, der passt.
public struct BreiterOrt: Equatable, Sendable {
    /// Name, wie ihn der Finder zeigt („Dokumente“).
    public let name: String
    /// Ein eigener Unterordner an diesem Ort (z. B. `~/Documents/Kortex`); nil, wenn es keinen sinnvollen Vorschlag gibt.
    public let vorschlag: URL?

    /// Erklärung für den Nutzer, ohne Fachwörter. Der Pfad des Vorschlags steht mit `~` für den Benutzerordner.
    public func text(home: URL) -> String {
        var t = "„\(name)“ ist als Vault zu groß: Kortex würde alles darin als Notizen behandeln."
        if let v = vorschlag {
            t += " Lege darin einen eigenen Ordner an, zum Beispiel „\(v.lastPathComponent)“ (\(VaultAuswahl.kurz(v, home: home)))."
        } else {
            t += " Lege darin einen eigenen Ordner an."
        }
        return t
    }
}

/// Ist ein Ordner ein Brain? (App-Spec §9.1, „Vorhandenes Brain verbinden“) — rein lesend. Ein Vault ist ein Ordner mit
/// `brain.config.json` (wie `pruefeVault` im Kern): Vorhanden-Sein von Daten genügt, ein altes `.tools/` im Vault zählt nicht und
/// wird nicht gebraucht.
public enum VaultAuswahl {
    public static let marke = "brain.config.json"

    public static func pruefe(_ ordner: URL) -> VaultPruefung {
        var istOrdner: ObjCBool = false
        guard FileManager.default.fileExists(atPath: ordner.path, isDirectory: &istOrdner), istOrdner.boolValue else { return .fehlt }
        var istDatei: ObjCBool = false
        let konfig = ordner.appendingPathComponent(marke).path
        return FileManager.default.fileExists(atPath: konfig, isDirectory: &istDatei) && !istDatei.boolValue ? .ok : .keinBrain
    }

    public static func vorschlag(home: URL = FileManager.default.homeDirectoryForCurrentUser) -> URL? {
        // isDirectory: false — sonst hängt URL bei existierenden Ordnern einen „/“ an und Vergleiche scheitern.
        [home.appendingPathComponent("brain", isDirectory: false), home.appendingPathComponent("Documents/Brain", isDirectory: false)]
            .first { pruefe($0) == .ok }
    }

    /// Orte direkt im Benutzerordner, in denen kein Vault selbst liegen soll, sondern in einem Unterordner: [Ordnername, Name im deutschen Finder].
    /// Dieselbe Liste wie `BREITE_ORDNER` in `gemeinsam/vaults.mjs` (die Werkstatt prüft beim Anlegen, Öffnen und Klonen noch einmal).
    static let breiteOrdner: [(ordner: String, anzeige: String)] = [
        ("Desktop", "Schreibtisch"), ("Documents", "Dokumente"), ("Downloads", "Downloads"), ("Pictures", "Bilder"),
        ("Movies", "Filme"), ("Music", "Musik"), ("Public", "Öffentlich"), ("Applications", "Programme"),
    ]

    private static func falte(_ s: String) -> String { s.precomposedStringWithCanonicalMapping.lowercased() }
    private static func teile(_ pfad: String) -> [String] { pfad.split(separator: "/").map { falte(String($0)) } }

    /// Pfad für die Anzeige: der Benutzerordner als `~`.
    public static func kurz(_ url: URL, home: URL) -> String {
        let p = url.path, h = home.path
        return p == h ? "~" : p.hasPrefix(h + "/") ? "~" + p.dropFirst(h.count) : p
    }

    /// Ist dieser Ordner zu breit für einen Vault? Prüft die geschriebene UND die aufgelöste Form (Symlinks), legt nichts an.
    /// Der Benutzerordner selbst zählt auch (Vorschlag: `~/Kortex`). Ob der Ordner existiert, spielt keine Rolle.
    public static func breiterOrt(_ ordner: URL, home: URL = FileManager.default.homeDirectoryForCurrentUser) -> BreiterOrt? {
        let formen: [(URL, URL)] = [
            (ordner.standardizedFileURL, home.standardizedFileURL),
            (AppAktion.aufgeloest(ordner), AppAktion.aufgeloest(home)),
        ]
        for (o, h) in formen {
            if let b = pruefeBreit(o.path, home: h) { return b }
        }
        return nil
    }

    private static func pruefeBreit(_ pfad: String, home: URL) -> BreiterOrt? {
        let p = teile(pfad), h = teile(home.path)
        func ist(_ rel: [String]) -> Bool { p == h + rel.map(falte) }
        func vorschlag(_ rel: [String]) -> URL { rel.reduce(home) { $0.appendingPathComponent($1, isDirectory: true) }.appendingPathComponent("Kortex", isDirectory: true) }
        if ist([]) { return BreiterOrt(name: "Benutzerordner", vorschlag: vorschlag([])) }
        for (ordner, anzeige) in breiteOrdner where ist([ordner]) { return BreiterOrt(name: anzeige, vorschlag: vorschlag([ordner])) }
        if ist(["Library", "Mobile Documents"]) || ist(["Library", "Mobile Documents", "com~apple~CloudDocs"]) {
            return BreiterOrt(name: "iCloud Drive", vorschlag: vorschlag(["Library", "Mobile Documents", "com~apple~CloudDocs"]))
        }
        if ist(["Library", "CloudStorage"]) { return BreiterOrt(name: "Cloud-Speicher", vorschlag: nil) }
        // direkte Unterordner von CloudStorage sind die Wurzeln der Anbieter (Dropbox, Google Drive, OneDrive …)
        let cs = h + ["library", "cloudstorage"]
        if p.count == cs.count + 1, Array(p.prefix(cs.count)) == cs {
            let name = pfad.split(separator: "/").last.map(String.init) ?? "Cloud-Speicher"
            return BreiterOrt(name: name, vorschlag: URL(fileURLWithPath: pfad, isDirectory: true).appendingPathComponent("Kortex", isDirectory: true))
        }
        return nil
    }

    /// Ordnername für einen neuen Vault aus seinem Namen: ohne `/`, `:` und Steuerzeichen, nicht versteckt, höchstens 80 Zeichen; leer → „Kortex“.
    public static func ordnername(fuer name: String) -> String {
        var t = String(name.unicodeScalars.map { $0.value < 32 || $0 == "/" || $0 == ":" ? "-" : Character($0) })
        t = t.trimmingCharacters(in: .whitespacesAndNewlines)
        while t.hasPrefix(".") { t.removeFirst() }
        t = String(t.prefix(80)).trimmingCharacters(in: .whitespaces)
        return t.isEmpty ? "Kortex" : t
    }

    /// Der Ordner des neuen Vaults, wenn der Nutzer einen Ort gewählt hat: dort entsteht ein eigener Ordner mit dem Namen des Vaults.
    public static func vaultOrdner(in ort: URL, name: String) -> URL {
        ort.appendingPathComponent(ordnername(fuer: name), isDirectory: true)
    }

    public static func meldung(_ p: VaultPruefung) -> String? {
        switch p {
        case .ok: return nil
        case .fehlt: return "Vault-Ordner nicht gefunden"
        case .keinBrain: return "Dieser Ordner ist kein Kortex-Vault — darin fehlt brain.config.json"
        }
    }
}
