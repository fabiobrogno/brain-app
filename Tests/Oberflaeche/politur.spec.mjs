// R4-6 Politur: Notizliste (ein Datum, Symbol nur bei Typ, bündige Ordner), Suchtreffer ohne Markdown und nach Abdeckung, eigene Tooltips (kein natives title,
// Menüs nur bei gekürztem Text, Editor ohne Beobachter-Aufwand), Texte ohne interne Begriffe, Code-Schrift und Palette im dunklen Schema.
// Fotos: STUDIO_FOTOS=<Ordner> (hell und dunkel). Gegen das echte Backend mit Wegwerf-Vault.
import { test, expect } from "./basis.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";

const FOTOS = process.env.STUDIO_FOTOS || "";
let vault, server;
test.beforeEach(async () => {
  ({ vault } = baueVault());
  mkdirSync(join(vault, "10_notizen"), { recursive: true });
  writeFileSync(join(vault, "10_notizen/Espresso-Zubereitung.md"), "# Espresso-Zubereitung\n\nDie **Zubereitung** von [[Kaffee|Bohnen-Kaffee]] unter Druck, siehe [Anleitung](https://x.de) und `Mühle`.\n\n> Ein Zitat zur Zubereitung\n\n## Zubereitung Schritte\n\n- [ ] Mahlen\n");
  writeFileSync(join(vault, "10_notizen/aaa-eins.md"), "# Aaa Eins\n\nNur das Wort Seifenblase steht hier.\n");
  writeFileSync(join(vault, "10_notizen/bbb-zwei.md"), "# Bbb Zwei\n\nSeifenblase und Zitronenfalter zusammen.\n");
  server = await starteServer(vault);
});
test.afterEach(() => server?.stopp());

async function start(page, { dunkel = false, breite = 1440 } = {}) {
  if (dunkel) await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: breite, height: 900 });
  await page.goto(server.url);
  await page.waitForSelector("[data-karte], [data-leer]", { timeout: 10000 });
}
async function foto(page, name) {
  if (!FOTOS) return;
  mkdirSync(FOTOS, { recursive: true });
  await page.screenshot({ path: join(FOTOS, name + ".png") });
}
const schemata = [false, true];

for (const dunkel of schemata) {
  const wo = dunkel ? "dunkel" : "hell";

  test(`Liste (${wo}): ein Datum, Symbol nur bei Typ, Ordnerzeilen bündig`, async ({ page }) => {
    await start(page, { dunkel });
    const karten = page.locator("#liste-koerper [data-karte]");
    const n = await karten.count();
    expect(n).toBeGreaterThan(5);
    for (let i = 0; i < n; i++) {
      const fuss = await karten.nth(i).locator(".karte-fuss > span").allTextContents();
      expect(fuss.length, `Karte ${i}: genau ein Datum`).toBe(1);
      expect(fuss[0]).not.toMatch(/Erstellt/);
      expect(fuss[0]).toMatch(/\d{4}/);
    }
    // Symbol nur bei einer Notiz mit Typ: Kaffee/Espresso (typ im Kopf) haben eins, gewöhnliche nicht
    const ohneTyp = page.locator('#liste-koerper [data-karte][data-pfad="10_notizen/aaa-eins.md"] .karte-marken svg');
    await expect(ohneTyp).toHaveCount(0);
    // Sortierung „Erstellt“ zeigt das Datum der Erstellung, danach wieder „Geändert“ (Karten werden neu gezeichnet)
    await page.locator(".liste-werkzeuge button", { hasText: "Geändert" }).click();
    await page.locator(".menue .m-eintrag", { hasText: "Erstellt" }).click();
    await expect(karten.first().locator(".karte-fuss > span")).toContainText("Erstellt");
    await page.locator(".liste-werkzeuge button", { hasText: "Erstellt" }).click();
    await page.locator(".menue .m-eintrag", { hasText: "Geändert" }).click();
    await expect(karten.first().locator(".karte-fuss > span")).not.toContainText("Erstellt");
    // Ordnerzeilen: Symbol mit und ohne Pfeil steht in einer Spalte
    const x = await page.evaluate(() => [...document.querySelectorAll('.baum .zeile[style*="--tiefe:0"]')].map((z) => [z.classList.contains("zeile"), z.querySelector(".pfeil")?.classList.contains("ohne"), Math.round(z.querySelector(".ordner-sym").getBoundingClientRect().left)]));
    expect(x.length).toBeGreaterThan(2);
    expect(new Set(x.map((r) => r[2])).size, JSON.stringify(x)).toBe(1);
    await page.locator("[data-karte]").nth(1).hover();
    await page.waitForTimeout(300);
    await foto(page, `r46-nachher-liste-${wo}`);
  });

  test(`Info-Spalte ohne Notiz (${wo}): Hinweis ohne „Wähle links“, Erwähnungen heißen „Unverlinkte“`, async ({ page }) => {
    await start(page, { dunkel });
    const leer = page.locator("[data-info-leer]");
    await expect(leer).toBeVisible();
    await expect(leer).toContainText("Keine Notiz offen");
    await expect(leer).not.toContainText("/ingest");
    await foto(page, `r46-nachher-info-leer-${wo}`);
    await page.locator('[data-karte][data-pfad="09_wiki/wissen/Kaffee.md"]').click();
    await expect(page.locator(".info-inhalt")).not.toContainText("/ingest");
    await expect(page.locator(".info-inhalt")).not.toContainText(/Ungelinkte/);
  });

  test(`Suche (${wo}): Treffer ohne Markdown, Palette „Im Inhalt“ mit allen Wörtern zuerst`, async ({ page }) => {
    await start(page, { dunkel });
    await page.keyboard.press("Meta+Shift+f");
    await page.keyboard.type("Zubereitung Druck");
    const karte = page.locator('[data-suche="treffer"][data-pfad="10_notizen/Espresso-Zubereitung.md"]');
    await expect(karte).toBeVisible();
    await expect(karte.locator("mark.treffer").first()).toBeVisible();
    const texte = await page.locator('[data-suche="treffer"] .fund-text, [data-suche="treffer"] .auszug').allTextContents();
    expect(texte.length).toBeGreaterThan(1);
    for (const t of texte) {
      expect(t, t).not.toMatch(/\*\*|\[\[|\]\]|\]\(|^\s*>|^\s*#|`/);
    }
    const marken = (await karte.locator("mark.treffer").allTextContents()).map((m) => m.toLowerCase());
    expect(marken).toEqual(expect.arrayContaining(["zubereitung", "druck"]));
    await foto(page, `r46-nachher-suche-${wo}`);
    // Palette: „Im Inhalt“ – die Notiz mit beiden Suchwörtern steht vor der mit einem
    await page.keyboard.press("Escape");
    await page.keyboard.press("Meta+k");
    await page.keyboard.type("Seifenblase Zitronenfalter");
    const inhalt = page.locator('.palette [data-pal="inhalt"]');
    await expect.poll(async () => inhalt.count(), { timeout: 8000 }).toBeGreaterThan(0);
    await expect(inhalt.first()).toContainText("Bbb Zwei");
    await expect(page.locator(".pal-auszug").first()).not.toContainText(/\*\*|\[\[|`/);
    // Auswahlbalken der Palette ist im dunklen Schema dunkel (der Eintrag trägt data-pal als Art, nicht als Farbschema)
    const bg = await page.evaluate(() => { const e = document.querySelector('.palette .pal-eintrag[aria-selected="true"]'); return getComputedStyle(e).backgroundColor; });
    const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; };
    if (dunkel) expect(lum(bg), bg).toBeLessThan(0.3); else expect(lum(bg), bg).toBeGreaterThan(0.8);
    await foto(page, `r46-nachher-palette-${wo}`);
  });

  test(`Tooltips (${wo}): kein natives title, Menüeintrag zeigt Tooltip nur bei gekürztem Text`, async ({ page }) => {
    await start(page, { dunkel });
    const nativ = () => page.evaluate(() => [...document.querySelectorAll("[title]")].map((e) => `${e.tagName}.${String(e.className).slice(0, 30)}=${e.getAttribute("title").slice(0, 30)}`));
    expect(await nativ()).toEqual([]);
    await page.locator('[data-karte][data-pfad="09_wiki/wissen/Kaffee.md"]').click();
    await expect(page.locator(".cm-content")).toBeVisible();
    await page.waitForTimeout(300);
    expect(await nativ()).toEqual([]);
    // Menü mit einem kurzen und einem langen Eintrag
    await page.evaluate(async () => {
      const m = await import("./menue.js");
      m.oeffneMenue(document.querySelector("#knopf-mehr"), [{ name: "Kurz" }, { name: "Ein ausgesprochen langer Eintragsname, der nie in dieses schmale Menü passt" }], { breite: 200 });
    });
    const menue = page.locator(".menue");
    await expect(menue).toBeVisible();
    await menue.evaluate((m) => { m.style.maxWidth = "220px"; m.style.width = "220px"; });
    await menue.locator(".m-eintrag", { hasText: "Kurz" }).hover();
    await page.waitForTimeout(800);
    await expect(page.locator(".bs-tipp")).toHaveCount(0);
    await menue.locator(".m-eintrag", { hasText: "ausgesprochen" }).hover();
    await expect(page.locator(".bs-tipp")).toHaveText(/ausgesprochen langer Eintragsname/, { timeout: 3000 });
    // Der Tooltip steht neben dem Menü, nicht über seinen Nachbarn
    const [m, t] = await page.evaluate(() => [document.querySelector(".menue").getBoundingClientRect().toJSON(), document.querySelector(".bs-tipp").getBoundingClientRect().toJSON()]);
    expect(t.left >= m.right - 1 || t.right <= m.left + 1, JSON.stringify({ m, t })).toBe(true);
    await foto(page, `r46-nachher-tooltip-menue-${wo}`);
    expect(await nativ()).toEqual([]);
  });
}

test("Tooltips: im Editor tippen kostet den Title-Beobachter nichts; Tipp-Latenz bleibt klein", async ({ page }) => {
  await start(page);
  await page.locator('[data-karte][data-pfad="10_notizen/Espresso-Zubereitung.md"]').click();
  const cm = page.locator(".cm-content");
  await expect(cm).toBeVisible();
  await cm.click();
  await page.keyboard.press("Meta+ArrowDown");
  await page.waitForTimeout(300);
  const vorher = await page.evaluate(() => ({ ...window.__tippStatistik }));
  expect(vorher).toBeTruthy();
  const lat = await page.evaluate(async () => {
    const ed = document.querySelector(".cm-content");
    const werte = [];
    for (const z of "Tippe hier einen längeren Satz zum Messen der Latenz.") {
      const t0 = performance.now();
      document.execCommand("insertText", false, z);
      await new Promise((r) => requestAnimationFrame(() => r()));
      werte.push(performance.now() - t0);
    }
    return werte;
  });
  await page.waitForTimeout(100);
  const nachher = await page.evaluate(() => ({ ...window.__tippStatistik }));
  // Was im Editor (CodeMirror) geschieht, zählt nicht; außerhalb ändert sich nur die Statusleiste (Wörter, Speicherstand): höchstens ein paar Einträge je Zeichen
  expect(nachher.uebersprungen - vorher.uebersprungen, "Editor-Änderungen werden übersprungen").toBeGreaterThan(0);
  expect(nachher.eintraege - vorher.eintraege, "Einträge außerhalb des Editors beim Tippen").toBeLessThan(4 * lat.length);
  expect(nachher.ms - vorher.ms, "Zeit im Beobachter beim Tippen (ms)").toBeLessThan(15);
  lat.sort((a, b) => a - b);
  console.log("Tipp-Latenz Median/p95 ms:", Math.round(lat[Math.floor(lat.length / 2)]), Math.round(lat[Math.floor(lat.length * 0.95)]), "· Beobachter-Läufe:", nachher.laeufe - vorher.laeufe, "übersprungen:", nachher.uebersprungen - vorher.uebersprungen);
  expect(lat[Math.floor(lat.length / 2)]).toBeLessThan(60);
  // Widgets im Editor tragen ihren Tooltip als data-tipp-text, nie als title
  expect(await page.evaluate(() => document.querySelectorAll(".cm-editor [title]").length)).toBe(0);
});

for (const dunkel of schemata) {
  test(`Einstellungen (${dunkel ? "dunkel" : "hell"}): Code-Schrift ist ein eigener Baustein, Fußzeile ohne Dateinamen, keine leere Kachel „0 von 0“`, async ({ page }) => {
    await start(page, { dunkel });
    await page.keyboard.press("Meta+,");
    await expect(page.locator("[data-einstellungen]")).toBeVisible();
    await page.locator('.e-punkt[data-bereich="darstellung"]').click();
    const knopf = page.locator('[data-zeile="codeschrift"] .bs-auswahl-knopf');
    await expect(knopf).toBeVisible();
    const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; };
    for (const pal of dunkel ? ["dunkel-standard", "dunkel-graphit", "dunkel-mitternacht", "dunkel-kontrast"] : ["hell-standard", "hell-papier", "hell-kontrast"]) {
      await page.evaluate((p) => { document.documentElement.dataset.pal = p; }, pal);
      await page.waitForTimeout(450);
      const r = await knopf.evaluate((k) => { const c = getComputedStyle(k); const s = getComputedStyle(document.querySelector(".e-blatt")); return { bg: c.backgroundColor, ap: c.appearance, tag: k.tagName, tf: c.color }; });
      expect(r.ap).toBe("none");
      const hg = r.bg.startsWith("rgba") ? 0.1 : lum(r.bg);
      if (dunkel) expect(hg, `${pal}: ${r.bg}`).toBeLessThan(0.3); else expect(hg, `${pal}: ${r.bg}`).toBeGreaterThan(0.85);
      await foto(page, `r46-nachher-code-schrift-${pal}`);
    }
    await expect(page.locator(".e-status")).not.toContainText(/\.json/);
    await expect(page.locator(".e-fuss")).toHaveCount(0);
    await expect(page.locator(".e-status")).toContainText("Einstellungen werden sofort gespeichert");
    await page.locator('.e-punkt[data-bereich="allgemein"]').click();
    const version = page.locator('[data-zeile="version-info"]');
    await expect(version).toContainText("Nach Updates suchen");
    await expect(version).not.toContainText(/Mac:|Rechner|Windows und Linux/);
    await page.locator('.e-punkt[data-bereich="ki"]').click();
    await expect(page.locator('[data-kachel="angemeldet"]')).toBeVisible();
    await expect(page.locator('[data-kachel="angemeldet"]')).not.toContainText("0 von 0");
    await foto(page, `r46-nachher-einst-ki-${dunkel ? "dunkel" : "hell"}`);
  });
}

test("Texte: in den Hauptansichten steht nie „null“, „undefined“ oder „[object“; keine internen Begriffe", async ({ page }) => {
  await start(page);
  const text = () => page.evaluate(() => document.body.innerText);
  const pruefe = async (wo) => {
    await page.waitForTimeout(150);
    const t = await text();
    expect(t, wo).not.toMatch(/\bnull\b|\bundefined\b|\[object|NaN/);
    expect(t, wo).not.toMatch(/\/ingest|Commit|Rechner:/);
  };
  await pruefe("Liste");
  await page.locator('[data-karte][data-pfad="09_wiki/wissen/Kaffee.md"]').click(); await pruefe("Notiz mit Info");
  await page.keyboard.press("Meta+k"); await pruefe("Palette"); await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+3"); await pruefe("Aufgaben");
  await page.keyboard.press("Meta+1"); await pruefe("Posteingang");
  await page.keyboard.press("Meta+,"); await page.waitForTimeout(400); await pruefe("Einstellungen");
  const bereiche = await page.locator(".e-punkt[data-bereich]").evaluateAll((l) => l.map((e) => e.dataset.bereich));
  expect(bereiche.length).toBeGreaterThan(8);
  for (const b of bereiche) { await page.locator(`.e-punkt[data-bereich="${b}"]`).click(); await pruefe("Einstellungen " + b); }
});
