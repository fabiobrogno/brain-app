// test-commit-pruefung-ohne-unit.mjs — Die Commit-Prüfung (commit-pruefung.mjs) startet seit dem Kern-Umzug (P2) keine Unit-Tests mehr: der Kern liegt
// nicht mehr im Vault, seine Tests laufen in der CI des Repos. Früher (Schritt 4) lief bei gestagtem Werkzeug-Code im Vault die Suite mit 120 s Limit.
// Echt gelaufen wird die Commit-Prüfung (Temp-Vault, echtes git); ein `node --test`-Aufruf würde per --require abgefangen und gezählt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { tempOrdner, KIT } from "./verlauf-fixture.mjs";

const PRUEFUNG = join(KIT, "commit-pruefung.mjs");
const ohneGit = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
const git = (cwd, ...a) => execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", env: ohneGit(), stdio: ["ignore", "pipe", "pipe"] });

// Vault mit gestagtem Code und einem Unit-Test im alten Kit-Ordner (Altbestand eines noch nicht umgestellten Vaults).
function vaultMitWerkzeugCode() {
  const v = tempOrdner("Limit Brän");
  mkdirSync(join(v, "09_wiki"), { recursive: true });
  mkdirSync(join(v, ".tools", "tests"), { recursive: true });
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ wiki: { ordner: "09_wiki" } }));
  writeFileSync(join(v, ".tools", "x.mjs"), "export const x = 1;\n");
  writeFileSync(join(v, ".tools", "tests", "test-x.mjs"), 'import { test } from "node:test";\ntest("x", () => {});\n');
  git(v, "init", "-q", "-b", "main");
  git(v, "add", "--", ".tools", "brain.config.json");
  return v;
}
// Fängt execFileSync(…, ["--test", …]) ab: protokolliert die Optionen und verhält sich wie `modus` (ok | zeit | rot).
function abfangSkript(modus) {
  const d = tempOrdner("abfang");
  const log = join(d, "aufrufe.jsonl");
  const skript = join(d, "abfang.cjs");
  writeFileSync(skript, `
const cp = require("node:child_process");
const orig = cp.execFileSync;
cp.execFileSync = function (cmd, args, opts) {
  if (Array.isArray(args) && args.includes("--test")) {
    require("node:fs").appendFileSync(${JSON.stringify(log)}, JSON.stringify({ timeout: opts && opts.timeout, dateien: args.filter((a) => /test-.*\\.mjs$/.test(a)).length }) + "\\n");
    if (${JSON.stringify(modus)} === "zeit") { const e = new Error("spawnSync ETIMEDOUT"); e.code = "ETIMEDOUT"; e.signal = "SIGTERM"; throw e; }
    if (${JSON.stringify(modus)} === "rot") { const e = new Error("rot"); e.status = 1; throw e; }
    return Buffer.alloc(0);
  }
  return orig.apply(this, arguments);
};
`);
  return { skript, aufrufe: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((z) => JSON.parse(z)) : []) };
}
function pruefe(modus) {
  const v = vaultMitWerkzeugCode();
  const a = abfangSkript(modus);
  const r = spawnSync(process.execPath, ["--require", a.skript, PRUEFUNG, v], { encoding: "utf8", env: ohneGit() });
  return { status: r.status, aus: `${r.stdout}${r.stderr}`, aufrufe: a.aufrufe() };
}

test("Gestagter Code im alten Kit-Ordner startet keine Unit-Tests mehr (sie laufen in der CI des Repos); der Commit geht durch", () => {
  const r = pruefe("ok");
  assert.equal(r.status, 0, r.aus);
  assert.equal(r.aufrufe.length, 0, "kein Aufruf von node --test");
  assert.ok(!/UNIT-TESTS|Unit-Tests/.test(r.aus), r.aus);
});

test("auch ein roter Test im alten Kit-Ordner blockiert den Commit nicht mehr", () => {
  const r = pruefe("rot");
  assert.equal(r.status, 0, r.aus);
  assert.equal(r.aufrufe.length, 0);
});

test("kein Rest der alten Grenze in Kommentaren, Hinweisen und Hilfstexten des Kits", () => {
  // Muster zusammengesetzt, damit diese Datei sich nicht selbst findet.
  const alt = new RegExp(["\\b45 ?", "s\\b|\\b45", "000\\b"].join(""));
  for (const rel of ["commit-pruefung.mjs", "tests/laufzeit-hooks.mjs", "tests/test-hook-laufzeit.sh"]) {
    const treffer = readFileSync(join(KIT, rel), "utf8").split("\n").filter((z) => alt.test(z));
    assert.deepEqual(treffer, [], `${rel} nennt noch die alte Zeitgrenze`);
  }
});
