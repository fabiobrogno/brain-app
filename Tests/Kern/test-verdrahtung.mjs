// Kern-Umzug P6: Hook-Befehle über den Starter (still bei fehlendem Starter), Rückweg der Installer (--entfernen/--aus), Stand (--stand).
// Nur Temp-HOME und Wegwerf-Ordner; nie ~/.claude, nie ein echter Starter.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, mkdirSync, chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { hookBefehl, hookNameAusBefehl, starterPfad, KERN } from "../pfade.mjs";

const POSIX = process.platform !== "win32";
const inst = fileURLToPath(new URL("../adapters/claude-code/install.mjs", import.meta.url));
const instGit = fileURLToPath(new URL("../install-git-hooks.mjs", import.meta.url));
const TEMP_HOME = mkdtempSync(join(tmpdir(), "verdr-home-"));
const sauber = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_") && k !== "KORTEX_STARTER_PFAD"));
const env = (extra = {}) => ({ ...sauber(), HOME: TEMP_HOME, USERPROFILE: TEMP_HOME, ...extra });
const vaultOrdner = (praefix = "verdr-v ") => { const v = mkdtempSync(join(tmpdir(), praefix)); writeFileSync(join(v, "brain.config.json"), "{}"); return v; };
const claudeHome = () => mkdtempSync(join(tmpdir(), "verdr-ch-"));
const lauf = (args, extra = {}) => spawnSync(process.execPath, args, { encoding: "utf8", env: env(extra) });
const settings = (h) => JSON.parse(readFileSync(join(h, "settings.json"), "utf8"));
const befehle = (s) => Object.values(s.hooks || {}).flat().flatMap((e) => (e.hooks || []).map((h) => h.command));
const HOOKS = ["session-start", "brain-hint", "wiki-guard", "werkzeug-protokoll", "regeln-lesen", "kompakt-sichern", "ernte-ausloeser", "sitzung-ende"];

test("hookBefehl: festes Muster, POSIX-gequotet, nur gültige Namen; hookNameAusBefehl erkennt jeden Starter-Ort", { skip: !POSIX }, () => {
  const s = "/Users/x y/Library/Application Support/Kortex/bin/kortex";
  assert.equal(hookBefehl(s, "brain-hint"), `[ -x '${s}' ] && exec '${s}' hook brain-hint || exit 0`);
  assert.equal(hookBefehl(s, "ernte-ausloeser", " --art fakt"), `[ -x '${s}' ] && exec '${s}' hook ernte-ausloeser --art fakt || exit 0`);
  assert.equal(hookNameAusBefehl(hookBefehl(s, "wiki-guard")), "wiki-guard");
  assert.equal(hookNameAusBefehl(hookBefehl("/anderer/Ort/it's/kortex", "sitzung-ende")), "sitzung-ende");
  assert.equal(hookNameAusBefehl("fremd.sh"), null);
  assert.equal(hookNameAusBefehl("/bin/sh '/k/node-start.sh' '/k/adapters/claude-code/brain-hint.mjs'"), null, "alte Form gehört nicht zur neuen Erkennung");
  for (const schlecht of ["../x", "A", "a b", "a;b", "", "a'b"]) assert.throws(() => hookBefehl(s, schlecht), /ungültiger Hook-Name/, schlecht);
});

test("Starter fehlt: JEDER eingetragene Hook-Befehl endet in einer echten /bin/sh mit Exit 0 und ohne jede Ausgabe", { skip: !POSIX }, () => {
  const h = claudeHome(), v = vaultOrdner();
  const fehlt = join(mkdtempSync(join(tmpdir(), "verdr-nix ")), "gibt es nicht", "kortex");
  const r = lauf([inst, v, "--claude-home", h], { KORTEX_STARTER_PFAD: fehlt });
  assert.equal(r.status, 0, r.stderr);
  const s = settings(h);
  const alle = [...befehle(s), s.statusLine.command];
  assert.equal(alle.length, 10, "9 Hooks und die Statuszeile");
  for (const c of alle) {
    assert.ok(c.includes(`'${fehlt}'`), c);
    const l = spawnSync("/bin/sh", ["-c", c], { encoding: "utf8", input: '{"prompt":"x"}' });
    assert.equal(l.status, 0, c);
    assert.equal(l.stdout, "", c);
    assert.equal(l.stderr, "", c);
  }
});

test("Starter da: der Befehl ruft ihn mit `hook <name>` auf; Argumente, stdin und der Exit-Code des Hooks bleiben erhalten", { skip: !POSIX }, () => {
  const h = claudeHome(), v = vaultOrdner();
  const bin = mkdtempSync(join(tmpdir(), "verdr-bin "));
  const starter = join(bin, "kortex");
  writeFileSync(starter, '#!/bin/sh\nprintf "ARGS:%s\\n" "$*"\ncat\nexit 2\n'); chmodSync(starter, 0o755);
  assert.equal(lauf([inst, v, "--claude-home", h], { KORTEX_STARTER_PFAD: starter }).status, 0);
  const c = befehle(settings(h)).find((x) => x.includes("hook ernte-ausloeser"));
  const l = spawnSync("/bin/sh", ["-c", c], { encoding: "utf8", input: "STDIN-INHALT" });
  assert.equal(l.stdout, "ARGS:hook ernte-ausloeser --art fakt\nSTDIN-INHALT");
  assert.equal(l.status, 2, "ein blockierender Hook (wiki-guard) behält seinen Exit-Code");
});

test("Installer ohne Testschalter und ohne Starter: Exit 3 mit klarer Meldung, nichts geschrieben", { skip: !POSIX }, () => {
  const h = claudeHome(), v = vaultOrdner();
  // Stabiler Kern-Pfad vorhanden (nachgebaut), aber kein Starter daneben.
  const support = mkdtempSync(join(tmpdir(), "verdr-sup "));
  mkdirSync(join(support, "bin"));
  execFileSync("ln", ["-s", KERN, join(support, "bin", "kern")]);
  const r = lauf([inst, v, "--claude-home", h], { KORTEX_KERN_UNSTABIL_ERLAUBT: "", KORTEX_KERN_TEMP_WURZELN: "", KORTEX_KERN_PFAD: join(support, "bin", "kern") });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /Kern-Pfad|Starter/);
  assert.ok(!existsSync(join(h, "settings.json")));
});

test("--stand: eine JSON-Zeile, schreibt nichts; erkennt eingetragen / veraltet / fremde Statuszeile", { skip: !POSIX }, () => {
  const h = claudeHome(), v = vaultOrdner();
  const stand = () => JSON.parse(lauf([inst, "--stand", "--claude-home", h]).stdout);
  assert.deepEqual(stand(), { hooks: { soll: 8, eingetragen: 0, neueForm: 0 }, statuszeile: null, befehle: 0, aktiv: false });
  assert.ok(!existsSync(join(h, "settings.json")), "--stand legt nichts an");
  // Fremde Statuszeile bleibt fremd
  writeFileSync(join(h, "settings.json"), JSON.stringify({ statusLine: { type: "command", command: "meine-zeile.sh" } }));
  assert.equal(stand().statuszeile, "fremd");
  // alte Form (Kern-Pfad) zählt als vorhanden, aber nicht als aktuell
  writeFileSync(join(h, "settings.json"), JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "/bin/sh '/k/node-start.sh' '/k/adapters/claude-code/brain-hint.mjs'" }] }] } }));
  assert.deepEqual(stand().hooks, { soll: 8, eingetragen: 1, neueForm: 0 });
  assert.equal(lauf([inst, v, "--claude-home", h]).status, 0);
  const s = stand();
  assert.equal(s.aktiv, true);
  assert.deepEqual(s.hooks, { soll: 8, eingetragen: 8, neueForm: 8 });
  assert.equal(s.statuszeile, "brain");
  assert.ok(s.befehle > 0);
});

test("--entfernen: alle Brain-Hooks, die Statuszeile und die Brain-Befehle weg; Fremdes, andere Einstellungen und fremde Befehle bleiben; zweiter Lauf ändert nichts", { skip: !POSIX }, () => {
  const h = claudeHome(), v = vaultOrdner();
  const fremd = { matcher: "Read", hooks: [{ type: "command", command: "node /opt/fremd/lese.mjs" }, { type: "prompt", prompt: "Hallo" }] };
  writeFileSync(join(h, "settings.json"), JSON.stringify({ model: "x", hooks: { PreToolUse: [fremd], Stop: [{ hooks: [{ type: "command", command: "afplay glass" }] }] }, permissions: { allow: ["Bash(ls)"] } }));
  mkdirSync(join(h, "commands"));
  writeFileSync(join(h, "commands", "mein-eigener.md"), "# Mein Befehl\n");
  assert.equal(lauf([inst, v, "--claude-home", h]).status, 0);
  assert.ok(readdirSync(join(h, "commands")).length > 1);
  const r = lauf([inst, "--entfernen", "--claude-home", h]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /- Hook SessionStart entfernt/);
  const s = settings(h);
  assert.deepEqual(s.hooks, { PreToolUse: [fremd], Stop: [{ hooks: [{ type: "command", command: "afplay glass" }] }] });
  assert.equal(s.statusLine, undefined);
  assert.equal(s.model, "x");
  assert.deepEqual(s.permissions, { allow: ["Bash(ls)"] });
  assert.deepEqual(readdirSync(join(h, "commands")), ["mein-eigener.md"], "nur die Brain-Befehle (mit Marke) sind weg");
  assert.ok(readdirSync(h).some((f) => f.startsWith("settings.json.bak-")), "Sicherung der Fassung vor dem Entfernen");
  const vorher = readFileSync(join(h, "settings.json"), "utf8");
  assert.match(lauf([inst, "--entfernen", "--claude-home", h]).stdout, /unverändert/);
  assert.equal(readFileSync(join(h, "settings.json"), "utf8"), vorher);
});

test("--entfernen ohne settings.json, mit kaputtem JSON und ohne Kern-Pfad: nichts kaputt, kein Stacktrace", { skip: !POSIX }, () => {
  const h = claudeHome();
  let r = lauf([inst, "--entfernen", "--claude-home", h], { KORTEX_KERN_UNSTABIL_ERLAUBT: "" });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!existsSync(join(h, "settings.json")), "nichts angelegt");
  writeFileSync(join(h, "settings.json"), "{ kaputt");
  r = lauf([inst, "--entfernen", "--claude-home", h]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /kein gültiges JSON/);
  assert.doesNotMatch(r.stderr, /\bat \w+.*\.mjs/, "kein Stacktrace");
  assert.equal(readFileSync(join(h, "settings.json"), "utf8"), "{ kaputt");
});

// ---- core.hooksPath ----
const GIT_ENV = () => ({ ...sauber(), HOME: TEMP_HOME, GIT_CONFIG_GLOBAL: join(TEMP_HOME, ".gitconfig-leer"), GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.org", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.org" });
const gitIn = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", env: GIT_ENV() }).trim();
const gitVault = () => { const v = vaultOrdner("verdr-gv "); gitIn(v, "init", "-q"); return v; };
const hookLauf = (v, ...a) => spawnSync(process.execPath, [instGit, v, ...a], { encoding: "utf8", env: GIT_ENV() });
const lokal = (v) => { try { return gitIn(v, "config", "--local", "core.hooksPath"); } catch { return ""; } };

test("install-git-hooks: --stand schreibt nichts; an trägt den Kern-Pfad ein; --aus nimmt nur den eigenen Eintrag heraus", () => {
  const v = gitVault();
  let st = JSON.parse(hookLauf(v, "--stand").stdout);
  assert.deepEqual([st.aktiv, st.hooksPath, st.fremder], [false, null, false]);
  assert.equal(lokal(v), "");
  const an = hookLauf(v);
  assert.equal(an.status, 0, an.stderr);
  assert.equal(lokal(v), join(KERN, "git-hooks").split("\\").join("/"));
  st = JSON.parse(hookLauf(v, "--stand").stdout);
  assert.deepEqual([st.aktiv, st.fremder], [true, false]);
  assert.match(hookLauf(v).stdout, /Brain-Hooks aktiv/, "idempotent");
  const aus = hookLauf(v, "--aus");
  assert.equal(aus.status, 0, aus.stderr);
  assert.match(aus.stdout, /entfernt/);
  assert.equal(lokal(v), "");
  assert.match(hookLauf(v, "--aus").stdout, /nicht eingeschaltet/);
});

test("install-git-hooks: ein fremder core.hooksPath bleibt (Exit 4) — auch bei --aus; nur --ersetzen überschreibt; alter Kit-Ordner im Vault zählt als eigener", () => {
  const v = gitVault();
  gitIn(v, "config", "--local", "core.hooksPath", "/opt/husky/hooks");
  let r = hookLauf(v);
  assert.equal(r.status, 4);
  assert.match(r.stderr, /anderer Git-Hook-Ordner/);
  assert.equal(lokal(v), "/opt/husky/hooks");
  assert.equal(JSON.parse(hookLauf(v, "--stand").stdout).fremder, true);
  r = hookLauf(v, "--aus");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /gehört nicht zu Kortex/);
  assert.equal(lokal(v), "/opt/husky/hooks");
  assert.equal(hookLauf(v, "--ersetzen").status, 0);
  assert.equal(lokal(v), join(KERN, "git-hooks").split("\\").join("/"));
  // Der frühere Eintrag auf den Kit-Ordner im Vault wird ohne Rückfrage auf den Kern umgestellt (Alt-Eintrag).
  const alt = join(v, ".tools", "git-hooks");
  gitIn(v, "config", "--local", "core.hooksPath", alt);
  r = hookLauf(v);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(lokal(v), join(KERN, "git-hooks").split("\\").join("/"));
});

test("install-git-hooks ohne stabilen Kern-Pfad: Exit 3, nichts eingetragen", () => {
  const v = gitVault();
  const r = spawnSync(process.execPath, [instGit, v], { encoding: "utf8", env: { ...GIT_ENV(), KORTEX_KERN_UNSTABIL_ERLAUBT: "" } });
  assert.equal(r.status, 3);
  assert.equal(lokal(v), "");
});

test("starterPfad: neben bin/kern (nie im Versionsordner); KORTEX_STARTER_PFAD wirkt nur mit dem Testschalter", { skip: !POSIX }, () => {
  const support = mkdtempSync(join(tmpdir(), "verdr-sp "));
  mkdirSync(join(support, "bin"));
  execFileSync("ln", ["-s", KERN, join(support, "bin", "kern")]);
  const stabil = { KORTEX_KERN_PFAD: join(support, "bin", "kern") };
  // tempWurzeln: [] — der Support-Ordner liegt in diesem Test selbst unter Temp.
  assert.equal(starterPfad({ env: stabil, tempWurzeln: [] }), join(support, "bin", "kortex"));
  assert.equal(starterPfad({ env: { ...stabil, KORTEX_KERN_UNSTABIL_ERLAUBT: "1", KORTEX_STARTER_PFAD: "/x/kortex" }, tempWurzeln: [] }), "/x/kortex");
  assert.equal(starterPfad({ env: { ...stabil, KORTEX_STARTER_PFAD: "/x/kortex" }, tempWurzeln: [] }), join(support, "bin", "kortex"), "Override ohne Testschalter wird ignoriert");
  assert.throws(() => starterPfad({ env: {}, tempWurzeln: [] }), /stabilen Kern-Pfad/);
});

test("doctor erkennt die Hooks in der neuen Form (über den Starter)", { skip: !POSIX }, () => {
  const heim = mkdtempSync(join(tmpdir(), "verdr-dh-")), v = vaultOrdner("verdr-dv ");
  const h = join(heim, ".claude"); mkdirSync(h);
  const doctor = fileURLToPath(new URL("../doctor.mjs", import.meta.url));
  const zeile = () => (spawnSync(process.execPath, [doctor, v], { encoding: "utf8", env: env({ HOME: heim, USERPROFILE: heim }) }).stdout.split("\n").find((l) => /Hooks/.test(l)) || "");
  assert.match(zeile(), /nicht installiert/);
  assert.equal(spawnSync(process.execPath, [inst, v, "--claude-home", h], { encoding: "utf8", env: env({ HOME: heim, USERPROFILE: heim }) }).status, 0);
  assert.match(zeile(), /Live-Aufleuchten und Hintergrund-Ernte eingerichtet/);
});
