// Paket „Darstellung“, Bedienung: Schemata, Akzent, Dichte, Schrift, Größe, Zeilenbreite, Symbole, Zurücksetzen, Änderung von außen, Migration, Fähigkeit „durchscheinend“ (App) und Browser-Modus.
// Gegen die echte Werkstatt mit Wegwerf-Vault und eigenem Support-Ordner. UI_SHOTS=<Ordner> legt die Bildschirmfotos dort ab. Kontrast: darstellung.spec.mjs.
import { test, expect } from "./basis.mjs";
import { join } from "node:path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";

let vault, server;
test.beforeEach(async () => { ({ vault } = baueVault()); server = await starteServer(vault); });
test.afterEach(() => server?.stopp());

const NOTIZ = "10_notizen/Reise nach Lissabon.md";
const appDatei = () => { const p = join(server.support, "einstellungen.json"); return existsSync(p) && readFileSync(p, "utf8").trim() ? JSON.parse(readFileSync(p, "utf8")) : {}; };
const schreibeDatei = (obj) => writeFileSync(join(server.support, "einstellungen.json"), JSON.stringify(obj));
const html = (page) => page.locator("html");
const zeile = (page, id) => page.locator(`[data-zeile="${id}"]`);
const warteSpeichern = (page) => page.waitForResponse((r) => r.url().includes("/api/einstellungen") && r.request().method() === "PUT");
const css = (page, sel, prop) => page.evaluate(([s, p]) => getComputedStyle(document.querySelector(s))[p], [sel, prop]);
const token = (page, t) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), t);
const shots = () => { const d = process.env.UI_SHOTS || "screenshots"; mkdirSync(d, { recursive: true }); return d; };
async function start(page, { breite = 1440, hoehe = 900, dunkel = false, hash = "" } = {}) {
  await page.setViewportSize({ width: breite, height: hoehe });
  if (dunkel) await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(server.url + hash);
  await page.waitForFunction(() => window.__studioBereit === true);
}
async function oeffne(page) {
  await page.evaluate(() => { location.hash = "#einstellungen/darstellung"; });
  await expect(zeile(page, "akzent")).toBeVisible();
}

test("Schemata: jedes Hell- und Dunkel-Schema wirkt sofort auf die ganze App und bleibt (einstellungen.json)", async ({ page }) => {
  await start(page);
  await oeffne(page);
  await expect(html(page)).toHaveAttribute("data-pal", "hell-standard");
  const erwartet = { "hell-papier": "251, 248, 241", "hell-kontrast": "255, 255, 255", "dunkel-graphit": "28, 29, 31", "dunkel-mitternacht": "10, 13, 26", "dunkel-kontrast": "0, 0, 0", "dunkel-standard": "10, 10, 10" };
  for (const [pal, papier] of Object.entries(erwartet)) {
    const [modus, schema] = pal.split("-");
    await page.click(`[data-schluessel="erscheinung"] [data-wert="${modus}"]`);
    const put = warteSpeichern(page);
    await page.click(`[data-schluessel="${modus === "hell" ? "schemaHell" : "schemaDunkel"}"] [data-wert="${schema}"]`);
    await put;
    await expect(html(page)).toHaveAttribute("data-pal", pal);
    expect(await css(page, "body", "backgroundColor")).toBe(`rgb(${papier})`);
    expect(await css(page, ".einst", "backgroundColor")).toBe(`rgb(${papier})`);
    expect(await html(page).evaluate((e) => getComputedStyle(e).colorScheme)).toBe(modus === "hell" ? "light" : "dark");
  }
  expect(appDatei()).toMatchObject({ erscheinung: "dunkel", schemaHell: "kontrast" });
  await page.reload();
  await page.waitForFunction(() => window.__studioBereit === true);
  await expect(html(page)).toHaveAttribute("data-pal", "dunkel-standard");
});

test("Erscheinungsbild „Wie macOS“ folgt dem System; Schema je Hell und Dunkel getrennt", async ({ page }) => {
  await start(page, { dunkel: true });
  await expect(html(page)).toHaveAttribute("data-pal", "dunkel-standard");
  await oeffne(page);
  await page.click('[data-schluessel="schemaDunkel"] [data-wert="mitternacht"]');
  await expect(html(page)).toHaveAttribute("data-pal", "dunkel-mitternacht");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(html(page)).toHaveAttribute("data-pal", "hell-standard");
  await page.click('[data-schluessel="schemaHell"] [data-wert="papier"]');
  await expect(html(page)).toHaveAttribute("data-pal", "hell-papier");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(html(page)).toHaveAttribute("data-pal", "dunkel-mitternacht");
});

test("Akzentfarbe: neun Farben, Hell/Dunkel-Wert, lesbarer Text auf dem Akzent", async ({ page }) => {
  await start(page);
  await oeffne(page);
  await expect(page.locator('[data-schluessel="akzent"] [role="radio"]')).toHaveCount(9);
  const hell = { indigo: "#5b4ed6", blau: "#1e5eea", violett: "#9231ea", rosa: "#c6216b", rot: "#cd2121", orange: "#b64409", bernstein: "#8f5e18", gruen: "#107a37", graphit: "#3f3f46" };
  for (const [id, farbe] of Object.entries(hell)) {
    await page.click(`[data-schluessel="akzent"] [data-wert="${id}"]`);
    expect(await token(page, "--akzent")).toBe(farbe);
    await expect(page.locator(`[data-schluessel="akzent"] [data-wert="${id}"]`)).toHaveAttribute("aria-checked", "true");
  }
  await expect.poll(() => appDatei().akzent).toBe("graphit");
  await page.click('[data-schluessel="erscheinung"] [data-wert="dunkel"]');
  expect(await token(page, "--akzent")).toBe("#d4d4d8");
  expect(await token(page, "--akzent-text")).toBe("#0a0a0a");
  await page.click('[data-schluessel="akzent"] [data-wert="rosa"]');
  expect(await token(page, "--akzent")).toBe("#ff8cc3");
  await page.locator('[data-schluessel="akzent"] [aria-checked="true"]').focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('[data-schluessel="akzent"] [data-wert="rot"]')).toHaveAttribute("aria-checked", "true");
});

test("Dichte, Editor-Schrift, Schriftgröße, Zeilenbreite, Code-Schrift und Symbole gelten live im Editor und in der Seitenleiste", async ({ page }) => {
  await start(page, { hash: "?pfad=" + encodeURIComponent(NOTIZ) });
  await page.waitForSelector(".cm-content .cm-line");
  const zeile0 = await page.locator("#bereiche .eintrag").first().evaluate((e) => e.getBoundingClientRect().height);
  await oeffne(page);
  await page.locator('[data-schluessel="dichte"]').focus();
  await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight");
  await expect.poll(() => token(page, "--zeile")).toBe("34px");
  expect(await token(page, "--ed-zeilenabstand")).toBe("1.9");
  await expect.poll(() => appDatei().dichte).toBe(4);
  await page.locator('[data-schluessel="dichte"]').press("Home");
  expect(await token(page, "--zeile")).toBe("24px");
  expect(await token(page, "--innen")).toBe("6px");
  await page.click('[data-schluessel="editorSchrift"] [data-wert="serif"]');
  expect(await token(page, "--schrift-text")).toContain("ui-serif");
  await page.click('[data-schluessel="editorSchrift"] [data-wert="mono"]');
  expect(await token(page, "--schrift-text")).toContain("ui-monospace");
  await page.locator('[data-schluessel="schriftgroesse"]').press("End");
  expect(await token(page, "--editor-schrift")).toBe("22px");
  await expect(zeile(page, "schriftgroesse").locator(".dz-wert")).toHaveText("22 pt");
  for (const [id, px] of [["schmal", "660px"], ["normal", "820px"], ["breit", "1080px"], ["voll", "none"]]) {
    await page.click(`[data-schluessel="zeilenbreite"] [data-wert="${id}"]`);
    expect(await token(page, "--lesebreite-wahl")).toBe(px);
  }
  await page.click('[data-schluessel="codeSchrift"]');
  await page.locator('[role="option"]').filter({ hasText: /Menlo|Konsole/ }).click();
  expect(await token(page, "--mono")).toContain("Menlo");
  await page.click('[data-schluessel="symbole"] [data-wert="farbig"]');
  await expect(html(page)).toHaveAttribute("data-symbole", "farbig");
  expect(await page.locator('.e-punkt[data-bereich="darstellung"] > .sym').evaluate((e) => getComputedStyle(e).backgroundImage)).toContain("gradient");
  await page.click('[data-schluessel="symbole"] [data-wert="einfarbig"]');
  expect(await page.locator('.e-punkt[data-bereich="darstellung"] > .sym').evaluate((e) => getComputedStyle(e).backgroundImage)).toBe("none");
  await page.keyboard.press("Escape");
  await expect.poll(() => css(page, ".cm-content", "fontSize")).toBe("22px");
  expect(await css(page, ".cm-content", "fontFamily")).toContain("ui-monospace");
  expect(await css(page, ".cm-content", "maxWidth")).toBe("none");
  expect(await page.locator("#bereiche .eintrag").first().evaluate((e) => e.getBoundingClientRect().height)).toBeLessThan(zeile0);
});

test("Größe der Oberfläche skaliert die ganze App (90 bis 125 %), ohne Rand oder Überlauf", async ({ page }) => {
  await start(page);
  await oeffne(page);
  for (const u of [90, 110, 125, 100]) {
    await page.click(`[data-schluessel="oberflaeche"] [data-wert="${u}"]`);
    expect(await token(page, "--ui-zoom")).toBe(String(u / 100));
    const m = await page.evaluate(() => { const r = document.querySelector("#app").getBoundingClientRect(); return { sb: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, iw: innerWidth, ih: innerHeight, rechts: r.right, unten: r.bottom }; });
    expect(m.sb).toBeLessThanOrEqual(m.iw + 1); expect(m.sh).toBeLessThanOrEqual(m.ih + 1); // kein Überlauf, keine Scrollleisten
    expect(Math.abs(m.rechts - m.iw)).toBeLessThanOrEqual(1); expect(Math.abs(m.unten - m.ih)).toBeLessThanOrEqual(1); // das Fenster ist ganz gefüllt
    await page.screenshot({ path: join(shots(), `darstellung-groesse-${u}.png`) });
  }
});

test("Darstellung zurücksetzen stellt alles auf den Anfang; Notizen und Dock-Symbol bleiben", async ({ page }) => {
  schreibeDatei({ akzent: "rot", dichte: 0, zeilenbreite: "voll", symbole: "farbig", editorSchrift: "serif", schemaHell: "papier", schriftgroesse: 20, appSymbol: "papier", mitteilungenTon: true });
  await start(page);
  await expect(html(page)).toHaveAttribute("data-pal", "hell-papier");
  await oeffne(page);
  await page.click('[data-aktion="darst-reset"]');
  await expect(html(page)).toHaveAttribute("data-pal", "hell-standard");
  expect(await token(page, "--akzent")).toBe("#5b4ed6");
  expect(await token(page, "--zeile")).toBe("28px");
  expect(await token(page, "--editor-schrift")).toBe("16px");
  await expect(html(page)).toHaveAttribute("data-symbole", "einfarbig");
  await expect.poll(() => appDatei()).toEqual({ appSymbol: "papier", mitteilungenTon: true });
});

test("Änderung von außen (CLI, anderes Fenster) gilt sofort, auch bei geschlossenen Einstellungen", async ({ page }) => {
  await start(page);
  schreibeDatei({ akzent: "gruen", schemaHell: "kontrast", dichte: 4 });
  await expect(html(page)).toHaveAttribute("data-pal", "hell-kontrast", { timeout: 10000 });
  expect(await token(page, "--akzent")).toBe("#107a37");
  expect(await token(page, "--zeile")).toBe("34px");
});

test("Migration: alte Wahl aus dem Browserspeicher (Thema, breite Textspalte) wandert in einstellungen.json", async ({ page }) => {
  await page.addInitScript(() => { if (!sessionStorage.getItem("fertig")) { sessionStorage.setItem("fertig", "1"); localStorage.setItem("brain-studio.theme", JSON.stringify("dunkel")); localStorage.setItem("brain-studio.breit", "true"); } });
  await start(page);
  await expect(html(page)).toHaveAttribute("data-pal", "dunkel-standard");
  await expect.poll(() => appDatei()).toMatchObject({ erscheinung: "dunkel", zeilenbreite: "breit" });
  await expect.poll(() => page.evaluate(() => localStorage.getItem("brain-studio.theme"))).toBeNull();
  expect(await token(page, "--lesebreite-wahl")).toBe("1080px");
});

test("Werkzeugleiste „Breit“ schaltet die Zeilenbreite und merkt sie in einstellungen.json", async ({ page }) => {
  await start(page, { hash: "?pfad=" + encodeURIComponent(NOTIZ) });
  await page.waitForSelector(".cm-content .cm-line");
  await page.click("#w-breit");
  await expect(page.locator("#w-breit")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => appDatei().zeilenbreite).toBe("breit");
});

test("Durchscheinende Seitenleiste: im Browser ausgeblendet (keine Fähigkeit der Hülle)", async ({ page }) => {
  await start(page);
  await oeffne(page);
  await expect(zeile(page, "symbole")).toBeVisible();
  await expect(zeile(page, "durchscheinend")).toHaveCount(0);
});

test("Durchscheinende Seitenleiste: mit Fähigkeit der Hülle sichtbar, der Schalter geht als Aktion fenster-durchscheinend an die Hülle", async ({ page }) => {
  await page.addInitScript(() => {
    window.__aktionen = [];
    window.webkit = { messageHandlers: { aktion: { postMessage: async (m) => { window.__aktionen.push(m); return { ok: true }; } } } };
    const setze = () => { document.documentElement.dataset.glasMoeglich = "1"; };
    if (document.documentElement) setze(); else document.addEventListener("readystatechange", setze, { once: true });
  });
  await start(page);
  await oeffne(page);
  const schalter = zeile(page, "durchscheinend").locator('[role="switch"]');
  await expect(schalter).toHaveAttribute("aria-checked", "true");
  await schalter.click();
  await expect(schalter).toHaveAttribute("aria-checked", "false");
  await expect.poll(() => page.evaluate(() => window.__aktionen.filter((a) => a.aktion === "fenster-durchscheinend").map((a) => a.wert))).toEqual([false]);
  await expect.poll(() => appDatei().seitenleisteDurchscheinend).toBe(false);
});

for (const [name, dunkel, breite, hoehe] of [["hell-1440", false, 1440, 900], ["dunkel-1440", true, 1440, 900], ["hell-900", false, 900, 700], ["dunkel-900", true, 900, 700]]) {
  test(`Bilder ${name}: Studio und Einstellungen`, async ({ page }) => {
    schreibeDatei({ erscheinung: dunkel ? "dunkel" : "hell", symbole: "farbig" });
    await start(page, { breite, hoehe, hash: "?pfad=" + encodeURIComponent(NOTIZ) });
    await page.waitForSelector(".cm-content .cm-line");
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(shots(), `darstellung-studio-${name}.png`) });
    await oeffne(page);
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(shots(), `darstellung-einst-${name}.png`) });
    await page.locator(".e-inhalt").evaluate((e) => { e.scrollTop = 900; });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(shots(), `darstellung-einst-unten-${name}.png`) });
  });
}
