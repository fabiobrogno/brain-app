// Vorschlagskarten im Posteingang (K3) im echten Studio, gegen die echte Werkstatt; das einzige Attrappe ist `claude` (Tests/Kern/fake-claude-vorschlag.mjs, prüft die Schutzgeländer).
// Umgebung des Servers ausdrücklich gebaut (eigenes HOME, PATH nur mit dem Attrappen-Ordner), Konten in einem Temp-Home, nichts vom Rechner des Entwicklers.
// Geprüft: ohne Konto nur lokale Vorschläge · Karten, „Warum?“ (Beleg hervorgehoben), Verwerfen · Übernehmen je Art (verlinken, tags, verschieben, aufgabe, duplikat mit Vergleich) mit Rückgängig · veraltet
// · „Für alle“ (höchstens 10, Fortschritt, Abbruch) · keine Layoutsprünge · hell und dunkel. Bilder: KI_KARTEN_BILDER=/Ordner npx playwright test ki-posteingang.spec.mjs
import { test, expect } from "./basis.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { baueVault, git } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { legeProgramm, pfadMit } from "../Node/attrappe.mjs";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const K = await import(pathToFileURL(join(WURZEL, "Ressourcen/gemeinsam/ki-konten.mjs")).href);
const FAKE = join(WURZEL, "Tests/Kern/fake-claude-vorschlag.mjs");
const BILDER = process.env.KI_KARTEN_BILDER;
if (BILDER) mkdirSync(BILDER, { recursive: true });
const bild = async (page, name) => { if (BILDER) { await page.waitForTimeout(400); await page.screenshot({ path: join(BILDER, `${name}.png`) }); } };

const REISE = "00_inbox/Reise nach Lissabon.md", PLANUNG = "00_inbox/Planung.md", NEIN = "00_inbox/Nein.md", GEDANKE = "00_inbox/2026-10-23_gedanke.md";
const REISE_TEXT = "# Reise nach Lissabon\n\nFlug im Mai, Hotel in der Alfama. Mietwagen buchen bis 14.11.\n";
const PLANUNG_TEXT = "# Planung\n\nDie Reise nach Lissabon und ein Termin zum Espresso nächste Woche.\n";

let vault, server, bin, home, support;
async function aufbauen({ stufe = "lesen", mitClaude = true, einwilligung = true, viele = 0 } = {}) {
  ({ vault } = baueVault());
  vault = realpathSync.native(vault);
  writeFileSync(join(vault, REISE), REISE_TEXT);
  writeFileSync(join(vault, PLANUNG), PLANUNG_TEXT);
  writeFileSync(join(vault, NEIN), "---\nki: nein\n---\n# Nein\n\nNIE-AN-DIE-KI Kaffee Reise Planung.\n");
  for (let i = 0; i < viele; i++) writeFileSync(join(vault, `00_inbox/Viel-${String(i + 1).padStart(2, "0")}.md`), `# Viel ${i + 1}\n\nGedanke Nummer ${i + 1} über Kaffee.\n`);
  git(vault, "add", "--", "00_inbox"); git(vault, "commit", "-q", "-m", "Einträge im Posteingang"); // wie im Alltag: die Einträge sind schon versioniert
  const wurzel = realpathSync.native(mkdtempSync(join(tmpdir(), "brain-ui-kipe-")));
  home = join(wurzel, "home"); bin = join(wurzel, "bin"); support = join(wurzel, "support");
  for (const d of [home, bin, support]) mkdirSync(d);
  const profil = (n) => { const p = join(home, n); mkdirSync(p); writeFileSync(join(p, "settings.json"), "{}"); return realpathSync.native(p); };
  const a = profil(".claude-arbeit");
  const ein = (id, programm, ordner, name, extra = {}) => [id, { programm, ordner, standard: false, name, ordnerKennung: K.kennungVon(ordner), ...extra }];
  K.aendere(support, () => ({ version: 1, konten: Object.fromEntries([ein("k_aaaaaaaa", "claude", a, "Arbeit", { abo: "max" })]),
    vaults: { [vault]: { ordnerKennung: K.kennungVon(vault), neueKonten: "gesperrt", ohneKonto: "gesperrt", konten: { k_aaaaaaaa: stufe },
      ...(einwilligung ? { vorschlaege: { an: true, seit: "2026-11-09T10:00:00.000Z", konto: "k_aaaaaaaa" } } : {}) } } }));
  if (mitClaude) legeProgramm(join(bin, "claude"), `#!${process.execPath}\nglobalThis.FAKE_ORDNER = ${JSON.stringify(bin)};\nimport(${JSON.stringify(pathToFileURL(FAKE).href)}).catch((e) => { console.error(String(e && e.stack || e)); process.exit(70); });\n`);
  server = await starteServer(vault, { vertraut: true, support, umgebung: { PATH: pfadMit(bin), HOME: home, LANG: "de_DE.UTF-8", BRAIN_CLAUDE_EXTRA: "", GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "t@example.org", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "t@example.org" } }); // Git braucht eine Kennung (die Umgebung ist ausdrücklich gebaut)
}
const szenario = (o) => writeFileSync(join(bin, "szenario.json"), JSON.stringify(o));
const aufrufe = () => (existsSync(join(bin, "aufrufe.jsonl")) ? readFileSync(join(bin, "aufrufe.jsonl"), "utf8").trim().split("\n").map((z) => JSON.parse(z)) : []);
const lesen = (rel) => readFileSync(join(vault, rel), "utf8");
const alleDateien = (d = vault) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.name === ".git" || e.name === ".kortex-lokal" ? [] : e.isDirectory() ? alleDateien(join(d, e.name)) : [join(d, e.name)]));
test.afterEach(() => { server?.stopp(); server = null; });

async function zumPosteingang(page) {
  await page.goto(server.url);
  await page.waitForSelector("[data-karte], [data-leer]", { timeout: 15000 });
  await page.click('[data-bereich="inbox"]');
  await expect(page.locator('[data-pk-pfad="' + PLANUNG + '"]')).toBeVisible();
}
const wurzel = (page, pfad) => page.locator(`[data-pk-pfad="${pfad}"]`);
const chip = (page, pfad) => wurzel(page, pfad).locator('[data-aktion="pk-auf"]');
const kiKnopf = (page, pfad) => wurzel(page, pfad).locator('[data-aktion="pk-ki"]');
const panel = (page, pfad) => wurzel(page, pfad).locator(".pk-panel");
const karte = (page, pfad, art) => panel(page, pfad).locator(`[data-pk-art="${art}"]`);
const oeffneChip = async (page, pfad) => { await expect(chip(page, pfad)).toBeEnabled({ timeout: 15000 }); if ((await chip(page, pfad).getAttribute("aria-expanded")) !== "true") await chip(page, pfad).click(); await expect(panel(page, pfad)).toBeVisible(); };
const toastMit = (page, text) => page.locator(".toast", { hasText: text });
const schemata = [["hell", "light"], ["dunkel", "dark"]];

test("Ohne Konto: nur lokale Vorschläge (Karten mit „ohne KI“), kein KI-Knopf, keine Leiste, kein Aufruf; Übernehmen geht auch so", async ({ page }) => {
  await aufbauen({ stufe: "gesperrt" });
  await zumPosteingang(page);
  await expect(page.locator("[data-pk-leiste]")).toBeHidden();
  await expect(page.locator('[data-aktion="pk-ki"]')).toHaveCount(0);
  await expect(chip(page, PLANUNG)).toContainText("2 Vorschläge", { timeout: 15000 });
  await expect(chip(page, REISE)).toContainText("1 Vorschlag");
  await expect(chip(page, GEDANKE)).toContainText("Keine Vorschläge");
  await expect(chip(page, GEDANKE)).toBeDisabled();
  await oeffneChip(page, PLANUNG);
  await expect(panel(page, PLANUNG).locator(".pk-marke.ohne")).toHaveCount(2);
  await expect(panel(page, PLANUNG).locator(".pk-marke.ohne").first()).toHaveText("ohne KI");
  expect(aufrufe()).toEqual([]);
  // Übernehmen ohne Konto: verlinkt genau die Stelle, über den Weg mit Journal
  await karte(page, PLANUNG, "verlinken").filter({ hasText: "Reise nach Lissabon" }).locator('[data-aktion="pk-ok"]').click();
  await expect(toastMit(page, "Verlinkt")).toBeVisible({ timeout: 20000 });
  expect(lesen(PLANUNG)).toContain("[[10_notizen/Reise nach Lissabon|Reise nach Lissabon]]"); // der Titel gehört zu zwei Notizen: der Link nennt den Pfad
  expect(aufrufe()).toEqual([]);
});

test("Karten: „Warum?“ hebt den Beleg wörtlich hervor, Verwerfen blendet die Karte aus und merkt sich es; der Eintrag bleibt unverändert", async ({ page }) => {
  await aufbauen({ stufe: "gesperrt" });
  await zumPosteingang(page);
  await oeffneChip(page, PLANUNG);
  const k = karte(page, PLANUNG, "verlinken").first();
  await expect(k.locator('[data-pk-text]')).toContainText("Verlinkt mit „");
  await k.locator('[data-aktion="pk-warum"]').click();
  const w = k.locator("[data-pk-warum]");
  await expect(w).toBeVisible();
  await expect(w.locator("mark")).toHaveText(/Reise nach Lissabon|Espresso/);
  await expect(w.locator(".pk-zitat")).toContainText("Die Reise nach Lissabon und ein Termin zum Espresso");
  await expect(w).toContainText("Begründung");
  await expect(w).not.toContainText("der KI"); // lokal: keine KI im Spiel
  await k.locator('[data-aktion="pk-warum"]').click();
  await expect(w).toHaveCount(0);
  await expect(panel(page, PLANUNG).locator(".pk-karte")).toHaveCount(2);
  await panel(page, PLANUNG).locator('[data-aktion="pk-verwerfen"]').first().click();
  await expect(panel(page, PLANUNG).locator(".pk-karte")).toHaveCount(1);
  await expect(chip(page, PLANUNG)).toContainText("1 Vorschlag");
  expect(lesen(PLANUNG)).toBe(PLANUNG_TEXT);
  // ein Neuzeichnen der Liste bringt Verworfenes nicht zurück
  await page.click('[data-bereich="alle"]'); await page.click('[data-bereich="inbox"]');
  await expect(chip(page, PLANUNG)).toContainText("1 Vorschlag", { timeout: 15000 });
});

test("Lokal: Verlinken über den Erwähnungen-Weg, Rückgängig im Toast stellt den Text her", async ({ page }) => {
  await aufbauen({ stufe: "gesperrt" });
  await zumPosteingang(page);
  await oeffneChip(page, PLANUNG);
  await karte(page, PLANUNG, "verlinken").filter({ hasText: "Reise nach Lissabon" }).locator('[data-aktion="pk-ok"]').click();
  await expect(toastMit(page, "Verlinkt")).toBeVisible({ timeout: 20000 });
  expect(lesen(PLANUNG)).toBe(PLANUNG_TEXT.replace("Reise nach Lissabon", "[[10_notizen/Reise nach Lissabon|Reise nach Lissabon]]"));
  await toastMit(page, "Verlinkt").locator("a", { hasText: "Rückgängig" }).click();
  await expect(toastMit(page, "Rückgängig gemacht")).toBeVisible({ timeout: 20000 });
  expect(lesen(PLANUNG)).toBe(PLANUNG_TEXT);
});

test("Duplikat: „Vergleichen“ zeigt beide Texte nebeneinander, „Als Duplikat ablegen“ legt den Eintrag ins Archiv (nichts gelöscht), Rückgängig holt ihn zurück", async ({ page }) => {
  await aufbauen({ stufe: "gesperrt" });
  await zumPosteingang(page);
  await oeffneChip(page, REISE);
  const k = karte(page, REISE, "duplikat");
  await expect(k).toContainText("Duplikat");
  await expect(k.locator('[data-aktion="pk-ok"]')).toHaveText("Als Duplikat ablegen");
  await k.locator('[data-aktion="pk-vergleichen"]').click();
  const dlg = page.locator('[data-dialog="pk-vergleich"]');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator(".pk-vgl-text").first()).toContainText("Mietwagen buchen bis 14.11.");
  await expect(dlg.locator(".pk-vgl-text").nth(1)).toContainText("Mietwagen nicht nötig");
  await bild(page, "k3-vergleich-hell");
  await dlg.locator('[data-aktion="pk-vgl-ok"]').click();
  await expect(dlg).toHaveCount(0);
  await expect(page.locator(".toast").first()).toContainText("Als Duplikat abgelegt", { timeout: 20000 }); // zeigt bei einem Fehler dessen Text
  expect(existsSync(join(vault, REISE))).toBe(false);
  expect(readFileSync(join(vault, "90_archiv/verworfen/Reise nach Lissabon.md"), "utf8")).toBe(REISE_TEXT);
  await expect(page.locator(`[data-karte][data-pfad="${REISE}"]`)).toHaveCount(0);
  await toastMit(page, "Als Duplikat abgelegt").locator("a", { hasText: "Rückgängig" }).click();
  await expect(toastMit(page, "Rückgängig gemacht")).toBeVisible({ timeout: 20000 });
  expect(lesen(REISE)).toBe(REISE_TEXT);
  await expect(page.locator(`[data-karte][data-pfad="${REISE}"]`)).toBeVisible();
});

test("Mit KI: je Art übernehmen (Tags, Aufgabe, Verschieben) über die echten Wege, jedes mit Rückgängig; Begründung der KI als „ungeprüft“", async ({ page }) => {
  await aufbauen();
  szenario({ szenario: "arten", arten: ["tags", "aufgabe", "verschieben"], ordnerName: "10_notizen", tags: ["lissabon", "Planung-2026"] });
  await zumPosteingang(page);
  await kiKnopf(page, GEDANKE).click();
  await expect(panel(page, GEDANKE).locator(".pk-karte")).toHaveCount(3, { timeout: 15000 });
  expect(aufrufe().length).toBe(1);
  expect(aufrufe()[0].verletzt).toEqual([]);
  expect(aufrufe()[0].stdin).not.toContain("NIE-AN-DIE-KI");
  await expect(panel(page, GEDANKE).locator("[data-pk-meta]")).toContainText("Vorschlag der KI");
  await expect(karte(page, GEDANKE, "tags").locator("[data-pk-detail]")).toContainText("#lissabon");
  await expect(karte(page, GEDANKE, "aufgabe").locator("[data-pk-detail]")).toContainText("Angebot schicken");
  await expect(karte(page, GEDANKE, "aufgabe").locator("[data-pk-detail]")).toContainText("fällig 14.11.");
  await karte(page, GEDANKE, "tags").locator('[data-aktion="pk-warum"]').click();
  await expect(karte(page, GEDANKE, "tags").locator("[data-pk-warum]")).toContainText("Begründung der KI (ungeprüft)");
  await expect(karte(page, GEDANKE, "tags").locator("[data-pk-warum] mark")).toBeVisible();
  // Tags
  const alt = lesen(GEDANKE);
  await karte(page, GEDANKE, "tags").locator('[data-aktion="pk-ok"]').click();
  await expect(toastMit(page, "Tags gesetzt")).toBeVisible({ timeout: 20000 });
  expect(lesen(GEDANKE)).toBe(`---\ntags: [lissabon, Planung-2026]\n---\n${alt}`);
  await toastMit(page, "Tags gesetzt").locator("a", { hasText: "Rückgängig" }).click();
  await expect(toastMit(page, "Rückgängig gemacht")).toBeVisible({ timeout: 20000 });
  expect(lesen(GEDANKE)).toBe(alt);
  // Die übrigen Vorschläge sind nach Rückgängig verbraucht: neu holen (nur auf Klick)
  await expect.poll(() => aufrufe().length).toBe(1);
  await kiKnopf(page, GEDANKE).click();
  await expect(panel(page, GEDANKE).locator(".pk-karte")).toHaveCount(3, { timeout: 15000 });
  // Aufgabe
  await karte(page, GEDANKE, "aufgabe").locator('[data-aktion="pk-ok"]').click();
  await expect(toastMit(page, "Aufgabe angelegt")).toBeVisible({ timeout: 20000 });
  const mitAufgabe = () => alleDateien().filter((d) => { try { return d.endsWith(".md") && readFileSync(d, "utf8").includes("Angebot schicken"); } catch { return false; } }).map((d) => d.slice(vault.length));
  await expect.poll(() => mitAufgabe().length).toBe(1);
  await toastMit(page, "Aufgabe angelegt").locator("a", { hasText: "Rückgängig" }).click();
  await expect(toastMit(page, "Rückgängig gemacht")).toBeVisible({ timeout: 20000 });
  await expect.poll(mitAufgabe, { message: "die Aufgabe liegt nicht mehr im Vault" }).toEqual([]);
});

test("Mit KI: Verschieben über dateiaktionen, der Eintrag verschwindet aus dem Posteingang; Rückgängig bringt ihn zurück", async ({ page }) => {
  await aufbauen();
  szenario({ szenario: "arten", arten: ["verschieben"], ordnerName: "10_notizen" });
  await zumPosteingang(page);
  await kiKnopf(page, GEDANKE).click();
  await expect(karte(page, GEDANKE, "verschieben")).toBeVisible({ timeout: 15000 });
  await expect(karte(page, GEDANKE, "verschieben").locator("[data-pk-text]")).toHaveText("Verschiebt nach „10_notizen“");
  const alt = lesen(GEDANKE);
  await karte(page, GEDANKE, "verschieben").locator('[data-aktion="pk-ok"]').click();
  await expect(toastMit(page, "Verschoben")).toBeVisible({ timeout: 20000 });
  expect(existsSync(join(vault, GEDANKE))).toBe(false);
  expect(readFileSync(join(vault, "10_notizen/2026-10-23_gedanke.md"), "utf8")).toBe(alt);
  await expect(page.locator(`[data-karte][data-pfad="${GEDANKE}"]`)).toHaveCount(0);
  await toastMit(page, "Verschoben").locator("a", { hasText: "Rückgängig" }).click();
  await expect(toastMit(page, "Rückgängig gemacht")).toBeVisible({ timeout: 20000 });
  expect(lesen(GEDANKE)).toBe(alt);
  await expect(page.locator(`[data-karte][data-pfad="${GEDANKE}"]`)).toBeVisible();
});

test("Veraltet: ändert jemand den Eintrag nach der Anfrage, zeigt die Karte „gilt nicht mehr“ (Übernehmen aus, nichts geschrieben); „Neu holen“ startet neu", async ({ page }) => {
  await aufbauen();
  szenario({ szenario: "arten", arten: ["tags", "verschieben"], ordnerName: "10_notizen" });
  await zumPosteingang(page);
  await kiKnopf(page, GEDANKE).click();
  await expect(panel(page, GEDANKE).locator(".pk-karte")).toHaveCount(2, { timeout: 15000 });
  writeFileSync(join(vault, GEDANKE), lesen(GEDANKE) + "\nNachträglich ergänzt.\n"); // ein anderes Programm
  const vorher = lesen(GEDANKE);
  await karte(page, GEDANKE, "tags").locator('[data-aktion="pk-ok"]').click();
  await expect(page.locator("[data-pk-veraltet]")).toBeVisible();
  await expect(page.locator("[data-pk-veraltet]")).toContainText("Der Eintrag hat sich geändert");
  await expect(karte(page, GEDANKE, "tags").locator('[data-aktion="pk-ok"]')).toBeDisabled();
  await expect(karte(page, GEDANKE, "verschieben").locator('[data-aktion="pk-ok"]')).toBeDisabled();
  await bild(page, "k3-veraltet-hell");
  expect(lesen(GEDANKE)).toBe(vorher);
  expect(existsSync(join(vault, "10_notizen/2026-10-23_gedanke.md"))).toBe(false);
  await page.locator('[data-aktion="pk-neu"]').click();
  await expect.poll(() => aufrufe().length).toBe(2);
  await expect(page.locator("[data-pk-veraltet]")).toHaveCount(0);
  await expect(karte(page, GEDANKE, "tags").locator('[data-aktion="pk-ok"]')).toBeEnabled({ timeout: 15000 });
});

test("Ein Eintrag mit „ki: nein“: KI-Knopf aus mit Grund, nie gesendet; „Für alle“ lässt ihn aus", async ({ page }) => {
  await aufbauen();
  szenario({ szenario: "ok" });
  await zumPosteingang(page);
  await expect(kiKnopf(page, NEIN)).toBeDisabled();
  await expect(kiKnopf(page, NEIN)).toHaveAttribute("title", /ki: nein/);
  await page.locator('[data-aktion="pk-alle"]').click();
  await expect(page.locator("[data-pk-stapel-text]")).toContainText("Fertig", { timeout: 30000 });
  expect(aufrufe().length).toBe(5);
  for (const a of aufrufe()) expect(a.stdin).not.toContain("NIE-AN-DIE-KI");
});

test("Für alle: höchstens 10 (Beschriftung nennt es), Fortschritt, Ergebnis je Eintrag, danach „Noch einmal“; mehr als 10 Aufrufe gibt es nie", async ({ page }) => {
  await aufbauen({ viele: 9 }); // 5 vorhandene Einträge (ohne „ki: nein“) + 9 = 14
  szenario({ szenario: "langsam", warteMs: 300 });
  await zumPosteingang(page);
  const alle = page.locator('[data-aktion="pk-alle"]');
  await expect(alle).toContainText("Für die ersten 10 holen");
  await alle.click();
  await expect(page.locator("[data-pk-fortschritt]")).toContainText(/Eintrag \d+ von 10/);
  await expect(page.locator('[data-aktion="pk-stapel-abbrechen"]')).toBeVisible();
  await expect(page.locator("[data-pk-stapel-text]")).toContainText("Fertig", { timeout: 40000 });
  expect(aufrufe().length).toBe(10);
  await expect(alle).toBeEnabled();
  await expect(alle).toContainText("Für alle holen (4)"); // die übrigen vier haben noch keine Vorschläge
  await page.waitForTimeout(300);
  expect(aufrufe().length).toBe(10);
});

test("Für alle + Abbruch: der laufende Lauf endet sofort, es startet nichts mehr, „Abgebrochen nach …“; Kontingent erschöpft: Knopf aus", async ({ page }) => {
  await aufbauen();
  szenario({ szenario: "abbruch" });
  await zumPosteingang(page);
  await page.locator('[data-aktion="pk-alle"]').click();
  await expect.poll(() => existsSync(join(bin, "wartet")), { timeout: 15000 }).toBe(true);
  await expect(page.locator("[data-pk-fortschritt]")).toContainText("Eintrag 1 von 5");
  await bild(page, "k3-stapel-laeuft-hell");
  const pid = Number(readFileSync(join(bin, "wartet"), "utf8"));
  await page.locator('[data-aktion="pk-stapel-abbrechen"]').click();
  await expect(page.locator("[data-pk-stapel-text]")).toContainText("Abgebrochen nach", { timeout: 15000 });
  await expect(page.locator("[data-pk-stapel-text]")).toContainText("Nichts wurde geändert");
  await expect.poll(() => { try { process.kill(pid, 0); return false; } catch { return true; } }, { timeout: 10000 }).toBe(true);
  await page.waitForTimeout(500);
  expect(aufrufe().length).toBe(1);
  await expect(page.locator('[data-aktion="pk-alle"]')).toBeEnabled();
  for (const p of [GEDANKE, PLANUNG, REISE]) await expect(wurzel(page, p).locator(".pk-chip")).not.toContainText("arbeitet");
});

test("Kontingent: bei 100 % sind die KI-Knöpfe aus (Grund steht daneben), die lokalen Vorschläge bleiben; bei 85 % steht der Satz in der Leiste", async ({ page }) => {
  await aufbauen();
  const jetzt = Date.now();
  const antwort = (p) => ({ jetzt: new Date(jetzt).toISOString(), takt: { abfrageMs: 900_000, neuFruehestensMs: 300_000, veraltetMs: 1_800_000 },
    konten: [{ id: "k_aaaaaaaa", programm: "claude", name: "Arbeit", standard: false, quelle: "statuszeile", verwaltet: false, status: "ok", session: { usedPercent: p, windowMinutes: 300, resetsAt: jetzt + 2 * 3_600_000 }, weekly: { usedPercent: 10, windowMinutes: 10080, resetsAt: jetzt + 30 * 3_600_000 }, aktualisiert: new Date(jetzt).toISOString() }] });
  let p = 85;
  await page.route(/\/api\/ki\/kontingent(\?.*)?$/, (route) => route.fulfill({ json: antwort(p) }));
  await zumPosteingang(page);
  await expect(page.locator('[data-pk-leiste] [data-kiv="pk-kontingent"]')).toHaveAttribute("data-stufe", "fast");
  await expect(page.locator('[data-pk-leiste] [data-kiv="pk-kontingent-text"]')).toContainText("bald aufgebraucht");
  await expect(page.locator('[data-aktion="pk-alle"]')).toBeEnabled();
  p = 100;
  await page.reload();
  await page.waitForSelector("[data-karte]", { timeout: 15000 });
  await page.click('[data-bereich="inbox"]');
  await expect(page.locator('[data-aktion="pk-alle"]')).toBeDisabled();
  await expect(page.locator("[data-pk-leiste]")).toContainText("Kontingent");
  await expect(kiKnopf(page, GEDANKE)).toBeDisabled();
  await expect(chip(page, PLANUNG)).toContainText("2 Vorschläge", { timeout: 15000 });
  expect(aufrufe()).toEqual([]);
});

test("Keine Layoutsprünge: die Einträge bleiben, wo sie sind, wenn lokale Vorschläge eintreffen, die Karten aufklappen und wieder zugehen; die Liste unter der Maus bewegt sich nur, wenn der Nutzer klickt", async ({ page }) => {
  await aufbauen();
  szenario({ szenario: "langsam", warteMs: 800 });
  await page.goto(server.url);
  await page.waitForSelector("[data-karte], [data-leer]", { timeout: 15000 });
  await page.click('[data-bereich="inbox"]');
  const ys = async () => page.evaluate(() => [...document.querySelectorAll("#liste-koerper [data-karte]")].map((k) => Math.round(k.getBoundingClientRect().top)));
  await expect(wurzel(page, PLANUNG)).toBeVisible();
  const vorher = await ys();
  await expect(chip(page, PLANUNG)).toContainText("2 Vorschläge", { timeout: 15000 }); // die lokalen Vorschläge sind da
  expect(await ys()).toEqual(vorher);
  // KI starten: das Panel gehört zum Eintrag, den der Nutzer angeklickt hat; die Einträge darüber bleiben stehen
  const letzterVor = (await ys())[0];
  await kiKnopf(page, PLANUNG).click();
  await expect(panel(page, PLANUNG)).toBeVisible();
  expect((await ys())[0]).toBe(letzterVor);
  await expect(panel(page, PLANUNG).locator("[data-pk-meta]")).toBeVisible({ timeout: 15000 });
  expect((await ys())[0]).toBe(letzterVor);
  await chip(page, PLANUNG).click(); // zuklappen
  await expect(panel(page, PLANUNG)).toBeHidden();
  expect(await ys()).toEqual(vorher);
});

for (const [schema, farbe] of schemata) {
  test(`hell und dunkel (${schema}): Karten, „Warum?“, KI-Ergebnis und „Für alle“; nichts ragt über den Rand, kein „null“ oder „undefined“`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: farbe, reducedMotion: "reduce" });
    await aufbauen();
    szenario({ szenario: "arten", arten: ["tags", "aufgabe", "verschieben"], ordnerName: "10_notizen", tags: ["lissabon", "planung"] });
    await zumPosteingang(page);
    await expect(chip(page, PLANUNG)).toContainText("2 Vorschläge", { timeout: 15000 });
    await oeffneChip(page, PLANUNG);
    await karte(page, PLANUNG, "verlinken").first().locator('[data-aktion="pk-warum"]').click();
    await bild(page, `k3-karten-${schema}`);
    await kiKnopf(page, GEDANKE).click();
    await expect(panel(page, GEDANKE).locator(".pk-karte")).toHaveCount(3, { timeout: 15000 });
    await karte(page, GEDANKE, "tags").locator('[data-aktion="pk-warum"]').click();
    await bild(page, `k3-ki-ergebnis-${schema}`);
    szenario({ szenario: "langsam", warteMs: 2500 });
    await page.locator('[data-aktion="pk-alle"]').click();
    await expect(page.locator("[data-pk-fortschritt]")).toBeVisible();
    await bild(page, `k3-stapel-${schema}`);
    if (schema === "dunkel") {
      await oeffneChip(page, REISE);
      await karte(page, REISE, "duplikat").locator('[data-aktion="pk-vergleichen"]').click();
      await expect(page.locator('[data-dialog="pk-vergleich"]')).toBeVisible();
      await bild(page, "k3-vergleich-dunkel");
      await page.keyboard.press("Escape");
    }
    const problem = await page.evaluate(() => {
      const liste = document.querySelector("#liste-koerper").getBoundingClientRect();
      const text = document.querySelector("#liste-koerper").innerText;
      const ueber = [...document.querySelectorAll("#liste-koerper .pk-karte, #liste-koerper .pk-chip, #liste-koerper .pk-leiste, #liste-koerper .pk-zitat")].filter((e) => e.getBoundingClientRect().right > liste.right + 1).length;
      return { ueber, bad: /\bnull\b|\bundefined\b|NaN/.test(text) };
    });
    expect(problem.ueber).toBe(0);
    expect(problem.bad).toBe(false);
  });
}
