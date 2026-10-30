import AppKit
import SwiftUI
import BrainCore

// Die Bilder des Assistenten „Kortex einrichten“, ein Bild je Schritt. Texte kurz, ohne Fachwörter; was Kortex wo einträgt, steht dabei.

struct SchrittAnsicht: View {
    let schritt: EinrichtungsSchritt
    @ObservedObject var modell: EinrichtungsModell

    var body: some View {
        VStack(spacing: AssistentMass.abstand + 2) {
            switch schritt {
            case .git: GitAnsicht(modell: modell)
            case .vault: VaultAnsicht(modell: modell)
            case .github: GitHubAnsicht(modell: modell)
            case .sicherung: SicherungAnsicht(modell: modell)
            case .ki: KiAnsicht(modell: modell)
            case .probe: ProbeAnsicht(modell: modell)
            }
            if let f = modell.zustand.fehler[schritt] { FehlerBox(text: f) }
        }
    }
}

// MARK: git

private struct GitAnsicht: View {
    @ObservedObject var modell: EinrichtungsModell

    var body: some View {
        switch modell.anzeige.git {
        case nil:
            Titel(symbol: "wrench.and.screwdriver", titel: "Einen Moment …", text: "Kortex prüft, ob dein Mac alles Nötige hat.")
            Arbeit(text: "Prüfe …")
        case .vorhanden(_, let version):
            Titel(symbol: "checkmark.seal", titel: "Dein Mac ist bereit", text: "Das Werkzeug für den Versionsverlauf (git \(version)) ist da.")
        case .fehlt:
            Titel(symbol: "wrench.and.screwdriver", titel: "Ein Werkzeug von Apple fehlt noch",
                  text: "Kortex merkt sich jede Änderung als Version. Dafür braucht dein Mac git — Apple liefert es kostenlos. Das dauert ein paar Minuten.")
            GrosserKnopf(titel: "Installieren") { modell.tu { await $0.installiereGit() } }
        case .installiertGerade:
            Titel(symbol: "arrow.down.circle", titel: "Apple installiert gerade …",
                  text: "Klicke im Fenster von Apple auf „Installieren“ und warte, bis es fertig ist. Hier geht es dann von selbst weiter.")
            Arbeit(text: "Warte auf die Installation")
            // Der Ablauf wartet bereits von selbst; der Knopf prüft nur sofort nach und schließt sich der laufenden Wartezeit an.
            Button("Erneut prüfen") { modell.tu { await $0.pruefeGit() } }.disabled(modell.anzeige.gitPrueftGerade)
        case .defekt, .nichtPruefbar:
            Titel(symbol: "wrench.and.screwdriver", titel: "git ist noch nicht bereit", text: "Prüfe, ob die Installation fertig ist, und versuche es noch einmal.")
            Button("Erneut prüfen") { modell.tu { await $0.pruefeGit() } }.controlSize(.large).disabled(modell.anzeige.gitPrueftGerade)
        }
    }
}

// MARK: Vault

private struct VaultAnsicht: View {
    @ObservedObject var modell: EinrichtungsModell
    @FocusState private var nameFokus: Bool

    var body: some View {
        VStack(spacing: AssistentMass.abstand) {
            Titel(symbol: "folder", titel: "Wo sollen deine Notizen liegen?",
                  text: "Ein Vault ist ein ganz normaler Ordner auf deinem Mac. Du behältst ihn und kannst ihn jederzeit selbst öffnen.")
            if let arbeit = modell.anzeige.vaultArbeitet {
                Arbeit(text: arbeit).padding(.top, 24)
            } else {
                neu
                beispiel
                Karte(symbol: "folder.badge.plus", titel: "Vorhandenen Ordner öffnen", text: "Deine Notizen bleiben, wo sie sind.", offen: false) {
                    modell.weg = nil
                    modell.oeffneVorhandenenOrdner()
                } inhalt: { EmptyView() }
                if let h = modell.ordnerHinweis { zuBreit(h) }
                klonen
            }
        }
        .onChange(of: modell.weg) { _, neu in if neu == .neu { nameFokus = true } }
    }

    private var neu: some View {
        Karte(symbol: "sparkles", titel: "Neuen Vault anlegen", text: "Mit Vorlage und ein paar Beispielseiten — der einfachste Start.",
              offen: modell.weg == .neu, empfohlen: true) { modell.weg = .neu } inhalt: {
            HStack {
                TextField("Name", text: $modell.name).textFieldStyle(.roundedBorder).focused($nameFokus)
                    .onSubmit { modell.legeNeuenVaultAn() }
                Button("Anlegen") { modell.legeNeuenVaultAn() }.buttonStyle(.kortexHaupt).keyboardShortcut(.defaultAction)
            }
            HStack(spacing: 6) {
                Image(systemName: "folder").foregroundStyle(.secondary).accessibilityHidden(true)
                Text(modell.ordnerText).font(.callout).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                Button("Ort ändern …") { modell.waehleZielordner() }.buttonStyle(.kortexLink).font(.callout)
            }
        }
    }

    private var beispiel: some View {
        Karte(symbol: "leaf", titel: "Erst mal ausprobieren", text: "Ein Beispiel-Vault zum Anschauen — ohne deine eigenen Notizen.",
              offen: modell.weg == .beispiel) { modell.weg = .beispiel } inhalt: {
            Text("Kortex legt den Vault „\(BeispielVault.name)“ mit ein paar Seiten an. Alles bleibt auf deinem Mac, es wird nichts gesendet. Eigene Notizen legst du später in einem eigenen Vault an; das Beispiel kannst du dann einfach löschen.")
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 6) {
                Image(systemName: "folder").foregroundStyle(.secondary).accessibilityHidden(true)
                Text(VaultAuswahl.kurz(BeispielVault.ordner(home: modell.home), home: modell.home))
                    .font(.callout).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                Spacer(minLength: 8)
                Button("Beispiel anlegen") { modell.legeBeispielAn() }.buttonStyle(.kortexHaupt).keyboardShortcut(.defaultAction)
            }
        }
    }

    private var klonen: some View {
        Karte(symbol: "arrow.down.circle", titel: "Von GitHub holen", text: "Dein Vault von einem anderen Mac oder aus einem Repository.",
              offen: modell.weg == .klonen) {
            modell.weg = .klonen
            modell.tu { await $0.ladeGitHubStand() }
        } inhalt: {
            HStack {
                TextField("https://github.com/…", text: $modell.klonAdresse).textFieldStyle(.roundedBorder)
                    .onSubmit { klone() }
                Button("Holen") { klone() }
                    .disabled(modell.klonAdresse.trimmingCharacters(in: .whitespaces).isEmpty).keyboardShortcut(.defaultAction)
            }
            KlonAnmeldung(modell: modell)
        }
    }

    private func klone() {
        let url = modell.klonAdresse.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !url.isEmpty else { return }
        modell.tu { await $0.klone(url: url) }
    }

    /// Der gewählte Ordner ist als Vault zu breit: erklären und einen Ausweg anbieten, statt nur abzulehnen.
    private func zuBreit(_ h: OrtsHinweis) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HinweisBox(text: h.text)
            HStack {
                Button("Dort einen neuen Vault anlegen") { modell.nimmUnterordnerStattdessen() }.buttonStyle(.kortexHaupt)
                Button("Anderen Ordner wählen …") { modell.oeffneVorhandenenOrdner() }
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
                Button("Bei GitHub anmelden") { modell.tu { await $0.meldeBeiGitHubAn() } }.buttonStyle(.kortexLink).font(.callout)
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

// MARK: GitHub

private struct GitHubCode: View {
    @ObservedObject var modell: EinrichtungsModell
    let code: GitHubGeraetecode
    var kompakt = false

    var body: some View {
        VStack(spacing: 12) {
            Text(code.code)
                .font(.system(size: kompakt ? 24 : 38, weight: .semibold, design: .monospaced))
                .textSelection(.enabled)
                .accessibilityLabel("Code: \(code.code)")
            Button("Code kopieren und GitHub öffnen") { modell.kopiereCodeUndOeffneGitHub(code) }
                .buttonStyle(.kortexHaupt).controlSize(kompakt ? .regular : .large).keyboardShortcut(.defaultAction)
            Arbeit(text: "Warte auf deine Bestätigung bei GitHub …")
            Button("Abbrechen") { modell.tu { await $0.brecheGitHubAb() } }.buttonStyle(.kortexLink)
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
            Arbeit(text: "Einen Moment …")
        case .nichtVerfuegbar:
            Titel(symbol: "person.badge.key", titel: "GitHub", text: "Die Anmeldung ist in dieser Version nicht eingerichtet.")
        case .abgemeldet, .abgelaufen, .abgelehnt:
            Titel(symbol: "person.badge.key", titel: "Bei GitHub anmelden",
                  text: "Für die Sicherung deines Vaults und für private Repositories. Du bekommst einen Code, den du auf github.com eingibst. Kortex speichert nur ein Zugangszeichen im Schlüsselbund deines Macs — kein Passwort.")
            if case .abgelaufen = modell.anzeige.github { FehlerBox(text: "Der Code ist abgelaufen. Bitte melde dich noch einmal an.") }
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

// MARK: Sicherung

private struct SicherungAnsicht: View {
    @ObservedObject var modell: EinrichtungsModell

    private var s: SicherungAnzeige { modell.anzeige.sicherung }

    var body: some View {
        VStack(spacing: AssistentMass.abstand) {
            if s.istVerbunden {
                erfolg
            } else if let arbeit = s.arbeitet {
                Titel(symbol: "lock.shield", titel: "Dein Vault wird gesichert", text: nil)
                Arbeit(text: arbeit).padding(.top, 8)
            } else if let konflikt = s.konflikt {
                konfliktAnsicht(konflikt)
            } else if let grund = s.blockiert {
                Titel(symbol: "lock.trianglebadge.exclamationmark", titel: "Dein Vault lässt sich gerade nicht sichern", text: grund)
                Button("Erneut prüfen") { modell.tu { await $0.pruefeSicherungNeu() } }.controlSize(.large)
                Text("Oder überspringe den Schritt — du kannst ihn im Menü „Kortex einrichten …“ nachholen.").font(.callout).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
            } else {
                switch modell.anzeige.github {
                case .angemeldet: auswahl
                case .unbekannt, .startet:
                    Titel(symbol: "lock.shield", titel: "Deinen Vault sichern", text: nil)
                    Arbeit(text: "Einen Moment …")
                case .wartet(let c):
                    Titel(symbol: "person.badge.key", titel: "Gib diesen Code bei GitHub ein", text: nil)
                    GitHubCode(modell: modell, code: c)
                case .abgemeldet, .abgelaufen, .abgelehnt, .nichtVerfuegbar:
                    Titel(symbol: "lock.shield", titel: "Deinen Vault sichern",
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
            Titel(symbol: "checkmark.shield.fill", titel: "Dein Vault ist gesichert",
                  text: "Alles liegt jetzt in deinem privaten Repository \(s.verbundenMit ?? "bei GitHub"). Nur du hast Zugriff.")
        case .geholt?:
            Titel(symbol: "checkmark.shield.fill", titel: "Dein Vault ist verbunden",
                  text: "Das Repository \(s.verbundenMit ?? "bei GitHub") war weiter als dein Vault. Der neuere Stand wurde übernommen — es wurde nichts überschrieben.")
        case .verbunden?:
            Titel(symbol: "checkmark.shield.fill", titel: "Dein Vault ist verbunden",
                  text: "Mit dem privaten Repository \(s.verbundenMit ?? "bei GitHub"). Gesendet wird, sobald es die erste gespeicherte Version gibt.")
        case nil:
            Titel(symbol: "checkmark.shield.fill", titel: "Die Sicherung steht schon",
                  text: "Dein Vault ist bereits mit einem Server verbunden. Daran ändert Kortex nichts.")
        }
    }

    private func konfliktAnsicht(_ text: String) -> some View {
        VStack(spacing: 14) {
            Titel(symbol: "exclamationmark.shield", titel: "Dieses Repository passt nicht zu deinem Vault", text: text)
            Text("Kortex hat nichts gesendet und nichts überschrieben.").font(.callout).foregroundStyle(.secondary)
            HStack {
                Button("Neues Repository anlegen") { modell.ablauf.schliesseKonfliktAb(); modell.sicherungsWeg = .neu }.buttonStyle(.kortexHaupt)
                Button("Anderes wählen") { modell.ablauf.schliesseKonfliktAb(); modell.sicherungsWeg = .vorhanden }
            }
        }
    }

    private var auswahl: some View {
        VStack(spacing: AssistentMass.abstand) {
            Titel(symbol: "lock.shield", titel: "Deinen Vault sichern",
                  text: "Kortex legt eine Kopie deines Vaults in einem privaten Repository bei GitHub ab. Nur du hast Zugriff — und nichts geht verloren, wenn dein Mac ausfällt.")
            Karte(symbol: "plus.circle", titel: "Neues privates Repository anlegen", text: "Der einfachste Weg.",
                  offen: modell.sicherungsWeg == .neu, empfohlen: true) {
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
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                TextField("Name des Repositories", text: $modell.repoName).textFieldStyle(.roundedBorder)
                    .onSubmit { anlegen() }
                Button("Anlegen und sichern") { anlegen() }
                    .buttonStyle(.kortexHaupt)
                    .disabled(RepoName.fehler(modell.repoName) != nil).keyboardShortcut(.defaultAction)
            }
            if let vergeben = s.vergebenerName {
                Button("Das vorhandene Repository „\(vergeben)“ nehmen") { modell.tu { await $0.nimmGleichnamigesRepo() } }.buttonStyle(.kortexLink)
            }
            if let fehler {
                Text(fehler).font(.callout).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
            } else {
                Text("Es wird immer privat angelegt — niemand außer dir kann es sehen.").font(.callout).foregroundStyle(.secondary)
            }
        }
    }

    private func anlegen() {
        guard RepoName.fehler(modell.repoName) == nil else { return }
        let n = modell.repoName
        modell.tu { await $0.sichereMitNeuemRepo(name: n) }
    }

    /// Die Liste scrollt für sich (höchstens ~7 Zeilen hoch), damit die Karten darüber und darunter nicht aus dem Fenster wandern.
    @ViewBuilder private var vorhandene: some View {
        switch s.repos {
        case .nichtGeladen, .laedt:
            Arbeit(text: "Deine Repositories werden geladen …")
        case .fehler(let text):
            FehlerBox(text: text) { modell.tu { await $0.ladeRepos() } }
        case .geladen(let liste):
            if liste.repos.isEmpty {
                Text("Du hast noch kein privates Repository. Lege ein neues an.").font(.callout).foregroundStyle(.secondary)
            } else {
                let treffer = liste.repos.filter { modell.repoSuche.isEmpty || $0.vollerName.localizedCaseInsensitiveContains(modell.repoSuche) }
                if liste.repos.count > 6 { TextField("Suchen …", text: $modell.repoSuche).textFieldStyle(.roundedBorder) }
                if treffer.isEmpty {
                    Text("Kein Repository passt zu „\(modell.repoSuche)“.").font(.callout).foregroundStyle(.secondary)
                }
                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(treffer.prefix(50)) { repo in
                            HStack {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(repo.vollerName).font(.callout.weight(.medium)).lineLimit(1).truncationMode(.middle)
                                    Text(repo.leer ? "leer" : "hat schon Inhalt — Kortex prüft, ob es zu deinem Vault passt")
                                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                }
                                Spacer(minLength: 8)
                                Button("Wählen") { modell.tu { await $0.sichereMitRepo(repo) } }
                            }
                            .padding(.vertical, 6)
                            Divider()
                        }
                    }
                }
                .frame(maxHeight: 240)
                .scrollBounceBehavior(.basedOnSize)
                if treffer.count > 50 { Text("Weitere Treffer: Suche eingrenzen.").font(.caption).foregroundStyle(.secondary) }
                if liste.gekuerzt { Text("Die Liste ist sehr lang und wurde gekürzt. Suche nach dem Namen.").font(.caption).foregroundStyle(.secondary) }
            }
        }
    }
}

// MARK: KI

private struct KiAnsicht: View {
    @ObservedObject var modell: EinrichtungsModell

    var body: some View {
        VStack(spacing: AssistentMass.abstand) {
            Titel(symbol: "sparkles", titel: "Deine KI mit Kortex verbinden",
                  text: "Danach kann deine KI in deinem Vault nachschlagen — lokal, nichts verlässt deinen Mac. Du kannst die Verbindung jederzeit wieder lösen.")
            if modell.anzeige.kiSuchtGerade && modell.anzeige.kis.isEmpty {
                Arbeit(text: "Suche KI-Programme auf diesem Mac …")
            }
            if let stand = modell.anzeige.verdrahtung.stand, stand.profile.count > 1,
               modell.anzeige.kis.contains(where: { $0.ziel == .claude && $0.status != .nichtGefunden }) {
                ProfilAuswahl(modell: modell, profile: stand.profile)
            }
            // Erkannte Programme zuerst; alles, was Kortex auf diesem Mac nicht gefunden hat, steht eingeklappt unter „Weitere“.
            VStack(spacing: 10) {
                ForEach(modell.anzeige.kis.filter { $0.status != .nichtGefunden }, id: \.ziel) { z in KiReihe(modell: modell, zeile: z) }
            }
            WeitereKis(modell: modell, zeilen: modell.anzeige.kis.filter { $0.status == .nichtGefunden })
            if !modell.anzeige.kis.contains(where: { $0.status != .nichtGefunden }) && !modell.anzeige.kiSuchtGerade {
                Text("Kortex hat hier kein unterstütztes KI-Programm gefunden. Installiere eines und suche dann neu — oder überspringe diesen Schritt, du kannst ihn später im Menü wiederholen.")
                    .font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                Button("Neu suchen") { modell.tu { await $0.sucheKIsNeu() } }.controlSize(.large)
            }
            AndereKi(modell: modell)
            if let stand = modell.anzeige.verdrahtung.stand, stand.starterVorhanden {
                VerdrahtungsBlock(modell: modell, stand: stand)
            }
        }
    }
}

/// Programme, die Kortex auf diesem Mac nicht gefunden hat: eingeklappt. Wer eines später installiert, wählt „Neu suchen“ oder kopiert die
/// Konfiguration für dieses Programm und fügt sie dort selbst ein.
private struct WeitereKis: View {
    @ObservedObject var modell: EinrichtungsModell
    let zeilen: [KiZeile]
    @State private var offen = false

    var body: some View {
        if !zeilen.isEmpty {
            DisclosureGroup(isExpanded: $offen) {
                VStack(spacing: 10) {
                    ForEach(zeilen, id: \.ziel) { z in KiReihe(modell: modell, zeile: z) }
                    Button("Neu suchen") { modell.tu { await $0.sucheKIsNeu() } }.controlSize(.small)
                }
                .padding(.top, 8)
            } label: {
                Text("Weitere Programme (\(zeilen.count))").font(.headline)
            }
            .accessibilityIdentifier("ki-weitere")
        }
    }
}

/// Für KI-Programme, die Kortex nicht selbst einrichten kann: die Konfiguration (JSON) in die Zwischenablage.
private struct AndereKi: View {
    @ObservedObject var modell: EinrichtungsModell

    var body: some View {
        Flaeche {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Ein anderes KI-Programm?").font(.headline)
                    Text("Kopiere die Konfiguration und füge sie in den MCP-Einstellungen deines Programms ein (Feld „mcpServers“).")
                        .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                if modell.anzeige.konfiguration == .holt {
                    ProgressView().controlSize(.small)
                } else if modell.konfigurationKopiert {
                    Label("Kopiert", systemImage: "checkmark").foregroundStyle(.green).fixedSize()
                } else {
                    Button("Konfiguration kopieren") { modell.kopiereKonfiguration() }.fixedSize()
                }
            }
            if case .fehler(let f) = modell.anzeige.konfiguration { FehlerBox(text: f) }
        }
    }
}

/// Mehrere Claude-Code-Profile (`~/.claude`, `~/.claude-privat` …): Kortex sucht sie selbst, weil die App aus dem Finder ohne `CLAUDE_CONFIG_DIR` startet.
/// Die Auswahl gilt für „Verbinden“ bei Claude Code und für die Hooks.
private struct ProfilAuswahl: View {
    @ObservedObject var modell: EinrichtungsModell
    let profile: [ClaudeProfil]

    var body: some View {
        Flaeche {
            Text("Welche Claude-Profile?").font(.headline)
            Text("Kortex trägt sich nur in die angekreuzten ein. Der Hintergrunddienst nutzt das zuerst gewählte.")
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            ForEach(profile, id: \.pfad) { p in
                Toggle(isOn: Binding(
                    get: { modell.anzeige.verdrahtung.auswahl.contains(p.pfad) },
                    set: { an in modell.ablauf.waehleProfil(p.pfad, gewaehlt: an) })) {
                    Text(p.anzeigeName + (p.standard ? " (Standard)" : "") + (p.aktiv ? " — Hooks eingetragen" : ""))
                }
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
        Flaeche {
            Text("Zusätzlich, wenn du möchtest").font(.headline)
            if claudeDa && !stand.profile.isEmpty {
                zeile(.claude, titel: "Claude Code: Kortex beim Arbeiten dabeihaben",
                      text: "Trägt in die gewählten Claude-Profile (Standard: ~/.claude/settings.json) kleine Helfer ein: Sie zeigen dir beim Fragen passende Notizen, schützen dein Wiki vor versehentlichen Änderungen "
                          + "und sichern den Arbeitsstand. Dazu kommen eine Statuszeile und einige Kortex-Befehle. Alles, was dort schon steht, bleibt; vorher legt Kortex eine Sicherung an. "
                          + "Ausschalten nimmt genau das wieder heraus.")
            }
            if stand.gitMoeglich {
                zeile(.git, titel: "Vor jedem Speichern nach Passwörtern und Schlüsseln suchen",
                      text: "Beim Speichern einer Version in deinem Vault prüft Kortex, ob Passwörter oder Schlüssel in den Notizen stehen, und hält das Speichern dann an. "
                          + "Eingetragen wird das nur in diesem Ordner (Einstellung core.hooksPath). Ausschalten entfernt es wieder.")
                if anzeige.gitFragtErsetzen {
                    Text("In diesem Ordner ist schon eine andere Prüfung vor dem Speichern eingetragen. Ersetzen? Dann wird sie durch die von Kortex abgelöst.").font(.callout)
                    HStack {
                        Button("Nicht ändern") { modell.ablauf.lehneGitErsetzenAb() }
                        Button("Ersetzen") { modell.tu { await $0.schalte(.git, an: true, ersetzen: true) } }.buttonStyle(.kortexHaupt)
                    }
                }
            }
            if stand.dienstVerfuegbar {
                zeile(.dienst, titel: "Kortex darf diesen Vault im Hintergrund aufräumen",
                      text: "Richtet einen Dienst auf deinem Mac ein (Datei de.brain.tageslauf in ~/Library/LaunchAgents). Er pflegt einmal am Tag genau diesen Vault, wenn er in Kortex gerade aktiv ist "
                          + "und der Mac am Netzteil hängt und ruht, und nutzt dafür dein Claude. Andere Vaults fasst er nie an, solange du ihn für sie nicht ebenfalls einschaltest. Ausschalten löscht ihn wieder.")
            }
        }
    }

    @ViewBuilder private func zeile(_ was: Verdrahtung, titel: String, text: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Toggle(titel, isOn: Binding(
                    get: { was == .claude ? stand.claudeAktiv(in: anzeige.auswahl) : stand.aktiv(was) },
                    set: { neu in modell.tu { await $0.schalte(was, an: neu) } }))
                    .disabled(anzeige.arbeitet != nil)
                if anzeige.arbeitet == was { ProgressView().controlSize(.small) }
            }
            Text(text).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if let f = anzeige.fehler[was] { FehlerBox(text: f) }
        }
    }
}

/// Eine KI-Zeile: Logo, Name, Zustand — und je nach Stand „Verbinden“ oder „Trennen“.
private struct KiReihe: View {
    @ObservedObject var modell: EinrichtungsModell
    let zeile: KiZeile

    private var gefunden: Bool { zeile.status != .nichtGefunden }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                KILogo(ki: zeile.ziel, groesse: 28).opacity(gefunden ? 1 : 0.4)
                VStack(alignment: .leading, spacing: 1) {
                    Text(zeile.ziel.name).font(.headline).foregroundStyle(gefunden ? Color.primary : Color.secondary)
                    Text(untertitel).font(.callout).foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                aktion
            }
            switch zeile.status {
            case .umstellenFragen:
                Text("Bei \(zeile.ziel.name) gibt es schon einen Eintrag „brain“, der woanders hinzeigt. Auf diesen Vault umstellen?").font(.callout)
                HStack {
                    Button("Nicht ändern") { modell.ablauf.lehneUmstellenAb(zeile.ziel) }
                    Button("Umstellen") { modell.tu { await $0.verbinde(zeile.ziel, umstellen: true) } }.buttonStyle(.kortexHaupt)
                }
            case .fehler(let meldung, let befehl):
                FehlerBox(text: meldung)
                if let befehl {
                    Text(zeile.ziel.kopierHinweis).font(.callout).foregroundStyle(.secondary)
                    HStack {
                        Text(befehl).font(.system(.callout, design: .monospaced)).textSelection(.enabled).lineLimit(3)
                        Spacer(minLength: 4)
                        Button("Kopieren") { modell.kopiere(befehl) }
                    }
                }
            case .verbunden:
                Text("Eingetragen. Starte \(zeile.ziel.name) neu, dann ist dein Vault dabei.").font(.callout).foregroundStyle(.secondary)
            case .nichtGefunden, .bereit, .verbindet, .trennt:
                EmptyView()
            }
            if let h = modell.anzeige.kiHinweise[zeile.ziel], !zeile.istVerbunden {
                Label(h, systemImage: "checkmark.circle").font(.callout).foregroundStyle(.secondary)
            }
            if let f = modell.anzeige.kiTrennFehler[zeile.ziel] { FehlerBox(text: f) }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(gefunden ? 0.05 : 0.025), in: RoundedRectangle(cornerRadius: AssistentMass.eckenGross, style: .continuous))
        .accessibilityElement(children: .contain)
    }

    private var untertitel: String {
        if !gefunden { return "nicht gefunden" }
        return zeile.programm?.version.map { "Version \($0)" } ?? "gefunden"
    }

    @ViewBuilder private var aktion: some View {
        switch zeile.status {
        case .bereit, .fehler:
            Button("Verbinden") { modell.tu { await $0.verbinde(zeile.ziel) } }.buttonStyle(.kortexHaupt)
                .accessibilityLabel("\(zeile.ziel.name) verbinden")
        case .verbindet, .trennt:
            ProgressView().controlSize(.small)
        case .verbunden:
            HStack(spacing: 10) {
                Label("Verbunden", systemImage: "checkmark.circle.fill").foregroundStyle(.green).fixedSize()
                Button("Trennen") { modell.tu { await $0.trenne(zeile.ziel) } }
                    .controlSize(.small)
                    .help("Nimmt den Eintrag von Kortex bei \(zeile.ziel.name) wieder heraus. Andere Einträge bleiben.")
                    .accessibilityLabel("\(zeile.ziel.name) trennen")
            }
        case .nichtGefunden:
            // Nicht gefunden: Kortex trägt nichts ein, aber wer das Programm später installiert, kann den Eintrag für seine Einstellungsdatei kopieren
            if let ort = zeile.ziel.dateiOrt {
                if modell.kopiertesZiel == zeile.ziel {
                    Label("Kopiert", systemImage: "checkmark").foregroundStyle(.green).fixedSize()
                } else {
                    Button("Konfiguration kopieren") { modell.kopiereKonfiguration(fuer: zeile.ziel) }
                        .controlSize(.small)
                        .help("Kopiert den Eintrag für \(ort).")
                        .accessibilityLabel("Konfiguration für \(zeile.ziel.name) kopieren")
                }
            }
        case .umstellenFragen:
            EmptyView()
        }
    }
}

// MARK: Probe

private struct ProbeAnsicht: View {
    @ObservedObject var modell: EinrichtungsModell

    var body: some View {
        switch modell.anzeige.probe {
        case .offen, .laeuft:
            Titel(symbol: "magnifyingglass", titel: "Kurze Probe",
                  text: "Kortex fragt \(modell.anzeige.vaultIstBeispiel ? "das Beispiel" : "deinen Vault") auf demselben Weg, den deine KI nimmt.")
            Arbeit(text: "Suche läuft …")
        case .ok(let e):
            ProbeErfolg(treffer: e.treffer, beispiel: modell.anzeige.vaultIstBeispiel)
        case .leer:
            ProbeErfolg(treffer: [], beispiel: modell.anzeige.vaultIstBeispiel)
        case .fehler:
            Titel(symbol: "magnifyingglass", titel: "Die Probe hat nicht geklappt", text: "Die Verbindung zu deinem Vault antwortet nicht so, wie sie soll.")
            GrosserKnopf(titel: "Noch einmal versuchen") { modell.tu { await $0.starteProbe() } }
        }
    }
}

private struct ProbeErfolg: View {
    let treffer: [String]
    var beispiel = false

    var body: some View {
        VStack(spacing: 12) {
            Titel(symbol: "checkmark.seal.fill", titel: "Es funktioniert",
                  text: treffer.isEmpty ? "Die Suche antwortet. Dein Vault ist noch leer — das füllt sich beim Arbeiten."
                      : beispiel ? "Die Suche im Beispiel liefert:" : "Die Suche in deinem Vault liefert:")
            if !treffer.isEmpty {
                Flaeche {
                    ForEach(treffer.prefix(3), id: \.self) { t in Label(t, systemImage: "doc.text").lineLimit(1) }
                }
            }
        }
    }
}

// MARK: Fertig

struct FertigAnsicht: View {
    @ObservedObject var modell: EinrichtungsModell

    var body: some View {
        VStack(spacing: 20) {
            switch modell.anzeige.probe {
            case .ok(let e): ProbeErfolg(treffer: e.treffer, beispiel: modell.anzeige.vaultIstBeispiel)
            case .leer: ProbeErfolg(treffer: [], beispiel: modell.anzeige.vaultIstBeispiel)
            default: Titel(symbol: "checkmark.seal.fill", titel: "Kortex ist eingerichtet", text: nil)
            }
            if modell.anzeige.vaultIstBeispiel {
                HinweisBox(text: "Du arbeitest gerade im Beispiel „\(BeispielVault.name)“. Einen eigenen Vault legst du später im Studio an — oder öffne diesen Assistenten noch einmal über das Menü „Kortex einrichten …“.")
            }
            Flaeche {
                ForEach(EinrichtungsSchritt.allCases.filter { !modell.zustand.uebergangen.contains($0) }, id: \.self) { s in
                    let stand = modell.zustand.stand(s)
                    Label(stand == .erledigt ? "\(s.anzeigeName): fertig" : "\(s.anzeigeName): übersprungen — im Menü „Kortex einrichten …“ nachholen",
                          systemImage: stand == .erledigt ? "checkmark.circle.fill" : "minus.circle")
                        .foregroundStyle(stand == .erledigt ? Color.primary : Color.secondary)
                        .font(.callout)
                }
            }
            GrosserKnopf(titel: "Studio öffnen") { modell.beiStudioOeffnen() }
        }
    }
}
