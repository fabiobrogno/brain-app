// Studio v2: Seitenleiste, Bereiche, Typen, Ansichten, Karten, Verlauf-Modus, Eigenschaften, Vault-Wechsel, Spalten.
// Die v2-Routen des Backends werden mit Attrappen aus dem Vault-Ordner gespeist (erzwungen = unabhängig vom Backend-Stand).
import { test, expect } from "./basis.mjs";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
const opazitaet = (page, sel) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).opacity);
const karte = (page, pfad) => page.locator(`#liste-koerper [data-karte][data-pfad="${pfad}"]`);
const titel = (page) => page.locator("#liste-koerper [data-karte] .karte-titel").allTextContents();

test("Seitenleiste: Bereiche mit Zählern, Ansichten, Typen und Ordner", async ({ page }) => {
  await start(page);
  await expect(page.locator('[data-bereich="inbox"] .zahl')).toHaveText("3");
  await expect(page.locator('[data-bereich="wissen"] .zahl')).toHaveText("6"); // ohne generierte INDEX.md
  await expect(page.locator('[data-bereich="archiv"] .zahl')).toHaveText("0");
  const alle = Number(await page.locator('[data-bereich="alle"] .zahl').innerText());
  expect(alle).toBeGreaterThanOrEqual(12);
  await expect(page.locator('[data-bereich="rueckfragen"]')).toHaveCount(0); // nur mit Kit
  // Ansichten mit Zählern aus Prüf-Stufe und Fristen
  await expect(page.locator('[data-ansicht="strittig"] .zahl')).toHaveText("1");   // Espresso (Konflikt-Kasten)
  await expect(page.locator('[data-ansicht="abgelaufen"] .zahl')).toHaveText("1"); // Mühle (Prüffrist 2020)
  await expect(page.locator('[data-ansicht="zuletzt"] .zahl')).not.toHaveText("0");
  // Typen mit Farbe/Symbol und Zähler
  const thema = page.locator('[data-typ="thema"]');
  await expect(thema).toContainText("Thema");
  await expect(thema.locator(".zahl")).toHaveText("1");
  await expect(thema.locator("svg.sym")).toHaveCount(1);
  expect(await thema.evaluate((e) => e.getAttribute("style"))).toContain("--typ");
  // Ordner: eingeklappt, nur oberste Ebene
  const ordner = await page.locator("#baum .zeile").evaluateAll((els) => els.map((e) => e.dataset.pfad));
  expect(ordner).toContain("09_wiki");
  expect(ordner).not.toContain("09_wiki/wissen");
  await page.locator('#baum [data-pfad="09_wiki"] .pfeil').click();
  await expect(page.locator('#baum [data-pfad="09_wiki/wissen"]')).toBeVisible();
});

test("Bereich wählen filtert die Liste und setzt den Listenkopf; Zähler und Karten stimmen", async ({ page }) => {
  await start(page);
  await page.click('[data-bereich="wissen"]');
  await expect(page.locator("#liste-titel")).toContainText("Wissen");
  await expect(page.locator('[data-bereich="wissen"]')).toHaveAttribute("aria-current", "true");
  const t = await titel(page);
  expect(t.length).toBe(6);
  expect(t).toContain("Kaffee");
  expect(t).not.toContain("Reise nach Lissabon");
  await page.click('[data-bereich="inbox"]');
  await expect(page.locator("#liste-koerper [data-karte]")).toHaveCount(3);
  await page.click('[data-typ="thema"]');
  await expect(page.locator("#liste-titel")).toContainText("Thema");
  expect(await titel(page)).toEqual(["Claude Mods"]);
  await page.locator('#baum [data-pfad="10_notizen"]').click();
  expect((await titel(page)).sort()).toEqual(["CRLF-Datei", "Reise nach Lissabon"]);
});

test("Karte: Titel, Vorschau, Datum, Typ-Symbol und Wahrheits-Punkt; Auswahl öffnet die Notiz", async ({ page }) => {
  await start(page);
  await page.click('[data-bereich="wissen"]');
  const k = karte(page, "09_wiki/wissen/Espresso.md");
  await expect(k.locator(".karte-titel")).toHaveText("Espresso");
  await expect(k.locator(".karte-vorschau")).toContainText("Zubereitung unter hohem Druck");
  await expect(k.locator(".karte-fuss")).toContainText("2026");
  await expect(k.locator('[data-punkt]')).toHaveClass(/rot/, { timeout: 5000 });
  expect(await opazitaet(page, '#liste-koerper [data-karte]')).toBe("1");
  await k.click();
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Espresso");
  await expect(page.locator("#pfad")).toContainText("Wissen");
  await expect(k).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".cm-content")).toContainText("Zubereitung unter hohem Druck");
  // andere Karte: Auswahl wandert
  await karte(page, "09_wiki/wissen/Kaffee.md").click();
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Kaffee");
  await expect(k).toHaveAttribute("aria-selected", "false");
});

test("Tastatur: ↑↓ in der Liste öffnet die Nachbarn, Enter springt in den Editor", async ({ page }) => {
  await start(page);
  await page.click('[data-bereich="inbox"]');
  const t = await titel(page);
  await page.locator("#liste-koerper [data-karte]").first().click();
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText(t[0]);
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText(t[1]);
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText(t[2]);
  await page.keyboard.press("ArrowUp");
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText(t[1]);
  await page.keyboard.press("Enter");
  await expect(page.locator(".cm-content")).toBeFocused();
});

test("Sortierung wechselt die Reihenfolge und wird gemerkt", async ({ page }) => {
  await start(page);
  await page.click('[data-bereich="wissen"]');
  await page.click("#knopf-sort");
  await page.click('.menue [data-menue="titel"]');
  const t = await titel(page);
  expect(t).toEqual([...t].sort((a, b) => a.localeCompare(b, "de", { numeric: true, sensitivity: "base" })));
  await expect(page.locator("#knopf-sort")).toContainText("Titel");
  await page.reload();
  await page.waitForSelector("[data-karte]");
  await expect(page.locator("#knopf-sort")).toContainText("Titel");
});

test("Eigenschaften: Wahrheitsstatus oben, Typ, Felder, Beziehungen, Rückverweise, Info, Verlauf", async ({ page }) => {
  await start(page, "09_wiki/wissen/agentic-os/tief/thema_claude-mods.md");
  const p = page.locator("#info");
  await expect(p.locator('[data-sektion="pruefung"] .status-karte')).toBeVisible({ timeout: 5000 });
  expect(await opazitaet(page, '#info [data-sektion="pruefung"]')).toBe("1");
  // Wahrheitsstatus ist der erste Abschnitt
  expect(await p.locator(".info-sektion").first().getAttribute("data-sektion")).toBe("pruefung");
  await expect(p.locator('[data-feld="typ"]')).toContainText("Thema");
  await expect(p.locator('[data-feld="description"]')).toContainText("Plugins, die Claude Code selbst ändern");
  await expect(p.locator('[data-sektion="info"]')).toContainText("Wörter");
  await expect(p.locator('[data-sektion="info"]')).toContainText("Größe");
  await expect(p.locator('[data-sektion="verlauf"]')).toBeVisible();
  // Beziehungen und Rückverweise an Kaffee ↔ Espresso
  await page.locator('[data-karte][data-pfad="09_wiki/wissen/Kaffee.md"]').click();
  await expect(p.locator('[data-sektion="rueck"] [data-ziel="09_wiki/wissen/Espresso.md"]')).toBeVisible({ timeout: 5000 });
  await expect(p.locator('[data-sektion="rueck"] [data-ziel="10_notizen/crlf.md"]')).toHaveCount(0);
  await p.locator('[data-sektion="rueck"] [data-ziel="09_wiki/wissen/Espresso.md"]').click();
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Espresso");
});

test("Eigenschaften: Beziehungen aus Feldern mit [[Links]], fehlendes Ziel, Typ-Chip", async ({ page }) => {
  mkdirSync(join(vault, "p"), { recursive: true });
  writeFileSync(join(vault, "p/alpha.md"), '---\ntyp: projekt\ngehoert_zu: "[[beta]]"\nverwandt: ["[[beta]]", "[[gibtesnicht]]"]\nstatus: aktiv\n---\n# Alpha\n\nText.\n');
  writeFileSync(join(vault, "p/beta.md"), "# Beta\n\nZurück zu [[alpha]].\n");
  await start(page, "p/alpha.md");
  const p = page.locator("#info");
  await expect(p.locator('[data-beziehung="gehoert_zu"] [data-ziel="p/beta.md"]')).toBeVisible({ timeout: 5000 });
  await expect(p.locator('[data-beziehung="verwandt"] .ziel.fehlt')).toContainText("gibtesnicht");
  await expect(p.locator('[data-feld="typ"] [data-typ-chip="projekt"]')).toContainText("Projekt");
  await expect(p.locator('[data-feld="status"]')).toContainText("aktiv");
  // Felder mit Links tauchen nicht doppelt unter „Felder“ auf
  await expect(p.locator('[data-feld="gehoert_zu"]')).toHaveCount(0);
  await p.locator('[data-beziehung="gehoert_zu"] [data-ziel="p/beta.md"]').click();
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Beta");
  await expect(p.locator('[data-sektion="rueck"] [data-ziel="p/alpha.md"]')).toBeVisible({ timeout: 5000 });
});

test("Eigenschaften ein-/ausblenden (⌘⌥I und Knopf), Breite per Ziehen und gemerkt", async ({ page }) => {
  await start(page, "10_notizen/Reise nach Lissabon.md");
  await expect(page.locator("#app")).toHaveAttribute("data-info", "an");
  await page.click("#knopf-info");
  await expect(page.locator("#app")).toHaveAttribute("data-info", "aus");
  await page.keyboard.press("Meta+Alt+i");
  await expect(page.locator("#app")).toHaveAttribute("data-info", "an");
  const breite = (name) => page.evaluate((n) => document.getElementById(n).getBoundingClientRect().width, name);
  await expect.poll(() => breite("seite")).toBeGreaterThan(240);
  const vorher = await breite("seite");
  const griff = page.locator('.griff[data-griff="seite"]');
  const b = await griff.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + 300);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 48, b.y + 300, { steps: 6 });
  await page.mouse.up();
  const nachher = await breite("seite");
  expect(nachher).toBeGreaterThan(vorher + 30);
  await page.reload();
  await page.waitForSelector("[data-karte]");
  expect(Math.abs((await breite("seite")) - nachher)).toBeLessThan(2);
  // Tastatur am Griff und Doppelklick = Standard
  await griff.focus();
  await page.keyboard.press("ArrowLeft");
  expect(await breite("seite")).toBeLessThan(nachher);
  await griff.dblclick();
  expect(Math.abs((await breite("seite")) - vorher)).toBeLessThan(2);
});

test("Werkzeuge im Editorkopf: Favorit (mit Seitenleisten-Abschnitt), Rohtext, Breite, Gliederung", async ({ page }) => {
  await start(page, "09_wiki/wissen/Kaffee.md");
  await expect(page.locator('[data-abschnitt="favoriten"]')).toBeHidden();
  await page.click("#w-favorit");
  await expect(page.locator('[data-ansicht="favoriten"] .zahl')).toHaveText("1");
  await page.click('[data-ansicht="favoriten"]');
  await expect(page.locator("#liste-titel")).toContainText("Favoriten");
  expect(await titel(page)).toEqual(["Kaffee"]);
  await page.click("#w-favorit");
  await expect(page.locator('[data-abschnitt="favoriten"]')).toBeVisible(); // bleibt sichtbar, solange die Sicht gewählt ist
  // Rohtext: Markierungen sichtbar
  await expect(page.locator(".cm-content")).not.toContainText("# Kaffee");
  await page.click("#w-roh");
  await expect(page.locator(".cm-content")).toContainText("# Kaffee");
  await expect(page.locator("#w-roh")).toHaveAttribute("aria-pressed", "true");
  await page.click("#w-roh");
  await expect(page.locator(".cm-content")).not.toContainText("# Kaffee");
  // Breite
  await page.click("#w-breit");
  await expect(page.locator("#haupt")).toHaveAttribute("data-breite", "breit");
  // Gliederung
  await page.click("#w-gliederung");
  await expect(page.locator(".menue [data-menue]")).toHaveText(["Kaffee", "Fakten"]);
  await page.locator(".menue [data-menue]").nth(1).click();
  await expect(page.locator(".menue")).toHaveCount(0);
  await expect(page.locator(".cm-content")).toBeFocused(); // Sprung setzt den Cursor und gibt dem Editor den Fokus
});

test("Suche in der Liste: Treffer-Karten, Esc stellt die Liste wieder her", async ({ page }) => {
  await start(page);
  const vor = (await titel(page)).length;
  await page.click("#knopf-suche");
  await expect(page.locator("#suche")).toBeFocused();
  await page.keyboard.type("Espresso");
  await expect(page.locator('[data-suche="treffer"]').first()).toBeVisible();
  await expect(page.locator("#liste-titel")).toContainText("Suchergebnisse");
  await page.keyboard.press("Escape");
  await expect(page.locator("#liste-titel")).toContainText("Alle Notizen");
  expect((await titel(page)).length).toBe(vor);
  await page.click("#knopf-suche");
  await page.keyboard.type("zzzqqqq");
  await expect(page.locator('[data-suche="leer"]')).toContainText("Nichts gefunden");
});

test("Leere Zustände: Liste, Posteingang und Editor sind gestaltet", async ({ page }) => {
  await start(page, null, { ueberschreibe: { notizen: [], typen: [] } });
  await expect(page.locator('[data-leer="liste"]')).toBeVisible();
  expect(await opazitaet(page, '[data-leer="liste"]')).toBe("1");
  await page.click('[data-bereich="inbox"]');
  await expect(page.locator('[data-leer="liste"] h3')).toHaveText("Posteingang ist leer");
  await expect(page.locator("#leer h2")).toBeVisible();
});

test("Vault-Wechsler: Liste, Wechsel ohne Neustart, Aus Liste entfernen fragt nach", async ({ page }) => {
  const zweite = baueVault({ leer: true }).vault;
  const stand = { aktiv: vault, aufrufe: [] };
  const info = (await (await fetch(server.url + "api/info")).json());
  await page.route("**/api/vaults", (r) => r.request().method() === "GET" ? r.fulfill({ json: { vaults: [{ name: "Brain Test", pfad: vault, farbe: "#5b4ed6" }, { name: "Zweiter", pfad: zweite, farbe: "#2a9ba8" }], aktiv: stand.aktiv } }) : r.fallback());
  await page.route("**/api/vaults/aktiv", (r) => { stand.aufrufe.push(r.request().postDataJSON()); stand.aktiv = zweite; r.fulfill({ json: { ok: true } }); });
  await page.route("**/api/vaults/entfernen", (r) => { stand.aufrufe.push({ entfernen: r.request().postDataJSON() }); r.fulfill({ json: { ok: true } }); });
  await page.route("**/api/info", (r) => r.fulfill({ json: { ...info, vault: stand.aktiv, name: stand.aktiv === vault ? "Brain Test" : "Zweiter" } }));
  await start(page);
  await expect(page.locator("#vault-name")).toHaveText("Brain Test");
  await page.click("#vault-wechsler");
  await expect(page.locator('.menue [data-menue="vault"]')).toHaveText([/Brain Test/, /Zweiter/]);
  await expect(page.locator('.menue [data-menue="oeffnen"]')).toContainText("Vault öffnen");
  await expect(page.locator('.menue [data-menue="neu"]')).toContainText("Neuer Vault");
  await page.locator('.menue [data-menue="vault"]').nth(1).click();
  await expect(page.locator("#vault-name")).toHaveText("Zweiter");
  expect(stand.aufrufe[0]).toEqual({ pfad: zweite });
  await expect(page.locator("#leer h2")).toBeVisible(); // leerer zweiter Vault: freundlicher Zustand
  // Entfernen: Rückfrage, dann Aufruf (Ordner bleibt)
  await page.click("#vault-wechsler");
  await page.locator('.menue [data-menue="entfernen"]').click();
  await page.locator('.menue [data-menue="entf"]').nth(1).click();
  await expect(page.locator('.dialog [data-aktion="entfernen"]')).toBeVisible();
  await page.locator('.dialog [data-aktion="entfernen"]').click();
  await expect.poll(() => stand.aufrufe.at(-1)).toEqual({ entfernen: { pfad: zweite } });
});

test("Ohne Vault zeigt die Oberfläche das Willkommen statt der App", async ({ page }) => {
  await page.route("**/api/info", async (r) => { const res = await r.fetch(); const j = await res.json(); await r.fulfill({ json: { ...j, vault: null, name: null, git: false } }); });
  await mockeV2(page, vault, { erzwingen: true });
  await page.goto(server.url);
  await expect(page.locator("#willkommen-host")).toBeVisible({ timeout: 8000 });
  await expect(page.locator("#app")).toBeHidden();
  await expect.poll(() => opazitaet(page, "#willkommen-host")).toBe("1");
});

test("Verlauf-Modus: Statusleiste schaltet die Liste auf Commits, Datei öffnet Diff im Editorbereich", async ({ page }) => {
  await start(page, "10_notizen/Reise nach Lissabon.md");
  await page.route("**/api/git/log**", (r) => r.request().url().includes("vor=") ? r.fulfill({ json: { tage: [] } }) : r.fallback());
  await page.click('[data-st="verlauf"]');
  await expect(page.locator("#app")).toHaveAttribute("data-modus", "verlauf");
  await expect(page.locator("#liste-titel")).toContainText("Verlauf");
  await expect(page.locator('[data-st="verlauf"]')).toHaveClass(/aktiv/);
  await expect(page.locator("#liste-koerper")).toContainText("Mietwagen ergänzt", { timeout: 8000 });
  await expect(page.locator("#liste-koerper")).toContainText("Erste Fassung");
  await page.click('[data-st="verlauf"]');
  await expect(page.locator("#liste-titel")).toContainText("Alle Notizen");
  await expect(page.locator("#app")).toHaveAttribute("data-modus", "liste");
});

test("Remote hinzufügen: Statusleiste bei Kein Remote öffnet den Dialog", async ({ page }) => {
  server.stopp();
  const o = baueVault({ mitRemote: false });
  vault = o.vault; server = await starteServer(vault);
  await start(page);
  await expect(page.locator('[data-st="remote"]')).toContainText("Kein Remote");
  await page.click('[data-st="remote"]');
  await expect(page.locator(".dialog")).toContainText("Remote");
});

test("Statusleiste: alle Elemente und Hell/Dunkel-Umschalter", async ({ page }) => {
  await start(page);
  for (const id of ["vault", "version", "zweig", "remote", "sync", "geaendert", "verlauf", "claude", "theme", "einstellungen"]) await expect(page.locator(`[data-st="${id}"]`)).toBeVisible();
  await page.emulateMedia({ colorScheme: "light" });
  const farbe = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(await farbe()).toBe("rgb(255, 255, 255)");
  await page.click('[data-st="theme"]');
  expect(await farbe()).toBe("rgb(31, 30, 27)");
  await page.reload();
  await page.waitForSelector("[data-karte]");
  expect(await farbe()).toBe("rgb(31, 30, 27)"); // gemerkt
  await page.click('[data-st="einstellungen"]');
  await page.click('.menue [data-wert="hell"]');
  expect(await farbe()).toBe("rgb(255, 255, 255)");
});

test("Menübefehle: alle Swift-Befehle sind belegt, hell-dunkel schaltet das Theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await start(page);
  const befehl = (n) => page.evaluate((x) => window.studio.befehl(x), n);
  const farbe = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(await farbe()).toBe("rgb(255, 255, 255)");
  await befehl("hell-dunkel");
  await expect.poll(farbe).toBe("rgb(31, 30, 27)");
  await befehl("hell-dunkel");
  await expect.poll(farbe).toBe("rgb(255, 255, 255)");
  await befehl("posteingang");
  await expect(page.locator("#liste-titel")).toContainText("Posteingang");
  await befehl("wissen");
  await expect(page.locator("#liste-titel")).toContainText("Wissen");
  await befehl("alle");
  await expect(page.locator("#liste-titel")).toContainText("Alle Notizen");
  await befehl("infospalte");
  await expect(page.locator("#app")).toHaveAttribute("data-info", "aus");
  await befehl("infospalte");
  await expect(page.locator("#app")).toHaveAttribute("data-info", "an");
  await befehl("palette");
  await expect(page.locator(".palette input")).toBeVisible();
  await page.keyboard.press("Escape");
  await befehl("neu");
  await expect(page.locator('[data-feld="titel"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await befehl("merken");
  await expect(page.locator('[data-feld="text"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await befehl("vault-wechseln");
  await expect(page.locator(".menue")).toBeVisible();
  await page.keyboard.press("Escape");
  await befehl("einstellungen"); // Menüleiste „Einstellungen …“: das Zahnrad-Menü der Statusleiste
  await expect(page.locator('.menue [data-wert="hell"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await befehl("verlauf");
  await expect(page.locator("#app")).toHaveAttribute("data-modus", "verlauf");
  await befehl("nicht-vorhanden"); // unbekannte Befehle bleiben still
});

test("Ohne Vault: bereit-Flag steht nach dem Willkommen, vault-oeffnen geht, andere Befehle werden still verworfen", async ({ page }) => {
  await page.route("**/api/info", async (r) => { const res = await r.fetch(); const j = await res.json(); await r.fulfill({ json: { ...j, vault: null, name: null, git: false } }); });
  await mockeV2(page, vault, { erzwingen: true });
  const fehler = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  // beide Befehle kommen, bevor die Oberfläche fertig ist (wie beim Start aus dem Menü)
  await page.addInitScript(() => {
    const iv = setInterval(() => { if (window.studio?.befehl) { clearInterval(iv); window.studio.befehl("posteingang"); window.studio.befehl("vault-oeffnen"); } }, 5);
  });
  await page.goto(server.url);
  await expect(page.locator("#willkommen-host")).toBeVisible({ timeout: 8000 });
  await expect.poll(() => page.evaluate(() => window.studio.bereit)).toBe(true);
  expect(await page.evaluate(() => window.__studioBereit)).toBe(true);
  // vault-oeffnen wurde nach dem Zeichnen des Willkommens ausgeführt: der Ordner-Ablauf zeigt sein Eingabefeld
  await expect(page.locator('[data-schritt="pfad"] input[data-feld="pfad"]')).toBeVisible({ timeout: 8000 });
  // posteingang ohne Vault: still verworfen, die App bleibt versteckt
  await expect(page.locator("#app")).toBeHidden();
  // ein späterer Befehl geht sofort durch (bereit), ohne Fehler
  await page.evaluate(() => { window.studio.befehl("alle"); window.studio.befehl("hell-dunkel"); });
  expect(fehler).toEqual([]);
});

test("Ansichten: Mitglieder und Zähler kommen aus dem Feld ansichten der Notizen (Werkstatt-Index)", async ({ page }) => {
  const notizen = baueIndex(vault).filter((n) => !n.generiert).map((n, i) => ({ ...n, ansichten: i === 0 ? ["zuletzt", "strittig"] : i === 1 ? ["zuletzt"] : [] }));
  await start(page, undefined, { ueberschreibe: { notizen } });
  await expect(page.locator('[data-ansicht="zuletzt"] .zahl')).toHaveText("2");
  await expect(page.locator('[data-ansicht="strittig"] .zahl')).toHaveText("1");
  await expect(page.locator('[data-ansicht="ungeprueft"] .zahl')).toHaveText("0");
  await page.click('[data-ansicht="zuletzt"]');
  await expect(page.locator("#liste-koerper [data-karte]")).toHaveCount(2);
});

test("Tastenkürzel-Übersicht per ⌘/ zeigt Gruppen mit Kürzeln, Esc schließt", async ({ page }) => {
  await start(page);
  await page.keyboard.press("Meta+/");
  const dlg = page.locator(".dialog");
  await expect(dlg).toContainText("Tastenkürzel");
  await expect(dlg.locator(".kuerzel section")).toHaveCount(3);
  await expect(dlg.locator("kbd").first()).toBeVisible();
  await expect(dlg).toContainText("Schnell merken");
  await page.keyboard.press("Escape");
  await expect(page.locator(".dialog")).toHaveCount(0);
});

// ---------------------------------------------------------------- W6: Vault entfernen und wechseln
const NOTIZ_A = "10_notizen/Reise nach Lissabon.md";
async function zweiVaults(page, zweite, stand) {
  await page.route("**/api/vaults", (r) => { if (r.request().method() !== "GET") return r.fallback(); stand.liste++; return r.fulfill({ json: { vaults: [{ name: "Brain Test", pfad: vault, farbe: "#5b4ed6" }, { name: "Zweiter", pfad: zweite, farbe: "#2a9ba8" }], aktiv: vault } }); });
  await page.route("**/api/vaults/aktiv", (r) => { stand.aktiv.push(r.request().postDataJSON()); r.fulfill({ json: { ok: true } }); });
  await page.route("**/api/vaults/entfernen", (r) => { stand.datei = readFileSync(join(vault, NOTIZ_A), "utf8"); r.fulfill({ json: { ok: true } }); });
}

test("W6: Vault entfernen sichert IMMER zuerst; ein nicht offener Vault lässt Editor und Eingaben unberührt (nur die Liste wird neu geladen)", async ({ page }) => {
  const zweite = baueVault({ leer: true }).vault;
  const stand = { liste: 0, aktiv: [], datei: null };
  await zweiVaults(page, zweite, stand);
  await start(page, NOTIZ_A);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.type(" EINGABE-VOR-ENTFERNEN");
  await page.click("#vault-wechsler"); // sofort, noch vor dem Auto-Speichern
  await page.locator('.menue [data-menue="entfernen"]').click();
  await page.locator('.menue [data-menue="entf"]').nth(1).click(); // „Zweiter“ ist nicht der offene Vault
  await page.locator('.dialog [data-aktion="entfernen"]').click();
  await expect(page.locator(".toast")).toContainText("Aus der Liste entfernt");
  expect(stand.datei, "die Eingabe war vor dem Entfernen gesichert").toContain("EINGABE-VOR-ENTFERNEN");
  await expect.poll(() => stand.liste).toBeGreaterThanOrEqual(2); // Menü + nach dem Entfernen
  // Editor nicht zurückgesetzt: Notiz offen, Text da, und der Rückgängig-Verlauf lebt noch (ein neu geladener Editor hätte keinen)
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Reise nach Lissabon");
  await expect(page.locator(".cm-content")).toContainText("EINGABE-VOR-ENTFERNEN");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+z");
  await expect(page.locator(".cm-content")).not.toContainText("EINGABE-VOR-ENTFERNEN");
  expect(stand.aktiv).toEqual([]);
});

test("W6: Vault wechseln im Konfliktzustand bricht nicht still ab, sondern sagt warum", async ({ page }) => {
  const zweite = baueVault({ leer: true }).vault;
  const stand = { liste: 0, aktiv: [], datei: null };
  await zweiVaults(page, zweite, stand);
  await start(page, NOTIZ_A);
  await page.waitForSelector(".cm-content .cm-line"); // erst wenn die Notiz geladen ist, von außen ändern (sonst lädt sie schon die neue Fassung)
  writeFileSync(join(vault, NOTIZ_A), "# Von außen geändert\n");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.type("meine Eingabe");
  await expect(page.locator('[data-banner="konflikt"]')).toBeVisible({ timeout: 5000 });
  await page.click("#vault-wechsler");
  await page.locator('.menue [data-menue="vault"]').nth(1).click();
  const toast = page.locator(".toast.fehler");
  await expect(toast).toContainText("Erst den Konflikt dieser Notiz lösen");
  await expect(toast).toContainText("Reise nach Lissabon");
  expect(stand.aktiv).toEqual([]); // nichts gewechselt
  await expect(page.locator(".cm-content")).toContainText("meine Eingabe");
});

// ---------------------------------------------------------------- k8: Daten nie als Stil-Text oder Programm
test("k8: Typfarben gelten nur als #RRGGBB (oder Palettenname); alles andere fällt auf die Standardfarbe; gesetzt als CSS-Variable", async ({ page }) => {
  const typen = [
    { name: "thema", anzahl: 1, farbe: "red;background:url(http://x.invalid/a)", symbol: "buch" },
    { name: "projekt", anzahl: 1, farbe: "#E0693F", symbol: "rakete" },
    { name: "person", anzahl: 1, farbe: "rgb(0 0 0); position: fixed", symbol: "person" },
  ];
  await start(page, undefined, { ueberschreibe: { typen } });
  const lies = (typ) => page.locator(`[data-typ="${typ}"]`).evaluate((e) => ({ attr: e.getAttribute("style"), typ: e.style.getPropertyValue("--typ"), text: e.style.getPropertyValue("--typ-text") }));
  const a = await lies("thema"), b = await lies("projekt"), c = await lies("person");
  for (const x of [a, c]) { expect(x.attr).not.toMatch(/url\(|fixed|rgb\(/); expect(x.typ).toMatch(/^#[0-9a-f]{6}$/i); expect(x.text).toContain("color-mix"); }
  expect(b.typ).toBe("#E0693F");
  const f = await page.evaluate(async () => { const m = await import("/format.js"); return ["#4f7df3", "#4F7DF3", "#fff", "#12345678", "rgb(1,2,3)", "hsl(0 0% 0%)", "red; x:y", "constructor", "__proto__", "blau", " Blau "].map((x) => m.typFarbe(x)); });
  expect(f).toEqual(["#4f7df3", "#4F7DF3", null, null, null, null, null, null, null, "#4a78e0", "#4a78e0"]);
  expect(await page.evaluate(async () => (await import("/format.js")).typName("constructor"))).toBe("Constructor");
});

test("k8: Feldnamen aus dem Datei-Kopf wie „constructor“ bleiben Text; h() kennt keinen html-Zweig mehr", async ({ page }) => {
  await start(page);
  await page.route("**/api/notiz/kontext**", (r) => r.fulfill({ json: { felder: { constructor: "x", toString: "y", name: "Eigenname" }, beziehungen: [], verweise: [], rueckverweise: [], info: { woerter: 1, bytes: 1, geaendert: null, erstellt: null } } }));
  await karte(page, "09_wiki/wissen/Kaffee.md").click();
  await expect(page.locator('#info [data-feld="constructor"] .k')).toHaveText("Constructor");
  await expect(page.locator('#info [data-feld="toString"] .k')).toHaveText("ToString");
  await expect(page.locator('#info [data-feld="name"] .k')).toHaveText("Name"); // bekannte Namen aus der Tabelle bleiben
  const r = await page.evaluate(async () => { const { h } = await import("/hilfen.js"); const e = h("div", { html: "<img src=x onerror=alert(1)>" }); return { kinder: e.children.length, innen: e.innerHTML }; });
  expect(r).toEqual({ kinder: 0, innen: "" });
});
