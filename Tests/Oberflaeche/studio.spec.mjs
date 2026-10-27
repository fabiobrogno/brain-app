import { test, expect } from "./basis.mjs";
import { readFileSync, writeFileSync, mkdirSync, rmSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { baueVault, git } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { mockeV2 } from "./mocks.mjs";

let vault, server;
test.beforeEach(async () => { ({ vault } = baueVault()); server = await starteServer(vault); });
test.afterEach(() => server?.stopp());

const lese = (p) => readFileSync(join(vault, p));
const gemockt = new WeakSet();
async function mocke(page) { if (!gemockt.has(page)) { gemockt.add(page); await mockeV2(page, vault); } }
async function oeffne(page, pfad) {
  await mocke(page);
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
  // Die Liste aktualisiert sich verzögert: erst Enter, wenn sie zum getippten „Müh“ passt (die Stufe „[[“ listet alles).
  await expect(page.locator(".cm-tooltip-autocomplete")).not.toContainText("Espresso");
  await page.keyboard.press("Enter");
  await expect(page.locator(".cm-content")).toContainText("[[Mühle]]");
});

test("Statusleiste zeigt Zweig und geändert; Sync-Knopf", async ({ page }) => {
  writeFileSync(join(vault, "00_inbox/neu.md"), "N\n");
  await oeffne(page, "09_wiki/wissen/Kaffee.md");
  await expect(page.locator('[data-st="zweig"]')).toContainText("main");
  await expect(page.locator('[data-st="zweig"]')).toContainText("↑0 ↓0");
  await expect(page.locator('[data-st="geaendert"]')).toContainText("1 geändert");
  await expect(page.locator('[data-bereich="inbox"] .zahl')).toHaveText("4");
  await page.click('[data-st="sync"]');
  await expect(page.locator('[data-st="sync"]')).toContainText(/Gesichert (vor \d+ Min|gerade eben)/, { timeout: 8000 });
});

test("Schreibschutz-Banner bei generierter Datei; Prüf-Punkt an der Karte", async ({ page }) => {
  await oeffne(page, "09_wiki/INDEX.md");
  await expect(page.locator('[data-banner="schutz"]')).toBeVisible();
  await page.click('[data-bereich="wissen"]');
  await expect(page.locator('[data-punkt="09_wiki/wissen/Espresso.md"]')).toHaveClass(/rot/, { timeout: 5000 });
});

test("Hell/Dunkel und Palette; Infospalte per Tastenkürzel", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await oeffne(page, "09_wiki/wissen/Kaffee.md");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(31, 30, 27)");
  await page.keyboard.press("Meta+k");
  await page.waitForSelector(".palette input:focus");
  await page.keyboard.type("Mühle");
  await page.keyboard.press("Enter");
  await expect(page.locator("#pfad")).toContainText("Mühle");
  await page.keyboard.press("Meta+Alt+i");
  await expect(page.locator("#app")).toHaveAttribute("data-info", "aus");
  await expect.poll(() => page.evaluate(() => document.getElementById("info").getBoundingClientRect().width)).toBe(0);
});

test("Leerer Vault: freundlicher Zustand", async ({ page }) => {
  server.stopp();
  const leer = baueVault({ leer: true });
  server = await starteServer(leer.vault);
  await mockeV2(page, leer.vault);
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
    await expect(page.locator("#pfad")).toContainText("Claude Mods");
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

test("Seitenleiste zeigt Rückfragen n, wenn das Kit sie liefert", async ({ page }) => {
  mkdirSync(join(vault, ".tools"), { recursive: true });
  writeFileSync(join(vault, ".tools/rueckfragen.mjs"), "export function sichtbare(){ return { fragen: [{},{}], wartend: 1 }; }\n");
  await oeffne(page, "09_wiki/wissen/Kaffee.md");
  // Echte Werkstatt, kein Attrappen-Vertrauen: Der Vault war vertraut, dann kam Code dazu → „geändert“, die Frage erscheint,
  // erst nach „Vertrauen“ läuft das Kit (der Knopf hieß vor Vertrauen v2 kit-erlauben)
  const frage = page.locator('.dialog[data-dialog="vertrauen"]');
  await expect(frage).toBeVisible();
  await expect(frage).toContainText("Die Werkzeuge in diesem Vault haben sich seit deiner Freigabe geändert.");
  await expect(page.locator('[data-bereich="rueckfragen"]')).toHaveCount(0); // vorher läuft nichts
  await page.click('[data-aktion="vertrauen-erlauben"]');
  await expect(frage).toHaveCount(0);
  await expect(page.locator('[data-bereich="rueckfragen"] .zahl')).toHaveText("3", { timeout: 5000 });
});

test("Seitenleiste: ohne Kit keine Rückfragen-Anzeige", async ({ page }) => {
  await oeffne(page, "09_wiki/wissen/Kaffee.md");
  await page.waitForTimeout(800);
  await expect(page.locator('[data-bereich="rueckfragen"]')).toHaveCount(0);
});

test("Prüf-Signal: Kaffee ist gelb mit passendem Text, Mühle/Espresso behalten Stufen", async ({ page }) => {
  await oeffne(page, "09_wiki/wissen/Kaffee.md");
  await expect(page.locator("#pille")).toHaveAttribute("data-stufe", "gelb", { timeout: 5000 });
});

test("Ordner: echte Struktur, 90_* ausgegraut am Ende, fehlende Inbox stört nicht", async ({ page }) => {
  for (const [p, t] of [["01_vorlagen/vorlage.md", "# Vorlage\n"], ["10_projekte/p.md", "# P\n"], ["40_persoenlich/x.md", "# X\n"], ["90_archiv/alt.md", "# Alt\n"], ["wurzel.md", "# Wurzel\n"]]) {
    mkdirSync(join(vault, p, ".."), { recursive: true }); writeFileSync(join(vault, p), t);
  }
  rmSync(join(vault, "00_inbox"), { recursive: true, force: true });
  await oeffne(page, "09_wiki/wissen/Kaffee.md");
  await expect(page.locator("#baum .zeile").first()).toBeVisible();
  const namen = await page.locator("#baum .zeile").evaluateAll((els) => els.filter((e) => e.style.getPropertyValue("--tiefe") === "0").map((e) => e.dataset.pfad));
  expect(namen).toEqual(["01_vorlagen", "09_wiki", "10_notizen", "10_projekte", "30_wissen", "40_persoenlich", "90_archiv"]);
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

// ---------------------------------------------------------------- Review-Befunde
const DATEI_A = "10_notizen/Reise nach Lissabon.md";
const wechsle = (page, pfad) => page.evaluate((p) => document.querySelector(`[data-karte][data-pfad="${p}"]`)?.click(), pfad);
async function sichtbareDatei(page, pfad) { // „Alle Notizen“ zeigt jede Karte
  await expect(page.locator(`#liste-koerper [data-karte][data-pfad="${pfad}"]`)).toBeVisible();
}

for (const status of [500, 413]) {
  test(`K-1: Speichern scheitert (${status}) -> Wechsel blockiert, Dialog, Text bleibt`, async ({ page }) => {
    await oeffne(page, DATEI_A);
    await sichtbareDatei(page, "09_wiki/wissen/Kaffee.md");
    await page.route("**/api/datei", (route) => route.request().method() === "PUT"
      ? route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ fehler: "Server sagt nein" }) }) : route.fallback());
    await ans_ende(page);
    await page.keyboard.type("WICHTIGER TEXT");
    await wechsle(page, "09_wiki/wissen/Kaffee.md"); // sofort, vor dem Debounce
    await expect(page.locator('[data-dialog="speicherfehler"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#pfad")).toContainText("Reise nach Lissabon");
    await expect(page.locator(".cm-content")).toContainText("WICHTIGER TEXT");
    // Nochmal versuchen scheitert weiter -> Dialog erscheint wieder
    await page.click('[data-aktion="nochmal"]');
    await expect(page.locator('[data-dialog="speicherfehler"]')).toBeVisible();
    // Esc: bleibt in der Datei
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-dialog="speicherfehler"]')).toHaveCount(0);
    await expect(page.locator(".cm-content")).toContainText("WICHTIGER TEXT");
    // Server wieder gesund: Nochmal versuchen sichert und wechselt
    await page.unroute("**/api/datei");
    await wechsle(page, "09_wiki/wissen/Kaffee.md");
    await expect(page.locator('[data-dialog="speicherfehler"]')).toBeVisible({ timeout: 5000 }).catch(() => {});
    if (await page.locator('[data-dialog="speicherfehler"]').count()) await page.click('[data-aktion="nochmal"]');
    await expect(page.locator("#pfad")).toContainText("Kaffee", { timeout: 5000 });
    expect(lese(DATEI_A).toString()).toContain("WICHTIGER TEXT");
  });
}

test("K-1: Verwerfen und wechseln wechselt bewusst", async ({ page }) => {
  await oeffne(page, DATEI_A);
  await sichtbareDatei(page, "09_wiki/wissen/Kaffee.md");
  await page.route("**/api/datei", (route) => route.request().method() === "PUT" ? route.fulfill({ status: 500, contentType: "application/json", body: "{}" }) : route.fallback());
  await ans_ende(page);
  await page.keyboard.type("WEG");
  await wechsle(page, "09_wiki/wissen/Kaffee.md");
  await page.click('[data-aktion="verwerfen"]');
  await expect(page.locator("#pfad")).toContainText("Kaffee");
  expect(lese(DATEI_A).toString()).not.toContain("WEG");
});

test("K-1: laufendes (langsames) Speichern wird beim Wechsel abgewartet, nichts geht verloren", async ({ page }) => {
  await oeffne(page, DATEI_A);
  await sichtbareDatei(page, "09_wiki/wissen/Kaffee.md");
  await page.route("**/api/datei", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    await new Promise((r) => setTimeout(r, 1500));
    await route.fallback();
  });
  await ans_ende(page);
  await page.keyboard.type("ERSTER");
  await page.waitForTimeout(900); // Debounce ausgelöst, Antwort hängt
  await expect(page.locator("#speicherstand")).toHaveText("Speichert …");
  await page.keyboard.type(" ZWEITER"); // noch während das erste läuft
  await wechsle(page, "09_wiki/wissen/Kaffee.md");
  await expect(page.locator("#pfad")).toContainText("Kaffee", { timeout: 8000 });
  expect(lese(DATEI_A).toString()).toContain("ERSTER ZWEITER");
});

test("W-1: vorSchliessen sichert Ausstehendes sofort und meldet ok / Fehlergrund", async ({ page }) => {
  await oeffne(page, DATEI_A);
  await ans_ende(page);
  await page.keyboard.type("VOR DEM SCHLIESSEN");
  const r = await page.evaluate(() => window.studio.vorSchliessen());
  expect(r).toEqual({ ok: true });
  expect(lese(DATEI_A).toString()).toContain("VOR DEM SCHLIESSEN");
  await page.route("**/api/datei", (route) => route.request().method() === "PUT" ? route.fulfill({ status: 500, contentType: "application/json", body: '{"fehler":"kaputt"}' }) : route.fallback());
  await page.keyboard.type("X");
  const f = await page.evaluate(() => window.studio.vorSchliessen());
  expect(f.ok).toBe(false);
  expect(f.grund).toContain("kaputt");
});

test("Sync-Neuladen überschreibt Getipptes nicht: Konflikt-Hinweis", async ({ page }) => {
  await oeffne(page, DATEI_A);
  await page.waitForSelector('[data-st="sync"]');
  writeFileSync(join(vault, DATEI_A), "# Von außen\n"); // Datei ändert sich während des Abgleichs
  await page.route("**/api/git/sync", async (route) => {
    await new Promise((r) => setTimeout(r, 600));
    await route.fallback();
  });
  await page.click('[data-st="sync"]');
  await ans_ende(page);
  await page.keyboard.type("TIPP WÄHREND SYNC"); // wird dirty, bevor Sync fertig ist
  await page.route("**/api/datei", (route) => route.request().method() === "PUT" ? route.fulfill({ status: 500, contentType: "application/json", body: '{"fehler":"offline"}' }) : route.fallback());
  await expect(page.locator('[data-banner="konflikt"]')).toBeVisible({ timeout: 8000 });
  await expect(page.locator(".cm-content")).toContainText("TIPP WÄHREND SYNC");
});

test("Schnell merken: Esc behält den Entwurf, Ablegen löscht ihn", async ({ page }) => {
  await oeffne(page, DATEI_A);
  await page.keyboard.press("Meta+Shift+m");
  await page.fill('[data-feld="text"]', "Gedanke, der nicht verloren gehen darf");
  await page.fill('[data-feld="titel"]', "Titelchen");
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-feld="text"]')).toHaveCount(0);
  await page.keyboard.press("Meta+Shift+m");
  await expect(page.locator('[data-feld="text"]')).toHaveValue("Gedanke, der nicht verloren gehen darf");
  await expect(page.locator('[data-feld="titel"]')).toHaveValue("Titelchen");
  await page.click('[data-aktion="merken"]');
  await expect(page.locator(".toast").filter({ hasText: "Inbox" })).toBeVisible();
  await page.keyboard.press("Meta+Shift+m");
  await expect(page.locator('[data-feld="text"]')).toHaveValue("");
});

test("Ordner zeigen: nur in der App, mit Pfad der offenen Datei", async ({ page }) => {
  await oeffne(page, DATEI_A);
  await page.keyboard.press("Meta+k");
  await page.keyboard.type(">Finder");
  await expect(page.locator('.palette [data-pal="befehl"]')).toHaveCount(0); // Browser: ausgeblendet
  await page.keyboard.press("Escape");
  const page2 = await page.context().newPage();
  await mocke(page2);
  await page2.addInitScript(() => { window.__aktionen = []; window.webkit = { messageHandlers: { aktion: { postMessage: (m) => window.__aktionen.push(m) } } }; });
  await page2.goto(server.url + "?pfad=" + encodeURIComponent(DATEI_A));
  await page2.waitForSelector(".cm-content .cm-line");
  await page2.keyboard.press("Meta+k");
  await page2.keyboard.type(">Finder");
  await page2.keyboard.press("Enter");
  await expect.poll(() => page2.evaluate(() => window.__aktionen.filter((a) => a.aktion === "ordner-zeigen"))).toEqual([{ aktion: "ordner-zeigen", wert: DATEI_A }]);
});

test("Menübefehl vor fertigem Start wird gemerkt und danach ausgeführt; bereit-Flag", async ({ page }) => {
  await page.route("**/api/info", async (route) => { await new Promise((r) => setTimeout(r, 700)); await route.fallback(); });
  await mocke(page);
  await page.addInitScript(() => {
    const iv = setInterval(() => { if (window.studio?.befehl) { clearInterval(iv); window.__bereitBeiBefehl = window.studio.bereit; window.studio.befehl("merken"); } }, 5);
  });
  await page.goto(server.url);
  await expect(page.locator('[data-feld="text"]')).toBeVisible({ timeout: 8000 });
  expect(await page.evaluate(() => window.__bereitBeiBefehl)).toBe(false);
  expect(await page.evaluate(() => window.studio.bereit)).toBe(true);
});

async function kitRouten(page, { vorhanden = true, vertraut = false } = {}) {
  const stand = { vertraut, post: [], gesundheit: 0 };
  await page.route("**/api/info", async (route) => {
    const r = await route.fetch(); const { vertrauen: _echt, ...j } = await r.json(); // ältere Werkstatt: ohne info.vertrauen (die echte liefert es inzwischen)
    await route.fulfill({ response: r, json: { ...j, kit: { vorhanden, vertraut: stand.vertraut } } });
  });
  await page.route("**/api/kit/vertrauen", async (route) => { stand.post.push(route.request().postDataJSON()); stand.vertraut = true; await route.fulfill({ json: { ok: true } }); });
  await page.route("**/api/gesundheit", async (route) => {
    stand.gesundheit++;
    await route.fulfill({ json: stand.vertraut ? { ampel: "gruen", warnungen: [], pruefungen: [] } : { verfuegbar: false, grund: "nicht-vertraut" } });
  });
  await page.route("**/api/rueckfragen", (route) => route.fulfill({ json: stand.vertraut ? { offen: 2 } : { verfuegbar: false, grund: "nicht-vertraut" } }));
  return stand;
}

// Ältere Werkstatt: nur info.kit ({ vorhanden, vertraut }), ohne info.vertrauen. Die Frage ist seit Vertrauen v2 ein Dialog (vorher ein Hinweisband).
test("Kit-Vertrauen: Frage, Vertrauen lädt Gesundheit/Rückfragen sofort", async ({ page }) => {
  const stand = await kitRouten(page);
  await oeffne(page, DATEI_A);
  const frage = page.locator('.dialog[data-dialog="vertrauen"]');
  await expect(frage).toBeVisible();
  await expect(frage).toContainText("Brain-Werkzeuge (.tools)");
  await expect(page.locator('[data-st="gesundheit"]')).toHaveCount(0);
  await page.screenshot({ path: "screenshots/kit-vertrauen-light.png" });
  const vorher = stand.gesundheit;
  await page.click('[data-aktion="vertrauen-erlauben"]');
  await expect(frage).toHaveCount(0);
  expect(stand.post).toEqual([{ erlauben: true, vault: realpathSync(vault) }]); // Vertrauen v2: der gezeigte Vault geht mit
  await expect(page.locator('[data-st="gesundheit"]')).toBeVisible();
  await expect(page.locator('[data-bereich="rueckfragen"] .zahl')).toHaveText("2");
  expect(stand.gesundheit).toBeGreaterThan(vorher);
});

test("Kit-Vertrauen: Nicht jetzt schließt die Frage; vertraut oder ohne kit-Feld: keine Frage", async ({ page }) => {
  await kitRouten(page);
  await oeffne(page, DATEI_A);
  await page.click('[data-aktion="vertrauen-spaeter"]');
  await expect(page.locator('[data-dialog="vertrauen"]')).toHaveCount(0);
  await expect(page.locator('[data-st="vertrauen"]')).toBeVisible(); // später über die Statusleiste erreichbar
  const p2 = await page.context().newPage();
  await mocke(p2);
  await kitRouten(p2, { vertraut: true });
  await p2.goto(server.url + "?pfad=" + encodeURIComponent(DATEI_A)); await p2.waitForSelector(".cm-content .cm-line");
  await expect(p2.locator('[data-dialog="vertrauen"]')).toHaveCount(0);
  const p3 = await page.context().newPage(); // echtes Backend, evtl. ohne kit-Feld
  await mocke(p3);
  await p3.goto(server.url + "?pfad=" + encodeURIComponent(DATEI_A)); await p3.waitForSelector(".cm-content .cm-line");
  await p3.waitForTimeout(500);
  await expect(p3.locator('[data-dialog="vertrauen"]')).toHaveCount(0);
});

// ---------------------------------------------------------------- W3: Zeitüberschreitung der Brücke (die Anfrage reißt ab, status 0)
const DAUERT = "Das dauert länger als erwartet. Ich habe den Stand neu geladen – prüfe bitte, ob es geklappt hat.";
function merkeAnfragen(page) {
  const log = [];
  page.on("request", (r) => { const p = new URL(r.url()).pathname; if (["/api/info", "/api/vaults", "/api/git/status"].includes(p)) log.push(p); });
  return log;
}

test("W3: Sichern reißt ab → Dialog zu, Info, Vault-Liste und Git-Status neu geladen, ehrlicher Satz", async ({ page }) => {
  writeFileSync(join(vault, "00_inbox/neu.md"), "Neu\n");
  await oeffne(page, DATEI_A);
  await expect(page.locator('[data-st="geaendert"]')).toContainText("geändert");
  await page.route("**/api/git/commit", (r) => r.abort("failed"));
  await page.click('[data-st="geaendert"]');
  await page.fill('[data-feld="nachricht"]', "Neu");
  const log = merkeAnfragen(page);
  await page.click('[data-aktion="commit"]');
  await expect(page.locator(".toast")).toContainText(DAUERT);
  await expect(page.locator('[data-feld="nachricht"]')).toHaveCount(0);
  for (const p of ["/api/info", "/api/vaults", "/api/git/status"]) expect(log, p).toContain(p);
  await expect(page.locator(".toast.fehler")).toHaveCount(0); // keine rohe Verbindungsmeldung
});

test("W3: Abgleich reißt ab → gleicher ehrlicher Satz, kein Fehlerzustand in der Statusleiste", async ({ page }) => {
  await oeffne(page, DATEI_A);
  await page.route("**/api/git/sync", (r) => r.abort("failed"));
  const log = merkeAnfragen(page);
  await page.click('[data-st="sync"]');
  await expect(page.locator(".toast")).toContainText(DAUERT);
  for (const p of ["/api/info", "/api/vaults", "/api/git/status"]) expect(log, p).toContain(p);
  await expect(page.locator('[data-st="sync"]')).not.toContainText("Fehler");
});

test("W3: antwortet die Werkstatt danach auch nicht, bleibt die Verbindungsmeldung", async ({ page }) => {
  await oeffne(page, DATEI_A);
  await page.route("**/api/git/sync", (r) => r.abort("failed"));
  await page.route("**/api/info", (r) => r.abort("failed"));
  await page.click('[data-st="sync"]');
  await expect(page.locator(".toast.fehler")).toContainText("Die Verbindung zum Hintergrunddienst ist abgebrochen");
  await expect(page.locator(".toast")).not.toContainText(DAUERT);
});

// Geänderte Erwartung (UI-6): Bei 504 hat die Werkstatt zurückgenommen („Es wurde nichts verändert“), der Ausgang ist also nicht unklar.
// Früher schloss der Dialog und der Satz stand nur in einem Toast; die Nachricht war weg. Jetzt bleibt der Dialog offen und der Satz steht darin.
// Die Prüfung „Stand wird trotzdem neu geladen“ bleibt unverändert.
const ZEIT_SICHERN = "Das Sichern hat zu lange gedauert. Es wurde nichts verändert.";
test("W3: Frist der Werkstatt (504) zeigt deren Satz im offenen Dialog und lädt trotzdem neu", async ({ page }) => {
  writeFileSync(join(vault, "00_inbox/neu.md"), "Neu\n");
  await oeffne(page, DATEI_A);
  await expect(page.locator('[data-st="geaendert"]')).toContainText("geändert");
  await page.route("**/api/git/commit", (r) => r.fulfill({ status: 504, json: { fehler: ZEIT_SICHERN } }));
  await page.click('[data-st="geaendert"]');
  await page.fill('[data-feld="nachricht"]', "Neu");
  const log = merkeAnfragen(page);
  await page.click('[data-aktion="commit"]');
  await expect(page.locator(".dialog .fehlertext")).toHaveText(ZEIT_SICHERN);
  await expect.poll(() => log.includes("/api/info") && log.includes("/api/git/status")).toBe(true);
});

// UI-6: der Commit-Dialog bleibt bei 504 offen. Nachricht und Auswahl bleiben, der Knopf ist wieder frei, ein zweiter Versuch sichert.
test("UI-6: Sichern läuft in die Frist der Werkstatt (504): Dialog offen, Nachricht und Auswahl bleiben, zweiter Versuch sichert", async ({ page }) => {
  writeFileSync(join(vault, "00_inbox/neu.md"), "Neu\n");
  writeFileSync(join(vault, "00_inbox/zweite.md"), "Zwei\n");
  await oeffne(page, DATEI_A);
  await expect(page.locator('[data-st="geaendert"]')).toContainText("geändert");
  const bodies = [];
  await page.route("**/api/git/commit", (r) => { bodies.push(r.request().postDataJSON()); return bodies.length === 1 ? r.fulfill({ status: 504, json: { fehler: ZEIT_SICHERN } }) : r.fallback(); });
  await page.click('[data-st="geaendert"]');
  await page.fill('[data-feld="nachricht"]', "Meine eigene Nachricht");
  await page.locator('[data-datei="00_inbox/zweite.md"]').uncheck(); // die Auswahl wurde angepasst
  await page.click('[data-aktion="commit"]');
  const dialog = page.locator(".dialog").filter({ has: page.locator('[data-feld="nachricht"]') });
  await expect(dialog.locator(".fehlertext")).toHaveText(ZEIT_SICHERN);
  await expect(dialog).toBeVisible();
  await expect(page.locator('[data-feld="nachricht"]')).toHaveValue("Meine eigene Nachricht");
  await expect(page.locator('[data-datei="00_inbox/zweite.md"]')).not.toBeChecked();
  await expect(page.locator('[data-datei="00_inbox/neu.md"]')).toBeChecked();
  await expect(page.locator('[data-aktion="commit"]')).toBeEnabled();
  await expect(page.locator(".toast")).toHaveCount(0); // der Satz steht im Dialog, nicht zusätzlich als Meldung
  expect(await page.evaluate(() => window.studio.vorSchliessen())).toEqual({ ok: true }); // die Arbeit gilt als beendet
  // zweiter Versuch mit denselben Eingaben: die echte Werkstatt sichert genau die gewählte Datei
  await page.click('[data-aktion="commit"]');
  await expect(page.locator(".toast")).toContainText("Gesichert.");
  await expect(dialog).toHaveCount(0);
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(bodies[1].nachricht).toBe("Meine eigene Nachricht");
  expect(bodies[1].dateien).toEqual(["00_inbox/neu.md"]);
  expect(git(vault, "log", "-1", "--format=%s").trim()).toBe("Meine eigene Nachricht");
  expect(git(vault, "show", "--name-only", "--format=", "HEAD").trim()).toBe("00_inbox/neu.md");
});

test("UI-6: bei status 0 (die Brücke gibt auf) bleibt es beim bisherigen Weg: Dialog zu, Stand neu, ehrlicher Satz", async ({ page }) => {
  writeFileSync(join(vault, "00_inbox/neu.md"), "Neu\n");
  await oeffne(page, DATEI_A);
  await expect(page.locator('[data-st="geaendert"]')).toContainText("geändert");
  await page.route("**/api/git/commit", (r) => r.abort("failed"));
  await page.click('[data-st="geaendert"]');
  await page.fill('[data-feld="nachricht"]', "Neu");
  await page.click('[data-aktion="commit"]');
  await expect(page.locator(".toast")).toContainText("Das dauert länger als erwartet.");
  await expect(page.locator('[data-feld="nachricht"]')).toHaveCount(0);
});
