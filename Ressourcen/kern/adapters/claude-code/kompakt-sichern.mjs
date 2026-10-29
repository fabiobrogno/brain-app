#!/usr/bin/env node
// PreCompact-Hook (K12, Spec §12.2): sichert vor der Kompaktierung den Arbeitsstand DIESER Sitzung als wörtliche
// Auszüge nach .logs/sitzungen/<session_id>.{json,md} (arbeitsstand.mjs). Claude Code spielt die Ausgabe eines
// PreCompact-Hooks nicht ein — darum nur Seiteneffekt; eingespielt wird beim SessionStart mit source "compact".
// Gibt NIE etwas aus, Exit immer 0 (blockiert nie die Kompaktierung). Liest höchstens 16 MB ab der letzten Marke,
// Frist 3 s. BRAIN_ERNTE=1 (Selbstaufruf der Ernte) → nichts tun.
if (process.env.BRAIN_ERNTE === "1") process.exit(0);
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const t0 = Date.now();
try {
  const { vaultPfadOderEnde } = await import("../../pfade.mjs");
  const { sammle, schreibe, leseZustand, saubereSid } = await import("../../arbeitsstand.mjs");
  const { haengeAn, zeitstempel } = await import("../../logs.mjs");
  const V = vaultPfadOderEnde([], { still: true });
  let e = {};
  try { e = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch {}
  const sid = saubereSid(e?.session_id);
  // Dublette (derselbe Hook aus zwei Einstellungsdateien): nicht doppelt sichern und nicht doppelt loggen.
  const { ersterAufruf } = await import("./einmal.mjs");
  if (!ersterAufruf(V, "kompakt-sichern", { sid, inhalt: e?.trigger })) process.exit(0);
  const transkript = typeof e?.transcript_path === "string" ? e.transcript_path : "";
  if (sid && transkript && existsSync(transkript)) {
    const z = sammle(transkript, { vorher: leseZustand(V, sid) });
    schreibe(V, sid, z);
    haengeAn(join(V, ".logs", "hooks.log"),
      `${zeitstempel()} kompakt-sichern sid=${sid.slice(0, 8)} nachrichten=${z.nachrichten.length} luecke=${z.luecke ? 1 : 0} ms=${Date.now() - t0}`);
  }
} catch { /* nie blockierend, nie Ausgabe */ }
process.exit(0);
