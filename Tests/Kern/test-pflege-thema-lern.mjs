// .tools/tests/test-pflege-thema-lern.mjs — B3 Task 11 (Zusatz): Themen-Guard und Lernmodus-Filter in den Schritten „neue Seiten“ und „Inbox“.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isoliere, fakeKi } from "./tageslauf-hilfe.mjs";
import { neuerPflegeVault, fakeSonnet } from "./pflege-hilfe.mjs";
import { SEITEN, pizza, ENTWURF, lauf } from "./neue-seiten-hilfe.mjs";
const { verwerfeArbeitskopie } = await import("../tageslauf/arbeitskopie.mjs");
const G = await import("../tageslauf/pflege-thema.mjs");
const N = await import("../tageslauf/neue-seiten.mjs");
isoliere();

test("neue Seiten: Fakten mit ausgeschlossenem Wort gehen nie an Haiku und zählen nicht für die Häufung", async () => {
  const v = neuerPflegeVault({ seiten: SEITEN, automatik: { tageslauf: "an", ernteOhneThema: ["Pizzaofen"] } });
  pizza(v);
  const h = fakeKi([], { standard: JSON.stringify(ENTWURF) });
  const { ctx, kopie, posten } = await lauf(v);
  assert.deepEqual(posten, []);
  assert.equal(h.anzahl(), 0);
  assert.equal(ctx.pflegeInfo.thema["thema-ausgeschlossen"], 3);
  verwerfeArbeitskopie(v, kopie);
});

test("neue Seiten im Lernmodus: ohne Lern-Hook nichts (Autostufe aus), mit Vorlege-Hook ein Posten mit Schlüssel; Freigaben-Durchgang nimmt nur Freigegebenes", async () => {
  const v = neuerPflegeVault({ seiten: SEITEN });
  pizza(v);
  fakeKi([], { standard: JSON.stringify(ENTWURF) });
  const a = await lauf(v, { autostufe: "aus" });
  assert.deepEqual(a.posten, []);
  verwerfeArbeitskopie(v, a.kopie);
  const b = await lauf(v, { autostufe: "aus", vorab: (c) => { c.pflegeLern = { modus: "vorlegen", nimm: () => true }; } });
  assert.equal(b.posten.length, 1);
  assert.equal(b.posten[0].erg.ok, true, JSON.stringify(b.posten[0].erg));
  assert.match(b.posten[0].lern.schluessel, /^neue-seite:/);
  assert.match(b.posten[0].lern.sha, /^[0-9a-f]{16}$/);
  verwerfeArbeitskopie(v, b.kopie);
  const c = await lauf(v, { autostufe: "aus", vorab: (x) => { x.pflegeLern = { modus: "freigaben", nimm: () => false }; } });
  assert.deepEqual(c.posten, []);
  verwerfeArbeitskopie(v, c.kopie);
});

test("pflegeGrund: Wort, Ordner, fail-closed ohne Einstellungen; hinzugefuegt liefert nur neue Zeilen", () => {
  const ctx = (werte) => ({ werte });
  assert.equal(G.pflegeGrund(ctx({ ernteOhneThema: ["Zebra"], ernteNichtIn: [] }), "ein Zebra"), G.GRUND_THEMA);
  assert.equal(G.pflegeGrund(ctx({ ernteOhneThema: ["Zebra"], ernteNichtIn: [] }), "ein Pferd"), null);
  assert.equal(G.pflegeGrund(ctx({ ernteOhneThema: [], ernteNichtIn: ["/mnt/privat"] }), "siehe /mnt/privat/a.txt"), G.GRUND_PFAD);
  assert.equal(G.pflegeGrund(ctx({ ernteOhneThema: [], ernteNichtIn: ["/mnt/privat"] }), "siehe docs/a.md"), null);
  assert.equal(G.pflegeGrund({}, "irgendwas"), G.GRUND_CONFIG);
  assert.equal(G.pflegeGrund(ctx({ ernteOhneThema: "Zebra", ernteNichtIn: [] }), "x"), G.GRUND_CONFIG);
  assert.equal(G.hinzugefuegt("a\nb\n", "a\nb\nc\n\nd"), "c\nd");
  assert.ok(N.WARTE_GRUENDE.length > 0);
});
