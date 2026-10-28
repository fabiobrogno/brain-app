// .tools/tests/test-tageslauf-thema.mjs — Themen-Ausschluss (automatik.ernteOhneThema) im Tageslauf: bereits vorhandene Vorschläge, die ein
// ausgeschlossenes Wort nennen, werden VOR jedem KI-Aufruf ⚪ aussortiert (Grund thema-ausgeschlossen, Archiv, nie löschen); beantwortete
// Rückfragen und W7-Funde schreiben nichts dazu. Das Wort steht in keinem Protokoll, Bericht oder Cache. Neutrales Wort: zebra.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { isoliere, neuerTestVault, legeVorschlagAn, legeTranskriptAn, seitenText, fakeKi, schnappschuss, FAKE_BEFEHL, JETZT } from "./tageslauf-hilfe.mjs";
import { SEITE, REGELN, belegt, aufbau, lauf, teil } from "./lauf-hilfe.mjs";
const A = await import("../tageslauf/antworten.mjs");
const AR = await import("../tageslauf/aufraeumen.mjs");
const B = await import("../tageslauf/bestand.mjs");
const { BELEGE_VERSION } = await import("../tageslauf/belege.mjs");
const P = await import("../tageslauf/protokoll.mjs");
const R = await import("../rueckfragen.mjs");
const { THEMA_GRUND } = await import("../thema-ausschluss.mjs");
isoliere();

const AUTOMATIK = { tageslauf: "an", einschwingen: 0, ernteOhneThema: ["zebra"] };
const archiv = (v, id) => join(v, "90_archiv", "vorschlaege-aussortiert", THEMA_GRUND, `${id}.md`);
const tageslaufDateien = (v) => {
  const out = [];
  const lauf2 = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) lauf2(p); else out.push(readFileSync(p, "utf8")); } };
  if (existsSync(P.TL_DIR(v))) lauf2(P.TL_DIR(v));
  return out.join("\n");
};
// Sieben Vorschläge mit ausgeschlossenem Wort in jeder Form: Titel, Text, Zitat, Stand, Lektion, wartend, Beleg nachzuholen.
function legeZebraAn(v) {
  belegt(v, "z1", "Zebra Gehege", "Hans wohnt im Gehege vier.", "Hans wohnt im Gehege vier und frisst Heu");                                  // Titel
  belegt(v, "z2", "Orion Gehege", "Das Zebra wohnt im Gehege vier.", "Hans wohnt im Gehege vier und frisst Heu");                              // Text
  belegt(v, "z3", "Orion Hans", "Hans wohnt im Gehege vier.", "Das Zebra Hans wohnt im Gehege vier und frisst Heu");                          // Zitat
  legeVorschlagAn(v, { id: "z4", art: "stand", titel: "Stand Orion", text: "Das ZEBRA ist umgezogen.\n- offen: Gehege prüfen", zitat: "Das Zebra ist umgezogen", herkunft: "du", fundstelle: "s1#u-z4 2026-10-20T10:00:00Z" });
  legeVorschlagAn(v, { id: "z5", art: "lektion", titel: "Fütterung", text: "Regel zur Fütterung.", regel: "Das Zebra nur abends füttern.", warum: "zweimal korrigiert", wie: "beim Plan", ziel: "memory" });
  belegt(v, "z6", "Orion Futter", "Das Zebra frisst Heu.", "Das Zebra frisst nur Heu");
  const z6 = B.ladeVorschlag(v, "_vorschlaege", "z6");
  B.warten({ vault: v, probe: false, jetzt: JETZT, aktionen: [] }, z6, "keine-seite");                                                       // wartend
  legeVorschlagAn(v, { id: "z7", titel: "Orion Tiere", text: "Das Zebra ist ein Tier.", sitzung: "s8" });                                       // Beleg nachholen
  legeTranskriptAn(v, "s8", [{ du: "Das Zebra ist ein Tier mit Streifen, sagt das Team." }]);
}
const ZEBRA_IDS = ["z1", "z2", "z3", "z4", "z5", "z6", "z7"];

test("scharfer Lauf: alle sieben Vorschläge mit dem Wort werden VOR jedem KI-Aufruf aussortiert, der Rest läuft wie sonst; das Wort steht in keinem Protokoll", async () => {
  const v = aufbau({ automatik: AUTOMATIK });
  legeZebraAn(v);
  const ki = fakeKi(REGELN);
  const r = await lauf(v);
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.deepEqual(teil(r.zahlen), { uebernommen: 2, aussortiert: 2 + ZEBRA_IDS.length, rueckfragenNeu: 2, wartenNeu: 1 }, "Rest unverändert, sieben mehr aussortiert");
  for (const id of ZEBRA_IDS) {
    assert.ok(existsSync(archiv(v, id)), `${id} liegt im Archiv (nie gelöscht)`);
    assert.ok(!existsSync(join(v, "00_inbox", "_vorschlaege", `${id}.md`)) && !existsSync(join(v, "00_inbox", "_warten", `${id}.md`)), `${id} nicht mehr in der Inbox`);
  }
  assert.equal(ki.haikuAnzahl(), 6, "wie ohne die Zebra-Vorschläge: 1× Belege + 5× Abgleich — kein Aufruf mehr durch sie");
  assert.equal(ki.richterAnzahl(), 2, "und je ein Richter-Aufruf für die zwei 🟢");
  for (const a of ki.aufrufe()) assert.doesNotMatch(a.eingabe, /zebra/i, "an die KI ging nie etwas zum ausgeschlossenen Thema");
  const dateien = tageslaufDateien(v);
  assert.doesNotMatch(dateien, /zebra/i, "weder Aktionen noch Bericht noch Cache noch letzter.json nennen das Wort");
  const aussortiert = P.leseAktionen(v).filter((a) => a.grund === THEMA_GRUND);
  assert.equal(aussortiert.length, 7);
  for (const a of aussortiert) { assert.equal(a.stufe, "aussortieren"); assert.ok(ZEBRA_IDS.includes(a.id)); assert.equal(a.titel, undefined, "kein Titel im Protokoll"); }
  assert.match(readFileSync(join(v, r.bericht), "utf8"), /- thema-ausgeschlossen: 7\n/);
});

test("Probemodus: nichts wird verschoben, das Protokoll nennt nur den Grund", async () => {
  const v = aufbau({ automatik: { ernteOhneThema: ["zebra"] } });   // Schalter tageslauf: probe (Standard)
  legeZebraAn(v);
  fakeKi(REGELN);
  const vorher = schnappschuss(v);
  const r = await lauf(v);
  assert.equal(r.modus, "probe");
  assert.equal(schnappschuss(v), vorher, "Vault bytegleich");
  const probe = readFileSync(join(P.TL_DIR(v), "probe-aktionen.jsonl"), "utf8");
  assert.equal(probe.split("\n").filter((z) => z.includes(THEMA_GRUND)).length, 7);
  assert.doesNotMatch(tageslaufDateien(v), /zebra/i);
});

test("aufraeumKandidaten: ganzes Wort, Groß/Klein egal, Vorrang vor anderen Gründen; Pflege-Vorschläge bleiben; ohne Wörter kein Eingriff", () => {
  const vs = (titel, extra = {}) => ({ id: `id-${titel}`, art: "fakt", titel, text: "Text.", zitat: "", herkunft: "du", unterordner: "_vorschlaege", erstellt: "2026-10-20T10:00:00Z", fm: {}, ...extra });
  const liste = [vs("Zebra"), vs("ZEBRA-Gehege"), vs("Zebrastreifen"), vs("Zebras"), vs("Gnu"), vs("Gnu ki", { herkunft: "ki", text: "Ein Zebra." }),
    vs("Pflege Zebra", { art: "pflege" }), vs("Stand", { art: "stand", text: "Zebra" }), vs("Lektion", { art: "lektion", regel: "zebra beachten" }),
    vs("Beleg", { zitat: "das zebra, wörtlich" })];
  const grund = (ohneThema) => Object.fromEntries(AR.aufraeumKandidaten(liste, { ohneThema }).map(({ v, grund: g }) => [v.id.replace("id-", ""), g]));
  assert.deepEqual(grund(["zebra"]), { Zebra: THEMA_GRUND, "ZEBRA-Gehege": THEMA_GRUND, "Gnu ki": THEMA_GRUND, Stand: THEMA_GRUND, Lektion: THEMA_GRUND, Beleg: THEMA_GRUND },
    "Teilwörter (Zebrastreifen, Zebras) und Pflege-Vorschläge nicht; herkunft-ki weicht dem Themen-Grund");
  assert.deepEqual(grund([]), { "Gnu ki": "herkunft-ki" });
  assert.deepEqual(grund(undefined), { "Gnu ki": "herkunft-ki" });
});

test("aufraeumen: Belege-Cache des aussortierten Vorschlags (enthält sein Zitat) wird mit entfernt", () => {
  const v = neuerTestVault({ automatik: AUTOMATIK });
  legeVorschlagAn(v, { id: "c1", titel: "Zebra", text: "Zebra." });
  legeVorschlagAn(v, { id: "c2", titel: "Gnu", text: "Gnu." });
  const ctx = P.neuerLauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT });
  ctx.cache.belege.c1 = { ergebnis: "ok", zitat: "Das Zebra Hans", herkunft: "du", fundstelle: "s#u 2026-10-20T10:00:00Z" };
  ctx.cache.belege.c2 = { ergebnis: "kein-beleg" };
  const erg = AR.aufraeumen(ctx, B.ladeVorschlaege(v));
  assert.equal(erg.aussortiert, 1);
  assert.deepEqual(Object.keys(ctx.cache.belege), ["c2"]);
  assert.ok(existsSync(archiv(v, "c1")));
});

// ------------------------------------------------------------------------------------------- beantwortete Rückfragen
const ctxFuer = (v, opt = {}) => P.neuerLauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT, ...opt });
const zielseite = () => neuerTestVault({ automatik: AUTOMATIK, seiten: { [SEITE]: seitenText({ fm: { name: "orion" }, rumpf: "# Orion\n\n## Fakten\n\n- Port 3309 · Stand 01.10.2026 · [[x]]\n" }) } });
const vorschlag = (v, id, extra = {}) => { legeVorschlagAn(v, { id, ...extra }); return B.ladeVorschlag(v, "_vorschlaege", id); };
// Die Rückfrage entstand VOR der Einstellung (der Vorschlag lag damals in _rueckfragen/vorschlaege); beantwortet wird sie erst jetzt.
const frage = (v, ctx, typ, antwort, v1, extra = {}) => {
  const id = R.legeRueckfrageAn(ctx, { typ, frage: `${typ}?`, seite: SEITE, vorschlaege: [v1], ...extra });
  R.beantworte(v, id, antwort, "");
  return id;
};

test("Antwort „übernehmen“ auf eine ältere Rückfrage zu einem ausgeschlossenen Thema: nichts wird geschrieben, Vorschlag aussortiert, Rückfrage erledigt", () => {
  const v = zielseite();
  const ctx = ctxFuer(v);   // legt die Rückfragen an (früherer Lauf); beantwortet wird mit einem frischen Kontext
  const h = frage(v, ctx, "heikel", "uebernehmen", vorschlag(v, "a1", { titel: "Orion Tier", text: "Das Zebra wohnt dort." }), { grund: "heikel" });
  const w = frage(v, ctx, "web", "uebernehmen", vorschlag(v, "a2", { titel: "Zebra Web", text: "Etwas." }));
  const k = frage(v, ctx, "heikel", "uebernehmen", vorschlag(v, "a3", { titel: "Orion Tier", text: "Etwas.", zitat: "Das Zebra ist da" }), { grund: "kritisch" });
  const o = frage(v, ctx, "web", "uebernehmen", vorschlag(v, "a4", { titel: "Orion Tier", text: "Das ZEBRA." }), { seite: "" });
  const ok = frage(v, ctx, "heikel", "uebernehmen", vorschlag(v, "g9", { titel: "Orion Backups", text: "Orion sichert stündlich." }), { grund: "heikel" });
  const heute = ctxFuer(v);
  const r = A.wendeAntwortenAn(heute);
  assert.deepEqual(r.auftraege.map((a) => a.v.id), ["g9"], "nur der Vorschlag ohne das Wort wird zum Schreibauftrag");
  for (const id of ["a1", "a2", "a3", "a4"]) assert.ok(existsSync(archiv(v, id)), id);
  for (const id of [h, w, k, o]) assert.ok(existsSync(join(v, "90_archiv", "rueckfragen-erledigt", `${id}.md`)), "Rückfrage erledigt");
  assert.ok(!existsSync(join(v, "00_inbox", "a3.md")) && !existsSync(join(v, "00_inbox", "a4.md")), "auch nicht für /ingest in die Inbox-Wurzel");
  assert.deepEqual(R.listeRueckfragen(v).map((x) => x.id), [ok]);
  assert.doesNotMatch(JSON.stringify(heute.aktionen), /zebra/i, "Protokoll nennt nur den Grund");
  assert.ok(heute.aktionen.some((a) => a.rueckfrage === h && a.grund === `uebernehmen: ${THEMA_GRUND}`));
});

test("Widerspruch B/beide und Lektion „aktivieren“ mit ausgeschlossenem Wort → nichts geschrieben", () => {
  const v = zielseite();
  const ctx = ctxFuer(v);
  frage(v, ctx, "widerspruch", "b", vorschlag(v, "b1", { titel: "Orion Tier", text: "Das Zebra." }), { zeile: "- Port 3309 · Stand 01.10.2026 · [[x]]" });
  frage(v, ctx, "widerspruch", "beide", vorschlag(v, "b2", { titel: "Orion Tier", text: "Das Zebra." }));
  frage(v, ctx, "lektion", "aktivieren", vorschlag(v, "b3", { art: "lektion", titel: "Fütterung", text: "Regel.", regel: "Zebra abends füttern.", warum: "x", wie: "y", ziel: "memory" }),
    { felder: { titel: "Fütterung", regel: "Zebra abends füttern.", warum: "x", wie: "y" } });
  const heute = ctxFuer(v);
  const r = A.wendeAntwortenAn(heute);
  assert.deepEqual(r.auftraege, []);
  for (const id of ["b1", "b2", "b3"]) assert.ok(existsSync(archiv(v, id)), id);
  assert.ok(!existsSync(join(v, "09_wiki", "_lektionen.md")), "keine Lektion ins Wiki");
  assert.deepEqual(R.listeRueckfragen(v), []);
  assert.doesNotMatch(JSON.stringify(heute.aktionen), /zebra/i);
});

test("Verwerfen und andere Antworten sind vom Themen-Ausschluss nicht betroffen (sie schreiben nichts ins Brain)", () => {
  const v = zielseite();
  const ctx = ctxFuer(v);
  frage(v, ctx, "heikel", "verwerfen", vorschlag(v, "d1", { titel: "Orion Tier", text: "Das Zebra." }), { grund: "heikel" });
  A.wendeAntwortenAn(ctx);
  assert.ok(existsSync(join(v, "90_archiv", "vorschlaege-abgelehnt", "d1.md")), "bleibt „abgelehnt“, wie gehabt");
  assert.ok(!existsSync(archiv(v, "d1")));
});

// ---------------------------------------------------------------------------------------------------------------- W7
test("W7-Eingang: Funde zu einem ausgeschlossenen Thema (Zitat oder Seitenpfad) legen weder Rückfrage noch Feld-Auftrag an, zählen aber als gelesen", () => {
  const v = zielseite();
  mkdirSync(join(v, ".logs"), { recursive: true });
  writeFileSync(join(v, "09_wiki", "projekte", "thema_zebra.md"), seitenText({ fm: { name: "zebra" }, rumpf: "# Zebra\n" }));   // Seite mit dem Wort im Namen
  const w7 = (uuid, zitat, seite = SEITE) => JSON.stringify({ v: 1, seite, sitzung: "s9", uuid, zeit: "2026-10-21T12:00:00Z", zitat });
  writeFileSync(join(v, ".logs", "w7.jsonl"), [
    w7("u1", "Das stimmt nicht, das Zebra ist weg"),
    w7("u2", "Das stimmt nicht, Port ist 3311", "09_wiki/projekte/thema_zebra.md"),
    w7("u3", "Das stimmt nicht, Port ist 3311"),
  ].join("\n") + "\n");
  const ctx = ctxFuer(v);
  const r = A.w7Eingang(ctx, { aktionen: [] });
  assert.equal(r.neu, 3);
  assert.deepEqual(r.auftraege.map((a) => [a.seite, a.wert]), [[SEITE, `${ctx.heute}: Das stimmt nicht, Port ist 3311`]], "nur der dritte Fund wird zum Auftrag");
  assert.deepEqual(R.listeRueckfragen(v).map((x) => x.seite), [SEITE]);
  assert.equal(JSON.parse(readFileSync(join(P.TL_DIR(v), "w7-stand.json"), "utf8")).gelesen, 3, "alle drei gelten als gelesen");
  assert.doesNotMatch(JSON.stringify(ctx.aktionen), /zebra/i);
  assert.ok(ctx.aktionen.some((a) => a.stufe === "aussortieren" && a.grund === THEMA_GRUND), "der Grund steht im Protokoll");
});

// ------------------------------------------------------------------------------------------------------ fail-closed
test("unlesbare Config: der Lauf fasst nichts an", async () => {
  const v = aufbau({ automatik: AUTOMATIK });
  legeZebraAn(v);
  writeFileSync(join(v, "brain.config.json"), '{"automatik": {"tageslauf": "an", "ernteOhneThema": ["zebra"]');
  fakeKi(REGELN);
  const vorher = schnappschuss(v);
  const r = await lauf(v);
  assert.deepEqual([r.status, r.grund], ["uebersprungen", "Einstellungen unlesbar"]);
  assert.equal(schnappschuss(v), vorher);
});

// ------------------------------------------------------------------------------------------- Belege nachholen
// Ein Altbestand-Vorschlag ohne Zitat nennt das Wort selbst nicht — erst das gefundene Zitat könnte es tragen.
test("Belege nachholen: Abschnitte mit dem ausgeschlossenen Wort gehen nie an die KI; liefert sie trotzdem ein solches Zitat, wird der Vorschlag aussortiert (Cache sauber)", async () => {
  const v = aufbau({ automatik: AUTOMATIK });
  legeVorschlagAn(v, { id: "q1", titel: "Orion Tiere", text: "Orion hält Tiere im Gehege vier.", sitzung: "s5" });
  legeTranskriptAn(v, "s5", [
    { du: "Orion hält Tiere im Gehege vier, sagt das Team." },
    { du: "Orion Tiere: das Zebra Hans wohnt im Gehege vier und frisst Heu, sagt das Team." },
  ]);
  const regeln = [{ wenn: "--- VORSCHLÄGE ---", antwort: '[{"id":"q1","zitat":"Orion Tiere: das Zebra Hans wohnt im Gehege vier und frisst Heu, sagt das Team."}]' }, ...REGELN.slice(1)];
  const ki = fakeKi(regeln);
  const r = await lauf(v);
  assert.equal(r.status, "ok", JSON.stringify(r));
  const belegAufrufe = ki.aufrufe().filter((a) => a.eingabe.includes("--- ABSCHNITTE ---") && a.eingabe.includes("## q1"));
  assert.equal(belegAufrufe.length, 1, "der Belege-Aufruf für q1 fand statt");
  assert.doesNotMatch(belegAufrufe[0].eingabe, /zebra/i, "der Abschnitt mit dem Wort wurde der KI nicht gezeigt");
  assert.match(belegAufrufe[0].eingabe, /Gehege vier, sagt das Team/, "der Abschnitt ohne das Wort schon");
  assert.ok(existsSync(archiv(v, "q1")), "mit dem Wort im Zitat → thema-ausgeschlossen, nicht übernommen und nicht gefragt");
  assert.deepEqual(R.listeRueckfragen(v).filter((x) => x.vorschlaege?.includes("q1")), []);
  assert.doesNotMatch(tageslaufDateien(v), /zebra/i, "weder Cache noch Protokoll nennen das Wort");
  assert.equal(P.leseAktionen(v).filter((a) => a.id === "q1").every((a) => a.grund === THEMA_GRUND), true);
});

test("ein schon gespeichertes Beleg-Zitat (Cache aus früheren Läufen) mit dem Wort wird ebenfalls nicht mehr verwendet", async () => {
  const v = aufbau({ automatik: AUTOMATIK });
  legeVorschlagAn(v, { id: "q2", titel: "Orion Tiere", text: "Orion hält Tiere im Gehege vier.", sitzung: "s5" });
  legeTranskriptAn(v, "s5", [{ du: "Orion Tiere: das Zebra Hans wohnt im Gehege vier und frisst Heu, sagt das Team." }]);
  mkdirSync(P.TL_DIR(v), { recursive: true });
  writeFileSync(join(P.TL_DIR(v), "cache.json"), JSON.stringify({ belege: { q2: { ergebnis: "ok", version: BELEGE_VERSION, zitat: "Orion Tiere: das Zebra Hans wohnt im Gehege vier und frisst Heu", herkunft: "du", fundstelle: "s5#u-s5-1 2026-10-20T10:00:00Z" } }, abgleich: {}, wahl: {} }));
  const ki = fakeKi(REGELN);
  const r = await lauf(v);
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.ok(existsSync(archiv(v, "q2")));
  for (const a of ki.aufrufe()) assert.doesNotMatch(a.eingabe, /zebra/i);
  assert.doesNotMatch(tageslaufDateien(v), /zebra/i, "auch der alte Cache-Eintrag ist weg");
});
