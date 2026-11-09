// KI-Vorschläge (K1): „Mit KI zusammenfassen“ — der Sammler schickt nur Titel, Art, Zeit und Zahlen (nie Inhalte), Notizen und Aufgaben mit `ki: nein` kommen nirgends vor (nur als Zahl für die
// Anzeige), Sätze ohne gültigen Beleg (Kennung aus der gesendeten Liste) fallen weg, die Beleg-Chips baut Kortex selbst. Nie das echte `claude` (Tests/Kern/fake-claude-vorschlag.mjs).
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pfad } from "./hilfe.mjs";
import { szenarioV } from "./ki-vorschlag-hilfe.mjs";

const { beendeAlleProzesse } = await import(pfad("gemeinsam", "prozess.mjs"));
const { baueNeuigkeiten } = await import(pfad("gemeinsam", "neuigkeiten.mjs"));
after(() => { beendeAlleProzesse(); });

const SEIT = "2020-01-01T00:00:00.000Z";
const ZUSAMMEN = { funktion: "zusammenfassung", seit: SEIT };

test("Sammler: nur Titel, Art, Zeit und Zahlen; keine Inhalte, keine Pfade; `ki: nein` (Notiz und Aufgabe) kommt nirgends vor und wird nur gezählt", async () => {
  const s = szenarioV();
  // eine Aufgabe mit `ki: nein` und eine normale überfällige
  const nein = await s.api("POST", "/api/aufgaben", { titel: "AUFGABE-GEHEIM-TITEL", faellig: "2020-01-01" });
  assert.equal(nein.status, 200);
  const p = join(s.vault, nein.j.pfad);
  writeFileSync(p, readFileSync(p, "utf8").replace("typ: aufgabe\n", "typ: aufgabe\nki: nein\n"));
  const ok = await s.api("POST", "/api/aufgaben", { titel: "Steuer abgeben", faellig: "2020-01-01" });
  assert.equal(ok.status, 200);

  const { start, stand } = await s.anfrage(ZUSAMMEN);
  assert.equal(stand.ergebnis.ok, true, JSON.stringify(stand.ergebnis));
  assert.equal(stand.ergebnis.funktion, "zusammenfassung");
  const roh = s.aufrufe()[0].stdin;
  assert.equal(roh, start.gesendet, "genau das, was als „gesendet“ gezeigt wird, geht auf stdin");
  for (const verboten of ["GEHEIMER-INHALT", "Atlas Kaffeemaschine Rechnung März", "Geheim.md", "Nein.md", "Dieser Eintrag geht nie an eine KI", "AUFGABE-GEHEIM-TITEL", "10_projekte", "00_inbox", "05_aufgaben", "Projekt Atlas, Planung", "Die Rechnung vom März liegt hier"]) assert.ok(!roh.includes(verboten), `im Paket: ${verboten}`);
  const paket = JSON.parse(roh);
  assert.equal(paket.aufgabe, "zusammenfassung");
  assert.deepEqual(Object.keys(paket.daten).sort(), ["heute", "zahlen", "zeilen", "zeitraum"]);
  assert.ok(paket.daten.zeilen.length >= 3 && paket.daten.zeilen.length <= 60);
  assert.deepEqual(paket.daten.zeilen.map((z) => z.id), paket.daten.zeilen.map((_, i) => `z${i + 1}`));
  for (const z of paket.daten.zeilen) { assert.ok(["notiz-neu", "notiz-geaendert", "aufgabe-neu", "aufgabe-erledigt", "aufgabe-ueberfaellig"].includes(z.art)); assert.ok(Object.keys(z).every((k) => ["id", "art", "titel", "zeit", "faellig"].includes(k)), `Felder: ${Object.keys(z)}`); }
  const titel = paket.daten.zeilen.map((z) => z.titel);
  assert.ok(titel.includes("Atlas Idee") && titel.includes("Kaffeemaschine") && titel.includes("Steuer abgeben"), titel.join(" | "));
  assert.ok(!("ausgenommen" in paket.daten.zahlen) && !JSON.stringify(paket.daten).includes("ausgenommen"), "die Zahl der ausgenommenen Notizen geht nicht an die KI");
  // gezählt, nie mit Titel: Nein.md, Geheim.md und die Aufgabe
  assert.equal(start.ausgenommen, 3);
  assert.equal(stand.ergebnis.ausgenommen, 3);
  assert.ok(!JSON.stringify(stand.ergebnis).includes("GEHEIM"), "auch nicht im Ergebnis");
});

test("Sammler: Ergebnis — Sätze mit Beleg-Chips, die Kortex aus seinem Speicher baut (Titel, Pfad, Art); nichts im Vault geändert, kein Pfad aus der Antwort", async () => {
  const s = szenarioV();
  const vorher = s.abbild(s.vault);
  const { stand } = await s.anfrage(ZUSAMMEN);
  const e = stand.ergebnis;
  assert.equal(e.ok, true, JSON.stringify(e));
  assert.ok(e.saetze.length >= 1 && e.saetze.length <= 5);
  const pfade = new Set(["00_inbox/Atlas-Idee.md", "20_finanzen/Rechnung März.md", "10_projekte/Kaffeemaschine.md", "10_projekte/Atlas.md"]);
  for (const satz of e.saetze) {
    assert.ok(satz.belege.length >= 1 && satz.belege.length <= 4);
    for (const b of satz.belege) { assert.match(b.id, /^z\d+$/); assert.ok(pfade.has(b.pfad), b.pfad); assert.ok(b.titel && b.art); assert.deepEqual(Object.keys(b).sort(), ["art", "id", "pfad", "titel"]); }
  }
  assert.deepEqual(s.abbild(s.vault), vorher, "die KI und die Zusammenfassung ändern nichts im Vault");
});

test("Beleg-Filter: Sätze mit erfundener Kennung, Pfad statt Kennung, ohne Beleg oder mit Zusatzfeld fallen weg; der gültige bleibt", async () => {
  const s = szenarioV();
  s.szen({ szenario: "beleg-erfunden" });
  const { stand } = await s.anfrage(ZUSAMMEN);
  assert.equal(stand.ergebnis.ok, true, JSON.stringify(stand.ergebnis));
  assert.deepEqual(stand.ergebnis.saetze.map((x) => x.text), ["Gültiger Satz."]);
  assert.equal(stand.ergebnis.verworfen, 4);
});

test("Kaputte Antworten: kein JSON, falsches Schema und nur ungültige Sätze ergeben „keinen brauchbaren Vorschlag“, nie einen Satz", async () => {
  for (const szenario of ["kaputt", "schema-falsch", "zu-lang"]) {
    const s = szenarioV();
    s.szen({ szenario });
    const { stand } = await s.anfrage(ZUSAMMEN);
    assert.equal(stand.ergebnis.ok, false, szenario);
    assert.match(stand.ergebnis.fehler, /keinen brauchbaren Vorschlag/, szenario);
    assert.equal(stand.ergebnis.saetze, undefined);
  }
});

test("Zeitraum: „seit“ muss eine Zeitangabe sein; ohne etwas Neues keine Anfrage an die KI (409 nichts-neu)", async () => {
  const s = szenarioV();
  const schlecht = await s.api("POST", "/api/ki/vorschlag/start", { ...ZUSAMMEN, seit: "gestern", konto: "k_aaaaaaaa" });
  assert.equal(schlecht.status, 400);
  const zukunft = await s.api("POST", "/api/ki/vorschlag/start", { ...ZUSAMMEN, seit: new Date(Date.now() + 86400e3).toISOString(), konto: "k_aaaaaaaa" });
  assert.equal(zukunft.status, 409); assert.equal(zukunft.j.art, "nichts-neu");
  assert.deepEqual(s.aufrufe(), [], "claude wurde nie gestartet");
});

test("Einwilligung und Stufe gelten auch hier: ohne Einwilligung 409, mit „gesperrt“ kein Lauf; „gründlicher“ gibt es nicht", async () => {
  const s1 = szenarioV({ einwilligung: false });
  const a = await s1.api("POST", "/api/ki/vorschlag/start", { ...ZUSAMMEN, konto: "k_aaaaaaaa" });
  assert.equal(a.status, 409); assert.equal(a.j.art, "einwilligung");
  const s2 = szenarioV({ stufeA: "gesperrt" });
  const b = await s2.api("POST", "/api/ki/vorschlag/start", { ...ZUSAMMEN, konto: "k_aaaaaaaa" });
  assert.equal(b.status, 409);
  const s3 = szenarioV();
  const c = await s3.api("POST", "/api/ki/vorschlag/start", { ...ZUSAMMEN, modell: "mittel", konto: "k_aaaaaaaa" });
  assert.equal(c.status, 400);
  assert.deepEqual([...s1.aufrufe(), ...s2.aufrufe(), ...s3.aufrufe()], []);
});

test("Aufruf: dieselben Schutzgeländer wie bei den anderen Funktionen (die Attrappe prüft sie), Budget 0,10 $, Funktion steht in „bereit“", async () => {
  const s = szenarioV();
  const b = await s.api("GET", "/api/ki/vorschlag/bereit");
  assert.ok(b.j.funktionen.includes("zusammenfassung"));
  const { stand } = await s.anfrage(ZUSAMMEN);
  assert.equal(stand.ergebnis.ok, true);
  const a = s.aufrufe()[0];
  assert.deepEqual(a.verletzt, []);
  assert.equal(a.args[a.args.indexOf("--max-budget-usd") + 1], "0.1");
  assert.equal(a.args[a.args.indexOf("--model") + 1], "haiku");
});

test("baueNeuigkeiten mit `ausnehmen`: ausgenommene Pfade erscheinen nirgends, werden aber (je Pfad einmal) gezählt", () => {
  const jetzt = new Date("2026-11-09T12:00:00Z");
  const notizen = [
    { pfad: "a.md", titel: "A", bereich: "notiz", erstellt: "2026-11-09T10:00:00Z", geaendert: "2026-11-09T10:00:00Z" },
    { pfad: "b.md", titel: "B-GEHEIM", bereich: "notiz", erstellt: "2026-11-09T10:00:00Z", geaendert: "2026-11-09T11:00:00Z" },
    { pfad: "c.md", titel: "C-GEHEIM", bereich: "inbox", erstellt: "2020-01-01T10:00:00Z", geaendert: "2026-11-09T11:00:00Z" },
    { pfad: "d.md", titel: "D", bereich: "notiz", erstellt: "2020-01-01T10:00:00Z", geaendert: "2020-01-01T10:00:00Z" },
  ];
  const aufgaben = [{ pfad: "t.md", titel: "T-GEHEIM", status: "offen", erstellt: "2026-11-09T09:00:00Z", faellig: "2020-01-01" }];
  const r = baueNeuigkeiten({ seit: "2026-11-01T00:00:00Z", jetzt, heute: "2026-11-09", notizen, aufgaben, ausnehmen: new Set(["b.md", "c.md", "t.md"]) });
  assert.ok(!JSON.stringify(r).includes("GEHEIM"));
  assert.equal(r.notizen.neu, 1); assert.equal(r.notizen.geaendert, 0);
  assert.equal(r.aufgaben.neu, 0); assert.equal(r.aufgaben.ueberfaellig, 0);
  assert.equal(r.inbox.anzahl, 0);
  assert.equal(r.ausgenommen, 3, "b, c und t (t steht in „neu“ und „überfällig“, zählt einmal)");
  assert.equal(baueNeuigkeiten({ seit: "2026-11-01T00:00:00Z", jetzt, heute: "2026-11-09", notizen, aufgaben }).ausgenommen, undefined, "ohne `ausnehmen` bleibt alles wie vorher");
});
