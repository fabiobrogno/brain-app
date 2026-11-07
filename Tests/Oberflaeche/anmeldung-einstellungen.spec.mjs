// Anmelden im Fenster in „KI & Konten“ (Einstellungen: Konto anmelden), Paket E3, zweiter Teil: das Panel aus anmeldung.js ersetzt den Terminalweg; die Werkstatt-Routen /api/ki/anmeldelauf*
// sind Attrappen (mocks-konten.mjs, z.lauf). Ohne z.lauf (Programm nicht gefunden) bleibt der bisherige Weg, ebenso nach „Im Terminal anmelden“.
import { test, expect } from "./basis.mjs";
import { realpathSync } from "node:fs";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { mockeV2 } from "./mocks.mjs";
import { mockeKonten, KONTEN, PROGRAMME } from "./mocks-konten.mjs";

let vault, server;
test.beforeEach(async () => { ({ vault } = baueVault()); vault = realpathSync.native(vault); server = await starteServer(vault); });
test.afterEach(() => server?.stopp());
const NOTIZ = "10_notizen/Reise nach Lissabon.md";
const FIRMA = { id: "k_aaaa0004", programm: "claude", programmName: "Claude Code", name: "Firma", standard: false, ordner: "~/.claude-firma", pfad: "/Users/test/.claude-firma", vorhanden: true, verbunden: false };
const dlg = (page, art) => page.locator(`[data-dialog="${art}"]`).first();

async function start(page, lauf, { dunkel = false } = {}) {
  await page.setViewportSize({ width: 1440, height: 900 });
  if (dunkel) await page.emulateMedia({ colorScheme: "dark" });
  await mockeV2(page, vault);
  const z = await mockeKonten(page, { vaults: [{ pfad: vault, name: "Mein Vault" }], konten: [KONTEN[0], FIRMA, KONTEN[2]].map((k) => ({ ...k })), programme: PROGRAMME,
    login: { k_aaaa0001: "angemeldet", k_aaaa0004: "nicht-angemeldet", k_aaaa0003: "angemeldet" } });
  z.lauf = lauf;
  await page.goto(server.url + "?pfad=" + encodeURIComponent(NOTIZ));
  await page.waitForSelector("#app:not([hidden])");
  await page.waitForFunction(() => window.__studioBereit === true);
  await page.evaluate(() => { location.hash = "#einstellungen/ki"; });
  await expect(page.locator("[data-einstellungen]")).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.kx-konto[data-konto="k_aaaa0004"]')).toBeAttached();
  return z;
}
const anmelden = (page) => page.locator('.kx-konto[data-konto="k_aaaa0004"] [data-aktion="konto-anmelden"]').click();

for (const dunkel of [false, true]) {
  test(`Einstellungen: „Anmelden …“ zeigt das Panel (Browser-Knopf, Link), kein Terminalbefehl; Abbrechen beendet den Lauf (${dunkel ? "dunkel" : "hell"})`, async ({ page }) => {
    const z = await start(page, { phase: "wait" }, { dunkel });
    await anmelden(page);
    const d = dlg(page, "anmelden");
    await expect(d.locator('[data-test="an-browser"]')).toHaveText("Im Browser anmelden");
    await expect(d.locator('[data-test="an-link"]')).toBeVisible();
    await expect(d.locator('[data-kx="befehl"]')).toBeHidden(); // der Terminalweg bleibt verborgen
    await expect(d.locator(".kx-schritte")).toBeHidden();
    expect(z.laeufe.find((l) => l.methode === "POST").body).toEqual({ programm: "claude", konto: "k_aaaa0004" });
    expect(z.log("/api/ki/anmelden")).toHaveLength(0); // kein Terminal
    await d.locator('[data-test="an-abbrechen"]').click();
    await expect(d).toBeHidden({ timeout: 5000 });
    expect(z.laeufe.some((l) => l.pfad.endsWith("/abbrechen"))).toBe(true);
  });
}

test("Einstellungen: ist die Anmeldung bestätigt, schließt der Dialog und das Konto steht auf „angemeldet“", async ({ page }) => {
  const z = await start(page, { phase: "wait" });
  await anmelden(page);
  const d = dlg(page, "anmelden");
  await expect(d.locator('[data-test="an-browser"]')).toBeVisible();
  z.login.k_aaaa0004 = "angemeldet";
  z.lauf = { phase: "ok", konto: { id: "k_aaaa0004", programm: "claude" } };
  await expect(d).toBeHidden({ timeout: 8000 });
  await expect(page.locator('.kx-konto[data-konto="k_aaaa0004"]')).toHaveAttribute("data-anmeldung", "angemeldet");
});

test("Rückfall: findet die Werkstatt das Programm nicht, läuft gleich der bisherige Weg (Befehl im Dialog)", async ({ page }) => {
  const z = await start(page, null);
  await anmelden(page);
  const d = dlg(page, "anmelden");
  await expect(d.locator('[data-kx="befehl"]')).toContainText("claude auth login");
  expect(z.log("/api/ki/anmelden")).toHaveLength(1);
});

test("„Im Terminal anmelden“ im Panel: der bisherige Weg übernimmt (Terminal, Abfrage im Hintergrund)", async ({ page }) => {
  const z = await start(page, { phase: "wait" });
  await anmelden(page);
  const d = dlg(page, "anmelden");
  await d.locator('[data-test="an-terminal"]').click();
  await expect(d.locator('[data-kx="befehl"]')).toContainText("claude auth login");
  expect(z.log("/api/ki/anmelden").length).toBeGreaterThan(0);
  expect(z.laeufe.some((l) => l.pfad.endsWith("/abbrechen"))).toBe(true); // der Lauf im Fenster ist beendet
});
