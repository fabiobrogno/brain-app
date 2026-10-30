import Foundation
import CoreGraphics

/// Wo das Fenster „Schnell erfassen“ erscheint: waagerecht mittig, oben im sichtbaren Bereich des Bildschirms (unter der Menüleiste).
public enum ErfassenPlatzierung {
    /// `sichtbar` = `NSScreen.visibleFrame` (Koordinaten von AppKit: Ursprung unten links). Der Abstand nach oben wächst mit der Höhe
    /// des Bildschirms (14 %), bleibt aber zwischen 48 und 180 Punkten; das Fenster liegt immer ganz im sichtbaren Bereich.
    public static func rahmen(sichtbar: CGRect, groesse: CGSize) -> CGRect {
        let abstand = min(180, max(48, sichtbar.height * 0.14))
        var x = sichtbar.midX - groesse.width / 2
        var y = sichtbar.maxY - abstand - groesse.height
        x = max(sichtbar.minX, min(x, sichtbar.maxX - groesse.width))
        y = max(sichtbar.minY, min(y, sichtbar.maxY - groesse.height))
        return CGRect(x: x.rounded(), y: y.rounded(), width: groesse.width, height: groesse.height)
    }
}
