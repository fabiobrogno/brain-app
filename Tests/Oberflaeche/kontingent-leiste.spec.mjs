// Kontingent wie Orca (Paket E5): Segment in der Statusleiste mit Dichte-Leiter (voll → kompakt → knappstes Fenster → „+N“ → Symbol, gemessen an der Breite), Popover „Kontingent“ (alle Konten nach
// Programm, Auffrischen, „Konten verwalten …“, verbraucht/übrig), Rechtsklick-Menü der Statusleiste, ruhig veraltet (Warnzeichen nur bei Fehler UND Wert über 30 Minuten), Takt nur bei sichtbarem Fenster,
// Unterbereich „Kontingent“ mit den Schaltern — hell und dunkel. Die Routen /api/ki/kontingent und /api/ki/konten sind
// Attrappen (mocks-kontingent.mjs, mocks-konten.mjs) mit fester Uhr (13:00 Uhr in Berlin); der Rest läuft gegen die echte Werkstatt. Zeitzone und Sprache sind festgelegt (Rücksetzzeiten).
// UI_SHOTS=<Ordner>: legt die Bildschirmfotos dort ab (sonst screenshots/, ignoriert). UI_RUNDE=<n>: Teil des Dateinamens.
import { test, expect } from "./basis.mjs";
import { join } from "node:path";
import { realpathSync } from "node:fs";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { mockeV2 } from "./mocks.mjs";
import { mockeKonten } from "./mocks-konten.mjs";
import { mockeKontingent, ZUSTAND as Z, JETZT } from "./mocks-kontingent.mjs";

test.use({ timezoneId: "Europe/Berlin", locale: "de-DE" });

let vault, server;
test.beforeEach(async () => { ({ vault } = baueVault()); vault = realpathSync.native(vault); server = await starteServer(vault); });
test.afterEach(() => server?.stopp());

const runde = process.env.UI_RUNDE ? `r${process.env.UI_RUNDE}-` : "";
const foto = async (page, name) => { await page.mouse.move(3, 3); await page.waitForTimeout(450); await page.screenshot({ path: join(process.env.UI_SHOTS || "screenshots", `kt-${runde}${name}.png`) }); };
const FIRMA = "/Users/test/Firma-Vault";
const NOTIZ = "10_notizen/Reise nach Lissabon.md";
const PRIVAT = { id: "k_aaaa0001", programm: "claude", programmName: "Claude Code", name: "Privat", standard: true, ordner: "~/.claude", pfad: "/Users/test/.claude", vorhanden: true, verbunden: true };
const ARBEIT = { id: "k_aaaa0002", programm: "claude", programmName: "Claude Code", name: "Arbeit", standard: false, ordner: "~/.claude-arbeit", pfad: "/Users/test/.claude-arbeit", vorhanden: true, verbunden: true };
const KUNDE = { id: "k_aaaa0006", programm: "claude", programmName: "Claude Code", name: "Kunde", standard: false, ordner: "~/Library/Application Support/Kortex/ki-konten-ordner/claude-kunde", pfad: "/Users/test/Library/Application Support/Kortex/ki-konten-ordner/claude-kunde", verwaltet: true, vorhanden: true, verbunden: true };
const FIRMA_K = { id: "k_aaaa0004", programm: "claude", programmName: "Claude Code", name: "Firma", standard: false, ordner: "~/.claude-firma", pfad: "/Users/test/.claude-firma", vorhanden: true, verbunden: false };
const CODEX = { id: "k_aaaa0003", programm: "codex", programmName: "Codex", name: "Codex", standard: true, ordner: "~/.codex", pfad: "/Users/test/.codex", vorhanden: true, verbunden: true };
const CURSOR = { id: "k_aaaa0005", programm: "cursor", programmName: "Cursor", name: "Cursor", standard: true, ordner: "~/.cursor", pfad: "/Users/test/.cursor", vorhanden: true, verbunden: true };
const ALLE = [PRIVAT, FIRMA_K, CODEX, CURSOR];
const PROGRAMME = [
  { id: "claude", name: "Claude Code", art: "terminal", pfad: "/opt/homebrew/bin/claude", version: "2.1.80", quelle: "cli", befehl: "claude" },
  { id: "codex", name: "Codex", art: "terminal", pfad: "/opt/homebrew/bin/codex", version: "0.48.0", quelle: "cli", befehl: "codex" },
  { id: "cursor", name: "Cursor", art: "editor", pfad: "/Applications/Cursor.app", version: "1.7.2", quelle: "app", befehl: null },
];
const WERTE = () => ({ k_aaaa0001: Z.claudeOk(42, 18), k_aaaa0004: Z.nichtEingerichtet(), k_aaaa0003: Z.codexOk(9, 71), k_aaaa0005: Z.nichtAbrufbar("Cursor") });

async function start(page, { konten = ALLE, werte = WERTE(), dunkel = false, hash = null, breite = 1440, hoehe = 900, kontingent = {}, login = {} } = {}) {
  await page.setViewportSize({ width: breite, height: hoehe });
  if (dunkel) await page.emulateMedia({ colorScheme: "dark" });
  await mockeV2(page, vault);
  const k = await mockeKonten(page, { vaults: [{ pfad: vault, name: "Mein Vault" }, { pfad: FIRMA, name: "Firma" }], konten, programme: PROGRAMME,
    login: { k_aaaa0001: "angemeldet", k_aaaa0002: "angemeldet", k_aaaa0003: "angemeldet", k_aaaa0006: "angemeldet", k_aaaa0004: "nicht-angemeldet", ...login }, zuletzt: { k_aaaa0004: "2026-10-30T09:00:00.000Z" } });
  const kt = await mockeKontingent(page, { konten, werte, aktiv: () => k.aktiv, ...kontingent }); // das aktive Konto kommt aus derselben Quelle wie in der Werkstatt (ki-konten.json)
  await page.goto(server.url + "?pfad=" + encodeURIComponent(NOTIZ));
  await page.waitForSelector("#app:not([hidden])");
  await page.waitForFunction(() => window.__studioBereit === true);
  if (hash) { await page.evaluate((h) => { location.hash = h; }, hash); await expect(page.locator("[data-einstellungen]")).toBeVisible(); }
  return { k, kt };
}
const leiste = (page) => page.locator('[data-st="kontingent"]');
const menue = (page) => page.locator('[data-kt="menue"]');
const zeileM = (page, id) => menue(page).locator(`.kt-m-zeile[data-konto="${id}"]`);
// Der volle Verbrauch steht im Unterbereich „Kontingent“ (Karte je Konto); in der Kontenliste steht nur der Mini-Balken
const konto = (page, id) => page.locator(`.kx-kt-karte[data-konto="${id}"]`);
const spalte = (page, id) => konto(page, id).locator(`[data-kt-konto="${id}"]`);
const breiteVon = (loc) => loc.evaluate((e) => parseFloat(e.style.width));
const dlg = (page, name) => page.locator(`.dialog[data-dialog="${name}"]`);
const fehlerSammler = (page) => { const f = []; page.on("pageerror", (e) => f.push(e.message)); return f; };


// ---------------------------------------------------------------------- Hilfen
const SECHS = [PRIVAT, ARBEIT, CODEX];
const DREI_WERTE = () => ({ k_aaaa0001: Z.claudeOk(42, 18), k_aaaa0002: Z.claudeOk(71, 63), k_aaaa0003: Z.codexOk(9, 71) });
const stufe = (page) => leiste(page).getAttribute("data-dichte");
const ueberlauf = (page) => page.evaluate(() => { const s = document.getElementById("status"), sr = s.getBoundingClientRect(); return { scroll: s.scrollWidth - s.clientWidth, aus: [...s.querySelectorAll(".st")].filter((e) => e.getBoundingClientRect().width > 0 && (e.getBoundingClientRect().right > sr.right + 0.5 || e.getBoundingClientRect().left < sr.left - 0.5)).map((e) => e.dataset.st) }; });
// gekürzter Text („…“) in der Leiste: nur sichtbare Elemente mit überlaufendem Inhalt. Vault, Änderungen, Zweig und Remote kürzen unter 1100 px schon immer gewollt (feste Obergrenzen, hauptfenster.css);
// ob das Segment sie zusätzlich kürzt, prüft `schmaler` (ihre Breite ändert sich nicht, wenn das Segment schmaler wird).
const gekuerzt = (page, mitFesten = false) => page.evaluate((mit) => [...document.querySelectorAll(".status *")].filter((e) => e.getBoundingClientRect().width > 0 && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== "visible" && !e.closest(".kt-probe")
  && (mit || !e.closest('[data-st="geaendert"], [data-st="vault"], [data-st="zweig"], [data-st="remote"]'))).map((e) => `${e.dataset.st || e.className}: ${(e.textContent || "").trim()}`), mitFesten);
const ORDNUNG = ["voll", "kompakt", "knappstes", "plus-n", "symbol"];
const pop = (page) => page.locator('[data-kt="menue"]');

// ---------------------------------------------------------------------- Segment und Dichte-Leiter
test("Segment: ein Eintrag je Konto mit Logo, Name, 5 Std, Balken und Woche (genug Platz, hell und dunkel)", async ({ page }) => {
  const f = fehlerSammler(page);
  await start(page, { konten: [PRIVAT, CODEX], werte: { k_aaaa0001: Z.claudeOk(42, 18), k_aaaa0003: Z.codexOk(9, 71) }, breite: 1900 });
  await expect(leiste(page)).toBeVisible();
  await expect.poll(() => stufe(page)).toBe("voll");
  const p = leiste(page).locator('.kt-eintrag[data-konto="k_aaaa0001"]'), c = leiste(page).locator('.kt-eintrag[data-konto="k_aaaa0003"]');
  await expect(p).toContainText("Privat");
  await expect(p.locator(".kt-seg").first()).toHaveText("5 Std 42 % verbraucht");
  await expect(p.locator(".kt-woche")).toHaveText("Woche 18 %");
  await expect(p.locator(".ki-logo")).toBeVisible();
  expect(await breiteVon(p.locator(".kt-balken i"))).toBe(42);
  await expect(c.locator(".kt-seg").first()).toHaveText("5 Std 9 % verbraucht");
  await expect(c.locator(".kt-woche")).toHaveText("Woche 71 %");
  await expect(leiste(page)).toHaveAttribute("aria-haspopup", "dialog");
  await expect(leiste(page)).toHaveAttribute("title", /Privat: 5 Std 42 % verbraucht, noch 2 h 14 min · Woche 18 % verbraucht, bis So 19:00\nCodex: 5 Std 9 % verbraucht/);
  await foto(page, "segment-voll-hell");
  expect(f).toEqual([]);
  await page.emulateMedia({ colorScheme: "dark" });
  await foto(page, "segment-voll-dunkel");
});

// Eine Reihe von Breiten durchfahren: jede gewählte Stufe passt (kein Überlauf, nichts gekürzt), das Fenster bleibt vollständig; → die gesehenen Stufen
async function durchfahre(page, von, bis, schritt = 20) {
  const gesehen = new Set();
  for (let b = von; b >= bis; b -= schritt) {
    await page.setViewportSize({ width: b, height: 900 });
    await expect(page.locator("#status")).toBeVisible();
    await page.waitForTimeout(140);
    const s = await stufe(page);
    expect(ORDNUNG.includes(s), `${b}px: ${s}`).toBe(true);
    // Hinweis: schmaler heißt NICHT immer enger — bei Haltepunkten blendet die Leiste andere Teile aus und gibt dem Segment Platz zurück; entscheidend ist, dass die gewählte Stufe passt
    gesehen.add(s);
    expect(await ueberlauf(page), `${b}px läuft über`).toEqual({ scroll: 0, aus: [] });
    expect(await gekuerzt(page, b >= 1180), `${b}px: gekürzter Text`).toEqual([]);
    await expect(page.locator('[data-st="einstellungen"]'), `${b}px`).toBeInViewport();
  }
  return gesehen;
}
const viele = (n, wert) => Array.from({ length: n }, (_, i) => ({ ...PRIVAT, id: `k_bbbb00${String(i + 10)}`, name: `Konto ${i + 1}`, standard: false, wert: wert(i) }));
const mitWerten = (konten) => ({ konten, werte: Object.fromEntries(konten.map((k) => [k.id, Z.claudeOk(k.wert, 18)])) });

test("Dichte-Leiter, zwei Konten: voll → kompakt, gemessen an der Breite — nichts läuft über oder wird gekürzt", async ({ page }) => {
  await start(page, { konten: [PRIVAT, CODEX], werte: { k_aaaa0001: Z.claudeOk(42, 18), k_aaaa0003: Z.codexOk(9, 71) }, breite: 1900 });
  const gesehen = await durchfahre(page, 1900, 1100);
  expect([...gesehen].sort((x, y) => ORDNUNG.indexOf(x) - ORDNUNG.indexOf(y))).toEqual(["voll", "kompakt"]);
});

test("Dichte-Leiter, drei Konten: kompakt → knappstes Fenster — nichts läuft über oder wird gekürzt", async ({ page }) => {
  await start(page, { konten: SECHS, werte: DREI_WERTE(), breite: 1600 });
  const gesehen = await durchfahre(page, 1600, 560);
  expect([...gesehen].sort((x, y) => ORDNUNG.indexOf(x) - ORDNUNG.indexOf(y))).toEqual(["kompakt", "knappstes"]);
});

test("Dichte bei 1440 / 1180 / 960 / 800 px: die Stufen zeigen genau das, was versprochen ist; Bilder hell und dunkel", async ({ page }) => {
  await start(page, { konten: SECHS, werte: { ...DREI_WERTE(), k_aaaa0002: Z.claudeOk(91, 63) }, breite: 1440 });
  const inhalt = async () => ({
    stufe: await stufe(page),
    namen: await leiste(page).locator(".kt-name-text").count(),
    woche: await leiste(page).locator(".kt-woche").count(),
    balken: await leiste(page).locator(".kt-balken").count(),
    eintraege: await leiste(page).locator(".kt-eintrag").count(),
    mehr: (await leiste(page).locator(".kt-mehr").count()) ? await leiste(page).locator(".kt-mehr").textContent() : null,
  });
  const folge = {};
  for (const b of [1440, 1180, 960, 800]) {
    await page.setViewportSize({ width: b, height: 900 });
    await page.waitForTimeout(250);
    folge[b] = await inhalt();
    expect(await ueberlauf(page), `${b}`).toEqual({ scroll: 0, aus: [] });
    expect(await gekuerzt(page, b >= 1180), `${b}`).toEqual([]);
    await foto(page, `dichte-${b}-hell`);
    await page.emulateMedia({ colorScheme: "dark" });
    await foto(page, `dichte-${b}-dunkel`);
    await page.emulateMedia({ colorScheme: "light" });
  }
  // Stufenmerkmale: voll hat Namen + Woche + Balken, kompakt Namen + Balken ohne Woche, knappstes nur Prozent, „+N“ weniger Konten plus Zahl, Symbol keinen Eintrag
  const alle = Object.values(folge);
  for (const x of alle) {
    if (x.stufe === "voll") expect(x).toMatchObject({ namen: 3, woche: 3, balken: 3, eintraege: 3 });
    if (x.stufe === "kompakt") expect(x).toMatchObject({ namen: 3, woche: 0, balken: 3, eintraege: 3 });
    if (x.stufe === "knappstes") expect(x).toMatchObject({ namen: 0, woche: 0, balken: 0, eintraege: 3 });
    if (x.stufe === "plus-n") { expect(x.eintraege).toBeLessThan(3); expect(x.mehr).toMatch(/^\+\d$/); expect(x).toMatchObject({ namen: 0, balken: 0 }); }
    if (x.stufe === "symbol") expect(x).toMatchObject({ eintraege: 0, namen: 0 });
  }
  expect(ORDNUNG.indexOf(folge[1440].stufe)).toBeLessThan(ORDNUNG.indexOf(folge[800].stufe));
  expect(new Set(alle.map((x) => x.stufe)).size, "vier Breiten, mindestens zwei verschiedene Stufen").toBeGreaterThanOrEqual(2);
});

test("„+N“: das dringende Konto (91 %) bleibt, die ruhigen werden zur Zahl; Tooltip nennt sie — nichts läuft über", async ({ page }) => {
  const k = viele(8, (i) => (i === 3 ? 91 : 20 + i));
  await start(page, { ...mitWerten(k), breite: 1600 });
  const gesehen = await durchfahre(page, 1600, 1100);
  expect(gesehen.has("plus-n"), "die Stufe „+N“ kommt vor").toBe(true);
  for (let b = 1600; b >= 1100; b -= 20) { // zurück auf eine Breite mit „+N“ (schmaler heißt nicht immer enger: Haltepunkte der Leiste)
    await page.setViewportSize({ width: b, height: 900 });
    await page.waitForTimeout(140);
    if ((await stufe(page)) === "plus-n") break;
  }
  await expect.poll(() => stufe(page)).toBe("plus-n");
  await expect(leiste(page).locator(".kt-eintrag")).toHaveCount(1);
  await expect(leiste(page).locator(".kt-eintrag")).toHaveAttribute("data-konto", k[3].id);
  await expect(leiste(page).locator(".kt-eintrag")).toHaveAttribute("data-stufe", "rot");
  await expect(leiste(page).locator(".kt-mehr")).toHaveText("+7");
  await expect(leiste(page).locator(".kt-mehr")).toHaveAttribute("title", /7 weitere Konten: Konto 1, Konto 2, Konto 3, Konto 5/);
  await foto(page, "plus-n-hell");
});

test("Symbol-Stufe: nur das Tachosymbol, der Tooltip trägt die Werte, der Klick öffnet trotzdem das Popover", async ({ page }) => {
  // viele dringende Konten: „+N“ kann keines wegfallen lassen und passt nicht mehr — nur das Symbol bleibt
  const k = viele(10, (i) => 95 + (i % 5));
  await start(page, { ...mitWerten(k), breite: 1600 });
  await page.setViewportSize({ width: 1100, height: 900 });
  await expect.poll(() => stufe(page)).toBe("symbol");
  expect(await ueberlauf(page)).toEqual({ scroll: 0, aus: [] });
  await expect(leiste(page).locator(".kt-eintrag")).toHaveCount(0);
  await expect(leiste(page).locator("svg")).toHaveCount(1);
  await expect(leiste(page)).toHaveAttribute("title", /Konto 1: 5 Std 95 %/);
  await expect(leiste(page)).toHaveAttribute("data-ton", "dringend");
  await leiste(page).click();
  await expect(pop(page)).toBeVisible();
  await foto(page, "symbol-popover-hell");
});

test("Ohne Werte: ehrlicher Text, kein erfundener Wert; Codex entsprechend", async ({ page }) => {
  await start(page, { konten: [PRIVAT, CODEX], werte: { k_aaaa0001: Z.keineWerte(), k_aaaa0003: Z.codexLaedt() } });
  await expect(leiste(page)).toHaveAttribute("data-zustand", "ohne");
  await expect(leiste(page)).toContainText("Kontingent · folgt beim nächsten Lauf");
  await leiste(page).click();
  await expect(pop(page).locator('.kt-konto[data-konto="k_aaaa0001"]')).toContainText("Erscheint, sobald Claude Code das nächste Mal läuft");
  await expect(pop(page).locator('.kt-konto[data-konto="k_aaaa0003"]')).toContainText("Kortex fragt Codex nach dem Kontingent");
  await expect(pop(page).locator('[data-fenster="session"]')).toHaveCount(0);
  await foto(page, "leer-popover-hell");
});

// ---------------------------------------------------------------------- Popover
test("Popover „Kontingent“: alle Konten nach Programm, beide Balken mit Rücksetzzeit, Stand, Auffrischen gesperrt bis 5 Minuten — hell", async ({ page }) => {
  await start(page, { konten: SECHS, werte: DREI_WERTE() });
  await leiste(page).click();
  await expect(pop(page)).toBeVisible();
  await expect(leiste(page)).toHaveAttribute("aria-expanded", "true");
  await expect(pop(page).locator(".kt-m-titel b")).toHaveText("Kontingent");
  await expect(pop(page).locator('[data-kt="stand-kopf"]')).toHaveText("Stand vor 1 Min");
  await expect(pop(page).locator(".kt-gruppe")).toHaveCount(2);
  await expect(pop(page).locator('.kt-gruppe[data-programm="claude"] .kt-g-kopf')).toHaveText("Claude Code");
  await expect(pop(page).locator('.kt-gruppe[data-programm="codex"] .kt-g-kopf')).toHaveText("Codex");
  const p = pop(page).locator('.kt-konto[data-konto="k_aaaa0001"]');
  await expect(p.locator('[data-fenster="session"] .kt-prozent')).toHaveText("42 %");
  await expect(p.locator('[data-fenster="session"] .kt-rest')).toHaveText("noch 2 h 14 min");
  await expect(p.locator('[data-fenster="weekly"] .kt-prozent')).toHaveText("18 %");
  await expect(p.locator('[data-fenster="weekly"] .kt-rest')).toHaveText("bis So 19:00");
  await expect(pop(page).locator('.kt-konto[data-konto="k_aaaa0002"] [data-fenster="session"] .kt-balken')).toHaveAttribute("data-stufe", "gelb");
  await expect(pop(page).locator('.kt-konto[data-konto="k_aaaa0003"] [data-fenster="weekly"] .kt-prozent')).toHaveText("71 %");
  const neu = pop(page).locator('[data-aktion="kt-neu"]');
  await expect(neu).toBeDisabled();
  await expect(neu).toHaveAttribute("title", /Frühestens um 13:01 Uhr wieder möglich\. Kortex fragt höchstens alle 5 Minuten nach\./);
  await expect(pop(page).locator('[data-aktion="kt-konten"]')).toHaveText("Konten verwalten …");
  await expect(pop(page).locator('[data-kt="anzeige"]')).toBeVisible();
  await foto(page, "popover-hell");
});

test("Popover dunkel: 92 % ist rot, 71 % gelb, 9 % grau; „voll“ steht mit Rücksetzzeit da", async ({ page }) => {
  await start(page, { dunkel: true, konten: SECHS, werte: { k_aaaa0001: Z.claudeOk(92, 18), k_aaaa0002: Z.claudeOk(100, 63), k_aaaa0003: Z.codexOk(9, 71) } });
  await expect(leiste(page).locator('.kt-eintrag[data-konto="k_aaaa0001"]')).toHaveAttribute("data-stufe", "rot");
  await expect(leiste(page).locator('.kt-eintrag[data-konto="k_aaaa0002"]')).toContainText("voll");
  await leiste(page).click();
  await expect(pop(page).locator('.kt-konto[data-konto="k_aaaa0001"] [data-fenster="session"] .kt-balken')).toHaveAttribute("data-stufe", "rot");
  await expect(pop(page).locator('.kt-konto[data-konto="k_aaaa0003"] [data-fenster="weekly"] .kt-balken')).toHaveAttribute("data-stufe", "gelb");
  await expect(pop(page).locator('.kt-konto[data-konto="k_aaaa0003"] [data-fenster="session"] .kt-balken')).toHaveAttribute("data-stufe", "grau");
  await expect(pop(page).locator('.kt-konto[data-konto="k_aaaa0002"] [data-fenster="session"] .kt-prozent')).toHaveText("voll");
  await expect(pop(page).locator('.kt-konto[data-konto="k_aaaa0002"] [data-fenster="session"] .kt-rest')).toHaveText("wieder ab 15:14");
  await foto(page, "popover-dunkel");
});

test("Popover: „Konten verwalten …“ springt zu Einstellungen → KI & Konten → Konten; Esc schließt und gibt den Fokus zurück; Auffrischen fragt mit neu=1", async ({ page }) => {
  const { kt } = await start(page, { konten: [PRIVAT, CODEX], werte: { k_aaaa0001: Z.claudeOk(42, 18), k_aaaa0003: Z.codexAlt(9, 71) } });
  await leiste(page).focus();
  await page.keyboard.press("Enter");
  await expect(pop(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(pop(page)).toHaveCount(0);
  await expect(leiste(page)).toBeFocused();
  await leiste(page).click();
  const neu = pop(page).locator('[data-aktion="kt-neu"]');
  await expect(neu).toBeEnabled(); // Codex: letzte Abfrage vor mehr als 5 Minuten
  await neu.click();
  await expect.poll(() => kt.anfragen.some((a) => a.body?.neu === "1")).toBe(true);
  await pop(page).locator('[data-aktion="kt-konten"]').click();
  await expect(page.locator("[data-einstellungen]")).toBeVisible();
  await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#einstellungen\/ki/);
  await expect(pop(page)).toHaveCount(0);
});

test("verbraucht/übrig: im Popover umschalten ändert Zahl und Balken überall (Leiste, Popover, Einstellungen), die Farbe bleibt am Verbrauch, die Wahl bleibt nach dem Neuladen", async ({ page }) => {
  await start(page, { konten: [PRIVAT, CODEX], werte: { k_aaaa0001: Z.claudeOk(92, 18), k_aaaa0003: Z.codexOk(9, 71) }, breite: 1900 });
  const p = leiste(page).locator('.kt-eintrag[data-konto="k_aaaa0001"]');
  await expect(p.locator(".kt-seg").first()).toHaveText("5 Std 92 % verbraucht");
  await leiste(page).click();
  await pop(page).locator('[data-kt="anzeige"] [data-wert="uebrig"]').click();
  await expect(p.locator(".kt-seg").first()).toHaveText("5 Std 8 % übrig");
  expect(await breiteVon(p.locator(".kt-balken i"))).toBe(8);
  await expect(p.locator(".kt-balken")).toHaveAttribute("data-stufe", "rot"); // 8 % übrig = 92 % verbraucht = rot
  await expect(pop(page).locator('.kt-konto[data-konto="k_aaaa0001"] [data-fenster="session"] .kt-prozent')).toHaveText("8 %");
  await expect(pop(page).locator('.kt-konto[data-konto="k_aaaa0003"] [data-fenster="session"] .kt-prozent')).toHaveText("91 %");
  await foto(page, "uebrig-popover-hell");
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await (await page.request.get(server.url + "api/einstellungen")).json()).werte.kiKontingentAnzeige).toBe("uebrig");
  await page.reload();
  await page.waitForFunction(() => window.__studioBereit === true);
  await expect(leiste(page).locator('.kt-eintrag[data-konto="k_aaaa0001"] .kt-seg').first()).toHaveText("5 Std 8 % übrig");
  // dieselbe Wahl steht im Unterbereich „Kontingent“ und gilt dort für die Karten
  await page.evaluate(() => { location.hash = "#einstellungen/ki?ziel=ki-kontingent"; });
  await expect(page.locator('[data-kx="kt-anzeige"] [data-wert="uebrig"]')).toHaveAttribute("aria-checked", "true");
  await expect(spalte(page, "k_aaaa0001").locator('[data-fenster="session"] .kt-prozent')).toHaveText("8 %");
  await page.locator('[data-kx="kt-anzeige"] [data-wert="verbraucht"]').click();
  await expect(spalte(page, "k_aaaa0001").locator('[data-fenster="session"] .kt-prozent')).toHaveText("92 %");
});

test("Nicht geladen (Werkstatt-Fehler): die Leiste sagt „nicht abrufbar“, das Popover nennt den nächsten Schritt und bleibt bedienbar", async ({ page }) => {
  const f = fehlerSammler(page);
  const { kt } = await start(page, { kontingent: { fehler: "Das Kontingent liegt gerade nicht vor." } });
  await expect(leiste(page)).toContainText("Kontingent nicht abrufbar");
  await leiste(page).click();
  await expect(pop(page).locator('[data-kt="fehler"]')).toContainText("Das Kontingent konnte nicht geladen werden.");
  await expect(pop(page).locator('[data-aktion="kt-konten"]')).toBeVisible();
  kt.fehler = null;
  await pop(page).locator('[data-aktion="kt-neu"]').click();
  await expect(leiste(page)).toContainText("Privat");
  expect(f).toEqual([]);
});

test("Ohne Konto mit Kontingent: das Segment fehlt, es gibt nur den einen Knopf „KI verbinden“", async ({ page }) => {
  await start(page, { konten: [FIRMA_K, CURSOR], werte: { k_aaaa0004: Z.nichtEingerichtet(), k_aaaa0005: Z.nichtAbrufbar("Cursor") } });
  await expect(leiste(page)).toBeHidden();
  await expect(page.locator('#status [data-st="claude"]')).toBeVisible();
  await expect(page.locator("#status button:visible", { hasText: /verbinden/ })).toHaveCount(1);
});

// ---------------------------------------------------------------------- ruhig veraltet
test("Ruhig veraltet: grauer Stand ab 10 Minuten OHNE Zeichen; ein gescheiterter Abruf bei einem Wert unter 30 Minuten bleibt ruhig", async ({ page }) => {
  await start(page, { konten: SECHS, werte: { k_aaaa0001: Z.claudeAlter(42, 18, 12), k_aaaa0002: Z.claudeAlter(71, 63, 95), k_aaaa0003: Z.codexFehlerMitWert(9, 71, 20) } });
  await expect(leiste(page).locator('[data-kt="warnzeichen"]')).toHaveCount(0);
  for (const id of ["k_aaaa0001", "k_aaaa0002", "k_aaaa0003"]) await expect(leiste(page).locator(`.kt-eintrag[data-konto="${id}"]`)).toHaveAttribute("data-ruhig", "ja");
  await foto(page, "ruhig-leiste-hell");
  await leiste(page).click();
  await expect(pop(page).locator('.kt-konto[data-konto="k_aaaa0001"] [data-kt="stand"]')).toHaveText("Stand vor 12 Min");
  await expect(pop(page).locator('.kt-konto[data-konto="k_aaaa0002"] [data-kt="stand"]')).toHaveText("Stand vor 1 Std");
  await expect(pop(page).locator('.kt-konto[data-konto="k_aaaa0003"] [data-kt="stand"]')).toHaveText("Stand vor 20 Min");
  await expect(pop(page).locator('[data-warn="ja"]')).toHaveCount(0);
  await expect(pop(page).locator(".kt-hinweis")).toHaveCount(0);
  const farbe = await pop(page).locator('.kt-konto[data-konto="k_aaaa0001"] [data-kt="stand"]').evaluate((e) => getComputedStyle(e).color);
  const text = await pop(page).locator('.kt-konto[data-konto="k_aaaa0001"] .kt-k-name').evaluate((e) => getComputedStyle(e).color);
  expect(farbe, "der Stand ist grau, nicht in der Textfarbe").not.toBe(text);
  await foto(page, "ruhig-popover-hell");
});

test("Warnzeichen NUR bei gescheitertem Abruf UND einem Wert über 30 Minuten (Leiste und Popover), nicht bei „veraltet“ allein", async ({ page }) => {
  await start(page, { dunkel: true, konten: SECHS, werte: { k_aaaa0001: Z.claudeAlter(42, 18, 300), k_aaaa0002: Z.claudeOk(71, 63), k_aaaa0003: Z.codexFehlerMitWert(9, 71, 45) } });
  await expect(leiste(page).locator('[data-kt="warnzeichen"]')).toHaveCount(1);
  await expect(leiste(page).locator('.kt-eintrag[data-konto="k_aaaa0003"]')).toHaveAttribute("data-warn", "ja");
  await expect(leiste(page).locator('.kt-eintrag[data-konto="k_aaaa0001"]')).not.toHaveAttribute("data-warn", "ja");
  await foto(page, "warnung-leiste-dunkel");
  await leiste(page).click();
  await expect(pop(page).locator('[data-warn="ja"]')).toHaveCount(1);
  await expect(pop(page).locator('.kt-konto[data-konto="k_aaaa0003"] [data-warn="ja"]')).toContainText("Abruf fehlgeschlagen. Stand vor 45 Min.");
  await expect(pop(page).locator('.kt-konto[data-konto="k_aaaa0001"] [data-kt="stand"]')).toHaveText("Stand vor 5 Std");
  await expect(pop(page).locator('.kt-konto[data-konto="k_aaaa0001"] [data-warn]')).toHaveCount(0);
  await foto(page, "warnung-popover-dunkel");
});

// ---------------------------------------------------------------------- Rechtsklick-Menü
test("Rechtsklick auf die Statusleiste: Kontingent je Konto, Wörter, Format ein und aus — gemerkt in den App-Einstellungen, sofort sichtbar", async ({ page }) => {
  await start(page, { konten: [PRIVAT, CODEX], werte: { k_aaaa0001: Z.claudeOk(42, 18), k_aaaa0003: Z.codexOk(9, 71) }, breite: 1600 });
  const status = page.locator("#status");
  await expect(page.locator('[data-st="woerter"]')).toBeVisible();
  await expect(page.locator('[data-st="format"]')).toBeVisible();
  const box = await status.boundingBox();
  const rechts = () => status.click({ button: "right", position: { x: Math.round(box.width * 0.62), y: 12 } });
  await rechts();
  const m = page.locator('[data-kt="statusmenue"]');
  await expect(m).toBeVisible();
  await expect(m.locator(".m-gruppe")).toHaveText("In der Statusleiste zeigen");
  for (const id of ["st-kontingent", "st-woerter", "st-format"]) await expect(m.locator(`[data-menue="${id}"]`)).toHaveAttribute("aria-checked", "true");
  await foto(page, "rechtsklick-hell");
  await m.locator('[data-menue="st-woerter"]').click();
  await expect(m).toHaveCount(0);
  await expect(page.locator('[data-st="woerter"]')).toBeHidden();
  await expect(page.locator('[data-st="format"]')).toBeVisible();
  await rechts();
  await expect(m.locator('[data-menue="st-woerter"]')).toHaveAttribute("aria-checked", "false");
  await m.locator('[data-menue="st-format"]').click();
  await expect(page.locator('[data-st="format"]')).toBeHidden();
  await rechts();
  await m.locator('[data-menue="st-kontingent"]').click();
  await expect(leiste(page)).toBeHidden();
  await expect(page.locator('#status [data-st="claude"]')).toBeVisible(); // ohne den Kontingent-Eintrag bleibt der Knopf „KI“
  // gemerkt: nach dem Neuladen
  await expect.poll(async () => { const w = (await (await page.request.get(server.url + "api/einstellungen")).json()).werte; return [w.kiKontingentStatusleiste, w.statusWoerter, w.statusFormat]; }).toEqual([false, false, false]);
  await page.reload();
  await page.waitForFunction(() => window.__studioBereit === true);
  await expect(leiste(page)).toBeHidden();
  await expect(page.locator('[data-st="woerter"]')).toBeHidden();
  // wieder einschalten
  await rechts();
  await m.locator('[data-menue="st-kontingent"]').click();
  await expect(leiste(page)).toBeVisible();
  await expect(m).toHaveCount(0);
});

test("Rechtsklick-Menü: Esc schließt, ein Klick daneben schließt; das Menü bleibt im Fenster", async ({ page }) => {
  await start(page, { breite: 900 });
  const status = page.locator("#status");
  await status.click({ button: "right", position: { x: 880, y: 12 } });
  const m = page.locator('[data-kt="statusmenue"]');
  await expect(m).toBeVisible();
  const b = await m.boundingBox();
  expect(b.x + b.width).toBeLessThanOrEqual(900);
  expect(b.x).toBeGreaterThanOrEqual(0);
  await page.keyboard.press("Escape");
  await expect(m).toHaveCount(0);
  await status.click({ button: "right", position: { x: 100, y: 12 } });
  await expect(m).toBeVisible();
  await page.mouse.click(400, 300);
  await expect(m).toHaveCount(0);
});

// ---------------------------------------------------------------------- Takt: nur bei sichtbarem Fenster
test("Takt: ein verdecktes Fenster fragt nicht, das Sichtbarwerden frischt auf (aktiviert=1)", async ({ page }) => {
  const { kt } = await start(page, { konten: [PRIVAT, CODEX], werte: { k_aaaa0001: Z.claudeOk(42, 18), k_aaaa0003: Z.codexOk(9, 71) } });
  await expect.poll(() => kt.log("GET").length).toBeGreaterThan(0);
  const vorher = kt.anfragen.length;
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForTimeout(400);
  expect(kt.anfragen.length, "verdeckt: keine Abfrage").toBe(vorher);
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect.poll(() => kt.anfragen.length).toBe(vorher + 1);
  expect(kt.anfragen.at(-1).body).toEqual({ neu: null, aktiviert: "1" });
});

// ---------------------------------------------------------------------- Einstellungen → Kontingent
test("Unterbereich „Kontingent“: Schalter für Statusleiste, Anzeige und Mitteilung bei 80 und 100 % — dieselben Daten wie das Popover (hell und dunkel)", async ({ page }) => {
  await start(page, { konten: [PRIVAT, CODEX], werte: { k_aaaa0001: Z.claudeOk(42, 18), k_aaaa0003: Z.codexOk(9, 71) }, hash: "#einstellungen/ki?ziel=ki-kontingent" });
  const o = page.locator('[data-kx="kontingent-optionen"]');
  await expect(o).toBeVisible();
  await expect(o.locator('[data-kx="kt-statusleiste"]')).toHaveAttribute("aria-checked", "true");
  await expect(o.locator('[data-kx="kt-mitteilung"]')).toHaveAttribute("aria-checked", "true");
  await expect(o.locator('[data-kx="kt-anzeige"] [data-wert="verbraucht"]')).toHaveAttribute("aria-checked", "true");
  await expect(spalte(page, "k_aaaa0001").locator('[data-fenster="session"] .kt-prozent')).toHaveText("42 %");
  await foto(page, "einstellungen-optionen-hell");
  await o.locator('[data-kx="kt-mitteilung"]').click();
  await expect.poll(async () => (await (await page.request.get(server.url + "api/einstellungen")).json()).werte.mitteilungenKontingent).toBe(false);
  await o.locator('[data-kx="kt-statusleiste"]').click();
  await expect(leiste(page)).toBeHidden();
  await o.locator('[data-kx="kt-statusleiste"]').click();
  await expect(leiste(page)).toBeVisible();
  await page.emulateMedia({ colorScheme: "dark" });
  await foto(page, "einstellungen-optionen-dunkel");
  // die Zeile unter „Mitteilungen“ zeigt denselben Wert (eine Quelle)
  await page.evaluate(() => { location.hash = "#einstellungen/mitteilungen"; });
  await expect(page.locator('[data-zeile="m-kontingent"] [role="switch"]')).toHaveAttribute("aria-checked", "false");
});
