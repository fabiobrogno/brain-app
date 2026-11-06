// „Ein Fenster“ (Paket E1): Die Einrichtung ist ein Overlay IM Studio, nie ein zweites Fenster. Geprüft wird das Verhalten des Studios mit einer Attrappe der App:
// Overlay beim ersten Start, Studio dahinter inert, Tastatur (⌘↩, Esc, Rückfrage, gehaltene Tasten), Fortsetzen, Ende lädt den Vault IN der Seite, Überspringen legt nichts an,
// Karte, Menü und Seitenleiste öffnen dasselbe Overlay im selben Fenster, Hinweise der App als Banner. Die Rechte der Aktionen prüft Swift (EinrichtungsFensterTests).
import { test, expect } from "./basis.mjs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { starteStatisch, mockeEinrichtung, oeffneEinrichtungImStudio } from "./mocks-einrichtung.mjs";

const BILDER = process.env.UI_EINRICHTUNG_BILDER; // optional: Seitenbilder für die Augenkontrolle
let server;
test.beforeAll(async () => { server = await starteStatisch(); if (BILDER) mkdirSync(BILDER, { recursive: true }); });
test.afterAll(() => server?.stopp());

const sel = (a) => `[data-aktion="${a}"]`;
const bild = async (page, name, thema) => { if (BILDER) { await page.waitForTimeout(900); await page.screenshot({ path: join(BILDER, `${name}-${thema === "dark" ? "dunkel" : "hell"}.png`) }); } };
const anfragen = (z, pfad) => z.anfragen.filter((a) => a.pfad === pfad);
async function bereit(page) { await expect(page.locator(sel("start"))).toBeEnabled({ timeout: 6000 }); }
// Ein Merker im Fenster: überlebt kein Neuladen — so ist „dasselbe Fenster, dieselbe Seite“ beweisbar
const merke = (page) => page.evaluate(() => { window.__seite = "dieselbe"; });
const nochDieselbe = (page) => expect.poll(() => page.evaluate(() => window.__seite)).toBe("dieselbe");

// Sicherung „Nur auf diesem Mac“, KI „Ohne KI weiter“: bis zum letzten Schritt
async function zuFertig(page) {
  await expect(page.locator("#e-sync .e-lade")).toHaveCount(0, { timeout: 8000 });
  await page.click(sel("ohne"));
  await page.click(sel("weiter"));
  await expect(page.locator("#win")).toHaveAttribute("data-step", "3");
  await expect(page.locator(".ka-karte").first()).toBeVisible({ timeout: 8000 });
  await page.click(sel("weiter")); // Ohne KI weiter
  await expect(page.locator("#win")).toHaveAttribute("data-step", "4", { timeout: 8000 });
}

for (const thema of ["light", "dark"]) {
  test.describe(`Darstellung ${thema}`, () => {
    test.use({ colorScheme: thema });

    test("Erster Start: das Studio ist da, das Overlay liegt darüber, der Rest ist inert und abgedunkelt", async ({ page }) => {
      const z = await mockeEinrichtung(page, {});
      await oeffneEinrichtungImStudio(page, server.url, z);
      await bereit(page);
      await expect(page.locator("#einrichtung-host")).toBeVisible();
      await expect(page.locator("#einrichtung-host .e-win")).toHaveAttribute("role", "dialog");
      await expect(page.locator("body")).toHaveAttribute("data-einrichtung", "offen");
      await expect(page.locator("#app")).toHaveAttribute("inert", "");
      await expect(page.locator("#willkommen-host")).toHaveAttribute("inert", "");
      // der Zieh-Streifen und die Abdunkelung des Studios dahinter
      await expect(page.locator("#einrichtung-host .e-zieh")).toBeAttached();
      const streifen = await page.locator("#einrichtung-host .e-zieh").boundingBox();
      expect(streifen.height).toBeGreaterThanOrEqual(32);
      const grund = await page.evaluate(() => getComputedStyle(document.getElementById("einrichtung-host")).backgroundColor);
      expect(grund).toMatch(/^rgba\(/);
      // keine nachgemachte Ampel mehr, kein zweites Fenster
      await expect(page.locator(".e-ampel")).toHaveCount(0);
      expect(await page.evaluate(() => document.querySelectorAll("#einrichtung-host .e-win").length)).toBe(1);
      expect(z.seitenfehler).toEqual([]);
      await bild(page, "ef1-erster-start", thema);
    });

    test("Fortschritt als Pillen mit „N von M“; ⌘↩ weiter, ⌘[ zurück", async ({ page }) => {
      const z = await mockeEinrichtung(page, {});
      await oeffneEinrichtungImStudio(page, server.url, z);
      await bereit(page);
      await page.keyboard.press("Meta+Enter");
      await expect(page.locator("#win")).toHaveAttribute("data-step", "1");
      await expect(page.locator(".e-stand")).toContainText("Vault · 1 von 4");
      await expect(page.locator("#stepper button")).toHaveCount(4);
      await expect(page.locator('#stepper button[aria-current="step"]')).toHaveCount(1);
      await expect(page.locator(sel("weiter") + " .e-chip-key")).toHaveText("⌘ ↩");
      await bild(page, "ef2-pillen", thema);
      await page.keyboard.press("Meta+[");
      await expect(page.locator("#win")).toHaveAttribute("data-step", "0");
    });
  });
}

test.describe("Tastatur: Esc, Rückfrage und gehaltene Tasten", () => {
  test("Esc öffnet die Rückfrage, Esc schließt sie wieder; Vorgabe ist „Weiter einrichten“", async ({ page }) => {
    const z = await mockeEinrichtung(page, {});
    await oeffneEinrichtungImStudio(page, server.url, z);
    await bereit(page);
    await page.keyboard.press("Escape");
    await expect(page.locator(".dialog")).toContainText("Einrichtung überspringen?");
    await expect(page.locator(".dialog")).toContainText("Du findest sie in der Seitenleiste.");
    await expect(page.locator(sel("spaeter-nein"))).toBeFocused();
    // der Dialog liegt vor dem Overlay (nicht dahinter)
    const vorn = await page.evaluate(() => { const d = document.querySelector(".dialog").getBoundingClientRect(); return document.elementFromPoint(d.x + d.width / 2, d.y + 20)?.closest(".dialog") !== null; });
    expect(vorn).toBe(true);
    await page.waitForTimeout(450);
    await page.keyboard.press("Escape");
    await expect(page.locator(".dialog")).toHaveCount(0);
    expect(z.ende).toBeUndefined();
  });

  test("Gehaltenes Esc öffnet die Rückfrage nur einmal und schließt oder bestätigt sie nicht", async ({ page }) => {
    const z = await mockeEinrichtung(page, {});
    await oeffneEinrichtungImStudio(page, server.url, z);
    await bereit(page);
    const druck = (key, repeat, extra = {}) => page.evaluate(([k, r, e]) => document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: k, repeat: r, bubbles: true, cancelable: true, ...e })), [key, repeat, extra]);
    await page.evaluate(() => document.body.focus());
    await druck("Escape", false);
    await expect(page.locator(".dialog")).toBeVisible();
    for (let i = 0; i < 6; i++) { await druck("Escape", true); await druck("Enter", true); }
    await expect(page.locator(".dialog")).toBeVisible(); // wiederholte Tasten erreichen die Rückfrage nicht
    expect(z.ende).toBeUndefined();
  });

  test("Gleich nach dem Öffnen der Rückfrage gilt kein Esc und kein ↩ (400 ms Sperre)", async ({ page }) => {
    const z = await mockeEinrichtung(page, {});
    await oeffneEinrichtungImStudio(page, server.url, z);
    await bereit(page);
    await page.keyboard.press("Escape");
    await expect(page.locator(".dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Enter");
    await expect(page.locator(".dialog")).toBeVisible();
    await page.waitForTimeout(450);
    await page.keyboard.press("Escape");
    await expect(page.locator(".dialog")).toHaveCount(0);
  });

  test("Ein gehaltenes ⌘↩ geht nur einen Schritt weiter", async ({ page }) => {
    const z = await mockeEinrichtung(page, {});
    await oeffneEinrichtungImStudio(page, server.url, z);
    await bereit(page);
    await page.evaluate(() => {
      for (const repeat of [false, true, true, true]) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, repeat, bubbles: true, cancelable: true }));
    });
    await expect(page.locator("#win")).toHaveAttribute("data-step", "1");
    await page.waitForTimeout(300);
    await expect(page.locator("#win")).toHaveAttribute("data-step", "1");
  });

  test("Das Studio hinter dem Overlay hört nicht auf seine Kürzel (⌘K, ⌘N)", async ({ page }) => {
    const z = await mockeEinrichtung(page, {});
    await oeffneEinrichtungImStudio(page, server.url, z);
    await bereit(page);
    await page.keyboard.press("Meta+k");
    await page.keyboard.press("Meta+n");
    await expect(page.locator(".palette, [data-dialog='palette']")).toHaveCount(0);
    await expect(page.locator("#win")).toHaveAttribute("data-step", "0");
  });
});

test.describe("Ende, Fortsetzen, Überspringen", () => {
  test("Fortsetzen: mit vorhandenem Vault beginnt die Einrichtung bei der Sicherung, im selben Fenster", async ({ page }) => {
    const z = await mockeEinrichtung(page, { vault: { pfad: "/Users/test/Kortex", name: "Kortex" } });
    await oeffneEinrichtungImStudio(page, server.url, z, { ab: "sicherung" });
    await merke(page);
    await expect(page.locator("#win")).toHaveAttribute("data-step", "2", { timeout: 6000 });
    await expect(page.locator("#v-name")).toHaveText("Kortex");
    await nochDieselbe(page);
  });

  test("Ende „Fertig“: das Overlay geht zu, der Vault lädt IN der Seite, das Zeichen wandert in die Seitenleiste, Hinweis „Dein Vault ist bereit“", async ({ page }) => {
    const z = await mockeEinrichtung(page, {});
    await oeffneEinrichtungImStudio(page, server.url, z);
    await merke(page);
    await bereit(page);
    await page.click(sel("start"));
    await page.click(sel("weiter")); // Vault anlegen (Neuer Vault, ~/Kortex)
    await expect(page.locator("#win")).toHaveAttribute("data-step", "2", { timeout: 6000 });
    await zuFertig(page);
    const infoVorher = anfragen(z, "/api/info").length;
    await page.click(sel("weiter")); // Studio öffnen
    await expect.poll(() => z.ende, { timeout: 5000 }).toEqual({ art: "fertig" });
    await expect(page.locator(".e-flug")).toHaveCount(1); // das Zeichen fliegt (280 ms)
    await expect(page.locator("#einrichtung-host")).toBeHidden({ timeout: 4000 });
    // der Vault ist in der Seite geladen: Seitenleiste zeigt ihn, das Studio ist nicht mehr inert, kein Neuladen
    await expect(page.locator("#app")).toBeVisible();
    await expect(page.locator("#app")).not.toHaveAttribute("inert", "");
    await expect(page.locator("#vault-name")).toHaveText("Kortex");
    await expect(page.locator(".toast", { hasText: "Dein Vault ist bereit" })).toBeVisible();
    await expect(page.locator(".e-flug")).toHaveCount(0, { timeout: 2000 });
    await nochDieselbe(page);
    expect(anfragen(z, "/api/info").length).toBeGreaterThan(infoVorher);
    expect(z.aktionen.some((a) => a.aktion === "vault-gewechselt")).toBe(true);
    expect(await page.evaluate(() => window.studio.bereit)).toBe(true);
  });

  test.describe("reduzierte Bewegung", () => {
    test.use({ reducedMotion: "reduce" });
    test("Das Zeichen springt sofort statt zu wandern", async ({ page }) => {
      const z = await mockeEinrichtung(page, {});
      await oeffneEinrichtungImStudio(page, server.url, z);
      await bereit(page);
      await page.click(sel("start"));
      await page.click(sel("weiter"));
      await expect(page.locator("#win")).toHaveAttribute("data-step", "2", { timeout: 6000 });
      await zuFertig(page);
      await page.click(sel("weiter"));
      await expect(page.locator("#einrichtung-host")).toBeHidden({ timeout: 3000 });
      await expect(page.locator(".e-flug")).toHaveCount(0);
      await expect(page.locator("#vault-name")).toHaveText("Kortex");
    });
  });

  test("Überspringen ohne Vault legt nichts an und zeigt den leeren Zustand mit zwei Wegen und drei Tastenhinweisen", async ({ page }) => {
    const z = await mockeEinrichtung(page, {});
    await oeffneEinrichtungImStudio(page, server.url, z);
    await merke(page);
    await bereit(page);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(450);
    await page.click(sel("spaeter-ja"));
    await expect.poll(() => z.ende).toEqual({ art: "spaeter" });
    await expect(page.locator("#einrichtung-host")).toBeHidden({ timeout: 4000 });
    for (const pfad of ["/api/vaults/neu", "/api/vaults/oeffnen", "/api/vaults/klonen"]) expect(anfragen(z, pfad)).toHaveLength(0);
    await expect(page.locator(".w-leer h1")).toHaveText("Noch kein Vault");
    await expect(page.locator(".w-leer-knoepfe .knopf")).toHaveText(["Neuer Vault", "Ordner öffnen"]);
    await expect(page.locator(".w-leer-tipps kbd")).toHaveText(["⇧⌘O", "⌘E", "⌃⌘V"]);
    await expect(page.locator("#app")).toBeHidden();
    await nochDieselbe(page);
  });
});

test.describe("Karte, Menü und Seitenleiste öffnen dasselbe Overlay im selben Fenster", () => {
  async function leerNachUeberspringen(page, z) {
    await oeffneEinrichtungImStudio(page, server.url, z);
    await merke(page);
    await bereit(page);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(450);
    await page.click(sel("spaeter-ja"));
    await expect(page.locator("#einrichtung-host")).toBeHidden({ timeout: 4000 });
  }

  test("Karte „Kortex einrichten …“: bittet die App (Aktion) und das Overlay geht im selben Fenster wieder auf", async ({ page }) => {
    const z = await mockeEinrichtung(page, {});
    await leerNachUeberspringen(page, z);
    await page.click(sel("einrichtung-oeffnen"));
    await expect.poll(() => z.oeffnenAnfragen).toEqual([null]);
    await expect(page.locator("#einrichtung-host .e-win")).toBeVisible();
    await expect(page.locator("#win")).toHaveAttribute("data-step", "0");
    await nochDieselbe(page);
  });

  test("„Neuer Vault“ und „Ordner öffnen“: die Einrichtung beginnt gleich beim Vault-Schritt mit dem gewählten Weg", async ({ page }) => {
    const z = await mockeEinrichtung(page, {});
    await leerNachUeberspringen(page, z);
    await page.click(sel("leer-ordner-oeffnen"));
    await expect.poll(() => z.oeffnenAnfragen).toEqual([{ weg: "oeffnen" }]);
    await expect(page.locator("#win")).toHaveAttribute("data-step", "1", { timeout: 6000 });
    await expect(page.locator('[data-weg="oeffnen"]')).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(450);
    await page.click(sel("spaeter-ja"));
    await expect(page.locator("#einrichtung-host")).toBeHidden({ timeout: 4000 });
    await page.click(sel("leer-neuer-vault"));
    await expect(page.locator('[data-weg="neu"]')).toHaveAttribute("aria-checked", "true", { timeout: 6000 });
    await nochDieselbe(page);
  });

  test("Menü ⌘E (Befehl `einrichtung`) bei offenem Studio mit Vault: Overlay ab Sicherung, zweimal gesendet bleibt es ein Overlay", async ({ page }) => {
    const z = await mockeEinrichtung(page, { vault: { pfad: "/Users/test/Kortex", name: "Kortex" } });
    await oeffneEinrichtungImStudio(page, server.url, z, { ab: "sicherung" });
    await merke(page);
    await expect(page.locator("#win")).toHaveAttribute("data-step", "2", { timeout: 6000 });
    await page.evaluate(() => { window.studio.befehl("einrichtung", { ab: "sicherung" }); window.studio.befehl("einrichtung", { ab: "ki" }); });
    await expect(page.locator("#einrichtung-host .e-win")).toHaveCount(1);
    await expect(page.locator("#win")).toHaveAttribute("data-step", "2");
    await nochDieselbe(page);
  });

  test("Seitenleiste: der Eintrag „Kortex einrichten …“ öffnet die Einrichtung ab der Sicherung (Vault da)", async ({ page }) => {
    const z = await mockeEinrichtung(page, { vault: { pfad: "/Users/test/Kortex", name: "Kortex" } });
    await oeffneEinrichtungImStudio(page, server.url, z, { ab: "sicherung" });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(450);
    await page.click(sel("spaeter-ja"));
    await expect(page.locator("#einrichtung-host")).toBeHidden({ timeout: 4000 });
    await expect(page.locator("#einrichtung-zeile")).toBeVisible();
    await page.click("#einrichtung-zeile");
    await expect.poll(() => z.oeffnenAnfragen).toEqual([{ ab: "sicherung" }]);
    await expect(page.locator("#win")).toHaveAttribute("data-step", "2", { timeout: 6000 });
  });
});

test.describe("Hinweise der App beim Start", () => {
  test("Ein Hinweis erscheint als Banner (auch vor dem Overlay), „OK“ schließt ihn; der Text wird nie als HTML gelesen", async ({ page }) => {
    const z = await mockeEinrichtung(page, {});
    await oeffneEinrichtungImStudio(page, server.url, z);
    await page.evaluate(() => window.studio.hinweis({ titel: "Kortex: Hinweis zum Ordner „Brain“", text: "Der Ordner liegt jetzt unter <b>Kortex</b>." }));
    const hinweis = page.locator('[data-hinweis="start"]');
    await expect(hinweis).toBeVisible();
    await expect(hinweis).toContainText("<b>Kortex</b>");
    await expect(hinweis.locator("b")).toHaveCount(1); // nur der Titel ist fett, der Text bleibt Text
    const vorn = await page.evaluate(() => { const r = document.querySelector('[data-hinweis="start"]').getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('[data-hinweis="start"]') !== null; });
    expect(vorn).toBe(true);
    await page.click(sel("hinweis-ok"));
    await expect(hinweis).toHaveCount(0);
  });
});
