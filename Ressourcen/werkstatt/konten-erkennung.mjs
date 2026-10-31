// werkstatt/konten-erkennung.mjs — Welche KI-Konten gibt es auf diesem Mac? (docs/plaene/ki-konten.md, Paket P1)
// Ein Konto ist ein Programm plus Konfig-Ordner. Erkannt wird nur über Ordner- und Dateinamen (lstat) und die vorhandene Programm-Erkennung —
// KEINE Dateiinhalte, keine Anmeldedaten, keine E-Mail-Adressen:
//   claude   ~/.claude und ~/.claude-*           (profile.mjs: Ordner direkt im Home, kein Symlink)
//   codex    ~/.codex und ~/.codex-*, mit config.toml oder auth.json (Kortex-Konvention: ein eigenes CODEX_HOME je Konto trennt den Login)
//   übrige   Cursor, Claude Desktop, Gemini CLI, Copilot, Zed, OpenCode, Warp: je ein Konto, wenn das Programm da ist (ki-programme/erkennung.mjs)
//   verwaltet  <Support>/ki-konten-ordner/claude-* und codex-*: Konten, die Kortex selbst angelegt hat („Konto hinzufügen“)
// → [{ programm, ordner (echter Ort), standard, name (Vorschlag), ordnerKennung ("" wenn der Ordner noch fehlt) }]
import { lstatSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { erkenneProfile, erkenneVerwaltete } from "./profile.mjs";
import { echterOrt, kennungVon } from "../gemeinsam/ki-konten.mjs";
import { cursorVorhanden } from "../gemeinsam/ki.mjs";
import { testmodus } from "../gemeinsam/basis.mjs";
import { BESCHREIBUNGEN } from "./ki-programme/programme.mjs";
import { erkenneProgramme } from "./ki-programme/index.mjs";

const art = (p) => { try { const s = lstatSync(p); return s.isSymbolicLink() ? "link" : s.isDirectory() ? "ordner" : s.isFile() ? "datei" : "anders"; } catch { return null; } };
const kennung = (ordner) => { try { return kennungVon(ordner); } catch { return ""; } };

// Welche der Programme mit Einstellungsdatei sind da? → Menge der ids. Im Testmodus gilt nur das Home (kein PATH, kein /Applications des echten Rechners).
export function gefundeneProgramme({ home = homedir(), env = process.env, appOrdner } = {}) {
  const test = testmodus();
  const e = test ? { ...env, PATH: "", BRAIN_CLAUDE_EXTRA: "" } : env;
  const apps = appOrdner || (test ? join(home, "Applications-nicht-vorhanden") : "/Applications");
  const da = new Set(erkenneProgramme({ env: e, home, appOrdner: apps }).filter((p) => p.gefunden).map((p) => p.id));
  if (cursorVorhanden(home, apps)) da.add("cursor");
  return da;
}

export function erkenneKonten({ home = homedir(), programme = null, env = process.env, appOrdner, support = null } = {}) {
  const liste = [];
  const neu = (programm, ordnerRoh, standard, name) => {
    const ordner = echterOrt(ordnerRoh);
    liste.push({ programm, ordner, standard, name, ordnerKennung: kennung(ordner) });
  };
  for (const p of erkenneProfile(home)) neu("claude", p.pfad, p.standard, p.standard ? "Claude Code" : `Claude Code · ${p.name.slice(".claude-".length)}`);
  let namen = [];
  try { namen = readdirSync(home).sort(); } catch { /* kein Home */ }
  for (const n of namen) {
    if (n !== ".codex" && !/^\.codex-[^/\\]+$/.test(n)) continue;
    const pfad = join(home, n);
    if (art(pfad) !== "ordner") continue; // Symlinks werden nie verfolgt
    if (art(join(pfad, "config.toml")) !== "datei" && art(join(pfad, "auth.json")) !== "datei") continue;
    neu("codex", pfad, n === ".codex", n === ".codex" ? "Codex" : `Codex · ${n.slice(".codex-".length)}`);
  }
  // Von Kortex angelegte Ordner unter <Support>/ki-konten-ordner/ (nie im Home): ein Konto je Ordner, auch wenn er noch leer ist (die Anmeldung kommt danach).
  for (const p of erkenneVerwaltete(support, "claude")) neu("claude", p.pfad, false, `Claude Code · ${p.name.slice("claude-".length)}`);
  for (const p of erkenneVerwaltete(support, "codex")) neu("codex", p.pfad, false, `Codex · ${p.name.slice("codex-".length)}`);
  const da = programme ? new Set([...programme].map((p) => (typeof p === "string" ? p : p && p.gefunden ? p.id : null)).filter(Boolean)) : gefundeneProgramme({ home, env, appOrdner });
  for (const b of BESCHREIBUNGEN) if (da.has(b.id)) neu(b.id, dirname(b.datei({ home })), true, b.name);
  return liste;
}
