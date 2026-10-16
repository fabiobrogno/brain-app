import SwiftUI
import BrainCore

/// Einrichtung M1 (App-Spec §9.1): nur „Vorhandenes Brain verbinden“.
struct EinrichtungsAnsicht: View {
    @ObservedObject var zustand: AppZustand
    private let vorschlag = VaultAuswahl.vorschlag()

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Wo liegt dein Brain?").font(.title2.bold())
            Text("Die App verbindet sich mit deinem vorhandenen Brain-Ordner. Sie zeigt ihn an und verändert von selbst nichts darin.")
                .fixedSize(horizontal: false, vertical: true)
            if let vorschlag {
                Label(vorschlag.path, systemImage: "folder")
                Button("Diesen Ordner verbinden") { Task { await zustand.verbinde(vorschlag) } }
                    .keyboardShortcut(.defaultAction)
            }
            Button("Anderen Ordner wählen …") { zustand.waehleOrdner() }
            if zustand.anzeige.zeichen == "✕" {
                Label(zustand.anzeige.titel, systemImage: zustand.anzeige.symbol)
                    .foregroundStyle(.red)
            }
        }
        .padding(24)
        .frame(width: 460)
    }
}
