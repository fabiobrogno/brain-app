import AppKit
import SwiftUI
import BrainCore

/// Eine Warnung zu einem Ordner, den der Nutzer gewählt hat (zu breit für einen Vault) — samt dem Ort, an dem ein eigener Unterordner entstehen kann.
struct OrtsHinweis: Equatable {
    let text: String
    /// Der gewählte (zu breite) Ordner. Ein neuer Vault entsteht darin als eigener Unterordner.
    let ort: URL
}

/// Brücke zwischen dem Ablauf (BrainCore) und SwiftUI. Hält die Eingaben des Nutzers (Name, Adresse, Ort) und startet die
/// Aktionen des Ablaufs als Aufgaben, die beim Schließen des Fensters abgebrochen werden.
@MainActor
final class EinrichtungsModell: ObservableObject {
    /// Die Wege im Willkommensbild, in der Reihenfolge der Pfeiltasten.
    enum Weg: CaseIterable, Equatable { case neu, oeffnen, klonen, beispiel }
    /// Welches Bild gerade vor dem Vault gezeigt wird: die Wege oder die Adresse zum Klonen.
    enum Bild: Equatable { case willkommen, klonen }
    /// Die freiwilligen Karten auf dem Abschlussbild.
    enum Karte: Hashable { case ki, sicherung, probe }
    /// Schritt „Sicherung“: neues privates Repository anlegen oder ein vorhandenes wählen.
    enum SicherungsWeg: Equatable { case neu, vorhanden }

    @Published private(set) var zustand = EinrichtungsZustand()
    @Published private(set) var anzeige = EinrichtungsAnzeige()
    @Published var gewaehlt: Weg = .neu
    @Published var bild: Bild = .willkommen
    /// Welche Karte des Abschlussbilds gerade offen ist (nil = die Übersicht).
    @Published var offeneKarte: Karte?
    private var kartenAngestossen = false
    @Published var name = "Kortex"
    @Published var klonAdresse = ""
    /// Der Ort, den der Nutzer gewählt hat: dort entsteht ein eigener Ordner mit dem Namen des Vaults. nil = Standard (`~/Kortex`).
    @Published var eigenerOrt: URL?
    /// Der gewählte Ordner war zu breit (beim Öffnen): Erklärung und Vorschlag.
    @Published var ordnerHinweis: OrtsHinweis?
    @Published var sicherungsWeg: SicherungsWeg? = .neu
    /// Name für das neue Repository; leer = noch nicht vorbelegt (Vorschlag aus dem Namen des Vaults).
    @Published var repoName = ""
    @Published var repoSuche = ""
    /// Die Konfiguration liegt gerade in der Zwischenablage (kurze Rückmeldung am Knopf).
    @Published private(set) var konfigurationKopiert = false
    /// Für welches Programm die Konfiguration gerade kopiert wurde (kurze Rückmeldung in dessen Zeile).
    @Published private(set) var kopiertesZiel: KiZiel?

    private(set) var ablauf: EinrichtungsAblauf!
    private var aufgaben: [Task<Void, Never>] = []
    /// „Studio öffnen“ auf dem letzten Bild: schließt das Fenster und lässt die App das Studio zeigen.
    var beiStudioOeffnen: () -> Void = {}
    /// Schließt das Fenster des Assistenten (für „Später“).
    var beiSchliessen: () -> Void = {}

    /// Vorschau („wie frisch installiert“): Band im Fenster, Ordner-Dialoge starten im Vorschau-Home.
    let vorschau: VorschauModus?

    init(dienste: EinrichtungsDienste, speicher: EinrichtungsSpeicher, log: AppLog, vorschau: VorschauModus? = nil) {
        self.vorschau = vorschau
        ablauf = EinrichtungsAblauf(dienste: dienste, speicher: speicher, log: { log.schreibe($0) }) { [weak self] z, a in
            self?.zustand = z
            self?.anzeige = a
            self?.stosseKartenAn()
        }
    }

    var aktuell: EinrichtungsSchritt? { zustand.aktuell }
    /// Das Nötige steht (git und Vault): ab hier gilt der Assistent als durchgelaufen, alles Weitere sind Karten.
    var istFertig: Bool { zustand.grundeingerichtet }

    /// Sobald der Vault steht, liest der Ablauf im Hintergrund, was die Karten brauchen (GitHub-Konto, Sicherung, KI-Programme).
    private func stosseKartenAn() {
        guard zustand.grundeingerichtet, !kartenAngestossen else { return }
        kartenAngestossen = true
        tu { await $0.ladeKarten() }
    }
    func kannWeiter(_ s: EinrichtungsSchritt) -> Bool { ablauf.kannWeiter(s) }

    /// Der Benutzerordner — in der Vorschau der Vorschau-Ordner.
    var home: URL { vorschau?.home ?? URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true) }

    /// Startet eine Aktion des Ablaufs; sie läuft weiter, auch wenn die Ansicht neu gezeichnet wird.
    func tu(_ aktion: @escaping @MainActor (EinrichtungsAblauf) async -> Void) {
        let a = ablauf!
        aufgaben.append(Task { await aktion(a) })
    }

    /// Belegt den Namen des neuen Repositories einmal aus dem Namen des Vaults vor; der Nutzer kann ihn ändern.
    func schlageRepoNamenVor() {
        guard repoName.isEmpty else { return }
        repoName = RepoName.vorschlag(ausVaultName: anzeige.vault?.name ?? "")
    }

    func starte(wiederholung: Bool) { tu { await $0.starte(wiederholung: wiederholung) } }

    /// Fenster zu: laufende Aufgaben (Warten auf git, auf GitHub) beenden, Stand sichern.
    func beende() {
        aufgaben.forEach { $0.cancel() }
        aufgaben = []
        ablauf.schliesse()
    }

    // MARK: Vault

    private func kurz(_ url: URL) -> String { VaultAuswahl.kurz(url, home: home) }

    /// Der Ordner, in dem der neue Vault entsteht: `<Ort>/<Name>`, ohne gewählten Ort der Standard `~/Kortex`.
    var neuerVaultOrdner: URL? { eigenerOrt.map { VaultAuswahl.vaultOrdner(in: $0, name: name) } }

    var ordnerText: String { neuerVaultOrdner.map(kurz) ?? "~/Kortex" }

    /// Der Ort des aktiven Vaults in Kurzform (`~/Kortex`), für das Abschlussbild.
    var vaultOrtText: String? { anzeige.vault.map { kurz(URL(fileURLWithPath: $0.pfad, isDirectory: true)) } }

    func waehleZielordner() {
        let start = eigenerOrt ?? home
        if let url = Self.waehleOrdner(titel: "Wo soll dein Vault liegen?", knopf: "Hier anlegen", start: start) {
            eigenerOrt = url
            ordnerHinweis = nil
        }
    }

    func legeNeuenVaultAn() {
        let n = name.trimmingCharacters(in: .whitespaces)
        let o = neuerVaultOrdner?.path
        tu { await $0.legeVaultAn(name: n.isEmpty ? nil : n, ordner: o) }
    }

    /// „Erst mal ausprobieren“: ein Beispiel-Vault neben dem eigenen Ort, nie darin.
    func legeBeispielAn() {
        let o = BeispielVault.ordner(home: home).path
        tu { await $0.legeBeispielVaultAn(ordner: o) }
    }

    /// Zu breite Ordner (Home, Schreibtisch, Dokumente, iCloud-Drive-Wurzel …) werden schon hier abgewiesen — noch bevor die Frage nach dem
    /// Versionsverlauf kommt. Die Werkstatt prüft beim Öffnen dieselben Orte noch einmal.
    func oeffneVorhandenenOrdner() {
        ordnerHinweis = nil
        guard let url = Self.waehleOrdner(titel: "Welcher Ordner ist dein Vault?", knopf: "Öffnen", start: home) else { return }
        if let breit = VaultAuswahl.breiterOrt(url, home: home) {
            ordnerHinweis = OrtsHinweis(text: breit.text(home: home), ort: url)
            return
        }
        var verlauf = true
        if !FileManager.default.fileExists(atPath: url.appendingPathComponent(".git").path) {
            let alert = NSAlert()
            alert.messageText = "Versionsverlauf einschalten?"
            alert.informativeText = "Dann merkt sich Kortex jede Änderung als Version und kann sie zurückholen. Deine Dateien bleiben, wie sie sind."
            alert.addButton(withTitle: "Einschalten")
            alert.addButton(withTitle: "Ohne Versionsverlauf")
            alert.addButton(withTitle: "Abbrechen")
            switch alert.runModal() {
            case .alertFirstButtonReturn: verlauf = true
            case .alertSecondButtonReturn: verlauf = false
            default: return
            }
        }
        tu { await $0.oeffneOrdner(pfad: url.path, versionsverlaufEinschalten: verlauf) }
    }

    /// Nach der Warnung „zu breit“: stattdessen einen neuen Vault als Unterordner des gewählten Ordners anlegen.
    func nimmUnterordnerStattdessen() {
        guard let h = ordnerHinweis else { return }
        eigenerOrt = h.ort
        ordnerHinweis = nil
        gewaehlt = .neu
    }

    /// Führt einen Weg des Willkommensbilds aus (Klick oder ⏎ auf der gewählten Zeile).
    func gehe(_ weg: Weg) {
        gewaehlt = weg
        switch weg {
        case .neu: ordnerHinweis = nil; legeNeuenVaultAn()
        case .oeffnen: oeffneVorhandenenOrdner()
        case .klonen:
            ordnerHinweis = nil
            bild = .klonen
            tu { await $0.ladeGitHubStand() }
        case .beispiel: ordnerHinweis = nil; legeBeispielAn()
        }
    }

    /// Pfeiltasten im Willkommensbild.
    func waehleNaechsten(_ schritt: Int) {
        let alle = Weg.allCases
        guard let i = alle.firstIndex(of: gewaehlt) else { return }
        gewaehlt = alle[(i + schritt + alle.count) % alle.count]
    }

    func holeVonGitHub() {
        let url = klonAdresse.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !url.isEmpty else { return }
        tu { await $0.klone(url: url) }
    }

    /// Öffnet eine Karte des Abschlussbilds. Die Probe läuft beim Öffnen von selbst.
    func oeffneKarte(_ k: Karte) {
        offeneKarte = k
        tu { await $0.ladeKarten() }
        if k == .probe { tu { await $0.starteProbe() } }
    }

    private static func waehleOrdner(titel: String, knopf: String, start: URL? = nil) -> URL? {
        let p = NSOpenPanel()
        p.canChooseDirectories = true
        p.canChooseFiles = false
        p.allowsMultipleSelection = false
        p.canCreateDirectories = true
        p.message = titel
        p.prompt = knopf
        if let start { p.directoryURL = start }
        NSApp.activate()
        return p.runModal() == .OK ? p.url : nil
    }

    // MARK: Kopieren

    /// Kopiert den Code und öffnet GitHub — aber nur auf github.com über https (die Adresse kommt aus der Werkstatt, nie ungeprüft).
    func kopiereCodeUndOeffneGitHub(_ c: GitHubGeraetecode) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(c.code, forType: .string)
        if let u = URL(string: c.url), u.scheme == "https", u.host == "github.com" { NSWorkspace.shared.open(u) }
    }

    func kopiere(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }

    /// „Konfiguration kopieren“: der Eintrag für andere KI-Programme (JSON) in die Zwischenablage. Die Werkstatt liefert ihn mit den
    /// Pfaden dieser Installation; ein Fehler steht in `anzeige.konfiguration`.
    func kopiereKonfiguration(fuer ziel: KiZiel? = nil) {
        let a = ablauf!
        aufgaben.append(Task {
            guard let text = await a.holeKonfiguration(fuer: ziel) else { return }
            kopiere(text)
            if let ziel { kopiertesZiel = ziel } else { konfigurationKopiert = true }
            try? await Task.sleep(for: .seconds(2.5))
            if ziel != nil { kopiertesZiel = nil } else { konfigurationKopiert = false }
        })
    }
}

// MARK: - Rahmen

/// Kurze, verständliche Namen für die Karten und Meldungen (die Fachnamen stehen nur im Code).
extension EinrichtungsSchritt {
    var anzeigeName: String {
        switch self {
        case .git: return "Werkzeug"
        case .vault: return "Vault"
        case .github: return "GitHub"
        case .sicherung: return "Sicherung"
        case .ki: return "KI"
        case .probe: return "Probe"
        }
    }
}

/// Das Fenster des Assistenten. Es gibt nur zwei Bilder, die der Nutzer wirklich entscheiden muss:
/// 1. Willkommen — drei Wege plus „Erst mal ausprobieren“ (git prüft Kortex von selbst; nur wenn es fehlt, erscheint ein eigenes Bild),
/// 2. Fertig — mit freiwilligen Karten (KI verbinden, bei GitHub sichern, Probe), die man auch später nachholen kann.
/// Keine Fortschrittsleiste, keine Pflichtschritte nach dem Vault.
struct EinrichtungsAssistentAnsicht: View {
    @ObservedObject var modell: EinrichtungsModell

    /// Fensterbreite und -höhe des Inhalts (ohne Vorschau-Band).
    static let breite: CGFloat = 540
    static let hoehe: CGFloat = 560

    var body: some View {
        VStack(spacing: 0) {
            if modell.vorschau != nil { VorschauBandAnsicht() }
            ScrollView {
                inhalt
                    .frame(maxWidth: 460)
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 40)
                    .padding(.top, 36)
                    .padding(.bottom, 20)
            }
            .scrollBounceBehavior(.basedOnSize)
            .frame(maxHeight: .infinity)
            Divider()
            Fuss(modell: modell)
        }
        .frame(width: Self.breite, height: modell.vorschau == nil ? Self.hoehe : Self.hoehe + 22)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    @ViewBuilder private var inhalt: some View {
        if !modell.zustand.grundeingerichtet {
            if modell.anzeige.git?.istVorhanden == true {
                switch modell.bild {
                case .willkommen: WillkommenAnsicht(modell: modell)
                case .klonen: KlonAnsicht(modell: modell)
                }
            } else {
                GitAnsicht(modell: modell)
                if let f = modell.zustand.fehler[.git] { FehlerBox(text: f) }
            }
        } else if let k = modell.offeneKarte {
            KartenAnsicht(karte: k, modell: modell)
        } else {
            FertigAnsicht(modell: modell)
        }
    }
}

/// Fußleiste: links leise Wege, rechts höchstens ein Hauptknopf.
private struct Fuss: View {
    @ObservedObject var modell: EinrichtungsModell

    var body: some View {
        if modell.zustand.grundeingerichtet {
            if modell.offeneKarte != nil {
                Fussleiste {
                    Button("Zurück") { modell.offeneKarte = nil }
                        .buttonStyle(.kortexLink).keyboardShortcut(.cancelAction)
                        .help("Zurück zur Übersicht (Esc)")
                } haupt: {
                    Button("Fertig") { modell.offeneKarte = nil }.buttonStyle(.kortexHaupt).controlSize(.large)
                }
            } else {
                Fussleiste {
                    Text("Den Rest später: Menü „Kortex einrichten …“").font(.caption).foregroundStyle(.secondary)
                } haupt: {
                    Button("Studio öffnen") { modell.beiStudioOeffnen() }
                        .buttonStyle(.kortexHaupt).controlSize(.large).keyboardShortcut(.defaultAction)
                }
            }
        } else if modell.anzeige.git?.istVorhanden == true, modell.bild == .klonen {
            Fussleiste {
                Button("Zurück") { modell.bild = .willkommen }.buttonStyle(.kortexLink).keyboardShortcut(.cancelAction)
                    .disabled(modell.anzeige.vaultArbeitet != nil)
            } haupt: {
                Button("Holen") { modell.holeVonGitHub() }
                    .buttonStyle(.kortexHaupt).controlSize(.large).keyboardShortcut(.defaultAction)
                    .disabled(modell.anzeige.vaultArbeitet != nil || modell.klonAdresse.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        } else {
            Fussleiste {
                Button("Später") { modell.ablauf.spaeter(); modell.beiSchliessen() }
                    .buttonStyle(.kortexLink)
                    .help("Der Assistent erscheint nicht mehr von selbst. Du findest ihn im Menü unter „Kortex einrichten …“.")
            } haupt: {
                if modell.anzeige.git?.istVorhanden == true {
                    Text("↑ ↓ wählen   ⏎ öffnen").font(.caption).foregroundStyle(.secondary).accessibilityHidden(true)
                }
            }
        }
    }
}
