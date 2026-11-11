#!/usr/bin/env node
// Messung für große Vaults: Suche (brain_suchen / minisuche) und Nachladen im Studio nach einer Änderung — vorher/nachher.
//   node scripts/messe-grosse-vaults.mjs [Anzahl …]      Standard: 5000 20000
//   --ohne-repo                                              Vault ohne Git-Repository (Standard: mit Repository, wie bei echten Vaults)
//   --json                                                  Ergebnis als JSON statt Markdown-Tabelle
//   --ui [--alt <Ordner>]                                  zusätzlich im Browser: Start, Startdaten, Liste bis zum Ende scrollen (DOM-Knoten, Bildzeiten), „Was ist neu“, 500-KB-Absatz (R4-5) und ⌘K je Taste (Playwright aus Tests/Oberflaeche/node_modules, Chromium aus dem Playwright-Cache);
//                                                           --alt = Ordner einer älteren Fassung (mit Ressourcen/werkstatt und studio) für den Vorher-Wert
//   --ohne-volltext                                        die Volltext-Messung (Index der Werkstatt) auslassen
// Volltext (Suchindex): „vorher“ = bisherige suche() (liest bei jeder Anfrage alle Dateien, blockiert die Werkstatt); „nachher“ = Index im Speicher über /api/suche.
//   Abnahme bei 20.000 Notizen: Volltext p95 < 100 ms · ⌘K-Anfrage (Inhalt) p95 < 50 ms · ⌘K je Taste im Browser < 50 ms · der Aufbau blockiert nie (Speichern währenddessen < 50 ms).
// Alles in Temp-Ordnern (synthetischer Vault, eigenes HOME/Support, gesäuberte Git-Umgebung); nichts davon berührt echte Nutzerorte.
// „Vorher“ = Suche ohne Cache (Tests/Node/minisuche-referenz.mjs) bzw. Studio-Nachladen wie bisher: GET /api/baum + notizen + typen + ansichten.
// „Nachher“ = Index-Cache bzw. POST /api/teilindex (nur die geänderte Datei). Zeiten in ms (Median), ein Prozess, Betriebssystem-Cache warm.
import { mkdtempSync, rmSync, realpathSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import v8 from "node:v8";
import vm from "node:vm";
v8.setFlagsFromString("--expose-gc");
const gc = vm.runInNewContext("gc"); // Speicher des Index ehrlich messen: vorher und nachher aufräumen
const speicherMB = () => { gc(); const m = process.memoryUsage(); return (m.heapUsed + m.external) / 1e6; };

const hier = dirname(fileURLToPath(import.meta.url));
const wurzel = join(hier, "..");
const args = process.argv.slice(2);
const ohneGit = args.includes("--ohne-repo"), alsJson = args.includes("--json"), mitUi = args.includes("--ui"), ohneVolltext = args.includes("--ohne-volltext");
const altOrdner = args.includes("--alt") ? args[args.indexOf("--alt") + 1] : null;
const anzahlen = args.filter((a) => /^\d+$/.test(a)).map(Number);
if (!anzahlen.length) anzahlen.push(5000, 20000);

// Hermetisch: eigenes HOME und Support-Ordner, keine Git-Konfiguration des Nutzers, kein Vertrauensprüfstand der echten App.
const echtesHome = process.env.HOME; // nur um den Browser-Cache von Playwright zu finden (--ui); geschrieben wird dort nichts
const sandkasten = realpathSync(mkdtempSync(join(tmpdir(), "brain-messung-")));
process.env.HOME = sandkasten; process.env.USERPROFILE = sandkasten;
process.env.BRAIN_APP_SUPPORT = join(sandkasten, "support");
process.env.BRAIN_TESTMODUS = "1"; process.env.KORTEX_VAULT_VERTRAUT = "alle"; process.env.BRAIN_NUTZUNG = "aus";
for (const k of ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "XDG_CONFIG_HOME", "GIT_CONFIG_GLOBAL", "BRAIN_VAULT"]) delete process.env[k];
for (const k of Object.keys(process.env)) if (k.startsWith("GIT_")) delete process.env[k];
process.env.GIT_CONFIG_GLOBAL = "/dev/null"; process.env.GIT_CONFIG_NOSYSTEM = "1";
process.on("exit", () => { try { rmSync(sandkasten, { recursive: true, force: true }); } catch { /* egal */ } });

const { baueGrossVault } = await import(pathToFileURL(join(wurzel, "Tests", "Node", "gross-vault.mjs")).href);
const { minisucheReferenz } = await import(pathToFileURL(join(wurzel, "Tests", "Node", "minisuche-referenz.mjs")).href);
const { minisuche, leereMinisucheCache, minisucheStand } = await import(pathToFileURL(join(wurzel, "Ressourcen", "kern", "minisuche.mjs")).href);
const { oeffneVault } = await import(pathToFileURL(join(wurzel, "Ressourcen", "gemeinsam", "vault.mjs")).href);
const { erzeugeHandler } = await import(pathToFileURL(join(wurzel, "Ressourcen", "werkstatt", "handler.mjs")).href);

const ms = (f) => { const t = process.hrtime.bigint(); const r = f(); return [Number(process.hrtime.bigint() - t) / 1e6, r]; };
const msA = async (f) => { const t = process.hrtime.bigint(); const r = await f(); return [Number(process.hrtime.bigint() - t) / 1e6, r]; };
const median = (l) => { const s = [...l].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const prozent = (l, p) => { const s = [...l].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const warte = (ms) => new Promise((ok) => setTimeout(ok, ms));
const runde = (x) => (x >= 100 ? Math.round(x) : Math.round(x * 10) / 10);
const git = (cwd, ...a) => execFileSync("git", a, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: "Messung", GIT_AUTHOR_EMAIL: "m@example.org", GIT_COMMITTER_NAME: "Messung", GIT_COMMITTER_EMAIL: "m@example.org" }, stdio: "ignore" });

// ⌘K je Taste im Browser (Hauptthread): Palette öffnen, die Frage Buchstabe für Buchstabe eintragen, je Taste die Zeit des Eingabe-Handlers und bis zum nächsten Bild messen.
// Eigene Werkstatt (entwicklung.mjs) mit eigenem Support-Ordner; der Browser kommt aus dem Playwright-Cache. ordner = Wurzel mit Ressourcen/werkstatt und studio.
async function messeUi(vault) {
  { // ein Absatz von 500 KB ohne Leerzeile (eingefügtes Protokoll mit vielen [[Links]]) für die Messung des Editors
    const { writeFileSync: schreib, mkdirSync: mkd } = await import("node:fs");
    let t = "# Riese-Absatz\n\n"; for (let i = 0; t.length < 500000; i++) t += `wort ${i} [[Seite ${i % 500}]] und mehr text hier\n`;
    mkd(join(vault, "10_projekte"), { recursive: true }); schreib(join(vault, "10_projekte", "Riese-Absatz.md"), t + "\n");
  }
  const { spawn } = await import("node:child_process");
  const { createRequire } = await import("node:module");
  const { existsSync, readdirSync, mkdtempSync: mk } = await import("node:fs");
  const pw = createRequire(join(wurzel, "Tests", "Oberflaeche", "package.json"))("@playwright/test");
  const cache = join(echtesHome, "Library/Caches/ms-playwright");
  let exe;
  for (const o of existsSync(cache) ? readdirSync(cache).filter((x) => x.startsWith("chromium_headless_shell-")).sort().reverse() : []) for (const a of ["chrome-headless-shell-mac-arm64", "chrome-headless-shell-mac-x64"]) { const p = join(cache, o, a, "chrome-headless-shell"); if (!exe && existsSync(p)) exe = p; }
  const messe = async (ordner) => {
    const support = mk(join(tmpdir(), "brain-messung-ui-"));
    const env = { ...process.env, BRAIN_APP_SUPPORT: support, BRAIN_TESTMODUS: "1", BRAIN_VAULT: "", KORTEX_KERN_PFAD: "" };
    const kind = spawn(process.execPath, [join(ordner, "Ressourcen/werkstatt/entwicklung.mjs"), vault, "0"], { stdio: ["ignore", "pipe", "pipe"], env });
    const url = await new Promise((ok, nein) => { let puf = ""; const t = setTimeout(() => nein(new Error("Werkstatt startet nicht: " + puf)), 20000); const lies = (d) => { puf += d; const m = /Bereit: (http:\/\/127\.0\.0\.1:\d+\/)/.exec(puf); if (m) { clearTimeout(t); ok(m[1]); } }; kind.stdout.on("data", lies); kind.stderr.on("data", lies); });
    const browser = await pw.chromium.launch({ executablePath: exe });
    try {
      const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
      const bytes = {}; page.on("response", async (r) => { const u = new URL(r.url()).pathname; if (/^\/api\/(notizen|index|baum)$/.test(u)) { try { bytes[u] = (await r.body()).length; } catch { /* egal */ } } });
      await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "platform", { get: () => "MacIntel", configurable: true }));
      const start = Date.now();
      await page.goto(url);
      await page.waitForSelector("[data-karte], [data-leer]", { timeout: 180000 });
      const bisKarte = Date.now() - start;
      // R4-5: Startdaten, „Was ist neu“, Liste bis zum Ende, Riesen-Absatz
      await page.waitForTimeout(1500);
      const liste = { startBytes: (bytes["/api/index"] || 0) + (bytes["/api/notizen"] || 0), baumBytes: bytes["/api/baum"] || 0, knotenStart: await page.evaluate(() => document.querySelector("#liste-koerper").getElementsByTagName("*").length) };
      const tn = Date.now();
      await page.click('[data-bereich="inbox"]');
      try { await page.waitForFunction(() => { const z = document.querySelector("[data-nk-zusammen]"); return z && !/zusammengestellt/.test(z.textContent); }, null, { timeout: 30000 }); liste.wasIstNeuMs = Date.now() - tn; } catch { liste.wasIstNeuMs = null; }
      await page.waitForTimeout(3500);
      await page.click('[data-bereich="alle"]');
      await page.waitForSelector("#liste-koerper [data-karte]");
      await page.waitForTimeout(500);
      Object.assign(liste, await page.evaluate(async () => {
        const e = document.querySelector("#liste-koerper"), d = []; let l = performance.now(), n = 0;
        const t0 = l;
        await new Promise((res) => { const f = (t) => { d.push(t - l); l = t; e.scrollTop += 3000; if (e.scrollTop + e.clientHeight >= e.scrollHeight - 2 || ++n > 20000) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
        d.shift(); d.sort((a, b) => a - b);
        return { scrollMs: performance.now() - t0, frameP95: d[Math.floor(d.length * 0.95)] || 0, frameMax: d[d.length - 1] || 0, knotenEnde: e.getElementsByTagName("*").length, karteneEnde: e.querySelectorAll("[data-karte]").length };
      }));
      await page.keyboard.press("Meta+k");
      await page.keyboard.type("Riese-Absatz");
      await page.waitForTimeout(900);
      const tr = Date.now();
      await page.keyboard.press("Enter");
      try {
        await page.waitForFunction(() => (document.querySelector(".cm-content")?.textContent || "").includes("wort 0 "), null, { timeout: 60000 });
        await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
        liste.riesenOeffnenMs = Date.now() - tr;
        await page.click(".cm-content"); await page.keyboard.press("Meta+ArrowDown");
        const lat = [];
        for (let i = 0; i < 9; i++) {
          await page.evaluate(() => { window.__t0 = null; addEventListener("keydown", () => { window.__t0 = performance.now(); }, { capture: true, once: true }); });
          await page.keyboard.press("x");
          lat.push(await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok(performance.now() - window.__t0))))));
        }
        liste.riesenTasteMs = median(lat);
      } catch { liste.riesenOeffnenMs = null; }
      await page.keyboard.press("Escape");
      await page.keyboard.press("Meta+k");
      await page.waitForSelector(".palette input:focus");
      const proTaste = [];
      for (const f of ["a", "ka", "kal", "kalo", "kalor", "lo", "lom", "lomi", "mi", "mist", "oxe", "oxei", "wal", "walk", "walke"]) {
        proTaste.push(await page.evaluate(async (q) => {
          const eingabe = document.querySelector(".palette input");
          const t0 = performance.now();
          eingabe.value = q; eingabe.dispatchEvent(new Event("input", { bubbles: true }));
          const handler = performance.now() - t0;
          await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
          return { handler, bisBild: performance.now() - t0 };
        }, f));
        await page.waitForTimeout(250); // die entprellte Inhalts-Anfrage ist danach durch, bevor die nächste Taste kommt
      }
      return { liste, bisKarteMs: bisKarte, handlerMedian: median(proTaste.map((x) => x.handler)), handlerMax: Math.max(...proTaste.map((x) => x.handler)), bisBildMedian: median(proTaste.map((x) => x.bisBild)), bisBildMax: Math.max(...proTaste.map((x) => x.bisBild)) };
    } finally { await browser.close(); kind.kill(); }
  };
  const aus = { neu: await messe(wurzel) };
  if (altOrdner) aus.alt = await messe(altOrdner);
  return aus;
}

const ergebnisse = [];
for (const n of anzahlen) {
  process.stderr.write(`\n== ${n} Dateien: Vault erzeugen …\n`);
  const g = baueGrossVault(n, { start: 42 });
  const bytes = g.dateien.reduce((s, r) => s + 1, 0) && 0;
  if (!ohneGit) {
    process.stderr.write("   Git-Repository anlegen und committen …\n");
    git(g.vault, "init", "-q", "-b", "main"); git(g.vault, "add", "--", "."); git(g.vault, "commit", "-q", "-m", "Start");
  }
  const fragen = Array.from({ length: 6 }, () => `${g.wort()} ${g.wort()} ${g.wort()}`);
  const r = { n };

  // ---------- Suche: Kern (minisuche) ----------
  process.stderr.write("   Suche …\n");
  leereMinisucheCache();
  const altErst = ms(() => minisucheReferenz(g.vault, fragen[0], 15))[0];
  const altFolge = median(fragen.slice(1).map((f) => ms(() => minisucheReferenz(g.vault, f, 15))[0]));
  const neuErst = ms(() => minisuche(g.vault, fragen[0], 15))[0];
  const neuFolge = median(fragen.slice(1).map((f) => ms(() => minisuche(g.vault, f, 15))[0]));
  // Nach einer Änderung: eine Datei neu schreiben, dann suchen
  const ziel = g.dateien[Math.floor(n / 2)];
  g.aendere(ziel); const t0 = new Date(Date.now() - 3600 * 1000); utimesSync(join(g.vault, ziel), t0, t0);
  const altNachAenderung = ms(() => minisucheReferenz(g.vault, fragen[1], 15))[0];
  const neuNachAenderung = ms(() => minisuche(g.vault, fragen[1], 15))[0];
  // Gleichheit der Treffer (Pfade und Punktzahlen)
  const gleich = fragen.every((f) => JSON.stringify(minisuche(g.vault, f, 15)) === JSON.stringify(minisucheReferenz(g.vault, f, 15)));
  r.suche = { altErst, altFolge, neuErst, neuFolge, altNachAenderung, neuNachAenderung, gleich, speicherMB: Math.round(process.memoryUsage().heapUsed / 1e6), stand: minisucheStand() };

  // ---------- Suche: brain_suchen (Vault-Objekt wie im MCP-Prozess; Cache schon warm → „folgende“) ----------
  const v = oeffneVault(g.vault, { ohneUnterVaults: true });
  leereMinisucheCache();
  const [mcpErst] = await msA(() => v.suchenFuerKi(fragen[0], 5));
  const mcpFolge = median(await Promise.all([]).then(async () => { const l = []; for (const f of fragen.slice(1)) l.push((await msA(() => v.suchenFuerKi(f, 5)))[0]); return l; }));
  r.mcp = { erst: mcpErst, folge: mcpFolge };

  // ---------- Studio: Nachladen nach einer Änderung ----------
  process.stderr.write("   Studio-Nachladen …\n");
  const alle = async () => { const [b, i] = await Promise.all([Promise.resolve().then(() => v.baum()), Promise.all([v.notizen(), v.typen(), v.ansichten()])]); return { baum: b, n: i[0], t: i[1], a: i[2] }; };
  const [erstLaden, erst] = await msA(alle);                         // kaltes Laden (liest alle Dateien einmal)
  const jsonBytes = (o) => Buffer.byteLength(JSON.stringify(o));
  const antwortBytes = jsonBytes(erst.baum) + jsonBytes(erst.n) + jsonBytes(erst.t) + jsonBytes(erst.a);
  const rohText = JSON.stringify(erst.baum) + JSON.stringify(erst.n) + JSON.stringify(erst.t) + JSON.stringify(erst.a);
  const [parseMs] = ms(() => { JSON.parse(JSON.stringify(erst.baum)); JSON.parse(JSON.stringify(erst.n)); });
  // Client-Aufbau nach dem Laden: Karte pfad→Eintrag und Signatur über alle Notizen (wie ladeBaum/zeichneNachIndex in studio/app.js)
  const [clientVoll] = ms(() => {
    const m = new Map(erst.baum.eintraege.map((e) => [e.pfad, e]));
    const nm = new Map(erst.n.notizen.map((x) => [x.pfad, x]));
    return erst.n.notizen.length + ":" + erst.n.notizen.map((x) => `${x.pfad}|${x.geaendert}|${x.titel}|${x.stufe}|${x.typ}|${x.felder?.spaeter_bis || ""}`).join(";") + "#" + m.size + nm.size;
  });
  const wiederholt = async (f, k = 5) => { const l = []; for (let i = 0; i < k; i++) { g.aendere(ziel, `${g.wort()} ${g.wort()}\n\n${"Zeile mit Inhalt. ".repeat(10 + i)}\n`); const [t] = await msA(f); l.push(t); await new Promise((ok) => setTimeout(ok, 20)); } return l; };
  const vorherL = await wiederholt(alle);
  const alles2 = async () => { const [b, i] = await Promise.all([Promise.resolve().then(() => v.baum()), v.indexAlles()]); return { b, i }; };
  const nachherVollL = await wiederholt(alles2);
  const teilBytes = [];
  const nachherTeilL = await wiederholt(async () => { const x = await v.teilIndex([ziel]); teilBytes.push(jsonBytes(x)); if (x.voll) throw new Error("Teil-Index lieferte voll"); return x; });
  r.studio = {
    erstLaden, vorher: median(vorherL), nachherVoll: median(nachherVollL), nachherTeil: median(nachherTeilL),
    antwortKB: Math.round(antwortBytes / 1024), teilKB: Math.round(median(teilBytes) / 1024 * 10) / 10,
    clientVoll: parseMs + clientVoll, clientTeil: 0.1,
  };
  // ---------- Volltext: bisherige suche() gegen den Index der Werkstatt ----------
  if (!ohneVolltext) {
    process.stderr.write("   Volltext (Index) …\n");
    const speicherVorher = speicherMB();
    const volltextFragen = Array.from({ length: 6 }, () => `${g.wort()} ${g.wort()}`);
    const alt = volltextFragen.map((f) => ms(() => v.suche(f))[0]);          // jede Anfrage liest alle Dateien und blockiert die Werkstatt so lange
    const h = erzeugeHandler({ vault: g.vault, studioDir: join(wurzel, "Ressourcen", "studio"), appVersion: "messung", suchindexVorwaermen: 0 });
    const rufe = async (methode, p, daten, query) => { const t = process.hrtime.bigint(); const a = await h({ methode, pfad: p, query: query ?? null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) }); return [Number(process.hrtime.bigint() - t) / 1e6, a]; };
    const json = (a) => JSON.parse(a.body.toString("utf8"));
    // Aufbau: die erste Suche stößt ihn an; währenddessen speichern (PUT) und die Ereignisschleife beobachten
    let letzter = performance.now(), verzug = 0;
    const wache = setInterval(() => { const jetzt = performance.now(); verzug = Math.max(verzug, jetzt - letzter - 2); letzter = jetzt; }, 2);
    const bauStart = performance.now();
    const erste = rufe("GET", "/api/suche", undefined, `q=${encodeURIComponent(volltextFragen[0])}&limit=30`);
    const speichern = [];
    let fertigNach = null;
    for (let k = 0; fertigNach === null && k < 600; k++) {
      const datei = g.dateien[(k * 97) % g.dateien.length];
      const d = json((await rufe("GET", "/api/datei", undefined, `pfad=${encodeURIComponent(datei)}`))[1]);
      speichern.push((await rufe("PUT", "/api/datei", { pfad: datei, inhalt: d.inhalt + `\nMessung ${k}\n`, basisHash: d.hash }))[0]);
      await warte(20);
      if (k % 5 === 4 && json((await rufe("GET", "/api/suche", undefined, "q=zzzqqq&limit=1"))[1]).aufbau.fertig) fertigNach = performance.now() - bauStart;
    }
    const [ersteMs, ersteAntwort] = await erste;
    clearInterval(wache);
    const ersteJ = json(ersteAntwort);
    // Warm: Volltext-Anfragen (1–3 Wörter, Wortanfang, Tippfehler, Phrase, Filter) und ⌘K-Anfragen (nur 8 Treffer)
    const mix = () => [g.wort(), `${g.wort()} ${g.wort()}`, `${g.wort()} ${g.wort()} ${g.wort()}`, g.wort().slice(0, 4), g.wort() + "x", `"${g.wort()} ${g.wort()}"`, `typ:thema ${g.wort()}`, `geaendert:<7d ${g.wort()}`, `ordner:bereich-1 ${g.wort()}`];
    const volltext = [], palette = [], facettenZeiten = [];
    for (let k = 0; k < 40; k++) for (const f of mix()) {
      volltext.push((await rufe("GET", "/api/suche", undefined, `q=${encodeURIComponent(f)}&limit=30`))[0]);
      palette.push((await rufe("GET", "/api/suche", undefined, `q=${encodeURIComponent(f)}&limit=8`))[0]);
    }
    for (let k = 0; k < 30; k++) facettenZeiten.push((await rufe("GET", "/api/suche", undefined, `q=${encodeURIComponent(g.wort())}&limit=30&facetten=1`))[0]);
    // Nach einer Änderung: gespeichert, sofort gesucht (der Index zieht die eine Datei nach)
    const nach = [];
    for (let k = 0; k < 10; k++) {
      const datei = g.dateien[k * 11 + 1];
      const d = json((await rufe("GET", "/api/datei", undefined, `pfad=${encodeURIComponent(datei)}`))[1]);
      await rufe("PUT", "/api/datei", { pfad: datei, inhalt: d.inhalt + `\nNeuwort${k}xyz\n`, basisHash: d.hash });
      const [t, a] = await rufe("GET", "/api/suche", undefined, `q=Neuwort${k}xyz&limit=5`);
      if (!json(a).treffer.some((x) => x.pfad === datei)) throw new Error("Der Index kennt die gespeicherte Datei nicht");
      nach.push(t);
    }
    const stand = json((await rufe("GET", "/api/suche", undefined, "q=zzzqqq&limit=1"))[1]).aufbau;
    r.volltext = {
      altMedian: median(alt), altMax: Math.max(...alt),
      bauErsteAntwort: ersteMs, bauFertig: fertigNach, bauVerzugMax: verzug, speichernAnzahl: speichern.length, speichernMedian: median(speichern), speichernP95: prozent(speichern, 0.95), speichernMax: Math.max(...speichern),
      volltextMedian: median(volltext), volltextP95: prozent(volltext, 0.95), volltextMax: Math.max(...volltext),
      paletteMedian: median(palette), paletteP95: prozent(palette, 0.95), paletteMax: Math.max(...palette),
      facettenP95: prozent(facettenZeiten, 0.95), nachAenderung: median(nach), dokumente: stand.dokumente,
      heapMB: Math.round(speicherMB() - speicherVorher), ersteVorlaeufig: !!ersteJ.aufbau && !ersteJ.aufbau.fertig,
    };
    if (mitUi) r.ui = await messeUi(g.vault);
  }
  ergebnisse.push(r);
  rmSync(g.vault, { recursive: true, force: true });
}

if (alsJson) console.log(JSON.stringify(ergebnisse, null, 2));
else {
  const f = (x) => String(runde(x));
  console.log(`Messung (${process.platform}/${process.arch}, Node ${process.version}, ${ohneGit ? "ohne" : "mit"} Git-Repository im Vault; Median, ms)\n`);
  console.log("| Dateien | Suche (Kern) | vorher | nachher |\n|---:|---|---:|---:|");
  for (const r of ergebnisse) {
    const s = r.suche;
    console.log(`| ${r.n} | erste Suche | ${f(s.altErst)} | ${f(s.neuErst)} |`);
    console.log(`| ${r.n} | folgende Suche | ${f(s.altFolge)} | ${f(s.neuFolge)} |`);
    console.log(`| ${r.n} | Suche nach 1 Änderung | ${f(s.altNachAenderung)} | ${f(s.neuNachAenderung)} |`);
  }
  console.log("\n| Dateien | brain_suchen (Vault-Objekt, MCP) | nachher |\n|---:|---|---:|");
  for (const r of ergebnisse) { console.log(`| ${r.n} | erster Aufruf | ${f(r.mcp.erst)} |`); console.log(`| ${r.n} | folgende Aufrufe | ${f(r.mcp.folge)} |`); }
  console.log("\n| Dateien | Studio: Nachladen nach 1 Änderung (Werkstatt-Zeit) | vorher | nachher |\n|---:|---|---:|---:|");
  for (const r of ergebnisse) {
    const s = r.studio;
    console.log(`| ${r.n} | alles neu laden (baum + notizen + typen + ansichten → baum + index) | ${f(s.vorher)} | ${f(s.nachherVoll)} |`);
    console.log(`| ${r.n} | Teil-Index (/api/teilindex, 1 Datei) | ${f(s.vorher)} | ${f(s.nachherTeil)} |`);
    console.log(`| ${r.n} | Antwortgröße (KB) | ${s.antwortKB} | ${s.teilKB} |`);
    console.log(`| ${r.n} | Client: JSON lesen + Signatur über alle Notizen (Node, ungefähr) | ${f(s.clientVoll)} | ≈ 0 (nur betroffene Zeilen) |`);
  }
  if (ergebnisse.some((r) => r.volltext)) {
    console.log("\n| Dateien | Volltext (Suchindex der Werkstatt) | vorher (suche(), blockiert) | nachher (Index, /api/suche) |\n|---:|---|---:|---:|");
    for (const r of ergebnisse) {
      const x = r.volltext; if (!x) continue;
      console.log(`| ${r.n} | je Anfrage, Median | ${f(x.altMedian)} | ${f(x.volltextMedian)} |`);
      console.log(`| ${r.n} | je Anfrage, p95 (Ziel < 100) | ${f(x.altMax)} (größte) | ${f(x.volltextP95)} ${x.volltextP95 < 100 ? "✔" : "✘"} |`);
      console.log(`| ${r.n} | ⌘K-Anfrage (8 Treffer), p95 (Ziel < 50) | – | ${f(x.paletteP95)} ${x.paletteP95 < 50 ? "✔" : "✘"} |`);
      console.log(`| ${r.n} | mit Filterzahlen (Chips), p95 | – | ${f(x.facettenP95)} |`);
      console.log(`| ${r.n} | gespeichert, sofort gesucht (Datei ist auffindbar), Median | ${f(x.altMedian)} | ${f(x.nachAenderung)} |`);
      console.log(`| ${r.n} | Aufbau des Index bis fertig (im Hintergrund) | – | ${x.bauFertig === null ? "länger als die Messung" : f(x.bauFertig) + " ms"} |`);
      console.log(`| ${r.n} | Speichern WÄHREND des Aufbaus (${x.speichernAnzahl}×): Median / p95 / größte (Ziel < 50) | blockiert ≈ ${f(x.altMedian)} je Suche | ${f(x.speichernMedian)} / ${f(x.speichernP95)} / ${f(x.speichernMax)} ${x.speichernMax < 50 ? "✔" : "✘"} |`);
      console.log(`| ${r.n} | Verzug der Ereignisschleife während des Aufbaus, größter | ≈ ${f(x.altMedian)} je Suche | ${f(x.bauVerzugMax)} |`);
      console.log(`| ${r.n} | Speicher des Index (Heap + Puffer nach Aufräumen) | – | ${x.heapMB} MB |`);
    }
  }
  if (ergebnisse.some((r) => r.ui?.neu?.liste)) {
    console.log("\n| Dateien | Große Vaults im Studio (R4-5) | vorher | nachher |\n|---:|---|---:|---:|");
    const F = (x, k, z = (v) => f(v)) => (x && x.liste && x.liste[k] != null ? z(x.liste[k]) : "–");
    const kb = (v) => `${f(v / 1024)} KB`;
    for (const r of ergebnisse) {
      const u = r.ui; if (!u?.neu?.liste) continue;
      for (const [name, k, z] of [["Startdaten /api/index (Ziel ≤ 1 MB)", "startBytes", kb], ["DOM-Knoten der Liste am Start", "knotenStart"], ["DOM-Knoten der Liste am Ende (Ziel ≤ 3000)", "knotenEnde"], ["Karten im DOM am Ende", "kartenende"], ["Liste bis zum Ende scrollen (ms)", "scrollMs"], ["Bild beim Scrollen p95 / größtes (ms, Ziel p95 ≤ 17)", "frameP95"], ["„Was ist neu“ im Posteingang (ms, Ziel ≤ 500)", "wasIstNeuMs"], ["500-KB-Absatz öffnen (ms, Ziel ≤ 300)", "riesenOeffnenMs"], ["Taste im 500-KB-Absatz (ms bis 2. Bild, Mindestwert ≈ 33)", "riesenTasteMs"]]) {
        const kk = k === "kartenende" ? "karteneEnde" : k;
        const extra = (x) => (k === "frameP95" && x?.liste ? ` / ${F(x, "frameMax")}` : "");
        console.log(`| ${r.n} | ${name} | ${u.alt ? F(u.alt, kk, z) + extra(u.alt) : "–"} | ${F(u.neu, kk, z)}${extra(u.neu)} |`);
      }
    }
  }
  if (ergebnisse.some((r) => r.ui)) {
    console.log("\n| Dateien | ⌘K je Taste im Browser (Hauptthread) | vorher | nachher |\n|---:|---|---:|---:|");
    for (const r of ergebnisse) {
      const u = r.ui; if (!u) continue;
      console.log(`| ${r.n} | Eingabe-Handler, Median / größte (Ziel < 50) | ${u.alt ? f(u.alt.handlerMedian) + " / " + f(u.alt.handlerMax) : "–"} | ${f(u.neu.handlerMedian)} / ${f(u.neu.handlerMax)} ${u.neu.handlerMax < 50 ? "✔" : "✘"} |`);
      console.log(`| ${r.n} | bis zum nächsten Bild, Median / größte | ${u.alt ? f(u.alt.bisBildMedian) + " / " + f(u.alt.bisBildMax) : "–"} | ${f(u.neu.bisBildMedian)} / ${f(u.neu.bisBildMax)} |`);
      console.log(`| ${r.n} | Start bis erste Karte | ${u.alt ? f(u.alt.bisKarteMs) : "–"} | ${f(u.neu.bisKarteMs)} |`);
    }
  }
  console.log("\nTreffer gleich (Pfade und Punktzahlen, alle Fragen): " + ergebnisse.map((r) => `${r.n}: ${r.suche.gleich ? "ja" : "NEIN"}`).join(", "));
  console.log("Kaltes Laden im Studio (alle Dateien einmal lesen): " + ergebnisse.map((r) => `${r.n}: ${f(r.studio.erstLaden)} ms`).join(", "));
}
