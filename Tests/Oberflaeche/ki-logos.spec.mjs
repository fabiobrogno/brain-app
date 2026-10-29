// KI-Logos (ki-logos.js) im Studio: Statusleiste und Einstellungsmenü zeigen das Claude-Logo mit title/aria-label-Namen.
// Der Dialog „KI verbinden“ (Claude, Codex, Cursor) wird in willkommen.spec.mjs geprüft. Läuft gegen die echte Werkstatt.
// Optional Bilder für die visuelle Kontrolle: KI_LOGO_BILDER=/Ordner/ npx playwright test ki-logos.spec.mjs
import { test, expect } from "./basis.mjs";
import { mkdirSync } from "node:fs";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { mockeV2 } from "./mocks.mjs";

let vault, server;
test.beforeEach(async () => { ({ vault } = baueVault()); server = await starteServer(vault); });
test.afterEach(() => server?.stopp());

const NOTIZ = "10_notizen/Reise nach Lissabon.md";
async function start(page) {
  await mockeV2(page, vault);
  await page.goto(server.url + "?pfad=" + encodeURIComponent(NOTIZ));
  await page.waitForSelector(".cm-content .cm-line");
}

test("Statusleiste und Einstellungsmenü zeigen das Claude-Logo mit Namen", async ({ page }) => {
  await start(page);
  const st = page.locator('[data-st="claude"]').first();
  const logo = st.locator('[data-ki-logo="claude"]');
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute("title", "Claude");
  await expect(logo.locator("svg path")).toHaveCount(1);
  await page.locator('[data-st="einstellungen"]').first().click();
  const eintrag = page.locator('[data-menue="ki"]');
  await expect(eintrag.locator('[data-ki-logo="claude"]')).toBeVisible();
  await expect(eintrag.locator('[data-ki-logo="claude"]')).toHaveAttribute("title", "Claude");
});

for (const schema of ["hell", "dunkel"]) {
  test(`Bilder: Statusleiste und Menü (${schema})`, async ({ page }) => {
    test.skip(!process.env.KI_LOGO_BILDER, "nur mit KI_LOGO_BILDER");
    await page.emulateMedia({ colorScheme: schema === "hell" ? "light" : "dark" });
    await start(page);
    await page.locator('[data-st="einstellungen"]').first().click();
    await expect(page.locator('[data-menue="ki"] [data-ki-logo="claude"]')).toBeVisible();
    mkdirSync(process.env.KI_LOGO_BILDER, { recursive: true });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${process.env.KI_LOGO_BILDER}studio-statusleiste-menue-${schema}.png` });
    await page.locator(".menue").first().screenshot({ path: `${process.env.KI_LOGO_BILDER}studio-menue-${schema}.png` });
  });
}
