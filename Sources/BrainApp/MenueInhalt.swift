import SwiftUI
import Sparkle
import BrainCore

/// Menü der Menüleiste. Oben der Zustand (aktiver Vault mit Namen, Zustand mit Symbol und Text, „Nur ansehen“, offene Zahlen, Warnungen),
/// darunter die Aktionen in festen Gruppen: Rückfragen · Studio, Übersicht, Abgleichen · Vault · Einstellungen, Einrichtung · Beenden.
/// Die Zeilen des Kopfs baut `MenueStatus` (BrainCore, einzeln getestet); hier werden sie nur angezeigt.
/// Tastenkürzel gelten, solange das Menü offen ist; die Menüs im Studio-Fenster haben eigene (Ablage, Darstellung, Gehe zu).
struct MenueInhalt: View {
    @ObservedObject var zustand: AppZustand
    let updater: SPUStandardUpdaterController

    var body: some View {
        if zustand.vorschau != nil {
            Text(VorschauBand.text)
            Divider()
        }
        ForEach(Array(zustand.menueZeilen.enumerated()), id: \.offset) { _, zeile in
            statusZeile(zeile)
        }
        Divider()
        Button(RueckfragenText.zaehler(zustand.rueckfragenAnzahl)) { zustand.oeffneRueckfragen() }
            .keyboardShortcut("f")
            .disabled(zustand.vault == nil || !zustand.kitVorhanden || !zustand.kernBereitschaft.istBereit)
        Divider()
        Button("Studio öffnen") { zustand.oeffneStudio() }.keyboardShortcut("o")
        Button("Schnell erfassen …") { zustand.erfassen.zeige() }.keyboardShortcut("a", modifiers: [.command, .shift])
        Button("Übersicht öffnen") { Task { await zustand.oeffneFenster() } }.keyboardShortcut("u").disabled(!zustand.uebersichtMoeglich)
        Button("Jetzt abgleichen") { zustand.sende(.abgleichen) }.keyboardShortcut("s").disabled(zustand.vault == nil)
        Divider()
        Button("Vault wechseln …") { zustand.sende(.vaultWechseln) }.keyboardShortcut("v", modifiers: [.control, .command])
        Button("Ordner als Vault öffnen …") { zustand.sende(.vaultOeffnen) }.keyboardShortcut("o", modifiers: [.command, .shift])
        Button("Ordner im Finder zeigen") { zustand.zeigeOrdner() }.keyboardShortcut("f", modifiers: [.command, .shift]).disabled(zustand.vault == nil)
        Divider()
        if zustand.umstellungAngeboten {
            Button("Vault umstellen …") { zustand.sende(.umstellung) }.help("Dieser Vault stammt aus der Zeit vor Kortex. Kortex probiert die Umstellung zuerst an einer Kopie aus.")
        }
        Button(StudioBefehl.einstellungenEintrag.titel) { zustand.sende(StudioBefehl.einstellungenEintrag.befehl) }.keyboardShortcut(KeyEquivalent(Character(StudioBefehl.einstellungenEintrag.taste))).disabled(zustand.vault == nil)
        Button("Kortex einrichten …") { zustand.zeigeAssistent() }.keyboardShortcut("e")
        Button("Status neu prüfen") { Task { await zustand.aktualisiere() } }.keyboardShortcut("r")
        Button("Nach Updates suchen …") { updater.checkForUpdates(nil) }.disabled(zustand.vorschau != nil)
        Divider()
        Button("Beenden") { NSApp.terminate(nil) }.keyboardShortcut("q")
    }

    /// Reine Auskunft ist gedämpft (wie jede Menüzeile ohne Aktion). Was Aufmerksamkeit braucht, führt per Klick weiter: der Vault-Name
    /// (wechseln), „Nur ansehen“ (Einstellungen), Warnungen (Studio) und ein nicht bereiter Kern (Protokoll; klare Meldung statt stillem
    /// Ausweichen, Kern-Umzug P4).
    @ViewBuilder private func statusZeile(_ zeile: MenueZeile) -> some View {
        let beschriftung = Label(zeile.text, systemImage: zeile.symbol)
        switch zeile.aktion {
        case .keine:
            if let hilfe = zeile.erklaerung { beschriftung.help(hilfe) } else { beschriftung }
        case .vaultWechseln:
            Button { zustand.sende(.vaultWechseln) } label: { beschriftung }.help(zeile.erklaerung ?? "")
        case .vertrauenPruefen:
            Button { zustand.sende(.einstellungen) } label: { beschriftung }.help(zeile.erklaerung ?? "")
        case .studioOeffnen:
            Button { zustand.oeffneStudio() } label: { beschriftung }.help(zeile.erklaerung ?? "")
        case .protokollZeigen:
            Button { zustand.zeigeProtokoll() } label: { beschriftung }.help(zeile.erklaerung ?? "")
        case .aufgabenOeffnen:
            Button { zustand.sende(.aufgaben) } label: { beschriftung }.help(zeile.erklaerung ?? "")
        }
    }
}

/// Symbol in der Menüleiste. Ist alles in Ordnung, steht das K der App dort (einfarbig, vom System getönt); sonst das Zustandssymbol —
/// seine Form (nicht die Farbe) unterscheidet ⚠, ✕ und ?. So erkennt man die App auf einen Blick und sieht Abweichungen sofort.
struct MenueSymbol: View {
    @ObservedObject var zustand: AppZustand

    var body: some View {
        Group {
            if zustand.menueAnzeige.zeichen == "✓" {
                Image(nsImage: KortexMenueBild.k)
            } else {
                Image(systemName: zustand.menueAnzeige.symbol)
            }
        }
        .accessibilityLabel("Kortex: \(zustand.menueAnzeige.titel)")
    }
}
