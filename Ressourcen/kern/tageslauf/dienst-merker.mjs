// tageslauf/dienst-merker.mjs — für WELCHE Vaults der Hintergrunddienst laufen darf. Der LaunchAgent folgt dem aktiven Vault der App; würde dort ein fremder
// (geklonter) Vault aktiv, liefe der stündliche Tageslauf (worktree add, merge, KI-Aufrufe) ohne dein Zutun auf ihm. Darum läuft der Dienst nur für Vaults, für
// die er ausdrücklich eingeschaltet wurde: `dienst an` trägt den aktuellen Vault hier ein, `dienst aus` löscht die Datei, der Lauf (brain.mjs) prüft vorher.
// Ablage: <Support>/dienst.json  { "vaults": ["<realpath>", …] } — atomar geschrieben (Temp + rename), Rechte 0600. Fehlt sie oder ist sie unlesbar: kein Vault erlaubt.
import { readFileSync, writeFileSync, renameSync, mkdirSync, realpathSync, rmSync, chmodSync } from "node:fs";
import { join, resolve } from "node:path";
import { supportOrdner } from "../pfade.mjs";

export const merkerPfad = (opt = {}) => join(supportOrdner(opt), "dienst.json");
const echt = (p) => { try { return realpathSync(p); } catch { return resolve(String(p)); } };

export function erlaubteVaults(opt = {}) {
  try {
    const j = JSON.parse(readFileSync(merkerPfad(opt), "utf8"));
    return Array.isArray(j?.vaults) ? j.vaults.filter((v) => typeof v === "string" && v) : [];
  } catch { return []; }
}
export const dienstErlaubt = (vault, opt = {}) => !!vault && erlaubteVaults(opt).includes(echt(vault));

export function erlaubeVault(vault, opt = {}) {
  const liste = [...new Set([...erlaubteVaults(opt), echt(vault)])].sort();
  const datei = merkerPfad(opt);
  mkdirSync(join(datei, ".."), { recursive: true });
  const tmp = `${datei}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, JSON.stringify({ vaults: liste }, null, 2) + "\n", { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, datei);
  } catch (e) { try { rmSync(tmp, { force: true }); } catch { /* weg */ } throw e; }
  return liste;
}
export function widerrufeAlle(opt = {}) { rmSync(merkerPfad(opt), { force: true }); }
