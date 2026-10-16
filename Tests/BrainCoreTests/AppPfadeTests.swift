import Testing
import Foundation
@testable import BrainCore

@Test func pfadeLiegenUnterDerBasisUndWerdenAngelegt() throws {
    let basis = tempOrdner("Application Support")
    let p = AppPfade(basis: basis)
    try p.legeAn()
    #expect(FileManager.default.fileExists(atPath: p.binOrdner.path))
    #expect(FileManager.default.fileExists(atPath: p.logs.path))
    #expect(p.node.path == basis.appendingPathComponent("bin/node").path)
    #expect(p.konfiguration.lastPathComponent == "config.json")
}

@Test func standardIstApplicationSupportBrain() {
    #expect(AppPfade.standard(umgebung: [:]).basis.path.hasSuffix("Library/Application Support/Brain"))
}

@Test func testUmgebungLenktUm() {
    #expect(AppPfade.standard(umgebung: ["BRAIN_APP_SUPPORT": "/tmp/x y"]).basis.path == "/tmp/x y")
    #expect(AppPfade.standard(umgebung: ["BRAIN_APP_SUPPORT": "relativ"]).basis.path.hasSuffix("Application Support/Brain"))
}
