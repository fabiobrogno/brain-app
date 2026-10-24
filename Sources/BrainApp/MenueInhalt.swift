import SwiftUI
import BrainCore

/// Menü der Menüleiste: Zustand immer als Symbol + Text (✓ ⚠ ✕ ?), dann Aktionen.
struct MenueInhalt: View {
    @ObservedObject var zustand: AppZustand

    var body: some View {
        Label("\(zustand.anzeige.zeichen) \(zustand.anzeige.titel)", systemImage: zustand.anzeige.symbol)
        if let z = zustand.status?.zahlen {
            Text("Vorschläge \(z.vorschlaege) · Konflikte \(z.konflikte) · abgelaufen \(z.abgelaufen)")
        }
        if zustand.status?.quellVault == true {
            Text("Entwickler-Brain — keine Kit-Updates")
        }
        Divider()
        Button("Studio öffnen") { zustand.oeffneStudio() }.keyboardShortcut("o")
        Button("Übersicht öffnen") { zustand.oeffneFenster() }
        Button("Ordner im Finder zeigen") { zustand.zeigeOrdner() }.disabled(zustand.vault == nil)
        Button("Status aktualisieren") { Task { await zustand.aktualisiere() } }.keyboardShortcut("r")
        Button("Anderen Brain-Ordner wählen …") { zustand.waehleOrdner() }
        Divider()
        Button("Beenden") { NSApp.terminate(nil) }.keyboardShortcut("q")
    }
}

/// Symbol in der Menüleiste — Form unterscheidet die Zustände, nicht die Farbe.
struct MenueSymbol: View {
    @ObservedObject var zustand: AppZustand

    var body: some View {
        Image(systemName: zustand.anzeige.symbol)
            .accessibilityLabel("Brain: \(zustand.anzeige.titel)")
    }
}
