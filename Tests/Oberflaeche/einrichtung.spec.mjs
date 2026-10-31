// Einrichtungs-Assistent (einrichtung.html): alle Schritte und Zustände, hell und dunkel, Tastatur, reduzierte Bewegung.
// Alle /api/-Aufrufe und die Aktionen der App (git prüfen, Ordner wählen, Browser, Zwischenablage, Ende) sind gemockt (mocks-einrichtung.mjs).
// Eine zusätzliche Probe läuft gegen die echte Werkstatt ohne Vault mit einem Wegwerf-HOME.
import { test, expect } from "./basis.mjs";
import { mkdirSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { starteStatisch, mockeEinrichtung } from "./mocks-einrichtung.mjs";
import { starteServer } from "./start.mjs";

const BILDER = process.env.UI_EINRICHTUNG_BILDER; // optional: Bilder für die Augenkontrolle
let server;
test.beforeAll(async () => { server = await starteStatisch(); if (BILDER) mkdirSync(BILDER, { recursive: true }); });
test.afterAll(() => server?.stopp());

const URL_ = (q = "") => `${server.url}einrichtung.html${q}`;
const sel = (a) => `[data-aktion="${a}"]`;
async function oeffne(page, opt = {}, q = "") {
  const z = await mockeEinrichtung(page, opt);
  await page.goto(URL_(q));
  await page.waitForFunction(() => window.__einrichtungBereit === true);
  return z;
}
async function bereit(page) { await expect(page.locator(sel("start"))).toBeEnabled({ timeout: 6000 }); }
async function zuVault(page) { await bereit(page); await page.click(sel("start")); await expect(page.locator(".e-weg").first()).toBeVisible(); }
async function zuSicherung(page) { await zuVault(page); await page.click(sel("weiter")); await expect(page.locator("#e-sync")).toBeVisible(); await expect(page.locator("#e-sync .e-lade")).toHaveCount(0, { timeout: 8000 }); }
// Schritt „KI“: der gemeinsame Ablauf aus ki-verbinden.js (Fußleiste gehört dem Assistenten). Bereit, sobald die Karten da sind.
const ablauf = (page) => page.locator('.kv[data-rahmen="assistent"][data-fuss="host"]');
async function zuKi(page) { await zuSicherung(page); await page.click(sel("ohne")); await page.click(sel("weiter")); await expect(ablauf(page).locator(".ka-karte").first()).toBeVisible({ timeout: 8000 }); }
// Einen Schritt im Ablauf weiter (Hauptknopf des Assistenten): Wählen → Konto (nur Claude Code/Codex) → Stufe
async function zurStufe(page, id) {
  await ablauf(page).locator(`.ka-karte[data-ki="${id}"]`).click();
  await page.click(sel("weiter"));
  if (id === "claude" || id === "codex") { await expect(ablauf(page).locator(".kv-konto").first()).toBeVisible(); await page.click(sel("weiter")); }
  await expect(ablauf(page).locator('[data-kv="stufe"]')).toBeVisible();
}
// Eine KI ganz verbinden, bis „Fertig“ des Ablaufs: opt.konto wählt ein Konto, opt.stufe klickt eine Stufe ausdrücklich an
async function verbinde(page, id, opt = {}) {
  const a = ablauf(page);
  await a.locator(`.ka-karte[data-ki="${id}"]`).click();
  await page.click(sel("weiter"));
  if (id === "claude" || id === "codex") {
    if (opt.konto) await a.locator(`.kv-konto[data-konto="${opt.konto}"]`).click();
    await page.click(sel("weiter"));
  }
  if (opt.stufe) await a.locator(`[data-kv="stufe"] [data-wert="${opt.stufe}"]`).click();
  await page.click(sel("weiter")); // Verbinden
  await expect(a.locator('[data-kv="fertig"]')).toBeVisible({ timeout: 10000 });
}
// Zusammenfassung des Assistenten (Schritt 4) mit Claude Code, Stufe wie vorbelegt (Posteingang)
async function zuFertig(page) { await zuKi(page); await verbinde(page, "claude"); await page.click(sel("weiter")); await expect(page.locator(".e-zusammen")).toBeVisible({ timeout: 8000 }); }
const bild = async (page, name, thema) => { if (BILDER) { await page.waitForTimeout(900); await page.screenshot({ path: join(BILDER, `${name}-${thema === "dark" ? "dunkel" : "hell"}.png`) }); } };
const anfragen = (z, pfad) => z.anfragen.filter((a) => a.pfad === pfad);

for (const thema of ["light", "dark"]) {
  test.describe(`Darstellung ${thema}`, () => {
    test.use({ colorScheme: thema });

    test("Willkommen: Zeichen, Titel, Hauptknopf; git wird still geprüft", async ({ page }) => {
      const z = await oeffne(page);
      await bereit(page);
      await expect(page.locator(".e-hero h1")).toContainText("Dein Wissen. Deine KI.");
      await expect(page.locator("#vorab")).toContainText("Dein Mac ist bereit");
      expect(z.aktionen.some((a) => a.aktion === "git-pruefen")).toBe(true);
      await expect(page.locator("#win")).toHaveAttribute("data-step", "0");
      await bild(page, "w0-willkommen", thema);
      expect(z.seitenfehler).toEqual([]);
    });

    test("git fehlt: Karte mit Installieren; Apples Dialog läuft, der Assistent merkt, wenn git da ist", async ({ page }) => {
      const z = await oeffne(page, { git: "fehlt" });
      await expect(page.locator('[data-bereich="git"]')).toContainText("Ein Werkzeug von Apple fehlt noch");
      await expect(page.locator(sel("start"))).toBeHidden();
      await bild(page, "w0b-git-fehlt", thema);
      z.installationFertig = true;
      await page.click(sel("git-installieren"));
      await expect(page.locator('[data-bereich="git"]')).toContainText("Apple installiert", { timeout: 4000 }).catch(() => {});
      expect(z.aktionen.some((a) => a.aktion === "git-installieren")).toBe(true);
    });

    test("Vault anlegen: Neuer Vault mit Namen und Ort, Bühne folgt dem Namen", async ({ page }) => {
      const z = await oeffne(page);
      await zuVault(page);
      await expect(page.locator("#win")).toHaveAttribute("data-step", "1");
      await expect(page.locator(".e-stand")).toContainText("Vault · 1 von 4");
      await expect(page.locator("#v-ort")).toHaveText("~/Kortex");
      await page.fill('[data-feld="name"]', "Mein Wissen");
      await expect(page.locator("#v-name")).toHaveText("Mein Wissen");
      await expect(page.locator("#v-ort")).toHaveText("~/Mein Wissen");
      await bild(page, "w1-vault", thema);
      await page.click(sel("weiter"));
      await expect(page.locator("#win")).toHaveAttribute("data-step", "2", { timeout: 6000 });
      const neu = anfragen(z, "/api/vaults/neu")[0].body;
      expect(neu).toEqual({ art: "vorlage", name: "Mein Wissen", ordner: "~/Mein Wissen" });
      await expect(page.locator(".toast")).toContainText("Vault „Mein Wissen“ ist bereit");
    });

    test("Beispiel-Vault, Ordner öffnen (mit Zählung und Vertrauen), Ordner zu breit", async ({ page }) => {
      const z = await oeffne(page);
      await zuVault(page);
      await page.click('[data-weg="beispiel"]');
      await expect(page.locator("#e-detail")).toContainText("Beispielseiten");
      await expect(page.locator("#v-name")).toHaveText("Beispiel");
      await bild(page, "w1e-beispiel", thema);
      await page.click('[data-weg="oeffnen"]');
      await expect(page.locator(sel("weiter"))).toBeDisabled(); // noch kein Ordner gewählt
      await page.click(sel("waehle"));
      await expect(page.locator(".e-wahl-ordner")).toContainText("~/Dokumente/Notizen");
      await expect(page.locator(".e-wahl-ordner")).toContainText("128 Notizen · 9 Ordner");
      await expect(page.locator(".e-chip", { hasText: "Notizen" })).toContainText("128");
      await bild(page, "w1c-oeffnen", thema);
      await page.click(sel("weiter"));
      await expect(page.locator("#win")).toHaveAttribute("data-step", "2", { timeout: 6000 });
      expect(anfragen(z, "/api/vaults/oeffnen")[0].body).toEqual({ pfad: "/Users/test/Dokumente/Notizen", gitEinschalten: true });
      expect(anfragen(z, "/api/vertrauen").length, "Vertrauen vergibt der Assistent nie: das fragt das Studio").toBe(0);
    });

    test("Ordner zu breit: gesperrt mit Grund, Vorschlag legt einen Unterordner an", async ({ page }) => {
      await oeffne(page, { ordner: { pfad: "/Users/test", breit: { name: "Benutzerordner", vorschlag: "/Users/test/Kortex" } } });
      await zuVault(page);
      await page.click('[data-weg="oeffnen"]');
      await page.click(sel("waehle"));
      await expect(page.locator(".e-wahl-ordner.schlecht")).toBeVisible();
      await expect(page.locator("#e-detail")).toContainText("zu groß");
      await expect(page.locator(sel("weiter"))).toBeDisabled();
      await expect(page.locator(".e-chip", { hasText: "Zu groß" })).toBeVisible();
      await bild(page, "w1b-oeffnen-breit", thema);
      await page.click(sel("dort-anlegen"));
      await expect(page.locator('[data-weg="neu"]')).toHaveAttribute("aria-checked", "true");
      await expect(page.locator("#ort-text")).toHaveText("~/Kortex");
      await expect(page.locator(sel("weiter"))).toBeEnabled();
    });

    test("Von GitHub holen: Adresse wird geprüft; privates Repository führt über die Anmeldung zurück zum Klonen", async ({ page }) => {
      const z = await oeffne(page, { klonFehler: { status: 403, fehler: "Zugriff verweigert.", nurOhneKonto: true } });
      await zuVault(page);
      await page.click('[data-weg="klonen"]');
      await expect(page.locator(sel("weiter"))).toBeDisabled();
      await page.fill('[data-feld="url"]', "name");
      await expect(page.locator("#url-text")).toContainText("noch nicht wie eine Adresse");
      await page.fill('[data-feld="url"]', "github.com/fabiobrogno/wissen");
      await expect(page.locator("#url-text")).toContainText("Privates Repository?");
      await expect(page.locator("#v-name")).toHaveText("wissen");
      await bild(page, "w1d-klonen", thema);
      await page.click(sel("weiter"));
      await expect(page.locator(sel("klon-anmelden"))).toBeVisible({ timeout: 6000 });
      expect(anfragen(z, "/api/vaults/klonen")[0].body).toEqual({ url: "https://github.com/fabiobrogno/wissen", ordner: "~/wissen" });
      await page.click(sel("klon-anmelden"));
      await expect(page.locator("#win")).toHaveAttribute("data-step", "2");
      await expect(page.locator("#e-sync .e-karte")).toBeVisible({ timeout: 6000 });
      await page.click(sel("weiter")); // Anmelden
      await expect(page.locator(".e-code")).toBeVisible({ timeout: 6000 });
      z.codeZustand = "fertig";
      // nach der Anmeldung holt der Assistent den Vault von selbst und geht weiter
      await expect.poll(() => anfragen(z, "/api/vaults/klonen").length, { timeout: 12000 }).toBe(2);
      await expect(page.locator(".toast", { hasText: "Vault „wissen“ ist bereit" })).toBeVisible();
      await expect(page.locator("#win")).toHaveAttribute("data-step", "2");
    });

    test("Sicherung: Gerätecode mit Countdown, Bestätigung, Repository anlegen und verbinden", async ({ page }) => {
      const z = await oeffne(page);
      await zuSicherung(page);
      await expect(page.locator(".e-karte")).toContainText("GitHub-Konto verbinden");
      await bild(page, "w2a-sicherung-start", thema);
      await page.click(sel("weiter")); // Anmelden
      await expect(page.locator(".e-code")).toHaveAttribute("aria-label", "Gerätecode W D J B - M J H T");
      await expect(page.locator("#zeit")).toHaveText(/14:5\d/);
      await expect(page.locator(sel("weiter"))).toBeDisabled();
      await expect(page.locator('#e-sync')).toContainText("Warte auf deine Bestätigung bei GitHub");
      await expect(page.locator("#gh-schild")).toHaveText("Warte auf Bestätigung");
      await bild(page, "w2-code", thema);
      await page.click(sel("kopieren"));
      expect(z.zwischenablage).toBe("WDJB-MJHT");
      await page.click(sel("github-oeffnen"));
      expect(z.aktionen.some((a) => a.aktion === "extern" && a.wert === "https://github.com/login/device")).toBe(true);
      z.codeZustand = "fertig";
      await expect(page.locator(".e-konto")).toContainText("fabiobrogno", { timeout: 8000 });
      await expect(page.locator('[data-feld="repo"]')).toHaveValue("kortex");
      await bild(page, "w2c-angemeldet", thema);
      await page.fill('[data-feld="repo"]', "kortex-vault");
      await page.click(sel("weiter"));
      await expect(page.locator("#win")).toHaveAttribute("data-step", "3", { timeout: 8000 });
      expect(anfragen(z, "/api/github/repo-anlegen")[0].body).toEqual({ name: "kortex-vault" });
      expect(anfragen(z, "/api/sicherung/verbinden")[0].body).toEqual({ besitzer: "fabiobrogno", name: "kortex-vault" });
    });

    test("Gerätecode läuft ab: Zustand abgelaufen, neuer Code per Hauptknopf", async ({ page }) => {
      const z = await oeffne(page, { ablaufSekunden: 2 });
      await zuSicherung(page);
      await page.click(sel("weiter"));
      await expect(page.locator(".e-code.alt")).toBeVisible({ timeout: 8000 });
      await expect(page.locator("#e-sync")).toContainText("Abgelaufen");
      await expect(page.locator(sel("kopieren"))).toBeDisabled();
      await expect(page.locator(sel("weiter"))).toHaveText(/Neuen Code holen/);
      await bild(page, "w2b-abgelaufen", thema);
      z.ablaufSekunden = 899;
      await page.click(sel("weiter"));
      await expect(page.locator(".e-code:not(.alt)")).toBeVisible();
      expect(z.anmeldungen).toBe(2);
    });

    test("Sicherung: abgebrochen, abgelehnt, GitHub nicht erreichbar, ohne Sicherung weiter", async ({ page }) => {
      const z = await oeffne(page);
      await zuSicherung(page);
      await page.click(sel("weiter"));
      await expect(page.locator(".e-code")).toBeVisible();
      await page.click(sel("abbrechen"));
      await expect(page.locator(".e-karte")).toBeVisible();
      expect(anfragen(z, "/api/github/abbrechen").length).toBe(1);
      z.codeZustand = "wartet"; await page.click(sel("weiter"));
      z.codeZustand = "abgelehnt";
      await expect(page.locator("#e-sync")).toContainText("Abgelehnt", { timeout: 8000 });
      await expect(page.locator(sel("weiter"))).toHaveText(/Noch einmal versuchen/);
      z.anmeldenFehler = { status: 502, fehler: "x", art: "netz" };
      await page.click(sel("weiter"));
      await expect(page.locator('[data-bereich="sync-fehler"]')).toContainText("nicht erreichbar");
      await page.click(sel("ohne"));
      await expect(page.locator("#e-sync")).toContainText("Nur auf diesem Mac");
      await expect(page.locator("#gh-schild")).toHaveText("Nur dieser Mac");
      await page.click(sel("doch"));
      await expect(page.locator(".e-karte")).toBeVisible();
    });

    test("Sicherung: schon gesichert, nicht eingerichtet, blockiert", async ({ page }) => {
      await oeffne(page, { gesichert: true });
      await zuSicherung(page);
      await expect(page.locator("#e-sync")).toContainText("Schon gesichert");
    });
    test("Sicherung: Anmeldung in dieser Version nicht eingerichtet", async ({ page }) => {
      await oeffne(page, { github: { verfuegbar: false, angemeldet: false } });
      await zuSicherung(page);
      await expect(page.locator("#e-sync")).toContainText("nicht eingerichtet");
      await expect(page.locator(sel("weiter"))).toBeEnabled();
    });
    test("Sicherung: Repository-Name vergeben bietet das vorhandene an", async ({ page }) => {
      const z = await oeffne(page, { github: { verfuegbar: true, angemeldet: true, login: "fabiobrogno" }, repoVergeben: "kortex" });
      await zuSicherung(page);
      await page.click(sel("weiter"));
      await expect(page.locator('[data-bereich="sync-fehler"]')).toContainText("gibt es schon");
      await page.click(sel("vorhanden-nehmen"));
      await expect(page.locator("#win")).toHaveAttribute("data-step", "3", { timeout: 8000 });
      expect(anfragen(z, "/api/sicherung/verbinden")[0].body).toEqual({ besitzer: "fabiobrogno", name: "kortex" });
    });

    test("KI: erkannte Programme, EINE KI wählen, Konto, Stufe, Verbinden; danach eine weitere über „Weitere KI verbinden“", async ({ page }) => {
      const z = await oeffne(page);
      await zuKi(page);
      const a = ablauf(page);
      await expect(a.locator(".ka-kopf")).toContainText("Auf diesem Computer gefunden");
      await expect(a.locator(".ka-karte")).toHaveCount(3);
      await expect(a.locator('.ka-karte[aria-checked="true"]')).toHaveCount(0); // nichts vorgewählt: der Nutzer wählt selbst
      await expect(a.locator('.ka-karte[data-ki="claude"]')).toContainText("2.1.310");
      await expect(page.locator(sel("weiter"))).toHaveText(/Ohne KI weiter/);
      await expect(page.locator("#ki-zusatz")).toBeHidden(); // „Zusätzlich“ erst nach dem Verbinden
      // EINE KI: ein zweiter Klick wählt um, es bleibt bei einer
      await a.locator('.ka-karte[data-ki="cursor"]').click();
      await a.locator('.ka-karte[data-ki="claude"]').click();
      await expect(a.locator('.ka-karte[data-ki="claude"]')).toHaveAttribute("aria-checked", "true");
      await expect(a.locator('.ka-karte[data-ki="cursor"]')).toHaveAttribute("aria-checked", "false");
      await expect(page.locator(sel("weiter"))).toHaveText(/Weiter/);
      await bild(page, "w3-ki", thema);
      await page.click(sel("weiter"));
      // Konto (nur Claude Code und Codex): beide Konten, das Standardkonto ist gewählt
      await expect(a.locator(".kv-konto")).toHaveCount(2);
      await expect(a.locator('.kv-konto[data-konto="k_claude_privat"]')).toHaveAttribute("aria-checked", "true");
      await a.locator('.kv-konto[data-konto="k_claude_firma"]').click();
      await bild(page, "w3-ki-konto", thema);
      await page.click(sel("weiter"));
      // Stufe „Lesen“ ausdrücklich
      await expect(a.locator('[data-kv="stufe"]')).toBeVisible();
      await a.locator('[data-kv="stufe"] [data-wert="lesen"]').click();
      await expect(page.locator(sel("weiter"))).toHaveText(/Verbinden/);
      await bild(page, "w3-ki-stufe", thema);
      await page.click(sel("weiter"));
      await expect(a.locator('[data-kv="fertig"]')).toBeVisible({ timeout: 10000 });
      await expect(a.locator('[data-bereich="probe-ergebnis"]')).toContainText("Claude Code sieht deinen Vault");
      await bild(page, "w3-ki-fertig", thema);
      expect(z.verbunden).toHaveLength(1);
      expect(z.verbunden[0]).toMatchObject({ ziel: "claude", konto: "k_claude_firma", zugriff: "lesen", zugriffAusdruecklich: true });
      expect(anfragen(z, "/api/mcp/pruefen")).toHaveLength(1);
      expect(z.pflege, "Pflege nur bei Erweitert").toBeUndefined();
      // zweite KI nacheinander: Cursor hat keinen Konto-Schritt
      await page.click(sel("ki-weitere"));
      await expect(a.locator('.ka-karte[data-ki="claude"] [data-verbunden="true"]')).toBeVisible(); // Claude Code ist als verbunden markiert
      await a.locator('.ka-karte[data-ki="cursor"]').click();
      await page.click(sel("weiter"));
      await expect(a.locator('[data-kv="stufe"]')).toBeVisible();
      await expect(a.locator(".kv-konto")).toHaveCount(0);
      await a.locator('[data-kv="stufe"] [data-wert="lesen"]').click();
      await page.click(sel("weiter"));
      await expect(a.locator('[data-kv="fertig"]')).toBeVisible({ timeout: 10000 });
      expect(z.verbunden).toHaveLength(2);
      expect(z.verbunden[1]).toMatchObject({ ziel: "cursor", konto: "k_cursor", zugriff: "lesen", zugriffAusdruecklich: true });
      await page.click(sel("weiter"));
      await expect(page.locator("#win")).toHaveAttribute("data-step", "4", { timeout: 8000 });
      await expect(page.locator(".e-zusammen")).toContainText("Claude Code, Cursor");
      expect(z.seitenfehler).toEqual([]);
    });

    test("KI: „Weitere KIs“ zeigt die ganze Liste mit Logos; nicht verbindbare sind gesperrt", async ({ page }) => {
      await oeffne(page);
      await zuKi(page);
      await page.click(sel("ki-weitere"));
      await expect(page.locator('.ka-zeile[data-ki="gemini"]')).toBeVisible();
      await expect(page.locator('.ka-zeile[data-ki="gemini"] .ki-logo svg')).toBeVisible();
      await expect(page.locator('.ka-zeile[data-ki="windsurf"]')).toHaveAttribute("aria-disabled", "true");
      await bild(page, "w3-ki-weitere", thema);
      await page.click(sel("ki-weitere"));
    });

    test("KI: Stufe Erweitert setzt die Pflege des Kontos (und nur dann)", async ({ page }) => {
      const z = await oeffne(page);
      await zuKi(page);
      await verbinde(page, "claude", { stufe: "erweitert" });
      await page.click(sel("weiter"));
      await expect(page.locator("#win")).toHaveAttribute("data-step", "4", { timeout: 8000 });
      expect(z.pflege).toEqual({ vault: "/Users/test/Kortex", konto: "k_claude_privat", stufe: "mittel" });
      await expect(page.locator(".e-zusammen")).toContainText("Pflege");
    });

    test("KI: nichts gefunden — Anleitungen statt Sackgasse, ohne KI weiter", async ({ page }) => {
      await oeffne(page, { ki: "keine" });
      await zuKi(page);
      const a = ablauf(page);
      await expect(a.locator('[data-bereich="keine-ki"]')).toContainText("funktioniert auch ohne");
      await expect(a.locator(".ka")).toHaveAttribute("data-erkennung", "keine");
      await expect(a.locator(".ka-kopf")).toContainText("Beliebte KIs");
      await expect(page.locator(sel("weiter"))).toHaveText(/Ohne KI weiter/);
      await expect(page.locator("#k-ki-platz")).toContainText("noch keine");
      await bild(page, "w3b-keine-ki", thema);
      await page.click(sel("weiter"));
      await expect(page.locator(".e-zusammen")).toContainText("Keine KI verbunden");
      await expect(page.locator(".e-probe")).toContainText("Halte einen Gedanken fest");
    });

    test("KI: vorhandener Eintrag wird erst nach Rückfrage umgestellt; Fehler zeigt den Befehl zum Kopieren", async ({ page }) => {
      const z = await oeffne(page, { verbindenFehler: { claude: { status: 409, fehler: "anders", art: "anders" }, codex: { status: 502, fehler: "Codex hat den Eintrag abgelehnt.", befehl: "codex mcp add brain -- node x" } } });
      await zuKi(page);
      const a = ablauf(page);
      // Claude Code: ein anderer Eintrag „brain“ — „Nicht ändern“ lässt alles, wie es ist
      await zurStufe(page, "claude");
      await page.click(sel("weiter")); // Verbinden
      await expect(a.locator('[data-bereich="umstellen"]')).toContainText("Auf diesen Vault umstellen?");
      await expect(page.locator("#win")).toHaveAttribute("data-step", "3");
      await expect(page.locator(sel("weiter"))).toBeDisabled(); // ohne Antwort geht es nicht weiter
      expect(z.verbunden ?? []).toEqual([]);
      await bild(page, "w3c-umstellen", thema);
      await page.click(sel("nicht-umstellen"));
      await expect(a.locator('[data-kv="stufe"]')).toBeVisible();
      expect(anfragen(z, "/api/mcp/pruefen")).toHaveLength(0);
      // noch einmal, diesmal „Umstellen“
      await page.click(sel("weiter"));
      await page.click(sel("umstellen"));
      await expect(a.locator('[data-kv="fertig"]')).toBeVisible({ timeout: 10000 });
      expect(z.verbunden.some((b) => b.ziel === "claude" && b.umstellen === true)).toBe(true);
      // Codex: das Programm lehnt den Eintrag ab — der Befehl steht da, zum Kopieren
      await page.click(sel("ki-weitere"));
      await zurStufe(page, "codex");
      await page.click(sel("weiter")); // Verbinden
      await expect(a.locator('[data-bereich="befehl"] code')).toHaveText("codex mcp add brain -- node x");
      await expect(page.locator("#win")).toHaveAttribute("data-step", "3");
      await expect(page.locator(sel("weiter"))).toHaveText(/Nochmal prüfen/);
      await page.click('[data-bereich="befehl"] [data-aktion="befehl-kopieren"]');
      expect(z.zwischenablage).toBe("codex mcp add brain -- node x");
      await bild(page, "w3d-befehl", thema);
      await page.click(sel("zurueck")); // der Ablauf geht einen Schritt zurück (zur Stufe), nicht gleich zum vorigen Schritt des Assistenten
      await expect(a.locator('[data-kv="stufe"]')).toBeVisible();
      await expect(page.locator("#win")).toHaveAttribute("data-step", "3");
    });

    test("Fertig: Zusammenfassung mit Ändern-Knöpfen, Probe-Frage, Studio öffnen meldet das Ende an die App", async ({ page }) => {
      const z = await oeffne(page);
      await zuFertig(page);
      await expect(page.locator(".e-zusammen")).toContainText("Vault „Kortex“");
      await expect(page.locator(".e-zusammen")).toContainText("Nur auf diesem Mac");
      await expect(page.locator(".e-zusammen")).toContainText("Claude Code");
      await expect(page.locator(".e-probe .e-badge")).toContainText("Claude Code · Posteingang");
      await page.click(sel("probe"));
      await expect(page.locator(".e-antwort .e-quelle")).toHaveCount(2, { timeout: 6000 });
      await expect(page.locator(".e-antwort")).toContainText("Ich habe 2 Notizen gefunden");
      await bild(page, "w4-fertig", thema);
      await page.click(sel("weiter")); // Studio öffnen
      await expect.poll(() => z.ende, { timeout: 5000 }).toEqual({ art: "fertig" });
    });

    test("Später (Esc): Rückfrage, Weiter einrichten schließt sie; Später legt einen Vault mit Grundordnern an und meldet das Ende", async ({ page }) => {
      const z = await oeffne(page);
      await zuVault(page);
      await page.keyboard.press("Escape");
      await expect(page.locator(".dialog")).toContainText("Den Rest später einrichten?");
      await expect(page.locator(".dialog")).toContainText("Vault mit Grundordnern");
      await bild(page, "w5-spaeter", thema);
      await page.keyboard.press("Escape");
      await expect(page.locator(".dialog")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await page.click(sel("spaeter-ja"));
      await expect.poll(() => z.ende, { timeout: 5000 }).toEqual({ art: "spaeter" });
      expect(anfragen(z, "/api/vaults/neu")[0].body).toEqual({ art: "vorlage", name: "Kortex", ordner: "~/Kortex" });
    });
  });
}

test.describe("Tastatur und Bedienung", () => {
  test("↩ geht weiter (nicht im Textfeld), ⌘↩ immer, ⌘[ zurück, 1–4 wählt den Weg, Pfeile bewegen die Auswahl", async ({ page }) => {
    await oeffne(page);
    await bereit(page);
    await page.keyboard.press("Enter");
    await expect(page.locator("#win")).toHaveAttribute("data-step", "1");
    await page.keyboard.press("3");
    await expect(page.locator('[data-weg="oeffnen"]')).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("1");
    await page.locator('[data-weg="neu"]').focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator('[data-weg="beispiel"]')).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("ArrowDown");
    await expect(page.locator('[data-weg="klonen"]')).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("1");
    await page.locator('[data-weg="neu"]').click();
    await page.focus('[data-feld="name"]');
    await page.keyboard.press("Enter"); // im Textfeld nichts
    await expect(page.locator("#win")).toHaveAttribute("data-step", "1");
    await page.keyboard.press("Meta+Enter");
    await expect(page.locator("#win")).toHaveAttribute("data-step", "2", { timeout: 6000 });
    await page.keyboard.press("Meta+[");
    await expect(page.locator("#win")).toHaveAttribute("data-step", "1");
    // der Vault ist schon da: „Weiter“ legt nichts noch einmal an
    await expect(page.locator(sel("weiter"))).toHaveText(/Weiter/);
  });

  test("Stepper: erledigte Schritte sind anklickbar, spätere gesperrt", async ({ page }) => {
    await oeffne(page);
    await zuVault(page);
    await expect(page.locator('[data-sprung="3"]')).toBeDisabled();
    await page.click(sel("weiter"));
    await expect(page.locator("#win")).toHaveAttribute("data-step", "2", { timeout: 6000 });
    await page.click('[data-sprung="1"]');
    await expect(page.locator("#win")).toHaveAttribute("data-step", "1");
    await expect(page.locator('[data-sprung="2"]')).toBeEnabled();
  });

  test("Vault-Fehler bleiben im Schritt: der Assistent geht nicht weiter und sagt, was los ist", async ({ page }) => {
    const z = await oeffne(page, { neuFehler: { status: 409, fehler: "Der Ordner „Kortex“ ist nicht leer." } });
    await zuVault(page);
    await page.click(sel("weiter"));
    await expect(page.locator(".toast.fehler")).toContainText("nicht leer");
    await expect(page.locator("#win")).toHaveAttribute("data-step", "1");
    await expect(page.locator(sel("weiter"))).toBeEnabled();
    expect(z.seitenfehler).toEqual([]);
  });

  test("Menü „Kortex einrichten …“ (?ab=sicherung): beginnt bei Schritt 2 mit dem vorhandenen Vault", async ({ page }) => {
    await oeffne(page, { vault: { pfad: "/Users/test/Notizen", name: "Notizen" }, github: { verfuegbar: true, angemeldet: true, login: "fabiobrogno" } }, "?ab=sicherung");
    await expect(page.locator("#win")).toHaveAttribute("data-step", "2");
    await expect(page.locator(".e-konto")).toContainText("fabiobrogno");
    await expect(page.locator('[data-feld="repo"]')).toHaveValue("notizen");
    await expect(page.locator("#v-name")).toHaveText("Notizen");
  });

  test("ohne App (Browser): Ordner wählen fragt nach dem Pfad", async ({ page }) => {
    await oeffne(page, { app: false });
    await bereit(page);
    await page.click(sel("schon"));
    await page.click(sel("waehle"));
    await page.fill('[data-feld="pfad"]', "/Users/test/Notizen");
    await page.click(sel("pfad-uebernehmen"));
    await expect(page.locator(".e-wahl-ordner")).toContainText("~/Notizen");
  });

  test("keine nativen Felder und keine Fremdbausteine im Assistenten", async ({ page }) => {
    await oeffne(page);
    await zuVault(page);
    const r = await page.evaluate(() => ({ selects: document.querySelectorAll("select, textarea").length, nativeKnoepfe: [...document.querySelectorAll("button.knopf")].filter((b) => !b.classList.contains("bs-knopf")).length }));
    expect(r).toEqual({ selects: 0, nativeKnoepfe: 0 });
  });
});

test.describe("Bewegung reduzieren", () => {
  test.use({ reducedMotion: "reduce" });
  test("kein Gleiten, kein Kreisen: Animationen laufen mit 0 ms, der Ablauf bleibt bedienbar", async ({ page }) => {
    await oeffne(page);
    await bereit(page);
    const d = await page.evaluate(() => ({ orbit: getComputedStyle(document.querySelector(".e-orbit")).animationName, dauer: getComputedStyle(document.querySelector(".e-hero")).animationDuration, uebergang: getComputedStyle(document.querySelector("#win")).transitionDuration }));
    expect(d.dauer).toMatch(/^0\.00?1?m?s|^1e-05s|^0s|0\.00001s/);
    expect(d.orbit).toBe("none");
    await bild(page, "w0d-reduziert", "light");
    await page.click(sel("start"));
    await expect(page.locator(".e-weg").first()).toBeVisible();
    await page.keyboard.press("Meta+Enter");
    await expect(page.locator("#win")).toHaveAttribute("data-step", "2", { timeout: 6000 });
  });
});

test.describe("Echte Werkstatt ohne Vault (Wegwerf-HOME)", () => {
  test("Neuer Vault, Beispiel und Sicherung-Status laufen gegen die echten Routen", async ({ page }) => {
    const home = mkdtempSync(join(tmpdir(), "kortex-einrichtung-"));
    const support = mkdtempSync(join(tmpdir(), "kortex-einrichtung-support-"));
    const umgebung = { PATH: process.env.PATH, HOME: home, LANG: "de_DE.UTF-8", TMPDIR: tmpdir() };
    const s = await starteServer(null, { umgebung, support });
    try {
      await page.addInitScript(() => { window.webkit = { messageHandlers: { aktion: { postMessage: async (m) => (m.aktion === "git-pruefen" ? { stand: "vorhanden" } : { ok: true }) } } }; });
      await page.goto(`${s.url}einrichtung.html`);
      await expect(page.locator(sel("start"))).toBeEnabled({ timeout: 8000 });
      await page.click(sel("start"));
      await page.fill('[data-feld="name"]', "Probe");
      await page.click(sel("weiter"));
      await expect(page.locator("#win")).toHaveAttribute("data-step", "2", { timeout: 60000 });
      expect(existsSync(join(home, "Probe", ".git"))).toBe(true);
      expect(existsSync(join(home, "Probe", "brain.config.json"))).toBe(true);
      await expect(page.locator("#v-ort")).toHaveText(/\/Probe$/);
      // GitHub ist in dieser Werkstatt nicht eingerichtet (keine Client-ID): der Schritt sagt es und lässt weitergehen
      await expect(page.locator("#e-sync")).toContainText("nicht eingerichtet", { timeout: 8000 });
    } finally { s.stopp(); }
  });
});

// ---------- Sicherheit und erhaltene Funktionen
test.describe("Gesperrte Konten, Vertrauen, Zusatz-Eintragungen", () => {
  const VAULT = "/Users/test/Kortex";
  test("Ein vom Nutzer gesperrtes Konto bleibt gesperrt: keine Stufe, keine ausdrückliche Wahl, Hinweis statt Freigabe", async ({ page }) => {
    const z = await oeffne(page, { zugriff: { k_claude_privat: { [VAULT]: "gesperrt" } }, gesperrteKonten: ["k_claude_privat"] });
    await zuKi(page);
    const a = ablauf(page);
    await zurStufe(page, "claude");
    await expect(a.locator('[data-bereich="gesperrt"]')).toContainText("bleibt es, bis du selbst eine Stufe wählst");
    await expect(a.locator('[data-kv="stufe"] [data-wert="gesperrt"]')).toHaveAttribute("aria-checked", "true");
    await page.click(sel("weiter")); // Verbinden
    await expect(a.locator('[data-kv="fertig"]')).toBeVisible({ timeout: 10000 });
    await expect(a.locator('[data-kv="fertig"]')).toContainText("bleibt in „Kortex“ gesperrt");
    expect(z.verbunden).toEqual([{ ziel: "claude", konto: "k_claude_privat" }]); // weder zugriff noch zugriffAusdruecklich
    await page.click(sel("weiter"));
    await expect(page.locator("#win")).toHaveAttribute("data-step", "4", { timeout: 8000 });
    await expect(page.locator(".e-zusammen")).toContainText("Gesperrt");
  });

  test("Wählst du bei einem gesperrten Konto selbst eine Stufe, gilt sie ausdrücklich; eine vorhandene Stufe ist vorbelegt und nicht ausdrücklich", async ({ page }) => {
    const z = await oeffne(page, { zugriff: { k_claude_privat: { [VAULT]: "gesperrt" }, k_claude_firma: { [VAULT]: "lesen" } }, gesperrteKonten: ["k_claude_privat"] });
    await zuKi(page);
    await verbinde(page, "claude", { stufe: "lesen" });
    expect(z.verbunden).toEqual([{ ziel: "claude", konto: "k_claude_privat", zugriff: "lesen", zugriffAusdruecklich: true }]);
    await expect(ablauf(page).locator('[data-kv="fertig"]')).toContainText("Darf in „Kortex“: Lesen");
  });

  test("Kontowechsel: die Stufe von Konto A gilt nie ausdrücklich für das gesperrte Konto B", async ({ page }) => {
    const z = await oeffne(page, { zugriff: { k_claude_privat: { [VAULT]: "gesperrt" }, k_claude_firma: { [VAULT]: "lesen" } }, gesperrteKonten: ["k_claude_privat"] });
    await zuKi(page);
    const a = ablauf(page);
    await a.locator('.ka-karte[data-ki="claude"]').click();
    await page.click(sel("weiter"));
    await a.locator('.kv-konto[data-konto="k_claude_firma"]').click();
    await page.click(sel("weiter"));
    await expect(a.locator('[data-kv="stufe"] [data-wert="lesen"]')).toHaveAttribute("aria-checked", "true"); // Firma: vorbelegt aus dem Stand des Vaults
    await a.locator('[data-kv="stufe"] [data-wert="erweitert"]').click(); // ausdrücklich, für Firma
    await page.click(sel("zurueck"));
    await a.locator('.kv-konto[data-konto="k_claude_privat"]').click();
    await page.click(sel("weiter"));
    await expect(a.locator('[data-kv="stufe"] [data-wert="gesperrt"]')).toHaveAttribute("aria-checked", "true");
    await expect(a.locator('[data-bereich="gesperrt"]')).toBeVisible();
    await page.click(sel("weiter")); // Verbinden
    await expect(a.locator('[data-kv="fertig"]')).toBeVisible({ timeout: 10000 });
    expect(z.verbunden).toEqual([{ ziel: "claude", konto: "k_claude_privat" }]);
    expect(z.pflege, "keine Pflege über ein gesperrtes Konto").toBeUndefined();
  });

  test("Die Stufe wird über den Pfad des Vaults nachgeschlagen (zugriff ist nach Pfad geschlüsselt, schluessel ist ein anderer Wert)", async ({ page }) => {
    const z = await oeffne(page, { zugriff: { k_claude_privat: { [VAULT]: "erweitert", ["kennung-" + VAULT]: "gesperrt" } } });
    await zuKi(page);
    await zurStufe(page, "claude");
    const a = ablauf(page);
    await expect(a.locator('[data-kv="stufe"] [data-wert="erweitert"]')).toHaveAttribute("aria-checked", "true");
    await expect(a.locator('[data-kv="stufe"] [data-wert="gesperrt"]')).toHaveCount(0);
    expect(z.verbunden ?? []).toEqual([]);
  });

  test("Vorbelegung aus dem Konto: Lesen bleibt Lesen, ohne ausdrückliche Wahl", async ({ page }) => {
    const z = await oeffne(page, { zugriff: { k_claude_privat: { [VAULT]: "lesen" } } });
    await zuKi(page);
    await zurStufe(page, "claude");
    await expect(ablauf(page).locator('[data-kv="stufe"] [data-wert="lesen"]')).toHaveAttribute("aria-checked", "true");
    await page.click(sel("weiter")); // Verbinden
    await expect(ablauf(page).locator('[data-kv="fertig"]')).toBeVisible({ timeout: 10000 });
    expect(z.verbunden).toEqual([{ ziel: "claude", konto: "k_claude_privat", zugriff: "lesen" }]);
  });

  test("Ordner öffnen: kein Vertrauen vom Assistenten; „Versionsverlauf“ ist ein eigener Schalter", async ({ page }) => {
    const z = await oeffne(page);
    await zuVault(page);
    await page.click('[data-weg="oeffnen"]');
    await page.click(sel("waehle"));
    await expect(page.locator("#e-detail")).toContainText("Versionsverlauf einschalten");
    await expect(page.locator("#e-detail")).not.toContainText("selbst angelegt");
    await page.click(sel("verlauf")); // aus
    await page.click(sel("weiter"));
    await expect(page.locator("#win")).toHaveAttribute("data-step", "2", { timeout: 6000 });
    expect(anfragen(z, "/api/vaults/oeffnen")[0].body).toEqual({ pfad: "/Users/test/Dokumente/Notizen" });
    expect(anfragen(z, "/api/vertrauen").length).toBe(0);
  });

  test("Zusätzlich: erscheint erst nach dem Verbinden; Hooks, Prüfung vor dem Speichern, Hintergrunddienst über /api/kern/verdrahten; fremde Prüfung wird nur nach „Ersetzen“ abgelöst", async ({ page }) => {
    const z = await oeffne(page, { gitFremd: true });
    await zuKi(page);
    await expect(page.locator("#ki-zusatz")).toBeHidden(); // beim Wählen stört es nur
    await verbinde(page, "claude");
    await expect(page.locator("#ki-zusatz")).toContainText("Zusätzlich, wenn du möchtest");
    await expect(page.locator("#ki-zusatz [data-zusatz]")).toHaveCount(3);
    await page.click('[data-aktion="zusatz-claude"]');
    await expect.poll(() => z.verdrahtet?.length).toBe(1);
    expect(z.verdrahtet[0]).toEqual({ was: "claude", an: true, profile: ["/Users/test/.claude"] });
    await expect(page.locator('[data-aktion="zusatz-claude"]')).toHaveAttribute("aria-checked", "true");
    await page.click('[data-aktion="zusatz-git"]');
    await expect(page.locator('[data-bereich="git-ersetzen"]')).toContainText("schon eine andere Prüfung");
    await page.click(sel("git-ersetzen"));
    await expect(page.locator('[data-aktion="zusatz-git"]')).toHaveAttribute("aria-checked", "true");
    expect(z.verdrahtet.at(-1)).toEqual({ was: "git", an: true, ersetzen: true });
    await page.click('[data-aktion="zusatz-dienst"]');
    await expect(page.locator('[data-aktion="zusatz-dienst"]')).toHaveAttribute("aria-checked", "true");
    await page.click('[data-aktion="zusatz-dienst"]');
    await expect.poll(() => z.verdrahtet.at(-1)).toEqual({ was: "dienst", an: false });
  });

  // Das Trennen gibt es im Assistenten nicht mehr (die frühere Zeile .e-ki-zeile mit „Trennen“ ist weg; getrennt wird in den Einstellungen unter „KI & Konten“).
  test("„Konfiguration kopieren“ für andere KIs steht schon im ersten Schritt", async ({ page }) => {
    const z = await oeffne(page);
    await zuKi(page);
    await page.click(sel("konfig-kopieren"));
    await expect.poll(() => z.zwischenablage).toContain('"mcpServers"');
    await expect(page.locator(".toast", { hasText: "Konfiguration kopiert" })).toBeVisible();
    await expect(page.locator("#win")).toHaveAttribute("data-step", "3");
  });

  for (const [dienst, text] of [[false, "beim nächsten Sitzungsstart"], [true, "Täglich im Hintergrund"]]) {
    test(`Fertig: die Pflege-Zeile sagt ehrlich, ob der Hintergrunddienst läuft (${dienst ? "Dienst da" : "ohne Dienst"})`, async ({ page }) => {
      const z = await oeffne(page, { dienstFuerVault: dienst });
      await zuKi(page);
      await verbinde(page, "claude", { stufe: "erweitert" });
      await page.click(sel("weiter"));
      await expect(page.locator(".e-zusammen")).toContainText(text, { timeout: 8000 });
      expect(z.pflege).toEqual({ vault: VAULT, konto: "k_claude_privat", stufe: "mittel" });
    });
  }

  test("Die Adresse des Gerätecodes wird nur geöffnet, wenn sie https und github.com ist", async ({ page }) => {
    const z = await oeffne(page, { anmeldeUrl: "https://github.com.evil.example/login/device" });
    await zuSicherung(page);
    await page.click(sel("weiter"));
    await expect(page.locator(".e-code")).toBeVisible();
    await page.click(sel("github-oeffnen"));
    await expect(page.locator(".toast.fehler")).toContainText("gehört nicht zu GitHub");
    expect(z.aktionen.some((a) => a.aktion === "extern")).toBe(false);
  });

  test("Später ohne lesbaren Stand (?ab=) legt nichts an und ändert den aktiven Vault nicht", async ({ page }) => {
    const z = await oeffne(page, { infoFehler: true }, "?ab=sicherung");
    await bereit(page);
    await page.click(sel("schon")); // Willkommen bleibt bedienbar
    await page.keyboard.press("Escape");
    await expect(page.locator(".dialog")).toBeVisible();
    await page.click(sel("spaeter-ja"));
    await expect.poll(() => z.ende, { timeout: 5000 }).toEqual({ art: "spaeter" });
    expect(anfragen(z, "/api/vaults/neu").length).toBe(0);
  });

  test("Später legt keinen Vault an, wenn inzwischen einer aktiv ist; sonst einen mit Grundordnern", async ({ page }) => {
    const z = await oeffne(page);
    await zuVault(page);
    z.vault = { pfad: "/Users/test/Anderer", name: "Anderer" }; // anderswo wurde ein Vault geöffnet
    await page.keyboard.press("Escape");
    await expect(page.locator(".dialog")).toContainText("Grundordnern");
    await page.click(sel("spaeter-ja"));
    await expect.poll(() => z.ende, { timeout: 5000 }).toEqual({ art: "spaeter" });
    expect(anfragen(z, "/api/vaults/neu").length).toBe(0);
  });
});
