// .tools/tests/test-tageslauf-hilfe.mjs — Testwerkzeug, Schalter und CLI-Einträge für den Tageslauf (B2, Task 1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { isoliere, neuerTestVault, git, fakeKi, FAKE_BEFEHL, KIT, schnappschuss, legeTranskriptAn, committe } from "./tageslauf-hilfe.mjs";
import { rufeHaiku, leseClaudeAntwort } from "../ernte.mjs";
import { SCHEMA, STANDARD, TAGESLAUF_BUDGETS } from "../einstellungen.mjs";
isoliere();

test("fake-claude: Regeln je Eingabe, sonst Standard; jeder Aufruf gezählt", async () => {
  const ki = fakeKi([{ wenn: "ALPHA", antwort: '{"urteil":"neu"}' }, { wenn: "BETA", antwort: "[]" }], { standard: "NICHTS" });
  const v = neuerTestVault();
  const text = async (e) => leseClaudeAntwort((await rufeHaiku(FAKE_BEFEHL, "System", e, v)).ausgabe).text;
  assert.equal(await text("mit ALPHA"), '{"urteil":"neu"}');
  assert.equal(await text("mit BETA"), "[]");
  assert.equal(await text("sonst"), "NICHTS");
  assert.equal(ki.anzahl(), 3);
  assert.match(ki.aufrufe()[0].eingabe, /ALPHA/);
});

test("neuerTestVault: Git auf main und sauber; Hook grün blockt nur VERBOTEN; Hook rot blockt alles", () => {
  const v = neuerTestVault({ seiten: { "09_wiki/projekte/entitaet_alpha.md": { fm: { name: "alpha", description: "Projekt Alpha" }, rumpf: "# Alpha\n" } } });
  assert.equal(git(v, "symbolic-ref", "--short", "HEAD"), "main");
  assert.equal(git(v, "status", "--porcelain"), "");
  committe(v, "09_wiki/x.md", "ok\n");
  writeFileSync(join(v, "09_wiki", "y.md"), "VERBOTEN\n"); git(v, "add", "--", "09_wiki/y.md");
  assert.throws(() => git(v, "commit", "-qm", "y"));
  const r = neuerTestVault({ hook: "rot" });
  writeFileSync(join(r, "z.md"), "z"); git(r, "add", "--", "z.md");
  assert.throws(() => git(r, "commit", "-qm", "z"));
});

test("schnappschuss: ändert sich bei Datei und Branch, nicht bei .logs", () => {
  const v = neuerTestVault();
  const a = schnappschuss(v);
  mkdirSync(join(v, ".logs"), { recursive: true }); writeFileSync(join(v, ".logs", "x"), "1");
  assert.equal(schnappschuss(v), a);
  git(v, "branch", "neu");
  assert.notEqual(schnappschuss(v), a);
});

test("legeTranskriptAn passt zu B1: du/tool/ki erkannt, fundstellen() hat die erwarteten Felder", async () => {
  const v = neuerTestVault();
  const p = legeTranskriptAn(v, "s1", [{ du: "Der Port ist 3309." }, { tool: "Read", text: "version = 4.2" }, { ki: "Ich vermute Port 80." }]);
  const B1 = await import("../beleg.mjs");
  const z = B1.ladeTranskript(p);
  assert.equal(B1.findeZitat(z, "Der Port ist 3309.").herkunft, "du");
  assert.equal(B1.findeZitat(z, "version = 4.2").herkunft, "tool");
  assert.equal(B1.findeZitat(z, "Ich vermute Port 80.").herkunft, "ki");
  assert.equal(B1.findeZitat(z, "steht nirgends"), null);
  const f = B1.fundstellen(z);
  assert.ok(f.length >= 3 && f.every((x) => "herkunft" in x && "text" in x && "uuid" in x), JSON.stringify(f[0]));
});

test("Schalter: tageslauf aus|probe|an (Standard probe), tageslaufBudget klein|normal|gross (Standard normal)", () => {
  assert.deepEqual(SCHEMA.tageslauf.werte, ["aus", "probe", "an"]);
  assert.equal(STANDARD.tageslauf, "probe");
  assert.deepEqual(SCHEMA.tageslaufBudget.werte, ["klein", "normal", "gross"]);
  assert.equal(STANDARD.tageslaufBudget, "normal");
  assert.deepEqual(TAGESLAUF_BUDGETS.normal, { aufrufe: 60, minuten: 15 });
});

test("brain.mjs: tageslauf, rueckfragen, zurueck, dienst sind Befehle", () => {
  const r = spawnSync(process.execPath, [join(KIT, "brain.mjs"), "gibtsnicht"], { encoding: "utf8" });
  assert.equal(r.status, 64);
  for (const b of ["tageslauf", "rueckfragen", "zurueck", "dienst"]) assert.match(r.stderr, new RegExp(`\\b${b}\\b`));
});
