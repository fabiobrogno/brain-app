// werkstatt/browser-dienst.mjs — „Kortex im Browser“ (Paket W1): derselbe Handler wie in der App, als lokaler HTTP-Dienst NUR auf 127.0.0.1, mit Zugangsschutz (browser-zugang.mjs).
// Anders als entwicklung.mjs (nur Entwicklung und Tests, ohne Token) ist dieser Dienst für Benutzer gedacht: ohne gültigen Cookie antwortet er nur mit einer Hinweisseite.
// Eigene Routen unter /_kortex/ (nach der Anmeldung): Ordner prüfen/auflisten, zuletzt benutzt, git prüfen. Mit dem Geheimnis (Bearer, ohne Cookie): /_kortex/einlass, /_kortex/beenden.
import { createServer } from "node:http";
import { erzeugeHandler, MAX_KOERPER } from "./handler.mjs";
import { erzeugeZugang, pruefeAnfrage, SICHER } from "./browser-zugang.mjs";
import { pruefeOrdner, listeOrdner, startAuswahl, merkeZuletzt, pruefeGit, gitInstallHinweis, leseEinrichtung, schreibeEinrichtung } from "./browser-ordner.mjs";
import { leseSperre, veroeffentliche, gibFrei } from "./browser-sperre.mjs";
import { beendeLaufendes } from "../gemeinsam/git.mjs";
import { beendeAlleProzesse } from "../gemeinsam/prozess.mjs";
import { beendeVorgaenge } from "../gemeinsam/vaults.mjs";
import { testmodus } from "../gemeinsam/basis.mjs";
import { supportOrdner } from "../gemeinsam/plattform.mjs";

const JSON_KOPF = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const HINWEIS_KOPF = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'", "Referrer-Policy": "no-referrer" };
const SCHUTZ_KOPF = { "Cross-Origin-Resource-Policy": "same-origin", "Cross-Origin-Opener-Policy": "same-origin", "X-Frame-Options": "DENY" };
const hinweisSeite = (titel, text) => `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Kortex</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:34rem;margin:15vh auto;padding:0 1.5rem;color:#222}@media(prefers-color-scheme:dark){body{background:#16181c;color:#e6e6e6}}h1{font-size:1.2rem}</style></head>
<body><h1>${titel}</h1><p>${text}</p></body></html>`;
const ZUGANG_FEHLT = hinweisSeite("Kortex: Zugang fehlt", "Diese Seite ist nur über den Link erreichbar, den Kortex beim Start im Browser öffnet. Starte <b>kortex</b> noch einmal, dann öffnet sich ein neuer Tab.");
const LINK_UNGUELTIG = hinweisSeite("Kortex: Link abgelaufen", "Dieser Link wurde schon benutzt oder ist abgelaufen. Starte <b>kortex</b> noch einmal, dann öffnet sich ein neuer Tab.");

const text = (status, t) => ({ status, headers: { ...HINWEIS_KOPF }, body: Buffer.from(t) });
const json = (status, o, extra = {}) => ({ status, headers: { ...JSON_KOPF, ...extra }, body: Buffer.from(JSON.stringify(o)) });
const einfach = (status, t) => ({ status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }, body: Buffer.from(t) });

/**
 * Startet den Dienst. `vault` (optional) öffnet diesen Ordner, sonst gilt der aktive Vault aus vaults.json. `support`: Ordner der Sperrdatei (Standard: plattform.supportOrdner).
 * → { port, adresse, zugang, stoppe(), beendet: Promise }. Veröffentlicht Port und Geheimnis in der Sperrdatei, falls `sperre` gesetzt ist (der Aufrufer hat sie vorher beansprucht).
 */
export async function starteBrowserDienst({ vault, port: wunsch = 0, support = supportOrdner(), sperre = false, handlerOptionen = {}, beiBeenden } = {}) {
  const handler = erzeugeHandler({ ...(vault ? { vault } : {}), ...handlerOptionen });
  // KI-Konten beim Start abgleichen (wie die App): nicht im Testmodus, dort gäbe es echte Zugriffe auf den Benutzerordner
  if (!testmodus() || process.env.BRAIN_KONTEN_START === "1") { try { handler.konten.synchronisiere(); await handler.migrierePflege(); } catch { /* Stand wird beim Öffnen der KI-Konten gemeldet */ } }
  let server;
  const zugang = erzeugeZugang({ port: () => server.address().port });
  let beendet;
  const ende = new Promise((ok) => { beendet = ok; });
  let endeLaeuft = false;
  function stoppe() {
    if (endeLaeuft) return ende;
    endeLaeuft = true;
    try { beendeAlleProzesse(); } catch { /* egal */ }
    try { beendeLaufendes(); } catch { /* beenden wir trotzdem */ }
    try { beendeVorgaenge(); } catch { /* halbes Anlegen/Klonen zurücknehmen */ }
    if (sperre) { try { gibFrei(support); } catch { /* egal */ } }
    server.close(() => { beendet(); try { beiBeenden?.(); } catch { /* egal */ } });
    server.closeAllConnections?.();
    return ende;
  }

  async function liesKoerper(req) {
    const teile = []; let groesse = 0;
    for await (const s of req) { groesse += s.length; if (groesse > MAX_KOERPER) return { zuGross: true, teile: [] }; teile.push(s); }
    return { zuGross: false, teile };
  }
  const jsonKoerper = (teile) => { try { const o = JSON.parse(Buffer.concat(teile).toString("utf8") || "{}"); return o && typeof o === "object" ? o : {}; } catch { return null; } };

  // Eigene Routen hinter der Anmeldung. → Antwort oder null (dann der Handler der Werkstatt)
  function eigeneRoute(methode, pfad, teile) {
    if (!pfad.startsWith("/_kortex/")) return null;
    const unter = pfad.slice("/_kortex/".length);
    const sup = support;
    if (unter === "ordner/start" && methode === "GET") return json(200, startAuswahl(sup));
    if (unter === "einrichtung" && methode === "GET") return json(200, leseEinrichtung(sup));
    if (unter === "einrichtung" && methode === "POST") { const k = jsonKoerper(teile); return k ? json(200, schreibeEinrichtung(sup, k)) : json(400, { fehler: "Ungültige Anfrage" }); }
    if (unter === "git/pruefen" && methode === "GET") return json(200, pruefeGit());
    if (unter === "git/installieren" && methode === "POST") return json(200, { ok: false, stand: "fehlt", meldung: gitInstallHinweis() });
    if (["ordner/pruefen", "ordner/liste"].includes(unter) && methode === "POST") {
      const k = jsonKoerper(teile);
      if (!k) return json(400, { fehler: "Ungültige Anfrage" });
      if (unter === "ordner/liste") return json(200, listeOrdner(typeof k.pfad === "string" ? k.pfad : ""));
      const r = pruefeOrdner(k.pfad);
      if (r.ok && k.merke === true) merkeZuletzt(sup, r.pfad);
      return json(200, r);
    }
    return json(404, { fehler: "nicht gefunden" });
  }

  server = createServer(async (req, res) => {
    const antworte = (r) => { res.writeHead(r.status, { ...SCHUTZ_KOPF, ...(r.headers || {}) }); res.end(req.method === "HEAD" ? undefined : r.body); };
    try {
      const portJetzt = server.address().port;
      const methode = req.method;
      const url = new URL(req.url, "http://127.0.0.1");
      const pfad = url.pathname;
      const mitGeheimnis = pfad === "/_kortex/einlass" || pfad === "/_kortex/beenden";
      const vor = pruefeAnfrage({ methode, kopf: req.headers, port: portJetzt });
      // Einlass und Beenden kommen von einem Programm (kein Browser, kein Origin) und brauchen das Geheimnis; der Origin ist dort nicht Pflicht
      if (vor && !(mitGeheimnis && vor.text === "Herkunft fehlt")) return antworte(einfach(vor.status, vor.text));

      if (mitGeheimnis) {
        req.resume();
        if (methode !== "POST") return antworte(einfach(405, "Methode nicht erlaubt"));
        if (!zugang.geheimnisStimmt(zugang.bearer(req.headers.authorization))) return antworte(einfach(401, "Zugang fehlt"));
        if (pfad === "/_kortex/beenden") { antworte(json(200, { ok: true })); setTimeout(() => stoppe(), 20); return; }
        return antworte(json(200, { karte: zugang.neueKarte() }));
      }

      // Einlass-Karte einlösen: Cookie setzen, auf / umleiten (die Karte steht danach nicht mehr in der Adresse)
      if (pfad === "/" && url.searchParams.has("t")) {
        req.resume();
        if (!SICHER.has(methode)) return antworte(einfach(405, "Methode nicht erlaubt"));
        const sitzung = zugang.loeseEin(url.searchParams.get("t"));
        if (!sitzung) return antworte(text(403, LINK_UNGUELTIG));
        return antworte({ status: 303, headers: { Location: "/", "Set-Cookie": zugang.setzeCookie(sitzung), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }, body: Buffer.alloc(0) });
      }

      if (!zugang.hatSitzung(req.headers.cookie)) { req.resume(); return antworte(text(401, ZUGANG_FEHLT)); }

      const { zuGross, teile } = await liesKoerper(req);
      // Schreibende Anfragen mit Inhalt müssen JSON sein (kein Formular/text/plain von fremden Seiten).
      if (!SICHER.has(methode) && teile.length && !/^application\/json\s*(;|$)/i.test(String(req.headers["content-type"] || ""))) return antworte(json(415, { fehler: "Nur JSON erlaubt" }));
      if (zuGross) return antworte(json(413, { fehler: "Anfrage zu groß" }));

      const eigen = eigeneRoute(methode, pfad, teile);
      if (eigen) return antworte(eigen);

      let r;
      try { r = await handler({ methode, pfad, query: url.search.slice(1), body: teile.length ? Buffer.concat(teile) : undefined }); }
      catch { r = json(500, { fehler: "Interner Fehler" }); }
      let koerper = r.body;
      // Die Seite bekommt die Browser-Hülle (huelle-browser.js, ein klassisches Skript vor allen Modulen); in der App wird sie nie geladen
      if (r.status === 200 && (pfad === "/" || pfad === "/index.html") && Buffer.isBuffer(koerper)) {
        const s = koerper.toString("utf8");
        if (s.includes('<script src="fehlerhaken.js"></script>')) koerper = Buffer.from(s.replace('<script src="fehlerhaken.js"></script>', '<link rel="stylesheet" href="huelle-browser.css">\n<script src="huelle-browser.js"></script>\n<script src="fehlerhaken.js"></script>'));
      }
      antworte({ status: r.status, headers: { "Cache-Control": "no-store", ...(r.headers || {}) }, body: koerper });
      if (r.stopp) setTimeout(() => stoppe(), 20);
    } catch {
      try { antworte(json(500, { fehler: "Interner Fehler" })); } catch { /* Verbindung weg */ }
    }
  });
  server.requestTimeout = 0; // Long-Poll auf Ereignisse und Fragen
  server.headersTimeout = 30_000;

  await new Promise((ok, nein) => { server.once("error", nein); server.listen(wunsch, "127.0.0.1", ok); });
  const port = server.address().port;
  if (sperre) veroeffentliche(support, { ...(leseSperre(support) || { pid: process.pid, start: "" }), pid: process.pid, port, geheimnis: zugang.geheimnis() });
  return { port, adresse: `http://127.0.0.1:${port}/`, zugang, stoppe, beendet: ende, handler };
}
