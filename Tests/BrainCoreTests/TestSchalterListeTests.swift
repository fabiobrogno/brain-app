import Testing
import Foundation
@testable import BrainCore

// Die Testschalter-Liste (`NodeUmgebung.testSchalter`) gegen den Repo-Stand abgleichen: Neue Testhaken in `Ressourcen/**` fallen auf.

private let repoWurzel = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

/// Namen, die in `Ressourcen/**` vorkommen, aber KEIN Testhaken sind: Betriebsvariablen (die App oder die Werkstatt setzt sie selbst und
/// der Betrieb braucht sie), Entwicklungs-/Diagnosehilfen ohne Schutzwirkung und Namen, die gar keine Umgebungsvariable sind. Ein neuer
/// Name, der hier nicht steht und nicht in `NodeUmgebung.testSchalter`, lässt `testSchalterListeDecktAlleNamenInRessourcenAb` scheitern:
/// dann entscheiden — Testhaken (in `testSchalter`, fliegt im Release raus) oder Betrieb (hier, mit Begründung).
private let betriebsNamen: [String: String] = [
    "BRAIN_VAULT": "setzt die App für Kindprozesse (fuerKind)",
    "BRAIN_APP_SUPPORT": "setzt die App für Kindprozesse (Support-Ordner)",
    "BRAIN_FRISCH_TAGE": "Schonraum der Gesundheit für neue Vaults in Tagen (Standard 7, 0 = aus); ohne Wirkung auf Schutz oder Ablauf der Dateien",
    "BRAIN_ERNTE": "Marke gegen Selbstaufruf der Ernte; muss im Betrieb durchgereicht werden",
    "BRAIN_NODE": "stabiler Node-Pfad für den Hintergrunddienst",
    "BRAIN_MCP_NODE": "stabiler Node-Pfad für neue MCP-Einträge (setzt die App)",
    "BRAIN_NUTZUNG": "setzt die Werkstatt selbst (Probe zählt nicht als KI-Nutzung); Nutzer darf es zum Abschalten setzen",
    "KORTEX_GITHUB_CLIENT_ID": "kommt aus der Info.plist der App",
    "KORTEX_KERN_PFAD": "stabiler Kern-Pfad, den der Starter setzt",
    "BRAIN_PORT": "Entwicklungsserver (entwicklung.mjs), nicht Teil der App",
    "BRAIN_WATCH": "Live-Aktualisierung: „poll“ erzwingt Polling statt fs.watch (Entwicklung/CI); ohne Wirkung auf Schutz oder Ablauf der Dateien",
    "BRAIN_BEFUND_DEBUG": "reine Diagnoseausgabe, ohne Wirkung auf Schutz oder Ablauf",
    "KORTEX_VON_KORTEX": "JavaScript-Konstante, keine Umgebungsvariable",
    "BRAIN_GO_LIVE": "JavaScript-Konstante, keine Umgebungsvariable",
    "BRAIN_CONFIG": "JavaScript-Konstante (Vorlage), keine Umgebungsvariable",
    "BRAIN_DATA": "Fenster-Variable der Übersicht, keine Umgebungsvariable",
    "BRAIN_STEUER_MANUELL": "Fenster-Variable der Übersicht, keine Umgebungsvariable",
    "BRAIN_DENSITY": "Bau-Parameter der Übersicht (build-brain.mjs), nicht Teil der App",
    "BRAIN_FS_CACHE": "Bau-Parameter der Übersicht (build-brain.mjs), nicht Teil der App",
    "BRAIN_MESH": "Bau-Parameter der Übersicht (build-brain.mjs), nicht Teil der App",
    "BRAIN_PITCH": "Bau-Parameter der Übersicht (build-brain.mjs), nicht Teil der App",
]

/// Alle `BRAIN_*`/`KORTEX_*`-Namen in den Quelltexten von `Ressourcen/**` (ohne Markdown und mitgelieferte Fremdbibliotheken).
private func namenInRessourcen() throws -> Set<String> {
    let wurzel = repoWurzel.appendingPathComponent("Ressourcen", isDirectory: true)
    // Kein `\b`: Swifts Wortgrenze (Unicode) trennt „env.BRAIN_X“ nicht, weil ein Punkt zwischen Buchstaben im Wort bleibt; und Lookbehind
    // gibt es nicht. Darum das ganze Wort greifen und nur Wörter nehmen, die mit BRAIN_/KORTEX_ BEGINNEN (nicht MAX_BRAIN_KANDIDATEN).
    let regel = try Regex("[A-Za-z0-9_]*(?:BRAIN|KORTEX)_[A-Z0-9_]+")
    var namen = Set<String>()
    guard let it = FileManager.default.enumerator(at: wurzel, includingPropertiesForKeys: [.isRegularFileKey]) else { return namen }
    for case let url as URL in it {
        if url.pathComponents.contains("vendor") || url.pathExtension == "md" { continue }
        guard (try? url.resourceValues(forKeys: [.isRegularFileKey]))?.isRegularFile == true,
              let daten = try? Data(contentsOf: url), let text = String(data: daten, encoding: .utf8) else { continue } // Bilder u. Ä. fallen raus
        for m in text.matches(of: regel) {
            let wort = String(text[m.range])
            if wort.hasPrefix("BRAIN_") || wort.hasPrefix("KORTEX_") { namen.insert(wort) }
        }
    }
    return namen
}

@Test func testSchalterListeDecktAlleNamenInRessourcenAb() throws {
    let gefunden = try namenInRessourcen()
    #expect(gefunden.count > 40, "der Abgleich muss die Quelltexte wirklich lesen (gefunden: \(gefunden.count))")
    let bekannt = NodeUmgebung.testSchalter.union(betriebsNamen.keys).union([NodeUmgebung.testmodusName, NodeUmgebung.vorschauName])
    let unbekannt = gefunden.subtracting(bekannt).sorted()
    #expect(unbekannt.isEmpty, "Neue BRAIN_*/KORTEX_*-Namen in Ressourcen/**: \(unbekannt). Testhaken → NodeUmgebung.testSchalter (Release entfernt sie); Betriebsvariable oder Nicht-Umgebung → betriebsNamen in diesem Test.")
    // Umgekehrt: nichts Totes in den Listen, und keine Variable in beiden (ein Testhaken im Betrieb widerspräche sich).
    let tot = NodeUmgebung.testSchalter.subtracting(gefunden).sorted()
    #expect(tot.isEmpty, "In testSchalter, aber nirgends mehr in Ressourcen/**: \(tot)")
    let totBetrieb = Set(betriebsNamen.keys).subtracting(gefunden).sorted()
    #expect(totBetrieb.isEmpty, "In betriebsNamen, aber nirgends mehr in Ressourcen/**: \(totBetrieb)")
    let doppelt = NodeUmgebung.testSchalter.intersection(betriebsNamen.keys).sorted()
    #expect(doppelt.isEmpty, "Sowohl Testschalter als auch Betrieb: \(doppelt)")
}

@Test func alleTestSchalterFliegenImReleaseAusUmgebungUndVorgaben() {
    let schalter = Dictionary(uniqueKeysWithValues: NodeUmgebung.testSchalter.map { ($0, "x") })
    let roh = schalter.merging(["PATH": "/usr/bin", "BRAIN_ERNTE": "1"]) { a, _ in a }
    let release = NodeUmgebung.fuerKind(basis: roh, vault: nil, vorgaben: roh, testmodusWeitergeben: false)
    for k in NodeUmgebung.testSchalter { #expect(release[k] == nil, "\(k) darf im Release nicht in den Kindprozess") }
    #expect(release["BRAIN_ERNTE"] == "1", "Betriebsvariablen bleiben")
    let debug = NodeUmgebung.fuerKind(basis: roh, vault: nil, vorgaben: [:], testmodusWeitergeben: true)
    for k in NodeUmgebung.testSchalter { #expect(debug[k] == "x", "\(k) geht im Debug-Build durch") }
}
