// Paket „Darstellung“: Farbschemata, Akzente, Dichte, Schrift, Größe, Zeilenbreite, Symbole, Zurücksetzen, Änderung von außen, Browser-Modus — gegen die echte Werkstatt mit Wegwerf-Vault.
// Kontrast: jedes Schema × jede Akzentfarbe (Text, Zweittext, Akzent als Text, Text auf Akzent, Ränder). UI_SHOTS=<Ordner> legt die Bildschirmfotos dort ab.
import { test, expect } from "./basis.mjs";
import { join } from "node:path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";

let vault, server;
test.beforeEach(async () => { ({ vault } = baueVault()); server = await starteServer(vault); });
test.afterEach(() => server?.stopp());

const appDatei = () => { const p = join(server.support, "einstellungen.json"); return existsSync(p) && readFileSync(p, "utf8").trim() ? JSON.parse(readFileSync(p, "utf8")) : {}; };
const html = (page) => page.locator("html");
const zeile = (page, id) => page.locator(`[data-zeile="${id}"]`);
const warteSpeichern = (page) => page.waitForResponse((r) => r.url().includes("/api/einstellungen") && r.request().method() === "PUT");
async function start(page, { breite = 1440, hoehe = 900, dunkel = false, hash = "" } = {}) {
  await page.setViewportSize({ width: breite, height: hoehe });
  if (dunkel) await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(server.url + hash);
  await page.waitForFunction(() => window.__studioBereit === true);
}
async function oeffne(page) {
  await page.evaluate(() => { location.hash = "#einstellungen/darstellung"; });
  await expect(zeile(page, "akzent")).toBeVisible();
}
const setze = (page, k, v) => page.evaluate(async ([kk, vv]) => { const m = await import("/darstellung.js"); const d = await (await fetch("/api/einstellungen")).json(); const r = await fetch("/api/einstellungen", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ werte: { [kk]: vv }, stand: d.stand }) }); return [m.STANDARD.akzent, r.status]; }, [k, v]);
const schreibeDatei = (obj) => writeFileSync(join(server.support, "einstellungen.json"), JSON.stringify(obj));
const shots = () => { const d = process.env.UI_SHOTS || "screenshots"; mkdirSync(d, { recursive: true }); return d; };

// ---------------------------------------------------------------- Kontrast
test("Kontrast je Schema und Akzent: Text, Zweittext, Akzent, Text auf Akzent, Ränder ≥ WCAG AA", async ({ page }) => {
  await start(page);
  const r = await page.evaluate(async () => {
    const m = await import("/darstellung.js");
    const probe = document.createElement("div"); probe.style.cssText = "position:fixed;left:-99px;top:0;width:10px;height:10px"; document.body.append(probe);
    const rgba = (token) => { probe.style.color = `var(${token})`; const c = getComputedStyle(probe).color; const n = c.match(/[\d.]+/g).map(Number); return c.startsWith("color(") ? [...n.slice(0, 3).map((v) => v * 255), n[3] ?? 1] : [n[0], n[1], n[2], n[3] ?? 1]; };
    const mische = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3]));
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const kon = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const fehler = [], schlechtest = {};
    const pruefe = (name, ist, min) => { const kat = name.replace(/ --[\w-]+/g, "").replace(/ (hell|dunkel)-\S+/, ""); schlechtest[kat] = Math.min(schlechtest[kat] ?? 99, Math.round(ist * 100) / 100); if (ist < min) fehler.push(`${name}: ${ist.toFixed(2)} < ${min}`); };
    let kombis = 0;
    for (const modus of ["hell", "dunkel"]) for (const [schema] of m.SCHEMATA[modus]) for (const [akzent] of m.AKZENTE) {
      m.wendeDarstellungAn({ erscheinung: modus, [modus === "hell" ? "schemaHell" : "schemaDunkel"]: schema, akzent }, { systemDunkel: false });
      kombis++;
      const k = `${modus}-${schema}/${akzent}`;
      const fl = ["--papier", "--seite", "--erhoben"].map((t) => [t, rgba(t).slice(0, 3)]);
      const text = rgba("--text").slice(0, 3), text2 = rgba("--text-2").slice(0, 3), text3 = rgba("--text-3").slice(0, 3), ak = rgba("--akzent").slice(0, 3);
      const tinte = rgba("--akzent-tinte").slice(0, 3), auf = rgba("--akzent-text").slice(0, 3);
      for (const [t, bg] of fl) {
        pruefe(`Text auf ${t} ${k}`, kon(text, bg), 4.5);
        pruefe(`Zweittext auf ${t} ${k}`, kon(text2, bg), 4.5);
        pruefe(`Drittext auf ${t} ${k}`, kon(text3, bg), 3);
        pruefe(`Akzent als Text auf ${t} ${k}`, kon(ak, bg), 4.5);
        if (t !== "--erhoben") pruefe(`Akzenttinte auf ${t} ${k}`, kon(tinte, bg), 4.5);
      }
      pruefe(`Text auf Akzentfläche ${k}`, kon(auf, ak), 4.5);
      // Ränder: „Kontrast hoch“ verlangt 3:1 (WCAG 1.4.11) für Feldränder und Trennlinien; die anderen Schemata zeichnen Linien bewusst zart
      const papier = rgba("--papier").slice(0, 3);
      if (schema === "kontrast") {
        pruefe(`Feldrand auf Papier ${k}`, kon(mische(rgba("--eingabe"), papier), papier), 3);
        pruefe(`Linie (stark) auf Papier ${k}`, kon(mische(rgba("--linie-stark"), papier), papier), 3);
      }
    }
    probe.remove();
    return { fehler, kombis, schlechtest };
  });
  console.log("Schlechtester Kontrast je Art:", JSON.stringify(r.schlechtest));
  expect(r.kombis).toBe(7 * 9);
  expect(r.fehler).toEqual([]);
});
