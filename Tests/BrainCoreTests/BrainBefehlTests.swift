import Testing
import Foundation
@testable import BrainCore

private let statusJSON = #"{"version":"0.5.1","quellVault":true,"zustand":"hinweis","meldungen":[],"zahlen":{"vorschlaege":2,"konflikte":0,"abgelaufen":1,"zuTun":3}}"#

@Test func statusWirdAusDerLetztenZeileGelesen() async throws {
    let node = skript("#!/bin/bash\necho 'Hinweis vorab'\necho '\(statusJSON)'\n", name: "node", in: tempOrdner())
    let s = try await BrainBefehl(node: node, vault: tempOrdner("Mein Brän")).status()
    #expect(s.zustand == .hinweis)
    #expect(s.quellVault)
    #expect(s.zahlen.zuTun == 3)
}

@Test func vaultMitLeerzeichenKommtAlsArgumentUndUmgebungAn() async throws {
    let node = skript("#!/bin/bash\nprintf '%s|%s|%s' \"$BRAIN_VAULT\" \"$1\" \"$BRAIN_NODE\"\n", name: "node", in: tempOrdner())
    let vault = tempOrdner("Mein Brän")
    let r = try await BrainBefehl(node: node, vault: vault, umgebung: ["BRAIN_NODE": "/opt/x/node"]).fuehreAus(["status"])
    #expect(r.ausgabe == "\(vault.path)|\(vault.appendingPathComponent(".tools/brain.mjs").path)|/opt/x/node")
}

@Test func pfadEnthaeltImmerHomebrewUndUsrLocal() async throws {
    let node = skript("#!/bin/bash\nprintf '%s' \"$PATH\"\n", name: "node", in: tempOrdner())
    let vault = tempOrdner()
    // Minimal-PATH einer GUI-App: beide Ordner werden vorne ergänzt.
    let mager = try await BrainBefehl(node: node, vault: vault, umgebung: ["PATH": "/usr/bin:/bin"]).fuehreAus([])
    #expect(mager.ausgabe == "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
    // Schon Enthaltenes wird nicht doppelt ergänzt.
    let teils = try await BrainBefehl(node: node, vault: vault, umgebung: ["PATH": "/usr/local/bin:/usr/bin"]).fuehreAus([])
    #expect(teils.ausgabe == "/opt/homebrew/bin:/usr/local/bin:/usr/bin")
}

@Test func zeitlimitBrichtAbOhneZuHaengen() async {
    let node = skript("#!/bin/bash\nsleep 5\n", name: "node", in: tempOrdner())
    let start = ContinuousClock.now
    await #expect(throws: BefehlFehler.zeitUeberschritten) {
        _ = try await BrainBefehl(node: node, vault: tempOrdner()).fuehreAus(["status"], zeitlimit: .milliseconds(300))
    }
    #expect(ContinuousClock.now - start < .seconds(3))
}

@Test func exitCodeUndFehlerausgabeWerdenWeitergegeben() async throws {
    let node = skript("#!/bin/bash\necho kaputt >&2\nexit 3\n", name: "node", in: tempOrdner())
    let r = try await BrainBefehl(node: node, vault: tempOrdner()).fuehreAus([])
    #expect(r.code == 3)
    #expect(r.fehler == "kaputt\n")
}

@Test func grosseAusgabeStautNicht() async throws {
    let node = skript("#!/bin/bash\nhead -c 3000000 /dev/zero | tr '\\0' 'a'\n", name: "node", in: tempOrdner())
    let r = try await BrainBefehl(node: node, vault: tempOrdner()).fuehreAus([])
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

@Test func terminalNodeNimmtDieLetzteAbsolutePfadZeile() async {
    let shell = skript("#!/bin/bash\necho 'Willkommen'\necho /bin/ls\n", name: "zsh", in: tempOrdner())
    #expect(await TerminalNode.finde(shell: shell) == URL(fileURLWithPath: "/bin/ls"))
}

@Test func terminalNodeOhneTrefferIstNil() async {
    let o = tempOrdner()
    #expect(await TerminalNode.finde(shell: skript("#!/bin/bash\necho relativ/node\n", name: "a", in: o)) == nil)
    #expect(await TerminalNode.finde(shell: skript("#!/bin/bash\nexit 1\n", name: "b", in: o)) == nil)
}
