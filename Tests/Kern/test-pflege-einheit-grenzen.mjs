// .tools/tests/test-pflege-einheit-grenzen.mjs — B3 Task 2: Grenzfälle der Pflege-Einheit: Vault-Wächter (auch bei gescheiterter Arbeit),
// Fehler der Arbeit ohne Stacktrace, ID/rev, Rebase und lokale Änderung beim Übernehmen, Hilfsfunktionen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { isoliere, git, neuerTestVault, seitenText, JETZT } from "./tageslauf-hilfe.mjs";
const P = await import("../tageslauf/pflege-kopie.mjs");
const { verwerfeArbeitskopie } = await import("../tageslauf/arbeitskopie.mjs");
const { neuerLauf } = await import("../tageslauf/protokoll.mjs");
isoliere();

const SEITE = "09_wiki/wissen/orion.md";
const RUMPF = `# Orion\n\n${Array.from({ length: 10 }, (_, i) => `Zeile ${i + 1}.`).join("\n")}\n`;
function aufbau(fm = {}) {
  const v = neuerTestVault({ seiten: { [SEITE]: seitenText({ fm: { name: "orion", description: "Orion", ...fm }, rumpf: RUMPF }) } });
  const ctx = neuerLauf(v, { jetzt: JETZT, claudeBefehl: null });
  return { v, ctx, kopie: P.legePflegeKopieAn(v, ctx.lauf) };
}
const haengeAn = (wurzel, rel, text) => writeFileSync(join(wurzel, rel), readFileSync(join(wurzel, rel), "utf8") + text);
const sauber = (kopie) => assert.equal(git(kopie.pfad, "status", "--porcelain", "--ignored"), "");

// ---- Schutzlücken schließen: kein Weg an der Diff-Prüfung vorbei ---------------------------------------------------------

test("Arbeit biegt den Zeiger der Arbeitskopie (.git) um → Integrität verletzt, Zeiger zurück, Vault unberührt, Pflege gestoppt", async () => {
  const { v, ctx, kopie } = aufbau();
  const zeiger = join(kopie.pfad, ".git");
  const original = readFileSync(zeiger, "utf8");
  const vorher = git(v, "rev-parse", "HEAD");
  const e = await P.einheit(ctx, kopie, { id: "inbox-z1", art: "inbox", titel: "z1", arbeit: async (p) => {
    haengeAn(p, SEITE, "x\n"); writeFileSync(join(p, ".git"), `gitdir: ${join(v, ".git")}\n`); return { ok: true }; } });
  assert.equal(e.grund, "integritaet-verletzt", JSON.stringify(e));
  assert.ok(e.befunde.some((b) => b.meldung === "Integrität verletzt: Arbeitskopie/.git"), JSON.stringify(e.befunde));
  assert.equal(ctx.pflegeStopp, true);
  assert.equal(readFileSync(zeiger, "utf8"), original);
  assert.equal(git(v, "rev-parse", "HEAD"), vorher);
  assert.equal(git(v, "status", "--porcelain"), "");
  sauber(kopie);
  verwerfeArbeitskopie(v, kopie);
});

test("Arbeit schreibt eine NEUE Datei in den echten Vault (Wiki oder .tools) → Integrität verletzt; Inbox/.logs/Archiv zählen nicht", async () => {
  const { v, ctx, kopie } = aufbau();
  let e = await P.einheit(ctx, kopie, { id: "inbox-v1", art: "inbox", titel: "v1", arbeit: async () => {
    mkdirSync(join(v, "00_inbox"), { recursive: true }); writeFileSync(join(v, "00_inbox", "neu.md"), "x"); mkdirSync(join(v, ".logs"), { recursive: true }); writeFileSync(join(v, ".logs", "l"), "x");
    return { ok: false, grund: "ki-nichts" }; } });
  assert.equal(e.grund, "ki-nichts");
  assert.equal(ctx.pflegeStopp, undefined);
  e = await P.einheit(ctx, kopie, { id: "inbox-v2", art: "inbox", titel: "v2", arbeit: async () => {
    writeFileSync(join(v, "09_wiki", "wissen", "heimlich.md"), "x\n"); return { ok: false, grund: "ki-nichts" }; } });
  assert.equal(e.grund, "integritaet-verletzt");                   // der Wächter schlägt auch bei gescheiterter Arbeit zu
  assert.ok(e.befunde.some((b) => b.meldung === "Integrität verletzt: 09_wiki/wissen/heimlich.md"), JSON.stringify(e.befunde));
  assert.equal(ctx.pflegeStopp, true);
  verwerfeArbeitskopie(v, kopie);
});

test("Arbeit wirft einen Fehler → arbeit-fehler mit kurzer Meldung, kein Stacktrace, Arbeitskopie sauber", async () => {
  const { v, ctx, kopie } = aufbau();
  const e = await P.einheit(ctx, kopie, { id: "inbox-x1", art: "inbox", titel: "x1", arbeit: async (p) => { haengeAn(p, SEITE, "x\n"); throw new Error("kaputt\n    at irgendwo.js:1"); } });
  assert.equal(e.grund, "arbeit-fehler");
  assert.equal(e.befunde[0].meldung.includes("\n"), false);
  sauber(kopie);
  verwerfeArbeitskopie(v, kopie);
});

test("ungültige ID → id-ungueltig ohne Arbeit; rev wird vom Knoten gesetzt, nicht von der Arbeit", async () => {
  const { v, ctx, kopie } = aufbau();
  let lief = false;
  const e = await P.einheit(ctx, kopie, { id: "Ungültig!", art: "inbox", titel: "x", arbeit: async () => { lief = true; return { ok: true }; } });
  assert.deepEqual([e.ok, e.grund, lief], [false, "id-ungueltig", false]);
  const f = await P.einheit(ctx, kopie, { id: "inbox-r1", art: "inbox", titel: "r1", arbeit: async (p) => {
    writeFileSync(join(p, SEITE), readFileSync(join(p, SEITE), "utf8").replace(/^rev: 1$/m, "rev: 77") + "Neu.\n"); return { ok: true }; } });
  assert.equal(f.ok, true);
  assert.match(readFileSync(join(kopie.pfad, SEITE), "utf8"), /^rev: 2$/m);
  verwerfeArbeitskopie(v, kopie);
});

test("main läuft während der Pflege weiter → uebernehmePflege rebased, commits-Map zeigt die neuen Hashes in main", async () => {
  const { v, ctx, kopie } = aufbau();
  const e = await P.einheit(ctx, kopie, { id: "inbox-m1", art: "inbox", titel: "m1", arbeit: async (p) => { haengeAn(p, SEITE, "eins\n"); return { ok: true }; } });
  assert.equal(e.ok, true);
  writeFileSync(join(v, "09_wiki", "wissen", "tee.md"), seitenText({ fm: { name: "tee", description: "Tee" }, rumpf: "Tee.\n" }));
  git(v, "add", "--", "09_wiki/wissen/tee.md"); git(v, "commit", "-qm", "Nutzer schreibt");
  const m = P.uebernehmePflege(ctx, kopie);
  assert.equal(m.ok, true, JSON.stringify([...m.commits]));
  assert.equal(m.commits.get("inbox-m1"), git(v, "rev-parse", "HEAD"));
  assert.match(readFileSync(join(v, SEITE), "utf8"), /eins\n$/);
  assert.ok(existsSync(join(v, "09_wiki", "wissen", "tee.md")));
  verwerfeArbeitskopie(v, kopie);
});

test("Der Nutzer ändert eine Datei im Vault, bevor übernommen wird → kein Überschreiben (lokale-aenderung)", async () => {
  const { v, ctx, kopie } = aufbau();
  await P.einheit(ctx, kopie, { id: "inbox-l1", art: "inbox", titel: "l1", arbeit: async (p) => { haengeAn(p, SEITE, "eins\n"); return { ok: true }; } });
  haengeAn(v, SEITE, "Nutzer-Änderung\n");
  const m = P.uebernehmePflege(ctx, kopie);
  assert.deepEqual([m.ok, m.grund], [false, "lokale-aenderung"]);
  assert.match(readFileSync(join(v, SEITE), "utf8"), /Nutzer-Änderung\n$/);
  verwerfeArbeitskopie(v, kopie);
});

test("Hilfen: slug, pflegeBetreff, BETREFF_PFLEGE, ID_MUSTER, pflegeLogEintrag, statusEintraege mit führendem Leerzeichen", () => {
  assert.equal(P.slug("Käse & Brot.md"), "kase-brot");
  assert.equal(P.slug("   "), "x");
  assert.equal(P.slug("Straße"), "strasse");
  const b = P.pflegeBetreff({ lauf: "20261022-030000", art: "inbox", titel: "Mehr\nzeilig  Titel", id: "inbox-a" });
  assert.equal(b, "pflege(20261022-030000): inbox Mehr zeilig Titel [inbox-a]");
  assert.deepEqual(b.match(P.BETREFF_PFLEGE).slice(1), ["20261022-030000", "inbox-a"]);
  assert.equal(P.BETREFF_PFLEGE.test("auto(20261022-030000): x [id]"), false);
  assert.equal(P.ID_MUSTER.test("a".repeat(80)) && !P.ID_MUSTER.test("a".repeat(81)) && !P.ID_MUSTER.test("A") && !P.ID_MUSTER.test(""), true);
  assert.match(P.pflegeLogEintrag({ zeit: "2026-10-22 05:00", lauf: "L", art: "neue-seite", titel: "t", seiten: ["a/b.md"], quelle: "q.md" }),
    /^## 2026-10-22 05:00 — pflege\(L\): neue Seite: t\n- Seiten geändert\/neu: a\/b\.md\n- Quelle: q\.md\n- Tageslauf \(Pflege\), automatisch — rückgängig: brain zurueck L$/);
  const { v, kopie } = aufbau();
  haengeAn(v, SEITE, "x\n");
  assert.deepEqual(P.statusEintraege(v, v), [{ xy: " M", pfad: SEITE }]);
  verwerfeArbeitskopie(v, kopie);
});
