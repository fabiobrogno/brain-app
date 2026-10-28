// .tools/tests/test-vorschlaege-thema.mjs — der zentrale Themen-Guard (ernteOhneThema) in schreibeVorschlag: JEDE Stelle, die einen Vorschlag
// in <inbox>/_vorschlaege ablegt (Ernte, Nach-Ernte, Lektionen, Pflege-Lauf, Lernschleife), geht durch diese eine Funktion. Fail-closed: ist
// die Config nicht lesbar, wird nichts abgelegt. Bewusst NICHT geprüft (Entscheidung des Nutzers): manuelles /ingest, brain import, Annehmen
// im Ansicht-Reiter. Neutrales Wort: zebra.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { THEMA_GRUND } from "../thema-ausschluss.mjs";
import { zeitstempel } from "../logs.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
const TEMP_HOME = mkdtempSync(join(tmpdir(), "vorschlag-thema-home-"));
const LEER_PATH = mkdtempSync(join(tmpdir(), "vorschlag-thema-path-"));
Object.assign(process.env, { HOME: TEMP_HOME, USERPROFILE: TEMP_HOME, PATH: LEER_PATH });
for (const k of ["BRAIN_CLAUDE", "BRAIN_ERNTE", "BRAIN_VAULT"]) delete process.env[k];
for (const k of Object.keys(process.env)) if (k.startsWith("GIT_")) delete process.env[k];

const { schreibeVorschlag, listeVorschlaege, vorschlagOrdner } = await import("../vorschlaege.mjs");
const { wochenLauf } = await import("../lernschleife.mjs");
const P = await import("../pflegelauf.mjs");

const FAKE = join(HIER, "fake-claude.mjs");
const FAKE_BEFEHL = { befehl: process.execPath, args: [FAKE] };
const neuerVault = (automatik) => {
  const v = mkdtempSync(join(tmpdir(), "vorschlag-thema vault "));
  if (automatik !== undefined) writeFileSync(join(v, "brain.config.json"), JSON.stringify({ automatik }) + "\n");
  return v;
};
const dateien = (v) => { try { return readdirSync(vorschlagOrdner(v)); } catch { return []; } };
const refuse = (f) => assert.throws(f, (e) => e.grund === THEMA_GRUND && !/zebra/i.test(e.message) && Number.isInteger(e.code), "abgelehnt mit Grund thema-ausgeschlossen, ohne das Wort in der Meldung");
const beleg = { zitat: "Ein ruhiger Satz ohne Thema", herkunft: "du", fundstelle: "s1#u-1 2026-10-20T10:00:00Z" };

test("schreibeVorschlag: ein Wort der Liste in Titel, Text, Zitat, Regel, Warum, Wie oder Quellen-Adresse → nichts abgelegt, Grund thema-ausgeschlossen", () => {
  const v = neuerVault({ ernteOhneThema: ["zebra"] });
  refuse(() => schreibeVorschlag(v, { art: "fakt", titel: "Das Zebra", text: "Ein ruhiger Text.", ...beleg }));
  refuse(() => schreibeVorschlag(v, { art: "fakt", titel: "Ruhig", text: "Hier steht ZEBRA im Text.", ...beleg }));
  refuse(() => schreibeVorschlag(v, { art: "fakt", titel: "Ruhig", text: "Ein ruhiger Text.", ...beleg, zitat: "im Zitat steht das zebra" }));
  refuse(() => schreibeVorschlag(v, { art: "stand", titel: "Ruhig", text: "Ein ruhiger Text.", ...beleg, quelleUrl: "https://example.org/zebra/pflege" }));
  refuse(() => schreibeVorschlag(v, { art: "lektion", titel: "Ruhig", text: "Ein ruhiger Text.", regel: "Zebra immer prüfen", warum: "w", wie: "x" }));
  refuse(() => schreibeVorschlag(v, { art: "lektion", titel: "Ruhig", text: "Ein ruhiger Text.", regel: "r", warum: "wegen Zebra", wie: "x" }));
  refuse(() => schreibeVorschlag(v, { art: "lektion", titel: "Ruhig", text: "Ein ruhiger Text.", regel: "r", warum: "w", wie: "mit dem Zebra" }));
  refuse(() => schreibeVorschlag(v, { art: "pflege", befund: "veraltet", titel: "Seite prüfen", text: "Die Seite über das Zebra ist alt." }));
  assert.deepEqual(dateien(v), [], "keine einzige Datei");
});

test("schreibeVorschlag: Teilwörter treffen nicht, ß/SS und Groß/Klein schon; ohne Treffer und ohne Wortliste wird wie bisher abgelegt", () => {
  const v = neuerVault({ ernteOhneThema: ["zebra", "weißes Einhorn"] });
  assert.ok(schreibeVorschlag(v, { art: "fakt", titel: "Zebrastreifen", text: "Ein Zebrastreifen ist ein Übergang.", ...beleg }), "Teilwort trifft nicht");
  refuse(() => schreibeVorschlag(v, { art: "fakt", titel: "Ruhig", text: "Ein WEISSES   EINHORN steht da.", ...beleg }));
  assert.equal(dateien(v).length, 1);
  const ohne = neuerVault({});
  assert.ok(schreibeVorschlag(ohne, { art: "fakt", titel: "Das Zebra", text: "Ein Text.", ...beleg }), "keine Wörter → kein Guard");
  const keineConfig = neuerVault();
  assert.ok(schreibeVorschlag(keineConfig, { art: "fakt", titel: "Das Zebra", text: "Ein Text.", ...beleg }), "ohne Config gibt es keine Wörter");
});

test("schreibeVorschlag: fail-closed — kaputte oder nicht lesbare Config → nichts abgelegt (auch bei einem Vorschlag, der das Wort gar nicht nennt)", () => {
  const kaputt = neuerVault();
  writeFileSync(join(kaputt, "brain.config.json"), '{"automatik": {"ernteOhneThema": ["zebra"]');
  refuse(() => schreibeVorschlag(kaputt, { art: "fakt", titel: "Ruhig", text: "Ein ruhiger Text.", ...beleg }));
  const ordnerStattDatei = neuerVault();
  mkdirSync(join(ordnerStattDatei, "brain.config.json"));
  refuse(() => schreibeVorschlag(ordnerStattDatei, { art: "fakt", titel: "Ruhig", text: "Ein ruhiger Text.", ...beleg }));
  assert.deepEqual([...dateien(kaputt), ...dateien(ordnerStattDatei)], []);
});

// ----------------------------------------------------------------------------------------------------------------- Lernschleife
const T0 = Date.UTC(2026, 9, 1, 10, 0, 0);
const MIN = 60000;
const z = (ms) => zeitstempel(new Date(ms));
function lernVault(automatik) {
  const v = neuerVault({ luecken: true, ...automatik });
  mkdirSync(join(v, "09_wiki", "wissen"), { recursive: true });
  mkdirSync(join(v, ".logs"), { recursive: true });
  writeFileSync(join(v, "09_wiki", "wissen", "thema_faehre.md"), "---\nname: x\ndescription: x\ntyp: thema\nrev: 1\n---\n# X\n");
  return v;
}
const lernLogs = (v, stichwoerter) => {
  writeFileSync(join(v, ".logs", "luecken.log"), `${z(T0)} sid=aaaa1111 quelle=hint text=${stichwoerter}\n`);
  writeFileSync(join(v, ".logs", "hint.log"), `${z(T0)} sid=aaaa1111 len=30 weg=vektor top=0.300 zeichen=0 hits=- unterdrueckt=0 kalt=0 refresh=0 ms=40\n`);
  writeFileSync(join(v, ".logs", "werkzeug.log"), `${z(T0 + 2 * MIN)} sid=aaaa1111-0000-4000-8000-000000000000 art=lesen ziel=${encodeURIComponent("09_wiki/wissen/thema_faehre.md")}\n`);
};

test("Lernschleife: eine alte Lücke, deren Stichwörter ein ausgeschlossenes Wort nennen, wird nie zum Vorschlag (der Guard greift auch hier); ein harmloses Paar läuft wie bisher", () => {
  const mit = lernVault({ ernteOhneThema: ["zebra"] });
  lernLogs(mit, "zebra gehege füttern");
  const r = wochenLauf(mit, { jetzt: T0 + 60 * MIN, erzwingen: true });
  assert.equal(r.status, "ok");
  assert.deepEqual(r.vorschlaege, []);
  assert.deepEqual(listeVorschlaege(mit), []);
  const ohne = lernVault({ ernteOhneThema: ["giraffe"] });
  lernLogs(ohne, "erste fähre föhr");
  assert.equal(wochenLauf(ohne, { jetzt: T0 + 60 * MIN, erzwingen: true }).vorschlaege.length, 1, "unverfängliches Paar → Vorschlag wie bisher");
});

// ----------------------------------------------------------------------------------------------------------------- Pflege-Lauf
const ladeBericht = async () => ({ erstellt: "2026-10-03", zuTun: 1, posten: [{ schluessel: "abgelaufen", anzahl: 1, liste: ["garten/thema_beet.md"], naechsterSchritt: "Stand prüfen" }] });
const ladeKand = (seiten) => async () => ({ seiten, nachbarn: [] });
function pflegeVault(automatik) {
  const v = neuerVault(automatik);
  mkdirSync(join(v, "09_wiki", "garten"), { recursive: true });
  writeFileSync(join(v, "09_wiki", "garten", "thema_beet.md"), "---\nname: beet\n---\n# Beet\n\nDas Hochbeet steht im Süden.\n");
  return v;
}
function fakeAusgabe(text) {
  const d = mkdtempSync(join(tmpdir(), "vorschlag-thema-fake-"));
  writeFileSync(join(d, "aus.txt"), text);
  Object.assign(process.env, { FAKE_CLAUDE_LOG: join(d, "ein.txt"), FAKE_CLAUDE_AUSGABE: join(d, "aus.txt"), FAKE_CLAUDE_EXIT: "0", FAKE_CLAUDE_ROH: "", FAKE_CLAUDE_OHNE_USAGE: "", FAKE_CLAUDE_WARTE: "0" });
}

test("Pflege-Lauf: Befunde der KI, die ein ausgeschlossenes Wort nennen, werden nicht angelegt und zählen als verworfen; die übrigen schon", async () => {
  const v = pflegeVault({ ernteOhneThema: ["zebra"] });
  fakeAusgabe("### Zebra-Seite prüfen\nbefund: veraltet\nDie Seite ist alt.\n\n### Beet prüfen\nbefund: veraltet\nDas Hochbeet ist alt.\n\n### Ruhiger Titel\nbefund: luecke\nUnten steht ZEBRA im Text.\n");
  const r = await P.pflegeLauf(v, { claudeBefehl: FAKE_BEFEHL, ladeBericht, ladeKand: ladeKand(["09_wiki/garten/thema_beet.md"]) });
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.equal(r.vorschlaege.length, 1, "nur der harmlose Befund");
  assert.equal(r.verworfen, 2);
  const liste = listeVorschlaege(v);
  assert.deepEqual(liste.map((x) => x.titel), ["Beet prüfen"]);
  assert.ok(!existsSync(join(v, ".logs", "pflege-lauf.log")) || !/zebra/i.test(readFileSync(join(v, ".logs", "pflege-lauf.log"), "utf8")), "das Wort steht in keinem Log");
});
