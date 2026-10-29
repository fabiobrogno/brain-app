import SwiftUI
import Sparkle
import BrainCore

/// Menü der Menüleiste: Zustand immer als Symbol + Text (✓ ⚠ ✕ ?), dann Aktionen.
struct MenueInhalt: View {
    @ObservedObject var zustand: AppZustand
    let updater: SPUStandardUpdaterController

    var body: some View {
        if zustand.vorschau != nil {
            Text(VorschauBand.text)
            Divider()
        }
        Label("\(zustand.menueAnzeige.zeichen) \(zustand.menueAnzeige.titel)", systemImage: zustand.menueAnzeige.symbol)
        if let name = zustand.vaultName {
            Text("Vault: \(name)")
        }
        if let z = zustand.status?.zahlen {
            Text("Vorschläge \(z.vorschlaege) · Konflikte \(z.konflikte) · abgelaufen \(z.abgelaufen)")
        }
        if zustand.status?.quellVault == true {
            Text("Entwickler-Brain — keine Kit-Updates")
        }
        // Stillstehende Zuführungen (FBL-94): je Problem eine Zeile, auch wenn die Menüleiste schon wegen etwas anderem ⚠ oder ✕ zeigt.
        ForEach(Array(zustand.zufuehrungen.menueZeilen.enumerated()), id: \.offset) { _, zeile in
            Label(zeile, systemImage: "exclamationmark.triangle")
        }
        Divider()
        Button(RueckfragenText.zaehler(zustand.rueckfragenAnzahl)) { zustand.oeffneRueckfragen() }
            .keyboardShortcut("f")
            .disabled(zustand.vault == nil || !zustand.kitErlaubt)
        if zustand.kitVorhanden {
            switch zustand.kitStand {
            case .nichtFreigegeben:
                Text("Im Studio freigeben, dann läuft das Kit")
            case .pruefungFehlgeschlagen:
                // Kein „bitte freigeben“: Dem Vault ist vielleicht längst vertraut, nur die Prüfung selbst ging schief. Gestartet wird
                // trotzdem nichts aus dem Vault; der Grund steht im Protokoll.
                Text("Die Prüfung ließ sich nicht ausführen — siehe Protokoll")
                Button("Protokoll zeigen") { zustand.zeigeProtokoll() }
            case .unbekannt, .erlaubt:
                EmptyView()
            }
        }
        Divider()
        Button("Studio öffnen") { zustand.oeffneStudio() }.keyboardShortcut("o")
        Button("Übersicht öffnen") { Task { await zustand.oeffneFenster() } }.disabled(!zustand.uebersichtMoeglich)
        Button("Ordner im Finder zeigen") { zustand.zeigeOrdner() }.disabled(zustand.vault == nil)
        Button("Status aktualisieren") { Task { await zustand.aktualisiere() } }.keyboardShortcut("r")
        Button("Vault öffnen …") { zustand.sende(.vaultOeffnen) }
        Button("Kortex einrichten …") { zustand.zeigeAssistent() }
        Divider()
        Button("Nach Updates suchen …") { updater.checkForUpdates(nil) }.disabled(zustand.vorschau != nil)
        Button("Beenden") { NSApp.terminate(nil) }.keyboardShortcut("q")
    }
}

/// Symbol in der Menüleiste — Form unterscheidet die Zustände, nicht die Farbe.
struct MenueSymbol: View {
    @ObservedObject var zustand: AppZustand

    var body: some View {
        Image(systemName: zustand.menueAnzeige.symbol)
            .accessibilityLabel("Kortex: \(zustand.menueAnzeige.titel)")
    }
}
