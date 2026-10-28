// .tools/tests/test-tageslauf-ruecknahme-offen.mjs — Eine gescheiterte Rücknahme geht nicht verloren (B2, Folgepunkt N6): Antwortet der Nutzer
// „stimmt nicht“ und scheitert das Zurücknehmen (ungespeicherte Änderung an der Seite, Brain nicht auf main, Ingest läuft …), bleibt sie offen
// (.logs/tageslauf/ruecknahmen-offen.json, schon beim Beantworten gemerkt), wird in JEDEM Lauf erneut versucht, bis sie gelingt oder die Zeile
// nachweislich nicht mehr auf der Seite steht — und ist laut: Bericht und Morgenzeile „Rücknahme offen: n“.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync, rmSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { isoliere, neuerTestVault, legeVorschlagAn, seitenText, fakeKi, git, FAKE_BEFEHL, JETZT } from "./tageslauf-hilfe.mjs";
import { SEITE, lauf } from "./lauf-hilfe.mjs";
const P = await import("../tageslauf/protokoll.mjs");
const A = await import("../tageslauf/antworten.mjs");
const RN = await import("../tageslauf/ruecknahmen.mjs");
const R = await import("../rueckfragen.mjs");
const M = await import("../tageslauf/morgen.mjs");
isoliere();

const STUNDE = 3600e3;
const offenDatei = (v) => join(P.TL_DIR(v), "ruecknahmen-offen.json");
const liesOffen = (v) => JSON.parse(readFileSync(offenDatei(v), "utf8"));
const seitenText0 = (v) => readFileSync(join(v, SEITE), "utf8");
const letzterBericht = (v, r) => readFileSync(join(v, r.bericht), "utf8").split("\n## Lauf ").pop();   // der Bericht eines Tages sammelt alle Läufe — hier nur der letzte
const hatFakt = (v, id) => seitenText0(v).includes(`[[10_projekte/belege/2026-10/${id}]]`);
const WOERTER = ["Lüfter", "Kühlung", "Netzteil"];
const ORTE = ["Keller", "Flur", "Büro"];
const FARBEN = ["rot", "blau", "grün"];
const neu = '{"urteil":"neu","zitatStuetzt":true,"passtZurSeite":true,"dauerhaft":true}';
function torVault() {
  const v = neuerTestVault({ automatik: { tageslauf: "an" },
    seiten: { [SEITE]: seitenText({ fm: { name: "orion", description: "Orion Testsystem" }, rumpf: "# Orion\n\nOrion ist das Testsystem.\n\n## Fakten\n\n- Orion läuft auf Port 3309 · Stand 01.10.2026 · [[x]]\n" }) } });
  mkdirSync(join(v, ".logs"), { recursive: true });
  writeFileSync(join(v, ".logs", "aliasse.json"), JSON.stringify({ orion: SEITE }));
  for (let i = 0; i < 3; i++) {
    const id = `f0${i + 1}`;
    const satz = `Orion nutzt ein ${WOERTER[i]} im ${ORTE[i]} in ${FARBEN[i]}`;
    legeVorschlagAn(v, { id, titel: `Orion ${WOERTER[i]}`, text: `${satz}.`, zitat: satz, herkunft: "tool", fundstelle: `s1#u-${id} 2026-10-20T10:00:00Z` });
  }
  return v;
}
const frageZu = (v, id) => R.listeRueckfragen(v).find((x) => x.typ === "stichprobe" && x.fm.aktion === id);
const nein = (v, id) => R.beantworte(v, frageZu(v, id).id, "stimmt-nicht");
const heil = (v) => git(v, "checkout", "-q", "--", SEITE);
async function nachDreiUebernahmen() {
  const v = torVault();
  fakeKi([{ wenn: "FAKT:", antwort: neu }]);
  const r = await lauf(v);
  assert.equal(r.zahlen.uebernommen, 3, JSON.stringify(r));
  return v;
}

// ------------------------------------------------------------------------------------------------ Liste offener Rücknahmen
test("merkeRuecknahme/ladeOffene: neue Einträge, nie doppelt je Aktion; Probe schreibt nichts; fehlende Datei = leer, kaputte Datei wird gemeldet", () => {
  const v = neuerTestVault();
  const ctx = P.neuerLauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT });
  assert.deepEqual(RN.ladeOffene(v), { liste: [], kaputt: false });
  RN.merkeRuecknahme(ctx, { aktion: "a1", commit: "c1", ref: "rf-1" });
  RN.merkeRuecknahme(ctx, { aktion: "a1", commit: "c1", ref: "rf-1" });
  RN.merkeRuecknahme(ctx, { aktion: "a2", commit: "", ref: "rf-2" });
  const l = RN.ladeOffene(v);
  assert.equal(l.kaputt, false);
  assert.deepEqual(l.liste.map((x) => [x.aktion, x.commit, x.ref, x.versuche]), [["a1", "c1", "rf-1", 0], ["a2", "", "rf-2", 0]]);
  assert.match(l.liste[0].seit, /^2026-10-22T03:00:00/);
  const probe = neuerTestVault();
  RN.merkeRuecknahme(P.neuerLauf(probe, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT, probe: true }), { aktion: "a1", commit: "c1", ref: "rf-1" });
  assert.ok(!existsSync(offenDatei(probe)), "Probe schreibt nichts");
  for (const roh of ["{kaputt", "null", "{}", '"text"', "[1,2]", '[{"aktion":""}]']) {
    writeFileSync(offenDatei(v), roh);
    const k = RN.ladeOffene(v);
    assert.deepEqual([k.liste.length, k.kaputt], [0, true], roh);
  }
  writeFileSync(offenDatei(v), "");
  assert.equal(RN.ladeOffene(v).kaputt, true, "leere Datei ist kaputt, nicht „nichts offen“");
});

test("„stimmt nicht“ wird schon beim Beantworten festgehalten (vor dem Rücknahme-Schritt): auch ein Absturz dazwischen verliert nichts; der Rückgabewert bleibt wie gehabt", () => {
  const v = neuerTestVault({ seiten: { [SEITE]: seitenText({ fm: { name: "alpha" }, rumpf: "# Alpha\n" }) } });
  const ctx = P.neuerLauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT });
  const id = R.legeRueckfrageAn(ctx, { typ: "stichprobe", frage: "Stimmt das?", seite: SEITE, felder: { aktion: "s2", commit: "c2" } });
  R.beantworte(v, id, "stimmt-nicht");
  const r = A.wendeAntwortenAn(ctx);
  assert.deepEqual(r.zuruecknehmen, [{ aktion: "s2", commit: "c2", ref: id }]);
  assert.deepEqual(liesOffen(v).map((x) => [x.aktion, x.commit, x.ref]), [["s2", "c2", id]]);
  assert.deepEqual(P.lesePruefungen(v).map((p) => [p.aktion, p.fehler]), [["s2", true]]);
});

test("kann die Liste nicht geschrieben werden (kein Schreibrecht), bleibt die Antwort UNBEANTWORTET liegen (nichts verloren, keine Prüfung doppelt); nach der Heilung wird sie genau einmal angewendet", (t) => {
  if (typeof process.getuid === "function" && process.getuid() === 0) return t.skip("als root gibt es kein Schreibverbot");
  const v = neuerTestVault({ seiten: { [SEITE]: seitenText({ fm: { name: "alpha" }, rumpf: "# Alpha\n" }) } });
  const ctx = P.neuerLauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT });
  const id = R.legeRueckfrageAn(ctx, { typ: "stichprobe", frage: "Stimmt das?", seite: SEITE, felder: { aktion: "s2", commit: "c2" } });
  R.beantworte(v, id, "stimmt-nicht");
  mkdirSync(P.TL_DIR(v), { recursive: true });
  chmodSync(P.TL_DIR(v), 0o555);                                                   // nichts mehr schreibbar
  try {
    const r = A.wendeAntwortenAn(ctx);
    assert.equal(r.fehler, 1);
    assert.deepEqual(r.zuruecknehmen, []);
    assert.ok(R.listeRueckfragen(v).some((x) => x.id === id && x.antwort === "stimmt-nicht"), "die Rückfrage ist noch da, mit deiner Antwort");
  } finally { chmodSync(P.TL_DIR(v), 0o755); }
  assert.deepEqual(P.lesePruefungen(v), [], "keine Prüfung ohne gemerkte Rücknahme");
  assert.equal(A.wendeAntwortenAn(P.neuerLauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT + STUNDE })).zuruecknehmen.length, 1);
  assert.equal(A.wendeAntwortenAn(P.neuerLauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT + 2 * STUNDE })).zuruecknehmen.length, 0, "die Rückfrage ist jetzt archiviert");
  assert.equal(P.lesePruefungen(v).length, 1, "genau eine Prüfung");
  assert.equal(liesOffen(v).length, 1);
});

test("ein Ordner statt der Liste wird zur Seite gelegt (.kaputt) und die Liste neu begonnen — gemeldet, nicht still", () => {
  const v = neuerTestVault({ seiten: { [SEITE]: seitenText({ fm: { name: "alpha" }, rumpf: "# Alpha\n" }) } });
  const ctx = P.neuerLauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT });
  mkdirSync(offenDatei(v), { recursive: true });
  RN.merkeRuecknahme(ctx, { aktion: "a1", commit: "c1", ref: "rf-1" });
  assert.equal(ctx.ruecknahmenListeKaputt, true);
  assert.ok(existsSync(`${offenDatei(v)}.kaputt`));
  assert.deepEqual(liesOffen(v).map((x) => x.aktion), ["a1"]);
});

// ------------------------------------------------------------------------------------------------ ganzer Lauf
test("Rücknahme scheitert (ungespeicherte Änderung an der Seite): sie bleibt offen, wird in jedem Lauf erneut versucht, ist laut — und gelingt, sobald die Seite wieder frei ist", async () => {
  const v = await nachDreiUebernahmen();
  nein(v, "f01");
  appendFileSync(join(v, SEITE), "\nlokal dazugeschrieben\n");                       // z. B. Obsidian offen
  const r2 = await lauf(v, { jetzt: JETZT + STUNDE });
  assert.equal(r2.status, "ok", JSON.stringify(r2));
  assert.ok(hatFakt(v, "f01"), "noch auf der Seite");
  const offen = liesOffen(v);
  assert.deepEqual(offen.map((x) => [x.aktion, x.versuche, x.grund]), [["f01", 1, "lokale-aenderung"]]);
  assert.ok(!R.listeRueckfragen(v).some((x) => x.fm.aktion === "f01"), "die Rückfrage selbst ist archiviert — die Liste hält die Rücknahme");
  assert.match(letzterBericht(v, r2), /Rücknahme offen: 1 \(f01: lokale-aenderung\)/);
  assert.match(M.morgenZeile(v, { jetzt: JETZT + STUNDE }), /Rücknahme offen: 1/);
  const r3 = await lauf(v, { jetzt: JETZT + 2 * STUNDE });
  assert.deepEqual(liesOffen(v).map((x) => [x.aktion, x.versuche]), [["f01", 2]], "jeder Lauf versucht es erneut");
  assert.match(M.morgenZeile(v, { jetzt: JETZT + 2 * STUNDE }), /Rücknahme offen: 1/);
  heil(v);                                                                          // Änderung verworfen
  const r4 = await lauf(v, { jetzt: JETZT + 3 * STUNDE });
  assert.equal(r4.status, "ok", JSON.stringify(r4));
  assert.ok(!hatFakt(v, "f01"), "zurückgenommen");
  assert.ok(hatFakt(v, "f02") && hatFakt(v, "f03"), "die anderen bleiben");
  assert.deepEqual(liesOffen(v), [], "Liste leer");
  assert.match(git(v, "log", "--format=%s", "main").split("\n").find((s) => /^zurueck:/.test(s)) || "", /^zurueck: f01/);
  assert.equal(P.leseAktionen(v).filter((a) => a.stufe === "zurueck" && a.id === "f01").length, 1, "genau einmal zurückgenommen");
  assert.doesNotMatch(M.morgenZeile(v, { jetzt: JETZT + 3 * STUNDE }) || "", /Rücknahme offen/);
  assert.doesNotMatch(letzterBericht(v, r4), /Rücknahme offen/);
  assert.equal(r3.status, "ok");
});

test("steht die Zeile nachweislich nicht mehr auf der Seite (von Hand entfernt), ist die Rücknahme erledigt — ohne Commit, ohne weiteren Versuch", async () => {
  const v = await nachDreiUebernahmen();
  nein(v, "f01");
  const ohne = seitenText0(v).split("\n").filter((z) => !z.includes("[[10_projekte/belege/2026-10/f01]]")).join("\n");
  writeFileSync(join(v, SEITE), ohne);                                              // ungespeichert, die Zeile ist weg
  const commitsVorher = git(v, "rev-list", "--count", "main");
  const r = await lauf(v, { jetzt: JETZT + STUNDE });
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.deepEqual(liesOffen(v), [], "erledigt, nicht offen");
  assert.equal(git(v, "rev-list", "--count", "main"), commitsVorher, "kein Rücknahme-Commit");
  assert.ok(P.leseAktionen(v).some((a) => a.id === "f01" && a.stufe === "zurueck-erledigt" && a.grund === "zeile-nicht-mehr-auf-der-seite"));
  assert.doesNotMatch(M.morgenZeile(v, { jetzt: JETZT + STUNDE }) || "", /Rücknahme offen/);
});

test("fehlt die Aktion im Protokoll (z. B. nach einem Schreibfehler nach dem Merge), holt die Selbstheilung sie aus dem Commit — die Rücknahme gelingt trotzdem", async () => {
  const v = await nachDreiUebernahmen();
  nein(v, "f01");
  const alt = readFileSync(join(P.TL_DIR(v), "aktionen.jsonl"), "utf8").split("\n").filter((z) => !z.includes('"id":"f01"'));
  writeFileSync(join(P.TL_DIR(v), "aktionen.jsonl"), alt.join("\n"));
  const r = await lauf(v, { jetzt: JETZT + STUNDE });
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.ok(!hatFakt(v, "f01"), "zurückgenommen");
  assert.deepEqual(liesOffen(v), []);
  assert.ok(P.leseAktionen(v).some((a) => a.id === "f01" && a.stufe === "uebernehmen" && a.rekonstruiert === true), "aus dem Git-Verlauf rekonstruiert");
  assert.equal(P.leseAktionen(v).filter((a) => a.id === "f01" && a.stufe === "zurueck").length, 1);
});

test("eine gemerkte Rücknahme ohne Aktion UND ohne Commit (nichts, woraus sich etwas rekonstruieren ließe): die Zeile ist nicht nachweislich weg — offen (laut), nie erledigt", async () => {
  const v = await nachDreiUebernahmen();
  RN.merkeRuecknahme(P.neuerLauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT }), { aktion: "gibt-es-nicht", commit: "", ref: "rf-x" });
  const r = await lauf(v, { jetzt: JETZT + STUNDE });
  assert.ok(hatFakt(v, "f01"));
  assert.deepEqual(liesOffen(v).map((x) => [x.aktion, x.grund]), [["gibt-es-nicht", "nichts-gefunden"]]);
  assert.match(M.morgenZeile(v, { jetzt: JETZT + STUNDE }), /Rücknahme offen: 1/);
  assert.match(letzterBericht(v, r), /Rücknahme offen: 1 \(gibt-es-nicht: nichts-gefunden\)/);
});

test("Seite ist ganz weg: die Zeile ist nachweislich nicht mehr da → erledigt", async () => {
  const v = await nachDreiUebernahmen();
  nein(v, "f01");
  rmSync(join(v, SEITE));                                                           // Seite gelöscht (ungespeichert)
  await lauf(v, { jetzt: JETZT + STUNDE });
  assert.deepEqual(liesOffen(v), []);
});

// ------------------------------------------------------------------------------------------------ verschobene Seite
// „Die Seite ist weg (ENOENT)“ ist kein Beweis, dass die Zeile weg ist: die Seite kann verschoben/umbenannt worden sein, die falsche Zeile steht dann am neuen Pfad weiter.
// Darum wird die Zeile (ihr Beleg-Link) im ganzen Wiki gesucht: gefunden → Rücknahme dort (oder offen mit neuem Pfad), nirgends → erledigt.
const NEU_PFAD = "09_wiki/archiv/entitaet_orion.md";
function verschiebe(v, nach = NEU_PFAD) {
  mkdirSync(join(v, dirname(nach)), { recursive: true });
  git(v, "mv", SEITE, nach);
  git(v, "commit", "-q", "-m", "Seite verschoben");
}
const textVon = (v, rel) => readFileSync(join(v, rel), "utf8");
const faktIn = (v, rel, id) => textVon(v, rel).includes(`[[10_projekte/belege/2026-10/${id}]]`);
async function gescheitertUndOffen(v) {                                              // „stimmt nicht“ zu f01, erster Versuch scheitert (Seite lokal verändert)
  nein(v, "f01");
  appendFileSync(join(v, SEITE), "\nlokal dazugeschrieben\n");
  const r = await lauf(v, { jetzt: JETZT + STUNDE });
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.deepEqual(liesOffen(v).map((x) => [x.aktion, x.versuche, x.grund]), [["f01", 1, "lokale-aenderung"]]);
  heil(v);                                                                          // die lokale Änderung wird verworfen …
}

test("Rücknahme scheitert, danach wird die Seite verschoben: der nächste Lauf findet die Zeile am neuen Pfad und nimmt sie dort zurück — nicht „erledigt“ bei stehender falscher Zeile", async () => {
  const v = await nachDreiUebernahmen();
  await gescheitertUndOffen(v);
  verschiebe(v);                                                                    // … und die Seite zieht um (z. B. /ingest ordnet neu ein)
  assert.ok(!existsSync(join(v, SEITE)));
  assert.ok(faktIn(v, NEU_PFAD, "f01"), "die falsche Zeile steht am neuen Pfad");
  assert.equal(RN.zeileWeg(v, "f01"), false, "ENOENT der alten Seite ist kein Beweis");
  const r = await lauf(v, { jetzt: JETZT + 2 * STUNDE });
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.ok(!faktIn(v, NEU_PFAD, "f01"), "am neuen Pfad zurückgenommen");
  assert.ok(faktIn(v, NEU_PFAD, "f02") && faktIn(v, NEU_PFAD, "f03"), "die anderen bleiben");
  assert.deepEqual(liesOffen(v), [], "Liste leer");
  assert.match(git(v, "log", "--format=%s", "main").split("\n").find((s) => /^zurueck:/.test(s)) || "", /^zurueck: f01/);
  const aktionen = P.leseAktionen(v);
  assert.equal(aktionen.filter((a) => a.stufe === "zurueck" && a.id === "f01").length, 1, "wirklich zurückgenommen, nicht nur abgehakt");
  assert.equal(aktionen.find((a) => a.stufe === "zurueck" && a.id === "f01").ziel, NEU_PFAD, "das Protokoll nennt die Seite, auf der es geschah");
  assert.ok(!aktionen.some((a) => a.stufe === "zurueck-erledigt" && a.id === "f01"), "nicht als „Zeile nicht mehr da“ abgehakt");
});

test("verschobene Seite UND weiter nicht zurücknehmbar (ungespeicherte Änderung am neuen Pfad): bleibt offen, mit dem neuen Pfad — im Bericht und in der Liste; nach der Heilung gelingt sie", async () => {
  const v = await nachDreiUebernahmen();
  await gescheitertUndOffen(v);
  verschiebe(v);
  appendFileSync(join(v, NEU_PFAD), "\nam neuen Ort lokal dazugeschrieben\n");
  const r = await lauf(v, { jetzt: JETZT + 2 * STUNDE });
  assert.ok(faktIn(v, NEU_PFAD, "f01"), "noch da");
  const offen = liesOffen(v);
  assert.deepEqual(offen.map((x) => [x.aktion, x.versuche, x.grund, x.seite]), [["f01", 2, "lokale-aenderung", NEU_PFAD]], "offen mit neuem Pfad, nicht erledigt");
  assert.match(letzterBericht(v, r), new RegExp(`Rücknahme offen: 1 \\(f01: lokale-aenderung \\(Seite jetzt: ${NEU_PFAD.replace(/[.]/g, "\\.")}\\)\\)`));
  git(v, "checkout", "-q", "--", NEU_PFAD);
  const r3 = await lauf(v, { jetzt: JETZT + 3 * STUNDE });
  assert.equal(r3.status, "ok", JSON.stringify(r3));
  assert.ok(!faktIn(v, NEU_PFAD, "f01"));
  assert.deepEqual(liesOffen(v), []);
});

test("verschobene Seite, und die Zeile steht nirgends mehr im Wiki (nach dem Umzug von Hand entfernt): erledigt — ohne Commit", async () => {
  const v = await nachDreiUebernahmen();
  await gescheitertUndOffen(v);
  verschiebe(v);
  writeFileSync(join(v, NEU_PFAD), textVon(v, NEU_PFAD).split("\n").filter((z) => !z.includes("[[10_projekte/belege/2026-10/f01]]")).join("\n"));
  git(v, "commit", "-q", "-am", "Zeile von Hand entfernt");
  const commitsVorher = git(v, "rev-list", "--count", "main");
  await lauf(v, { jetzt: JETZT + 2 * STUNDE });
  assert.deepEqual(liesOffen(v), [], "erledigt");
  assert.equal(git(v, "rev-list", "--count", "main"), commitsVorher, "kein Rücknahme-Commit");
  assert.ok(P.leseAktionen(v).some((a) => a.id === "f01" && a.stufe === "zurueck-erledigt"));
});

test("die Zeile steht nach dem Umzug auf ZWEI Seiten: nichts raten — offen (laut), nicht erledigt, nichts verändert", async () => {
  const v = await nachDreiUebernahmen();
  await gescheitertUndOffen(v);
  verschiebe(v);
  writeFileSync(join(v, "09_wiki/archiv/kopie.md"), textVon(v, NEU_PFAD));
  git(v, "add", "--", "09_wiki/archiv/kopie.md");
  git(v, "commit", "-q", "-m", "Kopie");
  const r = await lauf(v, { jetzt: JETZT + 2 * STUNDE });
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.ok(faktIn(v, NEU_PFAD, "f01") && faktIn(v, "09_wiki/archiv/kopie.md", "f01"), "unverändert");
  assert.deepEqual(liesOffen(v).map((x) => [x.aktion, x.grund]), [["f01", "von-hand-geaendert"]]);
  assert.match(M.morgenZeile(v, { jetzt: JETZT + 2 * STUNDE }), /Rücknahme offen: 1/);
});

test("zeileWeg/findeZeile: Seite fehlt und nirgends der Link → weg; Link woanders → da (mit Pfad); Seite lesbar mit Link → da; unlesbar (Ordner statt Seite) → unklar, nie weg", async () => {
  const v = await nachDreiUebernahmen();
  assert.deepEqual(RN.findeZeile(v, "f01"), { status: "da", pfade: [SEITE], ziel: SEITE });
  assert.equal(RN.zeileWeg(v, "f01"), false);
  verschiebe(v);
  assert.deepEqual(RN.findeZeile(v, "f01"), { status: "da", pfade: [NEU_PFAD], ziel: SEITE });
  rmSync(join(v, NEU_PFAD));
  assert.deepEqual(RN.findeZeile(v, "f01"), { status: "weg", pfade: [], ziel: SEITE });
  assert.equal(RN.zeileWeg(v, "f01"), true);
  assert.equal(RN.findeZeile(v, "gibt-es-nicht").status, "unklar", "keine Aktion im Protokoll → nie „weg“");
  mkdirSync(join(v, SEITE), { recursive: true });                                    // ein Ordner dort, wo die Seite war → nicht lesbar
  assert.equal(RN.findeZeile(v, "f01").status, "unklar");
  assert.equal(RN.zeileWeg(v, "f01"), false);
});

test("eine kaputte Liste wird gemeldet (Lauf teilweise), neue Rücknahmen laufen trotzdem, die Liste wird neu begonnen", async () => {
  const v = await nachDreiUebernahmen();
  nein(v, "f02");
  writeFileSync(offenDatei(v), "{kaputt");
  const r = await lauf(v, { jetzt: JETZT + STUNDE });
  assert.equal(r.status, "teilweise", JSON.stringify(r));
  assert.match(r.grund, /ruecknahmen-offen\.json/);
  assert.ok(!hatFakt(v, "f02"), "die neue Rücknahme ist trotzdem gelaufen (die Antwort ging über den Absturz-sicheren Weg ein)");
  assert.deepEqual(liesOffen(v), [], "neu begonnen und leer");
});

test("Probemodus: keine Rücknahme-Versuche, keine Liste — die Probe notiert nur", async () => {
  const v = await nachDreiUebernahmen();
  nein(v, "f01");
  const vorher = seitenText0(v);
  const r = await lauf(v, { jetzt: JETZT + STUNDE, probe: true });
  assert.equal(r.modus, "probe");
  assert.equal(seitenText0(v), vorher);
  assert.ok(!existsSync(offenDatei(v)));
});

test("Rücknahme gelingt sofort: nichts bleibt offen, keine Datei mit Einträgen, keine Meldung", async () => {
  const v = await nachDreiUebernahmen();
  nein(v, "f03");
  const r = await lauf(v, { jetzt: JETZT + STUNDE });
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.ok(!hatFakt(v, "f03"));
  assert.deepEqual(existsSync(offenDatei(v)) ? liesOffen(v) : [], []);
  assert.doesNotMatch(letzterBericht(v, r), /Rücknahme offen/);
});
