// .tools/tests/test-tageslauf-antworten.mjs — Schritt 0 (Antworten anwenden), W7-Eingang, Schritt 9 (Lektionen) (B2, Task 10).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { isoliere, neuerTestVault, legeVorschlagAn, seitenText, fakeKi, schnappschuss, FAKE_BEFEHL, JETZT } from "./tageslauf-hilfe.mjs";
const A = await import("../tageslauf/antworten.mjs");
const L = await import("../tageslauf/lektionen-schritt.mjs");
const R = await import("../rueckfragen.mjs");
const B = await import("../tageslauf/bestand.mjs");
const P = await import("../tageslauf/protokoll.mjs");
const { listeEntscheidungen } = await import("../entscheidungen.mjs");
isoliere();
const SEITE = "09_wiki/projekte/entitaet_alpha.md";
const ctxFuer = (v, opt = {}) => P.neuerLauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT, ...opt });
const vo = (v, id, extra = {}) => { legeVorschlagAn(v, { id, ...extra }); return B.ladeVorschlag(v, "_vorschlaege", id); };
const frage = (v, ctx, typ, antwort, extra = {}, notiz = "") => {
  const id = R.legeRueckfrageAn(ctx, { typ, frage: `${typ}?`, seite: SEITE, ...extra });
  R.beantworte(v, id, antwort, notiz);
  return id;
};
const vault = () => neuerTestVault({ seiten: { [SEITE]: seitenText({ fm: { name: "alpha" }, rumpf: "# Alpha\n\n- Port 3309 · Stand 01.10.2026 · [[x]]\n" }) } });
const offen = (v) => R.listeRueckfragen(v).map((r) => r.id);
const lektionenDatei = (v) => { try { return readFileSync(join(v, "09_wiki", "_lektionen.md"), "utf8"); } catch { return ""; } };

test("heikel/web: übernehmen → Schreibauftrag (Rückfrage bleibt bis zum Merge); verwerfen → abgelehnt; kritisch → Inbox-Wurzel", () => {
  const v = vault();
  const ctx = ctxFuer(v);
  const h = frage(v, ctx, "heikel", "uebernehmen", { vorschlaege: [vo(v, "h1")], grund: "heikel" });
  const w = frage(v, ctx, "web", "verwerfen", { vorschlaege: [vo(v, "w1")] });
  const k = frage(v, ctx, "heikel", "uebernehmen", { vorschlaege: [vo(v, "k1")], grund: "kritisch" });
  const r = A.wendeAntwortenAn(ctx);
  assert.deepEqual(r.auftraege.map((a) => [a.art, a.seite, a.v.id, a.ref, a.rueckfrage.id]), [["fakt", SEITE, "h1", h, h]]);
  assert.deepEqual(offen(v), [h]);
  assert.ok(existsSync(join(v, "90_archiv", "vorschlaege-abgelehnt", "w1.md")));
  assert.ok(existsSync(join(v, "00_inbox", "k1.md")));
  assert.ok(existsSync(join(v, "90_archiv", "rueckfragen-erledigt", `${w}.md`)));
  assert.ok(existsSync(join(v, "90_archiv", "rueckfragen-erledigt", `${k}.md`)));
  assert.equal(ctx.aktionen.findLast((a) => a.id === "k1").stufe, "inbox");
});

test("heikel/web „übernehmen“ ohne Zielseite → Inbox-Wurzel (nichts geraten); art stand → Stand-Auftrag; andere Art → kein Schreiben", () => {
  const v = vault();
  const ctx = ctxFuer(v);
  frage(v, ctx, "web", "uebernehmen", { vorschlaege: [vo(v, "o1")], seite: "" });
  const s = frage(v, ctx, "heikel", "uebernehmen", { vorschlaege: [vo(v, "s1", { art: "stand" })] });
  const l = frage(v, ctx, "heikel", "uebernehmen", { vorschlaege: [vo(v, "l1", { art: "lektion", titel: "Nur Lektion", regel: "Immer lesen." })] });
  const r = A.wendeAntwortenAn(ctx);
  assert.deepEqual(r.auftraege.map((a) => [a.art, a.v.id, a.ref]), [["stand", "s1", s]]);
  assert.ok(existsSync(join(v, "00_inbox", "o1.md")));
  assert.ok(existsSync(join(v, "00_inbox", "_rueckfragen", "vorschlaege", "l1.md")), "Lektion wird nicht als Fakt geschrieben");
  assert.ok(offen(v).includes(l), "Rückfrage mit unpassender Art bleibt sichtbar offen");
  assert.ok(ctx.aktionen.some((a) => a.stufe === "fehler" && a.rueckfrage === l));
  assert.equal(r.fehler, 1);
});

test("widerspruch: A → abgelehnt, B → ersetzen mit Zeile, beide → Fakt, weiß nicht → aussortiert", () => {
  const v = vault();
  const ctx = ctxFuer(v);
  const zeile = "- Port 3309 · Stand 01.10.2026 · [[x]]";
  frage(v, ctx, "widerspruch", "a", { vorschlaege: [vo(v, "a1")], zeile });
  frage(v, ctx, "widerspruch", "b", { vorschlaege: [vo(v, "b1")], zeile });
  frage(v, ctx, "widerspruch", "beide", { vorschlaege: [vo(v, "c1")], zeile });
  frage(v, ctx, "widerspruch", "weiss-nicht", { vorschlaege: [vo(v, "d1")], zeile });
  const r = A.wendeAntwortenAn(ctx);
  assert.deepEqual(r.auftraege.map((a) => [a.art, a.v.id, a.zeile || ""]).sort(), [["ersetzen", "b1", zeile], ["fakt", "c1", ""]]);
  assert.ok(existsSync(join(v, "90_archiv", "vorschlaege-abgelehnt", "a1.md")));
  assert.ok(existsSync(join(v, "90_archiv", "vorschlaege-aussortiert", "weiss-nicht", "d1.md")));
  assert.equal(offen(v).length, 2);
});

test("W7-Eingang: je Seite ein Zweifel (Feld-Auftrag + Rückfrage), Fehler nur bei automatischer Übernahme ≤ 60 Tage; Offset", () => {
  const v = vault();
  mkdirSync(join(v, ".logs"), { recursive: true });
  const w7 = (uuid, seite = SEITE) => JSON.stringify({ v: 1, seite, sitzung: "s9", uuid, zeit: "2026-10-21T12:00:00Z", zitat: "Das stimmt nicht, Port ist 3311" });
  writeFileSync(join(v, ".logs", "w7.jsonl"), [w7("u1"), w7("u2"), w7("u3", "09_wiki/gibtsnicht.md")].join("\n") + "\n");
  const aktionen = [{ id: "x1", stufe: "uebernehmen", auto: true, commit: "c1", ziel: SEITE, zeit: "2026-10-01T00:00:00Z" }];
  const ctx = ctxFuer(v);
  const r = A.w7Eingang(ctx, { aktionen });
  assert.equal(r.neu, 3);
  assert.deepEqual(r.auftraege.map((a) => [a.art, a.seite, a.feld, a.wert]), [["feld", SEITE, "zweifel", `${ctx.heute}: Das stimmt nicht, Port ist 3311`]]);
  const [rf] = R.listeRueckfragen(v);
  assert.deepEqual([rf.typ, rf.seite], ["zweifel", SEITE]);
  assert.deepEqual(P.lesePruefungen(v).map((p) => [p.art, p.fehler, p.ref]), [["w7", true, rf.id]]);
  assert.equal(A.w7Eingang(ctxFuer(v), { aktionen }).neu, 0);
  writeFileSync(join(v, ".logs", "w7.jsonl"), w7("u4") + "\n", { flag: "a" });
  assert.equal(A.w7Eingang(ctxFuer(v, { probe: true }), { aktionen }).neu, 1);
  assert.equal(JSON.parse(readFileSync(join(P.TL_DIR(v), "w7-stand.json"), "utf8")).gelesen, 3, "Probe rückt nicht vor");
  R.beantworte(v, rf.id, "stimmt");
  const z = A.wendeAntwortenAn(ctxFuer(v));
  assert.deepEqual(z.auftraege.map((a) => [a.art, a.feld, a.wert]), [["feld", "zweifel", null]]);
  assert.deepEqual(P.lesePruefungen(v), [], "Seite stimmt doch → W7-Fehler aufgehoben");
});

test("W7-Eingang: kein Fehler ohne automatische Übernahme, vor ihr oder nach 60 Tagen; Seiten außerhalb des Wikis werden nicht angefasst", () => {
  const v = vault();
  mkdirSync(join(v, ".logs"), { recursive: true });
  const w7 = (uuid, zeit, seite) => JSON.stringify({ v: 1, seite, sitzung: "s9", uuid, zeit, zitat: "Stimmt nicht" });
  writeFileSync(join(v, ".logs", "w7.jsonl"), [w7("u1", "2026-10-21T12:00:00Z", SEITE), w7("u2", "2026-10-21T12:00:00Z", "brain.config.json"), w7("u3", "2026-10-21T12:00:00Z", "09_wiki/../brain.config.json")].join("\n") + "\n");
  const handHochgeladen = [{ id: "x1", stufe: "uebernehmen", auto: false, commit: "c1", ziel: SEITE, zeit: "2026-10-01T00:00:00Z" }];   // nach deiner Antwort, nicht automatisch
  const alt = [{ id: "x2", stufe: "uebernehmen", auto: true, commit: "c2", ziel: SEITE, zeit: "2026-08-01T00:00:00Z" }];                  // > 60 Tage vor der Korrektur
  const spaeter = [{ id: "x3", stufe: "uebernehmen", auto: true, commit: "c3", ziel: SEITE, zeit: "2026-10-22T00:00:00Z" }];               // erst NACH der Korrektur
  const ctx = ctxFuer(v);
  const r = A.w7Eingang(ctx, { aktionen: [...handHochgeladen, ...alt, ...spaeter] });
  assert.deepEqual(r.auftraege.map((a) => a.seite), [SEITE], "nur die Wiki-Seite");
  assert.deepEqual(P.lesePruefungen(v), []);
});

test("zweifel „falsch“ mit Notiz → Zweifel mit deiner Notiz; veraltet → stand bzw. zweifel", () => {
  const v = vault();
  const ctx = ctxFuer(v);
  frage(v, ctx, "zweifel", "falsch", {}, "Port ist 3311, nicht 3309");
  frage(v, ctx, "veraltet", "stimmt-noch");
  frage(v, ctx, "veraltet", "ueberholt");
  const r = A.wendeAntwortenAn(ctx);
  assert.deepEqual(r.auftraege.map((a) => [a.feld, a.wert]).sort(), [["stand", ctx.heute], ["zweifel", `${ctx.heute}: Port ist 3311, nicht 3309`], ["zweifel", `${ctx.heute}: überholt (Rückfrage)`]]);
});

test("zweifel „falsch“ ohne Notiz: Seite wird trotzdem prüfbedürftig (Zweifel bleibt bzw. wird gesetzt), die Antwort geht nicht verloren", () => {
  const mit = vault();
  const ctxMit = ctxFuer(mit);
  frage(mit, ctxMit, "zweifel", "falsch");
  const r1 = A.wendeAntwortenAn(ctxMit);
  assert.equal(r1.auftraege.length, 1);
  assert.deepEqual([r1.auftraege[0].feld, r1.auftraege[0].wert], ["zweifel", `${ctxMit.heute}: als falsch gemeldet (Rückfrage)`]);
  // Die Seite trägt schon einen Zweifel (z. B. aus W7) → nichts überschreiben, Rückfrage erledigt.
  const v = neuerTestVault({ seiten: { [SEITE]: seitenText({ fm: { name: "alpha", zweifel: "2026-10-21: Port ist 3311" }, rumpf: "# Alpha\n" }) } });
  const ctx = ctxFuer(v);
  const id = frage(v, ctx, "zweifel", "falsch");
  const r2 = A.wendeAntwortenAn(ctx);
  assert.deepEqual(r2.auftraege, []);
  assert.ok(existsSync(join(v, "90_archiv", "rueckfragen-erledigt", `${id}.md`)));
});

test("konflikt: A → Entscheidung im Auftragsordner; später → ruht 30 Tage, wird nicht gezeigt und nicht neu angelegt", () => {
  const kasten = (a, b) => `> [!KONFLIKT] offen — Du entscheidest\n> A: "${a}" — Quelle: [[q-a]]\n> B: "${b}" — Quelle: [[q-b]]\n`;
  const v = neuerTestVault({ seiten: {
    "09_wiki/wissen/thema_k.md": seitenText({ fm: { name: "k" }, rumpf: `# K\n\n${kasten("Port 3309", "Port 3310")}` }),
    "09_wiki/wissen/thema_l.md": seitenText({ fm: { name: "l" }, rumpf: `# L\n\n${kasten("täglich", "stündlich")}` }) } });
  const ctx = ctxFuer(v);
  assert.equal(R.konfliktRueckfragen(ctx), 2);
  const [k, l] = R.listeRueckfragen(v).sort((x, y) => x.seite.localeCompare(y.seite));
  R.beantworte(v, k.id, "a");
  R.beantworte(v, l.id, "spaeter");
  assert.deepEqual(A.wendeAntwortenAn(ctx).auftraege, []);
  const e = listeEntscheidungen(v);
  assert.deepEqual(e.map((x) => [x.wahl, x.seite]), [["a", "09_wiki/wissen/thema_k.md"]]);
  const rest = R.listeRueckfragen(v);
  assert.deepEqual(rest.map((r) => [r.id, r.antwort]), [[l.id, ""]]);
  assert.ok(String(rest[0].fm.ruhen_bis) > ctx.heute);
  assert.equal(R.sichtbare(v, { jetzt: JETZT, nutzung: new Map() }).fragen.length, 0);
  assert.equal(R.konfliktRueckfragen(ctxFuer(v)), 0);
});

test("konflikt: Seite inzwischen geändert → keine Entscheidung an fremdem Kasten, Rückfrage erledigt (neuer Kasten wird neu gefragt)", () => {
  const kasten = (a, b) => `> [!KONFLIKT] offen — Du entscheidest\n> A: "${a}" — Quelle: [[q-a]]\n> B: "${b}" — Quelle: [[q-b]]\n`;
  const rel = "09_wiki/wissen/thema_k.md";
  const v = neuerTestVault({ seiten: { [rel]: seitenText({ fm: { name: "k" }, rumpf: `# K\n\n${kasten("Port 3309", "Port 3310")}` }) } });
  const ctx = ctxFuer(v);
  R.konfliktRueckfragen(ctx);
  const [k] = R.listeRueckfragen(v);
  R.beantworte(v, k.id, "b");
  writeFileSync(join(v, rel), seitenText({ fm: { name: "k" }, rumpf: `# K\n\n${kasten("Port 4000", "Port 4001")}` }));
  A.wendeAntwortenAn(ctx);
  assert.equal(listeEntscheidungen(v).length, 0);
  assert.deepEqual(offen(v), []);
  assert.equal(R.konfliktRueckfragen(ctxFuer(v)), 1);
});

test("lektion: aktivieren → _lektionen.md (mit Gilt für) und archiviert; ändern → deine Formulierung; verwerfen → abgelehnt", () => {
  const v = vault();
  const ctx = ctxFuer(v);
  const lek = (id, titel) => vo(v, id, { art: "lektion", titel, regel: "Vor dem Commit Tests laufen lassen.", warum: "Zweimal vergessen.", wie: "Vor git commit." });
  const felder = (titel) => ({ titel, regel: "Vor dem Commit Tests laufen lassen.", warum: "Zweimal vergessen.", wie: "Vor git commit.", gilt_fuer: ["*.mjs"] });
  frage(v, ctx, "lektion", "aktivieren", { vorschlaege: [lek("l1", "Tests zuerst")], felder: felder("Tests zuerst") });
  frage(v, ctx, "lektion", "aendern", { vorschlaege: [lek("l2", "Commit klein")], felder: felder("Commit klein") }, "Ein Thema je Commit.");
  frage(v, ctx, "lektion", "verwerfen", { vorschlaege: [lek("l3", "Unsinn")], felder: felder("Unsinn") });
  A.wendeAntwortenAn(ctx);
  const w = lektionenDatei(v);
  assert.match(w, /- \*\*Tests zuerst\*\* — Vor dem Commit Tests laufen lassen\.\n.*\n  Gilt für: `\*\.mjs`/);
  assert.match(w, /- \*\*Commit klein\*\* — Ein Thema je Commit\./);
  assert.doesNotMatch(w, /Unsinn/);
  assert.ok(existsSync(join(v, "90_archiv", "lektionen-erledigt", "l1.md")));
  assert.ok(existsSync(join(v, "90_archiv", "vorschlaege-abgelehnt", "l3.md")));
  assert.deepEqual(offen(v), []);
});

test("lektion: ohne Ja wird nichts aktiv — unbeantwortet, verworfen, „ändern“ ohne deine Formulierung (handgeänderte Datei)", () => {
  const v = vault();
  const ctx = ctxFuer(v);
  const lek = (id) => vo(v, id, { art: "lektion", titel: id, regel: "Regel von der KI.", warum: "w", wie: "w" });
  const felder = { titel: "Regel", regel: "Regel von der KI.", warum: "w", wie: "w", gilt_fuer: [] };
  const unbeantwortet = R.legeRueckfrageAn(ctx, { typ: "lektion", frage: "Aktivieren?", seite: "", vorschlaege: [lek("u1")], felder });
  frage(v, ctx, "lektion", "verwerfen", { vorschlaege: [lek("u2")], felder, seite: "" });
  const ohneText = R.legeRueckfrageAn(ctx, { typ: "lektion", frage: "Ändern?", seite: "", vorschlaege: [lek("u3")], felder });
  const dat = R.listeRueckfragen(v).find((r) => r.id === ohneText);
  writeFileSync(dat.datei, B.schreibeFm({ ...dat.fm, antwort: "aendern", notiz: "" }, dat.rumpf));   // am Skill vorbei: „ändern“ ohne Text
  const r = A.wendeAntwortenAn(ctx);
  assert.equal(lektionenDatei(v), "", "keine Lektion aktiv");
  assert.ok(existsSync(join(v, "00_inbox", "_rueckfragen", "vorschlaege", "u1.md")));
  assert.deepEqual(offen(v).sort(), [unbeantwortet, ohneText].sort());
  assert.equal(r.fehler, 1);
});

test("stichprobe: stimmt → Prüfung ok; stimmt nicht → Prüfung Fehler + Rücknahme-Auftrag", () => {
  const v = vault();
  const ctx = ctxFuer(v);
  frage(v, ctx, "stichprobe", "stimmt", { felder: { aktion: "s1", commit: "c1" } });
  const nein = frage(v, ctx, "stichprobe", "stimmt-nicht", { felder: { aktion: "s2", commit: "c2" } });
  const r = A.wendeAntwortenAn(ctx);
  assert.deepEqual(r.zuruecknehmen, [{ aktion: "s2", commit: "c2", ref: nein }]);
  assert.deepEqual(P.lesePruefungen(v).map((p) => [p.art, p.aktion, p.fehler]).sort(), [["stichprobe", "s1", false], ["stichprobe", "s2", true]]);
  assert.deepEqual(offen(v), []);
});

test("unbekannte Antwort (Datei von Hand geändert): nichts wird angewendet, Rückfrage bleibt, Fehler gemeldet", () => {
  const v = vault();
  const ctx = ctxFuer(v);
  const id = R.legeRueckfrageAn(ctx, { typ: "heikel", frage: "?", seite: SEITE, vorschlaege: [vo(v, "q1")] });
  const dat = R.listeRueckfragen(v)[0];
  writeFileSync(dat.datei, B.schreibeFm({ ...dat.fm, antwort: "vielleicht" }, dat.rumpf));
  const r = A.wendeAntwortenAn(ctx);
  assert.deepEqual([r.auftraege, r.zuruecknehmen, r.fehler], [[], [], 1]);
  assert.deepEqual(offen(v), [id]);
  assert.ok(existsSync(join(v, "00_inbox", "_rueckfragen", "vorschlaege", "q1.md")));
});

test("Probemodus: Antworten werden nur berechnet — Vault bleibt bytegleich, Rückfragen bleiben", () => {
  const v = vault();
  const ctx = ctxFuer(v);
  frage(v, ctx, "web", "verwerfen", { vorschlaege: [vo(v, "p1")] });
  frage(v, ctx, "lektion", "aktivieren", { vorschlaege: [vo(v, "p2", { art: "lektion", titel: "T", regel: "R." })], felder: { titel: "T", regel: "R." } });
  frage(v, ctx, "heikel", "uebernehmen", { vorschlaege: [vo(v, "p3")] });
  frage(v, ctx, "heikel", "uebernehmen", { vorschlaege: [vo(v, "p4")], grund: "kritisch" });
  const vorher = schnappschuss(v);
  const probe = ctxFuer(v, { probe: true });
  const r = A.wendeAntwortenAn(probe);
  assert.equal(schnappschuss(v), vorher);
  assert.equal(r.auftraege.length, 1);
  assert.ok(probe.aktionen.length >= 4);
  assert.equal(offen(v).length, 4);
});

test("Schritt 9: fertige Lektion → Rückfrage; Rohkandidaten-Gruppe → ein KI-Aufruf → Rückfrage mit Gilt für; NICHTS → aussortiert; einzelne warten", async () => {
  const v = neuerTestVault();
  const ki = fakeKi([
    { wenn: "tests vergessen", antwort: "### Tests vor Commit\nziel: memory\nregel: Vor jedem Commit die Tests laufen lassen.\nwarum: Zweimal vergessen.\nwie: Vor git commit.\ngilt: *.mjs, .tools/**" },
    { wenn: "anderes thema", antwort: "NICHTS" },
  ]);
  const roh = (id, titel) => legeVorschlagAn(v, { id, art: "lektion", titel, text: `Auszug ${id}` });
  legeVorschlagAn(v, { id: "f1", art: "lektion", titel: "Fertig", regel: "Immer erst lesen." });
  roh("r1", "Wiederholte Korrektur: Tests vergessen"); roh("r2", "Wiederholte Korrektur: Tests vergessen");
  roh("r3", "Wiederholte Korrektur: anderes Thema"); roh("r4", "Wiederholte Korrektur: anderes Thema");
  roh("r5", "Wiederholte Korrektur: allein");
  const ctx = ctxFuer(v);
  const e = await L.lektionenSchritt(ctx, B.ladeVorschlaege(v));
  assert.deepEqual(e, { rueckfragen: 2, aussortiert: 2, offen: 1 });
  assert.equal(ki.anzahl(), 2);
  const rf = R.listeRueckfragen(v).find((r) => r.fm.titel === "Tests vor Commit");
  assert.deepEqual([rf.typ, rf.fm.gilt_fuer, rf.vorschlaege.sort()], ["lektion", ["*.mjs", ".tools/**"], ["r1", "r2"]]);
  assert.match(rf.beschreibung, /Gilt für: \*\.mjs, \.tools\/\*\*/, "Der Nutzer sieht die Dateimuster vor dem Aktivieren");
  assert.ok(existsSync(join(v, "90_archiv", "vorschlaege-aussortiert", "keine-lektion", "r3.md")));
  assert.ok(existsSync(join(v, "00_inbox", "_vorschlaege", "r5.md")));
  assert.equal(L.parseGruppenLektion("Fließtext ohne Block"), null);
  assert.equal(lektionenDatei(v), "", "Schritt 9 aktiviert nie selbst");
});

test("Schritt 9 → Schritt 0: formulierte Gruppen-Lektion wird erst mit „aktivieren“ aktiv, die zweite Quelle wird mit aussortiert", async () => {
  const v = neuerTestVault();
  fakeKi([{ wenn: "tests vergessen", antwort: "### Tests vor Commit\nziel: memory\nregel: Vor jedem Commit die Tests laufen lassen.\nwarum: Zweimal vergessen.\nwie: Vor git commit.\ngilt: *.mjs" }]);
  for (const id of ["r1", "r2"]) legeVorschlagAn(v, { id, art: "lektion", titel: "Wiederholte Korrektur: Tests vergessen", text: `Auszug ${id}` });
  const ctx = ctxFuer(v);
  await L.lektionenSchritt(ctx, B.ladeVorschlaege(v));
  assert.equal(lektionenDatei(v), "");
  const [rf] = R.listeRueckfragen(v);
  R.beantworte(v, rf.id, "aktivieren");
  A.wendeAntwortenAn(ctxFuer(v));
  assert.match(lektionenDatei(v), /\*\*Tests vor Commit\*\* — Vor jedem Commit die Tests laufen lassen\.[\s\S]*Gilt für: `\*\.mjs`/);
  assert.equal(existsSync(join(v, "90_archiv", "vorschlaege-aussortiert", "in-lektion-zusammengefasst", "r2.md")), true);
  assert.deepEqual(offen(v), []);
});
