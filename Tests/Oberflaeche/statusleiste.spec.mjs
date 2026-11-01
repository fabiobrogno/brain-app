// Statusleiste bei 1440 / 1280 / 1100 px mit offenem Frag-Panel und offener Infospalte: Die Leiste läuft über die ganze Fensterbreite. Ab 1280 px steht jeder sichtbare Teil ungekürzt da (kein „…“);
// was nicht mehr passt, fällt nach Rang GANZ weg (Format, Version, Wörter), darunter verlieren KI-Nutzung, Verlauf und Gesundheit ihre Beschriftung. Wie in einer frischen Vorschau: Vault ohne Remote
// (der Zweig steht ohne Verbindung da, „Kein Remote“), Konto „Claude Code“ ohne eingerichtetes Kontingent (der längste Zustand), Gesundheit ohne Warnung (ein neuer Vault warnt nicht).
// Attrappen: Konten und Kontingent (mocks-konten.mjs, mocks-kontingent.mjs) und /api/gesundheit; der Rest läuft gegen die echte Werkstatt.
import { test, expect } from "./basis.mjs";
import { realpathSync } from "node:fs";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { mockeV2 } from "./mocks.mjs";
import { mockeKonten } from "./mocks-konten.mjs";
import { mockeKontingent, ZUSTAND as Z } from "./mocks-kontingent.mjs";

test.use({ timezoneId: "Europe/Berlin", locale: "de-DE" });

const KONTO = { id: "k_aaaa0001", programm: "claude", programmName: "Claude Code", name: "Claude Code", standard: true, ordner: "~/.claude", pfad: "/Users/test/.claude", vorhanden: true, verbunden: true };
const VARIANTEN = {
  "frische Vorschau (kein Remote, Kontingent nicht eingerichtet)": { remote: false, werte: Z.nichtEingerichtet() },
  "eingerichtet (Remote, Kontingent mit Werten)": { remote: true, werte: Z.claudeOk(42, 18) },
};

let server;
test.afterEach(() => { server?.stopp(); server = null; });

async function starte(page, { remote, werte, breite, warnungen = 0 }) {
  let { vault } = baueVault({ mitRemote: remote });
  vault = realpathSync(vault);
  server = await starteServer(vault);
  await page.setViewportSize({ width: breite, height: 900 });
  await mockeV2(page, vault);
  await mockeKonten(page, { vaults: [{ pfad: vault, name: "Mein Vault" }], konten: [KONTO], programme: [], login: { k_aaaa0001: "angemeldet" } });
  await mockeKontingent(page, { konten: [KONTO], werte: { k_aaaa0001: werte } });
  await page.route("**/api/gesundheit", (r) => r.fulfill({ json: { verfuegbar: true, ampel: warnungen ? "gelb" : "gruen", warnungen } }));
  await page.goto(server.url + "?pfad=" + encodeURIComponent("10_notizen/Reise nach Lissabon.md"));
  await page.waitForSelector("#app:not([hidden])");
  await page.waitForFunction(() => window.__studioBereit === true);
  await page.click("#knopf-frage");
  await expect(page.locator('[data-frage="panel"]')).toBeVisible();
  await page.click("#knopf-info");
  await page.waitForTimeout(500);
}

// Teile der Leiste, die nicht mehr in voller Breite stehen: gekürzter Text („…“, überlaufender Inhalt) — nur sichtbare Elemente
const abgeschnitten = (page) => page.evaluate(() => {
  const s = document.querySelector(".status");
  return [...s.querySelectorAll("*")]
    .filter((e) => e.getBoundingClientRect().width > 0 && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== "visible")
    .map((e) => `${e.dataset.st || e.className}: ${(e.textContent || "").trim()}`);
});
const sichtbar = (page, st) => page.evaluate((id) => { const e = document.querySelector(`.status [data-st="${id}"]`); return !!e && e.getBoundingClientRect().width > 0; }, st);
const ueberlauf = (page) => page.evaluate(() => { const s = document.querySelector(".status"); return { scroll: s.scrollWidth - s.clientWidth, doc: document.documentElement.scrollWidth - document.documentElement.clientWidth }; });

for (const [name, v] of Object.entries(VARIANTEN)) {
  for (const breite of [1440, 1280]) {
    test(`Statusleiste ${breite} px: ${name} — nichts mit „…“ gekürzt, alle Kernteile da (Frag und Infospalte offen)`, async ({ page }) => {
      await starte(page, { ...v, breite });
      expect(await abgeschnitten(page), `${breite} px`).toEqual([]);
      expect(await ueberlauf(page)).toEqual({ scroll: 0, doc: 0 });
      for (const st of ["sync", "geaendert", "verlauf", "zweig", "remote", "kontingent", "gesundheit", "nutzung", "theme", "einstellungen"]) expect(await sichtbar(page, st), `${st} bei ${breite} px`).toBe(true);
      const l = page.locator(".status");
      await expect(l.locator('[data-st="geaendert"]')).toContainText("Keine Änderungen");
      await expect(l.locator('[data-st="zweig"]')).toContainText("main");
      await expect(l.locator('[data-st="remote"]')).toContainText(v.remote ? "origin" : "Kein Remote");
      await expect(l.locator('[data-st="kontingent"]')).toContainText("Claude Code");
      if (!v.remote) await expect(l.locator('[data-st="kontingent"]')).toContainText("Kontingent nicht eingerichtet");
      await expect(l.locator('[data-st="gesundheit"]')).toContainText("Gesundheit");
      await expect(l.locator('[data-st="einstellungen"]')).toBeInViewport();
      // Rangfolge: bei 1280 fehlen Format, Version, Wörter ganz; bei 1440 steht noch Version und Wörter da
      expect(await sichtbar(page, "format"), "Format").toBe(false);
      expect(await sichtbar(page, "version"), "Version").toBe(breite > 1399);
      expect(await sichtbar(page, "woerter"), "Wörter").toBe(breite > 1349);
    });
  }

  test(`Statusleiste: ${name} — keine Warnung → Haken statt Zahl; bei Warnungen steht die Zahl da`, async ({ page }) => {
    await starte(page, { ...v, breite: 1440 });
    await expect(page.locator('.status [data-st="gesundheit"]')).toHaveClass(/gut/);
    await expect(page.locator('.status [data-st="gesundheit"] svg').last()).toBeVisible();
    await expect(page.locator('.status [data-st="gesundheit"]')).not.toContainText("2");
  });
}

test("Statusleiste: Warnungen der Gesundheit stehen als Zahl in der Leiste und lesbar (1280 px)", async ({ page }) => {
  await starte(page, { ...VARIANTEN["frische Vorschau (kein Remote, Kontingent nicht eingerichtet)"], breite: 1280, warnungen: 2 });
  await expect(page.locator('.status [data-st="gesundheit"]')).toContainText("Gesundheit");
  await expect(page.locator('.status [data-st="gesundheit"]')).toContainText("2");
  expect(await abgeschnitten(page)).toEqual([]);
});

test("Statusleiste 1100 px: nichts ragt über den Rand, das Zahnrad bleibt im Fenster; die Beschriftungen fallen nach Rang weg", async ({ page }) => {
  await starte(page, { ...VARIANTEN["frische Vorschau (kein Remote, Kontingent nicht eingerichtet)"], breite: 1100 });
  expect(await ueberlauf(page)).toEqual({ scroll: 0, doc: 0 });
  await expect(page.locator('.status [data-st="einstellungen"]')).toBeInViewport();
  for (const st of ["sync", "geaendert", "verlauf", "zweig", "remote", "gesundheit", "nutzung"]) expect(await sichtbar(page, st), st).toBe(true);
  for (const st of ["format", "version", "woerter"]) expect(await sichtbar(page, st), st).toBe(false);
  const text = (st) => page.evaluate((id) => document.querySelector(`.status [data-st="${id}"]`).innerText.trim(), st); // innerText: ohne ausgeblendete Beschriftung
  expect(await text("nutzung")).toBe("");
  expect(await text("verlauf")).toBe("");
});
