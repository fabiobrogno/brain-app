#!/usr/bin/env node
// SessionEnd-Hook (K13): trägt die Sitzung aus .logs/laufend/ aus. Läuft im 1,5-s-Budget von Claude Code; bei einem
// Absturz läuft er gar nicht — dann räumt der nächste SessionStart nach 24 h auf (laufend.mjs#raeumeAuf).
// Mit gedaechtnisTeilen=an stößt er zusätzlich den Abgleich des Auto-Memorys dieses Projekts an (losgelöst im Hintergrund, nie wartend).
// Gibt NIE etwas aus, Exit immer 0. BRAIN_ERNTE=1 (Selbstaufruf der Ernte) → nichts tun.
if (process.env.BRAIN_ERNTE === "1") process.exit(0);
import { readFileSync } from "node:fs";

try {
  const { vaultPfad } = await import("../../pfade.mjs");
  const { abmelden } = await import("../../laufend.mjs");
  let e = {};
  try { e = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch {}
  const vault = vaultPfad([]);
  try { abmelden(vault, e?.session_id); } catch {}
  try {
    const werte = (await import("../../einstellungen.mjs")).leseAutomatik(vault).werte;
    if (werte.gedaechtnisTeilen === "an") (await import("../../gedaechtnis.mjs")).starteAbgleichFuerSitzung({ vault, eingabe: e, werte });
  } catch { /* nie blockierend */ }
} catch { /* nie blockierend, nie Ausgabe */ }
process.exit(0);
