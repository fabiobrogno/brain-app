import Foundation

/// Die wirksamen Tastenkürzel: Standard aus dem Register plus Eigenes aus `<Support>/tastenkuerzel.json` (nur Abweichungen; fehlt ein Befehl, gilt sein
/// Standard; `null` = bewusst ohne Kürzel). Die Datei schreibt das Studio über `PUT /api/tastenkuerzel` (Werkstatt) — hier wird sie gelesen, und von
/// der App aus nur dann geschrieben, wenn das Kürzel im schwebenden Erfassen-Fenster geändert wird. Gleiche Regeln wie `studio/tastenkuerzel-logik.js`.
public struct KuerzelBelegung: Equatable, Sendable {
    public enum Eigenes: Equatable, Sendable {
        case kuerzel(String)
        case ohne
    }

    public let register: KuerzelRegister
    public private(set) var eigenes: [String: Eigenes]

    public init(register: KuerzelRegister, eigenes: [String: Eigenes] = [:]) {
        self.register = register
        // Nur bekannte Befehle und gültige Schreibweisen (alles andere wirkt, als stünde es nicht in der Datei)
        var sauber: [String: Eigenes] = [:]
        for (id, e) in eigenes where register.befehl(id) != nil {
            switch e {
            case .ohne: sauber[id] = .ohne
            case .kuerzel(let t): if let k = Tastenkuerzel(kanonisch: t), let n = k.kanonisch { sauber[id] = .kuerzel(n) }
            }
        }
        self.eigenes = sauber
    }

    /// Das Kürzel eines Befehls in der gemeinsamen Schreibweise; `nil` = ohne Kürzel.
    public func text(_ id: String) -> String? {
        switch eigenes[id] {
        case .some(.ohne): return nil
        case .some(.kuerzel(let t)): return t
        case .none: return register.befehl(id)?.standard
        }
    }

    public func kuerzel(_ id: String) -> Tastenkuerzel? { text(id).flatMap { Tastenkuerzel(kanonisch: $0) } }

    /// Weicht der Befehl vom Standard ab? (Ein Eintrag, der dem Standard gleicht, zählt nicht.)
    public func istGeaendert(_ id: String) -> Bool { eigenes[id] != nil && text(id) != register.befehl(id)?.standard }

    /// Wer gewinnt, wenn zwei Befehle dasselbe Kürzel haben: ein geänderter vor einem unveränderten, sonst die Reihenfolge im Register.
    /// → Kürzel (Schreibweise) → Befehls-id. Damit stellt die App die Menüs um (ein Kürzel gehört im Menü nur einem Eintrag).
    public func gewinner() -> [String: String] {
        let geaendert = register.befehle.filter { istGeaendert($0.id) }
        let uebrige = register.befehle.filter { !istGeaendert($0.id) }
        var m: [String: String] = [:]
        for b in geaendert + uebrige { if let t = text(b.id), m[t] == nil { m[t] = b.id } }
        return m
    }

    /// Mit einem geänderten Eintrag (nil = Standard, `.ohne` = ohne Kürzel). Gleicht der Wert dem Standard, entfällt der Eintrag.
    public func mit(_ id: String, _ e: Eigenes?) -> KuerzelBelegung {
        var neu = eigenes
        if let e { neu[id] = e } else { neu.removeValue(forKey: id) }
        var b = KuerzelBelegung(register: register, eigenes: neu)
        if b.eigenes[id] != nil, b.text(id) == register.befehl(id)?.standard { b.eigenes.removeValue(forKey: id) }
        return b
    }

    // MARK: Datei

    public static func datei(_ pfade: AppPfade) -> URL { pfade.basis.appendingPathComponent("tastenkuerzel.json") }

    /// Liest die Datei; kaputt oder fehlend ergibt die Standardwerte, nie einen Fehler.
    public static func laden(register: KuerzelRegister, pfade: AppPfade) -> KuerzelBelegung {
        KuerzelBelegung(register: register, eigenes: (try? lies(register: register, pfade: pfade)) ?? [:])
    }

    /// Einmalige Übernahme: Das Kürzel für „Schnell erfassen“ stand früher in `schnell-erfassen.json`. Sagt `tastenkuerzel.json` dazu nichts, wandert es dorthin
    /// (und verschwindet aus der alten Datei), damit es nur noch eine Wahrheit gibt. Eine kaputte `tastenkuerzel.json` bleibt unberührt (dann gilt die alte weiter).
    public static func uebernimmAlteDatei(register: KuerzelRegister, pfade: AppPfade) {
        var alt = ErfassenEinstellungen.lade(pfade)
        guard let k = alt.kuerzel else { return }
        if (try? lies(register: register, pfade: pfade))?["schnell-erfassen"] == nil, let t = k.kanonisch {
            guard speichere(id: "schnell-erfassen", .kuerzel(t), register: register, pfade: pfade) else { return }
        }
        alt.kuerzel = nil
        try? alt.speichere(pfade)
    }

    private static func lies(register: KuerzelRegister, pfade: AppPfade) throws -> [String: Eigenes] {
        let daten = try Data(contentsOf: datei(pfade))
        guard let j = try JSONSerialization.jsonObject(with: daten) as? [String: Any], let k = j["kuerzel"] as? [String: Any] else { return [:] }
        var e: [String: Eigenes] = [:]
        for (id, w) in k {
            if w is NSNull { e[id] = .ohne } else if let t = w as? String { e[id] = .kuerzel(t) }
        }
        return e
    }

    /// Schreibt EINEN Eintrag in die Datei (die übrigen bleiben, wie sie sind) — für Änderungen aus dem Erfassen-Fenster der App. Eine kaputte Datei wird nie überschrieben.
    /// Gleicht der Wert dem Standard, entfällt der Eintrag; bleibt nichts übrig, verschwindet die Datei (wie in der Werkstatt).
    @discardableResult
    public static func speichere(id: String, _ e: Eigenes?, register: KuerzelRegister, pfade: AppPfade) -> Bool {
        guard let befehl = register.befehl(id) else { return false }
        let url = datei(pfade)
        var kuerzel: [String: Any] = [:]
        if let daten = try? Data(contentsOf: url), !daten.isEmpty {
            guard let j = (try? JSONSerialization.jsonObject(with: daten)) as? [String: Any] else { return false } // kaputt: nicht anfassen
            kuerzel = (j["kuerzel"] as? [String: Any]) ?? [:]
        }
        switch e {
        case .none: kuerzel.removeValue(forKey: id)
        case .some(.ohne): if befehl.standard == nil { kuerzel.removeValue(forKey: id) } else { kuerzel[id] = NSNull() }
        case .some(.kuerzel(let t)):
            guard let n = Tastenkuerzel(kanonisch: t)?.kanonisch else { return false }
            if n == befehl.standard { kuerzel.removeValue(forKey: id) } else { kuerzel[id] = n }
        }
        do {
            if kuerzel.isEmpty { try? FileManager.default.removeItem(at: url); return true }
            try FileManager.default.createDirectory(at: pfade.basis, withIntermediateDirectories: true)
            let daten = try JSONSerialization.data(withJSONObject: ["schema": 1, "kuerzel": kuerzel] as [String: Any], options: [.prettyPrinted, .sortedKeys])
            try daten.write(to: url, options: .atomic)
            return true
        } catch { return false }
    }
}
