import SwiftUI
import AppKit
import BrainCore

/// Logo einer KI-App (Claude, Codex, Cursor) als wiederverwendbarer Baustein.
/// Die SVG-Dateien liegen unverändert in `Contents/Resources/logos` und werden mit `NSImage` geladen (macOS liest SVG selbst).
/// Claude erscheint in der Markenfarbe, Cursor einfarbig in der Textfarbe (passt zu Hell und Dunkel). Ohne Logo-Datei (Codex) oder wenn
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
        if let b = zwischenspeicher[url.path] { return b }
        guard let b = NSImage(contentsOf: url), b.size.width > 0, b.size.height > 0 else { return nil }
        b.isTemplate = true
        zwischenspeicher[url.path] = b
        return b
    }
}

private extension Color {
    init(hex: String) {
        let w = UInt32(hex, radix: 16) ?? 0
        self.init(.sRGB, red: Double((w >> 16) & 0xFF) / 255, green: Double((w >> 8) & 0xFF) / 255, blue: Double(w & 0xFF) / 255)
    }
}
