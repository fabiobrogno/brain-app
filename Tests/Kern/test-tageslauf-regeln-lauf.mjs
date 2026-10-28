// .tools/tests/test-tageslauf-regeln-lauf.mjs — R1/R2 (tageslauf/regeln.mjs) im Tageslauf: ein Vorschlag mit Wunsch/Auftrag statt Fakt (wunsch-statt-fakt) oder mit
// Messzahl ohne Zeitraum (zahl-ohne-bezug) wird VOR jedem KI-Aufruf zu ihm ⚪ aussortiert (Archiv, nie gelöscht); der Rest läuft wie bisher. Stände und
// beantwortete Rückfragen sind nicht betroffen. fake-claude, Temp-Vaults, erfundene Inhalte (Orion).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isoliere, legeVorschlagAn, legeTranskriptAn, fakeKi, schnappschuss, FAKE_BEFEHL, JETZT } from "./tageslauf-hilfe.mjs";
import { SEITE, REGELN, belegt, aufbau, lauf, teil, fund } from "./lauf-hilfe.mjs";
const P = await import("../tageslauf/protokoll.mjs");
const A = await import("../tageslauf/antworten.mjs");
const B = await import("../tageslauf/bestand.mjs");
const R = await import("../rueckfragen.mjs");
isoliere();

const archiv = (v, grund, id) => join(v, "90_archiv", "vorschlaege-aussortiert", grund, `${id}.md`);
const inbox = (v, id) => [join(v, "00_inbox", "_vorschlaege", `${id}.md`), join(v, "00_inbox", "_warten", `${id}.md`)];
// Je Vorschlag eine Antwort der Fake-KI, falls er DOCH bis zur KI käme (dann fiele das in den Aufrufzahlen auf).
const NEU = '{"urteil":"neu","zitatStuetzt":true,"passtZurSeite":true,"dauerhaft":true}';

function fruehe(v) {
  belegt(v, "r1", "Orion Wunsch", "Orion soll künftig schneller starten.", "Orion soll schneller starten, wünsche ich mir");           // R1: soll
  belegt(v, "r1b", "Orion Pflege einbauen", "Die Pflege fehlt noch.", "Orion braucht noch die Pflege, bau die ein");                      // R1: Aufgabenform im Titel
  belegt(v, "r2", "Orion Auslastung", "Im Auswertungszeitraum lag die Auslastung von Orion bei 58 %.", "Orion war zu 58 % ausgelastet");   // R2: Prozent ohne Zeitraum
  belegt(v, "r2b", "Orion Bestellungen", "Orion hat 1.976 Bestellungen verarbeitet.", "Orion hat 1976 Bestellungen verarbeitet");        // R2: Menge ohne Zeitraum
  belegt(v, "o1", "Orion Auslastung Oktober", "Im Oktober 2026 lag die Auslastung von Orion bei 58 %.", "Orion war im Oktober 2026 zu 58 % ausgelastet");   // Zeitraum da → weiter
  belegt(v, "o2", "Orion Regel", "Orion muss nachts laufen.", "Orion muss nachts laufen");                                                // bloßes muss = Regel → weiter
  belegt(v, "o3", "Orion Gebühr", "Die Gebühr beträgt 15 %.", "Die Gebühr beträgt 15 %");                                                // Konfigurationswert → weiter
  legeVorschlagAn(v, { id: "st1", art: "stand", titel: "Orion Stand", text: "Orion soll bald live gehen.\n- Umfang 58 %", zitat: "Orion geht bald live", herkunft: "du", fundstelle: fund("st1") }); // Stand: nie R1/R2
}
const FRUEH_REGELN = [{ wenn: "FAKT: Orion Auslastung Oktober", antwort: NEU }, { wenn: "FAKT: Orion Regel", antwort: NEU }, { wenn: "FAKT: Orion Gebühr", antwort: NEU }, ...REGELN];

test("scharfer Lauf: R1/R2-Treffer werden vor jedem KI-Aufruf aussortiert (Archiv, nie gelöscht), Rest unverändert; Stand bleibt unberührt", async () => {
  const v = aufbau();
  fruehe(v);
  const ki = fakeKi(FRUEH_REGELN);
  const r = await lauf(v);
  assert.equal(r.status, "ok", JSON.stringify(r));
  for (const [grund, ids] of [["wunsch-statt-fakt", ["r1", "r1b"]], ["zahl-ohne-bezug", ["r2", "r2b"]]]) {
    for (const id of ids) {
      assert.ok(existsSync(archiv(v, grund, id)), `${id} liegt im Archiv unter ${grund}`);
      for (const f of inbox(v, id)) assert.ok(!existsSync(f), `${id} nicht mehr in der Inbox`);
    }
  }
  for (const id of ["o1", "o2", "o3", "st1"]) {
    assert.ok(!existsSync(archiv(v, "wunsch-statt-fakt", id)) && !existsSync(archiv(v, "zahl-ohne-bezug", id)), `${id} wurde nicht von R1/R2 aussortiert`);
  }
  const eingaben = ki.aufrufe().map((a) => a.eingabe).join("\n");
  for (const wort of ["Orion Wunsch", "Orion Pflege einbauen", "Orion Auslastung\n", "Orion Bestellungen"]) assert.ok(!eingaben.includes(wort), `an die KI ging nichts zu „${wort.trim()}“`);
  assert.ok(eingaben.includes("Orion Auslastung Oktober") && eingaben.includes("Orion Regel") && eingaben.includes("Orion Gebühr"), "die Gegenbeispiele kamen bis zum Abgleich");
  const akt = P.leseAktionen(v);
  for (const [id, muster] of [["r1", "soll"], ["r1b", "aufgabe-titel"], ["r2", "prozent"], ["r2b", "menge"]]) {
    const a = akt.find((x) => x.id === id);
    assert.equal(a.stufe, "aussortieren", id);
    assert.equal(a.grund, id.startsWith("r1") ? "wunsch-statt-fakt" : "zahl-ohne-bezug", id);
    assert.equal(a.muster, muster, id);
    assert.ok(a.verschoben.includes(a.grund), "verschoben nennt den Archivordner");
  }
  const bericht = readFileSync(join(v, r.bericht), "utf8");
  assert.match(bericht, /- wunsch-statt-fakt: 2\n/);
  assert.match(bericht, /- zahl-ohne-bezug: 2\n/);
  assert.ok(!akt.some((a) => a.id === "st1" && a.stufe === "aussortieren"), "Stand wird von R1/R2 nie aussortiert (er wartet ohne Projektseite)");
});

test("Zahlen wie bisher: dieselben Vorschläge ohne R1/R2-Fälle ergeben das alte Bild; die vier Treffer kommen nur als aussortiert dazu", async () => {
  const v = aufbau();
  const basis = teil((await lauf(v, { probe: true })).zahlen);
  const v2 = aufbau();
  fruehe(v2);
  fakeKi(FRUEH_REGELN);
  const z = teil((await lauf(v2, { probe: true })).zahlen);
  assert.equal(z.aussortiert, basis.aussortiert + 4, "genau die vier Treffer sind zusätzlich aussortiert");
});

test("Probemodus: nichts wird verschoben, das Protokoll nennt Grund und Muster", async () => {
  const v = aufbau();
  fruehe(v);
  fakeKi(FRUEH_REGELN);
  const vorher = schnappschuss(v);
  const r = await lauf(v, { probe: true });
  assert.equal(r.modus, "probe");
  assert.equal(schnappschuss(v), vorher, "Vault bytegleich");
  const zeilen = readFileSync(join(P.TL_DIR(v), "probe-aktionen.jsonl"), "utf8").split("\n").filter(Boolean).map((z) => JSON.parse(z));
  assert.equal(zeilen.filter((a) => a.grund === "wunsch-statt-fakt").length, 2);
  assert.equal(zeilen.filter((a) => a.grund === "zahl-ohne-bezug").length, 2);
});

test("Altbestand ohne Zitat: erst nach dem Beleg-Schritt greift R1 — ein gefundenes Zitat hilft einem Wunsch nicht; nur der Belege-Aufruf, kein Abgleich", async () => {
  const v = aufbau();
  legeVorschlagAn(v, { id: "n2", titel: "Orion Ausbau", text: "Orion soll künftig mehr Speicher bekommen.", sitzung: "s9" });
  legeTranskriptAn(v, "s9", [{ du: "Orion soll künftig mehr Speicher bekommen, sagt das Team." }]);
  const ki = fakeKi([{ wenn: ["--- VORSCHLÄGE ---", "## n2"], antwort: '[{"id":"n2","zitat":"Orion soll künftig mehr Speicher bekommen"}]' }, ...REGELN]);
  const r = await lauf(v);
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.ok(existsSync(archiv(v, "wunsch-statt-fakt", "n2")), "nach dem Beleg: wunsch-statt-fakt");
  assert.ok(!ki.aufrufe().some((a) => a.eingabe.includes("FAKT: \"Orion Ausbau") || a.eingabe.includes("FAKT: Orion Ausbau")), "kein Abgleich-Aufruf für ihn");
});

test("beantwortete Rückfrage „übernehmen“: R1/R2 sind keine Hürde für die ausdrückliche Entscheidung des Menschen", () => {
  const v = aufbau();
  legeVorschlagAn(v, { id: "m1", titel: "Orion Wunsch", text: "Orion soll künftig schneller starten.", zitat: "Orion soll schneller starten", herkunft: "du", fundstelle: fund("m1") });
  legeVorschlagAn(v, { id: "m2", titel: "Orion Auslastung", text: "Im Auswertungszeitraum lag die Auslastung von Orion bei 58 %.", zitat: "Orion war zu 58 % ausgelastet", herkunft: "du", fundstelle: fund("m2") });
  const frueher = P.neuerLauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT });
  const ids = ["m1", "m2"].map((id) => R.legeRueckfrageAn(frueher, { typ: "heikel", frage: "heikel?", seite: SEITE, vorschlaege: [B.ladeVorschlag(v, "_vorschlaege", id)], grund: "heikel" }));
  for (const id of ids) R.beantworte(v, id, "uebernehmen", "");
  const heute = P.neuerLauf(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT });
  const r = A.wendeAntwortenAn(heute);
  assert.deepEqual(r.auftraege.map((a) => a.v.id).sort(), ["m1", "m2"], "beide werden zum Schreibauftrag");
  assert.ok(!existsSync(archiv(v, "wunsch-statt-fakt", "m1")) && !existsSync(archiv(v, "zahl-ohne-bezug", "m2")), "nicht aussortiert");
});
