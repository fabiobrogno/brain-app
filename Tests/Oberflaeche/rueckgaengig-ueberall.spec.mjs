// Rückgängig überall (R4-4): ⌘Z / ⇧⌘Z außerhalb des Editors nehmen den letzten Vorgang (Papierkorb, Verschieben, Umbenennen) zurück bzw. stellen ihn wieder her;
// im Editor gilt weiter nur der Stapel des Editors (CodeMirror). Echte Werkstatt, Wegwerf-Vault. Fotos: R44_BILDER=/Ordner
import { test, expect } from "./basis.mjs";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";

let vault, server;
const FOTO = process.env.R44_BILDER;
const lies = (p) => readFileSync(join(vault, p), "utf8");
const schreib = (p, inhalt) => { mkdirSync(join(vault, p, ".."), { recursive: true }); writeFileSync(join(vault, p), inhalt); };
const da = (p) => existsSync(join(vault, p));

test.beforeEach(async () => {
  ({ vault } = baueVault());
  schreib("20_projekte/Plan.md", "# Plan\n\nSiehe [[Zutaten]].\n");
  schreib("20_projekte/Zutaten.md", "# Zutaten\n\nMehl, Zucker.\n");
  schreib("30_ablage/Einzelnes.md", "# Einzelnes\n\nNichts verlinkt hierher.\n");
  schreib("30_ablage/Zweites.md", "# Zweites\n\nAuch allein.\n");
  server = await starteServer(vault);
});
test.afterEach(() => server?.stopp());

async function oeffne(page, pfad) {
  await page.goto(server.url + "?pfad=" + encodeURIComponent(pfad));
  await page.waitForSelector("[data-karte]");
  await page.waitForSelector(".cm-content .cm-line");
}
const karte = (page, pfad) => page.locator(`[data-karte][data-pfad="${pfad}"]`);
const toastMit = (page, text) => page.locator("#toast-host .toast", { hasText: text });
const ohneFokus = (page) => page.evaluate(() => document.activeElement?.blur());
const imEditor = async (page, f, arg) => {
  const hdl = await page.evaluateHandle(async () => { const CM = await import("/vendor/codemirror.bundle.js"); return { CM, view: CM.EditorView.findFromDOM(document.querySelector(".cm-editor")) }; });
  try { return await hdl.evaluate(f, arg); } finally { await hdl.dispose(); }
};
const dok = (page) => imEditor(page, ({ view }) => view.state.sliceDoc(0, view.state.doc.length));

test("Papierkorb: ⌘Z legt die Notiz zurück und öffnet sie wieder, ⇧⌘Z legt sie erneut in den Papierkorb; der Hinweis nennt die Taste", async ({ page }) => {
  await oeffne(page, "30_ablage/Einzelnes.md");
  await karte(page, "30_ablage/Einzelnes.md").click();
  await page.locator("#liste-koerper").focus();
  await page.keyboard.press("Meta+Backspace");
  await expect(toastMit(page, "In den Papierkorb gelegt")).toBeVisible();
  await expect(toastMit(page, "In den Papierkorb gelegt").locator(".toast-kz")).toHaveText("⌘Z");
  expect(da("30_ablage/Einzelnes.md")).toBe(false);
  await expect(page.locator("#editor")).toBeHidden();
  await ohneFokus(page);
  await page.keyboard.press("Meta+z");
  await expect(toastMit(page, "Aus dem Papierkorb zurückgelegt")).toBeVisible();
  await expect(toastMit(page, "Aus dem Papierkorb zurückgelegt").locator(".toast-kz")).toHaveText("⇧⌘Z");
  await expect(karte(page, "30_ablage/Einzelnes.md")).toBeVisible();
  expect(lies("30_ablage/Einzelnes.md")).toBe("# Einzelnes\n\nNichts verlinkt hierher.\n");
  await expect(page.locator("#pfad")).toHaveAttribute("data-tipp-text", "30_ablage/Einzelnes.md"); // und ist wieder offen
  await expect(page.locator("#editor")).toBeVisible();
  if (FOTO) { await page.waitForTimeout(500); await page.screenshot({ path: join(FOTO, "r44-toast-nach-cmdz.png") }); }
  await ohneFokus(page); // die wieder geöffnete Notiz nimmt den Fokus: im Editor gilt der Editor-Stapel
  await page.keyboard.press("Meta+Shift+z");
  await expect(toastMit(page, "Wieder ausgeführt")).toBeVisible();
  await expect.poll(() => da("30_ablage/Einzelnes.md")).toBe(false);
  await expect(karte(page, "30_ablage/Einzelnes.md")).toHaveCount(0);
});

test("Verschieben und Umbenennen: ⌘Z geht Schritt für Schritt zurück (neuester zuerst), ⇧⌘Z wieder vor; ohne Vorgang sagt es das", async ({ page }) => {
  await oeffne(page, "30_ablage/Einzelnes.md");
  await ohneFokus(page);
  await page.keyboard.press("Meta+z");
  await expect(toastMit(page, "Nichts zum Rückgängigmachen")).toBeVisible();
  // 1. Umbenennen (F2 auf der offenen Notiz)
  await page.keyboard.press("F2");
  await page.locator("#pfad .inline-name").fill("Einzelstück");
  await page.keyboard.press("Enter");
  await expect(toastMit(page, "Umbenannt")).toBeVisible();
  await expect.poll(() => da("30_ablage/Einzelstück.md")).toBe(true);
  // 2. Verschieben über das Menü der Karte
  await karte(page, "30_ablage/Zweites.md").click({ button: "right" });
  await page.locator('.menue.offen .m-eintrag[data-menue="verschieben"]').click();
  await page.keyboard.type("proj");
  await page.keyboard.press("Enter");
  await expect(toastMit(page, "Verschoben")).toBeVisible();
  await expect.poll(() => da("20_projekte/Zweites.md")).toBe(true);
  await ohneFokus(page);
  // ⌘Z: zuerst das Verschieben, dann das Umbenennen
  await page.keyboard.press("Meta+z");
  await expect(toastMit(page, "Verschieben rückgängig gemacht")).toBeVisible();
  await expect.poll(() => da("30_ablage/Zweites.md")).toBe(true);
  expect(da("30_ablage/Einzelstück.md")).toBe(true);
  await page.keyboard.press("Meta+z");
  await expect(toastMit(page, "Umbenennen rückgängig gemacht")).toBeVisible();
  await expect.poll(() => da("30_ablage/Einzelnes.md")).toBe(true);
  expect(da("30_ablage/Einzelstück.md")).toBe(false);
  await expect(page.locator("#pfad")).toHaveAttribute("data-tipp-text", "30_ablage/Einzelnes.md"); // die offene Notiz folgt
  await ohneFokus(page);
  await page.keyboard.press("Meta+z");
  await expect(toastMit(page, "Nichts zum Rückgängigmachen").last()).toBeVisible();
  // ⇧⌘Z: erst das Umbenennen, dann das Verschieben wieder
  await page.keyboard.press("Meta+Shift+z");
  await expect.poll(() => da("30_ablage/Einzelstück.md")).toBe(true);
  expect(da("30_ablage/Zweites.md")).toBe(true);
  await page.keyboard.press("Meta+Shift+z");
  await expect.poll(() => da("20_projekte/Zweites.md")).toBe(true);
  expect(da("30_ablage/Zweites.md")).toBe(false);
  await page.keyboard.press("Meta+Shift+z");
  await expect(toastMit(page, "Nichts zum Wiederholen").last()).toBeVisible();
  // eine neue Aktion leert „Wiederholen“
  await page.keyboard.press("Meta+z");
  await expect.poll(() => da("30_ablage/Zweites.md")).toBe(true);
  await karte(page, "30_ablage/Zweites.md").click();
  await expect(page.locator("#pfad")).toHaveAttribute("data-tipp-text", "30_ablage/Zweites.md");
  await page.locator("#liste-koerper").focus();
  await page.keyboard.press("Meta+Backspace");
  await expect.poll(() => da("30_ablage/Zweites.md")).toBe(false);
  await ohneFokus(page);
  await page.keyboard.press("Meta+Shift+z");
  await expect(toastMit(page, "Nichts zum Wiederholen").last()).toBeVisible();
});

test("Fokus im Editor: ⌘Z nimmt nur Text zurück und lässt die Dateiaktion stehen; erst außerhalb des Editors wirkt der Dateistapel", async ({ page }) => {
  await oeffne(page, "30_ablage/Einzelnes.md");
  await karte(page, "30_ablage/Zweites.md").click();
  await expect(page.locator("#pfad")).toHaveAttribute("data-tipp-text", "30_ablage/Zweites.md");
  await page.locator("#liste-koerper").focus();
  await page.keyboard.press("Meta+Backspace"); // Zweites in den Papierkorb
  await expect.poll(() => da("30_ablage/Zweites.md")).toBe(false);
  await karte(page, "30_ablage/Einzelnes.md").click();
  await page.waitForSelector(".cm-content .cm-line");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.type("Neu dazu.");
  expect((await dok(page))).toContain("Neu dazu.");
  await page.keyboard.press("Meta+z");
  expect((await dok(page))).not.toContain("Neu dazu.");
  expect(da("30_ablage/Zweites.md")).toBe(false); // die Dateiaktion wurde nicht berührt
  await page.waitForTimeout(300);
  expect(da("30_ablage/Zweites.md")).toBe(false);
  await ohneFokus(page);
  await page.keyboard.press("Meta+z");
  await expect.poll(() => da("30_ablage/Zweites.md")).toBe(true);
});
