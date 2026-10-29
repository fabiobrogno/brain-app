// test-git-sicher-innen.mjs — Review 3 zu git-sicher: Verweise IN .git, lokale Remote-Adressen, `config`, gc.*, Personenfelder, GIT_DIR.
// Fixtures nur in Wegwerf-Ordnern; Marken-Dateien beweisen, dass nichts läuft bzw. nichts draußen geschrieben wird.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, appendFileSync, cpSync, renameSync, rmSync, symlinkSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync, execFileSync } from "node:child_process";

const KERN = fileURLToPath(new URL("..", import.meta.url));
const SICHER = join(KERN, "git-sicher");
const FIXTURE = join(KERN, "tests", "fixture");
const GIT = "git";
const ENV = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.org", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.org" };
for (const k of Object.keys(ENV)) if (k.startsWith("GIT_") && !/^GIT_(CONFIG_NOSYSTEM|AUTHOR|COMMITTER)/.test(k)) delete ENV[k];
delete ENV.BRAIN_GIT_HOOKS_ERLAUBT; delete ENV.BRAIN_GIT_PROGRAMM;
// Produktivumgebung: ohne die Testschalter
const PROD = { ...ENV }; delete PROD.KORTEX_KERN_UNSTABIL_ERLAUBT; delete PROD.BRAIN_TESTMODUS;
const g = (cwd, ...a) => execFileSync(GIT, a, { cwd, env: ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const sicher = (env, v, ...a) => spawnSync(SICHER, ["-C", v, ...a], { env, encoding: "utf8" });
const ln = (ziel, link) => execFileSync("ln", ["-s", ziel, link]);

function neuerVault() {
  const basis = mkdtempSync(join(tmpdir(), "git-sicher-innen-"));
  const v = join(basis, "Vault_Eins");
  cpSync(FIXTURE, v, { recursive: true });
  g(v, "init", "-q", "-b", "main"); g(v, "add", "--", "."); g(v, "commit", "-q", "-m", "Start");
  const aussen = join(basis, "aussen"); mkdirSync(aussen);
  writeFileSync(join(aussen, "ziel.txt"), "fremd\n");
  return { basis, v, aussen, ziel: join(aussen, "ziel.txt") };
}

test("Verweise IN .git (logs/HEAD, COMMIT_EDITMSG, FETCH_HEAD, objects, refs, config …) → Exit 126, nichts wird draußen geschrieben", () => {
  const faelle = [
    ["logs/HEAD", (s) => { rmSync(join(s.v, ".git/logs/HEAD")); ln(s.ziel, join(s.v, ".git/logs/HEAD")); }],
    ["COMMIT_EDITMSG", (s) => { rmSync(join(s.v, ".git/COMMIT_EDITMSG"), { force: true }); ln(s.ziel, join(s.v, ".git/COMMIT_EDITMSG")); }],
    ["FETCH_HEAD", (s) => ln(s.ziel, join(s.v, ".git/FETCH_HEAD"))],
    ["objects als Verweis", (s) => { const o = join(s.v, ".git/objects"); const fremdObjekte = join(s.basis, "objekte"); renameSync(o, fremdObjekte); ln(fremdObjekte, o); }],
    ["ein Verweis tief in logs/refs", (s) => { mkdirSync(join(s.v, ".git/logs/refs/heads"), { recursive: true }); ln(s.ziel, join(s.v, ".git/logs/refs/heads/zweig")); }],
    ["packed-refs", (s) => ln(s.ziel, join(s.v, ".git/packed-refs"))],
    ["info/exclude", (s) => { mkdirSync(join(s.v, ".git/info"), { recursive: true }); rmSync(join(s.v, ".git/info/exclude"), { force: true }); ln(s.ziel, join(s.v, ".git/info/exclude")); }],
  ];
  for (const [name, mach] of faelle) {
    const s = neuerVault();
    mach(s);
    for (const sub of [["status", "--porcelain"], ["commit", "-q", "--allow-empty", "-m", "x"], ["config", "user.email", "x@example.org"], ["fetch", "--quiet"]]) {
      const r = sicher(ENV, s.v, ...sub);
      assert.equal(r.status, 126, `${name} (${sub[0]}): erwartet 126, war ${r.status} ${r.stderr}`);
      assert.match(r.stderr, /Verweis/, name);
    }
    assert.equal(readFileSync(s.ziel, "utf8"), "fremd\n", `${name}: die Datei draußen blieb unverändert`);
  }
});

test("user.name/user.email mit Shell- und Formatzeichen werden verweigert (Reflog-Zeile als sh über logs/HEAD → .zshrc)", () => {
  for (const wert of ["x; touch MARKE", "a$(touch MARKE)", "a`touch MARKE`", "a|b", "a&b", "a<b", "a>b", "a\\b"]) {
    for (const schluessel of ["user.name", "user.email"]) {
      const s = neuerVault();
      g(s.v, "config", schluessel, wert);
      const r = sicher(ENV, s.v, "status", "--porcelain");
      assert.equal(r.status, 126, `${schluessel}=${wert}: ${r.status} ${r.stderr}`);
      assert.match(r.stderr, new RegExp(schluessel.replace(".", "\\.")));
    }
  }
  const s = neuerVault();
  g(s.v, "config", "user.name", "Fabio Brogno (privat)"); g(s.v, "config", "user.email", "fabio@example.org");
  assert.equal(sicher(ENV, s.v, "status", "--porcelain").status, 0, "ein gewöhnlicher Name läuft");
});

test("lokale Remote-Adressen (absoluter Pfad, file:///) sind in der Produktion verboten, https/ssh erlaubt; die Testumgebung erlaubt lokale", () => {
  for (const url of ["/tmp/irgendein/repo.git", "file:///tmp/irgendein/repo.git"]) {
    for (const schluessel of ["url", "pushurl"]) {
      const s = neuerVault();
      appendFileSync(join(s.v, ".git/config"), `[remote "origin"]\n\t${schluessel} = ${url}\n`);
      const r = sicher(PROD, s.v, "status", "--porcelain");
      assert.equal(r.status, 126, `${schluessel}=${url}: ${r.status} ${r.stderr}`);
      assert.match(r.stderr, new RegExp(`remote\\.origin\\.${schluessel}`));
      assert.equal(sicher(ENV, s.v, "status", "--porcelain").status, 0, "in der Testumgebung erlaubt");
    }
  }
  for (const url of ["https://example.org/u/r.git", "ssh://git@example.org/u/r.git", "git@example.org:u/r.git"]) {
    const s = neuerVault();
    appendFileSync(join(s.v, ".git/config"), `[remote "origin"]\n\turl = ${url}\n`);
    assert.equal(sicher(PROD, s.v, "status", "--porcelain").status, 0, url);
  }
});

test("Push zu einem lokalen Remote startet die Hooks des Ziel-Repos nicht: die Adresse wird schon vorher verweigert", () => {
  const s = neuerVault();
  const ziel = join(s.basis, "ziel.git"); g(s.basis, "init", "-q", "--bare", "-b", "main", ziel);
  const marke = join(s.basis, "MARKE.txt");
  const hook = join(ziel, "hooks", "pre-receive");
  writeFileSync(hook, `#!/bin/sh\necho hook >> '${marke}'\n`); execFileSync("chmod", ["+x", hook]);
  g(s.v, "remote", "add", "origin", ziel);
  const r = sicher(PROD, s.v, "push", "-q", "origin", "main");
  assert.equal(r.status, 126, r.stderr);
  assert.equal(existsSync(marke), false, "der Hook des Ziels lief nicht");
  // Kontrolle: einfaches git startet ihn
  g(s.v, "push", "-q", "origin", "main");
  assert.equal(existsSync(marke), true, "Kontrolle: einfaches git startet den Hook des lokalen Ziels");
});

test("config bekommt die Lage- und Verweisprüfung: .git/config als Verweis ins Leere und .git → fremdes Repo schreiben nirgends draußen", () => {
  // (a) .git/config als Verweis ins Leere: `config user.email` legte die Datei draußen an
  const a = neuerVault();
  const draussen = join(a.basis, "neu-angelegt.cfg");
  rmSync(join(a.v, ".git/config")); ln(draussen, join(a.v, ".git/config"));
  const ra = sicher(ENV, a.v, "config", "user.email", "x@example.org");
  assert.equal(ra.status, 126, ra.stderr);
  assert.equal(existsSync(draussen), false, "draußen wurde keine Datei angelegt");
  // (b) .git zeigt auf ein fremdes Repo: `config core.hooksPath` schaltete dort die Hooks um
  const b = neuerVault();
  const fremd = join(b.basis, "Fremd"); mkdirSync(fremd); g(fremd, "init", "-q", "-b", "main");
  const vorher = readFileSync(join(fremd, ".git/config"), "utf8");
  const e = join(b.basis, "Eingang"); mkdirSync(e); writeFileSync(join(e, ".git"), `gitdir: ${join(fremd, ".git")}\n`);
  const rb = sicher(ENV, e, "config", "core.hooksPath", "/tmp/hooks");
  assert.equal(rb.status, 126, rb.stderr);
  assert.equal(readFileSync(join(fremd, ".git/config"), "utf8"), vorher, "die Konfiguration des fremden Repos blieb unverändert");
  // (c) normal: lesen und schreiben im eigenen Vault funktionieren; --global-Lesen ohne Repo auch
  const c = neuerVault();
  assert.equal(sicher(ENV, c.v, "config", "core.hooksPath", "/tmp/hooks").status, 0);
  assert.equal(sicher(ENV, c.v, "config", "core.hooksPath").stdout.trim(), "/tmp/hooks");
  const kein = join(c.basis, "kein-repo"); mkdirSync(kein);
  assert.equal(spawnSync(SICHER, ["config", "--global", "--get", "user.name"], { cwd: kein, env: ENV }).status !== 126, true, "config --global braucht kein Repository");
  assert.equal(spawnSync(SICHER, ["config", "--local", "--get", "user.name"], { cwd: kein, env: ENV }).status !== 126, true, "ohne Repository scheitert git selbst, nicht git-sicher");
});

test("gc.*: nur die feste Liste mit passenden Werten", () => {
  const gut = [["gc.auto", "0"], ["gc.autoPackLimit", "50"], ["gc.autoDetach", "false"], ["gc.pruneExpire", "never"], ["gc.reflogExpire", "90.days"], ["gc.reflogExpireUnreachable", "30 days"], ["gc.worktreePruneExpire", "3.months.ago"]];
  for (const [k, w] of gut) { const s = neuerVault(); g(s.v, "config", k, w); assert.equal(sicher(ENV, s.v, "status", "--porcelain").status, 0, `${k}=${w}`); }
  const schlecht = [["gc.auto", "evil"], ["gc.autoDetach", "2"], ["gc.pruneExpire", "$(x)"], ["gc.bigPackThreshold", "1"], ["gc.foo", "1"], ["gc.cruftPacks", "true"]];
  for (const [k, w] of schlecht) { const s = neuerVault(); g(s.v, "config", k, w); assert.equal(sicher(ENV, s.v, "status", "--porcelain").status, 126, `${k}=${w}`); }
});

test("GIT_DIR bleibt nur im Hook (GIT_INDEX_FILE) und nur unter dem -C-Ordner stehen", () => {
  const s = neuerVault();
  const fremd = join(s.basis, "Fremd"); mkdirSync(fremd); g(fremd, "init", "-q", "-b", "main");
  // GIT_DIR auf ein fremdes Repo, auch mit GIT_INDEX_FILE: verworfen, git arbeitet am Vault
  const top = spawnSync(SICHER, ["-C", s.v, "rev-parse", "--show-toplevel"], { env: { ...ENV, GIT_DIR: join(fremd, ".git"), GIT_INDEX_FILE: join(fremd, ".git/index") }, encoding: "utf8" });
  assert.equal(top.status, 0, top.stderr);
  assert.equal(execFileSync("sh", ["-c", `cd '${s.v}' && pwd -P`], { encoding: "utf8" }).trim(), top.stdout.trim());
  // Hook-Fall: GIT_DIR=.git und GIT_INDEX_FILE relativ, Arbeitsordner = Vault
  const hook = spawnSync(SICHER, ["-C", s.v, "status", "--porcelain"], { cwd: s.v, env: { ...ENV, GIT_DIR: ".git", GIT_INDEX_FILE: ".git/index" }, encoding: "utf8" });
  assert.equal(hook.status, 0, hook.stderr);
});
