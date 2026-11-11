// Stapel der Vorgänge für ⌘Z / ⇧⌘Z (Ressourcen/studio/vorgang-stapel.js): Reihenfolge, Wiederholen, neue Aktion leert Wiederholen, nie über Vault-Wechsel.
import test from "node:test";
import assert from "node:assert/strict";
import * as s from "../../Ressourcen/studio/vorgang-stapel.js";

const V = "/vault/a";
test.beforeEach(() => s.leeren());

test("neuester zuerst zurück, dann wieder vor in umgekehrter Reihenfolge", () => {
  s.merke({ id: "1", art: "umbenennen", vault: V });
  s.merke({ id: "2", art: "verschieben", vault: V });
  const z2 = s.nimmFertig(V); assert.equal(z2.id, "2"); s.markiereZurueck("2", V);
  const z1 = s.nimmFertig(V); assert.equal(z1.id, "1"); s.markiereZurueck("1", V);
  assert.equal(s.nimmFertig(V), null);
  const w1 = s.nimmZurueck(V); assert.equal(w1.id, "1"); s.markiereWieder("1");
  const w2 = s.nimmZurueck(V); assert.equal(w2.id, "2"); s.markiereWieder("2");
  assert.deepEqual(s.stand(), { fertig: 2, zurueck: 0 });
});

test("eine neue Aktion nach dem Zurücknehmen leert „Wiederholen“", () => {
  s.merke({ id: "1", art: "loeschen", vault: V });
  s.nimmFertig(V); s.markiereZurueck("1", V);
  assert.equal(s.stand().zurueck, 1);
  s.merke({ id: "2", art: "loeschen", vault: V });
  assert.deepEqual(s.stand(), { fertig: 1, zurueck: 0 });
});

test("ein Vault-Wechsel verwirft beide Listen", () => {
  s.merke({ id: "1", art: "loeschen", vault: V });
  assert.equal(s.nimmFertig("/vault/b"), null);
  assert.deepEqual(s.stand(), { fertig: 0, zurueck: 0 });
});

test("ein Schritt, der nicht klappt, legt seinen Eintrag oben zurück (nicht der vorige kommt dran); endgültige Fehler sind erkennbar", () => {
  s.merke({ id: "1", art: "loeschen", vault: V });
  s.merke({ id: "2", art: "loeschen", vault: V });
  const e = s.nimmFertig(V); assert.equal(e.id, "2");
  s.legeZurueck(e); // z. B. 409 beschaeftigt
  assert.equal(s.nimmFertig(V).id, "2");
  assert.equal(s.istEndgueltig({ status: 409, daten: { art: "beschaeftigt" } }), false);
  assert.equal(s.istEndgueltig({ status: 0 }), false);
  assert.equal(s.istEndgueltig({ status: 404 }), true);
  assert.equal(s.istEndgueltig({ status: 409, daten: { art: "schon-zurueck" } }), true);
  // Wiederholen: derselbe Weg auf der anderen Seite
  s.leeren(); s.merke({ id: "3", art: "loeschen", vault: V });
  s.markiereZurueck("3", V); const w = s.nimmZurueck(V); s.legeZurueck(w, true);
  assert.equal(s.nimmZurueck(V).id, "3");
});

test("verwirf entfernt von beiden Seiten; der eigene Weg bleibt erhalten", () => {
  const rueck = () => {};
  s.merke({ id: "1", art: "tag-umbenennen", vault: V, rueck });
  const e = s.nimmFertig(V); assert.equal(e.rueck, rueck);
  s.markiereZurueck("1", V);
  const w = s.nimmZurueck(V); assert.equal(w.rueck, rueck);
  s.verwirf("1");
  assert.deepEqual(s.stand(), { fertig: 0, zurueck: 0 });
});

test("Zurücknehmen über den Hinweis-Knopf (nicht im Stapel) landet trotzdem in „Wiederholen“", () => {
  s.markiereZurueck("9", V, "verschieben");
  assert.equal(s.nimmZurueck(V).id, "9");
});

test("der Stapel ist auf 50 Einträge begrenzt", () => {
  for (let i = 0; i < 60; i++) s.merke({ id: String(i), art: "umbenennen", vault: V });
  assert.equal(s.stand().fertig, 50);
  assert.equal(s.nimmFertig(V).id, "59");
});
