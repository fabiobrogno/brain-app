import Foundation
import CoreGraphics

/// Erscheinungsbild, das `--test-dunkel` / `--test-hell` der App aufzwingen.
public enum TestErscheinungsbild: String, Equatable, Sendable {
    case hell, dunkel
}

/// Start-Argumente für Entwicklung, Rauchtest und Speichermessung (Task 15/16). Unbekanntes wird ignoriert.
///
/// Testschalter fürs Studio („Selbstfoto“: die App fotografiert ihr eigenes Fenster, auch bei gesperrtem Bildschirm).
/// Sie gelten nur für das Studio-Fenster, nie für die Übersicht. Ein ungültiger Wert ändert nichts und landet als Zeile in
/// `hinweise` (die App schreibt sie ins Log) — nie ein Absturz.
///  - `--test-fenster <Breite>x<Höhe>`: Inhaltsgröße des Studio-Fensters in Punkten. Ohne Wert gilt der ältere Schalter:
///    zusätzlich die Übersicht öffnen (`fensterOeffnen`).
///  - `--test-bild <absoluter Pfad.png>`: PNG des Studio-Inhalts (@2x), sobald die Oberfläche bereit ist; `--test-bild-warten
///    <Sekunden>` (Standard 2) so lange noch warten.
///  - `--test-dunkel` / `--test-hell`: Erscheinungsbild erzwingen.
///  - `--test-skript <absoluter Pfad.js>`: Skript nach „bereit“ und vor dem Bild im Studio ausführen; nur mit der
///    Umgebungsvariable `BRAIN_TESTMODUS=1`.
public struct StartArgumente: Equatable, Sendable {
    public var vault: URL?
    public var fensterOeffnen = false
    public var schliessenNach: Duration?
    public var beendenNach: Duration?
    public var testFenster: CGSize?
    public var testBild: URL?
    public var testBildWarten: Duration = .seconds(2)
    public var testErscheinungsbild: TestErscheinungsbild?
    public var testSkript: URL?
    /// Logzeilen zu abgelehnten Testschaltern (leer, wenn alles in Ordnung war).
    public var hinweise: [String] = []

    public init() {}

    /// Läuft das Studio als Testlauf? Dann bekommt es einen flüchtigen Web-Speicher (kein localStorage der echten App:
    /// Theme, letzte Notiz und Spaltenbreiten würden das Bild verfälschen und danach die echte App) und keine gemerkte
    /// Fensterposition.
    public var studioTestlauf: Bool {
        testFenster != nil || testBild != nil || testErscheinungsbild != nil || testSkript != nil
    }

    /// Größte erlaubte Fensterkante (Punkte) und längste Wartezeit (Sekunden) für die Testschalter.
    static let maxKante = 4000
    static let maxWarten = 120.0

    public static func lies(_ argumente: [String], umgebung: [String: String] = ProcessInfo.processInfo.environment) -> StartArgumente {
        var a = StartArgumente()
        var i = 1
        func wert() -> String? { i + 1 < argumente.count ? argumente[i + 1] : nil }
        func sekunden() -> Duration? { wert().flatMap(Int.init).map { .seconds($0) } }
        /// Wert eines Testschalters: der nächste Eintrag, solange er nicht selbst ein Schalter ist (`--…`). Wird verbraucht.
        func testWert(_ schalter: String) -> String? {
            guard let w = wert(), !w.hasPrefix("--") else {
                a.hinweise.append("test-schalter-ignoriert \(schalter) Wert-fehlt")
                return nil
            }
            i += 1
            return w
        }
        func ignoriert(_ schalter: String, _ grund: String) { a.hinweise.append("test-schalter-ignoriert \(schalter) \(grund)") }
        func erscheinungsbild(_ schalter: String, _ neu: TestErscheinungsbild) {
            if let alt = a.testErscheinungsbild, alt != neu { ignoriert(schalter, "widerspricht-\(alt.rawValue)-letzter-gilt") }
            a.testErscheinungsbild = neu
        }
        while i < argumente.count {
            switch argumente[i] {
            case "--vault":
                if let v = wert(), v.hasPrefix("/") { a.vault = URL(fileURLWithPath: v); i += 1 }
            case "--test-fenster":
                if let w = wert(), !w.hasPrefix("--") {
                    i += 1
                    if let g = fensterGroesse(w) { a.testFenster = g } else { ignoriert("--test-fenster", "erwartet-BreitexHöhe-1-bis-\(maxKante)") }
                } else {
                    a.fensterOeffnen = true
                }
            case "--test-fenster-schliessen-nach":
                if let s = sekunden() { a.schliessenNach = s; i += 1 }
            case "--test-beenden-nach":
                if let s = sekunden() { a.beendenNach = s; i += 1 }
            case "--test-bild":
                if let w = testWert("--test-bild") {
                    if let u = absoluteDatei(w, endung: "png") { a.testBild = u } else { ignoriert("--test-bild", "erwartet-absoluten-Pfad-auf-.png") }
                }
            case "--test-bild-warten":
                if let w = testWert("--test-bild-warten") {
                    if let s = Double(w), s.isFinite, s >= 0, s <= maxWarten { a.testBildWarten = .seconds(s) } else { ignoriert("--test-bild-warten", "erwartet-Sekunden-0-bis-\(Int(maxWarten))") }
                }
            case "--test-dunkel":
                erscheinungsbild("--test-dunkel", .dunkel)
            case "--test-hell":
                erscheinungsbild("--test-hell", .hell)
            case "--test-skript":
                if let w = testWert("--test-skript") {
                    if umgebung["BRAIN_TESTMODUS"] != "1" { ignoriert("--test-skript", "nur-mit-BRAIN_TESTMODUS=1") }
                    else if let u = absoluteDatei(w, endung: "js") { a.testSkript = u }
                    else { ignoriert("--test-skript", "erwartet-absoluten-Pfad-auf-.js") }
                }
            default:
                break
            }
            i += 1
        }
        return a
    }

    /// `<Breite>x<Höhe>` in ganzen Punkten (1 … `maxKante`), sonst nil.
    static func fensterGroesse(_ text: String) -> CGSize? {
        let teile = text.split(separator: "x", maxSplits: 1, omittingEmptySubsequences: false)
        guard teile.count == 2, let b = ganzeZahl(teile[0]), let h = ganzeZahl(teile[1]) else { return nil }
        return CGSize(width: b, height: h)
    }

    private static func ganzeZahl(_ s: Substring) -> Int? {
        guard !s.isEmpty, s.count <= 5, s.allSatisfy({ $0 >= "0" && $0 <= "9" }), let n = Int(s), (1...maxKante).contains(n) else { return nil }
        return n
    }

    /// Absoluter Dateipfad mit der Endung (ohne Beachtung der Groß-/Kleinschreibung), nie ein Ordner.
    static func absoluteDatei(_ text: String, endung: String) -> URL? {
        guard text.hasPrefix("/"), !text.hasSuffix("/") else { return nil }
        let url = URL(fileURLWithPath: text)
        return url.pathExtension.lowercased() == endung ? url : nil
    }
}
