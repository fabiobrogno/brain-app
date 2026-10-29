// .tools/tests/test-w7-thema.mjs — Themen-Ausschluss (automatik.ernteOhneThema) beim Fehler-Signal W7: ein Fund, dessen Korrektur-Zitat
// oder Seitenpfad ein ausgeschlossenes Wort nennt, wird gar nicht erst in .logs/w7.jsonl geschrieben; das Wort steht in keinem Log.
// Erfundene Sitzung mit neutralem Wort (zebra), Temp-Vault, Temp-HOME.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { nutzer, assistent, hinweis, schreibeVerlauf, tempVault, tempOrdner, TEMP_HOME } from "./verlauf-fixture.mjs";
import { leseW7, w7Lauf } from "../w7.mjs";

const KOPF = "Kortex-Treffer (lokal, ungelesen — nur öffnen, wenn für die Aufgabe relevant):";
const z = (n) => `2026-10-21T08:0${n}:00.000Z`;
const H = (seite, vault) => hinweis(`${KOPF}\n- ${vault}/${seite} — Beschreibung`);
const CWD = "/projekte/tiere";

function vaultMit(ohneThema) {
  const v = tempVault("W7 Thema Brän");
  if (ohneThema !== undefined) writeFileSync(join(v, "brain.config.json"), JSON.stringify({ automatik: { ernteOhneThema: ohneThema } }));
  return v;
}
function verlauf(v, { seite, korrektur }) {
  const f = join(tempOrdner("W7 Thema Verlauf"), "sitzung w7.jsonl");
  schreibeVerlauf(f, [
    nutzer("Wann wird gefüttert?", { uuid: "p1", zeit: z(0), cwd: CWD }),
    H(seite, v),
    assistent("Laut Brain um 7 Uhr."),
    nutzer(korrektur, { uuid: "p2", zeit: z(1), cwd: CWD }),
    assistent("Korrigiert."),
  ]);
  return f;
}
const lauf = (v, tr) => w7Lauf(v, { transkript: tr, sid: "sitzung-w7", cwd: CWD, home: TEMP_HOME });
const logs = (v) => ["w7.log", "w7.jsonl"].map((n) => (existsSync(join(v, ".logs", n)) ? readFileSync(join(v, ".logs", n), "utf8") : "")).join("\n");

test("Kontrolle: ohne Einstellung wird die Korrektur zum Fund", () => {
  const v = vaultMit();
  assert.deepEqual(lauf(v, verlauf(v, { seite: "09_wiki/tiere/thema_gehege.md", korrektur: "Nein, das stimmt nicht, das Zebra wird um 8 gefüttert." })), { status: "ok", funde: 1, neu: 1 });
});

test("Treffer im Korrektur-Zitat → kein Fund, w7.jsonl und w7.log ohne das Wort", () => {
  const v = vaultMit(["zebra"]);
  const r = lauf(v, verlauf(v, { seite: "09_wiki/tiere/thema_gehege.md", korrektur: "Nein, das stimmt nicht, das Zebra wird um 8 gefüttert." }));
  assert.deepEqual(r, { status: "ok", funde: 0, neu: 0 });
  assert.deepEqual(leseW7(v), []);
  assert.doesNotMatch(logs(v), /zebra/i);
});

test("Treffer im Seitenpfad → kein Fund; ein Fund ohne Treffer bleibt; Teilwort trifft nicht", () => {
  const v = vaultMit(["zebra"]);
  assert.deepEqual(lauf(v, verlauf(v, { seite: "09_wiki/tiere/thema_zebra.md", korrektur: "Nein, das stimmt nicht, es ist 8 Uhr." })), { status: "ok", funde: 0, neu: 0 });
  assert.doesNotMatch(logs(v), /zebra/i);
  const w = vaultMit(["zebra"]);
  assert.deepEqual(lauf(w, verlauf(w, { seite: "09_wiki/tiere/thema_gnu.md", korrektur: "Nein, das stimmt nicht, es ist 8 Uhr." })), { status: "ok", funde: 1, neu: 1 });
  const t = vaultMit(["zebra"]);
  assert.equal(lauf(t, verlauf(t, { seite: "09_wiki/tiere/thema_zebrastreifen.md", korrektur: "Nein, das stimmt nicht, es ist 8 Uhr." })).neu, 1, "Teilwort ist kein Treffer");
});

test("Unlesbare Config bleibt fail-closed: nichts geschrieben", () => {
  const v = tempVault("W7 Thema kaputt");
  writeFileSync(join(v, "brain.config.json"), '{"automatik": {"ernteOhneThema": ["zebra"]');
  const r = lauf(v, verlauf(v, { seite: "09_wiki/tiere/thema_gehege.md", korrektur: "Nein, das stimmt nicht." }));
  assert.deepEqual([r.status, r.grund], ["uebersprungen", "Config nicht lesbar"]);
  assert.deepEqual(leseW7(v), []);
});
