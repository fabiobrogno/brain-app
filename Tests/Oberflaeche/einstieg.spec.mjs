// Einstieg ohne Vault gegen die ECHTE Werkstatt und die echte App (app.js, willkommen.js): nur der Weg „Versionsverlauf einschalten“
// wird gestört, damit eine Zeitüberschreitung dort getestet werden kann, ohne die Werkstatt zu verbiegen. Alles läuft in Wegwerf-Ordnern
// (die Werkstatt bekommt einen eigenen Support-Ordner im Temp-Verzeichnis, siehe start.mjs).
//
// UI-2: Ist das Einschalten des Versionsverlaufs in eine Zeitüberschreitung gelaufen, darf der Einstieg das nur dann als Erfolg werten, wenn es
// den Verlauf wirklich gibt. Dass die Werkstatt „einen Vault hat, den die App noch nicht kennt“, ist nach dem ersten Schritt immer so.
import { test, expect } from "@playwright/test";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { starteServer } from "./start.mjs";

const GIT_ZEIT = "Das Einschalten des Versionsverlaufs hat zu lange gedauert. Dein Ordner ist geöffnet, der Verlauf aber nicht eingeschaltet. Versuche es noch einmal oder arbeite ohne Verlauf weiter.";

let server, ordner;
test.beforeEach(async () => {
  server = await starteServer(null); // Werkstatt ohne Vault: die App zeigt den Einstieg
  ordner = mkdtempSync(join(tmpdir(), "brain-ui-einstieg-"));
  writeFileSync(join(ordner, "Hallo.md"), "# Hallo\n\nEin Ordner mit Notizen, noch ohne Versionsverlauf.\n");
});
test.afterEach(() => server?.stopp());

const schritt = (page, name) => page.locator(`#willkommen-host .w-karte[data-schritt="${name}"]`);
const aktionen = (page, name) => page.evaluate((n) => window.__aktionen.filter((a) => a.aktion === n), name);

// App-Simulation: der Ordner-Dialog liefert den Wegwerf-Ordner, alle Aktionen werden aufgezeichnet
async function startMitOrdner(page) {
  await page.addInitScript((p) => {
    window.__aktionen = [];
    window.webkit = { messageHandlers: { aktion: { postMessage: async (m) => { window.__aktionen.push(m); return m.aktion === "ordner-waehlen" ? { pfad: p } : undefined; } } } };
  }, ordner);
  await page.goto(server.url);
  await expect(page.locator("#willkommen-host .w-karte")).toBeVisible();
  await page.locator('#willkommen-host [data-weg="ordner"]').click();
  await expect(schritt(page, "git")).toBeVisible(); // der Ordner hat keinen Versionsverlauf: die Rückfrage kommt
}

test("UI-2: die Anfrage zum Einschalten kommt nie an (Zeitüberschreitung): Rückfrage bleibt, App startet nicht, Wiederholen schaltet ein", async ({ page }) => {
  let versuche = 0;
  await page.route("**/api/vaults/oeffnen", (route) => {
    if (!route.request().postDataJSON().gitEinschalten) return route.fallback();
    return versuche++ === 0 ? route.abort("failed") : route.fallback(); // erst gestört, dann echt
  });
  await startMitOrdner(page);
  await page.locator('#willkommen-host [data-aktion="git-einschalten"]').click();
  await expect(page.locator("#willkommen-host .w-fehlerbox")).toHaveText(GIT_ZEIT);
  await expect(schritt(page, "git")).toBeVisible();
  await expect(schritt(page, "ki")).toHaveCount(0);
  await expect(page.locator("#app")).toBeHidden(); // die App ist nicht gestartet: das war kein Erfolg
  expect(await aktionen(page, "vault-gewechselt")).toHaveLength(0);
  expect(existsSync(join(ordner, ".git"))).toBe(false); // und es gibt wirklich keinen Verlauf
  // Wiederholen geht: jetzt schaltet die echte Werkstatt ein
  await page.locator('#willkommen-host [data-aktion="git-einschalten"]').click();
  await expect(schritt(page, "ki")).toBeVisible();
  expect(existsSync(join(ordner, ".git"))).toBe(true);
  await page.locator('#willkommen-host [data-aktion="ki-spaeter"]').click();
  await expect(page.locator("#app")).toBeVisible();
  await expect(page.locator("#vault-name")).toHaveText(basename(ordner));
  expect(await aktionen(page, "vault-gewechselt")).toHaveLength(1);
});

test("UI-2: die Werkstatt schaltet ein, die Antwort geht aber verloren: der Einstieg macht weiter, weil der Verlauf wirklich da ist", async ({ page }) => {
  await page.route("**/api/vaults/oeffnen", async (route) => {
    if (!route.request().postDataJSON().gitEinschalten) return route.fallback();
    await route.fetch(); // die echte Werkstatt schaltet den Verlauf ein ...
    await route.abort("failed"); // ... aber die Antwort kommt nie an
  });
  await startMitOrdner(page);
  await page.locator('#willkommen-host [data-aktion="git-einschalten"]').click();
  await expect(schritt(page, "ki")).toBeVisible();
  await expect(page.locator("#willkommen-host .w-fehlerbox")).toHaveCount(0);
  expect(existsSync(join(ordner, ".git"))).toBe(true);
  await page.locator('#willkommen-host [data-aktion="ki-spaeter"]').click();
  await expect(page.locator("#app")).toBeVisible();
  expect(await aktionen(page, "vault-gewechselt")).toHaveLength(1);
});

test("UI-2: „Ohne Verlauf weiter“ nach der Zeitüberschreitung startet die App ohne Versionsverlauf", async ({ page }) => {
  await page.route("**/api/vaults/oeffnen", (route) => (route.request().postDataJSON().gitEinschalten ? route.abort("failed") : route.fallback()));
  await startMitOrdner(page);
  await page.locator('#willkommen-host [data-aktion="git-einschalten"]').click();
  await expect(page.locator("#willkommen-host .w-fehlerbox")).toHaveText(GIT_ZEIT);
  await page.locator('#willkommen-host [data-aktion="git-ohne"]').click();
  await expect(schritt(page, "ki")).toBeVisible();
  await page.locator('#willkommen-host [data-aktion="ki-spaeter"]').click();
  await expect(page.locator("#app")).toBeVisible();
  expect(existsSync(join(ordner, ".git"))).toBe(false);
});
