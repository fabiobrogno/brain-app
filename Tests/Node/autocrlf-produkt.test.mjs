// R4-8 (Review): Zeilenenden sind eine Sache des Produkts, nicht der CI. Git for Windows hat `core.autocrlf=true` als Vorgabe: Wiederherstellen, Verlauf und Diff lieferten Text mit \r.
// Die Werkstatt (gemeinsam/git.mjs) und die Vertrauensschranke des Kerns (git-sicher, git-sicher.mjs) setzen darum `-c core.autocrlf=false` fest. Hier steht autocrlf=true in der GLOBALEN
// Konfiguration des Benutzers (GIT_CONFIG_GLOBAL) — und trotzdem kommt LF an.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { pfad } from "./hilfe.mjs";

const temp = () => realpathSync(mkdtempSync(join(tmpdir(), "autocrlf-")));
const KONF = join(temp(), "gitconfig");
writeFileSync(KONF, "[core]\n\tautocrlf = true\n");
process.env.GIT_CONFIG_GLOBAL = KONF;
process.env.GIT_CONFIG_NOSYSTEM = "1";
const G = await import(pfad("gemeinsam", "git.mjs").replaceAll("\\", "/").replace(/^/, "file:///").replace("file:////", "file:///"));
const roh = (cwd, ...a) => execFileSync("git", ["-C", cwd, "-c", "core.autocrlf=false", ...a], { encoding: "utf8", windowsHide: true });

test("Werkstatt: die Argumente jedes git-Aufrufs enthalten core.autocrlf=false", () => {
  const paare = G.HAERTUNG.GRUND.join(" ");
  assert.ok(paare.includes("core.autocrlf=false"), paare);
});

test("Wiederherstellen aus dem Verlauf liefert LF, auch wenn der Benutzer autocrlf=true eingestellt hat", async () => {
  const v = temp();
  roh(v, "init", "-q", "-b", "main");
  roh(v, "config", "user.name", "T"); roh(v, "config", "user.email", "t@example.org"); roh(v, "config", "commit.gpgsign", "false");
  mkdirSync(join(v, "n"), { recursive: true });
  writeFileSync(join(v, "n", "a.md"), "# A\n\nZeile.\n");
  roh(v, "add", "--", "n/a.md");
  roh(v, "commit", "-q", "-m", "a");
  rmSync(join(v, "n", "a.md"));
  const r = await G.git(v, ["checkout", "--", "n/a.md"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(readFileSync(join(v, "n", "a.md"), "utf8"), "# A\n\nZeile.\n", "kein \\r");
  rmSync(v, { recursive: true, force: true });
});

test("Vertrauensschranke des Kerns: beide Fassungen (Skript und Node) starten git mit core.autocrlf=false", () => {
  for (const datei of ["git-sicher", "git-sicher.mjs"]) {
    const text = readFileSync(pfad("kern", datei), "utf8");
    assert.ok(text.includes("core.autocrlf=false"), datei);
  }
});
