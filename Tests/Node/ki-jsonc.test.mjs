// JSONC-Baustein der KI-Programme: Lesen mit Kommentaren, Ändern ohne Kommentare/Einrückung zu zerstören, Selbstprüfung des Ergebnisses.
import test from "node:test";
import assert from "node:assert/strict";
import { pfad } from "./hilfe.mjs";

const { parseJsonc, setzeEigenschaft, entferneEigenschaft } = await import(pfad("werkstatt", "ki-programme", "jsonc.mjs"));
const W = { command: "node", args: ["/a b/m.mjs"] };

test("parseJsonc: Kommentare, nachgestellte Kommas, BOM; Fehler bei Müll", () => {
  assert.deepEqual(parseJsonc('﻿// k\n{ "a": [1, 2,], /* x */ "b": { "c": "//kein Kommentar", }, }'), { a: [1, 2], b: { c: "//kein Kommentar" } });
  for (const kaputt of ["", "{", '{"a":}', '{"a":1} x', "[1,2", '{"a" 1}', "{'a':1}", '{"a":/* offen }']) assert.throws(() => parseJsonc(kaputt), kaputt);
});

test("setzeEigenschaft: Kommentare, Reihenfolge und Einrückung bleiben; vorhandene Server bleiben", () => {
  const quelle = '{\n    // mein Theme\n    "theme": "x", // hinten\n    /* Server */\n    "context_servers": {\n        "a": { "command": "q" },\n    },\n}\n';
  const neu = setzeEigenschaft(quelle, ["context_servers"], "brain", W);
  assert.ok(neu.includes("// mein Theme") && neu.includes("// hinten") && neu.includes("/* Server */"));
  assert.ok(neu.includes('        "a": { "command": "q" },'));
  assert.deepEqual(parseJsonc(neu), { theme: "x", context_servers: { a: { command: "q" }, brain: W } });
  assert.ok(neu.includes('        "brain": {'), "gleiche Einrückung wie die Datei");
});

test("setzeEigenschaft: legt fehlende Ebenen an, ersetzt vorhandenen Eintrag, behandelt leere Objekte", () => {
  for (const q of ["{}", "{\n}", "{ }", "{\n  // nur Kommentar\n}\n", '{"a":1}']) {
    const n = setzeEigenschaft(q, ["x", "y"], "brain", W);
    assert.deepEqual(parseJsonc(n).x.y.brain, W, q);
  }
  const mit = '{ "servers": { "brain": { "command": "alt" }, "b": 1 } }';
  assert.deepEqual(parseJsonc(setzeEigenschaft(mit, ["servers"], "brain", W)), { servers: { brain: W, b: 1 } });
});

test("setzeEigenschaft: Wurzel kein Objekt oder Zwischenwert kein Objekt → wirft, Text unverändert nutzbar", () => {
  assert.throws(() => setzeEigenschaft("[1]", ["a"], "brain", W));
  assert.throws(() => setzeEigenschaft('{"a": []}', ["a"], "brain", W));
  assert.throws(() => setzeEigenschaft('{"a": null}', ["a"], "brain", W));
});

test("entferneEigenschaft: nur der eine Eintrag geht, Kommentare und Nachbarn bleiben; fehlender Eintrag → gleicher Text", () => {
  const q = '{\n  // oben\n  "servers": {\n    "a": 1, // eins\n    "brain": { "command": "x" },\n    "c": 3\n  }\n}\n';
  const n = entferneEigenschaft(q, ["servers"], "brain");
  assert.ok(n.includes("// oben") && n.includes("// eins"));
  assert.deepEqual(parseJsonc(n), { servers: { a: 1, c: 3 } });
  assert.equal(entferneEigenschaft(q, ["servers"], "gibtsnicht"), q);
  assert.equal(entferneEigenschaft(q, ["fehlt"], "brain"), q);
  // letzter Eintrag ohne Komma: kein hängendes Komma beim Vorgänger
  const l = entferneEigenschaft('{\n  "servers": {\n    "a": 1,\n    "brain": 2\n  }\n}', ["servers"], "brain");
  assert.deepEqual(parseJsonc(l), { servers: { a: 1 } });
  assert.ok(!/,\s*}/.test(l));
  // einzige Eigenschaft einer Zeile
  assert.deepEqual(parseJsonc(entferneEigenschaft('{"servers":{"brain":1}}', ["servers"], "brain")), { servers: {} });
});

test("Hin und zurück: setzen und wieder entfernen ergibt denselben Wert wie vorher (auch mit Kommentaren)", () => {
  const q = '// kopf\n{\n  "mcp": { /* leer */ },\n  "x": [1, 2, 3] // z\n}\n';
  const mit = setzeEigenschaft(q, ["mcp"], "brain", W);
  assert.deepEqual(parseJsonc(entferneEigenschaft(mit, ["mcp"], "brain")), parseJsonc(q));
  assert.ok(entferneEigenschaft(mit, ["mcp"], "brain").includes("// kopf"));
});
