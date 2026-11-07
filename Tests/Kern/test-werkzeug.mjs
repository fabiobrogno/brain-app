// test-werkzeug.mjs — gitBefehl(): git-sicher (macOS/Linux), der .exe-Starter dafür (win32); werkzeuge.git aus der Config zählt nie.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gitBefehl } from "../werkzeug.mjs";
import { KERN } from "../pfade.mjs";
import { nurUnix } from "./nur-unix.mjs";

test("gitBefehl: macOS/Linux → git-sicher im Kern (absolut, ausführbar), nie der nackte Name", { skip: nurUnix("Ausführbarkeits-Bit gibt es unter Windows nicht") }, () => {
  const home = mkdtempSync(join(tmpdir(), "wz-"));
  const p = gitBefehl({ plattform: "darwin", home });
  assert.equal(p, join(KERN, "git-sicher"));
  assert.ok(statSync(p).mode & 0o111, "git-sicher muss ausführbar sein");
});

test("gitBefehl: win32 → der Starter git-sicher.exe im Support-Ordner (nie 'git', nie MinGit direkt: die Schranke liegt davor); der echte git wird von git-sicher.mjs gesucht", () => {
  const home = mkdtempSync(join(tmpdir(), "wz-"));
  const p = gitBefehl({ plattform: "win32", home, ohneVault: true });
  assert.match(p.split("\\").join("/"), /\/git-sicher\/[^/]+\/git-sicher\.exe$/);
  assert.notEqual(p, "git");
});

test("gitBefehl: werkzeuge.git aus der Vault-Config wird NIE benutzt (auch cfg-Argumente nicht)", () => {
  const home = mkdtempSync(join(tmpdir(), "wz-"));
  const cfg = { werkzeuge: { git: "/ein/anderer/git" } };
  assert.equal(gitBefehl({ cfg, plattform: "darwin", home }), join(KERN, "git-sicher"));
  assert.match(gitBefehl({ cfg, plattform: "win32", home, ohneVault: true }).split("\\").join("/"), /\/git-sicher\.exe$/);
  assert.equal(gitBefehl({ cfg: null, plattform: "darwin", home }), join(KERN, "git-sicher"));
  assert.equal(gitBefehl(), gitBefehl({ cfg: {} })); // Default-Parameter funktionieren ohne Argument
});
