// Parität der beiden Hälften: gemeinsam/ki-konten.mjs (Werkstatt, MCP-Server) und kern/ki-konten.mjs (Hooks, Kern) müssen dieselbe Datei gleich lesen und dieselben Stufen
// ergeben (wie vertrauen-kern.test.mjs für den Vertrauens-Merker). Der Abschnitt zwischen LESEN-BEGINN und LESEN-ENDE ist wortgleich; zusätzlich laufen beide gegen dieselben Fälle.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmp, schreibe, pfad } from "./hilfe.mjs";

const abschnitt = (datei) => { const t = readFileSync(datei, "utf8"); const a = t.indexOf("// LESEN-BEGINN"), b = t.indexOf("// LESEN-ENDE"); assert.ok(a >= 0 && b > a, `Marken fehlen in ${datei}`); return t.slice(a, b); };

test("Der lesende Abschnitt ist in beiden Dateien wortgleich", () => {
  assert.equal(abschnitt(pfad("kern", "ki-konten.mjs")), abschnitt(pfad("gemeinsam", "ki-konten.mjs")));
});

test("Beide Hälften ergeben bei denselben Eingaben dieselben Zustände und Stufen (fehlt · defekt · Link · ok, Argument, Umgebung, Widerspruch, Altform)", async () => {
  const G = await import(pfad("gemeinsam", "ki-konten.mjs"));
  const KERN = await import(pfad("kern", "ki-konten.mjs"));
  assert.deepEqual(Object.keys(KERN).sort(), Object.keys(G).filter((k) => Object.hasOwn(KERN, k)).sort(), "die Kern-Hälfte exportiert nur, was die gemeinsame auch hat");
  const home = tmp("brain-home-"), support = tmp("brain-support-");
  const prof = (n) => { const p = join(home, `.claude-${n}`); mkdirSync(p, { recursive: true }); return realpathSync(p); };
  const a = prof("a"), b = prof("b");
  const v1 = realpathSync(tmp("v1-")), v2 = realpathSync(tmp("v2-"));
  const faelle = [];
  for (const v of [v1, v2, join(v1, "gibt-es-nicht")]) for (const arg of [undefined, null, "k_aaaaaaaa", "k_bbbbbbbb", "k_99999999", "?", "x"]) {
    for (const env of [{}, { CLAUDE_CONFIG_DIR: a }, { CLAUDE_CONFIG_DIR: b }, { CLAUDE_CONFIG_DIR: tmp("fremd-") }, { CODEX_HOME: tmp("codex-") }]) {
      for (const [programm, vollstaendig] of [[null, false], ["claude", true]]) faelle.push({ v, arg, env, programm, vollstaendig });
    }
  }
  const lauf = () => faelle.map((f) => KERN_UND_G(f));
  const KERN_UND_G = (f) => {
    const x = G.kontoStufe(f.v, { support, arg: f.arg, env: f.env, programm: f.programm, vollstaendig: f.vollstaendig });
    const y = KERN.kontoStufe(f.v, { support, arg: f.arg, env: f.env, programm: f.programm, vollstaendig: f.vollstaendig });
    assert.equal(y, x, JSON.stringify(f));
    return x;
  };
  const datei = G.kontenPfad(support);
  // fehlt
  assert.equal(KERN.liesKonten(support).zustand, "fehlt"); assert.equal(G.liesKonten(support).zustand, "fehlt"); lauf();
  // defekt
  writeFileSync(datei, "{ kaputt");
  assert.equal(KERN.liesKonten(support).zustand, "defekt"); assert.equal(G.liesKonten(support).zustand, "defekt");
  assert.ok(lauf().every((s) => s === "gesperrt"));
  // ein Link
  const ziel = join(tmp(), "z.json"); writeFileSync(ziel, JSON.stringify(G.leerDaten()));
  (await import("node:fs")).rmSync(datei); symlinkSync(ziel, datei);
  assert.equal(KERN.liesKonten(support).zustand, "defekt"); assert.equal(G.liesKonten(support).zustand, "defekt");
  assert.ok(lauf().every((s) => s === "gesperrt"));
  (await import("node:fs")).rmSync(datei);
  // gültig
  G.aendere(support, () => ({ version: 1,
    konten: { k_aaaaaaaa: { programm: "claude", ordner: a, standard: false, ordnerKennung: G.kennungVon(a) }, k_bbbbbbbb: { programm: "claude", ordner: b, standard: false, ordnerKennung: G.kennungVon(b) } },
    vaults: { [v1]: { ordnerKennung: G.kennungVon(v1), neueKonten: "lesen", ohneKonto: "posteingang", konten: { k_aaaaaaaa: "erweitert", k_bbbbbbbb: "gesperrt" } }, [v2]: { ordnerKennung: G.kennungVon(v2), konten: { k_aaaaaaaa: "kaputt" } } } }));
  const stufen = new Set(lauf());
  assert.ok(stufen.has("gesperrt") && stufen.has("erweitert") && stufen.has("posteingang"), `die Fälle decken mehrere Stufen ab: ${[...stufen]}`);
  // ändern → beide sehen es sofort
  G.aendere(support, (alt) => { alt.vaults[v1].konten.k_aaaaaaaa = "lesen"; return alt; });
  assert.equal(KERN.kontoStufe(v1, { support, arg: "k_aaaaaaaa" }), "lesen"); lauf();
  // bestimmeKonto selbst
  const daten = G.liesKonten(support).daten;
  for (const f of faelle.slice(0, 80)) assert.deepEqual(KERN.bestimmeKonto({ arg: f.arg, env: f.env, programm: f.programm, daten, vollstaendig: f.vollstaendig }), G.bestimmeKonto({ arg: f.arg, env: f.env, programm: f.programm, daten, vollstaendig: f.vollstaendig }));
});
