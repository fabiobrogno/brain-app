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

/// Liefert brain://<host>/… über die Brücke des Fensters aus (nur GET/HEAD). Gestoppte Aufgaben werden nie mehr bedient.
@MainActor
final class SchemaHandler: NSObject, WKURLSchemeHandler {
    private let bruecke: BrueckenVerbindung
    private let oberflaeche: Oberflaeche
    private var gestoppt = Set<ObjectIdentifier>()

    init(bruecke: BrueckenVerbindung, oberflaeche: Oberflaeche) {
        self.bruecke = bruecke
        self.oberflaeche = oberflaeche
    }

    func webView(_ webView: WKWebView, start aufgabe: any WKURLSchemeTask) {
        let kennung = ObjectIdentifier(aufgabe)
        let methode = aufgabe.request.httpMethod ?? "GET"
        guard let url = aufgabe.request.url, url.host == oberflaeche.host,
              !SchemaAntwort.istApiPfad(url), methode == "GET" || methode == "HEAD" else {
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
                if SchemaAntwort.istHauptdokument(url) {
                    // Kein leeres Fenster: Fehlerseite unter derselben brain://-URL ausliefern.
                    let seite = SchemaAntwort.fehlerSeite(url: url)
                    aufgabe.didReceive(seite.antwort)
                    aufgabe.didReceive(seite.body)
                    aufgabe.didFinish()
                } else {
                    aufgabe.didFailWithError(error)
                }
            }
        }
    }

    func webView(_ webView: WKWebView, stop aufgabe: any WKURLSchemeTask) {
        gestoppt.insert(ObjectIdentifier(aufgabe))
    }
}

/// Herkunftsprüfung für alle Kanäle: Hauptrahmen und brain://<Host der eigenen Oberfläche>.
@MainActor
func stammtVonEigenerOberflaeche(_ nachricht: WKScriptMessage, _ oberflaeche: Oberflaeche) -> Bool {
    let herkunft = nachricht.frameInfo.securityOrigin
    return nachricht.frameInfo.isMainFrame
        && herkunft.protocol == NavigationsRegel.schema && herkunft.host == oberflaeche.host
        && nachricht.frameInfo.request.url?.scheme == NavigationsRegel.schema
}

/// Nachrichtenkanal für api.js (window.webkit.messageHandlers.brain): nur aus dem Hauptrahmen der eigenen
/// Oberfläche, nur /api/…; Antwort { status, body } oder Fehlertext (→ „Dienst nicht erreichbar“ in api.js).
@MainActor
final class Kanal: NSObject, WKScriptMessageHandlerWithReply {
    private let bruecke: BrueckenVerbindung
    private let oberflaeche: Oberflaeche

    init(bruecke: BrueckenVerbindung, oberflaeche: Oberflaeche) {
        self.bruecke = bruecke
        self.oberflaeche = oberflaeche
    }

    func userContentController(_ controller: WKUserContentController, didReceive nachricht: WKScriptMessage) async -> (Any?, String?) {
        guard stammtVonEigenerOberflaeche(nachricht, oberflaeche) else { return (nil, SchemaAntwort.AnfrageFehler.ungueltig.meldung) }
        let a: (methode: String, pfad: String, body: Data?)
        do { a = try SchemaAntwort.anfrage(ausNachricht: nachricht.body) }
        catch { return (nil, (error as? SchemaAntwort.AnfrageFehler)?.meldung ?? SchemaAntwort.AnfrageFehler.ungueltig.meldung) }
        do {
            let r = try await anfrageMitNeuversuch(bruecke, methode: a.methode, pfad: a.pfad, body: a.body)
            return (SchemaAntwort.kanalAntwort(r), nil)
        } catch {
            return (nil, "Dienst nicht erreichbar")
        }
    }
}

/// Nachrichtenkanal `aktion` (window.webkit.messageHandlers.aktion): nur Hauptrahmen der eigenen Herkunft; die
/// Prüfung der Werte liegt in `AppAktion` (BrainCore). Ungültiges wird still verworfen.
@MainActor
final class AktionsKanal: NSObject, WKScriptMessageHandler {
    private let oberflaeche: Oberflaeche
    private let vault: URL
    private let ausfuehren: (AppAktion) -> Void

    init(oberflaeche: Oberflaeche, vault: URL, ausfuehren: @escaping (AppAktion) -> Void) {
        self.oberflaeche = oberflaeche
        self.vault = vault
        self.ausfuehren = ausfuehren
    }

    func userContentController(_ controller: WKUserContentController, didReceive nachricht: WKScriptMessage) {
        guard stammtVonEigenerOberflaeche(nachricht, oberflaeche),
              let aktion = AppAktion.pruefe(nachricht.body, vault: vault) else { return }
        ausfuehren(aktion)
    }
}

/// Hält das Fenster auf seiner brain://-Oberfläche; fremde Links nur auf Klick in den Standardbrowser (Review-Fokus 3).
@MainActor
final class Navigation: NSObject, WKNavigationDelegate {
    var beiGeladen: (() -> Void)?
    var beiFehler: ((String) -> Void)?
    private let oberflaeche: Oberflaeche

    init(oberflaeche: Oberflaeche) { self.oberflaeche = oberflaeche }

    func webView(_ webView: WKWebView, decidePolicyFor aktion: WKNavigationAction) async -> WKNavigationActionPolicy {
        let hauptrahmen = aktion.targetFrame?.isMainFrame ?? true
        switch NavigationsRegel.entscheide(aktion.request.url, hauptrahmen: hauptrahmen, vomNutzer: aktion.navigationType == .linkActivated, oberflaeche: oberflaeche) {
        case .erlauben: return .allow
        case .extern(let url): NSWorkspace.shared.open(url); return .cancel
        case .abbrechen: return .cancel
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { beiGeladen?() }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error) {
        meldeFehler(webView, error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: any Error) {
        meldeFehler(webView, error)
    }

    /// Abbrüche durch die Navigationsregel (-999, WebKit 102) sind gewollt; alles andere zeigt die Fehlerseite statt Weiß.
    private func meldeFehler(_ webView: WKWebView, _ error: any Error) {
        let e = error as NSError
        if e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled { return }
        if e.domain == "WebKitErrorDomain" && e.code == 102 { return }
        beiFehler?("\(e.domain) \(e.code)")
        webView.loadSimulatedRequest(URLRequest(url: oberflaeche.startURL), responseHTML: SchemaAntwort.fehlerSeiteHTML)
    }
}

/// Ein Brain-Fenster (App-Spec §5.2, §7.2; Studio-Spec §9): beim Schließen werden WebView, Kanäle und Brücke beendet.
/// Die App hat zwei davon: Studio (Werkstatt-Brücke) und Übersicht (Kit-Brücke).
@MainActor
final class FensterSteuerung: NSObject, NSWindowDelegate {
    private let log: AppLog
    let oberflaeche: Oberflaeche
    private var fenster: NSWindow?
    private var webView: WKWebView?
    private var navigation: Navigation?
    private var bruecke: BrueckenVerbindung?
    private var bereitAufgabe: Task<Void, Never>?

    var istOffen: Bool { fenster != nil }
    /// Wird nach dem Schließen aufgerufen (z. B. um den Menüstatus aufzufrischen).
    var beiGeschlossen: (() -> Void)?
    /// Führt eine geprüfte Aktion der Oberfläche aus (Übersicht öffnen, Finder, Browser).
    var beiAktion: ((AppAktion) -> Void)?

    init(log: AppLog, oberflaeche: Oberflaeche) {
        self.log = log
        self.oberflaeche = oberflaeche
    }

    private var name: String { oberflaeche == .studio ? "studio" : "uebersicht" }

    /// `skript`: nil = Kit-Brücke des Vaults, sonst z. B. die Werkstatt aus dem App-Paket.
    func oeffne(node: URL, vault: URL, skript: URL? = nil, umgebung: [String: String]) {
        if let fenster {
            fenster.makeKeyAndOrderFront(nil)
            NSApp.activate()
            return
        }
        let bruecke = BrueckenVerbindung(node: node, vault: vault, skript: skript, umgebung: umgebung)
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(SchemaHandler(bruecke: bruecke, oberflaeche: oberflaeche), forURLScheme: NavigationsRegel.schema)
        config.userContentController.addScriptMessageHandler(Kanal(bruecke: bruecke, oberflaeche: oberflaeche), contentWorld: .page, name: "brain")
        config.userContentController.add(AktionsKanal(oberflaeche: oberflaeche, vault: vault) { [weak self] in self?.beiAktion?($0) },
                                         contentWorld: .page, name: "aktion")
        let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1200, height: 800), configuration: config)
        let navigation = Navigation(oberflaeche: oberflaeche)
        navigation.beiGeladen = { [weak self] in self?.warteAufBereit() }
        navigation.beiFehler = { [weak self] grund in self?.log.schreibe("fenster-ladefehler \(self?.name ?? "") \(grund)") }
        web.navigationDelegate = navigation

        var maske: NSWindow.StyleMask = [.titled, .closable, .miniaturizable, .resizable]
        if oberflaeche == .studio { maske.insert(.fullSizeContentView) }
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1200, height: 800), styleMask: maske, backing: .buffered, defer: false)
        w.isReleasedWhenClosed = false
        w.contentView = web
        if oberflaeche == .studio {
            w.title = "Studio"
            w.titlebarAppearsTransparent = true
            w.minSize = NSSize(width: 900, height: 600)
            w.setFrameAutosaveName("StudioFenster")
        } else {
            w.title = "Übersicht"
            w.setFrameAutosaveName("BrainFenster")
        }
        if w.frame.origin == .zero { w.center() }
        w.delegate = self

        self.bruecke = bruecke
        self.webView = web
        self.navigation = navigation
        self.fenster = w
        w.makeKeyAndOrderFront(nil)
        NSApp.activate()
        web.load(URLRequest(url: oberflaeche.startURL))
        log.schreibe("fenster-auf \(name)")
    }

    func schliesse() { fenster?.close() }

    /// Menübefehl an die Studio-Oberfläche (`window.studio.befehl`); Fenster nach vorn.
    func sende(_ befehl: StudioBefehl) {
        guard let web = webView else { return }
        fenster?.makeKeyAndOrderFront(nil)
        web.evaluateJavaScript(befehl.skript, completionHandler: nil)
    }

    func windowWillClose(_ notification: Notification) { aufraeumen() }

    /// Bereit = Übersicht: app.js hat die Daten geladen (window.__brain.ladezeit); Studio: window.studio ist da und
    /// die Seite fertig geladen. Höchstens 30 s warten.
    private func warteAufBereit() {
        bereitAufgabe?.cancel()
        let pruefung = oberflaeche == .studio
            ? "window.studio && document.readyState === 'complete' ? 1 : null"
            : "window.__brain && window.__brain.ladezeit ? Math.round(window.__brain.ladezeit) : null"
        bereitAufgabe = Task { @MainActor [weak self] in
            for _ in 0..<120 {
                guard let self, let web = self.webView, !Task.isCancelled else { return }
                let wert = try? await web.evaluateJavaScript(pruefung)
                if let ms = wert as? NSNumber {
                    self.log.schreibe("fenster-bereit \(self.name) ladezeit=\(ms.intValue)")
                    return
                }
                try? await Task.sleep(for: .milliseconds(250))
            }
            self?.log.schreibe("fenster-nicht-bereit \(self?.name ?? "")")
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
        log.schreibe("fenster-zu \(name)")
        beiGeschlossen?()
    }
}
