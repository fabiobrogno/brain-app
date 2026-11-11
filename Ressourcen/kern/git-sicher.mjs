// git-sicher.mjs — die Vertrauensschranke vor git in Node: dieselben Regeln wie das Shell-Skript git-sicher (macOS/Linux), aber ohne /bin/sh, perl, find, awk.
// Unter Windows ist DAS der Weg, auf dem der Kern git startet: werkzeug.mjs#gitBefehl liefert dort einen kleinen .exe-Starter (windows-start.mjs), der
// `node git-sicher.mjs <Argumente>` ausführt. Eine Datei mit dem Namen git-sicher.mjs allein startet Windows aus Node nicht (nur .exe), und eine .cmd
// würde jedes Argument durch cmd.exe schicken (%, ^, &, ", Leerzeichen werden dort umgedeutet) — darum der Starter, siehe windows-start.cs.
//
// Die Regeln stehen im Kopf des Shell-Skripts git-sicher (Punkte 1 bis 5) und gelten hier unverändert:
//  1. git nur von festen Orten (nie ein Pfad aus dem Vault; BRAIN_GIT_PROGRAMM, BRAIN_GIT_HOOKS_ERLAUBT und BRAIN_TAGESLAUF_CACHE nur in der Testumgebung);
//     Windows: MinGit der App (<Support>/git, Rückfall ~/.brain-kit), dann ein git.exe in einem ABSOLUTEN PATH-Ordner, dann Program Files.
//  2. Erlaubnisliste der lokalen Repo-Konfiguration (git-sicher-pruefung.mjs, im selben Prozess), fail-closed: Exit 126 mit dem Namen des Schlüssels.
//  3. Befehlszeilen-Einstellungen, die die des Vaults schlagen (kein fsmonitor, keine Hooks außer dem Hook-Ordner dieses Kerns, kein ext::-Transport,
//     keine Submodule, keine Signierung) — für alle Unterbefehle außer `config` und `version`.
//  4. Lage- und Verweisprüfung (Arbeitsbaum über dem Ordner, Git-Verzeichnisse im Arbeitsbaum, keine alternates, keine Verweise im Git-Verzeichnis).
//  5. Geerbte GIT_DIR/GIT_WORK_TREE (außer im Hook) und GIT_CONFIG_* verworfen; kein Rückfragen-Prompt, kein Editor, kein Pager, ssh ohne Rückfrage.
// Abweichungen von der Shell-Fassung (nur, wo Windows es verlangt): Pfadvergleiche ohne Groß/klein und mit beiden Trennzeichen; Listen in
// BRAIN_GIT_HOOKS_ERLAUBT mit dem PATH-Trenner des Systems (Windows ";"); die Arbeitskopien des Tageslaufs liegen am Mac unter ~/Library/Caches/brain-tageslauf,
// sonst unter <Temp>/brain-tageslauf (wie pfade.mjs#tageslaufArbeitsbaumWurzeln).
// Tests: Tests/Kern/test-git-sicher-node.mjs (dieselben Fälle gegen das Shell-Skript und diese Fassung, unter Windows durch den Starter).
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, realpathSync, statSync, accessSync, constants } from "node:fs";
import { join, dirname, isAbsolute, resolve, delimiter } from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { sucheWindowsGit, tageslaufCache, keineHooks } from "./plattform.mjs";
import { pruefe } from "./git-sicher-pruefung.mjs";

const WIN = process.platform === "win32";
const NETZ = new Set(["fetch", "pull", "push", "clone", "ls-remote", "remote"]);

const roh = (p) => String(p).split("\\").join("/");
const falte = (p) => { let s = roh(p).replace(/\/+$/, ""); if (WIN) s = s.toLowerCase(); return s; };
const unter = (p, wurzel) => `${falte(p)}/`.startsWith(`${falte(wurzel)}/`);
const echt = (p) => { try { return realpathSync.native(p); } catch { return ""; } };
const ausfuehrbar = (p) => { try { if (!statSync(p).isFile()) return false; if (!WIN) accessSync(p, constants.X_OK); return true; } catch { return false; } };

export class Verweigert extends Error {}

// Test? Dann gelten die Testschalter (wie im Shell-Skript).
const testmodus = (env) => env.KORTEX_KERN_UNSTABIL_ERLAUBT === "1" || env.BRAIN_TESTMODUS === "1";

export function findeGit(env = process.env) {
  if (testmodus(env) && env.BRAIN_GIT_PROGRAMM) return isAbsolute(env.BRAIN_GIT_PROGRAMM) && ausfuehrbar(env.BRAIN_GIT_PROGRAMM) ? env.BRAIN_GIT_PROGRAMM : null;
  if (!WIN) return ["/opt/homebrew/bin/git", "/usr/local/bin/git", "/usr/bin/git"].find(ausfuehrbar) ?? null;
  return sucheWindowsGit(ausfuehrbar, { env }); // dieselbe Liste wie die Werkstatt (plattform.mjs)
}

// Unterbefehl und -C-Ordner aus den Optionen vor dem Unterbefehl
export function liesArgumente(argv) {
  let dir = ".", sub = "", skip = 0;
  for (const a of argv) {
    if (skip === "C") { dir = a; skip = 0; continue; }
    if (skip === 1) { skip = 0; continue; }
    if (a === "-C") skip = "C";
    else if (["-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix", "--config-env"].includes(a)) skip = 1;
    else if (a.startsWith("-")) continue;
    else { sub = a; break; }
  }
  return { dir, sub };
}

function lauf(git, args, { stdio = "inherit" } = {}) {
  const r = spawnSync(git, args, { stdio, windowsHide: true, env: process.env, encoding: stdio === "inherit" ? undefined : "utf8", maxBuffer: 64 * 1024 * 1024 });
  return r;
}
const exitVon = (r) => (r.error ? (r.error.code === "ENOENT" ? 127 : 126) : r.status ?? (r.signal ? 128 : 1));

// Erster Verweis im Git-Verzeichnis (ohne Objektinhalte und Hook-Dateien); wie `find -prune`: der Eintrag objects/ab selbst und hooks selbst werden geprüft, nicht, was darin liegt.
function ersterVerweis(wurzel) {
  const durch = (d) => {
    let namen;
    try { namen = readdirSync(d, { withFileTypes: true }); } catch { return null; }
    for (const e of namen) {
      const p = join(d, e.name);
      let st; try { st = lstatSync(p); } catch { continue; }
      if (st.isSymbolicLink()) return e.name;
      if (!st.isDirectory()) continue;
      const rel = roh(p).slice(roh(wurzel).length + 1);
      if (/^objects\/[^/][^/]$/.test(rel) || rel === "objects/pack" || rel === "hooks") continue;
      const treffer = durch(p);
      if (treffer) return treffer;
    }
    return null;
  };
  try { if (lstatSync(wurzel).isSymbolicLink()) return roh(wurzel).split("/").pop(); } catch { /* nicht lesbar: unten */ }
  return durch(wurzel);
}

// → Exit-Code. Schreibt Meldungen nach stderr.
export function sicher(argv, env = process.env) {
  const verweigere = (grund) => { process.stderr.write(`git-sicher: git ist für diesen Ordner gesperrt: ${grund}\n`); return 126; };
  const TEST = testmodus(env);
  const ECHT = findeGit(env);
  if (!ECHT) { process.stderr.write("git-sicher: git wurde nicht gefunden.\n"); return 127; }
  const { dir, sub } = liesArgumente(argv);
  if (sub === "" || sub === "version") return exitVon(lauf(ECHT, argv));

  // Geerbte Umlenkungen und eingeschleuste Konfiguration verwerfen (wirkt auf process.env: gilt für jedes Kind unten und für die Prüfung)
  for (const k of Object.keys(process.env)) if (/^GIT_CONFIG_(PARAMETERS|COUNT|KEY_\d+|VALUE_\d+)$/i.test(k)) delete process.env[k];
  if (process.env.GIT_INDEX_FILE && process.env.GIT_DIR) {
    const gd = echt(resolve(dir, process.env.GIT_DIR)), dd = echt(dir);
    if (!(gd && dd && unter(gd, dd))) { delete process.env.GIT_DIR; delete process.env.GIT_WORK_TREE; }
  } else { delete process.env.GIT_DIR; delete process.env.GIT_WORK_TREE; }
  if (sub === "help" || sub === "submodule") return verweigere(`der Unterbefehl ${sub} ist im Kern nicht vorgesehen.`);
  const kerndir = echt(dirname(fileURLToPath(import.meta.url)));

  let pruefen = false, hp = null;
  if (sub === "config") {
    const extern = argv.some((a) => ["--global", "--system", "--file", "-f", "--blob"].includes(a) || a.startsWith("--file=") || a.startsWith("--blob="));
    if (dir !== "." || !extern) pruefen = true;
  } else if (dir !== "." || (sub !== "init" && sub !== "clone" && sub !== "merge-file")) pruefen = true;

  if (pruefen && sub !== "config") {
    const res = pruefe(ECHT, dir, { env: process.env });
    if (res.exit !== 0) {
      const z = res.ausgabe.find((l) => l.startsWith("REFUSE\t"));
      return verweigere(`die Konfiguration enthält ${z ? z.slice(7) : "(Prüfung fehlgeschlagen)"}, das nicht auf der Erlaubnisliste harmloser Schlüssel steht.`);
    }
    const h = res.ausgabe.find((l) => l.startsWith("HOOKSPATH\t"));
    if (h) hp = h.slice(10);
  }

  if (pruefen) {
    const r = lauf(ECHT, ["-C", dir, "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir", "--absolute-git-dir"], { stdio: ["ignore", "pipe", "ignore"] });
    const zeilen = r.status === 0 ? String(r.stdout).split("\n").map((z) => z.replace(/\r$/, "")) : [];
    let [top, common, gitdir] = zeilen;
    if (!top || !common || !gitdir) {
      if (!["init", "clone", "config"].includes(sub)) return verweigere("kein Arbeitsbaum festzustellen (kein Repository oder nicht lesbar).");
    } else {
      top = echt(top); common = echt(common); gitdir = echt(gitdir);
      const hier = echt(dir);
      if (!top || !common || !gitdir || !hier) return verweigere("Arbeitsbaum oder Git-Verzeichnis sind nicht lesbar.");
      if (!unter(hier, top)) return verweigere(`der Arbeitsbaum (${roh(top)}) liegt nicht über dem Ordner (${roh(hier)}).`);
      const cache = echt(tageslaufCache({ env }));
      const cache2 = TEST && env.BRAIN_TAGESLAUF_CACHE ? echt(env.BRAIN_TAGESLAUF_CACHE) : "";
      const kopie = [cache, cache2].some((c) => c && unter(top, c));
      if (!kopie) {
        if (!unter(common, top)) return verweigere(`das Git-Verzeichnis (${roh(common)}) liegt außerhalb des Arbeitsbaums (${roh(top)}).`);
        if (!unter(gitdir, top)) return verweigere(`das Git-Verzeichnis dieses Arbeitsbaums (${roh(gitdir)}) liegt außerhalb des Arbeitsbaums (${roh(top)}).`);
      }
      if (existsSync(join(common, "objects", "info", "alternates"))) return verweigere("objects/info/alternates verweist auf fremde Objekte.");
      const dirs = [common];
      if (falte(gitdir) !== falte(common) && !unter(gitdir, common)) dirs.push(gitdir);
      for (const d of dirs) {
        const v = ersterVerweis(d);
        if (v) return verweigere(`im Git-Verzeichnis liegt ein Verweis (${v}); git würde darüber nach draußen schreiben.`);
      }
    }
  }

  if (sub === "config") return exitVon(lauf(ECHT, argv));

  Object.assign(process.env, { GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: ":", GIT_SEQUENCE_EDITOR: ":", GIT_PAGER: "cat", GIT_NO_LAZY_FETCH: "1" });
  if (!process.env.GIT_SSH_COMMAND) {
    let ssh = "";
    if (NETZ.has(sub)) {
      const r = lauf(ECHT, ["-c", "core.fsmonitor=false", "config", "--global", "--get", "core.sshcommand"], { stdio: ["ignore", "pipe", "ignore"] });
      if (r.status === 0) ssh = String(r.stdout).replace(/\r?\n+$/, "");
    }
    process.env.GIT_SSH_COMMAND = ssh || "ssh -o BatchMode=yes";
  }

  // Hooks nur aus dem Hook-Ordner dieses Kerns (oder, nur im Test, aus den ausdrücklich erlaubten Ordnern)
  let HOOKS = keineHooks({ env });
  if (hp && isAbsolute(hp)) {
    const real = echt(hp);
    if (real && kerndir && falte(real) === falte(join(kerndir, "git-hooks"))) HOOKS = real;
    if (TEST && real && env.BRAIN_GIT_HOOKS_ERLAUBT) {
      for (const h of env.BRAIN_GIT_HOOKS_ERLAUBT.split(delimiter)) if (h && echt(h) && falte(echt(h)) === falte(real)) HOOKS = real;
    }
  }
  return exitVon(lauf(ECHT, ["-c", "core.fsmonitor=false", "-c", `core.hooksPath=${HOOKS}`, "-c", "protocol.ext.allow=never",
    "-c", "submodule.recurse=false", "-c", "fetch.recurseSubmodules=false", "-c", "push.recurseSubmodules=no",
    "-c", "diff.ignoreSubmodules=all", "-c", "status.submoduleSummary=false", "-c", "safe.bareRepository=explicit",
    "-c", "commit.gpgSign=false", "-c", "tag.gpgSign=false", "-c", "push.gpgSign=false", ...argv]));
}

const direkt = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (direkt) { process.env.LC_ALL = "C"; process.exitCode = sicher(process.argv.slice(2)); }
