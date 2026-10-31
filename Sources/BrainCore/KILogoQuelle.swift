import Foundation

/// Welche Logo-Datei zu welcher KI-App gehört, in welcher Farbe und Größe sie erscheint. Alles steht im KI-Katalog
/// (`Ressourcen/gemeinsam/ki-katalog.json`, siehe `KiKatalog`); die Logo-Dateien liegen in `Ressourcen/logos` (im App-Paket
/// `Contents/Resources/logos`). UI-unabhängig, damit Tests die Zuordnung ohne SwiftUI prüfen. Die Herkunft der Dateien, die Begründung der
/// Farben und der Ansichten steht in `Ressourcen/logos/HERKUNFT.md`.
public extension KiZiel {
    /// Das Logo laut Katalog (Datei, Modus, Markenfarbe, Ansicht); `nil` = kein echtes Logo vorhanden.
    func logo(ressourcen: URL? = Bundle.main.resourceURL) -> KiLogoInfo? {
        KiKatalog.laden(ressourcen: ressourcen)?.logo(ziel)
    }
}

public enum KILogoQuelle {
    /// Ort der Logo-Datei unterhalb von `ressourcen` (`Contents/Resources` der App bzw. `Ressourcen/` im Repo), falls sie existiert.
    public static func url(_ ki: KiZiel, ressourcen: URL? = Bundle.main.resourceURL) -> URL? {
        guard let datei = ki.logo(ressourcen: ressourcen)?.datei, let ressourcen else { return nil }
        let u = ressourcen.appendingPathComponent("logos", isDirectory: true).appendingPathComponent(datei)
        return FileManager.default.isReadableFile(atPath: u.path) ? u : nil
    }

    /// Die Daten für die Darstellung: bei einer SVG die Datei, bei der NUR das Attribut `viewBox` der Wurzel durch die `ansicht` des Katalogs ersetzt ist
    /// (alles andere bleibt Zeichen für Zeichen unverändert); bei einem PNG die Datei selbst. `nil`, wenn es kein Logo gibt oder die Datei unerwartet aussieht.
    public static func daten(_ ki: KiZiel, ressourcen: URL? = Bundle.main.resourceURL) -> Data? {
        guard let info = ki.logo(ressourcen: ressourcen), let u = url(ki, ressourcen: ressourcen) else { return nil }
        guard info.istSVG else { return try? Data(contentsOf: u) }
        guard let ansicht = info.ansicht, let text = try? String(contentsOf: u, encoding: .utf8) else { return nil }
        return mitAnsicht(text, ansicht)?.data(using: .utf8)
    }

    /// Ersetzt den viewBox der Wurzel; `nil`, wenn keiner da ist oder die Datei Skripte enthält.
    static func mitAnsicht(_ svg: String, _ ansicht: String) -> String? {
        let klein = svg.lowercased()
        guard !klein.contains("<script"), !klein.contains("<foreignobject"),
              let re = try? NSRegularExpression(pattern: #"^(\s*<svg\b[^>]*?\sviewBox=")[^"]*(")"#, options: [.caseInsensitive]) else { return nil }
        let bereich = NSRange(svg.startIndex..., in: svg)
        guard let m = re.firstMatch(in: svg, options: [], range: bereich),
              let vorn = Range(m.range(at: 1), in: svg), let hinten = Range(m.range(at: 2), in: svg) else { return nil }
        return String(svg[..<vorn.upperBound]) + ansicht + String(svg[hinten.lowerBound...])
    }
}
