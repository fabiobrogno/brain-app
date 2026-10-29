// tageslauf/ki.mjs — Budget je Lauf und der EINZIGE KI-Weg des Tageslaufs (Spec §5.1, §6.1): Haiku über rufeHaiku
// (--tools "", --strict-mcp-config, BRAIN_ERNTE=1) — die KI liefert nur Text/JSON, sie schreibt nie.
// Drei KI-Fehler in Folge (offline, claude kaputt) → ctx.ohneKi: KI-Schritte entfallen, der Lauf gilt nicht als erfolgreich.
import { findeClaude, rufeHaiku, leseClaudeAntwort } from "../ernte.mjs";

export function neuesBudget({ aufrufe = 60, minuten = 15 } = {}, uhr = Date.now) {
  const start = uhr();
  let benutzt = 0;
  return {
    frei: () => benutzt < aufrufe && uhr() - start < minuten * 60000,
    zeitUm: () => uhr() - start >= minuten * 60000,
    zaehle: () => { benutzt++; },
    stand: () => ({ aufrufe: benutzt, max: aufrufe, ms: uhr() - start }),
  };
}

// → { text } | { fehler } | { budget: true } | { ohneKi: true }. Aufrufer prüfen `r.text === undefined`.
// `modell` (optional, Standard haiku): der Richter (richter.mjs) fragt sonnet — gleicher Weg, gleiches Budget, gleiche Fehlerfolge.
export async function kiAufruf(ctx, { system, eingabe, zweck = "tageslauf", modell }) {
  if (ctx.ohneKi) return { ohneKi: true };
  if (!ctx.budget.frei()) { ctx.budgetErschoepft = true; return { budget: true }; }
  const befehl = ctx.claudeBefehl === undefined ? findeClaude() : ctx.claudeBefehl;
  if (!befehl) { ctx.ohneKi = true; ctx.grund = "claude nicht gefunden"; return { ohneKi: true }; }
  ctx.budget.zaehle();
  ctx.aufrufe++;
  const r = await rufeHaiku(befehl, system, eingabe, ctx.vault, { zweck: `tl${zweck}`, ...(modell ? { modell } : {}) });
  const a = r.fehler ? null : leseClaudeAntwort(r.ausgabe);
  if (a?.tokens) { ctx.tokens.ein += a.tokens.ein; ctx.tokens.aus += a.tokens.aus; }
  const fehler = r.fehler || a.fehler;
  if (fehler) {
    if (++ctx.kiFehlerFolge >= 3) { ctx.ohneKi = true; ctx.grund = `KI nicht erreichbar (${fehler})`; }
    return { fehler };
  }
  ctx.kiFehlerFolge = 0;
  return { text: a.text };
}
