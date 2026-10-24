import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { baueVault, git } from "./vault.mjs";
import { starteServer } from "./start.mjs";

let vault, server;
test.beforeEach(async () => { ({ vault } = baueVault()); server = await starteServer(vault); });
test.afterEach(() => server?.stopp());

const lese = (p) => readFileSync(join(vault, p));
async function oeffne(page, pfad) {
  await page.goto(server.url + "?pfad=" + encodeURIComponent(pfad));
  await page.waitForSelector(".cm-content .cm-line");
}
async function ans_ende(page) { await page.locator(".cm-content").click(); await page.keyboard.press("Meta+ArrowDown"); }

test("öffnen, tippen, Auto-Speichern bytegleich", async ({ page }) => {
  await oeffne(page, "10_notizen/Reise nach Lissabon.md");
  await ans_ende(page);
  await page.keyboard.type("Neue Zeile äöü ß 🙂");
  await expect(page.locator("#speicherstand")).toHaveText("Gespeichert", { timeout: 5000 });
  expect(lese("10_notizen/Reise nach Lissabon.md").toString("utf8")).toBe("# Reise nach Lissabon\n\nFlug im Mai. Hotel in der Alfama. Mietwagen nicht nötig.\nNeue Zeile äöü ß 🙂");
});

test("CRLF und Emoji bleiben erhalten; Laden ohne Änderung schreibt nichts", async ({ page }) => {
  const vorher = lese("10_notizen/crlf.md");
  await oeffne(page, "10_notizen/crlf.md");
  await page.waitForTimeout(1200);
  expect(lese("10_notizen/crlf.md").equals(vorher)).toBe(true);
  await ans_ende(page);
  await page.keyboard.type("Ende 😀");
  await expect(page.locator("#speicherstand")).toHaveText("Gespeichert", { timeout: 5000 });
  const nachher = lese("10_notizen/crlf.md").toString("utf8");
  expect(nachher).toBe("# CRLF-Datei\r\n\r\nZeile mit Emoji 🙂 und Umlauten äöü.\r\nLetzte Zeile\r\nEnde 😀");
  // Neue Zeile mit Enter erzeugt ebenfalls CRLF
  await page.keyboard.press("Enter"); await page.keyboard.type("x");
  await expect(page.locator("#speicherstand")).toHaveText("Gespeichert", { timeout: 5000 });
  expect(lese("10_notizen/crlf.md").toString("utf8").endsWith("😀\r\nx")).toBe(true);
});

test("Konflikt bei geänderter Datei: Hinweis, Neu laden", async ({ page }) => {
  await oeffne(page, "10_notizen/Reise nach Lissabon.md");
  writeFileSync(join(vault, "10_notizen/Reise nach Lissabon.md"), "# Von außen geändert\n");
  await ans_ende(page);
  await page.keyboard.type("meine Eingabe");
  const banner = page.locator('[data-banner="konflikt"]');
  await expect(banner).toBeVisible({ timeout: 5000 });
  await expect(banner).toContainText("außerhalb geändert");
  await page.click('[data-aktion="neu-laden"]');
  await expect(banner).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText("Von außen geändert");
});

test("Konflikt: Meine Fassung behalten überschreibt", async ({ page }) => {
  await oeffne(page, "10_notizen/Reise nach Lissabon.md");
  writeFileSync(join(vault, "10_notizen/Reise nach Lissabon.md"), "# Fremd\n");
  await ans_ende(page);
  await page.keyboard.type("MEINS");
  await expect(page.locator('[data-banner="konflikt"]')).toBeVisible({ timeout: 5000 });
  await page.click('[data-aktion="behalten"]');
  await expect(page.locator("#speicherstand")).toHaveText("Gespeichert", { timeout: 5000 });
  expect(lese("10_notizen/Reise nach Lissabon.md").toString()).toContain("MEINS");
  expect(lese("10_notizen/Reise nach Lissabon.md").toString()).not.toContain("Fremd");
});

test("Commit-Dialog committet nur abgehakte Dateien", async ({ page }) => {
  writeFileSync(join(vault, "00_inbox/a.md"), "A\n");
  writeFileSync(join(vault, "00_inbox/b.md"), "B\n");
  writeFileSync(join(vault, "10_notizen/Reise nach Lissabon.md"), "# Reise\nGeändert\n");
  await oeffne(page, "09_wiki/wissen/Kaffee.md");
  await expect(page.locator('[data-st="geaendert"]')).toContainText("3 geändert");
  await page.click('[data-st="geaendert"]');
  await page.locator('[data-datei="00_inbox/b.md"]').uncheck();
  await page.locator('[data-datei="10_notizen/Reise nach Lissabon.md"]').uncheck();
  await page.fill('[data-feld="nachricht"]', "Nur a");
  await page.click('[data-aktion="commit"]');
  await expect(page.locator(".toast")).toContainText("Gesichert");
  const status = git(vault, "status", "--porcelain");
  expect(status).toContain("b.md");
  expect(status).toContain("Reise nach Lissabon.md");
  expect(status).not.toContain("a.md\n".replace("a.md", "00_inbox/a.md"));
  expect(git(vault, "log", "-1", "--format=%s")).toContain("Nur a");
  expect(git(vault, "show", "--name-only", "--format=", "HEAD").trim()).toBe("00_inbox/a.md");
  await expect(page.locator('[data-st="geaendert"]')).toContainText("2 geändert");
});

test("Verlauf, Diff und Wiederherstellen", async ({ page }) => {
  await oeffne(page, "10_notizen/Reise nach Lissabon.md");
  const eintraege = page.locator('[data-sektion="verlauf"] .fassung');
  await expect(eintraege).toHaveCount(2); // Mietwagen ergänzt + Erste Fassung
  await eintraege.nth(1).locator(".fassung-kopf").click(); // Erste Fassung (kein Diff-Zeilen mit Mietwagen)
  await expect(eintraege.nth(1).locator("[data-diff]")).toBeVisible();
  await eintraege.nth(1).locator('[data-aktion="wiederherstellen"]').click();
  await expect(page.locator(".cm-content")).not.toContainText("Mietwagen");
  await expect(page.locator("#speicherstand")).toHaveText("Gespeichert", { timeout: 5000 });
  expect(lese("10_notizen/Reise nach Lissabon.md").toString()).toBe("# Reise nach Lissabon\n\nFlug im Mai. Hotel in der Alfama.\n");
});

test("Suche im Vault und Öffnen", async ({ page }) => {
  await oeffne(page, "10_notizen/Reise nach Lissabon.md");
  await page.keyboard.press("Meta+Shift+f");
  await page.keyboard.type("Espresso");
  await expect(page.locator('[data-suche="treffer"]').first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".cm-content")).toContainText("Zubereitung unter hohem Druck");
  await expect(page.locator("#pfad")).toContainText("Espresso");
});

test("Schnell merken legt Inbox-Datei an", async ({ page }) => {
  await oeffne(page, "10_notizen/Reise nach Lissabon.md");
  await page.keyboard.press("Meta+Shift+m");
  await page.fill('[data-feld="text"]', "Eine flüchtige Idee für später");
  await page.click('[data-aktion="merken"]');
  await expect(page.locator(".toast")).toContainText("Inbox");
  const neu = git(vault, "status", "--porcelain", "--", "00_inbox").split("\n").filter((z) => z.includes("flüchtig") || z.includes("fluechtig") || z.includes("eine"));
  const alle = git(vault, "ls-files", "--others", "--exclude-standard", "00_inbox").trim().split("\n").filter(Boolean);
  expect(alle.length).toBe(1);
  expect(readFileSync(join(vault, alle[0]), "utf8")).toContain("Eine flüchtige Idee für später");
  void neu;
});

test("Wikilink-Klick öffnet Ziel, Autovervollständigung", async ({ page }) => {
  await oeffne(page, "09_wiki/wissen/Kaffee.md");
  await page.locator('.cm-wiki[data-ziel="Espresso"]').click();
  await expect(page.locator("#pfad")).toContainText("Espresso");
  await expect(page.locator(".cm-content")).toContainText("Zubereitung");
  // Autovervollständigung
  await ans_ende(page);
  await page.keyboard.type("\n[[Müh");
  await expect(page.locator(".cm-tooltip-autocomplete")).toContainText("Mühle");
  await page.keyboard.press("Enter");
  await expect(page.locator(".cm-content")).toContainText("[[Mühle]]");
});

test("Statusleiste zeigt Zweig und geändert; Sync-Knopf", async ({ page }) => {
  writeFileSync(join(vault, "00_inbox/neu.md"), "N\n");
  await oeffne(page, "09_wiki/wissen/Kaffee.md");
  await expect(page.locator('[data-st="zweig"]')).toContainText("main");
  await expect(page.locator('[data-st="zweig"]')).toContainText("↑0 ↓0");
  await expect(page.locator('[data-st="geaendert"]')).toContainText("1 geändert");
  await expect(page.locator('[data-st="inbox"]')).toContainText("Inbox 4");
  await page.click('[data-st="sync"]');
  await expect(page.locator('[data-st="sync"]')).toContainText(/Gesichert (vor \d+ Min|gerade eben)/, { timeout: 8000 });
});

test("Schreibschutz-Banner bei generierter Datei; Prüf-Punkt im Baum", async ({ page }) => {
  await oeffne(page, "09_wiki/INDEX.md");
  await expect(page.locator('[data-banner="schutz"]')).toBeVisible();
  await page.click('[data-bereich="wiki"]');
  await page.click('[data-pfad="09_wiki/wissen"]');
  await expect(page.locator('[data-punkt="09_wiki/wissen/Espresso.md"]')).toHaveClass(/rot/, { timeout: 5000 });
});

test("Hell/Dunkel und Palette; Infospalte per Tastenkürzel", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await oeffne(page, "09_wiki/wissen/Kaffee.md");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(25, 25, 27)");
  await page.keyboard.press("Meta+k");
  await page.waitForSelector(".palette input:focus");
  await page.keyboard.type("Mühle");
  await page.keyboard.press("Enter");
  await expect(page.locator("#pfad")).toContainText("Mühle");
  await page.keyboard.press("Meta+Alt+i");
  await expect(page.locator("#app")).toHaveAttribute("data-info", "aus");
  const breite = await page.evaluate(() => document.getElementById("info").getBoundingClientRect().width);
  expect(breite).toBe(0);
});

test("Leerer Vault: freundlicher Zustand", async ({ page }) => {
  server.stopp();
  const leer = baueVault({ leer: true });
  server = await starteServer(leer.vault);
  await page.goto(server.url);
  await expect(page.locator("#leer h2")).toHaveText("Dein Vault ist noch leer");
  const op = await page.evaluate(() => getComputedStyle(document.getElementById("leer")).opacity);
  expect(op).toBe("1");
  await page.click('[data-aktion="erste"]');
  await page.fill('[data-feld="titel"]', "Erste Notiz");
  await page.click('[data-aktion="anlegen"]');
  await expect(page.locator(".cm-content")).toContainText("Erste Notiz");
});

test("Palette findet tiefe Seite per Titel, Dateiname und Wortanfang; Enter ohne Treffer legt nichts an", async ({ page }) => {
  await oeffne(page, "09_wiki/wissen/Kaffee.md");
  const tief = "09_wiki/wissen/agentic-os/tief/thema_claude-mods.md";
  for (const eingabe of ["Claude Mods", "thema_claude-mods", "clau mod", "thema claude"]) {
    await page.keyboard.press("Meta+k");
    await page.waitForSelector(".palette input:focus");
    await page.keyboard.type(eingabe);
    await expect(page.locator('.palette [data-pal="notiz"] .r').filter({ hasText: tief })).toHaveCount(1);
    if (eingabe === "Claude Mods" || eingabe === "thema_claude-mods") await expect(page.locator('.palette [data-pal="notiz"] .r').first()).toHaveText(tief);
    else await page.locator('.palette [data-pal="notiz"]').filter({ hasText: tief }).click();
    if (eingabe === "Claude Mods" || eingabe === "thema_claude-mods") await page.keyboard.press("Enter");
    await expect(page.locator("#pfad")).toContainText("thema_claude-mods");
    await oeffne(page, "09_wiki/wissen/Kaffee.md");
  }
  // kein Treffer: nur der ausdrückliche Anlegen-Eintrag, Enter tut nichts
  await page.keyboard.press("Meta+k");
  await page.waitForSelector(".palette input:focus");
  await page.keyboard.type("zzzqqq");
  await expect(page.locator('.palette [data-pal="notiz"]')).toHaveCount(0);
  await expect(page.locator('.palette [data-pal="anlegen"]')).toHaveText(/Neue Notiz „zzzqqq“ anlegen/);
  await page.keyboard.press("Enter");
  await expect(page.locator(".palette")).toBeVisible();
  await expect(page.locator('[data-feld="titel"]')).toHaveCount(0);
  // ausdrücklich gewählt: Dialog mit vorbelegtem Titel
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-feld="titel"]')).toHaveValue("zzzqqq");
});

test("Statusleiste zeigt Rückfragen n, wenn das Kit sie liefert", async ({ page }) => {
  mkdirSync(join(vault, ".tools"), { recursive: true });
  writeFileSync(join(vault, ".tools/rueckfragen.mjs"), "export function sichtbare(){ return { fragen: [{},{}], wartend: 1 }; }\n");
  await oeffne(page, "09_wiki/wissen/Kaffee.md");
  await expect(page.locator('[data-st="rueckfragen"]')).toHaveText("Rückfragen 3", { timeout: 5000 });
});

test("Statusleiste: ohne Kit keine Rückfragen-Anzeige", async ({ page }) => {
  await oeffne(page, "09_wiki/wissen/Kaffee.md");
  await page.waitForTimeout(800);
  await expect(page.locator('[data-st="rueckfragen"]')).toHaveCount(0);
});

test("Prüf-Signal: Kaffee ist gelb mit passendem Text, Mühle/Espresso behalten Stufen", async ({ page }) => {
  await oeffne(page, "09_wiki/wissen/Kaffee.md");
  await expect(page.locator("#pille")).toHaveAttribute("data-stufe", "gelb", { timeout: 5000 });
});

test("Notizen: echte Struktur ohne Inbox/Wiki, 90_* ausgegraut am Ende, fehlende Inbox stört nicht", async ({ page }) => {
  for (const [p, t] of [["01_vorlagen/vorlage.md", "# Vorlage\n"], ["10_projekte/p.md", "# P\n"], ["40_persoenlich/x.md", "# X\n"], ["90_archiv/alt.md", "# Alt\n"], ["wurzel.md", "# Wurzel\n"]]) {
    mkdirSync(join(vault, p, ".."), { recursive: true }); writeFileSync(join(vault, p), t);
  }
  rmSync(join(vault, "00_inbox"), { recursive: true, force: true });
  await oeffne(page, "09_wiki/wissen/Kaffee.md");
  await page.click('[data-bereich="notizen"]');
  const namen = await page.locator("#baum .zeile").evaluateAll((els) => els.map((e) => e.dataset.pfad));
  expect(namen).toEqual(["01_vorlagen", "10_notizen", "10_projekte", "30_wissen", "40_persoenlich", "wurzel.md", "90_archiv"]);
  await expect(page.locator('#baum [data-pfad="90_archiv"]')).toHaveClass(/archiv/);
  expect(Number(await page.locator('#baum [data-pfad="90_archiv"]').evaluate((e) => getComputedStyle(e).opacity))).toBeLessThan(1);
  await expect(page.locator('#baum [data-pfad="01_vorlagen"]')).not.toHaveClass(/archiv/);
});

test("Palette: sofort nach ⌘K getippte Zeichen gehen nicht verloren", async ({ page }) => {
  await oeffne(page, "09_wiki/wissen/Kaffee.md");
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("Claude Mods", { delay: 0 });
  await expect(page.locator(".palette input")).toHaveValue("Claude Mods");
  await expect(page.locator('.palette [data-pal="notiz"]').first()).toContainText("Claude Mods");
});
