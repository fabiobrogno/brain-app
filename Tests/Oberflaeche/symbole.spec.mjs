// Einheitliches Symbol-Set des Studios: gleiche Strichstärke und feste Größenstufen (symbole.js), Marken-Logo GitHub (marken.js) bei der
// GitHub-Anmeldung und im Remote-Dialog. Läuft gegen die echte Werkstatt (Dateien kommen von dort).
// Optional Bilder für die visuelle Kontrolle: UI_ICON_BILDER=/Ordner/ npx playwright test symbole.spec.mjs
import { test, expect } from "./basis.mjs";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { mockeV2 } from "./mocks.mjs";

const STUDIO = fileURLToPath(new URL("../../Ressourcen/studio/", import.meta.url));
const LOGOS = fileURLToPath(new URL("../../Ressourcen/logos/", import.meta.url));
const BILDER = process.env.UI_ICON_BILDER;

// Statische Prüfung: Symbole werden nur in den festen Größenstufen angefordert (12, 14, 16, 20, 24; 56 nur für das große Kortex-Zeichen).
test("Größenstufen: kein Aufruf von symbol()/zeichen() mit einer anderen Größe", () => {
  const erlaubt = new Set([12, 14, 16, 20, 24, 56]);
  const falsch = [];
  for (const datei of readdirSync(STUDIO).filter((n) => n.endsWith(".js"))) {
    if (datei === "symbole.js") continue;
    const text = readFileSync(STUDIO + datei, "utf8");
    for (const m of text.matchAll(/\b(?:symbol|zeichen)\((?:"[a-z-]+"|[^(),]*(?:\([^()]*\))?[^(),]*), *(\d+)\)/g)) {
      if (!erlaubt.has(Number(m[1]))) falsch.push(`${datei}: ${m[0]}`);
    }
  }
  expect(falsch).toEqual([]);
});

let vault, server;
test.beforeEach(async () => { ({ vault } = baueVault()); server = await starteServer(vault); });
test.afterEach(() => server?.stopp());

const NOTIZ = "10_notizen/Reise nach Lissabon.md";
async function start(page) {
  await mockeV2(page, vault);
  await page.goto(server.url + "?pfad=" + encodeURIComponent(NOTIZ));
  await page.waitForSelector(".cm-content .cm-line");
}

test("symbol(): jedes Symbol hat das 16er-Raster und in jeder Größe 1,5 px Strich, GitHub ist kein Symbol mehr", async ({ page }) => {
  await start(page);
  const r = await page.evaluate(async () => {
    const m = await import("/symbole.js");
    const fehler = [];
    for (const name of m.symbolNamen) for (const g of Object.values(m.GROESSE)) {
      const s = m.symbol(name, g);
      const px = Number(s.getAttribute("stroke-width")) * g / 16;
      if (s.getAttribute("viewBox") !== "0 0 16 16" || Math.abs(px - 1.5) > 0.01 || s.getAttribute("stroke-linecap") !== "round" || !s.innerHTML.trim()) fehler.push(`${name}@${g}`);
    }
    return { fehler, github: m.symbolNamen.includes("github"), groessen: m.GROESSE, anzahl: m.symbolNamen.length };
  });
  expect(r.fehler).toEqual([]);
  expect(r.github).toBe(false);
  expect(r.groessen).toEqual({ klein: 12, text: 14, norm: 16, gross: 20, kachel: 24 });
  expect(r.anzahl).toBeGreaterThan(60);
});

test("symbol(\"marke\"): die Windung der App (eine durchgehende Linie aus vier Bahnen, keine Knoten), oben/unten spiegelgleich, im 16er Raster", async ({ page }) => {
  await start(page);
  const r = await page.evaluate(async () => {
    const m = await import("/symbole.js");
    const s = m.symbol("marke", 56);
    document.body.append(s);
    const pfad = s.querySelector("path");
    const b = pfad.getBBox();
    const d = pfad.getAttribute("d");
    s.remove();
    return { kreise: s.querySelectorAll("circle").length, pfade: s.querySelectorAll("path").length, d, box: { x: b.x, y: b.y, w: b.width, h: b.height } };
  });
  expect(r.kreise).toBe(0); // nicht mehr das Netz aus Knoten
  expect(r.pfade).toBe(1); // ein durchgehender Strang
  expect(r.d.match(/M/g)).toHaveLength(1);
  expect(r.d.match(/a[\d.]+ [\d.]+ 0 [01][01]/gi)).toHaveLength(3); // drei Wendungen: vier Bahnen
  const rand = 0.75; // halbe Strichstärke im Raster
  expect(r.box.x - rand).toBeGreaterThanOrEqual(0);
  expect(r.box.x + r.box.w + rand).toBeLessThanOrEqual(16);
  expect(r.box.y - rand).toBeGreaterThanOrEqual(0);
  expect(r.box.y + r.box.h + rand).toBeLessThanOrEqual(16);
  expect(Math.abs(r.box.x + r.box.w / 2 - 8)).toBeLessThan(0.05); // waagerecht und senkrecht mittig
  expect(Math.abs(r.box.y + r.box.h / 2 - 8)).toBeLessThan(0.05);
});

test("Marken-Logo GitHub: Pfad stimmt mit Ressourcen/logos/github.svg überein, Bild mit Namen, unbekannte Marke liefert nichts", async ({ page }) => {
  await start(page);
  const r = await page.evaluate(async () => {
    const m = await import("/marken.js");
    const e = m.markenLogo("github", 20);
    const d = m.markenLogo("github", 14, { dekorativ: true });
    return { rolle: e.getAttribute("role"), label: e.getAttribute("aria-label"), titel: e.title, pfad: e.querySelector("svg path").getAttribute("d"),
      dekorativ: d.getAttribute("aria-hidden"), dekorativRolle: d.getAttribute("role"), unbekannt: m.markenLogo("gitlab"), markup: m.markenLogoMarkup("nix") };
  });
  const quelle = /<path d="([^"]+)"/.exec(readFileSync(LOGOS + "github.svg", "utf8"))[1];
  expect(r).toEqual({ rolle: "img", label: "GitHub", titel: "GitHub", pfad: quelle, dekorativ: "true", dekorativRolle: null, unbekannt: null, markup: null });
});

test("GitHub-Karte: Logo in Überschrift und Anmelde-Knopf, Knopfname bleibt „Bei GitHub anmelden“", async ({ page }) => {
  await start(page);
  await page.route("**/api/github/konto", (route) => route.fulfill({ json: { verfuegbar: true, angemeldet: false } }));
  await page.route("**/api/github/anmelden", (route) => route.fulfill({ json: { zustand: "abgemeldet" } }));
  await page.evaluate(async () => {
    const { baueGitHubKarte } = await import("/github-karte.js");
    const k = baueGitHubKarte();
    k.knoten.style.cssText = "position:fixed;left:40px;top:40px;width:420px;z-index:200;background:var(--erhoben);padding:16px;border-radius:12px";
    document.body.append(k.knoten);
    await k.start();
  });
  const karte = page.locator('[data-bereich="github"]');
  await expect(karte.locator(".w-abschnitt .marken-logo[data-marke='github']")).toBeVisible();
  const knopf = karte.locator('[data-aktion="github-anmelden"]');
  await expect(knopf.locator(".marken-logo")).toBeVisible();
  await expect(knopf).toHaveText("Bei GitHub anmelden");
  await expect(karte.locator(".sym[data-name='github'], svg.sym")).toHaveCount(0);
  if (BILDER) {
    mkdirSync(BILDER, { recursive: true });
    await karte.screenshot({ path: `${BILDER}github-karte-${test.info().project.name}.png` });
  }
});

test("Remote-Dialog: bei einer GitHub-Adresse steht deren Logo im Kopf, sonst die Wolke", async ({ page }) => {
  await start(page);
  await page.evaluate(async () => { (await import("/remote.js")).oeffneRemoteDialog(); });
  const kopf = page.locator('[data-dialog="remote"] .rm-zeichen');
  const feld = page.locator("#rm-adresse");
  await expect(kopf.locator("svg.sym")).toHaveCount(1);
  await feld.fill("git@github.com:name/vault.git");
  await expect(kopf.locator(".marken-logo[data-marke='github']")).toBeVisible();
  await feld.fill("https://github.com/name/vault.git");
  await expect(kopf.locator(".marken-logo")).toBeVisible();
  await feld.fill("https://example.org/notgithub.com.git");
  await expect(kopf.locator("svg.sym")).toHaveCount(1);
  await expect(kopf.locator(".marken-logo")).toHaveCount(0);
});

test("Fokus: Tastaturfokus auf Seitenleiste, Werkzeug und Statusleiste zeigt denselben Ring (kein Standard-Umriss)", async ({ page }) => {
  await start(page);
  for (const sel of ['.eintrag[data-bereich]', "#knopf-neu", '[data-st="theme"]']) {
    const el = page.locator(sel).first();
    await el.focus();
    await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab"); // Tastatur-Fokus erzwingen (:focus-visible)
    const stil = await el.evaluate((e) => { const s = getComputedStyle(e); return { umriss: s.outlineStyle, schatten: s.boxShadow }; });
    expect(stil.umriss, sel).toBe("none");
    expect(stil.schatten, sel).not.toBe("none");
  }
});
