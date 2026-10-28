// .tools/tests/test-temp-aufraeumen.mjs — Test-Hygiene: Die Unit-Tests dürfen keine Temp-Reste hinterlassen.
// Der EINE Mechanismus ist setup.mjs (node --test --import …): jeder Ordner, den ein Test per mkdtemp unter dem Temp-Ordner
// anlegt, wird beim Prozessende gelöscht (auch bei Signal, process.exit und ungefangenem Fehler). Dazu setzt das Setup
// QMD_BIN auf den Fake — kein echtes qmd, also kein Embedding-Modell-Download (333 MB je Lauf) in einem Test-HOME.
// Geprüft wird an echten Kindprozessen mit eigenem TMPDIR (nichts im echten Temp-Ordner, Zählung eindeutig).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const HIER = dirname(fileURLToPath(import.meta.url));
const KIT = join(HIER, "..");
const SETUP = join(HIER, "setup.mjs");
const SETUP_URL = pathToFileURL(SETUP).href;
const KEIN_WINDOWS = { skip: process.platform === "win32" ? "Signale gibt es unter Windows nicht" : false };

const WURZEL = mkdtempSync(join(tmpdir(), "tempsetup-"));   // TMPDIR der Kindprozesse
const ANDERE = mkdtempSync(join(tmpdir(), "tempandere-"));  // liegt NICHT unter WURZEL
after(() => { for (const d of [WURZEL, ANDERE]) rmSync(d, { recursive: true, force: true }); });

const kindEnv = (extra = {}) => {
  const e = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(NODE_TEST_CONTEXT|NODE_OPTIONS|QMD_BIN|BRAIN_TEST_TEMP_BEHALTEN)$/.test(k)));
  return { ...e, TMPDIR: WURZEL, TEMP: WURZEL, TMP: WURZEL, ...extra };
};
const leer = () => { for (const n of readdirSync(WURZEL)) rmSync(join(WURZEL, n), { recursive: true, force: true }); };
const knoten = (code, { mitSetup = true, env = {} } = {}) => spawnSync(process.execPath,
  [...(mitSetup ? ["--import", SETUP_URL] : []), "--input-type=module", "-e", code], { env: kindEnv(env), encoding: "utf8", timeout: 30000 });

test("setup.mjs: mkdtempSync, mkdtemp (Callback, mit/ohne Optionen) und fs.promises.mkdtemp — auch als Named-Import — werden beim Prozessende gelöscht", () => {
  leer();
  const vorhanden = join(WURZEL, "schon-da");
  mkdirSync(vorhanden);
  const r = knoten(`
    import fs, { mkdtempSync } from "node:fs";
    import fsp, { mkdtemp as pm } from "node:fs/promises";
    import { tmpdir } from "node:os"; import { join } from "node:path";
    const t = tmpdir(); const d = [];
    d.push(mkdtempSync(join(t, "a-")));
    d.push(fs.mkdtempSync(join(t, "b-")));
    d.push(await new Promise((ok, no) => fs.mkdtemp(join(t, "c-"), (e, p) => e ? no(e) : ok(p))));
    d.push(await new Promise((ok, no) => fs.mkdtemp(join(t, "f-"), "utf8", (e, p) => e ? no(e) : ok(p))));
    d.push(await fsp.mkdtemp(join(t, "d-")));
    d.push(await pm(join(t, "e-")));
    for (const p of d) fs.writeFileSync(join(p, "datei.txt"), "x");
    console.log(JSON.stringify({ d, da: d.every((p) => fs.existsSync(p)) }));
  `);
  assert.equal(r.status, 0, r.stderr);
  const { d, da } = JSON.parse(r.stdout.trim());
  assert.equal(d.length, 6);
  assert.ok(da, "im Lauf müssen die Ordner da sein");
  for (const p of d) assert.ok(!existsSync(p), `nach Prozessende weg: ${p}`);
  assert.deepEqual(readdirSync(WURZEL), ["schon-da"], "nur Ordner des Prozesses werden gelöscht, nie Fremdes im Temp-Ordner");
  rmSync(vorhanden, { recursive: true });
});

test("Kontrolle: ohne --import bleibt der Ordner liegen (der Test misst also wirklich das Setup)", () => {
  leer();
  const r = knoten(`import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
    console.log(mkdtempSync(join(tmpdir(), "ohne-")));`, { mitSetup: false });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(r.stdout.trim()));
  leer();
});

test("setup.mjs: nur unter dem Temp-Ordner — mkdtemp anderswo bleibt unberührt", () => {
  leer();
  const r = knoten(`import { mkdtempSync } from "node:fs"; import { join } from "node:path";
    console.log(mkdtempSync(join(${JSON.stringify(ANDERE)}, "aussen-")));`);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(r.stdout.trim()), "außerhalb des Temp-Ordners wird nichts gelöscht");
});

test("setup.mjs: Prozessende per process.exit und per ungefangenem Fehler räumt auf, der Exit-Code bleibt", () => {
  leer();
  const code = (ende) => `import { mkdtempSync, writeFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
    const p = mkdtempSync(join(tmpdir(), "ende-")); writeFileSync(join(p, "x"), "1"); console.log(p); ${ende}`;
  const a = knoten(code("process.exit(3);"));
  assert.equal(a.status, 3);
  assert.ok(!existsSync(a.stdout.trim()));
  const b = knoten(code('throw new Error("kaputt");'));
  assert.equal(b.status, 1);
  assert.ok(!existsSync(b.stdout.trim()));
  assert.deepEqual(readdirSync(WURZEL), []);
});

test("setup.mjs: SIGTERM (Zeitüberschreitung, Abbruch) räumt auf und beendet den Prozess weiterhin per Signal", KEIN_WINDOWS, async () => {
  leer();
  const kind = spawn(process.execPath, ["--import", SETUP_URL, "--input-type=module", "-e", `
    import { mkdtempSync, writeFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
    const p = mkdtempSync(join(tmpdir(), "sig-")); writeFileSync(join(p, "x"), "1"); console.log("bereit " + p); setInterval(() => {}, 1000);
  `], { env: kindEnv(), stdio: ["ignore", "pipe", "pipe"] });
  let aus = "";
  const pfad = await new Promise((ok, no) => {
    const t = setTimeout(() => { kind.kill("SIGKILL"); no(new Error("Kind meldet sich nicht")); }, 20000);
    kind.stdout.on("data", (b) => { aus += b; const m = aus.match(/bereit (.+)\n/); if (m) { clearTimeout(t); ok(m[1]); } });
  });
  assert.ok(existsSync(pfad));
  const ende = new Promise((ok) => kind.on("close", (code, signal) => ok({ code, signal })));
  kind.kill("SIGTERM");
  const { signal } = await ende;
  assert.equal(signal, "SIGTERM", "stirbt wie ohne Setup am Signal");
  assert.ok(!existsSync(pfad), "Ordner nach SIGTERM weg");
});

test("setup.mjs: BRAIN_TEST_TEMP_BEHALTEN=1 lässt die Ordner zur Fehlersuche liegen", () => {
  leer();
  const r = knoten(`import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
    console.log(mkdtempSync(join(tmpdir(), "behalten-")));`, { env: { BRAIN_TEST_TEMP_BEHALTEN: "1" } });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(r.stdout.trim()));
  leer();
});

test("node --test reicht --import an die Datei-Prozesse weiter: ein Test, der mkdtemp nutzt, hinterlässt nichts", () => {
  leer();
  const datei = join(ANDERE, "klein.test.mjs");
  writeFileSync(datei, `import { test } from "node:test"; import { mkdtempSync, writeFileSync } from "node:fs"; import { mkdtemp } from "node:fs/promises";
    import { tmpdir } from "node:os"; import { join } from "node:path";
    test("legt Ordner an", async () => { for (const n of ["x-", "y-"]) writeFileSync(join(mkdtempSync(join(tmpdir(), n)), "f"), "1"); await mkdtemp(join(tmpdir(), "z-")); });
    test("zweiter Test im selben Prozess", () => { mkdtempSync(join(tmpdir(), "w-")); });\n`);
  const r = spawnSync(process.execPath, ["--test", "--import", SETUP_URL, datei], { env: kindEnv(), encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(readdirSync(WURZEL), [], "node --test hat die Option nicht weitergegeben oder das Setup hat nicht aufgeräumt");
  // Gegenprobe: ohne --import bleiben die vier Ordner liegen
  const o = spawnSync(process.execPath, ["--test", datei], { env: kindEnv(), encoding: "utf8", timeout: 60000 });
  assert.equal(o.status, 0, o.stdout + o.stderr);
  assert.equal(readdirSync(WURZEL).length, 4);
  leer();
});

test("setup.mjs: QMD_BIN zeigt standardmäßig auf den Fake (kein echtes qmd, kein Modell-Download), ein gesetzter Wert bleibt", () => {
  const r = knoten(`console.log(process.env.QMD_BIN ?? "");`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), join(HIER, "fake-qmd-cli.mjs"));
  assert.ok(existsSync(r.stdout.trim()));
  const e = knoten(`console.log(process.env.QMD_BIN ?? "");`, { env: { QMD_BIN: "/eigener/qmd" } });
  assert.equal(e.stdout.trim(), "/eigener/qmd");
});

test("setup.mjs: mit dem Fake-QMD indexiert search-refresh.mjs ohne Netz und ohne Modell — Stempel gesetzt, kein .cache/qmd im HOME", () => {
  const home = join(ANDERE, "home"), vault = join(ANDERE, "vault-sr");
  mkdirSync(home, { recursive: true }); mkdirSync(join(vault, "20_firma"), { recursive: true });
  writeFileSync(join(vault, "20_firma", "a.md"), "# a\n");
  const r = spawnSync(process.execPath, ["--import", SETUP_URL, join(KIT, "search-refresh.mjs"), vault],
    { env: kindEnv({ HOME: home, USERPROFILE: home, BRAIN_VAULT: vault }), encoding: "utf8", timeout: 30000 });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(vault, ".logs", "search-refreshed")), "Lauf muss mit dem Fake durchgehen");
  assert.ok(!existsSync(join(home, ".cache")), "kein Modell-Cache im Test-HOME");
});

test("Aufrufstellen: Unit-Suite läuft überall mit setup.mjs (unit.sh, run-all.sh, pre-commit-Prüfung, Hook-Laufzeit-Test)", () => {
  const lies = (...p) => readFileSync(join(...p), "utf8").split("\n").filter((z) => !/^\s*(#|\/\/)/.test(z)).map((z) => z.replace(/\s#\s.*$/, "")).join("\n");   // ohne Kommentare
  const unit = lies(HIER, "unit.sh");
  assert.match(unit, /--import/);
  assert.match(unit, /setup\.mjs/);
  assert.match(unit, /node --test|--test/);
  assert.match(lies(HIER, "run-all.sh"), /unit\.sh/, "run-all.sh ruft die Unit-Suite über unit.sh");
  assert.doesNotMatch(lies(HIER, "run-all.sh"), /^node --test/m, "kein nackter node --test mehr in run-all.sh");
  assert.match(lies(HIER, "test-hook-laufzeit.sh"), /unit\.sh/);
  assert.doesNotMatch(lies(HIER, "test-hook-laufzeit.sh"), /node --test/);
  const pruefung = lies(KIT, "commit-pruefung.mjs");
  assert.match(pruefung, /"--import"/);
  assert.match(pruefung, /setup\.mjs/);
});

test("verlauf-fixture: hook() startet Hooks nie mit dem echten qmd — auch ein nackter node --test (ohne Setup) lädt kein Modell nach", () => {
  const quelle = readFileSync(join(HIER, "verlauf-fixture.mjs"), "utf8");
  assert.match(quelle, /QMD_BIN: process\.env\.QMD_BIN \|\| join\(KIT, "tests", "fake-qmd-cli\.mjs"\)/);
  assert.ok(existsSync(join(HIER, "fake-qmd-cli.mjs")));
});
