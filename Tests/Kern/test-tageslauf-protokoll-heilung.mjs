// .tools/tests/test-tageslauf-protokoll-heilung.mjs — Doppelausfall nach dem Merge (Folgepunkt aus der B2-Gegenprüfung): Scheitern das sichere Schreiben der Aktionen nach
// dem Merge UND das Nachholen im finally (aktionen.jsonl ist z. B. ein Ordner), stehen die Übernahmen auf main, aber nicht im Protokoll. Nach der Heilung des Protokolls
// würde das Einschwing-Tor wieder öffnen (A = 0) und `brain zurueck` fände nichts. Selbstheilung: zu Beginn jedes Laufs (und in `brain zurueck`) wird jeder Commit auf main
// mit dem Betreff-Muster des Tageslaufs (auto(<lauf>): … [<id>]) ohne passende Aktion als Aktion rekonstruiert — im Zweifel als Einschwing-Übernahme (fail-closed fürs Tor),
// laut im Bericht. Idempotent; ältere Commits (> 30 Tage) nur gezielt über `brain zurueck <lauf|id>`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { isoliere, neuerTestVault, legeVorschlagAn, seitenText, fakeKi, git, FAKE_BEFEHL, JETZT } from "./tageslauf-hilfe.mjs";
import { SEITE, lauf } from "./lauf-hilfe.mjs";
import * as Z from "./zurueck-hilfe.mjs";
const P = await import("../tageslauf/protokoll.mjs");
const E = await import("../tageslauf/einschwingen.mjs");
const R = await import("../rueckfragen.mjs");
const H = await import("../tageslauf/heilung.mjs");
const Zr = await import("../tageslauf/zurueck.mjs");
isoliere();

const aktionenDatei = (v) => join(P.TL_DIR(v), "aktionen.jsonl");
const alsOrdner = (pfad) => { rmSync(pfad, { recursive: true, force: true }); mkdirSync(pfad, { recursive: true }); };
const wiederHeil = (pfad) => rmSync(pfad, { recursive: true, force: true });
const STUNDE = 3600e3, TAG = 86400e3;
const letzterBericht = (v, r) => readFileSync(join(v, r.bericht), "utf8").split("\n## Lauf ").pop();
const rohZeilen = (v) => (existsSync(aktionenDatei(v)) ? readFileSync(aktionenDatei(v), "utf8").split("\n").filter(Boolean) : []);
const uebernahmen = (v) => P.leseAktionen(v).filter((a) => a.stufe === "uebernehmen");

// ------------------------------------------------------------------------------------------------ der Doppelausfall im ganzen Lauf
const WOERTER = ["Lüfter", "Kühlung", "Netzteil", "Gehäuse", "Backup", "Archiv", "Router", "Switch", "Monitor", "Tastatur", "Drucker", "Scanner", "Mikrofon", "Lautsprecher"];
const ORTE = ["Keller", "Flur", "Büro", "Lager", "Dach", "Garage", "Küche", "Labor", "Werkstatt", "Hof", "Turm", "Saal", "Anbau", "Bunker"];
const FARBEN = ["rot", "blau", "grün", "gelb", "weiß", "schwarz", "grau", "braun", "lila", "rosa", "orange", "silber", "gold", "türkis"];
const neu = '{"urteil":"neu","zitatStuetzt":true,"passtZurSeite":true,"dauerhaft":true}';
function torVault({ n = 14 } = {}) {
  const v = neuerTestVault({ automatik: { tageslauf: "an" },
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
const faktZeilen = (v) => (readFileSync(join(v, SEITE), "utf8").match(/\[\[10_projekte\/belege\/2026-10\/f\d\d\]\]/g) || []).length;
const stichproben = (v) => R.listeRueckfragen(v).filter((x) => x.typ === "stichprobe" && x.quelle === R.EINSCHWING_QUELLE);

async function doppelausfall() {
  const v = torVault();
  mitKi();
  const r1 = await lauf(v, { haken: { nachMerge: () => alsOrdner(aktionenDatei(v)) } });   // früh schreiben UND im finally nachholen scheitern beide
  assert.equal(r1.status, "teilweise", JSON.stringify(r1));
  assert.match(r1.grund, /protokoll-nicht-schreibbar/);
  assert.equal(faktZeilen(v), 10, "gemergt ist gemergt");
  wiederHeil(aktionenDatei(v));                                                            // das Protokoll ist wieder da — aber ohne die zehn Übernahmen
  assert.deepEqual(uebernahmen(v), []);
  return { v, r1 };
}

test("Doppelausfall nach dem Merge: der nächste Lauf rekonstruiert die zehn Übernahmen, das Tor zählt sie (frei sinkt, nichts Neues), die Stichproben werden angelegt, `brain zurueck <lauf>` findet sie", async () => {
  const { v, r1 } = await doppelausfall();
  assert.equal(E.einschwingStand(v).A, 0, "Gegenprobe: ohne Heilung sähe das Tor nichts (A = 0, frei = 10)");
  const r2 = await lauf(v, { jetzt: JETZT + STUNDE });
  assert.equal(r2.status, "ok", JSON.stringify(r2));
  const rek = uebernahmen(v);
  assert.equal(rek.length, 10, "alle zehn rekonstruiert");
  for (const a of rek) {
    assert.equal(a.lauf, r1.lauf, "mit der Lauf-Nummer aus dem Commit-Betreff");
    assert.equal(a.auto, true);
    assert.equal(a.einschwingen, true, "im Zweifel Einschwing-Übernahme — fail-closed fürs Tor");
    assert.equal(a.rekonstruiert, true);
    assert.match(a.commit, /^[0-9a-f]{40}$/);
    assert.equal(a.ziel, SEITE);
    assert.match(a.beleg, /^10_projekte\/belege\/2026-10\/f\d\d\.md$/);
    assert.match(a.titel, /^Orion /);
    assert.match(a.zitat, /^Orion nutzt ein /);
    assert.equal(a.herkunft, "tool");
    assert.match(a.fundstelle, /^s1#u-f\d\d /);
    assert.match(a.id, /^f\d\d$/);
    assert.equal(a.commit, git(v, "log", "--format=%H", "--grep", `\\[${a.id}\\]$`, "main").split("\n")[0], "der Hash ist der Commit dieser Übernahme");
  }
  assert.equal(new Set(rek.map((a) => a.id)).size, 10);
  const s = E.einschwingStand(v);
  assert.deepEqual([s.A, s.O, s.frei], [10, 10, 0], "das Tor zählt sie");
  assert.equal(r2.zahlen.uebernommen, 0, "kein neuer Platz — vorher (ohne Heilung) wären es weitere 10 gewesen");
  assert.equal(faktZeilen(v), 10);
  assert.equal(stichproben(v).length, 10, "die Einzelprüfungen werden angelegt");
  assert.match(letzterBericht(v, r2), /Protokoll geheilt: 10 Übernahmen aus dem Git-Verlauf nachgetragen/, "laut im Bericht");
  assert.ok(P.leseAktionen(v).some((a) => a.stufe === "heilung" && a.id === "lauf"), "und als Aktion im Protokoll");
  const z = Zr.nimmZurueck(v, { lauf: r1.lauf, jetzt: JETZT + 2 * STUNDE });
  assert.equal(z.ok, true, JSON.stringify(z));
  assert.equal(z.zurueck, 10, "brain zurueck <lauf> findet die zehn");
  assert.equal(faktZeilen(v), 0);
});

test("brain zurueck heilt selbst (ohne dass erst ein Lauf kam): <lauf> und <id> finden Übernahmen, die nie ins Protokoll kamen", async () => {
  const { v, r1 } = await doppelausfall();
  const einzeln = Zr.nimmZurueck(v, { ids: ["f03"], jetzt: JETZT + STUNDE });
  assert.equal(einzeln.ok, true, JSON.stringify(einzeln));
  assert.equal(einzeln.zurueck, 1);
  assert.equal(faktZeilen(v), 9);
  assert.equal(uebernahmen(v).filter((a) => a.id === "f03").length, 1, "nur die gewünschte wurde nachgetragen");
  const rest = Zr.nimmZurueck(v, { lauf: r1.lauf, jetzt: JETZT + 2 * STUNDE });
  assert.equal(rest.ok, true, JSON.stringify(rest));
  assert.equal(rest.zurueck, 9, "der Rest des Laufs");
  assert.equal(faktZeilen(v), 0);
  assert.equal(uebernahmen(v).length, 10);
});

test("idempotent: nach der Heilung rekonstruiert ein weiterer Lauf nichts mehr (keine neuen Zeilen, keine Meldung); ein gesunder Lauf heilt nie", async () => {
  const { v } = await doppelausfall();
  await lauf(v, { jetzt: JETZT + STUNDE });
  const vorher = rohZeilen(v).filter((z) => JSON.parse(z).stufe === "uebernehmen").length;
  const r3 = await lauf(v, { jetzt: JETZT + 2 * STUNDE });
  assert.equal(rohZeilen(v).filter((z) => JSON.parse(z).stufe === "uebernehmen").length, vorher, "keine doppelten Aktionen");
  assert.doesNotMatch(letzterBericht(v, r3), /Protokoll geheilt/);
  const gesund = torVault();
  mitKi();
  const rg = await lauf(gesund);
  assert.equal(rg.status, "ok", JSON.stringify(rg));
  assert.ok(!P.leseAktionen(gesund).some((a) => a.rekonstruiert || a.stufe === "heilung"), "ein gesunder Lauf rekonstruiert nichts");
  assert.doesNotMatch(letzterBericht(gesund, rg), /Protokoll geheilt/);
});

test("kaputtes Protokoll beim Lauf-Start: keine Heilung (nichts zu schreiben), der Lauf bleibt fail-closed; nach der Heilung des Ordners holt der nächste Lauf alles nach", async () => {
  const { v } = await doppelausfall();
  alsOrdner(aktionenDatei(v));
  const r2 = await lauf(v, { jetzt: JETZT + STUNDE });
  assert.equal(r2.status, "teilweise");
  assert.equal(r2.zahlen.uebernommen, 0, "nichts Neues bei kaputtem Protokoll");
  wiederHeil(aktionenDatei(v));
  const r3 = await lauf(v, { jetzt: JETZT + 2 * STUNDE });
  assert.equal(r3.status, "ok", JSON.stringify(r3));
  assert.equal(uebernahmen(v).length, 10);
  assert.equal(r3.zahlen.uebernommen, 0, "und das Tor ist zu");
});

// ------------------------------------------------------------------------------------------------ heileProtokoll direkt: Arten, Fenster, Sonderfälle
function ohneProtokoll(v, n, auftraege, { jetzt = JETZT + n * 60e3 } = {}) {      // wie ein Lauf, dessen Protokoll nie ankam: Commits ja, Aktionen nein
  const ctx = P.neuerLauf(v, { claudeBefehl: null, jetzt });
  const kopie = Z.W.legeArbeitskopieAn(v, ctx.lauf);
  const ok = auftraege.map((a) => ({ a, r: Z.W.commitAuftrag(v, kopie, a, { lauf: ctx.lauf, jetzt: ctx.jetzt }) }));
  assert.ok(ok.every((x) => x.r.ok), JSON.stringify(ok.map((x) => x.r)));
  assert.ok(Z.W.uebernehmen(v, kopie).ok);
  Z.W.verwerfeArbeitskopie(v, kopie);
  return { lauf: ctx.lauf, hashes: Z.W.commitsDesLaufs(v, ctx.lauf, ok.length), jetzt: ctx.jetzt };
}

test("heileProtokoll: Fakt, Stand und Feld werden mit Art, Seite, Beleg, Titel, Zitat, Herkunft und Fundstelle aus dem Commit rekonstruiert; Fakt/Stand zählen als Einschwing-Übernahme, Feld nicht", () => {
  const v = Z.vault(Z.MIT_STAND, {}, "gruen");
  const a = ohneProtokoll(v, 1, [Z.fakt(v, "f1", "Backups laufen nachts.")]);
  const b = ohneProtokoll(v, 2, [Z.stand("s1", "Erledigt: neu\nzweite Zeile")(v)]);
  const c = ohneProtokoll(v, 3, [Z.feld("z1", "2026-10-22: stimmt etwas nicht")()]);
  const r = H.heileProtokoll(v, { jetzt: JETZT + 10 * 60e3 });
  assert.equal(r.fehler, null);
  assert.equal(r.rekonstruiert.length, 3);
  const nachId = (id) => P.leseAktionen(v).find((x) => x.id === id);
  const f1 = nachId("f1"), s1 = nachId("s1"), z1 = nachId("z1");
  assert.deepEqual([f1.stufe, f1.lauf, f1.commit, f1.ziel, f1.auto, f1.einschwingen, f1.rekonstruiert], ["uebernehmen", a.lauf, a.hashes.get("f1"), Z.SEITE, true, true, true]);
  assert.deepEqual([f1.beleg, f1.titel, f1.zitat, f1.herkunft, f1.fundstelle], [`${Z.link("f1")}.md`, "Titel f1", "Backups laufen nachts.", "du", "s1#u-f1 2026-10-20T10:00:00Z"]);
  assert.equal(f1.zeit, "2026-10-22T03:01:00.000Z", "Zeit = Zeit des Laufs (aus der Lauf-Nummer)");
  assert.deepEqual([s1.stufe, s1.lauf, s1.commit, s1.auto, s1.einschwingen], ["stand", b.lauf, b.hashes.get("s1"), true, true]);
  assert.deepEqual([z1.stufe, z1.lauf, z1.commit, z1.ziel, z1.feld, z1.titel], ["feld", c.lauf, c.hashes.get("z1"), Z.SEITE, "zweifel", "Zweifel"]);
  assert.equal(z1.beleg, undefined);
  assert.notEqual(z1.einschwingen, true, "ein Feld ist keine Übernahme des Tors");
  assert.notEqual(z1.auto, true);
  // … und `zurueck` nimmt jede davon sauber zurück (die rekonstruierte Aktion trägt, was es braucht)
  for (const id of ["z1", "s1", "f1"]) assert.equal(Zr.nimmZurueck(v, { ids: [id], jetzt: JETZT + 20 * 60e3 }).ok, true, id);
  assert.equal(Z.seite(v).includes(Z.link("f1")), false);
});

test("heileProtokoll: ein Commit mit passender Aktion (gleicher Hash, oder gleiche lauf/id) wird nie doppelt rekonstruiert; fehlt nur der Hash, kommt er als Nachtrag dazu", () => {
  const v = Z.vault(Z.MIT_FAKTEN, {}, "gruen");
  const a = ohneProtokoll(v, 1, [Z.fakt(v, "f1", "Eins.")]);
  const b = ohneProtokoll(v, 2, [Z.fakt(v, "f2", "Zwei.")]);
  const ctx = P.neuerLauf(v, { claudeBefehl: null, jetzt: JETZT });
  P.notiere(ctx, { lauf: a.lauf, zeit: "2026-10-22T03:01:00.000Z", id: "f1", stufe: "uebernehmen", ziel: Z.SEITE, commit: a.hashes.get("f1"), auto: true });    // vollständig vorhanden
  P.notiere(ctx, { lauf: b.lauf, zeit: "2026-10-22T03:02:00.000Z", id: "f2", stufe: "uebernehmen", ziel: Z.SEITE, commit: null, auto: true });            // Hash fehlt
  P.schreibeAktionen(ctx);
  const r = H.heileProtokoll(v, { jetzt: JETZT + 10 * 60e3 });
  assert.equal(r.rekonstruiert.length, 0, "beide Aktionen sind schon da");
  assert.deepEqual(r.nachgetragen.map((x) => [x.id, x.commit]), [["f2", b.hashes.get("f2")]]);
  assert.equal(P.leseAktionen(v).length, 2, "keine neue Aktion");
  assert.equal(P.leseAktionen(v).find((x) => x.id === "f2").commit, b.hashes.get("f2"), "der Hash ist jetzt dran");
  const zeilen = rohZeilen(v).length;
  const r2 = H.heileProtokoll(v, { jetzt: JETZT + 10 * 60e3 });
  assert.deepEqual([r2.rekonstruiert.length, r2.nachgetragen.length], [0, 0], "zweiter Aufruf: nichts mehr");
  assert.equal(rohZeilen(v).length, zeilen);
});

test("heileProtokoll: Commits älter als 30 Tage (nach der Lauf-Nummer) werden im Lauf-Start nicht angefasst — gezielt (brain zurueck <lauf>) schon; schon zurückgenommene nie", () => {
  const v = Z.vault(Z.MIT_FAKTEN, {}, "gruen");
  const alt = ohneProtokoll(v, 1, [Z.fakt(v, "alt1", "Alt.")], { jetzt: JETZT - 100 * TAG });
  const jung = ohneProtokoll(v, 2, [Z.fakt(v, "jung1", "Jung.")], { jetzt: JETZT - 2 * TAG });
  const r = H.heileProtokoll(v, { jetzt: JETZT });
  assert.deepEqual(r.rekonstruiert.map((x) => x.id), ["jung1"], "nur das Fenster");
  const gezielt = H.heileProtokoll(v, { lauf: alt.lauf, jetzt: JETZT });
  assert.deepEqual(gezielt.rekonstruiert.map((x) => x.id), ["alt1"], "gezielt für eine benannte Lauf-Nummer ohne Altersgrenze");
  const z = Zr.nimmZurueck(v, { ids: ["jung1"], jetzt: JETZT });
  assert.equal(z.ok, true);
  const zeilen = rohZeilen(v).filter((l) => JSON.parse(l).id !== "jung1" || JSON.parse(l).stufe === "zurueck");   // die Übernahme-Aktion fehlt wieder, die Rücknahme steht
  writeFileSync(aktionenDatei(v), `${zeilen.join("\n")}\n`);
  assert.deepEqual(H.heileProtokoll(v, { jetzt: JETZT }).rekonstruiert.map((x) => x.id), [], "ein schon zurückgenommener Commit wird nicht wiederbelebt");
  assert.ok(jung.hashes.get("jung1"));
});

test("heileProtokoll: ein von Hand so betitelter Commit (anderer Autor als der Tageslauf) wird nie als Übernahme rekonstruiert", () => {
  const v = Z.vault(Z.MIT_FAKTEN, {}, "gruen");
  ohneProtokoll(v, 1, [Z.fakt(v, "f1", "Eins.")]);
  writeFileSync(join(v, "10_projekte", "notiz.md"), "# Notiz\n");
  git(v, "add", "--", "10_projekte/notiz.md");
  execFileSync("git", ["-C", v, "-c", "user.name=Handarbeit", "-c", "user.email=hand@example.com", "commit", "-q", "-m", "auto(20261022-030500): Handarbeit → notiz.md [h9]"], { stdio: "ignore" });
  const r = H.heileProtokoll(v, { jetzt: JETZT + 10 * 60e3 });
  assert.deepEqual(r.rekonstruiert.map((x) => x.id), ["f1"], "nur der Commit des Tageslaufs");
  assert.deepEqual(r.unklar, []);
});

test("heileProtokoll: unlesbares Protokoll (Ordner statt Datei, keine Leserechte) → Fehler, nichts geschrieben — nie Doppeltes aus einem „leer“ gelesenen Protokoll; fehlende Datei ist leer", (t) => {
  const v = Z.vault(Z.MIT_FAKTEN, {}, "gruen");
  ohneProtokoll(v, 1, [Z.fakt(v, "f1", "Eins.")]);
  alsOrdner(aktionenDatei(v));
  const r = H.heileProtokoll(v, { jetzt: JETZT + 10 * 60e3 });
  assert.ok(r.fehler, "Fehler gemeldet");
  assert.deepEqual(r.rekonstruiert, []);
  wiederHeil(aktionenDatei(v));
  if (typeof process.getuid === "function" && process.getuid() !== 0) {
    mkdirSync(P.TL_DIR(v), { recursive: true });
    writeFileSync(aktionenDatei(v), "");
    chmodSync(aktionenDatei(v), 0o200);                                                    // nur schreibbar: ein Lesen scheitert, ein Anhängen ginge
    try {
      const r2 = H.heileProtokoll(v, { jetzt: JETZT + 10 * 60e3 });
      assert.ok(r2.fehler);
      assert.equal(statSync(aktionenDatei(v)).size, 0, "nichts angehängt");
    } finally { chmodSync(aktionenDatei(v), 0o644); }
  } else t.diagnostic("als root: Leserechte-Fall übersprungen");
  const r3 = H.heileProtokoll(v, { jetzt: JETZT + 10 * 60e3 });                            // Datei fehlt/ist leer
  assert.equal(r3.fehler, null);
  assert.equal(r3.rekonstruiert.length, 1);
});

test("Probemodus heilt nicht: weder Aktionen noch Meldung; ein Commit ohne Aktion bleibt bis zum nächsten scharfen Lauf unberührt", async () => {
  const { v } = await doppelausfall();
  const r = await lauf(v, { jetzt: JETZT + STUNDE, probe: true });
  assert.equal(r.modus, "probe");
  assert.deepEqual(uebernahmen(v), []);
  assert.doesNotMatch(letzterBericht(v, r), /Protokoll geheilt/);
});
