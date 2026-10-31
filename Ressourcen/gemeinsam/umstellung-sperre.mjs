// gemeinsam/umstellung-sperre.mjs — die EIGENE Sperre der Umstellung (Phase B und ihr Rückweg), Review zu P7d.
//
// Datei: <Vault>/.logs/umstellung-phase-b.lock  { pid, zeit }  (der Ordner .logs steht in der .gitignore jedes Vaults; die Datei gelangt nie in einen Commit).
// SCHREIBER: Kern, umstellung/protokoll.mjs#setzePhaseBSperre (läuft Phase B oder ihr Rückweg am Original).
// LESER: die Werkstatt (vault.mjs): Commit, Abgleich, Wiederherstellen, Konfliktlösung und der Posteingang warten NICHT, sondern melden 409 „Kortex räumt gerade auf“ – so schreibt der Studio-Sync
//        nie mitten in den Commit von Phase B und der Rückweg findet keinen fremden Commit auf seinem Weg. Eine Sperre eines toten Prozesses oder älter als 90 Minuten zählt nicht.
// Bewusst eine eigene, eindeutig benannte Datei und nicht .logs/ingest.lock (die gehört der Pflege/Einarbeitung): so lässt sie sich mit einer gemeinsamen Sync-Sperre (Zweig feat/konflikt-ansicht)
// zusammenführen, ohne dass eine die andere überschreibt – beide Namen sind in der PR-Beschreibung festgehalten.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const SPERRE_DATEI = join(".logs", "umstellung-phase-b.lock");
export const SPERRE_MAX_ALTER_MS = 90 * 60_000;

// → true, wenn gerade Phase B (oder ihr Rückweg) in diesem Vault läuft
export function umstellungLaeuft(wurzel, { jetzt = Date.now() } = {}) {
  let j;
  try { j = JSON.parse(readFileSync(join(wurzel, SPERRE_DATEI), "utf8")); } catch { return false; }
  if (!j || typeof j !== "object") return false;
  const alter = jetzt - Date.parse(j.zeit);
  if (!(alter >= -60_000 && alter <= SPERRE_MAX_ALTER_MS)) return false;
  try { process.kill(Number(j.pid), 0); return true; } catch (e) { return !!(e && e.code === "EPERM"); }
}
