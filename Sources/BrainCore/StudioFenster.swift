import Foundation
import CoreGraphics

/// Maße und Namen des Studio-Fensters (Studio-v2-Spec §1/§2): Mindestgröße 1100×700, Standard 1440×900 beim ersten Start.
/// Alle Größen sind Fenstergrößen (mit Titelleiste).
public enum StudioFenster {
    public static let minimum = CGSize(width: 1100, height: 700)
    public static let standard = CGSize(width: 1440, height: 900)
    /// Titel, bis die Oberfläche den Namen des aktiven Vaults meldet (Aktion `titel`).
    public static let standardTitel = "Brain Studio"
    /// Name der automatisch gemerkten Fensterposition (AppKit speichert sie unter „NSWindow Frame <Name>“).
    public static let rahmenName = "StudioFenster"

    /// Erster Start: Standardgröße, aber nie größer als der sichtbare Bildschirm — und nie unter dem Minimum.
    public static func startgroesse(sichtbar: CGSize) -> CGSize {
        mindestens(CGSize(width: min(standard.width, sichtbar.width), height: min(standard.height, sichtbar.height)))
    }

    /// Eine gemerkte Größe aus einer älteren Version (Minimum war 900×600) wird auf das heutige Minimum angehoben.
    public static func mindestens(_ groesse: CGSize) -> CGSize {
        CGSize(width: max(groesse.width, minimum.width), height: max(groesse.height, minimum.height))
    }
}
