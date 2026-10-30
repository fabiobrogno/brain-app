// umstellung/probelauf-merker.mjs — der Probelauf-Merker (Paket P7b, Plan Abschnitt 2 und 8.6): <Support>/umstellung/<Kennung>/probelauf.json.
//   { zeit, ergebnis: "gruen" | "rot", fingerabdruck, entscheidungen (Hash), kernVersion, kriterien: [{ nr, id, status, grund? }] }
// Phase A am Original läuft nur, wenn der Merker grün ist UND zum jetzigen Stand passt (gleicher Fingerabdruck der Dinge, die Phase A ändert, und gleiche Entscheidungen).
// Keine Werte: nur Hashes, Nummern und feste Kurztexte.
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ablageOrdner, schreibeAtomar, oeffneAblage } from "./protokoll.mjs";

const datei = (z) => join(ablageOrdner(z), "probelauf.json");
export function leseProbelaufMerker(z) {
  try { const j = JSON.parse(readFileSync(datei(z), "utf8")); return j && typeof j === "object" && !Array.isArray(j) ? j : null; } catch { return null; }
}
export function schreibeProbelaufMerker(z, merker) {
  oeffneAblage(z);
  schreibeAtomar(datei(z), JSON.stringify(merker, null, 2) + "\n", 0o600);
}
export function loescheProbelaufMerker(z) { try { rmSync(datei(z), { force: true }); } catch { /* weg */ } }
