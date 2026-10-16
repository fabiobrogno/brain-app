import Foundation

/// Übersetzt zwischen WebKit (brain://-Anfragen, Nachrichten von api.js) und der Ansicht-Brücke.
public enum SchemaAntwort {
    /// Pfad + Query so, wie sie in der URL kodiert sind — die Brücke prüft Punkt-/Schrägstrich-Kodierungen selbst.
    public static func pfad(von url: URL) -> String {
        guard let k = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return "/" }
        let p = k.percentEncodedPath.isEmpty ? "/" : k.percentEncodedPath
        if let q = k.percentEncodedQuery, !q.isEmpty { return p + "?" + q }
        return p
    }

    public static func antwort(url: URL, aus a: BrueckenAntwort) -> HTTPURLResponse {
        var kopf = a.headers
        kopf["Content-Length"] = String(a.body.count)
        return HTTPURLResponse(url: url, statusCode: a.status, httpVersion: "HTTP/1.1", headerFields: kopf)!
    }

    /// Ist das die Startseite (Hauptdokument) der Ansicht?
    public static func istHauptdokument(_ url: URL) -> Bool { ["", "/", "/index.html"].contains(url.path) }

    /// API-Pfade gehören dem Nachrichtenkanal; über das Schema (Seitenabruf) sind sie nicht erreichbar.
    public static func istApiPfad(_ url: URL) -> Bool {
        let p = url.path.lowercased()
        return p == "/api" || p.hasPrefix("/api/")
    }

    /// Kleine Fehlerseite in Alltagssprache, wenn die Ansicht nicht starten kann (statt eines leeren weißen Fensters).
    public static let fehlerSeiteHTML = """
    <!doctype html><html lang="de"><head><meta charset="utf-8"><title>Brain</title>
    <style>body{font:16px -apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;\
    height:100vh;margin:0;background:Canvas;color:CanvasText}main{max-width:30em;text-align:center;padding:2em}\
    .symbol{font-size:3em;color:#c0392b}</style></head><body><main><div class="symbol">&#10005;</div>\
    <p>Die Ansicht konnte nicht starten. Ist der Brain-Ordner noch da und das Kit aktuell?</p></main></body></html>
    """

    public static func fehlerSeite(url: URL) -> (antwort: HTTPURLResponse, body: Data) {
        let body = Data(fehlerSeiteHTML.utf8)
        let kopf = ["Content-Type": "text/html; charset=utf-8", "Content-Length": String(body.count),
                    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'"]
        return (HTTPURLResponse(url: url, statusCode: 503, httpVersion: "HTTP/1.1", headerFields: kopf)!, body)
    }

    /// Antwort für den Nachrichtenkanal von api.js: { status, body } mit body als Text (JSON).
    public static func kanalAntwort(_ a: BrueckenAntwort) -> [String: Any] {
        ["status": a.status, "body": String(decoding: a.body, as: UTF8.self)]
    }

    /// Größter Anfragekörper, den die Brücke annimmt (Kit: MAX_KOERPER); größere lehnt die App gleich ab.
    public static let maxKoerper = 64 * 1024

    public enum AnfrageFehler: Error, Equatable {
        case ungueltig
        case zuGross

        /// Text für api.js (Alltagssprache).
        public var meldung: String {
            switch self {
            case .ungueltig: return "ungültige Anfrage"
            case .zuGross: return "✕ Die Eingabe ist zu groß (mehr als 64 KB)."
            }
        }
    }

    /// Nachricht von api.js → Anfrage an die Brücke. Nur /api/…, nur GET/POST/PUT, Daten als JSON-Objekt, Körper ≤ 64 KB.
    public static func anfrage(ausNachricht nachricht: Any) throws -> (methode: String, pfad: String, body: Data?) {
        guard let d = nachricht as? [String: Any], let pfad = d["pfad"] as? String, pfad.hasPrefix("/api/") else { throw AnfrageFehler.ungueltig }
        let methode = ((d["methode"] as? String) ?? "GET").uppercased()
        guard ["GET", "POST", "PUT"].contains(methode) else { throw AnfrageFehler.ungueltig }
        var body: Data?
        if let daten = d["daten"], !(daten is NSNull) {
            guard JSONSerialization.isValidJSONObject(daten),
                  let kodiert = try? JSONSerialization.data(withJSONObject: daten, options: [.sortedKeys]) else { throw AnfrageFehler.ungueltig }
            guard kodiert.count <= maxKoerper else { throw AnfrageFehler.zuGross }
            body = kodiert
        }
        return (methode, pfad, body)
    }
}
