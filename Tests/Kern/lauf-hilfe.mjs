// .tools/tests/lauf-hilfe.mjs — gemeinsamer Aufbau für die Tageslauf-Lauftests (B2, Task 11): Vault mit einer Seite „Orion“ und
// sieben Vorschlägen (je einer pro Stufe) plus die Fake-KI-Antworten dazu.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { neuerTestVault, legeVorschlagAn, legeTranskriptAn, seitenText, FAKE_BEFEHL, JETZT } from "./tageslauf-hilfe.mjs";
import { tageslauf } from "../tageslauf.mjs";

export const SEITE = "09_wiki/projekte/entitaet_orion.md";
export const ZEILE = "- Orion läuft auf Port 3309 · Stand 01.10.2026 · [[x]]";
export const neu = '{"urteil":"neu","zitatStuetzt":true,"passtZurSeite":true,"dauerhaft":true}';
export const REGELN = [
  { wenn: "--- VORSCHLÄGE ---", antwort: '[{"id":"n1","zitat":"Orion hält ab heute Zwischenergebnisse im Arbeitsspeicher"}]' },
  { wenn: "FAKT: Orion Backups", antwort: neu },
  { wenn: "FAKT: Orion Cache", antwort: neu },
  { wenn: "FAKT: Orion Rechnung", antwort: neu },
  { wenn: "FAKT: Orion Notiz", antwort: neu },
  { wenn: "FAKT: Orion Port", antwort: JSON.stringify({ urteil: "widerspricht", zeile: ZEILE, zitatStuetzt: true, passtZurSeite: true, dauerhaft: true }) },
  { wenn: "FAKT: Orion Testsystem", antwort: '{"urteil":"schon_drin","zitatStuetzt":true,"passtZurSeite":true,"dauerhaft":true}' },
];
export const fund = (id) => `s1#u-${id} 2026-10-20T10:00:00Z`;
export const belegt = (v, id, titel, text, zitat, herkunft = "du") => legeVorschlagAn(v, { id, titel, text, zitat, herkunft, fundstelle: fund(id) });
// Standard: Einschwingphase aus (einschwingen: 0) — die Lauftests prüfen die Stufen mit exakten Rückfrage-Zahlen; die Einschwingphase
// hat ihre eigenen Tests (test-tageslauf-einschwingen.mjs, dort mit Standard 20 und mit kleinem N).
export function aufbau({ automatik = { tageslauf: "an", einschwingen: 0 } } = {}) {
  const v = neuerTestVault({ automatik, seiten: { [SEITE]: seitenText({ fm: { name: "orion", description: "Orion Testsystem" },
    rumpf: `# Orion\n\nOrion ist das Testsystem.\n\n## Fakten\n\n${ZEILE}\n` }) } });
  mkdirSync(join(v, ".logs"), { recursive: true });
  writeFileSync(join(v, ".logs", "aliasse.json"), JSON.stringify({ orion: SEITE }));
  belegt(v, "g1", "Orion Backups", "Orion sichert jetzt stündlich.", "Orion sichert ab sofort stündlich", "tool");    // 🟢
  belegt(v, "w1", "Orion Port", "Orion läuft auf Port 3310.", "Orion läuft ab heute auf Port 3310");                  // 🟡 widerspruch
  belegt(v, "s1", "Orion Testsystem", "Orion ist das Testsystem.", "Orion ist ja unser Testsystem");                // ⚪ schon drin
  belegt(v, "h1", "Orion Rechnung", "Orion kostet 1.200 € im Monat.", "Orion kostet uns 1.200 € im Monat");          // 🟡 heikel
  belegt(v, "k1", "Orion Farbe", "Orion ist blau.", "Orion ist blau", "ki");                                          // ⚪ herkunft-ki
  belegt(v, "x1", "Kaffeemaschine", "Die Kaffeemaschine wird freitags entkalkt.", "freitags entkalken wir die Kaffeemaschine"); // ⏸
  legeVorschlagAn(v, { id: "n1", titel: "Orion Cache", text: "Orion hält Zwischenergebnisse im Arbeitsspeicher.", sitzung: "s7" });        // Beleg nachholen → 🟢
  legeTranskriptAn(v, "s7", [{ du: "Orion hält ab heute Zwischenergebnisse im Arbeitsspeicher, sagt das Team." }]);
  return v;
}
export const lauf = (v, opt = {}) => tageslauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT, ...opt });
export const teil = (z) => ({ uebernommen: z.uebernommen, aussortiert: z.aussortiert, rueckfragenNeu: z.rueckfragenNeu, wartenNeu: z.wartenNeu });

