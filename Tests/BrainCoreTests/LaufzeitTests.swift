import Testing
import Foundation
import CryptoKit
@testable import BrainCore

// MARK: Hilfen

private func sha(_ text: String) -> String {
    SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
}

/// Nachgebautes `Contents/Resources` mit Node (und auf Wunsch Kern + Manifest).
private struct Paket {
    let ressourcen: URL

    init(nodeVersion: String = "v24.0.0", nodeInhalt: String = "#!/bin/sh\necho v24.0.0\n", falscheNodeSumme: Bool = false) {
        ressourcen = tempOrdner("Resources")
        let q = ressourcen.appendingPathComponent("node-runtime")
        try! FileManager.default.createDirectory(at: q.appendingPathComponent("bin"), withIntermediateDirectories: true)
        skript(nodeInhalt, name: "bin/node", in: q)
        let summe = falscheNodeSumme ? String(repeating: "0", count: 64) : sha(nodeInhalt)
        try! #"{"version":"\#(nodeVersion)","sha256":"\#(summe)"}"#
            .write(to: q.appendingPathComponent("manifest.json"), atomically: true, encoding: .utf8)
    }

    /// Kern-Ordner + kern-manifest.json; `manifestFuer` kann Dateien auslassen/ändern, um Abweichungen zu bauen.
    func kern(_ dateien: [String: String], manifest: [String: String]? = nil) {
        let k = ressourcen.appendingPathComponent("kern")
        try? FileManager.default.removeItem(at: k)
        for (pfad, inhalt) in dateien {
            let ziel = k.appendingPathComponent(pfad)
            try! FileManager.default.createDirectory(at: ziel.deletingLastPathComponent(), withIntermediateDirectories: true)
            try! inhalt.write(to: ziel, atomically: true, encoding: .utf8)
        }
        let soll = manifest ?? dateien.mapValues(sha)
        let json = try! JSONEncoder().encode(KernManifest(schema: 1, dateien: soll))
        try! json.write(to: ressourcen.appendingPathComponent("kern-manifest.json"))
    }

    func laufzeit(_ pfade: AppPfade, version: String = "1.0.0") -> Laufzeit {
        Laufzeit(ressourcen: ressourcen, appVersion: version, pfade: pfade)
    }
}

private let kernDateien = ["brain.mjs": "console.log('kern')\n", "lib/hilfe.mjs": "export const a = 1\n"]

private func ziel(_ link: URL) -> String? { try? FileManager.default.destinationOfSymbolicLink(atPath: link.path) }

private func kernVersionen(_ p: AppPfade) -> [String] {
    ((try? FileManager.default.contentsOfDirectory(atPath: p.kernOrdner.path)) ?? []).filter { !$0.hasPrefix(".") }.sorted()
}

private struct Lauf { let status: Int32; let aus: String; let fehler: String }

private func starte(_ url: URL, _ args: [String] = []) -> Lauf {
    let p = Process()
    p.executableURL = url
    p.arguments = args
    let o = Pipe(), e = Pipe()
    p.standardOutput = o
    p.standardError = e
    try! p.run()
    let aus = o.fileHandleForReading.readDataToEndOfFile()
    let fehler = e.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    return Lauf(status: p.terminationStatus, aus: String(decoding: aus, as: UTF8.self), fehler: String(decoding: fehler, as: UTF8.self))
}

// MARK: Node (unverändertes Verhalten)

@Test func installiertUndSetztDenStabilenPfad() throws {
    let p = AppPfade(basis: tempOrdner("Application Support"))
    let node = try Paket().laufzeit(p).installiereNode()
    #expect(node == p.node)
    #expect(try FileManager.default.destinationOfSymbolicLink(atPath: p.node.path).hasSuffix("node/v24.0.0/bin/node"))
    #expect(FileManager.default.isExecutableFile(atPath: p.node.path))
}

@Test func zweimalInstallierenIstHarmlos() throws {
    let p = AppPfade(basis: tempOrdner())
    let paket = Paket()
    try paket.laufzeit(p).installiere()
    try paket.laufzeit(p).installiere()
    #expect(FileManager.default.isExecutableFile(atPath: p.node.path))
}

@Test func neueNodeVersionBiegtDenPfadUm() throws {
    let p = AppPfade(basis: tempOrdner())
    try Paket(nodeVersion: "v24.0.0", nodeInhalt: "#!/bin/sh\necho alt\n").laufzeit(p).installiere()
    try Paket(nodeVersion: "v24.1.0", nodeInhalt: "#!/bin/sh\necho neu\n").laufzeit(p).installiere()
    #expect(try FileManager.default.destinationOfSymbolicLink(atPath: p.node.path).hasSuffix("node/v24.1.0/bin/node"))
}

@Test func falscheNodePruefsummeWirdAbgewiesen() {
    let p = AppPfade(basis: tempOrdner())
    let paket = Paket(falscheNodeSumme: true)
    #expect(throws: LaufzeitFehler.self) { try paket.laufzeit(p).installiere() }
    #expect(!FileManager.default.fileExists(atPath: p.node.path))
}

@Test func fehlendesNodeManifestWirdGemeldet() {
    let p = AppPfade(basis: tempOrdner())
    #expect(throws: LaufzeitFehler.manifestFehlt) { try Laufzeit(ressourcen: tempOrdner(), appVersion: "1.0.0", pfade: p).installiere() }
}

// MARK: Bundle ohne Kern

@Test func bundleOhneKernStelltNurNodeBereit() throws {
    let p = AppPfade(basis: tempOrdner())
    let e = try Paket().laufzeit(p).installiere()
    #expect(e.kern == .nichtEnthalten)
    #expect(e.meldungen.isEmpty) // „nicht enthalten“ ist kein Fehler
    #expect(e.node == p.node)
    #expect(FileManager.default.isExecutableFile(atPath: p.node.path))
    #expect(ziel(p.kern) == nil)
    #expect(kernVersionen(p).isEmpty)
    #expect(FileManager.default.fileExists(atPath: p.starter.path)) // der Starter gehört trotzdem dazu
}

@Test func kernOrdnerOhneInhaltIstTrotzdemEinKern() throws {
    // ein vorhandener, aber unvollständiger Kern (Manifest fehlt) darf nie still als „nicht enthalten“ gelten
    let p = AppPfade(basis: tempOrdner())
    let paket = Paket()
    try FileManager.default.createDirectory(at: paket.ressourcen.appendingPathComponent("kern"), withIntermediateDirectories: true)
    let e = try paket.laufzeit(p).installiere()
    #expect(e.kern == .fehler(.kernManifestFehlt))
    #expect(!e.meldungen.isEmpty)
}

// MARK: Kern kopieren + Manifest

@Test func kernWirdKopiertGeprueftUndVerlinkt() throws {
    let p = AppPfade(basis: tempOrdner("Application Support"))
    let paket = Paket()
    paket.kern(kernDateien)
    let e = try paket.laufzeit(p, version: "1.2.3").installiere()
    #expect(e.kern == .bereit(version: "1.2.3", ordner: p.kernOrdner.appendingPathComponent("1.2.3", isDirectory: true)))
    #expect(e.meldungen.isEmpty)
    #expect(ziel(p.kern)?.hasSuffix("kern/1.2.3") == true)
    #expect(try String(contentsOf: p.kern.appendingPathComponent("brain.mjs"), encoding: .utf8) == kernDateien["brain.mjs"])
    #expect(try String(contentsOf: p.kern.appendingPathComponent("lib/hilfe.mjs"), encoding: .utf8) == kernDateien["lib/hilfe.mjs"])
    // keine Arbeitsordner übrig
    #expect(((try? FileManager.default.contentsOfDirectory(atPath: p.kernOrdner.path)) ?? []).allSatisfy { !$0.hasPrefix(".") })
}

@Test func manipulierteQuelleWirdAbgelehnt() throws {
    let p = AppPfade(basis: tempOrdner())
    let paket = Paket()
    paket.kern(kernDateien, manifest: ["brain.mjs": sha("etwas anderes"), "lib/hilfe.mjs": sha(kernDateien["lib/hilfe.mjs"]!)])
    let e = try paket.laufzeit(p).installiere()
    guard case .fehler(.kernPruefsummeFalsch(let datei, _, _)) = e.kern else { Issue.record("erwartet kernPruefsummeFalsch, war \(e.kern)"); return }
    #expect(datei == "brain.mjs")
    #expect(!e.meldungen.isEmpty && e.meldungen[0].contains("brain.mjs")) // sichtbarer Fehler
    #expect(ziel(p.kern) == nil)
    #expect(kernVersionen(p).isEmpty)
    #expect(FileManager.default.isExecutableFile(atPath: p.node.path)) // Node ist trotzdem da: die App startet
}

@Test func zusaetzlicheOderFehlendeDateienWerdenAbgelehnt() throws {
    let p = AppPfade(basis: tempOrdner())
    let paket = Paket()
    // Datei im Paket, aber nicht im Manifest
    paket.kern(kernDateien, manifest: ["brain.mjs": sha(kernDateien["brain.mjs"]!)])
    #expect(paket.laufzeit(p).installiereKern() == .fehler(.kernUnerwarteteDatei("lib/hilfe.mjs")))
    // Datei im Manifest, aber nicht im Paket
    paket.kern(kernDateien, manifest: kernDateien.mapValues(sha).merging(["fehlt.mjs": sha("x")]) { a, _ in a })
    #expect(paket.laufzeit(p).installiereKern() == .fehler(.kernDateiFehlt("fehlt.mjs")))
    #expect(ziel(p.kern) == nil)
}

@Test func symlinkImKernWirdAbgelehnt() throws {
    let p = AppPfade(basis: tempOrdner())
    let paket = Paket()
    paket.kern(kernDateien)
    try FileManager.default.createSymbolicLink(atPath: paket.ressourcen.appendingPathComponent("kern/boese").path, withDestinationPath: "/etc/hosts")
    #expect(paket.laufzeit(p).installiereKern() == .fehler(.kernUnerwarteteDatei("boese")))
    #expect(ziel(p.kern) == nil)
}

@Test func fehlendesKernManifestUndKaputtesManifestWerdenGemeldet() throws {
    let p = AppPfade(basis: tempOrdner())
    let paket = Paket()
    paket.kern(kernDateien)
    try FileManager.default.removeItem(at: paket.ressourcen.appendingPathComponent("kern-manifest.json"))
    #expect(paket.laufzeit(p).installiereKern() == .fehler(.kernManifestFehlt))
    try "kein json".write(to: paket.ressourcen.appendingPathComponent("kern-manifest.json"), atomically: true, encoding: .utf8)
    #expect(paket.laufzeit(p).installiereKern() == .fehler(.kernManifestUngueltig))
    try #"{"schema":2,"dateien":{}}"#.write(to: paket.ressourcen.appendingPathComponent("kern-manifest.json"), atomically: true, encoding: .utf8)
    #expect(paket.laufzeit(p).installiereKern() == .fehler(.kernManifestUngueltig))
}

@Test func unzulaessigeVersionAlsOrdnernameWirdAbgelehnt() throws {
    let p = AppPfade(basis: tempOrdner())
    let paket = Paket()
    paket.kern(kernDateien)
    for v in ["", "../x", "a/b", ".versteckt", "1..2"] {
        #expect(paket.laufzeit(p, version: v).installiereKern() == .fehler(.kernVersionUngueltig(v)), "\(v)")
    }
    #expect(ziel(p.kern) == nil)
}

@Test func beschaedigteKopieWirdBeimNaechstenLaufRepariert() throws {
    let p = AppPfade(basis: tempOrdner())
    let paket = Paket()
    paket.kern(kernDateien)
    try paket.laufzeit(p).installiere()
    let kopie = p.kernOrdner.appendingPathComponent("1.0.0/brain.mjs")
    try "MANIPULIERT".write(to: kopie, atomically: true, encoding: .utf8)
    try "zusatz".write(to: p.kernOrdner.appendingPathComponent("1.0.0/extra.mjs"), atomically: true, encoding: .utf8)
    let e = try paket.laufzeit(p).installiere()
    #expect(e.meldungen.isEmpty)
    #expect(try String(contentsOf: kopie, encoding: .utf8) == kernDateien["brain.mjs"])
    #expect(!FileManager.default.fileExists(atPath: p.kernOrdner.appendingPathComponent("1.0.0/extra.mjs").path))
    #expect(ziel(p.kern)?.hasSuffix("kern/1.0.0") == true)
    #expect(((try? FileManager.default.contentsOfDirectory(atPath: p.kernOrdner.path)) ?? []).allSatisfy { !$0.hasPrefix(".") })
}

// MARK: Umschalten + Aufräumen

@Test func neueVersionSchaltetUmUndDieVorigeBleibt() throws {
    let p = AppPfade(basis: tempOrdner())
    let paket = Paket()
    paket.kern(kernDateien)
    try paket.laufzeit(p, version: "1.0.0").installiere()
    paket.kern(["brain.mjs": "v2\n"])
    let e = try paket.laufzeit(p, version: "2.0.0").installiere()
    #expect(e.meldungen.isEmpty)
    #expect(ziel(p.kern)?.hasSuffix("kern/2.0.0") == true)
    #expect(kernVersionen(p) == ["1.0.0", "2.0.0"]) // die vorige bleibt für Hooks, die mitten im Update laufen
    #expect(try String(contentsOf: p.kern.appendingPathComponent("brain.mjs"), encoding: .utf8) == "v2\n")
    #expect(try String(contentsOf: p.kernOrdner.appendingPathComponent("1.0.0/brain.mjs"), encoding: .utf8) == kernDateien["brain.mjs"])
}

@Test func drittVersionRaeumtDieAelteste() throws {
    let p = AppPfade(basis: tempOrdner())
    let paket = Paket()
    for v in ["1.0.0", "2.0.0", "3.0.0"] {
        paket.kern(["brain.mjs": v])
        try paket.laufzeit(p, version: v).installiere()
    }
    #expect(kernVersionen(p) == ["2.0.0", "3.0.0"])
    #expect(ziel(p.kern)?.hasSuffix("kern/3.0.0") == true)
}

@Test func erneuterLaufDerselbenVersionBehaeltDieVorigeBei() throws {
    let p = AppPfade(basis: tempOrdner())
    let paket = Paket()
    for v in ["1.0.0", "2.0.0"] {
        paket.kern(["brain.mjs": v])
        try paket.laufzeit(p, version: v).installiere()
    }
    try paket.laufzeit(p, version: "2.0.0").installiere()
    try paket.laufzeit(p, version: "2.0.0").installiere()
    #expect(kernVersionen(p) == ["1.0.0", "2.0.0"])
}

@Test func fehlgeschlagenesUpdateLaesstDenAlteKernAktiv() throws {
    let p = AppPfade(basis: tempOrdner())
    let paket = Paket()
    paket.kern(kernDateien)
    try paket.laufzeit(p, version: "1.0.0").installiere()
    paket.kern(["brain.mjs": "v2\n"], manifest: ["brain.mjs": sha("anders")])
    let e = try paket.laufzeit(p, version: "2.0.0").installiere()
    guard case .fehler = e.kern else { Issue.record("erwartet .fehler, war \(e.kern)"); return }
    #expect(ziel(p.kern)?.hasSuffix("kern/1.0.0") == true)
    #expect(kernVersionen(p) == ["1.0.0"])
    #expect(try String(contentsOf: p.kern.appendingPathComponent("brain.mjs"), encoding: .utf8) == kernDateien["brain.mjs"])
}

@Test func liegengebliebeneArbeitsordnerWerdenNachEinerStundeEntfernt() throws {
    let p = AppPfade(basis: tempOrdner())
    let paket = Paket()
    paket.kern(kernDateien)
    try p.legeAn()
    let alt = p.kernOrdner.appendingPathComponent(".1.0.0.alt", isDirectory: true)
    let frisch = p.kernOrdner.appendingPathComponent(".1.0.0.frisch", isDirectory: true)
    for d in [alt, frisch] { try FileManager.default.createDirectory(at: d, withIntermediateDirectories: true) }
    try FileManager.default.setAttributes([.modificationDate: Date().addingTimeInterval(-7200)], ofItemAtPath: alt.path)
    try paket.laufzeit(p).installiere()
    #expect(!FileManager.default.fileExists(atPath: alt.path))
    #expect(FileManager.default.fileExists(atPath: frisch.path)) // könnte zu einem laufenden Kopieren gehören
}

@Test func symlinkWirdAtomarUmgeschaltet() async throws {
    // Ein Leser, der den Link dauernd auflöst, sieht beim Umschalten nie „fehlt“ — nur das alte oder das neue Ziel.
    let ordner = tempOrdner()
    let a = ordner.appendingPathComponent("a"), b = ordner.appendingPathComponent("b"), link = ordner.appendingPathComponent("kern")
    for d in [a, b] { try FileManager.default.createDirectory(at: d, withIntermediateDirectories: true) }
    try Laufzeit.setzeSymlink(link, auf: a)
    let stop = Atomic()
    let leser = Task.detached { () -> Int in
        var fehler = 0
        while !stop.wert {
            guard let z = try? FileManager.default.destinationOfSymbolicLink(atPath: link.path), z == a.path || z == b.path else { fehler += 1; continue }
        }
        return fehler
    }
    for i in 0..<3000 { try Laufzeit.setzeSymlink(link, auf: i.isMultiple(of: 2) ? b : a, schonfrist: 0.05) }
    stop.setze()
    #expect(await leser.value == 0)
    // abgelöste Links werden erst beim nächsten Umschalten (nach der Schonfrist) entfernt: danach bleibt höchstens der letzte übrig
    try await Task.sleep(for: .milliseconds(150))
    try Laufzeit.setzeSymlink(link, auf: a, schonfrist: 0.05)
    let reste = ((try? FileManager.default.contentsOfDirectory(atPath: ordner.path)) ?? []).sorted().filter { $0 != "a" && $0 != "b" && $0 != "kern" }
    #expect(reste.count == 1 && reste[0].hasPrefix(".kern."), "\(reste)")
}

@Test func scheiterndesUmschaltenHinterlaesstNichtsUndMeldet() throws {
    // bin/kern ist (fälschlich) ein gefüllter Ordner: rename(2) scheitert, der Fehler wird gemeldet, nichts bleibt liegen
    let p = AppPfade(basis: tempOrdner())
    let paket = Paket()
    paket.kern(kernDateien)
    try p.legeAn()
    try FileManager.default.createDirectory(at: p.kern, withIntermediateDirectories: true)
    try "x".write(to: p.kern.appendingPathComponent("datei"), atomically: true, encoding: .utf8)
    #expect(paket.laufzeit(p).installiereKern() == .fehler(.symlinkFehlgeschlagen))
    #expect(((try? FileManager.default.contentsOfDirectory(atPath: p.binOrdner.path)) ?? []).allSatisfy { !$0.hasPrefix(".") })
}

private final class Atomic: @unchecked Sendable {
    private let sperre = NSLock()
    private var flag = false
    var wert: Bool { sperre.lock(); defer { sperre.unlock() }; return flag }
    func setze() { sperre.lock(); flag = true; sperre.unlock() }
}

// MARK: Starter

@Test func starterHatDenErwartetenInhaltUndRechte() throws {
    let p = AppPfade(basis: tempOrdner("Application Support"))
    try Paket().laufzeit(p).installiere()
    let text = try String(contentsOf: p.starter, encoding: .utf8)
    #expect(text.hasPrefix("#!/bin/sh\n"))
    #expect(text.contains("exec \"$node\" \"$kern\" \"$@\""))
    #expect(text.contains("node='\(p.basis.path)/bin/node'"))
    #expect(text.contains("kern='\(p.basis.path)/bin/kern/brain.mjs'"))
    let rechte = try FileManager.default.attributesOfItem(atPath: p.starter.path)[.posixPermissions] as? Int
    #expect(rechte == 0o755)
}

@Test func starterSchreibenIstIdempotentUndRepariertRechte() throws {
    let p = AppPfade(basis: tempOrdner())
    let l = Paket().laufzeit(p)
    try l.schreibeStarter()
    let vorher = try Data(contentsOf: p.starter)
    try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: p.starter.path)
    try l.schreibeStarter()
    #expect(try Data(contentsOf: p.starter) == vorher)
    #expect(try FileManager.default.attributesOfItem(atPath: p.starter.path)[.posixPermissions] as? Int == 0o755)
    try "kaputt".write(to: p.starter, atomically: true, encoding: .utf8)
    try l.schreibeStarter()
    #expect(try Data(contentsOf: p.starter) == vorher)
    #expect(((try? FileManager.default.contentsOfDirectory(atPath: p.binOrdner.path)) ?? []).allSatisfy { !$0.hasPrefix(".") })
}

@Test func starterQuotiertPfadeMitLeerzeichenUndApostroph() {
    #expect(Laufzeit.shellQuote("a b") == "'a b'")
    #expect(Laufzeit.shellQuote("it's") == "'it'\\''s'")
    #expect(Laufzeit.shellQuote("$HOME `x` \"y\"") == "'$HOME `x` \"y\"'")
}

@Test func starterFuehrtNodeMitKernUndArgumentenAus() throws {
    // Support-Ordner mit Leerzeichen UND Apostroph; „Node“ ist ein Skript, das seine Argumente ausgibt.
    let p = AppPfade(basis: tempOrdner("App Support 'Test'/Kortex"))
    let paket = Paket(nodeInhalt: "#!/bin/sh\nfor a in \"$@\"; do echo \"arg:$a\"; done\n")
    paket.kern(kernDateien)
    try paket.laufzeit(p).installiere()
    let l = starte(p.starter, ["eins", "zwei drei", "$HOME"])
    #expect(l.status == 0, "\(l.fehler)")
    #expect(l.aus == "arg:\(p.basis.path)/bin/kern/brain.mjs\narg:eins\narg:zwei drei\narg:$HOME\n")
}

@Test func starterMeldetFehlendesNodeAufStderr() throws {
    let p = AppPfade(basis: tempOrdner("Support mit Leerzeichen"))
    try Paket().laufzeit(p).schreibeStarter() // nur der Starter, kein Node installiert
    let l = starte(p.starter, ["x"])
    #expect(l.status != 0)
    #expect(l.aus.isEmpty)
    #expect(l.fehler.contains("Node fehlt"))
    #expect(l.fehler.contains(p.basis.path))
}

@Test func starterMeldetFehlendenKernAufStderr() throws {
    let p = AppPfade(basis: tempOrdner())
    try Paket().laufzeit(p).installiere() // Node da, Bundle ohne Kern
    let l = starte(p.starter)
    #expect(l.status != 0)
    #expect(l.fehler.contains("Kern fehlt"))
}
