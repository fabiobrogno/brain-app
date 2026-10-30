import SwiftUI
import BrainCore

// Gemeinsame Bausteine des Assistenten „Kortex einrichten“: ruhige Flächen, ein Akzent, wenig Text. Alle Farben kommen aus dem System
// (Hell/Dunkel folgt von selbst), alle Ecken sind „continuous“ wie bei macOS 26.

enum AssistentMass {
    static let eckenGross: CGFloat = 14
    static let eckenKlein: CGFloat = 10
    static let abstand: CGFloat = 16
}

/// Einheitliche Symbolstufen für alle SF Symbols des Assistenten (und des Menüs): immer dieselbe Gewichtung (`.medium`), nur drei Größen,
/// einfarbig (`.monochrome`), in einer festen Breite, damit Texte daneben auf einer Linie stehen. Marken (GitHub) kommen nicht aus SF Symbols,
/// sondern über `MarkenLogoAnsicht`; ihre Größen entsprechen diesen Stufen.
enum SymbolStufe {
    /// Neben Text: Hinweise, Meldungen, Ordnerzeilen, Menüzeilen.
    case zeile
    /// In einer Auswahlkarte.
    case karte
    /// Im Kopf eines Schritts (im getönten Kreis).
    case titel

    var punkte: CGFloat { switch self { case .zeile: 14; case .karte: 18; case .titel: 22 } }
    var breite: CGFloat { switch self { case .zeile: 18; case .karte: 28; case .titel: 22 } }
}

/// Ein SF Symbol in einer festen Stufe. Gefüllte Varianten (`.fill`) sind Zuständen vorbehalten (angemeldet, Warnung, Hinweis); im Kopf eines
/// Schritts und in Karten steht immer die Linienform, damit die Symbole zur Linienoptik des Studios passen.
struct KSymbol: View {
    let name: String
    var stufe: SymbolStufe = .zeile

    var body: some View {
        Image(systemName: name)
            .symbolRenderingMode(.monochrome)
            .font(.system(size: stufe.punkte, weight: .medium))
            .frame(width: stufe.breite, height: stufe.breite)
            .accessibilityHidden(true)
    }

    /// Linienform eines Symbolnamens (`checkmark.seal.fill` → `checkmark.seal`).
    static func linie(_ name: String) -> String { name.replacingOccurrences(of: ".fill", with: "") }
}

/// Beschriftung mit Symbol in der Zeilenstufe: gleiche Größe, Gewichtung und Abstand wie überall im Assistenten (statt der Standardgröße von `Label`).
struct KortexLabelStil: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            configuration.icon.font(.system(size: SymbolStufe.zeile.punkte, weight: .medium)).frame(width: SymbolStufe.zeile.breite)
            configuration.title
        }
    }
}

extension LabelStyle where Self == KortexLabelStil {
    static var kortex: KortexLabelStil { KortexLabelStil() }
}

/// Kopf eines Schritts: Symbol (oder Marken-Logo) in einem getönten Kreis, Überschrift, ein kurzer Satz.
struct Titel: View {
    let symbol: String
    var marke: MarkenLogo? = nil
    let titel: String
    let text: String?

    var body: some View {
        VStack(spacing: 8) {
            ZStack {
                Circle().fill(Kortex.akzent.opacity(0.14))
                if let marke {
                    MarkenLogoAnsicht(marke: marke, groesse: SymbolStufe.titel.punkte + 2)
                } else {
                    KSymbol(name: KSymbol.linie(symbol), stufe: .titel).foregroundStyle(Kortex.akzent)
                }
            }
            .frame(width: 52, height: 52)
            .accessibilityHidden(true)
            Text(titel).font(.title2.weight(.semibold)).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
            if let text {
                Text(text).foregroundStyle(.secondary).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

/// Eine Fläche für zusammengehörigen Inhalt (statt vieler Rahmen).
struct Flaeche<Inhalt: View>: View {
    var tonung: Color? = nil
    @ViewBuilder let inhalt: Inhalt

    var body: some View {
        VStack(alignment: .leading, spacing: 10) { inhalt }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background((tonung ?? Color.primary).opacity(tonung == nil ? 0.05 : 0.10), in: RoundedRectangle(cornerRadius: AssistentMass.eckenKlein, style: .continuous))
    }
}

struct FehlerBox: View {
    let text: String
    var wiederholen: (() -> Void)? = nil

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            KSymbol(name: "exclamationmark.triangle.fill").foregroundStyle(.orange)
            VStack(alignment: .leading, spacing: 8) {
                Text(text).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
                if let wiederholen { Button("Noch einmal versuchen", action: wiederholen).controlSize(.small) }
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: AssistentMass.eckenKlein, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Hinweis: \(text)")
    }
}

/// Eine Erklärung, die keine Panne ist (z. B. „Ordner zu breit“).
struct HinweisBox: View {
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            KSymbol(name: "info.circle.fill").foregroundStyle(Kortex.akzent)
            Text(text).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Kortex.akzent.opacity(0.10), in: RoundedRectangle(cornerRadius: AssistentMass.eckenKlein, style: .continuous))
    }
}

/// Wartezustand: Kreisel und Text, mittig.
struct Arbeit: View {
    let text: String

    var body: some View {
        HStack(spacing: 10) {
            ProgressView().controlSize(.small)
            Text(text).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}

struct GrosserKnopf: View {
    let titel: String
    var marke: MarkenLogo? = nil
    let aktion: () -> Void
    var haupt = true

    private var beschriftung: some View {
        HStack(spacing: 8) {
            if let marke { MarkenLogoAnsicht(marke: marke, groesse: SymbolStufe.zeile.punkte + 2, farbe: haupt ? Kortex.akzentText : nil).accessibilityHidden(true) }
            Text(titel)
        }
        .frame(minWidth: 220)
    }

    var body: some View {
        if haupt {
            Button(action: aktion) { beschriftung }
                .buttonStyle(.kortexHaupt).controlSize(.large).keyboardShortcut(.defaultAction)
        } else {
            Button(action: aktion) { beschriftung }.controlSize(.large)
        }
    }
}

/// Auswahlkarte mit Kreis (offen/gewählt). Nur die Kopfzeile ist ein Knopf; der Inhalt darunter hat seine eigenen Bedienelemente.
struct Karte<Inhalt: View>: View {
    let symbol: String
    var marke: MarkenLogo? = nil
    let titel: String
    let text: String
    let offen: Bool
    var empfohlen = false
    let aktion: () -> Void
    @ViewBuilder let inhalt: Inhalt

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button(action: aktion) {
                HStack(spacing: 12) {
                    Group {
                        if let marke { MarkenLogoAnsicht(marke: marke, groesse: SymbolStufe.karte.punkte + 2) } else { KSymbol(name: KSymbol.linie(symbol), stufe: .karte) }
                    }
                    .frame(width: SymbolStufe.karte.breite).foregroundStyle(Kortex.akzent).accessibilityHidden(true) // Marken-Logos behalten ihre eigene Farbe (GitHub: Textfarbe)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(titel).font(.headline)
                            if empfohlen {
                                Text("Empfohlen").font(.caption2.weight(.semibold)).foregroundStyle(Kortex.akzent)
                                    .padding(.horizontal, 6).padding(.vertical, 1)
                                    .background(Kortex.akzent.opacity(0.14), in: Capsule())
                            }
                        }
                        Text(text).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                    KSymbol(name: offen ? "circle.inset.filled" : "circle")
                        .foregroundStyle(offen ? Kortex.akzent : Color.secondary.opacity(0.6))
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(offen ? .isSelected : [])
            if offen { inhalt }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(offen ? 0.07 : 0.04), in: RoundedRectangle(cornerRadius: AssistentMass.eckenGross, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: AssistentMass.eckenGross, style: .continuous).stroke(offen ? Kortex.akzent : Color.primary.opacity(0.08), lineWidth: offen ? 1.5 : 1))
    }
}

// MARK: - Wege und Zeilen (Gestaltungsmuster aus Orca, MIT)

// Herkunft: Das Muster „eine große Hauptaktion, darunter eine gruppierte Liste weiterer Wege, die gewählte Zeile mit Rahmen und ⏎-Chip,
// Pfeiltasten wechseln die Zeile“ und die Maße der Zeilen (Symbolkachel 28 pt mit 6 pt Ecke, Titel 14 pt medium, Beschreibung 12 pt,
// Gruppe mit 6 pt Ecke und feiner Trennlinie, Kleinbuchstaben-Überschrift mit Sperrung) stammen aus dem Dialog „Add a project“ von Orca
// (src/renderer/src/components/sidebar/AddRepoStartSteps.tsx, Stand cf5b462, MIT, Copyright (c) 2026
// Lovecast Inc.). Übertragen nach SwiftUI, mit eigenen Texten, Farben (Kortex-Akzent) und Symbolen. Siehe THIRD-PARTY-NOTICES.md.

/// Ein Weg im Willkommensbild. `haupt`: große Zeile mit eigenem Rahmen; sonst Zeile in der Gruppe darunter.
struct WegZeile: View {
    let symbol: String
    var marke: MarkenLogo? = nil
    let titel: String
    let text: String
    var gewaehlt = false
    var haupt = false
    var aktiv = true
    let aktion: () -> Void

    var body: some View {
        Button(action: aktion) {
            HStack(spacing: 12) {
                Group {
                    if let marke { MarkenLogoAnsicht(marke: marke, groesse: SymbolStufe.karte.punkte) } else { KSymbol(name: KSymbol.linie(symbol), stufe: .karte) }
                }
                .frame(width: 28, height: 28)
                .foregroundStyle(gewaehlt ? Kortex.akzent : (haupt ? Color.primary : Color.secondary))
                .background(gewaehlt ? Color(nsColor: .controlBackgroundColor).opacity(0.7) : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 1) {
                    Text(titel).font(.system(size: 14, weight: .medium))
                    Text(text).font(.system(size: 12)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                if gewaehlt { EnterChip() }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, haupt ? 11 : 9)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(gewaehlt ? Kortex.akzent.opacity(0.10) : (haupt ? Color.primary.opacity(0.03) : .clear),
                        in: RoundedRectangle(cornerRadius: haupt ? 8 : 0, style: .continuous))
            .overlay {
                if haupt {
                    RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(gewaehlt ? Kortex.akzent : Color.primary.opacity(0.14), lineWidth: gewaehlt ? 1.5 : 1)
                } else if gewaehlt {
                    Rectangle().stroke(Kortex.akzent, lineWidth: 1.5)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!aktiv)
        .opacity(aktiv ? 1 : 0.4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(titel). \(text)")
        .accessibilityAddTraits(gewaehlt ? .isSelected : [])
    }
}

/// Kleines Tastenfeld „⏎“ an der gewählten Zeile.
struct EnterChip: View {
    var body: some View {
        Image(systemName: "return")
            .font(.system(size: 10, weight: .medium))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 6).padding(.vertical, 3)
            .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous).stroke(Color.primary.opacity(0.2), lineWidth: 1))
            .accessibilityHidden(true)
    }
}

/// Gruppe weiterer Wege: eine Fläche mit feinem Rahmen, die Zeilen durch dünne Linien getrennt.
struct WegGruppe<Inhalt: View>: View {
    let ueberschrift: String?
    @ViewBuilder let inhalt: Inhalt

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let ueberschrift {
                Text(ueberschrift.uppercased()).font(.system(size: 11, weight: .medium)).tracking(0.8).foregroundStyle(.secondary)
            }
            Group(subviews: inhalt) { zeilen in
                VStack(spacing: 0) {
                    ForEach(zeilen.indices, id: \.self) { i in
                        if i > 0 { Divider().opacity(0.7) }
                        zeilen[i]
                    }
                }
            }
            .background(Color(nsColor: .controlBackgroundColor).opacity(0.5))
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).stroke(Color.primary.opacity(0.14), lineWidth: 1))
        }
    }
}

/// Fußleiste jedes Bildes: links leise Wege (Zurück, Später), rechts GENAU EIN Hauptknopf (⏎).
struct Fussleiste<Links: View, Haupt: View>: View {
    @ViewBuilder let links: Links
    @ViewBuilder let haupt: Haupt

    var body: some View {
        HStack(spacing: 14) {
            links
            Spacer(minLength: 8)
            haupt
        }
        .padding(.horizontal, 28)
        .padding(.vertical, 14)
    }
}

/// Zeile einer Karte auf dem Abschlussbild: Symbol, Titel, ein Satz, rechts Stand (erledigt) oder ein Pfeil.
struct AufgabenZeile: View {
    let symbol: String
    var marke: MarkenLogo? = nil
    let titel: String
    let text: String
    var erledigt = false
    let aktion: () -> Void

    var body: some View {
        Button(action: aktion) {
            HStack(spacing: 12) {
                Group {
                    if let marke { MarkenLogoAnsicht(marke: marke, groesse: SymbolStufe.karte.punkte) } else { KSymbol(name: KSymbol.linie(symbol), stufe: .karte) }
                }
                .frame(width: 28, height: 28).foregroundStyle(Color.secondary).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 1) {
                    Text(titel).font(.system(size: 14, weight: .medium))
                    Text(text).font(.system(size: 12)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                if erledigt {
                    KSymbol(name: "checkmark.circle.fill").foregroundStyle(.green).accessibilityLabel("erledigt")
                } else {
                    KSymbol(name: "chevron.right").foregroundStyle(.tertiary).accessibilityHidden(true)
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 9)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(titel). \(text)\(erledigt ? ". Erledigt" : "")")
    }
}
