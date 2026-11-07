// test-git-sicher-node.mjs — die Vertrauensschranke vor git in Node (git-sicher.mjs) und ihr Windows-Starter. Läuft auf macOS, Linux UND Windows (blockierend in der CI).
//
// Dieselben Fälle laufen gegen jede Fassung der Schranke, die es auf dem System gibt:
//   node   `node git-sicher.mjs …`                       überall
//   sh     das Shell-Skript git-sicher                    macOS/Linux (Gleichwertigkeit: gleiche Exit-Codes, gleiche Verweigerungen)
//   exe    der .exe-Starter aus werkzeug.mjs#gitBefehl    nur Windows (der Weg, den der Kern dort wirklich geht)
// Jedes Programm im Vault schreibt eine Marke, falls es je läuft; die Marke darf nie entstehen. Kontrollen beweisen vorher, dass sie ohne die Schranke entstünde.
// Umgebung der Kindprozesse: nur explizit gebaut (kein CLAUDE_CONFIG_DIR, CODEX_HOME, XDG_*, GIT_*; HOME/USERPROFILE im Temp-Ordner).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, writeFileSync, mkdirSync, existsSync, chmodSync, readFileSync, rmSync, symlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync, execFileSync } from "node:child_process";

const KERN = fileURLToPath(new URL("..", import.meta.url));
const WIN = process.platform === "win32";
const NODE = process.execPath;
const roh = (p) => String(p).split("\\").join("/");
const { starterFuer } = await import(pathToFileURL(join(KERN, "windows-start.mjs")).href);
const { gitBefehl } = await import(pathToFileURL(join(KERN, "werkzeug.mjs")).href);
const { supportOrdner } = await import(pathToFileURL(join(KERN, "pfade.mjs")).href);

const basis0 = realpathSync(mkdtempSync(join(tmpdir(), "gs-node-")));
const heim = join(basis0, "heim"); mkdirSync(heim);
const support = join(basis0, "support"); mkdirSync(support);

function umgebung(extra = {}) {
  const e = { ...process.env };
  for (const k of Object.keys(e)) if (/^(GIT_|XDG_|CLAUDE_CONFIG_DIR$|CODEX_HOME$|BRAIN_|KORTEX_)/i.test(k)) delete e[k];
  return { ...e, GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.org", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.org",
    HOME: heim, USERPROFILE: heim, BRAIN_APP_SUPPORT: support, KORTEX_KERN_UNSTABIL_ERLAUBT: "1", ...extra };
}
const ENV = umgebung();
const g = (cwd, ...a) => execFileSync("git", a, { cwd, env: ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

const VARIANTEN = [{ name: "node", cmd: NODE, pre: [join(KERN, "git-sicher.mjs")] }];
if (!WIN) VARIANTEN.push({ name: "sh", cmd: join(KERN, "git-sicher"), pre: [] });
if (WIN) VARIANTEN.push({ name: "exe", cmd: starterFuer("git-sicher", { support }), pre: [] });

// Ein Vault (Name mit Leerzeichen, &, %, ^ — die Zeichen, die eine .cmd umdeuten würde) mit einem Commit; eine Marke, die jedes Vault-Programm schreibt.
function neuerVault(ordnerName = "Vault & 50% ^x (1)") {
  const basis = realpathSync(mkdtempSync(join(tmpdir(), "gs-")));
  const v = join(basis, ordnerName);
  mkdirSync(v);
  g(v, "init", "-q", "-b", "main");
  writeFileSync(join(v, "a.md"), "a\n");
  g(v, "add", "--", ".");
  g(v, "commit", "-q", "-m", "Start");
  const marke = join(basis, "MARKE.txt");
  const befehl = (n = "evil") => `echo ${n} >> '${roh(marke)}'`; // läuft in der sh von git (auch unter Windows: Git for Windows)
  const skript = (name, ort = v) => { const p = join(ort, name); writeFileSync(p, `#!/bin/sh\n${befehl(name)}\n`); chmodSync(p, 0o755); return p; };
  return { basis, v, marke, befehl, skript, marken: () => (existsSync(marke) ? readFileSync(marke, "utf8").split("\n").filter(Boolean) : []), weg: () => rmSync(marke, { force: true }) };
}
const lauf = (variante, args, { env = ENV, cwd, input } = {}) => spawnSync(variante.cmd, [...variante.pre, ...args], { env, cwd, input, encoding: "utf8", windowsHide: true, timeout: 90_000 });

for (const variante of VARIANTEN) {
  const t = (name, fn) => test(`[${variante.name}] ${name}`, () => fn((args, o) => lauf(variante, args, o)));

  t("Kontrolle: ohne die Schranke schreiben fsmonitor und ein Hook im Vault Marken", () => {
    const s = neuerVault();
    g(s.v, "config", "core.fsmonitor", s.befehl("fsmonitor"));
    execFileSync("git", ["-C", s.v, "status", "--porcelain"], { env: ENV, stdio: "ignore", windowsHide: true });
    assert.ok(s.marken().some((m) => m.startsWith("fsmonitor")), `fsmonitor lief nicht: ${JSON.stringify(s.marken())}`);
    const h = s.skript("pre-commit", join(s.v, ".git", "hooks"));
    writeFileSync(join(s.v, "b.md"), "b\n"); g(s.v, "add", "--", "b.md");
    g(s.v, "commit", "-q", "-m", "b");
    assert.ok(s.marken().some((m) => m === "pre-commit"), `Hook lief nicht: ${JSON.stringify(s.marken())} (${h})`);
  });

  t("ein normaler Vault läuft: status, log, add, commit, Ausgabe und Exit-Code wie bei git", (sicher) => {
    const s = neuerVault();
    assert.equal(sicher(["-C", s.v, "status", "--porcelain"]).status, 0);
    const log = sicher(["-C", s.v, "log", "-1", "--format=%s"]);
    assert.equal(log.status, 0); assert.equal(log.stdout.trim(), "Start");
    writeFileSync(join(s.v, "neu.md"), "neu\n");
    assert.equal(sicher(["-C", s.v, "add", "--", "neu.md"]).status, 0);
    assert.equal(sicher(["-C", s.v, "commit", "-q", "-m", "neu"]).status, 0);
    assert.equal(g(s.v, "log", "-1", "--format=%s").trim(), "neu");
    // der Exit-Code des echten git wird durchgereicht (128: unbekannte Revision)
    assert.equal(sicher(["-C", s.v, "rev-parse", "--verify", "gibt-es-nicht"]).status, 128);
  });

  t("gefährliche Programm-Schlüssel der .git/config: Exit 126 mit dem Namen (nie dem Wert), nichts läuft", (sicher) => {
    const schluessel = ["core.fsmonitor", "core.sshCommand", "filter.x.clean", "diff.x.textconv", "merge.x.driver", "credential.helper", "core.pager", "core.editor", "core.gitProxy",
      "gpg.program", "remote.o.uploadpack", "http.proxy", "man.x.cmd", "submodule.s.update", "include.path", "alias.st", "url.https://evil.example/.insteadOf", "core.worktree"];
    for (const k of schluessel) {
      const s = neuerVault();
      const wert = k === "include.path" ? "../x" : k === "http.proxy" ? "http://evil.example" : k.endsWith("insteadOf") ? "https://x.example/" : k === "core.worktree" ? "C:/nirgends" : s.befehl("evil");
      g(s.v, "config", k, wert);
      for (const sub of [["status", "--porcelain"], ["log", "-1"], ["fetch", "--quiet"]]) {
        const r = sicher(["-C", s.v, ...sub]);
        assert.equal(r.status, 126, `${k} (${sub[0]}): Exit ${r.status} ${r.stderr}`);
        assert.match(r.stderr, /Erlaubnisliste/, k);
        assert.ok(!r.stderr.includes("echo evil"), `${k}: der Wert steht in der Meldung`);
      }
      assert.deepEqual(s.marken(), [], `${k}: ein Programm lief`);
    }
  });

  t("remote.*.url: lokaler Pfad und ext:: nur verboten, https/ssh erlaubt (Produktion)", (sicher) => {
    const s = neuerVault();
    const ohneTest = umgebung(); delete ohneTest.KORTEX_KERN_UNSTABIL_ERLAUBT;
    g(s.v, "remote", "add", "web", "https://example.org/u/r.git");
    assert.equal(sicher(["-C", s.v, "remote", "-v"], { env: ohneTest }).status, 0);
    g(s.v, "config", "remote.web.url", "ext::sh -c evil");
    assert.equal(sicher(["-C", s.v, "remote", "-v"], { env: ohneTest }).status, 126);
    g(s.v, "config", "remote.web.url", roh(join(s.basis, "irgendwo.git")));
    assert.equal(sicher(["-C", s.v, "remote", "-v"], { env: ohneTest }).status, 126, "lokaler Pfad: nur in der Testumgebung");
    assert.equal(sicher(["-C", s.v, "remote", "-v"]).status, 0, "Testumgebung: erlaubt");
  });

  t("Hooks: nur der Hook-Ordner des Kerns (und, im Test, ausdrücklich erlaubte) läuft; .git/hooks und Pfade aus dem Vault nie", (sicher) => {
    const s = neuerVault();
    s.skript("pre-commit", join(s.v, ".git", "hooks"));
    const eigene = join(s.v, "eigene-hooks"); mkdirSync(eigene); s.skript("pre-commit", eigene);
    writeFileSync(join(s.v, "b.md"), "b\n"); g(s.v, "add", "--", "b.md");
    assert.equal(sicher(["-C", s.v, "commit", "-q", "-m", "b"]).status, 0);
    assert.deepEqual(s.marken(), [], "Hook aus .git/hooks lief");
    g(s.v, "config", "core.hooksPath", roh(eigene));
    writeFileSync(join(s.v, "c.md"), "c\n"); g(s.v, "add", "--", "c.md");
    assert.equal(sicher(["-C", s.v, "commit", "-q", "-m", "c"]).status, 0);
    assert.deepEqual(s.marken(), [], "Hook aus dem Vault lief");
    writeFileSync(join(s.v, "d.md"), "d\n"); g(s.v, "add", "--", "d.md");
    assert.equal(sicher(["-C", s.v, "commit", "-q", "-m", "d"], { env: umgebung({ BRAIN_GIT_HOOKS_ERLAUBT: eigene }) }).status, 0);
    assert.deepEqual(s.marken(), ["pre-commit"], "ausdrücklich erlaubter Ordner (nur Testumgebung)");
    // ohne Testschalter gilt BRAIN_GIT_HOOKS_ERLAUBT nicht
    s.weg();
    writeFileSync(join(s.v, "e.md"), "e\n"); g(s.v, "add", "--", "e.md");
    const prod = umgebung({ BRAIN_GIT_HOOKS_ERLAUBT: eigene }); delete prod.KORTEX_KERN_UNSTABIL_ERLAUBT;
    assert.equal(sicher(["-C", s.v, "commit", "-q", "-m", "e"], { env: prod }).status, 0);
    assert.deepEqual(s.marken(), [], "ohne Testumgebung zählt BRAIN_GIT_HOOKS_ERLAUBT nicht");
    // der Hook-Ordner des Kerns selbst ist erlaubt: config liest die echte Einstellung
    g(s.v, "config", "core.hooksPath", roh(join(KERN, "git-hooks")));
    assert.equal(roh(sicher(["-C", s.v, "config", "core.hooksPath"]).stdout.trim()), roh(join(KERN, "git-hooks")));
  });

  t("fail-closed: kein Repository, help, submodule, alternates, Arbeitsbaum/Git-Verzeichnis nach außen, Verweis im Git-Verzeichnis → Exit 126", (sicher) => {
    const s = neuerVault();
    const leer = join(s.basis, "kein-repo"); mkdirSync(leer);
    assert.equal(sicher(["-C", leer, "status"]).status, 126, "kein Repository");
    assert.equal(sicher(["-C", s.v, "help", "log"]).status, 126);
    assert.equal(sicher(["-C", s.v, "submodule", "status"]).status, 126);
    assert.equal(sicher(["-C", leer, "init", "-q"]).status, 0, "init in einen neuen Ordner");
    // alternates
    const a = neuerVault();
    mkdirSync(join(a.v, ".git", "objects", "info"), { recursive: true });
    writeFileSync(join(a.v, ".git", "objects", "info", "alternates"), roh(join(s.v, ".git", "objects")) + "\n");
    const ra = sicher(["-C", a.v, "status", "--porcelain"]);
    assert.equal(ra.status, 126); assert.match(ra.stderr, /alternates/);
    // .git als Datei mit gitdir: nach außen
    const x = neuerVault();
    const e = join(s.basis, "Eingang"); mkdirSync(e);
    writeFileSync(join(e, ".git"), `gitdir: ${roh(join(x.v, ".git"))}\n`);
    const vor = g(x.v, "rev-parse", "HEAD").trim();
    for (const sub of [["reset", "--hard", "HEAD"], ["status", "--porcelain"], ["worktree", "add", join(s.basis, "w3")]]) {
      const r = sicher(["-C", e, ...sub]);
      assert.equal(r.status, 126, `gitdir nach außen ${sub[0]}: ${r.status} ${r.stderr}`);
    }
    assert.equal(g(x.v, "rev-parse", "HEAD").trim(), vor);
    // Verweis im Git-Verzeichnis (Windows: braucht das Recht für Verweise; fehlt es, entfällt dieser Teil)
    const l = neuerVault();
    let verweisOk = true;
    try { symlinkSync(l.basis, join(l.v, ".git", "verweis"), "dir"); } catch { verweisOk = false; }
    if (verweisOk) { const r = sicher(["-C", l.v, "status", "--porcelain"]); assert.equal(r.status, 126, r.stderr); assert.match(r.stderr, /Verweis/); }
    // ein Unterordner des Vaults ist erlaubt
    mkdirSync(join(s.v, "unter"));
    assert.equal(sicher(["-C", join(s.v, "unter"), "rev-parse", "--show-toplevel"]).status, 0);
  });

  t("geerbtes GIT_DIR und GIT_CONFIG_* wirken nicht (kein eingeschleuster Hook, kein fremdes Repository)", (sicher) => {
    const s = neuerVault(), u = neuerVault();
    const fremd = join(u.basis, "fremd-hooks"); mkdirSync(fremd); u.skript("pre-commit", fremd);
    const eingeschleust = umgebung({ GIT_DIR: join(s.v, ".git"), GIT_WORK_TREE: s.v, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.hooksPath", GIT_CONFIG_VALUE_0: roh(fremd),
      GIT_CONFIG_PARAMETERS: `'core.hooksPath'='${roh(fremd)}'`, BRAIN_GIT_HOOKS_ERLAUBT: fremd });
    const top = sicher(["-C", u.v, "rev-parse", "--show-toplevel"], { env: eingeschleust });
    assert.equal(roh(realpathSync.native(top.stdout.trim())).toLowerCase(), roh(realpathSync.native(u.v)).toLowerCase(), "GIT_DIR/GIT_WORK_TREE wurden verworfen");
    writeFileSync(join(u.v, "a2.md"), "a\n"); g(u.v, "add", "--", "a2.md");
    assert.equal(sicher(["-C", u.v, "commit", "-q", "-m", "a"], { env: eingeschleust }).status, 0);
    assert.deepEqual(u.marken(), [], "eingeschleuste Konfiguration (GIT_CONFIG_*) hat Hooks aktiviert");
  });

  t("config und version laufen unverändert; kein git → Exit 127; BRAIN_GIT_PROGRAMM nur in der Testumgebung", (sicher) => {
    const s = neuerVault();
    g(s.v, "config", "filter.x.clean", s.befehl("evil"));
    assert.equal(sicher(["-C", s.v, "config", "filter.x.clean"]).status, 0, "config darf immer lesen");
    assert.match(sicher(["--version"]).stdout, /^git version /);
    const ohne = sicher(["-C", s.v, "status"], { env: umgebung({ BRAIN_GIT_PROGRAMM: join(s.basis, "gibt-es-nicht") }) });
    assert.equal(ohne.status, 127, ohne.stderr);
    // Schein-git in der Produktionsumgebung: BRAIN_GIT_PROGRAMM wird ignoriert, es läuft das echte git
    const schein = join(s.basis, WIN ? "schein.cmd" : "schein"); writeFileSync(schein, WIN ? `@echo off\r\necho schein>>"${s.marke}"\r\n` : `#!/bin/sh\n${s.befehl("schein")}\n`); chmodSync(schein, 0o755);
    const prod = umgebung({ BRAIN_GIT_PROGRAMM: schein }); delete prod.KORTEX_KERN_UNSTABIL_ERLAUBT;
    sicher(["-C", s.v, "status", "--porcelain"], { env: prod });
    assert.deepEqual(s.marken(), [], "BRAIN_GIT_PROGRAMM galt ohne Testumgebung");
  });

  t("Arbeitskopien des Tageslaufs (verknüpfte Arbeitsbäume unter dem Test-Cache) laufen; anderswo nicht", (sicher) => {
    const s = neuerVault();
    const cache = join(s.basis, "cache"); mkdirSync(cache);
    const kopie = join(cache, "lauf1");
    g(s.v, "worktree", "add", "-q", "-b", "tageslauf/x", kopie, "main");
    assert.equal(sicher(["-C", kopie, "status", "--porcelain"], { env: umgebung({ BRAIN_TAGESLAUF_CACHE: cache }) }).status, 0, "Kopie im Cache-Ordner");
    assert.equal(sicher(["-C", kopie, "status", "--porcelain"]).status, 126, "ohne den Cache-Ordner ist es ein verknüpfter Arbeitsbaum anderswo");
  });
}

// ───────────── Windows: der Starter und die Auswahl durch gitBefehl ─────────────
// Programm-Attrappe: Windows nur als Starter (.exe + .ini auf ein Node-Skript), sonst ein ausführbares Node-Skript. Sie schreibt ihre Argumente als JSON-Zeile in die Marke und
// reicht dann an das echte git weiter.
function scheinGit(basis, marke) {
  const skript = join(basis, "schein-git.mjs");
  writeFileSync(skript, `import { appendFileSync } from "node:fs"; import { spawnSync } from "node:child_process";
appendFileSync(${JSON.stringify(marke)}, JSON.stringify(process.argv.slice(2)) + "\\n");
const r = spawnSync("git", process.argv.slice(2), { stdio: "inherit", windowsHide: true });
process.exitCode = r.status ?? 1;\n`);
  if (WIN) return starterFuer("schein-git", { support: join(basis, "schein-support"), skript });
  const p = join(basis, "schein-git"); writeFileSync(p, `#!/bin/sh\nexec '${NODE}' '${skript}' "$@"\n`); chmodSync(p, 0o755); return p;
}

test("Quoting: Argumente mit Leerzeichen, %, ^, &, |, <, >, \", Rückstrichen und Umlauten kommen unverändert am echten git an", () => {
  const s = neuerVault();
  const schein = scheinGit(s.basis, s.marke);
  const argumente = ["a b", "50%", "%PATH%", "%TMP%\\x", "^&|<>", "a&b", 'say "hi"', "back\\", "zwei\\\\", 'q\\"', "tab\there", "ü ä", "(x)", "!x!", "--", "x=y z", ""];
  for (const variante of VARIANTEN) {
    s.weg();
    const r = lauf(variante, ["-C", s.v, "status", "--porcelain", "--", ...argumente], { env: umgebung({ BRAIN_GIT_PROGRAMM: schein }) });
    // das leere Argument ist für git ein ungültiger Pfadausdruck (Exit 128): hier zählt, dass es als leeres Argument ankommt
    assert.equal(r.status, 128, `${variante.name}: ${r.stderr}`);
    const aufrufe = s.marken().map((z) => JSON.parse(z));
    const ende = aufrufe.find((a) => a.includes("status") && a.includes("--porcelain") && a.includes("--") && a.length > argumente.length);
    assert.ok(ende, `${variante.name}: kein status-Aufruf in ${JSON.stringify(aufrufe).slice(0, 400)}`);
    assert.deepEqual(ende.slice(-argumente.length), argumente, `${variante.name}: Argumente verändert`);
    assert.ok(ende.includes("core.hooksPath=/dev/null"), `${variante.name}: Härtung fehlt`);
    assert.ok(aufrufe.some((a) => a.includes(s.v)), `${variante.name}: -C mit Sonderzeichen im Pfad kam nicht an`);
  }
});

test("stdin, stdout, stderr und Exit-Code gehen unverändert durch (hash-object --stdin, unbekannte Revision)", () => {
  const s = neuerVault();
  const erwartet = execFileSync("git", ["-C", s.v, "hash-object", "--stdin"], { input: "Inhalt ü\n", env: ENV, encoding: "utf8", windowsHide: true });
  for (const variante of VARIANTEN) {
    const r = lauf(variante, ["-C", s.v, "hash-object", "--stdin"], { input: "Inhalt ü\n" });
    assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout, erwartet, variante.name);
    const f = lauf(variante, ["-C", s.v, "rev-parse", "--verify", "gibt-es-nicht"]);
    assert.equal(f.status, 128, variante.name); assert.ok(f.stderr.length > 0, "stderr kommt an");
  }
});

test("Windows: gitBefehl liefert den Starter (git-sicher.exe), ohne Vertrauen git-gesperrt.exe: Exit 126, kein git, --version harmlos", { skip: WIN ? false : "nur Windows" }, () => {
  const s = neuerVault("Vault"); // schlichter Name: hier zählt der Starter, nicht die Pfadregeln für Vault-Namen
  cpSync(join(KERN, "tests", "fixture"), s.v, { recursive: true }); // ein richtiger Vault (brain.config.json, Ordner), sonst findet vaultPfad ihn nicht
  const env = umgebung({ BRAIN_VAULT: s.v });
  const lesen = (code) => { const r = spawnSync(NODE, ["--input-type=module", "-e",
    `import { vaultPfad } from ${JSON.stringify(pathToFileURL(join(KERN, "pfade.mjs")).href)}; import { gitBefehl } from ${JSON.stringify(pathToFileURL(join(KERN, "werkzeug.mjs")).href)}; ${code}`], { encoding: "utf8", env }); assert.ok(r.stdout, `keine Ausgabe: ${r.stderr}`); return r.stdout; };
  const sicher = lesen(`process.stdout.write(gitBefehl({ ohneVault: true }));`);
  assert.match(sicher, /git-sicher\.exe$/); assert.ok(existsSync(sicher) && existsSync(`${sicher}.ini`));
  assert.ok(roh(sicher).toLowerCase().startsWith(roh(support).toLowerCase()), "der Starter liegt im Support-Ordner");
  const gesperrt = lesen(`process.stdout.write(gitBefehl());`);
  assert.match(gesperrt, /git-gesperrt\.exe$/, "kein Vault geprüft: gesperrt");
  assert.match(lesen(`vaultPfad(["", ""]); process.stdout.write(gitBefehl());`), /git-gesperrt\.exe$/, "Vault nicht vertraut");
  const r = spawnSync(gesperrt, ["-C", s.v, "status"], { encoding: "utf8", env });
  assert.equal(r.status, 126); assert.match(r.stderr, /noch nicht als deiner bestätigt/);
  assert.equal(spawnSync(gesperrt, ["--version"], { encoding: "utf8", env }).status, 0);
  // der Starter ohne .ini startet nichts
  const ohneIni = join(s.basis, "ohne-ini.exe"); writeFileSync(ohneIni, readFileSync(sicher));
  assert.equal(spawnSync(ohneIni, ["--version"], { encoding: "utf8" }).status, 125);
});

test("gitBefehl (plattform win32 auf jedem System): Name und Ort — Starter im Support-Ordner, nie der nackte Name 'git'", () => {
  const p = gitBefehl({ plattform: "win32", home: heim, ohneVault: true });
  assert.match(roh(p), /\/git-sicher\/[^/]+\/git-sicher\.exe$|\/git-sicher\/nicht-verfuegbar\/git-sicher\.exe$/);
  assert.ok(roh(p).startsWith(roh(join(supportOrdner({ home: heim, plattform: "win32" }), "git-sicher"))), p);
});

// Git for Windows könnte "core.hooksPath=/dev/null" als <aktuelles Laufwerk>:\dev\null\<hook> auflösen (Befund des Reviews zu PR #117). Ein Hook dort darf nie laufen.
// (Die Werkstatt prüft Tests/Node/hooks-pfad-windows.test.mjs.)
test("Windows: ein Hook unter <Laufwerk>:\\dev\\null\\ läuft nie (Kern über Starter und über node)", { skip: WIN ? false : "nur Windows" }, () => {
  const s = neuerVault();
  const laufwerke = [...new Set([process.env.SystemDrive || "C:", s.v.slice(0, 2)].map((d) => d.toUpperCase()))];
  const angelegt = [];
  try {
    for (const d of laufwerke) {
      const wurzel = `${d}\\dev`;
      if (existsSync(wurzel)) continue; // nie etwas Vorhandenes anfassen
      mkdirSync(`${wurzel}\\null`, { recursive: true }); angelegt.push(wurzel);
      writeFileSync(`${wurzel}\\null\\pre-commit`, `#!/bin/sh\n${s.befehl(`hook-${d[0]}`)}\n`);
    }
    assert.ok(angelegt.length > 0, "kein Laufwerk, auf dem sich ein Hook-Ordner anlegen ließ");
    writeFileSync(join(s.v, "k.md"), "k\n"); g(s.v, "add", "--", "k.md");
    g(s.v, "-c", `core.hooksPath=${roh(angelegt[0])}/null`, "commit", "-q", "-m", "kontrolle");
    assert.ok(s.marken().length > 0, "Kontrolle: der Hook läuft nicht einmal, wenn er ausdrücklich gesetzt ist");
    for (const variante of VARIANTEN) {
      s.weg();
      writeFileSync(join(s.v, `${variante.name}.md`), "x\n"); g(s.v, "add", "--", `${variante.name}.md`);
      const r = lauf(variante, ["-C", s.v, "commit", "-q", "-m", variante.name]);
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(s.marken(), [], `${variante.name}: ein Hook unter ${angelegt.join(", ")}\\null lief`);
    }
  } finally {
    for (const w of angelegt) rmSync(w, { recursive: true, force: true });
  }
});
