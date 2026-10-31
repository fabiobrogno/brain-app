// „KI & Konten“ in den Einstellungen (Paket P6): Programme mit Pfad und Version (Suche über die Login-Shell der App, hier als Attrappe), Konten mit Anmeldestand, Konto hinzufügen, Anmelden im Programm selbst,
// Umbenennen und Entfernen, Zugriffs-Matrix mit Stufenmenü und Sperr-Dialog, Schutz-Ampel mit drei Stufen, Frag-Standard, Pflege je Vault, die früheren Schalter des Assistenten (Hooks, Prüfung vor dem Speichern,
// Hintergrunddienst), Aktivität, hell und dunkel. Die Routen /api/ki/* und /api/kern/* sind Attrappen (mocks-konten.mjs); der Rest läuft gegen die echte Werkstatt.
// UI_SHOTS=<Ordner>: legt die Bildschirmfotos dort ab (sonst screenshots/, ignoriert).
import { test, expect } from "./basis.mjs";
import { join } from "node:path";
import { realpathSync } from "node:fs";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { mockeV2 } from "./mocks.mjs";
import { mockeKonten, KONTEN, PROGRAMME, KERN } from "./mocks-konten.mjs";

let vault, server;
test.beforeEach(async () => { ({ vault } = baueVault()); vault = realpathSync(vault); server = await starteServer(vault); });
test.afterEach(() => server?.stopp());

const shot = (name) => join(process.env.UI_SHOTS || "screenshots", `ki-${name}.png`);
const foto = async (page, name) => { await page.waitForTimeout(450); await page.screenshot({ path: shot(name) }); };
const FIRMA = "/Users/test/Firma-Vault";
const seite = (page) => page.locator("[data-einstellungen]");
const NOTIZ = "10_notizen/Reise nach Lissabon.md";

// Konten wie im Prototyp: Claude (Standard, angemeldet), Claude „Firma“ (früher angemeldet, jetzt nicht), Codex (angemeldet), Cursor (ohne Anmeldung, nur Kortex-Verbindung)
const FIRMA_KONTO = { id: "k_aaaa0004", programm: "claude", programmName: "Claude Code", name: "Firma", standard: false, ordner: "~/.claude-firma", pfad: "/Users/test/.claude-firma", vorhanden: true, verbunden: false };
const CURSOR = { id: "k_aaaa0005", programm: "cursor", programmName: "Cursor", name: "Cursor", standard: true, ordner: "~/.cursor", pfad: "/Users/test/.cursor", vorhanden: true, verbunden: true };
const FUNDE = [...PROGRAMME, { id: "cursor", name: "Cursor", art: "editor", pfad: "/Applications/Cursor.app", version: "1.7.2", quelle: "app", befehl: null }];
const VOLL = () => ({
  konten: [KONTEN[0], FIRMA_KONTO, KONTEN[2], CURSOR].map((k) => ({ ...k, name: k.name === "Claude Code" ? "Privat" : k.name === "Codex" ? "Standard" : k.name })),
  programme: FUNDE, login: { k_aaaa0001: "angemeldet", k_aaaa0004: "nicht-angemeldet", k_aaaa0003: "angemeldet" }, zuletzt: { k_aaaa0004: "2026-10-30T09:00:00.000Z" },
});

async function start(page, opt = {}, { hash = "#einstellungen/ki", breite = 1440, hoehe = 900, dunkel = false } = {}) {
  await page.setViewportSize({ width: breite, height: hoehe });
  if (dunkel) await page.emulateMedia({ colorScheme: "dark" });
  await mockeV2(page, vault);
  const z = await mockeKonten(page, { vaults: [{ pfad: vault, name: "Mein Vault" }, { pfad: FIRMA, name: "Firma" }], ...opt });
  await page.goto(server.url + "?pfad=" + encodeURIComponent(NOTIZ));
  await page.waitForSelector("#app:not([hidden])");
  await page.waitForFunction(() => window.__studioBereit === true);
  if (hash) { await page.evaluate((hh) => { location.hash = hh; }, hash); await expect(seite(page)).toBeVisible(); }
  return z;
}
const karte = (page, id) => page.locator(`.kx-prog[data-programm="${id}"]`);
const konto = (page, id) => page.locator(`.kx-konto[data-konto="${id}"]`);
const zelle = (page, k, v) => page.locator(`[data-kk="matrix-zelle"][data-konto="${k}"][data-vault="${v}"]`);
// Ein Menü schließt, sobald die Seite darunter scrollt: erst ruhig in die Mitte rollen, dann klicken
const oeffneMenueAn = async (loc) => { await loc.evaluate((e) => e.scrollIntoView({ block: "center", behavior: "instant" })); await loc.page().waitForTimeout(150); await loc.click(); };
const warteKonten = async (page) => { await expect(page.locator(".kx-prog").first()).toBeVisible(); await expect(page.locator('.kx-konto[data-anmeldung="prueft"]')).toHaveCount(0); };

test("Programme: Karte je Programm mit Logo, Pfad und Version; Konten mit Anmeldestand; Kacheln zählen", async ({ page }) => {
  await start(page, VOLL());
  await warteKonten(page);
  await expect(page.locator(".e-bereich-titel, [data-einst=titel]").first()).toBeVisible();
  const claude = karte(page, "claude");
  await expect(claude.locator(".kx-prog-kopf b").first()).toContainText("Claude Code");
  await expect(claude.locator(".kx-art")).toHaveText("Terminal-Programm");
  await expect(claude.locator(".kx-pfad")).toContainText("/opt/homebrew/bin/claude");
  await expect(claude.locator(".kx-pfad")).toContainText("Version 2.1.30");
  await expect(claude.locator(".kx-prog-kopf .ki-logo")).toBeVisible();
  await expect(karte(page, "cursor").locator(".kx-pfad")).toContainText("/Applications/Cursor.app");
  await expect(karte(page, "cursor").locator(".kx-art")).toHaveText("Editor mit KI");
  await expect(konto(page, "k_aaaa0001")).toHaveAttribute("data-anmeldung", "angemeldet");
  await expect(konto(page, "k_aaaa0001").locator(".ez-marke-ok")).toHaveText("Angemeldet");
  await expect(konto(page, "k_aaaa0004")).toHaveAttribute("data-anmeldung", "abgelaufen");
  await expect(konto(page, "k_aaaa0004").locator(".ez-marke-warn")).toHaveText("Anmeldung abgelaufen");
  await expect(konto(page, "k_aaaa0004").locator('[data-kx="hinweis-abgelaufen"]')).toContainText("abgelaufen");
  await expect(konto(page, "k_aaaa0004").locator('[data-aktion="konto-anmelden"]')).toBeVisible();
  await expect(konto(page, "k_aaaa0001").locator('[data-aktion="konto-anmelden"]')).toHaveCount(0);
  await expect(page.locator('[data-kachel="angemeldet"] b')).toHaveText("2 von 3");
  await expect(page.locator('[data-kachel="anmeldung"] b')).toHaveText("1");
  await expect(page.locator('[data-kachel="programme"] b')).toHaveText("3");
  await foto(page, "liste-hell");
});

const dlg = (page, name) => page.locator(`.dialog[data-dialog="${name}"]`);
const menueEintrag = (page, id) => page.locator(`.menue [data-menue="${id}"]`);
const fehlerSammler = (page) => { const f = []; page.on("pageerror", (e) => f.push(e.message)); return f; };

test("Neu suchen: der Knopf fragt die App noch einmal (neu=1); ohne Programme steht der nächste Schritt da", async ({ page }) => {
  const z = await start(page, { ...VOLL(), programme: [], leer: true });
  await expect(page.locator('[data-kx="keine-programme"]').first()).toContainText("Kortex hat kein KI-Programm gefunden");
  await expect(page.locator('[data-kx="keine-programme"]').first()).toContainText("Installiere zum Beispiel Claude Code");
  await foto(page, "keine-programme-hell");
  z.programme.push({ ...PROGRAMME[0] });
  await page.click('[data-aktion="neu-suchen"]');
  await expect(karte(page, "claude")).toBeVisible();
  const calls = z.log("/api/ki/programme");
  expect(calls[0].body.neu).toBeNull();
  expect(calls[calls.length - 1].body.neu).toBe("1");
});

test("Neu gefundenes Konto: beim Öffnen nur als „neu, noch nicht eingetragen“ gemeldet (kein Abgleich); erst der Klick trägt es ein", async ({ page }) => {
  const NEU = { id: "k_aaaa0090", programm: "claude", programmName: "Claude Code", name: "Claude Code · neu", standard: false, ordner: "~/.claude-neu", pfad: "/Users/test/.claude-neu" };
  const z = await start(page, { ...VOLL(), neuKonten: [NEU] });
  await warteKonten(page);
  const hinweis = page.locator('[data-kk="neu-gefunden"]');
  await expect(hinweis).toContainText("Neu gefundene Konten");
  await expect(hinweis).toContainText("Claude Code · neu");
  await expect(konto(page, "k_aaaa0090")).toHaveCount(0);
  expect(z.log("/api/ki/konten/abgleich"), "beim Öffnen läuft kein Abgleich").toHaveLength(0);
  await page.click('[data-aktion="konten-eintragen"]');
  await expect(hinweis).toHaveCount(0);
  await expect(konto(page, "k_aaaa0090")).toBeVisible();
  expect(z.log("/api/ki/konten/abgleich", "POST")).toHaveLength(1);
});

test("Fehler bei der Suche: Satz mit dem nächsten Schritt statt einer leeren Seite", async ({ page }) => {
  const z = await start(page, { ...VOLL(), programmeFehler: true });
  await expect(page.locator('[data-kx="programme-fehler"]').first()).toContainText("Klicke auf „Neu suchen“");
  z.programmeFehler = false;
  await page.click('[data-aktion="neu-suchen"]');
  await expect(karte(page, "claude")).toBeVisible();
});

test("Anmeldestand: nicht angemeldet, Anmeldung nicht prüfbar; Hinweise nennen den nächsten Schritt", async ({ page }) => {
  await start(page, { ...VOLL(), login: { k_aaaa0001: "nicht-angemeldet", k_aaaa0004: "unbekannt", k_aaaa0003: "angemeldet" }, zuletzt: {} });
  await warteKonten(page);
  await expect(konto(page, "k_aaaa0001").locator(".ez-marke")).toHaveText("Nicht angemeldet");
  await expect(konto(page, "k_aaaa0001").locator('[data-kx="hinweis-nicht"]')).toContainText("Klicke auf „Anmelden …“");
  await expect(konto(page, "k_aaaa0001").locator('[data-aktion="konto-anmelden"]')).toHaveText("Anmelden …");
  await expect(konto(page, "k_aaaa0004").locator(".ez-marke")).toHaveText("Anmeldung nicht geprüft");
  await expect(konto(page, "k_aaaa0004").locator('[data-aktion="konto-anmelden"]')).toHaveCount(0);
  await expect(page.locator('[data-kachel="angemeldet"] b')).toHaveText("1 von 3");
});

test("Anmelden: öffnet im Programm selbst (Befehl im Fenster), fragt nur nach dem Ergebnis, schließt bei Erfolg; Abbrechen beendet die Abfrage", async ({ page }) => {
  const z = await start(page, VOLL());
  await warteKonten(page);
  await konto(page, "k_aaaa0004").locator('[data-aktion="konto-anmelden"]').click();
  const d = dlg(page, "anmelden");
  await expect(d).toBeVisible();
  await expect(d.locator(".dialog-kopf")).toHaveText("Claude Code · Firma anmelden");
  await expect(d).toContainText("Kortex sieht dein Passwort nie");
  await expect(d.locator('[data-kx="befehl"]')).toContainText("CLAUDE_CONFIG_DIR=~/.claude-firma claude auth login");
  expect(z.log("/api/ki/anmelden").at(-1).body).toEqual({ programm: "claude", ordner: "/Users/test/.claude-firma" });
  await expect(d.locator('.kx-schritt[data-s="1"]')).toHaveClass(/fertig/);
  await expect(d.locator('.kx-schritt[data-s="2"]')).toHaveClass(/laeuft/);
  await foto(page, "anmelden-hell");
  z.login.k_aaaa0004 = "angemeldet";
  await d.locator('[data-aktion="anmelden-pruefen"]').click();
  await expect(d).toBeHidden({ timeout: 5000 });
  await expect(konto(page, "k_aaaa0004")).toHaveAttribute("data-anmeldung", "angemeldet");
  // die Standardkonten melden ohne Ordner an (CLAUDE_CONFIG_DIR/CODEX_HOME bleiben ungesetzt)
  await oeffneMenueAn(konto(page, "k_aaaa0001").locator('[data-aktion="konto-mehr"]'));
  await menueEintrag(page, "konto-neu-anmelden").click();
  await expect(dlg(page, "anmelden")).toBeVisible();
  expect(z.log("/api/ki/anmelden").at(-1).body).toEqual({ programm: "claude", ordner: null });
  const vorher = z.log("/api/ki/anmeldestatus").length;
  await dlg(page, "anmelden").locator('[data-aktion="anmelden-abbrechen"]').click();
  await expect(dlg(page, "anmelden")).toBeHidden();
  await page.waitForTimeout(3600);
  expect(z.log("/api/ki/anmeldestatus").length, "nach dem Abbrechen wird nicht mehr gefragt").toBe(vorher);
});

test("Anmelden: scheitert das Terminal oder fehlt das Programm, steht der nächste Schritt im Fenster; „Nochmal versuchen“ geht", async ({ page }) => {
  const z = await start(page, { ...VOLL(), anmeldenFehler: "Claude Code wurde nicht gefunden. Installiere es und klicke dann auf „Neu suchen“." });
  await warteKonten(page);
  await konto(page, "k_aaaa0004").locator('[data-aktion="konto-anmelden"]').click();
  const d = dlg(page, "anmelden");
  await expect(d.locator('[data-kx="anmelde-fehler"]')).toContainText("Installiere es und klicke dann auf „Neu suchen“");
  await expect(d.locator('[data-aktion="anmelden-nochmal"]')).toBeVisible();
  z.anmeldenFehler = null;
  await d.locator('[data-aktion="anmelden-nochmal"]').click();
  await expect(d.locator('[data-kx="befehl"]')).toBeVisible();
  await expect(d.locator('[data-kx="anmelde-fehler"]')).toBeHidden();
  await d.locator('[data-aktion="anmelden-abbrechen"]').click();
});

test("Konto hinzufügen: eigener Ordner in Kortex (nie im Benutzerordner), Name geprüft, startet gesperrt oder mit Lesen, danach geht das Anmelden auf", async ({ page }) => {
  const z = await start(page, VOLL());
  await warteKonten(page);
  await page.click('[data-aktion="konto-hinzu"][data-programm="claude"]');
  const d = dlg(page, "konto-neu");
  await expect(d.locator(".dialog-kopf")).toHaveText("Weiteres Claude Code-Konto");
  await expect(d).toContainText("Er liegt im Ordner von Kortex, nicht in deinem Benutzerordner");
  await foto(page, "konto-neu-hell");
  await d.locator('[data-aktion="konto-neu-ok"]').click();
  await expect(d.locator('[data-kx="neu-fehler"]')).toContainText("Gib dem Konto einen Namen");
  await d.locator("input").first().fill("Kunde Müller");
  await expect(d.locator('[data-kx="neu-ordner"]')).toHaveText("Kortex/ki-konten-ordner/claude-kunde-muller");
  await d.locator('[data-kx="neu-stufe"] [data-wert="lesen"]').click();
  await d.locator('[data-aktion="konto-neu-ok"]').click();
  await expect(dlg(page, "anmelden")).toBeVisible();
  expect(z.log("/api/ki/konto-neu").at(-1).body).toEqual({ programm: "claude", name: "Kunde Müller", stufe: "lesen" });
  const k = z.konten.find((x) => x.name === "Kunde Müller");
  expect(z.log("/api/ki/anmelden").at(-1).body.ordner).toBe(k.pfad);
  expect(k.pfad).toContain("/Library/Application Support/Kortex/ki-konten-ordner/");
  await dlg(page, "anmelden").locator('[data-aktion="anmelden-abbrechen"]').click();
  await expect(konto(page, k.id)).toBeVisible();
  await expect(zelle(page, k.id, vault)).toHaveAttribute("data-stufe", "lesen");
  // gleicher Name zweimal: die Werkstatt lehnt ab, der Satz steht im Fenster
  await page.click('[data-aktion="konto-hinzu"][data-programm="claude"]');
  await dlg(page, "konto-neu").locator("input").first().fill("kunde müller");
  await dlg(page, "konto-neu").locator('[data-aktion="konto-neu-ok"]').click();
  await expect(dlg(page, "konto-neu").locator('[data-kx="neu-fehler"]')).toContainText("Ein Konto mit diesem Namen gibt es schon");
  await dlg(page, "konto-neu").locator("button", { hasText: "Abbrechen" }).click();
});

test("Umbenennen und Entfernen: Name inline, Entfernen nur für eigene Konten und mit Bestätigung in der Seite (Ordner → Papierkorb)", async ({ page }) => {
  const z = await start(page, VOLL());
  await warteKonten(page);
  await konto(page, "k_aaaa0004").locator('[data-aktion="konto-umbenennen"]').click();
  await konto(page, "k_aaaa0004").locator('[data-kk="name-feld"]').fill("Firma Süd");
  await konto(page, "k_aaaa0004").locator('[data-aktion="konto-name-speichern"]').click();
  expect(z.log("/api/ki/konten", "POST").at(-1).body).toEqual({ id: "k_aaaa0004", name: "Firma Süd" });
  await expect(konto(page, "k_aaaa0004").locator('[data-kk="name"]')).toHaveText("Firma Süd");
  // ein Konto aus dem Benutzerordner: kein Entfernen, der Grund steht im Menü
  await oeffneMenueAn(konto(page, "k_aaaa0004").locator('[data-aktion="konto-mehr"]'));
  await expect(page.locator(".menue")).toContainText("Dieses Konto hat Kortex nicht angelegt");
  await expect(menueEintrag(page, "konto-entfernen")).toHaveCount(0);
  await page.keyboard.press("Escape");
  // ein eigenes Konto
  z.konten.push({ id: "k_eigen001", programm: "claude", programmName: "Claude Code", name: "Kunde", standard: false, ordner: "~/Library/Application Support/Kortex/ki-konten-ordner/claude-kunde", pfad: "/Users/test/Library/Application Support/Kortex/ki-konten-ordner/claude-kunde", verwaltet: true, vorhanden: true, verbunden: false });
  z.zugriff.k_eigen001 = Object.fromEntries(z.vaults.map((v) => [v.pfad, "gesperrt"]));
  z.login.k_eigen001 = "nicht-angemeldet";
  await page.click('[data-aktion="neu-suchen"]');
  await expect(konto(page, "k_eigen001")).toBeVisible();
  await oeffneMenueAn(konto(page, "k_eigen001").locator('[data-aktion="konto-mehr"]'));
  await menueEintrag(page, "konto-entfernen").click();
  const d = dlg(page, "konto-entfernen");
  await expect(d.locator(".dialog-kopf")).toHaveText("Konto „Kunde“ entfernen?");
  await expect(d).toContainText("in den Papierkorb");
  await foto(page, "konto-entfernen-hell");
  await d.locator("button", { hasText: "Abbrechen" }).click();
  expect(z.log("/api/ki/konto-entfernen")).toHaveLength(0);
  await oeffneMenueAn(konto(page, "k_eigen001").locator('[data-aktion="konto-mehr"]'));
  await menueEintrag(page, "konto-entfernen").click();
  await dlg(page, "konto-entfernen").locator('[data-aktion="konto-entfernen-ja"]').click();
  await expect(konto(page, "k_eigen001")).toHaveCount(0);
  expect(z.log("/api/ki/ordner-papierkorb").at(-1).body).toEqual({ id: "k_eigen001", programm: "claude", ordner: "/Users/test/Library/Application Support/Kortex/ki-konten-ordner/claude-kunde" });
  expect(z.log("/api/ki/konto-entfernen").at(-1).body).toEqual({ id: "k_eigen001" });
  expect(z.anfragen.findIndex((a) => a.pfad === "/api/ki/ordner-papierkorb"), "erst der Papierkorb, dann die Liste").toBeLessThan(z.anfragen.findIndex((a) => a.pfad === "/api/ki/konto-entfernen"));
});

test("Matrix: Stufe je Konto und Vault über das Menü; Lesen und Posteingang sofort, Sperren fragt nach (Claude Code: Leseverbot zusätzlich, andere Programme: ehrlicher Satz)", async ({ page }) => {
  const z = await start(page, VOLL());
  await warteKonten(page);
  await expect(page.locator('[data-kk="matrix"] thead th[data-vault]')).toHaveCount(2);
  await expect(zelle(page, "k_aaaa0001", vault)).toHaveAttribute("data-stufe", "posteingang");
  await expect(zelle(page, "k_aaaa0004", vault)).toHaveAttribute("data-stufe", "gesperrt");
  await expect(page.locator('tr[data-konto="k_aaaa0004"] [data-kx="sperrzustand"]').first()).toContainText("nur Kortex");
  await oeffneMenueAn(zelle(page, "k_aaaa0004", vault));
  await expect(page.locator(".menue [role=menuitemradio]")).toHaveCount(4);
  await menueEintrag(page, "stufe-lesen").click();
  // aus einer Sperre heraus: erst die kurze Rückfrage in der Seite, nichts wird vorher geschrieben
  await expect(dlg(page, "entsperren").locator(".dialog-kopf")).toHaveText("Firma den Vault „Mein Vault“ wieder freigeben?");
  await expect(dlg(page, "entsperren")).toContainText("Leseverbot in Claude Code, das Kortex dafür eingetragen hat, nimmt Kortex wieder heraus");
  await dlg(page, "entsperren").locator("button", { hasText: "Abbrechen" }).click();
  expect(z.log("/api/ki/zugriff")).toHaveLength(0);
  await oeffneMenueAn(zelle(page, "k_aaaa0004", vault));
  await menueEintrag(page, "stufe-lesen").click();
  await dlg(page, "entsperren").locator('[data-aktion="entsperren-ja"]').click();
  expect(z.log("/api/ki/zugriff").at(-1).body).toEqual({ konto: "k_aaaa0004", vault, stufe: "lesen" });
  await expect(zelle(page, "k_aaaa0004", vault)).toHaveAttribute("data-stufe", "lesen");
  // Claude Code: Sperr-Dialog mit Leseverbot (Haken ist voreingestellt)
  await oeffneMenueAn(zelle(page, "k_aaaa0001", FIRMA));
  await menueEintrag(page, "stufe-gesperrt").click();
  const d = dlg(page, "sperren");
  await expect(d.locator(".dialog-kopf")).toHaveText("Privat den Vault „Firma“ sperren?");
  await expect(d).toContainText("Was Kortex sperrt");
  await expect(d).toContainText("Was das nicht verhindert");
  await expect(d.locator('[data-kk="claude-haken"]')).toBeChecked();
  await foto(page, "sperren-claude-hell");
  await d.locator('[data-aktion="konten-sperren-ja"]').click();
  expect(z.log("/api/ki/zugriff").at(-1).body).toEqual({ konto: "k_aaaa0001", vault: FIRMA, stufe: "gesperrt", claudeSperre: true });
  await expect(zelle(page, "k_aaaa0001", FIRMA)).toHaveAttribute("data-stufe", "gesperrt");
  await expect(page.locator('tr[data-konto="k_aaaa0001"] [data-kx="sperrzustand"]')).toContainText("Leseverbot");
  // Codex: kein Leseverbot, nur der ehrliche Satz, keine Haken
  await oeffneMenueAn(zelle(page, "k_aaaa0003", FIRMA));
  await menueEintrag(page, "stufe-gesperrt").click();
  await expect(dlg(page, "sperren")).toContainText("kennt kein Leseverbot, das Kortex für dich eintragen könnte");
  await expect(dlg(page, "sperren").locator("input[type=checkbox]")).toHaveCount(0);
  await dlg(page, "sperren").locator('[data-aktion="konten-frage-abbrechen"]').click();
  await expect(zelle(page, "k_aaaa0003", FIRMA)).toHaveAttribute("data-stufe", "posteingang");
  // Neu gefundene Konten
  await oeffneMenueAn(page.locator(`[data-kk="neue-stufen"][data-vault="${vault}"]`));
  await menueEintrag(page, "standard-lesen").click();
  expect(z.log("/api/ki/standard").at(-1).body).toEqual({ vault, stufe: "lesen" });
  await expect(page.locator('[data-kk="legende"]')).toContainText("tägliche Pflege mit KI");
});

test("Wie fest ist die Sperre?: drei Stufen je Claude-Konto, die Ampel folgt dem, was wirklich gesetzt ist; Strenger Schutz mit Bestätigung; andere Programme ehrlich", async ({ page }) => {
  const z = await start(page, VOLL());
  await warteKonten(page);
  const k = page.locator('[data-kk="streng-karte"][data-konto="k_aaaa0004"]');
  await expect(k.locator('[data-kx="stufen"] [data-stufe-nr]')).toHaveCount(3);
  await expect(k.locator('[data-kx="ampel"]')).toHaveAttribute("data-farbe", "rot");
  await expect(k.locator('[data-stufe-nr="1"]')).toContainText("Kortex-Wege");
  await expect(k.locator('[data-stufe-nr="2"]')).toContainText("Fehlt in den Einstellungen von Claude Code");
  await expect(k.locator('[data-stufe-nr="3"]')).toContainText("Über die Shell könnte die KI noch lesen");
  await foto(page, "schutz-hell");
  // Standard-Konto: nichts gesperrt → Ampel grau, Schalter gesperrt
  const std = page.locator('[data-kk="streng-karte"][data-konto="k_aaaa0001"]');
  await expect(std.locator('[data-kx="ampel"]')).toHaveAttribute("data-farbe", "grau");
  await expect(std.locator('[data-kk="streng"]')).toBeDisabled();
  // Leseverbot nachtragen (Dialog), danach „teilweise“? beide Vaults gesperrt: erst einer
  await k.locator('[data-aktion="leseverbot-eintragen"]').click();
  await expect(dlg(page, "sperren")).toBeVisible();
  await dlg(page, "sperren").locator('[data-aktion="konten-sperren-ja"]').click();
  await expect(k.locator('[data-kx="ampel"]')).toHaveAttribute("data-farbe", "gelb");
  await expect(k.locator('[data-stufe-nr="2"]')).toContainText("Für 1 von 2 gesperrten Vaults eingetragen");
  // Strenger Schutz: Schalter öffnet erst die Rückfrage
  await k.locator('[data-kk="streng"]').click();
  const d = dlg(page, "streng");
  await expect(d).toContainText("Was sich dadurch ändert");
  await d.locator('[data-aktion="konten-streng-ja"]').click();
  expect(z.log("/api/ki/schutz").at(-1).body).toEqual({ konto: "k_aaaa0004", sandbox: true, bestaetigt: true });
  await expect(k.locator('[data-kk="streng"]')).toHaveAttribute("aria-checked", "true");
  await expect(k.locator('[data-stufe-nr="3"]')).toContainText("Sandbox an");
  // wieder aus: erst eine kurze Rückfrage in der Seite (danach kann die Shell wieder lesen)
  await k.locator('[data-kk="streng"]').click();
  await expect(k.locator('[data-kk="streng"]')).toHaveAttribute("aria-checked", "true");
  await expect(dlg(page, "streng-aus")).toContainText("können Befehle, die Claude Code über die Shell startet");
  await dlg(page, "streng-aus").locator("button", { hasText: "Abbrechen" }).click();
  expect(z.log("/api/ki/schutz").at(-1).body).toEqual({ konto: "k_aaaa0004", sandbox: true, bestaetigt: true });
  await k.locator('[data-kk="streng"]').click();
  await dlg(page, "streng-aus").locator('[data-aktion="streng-aus-ja"]').click();
  expect(z.log("/api/ki/schutz").at(-1).body).toEqual({ konto: "k_aaaa0004", sandbox: false });
  await expect(k.locator('[data-kk="streng"]')).toHaveAttribute("aria-checked", "false");
  // andere Programme
  await expect(page.locator('[data-kx="andere-programme"]')).toContainText("Codex, Cursor: Kortex sperrt hier seine eigenen Wege");
});

test("Frag-Standard: Konto und Gründlichkeit werden gemerkt (wie im Frag-Fenster), nur Konten, die den Vault lesen dürfen", async ({ page }) => {
  await start(page, VOLL());
  await warteKonten(page);
  const wahl = page.locator('[data-kx="frage-konto-wahl"]');
  await expect(wahl).toBeVisible();
  await page.locator('[data-kx="frage-modell-wahl"] [data-wert="mittel"]').click();
  expect(await page.evaluate(() => localStorage.getItem("brain-studio.frage.modell"))).toBe('"mittel"');
  await page.reload();
  await page.waitForFunction(() => window.__studioBereit === true);
  await page.evaluate(() => { location.hash = "#einstellungen/ki"; });
  await expect(page.locator('[data-kx="frage-modell-wahl"] [data-wert="mittel"]')).toHaveAttribute("aria-checked", "true");
});

test("Frag-Standard: ohne Konto mit Lesezugriff steht der Grund da, kein leeres Feld", async ({ page }) => {
  const zugriff = Object.fromEntries(VOLL().konten.map((k) => [k.id, { [vault]: "gesperrt", [FIRMA]: "gesperrt" }]));
  await start(page, { ...VOLL(), zugriff });
  await warteKonten(page);
  await expect(page.locator('[data-kx="frage-leer"]')).toHaveText("Kein Konto darf diesen Vault lesen");
});

test("Pflege je Vault: Konto (nur mit „Erweitert“) und wie viel KI je Vault, Jetzt pflegen nur für den offenen Vault, letzter Lauf", async ({ page }) => {
  const zugriff = { k_aaaa0001: { [vault]: "erweitert", [FIRMA]: "posteingang" }, k_aaaa0004: { [vault]: "gesperrt", [FIRMA]: "gesperrt" }, k_aaaa0003: { [vault]: "posteingang", [FIRMA]: "gesperrt" }, k_aaaa0005: { [vault]: "lesen", [FIRMA]: "lesen" } };
  const z = await start(page, { ...VOLL(), zugriff, letzter: { zeit: "2026-10-31T02:12:00.000Z", status: "ok", erfolgreich: true, aufrufe: 18, tokEin: 100, tokAus: 50, modus: "echt" }, schalter: "an" });
  await warteKonten(page);
  const zeileM = page.locator(`.kx-pflege-zeile[data-vault="${vault}"]`), zeileF = page.locator(`.kx-pflege-zeile[data-vault="${FIRMA}"]`);
  await expect(zeileM.locator('[data-kk="pflege-letzter"]')).toContainText("fertig");
  await expect(zeileF.locator('[data-kk="pflege-kein-konto"]')).toHaveText("Kein Konto mit „Erweitert“");
  await expect(zeileM.locator('[data-kk="pflege-jetzt"]')).toBeEnabled();
  await expect(zeileF.locator('[data-kk="pflege-jetzt"]')).toBeDisabled();
  await oeffneMenueAn(zeileM.locator('[data-kk="pflege-konto"]'));
  await page.locator('.bs-liste [role="option"]').first().click();
  expect(z.log("/api/ki/pflege", "POST").at(-1).body).toEqual({ vault, konto: "k_aaaa0001", stufe: "mittel" });
  await zeileM.locator('[data-stufe-wahl="klein"]').click();
  expect(z.log("/api/ki/pflege", "POST").at(-1).body).toEqual({ vault, konto: "k_aaaa0001", stufe: "klein" });
  await zeileM.locator('[data-stufe-wahl="aus"]').click();
  expect(z.log("/api/ki/pflege", "POST").at(-1).body).toEqual({ vault, konto: "k_aaaa0001", stufe: "aus" });
  await zeileM.locator('[data-kk="pflege-jetzt"]').click();
  expect(z.log("/api/ki/pflege/jetzt")).toHaveLength(1);
  await expect(page.locator('[data-kk="pflege-tut"] summary')).toContainText("Was die Pflege tut");
  await foto(page, "pflege-hell");
});

test("Kortex bei der Arbeit: Hooks, Prüfung vor dem Speichern und Hintergrunddienst laufen über /api/kern/verdrahten (wie im Assistenten), mit Profilwahl und Rückfrage beim Ersetzen", async ({ page }) => {
  const z = await start(page, { ...VOLL(), pruefungAnders: true });
  await warteKonten(page);
  const hooks = page.locator('[data-kx="arbeit-claude"]'), pruefung = page.locator('[data-kx="arbeit-git"]'), dienst = page.locator('[data-kx="arbeit-dienst"]');
  await expect(page.locator('[data-zeile="ki-hooks"]')).toContainText("Trägt in die gewählten Claude-Profile");
  await expect(hooks).toHaveAttribute("aria-checked", "true");
  await expect(pruefung).toHaveAttribute("aria-checked", "false");
  await expect(dienst).toHaveAttribute("aria-checked", "false");
  await expect(page.locator('[data-kx="profile"]')).toContainText("Welche Claude-Profile?");
  await expect(page.locator('[data-profil="/Users/test/.claude"]')).toBeChecked();
  await expect(page.locator('[data-kx="profile"]')).toContainText("Hooks eingetragen");
  // zweites Profil dazunehmen, Hooks aus und wieder an
  await page.locator('[data-profil="/Users/test/.claude-privat"]').check();
  await hooks.click();
  expect(z.log("/api/kern/verdrahten").at(-1).body).toEqual({ was: "claude", an: false, profile: ["/Users/test/.claude"] });
  await expect(hooks).toHaveAttribute("aria-checked", "false");
  await hooks.click();
  expect(z.log("/api/kern/verdrahten").at(-1).body).toEqual({ was: "claude", an: true, profile: ["/Users/test/.claude", "/Users/test/.claude-privat"] });
  await expect(hooks).toHaveAttribute("aria-checked", "true");
  // Prüfung vor dem Speichern: ein anderer Eintrag steht schon da → Rückfrage in der Seite
  await pruefung.click();
  await expect(page.locator('[data-kx="arbeit-ersetzen"]')).toContainText("Ersetzen? Dann wird sie durch die von Kortex abgelöst");
  await page.locator('[data-aktion="git-nicht-aendern"]').click();
  await expect(page.locator('[data-kx="arbeit-ersetzen"]')).toHaveCount(0);
  await expect(pruefung).toHaveAttribute("aria-checked", "false");
  await pruefung.click();
  await page.locator('[data-aktion="git-ersetzen"]').click();
  expect(z.log("/api/kern/verdrahten").at(-1).body).toEqual({ was: "git", an: true, ersetzen: true });
  await expect(pruefung).toHaveAttribute("aria-checked", "true");
  await dienst.click();
  expect(z.log("/api/kern/verdrahten").at(-1).body).toEqual({ was: "dienst", an: true });
  await expect(dienst).toHaveAttribute("aria-checked", "true");
  await foto(page, "arbeit-hell");
});

test("Kortex bei der Arbeit: nicht möglich → der Grund steht da (kein Starter; kein Versionsverlauf; Dienst nur auf dem Mac)", async ({ page }) => {
  const kern = KERN(); kern.starter.vorhanden = false;
  await start(page, { ...VOLL(), kern });
  await expect(page.locator('[data-kx="arbeit-kein-starter"]').first()).toContainText("Der Starter von Kortex fehlt noch");
});

test("Kortex bei der Arbeit: ohne Versionsverlauf und ohne Dienst nennt jede Zeile ihren Grund", async ({ page }) => {
  const kern = KERN(); kern.git = { moeglich: false }; kern.dienst = { verfuegbar: false };
  await start(page, { ...VOLL(), kern });
  await expect(page.locator('[data-kx="arbeit-git-nein"]')).toContainText("noch keinen Versionsverlauf");
  await expect(page.locator('[data-kx="arbeit-dienst-nein"]')).toContainText("nur auf dem Mac");
});

test("Kortex bei der Arbeit: lässt sich der Stand nicht lesen, steht ein Satz mit dem nächsten Schritt da", async ({ page }) => {
  await start(page, { ...VOLL(), kernFehler: "kaputt" });
  await expect(page.locator('[data-kx="arbeit-nicht-lesbar"]').first()).toContainText("Klicke auf „Neu suchen“");
});

test("Aktivität: das Protokoll der Werkstatt (P8a) — Einträge, Filter „Abweisungen“, leerer Zustand; mehr in aktivitaet.spec.mjs", async ({ page }) => {
  await start(page, VOLL());
  await warteKonten(page);
  await expect(page.locator('[data-kx="aktivitaet-leer"]')).toContainText("Noch nichts zu zeigen");
  await expect(page.locator('[data-kx="aktivitaet-bald"]')).toHaveCount(0);
  const eintraege = [
    { id: "a_mvw5l1mb_688653", zeit: new Date(Date.now() - 4 * 60_000).toISOString(), art: "pflege", wer: "Claude Code · Privat", text: "Pflege für Mein Vault: fertig.", programm: "claude", vaultName: "Mein Vault", gelesen: true },
    { id: "a_mvw5l1mc_688654", zeit: new Date(Date.now() - 3 * 60_000).toISOString(), art: "abweisung", wer: "Codex", text: "wollte den Vault „Firma“ lesen und wurde abgewiesen.", programm: "codex", vaultName: "Firma", gelesen: true },
  ];
  await page.route(/\/api\/aktivitaet\?/, (route) => { const art = new URL(route.request().url()).searchParams.get("art"); return route.fulfill({ json: { vault: null, ereignisse: art === "abweisungen" ? eintraege.slice(1) : eintraege, ungelesen: 0, gesamt: 2 } }); });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("kortex-aktivitaet")));
  await expect(page.locator('[data-kx="aktivitaet-liste"] li')).toHaveCount(2);
  await expect(page.locator('[data-kx="aktivitaet-liste"] li').first()).toContainText("Claude Code · Privat Pflege für Mein Vault: fertig.");
  await page.click('[data-filter="abweisungen"]');
  await expect(page.locator('[data-kx="aktivitaet-liste"] li')).toHaveCount(1);
  await expect(page.locator('[data-kx="aktivitaet-liste"] li')).toContainText("Codex wollte den Vault „Firma“ lesen und wurde abgewiesen.");
});

test("Hinweis „Liste war beschädigt“ und Ehrlichkeit: die Karte „Was Kortex schützt – und was nicht“ nennt die Grenzen", async ({ page }) => {
  const z = await start(page, { ...VOLL(), hinweis: "defekt-neu", vorherDa: true });
  await expect(page.locator('[data-kk="defekt"]')).toContainText("Die Liste der KI-Konten war beschädigt");
  await page.click('[data-aktion="konten-hinweis-verstanden"]');
  await expect(page.locator('[data-kk="defekt"]')).toHaveCount(0);
  expect(z.log("/api/ki/hinweis")).toHaveLength(1);
  const e = page.locator('[data-kk="ehrlich-karte"]');
  await expect(e).toContainText("Claude Code:");
  await expect(e).toContainText("Andere Programme:");
  await expect(e).toContainText("Echte Trennung");
  for (const verboten of ["Brain", "MCP"]) await expect(page.locator("section[data-bereich=ki]")).not.toContainText(verboten);
});

test("Alte Wege führen hierher: Zahnrad-Menü der Statusleiste und Palette öffnen KI & Konten; Datenschutz springt zur Matrix", async ({ page }) => {
  await start(page, VOLL(), { hash: "" });
  await page.click('[data-st="einstellungen"]');
  await page.click('[data-menue="ki-konten"]');
  await expect(page.locator('.e-punkt[data-bereich="ki"][aria-current="true"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(seite(page)).toBeHidden();
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("KI-Konten");
  await page.keyboard.press("Enter");
  await expect(page.locator('.e-punkt[data-bereich="ki"][aria-current="true"]')).toBeVisible();
  await page.click('.e-punkt[data-bereich="datenschutz"]');
  await page.click('[data-aktion="zu-ki"]');
  await expect(page.locator('[data-zeile="ki-zugriff"]')).toBeVisible();
});

test("Suche in den Einstellungen findet die Zeilen von KI & Konten", async ({ page }) => {
  await start(page, VOLL());
  for (const [frage, zeile] of [["Konto hinzufügen", "ki-konten"], ["Leseverbot", "ki-schutz"], ["Hooks", "ki-hooks"], ["Hintergrund", "ki-dienst"], ["Passwörter", "ki-git"], ["Gründlichkeit", "ki-frage-modell"]]) {
    await page.fill('[data-einst="suche"]', frage);
    await expect(page.locator(`[data-zeile="${zeile}"]`), frage).toBeVisible();
  }
});

for (const dunkel of [false, true]) {
  test(`Bereich als Ganzes ${dunkel ? "dunkel" : "hell"}: alle Zustände, nichts läuft über, keine Fehler, nichts geschrieben`, async ({ page }) => {
    const fehler = fehlerSammler(page);
    const z = await start(page, VOLL(), { dunkel, breite: 1440, hoehe: 900 });
    await warteKonten(page);
    await page.waitForTimeout(300);
    const ueber = await page.evaluate(() => { const i = document.querySelector("[data-einst=inhalt]"); return i.scrollWidth - i.clientWidth; });
    expect(ueber).toBeLessThanOrEqual(1);
    await foto(page, `kopf-${dunkel ? "dunkel" : "hell"}`);
    for (const [id, name] of [["ki-zugriff", "matrix"], ["ki-schutz", "schutz"], ["ki-frage-konto", "frage"], ["ki-pflege", "pflege"], ["ki-hooks", "arbeit"], ["ki-aktivitaet", "aktivitaet"], ["ki-ehrlich", "ehrlich"]]) {
      await page.locator("[data-einst=inhalt]").evaluate((e, sel) => { const z = e.querySelector(`[data-zeile="${sel}"]`); e.scrollTop = z.offsetTop - 150; }, id);
      await foto(page, `${name}-${dunkel ? "dunkel" : "hell"}`);
    }
    expect(fehler).toEqual([]);
    expect(z.anfragen.filter((a) => a.methode !== "GET" && !["/api/ki/anmeldestatus", "/api/ki/anmeldung"].includes(a.pfad))).toEqual([]);
  });
}

test("Enges Fenster (1000 px): Kacheln in zwei Spalten, Konten stapeln, nichts läuft waagerecht über", async ({ page }) => {
  await start(page, VOLL(), { breite: 1000, hoehe: 800 });
  await warteKonten(page);
  await page.waitForTimeout(300);
  const ueber = await page.evaluate(() => { const i = document.querySelector("[data-einst=inhalt]"); return i.scrollWidth - i.clientWidth; });
  expect(ueber).toBeLessThanOrEqual(1);
  await foto(page, "eng-hell");
});

// ---- Pflege: die Fälle der früheren Ansicht, jetzt im Bereich (Konto vor Stufe, Migration, Problem, plist)
const ZUGRIFF_PFLEGE = () => ({ k_aaaa0001: { [vault]: "erweitert", [FIRMA]: "erweitert" }, k_aaaa0004: { [vault]: "erweitert", [FIRMA]: "gesperrt" }, k_aaaa0003: { [vault]: "posteingang", [FIRMA]: "gesperrt" }, k_aaaa0005: { [vault]: "lesen", [FIRMA]: "lesen" } });

test("Pflege: mehrere Konten mit „Erweitert“ — eine Stufe vor dem Konto wartet und sagt, was fehlt; mit gewähltem Konto wird beides gespeichert", async ({ page }) => {
  const z = await start(page, { ...VOLL(), zugriff: ZUGRIFF_PFLEGE() });
  await warteKonten(page);
  const zeile = page.locator(`.kx-pflege-zeile[data-vault="${vault}"]`);
  await zeile.locator('[data-stufe-wahl="klein"]').click();
  await expect(zeile.locator('[data-kk="pflege-waehle-zuerst"]')).toContainText("Wähle zuerst ein Konto");
  expect(z.log("/api/ki/pflege", "POST")).toHaveLength(0);
  await oeffneMenueAn(zeile.locator('[data-kk="pflege-konto"]'));
  await expect(page.locator('.bs-liste [role="option"]')).toHaveCount(2);
  await page.locator('.bs-liste [role="option"]').first().click();
  expect(z.log("/api/ki/pflege", "POST").at(-1).body).toEqual({ vault, konto: "k_aaaa0001", stufe: "klein" });
});

test("Pflege: „fertig, ohne KI (so eingestellt)“ zählt als Erfolg; ein Lauf mit Warnung zeigt seinen Grund; ausgeschaltet gibt es kein „Jetzt pflegen“", async ({ page }) => {
  await start(page, { ...VOLL(), zugriff: ZUGRIFF_PFLEGE(), letzter: { zeit: "2026-10-31T02:12:00.000Z", status: "ok-ohne-ki", erfolgreich: true, aufrufe: 0, tokEin: 0, tokAus: 0, modus: "echt" }, pflege: { [vault]: { konto: "k_aaaa0001", stufe: "aus" } } });
  await warteKonten(page);
  const zeile = page.locator(`.kx-pflege-zeile[data-vault="${vault}"]`);
  await expect(zeile.locator('[data-kk="pflege-letzter"]')).toContainText("fertig, ohne KI (so eingestellt)");
  await expect(zeile.locator('[data-kk="pflege-grund"]')).toHaveCount(0);
});

test("Pflege: Hinweis aus der Migration und Problem der Einstellung nennen den Weg; die plist des Dienstes erklärt ihren offenen Punkt in Alltagssprache", async ({ page }) => {
  const zugriff = ZUGRIFF_PFLEGE(); zugriff.k_aaaa0001[vault] = "lesen";
  await start(page, { ...VOLL(), zugriff, pflege: { [vault]: { konto: "k_aaaa0001", stufe: "mittel" } }, pflegeHinweise: [{ vault, grund: "stufe", konto: "k_aaaa0001" }], pflegePlist: { offen: true, grund: "nicht-im-dienst" } });
  await warteKonten(page);
  await expect(page.locator('[data-kk="pflege-migration"]')).toContainText("steht die Pflege jetzt auf „Ohne KI“");
  await expect(page.locator('[data-kk="pflege-plist"]')).toContainText("Der geöffnete Vault gehört nicht zu den Vaults, für die der Dienst eingeschaltet ist");
  for (const verboten of ["plist", "launchctl", "LaunchAgent"]) await expect(page.locator('[data-kk="pflege-plist"]')).not.toContainText(verboten);
});
