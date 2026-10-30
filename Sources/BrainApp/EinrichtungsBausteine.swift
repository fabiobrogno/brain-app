import SwiftUI
import BrainCore

// Gemeinsame Bausteine des Assistenten „Kortex einrichten“: ruhige Flächen, ein Akzent, wenig Text. Alle Farben kommen aus dem System
// (Hell/Dunkel folgt von selbst), alle Ecken sind „continuous“ wie bei macOS 26.

enum AssistentMass {
    static let eckenGross: CGFloat = 14
    static let eckenKlein: CGFloat = 10
    static let abstand: CGFloat = 16
}

/// Kopf eines Schritts: Symbol in einem getönten Kreis, Überschrift, ein kurzer Satz.
struct Titel: View {
    let symbol: String
    let titel: String
    let text: String?

    var body: some View {
        VStack(spacing: 8) {
            ZStack {
                Circle().fill(Kortex.akzent.opacity(0.14))
                Image(systemName: symbol).font(.system(size: 22, weight: .medium)).foregroundStyle(Kortex.akzent)
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
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange).accessibilityHidden(true)
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
            Image(systemName: "info.circle.fill").foregroundStyle(Kortex.akzent).accessibilityHidden(true)
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
    let aktion: () -> Void
    var haupt = true

    var body: some View {
        if haupt {
            Button(action: aktion) { Text(titel).frame(minWidth: 220) }
                .buttonStyle(.kortexHaupt).controlSize(.large).keyboardShortcut(.defaultAction)
        } else {
            Button(action: aktion) { Text(titel).frame(minWidth: 220) }.controlSize(.large)
        }
    }
}

/// Auswahlkarte mit Kreis (offen/gewählt). Nur die Kopfzeile ist ein Knopf; der Inhalt darunter hat seine eigenen Bedienelemente.
struct Karte<Inhalt: View>: View {
    let symbol: String
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
                    Image(systemName: symbol).font(.title3).frame(width: 28).foregroundStyle(Kortex.akzent).accessibilityHidden(true)
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
                    Image(systemName: offen ? "largecircle.fill.circle" : "circle")
                        .foregroundStyle(offen ? Kortex.akzent : Color.secondary.opacity(0.6))
                        .accessibilityHidden(true)
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
