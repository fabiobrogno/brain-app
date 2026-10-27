import Foundation

/// Der lesbare Bericht des letzten Tageslaufs: `<vault>/.logs/tageslauf/<datum>.md` (Spec §5.2 Nr. 10).
/// Nur lesend. Die Lauf-Nummer für „zurück“ steht laut B2-Plan im Bericht (`JJJJMMTT-HHMMSS`) —
/// diese Stelle ist gegen den echten Kit-Code zu prüfen.
public struct Tagesbericht: Equatable, Sendable {
    public let datei: String
    public let text: String
    /// Lauf-Nummer für `brain zurueck`; nil, wenn der Bericht keine enthält.
    public let lauf: String?
    /// Probe-Berichte (`…-probe.md`) haben nichts geändert — es gibt nichts zurückzunehmen.
    public let istProbe: Bool

    public var kannZurueck: Bool { lauf != nil && !istProbe }

    public static func lade(vault: URL, fm: FileManager = .default) -> Tagesbericht? {
        let ordner = vault.appendingPathComponent(".logs/tageslauf", isDirectory: true)
        guard let namen = try? fm.contentsOfDirectory(atPath: ordner.path) else { return nil }
        // Nur Berichte vom Tag; „letzter.json“ und „aktionen.jsonl“ sind keine. Der Name beginnt mit dem Datum → sortierbar.
        // „….md“ sortiert nach „…-probe.md“ ('-' < '.'): der echte Bericht des Tages gewinnt vor einer späteren Probe.
        let berichte = namen.filter { $0.hasSuffix(".md") && $0.first?.isNumber == true }.sorted()
        for name in berichte.reversed() {
            let url = ordner.appendingPathComponent(name)
            // Kein Symlink aus dem Vault heraus lesen.
            guard (try? url.resourceValues(forKeys: [.isRegularFileKey]))?.isRegularFile == true,
                  let daten = try? Data(contentsOf: url), daten.count <= 500_000 else { continue }
            let text = String(decoding: daten, as: UTF8.self)
            return Tagesbericht(datei: name, text: text, lauf: lauf(in: text), istProbe: name.hasSuffix("-probe.md"))
        }
        return nil
    }

    /// Nummer des letzten Laufs: der Bericht wird fortgeschrieben, je Lauf ein Abschnitt `## Lauf <id>`.
    /// Nur Überschriftzeilen zählen, nicht Zahlen im Fließtext.
    static func lauf(in text: String) -> String? {
        var letzte: String?
        for zeile in text.split(whereSeparator: \.isNewline) {
            let z = String(zeile)
            guard z.range(of: #"^## Lauf \d{8}-\d{6}\s*$"#, options: .regularExpression) != nil,
                  let r = z.range(of: #"\d{8}-\d{6}"#, options: .regularExpression) else { continue }
            letzte = String(z[r])
        }
        return letzte
    }
}
