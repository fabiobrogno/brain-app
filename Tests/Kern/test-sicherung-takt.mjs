// .tools/tests/test-sicherung-takt.mjs — B3 Task 5: Sicherung nur bei neuem HEAD und höchstens alle 15 min; der Sitzungsstart
// überspringt eine unveränderte Online-Sicherung (lokales Bare-Repo als „GitHub“).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { isoliere, neuerTestVault, committe, seitenText, git, KIT } from "./tageslauf-hilfe.mjs";
import { tempOrdner } from "./verlauf-fixture.mjs";
const T = await import("../sicherung-takt.mjs");
isoliere();
const B = await import("../backup.mjs");
const MIN = 60000;

test("erste → nötig; gleicher HEAD → unveraendert; neuer HEAD zu früh → zu-frueh; nach 15 min → geaendert", () => {
  const v = neuerTestVault();
  const h1 = T.aktuellerHead(v);
  assert.deepEqual(T.sicherungNoetig(v, { jetzt: 0, head: h1 }), { noetig: true, grund: "erste" });
  T.merkeSicherung(v, { jetzt: 0, head: h1 });
  assert.deepEqual(T.sicherungNoetig(v, { jetzt: 60 * MIN, head: h1 }), { noetig: false, grund: "unveraendert" });
  assert.deepEqual(T.sicherungNoetig(v, { jetzt: 10 * MIN, head: "anders" }), { noetig: false, grund: "zu-frueh" });
  assert.deepEqual(T.sicherungNoetig(v, { jetzt: 16 * MIN, head: "anders" }), { noetig: true, grund: "geaendert" });
  assert.deepEqual(T.sicherungNoetig(v, { jetzt: 0, head: null }), { noetig: false, grund: "kein-head" });
});

test("Sitzungsstart: erste Sicherung pusht, zweite ohne neuen Commit wird übersprungen", () => {
  const v = neuerTestVault({ automatik: { updateHinweis: false, wochenbericht: false } });
  const nackt = tempOrdner("remote");
  git(nackt, "init", "-q", "--bare");
  git(v, "remote", "add", "origin", nackt);
  git(v, "push", "-q", "-u", "origin", "main");
  B.bestaetigeRemote(v, nackt); // der Nutzer hat dieses Ziel bestätigt (sonst pusht der Sitzungsstart nicht)
  const H = join(KIT, "adapters", "claude-code", "session-hintergrund.mjs");
  // QMD_BIN = Fake: der Suchindex-Schritt (kaltes qmd, ~15 s) gehört nicht zu dieser Prüfung
  const env = { ...process.env, BRAIN_VAULT: v, QMD_BIN: join(KIT, "tests", "fake-qmd-cli.mjs") };
  spawnSync(process.execPath, [H], { env, encoding: "utf8" });
  spawnSync(process.execPath, [H], { env, encoding: "utf8" });
  const log = readFileSync(join(v, ".logs", "hooks.log"), "utf8");
  assert.match(log, /Sicherung übersprungen \(unveraendert\)/);
  committe(v, "09_wiki/wissen/a.md", seitenText({ fm: { name: "a", description: "A" } }));
  assert.equal(T.sicherungNoetig(v, { head: T.aktuellerHead(v), jetzt: Date.now() }).grund, "zu-frueh");
});

test("Sitzungsstart: Remote nicht bestätigt (fremder Vault bringt origin mit) → kein Push, Logzeile; bestätigtes anderes Ziel zählt nicht", () => {
  const v = neuerTestVault({ automatik: { updateHinweis: false, wochenbericht: false } });
  const nackt = tempOrdner("remote");
  git(nackt, "init", "-q", "--bare");
  git(v, "remote", "add", "origin", nackt);
  const H = join(KIT, "adapters", "claude-code", "session-hintergrund.mjs");
  const env = { ...process.env, BRAIN_VAULT: v, QMD_BIN: join(KIT, "tests", "fake-qmd-cli.mjs") };
  spawnSync(process.execPath, [H], { env, encoding: "utf8" });
  let log = readFileSync(join(v, ".logs", "hooks.log"), "utf8");
  assert.match(log, /Push übersprungen: Remote nicht bestätigt \(nicht-bestaetigt\)/);
  assert.equal(git(nackt, "for-each-ref").trim(), "", "nichts wurde gepusht");
  B.bestaetigeRemote(v, "https://example.org/anderes.git");
  spawnSync(process.execPath, [H], { env, encoding: "utf8" });
  log = readFileSync(join(v, ".logs", "hooks.log"), "utf8");
  assert.match(log, /\(anderes-remote\)/);
  assert.equal(git(nackt, "for-each-ref").trim(), "", "weiterhin nichts gepusht");
});
