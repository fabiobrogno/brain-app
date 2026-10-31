import SwiftUI
import AppKit
import BrainCore

/// Marken-Logo eines Dienstes (GitHub) als wiederverwendbarer Baustein, im selben Muster wie `KILogo`: Die SVG-Datei liegt unverändert in
/// `Contents/Resources/logos` und wird mit `NSImage` geladen (macOS liest SVG selbst), einfarbig als Vorlage in der Textfarbe (hell/dunkel).
/// Lässt sich die Datei nicht laden, steht die Initiale in einem neutralen Kreis. Die Marken gehören den jeweiligen Inhabern
/// (siehe `Ressourcen/logos/HERKUNFT.md`).
///
/// Derzeit nirgends eingebaut: Der Einrichtungs-Assistent ist eine Web-Seite (Marken dort: `Ressourcen/studio/marken.js`).
struct MarkenLogoAnsicht: View {
    let marke: MarkenLogo
    var groesse: CGFloat = 20
    /// Nur für Marken ohne eigene Farbe: überschreibt die Textfarbe (z. B. auf einer Akzent-Fläche). Marken mit Markenfarbe behalten sie.
    var farbe: Color? = nil
    var ressourcen: URL? = Bundle.main.resourceURL

    var body: some View {
        Group {
            if let bild = MarkenLogoBilder.bild(marke, ressourcen: ressourcen) {
                Image(nsImage: bild)
                    .renderingMode(.template)
                    .resizable()
                    .scaledToFit()
                    .foregroundStyle(marke.logoFarbeHex.map { Color(markenHex: $0) } ?? farbe ?? Color.primary)
            } else {
                Text(marke.initiale)
                    .font(.system(size: groesse * 0.55, weight: .semibold, design: .rounded))
                    .foregroundStyle(.secondary)
                    .frame(width: groesse, height: groesse)
                    .background(Circle().fill(.quaternary))
            }
        }
        .frame(width: groesse, height: groesse)
        .accessibilityElement()
        .accessibilityLabel(marke.name)
        .help(marke.name)
    }
}

/// Lädt jedes Logo einmal und hält es im Speicher.
@MainActor
enum MarkenLogoBilder {
    private static var zwischenspeicher: [String: NSImage] = [:]

    static func bild(_ marke: MarkenLogo, ressourcen: URL?) -> NSImage? {
        guard let url = marke.url(ressourcen: ressourcen) else { return nil }
        if let b = zwischenspeicher[url.path] { return b }
        guard let b = NSImage(contentsOf: url), b.size.width > 0, b.size.height > 0 else { return nil }
        b.isTemplate = true
        zwischenspeicher[url.path] = b
        return b
    }
}

private extension Color {
    init(markenHex hex: String) {
        let w = UInt32(hex, radix: 16) ?? 0
        self.init(.sRGB, red: Double((w >> 16) & 0xFF) / 255, green: Double((w >> 8) & 0xFF) / 255, blue: Double(w & 0xFF) / 255)
    }
}
