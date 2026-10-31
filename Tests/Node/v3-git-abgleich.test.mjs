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
    assert.equal((await wirft(x.v.gitKonfliktLoesen({ auswahl: [{ pfad: "start.md", wahl }] }))).status, 400, wahl);
  }
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

// ───────────────────────────── Vertrauen nach gelösten Konflikten ─────────────────────────────

// ───────────────────────────── Nachbesserungen aus dem Review ─────────────────────────────

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

