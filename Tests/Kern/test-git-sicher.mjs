// test-git-sicher.mjs — Kern-Umzug P4 (Sicherheit): Ein Vault liefert nur Daten. Ein geklonter fremder Vault darf beim Öffnen, bei
// `brain status`, Gesundheit, Rückfragen, Suche und in der Brücke nie ein Programm starten: weder über brain.config.json (werkzeuge.*),
// noch über die .git/config (core.fsmonitor, core.hooksPath/.git/hooks, Filter-, Diff-, Merge-Treiber, credential.helper, …).
// Jedes Programm im Vault schreibt eine Marke, falls es je läuft; die Marke darf nie entstehen. Kontrollen beweisen vorher, dass die
// Wege ohne die Härtung wirklich Marken schreiben würden (sonst bewiese „keine Marke“ nichts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, chmodSync, cpSync, readFileSync, rmSync, readdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync, spawn, execFileSync } from "node:child_process";

const KERN = fileURLToPath(new URL("..", import.meta.url));
const SICHER = join(KERN, "git-sicher");
const FIXTURE = join(KERN, "tests", "fixture");
const NODE = process.execPath;
const GIT = "git"; // nur für den Aufbau und die Kontrollen; der Kern nutzt git-sicher
const ENV = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.org", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.org" };
for (const k of Object.keys(ENV)) if (k.startsWith("GIT_") && !/^GIT_(CONFIG_NOSYSTEM|AUTHOR|COMMITTER)/.test(k)) delete ENV[k];
delete ENV.BRAIN_GIT_HOOKS_ERLAUBT; delete ENV.BRAIN_GIT_PROGRAMM;
const g = (cwd, ...a) => execFileSync(GIT, a, { cwd, env: ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function neuerVault() {
  const basis = mkdtempSync(join(tmpdir(), "git-sicher-"));
  const v = join(basis, "Vault_Eins");
  cpSync(FIXTURE, v, { recursive: true });
  g(v, "init", "-q", "-b", "main");
  g(v, "add", "--", ".");
  g(v, "commit", "-q", "-m", "Start");
  const marke = join(basis, "MARKE.txt");
  const programm = (name, ende = "exit 1") => {
    const p = join(v, name);
    writeFileSync(p, `#!/bin/sh\necho ${name} >> '${marke}'\n${ende}\n`);
    chmodSync(p, 0o755);
    return p;
  };
  return { basis, v, marke, programm, marken: () => (existsSync(marke) ? readFileSync(marke, "utf8").split("\n").filter(Boolean) : []), weg: () => rmSync(marke, { force: true }) };
}
const kern = (v, args, extra = {}) => spawnSync(NODE, [join(KERN, "brain.mjs"), "--vault", v, ...args], { encoding: "utf8", env: { ...ENV, ...extra }, timeout: 90_000 });

// Brücke: eine Anfrage senden, auf die Antwort warten, dann stdin schließen.
function bruecke(v, pfad) {
  return new Promise((ok) => {
    const p = spawn(NODE, [join(KERN, "ansicht", "bruecke.mjs"), "--vault", v], { env: ENV, stdio: ["pipe", "pipe", "ignore"] });
    let puffer = "", gesendet = false;
    const frist = setTimeout(() => { p.kill(); ok("zeit"); }, 60_000);
    p.stdout.on("data", (d) => {
      puffer += d;
      if (!gesendet && puffer.includes('"bereit"')) { gesendet = true; p.stdin.write(JSON.stringify({ id: 1, methode: "GET", pfad }) + "\n"); }
      if (puffer.includes('"id":1')) { clearTimeout(frist); p.stdin.end(); }
    });
    p.on("close", () => { clearTimeout(frist); ok("ende"); });
  });
}

// Alle Wege des Kerns, die ein Vault öffnet oder liest
async function oeffneAlles(s) {
  const lauf = [["status", "--json"], ["gesundheit", "--json"], ["rueckfragen", "liste"], ["search", "Kaffee"], ["pflege"], ["version"], ["index"], ["lint"]];
  for (const a of lauf) {
    const r = kern(s.v, a);
    assert.ok(r.error === undefined, `brain ${a.join(" ")}: ${r.error}`);
    assert.doesNotMatch(String(r.stderr), /Error:|at .*\.mjs:\d+/, `brain ${a.join(" ")}: Absturz mit Stacktrace\n${r.stderr}`);
  }
  for (const pfad of ["/api/daten", "/api/ping"]) await bruecke(s.v, pfad);
}

test("Kontrolle: ohne die Härtung würden fsmonitor, Hook und Filter-Treiber aus der .git/config Marken schreiben", () => {
  const s = neuerVault();
  const fsm = s.programm("fsmonitor.sh");
  g(s.v, "config", "core.fsmonitor", fsm);
  writeFileSync(join(s.v, "brain.config.json"), readFileSync(join(s.v, "brain.config.json"), "utf8") + "\n"); // eine Änderung, damit git den Beobachter fragt
  const st = g(s.v, "status", "--porcelain");
  assert.ok(s.marken().includes("fsmonitor.sh"), `fsmonitor läuft in plain git (${JSON.stringify(st)} ${g(s.v, "config", "--list").split("\n").filter((z) => /fsmon|hooks/.test(z)).join(";")} marke=${s.marke})`);
  g(s.v, "config", "--unset", "core.fsmonitor"); s.weg();
  mkdirSync(join(s.v, ".git", "hooks"), { recursive: true });
  const hook = join(s.v, ".git", "hooks", "pre-commit");
  writeFileSync(hook, `#!/bin/sh\necho hook >> '${s.marke}'\n`); chmodSync(hook, 0o755);
  writeFileSync(join(s.v, "n.md"), "n\n"); g(s.v, "add", "--", "n.md"); g(s.v, "commit", "-q", "-m", "n");
  assert.ok(s.marken().includes("hook"), "Hook läuft in plain git");
  s.weg();
  const filter = s.programm("filter.sh", "cat");
  g(s.v, "config", "filter.x.clean", filter); writeFileSync(join(s.v, ".gitattributes"), "*.md filter=x\n");
  writeFileSync(join(s.v, "m.md"), "m\n"); g(s.v, "add", "--", "m.md");
  assert.ok(s.marken().includes("filter.sh"), "Filter-Treiber läuft in plain git");
});

test("werkzeuge.* in der brain.config.json des Vaults startet nie ein Programm (status, Gesundheit, Rückfragen, Suche, Brücke …)", async () => {
  const s = neuerVault();
  const evil = s.programm("evil.sh");
  const cfgDatei = join(s.v, "brain.config.json");
  const cfg = JSON.parse(readFileSync(cfgDatei, "utf8"));
  // jeder denkbare Schlüssel: git, qmd, claude, node, editor, oeffner, shell — Kern liest keinen davon aus dem Vault
  cfg.werkzeuge = Object.fromEntries(["git", "qmd", "claude", "node", "editor", "oeffner", "shell", "gh", "ssh"].map((k) => [k, evil]));
  cfg.suche = { ...(cfg.suche || {}), befehl: evil, engine: "qmd" };
  cfg.befehl = evil; cfg.command = evil; cfg.hooks = { vorCommit: evil };
  writeFileSync(cfgDatei, JSON.stringify(cfg, null, 2) + "\n");
  await oeffneAlles(s);
  assert.deepEqual(s.marken(), [], "ein Programm aus brain.config.json ist gelaufen");
});

test("Einstellungen der .git/config, die git neutralisiert (fsmonitor, Hooks, Editor): nichts läuft, der Kern arbeitet weiter", async () => {
  const s = neuerVault();
  g(s.v, "config", "core.fsmonitor", s.programm("fsmonitor.sh"));
  g(s.v, "config", "core.editor", s.programm("editor.sh"));
  g(s.v, "config", "core.hooksPath", join(s.v, "eigene-hooks"));
  mkdirSync(join(s.v, "eigene-hooks"));
  for (const h of ["pre-commit", "post-commit", "reference-transaction", "post-checkout"]) {
    const p = join(s.v, "eigene-hooks", h); writeFileSync(p, `#!/bin/sh\necho ${h} >> '${s.marke}'\n`); chmodSync(p, 0o755);
  }
  mkdirSync(join(s.v, ".git", "hooks"), { recursive: true });
  const alt = join(s.v, ".git", "hooks", "pre-commit"); writeFileSync(alt, `#!/bin/sh\necho git-hooks-ordner >> '${s.marke}'\n`); chmodSync(alt, 0o755);
  // git-sicher selbst: Status und Commit funktionieren, nichts läuft
  assert.equal(spawnSync(SICHER, ["-C", s.v, "status", "--porcelain"], { env: ENV }).status, 0);
  writeFileSync(join(s.v, "n.md"), "n\n");
  assert.equal(spawnSync(SICHER, ["-C", s.v, "add", "--", "n.md"], { env: ENV }).status, 0);
  const c = spawnSync(SICHER, ["-C", s.v, "commit", "-q", "-m", "n"], { env: ENV, encoding: "utf8" });
  assert.equal(c.status, 0, c.stderr);
  await oeffneAlles(s);
  assert.deepEqual(s.marken(), [], "ein Programm aus der Repo-Konfiguration ist gelaufen");
  assert.equal(kern(s.v, ["status", "--json"]).status, 0, "der Kern arbeitet trotzdem");
});

// Schlüssel, die ein Programm starten und sich nicht per Option abschalten lassen → git-sicher verweigert (Exit 126)
const IMMER = [["gpg.program"], ["gpg.x509.program"], ["gpg.ssh.defaultKeyCommand"], ["merge.x.driver"], ["filter.x.clean"], ["filter.x.smudge"], ["filter.x.process"],
  ["diff.external"], ["diff.x.command"], ["diff.x.textconv"]];
// Netz-Schlüssel gelten bei JEDEM Befehl: auch lesende Befehle laden bei einem Partial Clone nach und starten dann diese Programme
const NETZ = [["credential.helper"], ["credential.https://example.org.helper"], ["core.askpass"], ["core.gitproxy"], ["core.alternaterefscommand"],
  ["remote.o.uploadpack"], ["remote.o.receivepack"], ["remote.o.vcs"], ["core.sshCommand"]];

test("gefährliche Programm-Schlüssel der .git/config: git-sicher verweigert, nichts läuft; brain-Befehle laufen ohne Absturz", async () => {
  for (const [schluessel] of [...IMMER, ...NETZ]) {
    const s = neuerVault();
    const evil = s.programm("evil.sh", "cat");
    g(s.v, "config", schluessel, evil);
    for (const sub of [["status", "--porcelain"], ["cat-file", "-t", "HEAD"], ["log", "-1", "--format=%H"], ["fetch", "--quiet"]]) {
      const r = spawnSync(SICHER, ["-C", s.v, ...sub], { env: ENV, encoding: "utf8" });
      assert.equal(r.status, 126, `${schluessel} (${sub[0]}): erwartet Exit 126, war ${r.status} (${r.stderr})`);
      assert.match(r.stderr, /gesperrt/, schluessel);
    }
    assert.deepEqual(s.marken(), [], `${schluessel}: Programm lief`);
  }
});

test("alle gefährlichen Schlüssel zugleich (+ .gitattributes): brain status/Gesundheit/Rückfragen/Suche/Brücke starten nichts", async () => {
  const s = neuerVault();
  const evil = s.programm("evil.sh", "cat");
  for (const [k] of [...IMMER, ...NETZ]) g(s.v, "config", k, evil);
  g(s.v, "config", "core.fsmonitor", evil); g(s.v, "config", "core.hooksPath", s.v);
  writeFileSync(join(s.v, ".gitattributes"), "*.md filter=x diff=x merge=x\n");
  await oeffneAlles(s);
  assert.deepEqual(s.marken(), []);
});

test("Hooks: nur der Hook-Ordner des Kerns (und ausdrücklich von der Umgebung erlaubte) läuft; ein Pfad aus dem Vault nie", () => {
  const s = neuerVault();
  const eigene = join(s.v, "eigene-hooks"); mkdirSync(eigene);
  const hook = join(eigene, "pre-commit"); writeFileSync(hook, `#!/bin/sh\necho hook >> '${s.marke}'\n`); chmodSync(hook, 0o755);
  g(s.v, "config", "core.hooksPath", eigene);
  writeFileSync(join(s.v, "a.md"), "a\n"); g(s.v, "add", "--", "a.md");
  assert.equal(spawnSync(SICHER, ["-C", s.v, "commit", "-q", "-m", "a"], { env: ENV }).status, 0);
  assert.deepEqual(s.marken(), [], "Hook aus dem Vault lief");
  // dieselbe Konfiguration, aber die Umgebung des Aufrufers erlaubt den Ordner (Testschalter): jetzt läuft er
  writeFileSync(join(s.v, "b.md"), "b\n"); g(s.v, "add", "--", "b.md");
  assert.equal(spawnSync(SICHER, ["-C", s.v, "commit", "-q", "-m", "b"], { env: { ...ENV, BRAIN_GIT_HOOKS_ERLAUBT: eigene } }).status, 0);
  assert.deepEqual(s.marken(), ["hook"]);
  // der Hook-Ordner des Kerns selbst ist erlaubt (so richtet install-git-hooks.mjs den Schutz ein)
  const kernHooks = join(KERN, "git-hooks");
  if (existsSync(kernHooks)) {
    const t = neuerVault(); g(t.v, "config", "core.hooksPath", kernHooks);
    const r = spawnSync(SICHER, ["-C", t.v, "config", "core.hooksPath"], { env: ENV, encoding: "utf8" });
    assert.equal(r.stdout.trim(), kernHooks, "git-sicher config liest die echte Einstellung (install-git-hooks.mjs verlässt sich darauf)");
  }
});

test("git-sicher: config bleibt unverändert, init/clone ohne -C lesen keine fremde Konfiguration, kein git → Exit 127", () => {
  const s = neuerVault();
  g(s.v, "config", "filter.x.clean", s.programm("evil.sh", "cat"));
  assert.equal(spawnSync(SICHER, ["-C", s.v, "config", "filter.x.clean"], { env: ENV, encoding: "utf8" }).status, 0, "config darf immer lesen");
  const ziel = join(s.basis, "neu");
  const r = spawnSync(SICHER, ["init", "-q", ziel], { cwd: s.v, env: ENV, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr); // Arbeitsverzeichnis ist der gesperrte Vault, das Ziel ist ein neuer Ordner
  const ohne = spawnSync(SICHER, ["status"], { env: { ...ENV, BRAIN_GIT_PROGRAMM: "/gibt/es/nicht" }, encoding: "utf8" });
  assert.notEqual(ohne.status, 0);
  assert.deepEqual(s.marken(), []);
});

test("Der Kern startet git nur über git-sicher: kein nacktes 'git', kein Pfad aus der Config im Kern-Code", () => {
  // Grobe Quelltext-Prüfung: spawn/exec mit dem nackten Namen "git" oder 'git' als Programm gibt es im Kern nicht.
  const treffer = [];
  const lies = (dir) => {
    for (const e of readdirSyncMitTyp(dir)) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (!["tests", "node_modules", "vendor", "build"].includes(e.name)) lies(p); continue; }
      if (!/\.mjs$/.test(e.name)) continue;
      readFileSync(p, "utf8").split("\n").forEach((z, i) => {
        if (/^\s*\/\//.test(z)) return;
        if (/(spawn|spawnSync|execFile|execFileSync)\(\s*["']git["']/.test(z)) treffer.push(`${p.slice(KERN.length)}:${i + 1}`);
      });
    }
  };
  lies(KERN);
  assert.deepEqual(treffer, [], "nacktes git als Programm");
});
function readdirSyncMitTyp(d) { return readdirSync(d, { withFileTypes: true }); }

// ------------------------------------------------------------------------------------------------------------------------------
// Review-Befunde P4 (Opus): Partial-Clone-Nachladen, Arbeitsbaum/Git-Verzeichnis nach außen, Ordnernamen, Testschalter

// Ein Server (bare), ein Partial Clone (ohne Blobs) davon; die .git/config des Klons nennt einen uploadpack mit Marke.
function partialClone() {
  const s = neuerVault();
  const server = join(s.basis, "server.git");
  const w = join(s.basis, "werk"); mkdirSync(w);
  g(w, "init", "-q", "-b", "main"); writeFileSync(join(w, "f.md"), "Inhalt\n"); g(w, "add", "--", "f.md"); g(w, "commit", "-q", "-m", "f");
  execFileSync(GIT, ["clone", "-q", "--bare", w, server], { env: ENV });
  g(server, "config", "uploadpack.allowFilter", "true"); g(server, "config", "uploadpack.allowAnySHA1InWant", "true");
  const klon = join(s.basis, "klon");
  execFileSync(GIT, ["clone", "-q", "--filter=blob:none", "--no-checkout", `file://${server}`, klon], { env: ENV });
  const echt = execFileSync(GIT, ["--exec-path"], { env: ENV, encoding: "utf8" }).trim();
  const prog = join(s.basis, "uploadpack.sh");
  writeFileSync(prog, `#!/bin/sh\necho uploadpack >> '${s.marke}'\nexec '${echt}/git-upload-pack' "$@"\n`); chmodSync(prog, 0o755);
  g(klon, "config", "remote.origin.uploadpack", prog);
  return { ...s, klon };
}

test("Partial Clone: lesende Befehle laden Blobs nach und starten uploadpack/ssh — git-sicher sperrt, ohne die Sperre liefe das Programm (Kontrolle)", () => {
  const s = partialClone();
  // Kontrolle: einfaches git holt den fehlenden Blob beim Lesen nach und startet dabei den eingetragenen uploadpack
  g(s.klon, "cat-file", "-p", "HEAD:f.md");
  assert.ok(s.marken().includes("uploadpack"), "einfaches git lädt beim Lesen nach und startet uploadpack");
  // frischer Klon (der Blob fehlt wieder), jetzt über git-sicher
  const t = partialClone();
  for (const sub of [["cat-file", "-p", "HEAD:f.md"], ["checkout", "-q", "HEAD", "--", "f.md"], ["log", "-p", "-1"], ["worktree", "add", join(t.basis, "w2")], ["checkout-index", "-a"]]) {
    const r = spawnSync(SICHER, ["-C", t.klon, ...sub], { env: ENV, encoding: "utf8" });
    assert.equal(r.status, 126, `${sub[0]}: ${r.status} ${r.stderr}`);
  }
  assert.deepEqual(t.marken(), [], "über git-sicher lief kein Programm");
  // auch ohne uploadpack/ssh-Schlüssel in der Konfiguration: Partial Clone selbst ist gesperrt (kein stilles Nachladen aus dem Netz)
  const u = partialClone(); g(u.klon, "config", "--unset", "remote.origin.uploadpack");
  assert.equal(spawnSync(SICHER, ["-C", u.klon, "cat-file", "-p", "HEAD:f.md"], { env: ENV }).status, 126);
  g(u.klon, "config", "--unset", "remote.origin.promisor"); g(u.klon, "config", "--unset", "remote.origin.partialclonefilter");
  // ohne die Marker eines Partial Clones läuft git-sicher wieder (der Blob fehlt, git scheitert selbst — nicht mit 126)
  assert.notEqual(spawnSync(SICHER, ["-C", u.klon, "cat-file", "-p", "HEAD:f.md"], { env: ENV }).status, 126);
  // jeder einzelne Marker eines Partial Clones sperrt (auch die ältere Form extensions.partialclone)
  for (const [k, w] of [["remote.origin.promisor", "true"], ["remote.origin.partialclonefilter", "blob:none"], ["extensions.partialclone", "origin"]]) {
    g(u.klon, "config", k, w);
    assert.equal(spawnSync(SICHER, ["-C", u.klon, "status", "--porcelain"], { env: ENV }).status, 126, k);
    g(u.klon, "config", "--unset", k);
  }
  // und GIT_NO_LAZY_FETCH steht im Skript (zweite Verteidigung)
  assert.match(readFileSync(SICHER, "utf8"), /GIT_NO_LAZY_FETCH=1/);
  // ssh: GIT_SSH_COMMAND gilt immer (hier für einen lesenden Befehl): der Wert ist der Standard, nicht der aus dem Vault
  assert.match(readFileSync(SICHER, "utf8"), /GIT_SSH_COMMAND="ssh -o BatchMode=yes"/);
});

test("core.worktree / .git-Datei mit gitdir: nach außen: reset --hard, merge, mv, worktree add schreiben nirgends außerhalb — git-sicher verweigert", () => {
  const s = neuerVault();
  // (a) core.worktree zeigt auf einen fremden Ordner mit Dateien
  const fremd = join(s.basis, "fremd"); mkdirSync(fremd); writeFileSync(join(fremd, "wichtig.md"), "fremd\n");
  g(s.v, "config", "core.worktree", fremd);
  for (const sub of [["reset", "--hard", "HEAD"], ["checkout", "--", "."], ["status", "--porcelain"], ["mv", "a", "b"], ["worktree", "add", join(s.basis, "w")]]) {
    const r = spawnSync(SICHER, ["-C", s.v, ...sub], { env: ENV, encoding: "utf8" });
    assert.equal(r.status, 126, `core.worktree ${sub[0]}: ${r.status} ${r.stderr}`);
  }
  assert.equal(readFileSync(join(fremd, "wichtig.md"), "utf8"), "fremd\n");
  // (b) .git als Datei mit gitdir: nach außen — ein fremdes Repo X würde zurückgesetzt
  const x = join(s.basis, "X"); mkdirSync(x); g(x, "init", "-q", "-b", "main");
  writeFileSync(join(x, "z.md"), "1\n"); g(x, "add", "--", "z.md"); g(x, "commit", "-q", "-m", "eins");
  writeFileSync(join(x, "z.md"), "2\n"); g(x, "add", "--", "z.md"); g(x, "commit", "-q", "-m", "zwei");
  const vor = g(x, "rev-parse", "HEAD").trim();
  const e = join(s.basis, "Eingang"); mkdirSync(e);
  writeFileSync(join(e, ".git"), `gitdir: ${join(x, ".git")}\n`);
  // Kontrolle: einfaches git setzt das fremde Repo X zurück (und den Ordner Eingang auf dessen Stand)
  g(e, "reset", "-q", "--hard", "HEAD~1");
  assert.notEqual(g(x, "rev-parse", "HEAD").trim(), vor, "Kontrolle: git schrieb in das fremde Repo");
  g(x, "reset", "-q", "--hard", vor);
  for (const sub of [["reset", "--hard", "HEAD~1"], ["merge", "--ff-only", "HEAD"], ["mv", "z.md", "y.md"], ["worktree", "add", join(s.basis, "w3")], ["status", "--porcelain"]]) {
    const r = spawnSync(SICHER, ["-C", e, ...sub], { env: ENV, encoding: "utf8" });
    assert.equal(r.status, 126, `gitdir nach außen ${sub[0]}: ${r.status} ${r.stderr}`);
  }
  assert.equal(g(x, "rev-parse", "HEAD").trim(), vor, "das fremde Repo blieb unberührt");
  assert.equal(readFileSync(join(x, "z.md"), "utf8"), "2\n");
  // (c) ein normaler Vault und ein Unterordner davon laufen weiter
  assert.equal(spawnSync(SICHER, ["-C", s.v, "-c", "core.worktree=", "status", "--porcelain"], { env: ENV }).status === 126, true, "core.worktree bleibt gesperrt");
  const t = neuerVault();
  assert.equal(spawnSync(SICHER, ["-C", t.v, "status", "--porcelain"], { env: ENV }).status, 0);
  assert.equal(spawnSync(SICHER, ["-C", join(t.v, "09_wiki"), "rev-parse", "--show-toplevel"], { env: ENV }).status, 0, "ein Unterordner des Vaults ist erlaubt");
});

test("Arbeitskopien des Tageslaufs (verknüpfte Arbeitsbäume unter dem Cache-Ordner) laufen; ein verknüpfter Arbeitsbaum anderswo nicht", () => {
  const s = neuerVault();
  const cache = join(s.basis, "cache"); mkdirSync(cache);
  const kopie = join(cache, "lauf1");
  g(s.v, "worktree", "add", "-q", "-b", "tageslauf/x", kopie, "main");
  const mit = { ...ENV, BRAIN_TAGESLAUF_CACHE: cache };
  assert.equal(spawnSync(SICHER, ["-C", kopie, "status", "--porcelain"], { env: mit }).status, 0, "Kopie im Cache-Ordner");
  assert.equal(spawnSync(SICHER, ["-C", kopie, "status", "--porcelain"], { env: ENV }).status, 126, "ohne den Cache-Ordner ist es ein verknüpfter Arbeitsbaum anderswo");
  const anderswo = join(s.basis, "anderswo"); g(s.v, "worktree", "add", "-q", "-b", "tageslauf/y", anderswo, "main");
  assert.equal(spawnSync(SICHER, ["-C", anderswo, "status", "--porcelain"], { env: mit }).status, 126, "verknüpfter Arbeitsbaum außerhalb des Cache-Ordners");
});

test("BRAIN_GIT_PROGRAMM und BRAIN_GIT_HOOKS_ERLAUBT gelten nur in der Testumgebung", () => {
  const s = neuerVault();
  const ohneTest = { ...ENV }; delete ohneTest.KORTEX_KERN_UNSTABIL_ERLAUBT; delete ohneTest.BRAIN_TESTMODUS;
  // ein Programm, das eine Marke schreibt, als „git“ untergeschoben: in der Produktivumgebung wird es nicht benutzt
  const falsch = s.programm("falsches-git.sh", "exit 0");
  const r = spawnSync(SICHER, ["-C", s.v, "status", "--porcelain"], { env: { ...ohneTest, BRAIN_GIT_PROGRAMM: falsch }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(s.marken(), [], "BRAIN_GIT_PROGRAMM wurde ausgewertet");
  const mitTest = spawnSync(SICHER, ["-C", s.v, "status", "--porcelain"], { env: { ...ENV, KORTEX_KERN_UNSTABIL_ERLAUBT: "1", BRAIN_GIT_PROGRAMM: falsch }, encoding: "utf8" });
  assert.ok(s.marken().includes("falsches-git.sh"), "in der Testumgebung gilt es");
  void mitTest; s.weg();
  // Hook-Ordner aus der Umgebung
  const eigene = join(s.v, "eigene-hooks"); mkdirSync(eigene);
  const hook = join(eigene, "pre-commit"); writeFileSync(hook, `#!/bin/sh\necho hook >> '${s.marke}'\n`); chmodSync(hook, 0o755);
  g(s.v, "config", "core.hooksPath", eigene);
  writeFileSync(join(s.v, "a.md"), "a\n"); g(s.v, "add", "--", "a.md");
  assert.equal(spawnSync(SICHER, ["-C", s.v, "commit", "-q", "-m", "a"], { env: { ...ohneTest, BRAIN_GIT_HOOKS_ERLAUBT: eigene } }).status, 0);
  assert.deepEqual(s.marken(), [], "BRAIN_GIT_HOOKS_ERLAUBT wurde in der Produktivumgebung ausgewertet");
});

test("Ordnernamen aus brain.config.json: nur ein einzelnes relatives Segment; '../aussen' fällt auf den Standard, nichts landet draußen", () => {
  const s = neuerVault();
  const aussen = join(s.basis, "aussen"); mkdirSync(aussen);
  const cfgDatei = join(s.v, "brain.config.json");
  const cfg = JSON.parse(readFileSync(cfgDatei, "utf8"));
  cfg.ordner = { wiki: "../aussen", inbox: "/tmp/absolut", archiv: "a/b" };
  cfg.wiki = { ...(cfg.wiki || {}), ordner: "../aussen" };
  writeFileSync(cfgDatei, JSON.stringify(cfg));
  for (const a of [["status", "--json"], ["index"], ["lint"], ["gesundheit", "--json"], ["pflege"]]) kern(s.v, a);
  assert.deepEqual(readdirSync(aussen), [], "außerhalb des Vaults wurde geschrieben");
  assert.deepEqual(readdirSync(s.basis).sort(), ["Vault_Eins", "aussen"].sort(), "neben dem Vault entstand nichts");
  assert.ok(!existsSync(join(s.basis, "absolut")));
});

test(".logs (und andere Schreibziele) als Verweis nach außen: der Ordner gilt nicht als Vault, Befehle enden mit Exit 2, Hooks still mit Exit 0, nichts wird draußen geschrieben", () => {
  for (const ziel of [".logs", "AGENTS.md", "graph.json", "09_wiki"]) {
    const s = neuerVault();
    const aussen = join(s.basis, "aussen"); mkdirSync(aussen);
    const innen = join(s.v, ziel);
    rmSync(innen, { recursive: true, force: true });
    symlinkSync(ziel.includes(".") && !ziel.startsWith(".") ? join(aussen, "datei") : aussen, innen);
    for (const a of [["status", "--json"], ["gesundheit", "--json"], ["index"], ["pflege"]]) {
      const r = kern(s.v, a);
      assert.equal(r.status, 2, `${ziel}: brain ${a[0]} erwartet Exit 2, war ${r.status} (${r.stderr})`);
      assert.match(String(r.stderr), /zeigt aus dem Ordner hinaus/, ziel);
    }
    const hook = spawnSync(NODE, [join(KERN, "adapters", "claude-code", "session-start.mjs")], { input: "{}", encoding: "utf8", env: { ...ENV, BRAIN_VAULT: s.v }, timeout: 60_000 });
    assert.equal(hook.status, 0, `${ziel}: Hook endet still mit Exit 0`);
    assert.deepEqual(readdirSync(aussen), [], `${ziel}: außerhalb des Vaults wurde geschrieben`);
  }
});
