// Tags (Seitenleiste, Baum, Filter, Vervollständigung, Umbenennen mit Vorschau und Rückgängig, ⌘K, Suche) und Export/Teilen (Dialog, Markdown, HTML, PDF über Drucken, Kopieren).
// Echte Werkstatt, Wegwerf-Vault. Bilder nur zum Ansehen: TAGS_BILD=<Ordner> (fotografiert die Seite, nie den Bildschirm).
import { test, expect } from "./basis.mjs";
import { readFileSync, writeFileSync, mkdirSync, readFileSync as lies0 } from "node:fs";
import { join } from "node:path";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";

let vault, server;
const lies = (p) => readFileSync(join(vault, p), "utf8");
const schreib = (p, inhalt) => { mkdirSync(join(vault, p, ".."), { recursive: true }); writeFileSync(join(vault, p), inhalt); };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test.beforeEach(async () => {
  ({ vault } = baueVault());
  schreib("20_projekte/Atlas.md", "---\ntags: [projekt/atlas, wichtig]\n---\n# Atlas\n\nKarten für die Reise #reise. Siehe ![Karte](bilder/karte.png).\n");
  mkdirSync(join(vault, "20_projekte/bilder"), { recursive: true });
  writeFileSync(join(vault, "20_projekte/bilder/karte.png"), PNG);
  schreib("20_projekte/Plan.md", "# Plan\n\nErst #projekt/atlas, dann #projekt/zeitplan und #wichtig.\n\n```\n#nichtzaehlen\n```\n");
  schreib("20_projekte/Ideen.md", "# Ideen\n\nNur eine lose Idee #projekt.\n");
  server = await starteServer(vault);
});
test.afterEach(() => server?.stopp());

async function oeffne(page, pfad = null) {
  await page.goto(server.url + (pfad ? "?pfad=" + encodeURIComponent(pfad) : ""));
  await page.waitForSelector("[data-karte]");
}
const karte = (page, pfad) => page.locator(`[data-karte][data-pfad="${pfad}"]`);
const tagZeile = (page, name) => page.locator(`#tag-baum .tag-zeile[data-tag="${name}"]`);
const toastMit = (page, text) => page.locator("#toast-host .toast", { hasText: text });
async function bild(page, name) { if (!process.env.TAGS_BILD) return; await page.waitForTimeout(500); await page.screenshot({ path: `${process.env.TAGS_BILD}/${name}.png` }); }
// Erst sichtbar scrollen und warten, bis der Scroll-Ereignis durch ist: ein Scrollen schließt jedes offene Menü (popover.js), auch das vom Test selbst ausgelöste
async function rechtsklick(page, loc) {
  await loc.scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(ok, 120)))));
  await loc.click({ button: "right" });
  await page.waitForSelector(".menue.offen");
}
const menueEintrag = (page, name) => page.locator(`.menue.offen .m-eintrag[data-menue="${name}"]`);

test("Seitenleiste: Bereich „Tags“ mit Zählern und Baum, Code zählt nicht, Klick filtert die Liste", async ({ page }) => {
  await oeffne(page);
  await expect(page.locator('[data-abschnitt="tags"]')).toBeVisible();
  await expect(page.locator('[data-abschnitt="tags"] .abschnitt-titel')).toContainText("Tags");
  // oberste Ebene: projekt (3 Notizen: Atlas, Plan, Ideen), reise (1), wichtig (2); verschachtelte erst nach dem Aufklappen
  await expect(tagZeile(page, "projekt").locator(".dim")).toHaveText("3");
  await expect(tagZeile(page, "wichtig").locator(".dim")).toHaveText("2");
  await expect(tagZeile(page, "reise").locator(".dim")).toHaveText("1");
  await expect(tagZeile(page, "nichtzaehlen")).toHaveCount(0);
  await expect(tagZeile(page, "projekt/atlas")).toHaveCount(0);
  await tagZeile(page, "projekt").locator(".pfeil").click();
  await expect(tagZeile(page, "projekt/atlas").locator(".dim")).toHaveText("2");
  await expect(tagZeile(page, "projekt/zeitplan").locator(".dim")).toHaveText("1");
  await bild(page, "01-tags-seitenleiste");
  // Klick = Filter
  await tagZeile(page, "projekt/atlas").click();
  await expect(page.locator("#liste-titel")).toContainText("#projekt/atlas");
  await expect(page.locator("[data-karte]")).toHaveCount(2);
  await expect(karte(page, "20_projekte/Atlas.md")).toBeVisible();
  await expect(karte(page, "20_projekte/Plan.md")).toBeVisible();
  await expect(tagZeile(page, "projekt/atlas")).toHaveAttribute("aria-current", "true");
  await bild(page, "02-tag-filter");
  // der übergeordnete Tag enthält die Notizen darunter
  await tagZeile(page, "projekt").click();
  await expect(page.locator("[data-karte]")).toHaveCount(3);
});

test("Vervollständigung: # im Text bietet Tags an, Enter übernimmt; in Überschrift und Code kein Menü", async ({ page }) => {
  await oeffne(page, "20_projekte/Ideen.md");
  await page.waitForSelector(".cm-content .cm-line");
  await expect(tagZeile(page, "wichtig")).toBeVisible(); // die Tags sind geladen
  const ed = page.locator(".cm-content");
  await ed.click();
  await ed.press("Control+End");
  await ed.press("Enter");
  await ed.pressSequentially("Neu #pro");
  const liste = page.locator(".cm-tooltip-autocomplete");
  await expect(liste).toBeVisible();
  await expect(liste.locator("li")).toContainText(["projekt", "projekt/atlas", "projekt/zeitplan"]);
  await bild(page, "03-tag-vervollstaendigung");
  // CodeMirror nimmt Pfeile erst kurz nach dem Öffnen der Liste an: so lange wiederholen, bis die Auswahl sitzt
  await expect(async () => {
    await page.keyboard.press("ArrowDown");
    await expect(liste.locator('li[aria-selected="true"]')).toContainText("projekt/atlas", { timeout: 400 });
  }).toPass({ timeout: 8000 });
  await page.keyboard.press("Enter");
  await expect(page.locator(".cm-content .cm-line").last()).toHaveText("Neu #projekt/atlas");
  // Überschrift: kein Menü
  await ed.press("Enter");
  await ed.pressSequentially("## Titel #pro");
  await expect(liste).toHaveCount(0);
});

test("⌘Z außerhalb des Editors nimmt „Tag umbenennen“ zurück, ⇧⌘Z stellt es wieder her (R4-4)", async ({ page }) => {
  await oeffne(page);
  const vorher = lies("20_projekte/Atlas.md");
  await rechtsklick(page, tagZeile(page, "projekt"));
  await menueEintrag(page, "tag-umbenennen").click();
  const dlg = page.locator('[data-dialog="tag-umbenennen"]');
  await dlg.locator("input").fill("vorhaben");
  await dlg.locator('[data-aktion="tag-vorschau"]').click();
  await expect(dlg.locator('[data-aktion="tag-umbenennen"]')).toBeEnabled();
  await dlg.locator('[data-aktion="tag-umbenennen"]').click();
  await expect(toastMit(page, "#projekt heißt jetzt #vorhaben")).toBeVisible();
  await expect(toastMit(page, "#projekt heißt jetzt").locator(".toast-kz")).toHaveText("⌘Z");
  expect(lies("20_projekte/Atlas.md")).toContain("vorhaben/atlas");
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Meta+z");
  await expect(toastMit(page, "Umbenennen rückgängig gemacht")).toBeVisible();
  expect(lies("20_projekte/Atlas.md")).toBe(vorher);
  await expect(tagZeile(page, "projekt")).toBeVisible();
  await page.keyboard.press("Meta+Shift+z");
  await expect(toastMit(page, "Wieder ausgeführt")).toBeVisible();
  expect(lies("20_projekte/Atlas.md")).toContain("vorhaben/atlas");
});

test("Umbenennen: Vorschau nennt Notizen und Stellen, ein Hinweis mit Rückgängig, Rückgängig stellt jedes Byte her", async ({ page }) => {
  await oeffne(page);
  const vorher = { atlas: lies("20_projekte/Atlas.md"), plan: lies("20_projekte/Plan.md"), ideen: lies("20_projekte/Ideen.md") };
  await rechtsklick(page, tagZeile(page, "projekt"));
  await expect(page.locator(".menue.offen .m-eintrag")).toHaveText([/Notizen zeigen/, /In der Suche zeigen/, /Tag umbenennen …/]);
  await menueEintrag(page, "tag-umbenennen").click();
  const dlg = page.locator('[data-dialog="tag-umbenennen"]');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator("input")).toHaveValue("projekt");
  await dlg.locator("input").fill("vorhaben");
  await dlg.locator('[data-aktion="tag-vorschau"]').click();
  await expect(dlg.locator('[data-feld="tag-satz"]')).toHaveText("4 Stellen in 3 Notizen werden geändert:");
  await expect(dlg.locator(".da-vz")).toHaveCount(3);
  await expect(dlg.locator(".tag-vorschau")).not.toContainText("null");
  await expect(dlg.locator('[data-aktion="tag-umbenennen"]')).toBeEnabled();
  await bild(page, "04-tag-umbenennen-vorschau");
  // eine Änderung im Feld macht die Vorschau ungültig
  await dlg.locator("input").fill("vorhaben2");
  await expect(dlg.locator('[data-aktion="tag-umbenennen"]')).toBeDisabled();
  await dlg.locator("input").fill("vorhaben");
  await dlg.locator('[data-aktion="tag-vorschau"]').click();
  await expect(dlg.locator('[data-aktion="tag-umbenennen"]')).toBeEnabled();
  await dlg.locator('[data-aktion="tag-umbenennen"]').click();
  await expect(toastMit(page, "#projekt heißt jetzt #vorhaben")).toBeVisible();
  expect(lies("20_projekte/Atlas.md")).toContain("tags: [vorhaben/atlas, wichtig]");
  expect(lies("20_projekte/Plan.md")).toContain("Erst #vorhaben/atlas, dann #vorhaben/zeitplan und #wichtig.");
  expect(lies("20_projekte/Plan.md")).toContain("#nichtzaehlen");
  expect(lies("20_projekte/Ideen.md")).toContain("lose Idee #vorhaben.");
  await expect(tagZeile(page, "vorhaben")).toBeVisible();
  await expect(tagZeile(page, "projekt")).toHaveCount(0);
  await bild(page, "05-tag-umbenannt");
  await toastMit(page, "#projekt heißt jetzt").locator("a").click();
  await expect(toastMit(page, "Umbenennen rückgängig gemacht")).toBeVisible();
  expect(lies("20_projekte/Atlas.md")).toBe(vorher.atlas);
  expect(lies("20_projekte/Plan.md")).toBe(vorher.plan);
  expect(lies("20_projekte/Ideen.md")).toBe(vorher.ideen);
  await expect(tagZeile(page, "projekt")).toBeVisible();
});

test.describe("hohes Fenster", () => {
test.use({ viewport: { width: 1440, height: 1300 } }); // die Tag-Zeilen liegen weit unten in der Seitenleiste: Playwright soll das Menü nicht erst scrollen müssen
test("Suche und ⌘K: „In der Suche zeigen“ füllt tag:, die Palette findet Tags mit # und öffnet den Filter", async ({ page }) => {
  await oeffne(page);
  await rechtsklick(page, tagZeile(page, "wichtig"));
  await menueEintrag(page, "tag-suche").click();
  await expect(page.locator("#suche")).toHaveValue("tag:wichtig");
  await expect(page.locator("[data-karte]")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+k");
  const pal = page.locator(".palette");
  await expect(pal).toBeVisible();
  await pal.locator("input").fill("#proj");
  await expect(pal.locator('[data-pal="tag"]')).toHaveCount(3);
  await expect(pal.locator('[data-pal="notiz"]')).toHaveCount(0);
  await bild(page, "06-palette-tags");
  await pal.locator('[data-pal="tag"]', { hasText: "#projekt/zeitplan" }).click();
  await expect(page.locator("#liste-titel")).toContainText("#projekt/zeitplan");
  await expect(page.locator("[data-karte]")).toHaveCount(1);
});
});

test("Export-Dialog: Formate, ehrliche Beschriftung im Browser, HTML-Download ist eigenständig", async ({ page }) => {
  await oeffne(page);
  await rechtsklick(page, karte(page, "20_projekte/Atlas.md"));
  await expect(page.locator(".menue.offen .m-eintrag")).toContainText([/Exportieren …/, /Als Markdown kopieren/, /Formatiert kopieren/]);
  await expect(menueEintrag(page, "teilen")).toHaveCount(0); // Teilen gibt es nur in der Mac-App
  await menueEintrag(page, "exportieren").click();
  const dlg = page.locator('[data-dialog="export"]');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator(".dialog-kopf")).toHaveText("„Atlas“ exportieren");
  await expect(dlg).toContainText("Nichts wird hochgeladen");
  await expect(dlg.locator('[data-format="pdf"]')).toHaveText("PDF über Drucken");
  await dlg.locator('[data-format="pdf"]').click();
  await expect(dlg.locator('[data-feld="ex-beschreibung"]')).toContainText("Als PDF sichern");
  await expect(dlg.locator('[data-aktion="exportieren"]')).toContainText("Druckansicht öffnen");
  await bild(page, "07-export-dialog");
  await dlg.locator('[data-format="html"]').click();
  await expect(dlg.locator('[data-aktion="exportieren"]')).toContainText("Exportieren");
  const [download] = await Promise.all([page.waitForEvent("download"), dlg.locator('[data-aktion="exportieren"]').click()]);
  expect(download.suggestedFilename()).toBe("Atlas.html");
  const pfad = await download.path();
  const html = lies0(pfad, "utf8");
  expect(html).toMatch(/^<!doctype html>/);
  expect(html).toContain("<title>Atlas</title>");
  expect(html).toMatch(/<img src="data:image\/png;base64,/);
  expect(html).not.toMatch(/<script|<link |src="https?:/);
  await expect(toastMit(page, "Exportiert: Atlas.html")).toBeVisible();
});

test("Export Markdown: Notiz mit Bild kommt als ZIP (Browser), Ordner ebenfalls; die Datei ist ein gültiges Archiv mit .md und bilder/", async ({ page }) => {
  await oeffne(page);
  await rechtsklick(page, karte(page, "20_projekte/Atlas.md"));
  await menueEintrag(page, "exportieren").click();
  const dlg = page.locator('[data-dialog="export"]');
  await expect(dlg.locator('[data-feld="ex-beschreibung"]')).toContainText("Bilder liegen als Dateien");
  const [download] = await Promise.all([page.waitForEvent("download"), dlg.locator('[data-aktion="exportieren"]').click()]);
  expect(download.suggestedFilename()).toBe("Atlas.zip");
  const zip = lies0(await download.path());
  expect(zip.readUInt32LE(0)).toBe(0x04034b50);
  expect(zip.toString("latin1")).toMatch(/Atlas\.md/);
  expect(zip.toString("latin1")).toMatch(/bilder\/[0-9a-f]{8}-karte\.png/);
});

test("PDF im Browser: die Druckansicht öffnet sich in einem neuen Fenster und druckt (vom Studio ausgelöst, kein Skript im Dokument)", async ({ page, context }) => {
  // print() des neuen Fensters zählen statt den Druckdialog zu öffnen
  await context.addInitScript(() => { window.__gedruckt = 0; window.print = () => { window.__gedruckt++; }; });
  await oeffne(page);
  await rechtsklick(page, karte(page, "20_projekte/Plan.md"));
  await menueEintrag(page, "exportieren").click();
  const dlg = page.locator('[data-dialog="export"]');
  await dlg.locator('[data-format="pdf"]').click();
  const [popup] = await Promise.all([context.waitForEvent("page"), dlg.locator('[data-aktion="exportieren"]').click()]);
  await popup.waitForLoadState("domcontentloaded");
  await expect(popup.locator("h1")).toHaveText("Plan");
  await expect(popup.locator("body")).toContainText("dann #projekt/zeitplan");
  await popup.waitForFunction(() => window.__gedruckt === 1, null, { timeout: 5000 });
  expect(await popup.evaluate(() => document.querySelectorAll("script").length)).toBe(0);
  expect(await popup.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content)).toContain("default-src 'none'");
});

test("Kopieren: als Markdown (roh) und formatiert (HTML + Text in der Zwischenablage)", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await oeffne(page);
  await rechtsklick(page, karte(page, "20_projekte/Plan.md"));
  await menueEintrag(page, "markdown-kopieren").click();
  await expect(toastMit(page, "Als Markdown kopiert")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(lies("20_projekte/Plan.md"));
  await rechtsklick(page, karte(page, "20_projekte/Atlas.md"));
  await menueEintrag(page, "formatiert-kopieren").click();
  await expect(toastMit(page, "Formatiert kopiert")).toBeVisible();
  const html = await page.evaluate(async () => { const [i] = await navigator.clipboard.read(); return i.types.includes("text/html") ? await (await i.getType("text/html")).text() : null; });
  expect(html).toContain("<h1>Atlas</h1>");
  expect(html).toContain('<span class="tag">#reise</span>');
});

test("Export eines Ordners und Befehlspalette", async ({ page }) => {
  await oeffne(page);
  await page.locator('#baum .zeile[data-pfad="20_projekte"]').click({ button: "right" });
  await page.waitForSelector(".menue.offen");
  await menueEintrag(page, "exportieren").click();
  const dlg = page.locator('[data-dialog="export"]');
  await expect(dlg.locator(".dialog-kopf")).toHaveText("Ordner „20_projekte“ exportieren");
  await dlg.locator('[data-aktion="abbrechen"]').click();
  await karte(page, "20_projekte/Plan.md").click();
  await page.keyboard.press("Meta+k");
  const pal = page.locator(".palette");
  await pal.locator("input").fill("exportieren");
  await pal.locator('[data-pal="befehl"]', { hasText: "Notiz exportieren" }).click();
  await expect(page.locator('[data-dialog="export"] .dialog-kopf')).toHaveText("„Plan“ exportieren");
});
