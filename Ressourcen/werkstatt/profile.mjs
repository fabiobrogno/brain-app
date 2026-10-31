// werkstatt/profile.mjs — Claude-Code-Profile auf diesem Mac. Wer mit mehreren Profilen arbeitet, setzt CLAUDE_CONFIG_DIR (z. B. ~/.claude-privat neben ~/.claude).
// Eine App, die aus dem Finder startet, kennt diese Umgebung nicht: Kortex sucht die Profile deshalb selbst und lässt den Nutzer wählen.
//   Ein Profil ist ein Ordner ~/.claude oder ~/.claude-* DIREKT im Home (kein Symlink, Links werden nie verfolgt), der eine settings.json, eine .claude.json
//   oder einen Ordner projects/ enthält. Für das Standardprofil zählt auch eine ~/.claude.json im Home (dort legt Claude Code die Konfiguration ab,
//   solange CLAUDE_CONFIG_DIR fehlt).
// Zuordnung der Konfiguration: Standardprofil → ~/.claude.json (CLAUDE_CONFIG_DIR NICHT setzen); anderes Profil → <Profil>/.claude.json (CLAUDE_CONFIG_DIR=<Profil>).
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const art = (p) => { try { const s = lstatSync(p); return s.isSymbolicLink() ? "link" : s.isDirectory() ? "ordner" : s.isFile() ? "datei" : "anders"; } catch { return null; } };

// Von Kortex selbst angelegte Konto-Ordner („Konto hinzufügen“): je Konto ein eigener Ordner direkt unter <Support>/ki-konten-ordner/, Name `<programm>-<kennung>` (claude-… / codex-…).
// Ein Ordner im Home des Nutzers wird dafür nie angelegt und nie berührt; `~/.claude` bleibt das „System-Standard“-Konto und wird nur referenziert.
export const VERWALTET = "ki-konten-ordner";
export const verwaltetWurzel = (support) => join(support, VERWALTET);
export function erkenneVerwaltete(support, programm) {
  if (!support || !["claude", "codex"].includes(programm)) return [];
  const wurzel = verwaltetWurzel(support);
  let namen = [];
  try { namen = readdirSync(wurzel); } catch { return []; }
  const muster = new RegExp(`^${programm}-[A-Za-z0-9._-]{1,60}$`);
  return namen.sort().filter((n) => muster.test(n) && art(join(wurzel, n)) === "ordner").map((n) => ({ pfad: join(wurzel, n), name: n, standard: false, verwaltet: true }));
}

export function erkenneProfile(home = homedir(), support = null) {
  let namen = [];
  try { namen = readdirSync(home); } catch { namen = []; }
  const profile = [];
  for (const name of namen.sort()) {
    if (name !== ".claude" && !/^\.claude-[^/\\]+$/.test(name)) continue;
    const pfad = join(home, name);
    if (art(pfad) !== "ordner") continue; // Symlinks werden nicht verfolgt
    const standard = name === ".claude";
    const hat = art(join(pfad, "settings.json")) === "datei" || art(join(pfad, ".claude.json")) === "datei" || art(join(pfad, "projects")) === "ordner";
    if (hat || (standard && art(join(home, ".claude.json")) === "datei")) profile.push({ pfad, name, standard });
  }
  // Das Standardprofil ohne Ordner (nur ~/.claude.json) ist auch eins; der Ordner entsteht beim Eintragen.
  if (!profile.some((p) => p.standard) && art(join(home, ".claude.json")) === "datei" && art(join(home, ".claude")) === null) profile.push({ pfad: join(home, ".claude"), name: ".claude", standard: true });
  profile.push(...erkenneVerwaltete(support, "claude"));
  return profile.sort((a, b) => (a.standard === b.standard ? a.name.localeCompare(b.name) : a.standard ? -1 : 1));
}

// → die erkannte Profil-Beschreibung zu einem Pfad (exakt aus der Liste, nie ein frei gewählter Pfad) oder null.
export const profilZuPfad = (pfad, home = homedir(), support = null) => (typeof pfad === "string" ? erkenneProfile(home, support).find((p) => p.pfad === pfad) || null : null);

// Umgebung für einen `claude`-Aufruf im Profil: nur ein NICHT-Standardprofil setzt CLAUDE_CONFIG_DIR; sonst wird eine geerbte Variable entfernt.
export function mitProfil(env, profil) {
  const e = { ...env };
  delete e.CLAUDE_CONFIG_DIR;
  if (profil && !profil.standard) e.CLAUDE_CONFIG_DIR = profil.pfad;
  return e;
}

// Umgebung für einen `codex`-Aufruf im Konto-Ordner: nur ein NICHT-Standardordner (~/.codex-*) setzt CODEX_HOME; sonst wird eine geerbte Variable entfernt.
export function mitCodexHome(env, konto) {
  const e = { ...env };
  delete e.CODEX_HOME;
  if (konto && konto.programm === "codex" && !konto.standard) e.CODEX_HOME = konto.ordner;
  return e;
}
