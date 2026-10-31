// Mitteilungen und Aktivität (Paket P8a, Studio-Teil): der Hinweis unten rechts („Claude Code hat 2 Aufgaben angelegt“ mit „Ansehen“ und „Rückgängig“), die Schalter der Einstellungen,
// das Aktivitätsprotokoll in Einstellungen → KI & Konten und die API von mitteilungen.js. Läuft gegen die echte Werkstatt mit Wegwerf-Vault und Wegwerf-Support-Ordner: das Protokoll
// wird mit demselben Schreiber angelegt, den auch MCP-Server und Hooks benutzen (gemeinsam/aktivitaet.mjs); die Werkstatt meldet neue Einträge über den Live-Strom (alle ~1 s).
// UI_SHOTS=<Ordner>: legt die Bildschirmfotos dort ab (sonst screenshots/, ignoriert).
import { test, expect } from "./basis.mjs";
import { join, basename } from "node:path";
import { mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { mockeV2 } from "./mocks.mjs";
import { mockeKonten } from "./mocks-konten.mjs";

const WURZEL = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const protokoll = await import(pathToFileURL(join(WURZEL, "Ressourcen/gemeinsam/aktivitaet.mjs")).href);
const studio = (datei) => import(pathToFileURL(join(WURZEL, "Ressourcen/studio", datei)).href);

let vault, server;
test.beforeEach(async () => { ({ vault } = baueVault()); vault = realpathSync(vault); server = await starteServer(vault); });
test.afterEach(() => server?.stopp());

const shot = (name) => join(process.env.UI_SHOTS || "screenshots", `akt-${name}.png`);
const foto = async (page, name) => { await page.waitForTimeout(450); await page.screenshot({ path: shot(name) }); };
const sha = (text) => createHash("sha256").update(text).digest("hex");
const seite = (page) => page.locator("[data-einstellungen]");
const hinweise = (page) => page.locator("#toast-host .toast");

// ---- Wegwerf-Daten
// Eine Aufgabe, wie Kortex sie für eine KI ablegt (quelle ki:claude-code: ohne das Protokoll würde der ältere Hinweis „Claude hat eine Aufgabe angelegt“ erscheinen)
function aufgabeDatei(name, text = null) {
  const pfad = `05_aufgaben/${name}.md`;
  const inhalt = text ?? ["---", "typ: aufgabe", `titel: ${JSON.stringify(name)}`, "status: offen", "prioritaet: normal", "rang: 1000", "erstellt: 2026-10-30T08:00:00Z", "geaendert: 2026-10-30T08:00:00Z", "quelle: ki:claude-code", "---", ""].join("\n");
  mkdirSync(join(vault, "05_aufgaben"), { recursive: true });
  writeFileSync(join(vault, pfad), inhalt);
  return { pfad, hash: sha(inhalt) };
}
// Eintrag im Protokoll des offenen Vaults. extra: Felder des Eintrags (art, wer, text …)
const melde = (art, extra = {}) => protokoll.schreibeEreignis(server.support, vault, { art, vaultName: "Kortex", konto: null, programm: "claude", wer: "Claude Code", ...extra });
const meldeAblage = (a, extra = {}) => melde("ablage-aufgabe", { text: "hat eine Aufgabe angelegt.", pfade: [a.pfad], rueckgaengig: { art: "ablage-entfernen", pfad: a.pfad, hash: a.hash }, ...extra });
const meldeAbweisung = (extra = {}) => melde("abweisung", { wer: "Codex", programm: "codex", grund: "gesperrt", text: "wollte den Vault „Firma“ lesen und wurde abgewiesen. Stufe „Gesperrt“ hat gewirkt.", vaultName: "Firma", ...extra });
const setzeSchalter = (werte) => writeFileSync(join(server.support, "einstellungen.json"), JSON.stringify(werte));

// ---- Studio öffnen
async function oeffneStudio(page, { dunkel = false } = {}) {
  if (dunkel) await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(server.url);
  await page.waitForSelector("[data-karte], [data-leer]", { timeout: 10000 });
  await page.waitForSelector('html[data-live="an"]', { timeout: 10000 });
  await page.waitForTimeout(300);
}
// Einstellungen → KI & Konten → Aktivitätsprotokoll (die Konten sind Attrappen wie in ki-konten.spec.mjs; das Protokoll kommt von der echten Werkstatt)
async function oeffneProtokoll(page, { dunkel = false, hash = "#einstellungen/ki?ziel=ki-aktivitaet" } = {}) {
  await page.setViewportSize({ width: 1440, height: 900 });
  if (dunkel) await page.emulateMedia({ colorScheme: "dark" });
  await mockeV2(page, vault);
  await mockeKonten(page, { vaults: [{ pfad: vault, name: "Kortex" }, { pfad: "/Users/test/Firma-Vault", name: "Firma" }] });
  await page.goto(server.url);
  await page.waitForSelector("#app:not([hidden])");
  await page.waitForFunction(() => window.__studioBereit === true);
  await page.waitForSelector('html[data-live="an"]', { timeout: 10000 });
  await page.evaluate((h) => { location.hash = h; }, hash);
  await expect(seite(page)).toBeVisible();
}
const zeilen = (page) => page.locator('[data-kx="aktivitaet-liste"] li');

// =====================================================================================================================================
// (a) Hinweis unten rechts
for (const [schema, dunkel] of [["hell", false], ["dunkel", true]]) {
  test(`Hinweis (${schema}): zwei Aufgaben einer KI werden EIN Hinweis mit „Ansehen“ und „Rückgängig“; der ältere Hinweis erscheint nicht zusätzlich`, async ({ page }) => {
    await oeffneStudio(page, { dunkel });
    const a = aufgabeDatei("ki-eins"), b = aufgabeDatei("ki-zwei");
    meldeAblage(a); meldeAblage(b);
    const t = page.locator("#toast-host .toast.reich");
    await expect(t).toHaveCount(1, { timeout: 8000 });
    await expect(t.locator(".toast-titel")).toHaveText("Claude Code hat 2 Aufgaben angelegt");
    await expect(t.locator(".toast-titel b")).toHaveText("Claude Code");
    await expect(t.locator(".toast-unter")).toHaveText("Aufgaben · Vault Kortex");
    await expect(t.locator(".toast-logo [data-ki-logo='claude']")).toBeVisible();
    await expect(t.getByRole("button", { name: "Ansehen" })).toBeVisible();
    await expect(t.getByRole("button", { name: "Rückgängig" })).toBeVisible();
    await expect(t).toHaveAttribute("role", "status");
    await foto(page, `toast-${schema}`);
    // der alte Hinweis („Claude hat 2 Aufgaben angelegt: …“) bleibt aus, weil das Protokoll den Weg schon abdeckt
    await page.waitForTimeout(2200);
    await expect(hinweise(page)).toHaveCount(1);
    await expect(hinweise(page)).not.toContainText("Claude hat");
    // „Ansehen“ → Aufgaben-Board
    await t.getByRole("button", { name: "Ansehen" }).click();
    await expect(page.locator("[data-spalte='offen']")).toBeVisible();
    await expect(hinweise(page)).toHaveCount(0);
  });
}

test("Hinweis: „Rückgängig“ nimmt beide Ablagen zurück (Dateien weg), danach „Zurückgenommen“", async ({ page }) => {
  await oeffneStudio(page);
  const a = aufgabeDatei("weg-eins"), b = aufgabeDatei("weg-zwei");
  meldeAblage(a); meldeAblage(b);
  const t = page.locator("#toast-host .toast.reich");
  await expect(t).toHaveCount(1, { timeout: 8000 });
  const antworten = [];
  page.on("response", (r) => { if (r.url().includes("/api/aktivitaet/rueckgaengig")) antworten.push(r.status()); });
  await t.getByRole("button", { name: "Rückgängig" }).click();
  await expect(hinweise(page).filter({ hasText: "Ablagen zurückgenommen" })).toBeVisible({ timeout: 8000 });
  expect(antworten).toEqual([200, 200]);
  expect(existsSync(join(vault, a.pfad))).toBe(false);
  expect(existsSync(join(vault, b.pfad))).toBe(false);
});

test("Hinweis: eine einzelne Ablage → „Zurückgenommen“; war die Notiz inzwischen geändert, löscht Kortex nichts und sagt es (Rückfrage mit „Ansehen“)", async ({ page }) => {
  await oeffneStudio(page);
  const a = aufgabeDatei("einzeln");
  meldeAblage(a);
  await expect(hinweise(page).filter({ hasText: "Claude Code hat eine Aufgabe angelegt" })).toHaveCount(1, { timeout: 8000 });
  await hinweise(page).getByRole("button", { name: "Rückgängig" }).click();
  await expect(hinweise(page).filter({ hasText: /^Zurückgenommen$/ })).toBeVisible({ timeout: 8000 });
  expect(existsSync(join(vault, a.pfad))).toBe(false);
  // jetzt eine, die der Nutzer inzwischen bearbeitet hat
  const b = aufgabeDatei("bearbeitet");
  meldeAblage(b);
  await expect(hinweise(page).filter({ hasText: "Claude Code hat eine Aufgabe angelegt" })).toHaveCount(1, { timeout: 8000 });
  writeFileSync(join(vault, b.pfad), readFileSync(join(vault, b.pfad), "utf8") + "\nMeine eigene Ergänzung.\n");
  await page.waitForTimeout(300);
  await hinweise(page).getByRole("button", { name: "Rückgängig" }).click();
  const meldung = hinweise(page).filter({ hasText: "seit der Ablage geändert" });
  await expect(meldung).toBeVisible({ timeout: 8000 });
  await expect(meldung).toContainText("Kortex entfernt sie nicht");
  await expect(meldung.getByRole("button", { name: "Ansehen" })).toBeVisible();
  expect(existsSync(join(vault, b.pfad))).toBe(true); // NICHT gelöscht
  expect(readFileSync(join(vault, b.pfad), "utf8")).toContain("Meine eigene Ergänzung.");
});

test("Hinweis: Abweisung einer KI (rot getönt, ohne „Rückgängig“); „Ansehen“ führt zum Aktivitätsprotokoll in den Einstellungen", async ({ page }) => {
  await oeffneStudio(page);
  meldeAbweisung();
  const t = hinweise(page).filter({ hasText: "wurde abgewiesen" });
  await expect(t).toHaveCount(1, { timeout: 8000 });
  await expect(t.locator(".toast-titel")).toHaveText("Codex wollte den Vault „Firma“ lesen und wurde abgewiesen");
  await expect(t.locator(".toast-unter")).toContainText("Vault Firma");
  await expect(t.locator(".toast-unter")).toContainText("Stufe „Gesperrt“ hat gewirkt.");
  await expect(t).toHaveClass(/fehler/);
  await expect(t.getByRole("button", { name: "Rückgängig" })).toHaveCount(0);
  await t.getByRole("button", { name: "Ansehen" }).click();
  await expect(seite(page)).toBeVisible();
  await expect(page.locator(".e-punkt[data-bereich='ki'][aria-current='true']")).toBeVisible();
  await expect(page.locator('[data-zeile="ki-aktivitaet"]')).toBeVisible();
  await expect(page.locator('[data-kx="aktivitaet-liste"] li[data-art="abweisung"]')).toHaveCount(1, { timeout: 8000 });
});

test("Hinweis: der Befehl „aktivitaet“ der App (Klick auf eine macOS-Mitteilung) öffnet das Aktivitätsprotokoll", async ({ page }) => {
  await oeffneStudio(page);
  await page.evaluate(() => window.studio.befehl("aktivitaet"));
  await expect(seite(page)).toBeVisible();
  expect(await page.evaluate(() => location.hash)).toBe("#einstellungen/ki?ziel=ki-aktivitaet");
  await expect(page.locator('[data-zeile="ki-aktivitaet"]')).toBeVisible();
});

test("Hinweis: Notiz im Posteingang abgelegt; „Ansehen“ führt in den Posteingang; ohne zurücknehmbare Datei kein „Rückgängig“", async ({ page }) => {
  await oeffneStudio(page);
  melde("ablage-notiz", { wer: "Claude Code · Privat", text: "hat eine Notiz im Posteingang abgelegt.", pfade: ["00_inbox/x.md"] });
  const t = hinweise(page).filter({ hasText: "hat eine Notiz im Posteingang abgelegt" });
  await expect(t).toHaveCount(1, { timeout: 8000 });
  await expect(t.locator(".toast-titel")).toHaveText("Claude Code · Privat hat eine Notiz im Posteingang abgelegt");
  await expect(t.locator(".toast-unter")).toHaveText("Posteingang · Vault Kortex");
  await expect(t.getByRole("button", { name: "Rückgängig" })).toHaveCount(0);
  await t.getByRole("button", { name: "Ansehen" }).click();
  await expect(page.locator('[data-bereich="inbox"][aria-current="true"], [data-bereich="inbox"].aktiv, [data-bereich="inbox"][aria-selected="true"]').first()).toBeVisible();
});

// Ende zu Ende: der echte MCP-Server legt eine Aufgabe an und schreibt ins Protokoll (ohne BRAIN_NUTZUNG=aus) → Hinweis mit „Ansehen“ und „Rückgängig“, der ältere Hinweis bleibt aus
test("Ende zu Ende: brain_aufgabe_anlegen über den echten MCP-Server → Hinweis „Claude Code hat eine Aufgabe angelegt“, „Rückgängig“ entfernt die Aufgabe wieder", async ({ page }) => {
  await oeffneStudio(page);
  const home = mkdtempSync(join(tmpdir(), "brain-ui-home-"));
  const env = { PATH: "/usr/bin:/bin", HOME: home, BRAIN_APP_SUPPORT: server.support, BRAIN_TESTMODUS: "1", KORTEX_VAULT_VERTRAUT: "alle" };
  const mcp = spawn(process.execPath, [join(WURZEL, "Ressourcen/mcp/brain-mcp.mjs"), vault], { stdio: ["pipe", "pipe", "ignore"], env, cwd: home });
  try {
    const antworten = new Map(), wartende = new Map();
    createInterface({ input: mcp.stdout }).on("line", (z) => { const o = JSON.parse(z); const w = wartende.get(o.id); if (w) w(o); else antworten.set(o.id, o); });
    const frage = (id, method, params) => new Promise((ok) => { if (antworten.has(id)) return ok(antworten.get(id)); wartende.set(id, ok); mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
    await frage(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "2" } });
    const a = await frage(2, "tools/call", { name: "brain_aufgabe_anlegen", arguments: { titel: "Per MCP angelegt", prioritaet: "hoch" } });
    expect(a.result.isError).not.toBe(true);
    const hinweis = hinweise(page).filter({ hasText: "Claude Code hat eine Aufgabe angelegt" });
    await expect(hinweis).toHaveCount(1, { timeout: 8000 });
    await expect(hinweis.getByRole("button", { name: "Ansehen" })).toBeVisible();
    await expect(hinweis.getByRole("button", { name: "Rückgängig" })).toBeVisible();
    await page.waitForTimeout(2000);
    await expect(hinweise(page).filter({ hasText: "Claude hat eine Aufgabe angelegt" })).toHaveCount(0); // der ältere Hinweis nicht zusätzlich
    await expect(hinweise(page)).toHaveCount(1);
    const datei = (await page.evaluate(async () => (await (await fetch("/api/aktivitaet?limit=5")).json()).ereignisse[0].pfade[0]));
    expect(existsSync(join(vault, datei))).toBe(true);
    await hinweis.getByRole("button", { name: "Rückgängig" }).click();
    await expect(hinweise(page).filter({ hasText: /^Zurückgenommen$/ })).toBeVisible({ timeout: 8000 });
    expect(existsSync(join(vault, datei))).toBe(false);
  } finally { mcp.kill("SIGKILL"); }
});

// =====================================================================================================================================
// (b) Schalter
test("Schalter: „Eine KI hat etwas abgelegt“ aus → kein Hinweis für Ablagen; Abweisungen kommen weiter; Pflege (Standard aus) und Bestätigungen nie", async ({ page }) => {
  setzeSchalter({ mitteilungenAbgelegt: false });
  await oeffneStudio(page);
  const a = aufgabeDatei("still");
  meldeAblage(a);
  melde("pflege", { wer: undefined, text: "Die Pflege ist fertig." });
  melde("rueckgaengig", { text: "Eine Ablage wurde zurückgenommen." });
  await page.waitForTimeout(3200);
  await expect(hinweise(page)).toHaveCount(0); // nichts, und auch kein älterer Hinweis „Claude hat eine Aufgabe angelegt“
  meldeAbweisung();
  await expect(hinweise(page).filter({ hasText: "wurde abgewiesen" })).toHaveCount(1, { timeout: 8000 });
  await expect(hinweise(page)).toHaveCount(1);
});

test("Schalter: Standardwerte — Pflege ist aus, Pflege-Fehler (Rückfragen) und Sicherung sind an", async () => {
  const { istArtAn, ART_SCHALTER, SCHALTER_STANDARD } = await studio("mitteilungen.js");
  expect(istArtAn("ablage-aufgabe", {})).toBe(true);
  expect(istArtAn("abweisung", {})).toBe(true);
  expect(istArtAn("sicherung-fehler", {})).toBe(true);
  expect(istArtAn("pflege-fehler", {})).toBe(true);
  expect(istArtAn("pflege", {})).toBe(false);
  expect(istArtAn("pflege", { mitteilungenPflege: true })).toBe(true);
  expect(istArtAn("abweisung", { mitteilungenAbgewiesen: false })).toBe(false);
  expect(istArtAn("rueckgaengig", { mitteilungenAbgelegt: true })).toBe(false);
  expect(istArtAn("unbekannt", {})).toBe(false);
  expect(istArtAn("aenderung", { mitteilungenAbgelegt: "nein" })).toBe(true); // kein Wahrheitswert → Standard
  expect(Object.keys(SCHALTER_STANDARD).sort()).toEqual([...new Set(Object.values(ART_SCHALTER).filter(Boolean))].sort());
});

test("Parität: Arten und Schalter-Tabelle des Studios sind dieselben wie in gemeinsam/aktivitaet.mjs", async () => {
  const m = await studio("mitteilungen.js");
  expect(m.ARTEN).toEqual(protokoll.ARTEN);
  expect(m.ART_SCHALTER).toEqual(protokoll.ART_SCHALTER);
});

// =====================================================================================================================================
// (c) Aktivitätsprotokoll in den Einstellungen
function fuelleProtokoll() {
  const a = aufgabeDatei("prot-eins");
  const alle = [];
  alle.push(meldeAblage(a, { zeit: new Date(Date.now() - 4 * 60_000).toISOString() }));
  alle.push(melde("ablage-notiz", { wer: "Cursor", programm: "cursor", text: "hat eine Notiz im Posteingang abgelegt.", pfade: ["00_inbox/y.md"], zeit: new Date(Date.now() - 22 * 60_000).toISOString() }));
  alle.push(meldeAbweisung({ zeit: new Date(Date.now() - 60 * 60_000).toISOString() }));
  alle.push(melde("pflege", { wer: undefined, programm: null, text: "Pflege für Kortex: 3 Notizen zusammengeführt, 1 Rückfrage.", zeit: new Date(Date.now() - 5 * 3600_000).toISOString() }));
  alle.push(melde("sicherung-fehler", { wer: undefined, programm: null, text: "Die Sicherung bei GitHub hat nicht geklappt.", zeit: new Date(Date.now() - 26 * 3600_000).toISOString() }));
  return { a, alle };
}

for (const [schema, dunkel] of [["hell", false], ["dunkel", true]]) {
  test(`Protokoll (${schema}): echte Einträge mit Logo, Vault und Zeit; Abweisungen rot getönt; Rückgängig in der Zeile`, async ({ page }) => {
    const { a } = fuelleProtokoll();
    await oeffneProtokoll(page, { dunkel });
    await expect(zeilen(page)).toHaveCount(5, { timeout: 8000 });
    const erste = zeilen(page).first();
    await expect(erste.locator(".kx-akt-satz")).toHaveText("Claude Code hat eine Aufgabe angelegt.");
    await expect(erste.locator(".kx-akt-satz b")).toHaveText("Claude Code");
    await expect(erste.locator(".kx-d")).toHaveText(`Vault ${basename(vault)}`); // die Werkstatt setzt den Namen des Vault-Ordners ein
    await expect(erste.locator("time")).toHaveText("vor 4 Min");
    await expect(erste.locator("[data-ki-logo='claude']")).toBeVisible();
    await expect(erste.getByRole("button", { name: /Rückgängig/ })).toBeVisible();
    const abw = page.locator('[data-kx="aktivitaet-liste"] li[data-art="abweisung"]');
    await expect(abw.locator(".kx-akt-satz")).toHaveText("Codex wollte den Vault „Firma“ lesen und wurde abgewiesen.");
    await expect(abw.locator(".kx-d")).toHaveText(`Vault ${basename(vault)} · Stufe „Gesperrt“ hat gewirkt.`);
    await expect(abw.getByRole("button", { name: /Rückgängig/ })).toHaveCount(0);
    const farben = await abw.evaluate((li) => ({ li: getComputedStyle(li).backgroundColor, wer: getComputedStyle(li.querySelector("b")).color, normal: getComputedStyle(li.parentElement.firstElementChild).backgroundColor }));
    expect(farben.li).not.toBe(farben.normal); // getönt
    expect(farben.wer).not.toBe("rgba(0, 0, 0, 0)");
    await page.locator('[data-kx-host="aktivitaet"]').evaluate((e) => e.scrollIntoView({ block: "center", behavior: "instant" }));
    await foto(page, `protokoll-${schema}`);
    // Rückgängig in der Zeile: Datei weg, Zeile zeigt „zurückgenommen“, der Knopf ist verschwunden
    await erste.getByRole("button", { name: /Rückgängig/ }).click();
    await expect(hinweise(page).filter({ hasText: /^Zurückgenommen$/ })).toBeVisible({ timeout: 8000 });
    expect(existsSync(join(vault, a.pfad))).toBe(false);
    await expect(zeilen(page).first().locator(".kx-d")).toContainText("zurückgenommen");
    await expect(zeilen(page).first().getByRole("button", { name: /Rückgängig/ })).toHaveCount(0);
  });
}

test("Protokoll: Filter „Abweisungen“ zeigt nur Abweisungen, „Alle“ wieder alles; Tastatur und Zustand (aria-pressed)", async ({ page }) => {
  fuelleProtokoll();
  await oeffneProtokoll(page);
  await expect(zeilen(page)).toHaveCount(5, { timeout: 8000 });
  const alle = page.locator('[data-filter="alle"]'), abw = page.locator('[data-filter="abweisungen"]');
  await expect(alle).toHaveAttribute("aria-pressed", "true");
  await abw.focus(); await page.keyboard.press("Enter");
  await expect(abw).toHaveAttribute("aria-pressed", "true");
  await expect(zeilen(page)).toHaveCount(1);
  await expect(zeilen(page).first()).toHaveAttribute("data-art", "abweisung");
  await alle.click();
  await expect(zeilen(page)).toHaveCount(5);
});

test("Protokoll: leerer Zustand (alle und Abweisungen), kein „kommt mit Mitteilungen“ mehr", async ({ page }) => {
  await oeffneProtokoll(page);
  await expect(page.locator('[data-kx="aktivitaet-leer"]')).toContainText("Noch nichts zu zeigen");
  await expect(page.locator('[data-kx="aktivitaet-bald"]')).toHaveCount(0);
  await page.click('[data-filter="abweisungen"]');
  await expect(page.locator('[data-kx="aktivitaet-leer"]')).toContainText("Keine Abweisungen");
  await expect(page.getByText("kommt mit Mitteilungen")).toHaveCount(0);
});

test("Protokoll: „Alles zeigen“ erst bei mehr als 8 Einträgen; zeigt alle und klappt wieder zu", async ({ page }) => {
  for (let i = 0; i < 11; i++) melde("pflege", { wer: undefined, programm: null, text: `Pflege Nummer ${i + 1}.`, zeit: new Date(Date.now() - (i + 1) * 60_000).toISOString() });
  await oeffneProtokoll(page);
  await expect(zeilen(page)).toHaveCount(8, { timeout: 8000 });
  const knopf = page.locator('[data-kx="aktivitaet-alle"]');
  await expect(knopf).toHaveText("Alles zeigen");
  await expect(knopf).toHaveAttribute("aria-expanded", "false");
  await knopf.click();
  await expect(zeilen(page)).toHaveCount(11);
  await expect(knopf).toHaveText("Weniger zeigen");
  await knopf.click();
  await expect(zeilen(page)).toHaveCount(8);
});

test("Protokoll: ein neuer Eintrag erscheint live (ohne Neuladen), die Seite bleibt offen", async ({ page }) => {
  await oeffneProtokoll(page);
  await expect(page.locator('[data-kx="aktivitaet-leer"]')).toBeVisible({ timeout: 8000 });
  meldeAbweisung();
  await expect(zeilen(page)).toHaveCount(1, { timeout: 8000 });
  await expect(seite(page)).toBeVisible();
});

test("Protokoll: Fehler beim Lesen → ein Satz und „Nochmal versuchen“", async ({ page }) => {
  fuelleProtokoll();
  let kaputt = true;
  await page.route(/\/api\/aktivitaet\?/, (route) => (kaputt ? route.fulfill({ status: 500, json: { fehler: "kaputt" } }) : route.fallback()));
  await oeffneProtokoll(page);
  await expect(page.locator('[data-kx="aktivitaet-fehler"]')).toContainText("konnte nicht gelesen werden");
  kaputt = false;
  await page.getByRole("button", { name: "Nochmal versuchen" }).click();
  await expect(zeilen(page)).toHaveCount(5, { timeout: 8000 });
});

test("Protokoll: schmales Fenster (Zeilen brechen um, nichts läuft über)", async ({ page }) => {
  fuelleProtokoll();
  await oeffneProtokoll(page);
  await page.setViewportSize({ width: 700, height: 900 });
  await expect(zeilen(page)).toHaveCount(5, { timeout: 8000 });
  const ueberlauf = await page.locator('[data-kx="aktivitaet-liste"]').evaluate((ul) => ul.scrollWidth > ul.clientWidth + 1);
  expect(ueberlauf).toBe(false);
});

// =====================================================================================================================================
// (d) API von mitteilungen.js gegen die echte Werkstatt
test("API: liste, ungelesen, abonnieren, gelesen markieren, Live-Ereignisse, Zustand → neu laden", async ({ page }) => {
  const { a } = fuelleProtokoll();
  await oeffneStudio(page);
  const r = await page.evaluate(async () => {
    const { erzeugeMitteilungen } = await import("/mitteilungen.js");
    const { api } = await import("/api.js");
    const hinweise = [];
    const m = erzeugeMitteilungen({ api, toast: (t, o) => hinweise.push({ t, fett: o?.fett, aktionen: (o?.aktionen || []).map((x) => x.text) }) });
    const stand = [];
    const ab = m.abonniere((s) => stand.push(s.ungelesen));
    const aus = {};
    const l = await m.liste();
    aus.zeilen = l.ereignisse.length; aus.ungelesen1 = m.ungelesen(); aus.antwortUngelesen = l.ungelesen;
    aus.nurAbweisungen = (await m.liste({ art: "abweisungen" })).ereignisse.map((e) => e.art);
    aus.ungelesenNachFilter = m.ungelesen(); // ein gefilterter Abruf ändert den Zähler nicht
    await m.markiereGelesen({ ids: [l.ereignisse[0].id] });
    aus.ungelesen2 = m.ungelesen();
    m.verarbeiteLive([{ typ: "git", art: "neuer-stand" }, { typ: "aktivitaet", id: "a_zzzzzz_abcdef", art: "abweisung", zeit: new Date().toISOString(), wer: "Codex", text: "wollte den Vault „Firma“ lesen und wurde abgewiesen.", programm: "codex", vaultName: "Firma", rueckgaengig: false }]);
    aus.ungelesen3 = m.ungelesen();
    m.verarbeiteLive([{ typ: "aktivitaet", id: "a_zzzzzz_abcdef", art: "abweisung", zeit: new Date().toISOString(), wer: "Codex", text: "doppelt" }]); // dieselbe Id: nicht doppelt
    aus.ungelesen4 = m.ungelesen();
    await new Promise((ok) => setTimeout(ok, 1500));
    aus.hinweise = hinweise;
    await m.markiereGelesen({ alle: true });
    aus.ungelesen5 = m.ungelesen();
    m.verarbeiteLive([{ typ: "aktivitaet", art: "zustand" }]);
    await new Promise((ok) => setTimeout(ok, 800));
    aus.nachZustand = m.ungelesen();
    ab(); const vorher = stand.length;
    await m.markiereGelesen({ alle: true });
    aus.nachAbmelden = stand.length === vorher;
    aus.stand = stand;
    return aus;
  });
  expect(r.zeilen).toBe(5);
  expect(r.ungelesen1).toBe(5);
  expect(r.antwortUngelesen).toBe(5);
  expect(r.nurAbweisungen).toEqual(["abweisung"]);
  expect(r.ungelesenNachFilter).toBe(5);
  expect(r.ungelesen2).toBe(4);
  expect(r.ungelesen3).toBe(5);
  expect(r.ungelesen4).toBe(5);
  expect(r.hinweise).toEqual([{ t: "wollte den Vault „Firma“ lesen und wurde abgewiesen", fett: "Codex", aktionen: ["Ansehen"] }]);
  expect(r.ungelesen5).toBe(0);
  expect(r.nachZustand).toBe(0);
  expect(r.nachAbmelden).toBe(true);
  expect(r.stand.length).toBeGreaterThan(3);
  expect(existsSync(join(vault, a.pfad))).toBe(true);
});

test("API: rueckgaengig(id) — Erfolg, „schon zurückgenommen“ höflich, geänderte Datei bleibt (Rückfrage statt Löschen)", async ({ page }) => {
  const a = aufgabeDatei("api-eins"), b = aufgabeDatei("api-zwei");
  const ea = meldeAblage(a), eb = meldeAblage(b);
  writeFileSync(join(vault, b.pfad), readFileSync(join(vault, b.pfad), "utf8") + "\nGeändert.\n");
  await oeffneStudio(page);
  const r = await page.evaluate(async ([ia, ib]) => {
    const { erzeugeMitteilungen } = await import("/mitteilungen.js");
    const { api } = await import("/api.js");
    const hinweise = [];
    const m = erzeugeMitteilungen({ api, toast: (t, o) => hinweise.push({ t, fehler: !!o?.fehler }) });
    await m.liste();
    const ok = await m.rueckgaengig(ia);
    const nochmal = await m.rueckgaengig(ia);
    const geaendert = await m.rueckgaengig(ib);
    return { ok: ok.ok, nochmal: nochmal.ergebnisse[0], geaendert: geaendert.ergebnisse[0], hinweise, liste: m.ereignisse().map((e) => [e.id === ia, e.rueckgaengigMoeglich]) };
  }, [ea.id, eb.id]);
  expect(r.ok).toBe(true);
  expect(r.nochmal).toMatchObject({ ok: false, art: "schon-zurueck", neutral: true });
  expect(r.geaendert).toMatchObject({ ok: false, art: "geaendert", rueckfrage: true });
  expect(r.geaendert.meldung).toContain("Kortex entfernt sie nicht");
  expect(r.hinweise.map((h) => h.t)).toEqual(["Zurückgenommen", "Das ist schon zurückgenommen.", expect.stringContaining("seit der Ablage geändert")]);
  expect(r.hinweise.map((h) => h.fehler)).toEqual([false, false, false]);
  expect(existsSync(join(vault, a.pfad))).toBe(false);
  expect(existsSync(join(vault, b.pfad))).toBe(true);
});

// =====================================================================================================================================
// reine Funktionen (ohne Seite)
test("Funktionen: bündeln nach (Art-Familie, wer, Vault) und Texte des Hinweises", async () => {
  const { gruppiere, baueHinweis, saetze, familie, zielVon } = await studio("mitteilungen.js");
  const e = (art, extra = {}) => ({ id: `a_${Math.random().toString(36).slice(2, 8)}_abcdef`, art, wer: "Claude Code", vaultName: "Kortex", text: "hat eine Aufgabe angelegt.", rueckgaengig: true, ...extra });
  const g = gruppiere([e("ablage-aufgabe"), e("ablage-aufgabe"), e("ablage-notiz"), e("ablage-aufgabe", { wer: "Codex" }), e("ablage-aufgabe", { vaultName: "Firma" })]);
  expect(g.map((x) => x.length)).toEqual([2, 1, 1, 1]);
  expect(familie("sicherung-fehler")).toBe(familie("sicherung-konflikt"));
  expect(familie("ablage-aufgabe")).not.toBe(familie("ablage-notiz"));
  expect(saetze("wollte lesen. Stufe „Gesperrt“ hat gewirkt.")).toEqual({ erster: "wollte lesen", ersterVoll: "wollte lesen.", rest: "Stufe „Gesperrt“ hat gewirkt." });
  expect(saetze("hat etwas getan.")).toEqual({ erster: "hat etwas getan", ersterVoll: "hat etwas getan.", rest: "" });
  expect(zielVon("ablage-aufgabe")).toBe("aufgaben"); expect(zielVon("ablage-notiz")).toBe("posteingang"); expect(zielVon("abweisung")).toBe("protokoll");
  const zwei = baueHinweis(g[0]);
  expect(zwei).toMatchObject({ fett: "Claude Code", text: "hat 2 Aufgaben angelegt", unter: "Aufgaben · Vault Kortex", ziel: "aufgaben", programm: null });
  expect(zwei.rueckgaengigIds).toHaveLength(2);
  // „Rückgängig“ nur, wenn ALLE zurücknehmbar sind
  expect(baueHinweis([e("ablage-aufgabe"), e("ablage-aufgabe", { rueckgaengig: false })]).rueckgaengigIds).toEqual([]);
  expect(baueHinweis([e("ablage-notiz", { text: "hat eine Notiz im Posteingang abgelegt.", rueckgaengig: false, wer: "Claude Code · Privat" })])).toMatchObject({ fett: "Claude Code · Privat", text: "hat eine Notiz im Posteingang abgelegt", unter: "Posteingang · Vault Kortex", ziel: "posteingang" });
  const abw = baueHinweis([e("abweisung", { wer: "Codex", vaultName: "Firma", rueckgaengig: false, text: "wollte den Vault „Firma“ lesen und wurde abgewiesen. Stufe „Gesperrt“ hat gewirkt." })]);
  expect(abw).toMatchObject({ text: "wollte den Vault „Firma“ lesen und wurde abgewiesen", unter: "Vault Firma · Stufe „Gesperrt“ hat gewirkt.", abweisung: true, ziel: "protokoll" });
  expect(baueHinweis([e("abweisung"), e("abweisung")]).text).toBe("wurde 2-mal abgewiesen");
  // ohne Handelnden (Systemereignis): der ganze Satz
  expect(baueHinweis([e("sicherung-fehler", { wer: undefined, text: "Die Sicherung hat nicht geklappt.", rueckgaengig: false })])).toMatchObject({ fett: null, text: "Die Sicherung hat nicht geklappt" });
});

test("Funktionen: Meldungen beim Rückgängigmachen — geändert, schon zurück, Vertrauen, kein Vault, Verbindung", async () => {
  const { rueckgaengigMeldung } = await studio("mitteilungen.js");
  const fehler = (status, art, text) => Object.assign(new Error(text || "x"), { status, daten: { fehler: text, art } });
  expect(rueckgaengigMeldung(fehler(409, "geaendert", "Die Notiz wurde seit der Ablage geändert. Kortex entfernt sie nicht — öffne sie und entscheide selbst."))).toMatchObject({ art: "geaendert", rueckfrage: true, neutral: false });
  expect(rueckgaengigMeldung(fehler(409, "geaendert")).meldung).toContain("Kortex entfernt sie nicht");
  expect(rueckgaengigMeldung(fehler(409, "schon-zurueck", "Das ist schon rückgängig gemacht."))).toMatchObject({ meldung: "Das ist schon zurückgenommen.", neutral: true });
  expect(rueckgaengigMeldung(fehler(409, "nicht-vertraut")).meldung).toContain("noch nicht als deiner bestätigt");
  expect(rueckgaengigMeldung(fehler(409, "kein-vault")).meldung).toContain("kein Vault");
  expect(rueckgaengigMeldung(fehler(404, null))).toMatchObject({ art: "unbekannt", neutral: true });
  expect(rueckgaengigMeldung(Object.assign(new Error("v"), { status: 0, daten: null })).art).toBe("verbindung");
});

// =====================================================================================================================================
// Hinweis-Baustein (hilfen.js): mehrere Aktionen, Hover pausiert, bisheriges `aktion` unverändert
test("toast(): bisheriges `aktion` bleibt wie es war (ein Text, ein Link, Klick entfernt)", async ({ page }) => {
  await oeffneStudio(page);
  await page.evaluate(async () => { const { toast } = await import("/hilfen.js"); window.__t = 0; toast("Alter Hinweis", { aktion: { text: "Anlegen", tun: () => { window.__t++; } } }); });
  const t = hinweise(page);
  await expect(t).toHaveText("Alter HinweisAnlegen");
  await expect(t).not.toHaveClass(/reich/);
  await t.locator("a").click();
  expect(await page.evaluate(() => window.__t)).toBe(1);
  await expect(t).toHaveCount(0);
});

test("toast(): mit Aktionen pausiert das Ausblenden bei Hover; ohne Hover verschwindet er", async ({ page }) => {
  await oeffneStudio(page);
  await page.evaluate(async () => { const { toast } = await import("/hilfen.js"); toast("Mit Knöpfen", { ms: 600, unter: "Unterzeile", aktionen: [{ text: "Ansehen", tun() {}, primaer: true }, { text: "Rückgängig", tun() {} }] }); });
  const t = hinweise(page);
  await expect(t).toHaveCount(1);
  await t.hover();
  await page.waitForTimeout(1500);
  await expect(t).toHaveCount(1); // Maus darüber: bleibt
  await page.mouse.move(5, 5);
  await expect(t).toHaveCount(0, { timeout: 5000 });
});

test("W2: Ereignisse, die schon vor dem Öffnen der Seite da waren (Zeit älter als 2 Minuten), bekommen nie einen Hinweis und nie „Rückgängig“ — sie zählen nur im Protokoll", async ({ page }) => {
  fuelleProtokoll();
  await oeffneStudio(page);
  const r = await page.evaluate(async () => {
    const { erzeugeMitteilungen } = await import("/mitteilungen.js");
    const { api } = await import("/api.js");
    const hinweise = [];
    const m = erzeugeMitteilungen({ api, toast: (t, o) => hinweise.push({ t, aktionen: (o?.aktionen || []).map((x) => x.text) }) });
    const alt = new Date(Date.now() - 10 * 60_000).toISOString();
    m.verarbeiteLive([{ typ: "aktivitaet", id: "a_altalt_abcdef", art: "ablage-aufgabe", zeit: alt, wer: "Claude Code", text: "hat eine Aufgabe angelegt.", pfade: ["05_aufgaben/x.md"], rueckgaengig: true, vaultName: "V" }]);
    await new Promise((ok) => setTimeout(ok, 1500));
    return { hinweise, ungelesen: m.ungelesen(), deckt: m.deckt(Date.now() - 6000) };
  });
  expect(r.hinweise).toEqual([]);
  expect(r.deckt).toBe(false);
});
