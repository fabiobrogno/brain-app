// Fenster ohne Titelleiste (App): Die App setzt --ampel-platz/--ampel-hoehe am <html>; die Seite hält links oben Platz für die Ampel, die oberste Zeile ist der Griff
// zum Verschieben (Aktion `fenster-ziehen`), ein Doppelklick dort meldet `fenster-zoom`; in der Vorschau sitzt eine schmale Plakette in der Kopfzeile.
// Die Brücke der App ist gemockt (window.webkit.messageHandlers.aktion): die Tests prüfen, WELCHE Aktionen die Seite schickt, nicht das Fenster selbst (das prüfen die Swift-Tests und die Vorschau).
import { test, expect } from "./basis.mjs";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { mockeV2 } from "./mocks.mjs";
import { starteStatisch, mockeEinrichtung, oeffneEinrichtungImStudio } from "./mocks-einrichtung.mjs";

const NOTIZ = "10_notizen/Reise nach Lissabon.md";
const VORSCHAU = "Vorschau — nichts wird gespeichert";
let vault, server;
test.beforeEach(async () => { ({ vault } = baueVault()); server = await starteServer(vault); });
test.afterEach(() => { server?.stopp(); server = null; });

/** Tut, was die App vor dem Laden tut: Variablen am <html>, optional Vorschau-Text, und eine Brücke, die die Aktionen sammelt. */
async function startApp(page, { platz = 90, hoehe = 44, vorschau = false, breite = 1440, hoeheFenster = 900, mitBruecke = true } = {}) {
  await page.setViewportSize({ width: breite, height: hoeheFenster });
  await page.addInitScript(({ platz, hoehe, vorschau, mitBruecke, text }) => {
    window.__aktionen = [];
    if (mitBruecke) window.webkit = { messageHandlers: { aktion: { postMessage: async (m) => { window.__aktionen.push(m); return { ok: true }; } } } };
    const setze = () => {
      const r = document.documentElement;
      if (platz !== null) { r.style.setProperty("--ampel-platz", platz + "px"); r.style.setProperty("--ampel-hoehe", hoehe + "px"); }
      if (vorschau) r.dataset.vorschau = text;
    };
    if (document.documentElement) setze(); // Chromium führt Startskripte vor dem Dokumentelement aus
    else new MutationObserver((_, o) => { if (document.documentElement) { o.disconnect(); setze(); } }).observe(document, { childList: true });
  }, { platz, hoehe, vorschau, mitBruecke, text: VORSCHAU });
  await mockeV2(page, vault);
  await page.goto(server.url + "?pfad=" + encodeURIComponent(NOTIZ));
  await page.waitForFunction(() => window.__studioBereit === true);
  await page.waitForSelector(".cm-content .cm-line");
}
const aktionen = (page) => page.evaluate(() => window.__aktionen.map((a) => a.aktion).filter((a) => a.startsWith("fenster-")));
const leere = (page) => page.evaluate(() => { window.__aktionen.length = 0; });
const box = (page, sel) => page.locator(sel).first().boundingBox();

test("Platz für die Ampel: Die Seitenleiste beginnt ihren Inhalt rechts neben --ampel-platz, die Kopfzeile bleibt 44 hoch", async ({ page }) => {
  await startApp(page);
  const seite = await box(page, "#seite"), vault = await box(page, "#vault-wechsler"), kopf = await box(page, "#kopf");
  expect(seite.x).toBe(0);
  expect(vault.x).toBeGreaterThanOrEqual(90); // links bleiben 90 px für Schließen, Ablegen, Zoomen
  expect(vault.x + vault.width).toBeLessThanOrEqual(seite.width);
  expect(kopf.height).toBe(44);
  // die Ampel sitzt mittig in dieser Zeile: der Vault-Knopf auch
  const m = vault.y + vault.height / 2;
  expect(Math.abs(m - 22)).toBeLessThanOrEqual(1);
  // schmalste Seitenleiste (200 px): Name bleibt lesbar, nichts ragt über den Rand
  await page.evaluate(() => document.getElementById("app").style.setProperty("--b-seite", "200px"));
  const eng = await box(page, "#vault-wechsler");
  expect(eng.x + eng.width).toBeLessThanOrEqual(200);
  expect(eng.width).toBeGreaterThan(70);
});

test("Browser ohne App: kein Platz für die Ampel, nichts wird gemeldet", async ({ page }) => {
  await startApp(page, { platz: null, mitBruecke: false });
  const vault = await box(page, "#vault-wechsler");
  expect(vault.x).toBeLessThan(20);
  await page.locator("#seite").click({ position: { x: 20, y: 22 } });
  expect(await aktionen(page)).toEqual([]);
});

test("Vollbild (--ampel-hoehe 0): kein Platz, kein Griff", async ({ page }) => {
  await startApp(page, { platz: 0, hoehe: 0 });
  expect((await box(page, "#vault-wechsler")).x).toBeLessThan(20);
  await page.locator("#kopf").click({ position: { x: 6, y: 22 } });
  expect(await aktionen(page)).toEqual([]);
});

test("Kopfzeile ist der Griff: leere Fläche meldet fenster-ziehen, Doppelklick fenster-zoom", async ({ page }) => {
  await startApp(page);
  // leere Fläche der Kopfzeile (links vor den Brotkrumen) und leerer Platz links in der Seitenleiste (dort sitzt die Ampel)
  await page.mouse.move(270, 22); await page.mouse.down(); await page.mouse.up();
  expect(await aktionen(page)).toEqual(["fenster-ziehen"]);
  await leere(page);
  await page.mouse.move(30, 22); await page.mouse.down(); await page.mouse.up();
  expect(await aktionen(page)).toEqual(["fenster-ziehen"]);
  await leere(page);
  // Doppelklick: erst der Griff, beim zweiten Drücken (detail 2) das Zoomen
  await page.mouse.dblclick(270, 22);
  expect(await aktionen(page)).toEqual(["fenster-ziehen", "fenster-zoom"]);
});

test("Bedienbares in der Kopfzeile bleibt bedienbar: Knöpfe, Suchfeld, Brotkrumen, Vault-Knopf lösen kein Ziehen aus", async ({ page }) => {
  await startApp(page);
  for (const sel of ["#kopf-suche", "#knopf-frage", "#knopf-verlauf", "#vault-wechsler"]) {
    const b = await box(page, sel);
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await page.keyboard.press("Escape"); // ein geöffnetes Menü/Dialog wieder zu
  }
  expect(await aktionen(page)).toEqual([]);
  // alles, was die Seite mit Zeigerhand als anklickbar zeigt, ist kein Griff
  await page.evaluate(() => { const d = document.createElement("div"); d.id = "zeiger"; d.style.cssText = "position:fixed;left:700px;top:6px;width:60px;height:30px;cursor:pointer;z-index:5"; document.body.append(d); });
  await page.mouse.click(730, 20);
  // Ausnahme per Attribut
  await page.evaluate(() => { const d = document.createElement("div"); d.setAttribute("data-nicht-ziehen", ""); d.style.cssText = "position:fixed;left:800px;top:6px;width:60px;height:30px;z-index:5"; document.body.append(d); });
  await page.mouse.click(830, 20);
  expect(await aktionen(page)).toEqual([]);
});

test("Unterhalb der Kopfzeile und mit anderen Tasten ist nichts ein Griff", async ({ page }) => {
  await startApp(page);
  await page.mouse.click(600, 60); // Liste/Editor, 16 px unter der Kopfzeile
  await page.mouse.click(30, 300); // Seitenleiste
  await page.mouse.move(270, 22); await page.mouse.down({ button: "right" }); await page.mouse.up({ button: "right" });
  expect(await aktionen(page)).toEqual([]);
});

test("Einstellungen: oberste Zeile der Seitenleiste lässt der Ampel Platz und ist ein Griff; Kopf der Einstellungen ebenso", async ({ page }) => {
  await startApp(page);
  await page.evaluate(() => { location.hash = "#einstellungen/allgemein"; });
  await expect(page.locator('.e-punkt[aria-current="true"]')).toBeVisible();
  const nav = await box(page, ".e-nav"), zurueck = await box(page, ".e-zurueck");
  expect(zurueck.y).toBeGreaterThanOrEqual(nav.y + 44); // unter der Zeile der Ampel
  await leere(page);
  await page.mouse.move(40, 20); await page.mouse.down(); await page.mouse.up();
  expect(await aktionen(page)).toEqual(["fenster-ziehen"]);
  await leere(page);
  const kopf = await box(page, ".e-kopf");
  await page.mouse.move(kopf.x + kopf.width - 5, 20); await page.mouse.down(); await page.mouse.up();
  expect(await aktionen(page)).toEqual(["fenster-ziehen"]);
  // „Zurück“ ist ein Knopf: kein Griff
  await leere(page);
  await page.mouse.click(zurueck.x + 40, zurueck.y + zurueck.height / 2);
  expect(await aktionen(page)).toEqual([]);
});

test("Vorschau: schmale Plakette in der Kopfzeile (Studio) und in den Einstellungen, kein eigener Streifen", async ({ page }) => {
  await startApp(page, { vorschau: true });
  const pille = page.locator("#kopf .vorschau-pille");
  await expect(pille).toBeVisible();
  await expect(pille).toContainText(VORSCHAU);
  const kopf = await box(page, "#kopf"), p = await pille.boundingBox();
  expect(p.height).toBeLessThanOrEqual(24);
  expect(p.y).toBeGreaterThanOrEqual(kopf.y);
  expect(p.y + p.height).toBeLessThanOrEqual(kopf.y + kopf.height);
  expect(p.x + p.width).toBeLessThanOrEqual(kopf.x + kopf.width);
  expect(await box(page, "#app").then((a) => a.y)).toBe(0); // nichts schiebt die Seite nach unten
  // Plakette liegt neben den Knöpfen, überdeckt keinen
  const frag = await box(page, "#knopf-frage");
  expect(p.x + p.width).toBeLessThanOrEqual(frag.x);
  await page.evaluate(() => { location.hash = "#einstellungen/allgemein"; });
  await expect(page.locator(".e-kopf .vorschau-pille")).toBeVisible();
  // schmales Fenster (Kopfzeile unter 820 px): nur der Punkt bleibt, die Kopfzeile läuft nicht über
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1000, height: 800 });
  await expect(page.locator("#kopf .vorschau-pille")).toBeVisible();
  const eng = await page.locator("#kopf .vorschau-pille").boundingBox();
  expect(eng.width).toBeLessThan(30);
});

test("Glas: mit data-glas ist nur die Seitenleiste durchsichtig, Kopfzeile, Liste und Editor bleiben deckend; ohne data-glas ändert sich nichts", async ({ page }) => {
  await startApp(page);
  const farbe = (sel) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).backgroundColor);
  const klar = "rgba(0, 0, 0, 0)";
  expect(await farbe("#seite")).not.toBe(klar);
  await page.evaluate(() => { document.documentElement.dataset.glas = "1"; });
  expect(await farbe("#seite")).toBe(klar);
  expect(await farbe("body")).toBe(klar);
  for (const sel of ["#kopf", "#liste", "#haupt", "#status"]) expect(await farbe(sel), sel).not.toBe(klar);
  await page.evaluate(() => { delete document.documentElement.dataset.glas; });
  expect(await farbe("#seite")).not.toBe(klar);
});

test("Hell/Dunkel meldet die Seite der App (Aktion darstellung), damit das Fenster folgt", async ({ page }) => {
  await startApp(page);
  const gemeldet = () => page.evaluate(() => window.__aktionen.filter((a) => a.aktion === "darstellung").map((a) => a.wert));
  expect((await gemeldet()).at(-1)).toBe("system");
  await page.click('[data-st="theme"]');
  expect(["hell", "dunkel", "system"]).toContain((await gemeldet()).at(-1));
  expect((await gemeldet()).length).toBeGreaterThan(1);
});

test("ohne Vorschau gibt es keine Plakette", async ({ page }) => {
  await startApp(page);
  await expect(page.locator(".vorschau-pille")).toHaveCount(0);
});

test.describe("Assistent", () => {
  let statisch;
  test.beforeAll(async () => { statisch = await starteStatisch(); });
  test.afterAll(() => statisch?.stopp());

  test("Vorschau: Plakette schwebt oben rechts, ohne Vorschau fehlt sie", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 780 });
    await page.addInitScript((text) => {
      const setze = () => { document.documentElement.dataset.vorschau = text; };
      if (document.documentElement) setze(); else new MutationObserver((_, o) => { if (document.documentElement) { o.disconnect(); setze(); } }).observe(document, { childList: true });
    }, VORSCHAU);
    const z = await mockeEinrichtung(page, {});
    await oeffneEinrichtungImStudio(page, statisch.url, z);
    const pille = page.locator(".vorschau-pille.fest");
    await expect(pille).toBeVisible();
    const p = await pille.boundingBox();
    expect(p.y).toBeLessThan(30);
    expect(p.x + p.width).toBeGreaterThan(1200 - 40);
    expect(p.x + p.width).toBeLessThanOrEqual(1200);
  });

  test("im App-Fenster liegt die Einrichtung als Karte (höchstens 1100×780, 16 px Rand) über dem Studio", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 780 });
    await page.addInitScript(() => { window.webkit = { messageHandlers: { aktion: { postMessage: async () => ({ ok: true }) } } }; });
    const z = await mockeEinrichtung(page, {});
    await oeffneEinrichtungImStudio(page, statisch.url, z);
    await expect(page.locator("#einrichtung-host.an")).toBeVisible();
    await page.waitForTimeout(500); // die Karte gleitet 400 ms ein
    const w = await page.locator("#win").boundingBox();
    expect(Math.round(w.width)).toBe(1100);
    expect(Math.round(w.height)).toBe(748); // 780 − 2 × 16 Rand: kleiner als die Höhe der Wunschkarte
    expect(Math.round(w.x)).toBe(50);
    await expect(page.locator(".vorschau-pille")).toHaveCount(0);
  });
});
