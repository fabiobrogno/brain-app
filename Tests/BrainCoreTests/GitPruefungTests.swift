import Testing
import Foundation
@testable import BrainCore

/// Antworten für `GitPruefer`, ohne je ein echtes Programm zu starten. Schlüssel: „<Programmname> <Argumente>“.
private final class FalscherProzess: @unchecked Sendable {
    private let sperre = NSLock()
    private var antworten: [String: [Result<BefehlErgebnis, Error>]] = [:]
    private(set) var aufrufe: [String] = []

    func setze(_ schluessel: String, _ ergebnisse: Result<BefehlErgebnis, Error>...) {
        sperre.lock(); defer { sperre.unlock() }
        antworten[schluessel] = ergebnisse
    }

    func ergebnis(_ code: Int32, _ ausgabe: String = "", fehler: String = "") -> Result<BefehlErgebnis, Error> {
        .success(BefehlErgebnis(code: code, ausgabe: ausgabe, fehler: fehler))
    }

    /// Die letzte Antwort eines Schlüssels bleibt stehen, bis eine neue gesetzt wird; frühere werden der Reihe nach verbraucht.
    var starter: GitProzess {
        { [self] programm, argumente in
            let schluessel = ([programm.lastPathComponent] + argumente).joined(separator: " ")
            let r: Result<BefehlErgebnis, Error>? = {
                sperre.lock(); defer { sperre.unlock() }
                aufrufe.append(schluessel)
                guard var liste = antworten[schluessel], !liste.isEmpty else { return nil }
                let erste = liste.count > 1 ? liste.removeFirst() : liste[0]
                antworten[schluessel] = liste
                return erste
            }()
            guard let r else { throw BefehlFehler.startFehlgeschlagen("unerwarteter Aufruf: \(schluessel)") }
            return try r.get()
        }
    }

    func aufgerufen(_ teil: String) -> Bool { aufrufe.contains { $0.contains(teil) } }
}

private let werkzeuge = "/Library/Developer/CommandLineTools"
private let gitPfad = werkzeuge + "/usr/bin/git"

private func pruefer(_ f: FalscherProzess, vorhanden: Set<String> = [gitPfad], jetzt: @escaping @Sendable () -> Date = { Date() },
                     anlaufzeit: TimeInterval = 20) -> GitPruefer {
    GitPruefer(starte: f.starter, istAusfuehrbar: { vorhanden.contains($0) }, jetzt: jetzt, anlaufzeit: anlaufzeit)
}

// MARK: Prüfen

@Test func gitIstVorhandenWennWerkzeugeUndGitAntworten() async {
    let f = FalscherProzess()
    f.setze("xcode-select -p", f.ergebnis(0, werkzeuge + "\n"))
    f.setze("git --version", f.ergebnis(0, "git version 2.39.5 (Apple Git-154)\n"))
    let stand = await pruefer(f).pruefe()
    #expect(stand == .vorhanden(pfad: gitPfad, version: "2.39.5 (Apple Git-154)"))
    #expect(stand.istVorhanden)
    #expect(!f.aufgerufen("--install"), "Die Prüfung löst nie den Installationsdialog aus")
}

@Test func gitWirdNurUeberDasEntwicklerverzeichnisGestartetNieUeberUsrBinGit() async {
    // /usr/bin/git ist auf einem frischen Mac nur Apples Stellvertreter und würde den Dialog öffnen.
    let f = FalscherProzess()
    f.setze("xcode-select -p", f.ergebnis(2, fehler: "xcode-select: error: unable to get active developer directory"))
    f.setze("pgrep -f Install Command Line Developer Tools", f.ergebnis(1))
    let stand = await pruefer(f, vorhanden: ["/usr/bin/git"]).pruefe()
    #expect(stand == .fehlt)
    #expect(!f.aufrufe.contains("git --version"))
}

@Test func xcodeSelectOhneEchtesGitIstFehlt() async {
    // Verzeichnis gewählt, aber leer (halb entfernte Werkzeuge)
    let f = FalscherProzess()
    f.setze("xcode-select -p", f.ergebnis(0, werkzeuge))
    f.setze("pgrep -f Install Command Line Developer Tools", f.ergebnis(1))
    #expect(await pruefer(f, vorhanden: []).pruefe() == .fehlt)
    #expect(!f.aufgerufen("git --version"))
}

@Test func xcodeSelectMitRelativerAusgabeZaehltNichtAlsVerzeichnis() async {
    let f = FalscherProzess()
    f.setze("xcode-select -p", f.ergebnis(0, "irgendwas\n"))
    f.setze("pgrep -f Install Command Line Developer Tools", f.ergebnis(1))
    #expect(await pruefer(f).pruefe() == .fehlt)
}

@Test func gitDasNichtLaeuftIstDefektMitMeldung() async {
    let f = FalscherProzess()
    f.setze("xcode-select -p", f.ergebnis(0, "/Applications/Xcode.app/Contents/Developer\n"))
    f.setze("git --version", f.ergebnis(69, fehler: "\nAgreeing to the Xcode/iOS license requires admin privileges, please run “sudo xcodebuild -license”\n"))
    let stand = await pruefer(f, vorhanden: ["/Applications/Xcode.app/Contents/Developer/usr/bin/git"]).pruefe()
    guard case .defekt(let meldung) = stand else { Issue.record("erwartet .defekt, war \(stand)"); return }
    #expect(meldung.contains("xcodebuild -license"))
}

@Test func unerwarteteVersionsAusgabeIstDefektNichtVorhanden() async {
    let f = FalscherProzess()
    f.setze("xcode-select -p", f.ergebnis(0, werkzeuge))
    f.setze("git --version", f.ergebnis(0, "hallo\n"))
    guard case .defekt = await pruefer(f).pruefe() else { Issue.record("erwartet .defekt"); return }
}

@Test func gitDasNichtStartetIstDefekt() async {
    let f = FalscherProzess()
    f.setze("xcode-select -p", f.ergebnis(0, werkzeuge))
    f.setze("git --version", .failure(BefehlFehler.zeitUeberschritten))
    guard case .defekt(let m) = await pruefer(f).pruefe() else { Issue.record("erwartet .defekt"); return }
    #expect(m.contains("Zeitlimit"))
}

@Test func scheitertXcodeSelectSelbstIstDieSachePruefbarNicht() async {
    let f = FalscherProzess()
    f.setze("xcode-select -p", .failure(BefehlFehler.startFehlgeschlagen("kein Zugriff")))
    guard case .nichtPruefbar(let m) = await pruefer(f).pruefe() else { Issue.record("erwartet .nichtPruefbar"); return }
    #expect(m.contains("kein Zugriff"))
}

@Test func versionWirdAusDerErstenZeileGelesen() {
    #expect(GitPruefer.version(aus: "git version 2.50.1\n") == "2.50.1")
    #expect(GitPruefer.version(aus: "git version 2.39.5 (Apple Git-154)") == "2.39.5 (Apple Git-154)")
    #expect(GitPruefer.version(aus: "  git version 2.1  \nweiter") == "2.1")
    for schlecht in ["", "\n", "git version", "git version  ", "version 2.0", "x git version 1"] {
        #expect(GitPruefer.version(aus: schlecht) == nil, "\(schlecht)")
    }
}

@Test func logTextNenntDenZustandOhneMeldungstexte() {
    #expect(GitStand.vorhanden(pfad: gitPfad, version: "2.39.5").logText == "vorhanden 2.39.5")
    #expect(GitStand.fehlt.logText == "fehlt")
    #expect(GitStand.installiertGerade.logText == "installiert-gerade")
    #expect(GitStand.defekt("/Users/x/geheim").logText == "defekt")
    #expect(GitStand.nichtPruefbar("x").logText == "nicht-pruefbar")
}

// MARK: Installationsdialog auslösen

@Test func installationLoestDenDialogAusUndDanachIstEsInstalliertGerade() async {
    let f = FalscherProzess()
    f.setze("xcode-select -p", f.ergebnis(2))
    f.setze("pgrep -f Install Command Line Developer Tools", f.ergebnis(1)) // Installer noch nicht sichtbar
    f.setze("xcode-select --install", f.ergebnis(0, fehler: "xcode-select: note: install requested for command line developer tools"))
    let p = pruefer(f)
    #expect(await p.pruefe() == .fehlt)
    #expect(await p.starteInstallation() == .dialogAusgeloest)
    #expect(await p.pruefe() == .installiertGerade, "in der Anlaufzeit gilt der Dialog als gerade aktiv")
}

@Test func nachDerAnlaufzeitOhneInstallerProzessIstDerDialogAbgebrochen() async {
    final class Uhr: @unchecked Sendable { var t = Date(timeIntervalSince1970: 1000) }
    let uhr = Uhr()
    let f = FalscherProzess()
    f.setze("xcode-select -p", f.ergebnis(2))
    f.setze("pgrep -f Install Command Line Developer Tools", f.ergebnis(1))
    f.setze("xcode-select --install", f.ergebnis(0))
    let p = pruefer(f, jetzt: { uhr.t }, anlaufzeit: 20)
    _ = await p.starteInstallation()
    uhr.t += 19
    #expect(await p.pruefe() == .installiertGerade)
    uhr.t += 2
    #expect(await p.pruefe() == .fehlt, "Dialog zu, nichts installiert: wieder „fehlt“, der Nutzer kann neu auslösen")
}

@Test func sichtbarerInstallerProzessMeldetInstalliertGerade() async {
    // z. B. nach einem Neustart der App mitten in der Installation (Wiederaufnahme)
    let f = FalscherProzess()
    f.setze("xcode-select -p", f.ergebnis(2))
    f.setze("pgrep -f Install Command Line Developer Tools", f.ergebnis(0, "4711\n"))
    #expect(await pruefer(f).pruefe() == .installiertGerade)
}

@Test func installationLoestNichtsAusWennGitSchonDaIst() async {
    let f = FalscherProzess()
    f.setze("xcode-select -p", f.ergebnis(0, werkzeuge))
    f.setze("git --version", f.ergebnis(0, "git version 2.39.5\n"))
    #expect(await pruefer(f).starteInstallation() == .schonInstalliert)
    #expect(!f.aufgerufen("--install"))
}

@Test func installationOeffnetKeinenZweitenDialogWennEinerLaeuft() async {
    let f = FalscherProzess()
    f.setze("xcode-select -p", f.ergebnis(2))
    f.setze("pgrep -f Install Command Line Developer Tools", f.ergebnis(0))
    #expect(await pruefer(f).starteInstallation() == .dialogAusgeloest)
    #expect(!f.aufgerufen("--install"))
}

@Test func xcodeSelectSagtBereitsInstalliertIstKeinFehler() async {
    let f = FalscherProzess()
    f.setze("xcode-select -p", f.ergebnis(2))
    f.setze("pgrep -f Install Command Line Developer Tools", f.ergebnis(1))
    f.setze("xcode-select --install", f.ergebnis(1, fehler: "xcode-select: error: command line tools are already installed, use \"Software Update\" to install updates"))
    #expect(await pruefer(f).starteInstallation() == .schonInstalliert)
}

@Test func installationFehlerSindSichtbar() async {
    let f = FalscherProzess()
    f.setze("xcode-select -p", f.ergebnis(2))
    f.setze("pgrep -f Install Command Line Developer Tools", f.ergebnis(1))
    f.setze("xcode-select --install", f.ergebnis(1, fehler: "xcode-select: error: kaputt\nzweite Zeile"))
    guard case .fehlgeschlagen(let m) = await pruefer(f).starteInstallation() else { Issue.record("erwartet .fehlgeschlagen"); return }
    #expect(m.contains("kaputt") && !m.contains("zweite Zeile"))

    f.setze("xcode-select --install", .failure(BefehlFehler.zeitUeberschritten))
    guard case .fehlgeschlagen(let m2) = await pruefer(f).starteInstallation() else { Issue.record("erwartet .fehlgeschlagen"); return }
    #expect(m2.contains("Zeitlimit"))
}

// MARK: Neuprüfung

@Test func warteAufGitPrueftNeuBisGitDaIst() async {
    let f = FalscherProzess()
    // dreimal „Installer läuft, kein git“, dann fertig
    f.setze("xcode-select -p", f.ergebnis(2), f.ergebnis(2), f.ergebnis(2), f.ergebnis(0, werkzeuge))
    f.setze("pgrep -f Install Command Line Developer Tools", f.ergebnis(0))
    f.setze("git --version", f.ergebnis(0, "git version 2.39.5\n"))
    let schlaefe = ZaehlerBox()
    let stand = await pruefer(f).warteAufGit(alle: .seconds(3), hoechstens: 50, schlafe: { _ in schlaefe.erhoehe() })
    #expect(stand == .vorhanden(pfad: gitPfad, version: "2.39.5"))
    #expect(schlaefe.wert == 3)
}

@Test func warteAufGitEndetSofortWennDerDialogAbgebrochenWurde() async {
    let f = FalscherProzess()
    f.setze("xcode-select -p", f.ergebnis(2))
    f.setze("pgrep -f Install Command Line Developer Tools", f.ergebnis(1))
    let schlaefe = ZaehlerBox()
    let stand = await pruefer(f).warteAufGit(schlafe: { _ in schlaefe.erhoehe() })
    #expect(stand == .fehlt)
    #expect(schlaefe.wert == 0)
}

@Test func warteAufGitGibtNachDerHoechstzahlDenLetztenStandZurueck() async {
    let f = FalscherProzess()
    f.setze("xcode-select -p", f.ergebnis(2))
    f.setze("pgrep -f Install Command Line Developer Tools", f.ergebnis(0))
    let schlaefe = ZaehlerBox()
    let stand = await pruefer(f).warteAufGit(hoechstens: 4, schlafe: { _ in schlaefe.erhoehe() })
    #expect(stand == .installiertGerade)
    #expect(schlaefe.wert == 3)
}

private final class ZaehlerBox: @unchecked Sendable {
    private let sperre = NSLock()
    private var n = 0
    func erhoehe() { sperre.lock(); n += 1; sperre.unlock() }
    var wert: Int { sperre.lock(); defer { sperre.unlock() }; return n }
}

// MARK: Echter Mac (nur lesend, löst nie einen Dialog aus)

@Test func echterAufrufMeldetEinenDerKlarenZustaende() async {
    let stand = await GitPruefer().pruefe()
    switch stand {
    case .vorhanden(let pfad, let version):
        #expect(pfad.hasSuffix("/usr/bin/git"))
        #expect(!version.isEmpty)
    case .fehlt, .installiertGerade, .defekt, .nichtPruefbar:
        break // auf Rechnern ohne Werkzeuge ist auch das ein gültiges, klares Ergebnis
    }
}
