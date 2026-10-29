// test-vault-schutz-weitere.mjs — weitere schreibende Wege (Review 3): utimes, chmod, symlink, link, Callback, Promise, Stream, URL, Buffer.
// Feindliche Verweise legt der Test mit `ln` an (die fs-Funktionen sind nach pruefeVault selbst geschützt).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, symlinkSync, linkSync, readdirSync, statSync, utimesSync, chmodSync,
  createWriteStream, writeFile as writeFileCb, appendFile as appendFileCb } from "node:fs";
import { writeFile as writeFilePromise, appendFile as appendFilePromise, mkdir as mkdirPromise, rm as rmPromise, utimes as utimesPromise,
  chmod as chmodPromise, symlink as symlinkPromise } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { pruefeVault } from "../pfade.mjs";

const lnS = (ziel, link) => execFileSync("ln", ["-s", ziel, link]);
const lnH = (ziel, link) => execFileSync("ln", [ziel, link]);
function aufbau() {
  const basis = mkdtempSync(join(tmpdir(), "vault-schutz2-"));
  const v = join(basis, "Vault");
  mkdirSync(join(v, ".logs"), { recursive: true });
  writeFileSync(join(v, "brain.config.json"), "{}\n");
  const aussen = join(basis, "aussen"); mkdirSync(aussen);
  writeFileSync(join(aussen, "ziel.txt"), "fremd\n");
  pruefeVault(v);
  return { basis, v, aussen, ziel: join(aussen, "ziel.txt") };
}
const wirft = (f) => { try { f(); } catch (e) { return e; } return null; };

test("utimes und chmod auf einen Verweis/Hardlink nach außen werden verweigert (Zeit und Rechte der Datei draußen bleiben)", () => {
  const { v, ziel } = aufbau();
  lnS(ziel, join(v, ".logs", "x.log")); lnH(ziel, join(v, ".logs", "h.log"));
  const vorher = statSync(ziel);
  assert.equal(wirft(() => utimesSync(join(v, ".logs", "x.log"), new Date(0), new Date(0)))?.code, "EVAULTSCHUTZ");
  assert.equal(wirft(() => chmodSync(join(v, ".logs", "x.log"), 0o777))?.code, "EVAULTSCHUTZ");
  assert.equal(wirft(() => chmodSync(join(v, ".logs", "h.log"), 0o777))?.code, "EVAULTSCHUTZ", "Hardlink");
  const nachher = statSync(ziel);
  assert.equal(nachher.mode, vorher.mode); assert.equal(nachher.mtimeMs, vorher.mtimeMs);
});

test("symlinkSync/linkSync im Vault: Ziel außerhalb wird verweigert, innerhalb erlaubt", () => {
  const { v, aussen, ziel } = aufbau();
  assert.equal(wirft(() => symlinkSync(ziel, join(v, ".logs", "neu")))?.code, "EVAULTSCHUTZ", "Verweis mit Ziel draußen");
  assert.equal(wirft(() => symlinkSync("../../aussen/ziel.txt", join(v, ".logs", "rel")))?.code, "EVAULTSCHUTZ", "relatives Ziel nach draußen");
  assert.equal(wirft(() => linkSync(ziel, join(v, ".logs", "hart")))?.code, "EVAULTSCHUTZ", "Hardlink auf eine Datei draußen");
  lnS(aussen, join(v, ".logs", "tor"));
  assert.equal(wirft(() => symlinkSync(join(v, "brain.config.json"), join(v, ".logs", "tor", "innen")))?.code, "EVAULTSCHUTZ", "Weg über einen Verweis nach außen");
  symlinkSync(join(v, "brain.config.json"), join(v, ".logs", "ok")); // innerhalb: erlaubt
  symlinkSync("../brain.config.json", join(v, ".logs", "ok-relativ")); // relativ, bleibt im Vault
  assert.deepEqual(readdirSync(aussen), ["ziel.txt"]);
});

test("Callback- und Promise-Varianten, createWriteStream, URL- und Buffer-Pfade sind ebenso geschützt", async () => {
  const { v, aussen, ziel } = aufbau();
  const d = join(v, ".logs", "d.log");
  lnS(ziel, d); lnS(aussen, join(v, ".logs", "ordner"));
  for (const z of [d, pathToFileURL(d), Buffer.from(d)]) {
    await assert.rejects(writeFilePromise(z, "böse"), { code: "EVAULTSCHUTZ" });
    await assert.rejects(appendFilePromise(z, "böse"), { code: "EVAULTSCHUTZ" });
    assert.equal(wirft(() => appendFileSync(z, "böse"))?.code, "EVAULTSCHUTZ");
    assert.equal((await new Promise((ok) => writeFileCb(z, "böse", (e) => ok(e))))?.code, "EVAULTSCHUTZ");
    assert.equal((await new Promise((ok) => appendFileCb(z, "böse", (e) => ok(e))))?.code, "EVAULTSCHUTZ");
    assert.equal(wirft(() => createWriteStream(z))?.code, "EVAULTSCHUTZ");
  }
  await assert.rejects(mkdirPromise(join(v, ".logs", "ordner", "neu")), { code: "EVAULTSCHUTZ" });
  await assert.rejects(rmPromise(join(v, ".logs", "ordner", "ziel.txt")), { code: "EVAULTSCHUTZ" });
  await assert.rejects(utimesPromise(d, new Date(0), new Date(0)), { code: "EVAULTSCHUTZ" });
  await assert.rejects(chmodPromise(d, 0o777), { code: "EVAULTSCHUTZ" });
  await assert.rejects(symlinkPromise(ziel, join(v, ".logs", "p")), { code: "EVAULTSCHUTZ" });
  assert.equal(readFileSync(ziel, "utf8"), "fremd\n");
  assert.deepEqual(readdirSync(aussen), ["ziel.txt"]);
  // normale Wege laufen weiter
  await writeFilePromise(join(v, ".logs", "gut.txt"), "a"); await appendFilePromise(join(v, ".logs", "gut.txt"), "b");
  await new Promise((ok, nein) => writeFileCb(join(v, ".logs", "cb.txt"), "c", (e) => (e ? nein(e) : ok())));
  await new Promise((ok, nein) => { const s = createWriteStream(join(v, ".logs", "strom.txt")); s.on("error", nein); s.on("finish", ok); s.end("d"); });
  assert.equal(readFileSync(join(v, ".logs", "gut.txt"), "utf8"), "ab");
  assert.equal(readFileSync(join(v, ".logs", "cb.txt"), "utf8"), "c");
  assert.equal(readFileSync(join(v, ".logs", "strom.txt"), "utf8"), "d");
});
