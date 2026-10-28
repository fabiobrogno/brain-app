import Testing
import Foundation
import CoreGraphics
@testable import BrainCore

private let testmodus = ["BRAIN_TESTMODUS": "1"]

private func lies(_ argumente: [String], umgebung: [String: String] = [:]) -> StartArgumente {
    StartArgumente.lies(["BrainApp"] + argumente, umgebung: umgebung)
}

// MARK: Bisherige Schalter

@Test func startOhneArgumenteIstLeer() {
    let a = lies([])
    #expect(a == StartArgumente())
    #expect(a.testBildWarten == .seconds(2))
    #expect(!a.studioTestlauf)
    #expect(a.hinweise.isEmpty)
}

// MARK: Assistent „Kortex einrichten“ im Testlauf

@Test func assistentErscheintOhneSchalterNurWennNichtGetestetWird() {
    #expect(lies([]).assistentDarfErscheinen)
    #expect(!lies(["--vault", "/tmp/x"]).assistentDarfErscheinen)
    #expect(!lies(["--test-beenden-nach", "30"]).assistentDarfErscheinen, "Rauchtest B etc.: Studio statt Assistent")
    #expect(!lies(["--test-fenster", "800x600"]).assistentDarfErscheinen)
}

@Test func frischerStartLaesstDenAssistentenImTestlaufErscheinen() {
    let a = lies(["--test-frischer-start", "--test-beenden-nach", "30"], umgebung: ["BRAIN_APP_SUPPORT": "/tmp/support-test"])
    #expect(a.frischerStart && a.fluechtig && a.assistentDarfErscheinen)
    #expect(a.hinweise.isEmpty)
    // auch allein: flüchtiger Web-Speicher, nichts in der echten App
    #expect(lies(["--test-frischer-start"], umgebung: ["BRAIN_APP_SUPPORT": "/tmp/support-test"]).fluechtig)
}

@Test func frischerStartBrauchtEinenEigenenSupportOrdner() {
    // ohne BRAIN_APP_SUPPORT würde der Test den echten Support-Ordner der App anfassen: abgelehnt
    for umgebung in [[:], ["BRAIN_APP_SUPPORT": "relativ/pfad"]] as [[String: String]] {
        let a = lies(["--test-frischer-start", "--test-beenden-nach", "30"], umgebung: umgebung)
        #expect(!a.frischerStart && !a.assistentDarfErscheinen)
        #expect(a.hinweise == ["test-schalter-ignoriert --test-frischer-start nur-mit-BRAIN_APP_SUPPORT-auf-eigenen-Ordner"])
    }
}

@Test func frischerStartMitVaultZeigtKeinenAssistenten() {
    let a = lies(["--test-frischer-start", "--vault", "/tmp/x"], umgebung: ["BRAIN_APP_SUPPORT": "/tmp/support-test"])
    #expect(!a.assistentDarfErscheinen)
}

@Test func bisherigeSchalterBleibenUnveraendert() {
    let a = lies(["--vault", "/tmp/Mein Brain", "--test-fenster", "--test-fenster-schliessen-nach", "40", "--test-beenden-nach", "60"])
    #expect(a.vault == URL(fileURLWithPath: "/tmp/Mein Brain"))
    #expect(a.fensterOeffnen)
    #expect(a.testFenster == nil)
    #expect(a.schliessenNach == .seconds(40))
    #expect(a.beendenNach == .seconds(60))
    #expect(!a.studioTestlauf)
    #expect(a.fluechtig, "Rauchtest-Aufruf: keine Spuren in der echten App")
    #expect(a.hinweise.isEmpty)
    // relativer Vault und Unbekanntes werden ignoriert
    #expect(lies(["--vault", "relativ", "--gibt-es-nicht"]).vault == nil)
}

// MARK: --test-fenster (zwei Bedeutungen)

@Test func testFensterMitGroesseSetztNurDieGroesse() {
    let a = lies(["--test-fenster", "1440x900"])
    #expect(a.testFenster == CGSize(width: 1440, height: 900))
    #expect(!a.fensterOeffnen, "mit Wert wird die Übersicht nicht zusätzlich geöffnet")
    #expect(a.studioTestlauf)
    #expect(a.hinweise.isEmpty)
}

@Test func testFensterOhneWertOeffnetDieUebersichtWieBisher() {
    // am Ende, vor einem anderen Schalter, vor einem anderen Schalter mit Wert
    for argumente in [["--test-fenster"], ["--test-fenster", "--test-beenden-nach", "5"], ["--test-beenden-nach", "5", "--test-fenster"]] {
        let a = lies(argumente)
        #expect(a.fensterOeffnen, "\(argumente)")
        #expect(a.testFenster == nil, "\(argumente)")
        #expect(a.hinweise.isEmpty, "\(argumente)")
    }
}

@Test func testFensterMitUngueltigerGroesseWirdIgnoriert() {
    for wert in ["1440", "1440x", "x900", "1440x900x3", "abc", "0x900", "1440x0", "-1x5", "1440X900", "4001x900", "1440x99999", "14.5x900", "１４４０x900"] {
        let a = lies(["--test-fenster", wert])
        #expect(a.testFenster == nil, "\(wert)")
        #expect(!a.fensterOeffnen, "\(wert): der Wert gehört zum Schalter, die Übersicht öffnet nicht")
        #expect(a.hinweise.count == 1 && a.hinweise[0].hasPrefix("test-schalter-ignoriert --test-fenster "), "\(wert): \(a.hinweise)")
    }
    // Grenzen sind gültig
    #expect(lies(["--test-fenster", "1x1"]).testFenster == CGSize(width: 1, height: 1))
    #expect(lies(["--test-fenster", "4000x4000"]).testFenster == CGSize(width: 4000, height: 4000))
}

// MARK: --test-bild und --test-bild-warten

@Test func testBildBrauchtAbsolutenPngPfad() {
    let a = lies(["--test-bild", "/tmp/Ordner mit Leerzeichen/bild.png"])
    #expect(a.testBild == URL(fileURLWithPath: "/tmp/Ordner mit Leerzeichen/bild.png"))
    #expect(a.studioTestlauf)
    #expect(a.hinweise.isEmpty)
    #expect(lies(["--test-bild", "/tmp/BILD.PNG"]).testBild != nil, "Endung unabhängig von Groß-/Kleinschreibung")
    for wert in ["bild.png", "./bild.png", "/tmp/bild.jpg", "/tmp/bild", "/tmp/ordner/", "/tmp/bild.png/", ""] {
        let b = lies(["--test-bild", wert])
        #expect(b.testBild == nil, "\(wert)")
        #expect(b.hinweise.count == 1 && b.hinweise[0].hasPrefix("test-schalter-ignoriert --test-bild "), "\(wert): \(b.hinweise)")
        #expect(!b.studioTestlauf, "\(wert)")
    }
}

@Test func fehlenderWertWirdGemeldetUndVerbrauchtKeinenNachbarschalter() {
    // Wert fehlt am Ende oder vor einem anderen Schalter: Hinweis, der Nachbar gilt trotzdem
    let a = lies(["--test-bild"])
    #expect(a.testBild == nil)
    #expect(a.hinweise == ["test-schalter-ignoriert --test-bild Wert-fehlt"])
    let b = lies(["--test-bild", "--test-dunkel", "--test-bild-warten", "--test-hell"])
    #expect(b.testBild == nil)
    #expect(b.testErscheinungsbild == .hell, "--test-dunkel und --test-hell gelten: der letzte gewinnt")
    #expect(b.hinweise.contains("test-schalter-ignoriert --test-bild Wert-fehlt"))
    #expect(b.hinweise.contains("test-schalter-ignoriert --test-bild-warten Wert-fehlt"))
}

@Test func testBildWartenStandardZweiSekunden() {
    #expect(lies(["--test-bild", "/tmp/a.png"]).testBildWarten == .seconds(2))
    #expect(lies(["--test-bild-warten", "5"]).testBildWarten == .seconds(5))
    #expect(lies(["--test-bild-warten", "0"]).testBildWarten == .seconds(0))
    #expect(lies(["--test-bild-warten", "0.5"]).testBildWarten == .seconds(0.5))
    #expect(lies(["--test-bild-warten", "120"]).testBildWarten == .seconds(120))
    // ungültig → Standard bleibt, eine Hinweiszeile
    for wert in ["-1", "abc", "", "121", "nan", "inf", "1,5"] {
        let a = lies(["--test-bild-warten", wert])
        #expect(a.testBildWarten == .seconds(2), "\(wert)")
        #expect(a.hinweise.count == 1 && a.hinweise[0].hasPrefix("test-schalter-ignoriert --test-bild-warten "), "\(wert): \(a.hinweise)")
    }
    // allein gestellt ist es noch kein Testlauf
    #expect(!lies(["--test-bild-warten", "5"]).studioTestlauf)
}

// MARK: --test-dunkel / --test-hell

@Test func erscheinungsbildDunkelHellUndWiderspruch() {
    #expect(lies(["--test-dunkel"]).testErscheinungsbild == .dunkel)
    #expect(lies(["--test-hell"]).testErscheinungsbild == .hell)
    #expect(lies(["--test-dunkel"]).studioTestlauf)
    #expect(lies([]).testErscheinungsbild == nil)
    let a = lies(["--test-dunkel", "--test-hell"])
    #expect(a.testErscheinungsbild == .hell)
    #expect(a.hinweise == ["test-schalter-ignoriert --test-hell widerspricht-dunkel-letzter-gilt"])
    // doppelt gleich ist kein Widerspruch
    #expect(lies(["--test-dunkel", "--test-dunkel"]).hinweise.isEmpty)
}

// MARK: --test-skript (nur mit BRAIN_TESTMODUS=1)

@Test func testSkriptNurMitTestmodus() {
    let ohne = lies(["--test-skript", "/tmp/s.js"])
    #expect(ohne.testSkript == nil)
    #expect(ohne.hinweise == ["test-schalter-ignoriert --test-skript nur-mit-BRAIN_TESTMODUS=1"])
    #expect(!ohne.studioTestlauf)
    for umgebung in [["BRAIN_TESTMODUS": "0"], ["BRAIN_TESTMODUS": ""], ["BRAIN_TESTMODUS": "true"], ["ANDERES": "1"]] {
        #expect(lies(["--test-skript", "/tmp/s.js"], umgebung: umgebung).testSkript == nil, "\(umgebung)")
    }
    let mit = lies(["--test-skript", "/tmp/Mein Skript.js"], umgebung: testmodus)
    #expect(mit.testSkript == URL(fileURLWithPath: "/tmp/Mein Skript.js"))
    #expect(mit.hinweise.isEmpty)
    #expect(mit.studioTestlauf)
}

@Test func testSkriptBrauchtAbsolutenJsPfad() {
    for wert in ["s.js", "/tmp/s.mjs", "/tmp/s", "/tmp/ordner/", ""] {
        let a = lies(["--test-skript", wert], umgebung: testmodus)
        #expect(a.testSkript == nil, "\(wert)")
        #expect(a.hinweise.count == 1 && a.hinweise[0].hasPrefix("test-schalter-ignoriert --test-skript "), "\(wert): \(a.hinweise)")
    }
    #expect(lies(["--test-skript"], umgebung: testmodus).hinweise == ["test-schalter-ignoriert --test-skript Wert-fehlt"])
}

// MARK: Zusammenspiel wie in scripts/selbstfoto.sh

@Test func selbstfotoAufrufWieImSkript() {
    let a = lies(["--vault", "/tmp/Brain Kopie", "--test-fenster", "1440x900", "--test-dunkel", "--test-bild", "/tmp/aus/dunkel.png",
                  "--test-bild-warten", "3", "--test-skript", "/tmp/s.js", "--test-beenden-nach", "60"], umgebung: testmodus)
    #expect(a.vault == URL(fileURLWithPath: "/tmp/Brain Kopie"))
    #expect(a.testFenster == CGSize(width: 1440, height: 900))
    #expect(a.testErscheinungsbild == .dunkel)
    #expect(a.testBild == URL(fileURLWithPath: "/tmp/aus/dunkel.png"))
    #expect(a.testBildWarten == .seconds(3))
    #expect(a.testSkript == URL(fileURLWithPath: "/tmp/s.js"))
    #expect(a.beendenNach == .seconds(60))
    #expect(!a.fensterOeffnen)
    #expect(a.studioTestlauf)
    #expect(a.hinweise.isEmpty)
}

// MARK: Flüchtig: Testschalter hinterlassen nichts in der echten App (k11)

@Test func fluechtigBeiJedemGueltigenTestschalter() {
    #expect(!lies([]).fluechtig)
    #expect(!lies(["--vault", "/tmp/Mein Brain"]).fluechtig, "--vault allein ist Entwicklung, kein Testlauf")
    #expect(!lies(["--test-bild-warten", "5"]).fluechtig)
    // Jeder gültige Schalter genügt — auch die, die nur die App beenden oder die Übersicht öffnen (Rauchtest, Aktionskanal-Test)
    let faelle: [[String]] = [["--test-beenden-nach", "60"], ["--test-fenster-schliessen-nach", "14"], ["--test-fenster"],
                              ["--test-fenster", "1440x900"], ["--test-bild", "/tmp/a.png"], ["--test-dunkel"], ["--test-hell"]]
    for f in faelle { #expect(lies(f).fluechtig, "\(f)") }
    #expect(lies(["--test-skript", "/tmp/s.js"], umgebung: testmodus).fluechtig)
    // Die Schalter von rauchtest.sh, teste-aktionskanal.sh und selbstfoto.sh
    #expect(lies(["--vault", "/tmp/Test Brain", "--test-fenster", "--test-fenster-schliessen-nach", "40", "--test-beenden-nach", "60"]).fluechtig)
    #expect(lies(["--test-fenster-schliessen-nach", "25", "--test-beenden-nach", "45"]).fluechtig)
    #expect(lies(["--test-beenden-nach", "22"]).fluechtig)
    // Ungültige Werte zählen nicht (der Schalter wird ignoriert)
    for f in [["--test-beenden-nach", "abc"], ["--test-fenster-schliessen-nach", "x"], ["--test-bild", "bild.png"],
              ["--test-fenster", "0x0"], ["--test-skript", "/tmp/s.js"], ["--gibt-es-nicht"]] {
        #expect(!lies(f).fluechtig, "\(f)")
    }
}

@Test func fluechtigIstImmerWahrWennDasStudioAlsTestlaufGilt() {
    // `studioTestlauf` (Größe, Bild, Skript, Erscheinungsbild) ist eine Teilmenge von `fluechtig`
    for f in [["--test-fenster", "800x600"], ["--test-bild", "/tmp/a.png"], ["--test-dunkel"], ["--test-hell"]] {
        let a = lies(f)
        #expect(a.studioTestlauf && a.fluechtig, "\(f)")
    }
    // und `fluechtig` allein (nur beenden/schließen/Übersicht) macht aus dem Studio noch keinen Foto-Testlauf
    let a = lies(["--test-beenden-nach", "5"])
    #expect(a.fluechtig && !a.studioTestlauf)
}
