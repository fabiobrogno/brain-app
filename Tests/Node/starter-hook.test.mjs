// Starter der App (R4-8): <support>/bin/kortex (macOS/Linux, Shell) bzw. kortex.cmd (Windows, Stapeldatei) und der Hook-Befehl, den Claude Code ausführt.
// Der Starter wird WIRKLICH gestartet (auf Windows über cmd.exe und über sh.exe aus Git for Windows, der Shell der Hooks): Hook-Name, Argumente, stdin und Exit-Code kommen an,
// ein fehlender Hook/Node/Starter und ein ungültiger Name enden still mit Exit 0, der Normalmodus meldet Fehlendes mit Exit 127.
import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { shPfad } from "./attrappe.mjs";

const W = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const WIN = process.platform === "win32";
const { schreibeStarter, starterInhaltUnix, starterInhaltWindows } = await import(pathToFileURL(join(W, "electron/laufzeit.mjs")).href);
const { hookBefehl, hookNameAusBefehl } = await import(pathToFileURL(join(W, "Ressourcen/kern/pfade.mjs")).href);
const { starterAufruf, starterName } = await import(pathToFileURL(join(W, "Ressourcen/gemeinsam/plattform.mjs")).href);

// Ein Support-Ordner wie nach dem Start der App: bin/node[.exe], bin/kern/brain.mjs, bin/kern/adapters/claude-code/<name>.mjs. Leerzeichen im Pfad, damit das Quoten mitgeprüft wird.
function support({ mitNode = true, hooks = true } = {}) {
  const s = join(realpathSync(mkdtempSync(join(tmpdir(), "kortex-starter-"))), "Support Ordner");
  mkdirSync(join(s, "bin", "kern", "adapters", "claude-code"), { recursive: true });
  if (mitNode) { if (WIN) copyFileSync(process.execPath, join(s, "bin", "node.exe")); else symlinkSync(process.execPath, join(s, "bin", "node")); }
  writeFileSync(join(s, "bin", "kern", "brain.mjs"), 'console.log(JSON.stringify({ was: "brain", args: process.argv.slice(2), kern: process.env.KORTEX_KERN_PFAD }));\n');
  if (hooks) {
    writeFileSync(join(s, "bin", "kern", "adapters", "claude-code", "mein-hook.mjs"),
      'let t = ""; process.stdin.on("data", (d) => t += d); process.stdin.on("end", () => { console.log(JSON.stringify({ was: "hook", args: process.argv.slice(2), stdin: t, kern: process.env.KORTEX_KERN_PFAD })); process.exit(Number(process.env.HOOK_EXIT || 0)); });\n');
  }
  return s;
}
const letzteJson = (t) => JSON.parse(String(t).trim().split(/\r?\n/).pop());

// Den Starter direkt starten: Unix als Programm, Windows über cmd.exe (so ruft ihn auch jede Shell auf)
function lauf(starter, args, { stdin = "", env = {} } = {}) {
  const e = { ...process.env, ...env };
  if (WIN) {
    const zeile = `""${starter}" ${args.join(" ")}"`;
    return spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", zeile], { input: stdin, encoding: "utf8", env: e, windowsHide: true, windowsVerbatimArguments: true });
  }
  return spawnSync(starter, args, { input: stdin, encoding: "utf8", env: e });
}
// Den Befehl aus settings.json so ausführen wie Claude Code: durch eine POSIX-Shell (Windows: sh.exe aus Git for Windows)
const durchShell = (befehl, { stdin = "", env = {} } = {}) => spawnSync(shPfad(), ["-c", befehl], { input: stdin, encoding: "utf8", env: { ...process.env, ...env }, windowsHide: true });

test("schreibeStarter: legt bin/kortex bzw. bin/kortex.cmd an, ist ausführbar und beim zweiten Mal unverändert", () => {
  const s = support();
  const p = schreibeStarter({ support: s });
  assert.equal(p, join(s, "bin", WIN ? "kortex.cmd" : "kortex"));
  assert.equal(starterName(), WIN ? "kortex.cmd" : "kortex");
  const r = lauf(p, ["hook", "mein-hook"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(schreibeStarter({ support: s }), p);
  rmSync(s, { recursive: true, force: true });
});

test("Starter, Hook-Modus: Name, Argumente, stdin, KORTEX_KERN_PFAD und der Exit-Code des Hooks kommen an", () => {
  const s = support();
  const p = schreibeStarter({ support: s });
  const r = lauf(p, ["hook", "mein-hook", "--art", "fakt", "--konto", "k_0123abcd"], { stdin: "Eingabe von Claude\n" });
  assert.equal(r.status, 0, r.stderr);
  const j = letzteJson(r.stdout);
  assert.deepEqual([j.was, j.args, j.stdin.trim()], ["hook", ["--art", "fakt", "--konto", "k_0123abcd"], "Eingabe von Claude"]);
  assert.match(j.kern, /bin[\\/]kern\\?$/);
  assert.equal(lauf(p, ["hook", "mein-hook"], { env: { HOOK_EXIT: "2" } }).status, 2, "ein blockierender Hook behält seinen Exit-Code");
  rmSync(s, { recursive: true, force: true });
});

test("Starter, Hook-Modus: fehlender Hook, fehlendes Node und ungültiger Name enden still mit Exit 0", () => {
  for (const [name, args, opt] of [["fehlender Hook", ["hook", "gibt-es-nicht"], {}], ["ungültiger Name", ["hook", "../x"], {}], ...(WIN ? [] : [["Name mit Sonderzeichen", ["hook", "a&b"], {}]]), ["ohne Name", ["hook"], {}], ["ohne Node", ["hook", "mein-hook"], { mitNode: false }]]) {
    const s = support(opt);
    const r = lauf(schreibeStarter({ support: s }), args);
    assert.equal(r.status, 0, `${name}: Exit ${r.status}`);
    assert.equal(`${r.stdout}${r.stderr}`.trim(), "", `${name}: keine Ausgabe`);
    rmSync(s, { recursive: true, force: true });
  }
});

test("Starter, Normalmodus: startet brain.mjs mit den Argumenten; fehlt Node oder der Kern, meldet er es und endet mit 127", () => {
  const s = support();
  const r = lauf(schreibeStarter({ support: s }), ["hallo", "welt"]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(letzteJson(r.stdout).args, ["hallo", "welt"]);
  const ohne = support({ mitNode: false });
  const f = lauf(schreibeStarter({ support: ohne }), ["x"]);
  assert.equal(f.status, 127);
  assert.match(f.stderr, /Node fehlt/);
  rmSync(s, { recursive: true, force: true }); rmSync(ohne, { recursive: true, force: true });
});

test("Hook-Befehl aus settings.json (hookBefehl) läuft durch die Shell: mit Starter startet er den Hook, ohne Starter tut er still nichts", () => {
  const s = support();
  const starter = schreibeStarter({ support: s });
  const cmd = hookBefehl(starter, "mein-hook", " --art fakt");
  assert.equal(hookNameAusBefehl(cmd), "mein-hook");
  const r = durchShell(cmd, { stdin: "Eingabe\n" });
  assert.equal(r.status, 0, `${r.stderr}\n${cmd}`);
  assert.deepEqual([letzteJson(r.stdout).was, letzteJson(r.stdout).args, letzteJson(r.stdout).stdin.trim()], ["hook", ["--art", "fakt"], "Eingabe"]);
  assert.equal(durchShell(cmd, { env: { HOOK_EXIT: "2" } }).status, 2, "Exit-Code des Hooks bleibt erhalten");
  rmSync(join(s, "bin", WIN ? "kortex.cmd" : "kortex"));
  const still = durchShell(cmd);
  assert.deepEqual([still.status, `${still.stdout}${still.stderr}`.trim()], [0, ""], "Starter fehlt: still, Exit 0");
  rmSync(s, { recursive: true, force: true });
});

test("hookBefehl: Windows-Form (if/else, kein exec) und macOS/Linux-Form; hookNameAusBefehl erkennt beide und die alte Windows-Form", () => {
  assert.equal(hookBefehl("C:\\Users\\a b\\Kortex\\bin\\kortex.cmd", "brain-hint", "", "win32"), "if [ -f 'C:/Users/a b/Kortex/bin/kortex.cmd' ]; then 'C:/Users/a b/Kortex/bin/kortex.cmd' hook brain-hint; else exit 0; fi");
  assert.equal(hookBefehl("/s/bin/kortex", "brain-hint", " --art fakt", "linux"), "[ -x '/s/bin/kortex' ] && exec '/s/bin/kortex' hook brain-hint --art fakt || exit 0");
  assert.equal(hookNameAusBefehl(hookBefehl("C:/x/bin/kortex.cmd", "sitzung-ende", " --konto k_0123abcd", "win32")), "sitzung-ende");
  assert.equal(hookNameAusBefehl(hookBefehl("/x/bin/kortex", "sitzung-ende", "", "linux")), "sitzung-ende");
  assert.throws(() => hookBefehl("/x/kortex", "A;b", "", "win32"), /ungültiger Hook-Name/);
});

test("starterAufruf: Windows ruft node.exe und brain.mjs direkt (nie eine .cmd ohne Shell), sonst den Starter selbst", () => {
  const w = starterAufruf("C:\\S\\bin\\kortex.cmd", ["umstellung", "--vault", "C:\\a & b"], { plattform: "win32" });
  assert.match(w.programm, /node\.exe$/);
  assert.deepEqual(w.args.slice(1), ["umstellung", "--vault", "C:\\a & b"]);
  assert.match(w.args[0], /brain\.mjs$/);
  assert.match(w.env.KORTEX_KERN_PFAD, /kern$/);
  assert.deepEqual(starterAufruf("/s/bin/kortex", ["x"], { plattform: "linux" }), { programm: "/s/bin/kortex", args: ["x"], env: {} });
  assert.deepEqual(starterAufruf("/s/bin/kortex", ["x"], { plattform: "darwin" }).env, {});
});

test("Inhalt des Starters: Unix quotet Pfade mit Apostroph; die Stapeldatei enthält keine festen Pfade", () => {
  const u = starterInhaltUnix("/Users/o'neil/Support");
  if (!WIN) assert.ok(u.includes("node='/Users/o'\\''neil/Support/bin/node'")); // join() setzt unter Windows Rückwärtsstriche
  assert.ok(u.startsWith("#!/bin/sh\n"));
  const w = starterInhaltWindows();
  assert.ok(w.includes("%~dp0node.exe") && w.includes("\r\n") && !/[A-Z]:\\/.test(w));
});
