// umstellung/probelauf-b-merker.mjs — der Merker des Probelaufs für Phase B (Paket P7d): <Support>/umstellung/<Kennung>/probelauf-b.json.
//   { zeit, ergebnis: "gruen" | "rot", fingerabdruck, entscheidungen, kernVersion, kriterien: [{ nr, id, status, grund? }] }
// Phase B am Original läuft nur nach einem grünen Probelauf für DENSELBEN Stand (Fingerabdruck) und nicht älter als 24 Stunden („frischer Probelauf“, Plan 4.1 Nr. 5). Keine Werte, nur Hashes.
import { readFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ALT_KIT_ORDNER, kernVersion } from "../pfade.mjs";
import { merkerDateiFuer } from "../backup.mjs";
import { ablageOrdner, schreibeAtomar, oeffneAblage, hashDatei, hashText } from "./protokoll.mjs";
import { baumHash, lexists } from "./baum.mjs";
import { gitLauf } from "./ziele.mjs";

export const MERKER_FRIST_MS = 24 * 3600_000;
const datei = (z) => join(ablageOrdner(z), "probelauf-b.json");
export function leseProbelaufBMerker(z) {
  try { const j = JSON.parse(readFileSync(datei(z), "utf8")); return j && typeof j === "object" && !Array.isArray(j) ? j : null; } catch { return null; }
}
export function schreibeProbelaufBMerker(z, merker) { oeffneAblage(z); schreibeAtomar(datei(z), JSON.stringify(merker, null, 2) + "\n", 0o600); }
export function loescheProbelaufBMerker(z) { try { rmSync(datei(z), { force: true }); } catch { /* weg */ } }

// Der Stand, den Phase B ändert: Einstellungen des Vaults, .gitignore, lokale git-Konfiguration, Aufbau des alten Ordners (Pfade, Größen, Rechte), Gerätemerker, Sicherungsmerker.
// Notizen im Arbeitsbaum ändern ihn nicht; ein neuer Commit oder eine vorgemerkte Änderung schon (HEAD, Index).
export function fingerabdruckB(z) {
  let geraete = [];
  try { const dir = join(z.vault, ".kortex", "geraete"); geraete = readdirSync(dir).sort().map((n) => `${n}:${hashDatei(join(dir, n))}`); } catch { /* keine */ }
  const kit = lexists(join(z.vault, ALT_KIT_ORDNER)) ? baumHash(join(z.vault, ALT_KIT_ORDNER), { inhalt: false }) : null;
  // HEAD und der Inhalt des Index (ls-files -s: Modi, Objekt-IDs, Pfade – nicht die Bytes der Index-Datei, die sich bei jedem „status“ neu schreiben): ein neuer Commit oder eine vorgemerkte Änderung
  // machen den Probelauf ungültig
  let head = null, index = null;
  if (lexists(join(z.vault, ".git"))) {
    const h = gitLauf(z, ["rev-parse", "--verify", "-q", "HEAD"]); head = h.status === 0 ? h.stdout.trim() : "keiner";
    const i = gitLauf(z, ["ls-files", "-s", "-z"]); index = i.status === 0 ? hashText(i.stdout) : null;
  }
  return hashText(JSON.stringify({
    head, index, kernVersion: kernVersion(), config: hashDatei(join(z.vault, "brain.config.json")), gitConfig: hashDatei(join(z.vault, ".git", "config")), gitignore: hashDatei(join(z.vault, ".gitignore")),
    kit, geraete, sicherung: hashDatei(merkerDateiFuer(z.vault, z.support)),
  }));
}
// → { vorhanden, ergebnis, gueltig, zeit, grund? } – gueltig = grün, derselbe Stand, frisch
export function probelaufBStand(z, jetzt = Date.now()) {
  const m = leseProbelaufBMerker(z);
  if (!m) return { vorhanden: false, gueltig: false, grund: "fehlt" };
  if (m.ergebnis !== "gruen") return { vorhanden: true, ergebnis: m.ergebnis, gueltig: false, zeit: m.zeit, grund: "rot" };
  let fp = null; try { fp = fingerabdruckB(z); } catch { /* unten */ }
  if (m.fingerabdruck !== fp) return { vorhanden: true, ergebnis: m.ergebnis, gueltig: false, zeit: m.zeit, grund: "veraltet" };
  const alter = jetzt - Date.parse(m.zeit);
  if (!(alter >= 0 && alter <= MERKER_FRIST_MS)) return { vorhanden: true, ergebnis: m.ergebnis, gueltig: false, zeit: m.zeit, grund: "abgelaufen" };
  return { vorhanden: true, ergebnis: m.ergebnis, gueltig: true, zeit: m.zeit };
}
