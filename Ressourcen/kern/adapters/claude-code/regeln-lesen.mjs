#!/usr/bin/env node
// PreToolUse-Hook (Matcher Read) — K2 „Regeln am Read" (Spec §12.2): Liest Claude eine Datei, kommen die dafür
// passenden Lektionen aus <wiki>/_lektionen.md wörtlich mit (≤ 1.200 Zeichen) und — beim ersten Read in einem Repo je
// Sitzung, Schalter projektAutomatik — der Projekt-Steckbrief (K14). PreToolUse-Kontext erreicht Claude nur als JSON
// hookSpecificOutput.additionalContext und zusammen mit dem Werkzeug-Ergebnis — deshalb am Read (vor jedem Edit liest
// Claude die Datei), nicht am Edit. Jede Regel und jeder Steckbrief kommt je Sitzung nur einmal (.logs/gezeigt/<sid>.txt);
// ohne session_id nichts. Blockiert nie: Fehler → eine Zeile in .logs/hooks.log, Exit 0. 0 Tokens.
// BRAIN_ERNTE=1 (Selbstaufruf der Ernte) → nichts tun.
if (process.env.BRAIN_ERNTE === "1") process.exit(0);
import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";

let V = "", AUSGABE = "";
try {
  const { vaultPfad, ordner } = await import("../../pfade.mjs");
  V = vaultPfad([]);
  if (!existsSync(V)) process.exit(0);
  let e = {};
  try { e = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch {}
  const sid = String(e?.session_id || "").replace(/[^\w-]/g, "").slice(0, 64);
  const roh = e?.tool_name === "Read" ? e?.tool_input?.file_path : null;
  // Dublette (derselbe Hook aus zwei Einstellungsdateien) würde dieselbe Lektion doppelt einspielen: beide Aufrufe läsen
  // „gezeigt" vor dem Schreiben. Schlüssel: tool_use_id, sonst der Dateipfad.
  const { ersterAufruf } = await import("./einmal.mjs");
  if (sid && typeof roh === "string" && roh && ersterAufruf(V, "regeln-lesen", { sid, inhalt: e?.tool_use_id || roh })) {
    const datei = resolve(typeof e.cwd === "string" && e.cwd ? e.cwd : process.cwd(), roh);
    const { gezeigtListe, merkeGezeigt } = await import("../../gezeigt.mjs");
    const { regelnFuer } = await import("../../regeln.mjs");
    const gezeigt = gezeigtListe(V, sid);
    const teile = [], neu = [];
    const r = regelnFuer(V, datei, { gezeigt });
    if (r.text) { teile.push(r.text); neu.push(...r.ids.map((id) => `regel:${id}`)); }
    const { leseAutomatik } = await import("../../einstellungen.mjs");
    if (leseAutomatik(V).werte.projektAutomatik) {
      const { gitWurzel, findeProjektseite, steckbrief } = await import("../../projekt.mjs");
      const top = gitWurzel(dirname(datei));
      if (top && !gezeigt.has(`repo:${top}`)) {
        neu.push(`repo:${top}`);
        const seite = findeProjektseite(V, ordner(V).wiki, [basename(top)]);
        if (seite && !gezeigt.has(`steckbrief:${seite}`)) {
          const t = steckbrief(V, seite, { wurzel: top });
          if (t) { teile.push(t); neu.push(`steckbrief:${seite}`); }
        }
      }
    }
    if (neu.length) merkeGezeigt(V, sid, ...neu);
    if (teile.length) AUSGABE = JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: teile.join("\n\n") } });
  }
} catch (err) {
  try { if (V && existsSync(join(V, ".logs"))) appendFileSync(join(V, ".logs", "hooks.log"), `${new Date().toISOString().slice(0, 19)} regeln-lesen fehler=${err?.code || err?.name || "unbekannt"}\n`); } catch {}
}
if (AUSGABE) process.stdout.write(AUSGABE + "\n", () => process.exit(0));
else process.exit(0);
