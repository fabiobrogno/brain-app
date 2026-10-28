// .tools/tests/test-tageslauf-urteil.mjs — B2.1 „Urteil“: der Tageslauf mit festen Regeln (R1/R2 früh), Richter (Sonnet) und R3/R4 als Rückfrage.
// Ablauf eines Vorschlags (verbindlich): Themen-Ausschluss → R1/R2 ⚪ aussortieren → Einordnen (+Seitenwahl) → Abgleich (Haiku) → stufe() →
// bei 🟢 der RICHTER; nur sein „übernehmen“ erlaubt eine Übernahme (Fehler/kaputte Antwort/Budget leer → ⏸ warten, nie übernehmen) →
// R3 (Seite nach dem Zitat geändert) oder R4 (Seite aus der Seitenwahl) → 🟡 Rückfrage statt Automatik → sonst Einschwing-Tor → Schreiben.
// Die vier Fehlübernahmen des Probelaufs sind hier als neutrale Nachbauten (Orion, Teich) nachgestellt. fake-claude, Temp-Vaults, nie echtes claude.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { isoliere, neuerTestVault, legeVorschlagAn, seitenText, fakeKi, schnappschuss, committeAm, FAKE_BEFEHL, JETZT, RICHTER_KENNUNG } from "./tageslauf-hilfe.mjs";
import { nutzer, tempOrdner } from "./verlauf-fixture.mjs";
const T = await import("../tageslauf.mjs");
const B = await import("../tageslauf/bestand.mjs");
const P = await import("../tageslauf/protokoll.mjs");
const R = await import("../rueckfragen.mjs");
isoliere();

const ORION = "09_wiki/projekte/entitaet_orion.md";
const ZITAT_ZEIT = "2026-10-20T10:00:00Z";
const fund = (id) => `s1#u-${id} ${ZITAT_ZEIT}`;
const fakt = (v, id, titel, text, zitat, extra = {}) => legeVorschlagAn(v, { id, titel, text, zitat, herkunft: "du", fundstelle: fund(id), ...extra });
const orionSeite = (zeilen = []) => seitenText({ fm: { name: "orion", description: "Orion Testsystem" },
  rumpf: `# Orion\n\nOrion ist das Testsystem.\n\n## Fakten\n\n- Orion läuft auf Port 3309 · Stand 01.10.2026 · [[x]]\n${zeilen.map((z) => `${z}\n`).join("")}` });
function bau({ seiten = {}, automatik = { tageslauf: "an", einschwingen: 0 }, orion = orionSeite() } = {}) {
  const v = neuerTestVault({ automatik, seiten: { [ORION]: orion, ...seiten } });
  mkdirSync(join(v, ".logs"), { recursive: true });
  writeFileSync(join(v, ".logs", "aliasse.json"), JSON.stringify({ orion: ORION }));
  return v;
}
const NEU = (o = {}) => JSON.stringify({ urteil: "neu", zitatStuetzt: true, passtZurSeite: true, dauerhaft: true, ...o });
const abgl = (titel, antwort = NEU()) => ({ wenn: ["Du vergleichst", `FAKT: ${titel}.`], antwort });
const OK = { gedeckt: true, dauerhaft: true, seitePasst: true, schonDrin: false, widerspricht: false, ueberholt: false, begruendung: "Alles stimmt." };
// Eine Richter-Regel: gilt, wenn `marker` irgendwo in der Eingabe steht (Titel des Vorschlags, Nachricht des Verlaufs, Zeile der Seite).
const richter = (marker, o = {}) => ({ wenn: [RICHTER_KENNUNG, marker], antwort: typeof o === "string" ? o : JSON.stringify({ ...OK, ...o }) });
const lauf = (v, opt = {}) => T.tageslauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT, ...opt });
const sonnet = (ki) => ki.aufrufe().filter((a) => a.modell === "sonnet");
const haiku = (ki) => ki.aufrufe().filter((a) => a.modell === "haiku");
const aktion = (v, id) => P.leseAktionen(v).find((a) => a.id === id);
const archiv = (v, grund, id) => join(v, "90_archiv", "vorschlaege-aussortiert", grund, `${id}.md`);
const warteGrund = (v, id) => B.ladeVorschlag(v, "_warten", id)?.wartenGrund;
const inInbox = (v, id) => existsSync(join(v, "00_inbox", "_vorschlaege", `${id}.md`));
const bericht = (v, r) => readFileSync(join(v, r.bericht), "utf8");
const rueckfragen = (v) => R.listeRueckfragen(v).filter((x) => x.typ !== "stichprobe");
const lies = (v, rel) => readFileSync(join(v, rel), "utf8");
function spaeter(v, sid, uuid, text, zeit) {
  appendFileSync(join(v, ".logs", "transkript-sicherung", `${sid}.jsonl`), `${JSON.stringify({ ...nutzer(text, { zeit }), uuid })}\n`);
}

// ------------------------------------------------------------------------------------------ die vier Fälle des Probelaufs (neutral nachgebaut)

test("Fall (a) Wunsch statt Fakt: „soll auch rein“ wird früh ⚪ aussortiert (R1) — keine KI, kein Richter, nichts auf der Seite", async () => {
  const v = bau();
  fakt(v, "w1", "Orion Statusanzeige", "Die Statusanzeige von Orion soll auch in die Meldungen aufgenommen werden.", "die statusanzeige von orion soll auch rein");
  const ki = fakeKi([]);
  const vorher = lies(v, ORION);
  const r = await lauf(v);
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.equal(ki.anzahl(), 0, "weder Abgleich noch Richter");
  assert.ok(existsSync(archiv(v, "wunsch-statt-fakt", "w1")));
  const a = aktion(v, "w1");
  assert.deepEqual([a.stufe, a.grund], ["aussortieren", "wunsch-statt-fakt"]);
  assert.equal(a.richter, undefined);
  assert.equal(lies(v, ORION), vorher);
});

test("Fall (d) Prozentzahl ohne Zeitraum und Messgröße: früh ⚪ aussortiert (R2) — keine KI, kein Richter", async () => {
  const v = bau();
  fakt(v, "z1", "Orion Modellanteil", "Im Auswertungszeitraum liefen 58 % der Läufe von Orion auf dem großen Modell.", "58 % der Läufe von Orion liefen auf dem großen Modell");
  const ki = fakeKi([]);
  const r = await lauf(v);
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.equal(ki.anzahl(), 0);
  assert.ok(existsSync(archiv(v, "zahl-ohne-bezug", "z1")));
  assert.deepEqual([aktion(v, "z1").stufe, aktion(v, "z1").grund], ["aussortieren", "zahl-ohne-bezug"]);
});

test("Fall (c) im späteren Verlauf überholt: der Richter sieht die spätere Nachricht und sagt ueberholt → ⚪ aussortiert, nichts geschrieben", async () => {
  const v = bau();
  fakt(v, "u1", "Orion Sicherung", "Die Sicherung von Orion läuft über den alten Dienst.", "Orion sichert noch über den alten Dienst");
  spaeter(v, "s1", "u-spaeter", "UEBERHOLT-MARKE Wir haben die Sicherung von Orion auf den neuen Dienst umgestellt.", "2026-10-20T11:00:00Z");
  const ki = fakeKi([abgl("Orion Sicherung"), richter("UEBERHOLT-MARKE", { ueberholt: true, begruendung: "Im weiteren Verlauf umgestellt." })]);
  const vorher = lies(v, ORION);
  const r = await lauf(v);
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.equal(haiku(ki).length, 1, "ein Abgleich");
  assert.equal(sonnet(ki).length, 1, "ein Richter-Aufruf");
  assert.match(sonnet(ki)[0].eingabe, /UEBERHOLT-MARKE/, "das Fenster trägt den späteren Verlauf");
  assert.ok(existsSync(archiv(v, "ueberholt", "u1")));
  const a = aktion(v, "u1");
  assert.deepEqual([a.stufe, a.grund], ["aussortieren", "ueberholt"]);
  assert.equal(a.richter.urteil, "aussortieren");
  assert.equal(a.richter.felder.ueberholt, true);
  assert.equal(a.richter.begruendung, "Im weiteren Verlauf umgestellt.");
  assert.equal(r.zahlen.uebernommen, 0);
  assert.equal(lies(v, ORION), vorher);
});

test("Fall (b) steht schon auf der Seite (als erledigt): der Richter sagt schonDrin → ⚪ schon-drin", async () => {
  const v = bau({ orion: orionSeite(["- Orion zeigt den Lagebericht in den Meldungen (erledigt) SCHON-DA-MARKE · Stand 01.10.2026 · [[x]]"]) });
  fakt(v, "d1", "Orion Lagebericht", "Der Lagebericht von Orion erscheint in den Meldungen.", "Orion zeigt den Lagebericht in den Meldungen");
  const ki = fakeKi([abgl("Orion Lagebericht"), richter("SCHON-DA-MARKE", { schonDrin: true, begruendung: "Steht als erledigt auf der Seite." })]);
  const vorher = lies(v, ORION);
  const r = await lauf(v);
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.equal(sonnet(ki).length, 1);
  assert.match(sonnet(ki)[0].eingabe, /SCHON-DA-MARKE/, "der Richter sieht die ganze Zielseite");
  assert.ok(existsSync(archiv(v, "schon-drin", "d1")));
  assert.equal(aktion(v, "d1").richter.felder.schonDrin, true);
  assert.equal(lies(v, ORION), vorher);
});

// ------------------------------------------------------------------------------------------ R3 / R4 nach dem Richter

test("Richter ok + Zielseite seit dem Zitat geändert (R3) → 🟡 Rückfrage seite-seither-geaendert statt Automatik; die Antwort „übernehmen“ geht NICHT durch den Richter", async () => {
  const v = bau();
  fakt(v, "g1", "Orion Backups", "Orion sichert die Daten über den Dienst Alpha.", "Orion sichert jetzt über den Dienst Alpha");
  committeAm(v, ORION, orionSeite(["- Orion hat noch eine Zeile von Hand · Stand 01.10.2026 · [[x]]"]), "2026-10-21T08:00:00Z", "Handänderung nach dem Zitat");
  const ki = fakeKi([abgl("Orion Backups")]);
  const r = await lauf(v);
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.equal(sonnet(ki).length, 1, "der Richter hat entschieden");
  assert.equal(r.zahlen.uebernommen, 0);
  assert.doesNotMatch(lies(v, ORION), /Dienst Alpha/);
  const rf = rueckfragen(v);
  assert.deepEqual(rf.map((x) => [x.typ, x.seite, x.grund]), [["heikel", ORION, "seite-seither-geaendert"]]);
  assert.match(rf[0].beschreibung, /Fakt: Orion sichert die Daten über den Dienst Alpha\./);
  assert.match(rf[0].beschreibung, /Warum ich frage: .*nach dem Zitat geändert/);
  const a = aktion(v, "g1");
  assert.deepEqual([a.stufe, a.grund], ["rueckfrage", "seite-seither-geaendert"]);
  assert.equal(a.richter.urteil, "uebernehmen", "das Richter-Urteil steht im Protokoll");
  // Der Mensch entscheidet: „übernehmen“ → Übernahme ohne weiteren Richter-Aufruf.
  R.beantworte(v, rf[0].id, "uebernehmen", "");
  const r2 = await lauf(v, { jetzt: JETZT + 3600e3 });
  assert.equal(r2.zahlen.uebernommen, 1, JSON.stringify(r2.zahlen));
  assert.match(lies(v, ORION), /Dienst Alpha/);
  const ue = P.leseAktionen(v).find((x) => x.id === "g1" && x.stufe === "uebernehmen");
  assert.equal(ue.auto, false, "nach deiner Antwort, nicht automatisch");
  assert.equal(sonnet(ki).length, 1, "kein zweiter Richter-Aufruf für die Antwort des Menschen");
});

test("Zeitpunkte: eine Änderung der Seite VOR dem Zitat und Commits des Tageslaufs selbst lösen R3 nicht aus → Richter ok = Übernahme", async () => {
  const v = bau();
  committeAm(v, ORION, orionSeite(["- Vorher von Hand · Stand 01.10.2026 · [[x]]"]), "2026-10-19T08:00:00Z", "Handänderung vor dem Zitat");
  fakt(v, "g1", "Orion Backups", "Orion sichert die Daten über den Dienst Alpha.", "Orion sichert jetzt über den Dienst Alpha");
  fakeKi([abgl("Orion Backups"), abgl("Orion Berichte")]);
  const r = await lauf(v);
  assert.equal(r.zahlen.uebernommen, 1, JSON.stringify(r.zahlen));
  assert.equal(rueckfragen(v).length, 0);
  // Zweiter Fakt später: der Tageslauf hat die Seite NACH dem Zitat geändert (eigener Autor) — das zählt nicht.
  fakt(v, "g2", "Orion Berichte", "Die Berichte von Orion gehen an das Team Beta.", "Orion schickt die Berichte jetzt an das Team Beta");
  const r2 = await lauf(v, { jetzt: JETZT + 3600e3 });
  assert.equal(r2.zahlen.uebernommen, 1, JSON.stringify(r2.zahlen));
  assert.equal(rueckfragen(v).length, 0, "keine R3-Rückfrage wegen der eigenen Übernahme");
  assert.match(lies(v, ORION), /Team Beta/);
});

const SA = "09_wiki/wissen/thema_teich-a.md", SB = "09_wiki/wissen/thema_teich-b.md";
const BESCHR = "Gartenteich Pumpe Filter Skimmer Schlamm Teichpflege";
const teichSeiten = () => ({
  [SA]: seitenText({ fm: { name: "teich-a", description: BESCHR }, rumpf: "# Teich A\n\n## Fakten\n\n- Alt A · Stand 01.10.2026 · [[x]]\n" }),
  [SB]: seitenText({ fm: { name: "teich-b", description: BESCHR }, rumpf: "# Teich B\n\n## Fakten\n\n- Alt B · Stand 01.10.2026 · [[x]]\n" }),
  ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`09_wiki/wissen/thema_fuell-${i}.md`, seitenText({ fm: { name: `fuell-${i}`, description: `Füllseite ${i} über Wetter Kalender Notizen ${i}` }, rumpf: "# F\n" })])),
});
const TEXT = (was) => `Der Gartenteich braucht Pumpe, Filter, Skimmer und Schlamm, ${was}.`;
const wahl = (titel, seite) => ({ wenn: ["Du wählst", `FAKT: "${titel}.`], antwort: JSON.stringify({ seite }) });
const baueTeich = (opt = {}) => neuerTestVault({ automatik: { tageslauf: "an", einschwingen: 0 }, seiten: teichSeiten(), ...opt });

test("Richter ok + Seite aus der Seitenwahl (R4) → 🟡 Rückfrage seitenwahl statt Automatik; die Kandidaten stehen in der Frage; Antwort „übernehmen“ schreibt auf die gewählte Seite ohne Richter", async () => {
  const v = baueTeich();
  fakt(v, "t1", "Teich Eins", TEXT("die Pumpe läuft nachts leiser"), "Der Gartenteich braucht Pumpe, Filter, Skimmer und Schlamm, die Pumpe läuft nachts leiser");
  const ki = fakeKi([wahl("Teich Eins", SA), abgl("Teich Eins")]);
  const r = await lauf(v);
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.deepEqual([haiku(ki).length, sonnet(ki).length], [2, 1], "Wahl + Abgleich (Haiku), dann der Richter");
  assert.equal(r.zahlen.uebernommen, 0);
  for (const s of [SA, SB]) assert.doesNotMatch(lies(v, s), /nachts leiser/);
  const rf = rueckfragen(v);
  assert.deepEqual(rf.map((x) => [x.typ, x.seite, x.grund]), [["heikel", SA, "seitenwahl"]]);
  assert.match(rf[0].beschreibung, /Warum ich frage: .*(Seitenwahl|mehreren Seiten)/);
  assert.match(rf[0].beschreibung, /thema_teich-b/, "die Alternative steht in der Frage");
  const a = aktion(v, "t1");
  assert.deepEqual([a.stufe, a.grund, a.wie, a.gewaehlt], ["rueckfrage", "seitenwahl", "wahl", SA]);
  assert.equal(a.richter.urteil, "uebernehmen");
  R.beantworte(v, rf[0].id, "uebernehmen", "");
  const r2 = await lauf(v, { jetzt: JETZT + 3600e3 });
  assert.equal(r2.zahlen.uebernommen, 1, JSON.stringify(r2.zahlen));
  assert.match(lies(v, SA), /die Pumpe läuft nachts leiser/);
  assert.equal(sonnet(ki).length, 1, "kein zweiter Richter-Aufruf");
});

test("R3 und R4 zugleich: der Grund ist seite-seither-geaendert, die Frage nennt auch die Seitenwahl samt Alternative; der Bericht zählt R3", async () => {
  const v = baueTeich();
  fakt(v, "t1", "Teich Eins", TEXT("die Pumpe läuft nachts leiser"), "Der Gartenteich braucht Pumpe, Filter, Skimmer und Schlamm, die Pumpe läuft nachts leiser");
  committeAm(v, SA, seitenText({ fm: { name: "teich-a", description: BESCHR }, rumpf: "# Teich A\n\n## Fakten\n\n- Alt A · Stand 01.10.2026 · [[x]]\n- von Hand · Stand 01.10.2026 · [[x]]\n" }), "2026-10-21T08:00:00Z", "Handänderung nach dem Zitat");
  fakeKi([wahl("Teich Eins", SA), abgl("Teich Eins")]);
  const r = await lauf(v);
  assert.equal(r.status, "ok", JSON.stringify(r));
  const rf = rueckfragen(v);
  assert.deepEqual(rf.map((x) => [x.typ, x.seite, x.grund]), [["heikel", SA, "seite-seither-geaendert"]]);
  assert.match(rf[0].beschreibung, /nach dem Zitat geändert/);
  assert.match(rf[0].beschreibung, /Seitenwahl/);
  assert.match(rf[0].beschreibung, /thema_teich-b/);
  assert.match(bericht(v, r), /- R3\/R4 → Rückfrage: 1 \(seite-seither-geaendert 1 · seitenwahl 0\)/);
});

test("Richter ok, nichts trifft zu → Übernahme (Einschwing-Tor als letzte Stufe: nur so viele Plätze, wie frei sind; der Rest wartet mit Grund einschwingen)", async () => {
  const v = bau({ automatik: { tageslauf: "an", einschwingen: 1 } });
  fakt(v, "f1", "Orion Backups", "Orion sichert die Daten über den Dienst Alpha.", "Orion sichert jetzt über den Dienst Alpha");
  fakt(v, "f2", "Orion Berichte", "Die Berichte von Orion gehen an das Team Beta.", "Orion schickt die Berichte jetzt an das Team Beta");
  const ki = fakeKi([abgl("Orion Backups"), abgl("Orion Berichte")]);
  const r = await lauf(v);
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.equal(sonnet(ki).length, 2, "beide kamen durch den Richter, bevor das Tor entschied");
  assert.equal(r.zahlen.uebernommen, 1);
  const uebernommen = P.leseAktionen(v).filter((a) => a.stufe === "uebernehmen");
  assert.equal(uebernommen.length, 1);
  assert.equal(uebernommen[0].einschwingen, true, "ein Platz des Tors");
  assert.equal(uebernommen[0].auto, true);
  assert.deepEqual([uebernommen[0].richter.urteil, uebernommen[0].richter.grund], ["uebernehmen", "richter-ok"]);
  const wartend = ["f1", "f2"].filter((id) => warteGrund(v, id) === "einschwingen");
  assert.equal(wartend.length, 1, "der andere wartet auf einen freien Platz");
  assert.equal(rueckfragen(v).length, 0);
  assert.match(bericht(v, r), /Richter: 2 geprüft[^\n]*richter-ok: 2/);
});

test("R3/R4 verbrauchen keinen Platz des Einschwing-Tors: die Rückfrage kommt vor dem Tor, der saubere Fall danach bekommt den einzigen Platz", async () => {
  const v = baueTeich({ automatik: { tageslauf: "an", einschwingen: 1 }, seiten: { ...teichSeiten(), [ORION]: orionSeite() } });
  mkdirSync(join(v, ".logs"), { recursive: true });
  writeFileSync(join(v, ".logs", "aliasse.json"), JSON.stringify({ orion: ORION }));
  fakt(v, "a1", "Teich Eins", TEXT("die Pumpe läuft nachts leiser"), "Der Gartenteich braucht Pumpe, Filter, Skimmer und Schlamm, die Pumpe läuft nachts leiser");   // Seitenwahl → R4, wird zuerst geprüft
  fakt(v, "b1", "Orion Backups", "Orion sichert die Daten über den Dienst Alpha.", "Orion sichert jetzt über den Dienst Alpha");
  fakeKi([wahl("Teich Eins", SA), abgl("Teich Eins"), abgl("Orion Backups")]);
  const r = await lauf(v);
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.deepEqual(rueckfragen(v).map((x) => [x.grund, x.seite]), [["seitenwahl", SA]]);
  const ue = P.leseAktionen(v).filter((a) => a.stufe === "uebernehmen");
  assert.deepEqual(ue.map((a) => [a.id, a.einschwingen]), [["b1", true]], "der Platz war noch frei");
  assert.equal(warteGrund(v, "b1"), undefined);
});

test("Richter ok, nichts trifft zu, Phase aus → Übernahme; die Aktion trägt das Richter-Protokoll (Felder, Begründung, Aufruf)", async () => {
  const v = bau();
  fakt(v, "g1", "Orion Backups", "Orion sichert die Daten über den Dienst Alpha.", "Orion sichert jetzt über den Dienst Alpha");
  fakeKi([abgl("Orion Backups")]);
  const r = await lauf(v);
  assert.equal(r.zahlen.uebernommen, 1, JSON.stringify(r.zahlen));
  assert.match(lies(v, ORION), /Orion sichert die Daten über den Dienst Alpha\./);
  const a = P.leseAktionen(v).find((x) => x.id === "g1" && x.stufe === "uebernehmen");
  assert.equal(a.auto, true);
  assert.deepEqual(a.richter.felder, { gedeckt: true, dauerhaft: true, seitePasst: true, schonDrin: false, widerspricht: false, ueberholt: false });
  assert.deepEqual([a.richter.urteil, a.richter.grund, a.richter.aufruf, a.richter.begruendung], ["uebernehmen", "richter-ok", true, "Standard der Testhilfe."]);
});

// ------------------------------------------------------------------------------------------ der Richter fällt aus: nie übernehmen

test("Richter kaputt (kein JSON, Feld fehlt, Feld kein Wahrheitswert) → ⏸ warten richter-unklar, nichts geschrieben, nicht gecacht (nächster Lauf fragt neu); andere Vorschläge laufen weiter", async () => {
  const v = bau();
  fakt(v, "k1", "Orion Kaputt Anfang", "Orion sichert die Daten über den Dienst Alpha.", "Orion sichert jetzt über den Dienst Alpha");
  fakt(v, "k2", "Orion Kaputt Mitte", "Die Berichte von Orion gehen an das Team Beta.", "Orion schickt die Berichte jetzt an das Team Beta");
  fakt(v, "k3", "Orion Kaputt Ende", "Orion nutzt für Anmeldungen den Dienst Gamma.", "Orion nutzt für Anmeldungen den Dienst Gamma");
  fakt(v, "ok", "Orion Gut", "Die Warteschlange von Orion liegt im Dienst Zeta.", "Die Warteschlange von Orion liegt im Dienst Zeta");
  const ki = fakeKi([abgl("Orion Kaputt Anfang"), abgl("Orion Kaputt Mitte"), abgl("Orion Kaputt Ende"), abgl("Orion Gut"),
    richter("Orion Kaputt Anfang", "Das ist kein JSON"),
    richter("Orion Kaputt Mitte", '{"gedeckt":true,"dauerhaft":true,"seitePasst":true,"schonDrin":false,"widerspricht":false}'),
    richter("Orion Kaputt Ende", '{"gedeckt":"ja","dauerhaft":true,"seitePasst":true,"schonDrin":false,"widerspricht":false,"ueberholt":false}')]);
  const r = await lauf(v);
  assert.equal(r.status, "ok", JSON.stringify(r));
  for (const id of ["k1", "k2", "k3"]) assert.equal(warteGrund(v, id), "richter-unklar", id);
  assert.equal(r.zahlen.uebernommen, 1, "nur der gute Vorschlag");
  assert.doesNotMatch(lies(v, ORION), /Dienst Alpha|Team Beta|Dienst Gamma/);
  assert.match(lies(v, ORION), /Dienst Zeta/);
  const vorher = sonnet(ki).length;
  assert.equal(vorher, 4);
  await lauf(v, { jetzt: JETZT + 3600e3 });
  assert.equal(sonnet(ki).length, vorher + 3, "die drei werden neu gefragt (kaputte Antworten werden nie gecacht)");
});

test("Richter-Budget je Lauf (klein = 5): der sechste Vorschlag wartet mit richter-budget, der nächste Lauf übernimmt ihn; auch hier nie übernehmen ohne Urteil", async () => {
  const v = bau({ automatik: { tageslauf: "an", einschwingen: 0, tageslaufBudget: "klein" } });
  const sechs = [["Alpha", "Orion sichert die Daten über den Dienst Alpha."], ["Beta", "Die Berichte von Orion gehen an das Team Beta."], ["Gamma", "Orion nutzt für Anmeldungen den Dienst Gamma."],
    ["Delta", "Das Dashboard von Orion zeigt Kennzahlen aus der Quelle Delta."], ["Epsilon", "Orion speichert Protokolle im Ordner Epsilon."], ["Zeta", "Die Warteschlange von Orion liegt im Dienst Zeta."]];
  for (const [n, text] of sechs) fakt(v, `b-${n.toLowerCase()}`, `Orion ${n}`, text, text.replace(/\.$/, ""));
  const ki = fakeKi(sechs.map(([n]) => abgl(`Orion ${n}`)));
  const r = await lauf(v);
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.equal(sonnet(ki).length, 5);
  assert.equal(r.zahlen.uebernommen, 5);
  const wartend = sechs.map(([n]) => `b-${n.toLowerCase()}`).filter((id) => warteGrund(v, id) === "richter-budget");
  assert.equal(wartend.length, 1, "genau einer wartet auf das Budget");
  assert.equal(sonnet(ki).length, 5, "über dem eigenen Zähler gibt es keinen sechsten Aufruf");
  const r2 = await lauf(v, { jetzt: JETZT + 3600e3 });
  assert.equal(r2.zahlen.uebernommen, 1, JSON.stringify(r2.zahlen));
  assert.equal(sonnet(ki).length, 6);
  assert.match(bericht(v, r), /richter-budget: 1/);
});

test("Der Richter urteilt nur über 🟢: ein Vorschlag, den schon der Abgleich nicht durchlässt (schon_drin, kurzlebig, falsche Seite, widerspricht), kostet keinen Richter-Aufruf", async () => {
  const v = bau();
  fakt(v, "a1", "Orion Dopplung", "Orion ist das Testsystem für Alpha.", "Orion ist das Testsystem für Alpha");
  fakt(v, "a2", "Orion Einmalig", "Orion wurde gestern neu gestartet.", "Orion wurde gestern neu gestartet");
  fakt(v, "a3", "Orion Fremd", "Orion nutzt für Anmeldungen den Dienst Gamma.", "Orion nutzt für Anmeldungen den Dienst Gamma");
  fakt(v, "a4", "Orion Gegenteil", "Die Berichte von Orion gehen an das Team Beta.", "Orion schickt die Berichte jetzt an das Team Beta");
  const ki = fakeKi([abgl("Orion Dopplung", NEU({ urteil: "schon_drin" })), abgl("Orion Einmalig", NEU({ dauerhaft: false })), abgl("Orion Fremd", NEU({ passtZurSeite: false })),
    abgl("Orion Gegenteil", JSON.stringify({ urteil: "widerspricht", zeile: "- Orion läuft auf Port 3309 · Stand 01.10.2026 · [[x]]", zitatStuetzt: true, passtZurSeite: true, dauerhaft: true }))]);
  const r = await lauf(v);
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.equal(haiku(ki).length, 4);
  assert.equal(sonnet(ki).length, 0, "kein Richter-Aufruf");
  assert.doesNotMatch(bericht(v, r), /- Richter:/, "keine Richter-Zeile ohne Richter");
});

// ------------------------------------------------------------------------------------------ weitere Richter-Ausgänge

test("Richter-Ausgänge: widerspricht → 🟡 Rückfrage konflikt (Widerspruch, mit der Begründung); dauerhaft false → kurzlebig; gedeckt false → beleg-passt-nicht; seitePasst false → ⏸ seite-passt-nicht", async () => {
  const v = bau();
  fakt(v, "x1", "Orion Konfliktfall", "Orion sichert die Daten über den Dienst Alpha.", "Orion sichert jetzt über den Dienst Alpha");
  fakt(v, "x2", "Orion Kurzfall", "Die Berichte von Orion gehen an das Team Beta.", "Orion schickt die Berichte jetzt an das Team Beta");
  fakt(v, "x3", "Orion Belegfall", "Orion nutzt für Anmeldungen den Dienst Gamma.", "Orion nutzt für Anmeldungen den Dienst Gamma");
  fakt(v, "x4", "Orion Seitenfall", "Orion speichert Protokolle im Ordner Epsilon.", "Orion speichert Protokolle im Ordner Epsilon");
  fakeKi([...["Konfliktfall", "Kurzfall", "Belegfall", "Seitenfall"].map((n) => abgl(`Orion ${n}`)),
    richter("Orion Konfliktfall", { widerspricht: true, begruendung: "KONFLIKT-BEGRUENDUNG die Seite sagt etwas anderes." }),
    richter("Orion Kurzfall", { dauerhaft: false }), richter("Orion Belegfall", { gedeckt: false }), richter("Orion Seitenfall", { seitePasst: false })]);
  const vorher = lies(v, ORION);
  const r = await lauf(v);
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.equal(lies(v, ORION), vorher, "nichts geschrieben");
  const rf = rueckfragen(v);
  assert.deepEqual(rf.map((x) => [x.typ, x.seite, x.grund]), [["widerspruch", ORION, "konflikt"]]);
  assert.match(rf[0].beschreibung, /KONFLIKT-BEGRUENDUNG/, "die Begründung des Richters steht in der Frage");
  assert.match(rf[0].beschreibung, /B \(neu\): Orion sichert die Daten über den Dienst Alpha\./);
  assert.ok(existsSync(archiv(v, "kurzlebig", "x2")));
  assert.ok(existsSync(archiv(v, "beleg-passt-nicht", "x3")));
  assert.equal(warteGrund(v, "x4"), "seite-passt-nicht");
  assert.equal(r.zahlen.uebernommen, 0);
});

// ------------------------------------------------------------------------------------------ Stand

test("Stand: auch ein Stand geht durch Richter und R3/R4 — der Richter sieht nur den Kernsatz; ok → Stand ersetzt, ueberholt → ⚪, Seite geändert → Rückfrage", async () => {
  const repoBasis = tempOrdner("repos");
  const seiten = {}, repos = {};
  for (const n of ["orion", "luna", "mira"]) {
    repos[n] = join(repoBasis, `${n}-repo`);
    mkdirSync(join(repos[n], ".git"), { recursive: true });
    seiten[`09_wiki/projekte/entitaet_${n}.md`] = seitenText({ fm: { name: n, description: `${n} Testsystem`, repo: `${n}-repo` }, rumpf: `# ${n}\n\n## Fakten\n\n- a · Stand 01.10.2026 · [[x]]\n` });
  }
  const v = neuerTestVault({ automatik: { tageslauf: "an", einschwingen: 0 }, seiten });
  const KERN = { o: "Orion läuft seit der Umstellung auf der neuen Plattform.", l: "Der Mond-Dienst Luna läuft jetzt in der Zone Nord.", m: "Mira gleicht die Bestände jetzt mit dem Werkzeug Sigma ab." };
  fakt(v, "st-o", "Stand Orion", `${KERN.o}\n- ZWEITE-ZEILE Nächster Schritt: Release`, "Orion läuft jetzt auf der neuen Plattform", { art: "stand", ordner: repos.orion });
  fakt(v, "st-l", "Stand Luna", KERN.l, "Luna läuft jetzt in der Zone Nord", { art: "stand", ordner: repos.luna });
  fakt(v, "st-m", "Stand Mira", KERN.m, "Mira gleicht die Bestände jetzt mit Sigma ab", { art: "stand", ordner: repos.mira });
  committeAm(v, "09_wiki/projekte/entitaet_mira.md", seitenText({ fm: { name: "mira", description: "mira Testsystem", repo: "mira-repo" }, rumpf: "# mira\n\n## Fakten\n\n- a · Stand 01.10.2026 · [[x]]\n- von Hand · Stand 01.10.2026 · [[x]]\n" }),
    "2026-10-21T08:00:00Z", "Handänderung nach dem Zitat");
  // Beim Stand zeigt der Abgleich nur den Kernsatz als FAKT.
  const ki = fakeKi([...Object.values(KERN).map((k) => ({ wenn: ["Du vergleichst", `FAKT: ${k}`], antwort: NEU() })),
    richter('"titel":"Stand Luna"', { ueberholt: true, begruendung: "Der Stand gilt nicht mehr." })]);
  const r = await lauf(v);
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.equal(sonnet(ki).length, 3, "alle drei Stände wurden beurteilt");
  const orionAufruf = sonnet(ki).find((a) => a.eingabe.includes('"titel":"Stand Orion"'));
  assert.ok(orionAufruf.eingabe.includes("Umstellung auf der neuen Plattform") && !orionAufruf.eingabe.includes("ZWEITE-ZEILE"), "nur der Kernsatz steht im Vorschlag");
  assert.match(lies(v, "09_wiki/projekte/entitaet_orion.md"), /^## Stand\n\nStand 2\d\.10\.2026 · \[\[10_projekte\/belege\/2026-10\/st-o\]\]\n\nOrion läuft seit der Umstellung/m);
  assert.doesNotMatch(lies(v, "09_wiki/projekte/entitaet_orion.md"), /ZWEITE-ZEILE/);
  assert.ok(existsSync(archiv(v, "ueberholt", "st-l")));
  assert.deepEqual(rueckfragen(v).map((x) => [x.typ, x.grund]), [["heikel", "seite-seither-geaendert"]]);
  assert.doesNotMatch(lies(v, "09_wiki/projekte/entitaet_mira.md"), /## Stand/);
  const m = aktion(v, "st-m");
  assert.deepEqual([m.stufe, m.grund, m.richter.urteil], ["rueckfrage", "seite-seither-geaendert", "uebernehmen"]);
});

// ------------------------------------------------------------------------------------------ Probe und Bericht

test("Probe: der Richter läuft (ruft die KI, Aufruf im Protokoll), geschrieben wird nichts — Vault bytegleich; probe-aktionen trägt das Richter-Protokoll", async () => {
  const v = bau();
  fakt(v, "p1", "Orion Backups", "Orion sichert die Daten über den Dienst Alpha.", "Orion sichert jetzt über den Dienst Alpha");
  fakt(v, "p2", "Orion Sicherung", "Die Sicherung von Orion läuft über den alten Dienst.", "Orion sichert noch über den alten Dienst");
  fakt(v, "p3", "Orion Wunsch", "Orion soll künftig schneller starten.", "Orion soll schneller starten");
  const ki = fakeKi([abgl("Orion Backups"), abgl("Orion Sicherung"), richter("Orion Sicherung", { ueberholt: true })]);
  const vorher = schnappschuss(v);
  const r = await lauf(v, { probe: true });
  assert.equal(r.modus, "probe");
  assert.equal(schnappschuss(v), vorher, "bytegleich");
  assert.equal(sonnet(ki).length, 2, "der Richter wurde gefragt");
  assert.ok(!existsSync(join(P.TL_DIR(v), "aktionen.jsonl")));
  const zeilen = readFileSync(join(P.TL_DIR(v), "probe-aktionen.jsonl"), "utf8").split("\n").filter(Boolean).map((z) => JSON.parse(z));
  const a1 = zeilen.find((a) => a.id === "p1"), a2 = zeilen.find((a) => a.id === "p2"), a3 = zeilen.find((a) => a.id === "p3");
  assert.deepEqual([a1.stufe, a1.richter.urteil, a1.richter.aufruf], ["uebernehmen", "uebernehmen", true]);
  assert.deepEqual([a2.stufe, a2.grund, a2.richter.grund], ["aussortieren", "ueberholt", "ueberholt"]);
  assert.deepEqual([a3.stufe, a3.grund, a3.richter], ["aussortieren", "wunsch-statt-fakt", undefined]);
  assert.deepEqual([r.zahlen.uebernommen, r.zahlen.aussortiert], [1, 2]);
});

test("Bericht: Richter-Ausgänge je Grund, „R1/R2 aussortiert“ und „R3/R4 → Rückfrage“ je Grund", async () => {
  const v = baueTeich({ seiten: { ...teichSeiten(), [ORION]: orionSeite() } });
  mkdirSync(join(v, ".logs"), { recursive: true });
  writeFileSync(join(v, ".logs", "aliasse.json"), JSON.stringify({ orion: ORION }));
  fakt(v, "r1", "Orion Statusanzeige", "Die Statusanzeige von Orion soll auch in die Meldungen aufgenommen werden.", "die statusanzeige von orion soll auch rein");
  fakt(v, "r2", "Orion Modellanteil", "Im Auswertungszeitraum liefen 58 % der Läufe von Orion auf dem großen Modell.", "58 % der Läufe von Orion liefen auf dem großen Modell");
  fakt(v, "u1", "Orion Sicherung", "Die Sicherung von Orion läuft über den alten Dienst.", "Orion sichert noch über den alten Dienst");
  fakt(v, "g3", "Orion Backups", "Orion sichert die Daten über den Dienst Alpha.", "Orion sichert jetzt über den Dienst Alpha");
  fakt(v, "t1", "Teich Eins", TEXT("die Pumpe läuft nachts leiser"), "Der Gartenteich braucht Pumpe, Filter, Skimmer und Schlamm, die Pumpe läuft nachts leiser");
  committeAm(v, ORION, orionSeite(["- von Hand · Stand 01.10.2026 · [[x]]"]), "2026-10-21T08:00:00Z", "Handänderung nach dem Zitat");
  fakeKi([abgl("Orion Sicherung"), abgl("Orion Backups"), abgl("Teich Eins"), wahl("Teich Eins", SB), richter("Orion Sicherung", { ueberholt: true })]);
  const r = await lauf(v);
  assert.equal(r.status, "ok", JSON.stringify(r));
  const b = bericht(v, r);
  const zeile = b.match(/^- Richter: .*$/m)?.[0] || "";
  assert.match(zeile, /^- Richter: 3 geprüft \(3 KI-Aufrufe, 0 aus dem Cache\)/, b);
  assert.ok(zeile.includes("ueberholt: 1") && zeile.includes("richter-ok: 2"), zeile);
  assert.match(b, /- R1\/R2 aussortiert: 2 \(wunsch-statt-fakt 1 · zahl-ohne-bezug 1\)/, b);
  assert.match(b, /- R3\/R4 → Rückfrage: 2 \(seite-seither-geaendert 1 · seitenwahl 1\)/, b);
  assert.deepEqual(rueckfragen(v).map((x) => x.grund).sort(), ["seite-seither-geaendert", "seitenwahl"]);
  assert.equal(r.zahlen.uebernommen, 0);
});
