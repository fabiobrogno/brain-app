// .tools/tests/test-pflege-neue-seiten-schutz.mjs — B3 Task 9, Schutz: keine neuen Seiten für heikle Fakten, nie als Dublette
// (Seite, Dateiname, Überschrift, Alias), nie bei kritisch-Kollision; Wartegrund „seite-passt-nicht“; Budget, Probe, Auswahl.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { isoliere, git, fakeKi } from "./tageslauf-hilfe.mjs";
import { neuerPflegeVault, seite } from "./pflege-hilfe.mjs";
import { SEITEN, warte, pizza, ENTWURF, lauf } from "./neue-seiten-hilfe.mjs";
const N = await import("../tageslauf/neue-seiten.mjs");
const P = await import("../tageslauf/pflege-kopie.mjs");
const { verwerfeArbeitskopie } = await import("../tageslauf/arbeitskopie.mjs");
const { neuesPflegeBudget } = await import("../tageslauf/pflege-ki.mjs");
const { leseStand } = await import("../tageslauf/pflege-stand.mjs");
isoliere();

const mitSeiten = (extra = {}) => neuerPflegeVault({ seiten: { ...SEITEN, ...extra } });
async function ohneKiAufruf(v, erwartet = {}) {
  const h = fakeKi([], { standard: JSON.stringify(ENTWURF) });
  const r = await lauf(v);
  assert.deepEqual(r.posten, []);
  assert.equal(h.anzahl(), 0);
  for (const [k, w] of Object.entries(erwartet)) assert.equal(r.ctx.pflegeInfo.neueSeiten[k], w, k);
  verwerfeArbeitskopie(v, r.kopie);
}

test("heikle Fakten, Zugangsdaten, falsche Fundstelle, ungedeckte Aussage, Web-Herkunft: zählen nicht — 0 KI-Aufrufe", async () => {
  const faelle = [
    (v) => { warte(v, "h1", "Pizzaofen Kauf", "Der Pizzaofen kostet 1.200 Euro.", "s1"); warte(v, "h2", "Pizzaofen Preis", "Der Pizzaofen hat 20 % Rabatt.", "s1"); warte(v, "h3", "Pizzaofen Miete", "Der Pizzaofen ist gemietet.", "s2"); },
    (v) => { for (const [i, s] of [["g1", "s1"], ["g2", "s1"], ["g3", "s2"]]) warte(v, i, "Pizzaofen Zugang", "Das Kenn" + "wort für den Pizzaofen lautet: Wolke7Blau", s); },
    (v) => pizza(v, { fundstelle: "irgendwo" }),
    (v) => pizza(v, { zitat: "Der Pizzaofen wird heiß." }),                       // 450 und 90 stehen nicht im Zitat
    (v) => pizza(v, { herkunft: "web" }),
  ];
  for (const f of faelle) { const v = mitSeiten(); f(v); await ohneKiAufruf(v, { haeufungen: 0 }); }
});

test("derselbe Satz aus mehreren Sitzungen zählt als EIN Fakt; Wartegrund „seite-passt-nicht“ zählt wie „keine-seite“", async () => {
  const v = mitSeiten();
  for (const [i, s] of [["d1", "s1"], ["d2", "s2"], ["d3", "s3"]]) warte(v, i, "Pizzaofen", "Der Pizzaofen heizt auf 450 Grad.", s);
  await ohneKiAufruf(v, { haeufungen: 0 });
  const w = mitSeiten();
  pizza(w, { warten_grund: "seite-passt-nicht" });
  const h = fakeKi([{ wenn: "THEMA-WORT: Pizzaofen", antwort: JSON.stringify(ENTWURF) }]);
  const r = await lauf(w);
  assert.equal(h.anzahl(), 1);
  assert.equal(r.posten[0].erg.ok, true, JSON.stringify(r.posten[0].erg));
  verwerfeArbeitskopie(w, r.kopie);
});

test("Dublette: Themenwort ist schon Seitenname, Überschrift, auch_genannt oder Eintrag in aliasse.json → 0 KI-Aufrufe", async () => {
  const mitAliasDatei = mitSeiten();                                              // aliasse.json im Format von brain-index
  mkdirSync(join(mitAliasDatei, ".logs"), { recursive: true });
  writeFileSync(join(mitAliasDatei, ".logs", "aliasse.json"), JSON.stringify({ version: 1, seiten: {}, namen: { pizzaofen: ["09_wiki/wissen/kaffee.md"] } }));
  const faelle = [
    mitSeiten({ "09_wiki/wissen/thema_garten.md": seite({ name: "garten", description: "Garten", auch_genannt: ["Pizzaofen"] }, "# Garten\n") }),
    mitSeiten({ "09_wiki/wissen/thema_pizzaofen.md": seite({ name: "pizzaofen", description: "Ofen" }, "# Ofen\n") }),
    mitSeiten({ "09_wiki/wissen/thema_garten.md": seite({ name: "garten", description: "Garten" }, "# Pizzaöfen\n") }),
    mitAliasDatei,
  ];
  for (const v of faelle) { pizza(v); await ohneKiAufruf(v, { haeufungen: 1, uebersprungen: 1 }); }
});

test("Dublette im Entwurf: Name oder Titel gleich einem Alias/Seitennamen → dublette bzw. name-vergeben, kein Commit, Ruhe", async () => {
  const mitAlias = { "09_wiki/wissen/thema_ofen.md": seite({ name: "ofen", description: "Ofen", auch_genannt: ["Backofen"] }, "# Ofen\n") };
  const faelle = [
    [{ ...ENTWURF, name: "backofen", titel: "Der Backofen" }, "dublette"],
    [{ ...ENTWURF, name: "garten-ofen", titel: "Backofen" }, "dublette"],
    [{ ...ENTWURF, name: "kaffee-maschine", titel: "Kaffeemaschine" }, "ok"],
  ];
  for (const [entwurf, grund] of faelle) {
    const v = mitSeiten(mitAlias);
    pizza(v);
    fakeKi([], { standard: JSON.stringify(entwurf) });
    const r = await lauf(v);
    if (grund === "ok") assert.equal(r.posten[0].erg.ok, true, JSON.stringify(r.posten[0].erg));
    else {
      assert.equal(r.posten[0].erg.grund, grund, JSON.stringify(entwurf));
      assert.equal(git(r.kopie.pfad, "log", "-1", "--format=%s"), "start");
      assert.equal(leseStand(v).haeufungen.pizzaof, r.ctx.heute);
    }
    verwerfeArbeitskopie(v, r.kopie);
  }
  const v = mitSeiten({ "09_wiki/wissen/thema_kaffeemaschine.md": seite({ name: "kaffeemaschine", description: "K" }, "# K\n") });
  pizza(v);
  fakeKi([], { standard: JSON.stringify({ ...ENTWURF, name: "kaffee-maschine" }) });
  const r = await lauf(v);
  assert.equal(r.posten[0].erg.grund, "name-vergeben");                           // „kaffee-maschine“ = „kaffeemaschine“
  verwerfeArbeitskopie(v, r.kopie);
  // Eine Nicht-Wiki-Datei gleichen Namens blockiert die Häufung nicht, wohl aber den Dateinamen (Links lösen über ihn auf)
  const w = mitSeiten();
  pizza(w);
  mkdirSync(join(w, "20_firma"), { recursive: true });
  writeFileSync(join(w, "20_firma", "pizzaofen.md"), "# Notiz\n");
  fakeKi([], { standard: JSON.stringify(ENTWURF) });
  const r2 = await lauf(w);
  assert.equal(r2.ctx.pflegeInfo.neueSeiten.uebersprungen, 0);
  assert.equal(r2.posten[0].erg.grund, "name-vergeben");
  verwerfeArbeitskopie(w, r2.kopie);
});

test("kritisch-Kollision: Seite mit kritisch: true trägt denselben Gegenstand → keine neue Seite (vorher und nach dem Entwurf)", async () => {
  const kritisch = (name) => ({ [`09_wiki/firma/thema_${name}.md`]: seite({ name, description: "Vertrag", kritisch: true }, `# ${name}\n`) });
  const v0 = mitSeiten(kritisch("pizzaofen-vertrag"));
  pizza(v0);
  await ohneKiAufruf(v0, { haeufungen: 1, uebersprungen: 1 });
  const v = mitSeiten(kritisch("holzofen"));                                       // Themenwort frei, aber der Entwurf nennt Holzofen
  pizza(v);
  fakeKi([], { standard: JSON.stringify({ ...ENTWURF, titel: "Holzofen im Garten" }) });
  const r = await lauf(v);
  assert.equal(r.posten[0].erg.grund, "kritisch-kollision");
  assert.equal(git(r.kopie.pfad, "log", "-1", "--format=%s"), "start");
  verwerfeArbeitskopie(v, r.kopie);
});

test("Entwurf mit heiklem Kopf oder Müll von Haiku → kein Commit, Ruhe; Budget leer → keine Ruhe", async () => {
  for (const [antwort, grund] of [[{ ...ENTWURF, description: "Der Pizzaofen kostet 1.200 Euro." }, "entwurf-ungueltig"], ["Hallo, das weiß ich nicht.", "ki-fehler"],
    [{ passt: true, name: "pizzaofen" }, "entwurf-ungueltig"]]) {
    const v = mitSeiten();
    pizza(v);
    fakeKi([], { standard: typeof antwort === "string" ? antwort : JSON.stringify(antwort) });
    const r = await lauf(v);
    assert.equal(r.posten[0].erg.grund, grund);
    assert.ok(leseStand(v).haeufungen.pizzaof);
    verwerfeArbeitskopie(v, r.kopie);
  }
  const v = mitSeiten();
  pizza(v);
  const h = fakeKi([], { standard: JSON.stringify(ENTWURF) });
  const r = await lauf(v, { vorab: (ctx) => { ctx.pflegeBudget = neuesPflegeBudget({ haiku: 0 }); } });
  assert.equal(r.posten[0].erg.grund, "budget");
  assert.equal(h.anzahl(), 0);
  assert.deepEqual(leseStand(v), {});
  verwerfeArbeitskopie(v, r.kopie);
});

test("Auswahl: höchstens 8 Fakten reihum über die Sitzungen (≥ 2 bleiben); größere Häufung zuerst", () => {
  const f = (id, sitzung, titel, text) => ({ id, quelleSitzung: sitzung, titel, text, erstellt: "2026-10-20T10:00:00Z" });
  const fakten = [...Array.from({ length: 10 }, (_, i) => f(`a${i}`, "s1", "Gartenhaus", `Gartenhaus Fakt ${i}.`)), f("a20", "s2", "Gartenhaus", "Gartenhaus steht hinten.")];
  const [h] = N.haeufungen(fakten);
  assert.equal(h.anzeige, "Gartenhaus");
  assert.equal(h.vorschlaege.length, N.MAX_FAKTEN_SEITE);
  assert.ok(h.vorschlaege.some((v) => v.quelleSitzung === "s2"));
  const schuppen = [f("b1", "s3", "Schuppen", "Der Schuppen steht hinten."), f("b2", "s3", "Schuppen", "Der Schuppen hat Wellblech."), f("b3", "s4", "Schuppen", "Der Schuppen braucht Farbe.")];
  assert.deepEqual(N.haeufungen([...fakten, ...schuppen]).map((x) => x.anzeige), ["Gartenhaus", "Schuppen"]);
  assert.deepEqual(N.haeufungen(fakten, { stand: { haeufungen: { gartenhau: "2026-10-01" } }, jetzt: Date.parse("2026-10-20T00:00:00Z") }), []);
  assert.equal(N.haeufungen(fakten, { stand: { haeufungen: { gartenhau: "2026-09-01" } }, jetzt: Date.parse("2026-10-20T00:00:00Z") }).length, 1);
});

test("zwei Häufungen → nur EINE Seite je Lauf; Probe rechnet bis zum Commit, schreibt weder Ruhe noch verschiebt Vorschläge", async () => {
  const v = mitSeiten();
  pizza(v);
  for (const [i, s, t] of [[1, "s1", "steht hinten"], [2, "s1", "hat Wellblech"], [3, "s2", "braucht Farbe"]]) warte(v, `v-schuppen-${i}`, "Schuppen", `Der Schuppen ${t}.`, s);
  const h = fakeKi([{ wenn: "THEMA-WORT: Pizzaofen", antwort: JSON.stringify(ENTWURF) }], { standard: '{"passt":false,"grund":"x"}' });
  const r = await lauf(v, { probe: true });
  assert.equal(h.anzahl(), 1);
  assert.equal(r.posten.length, 1);
  const [p] = r.posten;
  assert.equal(p.erg.ok, true, JSON.stringify(p.erg));
  assert.equal(r.ctx.pflegeInfo.neueSeiten.haeufungen, 2);
  assert.equal(P.uebernehmePflege(r.ctx, r.kopie).ok, false);                     // Probe merged nie
  assert.equal(p.nachMerge("x").vorschlaege.length, 3);
  assert.ok(existsSync(join(v, "00_inbox/_warten/v-pizza-1.md")));
  assert.equal(git(v, "log", "-1", "--format=%s", "main"), "start");
  verwerfeArbeitskopie(v, r.kopie);
  assert.deepEqual(leseStand(v), {});
});
