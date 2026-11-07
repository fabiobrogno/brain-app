// Updater-Ablauf (Paket W2c) mit dem ECHTEN electron-updater gegen einen LOKALEN Dateiserver (generic provider, 127.0.0.1), ohne echtes Release und ohne Netz nach außen:
// suchen → „Neue Version verfügbar“ → laden (sha512 prüft electron-updater) → „Update bereit“ → neu starten. Die App läuft unverpackt (nur dort erlaubt haupt.mjs die Test-Quelle
// KORTEX_TEST_UPDATE_URL; im Testlauf zeigt sie statt Fenstern ihre Meldungen in `__kortex.update`). Das Ersetzen des installierten Programms selbst (NSIS/AppImage) lässt sich nur mit einem
// installierten Paket prüfen; das belegt der Job „paket“ nicht — Begründung im PR und in docs/plaene/plattformen-windows-linux.md (W2c).
import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { starteApp } from "./start.mjs";

const WIN = process.platform === "win32";
const MAC = process.platform === "darwin"; // Mac: die Mac-App aktualisiert sich über Sparkle, nicht über electron-updater (nur der letzte Test läuft dort)
const NUR_LINUX_WINDOWS = () => test.skip(MAC, "Mac: Sparkle statt electron-updater");

const DATEI = (v) => (WIN ? `Kortex-Setup-${v}-x64.exe` : `Kortex-${v}-x86_64.AppImage`);
const YML = WIN ? "latest.yml" : "latest-linux.yml";
const sha512 = (b) => createHash("sha512").update(b).digest("base64");

// Feed-Ordner: yml + „Paket“ (eine Dummy-Datei mit richtiger Prüfsumme). Gibt Adresse und Zähler der Abrufe zurück.
async function feed({ version, inhalt = Buffer.from("kein echtes Paket — nur zum Testen des Ablaufs\n".repeat(2000)), pruefsumme = sha512(inhalt) }) {
  const ordner = mkdtempSync(join(tmpdir(), "kortex-feed-"));
  writeFileSync(join(ordner, DATEI(version)), inhalt);
  writeFileSync(join(ordner, YML), `version: ${version}\nfiles:\n  - url: ${DATEI(version)}\n    sha512: ${pruefsumme}\n    size: ${inhalt.length}\npath: ${DATEI(version)}\nsha512: ${pruefsumme}\nreleaseDate: '2026-11-07T00:00:00.000Z'\n`);
  const abrufe = [];
  const server = createServer((req, res) => {
    abrufe.push(req.url);
    const name = decodeURIComponent((req.url || "").split("?")[0].replace(/^\//, ""));
    const datei = join(ordner, name);
    if (!name || name.includes("..") || !existsSync(datei) || !readdirSync(ordner).includes(name)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    res.end(readFileSync(datei));
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  return { url: `http://127.0.0.1:${server.address().port}`, abrufe, schliesse: async () => { await new Promise((ok) => server.close(ok)); rmSync(ordner, { recursive: true, force: true }); } };
}

let lauf, f;
test.afterEach(async () => { await lauf?.stopp(); lauf = null; await f?.schliesse(); f = null; });

const meldungen = (app) => app.evaluate(() => globalThis.__kortex.update.meldungen.map((m) => ({ titel: m.titel, text: m.text, knoepfe: m.knoepfe })));
const setzeAntworten = (app, a) => app.evaluate((x, antworten) => globalThis.__kortex.update.antworten(antworten), a);
const pruefe = (app, o) => app.evaluate((x, opt) => globalThis.__kortex.update.pruefe(opt), o);

test("Update gefunden: Frage „Laden“, Download mit Prüfsumme, Frage „Neu starten“; Später lässt die Datei liegen, ein zweites Suchen fragt gleich nach dem Neustart, der Neustart beendet die App", async () => {
  NUR_LINUX_WINDOWS();
  f = await feed({ version: "99.0.0" });
  lauf = await starteApp({ extra: { KORTEX_TEST_UPDATE_URL: f.url } });
  const { app } = lauf;
  expect(await app.evaluate(() => globalThis.__kortex.update.moeglich)).toBe(true);
  // 1. Suchen: Laden = ja, Neu starten = später
  await setzeAntworten(app, [0, 1]);
  expect(await pruefe(app, { manuell: true })).toMatchObject({ ok: true, neu: true, geladen: true, neustart: false });
  const m = await meldungen(app);
  expect(m.map((x) => x.titel)).toEqual(["Neue Version verfügbar", "Update bereit"]);
  expect(m[0].text).toContain("99.0.0");
  expect(m[0].knoepfe).toEqual(["Laden", "Später"]);
  expect(m[1].knoepfe).toEqual(["Jetzt neu starten", "Später"]);
  // geladen und geprüft: die Datei liegt im Cache der App (Temp-HOME), nicht beim Nutzer
  const abgerufen = f.abrufe.map((u) => u.split("?")[0]);
  expect(abgerufen).toEqual(expect.arrayContaining([`/${YML}`, `/${DATEI("99.0.0")}`]));
  expect(await app.evaluate(() => globalThis.__kortex.update.neustart())).toBe(false);
  // 2. Suchen: schon geladen → keine neue Abfrage, gleich die Frage nach dem Neustart; „Jetzt neu starten“ beendet die App (ordentlich, wie Beenden)
  const vorher = f.abrufe.length;
  await setzeAntworten(app, [0]);
  const ende = app.waitForEvent("close");
  pruefe(app, { manuell: true }).catch(() => { /* die App endet währenddessen */ });
  await ende;
  expect(f.abrufe.length).toBe(vorher);
  lauf.app = null;
});

test("Kein Update: Version gleich oder älter → „Kortex ist aktuell“, nichts wird geladen", async () => {
  NUR_LINUX_WINDOWS();
  f = await feed({ version: "0.0.0" });
  lauf = await starteApp({ extra: { KORTEX_TEST_UPDATE_URL: f.url } });
  const { app } = lauf;
  expect(await pruefe(app, { manuell: true })).toMatchObject({ ok: true, neu: false });
  expect((await meldungen(app)).map((x) => x.titel)).toEqual(["Kortex ist aktuell"]);
  expect(f.abrufe.map((u) => u.split("?")[0])).toEqual([`/${YML}`]);
});

test("Falsche Prüfsumme: der Download wird verworfen, die Fehlermeldung kommt, nichts wird installiert", async () => {
  NUR_LINUX_WINDOWS();
  f = await feed({ version: "99.0.0", pruefsumme: sha512(Buffer.from("anderer Inhalt")) });
  lauf = await starteApp({ extra: { KORTEX_TEST_UPDATE_URL: f.url } });
  const { app } = lauf;
  await setzeAntworten(app, [0]);
  expect(await pruefe(app, { manuell: true })).toMatchObject({ ok: false, grund: "fehler" });
  const m = await meldungen(app);
  expect(m.map((x) => x.titel)).toEqual(["Neue Version verfügbar", "Updates"]);
  expect(m[1].text).toMatch(/fehlgeschlagen/);
  expect(await app.evaluate(() => globalThis.__kortex.update.neustart())).toBe(false);
});

test("Feed nicht erreichbar: stille Prüfung meldet nichts, manuelle Suche sagt es", async () => {
  NUR_LINUX_WINDOWS();
  f = await feed({ version: "99.0.0" });
  const url = f.url;
  await f.schliesse(); f = null; // Server weg
  lauf = await starteApp({ extra: { KORTEX_TEST_UPDATE_URL: url } });
  const { app } = lauf;
  expect(await pruefe(app, { manuell: false })).toMatchObject({ ok: false, grund: "fehler" });
  expect(await meldungen(app)).toEqual([]);
  expect(await pruefe(app, { manuell: true })).toMatchObject({ ok: false, grund: "fehler" });
  expect((await meldungen(app)).map((x) => x.titel)).toEqual(["Updates"]);
});

test("Ohne Test-Quelle gibt es in der Entwicklung keine Updates (Menüeintrag ausgegraut, Meldung mit Grund)", async () => {
  lauf = await starteApp();
  const { app } = lauf;
  expect(await app.evaluate(() => globalThis.__kortex.update.moeglich)).toBe(false);
  expect(await pruefe(app, { manuell: true })).toMatchObject({ ok: false, grund: "aus" });
  expect((await meldungen(app))[0]).toMatchObject({ titel: "Updates", text: "In der Entwicklung gibt es keine Updates." });
  const menue = await app.evaluate(({ Menu }) => { const e = Menu.getApplicationMenu().getMenuItemById("fest-updates"); return e ? { label: e.label, enabled: e.enabled } : null; });
  expect(menue).toEqual({ label: "Nach Updates suchen …", enabled: false });
});
