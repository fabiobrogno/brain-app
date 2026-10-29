// Studio v3: Abgleich mit Konflikten (offen lassen, pro Datei wählen, abschließen, abbrechen), Nachsehen und „Version zurückholen“.
// Nur Wegwerf-Repos und ein Bare-Remote in os.tmpdir() (zwei Klone A und B + bare), kein Netzwerk.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, symlinkSync, unlinkSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmp, schreibe, repo, g, pfad } from "./hilfe.mjs";
process.env.HOME = tmp("brain-home-");  // keine echte ~/.gitconfig
process.env.GIT_CONFIG_NOSYSTEM = "1";

const { oeffneVault, HttpFehler } = await import(pfad("gemeinsam", "vault.mjs"));
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
const wirft = async (p) => { try { await p; } catch (e) { assert.ok(e instanceof HttpFehler, String(e && e.stack)); return e; } assert.fail("kein Fehler"); };
const heute = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

// A = Vault unter Test, B = „anderer Mac“, bare = Server.
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
const commitIn = (d, datei, inhalt, msg, push = false) => {
  schreibe(d, datei, inhalt); g(d, "add", "--", datei); g(d, "commit", "-q", "-m", msg);
  if (push) g(d, "push", "-q");
};
const loeschenIn = (d, datei, msg, push = false) => { g(d, "rm", "-q", "--", datei); g(d, "commit", "-q", "-m", msg); if (push) g(d, "push", "-q"); };
const lies = (d, rel) => readFileSync(join(d, rel), "utf8");
const OPT = { konflikteLoesen: true };

// Standard-Konflikt: beide ändern start.md. A hat zusätzlich eine ungesicherte Datei, die nie verloren gehen darf.
async function konfliktAufbauen() {
  const x = mitRemote();
  commitIn(x.b, "start.md", "# Start\nVersion von B\n", "B ändert start", true);
  commitIn(x.a, "start.md", "# Start\nVersion von A\n", "A ändert start");
  schreibe(x.a, "wip.md", "# ungesichert\n");
  const e = await wirft(x.v.gitSync(OPT));
  return { ...x, e };
}
const mergeOffen = (d) => existsSync(join(d, ".git", "MERGE_HEAD"));

// ───────────────────────────── Abgleich mit Konflikt ─────────────────────────────

test("Sync mit konflikteLoesen: Konflikt bleibt offen (409 konflikt), nichts verloren, Status zeigt ihn, Sichern/Abgleichen sind gesperrt", async () => {
  const { a, e, v, bare } = await konfliktAufbauen();
  assert.equal(e.status, 409); assert.equal(e.extra.konflikt, true); assert.deepEqual(e.extra.dateien, ["start.md"]);
  assert.ok(mergeOffen(a), "Zusammenführung bleibt offen");
  assert.match(lies(a, "start.md"), /<<<<<<<[\s\S]*Version von A[\s\S]*Version von B[\s\S]*>>>>>>>/);
  assert.equal(lies(a, "wip.md"), "# ungesichert\n");
  const s = await v.gitStatus();
  assert.deepEqual(s.konflikt, { dateien: [{ pfad: "start.md", art: "beide" }], versteckt: 0 });
  assert.equal(g(bare, "log", "-1", "--format=%s", "main").trim(), "B ändert start", "nichts gesendet");
  const c = await wirft(v.gitCommit({ nachricht: "x", dateien: ["wip.md"] }));
  assert.equal(c.status, 409); assert.equal(c.extra.konflikt, true);
  const s2 = await wirft(v.gitSync(OPT));
  assert.equal(s2.status, 409); assert.equal(s2.extra.konflikt, true);
  const w = await wirft(v.gitWiederherstellen({ pfad: "start.md", sha: g(a, "rev-parse", "HEAD").trim() }));
  assert.equal(w.status, 409);
});

test("Sync ohne Option bleibt wie bisher: Konflikt wird zurückgenommen", async () => {
  const { a, b, v } = mitRemote();
  commitIn(b, "start.md", "# Start\nB\n", "B", true);
  commitIn(a, "start.md", "# Start\nA\n", "A");
  const e = await wirft(v.gitSync());
  assert.equal(e.status, 409); assert.equal(e.extra.konflikt, undefined);
  assert.equal(mergeOffen(a), false); assert.equal(lies(a, "start.md"), "# Start\nA\n");
});

test("Konflikt-Ansicht: beide Fassungen als Text; unbekannte Datei → 404", async () => {
  const { v } = await konfliktAufbauen();
  const r = await v.gitKonflikte();
  assert.equal(r.aktiv, true); assert.deepEqual(r.dateien, [{ pfad: "start.md", art: "beide" }]);
  const d = await v.gitKonflikte("start.md");
  assert.equal(d.datei.meine.text, "# Start\nVersion von A\n"); assert.equal(d.datei.andere.text, "# Start\nVersion von B\n");
  assert.equal((await wirft(v.gitKonflikte("wip.md"))).status, 404);
  assert.equal((await wirft(v.gitKonflikte("../x"))).status, 404);
});

test("Lösen „meine Fassung“: Merge-Commit mit zwei Eltern (nichts umgeschrieben), danach Abgleich sendet", async () => {
  const { a, b, v, bare, e } = await konfliktAufbauen();
  const vorher = g(a, "rev-parse", "HEAD").trim();
  const bKopf = g(b, "rev-parse", "HEAD").trim();
  const r = await v.gitKonfliktAbschliessen({ auswahl: [{ pfad: "start.md", wahl: "meine" }] });
  assert.equal(r.dateien, 1); assert.deepEqual(r.zweiteDateien, []);
  assert.equal(mergeOffen(a), false);
  assert.equal(lies(a, "start.md"), "# Start\nVersion von A\n");
  assert.equal(g(a, "rev-list", "--parents", "-n", "1", "HEAD").trim(), `${r.sha} ${vorher} ${bKopf}`, "Merge-Commit: eigene Spitze + Spitze des anderen Macs");
  assert.match(g(a, "log", "-1", "--format=%s").trim(), /^Abgleich: Konflikte gelöst \(start\.md\)$/);
  assert.equal(lies(a, "wip.md"), "# ungesichert\n", "ungesicherte Datei unberührt");
  assert.equal(g(a, "status", "--porcelain").trim(), "?? wip.md");
  assert.equal((await v.gitSync(OPT)).ergebnis, "gesendet");
  assert.equal(g(bare, "rev-parse", "main").trim(), r.sha);
  assert.equal(g(a, "merge-base", "--is-ancestor", bKopf, "HEAD"), "", "B-Commit bleibt im Verlauf");
  assert.equal((await v.gitStatus()).konflikt, null);
});

test("Lösen „Fassung vom anderen Mac“", async () => {
  const { a, v } = await konfliktAufbauen();
  await v.gitKonfliktAbschliessen({ auswahl: [{ pfad: "start.md", wahl: "andere" }] });
  assert.equal(lies(a, "start.md"), "# Start\nVersion von B\n"); assert.equal(mergeOffen(a), false);
  assert.equal((await v.gitSync(OPT)).ergebnis, "gesendet");
});

test("Lösen „beide behalten“: meine bleibt, die andere liegt als „<Name> (Konflikt <Datum>).md“ daneben; beides ist im Commit", async () => {
  const { a, b, v, bare } = await konfliktAufbauen();
  const r = await v.gitKonfliktAbschliessen({ auswahl: [{ pfad: "start.md", wahl: "beide" }] });
  const zweite = `start (Konflikt ${heute()}).md`;
  assert.deepEqual(r.zweiteDateien, [zweite]);
  assert.equal(lies(a, "start.md"), "# Start\nVersion von A\n"); assert.equal(lies(a, zweite), "# Start\nVersion von B\n");
  assert.deepEqual(g(a, "ls-tree", "--name-only", "HEAD").trim().split("\n").sort(), ["start (Konflikt " + heute() + ").md", "start.md"].sort());
  assert.doesNotMatch(lies(a, "start.md"), /<<<<|>>>>/);
  assert.equal((await v.gitSync(OPT)).ergebnis, "gesendet");
  g(b, "pull", "-q"); assert.equal(lies(b, zweite), "# Start\nVersion von B\n");
  assert.equal(g(bare, "ls-tree", "--name-only", "main").includes("Konflikt"), true);
});

test("„beide behalten“ in Unterordner, zweimal am selben Tag: Namen kollidieren nie, nichts wird überschrieben", async () => {
  const { a, b, v } = mitRemote();
  commitIn(a, "ordner/notiz.md", "# n\n", "n", true); g(b, "pull", "-q");
  commitIn(b, "ordner/notiz.md", "# n\nB1\n", "B1", true);
  commitIn(a, "ordner/notiz.md", "# n\nA1\n", "A1");
  await wirft(v.gitSync(OPT));
  const r1 = await v.gitKonfliktAbschliessen({ auswahl: [{ pfad: "ordner/notiz.md", wahl: "beide" }] });
  assert.deepEqual(r1.zweiteDateien, [`ordner/notiz (Konflikt ${heute()}).md`]);
  await v.gitSync(OPT);
  g(b, "pull", "-q", "--no-rebase", "--no-edit"); commitIn(b, "ordner/notiz.md", "# n\nB2\n", "B2", true);
  commitIn(a, "ordner/notiz.md", "# n\nA2\n", "A2");
  const e = await wirft(v.gitSync(OPT));
  assert.equal(e.extra.konflikt, true);
  const r2 = await v.gitKonfliktAbschliessen({ auswahl: [{ pfad: "ordner/notiz.md", wahl: "beide" }] });
  assert.deepEqual(r2.zweiteDateien, [`ordner/notiz (Konflikt ${heute()} 2).md`]);
  assert.equal(lies(a, `ordner/notiz (Konflikt ${heute()}).md`), "# n\nB1\n", "erste Kopie unverändert");
});

test("Löschen gegen Ändern: meine/andere/beide wählen die jeweils vorhandene Seite, nie Datenverlust ohne Wahl", async () => {
  for (const [wahl, bleibt] of [["meine", false], ["andere", true], ["beide", true]]) {
    const { a, b, v } = mitRemote();
    commitIn(b, "start.md", "# Start\nB hat geändert\n", "B ändert", true);
    loeschenIn(a, "start.md", "A löscht");
    const e = await wirft(v.gitSync(OPT));
    assert.equal(e.extra.konflikt, true, wahl);
    const k = await v.gitKonflikte();
    assert.deepEqual(k.dateien, [{ pfad: "start.md", art: "meine-geloescht" }], wahl);
    await v.gitKonfliktAbschliessen({ auswahl: [{ pfad: "start.md", wahl }] });
    assert.equal(existsSync(join(a, "start.md")), bleibt, wahl);
    if (bleibt) assert.equal(lies(a, "start.md"), "# Start\nB hat geändert\n");
    assert.equal(mergeOffen(a), false);
    assert.equal(g(a, "status", "--porcelain").trim(), "");
  }
  // andersherum: der andere löscht, ich habe geändert
  for (const [wahl, bleibt] of [["meine", true], ["andere", false], ["beide", true]]) {
    const { a, b, v } = mitRemote();
    loeschenIn(b, "start.md", "B löscht", true);
    commitIn(a, "start.md", "# Start\nA hat geändert\n", "A ändert");
    const e = await wirft(v.gitSync(OPT));
    assert.equal(e.extra.konflikt, true);
    assert.deepEqual((await v.gitKonflikte()).dateien, [{ pfad: "start.md", art: "andere-geloescht" }]);
    await v.gitKonfliktAbschliessen({ auswahl: [{ pfad: "start.md", wahl }] });
    assert.equal(existsSync(join(a, "start.md")), bleibt, wahl);
    assert.equal(mergeOffen(a), false);
  }
});

test("Mehrere Dateien: jede mit eigener Wahl; nicht kollidierende Dateien des anderen Macs kommen mit", async () => {
  const { a, b, v } = mitRemote();
  commitIn(a, "x.md", "# x\n", "x"); commitIn(a, "y.md", "# y\n", "y"); g(a, "push", "-q"); g(b, "pull", "-q");
  commitIn(b, "x.md", "# x\nB\n", "Bx"); commitIn(b, "y.md", "# y\nB\n", "By"); commitIn(b, "neu-von-b.md", "# neu\n", "Bneu"); g(b, "push", "-q");
  commitIn(a, "x.md", "# x\nA\n", "Ax"); commitIn(a, "y.md", "# y\nA\n", "Ay");
  const e = await wirft(v.gitSync(OPT));
  assert.deepEqual(e.extra.dateien, ["x.md", "y.md"]);
  await v.gitKonfliktAbschliessen({ auswahl: [{ pfad: "x.md", wahl: "meine" }, { pfad: "y.md", wahl: "andere" }] });
  assert.equal(lies(a, "x.md"), "# x\nA\n"); assert.equal(lies(a, "y.md"), "# y\nB\n"); assert.equal(lies(a, "neu-von-b.md"), "# neu\n");
  assert.match(g(a, "log", "-1", "--format=%s").trim(), /\(x\.md, y\.md\)/);
});

test("Abschließen prüft die Auswahl vollständig, bevor etwas angefasst wird", async () => {
  const { a, v } = await konfliktAufbauen();
  const vorher = lies(a, "start.md");
  for (const [auswahl, status] of [
    [[], 400], [undefined, 400], ["start.md", 400],
    [[{ pfad: "start.md", wahl: "--ours" }], 400], [[{ pfad: "start.md", wahl: "alle" }], 400], [[{ pfad: "start.md" }], 400],
    [[{ pfad: "wip.md", wahl: "meine" }], 400],            // hat keinen Konflikt
    [[{ pfad: "../außen.md", wahl: "meine" }], 400], [[{ pfad: "/etc/passwd", wahl: "meine" }], 400], [[{ pfad: ".git/config", wahl: "meine" }], 400],
    [[{ pfad: "start.md", wahl: "meine" }, { pfad: "wip.md", wahl: "meine" }], 400],
    [[null], 400], [[{ pfad: ["start.md"], wahl: "meine" }], 400],
  ]) {
    const e = await wirft(v.gitKonfliktAbschliessen({ auswahl }));
    assert.equal(e.status, status, JSON.stringify(auswahl));
  }
  assert.ok(mergeOffen(a), "Konflikt weiterhin offen"); assert.equal(lies(a, "start.md"), vorher, "Datei unangetastet");
  assert.equal(g(a, "ls-files", "-u").trim().split("\n").length, 3, "weiterhin ungelöst");
});

test("Abbrechen = merge --abort: Stand wie vorher, ungesicherte Datei bleibt, Handarbeit liegt in .git/brain-sicherung", async () => {
  const { a, b, v, bare } = await konfliktAufbauen();
  const kopf = g(a, "rev-parse", "HEAD").trim();
  writeFileSync(join(a, "start.md"), "# von Hand halb gelöst\n");  // jemand hat in der Konfliktdatei gearbeitet
  const ab = await v.gitKonfliktAbbrechen();
  assert.equal(ab.ok, true); assert.ok(ab.sicherung.includes("brain-sicherung"));
  assert.equal(mergeOffen(a), false); assert.equal(g(a, "rev-parse", "HEAD").trim(), kopf);
  assert.equal(lies(a, "start.md"), "# Start\nVersion von A\n"); assert.equal(lies(a, "wip.md"), "# ungesichert\n");
  assert.equal(g(a, "ls-files", "-u").trim(), "");
  const sicherungen = readdirSync(join(a, ".git", "brain-sicherung"));
  assert.equal(sicherungen.length, 1);
  assert.equal(readFileSync(join(a, ".git", "brain-sicherung", sicherungen[0], "start.md"), "utf8"), "# von Hand halb gelöst\n");
  assert.equal(g(bare, "rev-parse", "main").trim(), g(b, "rev-parse", "HEAD").trim(), "Server unberührt");
  assert.equal((await v.gitStatus()).konflikt, null);
  assert.equal((await wirft(v.gitKonfliktAbbrechen())).status, 409, "nichts mehr abzubrechen");
  assert.equal((await wirft(v.gitKonfliktAbschliessen({ auswahl: [] }))).status, 409);
  assert.deepEqual(await v.gitKonflikte(), { aktiv: false, dateien: [] });
  // und der nächste Abgleich geht wieder von vorn los
  assert.equal((await wirft(v.gitSync(OPT))).extra.konflikt, true);
});

test("Versteckte Konfliktdateien (Punkt-Ordner) bleiben automatisch bei meiner Fassung; nur sie → Abgleich läuft ohne Rückfrage durch", async () => {
  const { a, b, v, bare } = mitRemote();
  commitIn(a, ".tools/einstellung.txt", "basis\n", "t", true); g(b, "pull", "-q");
  commitIn(b, ".tools/einstellung.txt", "B\n", "Bt", true);
  commitIn(a, ".tools/einstellung.txt", "A\n", "At");
  const r = await v.gitSync(OPT);
  assert.equal(r.ergebnis, "beides"); assert.equal(mergeOffen(a), false);
  assert.equal(lies(a, ".tools/einstellung.txt"), "A\n");
  assert.equal(g(bare, "rev-parse", "main").trim(), g(a, "rev-parse", "HEAD").trim());
  // gemischt: sichtbare Datei fragt nach, die versteckte ist schon erledigt und taucht nirgends auf
  g(b, "pull", "-q", "--no-rebase", "--no-edit"); commitIn(b, ".tools/einstellung.txt", "B2\n", "Bt2"); commitIn(b, "start.md", "# Start\nB\n", "Bs"); g(b, "push", "-q");
  commitIn(a, ".tools/einstellung.txt", "A2\n", "At2"); commitIn(a, "start.md", "# Start\nA\n", "As");
  const e = await wirft(v.gitSync(OPT));
  assert.deepEqual(e.extra.dateien, ["start.md"]);
  assert.deepEqual((await v.gitStatus()).konflikt.dateien, [{ pfad: "start.md", art: "beide" }]);
  assert.equal(lies(a, ".tools/einstellung.txt"), "A2\n");
  await v.gitKonfliktAbschliessen({ auswahl: [{ pfad: "start.md", wahl: "andere" }] });
  assert.equal(g(a, "ls-files", "-u").trim(), ""); assert.equal(mergeOffen(a), false);
});

test("Zeigt der Server nur Neues ohne Konflikt, verhält sich konflikteLoesen wie sonst; ungesicherte Änderung im Weg → 409 ohne offene Zusammenführung", async () => {
  const { a, b, v } = mitRemote();
  commitIn(b, "von-b.md", "# b\n", "von b", true);
  assert.equal((await v.gitSync(OPT)).ergebnis, "geholt");
  // ungesicherte Änderung in einer Datei, die der andere ändert → Git lehnt den Merge ab
  commitIn(b, "start.md", "# Start\nB\n", "B", true);
  writeFileSync(join(a, "start.md"), "# Start\nlokal ungesichert\n");
  const e = await wirft(v.gitSync(OPT));
  assert.equal(e.status, 409); assert.notEqual(e.extra.konflikt, true);
  assert.equal(mergeOffen(a), false); assert.equal(lies(a, "start.md"), "# Start\nlokal ungesichert\n");
});

// ───────────────────────────── Zustand sichtbar / Nachsehen ─────────────────────────────

test("Zustand: nicht gesicherte Änderungen, nicht hochgeladene Commits und Neues vom anderen Mac (nach Nachsehen)", async () => {
  const { a, b, v } = mitRemote();
  commitIn(a, "lokal.md", "# l\n", "lokal");
  writeFileSync(join(a, "start.md"), "# Start\nmehr\n"); schreibe(a, "neu.md", "# n\n");
  commitIn(b, "von-b.md", "# b\n", "von b", true);
  let s = await v.gitStatus();
  assert.equal(s.zurueck, 0, "ohne Nachsehen weiß der Mac noch nichts vom Neuen");
  const n = await v.gitNachsehen();
  assert.equal(n.geholt, true); assert.equal(n.zurueck, 1); assert.equal(n.vor, 1); assert.deepEqual(n.geaendert.map((x) => x.pfad), ["neu.md", "start.md"]);
  s = await v.gitStatus(); assert.equal(s.zurueck, 1); assert.equal(s.vor, 1); assert.equal(s.geaendert.length, 2); assert.equal(s.konflikt, null);
  assert.equal(existsSync(join(a, "von-b.md")), false, "Nachsehen holt nur, führt nichts zusammen");
  assert.equal(mergeOffen(a), false);
  assert.equal(lies(a, "start.md"), "# Start\nmehr\n");
});

test("Nachsehen: ohne Remote kein Fehler; Server weg → 502 ohne Zugangsdaten in der Antwort", async () => {
  const lokal = oeffneVault(repo());
  const n = await lokal.gitNachsehen();
  assert.equal(n.geholt, false); assert.equal(n.remote, false);
  const { a, v } = mitRemote();
  g(a, "remote", "set-url", "origin", "https://nutzer:geheim123@127.0.0.1:9/x.git");
  const e = await wirft(v.gitNachsehen());
  assert.ok([502, 403, 404].includes(e.status), String(e.status));
  assert.doesNotMatch(JSON.stringify({ m: e.message, x: e.extra }), /geheim123/);
});

// ───────────────────────────── Version zurückholen ─────────────────────────────

function dreiFassungen() {
  const d = repo();
  const v = oeffneVault(d);
  commitIn(d, "notiz.md", "# Notiz\nErste Fassung\n", "n1");
  const sha1 = g(d, "rev-parse", "HEAD").trim();
  commitIn(d, "notiz.md", "# Notiz\nZweite Fassung\nmit mehr\n", "n2");
  const sha2 = g(d, "rev-parse", "HEAD").trim();
  commitIn(d, "notiz.md", "# Notiz\nDritte Fassung\n", "n3");
  return { d, v, sha1, sha2 };
}

test("Wiederherstellen: Vorschau-Diff, dann NEUER Commit; Verlauf bleibt vollständig, nichts umgeschrieben", async () => {
  const { d, v, sha1 } = dreiFassungen();
  const vor = await v.gitWiederherstellenVorschau("notiz.md", sha1);
  assert.match(vor.diff, /-Dritte Fassung/); assert.match(vor.diff, /\+Erste Fassung/); assert.equal(vor.ungesichert, false); assert.equal(vor.unveraendert, false);
  const kopf = g(d, "rev-parse", "HEAD").trim();
  const anzahl = Number(g(d, "rev-list", "--count", "HEAD"));
  const r = await v.gitWiederherstellen({ pfad: "notiz.md", sha: sha1.slice(0, 8) });
  assert.equal(r.unveraendert, false); assert.match(r.sha, /^[0-9a-f]{40}$/);
  assert.equal(lies(d, "notiz.md"), "# Notiz\nErste Fassung\n");
  assert.equal(g(d, "rev-parse", "HEAD~1").trim(), kopf, "neuer Commit obenauf (Eltern = alte Spitze)");
  assert.equal(Number(g(d, "rev-list", "--count", "HEAD")), anzahl + 1);
  assert.match(g(d, "log", "-1", "--format=%s").trim(), /^Fassung vom \d\d\.\d\d\.\d{4} wiederhergestellt: notiz\.md$/);
  assert.equal(g(d, "status", "--porcelain").trim(), "");
  assert.deepEqual(g(d, "log", "--format=%s", "--", "notiz.md").trim().split("\n").slice(1), ["n3", "n2", "n1"], "alle alten Einträge noch da");
  assert.equal(g(d, "diff", "--name-only", "HEAD~1", "HEAD").trim(), "notiz.md", "nur diese Datei im Commit");
  // und noch einmal zurück zur dritten Fassung geht ebenfalls (Rückgängig)
  await v.gitWiederherstellen({ pfad: "notiz.md", sha: kopf });
  assert.equal(lies(d, "notiz.md"), "# Notiz\nDritte Fassung\n");
});

test("Wiederherstellen: schon die aktuelle Fassung → kein leerer Commit; andere ungesicherte Dateien bleiben unberührt und ungesichert", async () => {
  const { d, v, sha2 } = dreiFassungen();
  schreibe(d, "andere.md", "# in Arbeit\n");
  const kopf = g(d, "rev-parse", "HEAD").trim();
  const heuteSha = kopf;
  assert.deepEqual(await v.gitWiederherstellen({ pfad: "notiz.md", sha: heuteSha }), { sha: null, unveraendert: true });
  assert.equal(g(d, "rev-parse", "HEAD").trim(), kopf);
  await v.gitWiederherstellen({ pfad: "notiz.md", sha: sha2 });
  assert.equal(lies(d, "andere.md"), "# in Arbeit\n"); assert.equal(g(d, "status", "--porcelain").trim(), "?? andere.md");
  assert.equal(g(d, "show", "--name-only", "--format=", "HEAD").trim(), "notiz.md");
});

test("Wiederherstellen: ungesicherte Änderungen an der Datei → 409, Datei bleibt wie sie ist", async () => {
  const { d, v, sha1 } = dreiFassungen();
  writeFileSync(join(d, "notiz.md"), "# Notiz\nmeine frische Arbeit\n");
  const kopf = g(d, "rev-parse", "HEAD").trim();
  const e = await wirft(v.gitWiederherstellen({ pfad: "notiz.md", sha: sha1 }));
  assert.equal(e.status, 409); assert.equal(e.extra.art, "ungesichert");
  assert.equal(lies(d, "notiz.md"), "# Notiz\nmeine frische Arbeit\n"); assert.equal(g(d, "rev-parse", "HEAD").trim(), kopf);
  assert.equal((await v.gitWiederherstellenVorschau("notiz.md", sha1)).ungesichert, true);
});

test("Wiederherstellen: gelöschte Datei kommt zurück; Datei, die es in der Version nicht gab, → 404", async () => {
  const { d, v, sha1 } = dreiFassungen();
  loeschenIn(d, "notiz.md", "weg");
  assert.equal(existsSync(join(d, "notiz.md")), false);
  const vor = await v.gitWiederherstellenVorschau("notiz.md", sha1);
  assert.match(vor.diff, /\+Erste Fassung/);
  await v.gitWiederherstellen({ pfad: "notiz.md", sha: sha1 });
  assert.equal(lies(d, "notiz.md"), "# Notiz\nErste Fassung\n"); assert.equal(g(d, "status", "--porcelain").trim(), "");
  assert.equal((await wirft(v.gitWiederherstellen({ pfad: "gab-es-nie.md", sha: sha1 }))).status, 404);
  assert.equal((await wirft(v.gitWiederherstellenVorschau("gab-es-nie.md", sha1))).status, 404);
  assert.equal((await wirft(v.gitWiederherstellen({ pfad: "notiz.md", sha: "deadbeefdeadbeef" }))).status, 404);
});

test("Wiederherstellen: Rückweg, wenn der Commit abgelehnt wird (Hook im vertrauten Vault) — Datei und Vormerkung wie vorher", async () => {
  const { d, v, sha1 } = dreiFassungen();
  // Ein Commit, den ein pre-commit-Hook ablehnt. Ohne Vertrauen laufen Hooks nie; also den Fehler über eine unlesbare Identität erzwingen.
  g(d, "config", "user.useConfigOnly", "true"); g(d, "config", "--unset", "user.name"); g(d, "config", "--unset", "user.email");
  const kopf = g(d, "rev-parse", "HEAD").trim();
  const e = await wirft(v.gitWiederherstellen({ pfad: "notiz.md", sha: sha1 }));
  assert.equal(e.status, 422);
  assert.equal(g(d, "rev-parse", "HEAD").trim(), kopf);
  assert.equal(lies(d, "notiz.md"), "# Notiz\nDritte Fassung\n");
  assert.equal(g(d, "status", "--porcelain").trim(), "", "weder Änderung noch Vormerkung bleibt");
});

test("Wiederherstellen: nur Versionen aus dem eigenen Verlauf; ein Zweig, der wie eine Versionsnummer aussieht, zählt nicht", async () => {
  const { d, v } = dreiFassungen();
  g(d, "checkout", "-q", "-b", "nebenzweig", "HEAD~2"); commitIn(d, "notiz.md", "# Notiz\nNur im Nebenzweig\n", "nz");
  const nz = g(d, "rev-parse", "HEAD").trim();
  g(d, "checkout", "-q", "main");
  assert.equal((await wirft(v.gitWiederherstellen({ pfad: "notiz.md", sha: nz }))).status, 404, "Commit gehört nicht zu HEAD");
  g(d, "branch", "dead", "HEAD");
  for (const sha of ["dead", "beef"]) {
    g(d, "branch", "-f", sha, "HEAD~1");
    const e = await wirft(v.gitWiederherstellen({ pfad: "notiz.md", sha }));
    assert.equal(e.status, 404, sha);
  }
  assert.equal(lies(d, "notiz.md"), "# Notiz\nDritte Fassung\n");
});

// ───────────────────────────── Sicherheit ─────────────────────────────

test("Pfade strikt im Vault: Traversal, absolute Pfade, .git, Punkt-Ordner, Symlinks nach draußen — Vorschau und Wiederherstellen", async () => {
  const { d, v, sha1 } = dreiFassungen();
  const draussen = tmp("brain-draussen-");
  schreibe(draussen, "geheim.md", "# geheim\n");
  symlinkSync(draussen, join(d, "ext"));
  g(d, "add", "--", "ext"); g(d, "commit", "-q", "-m", "link");
  const kopf = g(d, "rev-parse", "HEAD").trim();
  const schlecht = ["../x.md", "a/../../x.md", "/etc/passwd", "~/x.md", "..", ".", "", "   ", ".git/config", ".git/HEAD", ".tools/x.md", "ordner/.versteckt.md", "node_modules/x.md",
    "ext/geheim.md", "a\\b.md", "x\0y.md"];
  for (const pfad of schlecht) {
    for (const f of [() => v.gitWiederherstellenVorschau(pfad, sha1), () => v.gitWiederherstellen({ pfad, sha: sha1 })]) {
      const e = await wirft(f());
      assert.ok([400, 403, 404].includes(e.status), `${JSON.stringify(pfad)} → ${e.status}`);
    }
  }
  for (const pfad of [null, undefined, 5, ["notiz.md"], {}]) {
    assert.equal((await wirft(v.gitWiederherstellen({ pfad, sha: sha1 }))).status, 400);
  }
  assert.equal(g(d, "rev-parse", "HEAD").trim(), kopf, "kein Commit entstanden");
  assert.equal(readFileSync(join(draussen, "geheim.md"), "utf8"), "# geheim\n", "außerhalb nichts angefasst");
  assert.deepEqual(readdirSync(draussen), ["geheim.md"]);
});

test("Keine Optionen oder Transporte durchschleusbar: ext::, -o…, --output, Hex-Falle — nichts wird ausgeführt oder geschrieben", async () => {
  const { d, v, sha1 } = dreiFassungen();
  const marke = join(tmp("brain-marke-"), "gehackt");
  const boese = [`ext::sh -c "touch ${marke}" x`, `--output=${marke}`, `-o${marke}`, "--upload-pack=touch x", "-c core.fsmonitor=x", "HEAD", "main", "HEAD~1", "@{u}", ":/n1", "--", "-n", "zzzz", "", null, undefined, 7, ["abc"]];
  for (const sha of boese) {
    for (const f of [() => v.gitWiederherstellen({ pfad: "notiz.md", sha }), () => v.gitWiederherstellenVorschau("notiz.md", sha)]) {
      const e = await wirft(f());
      assert.equal(e.status, 400, JSON.stringify(sha));
    }
  }
  // Pfade, die wie Optionen oder Transporte aussehen, sind nur Dateinamen (nach `--`, wörtlich): „gibt es nicht“
  for (const pfad of [`ext::sh -c "touch ${marke}" x`, "--output=x", "-x.md", "--help", "*.md", ":(glob)*.md", "n*.md"]) {
    const e = await wirft(v.gitWiederherstellen({ pfad, sha: sha1 }));
    assert.ok([403, 404].includes(e.status), `${pfad} → ${e.status}`);
  }
  // dasselbe für die Konfliktauswahl
  const x = await konfliktAufbauen();
  for (const wahl of [`ext::sh -c "touch ${marke}" x`, "--theirs", "-X", "meine ", "Meine", ""]) {
    assert.equal((await wirft(x.v.gitKonfliktAbschliessen({ auswahl: [{ pfad: "start.md", wahl }] }))).status, 400, wahl);
  }
  assert.equal((await wirft(x.v.gitKonflikte("--ours"))).status, 404);
  assert.equal(existsSync(marke), false); assert.equal(existsSync(join(d, "x")), false);
  assert.equal(g(d, "status", "--porcelain").trim(), "");
});

test("Kein Datenverlust beim Pfadmuster: GIT_LITERAL_PATHSPECS — „*.md“ trifft nie mehrere Dateien", async () => {
  const { d, v, sha1 } = dreiFassungen();
  commitIn(d, "zweite.md", "# zwei\nneu\n", "z");
  const e = await wirft(v.gitWiederherstellen({ pfad: "*.md", sha: sha1 }));
  assert.equal(e.status, 404);
  assert.equal(lies(d, "zweite.md"), "# zwei\nneu\n");
});

// ───────────────────────────── über den Handler (Routen) ─────────────────────────────

test("Routen: sync mit konflikteLoesen, konflikt, konflikt/loesen, wiederherstellen — Methoden und Fehler", async () => {
  const { a, b } = mitRemote();
  const h = erzeugeHandler({ vault: a });
  const rufe = async (methode, p, daten, query) => {
    const r = await h({ methode, pfad: p, query: query ?? null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) });
    let j = null; try { j = JSON.parse(r.body.toString("utf8")); } catch { /* egal */ }
    return { status: r.status, j };
  };
  commitIn(b, "start.md", "# Start\nB\n", "B", true);
  commitIn(a, "start.md", "# Start\nA\n", "A");
  let r = await rufe("POST", "/api/git/sync", {});
  assert.equal(r.status, 409); assert.equal(r.j.konflikt, undefined); assert.equal(mergeOffen(a), false);
  r = await rufe("POST", "/api/git/sync", { konflikteLoesen: true });
  assert.equal(r.status, 409); assert.equal(r.j.konflikt, true); assert.deepEqual(r.j.dateien, ["start.md"]);
  r = await rufe("GET", "/api/git/status");
  assert.deepEqual(r.j.konflikt.dateien, [{ pfad: "start.md", art: "beide" }]);
  r = await rufe("GET", "/api/git/konflikt", undefined, new URLSearchParams({ pfad: "start.md" }));
  assert.equal(r.status, 200); assert.equal(r.j.datei.andere.text, "# Start\nB\n");
  assert.equal((await rufe("GET", "/api/git/konflikt/loesen")).status, 405);
  assert.equal((await rufe("POST", "/api/git/konflikt/loesen", { auswahl: [] })).status, 400);
  assert.equal((await rufe("POST", "/api/git/konflikt/loesen")).status, 400);
  r = await rufe("POST", "/api/git/konflikt/loesen", { auswahl: [{ pfad: "start.md", wahl: "beide" }] });
  assert.equal(r.status, 200); assert.equal(r.j.zweiteDateien.length, 1);
  r = await rufe("POST", "/api/git/sync", { konflikteLoesen: true });
  assert.equal(r.status, 200); assert.equal(r.j.ergebnis, "gesendet");
  r = await rufe("POST", "/api/git/nachsehen");
  assert.equal(r.status, 200); assert.equal(r.j.geholt, true); assert.equal(r.j.konflikt, null);
  assert.equal((await rufe("GET", "/api/git/nachsehen")).status, 405);
  const sha = g(a, "rev-list", "--max-parents=0", "HEAD").trim();
  assert.equal((await rufe("GET", "/api/git/wiederherstellen/vorschau", undefined, new URLSearchParams({ pfad: "start.md", sha }))).status, 200);
  r = await rufe("POST", "/api/git/wiederherstellen", { pfad: "start.md", sha });
  assert.equal(r.status, 200); assert.equal(lies(a, "start.md"), "# Start\n");
  assert.equal((await rufe("POST", "/api/git/wiederherstellen", { pfad: "../x", sha })).status, 403);
  assert.equal((await rufe("POST", "/api/git/wiederherstellen", { pfad: "start.md", sha: "--force" })).status, 400);
  assert.equal((await rufe("POST", "/api/git/konflikt/abbrechen")).status, 409, "kein offener Abgleich");
});

// ───────────────────────────── Vertrauen nach gelösten Konflikten ─────────────────────────────

test("Nach gelösten Konflikten wird das Vertrauen vor dem Senden neu bewertet: kein Hook aus fremdem Code, nichts gesendet", async () => {
  const { sync } = await import(pfad("gemeinsam", "git.mjs"));
  const { a, v, bare } = await konfliktAufbauen();
  const marke = join(tmp("brain-marke-"), "hook-lief");
  const hook = join(a, ".git", "hooks", "pre-push");
  writeFileSync(hook, `#!/bin/sh\ntouch '${marke}'\nexit 0\n`, { mode: 0o755 });
  await v.gitKonfliktAbschliessen({ auswahl: [{ pfad: "start.md", wahl: "meine" }] });
  const serverVorher = g(bare, "rev-parse", "main").trim();
  const r1 = await sync(a, { vertraut: true, neuBewerten: () => ({ vertraut: false, gesperrt: false }) });
  assert.equal(r1.vertrauenGeaendert, true); assert.equal(r1.ergebnis, "aktuell");
  assert.equal(g(bare, "rev-parse", "main").trim(), serverVorher, "nichts gesendet");
  assert.equal(existsSync(marke), false, "kein Hook gelaufen");
  const r2 = await sync(a, { vertraut: true, neuBewerten: () => ({ vertraut: true, gesperrt: false }) });
  assert.equal(r2.ergebnis, "gesendet"); assert.equal(r2.vertrauenGeaendert, undefined);
  assert.equal(existsSync(marke), true, "bei bestehendem Vertrauen laufen die Hooks wie gewohnt");
});

// ───────────────────────────── Nachbesserungen aus dem Review ─────────────────────────────

test("Offene Zusammenführung ohne sichtbare Datei (im Terminal gelöst): Abschließen mit leerer Auswahl möglich — keine Sackgasse", async () => {
  const { a, v } = await konfliktAufbauen();
  writeFileSync(join(a, "start.md"), "# Start\nvon Hand gelöst\n"); g(a, "add", "--", "start.md");
  const s = await v.gitStatus();
  assert.deepEqual(s.konflikt, { dateien: [], versteckt: 0 });
  assert.deepEqual(await v.gitKonflikte(), { aktiv: true, dateien: [] });
  const r = await v.gitKonfliktAbschliessen({ auswahl: [] });
  assert.equal(r.dateien, 0); assert.equal(mergeOffen(a), false);
  assert.equal(lies(a, "start.md"), "# Start\nvon Hand gelöst\n");
  assert.equal((await v.gitSync(OPT)).ergebnis, "gesendet");
});

test("Versteckte Konflikte werden gemeldet (versteckteBehalten), Sicherungsort kommt in der Antwort", async () => {
  const { a, b, v } = mitRemote();
  commitIn(a, ".obsidian/app.json", "{}\n", "o", true); g(b, "pull", "-q");
  commitIn(b, ".obsidian/app.json", "{\"b\":1}\n", "Bo"); commitIn(b, "start.md", "# Start\nB\n", "Bs"); g(b, "push", "-q");
  commitIn(a, ".obsidian/app.json", "{\"a\":1}\n", "Ao"); commitIn(a, "start.md", "# Start\nA\n", "As");
  const e1 = await wirft(v.gitSync(OPT));
  assert.deepEqual(e1.extra.versteckteBehalten, [".obsidian/app.json"], "schon der Abgleich meldet, was automatisch bei deiner Fassung blieb");
  const r = await v.gitKonfliktAbschliessen({ auswahl: [{ pfad: "start.md", wahl: "meine" }] });
  assert.ok(r.sicherung && existsSync(join(r.sicherung, "start.md")), "Sicherungskopie liegt da");
  // nur versteckte Konflikte: Abgleich meldet sie im Ergebnis
  commitIn(b, ".obsidian/app.json", "{\"b\":2}\n", "Bo2"); g(b, "pull", "-q", "--no-rebase", "--no-edit"); g(b, "push", "-q");
  await v.gitSync(OPT);
  g(b, "pull", "-q", "--no-rebase", "--no-edit");
  commitIn(b, ".obsidian/app.json", "{\"b\":3}\n", "Bo3", true);
  commitIn(a, ".obsidian/app.json", "{\"a\":3}\n", "Ao3");
  const e2 = await v.gitSync(OPT);
  assert.deepEqual(e2.versteckteBehalten, [".obsidian/app.json"]);
});

test("Abbrechen, nachdem eine konfliktfrei zusammengeführte Datei neu bearbeitet wurde: 409 mit klarer Meldung, nichts geht verloren", async () => {
  const { a, b, v } = mitRemote();
  commitIn(a, "ruhig.md", "# r\n", "r", true); g(b, "pull", "-q");
  commitIn(b, "start.md", "# Start\nB\n", "Bs"); commitIn(b, "ruhig.md", "# r\nvon B\n", "Br"); g(b, "push", "-q");
  commitIn(a, "start.md", "# Start\nA\n", "As");
  await wirft(v.gitSync(OPT));
  assert.equal(lies(a, "ruhig.md"), "# r\nvon B\n", "konfliktfrei übernommen");
  writeFileSync(join(a, "ruhig.md"), "# r\nmeine neue Arbeit\n");
  const e = await wirft(v.gitKonfliktAbbrechen());
  assert.equal(e.status, 409); assert.equal(e.extra.art, "geaendert");
  assert.equal(lies(a, "ruhig.md"), "# r\nmeine neue Arbeit\n"); assert.ok(mergeOffen(a));
});

test("Konfliktarten: nur eine Seite hat die Datei (neu/umbenannt) heißt nur-meine/nur-andere; beide gelöscht erledigt sich selbst", async () => {
  const { a, b, v } = mitRemote();
  commitIn(a, "x.md", "# x\nZeile 1\nZeile 2\nZeile 3\nZeile 4\nZeile 5\n", "x", true); g(b, "pull", "-q");
  g(b, "mv", "x.md", "b-name.md"); g(b, "commit", "-q", "-m", "B benennt um"); g(b, "push", "-q");
  g(a, "mv", "x.md", "a-name.md"); g(a, "commit", "-q", "-m", "A benennt um");
  const e = await wirft(v.gitSync(OPT));
  assert.equal(e.extra.konflikt, true);
  const k = (await v.gitKonflikte()).dateien;
  assert.ok(k.every((x) => !["meine-geloescht", "andere-geloescht"].includes(x.art)), JSON.stringify(k));
  assert.ok(k.some((x) => x.art === "nur-meine") || k.some((x) => x.art === "nur-andere"), JSON.stringify(k));
  assert.ok(!k.some((x) => x.pfad === "x.md"), "der alte Name (beide gelöscht) fragt nicht");
  // beide Namen behalten: jeweils die eigene Seite bzw. die des anderen übernehmen → beide Dateien existieren
  await v.gitKonfliktAbschliessen({ auswahl: k.map((x) => ({ pfad: x.pfad, wahl: x.art === "nur-meine" ? "meine" : "andere" })) });
  assert.ok(existsSync(join(a, "a-name.md")) && existsSync(join(a, "b-name.md")));
  assert.equal(mergeOffen(a), false);
});

test("Wiederherstellen überschreibt nie, was nicht im Verlauf steht: Datei wurde zum Ordner, darüber liegt eine Datei, ignorierte Datei an der Stelle", async () => {
  const d = repo();
  const v = oeffneVault(d);
  commitIn(d, "thema", "# war mal eine Datei\n", "datei");
  const sha = g(d, "rev-parse", "HEAD").trim();
  g(d, "rm", "-q", "--", "thema"); g(d, "commit", "-q", "-m", "weg");
  commitIn(d, "thema/x.md", "# jetzt Ordner\n", "ordner");
  writeFileSync(join(d, "thema/x.md"), "# ungesichert im Ordner\n"); schreibe(d, "thema/neu.md", "# untracked\n");
  const e = await wirft(v.gitWiederherstellen({ pfad: "thema", sha }));
  assert.equal(e.status, 409);
  assert.equal(lies(d, "thema/x.md"), "# ungesichert im Ordner\n"); assert.equal(lies(d, "thema/neu.md"), "# untracked\n");
  // darüber liegt eine ungesicherte Datei
  commitIn(d, "a/b.md", "# b\n", "ab"); const sha2 = g(d, "rev-parse", "HEAD").trim();
  g(d, "rm", "-q", "-r", "--", "a"); g(d, "commit", "-q", "-m", "a weg");
  schreibe(d, "a", "ich bin jetzt eine Datei\n");
  assert.equal((await wirft(v.gitWiederherstellen({ pfad: "a/b.md", sha: sha2 }))).status, 409);
  assert.equal(lies(d, "a"), "ich bin jetzt eine Datei\n");
  unlinkSync(join(d, "a"));
  // ignorierte Datei an der Stelle einer früher gelöschten
  commitIn(d, "alt.md", "# alt\n", "alt"); const sha3 = g(d, "rev-parse", "HEAD").trim();
  g(d, "rm", "-q", "--", "alt.md"); g(d, "commit", "-q", "-m", "alt weg");
  commitIn(d, ".gitignore", "alt.md\n", "ign");
  schreibe(d, "alt.md", "# meine ignorierte Datei\n");
  assert.equal((await wirft(v.gitWiederherstellen({ pfad: "alt.md", sha: sha3 }))).status, 409);
  assert.equal(lies(d, "alt.md"), "# meine ignorierte Datei\n");
});

test("Aufräumen: Sicherungen älter als 30 Tage verschwinden beim nächsten Konfliktstart — nur echte Zeitstempel-Ordner, Symlinks nie verfolgt", async () => {
  const { a, v } = await konfliktAufbauen();
  const wurzel = join(a, ".git", "brain-sicherung");
  const alt = (name) => { const p = join(wurzel, name); mkdirSync(p, { recursive: true }); schreibe(p, "x.md", "alt\n"); const t = new Date(Date.now() - 40 * 86_400_000); utimesSync(p, t, t); return p; };
  const altOrdner = alt("2026-01-01T10-00-00-000Z");
  const jung = join(wurzel, "2026-10-28T10-00-00-000Z"); mkdirSync(jung, { recursive: true });
  const fremd = alt("meine-eigene-sammlung");           // kein Zeitstempel-Name: bleibt
  const draussen = tmp("brain-draussen-"); schreibe(draussen, "wichtig.md", "bleibt\n");
  symlinkSync(draussen, join(wurzel, "2026-01-02T10-00-00-000Z")); // Symlink mit passendem Namen: wird nicht verfolgt und nicht gelöscht
  await v.gitKonfliktAbbrechen();
  assert.equal(existsSync(altOrdner), false); assert.equal(existsSync(jung), true); assert.equal(existsSync(fremd), true);
  assert.equal(readFileSync(join(draussen, "wichtig.md"), "utf8"), "bleibt\n");
});
