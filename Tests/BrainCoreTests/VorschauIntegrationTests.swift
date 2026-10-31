import Testing
import Foundation
import CryptoKit
@testable import BrainCore

/// Ende-zu-Ende der Vorschau mit der echten Werkstatt (Node): Die Dienste des Assistenten fahren mit Platzhaltern (`--mit-ki`) bis „Vault angelegt“,
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

private func baueDienste(_ modus: VorschauModus, echtesHome: URL, node: URL) -> (WerkstattDienste, BrueckenVerbindung) {
    // Geerbte Umgebung des „Starters“: das echte HOME (Köder) samt PATH mit dessen ~/.local/bin, Homebrew und /usr/local.
    let geerbt = ["HOME": echtesHome.path, "PATH": "\(echtesHome.path)/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
                  "GIT_CONFIG_GLOBAL": echtesHome.path + "/.gitconfig", "SSH_AUTH_SOCK": "/private/tmp/echter-agent"]
    let bruecke = BrueckenVerbindung(node: node, vault: nil, skript: werkstattSkript, umgebung: modus.kindVorgaben,
                                     arbeitsordner: modus.support, basisUmgebung: geerbt)
    let dienste = WerkstattDienste(pfade: modus.pfade, git: modus.gitPruefer(), home: modus.home) { m, p, b in
        try await bruecke.anfrage(methode: m, pfad: p, body: b)
    }
    return (dienste, bruecke)
}

@Test(.enabled(if: moeglich)) func vorschauMitKiFaehrtBisVaultKiUndProbeUndLaesstDasEchteHomeUnberuehrt() async throws {
    let node = try #require(findeNode())
    let echt = try baueEchtesHome()
    let vorher = abdruck(echt)
    let modus = VorschauModus(ordner: vorschauTempOrdner("kortex-vorschau"), mitKi: true)
    try modus.vorbereiten()
    let (dienste, bruecke) = baueDienste(modus, echtesHome: echt, node: node)
    defer { Task { await bruecke.beende() } }

    // frischer Nutzer: kein Vault
    #expect(await dienste.aktiverVault() == nil)

    // Vault anlegen ohne eigenen Ordner: Standardort ist <Vorschau-home>/Kortex
    let vault = try await dienste.legeVaultAn(art: .vorlage, name: nil, ordner: nil)
    #expect(URL(fileURLWithPath: vault.pfad).resolvingSymlinksInPath().path == modus.home.appendingPathComponent("Kortex").resolvingSymlinksInPath().path)
    #expect(FileManager.default.fileExists(atPath: modus.home.appendingPathComponent("Kortex/.git").path))
    #expect(FileManager.default.fileExists(atPath: modus.support.appendingPathComponent("vaults.json").path))
    #expect(await dienste.aktiverVault()?.name == vault.name)

    // KI: nur die Platzhalter im Vorschau-Ordner werden gefunden, nie das claude im „echten“ HOME
    // Die Versionsabfrage hat ein Zeitlimit; unter Last darf sie einmal leer bleiben — dann gilt eine Wiederholung.
    var programme = try await dienste.erkenneKIs()
    var version = programme.first { $0.id == "claude" }?.version
    for _ in 0..<3 where version == nil {
        programme = try await dienste.erkenneKIs()
        version = programme.first { $0.id == "claude" }?.version
    }
    #expect(programme.first { $0.id == "claude" }?.gefunden == true)
    #expect(version == "2.1.0")
    #expect(programme.first { $0.id == "codex" }?.gefunden == true)
    #expect(programme.first { $0.id == "cursor-agent" }?.gefunden == true)
    #expect(programme.first { $0.id == "gemini" }?.gefunden == false)

    // Verbinden schreibt nur in die Vorschau-Konfiguration
    #expect(try await dienste.verbinde(.claude, umstellen: false, profil: nil, zugriff: KiZugriff(stufe: .standard, ausdruecklich: false)) == .verbunden)
    #expect(FileManager.default.fileExists(atPath: modus.home.appendingPathComponent(".claude.json").path))
    #expect(try await dienste.verbinde(.claude, umstellen: false, profil: nil, zugriff: KiZugriff(stufe: .standard, ausdruecklich: false)) == .schonVerbunden)

    // Probe-Frage über den MCP-Server des neuen Vaults
    let ergebnis = try await dienste.probe(frage: "Vault")
    #expect(!ergebnis.treffer.isEmpty)

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
    let (dienste, bruecke) = baueDienste(modus, echtesHome: echt, node: node)
    defer { Task { await bruecke.beende() } }

    // Ein Ordner im „echten“ HOME wird abgelehnt (auch wenn ihn der Nutzer im Dialog wählt) — der Fehler ist lesbar
    do {
        _ = try await dienste.legeVaultAn(art: .leer, name: "Echt", ordner: echt.appendingPathComponent("Kortex").path)
        Issue.record("Ein Ordner im echten HOME hätte abgelehnt werden müssen")
    } catch let fehler as EinrichtungsFehler {
        #expect(fehler.meldung.contains("Vorschau"), "\(fehler.meldung)")
    }
    #expect(await dienste.aktiverVault() == nil)

    _ = try await dienste.legeVaultAn(art: .leer, name: nil, ordner: nil)
    #expect(await dienste.aktiverVault() != nil)
    let programme = try await dienste.erkenneKIs()
    #expect(programme.allSatisfy { !$0.gefunden }, "frisch installiert: keine KI — auch nicht das claude im „echten“ ~/.local/bin oder in Homebrew")
    #expect(abdruck(echt) == vorher)
}

@Test(.enabled(if: moeglich)) func vorschauOhneGitZeigtFehltUndInstalliertNichts() async throws {
    let node = try #require(findeNode())
    let echt = try baueEchtesHome()
    let modus = VorschauModus(ordner: vorschauTempOrdner("kortex-vorschau"), ohneGit: true)
    try modus.vorbereiten()
    let (dienste, bruecke) = baueDienste(modus, echtesHome: echt, node: node)
    defer { Task { await bruecke.beende() } }

    #expect(await dienste.gitStand() == .fehlt)
    #expect(await dienste.gitInstallationStarten() != .dialogAusgeloest, "der Klick „installieren“ löst in der Vorschau keinen Apple-Dialog aus")
    #expect(await dienste.gitStand() == .fehlt)
}
