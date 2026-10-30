import SwiftUI
import AppKit

extension Tastenkuerzel {
    /// Aus einem Tastendruck (Aufnahmefeld): Taste und gehaltene Umschalttasten.
    public static func ausEreignis(code: UInt16, flags: NSEvent.ModifierFlags) -> Tastenkuerzel {
        var u: Umschalter = []
        if flags.contains(.control) { u.insert(.control) }
        if flags.contains(.option) { u.insert(.option) }
        if flags.contains(.shift) { u.insert(.shift) }
        if flags.contains(.command) { u.insert(.command) }
        return Tastenkuerzel(taste: UInt32(code), umschalter: u)
    }
}

/// Mehrzeiliges Eingabefeld für „Schnell erfassen“ (Klartext): ↩ speichert, ⇧↩ macht eine neue Zeile, Esc schließt. Ein eigenes
/// AppKit-Feld statt `TextEditor`, damit ↩ und Esc verlässlich ankommen und die Kopier-/Einsetz-Kürzel auch dann gehen, wenn das Fenster
/// als Panel über einer anderen App liegt (die Menüzeile „Bearbeiten“ gehört dann nicht zu Kortex). Das macOS-Diktat (Fn zweimal) und die
/// Systemtastenkürzel des Textfelds funktionieren wie in jedem Textfeld.
struct ErfassenTextfeld: NSViewRepresentable {
    @Binding var text: String
    var fokusAnfrage: Int
    var beiAenderung: () -> Void
    var beiSpeichern: () -> Void
    var beiEsc: () -> Void

    func makeCoordinator() -> Koordinator { Koordinator(self) }

    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSScrollView()
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.borderType = .noBorder
        let tv = FeldTextView()
        tv.isRichText = false
        tv.importsGraphics = false
        tv.allowsUndo = true
        tv.drawsBackground = false
        tv.font = .systemFont(ofSize: 16)
        tv.textColor = .labelColor
        tv.insertionPointColor = KortexFarbe.nsFarbe(hell: KortexFarben.akzentHell, dunkel: KortexFarben.akzentDunkel)
        tv.textContainerInset = .zero
        tv.textContainer?.lineFragmentPadding = 0
        tv.isAutomaticQuoteSubstitutionEnabled = false
        tv.isAutomaticDashSubstitutionEnabled = false
        tv.isAutomaticTextReplacementEnabled = false
        tv.isVerticallyResizable = true
        tv.isHorizontallyResizable = false
        tv.autoresizingMask = [.width]
        tv.textContainer?.widthTracksTextView = true
        tv.string = text
        tv.delegate = context.coordinator
        tv.beiEsc = { context.coordinator.eltern.beiEsc() }
        scroll.documentView = tv
        context.coordinator.textView = tv
        return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        let k = context.coordinator
        k.eltern = self
        guard let tv = k.textView else { return }
        if tv.string != text { tv.string = text }
        if k.letzteAnfrage != fokusAnfrage {
            k.letzteAnfrage = fokusAnfrage
            DispatchQueue.main.async { tv.window?.makeFirstResponder(tv) }
        }
    }

    @MainActor
    final class Koordinator: NSObject, NSTextViewDelegate {
        var eltern: ErfassenTextfeld
        weak var textView: FeldTextView?
        var letzteAnfrage = -1

        init(_ eltern: ErfassenTextfeld) { self.eltern = eltern }

        func textDidChange(_ notification: Notification) {
            guard let tv = notification.object as? NSTextView else { return }
            eltern.text = tv.string
            eltern.beiAenderung()
        }

        func textView(_ tv: NSTextView, doCommandBy befehl: Selector) -> Bool {
            if befehl == #selector(NSResponder.insertNewline(_:)) {
                if NSApp.currentEvent?.modifierFlags.contains(.shift) == true { tv.insertNewlineIgnoringFieldEditor(nil) } else { eltern.beiSpeichern() }
                return true
            }
            if befehl == #selector(NSResponder.cancelOperation(_:)) { eltern.beiEsc(); return true }
            return false
        }
    }
}

/// Textansicht, die auch ohne aktive App Kopieren/Einsetzen/Widerrufen versteht und beim Erscheinen den Fokus nimmt.
final class FeldTextView: NSTextView {
    var beiEsc: (() -> Void)?

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if window != nil { DispatchQueue.main.async { [weak self] in self?.window?.makeFirstResponder(self) } }
    }

    override func performKeyEquivalent(with ereignis: NSEvent) -> Bool {
        guard ereignis.type == .keyDown, window?.firstResponder === self else { return super.performKeyEquivalent(with: ereignis) }
        let flags = ereignis.modifierFlags.intersection(.deviceIndependentFlagsMask).subtracting([.capsLock, .numericPad, .function])
        guard flags.contains(.command), !flags.contains(.control), !flags.contains(.option),
              let taste = ereignis.charactersIgnoringModifiers?.lowercased() else { return super.performKeyEquivalent(with: ereignis) }
        switch (taste, flags) {
        case ("v", [.command]): pasteAsPlainText(nil)
        case ("c", [.command]): copy(nil)
        case ("x", [.command]): cut(nil)
        case ("a", [.command]): selectAll(nil)
        case ("z", [.command]): undoManager?.undo()
        case ("z", [.command, .shift]): undoManager?.redo()
        case ("w", [.command]): beiEsc?()
        default: return super.performKeyEquivalent(with: ereignis)
        }
        return true
    }

    /// Einfügen immer als Klartext (kein Format aus Webseiten oder Mail).
    override func paste(_ sender: Any?) { pasteAsPlainText(sender) }
}

/// Feld zum Aufnehmen eines neuen Tastenkürzels: nimmt den Fokus, zeigt den nächsten Tastendruck als Kürzel. Esc bricht ab, ⌫ stellt den
/// Standard wieder her. Reine Umschalttasten allein zählen nicht (erst die Taste dazu).
struct KuerzelAufnahme: NSViewRepresentable {
    var beiWahl: (Tastenkuerzel) -> Void
    var beiAbbruch: () -> Void
    var beiStandard: () -> Void

    func makeNSView(context: Context) -> AufnahmeView {
        let v = AufnahmeView()
        v.aktualisiere(self)
        return v
    }

    func updateNSView(_ v: AufnahmeView, context: Context) { v.aktualisiere(self) }

    final class AufnahmeView: NSView {
        private var wahl: ((Tastenkuerzel) -> Void)?
        private var abbruch: (() -> Void)?
        private var standard: (() -> Void)?

        func aktualisiere(_ a: KuerzelAufnahme) {
            wahl = a.beiWahl
            abbruch = a.beiAbbruch
            standard = a.beiStandard
        }

        override var acceptsFirstResponder: Bool { true }

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            if window != nil { DispatchQueue.main.async { [weak self] in self?.window?.makeFirstResponder(self) } }
        }

        override func keyDown(with e: NSEvent) { verarbeite(e) }

        override func performKeyEquivalent(with e: NSEvent) -> Bool {
            guard window?.firstResponder === self else { return false }
            verarbeite(e)
            return true
        }

        private func verarbeite(_ e: NSEvent) {
            if e.keyCode == 53 { abbruch?(); return }
            if e.keyCode == 51 { standard?(); return }
            wahl?(Tastenkuerzel.ausEreignis(code: e.keyCode, flags: e.modifierFlags))
        }
    }
}
