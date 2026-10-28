// .tools/tageslauf/lektionen-schritt.mjs — Schritt 9 (Spec §5.2): fertige Lektions-Vorschläge → Rückfrage „lektion“;
// Rohkandidaten mit gleichem Thema (≥ 2) → EIN Haiku-Aufruf je Gruppe formuliert höchstens eine Regel (optional mit
// „gilt:“-Dateimustern) → Rückfrage; Antwort NICHTS → aussortiert (keine-lektion). Einzelne Rohkandidaten bleiben liegen
// (Schritt 1 archiviert sie nach 14 Tagen). Aktiviert wird erst nach deinem Ja (Schritt 0, antworten.mjs) — hier nie.
import { LEKTION_AUFTRAG, KANDIDATEN_KOPF, parseLektionen } from "../lektionen.mjs";
import { legeRueckfrageAn } from "../rueckfragen.mjs";
import { kiAufruf } from "./ki.mjs";
import { aussortieren } from "./bestand.mjs";
import { themaVon, istRohkandidat } from "./aufraeumen.mjs";

export const GILT_ZEILE = "Optional je Block eine Zeile „gilt: <bis zu 5 Dateimuster, kommagetrennt, z. B. *.mjs oder ~/brain/**>“ — nur wenn die Regel klar an bestimmte Dateien gebunden ist, sonst weglassen.";
export const GRUPPEN_AUFTRAG = `${LEKTION_AUFTRAG}\nFasse alle Kandidaten zu höchstens EINER Lektion zusammen.\n${GILT_ZEILE}`;

export function parseGruppenLektion(text) {
  const t = String(text || "").replace(/\r\n?/g, "\n").trim();
  const block = t.split(/^###[ \t]+/m)[1];
  if (!block) return null;
  const [l] = parseLektionen(`### ${block}`);
  if (!l) return null;
  const g = block.match(/^\s*gilt\s*:\s*(.+)$/im);
  const giltFuer = g ? g[1].split(",").map((m) => m.replace(/[`"„“]/g, "").trim()).filter((m) => m && m.length <= 200).slice(0, 5) : [];
  return { ...l, giltFuer };
}

const beschreibung = (l) => [`Regel: ${l.regel}`, l.warum && `Warum: ${l.warum}`, l.wie && `Wie: ${l.wie}`,
  l.giltFuer.length && `Gilt für: ${l.giltFuer.join(", ")}`].filter(Boolean).join("\n");
const felder = (l) => ({ titel: l.titel, regel: l.regel, warum: l.warum, wie: l.wie, gilt_fuer: l.giltFuer });

export async function lektionenSchritt(ctx, vorschlaege) {
  const erg = { rueckfragen: 0, aussortiert: 0, offen: 0 };
  const lektionen = vorschlaege.filter((v) => v.art === "lektion");
  for (const v of lektionen.filter((x) => !istRohkandidat(x))) {
    const l = { titel: v.titel, regel: v.regel, warum: v.warum, wie: v.wie, giltFuer: [] };
    legeRueckfrageAn(ctx, { typ: "lektion", frage: `Neue Regel aktivieren: ${v.titel}?`, beschreibung: beschreibung(l), vorschlaege: [v], grund: "lektion", felder: felder(l) });
    erg.rueckfragen++;
  }
  const gruppen = new Map();
  for (const v of lektionen.filter(istRohkandidat)) { const k = themaVon(v); if (!gruppen.has(k)) gruppen.set(k, []); gruppen.get(k).push(v); }
  let stop = false;
  for (const [thema, gruppe] of gruppen) {
    if (stop || gruppe.length < 2) { erg.offen += gruppe.length; continue; }
    const eingabe = KANDIDATEN_KOPF + gruppe.slice(0, 5).map((v, i) => `## Kandidat ${i + 1}: ${thema}\n${String(v.text).slice(0, 1500)}`).join("\n\n") + "\n";
    const r = await kiAufruf(ctx, { system: GRUPPEN_AUFTRAG, eingabe, zweck: "lektion" });
    if (r.text === undefined) { erg.offen += gruppe.length; stop = !!(r.budget || r.ohneKi); continue; }
    const l = parseGruppenLektion(r.text);
    if (!l) {
      if (/^\s*NICHTS\b/.test(r.text)) for (const v of gruppe) { aussortieren(ctx, v, "keine-lektion"); erg.aussortiert++; }
      else erg.offen += gruppe.length;   // unbrauchbare Antwort → nächster Lauf
      continue;
    }
    legeRueckfrageAn(ctx, { typ: "lektion", frage: `Neue Regel aktivieren: ${l.titel}?`, vorschlaege: gruppe, grund: "lektion-formuliert",
      beschreibung: `${beschreibung(l)}\n(aus ${gruppe.length} ähnlichen Korrekturen: ${thema})`, felder: felder(l) });
    erg.rueckfragen++;
  }
  return erg;
}
