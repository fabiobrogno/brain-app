import Testing
import Foundation
@testable import BrainCore

private let gitDa = GitStand.vorhanden(pfad: "/Library/Developer/CommandLineTools/usr/bin/git", version: "2.39.5")
private let vaultA = VaultInfo(name: "Brain", pfad: "/Users/test/Brain", git: true)
private let claudeDa = KiProgramm(id: "claude", name: "Claude Code", version: "2.1.0", gefunden: true)
private let claudeFehlt = KiProgramm(id: "claude", name: "Claude Code", version: nil, gefunden: false)
private let code = GitHubGeraetecode(code: "ABCD-1234", url: "https://github.com/login/device", ablauf: nil)

/// Falsche Dienste: jede Liste wird der Reihe nach verbraucht, der letzte Eintrag bleibt stehen.
private final class FalscheDienste: EinrichtungsDienste, @unchecked Sendable {
    var git: [GitStand] = [gitDa]
    var warten: [GitStand] = [gitDa]
    var installationsStart: GitInstallationStart = .dialogAusgeloest
    var vault: VaultInfo?
    var vaultAntworten: [Result<VaultInfo, EinrichtungsFehler>] = [.success(vaultA)]
    var konto: [Result<GitHubKonto, EinrichtungsFehler>] = [.success(GitHubKonto(verfuegbar: true, angemeldet: false))]
    var anmelden: [Result<GitHubGeraetecode, EinrichtungsFehler>] = [.success(code)]
    var status: [Result<GitHubAnmeldung, EinrichtungsFehler>] = [.success(.fertig(login: "fabio"))]
    var kis: [Result<[KiProgramm], EinrichtungsFehler>] = [.success([claudeDa])]
    var verbinden: [Result<KiVerbindung, EinrichtungsFehler>] = [.success(.verbunden)]
    var probeAntworten: [Result<ProbeErgebnis, EinrichtungsFehler>] = [.success(ProbeErgebnis(frage: "Brain", treffer: ["Willkommen"]))]
    private(set) var aufrufe: [String] = []
    private(set) var verbindeUmstellen: [Bool] = []

    private func nimm<T>(_ liste: inout [T]) -> T { liste.count > 1 ? liste.removeFirst() : liste[0] }

    func gitStand() async -> GitStand { aufrufe.append("gitStand"); return nimm(&git) }
    func gitInstallationStarten() async -> GitInstallationStart { aufrufe.append("gitInstallation"); return installationsStart }
    func gitWarten() async -> GitStand { aufrufe.append("gitWarten"); return nimm(&warten) }

    func aktiverVault() async -> VaultInfo? { aufrufe.append("aktiverVault"); return vault }
    private func vaultErgebnis(_ name: String) throws -> VaultInfo {
        aufrufe.append(name)
        let v = try nimm(&vaultAntworten).get()
        vault = v
        return v
    }
    func legeVaultAn(art: NeuerVaultArt, name: String?, ordner: String?) async throws -> VaultInfo { try vaultErgebnis("legeVaultAn \(art.rawValue) \(name ?? "-") \(ordner ?? "-")") }
    func oeffneOrdner(pfad: String, versionsverlaufEinschalten: Bool) async throws -> VaultInfo { try vaultErgebnis("oeffneOrdner \(pfad) \(versionsverlaufEinschalten)") }
    func klone(url: String, ordner: String?, name: String?) async throws -> VaultInfo { try vaultErgebnis("klone \(url)") }

    func githubKonto() async throws -> GitHubKonto { aufrufe.append("githubKonto"); return try nimm(&konto).get() }
    func githubAnmelden() async throws -> GitHubGeraetecode { aufrufe.append("githubAnmelden"); return try nimm(&anmelden).get() }
    func githubStatus() async throws -> GitHubAnmeldung { aufrufe.append("githubStatus"); return try nimm(&status).get() }
    func githubAbbrechen() async throws { aufrufe.append("githubAbbrechen") }

    func erkenneKIs() async throws -> [KiProgramm] { aufrufe.append("erkenneKIs"); return try nimm(&kis).get() }
    func verbinde(_ ziel: KiZiel, umstellen: Bool) async throws -> KiVerbindung {
        aufrufe.append("verbinde \(ziel.rawValue)")
        verbindeUmstellen.append(umstellen)
        return try nimm(&verbinden).get()
    }
    func probe(frage: String) async throws -> ProbeErgebnis { aufrufe.append("probe \(frage)"); return try nimm(&probeAntworten).get() }

    func anzahl(_ name: String) -> Int { aufrufe.filter { $0 == name }.count }
}

@MainActor
private final class Aufbau {
    let dienste = FalscheDienste()
    let speicher: EinrichtungsSpeicher
    var ablauf: EinrichtungsAblauf!
    var aenderungen = 0
    var logzeilen: [String] = []

    init(speicher: EinrichtungsSpeicher? = nil) {
        self.speicher = speicher ?? EinrichtungsSpeicher(pfade: AppPfade(basis: tempOrdner()))
        neuerAblauf()
    }

    func neuerAblauf() {
        ablauf = EinrichtungsAblauf(dienste: dienste, speicher: speicher, schlafe: { _ in await Task.yield() },
                                    log: { [unowned self] in logzeilen.append($0) }, beiAenderung: { [unowned self] _, _ in aenderungen += 1 })
    }
    var zustand: EinrichtungsZustand { ablauf.zustand }
    var anzeige: EinrichtungsAnzeige { ablauf.anzeige }
}

// MARK: Schrittfolge und Überspringen bereits erledigter Schritte

@Test @MainActor func frischerMacOhneGitBleibtBeiGitStehen() async {
    let a = Aufbau()
    a.dienste.git = [.fehlt]
    await a.ablauf.starte()
    #expect(a.zustand.aktuell == .git)
    #expect(a.anzeige.git == .fehlt)
    #expect(a.dienste.anzahl("aktiverVault") == 0, "spätere Schritte werden erst geprüft, wenn sie dran sind")
}

@Test @MainActor func vollstaendigEingerichteterMacSpringtBisZurKiAuswahl() async {
    let a = Aufbau()
    a.dienste.vault = vaultA
    a.dienste.konto = [.success(GitHubKonto(verfuegbar: true, angemeldet: true, login: "fabio"))]
    await a.ablauf.starte()
    #expect(a.zustand.stand(.git) == .erledigt)
    #expect(a.zustand.stand(.vault) == .erledigt)
    #expect(a.zustand.stand(.github) == .erledigt)
    #expect(a.zustand.aktuell == .ki)
    #expect(a.anzeige.github == .angemeldet(login: "fabio"))
    #expect(a.anzeige.vault == vaultA)
    #expect(a.anzeige.kis.map(\.status) == [.bereit])
}

@Test @MainActor func gitInstallationFuehrtDurchDenDialogUndDannWeiter() async {
    let a = Aufbau()
    a.dienste.git = [.fehlt]
    a.dienste.warten = [gitDa]
    await a.ablauf.starte()
    #expect(a.zustand.aktuell == .git)
    await a.ablauf.installiereGit()
    #expect(a.dienste.anzahl("gitInstallation") == 1)
    #expect(a.anzeige.git == gitDa)
    #expect(a.zustand.stand(.git) == .erledigt)
    #expect(a.zustand.aktuell == .vault)
}

@Test @MainActor func dialogAbgebrochenZeigtWiederFehltOhneFehlerUndErlaubtNeuenVersuch() async {
    let a = Aufbau()
    a.dienste.git = [.fehlt]
    a.dienste.warten = [.fehlt, gitDa]
    await a.ablauf.starte()
    await a.ablauf.installiereGit()
    #expect(a.anzeige.git == .fehlt)
    #expect(a.zustand.aktuell == .git)
    #expect(a.zustand.fehler[.git] == nil)
    await a.ablauf.installiereGit()
    #expect(a.zustand.aktuell == .vault)
}

@Test @MainActor func installationDieSchonLaeuftWirdBeimStartAbgewartet() async {
    // App wurde mitten in Apples Installation neu gestartet
    let a = Aufbau()
    a.dienste.git = [.installiertGerade]
    a.dienste.warten = [gitDa]
    await a.ablauf.starte()
    #expect(a.dienste.anzahl("gitWarten") == 1)
    #expect(a.zustand.aktuell == .vault)
}

@Test @MainActor func fehlgeschlageneInstallationIstSichtbarUndWiederholbar() async {
    let a = Aufbau()
    a.dienste.git = [.fehlt]
    a.dienste.installationsStart = .fehlgeschlagen("Der Installationsdialog von Apple ließ sich nicht öffnen: kaputt")
    await a.ablauf.starte()
    await a.ablauf.installiereGit()
    #expect(a.zustand.fehler[.git]?.contains("kaputt") == true)
    #expect(a.zustand.aktuell == .git)
    a.dienste.installationsStart = .dialogAusgeloest
    await a.ablauf.installiereGit()
    #expect(a.zustand.fehler[.git] == nil && a.zustand.aktuell == .vault)
}

@Test @MainActor func defektesGitUndNichtPruefbaresGitSindFehler() async {
    let a = Aufbau()
    a.dienste.git = [.defekt("xcodebuild -license"), .nichtPruefbar("kein Zugriff"), gitDa]
    await a.ablauf.starte()
    #expect(a.zustand.fehler[.git]?.contains("xcodebuild -license") == true)
    await a.ablauf.pruefeGit()
    #expect(a.zustand.fehler[.git]?.contains("kein Zugriff") == true)
    #expect(a.zustand.aktuell == .git)
    await a.ablauf.pruefeGit()
    #expect(a.zustand.fehler[.git] == nil)
    #expect(a.zustand.aktuell == .vault)
}

// MARK: Vault

@Test @MainActor func vaultAnlegenGehtWeiterZuGitHub() async {
    let a = Aufbau()
    await a.ablauf.starte()
    #expect(a.zustand.aktuell == .vault)
    await a.ablauf.legeVaultAn(name: "Brain", ordner: nil)
    #expect(a.dienste.aufrufe.contains("legeVaultAn vorlage Brain -"))
    #expect(a.anzeige.vault == vaultA)
    #expect(a.zustand.aktuell == .github)
    #expect(a.anzeige.vaultArbeitet == nil)
}

@Test @MainActor func vaultFehlerBleibtSichtbarUndNeuerVersuchKlappt() async {
    let a = Aufbau()
    a.dienste.vaultAntworten = [.failure(EinrichtungsFehler("Dieser Ordner ist nicht leer.", status: 409)), .success(vaultA)]
    await a.ablauf.starte()
    await a.ablauf.legeVaultAn(name: nil, ordner: "/Users/test/Voll")
    #expect(a.zustand.fehler[.vault] == "Dieser Ordner ist nicht leer.")
    #expect(a.zustand.aktuell == .vault)
    #expect(a.anzeige.vaultArbeitet == nil, "der Knopf ist wieder frei")
    await a.ablauf.legeVaultAn(name: nil, ordner: "/Users/test/Leer")
    #expect(a.zustand.fehler[.vault] == nil)
    #expect(a.zustand.aktuell == .github)
}

@Test @MainActor func vaultOeffnenUndKlonenRufenDieWerkstatt() async {
    let a = Aufbau()
    await a.ablauf.starte()
    await a.ablauf.oeffneOrdner(pfad: "/Users/test/Notizen", versionsverlaufEinschalten: true)
    #expect(a.dienste.aufrufe.contains("oeffneOrdner /Users/test/Notizen true"))
    let b = Aufbau()
    await b.ablauf.starte()
    await b.ablauf.klone(url: "https://github.com/x/y.git")
    #expect(b.dienste.aufrufe.contains("klone https://github.com/x/y.git"))
    #expect(b.zustand.stand(.vault) == .erledigt)
}

@Test @MainActor func vorhandenerAktiverVaultUeberspringtDenSchrittMitInfo() async {
    let a = Aufbau()
    a.dienste.vault = vaultA
    await a.ablauf.starte()
    #expect(a.zustand.stand(.vault) == .erledigt)
    #expect(a.dienste.anzahl("legeVaultAn vorlage Brain -") == 0)
}

// MARK: GitHub

@Test @MainActor func githubAnmeldungMitGeraetecodeWirdBeobachtetBisFertig() async {
    let a = Aufbau()
    a.dienste.vault = vaultA
    a.dienste.status = [.success(.wartet(code)), .success(.wartet(code)), .success(.fertig(login: "fabio"))]
    await a.ablauf.starte()
    #expect(a.zustand.aktuell == .github)
    #expect(a.anzeige.github == .abgemeldet)
    await a.ablauf.meldeBeiGitHubAn()
    #expect(a.dienste.anzahl("githubStatus") == 3)
    #expect(a.anzeige.github == .angemeldet(login: "fabio"))
    #expect(a.zustand.stand(.github) == .erledigt)
    #expect(a.zustand.aktuell == .ki)
}

@Test @MainActor func anmeldungSchonImVaultSchrittMachtDenGitHubSchrittUeberfluessig() async {
    // Klonen eines privaten Repos: Anmeldung vor dem Vault; danach geht der GitHub-Schritt ohne Klick vorbei.
    let a = Aufbau()
    await a.ablauf.starte()
    #expect(a.zustand.aktuell == .vault)
    #expect(a.anzeige.github == .unbekannt)
    await a.ablauf.ladeGitHubStand()
    #expect(a.anzeige.github == .abgemeldet)
    await a.ablauf.ladeGitHubStand()
    #expect(a.dienste.anzahl("githubKonto") == 1, "nur einmal gelesen")
    await a.ablauf.meldeBeiGitHubAn()
    #expect(a.anzeige.github == .angemeldet(login: "fabio"))
    #expect(a.zustand.stand(.github) == .erledigt)
    #expect(a.zustand.aktuell == .vault, "der Vault-Schritt bleibt dran")
    await a.ablauf.klone(url: "https://github.com/x/privat.git")
    #expect(a.zustand.aktuell == .ki)
}

@Test @MainActor func githubCodeWirdAngezeigtSolangeGewartetWird() async {
    let a = Aufbau()
    a.dienste.vault = vaultA
    a.dienste.status = [.success(.abgelaufen)]
    await a.ablauf.starte()
    await a.ablauf.meldeBeiGitHubAn()
    #expect(a.anzeige.github == .abgelaufen)
    #expect(a.zustand.aktuell == .github, "abgelaufen: bleibt stehen, neuer Versuch möglich")
    a.dienste.status = [.success(.abgelehnt(grund: "schluesselbund"))]
    await a.ablauf.meldeBeiGitHubAn()
    #expect(a.anzeige.github == .abgelehnt(grund: "schluesselbund"))
}

@Test @MainActor func githubStartFehlerIstSichtbar() async {
    let a = Aufbau()
    a.dienste.vault = vaultA
    a.dienste.anmelden = [.failure(EinrichtungsFehler("GitHub war nicht erreichbar. Prüfe die Internetverbindung.", status: 502))]
    await a.ablauf.starte()
    await a.ablauf.meldeBeiGitHubAn()
    #expect(a.zustand.fehler[.github]?.contains("nicht erreichbar") == true)
    #expect(a.anzeige.github == .abgemeldet)
}

@Test @MainActor func kurzeAusfaelleBeimNachfragenBrechenDieAnmeldungNichtAb() async {
    let a = Aufbau()
    a.dienste.vault = vaultA
    let aus = Result<GitHubAnmeldung, EinrichtungsFehler>.failure(EinrichtungsFehler("weg"))
    a.dienste.status = [aus, aus, aus, aus, .success(.fertig(login: "x"))]
    await a.ablauf.starte()
    await a.ablauf.meldeBeiGitHubAn()
    #expect(a.anzeige.github == .angemeldet(login: "x"))
}

@Test @MainActor func fuenfAusfaelleHintereinanderWerdenGemeldet() async {
    let a = Aufbau()
    a.dienste.vault = vaultA
    a.dienste.status = [.failure(EinrichtungsFehler("Verbindung weg"))]
    await a.ablauf.starte()
    await a.ablauf.meldeBeiGitHubAn()
    #expect(a.dienste.anzahl("githubStatus") == 5)
    #expect(a.zustand.fehler[.github] == "Verbindung weg")
}

@Test @MainActor func githubAbbrechenBeendetDasWarten() async {
    let a = Aufbau()
    a.dienste.vault = vaultA
    a.dienste.status = [.success(.wartet(code))]
    await a.ablauf.starte()
    let lauf = Task { @MainActor in await a.ablauf.meldeBeiGitHubAn() }
    for _ in 0..<6 { await Task.yield() }
    #expect(a.anzeige.github == .wartet(code))
    await a.ablauf.brecheGitHubAb()
    await lauf.value
    #expect(a.anzeige.github == .abgemeldet)
    #expect(a.dienste.anzahl("githubAbbrechen") == 1)
    #expect(a.zustand.aktuell == .github)
}

@Test @MainActor func githubNichtEingerichtetEntfaelltOhneKlick() async {
    let a = Aufbau()
    a.dienste.vault = vaultA
    a.dienste.konto = [.success(GitHubKonto(verfuegbar: false, angemeldet: false))]
    await a.ablauf.starte()
    #expect(a.anzeige.github == .nichtVerfuegbar)
    #expect(a.zustand.stand(.github) == .uebersprungen)
    #expect(a.zustand.aktuell == .ki)
}

@Test @MainActor func githubKontoFehlerIstSichtbarAberUeberspringbar() async {
    let a = Aufbau()
    a.dienste.vault = vaultA
    a.dienste.konto = [.failure(EinrichtungsFehler("Der Hintergrunddienst von Kortex antwortet nicht. Bitte starte Kortex neu."))]
    await a.ablauf.starte()
    #expect(a.zustand.fehler[.github]?.contains("antwortet nicht") == true)
    await a.ablauf.ueberspringe()
    #expect(a.zustand.aktuell == .ki)
}

// MARK: KI

private func beiKi(_ a: Aufbau) async {
    a.dienste.vault = vaultA
    a.dienste.konto = [.success(GitHubKonto(verfuegbar: true, angemeldet: true, login: "fabio"))]
    await a.ablauf.starte()
}

@Test @MainActor func kiVerbindenZeigtErfolgUndWeiterGehtZurProbe() async {
    let a = Aufbau()
    await beiKi(a)
    #expect(a.zustand.aktuell == .ki)
    #expect(!a.ablauf.kannWeiter(.ki))
    await a.ablauf.verbinde(.claude)
    #expect(a.anzeige.kis.first?.status == .verbunden(schon: false))
    #expect(a.dienste.verbindeUmstellen == [false])
    #expect(a.ablauf.kannWeiter(.ki))
    await a.ablauf.weiter()
    #expect(a.zustand.stand(.ki) == .erledigt)
    #expect(a.zustand.aktuell == nil, "die Probe läuft beim Betreten von selbst und gelingt")
    #expect(a.anzeige.probe == .ok(ProbeErgebnis(frage: "Brain", treffer: ["Willkommen"])))
    #expect(a.dienste.aufrufe.contains("probe Brain"))
}

@Test @MainActor func fremderEintragFragtErstUndStelltNurMitJaUm() async {
    let a = Aufbau()
    await beiKi(a)
    a.dienste.verbinden = [.failure(EinrichtungsFehler("Bei Claude Code ist schon ein anderer Server eingetragen.", status: 409, art: "anders", befehl: "claude mcp add …")),
                           .success(.verbunden)]
    await a.ablauf.verbinde(.claude)
    #expect(a.anzeige.kis.first?.status == .umstellenFragen)
    a.ablauf.lehneUmstellenAb(.claude)
    #expect(a.anzeige.kis.first?.status == .bereit)
    await a.ablauf.verbinde(.claude, umstellen: true)
    #expect(a.dienste.verbindeUmstellen == [false, true])
    #expect(a.anzeige.kis.first?.status == .verbunden(schon: false))
}

@Test @MainActor func kiFehlerZeigtMeldungUndBefehlZumKopieren() async {
    let a = Aufbau()
    await beiKi(a)
    a.dienste.verbinden = [.failure(EinrichtungsFehler("Claude Code hat den Eintrag abgelehnt.", status: 502, befehl: "claude mcp add -s user brain -- node x"))]
    await a.ablauf.verbinde(.claude)
    #expect(a.anzeige.kis.first?.status == .fehler("Claude Code hat den Eintrag abgelehnt.", befehl: "claude mcp add -s user brain -- node x"))
    #expect(!a.ablauf.kannWeiter(.ki))
}

@Test @MainActor func schonVerbundenIstErfolg() async {
    let a = Aufbau()
    await beiKi(a)
    a.dienste.verbinden = [.success(.schonVerbunden)]
    await a.ablauf.verbinde(.claude)
    #expect(a.anzeige.kis.first?.status == .verbunden(schon: true))
}

@Test @MainActor func ohneKiAppZeigtNichtGefundenUndErlaubtUeberspringen() async {
    let a = Aufbau()
    a.dienste.kis = [.success([claudeFehlt]), .success([claudeDa])]
    await beiKi(a)
    #expect(a.anzeige.kis.first?.status == .nichtGefunden)
    await a.ablauf.sucheKIsNeu()
    #expect(a.anzeige.kis.first?.status == .bereit, "nach der Installation findet die Suche Claude")
    await a.ablauf.ueberspringe()
    #expect(a.zustand.stand(.ki) == .uebersprungen)
    #expect(a.zustand.aktuell == nil)
}

@Test @MainActor func kiErkennungFehlerIstSichtbar() async {
    let a = Aufbau()
    a.dienste.kis = [.failure(EinrichtungsFehler("Der Hintergrunddienst von Kortex antwortet nicht. Bitte starte Kortex neu."))]
    await beiKi(a)
    #expect(a.zustand.fehler[.ki]?.contains("antwortet nicht") == true)
}

@Test @MainActor func neuErkennungBehaeltEinenVerbundenenStatus() async {
    let a = Aufbau()
    await beiKi(a)
    await a.ablauf.verbinde(.claude)
    await a.ablauf.sucheKIsNeu()
    #expect(a.anzeige.kis.first?.status == .verbunden(schon: false))
}

// MARK: Probe

@Test @MainActor func probeFehlerBleibtSichtbarUndLaesstSichWiederholen() async {
    let a = Aufbau()
    await beiKi(a)
    a.dienste.probeAntworten = [.failure(EinrichtungsFehler("Der MCP-Server hat nicht geantwortet.", status: 502)),
                                .success(ProbeErgebnis(frage: "Brain", treffer: []))]
    await a.ablauf.verbinde(.claude)
    await a.ablauf.weiter()
    #expect(a.zustand.aktuell == .probe)
    #expect(a.anzeige.probe == .fehler("Der MCP-Server hat nicht geantwortet."))
    #expect(a.zustand.fehler[.probe] == "Der MCP-Server hat nicht geantwortet.")
    await a.ablauf.starteProbe()
    #expect(a.anzeige.probe == .leer, "leeres Brain: die Suche antwortet trotzdem — das zählt als „funktioniert“")
    #expect(a.zustand.istFertig)
}

@Test @MainActor func probeLaesstSichUeberspringen() async {
    let a = Aufbau()
    await beiKi(a)
    a.dienste.probeAntworten = [.failure(EinrichtungsFehler("nein"))]
    await a.ablauf.verbinde(.claude)
    await a.ablauf.weiter()
    await a.ablauf.ueberspringe()
    #expect(a.zustand.istFertig)
    #expect(a.zustand.stand(.probe) == .uebersprungen)
}

// MARK: Gedächtnis: Wiederaufnahme, Wiederholung, Später

@Test @MainActor func abgeschlossenerLaufWirdGemerkt() async throws {
    let a = Aufbau()
    await beiKi(a)
    await a.ablauf.verbinde(.claude)
    await a.ablauf.weiter()
    #expect(a.ablauf.abgeschlossen)
    let d = try #require(a.speicher.lade())
    #expect(d.abgeschlossen)
    #expect(!a.speicher.sollErscheinen(hatVault: false))
}

@Test @MainActor func wiederaufnahmeNachAbbruchMachtBeiDerProbeWeiter() async {
    let a = Aufbau()
    a.dienste.probeAntworten = [.failure(EinrichtungsFehler("nein"))]
    await beiKi(a)
    await a.ablauf.verbinde(.claude)
    await a.ablauf.weiter()
    #expect(a.zustand.aktuell == .probe)
    a.ablauf.schliesse() // Fenster zu / App beendet mitten in der Einrichtung
    #expect(a.speicher.sollErscheinen(hatVault: true), "Abbruch: erscheint beim nächsten Start wieder")

    // neue Sitzung, derselbe Speicher; git/Vault/GitHub kommen wieder aus der Wirklichkeit
    a.neuerAblauf()
    a.dienste.probeAntworten = [.success(ProbeErgebnis(frage: "Brain", treffer: ["x"]))]
    await a.ablauf.starte()
    #expect(a.zustand.stand(.ki) == .erledigt, "KI-Verbindung ist gemerkt")
    #expect(a.dienste.anzahl("erkenneKIs") == 1, "die KI-Suche lief nur in der ersten Sitzung")
    #expect(a.zustand.istFertig)
    #expect(a.anzeige.probe == .ok(ProbeErgebnis(frage: "Brain", treffer: ["x"])))
}

@Test @MainActor func wiederaufnahmeMerktWasDerNutzerUebersprungenHat() async {
    let a = Aufbau()
    a.dienste.vault = vaultA
    await a.ablauf.starte()
    await a.ablauf.ueberspringe() // GitHub
    a.ablauf.schliesse()
    a.neuerAblauf()
    await a.ablauf.starte()
    #expect(a.zustand.stand(.github) == .uebersprungen)
    #expect(a.zustand.aktuell == .ki)
    #expect(a.dienste.anzahl("githubKonto") == 1, "nicht noch einmal gefragt")
}

@Test @MainActor func wiederholungUeberDasMenuZeigtKiUndProbeNochEinmal() async {
    let a = Aufbau()
    await beiKi(a)
    await a.ablauf.verbinde(.claude)
    await a.ablauf.weiter()
    #expect(a.ablauf.abgeschlossen)
    a.neuerAblauf()
    await a.ablauf.starte(wiederholung: true)
    #expect(a.zustand.aktuell == .ki, "git, Vault und GitHub sind erledigt und gehen ohne Klick vorbei")
    #expect(a.zustand.stand(.git) == .erledigt && a.zustand.stand(.vault) == .erledigt)
}

@Test @MainActor func nachAbgeschlossenemLaufStartetAuchOhneWiederholungFrisch() async {
    let a = Aufbau()
    await beiKi(a)
    await a.ablauf.verbinde(.claude)
    await a.ablauf.weiter()
    a.neuerAblauf()
    await a.ablauf.starte()
    #expect(a.zustand.aktuell == .ki)
}

@Test @MainActor func spaeterSchaltetDasAutomatischeErscheinenAus() async {
    let a = Aufbau()
    a.dienste.git = [.fehlt]
    await a.ablauf.starte()
    #expect(a.speicher.sollErscheinen(hatVault: false))
    a.ablauf.spaeter()
    #expect(!a.speicher.sollErscheinen(hatVault: false))
    #expect(a.speicher.lade()?.abgeschlossen == false)
}

// MARK: Zurück

@Test @MainActor func zurueckZeigtDenVorherigenSchrittOhneGleichWeiterzuspringen() async {
    let a = Aufbau()
    await beiKi(a)
    #expect(a.zustand.aktuell == .ki)
    await a.ablauf.zurueck()
    #expect(a.zustand.aktuell == .github)
    #expect(a.ablauf.kannWeiter(.github))
    await a.ablauf.weiter()
    #expect(a.zustand.aktuell == .ki)
}

@Test @MainActor func zurueckUeberEinenEntfallenenGitHubSchrittHinweg() async {
    let a = Aufbau()
    a.dienste.vault = vaultA
    a.dienste.konto = [.success(GitHubKonto(verfuegbar: false, angemeldet: false))]
    await a.ablauf.starte()
    #expect(a.zustand.aktuell == .ki)
    await a.ablauf.zurueck()
    #expect(a.zustand.aktuell == .vault)
    #expect(a.ablauf.kannWeiter(.vault))
}

@Test @MainActor func zurueckZurKiLaesstDieProbeNeuLaufen() async {
    let a = Aufbau()
    await beiKi(a)
    await a.ablauf.verbinde(.claude)
    await a.ablauf.weiter()
    #expect(a.zustand.istFertig)
    await a.ablauf.zurueck() // von „fertig“ zur Probe: läuft noch einmal
    #expect(a.dienste.anzahl("probe Brain") == 2)
    #expect(a.zustand.istFertig)
}

@Test @MainActor func beimErstenSchrittGibtEsKeinZurueck() async {
    let a = Aufbau()
    a.dienste.git = [.fehlt]
    await a.ablauf.starte()
    await a.ablauf.zurueck()
    #expect(a.zustand.aktuell == .git)
}

@Test @MainActor func jedeAenderungWirdAnDieOberflaecheGemeldet() async {
    let a = Aufbau()
    await a.ablauf.starte()
    #expect(a.aenderungen > 0)
}
