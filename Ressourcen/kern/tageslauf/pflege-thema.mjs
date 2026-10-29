// tageslauf/pflege-thema.mjs — Themen-Guard der Pflege (B3): Alles, was die Pflege an eine KI gibt oder ins Wiki schreibt
// (Inbox headless, Konsolidieren, neue Seiten), geht vorher durch pflegeGrund(). Gleiche Regeln wie die Ernte:
//   ernteOhneThema  Wortliste (thema-ausschluss.mjs) — ein ausgeschlossenes Wort in Name/Text → nichts davon an die KI
//   ernteNichtIn    Ordnerliste — nennt der Text einen Pfad in einem ausgeschlossenen Ordner (lektionen.mjs#nenntAusgeschlossenes) → ebenso
// Fail-closed: ohne lesbare Einstellungen (ctx.werte fehlt oder die beiden Listen sind keine Listen) gilt ALLES als ausgeschlossen.
// Der Grund steht im Bericht nur als Zahl je Grund — nie das Wort selbst, nie der Titel.
import { nenntThema, THEMA_GRUND } from "../thema-ausschluss.mjs";
import { nenntAusgeschlossenes } from "../lektionen.mjs";

export const GRUND_THEMA = THEMA_GRUND, GRUND_PFAD = "ordner-ausgeschlossen", GRUND_CONFIG = "config-unlesbar";

export const konfigLesbar = (ctx) => !!ctx?.werte && typeof ctx.werte === "object"
  && Array.isArray(ctx.werte.ernteOhneThema) && Array.isArray(ctx.werte.ernteNichtIn);

// → null (frei) | GRUND_THEMA | GRUND_PFAD | GRUND_CONFIG
export function pflegeGrund(ctx, ...texte) {
  try {
    if (!konfigLesbar(ctx)) return GRUND_CONFIG;
    const t = texte.filter((x) => typeof x === "string");
    if (nenntThema(ctx.werte.ernteOhneThema, ...t)) return GRUND_THEMA;
    if (t.some((x) => nenntAusgeschlossenes(x, ctx.werte.ernteNichtIn, ""))) return GRUND_PFAD;
    return null;
  } catch { return GRUND_THEMA; }
}

// Zeilen, die in `neu` stehen und in `alt` nicht — für die Prüfung dessen, was eine KI neu ins Wiki geschrieben hat.
export function hinzugefuegt(alt, neu) {
  const vorhanden = new Set(String(alt ?? "").split(/\r?\n/).map((z) => z.trim()));
  return String(neu ?? "").split(/\r?\n/).filter((z) => z.trim() && !vorhanden.has(z.trim())).join("\n");
}

// Zähler je Grund im Lauf (ctx.pflegeInfo.thema = { <grund>: n }) — für den Bericht.
export function zaehleGrund(ctx, grund, n = 1) {
  const t = ((ctx.pflegeInfo ??= {}).thema ??= {});
  t[grund] = (t[grund] || 0) + n;
}
