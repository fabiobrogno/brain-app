// Kleine Testseite für einzelne Studio-Module (Verlauf, Diff, Dialoge) ohne die ganze App und ohne Werkstatt:
// ein eigener Dateiserver liefert nur Ressourcen/studio, die Seite hat Seitenleiste, Liste, Haupt und die Hosts für Dialoge/Toasts.
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

const HIER = dirname(fileURLToPath(import.meta.url));
export const STUDIO = join(HIER, "..", "..", "Ressourcen", "studio");
// Screenshots: standardmäßig in Tests/Oberflaeche/screenshots (ignoriert), mit KORTEX_BILDER in einen anderen Ordner
export const BILDER = process.env.KORTEX_BILDER || join(HIER, "screenshots");

const TYPEN = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".json": "application/json" };
export function starteDateien() {
  return new Promise((ok) => {
    const s = http.createServer((req, res) => {
      const pfad = decodeURIComponent(new URL(req.url, "http://x").pathname);
      const datei = join(STUDIO, pfad === "/" ? "index.html" : pfad);
      if (!datei.startsWith(STUDIO) || !existsSync(datei) || statSync(datei).isDirectory()) { res.writeHead(404, { "content-type": "application/json" }); return res.end("{}"); }
      res.writeHead(200, { "content-type": TYPEN[extname(datei)] || "application/octet-stream", "cache-control": "no-store" });
      res.end(readFileSync(datei));
    });
    s.listen(0, "127.0.0.1", () => ok({ url: `http://127.0.0.1:${s.address().port}/`, stopp: () => s.close() }));
  });
}

export const SEITE = `<!doctype html><html lang="de"><head><meta charset="utf-8"><link rel="stylesheet" href="/studio.css">
<style>
 #t-rahmen { position: fixed; inset: 0; display: grid; grid-template-columns: 252px 340px minmax(0, 1fr); background: var(--papier); }
 #t-seite { background: var(--seite); border-right: 1px solid var(--linie); }
 #t-liste { display: flex; flex-direction: column; min-height: 0; background: var(--liste); border-right: 1px solid var(--linie); }
 #t-kopf { height: 48px; flex: none; display: flex; align-items: center; gap: 8px; padding: 0 16px; font-weight: 650; font-size: 15px; border-bottom: 1px solid var(--linie); }
 #t-host { flex: 1; min-height: 0; overflow-y: auto; }
 #t-haupt { position: relative; min-width: 0; min-height: 0; }
 #t-diff { position: absolute; inset: 0; }
</style></head><body>
<div id="t-rahmen"><div id="t-seite"></div><section id="t-liste"><header id="t-kopf">Verlauf</header><div id="t-host"></div></section><main id="t-haupt"><div id="t-diff"></div></main></div>
<div id="dialog-host"></div><div id="toast-host"></div></body></html>`;

export async function oeffneSeite(page, basis) {
  await page.route(/\/__verlauf-test\.html$/, (route) => route.fulfill({ contentType: "text/html", body: SEITE }));
  await page.goto(basis + "__verlauf-test.html");
  await page.evaluate(() => { window.__ruf = []; window.__offen = []; window.__ereignis = []; });
}

// sichtbar = im Layout UND nicht per opacity 0 (Einblend-Elemente)
export async function sichtbar(expect, locator) {
  await expect(locator).toBeVisible();
  await expect.poll(() => locator.evaluate((el) => { let o = 1; for (let e = el; e; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity); return o; })).toBeGreaterThan(0.95);
}
