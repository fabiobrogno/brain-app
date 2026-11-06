// „KI & Konten“, Paket E4 („Konten“): Unterbereiche Konten · Zugriff · Kontingent · Pflege & Frag, Suche und Sprung in den richtigen Unterbereich, Konten-Zeilen mit Abzeichen (Aktiv · Anmelden nötig ·
// Abgelaufen), Mini-Balken und Identität (nur vom Programm, nur bei eingeschaltetem Schalter), ein aktives Konto je Programm (ki-konten.json, einmalige Übernahme aus dem lokalen Speicher),
// Umbenennen, Entfernen mit „Nicht mehr fragen“ und der Weg des neuen Kontos (.neu-Ordner → bestätigte Anmeldung). Hell und dunkel als Bild.
// Die Routen /api/ki/* sind Attrappen (mocks-konten.mjs); der Rest läuft gegen die echte Werkstatt. UI_SHOTS=<Ordner>: Bilder dort ablegen.
import { test, expect } from "./basis.mjs";
import { join } from "node:path";
import { realpathSync, writeFileSync } from "node:fs";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { mockeV2 } from "./mocks.mjs";
import { mockeKonten, KONTEN, PROGRAMME } from "./mocks-konten.mjs";
import { mockeKontingent, ZUSTAND } from "./mocks-kontingent.mjs";
import { BEREICHE } from "../../Ressourcen/studio/texte-einstellungen.js";

let vault, server;
test.beforeEach(async () => { ({ vault } = baueVault()); vault = realpathSync(vault); writeFileSync(join(vault, "brain.config.json"), JSON.stringify({ name: "Kortex", automatik: {} }, null, 2) + "\n"); server = await starteServer(vault); }); // die App-Einstellungen schreiben mit dem Stand beider Speicher: ohne Konfiguration im Vault gibt es keinen gültigen Stand
test.afterEach(() => server?.stopp());

const shot = (name) => join(process.env.UI_SHOTS || "screenshots", `ki-e4-${name}.png`);
const foto = async (page, name) => { await page.waitForTimeout(450); await page.screenshot({ path: shot(name) }); };
const FIRMA = "/Users/test/Firma-Vault";
const NOTIZ = "10_notizen/Reise nach Lissabon.md";
const seite = (page) => page.locator("[data-einstellungen]");
const dlg = (page, name) => page.locator(`.dialog[data-dialog="${name}"]`);
const menueEintrag = (page, id) => page.locator(`.menue [data-menue="${id}"]`);
const konto = (page, id) => page.locator(`.kx-konto[data-konto="${id}"]`);
const unter = async (page, name) => { await page.locator(`[data-unter-wahl="${name}"]`).click(); await expect(page.locator(`[data-unter-wahl="${name}"]`)).toHaveAttribute("aria-checked", "true"); };
const oeffneMenueAn = async (loc) => { await loc.evaluate((e) => e.scrollIntoView({ block: "center", behavior: "instant" })); await loc.page().waitForTimeout(150); await loc.click(); };

// zwei Claude-Konten (Privat, Firma), ein Codex-Konto; alle angemeldet, außer es steht anders im Test
const ZWEI = () => {
  const claude2 = { id: "k_aaaa0004", programm: "claude", programmName: "Claude Code", name: "Firma", standard: false, ordner: "~/.claude-firma", pfad: "/Users/test/.claude-firma", vorhanden: true, verbunden: false };
  return {
    konten: [KONTEN[0], claude2, KONTEN[2]].map((k) => ({ ...k, name: k.name === "Claude Code" ? "Privat" : k.name === "Codex" ? "Standard" : k.name })),
    programme: PROGRAMME, login: { k_aaaa0001: "angemeldet", k_aaaa0004: "angemeldet", k_aaaa0003: "angemeldet" }, zuletzt: {},
  };
};
const EIGEN = { id: "k_eigen001", programm: "claude", programmName: "Claude Code", name: "Kunde", standard: false, ordner: "~/Library/Application Support/Kortex/ki-konten-ordner/claude-kunde", pfad: "/Users/test/Library/Application Support/Kortex/ki-konten-ordner/claude-kunde", verwaltet: true, vorhanden: true, verbunden: false };

async function start(page, opt = {}, { hash = "#einstellungen/ki", dunkel = false, breite = 1440, hoehe = 900, vorher = null, kontingent = null } = {}) {
  await page.setViewportSize({ width: breite, height: hoehe });
  if (dunkel) await page.emulateMedia({ colorScheme: "dark" });
  if (vorher) await page.addInitScript(vorher.fn, vorher.arg);
  await mockeV2(page, vault);
  const z = await mockeKonten(page, { vaults: [{ pfad: vault, name: "Mein Vault" }, { pfad: FIRMA, name: "Firma" }], ...opt });
  if (kontingent) z.kt = await mockeKontingent(page, { konten: z.konten, werte: kontingent });
  await page.goto(server.url + "?pfad=" + encodeURIComponent(NOTIZ));
  await page.waitForSelector("#app:not([hidden])");
  await page.waitForFunction(() => window.__studioBereit === true);
  if (hash) { await page.evaluate((h) => { location.hash = h; }, hash); await expect(seite(page)).toBeVisible({ timeout: 20000 }); }
  return z;
}
const warteKonten = async (page) => { await expect(page.locator(".kx-prog").first()).toBeVisible(); await expect(page.locator('.kx-konto[data-anmeldung="prueft"]')).toHaveCount(0); };

test("Unterbereiche: Konten · Zugriff · Kontingent · Pflege & Frag zeigen je ihre Abschnitte, nichts geht verloren, Pfeiltasten wechseln", async ({ page }) => {
  await start(page, ZWEI());
  await warteKonten(page);
  const namen = await page.locator("[data-unter-wahl]").allTextContents();
  expect(namen).toEqual(["Konten", "Zugriff", "Kontingent", "Pflege & Frag"]);
  await expect(page.locator('[data-unter-wahl="konten"]')).toHaveAttribute("aria-checked", "true");
  await expect(page.locator('[data-kk="matrix"]')).toBeHidden();
  await expect(page.locator('[data-kx="kacheln"]')).toBeVisible();
  await unter(page, "zugriff");
  await expect(page.locator('[data-kk="matrix"]')).toBeVisible();
  await expect(page.locator('[data-kk="streng-karte"]').first()).toBeVisible();
  await expect(page.locator('[data-kk="ehrlich-karte"]')).toBeVisible();
  await expect(page.locator(".kx-prog").first()).toBeHidden();
  await unter(page, "kontingent");
  await expect(page.locator('[data-abschnitt="ki-kontingent"]')).toBeVisible();
  await expect(page.locator('[data-kk="matrix"]')).toBeHidden();
  await unter(page, "pflege");
  await expect(page.locator('[data-kx="frage-konto-wahl"]')).toBeVisible();
  await expect(page.locator('[data-kk="pflege-stufe"]').first()).toBeVisible();
  await expect(page.locator('[data-kx="arbeit-claude"]')).toBeVisible();
  await expect(page.locator('[data-filter="alle"]')).toBeVisible();
  // jeder Abschnitt der Registerseite gehört zu genau einem Unterbereich, jede Zeile ist erreichbar
  await page.locator('[data-unter-wahl="pflege"]').focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator('[data-unter-wahl="kontingent"]')).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("ArrowLeft"); await page.keyboard.press("ArrowLeft");
  await expect(page.locator('[data-unter-wahl="konten"]')).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".kx-prog").first()).toBeVisible();
  const ki = BEREICHE.find((b) => b.id === "ki");
  expect(ki.abschnitte.every((a) => ki.unterbereiche.some(([id]) => id === a.unter))).toBe(true);
});

test("Suche: findet jede Zeile von KI & Konten (auch aus anderen Unterbereichen); „In … öffnen“ springt in den richtigen Unterbereich; ein Sprungziel in der Adresse tut dasselbe", async ({ page }) => {
  await start(page, ZWEI());
  await warteKonten(page);
  const ki = BEREICHE.find((b) => b.id === "ki");
  for (const a of ki.abschnitte) for (const z of a.zeilen) {
    await page.fill('[data-einst="suche"]', z.titel);
    await expect(page.locator(`[data-zeile="${z.id}"]`), z.titel).toBeVisible();
  }
  // Treffer im Unterbereich „Zugriff“, die Seite steht auf „Konten“
  await page.fill('[data-einst="suche"]', "Leseverbot");
  await expect(page.locator('[data-zeile="ki-schutz"]')).toBeVisible();
  await expect(page.locator('[data-einst="unter-leiste"]')).toBeHidden(); // in der Suche stehen alle Treffer untereinander
  await page.locator('[data-abschnitt="ki-schutz"] [data-aktion="zeige-im-bereich"]').click();
  await expect(page.locator('[data-einst="suche"]')).toHaveValue("");
  await expect(page.locator('[data-unter-wahl="zugriff"]')).toHaveAttribute("aria-checked", "true");
  await expect(page.locator('[data-zeile="ki-schutz"]')).toBeVisible();
  await expect(page.locator('[data-zeile="ki-schutz"]')).toHaveClass(/blink/);
  // Adresse mit Ziel
  await page.evaluate(() => { location.hash = "#einstellungen/ki?ziel=ki-pflege"; });
  await expect(page.locator('[data-unter-wahl="pflege"]')).toHaveAttribute("aria-checked", "true");
  await expect(page.locator('[data-zeile="ki-pflege"]')).toBeVisible();
  await page.evaluate(() => { location.hash = "#einstellungen/ki?ziel=ki-kontingent"; });
  await expect(page.locator('[data-unter-wahl="kontingent"]')).toHaveAttribute("aria-checked", "true");
});

test("Konten: Abzeichen Aktiv · Anmelden nötig · Abgelaufen, Mini-Balken, Identität nur wenn das Programm sie nennt", async ({ page }) => {
  const opt = { ...ZWEI(), login: { k_aaaa0001: "angemeldet", k_aaaa0004: "nicht-angemeldet", k_aaaa0003: "angemeldet" }, zuletzt: { k_aaaa0004: "2026-10-30T09:00:00.000Z" }, aktiv: { claude: "k_aaaa0001" },
    identitaet: { k_aaaa0001: { email: "jemand@example.invalid", plan: "max" } } };
  const z = await start(page, opt, { kontingent: { k_aaaa0001: ZUSTAND.claudeOk(42, 18), k_aaaa0003: ZUSTAND.codexOk(7, 3) } });
  await warteKonten(page);
  await expect(konto(page, "k_aaaa0001").locator('[data-kk="abzeichen-aktiv"]')).toHaveText("Aktiv");
  await expect(konto(page, "k_aaaa0001").locator('[data-kk="identitaet"]')).toHaveText("jemand@example.invalid · Max");
  await expect(konto(page, "k_aaaa0001").locator('[data-kx="konto-kontingent"] .kt-mini')).toContainText("42");
  await expect(konto(page, "k_aaaa0004").locator(".ez-marke-warn")).toHaveText("Abgelaufen"); // früher angemeldet, jetzt nicht
  await expect(konto(page, "k_aaaa0004").locator('[data-kk="identitaet"]')).toHaveCount(0);
  await expect(konto(page, "k_aaaa0004").locator('[data-kx="konto-kontingent"]')).toContainText("Kein Kontingent");
  await expect(konto(page, "k_aaaa0004").locator('[data-aktion="konto-aktiv"]')).toHaveCount(0); // wer sich anmelden muss, bekommt „Anmelden“ statt „Aktiv setzen“
  await expect(konto(page, "k_aaaa0004").locator('[data-aktion="konto-anmelden"]')).toBeVisible();
  await expect(konto(page, "k_aaaa0003").locator('[data-kk="abzeichen-aktiv"]'), "Codex hat nur ein Konto: aktiv").toHaveText("Aktiv");
  // nichts davon in den Anfragen an die Werkstatt (nur die Zustände) und nichts im lokalen Speicher
  const gesendet = JSON.stringify(z.anfragen.filter((a) => a.pfad !== "/api/ki/anmeldestatus"));
  expect(gesendet).not.toContain("example.invalid");
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain("example.invalid");
  await foto(page, "konten-hell");
});

test("Kontonamen vom Programm zeigen: Schalter aus = die Namen verschwinden und Kortex fragt nicht mehr danach; an = es fragt wieder", async ({ page }) => {
  const z = await start(page, { ...ZWEI(), aktiv: { claude: "k_aaaa0001" }, identitaet: { k_aaaa0001: { email: "jemand@example.invalid", plan: "max" } } });
  await warteKonten(page);
  await expect(konto(page, "k_aaaa0001").locator('[data-kk="identitaet"]')).toBeVisible();
  expect(z.log("/api/ki/anmeldestatus").every((a) => a.body.identitaet === true), "gefragt wird nur mit dem Wunsch nach der Identität").toBe(true);
  await page.fill('[data-einst="suche"]', "Kontonamen");
  const schalter = page.locator('[data-zeile="ki-kontonamen"] [role="switch"]');
  await expect(schalter).toHaveAttribute("aria-checked", "true");
  await schalter.click();
  await expect(schalter).toHaveAttribute("aria-checked", "false");
  await page.fill('[data-einst="suche"]', "");
  await expect(konto(page, "k_aaaa0001").locator('[data-kk="identitaet"]')).toHaveCount(0);
  const vorher = z.log("/api/ki/anmeldestatus").length;
  await page.click('[data-aktion="neu-suchen"]');
  await expect.poll(() => z.log("/api/ki/anmeldestatus").length).toBeGreaterThan(vorher);
  expect(z.log("/api/ki/anmeldestatus").slice(vorher).every((a) => !a.body.identitaet), "aus: es wird nicht mehr danach gefragt").toBe(true);
  await page.fill('[data-einst="suche"]', "Kontonamen");
  await schalter.click();
  await page.fill('[data-einst="suche"]', "");
  await expect(konto(page, "k_aaaa0001").locator('[data-kk="identitaet"]')).toHaveText("jemand@example.invalid · Max");
});

test("Aktives Konto: „Aktiv setzen“ je Programm, gespeichert in ki-konten.json (PUT /api/ki/aktiv), „Gilt ab der nächsten Frage“, Frag und Pflege-Vorschlag folgen, nichts im lokalen Speicher", async ({ page }) => {
  const z = await start(page, { ...ZWEI(), zugriff: { k_aaaa0001: { [vault]: "erweitert", [FIRMA]: "gesperrt" }, k_aaaa0004: { [vault]: "erweitert", [FIRMA]: "gesperrt" }, k_aaaa0003: { [vault]: "posteingang", [FIRMA]: "gesperrt" } } });
  await warteKonten(page);
  await expect(page.locator('[data-kk="abzeichen-aktiv"]')).toHaveCount(1); // nur Codex (ein Konto); Claude hat zwei und noch keine Wahl
  await expect(page.locator('.kx-prog[data-programm="claude"] [data-kx="aktiv-hinweis"]')).toContainText("Gilt ab der nächsten Frage.");
  await konto(page, "k_aaaa0004").locator('[data-aktion="konto-aktiv"]').click();
  expect(z.log("/api/ki/aktiv").at(-1).body).toEqual({ programm: "claude", konto: "k_aaaa0004" });
  await expect(konto(page, "k_aaaa0004").locator('[data-kk="abzeichen-aktiv"]')).toBeVisible();
  await expect(konto(page, "k_aaaa0001").locator('[data-kk="abzeichen-aktiv"]')).toHaveCount(0);
  await expect(page.locator(".toast")).toContainText("Gilt ab der nächsten Frage");
  await expect(konto(page, "k_aaaa0004").locator('[data-aktion="konto-aktiv"]')).toHaveCount(0);
  await konto(page, "k_aaaa0001").locator('[data-aktion="konto-aktiv"]').click();
  expect(z.log("/api/ki/aktiv").at(-1).body).toEqual({ programm: "claude", konto: "k_aaaa0001" });
  await expect(konto(page, "k_aaaa0001").locator('[data-kk="abzeichen-aktiv"]')).toBeVisible();
  expect(z.aktiv.claude).toBe("k_aaaa0001");
  expect(z.aktiv.codex, "je Programm eines: Codex bleibt, wie es war").toBeUndefined();
  // Frag: „Antwortet mit“ zeigt das aktive Konto, eine Änderung dort setzt das aktive Konto
  await unter(page, "pflege");
  const wahl = page.locator('[data-kx="frage-konto-wahl"]');
  await expect(wahl).toContainText("Privat");
  await wahl.click();
  await page.getByRole("option", { name: /Firma/ }).click();
  await expect.poll(() => z.aktiv.claude).toBe("k_aaaa0004");
  // der Vorschlag für die Pflege: das aktive Konto, wenn es „Erweitert“ hat
  await expect(page.locator('[data-kk="pflege-vorschlag"]').first()).toContainText("Vorschlag: das aktive Konto „Firma“");
  await page.locator('[data-aktion="pflege-vorschlag-nehmen"]').first().click();
  expect(z.log("/api/ki/pflege", "POST").at(-1).body).toMatchObject({ konto: "k_aaaa0004" });
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes("frage.konto")))).toEqual([]);
});

test("Aktives Konto: die frühere Wahl im lokalen Speicher wird einmal in ki-konten.json übernommen und gelöscht", async ({ page }) => {
  const z = await start(page, ZWEI(), { hash: "", vorher: { fn: ([k, m, v]) => { if (!localStorage.getItem(m)) localStorage.setItem(k, JSON.stringify(v)); }, arg: [`brain-studio.frage.konto@${vault}`, "brain-studio.konten.aktiv-uebernommen", "k_aaaa0004"] } });
  await expect.poll(() => z.log("/api/ki/aktiv", "PUT").length).toBe(1);
  expect(z.log("/api/ki/aktiv").at(-1).body).toEqual({ programm: "claude", konto: "k_aaaa0004" });
  await expect.poll(() => page.evaluate((v) => localStorage.getItem(`brain-studio.frage.konto@${v}`), vault)).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("brain-studio.konten.aktiv-uebernommen"))).toBe("1");
  // einmal: ein erneutes Laden schreibt nichts mehr
  await page.reload();
  await page.waitForFunction(() => window.__studioBereit === true);
  await page.waitForTimeout(600);
  expect(z.log("/api/ki/aktiv", "PUT")).toHaveLength(1);
  expect(z.aktiv.claude).toBe("k_aaaa0004");
});

test("Entfernen: „Nicht mehr fragen“ wirkt nur beim Bestätigen; danach kein Dialog mehr, der Hinweis führt zur Einstellung zurück", async ({ page }) => {
  const opt = ZWEI();
  opt.konten.push({ ...EIGEN }, { ...EIGEN, id: "k_eigen002", name: "Kunde 2", ordner: EIGEN.ordner + "2", pfad: EIGEN.pfad + "2" });
  opt.login.k_eigen001 = "angemeldet"; opt.login.k_eigen002 = "angemeldet";
  const z = await start(page, opt);
  await warteKonten(page);
  const einstellung = () => page.evaluate(async () => (await (await fetch("/api/einstellungen")).json()).werte.kiKontoEntfernenFragen);
  expect(await einstellung()).toBe(true);
  // abbrechen mit gesetztem Häkchen: nichts wird gemerkt
  await oeffneMenueAn(konto(page, "k_eigen001").locator('[data-aktion="konto-mehr"]'));
  await menueEintrag(page, "konto-entfernen").click();
  const d = dlg(page, "konto-entfernen");
  await d.locator('[data-kx="nicht-mehr-fragen"] input, input[data-kx="nicht-mehr-fragen"]').first().check();
  await foto(page, "entfernen-hell");
  await d.locator("button", { hasText: "Abbrechen" }).click();
  expect(z.log("/api/ki/konto-entfernen")).toHaveLength(0);
  expect(await einstellung()).toBe(true);
  // bestätigen mit Häkchen
  await oeffneMenueAn(konto(page, "k_eigen001").locator('[data-aktion="konto-mehr"]'));
  await menueEintrag(page, "konto-entfernen").click();
  await dlg(page, "konto-entfernen").locator('[data-kx="nicht-mehr-fragen"] input, input[data-kx="nicht-mehr-fragen"]').first().check();
  await dlg(page, "konto-entfernen").locator('[data-aktion="konto-entfernen-ja"]').click();
  await expect(konto(page, "k_eigen001")).toHaveCount(0);
  await expect.poll(einstellung).toBe(false);
  const toast = page.locator(".toast", { hasText: "entfernt" });
  await expect(toast).toContainText("Der Ordner liegt im Papierkorb");
  // zweites Konto: keine Rückfrage mehr
  await oeffneMenueAn(konto(page, "k_eigen002").locator('[data-aktion="konto-mehr"]'));
  await menueEintrag(page, "konto-entfernen").click();
  await expect(konto(page, "k_eigen002")).toHaveCount(0);
  expect(z.log("/api/ki/konto-entfernen")).toHaveLength(2);
  // der Weg zurück: der Hinweis führt zur Einstellung, dort schaltet man die Rückfrage wieder ein
  await page.locator(".toast button, .toast a", { hasText: "Einstellung ansehen" }).first().click();
  const schalter = page.locator('[data-zeile="ki-entfernen-fragen"] [role="switch"]');
  await expect(schalter).toBeVisible();
  await expect(schalter).toHaveAttribute("aria-checked", "false");
  await schalter.click();
  await expect.poll(einstellung).toBe(true);
});

test("Neues Konto: Ordner .neu-<id>, noch nicht in der Liste; Abbruch räumt auf; erst die bestätigte Anmeldung trägt es ein (aktiv, wenn es das erste ist)", async ({ page }) => {
  const opt = ZWEI();
  opt.konten = opt.konten.filter((k) => k.programm !== "claude");
  const z = await start(page, opt);
  await expect(page.locator(".kx-prog").first()).toBeVisible();
  await page.click('[data-aktion="konto-hinzu"][data-programm="claude"]');
  const d = dlg(page, "ki-verbinden");
  await d.locator('[data-kx="neu-name"]').fill("Privat");
  await d.locator('[data-aktion="konto-neu-ok"]').click();
  await expect(d.locator('[data-kv="anmelden"][data-neu="ja"]')).toBeVisible();
  expect(Object.values(z.ausstehend)[0].pfad).toMatch(/\/\.neu-\d{8}$/);
  expect(z.konten.filter((k) => k.programm === "claude")).toHaveLength(0);
  expect(z.log("/api/ki/anmelden").at(-1).body.ordner).toMatch(/\/\.neu-\d{8}$/);
  // Fenster zu = Abbruch
  await page.keyboard.press("Escape");
  await expect(d).toHaveCount(0);
  await expect.poll(() => Object.keys(z.ausstehend).length).toBe(0);
  expect(z.log("/api/ki/konto-abbruch")).toHaveLength(1);
  await expect(page.locator('.kx-konto[data-programm="claude"]')).toHaveCount(0);
  // bestätigte Anmeldung
  await page.click('[data-aktion="konto-hinzu"][data-programm="claude"]');
  await dlg(page, "ki-verbinden").locator('[data-kx="neu-name"]').fill("Privat");
  await dlg(page, "ki-verbinden").locator('[data-aktion="konto-neu-ok"]').click();
  await expect(dlg(page, "ki-verbinden").locator('[data-kv="anmelden"]')).toBeVisible();
  expect(z.log("/api/ki/konto-fertig")).toHaveLength(0);
  z.neuAngemeldet = true;
  await dlg(page, "ki-verbinden").locator('[data-aktion="anmelden-pruefen"]').click();
  await expect.poll(() => z.log("/api/ki/konto-fertig").length).toBe(1);
  await page.keyboard.press("Escape");
  await expect(dlg(page, "ki-verbinden")).toHaveCount(0);
  const neu = z.konten.find((k) => k.name === "Privat");
  await expect(konto(page, neu.id).locator('[data-kk="abzeichen-aktiv"]')).toBeVisible();
  expect(z.aktiv.claude).toBe(neu.id);
});

for (const dunkel of [false, true]) {
  test(`Konten ${dunkel ? "dunkel" : "hell"}: Karten, Abzeichen, Mini-Balken, Segment — nichts läuft über, keine Fehler`, async ({ page }) => {
    const fehler = []; page.on("pageerror", (e) => fehler.push(e.message));
    const opt = { ...ZWEI(), login: { k_aaaa0001: "angemeldet", k_aaaa0004: "nicht-angemeldet", k_aaaa0003: "angemeldet" }, zuletzt: { k_aaaa0004: "2026-10-30T09:00:00.000Z" }, aktiv: { claude: "k_aaaa0001" },
      identitaet: { k_aaaa0001: { email: "jemand@example.invalid", plan: "max" }, k_aaaa0003: { email: "jemand@example.invalid", plan: "plus" } } };
    await start(page, opt, { dunkel, kontingent: { k_aaaa0001: ZUSTAND.claudeOk(42, 18), k_aaaa0003: ZUSTAND.codexOk(7, 3) } });
    await warteKonten(page);
    await expect(konto(page, "k_aaaa0001").locator('[data-kx="konto-kontingent"] .kt-mini')).toBeVisible();
    await foto(page, `konten-${dunkel ? "dunkel" : "hell"}`);
    for (const u of ["zugriff", "kontingent", "pflege"]) { await unter(page, u); await foto(page, `${u}-${dunkel ? "dunkel" : "hell"}`); }
    const breiter = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(breiter).toBe(false);
    expect(fehler).toEqual([]);
  });
}
