import SwiftUI
import AppKit
import BrainCore

/// Gemeinsame Gestaltung der App: EINE Akzentfarbe für Assistent, Rückfragen, Dialoge und Knöpfe — dieselbe wie im Studio
/// (`--akzent` in `Ressourcen/studio/studio.css`). Die Werte stehen in `BrainCore/KortexFarben.swift` (dort auch der Kontrast-Test);
/// hier werden sie nur zu SwiftUI-Farben, die dem Erscheinungsbild (hell/dunkel) von selbst folgen.
///
/// Warum Code und kein Asset-Katalog: Das Paket entsteht mit SwiftPM und `scripts/baue-app.sh` (kein Xcode-Projekt, kein `actool`).
/// Eine dynamische `NSColor` leistet im Code dasselbe, und ein Test bindet die Werte an das Studio.
/// Grenze: Systemelemente, die nicht SwiftUI sind (Knöpfe in `NSAlert`, Fokusring im Dateidialog), folgen der Akzentfarbe des Systems.
enum Kortex {
    /// Akzent als Fläche, Linie oder Schrift. Hell `#5B4ED6`, dunkel `#A89FFF`.
    static let akzent = dynamisch(hell: KortexFarben.akzentHell, dunkel: KortexFarben.akzentDunkel)
    /// Beschriftung auf einer Akzent-Fläche (Kontrast ≥ 4,5 : 1 in beiden Erscheinungsbildern).
    static let akzentText = dynamisch(hell: KortexFarben.akzentTextHell, dunkel: KortexFarben.akzentTextDunkel)

    static func nsFarbe(hell: String, dunkel: String) -> NSColor {
        NSColor(name: nil) { erscheinung in
            let istDunkel = erscheinung.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            return farbe(istDunkel ? dunkel : hell)
        }
    }

    private static func dynamisch(hell: String, dunkel: String) -> Color { Color(nsColor: nsFarbe(hell: hell, dunkel: dunkel)) }

    private static func farbe(_ hex: String) -> NSColor {
        let c = KortexFarben.komponenten(hex) ?? (0, 0, 0)
        return NSColor(srgbRed: c.r, green: c.g, blue: c.b, alpha: 1)
    }
}

/// Hauptknopf: Akzent-Fläche mit Beschriftung in `akzentText` (statt `.borderedProminent`, dessen weiße Schrift auf dem hellen
/// Dunkel-Akzent den Kontrast verfehlen würde). Größe folgt `controlSize`; mit `.keyboardShortcut(.defaultAction)` wie jeder Knopf.
struct KortexHauptKnopf: ButtonStyle {
    @Environment(\.isEnabled) private var aktiv
    @Environment(\.controlSize) private var groesse

    func makeBody(configuration: Configuration) -> some View {
        let (h, v): (CGFloat, CGFloat) = switch groesse {
        case .mini, .small: (10, 3)
        case .large, .extraLarge: (18, 7)
        default: (14, 4)
        }
        configuration.label
            .font(.body.weight(.semibold))
            .foregroundStyle(Kortex.akzentText)
            .padding(.horizontal, h)
            .padding(.vertical, v)
            .background(Kortex.akzent.opacity(configuration.isPressed ? 0.78 : 1), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .opacity(aktiv ? 1 : 0.4)
            .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

/// Textknopf (Link-Optik) in der Akzentfarbe: `.link` des Systems nähme das Systemblau, `.tint` wirkt darauf nicht.
struct KortexLinkKnopf: ButtonStyle {
    @Environment(\.isEnabled) private var aktiv

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(Kortex.akzent)
            .opacity(aktiv ? (configuration.isPressed ? 0.7 : 1) : 0.4)
            .contentShape(Rectangle())
    }
}

extension ButtonStyle where Self == KortexLinkKnopf {
    static var kortexLink: KortexLinkKnopf { KortexLinkKnopf() }
}

extension ButtonStyle where Self == KortexHauptKnopf {
    /// Der Hauptknopf eines Dialogs („Weiter“, „Anlegen“, „Verbinden“).
    static var kortexHaupt: KortexHauptKnopf { KortexHauptKnopf() }
}

extension View {
    /// Setzt die Kortex-Akzentfarbe für alle Bedienelemente darunter (Fortschrittsanzeigen, Schalter, Auswahl, Links).
    func kortexAkzent() -> some View { tint(Kortex.akzent) }
}

/// Das K der App als einfarbiges Menüleisten-Bild (Template: das System färbt es hell/dunkel). Aus den Strichen der Kleinvariante des
/// Icons (`Ressourcen/icon-entwuerfe/kortex-c-k-klein.svg`) gezeichnet, ohne Fläche — bei 18 pt kräftig genug zum Erkennen.
@MainActor
enum KortexMenueBild {
    static let k: NSImage = zeichne(punkt: 18)

    /// Auch für die Bildprüfung in beliebiger Größe.
    static func zeichne(punkt: CGFloat) -> NSImage {
        let bild = NSImage(size: NSSize(width: punkt, height: punkt), flipped: false) { rect in
            // SVG-Raum 1024: Striche von (284, 210) bis (762, 814) samt Linienbreite; auf 88 % der Höhe skaliert, mittig.
            let hoehe = 604.0, breite = 478.0
            let s = rect.height * 0.88 / hoehe
            let ox = rect.midX - (284 + breite / 2) * s
            let oy = rect.midY + (210 + hoehe / 2) * s
            func p(_ x: Double, _ y: Double) -> NSPoint { NSPoint(x: ox + x * s, y: oy - y * s) }
            let pfad = NSBezierPath()
            pfad.move(to: p(352, 278)); pfad.line(to: p(352, 746))
            pfad.move(to: p(376, 536)); pfad.curve(to: p(694, 300), controlPoint1: p(470, 520), controlPoint2: p(570, 450))
            pfad.move(to: p(430, 560)); pfad.line(to: p(690, 746))
            pfad.lineWidth = 136 * s
            pfad.lineCapStyle = .round
            pfad.lineJoinStyle = .round
            NSColor.black.setStroke()
            pfad.stroke()
            return true
        }
        bild.isTemplate = true
        return bild
    }
}
