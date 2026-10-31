// test-abgleich-sicherung.mjs — das Sicherheitsnetz vor „Später“/„Lösen“ (abgleich-konflikt.mjs#ermittleSicherung) mit echten Git-Repos in Temp:
//  1. Ergebnis bitgleich zur früheren Einzelabfrage (ein Referenz-Nachbau mit einem Git-Aufruf je Pfad steht hier im Test), bis auf die Unbeteiligten;
//  2. Unbeteiligtes (nur im Arbeitsbaum geändert, von der Zusammenführung nicht betroffen) wird nicht kopiert;
//  3. Messtest: 2000 mitgebrachte Dateien — „Später“ dauert unter 10 s.
// Nie echte Nutzerorte: HOME und Support-Ordner liegen in Temp.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync, readdirSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const KERN = fileURLToPath(new URL("..", import.meta.url));
const FIXTURE = join(KERN, "tests", "fixture");
const HOME = mkdtempSync(join(tmpdir(), "abgleich-sicherung-home-"));
Object.assign(process.env, { HOME, GIT_CONFIG_NOSYSTEM: "1", BRAIN_GERAET_NAME: "Test-Mac" });
for (const k of ["GIT_CONFIG_GLOBAL", "XDG_CONFIG_HOME", "CLAUDE_CONFIG_DIR", "CODEX_HOME", "CURSOR_CONFIG_DIR", "GEMINI_CLI_HOME"]) delete process.env[k];
for (const k of Object.keys(process.env)) if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|AUTHOR|COMMITTER|CONFIG_(COUNT|KEY|VALUE|PARAMETERS))/.test(k)) delete process.env[k];
Object.assign(process.env, { GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.org", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.org" });

const B = await import("../backup.mjs");
const K = await import("../abgleich-konflikt.mjs");

const g = (cwd, ...a) => execFileSync("git", a, { cwd, env: process.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
const gIn = (cwd, eingabe, ...a) => execFileSync("git", a, { cwd, env: process.env, input: eingabe, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
const schreibe = (wurzel, rel, inhalt) => { const p = join(wurzel, rel); mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, inhalt); };
const lies = (wurzel, rel) => readFileSync(join(wurzel, rel), "utf8");
function speichern(wurzel, rel, inhalt, nachricht) { schreibe(wurzel, rel, inhalt); g(wurzel, "add", "--", rel); g(wurzel, "commit", "-q", "-m", nachricht); }
const leseMerker = (support) => { const d = join(support, "backup"); const n = readdirSync(d).find((x) => x.endsWith(".json") && !x.includes(".holen.")); return JSON.parse(readFileSync(join(d, n), "utf8")); };

function aufbau() {
  const basis = mkdtempSync(join(tmpdir(), "abgleich-sicherung-"));
  const remote = join(basis, "remote.git"), mac = join(basis, "mac"), handy = join(basis, "handy"), support = join(basis, "support");
  mkdirSync(support);
  g(basis, "init", "-q", "--bare", "-b", "main", remote);
  cpSync(FIXTURE, mac, { recursive: true });
  writeFileSync(join(mac, ".gitignore"), ".logs/\n");
  g(mac, "init", "-q", "-b", "main");
  schreibe(mac, "10_notizen/konflikt.md", "# Konflikt\n\neine Zeile\n");
  schreibe(mac, "10_notizen/gemeinsam.md", "# Gemeinsam\n\nAnfang\n\nMitte\n\nMitte 2\n\nMitte 3\n\nMitte 4\n\nEnde\n");
  schreibe(mac, "10_notizen/unbeteiligt.md", "# Unbeteiligt\n\nunberührt\n");
  schreibe(mac, "10_notizen/vorgemerkt-fremd.md", "# Vorgemerkt\n\nunberührt\n");
  schreibe(mac, "10_notizen/Übersicht für Zeit & Plan.md", "# Übersicht\n\nalt\n");
  schreibe(mac, "10_notizen/nur-handy-bearbeitet.md", "# Handy\n\nalt\n");
  g(mac, "add", "--", ".");
  g(mac, "commit", "-q", "-m", "Start");
  g(mac, "remote", "add", "origin", remote);
  g(mac, "push", "-q", "-u", "origin", "main");
  g(basis, "clone", "-q", remote, handy);
  assert.equal(B.bestaetigeRemote(mac, remote, { support }), true);
  return { basis, remote, mac, handy, support };
}
const oeffneMerge = (mac, support) => { assert.throws(() => g(mac, "merge", "--no-edit", "origin/main")); K.markiere(mac, { support, vorherAbwesend: true }); };

// ───────────── Referenz: die frühere Einzelabfrage (ein Git-Aufruf je Pfad), nachgebaut mit der Git-Befehlszeile ─────────────
function sicherungAlt(vault, konfliktPfade, hashes) {
  const roh = (...a) => { try { return g(vault, ...a); } catch { return null; } };
  const kopf = (roh("rev-parse", "--verify", "-q", "HEAD") || "").trim() || null;
  const merge = (roh("rev-parse", "-q", "--verify", "MERGE_HEAD") || "").trim() || null;
  const stamm = merge && kopf ? ((roh("merge-base", kopf, merge) || "").trim() || null) : null;
  const konflikt = new Set(konfliktPfade), namen = new Set(konfliktPfade);
  for (const a of [["diff", "--name-only", "--no-renames", "-z", "HEAD"], ["diff", "--cached", "--name-only", "--no-renames", "-z", "HEAD"]]) for (const p of (roh(...a) || "").split("\0")) if (p) namen.add(p);
  const bid = (sha, p) => (sha ? (roh("rev-parse", "-q", "--verify", `${sha}:${p}`) || "").trim() || null : null);
  const indexId = (p) => { let zwei = null; for (const z of (roh("ls-files", "-s", "-z", "--", p) || "").split("\0")) { const m = /^\d{6} ([0-9a-f]+) ([0-3])\t/.exec(z); if (!m) continue; if (m[2] === "0") return m[1]; if (m[2] === "2") zwei = m[1]; } return zwei; };
  const erwartet = (p) => {
    const h = bid(kopf, p), m = bid(merge, p), b = bid(stamm, p);
    if (h === m) return { id: h };
    if (h === b) return { id: m };
    if (m === b) return { id: h };
    if (!h || !m || !b) return null;
    const t = mkdtempSync(join(tmpdir(), "alt-")), teile = [];
    for (const [n, spec] of [["a", `${kopf}:${p}`], ["b", `${stamm}:${p}`], ["c", `${merge}:${p}`]]) { writeFileSync(join(t, n), execFileSync("git", ["-C", vault, "cat-file", "blob", spec], { maxBuffer: 1 << 26 })); teile.push(join(t, n)); }
    let out; try { out = execFileSync("git", ["-C", vault, "merge-file", "-p", ...teile], { maxBuffer: 1 << 26 }); } catch { return null; }
    writeFileSync(join(t, "d"), out);
    return { id: g(vault, "hash-object", "--no-filters", "--", join(t, "d")).trim() };
  };
  const arbeit = [], vorgemerkt = [];
  for (const p of namen) {
    const idx = konflikt.has(p) ? null : indexId(p);
    if (!konflikt.has(p) && idx) { const erw = erwartet(p); if (!erw || erw.id !== idx) vorgemerkt.push({ p, id: idx }); }
    let st = null; try { st = lstatSync(join(vault, ...p.split("/"))); } catch { /* fehlt */ }
    if (!st || st.isSymbolicLink() || !st.isFile()) continue;
    const jetzt = g(vault, "hash-object", "--no-filters", "--", p).trim();
    const st2 = indexId(p), st3 = (roh("ls-files", "-s", "-z", "--", p) || "").split("\0").map((z) => /^\d{6} ([0-9a-f]+) 3\t/.exec(z)).find(Boolean);
    const unberuehrt = konflikt.has(p) ? (Object.hasOwn(hashes, p) && jetzt === hashes[p]) || jetzt === st2 || (st3 && jetzt === st3[1]) : !!(jetzt && idx && jetzt === idx);
    if (!unberuehrt) arbeit.push({ p, groesse: st.size });
  }
  return { arbeit, vorgemerkt };
}
const konfliktPfade = (vault) => [...new Set(g(vault, "ls-files", "-u", "-z").split("\0").filter(Boolean).map((z) => z.split("\t")[1]))];

test("Sicherung: Ergebnis bitgleich zur früheren Einzelabfrage (außer Unbeteiligtes), Unbeteiligtes wird nicht kopiert", () => {
  const { mac, handy, support } = aufbau();
  // Handy ändert: eine Konfliktdatei, eine Datei im Nicht-Konflikt-Dreiwege-Fall (andere Stelle), zwei neue Dateien, eine Datei mit Sonderzeichen im Namen
  speichern(handy, "10_notizen/konflikt.md", "# Konflikt\n\neine Zeile vom Handy\n", "Handy: Konflikt");
  speichern(handy, "10_notizen/gemeinsam.md", "# Gemeinsam\n\nAnfang\n\nMitte\n\nMitte 2\n\nMitte 3\n\nMitte 4\n\nEnde vom Handy\n", "Handy: gemeinsam");
  speichern(handy, "10_notizen/Übersicht für Zeit & Plan.md", "# Übersicht\n\nneu vom Handy\n", "Handy: Übersicht");
  speichern(handy, "10_notizen/nur-handy-bearbeitet.md", "# Handy\n\nneu vom Handy\n", "Handy: nur Handy");
  speichern(handy, "10_notizen/handy-neu.md", "# Neu\n\nvom Handy\n", "Handy: neu");
  speichern(handy, "10_notizen/ordner mit Leerzeichen/tief.md", "# Tief\n\nvom Handy\n", "Handy: tief");
  g(handy, "push", "-q");
  speichern(mac, "10_notizen/konflikt.md", "# Konflikt\n\neine Zeile vom Mac\n", "Mac: Konflikt");
  speichern(mac, "10_notizen/gemeinsam.md", "# Gemeinsam\n\nAnfang vom Mac\n\nMitte\n\nMitte 2\n\nMitte 3\n\nMitte 4\n\nEnde\n", "Mac: gemeinsam");
  g(mac, "fetch", "-q", "origin");
  oeffneMerge(mac, support);
  assert.match(lies(mac, "10_notizen/konflikt.md"), /<<<<<<</);
  assert.match(lies(mac, "10_notizen/gemeinsam.md"), /Anfang vom Mac[\s\S]*Ende vom Handy/, "Dreiwege-Ergebnis ohne Konflikt");
  const marke = leseMerker(support).konfliktOffen;
  const tmp = join(mac, ".git", "brain-sicherung-tmp-test");
  const vergleich = (unbeteiligt = []) => {
    const pfade = konfliktPfade(mac);
    const neu = K.ermittleSicherung(mac, pfade, marke, tmp);
    const alt = sicherungAlt(mac, pfade, marke.hashes || {});
    const ohneUnbeteiligt = { arbeit: alt.arbeit.filter((e) => !unbeteiligt.includes(e.p)), vorgemerkt: alt.vorgemerkt.filter((e) => !unbeteiligt.includes(e.p)) };
    assert.deepEqual(neu, ohneUnbeteiligt);
    return { neu, alt };
  };
  // 1. Nichts angefasst: nichts zu sichern
  let v = vergleich();
  assert.deepEqual(v.neu, { arbeit: [], vorgemerkt: [] });
  // 2. gemischt: Konfliktdatei von Hand gelöst, mitgebrachte Dateien von Hand verändert, Dreiwege-Datei von Hand verändert, eine andere Datei anders vorgemerkt,
  //    dazu Unbeteiligtes (ungesichert) und Vorgemerktes ohne Bezug zur Zusammenführung
  schreibe(mac, "10_notizen/konflikt.md", "# Konflikt\n\nvon Hand gelöst\n");
  schreibe(mac, "10_notizen/Übersicht für Zeit & Plan.md", "# Übersicht\n\nvon Hand weitergeschrieben\n");
  schreibe(mac, "10_notizen/ordner mit Leerzeichen/tief.md", "# Tief\n\nvon Hand\n");
  schreibe(mac, "10_notizen/gemeinsam.md", lies(mac, "10_notizen/gemeinsam.md") + "\nvon Hand ergänzt\n");
  schreibe(mac, "10_notizen/nur-handy-bearbeitet.md", "# Handy\n\nanders vorgemerkt\n"); g(mac, "add", "--", "10_notizen/nur-handy-bearbeitet.md"); // Index ≠ erwartetes Ergebnis
  schreibe(mac, "10_notizen/unbeteiligt.md", "# Unbeteiligt\n\nnoch nicht gesichert\n");
  schreibe(mac, "10_notizen/vorgemerkt-fremd.md", "# Vorgemerkt\n\nfremd vorgemerkt\n"); g(mac, "add", "--", "10_notizen/vorgemerkt-fremd.md");
  schreibe(mac, "10_notizen/unversioniert.md", "# nicht in Git\n"); // nicht verfolgt: kommt in keiner Liste vor
  v = vergleich(["10_notizen/unbeteiligt.md"]);
  const arbeit = v.neu.arbeit.map((e) => e.p), vorg = v.neu.vorgemerkt.map((e) => e.p);
  assert.ok(v.alt.arbeit.some((e) => e.p === "10_notizen/unbeteiligt.md"), "früher wurde die unbeteiligte Notiz bei jedem Mal kopiert");
  assert.ok(!arbeit.includes("10_notizen/unbeteiligt.md"), "jetzt nicht mehr");
  for (const p of ["10_notizen/konflikt.md", "10_notizen/Übersicht für Zeit & Plan.md", "10_notizen/ordner mit Leerzeichen/tief.md", "10_notizen/gemeinsam.md"]) assert.ok(arbeit.includes(p), `${p} gesichert (Arbeitsdatei)`);
  assert.deepEqual(vorg.sort(), ["10_notizen/nur-handy-bearbeitet.md", "10_notizen/vorgemerkt-fremd.md"], "Vorgemerktes, das nicht zum Ergebnis der Zusammenführung gehört");
  assert.ok(!arbeit.includes("10_notizen/unversioniert.md"));
  assert.equal(arbeit[0], "10_notizen/konflikt.md", "Konfliktdateien zuerst");
  // 3. Später: vollständige Sicherung enthält genau das (Unbeteiligtes bleibt unangetastet im Arbeitsbaum)
  //    (Git nimmt die von Hand weiterbearbeitete, zusammengeführte Datei nicht zurück → 409 „geändert“ — MIT Sicherung; die Kopien liegen trotzdem da)
  let sicherung; try { sicherung = K.abbrechen(mac, { support }).sicherung; } catch (e) { assert.equal(e.status, 409); sicherung = e.extra.sicherung; }
  assert.ok(sicherung, "es wurde gesichert");
  assert.equal(readFileSync(join(sicherung.ordner, "10_notizen/konflikt.md"), "utf8"), "# Konflikt\n\nvon Hand gelöst\n");
  assert.equal(readFileSync(join(sicherung.ordner, "10_notizen/gemeinsam.md"), "utf8"), lies(mac, "10_notizen/gemeinsam.md"));
  assert.equal(existsSync(join(sicherung.ordner, "10_notizen/unbeteiligt.md")), false, "Unbeteiligtes nicht kopiert");
  assert.equal(lies(mac, "10_notizen/unbeteiligt.md"), "# Unbeteiligt\n\nnoch nicht gesichert\n", "und im Arbeitsbaum unverändert");
  assert.deepEqual(sicherung.vorgemerkt.sort(), ["10_notizen/nur-handy-bearbeitet.md", "10_notizen/vorgemerkt-fremd.md"]);
});

test("Messtest: 2000 mitgebrachte Dateien — Später dauert unter 10 s und kopiert nichts Unverändertes", () => {
  const { mac, handy, support } = aufbau();
  speichern(handy, "10_notizen/konflikt.md", "# Konflikt\n\neine Zeile vom Handy\n", "Handy: Konflikt");
  for (let i = 0; i < 2000; i++) schreibe(handy, `20_viele/gruppe-${i % 40}/notiz-${i}.md`, `# Notiz ${i}\n\nInhalt der Notiz ${i}.\n`);
  g(handy, "add", "--", "20_viele"); g(handy, "commit", "-q", "-m", "Handy: 2000 Notizen");
  g(handy, "push", "-q");
  speichern(mac, "10_notizen/konflikt.md", "# Konflikt\n\neine Zeile vom Mac\n", "Mac: Konflikt");
  g(mac, "fetch", "-q", "origin");
  oeffneMerge(mac, support);
  assert.equal(g(mac, "ls-files", "20_viele").split("\n").filter(Boolean).length, 2000);
  schreibe(mac, "10_notizen/konflikt.md", "# Konflikt\n\nvon Hand gelöst\n");
  const t0 = Date.now();
  const a = K.abbrechen(mac, { support });
  const dauer = Date.now() - t0;
  console.log(`Messwert: Später mit 2000 mitgebrachten Dateien: ${dauer} ms`);
  assert.ok(dauer < 10_000, `Später dauerte ${dauer} ms`);
  assert.deepEqual(a.sicherung.dateien, ["10_notizen/konflikt.md"], "nur die von Hand gelöste Konfliktdatei gesichert, keine der 2000 mitgebrachten");
  assert.equal(existsSync(join(mac, ".git", "MERGE_HEAD")), false);
});
