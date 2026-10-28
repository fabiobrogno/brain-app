// .tools/tageslauf/aufraeumen.mjs — Schritt 1 (0 Tokens, Spec §5.2): Ins Archiv 90_archiv/vorschlaege-aussortiert/<grund>/
// (verschieben, nie löschen) kommen: herkunft ki · exakte und nahe Dubletten (import/aehnlich, ≥ 0,8; die neueste bleibt)
// · Stände mit einem neueren aus demselben Ordner · Lektions-Rohkandidaten, deren Thema seit 14 Tagen nicht wieder
// aufgetreten ist · Wartende ohne Seite > 60 Tage (nicht, wer nur auf einen Platz der Einschwingphase wartet) · alte Fakten OHNE Zitat, deren Sitzung erfolgreich nachgeerntet wurde
// (Marke .logs/ernte/nachernte/<sid> mit Status ok; Grund ersetzt-durch-nachernte — die Nach-Ernte hat sie belegt neu geschrieben,
// Stände und Lektionen nicht, darum bleiben die liegen). „Vorkommen" eines Rohkandidaten = Vorschläge mit gleichem Thema.
import { findeGruppen } from "../import/aehnlich.mjs";
import { aussortieren } from "./bestand.mjs";
import { leseNachernteMarken } from "../ernte.mjs";
import { nenntThema, THEMA_GRUND } from "../thema-ausschluss.mjs";

// Themen-Ausschluss hat Vorrang vor jedem anderen Grund: Fakten, Stände und Lektionen, die ein Wort aus automatik.ernteOhneThema nennen
// (ganzes Wort, Groß/Klein egal), gehen mit Grund thema-ausgeschlossen ins Archiv — noch vor jedem KI-Aufruf des Laufs.
const TAG = 86400e3;
const SITZUNGS_ARTEN = new Set(["fakt", "stand", "lektion"]);   // aus Sitzungen gewonnen; Pflege-Vorschläge betreffen schon vorhandene Seiten
export const LEKTION_TAGE = 14, WARTEN_TAGE = 60, DUBLETTE_SCHWELLE = 0.8;
const zeit = (v) => Date.parse(v.erstellt) || 0;
export const themaVon = (v) => String(v.titel).toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export const istRohkandidat = (v) => v.art === "lektion" && !v.regel;

// nachgeerntet: Set der Sitzungs-IDs, deren Nach-Ernte erfolgreich war (Marke Status ok).
export function aufraeumKandidaten(vorschlaege, { jetzt = Date.now(), nachgeerntet = new Set(), ohneThema = [] } = {}) {
  const raus = new Map();
  const setze = (v, grund) => { if (!raus.has(v.id)) raus.set(v.id, grund); };
  for (const v of vorschlaege) {
    if (SITZUNGS_ARTEN.has(v.art) && nenntThema(ohneThema, v.titel, v.text, v.zitat, v.regel, v.warum, v.wie)) setze(v, THEMA_GRUND);
  }
  for (const v of vorschlaege) if (v.herkunft === "ki") setze(v, "herkunft-ki");
  for (const v of vorschlaege) {
    if (v.art === "fakt" && !v.zitat && v.fm?.nachernte !== true && v.quelleSitzung && nachgeerntet.has(v.quelleSitzung)) setze(v, "ersetzt-durch-nachernte");
  }
  for (const v of vorschlaege) {
    // Wer nur auf einen freien Platz der Einschwingphase wartet (warten_grund einschwingen), hat eine Seite — der verfällt nicht, auch wenn die Prüfung lange dauert.
    if (v.unterordner === "_warten" && v.wartenGrund !== "einschwingen" && jetzt - (Date.parse(v.wartenSeit) || zeit(v)) > WARTEN_TAGE * TAG) setze(v, "ohne-seite");
  }
  for (const art of ["fakt", "stand"]) {
    const fs = vorschlaege.filter((v) => v.art === art && !raus.has(v.id));
    const nachId = new Map(fs.map((v) => [v.id, v]));
    const gruppen = findeGruppen(fs.map((v) => ({ id: v.id, text: `${v.titel}\n${v.text}`, titelNorm: themaVon(v) })), { schwelle: DUBLETTE_SCHWELLE });
    for (const g of gruppen) {
      const glieder = g.dateien.map((id) => nachId.get(id)).filter(Boolean).sort((a, b) => zeit(b) - zeit(a));
      for (const v of glieder.slice(1)) setze(v, "dublette");
    }
  }
  const staende = new Map();
  for (const v of vorschlaege.filter((x) => x.art === "stand" && !raus.has(x.id))) {
    const k = v.quelleOrdner || "?";
    const alt = staende.get(k);
    if (!alt) staende.set(k, v);
    else if (zeit(v) > zeit(alt)) { setze(alt, "stand-ueberholt"); staende.set(k, v); }
    else setze(v, "stand-ueberholt");
  }
  const themen = new Map();
  for (const v of vorschlaege.filter((x) => istRohkandidat(x) && !raus.has(x.id))) {
    const k = themaVon(v);
    themen.set(k, [...(themen.get(k) || []), v]);
  }
  for (const glieder of themen.values()) {
    if (glieder.length < 2 && jetzt - Math.max(...glieder.map(zeit)) > LEKTION_TAGE * TAG) glieder.forEach((v) => setze(v, "lektion-alt"));
  }
  return vorschlaege.filter((v) => raus.has(v.id)).map((v) => ({ v, grund: raus.get(v.id) }));
}

export function aufraeumen(ctx, vorschlaege) {
  const weg = new Set();
  let nachgeerntet = new Set();
  try { nachgeerntet = new Set([...leseNachernteMarken(ctx.vault)].filter(([, m]) => m?.status === "ok").map(([sid]) => sid)); } catch { /* ohne Marken bleibt alles liegen */ }
  for (const { v, grund } of aufraeumKandidaten(vorschlaege, { jetzt: ctx.jetzt, nachgeerntet, ohneThema: ctx.werte?.ernteOhneThema })) {
    try { aussortieren(ctx, v, grund); weg.add(v.id); } catch { /* bleibt liegen, nächster Lauf */ }
  }
  return { aussortiert: weg.size, rest: vorschlaege.filter((v) => !weg.has(v.id)) };
}
