import Testing
import Foundation
@testable import BrainCore

/// Merkt sich die Anfragen an die „Werkstatt“ und antwortet der Reihe nach mit vorbereiteten Antworten.
private final class FalscheWerkstatt: @unchecked Sendable {
    struct Aufruf: Equatable { let methode: String; let pfad: String; let body: [String: AnyHashable]? }
    private let sperre = NSLock()
    private var antworten: [Result<BrueckenAntwort, Error>]
    private(set) var aufrufe: [Aufruf] = []

    init(_ antworten: Result<BrueckenAntwort, Error>...) { self.antworten = antworten }

    var anfrage: WerkstattAnfrage {
        { [self] methode, pfad, body in
            sperre.lock(); defer { sperre.unlock() }
            let b = body.flatMap { (try? JSONSerialization.jsonObject(with: $0)) as? [String: AnyHashable] }
            aufrufe.append(Aufruf(methode: methode, pfad: pfad, body: b))
            return try (antworten.count > 1 ? antworten.removeFirst() : antworten[0]).get()
        }
    }
}

private func antwort(_ status: Int, _ text: String) -> Result<BrueckenAntwort, Error> {
    .success(BrueckenAntwort(status: status, headers: [:], body: Data(text.utf8)))
}
private func antwort(_ text: String) -> Result<BrueckenAntwort, Error> { antwort(200, text) }

private func dienste(_ w: FalscheWerkstatt, pfade: AppPfade? = nil, home: URL? = nil) -> WerkstattDienste {
    WerkstattDienste(pfade: pfade ?? AppPfade(basis: tempOrdner()), git: GitPruefer(starte: { _, _ in throw BefehlFehler.startFehlgeschlagen("nein") }),
                     home: home ?? tempOrdner(), anfrage: w.anfrage)
}

// MARK: Vault

@Test func vaultAnlegenSchicktArtNameUndOrdnerUndLiestDenVault() async throws {
    let w = FalscheWerkstatt(antwort(#"{"vaults":[],"aktiv":"/Users/t/Brain","vault":{"name":"Mein Brain","pfad":"/Users/t/Brain","farbe":"x","git":true},"git":true}"#))
    let v = try await dienste(w).legeVaultAn(art: .vorlage, name: "Mein Brain", ordner: "/Users/t/Brain")
    #expect(v == VaultInfo(name: "Mein Brain", pfad: "/Users/t/Brain", git: true))
    #expect(w.aufrufe == [.init(methode: "POST", pfad: "/api/vaults/neu", body: ["art": "vorlage", "name": "Mein Brain", "ordner": "/Users/t/Brain"])])
}

@Test func vaultAnlegenOhneNameUndOrdnerSchicktNurDieArt() async throws {
    let w = FalscheWerkstatt(antwort(#"{"vault":{"name":"Brain","pfad":"/Users/t/Brain","git":true}}"#))
    _ = try await dienste(w).legeVaultAn(art: .leer, name: "", ordner: nil)
    #expect(w.aufrufe.first?.body == ["art": "leer"])
}

@Test func vaultOeffnenUndKlonen() async throws {
    let w = FalscheWerkstatt(antwort(#"{"vault":{"name":"Notizen","pfad":"/Users/t/Notizen","git":false},"git":false}"#),
                             antwort(#"{"vault":{"name":"x","pfad":"/Users/t/Brain 2","git":true},"git":true}"#))
    let d = dienste(w)
    let a = try await d.oeffneOrdner(pfad: "/Users/t/Notizen", versionsverlaufEinschalten: false)
    #expect(a.git == false)
    let b = try await d.klone(url: "https://github.com/x/y.git", ordner: nil, name: nil)
    #expect(b.pfad == "/Users/t/Brain 2")
    #expect(w.aufrufe[0] == .init(methode: "POST", pfad: "/api/vaults/oeffnen", body: ["pfad": "/Users/t/Notizen", "gitEinschalten": false]))
    #expect(w.aufrufe[1] == .init(methode: "POST", pfad: "/api/vaults/klonen", body: ["url": "https://github.com/x/y.git"]))
}

@Test func vaultAntwortOhnePfadIstEinFehler() async {
    let w = FalscheWerkstatt(antwort(#"{"vault":{}}"#))
    await #expect(throws: EinrichtungsFehler.self) { try await dienste(w).legeVaultAn(art: .vorlage, name: nil, ordner: nil) }
}

@Test func fehlerAntwortDerWerkstattWirdZumLesbarenFehler() async {
    let w = FalscheWerkstatt(antwort(409, #"{"fehler":"Dieser Ordner ist nicht leer."}"#))
    do {
        _ = try await dienste(w).legeVaultAn(art: .vorlage, name: nil, ordner: "/x")
        Issue.record("erwartet Fehler")
    } catch let e as EinrichtungsFehler {
        #expect(e.meldung == "Dieser Ordner ist nicht leer.")
        #expect(e.status == 409)
    } catch { Issue.record("falscher Fehler \(error)") }
}

@Test func fehlerOhneTextBekommtEinenStandardtextMitStatus() async {
    let w = FalscheWerkstatt(antwort(500, "kaputt"))
    do { _ = try await dienste(w).githubKonto(); Issue.record("erwartet Fehler") } catch let e as EinrichtungsFehler {
        #expect(e.meldung.contains("500"))
    } catch { Issue.record("falscher Fehler") }
}

@Test func verbindungsfehlerWerdenZuKlartext() async {
    for (fehler, teil) in [(BrueckenFehler.beendet, "antwortet nicht"), (.startFehlgeschlagen("x"), "antwortet nicht"), (.geschlossen, "antwortet nicht"),
                           (.zeitUeberschritten, "zu lange")] {
        let w = FalscheWerkstatt(.failure(fehler))
        do { _ = try await dienste(w).githubKonto(); Issue.record("erwartet Fehler") } catch let e as EinrichtungsFehler {
            #expect(e.meldung.contains(teil), "\(fehler)")
            #expect(e.status == nil)
        } catch { Issue.record("falscher Fehler") }
    }
}

@Test func aktiverVaultKommtAusDerVaultListeUndNurMitOrdner() async throws {
    let home = tempOrdner()
    let support = tempOrdner()
    let pfade = AppPfade(basis: support)
    let ordner = home.appendingPathComponent("Brain", isDirectory: true)
    let w = FalscheWerkstatt(antwort("{}"))
    let d = dienste(w, pfade: pfade, home: home)
    #expect(await d.aktiverVault() == nil, "keine Liste")

    let liste = #"{"vaults":[{"name":"Mein Brain","pfad":"\#(ordner.path)"}],"aktiv":"\#(ordner.path)"}"#
    try liste.write(to: pfade.vaultListe, atomically: true, encoding: .utf8)
    #expect(await d.aktiverVault() == nil, "Ordner fehlt")

    try FileManager.default.createDirectory(at: ordner.appendingPathComponent(".git"), withIntermediateDirectories: true)
    let v = await d.aktiverVault()
    #expect(v?.name == "Mein Brain")
    #expect(v?.git == true)
    #expect(v?.pfad == ordner.path)
    #expect(w.aufrufe.isEmpty, "gelesen wird die Datei, nicht die Werkstatt")
}

// MARK: GitHub

@Test func githubKontoUndGeraetecode() async throws {
    let w = FalscheWerkstatt(antwort(#"{"verfuegbar":true,"angemeldet":true,"login":"fabio"}"#),
                             antwort(#"{"code":"ABCD-1234","url":"https://github.com/login/device","ablauf":"2026-10-28T20:00:00Z"}"#))
    let d = dienste(w)
    #expect(try await d.githubKonto() == GitHubKonto(verfuegbar: true, angemeldet: true, login: "fabio"))
    #expect(try await d.githubAnmelden() == GitHubGeraetecode(code: "ABCD-1234", url: "https://github.com/login/device", ablauf: "2026-10-28T20:00:00Z"))
    #expect(w.aufrufe[1] == .init(methode: "POST", pfad: "/api/github/anmelden", body: [:]))
}

@Test func githubAntwortOhneCodeIstEinFehler() async {
    let w = FalscheWerkstatt(antwort(#"{}"#))
    await #expect(throws: EinrichtungsFehler.self) { try await dienste(w).githubAnmelden() }
}

@Test func githubStatusAlleZustaende() async throws {
    let w = FalscheWerkstatt(
        antwort(#"{"zustand":"keiner"}"#),
        antwort(#"{"zustand":"wartet","code":"AB-12","url":"https://github.com/login/device","ablauf":"x"}"#),
        antwort(#"{"zustand":"fertig","login":"fabio"}"#),
        antwort(#"{"zustand":"abgelaufen"}"#),
        antwort(#"{"zustand":"abgelehnt","grund":"schluesselbund"}"#),
        antwort(#"{"zustand":"wartet"}"#),
        antwort(#"{"zustand":"etwas Neues"}"#))
    let d = dienste(w)
    #expect(try await d.githubStatus() == .keine)
    #expect(try await d.githubStatus() == .wartet(GitHubGeraetecode(code: "AB-12", url: "https://github.com/login/device", ablauf: "x")))
    #expect(try await d.githubStatus() == .fertig(login: "fabio"))
    #expect(try await d.githubStatus() == .abgelaufen)
    #expect(try await d.githubStatus() == .abgelehnt(grund: "schluesselbund"))
    #expect(try await d.githubStatus() == .keine, "„wartet“ ohne Code ist unbrauchbar")
    #expect(try await d.githubStatus() == .keine)
    #expect(w.aufrufe.allSatisfy { $0.methode == "GET" && $0.pfad == "/api/github/anmelden" })
}

@Test func githubAbbrechenBeendetNurDasWartenUndRuftNieAbmelden() async throws {
    // „Abbrechen“ beim Gerätecode: nur /api/github/abbrechen — nie die Abmeldung (die würde ein frisch gespeichertes Konto löschen)
    let w = FalscheWerkstatt(antwort(#"{"ok":true}"#))
    try await dienste(w).githubAbbrechen()
    #expect(w.aufrufe == [.init(methode: "POST", pfad: "/api/github/abbrechen", body: [:])])
}

// MARK: KI und Probe

@Test func kiErkennungLiestDieAgenten() async throws {
    let w = FalscheWerkstatt(antwort(#"{"agenten":[{"id":"claude","name":"Claude Code","version":"2.1.0","pfad":"/usr/local/bin/claude"},{"id":"codex","name":"Codex","version":null,"pfad":null}],"cursorDa":false}"#))
    let l = try await dienste(w).erkenneKIs()
    #expect(l == [KiProgramm(id: "claude", name: "Claude Code", version: "2.1.0", gefunden: true),
                  KiProgramm(id: "codex", name: "Codex", version: nil, gefunden: false),
                  KiProgramm(id: "cursor", name: "Cursor", version: nil, gefunden: false)])
    #expect(w.aufrufe.first?.pfad == "/api/ki/erkennen?neu=1")
}

@Test func cursorWirdUeberCursorDaOderCursorAgentErkannt() {
    // nur die App / ~/.cursor
    let a = WerkstattDienste.programme(aus: ["agenten": [["id": "cursor-agent", "name": "Cursor Agent", "pfad": NSNull()]], "cursorDa": true])
    #expect(a.last == KiProgramm(id: "cursor", name: "Cursor", version: nil, gefunden: true))
    // nur das Kommandozeilenprogramm, mit Version
    let b = WerkstattDienste.programme(aus: ["agenten": [["id": "cursor-agent", "name": "Cursor Agent", "version": "1.2", "pfad": "/x/cursor-agent"]], "cursorDa": false])
    #expect(b.last == KiProgramm(id: "cursor", name: "Cursor", version: "1.2", gefunden: true))
    // nichts, und ältere Werkstatt ohne Feld
    #expect(WerkstattDienste.programme(aus: ["agenten": []]).last == KiProgramm(id: "cursor", name: "Cursor", version: nil, gefunden: false))
}

@Test func cursorFehlerKaputteDateiBringtMeldungUndEintragZumKopieren() async {
    let w = FalscheWerkstatt(antwort(422, #"{"fehler":"Die Datei ~/.cursor/mcp.json ist kein gültiges JSON in der erwarteten Form.","art":"kaputt","befehl":"{\n  \"mcpServers\": {}\n}"}"#))
    do { _ = try await dienste(w).verbinde(.cursor, umstellen: false); Issue.record("erwartet Fehler") } catch let e as EinrichtungsFehler {
        #expect(e.art == "kaputt" && e.status == 422)
        #expect(e.befehl?.contains("mcpServers") == true)
        #expect(!e.istAndererEintrag)
    } catch { Issue.record("falscher Fehler") }
    #expect(w.aufrufe.first?.body == ["ziel": "cursor"])
}

@Test func verbindenSchicktZielUndUmstellenUndErkenntSchonVerbunden() async throws {
    let w = FalscheWerkstatt(antwort(#"{"ok":true,"ausgabe":"x"}"#), antwort(#"{"ok":true,"schonVerbunden":true}"#))
    let d = dienste(w)
    #expect(try await d.verbinde(.claude, umstellen: false) == .verbunden)
    #expect(try await d.verbinde(.claude, umstellen: true) == .schonVerbunden)
    #expect(w.aufrufe[0].body == ["ziel": "claude"])
    #expect(w.aufrufe[1].body == ["ziel": "claude", "umstellen": true])
}

@Test func verbindenMitFremdemEintragIstEinFehlerMitArtUndBefehl() async {
    let w = FalscheWerkstatt(antwort(409, #"{"fehler":"Bei Claude Code ist schon ein anderer Server eingetragen.","art":"anders","befehl":"claude mcp add -s user brain -- node x"}"#))
    do { _ = try await dienste(w).verbinde(.claude, umstellen: false); Issue.record("erwartet Fehler") } catch let e as EinrichtungsFehler {
        #expect(e.istAndererEintrag)
        #expect(e.befehl == "claude mcp add -s user brain -- node x")
    } catch { Issue.record("falscher Fehler") }
}

@Test func probeLiefertTrefferTitelOderPfade() async throws {
    let w = FalscheWerkstatt(antwort(#"{"frage":"Brain","treffer":[{"titel":"Willkommen","pfad":"a.md"},{"titel":"","pfad":"b.md"},{"pfad":"c.md"}],"text":"…"}"#))
    let r = try await dienste(w).probe(frage: "Brain")
    #expect(r == ProbeErgebnis(frage: "Brain", treffer: ["Willkommen", "b.md", "c.md"]))
    #expect(w.aufrufe.first == .init(methode: "POST", pfad: "/api/probe", body: ["frage": "Brain"]))
}

// MARK: Ziele

@Test func nurVerbindbareKiZieleStehenInDerListe() {
    #expect(KiZiel.verbindbar == [.claude, .codex, .cursor])
    #expect(KiZiel.claude.ziel == "claude" && KiZiel.claude.agentId == "claude")
    #expect(KiZiel.codex.ziel == "codex" && KiZiel.codex.agentId == "codex")
    #expect(KiZiel.cursor.ziel == "cursor" && KiZiel.cursor.agentId == "cursor")
    #expect(KiZiel.cursor.kopierHinweis.contains("mcp.json"))
    #expect(KiZiel.codex.kopierHinweis.contains("Terminal"))
}

// MARK: Sicherung (FBL-88)

@Test func sicherungVorpruefungLiestDenZustandUndWertetFehlerNieAlsKeinRemote() async {
    let w = FalscheWerkstatt(antwort(#"{"zustand":"gesichert"}"#), antwort(#"{"zustand":"bereit"}"#),
                             antwort(#"{"zustand":"blockiert","grund":"gesperrt","text":"Git ist gesperrt."}"#),
                             antwort(#"{"zustand":"etwas Neues"}"#),
                             antwort(500, #"{"fehler":"Git-Status war nicht lesbar."}"#))
    let d = dienste(w)
    #expect(await d.sicherungVorpruefung() == .gesichert)
    #expect(await d.sicherungVorpruefung() == .bereit)
    #expect(await d.sicherungVorpruefung() == .blockiert("Git ist gesperrt."))
    #expect(await d.sicherungVorpruefung().blockiertText != nil, "unbekannte Antwort ist blockiert, nicht bereit")
    let fehler = await d.sicherungVorpruefung()
    guard case .blockiert(let text) = fehler else { Issue.record("Statusfehler muss blockiert sein"); return }
    #expect(text.contains("Git-Status war nicht lesbar") && text.contains("nichts bei GitHub angelegt"))
    #expect(w.aufrufe.allSatisfy { $0 == .init(methode: "GET", pfad: "/api/sicherung/bereit", body: nil) })
}

@Test func reposLiestNurWohlgeformteEintraegeUndDasKuerzen() async throws {
    let w = FalscheWerkstatt(antwort(#"""
    {"repos":[{"name":"brain","besitzer":"anna","url":"https://github.com/anna/brain.git","aktualisiert":"2026-10-01T10:00:00Z","leer":false},
              {"name":"leer","besitzer":"anna","url":"https://github.com/anna/leer.git","aktualisiert":null,"leer":true},
              {"name":"boese","besitzer":"anna","url":"https://boese.example/anna/boese.git"},
              {"name":"ohne-url","besitzer":"anna"}],"gekuerzt":true}
    """#))
    let l = try await dienste(w).githubRepos()
    #expect(l.repos == [GitHubRepo(name: "brain", besitzer: "anna", url: "https://github.com/anna/brain.git", aktualisiert: "2026-10-01T10:00:00Z", leer: false),
                        GitHubRepo(name: "leer", besitzer: "anna", url: "https://github.com/anna/leer.git", aktualisiert: nil, leer: true)])
    #expect(l.gekuerzt)
    #expect(w.aufrufe == [.init(methode: "GET", pfad: "/api/github/repos", body: nil)])
}

@Test func repoAnlegenSchicktNurDenNamenUndVerlangtPrivat() async throws {
    let w = FalscheWerkstatt(antwort(#"{"name":"brain","besitzer":"anna","url":"https://github.com/anna/brain.git","privat":true}"#),
                             antwort(#"{"name":"brain","besitzer":"anna","url":"https://github.com/anna/brain.git"}"#),
                             antwort(409, #"{"fehler":"Du hast schon ein Repository mit diesem Namen.","art":"name-vergeben"}"#))
    let d = dienste(w)
    let r = try await d.githubRepoAnlegen(name: "brain")
    #expect(r.url == "https://github.com/anna/brain.git" && r.vollerName == "anna/brain")
    #expect(w.aufrufe == [.init(methode: "POST", pfad: "/api/github/repo-anlegen", body: ["name": "brain"])], "kein Feld für die Sichtbarkeit")
    // Eine Antwort ohne ausdrückliches „privat“ wird nicht verwendet.
    await #expect(throws: EinrichtungsFehler.self) { _ = try await d.githubRepoAnlegen(name: "brain") }
    do { _ = try await d.githubRepoAnlegen(name: "brain"); Issue.record("hätte werfen müssen") } catch let f as EinrichtungsFehler {
        #expect(f.status == 409 && f.art == "name-vergeben")
    }
}

@Test func verbindeSicherungSendetNurBesitzerUndNameUndLiestDasErgebnis() async throws {
    let w = FalscheWerkstatt(antwort(#"{"ok":true,"ergebnis":"gesendet","remote":"origin","zweig":"main"}"#),
                             antwort(#"{"ok":true,"ergebnis":"geholt"}"#), antwort(#"{"ok":true}"#),
                             antwort(409, #"{"fehler":"Dieses Repository hat eine andere Geschichte.","art":"fremd"}"#))
    let d = dienste(w)
    #expect(try await d.verbindeSicherung(besitzer: "anna", name: "brain") == .gesendet)
    #expect(try await d.verbindeSicherung(besitzer: "anna", name: "brain") == .geholt)
    #expect(try await d.verbindeSicherung(besitzer: "anna", name: "brain") == .verbunden)
    #expect(w.aufrufe.first == .init(methode: "POST", pfad: "/api/sicherung/verbinden", body: ["besitzer": "anna", "name": "brain"]), "keine freie Adresse")
    #expect(w.aufrufe.allSatisfy { $0.pfad == "/api/sicherung/verbinden" && Set($0.body?.keys.map { $0 } ?? []) == ["besitzer", "name"] })
    do { _ = try await d.verbindeSicherung(besitzer: "anna", name: "anders"); Issue.record("hätte werfen müssen") } catch let f as EinrichtungsFehler {
        #expect(f.status == 409 && f.art == "fremd")
    }
}
