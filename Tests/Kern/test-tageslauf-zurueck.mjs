// .tools/tests/test-tageslauf-zurueck.mjs — brain zurueck (B2, Task 12). Läuft mit der ECHTEN Commit-Prüfung (hook „echt"):
// rev+1, _log append-only, Beleg weg. Der Tageslauf wird hier mit den Bausteinen aus Task 7 nachgestellt (zurueck-hilfe.mjs).
// Weitere Dateien zu Task 12: -sauber-fakt / -sauber-rest („als wäre es nie übernommen worden") und -abbruch (nicht sauber → nichts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { isoliere, committe, KIT } from "./tageslauf-hilfe.mjs";
import { Zr, P, git, seitenText, JETZT, SEITE, ALT, MIT_FAKTEN, vault, vo, seite, link, zeileVon, simuliereLauf, simuliereAuftrag, fakt, zustand, aendertNichts } from "./zurueck-hilfe.mjs";
isoliere();

test("älterer Fakt zurück, neuerer auf derselben Seite bleibt — echte Commit-Prüfung grün, _log nur oben ergänzt, zählt als Fehler", () => {
  const v = vault();
  simuliereLauf(v, 1, [{ art: "fakt", seite: SEITE, v: vo(v, "a1", "Alpha nutzt Port 3310."), titel: "a1" }]);
  simuliereLauf(v, 2, [{ art: "fakt", seite: SEITE, v: vo(v, "a2", "Alpha sichert stündlich."), titel: "a2" }]);
  const logVorher = readFileSync(join(v, "09_wiki", "_log.md"), "utf8");
  const r = Zr.nimmZurueck(v, { ids: ["a1"], jetzt: JETZT + 5 * 60e3 });
  assert.equal(r.ok, true, JSON.stringify(r));
  const t = seite(v);
  assert.doesNotMatch(t, /belege\/2026-10\/a1/);
  assert.match(t, /- Alpha sichert stündlich\. · Stand 20\.10\.2026 · \[\[10_projekte\/belege\/2026-10\/a2\]\]/);
  assert.match(t, /^quellen: \["10_projekte\/belege\/2026-10\/a2\.md"\]$/m);
  assert.match(t, /^rev: 4$/m);
  assert.ok(!existsSync(join(v, "10_projekte", "belege", "2026-10", "a1.md")));
  const log = readFileSync(join(v, "09_wiki", "_log.md"), "utf8");
  assert.ok(log.includes(logVorher.slice(logVorher.indexOf("\n## 20"))), "Bestand des _log unverändert");
  assert.ok(log.indexOf("— zurueck:") < log.indexOf("auto("), "neuer Eintrag oben");
  assert.match(git(v, "log", "-1", "--format=%an|%s"), /^Brain-Tageslauf\|zurueck: a1/);
  assert.ok(existsSync(join(v, "90_archiv", "vorschlaege-abgelehnt", "a1.md")));
  assert.deepEqual(P.lesePruefungen(v).map((p) => [p.art, p.fehler, p.aktion]), [["zurueck", true, "a1"]]);
  assert.deepEqual(P.autoUebernahmen(P.leseAktionen(v)).map((a) => a.id), ["a2"]);
  assert.deepEqual(Zr.findeCommits(v, { ids: ["a1"] }), [], "nicht zweimal");
});

test("ganzer Lauf: Ersetzen stellt die alte Zeile exakt wieder her, Feld fällt weg, Aussortiertes kommt zurück in die Inbox", () => {
  const v = vault();
  const d = vo(v, "d1", "Doppelt.");
  const lauf = simuliereLauf(v, 1, [
    { art: "ersetzen", seite: SEITE, v: vo(v, "e1", "Backups laufen stündlich."), zeile: ALT, titel: "e1" },
    { art: "feld", seite: SEITE, feld: "zweifel", wert: "2026-10-22: Test", ref: "rf-20261022-zweifel-abc123", titel: "Zweifel" },
  ], { aussortiert: [d] });
  assert.match(seite(v), /~~Backups täglich~~/);
  const r = Zr.nimmZurueck(v, { lauf, jetzt: JETZT + 5 * 60e3 });
  assert.deepEqual([r.ok, r.zurueck, r.verschoben], [true, 2, 1]);
  const t = seite(v);
  assert.ok(t.includes(`\n${ALT}\n`));
  assert.doesNotMatch(t, /~~|^zweifel:|stündlich/m);
  assert.match(t, /^quellen: \[\]$/m);
  assert.ok(existsSync(join(v, "00_inbox", "_vorschlaege", "d1.md")));
});

test("von Hand geändert → nichts zurückgenommen, main unverändert; CLI 64 / 1 / 0", () => {
  const v = vault();
  simuliereLauf(v, 1, [{ art: "fakt", seite: SEITE, v: vo(v, "h1", "Alpha hat 4 Kerne."), titel: "h1" }]);
  committe(v, SEITE, seite(v).replace(/^- Alpha hat 4 Kerne\..*\n/m, "").replace(/^rev: 2$/m, "rev: 3"), "von Hand");
  const kopf = git(v, "rev-parse", "HEAD");
  assert.equal(Zr.nimmZurueck(v, { ids: ["h1"] }).grund, "von-hand-geaendert");
  assert.equal(git(v, "rev-parse", "HEAD"), kopf);
  assert.equal(git(v, "branch", "--list", "tageslauf/*"), "");
  const lauf2 = simuliereLauf(v, 2, [{ art: "fakt", seite: SEITE, v: vo(v, "h2", "Alpha hat eine SSD."), titel: "h2" }]);
  const cli = (...a) => spawnSync(process.execPath, [join(KIT, "tageslauf", "zurueck.mjs"), v, ...a], { encoding: "utf8" });
  assert.equal(cli().status, 64);
  assert.equal(cli("gibts-nicht").status, 1);
  const ok = cli(lauf2);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /^Zurückgenommen: 1 Änderung/);
  assert.doesNotMatch(seite(v), /SSD/);
});

// ── Zusatz ─────────────────────────────────────────────────────────────────────────────────────────────────────────

test("Kette: später ersetzt ein Lauf die Zeile des ersten — a1 allein geht nicht, beide zusammen ergeben den Ausgangszustand", () => {
  const x = vault(), y = vault();
  simuliereLauf(x, 1, [fakt(x, "a1", "Alpha nutzt Port 3310.")]);
  simuliereLauf(x, 2, [{ art: "ersetzen", seite: SEITE, v: vo(x, "b1", "Alpha nutzt Port 3311."), zeile: zeileVon("a1", "Alpha nutzt Port 3310."), titel: "b1" }]);
  const allein = aendertNichts(x, () => Zr.nimmZurueck(x, { ids: ["a1"], jetzt: JETZT + 9 * 60e3 }));
  assert.deepEqual([allein.ok, allein.grund], [false, "von-hand-geaendert"], "die Zeile ist durchgestrichen");
  const r = Zr.nimmZurueck(x, { ids: ["a1", "b1"], jetzt: JETZT + 10 * 60e3 });
  assert.deepEqual([r.ok, r.zurueck], [true, 2], JSON.stringify(r));
  assert.deepEqual(zustand(x), zustand(y));
});

test("eine Änderung von Hand umgeschrieben (Link bleibt): sie bleibt stehen, die übrigen des Laufs gehen zurück", () => {
  const v = vault();
  const lauf = simuliereLauf(v, 1, [fakt(v, "p1", "Alpha nutzt Port 3310."), fakt(v, "p2", "Alpha hat 4 Kerne.")]);
  committe(v, SEITE, seite(v).replace("Alpha hat 4 Kerne.", "Alpha hat 8 Kerne.").replace(/^rev: 3$/m, "rev: 4"), "von Hand");
  const r = Zr.nimmZurueck(v, { lauf, jetzt: JETZT + 5 * 60e3 });
  assert.deepEqual([r.ok, r.zurueck, r.uebersprungen.map((u) => [u.id, u.grund])], [true, 1, [["p2", "von-hand-geaendert"]]]);
  assert.doesNotMatch(seite(v), /3310/);
  assert.match(seite(v), /8 Kerne/);
  assert.deepEqual(P.autoUebernahmen(P.leseAktionen(v)).map((a) => a.id), ["p2"]);
  assert.ok(existsSync(join(v, "90_archiv", "vorschlaege-uebernommen", "p2.md")), "der nicht zurückgenommene Vorschlag bleibt bei den übernommenen");
});

test("unbekannte ID/Lauf → nichts-gefunden; ein ganzer Lauf zum zweiten Mal → nichts-gefunden (Verschiebungen nur einmal)", () => {
  const v = vault();
  const d = vo(v, "d1", "Doppelt.");
  const lauf = simuliereLauf(v, 1, [fakt(v, "z1", "Alpha nutzt Port 3310.")], { aussortiert: [d] });
  assert.equal(Zr.nimmZurueck(v, { ids: ["gibts-nicht"] }).grund, "nichts-gefunden");
  assert.equal(Zr.nimmZurueck(v, { lauf: "20200101-000000" }).grund, "nichts-gefunden");
  const erst = Zr.nimmZurueck(v, { lauf, jetzt: JETZT + 5 * 60e3 });
  assert.deepEqual([erst.ok, erst.zurueck, erst.verschoben], [true, 1, 1]);
  assert.equal(Zr.nimmZurueck(v, { lauf, jetzt: JETZT + 6 * 60e3 }).grund, "nichts-gefunden");
});

test("Rücknahme einer Rückfrage-Antwort (nicht auto) zählt nicht als Fehler; alsFehler:false auch bei auto nicht", () => {
  const v = vault();
  simuliereAuftrag(v, 1, (w) => fakt(w, "u1", "Alpha nutzt Port 3310."));
  const f = join(v, ".logs", "tageslauf", "aktionen.jsonl");
  writeFileSync(f, readFileSync(f, "utf8").split("\n").filter(Boolean).map((z) => JSON.stringify({ ...JSON.parse(z), auto: false })).join("\n") + "\n");
  assert.equal(Zr.nimmZurueck(v, { ids: ["u1"], jetzt: JETZT + 5 * 60e3 }).ok, true);
  assert.deepEqual(P.lesePruefungen(v), []);
  const w = vault();
  simuliereAuftrag(w, 1, (x) => fakt(x, "u2", "Alpha nutzt Port 3310."));
  assert.equal(Zr.nimmZurueck(w, { ids: ["u2"], alsFehler: false, jetzt: JETZT + 5 * 60e3 }).ok, true);
  assert.deepEqual(P.lesePruefungen(w), []);
});

test("macheRueckgaengig: kaputtes Frontmatter oder fehlende Stelle → null statt Absturz", () => {
  const a = { stufe: "uebernehmen", beleg: "10_projekte/belege/2026-10/a1.md", ziel: SEITE };
  const s = seitenText({ rumpf: MIT_FAKTEN });
  assert.equal(Zr.macheRueckgaengig("ohne Frontmatter", s, a), null);
  assert.equal(Zr.macheRueckgaengig(s, s, a), null);
  assert.equal(Zr.macheRueckgaengig(s, s, { stufe: "feld" }), null);
  assert.equal(Zr.macheRueckgaengig(s, s, { stufe: "feld", feld: "rev" }), null);
  assert.equal(Zr.macheRueckgaengig(s, s, { ...a, beleg: "../../etc/passwd" }), null);
  const mit = s.replace(ALT, `${ALT}\n- Neu · Stand 20.10.2026 · [[10_projekte/belege/2026-10/a1]]`).replace("quellen: []", 'quellen: ["10_projekte/belege/2026-10/a1.md"]').replace("quellen_sha: []", 'quellen_sha: ["abcd"]');
  assert.equal(Zr.macheRueckgaengig(mit, s, a), s, "ohne commitText: Nötigstes, Ergebnis wie vorher");
  assert.equal(Zr.macheRueckgaengig(mit, s, a, mit), s, "mit commitText dasselbe");
  assert.equal(Zr.macheRueckgaengig(mit.replace("- Neu", "- Anders"), s, a, mit), null, "Zeile seit dem Commit verändert");
});
