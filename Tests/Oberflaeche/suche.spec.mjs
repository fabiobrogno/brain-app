// Volltext-Suche mit Index: Ansicht „Im Vault suchen“ (⇧⌘F) mit Markierung, Fundstellen, Filterchips und Seiten; ⌘K mit „Im Inhalt“; Sprung an die Fundstelle.
// Gegen das echte Backend mit Wegwerf-Vault (der Index baut sich beim ersten Suchen auf). Fotos: STUDIO_FOTOS=<Ordner> (hell und dunkel).
import { test, expect } from "./basis.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";

const FOTOS = process.env.STUDIO_FOTOS || "";
let vault, server;
test.beforeEach(async () => {
  ({ vault } = baueVault());
  // 45 Notizen mit dem Wort „Seitentest“ für die Seiten (30 + Rest) und ein paar Typen/Tags für die Chips
  mkdirSync(join(vault, "20_seiten"), { recursive: true });
  for (let i = 0; i < 45; i++) writeFileSync(join(vault, "20_seiten", `seite-${String(i).padStart(2, "0")}.md`), `# Seite ${i}\n\nDies ist der Seitentest mit Nummer ${i}. ${i % 3 === 0 ? "Zusatz: Projektplan." : ""}\n`);
  writeFileSync(join(vault, "20_seiten", "projekt-alpha.md"), "---\ntyp: projekt\nstatus: aktiv\ntags: [planung]\n---\n# Projekt Alpha\n\nDer Seitentest läuft im Projekt Alpha. Fakt-Zeile: Budget steht.\n");
  server = await starteServer(vault);
});
test.afterEach(() => server?.stopp());

async function start(page) {
  await page.goto(server.url);
  await page.waitForSelector("[data-karte], [data-leer]", { timeout: 10000 });
}
async function foto(page, name) {
  if (!FOTOS) return;
  mkdirSync(FOTOS, { recursive: true });
  await page.screenshot({ path: join(FOTOS, name + ".png") });
}
const suchfeld = (page) => page.locator("#suche");
async function oeffneSuche(page) {
  await page.keyboard.press("Meta+Shift+f");
  await expect(suchfeld(page)).toBeFocused();
}

test("Suche im Vault: Treffer mit Markierung, Zahl, Fundstelle und Sprung in die Notiz", async ({ page }) => {
  await start(page);
  await oeffneSuche(page);
  await page.keyboard.type("Zubereitung Druck");
  const karte = page.locator('[data-suche="treffer"][data-pfad="09_wiki/wissen/Espresso.md"]');
  await expect(karte).toBeVisible();
  await expect(karte.locator("mark.treffer").first()).toBeVisible();
  const marken = await karte.locator("mark.treffer").allTextContents();
  expect(marken.map((m) => m.toLowerCase())).toEqual(expect.arrayContaining(["zubereitung", "druck"]));
  await expect(page.locator('[data-suche="zahl"]')).toContainText("Treffer");
  await foto(page, "suche-ansicht-markierung");
  // Klick auf die Fundstelle: Notiz öffnet, die Stelle ist markiert und der Cursor steht dort
  await karte.locator('[data-suche="stelle"]').first().click();
  await expect(page.locator("#pfad")).toContainText("Espresso");
  await expect(page.locator(".cm-fundstelle-jetzt").first()).toBeVisible();
  await expect(page.locator(".cm-fundstelle-jetzt").first()).toHaveText(/zubereitung/i);
  await foto(page, "suche-editor-fundstelle");
  // Tippen löscht die Markierung (sie gehört zu diesem Öffnen)
  await page.locator(".cm-content").press("End");
  await page.keyboard.type(" x");
  await expect(page.locator(".cm-fundstelle")).toHaveCount(0);
});

test("Suche: Tippfehler, Umlaute, Phrase und Ausschluss", async ({ page }) => {
  await start(page);
  await oeffneSuche(page);
  await page.keyboard.type("kafee");
  await expect(page.locator('[data-suche="treffer"][data-pfad="09_wiki/wissen/Kaffee.md"]')).toBeVisible();
  await suchfeld(page).fill("muehle");
  await expect(page.locator('[data-suche="treffer"][data-pfad="09_wiki/wissen/Mühle.md"]')).toBeVisible();
  await suchfeld(page).fill('"Fakt-Zeile"');
  await expect(page.locator('[data-suche="treffer"]')).toHaveCount(1);
  await expect(page.locator('[data-suche="treffer"]').first()).toHaveAttribute("data-pfad", "20_seiten/projekt-alpha.md");
  await suchfeld(page).fill('"Zeile Fakt"'); // falsche Reihenfolge: keine Phrase
  await expect(page.locator('[data-suche="leer"]')).toBeVisible();
  await suchfeld(page).fill("Seitentest -alpha");
  await expect(page.locator('[data-suche="treffer"][data-pfad="20_seiten/projekt-alpha.md"]')).toHaveCount(0);
  await expect(page.locator('[data-suche="treffer"]').first()).toBeVisible();
});

test("Suche: Seiten – 30 sichtbar, „Mehr laden“ hängt den Rest an, Zahl stimmt", async ({ page }) => {
  await start(page);
  await oeffneSuche(page);
  await page.keyboard.type("Seitentest");
  await expect(page.locator('[data-suche="treffer"]')).toHaveCount(30);
  await expect(page.locator('[data-suche="zahl"]')).toHaveText("30 von 46 Treffern");
  await foto(page, "suche-seiten");
  await page.locator('[data-aktion="such-mehr"]').click();
  await expect(page.locator('[data-suche="treffer"]')).toHaveCount(46);
  await expect(page.locator('[data-suche="zahl"]')).toHaveText("46 Treffer");
  await expect(page.locator('[data-aktion="such-mehr"]')).toHaveCount(0);
});

test("Suche: Filterchips (Typ, Ordner, Geändert) schreiben ihren Filter ins Feld und engen ein; Filter im Text gehen auch", async ({ page }) => {
  await start(page);
  await oeffneSuche(page);
  await page.keyboard.type("Seitentest");
  await expect(page.locator('[data-suche="treffer"]')).toHaveCount(30);
  await page.locator('button[data-such-chip="typ"]').click();
  await page.locator('.bs-opt[data-wert="projekt"]').click();
  await expect(suchfeld(page)).toHaveValue(/typ:projekt/);
  await expect(page.locator('[data-suche="treffer"]')).toHaveCount(1);
  await expect(page.locator('button[data-such-chip="typ"]').locator("..")).toHaveAttribute("data-aktiv", "true");
  await foto(page, "suche-chips");
  // Chip zurücksetzen (✕) entfernt den Filter wieder
  await page.locator('button[data-such-chip="typ"]').locator("..").locator(".bs-chip-x").click();
  await expect(suchfeld(page)).not.toHaveValue(/typ:/);
  await expect(page.locator('[data-suche="treffer"]')).toHaveCount(30);
  // Ordner, Tag, Status im Text
  await suchfeld(page).fill("ordner:20_seiten tag:planung");
  await expect(page.locator('[data-suche="treffer"]')).toHaveCount(1);
  await suchfeld(page).fill("status:aktiv geaendert:<7d");
  await expect(page.locator('[data-suche="treffer"]')).toHaveCount(1);
  await suchfeld(page).fill("Seitentest geaendert:>30d");
  await expect(page.locator('[data-suche="leer"]')).toBeVisible();
});

test("⌘K: Titel zuerst, darunter „Im Inhalt“ mit Markierung, Enter springt an die Fundstelle; „Frag deinen Vault“ bleibt", async ({ page }) => {
  await start(page);
  await page.keyboard.press("Meta+k");
  await page.waitForSelector(".palette input:focus");
  await page.keyboard.type("hohem Druck");
  const inhalt = page.locator('.palette [data-pal="inhalt"]');
  await expect(inhalt.first()).toBeVisible();
  await expect(page.locator('.palette [data-pal-gruppe="inhalt"]')).toHaveText("Im Inhalt");
  await expect(inhalt.first().locator("mark.treffer").first()).toBeVisible();
  await expect(page.locator('.palette [data-pal="frage"]')).toBeVisible(); // Ausweg bleibt, unterhalb der Inhalts-Treffer
  const reihenfolge = await page.locator(".palette .pal-eintrag").evaluateAll((els) => els.map((e) => e.dataset.pal));
  expect(reihenfolge.indexOf("inhalt")).toBeLessThan(reihenfolge.indexOf("frage"));
  await foto(page, "palette-im-inhalt");
  await page.keyboard.press("Enter");
  await expect(page.locator("#pfad")).toContainText("Espresso");
  await expect(page.locator(".cm-fundstelle-jetzt").first()).toBeVisible();
});

test("⌘K: Titel-Treffer erscheinen sofort, Inhalts-Treffer ohne die schon gezeigten Titel; überholte Anfragen ändern nichts", async ({ page }) => {
  await start(page);
  await page.keyboard.press("Meta+k");
  await page.waitForSelector(".palette input:focus");
  await page.keyboard.type("Kaffee");
  await expect(page.locator('.palette [data-pal="notiz"]').first()).toBeVisible();
  const titelPfade = await page.locator('.palette [data-pal="notiz"] .r').allTextContents();
  await expect.poll(async () => page.locator('.palette [data-pal="inhalt"]').count()).toBeGreaterThan(0);
  const inhaltPfade = await page.locator('.palette [data-pal="inhalt"] .r').allTextContents();
  for (const p of inhaltPfade) expect(titelPfade).not.toContain(p);
  // schnell weitertippen: am Ende gilt nur die letzte Frage
  await page.locator(".palette input").fill("");
  await page.keyboard.type("Seitentest", { delay: 5 });
  await expect(page.locator('.palette [data-pal="inhalt"]').first()).toBeVisible();
  await expect.poll(async () => (await page.locator('.palette [data-pal="inhalt"] .pal-auszug').allTextContents()).every((t) => t.toLowerCase().includes("seitentest"))).toBe(true);
  expect(await page.locator('.palette [data-pal="inhalt"]').count()).toBeGreaterThan(0);
});

test("Hell und dunkel: Markierung bleibt lesbar", async ({ page }) => {
  await start(page);
  for (const farbe of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: farbe });
    await oeffneSuche(page);
    await suchfeld(page).fill("Kaffee");
    await expect(page.locator('[data-suche="treffer"] mark.treffer').first()).toBeVisible();
    await foto(page, `suche-${farbe}`);
    await page.keyboard.press("Escape");
  }
});
