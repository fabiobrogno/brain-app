// Alle KI-Logos im 20-px-Raster (ki-logos.js): gleiche optische Größe, mittig, Farbe nach Regel, in Hell und Dunkel gut lesbar.
// Optional Bilder: KI_LOGO_BILDER=/Ordner/ npx playwright test ki-logos-alle.spec.mjs
import { test, expect } from "./basis.mjs";
import { mkdirSync } from "node:fs";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { mockeV2 } from "./mocks.mjs";

let vault, server;
test.beforeEach(async () => { ({ vault } = baueVault()); server = await starteServer(vault); });
test.afterEach(() => server?.stopp());

const IDS = ["claude", "codex", "cursor", "claude-desktop", "gemini", "copilot", "zed", "opencode", "warp"];
const MARKE = { claude: "rgb(217, 119, 87)", "claude-desktop": "rgb(217, 119, 87)", gemini: "rgb(142, 117, 178)" };

async function raster(page) {
  await mockeV2(page, vault);
  await page.goto(server.url + "?pfad=" + encodeURIComponent("10_notizen/Reise nach Lissabon.md"));
  await page.waitForSelector(".cm-content .cm-line");
  // Prüfseite im Studio: je Logo eine Kachel mit dem Logo in 20 px (feste Stufe wie im Assistenten) und in 48 px (zum Messen), auf dem Hintergrund des Studios
  await page.evaluate(async () => {
    const { kiLogo, kiLogoName } = await import("/ki-logos.js");
    document.querySelector("#kl-test")?.remove();
    const wurzel = document.createElement("div");
    wurzel.id = "kl-test";
    wurzel.style.cssText = "position:fixed;inset:0;z-index:99999;background:var(--bg, Canvas);color:var(--text, CanvasText);padding:24px;display:grid;grid-template-columns:repeat(3,200px);gap:16px;align-content:start";
    for (const id of ["claude", "codex", "cursor", "claude-desktop", "gemini", "copilot", "zed", "opencode", "warp"]) {
      const kachel = document.createElement("div");
      kachel.dataset.kachel = id;
      kachel.style.cssText = "display:flex;align-items:center;gap:12px;padding:12px;border-radius:10px;background:var(--hover-2, rgba(128,128,128,.12))";
      const klein = kiLogo(id, 20, { dekorativ: true }), gross = kiLogo(id, 48, { dekorativ: true });
      klein.dataset.groesse = "20"; gross.dataset.groesse = "48";
      const name = document.createElement("span");
      name.textContent = kiLogoName(id);
      name.style.cssText = "font:13px system-ui;flex:1";
      kachel.append(klein, gross, name);
      wurzel.append(kachel);
    }
    document.body.append(wurzel);
  });
}

test("20-px-Raster: jedes Logo füllt das Quadrat ähnlich stark (70 bis 97 %), liegt in der Mitte und wird nicht abgeschnitten", async ({ page }) => {
  await raster(page);
  const werte = await page.evaluate(() => [...document.querySelectorAll('#kl-test [data-groesse="48"]')].map((el) => {
    const id = el.dataset.kiLogo;
    const pfad = el.querySelector("svg path");
    if (!pfad) return { id, initiale: true };
    const box = el.getBoundingClientRect(), tinte = pfad.getBoundingClientRect();
    return { id, anteilB: tinte.width / box.width, anteilH: tinte.height / box.height,
      mitteX: (tinte.left + tinte.width / 2 - (box.left + box.width / 2)) / box.width, mitteY: (tinte.top + tinte.height / 2 - (box.top + box.height / 2)) / box.height };
  }));
  for (const w of werte) {
    if (w.initiale) { expect(w.id).toBe("codex"); continue; }
    const grosse = Math.max(w.anteilB, w.anteilH);
    expect(grosse, `${w.id}: längste Seite`).toBeGreaterThan(0.7);
    expect(grosse, `${w.id}: längste Seite`).toBeLessThan(0.97);
    expect(Math.abs(w.mitteX), `${w.id}: waagerecht mittig`).toBeLessThan(0.01);
    expect(Math.abs(w.mitteY), `${w.id}: senkrecht mittig`).toBeLessThan(0.01);
  }
  // die Streuung der längsten Seiten bleibt klein (Dichte-Ausgleich): höchstens 25 Prozentpunkte zwischen dichtestem und luftigstem Logo
  const seiten = werte.filter((w) => !w.initiale).map((w) => Math.max(w.anteilB, w.anteilH));
  expect(Math.max(...seiten) - Math.min(...seiten)).toBeLessThan(0.25);
});

for (const schema of ["hell", "dunkel"]) {
  test(`Farbe nach Regel und lesbar (${schema}): Marke nur Claude/Gemini, sonst Textfarbe; Kontrast zum Hintergrund mindestens 3:1`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: schema === "hell" ? "light" : "dark" });
    await raster(page);
    const r = await page.evaluate(() => {
      const kachelHg = (el) => { let e = el; while (e) { const c = getComputedStyle(e).backgroundColor; if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") return c; e = e.parentElement; } return "rgb(255, 255, 255)"; };
      const text = getComputedStyle(document.querySelector("#kl-test")).color;
      return { text, logos: [...document.querySelectorAll('#kl-test [data-groesse="20"]')].map((el) => ({ id: el.dataset.kiLogo, farbe: getComputedStyle(el).color, hg: kachelHg(el.parentElement.parentElement) })) };
    });
    const zahlen = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);
    const lum = (rgb) => { const c = rgb.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const kontrast = (a, b) => { const [x, y] = [lum(zahlen(a)), lum(zahlen(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    for (const l of r.logos) {
      if (l.id === "codex") continue;
      if (MARKE[l.id]) expect(l.farbe, `${l.id}: Markenfarbe`).toBe(MARKE[l.id]);
      else expect(l.farbe, `${l.id}: Textfarbe`).toBe(r.text);
      expect(kontrast(l.farbe, l.hg), `${l.id} (${schema}): Kontrast`).toBeGreaterThanOrEqual(3);
    }
  });

  test(`Bild: alle Logos im Raster (${schema})`, async ({ page }) => {
    test.skip(!process.env.KI_LOGO_BILDER, "nur mit KI_LOGO_BILDER");
    await page.emulateMedia({ colorScheme: schema === "hell" ? "light" : "dark" });
    await page.setViewportSize({ width: 760, height: 360 });
    await raster(page);
    mkdirSync(process.env.KI_LOGO_BILDER, { recursive: true });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${process.env.KI_LOGO_BILDER}alle-logos-${schema}.png` });
  });
}
