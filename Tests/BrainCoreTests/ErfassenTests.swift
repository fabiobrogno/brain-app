import Testing
import Foundation
import AppKit
@testable import BrainCore

// MARK: Tastenkürzel

@Test func standardkuerzelIstControlOptionLeertaste() {
    let k = Tastenkuerzel.standard
    #expect(k.anzeige == "⌃⌥Leertaste")
    #expect(k.carbonUmschalter == 0x1000 | 0x0800)
    #expect(k.taste == 49)
    #expect(Tastenkuerzel(taste: 0, umschalter: [.command, .shift]).anzeige == "⇧⌘A", "Reihenfolge wie im System: ⌃ ⌥ ⇧ ⌘")
    #expect(Tastenkuerzel(taste: 122, umschalter: [.control]).anzeige == "⌃F1")
}

@Test func kuerzelSindCodableUndTastenNamenSindEindeutig() throws {
    let k = Tastenkuerzel(taste: 11, umschalter: [.control, .command])
    let zurueck = try JSONDecoder().decode(Tastenkuerzel.self, from: JSONEncoder().encode(k))
    #expect(zurueck == k)
    let namen = Tastenkuerzel.tastenNamen.values
    #expect(Set(namen).count == namen.count, "zwei Tasten mit demselben Namen")
}

@Test func tastendruckWirdZumKuerzel() {
    let k = Tastenkuerzel.ausEreignis(code: 49, flags: [.control, .option, .capsLock])
    #expect(k == .standard, "Feststelltaste zählt nicht")
    #expect(Tastenkuerzel.ausEreignis(code: 1, flags: [.command, .shift]) == Tastenkuerzel(taste: 1, umschalter: [.command, .shift]))
}

@Test func escUndLoeschenSindKeineKuerzelTasten() {
    #expect(!Tastenkuerzel.tasteErlaubt(53) && !Tastenkuerzel.tasteErlaubt(51))
    #expect(!Tastenkuerzel.tasteErlaubt(9999))
    #expect(Tastenkuerzel.tasteErlaubt(49))
}

// MARK: Prüfung gegen Systemkürzel

/// So sieht ein Ausschnitt von `com.apple.symbolichotkeys` aus (Zahlen wie die Einstellungen sie speichern).
private func systemWoerterbuch(naechsteQuelleAn: Bool) -> [String: Any] {
    [
        // 61: Nächste Eingabequelle = ⌃⌥Leertaste (keycode 49, ctrl 0x40000 + alt 0x80000)
        "61": ["enabled": naechsteQuelleAn, "value": ["type": "standard", "parameters": [32, 49, 786432]]],
        // 60: Vorherige Eingabequelle = ⌃Leertaste
        "60": ["enabled": true, "value": ["type": "standard", "parameters": [32, 49, 262144]]],
        // 64: Spotlight = ⌘Leertaste
        "64": ["enabled": true, "value": ["type": "standard", "parameters": [32, 49, 1048576]]],
        // kaputte Einträge werden übersprungen
        "999": ["enabled": true, "value": ["parameters": [1]]],
        "998": "kein Wörterbuch",
    ]
}

@Test func systemkuerzelWerdenGelesenNurEingeschaltete() {
    let an = SystemKuerzelLeser.lese(systemWoerterbuch(naechsteQuelleAn: true))
    #expect(an.count == 3)
    #expect(an.contains(SystemKuerzel(name: "Nächste Eingabequelle", taste: 49, umschalter: [.control, .option])))
    let aus = SystemKuerzelLeser.lese(systemWoerterbuch(naechsteQuelleAn: false))
    #expect(aus.count == 2 && !aus.contains { $0.name == "Nächste Eingabequelle" })
    #expect(SystemKuerzelLeser.lese(nil).isEmpty)
}

@Test func standardkuerzelKollidiertNurWennNaechsteEingabequelleAnIst() {
    let an = SystemKuerzelLeser.lese(systemWoerterbuch(naechsteQuelleAn: true))
    #expect(KuerzelPruefung.pruefe(.standard, system: an) == .system("Nächste Eingabequelle"))
    #expect(KuerzelPruefung.pruefe(.standard, system: SystemKuerzelLeser.lese(systemWoerterbuch(naechsteQuelleAn: false))) == nil)
    #expect(KuerzelPruefung.pruefe(Tastenkuerzel(taste: 49, umschalter: [.command]), system: an) == .system("Spotlight-Suche"))
    #expect(KuerzelPruefung.pruefe(.standard, system: []) == nil)
}

@Test func kuerzelOhneControlOderBefehlWerdenAbgelehnt() {
    #expect(KuerzelPruefung.pruefe(Tastenkuerzel(taste: 49, umschalter: [.option]), system: []) == .umschalterFehlt)
    #expect(KuerzelPruefung.pruefe(Tastenkuerzel(taste: 0, umschalter: [.option, .shift]), system: []) == .umschalterFehlt)
    #expect(KuerzelPruefung.pruefe(Tastenkuerzel(taste: 0, umschalter: []), system: []) == .umschalterFehlt)
    #expect(KuerzelPruefung.pruefe(Tastenkuerzel(taste: 53, umschalter: [.control]), system: []) == .tasteUnbekannt)
    #expect(KuerzelPruefung.pruefe(Tastenkuerzel(taste: 0, umschalter: [.control]), system: []) == nil)
    for p in [KuerzelPruefung.Problem.umschalterFehlt, .tasteUnbekannt, .system("X")] { #expect(!p.text.isEmpty) }
}

// MARK: Anmeldung über die Schnittstelle

/// Attrappe für `KuerzelRegistrierung`: merkt sich, was angemeldet ist; `belegt` lässt die Anmeldung scheitern.
@MainActor
final class FalscheRegistrierung: KuerzelRegistrierung {
    var angemeldet: Tastenkuerzel?
    var belegt: [Tastenkuerzel] = []
    var verlauf: [String] = []
    private var aktion: (@MainActor () -> Void)?

    func registriere(_ kuerzel: Tastenkuerzel, aktion: @escaping @MainActor () -> Void) throws {
        hebeAuf()
        verlauf.append("an \(kuerzel.anzeige)")
        if belegt.contains(kuerzel) { throw KuerzelFehler.belegt }
        angemeldet = kuerzel
        self.aktion = aktion
    }

    func hebeAuf() {
        if angemeldet != nil { verlauf.append("ab \(angemeldet!.anzeige)") }
        angemeldet = nil
        aktion = nil
    }

    /// Der Nutzer drückt das Kürzel.
    func druecke() { aktion?() }
}

@MainActor private func verwaltung(_ reg: FalscheRegistrierung, gespeichert: Tastenkuerzel? = nil, system: [SystemKuerzel] = [],
                                   aktion: @escaping @MainActor () -> Void = {}, sichere: @escaping (Tastenkuerzel?) -> Void = { _ in }) -> KuerzelVerwaltung {
    KuerzelVerwaltung(registrierung: reg, gespeichert: gespeichert, system: { system }, sichere: sichere, aktion: aktion)
}

@MainActor @Test func beimStartWirdDasStandardkuerzelAngemeldetUndLoestDieAktionAus() {
    let reg = FalscheRegistrierung()
    var ausgeloest = 0
    let v = verwaltung(reg, aktion: { ausgeloest += 1 })
    #expect(v.starte() == nil)
    #expect(reg.angemeldet == .standard && v.angemeldet)
    reg.druecke(); reg.druecke()
    #expect(ausgeloest == 2)
}

@MainActor @Test func einGespeichertesKuerzelHatVorrangVorDemStandard() {
    let reg = FalscheRegistrierung()
    let eigenes = Tastenkuerzel(taste: 14, umschalter: [.control, .option, .command])
    let v = verwaltung(reg, gespeichert: eigenes)
    #expect(v.starte() == nil && reg.angemeldet == eigenes && v.kuerzel == eigenes)
}

@MainActor @Test func einBelegtesKuerzelBeimStartWirdGemeldetAberDieAppLaeuftWeiter() {
    let reg = FalscheRegistrierung()
    reg.belegt = [.standard]
    let v = verwaltung(reg)
    let hinweis = v.starte()
    #expect(hinweis?.contains("belegt") == true)
    #expect(reg.angemeldet == nil && !v.angemeldet)
}

@MainActor @Test func einVomSystemVergebenesKuerzelBeimStartGiltTrotzdemMitWarnung() {
    let reg = FalscheRegistrierung()
    let system = SystemKuerzelLeser.lese(systemWoerterbuch(naechsteQuelleAn: true))
    let v = verwaltung(reg, system: system)
    let hinweis = v.starte()
    #expect(hinweis?.contains("Nächste Eingabequelle") == true)
    #expect(reg.angemeldet == .standard, "bewusste Wahl des Nutzers, die Warnung genügt")
}

@MainActor @Test func einNeuesKuerzelWirdAngemeldetUndGespeichertDasAlteAbgemeldet() {
    let reg = FalscheRegistrierung()
    var gesichert: [Tastenkuerzel?] = []
    let v = verwaltung(reg, sichere: { gesichert.append($0) })
    v.starte()
    let neu = Tastenkuerzel(taste: 14, umschalter: [.control, .option, .command])
    #expect(v.aendere(neu) == nil)
    #expect(reg.angemeldet == neu && v.kuerzel == neu)
    #expect(gesichert == [neu])
    #expect(reg.verlauf == ["an ⌃⌥Leertaste", "ab ⌃⌥Leertaste", "an ⌃⌥⌘E"])
}

@MainActor @Test func einBelegtesNeuesKuerzelBleibtAbgelehntUndDasAlteBleibtAktiv() {
    let reg = FalscheRegistrierung()
    var gesichert: [Tastenkuerzel?] = []
    let v = verwaltung(reg, sichere: { gesichert.append($0) })
    v.starte()
    let neu = Tastenkuerzel(taste: 14, umschalter: [.control, .command])
    reg.belegt = [neu]
    let fehler = v.aendere(neu)
    #expect(fehler?.contains("belegt") == true)
    #expect(reg.angemeldet == .standard && v.kuerzel == .standard, "das alte Kürzel gilt weiter")
    #expect(gesichert.isEmpty)
}

@MainActor @Test func einUngueltigesOderSystemKuerzelWirdNichtEinmalVersucht() {
    let reg = FalscheRegistrierung()
    let system = SystemKuerzelLeser.lese(systemWoerterbuch(naechsteQuelleAn: false))
    let v = verwaltung(reg, system: system)
    v.starte()
    reg.verlauf = []
    #expect(v.aendere(Tastenkuerzel(taste: 49, umschalter: [.option])) != nil)
    #expect(v.aendere(Tastenkuerzel(taste: 49, umschalter: [.command]))?.contains("Spotlight") == true)
    #expect(reg.verlauf.isEmpty && reg.angemeldet == .standard)
}

@MainActor @Test func zurueckAufDenStandardSpeichertNil() {
    let reg = FalscheRegistrierung()
    var gesichert: [Tastenkuerzel?] = []
    let v = verwaltung(reg, gespeichert: Tastenkuerzel(taste: 14, umschalter: [.control, .command]), sichere: { gesichert.append($0) })
    v.starte()
    #expect(v.setzeZurueck() == nil && v.kuerzel == .standard && reg.angemeldet == .standard)
    #expect(gesichert.count == 1 && gesichert[0] == nil)
}

@MainActor @Test func beendenMeldetDasKuerzelAb() {
    let reg = FalscheRegistrierung()
    let v = verwaltung(reg)
    v.starte()
    v.beende()
    #expect(reg.angemeldet == nil && !v.angemeldet)
}

// MARK: Einstellungen

@Test func einstellungenWerdenGespeichertUndKaputteDateienGebenStandard() throws {
    let pfade = AppPfade(basis: tempOrdner("support"))
    #expect(ErfassenEinstellungen.lade(pfade) == ErfassenEinstellungen())
    #expect(ErfassenEinstellungen().wirksamesKuerzel == .standard)
    let e = ErfassenEinstellungen(kuerzel: Tastenkuerzel(taste: 14, umschalter: [.control, .command]), art: .notiz)
    try e.speichere(pfade)
    #expect(ErfassenEinstellungen.lade(pfade) == e)
    #expect(ErfassenEinstellungen.datei(pfade).lastPathComponent == "schnell-erfassen.json")
    try Data("{kaputt".utf8).write(to: ErfassenEinstellungen.datei(pfade))
    #expect(ErfassenEinstellungen.lade(pfade) == ErfassenEinstellungen())
}

// MARK: Platzierung

@Test func dasFensterErscheintMittigObenImSichtbarenBereich() {
    let sichtbar = CGRect(x: 0, y: 0, width: 1440, height: 875)
    let r = ErfassenPlatzierung.rahmen(sichtbar: sichtbar, groesse: CGSize(width: 560, height: 276))
    #expect(r.midX == 720 && r.width == 560 && r.height == 276)
    #expect(r.maxY < sichtbar.maxY && r.maxY > sichtbar.maxY - 200, "oben, aber mit Abstand")
    // zweiter Bildschirm links daneben (negativer Ursprung) und ein kleiner Bildschirm
    let links = CGRect(x: -1920, y: 100, width: 1920, height: 1055)
    let l = ErfassenPlatzierung.rahmen(sichtbar: links, groesse: CGSize(width: 560, height: 276))
    #expect(l.midX == links.midX && l.maxY <= links.maxY && l.minY >= links.minY)
    let klein = CGRect(x: 0, y: 0, width: 500, height: 250)
    let k = ErfassenPlatzierung.rahmen(sichtbar: klein, groesse: CGSize(width: 560, height: 276))
    #expect(k.minX >= 0 && k.minY >= 0, "nie aus dem Bildschirm heraus")
}

// MARK: Modell: Attrappen

actor FalscherSpeicher: ErfassenSpeicher {
    private(set) var gespeichert: [Erfassung] = []
    var fehler: ErfassenFehler?
    func setzeFehler(_ f: ErfassenFehler?) { fehler = f }
    func speichere(_ e: Erfassung) async throws -> String {
        if let fehler { throw fehler }
        gespeichert.append(e)
        return e.art == .aufgabe ? "05_aufgaben/neu.md" : "00_inbox/neu.md"
    }
}

@MainActor
private final class Aufbau {
    let speicher = FalscherSpeicher()
    var vaults = [ErfassenVault(name: "Privat", url: URL(fileURLWithPath: "/tmp/erfassen-test/privat")),
                  ErfassenVault(name: "Firma", url: URL(fileURLWithPath: "/tmp/erfassen-test/firma"))]
    var aktiv: URL? { vaults.first?.url }
    var vertraut: Set<String> = ["/tmp/erfassen-test/privat", "/tmp/erfassen-test/firma"]
    var geschlossen = 0
    var gemerkt: [ErfassungsArt] = []
    var gewartet: [Duration] = []
    var waehrendWarten: (() -> Void)?
    let modell: ErfassenModell

    init(art: ErfassungsArt = .aufgabe) {
        var selbst: Aufbau?
        modell = ErfassenModell(
            art: art, speicher: speicher,
            vaultQuelle: { (selbst?.vaults ?? [], selbst?.aktiv) },
            vertrauen: { selbst?.vertraut.contains($0.path) == true ? .vertraut : .nurAnsehen },
            heute: { erfassenHeute }, kalender: erfassenKalender,
            warte: { d in await MainActor.run { selbst?.gewartet.append(d); selbst?.waehrendWarten?() } },
            merkeArt: { selbst?.gemerkt.append($0) })
        selbst = self
        modell.ladeVaults()
        modell.beiSchliessen = { [unowned self] in geschlossen += 1 }
    }
}

@MainActor @Test func eineAufgabeWirdMitKurzformenGespeichertUndDasFensterSchliesstNachDerBestaetigung() async {
    let a = Aufbau()
    a.modell.text = "Steuer machen morgen !hoch\nUnterlagen im Ordner"
    #expect(a.modell.kannSpeichern)
    await a.modell.speichere()
    let liste = await a.speicher.gespeichert
    #expect(liste.count == 1)
    let e = liste[0]
    #expect(e.art == .aufgabe && e.titel == "Steuer machen" && e.text == "Unterlagen im Ordner")
    #expect(e.prioritaet == .hoch && e.faellig == "2026-10-31")
    #expect(e.vault.path == "/tmp/erfassen-test/privat", "Standard: der aktive Vault")
    #expect(a.modell.text.isEmpty, "nach dem Speichern ist das Feld leer")
    #expect(a.modell.zustand == .gespeichert(vault: "Privat"))
    #expect(a.geschlossen == 1 && a.gewartet == [.milliseconds(900)], "Bestätigung, dann schließen")
    #expect(a.gemerkt == [.aufgabe])
}

@MainActor @Test func eineNotizGehtUnveraendertInDenPosteingang() async {
    let a = Aufbau(art: .notiz)
    a.modell.text = "Idee: Kaffee morgen !hoch\n  zweite Zeile  \n"
    await a.modell.speichere()
    let e = await a.speicher.gespeichert[0]
    #expect(e.art == .notiz && e.text == "Idee: Kaffee morgen !hoch\n  zweite Zeile", "bei Notizen gibt es keine Kurzformen")
    #expect(e.prioritaet == nil && e.faellig == nil && e.titel.isEmpty)
    #expect(a.gemerkt == [.notiz])
}

@MainActor @Test func einAnderesZielWirdBenutzt() async {
    let a = Aufbau()
    a.modell.zielPfad = a.vaults[1].id
    a.modell.text = "Angebot schreiben"
    await a.modell.speichere()
    #expect(await a.speicher.gespeichert[0].vault.path == "/tmp/erfassen-test/firma")
    #expect(a.modell.zustand == .gespeichert(vault: "Firma"))
}

@MainActor @Test func inEinemNichtVertrautenVaultWirdNichtGespeichert() async {
    let a = Aufbau()
    a.vertraut = []
    a.modell.text = "Steuer machen"
    #expect(a.modell.zielHinweis?.contains("nur zum Ansehen") == true, "schon vor dem Klick sichtbar")
    await a.modell.speichere()
    #expect(await a.speicher.gespeichert.isEmpty)
    guard case .fehler(let text) = a.modell.zustand else { Issue.record("kein Fehler"); return }
    #expect(text.contains("„Privat“") && text.contains("Studio") && text.contains("Einstellungen"))
    #expect(a.modell.text == "Steuer machen", "der Text bleibt stehen")
    #expect(a.geschlossen == 0)
}

@MainActor @Test func ohneVaultGibtEsEineKlareMeldung() async {
    let a = Aufbau()
    a.vaults = []
    a.modell.ladeVaults()
    a.modell.text = "Etwas"
    #expect(a.modell.ziel == nil && a.modell.zielHinweis?.contains("Kein Vault") == true)
    await a.modell.speichere()
    guard case .fehler(let text) = a.modell.zustand else { Issue.record("kein Fehler"); return }
    #expect(text.contains("Kein Vault"))
    #expect(await a.speicher.gespeichert.isEmpty)
}

@MainActor @Test func leereEingabeWirdNichtGespeichert() async {
    let a = Aufbau()
    a.modell.text = "  \n \n"
    #expect(!a.modell.kannSpeichern)
    await a.modell.speichere()
    #expect(a.modell.zustand == .fehler("Schreib erst etwas auf."))
    #expect(await a.speicher.gespeichert.isEmpty)
}

@MainActor @Test func einFehlerDesSpeichersBleibtSichtbarUndNichtsGehtVerloren() async {
    let a = Aufbau()
    await a.speicher.setzeFehler(ErfassenFehler("Der Vault ist voll."))
    a.modell.text = "Wichtiger Gedanke"
    await a.modell.speichere()
    #expect(a.modell.zustand == .fehler("Der Vault ist voll."))
    #expect(a.modell.text == "Wichtiger Gedanke" && a.geschlossen == 0 && a.gemerkt.isEmpty)
    // Beim nächsten Versuch klappt es.
    await a.speicher.setzeFehler(nil)
    await a.modell.speichere()
    #expect(a.modell.text.isEmpty && a.geschlossen == 1)
}

@MainActor @Test func wirdWaehrendDerBestaetigungWeitergetipptBleibtDasFensterOffen() async {
    let a = Aufbau()
    a.waehrendWarten = { a.modell.eingabeGeaendert() } // der Nutzer tippt schon das Nächste
    a.modell.text = "Erstes"
    await a.modell.speichere()
    #expect(a.geschlossen == 0 && a.modell.zustand == .bereit)
    #expect(await a.speicher.gespeichert.count == 1)
}

@MainActor @Test func manuelleWahlHatVorrangVorDemText() async {
    let a = Aufbau()
    a.modell.text = "Steuer machen morgen !hoch"
    #expect(a.modell.wirksamePrioritaet == .hoch && a.modell.wirksameFaelligkeit == "2026-10-31")
    a.modell.prioritaetWahl = .niedrig
    a.modell.faelligWahl = .keine
    #expect(a.modell.wirksamePrioritaet == .niedrig && a.modell.wirksameFaelligkeit == nil)
    a.modell.faelligWahl = .datum(a.modell.isoIn(tage: 3))
    #expect(a.modell.wirksameFaelligkeit == "2026-11-02")
    await a.modell.speichere()
    let e = await a.speicher.gespeichert[0]
    #expect(e.prioritaet == .niedrig && e.faellig == "2026-11-02" && e.titel == "Steuer machen")
    // nach dem Speichern ist alles wieder automatisch
    #expect(a.modell.prioritaetWahl == nil && a.modell.faelligWahl == .automatisch)
}

@MainActor @Test func eineErkannteKurzformKannAlsTextBleiben() async {
    let a = Aufbau()
    a.modell.text = "Film schauen morgen"
    a.modell.erkenneFaelligkeit = false
    await a.modell.speichere()
    let e = await a.speicher.gespeichert[0]
    #expect(e.titel == "Film schauen morgen" && e.faellig == nil)
}

@MainActor @Test func einLangerGedankeWirdNichtAbgeschnittenSondernInDenTextGelegt() async {
    let a = Aufbau()
    let lang = (1...40).map { "Wort\($0)" }.joined(separator: " ")
    a.modell.text = lang
    await a.modell.speichere()
    let e = await a.speicher.gespeichert[0]
    #expect(e.titel.count <= ErfassenModell.hoechstTitel && e.titel.hasSuffix("…"))
    #expect(e.text == lang, "die ganze Zeile steht im Text")
    #expect(!e.titel.dropLast().hasSuffix(" "))
}

@MainActor @Test func nurDiePrioritaetAlsTextBleibtAlsTitelErhalten() async {
    let a = Aufbau()
    a.modell.text = "!hoch"
    await a.modell.speichere()
    let e = await a.speicher.gespeichert[0]
    #expect(e.titel == "!hoch" && e.prioritaet == nil)
}

@MainActor @Test func vorbereitenBehaeltDenEntwurfUndLiestDieVaultsNeu() {
    let a = Aufbau()
    a.modell.text = "Halber Gedanke"
    let vorher = a.modell.fokusAnfrage
    a.vaults = [ErfassenVault(name: "Neu", url: URL(fileURLWithPath: "/tmp/erfassen-test/neu"))]
    a.vertraut.insert("/tmp/erfassen-test/neu")
    a.modell.vorbereiten()
    #expect(a.modell.text == "Halber Gedanke", "ein Esc kostet keinen Gedanken")
    #expect(a.modell.fokusAnfrage == vorher + 1)
    #expect(a.modell.vaults.map(\.name) == ["Neu"] && a.modell.ziel?.name == "Neu", "der gewählte Vault gibt es nicht mehr: der aktive")
}

@MainActor @Test func kuerzelAendernLaeuftUeberDieVerwaltung() {
    let a = Aufbau()
    var angefragt: [Tastenkuerzel] = []
    a.modell.aendereKuerzel = { angefragt.append($0); return $0.taste == 0 ? "belegt" : nil }
    a.modell.kuerzelAendern = true
    a.modell.waehleKuerzel(Tastenkuerzel(taste: 0, umschalter: [.control]))
    #expect(a.modell.kuerzelMeldung == "belegt" && a.modell.kuerzelAendern, "bei einem Fehler bleibt das Aufnahmefeld offen")
    let gut = Tastenkuerzel(taste: 14, umschalter: [.control, .command])
    a.modell.waehleKuerzel(gut)
    #expect(a.modell.kuerzel == gut && !a.modell.kuerzelAendern && a.modell.kuerzelMeldung == nil)
    #expect(angefragt.count == 2)
}

@MainActor @Test func vaultListeKommtAusDerListeDerWerkstatt() throws {
    let support = tempOrdner("support")
    let pfade = AppPfade(basis: support)
    let home = tempOrdner("home")
    let a = home.appendingPathComponent("Privat", isDirectory: true), b = home.appendingPathComponent("Firma", isDirectory: true)
    for d in [a, b] { try FileManager.default.createDirectory(at: d, withIntermediateDirectories: true) }
    let json = #"{"vaults":[{"name":"Mein Privat","pfad":"\#(a.path)"},{"pfad":"\#(b.path)"},{"name":"Weg","pfad":"\#(home.path)/gibtsnicht"}],"aktiv":"\#(b.path)"}"#
    try Data(json.utf8).write(to: pfade.vaultListe)
    let r = ErfassenVault.lade(pfade, home: home)
    #expect(r.liste.map(\.name) == ["Mein Privat", "Firma"], "den fehlenden Ordner gibt es nicht mehr")
    #expect(r.aktiv?.lastPathComponent == "Firma")
}

// MARK: Speicher: Anfrage an die Werkstatt

@Test func dieAnfrageFuerEineAufgabeGehtAnDieAufgabenRoute() throws {
    let v = URL(fileURLWithPath: "/tmp/x")
    let (pfad, k) = WerkstattErfassenSpeicher.anfrage(fuer: Erfassung(art: .aufgabe, titel: "--text", text: "Mehr", prioritaet: .hoch, faellig: "2026-11-03", vault: v))
    #expect(pfad == "/api/aufgaben")
    #expect(k["titel"] as? String == "--text", "ein Titel mit Bindestrichen bleibt ein Titel (JSON statt Kommandozeile)")
    #expect(k["text"] as? String == "Mehr" && k["prioritaet"] as? String == "hoch" && k["faellig"] as? String == "2026-11-03")
    #expect(k["quelle"] == nil, "die Quelle setzt die Werkstatt selbst: mensch")
    let (_, schlicht) = WerkstattErfassenSpeicher.anfrage(fuer: Erfassung(art: .aufgabe, titel: "A", text: "", vault: v))
    #expect(Set(schlicht.keys) == ["titel"])
}

@Test func dieAnfrageFuerEineNotizGehtAnDenPosteingang() {
    let (pfad, k) = WerkstattErfassenSpeicher.anfrage(fuer: Erfassung(art: .notiz, text: "Idee", vault: URL(fileURLWithPath: "/tmp/x")))
    #expect(pfad == "/api/merken" && k["text"] as? String == "Idee" && k.count == 1)
}

// MARK: Echte Anmeldung beim System (Carbon)

/// Meldet ein selten benutztes Kürzel (⌃⌥⌘F19) wirklich beim System an und gleich wieder ab: Das Kürzel braucht kein Recht und kein
/// geöffnetes Fenster. Ein zweites Objekt mit demselben Kürzel muss „belegt“ melden, solange das erste es hält. Nur mit Bildschirm-Sitzung.
@MainActor @Test(.enabled(if: NSScreen.main != nil)) func carbonMeldetEinKuerzelAnUndHebtEsAuf() throws {
    let k = Tastenkuerzel(taste: 80, umschalter: [.control, .option, .command])
    let a = CarbonKuerzel(), b = CarbonKuerzel()
    try a.registriere(k, aktion: {})
    #expect(throws: KuerzelFehler.belegt) { try b.registriere(k, aktion: {}) }
    a.hebeAuf()
    try b.registriere(k, aktion: {})
    b.hebeAuf()
}
