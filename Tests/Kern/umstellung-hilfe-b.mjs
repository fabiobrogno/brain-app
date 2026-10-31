// umstellung-hilfe-b.mjs — gemeinsame Bausteine für die Tests der Phase B (P7d). KEIN Test.
//   const h = umstellungsFixture([...]); await phaseAFertig(h);   → Phase A am Fixture durchgeführt, Zeit und Version von Phase A so gesetzt, dass das Tor außer Probelauf/Bestätigung offen ist
//   await tuerOffen(h)                                           → grüner Probelauf für Phase B (Tor ganz offen mit der Bestätigung)
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { freigabe } from "./umstellung-hilfe.mjs";
import { phaseA } from "../umstellung/phase-a.mjs";
import { probelaufB } from "../umstellung/probelauf-b.mjs";
import { pruefeTor } from "../umstellung/tor.mjs";
import { liesZustand, schreibeZustand } from "../umstellung/protokoll.mjs";

export const TAG = 86_400_000;
export const BEST = { keineAltenMacs: true };
export const REICH_B = ["kit-versioniert", "hookspath-relativ", "hooks-alt-sh", "mcp-claude-alt", "plist-alt-dieser", "backup-pfad-gueltig", "altfelder"];
export const json = (p) => JSON.parse(readFileSync(p, "utf8"));

export async function phaseAFertig(h, { tageAlt = 8, version = "0.0.1", configCommit = true } = {}) {
  // die Einstellungen des Fixtures (Altfelder, Sicherungsordner) stehen im Verlauf – wie in einem echten Kit-Vault
  if (configCommit) { try { h.a.g("add", "--", "brain.config.json"); h.a.g("commit", "-q", "-m", "Config"); } catch { /* nichts zu speichern */ } }
  freigabe(h.z());
  const r = await phaseA(h.z(), { bestaetigt: true });
  if (!r.ok || r.phase !== "A") throw new Error(`Phase A im Test nicht durchgegangen: ${JSON.stringify(r)}`);
  const z = h.z();
  const zu = liesZustand(z);
  zu.phaseA = { zeit: new Date(Date.now() - tageAlt * TAG).toISOString(), kernVersion: version };
  schreibeZustand(z, zu);
  return r;
}
export async function tuerOffen(h, opt = {}) {
  const r = await probelaufB(h.z(), { bestaetigt: true, ...opt });
  if (!r.ok) throw new Error(`Probelauf B im Test nicht grün: ${JSON.stringify(r.kriterien.filter((c) => c.status === "rot"))}`);
  return r;
}
export const tor = (h, ent = BEST, opt = {}) => pruefeTor(h.z(), { entscheidungen: ent, ...opt });
export const bedingung = (t, id) => t.bedingungen.find((b) => b.id === id);
// git im Vault (echtes git, Test-Identität aus dem Prozess), ohne Hooks
export const gitIn = (ordner, ...a) => {
  const r = spawnSync("/usr/bin/git", ["-C", ordner, "-c", "core.hooksPath=/dev/null", ...a], { encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" } });
  return r.status === 0 ? r.stdout.trim() : `FEHLER:${r.status}:${r.stderr}`;
};
