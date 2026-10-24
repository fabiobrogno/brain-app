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
    var vertrauen: KitVertrauen { KitVertrauen(node: node, pruefSkript: cli, umgebung: ["BRAIN_APP_SUPPORT": ordner.path], arbeitsordner: ordner) }

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

    /// Wie oft hat `brain.mjs` gelaufen?
    var kitStarts: Int { ((try? String(contentsOf: marke, encoding: .utf8)) ?? "").split(separator: "\n").count }
    var befehl: BrainBefehl { BrainBefehl(node: node, vault: vault) }
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
    let a = KitAttrappe(rumpf: "sleep 5\necho '{\"erlaubt\":true}'\n")
    a.erlaube(true)
    let start = ContinuousClock.now
    #expect(await a.vertrauen.pruefe(vault: a.vault, zeitlimit: .milliseconds(300)) == .nein(.zeitueberschreitung))
    #expect(ContinuousClock.now - start < .seconds(3), "die Prüfung darf nicht bis zum Ende der Attrappe hängen")
}

// MARK: Kein Kit-Start ohne Erlaubnis

@Test func kitStatusStartetOhneErlaubnisKeinKit() async {
    let a = KitAttrappe() // keine Freigabe: {"erlaubt":false}
    #expect(await a.vertrauen.status(a.befehl) == .gesperrt(.nichtFreigegeben))
    #expect(a.kitStarts == 0, "brain.mjs darf ohne Erlaubnis nicht laufen")
    // fehlende CLI: gleiches Bild
    let b = KitAttrappe(ohneCli: true)
    b.erlaube(true) // die Freigabe-Datei zählt nur für die Attrappen-CLI — die fehlt hier
    #expect(await b.vertrauen.status(b.befehl) == .gesperrt(.pruefungFehlt))
    #expect(b.kitStarts == 0)
    // Müll als Antwort der CLI
    let c = KitAttrappe(rumpf: "echo nichts\n")
    #expect(await c.vertrauen.status(c.befehl) == .gesperrt(.unerwarteteAusgabe))
    #expect(c.kitStarts == 0)
}

@Test func kitStatusLaeuftMitErlaubnisUndFragtJedesMalNeu() async {
    let a = KitAttrappe()
    a.erlaube(true)
    guard case .status(let s) = await a.vertrauen.status(a.befehl) else { Issue.record("erwartet: gelesener Status"); return }
    #expect(s.zustand == .ok)
    #expect(a.kitStarts == 1)
    // Vertrauen entfällt (z. B. Code geändert): der nächste Abruf startet das Kit nicht mehr
    a.erlaube(false)
    #expect(await a.vertrauen.status(a.befehl) == .gesperrt(.nichtFreigegeben))
    #expect(a.kitStarts == 1, "ohne frische Erlaubnis kein zweiter Start")
    a.erlaube(true)
    _ = await a.vertrauen.status(a.befehl)
    #expect(a.kitStarts == 2)
}

@Test func kitStatusMitDefekterAusgabeIstErlaubtAberNichtAbrufbar() async {
    let a = KitAttrappe(status: "das ist kein JSON")
    a.erlaube(true)
    guard case .nichtAbrufbar(let text) = await a.vertrauen.status(a.befehl) else { Issue.record("erwartet: nichtAbrufbar"); return }
    #expect(!text.isEmpty)
    #expect(a.kitStarts == 1)
}
