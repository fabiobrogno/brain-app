// .tools/tests/setup.mjs — Test-Hygiene für ALLE Node-Tests: node --test --import <diese Datei> test-*.mjs
// (bash .tools/tests/unit.sh macht das; auch run-all.sh, die Commit-Prüfung und der Hook-Laufzeit-Test gehen darüber).
// KEIN Test (Name beginnt nicht mit test-). Läuft in jedem Test-Prozess, bevor die Testdatei geladen wird.
//
// 1) Aufräumen: Jeder Ordner, den ein Test per fs.mkdtempSync / fs.mkdtemp / fs.promises.mkdtemp (auch als Named-Import:
//    syncBuiltinESMExports) UNTER dem Temp-Ordner anlegt, wird beim Prozessende gelöscht — auch bei process.exit, ungefangenem
//    Fehler und SIGINT/SIGTERM/SIGHUP (Zeitüberschreitung der Commit-Prüfung, Abbruch). Gelöscht wird NUR, was dieser Prozess
//    selbst angelegt hat — nie der Temp-Ordner selbst, nie etwas außerhalb davon, nie fremde Einträge.
//    Hintergrund: ~291 000 Reste (25 GB) aus Kit-Testläufen; jeder Commit mit .tools-Änderung lässt die ganze Suite laufen.
//    Kindprozesse (Produktivcode, den Tests starten) räumen selbst auf; deren Reste zählt unit.sh/Messung getrennt.
//    BRAIN_TEST_TEMP_BEHALTEN=1: nichts löschen (Fehlersuche an einem roten Test).
//
// 2) Kein echtes qmd in Tests: QMD_BIN zeigt standardmäßig auf fake-qmd-cli.mjs. Sonst startet ein Sitzungsstart-Test über
//    session-hintergrund → search-refresh das echte `qmd embed` mit Test-HOME und lädt dort das Embedding-Modell
//    (~333 MB, Netz) in den Temp-Ordner. search-refresh.mjs liest QMD_BIN (vor der PATH-Suche); der Ablauf selbst ist durch
//    test-search-refresh*.{sh,mjs} mit demselben Fake abgedeckt. Ein von außen gesetztes QMD_BIN bleibt.
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import module from "node:module";
import { fileURLToPath } from "node:url";

if (!process.env.QMD_BIN) process.env.QMD_BIN = fileURLToPath(new URL("./fake-qmd-cli.mjs", import.meta.url));

// 3) Hook-Dubletten-Guard aus (adapters/claude-code/einmal.mjs): Die Tests rufen dieselben Hooks mit gleicher Eingabe mehrmals
//    kurz hintereinander auf (gleiche session_id/gleicher Prompt) und prüfen anderes — der Guard würde den zweiten Aufruf als
//    Dublette verschlucken. Nur test-hook-einmal.mjs schaltet ihn gezielt wieder an (BRAIN_EINMAL=an im Kind-Env).
if (!process.env.BRAIN_EINMAL) process.env.BRAIN_EINMAL = "aus";

const BEHALTEN = process.env.BRAIN_TEST_TEMP_BEHALTEN === "1";
const rmSync = fs.rmSync;            // Originale festhalten: ein Test, der fs.rmSync austauscht, darf das Aufräumen nicht stören
const realpathSync = fs.realpathSync;
const ANGELEGT = new Set();

const echt = (p) => { try { return realpathSync(p); } catch { return p; } };
const BASEN = new Set();   // Temp-Ordner wie angegeben und real aufgelöst (macOS: /var → /private/var)
const merkeBasen = () => { const b = os.tmpdir(); if (b) { BASEN.add(path.resolve(b)); BASEN.add(echt(path.resolve(b))); } };
merkeBasen();   // auch der Temp-Ordner beim Start zählt, falls ein Test TMPDIR später umbiegt

// Nur Ordner UNTER einem Temp-Ordner — nie dieser selbst, nie außerhalb.
const unterTemp = (p) => {
  merkeBasen();
  const abs = path.resolve(p);
  for (const b of BASEN) {
    const rel = path.relative(b, abs);
    if (rel && rel !== "." && !rel.startsWith("..") && !path.isAbsolute(rel)) return true;
  }
  return false;
};
const merke = (r) => {
  const p = Buffer.isBuffer(r) ? r.toString() : r;
  if (typeof p === "string" && p && unterTemp(p)) ANGELEGT.add(path.resolve(p));
  return r;
};

function aufraeumen() {
  if (BEHALTEN) return;
  for (const p of [...ANGELEGT].reverse()) {
    try { rmSync(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch {}
    ANGELEGT.delete(p);
  }
}

// ---- mkdtemp in allen Formen abfangen ----
const o = { sync: fs.mkdtempSync, cb: fs.mkdtemp, pr: fsp.mkdtemp, dSync: fs.mkdtempDisposableSync, dPr: fsp.mkdtempDisposable };
fs.mkdtempSync = function mkdtempSync(...a) { return merke(o.sync.apply(this, a)); };
fs.mkdtemp = function mkdtemp(prefix, ...rest) {
  const i = rest.length - 1;
  if (i >= 0 && typeof rest[i] === "function") { const cb = rest[i]; rest[i] = (err, dir, ...m) => { if (!err) merke(dir); return cb(err, dir, ...m); }; }
  return o.cb.call(this, prefix, ...rest);
};
fsp.mkdtemp = async function mkdtemp(...a) { return merke(await o.pr.apply(this, a)); };
// Node ≥ 24: Ordner mit Dispose — wer ihn nicht freigibt, hinterlässt ihn; also ebenfalls vormerken
if (typeof o.dSync === "function") fs.mkdtempDisposableSync = function mkdtempDisposableSync(...a) { const r = o.dSync.apply(this, a); merke(r?.path); return r; };
if (typeof o.dPr === "function") fsp.mkdtempDisposable = async function mkdtempDisposable(...a) { const r = await o.dPr.apply(this, a); merke(r?.path); return r; };
module.syncBuiltinESMExports();   // damit auch `import { mkdtempSync } from "node:fs"` den Wrapper sieht

// ---- Prozessende ----
process.on("exit", aufraeumen);
// Signale: aufräumen und dann wie ohne Setup am Signal sterben (Listener entfernen, Signal erneut senden).
// Nur, wenn niemand sonst darauf hört — sonst bliebe ein Test mit eigenem Handler stehen.
if (process.platform !== "win32") {
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    if (process.listenerCount(sig) > 0) continue;
    const handler = () => { aufraeumen(); process.removeListener(sig, handler); process.kill(process.pid, sig); };
    process.on(sig, handler);
  }
}
