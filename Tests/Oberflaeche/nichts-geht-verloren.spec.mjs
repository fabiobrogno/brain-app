// Paket „Nichts geht verloren“ im echten Studio (echte Werkstatt, Wegwerf-Vault und eigener Support-Ordner — nie die echten Orte des Rechners):
//  K2  Fremdänderung bei offener Notiz: ohne Überschneidung wird zusammengeführt (Toast mit „Rückgängig“), mit Überschneidung wählst du je Stelle
//      (Meine / Andere / Beide / Zusammenführen); die überschriebene Fassung liegt vorher in der Ablage.
//  W1  Entwurfs-Journal: ungespeicherter Text überlebt Neuladen/Absturz („Ungespeicherten Text wiederherstellen“ mit Vergleich), Werkstatt weg → klare Meldung, erneutes Speichern.
//  W3  Automatische lokale Fassungen: Schalter in den Einstellungen, Commit „Automatisch gesichert: N Notizen“ nach Ruhe bzw. beim Fensterwechsel; „Automatisch abgleichen“ nur vorbereitet.
import { test, expect } from "./basis.mjs";
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, renameSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { baueVault, git } from "./vault.mjs";
import { starteServer } from "./start.mjs";

const NOTIZ = "10_notizen/Reise nach Lissabon.md";
let vault, server;
test.afterEach(() => { try { chmodSync(join(vault, "10_notizen"), 0o755); } catch { /* kein Vault oder schon frei */ } server?.stopp(); });

const lese = (p) => readFileSync(join(vault, p), "utf8");
const inhaltDerAblage = () => {
  const dir = join(server.support, "fassungen");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((k) => readdirSync(join(dir, k)).filter((n) => n.endsWith(".txt")).map((n) => readFileSync(join(dir, k, n), "utf8")));
};
const entwuerfe = () => {
  const dir = join(server.support, "entwuerfe");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((k) => readdirSync(join(dir, k)).map((n) => join(dir, k, n)));
};
async function starte(page, { umgebung, journalMs, put500 = false, config = false } = {}) {
  ({ vault } = baueVault());
  if (config) writeFileSync(join(vault, "brain.config.json"), JSON.stringify({ name: "Kortex" }, null, 2) + "\n"); // Einstellungen des Vaults brauchen die Datei (wie einstellungen.spec)
  server = await starteServer(vault, umgebung ? { umgebung: { ...process.env, ...umgebung } } : {});
  // Absturz simulieren (absturz(page) vor dem Neuladen): Ein echter Absturz speichert nichts mehr. Beim normalen Neuladen aber starten beforeunload/visibilitychange/blur noch ein Speichern,
  // das an page.route vorbei die Datei doch noch schreibt (CI-Wettlauf: der Entwurf ist dann gleich dem Dateiinhalt und wird vom Server entfernt). Diese Listener laufen vor denen der App (Capture).
  if (put500) await page.addInitScript(() => { for (const [z, t] of [[window, "beforeunload"], [document, "visibilitychange"], [window, "blur"]]) z.addEventListener(t, (e) => { if (window.__absturz) e.stopImmediatePropagation(); }, true); });
  if (journalMs) await page.addInitScript((ms) => { window.__journalMs = ms; }, journalMs);
  await page.goto(server.url + "?pfad=" + encodeURIComponent(NOTIZ));
  await page.waitForSelector(".cm-content .cm-line");
  await page.waitForFunction(() => window.__studioBereit === true);
  if (put500) await blockierePut(page);
}
// Speichern verhindern (Antwort 500 oder Verbindungsabbruch), damit Eingaben sicher „ungespeichert“ bleiben
const blockierePut = (page, art = "500") => page.route("**/api/datei", (route) => route.request().method() !== "PUT" ? route.fallback()
  : art === "abbruch" ? route.abort("connectionrefused") : route.fulfill({ status: 500, contentType: "application/json", body: '{"fehler":"offline"}' }));
// „Absturz“: kein Speichern mehr, das dem Neuladen zuvorkommt. Das Ordnerrecht sperrt auch ein PUT, das beim Neuladen schon unterwegs ist und an page.route vorbei die Datei doch noch schreiben würde.
const notizOrdner = () => join(vault, "10_notizen");
const absturz = async (page) => { await page.evaluate(() => { window.__absturz = true; }); chmodSync(notizOrdner(), 0o555); };
const erlaube = async (page) => { chmodSync(notizOrdner(), 0o755); await page.unrouteAll({ behavior: "ignoreErrors" }); };
const ende = async (page) => { await page.locator(".cm-content").click(); await page.keyboard.press("Meta+ArrowDown"); };
const anfang = async (page) => { await page.locator(".cm-content").click(); await page.keyboard.press("Meta+ArrowUp"); await page.keyboard.press("End"); };

// ──────────────────────────────────────────────────────────── K2
test("K2: Änderung von außen ohne Überschneidung wird eingearbeitet — Toast mit „Rückgängig“, die fremde Fassung liegt in der Ablage", async ({ page }) => {
  await starte(page, { put500: true });
  await anfang(page);
  await page.keyboard.type(" (mein Titel)");                     // ungespeichert: der Server lehnt PUT ab
  writeFileSync(join(vault, NOTIZ), lese(NOTIZ) + "Zeile von außen (KI)\n");   // ein anderes Programm hängt an
  const toast = page.locator(".toast", { hasText: "eingearbeitet" });
  await expect(toast).toBeVisible({ timeout: 6000 });
  await expect(toast).toContainText("Änderung von einem anderen Programm eingearbeitet");
  await expect(page.locator(".cm-content")).toContainText("(mein Titel)");
  await expect(page.locator(".cm-content")).toContainText("Zeile von außen (KI)");
  await expect(page.locator("#speicherstand")).toHaveText("Gespeichert");
  expect(lese(NOTIZ)).toContain("# Reise nach Lissabon (mein Titel)");
  expect(lese(NOTIZ)).toContain("Zeile von außen (KI)");
  expect(inhaltDerAblage().some((t) => t.endsWith("Zeile von außen (KI)\n") && !t.includes("(mein Titel)"))).toBe(true);
  // Rückgängig: im Editor steht wieder meine Fassung; beim Speichern ersetzt sie den zusammengeführten Stand — die fremde Zeile bleibt in der Ablage
  await erlaube(page);
  await toast.getByText("Rückgängig").click();
  await expect(page.locator(".cm-content")).not.toContainText("Zeile von außen (KI)");
  await expect(page.locator("#speicherstand")).toHaveText("Gespeichert", { timeout: 6000 });
  expect(lese(NOTIZ)).not.toContain("Zeile von außen (KI)");
  expect(lese(NOTIZ)).toContain("(mein Titel)");
});

test("K2: Überschneidung — kompakte Ansicht mit Meine / Andere / Beide / Zusammenführen; bis zur Wahl bleibt die Datei unberührt", async ({ page }) => {
  await starte(page, { put500: true });
  await ende(page);
  await page.keyboard.type("MEINE ZEILE");
  const fremd = "# Reise nach Lissabon\n\nFlug im Mai. Hotel in der Alfama. Mietwagen nicht nötig.\nFREMDE ZEILE\n";
  writeFileSync(join(vault, NOTIZ), fremd.replace("FREMDE ZEILE\n", "FREMDE ZEILE"));
  const ansicht = page.locator('[data-banner="fremd-konflikt"]');
  await expect(ansicht).toBeVisible({ timeout: 6000 });
  for (const a of ["meine", "andere", "beide", "zusammen"]) await expect(ansicht.locator(`[data-aktion="fremd-${a}"]`)).toBeVisible();
  await expect(ansicht.locator('[data-aktion="fremd-speichern"]')).toBeDisabled();
  await expect(ansicht).toContainText("Noch 1 Stelle offen");
  expect(lese(NOTIZ)).toBe(fremd.replace("FREMDE ZEILE\n", "FREMDE ZEILE"));       // nichts geschrieben
  // der Editor ist gesperrt, die Eingabe bleibt stehen
  await expect(page.locator(".cm-content")).toContainText("MEINE ZEILE");
  await expect(page.locator(".cm-content")).toHaveAttribute("contenteditable", "false");
  await erlaube(page);
  // Zusammenführen: selbst formulieren
  await ansicht.locator('[data-aktion="fremd-zusammen"]').click();
  await ansicht.locator('[data-feld="fremd-text"]').fill("BEIDES NEU GEFASST");
  await ansicht.locator('[data-aktion="fremd-eigen-ok"]').click();
  await expect(ansicht.locator('[data-aktion="fremd-speichern"]')).toBeEnabled();
  await ansicht.locator('[data-aktion="fremd-speichern"]').click();
  await expect(ansicht).toHaveCount(0);
  await expect(page.locator(".cm-content")).toHaveAttribute("contenteditable", "true");
  expect(lese(NOTIZ)).toContain("BEIDES NEU GEFASST");
  expect(lese(NOTIZ)).not.toContain("MEINE ZEILE");
  const ablage = inhaltDerAblage();
  expect(ablage.some((t) => t.includes("FREMDE ZEILE"))).toBe(true);     // die fremde Fassung
  expect(ablage.some((t) => t.includes("MEINE ZEILE"))).toBe(true);      // meine Fassung
});

test("K2: „Beide“ legt meine und die andere Zeile untereinander; „Später entscheiden“ sperrt nichts und verliert nichts", async ({ page }) => {
  await starte(page, { put500: true });
  await ende(page);
  await page.keyboard.type("MEINE ZEILE");
  writeFileSync(join(vault, NOTIZ), "# Reise nach Lissabon\n\nFlug im Mai. Hotel in der Alfama. Mietwagen nicht nötig.\nANDERE ZEILE");
  const ansicht = page.locator('[data-banner="fremd-konflikt"]');
  await expect(ansicht).toBeVisible({ timeout: 6000 });
  await ansicht.locator('[data-aktion="fremd-spaeter"]').click();
  await expect(ansicht).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText("MEINE ZEILE");
  await expect(page.locator("#speicherstand")).toHaveText("Nicht gespeichert");
  // erneut speichern (⌘S) → dieselbe Wahl kommt wieder
  await erlaube(page);
  await page.keyboard.press("Meta+s");
  await expect(ansicht).toBeVisible({ timeout: 6000 });
  await ansicht.locator('[data-aktion="fremd-beide"]').click();
  await ansicht.locator('[data-aktion="fremd-speichern"]').click();
  await expect(ansicht).toHaveCount(0);
  expect(lese(NOTIZ)).toMatch(/MEINE ZEILE\nANDERE ZEILE/);
});

test("K2: dieselbe Änderung auf beiden Seiten — kein Konflikt, nichts doppelt", async ({ page }) => {
  await starte(page, { put500: true });
  await ende(page);
  await page.keyboard.type("GLEICH");
  writeFileSync(join(vault, NOTIZ), "# Reise nach Lissabon\n\nFlug im Mai. Hotel in der Alfama. Mietwagen nicht nötig.\nGLEICH");
  await expect(page.locator("#speicherstand")).toHaveText("Gespeichert", { timeout: 6000 });
  await expect(page.locator('[data-banner="fremd-konflikt"]')).toHaveCount(0);
  expect((lese(NOTIZ).match(/GLEICH/g) || []).length).toBe(1);
});

// ──────────────────────────────────────────────────────────── W1
test("W1: Entwurfs-Journal — ungespeicherter Text überlebt das Neuladen; „Ungespeicherten Text wiederherstellen“ mit Vergleich, danach ist der Entwurf weg", async ({ page }) => {
  await starte(page, { put500: true, journalMs: 300 });
  await ende(page);
  await page.keyboard.type("RETTE MICH");
  await expect.poll(() => entwuerfe().length, { timeout: 5000 }).toBe(1);
  const datei = entwuerfe()[0];
  if (process.platform !== "win32") expect(statSync(datei).mode & 0o777).toBe(0o600); // Windows kennt keine Unix-Dateirechte (die Datei liegt im Profil des Benutzers)
  const j = JSON.parse(readFileSync(datei, "utf8"));
  expect(j.pfad).toBe(NOTIZ); expect(j.text).toContain("RETTE MICH"); expect(j.basisHash).toMatch(/^[0-9a-f]{64}$/);
  expect(lese(NOTIZ)).not.toContain("RETTE MICH");
  // „Absturz“: die Seite wird neu geladen (ohne dass beim Verlassen noch gespeichert werden kann), der Text war nur im Speicher
  await absturz(page);
  await page.goto(server.url + "?pfad=" + encodeURIComponent(NOTIZ));
  await page.waitForSelector(".cm-content .cm-line");
  const banner = page.locator('[data-banner="entwurf"]');
  await expect(banner).toBeVisible({ timeout: 6000 });
  await erlaube(page);
  await expect(banner).toContainText("Ungespeicherter Text von");
  await expect(page.locator(".cm-content")).not.toContainText("RETTE MICH");
  await banner.locator('[data-aktion="entwurf-vergleichen"]').click();
  await expect(banner.locator("[data-vergleich]")).toContainText("RETTE MICH");
  await banner.locator('[data-aktion="entwurf-wiederherstellen"]').click();
  await expect(page.locator(".cm-content")).toContainText("RETTE MICH");
  await expect(page.locator("#speicherstand")).toHaveText("Gespeichert", { timeout: 6000 });
  expect(lese(NOTIZ)).toContain("RETTE MICH");
  await expect.poll(() => entwuerfe().length, { timeout: 5000 }).toBe(0);
  await expect(banner).toHaveCount(0);
});

test("W1: Entwurf verwerfen — er liegt danach noch unter „Gesicherte Fassungen“, das Journal ist leer", async ({ page }) => {
  await starte(page, { put500: true, journalMs: 300 });
  await ende(page);
  await page.keyboard.type("NUR ENTWURF");
  await expect.poll(() => entwuerfe().length, { timeout: 5000 }).toBe(1);
  await absturz(page);
  await page.goto(server.url + "?pfad=" + encodeURIComponent(NOTIZ));
  const banner = page.locator('[data-banner="entwurf"]');
  await expect(banner).toBeVisible({ timeout: 6000 });
  await banner.locator('[data-aktion="entwurf-verwerfen"]').click();
  await expect(banner).toHaveCount(0);
  expect(entwuerfe().length).toBe(0);
  expect(inhaltDerAblage().some((t) => t.includes("NUR ENTWURF"))).toBe(true);
  expect(lese(NOTIZ)).not.toContain("NUR ENTWURF");
});

test("W1: Fenster verlassen (blur) schreibt den Entwurf sofort ins Journal", async ({ page }) => {
  await starte(page, { put500: true });                         // Journal-Takt bleibt bei 5 s: nur der Fensterwechsel kann so schnell schreiben
  await ende(page);
  await page.keyboard.type("BEIM VERLASSEN");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect.poll(() => entwuerfe().length, { timeout: 2500 }).toBe(1);
  expect(JSON.parse(readFileSync(entwuerfe()[0], "utf8")).text).toContain("BEIM VERLASSEN");
});

test("W1: Marke ?nachAbsturz=1 (die App lädt nach einem Absturz des Fensters neu): Hinweis, Marke verschwindet aus der Adresse, Entwurf wird angeboten", async ({ page }) => {
  await starte(page, { put500: true, journalMs: 300 });
  await ende(page);
  await page.keyboard.type("VOR DEM ABSTURZ");
  await expect.poll(() => entwuerfe().length, { timeout: 5000 }).toBe(1);
  await absturz(page);
  await page.goto(server.url + "?pfad=" + encodeURIComponent(NOTIZ) + "&nachAbsturz=1");
  await expect(page.locator(".toast", { hasText: "abgestürzt und wurde neu geladen" })).toBeVisible({ timeout: 6000 });
  await expect(page.locator('[data-banner="entwurf"]')).toBeVisible();
  expect(page.url()).not.toContain("nachAbsturz");
});

test("W1: Entwurf zu einer ANDEREN Notiz — Hinweis beim Start mit „Ansehen“", async ({ page }) => {
  await starte(page, { put500: true, journalMs: 300 });
  await ende(page);
  await page.keyboard.type("ANDERE NOTIZ ENTWURF");
  await expect.poll(() => entwuerfe().length, { timeout: 5000 }).toBe(1);
  await absturz(page);
  await page.goto(server.url + "?pfad=" + encodeURIComponent("09_wiki/wissen/Kaffee.md"));
  await page.waitForSelector(".cm-content .cm-line");
  const hinweis = page.locator(".toast", { hasText: "Ungespeicherter Text von" });
  await expect(hinweis).toContainText("Reise nach Lissabon");
  await hinweis.getByText("Ansehen").click();
  await expect(page.locator('[data-banner="entwurf"]')).toBeVisible({ timeout: 6000 });
});

test("W1/S9: Hintergrunddienst weg — klare Meldung statt nur „Nicht gespeichert“, danach wird von selbst erneut gespeichert", async ({ page }) => {
  await starte(page);
  await blockierePut(page, "abbruch");                           // wie ein toter Hintergrunddienst: die Verbindung bricht ab (status 0)
  await ende(page);
  await page.keyboard.type("WERKSTATT WEG");
  await expect(page.locator("#speicherstand")).toHaveText("Speichern gerade nicht möglich", { timeout: 6000 });
  await expect(page.locator(".toast.fehler")).toContainText("Kortex startet den Hintergrunddienst neu");
  expect(lese(NOTIZ)).not.toContain("WERKSTATT WEG");
  await erlaube(page);                            // der Dienst läuft wieder (die App hat ihn bei der nächsten Anfrage neu gestartet)
  await expect(page.locator("#speicherstand")).toHaveText("Gespeichert", { timeout: 12000 });
  await expect(page.locator(".toast", { hasText: "Hintergrunddienst läuft wieder" })).toBeVisible();
  expect(lese(NOTIZ)).toContain("WERKSTATT WEG");
});

// ──────────────────────────────────────────────────────────── W3
test("W3: Einstellungen → Sicherung & GitHub — „Fassungen automatisch anlegen“ ist an (Standard), „Automatisch abgleichen“ ist aus und nur vorbereitet („bald“)", async ({ page }) => {
  await starte(page, { config: true });
  await page.evaluate(() => { location.hash = "#einstellungen/sicherung"; });
  await expect(page.locator("[data-einstellungen]")).toBeVisible();
  const auto = page.locator('[data-zeile="fassungen-automatisch"]');
  await expect(auto).toContainText("Fassungen automatisch anlegen");
  await expect(auto).toContainText("Ist die GitHub-Sicherung eingerichtet, lädt die Sicherung im Hintergrund sie danach hoch");
  await expect(auto.locator('[role="switch"]')).toHaveAttribute("aria-checked", "true");
  const abgleich = page.locator('[data-zeile="abgleich-automatisch"]');
  await expect(abgleich).toContainText("Automatisch abgleichen");
  await expect(abgleich).toContainText("Kommt bald");
  await expect(abgleich).toContainText("verlassen dann den Mac");
  await expect(abgleich.locator('[role="switch"]')).toHaveAttribute("aria-checked", "false");
  await expect(abgleich.locator('[role="switch"]')).toBeDisabled();
  // ausschalten wird gespeichert
  const put = page.waitForResponse((r) => r.url().includes("/api/einstellungen") && r.request().method() === "PUT");
  await auto.locator('[role="switch"]').click();
  expect((await put).status()).toBe(200);
  expect(JSON.parse(readFileSync(join(server.support, "einstellungen.json"), "utf8")).fassungenAutomatisch).toBe(false);
});

test("W3: nach dem Speichern und kurzer Ruhe legt Kortex von selbst eine Fassung an — „Automatisch gesichert: 1 Notiz“, nur lokal", async ({ page }) => {
  await starte(page, { umgebung: { KORTEX_AUTO_LEERLAUF_MS: "700" } });
  const vorher = git(vault, "rev-list", "--count", "HEAD").trim();
  await ende(page);
  await page.keyboard.type("AUTOMATISCH");
  await expect(page.locator("#speicherstand")).toHaveText("Gespeichert", { timeout: 5000 });
  await expect.poll(() => git(vault, "log", "-1", "--format=%s").trim(), { timeout: 8000 }).toBe("Automatisch gesichert: 1 Notiz");
  expect(Number(git(vault, "rev-list", "--count", "HEAD").trim())).toBe(Number(vorher) + 1);
  expect(git(vault, "status", "--porcelain").trim()).toBe("");
  expect(git(vault, "rev-list", "--count", "origin/main..HEAD").trim()).toBe("1");   // nur lokal: der Remote hat sie nicht
  expect(git(vault, "rev-parse", "origin/main").trim()).not.toBe(git(vault, "rev-parse", "HEAD").trim());
});

test("W3: Fensterwechsel (blur) sichert sofort, ohne die 2 Minuten Ruhe abzuwarten", async ({ page }) => {
  await starte(page);                                            // Standard-Ruhe: 2 Minuten
  await ende(page);
  await page.keyboard.type("FENSTERWECHSEL");
  await expect(page.locator("#speicherstand")).toHaveText("Gespeichert", { timeout: 5000 });
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect.poll(() => git(vault, "log", "-1", "--format=%s").trim(), { timeout: 8000 }).toBe("Automatisch gesichert: 1 Notiz");
});

test("W3: Schalter aus — kein Commit, auch nicht beim Fensterwechsel", async ({ page }) => {
  await starte(page);
  writeFileSync(join(server.support, "einstellungen.json"), JSON.stringify({ fassungenAutomatisch: false }) + "\n");
  const vorher = git(vault, "rev-list", "--count", "HEAD").trim();
  await ende(page);
  await page.keyboard.type("OHNE FASSUNG");
  await expect(page.locator("#speicherstand")).toHaveText("Gespeichert", { timeout: 5000 });
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.waitForTimeout(1500);
  expect(git(vault, "rev-list", "--count", "HEAD").trim()).toBe(vorher);
  expect(git(vault, "status", "--porcelain")).toContain("Reise nach Lissabon.md");
});

// ──────────────────────────────────────────────────────────── Nach dem Review
// Öffnet die Notiz neu („Absturz“) mit einem Entwurf im Journal und gibt das Angebot zurück
async function mitEntwurf(page, text = "VOR DEM ABSTURZ") {
  await starte(page, { put500: true, journalMs: 300 });
  await ende(page);
  await page.keyboard.type(text);
  await expect.poll(() => entwuerfe().length, { timeout: 5000 }).toBe(1);
}

test("Review 4a: wer trotz Angebot weitertippt, verliert den Entwurf nicht — er geht in die Ablage, das Angebot endet", async ({ page }) => {
  await mitEntwurf(page);
  await absturz(page);
  await page.goto(server.url + "?pfad=" + encodeURIComponent(NOTIZ));
  await page.waitForSelector(".cm-content .cm-line");
  const banner = page.locator('[data-banner="entwurf"]');
  await expect(banner).toBeVisible({ timeout: 6000 });
  await erlaube(page);
  await ende(page);
  await page.keyboard.type(" UND WEITER");
  await expect(banner).toHaveCount(0);
  await expect(page.locator(".toast", { hasText: "liegt jetzt unter „Gesicherte Fassungen“" })).toBeVisible();
  await expect(page.locator("#speicherstand")).toHaveText("Gespeichert", { timeout: 6000 });
  expect(inhaltDerAblage().some((t) => t.includes("VOR DEM ABSTURZ"))).toBe(true);
  expect(lese(NOTIZ)).toContain("UND WEITER");
});

test("Review 4b: war schon getippt, als die Antwort der Werkstatt kam, wird der Entwurf nicht still verworfen, sondern abgelegt", async ({ page }) => {
  await mitEntwurf(page);
  let frei; const tor = new Promise((r) => { frei = r; });
  await page.route("**/api/entwurf?*", async (route) => { await tor; await route.fallback(); });
  await absturz(page);
  await page.goto(server.url + "?pfad=" + encodeURIComponent(NOTIZ));
  await page.waitForSelector(".cm-content .cm-line");
  await ende(page);
  await page.keyboard.type("SCHNELL GETIPPT");
  await expect(page.locator("#speicherstand")).toHaveText("Nicht gespeichert");
  frei();
  await expect.poll(() => inhaltDerAblage().some((t) => t.includes("VOR DEM ABSTURZ")), { timeout: 6000 }).toBe(true);
  await expect(page.locator('[data-banner="entwurf"]')).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText("SCHNELL GETIPPT");
});

test("Review 4c: „Wiederherstellen“ ersetzt Getipptes nicht still — der aktuelle Text kommt vorher in die Ablage", async ({ page }) => {
  await mitEntwurf(page);
  await absturz(page);
  await page.goto(server.url + "?pfad=" + encodeURIComponent(NOTIZ));
  await page.waitForSelector(".cm-content .cm-line");
  const banner = page.locator('[data-banner="entwurf"]');
  await expect(banner).toBeVisible({ timeout: 6000 });
  // das Ablegen des Entwurfs beim Tippen scheitert (die Werkstatt ist kurz weg): das Angebot bleibt, der getippte Text steht im Editor
  let weg = true;
  await page.route("**/api/ablage/ablegen", (route) => (weg ? route.fulfill({ status: 500, contentType: "application/json", body: '{"fehler":"kurz weg"}' }) : route.fallback()));
  await ende(page);
  await page.keyboard.type(" ZWISCHENDURCH");
  await expect(page.locator(".toast", { hasText: "kurz weg" }).first()).toBeVisible();
  await expect(banner).toBeVisible();
  weg = false;
  await banner.locator('[data-aktion="entwurf-wiederherstellen"]').click();
  await expect(page.locator(".cm-content")).toContainText("VOR DEM ABSTURZ");
  expect(inhaltDerAblage().some((t) => t.includes("ZWISCHENDURCH"))).toBe(true);
});

test("Review 5: „Rückgängig“ nach dem Einarbeiten legt frisch Getipptes vorher in die Ablage", async ({ page }) => {
  await starte(page, { put500: true });
  await anfang(page);
  await page.keyboard.type(" (mein Titel)");
  writeFileSync(join(vault, NOTIZ), lese(NOTIZ) + "Zeile von außen (KI)\n");
  const toast = page.locator(".toast", { hasText: "eingearbeitet" });
  await expect(toast).toBeVisible({ timeout: 6000 });
  await ende(page);
  await page.keyboard.type("FRISCH GETIPPT");
  await toast.getByText("Rückgängig").click();
  await expect.poll(() => inhaltDerAblage().some((t) => t.includes("FRISCH GETIPPT")), { timeout: 5000 }).toBe(true);
  await expect(page.locator(".cm-content")).not.toContainText("FRISCH GETIPPT");
});

test("Review 8: ein eigener Text im Konfliktblock behält die Zeilenenden einer CRLF-Datei und eine Leerzeile", async ({ page }) => {
  await starte(page, { put500: true });
  const crlf = lese(NOTIZ).replace(/\r?\n/g, "\r\n");
  writeFileSync(join(vault, NOTIZ), crlf);
  await absturz(page);
  await page.goto(server.url + "?pfad=" + encodeURIComponent(NOTIZ));
  await page.waitForSelector(".cm-content .cm-line");
  await blockierePut(page);
  await ende(page);
  await page.keyboard.type("MEINE ZEILE");
  writeFileSync(join(vault, NOTIZ), crlf + "ANDERE ZEILE");
  const ansicht = page.locator('[data-banner="fremd-konflikt"]');
  await expect(ansicht).toBeVisible({ timeout: 6000 });
  await erlaube(page);
  await ansicht.locator('[data-aktion="fremd-zusammen"]').click();
  await ansicht.locator('[data-feld="fremd-text"]').fill("ERSTE\n\nDRITTE");
  await ansicht.locator('[data-aktion="fremd-eigen-ok"]').click();
  await ansicht.locator('[data-aktion="fremd-speichern"]').click();
  await expect(ansicht).toHaveCount(0);
  const d = lese(NOTIZ);
  expect(d).toContain("ERSTE\r\n\r\nDRITTE");
  expect(d.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);     // keine einzelnen \n oder \r: die Datei bleibt einheitlich CRLF
});

test("Review 10: ein 409 beim Zusammenführen (ein anderes Programm war schneller) wird einmal automatisch neu gerechnet", async ({ page }) => {
  await starte(page, { put500: true });
  let n = 0;
  await page.route("**/api/datei/zusammenfuehren", (route) => (n++ === 0
    ? route.fulfill({ status: 409, contentType: "application/json", body: '{"fehler":"Die Datei wurde inzwischen geändert."}' })
    : route.fallback()));
  await anfang(page);
  await page.keyboard.type(" (mein Titel)");
  writeFileSync(join(vault, NOTIZ), lese(NOTIZ) + "Zeile von außen (KI)\n");
  await expect(page.locator(".toast", { hasText: "eingearbeitet" })).toBeVisible({ timeout: 8000 });
  expect(n).toBeGreaterThanOrEqual(2);
  expect(lese(NOTIZ)).toContain("(mein Titel)");
  expect(lese(NOTIZ)).toContain("Zeile von außen (KI)");
});

test("Review 11: der Entwurf einer verschobenen oder gelöschten Notiz verwaist nicht — er liegt danach in der Ablage", async ({ page }) => {
  await mitEntwurf(page, "VERWAISTER TEXT");
  renameSync(join(vault, NOTIZ), join(vault, "10_notizen/Lissabon verschoben.md"));
  await absturz(page);
  await page.goto(server.url + "?pfad=" + encodeURIComponent("09_wiki/wissen/Kaffee.md"));
  await page.waitForSelector(".cm-content .cm-line");
  await expect(page.locator(".toast", { hasText: "verschobenen oder gelöschten" })).toBeVisible({ timeout: 8000 });
  await expect.poll(() => entwuerfe().length, { timeout: 5000 }).toBe(0);
  expect(inhaltDerAblage().some((t) => t.includes("VERWAISTER TEXT"))).toBe(true);
});

test("Nach Review 2: scheitert die Ablage, während das Angebot offen ist, überschreibt das Journal den Entwurf nicht", async ({ page }) => {
  await mitEntwurf(page);
  await absturz(page);
  await page.goto(server.url + "?pfad=" + encodeURIComponent(NOTIZ));
  await page.waitForSelector(".cm-content .cm-line");
  const banner = page.locator('[data-banner="entwurf"]');
  await expect(banner).toBeVisible({ timeout: 6000 });
  await page.route("**/api/ablage/ablegen", (route) => route.fulfill({ status: 500, contentType: "application/json", body: '{"fehler":"kurz weg"}' }));
  await ende(page);
  await page.keyboard.type(" NEUER TEXT");
  await expect(page.locator(".toast", { hasText: "kurz weg" }).first()).toBeVisible();
  await page.waitForTimeout(1200);                      // mehrere Journal-Intervalle (300 ms)
  await expect(banner).toBeVisible();
  const j = JSON.parse(readFileSync(entwuerfe()[0], "utf8"));
  expect(j.text).toContain("VOR DEM ABSTURZ");
  expect(j.text).not.toContain("NEUER TEXT");
});
