// Electron-Hülle (Paket W2a) gegen die ECHTE App (haupt.mjs, _electron): Studio lädt über kortex://studio, Notiz anlegen und speichern, Aktionen des Hüllen-Vertrags,
// Sicherheit (Sandbox, Isolation, Navigation). Jeder Test: eigenes Temp-HOME, eigener Support-Ordner, Wegwerf-Vault; nie echte Konten, nie echter Support-Ordner.
import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { starteApp } from "./start.mjs";

const VERTRAG = JSON.parse(readFileSync(new URL("../../Ressourcen/studio/huellen-vertrag.json", import.meta.url), "utf8"));
const WINDOWS = process.platform === "win32";
let lauf;
test.afterEach(async () => { await lauf?.stopp(); lauf = null; });

const aktion = (fenster, name, wert) => fenster.evaluate(([n, w]) => window.kortexHuelle.aktion(n, w), [name, wert]);
// Aufrufe der Systemfunktionen im Hauptprozess aufzeichnen (statt Dateimanager oder Browser wirklich zu öffnen)
const spioniere = (app) => app.evaluate(({ shell }) => {
  globalThis.__aufrufe = [];
  shell.showItemInFolder = (p) => { globalThis.__aufrufe.push(["showItemInFolder", p]); };
  shell.openExternal = async (u) => { globalThis.__aufrufe.push(["openExternal", u]); };
});
const aufrufe = (app) => app.evaluate(() => globalThis.__aufrufe);

test("Start: Studio lädt über kortex://studio, Hülle ist electron, Sandbox und Isolation sind an, die Seite sieht kein Node", async () => {
  lauf = await starteApp();
  const { app, fenster } = lauf;
  expect(fenster.url()).toBe("kortex://studio/");
  expect(await fenster.title()).toBeTruthy();
  const seite = await fenster.evaluate(() => ({
    art: window.kortexHuelle?.art, namen: window.kortexHuelle?.aktionen, nativ: !!window.webkit,
    require: typeof require, process: typeof process, ipc: typeof ipcRenderer, schluessel: Object.keys(window.kortexHuelle).sort(),
  }));
  expect(seite).toMatchObject({ art: "electron", nativ: false, require: "undefined", process: "undefined", ipc: "undefined", schluessel: ["aktion", "aktionen", "art"] });
  expect([...seite.namen].sort()).toEqual(VERTRAG.aktionen.map((a) => a.name).sort());
  const praef = await app.evaluate(({ BrowserWindow }) => { const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(); return { contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration, sandbox: p.sandbox, webSecurity: p.webSecurity }; });
  expect(praef).toEqual({ contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true });
  // die Werkstatt läuft als Kind und kennt den Vault
  const info = await fenster.evaluate(() => fetch("/api/info").then((r) => r.json()));
  expect(realpathSync(info.vault)).toBe(realpathSync(lauf.vault));
  // alles Geschriebene liegt im Support-Ordner des Tests
  expect(existsSync(join(lauf.support, "electron"))).toBe(true);
});

test("Notiz anlegen und speichern: neue Notiz, Titel tippen, Datei liegt im Vault", async () => {
  lauf = await starteApp();
  const { fenster, vault } = lauf;
  await fenster.evaluate(() => window.studio.befehl("neu"));
  await expect(fenster.locator("#editor")).toBeVisible();
  await expect(fenster.locator("#editor .cm-editor")).toHaveClass(/cm-focused/);
  await fenster.keyboard.type("Electron-Notiz äöü");
  await fenster.keyboard.press("Enter");
  await fenster.keyboard.type("Zeile mit Umlauten und 🙂");
  await expect(fenster.locator("#speicherstand")).toHaveText("Gespeichert", { timeout: 10_000 });
  const datei = readdirSync(join(vault, "00_inbox")).find((n) => n.startsWith("electron-notiz"));
  expect(datei).toBeTruthy();
  expect(readFileSync(join(vault, "00_inbox", datei), "utf8")).toBe("# Electron-Notiz äöü\nZeile mit Umlauten und 🙂\n");
  // eine vorhandene Notiz öffnen und ändern: bytegleich gespeichert
  await fenster.goto("kortex://studio/?pfad=" + encodeURIComponent("10_notizen/Reise nach Lissabon.md"));
  await fenster.waitForSelector(".cm-content .cm-line");
  await fenster.locator(".cm-content").click();
  await fenster.keyboard.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
  await fenster.keyboard.type("Neu aus Electron");
  await expect(fenster.locator("#speicherstand")).toHaveText("Gespeichert", { timeout: 10_000 });
  expect(readFileSync(join(vault, "10_notizen/Reise nach Lissabon.md"), "utf8")).toBe("# Reise nach Lissabon\n\nFlug im Mai. Hotel in der Alfama. Mietwagen nicht nötig.\nNeu aus Electron");
});

test("Vertrag: einfache Aktionen antworten wie in der App (ansicht, titel, fehler, Fenster, Kürzel, Darstellung)", async () => {
  lauf = await starteApp();
  const { app, fenster } = lauf;
  expect(await aktion(fenster, "ansicht")).toEqual({ ok: false, grund: "kein-kit" });
  expect(await aktion(fenster, "vault-gewechselt")).toEqual({ ok: true });
  expect(await aktion(fenster, "vertrauen-geaendert")).toEqual({ ok: true });
  expect(await aktion(fenster, "status-auffrischen")).toEqual({ ok: true });
  expect(await aktion(fenster, "fenster-ziehen")).toEqual({ ok: true });
  expect(await aktion(fenster, "kuerzel-geaendert")).toEqual({ ok: true });
  // Testlauf: kein globales Kürzel beim System (wie die Mac-App); Antworten wie Swift
  expect(await aktion(fenster, "kuerzel-global", { id: "schnell-erfassen", kuerzel: "Ctrl+Alt+Space" })).toEqual({ ok: true });
  expect(await aktion(fenster, "kuerzel-global", { id: "neue-notiz", kuerzel: "Ctrl+Alt+Space" })).toEqual({ ok: false, text: "Dieses Kürzel gibt es nicht." });
  expect(await aktion(fenster, "app-symbol", "dunkel")).toEqual({ ok: true });
  expect(await aktion(fenster, "fenster-durchscheinend", true)).toEqual(await app.evaluate(() => globalThis.__kortex.glas) ? { ok: true, wirkt: true } : { ok: false, grund: "nicht-verfuegbar" });
  expect(await aktion(fenster, "darstellung", "dunkel")).toEqual({ ok: true });
  expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe("dark");
  expect(await aktion(fenster, "darstellung", "system")).toEqual({ ok: true });
  expect(await aktion(fenster, "titel", "Mein Titel")).toEqual({ ok: true });
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())).toBe("Mein Titel");
  expect(await aktion(fenster, "fenster-zoom")).toEqual({ ok: true });
  // ungültige Werte und unbekannte Namen: nie ein Fehler, nie eine Wirkung
  expect(await aktion(fenster, "darstellung", "lila")).toEqual({ ok: false, grund: "ungueltig" });
  expect(await aktion(fenster, "gibt-es-nicht")).toEqual({ ok: false, grund: "unbekannt" });
  expect(await aktion(fenster, "constructor")).toEqual({ ok: false, grund: "unbekannt" });
  // fehler: gedrosselt nach 20 Meldungen
  expect(await aktion(fenster, "fehler", { text: "Test\nzweite Zeile", ort: "app.js:1:2" })).toEqual({ ok: true });
  expect(await aktion(fenster, "fehler", { ort: "ohne Text" })).toEqual({ ok: false, grund: "ungueltig" });
  const letzte = await fenster.evaluate(async () => { let r; for (let i = 0; i < 25; i++) r = await window.kortexHuelle.aktion("fehler", { text: "x" }); return r; });
  expect(letzte).toEqual({ ok: false, grund: "gedrosselt" });
  const protokoll = readFileSync(join(lauf.support, "electron", "huelle.log"), "utf8");
  expect(protokoll).toContain("js-fehler app.js:1:2 Test zweite Zeile");
});

test("Vertrag: ordner-zeigen nur im Vault, extern nur https, kopieren streng, Systemaufrufe kommen im Hauptprozess an", async () => {
  lauf = await starteApp();
  const { app, fenster, vault } = lauf;
  await spioniere(app);
  expect(await aktion(fenster, "ordner-zeigen", "10_notizen/Reise nach Lissabon.md")).toEqual({ ok: true });
  for (const schlecht of ["../etc/passwd", "/etc/passwd", "10_notizen/../../x", "C:\\Windows", "", 5, null]) expect(await aktion(fenster, "ordner-zeigen", schlecht), String(schlecht)).toEqual({ ok: false, grund: "ungueltig" });
  expect(await aktion(fenster, "extern", "https://github.com/login/device")).toEqual({ ok: true });
  for (const schlecht of ["http://example.com", "file:///etc/passwd", "javascript:alert(1)", "https://", "kortex://studio/", "https://u:p@example.com/"]) expect(await aktion(fenster, "extern", schlecht), schlecht).toEqual({ ok: false, grund: "adresse-nicht-erlaubt" });
  const a = await aufrufe(app);
  expect(a).toEqual([["showItemInFolder", join(realpathSync.native(vault),"10_notizen", "Reise nach Lissabon.md")], ["openExternal", "https://github.com/login/device"]]);
  // kopieren gilt nur bei offener Einrichtung (nicht angefordert → gesperrt, auch git)
  expect(await aktion(fenster, "kopieren", "ABCD-1234")).toEqual({ ok: false, grund: "einrichtung-nicht-offen" });
  expect(await aktion(fenster, "git-pruefen")).toEqual({ ok: false, grund: "einrichtung-nicht-offen" });
  expect(await aktion(fenster, "einrichtung-sitzung", { offen: true })).toEqual({ ok: false, grund: "nicht-angefordert" });
  // Einrichtung anfordern und bestätigen → kopieren, git, extern nur GitHub und Anmelde-Domänen
  expect(await aktion(fenster, "einrichtung-oeffnen", { ab: "ki" })).toEqual({ ok: true });
  expect(await aktion(fenster, "einrichtung-sitzung", { offen: true })).toEqual({ ok: true });
  expect(await aktion(fenster, "kopieren", "ABCD-1234")).toEqual({ ok: true });
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe("ABCD-1234");
  for (const schlecht of ["", "zwei\nZeilen", "x".repeat(401), "   ", "a\u202eb", 7]) expect(await aktion(fenster, "kopieren", schlecht), JSON.stringify(schlecht)).toEqual({ ok: false, grund: "text-nicht-erlaubt" });
  expect(await aktion(fenster, "extern", "https://example.com/")).toEqual({ ok: false, grund: "adresse-nicht-erlaubt" });
  expect(await aktion(fenster, "extern", "https://claude.ai/login")).toEqual({ ok: true });
  const git = await aktion(fenster, "git-pruefen");
  expect(["vorhanden", "fehlt", "defekt", "nicht-pruefbar"]).toContain(git.stand);
  expect(await aktion(fenster, "git-installieren")).toMatchObject({ ok: false, stand: "fehlt" });
  // Schritt und Ende: Stand in <Support>/browser-einrichtung.json; danach wieder zu
  expect(await aktion(fenster, "einrichtung-schritt", { schritt: "vault" })).toEqual({ ok: true });
  expect(await aktion(fenster, "einrichtung-schritt", { schritt: "nix" })).toEqual({ ok: false, grund: "ungueltig" });
  expect(await aktion(fenster, "einrichtung-ende", { art: "fertig" })).toEqual({ ok: true });
  expect(JSON.parse(readFileSync(join(lauf.support, "browser-einrichtung.json"), "utf8"))).toEqual({ letzterSchritt: "vault", ende: "fertig" });
  expect(await aktion(fenster, "kopieren", "ABCD-1234")).toEqual({ ok: false, grund: "einrichtung-nicht-offen" });
  // ein Neuladen lässt die Einrichtung nicht offen
  expect(await aktion(fenster, "einrichtung-oeffnen")).toEqual({ ok: true });
  expect(await aktion(fenster, "einrichtung-sitzung", { offen: true })).toEqual({ ok: true });
  await fenster.reload();
  await fenster.waitForFunction(() => window.__studioBereit === true);
  expect(await aktion(fenster, "kopieren", "ABCD-1234")).toEqual({ ok: false, grund: "einrichtung-nicht-offen" });
});

test("Vertrag: ordner-waehlen liefert {pfad, notizen, ordner}, Abbruch liefert null; Dialog kommt aus dem Hauptprozess", async () => {
  lauf = await starteApp();
  const { app, fenster } = lauf;
  const wahl = realpathSync(mkdtempSync(join(tmpdir(), "kortex-wahl-")));
  mkdirSync(join(wahl, "unter"));
  writeFileSync(join(wahl, "a.md"), "# a\n"); writeFileSync(join(wahl, "unter", "b.md"), "# b\n"); writeFileSync(join(wahl, "x.png"), "");
  await app.evaluate(({ dialog }, pfad) => { globalThis.__dialoge = []; dialog.showOpenDialog = async (...a) => { globalThis.__dialoge.push(a.at(-1)); return { canceled: false, filePaths: [pfad] }; }; }, wahl);
  expect(await aktion(fenster, "ordner-waehlen", { titel: "Vault wählen", vorschlag: wahl })).toEqual({ pfad: wahl, notizen: 2, ordner: 1 });
  const optionen = await app.evaluate(() => globalThis.__dialoge[0]);
  expect(optionen).toMatchObject({ title: "Vault wählen", defaultPath: wahl, properties: ["openDirectory", "createDirectory"] });
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
  expect(await aktion(fenster, "ordner-waehlen")).toBeNull();
  expect(await aktion(fenster, "ordner-waehlen", "kein objekt")).toEqual({ ok: false, grund: "ungueltig" });
});

test("Export: export-pdf macht mit printToPDF ein echtes mehrseitiges PDF (Speichern-Dialog eingespritzt, kein Netz), export-speichern schreibt das Bündel, Abbruch schreibt nichts", async () => {
  lauf = await starteApp();
  const { app, fenster } = lauf;
  const ziel = realpathSync(mkdtempSync(join(tmpdir(), "kortex-export-")));
  await app.evaluate(({ dialog }) => { globalThis.__speichern = []; globalThis.__ziel = null; dialog.showSaveDialog = async (...a) => { globalThis.__speichern.push(a.at(-1)); return globalThis.__ziel ? { canceled: false, filePath: globalThis.__ziel } : { canceled: true }; }; });
  const waehle = (pfad) => app.evaluate((_e, p) => { globalThis.__ziel = p; }, pfad);
  const absaetze = Array.from({ length: 160 }, (_, i) => `<p>Absatz ${i + 1}: Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.</p>`).join("");
  // das HTML versucht ein Bild aus dem Netz zu laden: es darf nirgends hingehen (die Sitzung bricht alles außer der Temp-Datei ab)
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>@page{margin:18mm 16mm}body{font:12pt sans-serif}</style></head><body><h1>Atlas</h1><img src="http://127.0.0.1:9/nie.png">${absaetze}</body></html>`;
  await waehle(join(ziel, "Atlas.pdf"));
  expect(await aktion(fenster, "export-pdf", { name: "Atlas", html })).toEqual({ ok: true, name: "Atlas.pdf" });
  const pdf = readFileSync(join(ziel, "Atlas.pdf"));
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.length).toBeGreaterThan(2000);
  expect((pdf.toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g) || []).length).toBeGreaterThanOrEqual(2);
  const optionen = await app.evaluate(() => globalThis.__speichern[0]);
  expect(optionen).toMatchObject({ defaultPath: "Atlas.pdf", filters: [{ name: "PDF", extensions: ["pdf"] }] });
  // Bündel: Markdown mit Bild daneben
  await waehle(join(ziel, "Reise.md"));
  const png = Buffer.from("89504e470d0a1a0a", "hex").toString("base64");
  expect(await aktion(fenster, "export-speichern", { name: "Atlas.md", haupt: "Atlas.md", dateien: [{ pfad: "Atlas.md", text: "# Atlas\n![](bilder/a1b2c3d4-k.png)\n" }, { pfad: "bilder/a1b2c3d4-k.png", base64: png }] })).toEqual({ ok: true, name: "Reise.md" });
  expect(readFileSync(join(ziel, "Reise.md"), "utf8")).toContain("# Atlas");
  expect(readFileSync(join(ziel, "bilder/a1b2c3d4-k.png")).length).toBe(8);
  // Abbruch und ungültige Werte: nichts wird geschrieben
  await waehle(null);
  expect(await aktion(fenster, "export-speichern", { name: "X.md", haupt: "X.md", dateien: [{ pfad: "X.md", text: "x" }] })).toEqual({ ok: false, grund: "abgebrochen" });
  expect(await aktion(fenster, "export-pdf", { name: "X", html: "<p>x</p>" })).toEqual({ ok: false, grund: "abgebrochen" });
  await waehle(join(ziel, "Boese.md"));
  expect(await aktion(fenster, "export-speichern", { name: "B.md", haupt: "B.md", dateien: [{ pfad: "B.md", text: "x" }, { pfad: "../draussen.md", text: "böse" }] })).toEqual({ ok: false, grund: "ungueltig" });
  expect(existsSync(join(ziel, "Boese.md")) || existsSync(join(ziel, "..", "draussen.md"))).toBe(false);
  expect(await aktion(fenster, "teilen", { name: "A", text: "t" })).toEqual({ ok: false, grund: "nicht-verfuegbar" });
});

test("Navigation: fremde Adressen laden nie im Fenster, Links gehen nur als http(s) in den Standardbrowser, Netz ist gesperrt (CSP und onBeforeRequest)", async () => {
  lauf = await starteApp();
  const { app, fenster } = lauf;
  await spioniere(app);
  // Seite versucht wegzunavigieren
  await fenster.evaluate(() => { location.href = "https://example.com/"; });
  await fenster.evaluate(() => new Promise((ok) => setTimeout(ok, 500)));
  expect(fenster.url()).toBe("kortex://studio/");
  // window.open und Links: Fenster bleibt, http(s) geht an den Browser, file:/javascript: nie
  await fenster.evaluate(() => { window.open("https://example.org/a", "_blank"); window.open("file:///etc/passwd"); window.open("javascript:alert(1)"); window.open("http://example.net/"); });
  await fenster.evaluate(() => new Promise((ok) => setTimeout(ok, 500)));
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  expect((await aufrufe(app)).map((a) => a[1]).sort()).toEqual(["http://example.net/", "https://example.org/a"]);
  // Netzzugriff der Studio-Seite ist gesperrt (CSP connect-src 'self')
  const netz = await fenster.evaluate(() => fetch("https://example.com/", { mode: "no-cors" }).then(() => "offen", () => "gesperrt"));
  expect(netz).toBe("gesperrt");
  // onBeforeRequest allein: eine Seite OHNE CSP (data:) in derselben Sitzung kommt ebenfalls nicht ins Netz (ohne die Sperre ginge die Anfrage hinaus)
  const ohneCsp = await app.evaluate(async ({ BrowserWindow }) => {
    const w = new BrowserWindow({ show: false });
    try { await w.loadURL("data:text/html,<p>x"); return await w.webContents.executeJavaScript(`fetch("https://example.com/", { mode: "no-cors" }).then(() => "offen", () => "gesperrt")`); }
    finally { w.destroy(); }
  });
  expect(ohneCsp).toBe("gesperrt");
  // schreibende Anfrage ohne JSON wird abgewiesen
  const status = await fenster.evaluate(() => fetch("/api/info", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "x" }).then(async (r) => [r.status, await r.text()]));
  expect(status[0]).toBe(415);
  // zu großer Körper: 413 (Grenze der Werkstatt, 8 MB), nie eine Anfrage ohne Antwort
  const gross = await fenster.evaluate(() => fetch("/api/datei", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pfad: "x.md", inhalt: "x".repeat(9 * 1024 * 1024) }) }).then((r) => r.status));
  expect(gross).toBe(413);
});

test("Erster Start ohne Vault: die Hülle öffnet die Einrichtung selbst", async () => {
  lauf = await starteApp({ mitVault: false });
  const { fenster } = lauf;
  await expect(fenster.locator("#einrichtung-host .e-win")).toHaveCount(1, { timeout: 20_000 });
  // die Seite hat die Sitzung bestätigt: die Rechte der Einrichtung sind offen (kopieren geht) …
  await expect.poll(() => aktion(fenster, "kopieren", "x")).toEqual({ ok: true });
  // … und nach „zu“ wieder gesperrt
  expect(await aktion(fenster, "einrichtung-sitzung", { offen: false })).toEqual({ ok: true });
  expect(await aktion(fenster, "kopieren", "x")).toEqual({ ok: false, grund: "einrichtung-nicht-offen" });
});

test("Schließen sichert: Text tippen, sofort schließen — die Datei ist gespeichert", async () => {
  lauf = await starteApp();
  const { app, fenster, vault } = lauf;
  await fenster.evaluate(() => window.studio.befehl("neu"));
  await expect(fenster.locator("#editor .cm-editor")).toHaveClass(/cm-focused/);
  await fenster.keyboard.type("Schnell zu");
  await fenster.keyboard.press("Enter");
  await fenster.keyboard.type("sofort geschlossen");
  const ende = app.waitForEvent("close");
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
  await ende;
  const datei = readdirSync(join(vault, "00_inbox")).find((n) => n.startsWith("schnell-zu"));
  expect(datei).toBeTruthy();
  expect(readFileSync(join(vault, "00_inbox", datei), "utf8")).toBe("# Schnell zu\nsofort geschlossen\n");
  lauf.app = null;
});

test("Herunterfahren/Abmelden (session-end, shutdown) läuft über denselben Sichern-und-Beenden-Weg: Text tippen, Sitzungsende melden — die Datei ist gespeichert, die App endet", async () => {
  lauf = await starteApp();
  const { app, fenster, vault } = lauf;
  await fenster.evaluate(() => window.studio.befehl("neu"));
  await expect(fenster.locator("#editor .cm-editor")).toHaveClass(/cm-focused/);
  await fenster.keyboard.type("Vor dem Herunterfahren");
  await fenster.keyboard.press("Enter");
  await fenster.keyboard.type("noch nicht gespeichert");
  const ende = app.waitForEvent("close");
  await app.evaluate(() => { globalThis.__kortex.sitzungEnde(); });
  await ende;
  const datei = readdirSync(join(vault, "00_inbox")).find((n) => n.startsWith("vor-dem-herunterfahren"));
  expect(datei).toBeTruthy();
  expect(readFileSync(join(vault, "00_inbox", datei), "utf8")).toBe("# Vor dem Herunterfahren\nnoch nicht gespeichert\n");
  lauf.app = null;
});

test("Entwicklung: die Werkstatt läuft mit dem node aus dem PATH und ihr MCP-Eintrag nennt es (kein Electron als Node)", async () => {
  lauf = await starteApp();
  const { app, fenster } = lauf;
  const lz = await app.evaluate(() => globalThis.__kortex.laufzeit);
  expect(lz.programm).toBe(lz.node);
  expect(lz.node).not.toBe(await app.evaluate(() => process.execPath));
  expect((await fenster.evaluate(() => fetch("/api/info").then((r) => r.json()))).mcpBefehl).toContain(lz.node);
});

test("Fenster-Foto der eigenen App", async ({}, testInfo) => {
  lauf = await starteApp();
  const { fenster } = lauf;
  await fenster.setViewportSize?.({ width: 1280, height: 800 }).catch(() => {});
  await fenster.goto("kortex://studio/?pfad=" + encodeURIComponent("10_notizen/Reise nach Lissabon.md"));
  await fenster.waitForSelector(".cm-content .cm-line");
  await fenster.waitForTimeout(600);
  const ziel = process.env.KORTEX_BILDER || testInfo.outputDir;
  mkdirSync(ziel, { recursive: true });
  const pfad = join(ziel, `electron-${process.platform}.png`);
  await fenster.screenshot({ path: pfad });
  expect(existsSync(pfad)).toBe(true);
});
