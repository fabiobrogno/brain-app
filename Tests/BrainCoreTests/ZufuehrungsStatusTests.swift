import XCTest
@testable import BrainCore

final class ZufuehrungsStatusTests: XCTestCase {
    private let beispiel = """
    { "version": 1, "erstellt": "2026-10-28T09:00:00Z", "probleme": 1,
      "zufuehrungen": [
        { "name": "Notizen-Sync", "pfad": "~/Sync/notizen", "status": "ok", "letzterLauf": "2026-10-27T08:00:00Z", "alterTage": 1, "maxAlterTage": 7 },
        { "name": "Import", "pfad": "/weg", "status": "fehlt", "letzterLauf": null, "alterTage": null, "maxAlterTage": 7 }
      ] }
    """

    private func vaultMitDatei(_ inhalt: String?) throws -> URL {
        let vault = tempOrdner()
        if let inhalt {
            let datei = ZufuehrungsStatus.pfad(vault: vault)
            try FileManager.default.createDirectory(at: datei.deletingLastPathComponent(), withIntermediateDirectories: true)
            try inhalt.write(to: datei, atomically: true, encoding: .utf8)
        }
        return vault
    }

    private let gut = BrainStatus(version: "1", quellVault: false, zustand: .ok, meldungen: [], zahlen: .init(vorschlaege: 0, konflikte: 0, abgelaufen: 0, zuTun: 0))

    func testToterPfadZeigtWarnungMitGrund() throws {
        let z = ZufuehrungsStatus.lade(vault: try vaultMitDatei(beispiel))
        let a = StatusAnzeige.fuer(gut, zufuehrungen: z)
        XCTAssertEqual(a.zeichen, "⚠")
        XCTAssertEqual(a.titel, "Import: Ordner oder Datei fehlt")
    }

    func testStilleQuelleNenntAlter() {
        let z = ZufuehrungsStatus(zufuehrungen: [.init(name: "Sync", status: "still", alterTage: 8)])
        XCTAssertEqual(StatusAnzeige.fuer(gut, zufuehrungen: z).titel, "Sync: seit 8 Tagen nichts Neues")
    }

    func testMehrereProblemeWerdenGezaehlt() {
        let z = ZufuehrungsStatus(zufuehrungen: [.init(name: "A", status: "fehlt"), .init(name: "B", status: "nicht-lesbar")])
        XCTAssertTrue(StatusAnzeige.fuer(gut, zufuehrungen: z).titel.hasPrefix("2 Zuführungen stehen still"))
    }

    func testOhneFehlerKeineWarnung() throws {
        let ok = #"{ "version": 1, "probleme": 0, "zufuehrungen": [{ "name": "A", "status": "ok" }] }"#
        let z = ZufuehrungsStatus.lade(vault: try vaultMitDatei(ok))
        XCTAssertEqual(StatusAnzeige.fuer(gut, zufuehrungen: z), StatusAnzeige.fuer(gut))
        XCTAssertEqual(StatusAnzeige.fuer(gut, zufuehrungen: z).zeichen, "✓")
    }

    func testFehlendeOderKaputteDateiIstKeinFehler() throws {
        XCTAssertNil(ZufuehrungsStatus.lade(vault: try vaultMitDatei(nil)))
        XCTAssertNil(ZufuehrungsStatus.lade(vault: try vaultMitDatei("{ kaputt")))
        XCTAssertNil(ZufuehrungsStatus.lade(vault: try vaultMitDatei("")))
        XCTAssertEqual(StatusAnzeige.fuer(gut, zufuehrungen: nil).zeichen, "✓")
    }

    func testAndereZustaendeBleiben() {
        let z = ZufuehrungsStatus(zufuehrungen: [.init(name: "A", status: "fehlt")])
        XCTAssertEqual(StatusAnzeige.fuer(nil, fehler: "x", zufuehrungen: z), StatusAnzeige.fuer(nil, fehler: "x"))
    }
}
