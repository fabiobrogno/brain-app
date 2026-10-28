// .tools/tests/test-tageslauf-schreiben.mjs — Schritt 6/7: Text-Änderungen, Arbeitskopie, ein Commit je Auftrag, ff-Merge,
// Rebase, Abbruch ohne Schaden, pre-commit rot, Reste aufräumen (B2, Task 7).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdirSync, utimesSync, rmSync, symlinkSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isoliere, neuerTestVault, git, committe, seitenText, legeVorschlagAn, schnappschuss, JETZT } from "./tageslauf-hilfe.mjs";
import { tempOrdner } from "./verlauf-fixture.mjs";
import { heute } from "../tageslauf/protokoll.mjs";
const S = await import("../tageslauf/schreiben.mjs");
const W = await import("../tageslauf/arbeitskopie.mjs");
isoliere();

const SEITE = "09_wiki/projekte/entitaet_alpha.md";
const seite = (rumpf = "# Alpha\n\nText.\n", fm = {}) => seitenText({ fm: { name: "alpha", description: "Alpha", ...fm }, rumpf });
const vor = (id, extra = {}) => ({ id, art: "fakt", titel: "Port geändert", text: "Das Testsystem läuft auf Port 3310.", zitat: "Port 3310 ab heute",
  herkunft: "du", fundstelle: "s1#u-1", quelleSitzung: "s1", quelleOrdner: "/p", erstellt: "2026-10-21T10:00:00Z", fm: {}, ...extra });
const auftrag = (id, extra = {}) => ({ art: "fakt", seite: SEITE, v: vor(id), ...extra });
const opt = (lauf) => ({ lauf, jetzt: JETZT });
const vaultMitSeite = () => neuerTestVault({ seiten: { [SEITE]: seite() } });

test("faktZeile/fuegeFaktEin: Abschnitt anlegen bzw. ans Ende des Abschnitts, nächste Überschrift bleibt", () => {
  const z = S.faktZeile({ aussage: "Port 3310", datum: "21.10.2026", beleg: "10_projekte/belege/2026-10/a" });
  assert.equal(z, "- Port 3310 · Stand 21.10.2026 · [[10_projekte/belege/2026-10/a]]");
  assert.equal(S.fuegeFaktEin("# A\n\nText.\n", z), `# A\n\nText.\n\n## Fakten\n\n${z}\n`);
  assert.equal(S.fuegeFaktEin("# A\n\n## Fakten\n\n- alt\n\n## Verwandt\n\n- x\n", z), `# A\n\n## Fakten\n\n- alt\n${z}\n\n## Verwandt\n\n- x\n`);
});

test("ersetzeZeile: Listenzeile durchgestrichen, neue Zeile darunter; Fließtext → null", () => {
  const t = "# A\n\n- Port 3309 · Stand 01.10.2026 · [[x]]\nFließtext mit Port 3309.\n";
  assert.equal(S.ersetzeZeile(t, "- Port 3309 · Stand 01.10.2026 · [[x]]", "- Port 3310 · Stand 21.10.2026 · [[y]]", "23.10.2026"),
    "# A\n\n- ~~Port 3309~~ · ersetzt am 23.10.2026 durch die Zeile darunter\n- Port 3310 · Stand 21.10.2026 · [[y]]\nFließtext mit Port 3309.\n");
  assert.equal(S.ersetzeZeile(t, "Fließtext mit Port 3309.", "- neu", "23.10.2026"), null);
});

test("ersetzeStand: ## Stand ersetzt, alter Stand als Zeile nach ## Verlauf (neueste oben, höchstens 10)", () => {
  let t = "# P\n\n## Stand\n\nStand 01.10.2026 · [[a]]\n\n- Erledigt: alt\n";
  t = S.ersetzeStand(t, { standText: "- Erledigt: neu", datum: "21.10.2026", beleg: "b" });
  assert.match(t, /## Stand\n\nStand 21\.10\.2026 · \[\[b\]\]\n\n- Erledigt: neu\n/);
  assert.match(t, /## Verlauf\n\n- 01\.10\.2026: Erledigt: alt\n/);
  for (let i = 0; i < 12; i++) t = S.ersetzeStand(t, { standText: `- Erledigt: ${i}`, datum: "22.10.2026", beleg: `b${i}` });
  const verlauf = t.split("## Verlauf")[1].split("\n").filter((z) => z.startsWith("- "));
  assert.equal(verlauf.length, 10);
  assert.match(verlauf[0], /Erledigt: 10$/);
});

test("Frontmatter zeilenweise: setzeFeld/erhoeheRev/ergaenzeQuelle; kaputt → seite-unlesbar (Review Focus 3)", () => {
  const t = seite();
  const z = S.setzeFeld(t, "zweifel", "2026-10-22: x");
  assert.match(z, /\nzweifel: "2026-10-22: x"\n---/);
  assert.equal(S.setzeFeld(z, "zweifel", null), t);
  assert.equal(S.erhoeheRev(t).rev, 2);
  const q = S.ergaenzeQuelle(t, "10_projekte/belege/2026-10/a.md", "abcd");
  assert.match(q, /\nquellen: \["10_projekte\/belege\/2026-10\/a\.md"\]\n/);
  assert.match(q, /\nquellen_sha: \["abcd"\]\n/);
  const unlesbar = (e) => e.grund === "seite-unlesbar";
  assert.throws(() => S.erhoeheRev(seitenText({ fm: { rev: "x" } })), unlesbar);
  assert.throws(() => S.ergaenzeQuelle(seitenText({ fm: { quellen: "kaputt" } }), "a", "b"), unlesbar);
  assert.throws(() => S.ergaenzeQuelle("---\nquellen:\n  - a.md\nrev: 1\n---\n", "b", "c"), unlesbar);
  assert.throws(() => S.setzeFeld("ohne Frontmatter", "a", 1), unlesbar);
});

test("fuegeLogEin: neuer Eintrag über dem neuesten, Formatvorlage bleibt oben; clusterFuer aus brain.config.json", () => {
  const log = "# Log\n\nFormat je Lauf:\n## <YYYY-MM-DD HH:MM> — <Quelle>\n\n## 2026-01-01 10:00 — start\n- x\n";
  const e = S.logEintrag({ zeit: "2026-10-22 05:00", lauf: "L1", titel: "Port", seiteWiki: "projekte/entitaet_alpha.md", rev: 2, was: "Fakt-Zeile ergänzt", beleg: "10_projekte/belege/2026-10/a.md" });
  const n = S.fuegeLogEin(log, e);
  assert.ok(n.indexOf("Format je Lauf") < n.indexOf("## 2026-10-22 05:00 — auto(L1): Port"));
  assert.ok(n.indexOf("## 2026-10-22 05:00") < n.indexOf("## 2026-01-01 10:00"));
  const v = neuerTestVault();
  assert.equal(S.clusterFuer(v, "09_wiki/projekte/x.md"), "10_projekte");
  assert.equal(S.clusterFuer(v, "09_wiki/firma/a/x.md"), "20_firma");
  assert.equal(S.clusterFuer(v, "09_wiki/persoenlich/x.md"), null);
});

test("Arbeitskopie: Commit je Auftrag mit Beleg, rev+1, _log, quellen; ff-Merge; danach Arbeitskopie und Branch weg", () => {
  const v = vaultMitSeite();
  const kopie = W.legeArbeitskopieAn(v, "L1");
  assert.ok(kopie.pfad.startsWith(process.env.BRAIN_TAGESLAUF_CACHE));
  const r1 = W.commitAuftrag(v, kopie, auftrag("a1"), opt("L1"));
  const r2 = W.commitAuftrag(v, kopie, auftrag("a2", { v: vor("a2", { text: "Backups laufen jetzt stündlich." }) }), opt("L1"));
  assert.ok(r1.ok && r2.ok, JSON.stringify([r1, r2]));
  assert.equal(git(v, "status", "--porcelain"), "", "Vault unberührt bis zum Merge");
  assert.deepEqual(W.uebernehmen(v, kopie), { ok: true, commits: 2 });
  const text = readFileSync(join(v, SEITE), "utf8");
  assert.match(text, /^rev: 3$/m);
  assert.match(text, /## Fakten\n\n- Das Testsystem läuft auf Port 3310\. · Stand 21\.10\.2026 · \[\[10_projekte\/belege\/2026-10\/a1\]\]\n- Backups/);
  assert.match(text, /^quellen: \["10_projekte\/belege\/2026-10\/a1\.md","10_projekte\/belege\/2026-10\/a2\.md"\]$/m);
  assert.match(readFileSync(join(v, "10_projekte", "belege", "2026-10", "a1.md"), "utf8"), /zitat: "Port 3310 ab heute"/);
  assert.match(readFileSync(join(v, "09_wiki", "_log.md"), "utf8"), /## \d{4}-\d{2}-\d{2} \d{2}:\d{2} — auto\(L1\): Port geändert/);
  assert.deepEqual([...W.commitsDesLaufs(v, "L1", 2).keys()].sort(), ["a1", "a2"]);
  assert.match(git(v, "log", "-1", "--format=%an|%s"), /^Brain-Tageslauf\|auto\(L1\): .* → entitaet_alpha\.md \[a2\]$/);
  W.verwerfeArbeitskopie(v, kopie);
  assert.ok(!existsSync(kopie.pfad));
  assert.equal(git(v, "branch", "--list", "tageslauf/*"), "");
});

test("main weitergelaufen → Rebase in der Arbeitskopie, dann ff-Merge", () => {
  const v = vaultMitSeite();
  const kopie = W.legeArbeitskopieAn(v, "L2");
  assert.ok(W.commitAuftrag(v, kopie, auftrag("b1"), opt("L2")).ok);
  committe(v, "09_wiki/wissen/thema_anderes.md", seite("# Anderes\n"));
  assert.deepEqual(W.uebernehmen(v, kopie), { ok: true, commits: 1 });
  assert.match(readFileSync(join(v, SEITE), "utf8"), /belege\/2026-10\/b1/);
  assert.ok(existsSync(join(v, "09_wiki", "wissen", "thema_anderes.md")));
  W.verwerfeArbeitskopie(v, kopie);
});

test("Konflikt beim Rebase → Abbruch ohne Schaden, main und Vault unverändert", () => {
  const v = vaultMitSeite();
  const kopie = W.legeArbeitskopieAn(v, "L3");
  assert.ok(W.commitAuftrag(v, kopie, auftrag("c1"), opt("L3")).ok);
  committe(v, SEITE, seite("# Alpha\n\nText.\n\n## Fakten\n\n- von Hand\n", { rev: 2 }));
  const kopf = git(v, "rev-parse", "HEAD");
  assert.deepEqual(W.uebernehmen(v, kopie), { ok: false, grund: "konflikt" });
  assert.equal(git(v, "rev-parse", "HEAD"), kopf);
  assert.equal(git(v, "status", "--porcelain"), "");
  W.verwerfeArbeitskopie(v, kopie);
});

test("lokale Änderung an der Zielseite → Abbruch, die Änderung bleibt (Review Focus 1)", () => {
  const v = vaultMitSeite();
  const kopie = W.legeArbeitskopieAn(v, "L4");
  assert.ok(W.commitAuftrag(v, kopie, auftrag("d1"), opt("L4")).ok);
  writeFileSync(join(v, SEITE), seite("# Alpha\n\nlokal geändert\n"));
  const kopf = git(v, "rev-parse", "HEAD");
  assert.deepEqual(W.uebernehmen(v, kopie), { ok: false, grund: "lokale-aenderung" });
  assert.match(readFileSync(join(v, SEITE), "utf8"), /lokal geändert/);
  assert.equal(git(v, "rev-parse", "HEAD"), kopf);
  W.verwerfeArbeitskopie(v, kopie);
});

test("Vault nicht auf main → Abbruch (Review Focus 1)", () => {
  const v = vaultMitSeite();
  const kopie = W.legeArbeitskopieAn(v, "L5");
  assert.ok(W.commitAuftrag(v, kopie, auftrag("e1"), opt("L5")).ok);
  git(v, "checkout", "-q", "-b", "nebenbei");
  assert.deepEqual(W.uebernehmen(v, kopie), { ok: false, grund: "vault-nicht-auf-main" });
  W.verwerfeArbeitskopie(v, kopie);
});

test("pre-commit rot → Auftrag verworfen mit Befund, Arbeitskopie sauber, nächster Auftrag läuft", () => {
  const v = vaultMitSeite();
  const kopie = W.legeArbeitskopieAn(v, "L6");
  const rot = W.commitAuftrag(v, kopie, auftrag("f1", { v: vor("f1", { text: "Das ist VERBOTEN." }) }), opt("L6"));
  assert.deepEqual([rot.ok, rot.grund], [false, "pruefung-rot"]);
  assert.match(rot.befund, /VERBOTEN/);
  assert.equal(git(kopie.pfad, "status", "--porcelain"), "");
  assert.ok(W.commitAuftrag(v, kopie, auftrag("f2"), opt("L6")).ok);
  W.verwerfeArbeitskopie(v, kopie);
});

test("kaputtes Frontmatter der Zielseite → seite-unlesbar, nichts committet (Review Focus 3)", () => {
  const v = neuerTestVault({ seiten: { [SEITE]: seitenText({ fm: { name: "alpha", quellen: "kaputt" }, rumpf: "# A\n" }) } });
  const kopie = W.legeArbeitskopieAn(v, "L7");
  const r = W.commitAuftrag(v, kopie, auftrag("g1"), opt("L7"));
  assert.deepEqual([r.ok, r.grund], [false, "seite-unlesbar"]);
  assert.equal(git(kopie.pfad, "status", "--porcelain"), "");
  assert.equal(git(kopie.pfad, "rev-list", "--count", "main..HEAD"), "0");
  W.verwerfeArbeitskopie(v, kopie);
});

test("feld-Auftrag und ersetzen-Auftrag (Listenzeile; Fließtext → Fakt + zweifel)", () => {
  const v = neuerTestVault({ seiten: { [SEITE]: seite("# Alpha\n\nDas Testsystem läuft auf Port 3309.\n\n## Fakten\n\n- Backups täglich · Stand 01.10.2026 · [[x]]\n") } });
  const kopie = W.legeArbeitskopieAn(v, "L8");
  assert.ok(W.commitAuftrag(v, kopie, { art: "feld", seite: SEITE, feld: "zweifel", wert: "2026-10-22: Korrektur", titel: "Zweifel", ref: "rf-1" }, opt("L8")).ok);
  assert.ok(W.commitAuftrag(v, kopie, { art: "ersetzen", seite: SEITE, v: vor("h1", { text: "Backups laufen stündlich." }), zeile: "- Backups täglich · Stand 01.10.2026 · [[x]]", ref: "rf-2" }, opt("L8")).ok);
  assert.ok(W.commitAuftrag(v, kopie, { art: "ersetzen", seite: SEITE, v: vor("h2"), zeile: "Das Testsystem läuft auf Port 3309.", ref: "rf-3" }, opt("L8")).ok);
  assert.equal(W.commitAuftrag(v, kopie, { art: "feld", seite: SEITE, feld: "gibtsnicht", wert: null, ref: "rf-4" }, opt("L8")).grund, "unveraendert");
  assert.ok(W.uebernehmen(v, kopie).ok);
  const t = readFileSync(join(v, SEITE), "utf8");
  assert.match(t, /- ~~Backups täglich~~ · ersetzt am \d{2}\.\d{2}\.\d{4} durch die Zeile darunter\n- Backups laufen stündlich\. · Stand/);
  assert.match(t, /^zweifel: ".*Fließtext widerspricht.*rf-3.*"$/m);
  assert.match(t, /^rev: 4$/m);
  W.verwerfeArbeitskopie(v, kopie);
});

test("raeumeResteAuf: liegengebliebene tageslauf/*-Branches samt Arbeitskopie weg, die aktuelle bleibt (Review Focus 4)", () => {
  const v = vaultMitSeite();
  const alt = W.legeArbeitskopieAn(v, "ALT");
  const neu = W.legeArbeitskopieAn(v, "NEU");
  assert.equal(W.raeumeResteAuf(v, { ausser: "tageslauf/NEU" }), 1);
  assert.ok(!existsSync(alt.pfad));
  assert.ok(existsSync(neu.pfad));
  assert.equal(git(v, "branch", "--list", "tageslauf/ALT"), "");
  W.verwerfeArbeitskopie(v, neu);
});

test("Ingest-Sperre: frischer fremder Lock blockt, alter nicht; freigegeben wird nur die eigene", () => {
  const v = vaultMitSeite();
  const f = join(v, ".logs", "ingest.lock");
  mkdirSync(join(v, ".logs"), { recursive: true });
  writeFileSync(f, "2026-10-22 03:00\n");
  assert.equal(W.nimmIngestSperre(v), false);
  const alt = new Date(Date.now() - 3600e3);
  utimesSync(f, alt, alt);
  assert.equal(W.nimmIngestSperre(v), true);
  W.gibIngestSperreFrei(v);
  assert.ok(!existsSync(f));
});

// ---- Zusatz (Task 7, „der Teil, der echtes Wissen schreibt"): jeder Fehler- und Probepfad lässt den Vault unverändert ----

const vaultMitVorschlag = () => {
  const v = vaultMitSeite();
  legeVorschlagAn(v, { id: "v1", titel: "Port geändert", text: "Das Testsystem läuft auf Port 3310." });
  return v;
};
const gleich = (v, f) => { const vorher = schnappschuss(v); f(); assert.equal(schnappschuss(v), vorher, "Vault, Refs und Arbeitskopien unverändert"); };

test("Probe: rechnen in der Arbeitskopie und verwerfen lässt Vault, Refs und Arbeitskopien bit-identisch; Übernehmen verweigert", () => {
  const v = vaultMitVorschlag();
  const vorher = schnappschuss(v);
  const main = git(v, "rev-parse", "main");
  const kopie = W.legeArbeitskopieAn(v, "P1");
  assert.ok(W.commitAuftrag(v, kopie, auftrag("p1"), opt("P1")).ok);
  assert.ok(W.commitAuftrag(v, kopie, auftrag("p2", { v: vor("p2", { text: "Zweiter Fakt." }) }), opt("P1")).ok);
  assert.deepEqual(W.uebernehmen(v, kopie, { probe: true }), { ok: false, grund: "probe" });
  assert.equal(git(v, "rev-parse", "main"), main, "main nicht bewegt");
  assert.doesNotMatch(readFileSync(join(v, SEITE), "utf8"), /Port 3310/);
  W.verwerfeArbeitskopie(v, kopie);
  assert.equal(schnappschuss(v), vorher);
  assert.ok(!existsSync(join(v, "10_projekte")), "kein Beleg im Vault");
  assert.ok(!existsSync(kopie.pfad));
  assert.ok(existsSync(join(v, "00_inbox", "_vorschlaege", "v1.md")), "Vorschlag bleibt offen");
});

test("Konflikt: Schnappschuss vor/nach Übernehmen gleich, Arbeitskopie ohne Rebase-Rest, Vorschlag offen", () => {
  const v = vaultMitVorschlag();
  const kopie = W.legeArbeitskopieAn(v, "K1");
  assert.ok(W.commitAuftrag(v, kopie, auftrag("k1"), opt("K1")).ok);
  committe(v, SEITE, seite("# Alpha\n\nText.\n\n## Fakten\n\n- von Hand\n", { rev: 2 }));
  gleich(v, () => assert.deepEqual(W.uebernehmen(v, kopie), { ok: false, grund: "konflikt" }));
  assert.equal(git(kopie.pfad, "status", "--porcelain"), "");
  assert.ok(!existsSync(join(git(kopie.pfad, "rev-parse", "--absolute-git-dir"), "rebase-merge")), "kein halber Rebase");
  assert.equal(git(kopie.pfad, "rev-list", "--count", "main..HEAD"), "1", "Commit der Arbeitskopie bleibt (wird mit ihr verworfen)");
  W.verwerfeArbeitskopie(v, kopie);
});

test("lokale Änderung an der Zielseite oder _log.md: Schnappschuss gleich, Änderung bleibt; Übernehmen danach nicht still nachholbar", () => {
  for (const rel of [SEITE, "09_wiki/_log.md"]) {
    const v = vaultMitVorschlag();
    const kopie = W.legeArbeitskopieAn(v, "LA");
    assert.ok(W.commitAuftrag(v, kopie, auftrag("l1"), opt("LA")).ok);
    writeFileSync(join(v, rel), `${readFileSync(join(v, rel), "utf8")}\nlokal dazugeschrieben\n`);
    gleich(v, () => assert.deepEqual(W.uebernehmen(v, kopie), { ok: false, grund: "lokale-aenderung" }));
    assert.match(readFileSync(join(v, rel), "utf8"), /lokal dazugeschrieben/);
    W.verwerfeArbeitskopie(v, kopie);
  }
});

test("ungetrackte Datei im Vault auf dem Beleg-Pfad blockt den Merge → lokale-aenderung, Datei bleibt", () => {
  const v = vaultMitVorschlag();
  const kopie = W.legeArbeitskopieAn(v, "LU");
  assert.ok(W.commitAuftrag(v, kopie, auftrag("u1"), opt("LU")).ok);
  mkdirSync(join(v, "10_projekte", "belege", "2026-10"), { recursive: true });
  writeFileSync(join(v, "10_projekte", "belege", "2026-10", "u1.md"), "meine eigene Notiz\n");
  gleich(v, () => assert.deepEqual(W.uebernehmen(v, kopie), { ok: false, grund: "lokale-aenderung" }));
  assert.equal(readFileSync(join(v, "10_projekte", "belege", "2026-10", "u1.md"), "utf8"), "meine eigene Notiz\n");
  W.verwerfeArbeitskopie(v, kopie);
});

test("main weitergelaufen UND lokale Änderung an der Zielseite → Abbruch; main, HEAD, Datei und Index unverändert", () => {
  const v = vaultMitVorschlag();
  const kopie = W.legeArbeitskopieAn(v, "LM");
  assert.ok(W.commitAuftrag(v, kopie, auftrag("m1"), opt("LM")).ok);
  committe(v, "09_wiki/wissen/thema_anderes.md", seite("# Anderes\n"));
  writeFileSync(join(v, SEITE), seite("# Alpha\n\nlokal geändert\n"));
  const zustand = () => [git(v, "rev-parse", "HEAD"), git(v, "rev-parse", "main"), git(v, "status", "--porcelain"), readFileSync(join(v, SEITE), "utf8")];
  const vorher = zustand();
  assert.deepEqual(W.uebernehmen(v, kopie), { ok: false, grund: "lokale-aenderung" });
  assert.deepEqual(zustand(), vorher);
  W.verwerfeArbeitskopie(v, kopie);
});

test("lokale Änderung an einer ANDEREN Datei blockt nicht — und bleibt unangetastet", () => {
  const v = vaultMitVorschlag();
  const kopie = W.legeArbeitskopieAn(v, "LF");
  assert.ok(W.commitAuftrag(v, kopie, auftrag("f1"), opt("LF")).ok);
  writeFileSync(join(v, "brain.config.json"), `${readFileSync(join(v, "brain.config.json"), "utf8")}\n`);
  const lokal = readFileSync(join(v, "brain.config.json"), "utf8");
  assert.deepEqual(W.uebernehmen(v, kopie), { ok: true, commits: 1 });
  assert.equal(readFileSync(join(v, "brain.config.json"), "utf8"), lokal);
  assert.match(git(v, "status", "--porcelain"), /^M brain\.config\.json$/);
  W.verwerfeArbeitskopie(v, kopie);
});

test("Vault auf anderem Branch oder detached → Abbruch ohne Änderung", () => {
  const v = vaultMitVorschlag();
  const kopie = W.legeArbeitskopieAn(v, "VN");
  assert.ok(W.commitAuftrag(v, kopie, auftrag("n1"), opt("VN")).ok);
  const main = git(v, "rev-parse", "main");
  git(v, "checkout", "-q", "--detach");
  gleich(v, () => assert.deepEqual(W.uebernehmen(v, kopie), { ok: false, grund: "vault-nicht-auf-main" }));
  git(v, "checkout", "-q", "-b", "nebenbei");
  gleich(v, () => assert.deepEqual(W.uebernehmen(v, kopie), { ok: false, grund: "vault-nicht-auf-main" }));
  assert.equal(git(v, "rev-parse", "main"), main);
  assert.equal(git(v, "rev-list", "--count", "main..tageslauf/VN"), "1");
  W.verwerfeArbeitskopie(v, kopie);
});

test("Stand (Nachbesserung): nur der Kernsatz kommt in „## Stand“ und in den Beleg — die weiteren Zeilen des Vorschlags bleiben draußen; Fakten unverändert", () => {
  const v = vaultMitSeite();
  const text = "- Das Testsystem läuft auf Port 3310.\n- Offen: Backup prüfen\n- Nächster Schritt: Neustart";
  const r = S.wendeAuftragAn(v, { art: "stand", seite: SEITE, v: vor("ks1", { art: "stand", text }) }, opt("KS"));
  const t = readFileSync(join(v, SEITE), "utf8");
  assert.match(t, /^## Stand\n\nStand 21\.10\.2026 · \[\[10_projekte\/belege\/2026-10\/ks1\]\]\n\n- Das Testsystem läuft auf Port 3310\.\n$/m);
  assert.doesNotMatch(t, /Backup prüfen|Neustart/);
  const beleg = readFileSync(join(v, r.beleg), "utf8");
  assert.match(beleg, /\n# Port geändert\n\n- Das Testsystem läuft auf Port 3310\.\n\n> Port 3310 ab heute\n$/);
  assert.doesNotMatch(beleg, /Backup prüfen/);
  const f = S.wendeAuftragAn(v, { art: "fakt", seite: SEITE, v: vor("kf1", { text: "Zeile eins.\nZeile zwei." }) }, opt("KF"));
  assert.ok(f.beleg);
  assert.match(readFileSync(join(v, SEITE), "utf8"), /- Zeile eins\. Zeile zwei\. · Stand/, "ein Fakt behält seinen ganzen Text");
});

test("pre-commit rot und kaputte Seite: Vault und Arbeitskopie unverändert, Beleg-Datei nicht übrig", () => {
  const v = vaultMitVorschlag();
  const kopie = W.legeArbeitskopieAn(v, "RT");
  const vorher = schnappschuss(v);
  const rot = W.commitAuftrag(v, kopie, auftrag("r1", { v: vor("r1", { text: "Das ist VERBOTEN." }) }), opt("RT"));
  assert.equal(rot.grund, "pruefung-rot");
  assert.equal(schnappschuss(v), vorher);
  assert.equal(git(kopie.pfad, "status", "--porcelain", "--ignored"), "");
  assert.ok(!existsSync(join(kopie.pfad, "10_projekte")), "Beleg weggeräumt");
  const w = neuerTestVault({ seiten: { [SEITE]: seitenText({ fm: { name: "a", quellen: "kaputt" }, rumpf: "# A\n" }) } });
  const k2 = W.legeArbeitskopieAn(w, "RU");
  const vorW = schnappschuss(w);
  assert.equal(W.commitAuftrag(w, k2, auftrag("r2"), opt("RU")).grund, "seite-unlesbar");
  assert.equal(schnappschuss(w), vorW);
  assert.ok(!existsSync(join(k2.pfad, "10_projekte")), "Beleg weggeräumt");
  W.verwerfeArbeitskopie(v, kopie); W.verwerfeArbeitskopie(w, k2);
});

test("echter pre-commit (commit-pruefung): Fakt-, Stand-, Ersetzen- und Feld-Commits der Arbeitskopie bestehen REV und _log-Reihenfolge", () => {
  const v = neuerTestVault({ hook: "echt", seiten: { [SEITE]: seite("# Alpha\n\nText.\n\n## Fakten\n\n- Backups täglich · Stand 01.10.2026 · [[x]]\n") } });
  const kopie = W.legeArbeitskopieAn(v, "EH");
  const r = [
    W.commitAuftrag(v, kopie, auftrag("e1"), opt("EH")),
    W.commitAuftrag(v, kopie, { art: "stand", seite: SEITE, v: vor("e2", { art: "stand", text: "- Erledigt: Port umgestellt" }) }, opt("EH")),
    W.commitAuftrag(v, kopie, { art: "ersetzen", seite: SEITE, v: vor("e3", { text: "Backups laufen stündlich." }), zeile: "- Backups täglich · Stand 01.10.2026 · [[x]]" }, opt("EH")),
    W.commitAuftrag(v, kopie, { art: "feld", seite: SEITE, feld: "zweifel", wert: "2026-10-22: x", titel: "Zweifel" }, opt("EH")),
  ];
  assert.deepEqual(r.map((x) => x.ok), [true, true, true, true], JSON.stringify(r));
  // …und derselbe echte Hook blockt ein Secret im Text: pruefung-rot, Arbeitskopie sauber, Vault unverändert
  const vorher = schnappschuss(v);
  const rot = W.commitAuftrag(v, kopie, auftrag("e9", { v: vor("e9", { text: `Der Schlüssel ist ${["sk-", "ant-", "api03-", "A".repeat(40)].join("")}.` }) }), opt("EH"));
  assert.deepEqual([rot.ok, rot.grund], [false, "pruefung-rot"], JSON.stringify(rot));
  assert.equal(git(kopie.pfad, "status", "--porcelain"), "");
  assert.deepEqual(W.uebernehmen(v, kopie), { ok: true, commits: 4 });
  assert.equal(schnappschuss(v) === vorher, false, "erst der Merge ändert den Vault");
  W.verwerfeArbeitskopie(v, kopie);
});


test("raeumeResteAuf: fehlende Arbeitskopie-Ordner und halbe Reste (Ordner ohne Branch) werden verkraftet", () => {
  const v = vaultMitSeite();
  const a = W.legeArbeitskopieAn(v, "R1");
  rmSync(a.pfad, { recursive: true, force: true });                       // Strom weg: Ordner fehlt, Branch und Worktree-Eintrag bleiben
  assert.equal(W.raeumeResteAuf(v, { ausser: null }), 1);
  assert.equal(git(v, "branch", "--list", "tageslauf/*"), "");
  assert.equal(git(v, "worktree", "list", "--porcelain").split("\n").filter((z) => z.startsWith("worktree ")).length, 1);
  assert.equal(W.raeumeResteAuf(v, {}), 0);
});

test("Ingest-Sperre: fremde Sperre bleibt bei gibIngestSperreFrei stehen; eigene wird gelöst", () => {
  const v = tempOrdner("sperre");   // kein Git nötig
  const f = join(v, ".logs", "ingest.lock");
  mkdirSync(join(v, ".logs"), { recursive: true });
  writeFileSync(f, "ingest 999999\n");
  W.gibIngestSperreFrei(v);
  assert.ok(existsSync(f));
  rmSync(f);
  assert.equal(W.nimmIngestSperre(v), true);
  assert.equal(W.nimmIngestSperre(v), false, "zweites Nehmen scheitert, solange die Sperre frisch ist");
  W.gibIngestSperreFrei(v);
  assert.ok(!existsSync(f));
});

test("Aufträge, die nicht schreiben dürfen: unzulässige Seite, Symlinks nach außen, Pfad-ID, Feldname, doppelte ID, kaputtes erstellt", () => {
  const aussen = tempOrdner("aussen");
  writeFileSync(join(aussen, "fremd.md"), "---\nrev: 1\n---\nFremd\n");
  const v = neuerTestVault({ seiten: { [SEITE]: seite(), "09_wiki/projekte/entitaet_kritisch.md": seite("# K\n", { kritisch: true }),
    "09_wiki/persoenlich/x.md": seite("# P\n") } });
  symlinkSync(join(aussen, "fremd.md"), join(v, "09_wiki", "projekte", "link.md"));
  symlinkSync(aussen, join(v, "10_projekte"));
  git(v, "add", "--", "09_wiki/projekte/link.md", "10_projekte"); git(v, "commit", "-qm", "links");
  const kopie = W.legeArbeitskopieAn(v, "UZ");
  const g = (a) => W.commitAuftrag(v, kopie, { art: "fakt", seite: SEITE, v: vor("z1"), ...a }, opt("UZ")).grund;
  // Seite: außerhalb Wiki, .. im Pfad, fehlt, Symlink nach außen, kritisch, ohne Cluster
  assert.equal(g({ seite: "brain.config.json" }), "seite-fehlt");
  assert.equal(g({ seite: "09_wiki/../brain.config.json" }), "seite-fehlt");
  assert.equal(g({ seite: "09_wiki/projekte/gibtsnicht.md" }), "seite-fehlt");
  assert.equal(g({ art: "feld", seite: "09_wiki/projekte/link.md", feld: "zweifel", wert: "x" }), "seite-fehlt");
  assert.equal(g({ seite: "09_wiki/projekte/entitaet_kritisch.md" }), "kritisch");
  assert.equal(g({ seite: "09_wiki/persoenlich/x.md" }), "kein-cluster");
  // Beleg-Ordner ist ein Symlink nach außen → nichts wird außen angelegt
  assert.equal(g({}), "seite-fehlt");
  assert.deepEqual(readdirSync(aussen), ["fremd.md"]);
  assert.equal(readFileSync(join(aussen, "fremd.md"), "utf8"), "---\nrev: 1\n---\nFremd\n");
  // Auftragsform: Art, ID mit Pfadanteil, Feldname
  assert.equal(g({ art: "mystisch" }), "auftrag-unbekannt");
  assert.equal(g({ v: vor("../../x") }), "auftrag-unbekannt");
  assert.equal(g({ v: { ...vor("z1"), id: undefined } }), "auftrag-unbekannt");
  for (const feld of ["rev", "quellen", "kritisch", "a\nb", "A", "", undefined, 5]) assert.equal(g({ art: "feld", feld, wert: "x" }), "auftrag-unbekannt", String(feld));
  assert.equal(git(kopie.pfad, "status", "--porcelain", "--ignored"), "");
  assert.equal(git(kopie.pfad, "rev-list", "--count", "main..HEAD"), "0", "nichts committet");
  W.verwerfeArbeitskopie(v, kopie);

  // Doppelte Beleg-ID und kaputtes „erstellt“ (eigener Vault ohne Symlinks)
  const w = vaultMitSeite();
  const k2 = W.legeArbeitskopieAn(w, "DD");
  assert.ok(W.commitAuftrag(w, k2, auftrag("d1", { v: vor("d1", { erstellt: "kaputt" }) }), opt("DD")).ok);
  const tag = S.datumDE(heute(new Date(JETZT)));
  assert.match(readFileSync(join(k2.pfad, SEITE), "utf8"), new RegExp(`· Stand ${tag.replace(/\./g, "\\.")} ·`), "Tag des Laufs statt „undefined.undefined“");
  assert.equal(W.commitAuftrag(w, k2, auftrag("d1"), opt("DD")).ok, false);
  assert.equal(git(k2.pfad, "status", "--porcelain"), "");
  assert.match(readFileSync(join(k2.pfad, SEITE), "utf8"), /^rev: 2$/m, "rev nicht doppelt erhöht");
  W.verwerfeArbeitskopie(w, k2);
});

// Befund #5 (Opus-Review B2): auch die Schutzprüfung beim Schreiben ist fail-safe — jeder Wert außer false (und fehlend) sperrt die Seite.
test("wendeAuftragAn: kritisch mit ja, \"true\", True, yes oder kaputtem Wert → Fehler kritisch, nichts geschrieben; false und fehlend schreiben", () => {
  const fmZeilen = (wert) => `---\ntyp: thema\nname: alpha\ndescription: Alpha\n${wert === undefined ? "" : `kritisch: ${wert}\n`}rev: 1\n---\n# Alpha\n\nText.\n`;
  for (const wert of ["true", "ja", "\"true\"", "True", "yes", "1", "[kaputt", "\"\"", ""]) {
    const v = neuerTestVault({ seiten: { [SEITE]: fmZeilen(wert) } });
    const kopie = W.legeArbeitskopieAn(v, "KR");
    assert.equal(W.commitAuftrag(v, kopie, auftrag("kr1"), opt("KR")).grund, "kritisch", `kritisch: ${wert}`);
    assert.equal(W.commitAuftrag(v, kopie, { art: "feld", seite: SEITE, feld: "zweifel", wert: "x" }, opt("KR")).grund, "kritisch", `Feld-Auftrag, kritisch: ${wert}`);
    assert.equal(git(kopie.pfad, "rev-list", "--count", "main..HEAD"), "0", "nichts committet");
    W.verwerfeArbeitskopie(v, kopie);
  }
  for (const wert of ["false", undefined]) {
    const v = neuerTestVault({ seiten: { [SEITE]: fmZeilen(wert) } });
    const kopie = W.legeArbeitskopieAn(v, "KR");
    assert.ok(W.commitAuftrag(v, kopie, auftrag("kr2"), opt("KR")).ok, `kritisch: ${wert}`);
    W.verwerfeArbeitskopie(v, kopie);
  }
});
