// .tools/tests/test-tageslauf-autostufe-rueckweg.mjs — Rückweg aus der Autostufe „aus“ (B2, Folgepunkt N5). Spec §6.3: „aus“, wenn die Quote > 15 % ist — alles 🟢 wird zur
// Rückfrage; zurück eine Stufe nach 20 Prüfungen in Folge ohne Fehler. Ohne Rückweg wäre „aus“ eine Sackgasse: es entstehen keine Auto-Übernahmen und keine neuen
// Stichproben, also nie 20 Prüfungen. Darum tragen Kandidaten, die bei „normal“ 🟢 wären und nur wegen „aus“ zur Rückfrage werden, eine Markierung
// (quelle autostufe-rueckfrage); deine Antwort darauf zählt als Prüfung (übernehmen = Urteil richtig, verwerfen = falsch) in pruefungen.jsonl mit eigener
// quelle — und zählt NICHT als Einschwing-R.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { isoliere, neuerTestVault, legeVorschlagAn, seitenText, fakeKi, FAKE_BEFEHL, JETZT } from "./tageslauf-hilfe.mjs";
import { SEITE, lauf } from "./lauf-hilfe.mjs";
const A = await import("../tageslauf/antworten.mjs");
const AS = await import("../tageslauf/autostufe.mjs");
const E = await import("../tageslauf/einschwingen.mjs");
const P = await import("../tageslauf/protokoll.mjs");
const B = await import("../tageslauf/bestand.mjs");
const R = await import("../rueckfragen.mjs");
const M = await import("../tageslauf/morgen.mjs");
isoliere();

const STUNDE = 3600e3;
const ISO = (ms) => new Date(ms).toISOString();
const TAG = 86400e3;
const QUELLE = R.AUTOSTUFE_QUELLE;
const ctxFuer = (v, opt = {}) => P.neuerLauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT, ...opt });
const schreibeJsonl = (v, name, liste) => { mkdirSync(P.TL_DIR(v), { recursive: true }); writeFileSync(join(P.TL_DIR(v), name), liste.map((x) => JSON.stringify(x)).join("\n") + "\n"); };
const rueckweg = (v) => P.lesePruefungen(v).filter((p) => p.quelle === QUELLE);

// ------------------------------------------------------------------------------------------------ Markierung und Antwort
test("Konstanten und Erkennung: AUTOSTUFE_QUELLE ist ein eigener Wert; markiert ist eine heikel-Rückfrage mit quelle oder (ältere Rückfragen) mit grund autostufe-aus", () => {
  assert.equal(QUELLE, "autostufe-rueckfrage");
  assert.notEqual(QUELLE, R.EINSCHWING_QUELLE);
  assert.equal(R.istAutostufeRueckfrage({ typ: "heikel", quelle: QUELLE, grund: "heikel" }), true);
  assert.equal(R.istAutostufeRueckfrage({ typ: "heikel", quelle: "", grund: "autostufe-aus" }), true, "Rückfrage aus einem älteren Lauf, vor der Markierung");
  assert.equal(R.istAutostufeRueckfrage({ typ: "heikel", quelle: "", grund: "heikel" }), false);
  assert.equal(R.istAutostufeRueckfrage({ typ: "web", quelle: QUELLE, grund: "web" }), false, "nur heikel-Rückfragen tragen sie");
  assert.equal(R.istAutostufeRueckfrage({ typ: "stichprobe", quelle: QUELLE }), false);
});

const SEITEN = { [SEITE]: seitenText({ fm: { name: "orion", description: "Orion Testsystem" }, rumpf: "# Orion\n\nOrion ist das Testsystem.\n\n## Fakten\n\n- Orion läuft auf Port 3309 · Stand 01.10.2026 · [[x]]\n" }) };
function vaultMitFrage({ grund = "autostufe-aus", quelle = QUELLE, n = 1 } = {}) {
  const v = neuerTestVault({ automatik: { tageslauf: "an" }, seiten: SEITEN });
  const ctx = ctxFuer(v);
  const ids = [];
  for (let i = 0; i < n; i++) {
    legeVorschlagAn(v, { id: `v${i + 1}`, titel: `Orion Fakt ${i + 1}`, text: `Orion tut Sache ${i + 1}.`, zitat: `Orion tut Sache ${i + 1}`, herkunft: "du", fundstelle: `s1#u-v${i + 1} 2026-10-20T10:00:00Z` });
    const vo = B.ladeVorschlag(v, "_vorschlaege", `v${i + 1}`);
    ids.push(R.legeRueckfrageAn(ctx, { typ: "heikel", frage: `Übernehmen nach entitaet_orion.md: Orion Fakt ${i + 1}?`, seite: SEITE, grund, vorschlaege: [vo], ...(quelle ? { felder: { quelle } } : {}) }));
  }
  return { v, ids };
}

test("Antwort „übernehmen“ auf eine markierte Rückfrage: Prüfung RICHTIG (art rueckweg, eigene quelle), der Fakt wird wie bisher geschrieben; nie doppelt gezählt, auch wenn die Antwort erneut angewendet wird", () => {
  const { v, ids } = vaultMitFrage();
  R.beantworte(v, ids[0], "uebernehmen");
  const r = A.wendeAntwortenAn(ctxFuer(v));
  assert.equal(r.auftraege.length, 1, "der Fakt geht in den Schreibauftrag (nach deiner Antwort, nicht automatisch)");
  assert.deepEqual(rueckweg(v).map((p) => [p.art, p.quelle, p.fehler, p.ref, p.vorschlag]), [["rueckweg", QUELLE, false, ids[0], "v1"]]);
  A.wendeAntwortenAn(ctxFuer(v, { jetzt: JETZT + STUNDE }));   // Merge scheiterte, die Rückfrage ist noch offen → dieselbe Antwort wird erneut angewendet
  assert.equal(rueckweg(v).length, 1, "genau eine Prüfung");
  assert.ok(!("seite" in rueckweg(v)[0]), "ohne Seite: die Prüfung beanstandet keine ältere Übernahme auf dieser Seite");
});

test("Antwort „verwerfen“ auf eine markierte Rückfrage: Prüfung FALSCH; der Vorschlag wird abgelehnt wie bisher", () => {
  const { v, ids } = vaultMitFrage();
  R.beantworte(v, ids[0], "verwerfen");
  const r = A.wendeAntwortenAn(ctxFuer(v));
  assert.deepEqual(r.auftraege, []);
  assert.deepEqual(rueckweg(v).map((p) => [p.art, p.fehler, p.ref]), [["rueckweg", true, ids[0]]]);
  assert.ok(existsSync(join(v, "90_archiv", "vorschlaege-abgelehnt", "v1.md")));
});

test("Rückfragen ohne Markierung (heikel, kritisch, web, Lektion …) erzeugen keine Rückweg-Prüfung; eine ältere Rückfrage mit grund autostufe-aus (ohne quelle) schon", () => {
  const normal = vaultMitFrage({ grund: "heikel", quelle: "" });
  R.beantworte(normal.v, normal.ids[0], "uebernehmen");
  A.wendeAntwortenAn(ctxFuer(normal.v));
  assert.deepEqual(rueckweg(normal.v), []);
  assert.deepEqual(P.lesePruefungen(normal.v), []);
  const alt = vaultMitFrage({ grund: "autostufe-aus", quelle: "" });
  R.beantworte(alt.v, alt.ids[0], "uebernehmen");
  A.wendeAntwortenAn(ctxFuer(alt.v));
  assert.equal(rueckweg(alt.v).length, 1, "auch Rückfragen aus Läufen vor der Markierung bringen die Automatik zurück");
});

test("Probemodus: keine Prüfung; Themen-Ausschluss: eine Antwort „übernehmen“ auf einen Vorschlag mit ausgeschlossenem Wort zählt nicht", () => {
  const { v, ids } = vaultMitFrage();
  R.beantworte(v, ids[0], "uebernehmen");
  A.wendeAntwortenAn(ctxFuer(v, { probe: true }));
  assert.deepEqual(P.lesePruefungen(v), []);
  const t = vaultMitFrage();
  writeFileSync(join(t.v, "brain.config.json"), JSON.stringify({ ...JSON.parse(readFileSync(join(t.v, "brain.config.json"), "utf8")), automatik: { tageslauf: "an", ernteOhneThema: ["sache"] } }));
  R.beantworte(t.v, t.ids[0], "uebernehmen");
  A.wendeAntwortenAn(ctxFuer(t.v));
  assert.deepEqual(rueckweg(t.v), [], "das Wort steht im Vorschlag → gar nicht erst übernommen, also auch keine Prüfung");
});

test("die Rückweg-Prüfungen zählen NICHT als Einschwing-R/F/A und lösen keine Einschwing-Bremse aus", () => {
  const { v, ids } = vaultMitFrage({ n: 3 });
  R.beantworte(v, ids[0], "uebernehmen");
  R.beantworte(v, ids[1], "uebernehmen");
  R.beantworte(v, ids[2], "verwerfen");
  A.wendeAntwortenAn(ctxFuer(v));
  assert.equal(rueckweg(v).length, 3);
  const s = E.einschwingStand(v);
  assert.deepEqual([s.A, s.R, s.F, s.O], [0, 0, 0, 0]);
  const c = ctxFuer(v, { jetzt: JETZT + STUNDE });
  assert.equal(E.einschwingenBremse(c), false, "ein verworfener Kandidat ist kein falsch übernommener Fakt");
});

// ------------------------------------------------------------------------------------------------ Autostufe zählt sie, Rückwege
const pr = (fehler, t, extra = {}) => ({ zeit: ISO(t), art: "rueckweg", quelle: QUELLE, fehler, ref: `rf-${t}-${fehler}`, ...extra });
test("Autostufe: 20 fehlerfreie Rückweg-Prüfungen seit dem Wechsel stufen von aus auf eng hoch, 20 weitere von eng auf normal; ein verworfener Kandidat unterbricht die Reihe", () => {
  const seit = ISO(JETZT - 10 * TAG);
  const alt = { stufe: "aus", seit };
  const fehler = [{ zeit: ISO(JETZT - 20 * TAG), art: "stichprobe", fehler: true }, { zeit: ISO(JETZT - 19 * TAG), art: "stichprobe", fehler: true }];
  const rein = (n, ab) => Array.from({ length: n }, (_, i) => pr(false, JETZT - 9 * TAG + (ab + i) * 1000));
  assert.equal(AS.naechsteAutostufe(alt, [...fehler, ...rein(19, 0)], ISO(JETZT)).stufe, "aus", "19 reichen nicht");
  assert.equal(AS.naechsteAutostufe(alt, [...fehler, ...rein(20, 0)], ISO(JETZT)).stufe, "eng", "20 → eine Stufe hoch");
  const mitFehler = [...fehler, ...rein(10, 0), pr(true, JETZT - 9 * TAG + 99000), ...rein(19, 100)];
  assert.equal(AS.naechsteAutostufe(alt, mitFehler, ISO(JETZT)).stufe, "aus", "ein verworfener Kandidat in der Reihe: von vorn");
  assert.equal(AS.naechsteAutostufe(alt, [...mitFehler, ...rein(1, 200)], ISO(JETZT)).stufe, "eng", "20 danach: hoch");
  const eng = { stufe: "eng", seit };
  assert.equal(AS.naechsteAutostufe(eng, rein(20, 0), ISO(JETZT)).stufe, "normal");
});

test("rueckwegStand: wie viele fehlerfreie Prüfungen seit dem Wechsel, wie viele noch fehlen; normal → null", () => {
  const v = neuerTestVault();
  assert.equal(AS.rueckwegStand(v), null);
  const seit = ISO(JETZT - 5 * TAG);
  mkdirSync(P.TL_DIR(v), { recursive: true });
  writeFileSync(join(P.TL_DIR(v), "autostufe.json"), JSON.stringify({ stufe: "aus", seit }));
  schreibeJsonl(v, "pruefungen.jsonl", [pr(true, JETZT - 6 * TAG), ...Array.from({ length: 6 }, (_, i) => pr(false, JETZT - 4 * TAG + i * 1000)), pr(true, JETZT - 3 * TAG), ...Array.from({ length: 7 }, (_, i) => pr(false, JETZT - 2 * TAG + i * 1000))]);
  assert.deepEqual(AS.rueckwegStand(v), { stufe: "aus", folge: 7, noch: 13 });
});

// ------------------------------------------------------------------------------------------------ Reihenfolge der Rückfragen
test("markierte Rückfragen stehen NACH den übrigen heikel-Rückfragen (und kritisch-Prüfungen), vor veraltet/web — hinter zweifel, Widerspruch, Lektion", () => {
  const mk = (id, typ, quelle = "", erstellt = "2026-10-20T10:00:00Z", grund = "") => ({ id, typ, quelle, grund, erstellt, seite: "", fm: {} });
  const l = R.sortiere([mk("rf-a-heikel", "heikel", "", "2026-10-25T10:00:00Z"), mk("rf-b-auto", "heikel", QUELLE, "2026-10-01T10:00:00Z", "autostufe-aus"), mk("rf-c-lektion", "lektion"),
    mk("rf-d-zweifel", "zweifel"), mk("rf-e-web", "web"), mk("rf-f-ein", "stichprobe", R.EINSCHWING_QUELLE), mk("rf-g-alt", "heikel", "", "2026-10-02T10:00:00Z", "autostufe-aus"),
    mk("rf-h-veraltet", "veraltet")]);
  assert.deepEqual(l.map((x) => x.id), ["rf-f-ein", "rf-d-zweifel", "rf-c-lektion", "rf-a-heikel", "rf-b-auto", "rf-g-alt", "rf-h-veraltet", "rf-e-web"],
    "echte heikel zuerst (auch wenn jünger), dann die markierten (auch ältere Rückfragen mit grund autostufe-aus), dann veraltet, dann web");
  assert.ok(R.sortiere([mk("x", "heikel", QUELLE)])[0] && R.AUTOSTUFE_RANG > R.TYPEN.heikel.rang && R.AUTOSTUFE_RANG < R.TYPEN.veraltet.rang, "Rang liegt zwischen heikel und veraltet");
});

test("3 heikel + 12 markierte Autostufe-Rückfragen: der Deckel (10) zeigt ALLE 3 heikel, dazu 7 markierte; 5 markierte warten", () => {
  const v = neuerTestVault();
  const ctx = P.neuerLauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT });
  for (let i = 0; i < 12; i++) R.legeRueckfrageAn(ctx, { typ: "heikel", frage: `Markiert ${i}`, grund: "autostufe-aus", felder: { quelle: QUELLE } });
  const spaeter = P.neuerLauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT + 3600e3 });          // die echten heikel sind JÜNGER: nur der Rang entscheidet
  for (let i = 0; i < 3; i++) R.legeRueckfrageAn(spaeter, { typ: "heikel", frage: `Heikel ${i}`, grund: "heikel" });
  const s = R.sichtbare(v, { nutzung: new Map() });
  assert.equal(s.fragen.length, 10);
  assert.equal(s.fragen.filter((f) => /^Heikel /.test(f.frage)).length, 3, "alle 3 heikel sichtbar");
  assert.deepEqual(s.fragen.slice(0, 3).map((f) => f.frage).sort(), ["Heikel 0", "Heikel 1", "Heikel 2"], "und zwar ganz vorn");
  assert.equal(s.fragen.filter((f) => R.istAutostufeRueckfrage(f)).length, 7);
  assert.equal(s.wartend, 5);
});

// ------------------------------------------------------------------------------------------------ ganzer Lauf: aus → markierte Rückfragen → Antworten → Stufe hoch → Einschwingen läuft weiter
const SILBEN = ["ka", "ro", "mi", "tu", "be", "so", "la", "ne", "vi", "pa"];
const wort = (i) => { const w = `${SILBEN[i % 10]}${SILBEN[Math.floor(i / 10) % 10]}lon`; return w[0].toUpperCase() + w.slice(1); };
const neu = '{"urteil":"neu","zitatStuetzt":true,"passtZurSeite":true,"dauerhaft":true}';
function kandidat(v, id, i, herkunft = "tool") {
  const satz = `Orion pflegt das Modul ${wort(i)} im Raum ${wort(i + 37)} sorgfältig`;
  legeVorschlagAn(v, { id, titel: `Orion ${wort(i)}`, text: `${satz}.`, zitat: satz, herkunft, fundstelle: `s1#u-${id} 2026-10-20T10:00:00Z` });
}
const idn = (vor, i) => `${vor}${String(i + 1).padStart(2, "0")}`;
const einschwing = (v) => R.listeRueckfragen(v).filter((x) => x.typ === "stichprobe" && x.quelle === R.EINSCHWING_QUELLE);
const frageZu = (v, id) => einschwing(v).find((x) => x.fm.aktion === id);
const markierte = (v) => R.listeRueckfragen(v).filter((x) => R.istAutostufeRueckfrage(x) && !x.antwort);
const letzterBericht = (v, r) => readFileSync(join(v, r.bericht), "utf8").split("\n## Lauf ").pop();

test("zwei „stimmt nicht“ → aus → markierte Rückfragen → 20 richtige Antworten → eng → die Einschwingphase läuft weiter und endet regulär; Rückweg-Antworten zählen nie als Einschwing-R", async () => {
  // Budget gross: auch bei „aus“ urteilt der Richter zuerst über jeden Kandidaten (Richter-Budget je Lauf: normal 15, gross 30) — 20+ markierte Rückfragen in EINEM Lauf brauchen gross.
  const v = neuerTestVault({ automatik: { tageslauf: "an", einschwingen: 10, tageslaufBudget: "gross" }, seiten: SEITEN });
  mkdirSync(join(v, ".logs"), { recursive: true });
  writeFileSync(join(v, ".logs", "aliasse.json"), JSON.stringify({ orion: SEITE }));
  for (let i = 0; i < 36; i++) kandidat(v, idn("f", i), i);
  fakeKi([{ wenn: "FAKT:", antwort: neu }]);
  const tag = (n) => ({ jetzt: JETZT + n * STUNDE });
  const r1 = await lauf(v, tag(0));
  assert.equal(r1.zahlen.uebernommen, 10, JSON.stringify(r1));
  // Lauf 2: erster Fehler → eng (Einschwing-Bremse), ein Platz wird frei.
  R.beantworte(v, frageZu(v, "f01").id, "stimmt-nicht");
  R.beantworte(v, frageZu(v, "f03").id, "stimmt");
  const r2 = await lauf(v, tag(1));
  assert.equal(AS.ladeAutostufe(v).stufe, "eng", "erster Fehler: eng");
  assert.equal(r2.zahlen.uebernommen, 1);
  // Lauf 3: zweiter Fehler in einem späteren Lauf → die reguläre Quote schaltet auf aus.
  R.beantworte(v, frageZu(v, "f02").id, "stimmt-nicht");
  R.beantworte(v, frageZu(v, "f04").id, "stimmt");
  const r3 = await lauf(v, tag(2));
  assert.equal(AS.ladeAutostufe(v).stufe, "aus", `zweiter Fehler → aus: ${JSON.stringify(AS.ladeAutostufe(v))}`);
  assert.equal(P.leseLetzter(v).autostufe, "aus");
  const vorher = E.einschwingStand(v);
  assert.deepEqual([vorher.A, vorher.R, vorher.F, vorher.O], [12, 2, 2, 8]);
  // Lauf 4: Autostufe aus — nichts wird automatisch übernommen, jeder 🟢-Kandidat wird eine MARKIERTE Rückfrage.
  const r4 = await lauf(v, tag(3));
  assert.equal(r4.zahlen.uebernommen, 0, "aus: keine Auto-Übernahme");
  const m = markierte(v);
  assert.ok(m.length >= 20, `genug markierte Rückfragen für den Rückweg: ${m.length}`);
  assert.ok(m.every((x) => x.quelle === QUELLE && x.grund === "autostufe-aus" && x.typ === "heikel"));
  assert.match(m[0].beschreibung, /gerade aus.*Automatik zurück/s, "sagt, dass die Antwort der Automatik hilft");
  assert.match(M.morgenZeile(v, { jetzt: JETZT + 3 * STUNDE }), /Autostufe aus: Fehlerquote 2\/\d+ — Rückfragen beantworten bringt die Automatik zurück/);
  assert.match(letzterBericht(v, r4), /Autostufe aus: Fehlerquote 2\/\d+ — noch 20 fehlerfreie Prüfungen bis zur nächsten Stufe; \d+ markierte Rückfragen warten — Rückfragen beantworten bringt die Automatik zurück/);
  // Lauf 5: 20 Rückfragen mit „übernehmen“ beantwortet = 20 richtige Urteile.
  const antworten = m.slice(0, 20);
  for (const x of antworten) R.beantworte(v, x.id, "uebernehmen");
  const r5 = await lauf(v, tag(4));
  assert.equal(r5.status, "ok", JSON.stringify(r5));
  assert.equal(rueckweg(v).length, 20);
  assert.ok(rueckweg(v).every((p) => p.fehler === false));
  assert.equal(AS.ladeAutostufe(v).stufe, "eng", "20 in Folge fehlerfrei → eine Stufe hoch");
  assert.equal(P.leseLetzter(v).autostufe, "eng");
  const mitten = E.einschwingStand(v);
  assert.deepEqual([mitten.A, mitten.R, mitten.F, mitten.O], [12, 2, 2, 8], "die 20 Rückweg-Antworten zählen nicht als Einschwing-R");
  assert.equal(P.leseAktionen(v).filter((a) => a.stufe === "uebernehmen" && a.auto === false).length, 20, "die 20 Fakten stehen nach deiner Antwort im Wiki");
  assert.doesNotMatch(M.morgenZeile(v, { jetzt: JETZT + 4 * STUNDE }) || "", /Autostufe aus/);
  // Lauf 6: Einschwingen läuft weiter — die offenen Einzelprüfungen werden beantwortet, die Phase endet bei R = N, neue Werkzeug-Belege gehen unter „eng“ wieder automatisch durch.
  for (const id of ["f05", "f06", "f07", "f08", "f09", "f10", "f11", "f12"]) R.beantworte(v, frageZu(v, id).id, "stimmt");
  for (let i = 0; i < 4; i++) kandidat(v, idn("g", i), 60 + i);
  const r6 = await lauf(v, tag(5));
  assert.equal(r6.status, "ok", JSON.stringify(r6));
  const ende = E.einschwingStand(v);
  assert.deepEqual([ende.R, ende.aktiv], [10, false], "R = N: Phase beendet (regulär, durch deine Antworten)");
  assert.equal(r6.zahlen.uebernommen, 4, "die Automatik arbeitet wieder (eng: Werkzeug-Belege)");
  assert.ok(P.leseAktionen(v).filter((a) => a.lauf === r6.lauf && a.stufe === "uebernehmen").every((a) => a.auto === true && a.einschwingen === undefined));
});

test("kein Rückweg ohne Antworten: ohne beantwortete Rückfragen bleibt „aus“ stehen (und sagt es laut), mit einem verworfenen Kandidaten fängt die Reihe von vorn an", async () => {
  const v = neuerTestVault({ automatik: { tageslauf: "an", einschwingen: 0, tageslaufBudget: "gross" }, seiten: SEITEN });   // gross: der Richter urteilt auch bei „aus“ zuerst (15 je Lauf bei normal)
  mkdirSync(join(v, ".logs"), { recursive: true });
  writeFileSync(join(v, ".logs", "aliasse.json"), JSON.stringify({ orion: SEITE }));
  mkdirSync(P.TL_DIR(v), { recursive: true });
  writeFileSync(join(P.TL_DIR(v), "autostufe.json"), JSON.stringify({ stufe: "aus", seit: ISO(JETZT - 2 * TAG) }));
  schreibeJsonl(v, "pruefungen.jsonl", [{ zeit: ISO(JETZT - 3 * TAG), art: "stichprobe", fehler: true, ref: "a" }, { zeit: ISO(JETZT - 3 * TAG + 1000), art: "stichprobe", fehler: true, ref: "b" }]);
  for (let i = 0; i < 22; i++) kandidat(v, idn("h", i), i, i % 2 ? "du" : "tool");
  fakeKi([{ wenn: "FAKT:", antwort: neu }]);
  const r1 = await lauf(v);
  assert.equal(r1.zahlen.uebernommen, 0);
  assert.equal(markierte(v).length, 22, "alle 22 (Werkzeug-Beleg wie du-Aussage) → markierte Rückfragen");
  const r2 = await lauf(v, { jetzt: JETZT + STUNDE });
  assert.equal(AS.ladeAutostufe(v).stufe, "aus", "ohne Antworten bleibt es dabei");
  assert.equal(markierte(v).length, 22, "nichts doppelt gestellt");
  assert.match(M.morgenZeile(v, { jetzt: JETZT + STUNDE }), /Autostufe aus: Fehlerquote 2\/2 — Rückfragen beantworten bringt die Automatik zurück/);
  const alle = markierte(v);
  R.beantworte(v, alle[0].id, "verwerfen");
  for (const x of alle.slice(1, 20)) R.beantworte(v, x.id, "uebernehmen");        // 19 richtig nach einem Fehler
  await lauf(v, { jetzt: JETZT + 2 * STUNDE });
  assert.equal(AS.ladeAutostufe(v).stufe, "aus", "ein verworfener Kandidat vorn: 19 in Folge reichen nicht");
  R.beantworte(v, alle[20].id, "uebernehmen");
  await lauf(v, { jetzt: JETZT + 3 * STUNDE });
  assert.equal(AS.ladeAutostufe(v).stufe, "eng", "20 in Folge nach dem Fehler → hoch");
});

test("Probemodus legt keine Markierung an und ändert nichts an der Autostufe; unter „eng“ bleiben Nicht-Werkzeug-Kandidaten wie bisher wartend (ohne Rückfrage)", async () => {
  const v = neuerTestVault({ automatik: { tageslauf: "an", einschwingen: 0 }, seiten: SEITEN });
  mkdirSync(join(v, ".logs"), { recursive: true });
  writeFileSync(join(v, ".logs", "aliasse.json"), JSON.stringify({ orion: SEITE }));
  mkdirSync(P.TL_DIR(v), { recursive: true });
  writeFileSync(join(P.TL_DIR(v), "autostufe.json"), JSON.stringify({ stufe: "eng", seit: ISO(JETZT - 2 * TAG) }));
  kandidat(v, "e01", 1, "du");
  kandidat(v, "e02", 2, "tool");
  fakeKi([{ wenn: "FAKT:", antwort: neu }]);
  const r = await lauf(v);
  assert.equal(r.zahlen.uebernommen, 1, "Werkzeug-Beleg geht unter eng automatisch durch");
  assert.equal(B.ladeVorschlag(v, "_warten", "e01")?.wartenGrund, "autostufe-eng");
  assert.deepEqual(markierte(v), []);
  const p = neuerTestVault({ automatik: { tageslauf: "an", einschwingen: 0 }, seiten: SEITEN });
  mkdirSync(join(p, ".logs"), { recursive: true });
  writeFileSync(join(p, ".logs", "aliasse.json"), JSON.stringify({ orion: SEITE }));
  mkdirSync(P.TL_DIR(p), { recursive: true });
  const aus = JSON.stringify({ stufe: "aus", seit: ISO(JETZT - 2 * TAG) });
  writeFileSync(join(P.TL_DIR(p), "autostufe.json"), aus);
  kandidat(p, "e01", 1, "du");
  const rp = await lauf(p, { probe: true });
  assert.equal(rp.modus, "probe");
  assert.deepEqual(R.listeRueckfragen(p), [], "die Probe legt keine Rückfrage an");
  assert.equal(readFileSync(join(P.TL_DIR(p), "autostufe.json"), "utf8"), aus);
});
