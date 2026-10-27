// Studio v2 nach dem Zusammenbau: Bereiche ohne Maschinen-/Vorlagen-/Systemdateien, Eigenschaften-Spalte bei schmalem Fenster, „Verweist auf“.
import { test, expect } from "./basis.mjs";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { mockeV2, baueIndex } from "./mocks.mjs";

let vault, server;
test.beforeEach(async () => { ({ vault } = baueVault()); server = await starteServer(vault); });
test.afterEach(() => server?.stopp());

async function start(page, pfad, opt = {}) {
  await mockeV2(page, vault, { erzwingen: true, ...opt });
  await page.goto(server.url + (pfad ? "?pfad=" + encodeURIComponent(pfad) : ""));
  await page.waitForSelector("[data-karte], [data-leer]", { timeout: 10000 });
}
const karten = (page) => page.locator("#liste-koerper [data-karte]");
// Größe setzen und das resize-Ereignis abwarten (schnell hintereinander würde der Browser sie zusammenfassen)
async function groesse(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
}
const zusatz = (pfad, bereich, typ = "thema") => ({ pfad, titel: pfad, vorschau: "", typ, bereich, geaendert: new Date().toISOString(), erstellt: null, stufe: null, links: [], felder: {}, generiert: false, ansichten: ["zuletzt"] });

test("Alle Notizen, Typen und Ansichten ohne Maschinen-Ordner, Vorlagen und Agenten-Anweisungen", async ({ page }) => {
  const basis = baueIndex(vault);
  const sichtbar = basis.filter((n) => ["inbox", "notiz", "wissen"].includes(n.bereich) && !n.generiert);
  const notizen = [...basis, zusatz("00_inbox/_rueckfragen/rf-1.md", "maschine"), zusatz("01_vorlagen/thema.md", "vorlage"), zusatz("CLAUDE.md", "system")];
  await start(page, undefined, { ueberschreibe: { notizen } });
  await expect(page.locator('[data-bereich="alle"] .zahl')).toHaveText(String(sichtbar.length));
  await page.click('[data-bereich="alle"]');
  await expect(karten(page)).toHaveCount(sichtbar.length);
  for (const p of ["00_inbox/_rueckfragen/rf-1.md", "01_vorlagen/thema.md", "CLAUDE.md"]) await expect(page.locator(`#liste-koerper [data-pfad="${p}"]`)).toHaveCount(0);
  // Typ-Liste zeigt nur echte Notizen dieses Typs
  await page.click('[data-typ="thema"]');
  const themen = sichtbar.filter((n) => n.typ === "thema").length;
  await expect(karten(page)).toHaveCount(themen);
  // Ansicht „Zuletzt geändert“ zählt die Zusatzdateien nicht mit
  await expect(page.locator('[data-ansicht="zuletzt"] .zahl')).toHaveText("0");
});

test("Eigenschaften-Spalte klappt bei schmalem Fenster ein, ein Klick holt sie, breit kommt sie zurück", async ({ page }) => {
  const erste = baueIndex(vault).find((n) => n.bereich === "wissen" && !n.generiert).pfad;
  await start(page, erste);
  const app = page.locator("#app");
  await expect(app).toHaveAttribute("data-info", "an");
  await groesse(page, 1180, 800);
  await expect(app).toHaveAttribute("data-info", "aus");
  await expect(page.locator("#knopf-info")).toHaveAttribute("aria-pressed", "false");
  // Editor behält Platz
  const breite = await page.locator("#editor").evaluate((e) => e.getBoundingClientRect().width);
  expect(breite).toBeGreaterThanOrEqual(420);
  // Klick holt sie trotz Enge
  await page.click("#knopf-info");
  await expect(app).toHaveAttribute("data-info", "an");
  // Wieder breit: sie bleibt, schmal ohne Klick: wieder zu
  await groesse(page, 1440, 900);
  await expect(app).toHaveAttribute("data-info", "an");
  await groesse(page, 1180, 800);
  await expect(app).toHaveAttribute("data-info", "aus");
  // Ausgeschaltet bleibt ausgeschaltet, auch wenn das Fenster wieder breit wird
  await groesse(page, 1440, 900);
  await page.click("#knopf-info");
  await expect(app).toHaveAttribute("data-info", "aus");
  await groesse(page, 1180, 800);
  await groesse(page, 1440, 900);
  await expect(app).toHaveAttribute("data-info", "aus");
  // Gezogene Breiten gehen beim Schrumpfen nicht verloren
  await page.click("#knopf-info");
  const vorher = await page.locator("#liste").evaluate((e) => e.getBoundingClientRect().width);
  await groesse(page, 1180, 800);
  await groesse(page, 1440, 900);
  expect(await page.locator("#liste").evaluate((e) => e.getBoundingClientRect().width)).toBe(vorher);
});

test("Verweist auf: Links im Text, ohne Beziehungen, lange Listen gekürzt", async ({ page }) => {
  const notiz = baueIndex(vault).find((n) => !n.generiert && n.bereich !== "archiv").pfad;
  const andere = baueIndex(vault).filter((n) => n.pfad !== notiz && !n.generiert).map((n) => n.pfad);
  await mockeV2(page, vault, { erzwingen: true });
  await page.route("**/api/notiz/kontext**", (route) => route.fulfill({ json: {
    felder: { projekt: `[[${andere[0]}]]` }, beziehungen: [{ feld: "projekt", ziele: [andere[0]] }],
    verweise: [andere[0], ...andere.slice(1, 10), "Gibt es nicht"], rueckverweise: [], info: { woerter: 3, bytes: 20, geaendert: null, erstellt: null } } }));
  await page.goto(server.url + "?pfad=" + encodeURIComponent(notiz));
  const sek = page.locator('#info [data-sektion="verweise"]');
  await expect(sek).toBeVisible({ timeout: 10000 });
  const erwartet = Math.min(andere.length - 1, 9) + 1; // ohne die Beziehung, mit dem fehlenden Ziel
  const sichtbar = Math.min(8, erwartet);
  await expect(sek.locator(".ziel")).toHaveCount(sichtbar);
  if (erwartet > 8) {
    await sek.getByRole("button", { name: `Alle ${erwartet} anzeigen` }).click();
    await expect(sek.locator(".ziel")).toHaveCount(erwartet);
  }
  await expect(sek.locator(`[data-ziel="${andere[0]}"]`)).toHaveCount(0); // steht schon unter Beziehungen
  await expect(sek.locator('[data-ziel-fehlt="Gibt es nicht"]')).toHaveCount(erwartet > 8 ? 1 : 0);
});

test("Datei-Kopf klappt per Klick auf und zu", async ({ page }) => {
  await start(page, "09_wiki/wissen/Mühle.md");
  await expect(page.locator(".cm-fm-zu")).toBeVisible();
  await page.locator(".cm-fm-zu").click();
  await expect(page.locator(".cm-fm-auf")).toBeVisible();
  await expect(page.locator(".cm-line.cm-fm").first()).toBeVisible();
  await page.locator(".cm-fm-auf").click();
  await expect(page.locator(".cm-fm-zu")).toBeVisible();
  await expect(page.locator(".cm-line.cm-fm")).toHaveCount(0);
});

test("Klick unter Datei-Kopf und H1 trifft die angeklickte Zeile (keine versetzten Zeilenhöhen)", async ({ page }) => {
  await start(page, "09_wiki/wissen/Mühle.md");
  const zeile = page.locator(".cm-line", { hasText: "Kaffeemühle" });
  await expect(zeile).toBeVisible();
  const b = await zeile.boundingBox();
  await page.mouse.click(b.x + 4, b.y + b.height / 2);
  await page.keyboard.press("End");
  await page.keyboard.type("§");
  await expect(page.locator(".cm-line", { hasText: "§" })).toContainText("Kaffeemühle");
  // Home springt an den Anfang derselben Zeile, nicht in die Nachbarzeile
  await page.keyboard.press("Home");
  await page.keyboard.type("¶");
  await expect(page.locator(".cm-line", { hasText: "¶" })).toContainText("Kaffeemühle");
});
