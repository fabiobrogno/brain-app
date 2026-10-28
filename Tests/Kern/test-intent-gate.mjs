// K3 Intent-Gate + Hinweis-Budget: Bestätigungen lösen keine Suche aus (die Suche wird nicht einmal aufgerufen),
// gezählt wird nur Länge + sid in .logs/intent-gate.log; der Hinweis bleibt ≤ 600 Zeichen in ganzen Treffern.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { cpSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { ohneWissensbedarf, imBudget, HINWEIS_MAX } from "../hint-core.mjs";
import { tempOrdner, hook, KIT } from "./verlauf-fixture.mjs";

test("ohneWissensbedarf: Bestätigungen/Fortsetzungen ja; Fragen, Aufträge mit Inhalt, Befehle, lange Texte nein", () => {
  for (const p of ["ok", "Ja", "weiter", "ok, mach weiter", "Ja passt, dann mach einfach weiter so!", "danke 👍", "LGTM", "nein"]) {
    assert.equal(ohneWissensbedarf(p), true, p);
  }
  for (const p of ["", "weiter?", "ok, aber prüf erst die Tests", "ja wie funktioniert das thema alpha", "/compact", "<task-notification>ok", "ok ".repeat(30)]) {
    assert.equal(ohneWissensbedarf(p), false, p);
  }
});

test("imBudget: ganze Treffer in Rangfolge, was nicht passt, fällt weg — nie gekürzt", () => {
  const h = (page, n) => ({ page, description: "x".repeat(n) });
  const f = (hs) => hs.map((x) => `${x.page}:${x.description}`).join("\n");
  assert.deepEqual(imBudget([h("a", 300), h("b", 400), h("c", 100)], f, 600).map((x) => x.page), ["a", "c"]);
  assert.deepEqual(imBudget([], f), []);
  assert.equal(HINWEIS_MAX, 600);
});

function hinweisVault() {
  const v = tempOrdner("Brain Hinweis Ü");
  cpSync(join(KIT, "tests", "fixture"), v, { recursive: true });
  const r = spawnSync(process.execPath, [join(KIT, "brain-index.mjs"), v], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const treffer = join(tempOrdner("Treffer"), "treffer.json");
  writeFileSync(treffer, JSON.stringify([{ file: "qmd://brain/10-projekte/alpha/notiz-a.md", score: 0.6 }]));
  return { v, env: { BRAIN_HINT_SEARCH_MODULE: join(KIT, "tests", "fake-search.mjs"), FAKE_JSON: treffer } };
}

test("brain-hint: Bestätigung → Suche wird nicht aufgerufen, keine Ausgabe, nur Länge + sid im Gate-Log; echte Frage sucht weiter", () => {
  const { v, env } = hinweisVault();
  const args = join(tempOrdner("Args"), "a.json");
  const P = "Ja passt, dann mach einfach weiter so";
  const g = hook("brain-hint.mjs", { session_id: "gate-1", prompt: P }, { vault: v, env: { ...env, FAKE_ARGS: args } });
  assert.equal(g.status, 0);
  assert.equal(g.stdout, "");
  assert.equal(existsSync(args), false, "Suche darf nicht laufen");
  const log = readFileSync(join(v, ".logs", "intent-gate.log"), "utf8");
  assert.match(log, new RegExp(`sid=gate-1 len=${P.length} gate=ohne-wissensbedarf`));
  assert.doesNotMatch(log, /passt|weiter/);
  const hintLog = join(v, ".logs", "hint.log");
  if (existsSync(hintLog)) assert.doesNotMatch(readFileSync(hintLog, "utf8"), /sid=gate-1 /, "hint.log/analyse unverändert");
  const f = hook("brain-hint.mjs", { session_id: "gate-2", prompt: "wie funktioniert das thema alpha genau" }, { vault: v, env: { ...env, FAKE_ARGS: args } });
  assert.equal(f.status, 0);
  assert.equal(existsSync(args), true);
  assert.match(f.stdout, /thema_alpha/);
  assert.ok(f.stdout.trim().length <= HINWEIS_MAX);
});
