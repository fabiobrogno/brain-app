// Integration #93 (Entwurfs-Journal, Zusammenführen) + #95 (Umbenennen/Verschieben/Papierkorb) + #96 (⌘N, Tagesnotiz, Zurück/Vor).
// Echte Werkstatt, Wegwerf-Vault im Temp-Ordner; die Uhr steht fest auf Donnerstag, 5. November 2026 (Berlin). Die Werkstatt bekommt eine ausdrücklich gebaute Umgebung (HOME im Temp-Ordner).
import { test, expect } from "./basis.mjs";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";

const JETZT = new Date("2026-11-05T10:07:03+01:00");
let vault, server;

const schreibeDateien = (dateien) => { for (const [p, inhalt] of Object.entries(dateien)) { mkdirSync(join(vault, p, ".."), { recursive: true }); writeFileSync(join(vault, p), inhalt); } };
test.beforeEach(async ({ page }) => {
  ({ vault } = baueVault());
  schreibeDateien({
    "brain.config.json": JSON.stringify({ name: "Kortex", ordner: { vorlagen: "Vorlagen" }, automatik: {} }) + "\n",
    "Vorlagen/Besprechung.md": "# {{titel}}\n",
    "Tagebuch/2026-11-01.md": "# Sonntag, 1. November 2026\n",
  });
  const home = realpathSync(mkdtempSync(join(tmpdir(), "kortex-sint-home-")));
  server = await starteServer(vault, { umgebung: { PATH: process.env.PATH, HOME: home, TMPDIR: home, TZ: "Europe/Berlin", LANG: "de_DE.UTF-8", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(home, ".gitconfig") } });
  await page.clock.setFixedTime(JETZT);
  await page.addInitScript(() => { window.__journalMs = 300; }); // Entwurfs-Journal im Test alle 0,3 s statt alle 5 s
});
test.afterEach(() => server?.stopp());

const lese = (p) => readFileSync(join(vault, p), "utf8");
const da = (p) => existsSync(join(vault, p));
async function start(page, pfad = null) {
  await page.goto(server.url + (pfad ? "?pfad=" + encodeURIComponent(pfad) : ""));
  await page.waitForSelector("#bereiche .eintrag");
  if (pfad) await page.waitForSelector(".cm-content .cm-line");
}
const setzeText = (page, text) => page.evaluate((t) => { const v = window.studio.ed.view; v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: t } }); }, text);
const entwuerfe = (page) => page.evaluate(async () => (await (await fetch("/api/entwuerfe")).json()).entwuerfe);
const karte = (page, pfad) => page.locator(`[data-karte][data-pfad="${pfad}"]`);
const zeile = (page, pfad) => page.locator(`#baum .zeile[data-pfad="${pfad}"]`);
async function rechtsklick(page, loc) { await loc.click({ button: "right" }); await page.waitForSelector(".menue.offen"); }
const menueEintrag = (page, name) => page.locator(`.menue.offen .m-eintrag[data-menue="${name}"]`);
const toastMit = (page, text) => page.locator("#toast-host .toast", { hasText: text });
const krume = (page) => page.locator("#pfad .krume.aktuell");

// ───────────────────────────── Punkt 1: Entwürfe ohne Datei im Journal
test("Punkt 1: ein Entwurf ohne Titel steht im Journal (entwurf:<Kennung>) und wird nach einem Absturz wieder angeboten; Wiederherstellen legt die Notiz an und räumt das Journal", async ({ page }) => {
  await start(page);
  await page.route("**/api/neu", (r) => r.fulfill({ status: 500, json: { fehler: "kaputt" } })); // die Datei entsteht nicht: so bleibt der Text nur im Journal (wie bei einem Absturz)
  await page.keyboard.press("Meta+n");
  await page.keyboard.type("Käse-Idee für März");
  await expect.poll(async () => (await entwuerfe(page)).map((e) => e.pfad).filter((p) => p.startsWith("entwurf:")).length, { timeout: 8000 }).toBe(1);
  expect(da("00_inbox/kaese-idee-fuer-maerz.md")).toBe(false);
  await page.unroute("**/api/neu");
  // „Absturz“: die Seite wird ohne Speichern neu geladen (beforeunload darf nichts mehr schreiben)
  await page.evaluate(() => { window.studio.ed.view.contentDOM.blur(); });
  await page.route("**/api/neu", (r) => r.fulfill({ status: 500, json: { fehler: "kaputt" } }));
  await page.reload();
  await page.waitForSelector("#bereiche .eintrag");
  await page.unroute("**/api/neu");
  const hinweis = toastMit(page, "Ungespeicherte neue Notiz");
  await expect(hinweis).toBeVisible({ timeout: 8000 });
  await hinweis.locator("a").click();
  await expect.poll(() => da("00_inbox/kaese-idee-fuer-maerz.md"), { timeout: 8000 }).toBe(true);
  expect(lese("00_inbox/kaese-idee-fuer-maerz.md")).toContain("Käse-Idee für März");
  await expect(krume(page)).toHaveText("Käse-Idee für März");
  await expect.poll(async () => (await entwuerfe(page)).filter((e) => e.pfad.startsWith("entwurf:")).length).toBe(0);
});

test("Punkt 1: ein Tagesnotiz-Entwurf kommt mit festem Pfad zurück; erfolgreiches Anlegen löscht den Journal-Eintrag", async ({ page }) => {
  await start(page);
  await page.keyboard.press("Meta+Shift+d");
  await expect.poll(() => da("Tagebuch/2026-11-05.md")).toBe(true);
  await page.locator('#tag-nav [data-tag="zurueck"]').click();
  await expect(krume(page)).toHaveText("Mittwoch, 4. November 2026");
  await page.route("**/api/datei", (r) => (r.request().method() === "PUT" ? r.fulfill({ status: 500, json: { fehler: "kaputt" } }) : r.fallback()));
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.type("Gestern war ruhig.");
  await expect.poll(async () => (await entwuerfe(page)).filter((e) => e.pfad.startsWith("entwurf:")).length, { timeout: 8000 }).toBe(1);
  const meta = (await entwuerfe(page)).find((e) => e.pfad.startsWith("entwurf:")).meta;
  expect(meta.pfad).toBe("Tagebuch/2026-11-04.md");
  await page.reload();
  await page.waitForSelector("#bereiche .eintrag");
  await page.unroute("**/api/datei");
  await page.route("**/api/datei", (r) => (r.request().method() === "PUT" ? r.fallback() : r.fallback()));
  const hinweis = toastMit(page, "Ungespeicherte neue Notiz");
  await expect(hinweis).toBeVisible({ timeout: 8000 });
  await hinweis.locator("a").click();
  await expect.poll(() => da("Tagebuch/2026-11-04.md"), { timeout: 8000 }).toBe(true);
  expect(lese("Tagebuch/2026-11-04.md")).toContain("Gestern war ruhig.");
  await expect.poll(async () => (await entwuerfe(page)).filter((e) => e.pfad.startsWith("entwurf:")).length).toBe(0);
});

test("Punkt 1: wird die Datei normal angelegt, bleibt nichts im Journal", async ({ page }) => {
  await start(page);
  await page.keyboard.press("Meta+n");
  await page.keyboard.type("Normale Notiz");
  await expect(page.locator("#speicherstand")).toHaveText("Gespeichert", { timeout: 8000 });
  await page.waitForTimeout(900); // das Journal hatte Zeit, etwas zu schreiben
  expect((await entwuerfe(page)).filter((e) => e.pfad.startsWith("entwurf:"))).toHaveLength(0);
  expect(lese("00_inbox/normale-notiz.md")).toContain("Normale Notiz");
});

// ───────────────────────────── Punkt 2: Zurück/Vor folgt Umbenennen
test("Punkt 2: Zurück/Vor folgt einer Umbenennung (#95) statt den Eintrag fallen zu lassen; ein gelöschter Ordner nimmt seine Einträge mit", async ({ page }) => {
  await start(page, "10_notizen/Reise nach Lissabon.md");
  await page.keyboard.press("Meta+k"); await page.keyboard.type("Espresso"); await page.keyboard.press("Enter");
  await expect(krume(page)).toHaveText("Espresso");
  await rechtsklick(page, karte(page, "10_notizen/Reise nach Lissabon.md"));
  await menueEintrag(page, "umbenennen").click();
  await page.locator(".inline-name").fill("Reise nach Porto");
  await page.locator(".inline-name").press("Enter");
  await expect(toastMit(page, "Umbenannt")).toBeVisible();
  expect(da("10_notizen/Reise nach Porto.md")).toBe(true);
  const stand = await page.evaluate(() => window.studio.schreiben.verlauf.zustandJetzt());
  expect(stand.liste).toContain("10_notizen/Reise nach Porto.md");
  expect(stand.liste).not.toContain("10_notizen/Reise nach Lissabon.md");
  await page.keyboard.press("Meta+Alt+ArrowLeft");
  await expect(krume(page)).toHaveText("Reise nach Porto");
  // Rückgängig führt den Eintrag zurück
  await toastMit(page, "Umbenannt").locator("a").click();
  await expect(toastMit(page, "Umbenennen rückgängig gemacht")).toBeVisible();
  expect((await page.evaluate(() => window.studio.schreiben.verlauf.zustandJetzt())).liste).toContain("10_notizen/Reise nach Lissabon.md");
  // entfernt(pfad, ordner): auch alles darunter
  await page.evaluate(() => window.studio.schreiben.entfernt("09_wiki/wissen", true));
  expect((await page.evaluate(() => window.studio.schreiben.verlauf.zustandJetzt())).liste.some((p) => p.startsWith("09_wiki/wissen/"))).toBe(false);
});

// ───────────────────────────── Punkt 3 und 6: Tagesnotiz-Entwurf folgt dem verschobenen Ordner, Einstellung folgt mit
test("Punkt 3 und 6: wird der Tagebuch-Ordner umbenannt, fragt Kortex einmal nach, der offene Tages-Entwurf folgt (kein neuer alter Ordner) und die Einstellung zieht mit", async ({ page }) => {
  await start(page);
  await page.keyboard.press("Meta+Shift+d");
  await expect.poll(() => da("Tagebuch/2026-11-05.md")).toBe(true);
  await page.locator('#tag-nav [data-tag="zurueck"]').click();
  await expect(krume(page)).toHaveText("Mittwoch, 4. November 2026");
  // Abbrechen lässt alles, wie es war
  await rechtsklick(page, zeile(page, "Tagebuch"));
  await menueEintrag(page, "umbenennen").click();
  await page.locator(".inline-name").fill("Journal");
  await page.locator(".inline-name").press("Enter");
  const dlg = page.locator('[data-dialog="tag-ordner"]');
  await expect(dlg).toContainText("Ordner deiner Tagesnotizen");
  await dlg.locator('[data-aktion="abbrechen"]').click();
  await page.waitForTimeout(300);
  expect(da("Tagebuch/2026-11-05.md")).toBe(true);
  expect(da("Journal")).toBe(false);
  // jetzt wirklich
  await rechtsklick(page, zeile(page, "Tagebuch"));
  await menueEintrag(page, "umbenennen").click();
  await page.locator(".inline-name").fill("Journal");
  await page.locator(".inline-name").press("Enter");
  await page.locator('[data-dialog="tag-ordner"] [data-aktion="tag-ordner-weiter"]').click();
  await expect(toastMit(page, "Umbenannt")).toBeVisible();
  expect(da("Journal/2026-11-05.md")).toBe(true);
  expect(da("Tagebuch")).toBe(false);
  const werte = await page.evaluate(async () => (await (await fetch("/api/einstellungen")).json()).werte);
  expect(werte.tagesnotizOrdner).toBe("Journal");
  // der Entwurf des 4. November liegt jetzt im neuen Ordner, nicht im alten
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.type("Gestern war ruhig.");
  await expect.poll(() => da("Journal/2026-11-04.md"), { timeout: 8000 }).toBe(true);
  expect(da("Tagebuch")).toBe(false);
  expect(lese("Journal/2026-11-04.md")).toContain("Gestern war ruhig.");
});

// ───────────────────────────── Punkt 4: Brotkrume eines Entwurfs
test("Punkt 4: Umbenennen auf einem Entwurf (F2, Doppelklick, Kontextmenü der Brotkrume) tut nichts und ruft die Werkstatt nie mit leerem Pfad", async ({ page }) => {
  const aufrufe = [];
  page.on("request", (r) => { if (/\/api\/(notiz|ordner)\//.test(r.url())) aufrufe.push(r.url()); });
  await start(page);
  await page.keyboard.press("Meta+n");
  await expect(krume(page)).toHaveText("Neue Notiz");
  await page.keyboard.press("F2");
  await krume(page).dblclick();
  await krume(page).click({ button: "right" });
  await page.waitForTimeout(300);
  await expect(page.locator(".inline-name")).toHaveCount(0);
  await expect(page.locator(".menue.offen")).toHaveCount(0);
  expect(aufrufe).toEqual([]);
  await expect(krume(page)).toHaveText("Neue Notiz");
});

// ───────────────────────────── Punkt 5: Entwurf zieht mit
test("Punkt 5: ein gemerkter Absturz-Entwurf zieht beim Umbenennen mit (statt als Waise in der Ablage zu landen) und wird danach wieder angeboten", async ({ page }) => {
  const r = await fetch(server.url + "api/entwurf", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ pfad: "10_notizen/Reise nach Lissabon.md", basisHash: null, text: "# Reise nach Lissabon\n\nNur im Entwurf.\n" }) });
  expect(r.ok).toBe(true);
  await start(page);
  await expect(toastMit(page, "Ungespeicherter Text")).toBeVisible({ timeout: 8000 }); // der Start ist fertig (der Hinweis zeichnet die Liste neu)
  await zeile(page, "10_notizen").click(); // Ordneransicht: die Karte steht sichtbar oben
  await rechtsklick(page, karte(page, "10_notizen/Reise nach Lissabon.md"));
  await menueEintrag(page, "umbenennen").click();
  await page.locator(".inline-name").fill("Reise nach Porto");
  await page.locator(".inline-name").press("Enter");
  await expect(toastMit(page, "Umbenannt")).toBeVisible();
  await expect.poll(async () => (await entwuerfe(page)).map((e) => e.pfad)).toEqual(["10_notizen/Reise nach Porto.md"]);
  await page.reload();
  await page.waitForSelector("#bereiche .eintrag");
  await expect(toastMit(page, "Reise nach Porto")).toBeVisible({ timeout: 8000 });
  await expect(toastMit(page, "liegt jetzt unter")).toHaveCount(0); // keine Waise
  const abl = await page.evaluate(async () => (await (await fetch("/api/ablage")).json()).fassungen);
  expect(abl).toHaveLength(0);
});

// ───────────────────────────── Punkt 6: geschützte Ordner
test("Punkt 6: der Vorlagenordner des Vaults ist geschützt (kein Umbenennen/Löschen/Verschieben), Notizen darin lassen sich umbenennen", async ({ page }) => {
  await start(page);
  await rechtsklick(page, zeile(page, "Vorlagen"));
  await expect(menueEintrag(page, "umbenennen")).toHaveCount(0);
  await expect(page.locator(".menue.offen")).toContainText("gehört fest zu Kortex");
  await page.keyboard.press("Escape");
  await page.keyboard.press("F2");
  await expect(page.locator(".inline-name")).toHaveCount(0);
});

// ───────────────────────────── Punkt 7: Basis bei Pfadwechseln
test("Punkt 7: nach Zurück-Navigation und nach Tageswechsel baut die Zusammenführung auf dem Text der geöffneten Datei auf (nichts geht verloren)", async ({ page }) => {
  const fremd = async (datei, text) => { writeFileSync(join(vault, datei), text); };
  // Zurück/Vor
  await start(page, "10_notizen/Reise nach Lissabon.md");
  const roh = lese("10_notizen/Reise nach Lissabon.md");
  await page.keyboard.press("Meta+k"); await page.keyboard.type("Espresso"); await page.keyboard.press("Enter");
  await expect(krume(page)).toHaveText("Espresso");
  await page.keyboard.press("Meta+Alt+ArrowLeft");
  await expect(krume(page)).toHaveText("Reise nach Lissabon");
  await page.route("**/api/datei", (r) => (r.request().method() !== "PUT" ? r.fallback() : r.fulfill({ status: 500, json: { fehler: "offline" } })));
  await page.keyboard.press("Meta+ArrowDown"); await page.keyboard.type("MEINE ZEILE");
  await fremd("10_notizen/Reise nach Lissabon.md", "KI-OBEN\n" + roh);
  await page.unroute("**/api/datei");
  await expect.poll(() => lese("10_notizen/Reise nach Lissabon.md"), { timeout: 10000 }).toContain("MEINE ZEILE");
  expect(lese("10_notizen/Reise nach Lissabon.md")).toContain("KI-OBEN");
  await expect(page.locator('[data-banner="fremd-konflikt"]')).toHaveCount(0);
  // Tageswechsel: von der Notiz von heute zur schon vorhandenen vom 1. November und zurück
  await page.keyboard.press("Meta+Shift+d");
  await expect.poll(() => da("Tagebuch/2026-11-05.md")).toBe(true);
  await page.evaluate(() => window.studio.schreiben.oeffneTag("2026-11-01"));
  await expect(krume(page)).toHaveText("Sonntag, 1. November 2026");
  await page.route("**/api/datei", (r) => (r.request().method() !== "PUT" ? r.fallback() : r.fulfill({ status: 500, json: { fehler: "offline" } })));
  await page.keyboard.press("Meta+ArrowDown"); await page.keyboard.type("TAG-ZEILE");
  await fremd("Tagebuch/2026-11-01.md", "KI-OBEN\n# Sonntag, 1. November 2026\n");
  await page.unroute("**/api/datei");
  await expect.poll(() => lese("Tagebuch/2026-11-01.md"), { timeout: 10000 }).toContain("TAG-ZEILE");
  expect(lese("Tagebuch/2026-11-01.md")).toContain("KI-OBEN");
});
