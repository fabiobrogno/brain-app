// Einrichtung (Overlay im Studio, Paket E2): drei Schritte Vault · KI · Sicherung, Kopf über Schritt 1, Auto-Überspringen, alle Wege (neu, Ordner öffnen, von GitHub holen, Beispiel),
// mit und ohne git, mit und ohne KI, Remote vorhanden, Vertrauen im Vault-Schritt, Anmelden-Haken, GitHub-Gerätecode, Fortsetzen nach Neuladen, „Später“ legt nichts an, Checkliste.
// Alle /api/-Aufrufe und die Aktionen der App (git prüfen, Ordner wählen, Browser, Zwischenablage, Sitzung, Schritt, Ende) sind gemockt (mocks-einrichtung.mjs).
// Eine zusätzliche Probe läuft gegen die echte Werkstatt ohne Vault mit einem Wegwerf-HOME.
import { test, expect } from "./basis.mjs";
import { mkdirSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { starteStatisch, mockeEinrichtung, oeffneEinrichtungImStudio } from "./mocks-einrichtung.mjs";
import { starteServer } from "./start.mjs";
import { pfadMit } from "../Node/attrappe.mjs";

const BILDER = process.env.UI_EINRICHTUNG_BILDER; // optional: Bilder für die Augenkontrolle
let server;
test.beforeAll(async () => { server = await starteStatisch(); if (BILDER) mkdirSync(BILDER, { recursive: true }); });
test.afterAll(() => server?.stopp());

const sel = (a) => `[data-aktion="${a}"]`;
const VAULT = "/Users/test/Kortex";
const anfragen = (z, pfad) => z.anfragen.filter((a) => a.pfad === pfad);
const bild = async (page, name, thema) => { if (BILDER) { await page.waitForTimeout(900); await page.screenshot({ path: join(BILDER, `${name}-${thema === "dark" ? "dunkel" : "hell"}.png`) }); } };
async function oeffne(page, opt = {}, start = {}) {
  const z = await mockeEinrichtung(page, opt);
  await oeffneEinrichtungImStudio(page, server.url, z, start);
  return z;
}
// git ist geprüft und der Hauptknopf gilt
const bereit = (page) => expect(page.locator(sel("weiter"))).toBeEnabled({ timeout: 6000 });
const pillen = (page) => page.locator("#stepper .e-pill");
const zeile = (page, id) => page.locator(`.e-kr[data-ki="${id}"]`);
const verbinden = (page, id) => page.click(`${sel("verbinden")}[data-ki="${id}"]`);
const ki = (page) => page.locator('[data-bereich="ki"]');
// Vault anlegen (Neuer Vault, ~/Kortex) und bis zur KI gehen
async function zuKi(page) { await bereit(page); await page.click(sel("weiter")); await expect(ki(page).locator(".e-kr").first()).toBeVisible({ timeout: 8000 }); }
async function zuSicherung(page) { await zuKi(page); await page.click(sel("weiter")); await expect(page.locator("#e-sync [data-wahl]").first()).toBeVisible({ timeout: 8000 }); }

for (const thema of ["light", "dark"]) {
  test.describe(`Darstellung ${thema}`, () => {
    test.use({ colorScheme: thema });

    test("Kopf über Schritt 1: Zeichen, Augenbraue, Titel; drei Pillen „1 von 3“; git still geprüft, keine Karte; kein eigenes Willkommen", async ({ page }) => {
      const z = await oeffne(page);
      await bereit(page);
      await expect(page.locator(".e-eyebrow")).toHaveText("Willkommen bei Kortex");
      await expect(page.locator("#thd h1")).toHaveText("Richte deinen Vault ein");
      await expect(page.locator("#app-zeichen")).toBeVisible();
      await expect(pillen(page)).toHaveCount(3);
      await expect(page.locator('#stepper .e-pill[aria-current="step"]')).toHaveCount(1);
      await expect(page.locator(".e-stand")).toHaveText("1 von 3");
      await expect(page.locator('[data-bereich="git"]')).toHaveCount(0);
      await expect(page.locator(sel("weiter") + " .e-chip-key")).toHaveText("⌘ ↩");
      expect(z.aktionen.some((a) => a.aktion === "git-pruefen")).toBe(true);
      await expect(page.locator("#win")).toHaveAttribute("data-step", "vault");
      await expect(page.locator(".e-buehne, .e-hero")).toHaveCount(0);
      // die Sitzung ist von der Seite bestätigt, bevor irgendeine Einrichtungsaktion läuft
      expect(z.sitzungen).toEqual([false, true]);
      expect(z.seitenfehler).toEqual([]);
      await bild(page, "e2-1-vault", thema);
    });

    test("Vault-Schritt: Hauptweg „Neuer Vault“ mit Empfehlung, „Andere Wege“ darunter; Ort ändern über das eigene Menü", async ({ page }) => {
      const z = await oeffne(page);
      await bereit(page);
      await expect(page.locator('[data-weg="neu"]')).toHaveAttribute("aria-checked", "true");
      await expect(page.locator('[data-weg="neu"] .e-badge')).toHaveText("Empfohlen");
      await expect(page.locator("#v-ort")).toHaveText("~/Kortex");
      await expect(page.locator(".e-sech")).toHaveText("Andere Wege");
      await expect(page.locator(".e-opt-row b")).toHaveText(["Ordner öffnen", "Von GitHub holen", "Beispiel ansehen"]);
      await page.click(sel("ort"));
      await expect(page.locator(".menue .m-eintrag")).toHaveText(["~/Kortex", "~/Documents/Kortex", "Anderen Ort wählen …"]);
      await page.click('.menue [data-menue="ort-~/Documents/Kortex"]');
      await expect(page.locator("#v-ort")).toHaveText("~/Documents/Kortex");
      // „Anderen Ort wählen …“: die Ordnerwahl der Hülle (Vertrag), der Vault kommt als „Kortex“ in den gewählten Ordner
      await page.click(sel("ort"));
      await page.click('.menue [data-menue="ort-anderen"]');
      await expect.poll(() => z.aktionen.filter((a) => a.aktion === "ordner-waehlen").length).toBe(1);
      await expect(page.locator("#v-ort")).toHaveText("~/Dokumente/Notizen/Kortex");
      await page.click(sel("weiter"));
      await expect(ki(page).locator(".e-kr").first()).toBeVisible({ timeout: 8000 });
      expect(anfragen(z, "/api/vaults/neu")[0].body).toEqual({ art: "vorlage", name: "Kortex", ordner: "/Users/test/Dokumente/Notizen/Kortex" });
      expect(z.schritte).toEqual(["vault"]);
      await expect(page.locator(".toast")).toContainText("Vault „Kortex“ ist bereit");
    });

    test("git fehlt: Karte mit Installieren, Weiter gesperrt; Apples Dialog läuft, die Einrichtung merkt, wenn git da ist", async ({ page }) => {
      const z = await oeffne(page, { git: "fehlt" });
      await expect(page.locator('[data-bereich="git"]')).toContainText("Ein Werkzeug von Apple fehlt noch");
      await expect(page.locator(sel("weiter"))).toBeDisabled();
      await bild(page, "e2-1b-git-fehlt", thema);
      await page.click(sel("git-installieren"));
      expect(z.aktionen.some((a) => a.aktion === "git-installieren")).toBe(true);
      await expect(page.locator('[data-bereich="git"]')).toContainText("Apple installiert", { timeout: 4000 });
      // die Einrichtung sieht alle 3 Sekunden nach: sobald das Werkzeug da ist, verschwindet die Karte und der Hauptknopf gilt
      z.git = "vorhanden";
      await expect(page.locator('[data-bereich="git"]')).toHaveCount(0, { timeout: 8000 });
      await bereit(page);
    });

    test("git defekt: Karte mit Grund und „Erneut prüfen“", async ({ page }) => {
      const z = await oeffne(page, { git: "defekt" });
      await expect(page.locator('[data-bereich="git"]')).toContainText("Xcode-Lizenz");
      z.git = "vorhanden";
      await page.click(sel("git-nochmal"));
      await expect(page.locator('[data-bereich="git"]')).toHaveCount(0);
      await bereit(page);
    });

    test("Ordner öffnen: Zählung, Versionsverlauf, Vertrauen aus (mit Erklärung); kein Vertrauen vergeben, die Frage im Studio entfällt", async ({ page }) => {
      const z = await oeffne(page);
      await bereit(page);
      await page.click('[data-weg="oeffnen"]');
      await expect(page.locator(sel("weiter"))).toBeDisabled(); // noch kein Ordner gewählt
      await page.click(sel("waehle"));
      await expect(page.locator("#v-ordner")).toHaveText("~/Dokumente/Notizen");
      await expect(page.locator('[data-feld="zaehlung"]')).toHaveText("128 Notizen · 9 Ordner");
      const trust = page.locator('[data-bereich="vertrauen"]');
      await expect(trust).toContainText("Diesem Ordner vertrauen");
      await expect(trust).toContainText("Lass es aus, wenn du ihn nicht selbst angelegt hast");
      await expect(trust.locator(sel("vertrauen"))).toHaveAttribute("aria-checked", "false");
      await bild(page, "e2-1c-oeffnen", thema);
      await page.click(sel("weiter"));
      await expect(ki(page).locator(".e-kr").first()).toBeVisible({ timeout: 8000 });
      expect(anfragen(z, "/api/vaults/oeffnen")[0].body).toEqual({ pfad: "/Users/test/Dokumente/Notizen", gitEinschalten: true });
      expect(anfragen(z, "/api/vertrauen")).toHaveLength(0);
    });

    test("Ordner öffnen mit Vertrauen an: genau dieser Vault wird vertraut", async ({ page }) => {
      const z = await oeffne(page);
      await bereit(page);
      await page.click('[data-weg="oeffnen"]');
      await page.click(sel("waehle"));
      await page.click(`[data-bereich="vertrauen"] ${sel("vertrauen")}`);
      await page.click(sel("weiter"));
      await expect(ki(page).locator(".e-kr").first()).toBeVisible({ timeout: 8000 });
      expect(anfragen(z, "/api/vertrauen")[0].body).toEqual({ erlauben: true, vault: "/Users/test/Dokumente/Notizen" });
    });

    test("Ordner zu breit: gesperrt mit Grund, Vorschlag legt einen Unterordner an", async ({ page }) => {
      await oeffne(page, { ordner: { pfad: "/Users/test", breit: { name: "Benutzerordner", vorschlag: "/Users/test/Kortex" } } });
      await bereit(page);
      await page.click('[data-weg="oeffnen"]');
      await page.click(sel("waehle"));
      await expect(page.locator('[data-bereich="zu-breit"]')).toContainText("Dieser Ordner ist zu groß");
      await expect(page.locator(sel("weiter"))).toBeDisabled();
      await expect(page.locator('[data-bereich="vertrauen"]')).toHaveCount(0);
      await bild(page, "e2-1d-zu-breit", thema);
      await page.click(sel("dort-anlegen"));
      await expect(page.locator('[data-weg="neu"]')).toHaveAttribute("aria-checked", "true");
      await expect(page.locator("#v-ort")).toHaveText("~/Kortex");
      await expect(page.locator(sel("weiter"))).toBeEnabled();
    });

    test("Von GitHub holen: Feld mit Prüfung, Vertrauen aus; Klon in ~/<Name>; Sicherung entfällt (zwei Pillen)", async ({ page }) => {
      const z = await oeffne(page);
      await bereit(page);
      await page.click('[data-weg="klonen"]');
      await expect(page.locator(sel("weiter"))).toBeDisabled();
      await expect(page.locator('[data-feld="url"]')).toBeVisible();
      await page.fill('[data-feld="url"]', "name");
      await expect(page.locator("#url-text")).toContainText("noch nicht wie ein Speicher aus");
      await expect(page.locator('[data-feld="url"]')).toHaveAttribute("aria-invalid", "true");
      await expect(page.locator(sel("weiter"))).toBeDisabled();
      await page.fill('[data-feld="url"]', "fabiobrogno/wissen");
      await expect(page.locator("#url-text")).toBeHidden();
      await expect(page.locator('[data-bereich="vertrauen"] ' + sel("vertrauen"))).toHaveAttribute("aria-checked", "false");
      await bild(page, "e2-1e-klonen", thema);
      await page.click(sel("weiter"));
      await expect(ki(page).locator(".e-kr").first()).toBeVisible({ timeout: 8000 });
      expect(anfragen(z, "/api/vaults/klonen")[0].body).toEqual({ url: "https://github.com/fabiobrogno/wissen", ordner: "~/wissen" });
      // vom GitHub geholt: ein Remote ist da, die Sicherung entfällt
      await expect(pillen(page)).toHaveCount(2);
      await expect(page.locator(".e-stand")).toHaveText("2 von 2");
      await expect(page.locator(sel("weiter"))).toContainText("Einrichtung abschließen");
      expect(z.schritte).toEqual(["vault"]);
    });

    test("Von GitHub holen, privates Repository: die Anmeldung läuft im Overlay und führt zurück zum Klonen", async ({ page }) => {
      const z = await oeffne(page, { klonFehler: { status: 403, fehler: "Zugriff verweigert.", nurOhneKonto: true } });
      await bereit(page);
      await page.click('[data-weg="klonen"]');
      await page.fill('[data-feld="url"]', "github.com/fabiobrogno/wissen");
      await page.click(sel("weiter"));
      await expect(page.locator(sel("klon-anmelden"))).toBeVisible({ timeout: 6000 });
      await page.click(sel("klon-anmelden"));
      await expect(page.locator("#thd h1")).toHaveText("Mit GitHub verbinden");
      await expect(page.locator("#e-sync")).toContainText("Mit GitHub verbinden", { timeout: 6000 });
      await page.click(sel("weiter")); // Anmelden
      await expect(page.locator(".e-code")).toBeVisible({ timeout: 6000 });
      z.codeZustand = "fertig";
      // nach der Anmeldung holt die Einrichtung den Vault von selbst
      await expect.poll(() => anfragen(z, "/api/vaults/klonen").length, { timeout: 12000 }).toBe(2);
      await expect(ki(page).locator(".e-kr").first()).toBeVisible({ timeout: 8000 });
      await expect(page.locator(".toast", { hasText: "Vault „wissen“ ist bereit" })).toBeVisible();
    });

    test("Von GitHub holen: schon angemeldet und trotzdem 403 — keine Schleife, klare Meldung mit „Andere Adresse“ und „Abbrechen“", async ({ page }) => {
      const z = await oeffne(page, { klonFehler: { status: 403, fehler: "Zugriff verweigert." }, github: { verfuegbar: true, angemeldet: true, login: "fabiobrogno" } });
      await bereit(page);
      await page.click('[data-weg="klonen"]');
      await page.fill('[data-feld="url"]', "fremder/geheim");
      await page.click(sel("weiter"));
      await expect(page.locator('[data-bereich="klon-fehler"]')).toContainText("keinen Zugriff", { timeout: 6000 });
      await expect(page.locator(sel("klon-anmelden"))).toHaveCount(0);
      expect(anfragen(z, "/api/vaults/klonen")).toHaveLength(1);
      await page.click(sel("klon-andere"));
      await expect(page.locator('[data-feld="url"]')).toHaveValue("");
      await page.fill('[data-feld="url"]', "fremder/geheim");
      await page.click(sel("weiter"));
      await expect(page.locator(sel("klon-abbrechen"))).toBeVisible({ timeout: 6000 });
      await page.click(sel("klon-abbrechen"));
      await expect(page.locator('[data-weg="neu"]')).toHaveAttribute("aria-checked", "true");
      expect(anfragen(z, "/api/github/anmelden")).toHaveLength(0);
    });

    test("Von GitHub holen, Anmeldung nicht eingerichtet: „Weiter“ ist gesperrt, Zurück führt zur Vault-Wahl", async ({ page }) => {
      await oeffne(page, { klonFehler: { status: 403, fehler: "Zugriff verweigert." }, github: { verfuegbar: false, angemeldet: false } });
      await bereit(page);
      await page.click('[data-weg="klonen"]');
      await page.fill('[data-feld="url"]', "name/vault");
      await page.click(sel("weiter"));
      await page.click(sel("klon-anmelden"));
      await expect(page.locator("#e-sync")).toContainText("nicht eingerichtet", { timeout: 6000 });
      await expect(page.locator(sel("weiter"))).toBeDisabled();
      await page.click(sel("zurueck"));
      await expect(page.locator("#win")).toHaveAttribute("data-step", "vault");
    });

    test("Von GitHub holen: Fehler bleiben im Schritt und sagen, was los ist", async ({ page }) => {
      await oeffne(page, { klonFehler: { status: 404, fehler: "Repository nicht gefunden." } });
      await bereit(page);
      await page.click('[data-weg="klonen"]');
      await page.fill('[data-feld="url"]', "name/vault");
      await page.click(sel("weiter"));
      await expect(page.locator('[data-bereich="klon-fehler"]')).toBeVisible({ timeout: 6000 });
      await expect(page.locator("#win")).toHaveAttribute("data-step", "vault");
    });

    test("Beispiel ansehen: ~/Kortex-Beispiel ohne weitere Angaben", async ({ page }) => {
      const z = await oeffne(page);
      await bereit(page);
      await page.click('[data-weg="beispiel"]');
      await expect(page.locator(sel("weiter"))).toContainText("Beispiel öffnen");
      await page.click(sel("weiter"));
      await expect(ki(page).locator(".e-kr").first()).toBeVisible({ timeout: 8000 });
      expect(anfragen(z, "/api/vaults/neu")[0].body).toEqual({ art: "vorlage", name: "Kortex-Beispiel", ordner: "~/Kortex-Beispiel" });
      await expect(pillen(page)).toHaveCount(3);
    });
  });
}

// ---------------------------------------------------------------- KI
test.describe("KI-Schritt: eine Zeile je Programm, ein Knopf „Verbinden“", () => {
  for (const thema of ["light", "dark"]) {
    test.describe(`Darstellung ${thema}`, () => {
      test.use({ colorScheme: thema });
      test("gefundene Programme als Liste; Konto-Auswahl nur bei mehr als einem Konto; Zugriff „Posteingang“ mit „Ändern“; Kontingent bei fremdem Konto aus", async ({ page }) => {
        await oeffne(page);
        await zuKi(page);
        await expect(page.locator("#thd h1")).toHaveText("KI-Programme verbinden");
        await expect(page.locator(".e-eyebrow")).toHaveText("Schritt 2 · KI");
        await expect(ki(page).locator(".e-kr .e-nm")).toHaveText(["Claude Code", "Codex", "Cursor"]);
        // Claude Code hat zwei Konten (Privat, Firma): kleine Auswahl in der Zeile; Codex und Cursor haben eines: keine
        await expect(zeile(page, "claude").locator(sel("konto-waehlen"))).toContainText("Konto: Privat");
        await expect(zeile(page, "codex").locator(sel("konto-waehlen"))).toHaveCount(0);
        await expect(zeile(page, "cursor").locator(sel("konto-waehlen"))).toHaveCount(0);
        for (const id of ["claude", "codex", "cursor"]) {
          await expect(zeile(page, id).locator('[data-feld="zugriff"]')).toHaveText("Zugriff: Posteingang");
          await expect(zeile(page, id).locator(sel("stufe-aendern"))).toHaveText("Ändern");
        }
        const kt = ki(page).locator('[data-bereich="kontingent"]');
        await expect(kt).toContainText("Kontingent in Kortex anzeigen");
        await expect(kt).toContainText("liest daraus nur Prozentwerte");
        // das Standardkonto (~/.claude) gehört nicht Kortex: aus, und der Satz sagt, was beim Einschalten geschieht
        await expect(kt.locator(sel("kontingent"))).toHaveAttribute("aria-checked", "false");
        await expect(kt.locator('[data-feld="kontingent-text"]')).toContainText("deine eigene Datei");
        await bild(page, "e2-2-ki", thema);
      });

      test("Verbinden: Eintragen und stille Prüfung enden als Haken in der Zeile; bei einem von Kortex verwalteten Konto ist das Kontingent vorgabegemäß an und wird eingerichtet", async ({ page }) => {
        const z = await oeffne(page, { verwaltet: ["k_claude_privat"] });
        await zuKi(page);
        await expect(page.locator(`[data-bereich="kontingent"] ${sel("kontingent")}`)).toHaveAttribute("aria-checked", "true");
        await expect(page.locator('[data-feld="kontingent-text"]')).not.toContainText("eigene Datei");
        await verbinden(page, "claude");
        await expect(zeile(page, "claude").locator(".e-tick")).toContainText("Verbunden", { timeout: 8000 });
        expect(anfragen(z, "/api/mcp/verbinden")[0].body).toEqual({ ziel: "claude", konto: "k_claude_privat", zugriff: "posteingang" }); // die Vorgabe gilt nicht als ausdrückliche Wahl (kein zugriffAusdruecklich)
        expect(anfragen(z, "/api/mcp/pruefen")[0].body).toEqual({ konto: "k_claude_privat", programm: "claude" });
        await expect.poll(() => z.statuszeile).toEqual([{ konto: "k_claude_privat", an: true, einwilligung: true }]); // verwaltet: ohne die Bestätigung für fremde Orte
        await expect(zeile(page, "claude").locator('[data-feld="zugriff"]')).toHaveText("Zugriff: Posteingang");
        await expect(zeile(page, "codex").locator(sel("verbinden"))).toBeVisible(); // die anderen Zeilen bleiben, wie sie sind
        await bild(page, "e2-2b-ki-verbunden", thema);
      });
    });
  }

  test("Fremdes Konto: Kontingent aus, nichts wird in die Einstellungen von Claude Code eingetragen; ausdrücklich einschalten trägt nach", async ({ page }) => {
    const z = await oeffne(page);
    await zuKi(page);
    await expect(page.locator(`[data-bereich="kontingent"] ${sel("kontingent")}`)).toHaveAttribute("aria-checked", "false");
    await verbinden(page, "claude");
    await expect(zeile(page, "claude").locator(".e-tick")).toBeVisible({ timeout: 8000 });
    expect(z.statuszeile).toBeUndefined();
    await page.click(`[data-bereich="kontingent"] ${sel("kontingent")}`);
    await expect.poll(() => z.statuszeile?.length).toBe(1);
    expect(z.statuszeile[0]).toEqual({ konto: "k_claude_privat", an: true, einwilligung: true, bestaetigt: true }); // fremder Ort: nur nach der ausdrücklichen Wahl, mit Bestätigung
  });

  test("Kontingent: scheitert das Eintragen, steht ein Hinweis da und die KI bleibt verbunden", async ({ page }) => {
    await oeffne(page, { statuszeileFehler: true, verwaltet: ["k_claude_privat"] });
    await zuKi(page);
    await verbinden(page, "claude");
    await expect(zeile(page, "claude").locator(".e-tick")).toBeVisible({ timeout: 8000 });
    await expect(page.locator(".toast", { hasText: "Das Kontingent ließ sich nicht einrichten" })).toBeVisible();
  });

  test("Aktives Konto aus ki-konten.json ist in der Zeile vorgewählt", async ({ page }) => {
    const z = await oeffne(page, { aktiv: { claude: "k_claude_firma" } });
    await zuKi(page);
    await expect(zeile(page, "claude").locator(sel("konto-waehlen"))).toContainText("Konto: Firma");
    await verbinden(page, "claude");
    await expect(zeile(page, "claude").locator(".e-tick")).toBeVisible({ timeout: 8000 });
    expect(anfragen(z, "/api/mcp/verbinden")[0].body.konto).toBe("k_claude_firma");
  });

  test("Konto wählen: die Auswahl in der Zeile bestimmt das Konto beim Verbinden", async ({ page }) => {
    const z = await oeffne(page);
    await zuKi(page);
    await page.click(`${sel("konto-waehlen")}[data-ki="claude"]`);
    await expect(page.locator(".menue .m-eintrag")).toHaveText(["Privat~/.claude", "Firma~/.claude-firma"]);
    await page.click('.menue [data-menue="konto-k_claude_firma"]');
    await expect(zeile(page, "claude").locator(sel("konto-waehlen"))).toContainText("Konto: Firma");
    await verbinden(page, "claude");
    await expect(zeile(page, "claude").locator(".e-tick")).toBeVisible({ timeout: 8000 });
    expect(anfragen(z, "/api/mcp/verbinden")[0].body.konto).toBe("k_claude_firma");
    await expect(zeile(page, "claude").locator(".e-sb2")).toContainText("Firma");
  });

  test("Zugriff ändern: das Menü bietet Gesperrt, Lesen, Posteingang (Vorgabe); die Wahl gilt ausdrücklich", async ({ page }) => {
    const z = await oeffne(page);
    await zuKi(page);
    await page.click(`${sel("stufe-aendern")}[data-ki="codex"]`);
    await expect(page.locator(".menue .m-eintrag")).toHaveText(["Gesperrt", "Lesen", "PosteingangVorgabe"]);
    await page.click('.menue [data-menue="stufe-lesen"]');
    await expect(zeile(page, "codex").locator('[data-feld="zugriff"]')).toHaveText("Zugriff: Lesen");
    await verbinden(page, "codex");
    await expect(zeile(page, "codex").locator(".e-tick")).toBeVisible({ timeout: 8000 });
    expect(anfragen(z, "/api/mcp/verbinden")[0].body).toEqual({ ziel: "codex", konto: "k_codex", zugriff: "lesen", zugriffAusdruecklich: true });
  });

  test("Ein vom Nutzer gesperrtes Konto bleibt gesperrt: keine Stufe ohne ausdrückliche Wahl, Hinweis statt Freigabe", async ({ page }) => {
    const z = await oeffne(page, { ki: "eine", zugriff: { k_claude_privat: { [VAULT]: "gesperrt" } }, gesperrteKonten: ["k_claude_privat"] });
    await zuKi(page);
    await expect(zeile(page, "claude").locator('[data-feld="zugriff"]')).toHaveText("Zugriff: Gesperrt");
    await verbinden(page, "claude");
    await expect(zeile(page, "claude").locator(".e-tick")).toBeVisible({ timeout: 8000 });
    const b = anfragen(z, "/api/mcp/verbinden")[0].body;
    expect(b.zugriff).toBeUndefined();
    await expect(page.locator('[data-bereich="gesperrt-bleibt"]')).toContainText("bleibt gesperrt");
  });

  test("Nichts gefunden: Hinweis statt Sackgasse, „Neu suchen“; weiter geht es auch ohne KI", async ({ page }) => {
    const z = await oeffne(page, { ki: "keine" });
    await bereit(page);
    await page.click(sel("weiter"));
    await expect(ki(page).locator('[data-bereich="ki-keine"]')).toContainText("Kein KI-Programm gefunden");
    await expect(page.locator('[data-bereich="kontingent"]')).toHaveCount(0);
    await page.click(sel("erneut-suchen"));
    await expect(page.locator(".toast", { hasText: "Keine neuen Programme gefunden" })).toBeVisible();
    expect(anfragen(z, "/api/ki/erkennen").length).toBeGreaterThanOrEqual(2);
    await page.click(sel("weiter")); // ohne KI
    await expect(page.locator("#win")).toHaveAttribute("data-step", "sicherung");
  });

  test("Ein fremder Eintrag „brain“ wird erst nach Rückfrage umgestellt", async ({ page }) => {
    const z = await oeffne(page, { verbindenFehler: { claude: { status: 409, fehler: "anders", art: "anders" } } });
    await zuKi(page);
    await verbinden(page, "claude");
    await expect(zeile(page, "claude").locator('[data-bereich="umstellen"]')).toContainText("schon einen Eintrag „brain“");
    await page.click(sel("nicht-umstellen"));
    await expect(zeile(page, "claude").locator('[data-bereich="umstellen"]')).toHaveCount(0);
    await verbinden(page, "claude");
    await page.click(sel("umstellen"));
    await expect(zeile(page, "claude").locator(".e-tick")).toBeVisible({ timeout: 8000 });
    expect(anfragen(z, "/api/mcp/verbinden").map((a) => a.body.umstellen === true)).toEqual([false, false, true]);
  });

  test("Scheitert das Eintragen, steht der Befehl zum Kopieren da", async ({ page }) => {
    const z = await oeffne(page, { verbindenFehler: { codex: { status: 404, fehler: "codex nicht gefunden", befehl: "codex mcp add brain -- /pfad/kern" } } });
    await zuKi(page);
    await verbinden(page, "codex");
    await expect(page.locator('[data-bereich="ki-fehler"]')).toBeVisible({ timeout: 6000 });
    await expect(page.locator('[data-bereich="befehl"] code')).toHaveText("codex mcp add brain -- /pfad/kern");
    await page.click(sel("befehl-kopieren"));
    await expect.poll(() => z.zwischenablage).toBe("codex mcp add brain -- /pfad/kern");
    await expect(zeile(page, "codex").locator(sel("verbinden"))).toContainText("Nochmal versuchen");
  });

  test("Prüfen scheitert: klare Meldung in der Zeile, kein falscher Haken", async ({ page }) => {
    await oeffne(page, { pruefenFehler: { status: 500, fehler: "Der Kortex-Server antwortet nicht." } });
    await zuKi(page);
    await verbinden(page, "cursor");
    await expect(zeile(page, "cursor").locator('[data-bereich="ki-fehler"]')).toContainText("antwortet nicht", { timeout: 6000 });
    await expect(zeile(page, "cursor").locator(".e-tick")).toHaveCount(0);
  });

  test("Nicht angemeldet: die Anmeldung läuft im Fenster (Panel aus anmeldung.js), danach verbindet die Zeile von selbst", async ({ page }) => {
    const z = await oeffne(page, { login: { "std:codex": "nicht-angemeldet" } });
    z.laufPhase = "wait";
    await zuKi(page);
    await verbinden(page, "codex");
    const panel = zeile(page, "codex").locator('[data-bereich="anmeldung"]');
    await expect(panel).toBeVisible({ timeout: 6000 });
    await expect(panel.locator('[data-test="an-browser"]')).toHaveText("Im Browser anmelden");
    await expect(panel.locator(".an-code")).toHaveText("ABCD-12345");
    expect(anfragen(z, "/api/mcp/verbinden")).toHaveLength(0); // erst nach der Anmeldung
    // während die Anmeldung läuft, bleibt die Einrichtung in diesem Schritt
    await expect(page.locator(sel("zurueck"))).toBeDisabled();
    z.laufPhase = "ok"; // die Abfrage der Werkstatt meldet „angemeldet“: die Zeile verbindet von selbst
    await expect(zeile(page, "codex").locator(".e-tick")).toBeVisible({ timeout: 12000 });
    expect(anfragen(z, "/api/mcp/verbinden")[0].body.ziel).toBe("codex");
  });

  test("Rückfall „Im Terminal anmelden“: der bisherige Weg (Terminal, Abfrage im Hintergrund) übernimmt, danach verbindet die Zeile von selbst", async ({ page }) => {
    const z = await oeffne(page, { login: { "std:codex": "nicht-angemeldet" } });
    z.laufPhase = "wait";
    await page.route("**/api/ki/anmelden", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ anzeige: "codex login" }) }));
    await zuKi(page);
    await verbinden(page, "codex");
    await zeile(page, "codex").locator('[data-test="an-terminal"]').click();
    await expect(zeile(page, "codex").locator('[data-kx="befehl"]')).toContainText("codex login", { timeout: 6000 });
    z.login["std:codex"] = "angemeldet";
    await expect(zeile(page, "codex").locator(".e-tick")).toBeVisible({ timeout: 12000 });
    expect(anfragen(z, "/api/mcp/verbinden")[0].body.ziel).toBe("codex");
  });

  test("Läuft die Frist der Anmeldung ab, ruft sie beiAbbruch auf: die Zeile geht zurück auf „Verbinden“", async ({ page }) => {
    const z = await oeffne(page, { login: { "std:codex": "nicht-angemeldet" } });
    z.laufPhase = "wait";
    await zuKi(page);
    await verbinden(page, "codex");
    await expect(zeile(page, "codex").locator('[data-bereich="anmeldung"]')).toBeVisible({ timeout: 6000 });
    z.laufPhase = "timeout";
    await expect(zeile(page, "codex").locator(sel("verbinden"))).toBeVisible({ timeout: 8000 });
    await expect(zeile(page, "codex").locator('[data-bereich="anmeldung"]')).toHaveCount(0);
  });

  test("Anmeldung abbrechen: die Zeile geht zurück auf „Verbinden“, nichts wird eingetragen", async ({ page }) => {
    const z = await oeffne(page, { login: { "std:codex": "nicht-angemeldet" } });
    z.laufPhase = "wait";
    await zuKi(page);
    await verbinden(page, "codex");
    await expect(zeile(page, "codex").locator('[data-bereich="anmeldung"]')).toBeVisible({ timeout: 6000 });
    await zeile(page, "codex").locator('[data-test="an-abbrechen"]').click();
    await expect(zeile(page, "codex").locator(sel("verbinden"))).toBeVisible();
    expect(anfragen(z, "/api/ki/anmeldelauf/abbrechen")).toHaveLength(1);
    expect(anfragen(z, "/api/mcp/verbinden")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- Auto-Überspringen
test.describe("Erfüllte Schritte entfallen", () => {
  test("KI schon für diesen Vault verbunden: der Schritt entfällt (zwei Pillen, Sicherung folgt)", async ({ page }) => {
    const z = await oeffne(page, { schonVerbunden: ["k_claude_privat"], zugriff: { k_claude_privat: { [VAULT]: "posteingang" } } });
    await bereit(page);
    await page.click(sel("weiter"));
    await expect(page.locator("#e-sync [data-wahl]").first()).toBeVisible({ timeout: 8000 });
    await expect(page.locator("#win")).toHaveAttribute("data-step", "sicherung");
    await expect(pillen(page)).toHaveCount(2);
    await expect(page.locator(".e-stand")).toHaveText("2 von 2");
    await expect(page.locator(".e-eyebrow")).toHaveText("Schritt 2 · Sicherung");
    expect(z.seitenfehler).toEqual([]);
  });

  test("Verbunden, aber nicht für diesen Vault (gesperrt dort): die KI-Zeile bleibt", async ({ page }) => {
    await oeffne(page, { schonVerbunden: ["k_claude_privat"], zugriff: { k_claude_privat: { [VAULT]: "gesperrt" } } });
    await zuKi(page);
    await expect(pillen(page)).toHaveCount(3);
  });

  test("Remote vorhanden: die Sicherung entfällt; ein Hinweis steht im KI-Schritt; nach der KI endet das Overlay (kein „Fertig“-Bild)", async ({ page }) => {
    const z = await oeffne(page, { gesichert: true });
    await zuKi(page);
    await expect(pillen(page)).toHaveCount(2);
    await expect(page.locator('[data-bereich="sicherung-entfaellt"]')).toContainText("Der Schritt „Sicherung“ entfällt");
    await expect(page.locator(sel("weiter"))).toContainText("Einrichtung abschließen");
    await page.click(sel("weiter"));
    await expect.poll(() => z.ende, { timeout: 6000 }).toEqual({ art: "fertig" });
    await expect(page.locator("#einrichtung-host")).toBeHidden({ timeout: 4000 });
    expect(z.schritte).toEqual(["vault", "ki"]);
  });

  test("KI verbunden UND Remote da: nach dem Vault endet die Einrichtung gleich", async ({ page }) => {
    const z = await oeffne(page, { gesichert: true, schonVerbunden: ["k_claude_privat"], zugriff: { k_claude_privat: { [VAULT]: "lesen" } } });
    await bereit(page);
    await page.click(sel("weiter"));
    await expect.poll(() => z.ende, { timeout: 8000 }).toEqual({ art: "fertig" });
    await expect(page.locator("#einrichtung-host")).toBeHidden({ timeout: 4000 });
    await expect(page.locator("#vault-name")).toHaveText("Kortex");
  });

  test("Ausdrücklich verlangter Schritt (Menü, Seitenleiste) wird nie übersprungen, auch wenn er erfüllt ist", async ({ page }) => {
    await oeffne(page, { vault: { pfad: VAULT, name: "Kortex" }, gesichert: true, schonVerbunden: ["k_claude_privat"], zugriff: { k_claude_privat: { [VAULT]: "posteingang" } } }, { ab: "ki" });
    await expect(zeile(page, "claude").locator(".e-tick")).toBeVisible({ timeout: 8000 });
    await expect(page.locator("#win")).toHaveAttribute("data-step", "ki");
    await expect(pillen(page)).toHaveCount(2); // Vault · KI (die Sicherung entfällt)
    await expect(page.locator(sel("weiter"))).toContainText("Einrichtung abschließen");
  });
});

// ---------------------------------------------------------------- Sicherung
test.describe("Sicherung: GitHub-Gerätecode im Overlay oder „Nur auf diesem Mac“", () => {
  for (const thema of ["light", "dark"]) {
    test.describe(`Darstellung ${thema}`, () => {
      test.use({ colorScheme: thema });
      test("Zwei Wege; GitHub ist vorgewählt; der Gerätecode läuft im Overlay; danach Repository anlegen und verbinden; Ende", async ({ page }) => {
        const z = await oeffne(page);
        await zuSicherung(page);
        await expect(page.locator('[data-wahl="github"]')).toHaveAttribute("aria-checked", "true");
        await expect(page.locator('[data-wahl="github"] .e-badge')).toHaveText("Empfohlen");
        await expect(page.locator('[data-wahl="lokal"] b')).toHaveText("Nur auf diesem Mac");
        await expect(page.locator("#e-sync")).toContainText("Berechtigung „repo“");
        await expect(page.locator(sel("weiter"))).toContainText("Mit GitHub verbinden");
        await bild(page, "e2-3-sicherung", thema);
        await page.click(sel("weiter"));
        await expect(page.locator(".e-code")).toBeVisible({ timeout: 6000 });
        await expect(page.locator("#thd h1")).toHaveText("Mit GitHub verbinden");
        await expect(page.locator(".e-code span:not(.strich)")).toHaveText(["W", "D", "J", "B", "M", "J", "H", "T"]);
        await expect(page.locator("#zeit")).toHaveText(/^1[45]:\d\d$/);
        await bild(page, "e2-3b-code", thema);
        await page.click(sel("kopieren"));
        await expect.poll(() => z.zwischenablage).toBe("WDJB-MJHT");
        await page.click(sel("github-oeffnen"));
        await expect.poll(() => z.aktionen.some((a) => a.aktion === "extern" && a.wert === "https://github.com/login/device")).toBe(true);
        z.codeZustand = "fertig";
        await expect(page.locator(".e-konto")).toContainText("fabiobrogno", { timeout: 8000 });
        await expect(page.locator('[data-feld="repo"]')).toHaveValue("kortex");
        await expect(page.locator(sel("weiter"))).toContainText("Einrichtung abschließen");
        await bild(page, "e2-3c-repo", thema);
        await page.click(sel("weiter"));
        await expect.poll(() => z.ende, { timeout: 8000 }).toEqual({ art: "fertig" });
        expect(z.repo).toEqual({ name: "kortex", besitzer: "fabiobrogno", privat: true });
        expect(z.verbunden).toEqual({ besitzer: "fabiobrogno", name: "kortex" });
        expect(z.schritte).toEqual(["vault", "ki", "sicherung"]);
      });
    });
  }

  test("„Nur auf diesem Mac“: nichts wird bei GitHub angefragt, die Einrichtung endet", async ({ page }) => {
    const z = await oeffne(page);
    await zuSicherung(page);
    await page.click('[data-wahl="lokal"]');
    await expect(page.locator('[data-wahl="lokal"]')).toHaveAttribute("aria-checked", "true");
    await expect(page.locator(sel("weiter"))).toContainText("Einrichtung abschließen");
    await page.click(sel("weiter"));
    await expect.poll(() => z.ende, { timeout: 6000 }).toEqual({ art: "fertig" });
    expect(anfragen(z, "/api/github/anmelden")).toHaveLength(0);
    expect(anfragen(z, "/api/github/repo-anlegen")).toHaveLength(0);
    expect(z.schritte).toEqual(["vault", "ki", "sicherung"]);
  });

  test("Schon bei GitHub angemeldet: gleich Konto und Repository-Feld; „Nur auf diesem Mac“ bleibt wählbar", async ({ page }) => {
    const z = await oeffne(page, { github: { verfuegbar: true, angemeldet: true, login: "fabiobrogno" } });
    await zuSicherung(page);
    await expect(page.locator(".e-konto")).toContainText("fabiobrogno");
    await expect(page.locator('[data-wahl="github"]')).toBeVisible();
    await page.click('[data-wahl="lokal"]');
    await expect(page.locator('[data-feld="repo"]')).toHaveCount(0);
    await page.click(sel("weiter"));
    await expect.poll(() => z.ende, { timeout: 6000 }).toEqual({ art: "fertig" });
    expect(anfragen(z, "/api/github/repo-anlegen")).toHaveLength(0);
  });

  test("Gerätecode läuft ab: Zustand „Abgelaufen“, neuer Code per Hauptknopf", async ({ page }) => {
    const z = await oeffne(page, { ablaufSekunden: 2 });
    await zuSicherung(page);
    await page.click(sel("weiter"));
    await expect(page.locator(".e-code")).toBeVisible({ timeout: 6000 });
    await expect(page.locator(".e-badge.warn")).toContainText("Abgelaufen", { timeout: 6000 });
    await expect(page.locator(sel("weiter"))).toContainText("Neuen Code holen");
    z.ablaufSekunden = 899;
    await page.click(sel("weiter"));
    await expect(page.locator(".e-code-status .e-shimmer")).toContainText("Warte auf deine Bestätigung", { timeout: 6000 });
    expect(z.anmeldungen).toBe(2);
  });

  test("Abgelehnt, abgebrochen, GitHub nicht erreichbar, nicht eingerichtet, blockiert", async ({ page }) => {
    const z = await oeffne(page);
    await zuSicherung(page);
    await page.click(sel("weiter"));
    await expect(page.locator(".e-code")).toBeVisible({ timeout: 6000 });
    z.codeZustand = "abgelehnt";
    await expect(page.locator(".e-badge.warn")).toContainText("Abgelehnt", { timeout: 6000 });
    await page.click(sel("abbrechen"));
    await expect(page.locator('[data-wahl="github"]')).toBeVisible();
    expect(anfragen(z, "/api/github/abbrechen").length).toBeGreaterThanOrEqual(1);
    z.anmeldenFehler = { status: 502, fehler: "kein Netz" };
    await page.click(sel("weiter"));
    await expect(page.locator('[data-bereich="sync-fehler"]')).toContainText("GitHub ist gerade nicht erreichbar");
  });

  test("GitHub in dieser Version nicht eingerichtet: der Schritt sagt es und lässt weitergehen", async ({ page }) => {
    const z = await oeffne(page, { github: { verfuegbar: false, angemeldet: false } });
    await zuKi(page);
    await page.click(sel("weiter"));
    await expect(page.locator("#e-sync")).toContainText("nicht eingerichtet", { timeout: 6000 });
    await page.click(sel("weiter"));
    await expect.poll(() => z.ende, { timeout: 6000 }).toEqual({ art: "fertig" });
  });

  test("Sicherung blockiert (noch keine Version): Hinweis, „Erneut prüfen“, die Einrichtung geht weiter", async ({ page }) => {
    const z = await oeffne(page, { sicherungBlockiert: true });
    await zuKi(page);
    await page.click(sel("weiter"));
    await expect(page.locator("#e-sync .e-warnkarte")).toContainText("Die Sicherung ist gerade nicht möglich", { timeout: 6000 });
    z.sicherungBlockiert = false;
    await page.click(sel("sync-neu"));
    await expect(page.locator('[data-wahl="github"]')).toBeVisible({ timeout: 6000 });
  });

  test("Repository-Name vergeben: das vorhandene Repository wird angeboten und beendet die Einrichtung", async ({ page }) => {
    const z = await oeffne(page, { github: { verfuegbar: true, angemeldet: true, login: "fabiobrogno" }, repoVergeben: "kortex" });
    await zuSicherung(page);
    await page.click(sel("weiter"));
    await expect(page.locator('[data-bereich="sync-fehler"]')).toContainText("gibt es schon bei dir", { timeout: 6000 });
    await page.click(sel("vorhanden-nehmen"));
    await expect.poll(() => z.ende, { timeout: 6000 }).toEqual({ art: "fertig" });
    expect(z.verbunden).toEqual({ besitzer: "fabiobrogno", name: "kortex" });
  });

  test("Die Adresse des Gerätecodes wird nur geöffnet, wenn sie https und github.com ist", async ({ page }) => {
    const z = await oeffne(page, { anmeldeUrl: "https://github.com.evil.example/login/device" });
    await zuSicherung(page);
    await page.click(sel("weiter"));
    await expect(page.locator(".e-code")).toBeVisible();
    await page.click(sel("github-oeffnen"));
    await expect(page.locator(".toast.fehler")).toContainText("gehört nicht zu GitHub");
    expect(z.aktionen.some((a) => a.aktion === "extern")).toBe(false);
  });
});

// ---------------------------------------------------------------- Fortsetzen, Sitzung, Überspringen
test.describe("Fortsetzen und Sitzung", () => {
  test("Jeder erledigte Schritt geht an die Hülle (einrichtung-schritt), der Reihe nach", async ({ page }) => {
    const z = await oeffne(page);
    await zuSicherung(page);
    expect(z.schritte).toEqual(["vault", "ki"]);
    await page.click('[data-wahl="lokal"]');
    await page.click(sel("weiter"));
    await expect.poll(() => z.ende).toEqual({ art: "fertig" });
    expect(z.schritte).toEqual(["vault", "ki", "sicherung"]);
  });

  test("Neuladen mitten in der Einrichtung: die Seite meldet „zu“, die Rechte enden; der Befehl der Hülle macht beim nächsten Schritt weiter", async ({ page }) => {
    const z = await oeffne(page);
    await zuKi(page);
    expect(z.sitzung).toBe(true);
    await page.reload();
    await page.waitForFunction(() => window.__studioBereit === true);
    // nach dem Neuladen steht kein Overlay mehr da, und die Seite hat der Hülle „zu“ gemeldet: nichts bleibt offen
    await expect(page.locator("#einrichtung-host")).toBeHidden();
    expect(z.sitzung).toBe(false);
    expect(z.sitzungen.at(-1)).toBe(false);
    expect(z.schritte).toEqual(["vault"]);
    // die Hülle öffnet das Overlay dort, wo es weitergeht (letzterSchritt = vault → ki)
    await page.evaluate(() => window.studio.befehl("einrichtung", { ab: "ki" }));
    await page.waitForFunction(() => window.__einrichtungBereit === true);
    await expect(ki(page).locator(".e-kr").first()).toBeVisible({ timeout: 8000 });
    await expect(page.locator("#win")).toHaveAttribute("data-step", "ki");
    expect(z.sitzung).toBe(true);
    await expect(page.locator("#stepper .e-pill.erledigt")).toHaveCount(1); // der Vault ist erledigt
  });

  test("Fortsetzen ab Sicherung: mit vorhandenem Vault geht es dort weiter; der Vault-Pill ist erledigt und anklickbar", async ({ page }) => {
    await oeffne(page, { vault: { pfad: "/Users/test/Notizen", name: "Notizen" }, github: { verfuegbar: true, angemeldet: true, login: "fabiobrogno" } }, { ab: "sicherung" });
    await expect(page.locator("#win")).toHaveAttribute("data-step", "sicherung", { timeout: 8000 });
    await expect(page.locator(".e-konto")).toContainText("fabiobrogno");
    await expect(page.locator('[data-feld="repo"]')).toHaveValue("notizen");
    await expect(page.locator('#stepper .e-pill[data-sprung="vault"]')).toBeEnabled();
    await page.click('#stepper .e-pill[data-sprung="vault"]');
    await expect(page.locator(".e-aktuell")).toHaveText("Aktueller Vault: Notizen");
  });

  test("Befehl zweimal gesendet: es bleibt ein Overlay", async ({ page }) => {
    const z = await oeffne(page, { vault: { pfad: VAULT, name: "Kortex" } }, { ab: "ki" });
    await page.evaluate(() => { window.studio.befehl("einrichtung", { ab: "ki" }); window.studio.befehl("einrichtung", { ab: "sicherung" }); });
    await expect(page.locator("#einrichtung-host .e-win")).toHaveCount(1);
    expect(z.sitzungen.filter((s) => s === true)).toHaveLength(1);
  });

  test("„Später“ (Fußleiste, leise links): Rückfrage, dann Ende ohne etwas anzulegen; leerer Zustand", async ({ page }) => {
    const z = await oeffne(page);
    await bereit(page);
    await expect(page.locator(sel("spaeter"))).toHaveText("Später");
    await page.click(sel("spaeter"));
    await expect(page.locator(".dialog")).toContainText("Einrichtung überspringen?");
    await expect(page.locator(sel("spaeter-nein"))).toBeFocused();
    await page.waitForTimeout(450);
    await page.click(sel("spaeter-ja"));
    await expect.poll(() => z.ende).toEqual({ art: "spaeter" });
    for (const pfad of ["/api/vaults/neu", "/api/vaults/oeffnen", "/api/vaults/klonen", "/api/mcp/verbinden", "/api/github/repo-anlegen"]) expect(anfragen(z, pfad)).toHaveLength(0);
    expect(z.schritte).toBeUndefined();
    await expect(page.locator("#einrichtung-host")).toBeHidden({ timeout: 4000 });
    await expect(page.locator(".w-leer h1")).toHaveText("Noch kein Vault");
    expect(z.sitzung).toBe(false);
  });

  test("„Später“ mitten im KI-Schritt: der angelegte Vault bleibt, es wird nichts weiter eingetragen", async ({ page }) => {
    const z = await oeffne(page);
    await zuKi(page);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(450);
    await page.click(sel("spaeter-ja"));
    await expect.poll(() => z.ende).toEqual({ art: "spaeter" });
    expect(anfragen(z, "/api/mcp/verbinden")).toHaveLength(0);
    await expect(page.locator("#vault-name")).toHaveText("Kortex");
  });

  test("Überspringen legt auch dann nichts an, wenn der Stand nicht lesbar ist", async ({ page }) => {
    const z = await mockeEinrichtung(page, {});
    await oeffneEinrichtungImStudio(page, server.url, z, { ab: "ki", vorBefehl: () => { z.infoFehler = true; } }); // der Stand ist erst unlesbar, wenn die Einrichtung läuft
    await bereit(page);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(450);
    await page.click(sel("spaeter-ja"));
    await expect.poll(() => z.ende, { timeout: 5000 }).toEqual({ art: "spaeter" });
    expect(anfragen(z, "/api/vaults/neu")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- Tastatur und Bedienung
test.describe("Tastatur und Bedienung", () => {
  test("⌘↩ geht weiter (↩ nur außerhalb von Feldern und Knöpfen), ⌘[ zurück, 1–4 wählt den Weg, Pfeile bewegen die Auswahl", async ({ page }) => {
    await oeffne(page);
    await bereit(page);
    await page.evaluate(() => document.body.focus());
    await page.keyboard.press("2");
    await expect(page.locator('[data-weg="oeffnen"]')).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("4");
    await expect(page.locator('[data-weg="beispiel"]')).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("1");
    await page.focus('[data-weg="neu"]');
    await page.keyboard.press("ArrowDown");
    await expect(page.locator('[data-weg="oeffnen"]')).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("ArrowUp");
    await expect(page.locator('[data-weg="neu"]')).toHaveAttribute("aria-checked", "true");
    // im Textfeld ändert die Ziffer nichts und ↩ geht nicht weiter
    await page.click('[data-weg="klonen"]');
    await page.fill('[data-feld="url"]', "a/b");
    await page.press('[data-feld="url"]', "2");
    await expect(page.locator('[data-weg="klonen"]')).toHaveAttribute("aria-checked", "true");
    await page.press('[data-feld="url"]', "Enter");
    await expect(page.locator("#win")).toHaveAttribute("data-step", "vault");
    await page.click('[data-weg="neu"]');
    await page.keyboard.press("Meta+Enter");
    await expect(ki(page).locator(".e-kr").first()).toBeVisible({ timeout: 8000 });
    await page.keyboard.press("Meta+[");
    await expect(page.locator("#win")).toHaveAttribute("data-step", "vault");
  });

  test("Pillen: erledigte Schritte sind anklickbar, spätere gesperrt", async ({ page }) => {
    await oeffne(page);
    await zuKi(page);
    await expect(page.locator('#stepper .e-pill[data-sprung="vault"]')).toBeEnabled();
    await expect(page.locator('#stepper .e-pill[data-sprung="sicherung"]')).toBeDisabled();
    await page.click('#stepper .e-pill[data-sprung="vault"]');
    await expect(page.locator("#win")).toHaveAttribute("data-step", "vault");
    await expect(page.locator('#stepper .e-pill[data-sprung="ki"]')).toBeEnabled(); // weitester erreichter Schritt
    // der Vault ist schon da und die Eingaben sind unverändert: „Weiter“ legt nichts noch einmal an
    await page.click(sel("weiter"));
    await expect(ki(page).locator(".e-kr").first()).toBeVisible();
    // (der Aufruf unten würde ein zweites Mal anlegen)
  });

  test("Vault-Fehler bleiben im Schritt: die Einrichtung geht nicht weiter und sagt, was los ist", async ({ page }) => {
    await oeffne(page, { neuFehler: { status: 409, fehler: "Der Ordner ist nicht leer." } });
    await bereit(page);
    await page.click(sel("weiter"));
    await expect(page.locator(".toast.fehler")).toContainText("Der Ordner ist nicht leer.");
    await expect(page.locator("#win")).toHaveAttribute("data-step", "vault");
    await expect(page.locator(sel("weiter"))).toBeEnabled();
  });

  test("ohne App (Browser): Ordner wählen fragt nach dem Pfad", async ({ page }) => {
    await oeffne(page, { app: false });
    await bereit(page);
    await page.click('[data-weg="oeffnen"]');
    await page.click(sel("waehle"));
    await page.fill('[data-feld="pfad"]', "/Users/test/Notizen");
    await page.click(sel("pfad-uebernehmen"));
    await expect(page.locator("#v-ordner")).toHaveText("~/Notizen");
  });

  test("keine nativen Felder und keine Fremdbausteine im Ablauf", async ({ page }) => {
    await oeffne(page);
    await bereit(page);
    await page.click('[data-weg="klonen"]');
    const r = await page.evaluate(() => ({ selects: document.querySelectorAll("#einrichtung-host select, #einrichtung-host textarea").length, nativeKnoepfe: [...document.querySelectorAll("#einrichtung-host button.knopf")].filter((b) => !b.classList.contains("bs-knopf")).length }));
    expect(r).toEqual({ selects: 0, nativeKnoepfe: 0 });
  });
});

test.describe("Bewegung reduzieren", () => {
  test.use({ reducedMotion: "reduce" });
  test("kein Gleiten, kein Schimmern: Animationen laufen mit 0 ms, der Ablauf bleibt bedienbar", async ({ page }) => {
    await oeffne(page);
    await bereit(page);
    const d = await page.evaluate(() => ({ uebergang: getComputedStyle(document.querySelector("#win")).transitionDuration, sub: getComputedStyle(document.querySelector(".e-sub-x")).transitionDuration }));
    expect(d.uebergang).toMatch(/^0(\.0+1?)?m?s|^1e-05s/);
    expect(d.sub).toMatch(/^0(\.0+1?)?m?s|^1e-05s/);
    await page.keyboard.press("Meta+Enter");
    await expect(ki(page).locator(".e-kr").first()).toBeVisible({ timeout: 8000 });
  });
});

// ---------------------------------------------------------------- Checkliste in der Seitenleiste
test.describe("Checkliste „Einrichtung n/4“ nach der Einrichtung", () => {
  async function fertig(page, opt = {}) {
    const z = await oeffne(page, { verwaltet: ["k_claude_privat"], ...opt });
    await zuKi(page);
    await verbinden(page, "claude");
    await expect(zeile(page, "claude").locator(".e-tick")).toBeVisible({ timeout: 8000 });
    await page.click(sel("weiter"));
    if (!opt.gesichert) { await page.click('[data-wahl="lokal"]'); await page.click(sel("weiter")); }
    await expect(page.locator("#einrichtung-host")).toBeHidden({ timeout: 6000 });
    return z;
  }

  test("Ring und Zähler, eingeklappt; Aufklappen zeigt vier Punkte, erledigte sind abgehakt", async ({ page }) => {
    await fertig(page);
    const liste = page.locator(".e-chk");
    await expect(liste).toBeVisible({ timeout: 6000 });
    await expect(liste).toHaveAttribute("data-offen", "false");
    await expect(liste.locator(".e-ring")).toBeVisible();
    // KI verbunden, Kontingent eingerichtet (Vorgabe an) → 2/4; Sicherung (nur auf diesem Mac) und Mitteilungen offen
    await expect(page.locator('[data-feld="zaehler"]')).toHaveText("2/4", { timeout: 6000 });
    await expect(page.locator(".e-chk-b ul")).toBeHidden();
    await page.click(sel("einrichtung-liste"));
    await expect(liste).toHaveAttribute("data-offen", "true");
    await expect(page.locator(".e-ci")).toHaveText(["KI verbinden (erledigt)", "Sicherung (offen)", "Kontingent anzeigen (erledigt)", "Mitteilungen (offen)"]);
    await expect(page.locator('.e-ci[data-punkt="ki"]')).toHaveAttribute("data-erledigt", "true");
    await expect(page.locator('.e-ci[data-punkt="sicherung"]')).toHaveAttribute("data-erledigt", "false");
    await expect(page.locator("#einrichtung-zeile")).toBeHidden(); // statt des leisen Eintrags
  });

  test("Ein Klick auf „Sicherung“ öffnet die Einrichtung dort; „Mitteilungen“ öffnet die Einstellungen und hakt ab", async ({ page }) => {
    const z = await fertig(page);
    await page.click(sel("einrichtung-liste"));
    await page.click('.e-ci[data-punkt="sicherung"]');
    await expect.poll(() => z.oeffnenAnfragen).toEqual([{ ab: "sicherung" }]);
    await expect(page.locator("#win")).toHaveAttribute("data-step", "sicherung", { timeout: 8000 });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(450);
    await page.click(sel("spaeter-ja"));
    await expect(page.locator("#einrichtung-host")).toBeHidden({ timeout: 4000 });
    await page.click('.e-ci[data-punkt="mitteilungen"]');
    await expect(page.locator('.e-ci[data-punkt="mitteilungen"]')).toHaveAttribute("data-erledigt", "true");
  });

  test("Ausblenden mit „Rückgängig“; die Wahl bleibt nach dem Neuladen; dann steht wieder der leise Eintrag da", async ({ page }) => {
    await fertig(page);
    await expect(page.locator(".e-chk")).toBeVisible({ timeout: 6000 });
    await page.hover(".e-chk");
    await page.click(sel("einrichtung-liste-aus"));
    await expect(page.locator(".e-chk")).toHaveCount(0);
    await expect(page.locator("#einrichtung-zeile")).toBeVisible();
    await expect(page.locator(".toast", { hasText: "Einrichtung ausgeblendet" })).toBeVisible();
    await page.click(".toast >> text=Rückgängig");
    await expect(page.locator(".e-chk")).toBeVisible();
    await page.hover(".e-chk");
    await page.click(sel("einrichtung-liste-aus"));
    await page.reload();
    await page.waitForFunction(() => window.__studioBereit === true);
    await expect(page.locator("#vault-name")).toHaveText("Kortex");
    await expect(page.locator(".e-chk")).toHaveCount(0);
    await expect(page.locator("#einrichtung-zeile")).toBeVisible();
  });

  test("Vier von vier: die Liste verschwindet von selbst", async ({ page }) => {
    const z = await fertig(page, { gesichert: true });
    await page.click(sel("einrichtung-liste"));
    await page.click('.e-ci[data-punkt="mitteilungen"]');
    await expect(page.locator(".e-chk")).toHaveCount(0, { timeout: 6000 });
    expect(z.statuszeile).toHaveLength(1);
  });

  test("Wer die App schon nutzt (nie eine Einrichtung auf diesem Gerät): keine Checkliste, nur der leise Eintrag", async ({ page }) => {
    const z = await mockeEinrichtung(page, { vault: { pfad: VAULT, name: "Kortex" } });
    await page.addInitScript(() => { window.__studioAlsApp = true; });
    await page.goto(server.url);
    await page.waitForFunction(() => window.__studioBereit === true);
    await expect(page.locator("#vault-name")).toHaveText("Kortex");
    await expect(page.locator(".e-chk")).toHaveCount(0);
    await expect(page.locator("#einrichtung-zeile")).toBeVisible();
    expect(z.sitzungen).toEqual([false]);
  });
});

// ---------------------------------------------------------------- echte Werkstatt
test.describe("Echte Werkstatt ohne Vault (Wegwerf-HOME)", () => {
  test("Neuer Vault und Sicherung-Status laufen gegen die echten Routen", async ({ page }) => {
    const home = mkdtempSync(join(tmpdir(), "kortex-einrichtung-"));
    const support = mkdtempSync(join(tmpdir(), "kortex-einrichtung-support-"));
    // Die Suche nach KI-Programmen sieht nur einen leeren PATH-Ordner: nie ein echtes claude oder codex dieses Rechners
    const leer = mkdtempSync(join(tmpdir(), "kortex-einrichtung-bin-"));
    const umgebung = { PATH: pfadMit(leer), HOME: home, LANG: "de_DE.UTF-8", TMPDIR: tmpdir() };
    const s = await starteServer(null, { umgebung, support });
    try {
      await page.addInitScript(() => { window.webkit = { messageHandlers: { aktion: { postMessage: async (m) => (m.aktion === "git-pruefen" ? { stand: "vorhanden" } : { ok: true }) } } }; });
      await oeffneEinrichtungImStudio(page, s.url, null);
      await expect(page.locator(sel("weiter"))).toBeEnabled({ timeout: 8000 });
      await page.click(sel("weiter")); // Neuer Vault, Vorgabe ~/Kortex
      await expect(page.locator("#win")).toHaveAttribute("data-step", "ki", { timeout: 60000 });
      expect(existsSync(join(home, "Kortex", ".git"))).toBe(true);
      expect(existsSync(join(home, "Kortex", "brain.config.json"))).toBe(true);
      await page.click(sel("weiter")); // keine KI gefunden: weiter
      // GitHub ist in dieser Werkstatt nicht eingerichtet (keine Client-ID): der Schritt sagt es und lässt weitergehen
      await expect(page.locator("#e-sync")).toContainText("nicht eingerichtet", { timeout: 8000 });
    } finally { s.stopp(); }
  });
});
