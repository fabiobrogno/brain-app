// hooks-pfad-windows.test.mjs — `core.hooksPath=/dev/null` darf unter Windows keinen Hook aus <Laufwerk>:\dev\null\<hook> starten (Befund des Reviews zu PR #117).
// Git for Windows könnte "/dev/null/pre-commit" als <aktuelles Laufwerk>:\dev\null\pre-commit auflösen; normale Nutzer dürfen unter C:\ Ordner anlegen. Dieser Test legt dort
// einen Hook mit Marke an und commitet über die Werkstatt (gemeinsam/git.mjs, ohne Vertrauen). Die Marke darf nie entstehen. Kontrolle: derselbe Hook läuft, wenn der Ordner ausdrücklich
// als hooksPath gesetzt ist. Der Kern-Weg (Starter) steht in Tests/Kern/test-git-sicher-node.mjs. Nur Windows.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { pfad } from "./hilfe.mjs";

const WIN = process.platform === "win32";
const roh = (p) => String(p).split("\\").join("/");

test("Windows: ein Hook unter <Laufwerk>:\\dev\\null\\ läuft nie (Werkstatt, ohne Vertrauen)", { skip: WIN ? false : "nur Windows" }, async () => {
  const { git } = await import(pfad("gemeinsam", "git.mjs"));
  const basis = realpathSync.native(mkdtempSync(join(tmpdir(), "hk-")));
  const marke = join(basis, "MARKE.txt");
  const v = join(basis, "Vault"); mkdirSync(v);
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", HOME: basis, USERPROFILE: basis };
  for (const k of Object.keys(env)) if (/^(GIT_(?!CONFIG_NOSYSTEM)|XDG_|CLAUDE_CONFIG_DIR$|CODEX_HOME$)/i.test(k)) delete env[k];
  const g = (...a) => execFileSync("git", ["-C", v, "-c", "user.name=T", "-c", "user.email=t@example.org", ...a], { env, stdio: "ignore", windowsHide: true });
  g("init", "-q", "-b", "main"); g("config", "user.name", "T"); g("config", "user.email", "t@example.org"); // lokal: die Werkstatt prüft die Konfiguration nicht, sie braucht nur eine Identität
  const laufwerke = [...new Set([`${process.env.SystemDrive || "C:"}`, v.slice(0, 2)].map((d) => d.toUpperCase()))];
  const angelegt = [];
  try {
    for (const d of laufwerke) {
      const wurzel = `${d}\\dev`;
      if (existsSync(wurzel)) continue; // nie etwas Vorhandenes anfassen
      mkdirSync(`${wurzel}\\null`, { recursive: true }); angelegt.push(wurzel);
      writeFileSync(`${wurzel}\\null\\pre-commit`, `#!/bin/sh\necho hook-${d[0]} >> '${roh(marke)}'\n`);
    }
    assert.ok(angelegt.length > 0, "kein Laufwerk, auf dem sich ein Hook-Ordner anlegen ließ");
    // Kontrolle: derselbe Hook läuft, wenn der Ordner ausdrücklich Hook-Ordner ist
    writeFileSync(join(v, "k.md"), "k\n"); g("add", "--", "k.md");
    g("-c", `core.hooksPath=${roh(angelegt[0])}/null`, "commit", "-q", "-m", "kontrolle");
    assert.ok(existsSync(marke), "Kontrolle: der Hook läuft nicht einmal, wenn er ausdrücklich gesetzt ist");
    rmSync(marke);
    // Werkstatt: ohne Vertrauen (OHNE_HOOKS) und im vertrauten Vault mit ohneHooks
    for (const opt of [{ vertraut: false }, { vertraut: true, ohneHooks: true }]) {
      writeFileSync(join(v, `w-${Object.keys(opt).length}.md`), "w\n");
      await git(v, ["add", "--", "."], opt);
      const r = await git(v, ["commit", "-q", "-m", "werkstatt"], opt);
      assert.equal(r.code, 0, r.stderr);
      assert.equal(existsSync(marke), false, `Hook aus ${angelegt.join(", ")}\\null lief (${JSON.stringify(opt)}): ${existsSync(marke) ? readFileSync(marke, "utf8") : ""}`);
    }
  } finally {
    for (const w of angelegt) rmSync(w, { recursive: true, force: true });
  }
});
