// Abgleich im Studio: Wettlauf zwischen „keine Zusammenführung offen“ und dem eigentlichen Merge, und Vaults mit `.git`-Datei (Worktree).
//  - Beginnt jemand anderes (Terminal) WÄHREND des Holens eine Zusammenführung, fasst der Abgleich sie nicht an und markiert sie nicht als eigene (409 ohne `gestartet`).
//  - Der Pfad von MERGE_HEAD kommt von Git (`rev-parse --git-path`): in einem Worktree-Vault wird die eigene Zusammenführung trotzdem als eigene erkannt.
// Echtes Git, nur Wegwerf-Repos und ein Bare-Remote in os.tmpdir(); der Wettlauf entsteht über `remote.origin.uploadpack` (ein Skript, das beim Holen läuft).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmp, schreibe, repo, g, pfad } from "./hilfe.mjs";
process.env.HOME = tmp("brain-home-");
process.env.GIT_CONFIG_NOSYSTEM = "1";
for (const k of ["GIT_CONFIG_GLOBAL", "XDG_CONFIG_HOME", "CLAUDE_CONFIG_DIR", "CODEX_HOME", "CURSOR_CONFIG_DIR", "GEMINI_CLI_HOME"]) delete process.env[k];

const { oeffneVault, HttpFehler } = await import(pfad("gemeinsam", "vault.mjs"));
const { merkeRemoteBestaetigt } = await import(pfad("gemeinsam", "sicherungsmerker.mjs"));
const wirft = async (p) => { try { await p; } catch (e) { assert.ok(e instanceof HttpFehler, String(e && e.stack)); return e; } assert.fail("kein Fehler"); };
const commitIn = (d, datei, inhalt, msg, push = false) => { schreibe(d, datei, inhalt); g(d, "add", "--", datei); g(d, "commit", "-q", "-m", msg); if (push) g(d, "push", "-q"); };
const mergeKopf = (d) => { try { return g(d, "rev-parse", "-q", "--verify", "MERGE_HEAD").trim(); } catch { return null; } };

function mitRemote() {
  const bare = tmp("brain-bare-");
  g(bare, "init", "-q", "--bare", "-b", "main");
  const a = repo();
  g(a, "remote", "add", "origin", bare);
  g(a, "push", "-q", "-u", "origin", "main");
  merkeRemoteBestaetigt(a, bare, { support: process.env.BRAIN_APP_SUPPORT });
  const b = tmp("brain-klon-");
  g(b, "clone", "-q", bare, ".");
  g(b, "config", "user.name", "B"); g(b, "config", "user.email", "b@Fabios-iPhone.local");
  return { bare, a, b };
}

test("Beginnt jemand beim Holen eine Zusammenführung: der Abgleich lässt sie in Ruhe, markiert sie nicht (409 ohne gestartet), nichts geht verloren", async () => {
  const { a, b } = mitRemote();
  // ein lokaler Zweig „fremd“, der mit main in start.md kollidiert — der „Terminal-Nutzer“ führt ihn gleich zusammen
  g(a, "checkout", "-q", "-b", "fremd");
  commitIn(a, "start.md", "# Start\nVersion aus dem Terminal\n", "fremd ändert start");
  g(a, "checkout", "-q", "main");
  commitIn(a, "start.md", "# Start\nVersion von A\n", "A ändert start");
  commitIn(b, "start.md", "# Start\nVersion von B\n", "B ändert start", true);
  // Beim Holen läuft dieses Skript: es beginnt (wie das Terminal) die Zusammenführung mit „fremd“ und reicht dann an das echte upload-pack weiter
  const skript = join(tmp("brain-skript-"), "uploadpack.sh");
  writeFileSync(skript, `#!/bin/sh\nunset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE\ngit -C '${a}' -c user.name=T -c user.email=t@example.org merge --no-edit fremd >/dev/null 2>&1\nexec git upload-pack "$@"\n`);
  chmodSync(skript, 0o755);
  g(a, "config", "remote.origin.uploadpack", skript);
  const v = oeffneVault(a);
  const e = await wirft(v.gitSync({ konflikteLoesen: true }));
  g(a, "config", "--unset", "remote.origin.uploadpack"); // der Kern (git-sicher) lehnt einen Vault mit solcher Konfiguration ab
  const fremd = g(a, "rev-parse", "fremd").trim();
  assert.equal(mergeKopf(a), fremd, "die fremde Zusammenführung steht noch, unberührt (kein merge --abort)");
  assert.equal(e.status, 409); assert.equal(e.extra.konflikt, true);
  assert.notEqual(e.extra.gestartet, true, "nicht als eigene gemeldet");
  const an = await v.gitKonfliktAnsicht();
  assert.equal(an.aktiv, true); assert.equal(an.fremd, true, "ohne Marke: nur ansehen");
  assert.match(readFileSync(join(a, "start.md"), "utf8"), /<<<<<<</);
});

test("Vault mit .git-Datei (getrenntes Git-Verzeichnis im Vault): die eigene Zusammenführung wird als eigene markiert (MERGE_HEAD-Pfad von Git, nicht .git/MERGE_HEAD)", async () => {
  const { bare, b } = mitRemote();
  const wt = tmp("brain-wt-");
  g(wt, "init", "-q", "-b", "main", `--separate-git-dir=${join(wt, ".gitdir")}`, wt); // .git ist eine Datei, das Git-Verzeichnis liegt im Vault (nur das erlaubt der Kern)
  g(wt, "config", "user.name", "T"); g(wt, "config", "user.email", "t@example.org");
  g(wt, "remote", "add", "origin", bare); g(wt, "fetch", "-q", "origin"); g(wt, "reset", "-q", "--hard", "origin/main"); g(wt, "branch", "-q", "--set-upstream-to", "origin/main");
  merkeRemoteBestaetigt(wt, bare, { support: process.env.BRAIN_APP_SUPPORT });
  assert.ok(readFileSync(join(wt, ".git"), "utf8").startsWith("gitdir:"), "wirklich eine .git-Datei");
  assert.equal(g(wt, "rev-parse", "--abbrev-ref", "@{u}").trim(), "origin/main");
  commitIn(wt, "start.md", "# Start\nVersion im Worktree\n", "Worktree ändert start");
  commitIn(b, "start.md", "# Start\nVersion von B\n", "B ändert start", true);
  const v = oeffneVault(wt);
  const e = await wirft(v.gitSync({ konflikteLoesen: true }));
  assert.equal(e.status, 409); assert.equal(e.extra.gestartet, true);
  assert.ok(mergeKopf(wt), "Zusammenführung offen");
  assert.equal(existsSync(join(wt, ".git", "MERGE_HEAD")), false, "(unter .git/ liegt nichts: .git ist eine Datei)");
  const an = await v.gitKonfliktAnsicht();
  assert.equal(an.aktiv, true); assert.equal(an.fremd, false, "als Kortex-Zusammenführung markiert");
});
