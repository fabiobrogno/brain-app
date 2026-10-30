// Workspace-Trust in der Oberfläche (P5): Frage „Kommt dieser Vault von dir?“, Statusleiste „Nur ansehen“, Vertrauen entziehen, Git gesperrt, Aktion an die App.
// Die Werkstatt-Antworten (info.vertrauen, POST /api/vertrauen, Git gesperrt) sind Attrappen aus mocks.mjs; der Rest läuft gegen die echte Werkstatt.
// UI_SHOTS=<Ordner>: legt die Bildschirmfotos der Vertrauens-Oberfläche dort ab (sonst screenshots/, ignoriert).
import { test, expect } from "./basis.mjs";
import { writeFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { mockeV2, mockeVertrauen, vertrauenAntwort, VERTRAUT } from "./mocks.mjs";

let vault, server;
test.beforeEach(async () => { ({ vault } = baueVault()); server = await starteServer(vault); });
test.afterEach(() => server?.stopp());

const shot = (name) => join(process.env.UI_SHOTS || "screenshots", `vertrauen-${name}.png`);
const NOTIZ = "10_notizen/Reise nach Lissabon.md";
// Der Vault, den die Frage zeigt und beim Erlauben mitschickt (die Werkstatt meldet den echten Pfad, auch hinter Verweisen wie /var → /private/var)
const echt = () => realpathSync(vault);
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

test("Frage erscheint bei einem nicht vertrauten Vault: „Kommt dieser Vault von dir?“, Optionen „Vertrauen“ / „Nur ansehen“, „Nur ansehen“ hat den Fokus", async ({ page }) => {
  await start(page, { vertrauen: vertrauenAntwort() });
  const d = dialogVertrauen(page);
  await expect(d).toBeVisible();
  await expect(d.locator(".dialog-kopf")).toHaveText("Kommt dieser Vault von dir?");
  await expect(d.locator('[data-vertrauen="intro"]')).toContainText("von außen geöffnet");
  await expect(d.locator('[data-vertrauen="folge"]')).toContainText("Git nutzen");
  await expect(d.locator('[data-vertrauen="folge"]')).toContainText("Bei „Nur ansehen“ kannst du den Vault lesen, durchsuchen und bearbeiten");
  await expect(d.locator('[data-vertrauen="git-gesperrt"]')).toContainText("ist Git gesperrt");
  await expect(d.locator('[data-aktion="vertrauen-erlauben"]')).toHaveText("Vertrauen");
  await expect(d.locator('[data-aktion="vertrauen-spaeter"]')).toHaveText("Nur ansehen");
  await expect(d).not.toContainText("Brain");
  await expect(d).not.toContainText(".tools");
  await page.screenshot({ path: shot("frage-hell") });
  // Sicherer Standard: ein versehentliches Enter erteilt kein Vertrauen
  await expect(d.locator('[data-aktion="vertrauen-spaeter"]')).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(d).toHaveCount(0);
  expect(await aktionen(page, "vertrauen-geaendert")).toHaveLength(0);
  await page.screenshot({ path: shot("nur-ansehen-statusleiste") });
});

test("Vertrauen: POST erlauben, Aktion an die App, danach Info, Git-Status, Index und Gesundheit neu", async ({ page }) => {
  const stand = await start(page, { vertrauen: vertrauenAntwort() });
  await expect(dialogVertrauen(page)).toBeVisible();
  await expect(page.locator('[data-st="zweig"]')).toHaveCount(0); // ohne Vertrauen keine Git-Angaben
  expect(await aktionen(page, "vertrauen-geaendert")).toHaveLength(0);
  const vorher = { ...stand.anfragen };
  await page.click('[data-aktion="vertrauen-erlauben"]');
  await expect(dialogVertrauen(page)).toHaveCount(0);
  expect(stand.post).toEqual([{ erlauben: true, vault: echt() }]); // der gezeigte Vault geht mit
  expect(await aktionen(page, "vertrauen-geaendert")).toEqual([{ aktion: "vertrauen-geaendert" }]);
  await expect.poll(() => stand.anfragen.info).toBeGreaterThan(vorher.info);
  await expect.poll(() => stand.anfragen.gitStatus).toBeGreaterThan(vorher.gitStatus);
  await expect.poll(() => stand.anfragen.notizen).toBeGreaterThan(vorher.notizen);
  await expect(page.locator('[data-st="gesundheit"]')).toBeVisible();
  await expect(page.locator('[data-st="vertrauen"]')).toHaveCount(0);
  await expect(page.locator('[data-st="zweig"]')).toBeVisible();
  await expect(page.locator(".toast")).toContainText("Vertrauen gespeichert");
});

test("Nur ansehen: einmal je Vault und Sitzung gefragt, danach über die Statusleiste „Nur ansehen“ erreichbar; Git-Angaben fehlen dort", async ({ page }) => {
  const stand = await start(page, { vertrauen: vertrauenAntwort() });
  await page.click('.dialog [data-aktion="vertrauen-spaeter"]');
  await expect(dialogVertrauen(page)).toHaveCount(0);
  expect(stand.post).toEqual([]);
  expect(await aktionen(page, "vertrauen-geaendert")).toHaveLength(0);
  const st = page.locator('[data-st="vertrauen"]');
  await expect(st).toBeVisible();
  await expect(st).toContainText("Nur ansehen");
  for (const id of ["zweig", "remote", "sync", "geaendert", "verlauf", "kein-git", "git-gesperrt"]) await expect(page.locator(`[data-st="${id}"]`)).toHaveCount(0);
  // Fokuswechsel und neu geladene Info fragen nicht von selbst noch einmal
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => stand.anfragen.info).toBeGreaterThan(1);
  await page.waitForTimeout(300);
  await expect(dialogVertrauen(page)).toHaveCount(0);
  // Statusleiste öffnet die Frage wieder; Esc schließt wie „Nur ansehen“
  await st.click();
  await expect(dialogVertrauen(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialogVertrauen(page)).toHaveCount(0);
  // auch die Einstellungen führen zur Frage
  await page.click('[data-st="einstellungen"]');
  await page.click('[data-menue="vertrauen"]');
  await expect(dialogVertrauen(page)).toBeVisible();
});

test("vertraut: keine Frage, kein Statusleisten-Eintrag „Nur ansehen“", async ({ page }) => {
  await start(page, { vertrauen: vertrauenAntwort(VERTRAUT) });
  await page.waitForTimeout(400);
  await expect(dialogVertrauen(page)).toHaveCount(0);
  await expect(page.locator('[data-st="vertrauen"]')).toHaveCount(0);
  await expect(page.locator('[data-st="zweig"]')).toBeVisible();
});

test("POST scheitert: Fehler im Dialog, Dialog bleibt, keine Aktion an die App", async ({ page }) => {
  const stand = await start(page, { vertrauen: vertrauenAntwort(), postFehler: { status: 500, fehler: "Das Vertrauen konnte nicht gespeichert werden." } });
  await page.click('[data-aktion="vertrauen-erlauben"]');
  await expect(dialogVertrauen(page).locator(".fehlertext")).toHaveText("Das Vertrauen konnte nicht gespeichert werden.");
  await expect(dialogVertrauen(page)).toBeVisible();
  await expect(page.locator('[data-aktion="vertrauen-erlauben"]')).toBeEnabled();
  expect(stand.post).toHaveLength(1);
  expect(await aktionen(page, "vertrauen-geaendert")).toHaveLength(0);
});

test("Rückweg: Einstellungen → „Vertrauen entziehen …“ fragt zurück, entzieht, meldet es der App; danach „Nur ansehen“ ohne neue Frage in dieser Sitzung", async ({ page }) => {
  const stand = await start(page, { vertrauen: vertrauenAntwort(VERTRAUT) });
  await expect(page.locator('[data-st="zweig"]')).toBeVisible();
  await page.click('[data-st="einstellungen"]');
  await expect(page.locator('[data-menue="vertrauen"]')).toHaveCount(0);
  await page.screenshot({ path: shot("einstellungen-vertrauen-entziehen") });
  await page.click('[data-menue="vertrauen-entziehen"]');
  const d = page.locator('.dialog[data-dialog="vertrauen-entziehen"]');
  await expect(d).toBeVisible();
  await expect(d.locator(".dialog-kopf")).toHaveText("Vertrauen entziehen?");
  await expect(d).toContainText("Git, Hintergrunddienst, Hooks und KI-Pflege sind aus");
  await page.screenshot({ path: shot("entziehen-frage") });
  // „Behalten“ hat den Fokus; nichts passiert
  await expect(d.locator('[data-aktion="vertrauen-behalten"]')).toBeFocused();
  await page.click('[data-aktion="vertrauen-behalten"]');
  await expect(d).toHaveCount(0);
  expect(stand.post).toEqual([]);
  await page.click('[data-st="einstellungen"]');
  await page.click('[data-menue="vertrauen-entziehen"]');
  await page.click('[data-aktion="vertrauen-entziehen"]');
  await expect(d).toHaveCount(0);
  expect(stand.post).toEqual([{ erlauben: false, vault: echt() }]);
  expect(await aktionen(page, "vertrauen-geaendert")).toEqual([{ aktion: "vertrauen-geaendert" }]);
  await expect(page.locator(".toast")).toContainText("Vertrauen entzogen");
  await expect(page.locator('[data-st="vertrauen"]')).toContainText("Nur ansehen");
  await expect(page.locator('[data-st="zweig"]')).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(400);
  await expect(dialogVertrauen(page)).toHaveCount(0);
});

test("Git gesperrt trotz Vertrauen (Status meldet gesperrt): die Statusleiste zeigt „Git gesperrt“, Klick zeigt den Grund", async ({ page }) => {
  await start(page, { vertrauen: vertrauenAntwort(VERTRAUT) });
  await page.route(/\/api\/git\/status$/, (r) => r.fulfill({ json: { repo: true, gesperrt: true, grund: "x" } }));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator('[data-st="git-gesperrt"]')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('[data-st="sync"]')).toHaveCount(0);
});

test("Git-Aktionen bei Sperre: nie der rohe Fehler, sondern die Frage; Verlauf und Notiz-Verlauf erklären es", async ({ page }) => {
  writeFileSync(join(vault, "00_inbox/neu.md"), "Neu\n"); // etwas zum Sichern
  const stand = await start(page, { vertrauen: vertrauenAntwort(VERTRAUT) });
  await expect(page.locator('[data-st="geaendert"]')).toBeVisible();
  // die Sperre kommt erst jetzt dazu (die Oberfläche kennt sie noch nicht): Abgleich → 409 gitGesperrt → Frage statt rohem Text
  stand.vertrauen = vertrauenAntwort();
  await page.click('[data-st="sync"]');
  await expect(dialogVertrauen(page)).toBeVisible();
  expect(stand.gitGesperrtAnfragen).toContain("sync");
  await expect(page.locator(".toast.fehler")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Roher Backend-Text");
  await expect(page.locator('[data-st="vertrauen"]')).toBeVisible();
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
  await expect(frage).toContainText("In Claude gibt es schon einen Eintrag „brain“, der woanders hinzeigt. Auf diesen Vault umstellen?");
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

// ---------------------------------------------------------------- UI-1: die Frage gehört zu genau einem Vault
// Zwei Attrappen-Vaults „Alpha“ (offen) und „Beta“, beide mit Kit; die Werkstatt wechselt über POST /api/vaults/aktiv. Info, Vault-Liste
// und Vertrauen kommen aus der Attrappe, alles andere (Baum, Notizen, Git) aus dem echten Server. stand.erlaubt = vertraute Pfade.
const ALPHA = "/V/alpha", BETA = "/V/beta";
const VAULT_NAME = (p) => (p === ALPHA ? "Alpha" : "Beta");
async function zweiVaults(page, { vertraut = [] } = {}) {
  const echtInfo = await (await fetch(server.url + "api/info")).json();
  const stand = { aktiv: ALPHA, wechsel: [], oeffnen: [], post: [], erlaubt: new Set(vertraut) };
  const vertrauenVon = (p) => (stand.erlaubt.has(p) ? { erlaubt: true, noetig: false, gitGesperrt: false, quelle: "bestaetigt" } : { erlaubt: false, noetig: true, gitGesperrt: true, quelle: null });
  await page.addInitScript(() => { window.__aktionen = []; window.webkit = { messageHandlers: { aktion: { postMessage: (m) => { window.__aktionen.push(m); } } } }; });
  await mockeV2(page, vault);
  await page.route("**/api/info", (r) => r.fulfill({ json: { ...echtInfo, vault: stand.aktiv, name: VAULT_NAME(stand.aktiv), kit: { vorhanden: true }, vertrauen: vertrauenVon(stand.aktiv) } }));
  await page.route("**/api/vaults", (r) => (r.request().method() === "GET"
    ? r.fulfill({ json: { vaults: [{ name: "Alpha", pfad: ALPHA, farbe: "#5b4ed6" }, { name: "Beta", pfad: BETA, farbe: "#2a9ba8" }], aktiv: stand.aktiv } }) : r.fallback()));
  await page.route("**/api/vaults/aktiv", (r) => { const b = r.request().postDataJSON(); stand.wechsel.push(b); stand.aktiv = b.pfad; r.fulfill({ json: { ok: true } }); });
  await page.route("**/api/vaults/oeffnen", (r) => { const b = r.request().postDataJSON(); stand.oeffnen.push(b); stand.aktiv = b.pfad; r.fulfill({ json: { pfad: b.pfad, git: true } }); });
  // wie die Werkstatt: vertraut wird nur der Vault, der offen ist, sonst 409 anderer-vault
  await page.route("**/api/vertrauen", (r) => {
    const b = r.request().postDataJSON();
    stand.post.push(b);
    if (b.vault !== stand.aktiv) return r.fulfill({ status: 409, json: { fehler: "Das ist nicht der Vault, der in der Werkstatt offen ist.", art: "anderer-vault" } });
    stand.erlaubt.add(b.vault);
    r.fulfill({ json: { kit: { vorhanden: true }, vertrauen: vertrauenVon(b.vault) } });
  });
  return stand;
}
const waehleVaultImMenue = async (page, name) => {
  await page.evaluate(() => window.studio.befehl("vault-wechseln")); // wie der Menübefehl ⌃⌘V; das Menü liegt über offenen Dialogen
  await page.locator('.menue [data-menue="vault"]', { hasText: name }).click();
};

test("UI-1: Vault-Wechsel schließt die offene Frage; die neue gilt dem neuen Vault, und erlaubt wird nur dieser", async ({ page }) => {
  const stand = await zweiVaults(page);
  await page.goto(server.url);
  const frage = dialogVertrauen(page);
  await expect(frage).toBeVisible();
  await expect(frage).toHaveAttribute("data-vault", ALPHA);
  await expect(frage.locator(".vt-vault")).toContainText("Alpha");
  // ohne zu antworten wechselt der Nutzer den Vault
  await waehleVaultImMenue(page, "Beta");
  await expect(page.locator("#vault-name")).toHaveText("Beta");
  expect(stand.wechsel).toEqual([{ pfad: BETA }]);
  // genau eine Frage, und die gehört zu Beta (nicht die alte mit dem Namen und den Gründen von Alpha)
  await expect(frage).toHaveCount(1);
  await expect(frage.locator(".vt-vault")).toContainText("Beta");
  await expect(frage).toHaveAttribute("data-vault", BETA);
  expect(stand.post).toEqual([]);
  // „Vertrauen“ erlaubt genau den gezeigten Vault und schickt seinen Pfad mit
  await page.click('[data-aktion="vertrauen-erlauben"]');
  await expect(frage).toHaveCount(0);
  expect(stand.post).toEqual([{ erlauben: true, vault: BETA }]);
  expect([...stand.erlaubt]).toEqual([BETA]);
});

test("UI-1: ein Wechsel auf einen vertrauten Vault lässt keine Frage stehen; zurück zum ersten (schon gefragt) bleibt es bei der Statusleiste", async ({ page }) => {
  const stand = await zweiVaults(page, { vertraut: [BETA] });
  await page.goto(server.url);
  await expect(dialogVertrauen(page)).toHaveAttribute("data-vault", ALPHA);
  await waehleVaultImMenue(page, "Beta");
  await expect(page.locator("#vault-name")).toHaveText("Beta");
  await expect(dialogVertrauen(page)).toHaveCount(0); // Beta ist vertraut: die alte Frage ist weg, eine neue gibt es nicht
  await page.waitForTimeout(300);
  await expect(dialogVertrauen(page)).toHaveCount(0);
  expect(stand.post).toEqual([]);
  // zurück zu Alpha: die Frage zu Alpha ist in dieser Sitzung schon einmal von selbst aufgegangen (je Vault und Sitzung einmal), jetzt zeigt nur die Statusleiste „Nur ansehen“
  await waehleVaultImMenue(page, "Alpha");
  await expect(page.locator("#vault-name")).toHaveText("Alpha");
  await expect(page.locator('[data-st="vertrauen"]')).toBeVisible();
});

test("UI-1: 409 anderer-vault — die Werkstatt hat inzwischen einen anderen Vault: nichts erlaubt, ehrlicher Satz, neu geladen, die Frage kommt für den jetzigen", async ({ page }) => {
  const stand = await zweiVaults(page);
  await page.goto(server.url);
  const frage = dialogVertrauen(page);
  await expect(frage).toHaveAttribute("data-vault", ALPHA);
  stand.aktiv = BETA; // die Werkstatt wechselt heimlich (anderes Fenster, Menübefehl), die Oberfläche weiß es noch nicht
  await page.click('[data-aktion="vertrauen-erlauben"]');
  await expect(page.locator(".toast.fehler")).toContainText("Das Vertrauen wurde nicht geändert: Inzwischen ist ein anderer Vault geöffnet.");
  await expect(page.locator("#vault-name")).toHaveText("Beta");
  await expect(frage).toHaveCount(1);
  await expect(frage).toHaveAttribute("data-vault", BETA);
  expect(stand.post).toEqual([{ erlauben: true, vault: ALPHA }]); // der gezeigte Vault ging mit, nicht der aktuelle
  expect([...stand.erlaubt]).toEqual([]); // nichts erlaubt
  expect(await aktionen(page, "vertrauen-geaendert")).toHaveLength(0);
  expect(await aktionen(page, "vault-gewechselt")).toHaveLength(1); // die App erfährt den Wechsel
  await expect(page.locator(".toast", { hasText: "Vertrauen gespeichert" })).toHaveCount(0);
});

test("UI-1: ein Vault-Wechsel schließt auch das Sichern-Fenster des alten Vaults (es würde sonst im neuen sichern)", async ({ page }) => {
  writeFileSync(join(vault, "00_inbox/neu.md"), "Neu\n");
  const stand = await zweiVaults(page, { vertraut: [ALPHA] });
  await page.goto(server.url);
  await expect(page.locator('[data-st="geaendert"]')).toContainText("geändert");
  await page.click('[data-st="geaendert"]');
  await expect(page.locator('[data-feld="nachricht"]')).toBeVisible();
  await waehleVaultImMenue(page, "Beta");
  await expect(page.locator("#vault-name")).toHaveText("Beta");
  await expect(page.locator('[data-feld="nachricht"]')).toHaveCount(0);
  await expect(dialogVertrauen(page)).toHaveAttribute("data-vault", BETA); // und für den neuen Vault fragt die Oberfläche selbst
  expect(stand.wechsel).toEqual([{ pfad: BETA }]);
});

test("UI-1: ein Vault-Wechsel schließt auch „Schnell merken“ des alten Vaults; was getippt wurde, bleibt als Entwurf", async ({ page }) => {
  await zweiVaults(page, { vertraut: [ALPHA, BETA] });
  await page.goto(server.url);
  await page.waitForFunction(() => window.__studioBereit === true);
  await page.evaluate(() => window.studio.merken());
  await page.locator('[data-feld="text"]').fill("Ein Gedanke, der nicht verloren gehen soll");
  await waehleVaultImMenue(page, "Beta");
  await expect(page.locator("#vault-name")).toHaveText("Beta");
  await expect(page.locator('[data-feld="text"]')).toHaveCount(0);
  expect(JSON.parse(await page.evaluate(() => sessionStorage.getItem("brain-studio.entwurf.merken")))).toMatchObject({ text: "Ein Gedanke, der nicht verloren gehen soll" });
});

test("UI-1: „Vault öffnen …“ bei offener Frage: danach gilt die Frage dem geöffneten Vault, und erlaubt wird nur dieser", async ({ page }) => {
  const stand = await zweiVaults(page);
  await page.goto(server.url);
  const frage = dialogVertrauen(page);
  await expect(frage.locator(".vt-vault")).toContainText("Alpha");
  // Menübefehl „Vault öffnen …“ (⇧⌘O): im Browser fragt die Oberfläche selbst nach dem Pfad; die Karte liegt über der offenen Frage
  await page.evaluate(() => window.studio.befehl("vault-oeffnen"));
  await page.locator('[data-feld="pfad"]').fill(BETA);
  await page.locator('[data-aktion="pfad-uebernehmen"]').click();
  await expect(page.locator("#vault-name")).toHaveText("Beta");
  expect(stand.oeffnen).toEqual([{ pfad: BETA }]);
  await expect(frage).toHaveCount(1);
  await expect(frage.locator(".vt-vault")).toContainText("Beta");
  await expect(frage).toHaveAttribute("data-vault", BETA);
  await page.click('[data-aktion="vertrauen-erlauben"]');
  await expect(frage).toHaveCount(0);
  expect(stand.post).toEqual([{ erlauben: true, vault: BETA }]);
  expect([...stand.erlaubt]).toEqual([BETA]); // Alpha bleibt unvertraut
});

test("UI-1: schliesseDialoge schließt alle offenen Dialoge; jedes beiSchliessen läuft genau einmal, auch bei doppeltem Schließen", async ({ page }) => {
  await mockeV2(page, vault);
  await page.goto(server.url + "?pfad=" + encodeURIComponent(NOTIZ));
  await page.waitForSelector(".cm-content .cm-line");
  const r = await page.evaluate(async () => {
    const { dialog, schliesseDialoge, h } = await import("/hilfen.js");
    const zaehler = { a: 0, b: 0 };
    const a = dialog({ titel: "A", rumpf: [h("p", { text: "a" })], beiSchliessen: () => { zaehler.a++; } });
    dialog({ titel: "B", rumpf: [h("p", { text: "b" })], beiSchliessen: () => { zaehler.b++; } });
    const offen = document.querySelectorAll("#dialog-host .schleier").length;
    a.schliessen(); a.schliessen(); // doppelt: harmlos
    const dazwischen = document.querySelectorAll("#dialog-host .schleier").length;
    schliesseDialoge(); schliesseDialoge();
    return { offen, dazwischen, danach: document.querySelectorAll("#dialog-host .schleier").length, zaehler };
  });
  expect(r).toEqual({ offen: 2, dazwischen: 1, danach: 0, zaehler: { a: 1, b: 1 } });
});

// ---------------------------------------------------------------- nach dem Abgleich wird die Info neu geholt: ist das Vertrauen weg, erfährt es die App
test("Abgleich: ist das Vertrauen inzwischen weg (z. B. in einem anderen Fenster entzogen), sagt die Oberfläche es der App und fragt neu, auch beim zweiten Mal", async ({ page }) => {
  const stand = await start(page, { vertrauen: vertrauenAntwort(VERTRAUT) });
  await page.waitForSelector('[data-st="sync"]');
  await expect(dialogVertrauen(page)).toHaveCount(0);
  // erster Abgleich ohne Änderung: keine Aktion, keine Frage
  await page.click('[data-st="sync"]');
  await expect(page.locator(".toast", { hasText: "Alles auf dem neuesten Stand." })).toBeVisible();
  await expect.poll(() => stand.anfragen.info).toBeGreaterThan(1); // die Info wurde nach dem Abgleich neu geholt
  expect(await aktionen(page, "vertrauen-geaendert")).toHaveLength(0);
  await expect(dialogVertrauen(page)).toHaveCount(0);
  // jetzt ist das Vertrauen während des Abgleichs weggefallen (anderes Fenster)
  await page.route("**/api/git/sync", async (route) => { stand.vertrauen = vertrauenAntwort(); await route.fallback(); });
  const infoVorher = stand.anfragen.info;
  await page.click('[data-st="sync"]');
  await expect(dialogVertrauen(page)).toBeVisible();
  expect(stand.anfragen.info).toBeGreaterThan(infoVorher);
  expect(await aktionen(page, "vertrauen-geaendert")).toEqual([{ aktion: "vertrauen-geaendert" }]);
  // Vertrauen erteilt (zweite Aktion nach dem POST) ...
  await page.click('[data-aktion="vertrauen-erlauben"]');
  await expect(dialogVertrauen(page)).toHaveCount(0);
  expect(await aktionen(page, "vertrauen-geaendert")).toHaveLength(2);
  // ... und fällt es noch einmal weg: wieder die Frage
  await page.route("**/api/git/sync", async (route) => { stand.vertrauen = vertrauenAntwort(); await route.fallback(); }, { times: 1 });
  await page.click('[data-st="sync"]');
  await expect(dialogVertrauen(page)).toBeVisible();
  expect(await aktionen(page, "vertrauen-geaendert")).toHaveLength(3);
});

test("Abgleich abgebrochen (409 Konflikt): auch dann Info neu, Aktion an die App und die Frage, wenn das Vertrauen weg ist", async ({ page }) => {
  const stand = await start(page, { vertrauen: vertrauenAntwort(VERTRAUT) });
  await page.waitForSelector('[data-st="sync"]');
  await page.route("**/api/git/sync", async (route) => {
    stand.vertrauen = vertrauenAntwort();
    await route.fulfill({ status: 409, json: { fehler: "Beim Abgleich ist ein Konflikt entstanden. Es wurde nichts verändert." } });
  });
  await page.click('[data-st="sync"]');
  await expect(page.locator(".toast.fehler")).toContainText("Konflikt");
  await expect(dialogVertrauen(page)).toBeVisible();
  expect(await aktionen(page, "vertrauen-geaendert")).toEqual([{ aktion: "vertrauen-geaendert" }]);
});

// ---------------------------------------------------------------- UI-4: nach dem Vertrauen kein „Git gesperrt“ mehr
test("UI-4: nach dem Vertrauen laden Verlauf-Ansicht und Notiz-Verlauf neu (kein „Git gesperrt“ mehr)", async ({ page }) => {
  await start(page, { vertrauen: vertrauenAntwort() });
  await page.click('.dialog [data-aktion="vertrauen-spaeter"]');
  // Verlauf-Ansicht und Notiz-Verlauf zeigen die Sperre
  await page.keyboard.press("Meta+k");
  await page.keyboard.type(">Verlauf");
  await page.keyboard.press("Enter");
  const block = page.locator("#liste-koerper .vl-leer");
  await expect(block.locator(".vl-leer-titel")).toHaveText("Git ist für diesen Vault gesperrt");
  await expect(page.locator('#info [data-sektion="verlauf"]')).toContainText("Git ist gesperrt, bis du diesem Vault vertraust.");
  // „Vertrauen prüfen“ → „Vertrauen“
  await block.locator('[data-aktion="vertrauen"]').click();
  await page.click('[data-aktion="vertrauen-erlauben"]');
  await expect(dialogVertrauen(page)).toHaveCount(0);
  // die Liste zeigt jetzt den Verlauf, die Notiz ihre Fassungen — ohne die Ansicht oder die Notiz zu wechseln
  await expect(page.locator("#liste-koerper .vl-commitzeile").first()).toBeVisible();
  await expect(page.locator("#liste-koerper .vl-leer")).toHaveCount(0);
  await expect(page.locator('#info [data-sektion="verlauf"]')).not.toContainText("ist Git gesperrt");
  await expect(page.locator('#info [data-sektion="verlauf"] .fassung').first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Git ist für diesen Vault gesperrt");
});

// ---------------------------------------------------------------- UI-5: „Übersicht öffnen“ erklärt sich
// Die App antwortet auf die Aktion „ansicht“ mit { ok: true } oder { ok: false, grund: "kein-kit" | "nicht-vertraut" } (AppZustand.swift).
async function startMitAntworten(page, opt) {
  await page.addInitScript(() => {
    window.__aktionen = []; window.__antwort = { ok: true };
    window.webkit = { messageHandlers: { aktion: { postMessage: (m) => { window.__aktionen.push(m); return Promise.resolve(m.aktion === "ansicht" ? window.__antwort : undefined); } } } };
  });
  await mockeV2(page, vault);
  const stand = await mockeVertrauen(page, opt);
  await page.goto(server.url + "?pfad=" + encodeURIComponent(NOTIZ));
  await page.waitForSelector(".cm-content .cm-line");
  return stand;
}
const antwort = (page, wert) => page.evaluate((w) => { window.__antwort = w; }, wert);
const uebersichtPalette = async (page) => { await page.keyboard.press("Meta+k"); await page.keyboard.type(">Übersicht"); await page.keyboard.press("Enter"); };

test("UI-5: „Übersicht öffnen“ ohne Vertrauen: kein Hindernis; ohne Kit: Satz; geöffnet: nichts", async ({ page }) => {
  await startMitAntworten(page, { vertrauen: vertrauenAntwort() });
  await page.click('.dialog [data-aktion="vertrauen-spaeter"]'); // die Frage vom Start
  // 1. ohne Vertrauen öffnet die App die Übersicht trotzdem (der Kern liest nur): keine Meldung, keine neue Frage
  await uebersichtPalette(page);
  await expect.poll(() => aktionen(page, "ansicht").then((a) => a.length)).toBe(1);
  await expect(dialogVertrauen(page)).toHaveCount(0);
  // 2. kein Kit im Vault → Satz, keine Frage (aus dem Einstellungsmenü)
  await antwort(page, { ok: false, grund: "kein-kit" });
  await page.click('[data-st="einstellungen"]');
  await page.click('.menue [data-menue="uebersicht"]');
  await expect(page.locator(".toast", { hasText: "keine Übersicht" })).toContainText("Für diesen Ordner gibt es keine Übersicht: Es fehlt die Datei brain.config.json");
  await expect(dialogVertrauen(page)).toHaveCount(0);
  expect(await aktionen(page, "ansicht")).toHaveLength(2);
  // 3. geöffnet → keine Meldung, keine Frage
  await antwort(page, { ok: true });
  const toastsVorher = await page.locator(".toast").count();
  await uebersichtPalette(page);
  await expect.poll(() => aktionen(page, "ansicht").then((a) => a.length)).toBe(3);
  await page.waitForTimeout(250);
  await expect(dialogVertrauen(page)).toHaveCount(0);
  expect(await page.locator(".toast").count()).toBeLessThanOrEqual(toastsVorher);
});

test("UI-5: der Kern ist nicht bereit: klarer Satz, keine Vertrauensfrage (Kern-Umzug P4)", async ({ page }) => {
  await startMitAntworten(page, { vertrauen: vertrauenAntwort(VERTRAUT) });
  await antwort(page, { ok: false, grund: "kern-nicht-bereit" });
  await uebersichtPalette(page);
  await expect(page.locator(".toast.fehler")).toContainText("Der Kern von Kortex ist nicht bereit.");
  await expect(dialogVertrauen(page)).toHaveCount(0);
  expect(await aktionen(page, "ansicht")).toHaveLength(1);
});

test("UI-5: unbekannte Gründe der App (auch die alten „nicht-vertraut“ und „pruefung-fehlgeschlagen“) werden benannt, nie verschwiegen", async ({ page }) => {
  await startMitAntworten(page, { vertrauen: vertrauenAntwort(VERTRAUT) });
  await antwort(page, { ok: false, grund: "pruefung-fehlgeschlagen" });
  await uebersichtPalette(page);
  await expect(page.locator(".toast.fehler", { hasText: "Die Übersicht ließ sich nicht öffnen." })).toBeVisible();
  expect(await aktionen(page, "ansicht")).toHaveLength(1);
  // ein Grund, den die Oberfläche nicht kennt (oder gar keiner): der allgemeine Satz statt Schweigen
  await antwort(page, { ok: false, grund: "vault-fehlt" });
  await uebersichtPalette(page);
  await expect(page.locator(".toast.fehler", { hasText: "Die Übersicht ließ sich nicht öffnen." })).toHaveCount(2); // die erste Meldung steht noch
  await antwort(page, { ok: false });
  await uebersichtPalette(page);
  await expect.poll(() => aktionen(page, "ansicht").then((a) => a.length)).toBe(3);
  await expect(page.locator(".toast.fehler", { hasText: "Die Übersicht ließ sich nicht öffnen." })).toHaveCount(3);
  await expect(dialogVertrauen(page)).toHaveCount(0);
});

// ---------------------------------------------------------------- UI-3: Schließen meldet die richtige Arbeit
test("UI-3: vorSchliessen nennt die laufende Arbeit beim Namen (Öffnen, Anlegen, Klonen …), nie fälschlich den Abgleich", async ({ page }) => {
  await mockeV2(page, vault);
  await page.goto(server.url + "?pfad=" + encodeURIComponent(NOTIZ));
  await page.waitForSelector(".cm-content .cm-line");
  const grund = (art) => page.evaluate(async (a) => {
    const { arbeitBeginnt } = await import("/hilfen.js");
    const ende = arbeitBeginnt(a);
    try { return (await window.studio.vorSchliessen()).grund; } finally { ende(); }
  }, art);
  expect(await grund("oeffnen")).toBe("Das Öffnen des Ordners läuft noch. Wenn du jetzt schließt, wird es abgebrochen.");
  expect(await grund("neu")).toBe("Das Anlegen des Vaults läuft noch. Wenn du jetzt schließt, wird es abgebrochen.");
  expect(await grund("klonen")).toBe("Das Klonen läuft noch. Wenn du jetzt schließt, wird es abgebrochen.");
  expect(await grund("remote")).toBe("Das Verbinden mit dem Remote läuft noch. Wenn du jetzt schließt, wird es abgebrochen.");
  expect(await grund("sync")).toBe("Ein Abgleich läuft noch. Wenn du jetzt schließt, wird er abgebrochen.");
  expect(await grund("commit")).toBe("Das Sichern läuft noch. Wenn du jetzt schließt, wird es abgebrochen.");
  // eine Arbeit ohne eigenen Satz bekommt den neutralen Rückfall, nicht die Worte des Abgleichs
  expect(await grund("etwas-neues")).toBe("Es läuft noch etwas. Wenn du jetzt schließt, wird es abgebrochen.");
  expect(await page.evaluate(() => window.studio.vorSchliessen())).toEqual({ ok: true });
});

test("UI-3: während „Vault öffnen …“ läuft, sagt vorSchliessen es richtig (nicht „Ein Abgleich läuft noch“), danach ist es wieder frei", async ({ page }) => {
  await mockeV2(page, vault);
  let freigeben; const warte = new Promise((ok) => { freigeben = ok; });
  await page.route("**/api/vaults/oeffnen", async (route) => { await warte; await route.fulfill({ status: 400, json: { fehler: "Dieser Ordner lässt sich nicht öffnen." } }); });
  await page.goto(server.url + "?pfad=" + encodeURIComponent(NOTIZ));
  await page.waitForSelector(".cm-content .cm-line");
  await page.evaluate(() => window.studio.befehl("vault-oeffnen"));
  await page.locator('[data-feld="pfad"]').fill("/tmp/irgendein-ordner"); // im Browser fragt die Oberfläche selbst nach dem Pfad
  await page.locator('[data-aktion="pfad-uebernehmen"]').click();
  await expect(page.locator("#willkommen-host .w-arbeit")).toBeVisible();
  const r = await page.evaluate(() => window.studio.vorSchliessen());
  expect(r).toEqual({ ok: false, grund: "Das Öffnen des Ordners läuft noch. Wenn du jetzt schließt, wird es abgebrochen." });
  freigeben();
  await expect(page.locator("#willkommen-host .w-fehlerbox")).toContainText("Dieser Ordner lässt sich nicht öffnen.");
  expect(await page.evaluate(() => window.studio.vorSchliessen())).toEqual({ ok: true });
});
