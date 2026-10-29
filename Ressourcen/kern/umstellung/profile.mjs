// umstellung/profile.mjs — Claude-Code-Profile auf diesem Mac (nur lesen). Gleiche Regel wie werkstatt/profile.mjs (Test: Tests/Node/umstellung-befund.test.mjs
// hält beide zusammen): ein Profil ist ein Ordner ~/.claude oder ~/.claude-* DIREKT im Home (kein Verweis), der settings.json, .claude.json oder projects/ enthält;
// für das Standardprofil zählt auch eine ~/.claude.json im Home. Der Kern darf nicht aus der Werkstatt importieren, darum die Kopie.
import { lstatSync, readdirSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { homedir } from "node:os";

const art = (p) => { try { const s = lstatSync(p); return s.isSymbolicLink() ? "link" : s.isDirectory() ? "ordner" : s.isFile() ? "datei" : "anders"; } catch { return null; } };

export function erkenneProfile(home = homedir()) {
  let namen = [];
  try { namen = readdirSync(home); } catch { return []; }
  const profile = [];
  for (const name of namen.sort()) {
    if (name !== ".claude" && !/^\.claude-[^/\\]+$/.test(name)) continue;
    const pfad = join(home, name);
    if (art(pfad) !== "ordner") continue; // Verweise werden nicht verfolgt
    const standard = name === ".claude";
    const hat = art(join(pfad, "settings.json")) === "datei" || art(join(pfad, ".claude.json")) === "datei" || art(join(pfad, "projects")) === "ordner";
    if (hat || (standard && art(join(home, ".claude.json")) === "datei")) profile.push({ pfad, name, standard });
  }
  if (!profile.some((p) => p.standard) && art(join(home, ".claude.json")) === "datei" && art(join(home, ".claude")) === null) profile.push({ pfad: join(home, ".claude"), name: ".claude", standard: true });
  return profile.sort((a, b) => (a.standard === b.standard ? a.name.localeCompare(b.name) : a.standard ? -1 : 1));
}

// Ausdrücklich genannte Profilordner (--claude-home) in dieselbe Form bringen.
export function profileAusPfaden(pfade, home = homedir()) {
  const standard = join(home, ".claude");
  return [...new Set(pfade.map((p) => resolve(p)))].map((pfad) => ({ pfad, name: basename(pfad), standard: pfad === standard }));
}
