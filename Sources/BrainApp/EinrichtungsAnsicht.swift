import SwiftUI
import BrainCore

/// Rückfall-Fenster (Studio-v2-Spec §2): Einen Einrichtungsdialog als Pflicht gibt es nicht mehr — das Studio öffnet
/// immer und führt selbst durch „Willkommen“. Dieses Fenster erscheint nur, wenn das Studio nicht starten kann, weil die
/// mitgelieferte Laufzeit (Node) fehlt oder beschädigt ist.
struct EinrichtungsAnsicht: View {
    @ObservedObject var zustand: AppZustand

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Brain kann nicht starten").font(.title2.bold())
            Label(zustand.anzeige.titel, systemImage: zustand.anzeige.symbol)
                .foregroundStyle(.red)
                .fixedSize(horizontal: false, vertical: true)
            Text("Das Studio braucht die mitgelieferte Laufzeit. Bitte installiere die App neu — dein Brain wird dabei nicht verändert.")
                .fixedSize(horizontal: false, vertical: true)
            HStack {
                Button("Protokoll zeigen") { zustand.zeigeProtokoll() }
                Button("Beenden") { NSApp.terminate(nil) }.keyboardShortcut(.defaultAction)
            }
        }
        .padding(24)
        .frame(width: 460)
    }
}
