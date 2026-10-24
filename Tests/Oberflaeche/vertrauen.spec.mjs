// Vertrauen v2 in der Oberfläche (Spec §8): Frage „Diesem Vault vertrauen?“, Statusleiste, Git gesperrt, Aktion an die App.
// Die Werkstatt-Antworten (info.vertrauen, POST /api/kit/vertrauen, Git gesperrt) sind Attrappen aus mocks.mjs; der Rest läuft gegen die echte Werkstatt.
import { test, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { mockeV2, mockeVertrauen, vertrauenAntwort, GRUENDE_ALLE } from "./mocks.mjs";

let vault, server;
test.beforeEach(async () => { ({ vault } = baueVault()); server = await starteServer(vault); });
test.afterEach(() => server?.stopp());

const NOTIZ = "10_notizen/Reise nach Lissabon.md";
const dialogVertrauen = (page) => page.locator('.dialog[data-dialog="vertrauen"]');
const aktionen = (page, name) => page.evaluate((n) => window.__aktionen.filter((a) => a.aktion === n), name);

// stub: nativer Kanal „aktion“ der App (zeichnet alle Aktionen auf)
async function start(page, opt = {}) {
  await page.addInitScript(() => { window.__aktionen = []; window.webkit = { messageHandlers: { aktion: { postMessage: (m) => { window.__aktionen.push(m); } } } }; });
  await mockeV2(page, vault);
  const stand = await mockeVertrauen(page, opt);
  await page.goto(server.url + "?pfad=" + encodeURIComponent(NOTIZ));
  await page.waitForSelector(".cm-content .cm-line");
  return stand;
}

test("Frage erscheint bei noetig und nicht erlaubt: Gründe aus der Werkstatt, „Nicht jetzt“ hat den Fokus", async ({ page }) => {
  await start(page, { vertrauen: vertrauenAntwort({ gruende: GRUENDE_ALLE }) });
  const d = dialogVertrauen(page);
  await expect(d).toBeVisible();
  await expect(d.locator(".dialog-kopf")).toHaveText("Diesem Vault vertrauen?");
  await expect(d.locator("[data-grund]")).toHaveCount(3);
  await expect(d.locator('[data-grund="kit"]')).toHaveText("Brain-Werkzeuge (.tools) mit 3 Programmdateien");
  await expect(d.locator('[data-grund="hooks"]')).toHaveText("Git-Hooks: pre-commit");
  await expect(d.locator('[data-grund="git"]')).toHaveText("Git-Einstellungen, die Programme starten: core.gitProxy");
  await expect(d).not.toContainText("seit deiner Freigabe"); // nur bei geaendert
  await expect(d.locator('[data-vertrauen="git-gesperrt"]')).toHaveCount(0);
  // Sicherer Standard: ein versehentliches Enter erteilt kein Vertrauen
  await expect(d.locator('[data-aktion="vertrauen-spaeter"]')).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(d).toHaveCount(0);
  expect(await aktionen(page, "vertrauen-geaendert")).toHaveLength(0);
});

test("geaendert: der Satz „Die Werkzeuge in diesem Vault haben sich seit deiner Freigabe geändert.“", async ({ page }) => {
  await start(page, { vertrauen: vertrauenAntwort({ geaendert: true }) });
  await expect(dialogVertrauen(page).locator('[data-vertrauen="geaendert"]')).toHaveText("Die Werkzeuge in diesem Vault haben sich seit deiner Freigabe geändert.");
});

test("Vertrauen: POST erlauben, Aktion an die App, danach Info, Git-Status, Index und Gesundheit neu", async ({ page }) => {
  const stand = await start(page, { vertrauen: vertrauenAntwort() });
  await expect(dialogVertrauen(page)).toBeVisible();
  await expect(page.locator('[data-st="gesundheit"]')).toHaveCount(0); // ohne Vertrauen läuft das Kit nicht
  expect(await aktionen(page, "vertrauen-geaendert")).toHaveLength(0);
  const vorher = { ...stand.anfragen };
  await page.click('[data-aktion="vertrauen-erlauben"]');
  await expect(dialogVertrauen(page)).toHaveCount(0);
  expect(stand.post).toEqual([{ erlauben: true }]);
  expect(await aktionen(page, "vertrauen-geaendert")).toEqual([{ aktion: "vertrauen-geaendert" }]);
  await expect.poll(() => stand.anfragen.info).toBeGreaterThan(vorher.info);
  await expect.poll(() => stand.anfragen.gitStatus).toBeGreaterThan(vorher.gitStatus);
  await expect.poll(() => stand.anfragen.notizen).toBeGreaterThan(vorher.notizen);
  await expect(page.locator('[data-st="gesundheit"]')).toBeVisible();
  await expect(page.locator('[data-bereich="rueckfragen"] .zahl')).toHaveText("2");
  await expect(page.locator('[data-st="vertrauen"]')).toHaveCount(0);
  await expect(page.locator(".toast")).toContainText("Vertrauen gespeichert");
});

test("Nicht jetzt: einmal je Vault und Sitzung, danach über die Statusleiste erreichbar", async ({ page }) => {
  const stand = await start(page, { vertrauen: vertrauenAntwort() });
  await page.click('.dialog [data-aktion="vertrauen-spaeter"]');
  await expect(dialogVertrauen(page)).toHaveCount(0);
  expect(stand.post).toEqual([]);
  expect(await aktionen(page, "vertrauen-geaendert")).toHaveLength(0);
  const st = page.locator('[data-st="vertrauen"]');
  await expect(st).toBeVisible();
  await expect(st).toContainText("Nicht freigegeben");
  // Fokuswechsel und neu geladene Info fragen nicht von selbst noch einmal
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => stand.anfragen.info).toBeGreaterThan(1);
  await page.waitForTimeout(300);
  await expect(dialogVertrauen(page)).toHaveCount(0);
  // Statusleiste öffnet die Frage wieder; Esc schließt wie „Nicht jetzt“
  await st.click();
  await expect(dialogVertrauen(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialogVertrauen(page)).toHaveCount(0);
});

test("kein Vertrauen nötig oder schon erteilt: keine Frage, kein Statusleisten-Eintrag", async ({ page }) => {
  await start(page, { vertrauen: vertrauenAntwort({ noetig: false, gruende: [] }) });
  await page.waitForTimeout(400);
  await expect(dialogVertrauen(page)).toHaveCount(0);
  await expect(page.locator('[data-st="vertrauen"]')).toHaveCount(0);
  const p2 = await page.context().newPage();
  await mockeV2(p2, vault);
  await mockeVertrauen(p2, { vertrauen: vertrauenAntwort({ erlaubt: true }) });
  await p2.goto(server.url + "?pfad=" + encodeURIComponent(NOTIZ));
  await p2.waitForSelector(".cm-content .cm-line");
  await p2.waitForTimeout(400);
  await expect(dialogVertrauen(p2)).toHaveCount(0);
  await expect(p2.locator('[data-st="vertrauen"]')).toHaveCount(0);
});

test("POST scheitert: Fehler im Dialog, Dialog bleibt, keine Aktion an die App", async ({ page }) => {
  const stand = await start(page, { vertrauen: vertrauenAntwort(), postFehler: { status: 500, fehler: "Der Merker konnte nicht gespeichert werden." } });
  await page.click('[data-aktion="vertrauen-erlauben"]');
  await expect(dialogVertrauen(page).locator(".fehlertext")).toHaveText("Der Merker konnte nicht gespeichert werden.");
  await expect(dialogVertrauen(page)).toBeVisible();
  await expect(page.locator('[data-aktion="vertrauen-erlauben"]')).toBeEnabled();
  expect(stand.post).toHaveLength(1);
  expect(await aktionen(page, "vertrauen-geaendert")).toHaveLength(0);
});

test("ältere Werkstatt ohne info.vertrauen: die Frage kommt aus info.kit", async ({ page }) => {
  const stand = await start(page, { alt: true, vertrauen: vertrauenAntwort({ gruende: [] }) });
  const d = dialogVertrauen(page);
  await expect(d).toBeVisible();
  await expect(d.locator('[data-grund="kit"]')).toContainText("Brain-Werkzeuge (.tools)");
  await page.click('[data-aktion="vertrauen-erlauben"]');
  await expect(d).toHaveCount(0);
  expect(stand.post).toEqual([{ erlauben: true }]);
  await expect(page.locator('[data-st="gesundheit"]')).toBeVisible();
});

test("Git gesperrt: Statusleiste zeigt „Git gesperrt“ statt der Git-Angaben, Klick öffnet die Frage, Vertrauen hebt die Sperre auf", async ({ page }) => {
  const stand = await start(page, { vertrauen: vertrauenAntwort({ gitGesperrt: true, gruende: GRUENDE_ALLE.slice(2) }) });
  await page.click('.dialog [data-aktion="vertrauen-spaeter"]');
  const gesperrt = page.locator('[data-st="git-gesperrt"]');
  await expect(gesperrt).toContainText("Git gesperrt");
  for (const id of ["zweig", "remote", "sync", "geaendert", "verlauf", "kein-git"]) await expect(page.locator(`[data-st="${id}"]`)).toHaveCount(0);
  await expect(page.locator('[data-st="vertrauen"]')).toHaveCount(0); // „Git gesperrt“ öffnet dieselbe Frage
  await gesperrt.click();
  const d = dialogVertrauen(page);
  await expect(d.locator('[data-vertrauen="git-gesperrt"]')).toContainText("Git ist für diesen Vault gesperrt");
  await expect(d.locator('[data-grund="git"]')).toBeVisible();
  await page.click('[data-aktion="vertrauen-erlauben"]');
  await expect(d).toHaveCount(0);
  expect(stand.post).toEqual([{ erlauben: true }]);
  await expect(page.locator('[data-st="git-gesperrt"]')).toHaveCount(0);
  await expect(page.locator('[data-st="zweig"]')).toBeVisible();
  await expect(page.locator('[data-st="sync"]')).toBeVisible();
});

test("Git-Aktionen bei Sperre: nie der rohe Fehler, sondern die Frage; Verlauf und Notiz-Verlauf erklären es", async ({ page }) => {
  writeFileSync(join(vault, "00_inbox/neu.md"), "Neu\n"); // etwas zum Sichern
  const stand = await start(page, { vertrauen: vertrauenAntwort({ gruende: GRUENDE_ALLE.slice(1, 2) }) });
  await page.click('.dialog [data-aktion="vertrauen-spaeter"]');
  await expect(page.locator('[data-st="geaendert"]')).toBeVisible();
  // die Sperre kommt erst jetzt dazu (die Oberfläche kennt sie noch nicht): Abgleich → 409 gitGesperrt → Frage statt rohem Text
  stand.vertrauen = { ...stand.vertrauen, gitGesperrt: true };
  await page.click('[data-st="sync"]');
  await expect(dialogVertrauen(page)).toBeVisible();
  expect(stand.gitGesperrtAnfragen).toContain("sync");
  await expect(page.locator(".toast.fehler")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Roher Backend-Text");
  await expect(page.locator('[data-st="git-gesperrt"]')).toBeVisible();
  await page.keyboard.press("Escape");
  // Sichern (⌘⇧G): ohne Umweg die Frage
  await page.keyboard.press("Meta+Shift+g");
  await expect(dialogVertrauen(page)).toBeVisible();
  await expect(page.locator('[data-feld="nachricht"]')).toHaveCount(0);
  await page.keyboard.press("Escape");
  // Verlauf des Vaults: erklärender Block mit Knopf, der die Frage öffnet
  await page.keyboard.press("Meta+k");
  await page.keyboard.type(">Verlauf");
  await page.keyboard.press("Enter");
  const block = page.locator("#liste-koerper .vl-leer");
  await expect(block.locator(".vl-leer-titel")).toHaveText("Git ist für diesen Vault gesperrt");
  await expect(block).not.toContainText("Roher Backend-Text");
  await block.locator('[data-aktion="vertrauen"]').click();
  await expect(dialogVertrauen(page)).toBeVisible();
  await page.keyboard.press("Escape");
  // Verlauf der Notiz in den Eigenschaften (beim Öffnen einer Notiz neu geladen)
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("Kaffee");
  await page.keyboard.press("Enter");
  await expect(page.locator("#pfad .krume.aktuell")).toHaveText("Kaffee");
  await expect(page.locator('#info [data-sektion="verlauf"]')).toContainText("Git ist gesperrt, bis du diesem Vault vertraust.");
  await expect(page.locator('#info [data-sektion="verlauf"]')).not.toContainText("Roher Backend-Text");
});

test("Git-Status mit gesperrt: true (200) reicht, auch ohne info.vertrauen.gitGesperrt", async ({ page }) => {
  await page.addInitScript(() => { window.__aktionen = []; window.webkit = { messageHandlers: { aktion: { postMessage: (m) => { window.__aktionen.push(m); } } } }; });
  await mockeV2(page, vault);
  await page.route(/\/api\/git\/status$/, (r) => r.fulfill({ json: { repo: true, gesperrt: true, grund: "x" } }));
  await page.goto(server.url + "?pfad=" + encodeURIComponent(NOTIZ));
  await page.waitForSelector(".cm-content .cm-line");
  await expect(page.locator('[data-st="git-gesperrt"]')).toBeVisible();
  await expect(page.locator('[data-st="sync"]')).toHaveCount(0);
});

// ---------------------------------------------------------------- W4: „verbunden“ erst nach Erfolg
const KI_ROUTEN = async (page, mcp) => {
  await page.route("**/api/ki/erkennen", (r) => r.fulfill({ json: { agenten: [{ id: "claude", name: "Claude Code", version: "2.1.310", pfad: "/usr/local/bin/claude" }] } }));
  await page.route("**/api/mcp/verbinden", (r) => { mcp.push(r.request().postDataJSON()); return mcp.antwort(r, mcp.length); });
};
const statusClaude = (page) => page.locator('[data-st="claude"]');

test("W4: Schließen des KI-Dialogs allein setzt „Claude verbunden“ nicht; erst nach Erfolg", async ({ page }) => {
  const mcp = []; mcp.antwort = (r) => r.fulfill({ json: { ok: true } });
  await mockeV2(page, vault);
  await KI_ROUTEN(page, mcp);
  await page.goto(server.url + "?pfad=" + encodeURIComponent(NOTIZ));
  await page.waitForSelector(".cm-content .cm-line");
  await expect(statusClaude(page)).not.toHaveClass(/gut/);
  await statusClaude(page).click();
  await expect(page.locator('.dialog [data-aktion="claude-verbinden"]')).toBeVisible();
  await page.click('.dialog [data-aktion="ki-fertig"]'); // geschlossen, ohne zu verbinden
  await expect(page.locator(".dialog")).toHaveCount(0);
  await expect(statusClaude(page)).not.toHaveClass(/gut/);
  expect([...mcp]).toHaveLength(0);
  // jetzt wirklich verbinden
  await statusClaude(page).click();
  await page.click('.dialog [data-aktion="claude-verbinden"]');
  await expect(page.locator('.dialog [data-zeile="verbinden"] .w-ok')).toBeVisible();
  await expect(statusClaude(page)).toHaveClass(/gut/);
  expect([...mcp]).toEqual([{ ziel: "claude" }]);
});

test("W4: Eintrag „brain“ zeigt woandershin (409 anders): Rückfrage, Umstellen schickt umstellen:true; Nicht ändern lässt alles", async ({ page }) => {
  const mcp = []; mcp.antwort = (r) => (r.request().postDataJSON().umstellen ? r.fulfill({ json: { ok: true } }) : r.fulfill({ status: 409, json: { fehler: "Es gibt schon einen Server brain.", art: "anders" } }));
  await mockeV2(page, vault);
  await KI_ROUTEN(page, mcp);
  await page.goto(server.url + "?pfad=" + encodeURIComponent(NOTIZ));
  await page.waitForSelector(".cm-content .cm-line");
  await statusClaude(page).click();
  await page.click('.dialog [data-aktion="claude-verbinden"]');
  const frage = page.locator('.dialog [data-bereich="umstellen"]');
  await expect(frage).toContainText("In Claude gibt es schon einen Eintrag „brain“, der woanders hinzeigt. Auf dieses Brain umstellen?");
  await expect(frage.locator('[data-aktion="nicht-umstellen"]')).toBeFocused();
  await frage.locator('[data-aktion="nicht-umstellen"]').click();
  await expect(frage).toHaveCount(0);
  await page.click('.dialog [data-aktion="ki-fertig"]');
  await expect(statusClaude(page)).not.toHaveClass(/gut/);
  expect([...mcp]).toEqual([{ ziel: "claude" }]);
  // zweiter Anlauf: Umstellen
  await statusClaude(page).click();
  await page.click('.dialog [data-aktion="claude-verbinden"]');
  await page.click('.dialog [data-aktion="umstellen"]');
  await expect(page.locator('.dialog [data-zeile="verbinden"] .w-ok')).toBeVisible();
  expect({ ...mcp.at(-1) }).toEqual({ ziel: "claude", umstellen: true });
  await expect(statusClaude(page)).toHaveClass(/gut/);
});

test("W4: { schonVerbunden: true } zählt als Erfolg", async ({ page }) => {
  const mcp = []; mcp.antwort = (r) => r.fulfill({ json: { ok: true, schonVerbunden: true } });
  await mockeV2(page, vault);
  await KI_ROUTEN(page, mcp);
  await page.goto(server.url + "?pfad=" + encodeURIComponent(NOTIZ));
  await page.waitForSelector(".cm-content .cm-line");
  await statusClaude(page).click();
  await page.click('.dialog [data-aktion="claude-verbinden"]');
  await expect(page.locator('.dialog [data-zeile="verbinden"] .w-ok')).toBeVisible();
  await expect(statusClaude(page)).toHaveClass(/gut/);
});

// ---------------------------------------------------------------- k6: vorSchliessen meldet laufende Arbeit
test("k6: vorSchliessen meldet einen laufenden Abgleich wie ungespeicherte Eingaben, danach wieder ok", async ({ page }) => {
  await mockeV2(page, vault);
  await page.route("**/api/git/sync", async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.fallback(); });
  await page.goto(server.url + "?pfad=" + encodeURIComponent(NOTIZ));
  await page.waitForSelector(".cm-content .cm-line");
  expect(await page.evaluate(() => window.studio.vorSchliessen())).toEqual({ ok: true });
  await page.click('[data-st="sync"]');
  await expect(page.locator('[data-st="sync"]')).toContainText("Gleiche ab");
  expect(await page.evaluate(() => window.studio.vorSchliessen())).toEqual({ ok: false, grund: "Ein Abgleich läuft noch. Wenn du jetzt schließt, wird er abgebrochen." });
  await expect(page.locator('[data-st="sync"]')).not.toContainText("Gleiche ab", { timeout: 8000 });
  expect(await page.evaluate(() => window.studio.vorSchliessen())).toEqual({ ok: true });
});

test("k6: auch ein laufendes Sichern (Commit) wird gemeldet", async ({ page }) => {
  writeFileSync(join(vault, "00_inbox/neu.md"), "Neu\n");
  await mockeV2(page, vault);
  await page.route("**/api/git/commit", async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.fallback(); });
  await page.goto(server.url + "?pfad=" + encodeURIComponent(NOTIZ));
  await page.waitForSelector(".cm-content .cm-line");
  await expect(page.locator('[data-st="geaendert"]')).toContainText("geändert");
  await page.click('[data-st="geaendert"]');
  await page.fill('[data-feld="nachricht"]', "Neu");
  await page.click('[data-aktion="commit"]');
  const r = await page.evaluate(() => window.studio.vorSchliessen());
  expect(r.ok).toBe(false);
  expect(r.grund).toBe("Das Sichern läuft noch. Wenn du jetzt schließt, wird es abgebrochen.");
  await expect(page.locator(".toast")).toContainText("Gesichert", { timeout: 8000 });
  expect(await page.evaluate(() => window.studio.vorSchliessen())).toEqual({ ok: true });
});
