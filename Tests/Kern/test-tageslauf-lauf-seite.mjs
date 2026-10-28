// .tools/tests/test-tageslauf-lauf-seite.mjs — Nachbesserung nach dem Probelauf: „passt der Fakt zur Seite?“ und „ist er dauerhaft?“
// im ganzen Tageslauf (fake-claude, Temp-Vaults). Falsche Seite → ⏸ seite-passt-nicht, einmalig → ⚪ kurzlebig, Bericht zählt beide.
// Die Regeltabelle selbst steht in test-tageslauf-abgleich.mjs (stufe), die Antwort-Auswertung dort (parseAbgleich).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { isoliere, neuerTestVault, legeVorschlagAn, seitenText, fakeKi, schnappschuss, git, FAKE_BEFEHL, JETZT } from "./tageslauf-hilfe.mjs";
import { tempOrdner } from "./verlauf-fixture.mjs";
const T = await import("../tageslauf.mjs");
const B = await import("../tageslauf/bestand.mjs");
const P = await import("../tageslauf/protokoll.mjs");
const R = await import("../rueckfragen.mjs");
isoliere();

const ORION = "09_wiki/projekte/entitaet_orion.md";
const ZEILE = "- Orion läuft auf Port 3309 · Stand 01.10.2026 · [[x]]";
const antwort = (o = {}) => JSON.stringify({ urteil: "neu", zitatStuetzt: true, passtZurSeite: true, dauerhaft: true, ...o });
const fund = (id) => `s1#u-${id} 2026-10-20T10:00:00Z`;
const fakt = (v, id, titel, text, zitat, extra = {}) => legeVorschlagAn(v, { id, titel, text, zitat, herkunft: "du", fundstelle: fund(id), ...extra });
function aufbau({ seiten = {} } = {}) {
  const v = neuerTestVault({ automatik: { tageslauf: "an", einschwingen: 0 }, seiten: { [ORION]: seitenText({ fm: { name: "orion", description: "Orion Testsystem" },
    rumpf: `# Orion\n\nOrion ist das Testsystem.\n\n## Fakten\n\n${ZEILE}\n` }), ...seiten } });
  mkdirSync(join(v, ".logs"), { recursive: true });
  writeFileSync(join(v, ".logs", "aliasse.json"), JSON.stringify({ orion: ORION }));
  return v;
}
const lauf = (v, opt = {}) => T.tageslauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT, ...opt });
const bericht = (v, r) => readFileSync(join(v, r.bericht), "utf8");
const aussortiert = (v, grund, id) => existsSync(join(v, "90_archiv", "vorschlaege-aussortiert", grund, `${id}.md`));
const ZAEHLZEILE = (n, m) => new RegExp(`seite-passt-nicht: ${n} \\(wartet auf eine passende Seite\\) · kurzlebig: ${m} \\(aussortiert\\)`);

// Acht Vorschläge, je einer pro Fall; alle Titel beginnen mit „Orion“ (Alias → Seite), die Fake-KI antwortet je nach Titel.
function acht(v) {
  fakt(v, "g1", "Orion Backups", "Orion sichert jetzt stündlich.", "Orion sichert ab sofort stündlich");                                   // 🟢
  fakt(v, "p1", "Orion Lüfter", "Orion hat jetzt zwei Lüfter.", "Orion hat jetzt zwei Lüfter");                                           // ⏸ falsche Seite
  fakt(v, "p2", "Orion Farbe", "Orion ist grün.", "Orion ist grün");                                                                       // ⏸ falsche Seite
  fakt(v, "w1", "Orion Port", "Orion läuft auf Port 3310.", "Orion läuft ab heute auf Port 3310");                                         // „widerspricht“, aber falsche Seite → ⏸
  fakt(v, "h1", "Orion Rechnung", "Orion kostet 1.200 € im Monat.", "Orion kostet uns 1.200 € im Monat");                                  // heikel, falsche Seite → ⏸ (keine Rückfrage auf die falsche Seite)
  fakt(v, "h2", "Orion Miete", "Orion kostet 900 € Miete im Monat.", "Orion kostet uns 900 € Miete im Monat");                             // heikel, Seite passt → 🟡 Rückfrage
  fakt(v, "k1", "Orion Wetter", "Orion hatte heute schlechtes Wetter.", "Orion hatte heute schlechtes Wetter");                            // ⚪ kurzlebig
  fakt(v, "k2", "Orion Laune", "Orion ist heute gut gelaunt.", "Orion ist heute gut gelaunt");                                             // ⚪ kurzlebig + falsche Seite → kurzlebig
  return fakeKi([
    { wenn: "FAKT: Orion Backups", antwort: antwort() },
    { wenn: "FAKT: Orion Lüfter", antwort: antwort({ passtZurSeite: false }) },
    { wenn: "FAKT: Orion Farbe", antwort: antwort({ passtZurSeite: false }) },
    { wenn: "FAKT: Orion Port", antwort: antwort({ urteil: "widerspricht", zeile: ZEILE, passtZurSeite: false }) },
    { wenn: "FAKT: Orion Rechnung", antwort: antwort({ passtZurSeite: false }) },
    { wenn: "FAKT: Orion Miete", antwort: antwort() },
    { wenn: "FAKT: Orion Wetter", antwort: antwort({ dauerhaft: false }) },
    { wenn: "FAKT: Orion Laune", antwort: antwort({ dauerhaft: false, passtZurSeite: false }) },
  ]);
}

test("scharfer Lauf: falsche Seite wartet (seite-passt-nicht, auch heikel), einmalig wird aussortiert (kurzlebig), heikel auf passender Seite bleibt Rückfrage, Bericht und letzter.json zählen beides", async () => {
  const v = aufbau();
  const ki = acht(v);
  const seiteVorher = readFileSync(join(v, ORION), "utf8");
  const r = await lauf(v);
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.equal(ki.haikuAnzahl(), 8, "ein Abgleich-Aufruf je Fakt, kein zusätzlicher für die neuen Felder");
  assert.equal(ki.richterAnzahl(), 1, "der Richter urteilt nur über den einen 🟢-Kandidaten");
  assert.deepEqual([r.zahlen.uebernommen, r.zahlen.aussortiert, r.zahlen.rueckfragenNeu, r.zahlen.wartenNeu], [1, 2, 1, 4]);
  assert.deepEqual([r.zahlen.seitePasstNicht, r.zahlen.kurzlebig], [4, 2]);
  // 🟢 nur der Fakt, der passt UND dauerhaft ist — und nur er steht auf der Seite
  const seite = readFileSync(join(v, ORION), "utf8");
  assert.match(seite, /Orion sichert jetzt stündlich\./);
  for (const nicht of ["zwei Lüfter", "ist grün", "Port 3310", "1\\.200", "900 €", "schlechtes Wetter", "gut gelaunt"]) assert.doesNotMatch(seite, new RegExp(nicht), nicht);
  assert.notEqual(seite, seiteVorher);
  // ⏸ falsche Seite: Datei in _warten mit Grund; ein Widerspruch ohne passende Seite ist KEINE Rückfrage
  for (const id of ["p1", "p2", "w1", "h1"]) assert.equal(B.ladeVorschlag(v, "_warten", id)?.wartenGrund, "seite-passt-nicht", id);
  const rf = R.listeRueckfragen(v);
  assert.deepEqual(rf.map((x) => [x.typ, x.grund]), [["heikel", "heikel"]], "nur die heikle Rückfrage auf der passenden Seite; kein „widerspruch“ für w1, keine Rückfrage für h1");
  assert.match(rf[0].frage, /Orion Miete/);
  // ⚪ kurzlebig (auch wenn die Seite zusätzlich nicht passt)
  assert.ok(aussortiert(v, "kurzlebig", "k1"));
  assert.ok(aussortiert(v, "kurzlebig", "k2"));
  // Protokoll
  const a = P.leseAktionen(v);
  assert.equal(a.filter((x) => x.stufe === "warten" && x.grund === "seite-passt-nicht").length, 4);
  assert.equal(a.filter((x) => x.stufe === "aussortieren" && x.grund === "kurzlebig").length, 2);
  // Bericht: Zählzeile + Gründelisten
  const b = bericht(v, r);
  assert.match(b, ZAEHLZEILE(4, 2));
  assert.match(b, /### Aussortiert \(Gründe\)[\s\S]*- kurzlebig: 2/);
  assert.match(b, /### Wartet \(Gründe\)[\s\S]*- seite-passt-nicht: 4/);
  const l = P.leseLetzter(v);
  assert.deepEqual([l.zahlen.seitePasstNicht, l.zahlen.kurzlebig], [4, 2]);
  assert.equal(git(v, "status", "--porcelain"), "");
  assert.equal(git(v, "branch", "--list", "tageslauf/*"), "");
});

test("weitere Läufe: Zustand bleibt stabil (nichts neu gezählt, nichts verschoben); ohne Seitenänderung kommt der Abgleich aus dem Cache", async () => {
  const v = aufbau();
  const ki = acht(v);
  await lauf(v);
  const stabil = async (r) => {
    assert.equal(r.status, "ok");
    assert.deepEqual([r.zahlen.uebernommen, r.zahlen.aussortiert, r.zahlen.wartenNeu, r.zahlen.seitePasstNicht, r.zahlen.kurzlebig], [0, 0, 0, 0, 0]);
    for (const id of ["p1", "p2", "w1", "h1"]) assert.equal(B.ladeVorschlag(v, "_warten", id)?.wartenGrund, "seite-passt-nicht", id);
    assert.deepEqual(R.listeRueckfragen(v).filter((x) => x.typ !== "stichprobe").map((x) => x.typ), ["heikel"], "keine doppelte Rückfrage (Stichproben der früheren Übernahme zählen nicht)");
  };
  // Lauf 2: die Seite hat sich durch die Übernahme von g1 geändert → die wartenden werden (wie schon immer) neu gefragt, mit gleichem Ergebnis.
  await stabil(await lauf(v, { jetzt: JETZT + 3600e3 }));
  const nach2 = ki.anzahl();
  // Lauf 3: Seite unverändert → alles aus dem Cache, kein KI-Aufruf.
  await stabil(await lauf(v, { jetzt: JETZT + 7200e3 }));
  assert.equal(ki.anzahl(), nach2, "kein neuer KI-Aufruf");
});

test("Probe: dieselben Zahlen im Probe-Bericht, Vault bytegleich", async () => {
  const v = aufbau();
  acht(v);
  const vorher = schnappschuss(v);
  const r = await lauf(v, { probe: true });
  assert.equal(r.modus, "probe");
  assert.deepEqual([r.zahlen.uebernommen, r.zahlen.aussortiert, r.zahlen.wartenNeu, r.zahlen.seitePasstNicht, r.zahlen.kurzlebig], [1, 2, 4, 4, 2]);
  assert.match(bericht(v, r), ZAEHLZEILE(4, 2));
  assert.equal(schnappschuss(v), vorher);
});

test("Stand: dauerhaft gilt nicht (kurzlebiger Stand wird ersetzt), passtZurSeite schon (falsche Projektseite → wartet)", async () => {
  const repo = join(tempOrdner("repos"), "orion-repo");
  mkdirSync(join(repo, ".git"), { recursive: true });
  const seiten = { [ORION]: seitenText({ fm: { name: "orion", description: "Orion", repo: "orion-repo" }, rumpf: "# Orion\n\n## Fakten\n\n- a · Stand 01.10.2026 · [[x]]\n" }) };
  const stand = (v, id, text, zitat) => fakt(v, id, "Stand Orion", text, zitat, { art: "stand", ordner: repo });

  const v = aufbau({ seiten });
  stand(v, "st1", "Orion läuft auf Version zwei.", "Wir haben Orion heute auf Version zwei gehoben");
  const ki = fakeKi([{ wenn: "FAKT: Orion läuft auf Version zwei.", antwort: antwort({ dauerhaft: false }) }]);
  const r = await lauf(v);
  assert.equal(ki.haikuAnzahl(), 1);
  assert.equal(ki.richterAnzahl(), 1, "auch der Stand geht durch den Richter (er beurteilt den Kernsatz)");
  assert.equal(r.zahlen.uebernommen, 1, JSON.stringify(r.zahlen));
  assert.match(readFileSync(join(v, ORION), "utf8"), /^## Stand\n\nStand 2\d\.10\.2026 · \[\[10_projekte\/belege\/2026-10\/st1\]\]\n\nOrion läuft auf Version zwei\./m);
  assert.equal(r.zahlen.kurzlebig, 0);

  const v2 = aufbau({ seiten });
  stand(v2, "st2", "Orion hat jetzt zwei Pumpen.", "Orion hat zwei Pumpen");
  fakeKi([{ wenn: "FAKT: Orion hat jetzt zwei Pumpen.", antwort: antwort({ passtZurSeite: false }) }]);
  const vorher = readFileSync(join(v2, ORION), "utf8");
  const r2 = await lauf(v2);
  assert.equal(r2.zahlen.uebernommen, 0);
  assert.equal(B.ladeVorschlag(v2, "_warten", "st2")?.wartenGrund, "seite-passt-nicht");
  assert.equal(readFileSync(join(v2, ORION), "utf8"), vorher);
  assert.equal(r2.zahlen.seitePasstNicht, 1);
});

test("Antwort ohne oder mit kaputten neuen Feldern: wartet mit ki-antwort-unvollstaendig (nichts archiviert, nichts gecacht) — der nächste Lauf fragt neu und übernimmt bei vollständiger Antwort", async () => {
  const v = aufbau();
  fakt(v, "o1", "Orion Lüfter", "Orion hat jetzt zwei Lüfter.", "Orion hat jetzt zwei Lüfter");
  fakt(v, "o2", "Orion Kerne", "Orion hat jetzt vier Kerne.", "Orion hat jetzt vier Kerne");
  fakt(v, "o3", "Orion Takt", "Orion taktet jetzt schneller.", "Orion taktet jetzt schneller");
  const ki = fakeKi([
    { wenn: "FAKT: Orion Lüfter", antwort: '{"urteil":"neu","zitatStuetzt":true}' },                                                      // beide Felder fehlen
    { wenn: "FAKT: Orion Kerne", antwort: '{"urteil":"neu","zitatStuetzt":true,"passtZurSeite":"ja","dauerhaft":true}' },                // passtZurSeite kein Boolean
    { wenn: "FAKT: Orion Takt", antwort: '{"urteil":"neu","zitatStuetzt":true,"passtZurSeite":true,"dauerhaft":"false"}' },              // dauerhaft als Text, NICHT false
  ]);
  const vorher = readFileSync(join(v, ORION), "utf8");
  const r = await lauf(v);
  assert.equal(r.status, "ok");
  assert.equal(ki.anzahl(), 3);
  assert.equal(r.zahlen.uebernommen, 0);
  assert.equal(readFileSync(join(v, ORION), "utf8"), vorher);
  for (const id of ["o1", "o2", "o3"]) assert.equal(B.ladeVorschlag(v, "_warten", id)?.wartenGrund, "ki-antwort-unvollstaendig", id);
  assert.ok(!aussortiert(v, "kurzlebig", "o1") && !aussortiert(v, "kurzlebig", "o3"), "nie kurzlebig wegen einer kaputten Antwort");
  assert.ok(!aussortiert(v, "seite-passt-nicht", "o2"));
  assert.deepEqual([r.zahlen.aussortiert, r.zahlen.wartenNeu, r.zahlen.seitePasstNicht, r.zahlen.kurzlebig, r.zahlen.rueckfragenNeu], [0, 3, 0, 0, 0]);
  assert.match(bericht(v, r), /### Wartet \(Gründe\)[\s\S]*- ki-antwort-unvollstaendig: 3/);
  // Nächster Lauf: nicht gecacht → es wird neu gefragt; jetzt vollständig → übernommen, nichts bleibt in _warten
  const ki2 = fakeKi([{ wenn: "FAKT:", antwort: antwort() }]);
  const r2 = await lauf(v, { jetzt: JETZT + 3600e3 });
  assert.equal(ki2.haikuAnzahl(), 3, "alle drei werden neu gefragt (kein Cache-Eintrag für die unvollständige Antwort)");
  assert.equal(ki2.richterAnzahl(), 3, "und danach vom Richter beurteilt");
  assert.equal(r2.zahlen.uebernommen, 3);
  for (const id of ["o1", "o2", "o3"]) assert.equal(B.ladeVorschlag(v, "_warten", id), null, id);
});
