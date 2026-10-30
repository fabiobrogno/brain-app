// Baustein „KI-Auswahl“ (kiAuswahl in Ressourcen/studio/bausteine.js): Karten der gefundenen/beliebten KIs, aufklappbare durchsuchbare Liste,
// Mehrfachauswahl, Tastatur, ARIA, Hell/Dunkel, Layout. Läuft ohne App auf einer Testseite (Dateiserver aus modul-seite.mjs).
// Bilder: KI_LOGO_BILDER=/Ordner/ npx playwright test ki-auswahl.spec.mjs
import { test, expect } from "./basis.mjs";
import { mkdirSync } from "node:fs";
import { starteDateien } from "./modul-seite.mjs";

let dateien;
test.beforeAll(async () => { dateien = await starteDateien(); });
test.afterAll(() => dateien?.stopp());

const SEITE = `<!doctype html><html lang="de"><head><meta charset="utf-8">
<link rel="stylesheet" href="/studio.css"><link rel="stylesheet" href="/bausteine.css">
<style>body{overflow:auto} #w{padding:24px;background:var(--papier);width:560px} #w.schmal{width:340px}</style></head><body>
<div id="w"></div>
<script type="module">
import { kiAuswahl } from "/bausteine.js";
window.__ereignis = [];
window.__neu = (opt = {}) => {
  const w = document.getElementById("w"); w.replaceChildren(); w.classList.toggle("schmal", !!opt.schmal);
  window.__ka = kiAuswahl({ ...opt.baustein, waehlbar: opt.alleWaehlbar ? () => true : (e) => e.verbindbar, aufAenderung: (ids) => window.__ereignis.push(ids) });
  w.append(window.__ka.el);
  return window.__ka;
};
window.__bereit = true;
</script></body></html>`;

const GEFUNDEN = { claude: { gefunden: true, version: "2.1.310" }, codex: { gefunden: true, version: "0.162.1" } };

async function oeffne(page, baustein = {}, opt = {}) {
  await page.route(/\/__ka\.html$/, (route) => route.fulfill({ contentType: "text/html", body: SEITE }));
  await page.goto(dateien.url + "__ka.html");
  await page.waitForFunction(() => window.__bereit === true);
  await page.evaluate(([b, o]) => window.__neu({ ...o, baustein: b }), [baustein, opt]);
  await page.waitForFunction(() => [...document.querySelectorAll("#w img")].every((i) => i.complete));
  return page.locator("[data-ki-auswahl]");
}
const ereignisse = (page) => page.evaluate(() => window.__ereignis);

test("gefundene KIs stehen als Karten oben, mit Logo, Name und „Gefunden · Version“; der Rest ist zugeklappt", async ({ page }) => {
  const ka = await oeffne(page, { erkennung: GEFUNDEN, wert: ["claude"] });
  await expect(ka.locator(".ka-titel")).toHaveText("Auf diesem Computer gefunden");
  const karten = ka.locator(".ka-karte");
  await expect(karten).toHaveCount(2);
  await expect(karten.nth(0).locator(".ka-name")).toHaveText("Claude Code");
  await expect(karten.nth(0).locator(".ka-status")).toHaveText("Gefunden · 2.1.310");
  await expect(karten.nth(0).locator('[data-ki-logo="claude"] svg')).toHaveCount(1);
  await expect(karten.nth(0)).toHaveAttribute("aria-checked", "true");
  await expect(karten.nth(1).locator(".ka-name")).toHaveText("Codex");
  await expect(karten.nth(1)).toHaveAttribute("aria-checked", "false");
  const mehr = ka.locator(".ka-mehr");
  await expect(mehr).toHaveAttribute("aria-expanded", "false");
  await expect(mehr).toHaveText(/Weitere KIs anzeigen \(4[0-9]\)/);
  await expect(ka.locator(".ka-weitere-innen")).toBeHidden();
});

test("ohne Fund: die sechs beliebten KIs in fester Reihenfolge, „Nicht installiert“", async ({ page }) => {
  const ka = await oeffne(page, { erkennung: {} });
  await expect(ka.locator(".ka-titel")).toHaveText("Beliebte KIs");
  await expect(ka.locator(".ka-karte .ka-name")).toHaveText(["Claude Code", "Codex", "Cursor", "Gemini CLI", "GitHub Copilot", "OpenCode"]);
  await expect(ka.locator(".ka-karte .ka-status").first()).toHaveText("Nicht installiert");
  expect(await ka.locator(".ka-karte").evaluateAll((k) => new Set(k.map((x) => x.getBoundingClientRect().height)).size)).toBe(1); // gleiche Höhen
});

test("Suche läuft noch: beliebte KIs mit „Wird gesucht …“", async ({ page }) => {
  const ka = await oeffne(page, { erkennung: null });
  await expect(ka.locator(".ka-karte .ka-status").first()).toHaveText("Wird gesucht …");
  await page.evaluate((g) => window.__ka.setzeErkennung(g), GEFUNDEN);
  await expect(ka.locator(".ka-titel")).toHaveText("Auf diesem Computer gefunden");
  await expect(ka.locator(".ka-karte")).toHaveCount(2);
});

test("Mehrfachauswahl per Klick auf Karten und Listenzeilen; die Änderung meldet die Auswahl in Katalog-Reihenfolge", async ({ page }) => {
  const ka = await oeffne(page, { erkennung: GEFUNDEN, wert: ["claude"] });
  await ka.locator('.ka-karte[data-ki="codex"]').click();
  await expect(ka.locator('.ka-karte[data-ki="codex"]')).toHaveAttribute("aria-checked", "true");
  await ka.locator(".ka-mehr").click();
  await expect(ka.locator(".ka-weitere-innen")).toBeVisible();
  await ka.locator('.ka-zeile[data-ki="zed"]').click();
  await expect(ka.locator('.ka-zeile[data-ki="zed"]')).toHaveAttribute("aria-selected", "true");
  await ka.locator('.ka-karte[data-ki="claude"]').click();
  expect(await ereignisse(page)).toEqual([["claude", "codex"], ["claude", "codex", "zed"], ["codex", "zed"]]);
  expect(await page.evaluate(() => window.__ka.wert())).toEqual(["codex", "zed"]);
});

test("Einzelauswahl (mehrfach: false): Auswahlkreise, genau eine KI, Klick auf die gewählte ändert nichts", async ({ page }) => {
  const ka = await oeffne(page, { erkennung: GEFUNDEN, wert: ["claude"], mehrfach: false });
  await expect(ka.locator(".ka-karten")).toHaveAttribute("role", "radiogroup");
  await expect(ka.locator('.ka-karte[data-ki="claude"]')).toHaveRole("radio");
  await ka.locator('.ka-karte[data-ki="codex"]').click();
  await expect(ka.locator('.ka-karte[data-ki="claude"]')).toHaveAttribute("aria-checked", "false");
  await ka.locator('.ka-karte[data-ki="codex"]').click();
  expect(await ereignisse(page)).toEqual([["codex"]]);
});

test("aufgeklappt: durchsuchbare Liste mit Logo, Art und Status; Suche filtert nach Namen, meldet leere Treffer und Esc leert", async ({ page }) => {
  const ka = await oeffne(page, { erkennung: GEFUNDEN });
  await ka.locator(".ka-mehr").click();
  await expect(ka.locator(".ka-mehr")).toHaveText("Weitere KIs ausblenden");
  const zeilen = ka.locator(".ka-zeile");
  expect(await zeilen.count()).toBeGreaterThan(30);
  await expect(zeilen.first().locator(".ka-z-logo svg, .ka-z-logo img, .ka-z-logo .ki-maske, .ka-z-logo .ki-logo-initiale").first()).toBeVisible();
  await expect(ka.locator('.ka-zeile[data-ki="zed"] .ka-art')).toHaveText("Editor");
  await expect(ka.locator('.ka-zeile[data-ki="aider"] .ka-art')).toHaveText("Terminal");
  await expect(ka.locator('.ka-zeile[data-ki="warp"] .ka-art')).toHaveText("App");
  await expect(ka.locator('.ka-zeile[data-ki="aider"] .ka-z-status')).toHaveText("Nicht installiert");
  await expect(ka.locator(".ka-suche input")).toBeFocused();
  await page.keyboard.type("wind");
  await expect(zeilen).toHaveCount(1);
  await expect(zeilen.first().locator(".ka-z-name")).toHaveText("Windsurf");
  await ka.locator(".ka-suche input").fill("zzzz");
  await expect(ka.locator(".ka-leer")).toHaveText("Keine KI zu „zzzz“.");
  await ka.locator(".ka-suche input").fill("codex");
  await expect(ka.locator(".ka-leer")).toHaveText("„codex“ steht schon oben bei den gefundenen KIs.");
  await page.keyboard.press("Escape");
  await expect(ka.locator(".ka-suche input")).toHaveValue("");
  expect(await zeilen.count()).toBeGreaterThan(30);
});

test("nicht verbindbare KIs sind ausgegraut und nicht wählbar; ein Hinweis erklärt es", async ({ page }) => {
  const ka = await oeffne(page, { erkennung: { aider: { gefunden: true, version: "0.86.1" } } });
  await expect(ka.locator(".ka-karte")).toHaveCount(1);
  await expect(ka.locator(".ka-karte .ka-name")).toHaveText("Aider");
  await expect(ka.locator(".ka-karte .ka-status")).toHaveText("Noch nicht verbindbar");
  await ka.locator(".ka-karte").click({ force: true });
  await ka.locator(".ka-mehr").click();
  await expect(ka.locator('.ka-zeile[data-ki="windsurf"]')).toHaveAttribute("aria-disabled", "true");
  await ka.locator('.ka-zeile[data-ki="windsurf"]').click({ force: true });
  await expect(ka.locator('.ka-zeile[data-ki="windsurf"]')).toHaveAttribute("aria-selected", "false");
  await expect(ka.locator('.ka-zeile[data-ki="gemini"]')).not.toHaveAttribute("aria-disabled", "true");
  await expect(ka.locator(".ka-hinweis")).toHaveText("Ausgegraute KIs kann Kortex noch nicht selbst eintragen.");
  expect(await ereignisse(page)).toEqual([]);
});

test("Tastatur: Karten mit Pfeilen und Leertaste; Enter öffnet die Liste; Tippen filtert; ↓ springt in die Liste; Leertaste wählt; Tippen geht zurück ins Suchfeld", async ({ page }) => {
  const ka = await oeffne(page, { erkennung: GEFUNDEN, wert: ["claude"] });
  await ka.locator('.ka-karte[data-ki="claude"]').focus();
  await page.keyboard.press("ArrowRight");
  await expect(ka.locator('.ka-karte[data-ki="codex"]')).toBeFocused();
  await page.keyboard.press("Space");
  await expect(ka.locator('.ka-karte[data-ki="codex"]')).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Tab");
  await expect(ka.locator(".ka-mehr")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(ka.locator(".ka-suche input")).toBeFocused();
  await page.keyboard.type("c");
  const zeilen = ka.locator(".ka-zeile");
  expect(await zeilen.count()).toBeGreaterThan(2);
  await page.keyboard.press("ArrowDown");
  await expect(zeilen.first()).toBeFocused();
  const erste = await zeilen.first().getAttribute("data-ki");
  await page.keyboard.press("Space");
  await expect(zeilen.first()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await expect(zeilen.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(ka.locator(".ka-suche input")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.type("x"); // Tippen in der Liste führt ins Suchfeld zurück
  await expect(ka.locator(".ka-suche input")).toBeFocused();
  await expect(ka.locator(".ka-suche input")).toHaveValue("cx");
  expect((await ereignisse(page)).at(-1)).toEqual(expect.arrayContaining(["claude", "codex", erste]));
});

test("ARIA: Gruppe mit Kontrollkästchen, Listbox mit Optionen; Auswahl-Hinweise für Screenreader", async ({ page }) => {
  const ka = await oeffne(page, { erkennung: GEFUNDEN });
  await expect(ka.getByRole("group", { name: "KI wählen" })).toBeVisible();
  await expect(ka.getByRole("checkbox")).toHaveCount(2);
  await expect(ka.locator(".ka-weitere-innen")).toBeHidden();
  await expect(ka.getByRole("option")).toHaveCount(0); // zugeklappt: nicht erreichbar (inert, aria-hidden)
  await ka.locator(".ka-mehr").click();
  const liste = ka.getByRole("listbox", { name: "Weitere KIs" });
  await expect(liste).toHaveAttribute("aria-multiselectable", "true");
  expect(await liste.getByRole("option").count()).toBeGreaterThan(30);
  await expect(ka.locator('.ka-karte[data-ki="claude"]')).toHaveAccessibleName(/Claude Code.*Gefunden · 2\.1\.310/);
});

test("Vorauswahl in der Liste klappt sie von selbst auf; sperre() hält die Auswahl an", async ({ page }) => {
  const ka = await oeffne(page, { erkennung: GEFUNDEN, wert: ["zed"] });
  await expect(ka.locator(".ka-mehr")).toHaveAttribute("aria-expanded", "true");
  await expect(ka.locator('.ka-zeile[data-ki="zed"]')).toHaveAttribute("aria-selected", "true");
  await page.evaluate(() => window.__ka.sperre(true));
  await expect(ka.locator('.ka-karte[data-ki="claude"]')).toBeDisabled();
  await ka.locator('.ka-zeile[data-ki="warp"]').click();
  await expect(ka.locator('.ka-zeile[data-ki="warp"]')).toHaveAttribute("aria-selected", "false");
  await page.evaluate(() => window.__ka.sperre(false));
  await expect(ka.locator('.ka-karte[data-ki="claude"]')).toBeEnabled();
});

test("Layout: Namen brechen nie um, nichts ragt über den Rand; auch schmal (340 px)", async ({ page }) => {
  for (const schmal of [false, true]) {
    const ka = await oeffne(page, { erkennung: GEFUNDEN, wert: ["claude"] }, { schmal });
    await ka.locator(".ka-mehr").click();
    await expect(ka.locator(".ka-weitere-innen")).toBeVisible();
    const m = await page.evaluate(() => {
      const w = document.querySelector("[data-ki-auswahl]").getBoundingClientRect();
      const zu = (sel) => [...document.querySelectorAll(sel)].map((e) => { const r = e.getBoundingClientRect(); return { id: e.dataset.ki, h: Math.round(r.height), links: r.left >= w.left - 0.5, rechts: r.right <= w.right + 0.5, einzeilig: [...e.querySelectorAll(".ka-name, .ka-z-name, .ka-status, .ka-z-status")].every((n) => n.getBoundingClientRect().height < 22) }; });
      return { karten: zu(".ka-karte"), zeilen: zu(".ka-zeile"), scroll: document.documentElement.scrollWidth <= document.documentElement.clientWidth };
    });
    expect(m.scroll).toBe(true);
    for (const x of [...m.karten, ...m.zeilen]) { expect(x.links && x.rechts, `${x.id} im Rahmen`).toBe(true); expect(x.einzeilig, `${x.id} einzeilig`).toBe(true); }
    expect(new Set(m.karten.map((k) => k.h)).size).toBe(1);
    expect(new Set(m.zeilen.map((k) => k.h)).size).toBe(1);
  }
});

for (const schema of ["hell", "dunkel"]) {
  test(`Bilder (${schema}): eingeklappt, ausgeklappt, gefiltert`, async ({ page }) => {
    test.skip(!process.env.KI_LOGO_BILDER, "nur mit KI_LOGO_BILDER");
    await page.emulateMedia({ colorScheme: schema === "hell" ? "light" : "dark" });
    await page.setViewportSize({ width: 640, height: 760 });
    const ka = await oeffne(page, { erkennung: { ...GEFUNDEN, aider: { gefunden: true, version: "0.86.1" } }, wert: ["claude"] });
    const w = page.locator("#w");
    mkdirSync(process.env.KI_LOGO_BILDER, { recursive: true });
    const bild = (name) => w.screenshot({ path: `${process.env.KI_LOGO_BILDER}auswahl-${name}-${schema}.png` });
    await bild("eingeklappt");
    await ka.locator(".ka-mehr").click();
    await page.waitForTimeout(450);
    await bild("ausgeklappt");
    await page.keyboard.type("co");
    await page.waitForTimeout(200);
    await bild("gefiltert");
    const k2 = await oeffne(page, { erkennung: {} });
    await page.waitForTimeout(200);
    await bild("ohne-fund");
    void k2;
  });
}
