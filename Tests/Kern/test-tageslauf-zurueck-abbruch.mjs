// .tools/tests/test-tageslauf-zurueck-abbruch.mjs — „Eine Rücknahme, die nicht sauber geht, ändert NICHTS und meldet den Grund"
// (B2, Task 12): Vault, HEAD, Branches, Arbeitskopien und Aktionsprotokoll bleiben unverändert (aendertNichts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { isoliere, committe, neuerTestVault } from "./tageslauf-hilfe.mjs";
import { tempOrdner } from "./verlauf-fixture.mjs";
import { Zr, P, git, seitenText, JETZT, SEITE, MIT_STAND, MIT_FAKTEN, vault, seite, link, vo, simuliereLauf, simuliereAuftrag, fakt, stand, feld, aendertNichts, zustand } from "./zurueck-hilfe.mjs";
isoliere();

const nimm = (v, opt) => aendertNichts(v, () => Zr.nimmZurueck(v, { jetzt: JETZT + 9 * 60e3, ...opt }));
const grundVon = (r) => [r.ok, r.grund];
const aktionenDatei = (v) => join(v, ".logs", "tageslauf", "aktionen.jsonl");

test("später kam ein neuer Stand → der ältere Stand lässt sich nicht allein zurücknehmen; beide zusammen schon", () => {
  const v = vault(MIT_STAND);
  simuliereAuftrag(v, 1, stand("s1", "- Erledigt: eins"));
  simuliereAuftrag(v, 2, stand("s2", "- Erledigt: zwei"));
  assert.deepEqual(grundVon(nimm(v, { ids: ["s1"] })), [false, "von-hand-geaendert"]);
  const beide = Zr.nimmZurueck(v, { ids: ["s1", "s2"], jetzt: JETZT + 9 * 60e3 });
  assert.deepEqual([beide.ok, beide.zurueck], [true, 2]);
  assert.deepEqual(zustand(v), zustand(vault(MIT_STAND)));
});

test("Stand von Hand nachbearbeitet (Link bleibt) → von-hand-geaendert", () => {
  const v = vault(MIT_STAND);
  simuliereAuftrag(v, 1, stand("s1", "- Erledigt: neu"));
  committe(v, SEITE, seite(v).replace("- Erledigt: neu", "- Erledigt: neu (korrigiert)").replace(/^rev: 2$/m, "rev: 3"), "von Hand");
  assert.deepEqual(grundVon(nimm(v, { ids: ["s1"] })), [false, "von-hand-geaendert"]);
});

test("Verlauf von Hand ergänzt → von-hand-geaendert", () => {
  const v = vault(MIT_STAND);
  simuliereAuftrag(v, 1, stand("s1", "- Erledigt: neu"));
  committe(v, SEITE, seite(v).replace("## Verlauf\n\n", "## Verlauf\n\n- 21.10.2026: von Hand\n").replace(/^rev: 2$/m, "rev: 3"), "von Hand");
  assert.deepEqual(grundVon(nimm(v, { ids: ["s1"] })), [false, "von-hand-geaendert"]);
});

test("Feld inzwischen anders gesetzt → von-hand-geaendert", () => {
  const v = vault();
  simuliereAuftrag(v, 1, feld("rf-20261022-zweifel-ccc333", "2026-10-22: neu"));
  committe(v, SEITE, seite(v).replace(/^zweifel: .*$/m, 'zweifel: "geklärt"').replace(/^rev: 2$/m, "rev: 3"), "von Hand");
  assert.deepEqual(grundVon(nimm(v, { ids: ["rf-20261022-zweifel-ccc333"] })), [false, "von-hand-geaendert"]);
});

test("ungespeicherte Änderung an der Seite → lokale-aenderung", () => {
  const v = vault();
  simuliereAuftrag(v, 1, (w) => fakt(w, "l1", "Alpha nutzt Port 3310."));
  writeFileSync(join(v, SEITE), `${seite(v)}\nlokal dazugeschrieben\n`);
  assert.deepEqual(grundVon(nimm(v, { ids: ["l1"] })), [false, "lokale-aenderung"]);
  assert.match(seite(v), /lokal dazugeschrieben/);
});

test("Vault nicht auf main → vault-nicht-auf-main", () => {
  const v = vault();
  simuliereAuftrag(v, 1, (w) => fakt(w, "m1", "Alpha nutzt Port 3310."));
  git(v, "checkout", "-q", "-b", "nebenbei");
  assert.deepEqual(grundVon(nimm(v, { ids: ["m1"] })), [false, "vault-nicht-auf-main"]);
});

test("/ingest läuft (frische Sperre) → ingest-laeuft, die fremde Sperre bleibt", () => {
  const v = vault();
  simuliereAuftrag(v, 1, (w) => fakt(w, "i1", "Alpha nutzt Port 3310."));
  writeFileSync(join(v, ".logs", "ingest.lock"), "ingest 1\n");
  assert.deepEqual(grundVon(nimm(v, { ids: ["i1"] })), [false, "ingest-laeuft"]);
  assert.equal(readFileSync(join(v, ".logs", "ingest.lock"), "utf8"), "ingest 1\n");
});

test("Commit-Prüfung rot → pruefung-rot (die Prüfung wird nie umgangen)", () => {
  const v = vault();
  simuliereAuftrag(v, 1, (w) => fakt(w, "r1", "Alpha nutzt Port 3310."));
  const rot = tempOrdner("hook-rot");
  writeFileSync(join(rot, "pre-commit"), "#!/bin/sh\necho '- SECRETS: Testbefund'\nexit 2\n");
  chmodSync(join(rot, "pre-commit"), 0o755);
  git(v, "config", "core.hooksPath", rot);
  assert.deepEqual(grundVon(nimm(v, { ids: ["r1"] })), [false, "pruefung-rot"]);
});

test("Probemodus schreibt nichts: mit ctx.probe ändert nimmZurueck weder Seite noch Protokoll", () => {
  const v = vault();
  simuliereAuftrag(v, 1, (w) => fakt(w, "q1", "Alpha nutzt Port 3310."));
  const ctx = P.neuerLauf(v, { probe: true, claudeBefehl: null, jetzt: JETZT + 5 * 60e3 });
  assert.deepEqual(grundVon(nimm(v, { ids: ["q1"], ctx })), [false, "probe"]);
});

test("ohne Eintrag im Aktionsprotokoll heilt `brain zurueck` selbst (heilung.mjs: die Aktion wird aus dem Commit rekonstruiert) — eine unbekannte ID bleibt nichts-gefunden", () => {
  const v = vault();
  simuliereAuftrag(v, 1, (w) => fakt(w, "k1", "Alpha nutzt Port 3310."));
  writeFileSync(aktionenDatei(v), "");
  assert.deepEqual(grundVon(nimm(v, { ids: ["gibt-es-nicht"] })), [false, "nichts-gefunden"], "zu einer unbekannten ID gibt es auch keinen Commit");
  const r = Zr.nimmZurueck(v, { ids: ["k1"], jetzt: JETZT + 9 * 60e3 });   // nicht über nimm(): die Heilung schreibt das Protokoll, das Zurücknehmen den Vault
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.zurueck, 1);
  assert.ok(!seite(v).includes(link("k1")), "die Zeile ist zurückgenommen");
});

test("manipuliertes Aktionsprotokoll (Ziel/Beleg außerhalb des Üblichen) → nichts passiert, nichts wird gelöscht", () => {
  // Seite außerhalb des Wikis, die zufällig genau so aussieht, wie die Rücknahme sie erwartet — und eine Wiki-Seite mit Link auf _log.
  const kopieText = seitenText({ fm: { quellen: ["10_projekte/belege/2026-10/t1.md"], quellen_sha: ["abcd"] }, rumpf: `# Kopie\n\n- Alpha nutzt Port 3310. · Stand 20.10.2026 · [[${link("t1")}]]\n` });
  const v = neuerTestVault({ hook: "echt", seiten: { [SEITE]: seitenText({ fm: { name: "alpha", description: "Alpha" }, rumpf: `${MIT_FAKTEN}- Hinweis · [[09_wiki/_log]]\n` }), "10_projekte/kopie.md": kopieText } });
  committe(v, "10_projekte/kopie.md", kopieText, "Kopie");
  simuliereLauf(v, 1, [fakt(v, "t1", "Alpha nutzt Port 3310.")]);
  const original = readFileSync(aktionenDatei(v), "utf8");
  const mit = (aus) => writeFileSync(aktionenDatei(v), original.split("\n").filter(Boolean).map((z) => JSON.stringify({ ...JSON.parse(z), ...aus })).join("\n") + "\n");
  for (const aus of [{ ziel: "10_projekte/kopie.md" }, { ziel: "brain.config.json" }, { ziel: "09_wiki/../brain.config.json" }, { beleg: "../brain.config.json" }, { beleg: "09_wiki/_log.md" }]) {
    mit(aus);
    const r = nimm(v, { ids: ["t1"] });
    assert.equal(r.ok, false, JSON.stringify(aus));
  }
  assert.equal(readFileSync(join(v, "10_projekte", "kopie.md"), "utf8"), kopieText);
});

test("ganzer Lauf, aber der Commit geht nicht sauber zurück → ok:false ohne jede Änderung, auch die Verschiebungen bleiben", () => {
  const v = vault();
  const lauf = simuliereLauf(v, 1, [fakt(v, "p1", "Alpha nutzt Port 3310.")], { aussortiert: [vo(v, "d1", "Doppelt.")] });
  committe(v, SEITE, seite(v).replace(/^- Alpha nutzt Port 3310\..*\n/m, "").replace(/^rev: 2$/m, "rev: 3"), "von Hand");
  assert.deepEqual(grundVon(nimm(v, { lauf })), [false, "von-hand-geaendert"]);
  assert.ok(existsSync(join(v, "90_archiv", "vorschlaege-aussortiert", "dublette", "d1.md")));
});
