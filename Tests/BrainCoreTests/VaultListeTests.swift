import Testing
import Foundation
@testable import BrainCore

private func schreibe(_ json: String, nach datei: URL) {
    try! FileManager.default.createDirectory(at: datei.deletingLastPathComponent(), withIntermediateDirectories: true)
    try! json.write(to: datei, atomically: true, encoding: .utf8)
}

@Test func vaultListeLiestAktivenVaultAusVaultsJson() {
    let p = AppPfade(basis: tempOrdner("Support"))
    schreibe("""
    {"vaults":[{"name":"Privat","pfad":"/Users/x/Mein Brain","farbe":"#3b82f6"},{"pfad":"/Users/x/Arbeit"}],"aktiv":"/Users/x/Mein Brain"}
    """, nach: p.vaultListe)
    let liste = VaultListe.lade(p)
    #expect(liste?.vaults.count == 2)
    #expect(liste?.vaults.first == VaultListe.Eintrag(name: "Privat", pfad: "/Users/x/Mein Brain", farbe: "#3b82f6"))
    #expect(liste?.aktiv == "/Users/x/Mein Brain")
    #expect(VaultListe.aktiverVault(p) == URL(fileURLWithPath: "/Users/x/Mein Brain", isDirectory: true))
    #expect(p.vaultListe.lastPathComponent == "vaults.json")
}

@Test func vaultListeAnzeigenameKommtAusDerListeSonstVomOrdner() {
    let p = AppPfade(basis: tempOrdner("Support"))
    schreibe("""
    {"vaults":[{"name":"Privat","pfad":"/Users/x/Mein Brain"},{"name":"  ","pfad":"/Users/x/Arbeit"}],"aktiv":null}
    """, nach: p.vaultListe)
    let liste = try! #require(VaultListe.lade(p))
    #expect(liste.anzeigename(fuer: URL(fileURLWithPath: "/Users/x/Mein Brain")) == "Privat")
    #expect(liste.anzeigename(fuer: URL(fileURLWithPath: "/Users/x/Mein Brain/")) == "Privat")
    #expect(liste.anzeigename(fuer: URL(fileURLWithPath: "/Users/x/Arbeit")) == "Arbeit")
    #expect(liste.anzeigename(fuer: URL(fileURLWithPath: "/irgendwo/Unbekannt")) == "Unbekannt")
}

@Test func ohneVaultsJsonGiltConfigJson() throws {
    let p = AppPfade(basis: tempOrdner("Support"))
    #expect(VaultListe.lade(p) == nil)
    #expect(VaultListe.aktiverVault(p) == nil)
    try AppEinstellungen(vault: "/Users/x/Altes Brain").speichere(p)
    #expect(VaultListe.aktiverVault(p) == URL(fileURLWithPath: "/Users/x/Altes Brain", isDirectory: true))
    // kaputte vaults.json zählt wie fehlend → Rückfall config.json
    schreibe("{ kaputt", nach: p.vaultListe)
    #expect(VaultListe.lade(p) == nil)
    #expect(VaultListe.aktiverVault(p) == URL(fileURLWithPath: "/Users/x/Altes Brain", isDirectory: true))
    schreibe("[1,2]", nach: p.vaultListe)
    #expect(VaultListe.aktiverVault(p) == URL(fileURLWithPath: "/Users/x/Altes Brain", isDirectory: true))
}

@Test func vaultsJsonIstMassgeblichAuchOhneAktivenVault() throws {
    // Vault entfernt, nichts gewählt: ein alter config.json-Eintrag darf nicht wiederkehren.
    let p = AppPfade(basis: tempOrdner("Support"))
    try AppEinstellungen(vault: "/Users/x/Altes Brain").speichere(p)
    for json in [#"{"vaults":[],"aktiv":null}"#, #"{"vaults":[]}"#, #"{}"#] {
        schreibe(json, nach: p.vaultListe)
        #expect(VaultListe.lade(p) != nil, "\(json)")
        #expect(VaultListe.aktiverVault(p) == nil, "\(json)")
    }
}

@Test func vaultListeVerwirftRelativeUndKaputteEintraege() {
    let p = AppPfade(basis: tempOrdner("Support"))
    schreibe("""
    {"vaults":[{"pfad":"relativ/brain"},{"name":"ohne Pfad"},5,{"pfad":"/ok/Brain"},{"pfad":"/x\\u0000y"}],"aktiv":"relativ/brain"}
    """, nach: p.vaultListe)
    let liste = try! #require(VaultListe.lade(p))
    #expect(liste.vaults.map(\.pfad) == ["/ok/Brain"])
    #expect(liste.aktiv == nil)
    #expect(VaultListe.aktiverVault(p) == nil)
}

// MARK: Umgebung und Anzeige ohne Vault

@Test func kindUmgebungOhneVaultEntferntAuchGeerbtesBrainVault() {
    let env = NodeUmgebung.fuerKind(basis: ["BRAIN_VAULT": "/geerbt", "NODE_OPTIONS": "--inspect", "PATH": "/usr/bin"],
                                    vault: nil, vorgaben: ["BRAIN_APP_SUPPORT": "/support", "BRAIN_NODE": "/n"])
    #expect(env["BRAIN_VAULT"] == nil)
    #expect(env["NODE_OPTIONS"] == nil)
    #expect(env["BRAIN_APP_SUPPORT"] == "/support")
    #expect(env["BRAIN_NODE"] == "/n")
}

@Test func statusAnzeigeOhneVaultUndOhneKit() {
    #expect(StatusAnzeige.keinVault == StatusAnzeige(symbol: "questionmark.circle", zeichen: "?", titel: "Kein Vault gewählt"))
    #expect(StatusAnzeige.ohneKit.zeichen == "✓")
    #expect(StatusAnzeige.ohneKit.titel.contains("ohne Kit"))
}

// MARK: Lesen wie die Werkstatt (k5)

@Test func vaultsAlsKeinArrayErgibtLeereListeOhneAktiven() {
    let p = AppPfade(basis: tempOrdner("Support"))
    for vaults in [#""x""#, "5", "null", "{}", #"{"pfad":"/a"}"#, "true"] {
        schreibe(#"{"vaults":\#(vaults),"aktiv":"/p"}"#, nach: p.vaultListe)
        let liste = VaultListe.lade(p)
        #expect(liste?.vaults.isEmpty == true, "\(vaults)")
        #expect(liste?.aktiv == nil, "\(vaults)")
        #expect(VaultListe.aktiverVault(p) == nil, "\(vaults)")
    }
}

@Test func aktivGiltNurWennEsEinemEintragEntspricht() {
    let p = AppPfade(basis: tempOrdner("Support"))
    // steht nicht in der Liste → kein aktiver Vault (auch nicht über config.json: vaults.json ist maßgeblich)
    schreibe(#"{"vaults":[{"pfad":"/a/Eins"}],"aktiv":"/b/Zwei"}"#, nach: p.vaultListe)
    #expect(VaultListe.lade(p)?.vaults.map(\.pfad) == ["/a/Eins"])
    #expect(VaultListe.lade(p)?.aktiv == nil)
    #expect(VaultListe.aktiverVault(p) == nil)
    // Liste leer, aktiv gesetzt
    schreibe(#"{"vaults":[],"aktiv":"/a/Eins"}"#, nach: p.vaultListe)
    #expect(VaultListe.lade(p)?.aktiv == nil)
    // dieselbe Stelle, anders geschrieben (Schrägstrich am Ende, ./.., doppelte Schrägstriche, Groß/klein): gilt — und zwar
    // als der Eintrag der Liste
    for aktiv in ["/a/Eins/", "/a/./Eins", "/a/x/../Eins", "//a//Eins", "/A/EINS", "/a/eins"] {
        schreibe(#"{"vaults":[{"pfad":"/a/Eins"}],"aktiv":"\#(aktiv)"}"#, nach: p.vaultListe)
        #expect(VaultListe.lade(p)?.aktiv == "/a/Eins", "\(aktiv)")
        #expect(VaultListe.aktiverVault(p) == URL(fileURLWithPath: "/a/Eins", isDirectory: true), "\(aktiv)")
    }
    // ein Ordner darüber oder darunter ist ein anderer Vault
    for aktiv in ["/a", "/a/Eins/unter", "/a/Eins2"] {
        schreibe(#"{"vaults":[{"pfad":"/a/Eins"}],"aktiv":"\#(aktiv)"}"#, nach: p.vaultListe)
        #expect(VaultListe.lade(p)?.aktiv == nil, "\(aktiv)")
    }
}

@Test func aktivMitFalschemTypOderRelativerPfadIstNil() {
    let p = AppPfade(basis: tempOrdner("Support"))
    for aktiv in ["5", "null", "true", "[]", #"["/a/Eins"]"#, "{}", #""relativ/Eins""#, #""""#, #""/a/E\u0000ins""#] {
        schreibe(#"{"vaults":[{"pfad":"/a/Eins"}],"aktiv":\#(aktiv)}"#, nach: p.vaultListe)
        #expect(VaultListe.lade(p)?.aktiv == nil, "\(aktiv)")
    }
    // fehlt ganz
    schreibe(#"{"vaults":[{"pfad":"/a/Eins"}]}"#, nach: p.vaultListe)
    #expect(VaultListe.lade(p)?.aktiv == nil)
}

@Test func eintraegeNurMitAbsolutemTextPfadDoppelteNurEinmalPfadeBereinigt() {
    let p = AppPfade(basis: tempOrdner("Support"))
    schreibe("""
    {"vaults":[null,"x",5,[],{"pfad":5},{"pfad":null},{"pfad":["/a"]},{"pfad":"relativ"},{"pfad":""},{"pfad":"/x\\u0000y"},
               {"name":"Eins","pfad":"/ok/Eins"},{"name":"Doppelt","pfad":"/ok/eins/"},{"pfad":"/OK/EINS"},
               {"pfad":"/ok/Zwei/../Drei"},{"pfad":"/ok/./Vier//Fuenf/"}],"aktiv":"/ok/Drei"}
    """, nach: p.vaultListe)
    let liste = try! #require(VaultListe.lade(p))
    // Doppelte (ohne Groß/klein): der erste Eintrag gewinnt; Pfade sind lexikalisch bereinigt wie `path.resolve` in Node
    #expect(liste.vaults.map(\.pfad) == ["/ok/Eins", "/ok/Drei", "/ok/Vier/Fuenf"])
    #expect(liste.vaults.first?.name == "Eins")
    #expect(liste.aktiv == "/ok/Drei")
}

@Test func anzeigenameVergleichtWieDieListe() {
    let p = AppPfade(basis: tempOrdner("Support"))
    schreibe(#"{"vaults":[{"name":"Privat","pfad":"/Users/x/Mein Brain"}],"aktiv":null}"#, nach: p.vaultListe)
    let liste = try! #require(VaultListe.lade(p))
    #expect(liste.anzeigename(fuer: URL(fileURLWithPath: "/users/X/mein brain")) == "Privat")
    #expect(liste.anzeigename(fuer: URL(fileURLWithPath: "/Users/x/./Mein Brain/")) == "Privat")
    #expect(liste.anzeigename(fuer: URL(fileURLWithPath: "/Users/x/Mein Brain 2")) == "Mein Brain 2")
}
