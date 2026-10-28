// .tools/tests/test-einstellungen-thema.mjs — Einstellung automatik.ernteOhneThema (Wortliste, Standard []): Schema, Lesen (großzügig,
// damit ein Tippfehler den Schutz nie abschaltet), Schreiben (streng, 400), `brain einstellungen`. Nur neutrale Wörter.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SCHEMA, STANDARD, leseAutomatik, schreibeAutomatik } from "../einstellungen.mjs";

const KIT = join(dirname(fileURLToPath(import.meta.url)), "..");
const neu = () => { const v = join(mkdtempSync(join(tmpdir(), "brain thema ")), "Mein Brain"); mkdirSync(v); return v; };
const configPfad = (v) => join(v, "brain.config.json");
const schreibeConfig = (v, obj) => writeFileSync(configPfad(v), JSON.stringify(obj, null, 2) + "\n");
const config = (v) => JSON.parse(readFileSync(configPfad(v), "utf8"));
const lauf = (v, ...a) => spawnSync(process.execPath, [join(KIT, "brain.mjs"), "einstellungen", ...a], { encoding: "utf8", env: { ...process.env, BRAIN_VAULT: v } });

test("Schema: ernteOhneThema ist eine Wortliste mit leerem Standard", () => {
  assert.deepEqual(SCHEMA.ernteOhneThema, { typ: "wortliste", standard: [] });
  assert.deepEqual(STANDARD.ernteOhneThema, []);
  assert.deepEqual(leseAutomatik(neu()).werte.ernteOhneThema, [], "ohne Config: keine Wörter");
});

test("lesen: Liste, ein einzelner Text und lange Listen werden großzügig gelesen (getrimmt, ohne Dubletten) — Unsinn ergibt []", () => {
  const liest = (roh) => { const v = neu(); schreibeConfig(v, { automatik: { ernteOhneThema: roh } }); return leseAutomatik(v).werte.ernteOhneThema; };
  assert.deepEqual(liest(["zebra", "giraffe"]), ["zebra", "giraffe"]);
  assert.deepEqual(liest(["  zebra ", "ZEBRA", "", "giraffe"]), ["zebra", "giraffe"]);
  assert.deepEqual(liest("zebra"), ["zebra"], "ein Text statt einer Liste schaltet den Schutz nicht ab");
  assert.equal(liest(Array.from({ length: 80 }, (_, i) => `wort${i}`)).length, 80, "mehr als die 50 der Maske: trotzdem alle gelesen");
  assert.deepEqual(liest(["x".repeat(90)]), ["x".repeat(90)], "ein langes Wort wird gelesen");
  assert.deepEqual(liest(["zebra", 7, null, ["okapi"]]), ["zebra"]);
  for (const unsinn of [7, true, null, {}, 1.5]) assert.deepEqual(liest(unsinn), [], JSON.stringify(unsinn));
});

test("schreiben: gültige Liste wird bereinigt gespeichert, null entfernt den Schlüssel", () => {
  const v = neu(); schreibeConfig(v, { zebra: 1 });
  const e1 = schreibeAutomatik(v, { ernteOhneThema: ["zebra", " Giraffe ", "weißes   Zebra", "ZEBRA"] }, leseAutomatik(v).stand);
  assert.deepEqual(config(v).automatik.ernteOhneThema, ["zebra", "Giraffe", "weißes Zebra"]);
  assert.deepEqual(leseAutomatik(v).werte.ernteOhneThema, ["zebra", "Giraffe", "weißes Zebra"]);
  assert.equal(config(v).zebra, 1, "übrige Abschnitte bleiben");
  const grenze = Array.from({ length: 50 }, (_, i) => `${String(i).padStart(2, "0")}${"ä".repeat(58)}`);
  const e2 = schreibeAutomatik(v, { ernteOhneThema: grenze }, e1.stand);
  assert.equal(config(v).automatik.ernteOhneThema.length, 50, "50 Wörter zu 60 Zeichen gehen");
  schreibeAutomatik(v, { ernteOhneThema: [] }, e2.stand);
  assert.deepEqual(config(v).automatik.ernteOhneThema, [], "leere Liste ist erlaubt");
  schreibeAutomatik(v, { ernteOhneThema: null }, leseAutomatik(v).stand);
  assert.ok(!("ernteOhneThema" in config(v).automatik), "null löscht");
  assert.deepEqual(leseAutomatik(v).werte.ernteOhneThema, []);
});

test("schreiben: ungültige Werte → 400 mit Alltagsmeldung, nichts wird geschrieben", () => {
  const v = neu(); schreibeConfig(v, { zebra: 1 });
  const stand = leseAutomatik(v).stand;
  const schlecht = ["zebra", 7, true, {}, [1, 2], [""], ["   "], ["zebra", null], ["x".repeat(61)], Array.from({ length: 51 }, (_, i) => `w${i}`), ["ze\u0000bra"], ["ze\nbra"], [["zebra"]]];
  for (const s of schlecht) {
    assert.throws(() => schreibeAutomatik(v, { ernteOhneThema: s }, stand), (e) => e.code === 400 && /Ungültiger Wert für „ernteOhneThema"/.test(e.message), JSON.stringify(s).slice(0, 50));
  }
  assert.equal(config(v).automatik, undefined, "nichts geschrieben");
});

test("ein handgeschriebener Eintrag (Text statt Liste, 80 Wörter) bleibt erhalten, wenn eine andere Einstellung gespeichert wird", () => {
  const v = neu();
  schreibeConfig(v, { automatik: { ernteOhneThema: "zebra" } });
  schreibeAutomatik(v, { luecken: true }, leseAutomatik(v).stand);
  assert.deepEqual(config(v).automatik.ernteOhneThema, ["zebra"], "wird als Liste bewahrt, nicht verworfen");
  const viele = Array.from({ length: 80 }, (_, i) => `wort${i}`);
  schreibeConfig(v, { automatik: { ernteOhneThema: viele } });
  schreibeAutomatik(v, { luecken: false }, leseAutomatik(v).stand);
  assert.equal(config(v).automatik.ernteOhneThema.length, 80);
});

test("brain einstellungen: ernteOhneThema= trennt mit ; oder Komma oder Zeilenumbruch, += hängt an, JSON-Liste geht, =null löscht", () => {
  const v = neu(); schreibeConfig(v, {});
  const liste = () => config(v).automatik.ernteOhneThema;
  assert.equal(lauf(v, "ernteOhneThema=zebra;giraffe").status, 0);
  assert.deepEqual(liste(), ["zebra", "giraffe"]);
  assert.equal(lauf(v, "ernteOhneThema+=okapi").status, 0);
  assert.deepEqual(liste(), ["zebra", "giraffe", "okapi"]);
  assert.equal(lauf(v, "ernteOhneThema+=gnu, weißes zebra").status, 0);
  assert.deepEqual(liste(), ["zebra", "giraffe", "okapi", "gnu", "weißes zebra"], "Komma trennt, Leerzeichen im Begriff bleiben");
  assert.equal(lauf(v, "ernteOhneThema=[\"tapir\", \"a, b\"]").status, 0);
  assert.deepEqual(liste(), ["tapir", "a, b"], "JSON-Liste: Komma im Wort erlaubt");
  assert.equal(lauf(v, "ernteOhneThema=eins\nzwei").status, 0);
  assert.deepEqual(liste(), ["eins", "zwei"]);
  const aus = lauf(v);
  assert.equal(aus.status, 0);
  assert.match(aus.stdout, /^ernteOhneThema=\["eins","zwei"\]$/m, "ohne Argumente werden die Werte aufgelistet");
  assert.equal(lauf(v, "ernteOhneThema=null").status, 0);
  assert.ok(!("ernteOhneThema" in config(v).automatik));
});

test("brain einstellungen: Unsinn wird mit der Alltagsmeldung abgelehnt und ändert nichts", () => {
  const v = neu(); schreibeConfig(v, { automatik: { ernteOhneThema: ["zebra"] } });
  const lang = lauf(v, `ernteOhneThema=${"x".repeat(61)}`);
  assert.notEqual(lang.status, 0);
  assert.match(lang.stderr, /Ungültiger Wert für „ernteOhneThema"/);
  const viele = lauf(v, `ernteOhneThema=${Array.from({ length: 51 }, (_, i) => `w${i}`).join(";")}`);
  assert.notEqual(viele.status, 0);
  assert.deepEqual(config(v).automatik.ernteOhneThema, ["zebra"], "unverändert");
});
