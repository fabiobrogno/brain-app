// Suche der Seite „Einstellungen“ (Paket P5): Wertung nach Orca (genau / beginnt mit / enthält je Feld; Bereichsname 900 > Titel 700 > Beschreibung 500 > Stichwörter 300),
// Umlaute und Groß/Klein egal, mehrere Wörter, Markierung (Stellen im Original), Zählung je Bereich, Vorschläge bei null Treffern, Register ohne Doppelte.
// Die Module der Oberfläche sind reine Funktionen ohne Import — sie werden hier direkt geladen (ES-Module im Studio-Ordner, der kein package.json hat).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pfad } from "./hilfe.mjs";

const laden = (name) => import("data:text/javascript;base64," + Buffer.from(readFileSync(pfad("studio", name))).toString("base64"));
const S = await laden("einstellungen-suche.js");
const { BEREICHE, GRUPPEN, STANDARD_VORSCHLAEGE } = await laden("texte-einstellungen.js");

// Die Zeilen des Bereichs „Tastenkürzel“ (ein Befehl je Zeile) kommen aus dem Register der Tastenkürzel und werden beim Öffnen der Seite eingehängt (einstellungen.js)
const KZ = await laden("tastenkuerzel-logik.js");
BEREICHE.find((b) => b.id === "tasten").abschnitte = KZ.abschnitteAusRegister(JSON.parse(readFileSync(pfad("gemeinsam", "tastenkuerzel-register.json"), "utf8")));

const bereich = (id) => BEREICHE.find((b) => b.id === id);
const zeile = (id) => { for (const b of BEREICHE) for (const a of b.abschnitte) for (const z of a.zeilen) if (z.id === id) return z; throw new Error(id); };

test("Register: Bereiche in vier Gruppen, eindeutige Zeilen-IDs, jede Zeile mit Titel; Schlüssel einfacher Zeilen kommen nur einmal vor", () => {
  assert.deepEqual(GRUPPEN, ["Kortex", "Wissen", "Verbindungen", "Mehr"]);
  assert.deepEqual(BEREICHE.map((b) => b.id), ["allgemein", "darstellung", "tasten", "mitteilungen", "vaults", "ki", "automatik", "sicherung", "mobil", "datenschutz", "erweitert", "ueber"]);
  for (const b of BEREICHE) assert.ok(GRUPPEN.includes(b.gruppe), b.id);
  const ids = [], schluessel = [];
  for (const b of BEREICHE) for (const a of b.abschnitte) for (const z of a.zeilen) {
    assert.ok(z.titel && /^[a-z0-9-]+$/.test(z.id), z.id);
    assert.ok(z.sonder || z.art, `${z.id}: ohne Art`);
    ids.push(z.id); if (z.schluessel) schluessel.push(z.schluessel);
  }
  assert.equal(new Set(ids).size, ids.length, "Zeilen-IDs doppelt");
  assert.equal(new Set(schluessel).size, schluessel.length, "Schlüssel doppelt");
  assert.equal(bereich("mobil").bald, true);
});

test("falte: klein, ohne Umlautpunkte, ß = ss; karte führt zurück ins Original", () => {
  assert.equal(S.normalisiere("Kürzel"), "kurzel");
  assert.equal(S.normalisiere("GRÖSSE Größe"), "grosse grosse");
  const { f, karte } = S.falte("Größe");
  assert.equal(f, "grosse");
  assert.deepEqual(karte, [0, 1, 2, 3, 3, 4]); // „ß“ (Index 3) wird zu „ss“, beide Zeichen zeigen auf Index 3
});

test("Wertung: Bereichsname > Titel > Beschreibung > Stichwort; genau > beginnt mit > enthält", () => {
  const vor = (q) => S.bereiteVor(q);
  const b = { name: "Darstellung" }, a = { titel: "Feinheiten" };
  const w = (q, z) => S.bewerteZeile(vor(q), b, a, { woerter: [], text: "", ...z }).wert;
  assert.equal(w("darstellung", { titel: "x" }), 900);                  // Bereichsname genau
  assert.equal(w("darst", { titel: "x" }), 850);                         // beginnt mit
  assert.equal(w("stellung", { titel: "x" }), 800);                      // enthält
  assert.equal(w("bewegung", { titel: "Bewegung" }), 700);
  assert.equal(w("bew", { titel: "Bewegung" }), 650);
  assert.equal(w("wegung", { titel: "Bewegung" }), 600);
  assert.equal(w("ruhig", { titel: "x", text: "ruhig" }), 500);
  assert.equal(w("ruh", { titel: "x", text: "ruhig bleiben" }), 450);
  assert.equal(w("bleiben", { titel: "x", text: "ruhig bleiben" }), 400);
  assert.equal(w("zoom", { titel: "x", woerter: ["zoom", "größe"] }), 300);
  assert.equal(w("zo", { titel: "x", woerter: ["zoom"] }), 250);
  assert.equal(w("oom", { titel: "x", woerter: ["zoom"] }), 200);
  assert.equal(w("nichts", { titel: "x", text: "y", woerter: ["z"] }), 0);
  // der höchste Wert gewinnt
  assert.equal(w("schrift", { titel: "Schrift", text: "schrift", woerter: ["schrift"] }), 700);
  // Titel einer Zwischenüberschrift zählt wie ein Stichwort
  assert.equal(S.bewerteZeile(vor("fein"), { name: "Z" }, a, { titel: "q", text: "", woerter: [] }).wert, 250);
  // mehrere Wörter: alle müssen vorkommen (150)
  assert.equal(w("ki kontingent", { titel: "KI-Kontingent fast aufgebraucht" }), 150);
  assert.equal(w("ki zebra", { titel: "KI-Kontingent fast aufgebraucht" }), 0);
});

test("Suche: Umlaute und Groß/Klein egal, Bereiche nach bestem Treffer sortiert, Zählung je Bereich", () => {
  const r = S.suche("kontingent", BEREICHE);
  assert.equal(r.leer, false);
  assert.ok(r.gesamt >= 1);
  const ids = r.bereiche.map((b) => b.id);
  assert.ok(ids.includes("mitteilungen"), "Mitteilungen: „KI-Kontingent fast aufgebraucht“");
  assert.equal(r.bereiche.find((b) => b.id === "mitteilungen").zeilen.has("m-kontingent"), true);
  for (let i = 1; i < r.bereiche.length; i++) assert.ok(r.bereiche[i - 1].wert >= r.bereiche[i].wert, "absteigend sortiert");
  assert.equal(r.gesamt, r.bereiche.reduce((n, b) => n + b.treffer, 0));
  for (const b of r.bereiche) assert.equal(b.treffer, b.zeilen.size);

  assert.deepEqual(S.suche("KÜRZEL", BEREICHE).bereiche[0].id, "tasten"); // Bereichsname „Tastenkürzel“ enthält „kürzel“, Stichwort „kürzel“
  assert.equal(S.suche("kurzel", BEREICHE).bereiche[0].id, "tasten");   // ohne Umlaut gleich
  // Passt der Bereichsname, gelten alle seine Zeilen als Treffer
  const d = S.suche("darstellung", BEREICHE).bereiche[0];
  assert.equal(d.id, "darstellung"); assert.equal(d.wert, 900);
  assert.equal(d.treffer, bereich("darstellung").abschnitte.reduce((n, a) => n + a.zeilen.length, 0));
  // Titel schlägt Beschreibung: „Tageslauf“ steht im Titel der Zeile „tageslauf“ (700) und nur in Texten anderer
  const t = S.suche("tageslauf", BEREICHE);
  assert.equal(t.bereiche[0].id, "automatik");
  assert.equal(t.bereiche[0].zeilen.get("tageslauf"), 700);
});

test("Suche: leer, nur Leerraum und zu langer Text; Länge auf 200 Zeichen begrenzt", () => {
  for (const q of ["", "   ", null, undefined]) { const r = S.suche(q, BEREICHE); assert.equal(r.leer, true); assert.equal(r.gesamt, 0); }
  assert.equal(S.bereiteVor("a".repeat(5000)).roh.length, S.MAX_SUCHE);
  assert.equal(S.bereiteVor("  hell   dunkel ").q, "hell dunkel");
  assert.equal(S.suche("x".repeat(300), BEREICHE).gesamt, 0);
});

test("null Treffer: gesamt 0; Vorschläge ähneln der Eingabe (Tippfehler), sonst die festen — immer Wörter, die es im Register gibt", () => {
  const r = S.suche("xyzzy", BEREICHE);
  assert.equal(r.gesamt, 0); assert.deepEqual(r.bereiche, []);
  assert.deepEqual(S.vorschlaege("xyzzy", BEREICHE, STANDARD_VORSCHLAEGE), STANDARD_VORSCHLAEGE);
  const v = S.vorschlaege("kontinget", BEREICHE, STANDARD_VORSCHLAEGE);
  assert.ok(v.length >= 1 && v.length <= 4);
  assert.match(v[0], /^kontingent/i);
  assert.ok(S.vorschlaege("zzz", BEREICHE, STANDARD_VORSCHLAEGE).length <= 4);
  // die festen Vorschläge finden wirklich etwas
  for (const w of STANDARD_VORSCHLAEGE) assert.ok(S.suche(w, BEREICHE).gesamt > 0, w);
});

test("Markierung: Stellen im Original (auch bei ß und Umlauten), ganzer Suchtext oder einzelne Wörter, zusammengefasst", () => {
  const vor = S.bereiteVor("kontingent");
  assert.deepEqual(S.markierungen("KI-Kontingent fast aufgebraucht", vor), [[3, 13]]);
  assert.deepEqual(S.zerlege("KI-Kontingent fast", vor), [{ text: "KI-", treffer: false }, { text: "Kontingent", treffer: true }, { text: " fast", treffer: false }]);
  assert.deepEqual(S.markierungen("Größe der Schrift", S.bereiteVor("grosse")), [[0, 5]]); // „Größe“ (5 Zeichen) = „grosse“ (6)
  assert.deepEqual(S.markierungen("Kürzel ändern", S.bereiteVor("kurzel")), [[0, 6]]);
  assert.deepEqual(S.markierungen("a ki kontingent b", S.bereiteVor("ki kontingent")), [[2, 15]]);          // ganzer Suchtext
  assert.deepEqual(S.markierungen("Kontingent der KI", S.bereiteVor("ki kontingent")), [[0, 10], [15, 17]]); // sonst Wort für Wort
  assert.deepEqual(S.markierungen("kontingent kontingent", vor), [[0, 10], [11, 21]]);                        // alle Vorkommen
  assert.deepEqual(S.markierungen("nichts", vor), []);
  assert.deepEqual(S.zerlege("nichts", vor), [{ text: "nichts", treffer: false }]);
  assert.deepEqual(S.markierungen("", vor), []);
});
