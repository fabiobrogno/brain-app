// „KI verbinden“ (Paket P9): EIN Ablauf (ki-verbinden.js) für Statusleiste, Befehlspalette, Einstellungen und Einrichtungs-Assistent:
// Wählen → Konto (mit Anmelden im Terminal, Abfrage im Hintergrund, abbrechbar) → Stufe je Vault → Prüfen (ein echter, rein lesender Aufruf über den Kortex-Server) → Fertig.
// Hell und dunkel; Anmelden (Attrappe), gesperrtes Konto, fehlgeschlagene Prüfung, Abbruch; Statusleiste ohne Aufblitzen von „KI verbinden“.
// Alle /api/ki/*- und /api/mcp/*-Routen sind Attrappen (mocks-verbinden.mjs); der Rest läuft gegen die echte Werkstatt. Kein Terminal, kein echtes claude, kein echter Ordner.
// UI_P9_BILDER=<Ordner>: legt die Bilder dort ab.
import { test, expect } from "./basis.mjs";
import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { mockeV2 } from "./mocks.mjs";
import { mockeVerbinden } from "./mocks-verbinden.mjs";
import { starteStatisch, mockeEinrichtung } from "./mocks-einrichtung.mjs";

const BILDER = process.env.UI_P9_BILDER;
if (BILDER) mkdirSync(BILDER, { recursive: true });
let vault, server;
test.beforeEach(async () => { ({ vault } = baueVault()); vault = realpathSync(vault); server = await starteServer(vault); });
test.afterEach(() => { server?.stopp(); server = null; });

const NOTIZ = "10_notizen/Reise nach Lissabon.md";
const FIRMA_VAULT = "/Users/test/Firma-Vault";
const K_PRIVAT = { id: "k_p0000001", programm: "claude", programmName: "Claude Code", name: "Privat", standard: true, ordner: "~/.claude", pfad: "/Users/test/.claude", vorhanden: true, verbunden: false };
const K_FIRMA = { id: "k_f0000002", programm: "claude", programmName: "Claude Code", name: "Firma", standard: false, ordner: "~/.claude-firma", pfad: "/Users/test/.claude-firma", vorhanden: true, verbunden: false };
const K_CODEX = { id: "k_c0000003", programm: "codex", programmName: "Codex", name: "Standard", standard: true, ordner: "~/.codex", pfad: "/Users/test/.codex", vorhanden: true, verbunden: true };
const bild = async (page, name, thema) => { if (BILDER) { await page.waitForTimeout(700); await page.screenshot({ path: join(BILDER, `${name}-${thema === "dark" ? "dunkel" : "hell"}.png`) }); } };

// Zugriffe im offenen Vault: Privat „lesen“ (vorbelegt), Firma gesperrt, Codex „posteingang“
const zugriff = () => ({ [K_PRIVAT.id]: { [vault]: "lesen", [FIRMA_VAULT]: "gesperrt" }, [K_FIRMA.id]: { [vault]: "gesperrt", [FIRMA_VAULT]: "gesperrt" }, [K_CODEX.id]: { [vault]: "posteingang", [FIRMA_VAULT]: "gesperrt" } });
async function start(page, opt = {}, { breite = 1440, hoehe = 900, thema = "light", hash = null } = {}) {
  await page.setViewportSize({ width: breite, height: hoehe });
  await page.emulateMedia({ colorScheme: thema });
  await mockeV2(page, vault);
  const z = await mockeVerbinden(page, { vault, vaults: [{ pfad: vault, name: "Mein Vault" }, { pfad: FIRMA_VAULT, name: "Firma" }], konten: [K_PRIVAT, K_FIRMA, K_CODEX].map((k) => ({ ...k })), zugriff: zugriff(),
    login: { [K_PRIVAT.id]: "angemeldet", [K_FIRMA.id]: "nicht-angemeldet", [K_CODEX.id]: "angemeldet" }, kontingent: { werte: {} }, ...opt });
  await page.goto(server.url + "?pfad=" + encodeURIComponent(NOTIZ));
  await page.waitForSelector("#app:not([hidden])");
  await page.waitForFunction(() => window.__studioBereit === true);
  if (hash) await page.evaluate((hh) => { location.hash = hh; }, hash);
  return z;
}
const dlg = (page) => page.locator('[data-dialog="ki-verbinden"]');
// So öffnet es ein Nutzer: Konto in der Statusleiste → „KI verbinden …“ im Menü (der Eintrag „KI verbinden“ der Statusleiste ist mit Konto ausgeblendet)
const oeffne = async (page) => {
  await page.locator(".kt-leiste:visible, #status [data-st='claude']:visible").first().click();
  const menue = page.locator('[data-aktion="kt-ki-verbinden"]');
  if (await menue.count()) await menue.click();
};
const knopf = (page, a) => dlg(page).locator(`[data-aktion="${a}"]`);
const kopfText = (page) => dlg(page).locator(".kv-kopf");
const weiter = (page) => knopf(page, "ki-weiter").click();
const wahl = async (page, id) => { await dlg(page).locator(`.ka-karte[data-ki="${id}"]`).click(); };
// bis zum Schritt „Stufe“ mit Claude Code (Konto „Privat“, wenn keins genannt)
const zurStufe = async (page, konto = null) => {
  await oeffne(page);
  await expect(dlg(page)).toBeVisible();
  await expect(dlg(page).locator('.ka-karte[data-ki="claude"]')).toHaveAttribute("aria-checked", "true");
  await weiter(page);
  await expect(dlg(page).locator(".kv-konto").first()).toBeVisible();
  if (konto) await dlg(page).locator(`.kv-konto[data-konto="${konto}"]`).click();
  await weiter(page);
  await expect(dlg(page).locator('[data-kv="stufe"]')).toBeVisible();
};
const stufeWert = (page) => dlg(page).locator('[data-kv="stufe"] [aria-checked="true"]');

for (const thema of ["light", "dark"]) {
  test.describe(`Darstellung ${thema}`, () => {
    test.use({ colorScheme: thema });

    test("Ablauf: Wählen → Konto → Stufe (vorbelegt) → Prüfen → Fertig; geschrieben wird erst bei „Verbinden“, geprüft wird mit dem gewählten Konto", async ({ page }) => {
      const z = await start(page, {}, { thema });
      await oeffne(page);
      await expect(dlg(page)).toBeVisible();
      // 1 Wählen: gefundene Programme oben als Karten, Claude Code vorgewählt, Codex als „Verbunden“ markiert
      await expect(dlg(page).locator("[data-ki-auswahl] .ka-karte")).toHaveCount(4);
      await expect(dlg(page).locator('.ka-karte[data-ki="claude"]')).toHaveAttribute("aria-checked", "true");
      await expect(dlg(page).locator('.ka-karte[data-ki="codex"] [data-verbunden="true"]')).toContainText("Verbunden");
      await expect(kopfText(page)).toContainText("1 von 4");
      await bild(page, "1-waehlen", thema);
      await weiter(page);
      // 2 Konto: vorhandene Konten, das Standardkonto gewählt und angemeldet
      await expect(dlg(page).locator(".kv-konto")).toHaveCount(2);
      await expect(dlg(page).locator(`.kv-konto[data-konto="${K_PRIVAT.id}"]`)).toHaveAttribute("aria-checked", "true");
      await expect(dlg(page).locator(`.kv-konto[data-konto="${K_PRIVAT.id}"] .kv-marke`)).toHaveText("Angemeldet");
      await expect(dlg(page).locator(`.kv-konto[data-konto="${K_FIRMA.id}"] .kv-marke`)).toHaveText("Nicht angemeldet");
      await expect(dlg(page).locator('[data-kv="angemeldet"]')).toContainText("Privat ist angemeldet");
      await expect(kopfText(page)).toContainText("2 von 4");
      await bild(page, "2-konto", thema);
      await weiter(page);
      // 3 Stufe: vorbelegt mit der jetzigen Stufe („Lesen“), die anderen Vaults mit ihrer Stufe; noch nichts geschrieben
      await expect(stufeWert(page)).toHaveText("Lesen");
      await expect(dlg(page).locator('[data-kv="andere-vaults"] li[data-stufe="gesperrt"]')).toContainText("Firma");
      await expect(kopfText(page)).toContainText("3 von 4");
      await bild(page, "3-stufe", thema);
      expect(z.log("/api/mcp/verbinden")).toHaveLength(0);
      await knopf(page, "ki-verbinden").click();
      // 4 Prüfen → 5 Fertig
      await expect(dlg(page).locator('[data-kv="fertig"]')).toBeVisible({ timeout: 10000 });
      await expect(dlg(page).locator('[data-kv="fertig"]')).toContainText("Claude Code ist verbunden");
      await expect(dlg(page).locator('[data-bereich="probe-ergebnis"]')).toContainText("Claude Code sieht deinen Vault");
      expect(z.log("/api/mcp/verbinden")).toEqual([{ methode: "POST", pfad: "/api/mcp/verbinden", body: { ziel: "claude", konto: K_PRIVAT.id, zugriff: "lesen" } }]); // vorbelegt, nicht ausdrücklich
      expect(z.log("/api/mcp/pruefen")).toEqual([{ methode: "POST", pfad: "/api/mcp/pruefen", body: { konto: K_PRIVAT.id } }]);
      await bild(page, "5-fertig", thema);
      await knopf(page, "ki-fertig").click();
      await expect(dlg(page)).toHaveCount(0);
    });

    test("Prüfen: vier Zeilen mit Haken, am Ende „… sieht deinen Vault“ (Zwischenstand)", async ({ page }) => {
      const z = await start(page, { verzoegerung: 1500 }, { thema });
      await zurStufe(page);
      await knopf(page, "ki-verbinden").click();
      await expect(dlg(page).locator('[data-kv="schritte-lauf"] li')).toHaveCount(4);
      await expect(dlg(page).locator('[data-kv="schritte-lauf"] li[data-s="probe"][data-zustand="laeuft"]')).toBeVisible();
      await expect(dlg(page).locator('[data-kv="schritte-lauf"] li[data-s="eintragen"]')).toHaveAttribute("data-zustand", "ok");
      await bild(page, "4-pruefen", thema);
      await expect(dlg(page).locator('[data-kv="fertig"]')).toBeVisible({ timeout: 10000 });
      expect(z.log("/api/mcp/pruefen")).toHaveLength(1);
    });

    test("Anmelden: Konto nicht angemeldet → „Im Terminal anmelden …“, Abfrage im Hintergrund bis angemeldet; „Weiter“ wartet solange", async ({ page }) => {
      const z = await start(page, {}, { thema });
      await oeffne(page);
      await weiter(page);
      await dlg(page).locator(`.kv-konto[data-konto="${K_FIRMA.id}"]`).click();
      await expect(dlg(page).locator('[data-kv="nicht-angemeldet"]')).toContainText("Firma ist noch nicht angemeldet");
      await bild(page, "2b-nicht-angemeldet", thema);
      await dlg(page).locator('[data-aktion="konto-anmelden"]').click();
      await expect(dlg(page).locator('[data-kv="anmelden"] [data-kx="befehl"]')).toContainText("claude auth login");
      expect(z.kz.log("/api/ki/anmelden")).toEqual([{ methode: "POST", pfad: "/api/ki/anmelden", body: { programm: "claude", ordner: "/Users/test/.claude-firma" } }]);
      await expect(dlg(page).locator('[data-kv="anmelden"] .kx-schritt.laeuft')).toBeVisible();
      await expect(knopf(page, "ki-weiter")).toBeDisabled(); // wartet auf die Anmeldung
      await bild(page, "2c-anmelden-wartet", thema);
      // das Terminal ist durch: der nächste Abruf meldet „angemeldet“ (ohne die 3 Sekunden abzuwarten: „Jetzt prüfen“)
      z.kz.login[K_FIRMA.id] = "angemeldet";
      await dlg(page).locator('[data-aktion="anmelden-pruefen"]').click();
      await expect(dlg(page).locator('[data-kv="angemeldet"]')).toContainText("Firma ist angemeldet", { timeout: 8000 });
      await expect(dlg(page).locator(`.kv-konto[data-konto="${K_FIRMA.id}"] .kv-marke`)).toHaveText("Angemeldet");
      await expect(knopf(page, "ki-weiter")).toBeEnabled();
      expect(z.kz.log("/api/ki/anmeldestatus").length).toBeGreaterThan(0);
      expect(z.log("/api/mcp/verbinden")).toHaveLength(0);
    });

    test("Anmelden abbrechen: die Abfrage hört auf, das Konto bleibt „nicht angemeldet“, der Ablauf geht weiter", async ({ page }) => {
      const z = await start(page, {}, { thema });
      await oeffne(page);
      await weiter(page);
      await dlg(page).locator(`.kv-konto[data-konto="${K_FIRMA.id}"]`).click();
      await dlg(page).locator('[data-aktion="konto-anmelden"]').click();
      await expect(dlg(page).locator('[data-kv="anmelden"]')).toBeVisible();
      await dlg(page).locator('[data-aktion="anmelden-abbrechen"]').click();
      await expect(dlg(page).locator('[data-kv="anmelden"]')).toHaveCount(0);
      await expect(dlg(page).locator('[data-kv="nicht-angemeldet"]')).toBeVisible();
      await expect(knopf(page, "ki-weiter")).toBeEnabled();
      const n = z.kz.log("/api/ki/anmeldestatus").length;
      await page.waitForTimeout(3600); // länger als ein Abfragetakt
      expect(z.kz.log("/api/ki/anmeldestatus").length).toBe(n);
    });

    test("Gesperrtes Konto bleibt gesperrt, solange du keine Stufe wählst; die Prüfung sagt es klar; „Stufe ändern“ → „Lesen“ → verbunden", async ({ page }) => {
      const z = await start(page, {}, { thema });
      await zurStufe(page, K_FIRMA.id);
      await expect(stufeWert(page)).toHaveText("Gesperrt");
      await expect(dlg(page).locator('[data-bereich="gesperrt"]')).toContainText("bleibt es, bis du selbst eine Stufe wählst");
      await bild(page, "3b-gesperrt", thema);
      await knopf(page, "ki-verbinden").click();
      await expect(dlg(page).locator('[data-kv="fehler"]')).toContainText("sieht deinen Vault nicht", { timeout: 10000 });
      await expect(dlg(page).locator('[data-kv="fehler"]')).toHaveAttribute("data-art", "kein-zugriff");
      await bild(page, "4b-kein-zugriff", thema);
      expect(z.log("/api/mcp/verbinden")[0].body).toEqual({ ziel: "claude", konto: K_FIRMA.id }); // keine Stufe: die Sperre bleibt
      expect(z.kz.zugriff[K_FIRMA.id][vault]).toBe("gesperrt");
      await knopf(page, "ki-stufe-aendern").click();
      await expect(dlg(page).locator('[data-kv="stufe"]')).toBeVisible();
      await dlg(page).locator('[data-kv="stufe"] [data-wert="lesen"]').click();
      await knopf(page, "ki-verbinden").click();
      await expect(dlg(page).locator('[data-kv="fertig"]')).toBeVisible({ timeout: 10000 });
      expect(z.log("/api/mcp/verbinden")[1].body).toEqual({ ziel: "claude", konto: K_FIRMA.id, zugriff: "lesen", zugriffAusdruecklich: true }); // jetzt ausdrücklich
      expect(z.kz.zugriff[K_FIRMA.id][vault]).toBe("lesen");
    });

    test("Fehlgeschlagene Prüfung: klarer Fehler mit dem nächsten Schritt, „Nochmal prüfen“ läuft erneut", async ({ page }) => {
      const z = await start(page, { pruefen: "fehler" }, { thema });
      await zurStufe(page);
      await knopf(page, "ki-verbinden").click();
      await expect(dlg(page).locator('[data-kv="fehler"]')).toContainText("hat nicht geantwortet", { timeout: 10000 });
      await expect(dlg(page).locator('[data-kv="schritte-lauf"] li[data-s="eintragen"]')).toHaveAttribute("data-zustand", "ok"); // eingetragen ist es
      await expect(dlg(page).locator('[data-kv="schritte-lauf"] li[data-s="probe"]')).toHaveAttribute("data-zustand", "fehler");
      await bild(page, "4c-pruefen-fehlt", thema);
      z.pruefen = null;
      await knopf(page, "ki-nochmal").click();
      await expect(dlg(page).locator('[data-kv="fertig"]')).toBeVisible({ timeout: 10000 });
      expect(z.log("/api/mcp/pruefen")).toHaveLength(2);
    });

    test("Abbrechen: Esc und „Abbrechen“ schließen, es wird nichts geschrieben; während der Prüfung gilt es auch", async ({ page }) => {
      const z = await start(page, { verzoegerung: 3000 }, { thema });
      await oeffne(page);
      await expect(dlg(page)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dlg(page)).toHaveCount(0);
      await oeffne(page);
      await knopf(page, "ki-abbrechen").click();
      await expect(dlg(page)).toHaveCount(0);
      expect(z.log("/api/mcp/verbinden")).toHaveLength(0);
      await zurStufe(page);
      await knopf(page, "ki-verbinden").click();
      await expect(dlg(page).locator('[data-kv="schritte-lauf"]')).toBeVisible();
      await knopf(page, "ki-abbrechen").click();
      await expect(dlg(page)).toHaveCount(0);
    });
  });
}

test("Fremder Eintrag „brain“: Rückfrage, „Nicht ändern“ geht zurück, „Umstellen“ schickt umstellen; ohne Programm im PATH ein Befehl zum Kopieren", async ({ page }) => {
  const z = await start(page, { mcp: "anders" });
  await zurStufe(page);
  await knopf(page, "ki-verbinden").click();
  await expect(dlg(page).locator('[data-bereich="umstellen"]')).toContainText("schon einen Eintrag „brain“");
  await dlg(page).locator('[data-aktion="nicht-umstellen"]').click();
  await expect(dlg(page).locator('[data-kv="stufe"]')).toBeVisible();
  await knopf(page, "ki-verbinden").click();
  await dlg(page).locator('[data-aktion="umstellen"]').click();
  await expect(dlg(page).locator('[data-kv="fertig"]')).toBeVisible({ timeout: 10000 });
  expect(z.log("/api/mcp/verbinden").map((a) => a.body.umstellen === true)).toEqual([false, false, true]);
  // Befehl zum Kopieren
  z.mcp = "befehl";
  await dlg(page).locator('[data-aktion="ki-weitere"]').click();
  await wahl(page, "claude");
  await weiter(page); await weiter(page);
  await knopf(page, "ki-verbinden").click();
  await expect(dlg(page).locator('[data-bereich="befehl"] code')).toContainText("claude mcp add brain");
});

test("Programm ohne Konto (Gemini CLI): kein Schritt „Konto“, Stufe mit Hinweis ohne Leseverbot, „Erweitert“ nur mit Claude Code", async ({ page }) => {
  const z = await start(page);
  await oeffne(page);
  await wahl(page, "gemini");
  await expect(kopfText(page)).toContainText("1 von 3");
  await weiter(page);
  await expect(dlg(page).locator('[data-kv="stufe"]')).toBeVisible();
  await expect(kopfText(page)).toContainText("2 von 3");
  await expect(dlg(page).locator('[data-bereich="kein-leseverbot"]')).toContainText("Gemini CLI kennt kein Leseverbot");
  await expect(dlg(page).locator('[data-kv="stufe"] [data-wert="erweitert"]')).toBeDisabled();
  await knopf(page, "ki-verbinden").click();
  await expect(dlg(page).locator('[data-kv="fertig"]')).toBeVisible({ timeout: 10000 });
  expect(z.log("/api/mcp/verbinden")[0].body).toEqual({ ziel: "gemini", zugriff: "posteingang" });
  await expect(dlg(page).locator('[data-bereich="probe-ergebnis"]')).toContainText("Starte Gemini CLI neu");
});

test("Konto hinzufügen: eigener Ordner, startet gesperrt, wird gewählt, Anmelden beginnt; ein leerer Name wird abgewiesen", async ({ page }) => {
  const z = await start(page);
  await oeffne(page);
  await weiter(page);
  await dlg(page).locator('[data-aktion="konto-hinzu"]').click();
  await expect(dlg(page).locator('[data-kv="konto-neu"]')).toBeVisible();
  await expect(knopf(page, "ki-weiter")).toBeDisabled();
  await dlg(page).locator('[data-aktion="konto-neu-ok"]').click();
  await expect(dlg(page).locator('[data-kx="neu-fehler"]')).toContainText("Gib dem Konto einen Namen");
  await dlg(page).locator('[data-kx="neu-name"]').fill("Kunde");
  await expect(dlg(page).locator('[data-kx="neu-ordner"]')).toContainText("claude-kunde");
  await dlg(page).locator('[data-aktion="konto-neu-ok"]').click();
  await expect(dlg(page).locator(".kv-konto")).toHaveCount(3);
  await expect(dlg(page).locator('.kv-konto[aria-checked="true"] b')).toHaveText("Kunde");
  expect(z.kz.log("/api/ki/konto-neu")[0].body).toEqual({ programm: "claude", name: "Kunde", stufe: "gesperrt" });
  await expect(dlg(page).locator('[data-kv="anmelden"]')).toBeVisible();
  expect(z.kz.log("/api/ki/anmelden")).toHaveLength(1);
  await dlg(page).locator('[data-aktion="anmelden-abbrechen"]').click();
  await weiter(page);
  await expect(stufeWert(page)).toHaveText("Gesperrt"); // das neue Konto bleibt gesperrt, bis du wählst
});

test("Fertig: „Kontingent anzeigen“ fragt um Erlaubnis (Dialog der Einstellungen); Hinweis auf das Leseverbot für gesperrte Vaults", async ({ page }) => {
  const z = await start(page, { kontingent: { werte: { [K_PRIVAT.id]: { quelle: "statuszeile", verwaltet: false, bestaetigungNoetig: true, status: "nicht-eingerichtet" } } } });
  await zurStufe(page);
  await knopf(page, "ki-verbinden").click();
  await expect(dlg(page).locator('[data-kv="fertig"]')).toBeVisible({ timeout: 10000 });
  await expect(dlg(page).locator('[data-kv="kontingent"]')).toContainText("Kontingent anzeigen");
  await expect(dlg(page).locator('[data-kv="leseverbot"]')).toContainText("Leseverbot für gesperrte Vaults");
  await dlg(page).locator('[data-aktion="kt-anzeigen"]').click();
  await expect(page.locator('[data-dialog="kt-einwilligung"]')).toBeVisible();
  await expect(page.locator('[data-dialog="kt-einwilligung"]')).toContainText("Statuszeile");
  expect(z.kt.log("POST")).toHaveLength(0); // erst nach „Ja“
  await bild(page, "5b-kontingent-einwilligung", "light");
  await page.locator('[data-aktion="kt-einschalten"]').click();
  await expect.poll(() => z.kt.log("POST").length).toBe(1);
  expect(z.kt.log("POST")[0].body).toMatchObject({ konto: K_PRIVAT.id, an: true, einwilligung: true, bestaetigt: true });
});

// ---------------------------------------------------------------- Wer den Ablauf benutzt: Statusleiste, Palette, Einstellungen, Assistent — überall derselbe
const seite = (page) => page.locator("[data-einstellungen]");

test("Statusleiste ohne Konto: „KI verbinden“ öffnet den Ablauf; Palette „KI verbinden …“ und Einstellungen „KI verbinden …“ öffnen denselben Dialog", async ({ page }) => {
  const z = await start(page, { leer: true, konten: [] });
  const claude = page.locator('#status [data-st="claude"]');
  await expect(claude).toBeVisible();
  await expect(claude).toContainText("KI verbinden");
  await claude.click();
  await expect(dlg(page)).toBeVisible();
  await expect(dlg(page).locator('[data-ki-auswahl][data-erkennung="gefunden"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dlg(page)).toHaveCount(0);
  // Palette
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("KI verbinden");
  await page.keyboard.press("Enter");
  await expect(dlg(page)).toBeVisible();
  await page.keyboard.press("Escape");
  // Einstellungen: der Knopf im Bereich „KI & Konten“
  await page.evaluate(() => { location.hash = "#einstellungen/ki"; });
  await expect(seite(page)).toBeVisible({ timeout: 20000 });
  await expect(page.locator(".kx-prog").first()).toBeVisible();
  await page.locator('[data-aktion="ki-verbinden-auf"]').click();
  await expect(dlg(page)).toBeVisible();
  await expect(dlg(page).locator("[data-ki-auswahl]")).toBeVisible();
  expect(z.anfragen.length).toBeGreaterThan(0);
});

test("Einstellungen: „Konto hinzufügen“ und „Verbinden“ am Konto öffnen den Ablauf beim richtigen Schritt; danach liest die Seite neu", async ({ page }) => {
  const z = await start(page, {}, { hash: "#einstellungen/ki" });
  await expect(seite(page)).toBeVisible({ timeout: 20000 });
  await expect(page.locator(".kx-prog").first()).toBeVisible();
  // Konto hinzufügen: der Ablauf steht beim Konto, das Formular ist offen
  await page.locator('.kx-prog[data-programm="claude"] [data-aktion="konto-hinzu"]').click();
  await expect(dlg(page)).toBeVisible();
  await expect(dlg(page).locator('[data-kv="konto-neu"]')).toBeVisible();
  await expect(kopfText(page)).toContainText("Claude Code: Mit welchem Konto?");
  await page.keyboard.press("Escape");
  await expect(dlg(page)).toHaveCount(0);
  // Verbinden am Konto „Firma“ (Menü ⋯ → Verbinden): Konto vorgewählt
  await page.locator(`.kx-konto[data-konto="${K_FIRMA.id}"] [data-aktion="konto-mehr"]`).click();
  await page.locator('[role="menuitem"]:has-text("Verbinden")').first().click();
  await expect(dlg(page)).toBeVisible();
  await expect(dlg(page).locator(`.kv-konto[data-konto="${K_FIRMA.id}"]`)).toHaveAttribute("aria-checked", "true");
  const vorher = z.kz.log("/api/ki/konten", "GET").length;
  await page.keyboard.press("Escape");
  await expect(dlg(page)).toHaveCount(0);
  await expect.poll(() => z.kz.log("/api/ki/konten", "GET").length).toBeGreaterThan(vorher); // beim Schließen liest die Seite neu
});

test("Statusleiste: während Programme und Konten laden steht ein Platzhalter, „KI verbinden“ blitzt nie auf, wenn ein Konto da ist", async ({ page }) => {
  await page.addInitScript(() => {
    window.__flash = []; window.__platzhalter = false;
    const pruefe = () => {
      const e = document.querySelector('#status [data-st="claude"]');
      if (e && e.offsetParent !== null && /KI verbinden/.test(e.textContent)) window.__flash.push(Math.round(performance.now()));
      const p = document.querySelector('#status [data-st="ki-laedt"]');
      if (p && !p.hidden && p.offsetParent !== null) window.__platzhalter = true;
    };
    const lauf = () => { pruefe(); requestAnimationFrame(lauf); };
    requestAnimationFrame(lauf);
  });
  await start(page, { kontingentVerzoegerung: 2500, erkennenVerzoegerung: 600 });
  await expect(page.locator('#status [data-st="ki-laedt"]')).toBeVisible();
  await expect(page.locator('#status [data-st="claude"]')).toBeHidden();
  await bild(page, "6-statusleiste-laedt", "light");
  await expect(page.locator("#status .kt-leiste[data-konto]")).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#status [data-st="ki-laedt"]')).toBeHidden();
  await bild(page, "6b-statusleiste-geladen", "light");
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__flash)).toEqual([]);
  expect(await page.evaluate(() => window.__platzhalter)).toBe(true);
});

test("Statusleiste: schlägt das Laden fehl, bleibt es nicht beim Platzhalter", async ({ page }) => {
  await start(page, { leer: true, konten: [], kontingent: { werte: {}, fehler: "nicht erreichbar" } });
  await expect(page.locator('#status [data-st="ki-laedt"]')).toBeHidden({ timeout: 10000 });
  await expect(page.locator('#status [data-st="claude"]:visible, #status .kt-leiste:visible').first()).toBeVisible();
});

test("Einrichtungs-Assistent: derselbe Ablauf im Schritt „KI“ (Fußleiste des Assistenten), bis zur Zusammenfassung", async ({ page }) => {
  const stat = await starteStatisch();
  try {
    const z = await mockeEinrichtung(page, { ki: "drei", vault: { pfad: "/Users/test/Kortex", name: "Kortex" }, zugriff: { k_claude_privat: { "/Users/test/Kortex": "lesen" } } });
    await page.goto(`${stat.url}einrichtung.html?ab=ki`);
    await page.waitForFunction(() => window.__einrichtungBereit === true);
    const ablauf = page.locator('.kv[data-rahmen="assistent"][data-fuss="host"]');
    await expect(ablauf).toBeVisible({ timeout: 8000 });
    await expect(page.locator(".e-ki-zeile")).toHaveCount(0); // die früheren Zeilen gibt es nicht mehr
    await expect(page.locator('[data-aktion="weiter"]')).toContainText("Ohne KI weiter"); // noch nichts gewählt
    await ablauf.locator('.ka-karte[data-ki="claude"]').click();
    await expect(page.locator('[data-aktion="weiter"]')).toContainText("Weiter");
    await page.click('[data-aktion="weiter"]');
    await expect(ablauf.locator(".kv-konto")).toHaveCount(2);
    await expect(ablauf.locator(".kv-kopf")).toContainText("2 von 4");
    await page.click('[data-aktion="weiter"]');
    await expect(ablauf.locator('[data-kv="stufe"]')).toBeVisible();
    await expect(ablauf.locator('[data-kv="stufe"] [aria-checked="true"]')).toHaveText("Lesen"); // aus dem Stand des Vaults vorbelegt
    await expect(page.locator('[data-aktion="weiter"]')).toContainText("Verbinden");
    await page.click('[data-aktion="zurueck"]'); // Zurück geht erst im Ablauf einen Schritt
    await expect(ablauf.locator(".kv-konto").first()).toBeVisible();
    await page.click('[data-aktion="weiter"]');
    await page.click('[data-aktion="weiter"]'); // Verbinden
    await expect(ablauf.locator('[data-kv="fertig"]')).toBeVisible({ timeout: 10000 });
    await expect(ablauf.locator('[data-bereich="probe-ergebnis"]')).toContainText("Claude Code sieht deinen Vault");
    expect(z.anfragen.filter((a) => a.pfad === "/api/mcp/verbinden")[0].body).toMatchObject({ ziel: "claude", konto: "k_claude_privat", zugriff: "lesen" });
    expect(z.anfragen.filter((a) => a.pfad === "/api/mcp/pruefen")).toHaveLength(1);
    await bild(page, "7-assistent-fertig", "light");
    await page.click('[data-aktion="weiter"]'); // Weiter zur Zusammenfassung des Assistenten
    await expect(page.locator(".e-zusammen")).toContainText("Claude Code");
    expect(z.seitenfehler).toEqual([]);
  } finally { stat.stopp(); }
});
