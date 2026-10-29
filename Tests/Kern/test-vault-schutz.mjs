// test-vault-schutz.mjs — Schreibzugriffe des Kerns bleiben im Vault, auch tief im Baum (vault-schutz.mjs, Kern-Umzug P4).
// Ein fremder Vault bringt Verweise und Hardlinks mit: `.logs/werkzeug.log → ~/.zshrc`, `.logs/tageslauf → ~/Documents` …
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, symlinkSync, linkSync, existsSync, readdirSync, rmSync, renameSync, copyFileSync, openSync, closeSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pruefeVault } from "../pfade.mjs";
import { execFileSync } from "node:child_process";
import { sicheresZiel } from "../vault-schutz.mjs";
const lnS = (ziel, link) => execFileSync("ln", ["-s", ziel, link]);
const lnH = (ziel, link) => execFileSync("ln", [ziel, link]);
import { haengeAn } from "../logs.mjs";

function aufbau() {
  const basis = mkdtempSync(join(tmpdir(), "vault-schutz-"));
  const v = join(basis, "Vault");
  mkdirSync(join(v, ".logs"), { recursive: true });
  mkdirSync(join(v, "09_wiki", "firma"), { recursive: true });
  writeFileSync(join(v, "brain.config.json"), "{}\n");
  const aussen = join(basis, "aussen"); mkdirSync(aussen);
  writeFileSync(join(aussen, "ziel.txt"), "fremd\n");
  pruefeVault(v); // registriert den Vault für den Schutz
  return { basis, v, aussen, ziel: join(aussen, "ziel.txt") };
}
const wirft = (f) => { try { f(); } catch (e) { return e; } return null; };

test("Verweis auf eine Datei außerhalb (tief im Baum): Anhängen, Schreiben, Kopieren, Umbenennen werden verweigert, nichts draußen ändert sich", () => {
  const { v, ziel } = aufbau();
  lnS(ziel, join(v, ".logs", "werkzeug.log"));
  lnS(ziel, join(v, "09_wiki", "firma", "_log.md"));
  for (const p of [join(v, ".logs", "werkzeug.log"), join(v, "09_wiki", "firma", "_log.md")]) {
    assert.equal(wirft(() => appendFileSync(p, "böse\n"))?.code, "EVAULTSCHUTZ", p);
    assert.equal(wirft(() => writeFileSync(p, "böse\n"))?.code, "EVAULTSCHUTZ", p);
    assert.equal(wirft(() => writeFileSync(p, "böse\n", "utf8"))?.code, "EVAULTSCHUTZ", p);
    assert.equal(wirft(() => openSync(p, "a"))?.code, "EVAULTSCHUTZ", p);
    assert.equal(wirft(() => copyFileSync(join(v, "brain.config.json"), p))?.code, "EVAULTSCHUTZ", p);
  }
  haengeAn(join(v, ".logs", "werkzeug.log"), "zeile"); // wirft nie, schreibt aber nichts
  assert.equal(readFileSync(ziel, "utf8"), "fremd\n", "die Datei draußen blieb unverändert");
});

test("Verweis auf einen Ordner außerhalb: Anlegen, Schreiben, Löschen darin werden verweigert", () => {
  const { v, aussen, ziel } = aufbau();
  lnS(aussen, join(v, ".logs", "tageslauf"));
  lnS(aussen, join(v, "09_wiki", "firma", "belege"));
  for (const d of [join(v, ".logs", "tageslauf"), join(v, "09_wiki", "firma", "belege")]) {
    assert.equal(wirft(() => writeFileSync(join(d, "neu.txt"), "x"))?.code, "EVAULTSCHUTZ", d);
    assert.equal(wirft(() => mkdirSync(join(d, "unter", "tief"), { recursive: true }))?.code, "EVAULTSCHUTZ", d);
    assert.equal(wirft(() => unlinkSync(join(d, "ziel.txt")))?.code, "EVAULTSCHUTZ", d);
    assert.equal(wirft(() => rmSync(join(d, "ziel.txt"), { force: true }))?.code, "EVAULTSCHUTZ", d);
    assert.equal(wirft(() => renameSync(join(v, "brain.config.json"), join(d, "weg.json")))?.code, "EVAULTSCHUTZ", d);
  }
  assert.deepEqual(readdirSync(aussen), ["ziel.txt"], "draußen wurde nichts angelegt oder gelöscht");
  assert.equal(readFileSync(ziel, "utf8"), "fremd\n");
});

test("Hardlink auf eine Datei außerhalb: Anhängen und Schreiben werden verweigert", () => {
  const { v, ziel } = aufbau();
  lnH(ziel, join(v, ".logs", "hint.log"));
  assert.equal(wirft(() => appendFileSync(join(v, ".logs", "hint.log"), "böse\n"))?.code, "EVAULTSCHUTZ");
  assert.equal(wirft(() => writeFileSync(join(v, ".logs", "hint.log"), "böse\n"))?.code, "EVAULTSCHUTZ");
  haengeAn(join(v, ".logs", "hint.log"), "zeile");
  assert.equal(readFileSync(ziel, "utf8"), "fremd\n");
});

test("Verweis ins Leere (Ziel existiert noch nicht): Schreiben würde die Datei draußen anlegen → verweigert", () => {
  const { v, aussen } = aufbau();
  lnS(join(aussen, "gibt-es-nicht.txt"), join(v, ".logs", "neu.log"));
  assert.equal(wirft(() => appendFileSync(join(v, ".logs", "neu.log"), "x"))?.code, "EVAULTSCHUTZ");
  assert.equal(existsSync(join(aussen, "gibt-es-nicht.txt")), false);
});

test("normale Schreibzugriffe laufen weiter: Dateien, Anhängen, Ordner, Umbenennen, Löschen, Verweise innerhalb des Vaults, Pfade außerhalb des Vaults", () => {
  const { v, basis } = aufbau();
  const p = join(v, ".logs", "a", "b.log");
  mkdirSync(join(v, ".logs", "a"), { recursive: true });
  writeFileSync(p, "eins\n"); appendFileSync(p, "zwei\n"); appendFileSync(p, "drei\n", "utf8");
  assert.equal(readFileSync(p, "utf8"), "eins\nzwei\ndrei\n");
  const fd = openSync(join(v, ".logs", "sperre"), "wx"); closeSync(fd);
  assert.equal(wirft(() => openSync(join(v, ".logs", "sperre"), "wx"))?.code, "EEXIST", "wx bleibt exklusiv");
  renameSync(p, join(v, ".logs", "a", "c.log"));
  mkdirSync(join(v, "echt")); lnS(join(v, "echt"), join(v, ".logs", "innen"));
  writeFileSync(join(v, ".logs", "innen", "d.txt"), "im Vault"); // Verweis, der im Vault bleibt
  assert.equal(readFileSync(join(v, "echt", "d.txt"), "utf8"), "im Vault");
  unlinkSync(join(v, ".logs", "a", "c.log"));
  haengeAn(join(v, ".logs", "hook.log"), "zeile");
  assert.match(readFileSync(join(v, ".logs", "hook.log"), "utf8"), /^zeile\n$/);
  const draussen = join(basis, "ausserhalb.txt"); writeFileSync(draussen, "ok"); appendFileSync(draussen, "!");
  assert.equal(readFileSync(draussen, "utf8"), "ok!");
});

test("sicheresZiel: Pfade außerhalb eines geprüften Vaults sind nicht betroffen", () => {
  aufbau();
  assert.equal(sicheresZiel(join(tmpdir(), "irgendwo", "x.txt")), undefined);
});

test("im Kindprozess (brain.mjs): ein Verweis tief in .logs wird beim Befehl nicht beschrieben", async () => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const kern = fileURLToPath(new URL("..", import.meta.url));
  const { v, aussen, ziel } = aufbau();
  for (const n of ["hint.log", "hooks.log", "werkzeug.log", "tageslauf.log", "feedback.log", "gesundheit.json", "status.json"]) lnS(ziel, join(v, ".logs", n));
  for (const a of [["status", "--json"], ["gesundheit", "--json"], ["rueckfragen", "liste"], ["search", "x"], ["pflege"]]) {
    spawnSync(process.execPath, [join(kern, "brain.mjs"), "--vault", v, ...a], { encoding: "utf8", timeout: 90_000, env: { ...process.env } });
  }
  assert.equal(readFileSync(ziel, "utf8"), "fremd\n", "die Datei draußen blieb unverändert");
  assert.deepEqual(readdirSync(aussen), ["ziel.txt"]);
});
