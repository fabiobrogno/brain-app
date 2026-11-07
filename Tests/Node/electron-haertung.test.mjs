// Beta-Härtung der Electron-Hülle (electron/): Fuses je Variante, Argumente des Paketbaus, Debug-Sperre im Paket, Meldung nach wiederholten Abstürzen der Werkstatt.
// Die echte App (Herunterfahren sichert) prüft electron/test/huelle.spec.mjs, das gebaute Paket mit den Fuses der Job „paket“.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const W = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const laden = (rel) => import(pathToFileURL(join(W, rel)).href);
const temp = () => realpathSync(mkdtempSync(join(tmpdir(), "kortex-haertung-test-")));
const { fusesFuer, baueKonfig } = await laden("electron/paket/konfig.mjs");
const { stageRessourcen } = await laden("electron/paket/ressourcen.mjs");
const { starteBruecke } = await laden("electron/bruecke.mjs");

test("Fuses: Release schaltet RunAsNode, NODE_OPTIONS, Inspect und file://-Sonderrechte ab und prüft/lädt nur das asar; die Test-Variante lässt allein Inspect offen", () => {
  const r = fusesFuer("release"), t = fusesFuer("test");
  assert.deepEqual(r, { runAsNode: false, enableNodeOptionsEnvironmentVariable: false, enableNodeCliInspectArguments: false, enableEmbeddedAsarIntegrityValidation: true, onlyLoadAppFromAsar: true, grantFileProtocolExtraPrivileges: false });
  assert.deepEqual(Object.keys(r).filter((k) => r[k] !== t[k]), ["enableNodeCliInspectArguments"]);
  assert.equal(t.enableNodeCliInspectArguments, true);
  assert.throws(() => fusesFuer("irgendwas"), /Unbekannte/);
  assert.equal(baueKonfig({ version: "1.0.0", ressourcen: "r", ausgabe: "a" }).electronFuses.enableNodeCliInspectArguments, false, "ohne Angabe gilt Release");
  assert.equal(baueKonfig({ version: "1.0.0", ressourcen: "r", ausgabe: "a", fuses: "test" }).electronFuses.enableNodeCliInspectArguments, true);
});

test("Paketbau: --generic-url nur mit 127.0.0.1, --fuses nur release|test; paket.json nennt die Variante; im Paket keine DevTools und keine Debug-Anschlüsse", () => {
  const lauf = (...a) => spawnSync(process.execPath, [join(W, "electron/paket/baue.mjs"), "linux", ...a], { encoding: "utf8", cwd: W });
  for (const url of ["http://fremd.example/x", "https://127.0.0.1:1", "http://127.0.0.1.fremd.example:1", "http://localhost:1"]) assert.match(lauf("--generic-url", url).stderr, /--generic-url/, url);
  assert.match(lauf("--fuses", "egal").stderr, /--fuses/);
  const d = temp();
  stageRessourcen({ wurzel: W, ziel: join(d, "a"), version: "1.0.0" });
  stageRessourcen({ wurzel: W, ziel: join(d, "b"), version: "1.0.0", fuses: "test" });
  assert.deepEqual([JSON.parse(readFileSync(join(d, "a", "paket.json"), "utf8")), JSON.parse(readFileSync(join(d, "b", "paket.json"), "utf8"))], [{ fuses: "release" }, { fuses: "test" }]);
  const haupt = readFileSync(join(W, "electron/haupt.mjs"), "utf8");
  assert.match(haupt, /const ENTWICKLER = !app\.isPackaged;/, "KORTEX_ENTWICKLER öffnet im Paket keine DevTools");
  assert.match(haupt, /PAKET_FUSES !== "test" && process\.argv\.some\(\(a\) => \/\^--\(inspect\|remote-debugging-/, "im Paket beendet sich die App bei --inspect/--remote-debugging-port");
});

test("Werkstatt stürzt dreimal in 60 s ab: die Hülle bekommt genau eine Meldung (beiZuvieleAbstuerzen), die Anfragen scheitern danach mit Grund", async () => {
  const d = temp(), skript = join(d, "absturz.mjs");
  writeFileSync(skript, `console.log(JSON.stringify({ bereit: true, version: "t", vaultId: null })); setTimeout(() => process.exit(3), 50);`);
  let meldungen = 0;
  const b = starteBruecke({ programm: process.execPath, skript, vault: d, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot }, beiZuvieleAbstuerzen: () => { meldungen++; } });
  const bis = Date.now() + 15_000;
  while (meldungen === 0 && Date.now() < bis) await new Promise((ok) => setTimeout(ok, 50));
  assert.equal(meldungen, 1);
  await assert.rejects(b.anfrage({ methode: "GET", pfad: "/api/info" }), /stürzt immer wieder ab/);
  await b.beende();
});
