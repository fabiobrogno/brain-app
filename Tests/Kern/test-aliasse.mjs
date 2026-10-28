// .tools/tests/test-aliasse.mjs — Entitäts-Aliasse (B1, §4.5): Format, Normalisierung, Index, Dubletten, Kartenzeile.
import { test } from "node:test";
import assert from "node:assert/strict";
import { auchGenanntRoh, pruefeAuchGenannt, normalisiereName, eigenerName, aliasIndex, aliasDubletten, aliasZeile } from "../aliasse.mjs";

test("pruefeAuchGenannt: JSON-Liste aus Texten, höchstens 10, je ≤ 60; Feld fehlt → nichts", () => {
  assert.deepEqual(pruefeAuchGenannt("[\"Kompass Basis\", \" kompass-kern \", \"Kompass Basis\"]"), { aliase: ["Kompass Basis", "kompass-kern"], fehler: [] });
  assert.deepEqual(pruefeAuchGenannt(null), { aliase: [], fehler: [] });
  assert.match(pruefeAuchGenannt("kompass").fehler[0], /^kein gültiges JSON/);
  assert.match(pruefeAuchGenannt("{\"a\":1}").fehler[0], /^keine Liste/);
  assert.match(pruefeAuchGenannt("").fehler[0], /^leer/);
  assert.deepEqual(pruefeAuchGenannt(JSON.stringify(Array.from({ length: 11 }, (_, i) => `n${i}`))).fehler, ["11 Namen — höchstens 10"]);
  assert.deepEqual(pruefeAuchGenannt(JSON.stringify(["a".repeat(61), 5, " "])).fehler, ["Eintrag 1 hat 61 Zeichen — höchstens 60", "Eintrag 2 ist kein Text", "Eintrag 3 ist leer"]);
  assert.equal(auchGenanntRoh("name: x\r\nauch_genannt: [\"a\"]\r\n"), "[\"a\"]");
  assert.equal(auchGenanntRoh("name: x\n"), null);
});

test("normalisiereName/eigenerName: Groß/Klein, Umlaute, Trenner; Typ-Präfix weg, name-Feld zählt", () => {
  assert.equal(normalisiereName("Kompass Basis"), "kompass-basis");
  assert.equal(normalisiereName("kompass_basis"), "kompass-basis");
  assert.equal(normalisiereName("Kömpass  Straße!"), "koempass-strasse");
  assert.equal(eigenerName("09_wiki/technik/entitaet_kompass.md"), "kompass");
  assert.equal(eigenerName("09_wiki/technik/entitaet_kompass.md", "Kompass Kern"), "kompass-kern");
  assert.equal(eigenerName("09_wiki/garten/thema_beet.md", "thema_beet"), "beet");
});

test("aliasIndex: sortiert, normalisiert; aliasDubletten nur, wenn ein Alias beteiligt ist; aliasZeile", () => {
  const idx = aliasIndex([
    { id: "b.md", name: "kern", aliase: [] },
    { id: "a.md", name: "kompass", aliase: ["Kern", "Kompass Basis"] },
    { id: "c.md", name: "beet", aliase: [] },
    { id: "d.md", name: "beet", aliase: [] },
  ]);
  assert.deepEqual(idx, { version: 1, seiten: { "a.md": ["kern", "kompass-basis"] },
    namen: { beet: ["c.md", "d.md"], kern: ["a.md", "b.md"], kompass: ["a.md"], "kompass-basis": ["a.md"] } });
  assert.deepEqual(aliasDubletten(idx), [{ name: "kern", ids: ["a.md", "b.md"] }]);
  assert.equal(aliasZeile("[\"Kompass Basis\", \"kompass-kern\"]"), "Auch genannt: Kompass Basis · kompass-kern");
  assert.equal(aliasZeile(null), "");
});
