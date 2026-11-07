// Electron-Pakete (Paket W2c, electron/paket, electron/laufzeit.mjs, electron/updater.mjs): die Teile ohne Electron — Konfiguration von electron-builder, zusammengestellte Ressourcen,
// Node holen mit Prüfsumme, die Laufzeit im Support-Ordner (stabile Pfade), der Updater-Ablauf gegen eine Attrappe, die Vorschau. Das gebaute Paket selbst prüft electron/test/paket.spec.mjs
// (Job „paket“ der CI), den Updater gegen einen lokalen Dateiserver electron/test/updater.spec.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const W = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const laden = (rel) => import(pathToFileURL(join(W, rel)).href);
const temp = () => realpathSync(mkdtempSync(join(tmpdir(), "kortex-w2c-test-")));
const WIN = process.platform === "win32";
const EXE = WIN ? "node.exe" : "node";
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

const { installiereNode, installiereKern, installiereLaufzeit, setzeDateiLink } = await laden("electron/laufzeit.mjs");
const { stageRessourcen, stempelVon, AUSGELASSEN } = await laden("electron/paket/ressourcen.mjs");
const { baueKonfig, APP_ID } = await laden("electron/paket/konfig.mjs");
const { holeNode, suchePruefsumme, liesVersion, ZIELE } = await laden("electron/paket/hole-node.mjs");
const { erzeugeUpdater, konfiguriere, updatesMoeglich } = await laden("electron/updater.mjs");
const { githubClientId, appVersion, plistWert } = await laden("electron/info-plist.mjs");

// ───────────── Info.plist: die eine Quelle für Version und GitHub-Client-ID ─────────────
test("Info.plist: Client-ID und Version kommen aus der Datei der Mac-App (kein zweiter Wert im Quelltext der Hülle)", () => {
  const plist = join(W, "Ressourcen/Info.plist");
  assert.match(githubClientId(plist), /^[A-Za-z0-9._-]{4,100}$/);
  assert.match(appVersion(plist), /^\d+\.\d+\.\d+/);
  assert.equal(plistWert("<key>A</key>\n <string> x </string>", "A"), "x");
  assert.equal(githubClientId(join(W, "gibt-es-nicht")), null);
  // Die Hülle schreibt die ID nirgends fest: im Quelltext von electron/ steht sie nicht
  const id = githubClientId(plist);
  for (const f of readdirSync(join(W, "electron")).filter((n) => /\.(mjs|cjs|json)$/.test(n) && n !== "package-lock.json")) assert.equal(readFileSync(join(W, "electron", f), "utf8").includes(id), false, f);
});

// ───────────── Konfiguration von electron-builder ─────────────
test("Paketkonfiguration: NSIS pro Benutzer ohne Admin mit AppUserModelID, Linux AppImage + deb, kein Veröffentlichen, keine Signatur, Node und Ressourcen als extraResources", () => {
  const k = baueKonfig({ version: "1.2.3-beta.4", ressourcen: "build/ressourcen", ausgabe: "/tmp/x" });
  assert.equal(k.appId, APP_ID);
  assert.equal(k.appId, plistWert(readFileSync(join(W, "Ressourcen/Info.plist"), "utf8"), "CFBundleIdentifier"), "dieselbe Kennung wie die Mac-App");
  assert.match(readFileSync(join(W, "electron/haupt.mjs"), "utf8"), new RegExp(`setAppUserModelId\\("${APP_ID.replace(/\./g, "\\.")}"\\)`), "haupt.mjs und Installer nennen dieselbe AppUserModelID");
  assert.deepEqual(k.win.target, [{ target: "nsis", arch: ["x64"] }]);
  assert.equal(k.nsis.oneClick, true);
  assert.equal(k.nsis.perMachine, false);
  assert.equal(k.nsis.allowElevation, false);
  assert.equal(k.nsis.deleteAppDataOnUninstall, false, "der Vault und der Support-Ordner gehören dem Nutzer");
  assert.deepEqual(k.linux.target, ["AppImage", "deb"]);
  assert.deepEqual(k.publish, [{ provider: "github", owner: "fabiobrogno", repo: "brain-app" }]);
  assert.deepEqual(baueKonfig({ version: "1.0.0", genericUrl: "http://127.0.0.1:1", ressourcen: "r", ausgabe: "a" }).publish, [{ provider: "generic", url: "http://127.0.0.1:1" }]);
  assert.equal(k.extraMetadata.version, "1.2.3-beta.4");
  assert.deepEqual(k.extraResources.map((e) => e.to), ["Ressourcen", "node"]);
  assert.match(k.extraResources[1].from, /node\/\$\{os\}-\$\{arch\}$/);
  const text = JSON.stringify(k);
  assert.equal(/certificate|signingHashAlgorithms|identity|msi|snap|flatpak/i.test(text), false, "keine Signatur, kein MSI/Snap/Flatpak");
  // Symbole und Code der Hülle gehen mit, Tests nicht
  for (const f of [k.win.icon, k.linux.icon]) assert.ok(existsSync(join(W, "electron", f)), f);
  assert.ok(k.files.includes("!playwright.config.mjs") && !k.files.some((p) => /(^|\/)tests?(\/|$)/.test(p)));
  // das Paket fragt GitHub nur mit eigenem Kanal (Beta folgt Prereleases) — Einstellung im Updater, nicht in der Konfiguration
  assert.equal(k.forceCodeSigning, false);
});

test("electron/package.json: electron-builder und electron-updater mit exakter Version, Updater als Laufzeit-Abhängigkeit", () => {
  const p = JSON.parse(readFileSync(join(W, "electron/package.json"), "utf8"));
  assert.match(p.devDependencies["electron-builder"], /^\d+\.\d+\.\d+$/);
  assert.match(p.dependencies["electron-updater"], /^\d+\.\d+\.\d+$/);
  assert.equal(p.devDependencies["electron-updater"], undefined);
});

// ───────────── Ressourcen im Paket ─────────────
test("Ressourcen fürs Paket: Werkstatt, Kern (mit mcp und gemeinsam), Studio, Lizenzen — keine Entwürfe, Mac-Dateien oder Tests; Version und Stempel stimmen", () => {
  const ziel = join(temp(), "r");
  stageRessourcen({ wurzel: W, ziel, version: "9.8.7" });
  for (const f of ["werkstatt/werkstatt.mjs", "studio/index.html", "gemeinsam/basis.mjs", "kern/brain.mjs", "kern/mcp/brain-mcp.mjs", "kern/gemeinsam/vault.mjs", "mcp/brain-mcp.mjs", "THIRD-PARTY-NOTICES.md", "studio/THIRD-PARTY-NOTICES.md", "LICENSE", "Info.plist"]) assert.ok(existsSync(join(ziel, f)), f);
  for (const weg of AUSGELASSEN) assert.equal(existsSync(join(ziel, weg)), false, weg);
  assert.equal(readFileSync(join(ziel, "kern/VERSION"), "utf8").trim(), "9.8.7");
  assert.equal(appVersion(join(ziel, "Info.plist")), "9.8.7");
  assert.equal(githubClientId(join(ziel, "Info.plist")), githubClientId(join(W, "Ressourcen/Info.plist")));
  assert.equal(readFileSync(join(ziel, "kern/.stempel"), "utf8").trim(), stempelVon(join(ziel, "kern")));
  // keine Testdateien im Paket
  const gefunden = [];
  const gehe = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) { if (/^(tests?|__tests__|fixtures?)$/i.test(n)) gefunden.push(relative(ziel, p)); gehe(p); } else if (/\.(test|spec)\.m?js$/.test(n)) gefunden.push(relative(ziel, p)); } };
  gehe(ziel);
  assert.deepEqual(gefunden, []);
  // gleiche Größenordnung wie die Mac-App (nur was gebraucht wird)
  let groesse = 0; const summe = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); const s = statSync(p); if (s.isDirectory()) summe(p); else groesse += s.size; } };
  summe(ziel);
  assert.ok(groesse < 30 * 1024 * 1024, `Ressourcen ${groesse} Bytes`);
});

test("MCP-Server aus dem Kern-Bündel startet vom stabilen Pfad (bin/kern/mcp/brain-mcp.mjs) mit seinem relativen gemeinsamen Code", async () => {
  const d = temp(), support = join(d, "support");
  stageRessourcen({ wurzel: W, ziel: join(d, "r"), version: "9.8.7" });
  const r = installiereKern({ quelle: join(d, "r", "kern"), support });
  const mcp = join(r.kern, "mcp", "brain-mcp.mjs");
  const k = spawn(process.execPath, [mcp], { env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: d, USERPROFILE: d, BRAIN_APP_SUPPORT: support, BRAIN_TESTMODUS: "1" }, stdio: ["pipe", "pipe", "pipe"] });
  const antwort = await new Promise((ok, nein) => {
    let puffer = ""; const t = setTimeout(() => { k.kill(); nein(new Error("keine Antwort")); }, 20_000);
    k.stdout.on("data", (b) => { puffer += b; const i = puffer.indexOf("\n"); if (i >= 0) { clearTimeout(t); ok(JSON.parse(puffer.slice(0, i))); } });
    k.on("error", nein);
    k.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } } })}\n`);
  });
  k.kill();
  assert.equal(antwort.id, 1);
  assert.ok(antwort.result?.serverInfo, JSON.stringify(antwort));
});

// ───────────── Node holen ─────────────
test("Node fürs Paket: dieselbe Version wie die Mac-App, Prüfsumme aus SHASUMS256.txt; falsche Summe wird verworfen (lokaler Server, keine Netzabfrage)", async (t) => {
  assert.equal(liesVersion(), readFileSync(join(W, "scripts/node-version.txt"), "utf8").trim());
  assert.deepEqual(Object.keys(ZIELE).sort(), ["linux-arm64", "linux-x64", "win-x64"]);
  assert.equal(suchePruefsumme(`${"a".repeat(64)}  x.tar.xz\n${"b".repeat(64)}  y.tar.xz\n`, "y.tar.xz"), "b".repeat(64));
  assert.equal(suchePruefsumme("kaputt\n", "y"), null);
  if (WIN) return t.skip("Windows: tar.xz-Probe nur unter Linux/macOS");
  const v = "v1.2.3", name = `node-${v}-linux-x64`, d = temp(), quelle = join(d, "quelle"), inhalt = join(d, "inhalt");
  mkdirSync(join(inhalt, name, "bin"), { recursive: true }); mkdirSync(join(quelle, v), { recursive: true });
  writeFileSync(join(inhalt, name, "bin", "node"), "#!/bin/sh\necho attrappe\n"); writeFileSync(join(inhalt, name, "LICENSE"), "MIT\n");
  const tar = spawnSync("tar", ["-cJf", join(quelle, v, `${name}.tar.xz`), "-C", inhalt, name]);
  if (tar.status !== 0) return t.skip("tar kann kein xz");
  const archiv = readFileSync(join(quelle, v, `${name}.tar.xz`));
  let summe = sha256(archiv);
  const server = createServer((req, res) => { const p = join(quelle, req.url.replace(/^\//, "")); if (req.url.endsWith("SHASUMS256.txt")) { res.end(`${summe}  ${name}.tar.xz\n`); } else if (existsSync(p)) { res.end(readFileSync(p)); } else { res.writeHead(404); res.end(); } });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const out = await holeNode("linux-x64", { version: v, basis: join(d, "b1"), quelle: url });
    const m = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
    assert.equal(m.version, v);
    assert.equal(m.sha256, sha256(readFileSync(join(out, "node"))));
    assert.equal(m.size, statSync(join(out, "node")).size);
    assert.ok(existsSync(join(out, "LICENSE")));
    summe = "0".repeat(64);
    await assert.rejects(holeNode("linux-x64", { version: v, basis: join(d, "b2"), quelle: url }), /Prüfsumme stimmt nicht/);
    assert.equal(existsSync(join(d, "b2", "node")), false, "nichts abgelegt");
    assert.equal(existsSync(join(d, "b2", "cache", `${name}.tar.xz`)), false, "der Download ist verworfen");
  } finally { server.close(); }
});

// ───────────── Laufzeit im Support-Ordner ─────────────
function nodeQuelle(dir, { version = "v24.0.0", inhalt = "#!/bin/sh\necho node\n", manifest = {} } = {}) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, EXE), inhalt); chmodSync(join(dir, EXE), 0o755);
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ version, sha256: sha256(inhalt), size: Buffer.byteLength(inhalt), ...manifest }));
  return dir;
}
function kernQuelle(dir, { version = "1.0.0", stempel = "a".repeat(64), brain = "// kern\n" } = {}) {
  mkdirSync(join(dir, "mcp"), { recursive: true });
  writeFileSync(join(dir, "brain.mjs"), brain); writeFileSync(join(dir, "mcp", "brain-mcp.mjs"), "// mcp\n");
  writeFileSync(join(dir, "VERSION"), `${version}\n`); writeFileSync(join(dir, ".stempel"), `${stempel}\n`);
  return dir;
}

test("Laufzeit Node: Kopie nach node/<version>/, stabiler Pfad bin/node; zweiter Start ändert nichts; neue Node-Version tauscht den stabilen Pfad aus und räumt die alte weg", () => {
  const d = temp(), support = join(d, "support");
  const a = installiereNode({ quelle: nodeQuelle(join(d, "q1")), support });
  assert.equal(a.node, join(support, "bin", EXE));
  assert.equal(a.nodeDatei, join(support, "node", "v24.0.0", EXE));
  assert.equal(readFileSync(a.node, "utf8"), "#!/bin/sh\necho node\n");
  const ino = statSync(a.node).ino;
  installiereNode({ quelle: nodeQuelle(join(d, "q2")), support }); // „anderer Einhängepunkt“, gleicher Inhalt
  assert.equal(statSync(a.node).ino, ino, "unverändert");
  const b = installiereNode({ quelle: nodeQuelle(join(d, "q3"), { version: "v24.1.0", inhalt: "#!/bin/sh\necho neu\n" }), support });
  assert.equal(b.node, a.node, "der stabile Pfad bleibt derselbe");
  assert.equal(readFileSync(b.node, "utf8"), "#!/bin/sh\necho neu\n");
  assert.deepEqual(readdirSync(join(support, "node")), ["v24.1.0"], "alte Version weg");
  assert.deepEqual(readdirSync(join(support, "bin")).filter((n) => /\.(alt|neu)-/.test(n)), [], "keine Reste");
  if (!WIN) assert.equal(execFileSync(a.node, { encoding: "utf8" }).trim(), "neu", "ausführbar");
});

test("Laufzeit Node: falsche Prüfsumme, kaputtes oder fehlendes Manifest — Fehler, nichts im Support-Ordner", () => {
  const d = temp(), support = join(d, "support");
  const q = nodeQuelle(join(d, "q"));
  writeFileSync(join(q, EXE), "manipuliert");
  assert.throws(() => installiereNode({ quelle: q, support }), /Prüfsumme/);
  assert.equal(existsSync(join(support, "bin", EXE)), false);
  writeFileSync(join(q, "manifest.json"), "{ kaputt");
  assert.throws(() => installiereNode({ quelle: q, support }), /Manifest/);
  assert.throws(() => installiereNode({ quelle: join(d, "gibt-es-nicht"), support }), /Manifest/);
  writeFileSync(join(q, "manifest.json"), JSON.stringify({ version: "../../x", sha256: "x", size: 1 }));
  assert.throws(() => installiereNode({ quelle: q, support }), /ungültig/);
});

test("Laufzeit Kern: Kopie nach kern/<version>-<stempel>/, stabiler Verweis bin/kern; neuer Inhalt schaltet um, die vorige Version bleibt, ältere gehen", (t) => {
  const d = temp(), support = join(d, "support");
  const mit = (name, o) => installiereKern({ quelle: kernQuelle(join(d, name), o), support });
  const a = mit("q1", { stempel: "1".repeat(64) });
  assert.equal(a.kern, join(support, "bin", "kern"));
  try { if (!lstatSync(a.kern).isSymbolicLink()) throw new Error("kein Verweis"); } catch (e) { return t.skip(`keine Verweise möglich: ${e.message}`); }
  assert.ok(existsSync(join(a.kern, "mcp", "brain-mcp.mjs")));
  const ziel1 = readlinkSync(a.kern);
  assert.equal(readlinkSync(mit("q1b", { stempel: "1".repeat(64) }).kern), ziel1, "gleicher Inhalt, gleicher Verweis (auch von anderem Einhängepunkt)");
  const b = mit("q2", { stempel: "2".repeat(64), brain: "// neu\n" });
  assert.notEqual(readlinkSync(b.kern), ziel1);
  assert.equal(readFileSync(join(b.kern, "brain.mjs"), "utf8"), "// neu\n");
  assert.equal(readdirSync(join(support, "kern")).length, 2, "vorige Version bleibt (laufende Hooks)");
  mit("q3", { stempel: "3".repeat(64) });
  assert.equal(readdirSync(join(support, "kern")).length, 2, "ältere gehen");
  assert.equal(installiereKern({ quelle: join(d, "gibt-es-nicht"), support }), null, "Paket ohne Kern: kein Fehler");
  assert.throws(() => installiereKern({ quelle: (() => { const q = kernQuelle(join(d, "q4")); rmSync(join(q, ".stempel")); return q; })(), support }), /Stempel/);
});

test("Laufzeit gesamt wie im Paket (resources/node und resources/Ressourcen/kern): stabile Pfade ändern sich nicht, wenn das Paket an einem anderen Ort liegt (AppImage)", (t) => {
  const d = temp(), support = join(d, "support");
  const paket = (ort) => { nodeQuelle(join(ort, "node")); kernQuelle(join(ort, "Ressourcen", "kern")); return ort; };
  const a = installiereLaufzeit({ ressourcen: paket(join(d, "tmp", ".mount_Kortex1abc", "resources")), support });
  const b = installiereLaufzeit({ ressourcen: paket(join(d, "tmp", ".mount_Kortex2xyz", "resources")), support });
  assert.deepEqual([b.node, b.kern, b.nodeDatei], [a.node, a.kern, a.nodeDatei]);
  for (const p of [a.node, a.kern, a.nodeDatei]) assert.equal(p.includes(".mount_"), false, "kein Pfad zeigt ins Paket");
  assert.equal(realpathSync(join(a.kern, "brain.mjs")).includes(".mount_"), false);
  assert.ok(support);
  void t;
});

test("setzeDateiLink: ersetzt einen vorhandenen Eintrag atomar und räumt keine fremden Dateien", () => {
  const d = temp();
  writeFileSync(join(d, "a"), "A"); writeFileSync(join(d, "b"), "B"); writeFileSync(join(d, "fremd.alt-nein"), "x");
  assert.equal(setzeDateiLink(join(d, "stabil"), join(d, "a")), true);
  assert.equal(readFileSync(join(d, "stabil"), "utf8"), "A");
  assert.equal(setzeDateiLink(join(d, "stabil"), join(d, "a")), false, "schon richtig");
  assert.equal(setzeDateiLink(join(d, "stabil"), join(d, "b")), true);
  assert.equal(readFileSync(join(d, "stabil"), "utf8"), "B");
  assert.equal(readFileSync(join(d, "a"), "utf8"), "A", "die Versionskopie bleibt");
  assert.ok(existsSync(join(d, "fremd.alt-nein")));
});

// ───────────── Updater ─────────────
class Attrappe {
  constructor(o = {}) { this.o = o; this.aufrufe = []; }
  async checkForUpdates() { this.aufrufe.push("check"); if (this.o.checkFehler) throw new Error(this.o.checkFehler); return this.o.version ? { isUpdateAvailable: true, updateInfo: { version: this.o.version } } : { isUpdateAvailable: false, updateInfo: { version: "0.0.1" } }; }
  async downloadUpdate() { this.aufrufe.push("download"); if (this.o.ladeFehler) throw new Error(this.o.ladeFehler); return ["datei"]; }
}
const baueUpdater = (ua, { antworten = [], aktiv = { moeglich: true, grund: null }, version = "0.3.0" } = {}) => {
  const meldungen = [], protokoll = [];
  let neustarts = 0;
  const u = erzeugeUpdater({ autoUpdater: ua, version, aktiv, protokoll: (z) => protokoll.push(z), neustart: async () => { neustarts++; },
    meldung: async (m) => { meldungen.push(m); return antworten.length ? antworten.shift() : (m.knoepfe ? m.knoepfe.length - 1 : 0); } });
  return { u, meldungen, protokoll, neustarts: () => neustarts };
};

test("Updater: kein Update → manuell „aktuell“, still schweigt", async () => {
  const ua = new Attrappe();
  const m = baueUpdater(ua);
  assert.deepEqual(await m.u.pruefe({ manuell: false }), { ok: true, neu: false });
  assert.deepEqual(m.meldungen, []);
  await m.u.pruefe({ manuell: true });
  assert.deepEqual(m.meldungen.map((x) => x.titel), ["Kortex ist aktuell"]);
  assert.deepEqual(ua.aufrufe, ["check", "check"]);
});

test("Updater: Update gefunden → fragen, laden, fragen, neu starten; „Später“ merkt sich das Geladene", async () => {
  const ua = new Attrappe({ version: "0.4.0" });
  const m = baueUpdater(ua, { antworten: [0, 1, 0] });
  const r1 = await m.u.pruefe({ manuell: false });
  assert.deepEqual(r1, { ok: true, neu: true, geladen: true, neustart: false });
  assert.deepEqual(m.meldungen.map((x) => x.titel), ["Neue Version verfügbar", "Update bereit"]);
  assert.match(m.meldungen[0].text, /0\.4\.0.*0\.3\.0/);
  assert.equal(m.neustarts(), 0);
  assert.equal(m.u.geladen(), "0.4.0");
  const r2 = await m.u.pruefe({ manuell: true });
  assert.deepEqual(r2, { ok: true, neu: true, geladen: true, neustart: true });
  assert.deepEqual(ua.aufrufe, ["check", "download"], "kein zweiter Abruf, kein zweiter Download");
  assert.equal(m.neustarts(), 1);
});

test("Updater: „Später“ bei der ersten Frage lädt nichts; Fehler beim Laden oder Suchen bleibt still (automatisch) oder wird gesagt (manuell); gleichzeitige Läufe werden abgewiesen", async () => {
  const ua = new Attrappe({ version: "0.4.0" });
  const m = baueUpdater(ua, { antworten: [1] });
  assert.deepEqual(await m.u.pruefe({}), { ok: true, neu: true, geladen: false });
  assert.deepEqual(ua.aufrufe, ["check"]);
  const f = baueUpdater(new Attrappe({ version: "0.4.0", ladeFehler: "sha512 checksum mismatch" }), { antworten: [0] });
  assert.equal((await f.u.pruefe({ manuell: false })).grund, "fehler");
  assert.deepEqual(f.meldungen.map((x) => x.titel), ["Neue Version verfügbar"], "automatisch: keine Fehlermeldung");
  assert.ok(f.protokoll.some((z) => /sha512/.test(z)));
  const g = baueUpdater(new Attrappe({ checkFehler: "net::ERR_INTERNET_DISCONNECTED" }));
  assert.equal((await g.u.pruefe({ manuell: true })).grund, "fehler");
  assert.match(g.meldungen[0].text, /fehlgeschlagen.*ERR_INTERNET/);
  let weiter; const langsam = { checkForUpdates: () => new Promise((ok) => { weiter = () => ok({ isUpdateAvailable: false }); }) };
  const h = baueUpdater(langsam);
  const erster = h.u.pruefe({});
  assert.deepEqual(await h.u.pruefe({}), { ok: false, grund: "laeuft" });
  weiter(); await erster;
});

test("Updater: in der Entwicklung und in der Vorschau aus (Menü sagt warum), Einstellungen ohne Download-Automatik, Kanal nach der Version", async () => {
  assert.deepEqual(updatesMoeglich({ gepackt: true }), { moeglich: true, grund: null });
  assert.equal(updatesMoeglich({ gepackt: false }).moeglich, false);
  assert.equal(updatesMoeglich({ gepackt: true, vorschau: true }).moeglich, false);
  assert.equal(updatesMoeglich({ gepackt: false, testFeed: true }).moeglich, true);
  const ua = new Attrappe({ version: "9.9.9" });
  const aus = baueUpdater(ua, { aktiv: updatesMoeglich({ gepackt: false }) });
  assert.deepEqual(await aus.u.pruefe({ manuell: true }), { ok: false, grund: "aus" });
  assert.equal(aus.meldungen[0].text, "In der Entwicklung gibt es keine Updates.");
  assert.deepEqual(ua.aufrufe, [], "nie ein Abruf");
  const stop = aus.u.starteAutomatisch({ verzoegerungMs: 1 });
  await new Promise((ok) => setTimeout(ok, 20)); stop();
  assert.deepEqual(ua.aufrufe, [], "auch die stille Prüfung ruft nichts ab");
  const beta = konfiguriere({}, { version: "0.3.0-beta.2" }), stabil = konfiguriere({}, { version: "0.3.0" });
  assert.deepEqual([beta.autoDownload, beta.autoInstallOnAppQuit, beta.allowDowngrade, beta.allowPrerelease], [false, false, false, true]);
  assert.deepEqual([stabil.autoDownload, stabil.autoInstallOnAppQuit, stabil.allowDowngrade, stabil.allowPrerelease], [false, false, false, false]);
  const proto = []; konfiguriere(stabil, { version: "0.3.0", protokoll: (z) => proto.push(z) }); stabil.logger.error("x"); stabil.logger.info("nicht");
  assert.deepEqual(proto, ["updater fehler: x"]);
});

test("Updater: die stille Prüfung läuft nach der Verzögerung einmal und meldet nur Neues", async () => {
  const ua = new Attrappe({ version: "0.4.0" });
  const m = baueUpdater(ua, { antworten: [1] });
  const stop = m.u.starteAutomatisch({ verzoegerungMs: 5, intervallMs: 3_600_000 });
  await new Promise((ok) => setTimeout(ok, 80)); stop();
  assert.deepEqual(ua.aufrufe, ["check"]);
  assert.deepEqual(m.meldungen.map((x) => x.titel), ["Neue Version verfügbar"]);
});

// ───────────── Vorschau ─────────────
test("Vorschau-Skript: Wegwerf-Ordner, Umgebung ausdrücklich gebaut, nichts vom Aufrufer, Ordner danach weg", (t) => {
  if (WIN) return t.skip("Windows: keine Vorschau (POSIX-Pfade)");
  const d = temp(), prog = join(d, "prog.sh"), ausgabe = join(d, "env.txt");
  writeFileSync(prog, `#!/bin/sh\nenv > "${ausgabe}"\nprintf '%s\\n' "$@" > "${ausgabe}.args"\nls -a "$KORTEX_VORSCHAU" > "${ausgabe}.ordner"\n`); chmodSync(prog, 0o755);
  const r = spawnSync("bash", [join(W, "scripts/vorschau-electron.sh"), "--vault", "/x/y"], { encoding: "utf8", env: {
    PATH: process.env.PATH, HOME: "/echtes/home", TMPDIR: d, KORTEX_VORSCHAU_PROGRAMM: prog, LANG: "de_DE.UTF-8",
    CLAUDE_CONFIG_DIR: "/echt/claude", CODEX_HOME: "/echt/codex", GH_CONFIG_DIR: "/echt/gh", BRAIN_VAULT: "/echt/vault", SSH_AUTH_SOCK: "/echt/ssh", GIT_CONFIG_GLOBAL: "/echt/gitconfig", GITHUB_TOKEN: "geheim", BRAIN_MCP_NODE: "/echt/node", XDG_CONFIG_HOME: "/echt/xdg" } });
  assert.equal(r.status, 0, r.stderr);
  const env = Object.fromEntries(readFileSync(ausgabe, "utf8").split("\n").filter(Boolean).map((z) => [z.slice(0, z.indexOf("=")), z.slice(z.indexOf("=") + 1)]));
  const o = env.KORTEX_VORSCHAU;
  assert.match(o, new RegExp(`^${d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/kortex-vorschau-`));
  assert.equal(env.HOME, `${o}/home`);
  assert.equal(env.BRAIN_APP_SUPPORT, `${o}/support`);
  assert.equal(env.CODEX_HOME, `${o}/home/.codex`);
  assert.equal(env.GIT_CONFIG_GLOBAL, `${o}/home/.gitconfig`);
  assert.equal(env.XDG_CONFIG_HOME, `${o}/home/.config`);
  assert.equal(env.GIT_CONFIG_NOSYSTEM, "1");
  assert.equal(env.LANG, "de_DE.UTF-8");
  for (const k of ["CLAUDE_CONFIG_DIR", "GH_CONFIG_DIR", "BRAIN_VAULT", "SSH_AUTH_SOCK", "GITHUB_TOKEN", "BRAIN_MCP_NODE"]) assert.equal(k in env, false, k);
  assert.equal(env.PATH.startsWith(`${o}/bin:`), true);
  assert.equal(env.PATH.includes(dirnameVon(process.execPath)) && !/^\/(usr\/)?bin$/.test(dirnameVon(process.execPath)), false, "der PATH des Aufrufers geht nicht durch");
  assert.deepEqual(readFileSync(`${ausgabe}.args`, "utf8").trim().split("\n"), ["--vorschau", o, "--vault", "/x/y"]);
  assert.ok(readFileSync(`${ausgabe}.ordner`, "utf8").includes(".kortex-vorschau"), "Marke im Ordner");
  assert.equal(existsSync(o), false, "der Ordner ist nach dem Ende weg");
  assert.deepEqual(readdirSync(d).filter((n) => n.startsWith("kortex-vorschau-")), []);
});
const dirnameVon = (p) => p.slice(0, p.lastIndexOf("/")) || "/";
