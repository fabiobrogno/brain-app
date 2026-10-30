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

// MARK: Vault umstellen (P7c)

private func statusMitUmstellung(_ block: String?) throws -> BrainStatus {
    let zusatz = block.map { ",\"umstellung\":\($0)" } ?? ""
    return try BrainStatus.aus(ausgabe: "{\"version\":\"1.0.0\",\"quellVault\":false,\"zustand\":\"ok\",\"meldungen\":[],\"zahlen\":{\"vorschlaege\":0,\"konflikte\":0,\"abgelaufen\":0,\"zuTun\":0}\(zusatz)}")
}

@Test func umstellungWirdNurBeiAltlastenAngeboten() throws {
    let alt = try statusMitUmstellung(#"{"altlasten":true,"phase":null}"#)
    let sauber = try statusMitUmstellung(#"{"altlasten":false,"phase":null}"#)
    let fertig = try statusMitUmstellung(#"{"altlasten":false,"phase":"A"}"#)
    let aelterKern = try statusMitUmstellung(nil)
    #expect(alt.umstellung == BrainStatus.Umstellung(altlasten: true, phase: nil))
    #expect(MenueStatus.bietetUmstellungAn(hatVault: true, status: alt))
    #expect(!MenueStatus.bietetUmstellungAn(hatVault: true, status: sauber), "sauberer Vault: kein Eintrag")
    #expect(!MenueStatus.bietetUmstellungAn(hatVault: true, status: fertig), "nach der Umstellung: kein Eintrag")
    #expect(fertig.umstellung?.phase == "A")
    #expect(!MenueStatus.bietetUmstellungAn(hatVault: true, status: aelterKern), "ältere Kerne kennen das Feld nicht")
    #expect(aelterKern.umstellung == nil)
    #expect(!MenueStatus.bietetUmstellungAn(hatVault: true, status: nil), "ohne Status (noch nicht gelesen oder Fehler)")
    #expect(!MenueStatus.bietetUmstellungAn(hatVault: false, status: alt), "ohne Vault gibt es nichts umzustellen")
}

@Test func umstellungStehtNichtImKopfDesMenues() {
    // Der Eintrag „Vault umstellen …“ ist eine Aktion unter den Vault-Befehlen, keine Statuszeile: der Kopf bleibt, wie er war
    #expect(zeilen().map(\.text) == ["Mein Vault", "Alles in Ordnung"])
}

// MARK: Aufgaben in der Menüleiste

private func zeilenMitAufgaben(_ a: BrainStatus.Aufgaben?, name: String? = "Mein Vault") -> [MenueZeile] {
    MenueStatus.zeilen(vaultName: name, anzeige: ok, vertrauen: .vertraut, zahlen: nil, entwicklerVault: false,
                       kernMeldung: nil, zufuehrungsZeilen: [], aufgaben: a)
}

@Test func aufgabenTextMitEinzahlMehrzahlUndUeberfaelligen() {
    #expect(MenueStatus.aufgabenText(nil) == nil)
    #expect(MenueStatus.aufgabenText(.init(offen: 0, ueberfaellig: 0)) == nil)
    #expect(MenueStatus.aufgabenText(.init(offen: 1, ueberfaellig: 0)) == "1 Aufgabe offen")
    #expect(MenueStatus.aufgabenText(.init(offen: 4, ueberfaellig: 0)) == "4 Aufgaben offen")
    #expect(MenueStatus.aufgabenText(.init(offen: 4, ueberfaellig: 2)) == "4 Aufgaben offen · 2 überfällig")
}

@Test func aufgabenZeileFuehrtZumBoardUndWarntBeiUeberfaelligem() {
    let ruhig = zeilenMitAufgaben(.init(offen: 3, ueberfaellig: 0))
    #expect(ruhig.map(\.text) == ["Mein Vault", "Alles in Ordnung", "3 Aufgaben offen"])
    #expect(ruhig[2].art == .normal && ruhig[2].aktion == .aufgabenOeffnen && ruhig[2].symbol == "checklist")
    let dringend = zeilenMitAufgaben(.init(offen: 3, ueberfaellig: 1))
    #expect(dringend[2].art == .hinweis && dringend[2].symbol == "exclamationmark.circle" && dringend[2].text.hasSuffix("1 überfällig"))
}

@Test func ohneOffeneAufgabenOderOhneVaultKeineAufgabenZeile() {
    #expect(zeilenMitAufgaben(.init(offen: 0, ueberfaellig: 0)).count == 2)
    #expect(zeilenMitAufgaben(nil).count == 2)
    #expect(zeilenMitAufgaben(.init(offen: 5, ueberfaellig: 0), name: nil).count == 1)
}

// MARK: Online-Sicherung bei mehreren Geräten

@Test func sicherungshinweisStehtImMenueUndOeffnetDasStudio() {
    let s = BrainStatus.Sicherung(stand: "konflikt", text: "Konflikt – im Studio lösen")
    let r = MenueStatus.zeilen(vaultName: "Mein Vault", anzeige: ok, vertrauen: .vertraut, zahlen: nil, entwicklerVault: false,
                               kernMeldung: nil, zufuehrungsZeilen: [], sicherung: s)
    let zeile = r.first { $0.text == "Konflikt – im Studio lösen" }
    #expect(zeile?.art == .hinweis)
    #expect(zeile?.aktion == .studioOeffnen)
    #expect(MenueStatus.zeilen(vaultName: "Mein Vault", anzeige: ok, vertrauen: .vertraut, zahlen: nil, entwicklerVault: false,
                               kernMeldung: nil, zufuehrungsZeilen: []).count == 2, "ohne Hinweis keine zusätzliche Zeile")
}
