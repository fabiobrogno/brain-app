// .tools/tests/test-pflege-veraltet.mjs — B3 Task 4 (K7): Verlängerung, Sortierung Nutzung × Alter, Deckel 3 je Lauf ohne
// Doppel, Projektseite gegen das Repo (unverändert → Feld-Aufträge, geändert → Rückfrage, kritisch → nie schreiben),
// Archiv-Kandidaten nur bei ausreichend altem Hinweis-Log, Probe legt nichts an.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { isoliere, neuerTestVault, seitenText, schreibeSeite, git, JETZT } from "./tageslauf-hilfe.mjs";
import { tempOrdner } from "./verlauf-fixture.mjs";
const K = await import("../tageslauf/veraltet.mjs");
const { neuerLauf, hinweisNutzung } = await import("../tageslauf/protokoll.mjs");
const R = await import("../rueckfragen.mjs");
isoliere();

const abgelaufen = (name, fm = {}) => seitenText({ fm: { name, description: name, stand: "2026-06-01", pruefen_bis: "2026-09-01", ...fm }, rumpf: `# ${name}\n` });
const ctxVon = (v, opt = {}) => neuerLauf(v, { jetzt: JETZT, claudeBefehl: null, ...opt });
const hint = (v, zeilen) => { mkdirSync(join(v, ".logs"), { recursive: true }); writeFileSync(join(v, ".logs", "hint.log"), zeilen.join("\n") + "\n"); };
const treffer = (zeit, seite) => `${zeit} sid=abc len=20 weg=dienst top=0.700 hits=${encodeURIComponent(seite)} unterdrueckt=0`;
const veraltetRf = (v) => R.listeRueckfragen(v).filter((r) => r.typ === "veraltet");
function repoMitCommit(datum) {
  const r = tempOrdner("repo");
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  Object.assign(env, { GIT_AUTHOR_DATE: datum, GIT_COMMITTER_DATE: datum });
  execFileSync("git", ["-C", r, "init", "-q", "-b", "main"], { env });
  execFileSync("git", ["-C", r, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "Schnittstelle umgebaut"], { env });
  return r;
}

test("verlaengerung und plusTage", () => {
  assert.deepEqual(K.verlaengerung(abgelaufen("a"), "2026-10-22"), [{ feld: "stand", wert: "2026-10-22" }, { feld: "pruefen_bis", wert: "2027-01-20" }]);
  assert.deepEqual(K.verlaengerung(seitenText({ fm: { name: "b", verfall: 30 } }), "2026-10-22"), [{ feld: "stand", wert: "2026-10-22" }]);
});

test("Sortierung: oft genutzte abgelaufene Seite zuerst; nicht abgelaufene gar nicht", () => {
  const v = neuerTestVault({ seiten: { "09_wiki/wissen/a.md": abgelaufen("a"), "09_wiki/wissen/b.md": abgelaufen("b"),
    "09_wiki/wissen/c.md": abgelaufen("c", { pruefen_bis: "2027-01-01" }) } });
  hint(v, Array.from({ length: 5 }, () => treffer("2026-10-01T10:00:00", "09_wiki/wissen/b.md")));
  const k = K.veraltetKandidaten(v, { jetzt: JETZT, nutzung: hinweisNutzung(v) });
  assert.deepEqual(k.map((x) => [x.seite, x.nutzung]), [["09_wiki/wissen/b.md", 5], ["09_wiki/wissen/a.md", 0]]);
});

test("höchstens 3 neue veraltet-Rückfragen je Lauf, nie zwei zur selben Seite", () => {
  const seiten = Object.fromEntries(["a", "b", "c", "d", "e"].map((n) => [`09_wiki/wissen/${n}.md`, abgelaufen(n)]));
  const v = neuerTestVault({ seiten });
  assert.equal(K.veraltetSchritt(ctxVon(v)).rueckfragen, 3);
  assert.equal(K.veraltetSchritt(ctxVon(v, { jetzt: JETZT + 1000 })).rueckfragen, 2);
  assert.equal(K.veraltetSchritt(ctxVon(v, { jetzt: JETZT + 2000 })).rueckfragen, 0);
  assert.equal(veraltetRf(v).length, 5);
  assert.match(veraltetRf(v)[0].beschreibung, /Abgelaufen seit 51 Tagen/);
});

test("Projektseite: Repo seit dem Stand unverändert → Feld-Aufträge statt Rückfrage", () => {
  const repo = repoMitCommit("2026-01-01T10:00:00Z");
  const SEITE = "09_wiki/projekte/orion.md";
  const v = neuerTestVault({ seiten: { [SEITE]: abgelaufen("orion", { stand: "2026-08-01", pfade: [repo] }) } });
  const ctx = ctxVon(v);
  const r = K.veraltetSchritt(ctx);
  assert.deepEqual(r.auftraege.map((a) => [a.art, a.seite, a.feld, a.wert, a.ref]), [
    ["feld", SEITE, "stand", "2026-10-22", "k7-09-wiki-projekte-orion-stand"],
    ["feld", SEITE, "pruefen_bis", "2027-01-20", "k7-09-wiki-projekte-orion-frist"]]);
  assert.equal(r.rueckfragen, 0);
  assert.ok(ctx.aktionen.some((a) => a.stufe === "hinweis" && a.grund === "k7-repo-unveraendert"));
});

test("Projektseite: Repo hat neue Commits → Rückfrage mit Repo-Info; kritisch → nie Feld-Aufträge", () => {
  const repo = repoMitCommit("2026-09-15T10:00:00Z");
  const v = neuerTestVault({ seiten: {
    "09_wiki/projekte/orion.md": abgelaufen("orion", { stand: "2026-08-01", pfade: [repo] }),
    "09_wiki/projekte/vega.md": abgelaufen("vega", { stand: "2026-08-01", pfade: [repoMitCommit("2026-01-01T10:00:00Z")], kritisch: true }) } });
  const r = K.veraltetSchritt(ctxVon(v));
  assert.equal(r.auftraege.length, 0);
  const rf = veraltetRf(v);
  assert.equal(rf.length, 2);
  assert.match(rf.find((x) => x.seite.endsWith("orion.md")).beschreibung, /Repo: 1 Commit\(s\) seit dem Stand \(z\. B\. „Schnittstelle umgebaut“\)/);
});

test("Archiv-Kandidaten: nur wenn das Hinweis-Log 180 Tage zurückreicht; genutzte und frische Seiten nicht", () => {
  const v = neuerTestVault({ seiten: { "09_wiki/wissen/b.md": abgelaufen("b", { pruefen_bis: "2027-01-01" }) } });
  schreibeSeite(v, "09_wiki/wissen/a.md", abgelaufen("a", { pruefen_bis: "2027-01-01" }));
  git(v, "add", "--", "09_wiki/wissen/a.md");
  git(v, "commit", "-qm", "alt", "--date=2026-01-01T10:00:00Z");
  hint(v, [treffer("2026-10-01T10:00:00", "09_wiki/wissen/b.md")]);
  assert.deepEqual(K.archivKandidaten(v, { jetzt: JETZT }), { liste: [], zuJung: true });
  hint(v, [treffer("2026-03-01T10:00:00", "09_wiki/wissen/x.md"), treffer("2026-10-01T10:00:00", "09_wiki/wissen/b.md")]);
  assert.deepEqual(K.archivKandidaten(v, { jetzt: JETZT }), { liste: ["09_wiki/wissen/a.md"], zuJung: false });
});

test("Probe: keine Rückfrage-Dateien, nur Aktionen", () => {
  const v = neuerTestVault({ seiten: { "09_wiki/wissen/a.md": abgelaufen("a") } });
  const ctx = ctxVon(v, { probe: true });
  assert.equal(K.veraltetSchritt(ctx).rueckfragen, 1);
  assert.equal(veraltetRf(v).length, 0);
  assert.ok(ctx.aktionen.some((a) => a.stufe === "rueckfrage" && a.typ === "veraltet"));
});
