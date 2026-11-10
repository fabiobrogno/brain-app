// Bausteine der Vorschlagskarten (K3), rein: Tags im Kopf ergänzen (zeilengenau, bytetreu) und die Fundstelle des Belegs für „Warum?“.
import test from "node:test";
import assert from "node:assert/strict";
import { pfad } from "./hilfe.mjs";

const { fuegeTagsHinzu } = await import(pfad("gemeinsam", "tags.mjs"));
const { belegStelle } = await import(pfad("gemeinsam", "ki-schema.mjs"));

test("Tags ergänzen: kein Kopf → neuer Kopf; Kopf ohne Tags → Zeile vor dem Ende; Inline-Liste, Block-Liste und Text werden erweitert, nichts doppelt, Rest bytegleich", () => {
  const f = (t, tags) => fuegeTagsHinzu(t, tags);
  assert.equal(f("# A\n", ["neu"]).text, "---\ntags: [neu]\n---\n# A\n");
  assert.equal(f("---\ntitel: x\n---\n# A\n", ["neu", "Neu"]).text, "---\ntitel: x\ntags: [neu]\n---\n# A\n");
  assert.equal(f("---\ntags: [a, b]\n---\nx", ["b", "c"]).text, "---\ntags: [a, b, c]\n---\nx");
  assert.equal(f("---\ntags: []\n---\nx", ["c"]).text, "---\ntags: [c]\n---\nx");
  assert.equal(f("---\ntags:\n  - a\ntitel: z\n---\nx", ["c"]).text, "---\ntags:\n  - a\n  - c\ntitel: z\n---\nx");
  assert.equal(f("---\ntags: a, b\n---\nx", ["c"]).text, "---\ntags: a, b, c\n---\nx");
  assert.equal(f("---\r\ntags: a\r\n---\r\nx\r\n", ["c"]).text, "---\r\ntags: a, c\r\n---\r\nx\r\n", "Zeilenenden bleiben");
  assert.equal(f("﻿---\ntags: [a]\n---\nx", ["c"]).text, "﻿---\ntags: [a, c]\n---\nx", "BOM bleibt vorn");
  const gleich = f("---\ntags: [a]\n---\nText #b\n", ["A", "b"]);
  assert.deepEqual(gleich.neu, []); assert.equal(gleich.text, "---\ntags: [a]\n---\nText #b\n", "vorhandene Tags (auch im Text, andere Schreibweise) werden nicht noch einmal gesetzt");
  assert.deepEqual(f("x", ["ok", "---", "_", "123", "a b", "../x", "", 5, null]).neu, ["ok"], "nur brauchbare Tag-Namen");
});

test("Tags ergänzen: was sich nicht sicher ändern lässt, wirft (nichts wird „repariert“)", () => {
  assert.equal(fuegeTagsHinzu("---\ntags:\n\n  - a\n---\nx", ["neu"]).text, "---\ntags:\n\n  - a\n  - neu\n---\nx", "Leerzeile vor der Liste: nichts geht verloren");
  assert.deepEqual(fuegeTagsHinzu("x", ["null", "yes", "ok"]).neu, ["null", "yes", "ok"], "die Rohfunktion setzt, was sie bekommt; die KI-Prüfung lässt solche Wörter gar nicht erst zu");
  for (const t of ["---\ntags: {a: b}\n---\n", "---\nkeywords: [a]\ntags: [b]\n---\n", "---\ntags: &x [a]\n---\n", "---\ntitel: x\n# nie geschlossen\n", "---\ntags: [a\n, b]\n---\n", "---\ntags: [a] # Kommentar\n---\n", "---\ntags: \"a\"\n---\n", "---\ntags: a # k\n---\n", "---\ntags:\n  unter: x\n---\n"]) {
    assert.throws(() => fuegeTagsHinzu(t, ["neu"]), /kopf-/, JSON.stringify(t));
  }
});

test("Beleg-Stelle: wörtlich gefunden (NFC, Leerraum zusammengefasst), Umgebung gekürzt mit „…“, ohne Treffer null", () => {
  const text = "Erster Satz.\n\nWir  sollten das\nAtlas Projekt besprechen und die Rechnung ablegen. " + "x".repeat(200);
  const s = belegStelle(text, "Atlas   Projekt besprechen");
  assert.equal(s.treffer, "Atlas Projekt besprechen");
  assert.ok(s.vor.endsWith("das "), JSON.stringify(s.vor)); assert.ok(s.nach.startsWith(" und die Rechnung"), JSON.stringify(s.nach));
  assert.ok(s.nach.endsWith("…"), "lange Umgebung wird gekürzt");
  assert.equal(belegStelle("Café ist gut", "Café ist").treffer, "Café ist");
  assert.equal(belegStelle("Das steht da", "Das steht nicht da"), null);
  assert.equal(belegStelle("Das steht da", "ab"), null, "zu kurz");
  assert.equal(belegStelle("Äpfel essen", "Äpfel essen").treffer, "Äpfel essen", "NFC");
  assert.equal(belegStelle("Anfang", "Anfang").vor, ""); assert.equal(belegStelle("Anfang", "Anfang").nach, "");
});
