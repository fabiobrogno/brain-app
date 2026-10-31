import Foundation

/// Der Katalog der KI-Programme (Terminal-KIs, Editoren und Apps mit KI): dieselbe Datei wie im Kern und im Studio
/// (`Ressourcen/gemeinsam/ki-katalog.json`, im App-Paket `Contents/Resources/gemeinsam/ki-katalog.json`). Hier steht nichts doppelt:
/// Namen, Reihenfolge, Erkennung und Logos kommen aus dieser einen Datei; die Felder erklärt `Ressourcen/gemeinsam/ki-katalog.mjs`.
/// Muster der Programmliste: Orca (MIT, Lovecast Inc.; Text in `THIRD-PARTY-NOTICES.md`).
public struct KiLogoInfo: Equatable, Sendable {
    public enum Modus: String, Sendable {
        /// in der Textfarbe der Umgebung (hell/dunkel)
        case einfarbig
        /// eine Markenfarbe (`farbeHex`), nur wenn sie auf Hell UND Dunkel mindestens 3:1 Kontrast hat
        case marke
        /// mehrfarbig bzw. PNG, unverändert
        case bild
    }

    /// Dateiname in `Ressourcen/logos`
    public let datei: String
    public let modus: Modus
    /// Markenfarbe als Hex ohne „#“ (nur bei `marke`)
    public let farbeHex: String?
    /// viewBox für die Darstellung einer SVG (`x y breite höhe`): Quadrat um die Glyphe, Füllung nach der Tintendichte; bei PNG `nil`
    public let ansicht: String?

    public var istSVG: Bool { datei.lowercased().hasSuffix(".svg") }
}

public struct KiKatalogEintrag: Equatable, Sendable {
    public enum Art: String, Sendable { case terminal, app, editor }

    public let id: String
    public let name: String
    public let art: Art
    public let befehle: [String]
    public let apps: [String]
    public let website: String
    public let beliebt: Bool
    public let verbindbar: Bool
    /// eigenes Logo; `nil` = keines (die Oberfläche zeigt die Initiale) oder es gehört einem anderen Eintrag (`teiltLogo`)
    public let logo: KiLogoInfo?
    public let teiltLogo: String?
}

public struct KiKatalog: Sendable {
    public let eintraege: [KiKatalogEintrag]

    public func eintrag(_ id: String) -> KiKatalogEintrag? { eintraege.first { $0.id == id } }

    /// Das Logo eines Eintrags; folgt `teiltLogo` (Claude Desktop zeigt das Zeichen von Claude).
    public func logo(_ id: String) -> KiLogoInfo? {
        guard let e = eintrag(id) else { return nil }
        if let andere = e.teiltLogo, andere != id { return logo(andere) }
        return e.logo
    }

    public enum Fehler: Error, Equatable { case ungueltig(String) }

    // MARK: Laden

    private struct RohLogo: Decodable { let datei: String; let modus: String; let farbe: String?; let ansicht: String? }
    private struct RohEintrag: Decodable {
        let id: String, name: String, art: String, befehle: [String], apps: [String], website: String, beliebt: Bool, verbindbar: Bool
        let logo: RohLogo?
        let teilt_logo: String?
    }
    private struct RohKatalog: Decodable { let schema: Int; let eintraege: [RohEintrag] }

    public static func laden(daten: Data) throws -> KiKatalog {
        let roh = try JSONDecoder().decode(RohKatalog.self, from: daten)
        guard roh.schema == 1 else { throw Fehler.ungueltig("schema \(roh.schema)") }
        let eintraege = try roh.eintraege.map { e -> KiKatalogEintrag in
            guard let art = KiKatalogEintrag.Art(rawValue: e.art) else { throw Fehler.ungueltig("\(e.id): art \(e.art)") }
            var logo: KiLogoInfo?
            if let l = e.logo {
                guard let modus = KiLogoInfo.Modus(rawValue: l.modus) else { throw Fehler.ungueltig("\(e.id): modus \(l.modus)") }
                logo = KiLogoInfo(datei: l.datei, modus: modus, farbeHex: l.farbe.map { String($0.drop { $0 == "#" }) }, ansicht: l.ansicht)
            }
            return KiKatalogEintrag(id: e.id, name: e.name, art: art, befehle: e.befehle, apps: e.apps, website: e.website,
                                    beliebt: e.beliebt, verbindbar: e.verbindbar, logo: logo, teiltLogo: e.teilt_logo)
        }
        return KiKatalog(eintraege: eintraege)
    }

    private final class Zwischen: @unchecked Sendable {
        private let sperre = NSLock()
        private var werte: [String: KiKatalog] = [:]
        func hole(_ schluessel: String) -> KiKatalog? { sperre.lock(); defer { sperre.unlock() }; return werte[schluessel] }
        func setze(_ schluessel: String, _ k: KiKatalog) { sperre.lock(); defer { sperre.unlock() }; werte[schluessel] = k }
    }
    private static let zwischen = Zwischen()

    /// Der Katalog aus `<ressourcen>/gemeinsam/ki-katalog.json` (App-Paket: `Contents/Resources`, Repo: `Ressourcen`); `nil`, wenn die Datei fehlt oder nicht lesbar ist.
    public static func laden(ressourcen: URL?) -> KiKatalog? {
        guard let ressourcen else { return nil }
        let datei = ressourcen.appendingPathComponent("gemeinsam", isDirectory: true).appendingPathComponent("ki-katalog.json")
        if let k = zwischen.hole(datei.path) { return k }
        guard let daten = try? Data(contentsOf: datei), let k = try? laden(daten: daten) else { return nil }
        zwischen.setze(datei.path, k)
        return k
    }
}
