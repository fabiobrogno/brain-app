import AppKit
import SwiftUI
import BrainCore

/// Brücke zwischen dem Ablauf (BrainCore) und SwiftUI. Hält die Eingaben des Nutzers (Name, Adresse, Ordner) und startet die
/// Aktionen des Ablaufs als Aufgaben, die beim Schließen des Fensters abgebrochen werden.
@MainActor
final class EinrichtungsModell: ObservableObject {
    enum Weg: Equatable { case neu, klonen }
    /// Schritt „Sicherung“: neues privates Repository anlegen oder ein vorhandenes wählen.
    enum SicherungsWeg: Equatable { case neu, vorhanden }

    @Published private(set) var zustand = EinrichtungsZustand()
    @Published private(set) var anzeige = EinrichtungsAnzeige()
    @Published var weg: Weg?
    @Published var name = "Brain"
    @Published var klonAdresse = ""
    @Published var eigenerOrdner: URL?
    @Published var sicherungsWeg: SicherungsWeg? = .neu
    /// Name für das neue Repository; leer = noch nicht vorbelegt (Vorschlag aus dem Namen des Brains).
    @Published var repoName = ""
    @Published var repoSuche = ""

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

    /// Startet eine Aktion des Ablaufs; sie läuft weiter, auch wenn die Ansicht neu gezeichnet wird.
    func tu(_ aktion: @escaping @MainActor (EinrichtungsAblauf) async -> Void) {
        let a = ablauf!
        aufgaben.append(Task { await aktion(a) })
    }

    /// Belegt den Namen des neuen Repositories einmal aus dem Namen des Brains vor; der Nutzer kann ihn ändern.
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

    var ordnerText: String {
        guard let o = eigenerOrdner else { return "Brain im Benutzerordner" }
        return o.path.replacingOccurrences(of: vorschau?.home.path ?? NSHomeDirectory(), with: "~")
    }

    func waehleZielordner() {
        if let url = Self.waehleOrdner(titel: "Wo soll dein Brain liegen?", knopf: "Hier anlegen", start: vorschau?.home) { eigenerOrdner = url }
    }

    func oeffneVorhandenenOrdner() {
        guard let url = Self.waehleOrdner(titel: "Welcher Ordner ist dein Brain?", knopf: "Öffnen", start: vorschau?.home) else { return }
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

    /// Kopiert den Code und öffnet GitHub — aber nur auf github.com über https (die Adresse kommt aus der Werkstatt, nie ungeprüft).
    func kopiereCodeUndOeffneGitHub(_ c: GitHubGeraetecode) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(c.code, forType: .string)
        if let u = URL(string: c.url), u.scheme == "https", u.host == "github.com" { NSWorkspace.shared.open(u) }
    }
}

// MARK: - Ansicht

struct EinrichtungsAssistentAnsicht: View {
    @ObservedObject var modell: EinrichtungsModell

    var body: some View {
        VStack(spacing: 0) {
            if modell.vorschau != nil { VorschauBandAnsicht() }
            Kopf(zustand: modell.zustand)
            Divider()
            Group {
                if let s = modell.aktuell {
                    SchrittAnsicht(schritt: s, modell: modell)
                } else {
                    FertigAnsicht(modell: modell)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(.horizontal, 36)
            .padding(.vertical, 20)
            Divider()
            Fuss(modell: modell)
        }
        .frame(width: 580, height: modell.vorschau == nil ? 560 : 582)
    }
}

/// Fortschritt: ein Punkt je Schritt, Form und Text — nicht nur Farbe.
private struct Kopf: View {
    let zustand: EinrichtungsZustand

    var body: some View {
        HStack(spacing: 18) {
            ForEach(EinrichtungsSchritt.allCases, id: \.self) { s in
                let stand = zustand.stand(s)
                let dran = zustand.aktuell == s
                HStack(spacing: 5) {
                    Image(systemName: stand == .erledigt ? "checkmark.circle.fill" : stand == .uebersprungen ? "minus.circle" : dran ? "circle.inset.filled" : "circle")
                        .foregroundStyle(stand == .erledigt ? Color.green : dran ? Color.accentColor : Color.secondary)
                    Text(s.titel).font(.callout).fontWeight(dran ? .semibold : .regular)
                        .foregroundStyle(dran ? Color.primary : Color.secondary)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(s.titel), \(stand == .erledigt ? "erledigt" : stand == .uebersprungen ? "übersprungen" : dran ? "jetzt" : "später")")
            }
        }
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity)
    }
}

private struct Fuss: View {
    @ObservedObject var modell: EinrichtungsModell

    var body: some View {
        HStack {
            if modell.zustand.vorherigerSchritt != nil {
                Button("Zurück") { modell.tu { await $0.zurueck() } }
            }
            if !modell.istFertig {
                Button("Später") { modell.ablauf.spaeter(); modell.beiSchliessen() }
                    .help("Der Assistent erscheint nicht mehr von selbst. Du findest ihn im Menü unter „Kortex einrichten …“.")
            }
            Spacer()
            if let s = modell.aktuell {
                if s.darfUebersprungenWerden && !(s == .sicherung && modell.kannWeiter(s)) {
                    Button(s == .sicherung ? "Später sichern" : "Überspringen") { modell.tu { await $0.ueberspringe() } }
                        .help(s == .sicherung ? "Du kannst die Sicherung jederzeit im Menü unter „Kortex einrichten …“ nachholen." : "")
                }
                if modell.kannWeiter(s) {
                    Button("Weiter") { modell.tu { await $0.weiter() } }.keyboardShortcut(.defaultAction)
                }
            }
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 12)
    }
}

// MARK: Bausteine

private struct Titel: View {
    let symbol: String
    let titel: String
    let text: String?

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: symbol).font(.system(size: 38)).foregroundStyle(Color.accentColor).accessibilityHidden(true)
            Text(titel).font(.title2.bold()).multilineTextAlignment(.center)
            if let text { Text(text).foregroundStyle(.secondary).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true) }
        }
    }
}

private struct FehlerBox: View {
    let text: String

    var body: some View {
        Label(text, systemImage: "exclamationmark.triangle.fill")
            .foregroundStyle(.red)
            .fixedSize(horizontal: false, vertical: true)
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
            .accessibilityLabel("Fehler: \(text)")
    }
}

private struct Arbeit: View {
    let text: String

    var body: some View {
        HStack(spacing: 10) { ProgressView().controlSize(.small); Text(text).foregroundStyle(.secondary) }
    }
}

private struct GrosserKnopf: View {
    let titel: String
    let aktion: () -> Void
    var haupt = true

    var body: some View {
        if haupt {
            Button(action: aktion) { Text(titel).frame(minWidth: 220) }.buttonStyle(.borderedProminent).controlSize(.large)
        } else {
            Button(action: aktion) { Text(titel).frame(minWidth: 220) }.controlSize(.large)
        }
    }
}

// MARK: Schritte

private struct SchrittAnsicht: View {
    let schritt: EinrichtungsSchritt
    @ObservedObject var modell: EinrichtungsModell

    var body: some View {
        VStack(spacing: 16) {
            switch schritt {
            case .git: GitAnsicht(modell: modell)
            case .vault: VaultAnsicht(modell: modell)
            case .github: GitHubAnsicht(modell: modell)
            case .sicherung: ScrollView { SicherungAnsicht(modell: modell) } // Auswahl samt Repository-Liste kann höher sein als das Fenster
            case .ki: ScrollView { KiAnsicht(modell: modell) } // drei Ziele samt Fehlertexten können mehr Platz brauchen als das Fenster
            case .probe: ProbeAnsicht(modell: modell)
            }
            if let f = modell.zustand.fehler[schritt] { FehlerBox(text: f) }
        }
    }
}

private struct GitAnsicht: View {
    @ObservedObject var modell: EinrichtungsModell

    var body: some View {
        switch modell.anzeige.git {
        case nil:
            Titel(symbol: "wrench.and.screwdriver", titel: "git wird geprüft …", text: nil)
            Arbeit(text: "Einen Moment")
        case .vorhanden(_, let version):
            Titel(symbol: "checkmark.seal", titel: "git ist bereit", text: "Version \(version)")
        case .fehlt:
            Titel(symbol: "wrench.and.screwdriver", titel: "Apples Werkzeuge installieren",
                  text: "Kortex speichert jede Änderung als Version. Dafür braucht dein Mac git — Apple liefert es kostenlos. Das dauert ein paar Minuten.")
            GrosserKnopf(titel: "Installieren") { modell.tu { await $0.installiereGit() } }
        case .installiertGerade:
            Titel(symbol: "arrow.down.circle", titel: "Apple installiert gerade …",
                  text: "Klicke im Fenster von Apple auf „Installieren“ und warte, bis es fertig ist. Hier geht es dann von selbst weiter.")
            Arbeit(text: "Warte auf die Installation")
            // Der Ablauf wartet bereits von selbst; der Knopf prüft nur sofort nach und schließt sich der laufenden Wartezeit an.
            Button("Erneut prüfen") { modell.tu { await $0.pruefeGit() } }.disabled(modell.anzeige.gitPrueftGerade)
        case .defekt, .nichtPruefbar:
            Titel(symbol: "wrench.and.screwdriver", titel: "git ist noch nicht bereit", text: nil)
            Button("Erneut prüfen") { modell.tu { await $0.pruefeGit() } }.disabled(modell.anzeige.gitPrueftGerade)
        }
    }
}

private struct VaultAnsicht: View {
    @ObservedObject var modell: EinrichtungsModell

    var body: some View {
        VStack(spacing: 14) {
            Titel(symbol: "folder", titel: "Wo wohnen deine Notizen?", text: nil)
            if let arbeit = modell.anzeige.vaultArbeitet {
                Arbeit(text: arbeit).padding(.top, 20)
            } else {
                Karte(symbol: "sparkles", titel: "Neues Brain anlegen", text: "Mit Vorlage und Beispielseiten — der einfachste Start.",
                      offen: modell.weg == .neu) { modell.weg = .neu } inhalt: {
                    HStack {
                        TextField("Name", text: $modell.name).textFieldStyle(.roundedBorder)
                        Button("Anlegen") {
                            let n = modell.name.trimmingCharacters(in: .whitespaces)
                            let o = modell.eigenerOrdner?.path
                            modell.tu { await $0.legeVaultAn(name: n.isEmpty ? nil : n, ordner: o) }
                        }.keyboardShortcut(.defaultAction)
                    }
                    HStack(spacing: 4) {
                        Text("Ort: \(modell.ordnerText)").font(.callout).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                        Button("Ändern …") { modell.waehleZielordner() }.buttonStyle(.link)
                    }
                }
                Karte(symbol: "folder.badge.plus", titel: "Vorhandenen Ordner öffnen", text: "Deine Notizen bleiben, wo sie sind.", offen: false) {
                    modell.weg = nil
                    modell.oeffneVorhandenenOrdner()
                } inhalt: { EmptyView() }
                Karte(symbol: "arrow.down.circle", titel: "Von GitHub klonen", text: "Dein Brain von einem anderen Mac oder aus einem Repository.",
                      offen: modell.weg == .klonen) {
                    modell.weg = .klonen
                    modell.tu { await $0.ladeGitHubStand() }
                } inhalt: {
                    HStack {
                        TextField("https://github.com/…", text: $modell.klonAdresse).textFieldStyle(.roundedBorder)
                        Button("Klonen") {
                            let url = modell.klonAdresse.trimmingCharacters(in: .whitespacesAndNewlines)
                            modell.tu { await $0.klone(url: url) }
                        }.disabled(modell.klonAdresse.trimmingCharacters(in: .whitespaces).isEmpty).keyboardShortcut(.defaultAction)
                    }
                    KlonAnmeldung(modell: modell)
                }
            }
        }
    }
}

/// Unter der Klon-Adresse: private Repositories brauchen die GitHub-Anmeldung — gleich hier, ohne Umweg.
private struct KlonAnmeldung: View {
    @ObservedObject var modell: EinrichtungsModell

    var body: some View {
        switch modell.anzeige.github {
        case .abgemeldet, .abgelaufen, .abgelehnt:
            HStack(spacing: 4) {
                Text("Privates Repository?").font(.callout).foregroundStyle(.secondary)
                Button("Bei GitHub anmelden") { modell.tu { await $0.meldeBeiGitHubAn() } }.buttonStyle(.link)
            }
        case .startet:
            Arbeit(text: "GitHub wird gefragt …")
        case .wartet(let c):
            GitHubCode(modell: modell, code: c, kompakt: true)
        case .angemeldet(let login):
            Label(login.map { "Bei GitHub angemeldet als \($0)" } ?? "Bei GitHub angemeldet", systemImage: "checkmark.circle.fill")
                .font(.callout).foregroundStyle(.green)
        case .unbekannt, .nichtVerfuegbar:
            EmptyView()
        }
    }
}

private struct Karte<Inhalt: View>: View {
    let symbol: String
    let titel: String
    let text: String
    let offen: Bool
    let aktion: () -> Void
    @ViewBuilder let inhalt: Inhalt

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button(action: aktion) {
                HStack(spacing: 12) {
                    Image(systemName: symbol).font(.title2).frame(width: 32).foregroundStyle(Color.accentColor).accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(titel).font(.headline)
                        Text(text).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if offen { inhalt }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(offen ? 0.7 : 0.35), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(offen ? Color.accentColor : Color.clear, lineWidth: 1.5))
    }
}

private struct GitHubCode: View {
    @ObservedObject var modell: EinrichtungsModell
    let code: GitHubGeraetecode
    var kompakt = false

    var body: some View {
        VStack(spacing: 10) {
            Text(code.code)
                .font(.system(size: kompakt ? 24 : 38, weight: .semibold, design: .monospaced))
                .textSelection(.enabled)
                .accessibilityLabel("Code: \(code.code)")
            Button("Code kopieren und GitHub öffnen") { modell.kopiereCodeUndOeffneGitHub(code) }
                .buttonStyle(.borderedProminent).controlSize(kompakt ? .regular : .large)
            Arbeit(text: "Warte auf deine Bestätigung bei GitHub …")
            Button("Abbrechen") { modell.tu { await $0.brecheGitHubAb() } }.buttonStyle(.link)
        }
        .frame(maxWidth: .infinity)
    }
}

private struct GitHubAnsicht: View {
    @ObservedObject var modell: EinrichtungsModell

    var body: some View {
        switch modell.anzeige.github {
        case .unbekannt, .startet:
            Titel(symbol: "person.badge.key", titel: "GitHub", text: nil)
            Arbeit(text: "Einen Moment")
        case .nichtVerfuegbar:
            Titel(symbol: "person.badge.key", titel: "GitHub", text: "Die Anmeldung ist in dieser Version nicht eingerichtet.")
        case .abgemeldet, .abgelaufen, .abgelehnt:
            Titel(symbol: "person.badge.key", titel: "Bei GitHub anmelden",
                  text: "Für die Sicherung deines Brains und für private Repositories. Du bekommst einen Code, den du auf github.com eingibst — Kortex speichert nur ein Zugangszeichen im Schlüsselbund deines Macs, kein Passwort.")
            if case .abgelaufen = modell.anzeige.github { FehlerBox(text: "Der Code ist abgelaufen. Bitte noch einmal anmelden.") }
            if case .abgelehnt(let g) = modell.anzeige.github {
                FehlerBox(text: g == "schluesselbund" ? "Das Zugangszeichen ließ sich nicht im Schlüsselbund speichern." : "GitHub hat die Anmeldung abgelehnt.")
            }
            GrosserKnopf(titel: "Bei GitHub anmelden") { modell.tu { await $0.meldeBeiGitHubAn() } }
        case .wartet(let c):
            Titel(symbol: "person.badge.key", titel: "Gib diesen Code bei GitHub ein", text: nil)
            GitHubCode(modell: modell, code: c)
        case .angemeldet(let login):
            Titel(symbol: "checkmark.seal", titel: "Bei GitHub angemeldet", text: login.map { "Konto: \($0)" })
        }
    }
}

private struct SicherungAnsicht: View {
    @ObservedObject var modell: EinrichtungsModell

    private var s: SicherungAnzeige { modell.anzeige.sicherung }

    var body: some View {
        VStack(spacing: 14) {
            if s.istVerbunden {
                erfolg
            } else if let arbeit = s.arbeitet {
                Titel(symbol: "lock.shield", titel: "Dein Brain wird gesichert", text: nil)
                Arbeit(text: arbeit).padding(.top, 10)
            } else if let konflikt = s.konflikt {
                konfliktAnsicht(konflikt)
            } else if let grund = s.blockiert {
                Titel(symbol: "lock.trianglebadge.exclamationmark", titel: "Dein Brain lässt sich gerade nicht sichern", text: grund)
                Button("Erneut prüfen") { modell.tu { await $0.pruefeSicherungNeu() } }
                Text("Oder überspringe den Schritt — du kannst ihn im Menü „Kortex einrichten …“ nachholen.").font(.callout).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
            } else {
                switch modell.anzeige.github {
                case .angemeldet: auswahl
                case .unbekannt, .startet:
                    Titel(symbol: "lock.shield", titel: "Dein Brain sichern", text: nil)
                    Arbeit(text: "Einen Moment")
                case .wartet(let c):
                    Titel(symbol: "person.badge.key", titel: "Gib diesen Code bei GitHub ein", text: nil)
                    GitHubCode(modell: modell, code: c)
                case .abgemeldet, .abgelaufen, .abgelehnt, .nichtVerfuegbar:
                    Titel(symbol: "lock.shield", titel: "Dein Brain sichern",
                          text: "Dafür brauchst du ein GitHub-Konto. Melde dich an — Kortex speichert nur ein Zugangszeichen im Schlüsselbund deines Macs, kein Passwort.")
                    GrosserKnopf(titel: "Bei GitHub anmelden") { modell.tu { await $0.meldeBeiGitHubAn() } }
                }
            }
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder private var erfolg: some View {
        switch s.ergebnis {
        case .gesendet?:
            Titel(symbol: "checkmark.shield.fill", titel: "Dein Brain ist gesichert",
                  text: "Alles liegt jetzt in deinem privaten Repository \(s.verbundenMit ?? "bei GitHub"). Nur du hast Zugriff.")
        case .geholt?:
            Titel(symbol: "checkmark.shield.fill", titel: "Dein Brain ist verbunden",
                  text: "Das Repository \(s.verbundenMit ?? "bei GitHub") war weiter als dein Brain. Der neuere Stand wurde übernommen — es wurde nichts überschrieben.")
        case .verbunden?:
            Titel(symbol: "checkmark.shield.fill", titel: "Dein Brain ist verbunden",
                  text: "Mit dem privaten Repository \(s.verbundenMit ?? "bei GitHub"). Gesendet wird, sobald es die erste gespeicherte Version gibt.")
        case nil:
            Titel(symbol: "checkmark.shield.fill", titel: "Die Sicherung steht schon",
                  text: "Dein Brain ist bereits mit einem Server verbunden. Daran ändert Kortex nichts.")
        }
    }

    private func konfliktAnsicht(_ text: String) -> some View {
        VStack(spacing: 14) {
            Titel(symbol: "exclamationmark.shield", titel: "Dieses Repository passt nicht zu deinem Brain", text: text)
            Text("Kortex hat nichts gesendet und nichts überschrieben.").font(.callout).foregroundStyle(.secondary)
            HStack {
                Button("Neues Repository anlegen") { modell.ablauf.schliesseKonfliktAb(); modell.sicherungsWeg = .neu }.buttonStyle(.borderedProminent)
                Button("Anderes wählen") { modell.ablauf.schliesseKonfliktAb(); modell.sicherungsWeg = .vorhanden }
            }
        }
    }

    private var auswahl: some View {
        VStack(spacing: 14) {
            Titel(symbol: "lock.shield", titel: "Dein Brain sichern",
                  text: "Kortex legt eine Kopie deines Brains in einem privaten Repository bei GitHub ab. Nur du hast Zugriff — und nichts geht verloren, wenn dein Mac ausfällt.")
            Karte(symbol: "plus.circle", titel: "Neues privates Repository anlegen", text: "Der einfachste Weg.", offen: modell.sicherungsWeg == .neu) {
                modell.sicherungsWeg = .neu
            } inhalt: { neuesRepo }
            Karte(symbol: "tray.full", titel: "Eigenes Repository wählen", text: "Eines deiner privaten Repositories bei GitHub.", offen: modell.sicherungsWeg == .vorhanden) {
                modell.sicherungsWeg = .vorhanden
                if case .nichtGeladen = s.repos { modell.tu { await $0.ladeRepos() } }
            } inhalt: { vorhandene }
        }
        .onAppear { modell.schlageRepoNamenVor() }
    }

    private var neuesRepo: some View {
        let fehler = modell.repoName.isEmpty ? nil : RepoName.fehler(modell.repoName)
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                TextField("Name des Repositories", text: $modell.repoName).textFieldStyle(.roundedBorder)
                Button("Anlegen und sichern") { let n = modell.repoName; modell.tu { await $0.sichereMitNeuemRepo(name: n) } }
                    .disabled(RepoName.fehler(modell.repoName) != nil).keyboardShortcut(.defaultAction)
            }
            if let vergeben = s.vergebenerName {
                Button("Das vorhandene Repository „\(vergeben)“ nehmen") { modell.tu { await $0.nimmGleichnamigesRepo() } }.buttonStyle(.link)
            }
            if let fehler {
                Text(fehler).font(.callout).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
            } else {
                Text("Es wird immer privat angelegt — niemand außer dir kann es sehen.").font(.callout).foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder private var vorhandene: some View {
        switch s.repos {
        case .nichtGeladen, .laedt:
            Arbeit(text: "Deine Repositories werden geladen …")
        case .fehler(let text):
            FehlerBox(text: text)
            Button("Noch einmal versuchen") { modell.tu { await $0.ladeRepos() } }
        case .geladen(let liste):
            if liste.repos.isEmpty {
                Text("Du hast noch kein privates Repository. Lege ein neues an.").font(.callout).foregroundStyle(.secondary)
            } else {
                let treffer = liste.repos.filter { modell.repoSuche.isEmpty || $0.vollerName.localizedCaseInsensitiveContains(modell.repoSuche) }
                if liste.repos.count > 6 { TextField("Suchen …", text: $modell.repoSuche).textFieldStyle(.roundedBorder) }
                VStack(spacing: 6) {
                    ForEach(treffer.prefix(50)) { repo in
                        HStack {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(repo.vollerName).font(.callout.weight(.medium)).lineLimit(1).truncationMode(.middle)
                                Text(repo.leer ? "leer" : "hat schon Inhalt — Kortex prüft, ob es zu deinem Brain passt")
                                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            }
                            Spacer(minLength: 8)
                            Button("Wählen") { modell.tu { await $0.sichereMitRepo(repo) } }
                        }
                    }
                    if treffer.count > 50 { Text("Weitere Treffer: Suche eingrenzen.").font(.caption).foregroundStyle(.secondary) }
                    if liste.gekuerzt { Text("Die Liste ist sehr lang und wurde gekürzt. Suche nach dem Namen.").font(.caption).foregroundStyle(.secondary) }
                }
            }
        }
    }
}

private struct KiAnsicht: View {
    @ObservedObject var modell: EinrichtungsModell

    var body: some View {
        VStack(spacing: 14) {
            Titel(symbol: "sparkles", titel: "Deine KI mit dem Brain verbinden",
                  text: "Danach kann deine KI in deinen Notizen nachschlagen — lokal, ohne dass Notizen die App verlassen.")
            if modell.anzeige.kiSuchtGerade && modell.anzeige.kis.isEmpty {
                Arbeit(text: "Suche KI-Apps auf diesem Mac …")
            }
            ForEach(modell.anzeige.kis, id: \.ziel) { z in KiReihe(modell: modell, zeile: z) }
            if let stand = modell.anzeige.verdrahtung.stand, stand.starterVorhanden {
                VerdrahtungsBlock(modell: modell, stand: stand)
            }
            if !modell.anzeige.kis.contains(where: { $0.status != .nichtGefunden }) && !modell.anzeige.kiSuchtGerade {
                Text("Keine unterstützte KI-App gefunden. Installiere sie und suche dann neu — oder überspringe diesen Schritt, du kannst ihn später im Menü wiederholen.")
                    .font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                Button("Neu suchen") { modell.tu { await $0.sucheKIsNeu() } }
            }
        }
    }
}

/// Zusätzliche Eintragungen, jede nur auf ausdrücklichen Klick und mit Rückweg: Hooks bei Claude Code, Prüfung auf Passwörter vor dem Speichern,
/// Hintergrunddienst. Die Texte sagen genau, was wo eingetragen wird.
private struct VerdrahtungsBlock: View {
    @ObservedObject var modell: EinrichtungsModell
    let stand: VerdrahtungsStand

    private var anzeige: VerdrahtungsAnzeige { modell.anzeige.verdrahtung }
    private var claudeDa: Bool { modell.anzeige.kis.contains { $0.ziel == .claude && $0.status != .nichtGefunden } }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Zusätzlich, wenn du möchtest").font(.headline)
            if claudeDa {
                zeile(.claude, titel: "Claude Code: Kortex beim Arbeiten dabeihaben",
                      text: "Trägt in ~/.claude/settings.json kleine Helfer ein: Sie zeigen dir beim Fragen passende Notizen, schützen dein Wiki vor versehentlichen Änderungen "
                          + "und sichern den Arbeitsstand. Dazu kommen eine Statuszeile und einige Brain-Befehle. Alles, was dort schon steht, bleibt; vorher legt Kortex eine Sicherung an. "
                          + "Ausschalten nimmt genau das wieder heraus.")
            }
            if stand.gitMoeglich {
                zeile(.git, titel: "Vor jedem Commit nach Passwörtern und Schlüsseln suchen",
                      text: "Beim Speichern einer Version in deinem Brain prüft Kortex, ob Passwörter oder Schlüssel in den Notizen stehen, und hält das Speichern dann an. "
                          + "Eingetragen wird das nur in diesem Ordner (Einstellung core.hooksPath). Ausschalten entfernt es wieder.")
                if anzeige.gitFragtErsetzen {
                    Text("In diesem Ordner ist schon eine andere Prüfung vor dem Speichern eingetragen. Ersetzen? Dann wird sie durch die von Kortex abgelöst.").font(.callout)
                    HStack {
                        Button("Nicht ändern") { modell.ablauf.lehneGitErsetzenAb() }
                        Button("Ersetzen") { modell.tu { await $0.schalte(.git, an: true, ersetzen: true) } }.buttonStyle(.borderedProminent)
                    }
                }
            }
            if stand.dienstVerfuegbar {
                zeile(.dienst, titel: "Kortex darf im Hintergrund aufräumen",
                      text: "Richtet einen Dienst auf deinem Mac ein (Datei de.brain.tageslauf in ~/Library/LaunchAgents). Er pflegt dein Brain einmal am Tag, wenn der Mac am Netzteil hängt "
                          + "und ruht, und nutzt dafür dein Claude. Ausschalten löscht ihn wieder.")
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 10))
    }

    @ViewBuilder private func zeile(_ was: Verdrahtung, titel: String, text: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Toggle(titel, isOn: Binding(
                    get: { stand.aktiv(was) },
                    set: { neu in modell.tu { await $0.schalte(was, an: neu) } }))
                    .disabled(anzeige.arbeitet != nil)
                if anzeige.arbeitet == was { ProgressView().controlSize(.small) }
            }
            Text(text).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if let f = anzeige.fehler[was] { FehlerBox(text: f) }
        }
    }
}

private struct KiReihe: View {
    @ObservedObject var modell: EinrichtungsModell
    let zeile: KiZeile

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                VStack(alignment: .leading) {
                    Text(zeile.ziel.name).font(.headline)
                    Text(zeile.programm?.version.map { "Version \($0)" } ?? (zeile.status == .nichtGefunden ? "nicht gefunden" : ""))
                        .font(.callout).foregroundStyle(.secondary)
                }
                Spacer()
                aktion
            }
            switch zeile.status {
            case .umstellenFragen:
                Text("Bei \(zeile.ziel.name) gibt es schon einen Eintrag „brain“, der woanders hinzeigt. Auf dieses Brain umstellen?").font(.callout)
                HStack {
                    Button("Nicht ändern") { modell.ablauf.lehneUmstellenAb(zeile.ziel) }
                    Button("Umstellen") { modell.tu { await $0.verbinde(zeile.ziel, umstellen: true) } }.buttonStyle(.borderedProminent)
                }
            case .fehler(let meldung, let befehl):
                FehlerBox(text: meldung)
                if let befehl {
                    Text(zeile.ziel.kopierHinweis).font(.callout).foregroundStyle(.secondary)
                    HStack {
                        Text(befehl).font(.system(.callout, design: .monospaced)).textSelection(.enabled).lineLimit(3)
                        Button("Kopieren") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(befehl, forType: .string) }
                    }
                }
            case .verbunden:
                Text("Eingetragen. Starte \(zeile.ziel.name) neu, dann ist dein Brain dabei.").font(.callout).foregroundStyle(.secondary)
            case .nichtGefunden, .bereit, .verbindet:
                EmptyView()
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 10))
    }

    @ViewBuilder private var aktion: some View {
        switch zeile.status {
        case .bereit, .fehler:
            Button("Verbinden") { modell.tu { await $0.verbinde(zeile.ziel) } }.buttonStyle(.borderedProminent)
        case .verbindet:
            ProgressView().controlSize(.small)
        case .verbunden:
            Label("Verbunden", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
        case .nichtGefunden, .umstellenFragen:
            EmptyView()
        }
    }
}

private struct ProbeAnsicht: View {
    @ObservedObject var modell: EinrichtungsModell

    var body: some View {
        switch modell.anzeige.probe {
        case .offen, .laeuft:
            Titel(symbol: "magnifyingglass", titel: "Probe", text: "Kortex fragt dein Brain auf demselben Weg, den deine KI nimmt.")
            Arbeit(text: "Suche läuft …")
        case .ok(let e):
            ProbeErfolg(treffer: e.treffer)
        case .leer:
            ProbeErfolg(treffer: [])
        case .fehler:
            Titel(symbol: "magnifyingglass", titel: "Die Probe hat nicht geklappt", text: "Die Verbindung zu deinem Brain antwortet nicht so, wie sie soll.")
            GrosserKnopf(titel: "Noch einmal versuchen") { modell.tu { await $0.starteProbe() } }
        }
    }
}

private struct ProbeErfolg: View {
    let treffer: [String]

    var body: some View {
        VStack(spacing: 10) {
            Titel(symbol: "checkmark.seal.fill", titel: "Es funktioniert",
                  text: treffer.isEmpty ? "Die Suche antwortet. Dein Brain ist noch leer — das füllt sich beim Arbeiten." : "Die Suche in deinem Brain liefert:")
            ForEach(treffer.prefix(3), id: \.self) { t in Label(t, systemImage: "doc.text").lineLimit(1) }
        }
    }
}

private struct FertigAnsicht: View {
    @ObservedObject var modell: EinrichtungsModell

    var body: some View {
        VStack(spacing: 18) {
            switch modell.anzeige.probe {
            case .ok(let e): ProbeErfolg(treffer: e.treffer)
            case .leer: ProbeErfolg(treffer: [])
            default: Titel(symbol: "checkmark.seal.fill", titel: "Kortex ist eingerichtet", text: nil)
            }
            VStack(alignment: .leading, spacing: 6) {
                ForEach(EinrichtungsSchritt.allCases, id: \.self) { s in
                    let stand = modell.zustand.stand(s)
                    Label("\(s.titel): \(stand == .erledigt ? "fertig" : "übersprungen — im Menü „Kortex einrichten …“ nachholen")",
                          systemImage: stand == .erledigt ? "checkmark.circle.fill" : "minus.circle")
                        .foregroundStyle(stand == .erledigt ? Color.primary : Color.secondary)
                        .font(.callout)
                }
            }
            GrosserKnopf(titel: "Studio öffnen") { modell.beiStudioOeffnen() }
        }
    }
}
