// „KI-Konten“ in den Einstellungen (Paket P2): Liste der Konten (Logo, Name, Programm, Ordner, verbunden), „Wer darf diesen Vault sehen?“ (Stufe je Konto mit Erklärung), Übersicht aller
// Vaults, Standard für neue Konten, Warnung beim Sperren (Claude Code mit Leseverbot, andere nur mit der Kortex-Schicht), Strenger Schutz, Hinweis auf eine beschädigte Liste, hell und dunkel.
// Die Routen /api/ki/* sind Attrappen (mocks-konten.mjs); der Rest läuft gegen die echte Werkstatt. UI_SHOTS=<Ordner>: legt die Bildschirmfotos dort ab (sonst screenshots/, ignoriert).
import { test, expect } from "./basis.mjs";
import { join } from "node:path";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { mockeV2 } from "./mocks.mjs";
import { mockeKonten } from "./mocks-konten.mjs";

let vault, server;
test.beforeEach(async () => { ({ vault } = baueVault()); server = await starteServer(vault); });
test.afterEach(() => server?.stopp());

const ruhig = (page) => page.waitForTimeout(350); // der Dialog blendet 180 ms ein
const shot = (name) => join(process.env.UI_SHOTS || "screenshots", `konten-${name}.png`);
const NOTIZ = "10_notizen/Reise nach Lissabon.md";
const dlg = (page) => page.locator('.dialog[data-dialog="ki-konten"]');
const FIRMA = "/Users/test/Firma-Vault";

async function start(page, opt = {}, { oeffnen = true } = {}) {
  await mockeV2(page, vault);
  const z = await mockeKonten(page, { vaults: [{ pfad: vault, name: "Mein Vault" }, { pfad: FIRMA, name: "Firma" }], ...opt });
  await page.goto(server.url + "?pfad=" + encodeURIComponent(NOTIZ));
  await page.waitForSelector(".cm-content .cm-line");
  if (oeffnen) {
    await page.click('[data-st="einstellungen"]');
    await page.click('[data-menue="ki-konten"]');
    await expect(dlg(page)).toBeVisible();
    await expect(dlg(page).locator('[data-kk="konten-liste"], [data-kk="keine-konten"]').first()).toBeVisible();
  }
  return z;
}
const zeile = (page, id) => dlg(page).locator(`.kk-zeile[data-konto="${id}"]`);
const stufeKnopf = (page, id, stufe) => zeile(page, id).locator(`[data-stufe-wahl="${stufe}"]`);

test("Einstellungen → KI-Konten: Liste mit Logo, Name, Programm, Ordner und verbunden ja/nein; Erklärung der Stufen; Titel und Begriffe stimmen", async ({ page }) => {
  await start(page);
  const d = dlg(page);
  await expect(d.locator(".kk-titel")).toHaveText("KI-Konten");
  await expect(d.locator('[data-kk="intro"]')).toContainText("Ein KI-Konto ist ein KI-Programm mit seiner Anmeldung");
  const konten = d.locator(".kk-konto");
  await expect(konten).toHaveCount(3);
  const claude = d.locator('.kk-konto[data-konto="k_aaaa0001"]');
  await expect(claude.locator('[data-kk="name"]')).toHaveText("Claude Code");
  await expect(claude.locator('[data-kk="meta"]')).toHaveText("Claude Code · ~/.claude");
  await expect(claude.locator('[data-kk="verbunden"]')).toContainText("Verbunden");
  await expect(claude.locator(".ki-logo[data-ki-logo=\"claude\"]")).toBeVisible();
  const privat = d.locator('.kk-konto[data-konto="k_aaaa0002"]');
  await expect(privat.locator('[data-kk="meta"]')).toHaveText("Claude Code · ~/.claude-privat");
  await expect(privat.locator('[data-kk="verbunden"]')).toContainText("Nicht verbunden");
  await expect(d.locator('.kk-konto[data-konto="k_aaaa0003"] .ki-logo')).toHaveAttribute("data-ki-logo", "codex");
  // Logos haben feste Größe aus dem Symbol-Set (20 px), nichts läuft aus dem Dialog
  const box = await claude.locator(".ki-logo svg").boundingBox();
  expect(Math.round(box.width)).toBe(20);
  // Erklärung der Stufen in Alltagssprache
  const leg = d.locator('[data-kk="legende"]');
  await expect(leg).toContainText("Das Konto findet diesen Vault über Kortex nicht");
  await expect(leg).toContainText("darf nachschlagen und Neues im Posteingang ablegen");
  for (const verboten of ["Brain", "Profil", "MCP", "Git"]) await expect(d).not.toContainText(verboten);
  await ruhig(page); await page.screenshot({ path: shot("liste-hell") });
});

test("Wer darf diesen Vault sehen: eine Stufe je Konto, die Erklärung wechselt mit; Lesen und Posteingang sofort, Neue Konten als Standard je Vault", async ({ page }) => {
  const z = await start(page);
  const d = dlg(page);
  await expect(d.locator('[data-kk="vault-wahl"]')).toHaveValue(vault);
  await expect(zeile(page, "k_aaaa0001")).toHaveAttribute("data-stufe", "posteingang");
  await expect(stufeKnopf(page, "k_aaaa0001", "posteingang")).toHaveAttribute("aria-checked", "true");
  await expect(zeile(page, "k_aaaa0001").locator('[data-kk="stufentext"]')).toContainText("Neues im Posteingang ablegen");
  await expect(zeile(page, "k_aaaa0002")).toHaveAttribute("data-stufe", "gesperrt");
  // Lesen: sofort, ohne Rückfrage
  await stufeKnopf(page, "k_aaaa0001", "lesen").click();
  await expect(zeile(page, "k_aaaa0001")).toHaveAttribute("data-stufe", "lesen");
  await expect(zeile(page, "k_aaaa0001").locator('[data-kk="stufentext"]')).toContainText("darf nachschlagen: suchen und Notizen lesen");
  expect(z.log("/api/ki/zugriff").at(-1).body).toEqual({ konto: "k_aaaa0001", vault, stufe: "lesen" });
  // das nicht verbundene Konto freigeben
  await stufeKnopf(page, "k_aaaa0002", "erweitert").click();
  await expect(zeile(page, "k_aaaa0002")).toHaveAttribute("data-stufe", "erweitert");
  expect(z.zugriff.k_aaaa0002[vault]).toBe("erweitert");
  // Standard für neue Konten
  const neu = d.locator('[data-kk="neue-konten"]');
  await expect(neu).toContainText("Neu gefundene Konten");
  await expect(neu.locator('[data-stufe-wahl="gesperrt"]')).toHaveAttribute("aria-checked", "true");
  await neu.locator('[data-stufe-wahl="lesen"]').click();
  await expect(neu.locator('[data-stufe-wahl="lesen"]')).toHaveAttribute("aria-checked", "true");
  expect(z.log("/api/ki/standard").at(-1).body).toEqual({ vault, stufe: "lesen" });
  // anderer Vault wählen: die Stufen gehören zu diesem Vault
  await d.locator('[data-kk="vault-wahl"]').selectOption(FIRMA);
  await expect(zeile(page, "k_aaaa0001")).toHaveAttribute("data-stufe", "posteingang");
  await expect(neu.locator('[data-stufe-wahl="gesperrt"]')).toHaveAttribute("aria-checked", "true");
  await ruhig(page); await page.screenshot({ path: shot("vault-hell") });
});

test("Sperren fragt nach: Claude Code mit Leseverbot (Haken vorbelegt), ehrlich was Kortex sperrt und was nicht; Abbrechen ändert nichts; Bestätigen schreibt claudeSperre", async ({ page }) => {
  const z = await start(page);
  const d = dlg(page);
  await stufeKnopf(page, "k_aaaa0001", "gesperrt").click();
  const frage = d.locator('[data-kk="frage-sperren"]');
  await expect(frage).toBeVisible();
  await expect(frage.locator(".kk-karte-titel")).toHaveText("Claude Code den Vault „Mein Vault“ sperren?");
  await expect(frage).toContainText("Was Kortex sperrt");
  await expect(frage).toContainText("findet den Vault nicht mehr über Kortex");
  await expect(frage).toContainText("Was das nicht verhindert");
  await expect(frage).toContainText("eigenen macOS-Benutzer");
  await expect(frage).toContainText("~/.claude/settings.json");
  await expect(frage).toContainText("Beim Entsperren nimmt Kortex genau diese zwei Regeln wieder heraus");
  await expect(frage.locator('[data-kk="claude-haken"]')).toBeChecked();
  await ruhig(page); await page.screenshot({ path: shot("sperren-claude-hell") });
  // Abbrechen: nichts gesendet, Stufe bleibt
  await frage.locator('[data-aktion="konten-frage-abbrechen"]').click();
  await expect(frage).toHaveCount(0);
  await expect(zeile(page, "k_aaaa0001")).toHaveAttribute("data-stufe", "posteingang");
  expect(z.log("/api/ki/zugriff")).toHaveLength(0);
  // Bestätigen mit Haken
  await stufeKnopf(page, "k_aaaa0001", "gesperrt").click();
  await d.locator('[data-aktion="konten-sperren-ja"]').click();
  await expect(zeile(page, "k_aaaa0001")).toHaveAttribute("data-stufe", "gesperrt");
  expect(z.log("/api/ki/zugriff").at(-1).body).toEqual({ konto: "k_aaaa0001", vault, stufe: "gesperrt", claudeSperre: true });
  await expect(zeile(page, "k_aaaa0001").locator('[data-kk="sperrzustand"]')).toHaveAttribute("data-zustand", "aktiv");
  await expect(zeile(page, "k_aaaa0001").locator('[data-kk="sperrzustand"]')).toContainText("Leseverbot in Claude Code eingetragen");
  // Ohne Haken: nur die Kortex-Schicht
  await stufeKnopf(page, "k_aaaa0001", "lesen").click();
  await stufeKnopf(page, "k_aaaa0001", "gesperrt").click();
  await d.locator('[data-kk="claude-haken"]').uncheck();
  await d.locator('[data-aktion="konten-sperren-ja"]').click();
  expect(z.log("/api/ki/zugriff").at(-1).body).toEqual({ konto: "k_aaaa0001", vault, stufe: "gesperrt", claudeSperre: false });
  await expect(zeile(page, "k_aaaa0001").locator('[data-kk="sperrzustand"]')).toHaveAttribute("data-zustand", "aus");
  await expect(zeile(page, "k_aaaa0001").locator('[data-aktion="leseverbot-eintragen"]')).toBeVisible();
  // Das Leseverbot nachträglich eintragen (derselbe Dialog), dann Entsperren nimmt es wieder heraus
  await zeile(page, "k_aaaa0001").locator('[data-aktion="leseverbot-eintragen"]').click();
  await expect(d.locator('[data-kk="frage-sperren"]')).toBeVisible();
  await d.locator('[data-aktion="konten-sperren-ja"]').click();
  await expect(zeile(page, "k_aaaa0001").locator('[data-kk="sperrzustand"]')).toHaveAttribute("data-zustand", "aktiv");
  expect(z.log("/api/ki/zugriff").at(-1).body).toEqual({ konto: "k_aaaa0001", vault, stufe: "gesperrt", claudeSperre: true });
  await stufeKnopf(page, "k_aaaa0001", "lesen").click();
  await expect(zeile(page, "k_aaaa0001")).toHaveAttribute("data-stufe", "lesen");
  await expect(page.locator(".toast").last()).toContainText("Das Leseverbot in Claude Code ist wieder herausgenommen");
  expect(z.sperren).toEqual({});
});

test("Sperren bei einem anderen Programm (Codex): ehrlich, nur die Kortex-Schicht — kein Haken, kein claudeSperre", async ({ page }) => {
  const z = await start(page);
  const d = dlg(page);
  await stufeKnopf(page, "k_aaaa0003", "gesperrt").click();
  const frage = d.locator('[data-kk="frage-sperren"]');
  await expect(frage.locator(".kk-karte-titel")).toHaveText("Codex den Vault „Mein Vault“ sperren?");
  await expect(frage).toContainText("Bei Codex");
  await expect(frage).toContainText("Codex kennt kein Leseverbot, das Kortex für dich eintragen könnte");
  await expect(frage).toContainText("schützt hier nur seine eigenen Wege");
  await expect(frage.locator('[data-kk="claude-haken"]')).toHaveCount(0);
  await ruhig(page); await page.screenshot({ path: shot("sperren-codex-hell") });
  await d.locator('[data-aktion="konten-sperren-ja"]').click();
  expect(z.log("/api/ki/zugriff").at(-1).body).toEqual({ konto: "k_aaaa0003", vault, stufe: "gesperrt" });
  await expect(zeile(page, "k_aaaa0003").locator('[data-kk="sperrzustand"]')).toContainText("Bei Codex schützt Kortex nur seine eigenen Wege");
});

test("Strenger Schutz: nur mit einem gesperrten Vault, erst nach Bestätigung mit Folgen und Rückweg; ausschalten sofort", async ({ page }) => {
  const z = await start(page);
  const d = dlg(page);
  const streng = d.locator('[data-kk="streng"][data-konto="k_aaaa0001"]');
  await expect(streng).toBeVisible();
  await expect(streng.locator('[data-kk="streng-zustand"]')).toHaveText("Aus");
  await expect(streng.locator('[data-aktion="streng-an"]')).toBeDisabled();
  await expect(streng).toContainText("Sperre zuerst einen Vault für dieses Konto");
  await expect(d.locator('[data-kk="streng"][data-konto="k_aaaa0003"]')).toHaveCount(0);   // nur Claude Code
  await stufeKnopf(page, "k_aaaa0001", "gesperrt").click();
  await d.locator('[data-aktion="konten-sperren-ja"]').click();
  await expect(streng.locator('[data-aktion="streng-an"]')).toBeEnabled();
  await streng.locator('[data-aktion="streng-an"]').click();
  const frage = d.locator('[data-kk="frage-streng"]');
  await expect(frage.locator(".kk-karte-titel")).toHaveText("Strengen Schutz für Claude Code einschalten?");
  await expect(frage).toContainText("Sandbox von Claude Code");
  await expect(frage).toContainText("Was sich dadurch ändert");
  await expect(frage).toContainText("Rückweg");
  await ruhig(page); await page.screenshot({ path: shot("streng-hell") });
  await frage.locator('[data-aktion="konten-frage-abbrechen"]').click();
  expect(z.log("/api/ki/schutz")).toHaveLength(0);
  await streng.locator('[data-aktion="streng-an"]').click();
  await d.locator('[data-aktion="konten-streng-ja"]').click();
  expect(z.log("/api/ki/schutz").at(-1).body).toEqual({ konto: "k_aaaa0001", sandbox: true, bestaetigt: true });
  await expect(streng).toHaveAttribute("data-streng", "an");
  await expect(streng.locator('[data-kk="streng-zustand"]')).toHaveText("An");
  await streng.locator('[data-aktion="streng-aus"]').click();
  expect(z.log("/api/ki/schutz").at(-1).body).toEqual({ konto: "k_aaaa0001", sandbox: false });
  await expect(streng).toHaveAttribute("data-streng", "aus");
});

test("Übersicht aller Vaults: Konten × Vaults als Auswahlfelder; eine Sperre fragt auch hier nach", async ({ page }) => {
  const z = await start(page);
  const d = dlg(page);
  await d.locator('[data-ansicht="matrix"]').click();
  const m = d.locator('[data-kk="matrix"]');
  await expect(m).toBeVisible();
  await expect(m.locator("thead th")).toHaveCount(3);
  await expect(m.locator('tr[data-konto="k_aaaa0001"] select').first()).toHaveValue("posteingang");
  await expect(m.locator('tr[data-konto="k_aaaa0002"] select').first()).toHaveValue("gesperrt");
  await m.locator('tr[data-konto="k_aaaa0003"] td[data-vault="' + FIRMA + '"] select').selectOption("lesen");
  await expect(m.locator('tr[data-konto="k_aaaa0003"] td[data-vault="' + FIRMA + '"] select')).toHaveValue("lesen");
  expect(z.log("/api/ki/zugriff").at(-1).body).toEqual({ konto: "k_aaaa0003", vault: FIRMA, stufe: "lesen" });
  await m.locator('tr[data-konto="k_aaaa0003"] td[data-vault="' + FIRMA + '"] select').selectOption("gesperrt");
  await expect(d.locator('[data-kk="frage-sperren"]')).toBeVisible();
  await expect(m.locator('tr[data-konto="k_aaaa0003"] td[data-vault="' + FIRMA + '"] select')).toHaveValue("lesen");   // noch nicht gesperrt
  await d.locator('[data-aktion="konten-sperren-ja"]').click();
  await expect(m.locator('tr[data-konto="k_aaaa0003"] td[data-vault="' + FIRMA + '"] select')).toHaveValue("gesperrt");
  await ruhig(page); await page.screenshot({ path: shot("matrix-hell") });
  await d.locator('[data-ansicht="vault"]').click();
  await expect(d.locator('[data-kk="zugriff-liste"]')).toBeVisible();
});

test("Beschädigte Liste: Hinweis mit Erklärung bleibt stehen, bis er bestätigt wird; frühere Fassung nur nach Rückfrage", async ({ page }) => {
  const z = await start(page, { hinweis: "defekt-neu", vorherDa: true, zugriff: null });
  const d = dlg(page);
  const hinweis = d.locator('[data-kk="defekt"]');
  await expect(hinweis).toContainText("Die Liste der KI-Konten war beschädigt");
  await expect(hinweis).toContainText("jedes Konto für jeden Vault gesperrt");
  await ruhig(page); await page.screenshot({ path: shot("defekt-hell") });
  await hinweis.locator('[data-aktion="konten-vorher"]').click();
  const frage = d.locator('[data-kk="frage-vorher"]');
  await expect(frage).toContainText("Die frühere Fassung zurückholen?");
  await frage.locator('[data-aktion="konten-frage-abbrechen"]').click();
  expect(z.log("/api/ki/vorher")).toHaveLength(0);
  await hinweis.locator('[data-aktion="konten-vorher"]').click();
  await d.locator('[data-aktion="konten-vorher-ja"]').click();
  expect(z.log("/api/ki/vorher").at(-1).body).toEqual({ bestaetigt: true });
  await expect(d.locator('[data-kk="defekt"]')).toHaveCount(0);
  // ein zweiter Hinweis lässt sich auch einfach bestätigen
  z.hinweis = "defekt-neu";
  await d.locator('[data-aktion="konten-neu-suchen"]').click();
  await expect(d.locator('[data-kk="defekt"]')).toBeVisible();
  await d.locator('[data-aktion="konten-hinweis-verstanden"]').click();
  await expect(d.locator('[data-kk="defekt"]')).toHaveCount(0);
  expect(z.log("/api/ki/hinweis")).toHaveLength(1);
});

test("Scheitert das Leseverbot in Claude Code (kaputte settings.json), steht die Meldung oben; die Stufe in Kortex gilt trotzdem", async ({ page }) => {
  const z = await start(page, { fehlerClaude: "Die Einstellungen von Claude Code (settings.json) sind kein gültiges JSON in der erwarteten Form." });
  const d = dlg(page);
  await stufeKnopf(page, "k_aaaa0001", "gesperrt").click();
  await d.locator('[data-aktion="konten-sperren-ja"]').click();
  await expect(d.locator('[data-kk="meldung-text"]')).toContainText("Die Stufe gilt in Kortex, aber die Einstellungen von Claude Code ließen sich nicht ändern");
  await expect(zeile(page, "k_aaaa0001")).toHaveAttribute("data-stufe", "gesperrt");
  await expect(zeile(page, "k_aaaa0001").locator('[data-kk="sperrzustand"]')).toHaveAttribute("data-zustand", "aus");
  expect(z.log("/api/ki/zugriff")).toHaveLength(1);
});

test("Umbenennen: Name bearbeiten, Enter speichert, zu langer oder leerer Name wird abgewiesen, Abbrechen verwirft", async ({ page }) => {
  const z = await start(page);
  const d = dlg(page);
  const privat = d.locator('.kk-konto[data-konto="k_aaaa0002"]');
  await privat.locator('[data-aktion="konto-umbenennen"]').click();
  const feld = privat.locator('[data-kk="name-feld"]');
  await expect(feld).toBeFocused();
  await feld.fill("");
  await feld.press("Enter");
  await expect(privat).toContainText("Der Name darf nicht leer sein.");
  await feld.fill("x".repeat(41));
  await feld.press("Enter");
  await expect(privat).toContainText("höchstens 40 Zeichen");
  expect(z.log("/api/ki/konten", "POST")).toHaveLength(0);
  await privat.locator('[data-aktion="konto-name-abbrechen"]').click();
  await expect(privat.locator('[data-kk="name"]')).toHaveText("Claude Code · privat");
  await privat.locator('[data-aktion="konto-umbenennen"]').click();
  await privat.locator('[data-kk="name-feld"]').fill("Privat zu Hause");
  await privat.locator('[data-kk="name-feld"]').press("Enter");
  await expect(privat.locator('[data-kk="name"]')).toHaveText("Privat zu Hause");
  expect(z.log("/api/ki/konten", "POST").at(-1).body).toEqual({ id: "k_aaaa0002", name: "Privat zu Hause" });
  await expect(zeile(page, "k_aaaa0002").locator(".kk-name")).toHaveText("Privat zu Hause");
});

test("Tastatur: Pfeiltasten bewegen den Fokus in der Stufenwahl, Enter wählt; Esc schließt den Dialog; Fokus-Ring sichtbar", async ({ page }) => {
  await start(page);
  const d = dlg(page);
  await stufeKnopf(page, "k_aaaa0001", "posteingang").focus();
  await page.keyboard.press("ArrowLeft");
  await expect(stufeKnopf(page, "k_aaaa0001", "lesen")).toBeFocused();
  await expect(zeile(page, "k_aaaa0001")).toHaveAttribute("data-stufe", "posteingang");   // Pfeil wählt nicht
  await page.keyboard.press("Enter");
  await expect(zeile(page, "k_aaaa0001")).toHaveAttribute("data-stufe", "lesen");
  await page.keyboard.press("End");
  await expect(stufeKnopf(page, "k_aaaa0001", "erweitert")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(stufeKnopf(page, "k_aaaa0001", "gesperrt")).toBeFocused();
  // Gesperrt per Tastatur: die Rückfrage bekommt den Fokus
  await page.keyboard.press("Enter");
  await expect(d.locator('[data-kk="frage-sperren"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dlg(page)).toHaveCount(0);
});

test("Keine Konten gefunden: ein klarer Satz statt einer leeren Liste", async ({ page }) => {
  await start(page, { leer: true });
  await expect(dlg(page).locator('[data-kk="keine-konten"]')).toContainText("noch kein KI-Konto gefunden");
});

test("Hell und dunkel: dieselbe Ansicht in beiden Darstellungen, ohne waagerechtes Scrollen; auch schmal", async ({ page }) => {
  await start(page);
  const d = dlg(page);
  await stufeKnopf(page, "k_aaaa0001", "gesperrt").click();
  await d.locator('[data-aktion="konten-sperren-ja"]').click();
  await page.emulateMedia({ colorScheme: "dark" });
  await ruhig(page); await page.screenshot({ path: shot("vault-dunkel") });
  await d.locator('[data-ansicht="matrix"]').click();
  await ruhig(page); await page.screenshot({ path: shot("matrix-dunkel") });
  await d.locator('[data-ansicht="vault"]').click();
  await stufeKnopf(page, "k_aaaa0002", "gesperrt").click().catch(() => {});
  await page.setViewportSize({ width: 420, height: 800 });
  await ruhig(page); await page.screenshot({ path: shot("schmal-dunkel") });
  const ueberlauf = await d.locator(".kk-rumpf").evaluate((e) => e.scrollWidth - e.clientWidth);
  expect(ueberlauf).toBeLessThanOrEqual(1);
  await page.emulateMedia({ colorScheme: "light" });
  await ruhig(page); await page.screenshot({ path: shot("schmal-hell") });
});
