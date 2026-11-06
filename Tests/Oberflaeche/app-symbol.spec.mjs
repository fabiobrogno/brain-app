// Einstellungen → Darstellung → „App-Symbol“: eigene Kacheln (keine nativen Felder), die Wahl bleibt in der App-Datei einstellungen.json (gegen die echte Werkstatt,
// eigener Support-Ordner) und geht sofort über die Brücke (gemockt: window.webkit.messageHandlers.aktion) als `app-symbol` an Swift. UI_SHOTS=<Ordner>: Bildschirmfotos dort (sonst screenshots/).
import { test, expect } from "./basis.mjs";
import { join } from "node:path";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";

let vault, server;
test.beforeEach(async () => {
  ({ vault } = baueVault());
  writeFileSync(join(vault, "brain.config.json"), JSON.stringify({ name: "Kortex" }, null, 2) + "\n");
  server = await starteServer(vault);
});
test.afterEach(() => server?.stopp());

const shot = (name) => join(process.env.UI_SHOTS || "screenshots", `app-symbol-${name}.png`);
const appDatei = () => { const p = join(server.support, "einstellungen.json"); return existsSync(p) && readFileSync(p, "utf8").trim() ? JSON.parse(readFileSync(p, "utf8")) : {}; };
const NAMEN = ["standard", "dunkel", "graphit", "papier", "smaragd"];
const kachel = (page, w) => page.locator(`[data-schluessel="appSymbol"] [data-symbol="${w}"]`);
const aktionen = (page) => page.evaluate(() => window.__aktionen.filter((a) => a.aktion === "app-symbol"));

async function start(page, { dunkel = false, breite = 1440, bruecke = true } = {}) {
  await page.addInitScript((mit) => {
    window.__aktionen = [];
    if (mit) window.webkit = { messageHandlers: { aktion: { postMessage: async (m) => { window.__aktionen.push(m); return { ok: true }; } } } };
  }, bruecke);
  await page.setViewportSize({ width: breite, height: 900 });
  if (dunkel) await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(server.url + "#einstellungen/darstellung");
  await page.waitForSelector("#app:not([hidden])");
  await page.waitForFunction(() => window.__studioBereit === true);
  await expect(page.locator("[data-einstellungen]")).toBeVisible();
  await expect(page.locator(`.e-punkt[data-bereich="darstellung"][aria-current="true"]`)).toBeVisible();
}

test("Die Zeile „App-Symbol“: Titel, Text, fünf Kacheln mit Bild, Standard ist gewählt, keine nativen Felder", async ({ page }) => {
  await start(page);
  const zeile = page.locator('[data-zeile="app-symbol"]');
  await expect(zeile).toBeVisible();
  await expect(zeile.locator("[data-feld=titel]")).toHaveText("App-Symbol");
  await expect(zeile.locator("[data-feld=text]")).toHaveText("Gilt, solange Kortex läuft. Ist Kortex beendet und im Dock angeheftet, zeigt macOS das Standard-Symbol.");
  await expect(zeile.locator('[role="radiogroup"] [role="radio"]')).toHaveCount(5);
  await expect(zeile.locator("select, input[type=radio], input[type=color]")).toHaveCount(0);
  for (const n of NAMEN) {
    await expect(kachel(page, n).locator("img")).toHaveJSProperty("complete", true);
    expect(await kachel(page, n).locator("img").evaluate((i) => i.naturalWidth)).toBeGreaterThan(0);
  }
  await expect(kachel(page, "standard")).toHaveAttribute("aria-checked", "true");
  await expect(kachel(page, "smaragd")).toContainText("Smaragd");
  expect(await aktionen(page)).toEqual([]); // nur Ändern schickt etwas, nicht das Anzeigen
});

test("Wahl: bleibt in einstellungen.json, geht sofort als app-symbol an Swift, überlebt das Neuladen; „Standard“ geht ebenfalls an Swift", async ({ page }) => {
  await start(page);
  const put = page.waitForResponse((r) => r.url().includes("/api/einstellungen") && r.request().method() === "PUT");
  await kachel(page, "papier").click();
  await expect(kachel(page, "papier")).toHaveAttribute("aria-checked", "true");
  await expect(kachel(page, "standard")).toHaveAttribute("aria-checked", "false");
  expect(await aktionen(page)).toEqual([{ aktion: "app-symbol", wert: "papier" }]); // sofort, ohne auf die Datei zu warten
  await put;
  await expect.poll(() => appDatei().appSymbol).toBe("papier");
  await page.reload();
  await page.waitForFunction(() => window.__studioBereit === true);
  await expect(kachel(page, "papier")).toHaveAttribute("aria-checked", "true");
  // Standard: schickt „standard“ (Swift setzt das Bild zurück)
  const put2 = page.waitForResponse((r) => r.url().includes("/api/einstellungen") && r.request().method() === "PUT");
  await kachel(page, "standard").click();
  expect((await aktionen(page)).at(-1)).toEqual({ aktion: "app-symbol", wert: "standard" });
  await put2;
  await expect.poll(() => appDatei().appSymbol).toBe("standard");
});

test("Tastatur: Pfeile wechseln die Wahl, nur die gewählte Kachel ist per Tab erreichbar; ohne Brücke (Browser) bleibt es still", async ({ page }) => {
  await start(page);
  await kachel(page, "standard").focus();
  await page.keyboard.press("ArrowRight");
  await expect(kachel(page, "dunkel")).toHaveAttribute("aria-checked", "true");
  await expect(kachel(page, "dunkel")).toBeFocused();
  await expect(kachel(page, "dunkel")).toHaveAttribute("tabindex", "0");
  await expect(kachel(page, "standard")).toHaveAttribute("tabindex", "-1");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(kachel(page, "smaragd")).toHaveAttribute("aria-checked", "true"); // umlaufend
  expect((await aktionen(page)).map((a) => a.wert)).toEqual(["dunkel", "standard", "smaragd"]);
});

test("Ohne Brücke (Browser) speichert die Wahl trotzdem und es gibt keinen Fehler", async ({ page }) => {
  await start(page, { bruecke: false });
  const put = page.waitForResponse((r) => r.url().includes("/api/einstellungen") && r.request().method() === "PUT");
  await kachel(page, "graphit").click();
  await put;
  await expect.poll(() => appDatei().appSymbol).toBe("graphit");
});

test("Alles zurücksetzen schickt „standard“ an die App", async ({ page }) => {
  await start(page);
  const put = page.waitForResponse((r) => r.url().includes("/api/einstellungen") && r.request().method() === "PUT");
  await kachel(page, "dunkel").click();
  await put;
  await page.evaluate(() => { window.__aktionen.length = 0; });
  await page.click('.e-punkt[data-bereich="erweitert"]');
  await page.click('[data-aktion="zuruecksetzen"]');
  await page.click('.dialog [data-aktion="reset-ja"]');
  await expect.poll(() => aktionen(page).then((a) => a.at(-1)?.wert)).toBe("standard");
  await expect.poll(() => appDatei().appSymbol).toBeUndefined();
});

for (const dunkel of [false, true]) {
  test(`Bildschirmfoto der Zeile (${dunkel ? "dunkel" : "hell"}), gewählt: Papier`, async ({ page }) => {
    await start(page, { dunkel });
    await kachel(page, "papier").click();
    await page.mouse.move(0, 0);
    const zeile = page.locator('[data-abschnitt="darstellung-dock"]');
    await zeile.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await zeile.screenshot({ path: shot(dunkel ? "dunkel" : "hell") });
    await page.screenshot({ path: shot(`seite-${dunkel ? "dunkel" : "hell"}`) });
  });
}

test("Schmales Fenster: die Kacheln brechen um, nichts läuft über", async ({ page }) => {
  await start(page, { breite: 700 });
  const z = page.locator('[data-zeile="app-symbol"]');
  const box = await z.boundingBox();
  for (const n of NAMEN) {
    const b = await kachel(page, n).boundingBox();
    expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width + 1);
    expect(b.x).toBeGreaterThanOrEqual(box.x - 1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
