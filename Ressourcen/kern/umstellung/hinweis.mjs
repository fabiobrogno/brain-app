// umstellung/hinweis.mjs — der billige Hinweis für die Menüleiste (Paket P7c): „Dieser Vault kann umgestellt werden“. Kein Befund (der liest den Versionsverlauf, Claude-Einstellungen …), nur das,
// was der Befund als Fund E1 meldet: der alte Werkzeug-Ordner liegt im Vault (lstat, kein Lesen von Inhalten) – und Phase A ist noch nicht durch. Nach Phase A bleibt der Ordner bis zum
// Aufräumen (P7d) liegen, darum fragt der Hinweis zusätzlich den Zustand der Umstellung (zustand.json im Support-Ordner). Schreibt nichts.
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { ALT_KIT_ORDNER, supportOrdner } from "../pfade.mjs";
import { liesZustand } from "./protokoll.mjs";

// → { altlasten: boolean, phase: "A" | null }
export function umstellungHinweis(vault, { support = supportOrdner() } = {}) {
  let phase = null;
  try { phase = liesZustand({ vault, support }).phase || null; } catch { /* kein Zustand */ }
  let da = false;
  try { lstatSync(join(vault, ALT_KIT_ORDNER)); da = true; } catch { /* kein alter Ordner */ }
  return { altlasten: da && phase !== "A", phase };
}
