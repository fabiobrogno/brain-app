import SwiftUI
import AppKit
import BrainCore

/// Logo einer KI-App (Claude Code, Codex, Cursor, Claude Desktop, Gemini CLI, GitHub Copilot, Zed, OpenCode, Warp) als wiederverwendbarer Baustein.
/// Welche Datei, welche Farbe und welche Ansicht gilt, steht im KI-Katalog (`Ressourcen/gemeinsam/ki-katalog.json`, `KiKatalog`). Die Logo-Dateien liegen
/// in `Contents/Resources/logos` und werden mit `NSImage` geladen (macOS liest SVG selbst). Bei SVG wird nur das Attribut `viewBox` für die Darstellung
/// ersetzt: so füllt jedes Logo das Quadrat optisch gleich stark, ohne Verzerrung. Farbe nach Modus: `einfarbig` in der Textfarbe (passt zu Hell und
/// Dunkel), `marke` in der Markenfarbe (nur wo sie auf Hell UND Dunkel mindestens 3:1 hat), `bild` unverändert (mehrfarbig, PNG). Ohne Logo-Datei oder
/// wenn das Laden scheitert, steht die Initiale in einem neutralen Kreis. Die Marken gehören den jeweiligen Inhabern (siehe `Ressourcen/logos/HERKUNFT.md`).
///
/// Eingebaut im Einrichtungsassistenten, Schritt „KI verbinden“ (`Sources/BrainApp/EinrichtungsSchritte.swift`, `KiReihe`), vor dem Namen
/// jeder KI-Zeile: `KILogo(ki: ziel, groesse: 28)`.
struct KILogo: View {
    let ki: KiZiel
    var groesse: CGFloat = 20
    var ressourcen: URL? = Bundle.main.resourceURL

    var body: some View {
        Group {
            if let logo = KILogoBilder.bild(ki, ressourcen: ressourcen) {
                switch logo.info.modus {
                case .bild:
                    Image(nsImage: logo.bild).renderingMode(.original).resizable().scaledToFit()
                case .marke:
                    Image(nsImage: logo.bild).renderingMode(.template).resizable().scaledToFit()
                        .foregroundStyle(logo.info.farbeHex.map { Color(hex: $0) } ?? Color.primary)
                case .einfarbig:
                    Image(nsImage: logo.bild).renderingMode(.template).resizable().scaledToFit().foregroundStyle(Color.primary)
                }
            } else {
                Text(ki.initiale)
                    .font(.system(size: groesse * 0.55, weight: .semibold, design: .rounded))
                    .foregroundStyle(.secondary)
                    .frame(width: groesse, height: groesse)
                    .background(Circle().fill(.quaternary))
            }
        }
        .frame(width: groesse, height: groesse)
        .accessibilityElement()
        .accessibilityLabel(ki.name)
        .help(ki.name)
    }
}

/// Lädt jedes Logo einmal und hält es im Speicher.
@MainActor
enum KILogoBilder {
    struct Geladen { let bild: NSImage; let info: KiLogoInfo }
    private static var zwischenspeicher: [String: Geladen] = [:]

    static func bild(_ ki: KiZiel, ressourcen: URL?) -> Geladen? {
        guard let info = ki.logo(ressourcen: ressourcen), let url = KILogoQuelle.url(ki, ressourcen: ressourcen) else { return nil }
        let schluessel = url.path + "#" + (info.ansicht ?? "")
        if let b = zwischenspeicher[schluessel] { return b }
        guard let daten = KILogoQuelle.daten(ki, ressourcen: ressourcen),
              let b = NSImage(data: daten), b.size.width > 0, b.size.height > 0 else { return nil }
        b.isTemplate = info.modus != .bild
        let geladen = Geladen(bild: b, info: info)
        zwischenspeicher[schluessel] = geladen
        return geladen
    }
}

private extension Color {
    init(hex: String) {
        let w = UInt32(hex, radix: 16) ?? 0
        self.init(.sRGB, red: Double((w >> 16) & 0xFF) / 255, green: Double((w >> 8) & 0xFF) / 255, blue: Double(w & 0xFF) / 255)
    }
}
