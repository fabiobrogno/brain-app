// „Kortex im Browser“ (Paket W1) gegen den ECHTEN Startbefehl (Ressourcen/werkstatt/start.mjs, browser-start.mjs): Zugang über die Einlass-Adresse, Einrichtung (E1/E2) mit Ordnerwahl der Browser-Hülle,
// Notiz bearbeiten und speichern, Einstellungen (ohne Dock/macOS-Mitteilungen), Anmelde-Panel (E3) mit Platzhalter-Programmen, Hülle im Browser (Zwischenablage, extern). Wegwerf-Ordner, kein echtes Konto, kein Browserstart.
import { test, expect } from "./basis.mjs";
import { writeFileSync, mkdirSync, mkdtempSync, readFileSync, chmodSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { baueVault } from "./vault.mjs";
import { starteBrowserDienst } from "./browser-start.mjs";
import { legeProgramm } from "../Node/attrappe.mjs";

const WINDOWS = process.platform === "win32";
const VERTRAG = JSON.parse(readFileSync(new URL("../../Ressourcen/studio/huellen-vertrag.json", import.meta.url), "utf8"));
let dienst, vault;
test.afterEach(async () => { await dienst?.stopp(); dienst = null; });

const fehlerSammeln = (page) => { const f = []; page.on("pageerror", (e) => f.push(String(e))); return f; };
async function oeffne(page, { mitVault = true, pfad, hash, ...opt } = {}) {
  if (mitVault) ({ vault } = baueVault());
  dienst = await starteBrowserDienst({ vault: mitVault ? vault : null, ...opt });
  await page.goto(await dienst.einlass());
  if (mitVault) await expect.poll(() => page.evaluate(() => window.__studioBereit === true)).toBe(true);
  if (pfad || hash) { await page.goto(`${dienst.url}${pfad ? "?pfad=" + encodeURIComponent(pfad) : ""}${hash || ""}`); }
}

test("Zugang: ohne Link nur die Hinweisseite, mit dem Einlass-Link das Studio; die Karte steht danach nicht mehr in der Adresse und der Cookie ist nicht lesbar", async ({ page, context }) => {
  ({ vault } = baueVault());
  dienst = await starteBrowserDienst({ vault });
  await page.goto(dienst.url);
  await expect(page.locator("h1")).toHaveText("Kortex: Zugang fehlt");
  await expect(page.locator("#app")).toHaveCount(0);
  const link = await dienst.einlass();
  await page.goto(link);
  await expect.poll(() => page.evaluate(() => window.__studioBereit === true)).toBe(true);
  expect(page.url()).toBe(dienst.url);
  expect(await page.evaluate(() => document.cookie)).toBe("");
  const cookies = await context.cookies(dienst.url);
  expect(cookies).toHaveLength(1);
  expect(cookies[0]).toMatchObject({ httpOnly: true, sameSite: "Strict", name: `kortex_s_${dienst.port}` });
  // derselbe Link ein zweites Mal: abgelaufen
  const zweiter = await context.newPage();
  await zweiter.goto(link);
  await expect(zweiter.locator("h1")).toHaveText("Kortex: Link abgelaufen");
  expect(dienst.ausgabe()).not.toContain(new URL(link).searchParams.get("t"));
});

test("Browser-Modus: Hülle da, Studio erkennt ihn, Finder/Übersicht fehlen, Notiz lässt sich bearbeiten und speichert bytegleich", async ({ page }) => {
  const fehler = fehlerSammeln(page);
  await oeffne(page, { pfad: "10_notizen/Reise nach Lissabon.md" });
  await page.waitForSelector(".cm-content .cm-line");
  expect(await page.evaluate(() => ({ art: window.kortexHuelle?.art, nativ: !!window.webkit, anzahl: window.kortexHuelle?.aktionen?.length }))).toEqual({ art: "browser", nativ: false, anzahl: VERTRAG.aktionen.length });
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.type("Browser-Zeile äöü 🙂");
  await expect(page.locator("#speicherstand")).toHaveText("Gespeichert", { timeout: 5000 });
  expect(readFileSync(join(vault, "10_notizen/Reise nach Lissabon.md"), "utf8")).toBe("# Reise nach Lissabon\n\nFlug im Mai. Hotel in der Alfama. Mietwagen nicht nötig.\nBrowser-Zeile äöü 🙂");
  // Befehlspalette: kein „Im Finder zeigen“, keine Übersicht (gibt es nur in der App)
  await page.evaluate(() => window.studio.palette());
  await expect(page.locator(".palette, [data-palette]").first()).toBeVisible();
  await expect(page.locator(".palette, [data-palette]").first()).not.toContainText("Finder");
  await page.keyboard.press("Escape");
  expect(fehler).toEqual([]);
});

test("Einrichtung (E1/E2): erster Start ohne Vault öffnet sie von selbst; Ordner öffnen mit der Ordnerwahl der Browser-Hülle (Pfad, Unterordner, zuletzt benutzt)", async ({ page }) => {
  const fehler = fehlerSammeln(page);
  const ordner = realpathSync.native(mkdtempSync(join(tmpdir(), "kortex-browser-notizen-")));
  mkdirSync(join(ordner, "Unter"), { recursive: true });
  writeFileSync(join(ordner, "A.md"), "# A\n"); writeFileSync(join(ordner, "Unter", "B.md"), "# B\n");
  await oeffne(page, { mitVault: false });
  await expect(page.locator("#einrichtung-host .e-win")).toHaveCount(1, { timeout: 8000 });
  await page.click('[data-weg="oeffnen"]');
  await page.click('[data-aktion="waehle"]');
  // die Ordnerwahl der Hülle: Dialog mit Pfadfeld und Liste
  const dlg = page.locator("#dialog-host .dialog");
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('[data-bereich="unterordner"]')).toBeVisible();
  // ungültige Eingaben: Meldungen statt Absturz
  await dlg.locator('[data-feld="pfad"]').fill("relativer/pfad");
  await page.click('[data-aktion="ordner-uebernehmen"]');
  await expect(dlg.locator(".bs-fehler")).toContainText("vollständig");
  await dlg.locator('[data-feld="pfad"]').fill(join(ordner, "gibt-es-nicht"));
  await page.click('[data-aktion="ordner-uebernehmen"]');
  await expect(dlg.locator(".bs-fehler")).toContainText("gibt es nicht");
  // Unterordner-Liste: Klick auf den Ordner übernimmt seinen Pfad ins Feld
  await dlg.locator('[data-feld="pfad"]').fill(ordner);
  await dlg.locator('[data-feld="pfad"]').press("Enter");
  await expect(dlg).toBeHidden();
  await expect(page.locator('[data-feld="zaehlung"]')).toContainText("2 Notizen");
  expect(JSON.parse(readFileSync(join(dienst.support, "browser-zuletzt.json"), "utf8"))).toEqual([ordner]);
  // beim nächsten Öffnen steht er unter „zuletzt benutzt“, und die Liste zeigt die Unterordner
  await page.click('[data-aktion="waehle"]');
  await expect(page.locator('#dialog-host .hb-chip[data-pfad]').first()).toHaveAttribute("data-pfad", ordner);
  await expect(page.locator('#dialog-host .hb-zeile', { hasText: "Unter" })).toBeVisible();
  await page.click('[data-aktion="ordner-abbrechen"]');
  await expect(page.locator("#dialog-host .dialog")).toHaveCount(0);
  expect(fehler).toEqual([]);
});

test("Hülle im Browser: nur bei offener Einrichtung gelten Zwischenablage/git; extern nur https; nicht Verfügbares antwortet sauber", async ({ page, context }) => {
  await oeffne(page, { mitVault: false });
  await expect(page.locator("#einrichtung-host .e-win")).toHaveCount(1, { timeout: 8000 });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: dienst.url.replace(/\/$/, "") });
  const r = await page.evaluate(async () => {
    const h = window.kortexHuelle;
    const aus = {};
    aus.ansicht = await h.aktion("ansicht");
    aus.finder = await h.aktion("ordner-zeigen", "x.md");
    aus.symbol = await h.aktion("app-symbol", "dunkel");
    aus.kuerzel = await h.aktion("kuerzel-global", { id: "x", kuerzel: "Cmd+X" });
    aus.http = await h.aktion("extern", "http://example.org/");
    aus.js = await h.aktion("extern", "javascript:alert(1)");
    aus.fremd = await h.aktion("extern", "https://example.org/"); // Einrichtung offen: nur GitHub und die Anmeldung
    aus.unbekannt = await h.aktion("gibt-es-nicht");
    aus.git = await h.aktion("git-pruefen");
    aus.kopieren = await h.aktion("kopieren", "ABCD-12345");
    aus.zuLang = await h.aktion("kopieren", "x".repeat(401));
    aus.zeilen = await h.aktion("kopieren", "a\nb");
    aus.gitInstall = await h.aktion("git-installieren");
    return aus;
  });
  expect(r.ansicht).toEqual({ ok: false, grund: "kein-kit" });
  expect(r.finder).toEqual({ ok: false, grund: "browser-vorschau" });
  expect(r.symbol).toEqual({ ok: false, grund: "browser-vorschau" });
  expect(r.kuerzel.ok).toBe(false);
  expect(r.http).toEqual({ ok: false, grund: "adresse-nicht-erlaubt" });
  expect(r.js).toEqual({ ok: false, grund: "adresse-nicht-erlaubt" });
  expect(r.fremd).toEqual({ ok: false, grund: "adresse-nicht-erlaubt" });
  expect(r.unbekannt).toEqual({ ok: false, grund: "unbekannt" });
  expect(["vorhanden", "fehlt", "defekt", "nicht-pruefbar"]).toContain(r.git.stand);
  expect(r.kopieren).toEqual({ ok: true });
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("ABCD-12345");
  expect(r.zuLang).toEqual({ ok: false, grund: "text-nicht-erlaubt" });
  expect(r.zeilen).toEqual({ ok: false, grund: "text-nicht-erlaubt" });
  expect(r.gitInstall.ok).toBe(false);
  expect(r.gitInstall.meldung).toMatch(/Git/);
  // Einrichtung schließen („Später“): danach gelten die Einrichtungs-Aktionen nicht mehr
  await page.keyboard.press("Escape");
  await page.click('[data-aktion="spaeter-ja"]');
  await expect(page.locator("#einrichtung-host")).toBeHidden({ timeout: 6000 });
  expect(await page.evaluate(() => window.kortexHuelle.aktion("kopieren", "x"))).toEqual({ ok: false, grund: "einrichtung-nicht-offen" });
  expect(JSON.parse(readFileSync(join(dienst.support, "browser-einrichtung.json"), "utf8")).ende).toBe("spaeter");
  // nach „Später“ öffnet ein Neuladen die Einrichtung nicht noch einmal von selbst
  await page.reload();
  await expect(page.locator('[data-aktion="leer-neuer-vault"]')).toBeVisible({ timeout: 8000 });
  await expect(page.locator("#einrichtung-host .e-win")).toHaveCount(0);
  // extern im Vordergrund: https öffnet einen neuen Tab (ohne Verbindung zum Studio)
  await context.route("https://example.org/**", (route) => route.fulfill({ contentType: "text/html", body: "<title>extern</title>" }));
  const [neu] = await Promise.all([context.waitForEvent("page"), page.evaluate(() => window.kortexHuelle.aktion("extern", "https://example.org/x"))]);
  await neu.waitForLoadState();
  expect(neu.url()).toBe("https://example.org/x");
  expect(await neu.evaluate(() => window.opener)).toBeNull();
});

test("Einstellungen im Browser-Modus: Seite öffnet, Dock-Symbol und macOS-Mitteilungen fehlen, Thema lässt sich ändern", async ({ page }) => {
  const fehler = fehlerSammeln(page);
  await oeffne(page, { hash: "#einstellungen/darstellung" });
  await expect(page.locator("[data-einstellungen]")).toBeVisible({ timeout: 8000 });
  await expect(page.locator('section[data-bereich="darstellung"]')).toBeVisible();
  await expect(page.locator('[data-abschnitt-orig="dock"]')).toHaveCount(0);
  await expect(page.locator('[data-einstellungen]')).not.toContainText("App-Symbol");
  await page.evaluate(() => { location.hash = "#einstellungen/mitteilungen"; });
  await expect(page.locator('section[data-bereich="mitteilungen"]')).toBeVisible();
  await expect(page.locator('[data-abschnitt-orig="macos"]')).toHaveCount(0);
  await page.evaluate(() => { location.hash = "#einstellungen/ki"; });
  await expect(page.locator('section[data-bereich="ki"]')).toBeVisible();
  await page.evaluate(() => { location.hash = "#einstellungen/tasten"; });
  await expect(page.locator('section[data-bereich="tasten"]')).toBeVisible();
  await expect(page.locator('[data-marke="global"]')).toHaveCount(0);
  await page.evaluate(() => { location.hash = "#einstellungen/darstellung"; });
  await expect(page.locator('[data-zeile="durchscheinend"]')).toHaveCount(0); // kein Fenstermaterial im Browser: die Zeile fehlt
  await page.click('[data-schluessel="erscheinung"] [data-wert="dunkel"]');
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload(); // der Cookie trägt das Neuladen, das Thema bleibt
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");
  expect(fehler).toEqual([]);
});

test("Suche im Browser-Modus findet Notizen des Vaults", async ({ page }) => {
  await oeffne(page);
  await page.waitForSelector("[data-karte], [data-leer]", { timeout: 10000 });
  await page.keyboard.press("Meta+Shift+f");
  await expect(page.locator("#suche")).toBeFocused();
  await page.keyboard.type("Zubereitung Druck");
  await expect(page.locator('[data-suche="treffer"][data-pfad="09_wiki/wissen/Espresso.md"]')).toBeVisible({ timeout: 10000 });
});

// Platzhalter für `claude` und `codex`: täuschen nur eine Anmeldung vor (Adresse/Code ausgeben, warten). Nie ein echtes Programm, nie ein echtes Konto; brechen ab, wenn ihr Konto-Ordner außerhalb von Temp liegt.
function platzhalterOrdner() {
  const bin = realpathSync.native(mkdtempSync(join(tmpdir(), "kortex-browser-platzhalter-")));
  const temp = realpathSync.native(tmpdir());
  const skript = (programm) => `#!${process.execPath}
const fs = require("node:fs"), path = require("node:path");
const VAR = ${JSON.stringify(programm === "claude" ? "CLAUDE_CONFIG_DIR" : "CODEX_HOME")}, TEMP = ${JSON.stringify(temp)};
const ziel = process.env[VAR]; let echt = ziel; try { echt = fs.realpathSync(ziel); } catch {}
if (ziel !== undefined && !(echt === TEMP || echt.startsWith(TEMP + path.sep))) { console.error("Attrappe: Zielordner außerhalb von Temp"); process.exit(99); }
const args = process.argv.slice(2).join(" ");
if (args === "auth status" || args === "login status") process.exit(1);
${programm === "claude"
    ? 'console.log("Opening browser to sign in…"); console.log("If the browser didn\'t open, visit: https://claude.ai/oauth/authorize?code=true&client_id=testkennung&response_type=code&code_challenge=pruefwert0123456789&code_challenge_method=S256&state=zustand123");'
    : 'console.log("1. Open this link in your browser and sign in to your account\\n   https://auth.openai.com/codex/device\\n\\n2. Enter this one-time code (expires in 15 minutes)\\n   ABCD-12345\\n");'}
setTimeout(() => {}, 120000);
`;
  for (const p of ["claude", "codex"]) legeProgramm(join(bin, p), skript(p));
  return bin;
}

for (const programm of ["claude", "codex"]) {
  test(`Anmelden im Fenster (E3) im Browser-Modus: ${programm} mit Platzhalter-Programm, „Im Browser anmelden“ öffnet den Anbieter in einem neuen Tab`, { skip: WINDOWS }, async ({ page, context }) => {
    const fehler = fehlerSammeln(page);
    const bin = platzhalterOrdner();
    await oeffne(page, { path: `${bin}${delimiter}${process.env.PATH}` });
    await context.route(/https:\/\/(claude\.ai|auth\.openai\.com)\/.*/, (route) => route.fulfill({ contentType: "text/html", body: "<title>Anbieter</title>" }));
    await page.evaluate(async (p) => {
      const m = await import("/anmeldung.js");
      const host = document.createElement("div"); host.id = "test-host"; host.style.cssText = "position:fixed;left:20px;top:20px;width:420px;z-index:9999;background:var(--erhoben,#fff);padding:16px";
      document.body.append(host);
      window.__erg = null;
      window.__a = m.starteAnmeldung(p, { neu: "Testkonto" }, { host });
      window.__a.ergebnis.then((e) => { window.__erg = e; });
    }, programm);
    const knopf = page.locator('[data-test="an-browser"]');
    await expect(knopf).toBeVisible({ timeout: 15000 });
    if (programm === "codex") await expect(page.locator("[data-code]")).toHaveText("ABCD-12345");
    const [neu] = await Promise.all([context.waitForEvent("page"), knopf.click()]);
    await neu.waitForLoadState();
    expect(neu.url()).toMatch(programm === "claude" ? /^https:\/\/claude\.ai\/oauth\/authorize\?/ : /^https:\/\/auth\.openai\.com\/codex\/device/);
    expect(await neu.evaluate(() => window.opener)).toBeNull();
    await page.evaluate(() => window.__a.abbrechen());
    await expect.poll(() => page.evaluate(() => window.__erg?.phase)).toBe("abgebrochen");
    expect(fehler).toEqual([]);
    expect(dienst.ausgabe()).not.toContain("testkennung");
  });
}
