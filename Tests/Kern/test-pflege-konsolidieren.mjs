// .tools/tests/test-pflege-konsolidieren.mjs — B3 Task 8: Konsolidieren. Sonnet (fake) faltet ## Fakten in den Fließtext; Node
// entfernt alte ersetzte Zeilen vorab; Gegenprobe je Fakt-Zeile (Zahl fehlt → nein ohne KI; Haiku nur {"drin":"ja"}).
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { isoliere, git, fakeKi, schnappschuss, JETZT } from "./tageslauf-hilfe.mjs";
import { fakeSonnet, neuerPflegeVault, pflegeCtx, seite } from "./pflege-hilfe.mjs";
const K = await import("../tageslauf/konsolidieren.mjs");
const P = await import("../tageslauf/pflege-kopie.mjs");
const { neuesPflegeBudget } = await import("../tageslauf/pflege-ki.mjs");
const { verwerfeArbeitskopie } = await import("../tageslauf/arbeitskopie.mjs");
const { leseStand, STAND_DATEI } = await import("../tageslauf/pflege-stand.mjs");
isoliere();

const SEITE = "09_wiki/wissen/kaffee.md";
const B = (n) => `[[30_wissen/belege/2026-10/k${n}]]`;
const F = [
  `- Die Mühle hat 40 Mahlstufen · Stand 01.10.2026 · ${B(1)}`,
  `- Der Espresso läuft 25 Sekunden · Stand 02.10.2026 · ${B(2)}`,
  `- Die Maschine braucht keinen Wasserfilter · Stand 03.10.2026 · ${B(3)}`,
  `- Der Kessel fasst 1,8 Liter · Stand 04.10.2026 · ${B(4)}`,
  `- Die Brühtemperatur liegt bei 93 Grad · Stand 05.10.2026 · ${B(5)}`,
];
const ALT = "- ~~Der Kessel fasst 1,5 Liter~~ · ersetzt am 01.05.2026 durch die Zeile darunter";
const FM = { name: "kaffee", description: "Kaffee" };
const VORHER = seite(FM, `# Kaffee\n\n## Maschine\n\nDie Maschine steht in der Küche.\n\n## Zubereitung\n\nMorgens ein Espresso.\n\n## Fakten\n\n${[F[0], F[1], F[2], ALT, F[3], F[4]].join("\n")}\n`);
const NACHHER = (kessel = `Der Kessel fasst 1,8 Liter (Stand 04.10.2026) ${B(4)}.`) => seite(FM, `# Kaffee\n\n## Maschine\n\n`
  + `Die Maschine steht in der Küche. Die Mühle hat 40 Mahlstufen (Stand 01.10.2026) ${B(1)}. Die Maschine braucht keinen `
  + `Wasserfilter (Stand 03.10.2026) ${B(3)}. ${kessel}\n\n## Zubereitung\n\nMorgens ein Espresso. Der Espresso läuft 25 Sekunden `
  + `(Stand 02.10.2026) ${B(2)}, die Brühtemperatur liegt bei 93 Grad (Stand 05.10.2026) ${B(5)}.\n`);

async function lauf(v, { budget } = {}) {
  const ctx = pflegeCtx(v);
  if (budget) ctx.pflegeBudget = neuesPflegeBudget(budget);
  const kopie = P.legePflegeKopieAn(v, ctx.lauf);
  try { return { ctx, kopie, posten: await K.konsolidierSchritt(ctx, kopie) }; }
  catch (e) { verwerfeArbeitskopie(v, kopie); throw e; }
}

test("gute Konsolidierung: ein Commit, rev 2, alle Beleg-Links da, alte ersetzte Zeile weg, 5 Gegenproben; Stand erst nach dem Merge", async () => {
  const v = neuerPflegeVault({ seiten: { [SEITE]: VORHER } });
  const s = fakeSonnet([{ wenn: `SEITE: ${SEITE}`, antwort: '{"ok":true}', dateien: { [SEITE]: NACHHER() } }]);
  const h = fakeKi([], { standard: '{"drin":"ja"}' });
  const { ctx, kopie, posten } = await lauf(v);
  assert.equal(posten.length, 1);
  assert.equal(posten[0].erg.ok, true, JSON.stringify(posten[0].erg));
  assert.equal(s.anzahl(), 1);
  assert.equal(h.anzahl(), 5);
  assert.match(s.aufrufe()[0].eingabe, /^SEITE: 09_wiki\/wissen\/kaffee\.md\nFAKT-ZEILEN:\n- Die Mühle hat 40 Mahlstufen/);
  const t = readFileSync(join(kopie.pfad, SEITE), "utf8");
  assert.match(t, /^rev: 2$/m);
  for (let n = 1; n <= 5; n++) assert.ok(t.includes(B(n)), `Beleg ${n}`);
  assert.doesNotMatch(t, /1,5 Liter|## Fakten/);
  assert.match(git(kopie.pfad, "log", "-1", "--format=%s"), /^pflege\(\d{8}-\d{6}\): konsolidieren kaffee \[konsolidieren-kaffee\]$/);
  assert.equal(leseStand(v).konsolidiert, undefined);
  assert.equal(readFileSync(join(v, SEITE), "utf8"), VORHER, "bis zum Merge bleibt der Vault wie er war");
  assert.equal(P.uebernehmePflege(ctx, kopie).ok, true);
  const imVault = readFileSync(join(v, SEITE), "utf8");
  assert.equal(imVault, readFileSync(join(kopie.pfad, SEITE), "utf8"));
  for (let n = 1; n <= 5; n++) assert.ok(imVault.includes(B(n)), `Beleg ${n} im Vault`);
  posten[0].nachMerge("x");
  assert.equal(leseStand(v).konsolidiert[SEITE], ctx.heute);
  verwerfeArbeitskopie(v, kopie);
});

test("Zahl fehlt → gegenprobe-nein ohne Haiku für diese Zeile, Seite unverändert, Stand gesetzt (30 Tage Ruhe)", async () => {
  const v = neuerPflegeVault({ seiten: { [SEITE]: VORHER } });
  fakeSonnet([{ wenn: `SEITE: ${SEITE}`, antwort: '{"ok":true}', dateien: { [SEITE]: NACHHER(`Der Kessel ist groß ${B(4)}.`) } }]);
  const h = fakeKi([], { standard: '{"drin":"ja"}' });
  const { ctx, kopie, posten } = await lauf(v);
  assert.equal(posten[0].erg.grund, "gegenprobe-nein");
  assert.match(posten[0].erg.befunde[0].meldung, /Kessel/);
  assert.equal(h.anzahl(), 3, "Mühle, Espresso, Wasserfilter per Haiku — Kessel scheitert schon an der Zahl");
  assert.equal(readFileSync(join(kopie.pfad, SEITE), "utf8"), VORHER);
  assert.equal(git(kopie.pfad, "log", "-1", "--format=%s"), "start");
  assert.equal(leseStand(v).konsolidiert[SEITE], ctx.heute);
  verwerfeArbeitskopie(v, kopie);
});

test("Haiku-Müll oder „nein\" → verworfen", async () => {
  for (const standard of ["Kann ich nicht sagen.", '{"drin":"nein"}', '{"drin":"Ja"}']) {
    const v = neuerPflegeVault({ seiten: { [SEITE]: VORHER } });
    fakeSonnet([{ wenn: `SEITE: ${SEITE}`, antwort: '{"ok":true}', dateien: { [SEITE]: NACHHER() } }]);
    const h = fakeKi([], { standard });
    const { kopie, posten } = await lauf(v);
    assert.equal(posten[0].erg.grund, "gegenprobe-nein", standard);
    assert.equal(h.anzahl(), 1);
    verwerfeArbeitskopie(v, kopie);
  }
});

test("Sonnet kürzt andere Abschnitte → zu-viel-entfernt; Budget reicht nicht → kein Aufruf", async () => {
  let v = neuerPflegeVault({ seiten: { [SEITE]: VORHER } });
  // Stand-Daten bleiben stehen (sonst fiele schon die Gegenprobe) — hier soll die 20-%-Regel greifen
  const kurz = seite(FM, `# Kaffee\n\nMühle 40 Mahlstufen (Stand 01.10.2026) ${B(1)}, Espresso 25 Sekunden (Stand 02.10.2026) ${B(2)}, keinen Wasserfilter (Stand 03.10.2026) ${B(3)}, Kessel 1,8 Liter (Stand 04.10.2026) ${B(4)}, 93 Grad (Stand 05.10.2026) ${B(5)}.\n`);
  fakeSonnet([{ wenn: `SEITE: ${SEITE}`, antwort: '{"ok":true}', dateien: { [SEITE]: kurz } }]);
  fakeKi([], { standard: '{"drin":"ja"}' });
  let r = await lauf(v);
  assert.equal(r.posten[0].erg.grund, "diff-rot");
  assert.deepEqual(r.posten[0].erg.befunde.map((b) => b.regel), ["zu-viel-entfernt"]);
  verwerfeArbeitskopie(v, r.kopie);
  v = neuerPflegeVault({ seiten: { [SEITE]: VORHER } });
  const s = fakeSonnet([]);
  r = await lauf(v, { budget: { sonnet: 1, haiku: 3, minuten: 40 } });
  assert.equal(r.posten[0].erg.grund, "budget");
  assert.equal(s.anzahl(), 0);
  verwerfeArbeitskopie(v, r.kopie);
});

test("Kandidaten: ≥ 5 Fakten oder > 8 KB; kritisch, ersetzt, zu frisch konsolidiert und kaputte Fakt-Zeilen nie; nur alte ersetzte Zeilen → Node allein", async () => {
  // > 8 KB, keine Fakt-Zeile, nur eine alte ersetzte Zeile (darunter ein Hand-Stichpunkt) → Node allein, keine KI
  const gross = `# Groß\n\n${Array.from({ length: 400 }, (_, i) => `Absatz ${i + 1} mit etwas Text.`).join("\n")}\n\n## Fakten\n\n${ALT}\n- Der Kessel fasst 1,8 Liter.\n`;
  const v = neuerPflegeVault({ seiten: {
    [SEITE]: VORHER,
    "09_wiki/wissen/gross.md": seite({ name: "gross", description: "Groß" }, gross),
    "09_wiki/wissen/geheim.md": seite({ name: "geheim", description: "x", kritisch: true }, `# G\n\n${F.join("\n")}\n`),
    "09_wiki/wissen/alt.md": seite({ name: "alt", description: "x", ersetzt_durch: "[[kaffee]]" }, `# A\n\n${F.join("\n")}\n`),
    "09_wiki/wissen/klein.md": seite({ name: "klein", description: "x" }, `# K\n\n${F.slice(0, 4).join("\n")}\n`),
    "09_wiki/wissen/kaputt.md": seite({ name: "kaputt", description: "x" }, `# K\n\n${F.join("\n")}\n- Ohne Beleg · Stand 01.10.2026\n`),
  } });
  const ctx = pflegeCtx(v);
  assert.deepEqual(K.konsolidierKandidaten(ctx).map((k) => k.seite), [SEITE, "09_wiki/wissen/gross.md"]);
  const tag = (n) => new Date(JETZT - n * 86400e3).toISOString().slice(0, 10);
  mkdirSync(dirname(STAND_DATEI(v)), { recursive: true });
  writeFileSync(STAND_DATEI(v), JSON.stringify({ konsolidiert: { [SEITE]: tag(10) } }));
  assert.deepEqual(K.konsolidierKandidaten(ctx).map((k) => k.seite), ["09_wiki/wissen/gross.md"]);
  const s = fakeSonnet([]);
  const h = fakeKi([], { standard: '{"drin":"ja"}' });
  const { kopie, posten } = await lauf(v);
  assert.equal(posten[0].erg.ok, true, JSON.stringify(posten[0].erg));
  assert.equal(s.anzahl() + h.anzahl(), 0);
  assert.doesNotMatch(readFileSync(join(kopie.pfad, "09_wiki/wissen/gross.md"), "utf8"), /1,5 Liter/);
  verwerfeArbeitskopie(v, kopie);
  writeFileSync(STAND_DATEI(v), JSON.stringify({ konsolidiert: { [SEITE]: tag(31) } }));
  assert.equal(K.konsolidierKandidaten(ctx)[0].seite, SEITE);
});

test("ohneAlteErsetzte: nur älter als 90 Tage", () => {
  const jung = "- ~~X 1~~ · ersetzt am 01.10.2026 durch die Zeile darunter";
  assert.equal(K.ohneAlteErsetzte(`a\n${ALT}\n${jung}\nb\n`, JETZT), `a\n${jung}\nb\n`);
});

// ---- Korrektheit: Konsolidieren formuliert nur um — es verliert oder verfälscht nichts ------------------------------------
// Haiku-Fake „sagt die Wahrheit": für die genannten Aussagen „nein", sonst „ja" (das echte Haiku urteilt über Text und Aussage).
const nein = (...aussagen) => aussagen.map((a) => ({ wenn: `AUSSAGE: ${a}\n`, antwort: '{"drin":"nein"}' }));
const verwirf = (v, kopie, ctx) => {
  assert.equal(readFileSync(join(v, SEITE), "utf8"), VORHER, "Seite im Vault unverändert");
  assert.equal(readFileSync(join(kopie.pfad, SEITE), "utf8"), VORHER, "Seite in der Arbeitskopie unverändert");
  assert.equal(git(kopie.pfad, "status", "--porcelain"), "", "Arbeitskopie sauber");
  assert.equal(git(kopie.pfad, "log", "-1", "--format=%s"), "start", "kein Commit");
  assert.equal(leseStand(v).konsolidiert[SEITE], ctx.heute, "auch der Fehlschlag wartet 30 Tage");
};

const FALLE = [
  { name: "(b) Fakt ohne Zahl weggelassen (Stand-Datum und Beleg-Link bleiben stehen) → Haiku: nein", haiku: nein("Die Maschine braucht keinen Wasserfilter"), haikuAufrufe: 3,
    neu: NACHHER().replace(`Die Maschine braucht keinen Wasserfilter (Stand 03.10.2026) ${B(3)}.`, `Die Maschine steht dort (Stand 03.10.2026) ${B(3)}.`), grund: "gegenprobe-nein", regel: "gegenprobe", meldung: /Wasserfilter/ },
  { name: "(b) Fakt mit Zahl samt Beleg-Link weggelassen → gegenprobe-nein schon ohne Haiku für diese Zeile", haiku: [], haikuAufrufe: 1,
    neu: NACHHER().replace(`Der Espresso läuft 25 Sekunden (Stand 02.10.2026) ${B(2)}, die`, "Die"), grund: "gegenprobe-nein", regel: "gegenprobe", meldung: /Espresso/ },
  { name: "(c) Zahl geändert (93 → 95 Grad) → gegenprobe-nein", haiku: [], haikuAufrufe: 0,
    neu: NACHHER().replace("liegt bei 93 Grad", "liegt bei 95 Grad"), grund: "gegenprobe-nein", regel: "gegenprobe", meldung: /95/ },
  { name: "(c) Stand-Datum einer Zeile geändert → gegenprobe-nein", haiku: [], haikuAufrufe: 0,
    neu: NACHHER().replace("Mahlstufen (Stand 01.10.2026)", "Mahlstufen (Stand 02.11.2026)"), grund: "gegenprobe-nein", regel: "gegenprobe", meldung: /11\.2026|2\.11|nirgends/ },
  { name: "Stand-Datum einer Zeile weggelassen → gegenprobe-nein", haiku: [], haikuAufrufe: 4,
    neu: NACHHER().replace(" (Stand 05.10.2026)", ""), grund: "gegenprobe-nein", regel: "gegenprobe", meldung: /05\.10\.2026|Brühtemperatur/ },
  { name: "(c) Zahlen vertauscht (alle Zahlen stehen noch irgendwo) → Haiku: nein", haiku: nein("Die Mühle hat 40 Mahlstufen"), haikuAufrufe: 1,
    neu: NACHHER().replace("Die Mühle hat 40 Mahlstufen", "Die Mühle hat 25 Mahlstufen").replace("läuft 25 Sekunden", "läuft 40 Sekunden"), grund: "gegenprobe-nein", regel: "gegenprobe", meldung: /Mühle/ },
  { name: "(c) Verneinung gedreht (keinen → einen Wasserfilter) → Haiku: nein", haiku: nein("Die Maschine braucht keinen Wasserfilter"), haikuAufrufe: 3,
    neu: NACHHER().replace("braucht keinen Wasserfilter", "braucht einen Wasserfilter"), grund: "gegenprobe-nein", regel: "gegenprobe", meldung: /Wasserfilter/ },
  { name: "(c) neue Zahl dazuerfunden → verworfen, bevor Haiku gefragt wird", haiku: [], haikuAufrufe: 0,
    neu: NACHHER().replace("Morgens ein Espresso.", "Morgens ein Espresso, im Tank sind 2 Liter."), grund: "gegenprobe-nein", regel: "gegenprobe", meldung: /nirgends stand/ },
  { name: "(d) ein Beleg-Link entfernt (Text bleibt) → diff-rot beleg-link", haiku: [], haikuAufrufe: 5,
    neu: NACHHER().replace(` ${B(3)}`, ""), grund: "diff-rot", regel: "beleg-link", meldung: /k3/ },
  { name: "(d) Beleg-Link durch einen anderen ersetzt → diff-rot beleg-link", haiku: [], haikuAufrufe: 5,
    neu: NACHHER().replace(B(2), "[[30_wissen/belege/2026-10/k9]]"), grund: "diff-rot", regel: "beleg-link", meldung: /k2/ },
  { name: "Frontmatter verändert → verworfen", haiku: [], haikuAufrufe: 0,
    neu: NACHHER().replace("description: Kaffee", "description: Tee"), grund: "diff-rot", regel: "frontmatter", meldung: /Frontmatter/ },
];
// Ein Vault und eine Arbeitskopie für alle Fälle (jeder Fall wird verworfen und lässt beide unverändert) — spart je Fall einen Git-Aufbau.
let geteilt = null;
const fall = () => {
  if (!geteilt) {
    const v = neuerPflegeVault({ seiten: { [SEITE]: VORHER } });
    geteilt = { v, kopie: P.legePflegeKopieAn(v, pflegeCtx(v).lauf) };
  }
  return geteilt;
};
describe("verworfene Konsolidierungen", () => {
after(() => { if (geteilt) verwerfeArbeitskopie(geteilt.v, geteilt.kopie); geteilt = null; });   // vor den nächsten Tests (gleicher Kopie-Pfad)
for (const f of FALLE) {
  test(`verworfen, Vault unverändert: ${f.name}`, async () => {
    const { v, kopie } = fall();
    assert.notEqual(f.neu, NACHHER(), "Testfall ändert den Text");
    rmSync(STAND_DATEI(v), { force: true });
    const s = fakeSonnet([{ wenn: `SEITE: ${SEITE}`, antwort: '{"ok":true}', dateien: { [SEITE]: f.neu } }]);
    const h = fakeKi(f.haiku, { standard: '{"drin":"ja"}' });
    const ctx = pflegeCtx(v);
    const vor = schnappschuss(v), kopf = git(v, "rev-parse", "HEAD");
    const posten = await K.konsolidierSchritt(ctx, kopie);
    assert.equal(posten.length, 1);
    assert.equal(posten[0].erg.ok, false, "verworfen");
    assert.equal(posten[0].erg.grund, f.grund, JSON.stringify(posten[0].erg));
    assert.equal(posten[0].erg.befunde[0].regel, f.regel);
    assert.match(posten[0].erg.befunde[0].meldung, f.meldung);
    assert.equal(posten[0].nachMerge, undefined, "kein Nach-Merge-Haken");
    assert.equal(s.anzahl(), 1);
    assert.equal(h.anzahl(), f.haikuAufrufe, "Haiku-Aufrufe bis zum ersten Nein");
    verwirf(v, kopie, ctx);
    const m = P.uebernehmePflege(ctx, kopie);                 // selbst ein Merge bringt nichts in den Vault
    assert.equal(git(v, "rev-parse", "HEAD"), kopf);
    assert.equal(schnappschuss(v), vor, `Vault unverändert (Merge: ${JSON.stringify({ ok: m.ok, grund: m.grund })})`);
  });
}
});

test("(a) sauber konsolidiert → im Vault übernommen; danach 30 Tage Ruhe, kein Kandidat mehr", async () => {
  const v = neuerPflegeVault({ seiten: { [SEITE]: VORHER } });
  fakeSonnet([{ wenn: `SEITE: ${SEITE}`, antwort: '{"ok":true}', dateien: { [SEITE]: NACHHER() } }]);
  fakeKi([], { standard: '{"drin":"ja"}' });
  const { ctx, kopie, posten } = await lauf(v);
  assert.equal(posten[0].erg.ok, true, JSON.stringify(posten[0].erg));
  assert.equal(P.uebernehmePflege(ctx, kopie).ok, true);
  posten[0].nachMerge("x");
  verwerfeArbeitskopie(v, kopie);
  assert.deepEqual(K.konsolidierKandidaten(ctx), [], "die konsolidierte Seite hat keine Fakt-Zeilen mehr und ist jung");
});

test("jüngere ersetzte Zeile samt Zeile darunter muss zusammenbleiben — sonst verworfen", async () => {
  const jung = "- ~~Der Kessel fasst 1,5 Liter~~ · ersetzt am 01.10.2026 durch die Zeile darunter";
  const vorher = seite(FM, `# Kaffee\n\n## Maschine\n\nDie Maschine steht in der Küche.\n\n## Fakten\n\n${[F[0], F[1], F[2], jung, F[3], F[4]].join("\n")}\n`);
  // Sonnet arbeitet die Zeile unter der ersetzten in den Fließtext ein und lässt die durchgestrichene allein zurück
  const zerrissen = seite(FM, `# Kaffee\n\n## Maschine\n\nDie Maschine steht in der Küche. Der Kessel fasst 1,8 Liter (Stand 04.10.2026) ${B(4)}.\n\n## Fakten\n\n${[F[0], F[1], F[2], jung, F[4]].join("\n")}\n`);
  const ganz = seite(FM, `# Kaffee\n\n## Maschine\n\nDie Maschine steht in der Küche. Die Mühle hat 40 Mahlstufen (Stand 01.10.2026) ${B(1)}.\n\n## Fakten\n\n${[F[1], F[2], jung, F[3], F[4]].join("\n")}\n`);
  for (const [neu, ok] of [[zerrissen, false], [ganz, true]]) {
    const v = neuerPflegeVault({ seiten: { [SEITE]: vorher } });
    fakeSonnet([{ wenn: `SEITE: ${SEITE}`, antwort: '{"ok":true}', dateien: { [SEITE]: neu } }]);
    fakeKi([], { standard: '{"drin":"ja"}' });
    const { kopie, posten } = await lauf(v);
    assert.equal(posten[0].erg.ok, ok, JSON.stringify(posten[0].erg));
    if (!ok) { assert.equal(posten[0].erg.befunde[0].regel, "ersetzt-zeile"); assert.equal(readFileSync(join(kopie.pfad, SEITE), "utf8"), vorher); }
    verwerfeArbeitskopie(v, kopie);
  }
});

// ---- Klein 3: umgeschriebene Fließtextzeilen mit Zahl oder Verneinung werden wie Fakt-Zeilen gegengeprüft ---------------------------
const PROSA = "Sie hat keine Garantie mehr und wiegt 12 kg.";
const VORHER_P = VORHER.replace("Die Maschine steht in der Küche.\n", `Die Maschine steht in der Küche.\n\n${PROSA}\n`);
const NACHHER_P = (zeile) => NACHHER().replace("Die Maschine steht in der Küche. Die Mühle", `Die Maschine steht in der Küche.\n\n${zeile}\n\nDie Mühle`);
for (const [name, zeile, regeln, haiku, ok, meldung] of [
  ["Verneinung gekippt (keine → noch) → Haiku „nein“ → gegenprobe-nein", "Sie hat noch Garantie und wiegt 12 kg.", [{ wenn: "AUSSAGE: Sie hat keine Garantie", antwort: '{"drin":"nein"}' }], 6, false, /Garantie/],
  ["Zahl geändert (12 → 15 kg) → gegenprobe-nein ohne Haiku (neue Angabe, die vorher nirgends stand)", "Sie hat keine Garantie mehr und wiegt 15 kg.", [], 0, false, /15/],
  ["Zeile ersatzlos weggefallen → gegenprobe-nein (Zahl 12 fehlt, ohne Haiku)", "Sie steht schön da.", [], 5, false, /12|Garantie/],
  ["sinngleich umformuliert → Haiku „ja“ → durch", "Sie hat keine Garantie mehr, das Gerät wiegt 12 kg.", [], 6, true],
]) {
  test(`Klein 3 Fließtext: ${name}`, async () => {
    const v = neuerPflegeVault({ seiten: { [SEITE]: VORHER_P } });
    fakeSonnet([{ wenn: `SEITE: ${SEITE}`, antwort: '{"ok":true}', dateien: { [SEITE]: NACHHER_P(zeile) } }]);
    const h = fakeKi(regeln, { standard: '{"drin":"ja"}' });
    const { kopie, posten } = await lauf(v);
    try {
      assert.equal(posten[0].erg.ok, ok, JSON.stringify(posten[0].erg));
      assert.equal(h.anzahl(), haiku);
      if (!ok) { assert.equal(posten[0].erg.grund, "gegenprobe-nein"); assert.match(posten[0].erg.befunde[0].meldung, meldung); }
    } finally { verwerfeArbeitskopie(v, kopie); }
  });
}
