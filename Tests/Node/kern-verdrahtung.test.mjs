// Einrichtung verdrahten (Kern-Umzug P6): Claude-Code-Hooks, Prüfung vor dem Speichern und Hintergrunddienst über den STARTER der App.
// Nur Wegwerf-Ordner: eigenes HOME, eigener Support-Ordner mit nachgebautem bin/kern und bin/kortex, launchctl nur als Attrappe.
// Nie das echte ~/.claude, nie ~/Library/LaunchAgents, nie das echte launchctl.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, cpSync, symlinkSync, readdirSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmp, schreibe, pfad, repo, g } from "./hilfe.mjs";

const HOME = tmp("kortex-home-");
process.env.HOME = HOME; // os.homedir() liest $HOME — auch in den Kindprozessen
// Der Wegwerf-Support-Ordner liegt unter Temp: Testschalter, damit er als stabiler Kern-Pfad gilt (ohne diese beiden wäre er „unbeständig“).
process.env.KORTEX_KERN_UNSTABIL_ERLAUBT = "1";
process.env.KORTEX_KERN_TEMP_WURZELN = "";
delete process.env.KORTEX_VORSCHAU;
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
const q = (p) => `'${String(p).replaceAll("'", "'\\''")}'`;

// Support-Ordner wie nach dem Start der App: kern/9.9.9 (Kopie des Kerns), bin/kern → ../kern/9.9.9, bin/kortex (Starter wie in Laufzeit.swift, ohne Hook-Modus).
function baueSupport({ mitStarter = true } = {}) {
  const support = tmp("Kortex Support '1' ");
  const version = join(support, "kern", "9.9.9");
  cpSync(pfad("kern"), version, { recursive: true });
  mkdirSync(join(support, "bin"), { recursive: true });
  symlinkSync("../kern/9.9.9", join(support, "bin", "kern"));
  const starter = join(support, "bin", "kortex");
  if (mitStarter) {
    writeFileSync(starter, `#!/bin/sh\nKORTEX_KERN_PFAD=${q(join(support, "bin", "kern"))}\nexport KORTEX_KERN_PFAD\nexec ${q(process.execPath)} ${q(join(support, "bin", "kern", "brain.mjs"))} "$@"\n`);
    chmodSync(starter, 0o755);
  }
  return { support, starter, kern: join(support, "bin", "kern"), version };
}
function vault({ mitGit = false } = {}) {
  const d = mitGit ? repo("kortex-vault-") : tmp("kortex-vault-");
  schreibe(d, "brain.config.json", "{}\n");
  schreibe(d, "00_inbox/n.md", "# Notiz\n");
  if (mitGit) { g(d, "add", "--", "brain.config.json", "00_inbox/n.md"); g(d, "commit", "-q", "-m", "Vault"); }
  return d;
}
const aufruf = (h) => async (methode, p, daten) => {
  const r = await h({ methode, pfad: p, query: null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) });
  let j = null; try { j = JSON.parse(r.body.toString("utf8")); } catch { /* statisch */ }
  return { ...r, j };
};
function einrichtung(opt = {}) {
  const s = baueSupport(opt);
  const v = vault(opt);
  const rufe = aufruf(erzeugeHandler({ vault: v, vaultOptionen: { support: s.support }, starter: s.starter }));
  return { ...s, v, rufe };
}
const settingsDatei = join(HOME, ".claude", "settings.json");
const standardProfil = (st) => st.claude.profile[join(HOME, ".claude")];
const settings = () => JSON.parse(readFileSync(settingsDatei, "utf8"));
const alleBefehle = (s) => Object.values(s.hooks || {}).flat().flatMap((e) => (e.hooks || []).map((h) => h.command));
const ohneVersionOderApp = (text, e) => {
  assert.ok(!text.includes("/kern/9.9.9"), `kein Versionsordner im Eintrag: ${text.slice(0, 300)}`);
  assert.ok(!/\.app\b/.test(text), "kein Pfad im App-Paket");
  assert.ok(!text.includes(e.version), "auch nicht in aufgelöster Form");
};

test("Stand ohne Starter: nichts eingerichtet, kein Fehler; Eintragen sagt klar, was fehlt", async () => {
  const e = einrichtung({ mitStarter: false });
  const st = await e.rufe("GET", "/api/kern/stand");
  assert.equal(st.status, 200);
  assert.equal(st.j.starter.vorhanden, false);
  const r = await e.rufe("POST", "/api/kern/verdrahten", { was: "claude", an: true });
  assert.equal(r.status, 409); assert.equal(r.j.art, "kein-starter");
  assert.ok(!existsSync(settingsDatei), "ohne Starter wird nichts geschrieben");
});

test("Claude Code: Hooks und Statuszeile über den Starter, nur bin/kortex und bin/kern in settings.json; Fremdes bleibt; Rückweg entfernt nur Brain", async () => {
  const e = einrichtung();
  mkdirSync(join(HOME, ".claude"), { recursive: true });
  const fremd = { hooks: [{ type: "command", command: "afplay glass" }] };
  writeFileSync(settingsDatei, JSON.stringify({ model: "x", hooks: { Stop: [fremd], SessionStart: [{ hooks: [{ type: "command", command: "fremd.sh" }] }] } }));

  let st = (await e.rufe("GET", "/api/kern/stand")).j;
  assert.equal(st.starter.vorhanden, true);
  assert.equal(standardProfil(st).aktiv, false);

  const r = await e.rufe("POST", "/api/kern/verdrahten", { was: "claude", an: true });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(standardProfil(r.j.stand).aktiv, true);
  assert.equal(standardProfil(r.j.stand).statuszeile, "brain");
  const s = settings();
  assert.equal(s.model, "x");
  assert.deepEqual(s.hooks.Stop, [fremd], "fremder Hook unverändert");
  const befehle = alleBefehle(s);
  assert.ok(befehle.includes("fremd.sh"));
  const eigene = befehle.filter((c) => c.includes("hook "));
  assert.equal(eigene.length, 9, eigene.join("\n"));
  for (const c of [...eigene, s.statusLine.command]) {
    assert.ok(c.startsWith(`[ -x ${q(e.starter)} ] && exec ${q(e.starter)} hook `) && c.endsWith(" || exit 0"), c);
  }
  ohneVersionOderApp(JSON.stringify(s), e);
  assert.ok(!JSON.stringify(s).includes(e.v), "kein fester Vault in den Hooks");

  // Rückweg
  const aus = await e.rufe("POST", "/api/kern/verdrahten", { was: "claude", an: false });
  assert.equal(aus.status, 200, JSON.stringify(aus.j));
  assert.equal(standardProfil(aus.j.stand).aktiv, false);
  const nach = settings();
  assert.equal(nach.statusLine, undefined);
  assert.deepEqual(nach.hooks.Stop, [fremd]);
  assert.deepEqual(alleBefehle(nach).sort(), ["afplay glass", "fremd.sh"], "übrig bleibt nur Fremdes");
  assert.equal(nach.model, "x");
  assert.deepEqual(readdirSync(join(HOME, ".claude", "commands")).filter((n) => n.endsWith(".md")), [], "die Brain-Befehle sind mit weg");
});

test("Alt-Einträge (<vault>/.tools, früherer Kern-Pfad, Versionsordner, node-start.sh) werden beim Einrichten ersetzt, nicht verdoppelt", async () => {
  const e = einrichtung();
  mkdirSync(join(HOME, ".claude"), { recursive: true });
  const alt = (c) => ({ hooks: [{ type: "command", command: c }] });
  writeFileSync(settingsDatei, JSON.stringify({
    hooks: {
      SessionStart: [alt(`node "${e.v}/.tools/session-start.mjs"`), alt("fremd.sh")],
      UserPromptSubmit: [alt(`/bin/sh '${e.version}/node-start.sh' '${e.version}/adapters/claude-code/brain-hint.mjs'`)],
      SessionEnd: [alt(`/bin/sh '/alter/kern/node-start.sh' '/alter/kern/adapters/claude-code/ernte-ausloeser.mjs' --art fakt --vault '${e.v}'`)],
    },
    statusLine: { type: "command", command: `node "${e.v}/.tools/statusline.sh"` },
  }));
  const r = await e.rufe("POST", "/api/kern/verdrahten", { was: "claude", an: true });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  const s = settings();
  const text = JSON.stringify(s);
  assert.ok(!text.includes(".tools") && !text.includes("node-start.sh") && !text.includes("/alter/kern") && !text.includes(e.version), text.slice(0, 400));
  assert.equal(alleBefehle(s).filter((c) => c.includes("hook session-start")).length, 1);
  assert.equal(alleBefehle(s).filter((c) => c.includes("hook brain-hint")).length, 1);
  assert.equal(alleBefehle(s).filter((c) => c.includes("hook ernte-ausloeser")).length, 2, "SessionEnd und PreCompact, je einmal");
  assert.ok(alleBefehle(s).includes("fremd.sh"));
  assert.match(s.statusLine.command, /hook statusline \|\| exit 0$/);
  // zweiter Lauf: keine Änderung
  const nochmal = await e.rufe("POST", "/api/kern/verdrahten", { was: "claude", an: true });
  assert.match(nochmal.j.ausgabe, /unverändert/);
});

test("Prüfung vor dem Speichern: core.hooksPath auf bin/kern/git-hooks; fremder Eintrag bleibt ohne Ja; Rückweg nimmt nur den eigenen heraus", async () => {
  const e = einrichtung({ mitGit: true });
  let st = (await e.rufe("GET", "/api/kern/stand")).j;
  assert.deepEqual(st.git, { moeglich: true, aktiv: false, fremder: false });

  let r = await e.rufe("POST", "/api/kern/verdrahten", { was: "git", an: true });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.stand.git.aktiv, true);
  const pfadWert = g(e.v, "config", "--local", "core.hooksPath").trim();
  assert.equal(pfadWert, `${e.kern}/git-hooks`);
  ohneVersionOderApp(pfadWert, e);

  r = await e.rufe("POST", "/api/kern/verdrahten", { was: "git", an: false });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.stand.git.aktiv, false);
  assert.throws(() => g(e.v, "config", "--local", "core.hooksPath"), /./, "nicht mehr gesetzt");

  // fremder Eintrag (z. B. von einem anderen Werkzeug): ohne ausdrückliches Ersetzen unverändert
  g(e.v, "config", "--local", "core.hooksPath", "/opt/anderes/hooks");
  st = (await e.rufe("GET", "/api/kern/stand")).j;
  assert.equal(st.git.fremder, true);
  r = await e.rufe("POST", "/api/kern/verdrahten", { was: "git", an: true });
  assert.equal(r.status, 409); assert.equal(r.j.art, "anders");
  assert.equal(g(e.v, "config", "--local", "core.hooksPath").trim(), "/opt/anderes/hooks");
  r = await e.rufe("POST", "/api/kern/verdrahten", { was: "git", an: false });
  assert.equal(r.status, 200);
  assert.equal(g(e.v, "config", "--local", "core.hooksPath").trim(), "/opt/anderes/hooks", "„aus“ lässt Fremdes stehen");
  r = await e.rufe("POST", "/api/kern/verdrahten", { was: "git", an: true, ersetzen: true });
  assert.equal(r.status, 200);
  assert.equal(g(e.v, "config", "--local", "core.hooksPath").trim(), `${e.kern}/git-hooks`);
});

test("Ohne Versionsverlauf gibt es keine Prüfung vor dem Speichern", async () => {
  const e = einrichtung();
  assert.deepEqual((await e.rufe("GET", "/api/kern/stand")).j.git, { moeglich: false });
  const r = await e.rufe("POST", "/api/kern/verdrahten", { was: "git", an: true });
  assert.equal(r.status, 409); assert.equal(r.j.art, "kein-git");
});

// Attrappe für launchctl: schreibt jeden Aufruf in eine Datei; nie das echte Programm.
function fakeLaunchctl() {
  const d = tmp("kortex-launchctl-");
  const log = join(d, "aufrufe.txt");
  const skript = join(d, "launchctl.mjs");
  writeFileSync(skript, `import { appendFileSync } from "node:fs"; appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(" ") + "\\n"); process.exit(0);\n`);
  return { skript, aufrufe: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []) };
}

test("Hintergrunddienst: LaunchAgent zeigt auf den Starter (bin/kortex), kein fester Vault; Attrappe statt launchctl; Rückweg entfernt die Datei", { skip: process.platform !== "darwin" }, async () => {
  const e = einrichtung();
  const fake = fakeLaunchctl();
  const plist = join(HOME, "Library", "LaunchAgents", "de.brain.tageslauf.plist");
  process.env.BRAIN_LAUNCHCTL = fake.skript;
  try {
    let st = (await e.rufe("GET", "/api/kern/stand")).j;
    assert.deepEqual(st.dienst, { verfuegbar: true, eingerichtet: false, geladen: false });
    const r = await e.rufe("POST", "/api/kern/verdrahten", { was: "dienst", an: true });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    assert.ok(existsSync(plist));
    const text = readFileSync(plist, "utf8");
    assert.ok(text.includes(`<string>${e.starter}</string>`), "Programm ist der Starter");
    assert.ok(text.includes("<string>tageslauf</string>") && text.includes("<string>--dienst</string>"));
    assert.ok(!text.includes("BRAIN_VAULT") && !text.includes(e.v) && !text.includes("node-start.sh"), "folgt dem aktiven Vault, kein fester Eintrag");
    assert.ok(text.includes(join(e.support, "logs", "dienst.log")), "Protokoll im Support-Ordner");
    ohneVersionOderApp(text, e);
    assert.ok(fake.aufrufe().some((a) => a.startsWith("bootstrap")), "nur die Attrappe wurde gerufen");
    assert.equal(r.j.stand.dienst.eingerichtet, true);
    assert.deepEqual(JSON.parse(readFileSync(join(e.support, "dienst.json"), "utf8")).vaults, [realpathSync(e.v)], "der Dienst ist nur für diesen Vault eingeschaltet");

    const aus = await e.rufe("POST", "/api/kern/verdrahten", { was: "dienst", an: false });
    assert.equal(aus.status, 200, JSON.stringify(aus.j));
    assert.ok(!existsSync(plist) && !existsSync(join(e.support, "dienst.json")));
    assert.ok(fake.aufrufe().some((a) => a.startsWith("bootout")));
  } finally { delete process.env.BRAIN_LAUNCHCTL; }
});

test("Hintergrunddienst: im Testmodus ohne Attrappe und in der Vorschau wird nichts eingerichtet", { skip: process.platform !== "darwin" }, async () => {
  const e = einrichtung();
  delete process.env.BRAIN_LAUNCHCTL;
  const plist = join(HOME, "Library", "LaunchAgents", "de.brain.tageslauf.plist");
  let r = await e.rufe("POST", "/api/kern/verdrahten", { was: "dienst", an: true });
  assert.equal(r.status, 409); assert.equal(r.j.art, "testmodus");
  assert.deepEqual((await e.rufe("GET", "/api/kern/stand")).j.dienst, { verfuegbar: false });
  process.env.KORTEX_VORSCHAU = "/tmp/vorschau-gibt-es-nicht";
  try {
    r = await e.rufe("POST", "/api/kern/verdrahten", { was: "dienst", an: true });
    assert.equal(r.status, 409); assert.equal(r.j.art, "vorschau");
  } finally { delete process.env.KORTEX_VORSCHAU; }
  assert.ok(!existsSync(plist));
});

test("Ohne stabilen Kern-Pfad (Support im Temp-Ordner, kein Testschalter) wird nichts eingetragen: klare Meldung, nichts geschrieben", async () => {
  const e = einrichtung();
  const alt = [process.env.KORTEX_KERN_UNSTABIL_ERLAUBT, process.env.KORTEX_KERN_TEMP_WURZELN];
  delete process.env.KORTEX_KERN_UNSTABIL_ERLAUBT; delete process.env.KORTEX_KERN_TEMP_WURZELN;
  try {
    const vorher = existsSync(settingsDatei) ? readFileSync(settingsDatei, "utf8") : null;
    const r = await e.rufe("POST", "/api/kern/verdrahten", { was: "claude", an: true });
    assert.equal(r.status, 409, JSON.stringify(r.j)); assert.equal(r.j.art, "nicht-stabil");
    assert.match(r.j.fehler, /Programme/);
    assert.equal(existsSync(settingsDatei) ? readFileSync(settingsDatei, "utf8") : null, vorher);
  } finally { [process.env.KORTEX_KERN_UNSTABIL_ERLAUBT, process.env.KORTEX_KERN_TEMP_WURZELN] = alt; }
});

test("Ungültige Eingaben: 400, nichts passiert", async () => {
  const e = einrichtung();
  for (const body of [{ was: "x", an: true }, { was: "claude" }, { was: "claude", an: "ja" }]) {
    const r = await e.rufe("POST", "/api/kern/verdrahten", body);
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  assert.equal((await e.rufe("GET", "/api/kern/verdrahten")).status, 405);
  assert.equal((await e.rufe("POST", "/api/kern/stand", {})).status, 405);
});

// ---- Mehrere Claude-Profile (CLAUDE_CONFIG_DIR): die App startet aus dem Finder ohne diese Umgebung ----
const { erkenneProfile } = await import(pfad("werkstatt", "profile.mjs"));

// Ein eigenes Home mit mehreren Profilordnern. Gibt die Pfade zurück; das Home gilt, bis `fertig()` aufgerufen wird.
function mehrProfilHome() {
  const heim = tmp("kortex-profile-home-");
  const ordner = (name, dateien = {}) => { mkdirSync(join(heim, name), { recursive: true }); for (const [n, t] of Object.entries(dateien)) schreibe(join(heim, name), n, t); return join(heim, name); };
  const p = {
    heim,
    standard: ordner(".claude", { "settings.json": '{"model":"standard"}' }),
    privat: ordner(".claude-privat", { ".claude.json": "{}" }),
    firma: ordner(".claude-firma2", { "projects/p/x.jsonl": "{}" }),
    leer: ordner(".claude-leer"),                                   // kein Profil: weder settings.json noch .claude.json noch projects/
    sicherung: ordner(".claude.bak", { "settings.json": "{}" }),     // Name passt nicht (.claude-*)
  };
  mkdirSync(join(heim, "echt-ordner"), { recursive: true });
  schreibe(join(heim, "echt-ordner"), "settings.json", "{}");
  symlinkSync(join(heim, "echt-ordner"), join(heim, ".claude-link"));  // Symlinks werden nicht verfolgt
  schreibe(heim, ".claude-datei", "ich bin eine Datei");
  const alt = process.env.HOME;
  process.env.HOME = heim;
  return { ...p, fertig: () => { process.env.HOME = alt; } };
}

test("Profile werden gefunden: ~/.claude und ~/.claude-* mit settings.json, .claude.json oder projects/ — nicht leere Ordner, Symlinks, Dateien oder ähnliche Namen", () => {
  const h = mehrProfilHome();
  try {
    const liste = erkenneProfile(h.heim);
    assert.deepEqual(liste.map((p) => p.name), [".claude", ".claude-firma2", ".claude-privat"]);
    assert.deepEqual(liste.map((p) => p.standard), [true, false, false]);
    assert.deepEqual(liste.map((p) => p.pfad), [h.standard, h.firma, h.privat]);
  } finally { h.fertig(); }
  // nur ~/.claude.json im Home: das Standardprofil zählt (der Ordner entsteht beim Eintragen)
  const nur = tmp("kortex-profile-nur-");
  schreibe(nur, ".claude.json", "{}");
  assert.deepEqual(erkenneProfile(nur).map((p) => [p.name, p.standard]), [[".claude", true]]);
  assert.deepEqual(erkenneProfile(tmp("kortex-profile-leer-")), []);
});

test("Mehrere Profile: Stand je Profil; Eintragen und Entfernen nur in den gewählten; Pfade außerhalb der erkannten Liste werden abgelehnt", async () => {
  const h = mehrProfilHome();
  try {
    const e = einrichtung();
    const st = (await e.rufe("GET", "/api/kern/stand")).j;
    assert.deepEqual(st.profile.map((p) => p.pfad), [h.standard, h.firma, h.privat]);
    assert.deepEqual(Object.keys(st.claude.profile).sort(), [h.standard, h.firma, h.privat].sort());
    assert.ok(Object.values(st.claude.profile).every((p) => p.aktiv === false));

    // ohne Angabe: nur das Standardprofil
    let r = await e.rufe("POST", "/api/kern/verdrahten", { was: "claude", an: true });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    assert.equal(r.j.stand.claude.profile[h.standard].aktiv, true);
    assert.equal(r.j.stand.claude.profile[h.privat].aktiv, false);
    assert.equal(JSON.parse(readFileSync(join(h.standard, "settings.json"), "utf8")).model, "standard", "Fremdes bleibt");
    assert.ok(!existsSync(join(h.privat, "settings.json")), "ungewählte Profile bleiben unberührt");

    // Privat und Firma zusätzlich
    r = await e.rufe("POST", "/api/kern/verdrahten", { was: "claude", an: true, profile: [h.privat, h.firma] });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    for (const p of [h.standard, h.privat, h.firma]) assert.equal(r.j.stand.claude.profile[p].aktiv, true, p);
    for (const p of [h.standard, h.privat, h.firma]) {
      const text = readFileSync(join(p, "settings.json"), "utf8");
      assert.ok(alleBefehle(JSON.parse(text)).some((c) => c.startsWith(`[ -x ${q(e.starter)} ] && exec ${q(e.starter)} hook `)), p);
      assert.ok(!text.includes(e.version) && !text.includes("/kern/9.9.9"));
    }
    assert.ok(existsSync(join(h.privat, "commands")), "die Befehle liegen im Profilordner");

    // Rückweg nur für Privat
    r = await e.rufe("POST", "/api/kern/verdrahten", { was: "claude", an: false, profile: [h.privat] });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    assert.equal(r.j.stand.claude.profile[h.privat].aktiv, false);
    assert.equal(r.j.stand.claude.profile[h.firma].aktiv, true);
    assert.equal(r.j.stand.claude.profile[h.standard].aktiv, true);

    // abgelehnt: Pfade außerhalb der Liste, ein leeres Profil, ein Symlink, nichts gewählt
    const vorher = readFileSync(join(h.standard, "settings.json"), "utf8");
    for (const profile of [["/etc"], [h.leer], [join(h.heim, ".claude-link")], [join(h.standard, "..", ".claude-privat", "..", ".claude-leer")], [h.firma, "/tmp"]]) {
      r = await e.rufe("POST", "/api/kern/verdrahten", { was: "claude", an: true, profile });
      assert.equal(r.status, 409, JSON.stringify(profile)); assert.equal(r.j.art, "profil-weg");
    }
    r = await e.rufe("POST", "/api/kern/verdrahten", { was: "claude", an: true, profile: [] });
    assert.equal(r.status, 409); assert.equal(r.j.art, "kein-profil");
    r = await e.rufe("POST", "/api/kern/verdrahten", { was: "claude", an: true, profile: "alle" });
    assert.equal(r.status, 400);
    assert.equal(readFileSync(join(h.standard, "settings.json"), "utf8"), vorher);
    assert.ok(!existsSync(join(h.leer, "settings.json")));
  } finally { h.fertig(); }
});

// claude-Attrappe, die bei jedem Aufruf die Umgebungsvariable CLAUDE_CONFIG_DIR festhält.
function fakeClaudeMitProfil() {
  const bin = tmp("kortex-claudebin-"), log = join(bin, "aufrufe.log");
  writeFileSync(join(bin, "claude"), `#!/bin/sh\necho "dir=\${CLAUDE_CONFIG_DIR:-STANDARD} $*" >> '${log}'\ncase "$1 $2" in\n  "mcp get") echo "No MCP server found" >&2; exit 1;;\n  "mcp add") echo ok; exit 0;;\nesac\nexit 3\n`);
  chmodSync(join(bin, "claude"), 0o755);
  return { bin, aufrufe: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []) };
}

test("KI verbinden mit Claude je Profil: das Standardprofil ohne CLAUDE_CONFIG_DIR (~/.claude.json), ein anderes mit CLAUDE_CONFIG_DIR=<Profil> (<Profil>/.claude.json); unbekanntes Profil wird abgelehnt", async () => {
  const h = mehrProfilHome();
  const c = fakeClaudeMitProfil();
  const mcpDir = tmp("kortex-mcp-"); schreibe(mcpDir, "brain-mcp.mjs", "// fake\n");
  const altPfad = process.env.PATH, altEnv = process.env.CLAUDE_CONFIG_DIR, altExtra = process.env.BRAIN_CLAUDE_EXTRA;
  process.env.PATH = `${c.bin}:${altPfad}`; process.env.BRAIN_CLAUDE_EXTRA = "";
  process.env.CLAUDE_CONFIG_DIR = "/geerbt/aus/der/shell";   // so eine Variable darf das Standardprofil nie beeinflussen
  try {
    const rufe = aufruf(erzeugeHandler({ vault: vault(), mcpPfad: join(mcpDir, "brain-mcp.mjs"), vaultOptionen: { support: tmp("kortex-s-") } }));
    let r = await rufe("POST", "/api/mcp/verbinden", { ziel: "claude", profil: h.privat });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    r = await rufe("POST", "/api/mcp/verbinden", { ziel: "claude", profil: h.standard });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    const a = c.aufrufe();
    assert.deepEqual(a.map((z) => z.split(" ")[0]), [`dir=${h.privat}`, `dir=${h.privat}`, "dir=STANDARD", "dir=STANDARD"], a.join("\n"));
    r = await rufe("POST", "/api/mcp/verbinden", { ziel: "claude", profil: "/etc" });
    assert.equal(r.status, 400);
    r = await rufe("POST", "/api/mcp/verbinden", { ziel: "claude", profil: h.leer });
    assert.equal(r.status, 400);
    assert.equal(c.aufrufe().length, a.length, "bei abgelehntem Profil wird claude nicht gestartet");
  } finally {
    process.env.PATH = altPfad;
    if (altEnv === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = altEnv;
    if (altExtra === undefined) delete process.env.BRAIN_CLAUDE_EXTRA; else process.env.BRAIN_CLAUDE_EXTRA = altExtra;
    h.fertig();
  }
});

test("Hintergrunddienst mit Profil: ein anderes Profil kommt als CLAUDE_CONFIG_DIR in die plist, das Standardprofil nicht", { skip: process.platform !== "darwin" }, async () => {
  const h = mehrProfilHome();
  const fake = fakeLaunchctl();
  process.env.BRAIN_LAUNCHCTL = fake.skript;
  const altEnv = process.env.CLAUDE_CONFIG_DIR; delete process.env.CLAUDE_CONFIG_DIR;
  try {
    const e = einrichtung();
    const plist = join(h.heim, "Library", "LaunchAgents", "de.brain.tageslauf.plist");
    let r = await e.rufe("POST", "/api/kern/verdrahten", { was: "dienst", an: true, profil: h.privat });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    assert.ok(readFileSync(plist, "utf8").includes(`<key>CLAUDE_CONFIG_DIR</key><string>${h.privat}</string>`));
    r = await e.rufe("POST", "/api/kern/verdrahten", { was: "dienst", an: true, profil: h.standard });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    assert.ok(!readFileSync(plist, "utf8").includes("CLAUDE_CONFIG_DIR"));
    r = await e.rufe("POST", "/api/kern/verdrahten", { was: "dienst", an: true, profil: "/etc" });
    assert.equal(r.status, 409); assert.equal(r.j.art, "profil-weg");
    assert.equal((await e.rufe("POST", "/api/kern/verdrahten", { was: "dienst", an: false })).status, 200);
    assert.ok(!existsSync(plist));
  } finally { delete process.env.BRAIN_LAUNCHCTL; if (altEnv !== undefined) process.env.CLAUDE_CONFIG_DIR = altEnv; h.fertig(); }
});
