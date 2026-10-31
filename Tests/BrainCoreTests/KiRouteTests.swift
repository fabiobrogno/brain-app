import Testing
import Foundation
@testable import BrainCore

// Die Routen /api/ki/… mit Attrappen in Temp-Ordnern; der Terminal-Öffner ist eine Attrappe.

private final class Oeffnungen: @unchecked Sendable {
    private let sperre = NSLock()
    private var urls: [URL] = []
    var antwort = true
    var liste: [URL] { sperre.lock(); defer { sperre.unlock() }; return urls }
    func merke(_ u: URL) -> Bool { sperre.lock(); defer { sperre.unlock() }; urls.append(u); return antwort }
}

private struct RouteWelt {
    let w = KiTestWelt()
    let oeffnungen = Oeffnungen()
    let route: KiRoute
    let bin: URL

    init(claudeKoerper: String? = "echo 'Claude Code 2.0.0'", codex: Bool = false, oeffnerAntwort: Bool = true) {
        bin = w.ordner("bin")
        if let k = claudeKoerper { kiAttrappe(k, name: "claude", in: bin) }
        if codex { kiAttrappe("echo 'codex 1.2.3'", name: "codex", in: bin) }
        oeffnungen.antwort = oeffnerAntwort
        let erkennung = w.erkennung(login: [bin])
        let o = oeffnungen
        route = KiRoute(erkennung: erkennung, support: w.support, home: w.home, basisUmgebung: ["PATH": kiSystemPfad],
                        statusZeitlimit: .milliseconds(1500)) { o.merke($0) }
    }

    func rufe(_ methode: String, _ pfad: String, _ body: String? = nil) async -> BrueckenAntwort? {
        await route.behandle(methode: methode, pfad: pfad, body: body.map { Data($0.utf8) })
    }
}

private func objekt(_ a: BrueckenAntwort?) -> [String: Any] {
    guard let a, let o = (try? JSONSerialization.jsonObject(with: a.body)) as? [String: Any] else { return [:] }
    return o
}

@Test func routeProgrammeLiefertJson() async {
    let r = RouteWelt(codex: true)
    let a = await r.rufe("GET", "/api/ki/programme")
    #expect(a?.status == 200)
    #expect(a?.headers["Content-Type"] == "application/json")
    let o = objekt(a)
    #expect(o["ok"] as? Bool == true)
    #expect(o["ausShell"] as? Bool == true)
    #expect(o["gesucht"] is String)
    let liste = o["programme"] as? [[String: Any]]
    #expect(liste?.map { $0["id"] as? String } == ["claude", "codex"])
    #expect(liste?.first?["version"] as? String == "2.0.0")
    #expect(liste?.first?["quelle"] as? String == "cli")
}

@Test func routeProgrammeNeuSuchtNeu() async {
    let r = RouteWelt()
    _ = await r.rufe("GET", "/api/ki/programme")
    _ = await r.rufe("GET", "/api/ki/programme")
    #expect(kiZaehler(r.w.zaehler) == 1)
    kiAttrappe("echo 'codex 1.2.3'", name: "codex", in: r.bin)
    let a = await r.rufe("GET", "/api/ki/programme?neu=1")
    #expect((objekt(a)["programme"] as? [Any])?.count == 2)
    #expect(kiZaehler(r.w.zaehler) == 2)
}

@Test func routeFremdePfadeGehenAnDieWerkstatt() async {
    let r = RouteWelt()
    #expect(await r.rufe("GET", "/api/vaults") == nil)
    #expect(await r.rufe("GET", "/api/kimono") == nil)
    #expect(await r.rufe("GET", "/api/ki/anderes") == nil)
    #expect(await r.rufe("GET", "/api/ki/programme/x") == nil)
    #expect(await r.rufe("GET", "/") == nil)
    // meine Pfade mit falscher Methode: klare Absage statt Weitergabe
    #expect(await r.rufe("POST", "/api/ki/programme", "{}")?.status == 405)
    #expect(await r.rufe("GET", "/api/ki/anmelden")?.status == 405)
}

@Test func routeAnmeldestatus() async {
    let r = RouteWelt(claudeKoerper: "echo '{\"loggedIn\":true,\"email\":\"jemand@example.invalid\"}'")
    let a = await r.rufe("POST", "/api/ki/anmeldestatus", "{\"programm\":\"claude\",\"ordner\":null}")
    #expect(a?.status == 200)
    #expect(a?.headers["Content-Type"] == "application/json")
    #expect(objekt(a) as NSDictionary == ["zustand": "angemeldet"] as NSDictionary)
    // ohne das Feld „ordner“ ebenso
    #expect(objekt(await r.rufe("POST", "/api/ki/anmeldestatus", "{\"programm\":\"claude\"}"))["zustand"] as? String == "angemeldet")
}

@Test func routeAnmeldestatusMitKontoOrdnerNichtAngemeldetUndUnbekannt() async throws {
    let r = RouteWelt(claudeKoerper: "echo '{\"loggedIn\":false}'")
    let konto = r.w.home.appendingPathComponent(".claude-arbeit", isDirectory: true)
    try FileManager.default.createDirectory(at: konto, withIntermediateDirectories: true)
    let a = await r.rufe("POST", "/api/ki/anmeldestatus", "{\"programm\":\"claude\",\"ordner\":\"\(konto.path)\"}")
    #expect(objekt(a)["zustand"] as? String == "nicht-angemeldet")

    // `--version` antwortet (sonst wäre der Shim „tot“), nur die Statusabfrage hängt.
    let h = RouteWelt(claudeKoerper: "[ \"$1\" = \"--version\" ] && { echo 'claude 1.0.0'; exit 0; }; exec sleep 30")
    let b = await h.rufe("POST", "/api/ki/anmeldestatus", "{\"programm\":\"claude\",\"ordner\":null}")
    #expect(b?.status == 200)
    #expect(objekt(b)["zustand"] as? String == "unbekannt")
    #expect(objekt(b)["grund"] is String)
}

@Test func routeLehntUngueltigeAnfragenMitDeutschemSatzAb() async {
    let r = RouteWelt()
    func fehler(_ a: BrueckenAntwort?) -> String? { objekt(a)["fehler"] as? String }
    let ordner = await r.rufe("POST", "/api/ki/anmeldestatus", "{\"programm\":\"claude\",\"ordner\":\"/etc\"}")
    #expect(ordner?.status == 400)
    #expect(fehler(ordner)?.contains("Konto-Ordner") == true)
    let fremd = await r.rufe("POST", "/api/ki/anmelden", "{\"programm\":\"cursor\",\"ordner\":null}")
    #expect(fremd?.status == 400)
    #expect(fehler(fremd) != nil)
    #expect(await r.rufe("POST", "/api/ki/anmelden", "kein json")?.status == 400)
    #expect(await r.rufe("POST", "/api/ki/anmelden", nil)?.status == 400)
    #expect(await r.rufe("POST", "/api/ki/anmelden", "{\"programm\":\"claude\",\"ordner\":5}")?.status == 400)
    let gross = "{\"programm\":\"claude\",\"x\":\"\(String(repeating: "a", count: 5000))\"}"
    #expect(await r.rufe("POST", "/api/ki/anmeldestatus", gross)?.status == 413)
    #expect(r.oeffnungen.liste.isEmpty)
}

@Test func routeMeldetFehlendesProgramm() async {
    let r = RouteWelt(claudeKoerper: nil)
    let a = await r.rufe("POST", "/api/ki/anmelden", "{\"programm\":\"claude\",\"ordner\":null}")
    #expect(a?.status == 409)
    #expect(objekt(a)["fehler"] as? String == "Claude Code wurde nicht gefunden. Installiere es und klicke dann auf „Neu suchen“.")
    let b = await r.rufe("POST", "/api/ki/anmeldestatus", "{\"programm\":\"codex\",\"ordner\":null}")
    #expect(b?.status == 409)
    #expect((objekt(b)["fehler"] as? String)?.hasPrefix("Codex wurde nicht gefunden.") == true)
    #expect(r.oeffnungen.liste.isEmpty)
}

@Test func routeAnmeldenSchreibtSkriptUndOeffnetEs() async throws {
    let r = RouteWelt()
    let konto = r.w.home.appendingPathComponent(".claude-arbeit", isDirectory: true)
    try FileManager.default.createDirectory(at: konto, withIntermediateDirectories: true)
    let a = await r.rufe("POST", "/api/ki/anmelden", "{\"programm\":\"claude\",\"ordner\":\"\(konto.path)\"}")
    #expect(a?.status == 200)
    let o = objekt(a)
    #expect(o["ok"] as? Bool == true)
    #expect(o["anzeige"] as? String == "CLAUDE_CONFIG_DIR=~/.claude-arbeit claude auth login")
    let urls = r.oeffnungen.liste
    #expect(urls.count == 1)
    let url = try #require(urls.first)
    #expect(url.pathExtension == "command")
    let text = try String(contentsOf: url, encoding: .utf8)
    #expect(text.contains("export CLAUDE_CONFIG_DIR='\(konto.path)'"))
    #expect(text.contains("' auth login\n"))
    // Standardordner
    let b = await r.rufe("POST", "/api/ki/anmelden", "{\"programm\":\"claude\",\"ordner\":null}")
    #expect(objekt(b)["anzeige"] as? String == "claude auth login")
}

@Test func routeAnmeldenMeldetFehlerWennTerminalNichtOeffnet() async {
    let r = RouteWelt(oeffnerAntwort: false)
    let a = await r.rufe("POST", "/api/ki/anmelden", "{\"programm\":\"claude\",\"ordner\":null}")
    #expect(a?.status == 500)
    #expect((objekt(a)["fehler"] as? String)?.contains("Terminal") == true)
    // Das Skript wurde wieder entfernt.
    if let url = r.oeffnungen.liste.first { #expect(!FileManager.default.fileExists(atPath: url.path)) }
}
