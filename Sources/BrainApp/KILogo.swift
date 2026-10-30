import SwiftUI
import AppKit
import BrainCore

/// Logo einer KI-App (Claude Code, Codex, Cursor, Claude Desktop, Gemini CLI, GitHub Copilot, Zed, OpenCode, Warp) als wiederverwendbarer Baustein.
/// Die SVG-Dateien liegen unverändert in `Contents/Resources/logos` und werden mit `NSImage` geladen (macOS liest SVG selbst). Nur das
/// Attribut `viewBox` wird für die Darstellung ersetzt (`KiZiel.logoAnsicht`): so füllt jedes Logo das Quadrat optisch gleich stark, ohne Verzerrung.
/// Claude und Gemini erscheinen in der Markenfarbe, alle anderen einfarbig in der Textfarbe (passt zu Hell und Dunkel). Ohne Logo-Datei (Codex) oder wenn
/// das Laden scheitert, steht die Initiale in einem neutralen Kreis. Die Marken gehören den jeweiligen Inhabern (siehe `Ressourcen/logos/HERKUNFT.md`).
///
/// Eingebaut im Einrichtungsassistenten, Schritt „KI verbinden“ (`Sources/BrainApp/EinrichtungsSchritte.swift`, `KiReihe`), vor dem Namen
/// jeder KI-Zeile: `KILogo(ki: ziel, groesse: 28)`.
struct KILogo: View {
    let ki: KiZiel
    var groesse: CGFloat = 20
    var ressourcen: URL? = Bundle.main.resourceURL

    var body: some View {
        Group {
            if let bild = KILogoBilder.bild(ki, ressourcen: ressourcen) {
                Image(nsImage: bild)
                    .renderingMode(.template)
                    .resizable()
                    .scaledToFit()
                    .foregroundStyle(ki.logoFarbeHex.map { Color(hex: $0) } ?? Color.primary)
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
    private static var zwischenspeicher: [String: NSImage] = [:]

    static func bild(_ ki: KiZiel, ressourcen: URL?) -> NSImage? {
        guard let url = KILogoQuelle.url(ki, ressourcen: ressourcen) else { return nil }
        let schluessel = url.path + "#" + (ki.logoAnsicht ?? "")
        if let b = zwischenspeicher[schluessel] { return b }
        guard let daten = KILogoQuelle.daten(ki, ressourcen: ressourcen),
              let b = NSImage(data: daten), b.size.width > 0, b.size.height > 0 else { return nil }
        b.isTemplate = true
        zwischenspeicher[schluessel] = b
        return b
    }
}

private extension Color {
    init(hex: String) {
        let w = UInt32(hex, radix: 16) ?? 0
        self.init(.sRGB, red: Double((w >> 16) & 0xFF) / 255, green: Double((w >> 8) & 0xFF) / 255, blue: Double(w & 0xFF) / 255)
    }
}
