// Statuszeile: Kontingent-Kette und Hook-Installer (kern/adapters/claude-code/install.mjs). Ist die Kette eingetragen, trägt der Installer seine Kortex-Statuszeile als FRÜHERE
// Statuszeile IN die Kette ein (kette/<konto>.json|.sh), aktualisiert sie dort und nimmt sie beim Entfernen der Hooks (oder mit brain-mods) wieder heraus — nie doppelt, nie neben der
// Kette; eine fremde frühere Statuszeile bleibt unberührt. Die Kette baut die echte Werkstatt (erzeugeKontingent). Nur Wegwerf-Orte: HOME, Support und Claude-Profile sind Temp-Ordner;
// der Installer läuft als Kindprozess mit ausdrücklich gebauter Umgebung (nie die des Entwicklers).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmp, pfad } from "./hilfe.mjs";

for (const k of ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "CURSOR_CONFIG_DIR", "GEMINI_CLI_HOME", "XDG_CONFIG_HOME", "GIT_CONFIG_GLOBAL"]) delete process.env[k];
process.env.HOME = tmp("brain-home-");

const { erzeugeKontingent } = await import(pfad("werkstatt", "kontingent.mjs"));
const { hookBefehl, hookNameAusBefehl } = await import(pfad("kern", "pfade.mjs"));
const INSTALL = pfad("kern", "adapters", "claude-code", "install.mjs");
const ID = "k_aaaa0001";
const FREMD = "/usr/local/bin/meine-statuszeile --kurz";
const POSIX = process.platform !== "win32";

function aufbau({ settings = null } = {}) {
  const support = tmp("brain-support-"), home = tmp("brain-home-"), vault = tmp("brain-vault-");
  writeFileSync(join(vault, "brain.config.json"), "{}\n");
  const profil = join(support, "ki-konten-ordner", "claude-kunde"); // ein von Kortex angelegtes Konto: ein Klick genügt für die Kette
  mkdirSync(profil, { recursive: true });
  if (settings) writeFileSync(join(profil, "settings.json"), typeof settings === "string" ? settings : JSON.stringify(settings, null, 2) + "\n");
  const daten = { konten: { [ID]: { programm: "claude", ordner: profil, standard: false, name: "Kunde" } } };
  const kt = erzeugeKontingent({ support, konten: { lade: () => daten }, nodePfad: process.execPath, home: () => home });
  const starter = join(support, "bin", "kortex");
  const env = { PATH: "/usr/bin:/bin", HOME: home, BRAIN_APP_SUPPORT: support, BRAIN_TESTMODUS: "1", KORTEX_KERN_UNSTABIL_ERLAUBT: "1", KORTEX_VAULT_VERTRAUT: "alle", KORTEX_STARTER_PFAD: starter };
  const installer = (...args) => {
    const r = spawnSync(process.execPath, [INSTALL, vault, "--claude-home", profil, ...args], { encoding: "utf8", env, timeout: 60_000 });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    return r.stdout;
  };
  const entferner = () => { const r = spawnSync(process.execPath, [INSTALL, "--entfernen", "--claude-home", profil], { encoding: "utf8", env, timeout: 60_000 }); assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`); return r.stdout; };
  const stand = () => JSON.parse(spawnSync(process.execPath, [INSTALL, "--stand", "--claude-home", profil], { encoding: "utf8", env, timeout: 60_000 }).stdout);
  const datei = join(profil, "settings.json");
  const s = () => JSON.parse(readFileSync(datei, "utf8"));
  const kette = join(support, "kontingent", "kette");
  return { support, profil, starter, kt, installer, entferner, stand, datei, s, kette, schalte: (an) => kt.schalteStatuszeile({ konto: ID, an, einwilligung: true }) };
}
const eigene = (befehl) => hookNameAusBefehl(befehl) === "statusline";
const kopieStatuszeile = (a) => JSON.parse(readFileSync(join(a.kette, `${ID}.json`), "utf8"));

test("Kette ohne frühere Statuszeile: der Installer trägt seine Kortex-Statuszeile IN die Kette ein; zweiter Lauf ändert nichts; nie eine zweite Statuszeile", { skip: !POSIX }, () => {
  const a = aufbau({ settings: { model: "x" } });
  assert.equal(a.schalte(true).aktion, "eingetragen");
  const ketteBefehl = a.s().statusLine.command;
  assert.ok(ketteBefehl.includes("/kontingent/bin/kortex-statuszeile.mjs"));
  assert.ok(!/else/.test(ketteBefehl), "zunächst ohne frühere Statuszeile");
  const out = a.installer();
  assert.match(out, /\+ Statusline \(in der Kette\)/);
  assert.doesNotMatch(out, /Statusline vorhanden, nicht geändert/);
  const sl = a.s().statusLine;
  assert.ok(sl.command.includes("/kontingent/bin/kortex-statuszeile.mjs"), "die Kette bleibt die Statuszeile von Claude Code");
  assert.match(sl.command, /; else \/bin\/sh '.*kette\/k_aaaa0001\.sh'; fi$/);
  const hook = hookBefehl(a.starter, "statusline", " --konto " + ID);
  assert.ok(eigene(kopieStatuszeile(a).command) && kopieStatuszeile(a).command.startsWith("[ -x"), kopieStatuszeile(a).command);
  assert.equal(readFileSync(join(a.kette, `${ID}.sh`), "utf8"), `${kopieStatuszeile(a).command}\n`);
  assert.ok(hook.length > 0);
  assert.equal(a.stand().statuszeile, "brain");
  // und sie läuft wirklich: die Kette reicht die Ausgabe der Kortex-Statuszeile (hier eine Attrappe als Starter) unverändert durch
  mkdirSync(join(a.support, "bin"), { recursive: true });
  writeFileSync(a.starter, "#!/bin/sh\ncat >/dev/null\nprintf 'KORTEX-ZEILE %s' \"$*\"\n", { mode: 0o755 });
  const lauf = spawnSync("/bin/sh", ["-c", sl.command], { input: JSON.stringify({ rate_limits: { five_hour: { used_percentage: 42, resets_at: 1893456000 } } }), env: { PATH: "/usr/bin:/bin", HOME: tmp("brain-h2-") }, encoding: "utf8", timeout: 20_000 });
  assert.equal(lauf.stdout, "KORTEX-ZEILE hook statusline", lauf.stderr);
  assert.ok(existsSync(join(a.support, "kontingent", `${ID}.json`)), "und das Kontingent wurde dabei gemerkt");
  // nie doppelt: außer der Kette gibt es keine zweite Statuszeile, und der Befehl der Kette enthält den Aufruf nicht selbst
  assert.equal(hookNameAusBefehl(sl.command), null);
  // idempotent
  const vorher = readFileSync(a.datei, "utf8"), kvorher = readFileSync(join(a.kette, `${ID}.json`), "utf8");
  assert.match(a.installer(), /unverändert/);
  assert.equal(readFileSync(a.datei, "utf8"), vorher);
  assert.equal(readFileSync(join(a.kette, `${ID}.json`), "utf8"), kvorher);
});

test("Kette mit eigener Statuszeile aus einem früheren Lauf: der Installer aktualisiert sie IN der Kette (neuer Befehl), settings.json bleibt bei der Kette", { skip: !POSIX }, () => {
  const alt = hookBefehl("/alter/ort/bin/kortex", "statusline");
  const a = aufbau({ settings: { statusLine: { type: "command", command: alt } } });
  assert.equal(a.schalte(true).kette, true, "die Kette übernimmt die eigene Statuszeile als frühere");
  assert.equal(kopieStatuszeile(a).command, alt);
  const out = a.installer();
  assert.match(out, /~ Statusline aktualisiert \(in der Kette\)/);
  const neu = kopieStatuszeile(a).command;
  assert.notEqual(neu, alt);
  assert.ok(eigene(neu) && neu.includes(a.starter), neu);
  assert.equal(readFileSync(join(a.kette, `${ID}.sh`), "utf8"), `${neu}\n`);
  assert.ok(a.s().statusLine.command.includes("/kontingent/bin/kortex-statuszeile.mjs"));
  assert.match(a.installer(), /unverändert/);
});

test("Fremde frühere Statuszeile in der Kette: bleibt unangetastet („nicht geändert“), nichts wird eingetragen", { skip: !POSIX }, () => {
  const a = aufbau({ settings: { statusLine: { type: "command", command: FREMD } } });
  a.schalte(true);
  const vorher = JSON.stringify(a.s().statusLine), kvorher = readFileSync(join(a.kette, `${ID}.json`), "utf8"), svorher = readFileSync(join(a.kette, `${ID}.sh`), "utf8");
  const out = a.installer();
  assert.match(out, /Statusline vorhanden, nicht geändert/);
  assert.equal(JSON.stringify(a.s().statusLine), vorher, "die Statuszeile (Kette) ist unverändert; nur die Hooks kommen dazu");
  assert.equal(readFileSync(join(a.kette, `${ID}.json`), "utf8"), kvorher);
  assert.equal(readFileSync(join(a.kette, `${ID}.sh`), "utf8"), svorher);
  assert.equal(a.stand().statuszeile, "fremd");
});

test("Entfernen der Hooks nimmt die Statuszeile aus der Kette wieder heraus (Kette bleibt, Kette-Dateien weg); ein Fremdes bleibt; die Kette zurückzunehmen stellt danach das Ursprüngliche her", { skip: !POSIX }, () => {
  const a = aufbau({ settings: { model: "x" } });
  const roh = readFileSync(a.datei, "utf8");
  a.schalte(true);
  a.installer();
  assert.ok(existsSync(join(a.kette, `${ID}.json`)));
  const out = a.entferner();
  assert.match(out, /- Statuszeile aus der Kette entfernt/);
  const sl = a.s().statusLine;
  assert.ok(sl.command.includes("/kontingent/bin/kortex-statuszeile.mjs"), "die Kette selbst bleibt");
  assert.doesNotMatch(sl.command, /else/);
  assert.equal(existsSync(join(a.kette, `${ID}.json`)), false);
  assert.equal(existsSync(join(a.kette, `${ID}.sh`)), false);
  assert.equal(a.stand().statuszeile, null);
  // und die Kette lässt sich danach sauber ausschalten
  assert.equal(a.schalte(false).aktion, "entfernt");
  assert.equal(JSON.stringify(a.s().statusLine), undefined);
  assert.equal(a.s().model, "x");
  assert.ok(roh.length > 0);
  // Entfernen mit fremder früherer Statuszeile: sie bleibt
  const b = aufbau({ settings: { statusLine: { type: "command", command: FREMD } } });
  b.schalte(true);
  const vorher = readFileSync(b.datei, "utf8");
  b.entferner();
  assert.equal(readFileSync(b.datei, "utf8"), vorher);
  assert.equal(kopieStatuszeile(b).command, FREMD);
});

test("Plugin brain-mods aktiv: die eigene Statuszeile in der Kette wird entfernt (sonst doppelt) und nicht neu angelegt; die Kette bleibt", { skip: !POSIX }, () => {
  const a = aufbau({ settings: { model: "x" } });
  a.schalte(true);
  a.installer();
  assert.ok(existsSync(join(a.kette, `${ID}.json`)));
  const doc = a.s(); doc.enabledPlugins = { "brain-mods@brain-mods": true };
  writeFileSync(a.datei, JSON.stringify(doc, null, 2) + "\n");
  const out = a.installer();
  assert.match(out, /- Statusline aus der Kette entfernt \(das Band von brain-mods zeigt den Stand\)/);
  assert.equal(existsSync(join(a.kette, `${ID}.json`)), false);
  assert.ok(a.s().statusLine.command.includes("/kontingent/bin/kortex-statuszeile.mjs"));
  assert.doesNotMatch(a.s().statusLine.command, /else/);
  assert.match(a.installer(), /unverändert/);
  assert.equal(existsSync(join(a.kette, `${ID}.json`)), false, "nicht neu angelegt");
  // brain-mods wieder aus: sie kommt zurück
  const d2 = a.s(); d2.enabledPlugins = {};
  writeFileSync(a.datei, JSON.stringify(d2, null, 2) + "\n");
  assert.match(a.installer(), /\+ Statusline \(in der Kette\)/);
  assert.ok(existsSync(join(a.kette, `${ID}.json`)));
});

test("--ohne-statusline und --vorschau fassen die Kette nicht an (Vorschau schreibt nichts und nennt die Statuszeile in der Kette)", { skip: !POSIX }, () => {
  const a = aufbau({ settings: { model: "x" } });
  a.schalte(true);
  const vorher = JSON.stringify(a.s().statusLine);
  a.installer("--ohne-statusline");
  assert.equal(JSON.stringify(a.s().statusLine), vorher);
  assert.equal(existsSync(join(a.kette, `${ID}.json`)), false);
  const gesamt = readFileSync(a.datei, "utf8");
  const v = JSON.parse(a.installer("--vorschau").trim().split("\n").pop());
  assert.equal(v.vorschau, true);
  assert.equal(v.statuszeile, "neu", "so stünde sie nach dem Lauf in der Kette");
  assert.equal(readFileSync(a.datei, "utf8"), gesamt, "Vorschau schreibt nichts");
  assert.equal(existsSync(join(a.kette, `${ID}.json`)), false);
});

test("Unbekannte oder unlesbare Kette: nichts wird angefasst", { skip: !POSIX }, () => {
  const a = aufbau({ settings: { model: "x" } });
  a.schalte(true);
  a.installer();
  writeFileSync(join(a.kette, `${ID}.json`), "{kaputt");
  const vorher = JSON.stringify(a.s().statusLine);
  assert.match(a.installer(), /Statusline vorhanden, nicht geändert/);
  assert.equal(JSON.stringify(a.s().statusLine), vorher);
  assert.equal(readdirSync(a.kette).sort().join(","), `${ID}.json,${ID}.sh`);
  // eine Statuszeile mit der Marke in anderer Form: ebenfalls nicht
  const b = aufbau({ settings: { statusLine: { type: "command", command: "node /x/kontingent/bin/kortex-statuszeile.mjs" } } });
  const v = JSON.stringify(b.s().statusLine);
  assert.match(b.installer(), /Statusline vorhanden, nicht geändert/);
  assert.equal(JSON.stringify(b.s().statusLine), v);
});

test("Nach --entfernen kommt die Kortex-Statuszeile beim Ausschalten des Kontingents nicht aus der Sicherung zurück", { skip: !POSIX }, () => {
  const alt = hookBefehl("/alter/ort/bin/kortex", "statusline");
  const a = aufbau({ settings: { model: "x", statusLine: { type: "command", command: alt } } });
  assert.equal(a.schalte(true).kette, true, "die Kette übernimmt die Kortex-Statuszeile als frühere");
  a.entferner();
  assert.equal(existsSync(join(a.kette, `${ID}.json`)), false);
  a.schalte(false);
  assert.equal(a.s().statusLine, undefined, "die entfernte Statuszeile bleibt entfernt");
  assert.equal(a.s().model, "x");
});

test("Kette in fremder Form (anderer else-Zweig): nichts wird angefasst, kein zweiter else-Zweig", { skip: !POSIX }, () => {
  const a = aufbau({ settings: { model: "x" } });
  a.schalte(true);
  const doc = a.s();
  doc.statusLine.command = doc.statusLine.command.replace(/; fi$/, "; else echo hallo; fi");
  writeFileSync(a.datei, JSON.stringify(doc, null, 2) + "\n");
  const vorher = a.s().statusLine.command;
  assert.match(a.installer(), /Statusline vorhanden, nicht geändert/);
  assert.equal(a.s().statusLine.command, vorher);
});
