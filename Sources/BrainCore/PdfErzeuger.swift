import AppKit
import PDFKit
import WebKit

/// HTML → PDF für den Export (Aktion `export-pdf`). Die Seite wird in einer unsichtbaren WKWebView ohne JavaScript, mit flüchtigem Speicher und ohne Basisadresse gelegt
/// (das HTML bringt Bilder und Schrift als data: mit) — es kann nichts nachladen. `createPDF` liefert je Aufruf einen Ausschnitt; hier eine A4-Seite nach der anderen,
/// danach mit PDFKit zu einem Dokument zusammengesetzt. Seitenumbrüche fallen daher nach Höhe, nicht nach Absatz (die Electron-Hülle bricht mit `printToPDF` sauberer um).
@MainActor
public final class PdfErzeuger {
    /// A4 bei 72 Punkten je Zoll: so breit wird die Seite gelegt, so groß ist jede Seite des PDFs.
    public nonisolated static let seite = CGSize(width: 595, height: 842)
    public nonisolated static let maxSeiten = 400

    public init() {}

    /// Wartet, bis die Seite geladen ist, und lässt sonst nichts durch.
    private final class Lader: NSObject, WKNavigationDelegate {
        private var fortsetzung: CheckedContinuation<Bool, Never>?
        func warte(auf web: WKWebView, html: String) async -> Bool {
            await withCheckedContinuation { (f: CheckedContinuation<Bool, Never>) in
                fortsetzung = f
                web.navigationDelegate = self
                web.loadHTMLString(html, baseURL: nil)
            }
        }
        private func ende(_ ok: Bool) { fortsetzung?.resume(returning: ok); fortsetzung = nil }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { ende(true) }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: any Error) { ende(false) }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error) { ende(false) }
        func webView(_ webView: WKWebView, decidePolicyFor aktion: WKNavigationAction) async -> WKNavigationActionPolicy {
            let schema = aktion.request.url?.scheme
            return schema == nil || schema == "about" || schema == "data" ? .allow : .cancel
        }
    }

    /// nil, wenn die Seite nicht lädt, das PDF leer bleibt oder mehr als `maxSeiten` Seiten entstünden.
    public func erzeuge(html: String, seite: CGSize = PdfErzeuger.seite) async -> Data? {
        let konfig = WKWebViewConfiguration()
        konfig.websiteDataStore = .nonPersistent()
        konfig.defaultWebpagePreferences.allowsContentJavaScript = false
        let web = WKWebView(frame: CGRect(origin: .zero, size: seite), configuration: konfig)
        let lader = Lader()
        guard await lader.warte(auf: web, html: html) else { return nil }
        // Höhe des Inhalts (ein Skript der App läuft auch bei ausgeschaltetem JavaScript der Seite)
        let hoehe = ((try? await web.evaluateJavaScript("Math.ceil(document.documentElement.scrollHeight)")) as? NSNumber)?.doubleValue ?? seite.height
        let seiten = max(1, Int((hoehe / seite.height).rounded(.up)))
        guard seiten <= Self.maxSeiten else { return nil }
        web.frame = CGRect(x: 0, y: 0, width: seite.width, height: max(hoehe, seite.height))
        let dokument = PDFDocument()
        for i in 0..<seiten {
            let konf = WKPDFConfiguration()
            konf.rect = CGRect(x: 0, y: CGFloat(i) * seite.height, width: seite.width, height: seite.height)
            guard let teil = try? await web.pdf(configuration: konf), let d = PDFDocument(data: teil), let s = d.page(at: 0) else { return nil }
            dokument.insert(s, at: dokument.pageCount)
        }
        return dokument.dataRepresentation()
    }
}
