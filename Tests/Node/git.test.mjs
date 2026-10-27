import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, chmodSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmp, schreibe, repo, g, pfad } from "./hilfe.mjs";

const { oeffneVault, HttpFehler } = await import(pfad("gemeinsam", "vault.mjs"));
const wirft = async (p) => { try { await p; } catch (e) { assert.ok(e instanceof HttpFehler, String(e && e.stack)); return e; } assert.fail("kein Fehler"); };

// Vault A (Arbeitsstand) mit Bare-Remote "origin"; zweiter Klon B für „andere Person“.
function mitRemote() {
  const bare = tmp("brain-bare-");
  g(bare, "init", "-q", "--bare", "-b", "main");
  const a = repo();
  g(a, "remote", "add", "origin", bare);
  g(a, "push", "-q", "-u", "origin", "main");
  const b = tmp("brain-klon-");
  g(b, "clone", "-q", bare, ".");
  g(b, "config", "user.name", "B"); g(b, "config", "user.email", "b@example.org");
  return { bare, a, b, v: oeffneVault(a) };
}
const commitB = (b, datei, inhalt, msg) => { schreibe(b, datei, inhalt); g(b, "add", "--", datei); g(b, "commit", "-q", "-m", msg); g(b, "push", "-q"); };

test("Status: kein Repo, sauber, geändert/neu/gelöscht, letzter Commit", async () => {
  const leer = oeffneVault(tmp());
  const s0 = await leer.gitStatus();
  assert.equal(s0.repo, false); assert.deepEqual(s0.geaendert, []);
  assert.equal(await leer.istGitRepo(), false);

  const d = repo();
  const v = oeffneVault(d);
  let s = await v.gitStatus();
  assert.equal(s.repo, true); assert.equal(s.zweig, "main"); assert.equal(s.upstream, null);
  assert.equal(s.vor, 0); assert.equal(s.zurueck, 0); assert.equal(s.remote, false); assert.equal(s.letzterSync, null);
  assert.deepEqual(s.geaendert, []);
  assert.equal(s.letzterCommit.nachricht, "Start"); assert.match(s.letzterCommit.sha, /^[0-9a-f]{40}$/); assert.equal(s.letzterCommit.kurz.length >= 7, true);
  writeFileSync(join(d, "start.md"), "# Start\nmehr\n");
  schreibe(d, "ordner/neu.md", "# neu\n");
  const s2 = await v.gitStatus();
  assert.deepEqual(s2.geaendert, [{ pfad: "ordner/neu.md", code: "??" }, { pfad: "start.md", code: "M" }]);
});

test("Status: Repo ohne Commit (frisch init)", async () => {
  const d = tmp();
  g(d, "init", "-q", "-b", "main");
  schreibe(d, "a.md", "# a\n");
  const s = await oeffneVault(d).gitStatus();
  assert.equal(s.repo, true); assert.equal(s.letzterCommit, null); assert.equal(s.zweig, "main");
  assert.deepEqual(s.geaendert, [{ pfad: "a.md", code: "??" }]);
  assert.deepEqual(await oeffneVault(d).gitVerlauf("a.md"), { eintraege: [] });
});

test("Commit: nur die gewählten Dateien, Rest bleibt geändert, auch schon Vorgemerktes bleibt draußen", async () => {
  const d = repo();
  const v = oeffneVault(d);
  schreibe(d, "a.md", "# a\n"); schreibe(d, "b.md", "# b\n"); schreibe(d, "c.md", "# c\n");
  g(d, "add", "--", "c.md"); // c ist vorgemerkt, soll aber NICHT mit
  const r = await v.gitCommit({ nachricht: "Nur a", dateien: ["a.md"] });
  assert.equal(r.sha, g(d, "rev-parse", "HEAD").trim());
  assert.deepEqual(g(d, "show", "--name-only", "--format=", "HEAD").trim().split("\n"), ["a.md"]);
  assert.equal(g(d, "log", "-1", "--format=%s").trim(), "Nur a");
  const rest = (await v.gitStatus()).geaendert.map((e) => e.pfad);
  assert.deepEqual(rest, ["b.md", "c.md"]);
  // geänderte und gelöschte Datei zusammen
  writeFileSync(join(d, "start.md"), "# Start\nx\n");
  unlinkSync(join(d, "a.md"));
  await v.gitCommit({ nachricht: "Zwei", dateien: ["start.md", "a.md"] });
  assert.deepEqual(g(d, "show", "--name-status", "--format=", "HEAD").trim().split("\n").sort(), ["D\ta.md", "M\tstart.md"]);
});

test("Commit: Eingabe geprüft (leer, fremde Pfade, .., .git), kein -A", async () => {
  const d = repo();
  const v = oeffneVault(d);
  schreibe(d, "a.md", "# a\n");
  assert.equal((await wirft(v.gitCommit({ nachricht: "", dateien: ["a.md"] }))).status, 400);
  assert.equal((await wirft(v.gitCommit({ nachricht: "x", dateien: [] }))).status, 400);
  assert.equal((await wirft(v.gitCommit({ nachricht: "x", dateien: ["start.md"] }))).status, 400, "ohne Änderung");
  assert.equal((await wirft(v.gitCommit({ nachricht: "x", dateien: ["../a.md"] }))).status, 403);
  assert.equal((await wirft(v.gitCommit({ nachricht: "x", dateien: [".git/config"] }))).status, 403);
  assert.equal((await wirft(v.gitCommit({ nachricht: "x", dateien: ["."] }))).status, 400);
  assert.equal((await wirft(v.gitCommit({ nachricht: "x", dateien: ["--all"] }))).status, 400);
  assert.equal(g(d, "log", "--format=%s").trim(), "Start");
});

test("Commit: pre-commit-Hook mit exit 1 → 422 mit Ausgabe, nichts committet, Vormerkung zurückgenommen", async () => {
  const d = repo();
  const v = oeffneVault(d);
  const hook = join(d, ".git", "hooks", "pre-commit");
  writeFileSync(hook, "#!/bin/sh\necho 'FAKT-BELEG: Zeile 3 hat keinen Beleg'\nexit 1\n");
  chmodSync(hook, 0o755);
  v.vertrauen(true); // Hooks laufen nur, wenn dem Vault vertraut ist (Vertrauen v2, Spec §8)
  schreibe(d, "a.md", "# a\n");
  const vorher = g(d, "rev-parse", "HEAD");
  const e = await wirft(v.gitCommit({ nachricht: "Soll scheitern", dateien: ["a.md"] }));
  assert.equal(e.status, 422);
  assert.match(e.extra.ausgabe, /FAKT-BELEG: Zeile 3/);
  assert.ok(e.message.length > 5);
  assert.equal(g(d, "rev-parse", "HEAD"), vorher);
  assert.equal(g(d, "diff", "--cached", "--name-only").trim(), "", "nichts bleibt vorgemerkt");
  assert.deepEqual((await v.gitStatus()).geaendert, [{ pfad: "a.md", code: "??" }]);
});

test("Commit: lange Hook-Ausgabe wird gekürzt", async () => {
  const d = repo();
  const hook = join(d, ".git", "hooks", "pre-commit");
  writeFileSync(hook, "#!/bin/sh\nyes 'zeile' | head -n 5000\nexit 1\n");
  chmodSync(hook, 0o755);
  schreibe(d, "a.md", "# a\n");
  const v = oeffneVault(d); v.vertrauen(true); // Hooks laufen nur mit Vertrauen (§8)
  const e = await wirft(v.gitCommit({ nachricht: "x", dateien: ["a.md"] }));
  assert.equal(e.status, 422); assert.ok(e.extra.ausgabe.length < 4100); assert.match(e.extra.ausgabe, /gekürzt/);
});

test("Sync ohne Remote → 400; kein Repo → 400", async () => {
  assert.equal((await wirft(oeffneVault(repo()).gitSync())).status, 400);
  assert.equal((await wirft(oeffneVault(tmp()).gitSync())).status, 400);
});

test("Sync: aktuell, gesendet, geholt, beides; letzterSync in .git/brain-studio.json", async () => {
  const { a, b, v, bare } = mitRemote();
  let s = await v.gitStatus();
  assert.equal(s.remote, true); assert.equal(s.upstream, "origin/main"); assert.equal(s.vor, 0); assert.equal(s.zurueck, 0);

  const r1 = await v.gitSync();
  assert.equal(r1.ergebnis, "aktuell"); assert.match(r1.letzterSync, /^\d{4}-\d\d-\d\dT/);
  assert.equal(JSON.parse(readFileSync(join(a, ".git", "brain-studio.json"), "utf8")).letzterSync, r1.letzterSync);
  assert.equal((await v.gitStatus()).letzterSync, r1.letzterSync);

  schreibe(a, "lokal.md", "# lokal\n"); g(a, "add", "--", "lokal.md"); g(a, "commit", "-q", "-m", "lokal");
  s = await v.gitStatus(); assert.equal(s.vor, 1);
  assert.equal((await v.gitSync()).ergebnis, "gesendet");
  assert.equal(g(bare, "log", "-1", "--format=%s", "main").trim(), "lokal");
  assert.equal((await v.gitStatus()).vor, 0);

  g(b, "pull", "-q"); commitB(b, "von-b.md", "# b\n", "von b");
  s = await v.gitStatus(); assert.equal(s.zurueck, 0, "Status holt nichts von selbst");
  assert.equal((await v.gitSync()).ergebnis, "geholt");
  assert.equal(readFileSync(join(a, "von-b.md"), "utf8"), "# b\n");
  assert.equal(g(a, "rev-parse", "HEAD"), g(bare, "rev-parse", "main"));

  commitB(b, "b2.md", "# b2\n", "b zwei");
  schreibe(a, "a2.md", "# a2\n"); g(a, "add", "--", "a2.md"); g(a, "commit", "-q", "-m", "a zwei");
  assert.equal((await v.gitSync()).ergebnis, "beides");
  assert.ok(existsSync(join(a, "b2.md")) && existsSync(join(a, "a2.md")));
  assert.equal(g(a, "rev-parse", "HEAD"), g(bare, "rev-parse", "main"));
  assert.equal(g(a, "status", "--porcelain").trim(), "");
  const s3 = await v.gitStatus(); assert.equal(s3.vor, 0); assert.equal(s3.zurueck, 0);
});

test("Sync: lokale ungesicherte Änderung bleibt beim Holen erhalten", async () => {
  const { a, b, v } = mitRemote();
  commitB(b, "von-b.md", "# b\n", "von b");
  schreibe(a, "wip.md", "# in Arbeit\n");
  assert.equal((await v.gitSync()).ergebnis, "geholt");
  assert.equal(readFileSync(join(a, "wip.md"), "utf8"), "# in Arbeit\n");
});

test("Sync: Konflikt → merge --abort, 409 mit Dateien, Arbeitsstand unverändert", async () => {
  const { a, b, v, bare } = mitRemote();
  commitB(b, "start.md", "# Start\nVersion von B\n", "B ändert start");
  writeFileSync(join(a, "start.md"), "# Start\nVersion von A\n");
  g(a, "add", "--", "start.md"); g(a, "commit", "-q", "-m", "A ändert start");
  schreibe(a, "wip.md", "# ungesichert\n"); // darf nicht verloren gehen
  const kopf = g(a, "rev-parse", "HEAD");
  const remoteKopf = g(bare, "rev-parse", "main");
  const e = await wirft(v.gitSync());
  assert.equal(e.status, 409);
  assert.deepEqual(e.extra.dateien, ["start.md"]);
  assert.equal(g(a, "rev-parse", "HEAD"), kopf, "HEAD unverändert");
  assert.equal(existsSync(join(a, ".git", "MERGE_HEAD")), false, "Merge abgebrochen");
  assert.equal(readFileSync(join(a, "start.md"), "utf8"), "# Start\nVersion von A\n");
  assert.equal(readFileSync(join(a, "wip.md"), "utf8"), "# ungesichert\n");
  assert.equal(g(bare, "rev-parse", "main"), remoteKopf, "nichts gesendet");
  assert.equal(g(a, "diff", "--name-only", "--diff-filter=U").trim(), "");
  assert.doesNotMatch(readFileSync(join(a, "start.md"), "utf8"), /<<<<|>>>>/);
});

test("Sync: Server nicht erreichbar → 502", async () => {
  const { a, bare, v } = mitRemote();
  renameSync(bare, bare + "-weg");
  const e = await wirft(v.gitSync());
  assert.equal(e.status, 502);
});

test("Sync: erster Push eines neuen Zweigs ohne Upstream (setzt Upstream)", async () => {
  const { a, v, bare } = mitRemote();
  g(a, "checkout", "-q", "-b", "ideen");
  schreibe(a, "i.md", "# i\n"); g(a, "add", "--", "i.md"); g(a, "commit", "-q", "-m", "idee");
  assert.equal((await v.gitSync()).ergebnis, "gesendet");
  assert.equal(g(bare, "log", "-1", "--format=%s", "ideen").trim(), "idee");
  assert.equal((await v.gitStatus()).upstream, "origin/ideen");
});

test("Verlauf folgt Umbenennungen (--follow), max, neueste zuerst", async () => {
  const d = repo();
  const v = oeffneVault(d);
  schreibe(d, "alt.md", "# Alt\nZeile 1\nZeile 2\nZeile 3\nZeile 4\n"); g(d, "add", "--", "alt.md"); g(d, "commit", "-q", "-m", "alt angelegt");
  g(d, "mv", "alt.md", "neu.md"); g(d, "commit", "-q", "-m", "umbenannt");
  writeFileSync(join(d, "neu.md"), "# Alt\nZeile 1\nZeile 2\nZeile 3\nZeile 4\nZeile 5\n"); g(d, "add", "--", "neu.md"); g(d, "commit", "-q", "-m", "erweitert");
  const { eintraege } = await v.gitVerlauf("neu.md");
  assert.deepEqual(eintraege.map((e) => e.nachricht), ["erweitert", "umbenannt", "alt angelegt"]);
  assert.match(eintraege[0].sha, /^[0-9a-f]{40}$/); assert.ok(eintraege[0].kurz.length >= 7);
  assert.equal(eintraege[0].autor, "T"); assert.match(eintraege[0].zeit, /^\d{4}-\d\d-\d\dT/);
  assert.equal((await v.gitVerlauf("neu.md", "2")).eintraege.length, 2);
  assert.equal((await v.gitVerlauf("nix.md")).eintraege.length, 0);
  assert.equal((await wirft(v.gitVerlauf("../x.md"))).status, 403);
});

test("Diff: mit sha (Änderung dieses Commits), ohne sha (Arbeitsstand gegen HEAD), neue Datei", async () => {
  const d = repo();
  const v = oeffneVault(d);
  writeFileSync(join(d, "start.md"), "# Start\nzweite Zeile\n"); g(d, "add", "--", "start.md"); g(d, "commit", "-q", "-m", "zwei");
  const sha = g(d, "rev-parse", "HEAD").trim();
  const mit = (await v.gitDiff("start.md", sha)).diff;
  assert.match(mit, /\+zweite Zeile/); assert.match(mit, /^diff --git/m);
  writeFileSync(join(d, "start.md"), "# Start\nzweite Zeile\ndritte\n");
  const ohne = (await v.gitDiff("start.md")).diff;
  assert.match(ohne, /\+dritte/); assert.doesNotMatch(ohne, /\+zweite Zeile/);
  schreibe(d, "ganz-neu.md", "# neu\n");
  assert.match((await v.gitDiff("ganz-neu.md")).diff, /\+# neu/);
  assert.equal((await v.gitDiff("start.md", sha.slice(0, 7))).diff.includes("zweite Zeile"), true, "kurze sha");
  assert.equal((await wirft(v.gitDiff("start.md", "--output=/tmp/x"))).status, 400);
  assert.equal((await wirft(v.gitDiff("start.md", "deadbeefdeadbeef"))).status, 404);
});

test("Fassung: Inhalt einer früheren Version, bytegleich; unbekannt → 404", async () => {
  const d = repo();
  const v = oeffneVault(d);
  const alt = "# Start\r\nmit CRLF 🧠\r\n";
  writeFileSync(join(d, "start.md"), alt); g(d, "add", "--", "start.md"); g(d, "commit", "-q", "-m", "crlf");
  const sha = g(d, "rev-parse", "HEAD").trim();
  writeFileSync(join(d, "start.md"), "# Neu\n"); g(d, "add", "--", "start.md"); g(d, "commit", "-q", "-m", "neu");
  assert.equal((await v.gitFassung("start.md", sha)).inhalt, alt);
  assert.equal((await wirft(v.gitFassung("start.md", "HEAD~2"))).status, 400, "nur Hex-Versionsnummern");
  assert.equal((await wirft(v.gitFassung("fehlt.md", sha))).status, 404);
  assert.equal((await wirft(v.gitFassung("start.md", "zzzz"))).status, 400);
});
