import Foundation

/// Eine Zeile im Kopf des Menüs der Menüleiste (nur Anzeige, nicht anklickbar). Ein Symbol UND ein Text — Zustand nie nur durch Farbe.
public struct MenueZeile: Equatable, Sendable {
    public enum Art: Equatable, Sendable {
        /// Name des aktiven Vaults.
        case kopf
        /// Alles gut oder neutrale Auskunft.
        case normal
        /// Etwas ist zu beachten (⚠, „Nur ansehen“).
        case hinweis
        /// Etwas funktioniert nicht (✕).
        case fehler
    }

    /// Was ein Klick auf die Zeile tut. Die meisten Zeilen sind nur Auskunft (`keine`, im Menü gedämpft); die wichtigen führen weiter.
    public enum Aktion: Equatable, Sendable {
        case keine
        /// Name des Vaults: öffnet die Auswahl „Vault wechseln“.
        case vaultWechseln
        /// „Nur ansehen“: öffnet im Studio die Einstellungen, wo das Vertrauen bestätigt wird.
        case vertrauenPruefen
        /// Warnung oder Problem: öffnet das Studio.
        case studioOeffnen
        /// Der Kern ist nicht bereit: zeigt das Protokoll.
        case protokollZeigen
    }

    public let symbol: String
    public let text: String
    public let art: Art
    /// Längere Erklärung (Hilfe-Text beim Daraufzeigen); nil, wenn der Text schon alles sagt.
    public let erklaerung: String?
    public let aktion: Aktion

    public init(symbol: String, text: String, art: Art, erklaerung: String? = nil, aktion: Aktion = .keine) {
        self.symbol = symbol
        self.text = text
        self.art = art
        self.erklaerung = erklaerung
        self.aktion = aktion
    }
}

/// Baut aus dem Zustand der App die Statuszeilen des Menüs: erst der Vault mit Namen, dann sein Zustand, dann nur, was zu wissen lohnt.
/// Reine Funktion ohne Zugriff auf Dateien oder Prozesse — darum einzeln testbar; `MenueInhalt` zeigt die Zeilen nur an.
public enum MenueStatus {
    /// Längere Texte (Fehlermeldungen des Kerns) werden im Menü gekürzt; der volle Text steht als Erklärung dabei.
    static let hoechstZeichen = 56

    public static func zeilen(vaultName: String?,
                              anzeige: StatusAnzeige,
                              vertrauen: VaultVertrauen?,
                              zahlen: BrainStatus.Zahlen?,
                              entwicklerVault: Bool,
                              kernMeldung: String?,
                              zufuehrungsZeilen: [String]) -> [MenueZeile] {
        var z: [MenueZeile] = []
        if let name = vaultName, !name.isEmpty {
            z.append(MenueZeile(symbol: "folder", text: kurz(name), art: .kopf, erklaerung: name.count > hoechstZeichen ? name : "Vault wechseln …", aktion: .vaultWechseln))
        }
        z.append(zustand(anzeige, kernMeldung: kernMeldung))
        if vaultName != nil, vertrauen == .nurAnsehen {
            z.append(MenueZeile(symbol: "eye", text: "Nur ansehen — noch nicht als dein Vault bestätigt", art: .hinweis,
                                erklaerung: "Kortex liest, sucht und zeigt nur: kein Git, kein Hintergrunddienst, keine KI-Pflege. "
                                    + "Klicke, um im Studio unter Einstellungen zu bestätigen.", aktion: .vertrauenPruefen))
        }
        if let text = zahlenText(zahlen) {
            z.append(MenueZeile(symbol: "list.bullet", text: text, art: .normal))
        }
        if entwicklerVault {
            z.append(MenueZeile(symbol: "hammer", text: "Entwickler-Vault — bekommt keine Updates", art: .normal))
        }
        for zeile in zufuehrungsZeilen {
            z.append(MenueZeile(symbol: "exclamationmark.triangle", text: kurz(zeile), art: .hinweis, erklaerung: zeile.count > hoechstZeichen ? zeile : nil,
                                aktion: .studioOeffnen))
        }
        return z
    }

    /// „Vault umstellen …“ im Menü: nur mit offenem Vault und nur, wenn der Status Altlasten meldet (alter Werkzeug-Ordner im Vault, Phase A nicht durch).
    public static func bietetUmstellungAn(hatVault: Bool, status: BrainStatus?) -> Bool {
        hatVault && status?.bietetUmstellungAn == true
    }

    /// Die Zustandszeile: Symbol und Wortlaut der Statusanzeige, technische Texte in verständliche Sprache übersetzt.
    static func zustand(_ a: StatusAnzeige, kernMeldung: String?) -> MenueZeile {
        let art: MenueZeile.Art = a.zeichen == "✕" ? .fehler : (a.zeichen == "⚠" ? .hinweis : .normal)
        if kernMeldung != nil, a.zeichen == "✕" {
            return MenueZeile(symbol: a.symbol, text: "Kortex-Kern nicht bereit", art: .fehler,
                              erklaerung: (kernMeldung ?? "") + "\nKlicke, um das Protokoll zu zeigen.", aktion: .protokollZeigen)
        }
        if a == .ohneKit {
            return MenueZeile(symbol: a.symbol, text: "Nur Notizen — ohne Kortex-Prüfung", art: .normal,
                              erklaerung: "In diesem Ordner fehlt die Datei brain.config.json. Studio, Suche und Notizen funktionieren trotzdem.")
        }
        return MenueZeile(symbol: a.symbol, text: kurz(a.titel), art: art, erklaerung: a.titel.count > hoechstZeichen ? a.titel : nil,
                          aktion: art == .normal ? .keine : .studioOeffnen)
    }

    /// „2 Vorschläge · 1 Konflikt · 3 abgelaufen“ — nur, was nicht null ist; nil, wenn nichts offen ist.
    static func zahlenText(_ z: BrainStatus.Zahlen?) -> String? {
        guard let z else { return nil }
        var teile: [String] = []
        if z.vorschlaege > 0 { teile.append(z.vorschlaege == 1 ? "1 Vorschlag" : "\(z.vorschlaege) Vorschläge") }
        if z.konflikte > 0 { teile.append(z.konflikte == 1 ? "1 Konflikt" : "\(z.konflikte) Konflikte") }
        if z.abgelaufen > 0 { teile.append("\(z.abgelaufen) abgelaufen") }
        return teile.isEmpty ? nil : teile.joined(separator: " · ")
    }

    static func kurz(_ text: String) -> String {
        let einzeilig = text.replacingOccurrences(of: "\n", with: " ")
        guard einzeilig.count > hoechstZeichen else { return einzeilig }
        return String(einzeilig.prefix(hoechstZeichen - 1)) + "…"
    }
}
