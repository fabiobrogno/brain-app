import Foundation
import PDFKit
import Testing
@testable import BrainCore

private func buendel(_ dateien: [[String: Any]], name: String = "Atlas.md", haupt: String = "Atlas.md", ordner: Bool? = nil) -> [String: Any] {
    var d: [String: Any] = ["aktion": "export-speichern", "wert": ["name": name, "haupt": haupt, "dateien": dateien] as [String: Any]]
    if let ordner { var w = d["wert"] as! [String: Any]; w["ordner"] = ordner; d["wert"] = w }
    return d
}
private func temp() throws -> URL {
    let u = FileManager.default.temporaryDirectory.appendingPathComponent("export-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
    return u
}
private let png = Data([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).base64EncodedString()

@Test func exportAktionenNurImStudio() {
    let md: [[String: Any]] = [["pfad": "Atlas.md", "text": "# Atlas\n"]]
    #expect(AppAktion.pruefe(buendel(md), vault: nil, oberflaeche: .studio) != nil)
    #expect(AppAktion.pruefe(buendel(md), vault: nil, oberflaeche: .app) == nil)
    #expect(AppAktion.pruefe(buendel(md), vault: nil) == nil)
    #expect(AppAktion.pruefe(["aktion": "export-pdf", "wert": ["name": "A.pdf", "html": "<p>x</p>"]], vault: nil, oberflaeche: .studio) == .exportPdf(ExportPdf(name: "A.pdf", html: "<p>x</p>")))
    #expect(AppAktion.pruefe(["aktion": "export-pdf", "wert": ["name": "A", "html": "<p>x</p>"]], vault: nil, oberflaeche: .studio) == .exportPdf(ExportPdf(name: "A.pdf", html: "<p>x</p>")))
    #expect(AppAktion.pruefe(["aktion": "export-pdf", "wert": ["name": "A.pdf", "html": "<p>x</p>"]], vault: nil, oberflaeche: .app) == nil)
    #expect(AppAktion.pruefe(["aktion": "teilen", "wert": ["name": "Atlas", "text": "# Atlas"]], vault: nil, oberflaeche: .studio) == .teilen(name: "Atlas", text: "# Atlas"))
    #expect(AppAktion.pruefe(["aktion": "teilen", "wert": ["name": "Atlas", "text": "# Atlas"]], vault: nil, oberflaeche: .app) == nil)
}

@Test func buendelPruefungLehntUnsicheresAb() {
    let ok: [[String: Any]] = [["pfad": "Atlas.md", "text": "x"], ["pfad": "bilder/a1b2c3d4-karte.png", "base64": png]]
    #expect(ExportBuendel.pruefe(buendel(ok)["wert"]) != nil)
    for schlecht in ["../x.md", "/etc/passwd", "a/../b.md", "a//b.md", ".versteckt/x.md", "a\\b.md", "C:x.md", "a/./b", "", "x\u{0}y.md", "a/\u{202E}b.md"] {
        let d: [[String: Any]] = [["pfad": "Atlas.md", "text": "x"], ["pfad": schlecht, "text": "böse"]]
        #expect(ExportBuendel.pruefe(buendel(d)["wert"]) == nil, "Pfad \(schlecht.debugDescription)")
    }
    #expect(ExportBuendel.pruefe(buendel(ok, haupt: "fehlt.md")["wert"]) == nil, "Hauptdatei muss im Bündel stehen")
    #expect(ExportBuendel.pruefe(buendel(ok, name: "../Atlas.md")["wert"]) == nil)
    #expect(ExportBuendel.pruefe(buendel(ok, name: ".versteckt")["wert"]) == nil)
    #expect(ExportBuendel.pruefe(buendel([["pfad": "Atlas.md", "text": "x"], ["pfad": "atlas.md", "text": "y"]])["wert"]) == nil, "gleicher Pfad, anders geschrieben")
    #expect(ExportBuendel.pruefe(buendel([["pfad": "Atlas.md", "base64": "%%%"]])["wert"]) == nil)
    #expect(ExportBuendel.pruefe(buendel([["pfad": "Atlas.md"]])["wert"]) == nil)
    #expect(ExportBuendel.pruefe(buendel([])["wert"]) == nil)
    #expect(ExportBuendel.pruefe(buendel(ok, ordner: true)["wert"]) != nil)
    #expect(ExportBuendel.pruefe(["name": "A.md", "haupt": "A.md", "ordner": "ja", "dateien": ok]) == nil, "ordner nur als Boolean")
    #expect(ExportBuendel.pruefe(nil) == nil)
    let viele = (0..<(ExportBuendel.maxDateien + 1)).map { ["pfad": "d\($0).md", "text": "x"] as [String: Any] }
    #expect(ExportBuendel.pruefe(["name": "A.md", "haupt": "d0.md", "dateien": viele]) == nil)
}

@Test func buendelSchreibtEinzeldateiMitBildernDaneben() throws {
    let ziel = try temp(); defer { try? FileManager.default.removeItem(at: ziel) }
    let b = try #require(ExportBuendel.pruefe(buendel([["pfad": "Atlas.md", "text": "# Atlas\n![](bilder/a1b2c3d4-karte.png)\n"], ["pfad": "bilder/a1b2c3d4-karte.png", "base64": png]])["wert"]))
    // der Nutzer nennt die Datei im Dialog anders: die Hauptdatei folgt, die Bilder bleiben unter bilder/
    let name = try b.schreibe(nach: ziel.appendingPathComponent("Reise.md"))
    #expect(name == "Reise.md")
    #expect(try String(contentsOf: ziel.appendingPathComponent("Reise.md"), encoding: .utf8).hasPrefix("# Atlas"))
    #expect(try Data(contentsOf: ziel.appendingPathComponent("bilder/a1b2c3d4-karte.png")).count == 8)
    #expect(!FileManager.default.fileExists(atPath: ziel.appendingPathComponent("Atlas.md").path))
    // zweiter Export: das Bild mit gleichem Namen bleibt, was es ist; die Datei wird ersetzt
    try Data("fremd".utf8).write(to: ziel.appendingPathComponent("bilder/a1b2c3d4-karte.png"))
    try b.schreibe(nach: ziel.appendingPathComponent("Reise.md"))
    #expect(try String(contentsOf: ziel.appendingPathComponent("bilder/a1b2c3d4-karte.png"), encoding: .utf8) == "fremd", "vorhandene Bilder werden nie überschrieben")
}

@Test func buendelSchreibtOrdnerUndErsetztErstenPfadteil() throws {
    let wurzel = try temp(); defer { try? FileManager.default.removeItem(at: wurzel) }
    let b = try #require(ExportBuendel.pruefe(buendel([["pfad": "n/eins.md", "text": "1"], ["pfad": "n/unter/zwei.md", "text": "2"], ["pfad": "n/bilder/x.png", "base64": png]], name: "n", haupt: "n/eins.md", ordner: true)["wert"]))
    _ = try b.schreibe(nach: wurzel.appendingPathComponent("Mein Export", isDirectory: true))
    #expect(try String(contentsOf: wurzel.appendingPathComponent("Mein Export/unter/zwei.md"), encoding: .utf8) == "2")
    #expect(FileManager.default.fileExists(atPath: wurzel.appendingPathComponent("Mein Export/bilder/x.png").path))
    #expect(!FileManager.default.fileExists(atPath: wurzel.appendingPathComponent("n").path))
}

@Test func buendelSchreibtNieDurchSymlinks() throws {
    let wurzel = try temp(); defer { try? FileManager.default.removeItem(at: wurzel) }
    let aussen = try temp(); defer { try? FileManager.default.removeItem(at: aussen) }
    // ein Symlink an Stelle des Bilderordners
    try FileManager.default.createSymbolicLink(at: wurzel.appendingPathComponent("bilder"), withDestinationURL: aussen)
    let b = try #require(ExportBuendel.pruefe(buendel([["pfad": "Atlas.md", "text": "x"], ["pfad": "bilder/a.png", "base64": png]])["wert"]))
    #expect(throws: ExportFehler.ausserhalb) { try b.schreibe(nach: wurzel.appendingPathComponent("Atlas.md")) }
    #expect(!FileManager.default.fileExists(atPath: aussen.appendingPathComponent("a.png").path), "nichts ist nach draußen geschrieben")
    // ein Symlink an Stelle der Hauptdatei
    let ziel = try temp(); defer { try? FileManager.default.removeItem(at: ziel) }
    try Data("geheim".utf8).write(to: aussen.appendingPathComponent("ziel.md"))
    try FileManager.default.createSymbolicLink(at: ziel.appendingPathComponent("Atlas.md"), withDestinationURL: aussen.appendingPathComponent("ziel.md"))
    let einzeln = try #require(ExportBuendel.pruefe(buendel([["pfad": "Atlas.md", "text": "neu"]])["wert"]))
    #expect(throws: ExportFehler.verweis) { try einzeln.schreibe(nach: ziel.appendingPathComponent("Atlas.md")) }
    #expect(try String(contentsOf: aussen.appendingPathComponent("ziel.md"), encoding: .utf8) == "geheim")
}

@MainActor
@Test func pdfErzeugerMachtAusHtmlEinMehrseitigesPdfOhneNetz() async throws {
    // „Injektion“: das HTML kommt als Text hinein; ein Bild von außen darf nie geladen werden (es gäbe nur einen leeren Fleck), die lange Seite wird mehrseitig
    let absaetze = (1...120).map { "<p>Absatz \($0): Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>" }.joined()
    let html = "<!doctype html><html><head><meta charset=\"utf-8\"><style>body{font:12px sans-serif;margin:24px}</style></head><body><h1>Titel</h1><img src=\"https://unerreichbar.invalid/x.png\">\(absaetze)<script>document.title='x'</script></body></html>"
    let daten = try #require(await PdfErzeuger().erzeuge(html: html))
    #expect(daten.prefix(5) == Data("%PDF-".utf8))
    let pdf = try #require(PDFDocument(data: daten))
    #expect(pdf.pageCount >= 2, "lange Seite → mehrere Seiten, war \(pdf.pageCount)")
    #expect(abs(pdf.page(at: 0)!.bounds(for: .mediaBox).width - 595) < 2)
    #expect((pdf.string ?? "").contains("Absatz 1:"))
    #expect((pdf.string ?? "").contains("Absatz 120:"))
}

@Test func buendelSchreibtNieInDenOffenenVaultUndNurInNeueOderLeereOrdner() throws {
    let wurzel = try temp(); defer { try? FileManager.default.removeItem(at: wurzel) }
    let vault = wurzel.appendingPathComponent("vault", isDirectory: true)
    let nachbar = wurzel.appendingPathComponent("vault-2", isDirectory: true)
    try FileManager.default.createDirectory(at: vault.appendingPathComponent("unter"), withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: nachbar, withIntermediateDirectories: true)
    let b = try #require(ExportBuendel.pruefe(buendel([["pfad": "Atlas.md", "text": "x"]])["wert"]))
    #expect(throws: ExportFehler.imVault) { try b.schreibe(nach: vault.appendingPathComponent("unter/Atlas.md"), ausserhalbVon: vault) }
    #expect(throws: ExportFehler.imVault) { try b.schreibe(nach: vault.appendingPathComponent("neu/Atlas.md"), ausserhalbVon: vault) }
    #expect(!FileManager.default.fileExists(atPath: vault.appendingPathComponent("neu").path), "nichts angelegt")
    // ein Nachbar mit gleichem Namensanfang liegt NICHT im Vault (Pfadprüfung mit Trennzeichen)
    #expect(!ExportBuendel.liegtImVault(nachbar.appendingPathComponent("a.md"), vault: vault))
    #expect(try b.schreibe(nach: nachbar.appendingPathComponent("Atlas.md"), ausserhalbVon: vault) == "Atlas.md")
    // ein Symlink in den Vault zählt als Vault
    let link = wurzel.appendingPathComponent("link")
    try FileManager.default.createSymbolicLink(at: link, withDestinationURL: vault)
    #expect(ExportBuendel.liegtImVault(link.appendingPathComponent("x.md"), vault: vault))
    // Ordner: neu oder leer ja, mit Inhalt nein
    let o = try #require(ExportBuendel.pruefe(buendel([["pfad": "n/eins.md", "text": "1"]], name: "n", haupt: "n/eins.md", ordner: true)["wert"]))
    let voll = wurzel.appendingPathComponent("voll", isDirectory: true)
    try FileManager.default.createDirectory(at: voll, withIntermediateDirectories: true)
    try Data("x".utf8).write(to: voll.appendingPathComponent("vorhanden.txt"))
    #expect(throws: ExportFehler.ordnerNichtLeer) { try o.schreibe(nach: voll) }
    #expect(!FileManager.default.fileExists(atPath: voll.appendingPathComponent("eins.md").path))
    let leer = wurzel.appendingPathComponent("leer", isDirectory: true)
    try FileManager.default.createDirectory(at: leer, withIntermediateDirectories: true)
    _ = try o.schreibe(nach: leer)
    #expect(FileManager.default.fileExists(atPath: leer.appendingPathComponent("eins.md").path))
}
