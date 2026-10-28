// .tools/tests/test-ernte-thema.mjs — Themen-Ausschluss (automatik.ernteOhneThema) in Ernte und Nach-Ernte: ein Vorschlag, dessen
// Titel, Text oder Zitat ein ausgeschlossenes Wort (ganzes Wort, Groß/Klein egal) nennt, wird gar nicht erst angelegt. Das Wort
// steht in keinem Log. Nur fake-claude, erfundene Sitzung mit neutralen Wörtern (zebra), Temp-HOME, leerer PATH.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const FAKE = join(HIER, "fake-claude.mjs");
const LEER_PATH = mkdtempSync(join(tmpdir(), "thema-path-"));
const TEMP_HOME = mkdtempSync(join(tmpdir(), "thema-home-"));
Object.assign(process.env, { PATH: LEER_PATH, HOME: TEMP_HOME, USERPROFILE: TEMP_HOME });
delete process.env.BRAIN_CLAUDE;
delete process.env.BRAIN_ERNTE;
for (const k of Object.keys(process.env)) if (k.startsWith("GIT_")) delete process.env[k];

const E = await import("../ernte.mjs");
const { tempVault, tempOrdner, schreibeVerlauf } = await import("./verlauf-fixture.mjs");
const { gartenEintraege, GARTEN_SITZUNG, GARTEN_CWD } = await import("./fixture-garten.mjs");

const FAKE_BEFEHL = { befehl: process.execPath, args: [FAKE] };
const JETZT = Date.UTC(2026, 9, 21, 9, 0, 0);
const zeit = (n) => `2026-10-21T08:${String(n).padStart(2, "0")}:00.000Z`;
const du = (n, text) => ({ uuid: `u${n}`, timestamp: zeit(n), sessionId: GARTEN_SITZUNG, cwd: GARTEN_CWD, type: "user", message: { role: "user", content: text } });
const EXTRA = [
  du(50, "Das Zebra Hans wohnt im Gehege vier und frisst nur Heu."),
  du(51, "Hans wohnt im Gehege vier und frisst nur Heu."),
  du(52, "Der Zebrastreifen vor dem Gehege ist neu markiert."),
];
const ANTWORT = [
  "### Zebra-Gehege", "Hans wohnt im Gehege vier.", "Zitat: Hans wohnt im Gehege vier und frisst nur Heu.", "",                          // Titel
  "### Gehege", "Das Zebra wohnt im Gehege vier.", "Zitat: Hans wohnt im Gehege vier und frisst nur Heu.", "",                         // Text
  "### Gehege Hans", "Hans wohnt im Gehege vier.", "Zitat: Das Zebra Hans wohnt im Gehege vier und frisst nur Heu.", "",                // Zitat
  "### Zebrastreifen", "Der Streifen vor dem Gehege ist neu markiert.", "Zitat: Der Zebrastreifen vor dem Gehege ist neu markiert.", "",   // nur Teilwort → bleibt
  "### Möhren", "Möhren werden ab Mitte April gesät.", "Zitat: Werkzeug (Bash): Möhren säen ab Mitte April in Reihe 3.", "",            // ohne Thema → bleibt
].join("\n");

function fakeAusgabe(ausgabe) {
  const d = mkdtempSync(join(tmpdir(), "thema-fake-"));
  writeFileSync(join(d, "ausgabe.txt"), ausgabe);
  Object.assign(process.env, { FAKE_CLAUDE_LOG: join(d, "eingabe.txt"), FAKE_CLAUDE_AUSGABE: join(d, "ausgabe.txt"), FAKE_CLAUDE_WARTE: "0",
    FAKE_CLAUDE_EXIT: "0", FAKE_CLAUDE_ROH: "", FAKE_CLAUDE_OHNE_USAGE: "", FAKE_CLAUDE_REGELN: "", FAKE_CLAUDE_ZAEHLER: "" });
}
const vaultMit = (ohneThema) => {
  const v = tempVault();
  if (ohneThema !== undefined) writeFileSync(join(v, "brain.config.json"), JSON.stringify({ automatik: { ernteOhneThema: ohneThema } }));
  return v;
};
const verlauf = (v) => {
  const f = join(tempOrdner("Verlauf Thema"), "sitzung thema.jsonl");
  schreibeVerlauf(f, [...gartenEintraege({ vault: v }), ...EXTRA]);
  return f;
};
const live = (v, tr, extra = {}) => E.ernte(v, { art: "fakt", transkript: tr, sid: GARTEN_SITZUNG, cwd: GARTEN_CWD, claudeBefehl: FAKE_BEFEHL, jetzt: JETZT, ...extra });
const nach = (v, tr, extra = {}) => E.ernte(v, { nachernte: true, transkript: tr, sid: GARTEN_SITZUNG, cwd: GARTEN_CWD, claudeBefehl: FAKE_BEFEHL, jetzt: JETZT, ...extra });
const vorschlaege = (v, r) => r.vorschlaege.map((id) => readFileSync(join(v, "00_inbox", "_vorschlaege", `${id}.md`), "utf8"));
const titel = (dateien) => dateien.map((t) => /\ntitel: "([^"]*)"/.exec(t)[1]).sort();
const logZeile = (v) => readFileSync(join(v, ".logs", "ernte.log"), "utf8").trim().split("\n").pop();
function alleLogs(v) {
  const out = [];
  const lauf = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) lauf(p); else out.push(readFileSync(p, "utf8")); } };
  if (existsSync(join(v, ".logs"))) lauf(join(v, ".logs"));
  return out.join("\n");
}

test("Kontrolle ohne Einstellung: alle fünf Vorschläge werden angelegt", async () => {
  const v = vaultMit();
  fakeAusgabe(ANTWORT);
  const r = await live(v, verlauf(v));
  assert.equal(r.status, "ok");
  assert.deepEqual(titel(vorschlaege(v, r)), ["Gehege", "Gehege Hans", "Möhren", "Zebra-Gehege", "Zebrastreifen"]);
  assert.doesNotMatch(logZeile(v), / thema=/, "ohne Treffer keine Themen-Zahl im Log");
});

test("Ernte: Treffer in Titel, Text oder Zitat → Vorschlag gar nicht erst angelegt; Teilwort und andere Themen bleiben; im Log nur die Zahl", async () => {
  const v = vaultMit(["zebra"]);
  fakeAusgabe(ANTWORT);
  const r = await live(v, verlauf(v));
  assert.equal(r.status, "ok");
  assert.deepEqual(titel(vorschlaege(v, r)), ["Möhren", "Zebrastreifen"], "nur Teilwort „Zebrastreifen“ und das fremde Thema bleiben");
  assert.equal(readdirSync(join(v, "00_inbox", "_vorschlaege")).length, 2, "nichts anderes liegt in der Inbox");
  const z = logZeile(v);
  assert.match(z, / vorschlaege=2 verworfen=0 ohneBeleg=0 nurKi=0 ungedeckt=0 thema=3$/);
  assert.doesNotMatch(alleLogs(v), /zebra/i, "das Wort steht in keinem Log");
});

test("Ernte: Groß/Klein egal, Mehrwort-Begriffe, ein einzelner Text in der Config schützt trotzdem, mehrere Wörter", async () => {
  for (const cfg of [["ZEBRA"], "zebra", ["gnu", "Zebra", "okapi"]]) {
    const v = vaultMit(cfg);
    fakeAusgabe(ANTWORT);
    const r = await live(v, verlauf(v));
    assert.deepEqual(titel(vorschlaege(v, r)), ["Möhren", "Zebrastreifen"], JSON.stringify(cfg));
  }
  const v = vaultMit(["das zebra hans"]);
  fakeAusgabe(ANTWORT);
  const r = await live(v, verlauf(v));
  assert.deepEqual(titel(vorschlaege(v, r)), ["Gehege", "Möhren", "Zebra-Gehege", "Zebrastreifen"], "Mehrwort-Begriff trifft nur das Zitat, das ihn ganz nennt");
});

test("Ernte: ein Stand (art stand) mit Treffer wird ebenfalls nicht angelegt", async () => {
  const v = vaultMit(["zebra"]);
  fakeAusgabe(["### Stand Gehege", "Hans wohnt im Gehege vier.", "Zitat: Das Zebra Hans wohnt im Gehege vier und frisst nur Heu.", ""].join("\n"));
  const r = await live(v, verlauf(v), { art: "stand" });
  assert.equal(r.status, "ok");
  assert.deepEqual(r.vorschlaege, []);
  assert.match(logZeile(v), / art=stand status=ok .* vorschlaege=0 .* thema=1$/);
});

test("Nach-Ernte: dieselbe Prüfung, die Zahl steht im Log (ohne das Wort), die Sitzung gilt als nachgeerntet", async () => {
  const v = vaultMit(["zebra"]);
  fakeAusgabe(ANTWORT);
  const r = await nach(v, verlauf(v));
  assert.equal(r.status, "ok");
  assert.deepEqual(titel(vorschlaege(v, r)), ["Möhren", "Zebrastreifen"]);
  assert.match(logZeile(v), / vorschlaege=2 verworfen=0 ohneBeleg=0 nurKi=0 ungedeckt=0 dubletten=0 thema=3 nachernte=1 fenster=1\/1$/);
  assert.doesNotMatch(alleLogs(v), /zebra/i);
  assert.equal(E.leseNachernteMarken(v).get(GARTEN_SITZUNG).status, "ok");
});

test("Unlesbare Config bleibt fail-closed: nichts angelegt, kein KI-Aufruf", async () => {
  const v = tempVault();
  writeFileSync(join(v, "brain.config.json"), '{"automatik": {"ernteOhneThema": ["zebra"]');
  fakeAusgabe(ANTWORT);
  const r = await live(v, verlauf(v));
  assert.deepEqual(r, { status: "uebersprungen", grund: "Config nicht lesbar", vorschlaege: [] });
  assert.ok(!existsSync(join(v, "00_inbox")));
});

test("Ernte: steht das Wort nur in der Quellen-Adresse eines Web-Belegs, fängt der zentrale Guard in schreibeVorschlag es — gezählt als Thema, das Wort steht in keinem Log", async () => {
  const v = vaultMit(["gartentipps"]);
  fakeAusgabe(["### Kompost", "Kompost reift sechs Monate.", "Zitat: Kompost braucht sechs Monate bis zur Reife.", ""].join("\n"));
  const r = await live(v, verlauf(v));
  assert.equal(r.status, "ok");
  assert.deepEqual(r.vorschlaege, []);
  assert.match(logZeile(v), / vorschlaege=0 verworfen=0 ohneBeleg=0 nurKi=0 ungedeckt=0 thema=1$/);
  assert.doesNotMatch(alleLogs(v), /gartentipps/i);
  const ohne = vaultMit(["gnu"]);
  fakeAusgabe(["### Kompost", "Kompost reift sechs Monate.", "Zitat: Kompost braucht sechs Monate bis zur Reife.", ""].join("\n"));
  assert.equal((await live(ohne, verlauf(ohne))).vorschlaege.length, 1, "Kontrolle: ohne Treffer wird der Web-Beleg angelegt");
});
