// .tools/tests/test-pflege-einheit-schutz.mjs — B3 Task 2: Schutz der Pflege-Einheit — kein Weg an der Diff-Prüfung vorbei:
// neue Dateien/Quellen, 20 %, Beleg-Link, Konflikt, generiert/Schema/Hook/Config/Symlink/Umbenennen, echter pre-commit,
// Commit an der Prüfung vorbei, ungeprüfter Commit beim Übernehmen, umgebogener Worktree-Zeiger.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
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
const SEITE2 = "09_wiki/wissen/tee.md";

test("neue Wiki-Seite und angemeldete Quelle: ein Commit, beide Dateien drin; unangemeldete neue Datei → diff-rot", async () => {
  const { v, ctx, kopie } = aufbau();
  const e = await P.einheit(ctx, kopie, { id: "inbox-n1", art: "inbox", titel: "n1", arbeit: async (p) => {
    writeFileSync(join(p, SEITE2), seitenText({ fm: { name: "tee", description: "Tee" }, rumpf: "# Tee\n" }));
    mkdirSync(join(p, "30_wissen"), { recursive: true }); writeFileSync(join(p, "30_wissen", "notiz.md"), "Rohnotiz\n");
    return { ok: true, neueQuellen: ["30_wissen/notiz.md"] };
  } });
  assert.equal(e.ok, true, JSON.stringify(e));
  assert.deepEqual([...e.dateien].sort(), ["09_wiki/_log.md", SEITE2, "30_wissen/notiz.md"].sort());
  assert.match(readFileSync(join(kopie.pfad, "09_wiki/_log.md"), "utf8"), /- Quelle: 30_wissen\/notiz\.md/);
  const f = await P.einheit(ctx, kopie, { id: "inbox-n2", art: "inbox", titel: "n2", arbeit: async (p) => {
    writeFileSync(join(p, "30_wissen", "heimlich.md"), "x\n"); return { ok: true };
  } });
  assert.deepEqual([f.grund, f.befunde.map((b) => b.regel)], ["diff-rot", ["pfad"]]);
  assert.equal(existsSync(join(kopie.pfad, "30_wissen", "heimlich.md")), false);
  sauber(kopie);
  verwerfeArbeitskopie(v, kopie);
});

test("zu viel entfernt (> 20 %), Beleg-Link weg, Konflikt-Kasten weg → diff-rot; Seite danach unverändert", async () => {
  const kasten = '> [!KONFLIKT] offen — Du entscheidest\n> A: "Orion läuft auf Port 3309" — Quelle: [[30_wissen/a]]\n> B: "Orion läuft auf Port 3310" — Quelle: [[30_wissen/b]]\n';
  const rumpf = `${RUMPF}- Orion läuft · Stand 01.10.2026 · [[30_wissen/belege/2026-10/abc]]\n\n${kasten}`;
  const v = neuerTestVault({ seiten: { [SEITE]: seitenText({ fm: { name: "orion", description: "Orion" }, rumpf }) } });
  const ctx = neuerLauf(v, { jetzt: JETZT, claudeBefehl: null });
  const kopie = P.legePflegeKopieAn(v, ctx.lauf);
  const original = readFileSync(join(kopie.pfad, SEITE), "utf8");
  const lauf = (id, aendere) => P.einheit(ctx, kopie, { id, art: "konsolidieren", titel: id, arbeit: async (p) => {
    writeFileSync(join(p, SEITE), aendere(readFileSync(join(p, SEITE), "utf8"))); return { ok: true }; } });
  let e = await lauf("kons-a", (t) => t.replace(/Zeile [1-6]\.\n/g, ""));
  assert.deepEqual(e.befunde.map((b) => b.regel), ["zu-viel-entfernt"]);
  e = await lauf("kons-b", (t) => t.replace(" · [[30_wissen/belege/2026-10/abc]]", ""));
  assert.deepEqual(e.befunde.map((b) => b.regel), ["beleg-link"]);
  e = await lauf("kons-c", (t) => t.replace(kasten, ""));
  assert.deepEqual(e.befunde.map((b) => b.regel), ["konflikt-aufgeloest"]);
  assert.equal(readFileSync(join(kopie.pfad, SEITE), "utf8"), original);
  assert.equal(git(kopie.pfad, "log", "-1", "--format=%s"), "start");
  e = await lauf("kons-d", (t) => t.replace("Zeile 1.\n", "Zeile 1 (präzisiert).\n"));   // 1 von 14 = 7 % → ok
  assert.equal(e.ok, true, JSON.stringify(e));
  verwerfeArbeitskopie(v, kopie);
});

test("generierte Datei, Schema, Hook, Konfiguration und Symlink-Seite → diff-rot", async () => {
  const { v, ctx, kopie } = aufbau();
  const versuche = {
    "gen-a": (p) => { writeFileSync(join(p, "09_wiki", "_index.md"), "x\n"); },
    "gen-b": (p) => { writeFileSync(join(p, "INDEX.md"), "x\n"); },
    "schema": (p) => { writeFileSync(join(p, "09_wiki", "_schema.md"), "x\n"); },
    "hook": (p) => { haengeAn(p, ".hooks/pre-commit", "exit 0\n"); },
    "config": (p) => { haengeAn(p, "brain.config.json", " \n"); },
    "link": (p) => { symlinkSync(join(v, SEITE), join(p, SEITE2)); },
    "linkersatz": (p) => { rmSync(join(p, SEITE)); symlinkSync(join(v, SEITE), join(p, SEITE)); },
  };
  const erwartet = { "gen-a": "generiert", "gen-b": "generiert", schema: "pfad", hook: "pfad", config: "pfad", link: "pfad", linkersatz: "pfad" };
  for (const [id, f] of Object.entries(versuche)) {
    const e = await P.einheit(ctx, kopie, { id, art: "inbox", titel: id, arbeit: async (p) => { f(p); return { ok: true }; } });
    assert.equal(e.grund, "diff-rot", `${id}: ${JSON.stringify(e)}`);
    assert.equal(e.befunde[0].regel, erwartet[id], id);
    sauber(kopie);
    assert.equal(git(kopie.pfad, "log", "-1", "--format=%s"), "start");
  }
  assert.equal(readFileSync(join(v, SEITE), "utf8").includes("exit 0"), false);
  verwerfeArbeitskopie(v, kopie);
});

test("Umbenennen einer Seite (git mv) → diff-rot wegen Löschen, Arbeitskopie wieder sauber", async () => {
  const { v, ctx, kopie } = aufbau();
  const e = await P.einheit(ctx, kopie, { id: "inbox-mv", art: "inbox", titel: "mv", arbeit: async (p) => {
    git(p, "mv", SEITE, "09_wiki/wissen/orion-neu.md"); return { ok: true }; } });
  assert.equal(e.grund, "diff-rot", JSON.stringify(e));
  assert.deepEqual(e.befunde.map((b) => b.regel), ["geloescht"]);
  assert.ok(existsSync(join(kopie.pfad, SEITE)));
  assert.equal(existsSync(join(kopie.pfad, "09_wiki/wissen/orion-neu.md")), false);
  sauber(kopie);
  verwerfeArbeitskopie(v, kopie);
});

test("echter pre-commit: gute Einheit besteht (REV, _log); ein Secret im Text → pruefung-rot, nichts committet", async () => {
  const v = neuerTestVault({ hook: "echt", seiten: { [SEITE]: seitenText({ fm: { name: "orion", description: "Orion" }, rumpf: RUMPF }) } });
  const ctx = neuerLauf(v, { jetzt: JETZT, claudeBefehl: null });
  const kopie = P.legePflegeKopieAn(v, ctx.lauf);
  const gut = await P.einheit(ctx, kopie, { id: "inbox-echt", art: "inbox", titel: "echt", arbeit: async (p) => { haengeAn(p, SEITE, "Neu: Orion nutzt Redis.\n"); return { ok: true }; } });
  assert.equal(gut.ok, true, JSON.stringify(gut));
  const kopfGut = git(kopie.pfad, "rev-parse", "HEAD");
  const rot = await P.einheit(ctx, kopie, { id: "inbox-geheim", art: "inbox", titel: "geheim", arbeit: async (p) => {
    haengeAn(p, SEITE, `${"Mein Pass" + "wort lautet: " + "Wiesel" + "4711!"}\n`); return { ok: true }; } });
  assert.equal(rot.grund, "pruefung-rot", JSON.stringify(rot));
  assert.match(rot.befunde[0].meldung, /SECRETS/);
  assert.equal(git(kopie.pfad, "rev-parse", "HEAD"), kopfGut);
  sauber(kopie);
  const m = P.uebernehmePflege(ctx, kopie);
  assert.deepEqual([m.ok, [...m.commits.keys()]], [true, ["inbox-echt"]]);
  assert.equal(readFileSync(join(v, SEITE), "utf8").includes("Wiesel"), false);
  verwerfeArbeitskopie(v, kopie);
});

test("Arbeit committet selbst an der Prüfung vorbei → verworfen, Pflege gestoppt, kein Merge; weitere Einheiten laufen nicht mehr", async () => {
  const { v, ctx, kopie } = aufbau();
  const vorher = git(v, "rev-parse", "HEAD");
  const e = await P.einheit(ctx, kopie, { id: "inbox-c1", art: "inbox", titel: "c1", arbeit: async (p) => {
    haengeAn(p, SEITE, "heimlich\n"); git(p, "add", "--", SEITE); git(p, "commit", "-qm", "an der Prüfung vorbei"); return { ok: true }; } });
  assert.deepEqual([e.ok, e.grund, e.befunde[0].regel], [false, "arbeit-fehler", "kopie-veraendert"]);
  assert.equal(ctx.pflegeStopp, true);
  assert.equal(git(kopie.pfad, "log", "-1", "--format=%s"), "start");
  assert.equal(readFileSync(join(kopie.pfad, SEITE), "utf8").includes("heimlich"), false);
  let lief = false;
  const f = await P.einheit(ctx, kopie, { id: "inbox-c2", art: "inbox", titel: "c2", arbeit: async () => { lief = true; return { ok: true }; } });
  assert.deepEqual([f.ok, f.grund, lief], [false, "pflege-gestoppt", false]);
  assert.deepEqual(P.uebernehmePflege(ctx, kopie).commits.size, 0);
  assert.equal(git(v, "rev-parse", "HEAD"), vorher);
  verwerfeArbeitskopie(v, kopie);
});

test("Commit der Arbeit NACH der letzten Einheit (z. B. Nachlauf) → uebernehmePflege verweigert: ungeprueft; main bleibt", async () => {
  const { v, ctx, kopie } = aufbau();
  const e = await P.einheit(ctx, kopie, { id: "inbox-u1", art: "inbox", titel: "u1", arbeit: async (p) => { haengeAn(p, SEITE, "eins\n"); return { ok: true }; } });
  assert.equal(e.ok, true);
  haengeAn(kopie.pfad, SEITE, "ungeprüft\n"); git(kopie.pfad, "add", "--", SEITE); git(kopie.pfad, "commit", "-qm", "ungeprüft");
  const vorher = git(v, "rev-parse", "HEAD");
  const m = P.uebernehmePflege(ctx, kopie);
  assert.deepEqual([m.ok, m.grund, m.commits.size], [false, "ungeprueft", 0]);
  assert.equal(git(v, "rev-parse", "HEAD"), vorher);
  verwerfeArbeitskopie(v, kopie);
});
