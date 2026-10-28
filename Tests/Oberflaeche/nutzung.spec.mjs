// Lokale Nutzungsmessung (FBL-72) in der Oberfläche: Statusleiste „KI-Nutzung“ öffnet die Auswertung aus .logs/mcp.log
// (meistgenutzte und nie abgerufene Wiki-Seiten); ohne Protokoll steht ein ruhiger Hinweis da, kein Fehler. Läuft gegen die echte Werkstatt.
import { test, expect } from "./basis.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { mockeV2 } from "./mocks.mjs";

let vault, server;
test.beforeEach(async () => { ({ vault } = baueVault()); server = await starteServer(vault); });
test.afterEach(() => server?.stopp());

const NOTIZ = "10_notizen/Reise nach Lissabon.md";
const zeile = (min, werkzeug, seiten) => `2026-10-28T10:${String(min).padStart(2, "0")}:00 sid=mcp werkzeug=${werkzeug} hits=${seiten.length ? encodeURIComponent(seiten.join("\t")) : "-"} ms=5 ok=1`;

async function start(page) {
  await mockeV2(page, vault);
  await page.goto(server.url + "?pfad=" + encodeURIComponent(NOTIZ));
  await page.waitForSelector(".cm-content .cm-line");
}

test("ohne Protokoll: ruhiger Hinweis statt Fehler, nichts als „nie abgerufen“ aufgelistet", async ({ page }) => {
  await start(page);
  await page.locator('[data-st="nutzung"]').first().click();
  const d = page.locator(".dialog");
  await expect(d.locator(".dialog-kopf")).toHaveText("Was die KI von deinem Wissen abruft");
  await expect(d.locator('[data-leer="nutzung"]')).toBeVisible();
  await expect(d.locator("[data-liste]")).toHaveCount(0);
  await expect(d.locator(".fehlertext")).toHaveCount(0);
});

test("nicht lesbares Protokoll: der Fehler steht da, nicht „noch keine Abrufe“", async ({ page }) => {
  mkdirSync(join(vault, ".logs", "mcp.log"), { recursive: true }); // Ordner statt Datei
  await start(page);
  await page.locator('[data-st="nutzung"]').first().click();
  const d = page.locator(".dialog");
  await expect(d.locator('[data-fehler="nutzung"]')).toContainText("Das Protokoll lässt sich nicht lesen");
  await expect(d.locator('[data-leer="nutzung"]')).toHaveCount(0);
});

test("mit Protokoll: meistgenutzt mit Anzahl, nie abgerufen ohne generierte Seiten; Klick öffnet die Seite", async ({ page }) => {
  mkdirSync(join(vault, ".logs"));
  writeFileSync(join(vault, ".logs", "mcp.log"), [
    zeile(1, "brain_lesen", ["09_wiki/wissen/Kaffee.md"]),
    zeile(2, "brain_suchen", ["09_wiki/wissen/Kaffee.md", "09_wiki/wissen/Espresso.md"]),
    zeile(3, "brain_vaults", []),
  ].join("\n") + "\n");
  await start(page);
  await page.locator('[data-st="nutzung"]').first().click();
  const d = page.locator(".dialog");
  await expect(d).toContainText("3 Aufrufe");
  const meist = d.locator('[data-liste="meist"] .nutzung-zeile');
  await expect(meist).toHaveCount(2);
  await expect(meist.nth(0)).toContainText("Kaffee");
  await expect(meist.nth(0)).toContainText("2×");
  await expect(meist.nth(1)).toContainText("Espresso");
  const nie = d.locator('[data-liste="nie"] .nutzung-seite');
  await expect(nie.first()).toBeVisible();
  const pfade = await nie.evaluateAll((els) => els.map((e) => e.getAttribute("data-pfad")));
  expect(pfade).toContain("09_wiki/wissen/Mühle.md");
  expect(pfade).not.toContain("09_wiki/wissen/Kaffee.md");
  expect(pfade.some((p) => /\/(_|INDEX)/.test(p) || p.endsWith("INDEX.md"))).toBe(false);
  await meist.nth(0).locator("button").click();
  await expect(page.locator(".dialog")).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText("Heißgetränk");
});
