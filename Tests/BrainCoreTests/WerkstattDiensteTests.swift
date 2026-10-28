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

@Test func githubAbbrechenMeldetNurAb_wennKeinKontoGespeichertIst() async throws {
    let angemeldet = FalscheWerkstatt(antwort(#"{"verfuegbar":true,"angemeldet":true,"login":"fabio"}"#))
    try await dienste(angemeldet).githubAbbrechen()
    #expect(angemeldet.aufrufe.map(\.pfad) == ["/api/github/konto"], "ein vorhandenes Konto bleibt unberührt")

    let keins = FalscheWerkstatt(antwort(#"{"verfuegbar":true,"angemeldet":false}"#), antwort(#"{"ok":true}"#))
    try await dienste(keins).githubAbbrechen()
    #expect(keins.aufrufe.map(\.pfad) == ["/api/github/konto", "/api/github/abmelden"])
}

// MARK: KI und Probe

@Test func kiErkennungLiestDieAgenten() async throws {
    let w = FalscheWerkstatt(antwort(#"{"agenten":[{"id":"claude","name":"Claude Code","version":"2.1.0","pfad":"/usr/local/bin/claude"},{"id":"codex","name":"Codex","version":null,"pfad":null}]}"#))
    let l = try await dienste(w).erkenneKIs()
    #expect(l == [KiProgramm(id: "claude", name: "Claude Code", version: "2.1.0", gefunden: true),
                  KiProgramm(id: "codex", name: "Codex", version: nil, gefunden: false)])
    #expect(w.aufrufe.first?.pfad == "/api/ki/erkennen?neu=1")
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
    #expect(KiZiel.verbindbar == [.claude])
    #expect(KiZiel.claude.ziel == "claude" && KiZiel.claude.agentId == "claude")
}
