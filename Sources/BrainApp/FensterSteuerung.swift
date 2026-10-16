import AppKit
import WebKit
import BrainCore

/// Fragt die Brücke an; endet die Anfrage mit `.beendet` (Brücke kurz zuvor abgestürzt), wird GENAU EINMAL neu
/// angefragt — die neue Anfrage startet die Brücke neu. Scheitert auch das, geht der Fehler an den Aufrufer.
func anfrageMitNeuversuch(_ bruecke: BrueckenVerbindung, methode: String, pfad: String, body: Data? = nil) async throws -> BrueckenAntwort {
    do {
        return try await bruecke.anfrage(methode: methode, pfad: pfad, body: body)
    } catch BrueckenFehler.beendet {
        return try await bruecke.anfrage(methode: methode, pfad: pfad, body: body)
    }
}

/// Liefert brain://app/… über die Ansicht-Brücke aus (nur GET/HEAD). Gestoppte Aufgaben werden nie mehr bedient.
@MainActor
final class SchemaHandler: NSObject, WKURLSchemeHandler {
    private let bruecke: BrueckenVerbindung
    private var gestoppt = Set<ObjectIdentifier>()

    init(bruecke: BrueckenVerbindung) { self.bruecke = bruecke }

    func webView(_ webView: WKWebView, start aufgabe: any WKURLSchemeTask) {
        let kennung = ObjectIdentifier(aufgabe)
        let methode = aufgabe.request.httpMethod ?? "GET"
        guard let url = aufgabe.request.url, url.host == NavigationsRegel.host, methode == "GET" || methode == "HEAD" else {
            aufgabe.didFailWithError(URLError(.badURL))
            return
        }
        Task { @MainActor in
            defer { gestoppt.remove(kennung) }
            do {
                let a = try await anfrageMitNeuversuch(bruecke, methode: "GET", pfad: SchemaAntwort.pfad(von: url))
                guard !gestoppt.contains(kennung) else { return }
                aufgabe.didReceive(SchemaAntwort.antwort(url: url, aus: a))
                aufgabe.didReceive(a.body)
                aufgabe.didFinish()
            } catch {
                guard !gestoppt.contains(kennung) else { return }
                aufgabe.didFailWithError(error)
            }
        }
    }

    func webView(_ webView: WKWebView, stop aufgabe: any WKURLSchemeTask) {
        gestoppt.insert(ObjectIdentifier(aufgabe))
    }
}

/// Nachrichtenkanal für api.js (window.webkit.messageHandlers.brain): nur aus dem Hauptrahmen der eigenen
/// Oberfläche, nur /api/…; Antwort { status, body } oder Fehlertext (→ „Dienst nicht erreichbar“ in api.js).
@MainActor
final class Kanal: NSObject, WKScriptMessageHandlerWithReply {
    private let bruecke: BrueckenVerbindung

    init(bruecke: BrueckenVerbindung) { self.bruecke = bruecke }

    func userContentController(_ controller: WKUserContentController, didReceive nachricht: WKScriptMessage) async -> (Any?, String?) {
        guard nachricht.frameInfo.isMainFrame,
              nachricht.frameInfo.request.url?.scheme == NavigationsRegel.schema,
              let a = SchemaAntwort.anfrage(ausNachricht: nachricht.body) else { return (nil, "ungültige Anfrage") }
        do {
            let r = try await anfrageMitNeuversuch(bruecke, methode: a.methode, pfad: a.pfad, body: a.body)
            return (SchemaAntwort.kanalAntwort(r), nil)
        } catch {
            return (nil, "Dienst nicht erreichbar")
        }
    }
}

/// Hält das Fenster auf brain://app; fremde Links nur auf Klick in den Standardbrowser (Review-Fokus 3).
@MainActor
final class Navigation: NSObject, WKNavigationDelegate {
    var beiGeladen: (() -> Void)?

    func webView(_ webView: WKWebView, decidePolicyFor aktion: WKNavigationAction) async -> WKNavigationActionPolicy {
        let hauptrahmen = aktion.targetFrame?.isMainFrame ?? true
        switch NavigationsRegel.entscheide(aktion.request.url, hauptrahmen: hauptrahmen, vomNutzer: aktion.navigationType == .linkActivated) {
        case .erlauben: return .allow
        case .extern(let url): NSWorkspace.shared.open(url); return .cancel
        case .abbrechen: return .cancel
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { beiGeladen?() }
}

/// Das Brain-Fenster (App-Spec §5.2, §7.2): beim Schließen werden WebView, Kanal und Brücke beendet.
@MainActor
final class FensterSteuerung: NSObject, NSWindowDelegate {
    private let log: AppLog
    private var fenster: NSWindow?
    private var webView: WKWebView?
    private var navigation: Navigation?
    private var bruecke: BrueckenVerbindung?
    private var bereitAufgabe: Task<Void, Never>?

    var istOffen: Bool { fenster != nil }

    init(log: AppLog) { self.log = log }

    func oeffne(node: URL, vault: URL, umgebung: [String: String]) {
        if let fenster {
            fenster.makeKeyAndOrderFront(nil)
            NSApp.activate()
            return
        }
        let bruecke = BrueckenVerbindung(node: node, vault: vault, umgebung: umgebung)
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(SchemaHandler(bruecke: bruecke), forURLScheme: NavigationsRegel.schema)
        config.userContentController.addScriptMessageHandler(Kanal(bruecke: bruecke), contentWorld: .page, name: "brain")
        let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1200, height: 800), configuration: config)
        let navigation = Navigation()
        navigation.beiGeladen = { [weak self] in self?.warteAufBereit() }
        web.navigationDelegate = navigation

        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1200, height: 800),
                         styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        w.title = "Brain"
        w.isReleasedWhenClosed = false
        w.contentView = web
        w.setFrameAutosaveName("BrainFenster")
        if w.frame.origin == .zero { w.center() }
        w.delegate = self

        self.bruecke = bruecke
        self.webView = web
        self.navigation = navigation
        self.fenster = w
        w.makeKeyAndOrderFront(nil)
        NSApp.activate()
        web.load(URLRequest(url: NavigationsRegel.startURL))
        log.schreibe("fenster-auf")
    }

    func schliesse() { fenster?.close() }

    func windowWillClose(_ notification: Notification) { aufraeumen() }

    /// Bereit = app.js hat die Daten geladen (window.__brain.ladezeit gesetzt). Höchstens 30 s warten.
    private func warteAufBereit() {
        bereitAufgabe?.cancel()
        bereitAufgabe = Task { @MainActor [weak self] in
            for _ in 0..<120 {
                guard let self, let web = self.webView, !Task.isCancelled else { return }
                let wert = try? await web.evaluateJavaScript("window.__brain && window.__brain.ladezeit ? Math.round(window.__brain.ladezeit) : null")
                if let ms = wert as? NSNumber {
                    self.log.schreibe("fenster-bereit ladezeit=\(ms.intValue)")
                    return
                }
                try? await Task.sleep(for: .milliseconds(250))
            }
            self?.log.schreibe("fenster-nicht-bereit")
        }
    }

    private func aufraeumen() {
        bereitAufgabe?.cancel()
        bereitAufgabe = nil
        if let web = webView {
            web.stopLoading()
            web.navigationDelegate = nil
            web.configuration.userContentController.removeAllScriptMessageHandlers()
            web.removeFromSuperview()
        }
        webView = nil
        navigation = nil
        fenster?.delegate = nil
        fenster = nil
        if let b = bruecke { Task { await b.beende() } }
        bruecke = nil
        log.schreibe("fenster-zu")
    }
}
