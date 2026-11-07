import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { legeProgramm, programmPfad } from "../Tests/Node/attrappe.mjs";
const d = mkdtempSync(join(tmpdir(), "probe-"));
legeProgramm(join(d, "claude"), '#!/bin/sh\necho "2.0.10 (Claude Code)"\n');
const exe = programmPfad(join(d, "claude"));
console.log("exe", exe);
const r = spawnSync(exe, ["--version"], { encoding: "utf8", env: { ...process.env, PATH: d } });
console.log("sync PATH=d", r.status, JSON.stringify(r.stdout), JSON.stringify(r.stderr), r.error?.message);
const r2 = spawnSync(exe, ["--version"], { encoding: "utf8" });
console.log("sync normal", r2.status, JSON.stringify(r2.stdout), JSON.stringify(r2.stderr), r2.error?.message);
for (const det of [false, true]) {
  await new Promise((ok) => {
    const k = spawn(exe, ["--version"], { env: { ...process.env, PATH: d }, detached: det, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let o = "", e = "";
    k.stdout.on("data", (x) => o += x); k.stderr.on("data", (x) => e += x);
    k.on("error", (x) => { console.log("detached", det, "error", x.message); ok(); });
    k.on("close", (c) => { console.log("detached", det, c, JSON.stringify(o), JSON.stringify(e)); ok(); });
    k.stdin.end();
  });
}
