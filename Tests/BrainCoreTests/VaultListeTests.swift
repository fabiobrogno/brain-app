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

/// Der Ordner, den eine config.json meint, so wie die App ihn zurückgibt: aufgelöst (wie `realpathSync.native` in der Werkstatt).
private func aufgeloest(_ u: URL) -> URL { AppAktion.aufgeloest(u) }

@Test func ohneVaultsJsonGiltConfigJson() throws {
    let p = AppPfade(basis: tempOrdner("Support"))
    #expect(VaultListe.lade(p) == nil)
    #expect(VaultListe.aktiverVault(p) == nil)
    // Der Rückfall verlangt einen vorhandenen Ordner (wie `altVault` in der Werkstatt) — also ein echter Ordner statt eines Wunschpfads.
    let alt = tempOrdner("Altes Brain")
    try AppEinstellungen(vault: alt.path).speichere(p)
    #expect(VaultListe.aktiverVault(p) == aufgeloest(alt))
    // kaputte vaults.json zählt wie fehlend → Rückfall config.json
    schreibe("{ kaputt", nach: p.vaultListe)
    #expect(VaultListe.lade(p) == nil)
    #expect(VaultListe.aktiverVault(p) == aufgeloest(alt))
    schreibe("[1,2]", nach: p.vaultListe)
    #expect(VaultListe.aktiverVault(p) == aufgeloest(alt))
}

@Test func vaultsJsonIstMassgeblichAuchOhneAktivenVault() throws {
    // Vault entfernt, nichts gewählt: ein alter config.json-Eintrag darf nicht wiederkehren — auch einer, der gültig wäre.
    let p = AppPfade(basis: tempOrdner("Support"))
    try AppEinstellungen(vault: tempOrdner("Altes Brain").path).speichere(p)
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
    #expect(StatusAnzeige.ohneKit.titel.contains("brain.config.json"))
}

// MARK: Lesen wie die Werkstatt (k5)

@Test func vaultsAlsKeinArrayErgibtLeereListeOhneAktiven() throws {
    let p = AppPfade(basis: tempOrdner("Support"))
    for vaults in [#""x""#, "5", "null", "{}", #"{"pfad":"/a"}"#, "true"] {
        schreibe(#"{"vaults":\#(vaults),"aktiv":"/p"}"#, nach: p.vaultListe)
        let liste = VaultListe.lade(p)
        #expect(liste?.vaults.isEmpty == true, "\(vaults)")
        #expect(liste?.aktiv == nil, "\(vaults)")
        #expect(liste?.defekt == true, "\(vaults): wie in der Werkstatt „defekt“")
        #expect(VaultListe.aktiverVault(p) == nil, "\(vaults)")
    }
    // „defekt“ wie „fehlt“: der Vault aus config.json gilt (die Werkstatt nimmt ihn ebenso), nie das `aktiv` der defekten Datei
    let alt = tempOrdner("Altes Brain")
    try AppEinstellungen(vault: alt.path).speichere(p)
    schreibe(#"{"vaults":"x","aktiv":"/p"}"#, nach: p.vaultListe)
    #expect(VaultListe.aktiverVault(p) == aufgeloest(alt))
    // eine leere, aber gültige Liste ist NICHT defekt: dort bleibt config.json außen vor
    for json in [#"{"vaults":[],"aktiv":null}"#, #"{"vaults":[]}"#, "{}"] {
        schreibe(json, nach: p.vaultListe)
        #expect(VaultListe.lade(p)?.defekt == false, "\(json)")
        #expect(VaultListe.aktiverVault(p) == nil, "\(json)")
    }
}

@Test func gleicherOrdnerUeberSymlinkOderSchreibweiseZaehltEinmal() throws {
    let p = AppPfade(basis: tempOrdner("Support"))
    let basis = tempOrdner("Orte")
    let echt = basis.appendingPathComponent("Echter Vault", isDirectory: true)
    try FileManager.default.createDirectory(at: echt, withIntermediateDirectories: true)
    let link = basis.appendingPathComponent("Verweis", isDirectory: false)
    try FileManager.default.createSymbolicLink(at: link, withDestinationURL: echt)
    // Verweis zuerst, dann der echte Ordner (auch in anderer Groß-/Kleinschreibung) und ein weiterer Ordner
    let json = #"{"vaults":[{"name":"Per Verweis","pfad":"\#(link.path)"},{"name":"Echt","pfad":"\#(echt.path)"},{"pfad":"\#(echt.path.uppercased())"},{"name":"Anderer","pfad":"\#(basis.path)/Anderer"}],"aktiv":"\#(echt.path)"}"#
    schreibe(json, nach: p.vaultListe)
    let liste = try #require(VaultListe.lade(p))
    // derselbe Ordner zählt einmal — der erste Eintrag bleibt
    #expect(liste.vaults.map(\.name) == ["Per Verweis", "Anderer"])
    #expect(liste.vaults.first?.pfad == link.path)
    // `aktiv` meint den Ordner über seinen echten Pfad → es wird zum `pfad` des Eintrags (hier: der Verweis)
    #expect(liste.aktiv == link.path)
    #expect(liste.anzeigename(fuer: echt) == "Per Verweis")
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

// MARK: Ortsregeln wie in der Werkstatt (pruefeRegeln)

@Test func eintraegeAnUnzulaessigenOrtenZaehlenNicht() {
    let p = AppPfade(basis: tempOrdner("Support"))
    let home = URL(fileURLWithPath: "/Users/test", isDirectory: true)
    let verboten = ["/", "/Users", "/Volumes", "/users", "/System/Library/x", "/usr", "/usr/local/Brain", "/private", "/private/var",
                    "/var", "/opt/brain", "/Applications/Brain", "/bin", "/etc/x", "/Library/Caches/x", "/cores",
                    "/Users/test", "/Users/test/Library/Foo", "/Users/test/Library", "/Users/test/Library/Application Support/Brain",
                    "/x/.git/y", "/x/node_modules", "/x/Foo.app/y", "/Users/test/.versteckt/Brain", "/Users/test/Dokumente/.stille/Brain",
                    p.basis.path, p.basis.path + "/unter"]
    for pfad in verboten {
        schreibe(#"{"vaults":[{"pfad":"\#(pfad)"}],"aktiv":"\#(pfad)"}"#, nach: p.vaultListe)
        let liste = VaultListe.lade(p, home: home)
        #expect(liste?.vaults.isEmpty == true, "\(pfad)")
        #expect(liste?.aktiv == nil, "\(pfad): aktiv muss ein gültiger Eintrag sein")
    }
    let erlaubt = ["/Users/test/Dokumente/Brain", "/Users/test/Brain", "/Users/test/Library/Mobile Documents/com~apple~CloudDocs/Brain",
                   "/Users/test/Library/CloudStorage/Dropbox/Brain", "/Volumes/Stick/Brain", "/Users/anderer/.config/Brain", "/a/Eins",
                   "/var/folders/xy/T/Brain", "/Users/test/Brain.git2", "/Users/test/Applications/Brain"]
    for pfad in erlaubt {
        schreibe(#"{"vaults":[{"pfad":"\#(pfad)"}],"aktiv":"\#(pfad)"}"#, nach: p.vaultListe)
        let liste = VaultListe.lade(p, home: home)
        #expect(liste?.vaults.map(\.pfad) == [pfad], "\(pfad)")
        #expect(liste?.aktiv == pfad, "\(pfad)")
    }
}

@Test func ortsregelnGeltenAuchFuerDenAufgeloestenPfad() throws {
    // Ein harmlos aussehender Verweis auf einen verbotenen Ort zählt nicht (Werkstatt: geschriebene UND aufgelöste Form)
    let p = AppPfade(basis: tempOrdner("Support"))
    let basis = tempOrdner("Orte")
    let verweis = basis.appendingPathComponent("Mein Brain", isDirectory: false)
    try FileManager.default.createSymbolicLink(at: verweis, withDestinationURL: URL(fileURLWithPath: "/usr/local", isDirectory: true))
    let home = URL(fileURLWithPath: "/Users/test", isDirectory: true)
    schreibe(#"{"vaults":[{"pfad":"\#(verweis.path)"}],"aktiv":"\#(verweis.path)"}"#, nach: p.vaultListe)
    #expect(VaultListe.lade(p, home: home)?.vaults.isEmpty == true)
    #expect(VaultListe.lade(p, home: home)?.aktiv == nil)
}

@Test func unzulaessigerEintragLaesstDieUebrigenUndDasAktiveUnberuehrt() {
    let p = AppPfade(basis: tempOrdner("Support"))
    let home = URL(fileURLWithPath: "/Users/test", isDirectory: true)
    schreibe(#"{"vaults":[{"pfad":"/usr/local"},{"name":"Gut","pfad":"/Users/test/Brain"},{"pfad":"/Users/test"}],"aktiv":"/Users/test/Brain"}"#, nach: p.vaultListe)
    let liste = try! #require(VaultListe.lade(p, home: home))
    #expect(liste.vaults.map(\.pfad) == ["/Users/test/Brain"])
    #expect(liste.aktiv == "/Users/test/Brain")
}

// MARK: Rückfall config.json mit denselben Regeln wie in der Werkstatt (Review V5, Leseregel 1)

/// config.json mit `{"vault": <wert>}` (auch Nicht-Texte) in einem frischen Support-Ordner.
private func supportMitConfig(_ wert: String) -> AppPfade {
    let p = AppPfade(basis: tempOrdner("Support"))
    schreibe(#"{"vault":\#(wert)}"#, nach: p.konfiguration)
    return p
}

/// Ein Text als JSON-Wert (mit Anführungszeichen und Escapes), für `supportMitConfig`.
private func jsonText(_ s: String) -> String {
    String(decoding: try! JSONSerialization.data(withJSONObject: s, options: [.fragmentsAllowed]), as: UTF8.self)
}

@Test func configJsonRueckfallNimmtKeinenVerbotenenOrt() throws {
    // Ein Home, in dem es die Ordner wirklich gibt — sonst bewiese „nil“ nur „fehlt“, nicht „verboten“.
    let home = tempOrdner("Home")
    for sub in ["Brain", ".ssh", "Library/Foo", "Dokumente/.stille/Brain"] {
        try FileManager.default.createDirectory(at: home.appendingPathComponent(sub), withIntermediateDirectories: true)
    }
    let verboten = [home.path, "/", "/usr", "/Users", "/Volumes", "/private/etc", "/Applications", home.path + "/.ssh",
                    home.path + "/Library/Foo", home.path + "/Library", home.path + "/Dokumente/.stille/Brain"]
    for pfad in verboten {
        let p = supportMitConfig(jsonText(pfad))
        #expect(VaultListe.aktiverVault(p, home: home) == nil, "\(pfad)")
        // Gegenprobe: derselbe Eintrag wäre als Eintrag von vaults.json ebenso verboten — beide Wege sagen dasselbe
        schreibe(#"{"vaults":[{"pfad":"\#(pfad)"}],"aktiv":"\#(pfad)"}"#, nach: p.vaultListe)
        #expect(VaultListe.lade(p, home: home)?.aktiv == nil, "\(pfad)")
    }
    // ein Ordner im Support-Ordner der App selbst
    let p = supportMitConfig("null")
    let intern = p.basis.appendingPathComponent("intern", isDirectory: true)
    try FileManager.default.createDirectory(at: intern, withIntermediateDirectories: true)
    schreibe(#"{"vault":\#(jsonText(intern.path))}"#, nach: p.konfiguration)
    #expect(VaultListe.aktiverVault(p, home: home) == nil)
    // Gegenprobe: der erlaubte Ordner aus demselben Home gilt
    let gut = home.appendingPathComponent("Brain", isDirectory: true)
    #expect(VaultListe.aktiverVault(supportMitConfig(jsonText(gut.path)), home: home) == aufgeloest(gut))
}

@Test func configJsonRueckfallBrauchtEinenVorhandenenAbsolutenOrdner() throws {
    let home = tempOrdner("Home")
    let datei = home.appendingPathComponent("datei.txt")
    try "x".write(to: datei, atomically: true, encoding: .utf8)
    let gut = home.appendingPathComponent("Mein Brän", isDirectory: true)
    try FileManager.default.createDirectory(at: gut, withIntermediateDirectories: true)
    // fehlender Ordner, relativer Pfad, eine Datei, leerer Text, NUL, kein Text
    for wert in [jsonText(home.path + "/Gibt es nicht"), jsonText("relativ/Brain"), jsonText("Brain"), jsonText(datei.path), jsonText(""),
                 jsonText("   "), jsonText("/ok\u{0}x"), "5", "true", "null", "[]", #"{"a":1}"#] {
        #expect(VaultListe.aktiverVault(supportMitConfig(wert), home: home) == nil, "\(wert)")
    }
    // Ränder weg (wie `.trim()` in der Werkstatt): ein Zeilenumbruch oder Leerzeichen am Ende sind kein Teil des Pfads
    for wert in [" \(gut.path)", "\(gut.path)\n", "  \(gut.path)\t "] {
        #expect(VaultListe.aktiverVault(supportMitConfig(jsonText(wert)), home: home) == aufgeloest(gut), "\(wert)")
    }
    // fehlt config.json oder ist sie kaputt: kein Vault
    let leer = AppPfade(basis: tempOrdner("Support"))
    #expect(VaultListe.aktiverVault(leer, home: home) == nil)
    schreibe("{ kaputt", nach: leer.konfiguration)
    #expect(VaultListe.aktiverVault(leer, home: home) == nil)
}

@Test func configJsonRueckfallLoestVerweiseAufUndPruftDasZiel() throws {
    let home = tempOrdner("Home")
    let echt = home.appendingPathComponent("Echt", isDirectory: true)
    try FileManager.default.createDirectory(at: echt, withIntermediateDirectories: true)
    let verweis = home.appendingPathComponent("Verweis", isDirectory: false)
    try FileManager.default.createSymbolicLink(at: verweis, withDestinationURL: echt)
    // harmloser Verweis: der Vault ist der aufgelöste Ordner (wie `realpathSync.native` in der Werkstatt)
    #expect(VaultListe.aktiverVault(supportMitConfig(jsonText(verweis.path)), home: home) == aufgeloest(echt))
    // ein Verweis auf einen verbotenen Ort zählt nicht: die Ortsregeln gelten für die aufgelöste Form
    let boese = home.appendingPathComponent("Mein Brain", isDirectory: false)
    try FileManager.default.createSymbolicLink(at: boese, withDestinationURL: URL(fileURLWithPath: "/usr", isDirectory: true))
    #expect(VaultListe.aktiverVault(supportMitConfig(jsonText(boese.path)), home: home) == nil)
    // ... auch einer auf das Home selbst
    let aufHome = home.appendingPathComponent("Zuhause", isDirectory: false)
    try FileManager.default.createSymbolicLink(at: aufHome, withDestinationURL: home)
    #expect(VaultListe.aktiverVault(supportMitConfig(jsonText(aufHome.path)), home: home) == nil)
}

@Test func configJsonRueckfallGiltAuchBeiDefekterVaultsJsonNurMitDenselbenRegeln() throws {
    let home = tempOrdner("Home")
    let gut = home.appendingPathComponent("Brain", isDirectory: true)
    try FileManager.default.createDirectory(at: gut, withIntermediateDirectories: true)
    let p = supportMitConfig(jsonText(home.path)) // das Home selbst
    // fehlende, defekte und „vaults ist kein Array“-Datei: der Rückfall greift, lehnt das Home aber ab
    for datei in [nil, "{ kaputt", "[1,2]", #"{"vaults":"x","aktiv":"/p"}"#] as [String?] {
        if let datei { schreibe(datei, nach: p.vaultListe) } else { try? FileManager.default.removeItem(at: p.vaultListe) }
        #expect(VaultListe.aktiverVault(p, home: home) == nil, "\(String(describing: datei))")
    }
    // mit gültigem Ordner in config.json greift derselbe Rückfall
    schreibe(#"{"vault":\#(jsonText(gut.path))}"#, nach: p.konfiguration)
    schreibe(#"{"vaults":"x"}"#, nach: p.vaultListe)
    #expect(VaultListe.aktiverVault(p, home: home) == aufgeloest(gut))
    // eine gültige (auch leere) vaults.json bleibt maßgeblich: config.json spielt dann keine Rolle
    schreibe(#"{"vaults":[],"aktiv":null}"#, nach: p.vaultListe)
    #expect(VaultListe.aktiverVault(p, home: home) == nil)
}
