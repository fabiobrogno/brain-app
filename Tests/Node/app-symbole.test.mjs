// App-Symbole (wählbare Dock-Symbole): die SVG-Varianten und .icns sind ERZEUGT (scripts/erzeuge-app-symbole.mjs) und dürfen nicht von Hand geändert
// werden; Standard bleibt die Quelle; die Einstellung `appSymbol` kennt genau die fünf Namen, die Swift (AppSymbol) und das Studio (texte-einstellungen.js) kennen.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pruefe, alleSvgs, variante, varianteKlein, PALETTEN, NAMEN, NAMEN_OHNE_STANDARD, QUELLE_GROSS, QUELLE_KLEIN, VARIANTEN_ORDNER } from "../../scripts/erzeuge-app-symbole.mjs";
import { APP_SCHEMA, istGueltig } from "../../Ressourcen/gemeinsam/app-einstellungen.mjs";

const W = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

test("erzeugte SVGs und .icns stimmen mit dem Generator überein (nicht von Hand ändern)", () => {
  assert.deepEqual(pruefe(), []);
});

test("jede Variante ist eine eigene, gültige Datei; Standard ist die Quelle", () => {
  const gross = readFileSync(QUELLE_GROSS, "utf8"), klein = readFileSync(QUELLE_KLEIN, "utf8");
  assert.equal(variante("standard", gross), gross);
  assert.equal(varianteKlein("standard", klein), klein);
  const svgs = alleSvgs();
  assert.equal(Object.keys(svgs).length, NAMEN_OHNE_STANDARD.length * 2);
  for (const n of NAMEN_OHNE_STANDARD) {
    assert.notEqual(svgs[`kortex-${n}.svg`], gross, n);
    assert.match(svgs[`kortex-${n}.svg`], /^<svg /, n);
    // gleiche Form und Windung: Körperpfad und Strichpfad bleiben unverändert
    for (const pfad of gross.match(/ d="M[^"]+"/g)) assert.ok(svgs[`kortex-${n}.svg`].includes(pfad), `${n}: Geometrie geändert`);
    assert.ok(svgs[`kortex-${n}-klein.svg`].includes('stroke-width="92.4"'), `${n}: Strich der Kleinvariante`);
    assert.equal(readFileSync(join(VARIANTEN_ORDNER, `kortex-${n}.svg`), "utf8"), svgs[`kortex-${n}.svg`]);
  }
});

test("Papier hat einen Rand, damit es auf hellem Dock nicht verschwindet; die anderen nicht", () => {
  const svgs = alleSvgs();
  assert.match(svgs["kortex-papier.svg"], /fill="url\(#grund\)" stroke="#[0-9A-F]{6}" stroke-opacity=/);
  assert.match(svgs["kortex-papier-klein.svg"], /fill="url\(#bg\)" stroke=/);
  for (const n of ["dunkel", "graphit", "smaragd"]) assert.doesNotMatch(svgs[`kortex-${n}.svg`], /fill="url\(#grund\)" stroke=/, n);
});

test("die Einstellung appSymbol kennt genau die Namen der Paletten, Standard ist standard", () => {
  assert.deepEqual(NAMEN, ["standard", "dunkel", "graphit", "papier", "smaragd"]);
  assert.deepEqual(APP_SCHEMA.appSymbol.werte, NAMEN);
  assert.equal(APP_SCHEMA.appSymbol.standard, "standard");
  assert.ok(istGueltig(APP_SCHEMA.appSymbol, "papier"));
  assert.ok(!istGueltig(APP_SCHEMA.appSymbol, "pink"));
  assert.ok(PALETTEN.standard === null);
});

test("Swift kennt dieselben Namen", () => {
  const swift = readFileSync(join(W, "Sources", "BrainCore", "AppSymbol.swift"), "utf8");
  const faelle = swift.match(/^\s*case ([a-z, ]+)$/m)[1].split(",").map((x) => x.trim());
  assert.deepEqual(faelle, NAMEN);
});
