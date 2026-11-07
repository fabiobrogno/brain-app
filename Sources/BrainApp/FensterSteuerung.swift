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
    /// Die KI-Routen `/api/ki/…` (nur Studio): laufen in der App und kommen vor der Brücke dran; alles andere geht an die Werkstatt.
    private let ki: KiRoute?

    init(bruecke: BrueckenVerbindung, oberflaeche: Oberflaeche, ki: KiRoute? = nil) {
        self.bruecke = bruecke
        self.oberflaeche = oberflaeche
        self.ki = ki
    }

    func userContentController(_ controller: WKUserContentController, didReceive nachricht: WKScriptMessage) async -> (Any?, String?) {
        guard stammtVonEigenerOberflaeche(nachricht, oberflaeche) else { return (nil, SchemaAntwort.AnfrageFehler.ungueltig.meldung) }
        let a: (methode: String, pfad: String, body: Data?)
        do { a = try SchemaAntwort.anfrage(ausNachricht: nachricht.body, oberflaeche: oberflaeche) }
        catch { return (nil, (error as? SchemaAntwort.AnfrageFehler)?.meldung ?? SchemaAntwort.AnfrageFehler.ungueltig.meldung) }
        if let eigene = await ki?.behandle(methode: a.methode, pfad: a.pfad, body: a.body) {
            return (SchemaAntwort.kanalAntwort(eigene), nil)
        }
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
    /// Der WebContent-Prozess wurde beendet (Absturz, Speicherdruck): die Seite neu laden lassen (`WebAbsturzBehandlung`).
    var beiProzessEnde: (() -> Void)?
    private let oberflaeche: Oberflaeche
    /// Wohin die Fehlerseite zurückführt: die Startseite der Oberfläche.
    private let startURL: URL

    init(oberflaeche: Oberflaeche) {
        self.oberflaeche = oberflaeche
        self.startURL = oberflaeche.startURL
    }

    func webView(_ webView: WKWebView, decidePolicyFor aktion: WKNavigationAction) async -> WKNavigationActionPolicy {
        let hauptrahmen = aktion.targetFrame?.isMainFrame ?? true
        switch NavigationsRegel.entscheide(aktion.request.url, hauptrahmen: hauptrahmen, vomNutzer: aktion.navigationType == .linkActivated, oberflaeche: oberflaeche) {
        case .erlauben: return .allow
        case .extern(let url): NSWorkspace.shared.open(url); return .cancel
        case .abbrechen: return .cancel
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { beiGeladen?() }

    /// Ohne diese Methode bliebe das Fenster nach einem Absturz des WebContent-Prozesses weiß, und nicht gespeicherter Text wäre nur noch im Entwurfs-Journal.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { beiProzessEnde?() }

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
        webView.loadSimulatedRequest(URLRequest(url: startURL), responseHTML: SchemaAntwort.fehlerSeiteHTML)
    }
}

/// Die WebView als `WebLader` für die Behandlung eines Absturzes (im Test eine Attrappe).
@MainActor
private final class WebLaderWK: WebLader {
    weak var web: WKWebView?
    func lade(_ url: URL) { web?.load(URLRequest(url: url)) }
    func zeigeFehlerseite(startURL: URL) { web?.loadSimulatedRequest(URLRequest(url: startURL), responseHTML: SchemaAntwort.fehlerSeiteHTML) }
}

/// Die WebView der Kortex-Fenster. Sie liegt unter der durchsichtigen Titelleiste und nimmt deren Klicks entgegen; ein Klick in die
/// Kopfzeile eines noch nicht aktiven Fensters soll es, wie bei einer echten Titelleiste, gleich greifen (verschieben) können — darum nimmt sie
/// dort den ersten Klick an (und nur dort: Knöpfe weiter unten brauchen weiterhin erst die Aktivierung).
final class KortexWebView: WKWebView {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
        guard let event else { return false }
        let p = convert(event.locationInWindow, from: nil)
        return (isFlipped ? p.y : bounds.height - p.y) <= FensterAmpel.zeile
    }
}

/// Ein Kortex-Fenster (App-Spec §5.2, §7.2; Studio-Spec §9): beim Schließen werden WebView, Kanäle und Brücke beendet.
/// Die App hat zwei davon: Studio (Werkstatt-Brücke; die Einrichtung „Kortex einrichten“ ist ein Overlay darin, kein eigenes Fenster) und
/// Übersicht (Brücke des gebündelten Kerns).
@MainActor
final class FensterSteuerung: NSObject, NSWindowDelegate {
    enum Art { case studio, uebersicht }

    private let log: AppLog
    let art: Art
    /// Der Host im brain://-Schema: das Studio hat `studio` (Werkstatt-Brücke), die Übersicht `app` (Kern-Brücke).
    var oberflaeche: Oberflaeche { art == .uebersicht ? .app : .studio }
    private var fenster: NSWindow?
    /// Das Fenster für Dialoge der App (Speichern, Teilen); nur zum Anheften von Sheets und Menüs.
    var fensterFuerDialoge: NSWindow? { fenster }
    private var webView: WKWebView?
    /// Platz, den die Seite links für die Ampel freihält (nach `positioniereAmpel`).
    private var ampelPlatz: CGFloat = 0
    private var navigation: Navigation?
    private var bruecke: BrueckenVerbindung?
    private var webLader: WebLaderWK?
    private var absturzBehandlung: WebAbsturzBehandlung?
    private var bereitAufgabe: Task<Void, Never>?
    /// Testschalter fürs Studio (`--test-bild` & Co., nur wenn die App damit gestartet wurde) und der Lauf dazu.
    private var test: StartArgumente?
    private var testAufgabe: Task<Void, Never>?
    private var testGestartet = false
    /// Zählt die Meldungen `fehler` dieses Fensterlebens (neu mit jedem `oeffne`): Mehr als `AppAktion.maxFehlerJeFenster` schreibt
    /// die App nicht ins Protokoll (Review SW-7).
    private var fehlerDrossel = MeldungsDrossel(grenze: AppAktion.maxFehlerJeFenster)

    var istOffen: Bool { fenster != nil }
    /// Das Fenster ist offen und für den Nutzer zu sehen (nicht im Dock, nicht ganz verdeckt) — für „ist Kortex vorne“ der Mitteilungen.
    var istSichtbar: Bool {
        guard let f = fenster else { return false }
        return f.isVisible && !f.isMiniaturized && f.occlusionState.contains(.visible)
    }
    /// Wird nach dem Schließen aufgerufen (z. B. um den Menüstatus aufzufrischen).
    var beiGeschlossen: (() -> Void)?
    /// Führt eine geprüfte Aktion der Oberfläche aus (Übersicht öffnen, Finder, Browser, Vault-Wechsel …) und liefert die
    /// Antwort an die Seite (nil → `null`).
    /// Das Fenster, das die Aktion geschickt hat, kommt mit (Ordner-Dialog als Sheet am richtigen Fenster).
    var beiAktion: ((AppAktion, FensterSteuerung) async -> Any?)?
    /// Der aktive Vault für die Pfadprüfung der Aktionen (nil = keiner gewählt).
    var aktuellerVault: (() -> URL?)?
    /// Der offene Ordner-Dialog (Sheet) samt Antwort-Wächter — höchstens einer je Fenster.
    private var ordnerDialog: (panel: NSOpenPanel, antwort: PanelAntwort)?
    /// Menübefehle, die noch auf die Oberfläche warten — in der Reihenfolge, in der sie kamen, jeder mit seiner Frist — und der
    /// eine Lauf, der sie abarbeitet.
    private var wartendeBefehle: [(name: String, skript: String, frist: ContinuousClock.Instant)] = []
    private var befehlsAufgabe: Task<Void, Never>?
    /// So lange wartet ein Menübefehl auf eine noch nicht bereite Oberfläche (Fenster eben erst geöffnet, Seite lädt, Vault wird
    /// geöffnet); danach steht er als `befehl-verworfen` im Log.
    static let befehlsFrist = Duration.seconds(30)

    init(log: AppLog, art: Art) {
        self.log = log
        self.art = art
    }

    private var name: String {
        switch art {
        case .studio: return "studio"
        case .uebersicht: return "uebersicht"
        }
    }
    private var standardTitel: String {
        switch art {
        case .studio: return StudioFenster.standardTitel
        case .uebersicht: return "Übersicht"
        }
    }

    /// `skript`: nil = Ansicht-Brücke des gebündelten Kerns (`kern` = `bin/kern`, nie Code aus dem Vault), sonst z. B. die Werkstatt
    /// aus dem App-Paket. `vault` nil nur mit `skript`
    /// (Studio vor der Vault-Wahl: die Werkstatt liest dann vaults.json); `arbeitsordner` gilt dann als Arbeitsverzeichnis.
    /// `test`: Testschalter des Studios (Größe, Bild, Skript) — nur für das Studio, die Übersicht ignoriert sie.
    /// `fluechtig`: irgendein Testschalter ist aktiv (`StartArgumente.fluechtig`) — gilt für beide Fenster: flüchtiger Web-Speicher,
    /// keine gemerkte Fensterposition. `vorStart`: Prüfung vor jedem Start der Brücke (Kern-Brücke: ist der Kern noch bereit?).
    func oeffne(node: URL, vault: URL?, skript: URL? = nil, kern: URL? = nil, umgebung: [String: String], arbeitsordner: URL? = nil,
                test: StartArgumente? = nil, fluechtig: Bool = false, vorschau: Bool = false,
                vorStart: (@Sendable () async -> Bool)? = nil, ki: KiRoute? = nil) {
        if let fenster {
            if fenster.isMiniaturized { fenster.deminiaturize(nil) }
            fenster.makeKeyAndOrderFront(nil)
            NSApp.activate()
            return
        }
        let bruecke = BrueckenVerbindung(node: node, vault: vault, skript: skript, kern: kern, umgebung: umgebung,
                                         arbeitsordner: arbeitsordner, vorStart: vorStart)
        let config = WKWebViewConfiguration()
        let test = art == .studio ? test : nil
        // Testlauf: flüchtiger Web-Speicher — die Seite liest und schreibt sonst den localStorage der echten App (Theme,
        // letzte Notiz, Spaltenbreiten), das Bild hinge dann vom letzten Lauf ab; und WebKit legte Daten unter
        // ~/Library/WebKit/<Bundle-ID> der installierten App an.
        let fluechtig = fluechtig || test != nil
        if fluechtig { config.websiteDataStore = .nonPersistent() }
        if test != nil { config.userContentController.addUserScript(StudioTestlauf.ruhigeAnimationen()) }
        config.setURLSchemeHandler(SchemaHandler(bruecke: bruecke, oberflaeche: oberflaeche), forURLScheme: NavigationsRegel.schema)
        config.userContentController.addScriptMessageHandler(Kanal(bruecke: bruecke, oberflaeche: oberflaeche, ki: oberflaeche == .studio ? ki : nil), contentWorld: .page, name: "brain")
        fehlerDrossel = MeldungsDrossel(grenze: AppAktion.maxFehlerJeFenster)
        let aktionsKanal = AktionsKanal(oberflaeche: oberflaeche, vault: { [weak self] in self?.aktuellerVault?() }) { [weak self] aktion in
            guard let self, let f = self.beiAktion else { return nil }
            if case .fehler = aktion, !self.laesstFehlerDurch() { return ["ok": false, "grund": "gedrosselt"] as [String: Any] }
            return await f(aktion, self)
        }
        config.userContentController.addScriptMessageHandler(aktionsKanal, contentWorld: .page, name: "aktion")
        let web = KortexWebView(frame: NSRect(x: 0, y: 0, width: 1200, height: 800), configuration: config)
        let ziel = oberflaeche.startURL
        let navigation = Navigation(oberflaeche: oberflaeche)
        navigation.beiGeladen = { [weak self] in self?.warteAufBereit() }
        navigation.beiFehler = { [weak self] grund in self?.log.schreibe("fenster-ladefehler \(self?.name ?? "") \(grund)") }
        web.navigationDelegate = navigation
        // Stürzt der WebContent-Prozess ab, lädt die App die Oberfläche neu (höchstens 3-mal in 60 s); das Studio bietet danach den Entwurf aus dem Journal an
        let lader = WebLaderWK()
        lader.web = web
        webLader = lader
        absturzBehandlung = WebAbsturzBehandlung(startURL: ziel, lader: lader, schreibe: { [weak self] zeile in self?.log.schreibe("\(zeile) \(self?.name ?? "")") })
        navigation.beiProzessEnde = { [weak self] in self?.absturzBehandlung?.prozessBeendet() }

        // Titelleiste wie bei modernen Mac-Apps: durchsichtig, ohne Titel, der Inhalt läuft darunter (fullSizeContentView), die Ampel sitzt in der
        // Seitenleiste. Die WebView fängt Klicks in der Titelleiste ab; die Seite meldet darum das Ziehen und den Doppelklick selbst
        // (Aktionen `fenster-ziehen`/`fenster-zoom`). Die Übersicht (Seite des Kerns) behält die klassische Titelleiste.
        let w: NSWindow
        var maske: NSWindow.StyleMask = [.titled, .closable, .miniaturizable, .resizable]
        if oberflaeche == .studio { maske.insert(.fullSizeContentView) }
        w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1200, height: 800), styleMask: maske, backing: .buffered, defer: false)
        w.isReleasedWhenClosed = false
        w.contentView = web
        w.title = standardTitel
        if oberflaeche == .studio {
            glasGewuenscht = glasStart?() ?? true
            glasMoeglich = richteGlasEin(w, web: web)
        }
        if oberflaeche == .studio {
            w.titlebarAppearsTransparent = true
            w.titleVisibility = .hidden
            w.collectionBehavior.insert(.fullScreenPrimary)
            w.minSize = StudioFenster.minimum
            // Erster Start (noch keine gemerkte Position): 85 % der sichtbaren Fläche, mittig. Danach gilt die gemerkte Größe — aber nie
            // unter dem heutigen Minimum (ältere Versionen erlaubten 900×600) und immer auf einem vorhandenen Bildschirm (der gemerkte kann
            // inzwischen abgesteckt sein). Testlauf: immer wie beim ersten Start, und die Position der echten App wird weder gelesen noch überschrieben.
            let ersterStart = fluechtig || UserDefaults.standard.string(forKey: "NSWindow Frame \(StudioFenster.rahmenName)") == nil
            if !fluechtig { w.setFrameAutosaveName(StudioFenster.rahmenName) }
            let hauptFlaeche = (NSScreen.main ?? NSScreen.screens.first)?.visibleFrame ?? CGRect(origin: .zero, size: CGSize(width: 1728, height: 1080))
            let rahmen: CGRect
            if ersterStart {
                rahmen = StudioFenster.startrahmen(sichtbar: hauptFlaeche)
            } else {
                var r = w.frame
                r.size = StudioFenster.mindestens(r.size)
                rahmen = FensterGeometrie.aufBildschirmHolen(r, bildschirme: NSScreen.screens.map(\.visibleFrame), minimum: StudioFenster.minimum)
            }
            if rahmen != w.frame { w.setFrame(rahmen, display: false) }
            if let g = test?.testFenster { w.setContentSize(g) } // `--test-fenster`: Inhaltsgröße in Punkten (mindestens die Mindestgröße)
            if ersterStart, test?.testFenster != nil { w.setFrame(FensterGeometrie.mittig(w.frame.size, in: hauptFlaeche), display: false) }
        } else {
            if !fluechtig { w.setFrameAutosaveName("BrainFenster") }
            if w.frame.origin == .zero { w.center() }
        }
        w.delegate = self
        if oberflaeche == .studio { richteAmpelEin(w, web: web, vorschau: vorschau) }
        if vorschau, art == .uebersicht { VorschauBand.anbringen(an: w) }

        self.bruecke = bruecke
        self.webView = web
        self.navigation = navigation
        self.test = test
        self.fenster = w
        w.makeKeyAndOrderFront(nil)
        NSApp.activate()
        web.load(URLRequest(url: ziel))
        log.schreibe("fenster-auf \(name) \(Int(w.frame.width))x\(Int(w.frame.height))")
        if test != nil { log.schreibe("fenster-inhalt \(name) \(Int(web.bounds.width))x\(Int(web.bounds.height))") }
    }

    func schliesse() { fenster?.close() }

    // MARK: Titelleiste: Ampel, Ziehen, Doppelklick

    /// Stellt die Titelleiste ein: Ampel mittig in der Kopfzeile (44 pt) mit 16 pt Einzug, dann sagt die App der Seite, wie viel Platz sie links
    /// braucht (`--ampel-platz`, `--ampel-hoehe`) und ob es die Vorschau ist (`data-vorschau`) — als Skript vor dem Laden jeder Seite.
    private func richteAmpelEin(_ w: NSWindow, web: WKWebView, vorschau: Bool) {
        positioniereAmpel(w)
        ampelVorschau = vorschau ? VorschauBand.text : nil
        let skript = FensterAmpel.skript(platz: ampelPlatz, hoehe: FensterAmpel.zeile, vorschauText: ampelVorschau, glas: glasGewuenscht, glasMoeglich: glasMoeglich)
        web.configuration.userContentController.addUserScript(WKUserScript(source: skript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }
    private var ampelVorschau: String?
    /// Liegt hinter der durchsichtigen WebView ein Seitenleisten-Material des Systems (Glas)? Dann ist die Seitenleiste der Seite durchsichtig.
    private var glasMoeglich = false
    /// Was die Einstellung „Seitenleiste durchscheinend“ will (Standard an); wirksam nur mit `glasMoeglich`.
    private var glasGewuenscht = true
    /// Liefert beim Fensterbau den gespeicherten Wunsch (nil → an).
    var glasStart: (() -> Bool)?

    /// Aktion `fenster-durchscheinend`: merkt den Wunsch und setzt/entfernt `data-glas` der Seite sofort. Das Material bleibt liegen; ohne `data-glas` deckt die Seite es ab.
    /// Liefert `wirkt` (möglich UND an) oder nil, wenn die Hülle kein Glas kann.
    func setzeGlas(_ an: Bool) -> Bool? {
        glasGewuenscht = an
        guard glasMoeglich else { return nil }
        let aendern = an ? "r.dataset.glas='1';" : "delete r.dataset.glas;"
        webView?.evaluateJavaScript("(function(){var r=document.documentElement;if(r){\(aendern)}})();", completionHandler: nil)
        return an
    }

    /// Legt ein Material des Systems (Seitenleiste) hinter die jetzt durchsichtige WebView des Studios. Gelingt das nicht (WebKit kennt den Schalter nicht),
    /// bleibt alles wie vorher und die Seite behält ihre deckende Seitenleiste.
    private func richteGlasEin(_ w: NSWindow, web: WKWebView) -> Bool {
        guard web.responds(to: NSSelectorFromString("_setDrawsBackground:")) else { return false }
        web.setValue(false, forKey: "drawsBackground")
        let inhalt = NSView(frame: NSRect(origin: .zero, size: w.contentLayoutRect.size))
        inhalt.autoresizesSubviews = true
        let material = NSVisualEffectView(frame: inhalt.bounds)
        material.material = .sidebar
        material.blendingMode = .behindWindow
        material.state = .active
        material.autoresizingMask = [.width, .height]
        web.frame = inhalt.bounds
        web.autoresizingMask = [.width, .height]
        inhalt.addSubview(material)
        inhalt.addSubview(web)
        w.contentView = inhalt
        return true
    }

    /// Aktion `darstellung`: das Fenster folgt dem Hell/Dunkel der Seite (system = wie der Mac).
    func setzeDarstellung(_ d: FensterDarstellung) {
        switch d {
        case .hell: fenster?.appearance = NSAppearance(named: .aqua)
        case .dunkel: fenster?.appearance = NSAppearance(named: .darkAqua)
        case .system: fenster?.appearance = nil
        }
    }

    /// Setzt die drei Knöpfe der Ampel in die Mitte der Kopfzeile. AppKit richtet sie bei Größenänderungen und nach dem Vollbild wieder
    /// nach seiner eigenen Titelleiste aus; darum ruft das Fenster dies nach jeder solchen Änderung erneut auf. Im Vollbild gibt es keine Ampel im Fenster.
    private func positioniereAmpel(_ w: NSWindow) {
        guard !w.styleMask.contains(.fullScreen),
              let schliessen = w.standardWindowButton(.closeButton), let ablegen = w.standardWindowButton(.miniaturizeButton),
              let zoom = w.standardWindowButton(.zoomButton), let leiste = schliessen.superview else { return }
        let abstand = ablegen.frame.minX - schliessen.frame.minX
        let hoehe = FensterAmpel.zeile
        if let behaelter = leiste.superview {
            behaelter.frame = NSRect(x: 0, y: w.frame.height - hoehe, width: w.frame.width, height: hoehe)
        }
        leiste.frame = NSRect(x: 0, y: 0, width: w.frame.width, height: hoehe)
        for (i, knopf) in [schliessen, ablegen, zoom].enumerated() {
            knopf.setFrameOrigin(NSPoint(x: FensterAmpel.einzug + CGFloat(i) * abstand, y: ((hoehe - knopf.frame.height) / 2).rounded()))
        }
        ampelPlatz = FensterAmpel.platz(rechterRandZoom: zoom.frame.maxX)
    }

    /// Meldet der Seite den Platz für die Ampel neu (nach Größenänderung, im Vollbild 0).
    private func meldeAmpel(vollbild: Bool = false) {
        guard let w = fenster, oberflaeche == .studio else { return }
        let imVollbild = vollbild || w.styleMask.contains(.fullScreen)
        if !imVollbild { positioniereAmpel(w) }
        let skript = FensterAmpel.skript(platz: imVollbild ? 0 : ampelPlatz, hoehe: imVollbild ? 0 : FensterAmpel.zeile, vorschauText: ampelVorschau, glas: glasGewuenscht, glasMoeglich: glasMoeglich)
        webView?.evaluateJavaScript(skript, completionHandler: nil)
    }

    func windowDidResize(_ notification: Notification) {
        guard let w = fenster, oberflaeche == .studio else { return }
        positioniereAmpel(w)
    }
    func windowDidEndLiveResize(_ notification: Notification) { meldeAmpel() }
    func windowWillEnterFullScreen(_ notification: Notification) { meldeAmpel(vollbild: true) }
    func windowDidExitFullScreen(_ notification: Notification) {
        meldeAmpel()
        // AppKit setzt die Titelleiste beim Verlassen des Vollbilds erst nach dieser Meldung zurück.
        DispatchQueue.main.async { [weak self] in self?.meldeAmpel() }
    }
    func windowDidChangeBackingProperties(_ notification: Notification) { meldeAmpel() }

    /// Aktion `fenster-ziehen`: Die Seite hat die Maustaste in einem leeren Teil der Kopfzeile gemeldet; das Fenster folgt der Maus, solange sie gedrückt bleibt.
    /// Das ursprüngliche Ereignis ist beim Eintreffen der Meldung meist schon weitergelaufen: nimmt die App das Drücken von der aktuellen Mausposition nach.
    func ziehe() {
        guard let w = fenster, !w.styleMask.contains(.fullScreen), NSEvent.pressedMouseButtons & 1 == 1 else { return }
        if let e = NSApp.currentEvent, e.type == .leftMouseDown, e.window === w { w.performDrag(with: e); return }
        guard let e = NSEvent.mouseEvent(with: .leftMouseDown, location: w.mouseLocationOutsideOfEventStream, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                         windowNumber: w.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1) else { return }
        w.performDrag(with: e)
    }

    /// Aktion `fenster-zoom`: Doppelklick in die Kopfzeile tut, was die Systemeinstellung für die Titelleiste sagt.
    func doppelklickKopf() {
        guard let w = fenster, !w.styleMask.contains(.fullScreen) else { return }
        switch TitelleistenDoppelklick.aus(einstellung: UserDefaults.standard.string(forKey: "AppleActionOnDoubleClick")) {
        case .zoomen: if w.styleMask.contains(.resizable) { w.zoom(nil) }
        case .ablegen: if w.styleMask.contains(.miniaturizable) { w.miniaturize(nil) }
        case .nichts: break
        }
    }

    /// Ein offenes Fenster nach vorn holen (aus dem Dock zurückholen, aktivieren).
    func nachVorn() {
        guard let fenster else { return }
        if fenster.isMiniaturized { fenster.deminiaturize(nil) }
        fenster.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }

    /// Höchstens `AppAktion.maxFehlerJeFenster` Meldungen `fehler` je Fensterleben kommen durch; die erste darüber steht als
    /// `js-fehler gedrosselt` im Protokoll, der Rest wird verworfen. Die Seite kann sonst mit `postMessage` in einer Schleife das
    /// Protokoll wegrotieren und die Diagnosezeilen verdrängen (Review SW-7).
    private func laesstFehlerDurch() -> Bool {
        switch fehlerDrossel.melde() {
        case .durchlassen:
            return true
        case .ersteDrosselung:
            log.schreibe("js-fehler gedrosselt nach \(fehlerDrossel.grenze) Meldungen — weitere werden verworfen")
            return false
        case .verwerfen:
            return false
        }
    }

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
    func waehleOrdner(titel: String?, vorschlag: URL?, startort: URL? = nil) async -> URL? {
        guard let fenster, ordnerDialog == nil else { return nil }
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = true
        panel.prompt = "Wählen"
        if let titel { panel.message = titel }
        panel.directoryURL = AppAktion.startort(fuer: vorschlag, fallback: startort ?? FileManager.default.homeDirectoryForCurrentUser)
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
    /// ist die Oberfläche noch nicht geladen: der Befehl wartet (höchstens `befehlsFrist`, 30 s), bis `window.studio.bereit === true`.
    /// Mehrere Befehle in kurzer Folge laufen in der Reihenfolge ihres Eintreffens; was die Frist überschreitet oder beim
    /// Schließen des Fensters noch wartet, steht als `befehl-verworfen` im Log.
    func sende(_ befehl: StudioBefehl) { sende(name: befehl.rawValue, skript: befehl.skript) }

    /// Wie `sende(_:)`, mit eigenem Skript für Befehle mit Angaben (`StudioBefehl.einrichtung(ab:weg:)`, Hinweise der App beim Start). `name` steht im Log.
    /// Das Skript baut die App selbst aus festen Werten oder über JSON (`StudioHinweis`), nie aus Text der Seite.
    func sende(name: String, skript: String) {
        guard webView != nil else { return }
        fenster?.makeKeyAndOrderFront(nil)
        wartendeBefehle.append((name, skript, ContinuousClock.now + Self.befehlsFrist))
        guard befehlsAufgabe == nil else { return } // der laufende Lauf nimmt den neuen Befehl der Reihe nach mit
        befehlsAufgabe = Task { @MainActor [weak self] in await self?.arbeiteBefehleAb() }
    }

    /// Führt die wartenden Befehle der Reihe nach aus, sobald die Oberfläche bereit ist. Ein Abbruch (Fenster zu) räumt
    /// `aufraeumen` auf; nur ein normales Ende (Liste leer) gibt den Lauf frei — ohne Unterbrechung zwischen Prüfung und Freigabe.
    private func arbeiteBefehleAb() async {
        while !Task.isCancelled, let naechster = wartendeBefehle.first {
            guard let web = webView else { return }
            if ContinuousClock.now >= naechster.frist {
                wartendeBefehle.removeFirst()
                log.schreibe("befehl-verworfen \(naechster.name) oberflaeche-nicht-bereit")
                continue
            }
            let bereit = try? await web.evaluateJavaScript("window.studio?.bereit === true")
            guard !Task.isCancelled else { return }
            if (bereit as? NSNumber)?.boolValue == true {
                wartendeBefehle.removeFirst()
                _ = try? await web.evaluateJavaScript(naechster.skript)
            } else {
                try? await Task.sleep(for: .milliseconds(100))
            }
        }
        if !Task.isCancelled { befehlsAufgabe = nil }
    }

    /// Ab jetzt startet die Werkstatt dieses Fensters ohne `--vault` (nach `vault-gewechselt`: ein Neustart nach einem Absturz liest
    /// dann `vaults.json` und kehrt nicht zum alten `--vault` zurück).
    func vaultArgumentEntfernen() {
        guard let b = bruecke else { return }
        Task { await b.ohneVaultArgument() }
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
        guard art == .studio, fenster != nil else { return true }
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
        guard art == .studio, !schliessenFreigegeben else { return true }
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
        // Der Testlauf startet schon mit dem ersten fertig geladenen Dokument: Wird die Oberfläche nie bereit (kaputtes
        // app.js), soll das Bild trotzdem entstehen — es zeigt dann, was der Nutzer sähe.
        if let web = webView { starteTestlauf(web) }
        bereitAufgabe?.cancel()
        let pruefung: String
        switch art {
        case .studio: pruefung = "window.studio && document.readyState === 'complete' ? 1 : null"
        case .uebersicht: pruefung = "window.__brain && window.__brain.ladezeit ? Math.round(window.__brain.ladezeit) : null"
        }
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

    /// Testschalter `--test-skript` / `--test-bild`: genau einmal je App-Lauf, sobald das erste Dokument des Studios geladen
    /// ist (Ablauf und Logzeilen: `StudioTestlauf`).
    private func starteTestlauf(_ web: WKWebView) {
        guard let t = test, !testGestartet, t.testBild != nil || t.testSkript != nil else { return }
        testGestartet = true
        let log = self.log
        testAufgabe = Task { @MainActor in await StudioTestlauf.fuehreAus(t, web: web, log: log) }
    }

    private func aufraeumen() {
        bereitAufgabe?.cancel()
        bereitAufgabe = nil
        testAufgabe?.cancel()
        testAufgabe = nil
        // Menübefehle, die noch auf die Oberfläche warteten, sind mit dem Fenster hinfällig — nicht still verschwinden lassen.
        befehlsAufgabe?.cancel()
        befehlsAufgabe = nil
        for b in wartendeBefehle { log.schreibe("befehl-verworfen \(b.name) fenster-zu") }
        wartendeBefehle.removeAll()
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
        absturzBehandlung = nil
        webLader = nil
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
