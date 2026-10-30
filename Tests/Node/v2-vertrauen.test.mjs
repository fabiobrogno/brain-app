// Git unter Workspace-Trust (P5; Studio-v2-Spec §8 bis P4): Härtung der Git-Aufrufe (fsmonitor/diff.external/ext::), Hooks und Repo-Konfiguration nur in einem
// VERTRAUTEN Vault, ohne Vertrauen ist Git ganz gesperrt; dazu Fristen, MCP verbinden, Probe über den MCP-Server.
// Das Vertrauensmodell selbst (Merker, Migration, API) prüft vertrauen.test.mjs.
// Nur Wegwerf-Ordner in os.tmpdir(); kein Netzwerk, nie das echte `claude`, nie der echte Support-Ordner.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, chmodSync, symlinkSync, statSync, appendFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmp, schreibe, repo, g, pfad, kernAttrappe, echt } from "./hilfe.mjs";
process.env.HOME = tmp("brain-home-");          // os.homedir() liest $HOME: keine echte ~/.gitconfig
process.env.GIT_CONFIG_NOSYSTEM = "1";          // und keine System-Konfiguration

const { HttpFehler } = await import(pfad("gemeinsam", "basis.mjs"));
const V = await import(pfad("gemeinsam", "vertrauen.mjs"));
const { oeffneVault } = await import(pfad("gemeinsam", "vault.mjs"));
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
const wirft = async (p) => { try { await p; } catch (e) { assert.ok(e instanceof HttpFehler, String(e && e.stack)); return e; } assert.fail("kein Fehler"); };
// Die Suite setzt KORTEX_VAULT_VERTRAUT=alle (hilfe.mjs); diese Tests prüfen die echte Vertrauensprüfung (echt() aus hilfe.mjs stellt den Schalter auch nach einer Zeitüberschreitung wieder her).

const neuerSupport = () => tmp("brain-support-");
const KIT = `console.log(JSON.stringify({version:1,ampel:"gruen",warnungen:0,pruefungen:[]}));\n`;
const kitVault = () => { const d = tmp(); schreibe(d, "a.md", "# A\n"); schreibe(d, "brain.config.json", "{}\n"); return d; };
const aufruf = (h) => async (methode, p, daten, query) => {
  const r = await h({ methode, pfad: p, query: query ?? null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) });
  let j = null; try { j = JSON.parse(r.body.toString("utf8")); } catch { /* statisch */ }
  return { ...r, j };
};

// ───────────────────────────── Git ohne Vertrauen ─────────────────────────────

const { git, gitUmgebung } = await import(pfad("gemeinsam", "git.mjs"));
const skript = (inhalt) => { const p = join(tmp("brain-skript-"), "s.sh"); writeFileSync(p, `#!/bin/sh\n${inhalt}\n`); chmodSync(p, 0o755); return p; };
const konfig = (d, text) => appendFileSync(join(d, ".git", "config"), text); // roh angehängt: so kommt eine fremde .git/config an
const mitSupport = (d, support = neuerSupport(), extra = {}) => oeffneVault(d, { support, ...extra });
const filterKonfig = (marke) => `[filter "probe"]\n\tclean = "sh -c 'touch ${marke}; cat'"\n`; // ohne Anführungszeichen risse „;“ den Wert als Kommentar ab

test("Härtung: fsmonitor- und diff.external-Befehl aus .git/config laufen NICHT (notizen, status, diff, verlauf, log) — Probe p2", async () => {
  const d = repo();
  const m1 = join(tmp("brain-marke-"), "FSMONITOR"), m2 = join(tmp("brain-marke-"), "EXTDIFF"), m3 = join(tmp("brain-marke-"), "TEXTCONV");
  const fsm = skript(`touch '${m1}'\nexit 1`), ext = skript(`touch '${m2}'`), txt = skript(`touch '${m3}'\ncat "$1"`);
  schreibe(d, ".gitattributes", "*.md diff=probe\n"); g(d, "add", "--", ".gitattributes"); g(d, "commit", "-q", "-m", "Attribute");
  konfig(d, `[core]\n\tfsmonitor = ${fsm}\n[diff]\n\texternal = ${ext}\n[diff "probe"]\n\ttextconv = ${txt}\n`);
  writeFileSync(join(d, "start.md"), "# Start\nneu\n");
  // Vorprobe: ohne unsere Härtung liefen alle drei (sonst beweist der Test nichts)
  const roh = (...a) => { try { execFileSync("git", a, { cwd: d, stdio: "ignore", env: { ...process.env, GIT_PAGER: "cat" } }); } catch { /* egal */ } };
  roh("diff", "HEAD", "--", "start.md"); roh("diff", "--no-ext-diff", "HEAD", "--", "start.md"); roh("status", "--porcelain");
  assert.ok(existsSync(m1) && existsSync(m2) && existsSync(m3), "Vorprobe: fsmonitor, diff.external und textconv laufen bei einem ungehärteten git");
  for (const m of [m1, m2, m3]) rmSync(m);
  const v = mitSupport(d);
  await v.notizen(); await v.gitStatus(); await v.gitDiff("start.md"); await v.gitVerlauf("start.md"); await v.gitLog();
  const sha = g(d, "rev-parse", "HEAD").trim();
  await v.gitDiff("start.md", sha); await v.gitFassung("start.md", sha); await v.istGitRepo();
  assert.deepEqual([existsSync(m1), existsSync(m2), existsSync(m3)], [false, false, false], "weder fsmonitor noch diff.external noch textconv");
});

test("Härtung: gitUmgebung — GIT_EDITOR und GIT_SEQUENCE_EDITOR sind „:“; GIT_SSH_COMMAND nach Vertrauen und eigener core.sshCommand", () => {
  const alt = process.env.GIT_SSH_COMMAND; delete process.env.GIT_SSH_COMMAND;
  try {
    const e = gitUmgebung();
    assert.equal(e.GIT_EDITOR, ":"); assert.equal(e.GIT_SEQUENCE_EDITOR, ":"); assert.equal(e.GIT_TERMINAL_PROMPT, "0"); assert.equal(e.GIT_LITERAL_PATHSPECS, "1");
    assert.equal(e.GIT_SSH_COMMAND, "ssh -o BatchMode=yes", "ohne Vertrauen immer unser Befehl");
    assert.equal(gitUmgebung({ vertraut: false, sshEigen: true }).GIT_SSH_COMMAND, "ssh -o BatchMode=yes", "ohne Vertrauen übersteuert unser Befehl auch eine core.sshCommand");
    assert.equal(gitUmgebung({ vertraut: true, sshEigen: false }).GIT_SSH_COMMAND, "ssh -o BatchMode=yes");
    assert.equal(gitUmgebung({ vertraut: true, sshEigen: true }).GIT_SSH_COMMAND, undefined, "mit Vertrauen und eigener core.sshCommand setzen wir nichts");
    process.env.GIT_SSH_COMMAND = "mein-ssh -x";
    assert.equal(gitUmgebung().GIT_SSH_COMMAND, "mein-ssh -x", "eine GIT_SSH_COMMAND des Nutzers bleibt");
  } finally { if (alt === undefined) delete process.env.GIT_SSH_COMMAND; else process.env.GIT_SSH_COMMAND = alt; }
});

test("Härtung: ext::-Transport ist bei jedem Aufruf aus (protocol.ext.allow=never), auch wenn die Vault-Konfiguration ihn erlaubt", async () => {
  const d = repo();
  const marke = join(tmp("brain-marke-"), "EXT");
  konfig(d, "[protocol \"ext\"]\n\tallow = always\n");
  const r = await git(d, ["ls-remote", `ext::sh -c "touch ${marke}" x`]);
  assert.notEqual(r.code, 0); assert.equal(existsSync(marke), false);
});

test("Hooks: in einem vertrauten Vault laufen nur .git/hooks und die Hooks des Kerns; ein Hook-Ordner im Arbeitsbaum (core.hooksPath=.tools/git-hooks) läuft nie — auch nicht, wenn ein Abgleich ihn austauscht; ohne Vertrauen ist Git ganz gesperrt", () => echt(async () => {
  const d = repo();
  const marke = join(tmp("brain-marke-"), "HOOK");
  const hook = (rel, name) => { schreibe(d, rel, `#!/bin/sh\necho ${name} >> '${marke}'\nexit 0\n`); chmodSync(join(d, rel), 0o755); };
  hook(".git/hooks/pre-commit", "x"); hook(".tools/git-hooks/pre-commit", "y");
  const kern = kernAttrappe({ "git-hooks/pre-commit": `#!/bin/sh\necho kern >> '${marke}'\nexit 0\n` });
  chmodSync(join(kern, "git-hooks/pre-commit"), 0o755);
  g(d, "config", "core.hooksPath", ".tools/git-hooks");
  const support = neuerSupport();
  const v = mitSupport(d, support, { kern });
  schreibe(d, "a.md", "# a\n");
  const e = await wirft(v.gitCommit({ nachricht: "ohne Vertrauen", dateien: ["a.md"] }));
  assert.equal(e.status, 409); assert.equal(e.extra.gitGesperrt, true);
  assert.equal(existsSync(marke), false, "ohne Vertrauen kein Hook (und kein Commit)");
  v.vertrauen(true);
  assert.equal(V.gitSicht(d, { support, kern }).hooks, false, "Hook-Ordner im Arbeitsbaum: keine Hooks");
  await v.gitCommit({ nachricht: "Hook-Ordner im Arbeitsbaum", dateien: ["a.md"] });
  assert.equal(existsSync(marke), false, "der Hook aus dem Arbeitsbaum läuft nicht (auch nicht nach einem Abgleich, der ihn ausgetauscht hat)");
  // Hook-Ordner des Kerns: erlaubt
  g(d, "config", "core.hooksPath", join(kern, "git-hooks"));
  schreibe(d, "b.md", "# b\n");
  await v.gitCommit({ nachricht: "Kern-Hooks", dateien: ["b.md"] });
  assert.equal(readFileSync(marke, "utf8"), "kern\n", "die Hooks des Kerns laufen");
  // Standard: .git/hooks
  g(d, "config", "--unset", "core.hooksPath");
  schreibe(d, "c.md", "# c\n");
  await v.gitCommit({ nachricht: ".git/hooks", dateien: ["c.md"] });
  assert.equal(readFileSync(marke, "utf8"), "kern\nx\n", ".git/hooks/pre-commit läuft im vertrauten Vault");
  // .git/hooks als Verweis in den Arbeitsbaum: keine Hooks
  rmSync(join(d, ".git/hooks"), { recursive: true }); symlinkSync(join(d, ".tools/git-hooks"), join(d, ".git/hooks"));
  schreibe(d, "e.md", "# e\n");
  await v.gitCommit({ nachricht: "Verweis", dateien: ["e.md"] });
  assert.equal(readFileSync(marke, "utf8"), "kern\nx\n", "Verweis im Git-Verzeichnis: keine Hooks");
  v.vertrauen(false);
  schreibe(d, "f.md", "# f\n");
  await wirft(v.gitCommit({ nachricht: "Vertrauen entzogen", dateien: ["f.md"] }));
}));

test("Programm-Einstellung, die in den Arbeitsbaum zeigt (filter.clean, merge.driver … mit Pfad im Vault): Git bleibt gesperrt, auch im vertrauten Vault; eine Einstellung mit Programm aus dem PATH nicht", () => echt(async () => {
  const marke = join(tmp("brain-marke-"), "FILTER");
  const d = repo();
  schreibe(d, ".tools/clean.sh", `#!/bin/sh\ntouch '${marke}'\ncat\n`); chmodSync(join(d, ".tools/clean.sh"), 0o755);
  schreibe(d, ".gitattributes", "*.md filter=probe\n");
  const support = neuerSupport();
  mitSupport(d, support).vertrauen(true);
  for (const wert of [`${join(d, ".tools/clean.sh")}`, "./.tools/clean.sh", ".tools/clean.sh", `sh -c '${join(d, ".tools/clean.sh")}'`]) {
    g(d, "config", "filter.probe.clean", wert);
    const s = V.gitSicht(d, { support });
    assert.equal(s.gesperrt, true, wert); assert.equal(s.vertraut, true); assert.match(s.grund, /filter\.probe\.clean/);
    const v = mitSupport(d, support);
    assert.equal((await wirft(v.gitCommit({ nachricht: "x", dateien: [] }))).extra.gitGesperrt, true);
  }
  g(d, "config", "filter.probe.clean", "cat");
  assert.equal(V.gitSicht(d, { support }).gesperrt, false, "ein Programm aus dem PATH ist in Ordnung");
  assert.equal(existsSync(marke), false, "nie gelaufen");
}));

test("Git gesperrt: ohne Vertrauen → status 200 { repo, gesperrt, grund }, übrige Routen 409 { gitGesperrt }, nichts läuft (auch der Filter aus .git/config nicht); nach dem Vertrauen normal", () => echt(async () => {
  const d = repo();
  const marke = join(tmp("brain-marke-"), "FILTER");
  schreibe(d, ".gitattributes", "*.md filter=probe\n"); g(d, "add", "--", ".gitattributes"); g(d, "commit", "-q", "-m", "Attribute");
  konfig(d, filterKonfig(marke));
  schreibe(d, "a.md", "# a\n");
  const support = neuerSupport();
  const rufe = aufruf(erzeugeHandler({ vault: d, vaultOptionen: { support } }));
  let r = await rufe("GET", "/api/git/status");
  assert.equal(r.status, 200); assert.equal(r.j.repo, true); assert.equal(r.j.gesperrt, true); assert.match(r.j.grund, /nicht als deiner bestätigt/);
  assert.deepEqual(Object.keys(r.j).sort(), ["gesperrt", "grund", "repo"]);
  for (const [m, p, daten, q] of [["POST", "/api/git/commit", { nachricht: "x", dateien: ["a.md"] }], ["POST", "/api/git/sync", undefined], ["GET", "/api/git/verlauf", undefined, "pfad=a.md"],
    ["GET", "/api/git/log", undefined], ["POST", "/api/git/remote", { url: "https://example.org/x.git" }], ["GET", "/api/git/diff", undefined, "pfad=a.md"],
    ["GET", "/api/git/fassung", undefined, "pfad=a.md&sha=abcdef1"], ["POST", "/api/git/nachsehen", undefined], ["GET", "/api/git/konflikt", undefined]]) {
    r = await rufe(m, p, daten, q);
    assert.equal(r.status, 409, `${m} ${p}`); assert.equal(r.j.gitGesperrt, true, p); assert.equal(typeof r.j.fehler, "string"); assert.match(r.j.fehler, /gesperrt/);
  }
  r = await rufe("GET", "/api/info");
  assert.equal(r.j.git, true, "es ist ein Repo (das .git im Ordner, ohne git zu fragen)");
  assert.deepEqual(r.j.vertrauen, { erlaubt: false, noetig: true, gitGesperrt: true, quelle: null });
  assert.equal((await rufe("GET", "/api/notizen")).status, 200, "Lesen geht");
  assert.equal((await rufe("GET", "/api/suche", undefined, "q=a")).status, 200, "Suchen geht");
  assert.equal(existsSync(marke), false, "kein Git-Aufruf hat den Filter gestartet (auch der Notiz-Index nicht)");
  r = await rufe("POST", "/api/vertrauen", { erlauben: true, vault: d });
  assert.equal(r.status, 200); assert.equal(r.j.vertrauen.gitGesperrt, false); assert.equal(r.j.vertrauen.quelle, "bestaetigt");
  r = await rufe("GET", "/api/git/status");
  assert.equal(r.status, 200); assert.equal(r.j.gesperrt, undefined); assert.equal(r.j.repo, true); assert.equal(r.j.zweig, "main");
  r = await rufe("POST", "/api/git/commit", { nachricht: "geht wieder", dateien: ["a.md"] });
  assert.equal(r.status, 200);
  assert.equal(existsSync(marke), true, "mit Vertrauen läuft Git mit der Konfiguration des Repos");
}));

// Ohne Vertrauen läuft gar kein ssh (Git ist gesperrt). Mit Vertrauen gilt die core.sshCommand des NUTZERS (~/.gitconfig, z. B. zweites GitHub-Konto
// mit eigenem Schlüssel) und die des Vaults; unser BatchMode-Befehl ersetzt nur, wo keine gesetzt ist (Befunde V1/B2, Review Studio v2).
test("SSH: ohne Vertrauen startet kein ssh; mit Vertrauen gilt die globale core.sshCommand des Nutzers und die aus dem Vault", () => echt(async () => {
  const marken = tmp("brain-marke-");
  const markeGlobal = join(marken, "GLOBAL-SSH"), markeLokal = join(marken, "LOKAL-SSH");
  const sshGlobal = skript(`echo lief >> '${markeGlobal}'\nexit 1`), sshLokal = skript(`echo lief >> '${markeLokal}'\nexit 1`);
  const globalDatei = join(tmp("brain-gcfg-"), "gitconfig");
  writeFileSync(globalDatei, `[core]\n\tsshCommand = ${sshGlobal}\n[user]\n\tname = T\n\temail = t@example.org\n`);
  const alt = { g: process.env.GIT_CONFIG_GLOBAL, s: process.env.GIT_SSH_COMMAND };
  process.env.GIT_CONFIG_GLOBAL = globalDatei; delete process.env.GIT_SSH_COMMAND;
  const adresse = "ssh://git@example.invalid/team/x.git";
  const weg = () => { for (const m of [markeGlobal, markeLokal]) rmSync(m, { force: true }); };
  try {
    // (a) nur die globale Einstellung des Nutzers
    let d = repo();
    const support = neuerSupport();
    let v = mitSupport(d, support, { gitLimitRemote: 15_000 });
    await wirft(v.gitRemote(adresse));
    assert.equal(existsSync(markeGlobal), false, "ohne Vertrauen läuft kein ssh");
    v.vertrauen(true);
    assert.equal(V.gitSicht(d, { support }).sshGlobal, sshGlobal, "gitSicht kennt den Wert des Nutzers");
    await v.gitRemote(adresse).catch(() => {});
    assert.equal(existsSync(markeGlobal), true, "mit Vertrauen läuft die core.sshCommand des Nutzers (sonst scheitert ein Klon, der im Terminal klappt)");
    // (b) zusätzlich eine core.sshCommand im Vault: mit Vertrauen gilt die des Vaults
    weg(); d = repo(); g(d, "config", "core.sshCommand", sshLokal);
    const support2 = neuerSupport();
    v = mitSupport(d, support2, { gitLimitRemote: 15_000 });
    await wirft(v.gitRemote(adresse));
    assert.equal(existsSync(markeLokal), false, "ohne Vertrauen läuft die core.sshCommand aus dem Vault nie");
    v.vertrauen(true);
    assert.equal(V.gitSicht(d, { support: support2 }).sshEigen, true);
    await v.gitRemote(adresse).catch(() => {});
    assert.equal(existsSync(markeLokal), true, "mit Vertrauen und eigener core.sshCommand setzen wir kein eigenes GIT_SSH_COMMAND");
    // (c) ohne Einstellung des Nutzers und ohne eine im Vault: unser BatchMode-Befehl (kein Passwort-Dialog)
    writeFileSync(globalDatei, "[user]\n\tname = T\n\temail = t@example.org\n");
    weg(); d = repo();
    const support3 = neuerSupport();
    v = mitSupport(d, support3, { gitLimitRemote: 15_000 }); v.vertrauen(true);
    assert.equal(V.gitSicht(d, { support: support3 }).sshEigen, false);
    assert.equal(V.gitSicht(d, { support: support3 }).sshGlobal, null);
  } finally {
    if (alt.g === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = alt.g;
    if (alt.s !== undefined) process.env.GIT_SSH_COMMAND = alt.s;
  }
}));

test("Notiz-Index: ohne Vertrauen nur Dateizeiten und kein Git-Aufruf, nach dem Vertrauen die Git-Zeiten", () => echt(async () => {
  const d = tmp();
  g(d, "init", "-q", "-b", "main"); g(d, "config", "user.name", "T"); g(d, "config", "user.email", "t@example.org");
  schreibe(d, "a.md", "# A\n");
  g(d, "add", "--", "a.md");
  execFileSync("git", ["commit", "-q", "-m", "alt"], { cwd: d, env: { ...process.env, GIT_AUTHOR_DATE: "2020-01-01T10:00:00Z", GIT_COMMITTER_DATE: "2020-01-01T10:00:00Z" } });
  const marke = join(tmp("brain-marke-"), "FILTER");
  konfig(d, filterKonfig(marke));
  const v = mitSupport(d);
  let n = (await v.notizen()).notizen.find((x) => x.pfad === "a.md");
  assert.ok(n.geaendert > "2026-", `gesperrt: Dateizeit statt Git-Zeit (${n.geaendert})`);
  assert.equal(existsSync(marke), false);
  v.vertrauen(true);
  n = (await v.notizen()).notizen.find((x) => x.pfad === "a.md");
  assert.match(n.geaendert, /^2020-01-01T10:00:00/, "mit Vertrauen die Zeit des letzten Commits");
}));

test("MCP: brain_verlauf in einem nicht vertrauten Vault → Hinweis statt Verlauf, ohne Git-Start", () => echt(async () => {
  const { bearbeite } = await import(pfad("mcp", "brain-mcp.mjs"));
  const d = repo();
  const marke = join(tmp("brain-marke-"), "FILTER");
  konfig(d, filterKonfig(marke));
  const v = mitSupport(d);
  const a = await bearbeite(v, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "brain_verlauf", arguments: { pfad: "start.md" } } });
  assert.equal(a.result.isError, true); assert.match(a.result.content[0].text, /gesperrt/);
  assert.equal(existsSync(marke), false);
  v.vertrauen(true);
  const b = await bearbeite(v, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "brain_verlauf", arguments: { pfad: "start.md" } } });
  assert.match(b.result.content[0].text, /Start/);
}));

// ───────────────────────────── MCP verbinden, Probe, Entfernen ─────────────────────────────

const { spawn } = await import("node:child_process");
const { createInterface } = await import("node:readline");
const { realpathSync } = await import("node:fs");

// Attrappe für `claude` (NIE das echte `claude mcp add/remove`): Zustand in einer Datei (Zeile 1 Befehl, Zeile 2 Argumente), jeder Aufruf im Log.
// `mcp get` gibt im Format von Claude Code aus — samt einem „Geheimnis“ im Environment, das nie in einer Antwort stehen darf.
function fakeClaude({ haengt = false } = {}) {
  const bin = tmp("brain-bin-"), zustand = join(bin, "zustand.txt"), log = join(bin, "aufrufe.log"), pids = join(bin, "pids.txt");
  writeFileSync(join(bin, "claude"), `#!/bin/sh
echo "$*" >> '${log}'
case "$1 $2" in
  "mcp get")
    ${haengt ? `echo $$ > '${pids}'; sleep 30 & echo $! >> '${pids}'; wait` : ""}
    if [ -f '${zustand}' ]; then
      echo "brain:"; echo "  Scope: User config (available in all your projects)"; echo "  Status: ✓ Connected"; echo "  Type: stdio"
      echo "  Command: $(sed -n 1p '${zustand}')"; echo "  Args: $(sed -n 2p '${zustand}')"; echo "  Environment:"; echo "    API_KEY=geheim-123"
      exit 0
    fi
    echo "No MCP server found with name: brain" >&2; exit 1;;
  "mcp remove") rm -f '${zustand}'; echo "Removed MCP server brain from user config"; exit 0;;
  "mcp add")
    if [ -f '${zustand}' ]; then echo "MCP server brain already exists in user config" >&2; exit 1; fi
    shift 6; printf '%s\\n' "$1" > '${zustand}'; shift; printf '%s\\n' "$*" >> '${zustand}'
    echo "Added stdio MCP server brain to user config"; exit 0;;
esac
exit 3
`);
  chmodSync(join(bin, "claude"), 0o755);
  const aufrufe = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []);
  return { bin, zustand, log, pids, aufrufe };
}
async function mitClaude(bin, fn) {
  const alt = { PATH: process.env.PATH, EXTRA: process.env.BRAIN_CLAUDE_EXTRA };
  process.env.PATH = `${bin}:${alt.PATH}`; process.env.BRAIN_CLAUDE_EXTRA = "";
  try { return await fn(); } finally { process.env.PATH = alt.PATH; if (alt.EXTRA === undefined) delete process.env.BRAIN_CLAUDE_EXTRA; else process.env.BRAIN_CLAUDE_EXTRA = alt.EXTRA; }
}
const lebt = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const warteBis = async (f, ms = 3000) => { const ende = Date.now() + ms; while (Date.now() < ende) { if (f()) return true; await new Promise((r) => setTimeout(r, 25)); } return f(); };

test("MCP verbinden: nicht vorhanden → eintragen; gleicher Befehl → schonVerbunden; anderer → 409 „anders“ ohne Details; umstellen → ersetzt", async () => {
  const d = kitVault();
  const mcp = tmp("brain-mcpdir-"); schreibe(mcp, "brain-mcp.mjs", "// fake\n");
  const mcpReal = realpathSync(join(mcp, "brain-mcp.mjs"));
  const c = fakeClaude();
  const rufe = aufruf(erzeugeHandler({ kontenAus: true, vault: d, mcpPfad: join(mcp, "brain-mcp.mjs"), vaultOptionen: { support: neuerSupport() } }));
  await mitClaude(c.bin, async () => {
    let r = await rufe("POST", "/api/mcp/verbinden", { ziel: "claude" });
    assert.equal(r.status, 200); assert.equal(r.j.ok, true); assert.match(r.j.ausgabe, /Added/);
    assert.deepEqual(c.aufrufe(), ["mcp get brain", `mcp add -s user brain -- ${process.execPath} ${mcpReal}`]);
    assert.equal(readFileSync(c.zustand, "utf8"), `${process.execPath}\n${mcpReal}\n`, "Eintrag ohne Vault-Pfad");

    r = await rufe("POST", "/api/mcp/verbinden", { ziel: "claude" });
    assert.equal(r.status, 200); assert.deepEqual(r.j, { ok: true, schonVerbunden: true });
    assert.deepEqual(c.aufrufe().slice(2), ["mcp get brain"], "weder remove noch add");

    // fremder Eintrag mit Geheimnis: 409, nichts davon in der Antwort, nichts verändert
    writeFileSync(c.zustand, "/usr/local/bin/anderes-programm\n--key=geheim-456 /pfad/fremd.js\n");
    const vorher = c.aufrufe().length;
    r = await rufe("POST", "/api/mcp/verbinden", { ziel: "claude" });
    assert.equal(r.status, 409); assert.equal(r.j.art, "anders"); assert.ok(r.j.fehler.length > 10);
    const roh = r.body.toString("utf8");
    for (const geheim of ["geheim-123", "geheim-456", "anderes-programm", "fremd.js", "API_KEY"]) assert.ok(!roh.includes(geheim), `„${geheim}“ darf nie in der Antwort stehen`);
    assert.equal(readFileSync(c.zustand, "utf8"), "/usr/local/bin/anderes-programm\n--key=geheim-456 /pfad/fremd.js\n", "unverändert");
    assert.deepEqual(c.aufrufe().slice(vorher), ["mcp get brain"], "ohne umstellen weder remove noch add");

    r = await rufe("POST", "/api/mcp/verbinden", { ziel: "claude", umstellen: true });
    assert.equal(r.status, 200); assert.equal(r.j.ok, true);
    assert.ok(!r.body.toString("utf8").includes("geheim"), "auch hier nichts vom alten Eintrag");
    assert.deepEqual(c.aufrufe().slice(-3), ["mcp get brain", "mcp remove -s user brain", `mcp add -s user brain -- ${process.execPath} ${mcpReal}`]);
    assert.equal(readFileSync(c.zustand, "utf8"), `${process.execPath}\n${mcpReal}\n`);
  });
});

test("MCP verbinden: Gesamtfrist — hängendes claude wird samt Prozessgruppe beendet, 504 mit Alltagsmeldung, nichts verändert", async () => {
  const d = kitVault();
  const mcp = tmp("brain-mcpdir-"); schreibe(mcp, "brain-mcp.mjs", "// fake\n");
  const c = fakeClaude({ haengt: true });
  const rufe = aufruf(erzeugeHandler({ vault: d, mcpPfad: join(mcp, "brain-mcp.mjs"), fristen: { mcpVerbinden: 2500 }, vaultOptionen: { support: neuerSupport() } }));
  await mitClaude(c.bin, async () => {
    const t0 = Date.now();
    const r = await rufe("POST", "/api/mcp/verbinden", { ziel: "claude" });
    assert.equal(r.status, 504); assert.match(r.j.fehler, /nicht rechtzeitig/); assert.ok(r.j.befehl);
    assert.ok(Date.now() - t0 < 15_000, `dauerte ${Date.now() - t0} ms`);
    assert.ok(!existsSync(c.zustand), "nichts eingetragen");
    const pids = readFileSync(c.pids, "utf8").trim().split("\n").map(Number);
    assert.equal(pids.length, 2);
    assert.ok(await warteBis(() => pids.every((p) => !lebt(p))), "claude und sein Kindprozess sind beendet (Prozessgruppe)");
  });
});

// ── Probe über den MCP-Server ──
const listeMit = (support, vaults, aktiv) => writeFileSync(join(support, "vaults.json"), JSON.stringify({ vaults: vaults.map((p, i) => ({ name: `v${i}`, pfad: realpathSync(p), farbe: "#5B8DEF" })), aktiv: aktiv ? realpathSync(aktiv) : null }));
const notizVault = (text) => { const d = tmp(); schreibe(d, "00_inbox/n.md", `# Notiz\n\n${text}\n`); return d; };

test("Probe: läuft über den MCP-Server (eigener Kindprozess, JSON-RPC), liefert Treffer strukturiert und den Text, den die KI sieht", async () => {
  const support = neuerSupport();
  const d = notizVault("Das Zebra frisst Gras.");
  listeMit(support, [d], d);
  const rufe = aufruf(erzeugeHandler({ vault: d, vaultOptionen: { support } }));
  const r = await rufe("POST", "/api/probe", { frage: "zebra" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.j.treffer.map((t) => t.pfad), ["00_inbox/n.md"]);
  assert.deepEqual(Object.keys(r.j.treffer[0]).sort(), ["auszug", "pfad", "stufe", "titel", "zeile"]);
  assert.match(r.j.text, /^1\. 00_inbox\/n\.md — Notiz \[grau\]\n {3}Z\.3: Das Zebra/);
  assert.equal(r.j.text, (await oeffneVault(d, { support }).suchenFuerKi("zebra")).text, "derselbe Text wie die direkte Suche");
  assert.equal((await rufe("POST", "/api/probe", { frage: "zzzgibtesnicht" })).j.text, "Keine Treffer.");
  // dieser Vault ist in der App nicht der aktive → die Probe könnte ihn über den MCP-Weg nicht finden
  const anderer = notizVault("x"); listeMit(support, [d, anderer], anderer);
  const n = await rufe("POST", "/api/probe", { frage: "zebra" });
  assert.equal(n.status, 409); assert.equal(n.j.art, "nicht-aktiv");
});

test("Probe: stummer, abstürzender und fehlermeldender MCP-Server → klare Fehler, Frist 10 s (hier kürzer), Prozess beendet", async () => {
  const support = neuerSupport();
  const d = notizVault("x"); listeMit(support, [d], d);
  const skripte = tmp("brain-fakemcp-");
  schreibe(skripte, "stumm.mjs", "process.stdin.resume(); setInterval(() => {}, 1000); require_pid: ; \n".replace(" require_pid: ;", "") + "import('node:fs').then((f) => f.writeFileSync(process.env.PIDDATEI || '/dev/null', String(process.pid)));\n");
  schreibe(skripte, "absturz.mjs", "process.exit(1);\n");
  schreibe(skripte, "fehler.mjs", `import { createInterface } from "node:readline";
createInterface({ input: process.stdin }).on("line", (z) => { const m = JSON.parse(z);
  if (m.method === "initialize") console.log(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "x", version: "1" } } }));
  if (m.method === "tools/call") console.log(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { isError: true, content: [{ type: "text", text: "Es ist noch kein Vault eingerichtet." }] } })); });\n`);
  const pidDatei = join(skripte, "pid.txt");
  const alt = process.env.PIDDATEI; process.env.PIDDATEI = pidDatei;
  try {
    const mit = (datei) => aufruf(erzeugeHandler({ vault: d, mcpPfad: join(skripte, datei), fristen: { probe: 800 }, vaultOptionen: { support } }));
    let t0 = Date.now();
    let r = await mit("stumm.mjs")("POST", "/api/probe", { frage: "x" });
    assert.equal(r.status, 504); assert.equal(r.j.art, "mcp"); assert.match(r.j.fehler, /nicht rechtzeitig/); assert.ok(Date.now() - t0 < 5000);
    const pid = Number(readFileSync(pidDatei, "utf8"));
    assert.ok(await warteBis(() => !lebt(pid)), "der hängende MCP-Server wurde beendet");
    r = await mit("absturz.mjs")("POST", "/api/probe", { frage: "x" });
    assert.equal(r.status, 502); assert.equal(r.j.art, "mcp");
    r = await mit("fehler.mjs")("POST", "/api/probe", { frage: "x" });
    assert.equal(r.status, 502); assert.match(r.j.fehler, /noch kein Vault eingerichtet/);
  } finally { if (alt === undefined) delete process.env.PIDDATEI; else process.env.PIDDATEI = alt; }
});

test("MCP-Server ohne Argument folgt dem aktiven Vault aus vaults.json (bei jedem Aufruf neu geprüft) — W4", async () => {
  const support = neuerSupport();
  const A = notizVault("Alpha Quokka"), B = notizVault("Beta Wombat");
  listeMit(support, [A, B], A);
  const env = { ...process.env, BRAIN_APP_SUPPORT: support }; delete env.BRAIN_VAULT;
  const p = spawn(process.execPath, [pfad("mcp", "brain-mcp.mjs")], { stdio: ["pipe", "pipe", "pipe"], env });
  const antworten = [], wartende = [];
  createInterface({ input: p.stdout }).on("line", (z) => { const o = JSON.parse(z); const w = wartende.shift(); if (w) w(o); else antworten.push(o); });
  let nr = 0;
  const frage = (method, params) => new Promise((ok) => { const id = ++nr; wartende.push(ok); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
  const suche = async (q) => (await frage("tools/call", { name: "brain_suchen", arguments: { frage: q } })).result.content[0].text;
  try {
    assert.match(await suche("quokka"), /00_inbox\/n\.md/);
    assert.equal(await suche("wombat"), "Keine Treffer.");
    listeMit(support, [A, B], B); // in der App den anderen Vault aktiv gemacht
    assert.equal(await suche("quokka"), "Keine Treffer.");
    assert.match(await suche("wombat"), /00_inbox\/n\.md/);
    const v = (await frage("tools/call", { name: "brain_vaults", arguments: {} })).result.content[0].text;
    assert.match(v, /\* v1 —/); assert.match(v, /v0 .*\(in der App aktiv\)|v0 —/);
    listeMit(support, [A, B], null);
    assert.match(await suche("quokka"), /noch kein Vault/);
  } finally { p.kill("SIGKILL"); }
});

test("Entfernen: aktiver Vault → Nachfolger oder Willkommen (200, aktiv: null); defekt wird durchgereicht", async () => {
  const support = neuerSupport();
  const A = notizVault("a"), B = notizVault("b");
  listeMit(support, [A, B], A);
  const rufe = aufruf(erzeugeHandler({ vaultOptionen: { support } }));
  assert.equal((await rufe("GET", "/api/info")).j.vault, realpathSync(A));
  let r = await rufe("POST", "/api/vaults/entfernen", { pfad: A });
  assert.equal(r.status, 200); assert.equal(r.j.aktiv, realpathSync(B)); assert.equal(r.j.vaults.length, 1);
  assert.equal((await rufe("GET", "/api/info")).j.vault, realpathSync(B));
  r = await rufe("POST", "/api/vaults/entfernen", { pfad: B });
  assert.equal(r.status, 200); assert.equal(r.j.aktiv, null); assert.deepEqual(r.j.vaults, []);
  assert.equal((await rufe("GET", "/api/info")).j.vault, null, "Willkommen");

  // defekte vaults.json: gesichert und ersetzt → die Antworten tragen defekt:true
  writeFileSync(join(support, "vaults.json"), "{ kaputt");
  const neu = notizVault("c");
  r = await rufe("POST", "/api/vaults/oeffnen", { pfad: neu });
  assert.equal(r.status, 200); assert.equal(r.j.defekt, true);
  r = await rufe("GET", "/api/vaults");
  assert.equal(r.j.defekt, true);
  listeMit(support, [neu], neu); // heil überschrieben
  assert.equal((await rufe("GET", "/api/vaults")).j.defekt, undefined);
});

test("istRepo und sorgeFuerIdentitaet nehmen { timeout, frist } entgegen (Budget für Prüfungen in vaults.mjs)", async () => {
  const { istRepo, neueFrist } = await import(pfad("gemeinsam", "git.mjs"));
  const { sorgeFuerIdentitaet } = await import(pfad("gemeinsam", "gitwerkzeug.mjs"));
  const d = repo();
  assert.equal(await istRepo(d, { timeout: 5000 }), true);
  await sorgeFuerIdentitaet(d, { timeout: 5000 });
  assert.equal((await wirft(istRepo(d, { frist: neueFrist(0) }))).status, 504, "abgelaufene Frist: kein Git-Start, 504");
  assert.equal((await wirft(sorgeFuerIdentitaet(d, { frist: neueFrist(0) }))).status, 504);
});

// ───────────────────────────── Fristen und Beenden ─────────────────────────────

// Skript, das seine Prozess-Nummern (eigene und die eines Kindprozesses) in eine Datei schreibt und dann „hängt“.
const haengtSkript = (pidDatei, vorspann = "") => skript(`${vorspann}echo $$ >> '${pidDatei}'\nsleep 30 &\necho $! >> '${pidDatei}'\nwait`);
const pidsVon = (datei) => readFileSync(datei, "utf8").trim().split("\n").filter(Boolean).map(Number);
const bareRepo = () => { const b = tmp("brain-bare-"); g(b, "init", "-q", "--bare", "-b", "main"); return b; };

test("Frist git/commit: hängender Hook → Prozessgruppe beendet, Index wie vorher, keine Sperrdatei, 504 mit Alltagsmeldung; danach geht es wieder", async () => {
  const d = repo();
  const pids = join(tmp("brain-pid-"), "pids.txt");
  const hook = join(d, ".git/hooks/pre-commit");
  writeFileSync(hook, `#!/bin/sh\necho $$ >> '${pids}'\nsleep 30 &\necho $! >> '${pids}'\nwait\n`); chmodSync(hook, 0o755);
  schreibe(d, "a.md", "# a\n"); schreibe(d, "b.md", "# b\n");
  g(d, "add", "--", "b.md"); // b ist vorgemerkt und soll es danach genauso sein
  const vorher = { baum: g(d, "write-tree").trim(), status: g(d, "status", "--porcelain=v1"), kopf: g(d, "rev-parse", "HEAD") };
  const v = mitSupport(d, neuerSupport(), { gitLimitCommit: 3000 });
  v.vertrauen(true); // der Hook läuft nur mit Vertrauen
  const t0 = Date.now();
  const e = await wirft(v.gitCommit({ nachricht: "hängt", dateien: ["a.md"] }));
  assert.equal(e.status, 504); assert.match(e.message, /zu lange gebraucht/); assert.match(e.message, /nichts gesichert/i);
  assert.ok(Date.now() - t0 < 20_000, `dauerte ${Date.now() - t0} ms`);
  const p = pidsVon(pids); assert.equal(p.length, 2);
  assert.ok(await warteBis(() => p.every((x) => !lebt(x))), "Hook und sein Kindprozess sind beendet");
  assert.equal(existsSync(join(d, ".git/index.lock")), false, "keine liegengebliebene Sperrdatei");
  assert.equal(g(d, "rev-parse", "HEAD"), vorher.kopf, "kein Commit");
  assert.deepEqual({ baum: g(d, "write-tree").trim(), status: g(d, "status", "--porcelain=v1") }, { baum: vorher.baum, status: vorher.status }, "Index wie vorher (b vorgemerkt, a neu)");
  writeFileSync(hook, "#!/bin/sh\nexit 0\n"); v.vertrauen(true); // schneller Hook, neu erlaubt
  const ok = await v.gitCommit({ nachricht: "geht wieder", dateien: ["a.md"] });
  assert.match(ok.sha, /^[0-9a-f]{40}$/);
});

test("Frist git/remote ist eine GESAMTfrist: langsamer Server-Haken (Prozessgruppe wird beendet), origin wird zurückgenommen, 504", async () => {
  const bare = bareRepo();
  const pids = join(tmp("brain-pid-"), "pids.txt");
  const h = join(bare, "hooks", "pre-receive");
  writeFileSync(h, `#!/bin/sh\necho $$ >> '${pids}'\nsleep 30 &\necho $! >> '${pids}'\nwait\n`); chmodSync(h, 0o755);
  const a = repo();
  const t0 = Date.now();
  const e = await wirft(gitRemoteDirekt(a, bare, 4000));
  assert.equal(e.status, 504); assert.match(e.message, /zu lange|nicht rechtzeitig/);
  assert.ok(Date.now() - t0 < 20_000, `dauerte ${Date.now() - t0} ms`);
  assert.equal(g(a, "remote").trim(), "", "origin zurückgenommen");
  assert.equal(g(a, "for-each-ref", "refs/brain-studio").trim(), "", "Prüf-Ref aufgeräumt");
  assert.equal(g(bare, "for-each-ref").trim(), "", "nichts auf dem Server");
  const p = pidsVon(pids);
  assert.ok(await warteBis(() => p.every((x) => !lebt(x))), "der Haken des Servers wurde mit der Gruppe beendet");
});
const gitRemoteDirekt = async (a, bare, limit) => (await import(pfad("gemeinsam", "git.mjs"))).remoteHinzufuegen(a, bare, { limit });

test("Frist Abgleich: Gesamtfrist (limitGesamt) beendet auch einen hängenden Push samt Gruppe; 504", async () => {
  const bare = bareRepo();
  const a = repo(); g(a, "remote", "add", "origin", bare);
  g(a, "push", "-q", "-u", "origin", "main");
  const pids = join(tmp("brain-pid-"), "pids.txt");
  const h = join(bare, "hooks", "pre-receive");
  writeFileSync(h, `#!/bin/sh\necho $$ >> '${pids}'\nsleep 30 &\necho $! >> '${pids}'\nwait\n`); chmodSync(h, 0o755);
  schreibe(a, "neu.md", "# neu\n"); g(a, "add", "--", "neu.md"); g(a, "commit", "-q", "-m", "lokal");
  const v = mitSupport(a, neuerSupport(), { gitLimitAbgleich: 4000 });
  const t0 = Date.now();
  const e = await wirft(v.gitSync());
  assert.equal(e.status, 504); assert.ok(Date.now() - t0 < 20_000);
  const p = pidsVon(pids);
  assert.ok(await warteBis(() => p.every((x) => !lebt(x))), "Push und Haken beendet");
  assert.equal(g(bare, "for-each-ref", "refs/heads").split("\n").filter((z) => /main/.test(z)).length, 1);
  assert.equal(g(bare, "rev-parse", "main").trim(), g(a, "rev-parse", "origin/main").trim(), "der Server hat nichts bekommen");
});

// Aufbau für Merge-Tests: lokaler Commit und Commit auf dem Server ändern dieselbe Zeile, ein langsamer Merge-Treiber (hängt) für *.md.
function haengenderMerge() {
  const bare = bareRepo();
  const a = repo(); g(a, "remote", "add", "origin", bare);
  const treiber = join(tmp("brain-treiber-"), "langsam.sh"), pids = join(tmp("brain-pid-"), "pids.txt");
  writeFileSync(treiber, `#!/bin/sh\necho $$ >> '${pids}'\nsleep 30 &\necho $! >> '${pids}'\nwait\nexit 1\n`); chmodSync(treiber, 0o755);
  schreibe(a, ".gitattributes", "*.md merge=langsam\n");
  g(a, "config", "merge.langsam.driver", `${treiber} %O %A %B`);
  g(a, "add", "--", ".gitattributes"); g(a, "commit", "-q", "-m", "Attribute"); g(a, "push", "-q", "-u", "origin", "main");
  const b = tmp("brain-klon-"); g(b, "clone", "-q", bare, "."); g(b, "config", "user.name", "B"); g(b, "config", "user.email", "b@example.org");
  schreibe(b, "start.md", "# Start\nvon B\n"); g(b, "add", "--", "start.md"); g(b, "commit", "-q", "-m", "B"); g(b, "push", "-q");
  schreibe(a, "start.md", "# Start\nvon A\n"); g(a, "add", "--", "start.md"); g(a, "commit", "-q", "-m", "A");
  return { a, pids, kopf: g(a, "rev-parse", "HEAD") };
}
const nichtsHalbes = async ({ a, pids, kopf }) => {
  const kinder = pidsVon(pids);
  assert.ok(await warteBis(() => kinder.every((x) => !lebt(x))), "Treiber und Kindprozess sind beendet");
  assert.equal(existsSync(join(a, ".git/MERGE_HEAD")), false, "Merge zurückgenommen");
  assert.equal(existsSync(join(a, ".git/index.lock")), false, "keine Sperrdatei");
  assert.equal(g(a, "rev-parse", "HEAD"), kopf, "HEAD unverändert");
  assert.equal(readFileSync(join(a, "start.md"), "utf8"), "# Start\nvon A\n", "Arbeitsstand wie vorher");
  assert.equal(g(a, "status", "--porcelain").trim(), "", "nichts Halbes im Vault (auch keine .merge_file_*-Hilfsdateien)");
};

test("Frist Abgleich: hängender Merge-Treiber → Frist je Git-Aufruf, 504 mit Alltagsmeldung, Merge zurückgenommen, keine Hilfsdateien", async () => {
  const s = haengenderMerge();
  const v = mitSupport(s.a, neuerSupport(), { gitLimitSync: 4000 });
  v.vertrauen(true); // merge.*.driver sperrt Git, solange dem Vault nicht vertraut ist
  const t0 = Date.now();
  const e = await wirft(v.gitSync());
  assert.equal(e.status, 504); assert.match(e.message, /zu lange gebraucht/); assert.match(e.message, /nichts verändert/);
  assert.ok(Date.now() - t0 < 25_000, `dauerte ${Date.now() - t0} ms`);
  assert.ok(existsSync(s.pids) && pidsVon(s.pids).length >= 2, "der Treiber lief wirklich");
  await nichtsHalbes(s);
});

test("SIGTERM der Werkstatt mitten im Abgleich-Merge: Git-Prozesse beendet, Merge zurückgenommen (kein MERGE_HEAD, keine Sperre, keine Hilfsdateien), Ende ohne Verzögerung", async () => {
  const s = haengenderMerge();
  const support = neuerSupport();
  oeffneVault(s.a, { support }).vertrauen(true); // merge.*.driver sperrt Git, solange dem Vault nicht vertraut ist
  const p = spawn(process.execPath, [pfad("werkstatt", "werkstatt.mjs"), s.a], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, BRAIN_APP_SUPPORT: support } });
  try {
    const zeilen = []; createInterface({ input: p.stdout }).on("line", (z) => zeilen.push(JSON.parse(z)));
    const ende = new Promise((ok) => p.on("close", (code, sig) => ok({ code, sig })));
    assert.ok(await warteBis(() => zeilen.some((z) => z.bereit), 5000), "Brücke ist bereit");
    p.stdin.write(JSON.stringify({ id: 1, methode: "POST", pfad: "/api/git/sync", query: null, body: null }) + "\n");
    assert.ok(await warteBis(() => existsSync(s.pids) && pidsVon(s.pids).length >= 2, 15_000), "der Merge-Treiber läuft");
    const t0 = Date.now();
    p.kill("SIGTERM");
    const r = await ende;
    assert.deepEqual(r, { code: 0, sig: null }); assert.ok(Date.now() - t0 < 4000, `Ende nach ${Date.now() - t0} ms`);
    await nichtsHalbes(s);
  } finally { p.kill("SIGKILL"); }
});
