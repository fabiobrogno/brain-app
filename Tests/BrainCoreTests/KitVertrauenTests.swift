import Testing
import Foundation
@testable import BrainCore

private let statusJSON = #"{"version":"0.5.1","quellVault":false,"zustand":"ok","meldungen":[],"zahlen":{"vorschlaege":0,"konflikte":0,"abgelaufen":0,"zuTun":0}}"#

// MARK: Ausgabe der Prüfung auswerten

@Test func vertrauenErlaubtNurMitGenauerAusgabeUndExitNull() {
    for ausgabe in [#"{"erlaubt":true}"#, "{\"erlaubt\":true}\n", "  {\"erlaubt\":true}\r\n\n"] {
        #expect(KitVertrauen.auswerten(code: 0, ausgabe: ausgabe) == .erlaubt, "\(ausgabe)")
    }
    // ausdrückliches „nein“ der Prüfung
    #expect(KitVertrauen.auswerten(code: 0, ausgabe: #"{"erlaubt":false}"#) == .nein(.nichtFreigegeben))
    #expect(KitVertrauen.auswerten(code: 0, ausgabe: "{\"erlaubt\":false}\n") == .nein(.nichtFreigegeben))
}

@Test func vertrauenVerneintJedeAndereAusgabeUndJedenExitCode() {
    let unerwartet = [
        "", "\n", "true", "erlaubt", "{}", #"{"erlaubt": true}"#, #"{"erlaubt":true,"grund":"x"}"#, #"{"erlaubt":1}"#,
        #"{"erlaubt":"true"}"#, #"{"erlaubt":null}"#, #"{"erlaubt":True}"#, #"{"erlaubt":true"#, #"[{"erlaubt":true}]"#,
        #"{"Erlaubt":true}"#, "Hinweis\n{\"erlaubt\":true}", "{\"erlaubt\":false}\n{\"erlaubt\":true}",
        "{\"erlaubt\":true}\n{\"erlaubt\":true}", "{\n  \"erlaubt\": true\n}",
    ]
    for ausgabe in unerwartet {
        #expect(KitVertrauen.auswerten(code: 0, ausgabe: ausgabe) == .nein(.unerwarteteAusgabe), "\(ausgabe)")
    }
    // Exit-Code ≠ 0: nie erlaubt — auch nicht mit der „richtigen“ Ausgabe
    for code in [1, 2, 127, 255] as [Int32] {
        #expect(KitVertrauen.auswerten(code: code, ausgabe: #"{"erlaubt":true}"#) == .nein(.unerwarteteAusgabe), "\(code)")
    }
}

@Test func erlaubnisHatEinenLogText() {
    #expect(KitErlaubnis.erlaubt.istErlaubt)
    #expect(!KitErlaubnis.nein(.nichtFreigegeben).istErlaubt)
    #expect(KitErlaubnis.erlaubt.logText == "erlaubt")
    #expect(KitErlaubnis.nein(.nichtFreigegeben).logText == "nein nicht-freigegeben")
    #expect(KitErlaubnis.nein(.pruefungFehlt).logText == "nein pruefung-fehlt")
}

@Test func anzeigeKitNichtErlaubtIstEinEigenerZustandKeinFehler() {
    let a = StatusAnzeige.kitNichtErlaubt
    #expect(a.titel == "Kit nicht erlaubt")
    #expect(!a.symbol.isEmpty && !a.zeichen.isEmpty, "immer Symbol + Text, nie nur Farbe")
    for andere in [StatusAnzeige.problem("x"), .ohneKit, .keinVault] {
        #expect(a != andere)
        #expect(a.symbol != andere.symbol)
    }
}

@Test func pruefSkriptLiegtNebenDerWerkstatt() {
    let werkstatt = URL(fileURLWithPath: "/Applications/Brain.app/Contents/Resources/werkstatt/werkstatt.mjs")
    #expect(KitVertrauen.pruefSkript(werkstatt: werkstatt).path == "/Applications/Brain.app/Contents/Resources/werkstatt/vertrauen-pruefen.mjs")
    #expect(KitVertrauen.skriptName == "vertrauen-pruefen.mjs")
    #expect(KitVertrauen.zeitlimit == .seconds(5))
}

// MARK: Attrappe: „node“ führt die Prüfung wie ein Node-Skript aus (die CLI ist hier ein Shell-Skript)

/// `node` startet `vertrauen-pruefen.mjs` mit /bin/sh und hält jeden Start von `brain.mjs` als Zeile in `kit-gestartet.txt` fest —
/// so lässt sich beweisen, dass ohne Erlaubnis kein Kit-Prozess entsteht. Die Standard-CLI antwortet `{"erlaubt":true}`, solange die
/// Datei `freigabe` existiert, sonst `{"erlaubt":false}`.
private struct KitAttrappe {
    let ordner: URL
    let vault: URL
    let node: URL
    let cli: URL
    let marke: URL
    let freigabe: URL
    /// Großzügiges Zeitlimit nur für die Tests: Der erste Start frisch geschriebener Skripte dauert auf einem ausgelasteten Mac
    /// (paralleles `swift test`) mitunter Sekunden. Das 5-s-Limit der App bleibt unverändert (siehe `pruefSkriptLiegtNebenDerWerkstatt`);
    /// die Zeitüberschreitung selbst wird mit einem ausdrücklich kurzen Limit geprüft.
    static let testZeitlimit = Duration.seconds(60)
    var vertrauen: KitVertrauen {
        KitVertrauen(node: node, pruefSkript: cli, umgebung: ["BRAIN_APP_SUPPORT": ordner.path], arbeitsordner: ordner,
                     pruefZeitlimit: Self.testZeitlimit)
    }

    /// `rumpf`: eigener Inhalt der Attrappen-CLI (Shell); `ohneCli`: die Datei fehlt ganz; `status`: Ausgabe von `brain.mjs`.
    init(rumpf: String? = nil, ohneCli: Bool = false, status: String = statusJSON) {
        let ordner = tempOrdner("Kit Attrappe")
        let vault = ordner.appendingPathComponent("Mein Brän", isDirectory: true)
        try! FileManager.default.createDirectory(at: vault, withIntermediateDirectories: true)
        let marke = ordner.appendingPathComponent("kit-gestartet.txt")
        let freigabe = ordner.appendingPathComponent("freigabe")
        self.node = skript("""
        #!/bin/sh
        case "$1" in
          *vertrauen-pruefen.mjs) exec /bin/sh "$@" ;;
          *brain.mjs) echo gestartet >> '\(marke.path)'; echo '\(status)' ;;
          *) exit 9 ;;
        esac
        """, name: "node", in: ordner)
        let standard = "if [ -f '\(freigabe.path)' ]; then echo '{\"erlaubt\":true}'; else echo '{\"erlaubt\":false}'; fi\n"
        self.cli = ordner.appendingPathComponent("vertrauen-pruefen.mjs")
        if !ohneCli { skript(rumpf ?? standard, name: "vertrauen-pruefen.mjs", in: ordner) }
        self.ordner = ordner
        self.vault = vault
        self.marke = marke
        self.freigabe = freigabe
    }

    func erlaube(_ ja: Bool) {
        if ja { FileManager.default.createFile(atPath: freigabe.path, contents: Data()) }
        else { try? FileManager.default.removeItem(at: freigabe) }
    }
}

// MARK: Prüfung

@Test func vertrauenFragtDieCliMitVaultPfadUndSupport() async throws {
    let a = KitAttrappe(rumpf: """
    printf '%s|%s|%s' "$1" "${BRAIN_APP_SUPPORT-unset}" "${BRAIN_VAULT-unset}" > "$(dirname "$0")/aufruf.txt"
    echo '{"erlaubt":true}'
    """)
    #expect(await a.vertrauen.pruefe(vault: a.vault) == .erlaubt)
    // Vault nur als Argument (mit Leerzeichen und Umlaut); BRAIN_APP_SUPPORT wie bei der Werkstatt; kein BRAIN_VAULT
    let aufruf = try String(contentsOf: a.ordner.appendingPathComponent("aufruf.txt"), encoding: .utf8)
    #expect(aufruf == "\(a.vault.path)|\(a.ordner.path)|unset")
}

@Test func vertrauenFolgtDerFreigabeDateiJedesMalNeu() async {
    let a = KitAttrappe()
    #expect(await a.vertrauen.pruefe(vault: a.vault) == .nein(.nichtFreigegeben))
    a.erlaube(true)
    #expect(await a.vertrauen.pruefe(vault: a.vault) == .erlaubt)
    a.erlaube(false)
    #expect(await a.vertrauen.pruefe(vault: a.vault) == .nein(.nichtFreigegeben), "kein Zwischenspeicher: das Vertrauen kann jederzeit entfallen")
}

@Test func fehlendeOderDefekteCliIstImmerNein() async {
    // Datei fehlt (die CLI entsteht mit dem Backend; bis dahin gilt „nicht erlaubt“)
    #expect(await KitAttrappe(ohneCli: true).vertrauen.pruefe(vault: tempOrdner("V")) == .nein(.pruefungFehlt))
    // Exit-Code ≠ 0, auch mit der „richtigen“ Ausgabe
    let abgestuerzt = KitAttrappe(rumpf: "echo '{\"erlaubt\":true}'\nexit 3\n")
    #expect(await abgestuerzt.vertrauen.pruefe(vault: abgestuerzt.vault) == .nein(.unerwarteteAusgabe))
    // Müll und nichts
    for rumpf in ["echo kaputt\n", "exit 0\n", "echo '{\"erlaubt\":\"ja\"}'\n"] {
        let a = KitAttrappe(rumpf: rumpf)
        #expect(await a.vertrauen.pruefe(vault: a.vault) == .nein(.unerwarteteAusgabe), "\(rumpf)")
    }
    // Node selbst fehlt
    let a = KitAttrappe()
    let ohneNode = KitVertrauen(node: URL(fileURLWithPath: "/gibt/es/nicht"), pruefSkript: a.cli)
    #expect(await ohneNode.pruefe(vault: a.vault) == .nein(.startFehlgeschlagen))
}

@Test func vertrauenBrichtNachDemZeitlimitAbUndVerneint() async {
    let a = KitAttrappe(rumpf: "exec sleep 60\n")
    a.erlaube(true)
    let start = ContinuousClock.now
    #expect(await a.vertrauen.pruefe(vault: a.vault, zeitlimit: .milliseconds(300)) == .nein(.zeitueberschreitung))
    #expect(ContinuousClock.now - start < .seconds(30), "die Prüfung darf nicht bis zum Ende der Attrappe hängen")
}

@Test func vertrauenStartetDiePruefungOhneRelativenPfad() async throws {
    // Die Prüfung liest in Git-Konfiguration und startet dafür `git` — mit dem Vault als Arbeitsverzeichnis, bevor jemand vertraut
    // hat. Ein relativer PATH-Eintrag (App aus dem Terminal gestartet) ließe dort ein fremdes `git` laufen (Review SW-3).
    let a = KitAttrappe(rumpf: """
    printf '%s' "$PATH" > "$(dirname "$0")/pfad.txt"
    echo '{"erlaubt":true}'
    """)
    let vertrauen = KitVertrauen(node: a.node, pruefSkript: a.cli,
                                 umgebung: ["BRAIN_APP_SUPPORT": a.ordner.path, "PATH": "node_modules/.bin:.:/usr/bin:/bin"],
                                 arbeitsordner: a.ordner, pruefZeitlimit: KitAttrappe.testZeitlimit)
    #expect(await vertrauen.pruefe(vault: a.vault) == .erlaubt)
    let pfad = try String(contentsOf: a.ordner.appendingPathComponent("pfad.txt"), encoding: .utf8)
    #expect(pfad == "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
}

// MARK: Technische Prüffehler sind keine Antwort des Nutzers (Review SW-5)

@Test func nurNichtFreigegebenIstEineAntwortDerPruefung() {
    #expect(!KitErlaubnis.Grund.nichtFreigegeben.istTechnisch)
    for g in [KitErlaubnis.Grund.pruefungFehlt, .startFehlgeschlagen, .zeitueberschreitung, .unerwarteteAusgabe] {
        #expect(g.istTechnisch, "\(g)")
        #expect(KitErlaubnis.nein(g).istTechnischerFehler, "\(g)")
    }
    #expect(!KitErlaubnis.nein(.nichtFreigegeben).istTechnischerFehler)
    #expect(!KitErlaubnis.erlaubt.istTechnischerFehler)
}

@Test func kitStandUnterscheidetFreigabeUndPruefFehler() {
    #expect(KitStand(.erlaubt) == .erlaubt)
    #expect(KitStand(.nein(.nichtFreigegeben)) == .nichtFreigegeben)
    for g in [KitErlaubnis.Grund.pruefungFehlt, .startFehlgeschlagen, .zeitueberschreitung, .unerwarteteAusgabe] {
        #expect(KitStand(.nein(g)) == .pruefungFehlgeschlagen, "\(g)")
    }
}

@Test func pruefFehlerSindEinEigenerStandAuchBeiEchtenAufrufen() async {
    // fehlende CLI, Absturz, Müll, Zeitüberschreitung → Prüfung fehlgeschlagen; ausdrückliches „nein“ → nicht freigegeben
    #expect(KitStand(await KitAttrappe(ohneCli: true).vertrauen.pruefe(vault: tempOrdner("V"))) == .pruefungFehlgeschlagen)
    for rumpf in ["echo '{\"erlaubt\":true}'\nexit 3\n", "echo kaputt\n", "exit 0\n"] {
        let a = KitAttrappe(rumpf: rumpf)
        #expect(KitStand(await a.vertrauen.pruefe(vault: a.vault)) == .pruefungFehlgeschlagen, "\(rumpf)")
    }
    let langsam = KitAttrappe(rumpf: "exec sleep 60\n")
    #expect(KitStand(await langsam.vertrauen.pruefe(vault: langsam.vault, zeitlimit: .milliseconds(300))) == .pruefungFehlgeschlagen)
    let nein = KitAttrappe() // ohne Freigabe-Datei: {"erlaubt":false}
    #expect(KitStand(await nein.vertrauen.pruefe(vault: nein.vault)) == .nichtFreigegeben)
    nein.erlaube(true)
    #expect(KitStand(await nein.vertrauen.pruefe(vault: nein.vault)) == .erlaubt)
}

@Test func uebersichtRegelSchliesstBeiNeinUndWiederholtTechnischeFehlerEinmal() {
    // erlaubt: nichts zu tun, egal in welchem Versuch
    for zweiter in [false, true] { #expect(UebersichtRegel.folge(fuer: .erlaubt, zweiterVersuch: zweiter) == .offenLassen) }
    // ausdrückliches „nein“ (Abgleich hat Kit-Code geändert, Freigabe entzogen): sofort zu, ohne Wiederholung
    for zweiter in [false, true] { #expect(UebersichtRegel.folge(fuer: .nein(.nichtFreigegeben), zweiterVersuch: zweiter) == .schliessen) }
    // technischer Fehler: der erste Versuch lässt die Übersicht offen und plant EINE Wiederholung, der zweite schließt
    for g in [KitErlaubnis.Grund.pruefungFehlt, .startFehlgeschlagen, .zeitueberschreitung, .unerwarteteAusgabe] {
        #expect(UebersichtRegel.folge(fuer: .nein(g), zweiterVersuch: false) == .spaeterNochmalPruefen, "\(g)")
        #expect(UebersichtRegel.folge(fuer: .nein(g), zweiterVersuch: true) == .schliessen, "\(g)")
    }
    #expect(UebersichtRegel.wiederholungsFrist == .seconds(10))
}

@Test func anzeigePruefungFehlgeschlagenIstEinEigenerZustandOhneBittePreiszugeben() {
    let a = StatusAnzeige.kitPruefungFehlgeschlagen
    #expect(a.titel == "Kit-Prüfung fehlgeschlagen")
    #expect(!a.symbol.isEmpty && !a.zeichen.isEmpty, "immer Symbol + Text, nie nur Farbe")
    // nicht „freigeben“: Der Nutzer kann nichts freigeben, was vielleicht längst freigegeben ist
    #expect(!a.titel.lowercased().contains("freig") && !a.titel.lowercased().contains("erlaubt"))
    for andere in [StatusAnzeige.kitNichtErlaubt, .problem("x"), .ohneKit, .keinVault, .fuer(nil)] {
        #expect(a != andere)
        #expect(a.symbol != andere.symbol)
    }
}
