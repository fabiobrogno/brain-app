// tageslauf/ki.mjs — Budget je Lauf und der EINZIGE KI-Weg des Tageslaufs (Spec §5.1, §6.1): Haiku über rufeHaiku
// (--tools "", --strict-mcp-config, BRAIN_ERNTE=1) — die KI liefert nur Text/JSON, sie schreibt nie.
// Drei KI-Fehler in Folge (offline, claude kaputt) → ctx.ohneKi: KI-Schritte entfallen, der Lauf gilt nicht als erfolgreich.
import { findeClaude, rufeHaiku, leseClaudeAntwort } from "../ernte.mjs";
import { kiKontoDarf } from "../pfade.mjs";
import { pflegeAufloesen } from "../pflege-konto.mjs";

// KI-Konten (docs/plaene/ki-konten.md): DER Weg, auf dem jede KI-Stelle des Tageslaufs (B2, B3, Richter, Traum) ihren claude-Befehl bekommt. Das Konto bestimmt die Pflege-Einstellung des Vaults
// (pflegeVon, kern/pflege-konto.mjs); fehlt sie, gilt der alte Weg: das Konto der Prozess-Umgebung (CLAUDE_CONFIG_DIR, sonst Standardprofil). In beiden Fällen geht Vault-Inhalt nur an eine KI, wenn dieses
// Konto für den Vault mindestens „erweitert“ hat (pfade.mjs#kiKontoDarf); sonst läuft die Pflege „ohne KI“. Die Meldung nennt weder Konto noch Pfade.
// NICHT über diesen Weg laufen der Pflege-Lauf (pflegelauf.mjs) und die Antwort-Messlatte: sie prüfen nur kiKontoErlaubt (Konto ihres Prozesses) und folgen der Pflege-Einstellung nicht.
export const KI_STUFE = "erweitert";
export const KI_KONTO_GRUND = "Das KI-Konto dieses Dienstes hat für diesen Vault keine ausreichende Freigabe — die Pflege läuft ohne KI";
export const kiKontoErlaubt = (vault) => kiKontoDarf(vault, KI_STUFE);

// Pflege-Einstellung dieses Vaults (kern/pflege-konto.mjs): Konto, Stufe und die Umgebung aller KI-Aufrufe des Laufs. Einmal je Lauf berechnet und am Lauf gemerkt.
export const pflegeVon = (ctx) => (ctx.pflege ??= pflegeAufloesen(ctx.vault));
// Stufe „klein“: nur Haiku — der Richter und alle anderen Urteile fragen haiku; die teuren Schritte (B3-Schreibpflege, Traum) laufen nicht.
export const istKlein = (ctx) => pflegeVon(ctx).stufe === "klein" && pflegeVon(ctx).modus !== "aus";
export const modellFuer = (ctx, wunsch) => (istKlein(ctx) ? "haiku" : wunsch);
export const KI_BEWUSST_OHNE = "Die Pflege läuft ohne KI, so ist es eingestellt";
// Satz, warum an dieser Stelle keine KI läuft (für Berichte): bewusst gewählt · Konto reicht nicht · claude fehlt.
export const ohneKiText = (ctx) => (ctx.kiBewusstOhne ? KI_BEWUSST_OHNE : ctx.kiKontoGesperrt ? (pflegeVon(ctx).grund || KI_KONTO_GRUND) : "claude nicht gefunden");

// → { befehl, args } | null. Ohne Befehl ist ctx.ohneKi gesetzt (KI-Schritte entfallen). `ueberschreibe`: ein schon gesetzter ctx.grund wird ersetzt (sonst bleibt er).
// Das Konto kommt aus der Pflege-Einstellung (pflegeVon); ohne sie aus der Umgebung des Prozesses. Ist „ohne KI“ bewusst gewählt, setzt das keinen Grund (kein Warnzustand).
export function kiBefehl(ctx, { ueberschreibe = false } = {}) {
  const p = pflegeVon(ctx);
  const erlaubt = p.modus !== "aus" && kiKontoDarf(ctx.vault, KI_STUFE, { env: p.env });
  const befehl = erlaubt ? (ctx.claudeBefehl === undefined ? findeClaude() : ctx.claudeBefehl) : null;
  if (befehl) return befehl;
  ctx.ohneKi = true;
  ctx.kiKontoGesperrt = !erlaubt && !p.bewusst;
  ctx.kiBewusstOhne = !erlaubt && p.bewusst;
  const grund = erlaubt ? "claude nicht gefunden" : p.bewusst ? null : (p.grund || KI_KONTO_GRUND);
  if (grund && (ueberschreibe || !ctx.grund)) ctx.grund = grund;
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
  const m = modellFuer(ctx, modell);
  const r = await rufeHaiku(befehl, system, eingabe, ctx.vault, { zweck: `tl${zweck}`, konto: KI_STUFE, env: pflegeVon(ctx).env, ...(m ? { modell: m } : {}) });
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
