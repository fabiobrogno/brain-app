// Verlauf-Modus, Diff-Ansicht und Remote-Dialog. /api/git/log, /api/git/remote und /api/git/diff werden hier gemockt;
// die Module werden in eine eigene Seite montiert (unabhängig von app.js).
import { test, expect } from "@playwright/test";
import { mkdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { baueVault, git } from "./vault.mjs";
import { starteServer } from "./start.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
const BILDER = join(HIER, "screenshots");
const STUDIO = join(HIER, "..", "..", "Ressourcen", "studio");
mkdirSync(BILDER, { recursive: true });

// Die Module laufen auf einem kleinen eigenen Dateiserver (nur Ressourcen/studio): unabhängig vom Stand der Werkstatt.
// Nur der Test „gegen das echte Backend“ startet die Werkstatt.
const TYPEN = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".json": "application/json" };
function starteDateien() {
  return new Promise((ok) => {
    const s = http.createServer((req, res) => {
      const pfad = decodeURIComponent(new URL(req.url, "http://x").pathname);
      const datei = join(STUDIO, pfad === "/" ? "index.html" : pfad);
      if (!datei.startsWith(STUDIO) || !existsSync(datei) || statSync(datei).isDirectory()) { res.writeHead(404, { "content-type": "application/json" }); return res.end("{}"); }
      res.writeHead(200, { "content-type": TYPEN[extname(datei)] || "application/octet-stream", "cache-control": "no-store" });
      res.end(readFileSync(datei));
    });
    s.listen(0, "127.0.0.1", () => ok({ url: `http://127.0.0.1:${s.address().port}/`, stopp: () => s.close() }));
  });
}
let vault, server;
test.beforeAll(async () => { ({ vault } = baueVault()); server = await starteDateien(); });
test.afterAll(() => server?.stopp());

// ---------------------------------------------------------------- Testseite
const SEITE = `<!doctype html><html lang="de"><head><meta charset="utf-8"><link rel="stylesheet" href="/studio.css">
<style>
 #t-rahmen { position: fixed; inset: 0; display: grid; grid-template-columns: 252px 340px minmax(0, 1fr); background: var(--papier); }
 #t-seite { background: var(--seite); border-right: 1px solid var(--linie); }
 #t-liste { display: flex; flex-direction: column; min-height: 0; background: var(--liste); border-right: 1px solid var(--linie); }
 #t-kopf { height: 48px; flex: none; display: flex; align-items: center; gap: 8px; padding: 0 16px; font-weight: 650; font-size: 15px; border-bottom: 1px solid var(--linie); }
 #t-host { flex: 1; min-height: 0; overflow-y: auto; }
 #t-haupt { position: relative; min-width: 0; min-height: 0; }
 #t-diff { position: absolute; inset: 0; }
</style></head><body>
<div id="t-rahmen"><div id="t-seite"></div><section id="t-liste"><header id="t-kopf">Verlauf</header><div id="t-host"></div></section><main id="t-haupt"><div id="t-diff"></div></main></div>
<div id="dialog-host"></div><div id="toast-host"></div></body></html>`;

async function oeffneSeite(page, basis = server.url) {
  await page.route(/\/__verlauf-test\.html$/, (route) => route.fulfill({ contentType: "text/html", body: SEITE }));
  await page.goto(basis + "__verlauf-test.html");
  await page.evaluate(() => { window.__ruf = []; window.__offen = []; window.__ereignis = []; });
}

// ---------------------------------------------------------------- Mock-Daten
const tag = (d) => new Date(d).toLocaleDateString("sv-SE");
const vor = (tage, stunde = 10, minute = 12) => { const d = new Date(); d.setDate(d.getDate() - tage); d.setHours(stunde, minute, 0, 0); return d; };
const sha = (n) => (n.toString(16).padStart(2, "0") + "e7a9c4b1d03f58260e9a7bc41d3f8052a6c9e1").slice(0, 40);
function commit(n, nachricht, zeit, dateien, extra = {}) {
  return {
    sha: sha(n), kurz: sha(n).slice(0, 7), nachricht, zeit: zeit.toISOString(), autor: "Fabio",
    plus: dateien.filter((d) => d.status === "A").length,
    geaendert: dateien.filter((d) => d.status === "M" || d.status === "R").length,
    dateien, ...extra,
  };
}
function tage(commits) {
  const nachTag = new Map();
  for (const c of commits) { const t = tag(c.zeit); (nachTag.get(t) || nachTag.set(t, []).get(t)).push(c); }
  return [...nachTag].map(([datum, cs]) => ({ datum, commits: cs }));
}
const LOG_A = () => ({
  tage: tage([
    commit(1, "Notizen aktualisiert (3)", vor(0, 9, 41), [
      { pfad: "09_wiki/wissen/Kaffee.md", status: "M" }, { pfad: "00_inbox/2026-10-24_gedanke.md", status: "A" }, { pfad: "10_notizen/Reise nach Lissabon.md", status: "M" },
    ]),
    commit(2, "Mietwagen ergänzt", vor(0, 7, 5), [{ pfad: "10_notizen/Reise nach Lissabon.md", status: "M" }]),
    commit(3, "Alte Entwürfe aufgeräumt und Inbox neu sortiert, damit nichts mehr doppelt liegt", vor(4, 18, 30), [
      { pfad: "00_inbox/alt.md", status: "D" }, { pfad: "10_notizen/neu-benannt.md", status: "R" }, { pfad: "09_wiki/wissen/agentic-os/tief/thema_claude-mods.md", status: "A" },
    ]),
    commit(4, "Erste Fassung", vor(16, 12, 0), [{ pfad: "09_wiki/wissen/Espresso.md", status: "A" }, { pfad: "09_wiki/wissen/Mühle.md", status: "A" }]),
  ]),
});
const STATUS_A = { repo: true, zweig: "main", geaendert: [{ pfad: "09_wiki/wissen/Kaffee.md", code: "M" }, { pfad: "00_inbox/neu.md", code: "??" }], remote: true };

async function mocke(page, { log = LOG_A, status = STATUS_A, protokoll } = {}) {
  await page.route(/\/api\/git\/log(\?|$)/, (route) => {
    const u = new URL(route.request().url());
    protokoll?.push({ max: u.searchParams.get("max"), vor: u.searchParams.get("vor") });
    const r = typeof log === "function" ? log(u) : log;
    if (r?.__status) return route.fulfill({ status: r.__status, json: { fehler: r.fehler } });
    return route.fulfill({ json: r });
  });
  await page.route(/\/api\/git\/status$/, (route) => route.fulfill({ json: typeof status === "function" ? status() : status }));
}
async function montiereListe(page) {
  await page.evaluate(async () => {
    const { zeichneVerlauf } = await import("/verlauf.js");
    const { api } = await import("/api.js");
    window.__vl = zeichneVerlauf(document.getElementById("t-host"), {
      api, beiDatei: (x) => window.__ruf.push(x), beiCommitOeffnen: (c) => window.__offen.push(c.sha),
    });
  });
}
// sichtbar = im Layout UND nicht per opacity 0 (Einblend-Elemente)
async function sichtbar(locator) {
  await expect(locator).toBeVisible();
  await expect.poll(() => locator.evaluate((el) => { let o = 1; for (let e = el; e; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity); return o; })).toBeGreaterThan(0.95);
}

// ================================================================= Liste
test("Liste: Tagesköpfe mit Zählung, Commit-Zeilen mit Zeit, Hash und Zählern", async ({ page }) => {
  await mocke(page); await oeffneSeite(page); await montiereListe(page);
  const koepfe = page.locator(".vl-tagkopf");
  await expect(koepfe).toHaveCount(3);
  await sichtbar(koepfe.first());
  await expect(koepfe.nth(0)).toContainText("(2 Commits)");
  await expect(koepfe.nth(1)).toContainText("(1 Commit)");
  await expect(koepfe.nth(0)).toContainText(/^(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag), \d{1,2}\. \p{L}+ \d{4}/u);
  const erste = page.locator(".vl-commitzeile:not(.ungesichert)").first();
  await sichtbar(erste);
  await expect(erste.locator(".vl-nachricht")).toHaveText("Notizen aktualisiert (3)");
  await expect(erste.locator(".vl-hash")).toHaveText(sha(1).slice(0, 7));
  await expect(erste.locator(".vl-zeit")).toHaveText(/^vor \d+ (Min|Std)$|^gerade eben$/);
  await expect(erste.locator(".vl-plus")).toHaveText("+1");
  await expect(erste.locator(".vl-aender")).toHaveText("~2");
  await expect(erste.locator(".vl-weg")).toHaveCount(0);
  // zweiter Commit ohne neue Dateien: kein +0
  await expect(page.locator(".vl-commitzeile").nth(2).locator(".vl-plus")).toHaveCount(0);
  // Commit mit gelöschter Datei zeigt −1; relative Zeit „vor 4 Tagen“
  const dritter = page.locator(".vl-commitzeile", { hasText: "Alte Entwürfe" });
  await expect(dritter.locator(".vl-weg")).toHaveText("−1");
  await expect(dritter.locator(".vl-zeit")).toHaveText("vor 4 Tagen");
  await expect(dritter.locator(".vl-nachricht")).toHaveCSS("text-overflow", "ellipsis");
  await expect(page.locator(".vl-commitzeile", { hasText: "Erste Fassung" }).locator(".vl-zeit")).toHaveText("vor 2 Wochen");
});

test("Liste: Commit aufklappen, Dateiliste mit Marken, Datei-Klick ruft beiDatei", async ({ page }) => {
  await mocke(page); await oeffneSeite(page); await montiereListe(page);
  const commit1 = page.locator(".vl-commitzeile", { hasText: "Notizen aktualisiert (3)" });
  await expect(commit1).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".vl-datei")).toHaveCount(0);
  await commit1.click();
  await expect(commit1).toHaveAttribute("aria-expanded", "true");
  const dateien = page.locator(".vl-commit", { has: commit1 }).locator(".vl-datei");
  await expect(dateien).toHaveCount(3);
  await sichtbar(dateien.first());
  await expect(dateien.nth(0).locator(".vl-marke")).toHaveText("M");
  await expect(dateien.nth(1).locator(".vl-marke")).toHaveText("A");
  await expect(dateien.nth(0).locator(".vl-dtitel")).toHaveText("Kaffee");
  await expect(dateien.nth(0).locator(".vl-dtitel")).toHaveCSS("font-weight", "600");
  await expect(dateien.nth(0).locator(".vl-dordner")).toHaveText("09_wiki/wissen");
  await expect(dateien.nth(0).locator(".vl-dordner")).toHaveAttribute("title", "09_wiki/wissen");
  expect(await page.evaluate(() => window.__offen)).toEqual([sha(1)]);
  await dateien.nth(1).click();
  const ruf = await page.evaluate(() => window.__ruf);
  expect(ruf).toHaveLength(1);
  expect(ruf[0]).toMatchObject({ sha: sha(1), kurz: sha(1).slice(0, 7), nachricht: "Notizen aktualisiert (3)", pfad: "00_inbox/2026-10-24_gedanke.md", status: "A" });
  expect(typeof ruf[0].zeit).toBe("string");
  await expect(dateien.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(dateien.nth(0)).toHaveAttribute("aria-selected", "false");
  await expect.poll(() => dateien.nth(1).evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  // erneuter Klick auf die Zeile klappt wieder zu
  await commit1.click();
  await expect(commit1).toHaveAttribute("aria-expanded", "false");
  await expect(dateien.first()).toBeHidden();
});

test("Liste: Ungesicherte Änderungen oben, Klick auf Datei meldet sha null", async ({ page }) => {
  await mocke(page); await oeffneSeite(page); await montiereListe(page);
  const zeile = page.locator(".vl-ungesichert .vl-commitzeile");
  await sichtbar(zeile);
  await expect(zeile.locator(".vl-nachricht")).toHaveText("Ungesicherte Änderungen");
  await expect(zeile.locator(".vl-zahl")).toHaveText("2");
  await zeile.click();
  const dateien = page.locator(".vl-ungesichert .vl-datei");
  await expect(dateien).toHaveCount(2);
  await expect(dateien.nth(1).locator(".vl-marke")).toHaveText("A"); // ?? = neu
  await dateien.nth(0).click();
  const ruf = await page.evaluate(() => window.__ruf);
  expect(ruf[0]).toMatchObject({ sha: null, pfad: "09_wiki/wissen/Kaffee.md", status: "M", nachricht: "Ungesicherte Änderungen" });
  // ohne ungesicherte Dateien keine Zeile
  await page.unroute(/\/api\/git\/status$/);
  await page.route(/\/api\/git\/status$/, (r) => r.fulfill({ json: { ...STATUS_A, geaendert: [] } }));
  await page.evaluate(() => window.__vl.aktualisieren());
  await expect(page.locator(".vl-ungesichert")).toHaveCount(0);
});

test("Ein Host, eine Instanz: erneutes Montieren räumt die alte Liste und den alten Diff ab", async ({ page }) => {
  const protokoll = [];
  await mocke(page, { protokoll }); await mockeDiff(page); await oeffneSeite(page);
  await montiereListe(page); await montiereListe(page);
  await expect(page.locator(".vl")).toHaveCount(1);
  await expect(page.locator(".vl-tagkopf")).toHaveCount(3);
  await montiereDiff(page); await montiereDiff(page);
  await expect(page.locator(".vd")).toHaveCount(1);
  await page.locator(".vd-koerper").focus();
  await page.keyboard.press("Escape");
  expect((await page.evaluate(() => window.__ereignis)).filter((e) => e.art === "schliessen")).toHaveLength(1); // nicht doppelt
  await expect(page.locator(".vl-ungesichert .vl-commitzeile")).toHaveAttribute("aria-label", "Ungesicherte Änderungen · 2");
});

test("Liste: Tag einklappen, Zustand bleibt beim Neuzeichnen", async ({ page }) => {
  await mocke(page); await oeffneSeite(page); await montiereListe(page);
  const kopf = page.locator(".vl-tagkopf").first();
  const gruppe = page.locator(".vl-commits").first();
  await sichtbar(gruppe);
  await kopf.click();
  await expect(kopf).toHaveAttribute("aria-expanded", "false");
  await expect(gruppe).toBeHidden();
  await expect(kopf.locator(".vl-chev")).toHaveCSS("transform", /matrix/); // gedreht
  await page.locator(".vl-commitzeile", { hasText: "Alte Entwürfe" }).click();
  await page.evaluate(() => window.__vl.aktualisieren());
  await expect(page.locator(".vl-tagkopf").first()).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".vl-commits").first()).toBeHidden();
  await expect(page.locator(".vl-commitzeile", { hasText: "Alte Entwürfe" })).toHaveAttribute("aria-expanded", "true");
  await page.locator(".vl-tagkopf").first().click();
  await sichtbar(page.locator(".vl-commits").first());
});

test("Liste: Tastatur ↑↓ → ← Enter, ARIA-Baum", async ({ page }) => {
  await mocke(page, { status: { ...STATUS_A, geaendert: [] } }); await oeffneSeite(page); await montiereListe(page);
  await expect(page.locator("[role=tree]")).toHaveAttribute("aria-label", "Verlauf des Vaults");
  await expect(page.locator(".vl-zeile[tabindex='0']")).toHaveCount(1);
  await page.locator(".vl-zeile[tabindex='0']").focus();
  const aktiv = () => page.evaluate(() => { const e = document.activeElement; return e?.dataset?.schluessel || null; });
  expect(await aktiv()).toMatch(/^tag:/);
  await page.keyboard.press("ArrowDown");
  expect(await aktiv()).toBe("c:" + sha(1));
  await page.keyboard.press("ArrowDown");
  expect(await aktiv()).toBe("c:" + sha(2));
  await page.keyboard.press("ArrowUp");
  expect(await aktiv()).toBe("c:" + sha(1));
  await page.keyboard.press("ArrowRight"); // klappt auf
  await expect(page.locator(".vl-commitzeile").first()).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".vl-commitzeile").first()).toHaveAttribute("aria-level", "2");
  await page.keyboard.press("ArrowRight"); // erster Datei-Eintrag
  expect(await aktiv()).toBe("d:" + sha(1) + ":09_wiki/wissen/Kaffee.md");
  await expect(page.locator(".vl-datei").first()).toHaveAttribute("aria-level", "3");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  expect((await page.evaluate(() => window.__ruf)).map((x) => x.pfad)).toEqual(["00_inbox/2026-10-24_gedanke.md"]);
  await expect(page.locator(".vl-datei").nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowLeft"); // Datei → Commit
  expect(await aktiv()).toBe("c:" + sha(1));
  await page.keyboard.press("ArrowLeft"); // klappt zu
  await expect(page.locator(".vl-commitzeile").first()).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("ArrowLeft"); // Commit → Tag
  expect(await aktiv()).toMatch(/^tag:/);
  await page.keyboard.press("ArrowLeft"); // Tag zu
  await expect(page.locator(".vl-tagkopf").first()).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Enter"); // Enter klappt wieder auf
  await expect(page.locator(".vl-tagkopf").first()).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("End");
  expect(await aktiv()).toBe("c:" + sha(4));
  await page.keyboard.press("Home");
  expect(await aktiv()).toMatch(/^tag:/);
  // sichtbarer Fokusring
  await page.keyboard.press("Tab"); // wandert aus der Liste (nur eine Tab-Station)
  expect(await aktiv()).toBeNull();
});

test("Liste: Maße, Ladezustand, haftender Tageskopf, Fokusring", async ({ page }) => {
  let frei; const warte = new Promise((r) => (frei = r));
  const viele = [];
  for (let i = 0; i < 40; i++) viele.push(commit(i + 10, "Commit " + (i + 1), vor(Math.floor(i / 2) + 1, 18 - (i % 2), 5), [{ pfad: `10_notizen/n${i}.md`, status: "M" }]));
  await page.route(/\/api\/git\/log(\?|$)/, async (route) => { await warte; route.fulfill({ json: { tage: tage(viele) } }); });
  await page.route(/\/api\/git\/status$/, (route) => route.fulfill({ json: { ...STATUS_A, geaendert: [] } }));
  await oeffneSeite(page); await montiereListe(page);
  // Ladezustand: ruhige Skelett-Zeilen, nichts Dreh-Förmiges
  await sichtbar(page.locator(".vl-skelett"));
  await expect(page.locator(".vl-skelett")).toHaveAttribute("aria-busy", "true");
  await expect(page.locator(".vl-commitzeile")).toHaveCount(0);
  frei();
  await expect(page.locator(".vl-commitzeile")).toHaveCount(40);
  await expect(page.locator(".vl-skelett")).toHaveCount(0);
  // Maße: Commit-Zeile ≈ 64 px, Tageskopf ≈ 30 px
  const hoeheCommit = (await page.locator(".vl-commitzeile").first().boundingBox()).height;
  const hoeheTag = (await page.locator(".vl-tagkopf").first().boundingBox()).height;
  expect(hoeheCommit).toBeGreaterThanOrEqual(62); expect(hoeheCommit).toBeLessThanOrEqual(68);
  expect(hoeheTag).toBeGreaterThanOrEqual(28); expect(hoeheTag).toBeLessThanOrEqual(32);
  await expect(page.locator(".vl-tagkopf").first()).toHaveCSS("position", "sticky");
  await expect(page.locator(".vl-tagkopf").first()).toHaveCSS("font-size", "12px");
  await expect(page.locator(".vl-tagkopf").first()).toHaveCSS("font-weight", "500");
  await expect(page.locator(".vl-nachricht").first()).toHaveCSS("font-size", "14px");
  await expect(page.locator(".vl-nachricht").first()).toHaveCSS("font-weight", "500");
  // Scrollen: genau ein Tageskopf klebt oben am Rand der Liste
  const oben = await page.evaluate(() => {
    const host = document.getElementById("t-host");
    host.scrollTop = 700;
    const r = host.getBoundingClientRect();
    return [...document.querySelectorAll(".vl-tagkopf")].filter((k) => Math.abs(k.getBoundingClientRect().top - r.top) < 1.5).length;
  });
  expect(oben).toBe(1);
  // Fokusring: Tab in die Liste, sichtbarer Rahmen
  await page.evaluate(() => { document.getElementById("t-host").scrollTop = 0; document.activeElement?.blur(); });
  await page.keyboard.press("Tab");
  const ring = await page.evaluate(() => { const e = document.activeElement; const c = getComputedStyle(e); return { art: e.dataset.art, stil: c.outlineStyle, breite: c.outlineWidth }; });
  expect(ring).toEqual({ art: "tag", stil: "solid", breite: "2px" });
});

test("Liste: leer, Fehler mit „Nochmal versuchen“, Kein-Git", async ({ page }) => {
  let modus = "leer";
  await mocke(page, { log: () => (modus === "fehler" ? { __status: 500, fehler: "Der Verlauf war nicht lesbar." } : modus === "ok" ? LOG_A() : { tage: [] }), status: () => (modus === "keingit" ? { repo: false, geaendert: [] } : { ...STATUS_A, geaendert: [] }) });
  await oeffneSeite(page); await montiereListe(page);
  await expect(page.locator(".vl-leer-titel")).toHaveText("Noch keine Fassungen gesichert");
  await sichtbar(page.locator(".vl-leer"));
  await expect(page.locator(".vl-leer-text")).toContainText("Sobald du Änderungen sicherst");
  modus = "fehler";
  await page.evaluate(() => { window.__vl.zerstoere(); });
  await expect(page.locator(".vl-leer")).toHaveCount(0);
  await montiereListe(page);
  await expect(page.locator(".vl-leer-titel")).toHaveText("Der Verlauf konnte nicht geladen werden");
  await expect(page.locator(".vl-leer-text")).toHaveText("Der Verlauf war nicht lesbar.");
  modus = "ok";
  await page.locator('button[data-aktion="nochmal"]').click();
  await expect(page.locator(".vl-tagkopf")).toHaveCount(3);
  modus = "keingit";
  await page.evaluate(() => window.__vl.zerstoere());
  await montiereListe(page);
  await expect(page.locator(".vl-leer-titel")).toHaveText("Dieser Ordner hat noch keinen Versionsverlauf");
});

test("Liste: Mehr laden hängt die nächste Seite an (vor = letzter Sha), Tage werden zusammengeführt", async ({ page }) => {
  const protokoll = [];
  const seite1 = []; // 60 Commits, je 3 pro Tag, ältester Tag nur teilweise
  for (let i = 0; i < 60; i++) seite1.push(commit(i + 10, "Commit " + (i + 1), vor(Math.floor(i / 3) + 1, 18 - (i % 3), 5), [{ pfad: `10_notizen/n${i}.md`, status: "M" }]));
  const seite2 = [commit(200, "Älterer Commit am selben Tag", vor(20, 8, 0), [{ pfad: "a.md", status: "M" }]), commit(201, "Noch älter", vor(22, 8, 0), [{ pfad: "b.md", status: "A" }])];
  // letzter Commit der ersten Seite und erster der zweiten teilen sich den Tag
  seite2[0].zeit = seite1[59].zeit;
  await mocke(page, { protokoll, status: { ...STATUS_A, geaendert: [] }, log: (u) => (u.searchParams.get("vor") ? { tage: tage(seite2) } : { tage: tage(seite1) }) });
  await oeffneSeite(page); await montiereListe(page);
  await expect(page.locator(".vl-commitzeile")).toHaveCount(60);
  const mehr = page.locator('button[data-aktion="mehr"]');
  await sichtbar(mehr);
  await expect(mehr).toHaveText("Mehr laden");
  expect(protokoll[0]).toEqual({ max: "60", vor: null });
  const tageVorher = await page.locator(".vl-tagkopf").count();
  await mehr.click();
  await expect(page.locator(".vl-commitzeile")).toHaveCount(62);
  expect(protokoll[1]).toEqual({ max: "60", vor: seite1[59].sha });
  // einer der zwei neuen Commits steckt im vorhandenen Tag, der andere bringt einen neuen Tag
  await expect(page.locator(".vl-tagkopf")).toHaveCount(tageVorher + 1);
  // weniger als 60 zurück: Ende erreicht, kein Knopf mehr
  await expect(page.locator('button[data-aktion="mehr"]')).toHaveCount(0);
  // Aktualisieren holt mindestens so viele Einträge, wie schon geladen waren (hier 62)
  await page.evaluate(() => window.__vl.aktualisieren());
  await expect.poll(() => protokoll.length).toBe(3);
  expect(protokoll[2]).toEqual({ max: "62", vor: null });
});

test("Liste: Commit ohne Dateien zeigt einen ruhigen Hinweis", async ({ page }) => {
  await mocke(page, { status: { ...STATUS_A, geaendert: [] }, log: { tage: tage([commit(7, "Leerer Commit", vor(0, 8, 0), [])]) } });
  await oeffneSeite(page); await montiereListe(page);
  await page.locator(".vl-commitzeile", { hasText: "Leerer Commit" }).click();
  await expect(page.locator(".vl-keine")).toHaveText("Keine Dateien in diesem Commit.");
});

test("Liste: Mehr laden bei Fehler zeigt Hinweis und lässt es nochmal zu", async ({ page }) => {
  let fehler = true;
  const seite1 = [];
  for (let i = 0; i < 60; i++) seite1.push(commit(i + 10, "Commit " + (i + 1), vor(Math.floor(i / 3) + 1, 18 - (i % 3), 5), [{ pfad: `n${i}.md`, status: "M" }]));
  await mocke(page, { status: { ...STATUS_A, geaendert: [] }, log: (u) => (u.searchParams.get("vor") ? (fehler ? { __status: 500, fehler: "x" } : { tage: [] }) : { tage: tage(seite1) }) });
  await oeffneSeite(page); await montiereListe(page);
  await page.locator('button[data-aktion="mehr"]').click();
  await expect(page.locator(".vl-mehr-fehler")).toHaveText("Weitere Einträge konnten nicht geladen werden.");
  fehler = false;
  await page.locator('button[data-aktion="mehr"]').click();
  await expect(page.locator('button[data-aktion="mehr"]')).toHaveCount(0);
});

// k1: Die Werkstatt liefert `weitere` und `naechste` (Spec §5a), nicht `mehr`.
test("Liste: „Mehr laden“ folgt `weitere`; die nächste Seite fragt mit `naechste`, nicht mit dem letzten Commit der Seite", async ({ page }) => {
  const protokoll = [];
  const seite1 = [];
  for (let i = 0; i < 60; i++) seite1.push(commit(i + 10, "Commit " + (i + 1), vor(Math.floor(i / 3) + 1, 18 - (i % 3), 5), [{ pfad: `n${i}.md`, status: "M" }]));
  const seite2 = [commit(200, "Ganz alt", vor(40, 8, 0), [{ pfad: "alt.md", status: "A" }])];
  const naechste = sha(50); // bewusst NICHT der letzte Commit der Seite: die Werkstatt bestimmt den Zeiger
  await mocke(page, { protokoll, status: { ...STATUS_A, geaendert: [] }, log: (u) => (u.searchParams.get("vor") ? { tage: tage(seite2), weitere: false, naechste: null } : { tage: tage(seite1), weitere: true, naechste }) });
  await oeffneSeite(page); await montiereListe(page);
  await expect(page.locator(".vl-commitzeile")).toHaveCount(60);
  const mehr = page.locator('button[data-aktion="mehr"]');
  await sichtbar(mehr); // weitere:true
  await mehr.click();
  await expect(page.locator(".vl-commitzeile")).toHaveCount(61);
  expect(protokoll[1]).toEqual({ max: "60", vor: naechste });
  await expect(page.locator('button[data-aktion="mehr"]')).toHaveCount(0); // weitere:false
});

test("Liste: eine kurze Seite mit `weitere: true` wird beim Laden bis zur gewünschten Zahl aufgefüllt (nach `naechste`)", async ({ page }) => {
  const protokoll = [];
  const seite1 = [];
  for (let i = 0; i < 10; i++) seite1.push(commit(i + 10, "Commit " + (i + 1), vor(i + 1, 12, 5), [{ pfad: `n${i}.md`, status: "M" }]));
  const seite2 = [commit(200, "Ganz alt", vor(40, 8, 0), [{ pfad: "alt.md", status: "A" }])];
  const naechste = sha(5);
  await mocke(page, { protokoll, status: { ...STATUS_A, geaendert: [] }, log: (u) => (u.searchParams.get("vor") ? { tage: tage(seite2), weitere: false, naechste: null } : { tage: tage(seite1), weitere: true, naechste }) });
  await oeffneSeite(page); await montiereListe(page);
  await expect(page.locator(".vl-commitzeile")).toHaveCount(11);
  expect(protokoll[1]).toEqual({ max: "50", vor: naechste }); // 60 gewünscht, 10 da, also 50 nach `naechste`
  await expect(page.locator('button[data-aktion="mehr"]')).toHaveCount(0);
});

test("Liste: `weitere: false` beendet die Liste, auch wenn genau 60 Commits kamen", async ({ page }) => {
  const seite1 = [];
  for (let i = 0; i < 60; i++) seite1.push(commit(i + 10, "Commit " + (i + 1), vor(Math.floor(i / 3) + 1, 18 - (i % 3), 5), [{ pfad: `n${i}.md`, status: "M" }]));
  await mocke(page, { status: { ...STATUS_A, geaendert: [] }, log: { tage: tage(seite1), weitere: false, naechste: null } });
  await oeffneSeite(page); await montiereListe(page);
  await expect(page.locator(".vl-commitzeile")).toHaveCount(60);
  await expect(page.locator('button[data-aktion="mehr"]')).toHaveCount(0);
});

test("Aktualisieren holt auch mehr als 200 geladene Commits wieder: seitenweise nach, höchstens 200 je Aufruf", async ({ page }) => {
  const protokoll = [];
  const alle = [];
  for (let i = 0; i < 250; i++) alle.push(commit(i + 1, "Commit " + (i + 1), vor(Math.floor(i / 3) + 1, 18 - (i % 3), 5), [{ pfad: `n${i}.md`, status: "M" }]));
  // wie die Werkstatt: max höchstens 200, vor = Zeiger, weitere/naechste
  const log = (u) => {
    const vorSha = u.searchParams.get("vor");
    const start = vorSha ? alle.findIndex((c) => c.sha === vorSha) + 1 : 0;
    const n = Math.min(200, Number(u.searchParams.get("max")) || 50);
    const seite = alle.slice(start, start + n);
    const weitere = start + n < alle.length;
    return { tage: tage(seite), weitere, naechste: weitere ? seite[seite.length - 1].sha : null };
  };
  await mocke(page, { protokoll, status: { ...STATUS_A, geaendert: [] }, log });
  await oeffneSeite(page); await montiereListe(page);
  await expect(page.locator(".vl-commitzeile")).toHaveCount(60);
  for (const erwartet of [120, 180, 240, 250]) {
    await page.locator('button[data-aktion="mehr"]').click();
    await expect(page.locator(".vl-commitzeile")).toHaveCount(erwartet);
  }
  await expect(page.locator('button[data-aktion="mehr"]')).toHaveCount(0);
  const vorher = protokoll.length;
  await page.evaluate(() => window.__vl.aktualisieren());
  await expect.poll(() => protokoll.length).toBe(vorher + 2);
  expect(protokoll[vorher]).toEqual({ max: "200", vor: null });
  expect(protokoll[vorher + 1]).toEqual({ max: "50", vor: alle[199].sha });
  await expect(page.locator(".vl-commitzeile")).toHaveCount(250); // nichts geht beim Aktualisieren verloren
  await expect(page.locator('button[data-aktion="mehr"]')).toHaveCount(0);
});

for (const [wie, status] of [["Git-Status meldet gesperrt", { repo: true, gesperrt: true, grund: "x" }], ["Verlauf-Aufruf antwortet 409", STATUS_A]]) {
  test(`Liste: Git gesperrt (${wie}) zeigt einen erklärenden Block statt des rohen Fehlers`, async ({ page }) => {
    await mocke(page, { status });
    await page.route(/\/api\/git\/log(\?|$)/, (route) => route.fulfill({ status: 409, json: { fehler: "Roher Backend-Text: Git ist gesperrt.", gitGesperrt: true } }));
    await oeffneSeite(page); await montiereListe(page);
    await expect(page.locator(".vl-leer-titel")).toHaveText("Git ist für diesen Vault gesperrt");
    await expect(page.locator(".vl-leer")).not.toContainText("Roher Backend-Text");
  });
}

// ================================================================= Diff
const DIFF = [
  "diff --git a/09_wiki/wissen/Kaffee.md b/09_wiki/wissen/Kaffee.md",
  "index 3b1f2a4..9c7d0e1 100644",
  "--- a/09_wiki/wissen/Kaffee.md",
  "+++ b/09_wiki/wissen/Kaffee.md",
  "@@ -1,7 +1,9 @@",
  " ---",
  " titel: Kaffee",
  "-stand: 2026-10-01",
  "+stand: 2026-10-24",
  " verfall: 2027-10-01",
  " ---",
  " # Kaffee",
  " ",
  "-Kaffee ist ein Heißgetränk aus gerösteten Bohnen.",
  "+Kaffee ist ein **Heißgetränk** aus gerösteten Bohnen. Siehe auch [[Espresso]] und [[Mühle|die Mühle]] — hier steht ein sehr langer Satz, der in der Ansicht nicht umbrochen werden soll, sondern waagerecht scrollbar bleibt.",
  "+",
  "+Die Röstung beeinflusst den Geschmack stark.",
  "@@ -20,3 +22,4 @@ ## Fakten",
  " - Arabica enthält weniger Koffein als Robusta",
  "+- Robusta schmeckt herber",
  " ",
  " > Ein Zitat über Kaffee.",
  "\\ No newline at end of file",
  "",
].join("\n");

async function montiereDiff(page, optionen = {}) {
  await page.evaluate(async (o) => {
    const { zeigeDiff } = await import("/verlauf.js");
    const { api } = await import("/api.js");
    window.__dv = zeigeDiff(document.getElementById("t-diff"), {
      api, sha: "9c7d0e1b3a5f", kurz: "9c7d0e1", nachricht: "Kaffee-Seite überarbeitet", pfad: "09_wiki/wissen/Kaffee.md", status: "M", zeit: new Date(Date.now() - 4 * 86400000).toISOString(),
      ...o,
      beiSchliessen: () => window.__ereignis.push({ art: "schliessen" }),
      beiWiederherstellen: (x) => window.__ereignis.push({ art: "wieder", ...x }),
    });
  }, optionen);
}
const mockeDiff = (page, diff = DIFF, protokoll) => page.route(/\/api\/git\/diff(\?|$)/, (route) => {
  const u = new URL(route.request().url());
  protokoll?.push({ pfad: u.searchParams.get("pfad"), sha: u.searchParams.get("sha") });
  route.fulfill({ json: { diff } });
});

test("Diff: Zeilen mit +/−-Klassen, Zeilennummern, Hunk-Köpfe, Kopf mit Hash und Nachricht", async ({ page }) => {
  const protokoll = [];
  await oeffneSeite(page); await mockeDiff(page, DIFF, protokoll); await montiereDiff(page);
  const diff = page.locator("[data-diff]");
  await sichtbar(diff);
  expect(protokoll[0]).toEqual({ pfad: "09_wiki/wissen/Kaffee.md", sha: "9c7d0e1b3a5f" });
  await expect(page.locator(".vd-z.p")).toHaveCount(5);
  await expect(page.locator(".vd-z.m")).toHaveCount(2);
  await expect(page.locator(".vd-z.h")).toHaveCount(2);
  // Kopfzeilen (diff --git, index, ---/+++) sind keine Anzeige-Zeilen
  await expect(diff).not.toContainText("diff --git");
  await expect(diff).not.toContainText("index 3b1f2a4");
  // Zeilennummern: erste Kontextzeile 1/1, entfernte Zeile hat nur alt, hinzugefügte nur neu
  const ersteKontext = page.locator(".vd-z.c").first();
  await expect(ersteKontext.locator(".vd-nr.alt")).toHaveText("1");
  await expect(ersteKontext.locator(".vd-nr.neu")).toHaveText("1");
  const erstesMinus = page.locator(".vd-z.m").first();
  await expect(erstesMinus.locator(".vd-nr.alt")).toHaveText("3");
  await expect(erstesMinus.locator(".vd-nr.neu")).toHaveText("");
  await expect(erstesMinus.locator(".vd-vz")).toHaveText("−");
  const erstesPlus = page.locator(".vd-z.p").first();
  await expect(erstesPlus.locator(".vd-nr.alt")).toHaveText("");
  await expect(erstesPlus.locator(".vd-nr.neu")).toHaveText("3");
  await expect(erstesPlus.locator(".vd-code")).toHaveText("stand: 2026-10-24");
  // Spalten fluchten: Code-Spalte beginnt in Hunk-, Meta-, Kontext-, Plus- und Minuszeilen an derselben Stelle
  const codeLinks = await page.locator(".vd-z .vd-code").evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().left)))]);
  expect(codeLinks).toHaveLength(1);
  // geänderte Wörter in 1:1-Paaren sind markiert (nur „01“ → „24“), ungleiche Blöcke bleiben ohne Wortmarke
  await expect(page.locator(".vd-z.m .vd-w")).toHaveCount(1);
  await expect(page.locator(".vd-z.m .vd-w")).toHaveText("01");
  await expect(page.locator(".vd-z.p .vd-w")).toHaveCount(1);
  await expect(page.locator(".vd-z.p .vd-w")).toHaveText("24");
  expect(await page.locator(".vd-z.p .vd-w").evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  // zweiter Hunk startet bei 20/22
  await expect(page.locator(".vd-z.h").nth(1)).toContainText("@@ -20,3 +22,4 @@");
  await expect(page.locator(".vd-z.h").nth(1)).toContainText("## Fakten");
  await expect(page.locator(".vd-z.c").last().locator(".vd-nr.neu")).toHaveText("25");
  // Tönung kommt aus den Tokens (nicht transparent), Mono-Schrift, keine Umbrüche
  expect(await erstesPlus.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  expect(await erstesMinus.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  await expect(page.locator(".vd-zeilen")).toHaveCSS("font-size", "12.5px");
  await expect(page.locator(".vd-code").first()).toHaveCSS("white-space", "pre");
  // lange Zeile: waagerecht scrollbar statt Umbruch
  const scroll = await page.locator(".vd-koerper").evaluate((e) => ({ breit: e.scrollWidth > e.clientWidth }));
  expect(scroll.breit).toBe(true);
  // Kopf
  await expect(page.locator(".vd-dateiname")).toHaveText("Kaffee");
  await expect(page.locator(".vd-dateiname")).toHaveCSS("font-weight", "650");
  await expect(page.locator(".vd-ordner")).toHaveText("09_wiki/wissen");
  await expect(page.locator(".vd-hash")).toHaveText("9c7d0e1");
  await expect(page.locator(".vd-nachricht")).toHaveText("Kaffee-Seite überarbeitet");
  await expect(page.locator(".vd-zeit")).toHaveText("vor 4 Tagen");
  await expect(page.locator(".vd-status")).toHaveText("Geändert");
  await expect(page.locator(".vd-stat .vl-plus")).toHaveText("+5");
  await expect(page.locator(".vd-stat .vl-weg")).toHaveText("−2");
});

test("Diff: Wiederherstellen, Zur Notiz und Escape rufen die Rückrufe", async ({ page }) => {
  await mocke(page); await oeffneSeite(page); await mockeDiff(page); await montiereDiff(page);
  const wieder = page.locator('[data-aktion="diff-wiederherstellen"]');
  await sichtbar(wieder);
  await expect(wieder).toHaveText("Diese Fassung wiederherstellen");
  await wieder.click();
  expect(await page.evaluate(() => window.__ereignis)).toEqual([{ art: "wieder", pfad: "09_wiki/wissen/Kaffee.md", sha: "9c7d0e1b3a5f" }]);
  await page.locator('[data-aktion="diff-zu"]').click();
  await expect(page.locator('[data-aktion="diff-zu"]')).toContainText("Zur Notiz");
  expect((await page.evaluate(() => window.__ereignis)).at(-1)).toEqual({ art: "schliessen" });
  await page.locator(".vd-koerper").focus();
  await page.keyboard.press("Escape");
  expect((await page.evaluate(() => window.__ereignis)).filter((e) => e.art === "schliessen")).toHaveLength(2);
  // Escape gilt auch, wenn der Fokus in der Verlaufsliste liegt
  await page.evaluate(async () => { const { zeichneVerlauf } = await import("/verlauf.js"); const { api } = await import("/api.js"); window.__vl2 = zeichneVerlauf(document.getElementById("t-host"), { api }); });
  await sichtbar(page.locator(".vl-zeile").first());
  await page.locator(".vl-zeile").first().focus();
  await page.keyboard.press("Escape");
  expect((await page.evaluate(() => window.__ereignis)).filter((e) => e.art === "schliessen")).toHaveLength(3);
  await page.evaluate(() => window.__vl2.zerstoere());
  // nach zerstoere() kein Escape mehr
  await page.evaluate(() => window.__dv.zerstoere());
  await page.keyboard.press("Escape");
  expect((await page.evaluate(() => window.__ereignis)).filter((e) => e.art === "schliessen")).toHaveLength(3);
  await expect(page.locator(".vd")).toHaveCount(0);
});

test("Diff: ungesichert und gelöschte Datei ohne Wiederherstellen; leerer Diff; Binärdatei", async ({ page }) => {
  const protokoll = [];
  await oeffneSeite(page); await mockeDiff(page, DIFF, protokoll);
  await montiereDiff(page, { sha: null, kurz: "", nachricht: "Ungesicherte Änderungen", zeit: null });
  await expect(page.locator(".vd-ungesichert")).toHaveText("Ungesicherte Änderungen");
  await expect(page.locator('[data-aktion="diff-wiederherstellen"]')).toHaveCount(0);
  await sichtbar(page.locator(".vd-z.p").first());
  expect(protokoll[0].sha).toBeNull(); // ohne sha = Arbeitsstand gegen HEAD
  await montiereDiff(page, { status: "D" });
  await expect(page.locator('[data-aktion="diff-wiederherstellen"]')).toHaveCount(0);
  await expect(page.locator(".vd-status")).toHaveText("Gelöscht");
  await page.unroute(/\/api\/git\/diff(\?|$)/);
  await mockeDiff(page, "");
  await montiereDiff(page);
  await expect(page.locator(".vd-hinweis")).toHaveText("Keine Änderung an dieser Datei.");
  await page.unroute(/\/api\/git\/diff(\?|$)/);
  await mockeDiff(page, "diff --git a/b.png b/b.png\nindex 1..2 100644\nBinary files a/b.png and b/b.png differ\n");
  await montiereDiff(page, { pfad: "attachments/b.png" });
  await expect(page.locator(".vd-hinweis")).toContainText("keine Textdatei");
});

test("Diff: nur hinzugefügte Zeilen — Statistik ohne Minus, nirgends der Text „null“, Hinweis auf fehlenden Zeilenumbruch auf Deutsch", async ({ page }) => {
  await oeffneSeite(page);
  await mockeDiff(page, "@@ -0,0 +1,2 @@\n+neu eins\n+neu zwei\n\\ No newline at end of file\n");
  await montiereDiff(page, { status: "A" });
  await expect(page.locator(".vd-z.p")).toHaveCount(2);
  await expect(page.locator(".vd-stat")).toHaveText("+2");
  await expect(page.locator(".vd")).not.toContainText("null");
  await expect(page.locator(".vd-z.k")).toHaveText(/Kein Zeilenumbruch am Dateiende/);
  await expect(page.locator(".vd-status")).toHaveText("Neu");
});

test("Diff: sehr große Diffs werden bei 4000 Zeilen gekürzt, Hinweis erscheint", async ({ page }) => {
  const zeilen = ["@@ -1,0 +1,4500 @@"];
  for (let i = 0; i < 4500; i++) zeilen.push("+Zeile " + (i + 1));
  await oeffneSeite(page); await mockeDiff(page, zeilen.join("\n"));
  await montiereDiff(page);
  await expect(page.locator(".vd-gekuerzt")).toContainText("4.501 Zeilen");
  await expect(page.locator(".vd-gekuerzt")).toContainText("ersten 4.000");
  await expect(page.locator(".vd-z")).toHaveCount(4000);
});

test("Diff: Fehler beim Laden zeigt Hinweis in Alltagssprache", async ({ page }) => {
  await oeffneSeite(page);
  await page.route(/\/api\/git\/diff(\?|$)/, (r) => r.fulfill({ status: 404, json: { fehler: "Diese Fassung gibt es nicht mehr." } }));
  await montiereDiff(page);
  await expect(page.locator(".vd-hinweis.fehlertext")).toHaveText("Diese Fassung gibt es nicht mehr.");
});

test("Diff gegen das echte Backend: Commit-Diff hat Hunks, Plus- und Minuszeilen", async ({ page }) => {
  const kurz = git(vault, "rev-parse", "--short", "HEAD").trim();
  const voll = git(vault, "rev-parse", "HEAD").trim();
  const echt = await starteServer(vault);
  try {
    await oeffneSeite(page, echt.url);
    await montiereDiff(page, { sha: voll, kurz, nachricht: "Mietwagen ergänzt", pfad: "10_notizen/Reise nach Lissabon.md" });
    await expect(page.locator(".vd-z.h")).toHaveCount(1);
    await expect(page.locator(".vd-z.m")).toHaveCount(1);
    await expect(page.locator(".vd-z.p")).toHaveCount(1);
    await expect(page.locator(".vd-z.p .vd-code")).toHaveText("Flug im Mai. Hotel in der Alfama. Mietwagen nicht nötig.");
    await expect(page.locator(".vd-hash")).toHaveText(kurz);
  } finally { echt.stopp(); }
});

// ================================================================= Remote-Dialog
async function oeffneRemote(page) {
  await page.evaluate(async () => {
    const { oeffneRemoteDialog } = await import("/remote.js");
    oeffneRemoteDialog({ beiFertig: () => window.__ereignis.push({ art: "fertig" }) });
  });
}

test("Remote-Dialog: Texte, Fokus im Feld, Escape schließt", async ({ page }) => {
  await oeffneSeite(page); await oeffneRemote(page);
  const dlg = page.locator('[data-dialog="remote"]');
  await sichtbar(dlg);
  await expect(dlg.locator(".rm-titel")).toHaveText("Remote hinzufügen");
  await expect(dlg).toContainText("Ein Remote ist ein Online-Ort, an dem dein Vault gesichert wird — z. B. ein privates GitHub-Repository.");
  await expect(dlg.locator("label")).toHaveText("Adresse");
  await expect(dlg.locator("input")).toHaveAttribute("placeholder", /git@github\.com:name\/brain\.git/);
  await expect(dlg.locator("input")).toBeFocused();
  await expect(dlg).toContainText("Anmeldung läuft über deine normale Git-Einrichtung (SSH oder Schlüsselbund). Die App speichert keine Passwörter.");
  await expect(dlg.locator('[data-aktion="verbinden"]')).toHaveText("Verbinden");
  await page.keyboard.press("Escape");
  await expect(dlg).toHaveCount(0);
});

test("Remote-Dialog: Erfolg zeigt Haken-Satz, ruft beiFertig und schließt", async ({ page }) => {
  const anfragen = [];
  await page.route(/\/api\/git\/remote$/, async (route) => { anfragen.push(route.request().postDataJSON()); await new Promise((r) => setTimeout(r, 250)); route.fulfill({ json: { ok: true, zweig: "main" } }); });
  await oeffneSeite(page); await oeffneRemote(page);
  const dlg = page.locator('[data-dialog="remote"]');
  await dlg.locator("input").fill("  git@github.com:fbrogno1/brain.git ");
  await dlg.locator('[data-aktion="verbinden"]').click();
  // Zwischenzustand: prüft …, Eingabe und Knopf gesperrt
  await expect(dlg.locator(".rm-meldung")).toContainText("Prüfe die Adresse");
  await expect(dlg.locator('[data-aktion="verbinden"]')).toBeDisabled();
  await expect(dlg.locator("input")).toBeDisabled();
  await sichtbar(dlg.locator(".rm-spinner").first());
  await expect(dlg.locator(".rm-meldung.erfolg")).toHaveText("Verbunden. Dein Vault wird jetzt gesichert.");
  await sichtbar(dlg.locator(".rm-meldung.erfolg"));
  await expect(dlg).toHaveCount(0, { timeout: 4000 });
  expect(await page.evaluate(() => window.__ereignis)).toEqual([{ art: "fertig" }]);
  expect(anfragen).toEqual([{ url: "git@github.com:fbrogno1/brain.git" }]); // getrimmt, genau ein Aufruf
});

test("Remote-Dialog: Fehler zeigt den Text der Werkstatt, behält die Eingabe, erlaubt neuen Versuch", async ({ page }) => {
  let n = 0;
  const text = "Dieses Repository hat schon eine eigene Geschichte und passt nicht zu deinem Vault. Lege ein leeres Repository an und versuche es noch einmal.";
  await page.route(/\/api\/git\/remote$/, (route) => { n++; if (n === 1) route.fulfill({ status: 409, json: { fehler: text } }); else route.fulfill({ json: { ok: true } }); });
  await oeffneSeite(page); await oeffneRemote(page);
  const dlg = page.locator('[data-dialog="remote"]');
  await dlg.locator("input").fill("https://github.com/name/fremd.git");
  await dlg.locator("input").press("Enter"); // Enter sendet
  const fehler = dlg.locator(".rm-meldung.fehlertext");
  await expect(fehler).toHaveText(text);
  await sichtbar(fehler);
  await expect(dlg.locator("input")).toHaveValue("https://github.com/name/fremd.git");
  await expect(dlg.locator("input")).toBeEnabled();
  await expect(dlg.locator("input")).toBeFocused();
  await expect(dlg.locator('[data-aktion="verbinden"]')).toBeEnabled();
  expect(await page.evaluate(() => window.__ereignis)).toEqual([]);
  // Tippen entfernt die Fehlermeldung, erneuter Versuch klappt
  await dlg.locator("input").pressSequentially("x");
  await expect(fehler).toHaveCount(0);
  await dlg.locator("input").press("Backspace");
  await dlg.locator('[data-aktion="verbinden"]').click();
  await expect(dlg).toHaveCount(0, { timeout: 4000 });
  expect(n).toBe(2);
});

test("Remote-Dialog: leere oder ungültige Eingabe ruft das Netz nicht", async ({ page }) => {
  let aufrufe = 0;
  await page.route(/\/api\/git\/remote$/, (route) => { aufrufe++; route.fulfill({ json: { ok: true } }); });
  await oeffneSeite(page); await oeffneRemote(page);
  const dlg = page.locator('[data-dialog="remote"]');
  await dlg.locator('[data-aktion="verbinden"]').click();
  await expect(dlg.locator(".rm-meldung")).toHaveText("Gib zuerst die Adresse deines Repositorys ein.");
  await dlg.locator("input").fill("   ");
  await dlg.locator("input").press("Enter");
  await expect(dlg.locator(".rm-meldung")).toHaveText("Gib zuerst die Adresse deines Repositorys ein.");
  await dlg.locator("input").fill("brain");
  await dlg.locator("input").press("Enter");
  await expect(dlg.locator(".rm-meldung")).toContainText("noch nicht wie eine Git-Adresse aus");
  await dlg.locator("input").fill("https://github.com/a b/c.git");
  await dlg.locator("input").press("Enter");
  await expect(dlg.locator(".rm-meldung")).toContainText("noch nicht wie eine Git-Adresse aus");
  expect(aufrufe).toBe(0);
  await expect(dlg.locator("input")).toBeEnabled();
});

test("Remote-Dialog: Verbindungsfehler (Netz weg) zeigt Alltagstext", async ({ page }) => {
  await page.route(/\/api\/git\/remote$/, (route) => route.abort());
  await oeffneSeite(page); await oeffneRemote(page);
  const dlg = page.locator('[data-dialog="remote"]');
  await dlg.locator("input").fill("git@github.com:a/b.git");
  await dlg.locator("input").press("Enter");
  await sichtbar(dlg.locator(".rm-meldung.fehlertext"));
  await expect(dlg.locator(".rm-meldung.fehlertext")).not.toBeEmpty();
  await expect(dlg.locator("input")).toHaveValue("git@github.com:a/b.git");
});

// ================================================================= Screenshots (1440×900, @2x, hell + dunkel)
test.describe("Bilder", () => {
  test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  for (const schema of ["hell", "dunkel"]) {
    test("Bilder " + schema, async ({ page }) => {
      await page.emulateMedia({ colorScheme: schema === "hell" ? "light" : "dark", reducedMotion: "reduce" });
      const schaerfeLog = () => ({
        tage: tage([
          commit(1, "Notizen aktualisiert (3)", vor(0, 9, 41), [
            { pfad: "09_wiki/wissen/Kaffee.md", status: "M" }, { pfad: "00_inbox/2026-10-24_gedanke.md", status: "A" }, { pfad: "10_notizen/Reise nach Lissabon.md", status: "M" },
          ]),
          commit(2, "Mietwagen ergänzt", vor(0, 7, 5), [{ pfad: "10_notizen/Reise nach Lissabon.md", status: "M" }]),
          commit(3, "Inbox aufgeräumt und Entwürfe zusammengeführt", vor(1, 18, 30), [
            { pfad: "00_inbox/alt.md", status: "D" }, { pfad: "10_notizen/neu-benannt.md", status: "R" }, { pfad: "09_wiki/wissen/agentic-os/tief/thema_claude-mods.md", status: "A" },
          ]),
          commit(4, "Brain-Vorlage: Schema und Beispielseiten", vor(4, 12, 0), [{ pfad: "09_wiki/_schema.md", status: "A" }, { pfad: "09_wiki/wissen/Espresso.md", status: "A" }, { pfad: "AGENTS.md", status: "M" }]),
          commit(5, "Kaffee-Seite überarbeitet", vor(4, 9, 20), [{ pfad: "09_wiki/wissen/Kaffee.md", status: "M" }]),
          commit(6, "Erste Fassung", vor(16, 12, 0), [{ pfad: "09_wiki/wissen/Mühle.md", status: "A" }, { pfad: "10_notizen/crlf.md", status: "A" }]),
        ]),
      });
      await mocke(page, { log: schaerfeLog, status: STATUS_A });
      await mockeDiff(page);
      await oeffneSeite(page); await montiereListe(page);
      await expect(page.locator(".vl-tagkopf")).toHaveCount(4);
      // Zustand fürs Bild: ein Tag zu, ein Commit mit Dateiliste, eine Datei gewählt
      await page.locator(".vl-tagkopf").nth(3).click();
      await page.locator(".vl-commitzeile", { hasText: "Inbox aufgeräumt" }).click();
      await page.locator(".vl-datei", { hasText: "thema_claude-mods" }).click();
      await sichtbar(page.locator(".vl-datei").first());
      await page.mouse.move(700, 600);
      await page.screenshot({ path: join(BILDER, `v2-verlauf-liste-${schema}.png`) });

      await montiereDiff(page, { sha: sha(5), kurz: sha(5).slice(0, 7), nachricht: "Kaffee-Seite überarbeitet", pfad: "09_wiki/wissen/Kaffee.md", status: "M", zeit: vor(4, 9, 20).toISOString() });
      await sichtbar(page.locator(".vd-z.p").first());
      await page.screenshot({ path: join(BILDER, `v2-verlauf-diff-${schema}.png`) });

      if (schema === "hell") {
        await page.evaluate(() => window.__dv.zerstoere());
        await oeffneRemote(page);
        await sichtbar(page.locator('[data-dialog="remote"]'));
        await page.screenshot({ path: join(BILDER, "v2-remote-hell.png") });
      } else {
        await page.evaluate(() => window.__dv.zerstoere());
        await oeffneRemote(page);
        await page.route(/\/api\/git\/remote$/, (r) => r.fulfill({ status: 409, json: { fehler: "Dieses Repository hat schon eine eigene Geschichte und passt nicht zu deinem Vault. Lege ein leeres Repository an und versuche es noch einmal." } }));
        await page.locator('[data-dialog="remote"] input').fill("https://github.com/name/fremd.git");
        await page.locator('[data-dialog="remote"] input').press("Enter");
        await sichtbar(page.locator(".rm-meldung.fehlertext"));
        await page.screenshot({ path: join(BILDER, "v2-verlauf-remote-fehler-dunkel.png") });
      }
    });
  }
});

// W3 / Git gesperrt im Remote-Dialog
test("Remote-Dialog: Zeitüberschreitung lädt Info, Vault-Liste und Git-Status neu und sagt, dass der Ausgang unklar ist", async ({ page }) => {
  const abgerufen = [];
  await page.route(/\/api\/git\/remote$/, (route) => route.abort("failed"));
  await page.route("**/api/info", (route) => { abgerufen.push("info"); route.fulfill({ json: { vault: "/x/vault", name: "vault", git: true } }); });
  await page.route("**/api/vaults", (route) => { abgerufen.push("vaults"); route.fulfill({ json: { vaults: [], aktiv: "/x/vault" } }); });
  await mocke(page, { status: () => { abgerufen.push("status"); return STATUS_A; } });
  await oeffneSeite(page);
  await page.evaluate(async () => {
    const { oeffneRemoteDialog } = await import("/remote.js");
    window.__stand = null;
    oeffneRemoteDialog({ beiFertig: () => window.__ereignis.push({ art: "fertig" }), beiStandNeu: (st) => { window.__stand = { ok: st.ok, vault: st.info?.vault, git: st.git?.zweig }; } });
  });
  const dlg = page.locator('[data-dialog="remote"]');
  await dlg.locator("input").fill("git@github.com:name/brain.git");
  await dlg.locator('[data-aktion="verbinden"]').click();
  await expect(dlg.locator(".rm-meldung")).toHaveText("Das dauert länger als erwartet. Ich habe den Stand neu geladen – prüfe bitte, ob es geklappt hat.");
  await expect(dlg.locator("input")).toBeEnabled();
  expect([...new Set(abgerufen)].sort()).toEqual(["info", "status", "vaults"]);
  expect(await page.evaluate(() => window.__stand)).toEqual({ ok: true, vault: "/x/vault", git: "main" });
  expect(await page.evaluate(() => window.__ereignis)).toEqual([]);
});

test("Remote-Dialog: Frist der Werkstatt (504) zeigt deren Satz („nichts verändert“), Git gesperrt einen eigenen Satz", async ({ page }) => {
  let n = 0;
  await page.route("**/api/info", (route) => route.fulfill({ json: { vault: "/x/vault" } }));
  await page.route("**/api/vaults", (route) => route.fulfill({ json: { vaults: [] } }));
  await page.route(/\/api\/git\/remote$/, (route) => { n++; if (n === 1) route.fulfill({ status: 504, json: { fehler: "Der Server hat nicht rechtzeitig geantwortet. Es wurde nichts verändert — bitte später noch einmal versuchen." } }); else route.fulfill({ status: 409, json: { fehler: "Roher Backend-Text: Git ist gesperrt.", gitGesperrt: true } }); });
  await mocke(page);
  await oeffneSeite(page); await oeffneRemote(page);
  const dlg = page.locator('[data-dialog="remote"]');
  await dlg.locator("input").fill("git@github.com:name/brain.git");
  await dlg.locator('[data-aktion="verbinden"]').click();
  await expect(dlg.locator(".rm-meldung")).toHaveText("Der Server hat nicht rechtzeitig geantwortet. Es wurde nichts verändert — bitte später noch einmal versuchen.");
  await dlg.locator('[data-aktion="verbinden"]').click();
  await expect(dlg.locator(".rm-meldung")).toContainText("Git ist für diesen Vault gesperrt, bis du ihm vertraust.");
  await expect(dlg.locator(".rm-meldung")).not.toContainText("Roher Backend-Text");
});

test("Arbeit läuft: das Remote-Verbinden wird für vorSchliessen gemeldet", async ({ page }) => {
  await page.route(/\/api\/git\/remote$/, async (route) => { await new Promise((r) => setTimeout(r, 700)); route.fulfill({ json: { ok: true, zweig: "main" } }); });
  await oeffneSeite(page); await oeffneRemote(page);
  const dlg = page.locator('[data-dialog="remote"]');
  await dlg.locator("input").fill("git@github.com:name/brain.git");
  await dlg.locator('[data-aktion="verbinden"]').click();
  await expect(dlg.locator(".rm-meldung")).toContainText("Prüfe die Adresse");
  expect(await page.evaluate(async () => (await import("/hilfen.js")).laufendeArbeiten())).toEqual(["remote"]);
  await expect(dlg.locator(".rm-meldung.erfolg")).toBeVisible();
  expect(await page.evaluate(async () => (await import("/hilfen.js")).laufendeArbeiten())).toEqual([]);
});
