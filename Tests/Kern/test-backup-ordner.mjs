// test-backup-ordner.mjs — der Sicherungsordner kommt nie aus der Vault-Config (Kern-Umzug P4, Review N4): je Vault im Support-Ordner,
// absolut, ein Ordner, kein Verweis; „heute schon gesichert“ rechnet wie das Bundle nach Ortszeit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, symlinkSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync, execFileSync } from "node:child_process";
import { pruefeBackupPfad, ortstag } from "../backup.mjs";

const KERN = fileURLToPath(new URL("..", import.meta.url));
const FIXTURE = join(KERN, "tests", "fixture");
const GENV = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.org", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.org" };
for (const k of Object.keys(GENV)) if (k.startsWith("GIT_") && !/^GIT_(CONFIG_NOSYSTEM|AUTHOR|COMMITTER)/.test(k)) delete GENV[k];

function aufbau() {
  const basis = mkdtempSync(join(tmpdir(), "backup-ordner-"));
  const v = join(basis, "Vault_Eins"), support = join(basis, "support");
  cpSync(FIXTURE, v, { recursive: true }); mkdirSync(support);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: v, env: GENV });
  execFileSync("git", ["add", "--", "."], { cwd: v, env: GENV });
  execFileSync("git", ["commit", "-q", "-m", "x"], { cwd: v, env: GENV });
  const brain = (...a) => spawnSync(process.execPath, [join(KERN, "brain.mjs"), "--vault", v, ...a], { encoding: "utf8", env: { ...GENV, BRAIN_APP_SUPPORT: support }, timeout: 90_000 });
  return { basis, v, support, brain };
}

test("einrichten speichert den Ordner im Support-Ordner, nicht in der Vault-Config", () => {
  const { basis, v, support, brain } = aufbau();
  const z = join(basis, "stick"); mkdirSync(z);
  const r = brain("backup", "einrichten", `ordner:${z}`);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`Sicherung eingerichtet: Ordner ${z}`));
  const cfg = JSON.parse(readFileSync(join(v, "brain.config.json"), "utf8"));
  assert.deepEqual(cfg.backup, { art: "ordner" }, "kein Pfad in der Vault-Config");
  const dateien = readdirSync(join(support, "backup"));
  assert.equal(dateien.length, 1);
  assert.equal(JSON.parse(readFileSync(join(support, "backup", dateien[0]), "utf8")).pfad, z);
  assert.equal(brain("backup").status, 0);
  assert.ok(existsSync(join(z, `brain-${ortstag()}.bundle`)), "Bundle mit dem Datum nach Ortszeit");
});

test("ein „pfad“ in der Vault-Config (fremde Daten) wird nicht benutzt: nichts wird geschrieben", () => {
  const { basis, v, brain } = aufbau();
  const fremd = join(basis, "fremd"); mkdirSync(fremd);
  const cfg = JSON.parse(readFileSync(join(v, "brain.config.json"), "utf8"));
  cfg.backup = { art: "ordner", pfad: fremd };
  writeFileSync(join(v, "brain.config.json"), JSON.stringify(cfg));
  const r = brain("backup");
  assert.match(r.stdout, /kein gültiger Sicherungsordner/);
  assert.deepEqual(readdirSync(fremd), [], "der Ordner aus der Vault-Config bekam nichts");
});

test("einrichten verweigert relative Pfade, Verweise und Dateien", () => {
  const { basis, brain } = aufbau();
  const echt = join(basis, "echt"); mkdirSync(echt);
  const verweis = join(basis, "verweis"); symlinkSync(echt, verweis);
  const datei = join(basis, "datei.txt"); writeFileSync(datei, "x");
  for (const p of ["relativ/ordner", verweis, datei]) {
    const r = brain("backup", "einrichten", `ordner:${p}`);
    assert.equal(r.status, 1, p);
    assert.match(r.stderr, /Sicherungsordner/, p);
  }
  assert.equal(pruefeBackupPfad(join(basis, "gibt-es-noch-nicht")), null, "ein Ordner, der noch nicht da ist (Stick), ist erlaubt");
});

test("wird der Ordner nach dem Einrichten durch einen Verweis ersetzt, sichert der Kern nicht dorthin", () => {
  const { basis, v, brain } = aufbau();
  const z = join(basis, "stick"); mkdirSync(z);
  assert.equal(brain("backup", "einrichten", `ordner:${z}`).status, 0);
  const ziel = join(basis, "anderswo"); mkdirSync(ziel);
  execFileSync("rm", ["-r", z]); symlinkSync(ziel, z);
  const r = brain("backup");
  assert.match(r.stdout, /kein gültiger Sicherungsordner/);
  assert.deepEqual(readdirSync(ziel), []);
  void v;
});
