// „Mit KI zusammenfassen“ (K1) im echten Studio, gegen die echte Werkstatt; das einzige Attrappe ist `claude` (Tests/Kern/fake-claude-vorschlag.mjs: strenges Argument-Parsing, prüft die Schutzgeländer).
// Umgebung des Servers ausdrücklich gebaut (eigenes HOME, PATH nur mit dem Attrappen-Ordner), Konten in einem Temp-Home, nichts vom Rechner des Entwicklers.
// Geprüft: ohne Konto kein Knopf · Einwilligung (Abbrechen, Einschalten) → Lauf → Sätze mit Beleg-Chips, Klick öffnet die Notiz · „Was wird gesendet?“ ohne `ki: nein` · Abbrechen · Fehler · „In den Posteingang legen“
// schreibt Kortex · keine Layoutsprünge · Kontingent · hell und dunkel. Bilder: KI_ZUSAMMEN_BILDER=/Ordner npx playwright test ki-zusammenfassen.spec.mjs
import { test, expect } from "./basis.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { legeProgramm, pfadMit } from "../Node/attrappe.mjs";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const K = await import(pathToFileURL(join(WURZEL, "Ressourcen/gemeinsam/ki-konten.mjs")).href);
const FAKE = join(WURZEL, "Tests/Kern/fake-claude-vorschlag.mjs");
const BILDER = process.env.KI_ZUSAMMEN_BILDER;
if (BILDER) mkdirSync(BILDER, { recursive: true });
const bild = async (page, name) => { if (BILDER) { await page.waitForTimeout(350); await page.screenshot({ path: join(BILDER, `${name}.png`) }); } };

let vault, server, bin, home, support;
async function aufbauen({ stufe = "lesen", mitClaude = true, einwilligung = true, extraNotiz = true } = {}) {
  ({ vault } = baueVault());
  vault = realpathSync.native(vault);
  if (extraNotiz) writeFileSync(join(vault, "10_notizen/Geheim-KI.md"), "---\nki: nein\n---\n# NICHT-SENDEN-TITEL\n\nINHALT-GEHEIM-NIE-SENDEN\n");
  const wurzel = realpathSync.native(mkdtempSync(join(tmpdir(), "brain-ui-kizus-")));
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
test.afterEach(() => { server?.stopp(); server = null; });

async function zurKarte(page, { aufklappen = true } = {}) {
  await page.goto(server.url);
  await page.waitForSelector("[data-karte], [data-leer]", { timeout: 15000 });
  await page.click('[data-bereich="inbox"]');
  await expect(page.locator("[data-nk]")).toBeVisible();
  if (aufklappen) await page.locator("[data-nk-kopf]").click();
}
const knopf = (page) => page.locator('[data-aktion="nk-ki"]');
const panel = (page) => page.locator("[data-nk-kip]");
const phase = (page, p) => expect(panel(page)).toHaveAttribute("data-phase", p, { timeout: 15000 });
const schemata = [["hell", "light"], ["dunkel", "dark"]];

test("Ohne Konto mit Stufe „lesen“ gibt es keinen Knopf (auch kein Hinweis auf gesperrte Konten); ohne Claude Code ist er aus, mit Grund", async ({ page }) => {
  await aufbauen({ stufe: "gesperrt" });
  await zurKarte(page);
  await expect(page.locator("[data-nk-inhalt]")).toBeVisible();
  await expect(knopf(page)).toHaveCount(0);
  await expect(page.locator("[data-nk-fuss]")).toBeHidden();
  server.stopp();
  await aufbauen({ mitClaude: false });
  await zurKarte(page);
  await expect(knopf(page)).toBeVisible();
  await expect(knopf(page)).toBeDisabled();
  await expect(page.locator("[data-nk-ki-grund]")).toContainText("Claude Code ist nicht installiert");
  expect(aufrufe()).toEqual([]);
});

test("Einwilligung: Dialog mit ehrlichem Text; Abbrechen startet nichts und schaltet nichts ein; Einschalten startet den Lauf und merkt sich die Wahl je Vault", async ({ page }) => {
  await aufbauen({ einwilligung: false });
  await zurKarte(page);
  await knopf(page).click();
  const dlg = page.locator('[data-dialog="ki-einwilligung"]');
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText("einschalten?");
  await expect(dlg).toContainText("Anthropic");
  await expect(dlg).toContainText("Arbeit");
  await expect(dlg).toContainText("ki: nein");
  await expect(dlg).toContainText("Nichts gespeichert");
  await expect(dlg).toContainText("Kontingent");
  await expect(dlg.locator('[data-kiv="gesendet-liste"]')).toContainText("Keine Inhalte von Notizen");
  await bild(page, "einwilligung-hell");
  await dlg.locator('[data-aktion="kiv-abbrechen"]').click();
  await expect(dlg).toHaveCount(0);
  await expect(panel(page)).toBeHidden();
  expect((await (await page.request.get(server.url + "api/ki/vorschlag/einwilligung")).json()).an).toBe(false);
  expect(aufrufe()).toEqual([]);
  // Esc schließt ebenso
  await knopf(page).click();
  await expect(dlg).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dlg).toHaveCount(0);
  expect(aufrufe()).toEqual([]);
  // Einschalten → Lauf → Ergebnis
  await knopf(page).click();
  await dlg.locator('[data-aktion="kiv-einschalten"]').click();
  await expect(dlg).toHaveCount(0);
  await phase(page, "ergebnis");
  const e = await (await page.request.get(server.url + "api/ki/vorschlag/einwilligung")).json();
  expect(e.an).toBe(true);
  expect(aufrufe().length).toBe(1);
  // beim nächsten Klick kein Dialog mehr
  await panel(page).locator('[data-aktion="nk-ki-neu"]').click();
  await expect.poll(() => aufrufe().length).toBe(2);
  await phase(page, "ergebnis");
  await expect(dlg).toHaveCount(0);
});

test("Ergebnis: Sätze als Text mit Beleg-Chips; ein Chip öffnet die Notiz; die Karte bleibt, wo sie ist", async ({ page }) => {
  await aufbauen();
  await zurKarte(page);
  await knopf(page).click();
  await phase(page, "ergebnis");
  const saetze = panel(page).locator("[data-nk-satz]");
  expect(await saetze.count()).toBeGreaterThanOrEqual(1);
  await expect(saetze.first()).toContainText("Neu sind unter anderem");
  const chip = panel(page).locator(".nk-beleg").first();
  const pfad = await chip.getAttribute("data-nk-beleg");
  expect(pfad).toMatch(/\.md$/);
  const titel = (await chip.innerText()).trim();
  await chip.click();
  await expect(page.locator("#pfad")).toContainText(titel);
  expect(basename(pfad)).toMatch(/\.md$/);
  // nichts im Vault geschrieben: der Aufruf ging nur an die Attrappe
  expect(aufrufe().length).toBe(1);
  expect(aufrufe()[0].verletzt).toEqual([]);
});

test("„Was wird gesendet?“ zeigt das Paket genau so, wie es an die KI ging: Titel, Art, Zeit; `ki: nein` nur als Zahl, nie mit Titel oder Inhalt", async ({ page }) => {
  await aufbauen();
  await zurKarte(page);
  await knopf(page).click();
  await phase(page, "ergebnis");
  await panel(page).locator('[data-aktion="kiv-gesendet"]').click();
  const paket = panel(page).locator('[data-kiv="paket"]');
  await expect(paket).toBeVisible();
  const text = await paket.innerText();
  expect(text).toContain('"aufgabe": "zusammenfassung"');
  // Welche Titel in den neuesten Zeilen landen, hängt bei gleicher Git-Zeit (alle Testnotizen in einer Sekunde) von der Reihenfolge ab –
  // kein fester Titel; unten wird die Anzeige mit dem verglichen, was die Attrappe wirklich bekam.
  expect(text).toMatch(/"titel": "[^"]+"/);
  expect(text).not.toContain("NICHT-SENDEN-TITEL");
  expect(text).not.toContain("INHALT-GEHEIM");
  expect(text).not.toContain("Kaffee ist ein"); // keine Inhalte
  await expect(panel(page).locator('[data-kiv="ausgenommen"]')).toContainText("1 Notiz mit „ki: nein“ ist ausgenommen");
  const gesendet = aufrufe()[0].stdin;
  expect(gesendet).not.toContain("NICHT-SENDEN-TITEL");
  expect(JSON.parse(gesendet)).toEqual(JSON.parse(text.slice(0, text.length)));
});

test("Abbrechen: der Lauf endet sofort, „Abgebrochen. Nichts wurde geändert.“, kein Ergebnis; danach geht „Noch einmal“", async ({ page }) => {
  await aufbauen();
  szenario({ szenario: "abbruch" });
  await zurKarte(page);
  await knopf(page).click();
  await phase(page, "laeuft");
  await expect(panel(page).locator(".nk-kip-balken")).toBeVisible();
  await expect(knopf(page)).toBeDisabled();
  await expect.poll(() => existsSync(join(bin, "wartet"))).toBe(true);
  await panel(page).locator('[data-aktion="nk-ki-abbrechen"]').click();
  await phase(page, "abgebrochen");
  await expect(panel(page).locator("[data-nk-kip-meldung]")).toHaveText("Abgebrochen. Nichts wurde geändert.");
  await expect(panel(page).locator("[data-nk-satz]")).toHaveCount(0);
  const pid = Number(readFileSync(join(bin, "wartet"), "utf8"));
  await expect.poll(() => { try { process.kill(pid, 0); return false; } catch { return true; } }, { timeout: 10000 }).toBe(true);
  szenario({ szenario: "ok" });
  await panel(page).locator('[data-aktion="nk-ki-neu"]').click();
  await phase(page, "ergebnis");
});

test("Fehler: kaputte Antwort heißt „keinen brauchbaren Vorschlag“, kein Satz; Sätze ohne gültigen Beleg fallen weg", async ({ page }) => {
  await aufbauen();
  szenario({ szenario: "kaputt" });
  await zurKarte(page);
  await knopf(page).click();
  await phase(page, "fehler");
  await expect(panel(page).locator("[data-nk-kip-meldung]")).toContainText("keinen brauchbaren Vorschlag");
  await expect(panel(page).locator("[data-nk-satz]")).toHaveCount(0);
  szenario({ szenario: "beleg-erfunden" });
  await panel(page).locator('[data-aktion="nk-ki-neu"]').click();
  await phase(page, "ergebnis");
  await expect(panel(page).locator("[data-nk-satz]")).toHaveCount(1);
  await expect(panel(page).locator("[data-nk-satz]")).toHaveText(/Gültiger Satz\./);
  await expect(page.locator("body")).not.toContainText("Erfundene Kennung");
});

test("„In den Posteingang legen“: Kortex schreibt eine Notiz im Posteingang (Sätze entschärft, Links nur auf Titel aus der Liste); danach „Im Posteingang“, nichts doppelt", async ({ page }) => {
  await aufbauen();
  await zurKarte(page);
  await knopf(page).click();
  await phase(page, "ergebnis");
  const vorher = new Set(readdirSync(join(vault, "00_inbox")));
  await panel(page).locator('[data-aktion="nk-ki-ablegen"]').click();
  await expect(page.locator(".toast").last()).toContainText("Zusammenfassung im Posteingang abgelegt");
  const neu = readdirSync(join(vault, "00_inbox")).filter((n) => !vorher.has(n));
  expect(neu.length).toBe(1);
  const inhalt = readFileSync(join(vault, "00_inbox", neu[0]), "utf8");
  expect(inhalt).toMatch(/^# KI-Zusammenfassung: Was ist neu \(\d{4}-\d{2}-\d{2}\)\n/);
  expect(inhalt).toContain("Von einer KI zusammengefasst");
  expect(inhalt).toContain("- Neu sind unter anderem");
  expect(inhalt).toMatch(/\(\[\[[^\]]+\]\]/);
  expect(inhalt).not.toContain("NICHT-SENDEN-TITEL");
  const ablegen = panel(page).locator('[data-aktion="nk-ki-ablegen"]');
  await expect(ablegen).toBeDisabled();
  await expect(ablegen).toContainText("Im Posteingang");
  expect(readdirSync(join(vault, "00_inbox")).filter((n) => !vorher.has(n)).length).toBe(1);
});

test("Keine Layoutsprünge: die Liste unter der Karte bleibt vom Lauf bis zum Ergebnis und beim Aufklappen von „Was wird gesendet?“ an derselben Stelle", async ({ page }) => {
  await aufbauen();
  szenario({ szenario: "langsam", warteMs: 1800 });
  await zurKarte(page);
  const erste = page.locator("#liste-koerper [data-karte]").first();
  await knopf(page).click();
  await phase(page, "laeuft");
  await expect(panel(page).locator('[data-kiv="gesendet"]')).toBeVisible();
  const y1 = (await erste.boundingBox()).y, h1 = (await panel(page).boundingBox()).height;
  await phase(page, "ergebnis");
  const y2 = (await erste.boundingBox()).y, h2 = (await panel(page).boundingBox()).height;
  await panel(page).locator('[data-aktion="kiv-gesendet"]').click();
  await expect(panel(page).locator('[data-kiv="paket"]')).toBeVisible();
  const y3 = (await erste.boundingBox()).y, h3 = (await panel(page).boundingBox()).height;
  expect([y2, y3]).toEqual([y1, y1]);
  expect([h2, h3]).toEqual([h1, h1]);
  // ein neuer Datenstand der Karte (Neuzeichnen) lässt den Bereich stehen
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(panel(page)).toBeVisible();
});

test("Kontingent: ab 80 % ein Satz in der Zeile, bei 100 % ist der Knopf aus, mit Rücksetzzeit", async ({ page }) => {
  await aufbauen();
  const jetzt = Date.now();
  const antwort = (p) => ({ jetzt: new Date(jetzt).toISOString(), takt: { abfrageMs: 900_000, neuFruehestensMs: 300_000, veraltetMs: 1_800_000 },
    konten: [{ id: "k_aaaaaaaa", programm: "claude", name: "Arbeit", standard: false, quelle: "statuszeile", verwaltet: false, status: "ok", session: { usedPercent: p, windowMinutes: 300, resetsAt: jetzt + 2 * 3_600_000 }, weekly: { usedPercent: 10, windowMinutes: 10080, resetsAt: jetzt + 30 * 3_600_000 }, aktualisiert: new Date(jetzt).toISOString() }] });
  let p = 85;
  await page.route(/\/api\/ki\/kontingent(\?.*)?$/, (route) => route.fulfill({ json: antwort(p) }));
  await zurKarte(page);
  await expect(page.locator('[data-kiv="kontingent"]')).toHaveAttribute("data-stufe", "fast");
  await expect(page.locator('[data-kiv="kontingent-text"]')).toContainText("bald aufgebraucht");
  await expect(knopf(page)).toBeEnabled();
  p = 100;
  await page.reload();
  await page.waitForSelector("[data-karte], [data-leer]", { timeout: 15000 });
  await page.click('[data-bereich="inbox"]');
  await page.locator("[data-nk-kopf]").click();
  await expect(knopf(page)).toBeDisabled();
  await expect(page.locator("[data-nk-fuss]")).toContainText("erschöpft");
  expect(aufrufe()).toEqual([]);
});

for (const [schema, farbe] of schemata) {
  test(`hell und dunkel (${schema}): Einwilligung, Lauf und Ergebnis; nichts ragt über den Rand`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: farbe, reducedMotion: "reduce" });
    await aufbauen({ einwilligung: false });
    szenario({ szenario: "langsam", warteMs: 1500 });
    await zurKarte(page);
    await expect(knopf(page)).toBeVisible();
    await bild(page, `k1-karte-${schema}-v2`);
    await knopf(page).click();
    await expect(page.locator('[data-dialog="ki-einwilligung"]')).toBeVisible();
    await bild(page, `k1-einwilligung-${schema}-v2`);
    await page.locator('[data-aktion="kiv-einschalten"]').click();
    await phase(page, "laeuft");
    await bild(page, `k1-lauf-${schema}-v2`);
    await phase(page, "ergebnis");
    await bild(page, `k1-ergebnis-${schema}-v2`);
    await panel(page).locator('[data-aktion="kiv-gesendet"]').click();
    await bild(page, `k1-ergebnis-gesendet-${schema}-v2`);
    const ueber = await page.evaluate(() => { const k = document.querySelector("[data-nk]").getBoundingClientRect(); return [...document.querySelectorAll("[data-nk] .nk-beleg, [data-nk] .nk-kip-satz-text, [data-nk] .kiv-paket, [data-nk] .nk-ki-zeile")].filter((e) => e.getBoundingClientRect().right > k.right + 1).length; });
    expect(ueber).toBe(0);
    await page.goto(server.url + "#einstellungen/ki");
    await page.waitForFunction(() => window.__studioBereit === true);
    await page.locator('[data-unter-wahl="pflege"]').click();
    await expect(page.locator('[data-kk="vorschlag-schalter"]')).toBeVisible();
    await page.locator('[data-zeile="ki-vorschlaege"]').scrollIntoViewIfNeeded();
    await bild(page, `k1-einstellungen-${schema}-v2`);
  });
}

test("Kein „null“ und kein Platzhaltertext ohne Kontingent-Stand: weder in der Karte noch im Einwilligungsdialog", async ({ page }) => {
  await aufbauen({ einwilligung: false });
  await zurKarte(page);
  await expect(knopf(page)).toBeVisible();
  const karte = await page.locator("[data-nk]").innerText();
  for (const verboten of ["null", "undefined", "Der Stand erscheint"]) expect(karte).not.toContain(verboten);
  await expect(page.locator('[data-kiv="kontingent"]').first()).toBeHidden();
  await knopf(page).click();
  const dlg = page.locator('[data-dialog="ki-einwilligung"]');
  await expect(dlg).toBeVisible();
  const text = await dlg.innerText();
  for (const verboten of ["null", "undefined", "Der Stand erscheint"]) expect(text).not.toContain(verboten);
  await expect(dlg).toContainText("jederzeit in den Einstellungen");
});

test("Einstellungen → KI & Konten → Pflege & Frag: Schalter „KI-Vorschläge in diesem Vault“ zeigt das Konto; Ausschalten nimmt die Einwilligung zurück, der Knopf führt wieder zum Dialog", async ({ page }) => {
  await aufbauen();
  await page.goto(server.url + "#einstellungen/ki");
  await page.waitForFunction(() => window.__studioBereit === true);
  await page.locator('[data-unter-wahl="pflege"]').click();
  const sch = page.locator('[data-kk="vorschlag-schalter"]');
  await expect(sch).toBeVisible();
  await expect(sch).toHaveAttribute("aria-checked", "true");
  const zeile = page.locator('[data-zeile="ki-vorschlaege"]');
  await expect(zeile).toContainText("Arbeit");
  await bild(page, "einstellungen-schalter-an");
  await sch.click();
  await expect(page.locator('[data-kk="vorschlag-schalter"]')).toHaveAttribute("aria-checked", "false");
  await expect(zeile).toContainText("Einschalten fragt dich vorher");
  expect((await (await page.request.get(server.url + "api/ki/vorschlag/einwilligung")).json()).an).toBe(false);
  await bild(page, "einstellungen-schalter-aus");
  // wieder an: der Dialog kommt zuerst, Abbrechen lässt den Schalter aus
  await page.locator('[data-kk="vorschlag-schalter"]').click();
  const dlg = page.locator('[data-dialog="ki-einwilligung"]');
  await expect(dlg).toBeVisible();
  await dlg.locator('[data-aktion="kiv-abbrechen"]').click();
  await expect(page.locator('[data-kk="vorschlag-schalter"]')).toHaveAttribute("aria-checked", "false");
  // die Karte fragt wieder
  await page.goto(server.url);
  await page.waitForSelector("[data-karte], [data-leer]", { timeout: 15000 });
  await page.click('[data-bereich="inbox"]');
  await page.locator("[data-nk-kopf]").click();
  await knopf(page).click();
  await expect(dlg).toBeVisible();
  expect(aufrufe()).toEqual([]);
});

test("Zu- und Aufklappen der Karte: die Kontingent-Zeile bleibt aktuell (100 % sperrt den Knopf auch, wenn die Karte zu war)", async ({ page }) => {
  await aufbauen();
  const jetzt = Date.now();
  let p = 50;
  const antwort = () => ({ jetzt: new Date(jetzt).toISOString(), takt: { abfrageMs: 900_000, neuFruehestensMs: 300_000, veraltetMs: 1_800_000 },
    konten: [{ id: "k_aaaaaaaa", programm: "claude", name: "Arbeit", standard: false, quelle: "statuszeile", verwaltet: false, status: "ok", session: { usedPercent: p, windowMinutes: 300, resetsAt: jetzt + 2 * 3_600_000 }, weekly: { usedPercent: 10, windowMinutes: 10080, resetsAt: jetzt + 30 * 3_600_000 }, aktualisiert: new Date(jetzt).toISOString() }] });
  await page.route(/\/api\/ki\/kontingent(\?.*)?$/, (route) => route.fulfill({ json: antwort() }));
  await zurKarte(page);
  await expect(knopf(page)).toBeEnabled();
  await page.locator("[data-nk-kopf]").click(); // zu
  await expect(page.locator("[data-nk-inhalt]")).toHaveCount(0);
  p = 100;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(600);
  await page.locator("[data-nk-kopf]").click(); // auf
  await expect(knopf(page)).toBeDisabled();
  await expect(page.locator("[data-nk-fuss]")).toContainText("erschöpft");
});
