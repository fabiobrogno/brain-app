// „Erwähnungen mit KI prüfen“ (K4) im echten Studio, gegen die echte Werkstatt; das einzige Attrappe ist `claude` (Tests/Kern/fake-claude-vorschlag.mjs: strenges Argument-Parsing, prüft die Schutzgeländer).
// Umgebung des Servers ausdrücklich gebaut (eigenes HOME, PATH nur mit dem Attrappen-Ordner), Konten in einem Temp-Home, nichts vom Rechner des Entwicklers.
// Geprüft: Knopf erst ab 3 Treffern und nur mit Konto · Einwilligung · Lauf → Badges je Treffer mit Grund · Filter „Unwahrscheinliche ausblenden“ · Verlinken bleibt der vorhandene Weg (die KI verlinkt nie) ·
// `ki: nein` geht nie hinaus · Abbrechen · Fehler · keine Layoutsprünge · hell und dunkel. Bilder: KI_ERW_BILDER=/Ordner npx playwright test ki-erwaehnungen.spec.mjs
import { test, expect } from "./basis.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { legeProgramm, pfadMit } from "../Node/attrappe.mjs";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const K = await import(pathToFileURL(join(WURZEL, "Ressourcen/gemeinsam/ki-konten.mjs")).href);
const FAKE = join(WURZEL, "Tests/Kern/fake-claude-vorschlag.mjs");
const BILDER = process.env.KI_ERW_BILDER;
if (BILDER) mkdirSync(BILDER, { recursive: true });
const bild = async (page, name) => { if (BILDER) { await page.waitForTimeout(400); await page.screenshot({ path: join(BILDER, `${name}.png`) }); } };

const ZIEL = "10_notizen/Zebraquarz.md";
const QUELLEN = ["10_notizen/Quelle Eins.md", "10_notizen/Quelle Zwei.md", "10_notizen/Quelle Drei.md"];
const satz = (i) => `Heute sprechen wir über Zebraquarz in Runde ${i} und planen die nächsten Schritte genau.`;
let vault, server, bin, home, support;

// quellen: wie viele Notizen den Titel nennen (je eine Stelle) · extra: weitere Dateien
async function aufbauen({ stufe = "lesen", mitClaude = true, einwilligung = true, quellen = 3, nein = false } = {}) {
  ({ vault } = baueVault());
  vault = realpathSync.native(vault);
  writeFileSync(join(vault, ZIEL), "# Zebraquarz\n\nDas Projekt.\n");
  QUELLEN.slice(0, quellen).forEach((q, i) => writeFileSync(join(vault, q), `# ${q.split("/").pop().replace(".md", "")}\n\n${satz(i + 1)}\n`));
  if (nein) writeFileSync(join(vault, "10_notizen/Quelle Nein.md"), `---\nki: nein\n---\n# Quelle Nein\n\nQUELLE-NEIN-GEHEIM ${satz(9)}\n`);
  const wurzel = realpathSync.native(mkdtempSync(join(tmpdir(), "brain-ui-kierw-")));
  home = join(wurzel, "home"); bin = join(wurzel, "bin"); support = join(wurzel, "support");
  for (const d of [home, bin, support]) mkdirSync(d);
  const profil = (n) => { const p = join(home, n); mkdirSync(p); writeFileSync(join(p, "settings.json"), "{}"); return realpathSync.native(p); };
  const a = profil(".claude-arbeit");
  const ein = (id, programm, ordner, name, extra = {}) => [id, { programm, ordner, standard: false, name, ordnerKennung: K.kennungVon(ordner), ...extra }];
  K.aendere(support, () => ({ version: 1, konten: Object.fromEntries([ein("k_aaaaaaaa", "claude", a, "Arbeit", { abo: "max" })]),
    vaults: { [vault]: { ordnerKennung: K.kennungVon(vault), neueKonten: "gesperrt", ohneKonto: "gesperrt", konten: { k_aaaaaaaa: stufe },
      ...(einwilligung ? { vorschlaege: { an: true, seit: "2026-11-09T10:00:00.000Z", konto: "k_aaaaaaaa" } } : {}) } } }));
  if (mitClaude) legeProgramm(join(bin, "claude"), `#!${process.execPath}\nglobalThis.FAKE_ORDNER = ${JSON.stringify(bin)};\nimport(${JSON.stringify(pathToFileURL(FAKE).href)}).catch((e) => { console.error(String(e && e.stack || e)); process.exit(70); });\n`);
  server = await starteServer(vault, { vertraut: true, support, umgebung: { PATH: pfadMit(bin), HOME: home, LANG: "de_DE.UTF-8", BRAIN_CLAUDE_EXTRA: "" } });
}
const szenario = (o) => writeFileSync(join(bin, "szenario.json"), JSON.stringify(o));
const aufrufe = () => (existsSync(join(bin, "aufrufe.jsonl")) ? readFileSync(join(bin, "aufrufe.jsonl"), "utf8").trim().split("\n").map((z) => JSON.parse(z)) : []);
const lese = (p) => readFileSync(join(vault, p), "utf8");
test.afterEach(() => { server?.stopp(); server = null; });

const ein = (page) => page.locator('#info [data-sektion="erw-ein"]');
const knopf = (page) => ein(page).locator('[data-aktion="erw-ki"]');
const status = (page) => ein(page).locator("[data-erw-ki-status]");
const phase = (page, p) => expect(status(page)).toHaveAttribute("data-phase", p, { timeout: 15000 });
const badges = (page) => ein(page).locator("[data-erw-badge]");
async function oeffne(page, pfad = ZIEL) {
  await page.goto(server.url);
  await page.waitForSelector("[data-karte], [data-leer]", { timeout: 15000 });
  await page.click('[data-bereich="alle"]');
  const k = page.locator(`#liste-koerper [data-karte][data-pfad="${pfad}"]`);
  await k.scrollIntoViewIfNeeded();
  await k.click();
  await expect(page.locator("#info")).toBeVisible();
  await expect(ein(page)).toBeVisible();
}
const schemata = [["hell", "light"], ["dunkel", "dark"]];

test("Der Knopf erscheint erst ab 3 Treffern; ohne Konto mit Stufe „lesen“ gibt es ihn nie; ohne Claude Code ist er aus, mit Grund", async ({ page }) => {
  await aufbauen({ quellen: 2 });
  await oeffne(page);
  await expect(ein(page).locator("[data-erw-summe]")).toHaveText("2 Stellen in 2 Notizen");
  await expect(knopf(page)).toBeHidden();
  // mit der dritten Stelle ist der Knopf da
  server.stopp();
  await aufbauen({ quellen: 3 });
  await oeffne(page);
  await expect(ein(page).locator("[data-erw-summe]")).toHaveText("3 Stellen in 3 Notizen");
  await expect(knopf(page)).toBeVisible();
  await expect(knopf(page)).toBeEnabled();
  expect(aufrufe()).toEqual([]);
  server.stopp();
  await aufbauen({ stufe: "gesperrt" });
  await oeffne(page);
  await expect(ein(page).locator("[data-erw-summe]")).toHaveText("3 Stellen in 3 Notizen");
  await expect(ein(page).locator("[data-erw-ki]")).toBeHidden();
  await expect(knopf(page)).toHaveCount(0);
  server.stopp();
  await aufbauen({ mitClaude: false });
  await oeffne(page);
  await expect(knopf(page)).toBeVisible();
  await expect(knopf(page)).toBeDisabled();
  await expect(ein(page).locator("[data-erw-ki-grund]")).toContainText("Claude Code ist nicht installiert");
  expect(aufrufe()).toEqual([]);
});

test("Einwilligung: Dialog mit ehrlichem Text, nennt die Erwähnungen; Abbrechen startet nichts; Einschalten startet den Lauf", async ({ page }) => {
  await aufbauen({ einwilligung: false });
  await oeffne(page);
  await knopf(page).click();
  const dlg = page.locator('[data-dialog="ki-einwilligung"]');
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText("Anthropic");
  await expect(dlg).toContainText("Erwähnungen prüfen");
  await expect(dlg).toContainText("25 Fundstellen");
  await expect(dlg).toContainText("ki: nein");
  await bild(page, "k4-einwilligung");
  await dlg.locator('[data-aktion="kiv-abbrechen"]').click();
  await expect(dlg).toHaveCount(0);
  await expect(status(page)).toBeHidden();
  expect((await (await page.request.get(server.url + "api/ki/vorschlag/einwilligung")).json()).an).toBe(false);
  expect(aufrufe()).toEqual([]);
  await knopf(page).click();
  await dlg.locator('[data-aktion="kiv-einschalten"]').click();
  await expect(dlg).toHaveCount(0);
  await phase(page, "ergebnis");
  expect((await (await page.request.get(server.url + "api/ki/vorschlag/einwilligung")).json()).an).toBe(true);
  expect(aufrufe().length).toBe(1);
});

test("Der Einwilligungsdialog aus den Einstellungen nennt die Erwähnungen ebenfalls (eine Liste für alle Einstiege)", async ({ page }) => {
  await aufbauen({ einwilligung: false });
  await page.goto(server.url + "#einstellungen/ki");
  await page.waitForFunction(() => window.__studioBereit === true);
  await page.locator('[data-unter-wahl="pflege"]').click();
  await page.locator('[data-kk="vorschlag-schalter"]').click();
  const dlg = page.locator('[data-dialog="ki-einwilligung"]');
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText("Erwähnungen prüfen");
  await expect(dlg).toContainText("Aktionen im Editor");
  await dlg.locator('[data-aktion="kiv-abbrechen"]').click();
  expect(aufrufe()).toEqual([]);
});

test("Ergebnis: Badge je Treffer (gemeint, wohl nicht, unklar) mit Grund; Zahlen; nur gesendete Notizen; `ki: nein` geht nie hinaus", async ({ page }) => {
  await aufbauen({ nein: true });
  await oeffne(page);
  await expect(ein(page).locator("[data-erw-summe]")).toHaveText("4 Stellen in 4 Notizen"); // die Notiz mit `ki: nein` steht in der Liste, geht aber nie an die KI
  await knopf(page).click();
  await phase(page, "ergebnis");
  await expect(badges(page)).toHaveCount(3);
  const alle = await badges(page).evaluateAll((l) => l.map((b) => [b.dataset.erwBadge, b.textContent, b.dataset.erwGrund]));
  expect(alle.map((x) => x[0]).sort()).toEqual(["ja", "nein", "unklar"]);
  expect(alle.find((x) => x[0] === "ja")[1]).toBe("gemeint");
  expect(alle.find((x) => x[0] === "nein")[1]).toBe("wohl nicht");
  expect(alle.find((x) => x[0] === "unklar")[1]).toBe("unklar");
  for (const x of alle) expect(x[2]).toMatch(/^Grund \d: Zebraquarz$/);
  await expect(status(page).locator("[data-erw-ki-zahlen]")).toHaveText("1 gemeint · 1 wohl nicht · 1 unklar");
  await expect(ein(page).locator('[data-erw-notiz="10_notizen/Quelle Nein.md"] [data-erw-badge]')).toHaveCount(0);
  // Grund als Tooltip
  await badges(page).first().hover();
  await expect(page.locator(".bs-tipp")).toContainText("Grund", { timeout: 4000 });
  // genau das, was als „gesendet“ gezeigt wird, ging hinaus — ohne die Notiz mit `ki: nein`
  const a = aufrufe();
  expect(a.length).toBe(1);
  expect(a[0].stdin).not.toContain("QUELLE-NEIN-GEHEIM");
  expect(JSON.parse(a[0].stdin).daten.fundstellen.length).toBe(3);
  expect(JSON.parse(a[0].stdin).daten.ziel).toEqual({ titel: "Zebraquarz" });
  expect(JSON.stringify(a[0].args)).not.toContain("Zebraquarz");
});

test("Filter „Unwahrscheinliche ausblenden“: nur die Stelle „wohl nicht“ verschwindet; aus macht sie wieder sichtbar; die KI verlinkt nie", async ({ page }) => {
  await aufbauen();
  const vorher = QUELLEN.map(lese);
  await oeffne(page);
  await knopf(page).click();
  await phase(page, "ergebnis");
  const stellen = ein(page).locator("[data-erw-stelle]");
  await expect(stellen).toHaveCount(3);
  const schalter = status(page).locator('[data-erw-ki-filter]');
  await expect(schalter).toHaveAttribute("aria-checked", "false");
  await schalter.click();
  await expect(schalter).toHaveAttribute("aria-checked", "true");
  await expect(ein(page).locator("[data-erw-stelle]:not([hidden])")).toHaveCount(2);
  await expect(ein(page).locator('[data-erw-stelle][hidden] [data-erw-badge="nein"]')).toHaveCount(1);
  await expect(ein(page).locator(".erw-notiz:not([hidden])")).toHaveCount(2);
  await expect(status(page).locator("[data-erw-ki-ausgeblendet]")).toHaveText("1 ausgeblendet");
  await bild(page, "k4-filter-hell");
  await schalter.click();
  await expect(ein(page).locator("[data-erw-stelle]:not([hidden])")).toHaveCount(3);
  expect(QUELLEN.map(lese)).toEqual(vorher); // nichts verlinkt, nichts geändert
});

test("Verlinken bleibt der vorhandene Weg: Link in der anderen Notiz, Hinweis mit Rückgängig; die übrigen Badges bleiben", async ({ page }) => {
  await aufbauen();
  await oeffne(page);
  await knopf(page).click();
  await phase(page, "ergebnis");
  await expect(badges(page)).toHaveCount(3);
  const ja = ein(page).locator('[data-erw-stelle]:has([data-erw-badge="ja"])');
  const pfad = await ja.locator("xpath=ancestor::*[@data-erw-notiz]").getAttribute("data-erw-notiz");
  const vorher = lese(pfad);
  await ja.locator('[data-aktion="erw-verlinken"]').click();
  await expect(page.locator(".toast").last()).toContainText("1 Erwähnung von „Zebraquarz“ verlinkt");
  expect(lese(pfad)).toBe(vorher.replace("über Zebraquarz", "über [[Zebraquarz]]"));
  await expect(ein(page).locator("[data-erw-summe]")).toHaveText("2 Stellen in 2 Notizen");
  await expect(badges(page)).toHaveCount(2); // die verlinkte Stelle ist weg, die Urteile der übrigen bleiben
  await expect(ein(page).locator('[data-erw-badge="ja"]')).toHaveCount(0);
  // Rückgängig über den vorhandenen Weg
  await page.locator(".toast").last().getByText("Rückgängig").click();
  await expect(ein(page).locator("[data-erw-summe]")).toHaveText("3 Stellen in 3 Notizen", { timeout: 10000 });
  expect(lese(pfad)).toBe(vorher);
  // „Alle verlinken“ ist unverändert (Vorschau-Dialog, dann ein Eintrag im Protokoll) und kommt nicht von der KI
  await ein(page).locator('[data-aktion="erw-alle"]').click();
  await expect(page.locator('[data-dialog="erwaehnungen"]')).toBeVisible();
  await page.locator('[data-dialog="erwaehnungen"] [data-aktion="abbrechen"]').click();
  expect(aufrufe().length).toBe(1);
});

test("Fehler und Abbrechen wie bei der Zusammenfassung: Meldung mit „Noch einmal“, Abbrechen ändert nichts", async ({ page }) => {
  await aufbauen();
  szenario({ szenario: "offline" });
  await oeffne(page);
  await knopf(page).click();
  await phase(page, "fehler");
  await expect(status(page).locator("[data-erw-ki-meldung]")).toContainText("Keine Verbindung zur KI");
  await expect(badges(page)).toHaveCount(0);
  szenario({ szenario: "langsam", warteMs: 20000 });
  await status(page).locator('[data-aktion="erw-ki-neu"]').click();
  await phase(page, "laeuft");
  await expect(status(page).locator('[data-kiv="gesendet"]')).toBeVisible();
  await status(page).locator('[data-aktion="erw-ki-abbrechen"]').click();
  await phase(page, "abgebrochen");
  await expect(status(page).locator("[data-erw-ki-meldung]")).toContainText("Abgebrochen. Nichts wurde geändert.");
  await expect(badges(page)).toHaveCount(0);
  szenario({ szenario: "ok" });
  await status(page).locator('[data-aktion="erw-ki-neu"]').click();
  await phase(page, "ergebnis");
  await status(page).locator('[data-aktion="erw-ki-zu"]').click();
  await expect(status(page)).toBeHidden();
  await expect(badges(page)).toHaveCount(0);
});

test("Fremde und doppelte Kennungen aus der Antwort erreichen die Oberfläche nie: nur gültige Urteile werden Badges", async ({ page }) => {
  await aufbauen();
  szenario({ szenario: "fremdes-ziel" });
  await oeffne(page);
  await knopf(page).click();
  await phase(page, "ergebnis");
  await expect(badges(page)).toHaveCount(2); // f1 (einmal) und f3; f99, Pfad und Zusatzfeld fallen weg
  await expect(status(page).locator("[data-erw-ki-zahlen]")).toHaveText("1 gemeint · 0 wohl nicht · 1 unklar");
});

test("Keine Layoutsprünge: die Stellen behalten Höhe und Ort, wenn die Badges erscheinen", async ({ page }) => {
  await aufbauen();
  szenario({ szenario: "langsam", warteMs: 1200 });
  await oeffne(page);
  await knopf(page).click();
  await phase(page, "laeuft");
  const kasten = async () => ein(page).locator("[data-erw-stelle]").evaluateAll((l) => l.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.height)]; }));
  const vorher = await kasten();
  await phase(page, "ergebnis");
  await expect(badges(page)).toHaveCount(3);
  // der Status unter dem Knopf wächst vom Lauf zum Ergebnis; die Stellen selbst behalten ihre Höhe
  const nachher = await kasten();
  expect(nachher.map((x) => x[1])).toEqual(vorher.map((x) => x[1]));
  const h1 = nachher.map((x) => x[1]);
  await ein(page).locator('[data-aktion="kiv-gesendet"]').click();
  await expect(ein(page).locator('[data-kiv="paket"]')).toBeVisible();
  expect((await kasten()).map((x) => x[1])).toEqual(h1);
  // das Neuzeichnen der Spalte (z. B. nach dem Speichern) lässt Ergebnis und Badges stehen
  await page.evaluate(() => window.studio?.ladeInfo?.({ leise: true }));
  await expect(badges(page)).toHaveCount(3);
});

for (const [schema, farbe] of schemata) {
  test(`hell und dunkel (${schema}): Knopf, Lauf, Badges, Filter; nichts ragt über den Rand`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: farbe, reducedMotion: "reduce" });
    await aufbauen({ einwilligung: false });
    szenario({ szenario: "langsam", warteMs: 1500 });
    await oeffne(page);
    await expect(knopf(page)).toBeVisible();
    await ein(page).scrollIntoViewIfNeeded();
    await bild(page, `k4-liste-knopf-${schema}`);
    await knopf(page).click();
    await expect(page.locator('[data-dialog="ki-einwilligung"]')).toBeVisible();
    await bild(page, `k4-einwilligung-${schema}`);
    await page.locator('[data-aktion="kiv-einschalten"]').click();
    await phase(page, "laeuft");
    await bild(page, `k4-lauf-${schema}`);
    await phase(page, "ergebnis");
    await expect(badges(page)).toHaveCount(3);
    await bild(page, `k4-badges-${schema}`);
    await status(page).locator('[data-erw-ki-filter]').click();
    await expect(ein(page).locator("[data-erw-stelle]:not([hidden])")).toHaveCount(2);
    await bild(page, `k4-filter-${schema}`);
    const ueber = await page.evaluate(() => { const s = document.querySelector('#info [data-sektion="erw-ein"]').getBoundingClientRect(); return [...document.querySelectorAll('#info [data-sektion="erw-ein"] .erw-badge, #info [data-sektion="erw-ein"] .erw-ki-status, #info [data-sektion="erw-ein"] .erw-ki-zeile, #info [data-sektion="erw-ein"] .erw-stelle')].filter((e) => !e.closest("[hidden]") && (e.getBoundingClientRect().right > s.right + 1 || e.getBoundingClientRect().left < s.left - 1)).length; });
    expect(ueber).toBe(0);
  });
}
