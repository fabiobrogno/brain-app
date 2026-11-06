import Foundation

/// Was die App tut, wenn der WebContent-Prozess eines Fensters beendet wurde (Absturz, Speicherdruck, vom System beendet): `webViewWebContentProcessDidTerminate`.
/// Das Fenster wäre sonst leer, und alles, was seit dem letzten Speichern getippt wurde, nur noch im Entwurfs-Journal der Werkstatt (`<Support>/entwuerfe/…`).
/// Die App lädt die Oberfläche neu; das Studio erkennt die Marke `nachAbsturz=1` in der Adresse, sagt es dem Nutzer und bietet den Entwurf aus dem Journal an
/// („Ungespeicherten Text wiederherstellen“). Bricht der Prozess immer wieder ab, wird nicht endlos neu geladen (Schleife), sondern die Fehlerseite gezeigt.
public enum WebAbsturzAntwort: Equatable, Sendable {
    /// Diese Adresse (Startseite plus Marke) laden.
    case neuLaden(URL)
    /// Zu viele Abstürze in kurzer Zeit: nicht noch einmal laden, die Fehlerseite zeigen.
    case fehlerseite
}

public struct WebProzessSchutz: Sendable {
    /// Name des Abfrage-Parameters, den das Studio auswertet.
    public static let marke = "nachAbsturz"
    public let hoechstens: Int
    public let fenster: TimeInterval
    private var zeiten: [Date] = []

    /// Höchstens `hoechstens` Neuladungen innerhalb von `fenster` Sekunden (wie in der Orca-Vorlage: nicht mehr als 3 in 60 s).
    public init(hoechstens: Int = 3, innerhalb fenster: TimeInterval = 60) {
        self.hoechstens = max(1, hoechstens)
        self.fenster = fenster
    }

    /// Die Adresse mit Marke; eine vorhandene Abfrage bleibt, die Marke steht nie doppelt.
    public static func mitMarke(_ url: URL) -> URL {
        guard var teile = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
        var items = (teile.queryItems ?? []).filter { $0.name != marke }
        items.append(URLQueryItem(name: marke, value: "1"))
        teile.queryItems = items
        return teile.url ?? url
    }

    /// Ein Absturz wurde gemeldet.
    public mutating func beiAbsturz(startURL: URL, jetzt: Date = Date()) -> WebAbsturzAntwort {
        zeiten = zeiten.filter { jetzt.timeIntervalSince($0) < fenster }
        guard zeiten.count < hoechstens else { return .fehlerseite }
        zeiten.append(jetzt)
        return .neuLaden(Self.mitMarke(startURL))
    }
}

/// Was die Behandlung mit der WebView tun darf (in der App `WKWebView`, im Test eine Attrappe — so lässt sich ein Absturz ohne WebKit nachstellen).
@MainActor
public protocol WebLader: AnyObject {
    func lade(_ url: URL)
    func zeigeFehlerseite(startURL: URL)
}

/// Verbindet den Schutz mit der WebView und dem Protokoll. `prozessBeendet()` ruft die App aus `webViewWebContentProcessDidTerminate`.
@MainActor
public final class WebAbsturzBehandlung {
    private var schutz: WebProzessSchutz
    private let startURL: URL
    private weak var lader: WebLader?
    private let schreibe: (String) -> Void
    private let jetzt: () -> Date
    /// Wie oft der Prozess bisher beendet wurde (für Tests und Diagnose).
    public private(set) var abstuerze = 0

    public init(startURL: URL, schutz: WebProzessSchutz = WebProzessSchutz(), lader: WebLader, schreibe: @escaping (String) -> Void = { _ in },
                jetzt: @escaping () -> Date = Date.init) {
        self.startURL = startURL
        self.schutz = schutz
        self.lader = lader
        self.schreibe = schreibe
        self.jetzt = jetzt
    }

    public func prozessBeendet() {
        abstuerze += 1
        switch schutz.beiAbsturz(startURL: startURL, jetzt: jetzt()) {
        case .neuLaden(let url):
            schreibe("webprozess-beendet neu-laden \(abstuerze)")
            lader?.lade(url)
        case .fehlerseite:
            schreibe("webprozess-beendet fehlerseite \(abstuerze)")
            lader?.zeigeFehlerseite(startURL: startURL)
        }
    }
}
