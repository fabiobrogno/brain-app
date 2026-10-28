// .tools/tests/test-pflege-neue-seiten.mjs — B3 Task 9: Häufung im Wartebereich → Haiku-Entwurf → Node schreibt Seite + Belege.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { isoliere, git, fakeKi, KIT } from "./tageslauf-hilfe.mjs";
import { neuerPflegeVault } from "./pflege-hilfe.mjs";
import { SEITEN, warte, pizza, ENTWURF, lauf } from "./neue-seiten-hilfe.mjs";
const N = await import("../tageslauf/neue-seiten.mjs");
const P = await import("../tageslauf/pflege-kopie.mjs");
const { verwerfeArbeitskopie } = await import("../tageslauf/arbeitskopie.mjs");
const { leseStand } = await import("../tageslauf/pflege-stand.mjs");
isoliere();

test("Häufung (3 Fakten, 2 Sitzungen) → Seite im Bereich mit Fakt-Zeilen + Belegen, ein Commit; nach dem Merge Vorschläge archiviert", async () => {
  const v = neuerPflegeVault({ seiten: SEITEN });
  pizza(v);
  const h = fakeKi([{ wenn: "THEMA-WORT: Pizzaofen", antwort: `Entwurf:\n${JSON.stringify(ENTWURF)}` }]);
  const { ctx, kopie, posten } = await lauf(v);
  assert.equal(h.anzahl(), 1);
  assert.equal(posten.length, 1);
  const [p] = posten;
  assert.equal(p.erg.ok, true, JSON.stringify(p.erg));
  assert.equal(p.ziel, "09_wiki/wissen/thema_pizzaofen.md");          // Dateiname mit Typ-Präfix wie im Schema
  const t = readFileSync(join(kopie.pfad, p.ziel), "utf8");
  assert.match(t, /^name: pizzaofen$/m);
  assert.match(t, /^description: "Der Pizzaofen im Garten: Temperatur, Holz, Backzeit\."$/m);
  assert.match(t, /^typ: thema$/m);
  assert.match(t, /^rev: 1$/m);
  assert.match(t, /^fragen: \["Wie heiß wird der Pizzaofen\?","Welches Holz für den Pizzaofen\?"\]$/m);
  assert.match(t, /^quellen: \["30_wissen\/belege\/2026-10\/v-pizza-1\.md","30_wissen\/belege\/2026-10\/v-pizza-2\.md","30_wissen\/belege\/2026-10\/v-pizza-3\.md"\]$/m);
  assert.match(t, /\n# Pizzaofen\n/);
  assert.match(t, /^- Der Pizzaofen heizt auf 450 Grad\. · Stand 20\.10\.2026 · \[\[30_wissen\/belege\/2026-10\/v-pizza-1\]\]$/m);
  assert.doesNotMatch(t, /Mimi/);
  for (const n of [1, 2, 3]) assert.match(readFileSync(join(kopie.pfad, `30_wissen/belege/2026-10/v-pizza-${n}.md`), "utf8"), /^typ: beleg$/m);
  assert.match(git(kopie.pfad, "log", "-1", "--format=%s"), /^pflege\(\d{8}-\d{6}\): neue-seite pizzaofen \[neue-seite-pizzaofen\]$/);
  assert.deepEqual(git(kopie.pfad, "show", "--name-only", "--format=", "HEAD").split("\n").sort(),
    ["09_wiki/_log.md", "09_wiki/wissen/thema_pizzaofen.md", ...[1, 2, 3].map((i) => `30_wissen/belege/2026-10/v-pizza-${i}.md`)].sort());
  assert.deepEqual(ctx.pflegeInfo.neueSeiten, { haeufungen: 1, uebersprungen: 0 });
  // Schema-konform: der echte Struktur-Lint (blockierende Prüfungen) findet an der Arbeitskopie nichts
  const lint = execFileSync(process.execPath, [join(KIT, "brain-lint.mjs"), kopie.pfad, "--struktur"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.doesNotMatch(lint, /FAKT-BELEG|FRAGEN|ALIAS|KRITISCH|TOTER LINK|QUELLE/i);
  assert.equal(P.uebernehmePflege(ctx, kopie).ok, true);
  const n = p.nachMerge("x");
  assert.deepEqual(n.vorschlaege.sort(), [1, 2, 3].map((i) => `90_archiv/vorschlaege-uebernommen/v-pizza-${i}.md`));
  assert.ok(existsSync(join(v, "00_inbox/_warten/v-katze.md")));
  assert.equal(existsSync(join(v, "00_inbox/_warten/v-pizza-1.md")), false);
  assert.match(git(v, "log", "-1", "--format=%s", "main"), /neue-seite pizzaofen/);
  verwerfeArbeitskopie(v, kopie);
});

test("keine Häufung: eine Sitzung, nur zwei Fakten, falsche Herkunft, anderer Wartegrund, ohne Zitat — 0 KI-Aufrufe", async () => {
  const faelle = [
    (v) => { warte(v, "a1", "Pizzaofen A", "Pizzaofen eins.", "s1"); warte(v, "a2", "Pizzaofen B", "Pizzaofen zwei.", "s1"); warte(v, "a3", "Pizzaofen C", "Pizzaofen drei.", "s1"); },
    (v) => { warte(v, "b1", "Pizzaofen A", "Pizzaofen eins.", "s1"); warte(v, "b2", "Pizzaofen B", "Pizzaofen zwei.", "s2"); },
    (v) => pizza(v, { herkunft: "ki" }),
    (v) => pizza(v, { warten_grund: "mehrdeutig" }),
    (v) => pizza(v, { zitat: "" }),
  ];
  for (const f of faelle) {
    const v = neuerPflegeVault({ seiten: SEITEN });
    f(v);
    const h = fakeKi([], { standard: JSON.stringify(ENTWURF) });
    const { kopie, posten } = await lauf(v);
    assert.deepEqual(posten, []);
    assert.equal(h.anzahl(), 0);
    verwerfeArbeitskopie(v, kopie);
  }
});

test("passt nicht → 30 Tage Ruhe für genau diese Häufung; Autostufe eng → gar nicht", async () => {
  const v = neuerPflegeVault({ seiten: SEITEN });
  pizza(v);
  const h = fakeKi([], { standard: '{"passt":false,"grund":"verschiedene Themen"}' });
  let r = await lauf(v);
  assert.equal(r.posten[0].erg.grund, "passt-nicht");
  assert.equal(leseStand(v).haeufungen.pizzaof, r.ctx.heute);
  verwerfeArbeitskopie(v, r.kopie);
  r = await lauf(v, { tag: 1 });
  assert.deepEqual(r.posten, []);
  verwerfeArbeitskopie(v, r.kopie);
  r = await lauf(v, { tag: 31, autostufe: "eng" });
  assert.deepEqual(r.posten, []);
  assert.equal(h.anzahl(), 1);
  verwerfeArbeitskopie(v, r.kopie);
});

test("Entwurf geprüft: Name vergeben, Bereich unbekannt, Zugangsdaten, kaputter Name → kein Commit", async () => {
  const schlecht = [
    [{ ...ENTWURF, name: "kaffee" }, "name-vergeben"],
    [{ ...ENTWURF, bereich: "gibt-es-nicht" }, "entwurf-ungueltig"],
    [{ ...ENTWURF, description: "Das Kenn" + "wort lautet: Wolke7Blau" }, "entwurf-ungueltig"],
    [{ ...ENTWURF, name: "../boese" }, "entwurf-ungueltig"],
  ];
  for (const [entwurf, grund] of schlecht) {
    const v = neuerPflegeVault({ seiten: SEITEN });
    pizza(v);
    fakeKi([], { standard: JSON.stringify(entwurf) });
    const { kopie, posten } = await lauf(v);
    assert.equal(posten[0].erg.grund, grund, JSON.stringify(entwurf));
    assert.equal(git(kopie.pfad, "log", "-1", "--format=%s"), "start");
    verwerfeArbeitskopie(v, kopie);
  }
  assert.deepEqual(N.bereiche(neuerPflegeVault({ seiten: SEITEN })), ["wissen"]);
  assert.equal(N.themenWoerter("Der Pizzaofen heizt; die Pizzaöfen 2026").has("pizzaof"), true);
});
