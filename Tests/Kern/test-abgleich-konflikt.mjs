// test-abgleich-konflikt.mjs — Konflikt beim Abgleich (abgleich-konflikt.mjs, abgleich-sperre.mjs): echte Git-Repos in Temp, ein Remote ohne Arbeitsbaum (bare), ein „Mac“ (der Vault)
// und ein „anderes Gerät“ (zweiter Klon). Geprüft: beide Fassungen je Datei (mit Gerätename und Zeit), Sonderfälle gelöscht↔geändert und Aufgaben-Karte, alle
// Entscheidungsarten (diese/andere/beide/zusammengeführt), jede Entscheidung als eigener Verlaufs-Eintrag, Abschluss mit Abgleich wie die Sicherung, Konfliktstand
// geräumt, Rückgängig, Abbrechen, die gemeinsame Sperre (auch zwischen zwei Prozessen). Nie echte Nutzerorte: HOME und Support-Ordner liegen in Temp.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync, rmSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn, spawnSync } from "node:child_process";

const KERN = fileURLToPath(new URL("..", import.meta.url));
const FIXTURE = join(KERN, "tests", "fixture");
const HOME = mkdtempSync(join(tmpdir(), "abgleich-konflikt-home-"));
Object.assign(process.env, { HOME, GIT_CONFIG_NOSYSTEM: "1", BRAIN_GERAET_NAME: "Test-Mac" });
for (const k of ["GIT_CONFIG_GLOBAL", "XDG_CONFIG_HOME", "CLAUDE_CONFIG_DIR", "CODEX_HOME", "CURSOR_CONFIG_DIR", "GEMINI_CLI_HOME"]) delete process.env[k];
for (const k of Object.keys(process.env)) if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|AUTHOR|COMMITTER|CONFIG_(COUNT|KEY|VALUE|PARAMETERS))/.test(k)) delete process.env[k];
Object.assign(process.env, { GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.org", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.org" });

const B = await import("../backup.mjs");
const K = await import("../abgleich-konflikt.mjs");
const S = await import("../abgleich-sperre.mjs");

const g = (cwd, ...a) => execFileSync("git", a, { cwd, env: process.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const gAls = (cwd, email, ...a) => execFileSync("git", a, { cwd, env: { ...process.env, GIT_COMMITTER_EMAIL: email, GIT_AUTHOR_EMAIL: email }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const schreibe = (wurzel, rel, inhalt) => { const p = join(wurzel, rel); mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, inhalt); };
const lies = (wurzel, rel) => readFileSync(join(wurzel, rel), "utf8");
const kopf = (wurzel) => g(wurzel, "rev-parse", "HEAD").trim();
const kopfRemote = (remote) => g(remote, "rev-parse", "refs/heads/main").trim();
function speichern(wurzel, rel, inhalt, nachricht, als = null) { schreibe(wurzel, rel, inhalt); g(wurzel, "add", "--", rel); (als ? (...a) => gAls(wurzel, als, ...a) : (...a) => g(wurzel, ...a))("commit", "-q", "-m", nachricht); }
const karte = (status, faellig = "") => `---\ntyp: aufgabe\ntitel: "Budget abgleichen"\nstatus: ${status}\nprioritaet: normal\n${faellig ? `faellig: ${faellig}\n` : ""}rang: 1000\nerstellt: 2026-10-20T08:00:00Z\n---\n\nBudget mit Finanzen abgleichen.\n`;

// Remote + Mac + anderes Gerät. Ausgangsstand: fünf Notizen und eine Aufgaben-Karte.
function aufbau() {
  const basis = mkdtempSync(join(tmpdir(), "abgleich-konflikt-"));
  const remote = join(basis, "remote.git"), mac = join(basis, "mac"), handy = join(basis, "handy"), support = join(basis, "support");
  mkdirSync(support);
  g(basis, "init", "-q", "--bare", "-b", "main", remote);
  cpSync(FIXTURE, mac, { recursive: true });
  writeFileSync(join(mac, ".gitignore"), ".logs/\n");
  g(mac, "init", "-q", "-b", "main");
  schreibe(mac, "10_notizen/kickoff.md", "# Kickoff Atlas\n\nZiel: Karten-App bis Q1.\nRollen offen.\nSchluss.\n");
  schreibe(mac, "10_notizen/zeitplan.md", "# Zeitplan\n\n- 28. Nov: Abnahme\n- 12. Dez: Test\n");
  schreibe(mac, "10_notizen/ideen.md", "# Ideen\n\n- Offline-Modus\n- Geteilte Listen\n");
  schreibe(mac, "10_notizen/schlicht.md", "# Schlicht\n\neine Zeile\n");
  schreibe(mac, "05_aufgaben/budget.md", karte("offen"));
  g(mac, "add", "--", ".");
  g(mac, "commit", "-q", "-m", "Start");
  g(mac, "remote", "add", "origin", remote);
  g(mac, "push", "-q", "-u", "origin", "main");
  g(basis, "clone", "-q", remote, handy);
  assert.equal(B.bestaetigeRemote(mac, remote, { support }), true);
  return { basis, remote, mac, handy, support };
}
const HANDY_MAIL = "nutzer@Fabios-iPhone.local";
// Beide Seiten ändern dieselben Stellen; danach läuft der Abgleich des Studios: holen und zusammenführen, die Zusammenführung bleibt offen
function konfliktAufbau() {
  const a = aufbau();
  const { mac, handy } = a;
  speichern(handy, "10_notizen/kickoff.md", "# Kickoff Atlas\n\nZiel: Karten-App bis Q1, auch offline.\nRollen: Lea und Jonas.\nSchluss.\n", "Handy: Kickoff", HANDY_MAIL);
  speichern(handy, "10_notizen/zeitplan.md", "# Zeitplan\n\n- 5. Dez: Abnahme\n- 12. Dez: Test\n", "Handy: Zeitplan", HANDY_MAIL);
  g(handy, "rm", "-q", "--", "10_notizen/ideen.md"); gAls(handy, HANDY_MAIL, "commit", "-q", "-m", "Handy: Ideen gelöscht");
  speichern(handy, "10_notizen/schlicht.md", "# Schlicht\n\neine Zeile vom Handy\n", "Handy: schlicht", HANDY_MAIL);
  speichern(handy, "05_aufgaben/budget.md", karte("warten", "2026-11-21"), "Handy: Karte", HANDY_MAIL);
  g(handy, "push", "-q");
  speichern(mac, "10_notizen/kickoff.md", "# Kickoff Atlas\n\nZiel: Karten-App bis Q1, Rahmen gibt der Zeitplan.\nRollen offen.\nSchluss.\n", "Mac: Kickoff");
  speichern(mac, "10_notizen/zeitplan.md", "# Zeitplan\n\n- 28. Nov: Abnahme\n- 12. Dez: Erster Test\n", "Mac: Zeitplan");
  speichern(mac, "10_notizen/ideen.md", "# Ideen\n\n- Offline-Modus\n- Geteilte Listen\n- Widget\n", "Mac: Ideen ergänzt");
  speichern(mac, "10_notizen/schlicht.md", "# Schlicht\n\neine Zeile vom Mac\n", "Mac: schlicht");
  speichern(mac, "05_aufgaben/budget.md", karte("in-arbeit", "2026-11-14"), "Mac: Karte");
  g(mac, "fetch", "-q", "origin");
  oeffneMerge(mac, a.support);
  assert.ok(existsSync(join(mac, ".git", "MERGE_HEAD")));
  return a;
}
const alleWahl = (w) => ({ "10_notizen/kickoff.md": w, "10_notizen/zeitplan.md": w, "10_notizen/ideen.md": w, "10_notizen/schlicht.md": w, "05_aufgaben/budget.md": w });
const auswahlVon = (m) => Object.entries(m).map(([pfad, wahl]) => (typeof wahl === "string" ? { pfad, wahl } : { pfad, ...wahl }));
// Studio-Ablauf: die Zusammenführung bleibt offen (git.mjs#sync) und wird als „von Kortex begonnen“ markiert
function oeffneMerge(mac, support) { assert.throws(() => g(mac, "merge", "--no-edit", "origin/main")); K.markiere(mac, { support, vorherAbwesend: true }); }
const gesehenVon = (wurzel, support) => { const a = K.ansicht(wurzel, { support }); return { meine: a.meine, andere: a.andere }; };
const loes = (wurzel, o) => K.loesen(wurzel, { gesehen: gesehenVon(wurzel, o.support), ...o });
const betreffs = (wurzel, n = 20) => g(wurzel, "log", `-${n}`, "--format=%s").trim().split("\n");

// ───────────────────────────── Ansicht ─────────────────────────────
test("Ansicht: beide Fassungen je Datei mit Zeit und Gerätename, Sonderfälle gelöscht↔geändert und Karte", () => {
  const { mac, support } = konfliktAufbau();
  const a = K.ansicht(mac, { support });
  assert.equal(a.aktiv, true);
  assert.equal(a.modus, "offen");
  assert.equal(a.eigen, "Test-Mac");
  assert.equal(a.geraet, "Fabios iPhone", "Gerätename aus der Standard-Adresse des anderen Geräts");
  assert.ok(a.seit, "Zeit des letzten gemeinsamen Stands");
  const von = new Map(a.dateien.map((d) => [d.pfad, d]));
  assert.deepEqual([...von.keys()].sort(), ["05_aufgaben/budget.md", "10_notizen/ideen.md", "10_notizen/kickoff.md", "10_notizen/schlicht.md", "10_notizen/zeitplan.md"]);
  const k = von.get("10_notizen/kickoff.md");
  assert.equal(k.typ, "text");
  assert.equal(k.art, "beide");
  assert.equal(k.titel, "Kickoff Atlas");
  assert.match(k.meine.text, /Rahmen gibt der Zeitplan/);
  assert.match(k.andere.text, /Lea und Jonas/);
  assert.ok(k.meine.zeit && k.andere.zeit);
  assert.equal(k.andere.geraet, "Fabios iPhone");
  assert.equal(k.meine.geraet, null, "eigene Seite: Gerät nicht ermittelbar → Oberfläche sagt „Dieser Mac“");
  // gelöscht ↔ geändert: das andere Gerät hat gelöscht, hier wurde weitergearbeitet
  const i = von.get("10_notizen/ideen.md");
  assert.equal(i.typ, "geloescht");
  assert.equal(i.wer, "andere");
  assert.equal(i.art, "andere-geloescht");
  assert.equal(i.andere.vorhanden, false);
  assert.equal(i.andere.text, null);
  assert.ok(i.andere.zeit, "Zeit der Löschung");
  assert.match(i.meine.text, /Widget/);
  assert.deepEqual(i.neueZeilen, ["- Widget"], "seit dem gemeinsamen Stand dazugekommen");
  // Aufgaben-Karte: dieselbe Karte in zwei Spalten
  const c = von.get("05_aufgaben/budget.md");
  assert.equal(c.typ, "board");
  assert.deepEqual(c.karte, { meine: { spalte: "in-arbeit", faellig: "2026-11-14" }, andere: { spalte: "warten", faellig: "2026-11-21" }, vorher: "offen" });
  assert.equal(c.titel, "Budget abgleichen");
});

test("Ansicht ohne Konflikt: aktiv false", () => {
  const { mac, support } = aufbau();
  assert.deepEqual(K.ansicht(mac, { support }), { aktiv: false, dateien: [] });
});

test("Gerätename: Marke „Kortex-Geraet“ im Commit gewinnt, sonst die Standard-Adresse, sonst unbekannt", () => {
  assert.equal(K.geraetAusCommit({ nachricht: "x\n\nKortex-Geraet: Lea's iPad\n", email: "a@b.de" }), "Lea's iPad");
  assert.equal(K.geraetAusCommit({ nachricht: "x", email: "nutzer@Mac-mini-von-Jo.local" }), "Mac mini von Jo");
  assert.equal(K.geraetAusCommit({ nachricht: "x", email: "t@example.org" }), null);
  assert.doesNotMatch(K.geraetAusCommit({ nachricht: "Kortex-Geraet: ../../etc/passwd", email: "" }) || "", /\//);
});

// ───────────────────────────── Entscheidungen ─────────────────────────────
test("alle Entscheidungsarten: Ergebnis stimmt, jede Entscheidung ist ein Eintrag im Verlauf, gesendet, Konfliktstand geräumt", () => {
  const { remote, mac, handy, support } = konfliktAufbau();
  B.leseAbgleichStand(mac, { support });
  const r = loes(mac, { support, auswahl: auswahlVon({
    "10_notizen/kickoff.md": "beide",
    "10_notizen/zeitplan.md": { wahl: "text", text: "# Zeitplan\n\n- 5. Dez: Abnahme\n- 12. Dez: Erster Test\n" },
    "10_notizen/ideen.md": "meine",
    "10_notizen/schlicht.md": "andere",
    "05_aufgaben/budget.md": "andere",
  }) });
  assert.equal(r.ok, true);
  assert.equal(r.abgleich.art, "gesendet", r.abgleich.text);
  assert.equal(r.eintraege.length, 5);
  assert.equal(existsSync(join(mac, ".git", "MERGE_HEAD")), false, "Zusammenführung abgeschlossen");
  assert.equal(g(mac, "status", "--porcelain").trim(), "", "keine Konfliktmarken, nichts offen");
  // diese behalten (gelöscht↔geändert): Notiz bleibt mit allen Änderungen
  assert.match(lies(mac, "10_notizen/ideen.md"), /Widget/);
  // andere Fassung
  assert.equal(lies(mac, "10_notizen/schlicht.md"), "# Schlicht\n\neine Zeile vom Handy\n");
  assert.match(lies(mac, "05_aufgaben/budget.md"), /status: warten/);
  // zusammengeführter Text
  assert.equal(lies(mac, "10_notizen/zeitplan.md"), "# Zeitplan\n\n- 5. Dez: Abnahme\n- 12. Dez: Erster Test\n");
  // beide: meine bleibt, die andere liegt als Kopie mit sprechendem Namen daneben
  assert.match(lies(mac, "10_notizen/kickoff.md"), /Rahmen gibt der Zeitplan/);
  assert.deepEqual(r.kopien, [{ pfad: "10_notizen/kickoff (Fabios iPhone).md", von: "10_notizen/kickoff.md" }]);
  assert.match(lies(mac, "10_notizen/kickoff (Fabios iPhone).md"), /Lea und Jonas/);
  // Verlauf: die Zusammenführung und je Entscheidung ein Eintrag, in Alltagssprache (keine git-Wörter)
  const verlauf = betreffs(mac, 6);
  assert.equal(verlauf.filter((s) => s.startsWith("Konflikt gelöst: ")).length, 5);
  assert.ok(verlauf.some((s) => /^Abgleich mit dem anderen Gerät: 5 Konflikte gelöst$/.test(s)));
  assert.ok(verlauf.some((s) => /„Zeitplan“ – selbst zusammengeführt/.test(s)));
  assert.ok(verlauf.some((s) => /„Kickoff Atlas“ – beide behalten, Kopie „kickoff \(Fabios iPhone\)“/.test(s)));
  assert.ok(verlauf.some((s) => /„Ideen“ – Notiz bleibt/.test(s)));
  for (const s of verlauf) assert.doesNotMatch(s, /merge|ours|theirs|HEAD|rebase|commit/i, s);
  assert.match(g(mac, "log", "--merges", "-1", "--format=%B"), /Kortex-Geraet: Test-Mac/);
  // Server und Konfliktstand
  assert.equal(kopfRemote(remote), kopf(mac));
  assert.equal(B.leseAbgleichStand(mac, { support }), null);
  assert.deepEqual(readdirSync(join(support, "backup")).filter((n) => n.endsWith(".sperre")), [], "Sperre wieder frei");
  // das andere Gerät bekommt alles per einfachem Holen
  g(handy, "pull", "-q", "--ff-only");
  assert.equal(lies(handy, "10_notizen/schlicht.md"), "# Schlicht\n\neine Zeile vom Handy\n");
  assert.ok(existsSync(join(handy, "10_notizen/kickoff (Fabios iPhone).md")));
});

test("gelöscht↔geändert: „Löschung übernehmen“ entfernt die Notiz überall; „andere“ bei einer fehlenden Seite ebenso", () => {
  const { remote, mac, handy, support } = konfliktAufbau();
  const r = loes(mac, { support, auswahl: auswahlVon({ ...alleWahl("meine"), "10_notizen/ideen.md": "andere" }) });
  assert.equal(r.ok, true);
  assert.equal(existsSync(join(mac, "10_notizen/ideen.md")), false);
  assert.equal(g(mac, "ls-files", "--", "10_notizen/ideen.md").trim(), "");
  assert.match(betreffs(mac, 6).join("\n"), /„Ideen“ – Löschung übernommen/);
  assert.equal(kopfRemote(remote), kopf(mac));
  g(handy, "pull", "-q", "--ff-only");
  assert.equal(existsSync(join(handy, "10_notizen/ideen.md")), false);
});

test("hier gelöscht, dort geändert: „beide“ behält die vorhandene Fassung (das Löschen behalten und „andere“ prüfen die Tests mit K1)", () => {
  const a = aufbau();
  const { mac, handy, support } = a;
  speichern(handy, "10_notizen/ideen.md", "# Ideen\n\n- Offline-Modus\n- Neu vom Handy\n", "Handy: Ideen", HANDY_MAIL); g(handy, "push", "-q");
  g(mac, "rm", "-q", "--", "10_notizen/ideen.md"); g(mac, "commit", "-q", "-m", "Mac: Ideen gelöscht");
  g(mac, "fetch", "-q", "origin");
  oeffneMerge(mac, support);
  const d = K.ansicht(mac, { support }).dateien[0];
  assert.equal(d.typ, "geloescht"); assert.equal(d.wer, "meine"); assert.equal(d.meine.vorhanden, false); assert.match(d.andere.text, /Neu vom Handy/);
  const r = loes(mac, { support, auswahl: auswahlVon({ "10_notizen/ideen.md": "beide" }) });
  assert.equal(r.ok, true);
  assert.deepEqual(r.kopien, []);
  assert.match(lies(mac, "10_notizen/ideen.md"), /Neu vom Handy/, "die vorhandene Fassung bleibt");
});

test("Eingaben werden geprüft: unvollständige Auswahl, unbekannter Pfad, Karte mit „beide“, Text fehlt — nichts wird verändert", () => {
  const { mac, support } = konfliktAufbau();
  const vorher = kopf(mac);
  const fehler = (auswahl) => { try { loes(mac, { support, auswahl }); } catch (e) { return e; } return null; };
  assert.equal(fehler([{ pfad: "10_notizen/kickoff.md", wahl: "meine" }]).status, 400);
  assert.equal(fehler(auswahlVon({ ...alleWahl("meine"), "../draussen.md": "meine" })).status, 400);
  assert.equal(fehler(auswahlVon({ ...alleWahl("meine"), "05_aufgaben/budget.md": "beide" })).status, 400);
  assert.equal(fehler(auswahlVon({ ...alleWahl("meine"), "10_notizen/kickoff.md": "text" })).status, 400);
  assert.equal(fehler(auswahlVon({ ...alleWahl("meine"), "10_notizen/ideen.md": "text" })).status, 400);
  assert.equal(fehler("nein").status, 400);
  assert.equal(kopf(mac), vorher);
  assert.ok(existsSync(join(mac, ".git", "MERGE_HEAD")), "die Zusammenführung ist noch offen");
});

test("kein Konflikt offen: loesen und abbrechen sind harmlos bzw. 409", () => {
  const { mac, support } = aufbau();
  assert.throws(() => loes(mac, { support, auswahl: [] }), (e) => e.status === 409);
  assert.deepEqual(K.abbrechen(mac, { support }), { ok: true, offen: false });
});

test("ohne bestätigtes Ziel: gelöst und festgehalten, aber nichts gesendet", () => {
  const { remote, mac, support } = konfliktAufbau();
  B.bestaetigeRemote(mac, "https://example.invalid/x.git", { support });
  const serverKopf = kopfRemote(remote);
  const r = loes(mac, { support, auswahl: auswahlVon(alleWahl("meine")) });
  assert.equal(r.ok, true);
  assert.equal(r.abgleich.art, "nicht-bestaetigt");
  assert.equal(kopfRemote(remote), serverKopf, "nichts gesendet");
  assert.equal(existsSync(join(mac, ".git", "MERGE_HEAD")), false);
});

test("Verborgene Orte bleiben bei der eigenen Fassung, beide Seiten gelöscht bleibt gelöscht (kein Eintrag nötig)", () => {
  const a = aufbau();
  const { mac, handy, support } = a;
  speichern(handy, ".obsidian/app.json", "{\"a\":1}\n", "Handy: versteckt", HANDY_MAIL); g(handy, "push", "-q");
  // base muss die Datei haben: erst gemeinsam, dann beide ändern
  g(mac, "pull", "-q", "--ff-only");
  speichern(handy, ".obsidian/app.json", "{\"a\":2}\n", "Handy: versteckt 2", HANDY_MAIL);
  speichern(handy, "10_notizen/schlicht.md", "# Schlicht\n\nHandy\n", "Handy: schlicht", HANDY_MAIL); g(handy, "push", "-q");
  speichern(mac, ".obsidian/app.json", "{\"a\":3}\n", "Mac: versteckt");
  speichern(mac, "10_notizen/schlicht.md", "# Schlicht\n\nMac\n", "Mac: schlicht");
  g(mac, "fetch", "-q", "origin");
  oeffneMerge(mac, support);
  const an = K.ansicht(mac, { support });
  assert.deepEqual(an.dateien.map((d) => d.pfad), ["10_notizen/schlicht.md"]);
  assert.equal(an.versteckt, 1);
  const r = loes(mac, { support, auswahl: auswahlVon({ "10_notizen/schlicht.md": "andere" }) });
  assert.deepEqual(r.versteckteBehalten, [".obsidian/app.json"]);
  assert.equal(lies(mac, ".obsidian/app.json"), "{\"a\":3}\n");
});

// ───────────────────────────── Rückgängig ─────────────────────────────
test("Rückgängig: die Fassungen von vor den Entscheidungen kommen als neuer Eintrag zurück; danach lässt sich neu entscheiden", () => {
  const { remote, mac, support } = konfliktAufbau();
  const r1 = loes(mac, { support, auswahl: auswahlVon({ ...alleWahl("andere"), "10_notizen/kickoff.md": "beide" }) });
  assert.equal(r1.ok, true);
  assert.equal(K.rueckgaengigStand(mac, { support }).moeglich, true);
  const vorRueck = kopf(mac);
  const u = K.rueckgaengig(mac, { support });
  assert.equal(u.ok, true);
  assert.notEqual(kopf(mac), vorRueck, "ein NEUER Eintrag, kein Zurücksetzen");
  assert.equal(g(mac, "merge-base", "--is-ancestor", vorRueck, "HEAD").length, 0);
  assert.match(g(mac, "log", "-1", "--format=%s").trim(), /^Abgleich zurückgenommen: 5 Entscheidungen rückgängig gemacht$/);
  assert.equal(lies(mac, "10_notizen/schlicht.md"), "# Schlicht\n\neine Zeile vom Mac\n", "meine Fassung ist wieder da");
  assert.match(lies(mac, "10_notizen/ideen.md"), /Widget/, "die gelöschte Notiz ist wieder da");
  assert.equal(existsSync(join(mac, "10_notizen/kickoff (Fabios iPhone).md")), false, "die Kopie ist weg");
  assert.equal(K.rueckgaengigStand(mac, { support }).moeglich, false, "nur einmal");
  assert.equal(B.leseAbgleichStand(mac, { support }).stand, "konflikt");
  assert.deepEqual(B.leseAbgleichStand(mac, { support }).dateien.length, 5);
  assert.equal(g(mac, "status", "--porcelain").trim(), "");
  // neu entscheiden: die Ansicht kommt aus dem gemerkten Stand (beide Seiten sind schon zusammengeführt) — nie aus einer Angabe der Oberfläche
  const an = K.ansicht(mac, { support });
  assert.equal(u.basis, undefined);
  assert.equal(an.modus, "stand");
  assert.equal(an.dateien.length, 5);
  assert.match(an.dateien.find((d) => d.pfad === "10_notizen/kickoff.md").andere.text, /Lea und Jonas/);
  const r2 = loes(mac, { support, auswahl: auswahlVon({ ...alleWahl("meine"), "10_notizen/schlicht.md": "andere" }) });
  assert.equal(r2.ok, true);
  assert.equal(lies(mac, "10_notizen/schlicht.md"), "# Schlicht\n\neine Zeile vom Handy\n");
  assert.equal(r2.abgleich.ok, true, r2.abgleich.text);
  assert.equal(kopfRemote(remote), kopf(mac));
  assert.equal(B.leseAbgleichStand(mac, { support }), null, "Konfliktstand geräumt");
});

test("Rückgängig weigert sich, wenn an einer Datei seitdem weitergearbeitet wurde (nichts Fremdes überschreiben)", () => {
  const { mac, support } = konfliktAufbau();
  loes(mac, { support, auswahl: auswahlVon(alleWahl("andere")) });
  speichern(mac, "10_notizen/schlicht.md", "# Schlicht\n\nweitergearbeitet\n", "Mac: weiter");
  assert.throws(() => K.rueckgaengig(mac, { support }), (e) => e.status === 409 && /noch einmal geändert/.test(e.message));
  assert.equal(lies(mac, "10_notizen/schlicht.md"), "# Schlicht\n\nweitergearbeitet\n");
  // ungesicherte Änderung: ebenso
  const a2 = konfliktAufbau();
  loes(a2.mac, { support: a2.support, auswahl: auswahlVon(alleWahl("andere")) });
  schreibe(a2.mac, "10_notizen/schlicht.md", "# Schlicht\n\nnoch nicht gesichert\n");
  assert.throws(() => K.rueckgaengig(a2.mac, { support: a2.support }), (e) => e.status === 409);
});

test("Rückgängig ohne vorherigen Abgleich: 409", () => {
  const { mac, support } = aufbau();
  assert.throws(() => K.rueckgaengig(mac, { support }), (e) => e.status === 409 && e.extra.art === "nichts");
});

// ───────────────────────────── Abbrechen ─────────────────────────────
test("Abbrechen („Später“): Zusammenführung zurückgenommen, Arbeitsstand wie vorher, der Konflikt bleibt vermerkt", () => {
  const { mac, support } = konfliktAufbau();
  const r = K.abbrechen(mac, { support });
  assert.equal(r.ok, true); assert.equal(r.offen, true);
  assert.equal(existsSync(join(mac, ".git", "MERGE_HEAD")), false);
  assert.equal(lies(mac, "10_notizen/schlicht.md"), "# Schlicht\n\neine Zeile vom Mac\n");
  assert.equal(g(mac, "status", "--porcelain").trim(), "");
  const stand = B.leseAbgleichStand(mac, { support });
  assert.equal(stand.stand, "konflikt");
  assert.equal(stand.dateien.length, 5);
});

// ───────────────────────────── Konfliktstand der Sicherung ─────────────────────────────
test("Die Hintergrund-Sicherung vermerkt die Notizen im Konflikt (ohne versteckte Orte) und räumt sie nach einem erfolgreichen Abgleich", () => {
  const { remote, mac, handy, support } = aufbau();
  speichern(handy, "10_notizen/schlicht.md", "# Schlicht\n\nHandy\n", "Handy", HANDY_MAIL); g(handy, "push", "-q");
  speichern(mac, "10_notizen/schlicht.md", "# Schlicht\n\nMac\n", "Mac");
  const r = B.abgleichen(mac, { support });
  assert.equal(r.art, "konflikt");
  const s = B.leseAbgleichStand(mac, { support });
  assert.deepEqual(s.dateien, ["10_notizen/schlicht.md"]);
  assert.ok(s.zeit);
  // nach dem Lösen im Studio (Zusammenführung offen lassen, entscheiden) ist der Stand weg
  g(mac, "fetch", "-q", "origin");
  oeffneMerge(mac, support);
  const l = loes(mac, { support, auswahl: auswahlVon({ "10_notizen/schlicht.md": "meine" }) });
  assert.equal(l.abgleich.ok, true, l.abgleich.text);
  assert.equal(B.leseAbgleichStand(mac, { support }), null);
  assert.equal(kopfRemote(remote), kopf(mac));
});

// ───────────────────────────── Sperre ─────────────────────────────
const sperrDatei = (support, name = "x") => join(support, "backup", `${name}.sperre`);
test("Sperre: genommen = besetzt, freigegeben = frei; eine fremde Sperre gibt man nicht frei", () => {
  const support = mkdtempSync(join(tmpdir(), "sperre-"));
  const d = sperrDatei(support);
  const a = S.nimmSperre(d, { art: "sicherung" });
  assert.equal(a.ok, true);
  assert.equal(S.sperreStand(d).besetzt, true);
  assert.equal(S.sperreStand(d).art, "sicherung");
  const b = S.nimmSperre(d, { art: "studio" });
  assert.equal(b.ok, false);
  assert.equal(b.von.pid, process.pid);
  b.freigeben?.();
  assert.equal(existsSync(d), true, "der Unterlegene hat sie nicht gelöscht");
  a.freigeben();
  assert.equal(existsSync(d), false);
  assert.equal(S.sperreStand(d).besetzt, false);
  assert.equal(S.nimmSperre(d).ok, true);
});

test("Sperre: verwaist (Prozess tot, zu alt, unlesbar und alt) wird weggeräumt, eine frische unlesbare nicht", () => {
  const support = mkdtempSync(join(tmpdir(), "sperre-"));
  const d = sperrDatei(support); mkdirSync(join(support, "backup"));
  const totePid = (() => { const k = spawn(process.execPath, ["-e", "0"]); const p = k.pid; return new Promise((ok) => k.on("exit", () => ok(p))); })();
  return totePid.then((pid) => {
    writeFileSync(d, JSON.stringify({ pid, zeit: Date.now(), art: "sicherung", marke: "a" }));
    assert.equal(S.sperreStand(d).besetzt, false, "Prozess lebt nicht mehr");
    assert.equal(S.nimmSperre(d).ok, true);
    rmSync(d);
    writeFileSync(d, JSON.stringify({ pid: process.pid, zeit: Date.now() - S.MAX_ALTER_MS - 1000, art: "x", marke: "b" }));
    assert.equal(S.sperreStand(d).besetzt, false, "zu alt");
    assert.equal(S.nimmSperre(d).ok, true);
    rmSync(d);
    writeFileSync(d, "{kaputt");
    assert.equal(S.nimmSperre(d).ok, false, "frisch und unlesbar: ein anderer schreibt sie vielleicht gerade");
    assert.equal(S.nimmSperre(d, { jetzt: Date.now() + 60_000 }).ok, true, "alt und unlesbar: weg damit");
  });
});

test("Sperre, Gleichzeitigkeit: acht Prozesse nehmen sie je 15-mal — nie zwei zugleich", async () => {
  const support = mkdtempSync(join(tmpdir(), "sperre-"));
  const d = sperrDatei(support);
  const protokoll = join(support, "protokoll.txt");
  const skript = `
    import { nimmSperre } from ${JSON.stringify(new URL("../abgleich-sperre.mjs", import.meta.url).href)};
    import { appendFileSync } from "node:fs";
    const [d, p, n] = process.argv.slice(1);
    let drin = 0;
    for (let i = 0; i < Number(n); ) {
      const s = nimmSperre(d, { art: "test" });
      if (!s.ok) { await new Promise((r) => setTimeout(r, 2 + Math.random() * 6)); continue; }
      appendFileSync(p, "+" + process.pid + "\\n");
      await new Promise((r) => setTimeout(r, 3));
      appendFileSync(p, "-" + process.pid + "\\n");
      s.freigeben(); drin++; i++;
    }
  `;
  const lauf = () => new Promise((ok, nein) => { const k = spawn(process.execPath, ["--input-type=module", "-e", skript, d, protokoll, "15"], { stdio: "inherit" }); k.on("exit", (c) => (c === 0 ? ok() : nein(new Error("Kind " + c)))); });
  await Promise.all(Array.from({ length: 8 }, lauf));
  const zeilen = readFileSync(protokoll, "utf8").trim().split("\n");
  assert.equal(zeilen.length, 8 * 15 * 2);
  let offen = null;
  for (const z of zeilen) {
    if (z[0] === "+") { assert.equal(offen, null, "zwei Prozesse gleichzeitig in der Sperre"); offen = z.slice(1); }
    else { assert.equal(offen, z.slice(1)); offen = null; }
  }
  assert.equal(existsSync(d), false);
});

test("Sperre: die Sicherung wartet, solange das Studio abgleicht (und umgekehrt) — in einem anderen Prozess gehalten", async () => {
  const { mac, remote, support } = aufbau();
  const datei = B.sperrDateiFuer(mac, support);
  // ein zweiter Prozess hält die Sperre
  const halter = spawn(process.execPath, ["--input-type=module", "-e", `
    import { nimmSperre } from ${JSON.stringify(new URL("../abgleich-sperre.mjs", import.meta.url).href)};
    const s = nimmSperre(process.argv[1], { art: "studio-abgleich" });
    console.log(s.ok ? "bereit" : "besetzt");
    process.stdin.on("data", () => { s.freigeben(); process.exit(0); });
  `, datei], { stdio: ["pipe", "pipe", "inherit"] });
  await new Promise((ok) => halter.stdout.once("data", ok));
  try {
    speichern(mac, "10_notizen/neu.md", "# Neu\n", "Mac: neu");
    const serverKopf = kopfRemote(remote);
    assert.equal(B.abgleichen(mac, { support }).art, "laeuft");
    assert.equal(B.holen(mac, { support }).art, "laeuft");
    assert.equal(kopfRemote(remote), serverKopf, "nichts gesendet, solange gesperrt");
    assert.throws(() => loes(mac, { support, auswahl: [] }), (e) => e.status === 409 && e.extra.art === "laeuft");
    assert.throws(() => K.abbrechen(mac, { support }), (e) => e.status === 409 && e.extra.art === "laeuft");
  } finally { halter.stdin.write("x"); await new Promise((ok) => halter.on("exit", ok)); }
  assert.equal(B.abgleichen(mac, { support }).art, "gesendet", "danach geht es wieder");
  assert.equal(existsSync(datei), false, "und die Sperre ist wieder frei");
});

test("Sperre: eine verwaiste Sperre (Prozess beendet) blockiert die Sicherung nicht", async () => {
  const { mac, remote, support } = aufbau();
  const datei = B.sperrDateiFuer(mac, support);
  const k = spawn(process.execPath, ["-e", "0"]);
  const pid = k.pid; await new Promise((ok) => k.on("exit", ok));
  mkdirSync(join(support, "backup"), { recursive: true });
  writeFileSync(datei, JSON.stringify({ pid, zeit: Date.now(), art: "studio-abgleich", marke: "z" }));
  speichern(mac, "10_notizen/neu.md", "# Neu\n", "Mac: neu");
  assert.equal(B.abgleichen(mac, { support }).art, "gesendet");
  assert.equal(kopfRemote(remote), kopf(mac));
});

// ───────────────────────────── Review: Löschung behalten, Umbenennung, fremde Zusammenführung, Bearbeitung, gemerkter Stand ─────────────────────────────
const leseMerker = (support) => { const d = join(support, "backup"); const n = readdirSync(d).find((x) => x.endsWith(".json") && !x.includes(".holen.")); return JSON.parse(readFileSync(join(d, n), "utf8")); };
function loeschenAufbau() { // hier gelöscht, dort geändert
  const a = aufbau();
  speichern(a.handy, "10_notizen/ideen.md", "# Ideen\n\n- Offline-Modus\n- Neu vom Handy\n", "Handy: Ideen", HANDY_MAIL); g(a.handy, "push", "-q");
  g(a.mac, "rm", "-q", "--", "10_notizen/ideen.md"); g(a.mac, "commit", "-q", "-m", "Mac: Ideen gelöscht");
  g(a.mac, "fetch", "-q", "origin");
  oeffneMerge(a.mac, a.support);
  return a;
}
test("K1: „hier gelöscht, dort geändert“ + „diese behalten“ (also gelöscht lassen) scheitert nicht nach dem Zusammenführen; die Entscheidung wird festgehalten", () => {
  const { remote, mac, support } = loeschenAufbau();
  const r = loes(mac, { support, auswahl: auswahlVon({ "10_notizen/ideen.md": "meine" }) });
  assert.equal(r.ok, true);
  assert.equal(existsSync(join(mac, "10_notizen/ideen.md")), false);
  assert.equal(g(mac, "ls-files", "--", "10_notizen/ideen.md").trim(), "");
  assert.equal(r.eintraege.length, 1);
  assert.match(g(mac, "log", "-1", "--format=%s").trim(), /^Konflikt gelöst: „Ideen“ – Löschung übernommen$/);
  assert.equal(K.rueckgaengigStand(mac, { support }).moeglich, true, "die Rückgängig-Marke ist da");
  assert.equal(r.abgleich.ok, true, r.abgleich.text);
  assert.equal(kopfRemote(remote), kopf(mac));
});
test("K1: nach einer gelöschten Datei laufen die weiteren Entscheidungen in derselben Runde weiter (nicht still „meine“)", () => {
  const a = aufbau();
  const { mac, handy, support } = a;
  speichern(handy, "10_notizen/ideen.md", "# Ideen\n\n- Neu vom Handy\n", "Handy: Ideen", HANDY_MAIL);
  speichern(handy, "10_notizen/schlicht.md", "# Schlicht\n\nvom Handy\n", "Handy: schlicht", HANDY_MAIL); g(handy, "push", "-q");
  g(mac, "rm", "-q", "--", "10_notizen/ideen.md"); g(mac, "commit", "-q", "-m", "Mac: Ideen gelöscht");
  speichern(mac, "10_notizen/schlicht.md", "# Schlicht\n\nvom Mac\n", "Mac: schlicht");
  g(mac, "fetch", "-q", "origin");
  oeffneMerge(mac, support);
  const r = loes(mac, { support, auswahl: auswahlVon({ "10_notizen/ideen.md": "meine", "10_notizen/schlicht.md": "andere" }) });
  assert.equal(r.eintraege.length, 2);
  assert.equal(lies(mac, "10_notizen/schlicht.md"), "# Schlicht\n\nvom Handy\n");
});

function renameAufbau() {
  const a = aufbau();
  g(a.handy, "mv", "10_notizen/kickoff.md", "10_notizen/kickoff-handy.md"); gAls(a.handy, HANDY_MAIL, "commit", "-q", "-m", "Handy: umbenannt"); g(a.handy, "push", "-q");
  g(a.mac, "mv", "10_notizen/kickoff.md", "10_notizen/kickoff-mac.md"); g(a.mac, "commit", "-q", "-m", "Mac: umbenannt");
  g(a.mac, "fetch", "-q", "origin");
  oeffneMerge(a.mac, a.support);
  return a;
}
test("Umbenennung auf beiden Seiten: ein Eintrag „umbenannt“ statt zwei „gelöscht“; mein Name · der andere Name · beide", () => {
  for (const wahl of ["meine", "andere", "beide"]) {
    const { mac, support } = renameAufbau();
    const a = K.ansicht(mac, { support });
    assert.equal(a.dateien.length, 1, JSON.stringify(a.dateien.map((d) => d.pfad)));
    const d = a.dateien[0];
    assert.equal(d.typ, "umbenannt");
    assert.equal(d.pfad, "10_notizen/kickoff-mac.md"); assert.equal(d.pfadAndere, "10_notizen/kickoff-handy.md");
    assert.match(d.meine.text, /Karten-App/); assert.match(d.andere.text, /Karten-App/);
    const r = loes(mac, { support, auswahl: auswahlVon({ [d.pfad]: wahl }) });
    assert.equal(r.ok, true);
    const mit = (p) => existsSync(join(mac, p));
    assert.equal(mit("10_notizen/kickoff.md"), false, "der alte Name ist weg");
    assert.equal(mit("10_notizen/kickoff-mac.md"), wahl !== "andere", wahl);
    assert.equal(mit("10_notizen/kickoff-handy.md"), wahl !== "meine", wahl);
    assert.equal(g(mac, "status", "--porcelain").trim(), "");
    if (wahl !== "meine") { // Rückgängig stellt „mein Name“ wieder her
      K.rueckgaengig(mac, { support });
      assert.equal(mit("10_notizen/kickoff-mac.md"), true); assert.equal(mit("10_notizen/kickoff-handy.md"), false);
      const an2 = K.ansicht(mac, { support });
      assert.equal(an2.dateien.length, 1); assert.equal(an2.dateien[0].typ, "umbenannt");
    }
  }
});

test("W1: eine Zusammenführung, die Kortex nicht begonnen hat (Terminal), wird nur angezeigt: Lösen und Später sind 409 „fremd“, nichts wird angefasst", () => {
  const a = aufbau();
  speichern(a.handy, "10_notizen/schlicht.md", "# Schlicht\n\nHandy\n", "Handy", HANDY_MAIL); g(a.handy, "push", "-q");
  speichern(a.mac, "10_notizen/schlicht.md", "# Schlicht\n\nMac\n", "Mac");
  g(a.mac, "fetch", "-q", "origin");
  assert.throws(() => g(a.mac, "merge", "--no-edit", "origin/main")); // ohne markieren()
  schreibe(a.mac, "10_notizen/schlicht.md", "# Schlicht\n\nvon Hand im Terminal gelöst\n");
  const an = K.ansicht(a.mac, { support: a.support });
  assert.equal(an.aktiv, true); assert.equal(an.fremd, true);
  const vorher = kopf(a.mac);
  assert.throws(() => K.abbrechen(a.mac, { support: a.support }), (e) => e.status === 409 && e.extra.art === "fremd");
  assert.throws(() => loes(a.mac, { support: a.support, auswahl: auswahlVon({ "10_notizen/schlicht.md": "meine" }) }), (e) => e.status === 409 && e.extra.art === "fremd");
  assert.ok(existsSync(join(a.mac, ".git", "MERGE_HEAD")));
  assert.equal(kopf(a.mac), vorher);
  assert.equal(lies(a.mac, "10_notizen/schlicht.md"), "# Schlicht\n\nvon Hand im Terminal gelöst\n");
});

test("W1/W2: Später sichert von Hand Bearbeitetes (auch Dateien, die Git selbst zusammengeführt hat) in brain-sicherung/; Unverändertes wird nicht kopiert", () => {
  const { mac, handy, support } = konfliktAufbau();
  const sicher = K.abbrechen(mac, { support });
  assert.equal(sicher.sicherung, null, "nichts von Hand verändert: keine Kopie");
  assert.equal(existsSync(join(mac, ".git", "MERGE_HEAD")), false);
  speichern(handy, "10_notizen/frei.md", "# Frei\n\nvom Handy\n", "Handy: frei", HANDY_MAIL); g(handy, "push", "-q");
  g(mac, "fetch", "-q", "origin");
  oeffneMerge(mac, support);
  assert.match(lies(mac, "10_notizen/schlicht.md"), /<<<<<<</);
  schreibe(mac, "10_notizen/schlicht.md", "# Schlicht\n\nvon Hand gelöst, das ist mir wichtig\n");
  const a = K.abbrechen(mac, { support });
  assert.ok(a.sicherung && existsSync(a.sicherung.ordner), "Sicherungsordner genannt");
  assert.equal(readFileSync(join(a.sicherung.ordner, "10_notizen/schlicht.md"), "utf8"), "# Schlicht\n\nvon Hand gelöst, das ist mir wichtig\n");
  assert.deepEqual(readdirSync(join(a.sicherung.ordner, "10_notizen")), ["schlicht.md"], "nur Bearbeitetes");
  assert.equal(existsSync(join(mac, ".git", "MERGE_HEAD")), false);
  // eine von Git selbst zusammengeführte Datei des anderen Geräts, die danach von Hand verändert wurde: das Zurücknehmen würde sie verlieren → 409 MIT Sicherung
  g(mac, "fetch", "-q", "origin");
  oeffneMerge(mac, support);
  schreibe(mac, "10_notizen/frei.md", "# Frei\n\nvom Handy, aber ich habe weitergeschrieben\n");
  const e = (() => { try { K.abbrechen(mac, { support }); } catch (x) { return x; } return null; })();
  assert.equal(e.status, 409); assert.equal(e.extra.art, "geaendert");
  assert.equal(readFileSync(join(e.extra.sicherung.ordner, "10_notizen/frei.md"), "utf8"), "# Frei\n\nvom Handy, aber ich habe weitergeschrieben\n");
  assert.match(e.message, /gesichert in/);
  assert.equal(lies(mac, "10_notizen/frei.md"), "# Frei\n\nvom Handy, aber ich habe weitergeschrieben\n", "nichts verloren");
});

test("W2: Von Hand bearbeitete Konfliktdatei wird beim Lösen nie überschrieben: 409 „bearbeitet“ mit Dateiliste; nach „Später“ liegt die Bearbeitung gesichert da", () => {
  const { mac, support } = konfliktAufbau();
  schreibe(mac, "10_notizen/schlicht.md", "# Schlicht\n\nhier habe ich selbst gelöst\n");
  const e = (() => { try { loes(mac, { support, auswahl: auswahlVon(alleWahl("meine")) }); } catch (x) { return x; } return null; })();
  assert.equal(e.status, 409); assert.equal(e.extra.art, "bearbeitet"); assert.deepEqual(e.extra.dateien, ["10_notizen/schlicht.md"]);
  assert.match(e.message, /Später/);
  assert.ok(existsSync(join(mac, ".git", "MERGE_HEAD")), "nichts angefasst");
  assert.equal(lies(mac, "10_notizen/schlicht.md"), "# Schlicht\n\nhier habe ich selbst gelöst\n");
  const a = K.abbrechen(mac, { support });
  assert.equal(readFileSync(join(a.sicherung.ordner, "10_notizen/schlicht.md"), "utf8"), "# Schlicht\n\nhier habe ich selbst gelöst\n");
  assert.equal(lies(mac, "10_notizen/schlicht.md"), "# Schlicht\n\neine Zeile vom Mac\n");
});

test("W3: Rückgängig merkt den Stand im Support-Ordner: die Sicherung sendet bis zur neuen Entscheidung nichts; die Ansicht kommt NUR von dort (ein „basis“ von außen zählt nicht)", () => {
  const { remote, mac, support } = konfliktAufbau();
  loes(mac, { support, auswahl: auswahlVon(alleWahl("andere")) });
  const serverKopf = kopfRemote(remote);
  K.rueckgaengig(mac, { support });
  assert.ok(leseMerker(support).konfliktBasis, "der Stand steht in der Merker-Datei");
  speichern(mac, "10_notizen/anderes.md", "# Anderes\n", "Mac: etwas Neues"); // die Sicherung WÜRDE sonst senden
  const r = B.abgleichen(mac, { support });
  assert.equal(r.art, "konflikt"); assert.equal(r.ok, false);
  assert.equal(kopfRemote(remote), serverKopf, "es wurde nichts gesendet");
  const an = K.ansicht(mac, { support, basis: { meine: "0".repeat(40), andere: "1".repeat(40), dateien: ["10_notizen/zeitplan.md"] } }); // fremde Angabe wird ignoriert
  assert.equal(an.modus, "stand"); assert.equal(an.haelt, true); assert.equal(an.dateien.length, 5);
  const r2 = loes(mac, { support, auswahl: auswahlVon(alleWahl("meine")) });
  assert.equal(r2.ok, true);
  assert.equal(leseMerker(support).konfliktBasis, undefined, "Stand geräumt");
  assert.equal(r2.abgleich.ok, true, r2.abgleich.text);
  assert.equal(kopfRemote(remote), kopf(mac));
});

test("W4: ohne gemerkten Stand lässt sich nichts „neu“ entscheiden; vorgemerkte oder nicht gesicherte Arbeit blockiert (409); seitdem weitergearbeitete Dateien fallen aus dem Stand", () => {
  const { mac, support } = konfliktAufbau();
  assert.throws(() => K.loesen(mac, { support, auswahl: [], gesehen: { meine: "a".repeat(40), andere: "b".repeat(40) }, basis: { meine: kopf(mac), andere: kopf(mac), dateien: ["x.md"] } }), (e) => e.status === 409 && e.extra.art === "veraltet");
  loes(mac, { support, auswahl: auswahlVon(alleWahl("andere")) });
  K.rueckgaengig(mac, { support });
  schreibe(mac, "10_notizen/stage.md", "x\n"); g(mac, "add", "--", "10_notizen/stage.md");
  assert.throws(() => loes(mac, { support, auswahl: auswahlVon(alleWahl("meine")) }), (e) => e.status === 409 && e.extra.art === "geaendert");
  g(mac, "reset", "-q"); rmSync(join(mac, "10_notizen/stage.md"));
  schreibe(mac, "10_notizen/schlicht.md", "# Schlicht\n\nnoch nicht gesichert\n");
  assert.throws(() => loes(mac, { support, auswahl: auswahlVon(alleWahl("meine")) }), (e) => e.status === 409 && e.extra.art === "geaendert");
  g(mac, "checkout", "-q", "--", "10_notizen/schlicht.md");
  speichern(mac, "10_notizen/schlicht.md", "# Schlicht\n\nweitergearbeitet\n", "Mac: weiter");
  const an = K.ansicht(mac, { support });
  assert.equal(an.dateien.length, 4); assert.deepEqual(an.weitergearbeitet.map((w) => w.pfad), ["10_notizen/schlicht.md"]);
  assert.equal(lies(mac, "10_notizen/schlicht.md"), "# Schlicht\n\nweitergearbeitet\n");
  for (const p of ["10_notizen/kickoff.md", "10_notizen/zeitplan.md", "10_notizen/ideen.md", "05_aufgaben/budget.md"]) speichern(mac, p, lies(mac, p) + "\nnoch eine Zeile\n", "Mac: weiter " + p);
  const alle = K.ansicht(mac, { support });
  assert.equal(alle.aktiv, true, "nie still geräumt: die Oberfläche zeigt, dass seitdem weitergearbeitet wurde"); assert.equal(alle.dateien.length, 0); assert.equal(alle.weitergearbeitet.length, 5);
  K.verwerfen(mac, { support });
  assert.equal(leseMerker(support).konfliktBasis, undefined, "erst Verwerfen räumt den Stand, dann ist die Sicherung frei");
});

test("W5: jede Fassung nennt ihre Blob-Kennung; Entscheidungen auf einem anderen Stand als dem gesehenen werden abgelehnt (409 „veraltet“)", () => {
  const { mac, support } = konfliktAufbau();
  const a = K.ansicht(mac, { support });
  const k = a.dateien.find((d) => d.pfad === "10_notizen/kickoff.md");
  assert.equal(k.meine.blob, g(mac, "rev-parse", `${a.meine}:10_notizen/kickoff.md`).trim());
  assert.equal(k.andere.blob, g(mac, "rev-parse", `${a.andere}:10_notizen/kickoff.md`).trim());
  const e = (() => { try { K.loesen(mac, { support, auswahl: auswahlVon(alleWahl("meine")), gesehen: { meine: a.meine, andere: a.meine } }); } catch (x) { return x; } return null; })();
  assert.equal(e.status, 409); assert.equal(e.extra.art, "veraltet");
  assert.throws(() => K.loesen(mac, { support, auswahl: auswahlVon(alleWahl("meine")) }), (x) => x.status === 409 && x.extra.art === "veraltet", "ohne gesehen: auch abgelehnt");
  assert.ok(existsSync(join(mac, ".git", "MERGE_HEAD")));
});

function grossAufbau() {
  const a = aufbau();
  const zeilen = (x) => Array.from({ length: 30_000 }, (_, i) => (i === 15_000 ? x : `Zeile ${i} mit etwas mehr Text, damit die Datei groß wird ${"-".repeat(130)}`)).join("\n") + "\n";
  speichern(a.mac, "10_notizen/gross.md", zeilen("Basis"), "Mac: groß"); g(a.mac, "push", "-q"); g(a.handy, "pull", "-q");
  speichern(a.handy, "10_notizen/gross.md", zeilen("vom Handy"), "Handy: groß", HANDY_MAIL); g(a.handy, "push", "-q");
  speichern(a.mac, "10_notizen/gross.md", zeilen("vom Mac"), "Mac: groß 2");
  g(a.mac, "fetch", "-q", "origin");
  oeffneMerge(a.mac, a.support);
  return a;
}
test("W6: eine Datei über 5 MB im Konflikt blockiert nichts: Später sichert Bearbeitetes als Objekt (_blobs.txt), „diese“ geht ohne Kopie, „andere“ geht als Strom", () => {
  const { mac, support } = grossAufbau();
  assert.ok(statSync(join(mac, "10_notizen/gross.md")).size > 5 * 1024 * 1024);
  schreibe(mac, "10_notizen/gross.md", readFileSync(join(mac, "10_notizen/gross.md"), "utf8") + "meine Handarbeit\n");
  const s = K.abbrechen(mac, { support });
  assert.equal(s.sicherung.dateien.length, 0); assert.equal(s.sicherung.blobs.length, 1);
  assert.match(readFileSync(join(s.sicherung.ordner, "_blobs.txt"), "utf8"), /^[0-9a-f]{40} {2}10_notizen\/gross\.md$/m);
  assert.ok(Number(g(mac, "cat-file", "-s", s.sicherung.blobs[0].id)) > 5 * 1024 * 1024, "das Objekt ist die ganze große Datei");
  g(mac, "fetch", "-q", "origin");
  oeffneMerge(mac, support);
  const r = loes(mac, { support, auswahl: auswahlVon({ "10_notizen/gross.md": "meine" }) });
  assert.equal(r.ok, true); assert.equal(r.sicherung, null);
});

test("Mitten im Festhalten gescheitert: was festgehalten ist, bleibt rückgängig-fähig, der Rest wird als Stand gemerkt (die Sicherung sendet nichts)", () => {
  const a = aufbau();
  const { mac, handy, support, remote } = a;
  speichern(handy, "10_notizen/schlicht.md", "# Schlicht\n\nHandy\n", "Handy", HANDY_MAIL);
  speichern(handy, "10_notizen/zeitplan.md", "# Zeitplan\n\n- 5. Dez: Abnahme\n", "Handy 2", HANDY_MAIL); g(handy, "push", "-q");
  speichern(mac, "10_notizen/schlicht.md", "# Schlicht\n\nMac\n", "Mac");
  speichern(mac, "10_notizen/zeitplan.md", "# Zeitplan\n\n- 28. Nov: Abnahme\n", "Mac 2");
  g(mac, "fetch", "-q", "origin");
  oeffneMerge(mac, support);
  const serverKopf = kopfRemote(remote);
  process.env.BRAIN_KONFLIKT_ABBRUCH_NACH = "1"; // die zweite Entscheidung scheitert (Testhaken im Kern)
  let fehler;
  try { loes(mac, { support, auswahl: auswahlVon({ "10_notizen/schlicht.md": "meine", "10_notizen/zeitplan.md": "andere" }) }); } catch (e) { fehler = e; } finally { delete process.env.BRAIN_KONFLIKT_ABBRUCH_NACH; }
  assert.ok(fehler, "die Entscheidung muss scheitern");
  assert.equal(fehler.extra.teilweise, true); assert.equal(fehler.extra.festgehalten, 1);
  assert.equal(K.rueckgaengigStand(mac, { support }).moeglich, true, "die erste Entscheidung steht in der Rückgängig-Marke");
  assert.deepEqual(leseMerker(support).konfliktBasis.dateien, ["10_notizen/zeitplan.md"]);
  assert.equal(B.abgleichen(mac, { support }).art, "konflikt");
  assert.equal(kopfRemote(remote), serverKopf);
  const r = loes(mac, { support, auswahl: auswahlVon({ "10_notizen/zeitplan.md": "andere" }) });
  assert.equal(r.ok, true); assert.match(lies(mac, "10_notizen/zeitplan.md"), /5\. Dez/);
});

test("Namen: unsichtbare Umlenker (Bidi, Breite null) fliegen aus dem Gerätenamen; der Name der Kopie ist höchstens 255 Bytes lang; je Datei der Name DES Geräts dieser Datei", () => {
  assert.equal(K.geraetAusCommit({ nachricht: "Kortex-Geraet: ‮evil​⁦Gerät⁩\n", email: "" }), "evilGerät");
  assert.equal(K.geraetAusCommit({ nachricht: "x", email: "a@Mac‮mini.local" }), "Macmini");
  const a = aufbau();
  const lang = "日".repeat(80); // 240 Bytes
  speichern(a.handy, `10_notizen/${lang}.md`, "# Lang\n\nBasis\n", "Handy: lang", HANDY_MAIL);
  speichern(a.handy, "10_notizen/zeitplan.md", "# Zeitplan\n\n- 5. Dez\n", "Handy: zeit", HANDY_MAIL);
  g(a.handy, "push", "-q"); g(a.mac, "pull", "-q");
  speichern(a.handy, `10_notizen/${lang}.md`, "# Lang\n\nHandy\n", "Handy: lang 2", HANDY_MAIL);
  speichern(a.handy, "10_notizen/zeitplan.md", "# Zeitplan\n\n- 5. Dez: Abnahme\n", "Handy: zeit 2\n\nKortex-Geraet: Pixel Tablet", "x@Pixel.local"); g(a.handy, "push", "-q");
  speichern(a.mac, `10_notizen/${lang}.md`, "# Lang\n\nMac\n", "Mac: lang");
  speichern(a.mac, "10_notizen/zeitplan.md", "# Zeitplan\n\n- 28. Nov: Abnahme\n", "Mac: zeit");
  g(a.mac, "fetch", "-q", "origin");
  oeffneMerge(a.mac, a.support);
  const r = loes(a.mac, { support: a.support, auswahl: auswahlVon({ [`10_notizen/${lang}.md`]: "beide", "10_notizen/zeitplan.md": "beide" }) });
  const kopien = r.kopien.map((k) => k.pfad);
  for (const k of kopien) { assert.ok(Buffer.byteLength(k.split("/").pop()) <= 255, k); assert.ok(existsSync(join(a.mac, k))); }
  assert.ok(kopien.some((k) => k.endsWith("zeitplan (Pixel Tablet).md")), kopien.join("|"));
  assert.ok(kopien.some((k) => /\(Fabios iPhone\)\.md$/.test(k)), kopien.join("|"));
});

// ───────────────────────────── Verwerfen, Übernehmen ─────────────────────────────
test("Verwerfen: der gemerkte Stand fällt weg, die Sicherung sendet wieder; der Verlauf bleibt, bereits Festgehaltenes bleibt rückgängig-fähig; ohne Stand 409", () => {
  const a = aufbau();
  const { mac, handy, support, remote } = a;
  speichern(handy, "10_notizen/schlicht.md", "# Schlicht\n\nHandy\n", "Handy", HANDY_MAIL);
  speichern(handy, "10_notizen/zeitplan.md", "# Zeitplan\n\n- 5. Dez: Abnahme\n", "Handy 2", HANDY_MAIL); g(handy, "push", "-q");
  speichern(mac, "10_notizen/schlicht.md", "# Schlicht\n\nMac\n", "Mac");
  speichern(mac, "10_notizen/zeitplan.md", "# Zeitplan\n\n- 28. Nov: Abnahme\n", "Mac 2");
  g(mac, "fetch", "-q", "origin");
  oeffneMerge(mac, support);
  assert.throws(() => K.verwerfen(mac, { support }), (e) => e.status === 409 && e.extra.art === "nichts");
  process.env.BRAIN_KONFLIKT_ABBRUCH_NACH = "1";
  try { loes(mac, { support, auswahl: auswahlVon({ "10_notizen/schlicht.md": "meine", "10_notizen/zeitplan.md": "andere" }) }); } catch { /* gewollt */ } finally { delete process.env.BRAIN_KONFLIKT_ABBRUCH_NACH; }
  assert.ok(leseMerker(support).konfliktBasis);
  assert.equal(B.abgleichen(mac, { support }).art, "konflikt", "die Sicherung wartet");
  const kopfVorher = kopf(mac), serverVorher = kopfRemote(remote);
  const r = K.verwerfen(mac, { support });
  assert.equal(r.ok, true); assert.deepEqual(r.dateien, ["10_notizen/zeitplan.md"]);
  assert.equal(leseMerker(support).konfliktBasis, undefined);
  assert.equal(kopf(mac), kopfVorher, "der Verlauf ist unberührt (die Fassung des anderen Geräts steht darin)");
  assert.equal(K.rueckgaengigStand(mac, { support }).moeglich, true, "die schon festgehaltene Entscheidung bleibt");
  assert.equal(B.leseAbgleichStand(mac, { support }), null);
  assert.equal(K.ansicht(mac, { support }).aktiv, false);
  const s = B.abgleichen(mac, { support });
  assert.equal(s.ok, true, s.text);
  assert.notEqual(kopfRemote(remote), serverVorher);
  assert.equal(kopfRemote(remote), kopf(mac));
  assert.throws(() => K.verwerfen(mac, { support }), (e) => e.status === 409);
});

// ───────────────────────────── Zweite Prüfung: Marke nur für eigene Zusammenführungen, Sicherheitsnetz, gemerkter Stand ─────────────────────────────
test("K-neu-1: markieren setzt die Marke nie ohne ausdrückliches „vorher war keine offen“ — eine Zusammenführung aus dem Terminal bleibt fremd, Später ist 409", () => {
  const a = aufbau();
  speichern(a.handy, "10_notizen/schlicht.md", "# Schlicht\n\nHandy\n", "Handy", HANDY_MAIL); g(a.handy, "push", "-q");
  speichern(a.mac, "10_notizen/schlicht.md", "# Schlicht\n\nMac\n", "Mac");
  g(a.mac, "fetch", "-q", "origin");
  assert.throws(() => g(a.mac, "merge", "--no-edit", "origin/main")); // Terminal
  schreibe(a.mac, "10_notizen/schlicht.md", "# Schlicht\n\nvon Hand im Terminal gelöst\n");
  // der Abgleich der Oberfläche läuft auf eine schon offene Zusammenführung: kein vorherAbwesend → keine Marke
  const m = K.markiere(a.mac, { support: a.support });
  assert.equal(m.markiert, false);
  assert.equal(leseMerker(a.support).konfliktOffen, undefined);
  assert.equal(K.ansicht(a.mac, { support: a.support }).fremd, true);
  assert.throws(() => K.abbrechen(a.mac, { support: a.support }), (e) => e.status === 409 && e.extra.art === "fremd");
  assert.equal(lies(a.mac, "10_notizen/schlicht.md"), "# Schlicht\n\nvon Hand im Terminal gelöst\n", "Handarbeit unangetastet");
});

test("Sicherheitsnetz: gesichert wird alles, was vom reinen Ergebnis der Zusammenführung abweicht — vorgemerkt UND nicht vorgemerkt, auch ohne Merker-Abweichung", () => {
  const a = aufbau();
  const { mac, handy, support } = a;
  speichern(handy, "10_notizen/schlicht.md", "# Schlicht\n\nHandy\n", "Handy", HANDY_MAIL);
  speichern(handy, "10_notizen/frei.md", "# Frei\n\nvom Handy\n", "Handy: frei", HANDY_MAIL);
  speichern(handy, "10_notizen/zeitplan.md", "# Zeitplan\n\n- 5. Dez: Abnahme\n- 12. Dez: Test\n", "Handy: zeit", HANDY_MAIL); g(handy, "push", "-q");
  speichern(mac, "10_notizen/schlicht.md", "# Schlicht\n\nMac\n", "Mac");
  speichern(mac, "10_notizen/zeitplan.md", "# Zeitplan\n\n- 28. Nov: Abnahme\n- 12. Dez: Erster Test\n", "Mac: zeit");
  g(mac, "fetch", "-q", "origin");
  oeffneMerge(mac, support);
  // (1) nur Konfliktdatei unverändert (Git-Marken) und saubere Dateien → nichts zu sichern
  assert.equal(K.abbrechen(mac, { support }).sicherung, null);
  g(mac, "fetch", "-q", "origin");
  oeffneMerge(mac, support);
  // (2) die konfliktfrei zusammengeführte Datei wurde im Terminal verändert UND vorgemerkt; eine Konfliktdatei von Hand gelöst und vorgemerkt; eine weitere unvorgemerkt bearbeitet
  schreibe(mac, "10_notizen/frei.md", "# Frei\n\nvorgemerkte Handarbeit\n"); g(mac, "add", "--", "10_notizen/frei.md");
  schreibe(mac, "10_notizen/zeitplan.md", "# Zeitplan\n\nvon Hand gelöst und vorgemerkt\n"); g(mac, "add", "--", "10_notizen/zeitplan.md");
  schreibe(mac, "10_notizen/schlicht.md", "# Schlicht\n\nnur im Arbeitsbaum bearbeitet\n");
  let s = null; // ob Git das Zurücknehmen zulässt oder ablehnt: die Sicherung liegt in jedem Fall da
  try { s = K.abbrechen(mac, { support }).sicherung; } catch (x) { s = x.extra && x.extra.sicherung ? x.extra.sicherung : null; }
  assert.ok(s, "gesichert");
  assert.equal(readFileSync(join(s.ordner, "10_notizen/schlicht.md"), "utf8"), "# Schlicht\n\nnur im Arbeitsbaum bearbeitet\n");
  // vorgemerkte Dateien liegen im Arbeitsbaum genau wie im Index: sie stehen unter _vorgemerkt/ (die Arbeitskopie wäre dieselbe)
  assert.deepEqual(s.vorgemerkt.sort(), ["10_notizen/frei.md", "10_notizen/zeitplan.md"]);
  assert.equal(readFileSync(join(s.ordner, "_vorgemerkt/10_notizen/frei.md"), "utf8"), "# Frei\n\nvorgemerkte Handarbeit\n", "auch das Vorgemerkte liegt für sich da");
  assert.equal(readFileSync(join(s.ordner, "_vorgemerkt/10_notizen/zeitplan.md"), "utf8"), "# Zeitplan\n\nvon Hand gelöst und vorgemerkt\n");
});

test("W-neu-3: Fremdes im Index (nicht Teil der Zusammenführung) → 409 vor jedem Eingriff; der Zusammenführungs-Eintrag nimmt es nie mit", () => {
  const { mac, support } = konfliktAufbau();
  schreibe(mac, "10_notizen/fremd.md", "# Fremd\n"); g(mac, "add", "--", "10_notizen/fremd.md");
  const vorher = kopf(mac);
  const e = (() => { try { loes(mac, { support, auswahl: auswahlVon(alleWahl("meine")) }); } catch (x) { return x; } return null; })();
  assert.equal(e.status, 409); assert.equal(e.extra.art, "vorgemerkt"); assert.deepEqual(e.extra.dateien, ["10_notizen/fremd.md"]);
  assert.equal(kopf(mac), vorher); assert.ok(existsSync(join(mac, ".git", "MERGE_HEAD")));
  g(mac, "reset", "-q", "--", "10_notizen/fremd.md");
  const r = loes(mac, { support, auswahl: auswahlVon(alleWahl("meine")) });
  assert.equal(r.ok, true);
  assert.equal(g(mac, "ls-tree", "-r", "--name-only", "HEAD").includes("10_notizen/fremd.md"), false);
});

test("W-neu-1: holen räumt den gemerkten Stand nicht (auch ohne Neues auf dem Server); er bleibt, bis er entschieden oder verworfen ist", () => {
  const { mac, support } = konfliktAufbau();
  loes(mac, { support, auswahl: auswahlVon(alleWahl("andere")) });
  K.rueckgaengig(mac, { support });
  assert.ok(leseMerker(support).konfliktBasis);
  const h = B.holen(mac, { support });
  assert.equal(h.art, "konflikt"); assert.equal(h.ok, false);
  assert.ok(leseMerker(support).konfliktBasis, "der gemerkte Stand ist noch da");
  assert.equal(B.leseAbgleichStand(mac, { support }).stand, "konflikt");
  const hg = B.holenGedrosselt(mac, { support, jetzt: Date.now() + 11 * 60_000 });
  assert.equal(hg.ok, false);
  assert.ok(leseMerker(support).konfliktBasis);
  assert.equal(B.abgleichen(mac, { support }).art, "konflikt");
  B.loescheAbgleichStand(mac, { support }); // auch das ausdrückliche Räumen des Vermerks lässt den Stand stehen
  assert.ok(leseMerker(support).konfliktBasis);
});

test("W-neu-2: passt der gemerkte Stand nicht mehr zum Vault (reset --hard), bleibt er sichtbar mit Hinweis und Verwerfen — nie still geräumt; Lösen ist 409", () => {
  const { remote, mac, support } = konfliktAufbau();
  const vorMerge = g(mac, "rev-parse", "HEAD^1").trim();
  loes(mac, { support, auswahl: auswahlVon(alleWahl("meine")) });
  K.rueckgaengig(mac, { support });
  g(mac, "reset", "-q", "--hard", vorMerge); // zurück vor die Zusammenführung: der andere Stand ist kein Vorfahr mehr
  const an = K.ansicht(mac, { support });
  assert.equal(an.aktiv, true); assert.equal(an.ungueltig, true); assert.equal(an.haelt, true); assert.deepEqual(an.dateien, []);
  assert.ok(leseMerker(support).konfliktBasis, "nicht still geräumt");
  assert.equal(B.abgleichen(mac, { support }).art, "konflikt");
  assert.throws(() => loes(mac, { support, auswahl: [] }), (e) => e.status === 409 && e.extra.art === "ungueltig");
  const serverKopf = kopfRemote(remote);
  K.verwerfen(mac, { support });
  assert.equal(K.ansicht(mac, { support }).aktiv, false);
  assert.equal(leseMerker(support).konfliktBasis, undefined);
  assert.equal(kopfRemote(remote), serverKopf);
});

test("Seitdem weitergearbeitet: die Datei bleibt mit Hinweis sichtbar (nie still entfernt); nur „Verwerfen“ räumt den Stand", () => {
  const { mac, support } = konfliktAufbau();
  loes(mac, { support, auswahl: auswahlVon(alleWahl("andere")) });
  K.rueckgaengig(mac, { support });
  for (const p of ["10_notizen/kickoff.md", "10_notizen/zeitplan.md", "10_notizen/ideen.md", "05_aufgaben/budget.md", "10_notizen/schlicht.md"]) speichern(mac, p, lies(mac, p) + "\nnoch eine Zeile\n", "Mac: weiter " + p);
  const an = K.ansicht(mac, { support });
  assert.equal(an.aktiv, true); assert.equal(an.dateien.length, 0); assert.equal(an.weitergearbeitet.length, 5);
  assert.ok(an.weitergearbeitet.every((w) => typeof w.pfad === "string" && w.titel));
  assert.ok(leseMerker(support).konfliktBasis, "nicht still geräumt");
  K.verwerfen(mac, { support });
  assert.equal(K.ansicht(mac, { support }).aktiv, false);
});

test("Große Datei (über 5 MB): „beide“ und „andere“ gehen als Strom aus dem Objekt — ohne Puffer-Limit, Ergebnis ist byte-gleich", () => {
  for (const wahl of ["andere", "beide"]) {
    const { mac, handy, support } = grossAufbau();
    const r = loes(mac, { support, auswahl: auswahlVon({ "10_notizen/gross.md": wahl }) });
    assert.equal(r.ok, true);
    const vomHandy = g(handy, "rev-parse", "HEAD:10_notizen/gross.md").trim();
    const arbeit = (p) => g(mac, "hash-object", "--", p).trim();
    if (wahl === "andere") assert.equal(arbeit("10_notizen/gross.md"), vomHandy);
    else {
      assert.equal(r.kopien.length, 1);
      assert.equal(arbeit(r.kopien[0].pfad), vomHandy, "die Kopie ist die Fassung des anderen Geräts, Byte für Byte");
      assert.ok(statSync(join(mac, r.kopien[0].pfad)).size > 5 * 1024 * 1024);
    }
    assert.equal(g(mac, "status", "--porcelain").trim(), "");
  }
});

// ───────────────────────────── Kommandozeile (so startet die Werkstatt den Kern) ─────────────────────────────
test("brain abgleich ansicht|loesen: JSON auf stdout, Fehler als { ok: false, status }", () => {
  const { mac, support } = konfliktAufbau();
  const lauf = (unter, eingabe) => {
    const env = { ...process.env, BRAIN_APP_SUPPORT: support, BRAIN_VAULT: "" };
    const r = spawnSync(process.execPath, [join(KERN, "brain.mjs"), "--vault", mac, "abgleich", unter, ...(eingabe ? ["--stdin"] : [])], { input: eingabe ? JSON.stringify(eingabe) : undefined, env, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  assert.equal(lauf("markieren", { vorherAbwesend: true }).markiert, true);
  const a = lauf("ansicht", {});
  assert.equal(a.ok, true); assert.equal(a.aktiv, true); assert.equal(a.dateien.length, 5); assert.equal(a.rueckgaengig.moeglich, false);
  const gesehen = { meine: a.meine, andere: a.andere };
  const f = lauf("loesen", { gesehen, auswahl: [{ pfad: "10_notizen/kickoff.md", wahl: "meine" }] });
  assert.equal(f.ok, false); assert.equal(f.status, 400); assert.match(f.fehler, /für jede Datei/);
  const ok = lauf("loesen", { gesehen, auswahl: auswahlVon(alleWahl("meine")) });
  assert.equal(ok.ok, true); assert.equal(ok.eintraege.length, 5);
  assert.equal(lauf("ansicht", {}).aktiv, false);
  const r = lauf("rueckgaengig");
  assert.equal(r.ok, true);
});

test("Umstellung (Phase B) läuft: Sicherung, Holen und Konfliktlösung warten, eine verwaiste Umstellungs-Sperre zählt nicht", () => {
  const { mac, remote, support } = aufbau();
  mkdirSync(join(mac, ".logs"), { recursive: true });
  const sperre = join(mac, ".logs", "umstellung-phase-b.lock");
  writeFileSync(sperre, JSON.stringify({ pid: process.pid, zeit: new Date().toISOString() }));
  speichern(mac, "10_notizen/neu.md", "# Neu\n", "Mac: neu");
  const serverKopf = kopfRemote(remote);
  assert.equal(B.abgleichen(mac, { support }).art, "umstellung");
  assert.equal(B.holen(mac, { support }).art, "umstellung");
  assert.throws(() => loes(mac, { support, auswahl: [] }), (e) => e.status === 409 && e.extra.art === "umstellung");
  assert.equal(kopfRemote(remote), serverKopf);
  assert.equal(existsSync(B.sperrDateiFuer(mac, support)), false, "die gemeinsame Sperre wurde gar nicht erst genommen");
  writeFileSync(sperre, JSON.stringify({ pid: 2 ** 22 - 3, zeit: new Date().toISOString() })); // Prozess gibt es nicht
  assert.equal(B.abgleichen(mac, { support }).art, "gesendet");
});

test("Markieren: nur eine Zusammenführung mit dem Stand des Servers (@{u}) wird als Kortex-Zusammenführung markiert; eine mit etwas anderem (Terminal) nie", () => {
  const { mac, handy, support } = aufbau();
  speichern(handy, "10_notizen/schlicht.md", "# Schlicht\n\neine Zeile vom Handy\n", "Handy: schlicht", HANDY_MAIL); g(handy, "push", "-q");
  // ein lokaler Zweig, der mit main kollidiert: im Terminal zusammengeführt, während der Abgleich „vorherAbwesend“ meldet
  g(mac, "checkout", "-q", "-b", "fremd");
  speichern(mac, "10_notizen/schlicht.md", "# Schlicht\n\neine Zeile aus dem Terminal\n", "fremd: schlicht");
  g(mac, "checkout", "-q", "main");
  speichern(mac, "10_notizen/schlicht.md", "# Schlicht\n\neine Zeile vom Mac\n", "Mac: schlicht");
  g(mac, "fetch", "-q", "origin");
  assert.throws(() => g(mac, "merge", "--no-edit", "fremd"));
  const r = K.markiere(mac, { support, vorherAbwesend: true });
  assert.deepEqual([r.offen, r.markiert], [true, false], "MERGE_HEAD ist nicht der Stand des Servers: nicht markiert");
  assert.equal(K.ansicht(mac, { support }).fremd, true);
  assert.equal(leseMerker(support).konfliktOffen, undefined);
  g(mac, "merge", "--abort");
  // dieselbe Lage mit dem Stand des Servers: markiert
  assert.throws(() => g(mac, "merge", "--no-edit", "origin/main"));
  const r2 = K.markiere(mac, { support, vorherAbwesend: true });
  assert.deepEqual([r2.offen, r2.markiert], [true, true]);
  assert.equal(K.ansicht(mac, { support }).fremd, false);
});
