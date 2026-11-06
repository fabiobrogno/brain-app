// Zurück und Vor (studio/seitenverlauf.js): das Modell der geöffneten Notizen — wie im Browser, mit Entwurf, toten Einträgen und Umbenennen. Reine Logik.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pfad } from "./hilfe.mjs";

const laden = (name) => import("data:text/javascript;base64," + Buffer.from(readFileSync(pfad("studio", name))).toString("base64"));
const { erzeugeSeitenverlauf } = await laden("seitenverlauf.js");
const neu = (...pfade) => { const v = erzeugeSeitenverlauf(); pfade.forEach((p) => v.betreten(p)); return v; };
const liste = (v) => v.zustandJetzt().liste;

test("Zurück und Vor wandern durch die Liste; an den Enden gibt es nichts", () => {
  const v = neu("a", "b", "c");
  assert.deepEqual([v.kannZurueck(), v.kannVor()], [true, false]);
  assert.equal(v.gehe(-1).pfad, "b");
  assert.equal(v.gehe(-1).pfad, "a");
  assert.equal(v.gehe(-1), null);
  assert.deepEqual([v.kannZurueck(), v.kannVor()], [false, true]);
  assert.equal(v.gehe(1).pfad, "b");
  assert.equal(v.gehe(1).pfad, "c");
  assert.equal(v.gehe(1), null);
  assert.equal(neu().gehe(-1), null);
});

test("Eine neue Notiz nach „Zurück“ schneidet „Vor“ ab; dieselbe Notiz zweimal hintereinander ergibt einen Eintrag", () => {
  const v = neu("a", "b", "c");
  v.gehe(-1); v.gehe(-1);
  v.betreten("d");
  assert.deepEqual(liste(v), ["a", "d"]);
  assert.equal(v.kannVor(), false);
  v.betreten("d");
  assert.deepEqual(liste(v), ["a", "d"]);
});

test("Cursor und Scrollposition werden je Eintrag gemerkt und kommen mit dem Eintrag zurück", () => {
  const v = neu("a", "b");
  v.verlassen("b", { anker: 5, kopf: 9, scroll: 120 });
  v.verlassen("a", { anker: 1, kopf: 1, scroll: 0 }); // gehört nicht zur aktuellen Stelle: ignoriert
  const e = v.gehe(-1);
  assert.equal(e.pfad, "a");
  assert.equal(e.zustand, null);
  v.verlassen("a", { anker: 7, kopf: 7, scroll: 300 });
  assert.deepEqual(v.gehe(1).zustand, { anker: 5, kopf: 9, scroll: 120 });
  assert.deepEqual(v.bei(0).zustand, { anker: 7, kopf: 7, scroll: 300 });
});

test("Entwurf: „Zurück“ führt zur Notiz, von der man kam; „Vor“ gibt es dort nicht; ein Entwurf schneidet ab", () => {
  const v = neu("a", "b", "c");
  v.gehe(-1); // bei b, c liegt vor uns
  v.betreteEntwurf();
  assert.equal(v.kannVor(), false, "hinter dem Entwurf bleibt nichts als Vor stehen");
  assert.deepEqual(liste(v), ["a", "b"]);
  assert.equal(v.kannZurueck(), true);
  assert.equal(v.naechster(-1).pfad, "b", "aus dem Entwurf zurück = die Notiz davor");
  assert.equal(v.gehe(-1).pfad, "b");
  assert.equal(v.gehe(-1).pfad, "a");
  // Entwurf wird zur Datei: ein neuer Eintrag hinter der Stelle
  const w = neu("a");
  w.betreteEntwurf();
  w.betreten("neu");
  assert.deepEqual(liste(w), ["a", "neu"]);
  assert.equal(w.gehe(-1).pfad, "a");
  // Entwurf ganz ohne Vorgeschichte: nichts zum Zurückgehen
  const leer = erzeugeSeitenverlauf();
  leer.betreteEntwurf();
  assert.equal(leer.kannZurueck(), false);
});

test("Tote Einträge fallen beim Springen lautlos weg, in beiden Richtungen und auch im Entwurf", () => {
  const da = (p) => p !== "b" && p !== "d";
  const v = neu("a", "b", "c");
  assert.equal(v.gehe(-1, da).pfad, "a", "b fehlt: weiter bis a");
  assert.deepEqual(liste(v), ["a", "c"]);
  assert.equal(v.zustandJetzt().idx, 0);
  assert.equal(v.gehe(1, da).pfad, "c");
  const w = neu("a", "b", "c", "d", "e");
  w.gehe(-1); w.gehe(-1); w.gehe(-1); w.gehe(-1); // bei a
  assert.equal(w.gehe(1, da).pfad, "c", "vor: b fehlt");
  assert.equal(w.gehe(1, da).pfad, "e", "vor: d fehlt");
  assert.deepEqual(liste(w), ["a", "c", "e"]);
  // nur Tote in dieser Richtung: null, der Verlauf bleibt heil
  const x = neu("b", "d", "a");
  assert.equal(x.gehe(-1, da), null);
  assert.deepEqual(liste(x), ["a"]);
  assert.equal(x.zustandJetzt().idx, 0);
  // im Entwurf: die Notiz davor ist weg → die davor
  const y = neu("a", "b");
  y.betreteEntwurf();
  assert.equal(y.gehe(-1, (p) => p !== "b").pfad, "a");
});

test("springe: direkt zu einer Stelle der Liste (Rechtsklick auf Zurück/Vor); eine tote Stelle wird entfernt", () => {
  const v = neu("a", "b", "c", "d");
  assert.equal(v.springe(1).pfad, "b");
  assert.equal(v.zustandJetzt().idx, 1);
  assert.equal(v.springe(9), null);
  assert.equal(v.springe(3, (p) => p !== "d"), null);
  assert.deepEqual(liste(v), ["a", "b", "c"]);
});

test("Aufzählung für das Menü: neueste zuerst, nur in der gefragten Richtung", () => {
  const v = neu("a", "b", "c", "d");
  v.gehe(-1); // bei c
  assert.deepEqual(v.aufzaehlen(-1), [{ i: 1, pfad: "b" }, { i: 0, pfad: "a" }]);
  assert.deepEqual(v.aufzaehlen(1), [{ i: 3, pfad: "d" }]);
  v.betreteEntwurf();
  assert.deepEqual(v.aufzaehlen(-1).map((x) => x.pfad), ["c", "b", "a"]);
  assert.deepEqual(v.aufzaehlen(1), []);
});

test("Umbenennen und Verschieben: der Eintrag folgt, auch bei Ordnern; Entfernen schließt die Lücke", () => {
  const v = neu("n/a.md", "n/b.md", "x.md");
  v.umbenannt("n/a.md", "n/neu.md");
  assert.deepEqual(liste(v), ["n/neu.md", "n/b.md", "x.md"]);
  v.ordnerUmbenannt("n", "m/n2");
  assert.deepEqual(liste(v), ["m/n2/neu.md", "m/n2/b.md", "x.md"]);
  v.ordnerUmbenannt("m/n", "zz"); // „m/n2“ beginnt mit „m/n“, ist aber ein anderer Ordner
  assert.deepEqual(liste(v), ["m/n2/neu.md", "m/n2/b.md", "x.md"]);
  assert.equal(v.entferne("m/n2/b.md"), true);
  assert.deepEqual(liste(v), ["m/n2/neu.md", "x.md"]);
  assert.equal(v.zustandJetzt().idx, 1);
  assert.equal(v.entferne("gibt-es-nicht"), false);
  // zwei gleiche Nachbarn werden zusammengelegt
  const z = neu("a", "x", "a");
  z.entferne("x");
  assert.deepEqual(liste(z), ["a"], "A, X, A → ohne X nur noch ein A");
});

test("Der Verlauf ist begrenzt und lässt sich leeren (Vault-Wechsel)", () => {
  const v = erzeugeSeitenverlauf({ max: 3 });
  ["a", "b", "c", "d", "e"].forEach((p) => v.betreten(p));
  assert.deepEqual(liste(v), ["c", "d", "e"]);
  assert.equal(v.zustandJetzt().idx, 2);
  v.leeren();
  assert.deepEqual(v.zustandJetzt(), { liste: [], idx: -1, entwurf: false });
  assert.equal(v.kannZurueck(), false);
});
