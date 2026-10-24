// Studio v2: Git-Verlauf nach Tagen (git.log) und „Remote hinzufügen“ mit Historien-Prüfung (git.remoteHinzufuegen).
// Nur Wegwerf-Repos und Bare-Remotes in os.tmpdir(); kein Netzwerk.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, unlinkSync, symlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmp, schreibe, repo, g, pfad } from "./hilfe.mjs";
process.env.HOME = tmp("brain-home-");          // os.homedir() liest $HOME: git liest keine echte ~/.gitconfig
process.env.GIT_CONFIG_NOSYSTEM = "1";          // und keine System-Konfiguration

const { HttpFehler } = await import(pfad("gemeinsam", "basis.mjs"));
const { log, remoteHinzufuegen, status } = await import(pfad("gemeinsam", "git.mjs"));
const wirft = async (p) => { try { await p; } catch (e) { assert.ok(e instanceof HttpFehler, String(e && e.stack)); return e; } assert.fail("kein Fehler"); };
const nfc = (s) => s.normalize("NFC");

// Git mit fester Identität und festem Datum (hilfe.g entfernt alle GIT_*-Variablen und setzt kein Datum).
function gd(cwd, datum, ...args) {
  const e = { ...process.env };
  for (const k of Object.keys(e)) if (k.startsWith("GIT_") && k !== "GIT_CONFIG_NOSYSTEM") delete e[k];
  Object.assign(e, { GIT_AUTHOR_NAME: "Anna", GIT_AUTHOR_EMAIL: "anna@example.org", GIT_COMMITTER_NAME: "Anna", GIT_COMMITTER_EMAIL: "anna@example.org" });
  if (datum) { e.GIT_AUTHOR_DATE = datum; e.GIT_COMMITTER_DATE = datum; }
  return execFileSync("git", args, { cwd, env: e, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
const neuesRepo = (praefix = "brain-v2git-") => { const d = tmp(praefix); g(d, "init", "-q", "-b", "main"); g(d, "config", "user.name", "T"); g(d, "config", "user.email", "t@example.org"); return d; };
// Schreibt die Dateien (Text oder Buffer), merkt genau diese vor und committet (auch schon Vorgemerktes, z. B. git rm/mv).
function commitAm(d, datum, nachricht, dateien = {}) {
  for (const [rel, inhalt] of Object.entries(dateien)) { const p = join(d, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, inhalt); }
  if (Object.keys(dateien).length) gd(d, datum, "add", "--", ...Object.keys(dateien));
  gd(d, datum, "commit", "-q", "--allow-empty", "-m", nachricht);
  return gd(d, datum, "rev-parse", "HEAD").trim();
}
const alleCommits = (r) => r.tage.flatMap((t) => t.commits);
const nachricht = (r, n) => alleCommits(r).find((c) => c.nachricht === n);
const nachPfad = (dateien) => [...dateien].sort((a, b) => (a.pfad < b.pfad ? -1 : 1));

// ───────────────────────────── Verlauf ─────────────────────────────

test("Verlauf: Gruppierung nach BERLINER Tag (über UTC-Mitternacht, Sommer- und Winterzeit), Beschriftung, neueste zuerst", async () => {
  const d = neuesRepo();
  const zeiten = [
    ["2026-10-19T10:00:00Z", "A1"], // Mo 19.10. 12:00 MESZ
    ["2026-10-20T21:59:00Z", "A2"], // Di 20.10. 23:59 MESZ
    ["2026-10-20T22:00:00Z", "A3"], // Mi 21.10. 00:00 MESZ — in UTC noch der 20.
    ["2026-10-20T23:30:00Z", "A4"], // Mi 21.10. 01:30 MESZ
    ["2026-10-21T10:00:00Z", "A5"], // Mi 21.10. 12:00 MESZ
    ["2026-12-15T22:59:00Z", "W1"], // Di 15.12. 23:59 MEZ (Winterzeit, UTC+1)
    ["2026-12-15T23:00:00Z", "W2"], // Mi 16.12. 00:00 MEZ — in UTC noch der 15.
  ];
  zeiten.forEach(([t, n], i) => commitAm(d, t, n, { [`f${i}.md`]: `${n}\n` }));
  const r = await log(d);
  assert.deepEqual(r.tage.map((t) => [t.datum, t.commits.map((c) => c.nachricht)]), [
    ["2026-12-16", ["W2"]], ["2026-12-15", ["W1"]], ["2026-10-21", ["A5", "A4", "A3"]], ["2026-10-20", ["A2"]], ["2026-10-19", ["A1"]]]);
  assert.deepEqual(r.tage.map((t) => t.beschriftung), ["Mittwoch, 16. Dezember 2026", "Dienstag, 15. Dezember 2026", "Mittwoch, 21. Oktober 2026",
    "Dienstag, 20. Oktober 2026", "Montag, 19. Oktober 2026"]);
  assert.equal(r.weitere, false); assert.equal(r.naechste, null);
  const c = r.tage[0].commits[0];
  assert.equal(c.autor, "Anna"); assert.match(c.zeit, /^2026-12-15T23:00:00(Z|\+00:00)$/, "%cI: strenges ISO 8601");
  assert.match(c.sha, /^[0-9a-f]{40}$/); assert.ok(c.kurz.length >= 7 && c.sha.startsWith(c.kurz)); assert.equal(c.merge, false);
  assert.deepEqual(Object.keys(c).sort(), ["autor", "dateien", "dateienGesamt", "geaendert", "geloescht", "kurz", "merge", "nachricht", "plus", "sha", "versteckt", "zeilenPlus", "zeilenMinus", "zeit"].sort());
});

test("Verlauf: Zähler plus/geaendert/geloescht, Zeilen, Umbenennung (von), Status A/M/D/R", async () => {
  const d = neuesRepo();
  commitAm(d, "2026-10-19T10:00:00Z", "Anfang", { "a.md": "1\n2\n3\n", "b.md": "x\ny\n", "c.md": "c1\nc2\nc3\nc4\n" });
  gd(d, null, "rm", "-q", "--", "b.md");
  gd(d, null, "mv", "c.md", "c-neu.md");
  commitAm(d, "2026-10-19T11:00:00Z", "Zweiter", { "a.md": "1\n2\n3\n4\n5\n", "d.md": "n\n" });
  const r = await log(d);
  const z = nachricht(r, "Zweiter");
  assert.deepEqual(nachPfad(z.dateien), [
    { pfad: "a.md", status: "M", plus: 2, minus: 0 },
    { pfad: "b.md", status: "D", plus: 0, minus: 2 },
    { pfad: "c-neu.md", status: "R", von: "c.md", plus: 0, minus: 0 },
    { pfad: "d.md", status: "A", plus: 1, minus: 0 },
  ]);
  assert.deepEqual([z.plus, z.geaendert, z.geloescht, z.zeilenPlus, z.zeilenMinus, z.dateienGesamt, z.versteckt], [1, 2, 1, 3, 2, 4, 0], "M+R zählen als geändert");
  const a = nachricht(r, "Anfang");
  assert.deepEqual([a.plus, a.geaendert, a.geloescht, a.zeilenPlus, a.zeilenMinus, a.dateienGesamt], [3, 0, 0, 9, 0, 3]);
  assert.ok(a.dateien.every((x) => x.status === "A" && !("von" in x)));
});

test("Verlauf: Leerzeichen, Umlaute, Tab, „->“ und Zeilenumbruch im Dateinamen, Binärdatei, Umbenennung mit Sonderzeichen", async () => {
  const d = neuesRepo();
  const namen = ["mit Leerzeichen.md", "Übung äöü.md", "ta\tb.md", "a -> b.md", "zeile\numbruch.md"];
  const dateien = Object.fromEntries(namen.map((n) => [n, `${n.length}\n`]));
  dateien["binär.dat"] = Buffer.from([0, 1, 2, 255, 0, 98, 105, 110]);
  commitAm(d, "2026-10-19T10:00:00Z", "Namen", dateien);
  gd(d, null, "mv", "Übung äöü.md", "ü neu -> x.md");
  commitAm(d, "2026-10-19T11:00:00Z", "Umbenannt");
  const r = await log(d);
  const n = nachricht(r, "Namen");
  assert.deepEqual(n.dateien.map((x) => nfc(x.pfad)).sort(), [...namen, "binär.dat"].map(nfc).sort());
  assert.ok(n.dateien.every((x) => x.status === "A"));
  const bin = n.dateien.find((x) => nfc(x.pfad) === nfc("binär.dat"));
  assert.deepEqual([bin.plus, bin.minus], [0, 0], "Binärdatei: 0/0");
  assert.equal(n.zeilenPlus, 5, "nur die fünf Textdateien (je eine Zeile)");
  const u = nachricht(r, "Umbenannt");
  assert.equal(u.dateien.length, 1);
  assert.deepEqual([u.dateien[0].status, nfc(u.dateien[0].von), nfc(u.dateien[0].pfad)], ["R", nfc("Übung äöü.md"), nfc("ü neu -> x.md")]);
  assert.deepEqual([u.plus, u.geaendert, u.geloescht], [0, 1, 0]);
});

test("Verlauf: Autor und Nachricht mit Umlauten/Emoji bleiben heil; Typwechsel (Datei → Symlink) zählt als geändert", async () => {
  const d = neuesRepo();
  commitAm(d, "2026-10-19T10:00:00Z", "Anfang", { "a.md": "1\n", "t.md": "text\n" });
  gd(d, "2026-10-19T11:00:00Z", "commit", "-q", "--allow-empty", "--author=Jörg Müller <jm@example.org>", "-m", "Änderung für Übung 🧠\n\nLangtext darunter");
  unlinkSync(join(d, "t.md")); symlinkSync("a.md", join(d, "t.md"));
  gd(d, null, "add", "--", "t.md");
  commitAm(d, "2026-10-19T12:00:00Z", "Typwechsel");
  const r = await log(d);
  const u = nachricht(r, "Änderung für Übung 🧠");
  assert.ok(u, "Nachricht (nur die erste Zeile) unversehrt"); assert.equal(nfc(u.autor), "Jörg Müller");
  const t = nachricht(r, "Typwechsel");
  assert.deepEqual(t.dateien.map((x) => [x.pfad, x.status]), [["t.md", "M"]]);
  assert.deepEqual([t.plus, t.geaendert, t.geloescht], [0, 1, 0]);
});

test("Verlauf: gesperrte Pfade (.tools, node_modules in jeder Schreibweise, Punkt-Dateien) fehlen in dateien und Zählern, versteckt zählt", async () => {
  const d = neuesRepo();
  commitAm(d, "2026-10-19T10:00:00Z", "Mit Versteckten", {
    "sichtbar.md": "s\n", ".tools/geheim.md": "h\n", "node_modules/x/i.js": "n\n", "sub/Node_Modules/q.js": "q\n", "ordner/.versteckt.md": "v\n", ".gitignore": "# nichts\n" });
  const r = await log(d);
  const c = nachricht(r, "Mit Versteckten");
  assert.deepEqual(c.dateien, [{ pfad: "sichtbar.md", status: "A", plus: 1, minus: 0 }]);
  assert.deepEqual([c.plus, c.geaendert, c.geloescht, c.zeilenPlus, c.dateienGesamt, c.versteckt], [1, 0, 0, 1, 1, 5]);
  assert.doesNotMatch(JSON.stringify(r), /geheim|versteckt\.md|node_modules|Node_Modules|gitignore/i);
});

test("Verlauf: Umbenennung über die Sperre hinweg nennt den gesperrten Pfad nie (neu → A, weg → D), beide gesperrt → nur versteckt", async () => {
  const d = neuesRepo();
  commitAm(d, "2026-10-19T10:00:00Z", "Basis", { ".tools/alt.md": "a1\na2\na3\n", "sichtbar3.md": "s1\ns2\ns3\n", ".tools/beide.md": "b1\nb2\nb3\n" });
  mkdirSync(join(d, ".archiv"));
  gd(d, null, "mv", ".tools/alt.md", "sichtbar2.md");
  gd(d, null, "mv", "sichtbar3.md", ".archiv/sichtbar3.md");
  gd(d, null, "mv", ".tools/beide.md", ".tools/beide2.md");
  commitAm(d, "2026-10-19T11:00:00Z", "Verschoben");
  const c = nachricht(await log(d), "Verschoben");
  assert.deepEqual(nachPfad(c.dateien).map((x) => [x.pfad, x.status, "von" in x]), [["sichtbar2.md", "A", false], ["sichtbar3.md", "D", false]]);
  assert.deepEqual([c.plus, c.geaendert, c.geloescht, c.dateienGesamt, c.versteckt], [1, 0, 1, 2, 3]);
  assert.doesNotMatch(JSON.stringify(c), /\.tools|\.archiv|beide|alt\.md/);
});

test("Verlauf: Merge-Commit (merge:true, keine Dateien, keine Zähler), die anderen Commits behalten ihre Dateien", async () => {
  const d = neuesRepo();
  commitAm(d, "2026-10-19T10:00:00Z", "Basis", { "basis.md": "b\n" });
  gd(d, null, "checkout", "-q", "-b", "feat");
  commitAm(d, "2026-10-19T11:00:00Z", "Feature", { "feat.md": "f\n" });
  gd(d, null, "checkout", "-q", "main");
  commitAm(d, "2026-10-19T12:00:00Z", "Haupt", { "haupt.md": "m\n" });
  gd(d, "2026-10-19T13:00:00Z", "merge", "-q", "--no-ff", "-m", "Merge feat", "feat");
  const r = await log(d);
  const m = nachricht(r, "Merge feat");
  assert.equal(m.merge, true);
  assert.deepEqual([m.dateien, m.dateienGesamt, m.plus, m.geaendert, m.geloescht, m.zeilenPlus, m.zeilenMinus, m.versteckt], [[], 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(r.tage[0].commits[0].nachricht, "Merge feat");
  for (const [n, datei] of [["Feature", "feat.md"], ["Haupt", "haupt.md"], ["Basis", "basis.md"]]) {
    const c = nachricht(r, n);
    assert.equal(c.merge, false); assert.deepEqual(c.dateien.map((x) => x.pfad), [datei]); assert.equal(c.plus, 1);
  }
  assert.equal(alleCommits(r).length, 4);
});

// Holt die ganze Historie seitenweise und prüft nebenbei weitere/naechste jeder Seite.
async function seitenweise(d, max, kurzeSha = false) {
  const shas = [];
  let vor;
  for (let seite = 0; seite < 200; seite++) {
    const r = await log(d, { max, vor });
    const hier = alleCommits(r).map((c) => c.sha);
    assert.ok(hier.length >= 1 && hier.length <= max, `Seite ${seite}: ${hier.length} Commits bei max ${max}`);
    shas.push(...hier);
    if (!r.weitere) { assert.equal(r.naechste, null); return shas; }
    assert.equal(hier.length, max, "eine Seite mit weitere ist voll");
    assert.equal(r.naechste, hier[hier.length - 1], "naechste = letzter gelieferter Commit");
    vor = kurzeSha ? r.naechste.slice(0, 9) : r.naechste;
  }
  assert.fail("endlose Seiten");
}

test("Verlauf: seitenweise (max, vor) — vollständig, ohne Doppelte, in Reihenfolge von git rev-list; linear und mit Merges", async () => {
  const linear = neuesRepo();
  for (let i = 1; i <= 7; i++) commitAm(linear, `2026-10-1${i}T10:00:00Z`, `L${i}`, { [`l${i}.md`]: `${i}\n` });
  const sollLinear = g(linear, "rev-list", "HEAD").trim().split("\n");
  for (const max of [1, 2, 3, 6, 7, 8, 50]) assert.deepEqual(await seitenweise(linear, max), sollLinear, `linear, max ${max}`);
  assert.deepEqual(await seitenweise(linear, 2, true), sollLinear, "mit kurzer sha als vor");

  // genau max Commits: kein „weitere“; max-1: weitere mit naechste = letzter
  const genau = await log(linear, { max: 7 });
  assert.equal(genau.weitere, false); assert.equal(genau.naechste, null);
  const eins = await log(linear, { max: 6 });
  assert.equal(eins.weitere, true); assert.equal(eins.naechste, sollLinear[5]);
  const rest = await log(linear, { max: 6, vor: eins.naechste });
  assert.deepEqual(alleCommits(rest).map((c) => c.sha), [sollLinear[6]]); assert.equal(rest.weitere, false);
  assert.deepEqual((await log(linear, { max: 3, vor: sollLinear[6] })), { tage: [], weitere: false, naechste: null }, "nach dem ältesten Commit kommt nichts");

  // Merge-Historie mit verzahnten Zeiten: die Reihenfolge ist die von git log, nicht die von vor^
  const m = neuesRepo();
  commitAm(m, "2026-10-01T10:00:00Z", "M1", { "m1.md": "1\n" });
  gd(m, null, "checkout", "-q", "-b", "feat");
  commitAm(m, "2026-10-02T10:00:00Z", "F1", { "f1.md": "1\n" });
  gd(m, null, "checkout", "-q", "main");
  commitAm(m, "2026-10-03T10:00:00Z", "M2", { "m2.md": "1\n" });
  gd(m, null, "checkout", "-q", "feat");
  commitAm(m, "2026-10-04T10:00:00Z", "F2", { "f2.md": "1\n" });
  commitAm(m, "2026-10-05T10:00:00Z", "F3", { "f3.md": "1\n" });
  gd(m, null, "checkout", "-q", "main");
  gd(m, "2026-10-06T10:00:00Z", "merge", "-q", "--no-ff", "-m", "Merge feat", "feat");
  commitAm(m, "2026-10-07T10:00:00Z", "M4", { "m4.md": "1\n" });
  gd(m, null, "checkout", "-q", "-b", "feat2", "main~2");
  commitAm(m, "2026-10-08T10:00:00Z", "G1", { "g1.md": "1\n" });
  gd(m, null, "checkout", "-q", "main");
  gd(m, "2026-10-09T10:00:00Z", "merge", "-q", "--no-ff", "-m", "Merge feat2", "feat2");
  const sollMerge = g(m, "rev-list", "HEAD").trim().split("\n");
  assert.equal(sollMerge.length, 9);
  for (const max of [1, 2, 3, 4, 5, 100]) assert.deepEqual(await seitenweise(m, max), sollMerge, `Merges, max ${max}`);
  assert.equal(new Set(sollMerge).size, 9);
});

test("Verlauf: max wird begrenzt (Standard 50, 1..200), Text und Unsinn tun nichts Schlimmes", async () => {
  const d = neuesRepo();
  for (let i = 1; i <= 3; i++) commitAm(d, `2026-10-1${i}T10:00:00Z`, `K${i}`, { [`k${i}.md`]: "k\n" });
  assert.equal(alleCommits(await log(d, { max: "2" })).length, 2);
  assert.equal(alleCommits(await log(d, { max: 0 })).length, 3, "0 → Standard 50");
  assert.equal(alleCommits(await log(d, { max: "abc" })).length, 3, "Text → Standard 50");
  assert.equal(alleCommits(await log(d, { max: -5 })).length, 1, "unter 1 → 1");
  assert.equal(alleCommits(await log(d, { max: 100000 })).length, 3);
  assert.equal(alleCommits(await log(d, {})).length, 3);
  assert.equal(alleCommits(await log(d)).length, 3);
  // Obergrenze 200: 205 leere Commits
  const viele = neuesRepo();
  for (let i = 0; i < 205; i++) gd(viele, "2026-10-01T10:00:00Z", "commit", "-q", "--allow-empty", "-m", `n${i}`);
  const r = await log(viele, { max: 100000 });
  assert.equal(alleCommits(r).length, 200); assert.equal(r.weitere, true); assert.equal(r.naechste, alleCommits(r)[199].sha);
  const std = await log(viele);
  assert.equal(alleCommits(std).length, 50);
});

test("Verlauf: kein Repo → 400, Repo ohne Commit → leer, ungültiges vor → 400, unbekanntes oder fremdes vor → 404", async () => {
  assert.equal((await wirft(log(tmp()))).status, 400);
  const leer = tmp(); g(leer, "init", "-q", "-b", "main");
  assert.deepEqual(await log(leer), { tage: [], weitere: false, naechste: null });
  assert.deepEqual(await log(leer, { vor: "abcdef12" }), { tage: [], weitere: false, naechste: null });
  assert.equal((await wirft(log(leer, { vor: "--all" }))).status, 400, "Format wird auch ohne Commit geprüft");

  const d = neuesRepo();
  const c1 = commitAm(d, "2026-10-19T10:00:00Z", "Eins", { "a.md": "1\n" });
  gd(d, null, "checkout", "-q", "-b", "seitenzweig");
  const fremd = commitAm(d, "2026-10-19T11:00:00Z", "Nur im Seitenzweig", { "b.md": "1\n" });
  gd(d, null, "checkout", "-q", "main");
  for (const vor of ["zzzz", "--all", "HEAD~1", "abc", "main", "a".repeat(65), "dead beef", 1234, {}, ["abcd"]]) {
    assert.equal((await wirft(log(d, { vor }))).status, 400, `vor ${JSON.stringify(vor)}`);
  }
  const unbekannt = await wirft(log(d, { vor: "deadbeefdeadbeef" }));
  assert.equal(unbekannt.status, 404); assert.equal(unbekannt.message, "Diese Version gibt es nicht.");
  const nichtImVerlauf = await wirft(log(d, { vor: fremd }));
  assert.equal(nichtImVerlauf.status, 404, "gibt es, gehört aber nicht zum Verlauf von HEAD");
  // ein Zweigname, der wie eine Hex-Zahl aussieht, ist keine Versionsnummer
  gd(d, null, "branch", "cafe", c1);
  const sha = c1.startsWith("cafe") ? null : "cafe";
  if (sha) assert.equal((await wirft(log(d, { vor: "cafe" }))).status, 404);
  // Großbuchstaben sind erlaubt
  assert.deepEqual(await log(d, { vor: c1.toUpperCase() }), { tage: [], weitere: false, naechste: null });
});

test("Verlauf: mehr als 300 Dateien je Commit werden gekappt, Zähler und dateienGesamt kommen aus allen sichtbaren", async () => {
  const d = neuesRepo();
  const dateien = {};
  for (let i = 0; i < 305; i++) dateien[`viele/f${String(i).padStart(3, "0")}.md`] = `${i}\n`;
  dateien[".tools/versteckt.md"] = "x\n";
  commitAm(d, "2026-10-19T10:00:00Z", "Viele", dateien);
  const c = nachricht(await log(d), "Viele");
  assert.equal(c.dateien.length, 300);
  assert.deepEqual([c.dateienGesamt, c.plus, c.zeilenPlus, c.versteckt], [305, 305, 305, 1]);
  assert.equal(c.dateien[0].pfad, "viele/f000.md");
});

// ───────────────────────────── Remote hinzufügen ─────────────────────────────

const bareRepo = (zweig = "main") => { const b = tmp("brain-v2bare-"); g(b, "init", "-q", "--bare", "-b", zweig); return b; };
const remotesVon = (d) => g(d, "remote").trim();
const tempRefs = (d) => g(d, "for-each-ref", "refs/brain-studio").trim();
const kopf = (d) => g(d, "rev-parse", "HEAD").trim();
const spitze = (bare, zweig = "main") => g(bare, "rev-parse", zweig).trim();
const upstream = (d) => { try { return g(d, "rev-parse", "--abbrev-ref", "@{u}").trim(); } catch { return null; } };
// Stand von a ohne Remote-Eintrag auf den Server legen (Senden an die Adresse, nicht an ein Remote)
const aufServer = (d, bare, quelle = "main", ziel = "main") => g(d, "push", "-q", bare, `${quelle}:${ziel}`);
// „Eine andere Person“ legt auf dem Server einen Commit nach.
function vomAnderen(bare, datei, inhalt, msg, zweig = "main") {
  const k = tmp("brain-v2klon-");
  g(k, "clone", "-q", bare, ".");
  g(k, "config", "user.name", "B"); g(k, "config", "user.email", "b@example.org");
  schreibe(k, datei, inhalt); g(k, "add", "--", datei); g(k, "commit", "-q", "-m", msg); g(k, "push", "-q", "origin", `HEAD:${zweig}`);
  return k;
}
const lokalerCommit = (d, datei, inhalt, msg) => { schreibe(d, datei, inhalt); g(d, "add", "--", datei); g(d, "commit", "-q", "-m", msg); return kopf(d); };
const hakenAbgelehnt = (bare) => { const h = join(bare, "hooks", "pre-receive"); writeFileSync(h, "#!/bin/sh\necho 'Regel: hier darf niemand senden' >&2\nexit 1\n"); chmodSync(h, 0o755); };

test("Remote: leeres Bare-Remote → gesendet, origin gesetzt, Upstream gesetzt, letzterSync gemerkt", async () => {
  const a = repo(), bare = bareRepo();
  const r = await remoteHinzufuegen(a, bare);
  assert.deepEqual([r.ok, r.ergebnis, r.remote, r.zweig], [true, "gesendet", "origin", "main"]);
  assert.match(r.letzterSync, /^\d{4}-\d\d-\d\dT/);
  assert.equal(remotesVon(a), "origin"); assert.equal(g(a, "remote", "get-url", "origin").trim(), bare);
  assert.equal(upstream(a), "origin/main");
  assert.equal(spitze(bare), kopf(a));
  assert.equal(tempRefs(a), "");
  const s = await status(a);
  assert.deepEqual([s.upstream, s.remote, s.vor, s.zurueck, s.letzterSync], ["origin/main", true, 0, 0, r.letzterSync]);
  assert.equal(JSON.parse(readFileSync(join(a, ".git", "brain-studio.json"), "utf8")).letzterSync, r.letzterSync);
  assert.equal(g(a, "status", "--porcelain").trim(), "");
});

test("Remote: Server nicht leer, Server-Stand ist Vorfahr → gesendet; gleicher Stand → verbunden (Upstream gesetzt)", async () => {
  const a = repo(), bare = bareRepo();
  aufServer(a, bare);
  const c2 = lokalerCommit(a, "zwei.md", "# zwei\n", "lokal zwei");
  const r = await remoteHinzufuegen(a, bare);
  assert.equal(r.ergebnis, "gesendet");
  assert.equal(spitze(bare), c2); assert.equal(upstream(a), "origin/main"); assert.equal(tempRefs(a), "");

  const b = repo("brain-git2-"), bare2 = bareRepo();
  aufServer(b, bare2);
  const r2 = await remoteHinzufuegen(b, bare2);
  assert.equal(r2.ergebnis, "verbunden");
  assert.equal(upstream(b), "origin/main"); assert.equal(remotesVon(b), "origin"); assert.equal(spitze(bare2), kopf(b));
});

test("Remote: lokaler Stand ist Vorfahr → vorspulen (geholt); Arbeitsstand muss nicht sauber sein", async () => {
  const a = repo(), bare = bareRepo();
  aufServer(a, bare);
  vomAnderen(bare, "von-b.md", "# von b\n", "von b");
  writeFileSync(join(a, "start.md"), "# Start\nnoch nicht gesichert\n"); // tracked, vom Vorspulen nicht berührt
  schreibe(a, "wip.md", "# in Arbeit\n");
  const r = await remoteHinzufuegen(a, bare);
  assert.deepEqual([r.ok, r.ergebnis, r.remote, r.zweig], [true, "geholt", "origin", "main"]);
  assert.equal(kopf(a), spitze(bare));
  assert.equal(readFileSync(join(a, "von-b.md"), "utf8"), "# von b\n");
  assert.equal(readFileSync(join(a, "start.md"), "utf8"), "# Start\nnoch nicht gesichert\n");
  assert.equal(readFileSync(join(a, "wip.md"), "utf8"), "# in Arbeit\n");
  assert.equal(remotesVon(a), "origin"); assert.equal(upstream(a), "origin/main");
  assert.equal(g(a, "rev-parse", "origin/main").trim(), kopf(a));
  assert.equal(tempRefs(a), "");
  const s = await status(a);
  assert.deepEqual([s.vor, s.zurueck], [0, 0]);
});

test("Remote: Vorspulen scheitert an lokalen Änderungen → 409, kein origin, nichts verändert", async () => {
  const a = repo(), bare = bareRepo();
  aufServer(a, bare);
  vomAnderen(bare, "start.md", "# Start\nvon B\n", "B ändert start");
  const vorher = kopf(a), serverVorher = spitze(bare);
  writeFileSync(join(a, "start.md"), "# Start\nlokal geändert\n");
  const e = await wirft(remoteHinzufuegen(a, bare));
  assert.equal(e.status, 409); assert.match(e.message, /Ungesicherte Änderungen/);
  assert.equal(remotesVon(a), ""); assert.equal(kopf(a), vorher); assert.equal(spitze(bare), serverVorher);
  assert.equal(readFileSync(join(a, "start.md"), "utf8"), "# Start\nlokal geändert\n");
  assert.equal(tempRefs(a), ""); assert.equal(existsSync(join(a, ".git", "MERGE_HEAD")), false);
  assert.equal(existsSync(join(a, ".git", "brain-studio.json")), false, "kein Erfolg, kein letzterSync");
});

test("Remote: auseinandergelaufen → 409 art „auseinander“, kein origin, nichts gesendet, Prüf-Ref weg", async () => {
  const a = repo(), bare = bareRepo();
  aufServer(a, bare);
  vomAnderen(bare, "von-b.md", "# b\n", "von b");
  const lokal = lokalerCommit(a, "von-a.md", "# a\n", "von a");
  const serverVorher = spitze(bare);
  const e = await wirft(remoteHinzufuegen(a, bare));
  assert.equal(e.status, 409); assert.equal(e.extra.art, "auseinander"); assert.match(e.message, /auseinandergelaufen/);
  assert.equal(remotesVon(a), ""); assert.equal(kopf(a), lokal); assert.equal(spitze(bare), serverVorher, "Server unverändert");
  assert.equal(tempRefs(a), ""); assert.equal(upstream(a), null);
  assert.equal(existsSync(join(a, ".git", "brain-studio.json")), false);
});

test("Remote: fremde Historie → 409 art „fremd“ mit Erklärung, kein origin, Prüf-Ref weg, Server unverändert", async () => {
  const fremd = neuesRepo("brain-fremd-");
  commitAm(fremd, "2026-01-01T10:00:00Z", "Ganz anderes Projekt", { "ihr.md": "# ihr\n" });
  const bare = bareRepo();
  aufServer(fremd, bare);
  const a = repo();
  const e = await wirft(remoteHinzufuegen(a, bare));
  assert.equal(e.status, 409); assert.equal(e.extra.art, "fremd"); assert.match(e.message, /andere Geschichte/);
  assert.match(e.message, /anderen Projekt/);
  assert.equal(remotesVon(a), ""); assert.equal(tempRefs(a), ""); assert.equal(spitze(bare), kopf(fremd)); assert.equal(upstream(a), null);
  assert.equal(g(a, "for-each-ref", "refs/remotes").trim(), "");
});

test("Remote: schon ein anderes Remote → 409 (Name und Adresse genannt, Zugangsdaten nie); gleiche Adresse → idempotent", async () => {
  const bare = bareRepo();
  const a = repo();
  g(a, "remote", "add", "origin", "https://user:geheimes-token@example.org/team/x.git");
  const e = await wirft(remoteHinzufuegen(a, bare));
  assert.equal(e.status, 409); assert.match(e.message, /origin/); assert.match(e.message, /example\.org\/team\/x\.git/);
  assert.doesNotMatch(JSON.stringify([e.message, e.extra]), /geheimes-token|user:/);
  assert.equal(g(a, "remote", "get-url", "origin").trim(), "https://user:geheimes-token@example.org/team/x.git", "unverändert");

  const b = repo("brain-git2-");
  g(b, "remote", "add", "upstream", "/irgendwo/anders.git");
  const e2 = await wirft(remoteHinzufuegen(b, bare));
  assert.equal(e2.status, 409); assert.match(e2.message, /upstream/);
  assert.equal(remotesVon(b), "upstream");

  const c = repo("brain-git3-");
  g(c, "remote", "add", "origin", bare);                               // gleiche Adresse schon eingetragen
  const r1 = await remoteHinzufuegen(c, bare);
  assert.equal(r1.ergebnis, "gesendet"); assert.equal(remotesVon(c), "origin"); assert.equal(upstream(c), "origin/main");
  const r2 = await remoteHinzufuegen(c, bare);                         // und nochmal: nichts mehr zu tun
  assert.equal(r2.ergebnis, "verbunden"); assert.equal(remotesVon(c), "origin"); assert.equal(spitze(bare), kopf(c));
});

test("Remote: ungültige Adresse (ext::, http://, Option, Zugangsdaten, leer) → 400, nichts eingetragen", async () => {
  const a = repo();
  for (const url of ["ext::sh -c touch /tmp/pwned", "ext::foo", "http://example.org/x.git", "-oProxyCommand=x", "--upload-pack=x", "", "   ", "https://u:p@example.org/x.git",
    "git://example.org/x.git", "relativ/pfad", undefined, 42]) {
    const e = await wirft(remoteHinzufuegen(a, url));
    assert.equal(e.status, 400, `url ${JSON.stringify(url)}`);
  }
  assert.equal(remotesVon(a), ""); assert.equal(tempRefs(a), "");
});

test("Remote: Vault ohne Commit — leeres Remote → verbunden (nur origin), volles Remote → 409; kein Repo → 400; losgelöst → 400", async () => {
  const a = neuesRepo(), bare = bareRepo();
  const r = await remoteHinzufuegen(a, bare);
  assert.deepEqual([r.ok, r.ergebnis, r.remote, r.zweig], [true, "verbunden", "origin", "main"]);
  assert.equal(remotesVon(a), "origin"); assert.equal(g(a, "remote", "get-url", "origin").trim(), bare); assert.equal(upstream(a), null);
  assert.equal(g(bare, "for-each-ref").trim(), "", "nichts gesendet");

  const voll = bareRepo(); aufServer(repo("brain-git2-"), voll);
  const b = neuesRepo();
  const e = await wirft(remoteHinzufuegen(b, voll));
  assert.equal(e.status, 409); assert.match(e.message, /noch keinen Commit/);
  assert.equal(remotesVon(b), "");

  assert.equal((await wirft(remoteHinzufuegen(tmp(), bare))).status, 400, "kein Repo");
  const d = repo(); g(d, "checkout", "-q", "--detach");
  const e2 = await wirft(remoteHinzufuegen(d, bare));
  assert.equal(e2.status, 400); assert.match(e2.message, /keinem Zweig/);
  assert.equal(remotesVon(d), "");
});

test("Remote: Zweigname verschieden — Server-Hauptzweig master: gleicher Stand → gesendet (neuer Zweig main), Server voraus → 409 „zweigname“", async () => {
  const a = repo(), bare = bareRepo("master");
  aufServer(a, bare, "main", "master");
  const r = await remoteHinzufuegen(a, bare);
  assert.equal(r.ergebnis, "gesendet");
  assert.equal(spitze(bare, "main"), kopf(a)); assert.equal(spitze(bare, "master"), kopf(a)); assert.equal(upstream(a), "origin/main");

  const b = repo("brain-git2-"), bare2 = bareRepo("master");
  aufServer(b, bare2, "main", "master");
  vomAnderen(bare2, "von-b.md", "# b\n", "von b", "master");
  const vorher = kopf(b), serverVorher = spitze(bare2, "master");
  const e = await wirft(remoteHinzufuegen(b, bare2));
  assert.equal(e.status, 409); assert.equal(e.extra.art, "zweigname"); assert.match(e.message, /„master“/); assert.match(e.message, /„main“/);
  assert.equal(remotesVon(b), ""); assert.equal(kopf(b), vorher); assert.equal(spitze(bare2, "master"), serverVorher); assert.equal(tempRefs(b), "");
});

test("Remote: Server nicht erreichbar → Fehler mit Alltagsmeldung (404), nichts eingetragen", async () => {
  const a = repo();
  const e = await wirft(remoteHinzufuegen(a, join(tmp(), "gibt-es-nicht.git")));
  assert.equal(e.status, 404); assert.match(e.message, /gibt es nicht/);
  assert.equal(typeof e.extra.ausgabe, "string"); assert.ok(e.extra.ausgabe.length < 4100);
  assert.doesNotMatch(e.message, /fatal|git-upload-pack/);
  assert.equal(remotesVon(a), ""); assert.equal(tempRefs(a), "");
});

test("Remote: Zeitüberschreitung (hängender Server) → 504 mit Alltagsmeldung, Repo wie vorher", async () => {
  const hang = join(tmp("brain-ssh-"), "ssh-haengt");
  writeFileSync(hang, "#!/bin/sh\nexec 2>/dev/null\nexec /bin/sleep 10\n"); chmodSync(hang, 0o755);
  const a = repo();
  const alt = process.env.GIT_SSH_COMMAND;
  process.env.GIT_SSH_COMMAND = hang;
  try {
    const t0 = Date.now();
    const e = await wirft(remoteHinzufuegen(a, "ssh://git@example.invalid/team/x.git", { limit: 500 }));
    assert.equal(e.status, 504); assert.match(e.message, /nicht rechtzeitig|zu lange/);
    assert.ok(Date.now() - t0 < 8000, `dauerte ${Date.now() - t0} ms`);
  } finally { if (alt === undefined) delete process.env.GIT_SSH_COMMAND; else process.env.GIT_SSH_COMMAND = alt; }
  assert.equal(remotesVon(a), ""); assert.equal(tempRefs(a), ""); assert.equal(g(a, "status", "--porcelain").trim(), "");
});

test("Remote: nie force — abgelehntes Senden (Server-Regel) lässt den Server unverändert und nimmt origin zurück; vorhandenes origin bleibt", async () => {
  // leerer Server, der alles ablehnt; origin wird neu gesetzt → muss wieder verschwinden
  const a = repo(), leer = bareRepo(); hakenAbgelehnt(leer);
  const e = await wirft(remoteHinzufuegen(a, leer));
  assert.equal(e.status, 409); assert.match(e.message, /abgelehnt/); assert.match(e.extra.ausgabe, /Regel: hier darf niemand senden/);
  assert.equal(remotesVon(a), ""); assert.equal(upstream(a), null); assert.equal(g(leer, "for-each-ref").trim(), "");
  assert.doesNotMatch(g(a, "config", "--local", "--list"), /remote\.origin|branch\.main\.(remote|merge)/, "auch keine Reste in der Konfiguration");
  // origin war schon (mit gleicher Adresse) eingetragen → bleibt auch nach Fehlschlag
  const b = repo("brain-git2-"), leer2 = bareRepo(); hakenAbgelehnt(leer2);
  g(b, "remote", "add", "origin", leer2);
  await wirft(remoteHinzufuegen(b, leer2));
  assert.equal(remotesVon(b), "origin");
  // Server hat einen Stand, ist hinter uns, lehnt das Senden aber ab → Stand bleibt wie er war
  const c = repo("brain-git3-"), bare = bareRepo();
  aufServer(c, bare);
  const serverVorher = spitze(bare);
  lokalerCommit(c, "neu.md", "# neu\n", "lokal neu");
  hakenAbgelehnt(bare);
  const e2 = await wirft(remoteHinzufuegen(c, bare));
  assert.equal(e2.status, 409);
  assert.equal(spitze(bare), serverVorher); assert.equal(remotesVon(c), ""); assert.equal(tempRefs(c), "");
});

test("Remote: Wettlauf — bekommt der Server zwischen Prüfung und Senden Neues, wird das Senden abgelehnt und nichts überschrieben", async () => {
  const a = repo(), bare = bareRepo();
  aufServer(a, bare);
  lokalerCommit(a, "zwei.md", "# zwei\n", "lokal zwei");
  // „andere Person“ ist startklar, schickt ihren Commit aber erst, wenn unser Senden beginnt (pre-push-Haken)
  const k = tmp("brain-v2klon-");
  g(k, "clone", "-q", bare, "."); g(k, "config", "user.name", "B"); g(k, "config", "user.email", "b@example.org");
  schreibe(k, "dazwischen.md", "# b\n"); g(k, "add", "--", "dazwischen.md"); g(k, "commit", "-q", "-m", "dazwischen");
  const dazwischen = kopf(k);
  const haken = join(a, ".git", "hooks", "pre-push");
  writeFileSync(haken, `#!/bin/sh\nunset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE\ngit -C "${k}" push -q origin HEAD:main >/dev/null 2>&1\nexit 0\n`);
  chmodSync(haken, 0o755);
  const e = await wirft(remoteHinzufuegen(a, bare));
  assert.equal(e.status, 409);
  assert.equal(spitze(bare), dazwischen, "der Commit der anderen Person bleibt, nichts wurde überschrieben");
  assert.equal(remotesVon(a), ""); assert.equal(tempRefs(a), "");
});

test("Remote: zweiter gleichzeitiger Aufruf für denselben Vault → 409 „läuft schon“; danach geht es wieder", async () => {
  const a = repo(), bare = bareRepo();
  const p1 = remoteHinzufuegen(a, bare);
  const e = await wirft(remoteHinzufuegen(a, bare));
  assert.equal(e.status, 409); assert.match(e.message, /läuft schon/);
  assert.equal((await p1).ergebnis, "gesendet");
  assert.equal((await remoteHinzufuegen(a, bare)).ergebnis, "verbunden");
});
