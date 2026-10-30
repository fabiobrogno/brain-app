// Hilfe für Tests/Kern/test-konto-hooks.mjs (KI-Konten, docs/plaene/ki-konten.md). Kein Test (Name beginnt nicht mit test-).
// baueTestUmgebung baut die Umgebung eines Kindprozesses AUSDRÜCKLICH (nie ...process.env) und bricht ab, wenn HOME oder BRAIN_APP_SUPPORT nicht unter dem
// Temp-Ordner liegen oder CLAUDE_CONFIG_DIR, CODEX_HOME, CURSOR_CONFIG_DIR, GEMINI_CLI_HOME auf einen Ort außerhalb zeigen.
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";

const TEMP = realpathSync(tmpdir());
const imTemp = (p) => { try { const r = realpathSync(p); return r === TEMP || r.startsWith(`${TEMP}/`); } catch { return false; } };
const KONFIG_ORDNER = ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "CURSOR_CONFIG_DIR", "GEMINI_CLI_HOME"];

export function baueTestUmgebung(extra = {}) {
  const e = { PATH: "/usr/bin:/bin", BRAIN_TESTMODUS: "1", ...extra };
  for (const k of ["HOME", "BRAIN_APP_SUPPORT"]) {
    if (typeof e[k] !== "string" || !imTemp(e[k])) throw new Error(`baueTestUmgebung: ${k} muss ein Ordner unter dem Temp-Ordner sein (war: ${e[k]})`);
  }
  for (const k of KONFIG_ORDNER) {
    if (e[k] === undefined) continue;
    if (typeof e[k] !== "string" || !imTemp(e[k])) throw new Error(`baueTestUmgebung: ${k} zeigt außerhalb des Temp-Ordners (${e[k]})`);
  }
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  return e;
}
