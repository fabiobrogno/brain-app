// Darstellung: Schema der App-Einstellungen (Standardwerte, Gültigkeit, Migration) und die reine Logik in studio/darstellung.js.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APP_SCHEMA, APP_STANDARD, istGueltig, leseApp, schreibeApp, pruefeApp, migriere } from "../../Ressourcen/gemeinsam/app-einstellungen.mjs";
import * as D from "../../Ressourcen/studio/darstellung.js";

const support = () => mkdtempSync(join(tmpdir(), "brain-darst-"));

test("Standardwerte der Darstellung und Listen stimmen mit dem Studio überein", () => {
  for (const k of D.DARSTELLUNGS_SCHLUESSEL) assert.deepEqual(APP_STANDARD[k], D.STANDARD[k], `Standard ${k}`);
  assert.deepEqual(APP_SCHEMA.akzent.werte, D.AKZENTE.map((a) => a[0]));
  assert.deepEqual(APP_SCHEMA.schemaHell.werte, D.SCHEMATA.hell.map((s) => s[0]));
  assert.deepEqual(APP_SCHEMA.schemaDunkel.werte, D.SCHEMATA.dunkel.map((s) => s[0]));
  assert.deepEqual(APP_SCHEMA.erscheinung.werte.slice().sort(), D.ERSCHEINUNGEN.slice().sort());
  assert.deepEqual(APP_SCHEMA.oberflaeche.werte, D.OBERFLAECHEN);
  assert.deepEqual(APP_SCHEMA.zeilenbreite.werte, Object.keys(D.BREITEN));
  assert.deepEqual(APP_SCHEMA.editorSchrift.werte, Object.keys(D.EDITOR_SCHRIFTEN));
  assert.deepEqual(APP_SCHEMA.codeSchrift.werte, Object.keys(D.CODE_SCHRIFTEN));
  assert.equal(APP_SCHEMA.schriftgroesse.min, D.SCHRIFT_GROESSE.min);
  assert.equal(APP_SCHEMA.schriftgroesse.max, D.SCHRIFT_GROESSE.max);
  assert.equal(APP_SCHEMA.dichte.max + 1, D.ZEILE.length);
  assert.equal(D.ZEILE.length, D.INNEN.length); assert.equal(D.ZEILE.length, D.ZEILENABSTAND.length);
});

test("Prüfung: ungültige Werte werden abgelehnt, null setzt zurück", () => {
  const gut = { akzent: "rot", dichte: 4, oberflaeche: 125, symbole: "farbig", seitenleisteDurchscheinend: false };
  assert.deepEqual(pruefeApp(gut), gut);
  for (const schlecht of [{ akzent: "pink" }, { dichte: 5 }, { dichte: 1.5 }, { oberflaeche: 105 }, { oberflaeche: "100" }, { schriftgroesse: 11 }, { schriftgroesse: 23 }, { zeilenbreite: "riesig" }, { schemaHell: "graphit" }, { schemaDunkel: "papier" }, { symbole: "bunt" }, { seitenleisteDurchscheinend: "ja" }, { erscheinung: "auto" }])
    assert.throws(() => pruefeApp(schlecht), (e) => e.status === 400, JSON.stringify(schlecht));
  assert.deepEqual(pruefeApp({ akzent: null, dichte: null }), { akzent: null, dichte: null });
});

test("Lesen: Standardwerte ohne Datei, ungültige Werte fallen auf den Standard, Gültiges bleibt", () => {
  const s = support();
  assert.equal(leseApp(s).werte.akzent, "indigo");
  writeFileSync(join(s, "einstellungen.json"), JSON.stringify({ akzent: "gruen", dichte: 9, schemaDunkel: "mitternacht", oberflaeche: 110, schriftgroesse: 12, zeilenbreite: "klein", unbekannt: 1 }));
  const r = leseApp(s);
  assert.equal(r.fehler, null);
  assert.equal(r.werte.akzent, "gruen"); assert.equal(r.werte.dichte, 2); assert.equal(r.werte.schemaDunkel, "mitternacht");
  assert.equal(r.werte.oberflaeche, 110); assert.equal(r.werte.schriftgroesse, 12); assert.equal(r.werte.zeilenbreite, "normal");
  assert.deepEqual(Object.keys(r.gespeichert).sort(), ["akzent", "oberflaeche", "schemaDunkel", "schriftgroesse"]);
});

test("Migration: alte und gleichwertige Schreibweisen werden beim Lesen übernommen, beim Schreiben nur das Neue gespeichert", () => {
  assert.deepEqual(migriere({ breit: true }), { zeilenbreite: "breit" });
  assert.deepEqual(migriere({ breit: true, zeilenbreite: "voll" }), { zeilenbreite: "voll" });
  assert.deepEqual(migriere({ thema: "dunkel" }), { erscheinung: "dunkel" });
  assert.deepEqual(migriere({ editorSchrift: "ny", codeSchrift: "sf", symbole: "color" }), { editorSchrift: "serif", codeSchrift: "system", symbole: "farbig" });
  const s = support();
  writeFileSync(join(s, "einstellungen.json"), JSON.stringify({ breit: true, thema: "hell", editorSchrift: "sf" }));
  const r = leseApp(s);
  assert.equal(r.werte.zeilenbreite, "breit"); assert.equal(r.werte.erscheinung, "hell"); assert.equal(r.werte.editorSchrift, "mono");
  schreibeApp(s, { akzent: "rot" }, r.stand);
  assert.deepEqual(JSON.parse(readFileSync(join(s, "einstellungen.json"), "utf8")), { zeilenbreite: "breit", erscheinung: "hell", editorSchrift: "mono", akzent: "rot" });
});

test("Rücksetzen der Darstellung entfernt nur ihre Schlüssel", () => {
  const s = support();
  writeFileSync(join(s, "einstellungen.json"), JSON.stringify({ akzent: "rot", dichte: 0, appSymbol: "papier", mitteilungenTon: true }));
  const r = leseApp(s);
  schreibeApp(s, Object.fromEntries(D.DARSTELLUNGS_SCHLUESSEL.map((k) => [k, null])), r.stand);
  assert.deepEqual(JSON.parse(readFileSync(join(s, "einstellungen.json"), "utf8")), { appSymbol: "papier", mitteilungenTon: true });
});

test("berechne: Palette, Modus, Akzent, Dichte, Breite, Schrift, Größe", () => {
  const p = D.berechne({ erscheinung: "system", schemaDunkel: "graphit", akzent: "blau", dichte: 4, zeilenbreite: "voll", editorSchrift: "serif", schriftgroesse: 20, oberflaeche: 125, codeSchrift: "menlo", symbole: "farbig" }, { systemDunkel: true });
  assert.equal(p.pal, "dunkel-graphit"); assert.equal(p.modus, "dunkel"); assert.equal(p.theme, null);
  assert.equal(p.variablen["--akzent"], "#7aa7ff");
  assert.equal(p.variablen["--zeile"], "34px"); assert.equal(p.variablen["--innen"], "17px"); assert.equal(p.variablen["--ed-zeilenabstand"], "1.9");
  assert.equal(p.variablen["--lesebreite-wahl"], "none"); assert.equal(p.variablen["--editor-schrift"], "20px"); assert.equal(p.variablen["--ui-zoom"], "1.25");
  assert.match(p.variablen["--schrift-text"], /ui-serif/); assert.match(p.variablen["--mono"], /^Menlo/);
  assert.equal(p.attribute["data-symbole"], "farbig");
  assert.equal(D.berechne({ erscheinung: "hell", schemaHell: "papier" }, { systemDunkel: true }).pal, "hell-papier");
  assert.equal(D.berechne({ erscheinung: "hell" }).theme, "light");
  assert.equal(D.berechne({ schemaDunkel: "kontrast", erscheinung: "dunkel", schriftgroesse: 99, dichte: 99, oberflaeche: 77 }).variablen["--editor-schrift"], "22px");
});

test("Systemschriften heißen auf anderen Systemen neutral", () => {
  assert.equal(D.EDITOR_SCHRIFTEN.serif.name(true), "New York"); assert.equal(D.EDITOR_SCHRIFTEN.serif.name(false), "Serif");
  assert.equal(D.EDITOR_SCHRIFTEN.mono.name(true), "SF Mono"); assert.equal(D.EDITOR_SCHRIFTEN.mono.name(false), "Mono");
  assert.equal(D.CODE_SCHRIFTEN.geist.name(false), "Geist Mono");
});

test("Text auf Akzent: jede Akzentfarbe in Hell und Dunkel ≥ 4,5:1 mit Schwarz oder Weiß", () => {
  for (const [id, , hell, dunkel] of D.AKZENTE) for (const f of [hell, dunkel]) {
    assert.ok(D.kontrast(f, D.textAufAkzent(f)) >= 4.5, `${id} ${f}`);
  }
});

test("Migration der alten Browserwahl: nur was noch auf dem Standard steht", () => {
  assert.deepEqual(D.migriereAlteWahl({ theme: "dunkel", breit: true }, {}), { erscheinung: "dunkel", zeilenbreite: "breit" });
  assert.deepEqual(D.migriereAlteWahl({ theme: "system", breit: false }, {}), {});
  assert.deepEqual(D.migriereAlteWahl({ theme: "dunkel", breit: true }, { erscheinung: "hell", zeilenbreite: "voll" }), {});
});

test("istGueltig kennt Zahlen in Wertelisten", () => {
  assert.ok(istGueltig(APP_SCHEMA.oberflaeche, 90)); assert.ok(!istGueltig(APP_SCHEMA.oberflaeche, 91));
});
