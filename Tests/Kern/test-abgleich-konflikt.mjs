// test-abgleich-konflikt.mjs — Konflikt beim Abgleich (abgleich-konflikt.mjs, abgleich-sperre.mjs): echte Git-Repos in Temp, ein Remote ohne Arbeitsbaum (bare), ein „Mac“ (der Vault)
// und ein „anderes Gerät“ (zweiter Klon). Geprüft: beide Fassungen je Datei (mit Gerätename und Zeit), Sonderfälle gelöscht↔geändert und Aufgaben-Karte, alle
// Entscheidungsarten (diese/andere/beide/zusammengeführt), jede Entscheidung als eigener Verlaufs-Eintrag, Abschluss mit Abgleich wie die Sicherung, Konfliktstand
// geräumt, Rückgängig, Abbrechen, die gemeinsame Sperre (auch zwischen zwei Prozessen). Nie echte Nutzerorte: HOME und Support-Ordner liegen in Temp.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync, rmSync, readdirSync } from "node:fs";
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
  assert.throws(() => g(mac, "merge", "--no-edit", "origin/main"));
  assert.ok(existsSync(join(mac, ".git", "MERGE_HEAD")));
  return a;
}
const alleWahl = (w) => ({ "10_notizen/kickoff.md": w, "10_notizen/zeitplan.md": w, "10_notizen/ideen.md": w, "10_notizen/schlicht.md": w, "05_aufgaben/budget.md": w });
const auswahlVon = (m) => Object.entries(m).map(([pfad, wahl]) => (typeof wahl === "string" ? { pfad, wahl } : { pfad, ...wahl }));
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
  const r = K.loesen(mac, { support, auswahl: auswahlVon({
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
  const r = K.loesen(mac, { support, auswahl: auswahlVon({ ...alleWahl("meine"), "10_notizen/ideen.md": "andere" }) });
  assert.equal(r.ok, true);
  assert.equal(existsSync(join(mac, "10_notizen/ideen.md")), false);
  assert.equal(g(mac, "ls-files", "--", "10_notizen/ideen.md").trim(), "");
  assert.match(betreffs(mac, 6).join("\n"), /„Ideen“ – Löschung übernommen/);
  assert.equal(kopfRemote(remote), kopf(mac));
  g(handy, "pull", "-q", "--ff-only");
  assert.equal(existsSync(join(handy, "10_notizen/ideen.md")), false);
});

test("hier gelöscht, dort geändert: „diese behalten“ löscht, „andere“ bringt die Notiz zurück; „beide“ behält die vorhandene", () => {
  const a = aufbau();
  const { mac, handy, support } = a;
  speichern(handy, "10_notizen/ideen.md", "# Ideen\n\n- Offline-Modus\n- Neu vom Handy\n", "Handy: Ideen", HANDY_MAIL); g(handy, "push", "-q");
  g(mac, "rm", "-q", "--", "10_notizen/ideen.md"); g(mac, "commit", "-q", "-m", "Mac: Ideen gelöscht");
  g(mac, "fetch", "-q", "origin");
  assert.throws(() => g(mac, "merge", "--no-edit", "origin/main"));
  const d = K.ansicht(mac, { support }).dateien[0];
  assert.equal(d.typ, "geloescht"); assert.equal(d.wer, "meine"); assert.equal(d.meine.vorhanden, false); assert.match(d.andere.text, /Neu vom Handy/);
  const r = K.loesen(mac, { support, auswahl: auswahlVon({ "10_notizen/ideen.md": "beide" }) });
  assert.equal(r.ok, true);
  assert.deepEqual(r.kopien, []);
  assert.match(lies(mac, "10_notizen/ideen.md"), /Neu vom Handy/, "die vorhandene Fassung bleibt");
});

test("Eingaben werden geprüft: unvollständige Auswahl, unbekannter Pfad, Karte mit „beide“, Text fehlt — nichts wird verändert", () => {
  const { mac, support } = konfliktAufbau();
  const vorher = kopf(mac);
  const fehler = (auswahl) => { try { K.loesen(mac, { support, auswahl }); } catch (e) { return e; } return null; };
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
  assert.throws(() => K.loesen(mac, { support, auswahl: [] }), (e) => e.status === 409);
  assert.deepEqual(K.abbrechen(mac, { support }), { ok: true, offen: false });
});

test("ohne bestätigtes Ziel: gelöst und festgehalten, aber nichts gesendet", () => {
  const { remote, mac, support } = konfliktAufbau();
  B.bestaetigeRemote(mac, "https://example.invalid/x.git", { support });
  const serverKopf = kopfRemote(remote);
  const r = K.loesen(mac, { support, auswahl: auswahlVon(alleWahl("meine")) });
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
  assert.throws(() => g(mac, "merge", "--no-edit", "origin/main"));
  const an = K.ansicht(mac, { support });
  assert.deepEqual(an.dateien.map((d) => d.pfad), ["10_notizen/schlicht.md"]);
  assert.equal(an.versteckt, 1);
  const r = K.loesen(mac, { support, auswahl: auswahlVon({ "10_notizen/schlicht.md": "andere" }) });
  assert.deepEqual(r.versteckteBehalten, [".obsidian/app.json"]);
  assert.equal(lies(mac, ".obsidian/app.json"), "{\"a\":3}\n");
});

// ───────────────────────────── Rückgängig ─────────────────────────────
test("Rückgängig: die Fassungen von vor den Entscheidungen kommen als neuer Eintrag zurück; danach lässt sich neu entscheiden", () => {
  const { remote, mac, support } = konfliktAufbau();
  const r1 = K.loesen(mac, { support, auswahl: auswahlVon({ ...alleWahl("andere"), "10_notizen/kickoff.md": "beide" }) });
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
  // neu entscheiden: die Ansicht kommt aus dem gemerkten Stand (beide Seiten sind schon zusammengeführt)
  const basis = u.basis;
  const an = K.ansicht(mac, { support, basis });
  assert.equal(an.modus, "stand");
  assert.equal(an.dateien.length, 5);
  assert.match(an.dateien.find((d) => d.pfad === "10_notizen/kickoff.md").andere.text, /Lea und Jonas/);
  const r2 = K.loesen(mac, { support, basis, auswahl: auswahlVon({ ...alleWahl("meine"), "10_notizen/schlicht.md": "andere" }) });
  assert.equal(r2.ok, true);
  assert.equal(lies(mac, "10_notizen/schlicht.md"), "# Schlicht\n\neine Zeile vom Handy\n");
  assert.equal(r2.abgleich.ok, true, r2.abgleich.text);
  assert.equal(kopfRemote(remote), kopf(mac));
  assert.equal(B.leseAbgleichStand(mac, { support }), null, "Konfliktstand geräumt");
});

test("Rückgängig weigert sich, wenn an einer Datei seitdem weitergearbeitet wurde (nichts Fremdes überschreiben)", () => {
  const { mac, support } = konfliktAufbau();
  K.loesen(mac, { support, auswahl: auswahlVon(alleWahl("andere")) });
  speichern(mac, "10_notizen/schlicht.md", "# Schlicht\n\nweitergearbeitet\n", "Mac: weiter");
  assert.throws(() => K.rueckgaengig(mac, { support }), (e) => e.status === 409 && /noch einmal geändert/.test(e.message));
  assert.equal(lies(mac, "10_notizen/schlicht.md"), "# Schlicht\n\nweitergearbeitet\n");
  // ungesicherte Änderung: ebenso
  const a2 = konfliktAufbau();
  K.loesen(a2.mac, { support: a2.support, auswahl: auswahlVon(alleWahl("andere")) });
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
  assert.throws(() => g(mac, "merge", "--no-edit", "origin/main"));
  const l = K.loesen(mac, { support, auswahl: auswahlVon({ "10_notizen/schlicht.md": "meine" }) });
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
    assert.throws(() => K.loesen(mac, { support, auswahl: [] }), (e) => e.status === 409 && e.extra.art === "laeuft");
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

// ───────────────────────────── Kommandozeile (so startet die Werkstatt den Kern) ─────────────────────────────
test("brain abgleich ansicht|loesen: JSON auf stdout, Fehler als { ok: false, status }", () => {
  const { mac, support } = konfliktAufbau();
  const lauf = (unter, eingabe) => {
    const env = { ...process.env, BRAIN_APP_SUPPORT: support, BRAIN_VAULT: "" };
    const r = spawnSync(process.execPath, [join(KERN, "brain.mjs"), "--vault", mac, "abgleich", unter, ...(eingabe ? ["--stdin"] : [])], { input: eingabe ? JSON.stringify(eingabe) : undefined, env, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  const a = lauf("ansicht", {});
  assert.equal(a.ok, true); assert.equal(a.aktiv, true); assert.equal(a.dateien.length, 5); assert.equal(a.rueckgaengig.moeglich, false);
  const f = lauf("loesen", { auswahl: [{ pfad: "10_notizen/kickoff.md", wahl: "meine" }] });
  assert.equal(f.ok, false); assert.equal(f.status, 400); assert.match(f.fehler, /für jede Datei/);
  const ok = lauf("loesen", { auswahl: auswahlVon(alleWahl("meine")) });
  assert.equal(ok.ok, true); assert.equal(ok.eintraege.length, 5);
  assert.equal(lauf("ansicht", {}).aktiv, false);
  const r = lauf("rueckgaengig");
  assert.equal(r.ok, true);
});
