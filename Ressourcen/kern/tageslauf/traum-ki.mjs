// tageslauf/traum-ki.mjs — Der KI-Weg des Traums: EIN Sonnet-Aufruf je Projekt, derselbe gehärtete Weg wie bei B3 (pflege-ki.mjs: sonnetArgs mit
// Pfadregeln, dontAsk, keine MCP-Server, Hooks aus, gepinnte Umgebung), nur enger: Werkzeuge Read/Edit/Write/Glob/Grep (kein Bash, kein Web), höchstens
// 50 Runden und 1,5 USD je Aufruf, Arbeitsordner = temporärer Ordner außerhalb von Vault, Wurzel und Konten (die sind zusätzlich für die KI gesperrt).
// Eigenes Budget (ctx.traumBudget, getrennt von B2 und B3), eigene Zähler (ctx.traumAufrufe, ctx.traumTokens). Wirft nie.
import { execFile } from "node:child_process";
import { leseClaudeAntwort } from "../ernte.mjs";
import { kiBefehl } from "./ki.mjs";
import { sonnetArgs, sonnetUmgebung } from "./pflege-ki.mjs";

export const TRAUM_WERKZEUGE = "Read,Edit,Write,Glob,Grep";
export const TRAUM_MAX_RUNDEN = 50, TRAUM_MAX_USD = 1.5, TRAUM_ZEITLIMIT_MS = 10 * 60000;
export const TRAUM_MINUTEN = 40;                                   // Zeitanteil des Traums im Tageslauf (alle Projekte zusammen)

// → { text } | { fehler } | { budget: true } | { ohneKi: true }
export async function rufeTraum(ctx, { system, eingabe, cwd, sperren = [], zeitlimitMs = TRAUM_ZEITLIMIT_MS }) {
  let args, env;
  try { args = sonnetArgs(system, cwd, { vault: ctx.vault, sperren, werkzeuge: TRAUM_WERKZEUGE, maxRunden: TRAUM_MAX_RUNDEN, maxUsd: TRAUM_MAX_USD }); env = sonnetUmgebung(cwd); }
  catch { return { fehler: "Arbeitsverzeichnis fehlt — keine Rechte ohne Pfad" }; }
  if (ctx.ohneKi) return { ohneKi: true };
  const b = ctx.traumBudget;
  if (b && !b.frei()) return { budget: true };
  const befehl = kiBefehl(ctx);
  if (!befehl) return { ohneKi: true };
  b?.zaehle();
  ctx.traumAufrufe = (ctx.traumAufrufe || 0) + 1;
  const r = await new Promise((resolve) => {
    let kind;
    try {
      kind = execFile(befehl.befehl, [...befehl.args, ...args],
        { cwd, env, timeout: zeitlimitMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: "utf8" },
        (err, stdout) => resolve(err
          ? { fehler: err.killed ? "Zeitlimit" : err.code === "ENOENT" ? "claude nicht startbar" : `Exit ${err.code ?? "?"}` }
          : { ausgabe: String(stdout || "") }));
    } catch { resolve({ fehler: "claude nicht startbar" }); return; }
    kind.stdin?.on("error", () => {});
    kind.stdin?.end(eingabe);
  });
  const a = r.fehler ? null : leseClaudeAntwort(r.ausgabe);
  if (a?.tokens) {
    const t = (ctx.traumTokens ??= { ein: 0, cache: 0, aus: 0 });
    const cache = a.tokens.cache || 0;
    t.ein += Math.max(0, a.tokens.ein - cache); t.cache += cache; t.aus += a.tokens.aus;
  }
  const fehler = r.fehler || a.fehler;
  if (fehler) return { fehler };
  return { text: a.text };
}
