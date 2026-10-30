import SwiftUI
import AppKit

/// Das Fenster „Schnell erfassen“: Umschalter Aufgabe | Notiz, ein mehrzeiliges Feld, bei Aufgaben Priorität und Fälligkeit, Ziel-Vault,
/// ↩ speichert. Alles Verhalten steckt in `ErfassenModell`; hier steht nur die Darstellung (Akzent und Symbole wie im Rest von Kortex).
/// Die Höhe ist fest, damit das Fenster beim Umschalten und bei Meldungen nicht springt.
public struct ErfassenAnsicht: View {
    @ObservedObject var m: ErfassenModell
    @State private var hilfe = false

    public static let breite: CGFloat = 560
    public static let hoehe: CGFloat = 276

    public init(modell: ErfassenModell) { m = modell }

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            kopf
            eingabe
            if m.art == .aufgabe { aufgabenZeile } else { notizZeile }
            meldung
            fuss
        }
        .padding(16)
        .frame(width: Self.breite, height: Self.hoehe, alignment: .topLeading)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Color.primary.opacity(0.10)))
        .tint(KortexFarbe.akzent)
        .onExitCommand { m.schliesse() }
    }

    // MARK: Kopf

    private var kopf: some View {
        HStack(spacing: 10) {
            Picker("Art", selection: $m.art) {
                ForEach(ErfassungsArt.allCases, id: \.self) { Text($0.name).tag($0) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .frame(width: 180)
            .help("Aufgabe: kommt aufs Board. Notiz: landet im Posteingang.")
            Spacer(minLength: 8)
            vaultAuswahl
        }
    }

    @ViewBuilder private var vaultAuswahl: some View {
        if m.vaults.count > 1 {
            Menu {
                ForEach(m.vaults) { v in
                    Button { m.zielPfad = v.id } label: {
                        if v.id == m.zielPfad { Label(v.name, systemImage: "checkmark") } else { Text(v.name) }
                    }
                }
            } label: {
                Label(m.ziel?.name ?? "Vault wählen", systemImage: "folder")
            }
            .menuStyle(.borderlessButton)
            .tint(Color.secondary)
            .fixedSize()
            .help("In welchen Vault gespeichert wird")
        } else {
            Label(m.ziel?.name ?? "Kein Vault", systemImage: "folder")
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .help("Ziel: der aktive Vault")
        }
    }

    // MARK: Eingabe

    private var eingabe: some View {
        ZStack(alignment: .topLeading) {
            ErfassenTextfeld(text: $m.text, fokusAnfrage: m.fokusAnfrage, beiAenderung: { m.eingabeGeaendert() },
                             beiSpeichern: { Task { await m.speichere() } }, beiEsc: { m.schliesse() })
            if m.text.isEmpty {
                Text(m.art == .aufgabe ? "Was willst du nicht vergessen? z. B. „Steuer machen morgen !hoch“" : "Ein Gedanke, eine Idee … landet im Posteingang.")
                    .font(.system(size: 16))
                    .foregroundStyle(.tertiary)
                    .allowsHitTesting(false)
            }
        }
        .padding(10)
        .frame(height: 96)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color(nsColor: .textBackgroundColor).opacity(0.55)))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Color.primary.opacity(0.12)))
    }

    // MARK: Aufgabe: Priorität und Fälligkeit

    private var aufgabenZeile: some View {
        HStack(spacing: 8) {
            let e = m.entwurf
            let prio = m.wirksamePrioritaet
            chipMitAus(
                aktiv: prio != nil && prio != .normal, erkannt: m.prioritaetWahl == nil && e.prioritaetWort != nil,
                aus: { m.erkennePrioritaet = false }, ausHilfe: "„\(e.prioritaetWort ?? "")“ als Text lassen"
            ) {
                Menu {
                    Button("Automatisch (aus dem Text)") { m.prioritaetWahl = nil }
                    Divider()
                    ForEach(ErfassungsPrioritaet.allCases, id: \.self) { p in
                        Button { m.prioritaetWahl = p } label: {
                            if m.prioritaetWahl == p { Label(p.name, systemImage: "checkmark") } else { Text(p.name) }
                        }
                    }
                } label: {
                    Label(prio.map { "Priorität: \($0.name)" } ?? "Priorität", systemImage: "flag")
                }
            }
            let faellig = m.wirksameFaelligkeit
            chipMitAus(
                aktiv: faellig != nil, erkannt: m.faelligWahl == .automatisch && e.faelligWort != nil,
                aus: { m.erkenneFaelligkeit = false }, ausHilfe: "„\(e.faelligWort ?? "")“ als Text lassen"
            ) {
                Menu {
                    Button("Automatisch (aus dem Text)") { m.faelligWahl = .automatisch }
                    Divider()
                    Button("Heute") { m.faelligWahl = .datum(m.isoIn(tage: 0)) }
                    Button("Morgen") { m.faelligWahl = .datum(m.isoIn(tage: 1)) }
                    Button("Nächste Woche") { m.faelligWahl = m.naechsteWoche().map { .datum($0) } ?? .automatisch }
                    Divider()
                    Button("Kein Datum") { m.faelligWahl = .keine }
                } label: {
                    Label(faellig.map { "Fällig: \(m.faelligText($0))" } ?? "Fällig", systemImage: "calendar")
                }
            }
            Spacer(minLength: 4)
            Button { hilfe.toggle() } label: { Image(systemName: "questionmark.circle") }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .help("Kurzformen im Text")
                .accessibilityLabel("Kurzformen im Text")
                .popover(isPresented: $hilfe, arrowEdge: .bottom) { kurzformenHilfe }
        }
        .frame(height: 26)
    }

    private var kurzformenHilfe: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Kurzformen in der ersten Zeile").font(.headline)
            ForEach(Kurzformen.regeln, id: \.self) { Text($0).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
        }
        .padding(14)
        .frame(width: 380, alignment: .leading)
    }

    /// Ein Wähler als Kapsel; ist der Wert aus dem Text erkannt, steht daneben ein Knopf „als Text lassen“.
    private func chipMitAus<Inhalt: View>(aktiv: Bool, erkannt: Bool, aus: @escaping () -> Void, ausHilfe: String,
                                          @ViewBuilder _ inhalt: () -> Inhalt) -> some View {
        HStack(spacing: 4) {
            inhalt()
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
                .tint(aktiv ? KortexFarbe.akzent : Color.secondary)
                .fixedSize()
            if erkannt {
                Button(action: aus) { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }
                    .buttonStyle(.plain)
                    .help(ausHilfe)
                    .accessibilityLabel(ausHilfe)
            }
        }
        .font(.callout)
        .foregroundStyle(aktiv ? KortexFarbe.akzent : Color.secondary)
        .padding(.horizontal, 10)
        .padding(.vertical, 3)
        .background(Capsule().fill(aktiv ? KortexFarbe.akzent.opacity(0.14) : Color.primary.opacity(0.06)))
    }

    private var notizZeile: some View {
        Label("Kommt in den Posteingang. Erst /ingest macht daraus Wissen.", systemImage: "tray")
            .font(.callout)
            .foregroundStyle(.secondary)
            .frame(height: 26, alignment: .leading)
    }

    // MARK: Meldung

    /// Eine feste Zeile (zwei Textzeilen hoch) für Hinweis, Fehler, „Speichert …“ und „Gespeichert in …“ — Zustand immer mit Symbol UND Text.
    @ViewBuilder private var meldung: some View {
        Group {
            if m.kuerzelAendern {
                kuerzelAufnahme
            } else {
                switch m.zustand {
                case .speichert:
                    HStack(spacing: 8) { ProgressView().controlSize(.small); Text("Speichert …") }.foregroundStyle(.secondary)
                case .gespeichert(let vault):
                    Label("Gespeichert in „\(vault)“", systemImage: "checkmark.circle.fill").foregroundStyle(KortexFarbe.akzent)
                case .fehler(let text):
                    Label(text, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                case .bereit:
                    if let h = m.zielHinweis ?? m.kuerzelMeldung {
                        Label(h, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                    } else {
                        Label("↩ speichert · ⇧↩ neue Zeile · esc schließt", systemImage: "info.circle").foregroundStyle(.secondary)
                    }
                }
            }
        }
        .font(.callout)
        .labelStyle(.titleAndIcon)
        .frame(maxWidth: .infinity, minHeight: 34, maxHeight: 34, alignment: .topLeading)
    }

    private var kuerzelAufnahme: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Image(systemName: "keyboard")
                Text("Drücke das neue Kürzel …")
                Spacer()
                Text("esc bricht ab · ⌫ stellt \(Tastenkuerzel.standard.anzeige) wieder her").font(.caption).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 8)
            .frame(height: 24)
            .background(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(KortexFarbe.akzent, lineWidth: 1.5))
            .overlay(
                KuerzelAufnahme(beiWahl: { m.waehleKuerzel($0) }, beiAbbruch: { m.beendeKuerzelAendern() },
                                beiStandard: { m.waehleKuerzel(.standard) })
                    .opacity(0.02)
            )
            if let t = m.kuerzelMeldung {
                Label(t, systemImage: "exclamationmark.triangle.fill").font(.caption).foregroundStyle(.orange).lineLimit(2)
            }
        }
    }

    // MARK: Fuß

    private var fuss: some View {
        HStack(spacing: 12) {
            Label("Diktat: Fn zweimal drücken", systemImage: "mic")
                .font(.caption)
                .foregroundStyle(.secondary)
                .help("Das macOS-Diktat (Tastatur-Einstellungen → Diktat) schreibt direkt in dieses Feld.")
            Button { m.kuerzelAendern.toggle(); m.kuerzelMeldung = nil } label: {
                Label(m.kuerzel.anzeige, systemImage: "keyboard")
                    .font(.caption)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .help("Tastenkürzel zum Öffnen dieses Fensters — klicken zum Ändern")
            Spacer(minLength: 8)
            Button { Task { await m.speichere() } } label: {
                HStack(spacing: 6) {
                    Text("Speichern")
                    Image(systemName: "return")
                }
            }
            .buttonStyle(ErfassenKnopf())
            .disabled(!m.kannSpeichern)
        }
    }
}

/// Hauptknopf wie `KortexHauptKnopf` der App: Akzentfläche, Beschriftung mit gutem Kontrast in beiden Erscheinungsbildern.
struct ErfassenKnopf: ButtonStyle {
    @Environment(\.isEnabled) private var aktiv

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .foregroundStyle(KortexFarbe.akzentText)
            .padding(.horizontal, 14)
            .padding(.vertical, 5)
            .background(KortexFarbe.akzent.opacity(configuration.isPressed ? 0.78 : 1), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .opacity(aktiv ? 1 : 0.4)
            .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}
