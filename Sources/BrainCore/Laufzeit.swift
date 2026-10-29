import Foundation
import CryptoKit
import Darwin

public struct NodeManifest: Codable, Equatable, Sendable {
    public let version: String
    public let sha256: String
}

/// Prüfsummen aller Dateien des Kerns im App-Paket (`Contents/Resources/kern-manifest.json`, erzeugt von
/// `scripts/kern-manifest.sh` beim Bauen). `dateien`: relativer Pfad innerhalb von `kern/` → SHA-256 (hex).
public struct KernManifest: Codable, Equatable, Sendable {
    public let schema: Int
    public let dateien: [String: String]
}

public enum LaufzeitFehler: Error, Equatable, Sendable {
    case manifestFehlt
    case pruefsummeFalsch(erwartet: String, ist: String)
    case symlinkFehlgeschlagen
    case kernManifestFehlt
    case kernManifestUngueltig
    case kernVersionUngueltig(String)
    case kernPruefsummeFalsch(datei: String, erwartet: String, ist: String)
    case kernDateiFehlt(String)
    /// Eine Datei, die nicht im Manifest steht, oder etwas anderes als Datei/Ordner (z. B. ein Symlink).
    case kernUnerwarteteDatei(String)
    case kernKopieFehlgeschlagen(String)
    case starterFehlgeschlagen(String)

    /// Klartext für Protokoll und Hinweisfenster.
    public var beschreibung: String {
        switch self {
        case .manifestFehlt: return "Das Manifest der mitgelieferten Laufzeit fehlt."
        case .pruefsummeFalsch: return "Die Prüfsumme der mitgelieferten Node-Datei stimmt nicht."
        case .symlinkFehlgeschlagen: return "Der stabile Pfad konnte nicht umgeschaltet werden."
        case .kernManifestFehlt: return "Das Manifest des Kerns (kern-manifest.json) fehlt im App-Paket."
        case .kernManifestUngueltig: return "Das Manifest des Kerns ist unlesbar oder hat eine unbekannte Version."
        case .kernVersionUngueltig(let v): return "Die App-Version „\(v)“ ist als Ordnername nicht zulässig."
        case .kernPruefsummeFalsch(let d, _, _): return "Die Prüfsumme der Kern-Datei „\(d)“ stimmt nicht — der Kern wurde nicht installiert."
        case .kernDateiFehlt(let d): return "Die Kern-Datei „\(d)“ fehlt im App-Paket — der Kern wurde nicht installiert."
        case .kernUnerwarteteDatei(let d): return "Unerwartete Datei „\(d)“ im Kern — der Kern wurde nicht installiert."
        case .kernKopieFehlgeschlagen(let g): return "Der Kern konnte nicht kopiert werden: \(g)"
        case .starterFehlgeschlagen(let g): return "Der Starter „kortex“ konnte nicht geschrieben werden: \(g)"
        }
    }
}

/// Stellt die Laufzeit der App unter Application Support/Kortex bereit (App-Spec §5.2 Baustein 2, §11):
///  - Node: Kopie aus `Resources/node-runtime` nach `node/<version>/`, `bin/node` als stabiler Symlink darauf.
///  - Kern (die Brain-Logik): Kopie aus `Resources/kern` nach `kern/<appVersion>/`, geprüft gegen `kern-manifest.json`,
///    `bin/kern` als stabiler Symlink darauf. Die vorige Version bleibt liegen (ein Hook, der mitten im Update läuft,
///    liest weiter aus ihr); ältere werden erst nach erfolgreichem Umschalten entfernt.
///  - Starter `bin/kortex`: `exec node kern/brain.mjs "$@"`.
/// Claude-Code-Hooks, MCP, git-Hooks und LaunchAgent nutzen nur diese festen Pfade (`AppPfade.node/.kern/.starter`) — sie
/// überstehen App-Updates, Verschieben der App und App Translocation. Alles idempotent; Symlinks werden per `rename(2)`
/// atomar umgeschaltet; Quarantäne-Kennzeichen werden entfernt, damit Terminal-Hooks ohne Rückfrage starten.
public struct Laufzeit: Sendable {
    /// `Contents/Resources` des App-Pakets (in Tests ein Temp-Ordner).
    public let ressourcen: URL
    /// `CFBundleShortVersionString`; Ordnername der Kern-Kopie.
    public let appVersion: String
    public let pfade: AppPfade

    public init(ressourcen: URL, appVersion: String, pfade: AppPfade) {
        self.ressourcen = ressourcen
        self.appVersion = appVersion
        self.pfade = pfade
    }

    public enum KernStatus: Equatable, Sendable {
        /// Das Paket hat (noch) keinen `kern`-Ordner — kein Fehler.
        case nichtEnthalten
        case bereit(version: String, ordner: URL)
        /// Der Kern konnte nicht bereitgestellt werden; `bin/kern` zeigt weiter auf die bisherige Version (falls es eine gab).
        case fehler(LaufzeitFehler)
    }

    public struct Ergebnis: Sendable {
        public let node: URL
        public let kern: KernStatus
        public let starter: URL
        public let starterFehler: LaufzeitFehler?

        public init(node: URL, kern: KernStatus, starter: URL, starterFehler: LaufzeitFehler?) {
            self.node = node
            self.kern = kern
            self.starter = starter
            self.starterFehler = starterFehler
        }

        /// Alles, was dem Nutzer sichtbar gemeldet werden muss (leer = alles in Ordnung).
        public var meldungen: [String] {
            var m: [String] = []
            if case .fehler(let f) = kern { m.append(f.beschreibung) }
            if let f = starterFehler { m.append(f.beschreibung) }
            return m
        }
    }

    // MARK: Quellen im Paket

    public var nodeQuelle: URL { ressourcen.appendingPathComponent("node-runtime", isDirectory: true) }
    public var kernQuelle: URL { ressourcen.appendingPathComponent("kern", isDirectory: true) }
    public var kernManifestDatei: URL { ressourcen.appendingPathComponent("kern-manifest.json") }
    public var kernEnthalten: Bool {
        var istOrdner: ObjCBool = false
        return FileManager.default.fileExists(atPath: kernQuelle.path, isDirectory: &istOrdner) && istOrdner.boolValue
    }

    // MARK: Gesamtablauf

    /// Node ist Pflicht (Fehler wird geworfen). Kern und Starter melden Fehler im Ergebnis, damit die App trotzdem startet.
    @discardableResult
    public func installiere() throws -> Ergebnis {
        let node = try installiereNode()
        let starterFehler: LaufzeitFehler?
        do { try schreibeStarter(); starterFehler = nil } catch let f as LaufzeitFehler { starterFehler = f } catch { starterFehler = .starterFehlgeschlagen("\(error)") }
        return Ergebnis(node: node, kern: installiereKern(), starter: pfade.starter, starterFehler: starterFehler)
    }

    // MARK: Node

    public func manifest() throws -> NodeManifest {
        guard let daten = try? Data(contentsOf: nodeQuelle.appendingPathComponent("manifest.json")) else {
            throw LaufzeitFehler.manifestFehlt
        }
        return try JSONDecoder().decode(NodeManifest.self, from: daten)
    }

    @discardableResult
    public func installiereNode() throws -> URL {
        let m = try manifest()
        try pfade.legeAn()
        let fm = FileManager.default
        let zielOrdner = pfade.nodeOrdner.appendingPathComponent(m.version, isDirectory: true)
        let zielNode = zielOrdner.appendingPathComponent("bin/node")
        if !(fm.fileExists(atPath: zielNode.path) && (try? Self.sha256(zielNode)) == m.sha256) {
            let quellNode = nodeQuelle.appendingPathComponent("bin/node")
            let ist = try Self.sha256(quellNode)
            guard ist == m.sha256 else { throw LaufzeitFehler.pruefsummeFalsch(erwartet: m.sha256, ist: ist) }
            let tmp = pfade.nodeOrdner.appendingPathComponent(".\(m.version).\(UUID().uuidString)", isDirectory: true)
            try fm.createDirectory(at: tmp.appendingPathComponent("bin"), withIntermediateDirectories: true)
            try fm.copyItem(at: quellNode, to: tmp.appendingPathComponent("bin/node"))
            let lizenz = nodeQuelle.appendingPathComponent("LICENSE")
            if fm.fileExists(atPath: lizenz.path) { try fm.copyItem(at: lizenz, to: tmp.appendingPathComponent("LICENSE")) }
            removexattr(tmp.appendingPathComponent("bin/node").path, "com.apple.quarantine", 0)
            if fm.fileExists(atPath: zielOrdner.path) { try fm.removeItem(at: zielOrdner) }
            try fm.moveItem(at: tmp, to: zielOrdner)
            let kopiert = try Self.sha256(zielNode)
            guard kopiert == m.sha256 else { throw LaufzeitFehler.pruefsummeFalsch(erwartet: m.sha256, ist: kopiert) }
        }
        // relativ (`../node/<ver>/bin/node`): bleibt gültig, auch wenn der Support-Ordner umbenannt oder verschoben wird
        try Self.setzeSymlink(pfade.node, nach: "../node/\(m.version)/bin/node")
        return pfade.node
    }

    // MARK: Kern

    /// Stellt den Kern bereit. Wirft nie: Ergebnis ist `.nichtEnthalten`, `.bereit` oder `.fehler`. Bei einem Fehler bleibt
    /// `bin/kern` unverändert (zeigt weiter auf die bisherige Version).
    public func installiereKern() -> KernStatus {
        guard kernEnthalten else { return .nichtEnthalten }
        do {
            let ordner = try stelleKernBereit()
            return .bereit(version: appVersion, ordner: ordner)
        } catch let f as LaufzeitFehler {
            return .fehler(f)
        } catch {
            return .fehler(.kernKopieFehlgeschlagen("\(error)"))
        }
    }

    private func stelleKernBereit() throws -> URL {
        guard appVersion.range(of: #"^[A-Za-z0-9][A-Za-z0-9._+-]*$"#, options: .regularExpression) != nil, !appVersion.contains("..") else {
            throw LaufzeitFehler.kernVersionUngueltig(appVersion)
        }
        guard let daten = try? Data(contentsOf: kernManifestDatei) else { throw LaufzeitFehler.kernManifestFehlt }
        guard let m = try? JSONDecoder().decode(KernManifest.self, from: daten), m.schema == 1 else {
            throw LaufzeitFehler.kernManifestUngueltig
        }
        try pfade.legeAn()
        let fm = FileManager.default
        let ziel = pfade.kernOrdner.appendingPathComponent(appVersion, isDirectory: true)
        let bisher = aktuelleKernVersion()

        // Die Kopie wird erst NACH dem Kopieren geprüft (nicht die Quelle vorher): so deckt die Prüfung auch eine Änderung
        // der Quelle zwischen Prüfen und Kopieren ab.
        if (try? Self.pruefeKern(ziel, gegen: m, quarantaeneEntfernen: false)) == nil {
            let tmp = pfade.kernOrdner.appendingPathComponent(".\(appVersion).\(UUID().uuidString)", isDirectory: true)
            defer { try? fm.removeItem(at: tmp) }
            try fm.copyItem(at: kernQuelle, to: tmp)
            try Self.pruefeKern(tmp, gegen: m, quarantaeneEntfernen: true)
            if fm.fileExists(atPath: ziel.path) {
                // Vorhandene, aber nicht passende Kopie (beschädigt, anderer Build derselben Version): atomar tauschen, nie
                // erst löschen — ein laufender Hook sieht so nie einen halben Ordner. `defer` räumt den alten Inhalt weg.
                guard renamex_np(tmp.path, ziel.path, UInt32(RENAME_SWAP)) == 0 else { throw LaufzeitFehler.symlinkFehlgeschlagen }
            } else {
                guard rename(tmp.path, ziel.path) == 0 else { throw LaufzeitFehler.symlinkFehlgeschlagen }
            }
        }
        try Self.setzeSymlink(pfade.kern, nach: "../kern/\(appVersion)") // relativ, siehe Node
        raeumeKernAuf(neu: appVersion, vorige: bisher)
        return ziel
    }

    /// Ordnername, auf den `bin/kern` gerade zeigt (nur wenn er in `kern/` liegt). Relative Ziele (`../kern/<ver>`) werden
    /// auf `bin/` bezogen, absolute (ältere Installationen) gelten wie sie sind.
    func aktuelleKernVersion() -> String? {
        guard let ziel = try? FileManager.default.destinationOfSymbolicLink(atPath: pfade.kern.path) else { return nil }
        let url = ziel.hasPrefix("/") ? URL(fileURLWithPath: ziel) : URL(fileURLWithPath: ziel, relativeTo: pfade.binOrdner)
        let norm = url.standardizedFileURL
        guard norm.deletingLastPathComponent().path == pfade.kernOrdner.standardizedFileURL.path else { return nil }
        return norm.lastPathComponent
    }

    /// Nach erfolgreichem Umschalten: behalte die neue und die vorige Version; alles andere und liegengebliebene
    /// Arbeitsordner (älter als eine Stunde) weg. Ist die vorige Version nicht bekannt (erste Installation, `bin/kern` zeigte
    /// nirgends hin oder schon auf die neue Version), werden KEINE Versionen gelöscht — lieber ein Ordner zu viel.
    private func raeumeKernAuf(neu: String, vorige: String?) {
        let fm = FileManager.default
        guard let inhalt = try? fm.contentsOfDirectory(at: pfade.kernOrdner, includingPropertiesForKeys: [.contentModificationDateKey], options: []) else { return }
        let grenze = Date().addingTimeInterval(-3600)
        for eintrag in inhalt {
            let name = eintrag.lastPathComponent
            if name.hasPrefix(".") {
                let datum = (try? eintrag.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? Date()
                if datum < grenze { try? fm.removeItem(at: eintrag) }
            } else if let vorige, vorige != neu, name != neu, name != vorige {
                try? fm.removeItem(at: eintrag)
            }
        }
    }

    /// Prüft einen Kern-Ordner gegen das Manifest: jede Datei des Manifests da und mit richtiger SHA-256, nichts darüber hinaus,
    /// keine Symlinks. Entfernt (optional) das Quarantäne-Kennzeichen jeder Datei.
    static func pruefeKern(_ ordner: URL, gegen m: KernManifest, quarantaeneEntfernen: Bool) throws {
        let fm = FileManager.default
        guard let it = fm.enumerator(atPath: ordner.path) else { throw LaufzeitFehler.kernDateiFehlt(ordner.lastPathComponent) }
        var gesehen = Set<String>()
        for case let rel as String in it {
            let voll = ordner.appendingPathComponent(rel)
            let typ = (try? fm.attributesOfItem(atPath: voll.path))?[.type] as? FileAttributeType
            if typ == .typeDirectory { continue }
            guard typ == .typeRegular else { throw LaufzeitFehler.kernUnerwarteteDatei(rel) }
            guard let soll = m.dateien[rel] else { throw LaufzeitFehler.kernUnerwarteteDatei(rel) }
            let ist = try sha256(voll)
            guard ist == soll else { throw LaufzeitFehler.kernPruefsummeFalsch(datei: rel, erwartet: soll, ist: ist) }
            if quarantaeneEntfernen { removexattr(voll.path, "com.apple.quarantine", 0) }
            gesehen.insert(rel)
        }
        if let fehlt = m.dateien.keys.sorted().first(where: { !gesehen.contains($0) }) { throw LaufzeitFehler.kernDateiFehlt(fehlt) }
    }

    // MARK: Starter

    /// Schreibt `bin/kortex` (0755) atomar: erst daneben, dann per `rename(2)`. Unverändert, wenn Inhalt und Rechte schon stimmen.
    @discardableResult
    public func schreibeStarter() throws -> URL {
        let fm = FileManager.default
        do {
            try pfade.legeAn()
            let inhalt = Self.starterInhalt(support: pfade.basis)
            let ziel = pfade.starter
            let rechte = (try? fm.attributesOfItem(atPath: ziel.path))?[.posixPermissions] as? Int
            if let alt = try? String(contentsOf: ziel, encoding: .utf8), alt == inhalt, rechte == 0o755 { return ziel }
            let tmp = pfade.binOrdner.appendingPathComponent(".kortex.\(UUID().uuidString)")
            defer { try? fm.removeItem(at: tmp) }
            try inhalt.write(to: tmp, atomically: false, encoding: .utf8)
            try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: tmp.path)
            guard rename(tmp.path, ziel.path) == 0 else { throw LaufzeitFehler.starterFehlgeschlagen(String(cString: strerror(errno))) }
            return ziel
        } catch let f as LaufzeitFehler {
            throw f
        } catch {
            throw LaufzeitFehler.starterFehlgeschlagen("\(error)")
        }
    }

    /// Inhalt des Starters. Die Pfade stehen einfach quotiert im Skript (Leerzeichen, Apostrophe, `$` sind unkritisch);
    /// fehlt Node oder Kern, endet er mit Meldung auf stderr und Exit 127 — nie mit einem kryptischen Fehler.
    static func starterInhalt(support: URL) -> String {
        let node = support.appendingPathComponent("bin/node").path
        let kern = support.appendingPathComponent("bin/kern/brain.mjs").path
        return """
        #!/bin/sh
        # Kortex-Starter. Von der App geschrieben und bei jedem Start erneuert — nicht von Hand ändern.
        node=\(shellQuote(node))
        kern=\(shellQuote(kern))
        if [ ! -f "$node" ] || [ ! -x "$node" ]; then
          echo "kortex: Node fehlt ($node). Bitte Kortex einmal öffnen." >&2
          exit 127
        fi
        if [ ! -f "$kern" ]; then
          echo "kortex: Kern fehlt ($kern). Bitte Kortex öffnen bzw. aktualisieren." >&2
          exit 127
        fi
        exec "$node" "$kern" "$@"

        """
    }

    static func shellQuote(_ s: String) -> String {
        "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    // MARK: Hilfen

    /// Symlink atomar umbiegen: neuen daneben anlegen, dann an die Stelle des alten tauschen.
    /// Ist schon ein Symlink da, wird getauscht (`RENAME_SWAP`), nicht per `rename(2)` überschrieben, und der alte Link bleibt
    /// noch kurz unter einem versteckten Namen liegen (`.<name>.<uuid>`); der nächste Aufruf räumt ihn nach `schonfrist` weg.
    /// Grund (auf APFS gemessen): Gibt der Kernel den alten Symlink frei, während ein anderer Prozess ihn gerade auflöst,
    /// liefert dessen `readlink` vereinzelt EINVAL — ein Hook sähe „kein Symlink“. Beim Überschreiben passierte das bei rund
    /// 1 % enger Lesezugriffe, beim Tausch mit sofortigem Löschen noch bei rund 0,003 %, beim Tausch ohne sofortiges Löschen nie.
    /// Ist an der Stelle etwas anderes (Datei, Ordner), tauscht nichts: `rename(2)` ersetzt eine Datei oder scheitert bei einem
    /// Ordner — ein Ordner geht so nie verloren.
    /// `ziel` ist der Inhalt des Links (üblich relativ zum Ordner des Links, z. B. `../kern/1.0.0`).
    static func setzeSymlink(_ link: URL, nach ziel: String, schonfrist: TimeInterval = 2) throws {
        let fm = FileManager.default
        raeumeAlteSymlinksAuf(neben: link, aelterAls: schonfrist)
        let neu = link.deletingLastPathComponent().appendingPathComponent(".\(link.lastPathComponent).\(UUID().uuidString)")
        try fm.createSymbolicLink(atPath: neu.path, withDestinationPath: ziel)
        var st = stat()
        let istSymlink = lstat(link.path, &st) == 0 && (st.st_mode & S_IFMT) == S_IFLNK
        if istSymlink, renamex_np(neu.path, link.path, UInt32(RENAME_SWAP)) == 0 {
            return // `neu` trägt jetzt den alten Link und wird später aufgeräumt
        }
        guard rename(neu.path, link.path) == 0 else {
            try? fm.removeItem(at: neu)
            throw LaufzeitFehler.symlinkFehlgeschlagen
        }
    }

    /// Entfernt abgelöste Links `.<name>.<uuid>` neben `link`, die älter als `aelterAls` Sekunden sind.
    static func raeumeAlteSymlinksAuf(neben link: URL, aelterAls frist: TimeInterval) {
        let fm = FileManager.default
        let ordner = link.deletingLastPathComponent()
        let praefix = ".\(link.lastPathComponent)."
        guard let namen = try? fm.contentsOfDirectory(atPath: ordner.path) else { return }
        for name in namen where name.hasPrefix(praefix) {
            let pfad = ordner.appendingPathComponent(name).path
            var st = stat()
            guard lstat(pfad, &st) == 0, (st.st_mode & S_IFMT) == S_IFLNK else { continue }
            let alter = Date().timeIntervalSince1970 - (Double(st.st_mtimespec.tv_sec) + Double(st.st_mtimespec.tv_nsec) / 1e9)
            if alter > frist { unlink(pfad) }
        }
    }

    static func sha256(_ url: URL) throws -> String {
        let daten = try Data(contentsOf: url, options: .mappedIfSafe)
        return SHA256.hash(data: daten).map { String(format: "%02x", $0) }.joined()
    }
}
