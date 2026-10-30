// tageslauf/ki.mjs — Budget je Lauf und der EINZIGE KI-Weg des Tageslaufs (Spec §5.1, §6.1): Haiku über rufeHaiku
// (--tools "", --strict-mcp-config, BRAIN_ERNTE=1) — die KI liefert nur Text/JSON, sie schreibt nie.
// Drei KI-Fehler in Folge (offline, claude kaputt) → ctx.ohneKi: KI-Schritte entfallen, der Lauf gilt nicht als erfolgreich.
import { findeClaude, rufeHaiku, leseClaudeAntwort } from "../ernte.mjs";
import { kiKontoDarf } from "../pfade.mjs";

// KI-Konten (docs/plaene/ki-konten.md): DER Weg, auf dem jede KI-Stelle des Hintergrunds (Tageslauf, B3, Traum, Pflege-Lauf, Antwort-Messlatte) ihren claude-Befehl bekommt.
// Vault-Inhalt geht nur an eine KI, wenn das Konto dieses Prozesses (CLAUDE_CONFIG_DIR der Umgebung, sonst Standardprofil) für den Vault mindestens „erweitert“ hat
// (pfade.mjs#kiKontoDarf); sonst läuft die Pflege „ohne KI“ wie bei fehlendem claude. Die Meldung nennt weder Konto noch Pfade.
export const KI_STUFE = "erweitert";
export const KI_KONTO_GRUND = "Das KI-Konto dieses Dienstes hat für diesen Vault keine ausreichende Freigabe — die Pflege läuft ohne KI";
export const kiKontoErlaubt = (vault) => kiKontoDarf(vault, KI_STUFE);

// → { befehl, args } | null. Ohne Befehl ist ctx.ohneKi gesetzt (KI-Schritte entfallen). `ueberschreibe`: ein schon gesetzter ctx.grund wird ersetzt (sonst bleibt er).
export function kiBefehl(ctx, { ueberschreibe = false } = {}) {
  const erlaubt = kiKontoErlaubt(ctx.vault);
  const befehl = erlaubt ? (ctx.claudeBefehl === undefined ? findeClaude() : ctx.claudeBefehl) : null;
  if (befehl) return befehl;
  ctx.ohneKi = true;
  ctx.kiKontoGesperrt = !erlaubt;
  const grund = erlaubt ? "claude nicht gefunden" : KI_KONTO_GRUND;
  if (ueberschreibe || !ctx.grund) ctx.grund = grund;
  return null;
}

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
  const befehl = kiBefehl(ctx, { ueberschreibe: true });
  if (!befehl) return { ohneKi: true };
  ctx.budget.zaehle();
  ctx.aufrufe++;
  const r = await rufeHaiku(befehl, system, eingabe, ctx.vault, { zweck: `tl${zweck}`, konto: KI_STUFE, ...(modell ? { modell } : {}) });
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
