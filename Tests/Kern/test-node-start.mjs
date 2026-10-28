// .tools/tests/test-node-start.mjs — B3 Task 5: node-start.sh findet Node ohne festen Pfad (PATH, BRAIN_NODE), meldet sonst verständlich.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { KIT } from "./tageslauf-hilfe.mjs";
const SH = join(KIT, "node-start.sh");
const lauf = (env) => spawnSync("/bin/sh", [SH, "-e", "console.log(6*7)"], { encoding: "utf8", env: { HOME: "/nirgends", ...env } });
const nurUnix = { skip: process.platform === "win32" };

test("Node aus dem PATH", nurUnix, () => {
  const r = lauf({ PATH: `${dirname(process.execPath)}:/usr/bin:/bin` });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), "42");
});
test("BRAIN_NODE geht vor, auch ganz ohne PATH", nurUnix, () => {
  const r = lauf({ PATH: "/nirgends", BRAIN_NODE: process.execPath, BRAIN_NODE_KEINE_ORTE: "1" });
  assert.equal(r.stdout.trim(), "42");
});
test("nichts gefunden → Exit 127 mit verständlicher Meldung", nurUnix, () => {
  const r = lauf({ PATH: "/nirgends", BRAIN_NODE_KEINE_ORTE: "1" });
  assert.equal(r.status, 127);
  assert.match(r.stderr, /Node wurde nicht gefunden/);
});
