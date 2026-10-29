// tageslauf/antworten.mjs — Schritt 0 (Spec §5.3 „Anwenden", §4.4): beantwortete Rückfragen umsetzen, W7-Funde
// aufnehmen. Schreibt selbst nie ins Wiki: Seitenänderungen werden Schreibaufträge für Schritt 6/7 (der Orchestrator
// archiviert die Rückfrage erst nach dem Merge). Alles andere — verwerfen, aussortieren, Entscheidung, Lektion, Prüfung —
// passiert hier direkt. Eine Antwort wird genau so angewendet, wie sie gegeben wurde; passt sie nicht zur Frage (von Hand
// geänderte Datei) oder fehlt, was sie braucht, bleibt die Rückfrage offen und es wird nichts geraten.
// Probemodus: nur notieren und Aufträge zurückgeben; nichts verschieben, archivieren, schreiben.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ordner } from "../pfade.mjs";
import { leseW7 } from "../w7.mjs";
import { leseSeitenFelder } from "../seitenfelder.mjs";
import { nenntThema, THEMA_GRUND } from "../thema-ausschluss.mjs";
import { schreibeEntscheidung } from "../entscheidungen.mjs";
import { lektionInsWiki } from "../lektionen.mjs";
import { TYPEN, listeRueckfragen, legeRueckfrageAn, archiviereRueckfrage, istAutostufeRueckfrage, AUTOSTUFE_QUELLE } from "../rueckfragen.mjs";
import { ladeVorschlag, verschiebeVorschlag, aussortieren, ablehnen, schreibeFm, UNTERORDNER } from "./bestand.mjs";
import { TL_DIR, notiere, merkePruefung, lesePruefungen, autoUebernahmen } from "./protokoll.mjs";
import { merkeRuecknahme } from "./ruecknahmen.mjs";
import { leseFeld } from "./schreiben.mjs";
import { verlaengerung } from "./veraltet.mjs";
import { setzeLern, lernEintrag } from "./pflege-stand.mjs";
import { wendeTraumAntwortAn } from "./traum.mjs";

export const W7_FENSTER_TAGE = 60, RUHEN_TAGE = 30;
const TAG = 86400e3;
const kurz = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
// Antworten, die etwas ins Brain schreiben würden (Themen-Ausschluss prüft nur diese).
const INS_BRAIN = new Set(["heikel:uebernehmen", "web:uebernehmen", "widerspruch:b", "widerspruch:beide", "lektion:aktivieren", "lektion:aendern"]);
const W7_STAND = (vault) => join(TL_DIR(vault), "w7-stand.json");
const imWiki = (vault, seite) => typeof seite === "string" && seite.startsWith(`${ordner(vault).wiki}/`) && !seite.split("/").includes("..");
const fehlerAnzeige = (ctx, r, grund) => notiere(ctx, { id: r.id, stufe: "fehler", ziel: r.seite, grund: `antwort: ${grund}`, rueckfrage: r.id });

// Rückweg aus der Autostufe „aus“ (N5): Die Antwort auf eine Rückfrage, die nur wegen der Autostufe gestellt wurde, ist das Urteil über die Regeln — übernehmen = sie
// hatten recht (fehlerfreie Prüfung), verwerfen = sie lagen falsch (Fehler). Eigene art/quelle, damit sie nie als Einschwing-R/F gezählt wird; ohne seite, damit sie keine
// ältere Übernahme auf der Seite „beanstandet“. Einmal je Rückfrage (die Antwort kann erneut angewendet werden, solange der Merge noch aussteht).
function rueckwegPruefung(ctx, r, fehler) {
  if (ctx.probe || !istAutostufeRueckfrage(r)) return;
  if (lesePruefungen(ctx.vault).some((p) => p.ref === r.id && p.quelle === AUTOSTUFE_QUELLE)) return;
  merkePruefung(ctx, { art: "rueckweg", quelle: AUTOSTUFE_QUELLE, fehler, ref: r.id, vorschlag: r.vorschlaege[0] || "" });
}

function erledigt(ctx, r, was = "") {
  notiere(ctx, { id: r.id, stufe: "antwort", typ: r.typ, ziel: r.seite, grund: `${r.antwort}${was ? `: ${was}` : ""}`, rueckfrage: r.id });
  archiviereRueckfrage(ctx, r);
}

// Frontmatter-Feld einer Wiki-Seite im Vault (nur lesen). undefined = nicht lesbar, null = Feld fehlt.
function seitenFeld(ctx, seite, feld) {
  if (!imWiki(ctx.vault, seite)) return undefined;
  try { return leseFeld(readFileSync(join(ctx.vault, seite), "utf8"), feld); } catch { return undefined; }
}
const leer = (w) => w === null || w === undefined || /^(""|''|null|\[\])?$/.test(String(w).trim());

// „Ändern“ gilt nur mit deiner eigenen Formulierung (Notiz); „aktivieren“ mit dem Text, den du gesehen hast.
function lektionAktivieren(ctx, r, vs) {
  const [erste, ...rest] = vs;
  if (!erste) return { weiter: false, was: "vorschlag-fehlt" };
  if (r.antwort === "aendern" && !r.notiz) return null;
  if (ctx.probe) return { weiter: true, was: "aktiviert (Probe)" };
  const ziel = verschiebeVorschlag(ctx, erste, `${ordner(ctx.vault).inbox}/_lektionen`);
  const id = ziel.split("/").pop().replace(/\.md$/, "");
  for (const v of rest) aussortieren(ctx, v, "in-lektion-zusammengefasst");
  const fm = r.fm;
  try {
    lektionInsWiki(ctx.vault, id, { titel: fm.titel || erste.titel, regel: r.antwort === "aendern" ? r.notiz : (fm.regel || erste.regel),
      warum: fm.warum || erste.warum, wie: fm.wie || erste.wie, giltFuer: Array.isArray(fm.gilt_fuer) ? fm.gilt_fuer : [] });
    notiere(ctx, { id, stufe: "lektion", ziel: `${ordner(ctx.vault).wiki}/_lektionen.md`, grund: r.antwort, titel: fm.titel || erste.titel });
    return { weiter: true, was: "aktiviert" };
  } catch (e) {
    // bleibt in <inbox>/_lektionen — der Skill „lektion“ zeigt sie
    notiere(ctx, { id, stufe: "fehler", ziel, grund: `lektion: ${kurz(e.message, 120)}` });
    return { weiter: true, was: "lektion-liegt-in-_lektionen" };
  }
}

export function wendeAntwortenAn(ctx) {
  const erg = { auftraege: [], zuruecknehmen: [], erledigt: 0, fehler: 0 };
  const inbox = ordner(ctx.vault).inbox;
  for (const r of listeRueckfragen(ctx.vault).filter((x) => x.antwort)) {
    try {
      if (!Object.hasOwn(TYPEN[r.typ].wahlen, r.antwort)) { erg.fehler++; fehlerAnzeige(ctx, r, `unbekannte Antwort „${kurz(r.antwort, 30)}“`); continue; }
      const vs = r.vorschlaege.map((id) => ladeVorschlag(ctx.vault, UNTERORDNER.rueckfrage, id)).filter(Boolean);
      const auftrag = (a) => erg.auftraege.push({ seite: r.seite, ref: r.id, rueckfrage: r, titel: r.frage, ...a });
      const feld = (name, wert) => auftrag({ art: "feld", feld: name, wert });
      const fertig = (was) => { erledigt(ctx, r, was); erg.erledigt++; };
      const jedem = (f) => { for (const v of vs) f(v); };
      const fall = `${r.typ}:${r.antwort}`;
      if (r.typ === "traum") { if (wendeTraumAntwortAn(ctx, r)) erg.erledigt++; continue; }   // Traum (traum.mjs): wendet genau den gezeigten Patch an, archiviert selbst
      // Themen-Ausschluss (ernteOhneThema): was ins Brain wandern würde (Seite, Inbox-Wurzel für /ingest, Lektion), obwohl es ein
      // ausgeschlossenes Wort nennt — z. B. weil die Rückfrage älter ist als die Einstellung —, wird nicht geschrieben: Vorschlag ins
      // Archiv, Rückfrage erledigt. Im Protokoll steht nur der Grund (kein Titel, keine Seite).
      if (INS_BRAIN.has(fall) && (vs.some((v) => nenntThema(ctx.werte?.ernteOhneThema, v.titel, v.text, v.zitat, v.regel, v.warum, v.wie))
        || (fall.startsWith("lektion:") && nenntThema(ctx.werte?.ernteOhneThema, r.fm.titel, r.fm.regel, r.fm.warum, r.fm.wie, r.notiz)))) {
        jedem((v) => aussortieren(ctx, v, THEMA_GRUND));
        notiere(ctx, { id: r.id, stufe: "antwort", typ: r.typ, grund: `${r.antwort}: ${THEMA_GRUND}`, rueckfrage: r.id });
        archiviereRueckfrage(ctx, r);
        erg.erledigt++;
        continue;
      }
      if (r.typ === "heikel" && r.fm.pflege && (r.antwort === "uebernehmen" || r.antwort === "verwerfen")) {
        // B3 im Lernmodus: Rückfrage zu einem Pflege-Vorschlag (b3.mjs). Die Antwort ist das Urteil über die Pflege (zählt wie jede markierte
        // Rückfrage); „Übernehmen“ gibt genau diese Einheit (Quelle unverändert) für den nächsten Lauf frei, „Verwerfen“ legt sie ab.
        // Hier wird nichts ins Wiki geschrieben — das tut der nächste B3-Lauf, mit allen Prüfungen.
        // Die Antwort gilt nur für DIE Rückfrage (und den Inhalt), die der Lern-Eintrag trägt: wurde die Einheit seither neu vorgelegt (andere Rückfrage-ID)
        // oder ist der Eintrag weg/verändert, hat der User einen älteren Stand gesehen — dann wird nichts freigegeben oder abgelehnt und nichts gezählt.
        const e = lernEintrag(ctx.vault, String(r.fm.pflege));
        if (!e || e.rueckfrage !== r.id || e.sha !== String(r.fm.pflege_sha || "")) { fertig("pflege-veraltet"); continue; }
        const ja = r.antwort === "uebernehmen";
        rueckwegPruefung(ctx, r, !ja);
        setzeLern(ctx, String(r.fm.pflege), { sha: String(r.fm.pflege_sha || ""), status: ja ? "freigegeben" : "abgelehnt", rueckfrage: r.id });
        fertig(ja ? "pflege-freigegeben" : "pflege-abgelehnt");
      } else if (fall === "heikel:uebernehmen" || fall === "web:uebernehmen") {
        if (!vs.length) fertig("vorschlag-fehlt");
        else if (r.grund === "kritisch" || !r.seite) {
          // Kritische Seite (oder keine Zielseite bekannt): der Lauf schreibt nicht — der freigegebene Vorschlag liegt für /ingest in der Inbox-Wurzel.
          jedem((v) => { const z = verschiebeVorschlag(ctx, v, inbox); notiere(ctx, { id: v.id, stufe: "inbox", ziel: z, grund: r.grund === "kritisch" ? "freigegeben-kritisch" : "freigegeben-ohne-seite", titel: v.titel, verschoben: ctx.probe ? null : z }); });
          fertig("inbox");
        } else if (vs.some((v) => v.art !== "fakt" && v.art !== "stand")) {
          erg.fehler++; fehlerAnzeige(ctx, r, "Vorschlag ist weder Fakt noch Stand");   // nichts schreiben, Rückfrage bleibt offen
        } else { if (fall === "heikel:uebernehmen") rueckwegPruefung(ctx, r, false); jedem((v) => auftrag({ art: v.art === "stand" ? "stand" : "fakt", v, titel: v.titel })); }
      } else if (fall === "heikel:verwerfen" || fall === "web:verwerfen" || fall === "lektion:verwerfen" || fall === "widerspruch:a") {
        if (fall === "heikel:verwerfen") rueckwegPruefung(ctx, r, true);
        jedem((v) => ablehnen(ctx, v, fall.replace(":", "-")));
        fertig();
      } else if (fall === "widerspruch:b") jedem((v) => auftrag({ art: "ersetzen", v, zeile: r.zeile, titel: v.titel }));
      else if (fall === "widerspruch:beide") jedem((v) => auftrag({ art: "fakt", v, titel: v.titel }));
      else if (fall === "widerspruch:weiss-nicht") { jedem((v) => aussortieren(ctx, v, "weiss-nicht")); fertig(); }
      else if (fall === "zweifel:stimmt") { merkePruefung(ctx, { art: "aufgehoben", ref: r.id }); feld("zweifel", null); }
      else if (fall === "zweifel:falsch") {
        if (r.notiz) feld("zweifel", `${ctx.heute}: ${kurz(r.notiz, 200)}`);
        else if (!leer(seitenFeld(ctx, r.seite, "zweifel"))) fertig("zweifel-bleibt");   // Seite ist schon prüfbedürftig (z. B. aus W7) — nichts überschreiben
        else feld("zweifel", `${ctx.heute}: als falsch gemeldet (Rückfrage)`);
      }
      else if (fall === "veraltet:stimmt-noch") {
        // K7 (B3): stand = heute, und eine vorhandene Frist pruefen_bis rückt um 90 Tage — sonst wäre die Seite morgen wieder abgelaufen.
        let text = "";
        try { text = readFileSync(join(ctx.vault, r.seite), "utf8"); } catch { /* Seite weg → nur stand, das Schreiben meldet es */ }
        const [stand, ...rest] = verlaengerung(text, ctx.heute);
        feld(stand.feld, stand.wert);
        for (const f of rest) erg.auftraege.push({ art: "feld", seite: r.seite, feld: f.feld, wert: f.wert, titel: r.frage, ref: `${r.id}-frist` });
      }
      else if (fall === "veraltet:ueberholt") feld("zweifel", `${ctx.heute}: überholt (Rückfrage)${r.notiz ? ` — ${kurz(r.notiz, 160)}` : ""}`);
      else if (fall === "konflikt:spaeter") {
        const bis = new Date(ctx.jetzt + RUHEN_TAGE * TAG).toISOString().slice(0, 10);
        if (!ctx.probe) writeFileSync(r.datei, schreibeFm({ ...r.fm, antwort: "", notiz: "", beantwortet: "", ruhen_bis: bis }, r.rumpf));
        notiere(ctx, { id: r.id, stufe: "antwort", typ: r.typ, ziel: r.seite, grund: `spaeter: ruht bis ${bis}`, rueckfrage: r.id });
      } else if (r.typ === "konflikt") {
        let was = "entschieden";
        if (!ctx.probe) {
          try { schreibeEntscheidung(ctx.vault, { seite: r.seite, nr: Number(r.fm.nr), wahl: r.antwort, notiz: r.notiz, fingerabdruck: String(r.fm.fp || "") || null }); }
          catch (e) {
            // Seite oder Kasten hat sich geändert → Rückfrage erledigt, der neue Kasten wird neu gefragt. Alles andere: offen lassen, nächster Lauf.
            if (e.code !== 409 && e.code !== 404) { erg.fehler++; fehlerAnzeige(ctx, r, `entscheidung: ${kurz(e.message, 100)}`); continue; }
            was = "seite-geaendert";
          }
        }
        fertig(was);
      } else if (fall === "lektion:aktivieren" || fall === "lektion:aendern") {
        const a = lektionAktivieren(ctx, r, vs);
        if (!a) { erg.fehler++; fehlerAnzeige(ctx, r, "„ändern“ ohne neue Formulierung — nichts aktiviert"); }
        else fertig(a.was);
      } else if (fall === "integritaet:geprueft") {
        fertig("geprueft");
      } else if (fall === "integritaet:spaeter") {
        // Sicherheitswarnung bleibt offen und laut: Antwort zurücknehmen, nichts verstecken.
        if (!ctx.probe) writeFileSync(r.datei, schreibeFm({ ...r.fm, antwort: "", notiz: "", beantwortet: "" }, r.rumpf));
      } else if (r.typ === "stichprobe") {
        const nein = r.antwort === "stimmt-nicht";
        // Die Rücknahme wird SOFORT in ruecknahmen-offen.json festgehalten (Befund N6) — vor der Prüfung und vor dem Archivieren der Rückfrage: scheitert das Zurücknehmen
        // später oder stirbt der Lauf dazwischen, bleibt sie offen und wird in jedem Lauf neu versucht. Misslingt schon das Festhalten, bleibt die Antwort unangewendet liegen.
        if (nein) merkeRuecknahme(ctx, { aktion: String(r.fm.aktion || ""), commit: String(r.fm.commit || ""), ref: r.id });
        // quelle: Stichproben der Einschwingphase (quelle einschwingen) füllen ihre Zählung R/F (einschwingen.mjs) — die Prüfung trägt sie mit.
        merkePruefung(ctx, { art: "stichprobe", fehler: nein, ref: r.id, aktion: String(r.fm.aktion || ""), seite: r.seite, ...(r.quelle ? { quelle: r.quelle } : {}) });
        if (nein) erg.zuruecknehmen.push({ aktion: String(r.fm.aktion || ""), commit: String(r.fm.commit || ""), ref: r.id });
        fertig();
      } else { erg.fehler++; fehlerAnzeige(ctx, r, "Antwort nicht behandelt"); }
    } catch (e) {
      erg.fehler++;
      notiere(ctx, { id: r.id, stufe: "fehler", ziel: r.seite, grund: `antwort: ${kurz(e.message, 120)}` });
    }
  }
  return erg;
}

// W7 (§4.4): neue Zeilen aus .logs/w7.jsonl → je Seite ein Feld-Auftrag `zweifel` + eine Rückfrage „zweifel“.
// Stammt die Seite aus einer automatischen Übernahme der letzten 60 Tage (vor der Korrektur), zählt das als Fehler.
// Befund #9 — Selbstheilung statt Stand-Verschiebung: Der W7-Stand rückt schon hier (Schritt 0) vor, das Feld wird aber erst in Schritt 6/7 geschrieben.
// Scheitert der Merge (lokale Änderung, Ingest-Sperre, Prüfung rot, Absturz), wäre der Auftrag weg. Den Stand erst nach dem Merge fortzuschreiben, hilft
// nicht: die Rückfrage (und die W7-Fehlerprüfung) gibt es dann schon, ein zweiter Durchlauf der Zeile würde sie überspringen bzw. doppelt zählen. Darum
// gilt: jede offene zweifel-Rückfrage aus W7, deren Seite das Feld `zweifel` noch nicht trägt, erzeugt ihren Feld-Auftrag in jedem Lauf neu, bis das
// Feld steht. Das deckt jeden Ausfallweg ab, ohne den Stand oder die Prüfungen anzufassen. Nicht angefasst werden kritische Seiten (der Lauf schreibt
// dort nie) und Rückfragen anderen Ursprungs; beantwortete Rückfragen laufen über wendeAntwortenAn.
export function w7Eingang(ctx, { aktionen = [] } = {}) {
  const alle = leseW7(ctx.vault);
  let gelesen = 0;
  try { gelesen = Number(JSON.parse(readFileSync(W7_STAND(ctx.vault), "utf8")).gelesen) || 0; } catch {}
  if (gelesen > alle.length) gelesen = 0;   // Datei wurde neu begonnen
  const neu = alle.slice(gelesen);
  const auftraege = [];
  const auto = autoUebernahmen(aktionen);
  // B3: was die Pflege geschrieben hat (und nicht zurückgenommen ist), gilt für W7 wie eine automatische Übernahme.
  const zurueckIds = new Set(aktionen.filter((a) => a.stufe === "zurueck").map((a) => a.id));
  const pflege = aktionen.filter((a) => a.stufe === "pflege" && a.commit && !zurueckIds.has(a.id));
  const offene = listeRueckfragen(ctx.vault).filter((r) => r.typ === "zweifel" && !r.antwort);   // Stand VOR den neuen Rückfragen dieses Aufrufs
  for (const r of offene) {
    if (r.grund !== "w7" || !imWiki(ctx.vault, r.seite)) continue;
    let text;
    try { text = readFileSync(join(ctx.vault, r.seite), "utf8"); } catch { continue; }
    if (leseSeitenFelder(text).kritisch || !leer(leseFeld(text, "zweifel"))) continue;
    const zitat = kurz(r.fm.zitat || (r.beschreibung.match(/„([^“]*)“/) || [])[1], 200) || "Korrektur in einer Sitzung";
    const tag = /^\d{4}-\d{2}-\d{2}/.test(r.erstellt) ? r.erstellt.slice(0, 10) : ctx.heute;
    auftraege.push({ art: "feld", seite: r.seite, feld: "zweifel", wert: `${tag}: ${zitat}`, titel: "Zweifel nach Korrektur (W7)", ref: r.id });
  }
  const schon = new Set(offene.map((r) => r.seite));
  for (const f of neu) {
    const seite = String(f.seite || "");
    if (!imWiki(ctx.vault, seite) || schon.has(seite) || !existsSync(join(ctx.vault, seite))) continue;
    // Themen-Ausschluss: Korrektur-Zitat oder Seitenpfad nennt ein ausgeschlossenes Wort → weder Rückfrage noch Feld-Auftrag (gilt als gelesen).
    if (nenntThema(ctx.werte?.ernteOhneThema, f.zitat, seite)) { notiere(ctx, { id: "w7", stufe: "aussortieren", grund: THEMA_GRUND }); continue; }
    schon.add(seite);
    const zitat = kurz(f.zitat, 200) || "Korrektur in einer Sitzung";
    const id = legeRueckfrageAn(ctx, { typ: "zweifel", frage: `Stimmt ${seite.split("/").pop()} noch?`, seite, grund: "w7", felder: { zitat },
      beschreibung: `Nach einem Kortex-Hinweis auf diese Seite kam eine Korrektur:\n„${zitat}“\nSitzung ${f.sitzung || "-"}, ${String(f.zeit || "").slice(0, 16)}` });
    auftraege.push({ art: "feld", seite, feld: "zweifel", wert: `${ctx.heute}: ${zitat}`, titel: "Zweifel nach Korrektur (W7)", ref: id || `w7-${ctx.lauf}` });
    const t = Date.parse(f.zeit) || ctx.jetzt;
    const imFenster = (a) => t >= Date.parse(a.zeit) && t - Date.parse(a.zeit) <= W7_FENSTER_TAGE * TAG;
    if (auto.some((a) => a.ziel === seite && imFenster(a)) || pflege.some((a) => (a.seiten || [a.ziel]).includes(seite) && imFenster(a))) {
      merkePruefung(ctx, { art: "w7", fehler: true, ref: id, seite });
    }
  }
  if (!ctx.probe) { mkdirSync(TL_DIR(ctx.vault), { recursive: true }); writeFileSync(W7_STAND(ctx.vault), JSON.stringify({ gelesen: alle.length }) + "\n"); }
  return { auftraege, neu: neu.length };
}
