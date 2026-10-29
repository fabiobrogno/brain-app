// Tests zu den Befunden des Opus-Reviews Studio v2, Paket „node“ (Vertrauen v2, Spec §8): Nichts aus einem Vault startet ein Programm, bevor dem
// Vault vertraut wurde — und nichts geht still verloren. Jeder Test trägt den Schlüssel des Befunds im Titel und schlägt ohne die Korrektur fehl;
// die „Vorproben“ zeigen, dass der Aufbau wirkt (ein ungehärtetes git, ein ungeschütztes Dateisystem tut tatsächlich, was der Befund beschreibt).
// Nur Wegwerf-Ordner in os.tmpdir(); kein Netzwerk (Adressen unter example.invalid), nie das echte `claude`, nie der echte Support-Ordner.
//
//   vertrauen-node/K1  gpg.ssh.defaultKeyCommand sperrt Git · K2 package.json, node_modules, Ordner-Verweise im Fingerabdruck · K3 Abgleich ohne Hooks
//   vertrauen-node/W1  BRAIN_VAULT · k1 Merker-Schlüssel (Groß/klein, Unicode) · swift-k1/SW-1 brain.config.json im Fingerabdruck
//   luecken/VK-1 Submodule · VK-2 relative PATH-Einträge · VK-3 Git-Konfiguration im Fingerabdruck
//   vaults/V1 Klonen mit der ssh-Einstellung des Nutzers · V2 SIGTERM beim Anlegen · V3 Rücknahme nur leerer Elternordner · V4 kaputte vertrauen.json
//   git-haertung/B2 (wie V1) · Vertragsänderung 1: POST /api/kit/vertrauen { erlauben, vault }
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, chmodSync, symlinkSync, utimesSync, readdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { createInterface } from "node:readline";
import { tmp, schreibe, repo, g, pfad, kernAttrappe, brainVault } from "./hilfe.mjs";
process.env.HOME = tmp("brain-home-");          // os.homedir() liest $HOME: keine echte ~/.gitconfig
process.env.GIT_CONFIG_NOSYSTEM = "1";          // und keine System-Konfiguration
for (const w of ["AUTHOR", "COMMITTER"]) { process.env[`GIT_${w}_NAME`] = "Test"; process.env[`GIT_${w}_EMAIL`] = "test@example.org"; }   // der CI-Runner hat keine Git-Identität
for (const k of ["GIT_CONFIG_GLOBAL", "XDG_CONFIG_HOME", "GIT_SSH_COMMAND", "BRAIN_VAULT"]) delete process.env[k];

const { HttpFehler, bereinigterPfad, bereinigePfad, kindUmgebung, absoluterGitPfad } = await import(pfad("gemeinsam", "basis.mjs"));
const V = await import(pfad("gemeinsam", "vertrauen.mjs"));
const { oeffneVault } = await import(pfad("gemeinsam", "vault.mjs"));
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
const { git, gitUmgebung } = await import(pfad("gemeinsam", "git.mjs"));
const Vaults = await import(pfad("gemeinsam", "vaults.mjs"));

const wirft = async (p) => { try { await p; } catch (e) { assert.ok(e instanceof HttpFehler, String(e && e.stack)); return e; } assert.fail("kein Fehler"); };
const neuerSupport = () => tmp("brain-support-");
const KIT = `console.log(JSON.stringify({version:1,ampel:"gruen",warnungen:0,pruefungen:[]}));\n`;
const kitVault = () => { const d = tmp(); schreibe(d, ".tools/brain.mjs", KIT); schreibe(d, "a.md", "# A\n"); return d; };
const merkerVon = (support) => JSON.parse(readFileSync(join(support, "vertrauen.json"), "utf8"));
const aufruf = (h) => async (methode, p, daten, query) => {
  const r = await h({ methode, pfad: p, query: query ?? null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) });
  let j = null; try { j = JSON.parse(r.body.toString("utf8")); } catch { /* statisch */ }
  return { ...r, j };
};
const skript = (inhalt) => { const p = join(tmp("brain-skript-"), "s.sh"); writeFileSync(p, `#!/bin/sh\n${inhalt}\n`); chmodSync(p, 0o755); return p; };
const konfig = (d, text) => appendFileSync(join(d, ".git", "config"), text); // roh angehängt: so kommt eine fremde .git/config an
const mitSupport = (d, support = neuerSupport(), extra = {}) => oeffneVault(d, { support, ...extra });
const bareRepo = () => { const b = tmp("brain-bare-"); g(b, "init", "-q", "--bare", "-b", "main"); return b; };
const warteBis = async (f, ms = 3000) => { const ende = Date.now() + ms; while (Date.now() < ende) { if (f()) return true; await new Promise((r) => setTimeout(r, 25)); } return f(); };
const lebt = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const mitPfadVorn = async (dir, fn) => { const alt = process.env.PATH; process.env.PATH = `${dir}:${alt}`; try { return await fn(); } finally { process.env.PATH = alt; } };
const echtesGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
const cli = (args, env = {}) => spawnSync(process.execPath, [pfad("werkstatt", "vertrauen-pruefen.mjs"), ...args], { encoding: "utf8", env: { ...process.env, ...env } });
const marke = (name) => join(tmp("brain-marke-"), name); // Pfad einer Markerdatei: sie entsteht nur, wenn das Programm läuft

// ───────────────────────────── K1: gpg.ssh.defaultKeyCommand ─────────────────────────────

test("vertrauen-node/K1: gpg.ssh.defaultKeyCommand sperrt Git — der Befehl läuft ohne Vertrauen nie (Commit 409), nach dem Erlauben wie konfiguriert", async () => {
  const d = repo();
  const m = marke("DEFAULTKEYCOMMAND");
  konfig(d, `[commit]\n\tgpgSign = true\n[gpg]\n\tformat = ssh\n[gpg "ssh"]\n\tdefaultKeyCommand = "touch '${m}'"\n`);
  // Vorprobe: ein ungehärtetes git ruft den Befehl beim Commit auf (user.signingKey fehlt) — sonst beweist der Test nichts
  try { g(d, "commit", "--allow-empty", "-q", "-m", "x"); } catch { /* scheitert: der Befehl liefert keinen Schlüssel */ }
  assert.equal(existsSync(m), true, "Vorprobe: git startet gpg.ssh.defaultKeyCommand aus der Vault-Konfiguration");
  rmSync(m);
  const support = neuerSupport();
  const s = V.gitSicht(d, { support });
  assert.equal(s.gesperrt, true); assert.equal(s.vertraut, false); assert.match(s.grund, /gpg\.ssh\.defaultkeycommand/i);
  const rufe = aufruf(erzeugeHandler({ vault: d, vaultOptionen: { support } }));
  schreibe(d, "a.md", "# a\n");
  let r = await rufe("POST", "/api/git/commit", { nachricht: "x", dateien: ["a.md"] });
  assert.equal(r.status, 409); assert.equal(r.j.gitGesperrt, true); assert.match(r.j.fehler, /gesperrt/);
  assert.equal(existsSync(m), false, "der Befehl aus dem Vault lief nie");
  r = await rufe("GET", "/api/info");
  assert.equal(r.j.vertrauen.gitGesperrt, true);
  assert.ok(r.j.vertrauen.gruende.some((x) => x.art === "git" && /defaultkeycommand/i.test(x.text)), "die Oberfläche nennt den Grund");
  // Der Nutzer hat die Frage gesehen und freigegeben: jetzt gilt die Konfiguration des Vaults wie gewohnt.
  r = await rufe("POST", "/api/kit/vertrauen", { erlauben: true, vault: d });
  assert.equal(r.j.vertrauen.gitGesperrt, false);
  await rufe("POST", "/api/git/commit", { nachricht: "y", dateien: ["a.md"] });
  assert.equal(existsSync(m), true, "mit Vertrauen läuft der Befehl (der Nutzer hat der Einstellung vertraut)");
});

test("vertrauen-node/K1: jeder Programmschlüssel unter gpg. sperrt (auch gpg.ssh.…command/…program und künftige), Dateien und Formate nicht", () => {
  const gesperrt = (zeilen) => { const d = repo(); konfig(d, zeilen); return V.gitSicht(d, { support: neuerSupport() }).gesperrt; };
  for (const zeilen of ['[gpg "ssh"]\n\tdefaultKeyCommand = /bin/echo\n', '[gpg "ssh"]\n\tprogram = /bin/echo\n', '[gpg]\n\tprogram = /bin/echo\n', '[gpg "x509"]\n\tprogram = /bin/echo\n',
    '[gpg "openpgp"]\n\tprogram = /bin/echo\n', '[gpg "ssh"]\n\tsomeFutureCommand = /bin/echo\n']) assert.equal(gesperrt(zeilen), true, zeilen);
  for (const zeilen of ["[gpg]\n\tformat = ssh\n", '[gpg "ssh"]\n\tallowedSignersFile = /tmp/signers\n', '[gpg "ssh"]\n\trevocationFile = /tmp/rev\n', "[commit]\n\tgpgSign = true\n", "[user]\n\tsigningKey = ABCDEF\n"]) {
    assert.equal(gesperrt(zeilen), false, `${zeilen.trim()} startet kein Programm`);
  }
  const d = repo(); konfig(d, '[gpg "ssh"]\n\tdefaultKeyCommand = /bin/echo\n');
  assert.deepEqual(V.gefaehrlicheSchluessel(V.liesGitKonfiguration(d, { frisch: true }).eintraege), ["gpg.ssh.defaultkeycommand"]);
});

test("vertrauen-node/K1: ohne Vertrauen signiert Git nicht aus der Vault-Konfiguration (kein Programm); die Einstellung des Nutzers (global) bleibt; mit Vertrauen wie konfiguriert", async () => {
  const bin = tmp("brain-bin-"), lief = join(bin, "KEYGEN-LIEF"); // Attrappe für ssh-keygen: Git ruft sie auf, sobald es SSH-signiert
  writeFileSync(join(bin, "ssh-keygen"), `#!/bin/sh\necho "$*" >> '${lief}'\nexit 1\n`); chmodSync(join(bin, "ssh-keygen"), 0o755);
  const SCHLUESSEL = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICbsyW1AtEgE8Zq5Ntk3sCgb1jtbWoP2DzzGxBnfT2bM";
  const signieren = `[commit]\n\tgpgSign = true\n[tag]\n\tgpgSign = true\n[gpg]\n\tformat = ssh\n[user]\n\tsigningKey = ${SCHLUESSEL}\n`;
  const alt = process.env.GIT_CONFIG_GLOBAL;
  try {
    await mitPfadVorn(bin, async () => {
      // (a) nur die Vault-Konfiguration will signieren
      const d = repo(); konfig(d, signieren);
      const support = neuerSupport();
      const v = mitSupport(d, support);
      schreibe(d, "a.md", "# a\n");
      const ok = await v.gitCommit({ nachricht: "ohne Signatur", dateien: ["a.md"] });
      assert.match(ok.sha, /^[0-9a-f]{40}$/, "der Commit gelingt ohne Signatur");
      assert.equal(existsSync(lief), false, "ohne Vertrauen ruft Git ssh-keygen nicht auf (commit.gpgSign aus dem Vault ist ausgeschaltet)");
      assert.ok(!g(d, "cat-file", "-p", "HEAD").includes("gpgsig"), "unsigniert");
      v.vertrauen(true);
      schreibe(d, "b.md", "# b\n");
      await wirft(v.gitCommit({ nachricht: "mit Vertrauen", dateien: ["b.md"] })); // die Attrappe lässt das Signieren scheitern
      assert.equal(existsSync(lief), true, "mit Vertrauen gilt die Konfiguration: Git ruft ssh-keygen");
      rmSync(lief);
      // (b) der Nutzer hat selbst eingestellt, dass signiert wird (global): das gilt auch ohne Vertrauen — wir ersetzen nur die Einstellung des Vaults
      const globalDatei = join(tmp("brain-gcfg-"), "gitconfig");
      writeFileSync(globalDatei, `[user]\n\tname = T\n\temail = t@example.org\n${signieren}`);
      process.env.GIT_CONFIG_GLOBAL = globalDatei;
      const d2 = repo();
      const support2 = neuerSupport();
      assert.deepEqual(V.gitSicht(d2, { support: support2 }).gpgGlobal, { commit: "true", tag: "true" });
      const v2 = mitSupport(d2, support2);
      schreibe(d2, "a.md", "# a\n");
      await wirft(v2.gitCommit({ nachricht: "der Nutzer will signieren", dateien: ["a.md"] }));
      assert.equal(existsSync(lief), true, "die eigene Einstellung des Nutzers bleibt wirksam");
    });
  } finally { if (alt === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = alt; }
});

// ───────────────────────────── K2: Umfang des Fingerabdrucks ─────────────────────────────

test("vertrauen-node/K2 (a): package.json unter .tools lenkt den geladenen Code um — eine Änderung nach der Freigabe ist eine neue Frage (für Hooks, die .tools starten)", async () => {
  const d = tmp();
  const marken = tmp("brain-marke-"), gut = join(marken, "GUT"), boese = join(marken, "BOESE");
  const kitSkript = (m) => `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(m)}, "1");\nconsole.log(JSON.stringify({ version: 1, ampel: "gruen", warnungen: 0, pruefungen: [] }));\n`;
  schreibe(d, ".tools/gut.mjs", kitSkript(gut)); schreibe(d, ".tools/boese.mjs", kitSkript(boese));
  schreibe(d, ".tools/brain.mjs", 'await import("#start");\n'); // lädt über den Alias aus der package.json
  const pkg = (ziel) => schreibe(d, ".tools/package.json", JSON.stringify({ type: "module", imports: { "#start": `./${ziel}` } }) + "\n");
  pkg("gut.mjs");
  const support = neuerSupport();
  const v = mitSupport(d, support);
  v.vertrauen(true);
  assert.equal(V.pruefeVertrauen(d, { support }).erlaubt, true);
  pkg("boese.mjs"); // NUR die package.json ändert sich — beide Zieldateien standen schon in der Freigabe
  const p = V.pruefeVertrauen(d, { support });
  assert.equal(p.erlaubt, false); assert.equal(p.geaendert, true);
  assert.equal(existsSync(gut) || existsSync(boese), false, "die App führt .tools nie aus (Kern-Umzug P4)");
  v.vertrauen(true);
  assert.equal(V.pruefeVertrauen(d, { support }).erlaubt, true);
  schreibe(d, ".tools/lib/package.json", '{"type":"commonjs"}\n'); // auch in Unterordnern
  assert.equal(V.pruefeVertrauen(d, { support }).geaendert, true, "neue package.json in einem Unterordner");
  v.vertrauen(true);
  schreibe(d, ".tools/lib/package.json", '{"type":"module"}\n');
  assert.equal(V.pruefeVertrauen(d, { support }).geaendert, true, "geänderte package.json in einem Unterordner");
});

test("vertrauen-node/K2 (c): Ordner-Verweise unter .tools zählen mit dem Inhalt ihres Ziels — auch außerhalb des Vaults; ein Kreis hängt nicht", () => {
  const support = neuerSupport();
  const d = kitVault();
  const draussen = tmp("brain-aus-"); schreibe(draussen, "lib/x.mjs", "// 1\n");
  schreibe(d, "extern/y.mjs", "// 1\n");
  symlinkSync(join(draussen, "lib"), join(d, ".tools/lib"));  // Ordner-Verweis nach außerhalb des Vaults
  symlinkSync("../extern", join(d, ".tools/extern"));         // relativer Ordner-Verweis in einen anderen Ordner des Vaults
  symlinkSync(".", join(d, ".tools/schleife"));               // Kreis: zeigt auf seinen eigenen Ordner
  V.erlaube(d, { support });
  assert.equal(V.pruefeVertrauen(d, { support }).erlaubt, true);
  schreibe(draussen, "lib/x.mjs", "// 2 — ausgetauscht\n");
  assert.equal(V.pruefeVertrauen(d, { support }).geaendert, true, "Inhalt des Ziels außerhalb des Vaults geändert");
  V.erlaube(d, { support });
  schreibe(draussen, "lib/neu.mjs", "// neu\n");
  assert.equal(V.pruefeVertrauen(d, { support }).geaendert, true, "neue Datei im Ziel");
  V.erlaube(d, { support });
  schreibe(d, "extern/y.mjs", "// 2\n");
  assert.equal(V.pruefeVertrauen(d, { support }).geaendert, true, "Ziel innerhalb des Vaults (relativer Verweis)");
  V.erlaube(d, { support });
  rmSync(join(d, ".tools/lib")); symlinkSync(join(draussen, "anderer-ordner"), join(d, ".tools/lib")); // Verweis umgebogen (hier ins Leere)
  assert.equal(V.pruefeVertrauen(d, { support }).geaendert, true, "anderes Ziel");
});

// ───────────────────────────── K3: Abgleich ohne Hooks, Vertrauen danach neu bewerten ─────────────────────────────

// Kit-Vault wie das echte Brain: Hook-Ordner .tools/git-hooks (core.hooksPath), ein Server (bare) und ein Autor, der dorthin schiebt.
// pre-push und reference-transaction schreiben je eine Markerdatei — sie gehören zur Freigabe, laufen also nach dem Erlauben wie gewohnt.
function kitMitServer() {
  const bare = bareRepo();
  const autor = repo(); g(autor, "remote", "add", "origin", bare);
  const marken = tmp("brain-marke-");
  const hook = (rel, inhalt) => { schreibe(autor, rel, `#!/bin/sh\n${inhalt}\n`); chmodSync(join(autor, rel), 0o755); };
  schreibe(autor, ".tools/brain.mjs", KIT);
  hook(".tools/git-hooks/pre-push", `echo x >> '${join(marken, "PRE-PUSH")}'`);
  hook(".tools/git-hooks/reference-transaction", `echo x >> '${join(marken, "REF-TRANSACTION")}'`);
  g(autor, "add", "--", ".tools"); g(autor, "commit", "-q", "-m", "Kit"); g(autor, "push", "-q", "-u", "origin", "main");
  const vault = tmp("brain-klon-"); g(vault, "clone", "-q", bare, "."); g(vault, "config", "user.name", "V"); g(vault, "config", "user.email", "v@example.org");
  g(vault, "config", "core.hooksPath", ".tools/git-hooks");
  const neuerHook = (name) => { // der Server schiebt einen neuen Hook nach
    g(autor, "pull", "-q", "--ff-only"); // der Autor kennt, was der Vault inzwischen gesendet hat
    hook(`.tools/git-hooks/${name}`, `touch '${join(marken, name.toUpperCase())}'`);
    g(autor, "add", "--", ".tools"); g(autor, "commit", "-q", "-m", `neuer Hook ${name}`); g(autor, "push", "-q");
  };
  const lief = (name) => existsSync(join(marken, name));
  const weg = (name) => rmSync(join(marken, name), { force: true });
  return { bare, autor, vault, neuerHook, lief, weg };
}

test("vertrauen-node/K3: Abgleich in einem vertrauten Vault — ein vom Server geholter post-merge-Hook läuft NICHT; danach ist das Vertrauen weg (vertrauenGeaendert)", async () => {
  // Vorprobe: ein ungehärteter Abgleich (pull mit Hooks, wie vorher) führte den neuen Hook sofort aus
  const roh = kitMitServer();
  roh.neuerHook("post-merge");
  g(roh.vault, "pull", "-q", "--ff-only");
  assert.equal(roh.lief("POST-MERGE"), true, "Vorprobe: der Hook aus core.hooksPath läuft bei einem Abgleich mit Hooks");

  const s = kitMitServer();
  const support = neuerSupport();
  const v = mitSupport(s.vault, support);
  v.vertrauen(true);
  assert.equal(V.pruefeVertrauen(s.vault, { support }).erlaubt, true);
  s.weg("REF-TRANSACTION"); s.weg("PRE-PUSH");
  s.neuerHook("post-merge");
  const r = await v.gitSync();
  assert.equal(r.ergebnis, "geholt");
  assert.equal(s.lief("POST-MERGE"), false, "der geholte Hook lief nie — Holen und Zusammenführen laufen immer ohne Hooks");
  assert.equal(s.lief("REF-TRANSACTION"), false, "auch die Hooks des vertrauten Stands laufen beim Abgleich nicht (nur beim Senden)");
  assert.equal(r.vertrauenGeaendert, true, "das Ergebnis meldet: die Freigabe gilt nicht mehr");
  const p = V.pruefeVertrauen(s.vault, { support });
  assert.equal(p.erlaubt, false); assert.equal(p.geaendert, true); assert.ok(p.gruende.some((x) => x.art === "hooks"));
  // Der Hook läuft auch später nicht, solange nicht neu freigegeben wurde (Commit in einem nicht mehr vertrauten Vault: keine Hooks)
  schreibe(s.vault, "n.md", "# n\n");
  await v.gitCommit({ nachricht: "ohne Freigabe", dateien: ["n.md"] });
  assert.equal(s.lief("POST-MERGE"), false);
});

test("vertrauen-node/K3: ging das Vertrauen durch den Abgleich verloren, wird nichts gesendet (pre-push wäre neuer Code); nach neuer Freigabe sendet der nächste Abgleich — mit Hooks wie gewohnt", async () => {
  const s = kitMitServer();
  const support = neuerSupport();
  const v = mitSupport(s.vault, support);
  v.vertrauen(true);
  // Kontrolle: ohne Änderung am Stand laufen die Hooks beim Senden wie gewohnt, kein Hinweis
  schreibe(s.vault, "eins.md", "# 1\n"); g(s.vault, "add", "--", "eins.md"); g(s.vault, "commit", "-q", "-m", "lokal 1");
  s.weg("PRE-PUSH");
  let r = await v.gitSync();
  assert.equal(r.ergebnis, "gesendet"); assert.equal(r.vertrauenGeaendert, undefined);
  assert.equal(s.lief("PRE-PUSH"), true, "pre-push läuft beim Senden mit Vertrauen wie gewohnt");
  assert.equal(g(s.bare, "rev-parse", "main").trim(), g(s.vault, "rev-parse", "HEAD").trim());
  // Jetzt: lokaler Commit UND ein neuer Hook auf dem Server → Zusammenführen, Vertrauen weg, kein Senden
  schreibe(s.vault, "zwei.md", "# 2\n"); g(s.vault, "add", "--", "zwei.md"); g(s.vault, "commit", "-q", "-m", "lokal 2");
  s.neuerHook("post-merge");
  s.weg("PRE-PUSH");
  const serverStand = g(s.bare, "rev-parse", "main").trim();
  r = await v.gitSync();
  assert.equal(r.vertrauenGeaendert, true); assert.equal(r.ergebnis, "geholt", "geholt, aber nicht gesendet");
  assert.equal(g(s.bare, "rev-parse", "main").trim(), serverStand, "der Server hat nichts bekommen");
  assert.equal(s.lief("PRE-PUSH"), false, "der neue (nicht freigegebene) Hook-Stand läuft nicht");
  assert.equal(s.lief("POST-MERGE"), false);
  // Der Nutzer prüft und gibt den neuen Stand frei: der nächste Abgleich sendet, die Hooks laufen wie gewohnt
  v.vertrauen(true);
  r = await v.gitSync();
  assert.equal(r.ergebnis, "gesendet"); assert.equal(r.vertrauenGeaendert, undefined);
  assert.equal(s.lief("PRE-PUSH"), true);
  assert.equal(g(s.bare, "rev-parse", "main").trim(), g(s.vault, "rev-parse", "HEAD").trim());
});

// ───────────────────────────── W1: BRAIN_VAULT ─────────────────────────────

test("vertrauen-node/W1: nach einem Vault-Wechsel arbeitet der Kern (gesundheit mit --vault, rueckfragen) und jeder Git-Hook an DIESEM Vault, nicht am Startvault", async () => {
  const A = tmp("brain-start-");
  const B = brainVault(repo("brain-wechsel-"));
  const m = tmp("brain-marke-");
  const kern = kernAttrappe({
    "brain.mjs": `process.stdout.write(JSON.stringify({ version: 1, ampel: "gruen", warnungen: 0, pruefungen: [], brainVault: process.env.BRAIN_VAULT || null, argVault: process.argv[process.argv.indexOf("--vault") + 1] || null, cwd: process.cwd() }));\n`,
    "rueckfragen.mjs": `import { writeFileSync } from "node:fs";\nexport const sichtbare = () => { writeFileSync(${JSON.stringify(join(m, "RF-VAULT"))}, process.env.BRAIN_VAULT || "-"); return { fragen: [], wartend: 0 }; };\n`,
  });
  schreibe(B, ".git/hooks/pre-commit", `#!/bin/sh\nprintf '%s' "$BRAIN_VAULT" > '${join(m, "HOOK-VAULT")}'\n`); chmodSync(join(B, ".git/hooks/pre-commit"), 0o755);
  const alt = process.env.BRAIN_VAULT;
  process.env.BRAIN_VAULT = A; // die Werkstatt wurde mit --vault A gestartet (Swift setzt die Variable), dann wurde in der Oberfläche zu B gewechselt
  try {
    const v = mitSupport(B, undefined, { kern });
    v.vertrauen(true);
    const ges = await v.gesundheit();
    assert.equal(ges.brainVault, v.wurzel, `der Kern arbeitet an B (nicht an ${A}): ${ges.brainVault}`);
    assert.equal(ges.argVault, v.wurzel, "ausdrückliches --vault");
    assert.equal(ges.cwd, v.wurzel);
    await v.rueckfragen();
    assert.equal(readFileSync(join(m, "RF-VAULT"), "utf8"), v.wurzel, "auch rueckfragen");
    schreibe(B, "n.md", "# n\n");
    await v.gitCommit({ nachricht: "Hook sieht B", dateien: ["n.md"] });
    assert.equal(readFileSync(join(m, "HOOK-VAULT"), "utf8"), v.wurzel, "ein Git-Hook (er startet das Kit) sieht B");
    // gitUmgebung: der Vault des Aufrufs, sonst keiner (z. B. beim Klonen) — nie der geerbte
    assert.equal(gitUmgebung({ vault: "/x/y" }).BRAIN_VAULT, "/x/y");
    assert.equal(gitUmgebung().BRAIN_VAULT, undefined);
    assert.equal(gitUmgebung({ vault: null }).BRAIN_VAULT, undefined);
  } finally { if (alt === undefined) delete process.env.BRAIN_VAULT; else process.env.BRAIN_VAULT = alt; }
});

// ───────────────────────────── k1: Merker-Schlüssel ─────────────────────────────

// Das Test-Dateisystem (APFS) unterscheidet weder Groß/klein noch Unicode-Form; auf einem anderen (z. B. ext4) gibt es den Fall nicht.
const unempfindlich = (() => {
  const b = tmp("brain-fs-"); mkdirSync(join(b, "MeinBrain")); mkdirSync(join(b, "Übung".normalize("NFC")));
  return existsSync(join(b, "meinbrain")) && existsSync(join(b, "Übung".normalize("NFD")));
})();

test("vertrauen-node/k1: Merker-Schlüssel ohne Groß/klein und Unicode-Form — erlauben, prüfen und widerrufen finden denselben Eintrag, auch über die API",
  { skip: unempfindlich ? false : "Das Dateisystem unterscheidet Groß/klein oder Unicode-Form." }, async () => {
    const basis = tmp("brain-fs-");
    const gross = join(basis, "MeinBrain"), klein = join(basis, "meinbrain");
    const nfc = join(basis, "Übung".normalize("NFC")), nfd = join(basis, "Übung".normalize("NFD"));
    for (const d of [gross, nfc]) { schreibe(d, ".tools/brain.mjs", KIT); }
    const support = neuerSupport();
    V.erlaube(gross, { support });
    assert.deepEqual(Object.keys(merkerVon(support)), [gross], "der Schlüssel ist die Schreibweise auf der Platte");
    assert.equal(V.pruefeVertrauen(klein, { support }).erlaubt, true, "dieselbe Freigabe über die andere Schreibweise (früher: erlaubt=false)");
    assert.equal(oeffneVault(klein, { support }).kit().vertraut, true);
    V.erlaube(klein, { support });
    assert.deepEqual(Object.keys(merkerVon(support)), [gross], "erneut über die andere Schreibweise: ersetzt, kein zweiter Eintrag");
    assert.equal(V.widerrufe(klein, { support }).erlaubt, false);
    assert.deepEqual(merkerVon(support), {}, "widerrufen über eine andere Schreibweise entfernt den Eintrag (früher blieb er stehen)");
    V.erlaube(nfc, { support });
    assert.equal(V.pruefeVertrauen(nfd, { support }).erlaubt, true, "NFC erlaubt, NFD geprüft");
    V.widerrufe(nfd, { support });
    assert.deepEqual(merkerVon(support), {});
    // der Widerrufspfad der Oberfläche: POST /api/kit/vertrauen { erlauben: false, vault } mit der anderen Schreibweise
    const rufe = aufruf(erzeugeHandler({ vault: gross, vaultOptionen: { support } }));
    assert.equal((await rufe("POST", "/api/kit/vertrauen", { erlauben: true, vault: gross })).j.vertrauen.erlaubt, true);
    const r = await rufe("POST", "/api/kit/vertrauen", { erlauben: false, vault: klein });
    assert.equal(r.status, 200); assert.equal(r.j.vertrauen.erlaubt, false);
    assert.deepEqual(merkerVon(support), {}, "kein Rest nach dem Widerruf");
  });

// ───────────────────────────── SW-1: brain.config.json ─────────────────────────────

test("swift-k1/SW-1: brain.config.json zählt zur Freigabe — eine geänderte Programmangabe (werkzeuge.git) ist eine neue Frage; „automatik“ und Formatierung nicht", async () => {
  const d = kitVault();
  const m = marke("KIT-LIEF");
  schreibe(d, ".tools/brain.mjs", `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(m)}, "x");\n${KIT}`);
  const cfg = (o) => schreibe(d, "brain.config.json", JSON.stringify(o, null, 2) + "\n");
  cfg({ werkzeuge: { git: "git" }, automatik: { tageslauf: { an: true } } });
  const support = neuerSupport();
  const v = mitSupport(d, support);
  v.vertrauen(true);
  assert.equal(V.pruefeVertrauen(d, { support }).erlaubt, true); assert.equal(existsSync(m), false, "die App führt .tools nie aus (Kern-Umzug P4)");
  // Die Steuerzentrale des Kits schreibt im Alltag „automatik“ (Schalter, Stufen, Zahlen): keine neue Frage
  cfg({ werkzeuge: { git: "git" }, automatik: { tageslauf: { an: false }, neu: [1, 2, 3] } });
  assert.equal(V.pruefeVertrauen(d, { support }).erlaubt, true, "nur „automatik“ geändert");
  schreibe(d, "brain.config.json", '{"automatik":{"x":1},"werkzeuge":{"git":"git"}}'); // Formatierung und Reihenfolge der Schlüssel
  assert.equal(V.pruefeVertrauen(d, { support }).erlaubt, true, "nur Formatierung und Schlüsselreihenfolge");
  // Ein Pull (oder ein Datei-Abgleich) ändert die Programmangabe und bringt ein ausführbares Skript mit — unter .tools ändert sich nichts
  schreibe(d, "notizen/x.sh", "#!/bin/sh\necho x\n"); chmodSync(join(d, "notizen/x.sh"), 0o755);
  cfg({ werkzeuge: { git: "notizen/x.sh" }, automatik: { tageslauf: { an: false } } });
  const p = V.pruefeVertrauen(d, { support });
  assert.equal(p.erlaubt, false); assert.equal(p.geaendert, true);
  assert.equal(cli([d], { BRAIN_APP_SUPPORT: support, BRAIN_TESTMODUS: "0" }).stdout, '{"erlaubt":false}\n', "Swifts Prüfung (brain status) sagt nein");
  assert.equal(existsSync(m), false, "das Kit läuft nicht");
  // erneut freigeben; Datei entfernen, neu anlegen, kein JSON: jeweils eine neue Frage
  v.vertrauen(true);
  rmSync(join(d, "brain.config.json"));
  assert.equal(V.pruefeVertrauen(d, { support }).geaendert, true, "Datei entfernt");
  v.vertrauen(true);
  cfg({ werkzeuge: { git: "git" } });
  assert.equal(V.pruefeVertrauen(d, { support }).geaendert, true, "Datei neu angelegt");
  v.vertrauen(true);
  schreibe(d, "brain.config.json", "{ kein json 1");
  assert.equal(V.pruefeVertrauen(d, { support }).geaendert, true, "kein JSON mehr");
  v.vertrauen(true);
  schreibe(d, "brain.config.json", "{ kein json 2");
  assert.equal(V.pruefeVertrauen(d, { support }).geaendert, true, "kein JSON: Byte für Byte");
  // package.json der Vault-Wurzel: sie bestimmt, welchen Code `node` im Vault lädt
  v.vertrauen(true);
  schreibe(d, "package.json", '{"type":"module"}\n');
  assert.equal(V.pruefeVertrauen(d, { support }).geaendert, true, "package.json in der Wurzel");
});

// ───────────────────────────── VK-1: Submodule ─────────────────────────────

const FILE = ["-c", "protocol.file.allow=always"]; // nur zum Aufbau: Submodule aus lokalen Ordnern
// Hauptrepo A (Server: B) mit eingerichtetem Submodul `sub` (Quelle S, Arbeitskopie W). sub/a.txt wird durch `* filter=x` gefiltert.
function mitSubmodul() {
  const S = bareRepo(), B = bareRepo();
  const W = tmp("brain-sub-w-"); g(W, "init", "-q", "-b", "main");
  schreibe(W, "a.txt", "inhalt\n"); schreibe(W, ".gitattributes", "* filter=x\n");
  g(W, "add", "--", "a.txt", ".gitattributes"); g(W, "commit", "-q", "-m", "sub"); g(W, "remote", "add", "origin", S); g(W, "push", "-q", "origin", "main");
  const A = repo(); g(A, ...FILE, "submodule", "add", "-q", S, "sub"); g(A, "commit", "-q", "-m", "mit sub");
  g(A, "remote", "add", "origin", B); g(A, "push", "-q", "-u", "origin", "main");
  return { S, B, W, A };
}
// Ein Klon von B mit eingerichtetem Submodul; die Git-Konfiguration des Submoduls liegt in .git/modules/sub/config (hier kommt sie „fremd“ an).
function klonMitSubmodul(B) { const v = tmp("brain-vsub-"); g(v, ...FILE, "clone", "-q", "--recurse-submodules", B, "."); return v; }

test("luecken/VK-1: ein clean-Filter in der Konfiguration eines Submoduls startet nie (gitStatus, Notiz-Index, Diff, Verlauf, Commit) — ohne Vertrauensfrage, weil das Hauptrepo harmlos ist", async () => {
  const { B } = mitSubmodul();
  const bauen = (name) => {
    const vault = klonMitSubmodul(B), m = marke(name);
    g(join(vault, "sub"), "config", "filter.x.clean", `sh -c 'touch ${m}; cat'`); // → .git/modules/sub/config
    const spaeter = new Date(Date.now() + 60_000); utimesSync(join(vault, "sub/a.txt"), spaeter, spaeter); // andere mtime als im Index (Entpacken, Kopieren)
    return { vault, m };
  };
  const roh = bauen("VORPROBE");
  g(roh.vault, "status", "--porcelain");
  assert.equal(existsSync(roh.m), true, "Vorprobe: ein ungehärtetes git status startet den Filter des Submoduls");
  const { vault, m } = bauen("STUDIO");
  const support = neuerSupport();
  assert.deepEqual(V.pruefeVertrauen(vault, { support }), { erlaubt: false, noetig: false, geaendert: false, gitGesperrt: false, gruende: [] }, "das Hauptrepo ist harmlos: keine Frage, keine Sperre");
  const v = mitSupport(vault, support);
  const st = await v.gitStatus();
  assert.equal(st.repo, true); assert.equal(st.gesperrt, undefined);
  assert.ok(!st.geaendert.some((d) => d.pfad.startsWith("sub")), "Submodule tauchen in der Änderungsliste nicht auf");
  await v.notizen(); await v.gitDiff("start.md"); await v.gitVerlauf("start.md"); await v.gitLog(); await v.istGitRepo();
  schreibe(vault, "neu.md", "# neu\n");
  await v.gitCommit({ nachricht: "neu", dateien: ["neu.md"] });
  assert.equal(existsSync(m), false, "der Filter des Submoduls lief nie");
});

test("luecken/VK-1: der Abgleich holt nie im Submodul — remote.origin.uploadpack aus der Submodul-Konfiguration läuft beim fetch nicht", async () => {
  const s = mitSubmodul();
  const einrichten = (name) => {
    const vault = klonMitSubmodul(s.B), m = marke(name);
    g(join(vault, "sub"), "config", "remote.origin.uploadpack", skript(`echo lief >> '${m}'\nexec git-upload-pack "$@"`));
    return { vault, m };
  };
  const roh = einrichten("VORPROBE"), studio = einrichten("STUDIO");
  // der Autor schiebt einen neuen Stand des Submoduls: ein fetch im Modus „on-demand“ holt dann auch im Submodul
  schreibe(s.W, "a.txt", "zwei\n"); g(s.W, "commit", "-q", "-am", "sub 2"); g(s.W, "push", "-q", "origin", "main");
  g(join(s.A, "sub"), ...FILE, "pull", "-q", "origin", "main"); g(s.A, "add", "--", "sub"); g(s.A, "commit", "-q", "-m", "sub hoch"); g(s.A, "push", "-q");
  g(roh.vault, ...FILE, "fetch", "-q");
  assert.equal(existsSync(roh.m), true, "Vorprobe: ein ungehärtetes git fetch startet den uploadpack-Befehl des Submoduls");
  const v = mitSupport(studio.vault, neuerSupport());
  const r = await v.gitSync();
  assert.equal(r.ergebnis, "geholt");
  assert.equal(existsSync(studio.m), false, "der Abgleich holt im Submodul nicht (und startet dessen Konfiguration nicht)");
  assert.equal(g(studio.vault, "rev-parse", "HEAD").trim(), g(s.A, "rev-parse", "HEAD").trim(), "das Hauptrepo ist auf dem neuen Stand");
});

test("luecken/VK-1: jeder Git-Aufruf trägt die Submodul-Härtung — status/diff ignorieren Submodule, fetch holt nicht in ihnen, nichts rekursiert", async () => {
  const bin = tmp("brain-fakegit-"), log = join(bin, "aufrufe.log");
  writeFileSync(join(bin, "git"), `#!/bin/sh\necho "$*" >> '${log}'\nexec '${echtesGit}' "$@"\n`); chmodSync(join(bin, "git"), 0o755);
  const bare = bareRepo();
  const d = repo(); g(d, "remote", "add", "origin", bare); g(d, "push", "-q", "-u", "origin", "main");
  const v = mitSupport(d);
  await mitPfadVorn(bin, async () => {
    await v.gitStatus(); await v.notizen(); await v.gitDiff("start.md"); await v.gitVerlauf("start.md"); await v.gitLog();
    schreibe(d, "n.md", "# n\n"); await v.gitCommit({ nachricht: "n", dateien: ["n.md"] });
    await v.gitSync();
  });
  const unterbefehl = (zeile) => { const t = zeile.split(" "); for (let i = 0; i < t.length; i++) { if (t[i] === "-c") { i++; continue; } if (!t[i].startsWith("-")) return t[i]; } return ""; };
  const aufrufe = readFileSync(log, "utf8").split("\n").filter(Boolean).filter((z) => unterbefehl(z) !== "config");
  assert.ok(aufrufe.length > 10, `es gab Aufrufe (${aufrufe.length})`);
  for (const z of aufrufe) {
    for (const flag of ["submodule.recurse=false", "fetch.recurseSubmodules=false", "push.recurseSubmodules=no", "diff.ignoreSubmodules=all"]) assert.ok(z.includes(`-c ${flag}`), `${flag} fehlt: ${z}`);
  }
  const mit = (name) => aufrufe.filter((z) => unterbefehl(z) === name);
  for (const z of [...mit("status"), ...mit("diff").filter((x) => !x.includes("--no-index"))]) assert.ok(z.includes("--ignore-submodules=all"), `--ignore-submodules=all fehlt: ${z}`);
  assert.ok(mit("status").length >= 2 && mit("diff").length >= 1 && mit("fetch").length >= 1, "status, diff und fetch kamen vor");
  for (const z of mit("fetch")) assert.ok(z.includes("--no-recurse-submodules"), `--no-recurse-submodules fehlt: ${z}`);
});

// ───────────────────────────── VK-2: relative und leere PATH-Einträge ─────────────────────────────

// Ein Vault mit eigenem `git` (Skript, das eine Marke setzt und dann das echte Git ausführt) an den Stellen, die ein relativer oder leerer PATH-Eintrag trifft.
function vaultMitEigenemGit(m) {
  const d = repo();
  const fake = `#!/bin/sh\ntouch '${m}'\nexec '${echtesGit}' "$@"\n`;
  schreibe(d, "node_modules/.bin/git", fake); chmodSync(join(d, "node_modules/.bin/git"), 0o755);
  schreibe(d, "git", fake); chmodSync(join(d, "git"), 0o755);
  return d;
}
const gitOrdner = dirname(echtesGit);

test("luecken/VK-2: der MCP-Server führt kein `git` aus dem Vault aus — relativer PATH-Eintrag (node_modules/.bin) und leerer Eintrag, schon bei der Vertrauensprüfung", async () => {
  for (const [fall, pfadWert] of [["relativ", `node_modules/.bin:${gitOrdner}:/usr/bin:/bin`], ["leer", `/opt/gibts-nicht::${gitOrdner}:/usr/bin:/bin`], ["Punkt", `.:${gitOrdner}`]]) {
    const m = marke("VAULT-GIT-LIEF");
    const d = vaultMitEigenemGit(m);
    const env = { ...process.env, BRAIN_APP_SUPPORT: neuerSupport(), PATH: pfadWert }; delete env.BRAIN_VAULT;
    const p = spawn(process.execPath, [pfad("mcp", "brain-mcp.mjs"), d], { stdio: ["pipe", "pipe", "pipe"], env });
    const wartende = [];
    createInterface({ input: p.stdout }).on("line", (z) => { const w = wartende.shift(); if (w) w(JSON.parse(z)); });
    let nr = 0;
    const frage = (method, params) => new Promise((ok) => { const id = ++nr; wartende.push(ok); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
    try {
      const a = await frage("tools/call", { name: "brain_verlauf", arguments: { pfad: "start.md" } });
      assert.match(a.result.content[0].text, /Start/, `${fall}: der Verlauf kommt vom echten Git`);
      assert.equal(existsSync(m), false, `${fall}: das git aus dem Vault lief nie`);
    } finally { p.kill("SIGKILL"); }
  }
});

test("luecken/VK-2: die CLI für Swift (vertrauen-pruefen.mjs) führt kein `git` aus dem Vault aus — schon das Lesen der Git-Einstellungen startet git im Vault-Ordner", () => {
  const m = marke("VAULT-GIT-LIEF");
  const d = vaultMitEigenemGit(m);
  const r = cli([d], { BRAIN_APP_SUPPORT: neuerSupport(), PATH: `node_modules/.bin::${gitOrdner}:/usr/bin:/bin` });
  assert.equal(r.status, 0); assert.equal(r.stdout, '{"erlaubt":false}\n');
  assert.equal(existsSync(m), false, "das git aus dem Vault lief nie");
});

test("luecken/VK-2: in der Werkstatt startet Git nur über einen absoluten Pfad — PATH mit relativen Einträgen, ohne absolutes git: Fehler statt des Vault-Programms; kindUmgebung bereinigt PATH", async () => {
  const m = marke("VAULT-GIT-LIEF");
  const d = vaultMitEigenemGit(m);
  const alt = process.env.PATH;
  try {
    process.env.PATH = `node_modules/.bin::.:${gitOrdner}`;
    assert.equal(absoluterGitPfad(), echtesGit, "gefunden wird nur über absolute Einträge");
    assert.equal((await git(d, ["rev-parse", "--show-toplevel"])).code, 0);
    assert.equal(existsSync(m), false, "das git aus dem Vault lief nie");
    assert.equal(kindUmgebung().PATH, gitOrdner, "Kindprozesse bekommen keinen leeren oder relativen Eintrag");
    assert.equal(kindUmgebung({ PATH: "x:/usr/bin" }).PATH, "/usr/bin", "auch ein PATH aus dem Zusatz wird bereinigt");
    process.env.PATH = "node_modules/.bin:.";   // nur relative Einträge: kein absolutes git
    assert.equal(absoluterGitPfad(), null);
    const e = await wirft(git(d, ["status"]));
    assert.equal(e.status, 500); assert.match(e.message, /Git ist auf diesem Mac nicht installiert/);
    assert.equal(existsSync(m), false, "auch ohne absolutes git läuft das Programm aus dem Vault nicht");
    assert.equal("PATH" in kindUmgebung(), false, "bleibt nichts übrig, fällt PATH ganz weg (nie ein leerer Eintrag)");
  } finally { process.env.PATH = alt; }
  // bereinigterPfad / bereinigePfad (die Einstiegspunkte rufen es beim Start)
  assert.equal(bereinigterPfad("/usr/bin::/bin:node_modules/.bin:./x:.:/opt/y:"), "/usr/bin:/bin:/opt/y");
  assert.equal(bereinigterPfad("rel:andere"), ""); assert.equal(bereinigterPfad(""), ""); assert.equal(bereinigterPfad(undefined), "");
  try {
    process.env.PATH = "node_modules/.bin::/usr/bin:."; bereinigePfad(); assert.equal(process.env.PATH, "/usr/bin");
    process.env.PATH = "rel:."; bereinigePfad(); assert.equal("PATH" in process.env, false, "ein leerer PATH-Text wäre selbst ein leerer Eintrag");
  } finally { process.env.PATH = alt; }
});

// ───────────────────────────── VK-3: Git-Konfiguration im Fingerabdruck ─────────────────────────────

test("luecken/VK-3: ein Programm-Schlüssel, der nach der Freigabe über eine eingebundene Datei (include.path) dazukommt, ist eine neue Frage — der Filter läuft nicht", async () => {
  const d = repo();
  schreibe(d, "team.gitconfig", "[user]\n\tname = Team\n");
  schreibe(d, ".gitattributes", "*.md filter=probe\n");
  g(d, "add", "--", "team.gitconfig", ".gitattributes"); g(d, "commit", "-q", "-m", "Team-Konfiguration");
  konfig(d, "[include]\n\tpath = ../team.gitconfig\n");
  const m = marke("FILTER");
  const support = neuerSupport();
  const v = mitSupport(d, support);
  v.vertrauen(true);
  assert.equal(V.pruefeVertrauen(d, { support }).erlaubt, true);
  // Ein Abgleich (oder jemand im geteilten Ordner) ergänzt die versionierte Datei — .git/config selbst bleibt, wie sie war
  schreibe(d, "team.gitconfig", `[user]\n\tname = Team\n[filter "probe"]\n\tclean = "sh -c 'touch ${m}; cat'"\n`);
  const spaeter = new Date(Date.now() + 60_000); utimesSync(join(d, "start.md"), spaeter, spaeter); // andere mtime als im Index: git status müsste die Datei durch den Filter lesen
  const p = V.pruefeVertrauen(d, { support });
  assert.equal(p.erlaubt, false, "die Freigabe gilt für den alten Stand der Git-Konfiguration"); assert.equal(p.geaendert, true); assert.equal(p.gitGesperrt, true);
  const s = await v.gitStatus();
  assert.equal(s.gesperrt, true); assert.match(s.grund, /filter\.probe\.clean/);
  assert.equal(existsSync(m), false, "der Filter lief nie");
  v.vertrauen(true); // der Nutzer prüft den neuen Stand und gibt ihn frei
  const s2 = await v.gitStatus();
  assert.equal(s2.repo, true); assert.equal(s2.gesperrt, undefined);
  assert.equal(existsSync(m), true, "mit der neuen Freigabe läuft der Filter (die Einstellung gehört dem Nutzer, der ihr vertraut hat)");
});

test("luecken/VK-3: lokales core.sshCommand und core.hooksPath gehören zur Freigabe (Wert geändert = neue Frage); ein harmloser Schlüssel nicht", () => {
  const d = repo();
  const support = neuerSupport();
  V.erlaube(d, { support });
  g(d, "config", "user.name", "Anders"); g(d, "config", "core.autocrlf", "false");
  assert.equal(V.pruefeVertrauen(d, { support }).erlaubt, true, "harmlose Schlüssel ändern den Fingerabdruck nicht");
  g(d, "config", "core.sshCommand", "ssh -i /tmp/a");
  assert.equal(V.pruefeVertrauen(d, { support }).geaendert, true, "core.sshCommand neu");
  V.erlaube(d, { support });
  g(d, "config", "core.sshCommand", "ssh -i /tmp/b");
  assert.equal(V.pruefeVertrauen(d, { support }).geaendert, true, "core.sshCommand mit anderem Wert");
  V.erlaube(d, { support });
  g(d, "config", "core.hooksPath", ".githooks");
  assert.equal(V.pruefeVertrauen(d, { support }).geaendert, true, "core.hooksPath neu");
  V.erlaube(d, { support });
  g(d, "config", "core.hooksPath", ".andere-hooks");
  assert.equal(V.pruefeVertrauen(d, { support }).geaendert, true, "core.hooksPath mit anderem Wert (auch wenn der Ordner leer ist)");
  V.erlaube(d, { support });
  g(d, "config", "merge.x.driver", "/bin/cat %A");
  assert.equal(V.pruefeVertrauen(d, { support }).erlaubt, false, "ein Programm-Schlüssel nach der Freigabe");
});

// ───────────────────────────── V1 / B2: Klonen mit der ssh-Einstellung des Nutzers ─────────────────────────────

test("vaults/V1 + git-haertung/B2: Klonen ruft die globale core.sshCommand des Nutzers auf (nicht unser BatchMode-ssh) — der Klon, der im Terminal klappt, klappt auch hier", async () => {
  const lief = marke("EIGENES-SSH");
  const eigenes = skript(`echo "$*" >> '${lief}'\necho "Permission denied (publickey)." >&2\nexit 255`);
  const globalDatei = join(tmp("brain-gcfg-"), "gitconfig");
  writeFileSync(globalDatei, `[core]\n\tsshCommand = ${eigenes}\n[user]\n\tname = T\n\temail = t@example.org\n`);
  const alt = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = globalDatei;
  try {
    const url = "ssh://git@example.invalid/team/privat.git";
    try { execFileSync("git", ["clone", "-q", url, join(tmp("brain-kontrolle-"), "k")], { env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, stdio: "ignore" }); } catch { /* der Server fehlt */ }
    assert.equal(existsSync(lief), true, "Vorprobe: git clone im Terminal ruft die eigene core.sshCommand auf");
    rmSync(lief);
    const basis = tmp("brain-klon-");
    const e = await wirft(Vaults.klone({ url, ordner: join(basis, "Ziel") }, { support: neuerSupport() }));
    assert.equal(e.status, 403, "die Anmeldung scheitert beim Server (Attrappe) — mit der richtigen Fehlermeldung");
    assert.equal(existsSync(lief), true, "Studio hat das eigene ssh des Nutzers aufgerufen (früher übersteuerte unser GIT_SSH_COMMAND es)");
    assert.deepEqual(readdirSync(basis), [], "nichts angelegt");
    // ohne eigene Einstellung des Nutzers bleibt es bei unserem BatchMode-ssh (nie nach einem Passwort fragen)
    writeFileSync(globalDatei, "[user]\n\tname = T\n\temail = t@example.org\n");
    rmSync(lief, { force: true });
    await wirft(Vaults.klone({ url, ordner: join(basis, "Ziel2") }, { support: neuerSupport() }));
    assert.equal(existsSync(lief), false, "ohne Einstellung läuft kein fremdes ssh");
  } finally { if (alt === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = alt; }
});

// ───────────────────────────── V2: SIGTERM beim Einschalten, Anlegen, Klonen ─────────────────────────────

// Startet die echte Werkstatt (Brücken-Protokoll über stdin/stdout) mit einer Git-Attrappe, die bei `hangBei` hängt, schickt die Anfrage, wartet, bis Git
// hängt, und beendet die Werkstatt mit SIGTERM — so wie die App es beim Beenden tut. → { home, ende: { code, sig }, antworten }
async function sigtermWaehrend({ route, eingabe, hangBei, vorher = () => {} }) {
  const T = tmp("brain-term-"), HOME = join(T, "home"), SUP = join(T, "support"), FAKE = join(T, "fakegit");
  for (const dir of [HOME, SUP, FAKE]) mkdirSync(dir);
  vorher(HOME);
  const haengt = hangBei === "clone"
    ? 'for a in "$@"; do last="$a"; done; mkdir -p "$last"; echo halb > "$last/halb.txt"; echo $$ > "$D/pid"; exec sleep 30'
    : 'echo $$ > "$D/pid"; exec sleep 30';
  writeFileSync(join(FAKE, "git"), `#!/bin/sh\nD="$(dirname "$0")"\ncase " $* " in *" ${hangBei} "*) ${haengt} ;; esac\nexec "${echtesGit}" "$@"\n`);
  chmodSync(join(FAKE, "git"), 0o755);
  const env = { ...process.env, HOME, BRAIN_APP_SUPPORT: SUP, GIT_CONFIG_NOSYSTEM: "1", PATH: `${FAKE}:${process.env.PATH}` };
  for (const k of ["GIT_SSH_COMMAND", "GIT_CONFIG_GLOBAL", "XDG_CONFIG_HOME", "BRAIN_VAULT"]) delete env[k];
  const p = spawn(process.execPath, [pfad("werkstatt", "werkstatt.mjs")], { env, cwd: T, stdio: ["pipe", "pipe", "pipe"] });
  try {
    const zeilen = []; createInterface({ input: p.stdout }).on("line", (z) => { try { zeilen.push(JSON.parse(z)); } catch { /* egal */ } });
    const ende = new Promise((ok) => p.on("close", (code, sig) => ok({ code, sig })));
    assert.ok(await warteBis(() => zeilen.some((z) => z.bereit), 5000), "Brücke ist bereit");
    p.stdin.write(JSON.stringify({ id: 1, methode: "POST", pfad: route, query: null, body: Buffer.from(JSON.stringify(eingabe(HOME))).toString("base64") }) + "\n");
    assert.ok(await warteBis(() => existsSync(join(FAKE, "pid")), 10_000), "Git hängt (die Attrappe läuft)");
    const t0 = Date.now();
    p.kill("SIGTERM");
    const r = await Promise.race([ende, new Promise((ok) => setTimeout(() => ok("läuft noch"), 6000))]);
    assert.deepEqual(r, { code: 0, sig: null }, "die Werkstatt beendet sich ohne Verzögerung");
    assert.ok(Date.now() - t0 < 4000, `Ende nach ${Date.now() - t0} ms`);
    return { home: HOME, support: SUP, antworten: zeilen.filter((z) => z.id === 1) };
  } finally {
    try { const pid = Number(readFileSync(join(FAKE, "pid"), "utf8").trim()); if (pid && lebt(pid)) process.kill(pid, "SIGKILL"); } catch { /* weg */ }
    p.kill("SIGKILL");
  }
}

test("vaults/V2: SIGTERM mitten im „Versionsverlauf einschalten“ — .git und die angelegte .gitignore verschwinden, Dateien des Nutzers bleiben, kein Eintrag", async () => {
  const r = await sigtermWaehrend({ route: "/api/vaults/oeffnen", hangBei: "add",
    vorher: (home) => schreibe(home, "Notizen/a.md", "# a\n"), eingabe: (home) => ({ pfad: join(home, "Notizen"), gitEinschalten: true }) });
  assert.deepEqual(readdirSync(join(r.home, "Notizen")).sort(), ["a.md"], "wie vorher: weder .git noch .gitignore");
  assert.equal(existsSync(join(r.support, "vaults.json")), false, "kein Eintrag in der Liste");
});

test("vaults/V2: SIGTERM mitten im Anlegen (neu, Vorlage und leer) — das halbe Vault verschwindet samt dem neu angelegten Ordner", async () => {
  for (const art of ["vorlage", "leer"]) {
    const r = await sigtermWaehrend({ route: "/api/vaults/neu", hangBei: "add", eingabe: (home) => ({ art, ordner: join(home, "Neu", "Brain") }) });
    assert.equal(existsSync(join(r.home, "Neu")), false, `${art}: kein halbes Vault, auch kein leerer Elternordner`);
    assert.equal(existsSync(join(r.support, "vaults.json")), false, `${art}: kein Eintrag`);
  }
});

test("vaults/V2: SIGTERM mitten im Klonen — das halb fertige Ziel verschwindet samt den für diesen Klon angelegten Elternordnern", async () => {
  const r = await sigtermWaehrend({ route: "/api/vaults/klonen", hangBei: "clone", eingabe: (home) => ({ url: "/irgendein/pfad", ordner: join(home, "Projekte", "Klon") }) });
  assert.equal(existsSync(join(r.home, "Projekte")), false, "nichts Halbes liegt herum (früher: das halbe Ziel, danach landete der nächste Versuch in „Klon 2“)");
  assert.equal(existsSync(join(r.support, "vaults.json")), false);
});

test("vaults/V2: beendeVorgaenge nimmt nur zurück, was noch läuft — ein fertig eingetragenes Vault bleibt", async () => {
  const basis = tmp("brain-fertig-");
  const r = await Vaults.neuesVault({ art: "leer", ordner: join(basis, "V") }, { support: neuerSupport(), heute: "2026-10-24" });
  assert.equal(Vaults.beendeVorgaenge(), 0, "kein offener Vorgang");
  assert.equal(existsSync(join(basis, "V", ".git")), true);
  assert.equal(r.vault.pfad, join(basis, "V"));
});

// ───────────────────────────── V3: Rücknahme nur leerer Elternordner ─────────────────────────────

test("vaults/V3: scheitert das Klonen, verschwindet nur das Ziel — ein Elternordner, in dem inzwischen etwas anderes liegt (zweites Vault, Notiz), bleibt samt Inhalt", async () => {
  const bin = tmp("brain-fakegit-");
  // Der Klon „scheitert“, nachdem im neu angelegten Elternordner ein zweites Vault und eine Notiz des Nutzers entstanden sind
  writeFileSync(join(bin, "git"), `#!/bin/sh
case " $* " in *" clone "*)
  for a in "$@"; do last="$a"; done; P="$(dirname "$last")"
  echo "# Notiz" > "$P/einkauf.md"; mkdir -p "$P/Tagebuch"; echo "# heute" > "$P/Tagebuch/heute.md"
  echo "fatal: repository 'x' does not exist" >&2; exit 128 ;;
esac
exec '${echtesGit}' "$@"\n`);
  chmodSync(join(bin, "git"), 0o755);
  const basis = tmp("brain-v3-");
  const eltern = join(basis, "neu", "Projekte");
  await mitPfadVorn(bin, async () => {
    await wirft(Vaults.klone({ url: "/irgendein/pfad", ordner: join(eltern, "Klon") }, { support: neuerSupport() }));
  });
  assert.equal(existsSync(join(eltern, "Klon")), false, "das Ziel ist weg");
  assert.equal(readFileSync(join(eltern, "einkauf.md"), "utf8"), "# Notiz\n", "die Notiz des Nutzers bleibt (früher: samt Elternordner gelöscht)");
  assert.equal(readFileSync(join(eltern, "Tagebuch", "heute.md"), "utf8"), "# heute\n", "das zweite Vault bleibt");
  // Ebenso beim Anlegen: git init „scheitert“, nachdem im neu angelegten Elternordner eine Notiz entstanden ist
  const bin2 = tmp("brain-fakegit-");
  writeFileSync(join(bin2, "git"), `#!/bin/sh
case " $* " in *" init "*) P="$(dirname "$PWD")"; echo "# Notiz" > "$P/einkauf.md"; echo "fatal: init" >&2; exit 128 ;; esac
exec '${echtesGit}' "$@"\n`);
  chmodSync(join(bin2, "git"), 0o755);
  const basis2 = tmp("brain-v3-neu-");
  await mitPfadVorn(bin2, async () => { await wirft(Vaults.neuesVault({ art: "leer", ordner: join(basis2, "neu", "Brain") }, { support: neuerSupport() })); });
  assert.equal(existsSync(join(basis2, "neu", "Brain")), false, "das angelegte Vault ist weg");
  assert.equal(readFileSync(join(basis2, "neu", "einkauf.md"), "utf8"), "# Notiz\n", "der Elternordner bleibt samt Notiz");
  // Hinweis: dass bei sonst leeren Elternordnern ALLES verschwindet, prüfen die Tests „klone: gibt es das Repository nicht …“ und „Fehler beim Anlegen …“
});

// ───────────────────────────── V4: kaputte vertrauen.json ─────────────────────────────

test("vaults/V4: erlaube über einer kaputten vertrauen.json sichert sie vorher (vertrauen.json.defekt-<Zeit>); Lesen allein ändert nichts und gilt als „nichts freigegeben“", () => {
  const d = kitVault();
  for (const roh of ["{ kein json", "[]", "null", "\"x\"", "5"]) {
    const support = neuerSupport();
    writeFileSync(join(support, "vertrauen.json"), roh);
    const r = V.pruefeVertrauen(d, { support });
    assert.equal(r.erlaubt, false); assert.equal(r.geaendert, false, "kein Eintrag, also keine „geänderte“ Freigabe");
    assert.deepEqual(readdirSync(support), ["vertrauen.json"], "bloßes Lesen sichert und ändert nichts");
    assert.equal(V.sichereDefektenMerker(support, { jetzt: Date.UTC(2026, 9, 24, 21, 15, 2) }), true);
    assert.deepEqual(readdirSync(support), ["vertrauen.json.defekt-20261024-231502"], "beiseite gelegt, Berliner Zeit im Namen");
    assert.equal(readFileSync(join(support, "vertrauen.json.defekt-20261024-231502"), "utf8"), roh);
    writeFileSync(join(support, "vertrauen.json"), roh);
    V.erlaube(d, { support }); // schreibt sauber über die kaputte Datei — nach der Sicherung
    const sicherungen = readdirSync(support).filter((n) => /^vertrauen\.json\.defekt-/.test(n));
    assert.equal(sicherungen.length, 2, `die zweite Sicherung stammt von erlaube (${roh})`);
    for (const s of sicherungen) assert.equal(readFileSync(join(support, s), "utf8"), roh);
    assert.equal(V.pruefeVertrauen(d, { support }).erlaubt, true);
    assert.deepEqual(Object.keys(merkerVon(support)), [oeffneVault(d).wurzel]);
  }
  // heile und leere Dateien werden nie gesichert
  const support = neuerSupport();
  assert.equal(V.sichereDefektenMerker(support), false, "keine Datei");
  writeFileSync(join(support, "vertrauen.json"), ""); assert.equal(V.sichereDefektenMerker(support), false, "leer: nichts zu bewahren");
  writeFileSync(join(support, "vertrauen.json"), "{}"); assert.equal(V.sichereDefektenMerker(support), false, "heil");
  assert.deepEqual(readdirSync(support), ["vertrauen.json"]);
});

// ───────────────────────────── Vertragsänderung 1: POST /api/kit/vertrauen { erlauben, vault } ─────────────────────────────

test("Vertrag 1: POST /api/kit/vertrauen verlangt { vault } — ohne 400, ein anderer Vault 409 art „anderer-vault“ ohne jede Wirkung, derselbe (auch über Verweis) 200", async () => {
  const support = neuerSupport();
  const a = kitVault(), b = kitVault();
  const rufe = aufruf(erzeugeHandler({ vault: a, vaultOptionen: { support } }));
  const nichtsFreigegeben = () => assert.equal(existsSync(join(support, "vertrauen.json")), false, "nichts freigegeben — weder a noch b");
  let r = await rufe("POST", "/api/kit/vertrauen", { erlauben: true });
  assert.equal(r.status, 400); assert.match(r.j.fehler, /Vault/); nichtsFreigegeben();
  for (const falsch of ["", "   ", 5, null, ["x"]]) { r = await rufe("POST", "/api/kit/vertrauen", { erlauben: true, vault: falsch }); assert.equal(r.status, 400, JSON.stringify(falsch)); }
  r = await rufe("POST", "/api/kit/vertrauen", { erlauben: true, vault: b });
  assert.equal(r.status, 409); assert.equal(r.j.art, "anderer-vault"); assert.equal(typeof r.j.fehler, "string"); assert.match(r.j.fehler, /nichts geändert/i);
  r = await rufe("POST", "/api/kit/vertrauen", { erlauben: true, vault: join(tmp(), "gibts-nicht") });
  assert.equal(r.status, 409); assert.equal(r.j.art, "anderer-vault"); nichtsFreigegeben();
  r = await rufe("POST", "/api/kit/vertrauen", { erlauben: "ja", vault: a });
  assert.equal(r.status, 400);
  const link = join(tmp("brain-ln-"), "verweis"); symlinkSync(a, link);
  r = await rufe("POST", "/api/kit/vertrauen", { erlauben: true, vault: link });
  assert.equal(r.status, 200); assert.equal(r.j.vertrauen.erlaubt, true); assert.equal(r.j.kit.vertraut, true, "derselbe Ordner über einen Verweis");
  // Widerrufen gilt ebenso nur für den Vault, den der Dialog gezeigt hat
  r = await rufe("POST", "/api/kit/vertrauen", { erlauben: false, vault: b });
  assert.equal(r.status, 409); assert.equal(V.pruefeVertrauen(a, { support }).erlaubt, true, "a bleibt freigegeben");
  r = await rufe("POST", "/api/kit/vertrauen", { erlauben: false, vault: a });
  assert.equal(r.status, 200); assert.equal(r.j.vertrauen.erlaubt, false);
  // Der Vault wechselt zwischen Anzeige des Dialogs und Klick (Vault-Wechsel in der Oberfläche): die Freigabe für a trifft nie b
  assert.equal((await rufe("POST", "/api/vaults/oeffnen", { pfad: b })).status, 200);
  r = await rufe("POST", "/api/kit/vertrauen", { erlauben: true, vault: a });
  assert.equal(r.status, 409); assert.equal(r.j.art, "anderer-vault");
  assert.equal(V.pruefeVertrauen(b, { support }).erlaubt, false, "b wurde nicht freigegeben, obwohl es der offene Vault ist");
  assert.equal((await rufe("POST", "/api/kit/vertrauen", { erlauben: true, vault: b })).status, 200);
  assert.equal(V.pruefeVertrauen(b, { support }).erlaubt, true);
});
