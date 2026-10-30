// Live-Aktualisierung: Was von außen im Vault passiert (Claude, ein Editor, Git), erscheint im Studio ohne Neuladen —
// Board, Notizliste, Seitenleisten-Zähler, Hinweis bei KI-Quelle, offene Datei (still nachladen oder Konflikt) — gegen das echte Backend mit Wegwerf-Vault.
import { test, expect } from "./basis.mjs";
import { writeFileSync, mkdirSync, readFileSync, unlinkSync, renameSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";

const WURZEL = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const jetzt = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

function aufgabe(vault, name, f) {
  const d = { status: "offen", prioritaet: "normal", rang: 1000, quelle: "mensch", erstellt: "2026-10-20T08:00:00Z", geaendert: jetzt(), ...f };
  const z = ["---", "typ: aufgabe", `titel: ${JSON.stringify(d.titel)}`, `status: ${d.status}`, `prioritaet: ${d.prioritaet}`, `rang: ${d.rang}`, `erstellt: ${d.erstellt}`, `geaendert: ${d.geaendert}`, `quelle: ${d.quelle}`, "---", ""];
  mkdirSync(join(vault, "05_aufgaben"), { recursive: true });
  writeFileSync(join(vault, "05_aufgaben", `${name}.md`), z.join("\n"));
  return `05_aufgaben/${name}.md`;
}

let vault, server, p;
test.beforeEach(async () => {
  ({ vault } = baueVault());
  p = { a: aufgabe(vault, "2026-10-20-erste", { titel: "Erste Aufgabe", rang: 1000 }) };
  server = await starteServer(vault);
});
test.afterEach(() => server?.stopp());

const karte = (page, pfad) => page.locator(`[data-karte-aufgabe][data-pfad="${pfad}"]`);
const spalte = (page, s) => page.locator(`[data-spalte="${s}"]`);
// Studio öffnen und warten, bis es zuhört (data-live) — ein gerade erst angelegter Beobachter braucht noch einen Moment
async function oeffneStudio(page) {
  await page.goto(server.url);
  await page.waitForSelector("[data-karte], [data-leer]", { timeout: 10000 });
  await page.waitForSelector('html[data-live="an"]', { timeout: 10000 });
  await page.waitForTimeout(300);
}
async function oeffneBoard(page) {
  await oeffneStudio(page);
  await page.click('[data-bereich="aufgaben"]');
  await expect(karte(page, p.a)).toBeVisible();
}
const toastTexte = (page) => page.locator("#toast-host .toast").allTextContents();

test("Board: eine von außen angelegte Aufgabe erscheint ohne Neuladen, leuchtet kurz auf, Zähler in Seitenleiste und Board steigen", async ({ page }) => {
  await oeffneBoard(page);
  await expect(page.locator('[data-bereich="aufgaben"] .zahl')).toHaveText("1");
  await expect(page.locator("[data-aufgaben-zahl]")).toHaveText("1 offen");
  let neuGeladen = false;
  page.on("framenavigated", () => { neuGeladen = true; });
  const t0 = Date.now();
  const neu = aufgabe(vault, "2026-10-30-von-aussen", { titel: "Von außen angelegt", rang: 2000 });
  await expect(karte(page, neu)).toBeVisible({ timeout: 5000 });
  const dauer = Date.now() - t0;
  console.log(`# Latenz Datei → Karte im Board: ${dauer} ms`);
  expect(dauer).toBeLessThan(3000);
  await expect(spalte(page, "offen").locator(".au-karte .au-titel")).toHaveText(["Erste Aufgabe", "Von außen angelegt"]);
  await expect(karte(page, neu)).toHaveClass(/live-neu/);
  await expect(page.locator('[data-bereich="aufgaben"] .zahl')).toHaveText("2");
  await expect(page.locator("[data-aufgaben-zahl]")).toHaveText("2 offen");
  await expect(karte(page, neu)).not.toHaveClass(/live-neu/, { timeout: 5000 }); // Akzent verschwindet wieder
  expect(neuGeladen).toBe(false);
});

test("Board: Status von außen geändert → Karte wandert in die andere Spalte; gelöscht → Karte weg", async ({ page }) => {
  await oeffneBoard(page);
  aufgabe(vault, "2026-10-20-erste", { titel: "Erste Aufgabe", status: "erledigt" });
  await expect(spalte(page, "erledigt").locator(`[data-pfad="${p.a}"]`)).toBeVisible({ timeout: 5000 });
  await expect(page.locator('[data-bereich="aufgaben"] .zahl')).toHaveText("0"); // nichts mehr offen
  unlinkSync(join(vault, p.a));
  await expect(karte(page, p.a)).toHaveCount(0, { timeout: 5000 });
});

test("Eigene Änderungen im Board flackern nicht: kein zusätzliches Nachladen der Aufgaben nach einem Verschieben", async ({ page }) => {
  aufgabe(vault, "2026-10-21-zweite", { titel: "Zweite", rang: 2000 });
  await oeffneBoard(page);
  let listen = 0;
  page.on("request", (r) => { if (r.url().endsWith("/api/aufgaben") && r.method() === "GET") listen++; });
  await karte(page, p.a).focus();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(spalte(page, "in-arbeit").locator(`[data-pfad="${p.a}"]`)).toBeVisible();
  await page.waitForTimeout(1200); // ein Echo käme nach ~200 ms
  expect(listen).toBeLessThanOrEqual(1);
  await expect(page.locator(`[data-pfad="${p.a}"].live-neu`)).toHaveCount(0);
});

test("Hinweis „Claude hat eine Aufgabe angelegt: …“ bei KI-Quelle; keiner bei eigener Quelle; mehrere werden gebündelt", async ({ page }) => {
  await oeffneBoard(page);
  aufgabe(vault, "2026-10-30-mensch", { titel: "Von mir", quelle: "mensch" });
  await expect(page.locator('[data-karte-aufgabe]', { hasText: "Von mir" })).toBeVisible({ timeout: 5000 });
  expect(await toastTexte(page)).toEqual([]);
  aufgabe(vault, "2026-10-30-ki", { titel: "Angebot prüfen", quelle: "ki:claude-code" });
  await expect(page.locator("#toast-host .toast")).toHaveText("Claude hat eine Aufgabe angelegt: „Angebot prüfen“", { timeout: 5000 });
  // mehrere auf einmal: ein Hinweis
  for (const t of ["Eins", "Zwei", "Drei", "Vier"]) aufgabe(vault, `2026-10-30-b-${t.toLowerCase()}`, { titel: t, quelle: "ki:claude-code" });
  await expect(page.locator("#toast-host .toast", { hasText: "4 Aufgaben" })).toHaveText("Claude hat 4 Aufgaben angelegt: „Eins“, „Zwei“, „Drei“ und 1 weitere", { timeout: 5000 });
});

test("Hinweis erscheint auch, wenn das Board gar nicht offen ist; Seitenleisten-Zähler steigt", async ({ page }) => {
  await oeffneStudio(page); // Ansicht „Alle Notizen“
  await expect(page.locator('[data-bereich="aufgaben"] .zahl')).toHaveText("1");
  aufgabe(vault, "2026-10-30-ki", { titel: "Im Hintergrund", quelle: "ki:codex" });
  await expect(page.locator("#toast-host .toast")).toHaveText("Codex hat eine Aufgabe angelegt: „Im Hintergrund“", { timeout: 5000 });
  await expect(page.locator('[data-bereich="aufgaben"] .zahl')).toHaveText("2");
});

test("Notizliste und Posteingang: neue Datei erscheint ohne Neuladen, Zähler steigt, Karte leuchtet", async ({ page }) => {
  await oeffneStudio(page);
  await page.click('[data-bereich="inbox"]');
  const vorher = Number(await page.locator('[data-bereich="inbox"] .zahl').textContent());
  writeFileSync(join(vault, "00_inbox/2026-10-30_frisch.md"), "# Frisch hereingekommen\n\nText.\n");
  const k = page.locator('#liste-koerper [data-karte][data-pfad="00_inbox/2026-10-30_frisch.md"]');
  await expect(k).toBeVisible({ timeout: 5000 });
  await expect(k).toHaveClass(/live-neu/);
  await expect(page.locator('[data-bereich="inbox"] .zahl')).toHaveText(String(vorher + 1));
  // gelöscht → weg
  unlinkSync(join(vault, "00_inbox/2026-10-30_frisch.md"));
  await expect(k).toHaveCount(0, { timeout: 5000 });
  await expect(page.locator('[data-bereich="inbox"] .zahl')).toHaveText(String(vorher));
});

test("Statusleiste: die Zahl der geänderten Dateien folgt dem, was von außen passiert (ohne Neuladen)", async ({ page }) => {
  await oeffneStudio(page);
  await expect(page.locator('[data-st="geaendert"]')).toContainText("1 geändert"); // die Aufgabe aus dem Aufbau ist noch nicht committet
  writeFileSync(join(vault, "00_inbox/extern-1.md"), "# Eins\n");
  await expect(page.locator('[data-st="geaendert"]')).toContainText("2 geändert", { timeout: 6000 });
  writeFileSync(join(vault, "00_inbox/extern-2.md"), "# Zwei\n");
  await expect(page.locator('[data-st="geaendert"]')).toContainText("3 geändert", { timeout: 6000 });
});

test("Titel einer Notiz von außen geändert → Liste zeigt den neuen Titel", async ({ page }) => {
  await oeffneStudio(page);
  const pfad = "10_notizen/Reise nach Lissabon.md";
  await expect(page.locator(`#liste-koerper [data-karte][data-pfad="${pfad}"] .karte-titel`)).toBeVisible();
  writeFileSync(join(vault, pfad), "# Reise nach Porto\n\nUmgeplant.\n");
  await expect(page.locator(`#liste-koerper [data-karte][data-pfad="${pfad}"] .karte-titel`)).toHaveText("Reise nach Porto", { timeout: 5000 });
});

test("Offene Datei, lokal unverändert: externe Änderung wird still nachgeladen (kein Banner), Cursor bleibt, Speichern danach klappt", async ({ page }) => {
  await oeffneStudio(page);
  const pfad = "10_notizen/Reise nach Lissabon.md";
  await page.click(`#liste-koerper [data-karte][data-pfad="${pfad}"]`);
  await expect(page.locator(".cm-content")).toContainText("Mietwagen");
  writeFileSync(join(vault, pfad), "# Reise nach Lissabon\n\nFlug im Mai. Hotel in der Alfama. Jetzt mit Fado-Abend.\n");
  await expect(page.locator(".cm-content")).toContainText("Fado-Abend", { timeout: 5000 });
  await expect(page.locator('[data-banner="konflikt"]')).toHaveCount(0);
  // der Hash stimmt: Tippen und Speichern ergibt keinen Konflikt
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type(" Ende.");
  await expect(page.locator("#speicherstand")).toHaveText("Gespeichert", { timeout: 5000 });
  expect(readFileSync(join(vault, pfad), "utf8")).toContain("Fado-Abend");
  expect(readFileSync(join(vault, pfad), "utf8")).toContain("Ende.");
  await expect(page.locator('[data-banner="konflikt"]')).toHaveCount(0);
});

test("Offene Datei mit ungespeicherter Eingabe: externe Änderung zeigt den Konflikt-Hinweis, getippter Text bleibt erhalten (kein Datenverlust)", async ({ page }) => {
  await oeffneStudio(page);
  const pfad = "10_notizen/Reise nach Lissabon.md";
  await page.click(`#liste-koerper [data-karte][data-pfad="${pfad}"]`);
  await expect(page.locator(".cm-content")).toContainText("Mietwagen");
  // Speichern blockieren, damit die Eingabe sicher „ungespeichert“ bleibt, während die Änderung von außen kommt
  await page.route("**/api/datei", (route) => route.request().method() === "PUT" ? route.fulfill({ status: 500, contentType: "application/json", body: '{"fehler":"offline"}' }) : route.fallback());
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type(" MEINE-EINGABE");
  writeFileSync(join(vault, pfad), "# Reise nach Lissabon\n\nVon außen komplett ersetzt.\n");
  const banner = page.locator('[data-banner="konflikt"]');
  await expect(banner).toBeVisible({ timeout: 5000 });
  await expect(page.locator(".cm-content")).toContainText("MEINE-EINGABE");
  await expect(page.locator(".cm-content")).not.toContainText("komplett ersetzt");
  // bestehende Konfliktlogik: „Neu laden“ übernimmt die Fassung von außen
  await page.click('[data-aktion="neu-laden"]');
  await expect(banner).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText("komplett ersetzt");
});

test("prefers-reduced-motion: keine Animation, aber ein ruhiger Rahmen als Akzent", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await oeffneBoard(page);
  const neu = aufgabe(vault, "2026-10-30-ruhig", { titel: "Ruhig", rang: 2000 });
  await expect(karte(page, neu)).toHaveClass(/live-neu/, { timeout: 5000 });
  const stil = await karte(page, neu).evaluate((e) => { const s = getComputedStyle(e); return { name: s.animationName, outline: s.outlineStyle }; });
  expect(stil.name).toBe("none");
  expect(stil.outline).toBe("solid");
});

test("Das Zuhören übersteht einen Abbruch der Verbindung: nach einem Fehler geht es weiter", async ({ page }) => {
  await oeffneBoard(page);
  let gebrochen = 0;
  await page.route("**/api/ereignisse**", (route) => { if (gebrochen++ < 1) return route.abort(); return route.fallback(); });
  // erst nach der nächsten Runde (Abbruch → Pause 1 s → neuer Grundstand) hört es wieder zu; Ereignisse dazwischen gehen nicht verloren, weil das Studio dann alles neu liest
  await page.waitForTimeout(500);
  const neu = aufgabe(vault, "2026-10-30-nach-abbruch", { titel: "Nach Abbruch", rang: 2000 });
  await expect(karte(page, neu)).toBeVisible({ timeout: 12000 });
});

// ───────────── Ende zu Ende: MCP-Server legt eine Aufgabe an ─────────────
test("Ende zu Ende: brain_aufgabe_anlegen über den echten MCP-Server → Karte im Board und Hinweis, ohne Neuladen", async ({ page }) => {
  await oeffneBoard(page);
  let neuGeladen = false;
  page.on("framenavigated", () => { neuGeladen = true; });
  const home = mkdtempSync(join(tmpdir(), "brain-ui-home-"));
  const env = { PATH: "/usr/bin:/bin", HOME: home, BRAIN_APP_SUPPORT: server.support, BRAIN_TESTMODUS: "1", KORTEX_VAULT_VERTRAUT: "alle", BRAIN_NUTZUNG: "aus" };
  const mcp = spawn(process.execPath, [join(WURZEL, "Ressourcen/mcp/brain-mcp.mjs"), vault], { stdio: ["pipe", "pipe", "ignore"], env, cwd: home });
  try {
    const antworten = new Map(), wartende = new Map();
    createInterface({ input: mcp.stdout }).on("line", (z) => { const o = JSON.parse(z); const w = wartende.get(o.id); if (w) w(o); else antworten.set(o.id, o); });
    const frage = (id, method, params) => new Promise((ok) => { if (antworten.has(id)) return ok(antworten.get(id)); wartende.set(id, ok); mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
    await frage(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "2" } });
    const t0 = Date.now();
    const a = await frage(2, "tools/call", { name: "brain_aufgabe_anlegen", arguments: { titel: "Per MCP angelegt", prioritaet: "hoch" } });
    expect(a.result.isError).not.toBe(true);
    const k = spalte(page, "offen").locator(".au-karte", { hasText: "Per MCP angelegt" });
    await expect(k).toBeVisible({ timeout: 5000 });
    const dauer = Date.now() - t0;
    console.log(`# Latenz MCP-Aufruf → Karte im Board: ${dauer} ms`);
    expect(dauer).toBeLessThan(3000);
    await expect(k.locator('.au-quelle[data-quelle="ki:claude-code"]')).toBeVisible();
    await expect(page.locator("#toast-host .toast", { hasText: "Per MCP angelegt" })).toHaveText("Claude hat eine Aufgabe angelegt: „Per MCP angelegt“");
    await expect(page.locator('[data-bereich="aufgaben"] .zahl')).toHaveText("2");
    expect(neuGeladen).toBe(false);
  } finally { mcp.kill("SIGKILL"); }
});
