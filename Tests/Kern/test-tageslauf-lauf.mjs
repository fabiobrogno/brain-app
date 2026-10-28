// .tools/tests/test-tageslauf-lauf.mjs — der ganze Tageslauf (B2, Task 11): jede Stufe einmal, Probe schreibt nichts,
// pre-commit rot, Sperre, Budget mit Fortsetzung, ohne claude, wenn-fällig, Dienst auf Akku, nur Antworten.
// Aufbau und Fake-Antworten: lauf-hilfe.mjs. Weiter: -grenzen (Stand, Zitat stützt nicht, kaputte Seite, Ingest-Sperre, Vault nicht
// auf main, Schreibfehler …) und -cli (Stichprobe → Rücknahme, Kommandozeile).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isoliere, fakeKi, schnappschuss, git, JETZT } from "./tageslauf-hilfe.mjs";
import { SEITE, ZEILE, REGELN, belegt, aufbau, lauf, teil } from "./lauf-hilfe.mjs";
const R = await import("../rueckfragen.mjs");
const B = await import("../tageslauf/bestand.mjs");
const P = await import("../tageslauf/protokoll.mjs");
const Z = await import("../tageslauf/zeitplan.mjs");
isoliere();

test("scharfer Lauf: jede Stufe einmal — 2 Commits mit Beleg, Widerspruch und heikel als Rückfrage, aussortiert, wartet", async () => {
  const v = aufbau();
  const ki = fakeKi(REGELN);
  const r = await lauf(v);
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.deepEqual(teil(r.zahlen), { uebernommen: 2, aussortiert: 2, rueckfragenNeu: 2, wartenNeu: 1 });
  assert.equal(ki.haikuAnzahl(), 6, "1× Belege + 5× Abgleich");
  assert.equal(ki.richterAnzahl(), 2, "je ein Richter-Aufruf für die zwei 🟢 (g1, n1)");
  const text = readFileSync(join(v, SEITE), "utf8");
  assert.match(text, /- Orion sichert jetzt stündlich\. · Stand 20\.10\.2026 · \[\[10_projekte\/belege\/2026-10\/g1\]\]/);
  assert.match(text, /\[\[10_projekte\/belege\/2026-10\/n1\]\]/);
  assert.match(text, /^rev: 3$/m);
  assert.equal(git(v, "log", "-2", "--format=%an"), "Brain-Tageslauf\nBrain-Tageslauf");
  assert.ok(existsSync(join(v, "90_archiv", "vorschlaege-uebernommen", "g1.md")));
  assert.deepEqual(R.listeRueckfragen(v).map((x) => x.typ).sort(), ["heikel", "widerspruch"]);
  assert.equal(R.listeRueckfragen(v).find((x) => x.typ === "widerspruch").zeile, ZEILE);
  assert.ok(existsSync(join(v, "90_archiv", "vorschlaege-aussortiert", "schon-drin", "s1.md")));
  assert.ok(existsSync(join(v, "90_archiv", "vorschlaege-aussortiert", "herkunft-ki", "k1.md")));
  assert.ok(existsSync(join(v, "00_inbox", "_warten", "x1.md")));
  const l = P.leseLetzter(v);
  assert.deepEqual([l.modus, l.status, l.erfolgreich, l.art], ["an", "ok", true, "voll"]);
  const auto = P.autoUebernahmen(P.leseAktionen(v));
  assert.deepEqual(auto.map((a) => a.id).sort(), ["g1", "n1"]);
  assert.ok(auto.every((a) => /^[0-9a-f]{40}$/.test(a.commit) && a.beleg && a.zitat && a.fundstelle));
  assert.match(auto.find((a) => a.id === "n1").fundstelle, /^s7#u-s7-1 /, "Fundstelle im B1-Format aus dem Belege-Schritt");
  assert.equal(git(v, "branch", "--list", "tageslauf/*"), "");
  assert.equal(git(v, "worktree", "list").split("\n").length, 1, "keine Arbeitskopie übrig");
  assert.match(readFileSync(join(v, r.bericht), "utf8"), /brain zurueck/);
  assert.equal(R.listeRueckfragen(v).some((x) => x.typ === "stichprobe"), false, "Stichproben nur aus früheren Läufen");
});

test("Probemodus (Standard-Schalter): Vault bytegleich, „würde“-Zahlen, eigene Aktionen/Bericht; zweite Probe nutzt den Cache", async () => {
  const v = aufbau({ automatik: {} });
  fakeKi(REGELN);
  git(v, "branch", "tageslauf/ALT");                       // Rest eines abgestürzten Laufs: die Probe räumt NICHT auf
  const gitStand = () => [git(v, "worktree", "list", "--porcelain"), git(v, "branch", "-a"), git(v, "rev-parse", "HEAD"), git(v, "log", "-1"), git(v, "status", "--porcelain")].join("\n");
  const vorher = schnappschuss(v), gitVorher = gitStand();
  const r = await lauf(v);
  assert.equal(schnappschuss(v), vorher);
  assert.equal(gitStand(), gitVorher, "Probe ändert Git nicht (Worktrees, Branches, HEAD, Log, Status)");
  assert.deepEqual([r.modus, r.zahlen.uebernommen, r.zahlen.rueckfragenNeu], ["probe", 2, 2]);
  assert.ok(existsSync(join(P.TL_DIR(v), "probe-aktionen.jsonl")));
  assert.ok(!existsSync(join(P.TL_DIR(v), "aktionen.jsonl")));
  assert.ok(!existsSync(join(P.TL_DIR(v), "pruefungen.jsonl")));
  assert.match(r.bericht, /-probe\.md$/);
  assert.match(readFileSync(join(v, r.bericht), "utf8"), /würde übernehmen: 2/);
  assert.equal(P.leseLetzter(v).modus, "probe");
  const ki2 = fakeKi(REGELN);
  await lauf(v, { jetzt: JETZT + 3600e3 });
  assert.equal(ki2.anzahl(), 0, "Belege und Abgleich kommen aus dem Cache");
  assert.equal(schnappschuss(v), vorher);
  assert.equal(gitStand(), gitVorher);
});

test("Probe von Hand bei Schalter „an“: letzter.json und Startmarke gehören dem echten Lauf", async () => {
  const v = aufbau();
  fakeKi(REGELN);
  const vorher = schnappschuss(v), gitVorher = git(v, "rev-parse", "HEAD");
  const r = await lauf(v, { probe: true });
  assert.equal(r.modus, "probe");
  assert.equal(P.leseLetzter(v), null);
  assert.ok(!existsSync(join(P.TL_DIR(v), "letzter-start")));
  assert.equal(schnappschuss(v), vorher);
  assert.equal(git(v, "rev-parse", "HEAD"), gitVorher);
});

test("pre-commit rot: dieser Fakt wartet mit Befund, die anderen werden übernommen", async () => {
  const v = aufbau();
  belegt(v, "r1", "Orion Notiz", "Orion ist VERBOTEN laut Test.", "Orion ist VERBOTEN laut Test", "tool");
  fakeKi(REGELN);
  const r = await lauf(v);
  assert.equal(r.status, "ok");
  assert.equal(r.zahlen.uebernommen, 2);
  const w = B.ladeVorschlag(v, "_warten", "r1");
  assert.equal(w.wartenGrund, "pruefung-rot");
  assert.match(String(w.fm.warten_befund), /VERBOTEN/);
  assert.doesNotMatch(readFileSync(join(v, SEITE), "utf8"), /VERBOTEN/);
});

test("Sperre: läuft schon → übersprungen, nichts passiert", async () => {
  const v = aufbau();
  fakeKi(REGELN);
  assert.ok(Z.nimmSperre(v, { jetzt: JETZT }));
  const vorher = schnappschuss(v);
  assert.deepEqual(await lauf(v), { status: "uebersprungen", grund: "läuft schon" });
  assert.equal(schnappschuss(v), vorher);
  Z.gibSperreFrei(v);
});

test("Budget: nach 2 KI-Aufrufen Schluss (abgebrochen); der nächste Lauf macht weiter, jede Frage nur einmal", async () => {
  const v = aufbau();
  const ki = fakeKi(REGELN);
  const r1 = await lauf(v, { budget: { aufrufe: 2 } });
  assert.equal(r1.status, "abgebrochen");
  assert.equal(ki.anzahl(), 2);
  assert.equal(P.leseLetzter(v).erfolgreich, true, "Budget-Ende zählt als Erfolg (Rest kommt morgen)");
  const r2 = await lauf(v, { jetzt: JETZT + 3600e3 });
  assert.equal(r2.status, "ok");
  assert.equal(ki.haikuAnzahl(), 6, "jede Frage nur einmal");
  assert.equal(ki.richterAnzahl(), 2, "auch der Richter wurde nur zweimal gefragt (im ersten Lauf war sein Budget leer: ⏸ richter-budget, kein Übernehmen)");
  assert.equal(P.autoUebernahmen(P.leseAktionen(v)).length, 2);
  assert.equal(git(v, "branch", "--list", "tageslauf/*"), "");
});

test("ohne claude: nichts Ungeprüftes wird übernommen, Status ohne-ki mit Grund, Aufräumen läuft trotzdem", async () => {
  const v = aufbau();
  const r = await lauf(v, { claudeBefehl: null });
  assert.deepEqual([r.status, r.zahlen.uebernommen], ["ohne-ki", 0]);
  assert.match(r.grund, /claude/);
  assert.ok(existsSync(join(v, "90_archiv", "vorschlaege-aussortiert", "herkunft-ki", "k1.md")));
  assert.equal(P.leseLetzter(v).erfolgreich, false);
  assert.ok(existsSync(join(v, "00_inbox", "_vorschlaege", "g1.md")), "bleibt offen für den nächsten Lauf");
  assert.ok(existsSync(join(v, "00_inbox", "_warten", "x1.md")), "was ohne KI geht (keine Seite), geht");
  assert.equal(git(v, "rev-list", "--count", "HEAD"), "1");
});

test("--wenn-faellig: Erfolg vor 1 h → übersprungen; --dienst auf Akku → übersprungen, Grund in letzter.json", async () => {
  const v = aufbau();
  fakeKi(REGELN);
  P.schreibeLetzter(v, { letzterErfolg: new Date(JETZT - 3600e3).toISOString() });
  assert.equal((await lauf(v, { wennFaellig: true })).grund, "nicht fällig");
  P.schreibeLetzter(v, { letzterErfolg: new Date(JETZT - 21 * 3600e3).toISOString() });
  const r = await lauf(v, { wennFaellig: true, dienst: true,
    pmset: () => "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t80%", ioreg: () => '"HIDIdleTime" = 900000000000' });
  assert.deepEqual([r.status, r.grund], ["uebersprungen", "läuft auf Akku"]);
  assert.equal(P.leseLetzter(v).uebersprungen.grund, "läuft auf Akku");
  assert.equal(R.listeRueckfragen(v).length, 0);
});

test("Schalter aus → übersprungen (auch mit --wenn-faellig); mit --probe läuft er trotzdem", async () => {
  const v = aufbau({ automatik: { tageslauf: "aus" } });
  fakeKi(REGELN);
  assert.deepEqual(await lauf(v, { wennFaellig: true }), { status: "uebersprungen", grund: "Tageslauf ist aus" });
  assert.equal((await lauf(v, { probe: true })).modus, "probe");
});

test("--nur-antworten: nur die beantwortete Rückfrage wird übernommen, neue Vorschläge bleiben, Zahlen des vollen Laufs bleiben", async () => {
  const v = aufbau();
  fakeKi(REGELN);
  await lauf(v);
  const vorher = P.leseLetzter(v);
  const h = R.listeRueckfragen(v).find((x) => x.typ === "heikel");
  R.beantworte(v, h.id, "uebernehmen");
  belegt(v, "z1", "Orion Neu", "Orion hat neue Lüfter.", "Orion hat neue Lüfter");
  const r = await lauf(v, { jetzt: JETZT + 600e3, nurAntworten: true });
  assert.equal(r.zahlen.uebernommen, 1);
  assert.match(readFileSync(join(v, SEITE), "utf8"), /belege\/2026-10\/h1/);
  assert.ok(existsSync(join(v, "00_inbox", "_vorschlaege", "z1.md")));
  assert.ok(!R.listeRueckfragen(v).some((x) => x.id === h.id), "nach dem Merge archiviert");
  const l = P.leseLetzter(v);
  assert.deepEqual([l.lauf, l.zahlen.uebernommen, l.zahlen.rueckfragen, l.antworten.status], [vorher.lauf, 2, 1, "ok"]);
  assert.equal(l.letzterErfolg, vorher.letzterErfolg, "ein Antworten-Lauf ist kein voller Erfolg");
});
