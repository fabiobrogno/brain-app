import Foundation
import CoreGraphics

/// Maße und Namen des Studio-Fensters: Mindestgröße 1100×700; beim ersten Start etwa 85 % der sichtbaren Bildschirmfläche (mindestens
/// 1280×820, höchstens 1800×1150), mittig. Alle Größen sind Fenstergrößen — das Fenster hat eine durchsichtige Titelleiste über dem Inhalt
/// (`fullSizeContentView`), Fenster- und Inhaltsgröße sind also gleich.
public enum StudioFenster {
    public static let minimum = CGSize(width: 1100, height: 700)
    /// Anteil der sichtbaren Bildschirmfläche (ohne Menüleiste und Dock) je Achse beim ersten Start.
    public static let anteil: CGFloat = 0.85
    /// Untergrenze der Startgröße (ein kleinerer Bildschirm gibt sie auf seine sichtbare Fläche ab) und Obergrenze (auf riesigen Bildschirmen wird das Fenster nicht größer).
    public static let startMinimum = CGSize(width: 1280, height: 820)
    public static let startMaximum = CGSize(width: 1800, height: 1150)
    /// Titel, bis die Oberfläche den Namen des aktiven Vaults meldet (Aktion `titel`).
    public static let standardTitel = "Kortex Studio"
    /// Name der automatisch gemerkten Fensterposition (AppKit speichert sie unter „NSWindow Frame <Name>“).
    public static let rahmenName = "StudioFenster"

    /// Erster Start: 85 % der sichtbaren Fläche je Achse, aber mindestens 1280×820 (oder, wenn der Bildschirm kleiner ist, die ganze sichtbare
    /// Fläche), höchstens 1800×1150 — und nie unter dem Fenster-Minimum.
    public static func startgroesse(sichtbar: CGSize) -> CGSize {
        func achse(_ sichtbar: CGFloat, _ unten: CGFloat, _ oben: CGFloat) -> CGFloat {
            let wunsch = (sichtbar * anteil).rounded()
            return min(oben, max(min(unten, sichtbar), wunsch))
        }
        return mindestens(CGSize(width: achse(sichtbar.width, startMinimum.width, startMaximum.width),
                                 height: achse(sichtbar.height, startMinimum.height, startMaximum.height)))
    }

    /// Eine gemerkte Größe aus einer älteren Version (Minimum war 900×600) wird auf das heutige Minimum angehoben.
    public static func mindestens(_ groesse: CGSize) -> CGSize {
        CGSize(width: max(groesse.width, minimum.width), height: max(groesse.height, minimum.height))
    }

    /// Rahmen beim ersten Start: Startgröße, mittig im sichtbaren Bereich des Bildschirms.
    public static func startrahmen(sichtbar: CGRect) -> CGRect {
        FensterGeometrie.mittig(startgroesse(sichtbar: sichtbar.size), in: sichtbar)
    }
}

/// Reine Rechenregeln für Lage und Größe der Kortex-Fenster (ohne AppKit, damit testbar).
public enum FensterGeometrie {
    /// So viel vom oberen Rand des Fensters (Titelleiste) muss mindestens auf einem Bildschirm liegen, damit man es noch greifen kann.
    static let greifbar = CGSize(width: 120, height: 40)

    /// `groesse` mittig in `sichtbar` (nie über den Rand hinaus; ist das Fenster größer, wird die Größe auf die Fläche gekürzt).
    public static func mittig(_ groesse: CGSize, in sichtbar: CGRect) -> CGRect {
        let g = CGSize(width: min(groesse.width, sichtbar.width), height: min(groesse.height, sichtbar.height))
        return CGRect(x: (sichtbar.midX - g.width / 2).rounded(), y: (sichtbar.midY - g.height / 2).rounded(), width: g.width, height: g.height)
    }

    /// Bringt einen gemerkten Rahmen zurück auf einen vorhandenen Bildschirm. `bildschirme` sind die sichtbaren Bereiche (ohne Menüleiste und
    /// Dock) aller angeschlossenen Bildschirme, der erste ist der Hauptbildschirm (Koordinaten wie bei AppKit, y nach oben).
    /// - Liegt der Kopf des Fensters auf einem Bildschirm: das Fenster bleibt dort, wird aber bei Bedarf auf dessen sichtbare Fläche verkleinert
    ///   und ganz hineingeschoben (eine halb abgeschnittene Lage wird nicht „gemerkt“).
    /// - Liegt er auf keinem (der Bildschirm ist weg, die Anordnung hat sich geändert): mittig auf dem Hauptbildschirm, Größe wie gemerkt (gekürzt).
    /// - Ohne Bildschirme (nicht erwartet) bleibt der Rahmen, wie er ist.
    public static func aufBildschirmHolen(_ rahmen: CGRect, bildschirme: [CGRect]) -> CGRect {
        guard let haupt = bildschirme.first, rahmen.width > 0, rahmen.height > 0 else { return rahmen }
        let kopf = CGRect(x: rahmen.minX, y: rahmen.maxY - greifbar.height, width: rahmen.width, height: greifbar.height)
        var bester: (flaeche: CGFloat, schirm: CGRect)?
        for s in bildschirme {
            let i = kopf.intersection(s)
            guard !i.isNull, i.width >= min(greifbar.width, rahmen.width), i.height >= greifbar.height / 2 else { continue }
            let f = i.width * i.height
            if bester == nil || f > bester!.flaeche { bester = (f, s) }
        }
        guard let ziel = bester?.schirm else { return mittig(rahmen.size, in: haupt) }
        let g = CGSize(width: min(rahmen.width, ziel.width), height: min(rahmen.height, ziel.height))
        let x = min(max(rahmen.minX, ziel.minX), ziel.maxX - g.width)
        let y = min(max(rahmen.minY, ziel.minY), ziel.maxY - g.height)
        return CGRect(origin: CGPoint(x: x, y: y), size: g)
    }
}

/// Was ein Doppelklick auf die Titelleiste tut — so, wie es der Nutzer in den Systemeinstellungen („Schreibtisch & Dock“ → „Beim
/// Doppelklicken auf die Titelleiste eines Fensters“) gewählt hat (`AppleActionOnDoubleClick`).
public enum TitelleistenDoppelklick: Equatable, Sendable {
    case zoomen
    case ablegen
    case nichts

    /// `einstellung`: Wert von `AppleActionOnDoubleClick` (nil/unbekannt = Standard „Maximize“ = Zoomen). „Minimize“ legt im Dock ab, „None“ tut nichts.
    public static func aus(einstellung: String?) -> TitelleistenDoppelklick {
        switch einstellung {
        case "Minimize": return .ablegen
        case "None": return .nichts
        default: return .zoomen
        }
    }
}

/// Wo die Ampel (Schließen, Ablegen, Zoomen) im Fenster sitzt und wie viel Platz die Seite ihr links lassen muss.
public enum FensterAmpel {
    /// Höhe der Kopfzeile der Oberfläche (CSS `--kopf-h`): Die Ampel sitzt mittig in dieser Zeile.
    public static let zeile: CGFloat = 44
    /// Abstand der Ampel vom linken Fensterrand (passt zum Innenabstand der Seitenleiste des Studios).
    public static let einzug: CGFloat = 16
    /// Luft zwischen dem Zoom-Knopf und dem, was die Seite rechts daneben zeigt.
    public static let luft: CGFloat = 14

    /// Platz, den die Seite links freihält (CSS `--ampel-platz`): Fensterrand bis rechter Rand des Zoom-Knopfes plus Luft, auf ganze Punkte aufgerundet.
    public static func platz(rechterRandZoom: CGFloat) -> CGFloat { (rechterRandZoom + luft).rounded(.up) }

    /// Senkrechte Lage (von unten gemessen) eines Knopfes der Höhe `knopfHoehe`, mittig in der Zeile am oberen Rand eines Fensters der Höhe `fensterHoehe`.
    public static func untereKante(knopfHoehe: CGFloat, fensterHoehe: CGFloat) -> CGFloat {
        (fensterHoehe - zeile + (zeile - knopfHoehe) / 2).rounded()
    }

    /// Das Skript, mit dem die App der Seite sagt, wie viel Platz die Ampel braucht (0 im Vollbild: dort gibt es keine Ampel im Fenster) und ob dies die Vorschau ist
    /// (`vorschauText` = Text der Plakette, nil = keine) und ob hinter der durchsichtigen Seite ein Material des Systems liegt (`glas`, Seitenleiste durchsichtig). Die Seite liest nur die CSS-Variablen `--ampel-platz`/`--ampel-hoehe` und `data-vorschau` und `data-glas` am `<html>`.
    public static func skript(platz: CGFloat, hoehe: CGFloat, vorschauText: String?, glas: Bool = false) -> String {
        var koerper = "r.style.setProperty('--ampel-platz','\(Int(platz))px');r.style.setProperty('--ampel-hoehe','\(Int(hoehe))px');"
        if let t = vorschauText {
            let sicher = t.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "'", with: "\\'").replacingOccurrences(of: "\n", with: " ")
            koerper += "r.dataset.vorschau='\(sicher)';"
        }
        if glas { koerper += "r.dataset.glas='1';" }
        // Ist das Dokumentelement beim Start noch nicht da, wartet das Skript darauf (statt still nichts zu tun).
        return "(function(){function s(){var r=document.documentElement;\(koerper)}if(document.documentElement){s();}else{new MutationObserver(function(_,o){if(document.documentElement){o.disconnect();s();}}).observe(document,{childList:true});}})();"
    }
}

/// Darstellung des Fensters, wie die Seite sie meldet (Aktion `darstellung`): das Fenster folgt, damit das Material hinter der Seitenleiste zum Hell/Dunkel der Seite passt.
public enum FensterDarstellung: String, Equatable, Sendable, CaseIterable {
    case hell, dunkel, system
}
