// Editor „Tastenkürzel“ (Paket P10) in den Einstellungen, gegen die echte Werkstatt mit Wegwerf-Vault und eigenem Support-Ordner (nie die echten Orte des Rechners):
// Liste nach Gruppen aus dem Register, Suche und Filter, Aufnahme (live, Esc, ⌫), Konflikt („⌘K gehört schon zu …“, Abbrechen / Trotzdem nehmen), reservierte Kürzel (⌘Q, ⌘Tab, ⌘Leertaste),
// Zurücksetzen je Zeile und für alle, live wirksam ohne Neustart (Studio und Palette), Änderung von außen (die App), globale Kürzel mit der App (Attrappe des Nachrichtenkanals),
// hell und dunkel. UI_SHOTS=<Ordner>: legt die Bildschirmfotos dort ab (sonst screenshots/, ignoriert).
import { test, expect } from "./basis.mjs";
import { join } from "node:path";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";

const REGISTER = JSON.parse(readFileSync(new URL("../../Ressourcen/gemeinsam/tastenkuerzel-register.json", import.meta.url), "utf8"));
const BEFEHLE = REGISTER.befehle.length;

let vault, server;
test.beforeEach(async () => {
  ({ vault } = baueVault());
  server = await starteServer(vault);
});
test.afterEach(() => server?.stopp());

const shot = (name) => join(process.env.UI_SHOTS || "screenshots", `kz-${name}.png`);
const foto = async (page, name) => { await page.waitForTimeout(450); await page.screenshot({ path: shot(name) }); };
const datei = () => join(server.support, "tastenkuerzel.json");
const gespeichert = () => (existsSync(datei()) ? JSON.parse(readFileSync(datei(), "utf8")).kuerzel : {});
const seite = (page) => page.locator("[data-einstellungen]");
const zeile = (page, id) => page.locator(`[data-zeile="kz-${id}"]`);
const feld = (page, id) => zeile(page, id).locator(".kz-feld");
const tasten = (page, id) => feld(page, id).locator("kbd");
const meldung = (page, id) => zeile(page, id).locator(".kz-meldung");
const wartePut = (page) => page.waitForResponse((r) => r.url().includes("/api/tastenkuerzel") && r.request().method() === "PUT");

async function start(page, { breite = 1440, hoehe = 900, dunkel = false, init = null } = {}) {
  await page.setViewportSize({ width: breite, height: hoehe });
  if (dunkel) await page.emulateMedia({ colorScheme: "dark" });
  if (init) await page.addInitScript(init);
  await page.goto(server.url);
  await page.waitForSelector("#app:not([hidden])");
  await expect(page.locator("#vault-name")).toBeVisible();
  await page.waitForFunction(() => window.__studioBereit === true);
}
const oeffne = async (page) => {
  await page.evaluate(() => { location.hash = "#einstellungen/tasten"; });
  await expect(seite(page)).toBeVisible();
  await expect(page.locator('.e-punkt[data-bereich="tasten"][aria-current="true"]')).toBeVisible();
  await expect(zeile(page, "neue-notiz")).toBeVisible();
};
// Eine Kombination aufnehmen: Klick, dann Tasten (Playwright schickt echte Tastenereignisse; „Meta“ = ⌘ wie in den übrigen Tests)
async function nimmAuf(page, id, kombination) {
  await feld(page, id).click();
  await expect(feld(page, id)).toHaveAttribute("data-zustand", "aufnahme");
  await page.keyboard.press(kombination);
}

test("Liste: eine Zeile je Befehl des Registers, nach Gruppen, mit dem Standardkürzel; globale tragen die Marke „global“", async ({ page }) => {
  await start(page);
  await oeffne(page);
  await expect(page.locator('[data-bereich="tasten"] [data-zeile]')).toHaveCount(BEFEHLE);
  await expect(page.locator('[data-bereich="tasten"] .ez-abschnitt h2')).toHaveText(REGISTER.gruppen.map((g) => g.name));
  await expect(tasten(page, "neue-notiz")).toHaveText(["⌘", "N"]);
  await expect(tasten(page, "schnell-merken")).toHaveText(["⇧", "⌘", "M"]);
  await expect(tasten(page, "info")).toHaveText(["⌥", "⌘", "I"]);
  await expect(tasten(page, "vault-wechseln")).toHaveText(["⌃", "⌘", "V"]);
  await expect(tasten(page, "schnell-erfassen")).toHaveText(["⌃", "⌥", "Leertaste"]);
  await expect(zeile(page, "schnell-erfassen").locator('[data-marke="global"]')).toHaveText("global");
  await expect(zeile(page, "neue-notiz").locator('[data-marke="global"]')).toHaveCount(0);
  // ohne Kürzel ab Werk
  await expect(feld(page, "frage-global")).toHaveAttribute("data-zustand", "leer");
  await expect(feld(page, "frage-global")).toHaveText("Kürzel festlegen");
  await expect(zeile(page, "neue-notiz").locator(".kz-zurueck")).toBeHidden();
  await expect(page.locator('[data-aktion="kz-alle-zurueck"]')).toBeDisabled();
});

test("Aufnahme: Klick, Tasten live (erst ⌘, dann ⌘⇧), Kombination speichert sofort in tastenkuerzel.json — Esc bricht ab, nichts wird geschrieben", async ({ page }) => {
  await start(page);
  await oeffne(page);
  await feld(page, "neue-notiz").click();
  await expect(feld(page, "neue-notiz")).toHaveAttribute("data-zustand", "aufnahme");
  await expect(feld(page, "neue-notiz")).toHaveText("Kombination drücken …");
  await page.keyboard.down("Meta");
  await expect(tasten(page, "neue-notiz")).toHaveText(["⌘"]);
  await page.keyboard.down("Shift");
  await expect(tasten(page, "neue-notiz")).toHaveText(["⇧", "⌘"]);
  await page.keyboard.up("Shift");
  await expect(tasten(page, "neue-notiz")).toHaveText(["⌘"]);
  await page.keyboard.up("Meta");
  await expect(feld(page, "neue-notiz")).toHaveText("Kombination drücken …");
  // Esc bricht ab und schließt NICHT die Seite
  await page.keyboard.press("Escape");
  await expect(feld(page, "neue-notiz")).toHaveAttribute("data-zustand", "belegt");
  await expect(tasten(page, "neue-notiz")).toHaveText(["⌘", "N"]);
  await expect(seite(page)).toBeVisible();
  expect(existsSync(datei())).toBe(false);
  // eine neue Kombination
  const put = wartePut(page);
  await nimmAuf(page, "neue-notiz", "Meta+Shift+j");
  const r = await put;
  expect(r.status()).toBe(200);
  expect(JSON.parse(r.request().postData())).toMatchObject({ werte: { "neue-notiz": "Shift+Cmd+J" } });
  await expect(tasten(page, "neue-notiz")).toHaveText(["⇧", "⌘", "J"]);
  await expect(feld(page, "neue-notiz")).toHaveAttribute("data-zustand", "belegt");
  await expect(page.locator(".e-stand .an-gespeichert")).toBeVisible();
  expect(gespeichert()).toEqual({ "neue-notiz": "Shift+Cmd+J" });
  await expect(zeile(page, "neue-notiz").locator(".kz-zurueck")).toBeVisible();
  await foto(page, "01-aufgenommen-hell");
});

test("Entfernen: ⌫ nimmt das Kürzel weg („Kürzel festlegen“), gespeichert als null; zurücksetzen holt den Standard", async ({ page }) => {
  await start(page);
  await oeffne(page);
  const put = wartePut(page);
  await feld(page, "palette").click();
  await page.keyboard.press("Backspace");
  await put;
  await expect(feld(page, "palette")).toHaveText("Kürzel festlegen");
  expect(gespeichert()).toEqual({ palette: null });
  await expect(page.locator(".toast, [data-toast]").first()).toContainText("entfernt");
  // im Studio gilt es sofort nicht mehr
  await page.keyboard.press("Escape");
  await expect(seite(page)).toBeHidden();
  await page.keyboard.press("Meta+k");
  await expect(page.locator(".palette")).toHaveCount(0);
  await page.evaluate(() => { location.hash = "#einstellungen/tasten"; });
  await expect(zeile(page, "palette")).toBeVisible();
  const put2 = wartePut(page);
  await zeile(page, "palette").locator(".kz-zurueck").click();
  await put2;
  await expect(tasten(page, "palette")).toHaveText(["⌘", "K"]);
  expect(existsSync(datei())).toBe(false); // nichts Eigenes mehr: die Datei verschwindet
});

test("Konflikt: „⌘K gehört schon zu „Befehlspalette“.“ mit Abbrechen / Trotzdem nehmen; Abbrechen ändert nichts, Trotzdem speichert, die Zeilen zeigen „Doppelt belegt“", async ({ page }) => {
  await start(page);
  await oeffne(page);
  await nimmAuf(page, "neue-notiz", "Meta+k");
  const m = meldung(page, "neue-notiz");
  await expect(m).toBeVisible();
  await expect(m).toHaveAttribute("data-art", "konflikt");
  await expect(m.locator("[data-feld=meldung]")).toHaveText("⌘K gehört schon zu „Befehlspalette“.");
  await expect(tasten(page, "neue-notiz")).toHaveText(["⌘", "N"], "bis zur Entscheidung gilt das alte");
  expect(existsSync(datei())).toBe(false);
  await foto(page, "02-konflikt-hell");
  await m.locator('[data-aktion="kz-abbrechen"]').click();
  await expect(m).toBeHidden();
  expect(existsSync(datei())).toBe(false);
  // noch einmal, jetzt trotzdem
  await nimmAuf(page, "neue-notiz", "Meta+k");
  const put = wartePut(page);
  await m.locator('[data-aktion="kz-trotzdem"]').click();
  await put;
  await expect(tasten(page, "neue-notiz")).toHaveText(["⌘", "K"]);
  await expect(m).toBeHidden();
  expect(gespeichert()).toEqual({ "neue-notiz": "Cmd+K" });
  await expect(zeile(page, "neue-notiz").locator('[data-marke="doppelt"]')).toBeVisible();
  await expect(zeile(page, "palette").locator('[data-marke="doppelt"]')).toBeVisible();
  await expect(zeile(page, "palette").locator('[data-marke="doppelt"]')).toHaveAttribute("title", /Neue Notiz/);
  // Filter „Konflikte“ zeigt genau diese beiden
  await page.locator('[data-kz-filter="konflikte"]').click();
  await expect(page.locator('[data-bereich="tasten"] [data-zeile]:visible')).toHaveCount(2);
  await foto(page, "03-konflikte-gefiltert-hell");
  // das geänderte Kürzel hat Vorrang: ⌘K öffnet jetzt „Neue Notiz“, nicht die Palette
  await page.keyboard.press("Escape");
  await expect(seite(page)).toBeHidden();
  await page.keyboard.press("Meta+k");
  await expect(page.locator('.dialog [data-feld="titel"]')).toBeVisible();
  await expect(page.locator(".palette")).toHaveCount(0);
});

test("Reservierte Kürzel werden abgelehnt (⌘Q, ⌘Tab, ⌘Leertaste, ⌘E) und ohne ⌃/⌘ gibt es einen Hinweis — die Aufnahme bleibt offen, nichts wird gespeichert", async ({ page }) => {
  await start(page);
  await oeffne(page);
  await feld(page, "neue-notiz").click();
  const m = meldung(page, "neue-notiz");
  await page.keyboard.press("Meta+q");
  await expect(m).toHaveAttribute("data-art", "fehler");
  await expect(m).toContainText("⌘Q gehört macOS („Kortex beenden“)");
  await expect(feld(page, "neue-notiz")).toHaveAttribute("data-zustand", "aufnahme");
  await page.keyboard.press("Meta+Tab");
  await expect(m).toContainText("⌘Tab gehört macOS");
  await page.keyboard.press("Meta+Space");
  await expect(m).toContainText("⌘Leertaste gehört macOS („Spotlight“)");
  await page.keyboard.press("Meta+e");
  await expect(m).toContainText("⌘E ist in Kortex fest vergeben („Kortex einrichten“)");
  await foto(page, "04-reserviert-hell");
  await page.keyboard.press("Shift+j");
  await expect(m).toContainText("⌃ (Control) oder ⌘");
  expect(existsSync(datei())).toBe(false);
  // eine gültige Kombination danach klappt, die Meldung geht weg
  const put = wartePut(page);
  await page.keyboard.press("Meta+Shift+u");
  await put;
  await expect(m).toBeHidden();
  await expect(tasten(page, "neue-notiz")).toHaveText(["⇧", "⌘", "U"]);
});

test("Live wirksam ohne Neustart: das neue Kürzel löst den Befehl aus, das alte nicht mehr; die Palette zeigt das neue", async ({ page }) => {
  await start(page);
  await oeffne(page);
  const put = wartePut(page);
  await nimmAuf(page, "neue-notiz", "Meta+Shift+j");
  await put;
  await page.keyboard.press("Escape");
  await expect(seite(page)).toBeHidden();
  await page.keyboard.press("Meta+n");
  await expect(page.locator(".dialog")).toHaveCount(0); // das alte gilt nicht mehr
  await page.keyboard.press("Meta+Shift+j");
  await expect(page.locator('.dialog [data-feld="titel"]')).toBeVisible(); // das neue öffnet „Neue Notiz“
  await page.keyboard.press("Escape");
  await expect(page.locator(".dialog")).toHaveCount(0);
  await page.keyboard.press("Meta+k");
  const eintrag = page.locator('.pal-eintrag[data-pal="befehl"]', { hasText: "Neue Notiz" });
  await expect(eintrag.locator(".r")).toHaveText("⇧⌘J");
  await page.keyboard.press("Escape");
  // die Übersicht ⌘/ zeigt es ebenfalls
  await page.keyboard.press("Meta+/");
  await expect(page.locator(".dialog .kuerzel")).toContainText("Neue Notiz");
  await expect(page.locator(".dialog .kuerzel dt", { has: page.locator("kbd", { hasText: "J" }) })).toHaveCount(2); // ⌘J (Frag) und ⇧⌘J (Neue Notiz)
  // nach dem Neuladen gilt es weiter (aus der Datei)
  await page.keyboard.press("Escape");
  await page.reload();
  await page.waitForFunction(() => window.__studioBereit === true);
  await page.keyboard.press("Meta+Shift+j");
  await expect(page.locator('.dialog [data-feld="titel"]')).toBeVisible();
});

test("Zurücksetzen: je Zeile und „Alle zurücksetzen“ (mit Rückfrage)", async ({ page }) => {
  await start(page);
  await oeffne(page);
  for (const [id, kombi] of [["neue-notiz", "Meta+Shift+j"], ["info", "Meta+Alt+u"], ["speichern", "Meta+Shift+s"]]) {
    const put = wartePut(page);
    await nimmAuf(page, id, kombi);
    await put;
  }
  expect(Object.keys(gespeichert()).sort()).toEqual(["info", "neue-notiz", "speichern"]);
  await expect(page.locator('[data-aktion="kz-alle-zurueck"]')).toBeEnabled();
  // je Zeile
  const put1 = wartePut(page);
  await zeile(page, "info").locator(".kz-zurueck").click();
  await put1;
  await expect(tasten(page, "info")).toHaveText(["⌥", "⌘", "I"]);
  expect(Object.keys(gespeichert()).sort()).toEqual(["neue-notiz", "speichern"]);
  // alle: erst die Rückfrage
  await page.locator('[data-aktion="kz-alle-zurueck"]').click();
  await expect(page.locator(".dialog")).toContainText("2 geänderte Kürzel gehen auf den Anfang zurück");
  await page.locator(".dialog").getByRole("button", { name: "Abbrechen" }).click();
  expect(Object.keys(gespeichert()).length).toBe(2);
  await page.locator('[data-aktion="kz-alle-zurueck"]').click();
  const put2 = wartePut(page);
  await page.locator('[data-aktion="kz-alle-ja"]').click();
  await put2;
  await expect(tasten(page, "neue-notiz")).toHaveText(["⌘", "N"]);
  await expect(tasten(page, "speichern")).toHaveText(["⌘", "S"]);
  expect(existsSync(datei())).toBe(false);
  await expect(page.locator('[data-aktion="kz-alle-zurueck"]')).toBeDisabled();
});

test("Suche und Filter: Befehl suchen (auch nach Kürzel), Alle / Geändert / Ohne / Konflikte, leere Ergebnisse sagen es", async ({ page }) => {
  await start(page);
  await oeffne(page);
  const sichtbar = page.locator('[data-bereich="tasten"] [data-zeile]:visible');
  await page.locator('input[data-kz="suche"]').fill("posteingang");
  await expect(zeile(page, "gehe-posteingang")).toBeVisible();
  await expect(zeile(page, "schnell-merken")).toBeVisible(); // steht im Text
  await expect(zeile(page, "neue-notiz")).toBeHidden();
  const n = await sichtbar.count();
  expect(n).toBe(2);
  expect(n).toBeLessThan(BEFEHLE);
  await page.locator('input[data-kz="suche"]').fill("⇧⌘M");
  await expect(sichtbar).toHaveCount(1);
  await expect(zeile(page, "schnell-merken")).toBeVisible();
  await page.locator('input[data-kz="suche"]').fill("zzzz");
  await expect(page.locator('[data-kz="leer"]')).toHaveText("Kein Befehl passt.");
  await expect(page.locator('[data-bereich="tasten"] .ez-abschnitt:visible')).toHaveCount(0); // leere Gruppen verschwinden
  await page.locator('input[data-kz="suche"]').fill("");
  await expect(sichtbar).toHaveCount(BEFEHLE);
  // Ohne: genau die Befehle ohne Kürzel ab Werk
  await page.locator('[data-kz-filter="ohne"]').click();
  await expect(sichtbar).toHaveCount(REGISTER.befehle.filter((b) => !b.standard).length);
  // Geändert: ohne Änderung leer, danach genau die eine Zeile
  await page.locator('[data-kz-filter="geaendert"]').click();
  await expect(page.locator('[data-kz="leer"]')).toHaveText("Du hast noch kein Kürzel geändert.");
  await page.locator('[data-kz-filter="alle"]').click();
  const put = wartePut(page);
  await nimmAuf(page, "kuerzel-hilfe", "Meta+Shift+/");
  await put;
  await page.locator('[data-kz-filter="geaendert"]').click();
  await expect(sichtbar).toHaveCount(1);
  await expect(zeile(page, "kuerzel-hilfe")).toBeVisible();
  await page.locator('[data-kz-filter="konflikte"]').click();
  await expect(page.locator('[data-kz="leer"]')).toHaveText("Kein Kürzel ist doppelt belegt.");
  // die Suche der ganzen Seite findet die Befehle ebenfalls
  await page.locator('[data-kz-filter="alle"]').click();
  await page.locator('[data-einst="suche"]').fill("Befehlspalette");
  await expect(zeile(page, "palette")).toBeVisible();
  await expect(page.locator('[data-bereich="tasten"] .kz-leiste')).toBeHidden();
});

test("Änderung von außen (die App oder ein zweites Fenster schreibt tastenkuerzel.json) gilt sofort: Seite und Studio führen nach; ein Speichern mit altem Stand → Hinweis und neu geladen", async ({ page }) => {
  await start(page);
  await oeffne(page);
  writeFileSync(datei(), JSON.stringify({ schema: 1, kuerzel: { info: "Alt+Cmd+J" } }));
  await expect(tasten(page, "info")).toHaveText(["⌥", "⌘", "J"], { timeout: 8000 });
  await expect(zeile(page, "info").locator(".kz-zurueck")).toBeVisible();
  // Konflikt der Sperre: Stand veraltet (jemand schreibt, bevor das Ereignis ankam) → die Route lehnt ab, die Seite lädt neu
  await page.route("**/api/tastenkuerzel", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    writeFileSync(datei(), JSON.stringify({ schema: 1, kuerzel: { info: "Alt+Cmd+J", speichern: "Shift+Cmd+S" } }));
    return route.fallback();
  });
  await nimmAuf(page, "neue-notiz", "Meta+Shift+j");
  await expect(page.locator(".toast, [data-toast]").first()).toContainText("woanders geändert");
  await expect(tasten(page, "speichern")).toHaveText(["⇧", "⌘", "S"], { timeout: 8000 });
  await expect(tasten(page, "neue-notiz")).toHaveText(["⌘", "N"]);
});

test("Kaputte Datei: das Studio nutzt die Standardkürzel und überschreibt sie nie", async ({ page }) => {
  writeFileSync(datei(), "{ kein json");
  await start(page);
  await oeffne(page);
  await expect(tasten(page, "neue-notiz")).toHaveText(["⌘", "N"]);
  const put = wartePut(page);
  await nimmAuf(page, "neue-notiz", "Meta+Shift+j");
  expect((await put).status()).toBe(500);
  await expect(tasten(page, "neue-notiz")).toHaveText(["⌘", "N"]);
  expect(readFileSync(datei(), "utf8")).toBe("{ kein json");
});

// ---------------------------------------------------------------- Globale Kürzel mit der App (Attrappe des Nachrichtenkanals window.webkit.messageHandlers.aktion)
const APP_ATTRAPPE = () => {
  window.__aktionen = [];
  window.__globalAntwort = { ok: true };
  window.webkit = { messageHandlers: { aktion: { postMessage: async (n) => { window.__aktionen.push(n); return n.aktion === "kuerzel-global" ? window.__globalAntwort : { ok: true }; } } } };
};

test("Globale Kürzel: die App prüft zuerst (kuerzel-global), meldet „von macOS belegt“ als Hinweis ohne zu speichern; bei Erfolg wird gespeichert und die App liest neu (kuerzel-geaendert)", async ({ page }) => {
  await start(page, { init: APP_ATTRAPPE });
  await oeffne(page);
  // 1) die App lehnt ab
  await page.evaluate(() => { window.__globalAntwort = { ok: false, text: "Dieses Kürzel nutzt macOS bereits („Spotlight-Suche“). Wähle ein anderes oder schalte es in den Tastatur-Einstellungen aus." }; });
  await nimmAuf(page, "schnell-erfassen", "Meta+Alt+k");
  await expect(meldung(page, "schnell-erfassen")).toHaveAttribute("data-art", "fehler");
  await expect(meldung(page, "schnell-erfassen")).toContainText("Spotlight-Suche");
  await expect(tasten(page, "schnell-erfassen")).toHaveText(["⌃", "⌥", "Leertaste"]);
  expect(existsSync(datei())).toBe(false);
  expect(await page.evaluate(() => window.__aktionen.filter((a) => a.aktion === "kuerzel-global"))).toEqual([{ aktion: "kuerzel-global", wert: { id: "schnell-erfassen", kuerzel: "Alt+Cmd+K" } }]);
  await foto(page, "05-global-belegt-hell");
  // 2) die App nimmt an
  await page.evaluate(() => { window.__globalAntwort = { ok: true }; window.__aktionen.length = 0; });
  const put = wartePut(page);
  await nimmAuf(page, "schnell-erfassen", "Meta+Control+j");
  await put;
  await expect(tasten(page, "schnell-erfassen")).toHaveText(["⌃", "⌘", "J"]);
  expect(gespeichert()).toEqual({ "schnell-erfassen": "Ctrl+Cmd+J" });
  expect((await page.evaluate(() => window.__aktionen.map((a) => a.aktion)))).toEqual(["kuerzel-global", "kuerzel-geaendert"]);
  // 3) ein Studio-Kürzel meldet nur „geändert“ (kein globales Kürzel zu prüfen)
  await page.evaluate(() => { window.__aktionen.length = 0; });
  const put2 = wartePut(page);
  await nimmAuf(page, "neue-notiz", "Meta+Shift+j");
  await put2;
  expect((await page.evaluate(() => window.__aktionen.map((a) => a.aktion)))).toEqual(["kuerzel-geaendert"]);
  // 4) zurücksetzen eines globalen Kürzels fragt die App nach dem Standard
  await page.evaluate(() => { window.__aktionen.length = 0; });
  const put3 = wartePut(page);
  await zeile(page, "schnell-erfassen").locator(".kz-zurueck").click();
  await put3;
  expect(await page.evaluate(() => window.__aktionen[0])).toEqual({ aktion: "kuerzel-global", wert: { id: "schnell-erfassen", kuerzel: "Ctrl+Alt+Space" } });
  await expect(tasten(page, "schnell-erfassen")).toHaveText(["⌃", "⌥", "Leertaste"]);
  // 5) ein globales Kürzel ohne Kürzel (⌫) meldet die App ab
  await page.evaluate(() => { window.__aktionen.length = 0; });
  const put4 = wartePut(page);
  await feld(page, "schnell-erfassen").click();
  await page.keyboard.press("Backspace");
  await put4;
  expect(await page.evaluate(() => window.__aktionen[0])).toEqual({ aktion: "kuerzel-global", wert: { id: "schnell-erfassen", kuerzel: null } });
  await expect(feld(page, "schnell-erfassen")).toHaveText("Kürzel festlegen");
});

test("Globale Kürzel: die Aufnahme meint den Ort der Taste (macOS meldet sie so) — ⌃⌥⌘ plus Buchstabe, Hell und Dunkel", async ({ page }) => {
  await start(page, { init: APP_ATTRAPPE });
  await oeffne(page);
  const put = wartePut(page);
  // auf einer deutschen Tastatur liegt das „Z“ dort, wo die US-Tastatur das „Y“ hat: e.code ist der Ort („KeyY“), e.key das Zeichen („z“)
  await feld(page, "frage-global").click();
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", code: "KeyY", ctrlKey: true, altKey: true, metaKey: true, bubbles: true, cancelable: true })));
  await put;
  expect(gespeichert()).toEqual({ "frage-global": "Ctrl+Alt+Cmd+Y" });
});

// ---------------------------------------------------------------- Bilder: Hell und Dunkel, Breiten (Runde für Runde im Ordner UI_SHOTS)
for (const dunkel of [false, true]) {
  test(`Bilder ${dunkel ? "dunkel" : "hell"}: Liste, Aufnahme, Konflikt, enge Breite`, async ({ page }) => {
    await start(page, { dunkel, init: APP_ATTRAPPE });
    await oeffne(page);
    const t = dunkel ? "dunkel" : "hell";
    await page.evaluate(() => document.querySelector('[data-einst="inhalt"]').scrollTo(0, 0));
    await foto(page, `10-liste-${t}`);
    // Aufnahme läuft (⌘ gehalten)
    await feld(page, "neue-notiz").click();
    await page.keyboard.down("Meta"); await page.keyboard.down("Shift");
    await foto(page, `11-aufnahme-${t}`);
    await page.keyboard.up("Shift"); await page.keyboard.up("Meta");
    await page.keyboard.press("Escape");
    // Konflikt unter der Zeile
    await nimmAuf(page, "neue-notiz", "Meta+k");
    await zeile(page, "neue-notiz").scrollIntoViewIfNeeded();
    await foto(page, `12-konflikt-${t}`);
    await meldung(page, "neue-notiz").locator('[data-aktion="kz-abbrechen"]').click();
    // global belegt
    await page.evaluate(() => { window.__globalAntwort = { ok: false, text: "Dieses Kürzel nutzt macOS bereits („Spotlight-Suche“)." }; });
    await nimmAuf(page, "frage-global", "Meta+Alt+k");
    await zeile(page, "frage-global").scrollIntoViewIfNeeded();
    await foto(page, `13-global-belegt-${t}`);
    // keine Überläufe, nichts abgeschnitten bei enger Breite
    for (const breite of [1100, 800, 680]) { // Mindestbreite des Fensters ist 1100; darunter nur zur Sicherheit
      await page.setViewportSize({ width: breite, height: 800 });
      await page.waitForTimeout(250);
      const ueber = await page.evaluate(() => {
        const f = [];
        for (const e of document.querySelectorAll('[data-bereich="tasten"] .kz-feld, [data-bereich="tasten"] .kz-meldung, [data-bereich="tasten"] .kz-leiste *')) {
          if (!e.checkVisibility?.()) continue;
          const r = e.getBoundingClientRect();
          if (r.right > innerWidth + 1 || r.left < -1) f.push(`${e.className}: ${Math.round(r.left)}–${Math.round(r.right)} von ${innerWidth}`);
        }
        return f;
      });
      expect(ueber, `Breite ${breite}`).toEqual([]);
      if (breite === 800) await foto(page, `14-eng-${t}`);
      if (breite === 680) await foto(page, `15-sehr-eng-${t}`);
    }
  });
}
