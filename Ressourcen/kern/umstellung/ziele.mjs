// umstellung/ziele.mjs — „ein Code, zwei Ziele“ (Paket P7b, Plan docs/plaene/p7-umstellung.md Abschnitt 2.3): jeder Schritt der Umstellung bekommt ein `ziele`-Objekt und
// schreibt nur dorthin. Für das Original zeigt es auf den echten Vault und die echten Orte (Home, Support-Ordner, globale git-Konfiguration, LaunchAgents); für den
// Probelauf auf eine Kopie in Temp (eigener Support-Ordner, eigene globale git-Konfiguration, kein Netz, kein launchctl, Claude-Einstellungen nur im Speicher).
//
//   vault          der Vault, den die Schritte ändern (Original oder Kopie)
//   musterVault    der Vault, dessen Pfad in alten Einträgen steht (immer das Original – nur zum Erkennen)
//   home           Home des Nutzers (Original: gelesen und geschrieben; Probelauf: nur gelesen)
//   support        Ablage der Umstellung (Protokoll, Sicherungen, Merker, Datei je Vault für git) – Probelauf: ein Ordner in Temp
//   festSupport    Support-Ordner, auf den NEUE Einträge zeigen (Starter, Node, stabiler Kern) – auch im Probelauf der echte
//   kern, starter, node, mcpServer   die Ziele neuer Einträge (kern = stabiler Pfad bin/kern aus KORTEX_KERN_PFAD; null = kein stabiler Kern → nicht bereit)
//   gitGlobal      Datei der globalen git-Konfiguration (Original: ~/.gitconfig bzw. GIT_CONFIG_GLOBAL; Probelauf: Kopie in Temp)
//   claudeProfile  [{ pfad, name, standard }]
//   launchAgents   Ordner der plist (Original: ~/Library/LaunchAgents; Probelauf: Ordner in Temp)
//   schreibeClaude / schreibeMcp / launchctl   false im Probelauf: Claude-Einstellungen, MCP-Einträge und der Hintergrunddienst werden nicht verändert
//   env            Basis der Umgebung für Kindprozesse (PATH und Testhaken, nie Zugangsdaten)
import { realpathSync, lstatSync, readdirSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, resolve, dirname, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { supportOrdner, stabilerKern, starterPfad, KERN } from "../pfade.mjs";
import { echtesGit } from "./git-lage.mjs";
import { erkenneProfile, profileAusPfaden } from "./profile.mjs";

export const echt = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
// Wie befund.mjs und backup.mjs: die ersten 16 Hex-Zeichen des SHA-256 des aufgelösten Vault-Pfads.
export const kennung = (vault) => createHash("sha256").update(echt(vault)).digest("hex").slice(0, 16);

// Nur diese Variablen erbt ein Kindprozess (kein GIT_*, kein BRAIN_VAULT, keine Zugangsdaten); Testhaken nur, wenn sie gesetzt sind.
const ERBEN = ["PATH", "LANG", "LC_ALL", "TMPDIR", "TERM", "NODE_TEST_CONTEXT", "KORTEX_KERN_UNSTABIL_ERLAUBT", "KORTEX_KERN_TEMP_WURZELN", "KORTEX_STARTER_PFAD",
  "KORTEX_VAULT_VERTRAUT", "BRAIN_TESTMODUS", "BRAIN_LAUNCHCTL", "BRAIN_CLAUDE", "KORTEX_CODEX_PROGRAMM", "BRAIN_GIT_PROGRAMM", "BRAIN_GIT_HOOKS_ERLAUBT", "BRAIN_TAGESLAUF_CACHE",
  "BRAIN_EINMAL", "QMD_BIN", "FAKE_MCP_LOG", "FAKE_LAUNCHCTL_LOG"];
const TESTIDENTITAET = ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"];
export function basisUmgebung(env = process.env) {
  const aus = {};
  for (const k of ERBEN) if (typeof env[k] === "string") aus[k] = env[k];
  if (env.KORTEX_KERN_UNSTABIL_ERLAUBT === "1") for (const k of TESTIDENTITAET) if (typeof env[k] === "string") aus[k] = env[k];
  return aus;
}

export function echteZiele({ vault, home = homedir(), env = process.env, claudeHomes = null } = {}) {
  vault = resolve(vault);
  const support = supportOrdner({ home, env });
  const kern = stabilerKern({ env });
  let starter = null;
  try { starter = kern ? starterPfad({ env }) : null; } catch { starter = null; }
  const festSupport = kern ? dirname(dirname(kern)) : support;
  const gg = typeof env.GIT_CONFIG_GLOBAL === "string" && isAbsolute(env.GIT_CONFIG_GLOBAL) ? env.GIT_CONFIG_GLOBAL : join(home, ".gitconfig");
  return {
    probe: false, vault, musterVault: vault, home, support, festSupport, kern, starter,
    node: join(festSupport, "bin", "node"), mcpServer: kern ? join(kern, "mcp", "brain-mcp.mjs") : null,
    gitGlobal: gg, gitGlobalEnv: typeof env.GIT_CONFIG_GLOBAL === "string" && isAbsolute(env.GIT_CONFIG_GLOBAL),
    claudeProfile: claudeHomes && claudeHomes.length ? profileAusPfaden(claudeHomes, home) : erkenneProfile(home),
    launchAgents: join(home, "Library", "LaunchAgents"), launchAgentsQuelle: join(home, "Library", "LaunchAgents"),
    schreibeClaude: true, schreibeMcp: true, launchctl: true,
    env: basisUmgebung(env),
  };
}

// Die Ziele des Probelaufs: alles Schreibbare liegt unter `wurzel` (Temp), `kopie` ist der Klon des Vaults.
export function probeZiele(orig, { wurzel, kopie }) {
  return {
    ...orig, probe: true, vault: kopie, musterVault: orig.vault, probeWurzel: wurzel,
    support: join(wurzel, "support"), gitGlobal: join(wurzel, "gitconfig"), gitGlobalEnv: true, launchAgents: join(wurzel, "LaunchAgents"),
    schreibeClaude: false, schreibeMcp: false, launchctl: false,
    // kein bekanntes Protokoll erlaubt: selbst ein vergessenes Remote könnte nichts übertragen (git-sicher lässt die Variable unangetastet)
    env: { ...orig.env, GIT_ALLOW_PROTOCOL: "kortex-probelauf", GIT_AUTHOR_NAME: "Kortex Probelauf", GIT_AUTHOR_EMAIL: "probelauf@kortex.invalid", GIT_COMMITTER_NAME: "Kortex Probelauf", GIT_COMMITTER_EMAIL: "probelauf@kortex.invalid" },
  };
}

// Umgebung für Kindprozesse dieser Ziele (Node-Skripte des Kerns, git, claude/codex).
export function kindUmgebung(z, extra = {}) {
  const e = { ...z.env, HOME: z.home, USERPROFILE: z.home, BRAIN_APP_SUPPORT: z.support };
  if (z.kern) e.KORTEX_KERN_PFAD = z.kern;
  if (z.gitGlobalEnv) e.GIT_CONFIG_GLOBAL = z.gitGlobal;
  Object.assign(e, extra);
  for (const k of Object.keys(e)) if (e[k] === undefined || e[k] === null) delete e[k];
  return e;
}

// Ein Node-Skript des Kerns (z. B. install.mjs) mit den Umgebungen dieser Ziele starten. → { status, stdout, stderr }
export function kernSkript(z, rel, args, { extraEnv = {}, timeout = 120_000, cwd = z.home } = {}) {
  const r = spawnSync(process.execPath, [join(KERN, rel), ...args], { encoding: "utf8", env: kindUmgebung(z, extraEnv), cwd: existsSync(cwd) ? cwd : undefined, timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  return { status: r.status === null ? (r.error ? 127 : 1) : r.status, stdout: String(r.stdout || ""), stderr: String(r.stderr || "") };
}

// --- git ------------------------------------------------------------------------------------------------------------------------
// Der Kern startet git sonst nur über git-sicher, das genau die Vaults sperrt, die hier umgestellt werden. Darum: das echte git von festen Orten (wie der Befund),
// gehärtet (kein fsmonitor, keine Hooks, kein ext::), nur für Unterbefehle, die keinen Treiber aus dem Vault starten (config, bundle, ls-files, rev-parse, status, remote …).
export const HAERTUNG = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "protocol.ext.allow=never", "-c", "submodule.recurse=false",
  "-c", "diff.ignoreSubmodules=all", "-c", "status.submoduleSummary=false", "--no-optional-locks"];
export function gitLauf(z, args, { ordner = z.vault, timeout = 120_000, ohneOrdner = false } = {}) {
  const git = echtesGit(z.env);
  if (!git) return { status: 127, stdout: "", stderr: "git fehlt" };
  const env = { ...kindUmgebung(z), PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LC_ALL: "C", GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_NO_LAZY_FETCH: "1" };
  const r = spawnSync(git, [...(ohneOrdner ? [] : ["-C", ordner]), ...HAERTUNG, ...args], { encoding: "utf8", env, timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  return { status: r.status === null ? 1 : r.status, stdout: String(r.stdout || ""), stderr: String(r.stderr || "") };
}
// git über git-sicher (mit Erlaubnisliste und gehärtetem Aufruf) – für den Test-Commit und den Gerätemerker.
export function gitSicherLauf(z, args, { ordner = z.vault, timeout = 180_000 } = {}) {
  const r = spawnSync("/bin/sh", [join(KERN, "git-sicher"), "-C", ordner, ...args], { encoding: "utf8", env: kindUmgebung(z), timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  return { status: r.status === null ? 1 : r.status, stdout: String(r.stdout || ""), stderr: String(r.stderr || "") };
}

// Wie viele Bytes sind das ungefähr (für „Probekopie braucht …“)? Nur grob, ohne Verweisen zu folgen.
export function ordnerGroesseGrob(wurzel, grenze = 200_000) {
  let bytes = 0, n = 0;
  const lauf = (dir) => {
    let namen;
    try { namen = readdirSync(dir); } catch { return; }
    for (const name of namen) {
      if (n++ > grenze) return;
      const p = join(dir, name);
      let s;
      try { s = lstatSync(p); } catch { continue; }
      if (s.isSymbolicLink()) continue;
      if (s.isDirectory()) lauf(p); else bytes += s.size;
    }
  };
  lauf(wurzel);
  return bytes;
}

export function raeumeWeg(ordner) { try { rmSync(ordner, { recursive: true, force: true }); } catch { /* bleibt */ } }
export function stelleOrdnerSicher(ordner, modus = 0o700) { mkdirSync(ordner, { recursive: true, mode: modus }); }
