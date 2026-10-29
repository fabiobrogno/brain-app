// Einrichtung verdrahten (Kern-Umzug P6): Claude-Code-Hooks, Prüfung vor dem Speichern und Hintergrunddienst über den STARTER der App.
// Nur Wegwerf-Ordner: eigenes HOME, eigener Support-Ordner mit nachgebautem bin/kern und bin/kortex, launchctl nur als Attrappe.
// Nie das echte ~/.claude, nie ~/Library/LaunchAgents, nie das echte launchctl.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, cpSync, symlinkSync, readdirSync } from "node:fs";
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
  assert.equal(st.claude.aktiv, false);

  const r = await e.rufe("POST", "/api/kern/verdrahten", { was: "claude", an: true });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.stand.claude.aktiv, true);
  assert.equal(r.j.stand.claude.statuszeile, "brain");
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
  assert.equal(aus.j.stand.claude.aktiv, false);
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

test("Hintergrunddienst: LaunchAgent zeigt auf bin/kern; Attrappe statt launchctl; Rückweg entfernt die Datei", { skip: process.platform !== "darwin" }, async () => {
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
    assert.ok(text.includes(`${e.kern}/node-start.sh`) && text.includes(`${e.kern}/brain.mjs`), text);
    ohneVersionOderApp(text, e);
    assert.ok(fake.aufrufe().some((a) => a.startsWith("bootstrap")), "nur die Attrappe wurde gerufen");
    assert.equal(r.j.stand.dienst.eingerichtet, true);

    const aus = await e.rufe("POST", "/api/kern/verdrahten", { was: "dienst", an: false });
    assert.equal(aus.status, 200, JSON.stringify(aus.j));
    assert.ok(!existsSync(plist));
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
