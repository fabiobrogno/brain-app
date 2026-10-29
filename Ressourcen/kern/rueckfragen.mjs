#!/usr/bin/env node
// rueckfragen.mjs — Rückfragen (Spec §5.3): Ablage <inbox>/_rueckfragen/<id>.md (betroffene Vorschläge daneben unter
// _rueckfragen/vorschlaege/), feste Antworten je Typ, Deckel 10 offene (Rest wartet und wird nicht gezeigt), Reihenfolge,
// Verfall (web nach 60 Tagen ins Archiv; heikel 60 Tage nach der ersten ANZEIGE — was nie gezeigt wurde, verfällt nicht), Wochen-Stichprobe (außerhalb des Deckels; Stichproben der Einschwingphase zählen
// mit und gehen vor), offene Konflikt-Kästen.
// Antworten werden hier nur gespeichert; angewendet werden sie vom Tageslauf (tageslauf/antworten.mjs).
// CLI (Skill „rueckfragen", später die App):
//   node rueckfragen.mjs <vault> liste                       → JSON { fragen: [...], wartend }
//   node rueckfragen.mjs <vault> antwort <id> <wahl> [notiz]  → Exit 0 | 1 (gibt es nicht) | 2 (ungültig) | 64
import { readdirSync, readFileSync, writeFileSync, mkdirSync, lstatSync, unlinkSync, realpathSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ordner, vaultPfadOderEnde } from "./pfade.mjs";
import { findeSecrets } from "./secrets-muster.mjs";
import { walk } from "./vault-dateien.mjs";
import { istWikiSeite } from "./wiki-pfade.mjs";
import { konflikteIn, listeEntscheidungen, entscheidungFuer } from "./entscheidungen.mjs";
import { leseFm, schreibeFm, verschiebeVorschlag, ladeVorschlag, aussortieren, UNTERORDNER } from "./tageslauf/bestand.mjs";
import { notiere, autoUebernahmen, hinweisNutzung } from "./tageslauf/protokoll.mjs";

export const DECKEL = 10, VERFALL_TAGE = 60, MAX_NOTIZ = 300;
// Einschwingphase: Stichproben mit `quelle: einschwingen` (tageslauf/einschwingen.mjs) haben dieselben Antworten wie die Wochen-Stichproben,
// zählen aber in den Deckel und stehen in der Reihenfolge ganz vorn (EINSCHWING_RANG); die Wochen-Stichproben stehen weiter außerhalb.
export const EINSCHWING_QUELLE = "einschwingen";
const EINSCHWING_RANG = 0.5;
// Rückweg aus der Autostufe „aus“ (tageslauf/autostufe.mjs): Kandidaten, die bei „normal“ 🟢 wären und nur wegen „aus“ zur Rückfrage wurden, tragen quelle
// autostufe-rueckfrage (Typ heikel, grund autostufe-aus). Deine Antwort zählt als Prüfung (übernehmen = richtig, verwerfen = falsch) und bringt die Automatik zurück.
// Sie stehen NACH den übrigen heikel-Rückfragen (und den kritisch-Prüfungen): bei „aus“ kann es Dutzende markierte geben — vor den echten heikel-Fragen würden sie den
// Deckel (10) füllen und Geld-/Personen-/Kunden-Fragen unsichtbar machen. Hinter ihnen zeigt der Deckel die echten heikel zuerst und füllt mit markierten auf; das ist für
// den Rückweg genug (er braucht Antworten, keine Reihenfolge). Ältere Rückfragen mit grund autostufe-aus (vor der Markierung) gelten ebenso.
export const AUTOSTUFE_QUELLE = "autostufe-rueckfrage";
export const AUTOSTUFE_RANG = 4.5;   // zwischen heikel (4) und veraltet (5)
const TAG = 86400e3;
const ID = /^rf-[a-z0-9-]{1,80}$/;
const fehlerMit = (code, meldung) => Object.assign(new Error(meldung), { code });
const w = (label, wirkung) => ({ label, wirkung });
export const TYPEN = {
  zweifel: { rang: 1, kopf: "Zweifel", wahlen: { stimmt: w("Seite stimmt", "Der Zweifel wird entfernt."), falsch: w("Seite ist falsch", "Die Seite bleibt prüfbedürftig — sag in der Notiz, welche Stelle.") } },
  widerspruch: { rang: 2, kopf: "Widerspruch", wahlen: { a: w("A gilt", "Die Wiki-Zeile bleibt, der neue Fakt wird verworfen."), b: w("B gilt", "Die Wiki-Zeile wird durchgestrichen, der neue Fakt steht darunter."), beide: w("Beide", "Beides stimmt, in verschiedenem Zusammenhang — der neue Fakt kommt dazu."), "weiss-nicht": w("Weiß nicht", "Nichts ändert sich, der neue Fakt wird aussortiert.") } },
  konflikt: { rang: 2, kopf: "Konflikt", wahlen: { a: w("A", "A gilt."), b: w("B", "B gilt."), beide: w("Beide", "Beide gelten, in verschiedenen Fällen."), spaeter: w("Später", "Bleibt offen.") } },
  lektion: { rang: 3, kopf: "Lektion", wahlen: { aktivieren: w("Aktivieren", "Die Regel gilt ab jetzt."), verwerfen: w("Verwerfen", "Die Regel wird verworfen."), aendern: w("Ändern", "Die Regel gilt in deiner Formulierung (Text als Notiz).") } },
  heikel: { rang: 4, kopf: "Prüfen", wahlen: { uebernehmen: w("Übernehmen", "Der Fakt kommt mit Beleg ins Wiki."), verwerfen: w("Verwerfen", "Der Fakt wird verworfen.") } },
  veraltet: { rang: 5, kopf: "Veraltet", wahlen: { "stimmt-noch": w("Stimmt noch", "Der Stand der Seite wird auf heute gesetzt."), ueberholt: w("Ist überholt", "Die Seite wird als prüfbedürftig markiert.") } },
  web: { rang: 6, kopf: "Web-Quelle", wahlen: { uebernehmen: w("Übernehmen", "Der Fakt aus dem Web kommt mit Beleg ins Wiki."), verwerfen: w("Verwerfen", "Der Fakt wird verworfen.") } },
  // Traum (tageslauf/traum.mjs): Vorschlag zur Pflege des Claude-Gedächtnisses (Patch gegen die Gedächtnis-Wurzel). „Übernehmen“ gilt genau dem gezeigten Diff.
  traum: { rang: 3.5, kopf: "Gedächtnis", wahlen: { uebernehmen: w("Übernehmen", "Genau diese Änderung am Gedächtnis wird übernommen."), verwerfen: w("Verwerfen", "Der Vorschlag wird verworfen.") } },
  integritaet: { rang: 0, kopf: "Sicherheit", wahlen: { geprueft: w("Geprüft", "Ich habe nachgesehen (git status, Hooks, .git/config) — die Warnung verschwindet."), spaeter: w("Später", "Die Warnung bleibt stehen, bis du sie als geprüft abhakst.") } },
  stichprobe: { rang: 0, kopf: "Stichprobe", wahlen: { stimmt: w("Stimmt", "Die automatische Übernahme war richtig."), "stimmt-nicht": w("Stimmt nicht", "Die Übernahme wird zurückgenommen und zählt als Fehler.") } },
};
export const rueckfrageOrdner = (vault) => join(vault, ordner(vault).inbox, "_rueckfragen");

// protokoll (optional): weitere Felder der Aktion im Aktionsprotokoll (z. B. hinweise: R3/R4/R5-Gründe einer markierten Rückfrage, damit der Bericht sie zählt) — nie in der Rückfrage-Datei.
export function legeRueckfrageAn(ctx, { typ, frage, beschreibung = "", vorschlaege = [], seite = "", zeile = "", grund = "", felder = {}, protokoll = {} }) {
  if (!TYPEN[typ]) throw new Error("Unbekannter Rückfrage-Typ");
  const id = `rf-${ctx.lauf.slice(0, 8)}-${typ}-${randomBytes(3).toString("hex")}`;
  notiere(ctx, { id: vorschlaege[0]?.id || id, stufe: "rueckfrage", typ, ziel: seite, grund: grund || typ, titel: vorschlaege[0]?.titel || frage, rueckfrage: ctx.probe ? null : id, ...protokoll });
  if (ctx.probe) return null;
  for (const v of vorschlaege) verschiebeVorschlag(ctx, v, `${ordner(ctx.vault).inbox}/${UNTERORDNER.rueckfrage}`);
  const fm = { typ: "rueckfrage", art: typ, vorschlaege: vorschlaege.map((v) => v.id), seite, zeile, grund,
    erstellt: new Date(ctx.jetzt).toISOString().slice(0, 19) + "Z", ...felder, antwort: "", notiz: "", beantwortet: "" };
  mkdirSync(rueckfrageOrdner(ctx.vault), { recursive: true });
  writeFileSync(join(rueckfrageOrdner(ctx.vault), `${id}.md`), schreibeFm(fm, `\n# ${String(frage).replace(/\s+/g, " ").trim()}\n\n${beschreibung}\n`), { flag: "wx" });
  return id;
}

export function listeRueckfragen(vault) {
  const dir = rueckfrageOrdner(vault);
  let namen = [];
  try { if (lstatSync(dir).isSymbolicLink()) return []; namen = readdirSync(dir); } catch { return []; }
  const out = [];
  for (const n of namen.sort()) {
    const id = n.endsWith(".md") ? n.slice(0, -3) : "";
    if (!ID.test(id)) continue;
    const datei = join(dir, n);
    try {
      if (!lstatSync(datei).isFile()) continue;
      const { fm, rumpf } = leseFm(readFileSync(datei, "utf8"));
      if (fm.typ !== "rueckfrage" || !Object.hasOwn(TYPEN, fm.art)) continue;
      const kopf = rumpf.match(/^# (.+)$/m);
      const s = (x) => (x === undefined || x === null ? "" : String(x));
      out.push({ id, datei, typ: fm.art, frage: kopf ? kopf[1].trim() : "", beschreibung: rumpf.replace(/^\s*# .+\n?/, "").trim(),
        vorschlaege: Array.isArray(fm.vorschlaege) ? fm.vorschlaege.map(String) : [], seite: s(fm.seite), zeile: s(fm.zeile), grund: s(fm.grund),
        erstellt: s(fm.erstellt), quelle: s(fm.quelle), antwort: s(fm.antwort), notiz: s(fm.notiz), beantwortet: s(fm.beantwortet), fm, rumpf });
    } catch { /* kaputt → überspringen */ }
  }
  return out;
}

export const istEinschwingStichprobe = (r) => r.typ === "stichprobe" && r.quelle === EINSCHWING_QUELLE;
export const istAutostufeRueckfrage = (r) => r.typ === "heikel" && (r.quelle === AUTOSTUFE_QUELLE || r.grund === "autostufe-aus");
const rang = (r) => (istEinschwingStichprobe(r) ? EINSCHWING_RANG : istAutostufeRueckfrage(r) ? AUTOSTUFE_RANG : TYPEN[r.typ].rang);

// Reihenfolge (§5.3): [Einschwing-Stichprobe] > zweifel > widerspruch/konflikt (je oft genutzter Seite, Hinweis-Log) > lektion > heikel > [Autostufe-Rückweg] > veraltet > web;
// innerhalb gleich: älteste zuerst. nutzung: Map<seite, [ms…]> aus hinweisNutzung.
export function sortiere(liste, nutzung = new Map()) {
  const n = (r) => (nutzung.get(r.seite) || []).length;
  return [...liste].sort((a, b) => rang(a) - rang(b)
    || (rang(a) === 2 ? n(b) - n(a) : 0) || a.erstellt.localeCompare(b.erstellt) || a.id.localeCompare(b.id));
}
export function sichtbare(vault, { jetzt = Date.now(), nutzung = hinweisNutzung(vault, { seitMs: jetzt - 90 * TAG }) } = {}) {
  const tag = new Date(jetzt).toISOString().slice(0, 10);
  // ruhen_bis: „später“ bei einem Konflikt (Task 10) — bis dahin nicht zeigen, aber auch nicht neu anlegen.
  const offen = listeRueckfragen(vault).filter((r) => !r.antwort && !(String(r.fm.ruhen_bis || "") > tag));
  // Wochen-Stichproben stehen außerhalb des Deckels; Einschwing-Stichproben (quelle einschwingen) zählen mit und gehen vor.
  const normal = sortiere(offen.filter((r) => r.typ !== "stichprobe" || istEinschwingStichprobe(r)), nutzung);
  return { fragen: [...normal.slice(0, DECKEL), ...offen.filter((r) => r.typ === "stichprobe" && !istEinschwingStichprobe(r))], wartend: Math.max(0, normal.length - DECKEL) };
}

export function beantworte(vault, id, wahl, notiz = "", jetzt = new Date()) {
  if (!ID.test(String(id))) throw fehlerMit(400, "Ungültige Rückfrage-ID.");
  const r = listeRueckfragen(vault).find((x) => x.id === id);
  if (!r) throw fehlerMit(404, "Diese Rückfrage gibt es nicht (mehr).");
  if (!Object.hasOwn(TYPEN[r.typ].wahlen, wahl)) throw fehlerMit(400, `Diese Antwort passt nicht. Möglich: ${Object.keys(TYPEN[r.typ].wahlen).join(", ")}`);
  const n = String(notiz ?? "").replace(/\s+/g, " ").trim();
  if (n.length > MAX_NOTIZ) throw fehlerMit(400, `Notiz ist zu lang (höchstens ${MAX_NOTIZ} Zeichen).`);
  if (findeSecrets(n).length) throw fehlerMit(400, "Die Notiz enthält vermutlich Zugangsdaten — nicht gespeichert.");
  if (r.typ === "lektion" && wahl === "aendern" && !n) throw fehlerMit(400, "Zum Ändern bitte die neue Regel als Notiz mitgeben.");
  writeFileSync(r.datei, schreibeFm({ ...r.fm, antwort: wahl, notiz: n, beantwortet: jetzt.toISOString().slice(0, 19) + "Z" }, r.rumpf));
  return { ok: true, id, wahl };
}

export function archiviereRueckfrage(ctx, r, unterordner = "rueckfragen-erledigt") {
  if (ctx.probe) return null;
  const dir = join(ctx.vault, ordner(ctx.vault).archiv, unterordner);
  mkdirSync(dir, { recursive: true });
  const inhalt = readFileSync(r.datei);
  for (let n = 1; n <= 99; n++) {
    const ziel = join(dir, n === 1 ? `${r.id}.md` : `${r.id}-${n}.md`);
    try { writeFileSync(ziel, inhalt, { flag: "wx" }); } catch (e) { if (e.code === "EEXIST") continue; throw e; }
    unlinkSync(r.datei);
    return ziel;
  }
  return null;
}

// Anzeige-Merkmal: Wer eine Rückfrage zum ERSTEN Mal zeigt (CLI liste = Skill „rueckfragen“), trägt `gezeigt: <ISO-Zeit>` in ihren Kopf ein; die erste Anzeige bleibt stehen.
// Der Deckel zeigt nur 10 — alles darüber wartet unsichtbar. Darum läuft die Verfallsfrist der heikel-Rückfragen erst ab dieser Anzeige (verfallen()).
// → Anzahl neu markierter. Wirft nie (eine nicht schreibbare Rückfrage bleibt einfach ohne Merkmal und verfällt dann auch nicht).
export function markiereGezeigt(vault, fragen, jetzt = Date.now()) {
  if (!Array.isArray(fragen)) return 0;
  const zeit = new Date(jetzt).toISOString().slice(0, 19) + "Z";
  let n = 0;
  for (const r of fragen) {
    try {
      if (!r || r.antwort || r.fm?.gezeigt) continue;
      const { fm, rumpf } = leseFm(readFileSync(r.datei, "utf8"));              // frisch lesen: die Antwort könnte inzwischen da sein
      if (fm.typ !== "rueckfrage" || fm.antwort || fm.gezeigt) continue;
      writeFileSync(r.datei, schreibeFm({ ...fm, gezeigt: zeit }, rumpf));
      n++;
    } catch { /* ohne Merkmal: verfällt dann nicht — der sichere Fehler */ }
  }
  return n;
}

// Verfall: web nach 60 Tagen ab Erstellung. heikel (auch kritisch-Prüfungen und markierte Autostufe-Rückfragen) nach 60 Tagen ab der ERSTEN ANZEIGE (gezeigt) — eine nie
// angezeigte heikel-Rückfrage (Deckel!) verfällt nicht unbesehen, Fakt und Beleg bleiben im Wartezustand, bis jemand sie gesehen hat. (web ist Web-Quelle ohne Personenbezug
// und bleibt bei der festen Frist, sonst wüchse die Liste unbegrenzt.)
export function verfallen(ctx) {
  let n = 0;
  for (const r of listeRueckfragen(ctx.vault)) {
    if (r.antwort || (r.typ !== "web" && r.typ !== "heikel")) continue;
    const ab = r.typ === "heikel" ? Date.parse(r.fm.gezeigt) : Date.parse(r.erstellt) || ctx.jetzt;
    if (!Number.isFinite(ab) || ctx.jetzt - ab <= VERFALL_TAGE * TAG) continue;
    for (const vid of r.vorschlaege) { const v = ladeVorschlag(ctx.vault, UNTERORDNER.rueckfrage, vid); if (v) aussortieren(ctx, v, "verfallen"); }
    archiviereRueckfrage(ctx, r, "rueckfragen-verfallen");
    notiere(ctx, { id: r.id, stufe: "aussortieren", grund: "rueckfrage-verfallen", ziel: r.seite, titel: r.frage });
    n++;
  }
  return n;
}

// Stichprobe (§5.3): je Woche `jeWoche` (2, eng 4) aus den automatischen Übernahmen der letzten 30 Tage, ungeprüfte zuerst.
// Offene Einschwing-Stichproben verbrauchen das Wochenkontingent nicht (sie zählen hier nicht mit), ihre Übernahmen werden aber nicht doppelt gefragt.
export function stichprobenAuffuellen(ctx, { aktionen = [], pruefungen = [], jeWoche = 2, zufall = Math.random } = {}) {
  const alle = listeRueckfragen(ctx.vault).filter((r) => r.typ === "stichprobe");
  let fehlt = jeWoche - alle.filter((r) => !istEinschwingStichprobe(r) && ctx.jetzt - (Date.parse(r.erstellt) || 0) < 7 * TAG).length;
  if (fehlt <= 0) return 0;
  const offen = new Set(alle.map((r) => String(r.fm.aktion || "")));
  const geprueft = new Set(pruefungen.filter((p) => p.art === "stichprobe").map((p) => p.aktion));
  // Schon als „stimmt nicht“ beurteilt (die Rücknahme kann noch offen sein, ruecknahmen.mjs): nicht noch einmal fragen.
  const falsch = new Set(pruefungen.filter((p) => p.art === "stichprobe" && p.fehler).map((p) => p.aktion));
  const kand = autoUebernahmen(aktionen).filter((a) => !offen.has(a.id) && !falsch.has(a.id) && ctx.jetzt - Date.parse(a.zeit) <= 30 * TAG);
  let n = 0;
  for (const pool of [kand.filter((a) => !geprueft.has(a.id)), kand.filter((a) => geprueft.has(a.id))]) {
    while (fehlt > 0 && pool.length) {
      const a = pool.splice(Math.floor(zufall() * pool.length), 1)[0];
      legeRueckfrageAn(ctx, { typ: "stichprobe", frage: `Stimmt das? ${a.titel || a.id}`, seite: a.ziel || "",
        beschreibung: `Automatisch übernommen am ${String(a.zeit).slice(0, 10)} auf ${a.ziel}.\nZitat: „${a.zitat || ""}“\nQuelle: ${a.fundstelle || "-"}`,
        felder: { aktion: a.id, commit: a.commit } });
      fehlt--; n++;
    }
  }
  return n;
}

// Offene [!KONFLIKT]-Kästen ohne Entscheidung und ohne offene Rückfrage (gleicher Fingerabdruck) → je Kasten eine Rückfrage.
export function konfliktRueckfragen(ctx) {
  const wiki = ordner(ctx.vault).wiki;
  const entscheidungen = listeEntscheidungen(ctx.vault);
  const schon = new Set(listeRueckfragen(ctx.vault).filter((r) => r.typ === "konflikt").map((r) => String(r.fm.fp || "")));
  let n = 0;
  for (const f of walk(ctx.vault)) {
    const rel = f.rel.split("\\").join("/");
    if (!istWikiSeite(rel, wiki)) continue;
    let text;
    try { text = readFileSync(f.full, "utf8"); } catch { continue; }
    if (!/\[!KONFLIKT\]/i.test(text)) continue;
    for (const k of konflikteIn(text)) {
      if (schon.has(k.fp) || entscheidungFuer(entscheidungen, rel, k)) continue;
      legeRueckfrageAn(ctx, { typ: "konflikt", frage: `Was gilt auf ${rel.split("/").pop()}?`, seite: rel, grund: "konflikt",
        beschreibung: `A: „${k.a.text}“ (Quelle: ${k.a.quelle || "-"})\nB: „${k.b.text}“ (Quelle: ${k.b.quelle || "-"})`, felder: { nr: k.nr, fp: k.fp } });
      schon.add(k.fp); n++;
    }
  }
  return n;
}

// Pflege-Vorschläge (B3, Lernmodus): Rückfrage typ heikel mit gespeichertem Patch (fm.pflege, b3.mjs). „Übernehmen“ wendet GENAU den gezeigten
// Diff an — also darf er dem User nie gekürzt oder zusammengefasst vorgelegt werden. Darum liefert fuerSkill für sie den vollen Text. Passt er nicht
// in die Anzeige-Grenze (ANZEIGE_MAX_PFLEGE, größer als b3.MAX_DIFF_ZEICHEN + Kopf/Fuß — b3 legt längere gar nicht erst vor), gibt es keine
// Optionen: lieber nicht beantwortbar als gekürzt beantwortet.
export const ANZEIGE_MAX_PFLEGE = 12000;
export const istPflegeVorschlag = (r) => (r?.typ === "heikel" && !!r.fm?.pflege) || (r?.typ === "traum" && !!r.fm?.traum);
const PFLEGE_WIRKUNG = { uebernehmen: "Genau diese Änderung wird übernommen.", verwerfen: "Der Vorschlag wird verworfen." };

// Der Diff als ```diff-Block (Obsidian zeigt `%%…%%` und `<!-- -->` im Block wörtlich, sonst blieben sie unsichtbar). Der Zaun ist länger als jede
// Backtick-Folge im Diff, damit nichts aus dem Block ausbricht.
export function diffCodeblock(diff) {
  const laengste = Math.max(0, ...[...String(diff).matchAll(/`+/g)].map((m) => m[0].length));
  const zaun = "`".repeat(Math.max(3, laengste + 1));
  return `${zaun}diff\n${diff}\n${zaun}`;
}

// beschreibung bis 1500 Zeichen: markierte Rückfragen des Lernmodus tragen Zitat, Zielseite, Richter-Begründung und Hinweise (R3/R4/R5) — das Ende darf nicht abgeschnitten werden.
export function fuerSkill(r) {
  const t = TYPEN[r.typ];
  const optionen = Object.entries(t.wahlen).map(([wahl, o]) => ({ wahl, label: o.label, wirkung: o.wirkung }));
  const kopf = { id: r.id, typ: r.typ, header: t.kopf, frage: r.frage, seite: r.seite };
  if (!istPflegeVorschlag(r)) return { ...kopf, beschreibung: r.beschreibung.slice(0, 1500), optionen };
  if (r.beschreibung.length > ANZEIGE_MAX_PFLEGE) {
    return { ...kopf, pflege: true, vollstaendig: false, beschreibung: "", datei: r.datei, optionen: [],
      hinweis: "Der Vorschlag ist zu lang, um ihn vollständig hier zu zeigen — bitte die Datei öffnen und prüfen. Nicht beantworten lassen." };
  }
  return { ...kopf, pflege: true, vollstaendig: true, beschreibung: r.beschreibung,
    optionen: optionen.map((o) => (PFLEGE_WIRKUNG[o.wahl] ? { ...o, wirkung: PFLEGE_WIRKUNG[o.wahl] } : o)) };
}

const selbst = fileURLToPath(import.meta.url);
let aufruf = "";
try { aufruf = realpathSync(process.argv[1] || ""); } catch {}
if (aufruf && aufruf === realpathSync(selbst)) {
  // brain.mjs ruft mit dem Vault als erstem Argument auf (<vault> <befehl> …); direkt geht auch <befehl> … mit --vault/BRAIN_VAULT/aktivem App-Vault.
  const a0 = process.argv.slice(2);
  const [vault, befehl = "liste", ...rest] = a0.length && isAbsolute(a0[0]) ? a0 : [vaultPfadOderEnde([]), ...a0];
  try {
    if (befehl === "liste") {
      const s = sichtbare(vault);
      markiereGezeigt(vault, s.fragen);                                          // erste Anzeige festhalten (Verfallsfrist der heikel-Rückfragen)
      console.log(JSON.stringify({ fragen: s.fragen.map(fuerSkill), wartend: s.wartend }));
    } else if (befehl === "antwort" && rest.length >= 2) {
      const [id, wahl, ...notiz] = rest;
      beantworte(vault, id, wahl, notiz.join(" "));
      console.log("Antwort gespeichert — sie wird beim nächsten Tageslauf angewendet.");
    } else {
      console.error("Nutzung: brain rueckfragen [liste | antwort <id> <wahl> [notiz]]");
      process.exitCode = 64;
    }
  } catch (e) {
    console.error(String(e?.message || e).split("\n")[0]);
    process.exitCode = e?.code === 404 ? 1 : 2;
  }
}
