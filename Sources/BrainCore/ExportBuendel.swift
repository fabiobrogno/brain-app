import Foundation

/// Export und Teilen (Aktionen `export-speichern`, `export-pdf`, `teilen`): was die Werkstatt als Bündel liefert (`gemeinsam/export.mjs`), prüft und schreibt die App hier.
/// Die Prüfung ist streng wie bei jeder Aktion der Seite: nur relative, harmlose Pfade, begrenzte Größe, nie ein Pfad nach draußen. Geschrieben wird erst nach dem Speichern-Dialog
/// des Nutzers, und nur unter dem Ort, den er gewählt hat. Dieselben Regeln gelten in der Electron-Hülle (`electron/export-schreiben.mjs`).
public struct ExportDatei: Equatable, Sendable {
    public let pfad: String
    public let daten: Data
}

public struct ExportBuendel: Equatable, Sendable {
    /// Vorschlag für den Speichern-Dialog (ein Dateiname oder Ordnername).
    public let name: String
    /// Die Hauptdatei (Pfad in `dateien`); bei `ordner` ohne Bedeutung.
    public let haupt: String
    /// true: der Nutzer wählt einen Ordner-Namen, und alle Dateien kommen hinein (der erste Pfadteil steht für den gewählten Ordner).
    public let ordner: Bool
    public let dateien: [ExportDatei]

    public static let maxDateien = 2000
    public static let maxBytes = 96 * 1024 * 1024
    public static let maxPfad = 240
    public static let maxTiefe = 16

    /// `wert` = { name, haupt, ordner?, dateien: [{ pfad, text } | { pfad, base64 }] } oder nil.
    public static func pruefe(_ wert: Any?) -> ExportBuendel? {
        guard let d = wert as? [String: Any], let name = d["name"] as? String, let haupt = d["haupt"] as? String,
              let roh = d["dateien"] as? [[String: Any]], !roh.isEmpty, roh.count <= maxDateien else { return nil }
        let ordner: Bool
        if let o = d["ordner"], !(o is NSNull) {
            guard let n = o as? NSNumber, CFGetTypeID(n) == CFBooleanGetTypeID() else { return nil }
            ordner = n.boolValue
        } else { ordner = false }
        guard let sauberName = dateiname(name), sicherePfad(haupt) else { return nil }
        var dateien: [ExportDatei] = []
        var gesamt = 0
        var gesehen = Set<String>()
        for e in roh {
            guard let pfad = e["pfad"] as? String, sicherePfad(pfad), gesehen.insert(pfad.lowercased()).inserted else { return nil }
            let daten: Data
            if let t = e["text"] as? String { daten = Data(t.utf8) }
            else if let b = e["base64"] as? String, let x = Data(base64Encoded: b) { daten = x }
            else { return nil }
            gesamt += daten.count
            guard gesamt <= maxBytes else { return nil }
            dateien.append(ExportDatei(pfad: pfad, daten: daten))
        }
        guard ordner || dateien.contains(where: { $0.pfad == haupt }) else { return nil }
        return ExportBuendel(name: sauberName, haupt: haupt, ordner: ordner, dateien: dateien)
    }

    /// Ein Pfad im Bündel: relativ, mit Schrägstrichen, ohne `..`, ohne versteckte Teile, ohne Doppelpunkt, Backslash, NUL und Steuerzeichen.
    static func sicherePfad(_ p: String) -> Bool {
        guard !p.isEmpty, p.count <= maxPfad, !p.hasPrefix("/") else { return false }
        let teile = p.split(separator: "/", omittingEmptySubsequences: false)
        guard teile.count <= maxTiefe else { return false }
        for t in teile {
            if t.isEmpty || t == "." || t == ".." || t.hasPrefix(".") { return false }
            for u in t.unicodeScalars {
                if u == "\\" || u == ":" || u == "\0" { return false }
                switch u.properties.generalCategory {
                case .control, .format, .lineSeparator, .paragraphSeparator: return false
                default: continue
                }
            }
        }
        return true
    }

    /// Dateiname für den Dialog: ein Teil, keine Trennzeichen, nicht versteckt, höchstens 120 Zeichen.
    static func dateiname(_ n: String) -> String? {
        let t = n.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, t.count <= 120, !t.hasPrefix("."), !t.contains("/"), !t.contains("\\"), !t.contains(":"), !t.contains("\0") else { return nil }
        for u in t.unicodeScalars { switch u.properties.generalCategory { case .control, .format, .lineSeparator, .paragraphSeparator: return nil; default: continue } }
        return t
    }

    /// Schreibt das Bündel an den gewählten Ort `ziel` (Ergebnis des Speichern-Dialogs) und liefert den Namen der Hauptdatei bzw. des Ordners.
    ///   · Einzeldatei: die Hauptdatei kommt an `ziel`, alle anderen relativ zum Ordner daneben (bilder/…).
    ///   · Ordner: `ziel` wird der Ordner; der erste Pfadteil jeder Datei steht für ihn.
    /// Texte (.md, .html, .pdf, .zip) werden ersetzt (der Dialog hat das Überschreiben bestätigt); alles andere (Bilder, Namen mit Kurz-Hash) nur, wenn es noch fehlt.
    /// Nie durch einen Symlink, nie aus dem Zielordner heraus.
    @discardableResult
    public func schreibe(nach ziel: URL, fm: FileManager = .default) throws -> String {
        let basis = ordner ? ziel : ziel.deletingLastPathComponent()
        if ordner { try fm.createDirectory(at: ziel, withIntermediateDirectories: true) }
        let echteBasis = basis.resolvingSymlinksInPath().standardizedFileURL
        for d in dateien {
            var teile = d.pfad.split(separator: "/").map(String.init)
            let ist: URL
            if !ordner && d.pfad == haupt { ist = ziel }
            else {
                if ordner { teile.removeFirst() }
                guard !teile.isEmpty else { continue }
                ist = teile.reduce(basis) { $0.appendingPathComponent($1) }
            }
            let ordnerDavor = ist.deletingLastPathComponent()
            try fm.createDirectory(at: ordnerDavor, withIntermediateDirectories: true)
            guard ordnerDavor.resolvingSymlinksInPath().standardizedFileURL.path.hasPrefix(echteBasis.path) else { throw ExportFehler.ausserhalb }
            if let attr = try? fm.attributesOfItem(atPath: ist.path) {
                if (attr[.type] as? FileAttributeType) == .typeSymbolicLink { throw ExportFehler.verweis }
                let istText = [".md", ".html", ".pdf", ".zip"].contains { ist.lastPathComponent.lowercased().hasSuffix($0) }
                if !istText { continue } // Bild mit Kurz-Hash: gleicher Name = gleicher Inhalt
            }
            try d.daten.write(to: ist, options: .atomic)
        }
        return ziel.lastPathComponent
    }
}

public enum ExportFehler: Error, Equatable { case ausserhalb, verweis }

/// `export-pdf`: ein fertiges, eigenständiges HTML (Bilder und Schrift als data:) und der Vorschlagsname; die App macht daraus ein PDF (WKWebView.createPDF).
public struct ExportPdf: Equatable, Sendable {
    public let name: String
    public let html: String
    public static let maxHtml = 80 * 1024 * 1024

    public static func pruefe(_ wert: Any?) -> ExportPdf? {
        guard let d = wert as? [String: Any], let name = d["name"] as? String, let html = d["html"] as? String,
              let n = ExportBuendel.dateiname(name), !html.isEmpty, html.utf8.count <= maxHtml else { return nil }
        return ExportPdf(name: n.lowercased().hasSuffix(".pdf") ? n : n + ".pdf", html: html)
    }
}

/// `teilen`: Name und Text einer Notiz für das Teilen-Menü des Systems (die App legt dafür eine Datei im Temp-Ordner an).
public enum ExportTeilen {
    public static let maxText = 8 * 1024 * 1024
    public static func pruefe(_ wert: Any?) -> (name: String, text: String)? {
        guard let d = wert as? [String: Any], let name = d["name"] as? String, let text = d["text"] as? String,
              let n = ExportBuendel.dateiname(name), text.utf8.count <= maxText else { return nil }
        return (n, text)
    }
}
