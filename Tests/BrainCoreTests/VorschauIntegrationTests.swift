import Testing
import Foundation
import CryptoKit
@testable import BrainCore

/// Ende-zu-Ende der Vorschau mit der echten Werkstatt (Node): Die Routen des Assistenten (Vault anlegen, KI erkennen, verbinden, Probe) fahren mit Platzhaltern (`--mit-ki`) bis „Vault angelegt“,
/// KI verbunden und Probe — und danach ist außerhalb des Vorschau-Ordners NICHTS entstanden oder verändert.
/// Das „echte“ HOME ist ein Temp-Ordner mit Ködern (eigene .gitconfig, .claude.json, ein claude im „echten“ ~/.local/bin); die
/// geerbte Umgebung der Kindprozesse ist ausdrücklich synthetisch (`basisUmgebung`): das echte HOME dieses Rechners kommt nicht vor.
/// Läuft nur, wenn `node` im PATH liegt und das Skript im Repo gefunden wird (sonst übersprungen).
private func repoWurzel() -> URL {
    URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
}

private func findeNode() -> URL? {
    let pfad = ProcessInfo.processInfo.environment["PATH"] ?? ""
    return pfad.split(separator: ":").map { URL(fileURLWithPath: String($0)).appendingPathComponent("node") }
        .first { FileManager.default.isExecutableFile(atPath: $0.path) }
}

private let werkstattSkript = repoWurzel().appendingPathComponent("Ressourcen/werkstatt/werkstatt.mjs")
private let moeglich = findeNode() != nil && FileManager.default.fileExists(atPath: werkstattSkript.path)

/// Ein „echtes“ HOME mit Ködern, das die Vorschau nie anfassen darf.
private func baueEchtesHome() throws -> URL {
    let h = tempOrdner("echtes-home")
    let fm = FileManager.default
    try "[user]\n\tname = Echt\n".write(to: h.appendingPathComponent(".gitconfig"), atomically: true, encoding: .utf8)
    try "{}\n".write(to: h.appendingPathComponent(".claude.json"), atomically: true, encoding: .utf8)
    try fm.createDirectory(at: h.appendingPathComponent(".local/bin"), withIntermediateDirectories: true)
    try fm.createDirectory(at: h.appendingPathComponent("Library/Keychains"), withIntermediateDirectories: true)
    let protokoll = h.appendingPathComponent("koeder-aufrufe.txt").path
    skript("#!/bin/sh\necho \"$*\" >> '\(protokoll)'\nexit 0\n", name: "claude", in: h.appendingPathComponent(".local/bin"))
    return h
}

/// Fingerabdruck des ganzen Ordners: Pfad, Art, Größe, Änderungszeit und Inhalt jeder Datei.
private func abdruck(_ ordner: URL) -> [String] {
    let fm = FileManager.default
    guard let e = fm.enumerator(at: ordner, includingPropertiesForKeys: [.isDirectoryKey, .contentModificationDateKey, .fileSizeKey]) else { return [] }
    return (e.allObjects as? [URL] ?? []).map { u in
        let v = try? u.resourceValues(forKeys: [.isDirectoryKey, .contentModificationDateKey, .fileSizeKey])
        let istOrdner = v?.isDirectory == true
        let inhalt = istOrdner ? "" : ((try? Data(contentsOf: u)).map { SHA256.hash(data: $0).map { String(format: "%02x", $0) }.joined() } ?? "?")
        return "\(u.path) \(istOrdner ? "D" : "F") \(v?.fileSize ?? 0) \(v?.contentModificationDate?.timeIntervalSince1970 ?? 0) \(inhalt)"
    }.sorted()
}

/// Die Routen der Werkstatt, wie sie der Assistent früher aufrief — jetzt nur noch als Testhilfe über die Brücke.
private struct Routen {
    let modus: VorschauModus
    let bruecke: BrueckenVerbindung

    func rufe(_ methode: String, _ pfad: String, _ body: [String: Any]? = nil) async throws -> [String: Any] {
        let daten = try body.map { try JSONSerialization.data(withJSONObject: $0) }
        return try WerkstattAntwort.auswerten(try await bruecke.anfrage(methode: methode, pfad: pfad, body: daten))
    }

    /// Name des aktiven Vaults laut `vaults.json` (der Ordner muss existieren), sonst nil.
    func aktiverVaultName() -> String? {
        guard let url = VaultListe.aktiverVault(modus.pfade, home: modus.home) else { return nil }
        var istOrdner: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &istOrdner), istOrdner.boolValue else { return nil }
        return VaultListe.lade(modus.pfade, home: modus.home)?.anzeigename(fuer: url) ?? url.lastPathComponent
    }

    func legeVaultAn(art: String, name: String?, ordner: String?) async throws -> (name: String, pfad: String) {
        var b: [String: Any] = ["art": art]
        if let name { b["name"] = name }
        if let ordner { b["ordner"] = ordner }
        let j = try await rufe("POST", "/api/vaults/neu", b)
        let v = try #require(j["vault"] as? [String: Any])
        return (try #require(v["name"] as? String), try #require(v["pfad"] as? String))
    }

    /// Die Antwort von `/api/ki/erkennen`: Agenten (Befehl) und Programme (App oder Befehl).
    func erkenneKIs() async throws -> [String: Any] { try await rufe("GET", "/api/ki/erkennen?neu=1") }

    func verbindeClaude() async throws -> Bool {
        let j = try await rufe("POST", "/api/mcp/verbinden", ["ziel": "claude", "zugriff": "posteingang"])
        return (j["schonVerbunden"] as? Bool) == true
    }
}

private func agent(_ j: [String: Any], _ id: String) -> [String: Any]? {
    (j["agenten"] as? [[String: Any]])?.first { $0["id"] as? String == id }
}
private func gefunden(_ j: [String: Any], _ id: String) -> Bool {
    agent(j, id)?["pfad"] is String
        || ((j["programme"] as? [[String: Any]])?.first { $0["id"] as? String == id }?["gefunden"] as? Bool) == true
}

private func baueRouten(_ modus: VorschauModus, echtesHome: URL, node: URL) -> (Routen, BrueckenVerbindung) {
    // Geerbte Umgebung des „Starters“: das echte HOME (Köder) samt PATH mit dessen ~/.local/bin, Homebrew und /usr/local.
    let geerbt = ["HOME": echtesHome.path, "PATH": "\(echtesHome.path)/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
                  "GIT_CONFIG_GLOBAL": echtesHome.path + "/.gitconfig", "SSH_AUTH_SOCK": "/private/tmp/echter-agent"]
    let bruecke = BrueckenVerbindung(node: node, vault: nil, skript: werkstattSkript, umgebung: modus.kindVorgaben,
                                     arbeitsordner: modus.support, basisUmgebung: geerbt)
    return (Routen(modus: modus, bruecke: bruecke), bruecke)
}

@Test(.enabled(if: moeglich)) func vorschauMitKiFaehrtBisVaultKiUndProbeUndLaesstDasEchteHomeUnberuehrt() async throws {
    let node = try #require(findeNode())
    let echt = try baueEchtesHome()
    let vorher = abdruck(echt)
    let modus = VorschauModus(ordner: vorschauTempOrdner("kortex-vorschau"), mitKi: true)
    try modus.vorbereiten()
    let (dienste, bruecke) = baueRouten(modus, echtesHome: echt, node: node)
    defer { Task { await bruecke.beende() } }

    // frischer Nutzer: kein Vault
    #expect(dienste.aktiverVaultName() == nil)

    // Vault anlegen ohne eigenen Ordner: Standardort ist <Vorschau-home>/Kortex
    let vault = try await dienste.legeVaultAn(art: "vorlage", name: nil, ordner: nil)
    #expect(URL(fileURLWithPath: vault.pfad).resolvingSymlinksInPath().path == modus.home.appendingPathComponent("Kortex").resolvingSymlinksInPath().path)
    #expect(FileManager.default.fileExists(atPath: modus.home.appendingPathComponent("Kortex/.git").path))
    #expect(FileManager.default.fileExists(atPath: modus.support.appendingPathComponent("vaults.json").path))
    #expect(dienste.aktiverVaultName() == vault.name)

    // KI: nur die Platzhalter im Vorschau-Ordner werden gefunden, nie das claude im „echten“ HOME
    // Die Versionsabfrage hat ein Zeitlimit; unter Last darf sie einmal leer bleiben — dann gilt eine Wiederholung.
    var kis = try await dienste.erkenneKIs()
    var version = agent(kis, "claude")?["version"] as? String
    for _ in 0..<3 where version == nil {
        kis = try await dienste.erkenneKIs()
        version = agent(kis, "claude")?["version"] as? String
    }
    #expect(gefunden(kis, "claude"))
    #expect(version == "2.1.0")
    #expect(gefunden(kis, "codex"))
    #expect(gefunden(kis, "cursor-agent"))
    #expect(!gefunden(kis, "gemini"))

    // Verbinden schreibt nur in die Vorschau-Konfiguration
    #expect(try await dienste.verbindeClaude() == false, "erstes Verbinden trägt ein")
    #expect(FileManager.default.fileExists(atPath: modus.home.appendingPathComponent(".claude.json").path))
    #expect(try await dienste.verbindeClaude() == true, "zweites Verbinden: schon verbunden")

    // Probe-Frage über den MCP-Server des neuen Vaults
    let ergebnis = try await dienste.rufe("POST", "/api/probe", ["frage": "Vault"])
    #expect(!(ergebnis["treffer"] as? [Any] ?? []).isEmpty)

    // Nichts außerhalb des Vorschau-Ordners
    #expect(abdruck(echt) == vorher, "das „echte“ HOME ist unverändert")
    #expect(!FileManager.default.fileExists(atPath: echt.appendingPathComponent("koeder-aufrufe.txt").path), "das Köder-claude wurde nie gestartet")
    #expect(!FileManager.default.fileExists(atPath: echt.appendingPathComponent("Kortex").path))
}

@Test(.enabled(if: moeglich)) func vorschauOhneKiFindetKeineKIUndLehntOrdnerAusserhalbAb() async throws {
    let node = try #require(findeNode())
    let echt = try baueEchtesHome()
    let vorher = abdruck(echt)
    let modus = VorschauModus(ordner: vorschauTempOrdner("kortex-vorschau"))
    try modus.vorbereiten()
    let (dienste, bruecke) = baueRouten(modus, echtesHome: echt, node: node)
    defer { Task { await bruecke.beende() } }

    // Ein Ordner im „echten“ HOME wird abgelehnt (auch wenn ihn der Nutzer im Dialog wählt) — der Fehler ist lesbar
    do {
        _ = try await dienste.legeVaultAn(art: "leer", name: "Echt", ordner: echt.appendingPathComponent("Kortex").path)
        Issue.record("Ein Ordner im echten HOME hätte abgelehnt werden müssen")
    } catch let fehler as EinrichtungsFehler {
        #expect(fehler.meldung.contains("Vorschau"), "\(fehler.meldung)")
    }
    #expect(dienste.aktiverVaultName() == nil)

    _ = try await dienste.legeVaultAn(art: "leer", name: nil, ordner: nil)
    #expect(dienste.aktiverVaultName() != nil)
    let kis = try await dienste.erkenneKIs()
    let alle = ((kis["agenten"] as? [[String: Any]] ?? []).map { $0["pfad"] is String }
        + (kis["programme"] as? [[String: Any]] ?? []).map { ($0["gefunden"] as? Bool) == true } + [(kis["cursorDa"] as? Bool) == true])
    #expect(alle.allSatisfy { !$0 }, "frisch installiert: keine KI — auch nicht das claude im „echten“ ~/.local/bin oder in Homebrew")
    #expect(abdruck(echt) == vorher)
}

@Test func vorschauOhneGitZeigtFehltUndInstalliertNichts() async throws {
    let modus = VorschauModus(ordner: vorschauTempOrdner("kortex-vorschau"), ohneGit: true)
    try modus.vorbereiten()
    let git = modus.gitPruefer()

    #expect(await git.pruefe() == .fehlt)
    #expect(await git.starteInstallation() != .dialogAusgeloest, "der Klick „installieren“ löst in der Vorschau keinen Apple-Dialog aus")
    #expect(await git.pruefe() == .fehlt)
}

/// „Frag deinen Vault“ in der Vorschau, Ende zu Ende mit der echten Werkstatt: Die Frage erreicht den claude-Platzhalter (KORTEX_VORSCHAU kommt an), der gekennzeichnet antwortet und
/// echte Seiten des neuen Vaults nennt. Davor scheiterte sie mit „Vorschau-Schutz: KORTEX_VORSCHAU fehlt“.
@Test(.enabled(if: moeglich)) func vorschauFragBekommtEineGekennzeichneteBeispielantwort() async throws {
    let node = try #require(findeNode())
    let echt = try baueEchtesHome()
    let vorher = abdruck(echt)
    let modus = VorschauModus(ordner: vorschauTempOrdner("kortex-vorschau"), mitKi: true)
    try modus.vorbereiten()
    let (dienste, bruecke) = baueRouten(modus, echtesHome: echt, node: node)
    defer { Task { await bruecke.beende() } }

    _ = try await dienste.legeVaultAn(art: "vorlage", name: nil, ordner: nil)
    for _ in 0..<3 {
        let kis = try await dienste.erkenneKIs()
        if gefunden(kis, "claude") { break }
    }
    _ = try await dienste.rufe("POST", "/api/mcp/verbinden", ["ziel": "claude", "zugriff": "lesen"])
    let bereit = try await dienste.rufe("GET", "/api/frage/bereit")
    #expect(bereit["claude"] as? Bool == true)
    let konto = try #require((bereit["konten"] as? [[String: Any]])?.first { $0["erlaubt"] as? Bool == true }?["id"] as? String)

    let start = try await dienste.rufe("POST", "/api/frage/start", ["frage": "Wie funktioniert dein Vault?", "konto": konto])
    let id = try #require(start["id"] as? String)
    var stand: [String: Any] = [:]
    for _ in 0..<150 where stand["fertig"] as? Bool != true {
        stand = try await dienste.rufe("GET", "/api/frage/stand?id=\(id)&ab=0&text=0&epoche=0")
        try await Task.sleep(for: .milliseconds(100))
    }
    let ergebnis = try #require(stand["ergebnis"] as? [String: Any], "die Frage wurde nicht fertig")
    #expect(ergebnis["ok"] as? Bool == true, "\(ergebnis)")
    let text = try #require(ergebnis["text"] as? String)
    #expect(text.hasPrefix("Vorschau: So würde eine Antwort aussehen"), "\(text)")
    #expect(text.contains("[[") && text.contains(".md]]"), "die Antwort nennt Seiten des Vaults: \(text)")
    #expect(!((stand["quellen"] as? [[String: Any]]) ?? []).isEmpty, "die genannten Seiten erscheinen als Quellen")
    #expect(abdruck(echt) == vorher, "das „echte“ HOME ist unverändert")
}
