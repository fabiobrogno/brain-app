import AppKit
import UniformTypeIdentifiers
import BrainCore

/// Export und Teilen der Mac-App (Aktionen `export-speichern`, `export-pdf`, `teilen`; Prüfung und Schreiben in BrainCore/ExportBuendel.swift):
/// Speichern-Dialog als Sheet am Studiofenster, PDF aus dem HTML der Werkstatt, Teilen-Menü des Systems. Nichts geht ins Netz: die unsichtbare Seite für das PDF
/// läuft ohne JavaScript, mit flüchtigem Speicher und ohne Basisadresse (das HTML bringt Bilder und Schrift als data: mit).
@MainActor
final class ExportSteuerung {
    /// Wartet genau einmal auf die Antwort des Sheets (oder den Abbruch).
    private final class Antwort {
        private var fortsetzung: CheckedContinuation<URL?, Never>?
        init(_ f: CheckedContinuation<URL?, Never>) { fortsetzung = f }
        func fertig(_ url: URL?) { fortsetzung?.resume(returning: url); fortsetzung = nil }
    }
    private var offen = false

    /// Speichern-Dialog als Sheet. `typ`: erlaubte Endung (nil = beliebig, auch bei Ordnern). nil = Abbruch (oder schon ein Dialog offen, oder kein Fenster).
    func speichernDialog(fenster: NSWindow?, name: String, typ: UTType?) async -> URL? {
        guard let fenster, !offen else { return nil }
        offen = true
        defer { offen = false }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = name
        panel.canCreateDirectories = true
        panel.isExtensionHidden = false
        if let typ { panel.allowedContentTypes = [typ] }
        if fenster.isMiniaturized { fenster.deminiaturize(nil) }
        fenster.makeKeyAndOrderFront(nil)
        NSApp.activate()
        return await withCheckedContinuation { (f: CheckedContinuation<URL?, Never>) in
            let antwort = Antwort(f)
            panel.beginSheetModal(for: fenster) { code in antwort.fertig(code == .OK ? panel.url?.standardizedFileURL : nil) }
        }
    }

    // MARK: PDF

    /// HTML → PDF (BrainCore/PdfErzeuger.swift)
    func erzeugePdf(html: String) async -> Data? { await PdfErzeuger().erzeuge(html: html) }

    // MARK: Teilen

    /// Teilen-Menü des Systems für den Text einer Notiz: eine .md-Datei im Temp-Ordner (ältere Dateien dort werden vorher aufgeräumt).
    func teile(fenster: NSWindow?, name: String, text: String) -> Bool {
        guard let fenster, let ansicht = fenster.contentView else { return false }
        let wurzel = FileManager.default.temporaryDirectory.appendingPathComponent("Kortex-Teilen", isDirectory: true)
        if let alte = try? FileManager.default.contentsOfDirectory(at: wurzel, includingPropertiesForKeys: [.contentModificationDateKey]) {
            for a in alte where ((try? a.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast) < Date().addingTimeInterval(-3600) { try? FileManager.default.removeItem(at: a) }
        }
        let ordner = wurzel.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let datei = ordner.appendingPathComponent(name.lowercased().hasSuffix(".md") ? name : name + ".md")
        do {
            try FileManager.default.createDirectory(at: ordner, withIntermediateDirectories: true)
            try Data(text.utf8).write(to: datei, options: .atomic)
        } catch { return false }
        let picker = NSSharingServicePicker(items: [datei])
        picker.show(relativeTo: NSRect(x: ansicht.bounds.midX, y: ansicht.bounds.maxY - 56, width: 1, height: 1), of: ansicht, preferredEdge: .minY)
        return true
    }
}
