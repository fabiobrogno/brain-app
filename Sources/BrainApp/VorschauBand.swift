import AppKit
import SwiftUI

/// Dezenter Hinweis in jedem Fenster der Vorschau (`--vorschau`): nichts, was hier passiert, bleibt bestehen.
enum VorschauBand {
    static let text = "Vorschau — nichts wird gespeichert"

    /// Schmales Band unter der Titelleiste eines Fensters (Studio, Übersicht). Der Inhalt des Fensters wird dadurch nicht überdeckt.
    @MainActor static func anbringen(an fenster: NSWindow) {
        let host = NSHostingView(rootView: VorschauBandAnsicht())
        host.frame = NSRect(x: 0, y: 0, width: 400, height: 22)
        let regler = NSTitlebarAccessoryViewController()
        regler.view = host
        regler.layoutAttribute = .bottom
        fenster.addTitlebarAccessoryViewController(regler)
    }
}

struct VorschauBandAnsicht: View {
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "eye")
            Text(VorschauBand.text)
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, minHeight: 22)
        .background(Color.orange.opacity(0.18))
        .accessibilityElement(children: .combine)
    }
}
