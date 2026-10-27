import AppKit
import WebKit
import BrainCore

/// Testlauf des Studios („Selbstfoto“): Die App fotografiert ihr eigenes Fenster, damit sich die echte Oberfläche (echtes
/// WKWebView, Swift-Brücke, Werkstatt) auch ohne Bildschirmaufnahme ansehen lässt — etwa bei gesperrtem Bildschirm.
/// Ablauf: `window.studio.bereit` abwarten → `--test-skript` ausführen → `--test-bild-warten` warten → PNG schreiben.
/// Jede Stufe schreibt eine Logzeile (`test-…`); nichts davon wirft oder beendet die App.
@MainActor
enum StudioTestlauf {
    /// Wie lange die Oberfläche bereit werden darf, wie lange ein Skript laufen darf und wie lange der Schnappschuss dauern darf.
    static let bereitFrist = Duration.seconds(30)
    static let skriptFrist = Duration.seconds(20)
    static let bildFrist = Duration.seconds(20)
    /// Größtes Testskript (Bytes) und längste Logzeile (Zeichen) für Ergebnis/Fehlertext.
    static let maxSkriptBytes = 256 * 1024
    static let maxLogText = 300

    /// Ruhige Oberfläche im Testlauf: Ist das Fenster verdeckt oder der Bildschirm gesperrt, meldet WebKit die Seite als
    /// unsichtbar (`document.hidden`) und schaltet ihre Animations-Zeitleiste ab — Einblend-Animationen (Willkommen, Dialoge)
    /// blieben beim Foto auf Deckkraft 0 stehen, das Bild wäre leer. Dieselbe Regel wie `prefers-reduced-motion` in studio.css:
    /// jede Animation steht sofort im Endzustand.
    static func ruhigeAnimationen() -> WKUserScript {
        let quelle = """
        (function () {
          var s = document.createElement('style');
          s.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }';
          (document.head || document.documentElement).appendChild(s);
        })();
        """
        return WKUserScript(source: quelle, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    static func fuehreAus(_ t: StartArgumente, web: WKWebView, log: AppLog) async {
        let bereit = await warteAufBereit(web)
        guard !Task.isCancelled else { return }
        // Zur Einordnung: `hidden` = Fenster verdeckt oder Bildschirm gesperrt (Animationen und rAF stehen dann still).
        let sicht = (try? await web.evaluateJavaScript("document.visibilityState")) as? String ?? "unbekannt"
        log.schreibe((bereit ? "test-bereit" : "test-nicht-bereit window.studio.bereit-blieb-aus") + " seite=\(sicht)")
        if let skript = t.testSkript {
            if bereit { await fuehreSkriptAus(skript, web: web, log: log) }
            else { log.schreibe("test-skript-uebersprungen oberflaeche-nicht-bereit") }
        }
        guard !Task.isCancelled, let ziel = t.testBild else { return }
        try? await Task.sleep(for: t.testBildWarten)
        guard !Task.isCancelled else { return }
        await schreibeBild(ziel, web: web, log: log)
    }

    /// `window.studio.bereit === true`: die Oberfläche hat Daten geladen und gezeichnet (app.js, `markiereBereit`).
    private static func warteAufBereit(_ web: WKWebView) async -> Bool {
        let schritte = Int(bereitFrist.components.seconds * 10)
        for _ in 0..<schritte {
            guard !Task.isCancelled else { return false }
            let wert = try? await web.evaluateJavaScript("window.studio?.bereit === true")
            if (wert as? NSNumber)?.boolValue == true { return true }
            try? await Task.sleep(for: .milliseconds(100))
        }
        return false
    }

    // MARK: Skript

    private static func fuehreSkriptAus(_ url: URL, web: WKWebView, log: AppLog) async {
        let name = url.lastPathComponent
        let quelle: String
        do {
            let daten = try Data(contentsOf: url)
            guard daten.count <= maxSkriptBytes, let text = String(data: daten, encoding: .utf8) else {
                log.schreibe("test-skript-fehler \(name) nicht-lesbar-oder-zu-gross")
                return
            }
            quelle = text
        } catch {
            log.schreibe("test-skript-fehler \(name) \(kurz(error.localizedDescription))")
            return
        }
        let start = ContinuousClock.now
        // `callAsyncJavaScript`: der Dateiinhalt ist der Rumpf einer async-Funktion (darf `await` nutzen, `return` liefert das Ergebnis).
        let antwort = await mitFrist(skriptFrist) {
            try await web.callAsyncJavaScript(quelle, arguments: [:], in: nil, contentWorld: .page)
        }
        let dauer = start.duration(to: .now).components
        let ms = Int(dauer.seconds * 1000 + dauer.attoseconds / 1_000_000_000_000_000)
        switch antwort {
        case nil:
            log.schreibe("test-skript-fehler \(name) zeitueberschreitung-\(skriptFrist.components.seconds)s")
        case .failure(let fehler)?:
            log.schreibe("test-skript-fehler \(name) \(beschreibe(fehler: fehler))")
        case .success(let wert)?:
            log.schreibe("test-skript ok \(name) \(ms)ms" + (beschreibe(wert: wert).map { " ergebnis=\($0)" } ?? ""))
        }
    }

    /// Fehlertext einer JavaScript-Ausnahme (Meldung, Zeile, Spalte) bzw. des Systems — einzeilig und gekürzt.
    private static func beschreibe(fehler: Error) -> String {
        let e = fehler as NSError
        var text = (e.userInfo["WKJavaScriptExceptionMessage"] as? String) ?? e.localizedDescription
        if let zeile = e.userInfo["WKJavaScriptExceptionLineNumber"] as? NSNumber {
            let spalte = (e.userInfo["WKJavaScriptExceptionColumnNumber"] as? NSNumber).map { ":\($0)" } ?? ""
            text += " (Zeile \(zeile)\(spalte))"
        }
        return kurz(text)
    }

    /// Rückgabewert des Skripts (Text, Zahl, JSON); nichts/`null` → nil.
    private static func beschreibe(wert: Any?) -> String? {
        guard let wert, !(wert is NSNull) else { return nil }
        if let s = wert as? String { return kurz(s) }
        if JSONSerialization.isValidJSONObject(wert), let d = try? JSONSerialization.data(withJSONObject: wert, options: [.sortedKeys]),
           let s = String(data: d, encoding: .utf8) { return kurz(s) }
        return kurz(String(describing: wert))
    }

    private static func kurz(_ text: String) -> String {
        let einzeilig = text.split(whereSeparator: \.isNewline).joined(separator: " ")
        return String(einzeilig.prefix(maxLogText))
    }

    // MARK: Bild

    /// Schnappschuss des Studio-Inhalts in doppelter Auflösung (@2x: Breite in Punkten × 2 Pixel) als PNG. `snapshotWidth` zählt
    /// in Punkten und wird mit dem Maßstab des Bildschirms (Retina: 2) zu Pixeln — also auf den Maßstab 2 umrechnen, damit das
    /// Bild immer 2 × Punkte breit ist (nicht 4 ×).
    private static func schreibeBild(_ ziel: URL, web: WKWebView, log: AppLog) async {
        let konfig = WKSnapshotConfiguration()
        konfig.afterScreenUpdates = true
        let massstab = max(1, web.window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 2)
        konfig.snapshotWidth = NSNumber(value: Double(web.bounds.width) * 2 / Double(massstab))
        let antwort = await mitFrist(bildFrist) { try await web.takeSnapshot(configuration: konfig) }
        let bild: NSImage
        switch antwort {
        case nil: log.schreibe("test-bild-fehler zeitueberschreitung-\(bildFrist.components.seconds)s"); return
        case .failure(let fehler)?: log.schreibe("test-bild-fehler \(kurz(fehler.localizedDescription))"); return
        case .success(let b)?: bild = b
        }
        guard let cg = bild.cgImage(forProposedRect: nil, context: nil, hints: nil),
              let png = NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:]) else {
            log.schreibe("test-bild-fehler kein-png")
            return
        }
        do {
            try FileManager.default.createDirectory(at: ziel.deletingLastPathComponent(), withIntermediateDirectories: true)
            try png.write(to: ziel, options: .atomic)
            log.schreibe("test-bild geschrieben \(ziel.path) \(cg.width)x\(cg.height)")
        } catch {
            log.schreibe("test-bild-fehler schreiben \(kurz(error.localizedDescription))")
        }
    }

    // MARK: Frist

    /// Wartet genau einmal auf das erste Ergebnis (Arbeit oder Zeitablauf) — wie `Einmal` in `FensterSteuerung`.
    private final class Einmalig<T> {
        private var fortsetzung: CheckedContinuation<T, Never>?
        init(_ f: CheckedContinuation<T, Never>) { fortsetzung = f }
        func fertig(_ wert: T) { fortsetzung?.resume(returning: wert); fortsetzung = nil }
    }

    /// Führt `arbeit` aus und wartet höchstens `frist`: Ergebnis oder Fehler der Arbeit, bei Zeitablauf `nil` (die Arbeit läuft
    /// dann im Hintergrund weiter, ihr Ergebnis wird verworfen).
    private static func mitFrist<T>(_ frist: Duration, _ arbeit: @escaping @MainActor () async throws -> T) async -> Result<T, Error>? {
        await withCheckedContinuation { (f: CheckedContinuation<Result<T, Error>?, Never>) in
            let einmalig = Einmalig(f)
            Task { @MainActor in
                do { einmalig.fertig(.success(try await arbeit())) } catch { einmalig.fertig(.failure(error)) }
            }
            Task { @MainActor in
                try? await Task.sleep(for: frist)
                einmalig.fertig(nil)
            }
        }
    }
}
