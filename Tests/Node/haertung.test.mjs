// Härtung nach dem Review (W-2 bis W-5 u. a.): Git-Pathspecs, Index, Links, Groß/klein, Zeitlimit, Vertrauen, Umgebung, CSP.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, symlinkSync, linkSync, chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { tmp, schreibe, repo, g, pfad } from "./hilfe.mjs";

const { oeffneVault, HttpFehler } = await import(pfad("gemeinsam", "vault.mjs"));
const { erzeugeHandler, findeClaude } = await import(pfad("werkstatt", "handler.mjs"));
const HASH = (s) => createHash("sha256").update(s).digest("hex");
const wirft = async (p) => { try { await p; } catch (e) { assert.ok(e instanceof HttpFehler, String(e && e.stack)); return e; } assert.fail("kein Fehler"); };
const wirftSync = (f) => { try { f(); } catch (e) { assert.ok(e instanceof HttpFehler, String(e && e.stack)); return e; } assert.fail("kein Fehler"); };
const committet = (d) => g(d, "show", "--name-only", "--format=", "HEAD").trim().split("\n").sort();

// ---------- 1. W-2: Pfade sind Dateinamen, keine Muster ----------
test("Commit: Pfade sind wörtlich (notiz[1].md, *.md, :(glob)) — nie mehr Dateien als gewählt", async () => {
  const d = repo();
  for (const n of ["notiz[1].md", "notiz1.md", "*.md", "a.md", ":(glob)x.md", "x.md"]) schreibe(d, n, `# ${n}\n`);
  const v = oeffneVault(d);
  await v.gitCommit({ nachricht: "eins", dateien: ["notiz[1].md"] });
  assert.deepEqual(committet(d), ["notiz[1].md"]);
  await v.gitCommit({ nachricht: "zwei", dateien: ["*.md"] });
  assert.deepEqual(committet(d), ["*.md"]);
  await v.gitCommit({ nachricht: "drei", dateien: [":(glob)x.md"] });
  assert.deepEqual(committet(d), [":(glob)x.md"]);
  const s = await v.gitStatus();
  assert.deepEqual(s.geaendert.map((e) => e.pfad).sort(), ["a.md", "notiz1.md", "x.md"], "der Rest bleibt offen");
});

// ---------- 2. Index nach Hook-Ablehnung exakt wie vorher ----------
function hook(d, inhalt = "#!/bin/sh\necho abgelehnt >&2\nexit 1\n") { const p = join(d, ".git/hooks/pre-commit"); mkdirSync(join(d, ".git/hooks"), { recursive: true }); writeFileSync(p, inhalt); chmodSync(p, 0o755); }
const indexStand = (d) => ({ baum: g(d, "write-tree").trim(), status: g(d, "status", "--porcelain=v1") });

test("Commit: Hook lehnt ab (422) → Index exakt wie vorher, auch teilweise Vorgemerktes", async () => {
  const d = repo();
  schreibe(d, "start.md", "# Start\nX\n"); g(d, "add", "--", "start.md"); // vorgemerkt: X
  schreibe(d, "start.md", "# Start\nX\nY\n"); // danach weiter geändert: Y nur im Arbeitsordner
  schreibe(d, "fremd.md", "# fremd\n"); g(d, "add", "--", "fremd.md"); // nicht gewählt, aber vorgemerkt
  schreibe(d, "neu.md", "# neu\n");
  const vorher = indexStand(d);
  assert.match(vorher.status, /^MM start\.md$/m);
  hook(d);
  const v = oeffneVault(d); v.vertrauen(true); // der Hook läuft nur mit Vertrauen (Vertrauen v2, §8)
  const e = await wirft(v.gitCommit({ nachricht: "x", dateien: ["start.md", "neu.md"] }));
  assert.equal(e.status, 422); assert.match(e.extra.ausgabe, /abgelehnt/);
  assert.deepEqual(indexStand(d), vorher, "Index und Status unverändert");
  assert.equal(g(d, "show", ":start.md"), "# Start\nX\n");
});

test("Commit: Hook lehnt ab im Repo ohne Commit → Index wie vorher", async () => {
  const d = tmp("brain-leer-");
  g(d, "init", "-q", "-b", "main");
  schreibe(d, "a.md", "# a\n"); g(d, "add", "--", "a.md");
  schreibe(d, "b.md", "# b\n");
  const vorher = indexStand(d);
  hook(d);
  const v = oeffneVault(d); v.vertrauen(true); // der Hook läuft nur mit Vertrauen (§8)
  const e = await wirft(v.gitCommit({ nachricht: "x", dateien: ["b.md"] }));
  assert.equal(e.status, 422);
  assert.deepEqual(indexStand(d), vorher);
});

// ---------- 3. W-3: Symlinks und Hardlinks ----------
test("Schreiben über Symlink: Ziel (im Vault) wird atomar beschrieben, der Link bleibt, Hash/409 gegen das Ziel", () => {
  const d = tmp();
  schreibe(d, "ziel.md", "Z\n");
  symlinkSync("ziel.md", join(d, "link.md"));
  const v = oeffneVault(d);
  const l = v.lies("link.md");
  assert.equal(l.hash, HASH("Z\n"));
  const r = v.schreibe({ pfad: "link.md", inhalt: "NEU\n", basisHash: l.hash });
  assert.equal(r.hash, HASH("NEU\n"));
  assert.equal(readFileSync(join(d, "ziel.md"), "utf8"), "NEU\n");
  assert.equal(readFileSync(join(d, "link.md"), "utf8"), "NEU\n");
  assert.equal(require_lstat(join(d, "link.md")), true, "link.md ist weiter ein Symlink");
  const e = wirftSync(() => v.schreibe({ pfad: "link.md", inhalt: "x", basisHash: l.hash }));
  assert.equal(e.status, 409); assert.equal(e.extra.aktuellerHash, HASH("NEU\n"));
  // Ziel in anderem Ordner und gesperrte/generierte/äußere Ziele
  schreibe(d, "INDEX.md", "# Index\n"); symlinkSync("INDEX.md", join(d, "zu-index.md"));
  assert.equal(wirftSync(() => v.schreibe({ pfad: "zu-index.md", inhalt: "x", basisHash: HASH("# Index\n") })).status, 403);
  assert.equal(readFileSync(join(d, "INDEX.md"), "utf8"), "# Index\n");
  schreibe(d, ".tools/geheim.md", "g\n"); symlinkSync(".tools/geheim.md", join(d, "zu-tools.md"));
  assert.equal(wirftSync(() => v.schreibe({ pfad: "zu-tools.md", inhalt: "x", basisHash: HASH("g\n") })).status, 403);
  const draussen = tmp("brain-draussen-"); schreibe(draussen, "x.md", "x\n"); symlinkSync(join(draussen, "x.md"), join(d, "raus.md"));
  assert.equal(wirftSync(() => v.schreibe({ pfad: "raus.md", inhalt: "y", basisHash: HASH("x\n") })).status, 403);
  assert.equal(readFileSync(join(draussen, "x.md"), "utf8"), "x\n");
});
import { lstatSync } from "node:fs";
function require_lstat(p) { return lstatSync(p).isSymbolicLink(); }

test("Hardlink (mehrfach verknüpft): Schreiben wird mit 423 abgelehnt, beide Namen bleiben gleich; Anzeige schreibgeschützt", () => {
  const d = tmp();
  schreibe(d, "eins.md", "E\n"); linkSync(join(d, "eins.md"), join(d, "zwei.md"));
  const v = oeffneVault(d);
  assert.equal(v.lies("eins.md").schreibschutz, true);
  assert.ok(v.baum().eintraege.filter((e) => e.art === "datei").every((e) => e.schreibschutz === true));
  const e = wirftSync(() => v.schreibe({ pfad: "eins.md", inhalt: "neu\n", basisHash: HASH("E\n") }));
  assert.equal(e.status, 423); assert.match(e.message, /mehrfach verknüpft/);
  assert.equal(readFileSync(join(d, "eins.md"), "utf8"), "E\n"); assert.equal(readFileSync(join(d, "zwei.md"), "utf8"), "E\n");
  assert.equal(wirftSync(() => v.schreibe({ pfad: "zwei.md", inhalt: "neu\n", basisHash: HASH("E\n") })).status, 423);
  // normale Dateien bleiben schreibbar, auch neu angelegte
  v.schreibe({ pfad: "frisch.md", inhalt: "f\n", basisHash: null });
  assert.equal(v.lies("frisch.md").schreibschutz, false);
  v.schreibe({ pfad: "frisch.md", inhalt: "g\n", basisHash: HASH("f\n") });
});

// ---------- 4. Groß/klein und Unicode ----------
test("Sperren ohne Groß/klein und nach NFC: NODE_MODULES, .Git, .TOOLS, 09_WIKI/_INDEX.md, index.md ≙ INDEX.md", () => {
  const d = tmp();
  schreibe(d, "INDEX.md", "# Index\n"); schreibe(d, "09_wiki/_index.md", "# x\n"); schreibe(d, "09_wiki/_schema.md", "# Schema\n");
  mkdirSync(join(d, "node_modules"), { recursive: true });
  const v = oeffneVault(d);
  // dieselbe Datei unter anderer Schreibweise → Schreibschutz, Inhalt unverändert
  assert.equal(v.lies("index.md").schreibschutz, true);
  assert.equal(wirftSync(() => v.schreibe({ pfad: "index.md", inhalt: "weg\n", basisHash: HASH("# Index\n") })).status, 403);
  assert.equal(wirftSync(() => v.schreibe({ pfad: "Index.MD", inhalt: "weg\n", basisHash: null })).status, 403);
  assert.equal(readFileSync(join(d, "INDEX.md"), "utf8"), "# Index\n");
  for (const p of ["NODE_MODULES/a.md", "Node_Modules/a.md", ".Git/config.md", ".TOOLS/x.md", ".git/x.md"]) {
    assert.equal(wirftSync(() => v.schreibe({ pfad: p, inhalt: "x", basisHash: null })).status, 403, p);
    assert.equal(wirftSync(() => v.lies(p)).status, 403, p);
  }
  // generierte Wiki-Verzeichnisse in jeder Schreibweise; _schema.md bleibt bearbeitbar
  for (const p of ["09_WIKI/_INDEX.md", "09_Wiki/_Index.md", "09_wiki/_neu.md", "09_WIKI/_Thema.md"]) {
    assert.equal(wirftSync(() => v.schreibe({ pfad: p, inhalt: "x", basisHash: null })).status, 403, p);
  }
  assert.equal(v.lies("09_WIKI/_SCHEMA.md").schreibschutz, false);
  const b = v.baum().eintraege;
  assert.equal(b.find((e) => e.pfad === "INDEX.md").schreibschutz, true);
  assert.equal(b.find((e) => e.pfad === "09_wiki/_index.md").schreibschutz, true);
  assert.equal(b.some((e) => /node_modules/i.test(e.pfad)), false);
  assert.ok(!v.suche("Index").treffer.some((t) => /INDEX\.md$/i.test(t.pfad) || /_index\.md$/i.test(t.pfad)));
});

test("Groß/klein + Unicode: anderer Schreibweise-Name trifft vorhandene Datei (409 statt Doppelanlage)", () => {
  const d = tmp();
  schreibe(d, "Müll.md", "# nfc\n"); schreibe(d, "Notiz.md", "# n\n");
  const v = oeffneVault(d);
  const nfd = "Müll.md";
  assert.equal(wirftSync(() => v.schreibe({ pfad: nfd, inhalt: "x", basisHash: null })).status, 409);
  assert.equal(wirftSync(() => v.schreibe({ pfad: "notiz.md", inhalt: "x", basisHash: null })).status, 409);
  assert.equal(v.lies("NOTIZ.MD").pfad, "Notiz.md", "Antwort nennt die echte Schreibweise");
  v.schreibe({ pfad: "NOTIZ.md", inhalt: "# neu\n", basisHash: HASH("# n\n") });
  assert.equal(readFileSync(join(d, "Notiz.md"), "utf8"), "# neu\n");
});

// ---------- 5. Merge im Zeitlimit; Serialisierung ----------
function divergiert() {
  const bare = tmp("brain-bare-"); g(bare, "init", "-q", "--bare", "-b", "main");
  const a = repo(); g(a, "remote", "add", "origin", bare);
  schreibe(a, ".gitattributes", "*.md merge=langsam\n");
  g(a, "config", "merge.langsam.driver", "touch .git/index.lock; sleep 4");
  g(a, "add", "--", ".gitattributes"); g(a, "commit", "-q", "-m", "Attribute"); g(a, "push", "-q", "-u", "origin", "main");
  const b = tmp("brain-klon-"); g(b, "clone", "-q", bare, ".");
  g(b, "config", "user.name", "B"); g(b, "config", "user.email", "b@example.org");
  schreibe(b, "start.md", "# Start\nvon B\n"); g(b, "add", "--", "start.md"); g(b, "commit", "-q", "-m", "B"); g(b, "push", "-q");
  schreibe(a, "start.md", "# Start\nvon A\n"); g(a, "add", "--", "start.md"); g(a, "commit", "-q", "-m", "A");
  return a;
}
test("Sync: Zeitlimit beim Zusammenführen → 504, keine halbe Zusammenführung, keine liegengebliebene index.lock", async () => {
  const a = divergiert();
  const v = oeffneVault(a, { gitLimitSync: 1500 });
  v.vertrauen(true); // merge.langsam.driver in der lokalen Konfiguration sperrt Git, solange dem Vault nicht vertraut ist (§8)
  const e = await wirft(v.gitSync());
  assert.equal(e.status, 504); assert.match(e.message, /zu lange/);
  assert.equal(existsSync(join(a, ".git/index.lock")), false, "Sperrdatei entfernt");
  assert.equal(existsSync(join(a, ".git/MERGE_HEAD")), false);
  assert.equal(readFileSync(join(a, "start.md"), "utf8"), "# Start\nvon A\n");
  // danach geht Git wieder (Commit-Weg nicht blockiert)
  schreibe(a, "neu.md", "# neu\n");
  await oeffneVault(a).gitCommit({ nachricht: "geht wieder", dateien: ["neu.md"] });
});

test("Sync: fremde Sperrdatei (nicht von unserem Kind) bleibt, klarer Fehlertext", async () => {
  const a = divergiert();
  // Sperrdatei, die deutlich älter ist als unser Aufruf: darf nicht angefasst werden
  const lock = join(a, ".git/index.lock");
  g(a, "config", "merge.langsam.driver", "sleep 4");
  writeFileSync(lock, "");
  const alt = new Date(Date.now() - 3600_000); (await import("node:fs")).utimesSync(lock, alt, alt);
  const v = oeffneVault(a, { gitLimitSync: 1500 }); v.vertrauen(true); // sonst wäre Git wegen merge.*.driver gesperrt (§8)
  const e = await wirft(v.gitSync());
  assert.ok(e.status === 409 || e.status === 504, String(e.status));
  assert.equal(existsSync(lock), true, "fremde Sperre bleibt");
});

test("Sync/Commit: gleichzeitige Aufrufe werden serialisiert (409 „Abgleich läuft schon“)", async () => {
  const bare = tmp("brain-bare-"); g(bare, "init", "-q", "--bare", "-b", "main");
  const a = repo(); g(a, "remote", "add", "origin", bare); g(a, "push", "-q", "-u", "origin", "main");
  schreibe(a, "neu.md", "# neu\n"); g(a, "add", "--", "neu.md"); g(a, "commit", "-q", "-m", "lokal");
  schreibe(a, "offen.md", "# offen\n");
  const v = oeffneVault(a);
  const [s1, s2, c] = await Promise.allSettled([v.gitSync(), v.gitSync(), v.gitCommit({ nachricht: "x", dateien: ["offen.md"] })]);
  assert.equal(s1.status, "fulfilled"); assert.equal(s1.value.ergebnis, "gesendet");
  for (const r of [s2, c]) { assert.equal(r.status, "rejected"); assert.equal(r.reason.status, 409); assert.match(r.reason.message, /Abgleich läuft schon/); }
  await v.gitSync(); // Sperre ist wieder frei
});

// ---------- 7. Vertrauen, Kit als Kindprozess ----------
const STUDIO = () => { const s = tmp("brain-studio-"); schreibe(s, "index.html", "<!doctype html>"); return s; };
const aufruf = (h) => async (methode, p, daten, query) => {
  const r = await h({ methode, pfad: p, query: query ?? null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) });
  let j = null; try { j = JSON.parse(r.body.toString("utf8")); } catch { /* statisch */ }
  return { ...r, j };
};
const support = () => process.env.BRAIN_APP_SUPPORT;

test("Vertrauen: Kit läuft erst nach Erlaubnis; Merker mit realpath im Support-Ordner; Widerruf stoppt es wieder", async () => {
  const d = tmp();
  schreibe(d, ".tools/brain.mjs", `import {appendFileSync} from "node:fs"; appendFileSync(process.cwd()+"/gelaufen.log","x");\nconsole.log(JSON.stringify({version:1,ampel:"gruen",warnungen:0,pruefungen:[]}));\n`);
  const rufe = aufruf(erzeugeHandler({ vault: d, studioDir: STUDIO() }));
  let r = await rufe("GET", "/api/info");
  assert.deepEqual(r.j.kit, { vorhanden: true, vertraut: false });
  r = await rufe("GET", "/api/gesundheit");
  assert.equal(r.status, 200); assert.deepEqual(r.j, { verfuegbar: false, grund: "nicht-vertraut" });
  assert.equal(existsSync(join(d, "gelaufen.log")), false, "unvertraut: kein Kit-Code ausgeführt");

  r = await rufe("POST", "/api/kit/vertrauen", { erlauben: "ja" }); assert.equal(r.status, 400);
  r = await rufe("GET", "/api/kit/vertrauen"); assert.equal(r.status, 405);
  r = await rufe("POST", "/api/kit/vertrauen", { erlauben: true });
  assert.equal(r.status, 200); assert.deepEqual(r.j.kit, { vorhanden: true, vertraut: true });
  assert.equal(r.j.vertrauen.erlaubt, true); // Vertrauen v2: Antwort { kit, vertrauen }
  const merker = JSON.parse(readFileSync(join(support(), "vertrauen.json"), "utf8"));
  assert.match(merker[oeffneVault(d).wurzel].seit, /^\d{4}-\d\d-\d\dT/);
  assert.match(merker[oeffneVault(d).wurzel].ordner, /^\d+:\d+:[\d.]+$/); assert.match(merker[oeffneVault(d).wurzel].code, /^[0-9a-f]{64}$/);
  assert.equal((await rufe("GET", "/api/info")).j.kit.vertraut, true);
  assert.equal((await rufe("GET", "/api/gesundheit")).j.ampel, "gruen");
  assert.equal(readFileSync(join(d, "gelaufen.log"), "utf8"), "x");

  r = await rufe("POST", "/api/kit/vertrauen", { erlauben: false });
  assert.deepEqual(r.j.kit, { vorhanden: true, vertraut: false }); assert.equal(r.j.vertrauen.erlaubt, false);
  assert.equal(JSON.parse(readFileSync(join(support(), "vertrauen.json"), "utf8"))[oeffneVault(d).wurzel], undefined);
  assert.deepEqual((await rufe("GET", "/api/gesundheit")).j, { verfuegbar: false, grund: "nicht-vertraut" });
  assert.equal(readFileSync(join(d, "gelaufen.log"), "utf8"), "x", "nach Widerruf kein weiterer Lauf");
  // anderer Vault bleibt unvertraut
  const e = tmp(); schreibe(e, ".tools/rueckfragen.mjs", "export function sichtbare(){ return { fragen: [], wartend: 0 }; }\n");
  assert.deepEqual(oeffneVault(e).kit(), { vorhanden: true, vertraut: false });
  assert.deepEqual(oeffneVault(tmp()).kit(), { vorhanden: false, vertraut: false });
});

test("Rückfragen: unvertraut nicht ausgeführt; vertraut läuft als Kindprozess (kein import im eigenen Prozess), Kit-Absturz reißt uns nicht mit", async () => {
  const d = tmp();
  schreibe(d, ".tools/rueckfragen.mjs", `import {writeFileSync} from "node:fs"; export function sichtbare(v){ writeFileSync(v+"/pid.txt", String(process.pid)); return { fragen: [{}], wartend: 2 }; }\n`);
  const v = oeffneVault(d);
  assert.deepEqual(await v.rueckfragen(), { verfuegbar: false, grund: "nicht-vertraut" });
  assert.equal(existsSync(join(d, "pid.txt")), false);
  v.vertrauen(true);
  assert.deepEqual(await v.rueckfragen(), { verfuegbar: true, offen: 3 });
  assert.notEqual(readFileSync(join(d, "pid.txt"), "utf8"), String(process.pid), "lief in einem Kindprozess");
  const e = tmp(); schreibe(e, ".tools/rueckfragen.mjs", "process.exit(3);\n");
  const ve = oeffneVault(e); ve.vertrauen(true);
  assert.deepEqual(await ve.rueckfragen(), { verfuegbar: false });
  const k = tmp(); schreibe(k, ".tools/rueckfragen.mjs", "throw new Error('kaputt');\n");
  const vk = oeffneVault(k); vk.vertrauen(true);
  assert.deepEqual(await vk.rueckfragen(), { verfuegbar: false });
});

// ---------- 8. Umgebung ----------
test("Kindprozesse bekommen keine NODE_*/ELECTRON_*-Umgebung; Test-Schalter nur mit BRAIN_TESTMODUS=1", async () => {
  const d = tmp();
  schreibe(d, ".tools/brain.mjs", `console.log(JSON.stringify({version:1,ampel:[process.env.NODE_OPTIONS,process.env.NODE_PATH,process.env.ELECTRON_RUN_AS_NODE,process.env.DYLD_INSERT_LIBRARIES].map((x)=>x===undefined?"-":x).join("|"),warnungen:0,pruefungen:[]}));\n`);
  const v = oeffneVault(d); v.vertrauen(true);
  const alt = ["NODE_OPTIONS", "NODE_PATH", "ELECTRON_RUN_AS_NODE", "DYLD_INSERT_LIBRARIES"].map((k) => [k, process.env[k]]);
  Object.assign(process.env, { NODE_OPTIONS: "--max-old-space-size=100", NODE_PATH: "/tmp/nirgends", ELECTRON_RUN_AS_NODE: "1", DYLD_INSERT_LIBRARIES: "/tmp/x.dylib" });
  try { assert.equal((await v.gesundheit()).ampel, "-|-|-|-"); }
  finally { for (const [k, w] of alt) if (w === undefined) delete process.env[k]; else process.env[k] = w; }

  const { kindUmgebung } = await import(pfad("gemeinsam", "basis.mjs"));
  const e = kindUmgebung({ X: "1" });
  assert.equal(e.X, "1"); assert.equal(e.PATH, process.env.PATH);

  const bin = tmp("brain-bin-"); schreibe(bin, "claude", "#!/bin/sh\n"); chmodSync(join(bin, "claude"), 0o755);
  assert.notEqual(findeClaude({ PATH: "", BRAIN_CLAUDE_EXTRA: bin }), join(bin, "claude"), "ohne Testmodus ignoriert");
  assert.equal(findeClaude({ PATH: "", BRAIN_CLAUDE_EXTRA: bin, BRAIN_TESTMODUS: "1" }), join(bin, "claude"));
  assert.notEqual(findeClaude({ PATH: "", BRAIN_CLAUDE_EXTRA: bin, BRAIN_TESTMODUS: "0" }), join(bin, "claude"));
});

test("Git-Kindprozesse: wörtliche Pathspecs gesetzt, NODE_OPTIONS nicht durchgereicht (Hook sieht es)", async () => {
  const d = repo();
  hook(d, `#!/bin/sh\necho "$GIT_LITERAL_PATHSPECS|\${NODE_OPTIONS:--}" > "${d}/hookumgebung.txt"\nexit 0\n`);
  schreibe(d, "n.md", "# n\n");
  const vn = oeffneVault(d); vn.vertrauen(true); // Hooks laufen nur mit Vertrauen (§8)
  const alt = process.env.NODE_OPTIONS; process.env.NODE_OPTIONS = "--max-old-space-size=100";
  try { await vn.gitCommit({ nachricht: "n", dateien: ["n.md"] }); } finally { if (alt === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = alt; }
  assert.equal(readFileSync(join(d, "hookumgebung.txt"), "utf8").trim(), "1|-");
});

// ---------- 9. CSP ----------
test("CSP: base-uri, object-src, form-action, frame-ancestors gesperrt", async () => {
  const d = tmp();
  const r = await erzeugeHandler({ vault: d, studioDir: STUDIO() })({ methode: "GET", pfad: "/" });
  const csp = r.headers["Content-Security-Policy"];
  for (const t of ["default-src 'self'", "base-uri 'none'", "object-src 'none'", "form-action 'none'", "frame-ancestors 'none'"]) assert.ok(csp.includes(t), t);
});
