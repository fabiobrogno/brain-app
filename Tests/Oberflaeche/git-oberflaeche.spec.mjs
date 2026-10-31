// Git-Oberfläche des Studios: Statusleiste mit Hauptknopf „Abgleichen“, Konfliktdialog (Karten, Fortschritt), Wiederherstellen,
// Diff „Nebeneinander“ mit wortgenauer Hervorhebung, Verlauf mit Namenskürzel und Tageslabel, Fehler ohne rohen Git-Text.
// Module laufen auf der kleinen Testseite (modul-seite.mjs); die Statusleiste wird in der ganzen App gegen den Entwicklungsserver geprüft.
import { test, expect } from "./basis.mjs";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { mockeV2 } from "./mocks.mjs";
import { starteDateien, oeffneSeite, sichtbar as sichtbarMit, BILDER } from "./modul-seite.mjs";

mkdirSync(BILDER, { recursive: true });
const sichtbar = (l) => sichtbarMit(expect, l);

let dateien;
test.beforeAll(async () => { dateien = await starteDateien(); });
test.afterAll(() => dateien?.stopp());
const seite = (page) => oeffneSeite(page, dateien.url);

// ---------------------------------------------------------------- Frühere Fassung zurückholen
const DIFF_ZURUECK = [
  "diff --git a/10_notizen/Reise nach Lissabon.md b/10_notizen/Reise nach Lissabon.md",
  "--- a/10_notizen/Reise nach Lissabon.md", "+++ b/10_notizen/Reise nach Lissabon.md",
  "@@ -1,4 +1,3 @@", " # Reise nach Lissabon", " ", "-Flug im Mai. Hotel in der Alfama. Mietwagen nicht nötig.", "+Flug im Mai. Hotel in der Alfama.", "",
].join("\n");
async function oeffneZurueckholen(page, o = {}) {
  await page.evaluate(async (opt) => {
    const m = await import("/abgleich.js");
    const { api } = await import("/api.js");
    window.__dlg = m.oeffneZurueckholen({ pfad: "10_notizen/Reise nach Lissabon.md", sha: "9c7d0e1b3a5f", wann: "vom 24. Okt., 09:20", api,
      beiFertig: (r) => window.__ereignis.push({ art: "fertig", ...r }), beiSichern: opt.mitSichern ? () => window.__ereignis.push({ art: "sichern" }) : undefined });
  }, o);
}

test("Zurückholen: Vorschau mit Plus/Minus, beruhigender Hinweis, Knopf bereit und fokussiert; Klick sichert als neue Fassung", async ({ page }) => {
  const ruf = [];
  await page.route(/\/api\/git\/wiederherstellen\/vorschau(\?|$)/, (r) => r.fulfill({ json: { diff: DIFF_ZURUECK, unveraendert: false, ungesichert: false } }));
  await page.route(/\/api\/git\/wiederherstellen$/, (r) => { ruf.push(r.request().postDataJSON()); r.fulfill({ json: { ok: true } }); });
  await seite(page); await oeffneZurueckholen(page);
  const d = page.locator('[data-dialog="zurueckholen"]');
  await sichtbar(d);
  await expect(d.locator(".rm-titel")).toHaveText("Frühere Fassung zurückholen");
  await expect(d.locator(".rm-text")).toContainText("„Reise nach Lissabon.md“ wird auf die Fassung vom 24. Okt., 09:20 zurückgesetzt");
  await expect(d.locator(".zh-kopf .ab-hinweis")).toHaveText("Das ändert sich:");
  await expect(d.locator(".zh-kopf .vl-plus")).toHaveText("+1");
  await expect(d.locator(".zh-kopf .vl-weg")).toHaveText("−1");
  await expect(d.locator(".vd-z.p")).toHaveCount(1);
  await expect(d.locator(".vd-z.m")).toHaveCount(1);
  await expect(d.locator(".zh-sicher")).toBeVisible();
  await expect(d.locator(".zh-sicher")).toContainText("Nichts geht verloren");
  const knopf = d.locator('[data-aktion="zurueckholen"]');
  await expect(knopf).toBeEnabled();
  await expect(knopf).toBeFocused();
  await knopf.click();
  await expect(d).toHaveCount(0);
  expect(ruf).toEqual([{ pfad: "10_notizen/Reise nach Lissabon.md", sha: "9c7d0e1b3a5f" }]);
  await expect(page.locator(".toast")).toContainText("Fassung zurückgeholt und gesichert");
  expect((await page.evaluate(() => window.__ereignis))[0]).toMatchObject({ art: "fertig", unveraendert: false });
});

test("Zurückholen: ungesicherte Änderungen sperren den Knopf und bieten „Jetzt sichern …“ an", async ({ page }) => {
  await page.route(/\/api\/git\/wiederherstellen\/vorschau(\?|$)/, (r) => r.fulfill({ json: { diff: DIFF_ZURUECK, unveraendert: false, ungesichert: true } }));
  await seite(page); await oeffneZurueckholen(page, { mitSichern: true });
  const d = page.locator('[data-dialog="zurueckholen"]');
  await expect(d.locator(".rm-meldung.hinweis")).toContainText("noch nicht gesichert");
  await expect(d.locator('[data-aktion="zurueckholen"]')).toBeDisabled();
  await expect(d.locator(".zh-sicher")).toBeHidden();
  await d.locator('[data-aktion="zurueckholen-sichern"]').click();
  await expect(d).toHaveCount(0);
  expect((await page.evaluate(() => window.__ereignis)).map((e) => e.art)).toEqual(["sichern"]);
});

test("Zurückholen: schon aktuell, und ein Vorschau-Fehler mit rohem Text zeigt Satz plus Details", async ({ page }) => {
  await page.route(/\/api\/git\/wiederherstellen\/vorschau(\?|$)/, (r) => r.fulfill({ json: { diff: "", unveraendert: true } }));
  await seite(page); await oeffneZurueckholen(page);
  await expect(page.locator('[data-dialog="zurueckholen"] .zh-kopf .ab-hinweis')).toHaveText("Diese Fassung ist schon die aktuelle. Es gibt nichts zurückzuholen.");
  await expect(page.locator('[data-aktion="zurueckholen"]')).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.unroute(/\/api\/git\/wiederherstellen\/vorschau(\?|$)/);
  await page.route(/\/api\/git\/wiederherstellen\/vorschau(\?|$)/, (r) => r.fulfill({ status: 500, json: { fehler: "fatal: bad object 9c7d0e1b3a5f" } }));
  await oeffneZurueckholen(page);
  const kopf = page.locator('[data-dialog="zurueckholen"] .zh-kopf .ab-hinweis');
  await expect(kopf).toHaveText("Die Vorschau konnte nicht geladen werden.");
  await expect(page.locator('[data-dialog="zurueckholen"] .roh-details')).toBeVisible();
  await expect(page.locator('[data-dialog="zurueckholen"] .roh-text')).toBeHidden();
});

// ---------------------------------------------------------------- Diff: Nebeneinander und Wörter
const DIFF_WORTE = [
  "--- a/x.md", "+++ b/x.md", "@@ -1,5 +1,6 @@",
  " # Titel", " ",
  "-Der schnelle braune Fuchs springt über den Zaun.",
  "+Der langsame braune Hund springt über den Zaun.",
  " Ein unveränderter Satz.",
  "-Alt eins", "+Neu eins", "+Neu zwei", "+Neu drei", "",
].join("\n");
async function zeigeDiff(page, diff = DIFF_WORTE) {
  await page.route(/\/api\/git\/diff(\?|$)/, (r) => r.fulfill({ json: { diff } }));
  await page.evaluate(async () => {
    const { zeigeDiff } = await import("/verlauf.js");
    const { api } = await import("/api.js");
    window.__dv = zeigeDiff(document.getElementById("t-diff"), { api, sha: "9c7d0e1b3a5f", kurz: "9c7d0e1", nachricht: "Satz geändert", pfad: "10_notizen/x.md", status: "M", zeit: new Date(Date.now() - 300000).toISOString(),
      beiSchliessen: () => window.__ereignis.push({ art: "schliessen" }), beiWiederherstellen: () => {} });
  });
}

test("Diff: mehrere geänderte Wörter einer Zeile sind einzeln markiert (nicht ein großer Block)", async ({ page }) => {
  await seite(page); await zeigeDiff(page);
  await sichtbar(page.locator(".vd-z.m").first());
  await expect(page.locator(".vd-z.m").first().locator(".vd-w")).toHaveText(["schnelle", "Fuchs"]);
  await expect(page.locator(".vd-z.p").first().locator(".vd-w")).toHaveText(["langsame", "Hund"]);
  // 1 gelöscht + 3 neu: kein 1:1-Paar, also keine Wortmarken
  await expect(page.locator(".vd-z.m").nth(1).locator(".vd-w")).toHaveCount(0);
});

test("Diff: Umschalter „Untereinander | Nebeneinander“ mit Reihen links/rechts, Platzhaltern und gemerkter Wahl", async ({ page }) => {
  await seite(page); await zeigeDiff(page);
  const umschalter = page.locator(".vd-leiste .seg");
  await sichtbar(umschalter);
  await expect(umschalter).toHaveAttribute("role", "group");
  await expect(umschalter.locator('[data-ansicht="zeilen"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-diff][data-ansicht="zeilen"]')).toBeVisible();
  await umschalter.locator('[data-ansicht="spalten"]').click();
  await expect(umschalter.locator('[data-ansicht="spalten"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-diff][data-ansicht="spalten"]')).toBeVisible();
  await expect(page.locator(".vd-spaltenkopf")).toContainText("Vorher");
  await expect(page.locator(".vd-spaltenkopf")).toContainText("Danach");
  // Reihen: zwei Kopf-/Kontextzeilen, Paar 1:1, Kontext, 1 Paar + 2 Reihen mit leerer linker Seite
  const paare = page.locator(".vd-paar");
  await expect(paare).toHaveCount(7);
  await expect(paare.nth(2).locator(".vd-z.m .vd-w")).toHaveText(["schnelle", "Fuchs"]);
  await expect(paare.nth(2).locator(".vd-z.p .vd-w")).toHaveText(["langsame", "Hund"]);
  await expect(page.locator(".vd-paar .vd-z.platz")).toHaveCount(2);
  const [alt, neu] = await Promise.all([paare.nth(2).locator(".vd-z").first().boundingBox(), paare.nth(2).locator(".vd-z").last().boundingBox()]);
  expect(neu.x).toBeGreaterThan(alt.x + alt.width - 1);
  expect(Math.abs(neu.y - alt.y)).toBeLessThan(1);
  // gemerkt: neue Instanz startet nebeneinander
  await page.evaluate(() => window.__dv.zerstoere());
  await zeigeDiff(page);
  await expect(page.locator('[data-diff][data-ansicht="spalten"]')).toBeVisible();
  // per Tastatur zurück
  await page.locator('[data-ansicht="zeilen"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-diff][data-ansicht="zeilen"]')).toBeVisible();
});

// ---------------------------------------------------------------- Verlauf: Kürzel, Autor, Tageslabel, ruhige Fehler
const sha = (n) => (n.toString(16).padStart(2, "0") + "e7a9c4b1d03f58260e9a7bc41d3f8052a6c9e1").slice(0, 40);
const tagVon = (d) => d.toLocaleDateString("sv-SE");
function verlaufLog() {
  const jetzt = new Date(), gestern = new Date(jetzt.getTime() - 86400000);
  const c = (n, nachricht, zeit, autor) => ({ sha: sha(n), kurz: sha(n).slice(0, 7), nachricht, zeit: zeit.toISOString(), autor, plus: 0, geaendert: 1, dateien: [{ pfad: "10_notizen/x.md", status: "M" }] });
  const vor5 = new Date(jetzt.getTime() - 5 * 60000);
  return { tage: [
    { datum: tagVon(jetzt), commits: [c(1, "Mietwagen ergänzt", vor5, "Fabio Brogno"), c(2, "Notiz umbenannt", new Date(jetzt.getTime() - 3600000 * 2), "Anna")] },
    { datum: tagVon(gestern), commits: [c(3, "Erste Fassung", gestern, "")] },
  ] };
}
async function montiereListe(page) {
  await page.evaluate(async () => {
    const { zeichneVerlauf } = await import("/verlauf.js");
    const { api } = await import("/api.js");
    window.__vl = zeichneVerlauf(document.getElementById("t-host"), { api, beiDatei: (x) => window.__ruf.push(x) });
  });
}
const STATUS_OK = { repo: true, zweig: "main", geaendert: [], remote: true };

test("Verlauf: Namenskürzel statt Knoten, Autor in der Meta-Zeile, „Heute“ und „Gestern“ am Tageskopf", async ({ page }) => {
  await page.route(/\/api\/git\/log(\?|$)/, (r) => r.fulfill({ json: verlaufLog() }));
  await page.route(/\/api\/git\/status$/, (r) => r.fulfill({ json: STATUS_OK }));
  await seite(page); await montiereListe(page);
  await expect(page.locator(".vl-tagkopf")).toHaveCount(2);
  await expect(page.locator(".vl-tagkopf").nth(0).locator(".vl-tagrel")).toHaveText("Heute");
  await expect(page.locator(".vl-tagkopf").nth(1).locator(".vl-tagrel")).toHaveText("Gestern");
  const erste = page.locator(".vl-commitzeile").first();
  await expect(erste.locator(".vl-avatar")).toHaveText("FB");
  await expect(erste.locator(".vl-avatar")).toHaveAttribute("aria-hidden", "true");
  await expect(erste.locator(".vl-autor")).toHaveText("Fabio Brogno");
  await expect(erste.locator(".vl-zeit")).toHaveText("vor 5 Min");
  await expect(page.locator(".vl-commitzeile").nth(1).locator(".vl-avatar")).toHaveText("A");
  // ohne Autor: neutrales Personensymbol, kein leerer Autor
  const ohne = page.locator(".vl-commitzeile").nth(2);
  await expect(ohne.locator(".vl-autor")).toHaveCount(0);
  await expect(ohne.locator(".vl-avatar svg")).toHaveCount(1);
});

test("Verlauf: ein Ladefehler mit rohem Git-Text zeigt einen ruhigen Satz und klappbare Details", async ({ page }) => {
  await page.route(/\/api\/git\/log(\?|$)/, (r) => r.fulfill({ status: 500, json: { fehler: "fatal: not a git repository (or any of the parent directories): .git" } }));
  await page.route(/\/api\/git\/status$/, (r) => r.fulfill({ json: STATUS_OK }));
  await seite(page); await montiereListe(page);
  await expect(page.locator(".vl-leer-titel")).toHaveText("Der Verlauf konnte nicht geladen werden");
  await expect(page.locator(".vl-leer-text")).toHaveText("Der Verlauf konnte gerade nicht gelesen werden. Deine Dateien sind unverändert.");
  await expect(page.locator(".vl-leer .roh-text")).toBeHidden();
  await page.locator(".vl-leer summary").click();
  await expect(page.locator(".vl-leer .roh-text")).toContainText("fatal: not a git repository");
});

// ---------------------------------------------------------------- Statusleiste in der ganzen App
test.describe("Statusleiste: Hauptknopf „Abgleichen“", () => {
  let vault, server;
  test.beforeEach(async () => { ({ vault } = baueVault()); server = await starteServer(vault); });
  test.afterEach(() => server?.stopp());

  const jetztMinus = (min) => new Date(Date.now() - min * 60000).toISOString();
  const BASIS = () => ({ repo: true, zweig: "main", upstream: "origin/main", vor: 0, zurueck: 0, geaendert: [], remote: true, letzterSync: jetztMinus(5) });
  async function oeffneApp(page, stand, { nachsehen = "gleich" } = {}) {
    await mockeV2(page, vault);
    await page.route("**/api/git/status", (r) => r.fulfill({ json: stand }));
    await page.route("**/api/git/nachsehen", (r) => (nachsehen === "fehler" ? r.abort() : r.fulfill({ json: stand })));
    await page.goto(server.url + "?pfad=" + encodeURIComponent("10_notizen/Reise nach Lissabon.md"));
    await page.waitForSelector('[data-st="sync"]');
  }
  const sync = (page) => page.locator('[data-st="sync"]');

  test("jeder Zustand hat Text, Symbol, Farbe und Titel: aktuell · zu senden · Neues da · Konflikt · nie", async ({ page }) => {
    // aktuell
    await oeffneApp(page, BASIS());
    await expect(sync(page)).toHaveAttribute("data-zustand", "aktuell");
    await expect(sync(page)).toContainText("Gesichert vor 5 Min");
    await expect(sync(page).locator(".sync-aktion")).toContainText("Abgleichen");
    await expect(sync(page)).toHaveAttribute("aria-label", "Gesichert vor 5 Min. Abgleichen");
    await expect(sync(page)).toHaveRole("button");
    // zu senden
    await page.unroute("**/api/git/status"); await page.unroute("**/api/git/nachsehen");
    const senden = { ...BASIS(), vor: 3 };
    await page.route("**/api/git/status", (r) => r.fulfill({ json: senden }));
    await page.route("**/api/git/nachsehen", (r) => r.fulfill({ json: senden }));
    await page.reload(); await page.waitForSelector('[data-st="sync"]');
    await expect(sync(page)).toHaveAttribute("data-zustand", "senden");
    await expect(sync(page)).toContainText("3 zu senden");
    await expect(sync(page)).toHaveAttribute("title", /3 gesicherte Fassungen warten/);
    await expect(page.locator('[data-st="hochladen"]')).toHaveCount(0);
    // Neues da hat Vorrang vor „zu senden“
    await page.unroute("**/api/git/status"); await page.unroute("**/api/git/nachsehen");
    const neues = { ...BASIS(), vor: 3, zurueck: 2 };
    await page.route("**/api/git/status", (r) => r.fulfill({ json: neues }));
    await page.route("**/api/git/nachsehen", (r) => r.fulfill({ json: neues }));
    await page.reload(); await page.waitForSelector('[data-st="sync"]');
    await expect(sync(page)).toHaveAttribute("data-zustand", "neues");
    await expect(sync(page)).toContainText("Neues vom anderen Mac");
    await expect(page.locator('[data-st="zweig"]')).toContainText("↑3 ↓2");
    // nie abgeglichen / ohne Remote
    await page.unroute("**/api/git/status"); await page.unroute("**/api/git/nachsehen");
    const nie = { ...BASIS(), remote: false, upstream: null };
    await page.route("**/api/git/status", (r) => r.fulfill({ json: nie }));
    await page.route("**/api/git/nachsehen", (r) => r.fulfill({ json: nie }));
    await page.reload(); await page.waitForSelector('[data-st="sync"]');
    await expect(sync(page)).toHaveAttribute("data-zustand", "nie");
    await expect(sync(page)).toContainText("Noch nie abgeglichen");
  });

  test("Konflikt: roter Knopf „Konflikt in 3 Notizen“ öffnet die Konflikt-Ansicht (Abschnitt „Konflikt-Ansicht“ in konflikt.spec.mjs prüft sie ganz)", async ({ page }) => {
    const stand = { ...BASIS(), konflikt: { dateien: ["a.md", "b.md", "c.md"].map((pfad) => ({ pfad, art: "beide" })) } };
    await oeffneApp(page, stand);
    await expect(sync(page)).toHaveAttribute("data-zustand", "konflikt");
    await expect(sync(page)).toContainText("Konflikt in 3 Notizen");
    await expect(sync(page).locator(".sync-aktion")).toBeHidden(); // die Aktion steckt schon im Text
    await expect(sync(page)).toHaveAttribute("aria-label", "Konflikt in 3 Notizen");
    await expect(page.locator('[data-banner="abgleich"]')).toContainText("Konflikt in 3 Notizen");
    // Vermerk der Hintergrund-Sicherung (Kern): dieselbe Anzeige, ohne offene Zusammenführung
    await page.unroute("**/api/git/status"); await page.unroute("**/api/git/nachsehen");
    const kern = { ...BASIS(), sicherungStand: "konflikt", sicherungDateien: ["a.md", "05_aufgaben/x.md"] };
    await page.route("**/api/git/status", (r) => r.fulfill({ json: kern }));
    await page.route("**/api/git/nachsehen", (r) => r.fulfill({ json: kern }));
    await page.reload(); await page.waitForSelector('[data-st="sync"]');
    await expect(sync(page)).toHaveAttribute("data-zustand", "konflikt");
    await expect(sync(page)).toContainText("Konflikt in 1 Notiz und 1 Aufgabe");
  });

  test("Offline: gestrichelter Knopf „Offline“ mit erklärendem Titel, danach wieder normal", async ({ page }) => {
    await oeffneApp(page, BASIS(), { nachsehen: "fehler" });
    await expect(sync(page)).toHaveAttribute("data-zustand", "offline");
    await expect(sync(page)).toContainText("Offline");
    await expect(sync(page)).toHaveAttribute("title", /bleibt auf diesem Mac/);
    // Server wieder da: der Browser meldet „online“, das Nachsehen klappt
    await page.unroute("**/api/git/nachsehen");
    await page.route("**/api/git/nachsehen", (r) => r.fulfill({ json: BASIS() }));
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(sync(page)).toHaveAttribute("data-zustand", "aktuell");
  });

  test("Abgleich läuft: Knopf dreht, ist als beschäftigt markiert; danach Ergebnis und Ansage für Screenreader", async ({ page }) => {
    await oeffneApp(page, BASIS());
    await page.route("**/api/git/sync", async (route) => { await new Promise((r) => setTimeout(r, 700)); route.fulfill({ json: { ergebnis: "aktuell" } }); });
    await sync(page).click();
    await expect(sync(page)).toHaveAttribute("data-zustand", "laeuft");
    await expect(sync(page)).toContainText("Gleiche ab");
    await expect(sync(page)).toHaveAttribute("aria-busy", "true");
    await expect(sync(page).locator(".sync-aktion")).toBeHidden();
    await expect(sync(page)).toHaveAttribute("data-zustand", "aktuell", { timeout: 8000 });
    await expect(page.locator("#status-ansage")).toHaveAttribute("aria-live", "polite");
  });

  test("Fehler: roter Knopf; rohe Meldung der Versionsverwaltung wird zum ruhigen Satz, Details per Knopf im Hinweis", async ({ page }) => {
    await oeffneApp(page, BASIS());
    await page.route("**/api/git/sync", (route) => route.fulfill({ status: 500, json: { fehler: "fatal: unable to access 'https://github.com/x/y.git/': Could not resolve host: github.com" } }));
    await sync(page).click();
    await expect(sync(page)).toHaveAttribute("data-zustand", /fehler|offline/);
    const toast = page.locator(".toast.fehler");
    await expect(toast).toContainText("Der Abgleich hat nicht geklappt. Deine Dateien sind unverändert.");
    await expect(toast).not.toContainText("fatal");
    await toast.locator("a", { hasText: "Details zeigen" }).click();
    const d = page.locator('[data-dialog="details"]');
    await expect(d).toBeVisible();
    await expect(d.locator(".roh-text")).toContainText("Could not resolve host");
    await d.locator("button", { hasText: "Schließen" }).click();
    await expect(d).toHaveCount(0);
  });

  test("Fehler mit eigenem klaren Satz der Werkstatt bleibt unverändert sichtbar", async ({ page }) => {
    await oeffneApp(page, BASIS());
    await page.route("**/api/git/sync", (route) => route.fulfill({ status: 500, json: { fehler: "Der Server hat den Abgleich abgelehnt." } }));
    await sync(page).click();
    await expect(sync(page)).toHaveAttribute("data-zustand", "fehler");
    await expect(page.locator(".toast.fehler")).toHaveText("Der Server hat den Abgleich abgelehnt.");
  });
});

// ---------------------------------------------------------------- Bilder (hell und dunkel) für die Sichtprüfung
test.describe("Bilder Git-Oberfläche", () => {
  test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  for (const schema of ["hell", "dunkel"]) {
    test("Module " + schema, async ({ page }) => {
      await page.emulateMedia({ colorScheme: schema === "hell" ? "light" : "dark", reducedMotion: "reduce" });
      await page.route(/\/api\/git\/log(\?|$)/, (r) => r.fulfill({ json: verlaufLog() }));
      await page.route(/\/api\/git\/status$/, (r) => r.fulfill({ json: { ...STATUS_OK, geaendert: [{ pfad: "09_wiki/wissen/Kaffee.md", code: "M" }, { pfad: "00_inbox/neu.md", code: "??" }] } }));
      await page.route(/\/api\/git\/wiederherstellen\/vorschau(\?|$)/, (r) => r.fulfill({ json: { diff: DIFF_ZURUECK, unveraendert: false, ungesichert: false } }));
      await seite(page); await montiereListe(page);
      await expect(page.locator(".vl-tagkopf")).toHaveCount(2);
      await page.locator(".vl-commitzeile", { hasText: "Mietwagen" }).click();
      await page.locator(".vl-datei").first().click();
      await zeigeDiff(page);
      await sichtbar(page.locator(".vd-z.p").first());
      await page.mouse.move(900, 700);
      await page.screenshot({ path: join(BILDER, `git-verlauf-diff-zeilen-${schema}.png`) });
      await page.locator('[data-ansicht="spalten"]').click();
      await sichtbar(page.locator(".vd-paar").first());
      await page.screenshot({ path: join(BILDER, `git-verlauf-diff-spalten-${schema}.png`) });
      await page.evaluate(() => window.__dv.zerstoere());

      await oeffneZurueckholen(page);
      await sichtbar(page.locator('[data-dialog="zurueckholen"] .vd-z.p'));
      await page.screenshot({ path: join(BILDER, `git-zurueckholen-${schema}.png`) });
      await page.keyboard.press("Escape");

      // Remote-Dialog mit Fehler (Details aufklappbar)
      await page.route(/\/api\/git\/remote$/, (r) => r.fulfill({ status: 409, json: { fehler: "fatal: unable to access 'https://github.com/name/vault.git/': The requested URL returned error: 403" } }));
      await page.evaluate(async () => { const m = await import("/remote.js"); m.oeffneRemoteDialog({}); });
      await page.locator('[data-dialog="remote"] input').fill("https://github.com/name/vault.git");
      await page.locator('[data-dialog="remote"] input').press("Enter");
      await sichtbar(page.locator(".rm-meldung.fehlertext"));
      await page.locator(".rm-meldung summary").click();
      await page.screenshot({ path: join(BILDER, `git-remote-fehler-${schema}.png`) });
    });

    test("Statusleiste " + schema, async ({ page }) => {
      const { vault } = baueVault();
      const server = await starteServer(vault);
      try {
        await page.emulateMedia({ colorScheme: schema === "hell" ? "light" : "dark", reducedMotion: "reduce" });
        await mockeV2(page, vault);
        const min = (m) => new Date(Date.now() - m * 60000).toISOString();
        const basis = { repo: true, zweig: "main", upstream: "origin/main", vor: 0, zurueck: 0, geaendert: [], remote: true, letzterSync: min(5) };
        const faelle = {
          aktuell: basis,
          senden: { ...basis, vor: 3, geaendert: [{ pfad: "00_inbox/neu.md", code: "??" }] },
          neues: { ...basis, zurueck: 2 },
          konflikt: { ...basis, konflikt: { dateien: ["a.md"] } },
          nie: { ...basis, remote: false, upstream: null, letzterSync: null },
        };
        let aktuell = faelle.aktuell;
        await page.route("**/api/git/status", (r) => r.fulfill({ json: aktuell }));
        await page.route("**/api/git/nachsehen", (r) => r.fulfill({ json: aktuell }));
        for (const [name, stand] of Object.entries(faelle)) {
          aktuell = stand;
          await page.goto(server.url + "?pfad=" + encodeURIComponent("10_notizen/Reise nach Lissabon.md"));
          await page.waitForSelector('[data-st="sync"]');
          await page.waitForTimeout(250);
          await page.locator("#status").screenshot({ path: join(BILDER, `git-status-${name}-${schema}.png`) });
          if (name === "senden") await page.screenshot({ path: join(BILDER, `git-app-${schema}.png`) });
        }
        aktuell = faelle.aktuell;
        await page.goto(server.url + "?pfad=" + encodeURIComponent("10_notizen/Reise nach Lissabon.md"));
        await page.waitForSelector('[data-st="sync"]');
        await page.route("**/api/git/sync", () => new Promise(() => {})); // bleibt hängen: Zustand „läuft“
        await page.locator('[data-st="sync"]').click();
        await expect(page.locator('[data-st="sync"]')).toHaveAttribute("data-zustand", "laeuft");
        await page.locator("#status").screenshot({ path: join(BILDER, `git-status-laeuft-${schema}.png`) });
      } finally { server.stopp(); }
    });
  }
});
