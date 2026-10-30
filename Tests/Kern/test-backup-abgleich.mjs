// test-backup-abgleich.mjs — Sicherung und Abgleich bei mehreren Geräten (Paket 1 des iOS-Plans): echte Git-Repos in Temp, ein Remote ohne Arbeitsbaum
// (bare) und zwei Klone („Mac“ = der Vault, „Handy/zweiter Mac“ = der andere Klon). Geprüft wird backup.mjs: Push nach fremdem Commit gelingt nach dem Holen,
// ein Konflikt sendet nichts und setzt den Stand, regelmäßiges Holen (Fast-Forward nur bei sauberem Arbeitsbaum, sonst nur Hinweis), die Fehlerarten.
// Nie echte Nutzerorte: HOME und Support-Ordner liegen im Temp-Ordner, die globale Git-Konfiguration des Nutzers wird nicht gelesen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const KERN = fileURLToPath(new URL("..", import.meta.url));
const FIXTURE = join(KERN, "tests", "fixture");
// Umgebung säubern, bevor etwas gestartet wird (Kindprozesse erben process.env)
const HOME = mkdtempSync(join(tmpdir(), "backup-abgleich-home-"));
Object.assign(process.env, { HOME, GIT_CONFIG_NOSYSTEM: "1" }); // Temp-Home: nie die globale Git-Konfiguration des Nutzers
for (const k of ["GIT_CONFIG_GLOBAL", "XDG_CONFIG_HOME", "CLAUDE_CONFIG_DIR", "CODEX_HOME"]) delete process.env[k];
for (const k of Object.keys(process.env)) if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|AUTHOR|COMMITTER|CONFIG_(COUNT|KEY|VALUE|PARAMETERS))/.test(k)) delete process.env[k];
Object.assign(process.env, { GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.org", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.org" });

const B = await import("../backup.mjs");
const { brainStatus } = await import("../status.mjs");

const g = (cwd, ...a) => execFileSync("git", a, { cwd, env: process.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const schreibe = (wurzel, rel, inhalt) => { const p = join(wurzel, rel); mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, inhalt); };
const lies = (wurzel, rel) => readFileSync(join(wurzel, rel), "utf8");
function commit(wurzel, rel, inhalt, nachricht = `Änderung ${rel}`) { schreibe(wurzel, rel, inhalt); g(wurzel, "add", "--", rel); g(wurzel, "commit", "-q", "-m", nachricht); }
const kopf = (wurzel) => g(wurzel, "rev-parse", "HEAD").trim();
const kopfRemote = (remote) => g(remote, "rev-parse", "refs/heads/main").trim();

// Remote (bare) + „Mac“ (der Vault) + „anderes Gerät“, die Sicherung ist auf GitHub-Art mit bestätigtem Remote eingerichtet
function aufbau() {
  const basis = mkdtempSync(join(tmpdir(), "backup-abgleich-"));
  const remote = join(basis, "remote.git"), mac = join(basis, "mac"), handy = join(basis, "handy"), support = join(basis, "support");
  mkdirSync(support);
  g(basis, "init", "-q", "--bare", "-b", "main", remote);
  cpSync(FIXTURE, mac, { recursive: true });
  writeFileSync(join(mac, ".gitignore"), ".logs/\n");
  g(mac, "init", "-q", "-b", "main");
  g(mac, "add", "--", ".");
  g(mac, "commit", "-q", "-m", "Start");
  g(mac, "remote", "add", "origin", remote);
  g(mac, "push", "-q", "-u", "origin", "main");
  g(basis, "clone", "-q", remote, handy);
  assert.equal(B.bestaetigeRemote(mac, remote, { support }), true);
  return { basis, remote, mac, handy, support };
}
const stand = (mac, support) => B.leseAbgleichStand(mac, { support });

test("Kontrolle: ein bloßes Senden wird abgelehnt, sobald das andere Gerät etwas gesendet hat", () => {
  const { remote, mac, handy } = aufbau();
  commit(handy, "00_inbox/vom-handy.md", "# Handy\n"); g(handy, "push", "-q");
  commit(mac, "00_inbox/vom-mac.md", "# Mac\n");
  assert.throws(() => g(mac, "push", "-q"), /rejected|non-fast-forward|fetch first/i);
  assert.notEqual(kopfRemote(remote), kopf(mac));
});

test("Senden nach fremdem Commit: erst holen und zusammenführen, dann senden — die Meldung sagt nicht „kein Internet“", () => {
  const { remote, mac, handy, support } = aufbau();
  commit(handy, "00_inbox/vom-handy.md", "# Handy\n"); g(handy, "push", "-q");
  commit(mac, "00_inbox/vom-mac.md", "# Mac\n");
  const r = B.abgleichen(mac, { support });
  assert.equal(r.art, "beides", r.text);
  assert.equal(r.ok, true);
  assert.match(r.text, /^Online gesichert\./);
  assert.doesNotMatch(r.text, /Internet/);
  assert.equal(kopfRemote(remote), kopf(mac), "der Server steht auf dem zusammengeführten Stand");
  assert.equal(lies(mac, "00_inbox/vom-handy.md"), "# Handy\n", "Neues vom anderen Gerät ist da");
  assert.equal(g(remote, "show", "main:00_inbox/vom-mac.md"), "# Mac\n");
  assert.equal(g(mac, "status", "--porcelain").trim(), "");
  assert.equal(stand(mac, support), null);
  // Das andere Gerät holt den zusammengeführten Stand ohne Weiteres
  g(handy, "pull", "-q", "--ff-only");
  assert.equal(lies(handy, "00_inbox/vom-mac.md"), "# Mac\n");
});

test("sichern() (Alltagsweg, wie `brain backup`): Online gesichert nach fremdem Commit; ohne Bestätigung des Ziels nichts", () => {
  const { remote, mac, handy, support } = aufbau();
  process.env.BRAIN_APP_SUPPORT = support;
  commit(handy, "00_inbox/vom-handy.md", "# Handy\n"); g(handy, "push", "-q");
  commit(mac, "00_inbox/vom-mac.md", "# Mac\n");
  const text = B.sichern(mac);
  assert.match(text, /^Online gesichert\./, text);
  assert.equal(kopfRemote(remote), kopf(mac));
  // anderes Ziel als das bestätigte: nichts wird geholt oder gesendet
  g(mac, "remote", "set-url", "origin", join(remote, "..", "gibt-es-nicht.git"));
  commit(mac, "00_inbox/zwei.md", "# Zwei\n");
  assert.equal(B.sichern(mac), B.PUSH_NICHT_BESTAETIGT);
});

test("nur Neues auf dem Server → geholt (Fast-Forward), nur Eigenes → gesendet, nichts → aktuell", () => {
  const { remote, mac, handy, support } = aufbau();
  assert.equal(B.abgleichen(mac, { support }).art, "aktuell");
  commit(handy, "00_inbox/a.md", "# A\n"); g(handy, "push", "-q");
  const r1 = B.abgleichen(mac, { support });
  assert.equal(r1.art, "geholt");
  assert.equal(kopf(mac), kopfRemote(remote));
  assert.equal(g(mac, "rev-list", "--merges", "--count", "HEAD").trim(), "0", "kein Zusammenführungs-Commit, wenn Fast-Forward reicht");
  commit(mac, "00_inbox/b.md", "# B\n");
  const r2 = B.abgleichen(mac, { support });
  assert.equal(r2.art, "gesendet");
  assert.equal(kopfRemote(remote), kopf(mac));
});

test("Konflikt: nichts wird gesendet, nichts verändert, der Stand „Konflikt – im Studio lösen“ ist gesetzt", async () => {
  const { remote, mac, handy, support } = aufbau();
  commit(handy, "00_inbox/gemeinsam.md", "# Gemeinsam\nZeile vom Handy\n"); g(handy, "push", "-q");
  const serverKopf = kopfRemote(remote);
  commit(mac, "00_inbox/gemeinsam.md", "# Gemeinsam\nZeile vom Mac\n");
  const macKopf = kopf(mac);
  const r = B.abgleichen(mac, { support });
  assert.equal(r.art, "konflikt");
  assert.equal(r.ok, false);
  assert.match(r.text, /Konflikt – im Studio lösen/);
  assert.deepEqual(r.dateien, ["00_inbox/gemeinsam.md"]);
  assert.equal(kopfRemote(remote), serverKopf, "nichts gesendet");
  assert.equal(kopf(mac), macKopf, "eigener Stand unverändert");
  assert.equal(g(mac, "status", "--porcelain").trim(), "", "keine halbe Zusammenführung, keine Konfliktmarken");
  assert.equal(existsSync(join(mac, ".git", "MERGE_HEAD")), false);
  assert.equal(lies(mac, "00_inbox/gemeinsam.md"), "# Gemeinsam\nZeile vom Mac\n");
  const s = stand(mac, support);
  assert.equal(s.stand, "konflikt");
  assert.equal(s.text, "Konflikt – im Studio lösen");
  // der Satz für den Alltag (sichern) nennt das Studio
  process.env.BRAIN_APP_SUPPORT = support;
  assert.match(B.sichern(mac), /Konflikt – im Studio lösen/);
  // Menüleiste: brain status meldet einen Hinweis mit demselben Satz an erster Stelle
  const st = await brainStatus(mac, { support });
  assert.equal(st.zustand, "hinweis");
  assert.equal(st.meldungen[0], "Konflikt – im Studio lösen");
  assert.equal(st.sicherung.stand, "konflikt");
  // regelmäßiges Holen überschreibt den Konflikt-Stand nicht mit einem schwächeren Hinweis
  assert.equal(B.holen(mac, { support }).art, "neues");
  assert.equal(stand(mac, support).stand, "konflikt");
  // Der Nutzer löst den Konflikt (wie im Studio): zusammenführen, Datei wählen, committen → die nächste Sicherung sendet und räumt den Stand weg
  assert.throws(() => g(mac, "merge", "--no-edit", "origin/main"));
  schreibe(mac, "00_inbox/gemeinsam.md", "# Gemeinsam\nZeile vom Handy\nZeile vom Mac\n");
  g(mac, "add", "--", "00_inbox/gemeinsam.md"); g(mac, "commit", "-q", "--no-edit");
  const r2 = B.abgleichen(mac, { support });
  assert.equal(r2.art, "gesendet", r2.text);
  assert.equal(kopfRemote(remote), kopf(mac));
  assert.equal(stand(mac, support), null);
  assert.equal((await brainStatus(mac, { support })).sicherung, null);
});

test("eine offene Zusammenführung (im Studio begonnen) wird nicht angefasst und nicht gesendet", () => {
  const { remote, mac, handy, support } = aufbau();
  commit(handy, "00_inbox/gemeinsam.md", "# G\nHandy\n"); g(handy, "push", "-q");
  commit(mac, "00_inbox/gemeinsam.md", "# G\nMac\n");
  g(mac, "fetch", "-q");
  assert.throws(() => g(mac, "merge", "--no-edit", "origin/main"));
  const serverKopf = kopfRemote(remote);
  const r = B.abgleichen(mac, { support });
  assert.equal(r.art, "konflikt");
  assert.equal(existsSync(join(mac, ".git", "MERGE_HEAD")), true, "die Zusammenführung des Nutzers bleibt offen");
  assert.equal(kopfRemote(remote), serverKopf);
  assert.equal(B.holen(mac, { support }).art, "konflikt");
});

test("nicht eingearbeitete Änderungen an denselben Dateien stehen im Weg: nichts wird gesendet, Hinweis, Arbeitsstand bleibt", () => {
  const { remote, mac, handy, support } = aufbau();
  commit(handy, "00_inbox/a.md", "# A\nHandy\n"); g(handy, "push", "-q");
  commit(mac, "00_inbox/b.md", "# B\n");
  schreibe(mac, "00_inbox/a.md", "# A\nUngesichert\n"); // eine nicht eingearbeitete Datei mit dem Namen der neuen Datei vom Server: das Zusammenführen würde sie überschreiben
  const serverKopf = kopfRemote(remote);
  const r = B.abgleichen(mac, { support });
  assert.equal(r.art, "ungesichert", r.text);
  assert.equal(r.ok, false);
  assert.equal(kopfRemote(remote), serverKopf);
  assert.equal(lies(mac, "00_inbox/a.md"), "# A\nUngesichert\n", "die ungesicherte Fassung bleibt");
  assert.equal(existsSync(join(mac, ".git", "MERGE_HEAD")), false);
});

test("regelmäßiges Holen: Fast-Forward, wenn der Arbeitsbaum sauber ist; der Stand „Neues“ verschwindet danach", () => {
  const { remote, mac, handy, support } = aufbau();
  commit(handy, "05_aufgaben/vom-handy.md", "---\nstatus: offen\n---\n# Vom Handy\n"); g(handy, "push", "-q");
  const r = B.holen(mac, { support });
  assert.equal(r.art, "geholt");
  assert.equal(kopf(mac), kopfRemote(remote));
  assert.match(lies(mac, "05_aufgaben/vom-handy.md"), /Vom Handy/);
  assert.equal(stand(mac, support), null);
  assert.equal(B.holen(mac, { support }).art, "aktuell");
});

test("regelmäßiges Holen mit unsauberem Arbeitsbaum: nur ein Hinweis, nichts wird verändert", async () => {
  const { remote, mac, handy, support } = aufbau();
  commit(handy, "05_aufgaben/neu.md", "# Neu\n"); g(handy, "push", "-q");
  const vorher = kopf(mac);
  // a) geänderte, nicht eingearbeitete Datei (nicht einmal dieselbe Datei)
  schreibe(mac, "00_inbox/lokal.md", "# Lokal\n");
  const r = B.holen(mac, { support });
  assert.equal(r.art, "neues");
  assert.equal(r.ok, false);
  assert.equal(kopf(mac), vorher, "HEAD unverändert");
  assert.equal(existsSync(join(mac, "05_aufgaben", "neu.md")), false, "nichts in den Arbeitsbaum geholt");
  assert.equal(lies(mac, "00_inbox/lokal.md"), "# Lokal\n");
  assert.equal(stand(mac, support).stand, "neues");
  assert.equal(stand(mac, support).text, "Auf dem Server liegt Neues – im Studio abgleichen");
  const st = await brainStatus(mac, { support });
  assert.equal(st.zustand, "hinweis");
  assert.equal(st.meldungen[0], "Auf dem Server liegt Neues – im Studio abgleichen");
  // b) beide Seiten haben Neues (eigener Commit): ebenfalls nur ein Hinweis, kein Zusammenführungs-Commit
  g(mac, "add", "--", "00_inbox/lokal.md"); g(mac, "commit", "-q", "-m", "lokal");
  const eigen = kopf(mac);
  assert.equal(B.holen(mac, { support }).art, "neues");
  assert.equal(kopf(mac), eigen);
  // c) danach sendet/holt die Sicherung beides, und der Hinweis ist weg
  assert.equal(B.abgleichen(mac, { support }).art, "beides");
  assert.equal(stand(mac, support), null);
  assert.equal(kopfRemote(remote), kopf(mac));
});

test("Holen nur mit bestätigtem Remote; höchstens alle 10 Minuten", () => {
  const { remote, mac, handy, support } = aufbau();
  commit(handy, "05_aufgaben/x.md", "# X\n"); g(handy, "push", "-q");
  const t0 = Date.parse("2026-10-30T10:00:00Z");
  // erst: kein bestätigtes Ziel → nichts geholt
  const lokalerStand = g(mac, "rev-parse", "refs/remotes/origin/main").trim();
  const fremd = join(support, "fremd");
  mkdirSync(fremd);
  assert.equal(B.holen(mac, { support: fremd }).art, "nicht-bestaetigt");
  assert.equal(g(mac, "rev-parse", "refs/remotes/origin/main").trim(), lokalerStand, "ohne Bestätigung nicht einmal gefetcht");
  // mit Bestätigung: das erste Mal holt, das zweite innerhalb von 10 Minuten nicht, danach wieder
  assert.equal(B.holenGedrosselt(mac, { support, jetzt: t0 }).art, "geholt");
  commit(handy, "05_aufgaben/y.md", "# Y\n"); g(handy, "push", "-q");
  assert.equal(B.holenGedrosselt(mac, { support, jetzt: t0 + 5 * 60000 }).art, "uebersprungen");
  assert.equal(existsSync(join(mac, "05_aufgaben", "y.md")), false);
  assert.equal(B.holenGedrosselt(mac, { support, jetzt: t0 + 11 * 60000 }).art, "geholt");
  assert.equal(kopf(mac), kopfRemote(remote));
  assert.equal(g(mac, "status", "--porcelain").trim(), "", "das Merken der Zeit macht den Arbeitsbaum nicht unsauber");
});

test("Fehlerarten: kein Netz · abgelehnt · Anmeldung · Konflikt — jede mit eigener Meldung", () => {
  // Zuordnung der Git-Ausgabe
  const faelle = [
    ["fatal: unable to access 'https://github.com/u/r.git/': Could not resolve host: github.com", "netz"],
    ["fatal: unable to access 'https://x/': Failed to connect to x port 443 after 10 ms: Couldn't connect to server", "netz"],
    ["ssh: connect to host github.com port 22: Network is unreachable\nfatal: Could not read from remote repository.", "netz"],
    ["fatal: unable to access 'https://x/': Connection timed out", "netz"],
    ["To https://github.com/u/r.git\n ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs", "abgelehnt"],
    ["! [rejected] main -> main (non-fast-forward)", "abgelehnt"],
    [" ! [remote rejected] main -> main (protected branch hook declined)", "abgelehnt"],
    ["remote: error: GH006: Protected branch update failed", "abgelehnt"],
    ["remote: Invalid username or password.\nfatal: Authentication failed for 'https://github.com/u/r.git/'", "anmeldung"],
    ["fatal: could not read Username for 'https://github.com': terminal prompts disabled", "anmeldung"],
    ["git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.", "anmeldung"],
    ["remote: Repository not found.\nfatal: repository 'https://github.com/u/r.git/' not found", "anmeldung"],
    ["fatal: unable to access 'https://github.com/u/r.git/': The requested URL returned error: 403", "anmeldung"],
    ["error: cannot open '.git/FETCH_HEAD': Permission denied", "fehler"],
    ["git-sicher: git ist für diesen Ordner gesperrt: die Konfiguration enthält x", "gesperrt"],
    ["remote: Permission to u/r.git denied to anna.", "anmeldung"],
    ["irgendetwas Unbekanntes", "fehler"],
    ["", "fehler"],
  ];
  for (const [text, art] of faelle) assert.equal(B.gitFehlerArt(text), art, text);
});

test("Fehlerart kein Netz (Server nicht erreichbar): keine Anmeldung, kein Konflikt, kein Stand; Meldung nennt das Internet", () => {
  const { mac, support } = aufbau();
  g(mac, "remote", "set-url", "origin", "https://127.0.0.1:1/u/r.git");
  B.bestaetigeRemote(mac, "https://127.0.0.1:1/u/r.git", { support });
  commit(mac, "00_inbox/x.md", "# X\n");
  const r = B.abgleichen(mac, { support });
  assert.equal(r.art, "netz", r.text);
  assert.match(r.text, /nicht erreichbar \(kein Internet\?\)/);
  assert.equal(stand(mac, support), null);
  assert.doesNotMatch(r.text, /127\.0\.0\.1/, "keine Adresse im Text");
});

test("Fehlerart abgelehnt: der Server weist das Senden ab (Hook auf dem Server) — kein Stand, Meldung „abgelehnt“", () => {
  const { remote, mac, support } = aufbau();
  const hook = join(remote, "hooks", "pre-receive");
  writeFileSync(hook, "#!/bin/sh\necho 'protected branch hook declined' >&2\nexit 1\n");
  chmodSync(hook, 0o755);
  commit(mac, "00_inbox/x.md", "# X\n");
  const serverKopf = kopfRemote(remote);
  const r = B.abgleichen(mac, { support });
  assert.equal(r.art, "abgelehnt", r.text);
  assert.match(r.text, /Server hat die Online-Sicherung abgelehnt/);
  assert.equal(kopfRemote(remote), serverKopf);
  assert.equal(stand(mac, support), null);
});

test("Fehlerart Anmeldung bei der Online-Sicherung setzt den Stand „Anmeldung nötig“ (Hinweis in der Menüleiste), der nächste Erfolg räumt ihn weg", async () => {
  const { remote, mac, support } = aufbau();
  // eine Anmeldung lässt sich ohne Netz nicht auslösen: der Stand wird wie vom Holen gesetzt und vom nächsten Erfolg gelöscht
  const d = JSON.parse(readFileSync(B.merkerDateiFuer(mac, support), "utf8"));
  d.abgleich = { stand: "anmeldung", zeit: new Date().toISOString() };
  writeFileSync(B.merkerDateiFuer(mac, support), JSON.stringify(d) + "\n");
  assert.equal(stand(mac, support).text, "Anmeldung für die Online-Sicherung nötig");
  assert.equal((await brainStatus(mac, { support })).zustand, "hinweis");
  assert.equal(B.abgleichen(mac, { support }).art, "aktuell");
  assert.equal(stand(mac, support), null);
  assert.equal(JSON.parse(readFileSync(B.merkerDateiFuer(mac, support), "utf8")).remoteBestaetigt, remote, "die Bestätigung des Ziels bleibt erhalten");
});

test("ohne eigene Git-Identität (frischer Rechner) gelingt das Zusammenführen trotzdem", () => {
  const { remote, mac, handy, support } = aufbau();
  commit(handy, "00_inbox/vom-handy.md", "# Handy\n"); g(handy, "push", "-q");
  commit(mac, "00_inbox/vom-mac.md", "# Mac\n");
  const alt = { ...process.env };
  for (const k of ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"]) delete process.env[k];
  try {
    const r = B.abgleichen(mac, { support });
    assert.equal(r.art, "beides", r.text);
  } finally { Object.assign(process.env, alt); }
  assert.equal(kopfRemote(remote), kopf(mac));
  assert.equal(g(mac, "log", "-1", "--format=%an").trim(), "Kortex");
  assert.throws(() => g(mac, "config", "--get", "user.email"), "die Identität wird nicht dauerhaft in die Konfiguration geschrieben");
});

test("Umleitungen aus der Vault-Konfiguration (pushurl, anderes Remote als Upstream) werden nicht befolgt: nichts geholt, nichts gesendet", () => {
  const a = aufbau();
  const fremdesRemote = join(a.basis, "fremd.git");
  g(a.basis, "init", "-q", "--bare", "-b", "main", fremdesRemote);
  commit(a.mac, "00_inbox/x.md", "# X\n");
  g(a.mac, "config", "remote.origin.pushurl", fremdesRemote);
  const r = B.abgleichen(a.mac, { support: a.support });
  assert.equal(r.art, "umgeleitet", r.text);
  assert.equal(kopfRemote(a.remote), g(a.handy, "rev-parse", "HEAD").trim(), "origin unverändert");
  assert.throws(() => g(fremdesRemote, "rev-parse", "refs/heads/main"), "das fremde Ziel bekam nichts");
  assert.equal(B.holen(a.mac, { support: a.support }).art, "umgeleitet");
  g(a.mac, "config", "--unset", "remote.origin.pushurl");
  // Upstream auf ein anderes Remote
  g(a.mac, "remote", "add", "evil", fremdesRemote);
  g(a.mac, "config", "branch.main.remote", "evil");
  assert.equal(B.abgleichen(a.mac, { support: a.support }).art, "umgeleitet");
  assert.throws(() => g(fremdesRemote, "rev-parse", "refs/heads/main"));
});

test("ein anderer Fetch-Refspec in der Konfiguration überschreibt keine lokalen Zweige; der Upstream bleibt", () => {
  const { mac, handy, support } = aufbau();
  g(mac, "branch", "arbeit");
  const arbeit = g(mac, "rev-parse", "arbeit").trim();
  g(mac, "config", "remote.origin.fetch", "+refs/heads/*:refs/heads/*");
  commit(handy, "00_inbox/h.md", "# H\n"); g(handy, "push", "-q");
  assert.equal(B.abgleichen(mac, { support }).art, "geholt");
  assert.equal(g(mac, "rev-parse", "arbeit").trim(), arbeit, "andere lokale Zweige bleiben");
  assert.equal(g(mac, "config", "--get", "branch.main.merge").trim(), "refs/heads/main");
});

test("laufende Einarbeitung (frische Sperre .logs/ingest.lock): der Hintergrund fasst den Arbeitsbaum nicht an", () => {
  const { mac, handy, support } = aufbau();
  commit(handy, "00_inbox/h.md", "# H\n"); g(handy, "push", "-q");
  mkdirSync(join(mac, ".logs"), { recursive: true });
  writeFileSync(join(mac, ".logs", "ingest.lock"), "ingest 1\n");
  const vorher = kopf(mac);
  assert.equal(B.holen(mac, { support }).art, "beschaeftigt");
  assert.equal(B.abgleichen(mac, { support }).art, "beschaeftigt");
  assert.equal(kopf(mac), vorher);
});

test("der Zweig ist auf dem Server neu: wird mit -u angelegt und gesendet", () => {
  const { remote, mac, support } = aufbau();
  g(mac, "checkout", "-q", "-b", "geraet-zwei");
  commit(mac, "00_inbox/z.md", "# Z\n");
  const r = B.abgleichen(mac, { support });
  assert.equal(r.art, "gesendet", r.text);
  assert.equal(g(remote, "rev-parse", "refs/heads/geraet-zwei").trim(), kopf(mac));
});

// ── Sitzungsstart (session-hintergrund.mjs): holt, führt zusammen, sendet; bei Konflikt nicht und ohne die Sicherung als erledigt zu merken ──
async function hintergrund(mac, support) {
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(process.execPath, [join(KERN, "adapters", "claude-code", "session-hintergrund.mjs")], {
    env: { ...process.env, BRAIN_VAULT: mac, BRAIN_APP_SUPPORT: support, HOME }, encoding: "utf8", timeout: 120_000 });
  assert.equal(r.status, 0, r.stderr);
  const log = join(mac, ".logs", "hooks.log");
  return existsSync(log) ? readFileSync(log, "utf8") : "";
}

test("Sitzungsstart: nach einem fremden Commit holt er, führt zusammen und sendet; die Sicherung gilt dann als erledigt", async () => {
  const { remote, mac, handy, support } = aufbau();
  commit(handy, "05_aufgaben/vom-handy.md", "# Vom Handy\n"); g(handy, "push", "-q");
  commit(mac, "00_inbox/vom-mac.md", "# Mac\n");
  const log = await hintergrund(mac, support);
  assert.match(log, /Sicherung: beides — Online gesichert\./);
  assert.equal(kopfRemote(remote), kopf(mac));
  assert.ok(existsSync(join(mac, "05_aufgaben", "vom-handy.md")));
  assert.equal(JSON.parse(readFileSync(join(mac, ".logs", "sicherung.json"), "utf8")).head, kopf(mac));
});

test("Sitzungsstart bei Konflikt: nichts gesendet, Stand gesetzt, die Sicherung wird nicht als erledigt gemerkt (nächster Start versucht es erneut)", async () => {
  const { remote, mac, handy, support } = aufbau();
  commit(handy, "00_inbox/gemeinsam.md", "# G\nHandy\n"); g(handy, "push", "-q");
  const serverKopf = kopfRemote(remote);
  commit(mac, "00_inbox/gemeinsam.md", "# G\nMac\n");
  const log = await hintergrund(mac, support);
  assert.match(log, /Sicherung: konflikt — .*Konflikt – im Studio lösen/);
  assert.equal(kopfRemote(remote), serverKopf);
  assert.equal(existsSync(join(mac, ".logs", "sicherung.json")), false);
  assert.equal(stand(mac, support).stand, "konflikt");
  assert.equal(existsSync(join(mac, ".git", "MERGE_HEAD")), false);
});

test("Sitzungsstart holt auch ohne eigene Änderung: Fast-Forward bei sauberem Arbeitsbaum, Aufgabe vom Handy ist da", async () => {
  const { remote, mac, handy, support } = aufbau();
  commit(handy, "05_aufgaben/vom-handy.md", "---\nstatus: offen\n---\n# Vom Handy\n"); g(handy, "push", "-q");
  await hintergrund(mac, support);
  assert.equal(kopf(mac), kopfRemote(remote));
  assert.match(lies(mac, "05_aufgaben/vom-handy.md"), /Vom Handy/);
});
