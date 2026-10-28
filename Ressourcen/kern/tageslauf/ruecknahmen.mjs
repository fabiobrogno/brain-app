// .tools/tageslauf/ruecknahmen.mjs — offene Rücknahmen (B2, Folgepunkt N6). Antwortet der Nutzer auf eine Stichprobe „stimmt nicht“, wird die automatische
// Übernahme zurückgenommen (zurueck.mjs). Scheitert das (ungespeicherte Änderung an der Seite, Brain nicht auf main, Ingest läuft, von Hand verändert …),
// darf der falsche Fakt nicht still auf der Seite bleiben, obwohl die Rückfrage längst archiviert ist. Darum:
//  - Schon beim Beantworten wird die Rücknahme in .logs/tageslauf/ruecknahmen-offen.json festgehalten (merkeRuecknahme, atomar, noch vor der Prüfung/Archivierung —
//    auch ein Absturz zwischen Antwort und Rücknahme verliert nichts).
//  - In JEDEM Lauf (auch „nur Antworten“) wird jede offene Rücknahme erneut versucht (ruecknahmenSchritt), bis sie gelingt ODER die Zeile nachweislich nicht mehr
//    auf der Seite steht: der Beleg-Link [[…]] kommt im GANZEN Wiki nicht mehr vor (nur mit gefundener Aktion im Protokoll; ohne Aktion bleibt es offen). „Seite weg“ allein
//    beweist nichts — wurde sie verschoben/umbenannt, steht die Zeile am neuen Pfad weiter: dort wird zurückgenommen, und scheitert das, bleibt es offen MIT dem neuen Pfad.
//  - Offen heißt laut: Bericht „Rücknahme offen: n (id: grund)“, Morgenzeile „Rücknahme offen: n“. Der Lauf gilt deshalb nicht als teilweise (sonst würde er stündlich
//    wiederholt, ohne dass sich etwas ändert); nur eine unlesbare Liste macht ihn teilweise.
// Der Probemodus fasst nichts an. Nichts hier wirft aus dem Schritt heraus, ohne dass der Aufrufer es als Fehler des Schritts vermerkt.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { ordner } from "../pfade.mjs";
import { TL_DIR, notiere, leseAktionen } from "./protokoll.mjs";
import { nimmZurueck, BELEG_MUSTER, seitenMitLink } from "./zurueck.mjs";

const datei = (vault) => join(TL_DIR(vault), "ruecknahmen-offen.json");
const iso = (ms) => new Date(ms).toISOString().slice(0, 19) + "Z";
const kurz = (s, n = 80) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const gueltig = (e) => e && typeof e === "object" && !Array.isArray(e) && typeof e.aktion === "string" && e.aktion !== "";

// → { liste: [{ aktion, commit, ref, seit, versuche, grund, seite }], kaputt } (seite: Pfad, unter dem die Zeile gefunden wurde, wenn er vom Protokoll abweicht) — fehlende Datei = leer; alles, was nicht lesbar/gültig ist, zählt als kaputt.
export function ladeOffene(vault) {
  let text;
  try { text = readFileSync(datei(vault), "utf8"); }
  catch (e) { return { liste: [], kaputt: e?.code !== "ENOENT" }; }
  try {
    const roh = JSON.parse(text);
    if (!Array.isArray(roh)) return { liste: [], kaputt: true };
    const liste = roh.filter(gueltig).map((e) => ({ aktion: e.aktion, commit: String(e.commit ?? ""), ref: String(e.ref ?? ""), seit: String(e.seit ?? ""),
      versuche: Number.isInteger(e.versuche) && e.versuche >= 0 ? e.versuche : 0, grund: String(e.grund ?? ""), seite: String(e.seite ?? "") }));
    return { liste, kaputt: liste.length !== roh.length };
  } catch { return { liste: [], kaputt: true }; }
}

function speichere(vault, liste) {
  mkdirSync(TL_DIR(vault), { recursive: true });
  const tmp = join(TL_DIR(vault), `ruecknahmen-offen.json.${process.pid}.tmp`);
  writeFileSync(tmp, JSON.stringify(liste, null, 2) + "\n");
  renameSync(tmp, datei(vault));
}

// Festhalten, sobald „stimmt nicht“ beantwortet ist. Wirft, wenn die Liste nicht geschrieben werden kann (der Aufrufer lässt die Rückfrage dann offen).
// Eine kaputte Liste wird zur Seite gelegt (.kaputt) und neu begonnen; ctx.ruecknahmenListeKaputt sorgt dafür, dass der Lauf es meldet.
export function merkeRuecknahme(ctx, { aktion, commit = "", ref = "" }) {
  if (ctx.probe || !aktion) return;
  const { liste, kaputt } = ladeOffene(ctx.vault);
  if (kaputt) {
    ctx.ruecknahmenListeKaputt = true;
    try { renameSync(datei(ctx.vault), `${datei(ctx.vault)}.kaputt`); } catch { /* wird überschrieben */ }
  }
  if (liste.some((e) => e.aktion === aktion)) return;
  liste.push({ aktion, commit: String(commit || ""), ref: String(ref || ""), seit: iso(ctx.jetzt), versuche: 0, grund: "", seite: "" });
  speichere(ctx.vault, liste);
}

// Wo steht die Zeile dieser Übernahme jetzt? → { status, pfade, ziel }: ziel = Seite laut Protokoll; status "da" (pfade: wo ihr Beleg-Link steht — am Protokoll-Pfad, sonst
// an einer oder mehreren anderen Seiten, z. B. nach einem Umzug), "weg" (nur bei Beweis: Aktion im Protokoll gefunden, und der Link steht im ganzen Wiki nirgends mehr),
// "unklar" (keine Aktion, Pfad unzulässig, etwas nicht lesbar — jeder Zweifel: dann bleibt die Rücknahme offen).
export function findeZeile(vault, aktionId) {
  const unklar = { status: "unklar", pfade: [], ziel: "" };
  try {
    const a = leseAktionen(vault).findLast((x) => x.id === aktionId && (x.stufe === "uebernehmen" || x.stufe === "stand") && typeof x.ziel === "string" && typeof x.beleg === "string");
    if (!a || !BELEG_MUSTER.test(a.beleg)) return unklar;
    const wiki = ordner(vault).wiki;
    if (!a.ziel.startsWith(`${wiki}/`) || a.ziel.split("/").includes("..")) return unklar;
    const link = a.beleg.replace(/\.md$/, "");
    try { if (readFileSync(join(vault, a.ziel), "utf8").includes(`[[${link}]]`)) return { status: "da", pfade: [a.ziel], ziel: a.ziel }; }
    catch (e) { if (e?.code !== "ENOENT") return { ...unklar, ziel: a.ziel }; }
    // Die Seite fehlt oder trägt den Link nicht mehr: steht er woanders im Wiki (verschoben, umbenannt, aufgeteilt)?
    const woanders = seitenMitLink(vault, wiki, link).filter((p) => p !== a.ziel);
    return woanders.length ? { status: "da", pfade: woanders, ziel: a.ziel } : { status: "weg", pfade: [], ziel: a.ziel };
  } catch { return unklar; }
}
export const zeileWeg = (vault, aktionId) => findeZeile(vault, aktionId).status === "weg";

// Schritt „Rücknahmen“ im Lauf (nach dem Schreiben): jede offene Rücknahme noch einmal versuchen. → { offen: [{ aktion, grund, versuche }], erledigt }
export function ruecknahmenSchritt(ctx, zahl, neueInProbe = []) {
  if (ctx.probe) {
    for (const z of neueInProbe) notiere(ctx, { id: z.aktion, stufe: "zurueck", grund: "stichprobe (Probe)" });
    return { offen: [], erledigt: 0 };
  }
  const { liste, kaputt } = ladeOffene(ctx.vault);
  if (kaputt) { try { renameSync(datei(ctx.vault), `${datei(ctx.vault)}.kaputt`); } catch { /* wird überschrieben */ } }   // nichts wegwerfen: zur Seite legen
  if (kaputt || ctx.ruecknahmenListeKaputt) {
    zahl.teilweise = true;
    ctx.grund ||= "Die Liste offener Rücknahmen (ruecknahmen-offen.json) war unlesbar — neu begonnen";
    notiere(ctx, { id: "lauf", stufe: "fehler", grund: "ruecknahmen-offen.json unlesbar — Liste neu begonnen (alte Datei: .kaputt)" });
  }
  const bleibt = [];
  let erledigt = 0;
  const abgehakt = (e) => { notiere(ctx, { id: e.aktion, stufe: "zurueck-erledigt", grund: "zeile-nicht-mehr-auf-der-seite" }); erledigt++; };
  for (const e of liste) {
    const z = findeZeile(ctx.vault, e.aktion);
    if (z.status === "weg") { abgehakt(e); continue; }
    const r = nimmZurueck(ctx.vault, { ids: [e.aktion], jetzt: ctx.jetzt, alsFehler: false, ctx });   // zählt schon als Stichproben-Fehler (antworten.mjs); sucht eine verschobene Seite selbst
    if (r.ok) { erledigt++; continue; }
    // Zwischen dem Versuch und jetzt kann die Zeile verschwunden sein (z. B. nichts-gefunden, weil schon zurückgenommen): nachprüfen.
    const nach = findeZeile(ctx.vault, e.aktion);
    if (nach.status === "weg") { abgehakt(e); continue; }
    const seite = nach.status === "da" && !nach.pfade.includes(nach.ziel) ? nach.pfade.join(", ") : "";   // Seite verschoben: wo die Zeile jetzt steht
    const neu = { ...e, versuche: e.versuche + 1, grund: kurz(r.grund || "fehler", 40), seite };
    if (neu.versuche === 1 || neu.grund !== e.grund || neu.seite !== e.seite) notiere(ctx, { id: e.aktion, stufe: "fehler", grund: `zurueck: ${neu.grund}${seite ? ` (Seite jetzt: ${seite})` : ""}` });
    bleibt.push(neu);
  }
  if (erledigt || bleibt.length !== liste.length || bleibt.some((b, i) => b.versuche !== liste[i]?.versuche || b.grund !== liste[i]?.grund || b.seite !== liste[i]?.seite)) speichere(ctx.vault, bleibt);
  return { offen: bleibt.map((b) => ({ aktion: b.aktion, grund: b.grund, versuche: b.versuche, seite: b.seite })), erledigt };
}
