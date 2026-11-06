// Umbenennen, Verschieben, Papierkorb im Studio: Kontextmenü, Umbenennen an Ort und Stelle, Vorschau „N Verweise in M Notizen“, Ordner-Wähler, Ziehen und Ablegen,
// F2 / ⌘⌫, Papierkorb-Ansicht, Rückgängig im Hinweis, Rückrollen bei Fehlern. Echte Werkstatt, Wegwerf-Vault.
import { test, expect } from "./basis.mjs";
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";

let vault, server;
const lies = (p) => readFileSync(join(vault, p), "utf8");
const schreib = (p, inhalt) => { mkdirSync(join(vault, p, ".."), { recursive: true }); writeFileSync(join(vault, p), inhalt); };

test.beforeEach(async () => {
  ({ vault } = baueVault());
  schreib("20_projekte/Plan.md", "# Plan\n\nSiehe [[Zutaten]] und [[Zutaten|die Liste]].\n");
  schreib("20_projekte/Zutaten.md", "# Zutaten\n\nMehl, Zucker.\n");
  schreib("20_projekte/Rezepte/Kuchen.md", "# Kuchen\n\nBacken mit [[Zutaten]]. Zurück zum [Plan](../Plan.md).\n");
  schreib("20_projekte/Archiv/.keep", "");
  schreib("30_ablage/Einzelnes.md", "# Einzelnes\n\nNichts verlinkt hierher.\n");
  server = await starteServer(vault);
});
test.afterEach(() => server?.stopp());

async function oeffne(page, pfad = null) {
  await page.goto(server.url + (pfad ? "?pfad=" + encodeURIComponent(pfad) : ""));
  await page.waitForSelector("[data-karte]");
}
const karte = (page, pfad) => page.locator(`[data-karte][data-pfad="${pfad}"]`);
const zeile = (page, pfad) => page.locator(`#baum .zeile[data-pfad="${pfad}"]`);
const toastMit = (page, text) => page.locator("#toast-host .toast", { hasText: text });
async function rechtsklick(page, loc) { await loc.click({ button: "right" }); await page.waitForSelector(".menue.offen"); }
async function klappeAuf(page, ordner) {
  if (await zeile(page, ordner).locator(".pfeil.offen").count()) return;
  await zeile(page, ordner).locator(".pfeil").click();
}
// Nur zum Ansehen beim Entwickeln (UMB_BILD=<Ordner>): wartet, bis Übergänge fertig sind, und fotografiert die Seite (nie den Bildschirm)
async function bild(page, name) { if (!process.env.UMB_BILD) return; await page.waitForTimeout(500); await page.screenshot({ path: `${process.env.UMB_BILD}/${name}.png` }); }
const menueEintrag = (page, name) => page.locator(`.menue.offen .m-eintrag[data-menue="${name}"]`);

test("Kontextmenü einer Notizkarte: Umbenennen an Ort und Stelle, Vorschau mit Verweisen, Hinweis „Umbenannt · Rückgängig“, Rückgängig stellt alles her", async ({ page }) => {
  await oeffne(page);
  const vorher = { plan: lies("20_projekte/Plan.md"), kuchen: lies("20_projekte/Rezepte/Kuchen.md") };
  await rechtsklick(page, karte(page, "20_projekte/Zutaten.md"));
  await expect(page.locator(".menue.offen .m-eintrag")).toHaveText([/Öffnen/, /Umbenennen\s*F2/, /Verschieben …/, /In den Papierkorb\s*⌘⌫/]);
  await menueEintrag(page, "umbenennen").click();
  const feld = page.locator(".inline-name");
  await expect(feld).toBeFocused();
  await expect(feld).toHaveValue("Zutaten");
  await feld.fill("Backzutaten");
  await feld.press("Enter");
  // die Vorschau nennt, was angepasst wird
  const dlg = page.locator('[data-dialog="dateiaktion"]');
  await expect(dlg.locator('[data-feld="satz"]')).toHaveText("3 Verweise in 2 Notizen werden angepasst");
  await expect(dlg.locator(".da-vz")).toHaveCount(2);
  await expect(dlg.locator(".da-nachher").first()).toContainText("Backzutaten");
  await bild(page, "vorschau");
  await dlg.locator('[data-aktion="bestaetigen"]').click();
  await expect(toastMit(page, "Umbenannt")).toBeVisible();
  await expect(toastMit(page, "Umbenannt").locator("a")).toHaveText("Rückgängig");
  await expect(karte(page, "20_projekte/Backzutaten.md").locator(".karte-titel")).toHaveText("Backzutaten");
  expect(existsSync(join(vault, "20_projekte/Zutaten.md"))).toBe(false);
  expect(lies("20_projekte/Backzutaten.md")).toBe("# Backzutaten\n\nMehl, Zucker.\n");
  expect(lies("20_projekte/Plan.md")).toBe("# Plan\n\nSiehe [[Backzutaten]] und [[Backzutaten|die Liste]].\n");
  expect(lies("20_projekte/Rezepte/Kuchen.md")).toContain("[[Backzutaten]]");
  await toastMit(page, "Umbenannt").locator("a").click();
  await expect(toastMit(page, "Umbenennen rückgängig gemacht")).toBeVisible();
  await expect(karte(page, "20_projekte/Zutaten.md").locator(".karte-titel")).toHaveText("Zutaten");
  await expect(karte(page, "20_projekte/Backzutaten.md")).toHaveCount(0);
  expect(lies("20_projekte/Plan.md")).toBe(vorher.plan);
  expect(lies("20_projekte/Rezepte/Kuchen.md")).toBe(vorher.kuchen);
  expect(lies("20_projekte/Zutaten.md")).toBe("# Zutaten\n\nMehl, Zucker.\n");
});

test("F2 benennt die offene Notiz im Titel um: Editor und Tab-Titel folgen, Dateiname folgt dem Titel, keine Verweise → keine Rückfrage; Esc verwirft", async ({ page }) => {
  await oeffne(page, "30_ablage/Einzelnes.md");
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Einzelnes");
  await page.keyboard.press("F2");
  const feld = page.locator("#pfad .inline-name");
  await expect(feld).toBeFocused();
  await feld.fill("Etwas anderes");
  await feld.press("Escape");
  await expect(page.locator(".inline-name")).toHaveCount(0);
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Einzelnes");
  expect(existsSync(join(vault, "30_ablage/Einzelnes.md"))).toBe(true);
  await page.keyboard.press("F2");
  await page.locator("#pfad .inline-name").fill("Einzelstück");
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-dialog="dateiaktion"]')).toHaveCount(0);
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Einzelstück");
  await expect(page.locator("#pfad")).toHaveAttribute("title", "30_ablage/Einzelstück.md");
  await expect(toastMit(page, "Umbenannt")).toBeVisible(); // die Oberfläche zeigt es sofort, die Platte folgt mit der Antwort der Werkstatt
  expect(existsSync(join(vault, "30_ablage/Einzelstück.md"))).toBe(true);
  expect(lies("30_ablage/Einzelstück.md")).toBe("# Einzelstück\n\nNichts verlinkt hierher.\n");
  await expect(page).toHaveTitle(/Einzelstück/);
  // der Editor zeigt den neuen Titel und schreibt weiter in die umbenannte Datei
  await expect(page.locator(".cm-content")).toContainText("Einzelstück");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.type("Neu dazu.");
  await expect.poll(() => lies("30_ablage/Einzelstück.md")).toContain("Neu dazu.");
});

test("Doppelklick auf den Titel und das Menü des Titels: Umbenennen, Verschieben, Papierkorb", async ({ page }) => {
  await oeffne(page, "30_ablage/Einzelnes.md");
  await rechtsklick(page, page.locator("#pfad .krume.aktuell"));
  await expect(page.locator(".menue.offen .m-eintrag")).toHaveText([/Umbenennen/, /Verschieben/, /In den Papierkorb/]);
  await page.keyboard.press("Escape");
  await page.locator("#pfad .krume.aktuell").dblclick();
  await expect(page.locator("#pfad .inline-name")).toBeFocused();
  await page.keyboard.press("Escape");
});

test("Ordner umbenennen: ungültiger Name zeigt einen Hinweis und wird nicht übernommen, gültiger benennt um, Verweise und offene Notiz folgen", async ({ page }) => {
  await oeffne(page, "20_projekte/Rezepte/Kuchen.md");
  schreib("20_projekte/Rezepte/Brot.md", "# Brot\n\nSiehe [[Rezepte/Kuchen]] und [Kuchen](Kuchen.md).\n");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await klappeAuf(page, "20_projekte");
  await expect(zeile(page, "20_projekte/Rezepte")).toBeVisible();
  await rechtsklick(page, zeile(page, "20_projekte/Rezepte"));
  await menueEintrag(page, "umbenennen").click();
  const feld = zeile(page, "20_projekte/Rezepte").locator(".inline-name");
  await expect(feld).toBeFocused();
  await feld.fill("a/b");
  await feld.press("Enter");
  await expect(zeile(page, "20_projekte/Rezepte").locator(".inline-hinweis")).toContainText("nicht erlaubt");
  await expect(feld).toHaveAttribute("aria-invalid", "true");
  expect(existsSync(join(vault, "20_projekte/Rezepte"))).toBe(true);
  await feld.fill("Backwaren");
  await feld.press("Enter");
  await expect(page.locator('[data-dialog="dateiaktion"] [data-feld="satz"]')).toHaveText("1 Verweis in 1 Notiz wird angepasst");
  await page.locator('[data-dialog="dateiaktion"] [data-aktion="bestaetigen"]').click();
  await expect(toastMit(page, "Umbenannt")).toBeVisible();
  await expect(zeile(page, "20_projekte/Backwaren")).toBeVisible();
  expect(existsSync(join(vault, "20_projekte/Backwaren/Kuchen.md"))).toBe(true);
  expect(lies("20_projekte/Backwaren/Brot.md")).toBe("# Brot\n\nSiehe [[Backwaren/Kuchen]] und [Kuchen](Kuchen.md).\n");
  await expect(page.locator("#pfad")).toHaveAttribute("title", "20_projekte/Backwaren/Kuchen.md");
});

test("Verschieben über den Ordner-Wähler: Suchen, Pfeiltasten, Enter; Verweise folgen; Rückgängig bringt die Notiz zurück", async ({ page }) => {
  await oeffne(page, "20_projekte/Zutaten.md");
  await rechtsklick(page, karte(page, "20_projekte/Zutaten.md"));
  await menueEintrag(page, "verschieben").click();
  const wahl = page.locator('[data-dialog="ordner-waehler"]');
  await expect(wahl).toBeVisible();
  await expect(wahl.locator(".ov-hier")).toContainText("liegt hier");
  await page.keyboard.type("abla");
  await expect(wahl.locator(".pal-eintrag")).toHaveCount(1);
  await expect(wahl.locator(".pal-eintrag")).toContainText("30_ablage");
  await bild(page, "waehler");
  await page.keyboard.press("Enter");
  // Zutaten wird per Titel verlinkt: es gibt nichts anzupassen, also keine Rückfrage
  await expect(toastMit(page, "Verschoben")).toBeVisible();
  expect(existsSync(join(vault, "30_ablage/Zutaten.md"))).toBe(true);
  await expect(page.locator("#pfad")).toHaveAttribute("title", "30_ablage/Zutaten.md");
  await toastMit(page, "Verschoben").locator("a").click();
  await expect(toastMit(page, "Verschieben rückgängig gemacht")).toBeVisible();
  expect(existsSync(join(vault, "20_projekte/Zutaten.md"))).toBe(true);
  await expect(page.locator("#pfad")).toHaveAttribute("title", "20_projekte/Zutaten.md");
});

test("Ziehen und Ablegen: Notizkarte auf einen Ordner; ein Ordner auf einen Ordner; nicht in sich selbst", async ({ page }) => {
  await oeffne(page);
  await klappeAuf(page, "20_projekte");
  const ziel = zeile(page, "30_ablage");
  await karte(page, "20_projekte/Zutaten.md").dragTo(ziel);
  await expect(toastMit(page, "Verschoben")).toBeVisible();
  expect(existsSync(join(vault, "30_ablage/Zutaten.md"))).toBe(true);
  // Ordner auf Ordner
  await zeile(page, "20_projekte/Rezepte").dragTo(zeile(page, "30_ablage"));
  await page.locator('[data-dialog="dateiaktion"] [data-aktion="bestaetigen"]').click(); // der Markdown-Link auf den Plan wird angepasst
  await expect(toastMit(page, "Verschoben").nth(1)).toBeVisible();
  expect(existsSync(join(vault, "30_ablage/Rezepte/Kuchen.md"))).toBe(true);
  expect(lies("30_ablage/Rezepte/Kuchen.md")).toContain("[Plan](../../20_projekte/Plan.md)");
  // nicht in sich selbst
  await klappeAuf(page, "30_ablage");
  await zeile(page, "30_ablage").dragTo(zeile(page, "30_ablage/Rezepte"));
  await expect(page.locator("#toast-host .toast.fehler")).toHaveCount(0);
  expect(existsSync(join(vault, "30_ablage/Rezepte/Kuchen.md"))).toBe(true);
});

test("In den Papierkorb: Rückfrage mit den Verlinkenden, ⌘⌫ auf der Karte, Hinweis mit Rückgängig; Verweise bleiben als offene Links", async ({ page }) => {
  await oeffne(page);
  await rechtsklick(page, karte(page, "20_projekte/Zutaten.md"));
  await menueEintrag(page, "papierkorb").click();
  const dlg = page.locator('[data-dialog="dateiaktion"]');
  await expect(dlg).toContainText("wird von 2 Notizen verlinkt");
  await expect(dlg.locator(".da-vz")).toHaveCount(2);
  await bild(page, "loeschen");
  await dlg.locator('[data-aktion="bestaetigen"]').click();
  await expect(toastMit(page, "In den Papierkorb gelegt")).toBeVisible();
  await expect(karte(page, "20_projekte/Zutaten.md")).toHaveCount(0);
  expect(existsSync(join(vault, "20_projekte/Zutaten.md"))).toBe(false);
  expect(lies("20_projekte/Plan.md")).toBe("# Plan\n\nSiehe [[Zutaten]] und [[Zutaten|die Liste]].\n");
  await expect(page.locator('.eintrag[data-bereich="papierkorb"] .zahl')).toHaveText("1");
  await toastMit(page, "In den Papierkorb gelegt").locator("a").click();
  await expect(karte(page, "20_projekte/Zutaten.md")).toBeVisible();
  expect(lies("20_projekte/Zutaten.md")).toBe("# Zutaten\n\nMehl, Zucker.\n");
  // ⌘⌫ auf der Karte ohne Verweise: sofort, ohne Rückfrage
  await karte(page, "30_ablage/Einzelnes.md").click();
  await expect(page.locator("#pfad")).toHaveAttribute("title", "30_ablage/Einzelnes.md");
  await page.locator("#liste-koerper").focus();
  await page.keyboard.press("Meta+Backspace");
  await expect(toastMit(page, "In den Papierkorb gelegt").last()).toBeVisible();
  expect(existsSync(join(vault, "30_ablage/Einzelnes.md"))).toBe(false);
  await expect(page.locator("#editor")).toBeHidden();
});

test("⌘⌫ im Editor bleibt „Zeile löschen“ und legt nichts in den Papierkorb", async ({ page }) => {
  await oeffne(page, "30_ablage/Einzelnes.md");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+Backspace");
  await page.waitForTimeout(400);
  expect(existsSync(join(vault, "30_ablage/Einzelnes.md"))).toBe(true);
  await expect(page.locator("#toast-host .toast")).toHaveCount(0);
});

test("Papierkorb-Ansicht: Wiederherstellen, Endgültig löschen mit Rückfrage, Papierkorb leeren", async ({ page }) => {
  await oeffne(page);
  await klappeAuf(page, "20_projekte");
  for (const p of ["30_ablage/Einzelnes.md", "20_projekte/Rezepte"]) {
    const l = p.endsWith(".md") ? karte(page, p) : zeile(page, p);
    await rechtsklick(page, l);
    await menueEintrag(page, "papierkorb").click();
    if (!p.endsWith(".md")) await page.locator('[data-dialog="dateiaktion"] [data-aktion="bestaetigen"]').click(); // Ordner: immer mit Rückfrage
    await expect(toastMit(page, "In den Papierkorb gelegt").last()).toBeVisible();
  }
  await page.locator('.eintrag[data-bereich="papierkorb"]').click();
  await expect(page.locator("#liste-titel")).toContainText("Papierkorb");
  await expect(page.locator("[data-korb]")).toHaveCount(2);
  await expect(page.locator("[data-korb]").first()).toContainText("gelöscht");
  await bild(page, "papierkorb");
  await page.locator('[data-korb] [data-aktion="wiederherstellen"]').first().click();
  await expect(page.locator("[data-korb]")).toHaveCount(1);
  expect(existsSync(join(vault, "20_projekte/Rezepte/Kuchen.md")) || existsSync(join(vault, "30_ablage/Einzelnes.md"))).toBe(true);
  await page.locator('[data-korb] [data-aktion="endgueltig"]').click();
  await page.locator('[data-aktion="endgueltig-bestaetigen"]').click();
  await expect(page.locator('[data-leer="papierkorb"]')).toBeVisible();
  await expect(page.locator('.eintrag[data-bereich="papierkorb"] .zahl')).toHaveCount(0);
});

test("Fehler beim Ausführen: die Oberfläche rollt zurück (Liste, Titel) und meldet es; die Datei bleibt unverändert", async ({ page }) => {
  await oeffne(page);
  await page.route("**/api/notiz/umbenennen", async (route) => {
    const k = route.request().postDataJSON();
    if (k.vorschau) return route.continue();
    return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ fehler: "Kaputt" }) });
  });
  await rechtsklick(page, karte(page, "30_ablage/Einzelnes.md"));
  await menueEintrag(page, "umbenennen").click();
  await page.locator(".inline-name").fill("Zukunft");
  await page.keyboard.press("Enter");
  await expect(page.locator("#toast-host .toast.fehler")).toContainText("Kaputt");
  await expect(karte(page, "30_ablage/Einzelnes.md").locator(".karte-titel")).toHaveText("Einzelnes");
  expect(lies("30_ablage/Einzelnes.md")).toBe("# Einzelnes\n\nNichts verlinkt hierher.\n");
});

test("Änderungen von außen: eine im Finder verschobene Notiz erscheint live am neuen Ort", async ({ page }) => {
  await oeffne(page);
  mkdirSync(join(vault, "30_ablage"), { recursive: true });
  renameSync(join(vault, "30_ablage/Einzelnes.md"), join(vault, "20_projekte/Einzelnes.md"));
  await expect(karte(page, "20_projekte/Einzelnes.md")).toBeVisible({ timeout: 15000 });
  await expect(karte(page, "30_ablage/Einzelnes.md")).toHaveCount(0);
});

test("Geschützte Dinge bieten keine Aktionen an: generierte Dateien und feste Ordner", async ({ page }) => {
  await oeffne(page);
  await expect(zeile(page, "09_wiki")).toBeVisible();
  await rechtsklick(page, zeile(page, "09_wiki"));
  await expect(page.locator(".menue.offen .m-eintrag")).toHaveText([/Öffnen/]);
  await expect(page.locator(".menue.offen .m-leer")).toContainText("gehört fest zu Kortex");
});

test("Umbenennen aus einem anderen Fenster (oder von einer KI): die offene Notiz folgt live", async ({ page }) => {
  await oeffne(page, "30_ablage/Einzelnes.md");
  const r = await page.request.post(server.url + "api/notiz/verschieben", { data: { pfad: "30_ablage/Einzelnes.md", ziel: "20_projekte" } });
  expect(r.ok()).toBe(true);
  await expect(page.locator("#pfad")).toHaveAttribute("title", "20_projekte/Einzelnes.md", { timeout: 15000 });
});

test("⌘⌫ ohne sichtbar fokussierte Notiz (Fokus im Nichts, Kopfzeile) legt nichts in den Papierkorb", async ({ page }) => {
  await oeffne(page, "30_ablage/Einzelnes.md");
  await page.locator("#kopf-suche").focus();
  await page.keyboard.press("Meta+Backspace");
  await page.locator("body").evaluate((b) => { document.activeElement?.blur(); b.focus?.(); });
  await page.keyboard.press("Meta+Backspace");
  await page.waitForTimeout(500);
  expect(existsSync(join(vault, "30_ablage/Einzelnes.md"))).toBe(true);
  await expect(page.locator("#toast-host .toast")).toHaveCount(0);
});
