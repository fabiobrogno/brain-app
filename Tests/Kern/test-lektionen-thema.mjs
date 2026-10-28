// .tools/tests/test-lektionen-thema.mjs — Themen-Ausschluss (automatik.ernteOhneThema) bei den Lektionen (Session-Auswerter): ein
// Kandidat oder eine Lektion, die ein ausgeschlossenes Wort nennt, wird gar nicht erst angelegt und nie an die KI geschickt; das Wort
// steht in keinem Log. Nur erfundene Transkripte mit neutralen Wörtern (zebra), fake-claude, Temp-HOME, leerer PATH.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const FAKE = join(HIER, "fake-claude.mjs");
const LEER_PATH = mkdtempSync(join(tmpdir(), "lektion-thema-path-"));
const TEMP_HOME = mkdtempSync(join(tmpdir(), "lektion-thema-home-"));
Object.assign(process.env, { PATH: LEER_PATH, HOME: TEMP_HOME, USERPROFILE: TEMP_HOME });
for (const k of ["BRAIN_CLAUDE", "BRAIN_ERNTE", "BRAIN_VAULT"]) delete process.env[k];
for (const k of Object.keys(process.env)) if (k.startsWith("GIT_")) delete process.env[k];

const L = await import("../lektionen.mjs");
const { listeVorschlaege } = await import("../vorschlaege.mjs");
const FAKE_BEFEHL = { befehl: process.execPath, args: [FAKE] };

const ORDNER = join(tmpdir(), "projekte", "tiere");
const z = (o) => JSON.stringify({ cwd: ORDNER, sessionId: "sitzung-t1", ...o });
const nutzer = (text) => z({ type: "user", message: { role: "user", content: text } });
const antwort = (text) => z({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
function transkript(zeilen) {
  const d = mkdtempSync(join(tmpdir(), "lektion-thema-transkript-"));
  const f = join(d, "sitzung.jsonl");
  writeFileSync(f, zeilen.join("\n") + "\n");
  return f;
}
const korrekturen = (tier, plan) => [
  nutzer(`Erstelle mir einen ${plan} für das ${tier}.`),
  antwort(`Hier der ${plan}: ${tier} täglich morgens füttern.`),
  nutzer(`Nein, das ${tier} im ${plan} bitte nur abends füttern.`),
  antwort(`Verstanden, ${plan} angepasst: ${tier} morgens und abends.`),
  nutzer(`Schon wieder falsch: ${tier} im ${plan} nur abends, nicht morgens!`),
  antwort(`Entschuldigung, ${plan} korrigiert.`),
];
const ZEBRA = korrekturen("Zebra", "Fütterungsplan");
const GNU = korrekturen("Gnu", "Futterplan");
function neuerVault(automatik = {}) {
  const v = mkdtempSync(join(tmpdir(), "lektion thema vault "));
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ automatik }));
  return v;
}
function fakeUmgebung(ausgabe) {
  const d = mkdtempSync(join(tmpdir(), "lektion-thema-fake-"));
  writeFileSync(join(d, "ausgabe.txt"), ausgabe);
  writeFileSync(join(d, "zaehler.jsonl"), "");
  Object.assign(process.env, { FAKE_CLAUDE_AUSGABE: join(d, "ausgabe.txt"), FAKE_CLAUDE_ZAEHLER: join(d, "zaehler.jsonl"), FAKE_CLAUDE_LOG: join(d, "eingabe.txt"),
    FAKE_CLAUDE_WARTE: "0", FAKE_CLAUDE_EXIT: "0", FAKE_CLAUDE_ROH: "", FAKE_CLAUDE_OHNE_USAGE: "", FAKE_CLAUDE_REGELN: "" });
  return { anzahl: () => readFileSync(join(d, "zaehler.jsonl"), "utf8").split("\n").filter(Boolean).length, eingabe: () => (existsSync(join(d, "eingabe.txt")) ? readFileSync(join(d, "eingabe.txt"), "utf8") : "") };
}
function alleLogs(v) {
  const out = [];
  const lauf = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) lauf(p); else out.push(readFileSync(p, "utf8")); } };
  if (existsSync(join(v, ".logs"))) lauf(join(v, ".logs"));
  return out.join("\n");
}
const LEKTION = "### Abends füttern\nziel: memory\nregel: Abends füttern.\nwarum: zweimal korrigiert\nwie: beim Plan\n";

test("Kontrolle: ohne Einstellung ergibt die Zebra-Sitzung einen Vorschlag", async () => {
  const v = neuerVault();
  const r = await L.lektionsLauf(v, { transkript: transkript(ZEBRA), sid: "s1", cwd: ORDNER });
  assert.equal(r.status, "ok");
  assert.equal(r.vorschlaege.length, 1);
});

test("lektionsLauf: Kandidat mit ausgeschlossenem Wort → kein Vorschlag, anderes Thema bleibt; im Log nur die Zahl, nicht das Wort", async () => {
  const v = neuerVault({ ernteOhneThema: ["zebra"] });
  const r = await L.lektionsLauf(v, { transkript: transkript(ZEBRA), sid: "s1", cwd: ORDNER });
  assert.equal(r.status, "ok");
  assert.deepEqual(r.vorschlaege, []);
  assert.deepEqual(listeVorschlaege(v), []);
  const g = await L.lektionsLauf(v, { transkript: transkript(GNU), sid: "s2", cwd: ORDNER });
  assert.equal(g.vorschlaege.length, 1, "ein anderes Thema ist nicht betroffen");
  const log = readFileSync(join(v, ".logs", "lektionen.log"), "utf8");
  assert.match(log.split("\n").filter(Boolean)[0], /kandidaten=0 vorschlaege=0 .* thema=1$/);
  assert.doesNotMatch(alleLogs(v), /zebra/i);
});

test("lektionsLauf: Groß/Klein egal, Teilwörter treffen nicht", async () => {
  const gross = neuerVault({ ernteOhneThema: ["ZEBRA"] });
  assert.deepEqual((await L.lektionsLauf(gross, { transkript: transkript(ZEBRA), sid: "s1", cwd: ORDNER })).vorschlaege, []);
  const teil = neuerVault({ ernteOhneThema: ["zebr"] });
  assert.equal((await L.lektionsLauf(teil, { transkript: transkript(ZEBRA), sid: "s1", cwd: ORDNER })).vorschlaege.length, 1, "„zebr“ ist kein ganzes Wort");
});

test("mit-ki: ein Kandidat mit ausgeschlossenem Wort wird nie an die KI geschickt (kein Aufruf)", async () => {
  const v = neuerVault({ lektionen: "mit-ki", ernteOhneThema: ["zebra"] });
  const fake = fakeUmgebung(LEKTION);
  process.env.BRAIN_CLAUDE = FAKE;
  try {
    const r = await L.lektionsLauf(v, { transkript: transkript(ZEBRA), sid: "s1", cwd: ORDNER });
    assert.deepEqual(r.vorschlaege, []);
    assert.equal(fake.anzahl(), 0, "claude wurde nicht aufgerufen");
    const g = await L.lektionsLauf(v, { transkript: transkript(GNU), sid: "s2", cwd: ORDNER });
    assert.equal(g.vorschlaege.length, 1);
    assert.equal(fake.anzahl(), 1);
    assert.doesNotMatch(fake.eingabe(), /zebra/i, "an die KI ging nur das andere Thema");
  } finally { delete process.env.BRAIN_CLAUDE; }
});

test("formuliereLektionen: Kandidaten mit Treffer vor dem KI-Aufruf entfernt; eine formulierte Lektion mit Treffer wird verworfen", async () => {
  const v = neuerVault();
  const fake = fakeUmgebung(LEKTION);
  const mitTreffer = { art: "korrektur", thema: "zebra fütterungsplan", auszug: "Nutzer: das Zebra nur abends füttern", anzahl: 2, ordner: ORDNER, sitzung: "s" };
  const ohneTreffer = { art: "korrektur", thema: "gnu futterplan", auszug: "Nutzer: das Gnu nur abends füttern", anzahl: 2, ordner: ORDNER, sitzung: "s" };
  const r1 = await L.formuliereLektionen(v, [mitTreffer], { mitKi: true, claudeBefehl: FAKE_BEFEHL, ohneThema: ["zebra"] });
  assert.deepEqual(r1.vorschlaege, []);
  assert.equal(fake.anzahl(), 0, "kein Kandidat übrig → kein Aufruf");
  const r2 = await L.formuliereLektionen(v, [mitTreffer, ohneTreffer], { mitKi: true, claudeBefehl: FAKE_BEFEHL, ohneThema: ["zebra"] });
  assert.equal(r2.vorschlaege.length, 1);
  assert.doesNotMatch(fake.eingabe(), /zebra/i);
  // Die KI schreibt trotzdem das ausgeschlossene Wort in die Regel → verworfen, nichts angelegt.
  fakeUmgebung("### Abends\nziel: memory\nregel: Das Zebra abends füttern.\nwarum: zweimal korrigiert\nwie: beim Plan\n");
  const vorher = listeVorschlaege(v).length;
  const r3 = await L.formuliereLektionen(v, [ohneTreffer], { mitKi: true, claudeBefehl: FAKE_BEFEHL, ohneThema: ["zebra"] });
  assert.deepEqual(r3.vorschlaege, []);
  assert.equal(r3.verworfen, 1);
  assert.equal(listeVorschlaege(v).length, vorher);
  // Rückfall ohne KI: Rohkandidat mit Treffer entfällt ebenfalls.
  assert.deepEqual((await L.formuliereLektionen(v, [mitTreffer], { mitKi: false, ohneThema: ["zebra"] })).vorschlaege, []);
});
