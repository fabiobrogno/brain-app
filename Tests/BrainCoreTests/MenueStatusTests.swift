import Testing
import Foundation
@testable import BrainCore

private let ok = StatusAnzeige(symbol: "checkmark.circle", zeichen: "✓", titel: "Alles in Ordnung")

private func zeilen(name: String? = "Mein Vault", anzeige: StatusAnzeige = ok, vertrauen: VaultVertrauen? = .vertraut,
                    zahlen: BrainStatus.Zahlen? = nil, entwickler: Bool = false, kern: String? = nil, zufuehrung: [String] = []) -> [MenueZeile] {
    MenueStatus.zeilen(vaultName: name, anzeige: anzeige, vertrauen: vertrauen, zahlen: zahlen, entwicklerVault: entwickler,
                       kernMeldung: kern, zufuehrungsZeilen: zufuehrung)
}

private func z(_ vorschlaege: Int, _ konflikte: Int, _ abgelaufen: Int) -> BrainStatus.Zahlen {
    BrainStatus.Zahlen(vorschlaege: vorschlaege, konflikte: konflikte, abgelaufen: abgelaufen, zuTun: vorschlaege + konflikte, rueckfragen: nil)
}

@Test func vaultMitNamenUndZustandStehenOben() {
    let r = zeilen()
    #expect(r.map(\.text) == ["Mein Vault", "Alles in Ordnung"])
    #expect(r[0].art == .kopf && r[0].symbol == "folder")
    #expect(r[1].art == .normal && r[1].symbol == "checkmark.circle")
}

@Test func keinVaultZeigtNurDenZustand() {
    let r = zeilen(name: nil, anzeige: .keinVault, vertrauen: nil)
    #expect(r.map(\.text) == ["Kein Vault gewählt"])
}

@Test func nurAnsehenSteht_alsHinweisUnterDemZustand() {
    let r = zeilen(vertrauen: .nurAnsehen)
    #expect(r.map(\.text) == ["Mein Vault", "Alles in Ordnung", "Nur ansehen — noch nicht als dein Vault bestätigt"])
    #expect(r[2].art == .hinweis && r[2].symbol == "eye")
    #expect(r[2].erklaerung?.contains("kein Git") == true)
}

@Test func zahlenNurWennNichtNullMitEinzahlUndMehrzahl() {
    #expect(MenueStatus.zahlenText(z(0, 0, 0)) == nil)
    #expect(MenueStatus.zahlenText(nil) == nil)
    #expect(MenueStatus.zahlenText(z(1, 1, 0)) == "1 Vorschlag · 1 Konflikt")
    #expect(MenueStatus.zahlenText(z(3, 0, 2)) == "3 Vorschläge · 2 abgelaufen")
    #expect(zeilen(zahlen: z(0, 0, 0)).count == 2)
    #expect(zeilen(zahlen: z(2, 0, 0)).last?.text == "2 Vorschläge")
}

@Test func warnungMitDreieckUndFehlerMitXSindUnterscheidbar() {
    let warn = zeilen(anzeige: StatusAnzeige(symbol: "exclamationmark.triangle", zeichen: "⚠", titel: "2 Sachen warten"))
    #expect(warn[1].art == .hinweis && warn[1].symbol == "exclamationmark.triangle")
    let fehler = zeilen(anzeige: .problem("Vault-Ordner nicht gefunden"))
    #expect(fehler[1].art == .fehler && fehler[1].symbol == "xmark.octagon")
}

@Test func technischeTexteWerdenVerstaendlich() {
    #expect(zeilen(anzeige: .ohneKit)[1].text == "Nur Notizen — ohne Kortex-Prüfung")
    let lang = "Der gebündelte Kern ist nicht bereit: die Prüfsumme von kern/brain.mjs stimmt nicht mit dem Manifest überein, bitte neu installieren."
    let k = zeilen(anzeige: .kernNichtBereit(lang), kern: lang)[1]
    #expect(k.text == "Kortex-Kern nicht bereit")
    #expect(k.art == .fehler)
    #expect(k.erklaerung?.hasPrefix(lang) == true)
    #expect(k.aktion == .protokollZeigen)
}

@Test func langeTexteWerdenGekuerztDerVolleTextBleibtAlsErklaerung() {
    let lang = String(repeating: "x", count: 100)
    let r = zeilen(anzeige: .problem(lang))[1]
    #expect(r.text.count == MenueStatus.hoechstZeichen)
    #expect(r.text.hasSuffix("…"))
    #expect(r.erklaerung == lang)
    #expect(zeilen()[1].erklaerung == nil)
}

@Test func entwicklerVaultUndZufuehrungenBleibenSichtbar() {
    let r = zeilen(entwickler: true, zufuehrung: ["Zuführung „Notizen-Sync“ steht still"])
    #expect(r.map(\.text).contains("Entwickler-Vault — bekommt keine Updates"))
    #expect(r.last?.symbol == "exclamationmark.triangle")
    #expect(r.last?.art == .hinweis)
}

@Test func reihenfolgeVaultZustandVertrauenZahlenEntwicklerWarnungen() {
    let r = zeilen(vertrauen: .nurAnsehen, zahlen: z(1, 0, 0), entwickler: true, zufuehrung: ["w"])
    #expect(r.map(\.symbol) == ["folder", "checkmark.circle", "eye", "list.bullet", "hammer", "exclamationmark.triangle"])
}

@Test func nurWichtigesFuehrtPerKlickWeiter() {
    let r = zeilen(vertrauen: .nurAnsehen, zahlen: z(1, 0, 0), entwickler: true, zufuehrung: ["w"])
    // Name → Vault wechseln, „Nur ansehen“ → Einstellungen, Warnung → Studio; reine Auskunft (Zustand ✓, Zahlen, Entwickler) ohne Aktion
    #expect(r.map(\.aktion) == [.vaultWechseln, .keine, .vertrauenPruefen, .keine, .keine, .studioOeffnen])
    let warn = zeilen(anzeige: StatusAnzeige(symbol: "exclamationmark.triangle", zeichen: "⚠", titel: "1 Sache wartet"))
    #expect(warn[1].aktion == .studioOeffnen)
    #expect(zeilen(anzeige: .problem("kaputt"))[1].aktion == .studioOeffnen)
    #expect(zeilen(name: nil, anzeige: .keinVault, vertrauen: nil).map(\.aktion) == [.keine])
}
