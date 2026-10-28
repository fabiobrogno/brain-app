// .tools/tests/test-tageslauf-protokoll-tor.mjs — Das Einschwing-Tor ist fail-closed (B2, Folgepunkt N3): Das Tor liest nur aktionen.jsonl (und
// pruefungen.jsonl). Lässt sich das Protokoll nicht lesen/anhängen (Ordner statt Datei, Rechte, voller Datenträger), darf der Lauf KEINE
// Übernahme schreiben, die er hinterher nicht zählen könnte: Vorab-Probe (protokollGesund, Probe-Append) vor dem Schreib-/Merge-Schritt → Status
// teilweise mit Grund protokoll-nicht-schreibbar, laut im Bericht, in letzter.json und in der Morgenzeile; scheitert das sichere Schreiben NACH
// dem Merge doch, ist der Lauf ebenfalls teilweise, und solange das Protokoll nicht gesund ist, vergibt das Tor keine Plätze (frei = 0).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isoliere, neuerTestVault, legeVorschlagAn, seitenText, fakeKi, git, FAKE_BEFEHL, JETZT } from "./tageslauf-hilfe.mjs";
import { SEITE, lauf } from "./lauf-hilfe.mjs";
const P = await import("../tageslauf/protokoll.mjs");
const E = await import("../tageslauf/einschwingen.mjs");
const R = await import("../rueckfragen.mjs");
const B = await import("../tageslauf/bestand.mjs");
const M = await import("../tageslauf/morgen.mjs");
isoliere();

const aktionenDatei = (v) => join(P.TL_DIR(v), "aktionen.jsonl");
const pruefungenDatei = (v) => join(P.TL_DIR(v), "pruefungen.jsonl");
const alsOrdner = (pfad) => { rmSync(pfad, { recursive: true, force: true }); mkdirSync(pfad, { recursive: true }); };
const wiederHeil = (pfad) => rmSync(pfad, { recursive: true, force: true });
const STUNDE = 3600e3;

const WOERTER = ["Lüfter", "Kühlung", "Netzteil", "Gehäuse", "Backup", "Archiv", "Router", "Switch", "Monitor", "Tastatur", "Drucker", "Scanner", "Mikrofon", "Lautsprecher"];
const ORTE = ["Keller", "Flur", "Büro", "Lager", "Dach", "Garage", "Küche", "Labor", "Werkstatt", "Hof", "Turm", "Saal", "Anbau", "Bunker"];
const FARBEN = ["rot", "blau", "grün", "gelb", "weiß", "schwarz", "grau", "braun", "lila", "rosa", "orange", "silber", "gold", "türkis"];
const neu = '{"urteil":"neu","zitatStuetzt":true,"passtZurSeite":true,"dauerhaft":true}';
function torVault({ n = 14, einschwingen } = {}) {
  const v = neuerTestVault({ automatik: einschwingen === undefined ? { tageslauf: "an" } : { tageslauf: "an", einschwingen },
    seiten: { [SEITE]: seitenText({ fm: { name: "orion", description: "Orion Testsystem" }, rumpf: "# Orion\n\nOrion ist das Testsystem.\n\n## Fakten\n\n- Orion läuft auf Port 3309 · Stand 01.10.2026 · [[x]]\n" }) } });
  mkdirSync(join(v, ".logs"), { recursive: true });
  writeFileSync(join(v, ".logs", "aliasse.json"), JSON.stringify({ orion: SEITE }));
  for (let i = 0; i < n; i++) {
    const id = `f${String(i + 1).padStart(2, "0")}`;
    const satz = `Orion nutzt ein ${WOERTER[i]} im ${ORTE[i]} in ${FARBEN[i]}`;
    legeVorschlagAn(v, { id, titel: `Orion ${WOERTER[i]}`, text: `${satz}.`, zitat: satz, herkunft: "tool", fundstelle: `s1#u-${id} 2026-10-20T10:00:00Z` });
  }
  return v;
}
const mitKi = () => fakeKi([{ wenn: "FAKT:", antwort: neu }]);
const inInbox = (v) => B.ladeVorschlaege(v, { unterordner: ["_vorschlaege"] }).map((x) => x.id).sort();
const wartende = (v) => B.ladeVorschlaege(v, { unterordner: ["_warten"] });
const faktZeilen = (v) => (readFileSync(join(v, SEITE), "utf8").match(/\[\[10_projekte\/belege\/2026-10\/f\d\d\]\]/g) || []).length;
const commits = (v) => git(v, "rev-list", "--count", "main");
const antworte = (v, wahl, liste) => { for (const id of liste) R.beantworte(v, R.listeRueckfragen(v).find((x) => x.typ === "stichprobe" && x.fm.aktion === id).id, wahl); };

// ------------------------------------------------------------------------------------------------ protokollGesund
test("protokollGesund: gesundes Protokoll → ok, Dateien danach unverändert (die Probe hängt nichts Bleibendes an)", () => {
  const v = neuerTestVault();
  assert.deepEqual(P.protokollGesund(v), { ok: true });
  assert.equal(statSync(aktionenDatei(v)).size, 0, "neu angelegt, leer");
  const zeilen = '{"lauf":"L1","id":"a","stufe":"warten"}\n';
  writeFileSync(aktionenDatei(v), zeilen);
  writeFileSync(pruefungenDatei(v), '{"art":"stichprobe","fehler":false}');   // ohne Zeilenumbruch am Ende
  assert.equal(P.protokollGesund(v).ok, true);
  assert.equal(P.protokollGesund(v).ok, true);
  assert.equal(readFileSync(aktionenDatei(v), "utf8"), zeilen, "byte-gleich");
  assert.equal(readFileSync(pruefungenDatei(v), "utf8"), '{"art":"stichprobe","fehler":false}', "auch ohne Schluss-Umbruch byte-gleich");
  assert.deepEqual(P.leseAktionen(v).map((a) => a.id), ["a"]);
});

test("protokollGesund: aktionen.jsonl oder pruefungen.jsonl als Ordner, schreibgeschützt, oder .logs/tageslauf selbst eine Datei → nicht ok, Grund protokoll-nicht-schreibbar", (t) => {
  const v = neuerTestVault();
  alsOrdner(aktionenDatei(v));
  const r = P.protokollGesund(v);
  assert.deepEqual([r.ok, r.grund], [false, "protokoll-nicht-schreibbar"]);
  assert.match(r.fehler, /^[A-Z]+$|\S/);
  wiederHeil(aktionenDatei(v));
  alsOrdner(pruefungenDatei(v));
  assert.equal(P.protokollGesund(v).ok, false, "auch die Prüfungen gehören zum Protokoll (das Tor liest sie)");
  wiederHeil(pruefungenDatei(v));
  assert.equal(P.protokollGesund(v).ok, true, "wieder heil");
  if (typeof process.getuid === "function" && process.getuid() !== 0) {
    chmodSync(aktionenDatei(v), 0o444);
    assert.equal(P.protokollGesund(v).ok, false, "schreibgeschützt");
    chmodSync(aktionenDatei(v), 0o200);
    assert.equal(P.protokollGesund(v).ok, false, "nicht lesbar");
    chmodSync(aktionenDatei(v), 0o644);
    assert.equal(P.protokollGesund(v).ok, true);
  } else t.diagnostic("als root: Rechte-Fälle übersprungen");
  const w = neuerTestVault();
  mkdirSync(join(w, ".logs"), { recursive: true });
  writeFileSync(P.TL_DIR(w), "ich bin eine Datei");
  assert.equal(P.protokollGesund(w).ok, false, "das Verzeichnis lässt sich nicht anlegen");
});

// Die Vorab-Probe schreibt NIE in die Protokolldateien (kein Anhängen, kein Kürzen): Ein früherer Stand hängte einen Zeilenumbruch an und kürzte danach auf die alte
// Länge zurück — ein gleichzeitiger Anhänger (zweiter Lauf, brain zurueck, Antworten-Lauf) verlor dabei Zeilen (Stress: ~10 000 von 20 000). Jetzt: Rechte der Dateien
// durch Öffnen (lesen + anhängen), Platz/Verzeichnis durch eine Schreibprobe in eine Nachbardatei im selben Ordner.
const MODUL = pathToFileURL(fileURLToPath(new URL("../tageslauf/protokoll.mjs", import.meta.url))).href;
const kindEnde = (k) => new Promise((ok, nein) => { k.on("error", nein); k.on("exit", (code) => ok(code)); });

test("protokollGesund: ein paralleler Anhänger verliert KEINE Zeile (20 000 Zeilen, Probe läuft dauernd daneben); Dateien und Ordner danach ohne Reste", async () => {
  const v = neuerTestVault();
  P.protokollGesund(v);                                                              // legt Ordner und Dateien an
  const ziel = aktionenDatei(v), stopp = join(v, "stopp-probe"), N = 20000;
  const anhaenger = spawn(process.execPath, ["--input-type=module", "-e",
    `import { appendFileSync } from "node:fs"; for (let i = 0; i < ${N}; i++) appendFileSync(${JSON.stringify(ziel)}, JSON.stringify({ lauf: "L1", id: "z" + i, stufe: "warten" }) + "\\n");`], { stdio: "inherit" });
  const probierer = spawn(process.execPath, ["--input-type=module", "-e",
    `import { existsSync } from "node:fs"; import { protokollGesund } from ${JSON.stringify(MODUL)}; const v = ${JSON.stringify(v)}; let schlecht = 0;
     const ende = Date.now() + 60000; while (Date.now() < ende && !existsSync(${JSON.stringify(stopp)})) { if (!protokollGesund(v).ok) schlecht++; } process.exit(schlecht ? 3 : 0);`], { stdio: "inherit" });
  const ca = await kindEnde(anhaenger);
  writeFileSync(stopp, "");                                                          // der Anhänger ist fertig → die Probe darf aufhören
  const cp = await kindEnde(probierer);
  assert.equal(ca, 0, "Anhänger lief durch");
  assert.equal(cp, 0, "die Probe meldete nie „nicht gesund“");
  const zeilen = readFileSync(ziel, "utf8").split("\n");
  assert.equal(zeilen.pop(), "", "endet mit Zeilenumbruch, nichts Fremdes dahinter");
  assert.equal(zeilen.length, N, `alle ${N} Zeilen sind da (statt ~${N / 2} wie beim Kürzen)`);
  assert.ok(zeilen.every((z, i) => z === JSON.stringify({ lauf: "L1", id: "z" + i, stufe: "warten" })), "jede Zeile unversehrt und in Reihenfolge");
  assert.deepEqual(readdirSync(P.TL_DIR(v)).filter((n) => !["aktionen.jsonl", "pruefungen.jsonl"].includes(n)), [], "keine Probe-Reste im Ordner");
});

test("protokollGesund: die Probe schreibt nichts in die Datei; scheitert die Schreibprobe im Ordner (kein Platz, keine Rechte), ist das Protokoll nicht gesund", (t) => {
  const v = neuerTestVault();
  assert.equal(P.protokollGesund(v).ok, true);
  assert.equal(statSync(pruefungenDatei(v)).size, 0, "die Probe schreibt nichts in die Datei");
  if (typeof process.getuid === "function" && process.getuid() !== 0) {
    chmodSync(P.TL_DIR(v), 0o555);                                                   // Ordner schreibgeschützt: die Nachbardatei lässt sich nicht anlegen
    try {
      const r = P.protokollGesund(v);
      assert.deepEqual([r.ok, r.grund], [false, "protokoll-nicht-schreibbar"]);
    } finally { chmodSync(P.TL_DIR(v), 0o755); }
    assert.equal(P.protokollGesund(v).ok, true, "wieder heil");
  } else t.diagnostic("als root: Ordner-Rechte-Fall übersprungen");
});

// ------------------------------------------------------------------------------------------------ ganzer Lauf: Vorab-Probe
test("aktionen.jsonl als Ordner: der Lauf übernimmt NICHTS — teilweise, Grund protokoll-nicht-schreibbar, laut im Bericht, in letzter.json und in der Morgenzeile; die Vorschläge bleiben liegen", async () => {
  const v = torVault();
  mitKi();
  alsOrdner(aktionenDatei(v));
  const wiki0 = readFileSync(join(v, SEITE), "utf8"), c0 = commits(v);
  const r = await lauf(v);
  assert.equal(r.status, "teilweise", JSON.stringify(r));
  assert.match(r.grund, /protokoll-nicht-schreibbar/);
  assert.equal(r.zahlen.uebernommen, 0);
  assert.equal(readFileSync(join(v, SEITE), "utf8"), wiki0, "die Seite ist unverändert");
  assert.equal(commits(v), c0, "kein einziger Commit");
  assert.equal(inInbox(v).length, 14, "alle 14 liegen noch in der Inbox");
  assert.deepEqual(wartende(v), [], "und warten nicht abgelegt (kein Grund einschwingen: es war nie das Tor)");
  assert.equal(R.listeRueckfragen(v).length, 0, "keine Einzelprüfung ohne Übernahme");
  const bericht = readFileSync(join(v, r.bericht), "utf8");
  assert.match(bericht, /protokoll-nicht-schreibbar/);
  assert.match(bericht, /Protokoll nicht schreibbar/);
  assert.match(bericht, /teilweise/);
  const l = P.leseLetzter(v);
  assert.equal(l.status, "teilweise");
  assert.equal(l.protokoll, "nicht-schreibbar");
  assert.equal(l.erfolgreich, false, "gilt nicht als erfolgreich — wird beim nächsten Takt wiederholt");
  assert.match(M.morgenZeile(v, { jetzt: JETZT }), /Protokoll nicht schreibbar — keine automatischen Übernahmen/);
});

test("drei Läufe hintereinander ohne Antwort und mit kaputtem Protokoll: nie eine ungeprüfte Übernahme (vorher: 10 + 10 + 3)", async () => {
  const v = torVault();
  mitKi();
  alsOrdner(aktionenDatei(v));
  for (let i = 0; i < 3; i++) {
    const r = await lauf(v, { jetzt: JETZT + i * STUNDE });
    assert.equal(r.zahlen.uebernommen, 0, `Lauf ${i + 1}`);
    assert.equal(r.status, "teilweise");
  }
  assert.equal(faktZeilen(v), 0);
  assert.equal(inInbox(v).length, 14);
  const s = E.einschwingStand(v);
  assert.deepEqual([s.A, s.O], [0, 0]);
});

test("ist das Protokoll wieder heil, läuft die Einschwingphase normal weiter (10 Übernahmen, Einzelprüfungen); der Hinweis in letzter.json und in der Morgenzeile verschwindet", async () => {
  const v = torVault();
  mitKi();
  alsOrdner(aktionenDatei(v));
  await lauf(v);
  wiederHeil(aktionenDatei(v));
  const r = await lauf(v, { jetzt: JETZT + STUNDE });
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.equal(r.zahlen.uebernommen, 10);
  assert.equal(P.leseLetzter(v).protokoll, undefined);
  assert.doesNotMatch(M.morgenZeile(v, { jetzt: JETZT + STUNDE }) || "", /Protokoll nicht schreibbar/);
  assert.equal(R.listeRueckfragen(v).filter((x) => x.typ === "stichprobe").length, 10);
});

test("pruefungen.jsonl als Ordner zählt ebenso (das Tor liest beide Dateien)", async () => {
  const v = torVault();
  mitKi();
  alsOrdner(pruefungenDatei(v));
  const r = await lauf(v);
  assert.equal(r.status, "teilweise");
  assert.match(r.grund, /protokoll-nicht-schreibbar/);
  assert.equal(r.zahlen.uebernommen, 0);
});

test("Probemodus: keine Probe-Schreibung, keine Sperre — die Probe rechnet weiter und meldet das Protokoll nicht (sie schreibt nie in aktionen.jsonl)", async () => {
  const v = torVault();
  mitKi();
  alsOrdner(aktionenDatei(v));
  const r = await lauf(v, { probe: true });
  assert.equal(r.modus, "probe");
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.equal(r.zahlen.uebernommen, 14, "die Probe rechnet alle durch");
  assert.ok(!existsSync(pruefungenDatei(v)), "die Probe legt nichts an");
});

// ------------------------------------------------------------------------------------------------ Probe unmittelbar vor dem Schreiben
test("bricht das Protokoll erst NACH dem Start des Laufs weg (Haken vorSchreiben): die Vorab-Probe vor dem Schreib-/Merge-Schritt hält es auf — nichts übernommen, nichts verschoben", async () => {
  const v = torVault();
  mitKi();
  const wiki0 = readFileSync(join(v, SEITE), "utf8"), c0 = commits(v);
  const r = await lauf(v, { haken: { vorSchreiben: () => alsOrdner(aktionenDatei(v)) } });
  assert.equal(r.status, "teilweise", JSON.stringify(r));
  assert.match(r.grund, /protokoll-nicht-schreibbar/);
  assert.equal(r.zahlen.uebernommen, 0);
  assert.equal(readFileSync(join(v, SEITE), "utf8"), wiki0);
  assert.equal(commits(v), c0);
  assert.equal(inInbox(v).length, 10, "die zehn Plätze-Kandidaten liegen noch dort, wo sie lagen (nicht verschoben)");
  assert.deepEqual(wartende(v).map((x) => x.wartenGrund), ["einschwingen", "einschwingen", "einschwingen", "einschwingen"], "die übrigen vier hat das Tor schon vorher warten lassen");
  assert.match(readFileSync(join(v, r.bericht), "utf8"), /Protokoll nicht schreibbar/);
  assert.equal(P.leseLetzter(v).protokoll, "nicht-schreibbar");
});

test("ohne ein Protokoll schreibt der Lauf auch nichts, was du selbst freigegeben hast (die Antwort bleibt offen und wird nach der Heilung angewendet)", async () => {
  const v = torVault({ n: 1 });
  legeVorschlagAn(v, { id: "h1", titel: "Orion Rechnung", text: "Orion kostet 1.200 € im Monat.", zitat: "Orion kostet uns 1.200 € im Monat", herkunft: "du", fundstelle: "s1#u-h1 2026-10-20T10:00:00Z" });
  mitKi();
  await lauf(v, { jetzt: JETZT });
  const heikel = R.listeRueckfragen(v).find((x) => x.typ === "heikel");
  assert.ok(heikel);
  R.beantworte(v, heikel.id, "uebernehmen");
  alsOrdner(aktionenDatei(v));
  const r = await lauf(v, { jetzt: JETZT + STUNDE });
  assert.equal(r.status, "teilweise");
  assert.equal(r.zahlen.uebernommen, 0);
  assert.doesNotMatch(readFileSync(join(v, SEITE), "utf8"), /belege\/2026-10\/h1/, "nicht geschrieben");
  assert.ok(R.listeRueckfragen(v).some((x) => x.id === heikel.id && x.antwort === "uebernehmen"), "die Antwort ist nicht verloren");
  wiederHeil(aktionenDatei(v));
  const r2 = await lauf(v, { jetzt: JETZT + 2 * STUNDE });
  assert.equal(r2.status, "ok", JSON.stringify(r2));
  assert.match(readFileSync(join(v, SEITE), "utf8"), /belege\/2026-10\/h1/, "nach der Heilung kommt sie dran");
});

test("Schutz-Felder gehen auch ohne Protokoll durch: eine als falsch gemeldete Seite (Antwort „falsch“ auf eine zweifel-Rückfrage) bekommt ihr Feld zweifel", async () => {
  const v = torVault({ n: 1, einschwingen: 0 });
  const ctx = P.neuerLauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT });
  R.legeRueckfrageAn(ctx, { typ: "zweifel", frage: "Stimmt entitaet_orion.md noch?", seite: SEITE, grund: "rueckfrage-test" });
  const z = R.listeRueckfragen(v).find((x) => x.typ === "zweifel");
  R.beantworte(v, z.id, "falsch", "der Port stimmt nicht");
  mitKi();
  alsOrdner(aktionenDatei(v));
  const r = await lauf(v);
  assert.equal(r.status, "teilweise", JSON.stringify(r));
  assert.match(readFileSync(join(v, SEITE), "utf8"), /\nzweifel: .*der Port stimmt nicht/, "Feld gesetzt");
  assert.equal(r.zahlen.uebernommen, 0, "keine Übernahme eines Fakts");
  assert.equal(faktZeilen(v), 0);
});

// ------------------------------------------------------------------------------------------------ Schreibfehler NACH dem Merge
test("scheitert das sichere Schreiben nach dem Merge (Haken nachMerge): Lauf teilweise mit Grund, laut; der nächste Lauf vergibt keinen Platz, solange das Protokoll nicht gesund ist", async () => {
  const v = torVault();
  mitKi();
  const r = await lauf(v, { haken: { nachMerge: () => alsOrdner(aktionenDatei(v)) } });
  assert.equal(r.status, "teilweise", JSON.stringify(r));
  assert.match(r.grund, /protokoll-nicht-schreibbar/);
  assert.equal(faktZeilen(v), 10, "gemergt ist gemergt (nur das Protokoll fehlt)");
  assert.equal(P.leseLetzter(v).protokoll, "nicht-schreibbar");
  assert.match(readFileSync(join(v, r.bericht), "utf8"), /Protokoll nicht schreibbar/);
  assert.match(M.morgenZeile(v, { jetzt: JETZT }), /Protokoll nicht schreibbar/);
  // Nächster Lauf, Protokoll weiter kaputt: das Tor ist zu — nichts Neues.
  const r2 = await lauf(v, { jetzt: JETZT + STUNDE });
  assert.equal(r2.status, "teilweise");
  assert.equal(r2.zahlen.uebernommen, 0);
  assert.equal(faktZeilen(v), 10);
  const ctx = P.neuerLauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT });
  ctx.protokollKaputt = true;
  assert.equal(E.einschwingenStart(ctx).frei, 0, "frei = 0 bei nicht gesundem Protokoll");
  assert.equal(E.einschwingTor(ctx), "warten", "und das Tor vergibt keinen Platz");
});

test("auch ohne Einschwingphase (N = 0) ist ein Protokollfehler nach dem Merge laut — nie status ok", async () => {
  const v = torVault({ einschwingen: 0 });
  mitKi();
  const r = await lauf(v, { haken: { nachMerge: () => alsOrdner(aktionenDatei(v)) } });
  assert.notEqual(r.status, "ok");
  assert.match(r.grund, /protokoll-nicht-schreibbar/);
});

test("gesundes Protokoll: nichts ändert sich — 10 Übernahmen, ok, kein Hinweis; nach 3 × „stimmt“ gehen weitere 3 durch", async () => {
  const v = torVault();
  mitKi();
  const r = await lauf(v);
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.equal(r.zahlen.uebernommen, 10);
  assert.equal(r.grund, null);
  assert.equal(P.leseLetzter(v).protokoll, undefined);
  assert.doesNotMatch(readFileSync(join(v, r.bericht), "utf8"), /Protokoll nicht schreibbar/);
  antworte(v, "stimmt", ["f01", "f02", "f03"]);
  const r2 = await lauf(v, { jetzt: JETZT + STUNDE });
  assert.equal(r2.zahlen.uebernommen, 3);
});
