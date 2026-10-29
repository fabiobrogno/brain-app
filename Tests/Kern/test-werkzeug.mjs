// test-werkzeug.mjs — gitBefehl(): git-sicher (macOS/Linux), MinGit-Ort oder "git" (win32); werkzeuge.git aus der Config zählt nie.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gitBefehl } from "../werkzeug.mjs";
import { KERN } from "../pfade.mjs";

test("gitBefehl: macOS/Linux → git-sicher im Kern (absolut, ausführbar), nie der nackte Name", () => {
  const home = mkdtempSync(join(tmpdir(), "wz-"));
  const p = gitBefehl({ plattform: "darwin", home });
  assert.equal(p, join(KERN, "git-sicher"));
  assert.ok(statSync(p).mode & 0o111, "git-sicher muss ausführbar sein");
});

test("gitBefehl: win32 ohne MinGit → 'git', mit MinGit → dessen absoluter Pfad", () => {
  const home = mkdtempSync(join(tmpdir(), "wz-"));
  assert.equal(gitBefehl({ plattform: "win32", home }), "git");
  const mingit = join(home, ".brain-kit", "git", "cmd");
  mkdirSync(mingit, { recursive: true });
  writeFileSync(join(mingit, "git.exe"), "");
  assert.equal(gitBefehl({ plattform: "win32", home }), join(mingit, "git.exe"));
});

test("gitBefehl: werkzeuge.git aus der Vault-Config wird NIE benutzt (auch cfg-Argumente nicht)", () => {
  const home = mkdtempSync(join(tmpdir(), "wz-"));
  const cfg = { werkzeuge: { git: "/ein/anderer/git" } };
  assert.equal(gitBefehl({ cfg, plattform: "darwin", home }), join(KERN, "git-sicher"));
  assert.equal(gitBefehl({ cfg, plattform: "win32", home }), "git");
  assert.equal(gitBefehl({ cfg: null, plattform: "darwin", home }), join(KERN, "git-sicher"));
  assert.equal(gitBefehl(), gitBefehl({ cfg: {} })); // Default-Parameter funktionieren ohne Argument
});
