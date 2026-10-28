// .tools/tests/test-tageslauf-zurueck-sauber-rest.mjs — „als wäre der Fakt nie übernommen worden" (B2, Task 12), Teil 2: Stand, Felder, quellen.
// Maßstab: Vault X (A übernommen, danach B, dann A zurück) == Vault Y (nur B) — alle versionierten Dateien außer _log.md, rev neutral.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isoliere } from "./tageslauf-hilfe.mjs";
import { Zr, JETZT, git, neuerTestVault, SEITE, MIT_FAKTEN, MIT_STAND, OHNE_STAND, MIT_VERLAUF, VERLAUF10, seite, zustand, simuliereLauf, fakt, fa, stand, feld, alsWaerNieGewesen } from "./zurueck-hilfe.mjs";
isoliere();

test("Stand ersetzt, danach ein Fakt → alter Stand zurück, Verlaufszeile weg", () => {
  const { x } = alsWaerNieGewesen({ hook: "echt", rumpf: MIT_STAND, a: stand("s1", "- Erledigt: neu"), b: fa("b1", "Alpha hat 4 Kerne.") });
  assert.doesNotMatch(seite(x), /## Verlauf|Erledigt: neu/);
  assert.match(seite(x), /## Stand\n\nStand 01\.10\.2026 · \[\[x\]\]\n\n- Erledigt: alt\n/);
});
test("Stand ersetzt bei vollem Verlauf (10 Zeilen) → die dabei herausgefallene älteste Zeile ist wieder da", () => {
  const { x } = alsWaerNieGewesen({ rumpf: MIT_VERLAUF, a: stand("s1", "- Erledigt: neu"), b: fa("b1", "Alpha hat 4 Kerne.") });
  assert.ok(seite(x).includes(VERLAUF10));
});
test("Stand legte den Abschnitt neu an (Seite hatte keinen), danach ein Fakt → Abschnitt wieder weg", () => {
  const { x } = alsWaerNieGewesen({ rumpf: OHNE_STAND, a: stand("s1", "- Erledigt: neu"), b: fa("b1", "Alpha hat 4 Kerne.") });
  assert.doesNotMatch(seite(x), /## Stand/);
});
test("Stand ersetzt, nichts danach → Seite exakt wie vorher", () => {
  alsWaerNieGewesen({ rumpf: MIT_STAND, a: stand("s1", "- Erledigt: neu") });
});
test("Feld gesetzt (Seite hatte zweifel), danach ein Fakt → alter Wortlaut zurück", () => {
  const { x } = alsWaerNieGewesen({ hook: "echt", fm: { zweifel: "alte Sorge" }, a: feld("rf-20261022-zweifel-aaa111", "2026-10-22: neu"), b: fa("b1", "Alpha hat 4 Kerne.") });
  assert.match(seite(x), /^zweifel: alte Sorge$/m);
});
test("Feld gesetzt (Seite hatte keins), danach ein Fakt → Feld weg", () => {
  const { x } = alsWaerNieGewesen({ a: feld("rf-20261022-zweifel-bbb222", "2026-10-22: neu"), b: fa("b1", "Alpha hat 4 Kerne.") });
  assert.doesNotMatch(seite(x), /^zweifel:/m);
});
test("quellen im Bestandsformat (mit Leerzeichen) kommen nach der Rücknahme unverändert zurück", () => {
  const fm = { quellen: '["10_projekte/x.md", "10_projekte/y.md"]', quellen_sha: '["1111111111111111", "2222222222222222"]' };
  const { x } = alsWaerNieGewesen({ fm, a: fa("a1", "Alpha nutzt Port 3310.") });
  assert.match(seite(x), /^quellen: \["10_projekte\/x\.md", "10_projekte\/y\.md"\]$/m);
});
test("Seite ohne quellen-Felder: nach der Rücknahme gibt es sie wieder nicht", () => {
  const v = neuerTestVault({ hook: "echt", seiten: { [SEITE]: `---\nname: alpha\ndescription: Alpha\ntyp: thema\nrev: 1\n---\n${MIT_FAKTEN}` } });
  const vorher = zustand(v);
  simuliereLauf(v, 1, [fakt(v, "a1", "Alpha nutzt Port 3310.")]);
  assert.match(seite(v), /^quellen: \["10_projekte\/belege\/2026-10\/a1\.md"\]$/m);
  assert.equal(Zr.nimmZurueck(v, { ids: ["a1"], jetzt: JETZT + 5 * 60e3 }).ok, true);
  assert.deepEqual(zustand(v), vorher);
  assert.equal(git(v, "status", "--porcelain"), "");
});
