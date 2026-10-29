#!/usr/bin/env node
// Aktiviert die Brain-Git-Hooks des Kerns (core.hooksPath = <Kern>/git-hooks, absolut) — idempotent, gilt für alle Sessions/Worktrees.
// Nutzung: node install-git-hooks.mjs [vault]   (oder --vault <pfad>, BRAIN_VAULT, aktiver Vault der App)
import { chmodSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { vaultPfadOderEnde, ladeConfig, kernStabil } from "./pfade.mjs";
import { gitBefehl } from "./werkzeug.mjs";

const V = vaultPfadOderEnde();
const GIT = gitBefehl({ cfg: ladeConfig(V) });
const HOOKS = join(kernStabil(), "git-hooks");
if (process.platform !== "win32") {
  try { chmodSync(join(HOOKS, "pre-commit"), 0o755); } catch { /* schreibgeschützter Kern (App-Bundle): der Hook ist dort schon ausführbar */ }
}
execFileSync(GIT, ["-C", V, "config", "core.hooksPath", HOOKS.split("\\").join("/")], { windowsHide: true });
const aktiv = execFileSync(GIT, ["-C", V, "config", "core.hooksPath"], { encoding: "utf8", windowsHide: true }).trim();
console.log(`Brain-Hooks aktiv: ${aktiv}`);
