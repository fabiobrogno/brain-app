import Foundation

/// `<support>/vaults.json` — die Liste der Vaults, geführt vom Backend (Werkstatt). Die App liest sie nur: für den Status
/// in der Menüleiste und die Übersicht. Format: `{ "vaults":[{"name","pfad","farbe"}], "aktiv":"<pfad>" }`. Gelesen wird wie in
/// der Werkstatt (LESEREGEL im Kopf von `gemeinsam/vaults.mjs`): `vaults` muss ein Array sein (sonst gilt die Datei als defekt),
/// nur Einträge mit absolutem Text-`pfad` zählen (Pfade lexikalisch bereinigt, wie `path.resolve`), Einträge für denselben Ordner —
/// geschrieben oder mit aufgelösten Symlinks, ohne Groß/klein und Unicode-Form — nur einmal (der erste bleibt), und `aktiv` gilt nur,
/// wenn es einen dieser Einträge meint. Dazu die Ortsregeln der Werkstatt (`ortErlaubt`: kein Systemordner, nicht das Home selbst …).
public struct VaultListe: Equatable, Sendable {
    public struct Eintrag: Equatable, Sendable {
        public let name: String?
        public let pfad: String
        public let farbe: String?
    }

    public let vaults: [Eintrag]
    /// Pfad des aktiven Vaults — der `pfad` des passenden Eintrags in `vaults` —, sonst nil.
    public let aktiv: String?
    /// `vaults` stand in der Datei, war aber kein Array (die Werkstatt nennt das „defekt“): die Liste ist leer, und
    /// `aktiverVault` greift wie bei einer fehlenden Datei auf `config.json` zurück.
    public internal(set) var defekt = false

    /// Fehlt die Datei oder ist sie kein JSON-Objekt → nil. Ist `vaults` da, aber kein Array, ist die Liste leer und `defekt` gesetzt;
    /// Einträge ohne absoluten Text-`pfad` werden übersprungen. `aktiv` zählt nur, wenn es einem Eintrag entspricht:
    /// `{"vaults":"x","aktiv":"/p"}` ergibt eine leere Liste ohne aktiven Vault.
    public static func lade(_ pfade: AppPfade, home: URL = FileManager.default.homeDirectoryForCurrentUser) -> VaultListe? {
        guard let daten = try? Data(contentsOf: pfade.vaultListe),
              let wurzel = try? JSONSerialization.jsonObject(with: daten) as? [String: Any] else { return nil }
        let roh = wurzel["vaults"]
        let defekt = roh != nil && !(roh is [Any])
        var formen: [[[String]]] = [] // je übernommenem Eintrag seine Vergleichsformen (für Doppelte und für aktiv)
        var eintraege: [Eintrag] = []
        for e in roh as? [Any] ?? [] {
            guard let d = e as? [String: Any], let p = d["pfad"] as? String, istAbsolut(p) else { continue }
            let pfad = bereinigt(p)
            guard ortErlaubt(pfad, home: home, support: pfade.basis) else { continue }
            let f = vergleichsformen(pfad)
            guard !formen.contains(where: { teilenForm($0, f) }) else { continue }
            formen.append(f)
            eintraege.append(Eintrag(name: d["name"] as? String, pfad: pfad, farbe: d["farbe"] as? String))
        }
        let aktiv = (wurzel["aktiv"] as? String).flatMap { a -> String? in
            guard istAbsolut(a) else { return nil }
            let f = vergleichsformen(bereinigt(a))
            return formen.firstIndex { teilenForm($0, f) }.map { eintraege[$0].pfad }
        }
        var liste = VaultListe(vaults: eintraege, aktiv: aktiv)
        liste.defekt = defekt
        return liste
    }

    /// Der aktive Vault der App: `aktiv` aus vaults.json. Nur wenn es vaults.json noch nicht gibt (oder sie unlesbar oder defekt
    /// ist), gilt der Vault aus `config.json` — danach ist vaults.json maßgeblich, auch mit `aktiv: null` (Vault entfernt,
    /// nichts gewählt; ein alter config.json-Eintrag darf nicht wiederkehren). Der Rückfall folgt den Regeln der Werkstatt
    /// (`altVault`), sonst nennten Werkstatt („Willkommen“) und Menüleiste verschiedene aktive Vaults (Review V5).
    public static func aktiverVault(_ pfade: AppPfade, home: URL = FileManager.default.homeDirectoryForCurrentUser) -> URL? {
        if let liste = lade(pfade, home: home), !liste.defekt { return liste.aktiv.map { URL(fileURLWithPath: $0, isDirectory: true) } }
        return altVault(pfade, home: home)
    }

    /// Der Vault aus der alten `config.json` (`{"vault":"<pfad>"}`), wie `altVault` in `gemeinsam/vaults.mjs` (Leseregel 1 im Kopf
    /// dieser Datei): ein Text, Ränder weg, absolut und ohne NUL, der Ordner existiert, und die Ortsregeln erlauben ihn — nicht das
    /// Home selbst, nicht `/`, kein Systemordner, kein versteckter Ordner unter dem Home … (`ortErlaubt` prüft die geschriebene UND
    /// die aufgelöste Form). Das Ergebnis ist der aufgelöste Pfad (dort `realpathSync.native`). Sonst nil: Die Werkstatt zeigt dann
    /// „Willkommen“, und die App darf nicht den Status eines anderen Ordners zeigen.
    static func altVault(_ pfade: AppPfade, home: URL) -> URL? {
        guard let roh = AppEinstellungen.lade(pfade).vault else { return nil }
        let v = roh.trimmingCharacters(in: .whitespacesAndNewlines)
        var istOrdner: ObjCBool = false
        guard !v.isEmpty, istAbsolut(v), FileManager.default.fileExists(atPath: v, isDirectory: &istOrdner), istOrdner.boolValue,
              ortErlaubt(bereinigt(v), home: home, support: pfade.basis) else { return nil }
        return AppAktion.aufgeloest(URL(fileURLWithPath: v, isDirectory: true))
    }

    /// Anzeigename: der Name aus der Liste, sonst der Ordnername.
    public func anzeigename(fuer vault: URL) -> String {
        let ziel = Self.vergleichsformen(Self.bereinigt(vault.path))
        let treffer = vaults.first { Self.teilenForm(Self.vergleichsformen($0.pfad), ziel) }
        if let n = treffer?.name?.trimmingCharacters(in: .whitespacesAndNewlines), !n.isEmpty { return n }
        return vault.lastPathComponent
    }

    private static func istAbsolut(_ p: String) -> Bool { p.hasPrefix("/") && !p.contains("\0") }

    /// Wie `path.resolve` in Node: rein lexikalisch — leere Teile und `.` entfallen, `..` geht eine Ebene hoch (nie über `/`).
    static func bereinigt(_ pfad: String) -> String {
        var teile: [Substring] = []
        for t in pfad.split(separator: "/", omittingEmptySubsequences: true) {
            if t == "." { continue }
            if t == ".." { _ = teile.popLast(); continue }
            teile.append(t)
        }
        return "/" + teile.joined(separator: "/")
    }

    /// Vergleichsform je Pfadteil wie `falte` in der Werkstatt: APFS unterscheidet weder Groß/klein noch NFC/NFD.
    private static func gefaltet(_ pfad: String) -> [String] {
        pfad.split(separator: "/").map { $0.precomposedStringWithCanonicalMapping.lowercased() }
    }

    /// Wie `formenVon` in der Werkstatt: der Pfad wie geschrieben und mit aufgelösten Symlinks (auch wenn der Ordner fehlt: der
    /// tiefste vorhandene Vorfahr wird aufgelöst) — jeweils gefaltet. Zwei Pfade meinen denselben Ordner, wenn sie eine Form teilen.
    private static func vergleichsformen(_ pfad: String) -> [[String]] {
        let geschrieben = gefaltet(pfad)
        let echt = gefaltet(AppAktion.aufgeloest(URL(fileURLWithPath: pfad)).path)
        return echt == geschrieben ? [geschrieben] : [geschrieben, echt]
    }

    private static func teilenForm(_ a: [[String]], _ b: [[String]]) -> Bool { a.contains { x in b.contains { $0 == x } } }

    // MARK: Ortsregeln (wie `pruefeRegeln` in der Werkstatt)

    private static let systemPraefixe = ["/System", "/bin", "/sbin", "/usr", "/etc", "/private/etc", "/dev", "/Library", "/Applications",
                                         "/cores", "/opt", "/private/var/db", "/var/db"]

    /// Darf ein Vault hier liegen? Die Regeln der Werkstatt (Spec §5a „Pfadregeln“), für die geschriebene Form UND den aufgelösten
    /// Pfad (Symlinks): nicht `/`, `/Users`, `/Volumes`, nicht das Home selbst, kein Systemordner und kein Vorfahr davon, nicht
    /// `~/Library` (außer `Mobile Documents` und `CloudStorage`), nicht der App-Ordner, kein `.git`/`node_modules`/`.app` im Pfad,
    /// kein versteckter Ordner unter dem Home. Ob der Ordner existiert, gehört nicht dazu.
    static func ortErlaubt(_ pfad: String, home: URL, support: URL) -> Bool {
        func aufgeloest(_ p: String) -> String { AppAktion.aufgeloest(URL(fileURLWithPath: p)).path }
        let h = bereinigt(home.path), s = bereinigt(support.path)
        return regelnErfuellt(pfad, home: h, support: s)
            && regelnErfuellt(aufgeloest(pfad), home: aufgeloest(h), support: aufgeloest(s))
    }

    private static func hatPraefix(_ p: [String], _ basis: [String]) -> Bool { p.count >= basis.count && zip(p, basis).allSatisfy { $0 == $1 } }
    private static func istUnterOderGleich(_ p: String, _ basis: String) -> Bool { hatPraefix(gefaltet(p), gefaltet(basis)) }

    private static func regelnErfuellt(_ p: String, home: String, support: String) -> Bool {
        let segs = gefaltet(p)
        if segs.isEmpty || (segs.count == 1 && (segs[0] == "users" || segs[0] == "volumes")) { return false }
        if segs == gefaltet(home) { return false }
        // auch die Vorfahren der Systemordner (/private, /private/var, /var): ein Vault dort würde das System enthalten
        for sys in systemPraefixe where istUnterOderGleich(p, sys) || istUnterOderGleich(sys, p) { return false }
        let lib = home + "/Library"
        if istUnterOderGleich(p, lib), !istUnterOderGleich(p, lib + "/Mobile Documents"), !istUnterOderGleich(p, lib + "/CloudStorage") { return false }
        if istUnterOderGleich(p, support) { return false }
        if segs.contains(".git") || segs.contains("node_modules") || segs.contains(where: { $0.hasSuffix(".app") }) { return false }
        let homeTeile = gefaltet(home)
        if segs.count > homeTeile.count, hatPraefix(segs, homeTeile) {
            let rest = p.split(separator: "/").dropFirst(homeTeile.count)
            if rest.contains(where: { $0.hasPrefix(".") }) { return false }
        }
        return true
    }
}
