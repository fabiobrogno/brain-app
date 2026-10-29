import Testing
import Foundation
import CryptoKit
@testable import BrainCore

/// Ende-zu-Ende über den ECHTEN Starter (`Laufzeit.schreibeStarter`), echtes Node und den echten Kern aus `Ressourcen/kern`:
/// Der Kern-Installer trägt Hooks bei Claude Code ein, und die Einträge zeigen nur auf den stabilen Pfad (`bin/kortex`, `bin/kern`) —
/// nie auf einen Versionsordner oder das App-Paket. Nach einem „App-Update“ (neue Version, `bin/kern` zeigt auf sie, die alte
/// Version ist weg) laufen dieselben Einträge unverändert weiter; ohne Starter enden sie still mit Exit 0.
/// Nur Temp-Ordner (eigenes HOME, eigener Support-Ordner); nie das echte ~/.claude, nie launchctl.
/// Läuft nur, wenn `node` im PATH liegt und der Kern im Repo gefunden wird (sonst übersprungen).
private func repoWurzel() -> URL {
    URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
}

private func findeNode() -> URL? {
    let pfad = ProcessInfo.processInfo.environment["PATH"] ?? ""
    return pfad.split(separator: ":").map { URL(fileURLWithPath: String($0)).appendingPathComponent("node") }
        .first { FileManager.default.isExecutableFile(atPath: $0.path) }
}

private let kernQuelle = repoWurzel().appendingPathComponent("Ressourcen/kern", isDirectory: true)
private let moeglich = findeNode() != nil && FileManager.default.fileExists(atPath: kernQuelle.appendingPathComponent("brain.mjs").path)

private struct Lauf { let status: Int32; let aus: String; let fehler: String }

private func fuehreAus(_ programm: String, _ args: [String], umgebung: [String: String], eingabe: String = "") -> Lauf {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: programm)
    p.arguments = args
    p.environment = umgebung
    let o = Pipe(), e = Pipe(), i = Pipe()
    p.standardOutput = o
    p.standardError = e
    p.standardInput = i
    try! p.run()
    i.fileHandleForWriting.write(Data(eingabe.utf8))
    try? i.fileHandleForWriting.close()
    let aus = o.fileHandleForReading.readDataToEndOfFile()
    let fehler = e.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    return Lauf(status: p.terminationStatus, aus: String(decoding: aus, as: UTF8.self), fehler: String(decoding: fehler, as: UTF8.self))
}

/// Ein nachgebautes App-Paket (`Contents/Resources`): „Node“ ist ein Skript, das das echte Node startet; der Kern ist eine Kopie von `Ressourcen/kern`
/// samt Manifest. `appVersion` bestimmt den Ordner `kern/<version>`.
private func paket(node: URL) throws -> URL {
    let fm = FileManager.default
    let res = tempOrdner("Resources")
    let nodeQ = res.appendingPathComponent("node-runtime")
    try fm.createDirectory(at: nodeQ.appendingPathComponent("bin"), withIntermediateDirectories: true)
    let inhalt = "#!/bin/sh\nexec '\(node.path)' \"$@\"\n"
    skript(inhalt, name: "bin/node", in: nodeQ)
    let summe = SHA256.hash(data: Data(inhalt.utf8)).map { String(format: "%02x", $0) }.joined()
    try #"{"version":"v0.0.0-test","sha256":"\#(summe)"}"#.write(to: nodeQ.appendingPathComponent("manifest.json"), atomically: true, encoding: .utf8)
    let kern = res.appendingPathComponent("kern")
    try fm.copyItem(at: kernQuelle, to: kern)
    var dateien: [String: String] = [:]
    for case let rel as String in fm.enumerator(atPath: kern.path)! {
        var istOrdner: ObjCBool = false
        fm.fileExists(atPath: kern.appendingPathComponent(rel).path, isDirectory: &istOrdner)
        if !istOrdner.boolValue { dateien[rel] = try Laufzeit.sha256(kern.appendingPathComponent(rel)) }
    }
    try JSONEncoder().encode(KernManifest(schema: 1, dateien: dateien)).write(to: res.appendingPathComponent("kern-manifest.json"))
    return res
}

private struct Umgebung {
    let pfade: AppPfade
    let home: URL
    let vault: URL
    let node: URL

    init() throws {
        node = try #require(findeNode())
        pfade = AppPfade(basis: tempOrdner("Application Support/Kortex"))
        home = tempOrdner("home")
        vault = tempOrdner("Mein Brain")
        try "{}\n".write(to: vault.appendingPathComponent("brain.config.json"), atomically: true, encoding: .utf8)
    }

    func installiere(version: String, ressourcen: URL) throws {
        let ergebnis = try Laufzeit(ressourcen: ressourcen, appVersion: version, pfade: pfade).installiere()
        #expect(ergebnis.meldungen.isEmpty, "\(ergebnis.meldungen)")
    }

    /// Die Umgebung, in der Claude Code einen Hook (oder die Einrichtung) startet: kein KORTEX_KERN_PFAD, kein Testschalter außer dem einen.
    var env: [String: String] {
        ["PATH": "/usr/bin:/bin", "HOME": home.path, "BRAIN_APP_SUPPORT": pfade.basis.path, "BRAIN_VAULT": vault.path,
         "KORTEX_KERN_UNSTABIL_ERLAUBT": "1", "KORTEX_KERN_TEMP_WURZELN": "",
         // Workspace-Trust (P5): der Wegwerf-Vault gilt als vertraut (gilt nur zusammen mit einem Testflag)
         "KORTEX_VAULT_VERTRAUT": "alle"]
    }
    var settings: URL { home.appendingPathComponent(".claude/settings.json") }
    func lies() throws -> [String: Any] {
        try #require(try JSONSerialization.jsonObject(with: Data(contentsOf: settings)) as? [String: Any])
    }
    func befehle(_ s: [String: Any]) -> [String] {
        let hooks = s["hooks"] as? [String: [[String: Any]]] ?? [:]
        let h = hooks.values.flatMap { $0 }.flatMap { ($0["hooks"] as? [[String: Any]]) ?? [] }.compactMap { $0["command"] as? String }
        return h + [((s["statusLine"] as? [String: Any])?["command"] as? String)].compactMap { $0 }
    }
    func shell(_ befehl: String, eingabe: String = "{}") -> Lauf { fuehreAus("/bin/sh", ["-c", befehl], umgebung: env, eingabe: eingabe) }
    func starter(_ args: [String]) -> Lauf { fuehreAus(pfade.starter.path, args, umgebung: env) }
}

@Test(.enabled(if: moeglich)) func einrichtenUeberDenStarterTraegtNurStabilePfadeEinUndUeberstehtEinAppUpdate() throws {
    let u = try Umgebung()
    let res1 = try paket(node: u.node)
    try u.installiere(version: "1.0.0", ressourcen: res1)

    // Alte Einträge (Vault-Ordner mit dem früheren Kit, früherer Kern-Ort) und Fremdes: Fremdes bleibt, Altes wird ersetzt.
    try FileManager.default.createDirectory(at: u.settings.deletingLastPathComponent(), withIntermediateDirectories: true)
    let alt = ["hooks": ["SessionStart": [["hooks": [["type": "command", "command": "node \"\(u.vault.path)/.tools/session-start.mjs\""]]],
                                          ["hooks": [["type": "command", "command": "fremd.sh"]]]],
                         "UserPromptSubmit": [["hooks": [["type": "command", "command": "/bin/sh '/alter/kern/node-start.sh' '/alter/kern/adapters/claude-code/brain-hint.mjs'"]]]]],
               "statusLine": ["type": "command", "command": "node \"\(u.vault.path)/.tools/statusline.sh\""]] as [String: Any]
    try JSONSerialization.data(withJSONObject: alt).write(to: u.settings)

    let an = u.starter(["claude-hooks", "--vault", u.vault.path])
    #expect(an.status == 0, "\(an.fehler)")
    let s = try u.lies()
    let alle = u.befehle(s)
    let eigene = alle.filter { $0.contains(" hook ") }
    #expect(eigene.count == 9 + 1, "neun Hooks und die Statuszeile: \(eigene)")
    #expect(alle.contains("fremd.sh"))
    let starterQ = "'\(u.pfade.starter.path)'"
    for c in eigene {
        #expect(c.hasPrefix("[ -x \(starterQ) ] && exec \(starterQ) hook ") && c.hasSuffix(" || exit 0"), "\(c)")
    }
    // Keine Versionsordner, keine Pfade im App-Paket, keine Alt-Pfade, kein fester Vault:
    let text = String(decoding: try Data(contentsOf: u.settings), as: UTF8.self)
    #expect(!text.contains("/kern/1.0.0") && !text.contains(".app/") && !text.contains(".tools") && !text.contains("/alter/kern"))
    #expect(!text.contains(u.vault.path) && !text.contains("--vault"))
    #expect(!text.contains("node-start.sh"))

    // Der Hook läuft wirklich (echte Shell → Starter → Node → Kern) …
    let statuszeile = try #require((s["statusLine"] as? [String: Any])?["command"] as? String)
    let l1 = u.shell(statuszeile)
    #expect(l1.status == 0, "\(l1.fehler)")
    #expect(l1.fehler.isEmpty)

    // … und ein zweiter Lauf des Einrichtens ändert nichts.
    let vorher = try Data(contentsOf: u.settings)
    let nochmal = u.starter(["claude-hooks", "--vault", u.vault.path])
    #expect(nochmal.status == 0 && nochmal.aus.contains("unverändert"), "\(nochmal.aus) \(nochmal.fehler)")
    #expect(try Data(contentsOf: u.settings) == vorher)

    // App-Update: neue Version, bin/kern zeigt auf sie, die alte ist weg. Dieselben Einträge laufen unverändert weiter.
    let res2 = try paket(node: u.node)
    try u.installiere(version: "2.0.0", ressourcen: res2)
    try FileManager.default.removeItem(at: u.pfade.kernOrdner.appendingPathComponent("1.0.0"))
    #expect((try? FileManager.default.destinationOfSymbolicLink(atPath: u.pfade.kern.path)) == "../kern/2.0.0")
    let l2 = u.shell(statuszeile)
    #expect(l2.status == 0 && l2.fehler.isEmpty, "\(l2.fehler)")
    let nachUpdate = u.starter(["claude-hooks", "--vault", u.vault.path])
    #expect(nachUpdate.status == 0 && nachUpdate.aus.contains("unverändert"), "Einträge zeigen nur auf bin/kortex und bin/kern: \(nachUpdate.aus)")
    #expect(try Data(contentsOf: u.settings) == vorher)

    // Rückweg über den Starter: nur Kortex verschwindet.
    let aus = u.starter(["claude-hooks", "--entfernen"])
    #expect(aus.status == 0, "\(aus.fehler)")
    let nach = u.befehle(try u.lies())
    #expect(nach == ["fremd.sh"])
}

@Test(.enabled(if: moeglich)) func fehlenderStarterOderKernBeendetJedenEingetragenenHookStillMitExitNull() throws {
    let u = try Umgebung()
    try u.installiere(version: "1.0.0", ressourcen: try paket(node: u.node))
    #expect(u.starter(["claude-hooks", "--vault", u.vault.path]).status == 0)
    let eigene = u.befehle(try u.lies()).filter { $0.contains(" hook ") }
    #expect(eigene.count == 10)

    // 1) Kern weg (App gelöscht, Support-Ordner teilweise aufgeräumt): der Starter beendet den Hook still.
    try FileManager.default.removeItem(at: u.pfade.kernOrdner)
    for c in eigene {
        let l = u.shell(c)
        #expect(l.status == 0 && l.aus.isEmpty && l.fehler.isEmpty, "Kern fehlt: \(c): \(l.aus) \(l.fehler)")
    }
    // 2) Starter weg: der Befehl selbst beendet sich still.
    try FileManager.default.removeItem(at: u.pfade.starter)
    for c in eigene {
        let l = u.shell(c)
        #expect(l.status == 0 && l.aus.isEmpty && l.fehler.isEmpty, "Starter fehlt: \(c): \(l.aus) \(l.fehler)")
    }
}

@Test(.enabled(if: moeglich)) func installerOhneStabilenKernPfadVerweigertUndSchreibtNichts() throws {
    // Direkt mit Node gestartet (nicht über den Starter): KORTEX_KERN_PFAD fehlt → Exit 3, settings.json bleibt, wie sie war.
    let u = try Umgebung()
    try u.installiere(version: "1.0.0", ressourcen: try paket(node: u.node))
    var e = u.env
    e["KORTEX_KERN_UNSTABIL_ERLAUBT"] = nil
    e["BRAIN_TESTMODUS"] = "1" // Testflag für den Vertrauens-Schalter (P5), ohne den Kern-Pfad-Schalter
    let brain = u.pfade.kern.appendingPathComponent("brain.mjs").path
    let l = fuehreAus(u.node.path, [brain, "claude-hooks", "--vault", u.vault.path], umgebung: e)
    #expect(l.status == 3, "\(l.aus) \(l.fehler)")
    #expect(!FileManager.default.fileExists(atPath: u.settings.path))
}
