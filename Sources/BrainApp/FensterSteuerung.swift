import AppKit
import WebKit
import BrainCore

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
                let a = try await bruecke.anfrageMitNeuversuch(methode: "GET", pfad: SchemaAntwort.pfad(von: url))
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
        do { a = try SchemaAntwort.anfrage(ausNachricht: nachricht.body, oberflaeche: oberflaeche) }
        catch { return (nil, (error as? SchemaAntwort.AnfrageFehler)?.meldung ?? SchemaAntwort.AnfrageFehler.ungueltig.meldung) }
        do {
            let r = try await bruecke.anfrageMitNeuversuch(methode: a.methode, pfad: a.pfad, body: a.body)
            return (SchemaAntwort.kanalAntwort(r), nil)
        } catch {
            return (nil, "Dienst nicht erreichbar")
        }
    }
}

/// Nachrichtenkanal `aktion` (window.webkit.messageHandlers.aktion) MIT Antwort: nur Hauptrahmen der eigenen Herkunft; die
/// Prüfung der Werte liegt in `AppAktion` (BrainCore). Die Seite bekommt ein Promise: `{ok:true}` (bzw. `{ok:false, grund}`),
/// bei `ordner-waehlen` `{pfad}` oder `null`. Ungültiges (oder fremde Herkunft) weist das Promise mit einem Text ab.
@MainActor
final class AktionsKanal: NSObject, WKScriptMessageHandlerWithReply {
    private let oberflaeche: Oberflaeche
    private let vault: () -> URL?
    private let ausfuehren: (AppAktion) async -> Any?

    /// `vault`: der aktuelle Vault für die Pfadprüfung (wechselt im Studio ohne Neustart des Fensters).
    init(oberflaeche: Oberflaeche, vault: @escaping () -> URL?, ausfuehren: @escaping (AppAktion) async -> Any?) {
        self.oberflaeche = oberflaeche
        self.vault = vault
        self.ausfuehren = ausfuehren
    }

    func userContentController(_ controller: WKUserContentController, didReceive nachricht: WKScriptMessage) async -> (Any?, String?) {
        guard stammtVonEigenerOberflaeche(nachricht, oberflaeche) else { return (nil, SchemaAntwort.AnfrageFehler.ungueltig.meldung) }
        guard let aktion = AppAktion.pruefe(nachricht.body, vault: vault(), oberflaeche: oberflaeche) else { return (nil, "ungültige Aktion") }
        // NSNull = ausdrücklich `null` für die Seite (nil würde als „undefined“ ankommen).
        return ((await ausfuehren(aktion)) ?? NSNull(), nil)
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
    /// Führt eine geprüfte Aktion der Oberfläche aus (Übersicht öffnen, Finder, Browser, Vault-Wechsel …) und liefert die
    /// Antwort an die Seite (nil → `null`).
    var beiAktion: ((AppAktion) async -> Any?)?
    /// Der aktive Vault für die Pfadprüfung der Aktionen (nil = keiner gewählt).
    var aktuellerVault: (() -> URL?)?
    /// Der offene Ordner-Dialog (Sheet) samt Antwort-Wächter — höchstens einer je Fenster.
    private var ordnerDialog: (panel: NSOpenPanel, antwort: PanelAntwort)?

    init(log: AppLog, oberflaeche: Oberflaeche) {
        self.log = log
        self.oberflaeche = oberflaeche
    }

    private var name: String { oberflaeche == .studio ? "studio" : "uebersicht" }
    private var standardTitel: String { oberflaeche == .studio ? StudioFenster.standardTitel : "Übersicht" }

    /// `skript`: nil = Kit-Brücke des Vaults, sonst z. B. die Werkstatt aus dem App-Paket. `vault` nil nur mit `skript`
    /// (Studio vor der Vault-Wahl: die Werkstatt liest dann vaults.json); `arbeitsordner` gilt dann als Arbeitsverzeichnis.
    func oeffne(node: URL, vault: URL?, skript: URL? = nil, umgebung: [String: String], arbeitsordner: URL? = nil) {
        if let fenster {
            if fenster.isMiniaturized { fenster.deminiaturize(nil) }
            fenster.makeKeyAndOrderFront(nil)
            NSApp.activate()
            return
        }
        let bruecke = BrueckenVerbindung(node: node, vault: vault, skript: skript, umgebung: umgebung, arbeitsordner: arbeitsordner)
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(SchemaHandler(bruecke: bruecke, oberflaeche: oberflaeche), forURLScheme: NavigationsRegel.schema)
        config.userContentController.addScriptMessageHandler(Kanal(bruecke: bruecke, oberflaeche: oberflaeche), contentWorld: .page, name: "brain")
        let aktionsKanal = AktionsKanal(oberflaeche: oberflaeche, vault: { [weak self] in self?.aktuellerVault?() }) { [weak self] aktion in
            guard let self, let f = self.beiAktion else { return nil }
            return await f(aktion)
        }
        config.userContentController.addScriptMessageHandler(aktionsKanal, contentWorld: .page, name: "aktion")
        let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1200, height: 800), configuration: config)
        let navigation = Navigation(oberflaeche: oberflaeche)
        navigation.beiGeladen = { [weak self] in self?.warteAufBereit() }
        navigation.beiFehler = { [weak self] grund in self?.log.schreibe("fenster-ladefehler \(self?.name ?? "") \(grund)") }
        web.navigationDelegate = navigation

        // Ohne fullSizeContentView: Die WebView fängt sonst alle Klicks in der Titelleiste ab (Fenster nicht
        // verschiebbar) und die Ampel-Knöpfe lägen über der Seitenleiste.
        let maske: NSWindow.StyleMask = [.titled, .closable, .miniaturizable, .resizable]
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1200, height: 800), styleMask: maske, backing: .buffered, defer: false)
        w.isReleasedWhenClosed = false
        w.contentView = web
        w.title = standardTitel
        if oberflaeche == .studio {
            w.titlebarAppearsTransparent = true
            w.minSize = StudioFenster.minimum
            // Erster Start (noch keine gemerkte Position): Standardgröße, mittig. Danach gilt die gemerkte Größe — aber nie
            // unter dem heutigen Minimum (ältere Versionen erlaubten 900×600).
            let ersterStart = UserDefaults.standard.string(forKey: "NSWindow Frame \(StudioFenster.rahmenName)") == nil
            w.setFrameAutosaveName(StudioFenster.rahmenName)
            var rahmen = w.frame
            if ersterStart {
                let sichtbar = (NSScreen.main ?? NSScreen.screens.first)?.visibleFrame.size ?? StudioFenster.standard
                rahmen.size = StudioFenster.startgroesse(sichtbar: sichtbar)
            } else {
                rahmen.size = StudioFenster.mindestens(rahmen.size)
            }
            if rahmen.size != w.frame.size { w.setFrame(rahmen, display: false) }
            if ersterStart { w.center() }
        } else {
            w.setFrameAutosaveName("BrainFenster")
            if w.frame.origin == .zero { w.center() }
        }
        w.delegate = self

        self.bruecke = bruecke
        self.webView = web
        self.navigation = navigation
        self.fenster = w
        w.makeKeyAndOrderFront(nil)
        NSApp.activate()
        web.load(URLRequest(url: oberflaeche.startURL))
        log.schreibe("fenster-auf \(name) \(Int(w.frame.width))x\(Int(w.frame.height))")
    }

    func schliesse() { fenster?.close() }

    /// Fenstertitel (Studio: Name des aktiven Vaults, von der Oberfläche gemeldet); nil = Standardtitel.
    func setzeTitel(_ titel: String?) { fenster?.title = titel ?? standardTitel }

    /// Wartet genau einmal auf die Wahl im Ordner-Dialog (Antwort des Sheets oder Abbruch beim Schließen des Fensters).
    @MainActor private final class PanelAntwort {
        private var fortsetzung: CheckedContinuation<URL?, Never>?
        init(_ f: CheckedContinuation<URL?, Never>) { fortsetzung = f }
        func fertig(_ url: URL?) { fortsetzung?.resume(returning: url); fortsetzung = nil }
    }

    /// Ordner-Dialog als Sheet am Fenster (nur Ordner, „Neuer Ordner“ erlaubt). Liefert den gewählten Ordner oder nil
    /// (Abbruch, kein Fenster, es ist schon ein Dialog offen). Startort: `vorschlag` (oder der tiefste vorhandene Ordner
    /// darüber), sonst Home.
    func waehleOrdner(titel: String?, vorschlag: URL?) async -> URL? {
        guard let fenster, ordnerDialog == nil else { return nil }
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = true
        panel.prompt = "Wählen"
        if let titel { panel.message = titel }
        panel.directoryURL = AppAktion.startort(fuer: vorschlag, fallback: FileManager.default.homeDirectoryForCurrentUser)
        if fenster.isMiniaturized { fenster.deminiaturize(nil) }
        fenster.makeKeyAndOrderFront(nil)
        NSApp.activate()
        let gewaehlt: URL? = await withCheckedContinuation { (f: CheckedContinuation<URL?, Never>) in
            let antwort = PanelAntwort(f)
            ordnerDialog = (panel, antwort)
            panel.beginSheetModal(for: fenster) { antwortCode in
                antwort.fertig(antwortCode == .OK ? panel.url?.standardizedFileURL : nil)
            }
        }
        ordnerDialog = nil
        log.schreibe("ordner-dialog \(gewaehlt == nil ? "abgebrochen" : "gewaehlt")")
        return gewaehlt
    }

    /// Menübefehl an die Studio-Oberfläche (`window.studio.befehl`); Fenster nach vorn. War das Fenster eben erst zu,
    /// ist die Oberfläche noch nicht geladen: der Befehl wartet (höchstens 5 s), bis `window.studio.bereit === true`.
    func sende(_ befehl: StudioBefehl) {
        guard webView != nil else { return }
        fenster?.makeKeyAndOrderFront(nil)
        Task { @MainActor [weak self] in
            for _ in 0..<50 {
                guard let self, let web = self.webView else { return }
                let bereit = try? await web.evaluateJavaScript("window.studio?.bereit === true")
                if (bereit as? NSNumber)?.boolValue == true {
                    _ = try? await web.evaluateJavaScript(befehl.skript)
                    return
                }
                try? await Task.sleep(for: .milliseconds(100))
            }
            self?.log.schreibe("befehl-verworfen \(befehl.rawValue) oberflaeche-nicht-bereit")
        }
    }

    // MARK: Schließen mit Rückfrage an die Oberfläche (Studio-Spec: ungespeicherte Eingaben)

    private enum VorSchliessen {
        case ok
        case nichtGespeichert(String?)
        case nichtVerfuegbar(String)
    }

    /// Wartet genau einmal auf das erste Ergebnis (Antwort der Seite oder Zeitablauf).
    @MainActor private final class Einmal {
        private var fortsetzung: CheckedContinuation<VorSchliessen, Never>?
        init(_ f: CheckedContinuation<VorSchliessen, Never>) { fortsetzung = f }
        func fertig(_ r: VorSchliessen) { fortsetzung?.resume(returning: r); fortsetzung = nil }
    }

    private static let vorSchliessenSkript = """
    if (!window.studio || typeof window.studio.vorSchliessen !== 'function') { return { nicht: true }; }
    return await window.studio.vorSchliessen();
    """

    /// Fragt `window.studio.vorSchliessen()` (liefert `{ok:true}` oder `{ok:false, grund}`), höchstens 5 s.
    private func frageOberflaeche() async -> VorSchliessen {
        guard let web = webView else { return .ok }
        return await withCheckedContinuation { (f: CheckedContinuation<VorSchliessen, Never>) in
            let einmal = Einmal(f)
            Task { @MainActor in
                do {
                    let wert = try await web.callAsyncJavaScript(Self.vorSchliessenSkript, arguments: [:], in: nil, contentWorld: .page)
                    guard let d = wert as? [String: Any] else { einmal.fertig(.nichtVerfuegbar("unerwartete Antwort")); return }
                    if d["nicht"] as? Bool == true { einmal.fertig(.nichtVerfuegbar("vorSchliessen fehlt")); return }
                    if d["ok"] as? Bool == true { einmal.fertig(.ok) } else { einmal.fertig(.nichtGespeichert(d["grund"] as? String)) }
                } catch {
                    einmal.fertig(.nichtVerfuegbar("Fehler \(error.localizedDescription)"))
                }
            }
            Task { @MainActor in
                // Länger als die 5-s-Frist der Oberfläche, damit deren Antwort gewinnt; bleibt sie aus, fragt der Nutzer.
                try? await Task.sleep(for: .seconds(8))
                einmal.fertig(.nichtGespeichert("Das Sichern dauert zu lange."))
            }
        }
    }

    /// Darf das Studio jetzt geschlossen werden? Die Oberfläche sichert zuerst; meldet sie „nicht gespeichert“,
    /// entscheidet der Nutzer (auch bei Zeitüberschreitung). Ältere Oberfläche: schließen, Hinweis im Log.
    func darfSchliessen() async -> Bool {
        guard oberflaeche == .studio, fenster != nil else { return true }
        switch await frageOberflaeche() {
        case .ok:
            return true
        case .nichtVerfuegbar(let grund):
            log.schreibe("schliessen-ohne-pruefung \(name) \(grund)")
            return true
        case .nichtGespeichert(let grund):
            let alert = NSAlert()
            alert.messageText = "Änderungen nicht gespeichert"
            alert.informativeText = grund?.isEmpty == false ? grund! : "Das Studio konnte nicht alles sichern."
            alert.alertStyle = .warning
            alert.addButton(withTitle: "Trotzdem schließen")
            alert.addButton(withTitle: "Abbrechen")
            NSApp.activate()
            let trotzdem = alert.runModal() == .alertFirstButtonReturn
            log.schreibe("schliessen-nicht-gespeichert \(name) \(trotzdem ? "trotzdem" : "abgebrochen")")
            return trotzdem
        }
    }

    private var schliessenLaeuft = false
    private var schliessenFreigegeben = false

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        guard oberflaeche == .studio, !schliessenFreigegeben else { return true }
        if schliessenLaeuft { return false }
        schliessenLaeuft = true
        Task { @MainActor [weak self] in
            guard let self else { return }
            let ja = await self.darfSchliessen()
            self.schliessenLaeuft = false
            if ja { self.schliessenFreigegeben = true; self.fenster?.close() }
        }
        return false
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
        // Ein offener Ordner-Dialog endet mit dem Fenster; die wartende Seite bekommt „abgebrochen“.
        if let d = ordnerDialog {
            ordnerDialog = nil
            fenster?.endSheet(d.panel, returnCode: .cancel)
            d.antwort.fertig(nil)
        }
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
        schliessenFreigegeben = false
        schliessenLaeuft = false
        if let b = bruecke { Task { await b.beende() } }
        bruecke = nil
        log.schreibe("fenster-zu \(name)")
        beiGeschlossen?()
    }
}
