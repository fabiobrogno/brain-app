// .tools/tests/test-tageslauf-einschwingen.mjs — Einschwingphase als echtes Tor (B2, Befund #2).
// N = automatik.einschwingen (Standard 20, 0 = aus). A = in der Phase automatisch übernommene Fakten (Aktion mit einschwingen: true),
// R = davon „stimmt“, F = „stimmt nicht“ (oder zurückgenommen), O = offen = A − R − F. Phase aktiv, solange R < N.
// Echter Lauf: höchstens frei = max(0, min(N − R − O, 10 − O)) automatische Übernahmen (VOR dem Schreiben), der Rest wartet mit Grund „einschwingen“.
// Alles wird aus aktionen.jsonl + pruefungen.jsonl (+ den Rückfragen) gelesen — kaputte oder fehlende Dateien zählen als 0.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { isoliere, neuerTestVault, legeVorschlagAn, seitenText, fakeKi, schnappschuss, git, FAKE_BEFEHL, JETZT } from "./tageslauf-hilfe.mjs";
import { SEITE, REGELN, aufbau, lauf } from "./lauf-hilfe.mjs";
import { mitEigenemCache, hartAbbrechen } from "./abbruch-hilfe.mjs";
const E = await import("../tageslauf/einschwingen.mjs");
const AS = await import("../tageslauf/autostufe.mjs");
const B = await import("../tageslauf/bestand.mjs");
const R = await import("../rueckfragen.mjs");
const P = await import("../tageslauf/protokoll.mjs");
const { aufraeumKandidaten } = await import("../tageslauf/aufraeumen.mjs");
isoliere();

const TAG = 86400e3;
const ISO = (ms) => new Date(ms).toISOString();
const schreibeJsonl = (v, name, liste) => { mkdirSync(P.TL_DIR(v), { recursive: true }); writeFileSync(join(P.TL_DIR(v), name), liste.map((x) => JSON.stringify(x)).join("\n") + "\n"); };
const schreibeRoh = (v, name, text) => { mkdirSync(P.TL_DIR(v), { recursive: true }); writeFileSync(join(P.TL_DIR(v), name), text); };
// Eine Einschwing-Übernahme, wie der Lauf sie nach dem Merge protokolliert (aktionFuer in tageslauf.mjs), und die Antwort darauf (antworten.mjs).
const phase = (id, extra = {}) => ({ lauf: "20261020-030000", zeit: ISO(JETZT - 2 * TAG), id, stufe: "uebernehmen", ziel: SEITE, commit: id.padEnd(40, "0"), auto: true,
  einschwingen: true, titel: `Fakt ${id}`, zitat: `Zitat zu ${id}`, herkunft: "du", fundstelle: `s1#u-${id} 2026-10-20T10:00:00Z`, ...extra });
const antwort = (id, fehler, extra = {}) => ({ zeit: ISO(JETZT - TAG), art: "stichprobe", quelle: "einschwingen", fehler, ref: `rf-${id}`, aktion: id, seite: SEITE, ...extra });
const ids = (n, vor = "a") => Array.from({ length: n }, (_, i) => `${vor}${String(i + 1).padStart(2, "0")}`);
const vaultMit = (einschwingen, tageslauf = "an") => neuerTestVault({ automatik: einschwingen === undefined ? { tageslauf } : { tageslauf, einschwingen } });
// Zustand herstellen: r richtig beantwortet, f falsch beantwortet, o offen (jeweils eigene Aktionen).
function stand(v, { r = 0, f = 0, o = 0, extraAktionen = [], extraPruefungen = [] } = {}) {
  const richtig = ids(r, "r"), falsch = ids(f, "f"), offen = ids(o, "o");
  schreibeJsonl(v, "aktionen.jsonl", [...[...richtig, ...falsch, ...offen].map((id) => phase(id)), ...extraAktionen]);
  schreibeJsonl(v, "pruefungen.jsonl", [...richtig.map((id) => antwort(id, false)), ...falsch.map((id) => antwort(id, true)), ...extraPruefungen]);
  return v;
}
const ctxMit = (v, opt = {}) => P.neuerLauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT, ...opt });
const einschwing = (v) => R.listeRueckfragen(v).filter((x) => x.typ === "stichprobe" && x.quelle === "einschwingen");
const frageZu = (v, id) => einschwing(v).find((x) => x.fm.aktion === id);

// ------------------------------------------------------------------------------------------------ Zählung aus dem Zustand
test("einschwingStand: A, R, F, O aus Übernahmen und Antworten; „stimmt nicht“ und Zurücknahme zählen als F, nie als R", () => {
  const v = vaultMit(20);
  stand(v, { r: 2, f: 1, o: 2, extraAktionen: [
    phase("z1"),                                                       // unbeantwortet, aber von Hand zurückgenommen → F
    { lauf: "L2", zeit: ISO(JETZT - TAG), id: "z1", stufe: "zurueck", ziel: SEITE, von: "x", grund: "zurückgenommen" },
    phase("w1", { einschwingen: undefined }),                          // normale Übernahme (nicht in der Phase) → zählt nicht
  ], extraPruefungen: [antwort("w1", false, { quelle: undefined }), antwort("fremd", false)] });   // Wochen-Stichprobe und Antwort ohne Phasen-Übernahme → zählen nicht
  const s = E.einschwingStand(v);
  assert.deepEqual([s.ziel, s.A, s.R, s.F, s.O, s.aktiv, s.frei], [20, 6, 2, 2, 2, true, 8]);
  assert.deepEqual(s.offene.map((a) => a.id).sort(), ["o01", "o02"]);
});

test("einschwingStand: frei = max(0, min(N − R − O, 10 − O)) — alle offenen Einschwing-Stichproben bleiben im Rückfragen-Deckel sichtbar", () => {
  const faelle = [[20, 0, 0, 10], [20, 3, 5, 5], [20, 0, 10, 0], [5, 2, 3, 0], [3, 0, 0, 3], [20, 12, 3, 5], [20, 0, 9, 1], [20, 4, 7, 3], [50, 0, 4, 6], [4, 3, 0, 1]];
  for (const [n, r, o, erwartet] of faelle) {
    const v = stand(vaultMit(n), { r, o });
    const s = E.einschwingStand(v);
    assert.equal(s.frei, erwartet, `N=${n} R=${r} O=${o}`);
    assert.ok(s.O + s.frei <= R.DECKEL, "offene + neue Stichproben passen in den Deckel");
    assert.ok(s.R + s.O + s.frei <= n, "nie mehr, als N verlangt");
  }
});

test("einschwingStand: Phase aktiv, solange R < N; bei R = N beendet (kein Tor, frei = null); N später erhöht → läuft weiter; auf ≤ R gesenkt → beendet; 0 = aus", () => {
  const v = stand(vaultMit(5), { r: 4 });
  assert.deepEqual([E.einschwingStand(v).aktiv, E.einschwingStand(v).frei], [true, 1]);
  stand(v, { r: 5 });
  const ende = E.einschwingStand(v);
  assert.deepEqual([ende.aktiv, ende.frei], [false, null], "R = N: kein Tor mehr");
  assert.equal(E.einschwingStand(v, { ...leseWerte(v), einschwingen: 8 }).aktiv, true, "N erhöht: ab dem Stand weiter");
  assert.equal(E.einschwingStand(v, { ...leseWerte(v), einschwingen: 8 }).frei, 3);
  assert.equal(E.einschwingStand(v, { ...leseWerte(v), einschwingen: 3 }).aktiv, false, "N auf ≤ R gesenkt");
  assert.equal(E.einschwingStand(v, { ...leseWerte(v), einschwingen: 0 }).aktiv, false, "0 = aus");
  assert.equal(E.einschwingStand(vaultMit(0)).frei, null);
});
function leseWerte(v) { return JSON.parse(JSON.stringify(ctxMit(v).werte)); }

test("einschwingStand: „stimmt nicht“ gewinnt vor „stimmt“; „stimmt“ gilt auch, wenn danach zurückgenommen wurde; doppelte Antworten zählen je Übernahme einmal", () => {
  const v = vaultMit(20);
  schreibeJsonl(v, "aktionen.jsonl", [phase("a"), phase("b"), phase("c"), { lauf: "L2", zeit: ISO(JETZT), id: "b", stufe: "zurueck", ziel: SEITE }]);
  schreibeJsonl(v, "pruefungen.jsonl", [antwort("a", false), antwort("a", true), antwort("b", false), antwort("c", false), antwort("c", false, { ref: "rf-c2" })]);
  const s = E.einschwingStand(v);
  assert.deepEqual([s.A, s.R, s.F, s.O], [3, 2, 1, 0], "a falsch (gewinnt), b richtig (Antwort geht vor Rücknahme), c einmal richtig");
});

test("einschwingStand: fehlende, kaputte oder unsinnige Dateien zählen als 0 und werfen nie; eine halbe Datei zählt, was lesbar ist", () => {
  const v = vaultMit(20);
  assert.deepEqual([E.einschwingStand(v).A, E.einschwingStand(v).frei], [0, 10], "nichts da");
  for (const roh of ["", "{kaputt", "null", "[]", "5", "\u0000\u0000", "{\"a\":", "[1,2", "\"text\"\n\"zwei\""]) {
    schreibeRoh(v, "aktionen.jsonl", roh);
    schreibeRoh(v, "pruefungen.jsonl", roh);
    const s = E.einschwingStand(v);
    assert.deepEqual([s.A, s.R, s.F, s.O], [0, 0, 0, 0], `Müll: ${JSON.stringify(roh)}`);
  }
  schreibeRoh(v, "aktionen.jsonl", [JSON.stringify(phase("a")), "{kaputt", JSON.stringify(phase("b")), JSON.stringify({ ...phase("c"), id: 7 }), JSON.stringify({ ...phase("d"), id: "" }), JSON.stringify(null)].join("\n"));
  schreibeRoh(v, "pruefungen.jsonl", ["{kaputt", JSON.stringify(antwort("a", false)), JSON.stringify(antwort("b", "ja")), JSON.stringify(antwort(7, false))].join("\n"));
  const s = E.einschwingStand(v);
  assert.deepEqual([s.A, s.R, s.F, s.O], [2, 1, 1, 0], "eine id ohne Text zählt nicht; „fehler“ gilt wie in der Fehlerquote der Autostufe, sobald es nicht leer/false ist (b falsch)");
});

test("der alte Zähler einschwingen.json wird nicht mehr gelesen — auch eine kaputte oder volle Datei ändert nichts", () => {
  const v = stand(vaultMit(20), { r: 1, o: 1 });
  const vorher = E.einschwingStand(v);
  schreibeRoh(v, "einschwingen.json", '{"uebernahmen":99,"zeit":"2026-10-22T03:00:00Z"}');
  assert.deepEqual(E.einschwingStand(v), vorher);
  schreibeRoh(v, "einschwingen.json", "{kaputt");
  assert.deepEqual(E.einschwingStand(v), vorher);
});

// ------------------------------------------------------------------------------------------------ Morgenzeilen-Text
test("einschwingText: „Einschwingen R/N geprüft“ + „· O offen“ nur bei O>0 + „· F falsch“ nur bei F>0; bei frei = 0 und O > 0 zusätzlich „— Automatik wartet auf deine Prüfung“", () => {
  const t = (n, o) => E.einschwingText(E.einschwingStand(stand(vaultMit(n), o)));
  assert.equal(t(20, { r: 3 }), "Einschwingen 3/20 geprüft");
  assert.equal(t(20, { r: 3, o: 5 }), "Einschwingen 3/20 geprüft · 5 offen");
  assert.equal(t(20, { r: 3, f: 1 }), "Einschwingen 3/20 geprüft · 1 falsch");
  assert.equal(t(20, { r: 3, o: 5, f: 2 }), "Einschwingen 3/20 geprüft · 5 offen · 2 falsch");
  assert.equal(t(20, { r: 0, o: 10 }), "Einschwingen 0/20 geprüft · 10 offen — Automatik wartet auf deine Prüfung", "Deckel erreicht");
  assert.equal(t(5, { r: 2, o: 3 }), "Einschwingen 2/5 geprüft · 3 offen — Automatik wartet auf deine Prüfung", "N erreicht");
  assert.equal(t(20, { r: 0 }), "Einschwingen 0/20 geprüft");
  assert.equal(t(5, { r: 5 }), null, "Phase beendet: verschwindet");
  assert.equal(t(0, { r: 0, o: 3 }), null, "0 = aus");
});

// ------------------------------------------------------------------------------------------------ Schritt 7b: Rückfragen
test("einschwingenSchritt: jede offene Einschwing-Übernahme ohne Frage bekommt eine Stichprobe (quelle einschwingen) mit Zitat, Quelle und Zielseite; ein zweiter Aufruf legt nichts doppelt an", () => {
  const v = stand(vaultMit(20), { o: 2 });
  const ctx = ctxMit(v);
  const r = E.einschwingenSchritt(ctx);
  assert.equal(r.neu, 2);
  const l = einschwing(v);
  assert.deepEqual(l.map((x) => x.fm.aktion).sort(), ["o01", "o02"]);
  const a = frageZu(v, "o01");
  assert.deepEqual([a.typ, a.grund, a.quelle, a.seite], ["stichprobe", "einschwingen", "einschwingen", SEITE]);
  assert.equal(a.fm.commit, "o01".padEnd(40, "0"));
  assert.match(a.frage, /^Stimmt das\? Fakt o01/);
  assert.match(a.beschreibung, /Automatisch übernommen am 2026-10-20 auf 09_wiki\/projekte\/entitaet_orion\.md/);
  assert.match(a.beschreibung, /Zitat: „Zitat zu o01“/);
  assert.match(a.beschreibung, /Quelle: s1#u-o01/);
  assert.match(a.beschreibung, /Einschwingphase/);
  assert.ok(ctx.aktionen.some((x) => x.stufe === "rueckfrage" && x.typ === "stichprobe" && x.grund === "einschwingen"));
  assert.equal(E.einschwingenSchritt(ctxMit(v)).neu, 0, "idempotent");
  assert.equal(einschwing(v).length, 2);
});

test("einschwingenSchritt: eine verlorene oder gelöschte Einschwing-Rückfrage wird neu angelegt — das Tor blockiert nicht für immer; Beantwortetes und andere Übernahmen bleiben unberührt", () => {
  const v = stand(vaultMit(20), { r: 1, o: 3 });
  E.einschwingenSchritt(ctxMit(v));
  assert.deepEqual(einschwing(v).map((x) => x.fm.aktion).sort(), ["o01", "o02", "o03"], "r01 ist beantwortet und bekommt keine neue");
  rmSync(frageZu(v, "o02").datei);                                    // gelöscht (von Hand, Synchronisierung, Absturz …)
  assert.equal(E.einschwingStand(v).O, 3, "O zählt sie weiter — darum muss die Frage zurückkommen");
  const r = E.einschwingenSchritt(ctxMit(v, { jetzt: JETZT + TAG }));
  assert.equal(r.neu, 1);
  assert.deepEqual(einschwing(v).map((x) => x.fm.aktion).sort(), ["o01", "o02", "o03"]);
  assert.equal(R.listeRueckfragen(v).filter((x) => x.fm.aktion === "o01").length, 1, "o01 nicht doppelt");
});

test("einschwingenSchritt: eine beantwortete, aber noch nicht angewendete Frage zählt als vorhanden (keine Doppelfrage)", () => {
  const v = stand(vaultMit(20), { o: 1 });
  E.einschwingenSchritt(ctxMit(v));
  R.beantworte(v, frageZu(v, "o01").id, "stimmt");
  assert.equal(E.einschwingenSchritt(ctxMit(v)).neu, 0);
  assert.equal(einschwing(v).length, 1);
});

test("einschwingenSchritt: eine offene Frage zu einer inzwischen zurückgenommenen Übernahme wird archiviert statt den Deckel zu belegen", () => {
  const v = stand(vaultMit(20), { o: 2 });
  E.einschwingenSchritt(ctxMit(v));
  schreibeJsonl(v, "aktionen.jsonl", [...ids(2, "o").map((id) => phase(id)), { lauf: "L2", zeit: ISO(JETZT), id: "o01", stufe: "zurueck", ziel: SEITE }]);
  const alt = frageZu(v, "o01");
  E.einschwingenSchritt(ctxMit(v, { jetzt: JETZT + TAG }));
  assert.equal(frageZu(v, "o01"), undefined, "nicht mehr offen");
  assert.ok(existsSync(join(v, "90_archiv", "rueckfragen-erledigt", `${alt.id}.md`)));
  assert.ok(frageZu(v, "o02"));
});

test("einschwingenSchritt: Probe, N=0 und beendete Phase legen nichts an", () => {
  const v = stand(vaultMit(20), { o: 2 });
  assert.equal(E.einschwingenSchritt(ctxMit(v, { probe: true })).neu, 0);
  assert.deepEqual(R.listeRueckfragen(v), []);
  const aus = stand(vaultMit(0), { o: 2 });
  assert.equal(E.einschwingenSchritt(ctxMit(aus)).neu, 0);
  assert.deepEqual(R.listeRueckfragen(aus), []);
  const fertig = stand(vaultMit(2), { r: 2, o: 1 });
  assert.equal(E.einschwingenSchritt(ctxMit(fertig)).neu, 0, "R = N: Phase vorbei");
  assert.deepEqual(R.listeRueckfragen(fertig), []);
});

test("einschwingenSchritt: ohne Phasen-Übernahmen (nur normale Übernahmen im Protokoll) passiert nichts", () => {
  const v = vaultMit(20);
  schreibeJsonl(v, "aktionen.jsonl", [phase("x", { einschwingen: undefined }), phase("y", { auto: false }), phase("z", { stufe: "feld" })]);
  const r = E.einschwingenSchritt(ctxMit(v));
  assert.deepEqual([r.neu, r.A], [0, 0]);
  assert.deepEqual(R.listeRueckfragen(v), []);
});

// ------------------------------------------------------------------------------------------------ Autostufe sofort vorsichtig
const autostufeDatei = (v) => join(P.TL_DIR(v), "autostufe.json");
test("erzwingeAutostufe: normal → eng sofort (gleiche Datei, gleiches Format wie aktualisiereAutostufe); schon eng oder aus wird nie gelockert; Probe schreibt nichts", () => {
  const v = vaultMit(20);
  const ctx = ctxMit(v);
  AS.erzwingeAutostufe(ctx, "eng", "Test");
  assert.equal(ctx.autostufe, "eng");
  const z = JSON.parse(readFileSync(autostufeDatei(v), "utf8"));
  assert.deepEqual([z.stufe, z.seit], ["eng", ISO(JETZT)]);
  assert.equal(AS.ladeAutostufe(v).stufe, "eng");
  assert.ok(ctx.aktionen.some((a) => a.stufe === "autostufe" && a.ziel === "eng"));
  const c2 = ctxMit(v, { jetzt: JETZT + TAG });
  AS.erzwingeAutostufe(c2, "eng", "nochmal");
  assert.equal(AS.ladeAutostufe(v).seit, ISO(JETZT), "keine Änderung → seit bleibt");
  writeFileSync(autostufeDatei(v), JSON.stringify({ stufe: "aus", seit: ISO(JETZT - TAG) }));
  const c3 = ctxMit(v, { jetzt: JETZT + TAG });
  AS.erzwingeAutostufe(c3, "eng", "x");
  assert.deepEqual([c3.autostufe, AS.ladeAutostufe(v).stufe], ["aus", "aus"], "nie lockern");
  const w = vaultMit(20);
  AS.erzwingeAutostufe(ctxMit(w, { probe: true }), "eng", "Probe");
  assert.ok(!existsSync(autostufeDatei(w)));
});

test("nach dem Erzwingen schaukelt die Quote nicht sofort weiter: derselbe Fehler löst keine zweite Verschärfung aus, ein neuer schon", () => {
  const v = vaultMit(20);
  const ctx = ctxMit(v);
  P.merkePruefung(ctx, antwort("a", true, { zeit: ISO(JETZT) }));      // 1 von 1 = 100 % — die Quote allein sagte „aus“
  AS.erzwingeAutostufe(ctx, "eng", "Test");
  AS.aktualisiereAutostufe(ctxMit(v, { jetzt: JETZT + TAG }));
  assert.equal(AS.ladeAutostufe(v).stufe, "eng", "der Fehler kam nicht NACH dem Wechsel");
  const c2 = ctxMit(v, { jetzt: JETZT + 2 * TAG });
  P.merkePruefung(c2, antwort("b", true, { zeit: ISO(JETZT + 2 * TAG) }));
  AS.aktualisiereAutostufe(c2);
  assert.equal(AS.ladeAutostufe(v).stufe, "aus", "neuer Fehler nach dem Wechsel → die Quote greift wie immer");
});

test("einschwingenBremse: ein „stimmt nicht“ der Phase, neuer als der letzte Wechsel, setzt die Autostufe sofort auf eng — einmal; andere Fehler und N=0 lösen es nicht aus", () => {
  const v = stand(vaultMit(20), { r: 3, f: 1 });
  const ctx = ctxMit(v);
  assert.equal(E.einschwingenBremse(ctx), true);
  assert.deepEqual([ctx.autostufe, AS.ladeAutostufe(v).stufe], ["eng", "eng"]);
  assert.equal(E.einschwingenBremse(ctxMit(v, { jetzt: JETZT + TAG })), false, "derselbe Fehler nicht noch einmal");
  const aus = stand(vaultMit(0), { r: 1, f: 1 });
  assert.equal(E.einschwingenBremse(ctxMit(aus)), false, "Phase aus");
  const fremd = vaultMit(20);
  schreibeJsonl(fremd, "pruefungen.jsonl", [{ zeit: ISO(JETZT - TAG), art: "stichprobe", fehler: true, ref: "w1", aktion: "w1" }, { zeit: ISO(JETZT - TAG), art: "w7", fehler: true, ref: "w2" }]);
  assert.equal(E.einschwingenBremse(ctxMit(fremd)), false, "Wochen-Stichprobe und W7 sind keine Einschwing-Fehler");
  const probe = stand(vaultMit(20), { f: 1 });
  assert.equal(E.einschwingenBremse(ctxMit(probe, { probe: true })), false);
  assert.ok(!existsSync(autostufeDatei(probe)));
});

// ------------------------------------------------------------------------------------------------ Aufräumen darf Wartende nicht verlieren
test("aufraeumen: ein wegen der Einschwingphase Wartender wird auch nach 60 Tagen nicht aussortiert (andere Wartende ohne Seite schon)", () => {
  const alt = (id, grund) => ({ id, art: "fakt", unterordner: "_warten", wartenGrund: grund, wartenSeit: ISO(JETZT - 90 * TAG), erstellt: ISO(JETZT - 90 * TAG), titel: id, text: id, fm: {}, herkunft: "tool", zitat: "z" });
  const r = aufraeumKandidaten([alt("e1", "einschwingen"), alt("k1", "keine-seite")], { jetzt: JETZT });
  assert.deepEqual(r.map((x) => [x.v.id, x.grund]), [["k1", "ohne-seite"]]);
});

// ------------------------------------------------------------------------------------------------ ganzer Lauf: das Tor
const WOERTER = ["Lüfter", "Kühlung", "Netzteil", "Gehäuse", "Backup", "Archiv", "Router", "Switch", "Monitor", "Tastatur", "Drucker", "Scanner", "Mikrofon", "Lautsprecher"];
const ORTE = ["Keller", "Flur", "Büro", "Lager", "Dach", "Garage", "Küche", "Labor", "Werkstatt", "Hof", "Turm", "Saal", "Anbau", "Bunker"];
const FARBEN = ["rot", "blau", "grün", "gelb", "weiß", "schwarz", "grau", "braun", "lila", "rosa", "orange", "silber", "gold", "türkis"];
const neu = '{"urteil":"neu","zitatStuetzt":true,"passtZurSeite":true,"dauerhaft":true}';
// n belegte, unverfängliche 🟢-Kandidaten für die Seite „Orion“; die Reihenfolge im Lauf ist die der IDs (f01 zuerst).
function torVault({ n = 14, einschwingen, herkunft = () => "tool" } = {}) {
  const v = neuerTestVault({ automatik: einschwingen === undefined ? { tageslauf: "an" } : { tageslauf: "an", einschwingen },
    seiten: { [SEITE]: seitenText({ fm: { name: "orion", description: "Orion Testsystem" }, rumpf: "# Orion\n\nOrion ist das Testsystem.\n\n## Fakten\n\n- Orion läuft auf Port 3309 · Stand 01.10.2026 · [[x]]\n" }) } });
  mkdirSync(join(v, ".logs"), { recursive: true });
  writeFileSync(join(v, ".logs", "aliasse.json"), JSON.stringify({ orion: SEITE }));
  for (let i = 0; i < n; i++) {
    const id = `f${String(i + 1).padStart(2, "0")}`;
    const satz = `Orion nutzt ein ${WOERTER[i]} im ${ORTE[i]} in ${FARBEN[i]}`;
    legeVorschlagAn(v, { id, titel: `Orion ${WOERTER[i]}`, text: `${satz}.`, zitat: satz, herkunft: herkunft(i), fundstelle: `s1#u-${id} 2026-10-20T10:00:00Z` });
  }
  return v;
}
const mitKi = () => fakeKi([{ wenn: "FAKT:", antwort: neu }]);
const wartende = (v) => B.ladeVorschlaege(v, { unterordner: ["_warten"] });
const grund = (v, g) => wartende(v).filter((x) => x.wartenGrund === g).map((x) => x.id).sort();
const antworte = (v, wahl, liste) => { for (const id of liste) R.beantworte(v, frageZu(v, id).id, wahl); };
const uebernommen = (v) => P.leseAktionen(v).filter((a) => a.stufe === "uebernehmen" && a.auto === true).map((a) => a.id).sort();

test("erster scharfer Lauf mit 14 🟢: genau 10 werden übernommen, 4 warten mit Grund einschwingen; alle 10 Einschwing-Stichproben stehen im Deckel", async () => {
  const v = torVault();
  mitKi();
  const r = await lauf(v);
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.equal(r.zahlen.uebernommen, 10);
  assert.deepEqual(uebernommen(v), ids(10, "f"), "in der Reihenfolge des Laufs: die ersten 10");
  assert.deepEqual(grund(v, "einschwingen"), ["f11", "f12", "f13", "f14"], "der Rest wartet");
  assert.ok(wartende(v).every((x) => x.id > "f10"));
  assert.equal(r.zahlen.wartenNeu, 4);
  assert.ok(P.leseAktionen(v).filter((a) => a.stufe === "uebernehmen").every((a) => a.einschwingen === true), "als Einschwing-Übernahme gekennzeichnet");
  assert.equal(einschwing(v).length, 10, "jede Übernahme sofort ihre Einzelprüfung");
  const s = R.sichtbare(v, { nutzung: new Map() });
  assert.deepEqual([s.fragen.length, s.wartend, s.fragen.every((f) => f.typ === "stichprobe")], [10, 0, true], "alle sichtbar, keine hinter dem Deckel");
  const wiki = readFileSync(join(v, SEITE), "utf8");
  assert.equal((wiki.match(/\[\[10_projekte\/belege\/2026-10\/f\d\d\]\]/g) || []).length, 10, "nur 10 Zeilen im Wiki");
  assert.doesNotMatch(wiki, /belege\/2026-10\/f1[1-4]/, "das Kontingent wirkt VOR dem Schreiben");
  const bericht = readFileSync(join(v, r.bericht), "utf8");
  assert.match(bericht, /Einschwingen 0\/20 geprüft · 10 offen/);
  assert.match(bericht, /einschwingen: 4/, "Wartegrund im Bericht");
});

test("zweiter Lauf ohne Antworten: 0 Übernahmen — die 4 Wartenden bleiben, nichts wird doppelt gefragt", async () => {
  const v = torVault();
  mitKi();
  await lauf(v);
  const r2 = await lauf(v, { jetzt: JETZT + 3600e3 });
  assert.equal(r2.status, "ok", JSON.stringify(r2));
  assert.equal(r2.zahlen.uebernommen, 0);
  assert.deepEqual(grund(v, "einschwingen"), ["f11", "f12", "f13", "f14"]);
  assert.equal(einschwing(v).length, 10);
  assert.equal(uebernommen(v).length, 10);
  assert.match(readFileSync(join(v, r2.bericht), "utf8"), /Einschwingen 0\/20 geprüft · 10 offen/);
  assert.equal(P.leseAktionen(v).filter((a) => a.stufe === "warten" && a.lauf === r2.lauf).length, 0, "kein neues Warten gemeldet — sie lagen schon dort");
});

test("nach 3× „stimmt“ sind 3 Plätze frei: genau 3 weitere Übernahmen, die übrigen warten weiter", async () => {
  const v = torVault();
  mitKi();
  await lauf(v);
  antworte(v, "stimmt", ["f01", "f02", "f03"]);
  const r = await lauf(v, { jetzt: JETZT + 3600e3 });
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.equal(r.zahlen.uebernommen, 3);
  assert.deepEqual(uebernommen(v), ids(13, "f"));
  assert.deepEqual(grund(v, "einschwingen"), ["f14"]);
  const s = E.einschwingStand(v);
  assert.deepEqual([s.R, s.F, s.O, s.frei], [3, 0, 10, 0], "wieder 10 offen: die Phase ist 3/20 geprüft");
  assert.match(readFileSync(join(v, r.bericht), "utf8"), /Einschwingen 3\/20 geprüft · 10 offen/);
});

test("„stimmt nicht“ in der Phase: Rücknahme, Autostufe sofort eng (noch im selben Lauf), Platz frei — F zählt nicht als R, die Phase verlängert sich", async () => {
  const v = torVault({ herkunft: (i) => (i === 10 ? "du" : "tool") });   // f11 hat nur Herkunft du → unter „eng“ kein Kandidat mehr
  mitKi();
  await lauf(v);
  assert.equal(AS.ladeAutostufe(v).stufe, "normal");
  antworte(v, "stimmt-nicht", ["f01"]);
  const r = await lauf(v, { jetzt: JETZT + 3600e3 });
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.equal(AS.ladeAutostufe(v).stufe, "eng", "vorsichtig, sofort");
  assert.equal(P.leseLetzter(v).autostufe, "eng");
  assert.match(git(v, "log", "--format=%s", "main").split("\n").find((s) => /^zurueck:/.test(s)) || "", /^zurueck: f01/, "bestehende Rücknahme");
  assert.doesNotMatch(readFileSync(join(v, SEITE), "utf8"), /belege\/2026-10\/f01\b/);
  const s = E.einschwingStand(v);
  assert.deepEqual([s.R, s.F], [0, 1], "F zählt nicht als R");
  assert.equal(r.zahlen.uebernommen, 1, "genau ein Platz war frei");
  assert.equal(uebernommen(v).includes("f12"), true, "f11 (Herkunft du) wartet unter eng, f12 (Werkzeug) rückt nach");
  assert.equal(B.ladeVorschlag(v, "_warten", "f11")?.wartenGrund, "autostufe-eng", "dieselbe Autostufe, schon in diesem Lauf");
  assert.deepEqual(grund(v, "einschwingen"), ["f13", "f14"]);
  assert.match(readFileSync(join(v, r.bericht), "utf8"), /Einschwingen 0\/20 geprüft · 10 offen · 1 falsch/);
  assert.equal(s.aktiv, true, "die Phase läuft weiter, bis N richtige vorliegen");
});

test("das Tor gilt nur für automatische 🟢-Übernahmen: was du selbst freigibst („übernehmen“ auf eine Rückfrage), wird auch bei geschlossenem Tor geschrieben und zählt nicht zur Phase", async () => {
  const v = torVault();
  legeVorschlagAn(v, { id: "h1", titel: "Orion Rechnung", text: "Orion kostet 1.200 € im Monat.", zitat: "Orion kostet uns 1.200 € im Monat", herkunft: "du", fundstelle: "s1#u-h1 2026-10-20T10:00:00Z" });
  mitKi();
  await lauf(v);
  assert.equal(E.einschwingStand(v).frei, 0, "Tor zu: 10 offen");
  const heikel = R.listeRueckfragen(v).find((x) => x.typ === "heikel");
  assert.ok(heikel, "h1 ist als Rückfrage gelandet");
  R.beantworte(v, heikel.id, "uebernehmen");
  const r2 = await lauf(v, { jetzt: JETZT + 3600e3 });
  assert.equal(r2.status, "ok", JSON.stringify(r2));
  assert.equal(r2.zahlen.uebernommen, 1);
  const a = P.leseAktionen(v).find((x) => x.id === "h1" && x.stufe === "uebernehmen");
  assert.deepEqual([a.auto, a.einschwingen], [false, undefined], "nach deiner Antwort, nicht als Einschwing-Übernahme");
  assert.match(readFileSync(join(v, SEITE), "utf8"), /belege\/2026-10\/h1/);
  assert.deepEqual([E.einschwingStand(v).A, E.einschwingStand(v).O], [10, 10], "die Phase zählt nur die zehn automatischen");
});

test("Phase endet bei R = N: danach kein Tor mehr, keine neuen Einzelprüfungen", async () => {
  const v = torVault({ einschwingen: 3 });
  mitKi();
  const r1 = await lauf(v);
  assert.equal(r1.zahlen.uebernommen, 3);
  assert.deepEqual(grund(v, "einschwingen"), Array.from({ length: 11 }, (_, i) => `f${String(i + 4).padStart(2, "0")}`), "11 warten");
  antworte(v, "stimmt", ["f01", "f02", "f03"]);
  const r2 = await lauf(v, { jetzt: JETZT + 3600e3 });
  assert.equal(r2.status, "ok", JSON.stringify(r2));
  assert.equal(r2.zahlen.uebernommen, 11, "kein Tor mehr: alle Wartenden auf einmal");
  assert.deepEqual(grund(v, "einschwingen"), []);
  assert.equal(einschwing(v).length, 0, "keine neuen Einzelprüfungen");
  const neue = P.leseAktionen(v).filter((a) => a.lauf === r2.lauf && a.stufe === "uebernehmen");
  assert.equal(neue.length, 11);
  assert.ok(neue.every((a) => a.einschwingen === undefined), "nicht mehr als Einschwing-Übernahme markiert");
  assert.equal(E.einschwingStand(v).aktiv, false);
  assert.match(readFileSync(join(v, r2.bericht), "utf8"), /Phase beendet/);
});

test("N = 0: kein Tor, keine Kennzeichnung, keine Einschwing-Stichproben", async () => {
  const v = torVault({ einschwingen: 0 });
  mitKi();
  const r = await lauf(v);
  assert.equal(r.zahlen.uebernommen, 14);
  assert.deepEqual(wartende(v), []);
  assert.deepEqual(R.listeRueckfragen(v).filter((x) => x.typ === "stichprobe"), []);
  assert.ok(P.leseAktionen(v).every((a) => a.einschwingen === undefined));
  assert.doesNotMatch(readFileSync(join(v, r.bericht), "utf8"), /Einschwingen/);
});

test("Probemodus: kein Tor, nichts gezählt, nichts angelegt — der Bericht nennt, wie viele 🟢 das Tor im echten Lauf jetzt durchließe", async () => {
  const v = torVault();
  const w = torVault();
  mitKi();
  const vorher = schnappschuss(v);
  const r = await lauf(v, { probe: true });
  assert.equal(r.modus, "probe");
  assert.equal(r.zahlen.uebernommen, 14, "die Probe rechnet alle 14 durch — das Tor gilt nur im echten Lauf");
  assert.equal(schnappschuss(v), vorher, "die Probe schreibt nichts");
  assert.deepEqual(R.listeRueckfragen(v), []);
  assert.ok(!existsSync(join(P.TL_DIR(v), "aktionen.jsonl")));
  assert.deepEqual(wartende(v), [], "nichts wartet wegen des Tors");
  assert.match(readFileSync(join(v, r.bericht), "utf8"), /Einschwingen: 10 von 14 würden jetzt übernommen/);
  assert.doesNotMatch(readFileSync(join(P.TL_DIR(v), "probe-aktionen.jsonl"), "utf8"), /"einschwingen":true/);
  // Mit schon offenen Prüfungen lässt das Tor weniger durch.
  schreibeJsonl(w, "aktionen.jsonl", ids(8, "o").map((id) => phase(id)));
  const r2 = await lauf(w, { probe: true });
  assert.match(readFileSync(join(w, r2.bericht), "utf8"), /Einschwingen: 2 von 14 würden jetzt übernommen/);
  // Phase aus oder beendet: keine Zeile.
  const aus = torVault({ einschwingen: 0 });
  const r3 = await lauf(aus, { probe: true });
  assert.doesNotMatch(readFileSync(join(aus, r3.bericht), "utf8"), /Einschwingen/);
});

test("kaputte Zustandsdateien: der Lauf bricht nicht ab, endet ok und zählt aus dem, was lesbar ist", async () => {
  const v = torVault();
  mitKi();
  schreibeRoh(v, "aktionen.jsonl", "{kaputt\n\u0000\n[1]\n");
  schreibeRoh(v, "pruefungen.jsonl", "nur Text\n");
  schreibeRoh(v, "einschwingen.json", "{kaputt");
  const r = await lauf(v);
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.equal(r.zahlen.uebernommen, 10, "als 0 gelesen: das Tor lässt 10 durch");
  assert.equal(einschwing(v).length, 10);
});

test("verlorene Rückfragen im Lauf: sie kommen zurück (neu angelegt), das Tor bleibt zu, bis sie beantwortet sind — es hängt nicht für immer", async () => {
  const v = torVault();
  mitKi();
  await lauf(v);
  for (const f of einschwing(v)) rmSync(f.datei);                      // alle 10 Fragen weg
  assert.equal(einschwing(v).length, 0);
  const r2 = await lauf(v, { jetzt: JETZT + 3600e3 });
  assert.equal(r2.zahlen.uebernommen, 0, "O = 10 gilt weiter — nichts Neues ohne Prüfung");
  assert.deepEqual(einschwing(v).map((x) => x.fm.aktion).sort(), ids(10, "f"), "alle zehn neu gestellt");
  antworte(v, "stimmt", ["f01", "f02"]);
  const r3 = await lauf(v, { jetzt: JETZT + 7200e3 });
  assert.equal(r3.zahlen.uebernommen, 2, "sobald geantwortet ist, geht es weiter");
});

test("N später erhöht: die Phase läuft ab dem Stand weiter; auf ≤ R gesenkt: beendet, kein Tor mehr", async () => {
  const v = torVault({ einschwingen: 3 });
  mitKi();
  await lauf(v);                                                       // 3 übernommen, 11 warten
  antworte(v, "stimmt", ["f01"]);
  const cfg = () => JSON.parse(readFileSync(join(v, "brain.config.json"), "utf8"));
  const setze = (n) => writeFileSync(join(v, "brain.config.json"), JSON.stringify({ ...cfg(), automatik: { ...cfg().automatik, einschwingen: n } }));
  setze(6);
  const r2 = await lauf(v, { jetzt: JETZT + 3600e3 });                 // R=1, O=2 → frei = min(6−1−2, 10−2) = 3
  assert.equal(r2.zahlen.uebernommen, 3);
  assert.equal(E.einschwingStand(v).aktiv, true);
  setze(1);                                                            // R=1 ≥ 1 → vorbei
  const r3 = await lauf(v, { jetzt: JETZT + 7200e3 });
  assert.equal(r3.zahlen.uebernommen, 8, "kein Tor mehr: der ganze Rest");
  assert.equal(E.einschwingStand(v).aktiv, false);
});

test("Absturz nach dem Merge und Einschwingphase: die nicht mehr angelegten Stichproben kommen beim nächsten Lauf nach (nichts geht verloren, nichts doppelt)", () => mitEigenemCache(async () => {
  const v = aufbau({ automatik: { tageslauf: "an" } });   // Standard: Einschwingphase an
  fakeKi(REGELN);
  hartAbbrechen(v);
  const uebernahmen = P.leseAktionen(v).filter((x) => x.stufe === "uebernehmen");
  assert.deepEqual(uebernahmen.map((x) => x.id).sort(), ["g1", "n1"]);
  assert.ok(uebernahmen.every((x) => x.einschwingen === true), "als Einschwing-Übernahme gekennzeichnet — schon im frühen Protokoll");
  assert.equal(einschwing(v).length, 0, "der Lauf starb vor der Stichprobe");
  assert.deepEqual([E.einschwingStand(v).O, E.einschwingStand(v).frei], [2, 8], "das Tor zählt die beiden Übernahmen trotzdem schon als offen");
  const r = await lauf(v, { jetzt: JETZT + 3600e3, nurAntworten: true });
  assert.equal(r.status, "ok", JSON.stringify(r));
  const l = einschwing(v);
  assert.deepEqual(l.map((x) => x.fm.aktion).sort(), ["g1", "n1"], "jetzt hat jede Übernahme ihre Einzelprüfung");
  await lauf(v, { jetzt: JETZT + 2 * 3600e3, nurAntworten: true });
  assert.equal(einschwing(v).length, 2, "kein zweites Mal angelegt");
}));
