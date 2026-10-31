#!/usr/bin/env node
// PreToolUse-Hook: Werkzeug-Protokoll (0-Token-Regel) — hält fest, welche Dateien Read innerhalb des
// Vaults gelesen hat (Aufleuchten) und welche MCP-Werkzeuge benutzt wurden (immer, unabhängig von
// "liveAufleuchten" — das steuert nur das Aufleuchten, nicht die MCP-Protokollierung). Gibt NIE etwas
// aus (weder stdout noch stderr), Exit immer 0 — ein Fehler hier darf den Werkzeug-Aufruf nie blockieren.
// Tut nichts bei BRAIN_ERNTE=1 (Selbstaufruf-Schutz: der Ernte-Lauf darf sich nicht selbst protokollieren).
import { readFileSync } from "node:fs";
import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { vaultPfadOderEnde, kontoDarf, meldeAbweisung } from "../../pfade.mjs";
import { wert } from "../../einstellungen.mjs";
import { protokolliere } from "../../werkzeug-log.mjs";
import { ersterAufruf } from "./einmal.mjs";

function leseStdin() {
  try { return readFileSync(0, "utf8"); } catch { return ""; }
}

try {
  if (process.env.BRAIN_ERNTE !== "1") {
    const eingabe = JSON.parse(leseStdin());
    const toolName = String(eingabe?.tool_name || "");
    const istMcp = /^mcp__.+__.+$/.test(toolName);
    const vault = vaultPfadOderEnde(process.argv, { still: true, kontoPruefen: false });
    // KI-Konten: Hat das Konto für den Vault keine Stufe, wird nichts protokolliert. Liest es aber ausdrücklich eine Datei IM Vault, ist das ein Zugriffsversuch:
    // Abweisung ins Aktivitätsprotokoll (P8a; mit Leseverbot hat Claude Code den Zugriff gestoppt, sonst hat Kortex dem Konto nichts geliefert).
    if (!kontoDarf(vault, "lesen")) {
      const f = toolName === "Read" ? eingabe?.tool_input?.file_path : null;
      if (typeof f === "string" && f) {
        const echt = (p) => { try { return realpathSync.native(p); } catch { return p; } };
        const abs = resolve(typeof eingabe?.cwd === "string" && eingabe.cwd ? eingabe.cwd : process.cwd(), f);
        const w = echt(vault), a = [abs, echt(abs)];
        if (a.some((x) => x === w || x.startsWith(w + sep))) meldeAbweisung(vault, { was: "lesen" });
      }
      process.exit(0);
    }
    // Dublette (derselbe Hook aus zwei Einstellungsdateien) würde jede Nutzung doppelt ins Protokoll schreiben.
    // Schlüssel: tool_use_id; fehlt sie (alte Claude-Code-Version), Werkzeugname + Eingabe.
    if ((istMcp || wert(vault, "liveAufleuchten") !== false)
      && ersterAufruf(vault, "werkzeug-protokoll", { sid: eingabe?.session_id, inhalt: eingabe?.tool_use_id || `${toolName}\0${JSON.stringify(eingabe?.tool_input ?? null)}` })) {
      protokolliere(vault, { sid: eingabe?.session_id, toolName, toolInput: eingabe?.tool_input });
    }
  }
} catch { /* nie blockierend, nie Ausgabe */ }
process.exit(0);
