#!/usr/bin/env node
// tageslauf.mjs — Der Tageslauf (Spec §5): lokal, einmal am Tag, nie mit Rückfrage-Dialog. Ablauf:
//  (vorab: Protokoll heilen — Übernahme-Commits ohne Aktion nachtragen) · 0 Antworten anwenden + W7 · 1 Aufräumen · 2 Belege nachholen ·
//  R1/R2 früh (feste Regeln ohne KI: Wunsch statt Fakt, Zahl ohne Zeitraum → ⚪) · 3 Einordnen (bei „mehrdeutig“ wählt Haiku unter den Kandidaten) · 4 Abgleich · 5 Stufe ·
//  bei 🟢 der RICHTER (Sonnet, richter.mjs): nur sein „übernehmen“ erlaubt eine Übernahme, sonst ⚪/🟡/⏸; danach R3 (Zielseite nach dem Zitat geändert), R4
//  (Seite aus der Seitenwahl) und R5 (Zitat älter als 7 Tage) → 🟡 Rückfrage statt Automatik. Autostufe „aus“ (Lernmodus, Startzustand): derselbe Weg — erst der Richter, nur sein
//  „übernehmen“ wird zur MARKIERTEN Autostufe-Rückfrage (R3/R4/R5 als Hinweis im Text); lehnt der Richter ab, gilt sein Ausgang, nie eine markierte Rückfrage ·
//  6/7 Schreiben in der Arbeitskopie (ein Commit je Auftrag) + ff-Merge (Aktionen sofort danach ins Protokoll) · Einschwingphase als Tor
//  (0b Stand nach den Antworten, bei 🟢 nur die freien Plätze, 7b je Übernahme sofort eine Stichprobe; nie in der Probe) · Rücknahmen aus Stichproben ·
//  B3 (Schalter pflegeIntelligenz): vor 1–5 K7/K4-Aufträge, nach den Rücknahmen die Pflege (eigene Arbeitskopie, eigener Merge; im Lernmodus nur als Rückfrage).
//  8 Verfall, Konflikte, Stichproben, „bewährt", Autostufe · 9 Lektionen · 9b Traum (Pflege des Claude-Gedächtnisses, Schalter traum) · 10 Bericht + letzter.json.
// Probemodus (--probe oder Schalter tageslauf: probe): rechnet alles (auch die Commits in der Arbeitskopie), merged nicht,
// verschiebt nichts, legt keine Rückfragen an, räumt keine Reste auf; Aktionen nach probe-aktionen.jsonl, Bericht <datum>-probe.md.
// Fehlerbild: Jeder Schritt und jeder Vorschlag hat seine eigene Fehlergrenze — ein Fehler wird als Aktion „fehler" vermerkt,
// der Rest läuft weiter; nach dem Merge wird jede Übernahme protokolliert, auch wenn das Verschieben danach scheitert.
// Erfolg (für „fällig") = voller Lauf mit ok oder abgebrochen; ohne KI, teilweise oder mit Fehler wird er beim nächsten Takt wiederholt.
// CLI: node tageslauf.mjs <vault> [--wenn-faellig] [--dienst] [--probe] [--nur-antworten] [--losgeloest]
//        [--budget-aufrufe N] [--budget-minuten N]        Exit 0 (auch übersprungen) · 1 Fehler · 64 Aufruf falsch
import { readFileSync, appendFileSync, mkdirSync, readdirSync, existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ordner, vaultPfadOderEnde } from "./pfade.mjs";
import { leseAutomatik, TAGESLAUF_BUDGETS } from "./einstellungen.mjs";
import { istHeikel } from "./heikel.mjs";
import { aussageGedeckt, kernsatz, FUNDSTELLE_MUSTER } from "./beleg-ernte.mjs";
import { findeClaude } from "./ernte.mjs";
import { findeSecrets, ohneSecrets } from "./secrets-muster.mjs";
import { nenntThema, THEMA_GRUND } from "./thema-ausschluss.mjs";
import { legeRueckfrageAn, sichtbare, verfallen, konfliktRueckfragen, stichprobenAuffuellen, archiviereRueckfrage, listeRueckfragen, istAutostufeRueckfrage, AUTOSTUFE_QUELLE } from "./rueckfragen.mjs";
import { ladeVorschlaege, verschiebeVorschlag, aussortieren, warten, UNTERORDNER } from "./tageslauf/bestand.mjs";
import { TL_DIR, heute, neuerLauf, notiere, schreibeAktionen, haengeNachtragAn, leseAktionen, lesePruefungen, speichereCache, schreibeLetzter, leseLetzter, hinweisNutzung, protokollGesund, PROTOKOLL_GRUND } from "./tageslauf/protokoll.mjs";
import { faellig, bedingungen, nimmSperre, gibSperreFrei, markeStart, starteLosgeloest } from "./tageslauf/zeitplan.mjs";
import { aufraeumen } from "./tageslauf/aufraeumen.mjs";
import { belegeNachholen } from "./tageslauf/belege.mjs";
import { seitenKarten, ladeAliasse, einordnen } from "./tageslauf/einordnen.mjs";
import { abgleich, waehleSeite } from "./tageslauf/abgleich.mjs";
import { stufe } from "./tageslauf/stufe.mjs";
import { fruehePruefung, istSeitenwahl, seiteNeuerAlsZitat, zitatZeitAusFundstelle, istAltbestand, WUNSCH_GRUND, ZAHL_GRUND, ALTBESTAND_GRUND, ALTBESTAND_TAGE } from "./tageslauf/regeln.mjs";
import { richte, vermerkeRichter } from "./tageslauf/richter.mjs";
import { legeArbeitskopieAn, verwerfeArbeitskopie, raeumeResteAuf, commitAuftrag, uebernehmen, commitsDesLaufs, nimmIngestSperre, gibIngestSperreFrei } from "./tageslauf/arbeitskopie.mjs";
import { aktualisiereAutostufe, stichprobenJeWoche, bewaehrtePruefungen, rueckwegStand, ZURUECK_NACH } from "./tageslauf/autostufe.mjs";
import { wendeAntwortenAn, w7Eingang } from "./tageslauf/antworten.mjs";
import { einschwingStand, einschwingenStart, einschwingTor, einschwingenSchritt } from "./tageslauf/einschwingen.mjs";
import { lektionenSchritt } from "./tageslauf/lektionen-schritt.mjs";
import { ruecknahmenSchritt } from "./tageslauf/ruecknahmen.mjs";
import { heileProtokoll, notiereHeilung } from "./tageslauf/heilung.mjs";
import { b3Auftraege, b3Schritte, pflegeBerichtZeilen, pflegeNachlaufOffen } from "./tageslauf/b3.mjs";
import { gedaechtnisSchritt } from "./gedaechtnis.mjs";
import { gesundheitSchritt, gesundheitBerichtZeilen, gesundheitKurz } from "./tageslauf/gesundheit.mjs";
import { traumSchritt, traumBerichtZeilen } from "./tageslauf/traum.mjs";

const TAG = 86400e3;
const DAUERHAFT = new Set(["seite-unlesbar", "seite-fehlt", "kritisch", "kein-cluster", "auftrag-unbekannt", "pruefung-rot", "schreiben-fehlgeschlagen"]);
const MERGE_TEXT = {
  "vault-nicht-auf-main": "Der Vault steht nicht auf main — Übernahmen beim nächsten Lauf",
  konflikt: "Eine Zielseite wurde inzwischen geändert — Übernahmen beim nächsten Lauf",
  "lokale-aenderung": "Ungespeicherte Änderungen an einer Zielseite — Übernahmen beim nächsten Lauf",
};
const GRUND_TEXT = { kritisch: "Die Zielseite ist als kritisch markiert.", unklar: "Der Abgleich mit der Seite war nicht eindeutig.",
  heikel: "Es geht um Geld, Personen, Kunden oder Ähnliches.", "autostufe-aus": "Automatisches Übernehmen ist wegen der Fehlerquote gerade aus. Deine Antwort hilft der Automatik zurück: „Übernehmen“ heißt, die Regeln hatten recht, „Verwerfen“, sie lagen falsch.",
  web: "Die Quelle ist eine Webseite.",
  // Nach dem Richter (B2.1/B2.2): auch ein „übernehmen“ der Prüfung wird bei diesen drei Fällen nicht automatisch geschrieben. Bei den markierten Rückfragen des Lernmodus stehen sie als Hinweis dabei.
  "seite-seither-geaendert": "Seite seither geändert — die Zielseite wurde nach dem Zitat geändert (von Hand oder in einer anderen Sitzung), der Fakt könnte dort inzwischen stehen oder überholt sein.",
  seitenwahl: "Die Zielseite stand nicht eindeutig fest, sie wurde unter mehreren Seiten ausgewählt (Seitenwahl) — bitte prüfen, ob der Fakt wirklich dorthin gehört.",
  [ALTBESTAND_GRUND]: `Zitat älter als ${ALTBESTAND_TAGE} Tage — später evtl. überholt: Bei altem Zitat liegt die Wahrheit oft in späteren Sitzungen, die weder die Prüfung noch das Wiki kennen.` };
// Lernmodus (Autostufe „aus“ aus dem Start, nicht aus Fehlern): statt der Fehlerquote erklärt die markierte Rückfrage, dass die Automatik erst lernt.
const LERNMODUS_TEXT = `Lernmodus — die Automatik schreibt noch nichts selbst, bis du ${ZURUECK_NACH} Urteile in Folge bestätigt hast. Deine Antwort zählt als Prüfung: „Übernehmen“ = die Prüfung hatte recht, „Verwerfen“ = sie lag falsch (die Zählung beginnt dann von vorn).`;
// Rückfrage-Gründe der Zeit nach dem Richter: R3/R4 (eine Zeile) und R5 (eigene Zeile) in Bericht und Protokoll gezählt.
const R34_GRUENDE = ["seite-seither-geaendert", "seitenwahl"];
const R345_GRUENDE = [...R34_GRUENDE, ALTBESTAND_GRUND];
const AUS_GRUND = "autostufe-aus";
const STATUS_TEXT = { ok: "fertig", teilweise: "teilweise", abgebrochen: "Budget aufgebraucht, geht beim nächsten Lauf weiter",
  "ohne-ki": "ohne KI", fehler: "mit Fehler abgebrochen" };
const PROTOKOLL_TEXT = `Das Aktionsprotokoll lässt sich nicht schreiben (${PROTOKOLL_GRUND}) — keine automatischen Übernahmen, bis es wieder geht`;
const kurz = (s, n = 160) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const iso = (ms) => new Date(ms).toISOString().slice(0, 19) + "Z";

// Fehlergrenze für einen Schritt: der Fehler wird vermerkt, der Lauf gilt als „teilweise" (also nicht erfolgreich), alles
// bisher Getane bleibt gültig (jeder Teilschritt ist für sich vollständig oder gar nicht passiert).
async function schritt(ctx, zahl, name, f, bei = undefined) {
  try { return await f(); }
  catch (e) {
    zahl.teilweise = true;
    ctx.grund ||= `Schritt „${name}“ ist fehlgeschlagen: ${kurz(e?.message, 100)}`;
    notiere(ctx, { id: "lauf", stufe: "fehler", grund: `${name}: ${kurz(e?.message, 160)}` });
    return bei;
  }
}

// Fail-closed (Befund N3): Das Einschwing-Tor zählt nur, was in aktionen.jsonl/pruefungen.jsonl steht. Ist das Protokoll nicht les-/anhängbar — vorab festgestellt
// (protokollGesund) oder weil das sichere Schreiben nach dem Merge scheiterte —, übernimmt dieser Lauf nichts mehr automatisch (die 🟢 bleiben als „offen“ liegen),
// das Tor vergibt keine Plätze (frei = 0), der Lauf gilt als teilweise (wird wiederholt) und sagt es laut: Grund, Bericht, letzter.json, Morgenzeile. Mehrfach aufrufbar.
function protokollKaputt(ctx, zahl, fehler) {
  zahl.teilweise = true;
  if (ctx.protokollKaputt) return;
  ctx.protokollKaputt = true;
  ctx.grund = ctx.grund ? `${PROTOKOLL_TEXT}; ${ctx.grund}` : PROTOKOLL_TEXT;
  notiere(ctx, { id: "lauf", stufe: "fehler", grund: `${PROTOKOLL_GRUND}: ${kurz(fehler, 40)}` });
}

// Selbstheilung (heilung.mjs, Doppelausfall nach dem Merge): Commits des Tageslaufs auf main ohne Aktion im Protokoll werden zu Beginn des Laufs rekonstruiert, BEVOR das Tor
// seinen Stand liest — sonst öffnete es nach einem Protokollausfall wieder, und `brain zurueck` fände die Übernahmen nicht. Nur bei gesundem Protokoll (sonst gäbe es nichts zu
// schreiben; protokollKaputt hält den Lauf ohnehin fail-closed). Scheitert Lesen/Schreiben der Heilung selbst, gilt das Protokoll als nicht schreibbar (laut, fail-closed).
function heileLauf(ctx, zahl) {
  const h = heileProtokoll(ctx.vault, { jetzt: ctx.jetzt });
  if (h.fehler) { protokollKaputt(ctx, zahl, `heilung ${h.fehler}`); return; }
  notiereHeilung(ctx, h);
  if (h.unklar.length) notiere(ctx, { id: "lauf", stufe: "fehler", grund: `heilung: ${h.unklar.length} Übernahme-Commit(s) ohne erkennbare Seite — nicht rekonstruiert (${h.unklar.map((u) => u.id).slice(0, 5).join(", ")})` });
}

// Was bei einer Übernahme wirklich geschrieben wird: beim Stand nur der Kernsatz (erste Zeile), sonst der ganze Text.
const aussageVon = (v) => (v.art === "stand" ? kernsatz(v.text) : v.text);

// zusatz (optional): { begruendung } — Einschätzung des Richters (Konflikt, markierte und R3/R4/R5-Rückfragen); { kandidaten } — Seiten der Seitenwahl; { weitere } — weitere zutreffende Gründe (Text).
// Markierte Rückfrage (Rückweg aus der Autostufe „aus“, auch der Lernmodus): s.grund === autostufe-aus.
function rueckfrageFuer(ctx, v, s, ziel, ab, zusatz = {}) {
  const name = ziel.seite.split("/").pop();
  const quelle = `Zitat: „${v.zitat}“ (${v.herkunft}${v.fundstelle ? `, ${v.fundstelle}` : ""})${v.fm.quelle_url ? `\nQuelle: ${v.fm.quelle_url}` : ""}`;
  const einschaetzung = zusatz.begruendung ? `\nEinschätzung der Prüfung: ${zusatz.begruendung}` : "";
  const kandidaten = (zusatz.kandidaten || []).map((k) => String(k.seite || "").split("/").pop()).filter(Boolean);
  const markiert = s.grund === AUS_GRUND;
  const hinweise = [s.grund, ...(zusatz.weitere || [])].filter((g) => R345_GRUENDE.includes(g));
  const hinweisTexte = (zusatz.weitere || []).map((g) => GRUND_TEXT[g]).filter(Boolean);
  // Markierte Rückfrage: die Hinweise (R3/R4/R5) stehen als eigene Zeile VOR der Erklärung — sie sind das, was du zum sicheren Urteilen brauchst, und sollen auch bei gekürzter Anzeige sichtbar bleiben.
  const warum = markiert ? (ctx.lernmodus ? LERNMODUS_TEXT : GRUND_TEXT[s.grund] || s.grund) : [GRUND_TEXT[s.grund] || s.grund, ...hinweisTexte].join(" ");
  const hinweisZeile = markiert && hinweisTexte.length ? `\nHinweis: ${hinweisTexte.join(" ")}` : "";
  const t = s.typ === "widerspruch"
    ? { frage: `Was gilt auf ${name}?`, beschreibung: `A (Wiki): ${ab?.zeile || (s.grund === "konflikt" ? "eine Stelle dieser oder einer anderen Wiki-Seite (siehe Einschätzung)" : "-")}\nB (neu): ${aussageVon(v)}\n${quelle}${einschaetzung}` }
    : { frage: `${s.typ === "web" ? "Aus dem Web übernehmen" : "Übernehmen"} nach ${name}: ${v.titel}?`,
        beschreibung: `Fakt: ${aussageVon(v)}\n${quelle}\nZielseite: ${ziel.seite}${einschaetzung}${hinweisZeile}\nWarum ich frage: ${warum}${ab?.verdacht ? `\nFraglich gegen: ${ab.verdacht}` : ""}`
          + `${kandidaten.length > 1 ? `\nZur Wahl standen: ${kandidaten.join(", ")} — gewählt: ${name}` : ""}` };
  // Rückweg aus der Autostufe „aus“ (N5): die Rückfrage trägt die Markierung — ihre Antwort zählt als Prüfung für die Autostufe (antworten.mjs#rueckwegPruefung).
  legeRueckfrageAn(ctx, { typ: s.typ, ...t, vorschlaege: [v], seite: ziel.seite, zeile: ab?.zeile || "", grund: s.grund,
    ...(markiert ? { felder: { quelle: AUTOSTUFE_QUELLE } } : {}), ...(hinweise.length ? { protokoll: { hinweise } } : {}) });
}

// Schritte 3–5 für einen Fakt/Stand mit Zitat. → "offen" (KI fehlt/Budget: bleibt für den nächsten Lauf) | undefined.
// Nie 🟢 ohne: Herkunft du/tool, gefundene Fundstelle im B1-Format, Aussage vom Zitat gedeckt, Zitat stützt die Aussage
// (Abgleich-Antwort), Seite passt zum Thema (passtZurSeite) und dauerhaft (nur Fakt), nicht kritisch, nicht heikel — die Regeln selbst
// stehen in stufe.mjs. Beim Stand ist „die Aussage“ nur der Kernsatz (erste Zeile): nur er wird geprüft und geschrieben.
// Wrapper: hält fest, ob und wie eine Seitenwahl stattfand, und trägt es in die Aktionen dieses Vorschlags ein (Probelauf auswertbar). Ebenso das Urteil des
// Richters (merk.richter = sein Ergebnis): Felder und Begründung stehen bei aussortieren/warten/Rückfrage in der Aktion; bei einer Übernahme geht es mit dem Auftrag.
async function einVorschlag(ctx, v, kontext, auftraege) {
  const von = ctx.aktionen.length, wahl = {}, merk = {};
  try { return await pruefeVorschlag(ctx, v, kontext, auftraege, wahl, merk); }
  finally {
    if (wahl.kandidaten) for (const a of ctx.aktionen.slice(von)) if (a.id === v.id) Object.assign(a, wahl);
    if (merk.richter) vermerkeRichter(ctx, v, merk.richter, von);
  }
}

// Der Richter (richter.mjs) über einen 🟢-Kandidaten (Fakt und Stand; beim Stand beurteilt er den Kernsatz). Wirft nie: jeder Fehler ist ⏸ richter-unklar, nie „übernehmen“.
// Zählt für den Bericht („Richter-Ausgänge je Grund“).
async function urteile(ctx, v, ziel, info) {
  let r;
  try { r = await richte(ctx, v, ziel, info); }
  catch (e) { r = { urteil: "warten", grund: "richter-unklar", felder: null, begruendung: "", aufruf: false, protokoll: { urteil: "warten", grund: "richter-unklar", felder: null, begruendung: "", aufruf: false } }; }
  const z = (ctx.richterStat ||= { geprueft: 0, aufrufe: 0, cache: 0, gruende: {} });
  z.geprueft++;
  if (r.aufruf) z.aufrufe++;
  if (r.ausCache) z.cache++;
  z.gruende[r.grund] = (z.gruende[r.grund] || 0) + 1;
  return r;
}

async function pruefeVorschlag(ctx, v, { karten, aliasse }, auftraege, wahl, merk) {
  const aus = ctx.autostufe === "aus";
  // Themen-Ausschluss: auch das erst im Belege-Schritt gefundene (oder aus dem Cache geholte) Zitat zählt — noch vor dem ersten KI-Aufruf zu diesem Vorschlag.
  if (nenntThema(ctx.werte?.ernteOhneThema, v.titel, v.text, v.zitat)) { aussortieren(ctx, v, THEMA_GRUND); return; }
  if (findeSecrets(`${v.titel}\n${v.text}\n${v.zitat}`).length) { aussortieren(ctx, v, "secrets-verdacht"); return; }
  // Feste Regeln ohne KI (regeln.mjs, nur Fakten), vor jedem KI-Aufruf zu diesem Vorschlag: R1 Wunsch/Auftrag/Vorhaben statt Fakt (wunsch-statt-fakt),
  // R2 Anteil/Prozent/Betrag/Menge ohne Zeitraum (zahl-ohne-bezug). Aussortieren heißt archivieren; das Muster (nie Text des Vorschlags) steht im Protokoll.
  const frueh = fruehePruefung(v);
  if (frueh) { aussortieren(ctx, v, frueh.grund, { muster: frueh.muster }); return; }
  // Fakt: Titel + Text gegen das Zitat. Stand: nur der Kernsatz (erste Zeile) — nur er wird geschrieben, die weiteren Zeilen zählen nicht.
  const gedeckt = aussageGedeckt(v.art === "stand" ? kernsatz(v.text) : `${v.titel}\n${v.text}`, v.zitat).gedeckt;
  if (gedeckt === false) { aussortieren(ctx, v, "beleg-passt-nicht"); return; }       // spart den KI-Aufruf
  let ziel = einordnen(ctx.vault, v, { karten, aliasse });                             // 3
  // Mehrdeutig: Haiku wählt unter den Kandidaten (Güte ≥ 0,8 × Platz 1, keine kritische Seite unter den Top 5) — eigener, kleiner Aufruf (abgleich.mjs#waehleSeite). Ohne gültige Wahl
  // (null, fremder Pfad, weniger als zwei Kandidaten) bleibt es bei ⏸ mehrdeutig; danach läuft der Abgleich ganz normal gegen die gewählte Seite.
  // Genau EIN übrig gebliebener Kandidat ist nicht eindeutig → warten, kein Aufruf. Ist unter den Top 5 irgendeine kritische Seite, liefert einordnen
  // gar keine Kandidaten (detail kritisch-unter-kandidaten): Haiku wählt dann nie unter den schwächeren Seiten (Review-Befund #4).
  if (!ziel.seite && ziel.grund === "mehrdeutig") {
    const kand = ziel.kandidaten || [];
    wahl.kandidaten = kand.map((c) => ({ seite: c.seite, guete: Math.round(c.guete * 1000) / 1000 }));
    if (ziel.detail) wahl.detail = ziel.detail;                                        // z. B. kritisch-unter-kandidaten: im Protokoll erkennbar, warum nicht gewählt wurde
    if (kand.length >= 2) {
      const w = await waehleSeite(ctx, v, kand);
      if (!w.ohneAufruf) { wahl.wie = "wahl"; wahl.gewaehlt = w.seite ?? null; }
      if (w.vollstaendig === undefined) {
        if (w.budget || w.ohneKi) return "offen";
        notiere(ctx, { id: v.id, stufe: "fehler", grund: `wahl: ${kurz(w.fehler, 80)}`, titel: v.titel });
        return "offen";                                                                // nächster Lauf
      }
      if (!w.vollstaendig) { warten(ctx, v, "ki-antwort-unvollstaendig"); return; }
      if (w.seite) {
        const k = karten.find((x) => x.seite === w.seite);
        ziel = { seite: w.seite, kritisch: k ? k.kritisch : true, wie: "wahl", guete: kand.find((c) => c.seite === w.seite)?.guete };   // unbekannt → kritisch (Rückfrage statt Übernahme)
      }
    }
  }
  let ab = null, text = null;
  if (ziel.seite) {                                                                    // 4 (Fakt: Urteil + zitatStuetzt, Stand: nur zitatStuetzt)
    try { text = readFileSync(join(ctx.vault, ziel.seite), "utf8"); } catch { warten(ctx, v, "seite-unlesbar"); return; }
    ab = await abgleich(ctx, v, text, ziel.seite);
    if (ab.urteil === undefined) {
      if (ab.budget || ab.ohneKi) return "offen";
      notiere(ctx, { id: v.id, stufe: "fehler", ziel: ziel.seite, grund: `abgleich: ${kurz(ab.fehler, 80)}`, titel: v.titel });
      return "offen";                                                                  // nächster Lauf
    }
  }
  const s = stufe({ art: v.art, herkunft: v.herkunft, zitatGeprueft: !!(v.zitat && FUNDSTELLE_MUSTER.test(v.fundstelle)),
    zitatStuetzt: ab ? ab.zitatStuetzt : undefined, passtZurSeite: ab?.passtZurSeite, dauerhaft: ab?.dauerhaft,
    ziel: ziel.seite ? ziel : null, abgleich: ab,
    heikel: istHeikel(`${v.titel}\n${aussageVon(v)}\n${v.zitat}`).heikel, gedeckt,
    // Autostufe „aus“ (auch der Lernmodus): die Regeln werden so gerechnet, als wäre es „normal“ — ein Kandidat, der sonst 🟢 wäre, geht ZUERST zum Richter; erst sein „übernehmen“
    // wird (unten) zur markierten Rückfrage. So prüft der Mensch genau das Urteil, das später automatisch wirken würde, und bekommt keine Fragen zu Kandidaten, die der Richter verwirft.
    autostufe: aus ? "normal" : ctx.autostufe });   // 5
  if (s.stufe === "aussortieren") aussortieren(ctx, v, s.grund);
  else if (s.stufe === "warten") warten(ctx, v, s.grund === "keine-seite" ? ziel.grund || s.grund : s.grund);
  else if (s.stufe === "rueckfrage") rueckfrageFuer(ctx, v, s, ziel, ab);
  else {
    // Ohne schreibbares Protokoll gibt es keine automatische Übernahme (Befund N3) — der Vorschlag bleibt unverändert liegen und kommt im nächsten Lauf wieder.
    // (Bei Autostufe „aus“ wird nichts automatisch geschrieben, nur gefragt — dort gilt das nicht.)
    if (ctx.protokollKaputt && !aus) return "offen";
    // 🟢 heißt nur „die Regeln lassen es zu“. Den Ausschlag gibt der RICHTER (Sonnet, mit Kontext: Verlauf nach dem Zitat, ganze Zielseite, neuere Seiten): nur sein
    // „übernehmen“ erlaubt eine Übernahme. Aussortieren, Konflikt-Rückfrage und Warten (auch bei Fehler, kaputter Antwort, leerem Budget) laufen über die bekannten Wege —
    // auch bei Autostufe „aus“: dort entsteht aus einer Richter-Ablehnung nie eine markierte Rückfrage.
    const r = await urteile(ctx, v, ziel, { seitenText: text, karten });
    merk.richter = r;                                                                  // der Wrapper trägt es in die Aktionen ein
    if (r.urteil === "aussortieren") { aussortieren(ctx, v, r.grund); return; }
    if (r.urteil === "rueckfrage") { rueckfrageFuer(ctx, v, { typ: r.typ || "widerspruch", grund: r.grund }, ziel, ab, { begruendung: r.begruendung }); return; }
    if (r.urteil !== "uebernehmen") { warten(ctx, v, r.urteil === "warten" ? r.grund : "richter-unklar"); return; }   // unbekanntes Urteil: nie übernehmen
    // R3/R4/R5: auch ein „übernehmen“ des Richters schreibt nicht von allein, wenn die Seite seit dem Zitat geändert wurde (R3), aus der Seitenwahl stammt (R4) oder das Zitat
    // älter als 7 Tage ist bzw. keinen gültigen Zeitpunkt hat (R5, Altbestand: die Wahrheit liegt oft in späteren Sitzungen, die weder Richter noch Wiki kennen) — dann fragt der Mensch.
    // (Fail-safe: ist die Zeit des Zitats oder der Verlauf der Seite unbekannt, gilt die Seite als geändert und das Zitat als alt.)
    const zitatZeit = zitatZeitAusFundstelle(v.fundstelle);
    const gewaehlt = istSeitenwahl(ziel);
    const hinweise = [];
    if (seiteNeuerAlsZitat(ctx.vault, ziel.seite, zitatZeit)) hinweise.push("seite-seither-geaendert");
    if (gewaehlt) hinweise.push("seitenwahl");
    if (istAltbestand(zitatZeit, ctx.jetzt)) hinweise.push(ALTBESTAND_GRUND);
    const zusatz = { begruendung: r.begruendung, kandidaten: gewaehlt ? wahl.kandidaten : [] };
    // Autostufe „aus“ (Lernmodus): nur des Richters „übernehmen“ wird zur MARKIERTEN Rückfrage; die Hinweise stehen im Text, damit du sicher urteilen kannst.
    if (aus) { rueckfrageFuer(ctx, v, { typ: "heikel", grund: AUS_GRUND }, ziel, ab, { ...zusatz, weitere: hinweise }); return; }
    if (hinweise.length) { rueckfrageFuer(ctx, v, { typ: "heikel", grund: hinweise[0] }, ziel, ab, { ...zusatz, weitere: hinweise.slice(1) }); return; }
    // Einschwingphase als Tor (einschwingen.mjs): VOR dem Schreiben nur so viele automatische Übernahmen, wie Plätze frei sind; der Rest wartet.
    const tor = einschwingTor(ctx);
    if (tor === "warten") { warten(ctx, v, "einschwingen"); return; }
    auftraege.push({ art: s.stufe === "stand" ? "stand" : "fakt", seite: ziel.seite, v, titel: v.titel, auto: true, guete: ziel.guete, richter: r.protokoll, ...(wahl.wie ? { wahl } : {}),
      ...(tor === "platz" ? { einschwingen: true } : {}) });
  }
}

// Schritte 1–5. Schreibaufträge landen in `auftraege`; zurück kommen die Lektions-Vorschläge für Schritt 9.
async function vorschlagsSchritte(ctx, auftraege, zahl) {
  const { rest } = aufraeumen(ctx, ladeVorschlaege(ctx.vault));                       // 1
  const fakten = rest.filter((v) => v.art === "fakt" || v.art === "stand");
  const b = await belegeNachholen(ctx, fakten);                                       // 2
  const offen = new Set(b.offen.map((v) => v.id));
  zahl.offen += offen.size;
  const kandidaten = fakten.filter((v) => !b.weg.has(v.id) && !offen.has(v.id) && v.zitat);
  const kontext = { karten: seitenKarten(ctx.vault), aliasse: ladeAliasse(ctx.vault) };
  for (const v of kandidaten) {
    try { if (await einVorschlag(ctx, v, kontext, auftraege) === "offen") zahl.offen++; }
    catch (e) { notiere(ctx, { id: v.id, stufe: "fehler", titel: v.titel, grund: `vorschlag: ${kurz(e?.message, 120)}` }); }   // nächster Lauf
  }
  return rest.filter((v) => v.art === "lektion");
}

const aktionFuer = (a, commit, beleg, verschoben) => ({ id: a.v?.id || a.ref, stufe: a.art === "feld" ? "feld" : a.art === "stand" ? "stand" : "uebernehmen",
  ziel: a.seite, commit, auto: a.auto === true, titel: a.titel, zitat: a.v?.zitat, herkunft: a.v?.herkunft, fundstelle: a.v?.fundstelle,
  beleg, verschoben, feld: a.feld, rueckfrage: a.rueckfrage?.id, guete: a.guete, ...(a.einschwingen ? { einschwingen: true } : {}), ...(a.richter ? { richter: a.richter } : {}), ...a.wahl });   // a.wahl: { wie: "wahl", kandidaten, gewaehlt }; a.richter: Protokoll des Richters

// Schritte 6 und 7: alle Aufträge in EINER Arbeitskopie, ein Commit je Auftrag, dann ff-Merge.
// Vor dem Merge kann nichts im Vault halb passieren (alles liegt in der Arbeitskopie); nach dem Merge wird JEDE Übernahme
// protokolliert, auch wenn das Verschieben des Vorschlags oder das Archivieren der Rückfrage danach scheitert.
async function schreibenUndUebernehmen(ctx, auftraege, zahl) {
  if (!auftraege.length) return;
  if (!ctx.probe) {
    // Vorab-Probe (N3): unmittelbar vor dem Schreib-/Merge-Schritt noch einmal. Ist das Protokoll nicht gesund, wird nichts übernommen, was nicht erfasst werden
    // kann — auch nichts, was du selbst freigegeben hast (die Antwort bleibt offen, die Rückfrage wird erst nach dem Merge archiviert). Schutz-Felder (zweifel) laufen weiter.
    ctx.haken?.vorSchreiben?.(ctx);
    if (!ctx.protokollKaputt) { const p = protokollGesund(ctx.vault); if (!p.ok) protokollKaputt(ctx, zahl, p.fehler); }
    if (ctx.protokollKaputt) {
      auftraege = auftraege.filter((a) => a.art === "feld");
      if (!auftraege.length) return;
    }
  }
  if (!ctx.probe && !nimmIngestSperre(ctx.vault)) {
    ctx.grund ||= "Gerade läuft ein /ingest — Übernahmen beim nächsten Lauf";
    zahl.teilweise = true;
    return;
  }
  let kopie = null;
  try {
    try { kopie = legeArbeitskopieAn(ctx.vault, ctx.lauf); }
    catch (e) {
      ctx.grund ||= "Die Arbeitskopie ließ sich nicht anlegen — Übernahmen beim nächsten Lauf";
      zahl.teilweise = true;
      notiere(ctx, { id: "lauf", stufe: "fehler", grund: `arbeitskopie: ${kurz(String(e?.stderr || e?.message).split("\n")[0], 120)}` });
      return;
    }
    const gut = [];
    for (const a of auftraege) {
      const r = commitAuftrag(ctx.vault, kopie, a, { lauf: ctx.lauf, jetzt: ctx.jetzt });
      if (r.ok) { gut.push({ a, r }); continue; }
      if (r.grund === "unveraendert") { if (a.rueckfrage) archiviereRueckfrage(ctx, a.rueckfrage); continue; }
      notiere(ctx, { id: a.v?.id || a.ref, stufe: "fehler", ziel: a.seite, titel: a.titel, grund: kurz(`${r.grund}${r.befund ? `: ${r.befund}` : ""}`, 200) });
      if (DAUERHAFT.has(r.grund)) {
        if (a.v) warten(ctx, a.v, r.grund, r.befund);
        if (a.rueckfrage) archiviereRueckfrage(ctx, a.rueckfrage);
      }
    }
    if (!gut.length) return;
    if (ctx.probe) { for (const { a, r } of gut) notiere(ctx, aktionFuer(a, null, r.beleg, null)); return; }
    const m = uebernehmen(ctx.vault, kopie, { probe: ctx.probe });
    if (!m.ok) { ctx.grund ||= MERGE_TEXT[m.grund] || m.grund; zahl.teilweise = true; notiere(ctx, { id: "lauf", stufe: "fehler", grund: m.grund }); return; }
    ctx.haken?.nachMerge?.(ctx);                                                       // nur für Tests (Schreibfehler nach dem Merge herbeiführen)
    let hashes = new Map();
    try { hashes = commitsDesLaufs(ctx.vault, ctx.lauf, m.commits); } catch { /* Hashes fehlen im Protokoll, die Commits liegen in main */ }
    // Befund #7: Die Aktionen der Übernahmen (mit Commit-Hash) SOFORT festhalten — append + fsync, noch vor Verschieben und Aufräumen. Stirbt der Lauf
    // danach (SIGTERM, Strom weg), steht die Aktion trotzdem in aktionen.jsonl: `brain zurueck <lauf>` findet sie, Einschwingen/Autostufe/Stichproben
    // sehen sie. Das finally am Laufende schreibt nur noch, was bis dahin dazukam (schreibeAktionen führt Buch). Scheitert das frühe Schreiben,
    // holt das finally es nach. `verschoben` ist erst nach dem Verschieben bekannt und kommt als Nachtrag dazu.
    const eintraege = gut.map(({ a, r }) => ({ a, eintrag: notiere(ctx, aktionFuer(a, hashes.get(a.v?.id || a.ref) || null, r.beleg, null)) }));
    try { schreibeAktionen(ctx, { sicher: true }); }
    catch (e) { protokollKaputt(ctx, zahl, e?.code || e?.message); }                   // laut (N3); das finally versucht es am Laufende noch einmal
    for (const { a, eintrag } of eintraege) {
      const id = a.v?.id || a.ref;
      if (a.v) {
        try { haengeNachtragAn(ctx, eintrag, { verschoben: verschiebeVorschlag(ctx, a.v, `${ordner(ctx.vault).archiv}/vorschlaege-uebernommen`) }); }
        catch (e) { notiere(ctx, { id, stufe: "fehler", ziel: a.seite, grund: `verschieben: ${kurz(e?.message, 120)}` }); }   // bleibt liegen, kommt als schon_drin wieder
      }
      if (a.rueckfrage) {
        try { archiviereRueckfrage(ctx, a.rueckfrage); }
        catch (e) { notiere(ctx, { id, stufe: "fehler", ziel: a.seite, grund: `rueckfrage-archivieren: ${kurz(e?.message, 120)}` }); }
      }
    }
  } finally {
    if (kopie) verwerfeArbeitskopie(ctx.vault, kopie);
    if (!ctx.probe) gibIngestSperreFrei(ctx.vault);
  }
}

// Stichprobe „stimmt nicht" → wie brain zurueck <id>; zählt schon als Stichproben-Fehler, darum alsFehler: false. Gescheiterte Rücknahmen bleiben offen und
// werden in jedem Lauf erneut versucht (ruecknahmen.mjs, Befund N6) — auch die aus früheren Läufen; die neuen stehen schon seit dem Beantworten in der Liste.
function zuruecknehmen(ctx, zahl, neue) {
  ctx.ruecknahmen = ruecknahmenSchritt(ctx, zahl, neue);
}

// Stichproben und „bewährt" lesen nur das, was frühere Läufe protokolliert haben: die Übernahmen des laufenden Laufs stehen seit Befund #7
// schon in der Datei, zählen hier aber noch nicht — eine Übernahme wird frühestens beim nächsten Lauf abgefragt.
function schritt8(ctx) {
  verfallen(ctx);
  konfliktRueckfragen(ctx);
  const aktionen = leseAktionen(ctx.vault).filter((a) => a.lauf !== ctx.lauf);
  const pruefungen = lesePruefungen(ctx.vault);
  stichprobenAuffuellen(ctx, { aktionen, pruefungen, jeWoche: stichprobenJeWoche(ctx.autostufe) });
  bewaehrtePruefungen(ctx, { aktionen, pruefungen, nutzung: hinweisNutzung(ctx.vault, { seitMs: ctx.jetzt - 90 * TAG }) });
  aktualisiereAutostufe(ctx);
}

function zaehle(ctx) {
  const n = (f) => ctx.aktionen.filter(f).length;
  return {
    uebernommen: n((a) => (a.stufe === "uebernehmen" || a.stufe === "stand") && (ctx.probe || a.commit)),
    aussortiert: n((a) => a.stufe === "aussortieren"),
    rueckfragenNeu: n((a) => a.stufe === "rueckfrage"),
    wartenNeu: n((a) => a.stufe === "warten"),
    seitePasstNicht: n((a) => a.stufe === "warten" && a.grund === "seite-passt-nicht"),      // falsche Seite → wartet (später „neue Seiten“)
    kurzlebig: n((a) => a.stufe === "aussortieren" && a.grund === "kurzlebig"),               // einmaliges Ereignis → aussortiert
    fehler: n((a) => a.stufe === "fehler"),
    seitenGewaehlt: n((a) => a.wie === "wahl" && a.stufe !== "fehler" && !!a.gewaehlt),     // „mehrdeutig“: Haiku hat unter den Kandidaten gewählt
    seitenOhneWahl: n((a) => a.wie === "wahl" && a.stufe !== "fehler" && !a.gewaehlt),      // … und null/ungültig/kaputt geantwortet
  };
}
function bestand(vault, u) {
  try { return readdirSync(join(vault, ordner(vault).inbox, u)).filter((n) => n.endsWith(".md")).length; } catch { return 0; }
}

// Lernmodus (Autostufe „aus“ aus dem Start): Zählstand des Rückwegs, wie viele markierte Rückfragen warten, wie viele dieser Lauf neu gestellt hat. In der Probe als Ausblick (kein Zustand, kein Zähler).
function lernmodusZeile(ctx) {
  const neu = ctx.aktionen.filter((a) => a.stufe === "rueckfrage" && a.grund === AUS_GRUND).length;
  if (ctx.probe) return `- Lernmodus: Der erste scharfe Lauf beginnt bei Autostufe aus (Einstellung autostufeStart) und schreibt nichts selbst — ${neu} markierte Rückfragen würde er jetzt stellen; `
    + `die Automatik beginnt ab ${ZURUECK_NACH} bestätigten Urteilen in Folge.`;
  let x = 0, offen = 0;
  try { x = rueckwegStand(ctx.vault)?.folge ?? 0; } catch {}
  try { offen = listeRueckfragen(ctx.vault).filter((r) => !r.antwort && istAutostufeRueckfrage(r)).length; } catch {}
  return `- Lernmodus: Die Automatik schreibt noch nichts selbst — ab ${ZURUECK_NACH} bestätigten Urteilen in Folge (jetzt ${x}/${ZURUECK_NACH}) übernimmt sie eine Stufe mehr; ${offen} markierte Rückfragen warten (${neu} neu in diesem Lauf) — `
    + "„Übernehmen“ = die Prüfung hatte recht, „Verwerfen“ = sie lag falsch (die Zählung beginnt dann von vorn).";
}

// Bericht bei Autostufe „aus“ (N5): Ursache, wie viele fehlerfreie Prüfungen noch fehlen und wie viele markierte Rückfragen darauf warten.
function autostufeAusZeile(ctx) {
  let noch = null, offen = 0;
  try { noch = rueckwegStand(ctx.vault)?.noch ?? null; } catch {}
  try { offen = listeRueckfragen(ctx.vault).filter((r) => !r.antwort && istAutostufeRueckfrage(r)).length; } catch {}
  return `- Autostufe aus: Fehlerquote ${ctx.quote.fehler}/${ctx.quote.geprueft}${noch === null ? "" : ` — noch ${noch} fehlerfreie Prüfungen bis zur nächsten Stufe`}; ${offen} markierte Rückfragen warten — `
    + "Rückfragen beantworten bringt die Automatik zurück (übernehmen = Regeln hatten recht, verwerfen = falsch).";
}

// Berichtszeilen zum Urteil (B2.1): Richter-Ausgänge je Grund · von den festen Regeln R1/R2 früh aussortiert · von R3/R4 nach dem Richter zur Rückfrage gemacht.
// Je Zeile nur, wenn es etwas zu berichten gibt (ein Lauf ohne 🟢-Kandidaten hat keine Richter-Zeile).
function urteilsZeilen(ctx) {
  const zeilen = [];
  const rs = ctx.richterStat;
  if (rs?.geprueft) zeilen.push(`- Richter: ${rs.geprueft} geprüft (${rs.aufrufe} KI-Aufrufe, ${rs.cache} aus dem Cache) · ${Object.entries(rs.gruende).map(([g, n]) => `${g}: ${n}`).join(" · ")}`);
  const je = (f, gruende) => gruende.map((g) => [g, ctx.aktionen.filter((a) => f(a) && a.grund === g).length]);
  const r12 = je((a) => a.stufe === "aussortieren", [WUNSCH_GRUND, ZAHL_GRUND]);
  if (r12.some(([, n]) => n)) zeilen.push(`- R1/R2 aussortiert: ${r12.reduce((s, [, n]) => s + n, 0)} (${r12.map(([g, n]) => `${g} ${n}`).join(" · ")}) — vor jedem KI-Aufruf, im Archiv`);
  // R3/R4: gezählt nach dem Grund der Rückfrage; die markierten Rückfragen des Lernmodus (Grund autostufe-aus) tragen ihre Hinweise in `hinweise`.
  const hat = (a, g) => a.stufe === "rueckfrage" && (a.grund === g || (a.grund === AUS_GRUND && Array.isArray(a.hinweise) && a.hinweise.includes(g)));
  const r34 = R34_GRUENDE.map((g) => [g, ctx.aktionen.filter((a) => hat(a, g)).length]);
  if (r34.some(([, n]) => n)) zeilen.push(`- R3/R4 → Rückfrage: ${r34.reduce((s, [, n]) => s + n, 0)} (${r34.map(([g, n]) => `${g} ${n}`).join(" · ")}) — der Richter hätte übernommen, die Seite ist seither geändert oder stammt aus der Seitenwahl`);
  // R5: auch wo R3 den Grund gibt, steht der Altbestand in `hinweise` (jede R3/R4/R5-Rückfrage trägt ihre Hinweise).
  const r5 = ctx.aktionen.filter((a) => a.stufe === "rueckfrage" && (a.grund === ALTBESTAND_GRUND || (Array.isArray(a.hinweise) && a.hinweise.includes(ALTBESTAND_GRUND)))).length;
  if (r5) zeilen.push(`- R5 Altbestand → Rückfrage: ${r5} (Zitat älter als ${ALTBESTAND_TAGE} Tage oder ohne Zeitpunkt) — der Richter hätte übernommen, doch beim Altbestand liegt die Wahrheit oft in späteren Sitzungen`);
  return zeilen;
}

function schreibeBericht(ctx, { status, z, nurAntworten, nurPflege }) {
  const name = `${ctx.heute}${ctx.probe ? "-probe" : ""}.md`;
  const a = ctx.aktionen, e = ctx.einschwingen;
  const liste = (f, fmt) => a.filter(f).slice(0, 60).map(fmt);
  const gruende = {}, wartGruende = {};
  for (const x of a.filter((x) => x.stufe === "aussortieren")) gruende[x.grund] = (gruende[x.grund] || 0) + 1;
  for (const x of a.filter((x) => x.stufe === "warten")) { const g = String(x.grund || "").split(":")[0]; wartGruende[g] = (wartGruende[g] || 0) + 1; }
  const zeilen = [
    `## Lauf ${ctx.lauf} — ${ctx.probe ? "Probe (nichts geändert)" : "scharf"}${nurAntworten ? ", nur Antworten" : ""}${nurPflege ? ", nur Pflege (Nachlauf)" : ""} — ${STATUS_TEXT[status] || status}`, "",
    `- ${ctx.probe ? "würde übernehmen" : "übernommen"}: ${z.uebernommen} · aussortiert: ${z.aussortiert} · neue Rückfragen: ${z.rueckfragenNeu} · wartet: ${z.wartenNeu} · Fehler: ${z.fehler}`,
    `- seite-passt-nicht: ${z.seitePasstNicht} (wartet auf eine passende Seite) · kurzlebig: ${z.kurzlebig} (aussortiert)`,
    ...(z.seitenGewaehlt || z.seitenOhneWahl ? [`- Seitenwahl (mehrdeutig): ${z.seitenGewaehlt} gewählt · ${z.seitenOhneWahl} ohne Wahl`] : []),
    ...urteilsZeilen(ctx),
    `- Rückfragen offen: ${z.rueckfragen}${z.wartend ? ` (${z.wartend} davon warten über dem Deckel)` : ""} · Autostufe ${ctx.autostufe} · Fehlerquote ${ctx.quote.fehler}/${ctx.quote.geprueft} · KI-Aufrufe ${ctx.aufrufe} · Tokens ${ctx.tokens.ein}/${ctx.tokens.aus}`,
    ...(!ctx.probe && e && e.ziel > 0 && (e.aktiv || e.neu > 0 || e.beendet)
      ? [`- Einschwingen ${e.R}/${e.ziel} geprüft${e.O ? ` · ${e.O} offen` : ""}${e.F ? ` · ${e.F} falsch` : ""}${e.R >= e.ziel ? " — Phase beendet" : ""}`
        + ` · neue Einzelprüfungen (Stichproben) in diesem Lauf: ${e.neu}${e.wartend ? ` · ${e.wartend} warten auf freie Plätze (Grund einschwingen)` : ""}`] : []),
    ...(ctx.probe && e && e.aktiv && e.probeM > 0
      ? [`- Einschwingen: ${e.probeK} von ${e.probeM} würden jetzt übernommen (so viele ließe das Tor der Einschwingphase im echten Lauf durch; die Probe wendet es nicht an)`] : []),
    ...(ctx.lernmodus ? [lernmodusZeile(ctx)] : !ctx.probe && ctx.autostufe === "aus" ? [autostufeAusZeile(ctx)] : []),
    ...(!ctx.probe && ctx.ruecknahmen?.offen?.length
      ? [`- Rücknahme offen: ${ctx.ruecknahmen.offen.length} (${ctx.ruecknahmen.offen.map((o) => `${o.aktion}: ${o.grund || "fehler"}${o.seite ? ` (Seite jetzt: ${o.seite})` : ""}`).join(", ").slice(0, 400)}) — wird in jedem Lauf erneut versucht, bis sie gelingt `
        + "oder die Zeile nicht mehr auf der Seite steht; von Hand: brain zurueck <id>"] : []),
    ...(ctx.heilung && (ctx.heilung.rekonstruiert || ctx.heilung.nachgetragen)
      ? [`- Protokoll geheilt: ${ctx.heilung.rekonstruiert} Übernahme${ctx.heilung.rekonstruiert === 1 ? "" : "n"} aus dem Git-Verlauf nachgetragen${ctx.heilung.nachgetragen ? ` (+ ${ctx.heilung.nachgetragen} fehlende Commit-Hashes)` : ""}`
        + ` (${ctx.heilung.ids.slice(0, 12).join(", ")}${ctx.heilung.ids.length > 12 ? " …" : ""}) — sie standen auf main, aber nicht in aktionen.jsonl (Schreibfehler nach dem Merge). Sie zählen als Einschwing-Übernahmen `
        + "(das Tor bleibt im Zweifel zu), bekommen ihre Stichprobe und lassen sich mit `brain zurueck <lauf|id>` zurücknehmen."] : []),
    ...(ctx.protokollKaputt ? [`- Protokoll nicht schreibbar (${PROTOKOLL_GRUND}): aktionen.jsonl oder pruefungen.jsonl unter .logs/tageslauf/ lässt sich nicht lesen oder anhängen — `
      + "der Lauf übernimmt nichts automatisch, das Einschwing-Tor bleibt zu, bis es wieder geht. Ursache beheben (Rechte, freier Platz, Ordner statt Datei) und den Lauf wiederholen."] : []),
    ...(ctx.gedaechtnis ? [`- ${ctx.gedaechtnis}`] : []),
    ...(ctx.grund ? [`- Hinweis: ${ctx.grund}`] : []),
    ...(z.offen ? [`- ${z.offen} Vorschläge bleiben für den nächsten Lauf.`] : []),
    "", "### Übernommen",
    ...liste((x) => ["uebernehmen", "stand", "feld"].includes(x.stufe), (x) => `- ${x.titel || x.id} → ${x.ziel}${x.commit ? ` (${String(x.commit).slice(0, 8)})` : ""}${x.auto ? "" : " · nach deiner Antwort"}`),
    "", "### Neue Rückfragen", ...liste((x) => x.stufe === "rueckfrage", (x) => `- ${x.typ}: ${x.titel || x.id}${x.ziel ? ` (${x.ziel})` : ""}`),
    "", "### Aussortiert (Gründe)", ...Object.entries(gruende).map(([g, n]) => `- ${g}: ${n}`),
    "", "### Wartet (Gründe)", ...Object.entries(wartGruende).map(([g, n]) => `- ${g}: ${n}`),
    ...pflegeBerichtZeilen(ctx),
    ...traumBerichtZeilen(ctx),
    ...gesundheitBerichtZeilen(ctx),
    "", "### Fehler", ...liste((x) => x.stufe === "fehler", (x) => `- ${x.id}: ${x.grund}`),
    ...(ctx.probe ? [] : ["", `Rückgängig: \`brain zurueck ${ctx.lauf}\` (ganzer Lauf) oder \`brain zurueck <id>\` (eine Übernahme).`]), "",
  ];
  mkdirSync(TL_DIR(ctx.vault), { recursive: true });
  const datei = join(TL_DIR(ctx.vault), name);
  appendFileSync(datei, ohneSecrets(`${existsSync(datei) ? "" : `# Tageslauf ${ctx.heute}\n\n`}${zeilen.join("\n")}\n`));
  return `.logs/tageslauf/${name}`;
}

function merkeUebersprungen(vault, grund, jetzt) {
  try { schreibeLetzter(vault, { ...(leseLetzter(vault) || {}), uebersprungen: { zeit: iso(jetzt), grund } }); } catch {}
}

function abschluss(ctx, { status, nurAntworten, nurPflege = false, probeFlag, werte, zahl }) {
  const vault = ctx.vault;
  let s = { fragen: [], wartend: 0 };
  try { s = sichtbare(vault, { jetzt: ctx.jetzt }); } catch {}
  const z = { ...zaehle(ctx), rueckfragen: s.fragen.length + s.wartend, wartend: s.wartend,
    warten: bestand(vault, UNTERORDNER.warten), rest: bestand(vault, UNTERORDNER.vorschlaege), offen: zahl.offen };
  const alt = leseLetzter(vault) || {};
  const erfolgreich = status === "ok" || status === "abgebrochen";
  const letzter = (nurAntworten || nurPflege) && alt.lauf
    ? { ...alt, zahlen: { ...(alt.zahlen || {}), rueckfragen: z.rueckfragen, wartend: z.wartend },
        antworten: { lauf: ctx.lauf, zeit: iso(ctx.jetzt), status, uebernommen: z.uebernommen } }
    : { lauf: ctx.lauf, zeit: iso(ctx.jetzt), modus: ctx.probe ? "probe" : "an", art: nurAntworten ? "antworten" : nurPflege ? "pflege" : "voll", status,
        erfolgreich: !nurAntworten && !nurPflege && erfolgreich, letzterErfolg: !nurAntworten && !nurPflege && erfolgreich ? iso(ctx.jetzt) : alt.letzterErfolg || null,
        seit: !nurAntworten && !nurPflege && erfolgreich ? null : alt.seit || iso(ctx.jetzt), grund: ctx.grund || null, zahlen: z,
        fehlerquote: ctx.quote, autostufe: ctx.autostufe, ...(ctx.lernmodus ? { lernmodus: true } : {}), aufrufe: ctx.aufrufe, tokEin: ctx.tokens.ein, tokAus: ctx.tokens.aus,
        ...(ctx.pflegeAufrufe ? { pflege: { ...ctx.pflegeAufrufe, tokEin: ctx.pflegeTokens?.ein || 0, tokCache: ctx.pflegeTokens?.cache || 0, tokAus: ctx.pflegeTokens?.aus || 0 } } : {}) };
  if (ctx.gesundheit) letzter.gesundheit = gesundheitKurz(ctx.gesundheit);              // Gesundheits-Wächter: Kurzfassung (Stand für die Startzeile: gesundheit.json)
  if (ctx.protokollKaputt) letzter.protokoll = "nicht-schreibbar";                    // Morgenzeile sagt es (N3)
  else if (nurAntworten && !ctx.probe) delete letzter.protokoll;                       // ein gesunder Antworten-Lauf nimmt den Hinweis zurück
  // Probe von Hand neben dem scharfen Schalter: letzter.json gehört dem echten Lauf.
  if (!(probeFlag && werte.tageslauf === "an")) { try { schreibeLetzter(vault, letzter); } catch {} }
  let bericht = null;
  try { bericht = schreibeBericht(ctx, { status, z, nurAntworten, nurPflege }); } catch {}
  return { status, grund: ctx.grund || null, modus: ctx.probe ? "probe" : "an", lauf: ctx.lauf, zahlen: z, bericht };
}

export async function tageslauf(vault, opt = {}) {
  const { probe: probeFlag = false, wennFaellig = false, dienst = false, nurAntworten = false, budget = {},
    jetzt = Date.now(), claudeBefehl, home, pmset, ioreg, haken = {} } = opt;
  const { werte, fehler } = leseAutomatik(vault);
  if (fehler) return { status: "uebersprungen", grund: "Einstellungen unlesbar" };
  if (werte.tageslauf === "aus" && !probeFlag) return { status: "uebersprungen", grund: "Tageslauf ist aus" };
  let nurPflege = false;
  if (wennFaellig && !nurAntworten && !faellig(vault, { jetzt })) {
    // B2 ist heute dran gewesen — nur wenn B3 wegen /ingest übersprungen wurde, darf der Takt B3 allein nachholen (ohne B2 erneut).
    if (!pflegeNachlaufOffen(vault, werte, heute(new Date(jetzt)))) return { status: "uebersprungen", grund: "nicht fällig" };
    nurPflege = true;
  }
  if (dienst) {
    const b = bedingungen({ ...(pmset ? { pmset } : {}), ...(ioreg ? { ioreg } : {}) });
    if (!b.ok) { merkeUebersprungen(vault, b.grund, jetzt); return { status: "uebersprungen", grund: b.grund }; }
  }
  if (!nimmSperre(vault, { jetzt })) return { status: "uebersprungen", grund: "läuft schon" };
  try {
    const probe = probeFlag || werte.tageslauf !== "an";
    if (!(probeFlag && werte.tageslauf === "an")) markeStart(vault, jetzt);   // eine Probe von Hand ist kein Start für den Rückfall
    const ctx = neuerLauf(vault, { probe, jetzt, claudeBefehl, home,
      budget: { ...(TAGESLAUF_BUDGETS[werte.tageslaufBudget] || TAGESLAUF_BUDGETS.normal), ...budget } });
    ctx.haken = haken;                                                                  // Testhaken { vorSchreiben(ctx), nachMerge(ctx) } — im Betrieb leer
    const zahl = { teilweise: false, offen: 0 };
    let status = "fehler";
    try {
      if (nurPflege) {                                            // B3-Nachlauf: nur Autostufe (Lernmodus-Stand) + Pflege, keine B2-Schritte
        if (!(ctx.claudeBefehl === undefined ? findeClaude() : ctx.claudeBefehl)) { ctx.ohneKi = true; ctx.grund = "claude nicht gefunden"; }
        await schritt(ctx, zahl, "Autostufe", () => aktualisiereAutostufe(ctx));
        try { await b3Schritte(ctx); }
        catch (e) { notiere(ctx, { id: "b3", stufe: "fehler", grund: `Pflege: ${kurz(e?.message, 140)}` }); }
        status = zahl.teilweise ? "teilweise" : "ok";
      } else {
      if (!nurAntworten && !(ctx.claudeBefehl === undefined ? findeClaude() : ctx.claudeBefehl)) { ctx.ohneKi = true; ctx.grund = "claude nicht gefunden"; }   // KI-Schritte entfallen, der Lauf gilt nicht als erfolgreich
      if (!probe) await schritt(ctx, zahl, "Reste aufräumen", () => raeumeResteAuf(vault, {}));   // Reste abgestürzter Läufe (verändert Git → nie in der Probe)
      await schritt(ctx, zahl, "Autostufe", () => aktualisiereAutostufe(ctx));
      if (!probe) await schritt(ctx, zahl, "Protokoll", () => { const p = protokollGesund(vault); if (!p.ok) protokollKaputt(ctx, zahl, p.fehler); });   // Tor fail-closed (N3)
      if (!probe && !ctx.protokollKaputt) await schritt(ctx, zahl, "Protokoll heilen", () => heileLauf(ctx, zahl));                // Übernahmen ohne Aktion nachtragen (vor dem Tor)
      ctx.einschwingenVorher = einschwingStand(vault, ctx.werte);                                                                   // Stand vor den Antworten (Phase heute zu Ende?)
      const antworten = await schritt(ctx, zahl, "Antworten", () => wendeAntwortenAn(ctx), { auftraege: [], zuruecknehmen: [] });   // 0
      gedaechtnisSchritt(ctx);                                    // gemeinsames Gedächtnis der Claude-Konten: 3-Wege-Abgleich aller Projekte (nur Schalter gedaechtnisTeilen=an; wirft nie, Probe = Trockenlauf) → eine Berichtszeile.
                                                                  // BEWUSST NACH „Antworten“: eine Traum-Freigabe wird auf dem Stand angewendet, auf dem der Traum gerechnet hat — der Abgleich verteilt danach, was die Konten inzwischen geschrieben haben
      await schritt(ctx, zahl, "Einschwingen-Stand", () => einschwingenStart(ctx));                                                // 0b: Autostufe nach „stimmt nicht“, Tor-Stand
      const w7 = await schritt(ctx, zahl, "W7", () => w7Eingang(ctx, { aktionen: leseAktionen(vault) }), { auftraege: [] });
      const auftraege = [...antworten.auftraege, ...w7.auftraege];
      if (!nurAntworten) {                                        // B3: K7-Feld-Aufträge + K4-Hinweise — nie ein Grund für „teilweise"
        try { auftraege.push(...b3Auftraege(ctx, home ? { home } : {})); }
        catch (e) { notiere(ctx, { id: "b3", stufe: "fehler", grund: `Pflege-Aufträge: ${kurz(e?.message, 140)}` }); }
      }
      const lektionen = nurAntworten ? [] : await schritt(ctx, zahl, "Vorschläge", () => vorschlagsSchritte(ctx, auftraege, zahl), []);   // 1–5
      await schritt(ctx, zahl, "Schreiben", () => schreibenUndUebernehmen(ctx, auftraege, zahl));                                 // 6, 7
      await schritt(ctx, zahl, "Einschwingen", () => { ctx.einschwingen = einschwingenSchritt(ctx); });                          // 7b
      await schritt(ctx, zahl, "Rücknahmen", () => zuruecknehmen(ctx, zahl, antworten.zuruecknehmen));
      if (!nurAntworten) {
        try { await b3Schritte(ctx); }                            // B3 (§7): eigene Fehlergrenze, macht den Lauf nie „teilweise"
        catch (e) { notiere(ctx, { id: "b3", stufe: "fehler", grund: `Pflege: ${kurz(e?.message, 140)}` }); }
        await schritt(ctx, zahl, "Aufräumen und Rückfragen", () => schritt8(ctx));                                                // 8
        await schritt(ctx, zahl, "Lektionen", () => lektionenSchritt(ctx, lektionen));                                            // 9
        await traumSchritt(ctx);                                  // 9b Traum (traum.mjs): eigene Fehlergrenze und eigenes Budget, nie ein Grund für „teilweise"
        await gesundheitSchritt(ctx);                                                                                           // 9c Gesundheits-Wächter (0 Tokens, wirft nie)
      }
      status = ctx.ohneKi ? "ohne-ki" : zahl.teilweise ? "teilweise" : ctx.budgetErschoepft || ctx.budget.zeitUm() ? "abgebrochen" : "ok";
      }
    } catch (e) {
      ctx.grund = `Unerwarteter Fehler: ${kurz(e?.message)}`;
      notiere(ctx, { id: "lauf", stufe: "fehler", grund: ctx.grund });
    } finally {
      try { schreibeAktionen(ctx); }
      catch (e) { if (!ctx.probe) { protokollKaputt(ctx, zahl, e?.code || e?.message); if (status === "ok" || status === "abgebrochen") status = "teilweise"; } }   // nie still (N3)
      try { speichereCache(ctx); } catch {}
    }
    return abschluss(ctx, { status, nurAntworten, nurPflege, probeFlag, werte, zahl });                  // 10
  } catch (e) {
    return { status: "fehler", grund: `Tageslauf konnte nicht laufen: ${kurz(e?.message)}` };
  } finally {
    gibSperreFrei(vault);
  }
}

export function leseArgs(argv) {
  const o = { vault: null, budget: {} };
  const SCHALTER = { "--wenn-faellig": "wennFaellig", "--dienst": "dienst", "--probe": "probe", "--nur-antworten": "nurAntworten", "--losgeloest": "losgeloest" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (SCHALTER[a]) { o[SCHALTER[a]] = true; continue; }
    if (a === "--budget-aufrufe" || a === "--budget-minuten") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 1 || n > 10000) throw new Error(`${a} braucht eine ganze Zahl`);
      o.budget[a === "--budget-aufrufe" ? "aufrufe" : "minuten"] = n;
      continue;
    }
    if (!a.startsWith("--") && !o.vault) { o.vault = a; continue; }
    throw new Error(`Unbekannte Angabe: ${a}`);
  }
  return o;
}

export function zusammenfassung(r) {
  if (r.status === "uebersprungen") return `Tageslauf übersprungen: ${r.grund}.`;
  if (!r.zahlen) return `Tageslauf ${STATUS_TEXT[r.status] || r.status}${r.grund ? `: ${r.grund}` : ""}.`;
  const z = r.zahlen, p = r.modus === "probe";
  return `${p ? "Probelauf (nichts geändert)" : "Tageslauf"} ${STATUS_TEXT[r.status] || r.status}: ${z.uebernommen ?? 0} ${p ? "würden übernommen" : "übernommen"}`
    + ` · ${z.aussortiert ?? 0} aussortiert · ${z.rueckfragen ?? 0} Rückfragen offen${r.grund ? ` — ${r.grund}` : ""}${r.bericht ? ` (Bericht: ${r.bericht})` : ""}`;
}

const selbst = fileURLToPath(import.meta.url);
let aufruf = "";
try { aufruf = realpathSync(process.argv[1] || ""); } catch {}
if (aufruf && aufruf === realpathSync(selbst)) {
  let o;
  try { o = leseArgs(process.argv.slice(2)); }
  catch (e) {
    console.error(`${e.message}\nNutzung: brain tageslauf [--probe] [--nur-antworten] [--wenn-faellig] [--dienst] [--losgeloest] [--budget-aufrufe N] [--budget-minuten N]`);
    process.exit(64);
  }
  const vault = o.vault || vaultPfadOderEnde([]);
  // Dienst-Lauf (LaunchAgent): nur für Vaults, für die der Dienst eingeschaltet wurde (tageslauf/dienst-merker.mjs).
  if (o.dienst && !(await import("./tageslauf/dienst-merker.mjs")).dienstErlaubt(vault)) {
    console.error(`${new Date().toISOString()} Hintergrunddienst: für diesen Vault ist der Dienst nicht eingeschaltet — Lauf übersprungen.`);
    process.exit(0);
  }
  if (o.losgeloest) {
    const args = process.argv.slice(2).filter((a) => a !== "--losgeloest" && a !== o.vault);
    const r = starteLosgeloest(vault, args);
    console.log(r.gestartet ? "Tageslauf läuft im Hintergrund." : `Tageslauf nicht gestartet: ${r.grund}.`);
  } else {
    const r = await tageslauf(vault, o);
    console.log(zusammenfassung(r));
    process.exitCode = r.status === "fehler" ? 1 : 0;
  }
}
