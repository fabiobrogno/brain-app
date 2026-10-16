import Testing
import Foundation
import CryptoKit
@testable import BrainCore

private func quelle(version: String, inhalt: String, falscheSumme: Bool = false) -> URL {
    let q = tempOrdner("node-runtime")
    try! FileManager.default.createDirectory(at: q.appendingPathComponent("bin"), withIntermediateDirectories: true)
    skript(inhalt, name: "bin/node", in: q)
    let sha = falscheSumme
        ? String(repeating: "0", count: 64)
        : SHA256.hash(data: Data(inhalt.utf8)).map { String(format: "%02x", $0) }.joined()
    try! #"{"version":"\#(version)","sha256":"\#(sha)"}"#
        .write(to: q.appendingPathComponent("manifest.json"), atomically: true, encoding: .utf8)
    return q
}

@Test func installiertUndSetztDenStabilenPfad() throws {
    let p = AppPfade(basis: tempOrdner("Application Support"))
    let node = try NodeLaufzeit(quelle: quelle(version: "v24.0.0", inhalt: "#!/bin/sh\necho v24.0.0\n"), pfade: p).installiere()
    #expect(node == p.node)
    #expect(try FileManager.default.destinationOfSymbolicLink(atPath: p.node.path).hasSuffix("node/v24.0.0/bin/node"))
    #expect(FileManager.default.isExecutableFile(atPath: p.node.path))
}

@Test func zweimalInstallierenIstHarmlos() throws {
    let p = AppPfade(basis: tempOrdner())
    let q = quelle(version: "v24.0.0", inhalt: "#!/bin/sh\necho a\n")
    try NodeLaufzeit(quelle: q, pfade: p).installiere()
    try NodeLaufzeit(quelle: q, pfade: p).installiere()
    #expect(FileManager.default.isExecutableFile(atPath: p.node.path))
}

@Test func neueVersionBiegtDenPfadUm() throws {
    let p = AppPfade(basis: tempOrdner())
    try NodeLaufzeit(quelle: quelle(version: "v24.0.0", inhalt: "#!/bin/sh\necho alt\n"), pfade: p).installiere()
    try NodeLaufzeit(quelle: quelle(version: "v24.1.0", inhalt: "#!/bin/sh\necho neu\n"), pfade: p).installiere()
    #expect(try FileManager.default.destinationOfSymbolicLink(atPath: p.node.path).hasSuffix("node/v24.1.0/bin/node"))
}

@Test func falschePruefsummeWirdAbgewiesen() {
    let p = AppPfade(basis: tempOrdner())
    let q = quelle(version: "v24.0.0", inhalt: "#!/bin/sh\necho x\n", falscheSumme: true)
    #expect(throws: LaufzeitFehler.self) { try NodeLaufzeit(quelle: q, pfade: p).installiere() }
    #expect(!FileManager.default.fileExists(atPath: p.node.path))
}

@Test func fehlendesManifestWirdGemeldet() {
    let p = AppPfade(basis: tempOrdner())
    #expect(throws: LaufzeitFehler.manifestFehlt) { try NodeLaufzeit(quelle: tempOrdner(), pfade: p).installiere() }
}
