// Runde 3d im echten Studio, gegen die echte Werkstatt mit Wegwerf-Vault und Wegwerf-Support-Ordner (nie echte Nutzerorte):
//   · Info-Spalte: „Ungelinkte Erwähnungen“ (Stellen, Verlinken mit Rückgängig, „Alle verlinken“ mit Vorschau, Fremdänderung) und „Diese Notiz erwähnt …“ (Verlinken im Editor, Rückgängig)
//   · Karte „Was ist neu“ im Posteingang: Zeilen, Klicks, „Gelesen“, Zeitraum, „Mit KI zusammenfassen“ nur mit KI-Konto (Platzhalter „kommt bald“)
//   · hell und dunkel; Bilder nur, wenn ERW_BILDER auf einen Ordner zeigt.
import { test, expect } from "./basis.mjs";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";

const BILDER = process.env.ERW_BILDER || null;
if (BILDER) mkdirSync(BILDER, { recursive: true });
const bild = async (page, name, schema) => { if (BILDER) { await page.waitForTimeout(350); await page.screenshot({ path: join(BILDER, `${name}-${schema}.png`) }); } };

const KAFFEE = "09_wiki/wissen/Kaffee.md";
const MORGEN = "10_notizen/Morgenroutine.md", EINKAUF = "10_notizen/Einkauf.md", TIPPS = "10_notizen/Lissabon-Tipps.md";
let vault, server;
// Saubere Umgebung für die Werkstatt (kein Konfig-Ordner, kein Home des Entwicklers)
const umgebung = () => ({ PATH: process.env.PATH, HOME: mkdtempSync(join(tmpdir(), "erw-home-")), TZ: "Europe/Berlin", LANG: "de_DE.UTF-8" });
test.beforeEach(async () => {
  ({ vault } = baueVault()); vault = realpathSync(vault);
  writeFileSync(join(vault, MORGEN), "# Morgenroutine\n\nZuerst ein Espresso, dann Kaffee mit Milch. Die Kaffeemühle steht links.\n");
  writeFileSync(join(vault, EINKAUF), "# Einkauf\n\n- Bohnen für den Kaffee\n- Filter\n\n```\nKaffee im Code\n```\n");
  writeFileSync(join(vault, TIPPS), "# Lissabon-Tipps\n\nIn Lissabon gibt es guten Kaffee und eine alte Mühle am Fluss.\n");
  server = await starteServer(vault, { umgebung: umgebung() });
});
test.afterEach(() => { server?.stopp(); server = null; });

const lese = (p) => readFileSync(join(vault, p), "utf8");
const ein = (page) => page.locator('#info [data-sektion="erw-ein"]');
const aus = (page) => page.locator('#info [data-sektion="erw-aus"]');
async function oeffneNotiz(page, pfad) {
  await page.goto(server.url);
  await page.waitForSelector("[data-karte], [data-leer]", { timeout: 10000 });
  await page.evaluate((p) => window.studio.oeffne?.(p), pfad).catch(() => {});
}
async function waehle(page, pfad) {
  await page.click('[data-bereich="alle"]');
  const k = page.locator(`#liste-koerper [data-karte][data-pfad="${pfad}"]`);
  await k.scrollIntoViewIfNeeded();
  await k.click();
  await expect(page.locator("#info")).toBeVisible();
}
const start = async (page) => { await page.goto(server.url); await page.waitForSelector("[data-karte], [data-leer]", { timeout: 10000 }); };
const schemata = [["hell", "light"], ["dunkel", "dark"]];

test("Info-Spalte: Erwähnungen mit Zeile und Markierung; Code, Links und die Notiz selbst fehlen", async ({ page }) => {
  await start(page);
  await waehle(page, KAFFEE);
  await expect(ein(page).locator("[data-erw-summe]")).toHaveText("3 Stellen in 3 Notizen");
  await expect(ein(page).locator(`[data-erw-notiz="${MORGEN}"]`)).toContainText("Zuerst ein Espresso, dann Kaffee mit Milch.");
  await expect(ein(page).locator(`[data-erw-notiz="${MORGEN}"] mark`)).toHaveText("Kaffee");
  await expect(ein(page).locator(`[data-erw-notiz="${EINKAUF}"] .erw-stelle`)).toHaveCount(1);
  await expect(ein(page).locator(`[data-erw-notiz="${EINKAUF}"]`)).not.toContainText("im Code");
  await expect(ein(page).locator(`[data-erw-notiz="${KAFFEE}"]`)).toHaveCount(0);
  await expect(ein(page).locator('[data-erw-notiz="09_wiki/wissen/Espresso.md"]')).toHaveCount(0); // dort steht [[Kaffee]]
  // Klick auf eine Stelle öffnet die Notiz an der Zeile
  await ein(page).locator(`[data-erw-notiz="${TIPPS}"] .erw-auszug-knopf`).click();
  await expect(page.locator("#pfad")).toContainText("Lissabon-Tipps");
});

test("Verlinken einer Stelle: Link in der anderen Notiz, Hinweis mit Rückgängig, Liste und Rückverweise folgen", async ({ page }) => {
  await start(page);
  await waehle(page, KAFFEE);
  const vorher = lese(EINKAUF);
  await ein(page).locator(`[data-erw-notiz="${EINKAUF}"] [data-aktion="erw-verlinken"]`).click();
  await expect(page.locator(".toast").last()).toContainText("1 Erwähnung von „Kaffee“ verlinkt");
  expect(lese(EINKAUF)).toBe(vorher.replace("für den Kaffee", "für den [[Kaffee]]"));
  await expect(ein(page).locator("[data-erw-summe]")).toHaveText("2 Stellen in 2 Notizen");
  await expect(page.locator('#info [data-sektion="rueck"]')).toContainText("Einkauf");
  // Rückgängig
  await page.locator(".toast").last().getByText("Rückgängig").click();
  await expect(page.locator(".toast").last()).toContainText("Verlinken zurückgenommen");
  expect(lese(EINKAUF)).toBe(vorher);
  await expect(ein(page).locator("[data-erw-summe]")).toHaveText("3 Stellen in 3 Notizen");
});

test("Alle verlinken: Vorschau mit Vorher/Nachher, ein Eintrag, alles auf einmal rückgängig", async ({ page }) => {
  await start(page);
  await waehle(page, KAFFEE);
  const vorher = [MORGEN, EINKAUF, TIPPS].map(lese);
  await ein(page).locator('[data-aktion="erw-alle"]').click();
  const dlg = page.locator('[data-dialog="erwaehnungen"]');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('[data-feld="satz"]')).toContainText("3 Stellen werden in 3 Notizen zu einem Link");
  await expect(dlg.locator(".da-vz")).toHaveCount(3);
  await expect(dlg.locator(".da-nachher").first()).toContainText("[[Kaffee]]");
  await dlg.locator('[data-aktion="bestaetigen"]').click();
  await expect(page.locator(".toast").last()).toContainText("3 Erwähnungen von „Kaffee“ verlinkt");
  expect(lese(MORGEN)).toContain("dann [[Kaffee]] mit Milch");
  expect(lese(TIPPS)).toContain("guten [[Kaffee]] und");
  expect(lese(EINKAUF)).toContain("```\nKaffee im Code\n```");
  await expect(ein(page).locator(".erw-leer")).toContainText("Keine Notiz nennt diesen Titel");
  const akt = await (await page.request.get(server.url + "api/aktivitaet?art=datei-aktion")).json();
  expect(akt.ereignisse.filter((e) => /verlinkt/.test(e.text))).toHaveLength(1);
  await page.locator(".toast").last().getByText("Rückgängig").click();
  await expect(page.locator(".toast").last()).toContainText("Verlinken zurückgenommen");
  expect([MORGEN, EINKAUF, TIPPS].map(lese)).toEqual(vorher);
});

test("Fremdänderung zwischen Anzeige und Klick: eine umgeschriebene Stelle wird nicht verlinkt, nichts Falsches geschrieben", async ({ page }) => {
  // Live-Aktualisierung anhalten (Long-Poll bleibt offen): sonst zeigt das Studio je nach Takt schon die neue Stelle, und der Klick verlinkt richtigerweise sie –
  // geprüft wird hier genau der veraltete Stand zwischen Anzeige und Klick.
  await page.route("**/api/ereignisse**", () => {});
  await start(page);
  await waehle(page, KAFFEE);
  await expect(ein(page).locator("[data-erw-summe]")).toHaveText("3 Stellen in 3 Notizen");
  writeFileSync(join(vault, TIPPS), "# Lissabon-Tipps\n\nIn Lissabon trinkt man guten Kaffee mit Zimt und besucht eine alte Mühle.\n"); // anderer Satz, der Name steht noch da
  const vorher = lese(TIPPS);
  await ein(page).locator(`[data-erw-notiz="${TIPPS}"] [data-aktion="erw-verlinken"]`).click();
  await expect(page.locator(".toast").last()).toContainText("Nichts verlinkt");
  expect(lese(TIPPS)).toBe(vorher);
});

test("Diese Notiz erwähnt …: Titel anderer Notizen, Verlinken im Editor, Rückgängig, Speichern über den sicheren Weg", async ({ page }) => {
  await start(page);
  await waehle(page, MORGEN);
  await expect(aus(page).locator("[data-erw-summe]")).toContainText("Stellen für 2 Notizen");
  await expect(aus(page).locator(`[data-erw-notiz="09_wiki/wissen/Espresso.md"] mark`)).toHaveText("Espresso");
  await expect(aus(page).locator(`[data-erw-notiz="${KAFFEE}"] mark`)).toHaveText("Kaffee");
  await expect(aus(page)).not.toContainText("null"); // nie ein verirrter Platzhaltertext
  await expect(ein(page)).not.toContainText("null");
  const vorher = lese(MORGEN);
  await aus(page).locator(`[data-erw-notiz="09_wiki/wissen/Espresso.md"] [data-aktion="erw-verlinken"]`).click();
  await expect(page.locator(".toast").last()).toContainText("1 Erwähnung verlinkt");
  await expect.poll(() => page.evaluate(() => window.studio.ed.text())).toContain("ein [[Espresso]], dann");
  await expect.poll(() => lese(MORGEN), { timeout: 8000 }).toContain("ein [[Espresso]], dann"); // der gewohnte Speicherweg
  await page.locator(".toast").last().getByText("Rückgängig").click();
  await expect.poll(() => page.evaluate(() => window.studio.ed.text())).toBe(vorher);
  await expect.poll(() => lese(MORGEN), { timeout: 8000 }).toBe(vorher);
});

test("Diese Notiz erwähnt …: Alle verlinken mit Vorschau, ⌘Z nimmt es zurück", async ({ page }) => {
  await start(page);
  await waehle(page, MORGEN);
  await aus(page).locator('[data-aktion="erw-alle"]').click();
  const dlg = page.locator('[data-dialog="erwaehnungen"]');
  await expect(dlg.locator('[data-feld="satz"]')).toContainText("2 Stellen werden in dieser Notiz zu einem Link");
  await dlg.locator('[data-aktion="bestaetigen"]').click();
  await expect.poll(() => page.evaluate(() => window.studio.ed.text())).toContain("ein [[Espresso]], dann [[Kaffee]] mit Milch");
  await page.evaluate(() => window.studio.ed.view.focus());
  await page.keyboard.press("Meta+z");
  await expect.poll(() => page.evaluate(() => window.studio.ed.text())).not.toContain("[[Espresso]]");
});

test("Karte „Was ist neu“: Zeilen mit Zahlen, anklickbar, Zeitraum wählbar, „Gelesen“ setzt den Merker", async ({ page }) => {
  await start(page);
  await page.click('[data-bereich="inbox"]');
  const karte = page.locator("[data-nk]");
  await expect(karte).toBeVisible();
  await expect(karte.locator(".nk-titel")).toHaveText("Was ist neu");
  await expect(karte.locator("[data-nk-zusammen]")).toContainText("neue Notizen"); // eingeklappt: eine Zeile mit der Kurzfassung
  await expect(karte.locator('[data-nk-zeile="notizen"]')).toHaveCount(0);
  await karte.locator("[data-nk-kopf]").click();
  await expect(karte.locator('[data-nk-zeile="notizen"] [data-nk-chip="neu"]')).toContainText("neue Notizen");
  await expect(karte.locator('[data-nk-zeile="abgleich"]')).toBeVisible();
  await expect(karte.locator('[data-nk-zeile="inbox"] [data-nk-chip="offen"]')).toHaveText("3 offen");
  // eine Zeile aufklappen und einen Eintrag öffnen
  await karte.locator('[data-nk-zeile="notizen"]').click();
  await expect(karte.locator(".nk-eintrag").first()).toBeVisible();
  await karte.locator(`[data-nk-eintrag="${EINKAUF}"]`).click();
  await expect(page.locator("#pfad")).toContainText("Einkauf");
  await page.click('[data-bereich="inbox"]');
  // Zeitraum: „Letzte 30 Tage“ zeigt dieselben neuen Notizen (ohne Merker heißt die erste Wahl „Seit 7 Tagen“, es gibt keinen „letzten Besuch“)
  await expect(karte.locator("[data-nk-zeitraum]")).toContainText("Seit 7 Tagen");
  await karte.locator("[data-nk-zeitraum]").click();
  await page.getByRole("option", { name: "Letzte 30 Tage" }).click();
  await expect(karte.locator("[data-nk-zeitraum]")).toContainText("Letzte 30 Tage");
  await expect(karte.locator('[data-nk-zeile="notizen"]')).toBeVisible();
  // Gelesen: danach ist nichts mehr neu, der Posteingang zählt weiter
  await karte.locator('[data-aktion="nk-gelesen"]').click();
  await expect(karte.locator("[data-nk-leer]")).toContainText("ist nichts Neues passiert");
  await expect(karte.locator("[data-nk-zeitraum]")).toContainText("Seit dem letzten Besuch");
  await expect(karte.locator('[data-nk-zeile="notizen"]')).toHaveCount(0);
  await expect(karte.locator('[data-nk-zeile="inbox"] [data-nk-chip="offen"]')).toHaveText("3 offen");
  // der Merker hält: neu laden, die Karte bleibt leer
  await page.reload();
  await page.waitForSelector("[data-karte], [data-leer]", { timeout: 10000 });
  await page.click('[data-bereich="inbox"]');
  await expect(page.locator("[data-nk] [data-nk-zusammen]")).toHaveText("Posteingang 3 offen");
  await page.locator("[data-nk] [data-nk-kopf]").click();
  await expect(page.locator("[data-nk] [data-nk-leer]")).toBeVisible();
});

test("Karte: Aufgaben (neu, überfällig) und KI-Aktivität aus dem Protokoll, Klick führt zur Ansicht", async ({ page }) => {
  await start(page);
  const gestern = new Date(Date.now() - 86400e3).toISOString().slice(0, 10);
  const r = await page.request.post(server.url + "api/aufgaben", { data: { titel: "Steuer abgeben", faellig: gestern } });
  expect(r.ok()).toBeTruthy();
  const protokoll = await import(new URL("../../Ressourcen/gemeinsam/aktivitaet.mjs", import.meta.url).href);
  protokoll.schreibeEreignis(server.support, vault, { art: "ablage-notiz", text: "Notiz abgelegt", pfade: ["00_inbox/2026-10-22_notiz-meeting.md"], programm: "claude" });
  protokoll.schreibeEreignis(server.support, vault, { art: "abweisung", text: "Abgewiesen: Schreiben gesperrt" });
  await page.reload();
  await page.waitForSelector("[data-karte], [data-leer]", { timeout: 10000 });
  await page.click('[data-bereich="inbox"]');
  const karte = page.locator("[data-nk]");
  await expect(karte.locator("[data-nk-zusammen]")).toContainText("überfällig");
  await karte.locator("[data-nk-kopf]").click();
  await expect(karte.locator('[data-nk-zeile="aufgaben"] [data-nk-chip="neu"]')).toHaveText("1 neu");
  await expect(karte.locator('[data-nk-zeile="aufgaben"] [data-nk-chip="ueberfaellig"]')).toHaveText("1 überfällig");
  await expect(karte.locator('[data-nk-zeile="ki"] [data-nk-chip="abgelegt"]')).toHaveText("1 abgelegt");
  await expect(karte.locator('[data-nk-zeile="ki"] [data-nk-chip="abgewiesen"]')).toHaveText("1 abgewiesen");
  await karte.locator('[data-nk-zeile="aufgaben"]').click();
  await expect(page.locator('[data-bereich="aufgaben"]')).toHaveAttribute("aria-current", /.*/);
});

test("„Mit KI zusammenfassen“: ohne KI-Konto unsichtbar, mit Konto ab Stufe „lesen“ ein ehrlicher Platzhalter (kommt bald)", async ({ page }) => {
  await start(page);
  await page.click('[data-bereich="inbox"]');
  await expect(page.locator("[data-nk]")).toBeVisible();
  await page.locator("[data-nk-kopf]").click();
  await expect(page.locator('[data-aktion="nk-ki"]')).toHaveCount(0);
  await expect(page.locator("[data-nk-inhalt]")).toBeVisible();
  // ein Konto mit Stufe „gesperrt“ reicht nicht, eines mit „lesen“ schon
  const antwort = (stufe) => ({ zustand: "ok", stufen: ["gesperrt", "lesen", "posteingang", "erweitert"], konten: [], vaults: [], aktiv: {}, zugriff: { k_aaaaaaaa: { [vault]: stufe } } });
  await page.route("**/api/ki/konten", (route) => route.fulfill({ json: antwort("gesperrt") }));
  await page.reload(); await page.waitForSelector("[data-karte], [data-leer]", { timeout: 10000 }); await page.click('[data-bereich="inbox"]');
  await expect(page.locator("[data-nk]")).toBeVisible();
  await page.locator("[data-nk-kopf]").click();
  await expect(page.locator("[data-nk-inhalt]")).toBeVisible();
  await expect(page.locator('[data-aktion="nk-ki"]')).toHaveCount(0);
  await page.unroute("**/api/ki/konten");
  await page.route("**/api/ki/konten", (route) => route.fulfill({ json: antwort("lesen") }));
  await page.reload(); await page.waitForSelector("[data-karte], [data-leer]", { timeout: 10000 }); await page.click('[data-bereich="inbox"]');
  await page.locator("[data-nk-kopf]").click();
  const knopf = page.locator('[data-aktion="nk-ki"]');
  await expect(knopf).toBeVisible();
  await expect(knopf).toContainText("kommt bald");
  await knopf.click();
  await expect(page.locator("[data-nk-ki-text]")).toContainText("Kommt bald");
  await expect(page.locator("[data-nk-ki-text]")).toContainText("ändert nichts von selbst");
});

for (const [schema, farbe] of schemata) {
  test(`hell und dunkel (${schema}): Info-Spalte und Karte`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: farbe, reducedMotion: "reduce" });
    await page.route("**/api/ki/konten", (route) => route.fulfill({ json: { zustand: "ok", stufen: ["gesperrt", "lesen", "posteingang", "erweitert"], konten: [], vaults: [], aktiv: {}, zugriff: { k_aaaaaaaa: { [vault]: "lesen" } } } }));
    await start(page);
    await page.click('[data-bereich="inbox"]');
    await expect(page.locator("[data-nk]")).toBeVisible();
    await bild(page, "karte-eingeklappt", schema);
    await page.locator("[data-nk-kopf]").click();
    await page.locator('[data-nk-zeile="notizen"]').click();
    await page.locator('[data-aktion="nk-ki"]').click();
    await bild(page, "karte", schema);
    await waehle(page, KAFFEE);
    await expect(ein(page).locator("[data-erw-summe]")).toHaveText("3 Stellen in 3 Notizen");
    await bild(page, "info-ein", schema);
    await ein(page).locator('[data-aktion="erw-alle"]').click();
    await expect(page.locator('[data-dialog="erwaehnungen"]')).toBeVisible();
    await bild(page, "vorschau", schema);
    await page.locator('[data-dialog="erwaehnungen"] [data-aktion="abbrechen"]').click();
    await waehle(page, MORGEN);
    await expect(aus(page).locator("[data-erw-summe]")).toContainText("Stellen für 2 Notizen");
    await bild(page, "info-aus", schema);
    // kein Element ragt über den Rand der Spalte
    const ueber = await page.evaluate(() => { const i = document.querySelector("#info"); return [...i.querySelectorAll(".erw-stelle, .erw-titel, .erw-kopf")].filter((e) => e.getBoundingClientRect().right > i.getBoundingClientRect().right + 1).length; });
    expect(ueber).toBe(0);
  });
}
