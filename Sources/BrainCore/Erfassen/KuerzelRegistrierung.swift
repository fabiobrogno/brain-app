import Foundation
import Carbon.HIToolbox

public enum KuerzelFehler: Error, Equatable, Sendable {
    /// Ein anderes Programm (oder macOS) hat das Kürzel schon (`eventHotKeyExistsErr`).
    case belegt
    case system(Int32)

    public var text: String {
        switch self {
        case .belegt: return "Dieses Kürzel ist schon von einem anderen Programm belegt."
        case .system(let code): return "Das Kürzel ließ sich nicht anmelden (Fehler \(code))."
        }
    }
}

/// Meldet ein globales Tastenkürzel beim System an. Eine Schnittstelle, damit Tests ohne echtes Kürzel auskommen.
@MainActor
public protocol KuerzelRegistrierung: AnyObject {
    /// Meldet das Kürzel an (ein vorher angemeldetes wird zuerst abgemeldet). `aktion` läuft im Hauptthread bei jedem Druck.
    func registriere(_ kuerzel: Tastenkuerzel, aktion: @escaping @MainActor () -> Void) throws
    func hebeAuf()
}

/// Globales Kürzel über Carbon (`RegisterEventHotKey`). Das braucht KEIN Recht (weder „Bedienungshilfen“ noch „Eingabeüberwachung“):
/// Das System liefert nur den Druck genau dieses Kürzels an die App, es werden keine Tasten mitgelesen. Das Kürzel gilt auch, wenn
/// das Studio geschlossen ist oder eine andere App vorn liegt — die App muss nur laufen.
@MainActor
public final class CarbonKuerzel: KuerzelRegistrierung {
    private var referenz: EventHotKeyRef?
    private var handler: EventHandlerRef?
    private var aktion: (@MainActor () -> Void)?
    /// Vier Zeichen, die unsere Kürzel im System kennzeichnen ('KTXE').
    private static let signatur: OSType = 0x4B54_5845
    /// Nummer dieses Kürzels (jedes globale Kürzel der App hat eine eigene; der Handler hört nur auf seine).
    private let kennung: UInt32

    public init(kennung: UInt32 = 1) { self.kennung = kennung }

    /// Ein Objekt, das verschwindet (z. B. nach einer gescheiterten Anmeldung), nimmt sein Kürzel UND seinen Handler mit: Ein Handler, der auf ein freigegebenes Objekt zeigt,
    /// würde beim nächsten Druck ins Leere greifen (und die Adresse könnte ein neues Objekt bekommen → „Handler schon installiert“).
    deinit {
        if let referenz { UnregisterEventHotKey(referenz) }
        if let handler { RemoveEventHandler(handler) }
    }

    public func registriere(_ kuerzel: Tastenkuerzel, aktion: @escaping @MainActor () -> Void) throws {
        hebeAuf()
        try installiereHandler()
        var neu: EventHotKeyRef?
        let status = RegisterEventHotKey(kuerzel.taste, kuerzel.carbonUmschalter, EventHotKeyID(signature: Self.signatur, id: kennung),
                                         GetApplicationEventTarget(), 0, &neu)
        guard status == noErr, let neu else { throw status == OSStatus(eventHotKeyExistsErr) ? KuerzelFehler.belegt : KuerzelFehler.system(status) }
        referenz = neu
        self.aktion = aktion
    }

    public func hebeAuf() {
        if let referenz { UnregisterEventHotKey(referenz) }
        referenz = nil
        aktion = nil
    }

    /// Einmal pro Objekt: der Ereignis-Handler, der den Druck an `aktion` weitergibt.
    private func installiereHandler() throws {
        guard handler == nil else { return }
        var art = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let status = InstallEventHandler(GetApplicationEventTarget(), { _, ereignis, nutzer in
            guard let nutzer, let ereignis else { return OSStatus(eventNotHandledErr) }
            var id = EventHotKeyID()
            let s = GetEventParameter(ereignis, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil,
                                      MemoryLayout<EventHotKeyID>.size, nil, &id)
            guard s == noErr, id.signature == CarbonKuerzel.signatur else { return OSStatus(eventNotHandledErr) }
            let selbst = Unmanaged<CarbonKuerzel>.fromOpaque(nutzer).takeUnretainedValue()
            guard id.id == selbst.kennung else { return OSStatus(eventNotHandledErr) } // ein anderes unserer Kürzel: der nächste Handler ist dran
            MainActor.assumeIsolated { selbst.aktion?() }
            return noErr
        }, 1, &art, Unmanaged.passUnretained(self).toOpaque(), &handler)
        guard status == noErr else { throw KuerzelFehler.system(status) }
    }
}
