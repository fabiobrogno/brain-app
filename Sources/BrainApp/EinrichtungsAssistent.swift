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
    enum Weg: Equatable { case neu, beispiel, klonen }
    /// Schritt „Sicherung“: neues privates Repository anlegen oder ein vorhandenes wählen.
    enum SicherungsWeg: Equatable { case neu, vorhanden }

    @Published private(set) var zustand = EinrichtungsZustand()
    @Published private(set) var anzeige = EinrichtungsAnzeige()
    @Published var weg: Weg? = .neu
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
        }
    }

    var aktuell: EinrichtungsSchritt? { zustand.aktuell }
    var istFertig: Bool { zustand.istFertig }
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
        weg = .neu
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

/// Kurze, verständliche Namen für die Fortschrittsanzeige (die Fachnamen stehen nur im Code).
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

struct EinrichtungsAssistentAnsicht: View {
    @ObservedObject var modell: EinrichtungsModell

    /// Fensterbreite und -höhe des Inhalts (ohne Vorschau-Band): Platz für die Repository-Liste und drei KI-Zeilen ohne Scrollen bei kurzen Texten.
    static let breite: CGFloat = 640
    static let hoehe: CGFloat = 680

    var body: some View {
        VStack(spacing: 0) {
            if modell.vorschau != nil { VorschauBandAnsicht() }
            Fortschritt(zustand: modell.zustand)
            ScrollView {
                Group {
                    if let s = modell.aktuell {
                        SchrittAnsicht(schritt: s, modell: modell)
                    } else {
                        FertigAnsicht(modell: modell)
                    }
                }
                .frame(maxWidth: 480)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 40)
                .padding(.vertical, 18)
            }
            .scrollBounceBehavior(.basedOnSize)
            .frame(maxHeight: .infinity)
            Divider()
            Fuss(modell: modell)
        }
        .frame(width: Self.breite, height: modell.vorschau == nil ? Self.hoehe : Self.hoehe + 22)
        .background(Color(nsColor: .windowBackgroundColor))
    }
}

/// Fortschritt: ein Balken je Schritt (Form und Text, nicht nur Farbe) und darunter „Schritt 2 von 5 · Vault“.
/// Schritte, die hier entfallen (keine GitHub-Anmeldung in dieser Version, Ordner ohne Versionsverlauf), zählen nicht mit.
private struct Fortschritt: View {
    let zustand: EinrichtungsZustand

    private var sichtbar: [EinrichtungsSchritt] { EinrichtungsSchritt.allCases.filter { !zustand.uebergangen.contains($0) } }

    private var text: String {
        guard let s = zustand.aktuell, let i = sichtbar.firstIndex(of: s) else { return "Fertig" }
        return "Schritt \(i + 1) von \(sichtbar.count) · \(s.anzeigeName)"
    }

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 6) {
                ForEach(sichtbar, id: \.self) { s in
                    let stand = zustand.stand(s)
                    let dran = zustand.aktuell == s
                    Capsule()
                        .fill(stand == .erledigt ? Kortex.akzent : dran ? Kortex.akzent.opacity(0.55) : Color.primary.opacity(stand == .uebersprungen ? 0.22 : 0.1))
                        .frame(height: 4)
                }
            }
            Text(text).font(.callout).foregroundStyle(.secondary)
        }
        .padding(.horizontal, 40)
        .padding(.top, 16)
        .padding(.bottom, 2)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(text)
        .accessibilityValue(zustand.istFertig ? "alle Schritte erledigt" : "\(zustand.fortschritt.fertig) von \(zustand.fortschritt.gesamt) erledigt")
    }
}

private struct Fuss: View {
    @ObservedObject var modell: EinrichtungsModell

    var body: some View {
        HStack(spacing: 10) {
            if modell.zustand.vorherigerSchritt != nil {
                Button("Zurück") { modell.tu { await $0.zurueck() } }
                    .keyboardShortcut(.leftArrow, modifiers: .command)
                    .help("Zum vorigen Schritt (⌘←)")
            }
            if !modell.istFertig {
                Button("Später") { modell.ablauf.spaeter(); modell.beiSchliessen() }
                    .buttonStyle(.kortexLink)
                    .help("Der Assistent erscheint nicht mehr von selbst. Du findest ihn im Menü unter „Kortex einrichten …“.")
            }
            Spacer()
            if let s = modell.aktuell {
                if s.darfUebersprungenWerden && !(s == .sicherung && modell.kannWeiter(s)) {
                    Button(s == .sicherung ? "Später sichern" : "Überspringen") { modell.tu { await $0.ueberspringe() } }
                        .help(s == .sicherung ? "Du kannst die Sicherung jederzeit im Menü unter „Kortex einrichten …“ nachholen." : "Diesen Schritt auslassen. Du kannst ihn später im Menü „Kortex einrichten …“ nachholen.")
                }
                if modell.kannWeiter(s) {
                    Button("Weiter") { modell.tu { await $0.weiter() } }
                        .keyboardShortcut(.defaultAction)
                        .buttonStyle(.kortexHaupt)
                        .controlSize(.large)
                }
            }
        }
        .padding(.horizontal, 28)
        .padding(.vertical, 14)
    }
}
