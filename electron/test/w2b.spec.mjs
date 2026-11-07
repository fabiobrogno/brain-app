// Electron-Hülle (Paket W2b) gegen die ECHTE App (haupt.mjs, _electron): App-Menü aus dem Kürzel-Register, Tray, Schnell-Erfassen-Fenster, globale Kürzel, Mitteilungen,
// App-Symbol, durchscheinende Seitenleiste. Jeder Test: eigenes Temp-HOME, eigener Support-Ordner, Wegwerf-Vault. Globale Kürzel meldet die Test-App nur mit
// KORTEX_TEST_GLOBALE_KUERZEL=1 an, mit ungewöhnlichen Tasten (Strg+Alt+Umschalt+F7–F9), und gibt sie vor dem Ende wieder frei. Der Zugriff auf die Hülle läuft über
// globalThis.__kortex (nur im Testlauf, BRAIN_TESTMODUS).
import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { starteApp } from "./start.mjs";
import { kennungVault } from "../../Ressourcen/gemeinsam/aktivitaet.mjs";

const MAC = process.platform === "darwin";
const WINDOWS = process.platform === "win32";
let lauf;
test.afterEach(async () => { await lauf?.stopp(); lauf = null; });

const aktion = (fenster, name, wert) => fenster.evaluate(([n, w]) => window.kortexHuelle.aktion(n, w), [name, wert]);
const schreibeJson = (support, name, o) => writeFileSync(join(support, name), JSON.stringify(o));
const STRG = MAC ? "Command" : "Ctrl";
// Alle Einträge eines Menüs (flach) mit Id, Label, Accelerator
const menueEintraege = (app) => app.evaluate(({ Menu }) => {
  const aus = [];
  const geh = (items, oben) => { for (const i of items) { aus.push({ id: i.id, label: i.label, accelerator: i.accelerator ?? null, oben, registriert: i.registerAccelerator }); if (i.submenu) geh(i.submenu.items, oben ?? i.label); } };
  geh(Menu.getApplicationMenu().items, null);
  return aus;
});
const klickeMenue = (app, id) => app.evaluate(({ Menu }, i) => Menu.getApplicationMenu().getMenuItemById(i).click(), id);
const erfassenSeite = (app) => app.windows().find((w) => w.url().startsWith("kortex://erfassen/"));
const erfassenFenster = (app) => app.evaluate(({ BrowserWindow, screen }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith("kortex://erfassen/"));
  if (!w) return null;
  const arbeit = screen.getDisplayMatching(w.getBounds()).workArea;
  return { sichtbar: w.isVisible(), immerOben: w.isAlwaysOnTop(), groesseAenderbar: w.isResizable(), inhalt: w.getContentSize(), grenzen: w.getBounds(), arbeit, minimierbar: w.isMinimizable() };
});
const zeigeErfassen = async (app) => {
  await app.evaluate(() => globalThis.__kortex.erfassen.zeigen());
  await expect.poll(() => !!erfassenSeite(app), { timeout: 20_000 }).toBe(true);
  const seite = erfassenSeite(app);
  await seite.waitForFunction(() => window.__erfassenBereit === true, null, { timeout: 20_000 });
  return seite;
};

test("App-Menü: kommt aus dem Kürzel-Register (Strg statt ⌘), deutsche Texte, Einträge lösen Studio-Befehle aus", async () => {
  lauf = await starteApp();
  const { app, fenster } = lauf;
  const e = await menueEintraege(app);
  const oben = e.filter((x) => x.oben === null && x.label).map((x) => x.label);
  if (!MAC) expect(oben).toEqual(["Ablage", "Darstellung", "Gehe zu", "Fenster"]);
  else expect(oben).toEqual(expect.arrayContaining(["Ablage", "Darstellung", "Gehe zu", "Fenster"]));
  const nach = (id) => e.find((x) => x.id === id);
  // Kürzel aus dem Register: Cmd+N → Strg+N, Shift+Cmd+D → Strg+Umschalt+D, Cmd+, → Strg+, (Windows/Linux zeigen nur an: das Studio fängt den Tastendruck selbst ab)
  expect(nach("befehl-neu")).toMatchObject({ label: "Neue Notiz", accelerator: `${STRG}+N`, oben: "Ablage" });
  expect(nach("befehl-heute")).toMatchObject({ label: "Heute (Tagesnotiz)", accelerator: `Shift+${STRG}+D` });
  expect(nach("befehl-einstellungen")).toMatchObject({ label: "Einstellungen …", accelerator: `${STRG}+,` });
  expect(nach("befehl-palette")).toMatchObject({ label: "Befehlspalette", accelerator: `${STRG}+K`, oben: "Gehe zu" });
  expect(nach("befehl-posteingang")).toMatchObject({ label: "Posteingang", accelerator: `${STRG}+1` });
  expect(nach("fest-beenden")).toMatchObject({ label: "Beenden", accelerator: `${STRG}+Q` });
  if (!MAC) expect(nach("befehl-neu").registriert).toBe(false);
  // Kein Eintrag mit Befehl ohne Kürzel hat eins (hell-dunkel hat im Register keines)
  expect(nach("befehl-hell-dunkel").accelerator).toBeNull();
  // Ein Klick löst den Befehl im Studio aus: „Neue Notiz“ öffnet den Editor
  await klickeMenue(app, "befehl-neu");
  await expect(fenster.locator("#editor .cm-editor")).toBeVisible({ timeout: 15_000 });
  // Eigenes Kürzel: tastenkuerzel.json ändern, `kuerzel-geaendert` → das Menü zeigt es sofort (nichts doppelt festgeschrieben)
  schreibeJson(lauf.support, "tastenkuerzel.json", { schema: 1, kuerzel: { "neue-notiz": "Shift+Cmd+Y" } });
  expect(await aktion(fenster, "kuerzel-geaendert")).toEqual({ ok: true });
  expect((await menueEintraege(app)).find((x) => x.id === "befehl-neu").accelerator).toBe(`Shift+${STRG}+Y`);
});

test("Tray: Menü wie am Mac (Vault, Zähler neuer Mitteilungen, Studio, Erfassen, Beenden); ohne Tray-Unterstützung läuft die App sauber", async () => {
  lauf = await starteApp();
  const { app, fenster, support } = lauf;
  const tray = () => app.evaluate(() => globalThis.__kortex.tray());
  if (!(await tray())) { // Linux ohne Tray-Unterstützung: kein Tray, aber die App läuft und antwortet
    expect(await aktion(fenster, "status-auffrischen")).toEqual({ ok: true });
    test.info().annotations.push({ type: "tray", description: "kein Tray auf dieser Plattform (App läuft sauber ohne)" });
    return;
  }
  await expect.poll(async () => (await tray()).vorlage.map((x) => x.label).filter(Boolean)).toContain("Keine neuen Mitteilungen");
  const t = await tray();
  const labels = t.vorlage.map((x) => x.label).filter(Boolean);
  expect(labels).toEqual(expect.arrayContaining(["Studio öffnen", "Schnell erfassen …", "Jetzt abgleichen", "Vault wechseln …", "Ordner als Vault öffnen …", "Einstellungen …", "Kortex einrichten …", "Beenden"]));
  expect(labels[0]).toBeTruthy(); // der Name des Vaults steht oben
  expect(t.tooltip).toBe("Kortex");
  // Zähler: ein ungelesenes Ereignis im Aktivitätsprotokoll → „1 neue Mitteilung“, im Tooltip und im Menü
  const info = await fenster.evaluate(() => fetch("/api/info").then((r) => r.json()));
  const ordner = join(support, "aktivitaet");
  mkdirSync(ordner, { recursive: true });
  appendFileSync(join(ordner, `${kennungVault(info.vault)}.jsonl`), JSON.stringify({ v: 1, id: "a_abcdef12_123456", zeit: new Date().toISOString(), art: "ablage-aufgabe", wer: "Claude Code", text: "x", anzahl: 1 }) + "\n");
  expect(await aktion(fenster, "status-auffrischen")).toEqual({ ok: true }); // gebündelt: höchstens ein Lauf je Sekunde
  await expect.poll(async () => (await tray()).tooltip, { timeout: 15_000 }).toBe("Kortex — 1 neue Mitteilung");
  expect((await tray()).vorlage.map((x) => x.label)).toContain("1 neue Mitteilung");
});

test("Schließen in den Tray: das Fenster geht zu, Kortex läuft weiter, „Studio öffnen“ im Tray holt es zurück", async () => {
  lauf = await starteApp({ extra: { KORTEX_SCHLIESSEN_IN_TRAY: "1" } });
  const { app, fenster } = lauf;
  if (!(await app.evaluate(() => globalThis.__kortex.tray()))) { test.info().annotations.push({ type: "tray", description: "kein Tray auf dieser Plattform" }); return; }
  const zu = fenster.waitForEvent("close");
  await klickeMenue(app, "fest-schliessen");
  await zu;
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().startsWith("kortex://studio/")).length)).toBe(0);
  const neu = app.waitForEvent("window");
  await app.evaluate(() => globalThis.__kortex.tray().vorlage.find((x) => x.id === "tray-studio").click());
  const f2 = await neu;
  await f2.waitForFunction(() => window.__studioBereit === true, null, { timeout: 45_000 });
  expect(f2.url()).toBe("kortex://studio/");
});

test("Schnell erfassen: kleines, rahmenloses Fenster, immer oben, Aufgabe mit Kurzformen speichern, Esc schließt und der Entwurf bleibt", async ({}, testInfo) => {
  lauf = await starteApp();
  const { app, fenster } = lauf;
  const seite = await zeigeErfassen(app);
  const f = await erfassenFenster(app);
  expect(f).toMatchObject({ sichtbar: true, immerOben: true, groesseAenderbar: false, minimierbar: false });
  expect(f.inhalt).toEqual([560, 276]);
  // oben mittig im sichtbaren Bereich des Bildschirms
  expect(f.grenzen.y).toBeGreaterThanOrEqual(f.arbeit.y + 40);
  expect(Math.abs(f.grenzen.x + f.grenzen.width / 2 - (f.arbeit.x + f.arbeit.width / 2))).toBeLessThanOrEqual(2);
  expect(seite.url()).toBe("kortex://erfassen/");
  // sandbox und Isolation: die Seite sieht nur window.kortexErfassen
  expect(await seite.evaluate(() => ({ r: typeof require, p: typeof process, k: Object.keys(window.kortexErfassen).sort() }))).toEqual({ r: "undefined", p: "undefined", k: ["beiZeigen", "schliessen", "speichern", "start"] });
  await expect(seite.locator("#text")).toBeFocused();
  // Kurzformen: Priorität und Fälligkeit werden erkannt und gezeigt (dieselbe Logik wie die Werkstatt)
  await seite.locator("#text").fill("Steuer machen morgen !hoch");
  await expect(seite.locator("#prio")).toHaveText("Priorität: Hoch");
  await expect(seite.locator("#faellig")).toHaveText("Fällig: morgen");
  // Esc schließt, der Entwurf bleibt; beim nächsten Öffnen steht er wieder da
  await seite.keyboard.press("Escape");
  await expect.poll(async () => (await erfassenFenster(app)).sichtbar).toBe(false);
  await app.evaluate(() => globalThis.__kortex.erfassen.zeigen());
  await expect.poll(async () => (await erfassenFenster(app)).sichtbar).toBe(true);
  await expect(seite.locator("#text")).toHaveValue("Steuer machen morgen !hoch");
  // Foto des Erfassen-Fensters (Seitenfoto, kein Vollbild)
  const ziel = process.env.KORTEX_BILDER || testInfo.outputDir;
  mkdirSync(ziel, { recursive: true });
  await seite.screenshot({ path: join(ziel, `erfassen-${process.platform}.png`) });
  // Speichern mit Enter: die Aufgabe liegt im Vault, mit Titel ohne Kurzformen
  await seite.locator("#text").press("Enter");
  await expect(seite.locator("#meldung")).toContainText("Gespeichert in", { timeout: 15_000 });
  await expect.poll(async () => (await erfassenFenster(app)).sichtbar, { timeout: 15_000 }).toBe(false);
  const aufgaben = await fenster.evaluate(() => fetch("/api/aufgaben").then((r) => r.json()));
  const a = JSON.stringify(aufgaben);
  expect(a).toContain("Steuer machen");
  expect(a).toContain("hoch");
  expect(a).not.toContain("!hoch");
  // nach dem Speichern ist das Feld leer; die Art ist gemerkt
  await app.evaluate(() => globalThis.__kortex.erfassen.zeigen());
  await expect(seite.locator("#text")).toHaveValue("");
  const protokoll = readFileSync(join(lauf.support, "electron", "huelle.log"), "utf8");
  expect(protokoll).toContain("erfassen gespeichert aufgabe");
  expect(protokoll).not.toContain("Steuer"); // nie der Text im Protokoll
});

test("Schnell erfassen: Notiz landet im Posteingang, die Art wird gemerkt; Fokusverlust schließt das Fenster", async () => {
  lauf = await starteApp({ extra: { KORTEX_TEST_ERFASSEN_BLUR: "1" } });
  const { app, vault, support } = lauf;
  const seite = await zeigeErfassen(app);
  await seite.locator('.segment button[data-art="notiz"]').click();
  await expect(seite.locator("#notizzeile")).toBeVisible();
  await seite.locator("#text").fill("Ein Gedanke aus dem Erfassen-Fenster");
  await seite.locator("#speichern").click();
  await expect(seite.locator("#meldung")).toContainText("Gespeichert in", { timeout: 15_000 });
  const datei = readdirSync(join(vault, "00_inbox")).find((n) => /gedanke-aus-dem-erfassen/.test(n));
  expect(datei).toBeTruthy();
  expect(readFileSync(join(vault, "00_inbox", datei), "utf8")).toContain("Ein Gedanke aus dem Erfassen-Fenster");
  expect(JSON.parse(readFileSync(join(support, "schnell-erfassen.json"), "utf8")).art).toBe("notiz");
  // Fokusverlust (blur) schließt das Fenster
  await app.evaluate(() => globalThis.__kortex.erfassen.zeigen());
  await expect.poll(async () => (await erfassenFenster(app)).sichtbar).toBe(true);
  await app.evaluate(async ({ BrowserWindow }) => { await new Promise((ok) => setTimeout(ok, 400)); BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith("kortex://erfassen/")).emit("blur"); });
  await expect.poll(async () => (await erfassenFenster(app)).sichtbar).toBe(false);
});

test("Schnell erfassen: Menü- und Tray-Eintrag öffnen es; die Seite lädt nur ihre festen Dateien (CSP), fremde Pfade 404", async () => {
  lauf = await starteApp();
  const { app } = lauf;
  await klickeMenue(app, "fest-erfassen");
  await expect.poll(async () => (await erfassenFenster(app))?.sichtbar).toBe(true);
  // Über die Sitzung der App abgefragt (die Seiten selbst dürfen wegen der CSP nichts fremdes laden)
  const r = await app.evaluate(async ({ session }) => {
    const hol = async (p) => { const x = await session.defaultSession.fetch(p); return { status: x.status, csp: x.headers.get("content-security-policy") }; };
    return { seite: await hol("kortex://erfassen/"), skript: await hol("kortex://erfassen/erfassen.js"), farben: await hol("kortex://erfassen/s/schemata.css"), app: await hol("kortex://erfassen/s/app.js"), api: await hol("kortex://erfassen/api/info"), zurueck: await hol("kortex://erfassen/s/../erfassen.html") };
  });
  expect(r.seite.status).toBe(200);
  expect(r.seite.csp).toContain("default-src 'none'");
  expect(r.seite.csp).toContain("connect-src 'none'");
  expect([r.skript.status, r.farben.status]).toEqual([200, 200]);
  expect([r.app.status, r.api.status]).toEqual([404, 404]); // nur die festen Dateien
  expect(r.zurueck.status).toBe(404); // „/s/../erfassen.html“ wird zu „/erfassen.html“ zusammengelegt, und die ist nicht in der Liste
});

test("Globale Kürzel: Antworten wie in der Mac-App (belegt, reserviert, ungültig, Umstellen), angemeldet nur in der Test-App und wieder frei", async () => {
  lauf = await starteApp({
    extra: { KORTEX_TEST_GLOBALE_KUERZEL: "1" },
    vorher: (support) => schreibeJson(support, "tastenkuerzel.json", { schema: 1, kuerzel: { "schnell-erfassen": "Ctrl+Alt+Shift+F9", "frage-global": null, "kortex-zeigen": null } }),
  });
  const { app, fenster } = lauf;
  const k = (js) => app.evaluate(({ globalShortcut }, a) => { const hook = globalThis.__kortex; return ({ angemeldet: () => hook.kuerzel.angemeldet(), acc: (id) => hook.kuerzel.accelerator(id), reg: (acc) => globalShortcut.isRegistered(acc) })[a.fn](...(a.args || [])); }, js);
  // beim Start angemeldet: die eigene Belegung aus tastenkuerzel.json
  expect(await k({ fn: "angemeldet" })).toEqual({ "schnell-erfassen": "Ctrl+Alt+Shift+F9" });
  const acc19 = await k({ fn: "acc", args: ["schnell-erfassen"] });
  expect(await k({ fn: "reg", args: [acc19] })).toBe(true);
  // Umstellen: erst prüfen und anmelden, das alte Kürzel wird frei
  expect(await aktion(fenster, "kuerzel-global", { id: "schnell-erfassen", kuerzel: "Ctrl+Alt+Shift+F8" })).toEqual({ ok: true });
  const acc18 = await k({ fn: "acc", args: ["schnell-erfassen"] });
  expect(acc18).not.toBe(acc19);
  expect(await k({ fn: "reg", args: [acc18] })).toBe(true);
  expect(await k({ fn: "reg", args: [acc19] })).toBe(false);
  // ungültig, ohne ⌃/⌘, reserviert, unbekannter Befehl
  expect(await aktion(fenster, "kuerzel-global", { id: "schnell-erfassen", kuerzel: "Ctrl+Hoch" })).toEqual({ ok: false, text: "Diese Taste lässt sich nicht als Kürzel verwenden." });
  expect(await aktion(fenster, "kuerzel-global", { id: "schnell-erfassen", kuerzel: "Alt+Shift+F8" })).toEqual({ ok: false, text: "Bitte mit ⌃ (Control) oder ⌘ (Befehl) kombinieren, sonst stört das Kürzel beim Schreiben." });
  expect(await aktion(fenster, "kuerzel-global", { id: "schnell-erfassen", kuerzel: "Cmd+Q" })).toEqual({ ok: false, text: "Dieses Kürzel nutzt das System bereits („Kortex beenden“). Wähle ein anderes." });
  expect(await aktion(fenster, "kuerzel-global", { id: "neue-notiz", kuerzel: "Ctrl+Alt+Shift+F7" })).toEqual({ ok: false, text: "Dieses Kürzel gibt es nicht." });
  expect(await k({ fn: "angemeldet" })).toEqual({ "schnell-erfassen": "Ctrl+Alt+Shift+F8" });
  // abmelden (kuerzel: null) und `kuerzel-geaendert` liest tastenkuerzel.json neu
  expect(await aktion(fenster, "kuerzel-global", { id: "schnell-erfassen", kuerzel: null })).toEqual({ ok: true });
  expect(await k({ fn: "angemeldet" })).toEqual({});
  schreibeJson(lauf.support, "tastenkuerzel.json", { schema: 1, kuerzel: { "schnell-erfassen": "Ctrl+Alt+Shift+F9", "frage-global": null, "kortex-zeigen": null } });
  expect(await aktion(fenster, "kuerzel-geaendert")).toEqual({ ok: true });
  expect(await k({ fn: "angemeldet" })).toEqual({ "schnell-erfassen": "Ctrl+Alt+Shift+F9" });
  // freigeben: nach dem Ende der Hülle-Seite (beende) ist nichts mehr angemeldet
  await app.evaluate(({ globalShortcut }) => { globalThis.__kortex.kuerzel.beende(); globalShortcut.unregisterAll(); });
  expect(await k({ fn: "reg", args: [acc19] })).toBe(false);
});

test("Globale Kürzel: ein von einem anderen Programm gehaltenes Kürzel ergibt die Fehlerantwort „schon belegt“", async () => {
  lauf = await starteApp({
    extra: { KORTEX_TEST_GLOBALE_KUERZEL: "1" },
    vorher: (support) => schreibeJson(support, "tastenkuerzel.json", { schema: 1, kuerzel: { "schnell-erfassen": "Ctrl+Alt+Shift+F9", "frage-global": null, "kortex-zeigen": null } }),
  });
  const { app, fenster } = lauf;
  // „anderes Programm“: der Hauptprozess hält Strg+Alt+Umschalt+F7 selbst (gleiche Schreibweise wie die Hülle sie bildet)
  const belegt = await app.evaluate(({ globalShortcut }) => { const acc = `${process.platform === "darwin" ? "Control" : "Ctrl"}+Alt+Shift+F7`; globalThis.__fremd = acc; return globalShortcut.register(acc, () => {}); });
  expect(belegt).toBe(true);
  expect(await aktion(fenster, "kuerzel-global", { id: "schnell-erfassen", kuerzel: "Ctrl+Alt+Shift+F7" })).toEqual({ ok: false, text: "Dieses Kürzel ist schon von einem anderen Programm belegt." });
  // das bisherige Kürzel bleibt angemeldet
  expect(await app.evaluate(() => globalThis.__kortex.kuerzel.angemeldet())).toEqual({ "schnell-erfassen": "Ctrl+Alt+Shift+F9" });
  await app.evaluate(({ globalShortcut }) => { globalShortcut.unregister(globalThis.__fremd); globalThis.__kortex.kuerzel.beende(); globalShortcut.unregisterAll(); });
});

test("App-Symbol: die fünf Varianten wechseln für Fenster und Tray, die gespeicherte Wahl gilt beim Start", async () => {
  lauf = await starteApp({ vorher: (support) => schreibeJson(support, "einstellungen.json", { appSymbol: "papier" }) });
  const { app, fenster } = lauf;
  expect(await app.evaluate(() => globalThis.__kortex.symbol())).toBe("papier");
  for (const n of ["dunkel", "graphit", "papier", "smaragd", "standard"]) {
    expect(await aktion(fenster, "app-symbol", n)).toEqual({ ok: true });
    expect(await app.evaluate(() => globalThis.__kortex.symbol())).toBe(n);
  }
  expect(await aktion(fenster, "app-symbol", "lila")).toEqual({ ok: false, grund: "ungueltig" });
  expect(await aktion(fenster, "app-symbol", 5)).toEqual({ ok: false, grund: "ungueltig" });
  expect(await app.evaluate(() => globalThis.__kortex.symbol())).toBe("standard");
  const protokoll = readFileSync(join(lauf.support, "electron", "huelle.log"), "utf8");
  expect(protokoll).toContain("aktion app-symbol smaragd");
});

test("Mitteilungen: Probe über die Electron-Notification, Klick bringt das Studio nach vorn und öffnet das Ziel", async () => {
  lauf = await starteApp();
  const { app, fenster } = lauf;
  const unterstuetzt = await app.evaluate(({ Notification }) => Notification.isSupported());
  expect(await aktion(fenster, "mitteilung-probe")).toEqual(unterstuetzt ? { ok: true } : { ok: false, grund: "nicht-verfuegbar" });
  const m = await app.evaluate(() => globalThis.__kortex.mitteilungen.map(({ titel, text, ziel }) => ({ titel, text, ziel })));
  expect(m).toEqual([{ titel: "Kortex", text: "So sehen Mitteilungen von Kortex aus.", ziel: "aktivitaet" }]);
  await fenster.evaluate(() => { window.__befehle = []; const alt = window.studio.befehl.bind(window.studio); window.studio.befehl = (n, w) => { window.__befehle.push(n); return alt(n, w); }; });
  await app.evaluate(() => globalThis.__kortex.mitteilungen[0].objekt.emit("click"));
  await expect.poll(() => fenster.evaluate(() => window.__befehle)).toEqual(["aktivitaet"]);
});

test("Mitteilungen aus dem Aktivitätsprotokoll: Kontingent 80/100 % und Ablage, mit Schaltern; Ziel je Art", async () => {
  lauf = await starteApp({
    extra: { KORTEX_TEST_SAMMELFENSTER: "0" },
    vorher: (support) => schreibeJson(support, "einstellungen.json", { mitteilungenNurImHintergrund: false }),
  });
  const { app, fenster, support } = lauf;
  const info = await fenster.evaluate(() => fetch("/api/info").then((r) => r.json()));
  const ordner = join(support, "aktivitaet");
  mkdirSync(ordner, { recursive: true });
  const datei = join(ordner, `${kennungVault(info.vault)}.jsonl`);
  // nach dem Start dazugekommen (was schon da war, meldet die Hülle nie)
  const jetzt = Date.now() + 1000;
  const zeile = (id, art, rest) => JSON.stringify({ v: 1, id, zeit: new Date(jetzt).toISOString(), art, vault: kennungVault(info.vault), vaultName: "Test-Vault", wer: "Claude Code", ...rest }) + "\n";
  appendFileSync(datei, zeile("a_00000001_aaaaaa", "kontingent", { konto: "k_00000001", grund: "5h-80", text: "x" }) + zeile("a_00000002_bbbbbb", "kontingent", { konto: "k_00000001", grund: "5h-100", text: "x" })
    + zeile("a_00000003_cccccc", "ablage-aufgabe", { anzahl: 1, text: "x" }) + zeile("a_00000004_dddddd", "pflege", { text: "x" }));
  await expect.poll(() => app.evaluate(() => globalThis.__kortex.mitteilungen.length), { timeout: 30_000 }).toBeGreaterThanOrEqual(3);
  const m = await app.evaluate(() => globalThis.__kortex.mitteilungen.map(({ titel, untertitel, text, ziel }) => ({ titel, untertitel, text, ziel })));
  const texte = m.map((x) => x.text).sort();
  expect(texte).toEqual(["hat 80 % des 5-Stunden-Kontingents verbraucht.", "hat das 5-Stunden-Kontingent aufgebraucht.", "hat eine Aufgabe angelegt."].sort());
  expect(m.find((x) => x.text.includes("80 %"))).toMatchObject({ titel: "Claude Code", untertitel: "Test-Vault", ziel: "aktivitaet" });
  expect(m.find((x) => x.text.includes("Aufgabe"))).toMatchObject({ ziel: "aufgaben" });
  expect(m.length).toBe(3); // „Pflege“ ist standardmäßig aus
  const protokoll = readFileSync(join(support, "electron", "huelle.log"), "utf8");
  expect(protokoll).toMatch(/mitteilungen zugestellt=\d/);
  expect(protokoll).not.toContain("Claude Code"); // nie Namen im Protokoll
});

test("Durchscheinende Seitenleiste: nur wo das System Fenstermaterial kann (Windows 11), sonst nicht-verfuegbar und data-glas-moeglich fehlt", async () => {
  lauf = await starteApp();
  const { app, fenster } = lauf;
  const moeglich = await app.evaluate(() => globalThis.__kortex.glas);
  const marke = () => fenster.evaluate(() => ({ moeglich: document.documentElement.dataset.glasMoeglich ?? null, glas: document.documentElement.dataset.glas ?? null }));
  if (!moeglich) {
    expect(await aktion(fenster, "fenster-durchscheinend", true)).toEqual({ ok: false, grund: "nicht-verfuegbar" });
    expect(await aktion(fenster, "fenster-durchscheinend", false)).toEqual({ ok: false, grund: "nicht-verfuegbar" });
    expect(await marke()).toEqual({ moeglich: null, glas: null });
  } else {
    await expect.poll(marke).toEqual({ moeglich: "1", glas: "1" });
    expect(await aktion(fenster, "fenster-durchscheinend", false)).toEqual({ ok: true, wirkt: false });
    expect(await marke()).toEqual({ moeglich: "1", glas: null });
    expect(await aktion(fenster, "fenster-durchscheinend", true)).toEqual({ ok: true, wirkt: true });
    expect(await marke()).toEqual({ moeglich: "1", glas: "1" });
  }
  expect(await aktion(fenster, "fenster-durchscheinend", "ja")).toEqual({ ok: false, grund: "ungueltig" });
});

test("Durchscheinende Seitenleiste mit Fenstermaterial (Testschalter): data-glas-moeglich und data-glas folgen der Aktion", async () => {
  test.skip(WINDOWS, "unter Windows prüft der Test oben das echte Material");
  lauf = await starteApp({ extra: { KORTEX_TEST_GLAS_MOEGLICH: "1" } });
  const { fenster } = lauf;
  const marke = () => fenster.evaluate(() => ({ moeglich: document.documentElement.dataset.glasMoeglich ?? null, glas: document.documentElement.dataset.glas ?? null }));
  await expect.poll(marke).toEqual({ moeglich: "1", glas: "1" });
  expect(await aktion(fenster, "fenster-durchscheinend", false)).toEqual({ ok: true, wirkt: false });
  expect(await marke()).toEqual({ moeglich: "1", glas: null });
  expect(await aktion(fenster, "fenster-durchscheinend", true)).toEqual({ ok: true, wirkt: true });
  expect(await marke()).toEqual({ moeglich: "1", glas: "1" });
});
