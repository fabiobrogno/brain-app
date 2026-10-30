// Tests/Kern/konto-kind.mjs — Hilfsprogramm für test-tageslauf-konto.mjs (kein Test): läuft als KINDPROZESS mit der Umgebung, die der Test ausdrücklich baut,
// und ruft eine KI-Stelle des Kerns auf. Ausgabe: eine JSON-Zeile. argv: <modus> <vault> [konto]
//   haiku      → rufeHaiku (Mindeststufe `konto`, Standard posteingang) mit der Attrappe aus BRAIN_CLAUDE
//   nachernte  → nachernteAlle (Ergebnis: abbruch, aufrufe)
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const [modus, vault, konto] = process.argv.slice(2);
const befehl = { befehl: process.execPath, args: [process.env.BRAIN_CLAUDE] };
if (modus === "haiku") {
  const E = await import(join(HIER, "..", "ernte.mjs"));
  const r = await E.rufeHaiku(befehl, "Test", "Eingabe aus dem Vault", vault, { zweck: "konto", ...(konto ? { konto } : {}) });
  console.log(JSON.stringify({ ok: r.fehler === undefined, fehler: r.fehler ?? null }));
} else if (modus === "nachernte") {
  const N = await import(join(HIER, "..", "nachernte.mjs"));
  const r = await N.nachernteAlle(vault, { claudeBefehl: befehl });
  console.log(JSON.stringify({ abbruch: r.abbruch, aufrufe: r.aufrufe }));
}
