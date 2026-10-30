// „Pflege“ in den KI-Konten (Paket P3): Konto je Vault (nur Konten mit „Erweitert“, mit Logo über den Baustein auswahl), Stufe als Segment-Schalter (Klein · Mittel · Ohne KI), was die Pflege tut,
// letzter/nächster Lauf, „Jetzt pflegen“, Hinweis aus der Migration, hell und dunkel, schmal. Die Routen /api/ki/* sind Attrappen (mocks-konten.mjs); der Rest läuft gegen die echte Werkstatt.
// UI_SHOTS=<Ordner>: legt die Bildschirmfotos dort ab (sonst screenshots/, ignoriert).
import { test, expect } from "./basis.mjs";
import { join } from "node:path";
import { realpathSync } from "node:fs";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { mockeV2 } from "./mocks.mjs";
import { mockeKonten } from "./mocks-konten.mjs";

let vault, server;
// Der Pfad des offenen Vaults ist der echte (macOS: /private/var), wie ihn die Werkstatt meldet.
test.beforeEach(async () => { ({ vault } = baueVault()); vault = realpathSync(vault); server = await starteServer(vault); });
test.afterEach(() => server?.stopp());

const ruhig = (page) => page.waitForTimeout(350);
const shot = (name) => join(process.env.UI_SHOTS || "screenshots", `pflege-${name}.png`);
const NOTIZ = "10_notizen/Reise nach Lissabon.md";
const dlg = (page) => page.locator('.dialog[data-dialog="ki-konten"]');
const abschnitt = (page) => dlg(page).locator('[data-kk="pflege-abschnitt"]');
const FIRMA = "/Users/test/Firma-Vault";
const erweitert = (v1, v2 = "posteingang") => ({
  k_aaaa0001: { [v1]: "erweitert", [FIRMA]: v2 },
  k_aaaa0002: { [v1]: "posteingang", [FIRMA]: "gesperrt" },
  k_aaaa0003: { [v1]: "erweitert", [FIRMA]: "erweitert" },       // Codex: erweitert, aber kein Claude Code
});

async function start(page, opt = {}) {
  await mockeV2(page, vault);
  const z = await mockeKonten(page, { vaults: [{ pfad: vault, name: "Mein Vault" }, { pfad: FIRMA, name: "Firma" }], zugriff: erweitert(vault), ...opt });
  await page.goto(server.url + "?pfad=" + encodeURIComponent(NOTIZ));
  await page.waitForSelector(".cm-content .cm-line");
  await page.click('[data-st="einstellungen"]');
  await page.click('[data-menue="ki-konten"]');
  await expect(dlg(page)).toBeVisible();
  await expect(abschnitt(page).locator('[data-kk="pflege-naechster"]')).toBeVisible();   // der Stand ist geladen (danach zeichnet sich nichts mehr neu)
  return z;
}
const stufe = (page, s) => abschnitt(page).locator(`[data-kk="pflege-stufe"] [data-wert="${s}"]`);
const postIst = (z, body) => expect.poll(() => z.log("/api/ki/pflege", "POST").at(-1)?.body).toEqual(body);
// Ein Popover schließt bei jedem Scrollen: erst den Knopf sichtbar machen und warten, dann öffnen.
const oeffneKonten = async (page) => { const k = abschnitt(page).locator('[data-kk="pflege-konto"]'); await k.scrollIntoViewIfNeeded(); await page.waitForTimeout(150); await k.click(); await expect(page.locator(".bs-liste")).toBeVisible(); };
const waehleKonto = async (page, id) => { await oeffneKonten(page); await page.locator(`.bs-opt[data-wert="${id}"]`).click(); };

test("Block Pflege: Konto nur aus Claude-Code-Konten mit Erweitert (mit Logo), Stufe als Segment; gespeichert wird je Vault; die Erklärung wechselt mit der Stufe", async ({ page }) => {
  const z = await start(page);
  const a = abschnitt(page);
  await expect(a.locator("h3")).toHaveText("Pflege");
  await expect(a).toContainText("Einmal am Tag räumt Kortex diesen Vault im Hintergrund auf");
  // noch nichts eingestellt: Mittel (wie heute) und der Hinweis auf den alten Weg
  await expect(stufe(page, "mittel")).toHaveAttribute("aria-checked", "true");
  await expect(a.locator('[data-kk="pflege-alt"]')).toContainText("Hintergrunddienst");
  // Konto: nur Claude Code mit Erweitert (nicht das Konto mit Posteingang, nicht Codex)
  await oeffneKonten(page);
  await expect(page.locator(".bs-opt")).toHaveCount(1);
  await expect(page.locator('.bs-opt[data-wert="k_aaaa0001"] .ki-logo[data-ki-logo="claude"]')).toBeVisible();
  await expect(page.locator('.bs-opt[data-wert="k_aaaa0001"]')).toContainText("Claude Code");
  await page.keyboard.press("Escape");
  await waehleKonto(page, "k_aaaa0001");
  await postIst(z, { vault, konto: "k_aaaa0001", stufe: "mittel" });
  await expect(a.locator('[data-kk="pflege-konto"]')).toContainText("Claude Code");
  // Klein
  await stufe(page, "klein").click();
  await postIst(z, { vault, konto: "k_aaaa0001", stufe: "klein" });
  await expect(stufe(page, "klein")).toHaveAttribute("aria-checked", "true");
  await expect(a.locator('[data-kk="pflege-stufentext"]')).toContainText("Nur das kleine, günstige Modell (Haiku)");
  await expect(a.locator('[data-kk="tut-immer"]')).toHaveAttribute("data-aktiv", "true");
  await expect(a.locator('[data-kk="tut-haiku"]')).toHaveAttribute("data-aktiv", "true");
  await expect(a.locator('[data-kk="tut-sonnet"]')).toHaveAttribute("data-aktiv", "false");
  await expect(a.locator('[data-kk="tut-sonnet"]')).toContainText("ruht in dieser Stufe");
  await ruhig(page); await a.screenshot({ path: shot("klein-hell") });
  // Mittel
  await stufe(page, "mittel").click();
  await expect(a.locator('[data-kk="tut-sonnet"]')).toHaveAttribute("data-aktiv", "true");
  await expect(a.locator('[data-kk="tut-sonnet"]')).toContainText("Traum");
  await ruhig(page); await a.screenshot({ path: shot("mittel-hell") });
  // Ohne KI: bewusst, das Konto bleibt gemerkt; die Schritte ohne KI laufen weiter
  await stufe(page, "aus").click();
  await postIst(z, { vault, konto: "k_aaaa0001", stufe: "aus" });
  await expect(a.locator('[data-kk="pflege-stufentext"]')).toContainText("ganz normaler, erfolgreicher Lauf");
  await expect(a.locator('[data-kk="tut-haiku"]')).toHaveAttribute("data-aktiv", "false");
  await expect(a.locator('[data-kk="tut-immer"]')).toContainText("Reste früherer Läufe aufräumen");
  await expect(a.locator('[data-kk="pflege-problem"]')).toHaveCount(0);
  await ruhig(page); await a.screenshot({ path: shot("aus-hell") });
  // der andere Vault ist unberührt
  await dlg(page).locator('[data-kk="vault-wahl"]').selectOption(FIRMA);
  await expect(stufe(page, "mittel")).toHaveAttribute("aria-checked", "true");
  await expect(a.locator('[data-kk="pflege-alt"]')).toBeVisible();
  expect(Object.keys(z.pflege)).toEqual([vault]);
});

test("Ein Konto ohne Erweitert gibt es nicht zur Wahl: Hinweis mit dem Weg dorthin; nur Ohne KI ist dann möglich; eine Stufe vor dem Konto merkt sich der Block und sagt, was fehlt", async ({ page }) => {
  const z = await start(page, { zugriff: { k_aaaa0001: { "": "x" }, k_aaaa0002: {}, k_aaaa0003: {} } });
  const a = abschnitt(page);
  await expect(a.locator('[data-kk="pflege-kein-konto"]')).toContainText("Gib einem Claude-Code-Konto oben unter „Wer darf diesen Vault sehen?“ die Stufe „Erweitert“");
  await expect(a.locator('[data-kk="pflege-konto"]')).toHaveCount(0);
  await stufe(page, "klein").click();
  await expect(a.locator('[data-kk="pflege-waehle-zuerst"]')).toContainText("Wähle zuerst ein Konto");
  expect(z.log("/api/ki/pflege", "POST")).toHaveLength(0);
  await stufe(page, "aus").click();
  await postIst(z, { vault, konto: null, stufe: "aus" });
  await expect(a.locator('[data-kk="pflege-waehle-zuerst"]')).toHaveCount(0);
});

test("Mehrere Konten mit Erweitert: eine Stufe vor dem Konto wartet; sobald ein Konto gewählt ist, wird beides gespeichert", async ({ page }) => {
  const z = await start(page, { zugriff: { k_aaaa0001: { [vault]: "erweitert", [FIRMA]: "erweitert" }, k_aaaa0002: { [vault]: "erweitert", [FIRMA]: "erweitert" }, k_aaaa0003: { [vault]: "gesperrt", [FIRMA]: "gesperrt" } } });
  const a = abschnitt(page);
  await stufe(page, "klein").click();
  await expect(a.locator('[data-kk="pflege-waehle-zuerst"]')).toBeVisible();
  expect(z.log("/api/ki/pflege", "POST")).toHaveLength(0);
  await waehleKonto(page, "k_aaaa0002");
  await postIst(z, { vault, konto: "k_aaaa0002", stufe: "klein" });
  await expect(a.locator('[data-kk="pflege-konto"]')).toContainText("Claude Code · privat");
});

test("Letzter und nächster Lauf: „fertig, ohne KI (so eingestellt)“ zählt als Erfolg; Jetzt pflegen startet den Lauf des offenen Vaults, bei einem anderen Vault und bei ausgeschalteter Pflege ist der Knopf aus", async ({ page }) => {
  const z = await start(page, {
    pflege: { [vault]: { konto: null, stufe: "aus" } },
    letzter: { zeit: "2026-10-29T03:12:00.000Z", status: "ok-ohne-ki", erfolgreich: true, modus: "an", art: "voll", letzterErfolg: "2026-10-29T03:12:00.000Z", aufrufe: 0, tokEin: 0, tokAus: 0, uebernommen: 0, rueckfragen: 2, ki: { modus: "aus", stufe: "aus", bewusst: true } },
    naechster: { art: "dienst", fruehestens: "2026-10-30T23:12:00.000Z" },
  });
  const a = abschnitt(page);
  const l = a.locator('[data-kk="pflege-letzter"]');
  await expect(l).toHaveAttribute("data-status", "ok-ohne-ki");
  await expect(l).toContainText("fertig, ohne KI (so eingestellt)");
  await expect(l).toContainText("keine KI-Aufrufe");
  await expect(l.locator('.kk-marke[data-marke="gruen"]')).toBeVisible();
  await expect(a.locator('[data-kk="pflege-grund"]')).toHaveCount(0);
  await expect(a.locator('[data-kk="pflege-naechster"]')).toContainText("frühestens");
  await expect(a.locator('[data-kk="pflege-naechster"]')).toContainText("Netzteil");
  const jetzt = a.locator('[data-kk="pflege-jetzt"]');
  await expect(jetzt).toBeEnabled();
  await jetzt.click();
  await expect(page.locator(".toast").last()).toContainText("Die Pflege läuft jetzt im Hintergrund");
  expect(z.log("/api/ki/pflege/jetzt")).toHaveLength(1);
  await ruhig(page); await a.screenshot({ path: shot("lauf-hell") });
  // anderer Vault: nur der offene Vault wird gepflegt
  await dlg(page).locator('[data-kk="vault-wahl"]').selectOption(FIRMA);
  await expect(jetzt).toBeDisabled();
  await expect(a.locator(".kk-pflege-jetzt")).toContainText("gerade geöffnet ist");
});

test("Pflege ausgeschaltet (Schalter): kein Jetzt pflegen, der Satz sagt es; ein Lauf mit Warnung zeigt seinen Grund", async ({ page }) => {
  await start(page, { schalter: "aus", naechster: { art: "aus" },
    pflege: { [vault]: { konto: "k_aaaa0001", stufe: "mittel" } },
    letzter: { zeit: "2026-10-29T03:12:00.000Z", status: "ohne-ki", erfolgreich: false, modus: "an", art: "voll", aufrufe: 0, tokEin: 0, tokAus: 0, uebernommen: 0, rueckfragen: 0, grund: "Das gewählte KI-Konto hat für diesen Vault keine ausreichende Freigabe — die Pflege läuft ohne KI" } });
  const a = abschnitt(page);
  await expect(a.locator('[data-kk="pflege-jetzt"]')).toBeDisabled();
  await expect(a.locator('[data-kk="pflege-naechster"]')).toContainText("ausgeschaltet");
  await expect(a.locator('[data-kk="pflege-letzter"]')).toHaveAttribute("data-status", "ohne-ki");
  await expect(a.locator('[data-kk="pflege-letzter"] .kk-marke[data-marke="warn"]')).toBeVisible();
  await expect(a.locator('[data-kk="pflege-grund"]')).toContainText("keine ausreichende Freigabe");
});

test("Hinweis aus der Migration und Problem der Einstellung: das alte Konto des Dienstes hatte nicht Erweitert → Ohne KI mit Erklärung; wer die Pflege einstellt, nimmt den Hinweis weg", async ({ page }) => {
  const z = await start(page, {
    zugriff: { k_aaaa0001: { [vault]: "erweitert", [FIRMA]: "erweitert" }, k_aaaa0002: { [vault]: "posteingang", [FIRMA]: "gesperrt" }, k_aaaa0003: { [vault]: "gesperrt", [FIRMA]: "gesperrt" } },
    pflege: { [vault]: { konto: "k_aaaa0002", stufe: "aus" }, [FIRMA]: { konto: "k_aaaa0001", stufe: "mittel" } },
    pflegeHinweise: [{ vault, grund: "stufe", konto: "k_aaaa0002" }],
  });
  const a = abschnitt(page);
  await expect(a.locator('[data-kk="pflege-migration"]')).toContainText("lief bisher mit dem Konto „Claude Code · privat“");
  await expect(a.locator('[data-kk="pflege-migration"]')).toContainText("steht die Pflege jetzt auf „Ohne KI“");
  await expect(stufe(page, "aus")).toHaveAttribute("aria-checked", "true");
  await ruhig(page); await a.screenshot({ path: shot("migration-hell") });
  await waehleKonto(page, "k_aaaa0001");
  await expect(a.locator('[data-kk="pflege-migration"]')).toHaveCount(0);
  await expect.poll(() => z.log("/api/ki/pflege", "POST").at(-1)?.body.konto).toBe("k_aaaa0001");
  // Problem: dem Konto wird die Stufe genommen → der Block erklärt, dass die Pflege ohne KI läuft
  await stufe(page, "mittel").click();
  await dlg(page).locator('[data-kk="vault-wahl"]').selectOption(FIRMA);
  await stufeKnopfZugriff(page, "k_aaaa0001", "lesen");
  await expect(a.locator('[data-kk="pflege-problem"]')).toHaveAttribute("data-problem", "stufe");
  await expect(a.locator('[data-kk="pflege-problem"]')).toContainText("läuft die Pflege ohne KI");
});
async function stufeKnopfZugriff(page, id, s) { await dlg(page).locator(`.kk-zeile[data-konto="${id}"] [data-stufe-wahl="${s}"]`).click(); }

test("Hell und dunkel, auch schmal: der Block läuft nie über den Dialog hinaus, nichts scrollt waagerecht, Texte bleiben lesbar", async ({ page }) => {
  await start(page, { pflege: { [vault]: { konto: "k_aaaa0001", stufe: "klein" } },
    letzter: { zeit: "2026-10-29T03:12:00.000Z", status: "ok", erfolgreich: true, modus: "an", art: "voll", aufrufe: 14, tokEin: 5200, tokAus: 640, uebernommen: 3, rueckfragen: 1 },
    naechster: { art: "dienst", fruehestens: "2026-10-30T23:12:00.000Z" } });
  const a = abschnitt(page);
  const keinUeberlauf = async () => {
    const r = await dlg(page).locator(".kk-rumpf").evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
    expect(r.sw).toBeLessThanOrEqual(r.cw + 1);
    const box = await a.boundingBox(); const dbox = await dlg(page).boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(dbox.x + dbox.width + 1);
  };
  await a.scrollIntoViewIfNeeded();
  await keinUeberlauf();
  await ruhig(page); await a.screenshot({ path: shot("block-hell") }); await dlg(page).screenshot({ path: shot("dialog-hell") });
  await page.emulateMedia({ colorScheme: "dark" });
  await ruhig(page); await a.screenshot({ path: shot("block-dunkel") }); await dlg(page).screenshot({ path: shot("dialog-dunkel") });
  await page.setViewportSize({ width: 400, height: 860 });
  await a.scrollIntoViewIfNeeded();
  await keinUeberlauf();
  await ruhig(page); await a.screenshot({ path: shot("schmal-dunkel") });
  await page.emulateMedia({ colorScheme: "light" });
  await ruhig(page); await a.screenshot({ path: shot("schmal-hell") });
});
