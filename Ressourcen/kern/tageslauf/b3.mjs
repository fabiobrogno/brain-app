// .tools/tageslauf/b3.mjs — B3 „Pflege-Intelligenz" im Tageslauf (Spec §7). Zwei Andockstellen im Orchestrator (tageslauf.mjs):
//   b3Auftraege(ctx)  vor den Schritten 1–5: K7 (Prüfen nach Nutzung: veraltet-Rückfragen, Feld-Aufträge für unveränderte
//                     Projekte — geschrieben vom B2-Schreiben) einmal je Tag; K4-Hinweise zu Vorschlägen mit alten Begriffen.
//   b3Schritte(ctx)   nach den Rücknahmen, vor Schritt 8: Entscheidungen → Inbox → neue Seiten → Konsolidieren in EINER
//                     Pflege-Arbeitskopie; am Ende EIN ff-Merge, danach je Posten nachMerge (Dateiverschiebungen) + Protokoll.
// Schalter automatik.pflegeIntelligenz: aus (Standard) | probe | an. Probe (Schalter oder ganzer Tageslauf in Probe): alles
// rechnen inkl. KI und Commits in der Arbeitskopie; nichts mergen, verschieben oder anlegen. Scharf und Probe je höchstens
// einmal je Kalendertag (Riegel .logs/tageslauf/pflege-tag.json, gesetzt VOR dem ersten KI-Aufruf — auch in der Probe, sonst
// kostet ein stündlich wiederholter Lauf jedes Mal Sonnet). B3 macht einen Tageslauf nie „nicht erfolgreich": Fehler stehen
// im Bericht; probe/ohneKi/grund/kiFehlerFolge des Laufs werden danach wiederhergestellt.
//
// Themen-Guard (pflege-thema.mjs): ohne lesbare Einstellungen läuft B3 gar nicht (fail-closed); ausgeschlossene Themen/Ordner
// (ernteOhneThema, ernteNichtIn) halten Notizen, Seiten und Fakten von der KI fern — die Schritte zählen nur den Grund.
//
// Lernmodus (Autostufe „aus“ — aus dem Start oder aus Fehlern, so wie tageslauf.mjs sie bestimmt): B3 schreibt dann keine
// inhaltliche Wiki-Änderung selbst. Zwei Durchgänge:
//   1. „freigaben“ (eigene Arbeitskopie, wird gemergt): Entscheidungen (deterministisch, aus deinen eigenen Antworten) und nur
//      die Einheiten, die du als Rückfrage mit „Übernehmen“ freigegeben hast. Angewendet wird GENAU der Patch, den du gesehen hast
//      (pflege-patch.mjs; Prüfsumme im Lern-Eintrag) — es rechnet nie wieder eine KI. Danach laufen dieselben Prüfungen wie sonst
//      (Diff-Prüfung, Integrität, Lint). Passt der Patch nicht mehr, wird nichts gemergt: die Freigabe verfällt, die Einheit wird neu vorgelegt.
//      Steht eine Sicherheits-Rückfrage (typ integritaet) offen, setzt dieser Durchgang aus (Bericht-Zeile), bis sie beantwortet ist.
//   2. „vorlegen“ (eigene Arbeitskopie, wird NIE gemergt): alle übrigen Einheiten werden gerechnet und geprüft wie sonst auch;
//      statt zu schreiben entsteht je Einheit eine markierte Rückfrage (typ heikel, quelle autostufe-rueckfrage) mit dem Diff ALLER
//      geänderten Dateien (zu groß für die Anzeige → keine Rückfrage, nur „zu groß für eine Freigabe“ im Bericht). Deine Antwort
//      zählt wie bei B2 als Prüfung (übernehmen = richtig, verwerfen = falsch).
import { readFileSync, writeFileSync, mkdirSync, renameSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { hatSecretsImKontext } from "../secrets-muster.mjs";
import { istWikiSeite } from "../wiki-pfade.mjs";
import { ordner } from "../pfade.mjs";
import { legeRueckfrageAn, listeRueckfragen, AUTOSTUFE_QUELLE, ANZEIGE_MAX_PFLEGE, diffCodeblock } from "../rueckfragen.mjs";
import { ladeVorschlaege } from "./bestand.mjs";
import { notiere, TL_DIR } from "./protokoll.mjs";
import { git, verwerfeArbeitskopie, nimmIngestSperre, gibIngestSperreFrei } from "./arbeitskopie.mjs";
import { ZURUECK_NACH } from "./autostufe.mjs";
import { pflegeBudget, PFLEGE_BUDGET } from "./pflege-ki.mjs";
import { legePflegeKopieAn, uebernehmePflege } from "./pflege-kopie.mjs";
import { leseStand, lernEintrag, setzeLern, loescheLern } from "./pflege-stand.mjs";
import { erzeugePatch, patchAnzeige, speicherePatch, freigabePatch, ladePatch, seitenStand, PATCH_FEHLT } from "./pflege-patch.mjs";
import { pflegeGrund, konfigLesbar, GRUND_CONFIG } from "./pflege-thema.mjs";
import { veraltetSchritt } from "./veraltet.mjs";
import { ladeDriftListe, driftBefunde, vorschlagDrift } from "./drift.mjs";
import { entscheidungSchritt } from "./konflikt-aufloesen.mjs";
import { inboxSchritt } from "./inbox-schritt.mjs";
import { neueSeitenSchritt } from "./neue-seiten.mjs";
import { konsolidierSchritt } from "./konsolidieren.mjs";

export const MODI = ["aus", "probe", "an"];
export const SCHRITTE = [
  ["Entscheidungen", entscheidungSchritt, { ohneKi: true }],
  ["Inbox", inboxSchritt],
  ["Neue Seiten", neueSeitenSchritt],
  ["Konsolidieren", konsolidierSchritt],
];
export const MAX_DIFF_ZEICHEN = 8000;      // länger → nicht als Rückfrage vorlegen (zu groß, um es ehrlich zu prüfen); die Anzeige (rueckfragen.mjs#ANZEIGE_MAX_PFLEGE) trägt immer mehr
// Umstände statt Inhalt: so ein Fehlschlag macht eine freigegebene Einheit nicht „gescheitert“ (sie bleibt für morgen freigegeben).
const KEIN_VERSUCH = new Set(["budget", "ohne-ki", "vault-veraendert", "pflege-gestoppt"]);
const kurz = (s, n = 160) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const ART_TEXT = { inbox: "Inbox eingearbeitet", konsolidieren: "Seite konsolidiert", "neue-seite": "Neue Seite angelegt", entscheidung: "Konflikt entschieden" };
const ART_KURZ = { inbox: "Inbox", konsolidieren: "Konsolidieren", "neue-seite": "Neue Seite", entscheidung: "Entscheidung" };
const GRUND_TEXT = {
  "diff-rot": "die Prüfung der Änderung hat angeschlagen", "pruefung-rot": "Commit-Prüfung (Lint/pre-commit) rot",
  "vault-veraendert": "im Brain hat sich währenddessen etwas geändert — Pflege für heute beendet",
  "gegenprobe-nein": "Gegenprobe: eine Aussage wäre verloren gegangen", "ki-nichts": "die KI fand nichts einzuarbeiten",
  "ki-fehler": "KI nicht erreichbar oder Antwort unbrauchbar", "ziel-ungueltig": "die KI wollte die Quelle an einen unzulässigen Ort legen",
  "quelle-veraendert": "die KI hat die Quelle verändert", secrets: "enthält vermutlich Zugangsdaten — bitte selbst einarbeiten (/ingest)",
  budget: "Budget für heute aufgebraucht", "ohne-ki": "ohne KI", "passt-nicht": "die Fakten haben laut KI kein gemeinsames Thema (30 Tage Ruhe)",
  "name-vergeben": "Seitenname schon vergeben", "entwurf-ungueltig": "Entwurf der KI unbrauchbar", kritisch: "kritische Seite — bitte per /ingest",
  "kasten-weg": "den Konflikt-Kasten gibt es nicht mehr — Entscheidung abgelegt", "ohne-fingerabdruck": "alte Entscheidung — bitte per /ingest",
  "seite-unlesbar": "Seite unlesbar", "arbeit-fehler": "Fehler bei der Arbeit", unveraendert: "nichts geändert",
  "thema-ausgeschlossen": "der neue Text nennt ein ausgeschlossenes Thema",
  [PATCH_FEHLT]: "der freigegebene Vorschlag passt nicht mehr (Seite inzwischen geändert) — er wird neu vorgelegt", "zu-gross": "zu groß für eine Freigabe — bitte per /ingest ansehen",
  "aussage-ohne-quelle": "eine neue Aussage steht nicht in der Quelle", "integritaet-verletzt": "Sicherheitsprüfung angeschlagen — bitte die Warnung lesen",
};
export const pflegeModus = (ctx) => (MODI.includes(ctx.werte?.pflegeIntelligenz) ? ctx.werte.pflegeIntelligenz : "aus");
const lernmodusAktiv = (ctx) => ctx.autostufe === "aus";

export const TAG_DATEI = (vault) => join(TL_DIR(vault), "pflege-tag.json");
export function pflegeTag(vault) {
  try { const j = JSON.parse(readFileSync(TAG_DATEI(vault), "utf8")); return j && typeof j === "object" && !Array.isArray(j) ? j : {}; }
  catch { return {}; }
}
export function merkePflegeTag(vault, art, heute) {
  const j = pflegeTag(vault);
  j[art] = heute;
  mkdirSync(TL_DIR(vault), { recursive: true });
  const tmp = `${TAG_DATEI(vault)}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(j) + "\n");
  renameSync(tmp, TAG_DATEI(vault));
}
// Die Ingest-Sperre gilt 30 min als frisch; B3 kann länger laufen → vor jedem Schritt auffrischen (nur die eigene).
function frischeSperre(vault) {
  const f = join(vault, ".logs", "ingest.lock");
  try { if (readFileSync(f, "utf8") === `tageslauf ${process.pid}\n`) { const t = new Date(); utimesSync(f, t, t); } } catch { /* keine eigene Sperre */ }
}

// Wurde B3 heute wegen /ingest übersprungen und noch nicht scharf nachgeholt? Dann darf der nächste stündliche Takt (--wenn-faellig, auch wenn
// B2 nicht fällig ist) einen reinen B3-Nachlauf starten (tageslauf.mjs: nurPflege) — ohne B2 erneut.
export function pflegeNachlaufOffen(vault, werte, heute) {
  if (!["probe", "an"].includes(werte?.pflegeIntelligenz)) return false;
  const t = pflegeTag(vault);
  return t.nachlauf === heute && t.scharf !== heute && t.probe !== heute;
}

export function b3Auftraege(ctx, { k7 = veraltetSchritt, home } = {}) {
  const modus = pflegeModus(ctx);
  if (modus === "aus") return [];
  const probe = ctx.probe || modus === "probe";
  const info = (ctx.pflegeInfo ??= {});
  const liste = ladeDriftListe(ctx.vault);
  if (liste.eintraege.length) {
    for (const v of ladeVorschlaege(ctx.vault)) {
      const d = vorschlagDrift(`${v.titel}\n${v.text}`, liste.eintraege);
      if (d) notiere(ctx, { id: v.id, stufe: "hinweis", ziel: "", titel: v.titel, grund: `drift: „${d.alt}" → „${d.neu}"` });
    }
    info.drift = driftBefunde(ctx.vault, liste).length;
  }
  const art = probe ? "k7Probe" : "k7";
  if (pflegeTag(ctx.vault)[art] === ctx.heute) return [];
  merkePflegeTag(ctx.vault, art, ctx.heute);
  const vorher = ctx.probe;
  ctx.probe = probe;
  try {
    const r = k7(ctx, home ? { home } : {});
    info.k7 = { rueckfragen: r.rueckfragen, archiv: r.archiv?.liste?.length || 0 };
    if (!probe && !lernmodusAktiv(ctx)) return r.auftraege;
    // Probe und Lernmodus: die Frist-/Stand-Verlängerung ist eine Änderung an Wiki-Seiten — nur melden (die veraltet-Rückfragen bleiben).
    const warum = probe ? "k7 (Probe)" : "k7 (Lernmodus)";
    for (const a of r.auftraege) notiere(ctx, { id: a.ref, stufe: "hinweis", ziel: a.seite, grund: `${warum}: ${a.feld} würde verlängert` });
    return [];
  } finally { ctx.probe = vorher; }
}

function protokolliere(ctx, p, commits, merge) {
  const e = p.erg;
  const basis = { id: e.id, art: e.art, titel: e.titel, ziel: p.ziel, ...(p.aktion || {}) };
  if (!e.ok) {
    const befund = (e.befunde || []).slice(0, 2).map((b) => `${b.regel}: ${b.meldung}`).join(" | ").slice(0, 300);
    notiere(ctx, { ...basis, stufe: "pflege-verworfen", grund: e.grund, ...(befund ? { befund } : {}) });
    return;
  }
  if (ctx.probe) { notiere(ctx, { ...basis, stufe: "pflege", probe: true, commit: null, kopieCommit: e.commit, seiten: e.seiten }); return; }
  const hash = commits.get(e.id);
  if (!hash) { notiere(ctx, { ...basis, stufe: "pflege-verworfen", grund: `merge: ${merge || "fehlt"}` }); return; }
  let nach = {};
  try { nach = p.nachMerge?.(hash) || {}; }
  catch (x) { notiere(ctx, { id: e.id, stufe: "fehler", grund: `Pflege nach dem Merge: ${kurz(x?.message, 120)}` }); }
  notiere(ctx, { ...basis, stufe: "pflege", commit: hash, seiten: e.seiten, ...nach, ...(e.info ? { info: e.info } : {}) });
}

const LERNMODUS_FRAGE = `Lernmodus — die Automatik schreibt noch nichts selbst, bis du ${ZURUECK_NACH} Urteile in Folge bestätigt hast. Deine Antwort zählt als Prüfung: `
  + "„Übernehmen“ = der Vorschlag ist richtig (die Pflege wendet beim nächsten Lauf genau diesen Vorschlag an — ohne neu zu rechnen, mit denselben Prüfungen; passt er dann nicht mehr, fragt sie neu), „Verwerfen“ = er ist falsch (die Zählung beginnt von vorn, die Einheit wird nicht wieder vorgeschlagen, solange sich die Quelle nicht ändert).";

// Lernmodus, Vorlege-Durchgang: aus einer gelungenen Einheit wird eine markierte Rückfrage. → { ok } | { ok:false, grund }
// Gezeigt wird der Diff ALLER geänderten Dateien (auch Belege, einsortierte Quelle); genau dieser Patch wird bei „Übernehmen“ angewendet.
function legeVorschlag(ctx, kopie, p) {
  const e = p.erg, l = p.lern;
  if (!l?.schluessel) return { ok: false, grund: "ohne-schluessel" };
  let diff, patch, seitenSha;
  try { diff = patchAnzeige(ctx, kopie, e.commit); patch = erzeugePatch(ctx, kopie, e.commit); seitenSha = seitenStand(ctx, kopie, e.commit); } catch { return { ok: false, grund: "ohne-diff" }; }
  if (!diff || !patch) return { ok: false, grund: "ohne-diff" };
  if (diff.length > MAX_DIFF_ZEICHEN) return { ok: false, grund: "zu-gross" };
  if (hatSecretsImKontext(diff)) return { ok: false, grund: "secrets" };
  const tg = pflegeGrund(ctx, diff, e.titel);               // zweiter Riegel: was als Frage im Brain landet, nennt kein ausgeschlossenes Thema
  if (tg) return { ok: false, grund: tg === GRUND_CONFIG ? tg : "thema-ausgeschlossen" };
  const frage = `Pflege-Vorschlag: ${ART_TEXT[e.art] || e.art} „${kurz(e.titel, 60)}“ — so übernehmen?`;
  const beschreibung = `${p.aktion?.quelle ? `Quelle: ${p.aktion.quelle}\n` : ""}Ziel: ${p.ziel}\nVorschlag der Pflege (Diff aller geänderten Dateien, schon geprüft: nichts gelöscht, Belege und Konflikt-Kästen unverändert):\n\n${diffCodeblock(diff)}\n\n`
    + `Warum ich frage: ${LERNMODUS_FRAGE}`;
  if (beschreibung.length > ANZEIGE_MAX_PFLEGE) return { ok: false, grund: "zu-gross" };   // „Übernehmen“ gilt nur für Gesehenes: was die Anzeige nicht ganz trägt, wird nicht vorgelegt
  const id = legeRueckfrageAn(ctx, { typ: "heikel", frage, beschreibung, seite: p.ziel, grund: "autostufe-aus",
    felder: { quelle: AUTOSTUFE_QUELLE, pflege: l.schluessel, pflege_sha: l.sha, pflege_art: l.art || e.art },
    protokoll: { hinweise: [] } });
  if (id) setzeLern(ctx, l.schluessel, { sha: l.sha, status: "vorgelegt", rueckfrage: id, ...(speicherePatch(ctx, id, patch, { ...(e.meta || {}), seitenSha }) || {}) });
  return { ok: true, rueckfrage: id };
}

async function laufeSchritte(ctx, kopie, schritte, { bericht, nurOhneKi, lern }) {
  for (const [name, f, o = {}] of schritte) {
    if (ctx.pflegeStopp) break;
    if (lern?.nurKi && o.ohneKi) continue;                        // Durchgang 2 (Vorlegen) kennt nur die KI-Schritte
    if (nurOhneKi && !o.ohneKi) continue;
    if (!o.ohneKi && pflegeBudget(ctx).zeitUm()) { notiere(ctx, { id: "b3", stufe: "hinweis", ziel: "", grund: "Pflege: Zeitbudget aufgebraucht" }); (ctx.pflegeInfo ??= {}).zeitbudget = true; break; }
    frischeSperre(ctx.vault);
    ctx.pflegeLern = lern && !o.ohneKi ? lern : undefined;
    try { bericht.posten.push(...(await f(ctx, kopie)).map((p) => ({ ...p, vorlegen: !!lern?.nurKi }))); }
    catch (e) { notiere(ctx, { id: "b3", stufe: "fehler", ziel: "", grund: `Pflege ${name}: ${kurz(e?.message, 140)}` }); }
    finally { ctx.pflegeLern = undefined; }
  }
}

export async function b3Schritte(ctx, { schritte = SCHRITTE } = {}) {
  const modus = pflegeModus(ctx);
  if (modus === "aus") return { lauf: false, grund: "aus" };
  if (!konfigLesbar(ctx)) {                                          // fail-closed wie die Ernte: ohne lesbare Einstellungen keine Pflege
    notiere(ctx, { id: "b3", stufe: "hinweis", ziel: "", grund: "Pflege: Einstellungen nicht lesbar (Themen-Ausschluss) — heute keine Pflege" });
    ctx.pflegeUebersprungen = "config";
    return { lauf: false, grund: "config" };
  }
  const probe = ctx.probe || modus === "probe";
  const art = probe ? "probe" : "scharf";
  if (pflegeTag(ctx.vault)[art] === ctx.heute) return { lauf: false, grund: "heute-schon" };
  if (!nimmIngestSperre(ctx.vault)) {
    notiere(ctx, { id: "b3", stufe: "hinweis", ziel: "", grund: "Pflege: /ingest läuft gerade — Pflege beim nächsten Lauf" });
    ctx.pflegeUebersprungen = "ingest-laeuft";
    if (!probe) { try { merkePflegeTag(ctx.vault, "nachlauf", ctx.heute); } catch { /* der Nachlauf ist nur eine Zugabe */ } }   // Tages-Riegel bleibt frei; der nächste Takt darf B3 allein nachholen
    return { lauf: false, grund: "ingest-laeuft" };
  }
  const alt = { probe: ctx.probe, ohneKi: ctx.ohneKi, grund: ctx.grund, kiFehlerFolge: ctx.kiFehlerFolge };
  const lernen = lernmodusAktiv(ctx);
  const bericht = (ctx.pflegeBericht = { modus: art, posten: [], merge: null, ohneKi: false, budget: null, lernmodus: lernen });
  const kopien = [];
  try {
    merkePflegeTag(ctx.vault, art, ctx.heute);                    // VOR dem ersten KI-Aufruf: kein zweiter Lauf heute
    ctx.probe = probe;
    ctx.kiFehlerFolge = 0;
    const nurOhneKi = !!ctx.ohneKi;
    const stand = () => leseStand(ctx.vault);
    // Durchgang 1: gemergt. Ohne Lernmodus laufen alle Schritte; im Lernmodus Entscheidungen + freigegebene Einheiten.
    const kopie = legePflegeKopieAn(ctx.vault, ctx.lauf);
    kopien.push(kopie);
    if (lernen && !probe) {                                       // alte oder beschädigte Freigaben (ohne gültigen Patch) gelten nicht: neu vorlegen, nie neu rechnen
      for (const [k, e] of Object.entries(stand().lern || {})) if (e?.status === "freigegeben" && !ladePatch(ctx.vault, e)) loescheLern(ctx, k);
    }
    const freigaben = lernen ? { modus: "freigaben", nurKi: false,
      nimm: (k, sha) => !!freigabePatch(ctx.vault, k, sha, stand()),
      patch: (k, sha) => freigabePatch(ctx.vault, k, sha, stand()) } : null;
    // Offene Sicherheits-Rückfrage (typ integritaet): im Lernmodus werden keine Freigaben angewendet, bis der User sie beantwortet hat — wer eine
    // Integritätsverletzung noch nicht geprüft hat, soll keine weiteren Änderungen im Wiki bekommen.
    if (freigaben && listeRueckfragen(ctx.vault).some((r) => r.typ === "integritaet" && !r.antwort)) {
      ctx.pflegeFreigabenAus = "integritaet";
      notiere(ctx, { id: "b3", stufe: "hinweis", ziel: "", grund: "Pflege: Freigaben nicht angewendet — eine Sicherheits-Rückfrage ist noch offen" });
    } else await laufeSchritte(ctx, kopie, schritte, { bericht, nurOhneKi, lern: freigaben });
    const gut = bericht.posten.filter((p) => p.erg.ok);
    let commits = new Map();
    if (gut.length) {
      const m = uebernehmePflege(ctx, kopie);
      bericht.merge = m.ok ? "ok" : m.grund;
      if (m.ok) commits = m.commits;
    }
    for (const p of bericht.posten) {
      protokolliere(ctx, p, commits, bericht.merge);
      if (!lernen || !p.lern?.schluessel || probe) continue;
      // Freigegebene Einheit: erledigt (gemergt) oder gescheitert — in beiden Fällen nicht endlos wiederholen.
      if (commits.get(p.erg.id)) loescheLern(ctx, p.lern.schluessel);
      else if (!p.erg.ok && p.erg.grund === PATCH_FEHLT) loescheLern(ctx, p.lern.schluessel);   // Freigabe verfällt → Durchgang 2 legt die Einheit neu vor
      else if (!p.erg.ok && !KEIN_VERSUCH.has(p.erg.grund)) setzeLern(ctx, p.lern.schluessel, { sha: p.lern.sha, status: "gescheitert" });
    }
    // Durchgang 2 (nur Lernmodus): Vorschläge als Rückfragen; diese Arbeitskopie wird nie gemergt.
    if (lernen && !nurOhneKi && !ctx.pflegeStopp) {
      const vorher = bericht.posten.length;
      const kopie2 = legePflegeKopieAn(ctx.vault, `${ctx.lauf}-v`);
      kopien.push(kopie2);
      await laufeSchritte(ctx, kopie2, schritte, { bericht, nurOhneKi: false, lern: { modus: "vorlegen", nurKi: true,
        nimm: (k, sha) => { const e = lernEintrag(ctx.vault, k, stand()); return !e || e.sha !== sha; } } });
      for (const p of bericht.posten.slice(vorher)) {
        const e = p.erg, basis = { id: e.id, art: e.art, titel: e.titel, ziel: p.ziel, ...(p.aktion || {}) };
        if (!e.ok) {
          const befund = (e.befunde || []).slice(0, 2).map((b) => `${b.regel}: ${b.meldung}`).join(" | ").slice(0, 300);
          notiere(ctx, { ...basis, stufe: "pflege-verworfen", grund: e.grund, ...(befund ? { befund } : {}) });
          continue;
        }
        let v;
        try { v = legeVorschlag(ctx, kopie2, p); } catch (x) { v = { ok: false, grund: `rueckfrage: ${kurz(x?.message, 80)}` }; }
        p.vorschlag = v;
        if (!v.ok) { p.erg = { ...e, ok: false, grund: v.grund, befunde: [] }; notiere(ctx, { ...basis, stufe: "pflege-verworfen", grund: v.grund }); continue; }
        notiere(ctx, { ...basis, stufe: "pflege-vorschlag", seiten: e.seiten, kopieCommit: e.commit, ...(v.rueckfrage ? { rueckfrage: v.rueckfrage } : { probe: true }) });
      }
    }
    bericht.ohneKi = ctx.ohneKi && !alt.ohneKi;
    const gutGesamt = bericht.posten.filter((p) => p.erg.ok && !p.vorlegen).length;
    return { lauf: true, gut: gutGesamt, verworfen: bericht.posten.filter((p) => !p.erg.ok).length,
      ...(bericht.posten.some((p) => p.vorschlag?.ok) ? { vorschlaege: bericht.posten.filter((p) => p.vorschlag?.ok).length } : {}) };
  } catch (e) {
    notiere(ctx, { id: "b3", stufe: "fehler", ziel: "", grund: `Pflege: ${kurz(e?.message, 160)}` });
    return { lauf: false, grund: "fehler" };
  } finally {
    bericht.budget = pflegeBudget(ctx).stand();
    for (const k of kopien) verwerfeArbeitskopie(ctx.vault, k);
    gibIngestSperreFrei(ctx.vault);
    Object.assign(ctx, alt);                                      // B3 macht den Tageslauf nie „ohne KI", „teilweise" oder zur Probe
    ctx.pflegeLern = undefined;
  }
}

const UEBERSPRUNGEN_TEXT = {
  "ingest-laeuft": "- Pflege übersprungen: /ingest lief gerade — Nachlauf beim nächsten stündlichen Takt",
  config: "- Pflege übersprungen: Einstellungen nicht lesbar (Themen-Ausschluss) — heute keine Pflege",
};
export function pflegeBerichtZeilen(ctx) {
  const b = ctx.pflegeBericht, info = ctx.pflegeInfo || {}, z = [];
  if (UEBERSPRUNGEN_TEXT[ctx.pflegeUebersprungen]) z.push(UEBERSPRUNGEN_TEXT[ctx.pflegeUebersprungen]);
  if (ctx.pflegeFreigabenAus === "integritaet") z.push("- Freigaben nicht angewendet: eine Sicherheits-Rückfrage (Kopf „Sicherheit“) ist noch offen — erst nachsehen und als „geprüft“ abhaken, dann werden freigegebene Vorschläge übernommen");
  if (b) {
    const st = b.budget || { sonnet: 0, haiku: 0 };
    z.push(`- ${b.modus === "probe" ? "Probe (nichts übernommen)" : "scharf"}${b.lernmodus ? " · Lernmodus (nichts Inhaltliches ohne deine Freigabe)" : ""} · Sonnet ${st.sonnet}/${PFLEGE_BUDGET.sonnet} · Haiku ${st.haiku}/${PFLEGE_BUDGET.haiku}`
      + `${b.merge && !["ok", "probe"].includes(b.merge) ? ` · nicht übernommen (${b.merge})` : ""}${b.ohneKi ? " · KI nicht erreichbar" : ""}`);
    for (const p of b.posten) {
      const e = p.erg;
      if (e.ok && p.vorlegen) {
        z.push(`- Vorschlag als Rückfrage${p.vorschlag?.rueckfrage ? "" : " (Probe)"}: ${ART_KURZ[e.art] || e.art} ${e.titel} → ${p.ziel} [${e.id}]`);
      } else if (e.ok) {
        const a = ctx.aktionen.find((x) => x.stufe === "pflege" && x.id === e.id);
        z.push(`- ${ART_TEXT[e.art] || e.art}: ${e.titel} → ${p.ziel}${a?.commit ? ` (${String(a.commit).slice(0, 8)})` : ""} [${e.id}]`);
        if (e.info?.verliererNoch) z.push(`  - Hinweis: die verworfene Aussage steht noch an anderer Stelle auf ${p.ziel} — bitte prüfen`);
        if (a?.hinweis) z.push(`  - Hinweis: ${a.hinweis}`);
      } else {
        const befund = (e.befunde || [])[0];
        z.push(`- nicht übernommen — ${ART_KURZ[e.art] || e.art} ${e.titel}: ${GRUND_TEXT[e.grund] || e.grund}${befund ? ` (${kurz(befund.meldung, 120)})` : ""}`);
      }
    }
  }
  const pa = ctx.pflegeAufrufe, pt = ctx.pflegeTokens;
  if (pa && (pa.sonnet || pa.haiku)) {
    z.push(`- KI-Aufrufe B3: Sonnet ${pa.sonnet} · Haiku ${pa.haiku}${pt ? ` · Tokens Eingabe ${pt.ein} / Cache-Lesen ${pt.cache} / Ausgabe ${pt.aus}` : ""} (getrennt von den B2-Zählern oben)`);
  }
  const ib = info.inbox;
  if (ib && (ib.wartend || ib.webWartet || ib.gesperrt || ib.zuGross?.length)) {
    z.push(`- Inbox: ${ib.wartend} Notiz(en) warten${ib.alt ? `, davon ${ib.alt} länger als 7 Tage` : ""}${ib.webWartet ? ` · ${ib.webWartet} Web-Notiz(en) warten (Autostufe)` : ""}`
      + `${ib.gesperrt ? ` · ${ib.gesperrt} gesperrt — bitte selbst einarbeiten (/ingest)` : ""}${ib.zuGross?.length ? ` · zu groß für die Pflege: ${ib.zuGross.slice(0, 3).join(", ")}` : ""}`);
  }
  if (info.zeitbudget) z.push(`- Pflege: Zeitbudget (${PFLEGE_BUDGET.minuten} min) aufgebraucht — der Rest wartet bis morgen`);
  if (info.kopieGesperrt) z.push(`- Themen-Ausschluss: ${info.kopieGesperrt} Datei(en) vor dem KI-Lauf aus der Arbeitskopie entfernt (nur Kopie, danach wiederhergestellt)`);
  const th = Object.entries(info.thema || {}).filter(([, n]) => n);
  if (th.length) z.push(`- Themen-Ausschluss: ${th.reduce((s, [, n]) => s + n, 0)} Notiz(en)/Seite(n)/Fakt(en) nicht an die KI gegeben (${th.map(([g, n]) => `${g} ${n}`).join(" · ")})`);
  for (const s of info.entscheidungen?.kritisch || []) z.push(`- Entscheidung auf ${s} (kritische Seite) liegt für /ingest bereit`);
  if (info.k7) {
    const archiv = ctx.aktionen.filter((x) => x.stufe === "archiv-kandidat").slice(0, 5).map((x) => x.ziel);
    z.push(`- Prüfen nach Nutzung: ${info.k7.rueckfragen} neue Rückfrage(n) „Stimmt das noch?"`
      + `${archiv.length ? ` · Archiv-Kandidaten (nie genutzt, über 180 Tage — nichts automatisch): ${archiv.join(", ")}` : ""}`);
  }
  const driftVorschlaege = ctx.aktionen.filter((x) => x.stufe === "hinweis" && String(x.grund).startsWith("drift:")).length;
  if (info.drift || driftVorschlaege) {
    z.push(`- Drift: ${info.drift || 0} Erwähnung(en) ausgemusterter Begriffe im Wiki (\`brain lint\` zeigt, wo)${driftVorschlaege ? ` · ${driftVorschlaege} Vorschlag/Vorschläge mit altem Begriff` : ""}`);
  }
  if (!z.length) return [];
  const rueck = b?.modus === "scharf" && b.posten.some((p) => p.erg.ok && !p.vorlegen)
    ? [`- Rückgängig: \`brain zurueck ${ctx.lauf}\` (alle Änderungen dieses Laufs) oder \`brain zurueck <id>\``] : [];
  return ["", "### Pflege (B3)", ...z, ...rueck];
}
