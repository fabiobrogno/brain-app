// Alle KI-Logos des Katalogs (ki-logos.js) im 20-px-Raster: gleiche optische Größe, mittig, Farbe nach Regel, in Hell und Dunkel gut lesbar.
// Optional Bilder: KI_LOGO_BILDER=/Ordner/ npx playwright test ki-logos-alle.spec.mjs
import { test, expect } from "./basis.mjs";
import { mkdirSync } from "node:fs";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { mockeV2 } from "./mocks.mjs";

let vault, server;
test.beforeEach(async () => { ({ vault } = baueVault()); server = await starteServer(vault); });
test.afterEach(() => server?.stopp());

async function raster(page, spalten = 6) {
  await mockeV2(page, vault);
  await page.goto(server.url + "?pfad=" + encodeURIComponent("10_notizen/Reise nach Lissabon.md"));
  await page.waitForSelector(".cm-content .cm-line");
  // Prüfseite im Studio: je Logo eine Kachel mit dem Logo in 20 px (feste Stufe wie in der Liste) und in 48 px (zum Messen), auf dem Hintergrund des Studios
  await page.evaluate(async (sp) => {
    const { kiLogo, kiKatalog } = await import("/ki-logos.js");
    document.querySelector("#kl-test")?.remove();
    const wurzel = document.createElement("div");
    wurzel.id = "kl-test";
    wurzel.style.cssText = `position:fixed;inset:0;z-index:99999;background:var(--bg, Canvas);color:var(--text, CanvasText);padding:20px;display:grid;grid-template-columns:repeat(${sp},170px);gap:10px;align-content:start;overflow:auto`;
    for (const e of kiKatalog()) {
      const kachel = document.createElement("div");
      kachel.dataset.kachel = e.id;
      kachel.style.cssText = "display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;background:var(--hover-2, rgba(128,128,128,.12))";
      const klein = kiLogo(e.id, 20, { dekorativ: true }), gross = kiLogo(e.id, 48, { dekorativ: true });
      klein.dataset.groesse = "20"; gross.dataset.groesse = "48";
      const name = document.createElement("span");
      name.textContent = e.name;
      name.style.cssText = "font:12px system-ui;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      kachel.append(klein, gross, name);
      wurzel.append(kachel);
    }
    document.body.append(wurzel);
  }, spalten);
  await page.waitForFunction(() => [...document.querySelectorAll("#kl-test img")].every((i) => i.complete));
}

test("jede KI des Katalogs hat ein Logo oder die Initiale; Namen, Beschriftung und Zahl stimmen", async ({ page }) => {
  await raster(page);
  const r = await page.evaluate(() => [...document.querySelectorAll('#kl-test [data-groesse="48"]')].map((el) => ({ id: el.dataset.kiLogo, bild: !!el.querySelector("svg, img, .ki-maske"), initiale: el.classList.contains("ki-logo-initiale"), dek: el.getAttribute("aria-hidden") })));
  expect(r.length).toBeGreaterThanOrEqual(40);
  for (const x of r) { expect(x.bild !== x.initiale, `${x.id}: entweder Logo oder Initiale`).toBe(true); expect(x.dek).toBe("true"); }
  // ohne echtes Logo: nur diese (Gründe in Ressourcen/logos/HERKUNFT.md)
  expect(r.filter((x) => x.initiale).map((x) => x.id).sort()).toEqual(["crush", "dsh", "hermes", "mimo-code"]);
});

test("48-px-Raster: jedes Logo füllt das Quadrat ähnlich stark, liegt in der Mitte und wird nicht abgeschnitten", async ({ page }) => {
  await raster(page);
  const werte = await page.evaluate(async () => {
    const aus = [];
    const { kiKatalog } = await import("/ki-logos.js");
    const bunt = new Set(kiKatalog().filter((e) => e.logo?.modus === "bild").map((e) => e.id));
    for (const el of document.querySelectorAll('#kl-test [data-groesse="48"]')) {
      const id = el.dataset.kiLogo;
      const svg = el.querySelector("svg"), mask = el.querySelector(".ki-maske"), img = el.querySelector("img");
      if (svg) {
        const b = svg.getBBox(), vb = svg.viewBox.baseVal;
        // Tinte in Teilen der Ansicht (getBBox misst Formen ohne Strich; reicht für den Größenvergleich)
        aus.push({ id, bunt: bunt.has(id), anteilB: b.width / vb.width, anteilH: b.height / vb.height, mitteX: (b.x + b.width / 2 - (vb.x + vb.width / 2)) / vb.width, mitteY: (b.y + b.height / 2 - (vb.y + vb.height / 2)) / vb.height });
      } else if (img || mask) {
        let quelle = img;
        if (mask) { quelle = new Image(); quelle.src = mask.style.getPropertyValue("--ki-maske").trim().replace(/^url\(/, "").replace(/\)$/, ""); await quelle.decode(); }
        const c = document.createElement("canvas"); c.width = c.height = 128;
        const g = c.getContext("2d"); g.drawImage(quelle, 0, 0, 128, 128);
        const d = g.getImageData(0, 0, 128, 128).data;
        let x0 = 128, y0 = 128, x1 = -1, y1 = -1;
        for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) if (d[(y * 128 + x) * 4 + 3] > 20) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        aus.push({ id, png: true, anteilB: (x1 - x0 + 1) / 128, anteilH: (y1 - y0 + 1) / 128, mitteX: ((x0 + x1 + 1) / 2 - 64) / 128, mitteY: ((y0 + y1 + 1) / 2 - 64) / 128 });
      } else aus.push({ id, initiale: true });
    }
    return aus;
  });
  const mitBild = werte.filter((w) => !w.initiale);
  expect(mitBild.length).toBeGreaterThanOrEqual(35);
  for (const w of mitBild) {
    const grosse = Math.max(w.anteilB, w.anteilH);
    expect(grosse, `${w.id}: längste Seite`).toBeGreaterThan(0.66);
    expect(grosse, `${w.id}: längste Seite`).toBeLessThanOrEqual(1);
    if (w.bunt && !w.png) continue; // mehrfarbige SVG: getBBox zählt auch Verläufe und Schatten mit, die Mitte lässt sich nur im Bild beurteilen
    expect(Math.abs(w.mitteX), `${w.id}: waagerecht mittig`).toBeLessThan(0.06);
    expect(Math.abs(w.mitteY), `${w.id}: senkrecht mittig`).toBeLessThan(0.06);
  }
  // die Streuung der längsten Seiten bleibt klein (Dichte-Ausgleich)
  const seiten = mitBild.map((w) => Math.max(w.anteilB, w.anteilH));
  expect(Math.max(...seiten) - Math.min(...seiten)).toBeLessThan(0.3);
});

for (const schema of ["hell", "dunkel"]) {
  test(`Farbe nach Regel und lesbar (${schema}): Marke nur mit genug Kontrast, sonst Textfarbe; Kontrast zum Hintergrund mindestens 3:1`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: schema === "hell" ? "light" : "dark" });
    await raster(page);
    const r = await page.evaluate(async () => {
      const { kiKatalog } = await import("/ki-logos.js");
      const modus = Object.fromEntries(kiKatalog().map((e) => [e.id, e.logo ? { modus: e.logo.modus, farbe: e.logo.farbe } : null]));
      const kachelHg = (el) => { let e = el; while (e) { const c = getComputedStyle(e).backgroundColor; if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") return c; e = e.parentElement; } return "rgb(255, 255, 255)"; };
      const text = getComputedStyle(document.querySelector("#kl-test")).color;
      return { text, modus, logos: [...document.querySelectorAll('#kl-test [data-groesse="20"]')].map((el) => ({ id: el.dataset.kiLogo, farbe: getComputedStyle(el).color, hg: kachelHg(el.parentElement.parentElement) })) };
    });
    const zahlen = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);
    const hex = (h) => `rgb(${[1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(", ")})`;
    const lum = (rgb) => { const c = rgb.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const kontrast = (a, b) => { const [x, y] = [lum(zahlen(a)), lum(zahlen(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    for (const l of r.logos) {
      const m = r.modus[l.id];
      if (!m || m.modus === "bild") continue; // Initiale bzw. Logo mit eigenen Farben
      if (m.modus === "marke") expect(l.farbe, `${l.id}: Markenfarbe`).toBe(hex(m.farbe));
      else expect(l.farbe, `${l.id}: Textfarbe`).toBe(r.text);
      expect(kontrast(l.farbe, l.hg), `${l.id} (${schema}): Kontrast`).toBeGreaterThanOrEqual(3);
    }
  });

  test(`Bild: alle Logos im Raster (${schema})`, async ({ page }) => {
    test.skip(!process.env.KI_LOGO_BILDER, "nur mit KI_LOGO_BILDER");
    await page.emulateMedia({ colorScheme: schema === "hell" ? "light" : "dark" });
    await page.setViewportSize({ width: 1100, height: 620 });
    await raster(page);
    mkdirSync(process.env.KI_LOGO_BILDER, { recursive: true });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${process.env.KI_LOGO_BILDER}alle-logos-${schema}.png` });
  });
}
