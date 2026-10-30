// „Lizenzen …“ im Einstellungsmenü (lizenzen.js): öffnet THIRD-PARTY-NOTICES.md in einem Dialog. Läuft gegen die echte Werkstatt;
// die Datei selbst liefert erst der App-Bau neben die Oberfläche, deshalb wird sie hier per Attrappe bereitgestellt (oder fehlt absichtlich).
import { test, expect } from "./basis.mjs";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { mockeV2 } from "./mocks.mjs";

let vault, server;
test.beforeEach(async () => { ({ vault } = baueVault()); server = await starteServer(vault); });
test.afterEach(() => server?.stopp());

const NOTIZ = "10_notizen/Reise nach Lissabon.md";
const TEXT = "# Hinweise zu Software von Dritten\n\nKortex steht unter MIT.\n\n| Teil | Lizenz |\n|---|---|\n| Node.js | MIT |\n\n## Sparkle 2.10.0\n\n```\nCopyright (c) Beispiel\n```\n";

async function start(page, datei) {
  await mockeV2(page, vault);
  await page.route("**/THIRD-PARTY-NOTICES.md", (r) => (datei === null
    ? r.fulfill({ status: 404, contentType: "application/json", body: '{"fehler":"nicht gefunden"}' })
    : r.fulfill({ status: 200, contentType: "text/markdown; charset=utf-8", body: datei })));
  await page.goto(server.url + "?pfad=" + encodeURIComponent(NOTIZ));
  await page.waitForSelector(".cm-content .cm-line");
  await page.locator('[data-st="einstellungen"]').first().click();
}

test("Einstellungen → „Lizenzen …“ zeigt die Datei mit Überschriften, Tabelle und Lizenztext", async ({ page }) => {
  await start(page, TEXT);
  await page.locator('[data-menue="lizenzen"]').click();
  const d = page.locator(".dialog");
  await expect(d.locator(".dialog-kopf")).toHaveText("Lizenzen");
  const text = d.locator('[data-lizenzen="text"]');
  await expect(text.locator("h2")).toHaveText("Hinweise zu Software von Dritten");
  await expect(text.locator("h3")).toHaveText("Sparkle 2.10.0");
  await expect(text).toContainText("Kortex steht unter MIT.");
  await expect(text.locator("pre").first()).toContainText("Node.js | MIT");
  await expect(text.locator("pre").last()).toContainText("Copyright (c) Beispiel");
  await page.locator('[data-aktion="lizenzen-zu"]').click();
  await expect(d).toHaveCount(0);
});

test("Fehlt die Datei, sagt der Dialog das, statt leer zu bleiben", async ({ page }) => {
  await start(page, null);
  await page.locator('[data-menue="lizenzen"]').click();
  await expect(page.locator('.dialog [data-lizenzen="fehlt"]')).toContainText("liegt in dieser Ausführung nicht bei");
});
