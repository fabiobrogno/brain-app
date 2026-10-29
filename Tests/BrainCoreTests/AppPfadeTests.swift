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

@Test func kernUndStarterLiegenImSupportOrdner() throws {
    let basis = tempOrdner("Application Support")
    let p = AppPfade(basis: basis)
    try p.legeAn()
    #expect(p.kernOrdner.path == basis.appendingPathComponent("kern").path)
    #expect(p.kern.path == basis.appendingPathComponent("bin/kern").path)
    #expect(p.starter.path == basis.appendingPathComponent("bin/kortex").path)
    #expect(FileManager.default.fileExists(atPath: p.kernOrdner.path))
}

@Test func standardIstApplicationSupportKortex() {
    #expect(AppPfade.standard(umgebung: [:]).basis.path.hasSuffix("Library/Application Support/Kortex"))
}

@Test func testUmgebungLenktUm() {
    #expect(AppPfade.standard(umgebung: ["BRAIN_APP_SUPPORT": "/tmp/x y"]).basis.path == "/tmp/x y")
    // ein relativer Wert wird auf den Arbeitsordner bezogen (nie der echte Support-Ordner)
    #expect(AppPfade.standard(umgebung: ["BRAIN_APP_SUPPORT": "relativ/../unter x"], arbeitsordner: "/work/dir").basis.path == "/work/dir/unter x")
    #expect(AppPfade.standard(umgebung: ["BRAIN_APP_SUPPORT": "relativ"], arbeitsordner: "/work").basis.path == "/work/relativ")
    #expect(AppPfade.standard(umgebung: ["BRAIN_APP_SUPPORT": ""]).basis.path.hasSuffix("Application Support/Kortex"))
}

@Test func altBasisNurOhneUmlenkung() {
    #expect(AppPfade.altBasis(umgebung: [:])?.path.hasSuffix("Library/Application Support/Brain") == true)
    #expect(AppPfade.altBasis(umgebung: ["BRAIN_APP_SUPPORT": "/tmp/x"]) == nil)
    // auch ein relativer Wert lenkt um: dann gibt es keinen alten Ordner, der migriert werden könnte
    #expect(AppPfade.altBasis(umgebung: ["BRAIN_APP_SUPPORT": "relativ"]) == nil)
    #expect(AppPfade.altBasis(umgebung: ["BRAIN_APP_SUPPORT": ""]) != nil)
}
