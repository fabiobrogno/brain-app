// .tools/tests/test-tageslauf-lauf-cli.mjs — Tageslauf (B2, Task 11): Stichprobe „stimmt nicht“ nimmt die Übernahme zurück,
// Kommandozeile (tageslauf.mjs, brain.mjs, --losgeloest). Aufbau: lauf-hilfe.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { setTimeout as warte } from "node:timers/promises";
import { isoliere, fakeKi, git, JETZT, KIT } from "./tageslauf-hilfe.mjs";
import { tempOrdner } from "./verlauf-fixture.mjs";
import { SEITE, REGELN, aufbau, lauf } from "./lauf-hilfe.mjs";
const T = await import("../tageslauf.mjs");
const R = await import("../rueckfragen.mjs");
const P = await import("../tageslauf/protokoll.mjs");
isoliere();

test("Stichprobe „stimmt nicht“: der Lauf nimmt die Übernahme zurück (neuer Commit) und zählt einen Fehler", async () => {
  const v = aufbau();
  fakeKi(REGELN);
  await lauf(v);
  await lauf(v, { jetzt: JETZT + 24 * 3600e3 });                          // zweiter Lauf legt die Stichproben an (aus dem ersten)
  const st = R.listeRueckfragen(v).filter((x) => x.typ === "stichprobe");
  assert.equal(st.length, 2);
  const g = st.find((x) => x.fm.aktion === "g1");
  R.beantworte(v, g.id, "stimmt-nicht");
  const r = await lauf(v, { jetzt: JETZT + 25 * 3600e3, nurAntworten: true });
  assert.equal(r.status, "ok");
  assert.doesNotMatch(readFileSync(join(v, SEITE), "utf8"), /belege\/2026-10\/g1/);
  assert.match(git(v, "log", "-1", "--format=%s"), /^zurueck: g1/);
  assert.deepEqual(P.lesePruefungen(v).filter((p) => p.fehler).length, 1, "genau ein Fehler (nicht doppelt gezählt)");
});

test("CLI: --probe gibt eine Zeile aus (Exit 0); unbekannte Option → 64", () => {
  const v = aufbau();
  fakeKi(REGELN);
  const r = spawnSync(process.execPath, [join(KIT, "tageslauf.mjs"), v, "--probe", "--budget-aufrufe", "10"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Probelauf \(nichts geändert\)/);
  assert.equal(spawnSync(process.execPath, [join(KIT, "tageslauf.mjs"), v, "--quatsch"], { encoding: "utf8" }).status, 64);
  assert.equal(spawnSync(process.execPath, [join(KIT, "tageslauf.mjs"), v, "--budget-aufrufe", "x"], { encoding: "utf8" }).status, 64);
  assert.deepEqual(T.leseArgs(["/v", "--budget-minuten", "5", "--nur-antworten"]), { vault: "/v", budget: { minuten: 5 }, nurAntworten: true });
});

test("brain tageslauf --probe geht über brain.mjs; --losgeloest startet ein losgelöstes Kind mit denselben Angaben (ohne --losgeloest)", async () => {
  const v = aufbau();
  fakeKi(REGELN);
  const r = spawnSync(process.execPath, [join(KIT, "brain.mjs"), "tageslauf", "--probe"], { encoding: "utf8", env: { ...process.env, BRAIN_VAULT: v } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Probelauf \(nichts geändert\)/);
  const d = tempOrdner("kind");
  writeFileSync(join(d, "kind.mjs"), `import { writeFileSync, renameSync } from "node:fs"; writeFileSync(${JSON.stringify(join(d, "args.tmp"))}, JSON.stringify(process.argv.slice(2))); renameSync(${JSON.stringify(join(d, "args.tmp"))}, ${JSON.stringify(join(d, "args.json"))});`);
  const l = spawnSync(process.execPath, [join(KIT, "tageslauf.mjs"), v, "--losgeloest", "--nur-antworten", "--budget-aufrufe", "5"],
    { encoding: "utf8", env: { ...process.env, BRAIN_TAGESLAUF_SKRIPT: join(d, "kind.mjs") } });
  assert.equal(l.status, 0, l.stderr);
  assert.match(l.stdout, /im Hintergrund/);
  for (let i = 0; i < 200 && !existsSync(join(d, "args.json")); i++) await warte(50);
  assert.deepEqual(JSON.parse(readFileSync(join(d, "args.json"), "utf8")), [v, "--nur-antworten", "--budget-aufrufe", "5"]);
});
