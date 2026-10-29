import Testing
import Foundation
@testable import BrainCore

// Kern-Umzug P4: die App ruft den gebündelten Kern über den stabilen Pfad `bin/kern` auf, mit ausdrücklichem `--vault`,
// und weicht nie auf ein `.tools` im Vault aus.

// MARK: KernBereitschaft (Meldung statt stillem Ausweichen)

@Test func kernBereitschaftMeldetFehlendenKernKlar() {
    let kern = tempOrdner().appendingPathComponent("bin/kern", isDirectory: true)
    let nicht = KernBereitschaft.pruefe(.nichtEnthalten, kern: kern)
    #expect(!nicht.istBereit)
    #expect(nicht.meldung?.contains("Kern") == true)
    #expect(nicht.meldung?.contains("neu installieren") == true)
    // Fehler beim Bereitstellen: Grund des Laufzeit-Fehlers steht in der Meldung
    let fehler = KernBereitschaft.pruefe(.fehler(.kernPruefsummeFalsch(datei: "brain.mjs", erwartet: "a", ist: "b")), kern: kern)
    #expect(!fehler.istBereit)
    #expect(fehler.meldung?.contains("brain.mjs") == true)
}

@Test func kernBereitschaftBrauchtAuchWirklichDasSkript() throws {
    let kern = tempOrdner().appendingPathComponent("bin/kern", isDirectory: true)
    let status = Laufzeit.KernStatus.bereit(version: "1.0", ordner: kern)
    // „bereit“, aber der Link zeigt ins Leere: nicht bereit
    #expect(KernBereitschaft.pruefe(status, kern: kern).meldung?.contains("nicht erreichbar") == true)
    try FileManager.default.createDirectory(at: kern, withIntermediateDirectories: true)
    try "// kern".write(to: kern.appendingPathComponent("brain.mjs"), atomically: true, encoding: .utf8)
    #expect(KernBereitschaft.pruefe(status, kern: kern) == .bereit)
}

@Test func kernNichtBereitZeigtSichInDerMenueleiste() {
    let a = StatusAnzeige.kernNichtBereit("Der Kern fehlt.")
    #expect(a.titel == "Der Kern fehlt.")
    #expect(a.zeichen == "✕")
    #expect(a != .keinVault && a != .ohneKit)
}

// MARK: Echter Kern (Ressourcen/kern) mit echtem Node

@Suite(.enabled(if: BrueckenUmgebung.verfuegbar, "braucht Node und den Kern unter Ressourcen/kern"))
struct KernAufrufEchtTests {
    /// Ein `bin/kern`-Symlink wie ihn die App anlegt, hier auf den Kern im Repo.
    static func kernLink() throws -> URL {
        let bin = tempOrdner("Kortex Support/bin")
        let link = bin.appendingPathComponent("kern")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: BrueckenUmgebung.kern)
        return link
    }

    @Test func statusUeberDenStabilenLinkMitAusdruecklichemVault() async throws {
        let vault = try BrueckenUmgebung.vault() // Fixture mit brain.config.json, ohne .tools
        #expect(!FileManager.default.fileExists(atPath: vault.appendingPathComponent(".tools").path))
        let befehl = BrainBefehl(node: BrueckenUmgebung.node!, kern: try Self.kernLink(), vault: vault)
        let s = try await befehl.status()
        #expect(s.zustand == .ok)
        #expect(!s.quellVault)
    }

    @Test func einAltesToolsImVaultWirdIgnoriert() async throws {
        let vault = try BrueckenUmgebung.vault()
        let marke = vault.appendingPathComponent("marke.txt")
        // Ein altes Kit mit Marke: liefe es, stünde die Marke da (und der Status wäre der falsche).
        try FileManager.default.createDirectory(at: vault.appendingPathComponent(".tools/ansicht"), withIntermediateDirectories: true)
        let falsch = "import { appendFileSync } from 'node:fs'; appendFileSync('\(marke.path)', 'x');\nconsole.log('{}');\n"
        try falsch.write(to: vault.appendingPathComponent(".tools/brain.mjs"), atomically: true, encoding: .utf8)
        try falsch.write(to: vault.appendingPathComponent(".tools/ansicht/bruecke.mjs"), atomically: true, encoding: .utf8)
        let befehl = BrainBefehl(node: BrueckenUmgebung.node!, kern: try Self.kernLink(), vault: vault)
        let s = try await befehl.status()
        #expect(s.zustand == .ok)
        // auch die Brücke kommt aus dem Kern
        let b = BrueckenVerbindung(node: BrueckenUmgebung.node!, vault: vault, kern: try Self.kernLink())
        try await b.starte()
        #expect(try await b.anfrage(methode: "GET", pfad: "/api/ping").status == 200)
        await b.beende()
        #expect(!FileManager.default.fileExists(atPath: marke.path), "Code aus <vault>/.tools darf nie laufen")
    }

    /// Workspace-Trust (P5): Ein von außen geöffneter Vault ist nicht vertraut. Der Kern liest weiter (Status), tut aber nichts, was am
    /// Vault etwas bewirkt: Pflege, Hintergrunddienst, Hooks eintragen, Sicherung enden mit Exit 5 und einem Satz — kein git, keine KI.
    @Test func einNichtVertrauterVaultWirdNurGelesen() async throws {
        let vault = try BrueckenUmgebung.vault()
        let support = tempOrdner("Kortex Support Leer") // leerer Support-Ordner: kein Vertrauens-Merker
        let befehl = BrainBefehl(node: BrueckenUmgebung.node!, kern: try Self.kernLink(), vault: vault,
                                 umgebung: ["BRAIN_APP_SUPPORT": support.path, "KORTEX_VAULT_VERTRAUT": ""])
        let s = try await befehl.status()
        #expect(s.zustand == .ok, "Lesen geht ohne Vertrauen")
        for argumente in [["tageslauf", "--probe"], ["dienst", "an"], ["hooks-install"], ["backup"], ["antworten"]] {
            let r = try await befehl.fuehreAus(argumente)
            #expect(r.code == 5, "brain \(argumente.joined(separator: " ")): Exit \(r.code)")
            #expect(r.fehler.contains("noch nicht als deiner bestätigt"))
        }
        #expect(!FileManager.default.fileExists(atPath: support.appendingPathComponent("dienst.json").path))
        #expect(!FileManager.default.fileExists(atPath: vault.appendingPathComponent(".git").path), "kein git gestartet")
    }

    @Test func ordnerOhneBrainConfigEndetMitExit2() async throws {
        let ohne = tempOrdner("Kein Vault")
        let r = try await BrainBefehl(node: BrueckenUmgebung.node!, kern: try Self.kernLink(), vault: ohne).fuehreAus(["status", "--json"])
        #expect(r.code == 2)
        #expect(r.fehler.contains("brain.config.json"))
    }
}
