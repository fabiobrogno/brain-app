// .tools/tests/test-tageslauf-zurueck-sauber-fakt.mjs — „als wäre der Fakt nie übernommen worden" (B2, Task 12), Teil 1: Fakt-Zeilen.
// Maßstab: Vault X (A übernommen, danach B, dann A zurück) == Vault Y (nur B) — alle versionierten Dateien außer _log.md, rev neutral.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isoliere } from "./tageslauf-hilfe.mjs";
import { ALT, OHNE_FAKTEN, MIT_FAKTEN, seite, fa, ersetzen, alsWaerNieGewesen } from "./zurueck-hilfe.mjs";
isoliere();

test("Fakt: danach kam ein weiterer Fakt dazu → Seite wie ohne den ersten", () => {
  alsWaerNieGewesen({ hook: "echt", a: fa("a1", "Alpha nutzt Port 3310."), b: fa("b1", "Alpha sichert stündlich.") });
});
test("Fakt: Seite danach weiter unten ergänzt (Fakten-Abschnitt nicht letzter) → Seite wie ohne den ersten", () => {
  alsWaerNieGewesen({ rumpf: `${MIT_FAKTEN}\n## Verwandt\n\n- [[andere_seite]]\n`, a: fa("a1", "Alpha nutzt Port 3310."), b: fa("b1", "Alpha sichert stündlich.") });
});
test("Fakt legte den Abschnitt „Fakten“ an, danach ein zweiter Fakt → Abschnitt bleibt, wie ohne den ersten", () => {
  alsWaerNieGewesen({ rumpf: OHNE_FAKTEN, a: fa("a1", "Alpha nutzt Port 3310."), b: fa("b1", "Alpha sichert stündlich.") });
});
test("Fakt legte den Abschnitt „Fakten“ an, sonst nichts → Seite exakt wie vorher (Abschnitt wieder weg)", () => {
  const { x } = alsWaerNieGewesen({ rumpf: OHNE_FAKTEN, a: fa("a1", "Alpha nutzt Port 3310.") });
  assert.doesNotMatch(seite(x), /## Fakten/);
});
test("Ersetzen, danach ein Fakt → alte Zeile wieder da, neuer Fakt bleibt", () => {
  const { x } = alsWaerNieGewesen({ hook: "echt", a: ersetzen("e1", "Backups laufen stündlich.", ALT), b: fa("b1", "Alpha sichert stündlich.") });
  assert.ok(seite(x).includes(`\n${ALT}\n`));
  assert.doesNotMatch(seite(x), /~~/);
});
test("Ersetzen im Fließtext (Ausweichweg mit zweifel), danach ein Fakt → zweifel wieder weg, Fakt-Zeile weg", () => {
  const { x } = alsWaerNieGewesen({ rumpf: OHNE_FAKTEN, a: ersetzen("e1", "Backups laufen stündlich.", "Backups laufen täglich (Fließtext)."), b: fa("b1", "Alpha hat 4 Kerne.") });
  assert.doesNotMatch(seite(x), /^zweifel:/m);
});
test("Ersetzen im Fließtext, Seite hatte schon einen zweifel → der alte Wortlaut kommt unverändert zurück", () => {
  const { x } = alsWaerNieGewesen({ rumpf: OHNE_FAKTEN, fm: { zweifel: "alte Sorge ohne Anführungszeichen" },
    a: ersetzen("e1", "Backups laufen stündlich.", "Backups laufen täglich (Fließtext)."), b: fa("b1", "Alpha hat 4 Kerne.") });
  assert.match(seite(x), /^zweifel: alte Sorge ohne Anführungszeichen$/m);
});
test("Ausweichweg-zweifel inzwischen von einem späteren Lauf neu gesetzt → bleibt stehen, wie ohne den ersten", () => {
  const fliess = (id, ref) => (v) => ({ ...ersetzen(id, `Alpha ${id}.`, "Backups laufen täglich (Fließtext).")(v), ref });
  const { x } = alsWaerNieGewesen({ rumpf: OHNE_FAKTEN, a: fliess("e1", "rf-a"), b: fliess("b1", "rf-b") });
  assert.match(seite(x), /^zweifel: "[^"]*rf-b/m);
});
