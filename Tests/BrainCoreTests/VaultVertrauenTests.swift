import Testing
import Foundation
@testable import BrainCore

/// Merker `<support>/vertrauen.json` der Werkstatt, nur gelesen (Anzeige „Nur ansehen“ im Menü).
private func kennungVon(_ ordner: URL) -> String {
    var st = stat()
    precondition(stat(ordner.path, &st) == 0)
    let ms = Double(st.st_birthtimespec.tv_sec) * 1000 + Double(st.st_birthtimespec.tv_nsec) / 1_000_000
    return "\(st.st_dev):\(st.st_ino):\(ms)"
}

private func schreibeMerker(_ support: URL, _ inhalt: [String: Any]) {
    let daten = try! JSONSerialization.data(withJSONObject: inhalt)
    try! daten.write(to: support.appendingPathComponent("vertrauen.json"))
}

private func eintrag(_ vault: URL, quelle: String = "bestaetigt", kennung: String? = nil) -> [String: Any] {
    let echt = String(cString: realpath(vault.path, nil))
    return [echt: ["seit": "2026-10-01T00:00:00Z", "ordner": kennung ?? kennungVon(vault), "quelle": quelle]]
}

@Test func ohneMerkerGiltNurAnsehen() {
    #expect(VaultVertrauen.lade(vault: tempOrdner(), support: tempOrdner()) == .nurAnsehen)
}

@Test func eintragFuerDenOrdnerBedeutetVertraut() {
    let vault = tempOrdner(), support = tempOrdner()
    for quelle in ["angelegt", "geklont", "bestaetigt", "migriert"] {
        schreibeMerker(support, eintrag(vault, quelle: quelle))
        #expect(VaultVertrauen.lade(vault: vault, support: support) == .vertraut, "\(quelle)")
    }
}

@Test func unbekannteHerkunftOderAndererOrdnerGiltNichtAlsVertraut() {
    let vault = tempOrdner(), support = tempOrdner()
    schreibeMerker(support, eintrag(vault, quelle: "irgendwas"))
    #expect(VaultVertrauen.lade(vault: vault, support: support) == .nurAnsehen)
    schreibeMerker(support, eintrag(vault, kennung: "1:2:3.5")) // Ordner ersetzt: neue Kennung
    #expect(VaultVertrauen.lade(vault: vault, support: support) == .nurAnsehen)
    schreibeMerker(support, eintrag(vault, kennung: "kaputt"))
    #expect(VaultVertrauen.lade(vault: vault, support: support) == .nurAnsehen)
}

@Test func andererVaultImMerkerVertrautDiesenNicht() {
    let a = tempOrdner(), b = tempOrdner(), support = tempOrdner()
    schreibeMerker(support, eintrag(a))
    #expect(VaultVertrauen.lade(vault: a, support: support) == .vertraut)
    #expect(VaultVertrauen.lade(vault: b, support: support) == .nurAnsehen)
}

@Test func kaputteMerkerdateiUndFehlenderVaultGeltenAlsNurAnsehen() {
    let vault = tempOrdner(), support = tempOrdner()
    try! "[]".write(to: support.appendingPathComponent("vertrauen.json"), atomically: true, encoding: .utf8)
    #expect(VaultVertrauen.lade(vault: vault, support: support) == .nurAnsehen)
    try! "kein json".write(to: support.appendingPathComponent("vertrauen.json"), atomically: true, encoding: .utf8)
    #expect(VaultVertrauen.lade(vault: vault, support: support) == .nurAnsehen)
    #expect(VaultVertrauen.lade(vault: vault.appendingPathComponent("gibt-es-nicht"), support: support) == .nurAnsehen)
}

@Test func schreibweiseMitGrossUndKleinUndSymlinkFuehrtZumSelbenEintrag() {
    let vault = tempOrdner(), support = tempOrdner(), links = tempOrdner()
    let link = links.appendingPathComponent("Verweis")
    try! FileManager.default.createSymbolicLink(at: link, withDestinationURL: vault)
    var m = eintrag(vault)
    let (k, w) = m.first!
    m = [k.uppercased(): w] // andere Groß-/Kleinschreibung des Schlüssels
    schreibeMerker(support, m)
    #expect(VaultVertrauen.lade(vault: link, support: support) == .vertraut)
}

/// Das Format der Kennung stammt von Node (`statSync`): Dieselbe Zeichenkette aus Node muss die App als „vertraut“ lesen.
@Test func kennungAusNodeWirdErkannt() throws {
    let pfad = (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":")
        .map { URL(fileURLWithPath: String($0)).appendingPathComponent("node") }.first { FileManager.default.isExecutableFile(atPath: $0.path) }
    guard let node = pfad else { return } // ohne Node übersprungen
    let vault = tempOrdner(), support = tempOrdner()
    let p = Process()
    p.executableURL = node
    p.arguments = ["-e", "const s=require('fs').statSync(process.argv[1]);process.stdout.write(`${s.dev}:${s.ino}:${s.birthtimeMs}`)", vault.path]
    p.environment = ["PATH": "/usr/bin:/bin", "HOME": support.path] // ausdrücklich synthetisch, nichts vom echten Benutzer
    let aus = Pipe()
    p.standardOutput = aus
    try p.run()
    p.waitUntilExit()
    let kennung = String(decoding: aus.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
    #expect(!kennung.isEmpty)
    schreibeMerker(support, eintrag(vault, kennung: kennung))
    #expect(VaultVertrauen.lade(vault: vault, support: support) == .vertraut)
}
