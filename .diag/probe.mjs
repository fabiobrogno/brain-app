import { tmp, schreibe, repo, g, pfad } from "../Tests/Node/hilfe.mjs";
const { oeffneVault } = await import(pfad("gemeinsam", "vault.mjs"));
const bare = tmp("brain-bare-"); g(bare, "init", "-q", "--bare", "-b", "main");
const a = repo(); g(a, "remote", "add", "origin", bare);
schreibe(a, ".gitattributes", "*.md merge=langsam\n");
g(a, "config", "merge.langsam.driver", "touch .git/index.lock; sleep 4");
g(a, "add", "--", ".gitattributes"); g(a, "commit", "-q", "-m", "Attribute"); g(a, "push", "-q", "-u", "origin", "main");
const b = tmp("brain-klon-"); g(b, "clone", "-q", bare, ".");
g(b, "config", "user.name", "B"); g(b, "config", "user.email", "b@example.org");
schreibe(b, "start.md", "# Start\nvon B\n"); g(b, "add", "--", "start.md"); g(b, "commit", "-q", "-m", "B"); g(b, "push", "-q");
schreibe(a, "start.md", "# Start\nvon A\n"); g(a, "add", "--", "start.md"); g(a, "commit", "-q", "-m", "A");
const v = oeffneVault(a, { gitLimitSync: 1500 });
v.vertrauen(true);
const t0 = Date.now();
try { console.log("OK", await v.gitSync()); } catch (e) { console.log("FEHLER", e.status, e.message, JSON.stringify(e.extra)?.slice(0, 1500), Date.now() - t0, "ms"); }
// direkt: git merge im Vault mit dem Treiber
import { spawnSync } from "node:child_process";
const r = spawnSync("git", ["-C", a, "pull", "--no-rebase", "--no-edit"], { encoding: "utf8" });
console.log("direkt pull:", r.status, JSON.stringify(r.stdout).slice(0, 400), JSON.stringify(r.stderr).slice(0, 800));
const w = spawnSync("where", ["git"], { encoding: "utf8" }); console.log(w.stdout);
