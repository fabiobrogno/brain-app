// Hilfen für die Node-Tests: Wegwerf-Vaults und Git-Repos in os.tmpdir().
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const WURZEL = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "Ressourcen");
export const pfad = (...t) => join(WURZEL, ...t);
const aufraeumen = [];
process.on("exit", () => { for (const d of aufraeumen) try { rmSync(d, { recursive: true, force: true }); } catch { /* egal */ } });

export function tmp(praefix = "brain-test-") {
  const d = realpathSync(mkdtempSync(join(tmpdir(), praefix)));
  aufraeumen.push(d);
  return d;
}
export function schreibe(wurzel, rel, inhalt) {
  const p = join(wurzel, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, inhalt);
  return p;
}
const GIT_ENV = () => { const e = { ...process.env }; for (const k of Object.keys(e)) if (k.startsWith("GIT_")) delete e[k];
  return { ...e, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.org", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.org" }; };
export const g = (cwd, ...args) => execFileSync("git", args, { cwd, env: GIT_ENV(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// Wegwerf-Repo auf Zweig main mit Startdatei und einem Commit.
export function repo(praefix = "brain-git-") {
  const d = tmp(praefix);
  g(d, "init", "-q", "-b", "main");
  g(d, "config", "user.name", "T"); g(d, "config", "user.email", "t@example.org");
  schreibe(d, "start.md", "# Start\n");
  g(d, "add", "--", "start.md"); g(d, "commit", "-q", "-m", "Start");
  return d;
}
