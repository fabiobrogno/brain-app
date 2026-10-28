// .tools/sicherung-takt.mjs — Sicherung nur bei Änderung und höchstens alle 15 min (App-Spec §12.1 Nr. 2, Lernkreislauf §7.7).
// Merkt HEAD und Zeit der letzten erfolgreichen Sicherung in .logs/sicherung.json. Nur der Sitzungsstart fragt hier;
// `brain backup` von Hand sichert immer.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { gitBefehl } from "./werkzeug.mjs";
import { ladeConfig } from "./pfade.mjs";

export const MIN_ABSTAND_MS = 15 * 60000;
export const TAKT_DATEI = (vault) => join(vault, ".logs", "sicherung.json");

export function aktuellerHead(vault) {
  try {
    return execFileSync(gitBefehl({ cfg: ladeConfig(vault) }), ["-C", vault, "rev-parse", "HEAD"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim() || null;
  } catch { return null; }
}
function letzte(vault) {
  try { const j = JSON.parse(readFileSync(TAKT_DATEI(vault), "utf8")); return j && typeof j.head === "string" ? j : null; } catch { return null; }
}
export function sicherungNoetig(vault, { jetzt = Date.now(), head } = {}) {
  if (!head) return { noetig: false, grund: "kein-head" };
  const l = letzte(vault);
  if (!l) return { noetig: true, grund: "erste" };
  if (l.head === head) return { noetig: false, grund: "unveraendert" };
  if (jetzt - Number(l.zeit || 0) < MIN_ABSTAND_MS) return { noetig: false, grund: "zu-frueh" };
  return { noetig: true, grund: "geaendert" };
}
export function merkeSicherung(vault, { jetzt = Date.now(), head }) {
  try {
    mkdirSync(join(vault, ".logs"), { recursive: true });
    writeFileSync(TAKT_DATEI(vault), JSON.stringify({ head, zeit: jetzt }) + "\n");
  } catch { /* Merken ist nur Komfort — schlimmstenfalls wird einmal mehr gesichert */ }
}
