// KI-Vorschläge übernehmen (K0): nur Kennung und Token von außen; die Aktion baut die Werkstatt aus ihrem eigenen Speicher und führt sie über die vorhandenen sicheren Wege aus
// (dateiaktionen mit Journal und Rückgängig, Aufgaben-API). Ein Protokolleintrag ohne Inhalt. Nie das echte `claude`.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { pfad } from "./hilfe.mjs";
import { szenarioV, EINTRAG, EINTRAG_TEXT } from "./ki-vorschlag-hilfe.mjs";

const { beendeAlleProzesse } = await import(pfad("gemeinsam", "prozess.mjs"));
after(() => { beendeAlleProzesse(); });

async function mitVorschlaegen(s) {
  s.szen({ szenario: "anwenden" });
  const { stand } = await s.anfrage();
  assert.equal(stand.ergebnis.ok, true, JSON.stringify(stand.ergebnis));
  const [verschieben, aufgabe] = stand.ergebnis.vorschlaege;
  assert.equal(verschieben.art, "verschieben"); assert.equal(aufgabe.art, "aufgabe");
  assert.equal(verschieben.beschriftung, "Verschiebt nach „10_projekte“");
  assert.equal(aufgabe.beschriftung, "Legt die Aufgabe „Rechnung März ablegen“ an");
  return { verschieben, aufgabe };
}
const anwenden = (s, v, extra = {}) => s.api("POST", "/api/ki/vorschlag/anwenden", { id: v.id, token: v.token, ...extra });

test("Verschieben: über dateiaktionen mit Journal, ein Protokolleintrag ohne Inhalt, Rückgängig stellt die Notiz wieder her", async () => {
  const s = szenarioV();
  const { verschieben } = await mitVorschlaegen(s);
  assert.equal(s.aufrufe().length, 1);
  // Von außen zusätzlich gelieferte Pfade/Ziele/Arten ändern nichts: die Aktion kommt aus dem Speicher der Werkstatt
  const r = await anwenden(s, verschieben, { pfad: "20_finanzen/x.md", ziel: "20_finanzen", art: "loeschen" });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.art, "verschieben"); assert.equal(r.j.nach, "10_projekte/Atlas-Idee.md");
  assert.equal(existsSync(join(s.vault, EINTRAG)), false);
  assert.equal(readFileSync(join(s.vault, "10_projekte/Atlas-Idee.md"), "utf8"), EINTRAG_TEXT, "Inhalt unverändert");
  assert.equal(existsSync(join(s.vault, "20_finanzen/Atlas-Idee.md")), false);
  // Protokoll: ein Eintrag „datei-aktion“ mit Rückgängig über das Journal, ohne Inhalt der Notiz oder der KI
  const l = await s.api("GET", "/api/aktivitaet?art=datei-aktion");
  assert.equal(l.status, 200);
  const e = l.j.ereignisse.filter((x) => x.art === "datei-aktion");
  assert.equal(e.length, 1, JSON.stringify(e));
  assert.equal(e[0].rueckgaengigMoeglich, true);
  const roh = JSON.stringify(l.j);
  assert.ok(!roh.includes("Kaffeemaschine besprechen") && !roh.includes("Gehört zu den Projekten") && !roh.includes("Der Titel kommt"), "weder Inhalt noch KI-Text im Protokoll");
  // Doppelt übernehmen geht nicht
  const nochmal = await anwenden(s, verschieben);
  assert.equal(nochmal.status, 404, "nach der Übernahme ist der Vorschlag verbraucht");
  // Rückgängig
  const z = await s.api("POST", "/api/aktivitaet/rueckgaengig", { id: e[0].id });
  assert.equal(z.status, 200, JSON.stringify(z.j));
  assert.equal(readFileSync(join(s.vault, EINTRAG), "utf8"), EINTRAG_TEXT);
  assert.equal(existsSync(join(s.vault, "10_projekte/Atlas-Idee.md")), false);
});

test("Aufgabe: legt über die Aufgaben-API eine Aufgabe an (Quelle „mensch“), Protokolleintrag nennt nur den Pfad", async () => {
  const s = szenarioV();
  const { aufgabe } = await mitVorschlaegen(s);
  const r = await anwenden(s, aufgabe);
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.match(r.j.pfad, /\.md$/);
  const text = readFileSync(join(s.vault, r.j.pfad), "utf8");
  assert.match(text, /Rechnung März ablegen/);
  assert.match(text, /2026-11-30/);
  const l = await s.api("GET", "/api/aktivitaet?art=datei-aktion");
  const e = l.j.ereignisse.filter((x) => x.art === "datei-aktion");
  assert.equal(e.length, 1);
  assert.equal(e[0].text, "KI-Vorschlag übernommen: Aufgabe angelegt");
  assert.deepEqual(e[0].pfade, [r.j.pfad]);
});

test("Veraltet: ändert jemand den Eintrag nach der Anfrage, geschieht nichts (409); der Vorschlag bleibt unangewendet", async () => {
  const s = szenarioV();
  const { verschieben, aufgabe } = await mitVorschlaegen(s);
  writeFileSync(join(s.vault, EINTRAG), EINTRAG_TEXT + "\nEine Zeile mehr.\n");
  const vorher = s.abbild(s.vault);
  for (const v of [verschieben, aufgabe]) {
    const r = await anwenden(s, v);
    assert.equal(r.status, 409, JSON.stringify(r.j)); assert.equal(r.j.art, "veraltet");
    assert.match(r.j.fehler || r.j.error || JSON.stringify(r.j), /Die Notiz hat sich geändert/);
  }
  assert.deepEqual(s.abbild(s.vault), vorher, "nichts wurde geschrieben");
});

test("Der Eintrag wurde inzwischen gelöscht: 409 veraltet, keine neue Datei", async () => {
  const s = szenarioV();
  const { verschieben } = await mitVorschlaegen(s);
  unlinkSync(join(s.vault, EINTRAG)); // ein anderes Programm hat den Eintrag entfernt
  const r = await anwenden(s, verschieben);
  assert.equal(r.status, 409);
  assert.equal(readdirSync(join(s.vault, "10_projekte")).filter((n) => n.startsWith("Atlas-Idee")).length, 0);
});

test("Nicht-übernehmbare Arten (verlinken, duplikat, tags) schreiben in K0 nichts: 409 noch-nicht; Einwilligung zurückgenommen verwirft alle Vorschläge", async () => {
  const s = szenarioV();
  s.szen({ szenario: "ok" });
  const { stand } = await s.anfrage();
  const vs = stand.ergebnis.vorschlaege[0];
  assert.equal(vs.art, "verlinken");
  const vorher = s.abbild(s.vault);
  const r = await anwenden(s, vs);
  assert.equal(r.status, 409); assert.equal(r.j.art, "noch-nicht");
  assert.deepEqual(s.abbild(s.vault), vorher);
  await s.api("PUT", "/api/ki/vorschlag/einwilligung", { an: false, vault: s.vault });
  assert.equal((await anwenden(s, vs)).status, 404, "ohne Einwilligung bleibt nichts liegen");
});

test("Beim Vault-Wechsel und bei /api/stopp sind alle Vorschläge verworfen", async () => {
  const s = szenarioV();
  const { verschieben } = await mitVorschlaegen(s);
  assert.equal((await s.api("POST", "/api/vaults/aktiv", { pfad: s.anderer })).status, 200);
  assert.equal((await anwenden(s, verschieben)).status, 404, "im anderen Vault: nichts bekannt");
  assert.equal((await s.api("POST", "/api/vaults/aktiv", { pfad: s.vault })).status, 200);
  assert.equal((await anwenden(s, verschieben)).status, 404, "auch zurück im alten Vault ist der Vorschlag verworfen");
  assert.equal(existsSync(join(s.vault, EINTRAG)), true);
});

test("Zwei gleichzeitige Klicks auf „Übernehmen“ führen die Aktion nur einmal aus", async () => {
  const s = szenarioV();
  const { aufgabe } = await mitVorschlaegen(s);
  const [a, b] = await Promise.all([anwenden(s, aufgabe), anwenden(s, aufgabe)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409], JSON.stringify([a.j, b.j]));
  assert.equal([a, b].find((x) => x.status === 409).j.art, "angewendet");
  const dateien = readdirSync(join(s.vault, "05_aufgaben")).filter((n) => n.endsWith(".md"));
  assert.equal(dateien.length, 1, "genau eine Aufgabe");
});
