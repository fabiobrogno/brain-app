// Glocke und Mitteilungsliste (Paket P8b): der Knopf in der Kopfzeile mit Zähler (live, höchstens „9+“), das Panel mit Gruppen Heute / Gestern / Früher, Filter, Aktionen
// (Ansehen, Rückgängig mit Rückfrage, Wiederherstellen), „Alle als gelesen“, leerer Zustand, Abweisung als Warnung, Hinweis „Leseverbot einschalten“, Tastatur (⌘⇧B, ↑ ↓, Enter, Esc),
// hell und dunkel, enges Fenster (1100), „Bewegung reduzieren“. Läuft gegen die echte Werkstatt mit Wegwerf-Vault und Wegwerf-Support-Ordner; das Protokoll wird mit demselben Schreiber
// angelegt, den auch MCP-Server und Hooks benutzen (gemeinsam/aktivitaet.mjs); die Werkstatt meldet neue Einträge über den Live-Strom (alle ~1 s).
// UI_SHOTS=<Ordner>: legt die Bildschirmfotos dort ab (sonst screenshots/, ignoriert).
import { test, expect } from "./basis.mjs";
import { join, dirname } from "node:path";
import { mkdirSync, writeFileSync, existsSync, realpathSync, symlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";

const WURZEL = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const protokoll = await import(pathToFileURL(join(WURZEL, "Ressourcen/gemeinsam/aktivitaet.mjs")).href);

let vault, server;
test.beforeEach(async () => { ({ vault } = baueVault()); vault = realpathSync(vault); server = await starteServer(vault); });
test.afterEach(() => { server?.stopp(); server = null; });

const shot = (name) => join(process.env.UI_SHOTS || "screenshots", `glocke-${name}.png`);
const foto = async (page, name) => { await page.waitForTimeout(450); await page.screenshot({ path: shot(name) }); };
const sha = (text) => createHash("sha256").update(text).digest("hex");
const glocke = (page) => page.locator("#knopf-glocke");
const zahl = (page) => page.locator("#knopf-glocke .glocke-zahl");
const panel = (page) => page.locator(".glocke");
const eintraege = (page) => page.locator(".glocke .gl-eintrag");
const hinweise = (page) => page.locator("#toast-host .toast");
const vorMin = (n) => new Date(Date.now() - n * 60_000).toISOString();
const tagMittag = (zurueck) => { const d = new Date(); d.setDate(d.getDate() - zurueck); d.setHours(12, 0, 0, 0); return d.toISOString(); };

// ---- Wegwerf-Daten
function aufgabeDatei(name) {
  const pfad = `05_aufgaben/${name}.md`;
  const inhalt = ["---", "typ: aufgabe", `titel: ${JSON.stringify(name)}`, "status: offen", "prioritaet: normal", "rang: 1000", "erstellt: 2026-10-30T08:00:00Z", "geaendert: 2026-10-30T08:00:00Z", "quelle: ki:claude-code", "---", ""].join("\n");
  mkdirSync(join(vault, "05_aufgaben"), { recursive: true });
  writeFileSync(join(vault, pfad), inhalt);
  return { pfad, hash: sha(inhalt) };
}
const melde = (art, extra = {}) => protokoll.schreibeEreignis(server.support, vault, { art, vaultName: "Kortex", konto: null, programm: "claude", wer: "Claude Code", ...extra });
const meldeAblage = (a, extra = {}) => melde("ablage-aufgabe", { text: "hat eine Aufgabe angelegt.", pfade: [a.pfad], rueckgaengig: { art: "ablage-entfernen", pfad: a.pfad, hash: a.hash }, ...extra });
const meldeAbweisung = (extra = {}) => melde("abweisung", { wer: "Codex", programm: "codex", grund: "gesperrt", text: "wollte den Vault „Firma“ lesen und wurde abgewiesen. Stufe „Gesperrt“ hat gewirkt.", vaultName: "Firma", ...extra });
const meldeOhneVerbot = (extra = {}) => melde("abweisung", { wer: "Claude Code · Privat", programm: "claude", grund: "gelesen-ohne-leseverbot", text: "hat im gesperrten Vault „Firma“ gelesen. Schalte das Leseverbot ein (Einstellungen → KI & Konten), um das zu verhindern.", vaultName: "Firma", ...extra });
const meldeSicherung = (extra = {}) => melde("sicherung-fehler", { wer: undefined, programm: null, grund: "netz", text: "Die Online-Sicherung hat nicht geklappt: Es gab kein Netz. Kortex versucht es später noch einmal.", ...extra });
const meldeNotiz = (extra = {}) => melde("ablage-notiz", { wer: "Cursor", programm: "cursor", text: "hat eine Notiz im Posteingang abgelegt.", pfade: ["00_inbox/x.md"], ...extra });

// Eine gemischte Liste, wie sie nach ein paar Tagen aussieht (vor dem Öffnen des Studios geschrieben: es gibt dann keine Hinweise unten rechts)
function fuelle() {
  const a = aufgabeDatei("liste-eins");
  meldeAbweisung({ zeit: vorMin(60) });
  meldeAblage(a, { zeit: vorMin(4) });
  meldeOhneVerbot({ zeit: vorMin(25) });
  meldeNotiz({ zeit: tagMittag(1) });
  meldeSicherung({ zeit: tagMittag(1) });
  melde("pflege", { wer: undefined, programm: null, text: "Pflege fertig: 3 Notizen zusammengeführt.", zeit: tagMittag(6) });
  return { a };
}

async function oeffneStudio(page, { dunkel = false, breite = 1440, hoehe = 900, reduziert = false } = {}) {
  await page.setViewportSize({ width: breite, height: hoehe });
  if (dunkel) await page.emulateMedia({ colorScheme: "dark" });
  if (reduziert) await page.emulateMedia({ reducedMotion: "reduce", ...(dunkel ? { colorScheme: "dark" } : {}) });
  await page.goto(server.url);
  await page.waitForSelector("[data-karte], [data-leer]", { timeout: 10000 });
  await page.waitForFunction(() => window.__studioBereit === true);
  await page.waitForSelector('html[data-live="an"]', { timeout: 10000 });
  await page.waitForTimeout(300);
}
const oeffnePanel = async (page) => { await glocke(page).click(); await expect(panel(page)).toBeVisible(); await page.waitForTimeout(260); };

// =====================================================================================================================================
test("Knopf: Glocke vor „Frag“, ohne ungelesene Meldungen keine Zahl; Name, Tooltip und Kürzel stehen dran", async ({ page }) => {
  await oeffneStudio(page);
  await expect(glocke(page)).toBeVisible();
  await expect(glocke(page)).toHaveAttribute("aria-label", "Mitteilungen");
  await expect(glocke(page)).toHaveAttribute("title", "Mitteilungen (⇧⌘B)");
  await expect(glocke(page)).toHaveAttribute("aria-haspopup", "dialog");
  await expect(zahl(page)).toBeHidden();
  const g = await glocke(page).boundingBox(), f = await page.locator("#knopf-frage").boundingBox();
  expect(g.x + g.width).toBeLessThanOrEqual(f.x); // links von „Frag“
  expect(Math.abs(g.y - f.y)).toBeLessThan(6);    // in einer Zeile
  expect(g.width).toBe(28);
});

test("Zähler: kommt beim Start aus dem Protokoll, wächst live mit neuen Meldungen, zeigt höchstens „9+“", async ({ page }) => {
  fuelle(); // 6 ungelesen
  await oeffneStudio(page);
  await expect(zahl(page)).toHaveText("6", { timeout: 8000 });
  await expect(glocke(page)).toHaveAttribute("aria-label", "Mitteilungen, 6 ungelesen");
  meldeAbweisung(); meldeSicherung();
  await expect(zahl(page)).toHaveText("8", { timeout: 8000 });
  for (let i = 0; i < 3; i++) meldeNotiz({ zeit: new Date(Date.now() - i * 1000).toISOString() });
  await expect(zahl(page)).toHaveText("9+", { timeout: 8000 });
  await expect(glocke(page)).toHaveAttribute("aria-label", "Mitteilungen, 11 ungelesen");
  const kasten = await zahl(page).boundingBox(), knopf = await glocke(page).boundingBox();
  expect(kasten.x + kasten.width).toBeLessThanOrEqual(knopf.x + knopf.width + 12); // die Zahl („9+“ ist breiter) sitzt an der Ecke des Knopfes (ragt knapp hinaus), nicht daneben
  expect(kasten.x).toBeGreaterThan(knopf.x);
  expect(kasten.height).toBeGreaterThanOrEqual(14);
});

for (const [schema, dunkel] of [["hell", false], ["dunkel", true]]) {
  test(`Panel (${schema}): Gruppen Heute / Gestern / Früher, Logo, Satz, Zeit, Marken; Abweisung als Warnung; Zahl der Einträge stimmt`, async ({ page }) => {
    fuelle();
    await oeffneStudio(page, { dunkel });
    await expect(zahl(page)).toHaveText("6", { timeout: 8000 });
    await oeffnePanel(page);
    await expect(panel(page)).toHaveAttribute("role", "dialog");
    await expect(panel(page).locator(".gl-kopf b")).toHaveText("Mitteilungen");
    await expect(panel(page).locator(".gl-gruppe")).toHaveText(["Heute", "Gestern", "Früher"]);
    await expect(eintraege(page)).toHaveCount(6);
    // neueste zuerst: Heute = Claude (vor 4 Min), Claude ohne Verbot (vor 25 Min), Codex (vor 60 Min)
    const erste = eintraege(page).nth(0);
    await expect(erste.locator(".gl-satz")).toHaveText("Claude Code hat eine Aufgabe angelegt.");
    await expect(erste.locator(".gl-satz b")).toHaveText("Claude Code");
    await expect(erste.locator("time")).toHaveText("vor 4 Min");
    await expect(erste.locator(".gl-meta")).toContainText("Vault " + vault.split("/").pop());
    await expect(erste.locator("[data-ki-logo='claude']")).toBeVisible();
    await expect(erste.locator(".gl-punkt")).toHaveAttribute("aria-label", "ungelesen");
    // Abweisung: Warnung (rot), mit Satz, „abgewiesen“ und dem Hinweis zur Stufe
    const abw = panel(page).locator('.gl-eintrag[data-grund="gesperrt"]');
    await expect(abw).toHaveClass(/abweisung/);
    await expect(abw.locator(".gl-satz")).toHaveText("Codex wollte den Vault „Firma“ lesen und wurde abgewiesen.");
    await expect(abw.locator(".gl-marke")).toHaveText("abgewiesen");
    await expect(abw.locator(".gl-rest")).toHaveText("Stufe „Gesperrt“ hat gewirkt.");
    await expect(abw.getByRole("button", { name: /Rechte ansehen/ })).toBeVisible();
    await expect(abw.getByRole("button", { name: /Rückgängig/ })).toHaveCount(0);
    const farben = await abw.evaluate((e) => ({ marke: getComputedStyle(e.querySelector(".gl-marke")).color, grund: getComputedStyle(e).backgroundColor, ring: getComputedStyle(e.querySelector(".gl-logo")).boxShadow }));
    expect(farben.marke).not.toBe(await erste.locator(".gl-meta").evaluate((m) => getComputedStyle(m).color));
    expect(farben.ring).not.toBe("none");
    // Gestern und Früher: Uhrzeit bzw. Datum
    await expect(panel(page).locator('.gl-eintrag[data-art="ablage-notiz"] time')).toHaveText(/^Gestern \d{2}:\d{2}$/);
    await expect(panel(page).locator('.gl-eintrag[data-art="pflege"] time')).toHaveText(/\d/);
    await expect(panel(page).locator(".gl-leer")).toHaveCount(0);
    await foto(page, `panel-${schema}`);
    const text = await panel(page).innerText();
    expect(text).not.toMatch(/\b(null|undefined|NaN)\b/);
  });
}

test("Abweisung ohne Leseverbot: ehrlicher Hinweis mit „Leseverbot einschalten“ → Einstellungen › KI & Konten › Schutz; nie „wurde abgewiesen“", async ({ page }) => {
  meldeOhneVerbot({ zeit: vorMin(3) });
  await oeffneStudio(page);
  await oeffnePanel(page);
  const e = panel(page).locator('.gl-eintrag[data-grund="gelesen-ohne-leseverbot"]');
  await expect(e).toHaveClass(/leseverbot/);
  await expect(e.locator(".gl-satz")).toHaveText("Claude Code · Privat hat im gesperrten Vault „Firma“ gelesen.");
  await expect(e.locator(".gl-marke")).toHaveText("gelesen");
  await expect(e).not.toContainText("abgewiesen");
  const hinweis = e.locator('[data-kx="leseverbot-hinweis"]');
  await expect(hinweis).toContainText("Kortex konnte das nicht verhindern");
  await foto(page, "leseverbot");
  await hinweis.getByRole("button", { name: "Leseverbot einschalten" }).click();
  await expect(page.locator("[data-einstellungen]")).toBeVisible();
  expect(await page.evaluate(() => location.hash)).toBe("#einstellungen/ki?ziel=ki-schutz");
  await expect(page.locator(".glocke")).toHaveCount(0); // das Panel ist zu
  await expect(zahl(page)).toBeHidden({ timeout: 8000 }); // und die Meldung gilt als gelesen
});

test("Filter: Alle / Abweisungen / KI-Ablagen / Sicherung zeigen nur ihre Arten; leerer Filter sagt es", async ({ page }) => {
  fuelle();
  await oeffneStudio(page);
  await oeffnePanel(page);
  const chip = (n) => panel(page).locator(`.gl-chip[data-filter="${n}"]`);
  await expect(panel(page).locator(".gl-chip")).toHaveText(["Alle", "Abweisungen", "KI-Ablagen", "Sicherung"]);
  await expect(chip("alle")).toHaveAttribute("aria-pressed", "true");
  await chip("abweisungen").click();
  await expect(chip("abweisungen")).toHaveAttribute("aria-pressed", "true");
  await expect(eintraege(page)).toHaveCount(2); // Abweisung und „gelesen ohne Leseverbot“ sind beides Abweisungs-Ereignisse
  for (const art of await eintraege(page).evaluateAll((l) => l.map((x) => x.dataset.art))) expect(art).toBe("abweisung");
  await chip("ablagen").click();
  await expect(eintraege(page)).toHaveCount(2); // Aufgabe und Notiz
  for (const art of await eintraege(page).evaluateAll((l) => l.map((x) => x.dataset.art))) expect(art).toMatch(/^ablage-/);
  await chip("sicherung").click();
  await expect(eintraege(page)).toHaveCount(1);
  await expect(eintraege(page).first()).toHaveAttribute("data-art", "sicherung-fehler");
  await chip("alle").click();
  await expect(eintraege(page)).toHaveCount(6);
});

test("Filter: nichts in der Auswahl → eigener leerer Zustand", async ({ page }) => {
  meldeAbweisung({ zeit: vorMin(10) });
  await oeffneStudio(page);
  await oeffnePanel(page);
  await panel(page).locator('.gl-chip[data-filter="sicherung"]').click();
  await expect(panel(page).locator('[data-kx="glocke-leer"]')).toContainText("Keine Meldungen zur Sicherung");
  await expect(eintraege(page)).toHaveCount(0);
});

test("Leerer Zustand: ohne Meldungen ein ruhiger Satz, „Alle als gelesen“ ist aus, der Link zum Aktivitätsprotokoll führt in die Einstellungen", async ({ page }) => {
  await oeffneStudio(page);
  await oeffnePanel(page);
  await expect(panel(page).locator('[data-kx="glocke-leer"]')).toContainText("Noch nichts gemeldet");
  await expect(panel(page).locator('[data-kx="glocke-leer"]')).toContainText("Kortex meldet hier, was deine KIs in deinem Vault tun.");
  await expect(panel(page).getByRole("button", { name: "Alle als gelesen" })).toBeDisabled();
  await foto(page, "leer");
  await panel(page).getByRole("button", { name: "Aktivitätsprotokoll" }).click();
  await expect(page.locator("[data-einstellungen]")).toBeVisible();
  expect(await page.evaluate(() => location.hash)).toBe("#einstellungen/ki?ziel=ki-aktivitaet");
  await expect(page.locator('[data-zeile="ki-aktivitaet"]')).toBeVisible();
});

test("Zahnrad im Panel führt zu Einstellungen › Mitteilungen", async ({ page }) => {
  await oeffneStudio(page);
  await oeffnePanel(page);
  await panel(page).getByRole("button", { name: "Einstellungen für Mitteilungen" }).click();
  await expect(page.locator("[data-einstellungen]")).toBeVisible();
  expect(await page.evaluate(() => location.hash)).toMatch(/^#einstellungen\/mitteilungen/);
});

test("Alle als gelesen: Zähler weg, Punkte weg, Knopf aus; ein neues Ereignis zählt wieder", async ({ page }) => {
  fuelle();
  await oeffneStudio(page);
  await expect(zahl(page)).toHaveText("6", { timeout: 8000 });
  await oeffnePanel(page);
  await expect(panel(page).locator(".gl-punkt")).toHaveCount(6);
  await panel(page).getByRole("button", { name: "Alle als gelesen" }).click();
  await expect(zahl(page)).toBeHidden();
  await expect(panel(page).locator(".gl-punkt")).toHaveCount(0);
  await expect(panel(page).getByRole("button", { name: "Alle als gelesen" })).toBeDisabled();
  await expect(eintraege(page)).toHaveCount(6); // gelesen heißt nicht weg
  // die Werkstatt hat es gemerkt: nach einem Neuladen bleibt es gelesen
  await page.reload();
  await page.waitForFunction(() => window.__studioBereit === true);
  await page.waitForSelector('html[data-live="an"]');
  await page.waitForTimeout(600);
  await expect(zahl(page)).toBeHidden();
  meldeSicherung();
  await expect(zahl(page)).toHaveText("1", { timeout: 8000 });
});

test("Live im offenen Panel: ein neues Ereignis erscheint oben unter „Heute“, der Fokus bleibt", async ({ page }) => {
  meldeNotiz({ zeit: vorMin(30) });
  await oeffneStudio(page);
  await oeffnePanel(page);
  await expect(eintraege(page)).toHaveCount(1);
  await eintraege(page).first().focus();
  meldeAbweisung();
  await expect(eintraege(page)).toHaveCount(2, { timeout: 8000 });
  await expect(eintraege(page).first()).toHaveAttribute("data-art", "abweisung");
  await expect(zahl(page)).toHaveText("2");
  const aktiv = await page.evaluate(() => document.activeElement?.closest?.(".gl-eintrag")?.dataset.art);
  expect(aktiv).toBe("ablage-notiz"); // der Eintrag, auf dem der Fokus stand, behält ihn
});

// ---- Aktionen
// Die offene Notiz steht im Editor und im Pfad darüber; das Board ist dann zugunsten des Editors ausgeblendet
const notizOffen = async (page, name) => { await expect(page.locator("#editor")).toBeVisible(); await expect(page.locator("#pfad")).toContainText(name); };

test("Ansehen: Aufgabe → die Aufgabe selbst, Notiz ohne Datei → Posteingang; das Panel schließt, die Meldung gilt als gelesen", async ({ page }) => {
  const a = aufgabeDatei("ansehen-eins");
  meldeAblage(a, { zeit: vorMin(2) });
  meldeNotiz({ zeit: vorMin(9) }); // 00_inbox/x.md gibt es nicht → wie bisher der Posteingang
  await oeffneStudio(page);
  await expect(zahl(page)).toHaveText("2", { timeout: 8000 });
  await oeffnePanel(page);
  await eintraege(page).filter({ has: page.locator('[data-ki-logo="claude"]') }).getByRole("button", { name: /^Ansehen/ }).click();
  await notizOffen(page, "ansehen-eins");
  await expect(page.locator("[data-spalte='offen']")).toBeHidden(); // der Editor der Aufgabe steht im Board-Modus („Zurück zum Board“)
  await expect(panel(page)).toHaveCount(0);
  await expect(zahl(page)).toHaveText("1", { timeout: 8000 });
  await oeffnePanel(page);
  await eintraege(page).filter({ has: page.locator('[data-ki-logo="cursor"]') }).getByRole("button", { name: /^Ansehen/ }).click();
  await expect(page.locator('[data-bereich="inbox"][aria-current="true"], [data-bereich="inbox"].aktiv, [data-bereich="inbox"][aria-selected="true"]').first()).toBeVisible();
  await expect(page.locator("[data-spalte='offen']")).toBeHidden();
});

// „Ansehen“ öffnet die abgelegte Notiz selbst, wenn pfade[0] da ist und im Vault liegt (dieselben Pfadregeln wie beim Rückgängig); sonst wie bisher Board bzw. Posteingang
function notizDatei(name) {
  const pfad = `00_inbox/${name}.md`;
  mkdirSync(join(vault, "00_inbox"), { recursive: true });
  writeFileSync(join(vault, pfad), `---\ntitel: ${name}\n---\nText von ${name}\n`);
  return pfad;
}
const ansehen = async (page) => { await oeffnePanel(page); await eintraege(page).first().getByRole("button", { name: /^Ansehen/ }).click(); await expect(panel(page)).toHaveCount(0); };
const boardZeigt = async (page) => { await expect(page.locator("[data-spalte='offen']")).toBeVisible(); await expect(page.locator("#editor")).toBeHidden(); };

test("Ansehen (Glocke): eine Notiz im Posteingang, die es gibt, wird selbst geöffnet; in der Liste steht der Posteingang", async ({ page }) => {
  const pfad = notizDatei("direkt-notiz");
  meldeNotiz({ zeit: vorMin(2), pfade: [pfad] });
  await oeffneStudio(page);
  await expect(zahl(page)).toHaveText("1", { timeout: 8000 });
  await ansehen(page);
  await notizOffen(page, "direkt-notiz");
  await expect(page.locator(".cm-content")).toContainText("Text von direkt-notiz");
  await expect(page.locator('[data-bereich="inbox"][aria-current="true"], [data-bereich="inbox"].aktiv, [data-bereich="inbox"][aria-selected="true"]').first()).toBeVisible();
});

test("Ansehen (Glocke): fehlt die Datei, gibt es sie nur außerhalb des Vaults oder zeigt der Pfad hinaus (.., Verknüpfung, falscher Ordner), bleibt es beim Board", async ({ page }) => {
  const aussen = join(dirname(vault), "aussen-geheim.md");
  writeFileSync(aussen, "---\ntitel: aussen\n---\nnicht im Vault\n");
  aufgabeDatei("board-fuellung"); // damit das Board Spalten zeigt
  symlinkSync(aussen, join(vault, "05_aufgaben", "verknuepft.md"));
  mkdirSync(join(vault, "02_tiefer"), { recursive: true });
  writeFileSync(join(vault, "02_tiefer", "falsch.md"), "---\ntyp: aufgabe\n---\n");
  const faelle = [
    "05_aufgaben/gibt-es-nicht.md",
    "05_aufgaben/../../aussen-geheim.md",
    "../aussen-geheim.md",
    "05_aufgaben/verknuepft.md",
    "02_tiefer/falsch.md",
    "05_aufgaben/keine-md.txt",
  ];
  faelle.forEach((pfad, i) => melde("ablage-aufgabe", { text: `hat Fall ${i} angelegt.`, pfade: [pfad], zeit: vorMin(i + 1) }));
  await oeffneStudio(page);
  const gelesen = [];
  page.on("response", (r) => { if (r.url().includes("/api/datei") && r.status() === 200 && /aussen-geheim/.test(decodeURIComponent(r.url()))) gelesen.push(r.url()); });
  for (const [i, pfad] of faelle.entries()) {
    await oeffnePanel(page);
    await eintraege(page).filter({ hasText: `Fall ${i} ` }).getByRole("button", { name: /^Ansehen/ }).click();
    await expect(panel(page)).toHaveCount(0);
    await boardZeigt(page);
    expect(gelesen, pfad).toEqual([]);
  }
});

test("Rückgängig: erst die Rückfrage mit dem genauen Pfad; „Abbrechen“ lässt alles; „Entfernen“ nimmt zurück; danach „Wiederherstellen“", async ({ page }) => {
  const a = aufgabeDatei("zurueck-eins");
  meldeAblage(a, { zeit: vorMin(2) });
  await oeffneStudio(page);
  await oeffnePanel(page);
  const e = eintraege(page).first();
  await expect(e.getByRole("button", { name: /Wiederherstellen/ })).toHaveCount(0);
  await e.getByRole("button", { name: /Rückgängig/ }).click();
  const dlg = page.locator('[data-dialog="aktivitaet-zurueck"]');
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText("Kortex entfernt diese Datei aus deinem Vault");
  await expect(dlg.locator("code")).toHaveText(a.pfad);
  await expect(dlg).toContainText("Kopie in den Papierkorb (30 Tage)");
  await foto(page, "rueckfrage");
  await dlg.getByRole("button", { name: "Abbrechen" }).click();
  await expect(dlg).toHaveCount(0);
  expect(existsSync(join(vault, a.pfad))).toBe(true);
  await oeffnePanel(page);
  await eintraege(page).first().getByRole("button", { name: /Rückgängig/ }).click();
  await dlg.getByRole("button", { name: "Entfernen" }).click();
  await expect(hinweise(page).filter({ hasText: /^Zurückgenommen$/ })).toBeVisible({ timeout: 8000 });
  expect(existsSync(join(vault, a.pfad))).toBe(false);
  await oeffnePanel(page);
  const wieder = eintraege(page).first();
  await expect(wieder.locator(".gl-meta")).toContainText("zurückgenommen");
  await expect(wieder.getByRole("button", { name: /Rückgängig/ })).toHaveCount(0);
  await wieder.getByRole("button", { name: /Wiederherstellen/ }).click();
  await expect(hinweise(page).filter({ hasText: /^Wiederhergestellt\.$/ })).toBeVisible({ timeout: 8000 });
  expect(existsSync(join(vault, a.pfad))).toBe(true);
  await expect(eintraege(page).first().getByRole("button", { name: /Rückgängig/ })).toBeVisible({ timeout: 8000 });
  await expect(eintraege(page).first().getByRole("button", { name: /Wiederherstellen/ })).toHaveCount(0);
});

test("Rückgängig: war die Notiz inzwischen geändert, löscht Kortex nichts und sagt es", async ({ page }) => {
  const a = aufgabeDatei("geaendert-eins");
  meldeAblage(a, { zeit: vorMin(2) });
  await oeffneStudio(page);
  writeFileSync(join(vault, a.pfad), "---\ntyp: aufgabe\ntitel: \"geaendert-eins\"\nstatus: offen\n---\nMeine eigene Ergänzung.\n");
  await page.waitForTimeout(300);
  await oeffnePanel(page);
  await eintraege(page).first().getByRole("button", { name: /Rückgängig/ }).click();
  await page.locator('[data-dialog="aktivitaet-zurueck"]').getByRole("button", { name: "Entfernen" }).click();
  await expect(hinweise(page).filter({ hasText: "seit der Ablage geändert" })).toBeVisible({ timeout: 8000 });
  expect(existsSync(join(vault, a.pfad))).toBe(true);
});

// ---- Tastatur
test("Tastatur: ⌘⇧B öffnet (Fokus auf dem ersten Eintrag), ↑ ↓ wandern, Enter führt die Hauptaktion aus, Esc schließt und gibt den Fokus zurück", async ({ page }) => {
  const a = aufgabeDatei("tasten-eins");
  meldeAblage(a, { zeit: vorMin(2) });
  meldeNotiz({ zeit: vorMin(9) });
  meldeSicherung({ zeit: vorMin(20) });
  await oeffneStudio(page);
  await expect(zahl(page)).toHaveText("3", { timeout: 8000 });
  await page.locator("body").click({ position: { x: 700, y: 400 } });
  await page.keyboard.press("Meta+Shift+B");
  await expect(panel(page)).toBeVisible();
  await expect(eintraege(page).nth(0)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(eintraege(page).nth(1)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(eintraege(page).nth(2)).toBeFocused();
  await page.keyboard.press("ArrowDown"); // am Ende bleibt es stehen
  await expect(eintraege(page).nth(2)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(eintraege(page).nth(1)).toBeFocused();
  await foto(page, "tastatur-fokus");
  await page.keyboard.press("Home");
  await expect(eintraege(page).nth(0)).toBeFocused();
  // Esc: zu, Fokus zurück auf die Glocke
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await expect(glocke(page)).toBeFocused();
  // dasselbe Kürzel schaltet um
  await page.keyboard.press("Meta+Shift+B");
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press("Meta+Shift+B");
  await expect(panel(page)).toHaveCount(0);
  // Enter auf einem Eintrag = Hauptaktion (Ansehen → die Aufgabe selbst, im Board-Modus)
  await page.keyboard.press("Meta+Shift+B");
  await expect(eintraege(page).nth(0)).toBeFocused();
  await page.keyboard.press("Enter");
  await notizOffen(page, "tasten-eins");
  await expect(panel(page)).toHaveCount(0);
});

test("Tastatur: Tab wandert durch Filter und Knöpfe und bleibt im Panel (dreht am Ende um); Klick daneben schließt", async ({ page }) => {
  meldeAbweisung({ zeit: vorMin(5) });
  await oeffneStudio(page);
  await oeffnePanel(page);
  await expect(eintraege(page).first()).toBeFocused();
  const orte = new Set();
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press("Tab");
    await expect(panel(page)).toBeVisible();
    expect(await page.evaluate(() => !!document.activeElement?.closest(".glocke"))).toBe(true);
    orte.add(await page.evaluate(() => document.activeElement?.textContent?.trim() || document.activeElement?.getAttribute("aria-label")));
  }
  expect(orte.size).toBeGreaterThan(5); // alle Alle-gelesen, Zahnrad, vier Filter, Aktion, Protokoll
  await page.keyboard.press("Shift+Tab");
  expect(await page.evaluate(() => !!document.activeElement?.closest(".glocke"))).toBe(true);
  await page.mouse.click(300, 500);
  await expect(panel(page)).toHaveCount(0);
});

test("Kürzel steht in der Befehlspalette und in den Tastenkürzeln (Register), nicht doppelt mit ⇧⌘M (Schnell merken)", async ({ page }) => {
  await oeffneStudio(page);
  const reg = await page.evaluate(async () => { const m = await import("./tastenkuerzel.js"); return { glocke: m.kuerzelVon("mitteilungen"), merken: m.kuerzelVon("schnell-merken"), konflikte: [...m.konfliktIds()] }; });
  expect(reg.glocke).toBe("Shift+Cmd+B");
  expect(reg.merken).toBe("Shift+Cmd+M");
  expect(reg.konflikte).toEqual([]);
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("Mitteil");
  const treffer = page.locator(".pal-eintrag", { hasText: "Mitteilungen" });
  await expect(treffer).toHaveCount(1);
  await expect(treffer.locator("kbd")).toHaveText(["⇧", "⌘", "B"]);
  await page.keyboard.press("Enter");
  await expect(panel(page)).toBeVisible();
});

// ---- Aussehen
test("Enges Fenster (1100): Glocke und Zähler sichtbar, nichts ragt aus dem Fenster, das Panel liegt ganz im Fenster", async ({ page }) => {
  fuelle();
  await oeffneStudio(page, { breite: 1100, hoehe: 760 });
  await expect(zahl(page)).toHaveText("6", { timeout: 8000 });
  const knopf = await glocke(page).boundingBox();
  expect(knopf.x).toBeGreaterThan(0);
  expect(knopf.x + knopf.width).toBeLessThanOrEqual(1100);
  await oeffnePanel(page);
  const p = await panel(page).boundingBox();
  expect(p.x).toBeGreaterThanOrEqual(0);
  expect(p.x + p.width).toBeLessThanOrEqual(1100);
  expect(p.y + p.height).toBeLessThanOrEqual(760);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const liste = await panel(page).locator(".gl-liste").evaluate((l) => ({ scrollt: l.scrollHeight > l.clientHeight, ueber: l.scrollWidth > l.clientWidth }));
  expect(liste.ueber).toBe(false);
  await foto(page, "eng-1100");
});

test("Sehr schmal (800): das Panel passt sich an, nichts läuft waagerecht über", async ({ page }) => {
  fuelle();
  await oeffneStudio(page, { breite: 800, hoehe: 700 });
  await oeffnePanel(page);
  const p = await panel(page).boundingBox();
  expect(p.x).toBeGreaterThanOrEqual(0);
  expect(p.x + p.width).toBeLessThanOrEqual(800);
  const ueber = await panel(page).locator(".gl-liste").evaluate((l) => l.scrollWidth > l.clientWidth);
  expect(ueber).toBe(false);
});

test("Dunkel + Abweisungen: Hinweis, Warnung und Aktionen lesbar (Foto)", async ({ page }) => {
  fuelle();
  await oeffneStudio(page, { dunkel: true });
  await oeffnePanel(page);
  await foto(page, "voll-dunkel");
  await panel(page).locator('.gl-chip[data-filter="abweisungen"]').click();
  await foto(page, "abweisungen-dunkel");
});

test("Bewegung reduziert: die Zahl hüpft nicht, das Panel erscheint ohne Übergang", async ({ page }) => {
  await oeffneStudio(page, { reduziert: true });
  meldeSicherung();
  await expect(zahl(page)).toHaveText("1", { timeout: 8000 });
  expect(await zahl(page).evaluate((z) => getComputedStyle(z).animationName)).toBe("none");
  await glocke(page).click();
  await expect(panel(page)).toBeVisible();
  expect(await panel(page).evaluate((p) => getComputedStyle(p).transitionDuration.split(",").every((d) => parseFloat(d) === 0))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await expect(page.locator(".bs-geist")).toHaveCount(0); // kein ausblendender Geist
});

test("Ohne Bewegungswunsch hüpft die Zahl, wenn sie wächst", async ({ page }) => {
  await oeffneStudio(page);
  meldeSicherung();
  await expect(zahl(page)).toHaveText("1", { timeout: 8000 });
  expect(await zahl(page).evaluate((z) => getComputedStyle(z).animationName)).toBe("glocke-hupf");
});

test("Texte: nie „null“, „undefined“ oder „NaN“ — auch bei Meldungen ohne Namen, ohne Text oder mit unbekanntem Programm", async ({ page }) => {
  melde("pflege", { wer: undefined, programm: "gibt-es-nicht", text: "Pflege fertig." });
  melde("ablage-aufgabe", { wer: undefined, programm: null, text: "hat eine Aufgabe angelegt.", pfade: ["05_aufgaben/x.md"] });
  melde("aenderung", { wer: "Eine Ki", programm: "claude", text: "" });
  await oeffneStudio(page);
  await oeffnePanel(page);
  await expect(eintraege(page)).toHaveCount(3);
  const text = await page.locator("#knopf-glocke, .glocke").evaluateAll((l) => l.map((e) => e.innerText + " " + (e.getAttribute("aria-label") || "") + " " + (e.title || "")).join(" "));
  expect(text).not.toMatch(/\b(null|undefined|NaN)\b/);
  await expect(panel(page).locator('.gl-eintrag[data-art="ablage-aufgabe"] .gl-satz')).toHaveText("Eine KI hat eine Aufgabe angelegt."); // ohne Namen: „Eine KI“
});

test("Reine Funktionen (im Browser geladen): Zahl, Tagesgruppen, Filter, Reihenfolge", async ({ page }) => {
  await oeffneStudio(page);
  const r = await page.evaluate(async () => {
    const m = await import("./glocke.js");
    const jetzt = new Date(2026, 9, 31, 8, 0, 0);
    const tag = (d, h = 12) => new Date(2026, 9, 31 - d, h, 0, 0).toISOString();
    return {
      zahl: [0, 1, 9, 10, 250, -3, null, "x"].map(m.zahlText),
      gruppen: [tag(0, 1), tag(1, 23), tag(2), tag(40), "kaputt"].map((z) => m.tagesGruppe(z, jetzt)),
      filter: ["alle", "abweisungen", "ablagen", "sicherung"].map((f) => ["abweisung", "ablage-notiz", "aenderung", "sicherung-fehler", "pflege"].filter((a) => m.passtZuFilter(f, { art: a }))),
      reihenfolge: m.sichtbar([{ art: "pflege", zeit: tag(2) }, { art: "rueckgaengig", zeit: tag(0) }, { art: "abweisung", zeit: tag(0) }, null, { zeit: tag(0) }]).map((e) => e.art),
      leseverbot: [m.istLeseverbotHinweis({ art: "abweisung", grund: "gelesen-ohne-leseverbot" }), m.istLeseverbotHinweis({ art: "abweisung", grund: "gesperrt" })],
    };
  });
  expect(r.zahl).toEqual(["0", "1", "9", "9+", "9+", "0", "0", "0"]);
  expect(r.gruppen).toEqual(["heute", "gestern", "frueher", "frueher", "frueher"]);
  expect(r.filter).toEqual([["abweisung", "ablage-notiz", "aenderung", "sicherung-fehler", "pflege"], ["abweisung"], ["ablage-notiz", "aenderung"], ["sicherung-fehler"]]);
  expect(r.reihenfolge).toEqual(["abweisung", "pflege"]);
  expect(r.leseverbot).toEqual([true, false]);
});
