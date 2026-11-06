import Testing
import Foundation
@testable import BrainCore

// Paket E4 (Konten): Identität nur aus der Ausgabe des Programms und nur auf Wunsch.
// Alles in Temp-Ordnern mit Attrappen; nie ein echtes claude/codex, nie ~/.claude* oder der Schlüsselbund.

private func fundMit(_ koerper: String, programm: String = "claude", in w: KiTestWelt) -> KiFund {
    let bin = w.ordner("identbin")
    let datei = kiAttrappe(koerper, name: programm, in: bin)
    return KiFund(id: programm, name: programm, art: "terminal", pfad: datei.path, version: nil, quelle: "cli", befehl: programm)
}

@Test func anmeldeStatusLiestIdentitaetNurAufWunschUndNurBrauchbares() async {
    let json = "echo '{\"loggedIn\":true,\"email\":\"jemand@example.invalid\",\"subscriptionType\":\"max\",\"token\":\"geheim\",\"orgName\":\"Firma\"}'"
    let w = KiTestWelt()
    let fund = fundMit(json, in: w)
    let ohne = await KiKonto.anmeldeStatus(programm: "claude", ordner: .standard, fund: fund, basisUmgebung: ["PATH": kiSystemPfad])
    #expect(ohne == KiAnmeldung(zustand: "angemeldet"))
    #expect(ohne.identitaet == nil)

    let mit = await KiKonto.anmeldeStatus(programm: "claude", ordner: .standard, fund: fund, basisUmgebung: ["PATH": kiSystemPfad], mitIdentitaet: true)
    #expect(mit.zustand == "angemeldet")
    #expect(mit.identitaet == KiIdentitaet(email: "jemand@example.invalid", plan: "max"))
    #expect(!"\(mit)".contains("geheim"))
    #expect(!"\(mit)".contains("Firma"))
    let o = mit.jsonObjekt()["identitaet"] as? [String: Any]
    #expect(o?["email"] as? String == "jemand@example.invalid")
    #expect(o?["plan"] as? String == "max")
}

@Test func nichtAngemeldetHatNieEineIdentitaet() async {
    let w = KiTestWelt()
    let fund = fundMit("echo '{\"loggedIn\":false,\"email\":\"jemand@example.invalid\"}'", in: w)
    let r = await KiKonto.anmeldeStatus(programm: "claude", ordner: .standard, fund: fund, basisUmgebung: ["PATH": kiSystemPfad], mitIdentitaet: true)
    #expect(r == KiAnmeldung(zustand: "nicht-angemeldet"))
}

@Test func identitaetIstStrengUndFehltImZweifel() {
    func lies(_ programm: String, _ text: String) -> KiIdentitaet? { KiIdentitaet.lies(programm: programm, ausgabe: Data(text.utf8)) }
    // kein JSON, falsche Typen, Müll in den Feldern: nichts
    #expect(lies("claude", "Logged in as jemand@example.invalid") == nil)
    #expect(lies("claude", "{\"email\":42,\"subscriptionType\":[\"max\"]}") == nil)
    #expect(lies("claude", "{\"email\":\"kein-email\",\"subscriptionType\":\"<script>\"}") == nil)
    #expect(lies("claude", "{\"email\":\"a b@example.invalid\"}") == nil)
    #expect(lies("claude", "{\"email\":\"" + String(repeating: "a", count: 200) + "@example.invalid\"}") == nil)
    // nur ein Teil brauchbar
    #expect(lies("claude", "{\"email\":\"x@example.invalid\",\"subscriptionType\":\"\"}") == KiIdentitaet(email: "x@example.invalid", plan: nil))
    #expect(lies("claude", "{\"subscriptionType\":\"pro\"}") == KiIdentitaet(email: nil, plan: "pro"))
    // Codex: nur eine Adresse in einer „logged in“-Zeile
    #expect(lies("codex", "Logged in using ChatGPT") == nil)
    #expect(lies("codex", "Logged in as x@example.invalid (ChatGPT)") == KiIdentitaet(email: "x@example.invalid", plan: nil))
    #expect(lies("codex", "Hinweis an x@example.invalid\nNot logged in") == nil)
}
