import Testing
import Foundation
@testable import BrainCore

private let statusJSON = #"{"version":"0.5.1","quellVault":true,"zustand":"hinweis","meldungen":[],"zahlen":{"vorschlaege":2,"konflikte":0,"abgelaufen":1,"zuTun":3}}"#

/// Der stabile Kern-Pfad (`bin/kern`) in den Tests: ein Ordner, den es nicht geben muss — das „node“ ist eine Attrappe.
private let kernAttrappe = URL(fileURLWithPath: "/tmp/Kortex Test/bin/kern", isDirectory: true)

@Test func statusWirdAusDerLetztenZeileGelesen() async throws {
    let node = skript("#!/bin/bash\necho 'Hinweis vorab'\necho '\(statusJSON)'\n", name: "node", in: tempOrdner())
    let s = try await BrainBefehl(node: node, kern: kernAttrappe, vault: tempOrdner("Mein Brän")).status()
    #expect(s.zustand == .hinweis)
    #expect(s.quellVault)
    #expect(s.zahlen.zuTun == 3)
}

@Test func kernAufrufMitAusdruecklichemVaultUndOhneToolsOrdner() async throws {
    let node = skript("#!/bin/bash\nprintf '%s|%s|%s|%s|%s|%s' \"$BRAIN_VAULT\" \"$1\" \"$2\" \"$3\" \"$4\" \"$BRAIN_NODE\"\n", name: "node", in: tempOrdner())
    let vault = tempOrdner("Mein Brän")
    let r = try await BrainBefehl(node: node, kern: kernAttrappe, vault: vault, umgebung: ["BRAIN_NODE": "/opt/x/node"]).fuehreAus(["status"])
    // <kern>/brain.mjs --vault <vault> status — Vault zusätzlich als BRAIN_VAULT; nirgends ein Pfad im Vault
    #expect(r.ausgabe == "\(vault.path)|/tmp/Kortex Test/bin/kern/brain.mjs|--vault|\(vault.path)|status|/opt/x/node")
    #expect(!r.ausgabe.replacingOccurrences(of: vault.path, with: "").contains(".tools"))
    #expect(BrainBefehl.nodeArgumente(kern: kernAttrappe, vault: vault, ["status", "--json"])
            == ["/tmp/Kortex Test/bin/kern/brain.mjs", "--vault", vault.path, "status", "--json"])
}

@Test func einAltesToolsImVaultWirdNieAusgefuehrt() async throws {
    // Der Vault trägt ein altes .tools/brain.mjs mit Marke; der Aufruf geht an den Kern, nicht dorthin.
    let vault = tempOrdner("Alter Vault")
    let marke = vault.appendingPathComponent("marke.txt")
    try FileManager.default.createDirectory(at: vault.appendingPathComponent(".tools"), withIntermediateDirectories: true)
    try "x".write(to: vault.appendingPathComponent(".tools/brain.mjs"), atomically: true, encoding: .utf8)
    let node = skript("#!/bin/bash\ncase \"$1\" in */.tools/*) echo alt >> '\(marke.path)' ;; esac\nprintf '%s' \"$1\"\n", name: "node", in: tempOrdner())
    let r = try await BrainBefehl(node: node, kern: kernAttrappe, vault: vault).fuehreAus(["status"])
    #expect(r.ausgabe == "/tmp/Kortex Test/bin/kern/brain.mjs")
    #expect(!FileManager.default.fileExists(atPath: marke.path))
}

@Test func pfadEnthaeltImmerHomebrewUndUsrLocal() async throws {
    let node = skript("#!/bin/bash\nprintf '%s' \"$PATH\"\n", name: "node", in: tempOrdner())
    let vault = tempOrdner()
    // Minimal-PATH einer GUI-App: beide Ordner werden vorne ergänzt.
    let mager = try await BrainBefehl(node: node, kern: kernAttrappe, vault: vault, umgebung: ["PATH": "/usr/bin:/bin"]).fuehreAus([])
    #expect(mager.ausgabe == "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
    // Schon Enthaltenes wird nicht doppelt ergänzt.
    let teils = try await BrainBefehl(node: node, kern: kernAttrappe, vault: vault, umgebung: ["PATH": "/usr/local/bin:/usr/bin"]).fuehreAus([])
    #expect(teils.ausgabe == "/opt/homebrew/bin:/usr/local/bin:/usr/bin")
}

// MARK: PATH ohne leere und relative Einträge (Studio-v2-Spec §8, Review SW-3)

@Test func pfadVerwirftLeereUndRelativeEintraege() {
    func pfad(_ p: String?) -> String { BrainBefehl.pfadMitStandardOrdnern(p) }
    // Der Fall aus der Probe: ein `node_modules/.bin` vor dem echten git löste gegen das Arbeitsverzeichnis des Kindes (den Vault) auf.
    #expect(pfad("node_modules/.bin:/opt/homebrew/bin:/usr/bin:/bin") == "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin")
    #expect(pfad("./node_modules/.bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin") == "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
    // ein einzelner Punkt, ein leerer Eintrag (= aktueller Ordner), `~` (keine Shell-Erweiterung bei execvp), Zeilen mit Leerzeichen
    #expect(pfad(".:/usr/bin:/bin") == "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
    #expect(pfad("/usr/bin::/bin:") == "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
    #expect(pfad("~/bin:/usr/bin") == "/opt/homebrew/bin:/usr/local/bin:/usr/bin")
    #expect(pfad("bin/../bin:../x:/usr/bin") == "/opt/homebrew/bin:/usr/local/bin:/usr/bin")
    #expect(pfad(" /usr/bin:/bin") == "/opt/homebrew/bin:/usr/local/bin:/bin", "ein Eintrag mit führendem Leerzeichen ist relativ")
    // absolute Einträge bleiben in ihrer Reihenfolge, auch ungewöhnliche
    #expect(pfad("/b:/a:/usr/bin") == "/opt/homebrew/bin:/usr/local/bin:/b:/a:/usr/bin")
    #expect(pfad("/usr/bin:/bin:/usr/sbin:/sbin") == "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin")
}

@Test func pfadOhneBrauchbareEintraegeFaelltAufDieSystemordnerZurueck() {
    // Es bleibt nichts übrig (oder es gab nichts): Das Kind darf nicht ohne /usr/bin dastehen — dort liegt git.
    let erwartet = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    for p in [nil, "", ":", ".", "bin", "node_modules/.bin:.:", "~/bin"] as [String?] {
        #expect(BrainBefehl.pfadMitStandardOrdnern(p) == erwartet, "\(String(describing: p))")
    }
}

/// Ein Programm im Arbeitsverzeichnis darf nicht vor dem echten laufen: Der Prozess sieht nur absolute PATH-Einträge.
@Test func kindprozessErhaeltKeinenRelativenPfad() async throws {
    let node = skript("#!/bin/bash\nprintf '%s' \"$PATH\"\n", name: "node", in: tempOrdner())
    let vault = tempOrdner()
    // Ohne die Korrektur stünde hier `/opt/homebrew/bin:/usr/local/bin:node_modules/.bin:/usr/bin:.`
    let r = try await BrainBefehl(node: node, kern: kernAttrappe, vault: vault, umgebung: ["PATH": "node_modules/.bin:/usr/bin:.:"]).fuehreAus([])
    #expect(r.ausgabe == "/opt/homebrew/bin:/usr/local/bin:/usr/bin")
    for eintrag in r.ausgabe.split(separator: ":") { #expect(eintrag.hasPrefix("/"), "\(eintrag)") }
}

/// Der Fall aus dem Review (SW-3): ein fremder Vault mit `node_modules/.bin/git` und ein App-Start mit relativem PATH-Eintrag. Das
/// Programm heißt hier anders als `git`, damit der Test nicht davon abhängt, ob und wo auf diesem Mac ein echtes `git` liegt.
@Test func eingeschleustesProgrammImVaultLaeuftNicht() async throws {
    let vault = tempOrdner("Fremder Vault")
    let bin = vault.appendingPathComponent("node_modules/.bin", isDirectory: true)
    try FileManager.default.createDirectory(at: bin, withIntermediateDirectories: true)
    skript("#!/bin/sh\necho fremdes-programm-gelaufen\n", name: "brain-test-fremd", in: bin)
    let sh = URL(fileURLWithPath: "/bin/sh")
    // Kontrolle: Mit dem relativen Eintrag und dem Vault als Arbeitsverzeichnis läuft die Attrappe wirklich (sonst bewiese unten nichts)
    let roh = try await ProzessLauf.starte(sh, ["-c", "brain-test-fremd"], umgebung: ["PATH": "node_modules/.bin:/usr/bin:/bin"], ordner: vault)
    #expect(roh.ausgabe.contains("fremdes-programm-gelaufen"))
    // Mit der Umgebung, die die App ihren Kindprozessen gibt: Der Name wird nicht aufgelöst — nichts aus dem Vault läuft
    let env = NodeUmgebung.fuerKind(basis: ["PATH": "node_modules/.bin:/usr/bin:/bin"], vault: vault, vorgaben: [:])
    let sauber = try await ProzessLauf.starte(sh, ["-c", "brain-test-fremd"], umgebung: env, ordner: vault)
    #expect(!sauber.ausgabe.contains("fremdes-programm-gelaufen"), "Programm aus dem Vault ist gelaufen: \(sauber.ausgabe)")
    #expect(sauber.code == 127, "nicht gefunden (127), nicht ausgeführt")
}

@Test func zeitlimitBrichtAbOhneZuHaengen() async {
    // Das Skript liefe 60 s (`exec`: kein Kindprozess, der nach dem Abbruch weiterläuft). Die Obergrenze liegt weit über dem
    // Limit von 300 ms, damit Runner-Last den Test nicht kippt, aber weit unter der Laufzeit des Skripts: Wer wartet, scheitert.
    let node = skript("#!/bin/bash\nexec sleep 60\n", name: "node", in: tempOrdner())
    let start = ContinuousClock.now
    await #expect(throws: BefehlFehler.zeitUeberschritten) {
        _ = try await BrainBefehl(node: node, kern: kernAttrappe, vault: tempOrdner()).fuehreAus(["status"], zeitlimit: .milliseconds(300))
    }
    #expect(ContinuousClock.now - start < .seconds(30))
}

@Test func exitCodeUndFehlerausgabeWerdenWeitergegeben() async throws {
    let node = skript("#!/bin/bash\necho kaputt >&2\nexit 3\n", name: "node", in: tempOrdner())
    let r = try await BrainBefehl(node: node, kern: kernAttrappe, vault: tempOrdner()).fuehreAus([])
    #expect(r.code == 3)
    #expect(r.fehler == "kaputt\n")
}

@Test func grosseAusgabeStautNicht() async throws {
    let node = skript("#!/bin/bash\nhead -c 3000000 /dev/zero | tr '\\0' 'a'\n", name: "node", in: tempOrdner())
    let r = try await BrainBefehl(node: node, kern: kernAttrappe, vault: tempOrdner()).fuehreAus([])
    #expect(r.ausgabe.count == 3_000_000)
}

@Test func fehlendesProgrammWirdGemeldet() async {
    await #expect(throws: BefehlFehler.self) {
        _ = try await ProzessLauf.starte(URL(fileURLWithPath: "/gibt/es/nicht"), [])
    }
}

@Test func leereAusgabeIstKeinStatus() {
    #expect(throws: StatusFehler.leereAusgabe) { try BrainStatus.aus(ausgabe: "\n \n") }
}

@Test func statusTraegtAufgabenFallsVorhanden() throws {
    #expect(try BrainStatus.aus(ausgabe: statusJSON).aufgaben == nil)   // älterer Kern: kein Block
    let mit = try BrainStatus.aus(ausgabe: statusJSON.replacingOccurrences(of: "}}", with: "},\"aufgaben\":{\"offen\":4,\"ueberfaellig\":1}}"))
    #expect(mit.aufgaben == BrainStatus.Aufgaben(offen: 4, ueberfaellig: 1))
}

@Test func anzeigeHatImmerEinSymbol() throws {
    let ok = try BrainStatus.aus(ausgabe: statusJSON.replacingOccurrences(of: "\"hinweis\"", with: "\"ok\""))
    #expect(StatusAnzeige.fuer(ok) == StatusAnzeige(symbol: "checkmark.circle", zeichen: "✓", titel: "Alles in Ordnung"))
    // zuTun enthält die Vorschläge bereits — die Zahl im Titel ist nur zuTun.
    let hinweis = try BrainStatus.aus(ausgabe: statusJSON)
    #expect(StatusAnzeige.fuer(hinweis) == StatusAnzeige(symbol: "exclamationmark.triangle", zeichen: "⚠", titel: "3 Sachen warten"))
    let eine = try BrainStatus.aus(ausgabe: statusJSON
        .replacingOccurrences(of: "\"vorschlaege\":2", with: "\"vorschlaege\":1")
        .replacingOccurrences(of: "\"abgelaufen\":1", with: "\"abgelaufen\":0")
        .replacingOccurrences(of: "\"zuTun\":3", with: "\"zuTun\":1"))
    #expect(StatusAnzeige.fuer(eine).titel == "1 Sache wartet")
    let problem = try BrainStatus.aus(ausgabe: statusJSON
        .replacingOccurrences(of: "\"hinweis\"", with: "\"problem\"")
        .replacingOccurrences(of: "\"meldungen\":[]", with: "\"meldungen\":[\"Einstellungen beschädigt\"]"))
    #expect(StatusAnzeige.fuer(problem) == StatusAnzeige(symbol: "xmark.octagon", zeichen: "✕", titel: "Einstellungen beschädigt"))
    #expect(StatusAnzeige.fuer(nil).zeichen == "?")
    #expect(StatusAnzeige.problem("Brain-Ordner nicht gefunden").zeichen == "✕")
}

/// Großzügiges Zeitlimit nur für die Tests: Die Attrappen-Shell ist ein frisch geschriebenes Skript, dessen erster Start auf einem
/// ausgelasteten Mac (paralleles `swift test`) Sekunden dauern kann. Das 3-s-Limit der App bleibt unverändert; geprüft wird hier
/// die Auswertung der Ausgabe, nicht die Startzeit.
private let attrappenZeitlimit = Duration.seconds(60)

@Test func terminalNodeNimmtDieLetzteAbsolutePfadZeile() async {
    let shell = skript("#!/bin/bash\necho 'Willkommen'\necho /bin/ls\n", name: "zsh", in: tempOrdner())
    #expect(await TerminalNode.finde(shell: shell, zeitlimit: attrappenZeitlimit) == URL(fileURLWithPath: "/bin/ls"))
}

@Test func terminalNodeOhneTrefferIstNil() async {
    let o = tempOrdner()
    #expect(await TerminalNode.finde(shell: skript("#!/bin/bash\necho relativ/node\n", name: "a", in: o), zeitlimit: attrappenZeitlimit) == nil)
    #expect(await TerminalNode.finde(shell: skript("#!/bin/bash\nexit 1\n", name: "b", in: o), zeitlimit: attrappenZeitlimit) == nil)
}
