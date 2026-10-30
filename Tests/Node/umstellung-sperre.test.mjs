// Umstellung P7d (Review): die eigene Sperre von Phase B (.logs/umstellung-phase-b.lock). Die Werkstatt meldet 409 für Speichern/Abgleichen/Wiederherstellen/Posteingang-Commit, solange sie gilt;
// Lesen und Status bleiben frei. Nur Wegwerf-Vaults.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmp, schreibe, repo, pfad } from "./hilfe.mjs";

const { oeffneVault, HttpFehler } = await import(pfad("gemeinsam", "vault.mjs"));
const { umstellungLaeuft, SPERRE_DATEI } = await import(pfad("gemeinsam", "umstellung-sperre.mjs"));
const wirft = async (p) => { try { await p; } catch (e) { assert.ok(e instanceof HttpFehler, String(e && e.stack)); return e; } assert.fail("kein Fehler"); };

test("Sperre lesen: nur mit lebendem Prozess und frisch (höchstens 90 Minuten)", () => {
  const d = tmp();
  assert.equal(umstellungLaeuft(d), false, "keine Datei");
  mkdirSync(join(d, ".logs"));
  const f = join(d, SPERRE_DATEI);
  writeFileSync(f, JSON.stringify({ pid: process.pid, zeit: new Date().toISOString() }));
  assert.equal(umstellungLaeuft(d), true);
  writeFileSync(f, JSON.stringify({ pid: 2147483646, zeit: new Date().toISOString() }));
  assert.equal(umstellungLaeuft(d), false, "toter Prozess");
  writeFileSync(f, JSON.stringify({ pid: process.pid, zeit: new Date(Date.now() - 3 * 3600_000).toISOString() }));
  assert.equal(umstellungLaeuft(d), false, "zu alt");
  writeFileSync(f, "kein json");
  assert.equal(umstellungLaeuft(d), false, "kaputt");
});

test("Werkstatt: Commit, Abgleich, Wiederherstellen und Konflikt-Aktionen warten (409), solange Phase B läuft; danach geht alles wieder", async () => {
  const d = repo();
  const v = oeffneVault(d);
  schreibe(d, "a.md", "# a\n");
  mkdirSync(join(d, ".logs"), { recursive: true });
  const f = join(d, SPERRE_DATEI);
  writeFileSync(f, JSON.stringify({ pid: process.pid, zeit: new Date().toISOString() }));
  for (const [name, fn] of [["gitCommit", () => v.gitCommit({ nachricht: "x", dateien: ["a.md"] })], ["gitSync", () => v.gitSync({})], ["gitWiederherstellen", () => v.gitWiederherstellen({ pfad: "a.md", sha: "abc" })],
    ["gitKonfliktAbbrechen", () => v.gitKonfliktAbbrechen()], ["gitKonfliktAbschliessen", () => v.gitKonfliktAbschliessen({})]]) {
    const e = await wirft(fn());
    assert.equal(e.status, 409, name);
    assert.match(e.message, /räumt gerade/, name);
  }
  assert.equal((await v.gitStatus()).repo, true, "Status bleibt lesbar");
  assert.ok(existsSync(join(d, "a.md")));
  rmSync(f);
  const r = await v.gitCommit({ nachricht: "Nach der Sperre", dateien: ["a.md"] });
  assert.ok(r, "Commit geht wieder");
});
