// gemeinsam/kontingent.mjs — Kontingent der KI-Konten (Paket P7): Zahlen, Farbstufen, Lesen der Werte von Codex über das Programm selbst.
// Kortex liest dafür KEINEN Token und keinen Schlüsselbund und fragt Anthropic oder OpenAI nie selbst an:
//   · Claude Code meldet `rate_limits` an die Statuszeile (kortex-statuszeile.mjs schreibt sie nach <Support>/kontingent/<konto>.json),
//   · Codex beantwortet `account/rateLimits/read` an seinem eigenen App-Server (`codex … app-server`, JSON-RPC über stdin/stdout) — die Anfrage macht das Programm mit seiner
//     eigenen Anmeldung, Kortex sieht nur die Antwort (Prozent, Fensterlänge, Rücksetzzeit).
// Muster: Orca src/main/rate-limits/codex-rpc-rate-limit-probe.ts, codex-rate-limit-window-classification.ts, codex-rate-limit-window-mapper.ts,
// src/main/codex-cli/codex-read-only-app-server-args.ts, src/main/rate-limits/service/service-types.ts @9bccd67 (MIT, Lovecast Inc.).
import { spawn } from "node:child_process";
import { registriere, beendeGruppe, beendetGerade } from "./prozess.mjs";

export const FENSTER_5H = 300;       // Orca: CODEX_SESSION_WINDOW_MINUTES
export const FENSTER_WOCHE = 10080;  // Orca: CODEX_WEEKLY_WINDOW_MINUTES
export const TAKT_MS = 15 * 60_000;       // Orca: DEFAULT_POLL_MS — alle 15 Minuten
export const MIN_NEU_MS = 5 * 60_000;     // Orca: MIN_REFETCH_MS — frühestens 5 Minuten nach der letzten Abfrage
export const VERALTET_MS = 30 * 60_000;   // Orca: STALE_THRESHOLD_MS — nach 30 Minuten „veraltet“
export const FEHLER_PAUSE_MIN_MS = 30_000;        // Orca: ACTIVE_FAILURE_REFETCH_MS — bei Fehlern 30 s …
export const FEHLER_PAUSE_MAX_MS = 15 * 60_000;   // … bis höchstens 15 Minuten
export const INIT_FRIST_MS = 30_000, RPC_FRIST_MS = 10_000;       // Orca: RPC_INIT_TIMEOUT_MS / RPC_TIMEOUT_MS
// Orca: CODEX_SHORT_LIVED_PROBE_APP_SERVER_ARGS — nur lesen, nie eine Rückfrage, keine Plugins für den kurzen Lauf
export const CODEX_ARGS = ["-c", "approval_policy=never", "-c", "features.plugins=false", "-s", "read-only", "-a", "never", "app-server"];

// Balkenfarben (Orca R/components/status-bar/provider-extra-usage-section.tsx, barColor): unter 60 grau · 60–79 gelb · ab 80 rot
export const stufe = (prozent) => (prozent >= 80 ? "rot" : prozent >= 60 ? "gelb" : "grau");

// Wartezeit nach dem n-ten Fehlschlag in Folge: 30 s, 60 s, 2 min … höchstens 15 min
export const fehlerPause = (anzahl) => Math.min(FEHLER_PAUSE_MAX_MS, FEHLER_PAUSE_MIN_MS * 2 ** Math.max(0, anzahl - 1));

// ---------- Codex: Fenster erkennen (Orca codex-rate-limit-window-classification.ts / -mapper.ts) ----------
const ZAHL = (x) => typeof x === "number" && Number.isFinite(x);
const abbildbar = (w) => (w && typeof w === "object" && ZAHL(w.usedPercent) ? w : null);
const ART = (w) => {
  const d = w.windowDurationMins;
  if (!ZAHL(d)) return null;
  if (Math.abs(d - FENSTER_5H) <= 1) return "session";   // ältere Fassungen weichen um eine Minute ab
  if (Math.abs(d - FENSTER_WOCHE) <= 1) return "weekly";
  return null;
};
// rateLimits (primary/secondary) → { session, weekly } als { usedPercent, windowMinutes, resetsAt (ms | null) } oder null
export function klassifiziereCodex(rl) {
  const primary = abbildbar(rl && rl.primary), secondary = abbildbar(rl && rl.secondary);
  let session = null, weekly = null;
  for (const w of [primary, secondary]) {
    if (!w) continue;
    const a = ART(w);
    if (a === "session" && !session) session = w; else if (a === "weekly" && !weekly) weekly = w;
  }
  if (!session && primary && ART(primary) === null) session = primary;    // unbekannte Länge: die alte Zuordnung primary = 5 Std, secondary = Woche
  if (!weekly && secondary && ART(secondary) === null) weekly = secondary;
  const abbilden = (w, minuten) => (w ? { usedPercent: Math.min(100, Math.max(0, w.usedPercent)), windowMinutes: minuten, resetsAt: ZAHL(w.resetsAt) && w.resetsAt > 0 ? w.resetsAt * 1000 : null } : null);
  return { session: abbilden(session, FENSTER_5H), weekly: abbilden(weekly, FENSTER_WOCHE) };
}

// Fehler der Anmeldung erkennt man am Text der Antwort; nach außen gehen nur feste Arten (nie der Text selbst: er könnte Pfade oder Kennungen enthalten).
const ANMELDUNG = /sign[ -]?in|log[ -]?in|logged out|not authenticated|unauthori[sz]ed|expired|refresh token|access token|\b401\b|chatgpt session/i;

// Fragt das Codex-Programm nach dem Kontingent. → { ok: true, session, weekly } | { ok: false, art: "fehlt"|"start"|"zeit"|"anmeldung"|"rpc"|"beendet"|"form"|"ende" }
//   o.programm: Pfad von `codex` · o.env: Umgebung (CODEX_HOME gesetzt/entfernt: Sache des Aufrufers) · o.cwd: neutraler leerer Ordner · o.initFrist / o.rpcFrist (ms)
// Das Programm läuft in einer eigenen Prozessgruppe und wird nach der Antwort (oder dem Zeitlimit) mit der ganzen Gruppe beendet; beim Beenden der Werkstatt räumt prozess.mjs auf.
export function liesCodexKontingent({ programm, env, cwd, initFrist = INIT_FRIST_MS, rpcFrist = RPC_FRIST_MS, signal = null } = {}) {
  return new Promise((aufloesen) => {
    if (beendetGerade()) return aufloesen({ ok: false, art: "ende" });
    let kind;
    try { kind = spawn(programm, CODEX_ARGS, { cwd, env, detached: true, stdio: ["pipe", "pipe", "pipe"], windowsHide: true }); }
    catch (e) { return aufloesen({ ok: false, art: e && e.code === "ENOENT" ? "fehlt" : "start" }); }
    registriere(kind, cwd);
    let fertig = false, uhr = null, puffer = "", fehlText = "", nr = 0, initId = null, rlId = null;
    const ende = (erg) => {
      if (fertig) return;
      fertig = true; clearTimeout(uhr);
      if (signal) signal.removeEventListener("abort", beiAbbruch);
      try { kind.stdin.destroy(); } catch { /* zu */ }
      beendeGruppe(kind);
      aufloesen(erg);
    };
    const beiAbbruch = () => ende({ ok: false, art: "ende" });
    if (signal) { if (signal.aborted) return ende({ ok: false, art: "ende" }); signal.addEventListener("abort", beiAbbruch, { once: true }); }
    const frist = (ms) => { clearTimeout(uhr); uhr = setTimeout(() => ende({ ok: false, art: "zeit" }), ms); };
    const sende = (methode, params) => { const id = ++nr; kind.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method: methode, params: params ?? {} })}\n`); return id; };
    const meldung = (methode) => kind.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: methode, params: {} })}\n`);
    kind.stdin.on("error", () => ende({ ok: false, art: "beendet" }));
    kind.stderr.on("data", (d) => { fehlText = (fehlText + d.toString()).slice(-20_000); });
    kind.stderr.on("error", () => { /* zu */ });
    kind.on("error", (e) => ende({ ok: false, art: e && e.code === "ENOENT" ? "fehlt" : "start" }));
    kind.on("close", () => ende({ ok: false, art: ANMELDUNG.test(fehlText) ? "anmeldung" : "beendet" }));
    kind.stdout.on("error", () => { /* zu */ });
    kind.stdout.on("data", (d) => {
      puffer += d.toString();
      if (puffer.length > 4 * 1024 * 1024) return ende({ ok: false, art: "rpc" });
      let i;
      while ((i = puffer.indexOf("\n")) >= 0) {
        const zeile = puffer.slice(0, i).trim(); puffer = puffer.slice(i + 1);
        if (!zeile) continue;
        let m; try { m = JSON.parse(zeile); } catch { continue; } // keine Zeile des Protokolls
        if (!m || m.id === undefined || m.id === null) continue;
        if (m.id === initId) {
          if (m.error) return ende({ ok: false, art: "rpc" });
          frist(rpcFrist);
          try { meldung("initialized"); rlId = sendeRl(); } catch { return ende({ ok: false, art: "beendet" }); }
        } else if (rlId !== null && m.id === rlId) {
          if (m.error) return ende({ ok: false, art: ANMELDUNG.test(String(m.error.message || "")) || ANMELDUNG.test(fehlText) ? "anmeldung" : "rpc" });
          const w = m.result && typeof m.result === "object" ? m.result.rateLimits : null;
          const k = klassifiziereCodex(w);
          return ende(k.session || k.weekly ? { ok: true, ...k } : { ok: false, art: "form" });
        }
      }
    });
    const sendeRl = () => sende("account/rateLimits/read");
    frist(initFrist);
    try { initId = sende("initialize", { clientInfo: { name: "kortex", version: "1.0.0" } }); } catch { ende({ ok: false, art: "beendet" }); }
  });
}
