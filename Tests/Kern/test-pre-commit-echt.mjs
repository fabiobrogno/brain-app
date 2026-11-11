// Der ECHTE pre-commit des Kerns (git-hooks/pre-commit + commit-pruefung.mjs) auf jedem System, mit Node NICHT im PATH (R4-8, Review): die Windows- und Linux-Pakete bringen ihr eigenes Node mit
// (<Support>/bin/node[.exe]); der Hook muss es neben dem Kern finden, sonst bräche jeder Vault-Commit ab oder (schlimmer) die Prüfung liefe nicht. Ein Secret im Commit muss ihn rot machen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, copyFileSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, delimiter } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const WIN = process.platform === "win32";
const KERN = join(dirname(fileURLToPath(import.meta.url)), "..");
const temp = () => realpathSync(mkdtempSync(join(tmpdir(), "pre-commit-echt-")));

// Pfad des git-Programms und PATH ohne Node: nur git, Systemordner
function gitUndPfad() {
  const w = spawnSync(WIN ? "where" : "which", ["git"], { encoding: "utf8", windowsHide: true });
  const git = String(w.stdout).split(/\r?\n/)[0].trim();
  const sys = WIN ? [`${process.env.SystemRoot}\\System32`, process.env.SystemRoot] : ["/usr/bin", "/bin"];
  if (WIN) return { git, pfad: [dirname(git), ...sys].join(delimiter) }; // Git for Windows: Ordner "cmd", dort liegt kein Node
  // Unix: git kann neben einem Node liegen (Homebrew, /usr/local/bin): ein eigener Ordner nur mit git
  const bin = temp();
  symlinkSync(git, join(bin, "git"));
  return { git: join(bin, "git"), pfad: [bin, ...sys].join(delimiter) };
}
// Der Test beweist nur etwas, wenn im PATH wirklich kein Node steht
function nodeImPfad(pfad) {
  return spawnSync(WIN ? "where" : "sh", WIN ? ["node"] : ["-c", "command -v node"], { env: { PATH: pfad, SystemRoot: process.env.SystemRoot }, encoding: "utf8", windowsHide: true }).status === 0;
}

// Support-Ordner wie nach dem Start der App: bin/node[.exe], bin/kern (Kopie des Kerns) — als echter Ordner (ein Verweis würde nur ein zweites Mal geprüft)
function aufbau() {
  const support = temp();
  mkdirSync(join(support, "bin"), { recursive: true });
  if (WIN) copyFileSync(process.execPath, join(support, "bin", "node.exe")); else symlinkSync(process.execPath, join(support, "bin", "node"));
  cpSync(KERN, join(support, "bin", "kern"), { recursive: true, filter: (q) => !/[\\/](tests?|node_modules)([\\/]|$)/.test(q) });
  const vault = temp();
  const { git, pfad } = gitUndPfad();
  const env = { PATH: pfad, SystemRoot: process.env.SystemRoot, HOME: temp(), USERPROFILE: temp(), BRAIN_APP_SUPPORT: join(support, "nichts"), BRAIN_TESTMODUS: "1", KORTEX_VAULT_VERTRAUT: "alle", GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.org", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.org" };
  const g = (...a) => spawnSync(git, ["-C", vault, "-c", "core.autocrlf=false", ...a], { encoding: "utf8", env, windowsHide: true });
  g("init", "-q", "-b", "main");
  g("config", "core.hooksPath", join(support, "bin", "kern", "git-hooks"));
  writeFileSync(join(vault, "brain.config.json"), "{}\n");
  mkdirSync(join(vault, "09_wiki"), { recursive: true });
  return { support, vault, g, pfad };
}

test("echter pre-commit ohne Node im PATH: ein Secret im Commit macht ihn rot, ein sauberer Commit geht durch", () => {
  const t = aufbau();
  assert.equal(nodeImPfad(t.pfad), false, "Testvoraussetzung: kein Node im PATH");
  try {
    const kopf = (n) => `---\nname: ${n}\ndescription: ${n}\n---\n`;
    writeFileSync(join(t.vault, "09_wiki", "gut.md"), `${kopf("gut")}# Gut\n\nNichts Geheimes.\n`);
    t.g("add", "--", "09_wiki/gut.md", "brain.config.json");
    const gut = t.g("commit", "-q", "-m", "gut");
    assert.equal(gut.status, 0, `${gut.stdout}${gut.stderr}`);
    writeFileSync(join(t.vault, "09_wiki", "geheim.md"), `${kopf("geheim")}# Geheim\n\n${"Mein Pass" + "wort lautet: " + "Wiesel" + "4711!"}\n`);
    t.g("add", "--", "09_wiki/geheim.md");
    const rot = t.g("commit", "-q", "-m", "geheim");
    assert.notEqual(rot.status, 0, "der Commit mit dem Secret muss scheitern");
    assert.match(`${rot.stdout}${rot.stderr}`, /SECRETS/);
    assert.equal(t.g("rev-list", "--count", "HEAD").stdout.trim(), "1", "kein zweiter Commit");
  } finally { rmSync(t.support, { recursive: true, force: true }); rmSync(t.vault, { recursive: true, force: true }); }
});

test("echter pre-commit: ohne irgendein Node blockiert er den Commit mit Erklärung (fail closed)", () => {
  const t = aufbau();
  try {
    rmSync(join(t.support, "bin", WIN ? "node.exe" : "node"), { force: true });
    writeFileSync(join(t.vault, "09_wiki", "x.md"), "# X\n");
    t.g("add", "--", "09_wiki/x.md");
    const r = t.g("commit", "-q", "-m", "x");
    assert.notEqual(r.status, 0);
    assert.match(`${r.stdout}${r.stderr}`, /Node wurde nicht gefunden/);
  } finally { rmSync(t.support, { recursive: true, force: true }); rmSync(t.vault, { recursive: true, force: true }); }
});
