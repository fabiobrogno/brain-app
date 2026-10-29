import { nodeBefehl, KERN, shellQuote, hookBefehl, starterPfad } from "../pfade.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, mkdirSync, chmodSync, statSync, cpSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const KF = KERN.split("\\").join("/");   // der Kern, auf den die Hooks zeigen (nicht mehr der Vault)
const q = (p) => shellQuote(p);   // POSIX: einfache Anführungszeichen
// Erwarteter Hook-Befehl: macOS/Linux der Starter-Befehl (still bei fehlendem Starter, siehe pfade.mjs#hookBefehl), Windows Node mit dem Kern-Pfad.
const hk = (name, args = "") => (process.platform === "win32" ? `${nodeBefehl()} ${q(`${KF}/adapters/claude-code/${name}.mjs`)}${args}` : hookBefehl(starterPfad(), name, args));
// Gehört dieser Befehl zum Hook <name>? (neue Form `hook <name>`; auf Windows der Pfad)
const ist = (c, name) => typeof c === "string" && (process.platform === "win32" ? c.includes(`/claude-code/${name}.mjs`) : new RegExp(`kortex' hook ${name}(?: |$)`).test(c));
const inst = fileURLToPath(new URL("../adapters/claude-code/install.mjs", import.meta.url));
// HOME/USERPROFILE immer auf ein Temp-Verzeichnis: das echte ~/.claude wird nie gelesen oder geschrieben.
const TEMP_HOME = mkdtempSync(join(tmpdir(), "adapter-home-"));
const ohneGit = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
const lauf = (v, h, home = TEMP_HOME) => execFileSync(process.execPath, [inst, v, "--claude-home", h], { encoding: "utf8", env: { ...ohneGit(), HOME: home, USERPROFILE: home } });
const setup = () => { const h = mkdtempSync(join(tmpdir(), "ch-")), v = mkdtempSync(join(tmpdir(), "v ")); writeFileSync(join(v, "brain.config.json"), "{}");
  writeFileSync(join(h, "settings.json"), JSON.stringify({ model: "x", hooks: { Stop: [{ hooks: [{ type: "command", command: "afplay glass" }] }],
    SessionStart: [{ hooks: [{ type: "command", command: "fremd.sh" }] }] } })); return { h, v }; };

test("ergänzt, ersetzt nicht, legt Backup an", () => {
  const { h, v } = setup(); lauf(v, h);
  const s = JSON.parse(readFileSync(join(h, "settings.json"), "utf8"));
  assert.equal(s.model, "x");
  assert.ok(s.hooks.Stop[0].hooks[0].command === "afplay glass");
  const ss = s.hooks.SessionStart.flatMap(x => x.hooks.map(y => y.command));
  assert.ok(ss.includes("fremd.sh") && ss.some(c => ist(c, "session-start")));
  for (const e of ["UserPromptSubmit", "PreToolUse"]) assert.ok(s.hooks[e].some(x => x.hooks.some(y => ist(y.command, e === "UserPromptSubmit" ? "brain-hint" : "wiki-guard"))), e);
  assert.equal(readdirSync(h).filter(f => f.startsWith("settings.json.bak-")).length, 1);
  assert.ok(readdirSync(join(h, "commands")).includes("ingest.md"));
});
test("zweiter Lauf ist ohne Änderung", () => {
  const { h, v } = setup(); lauf(v, h); const vorher = readFileSync(join(h, "settings.json"), "utf8");
  assert.match(lauf(v, h), /unverändert/);
  assert.equal(readFileSync(join(h, "settings.json"), "utf8"), vorher);
  assert.equal(readdirSync(h).filter(f => f.startsWith("settings.json.bak-")).length, 1);
});
test("Hook-Befehle tragen keinen festen Vault (sie folgen dem aktiven Vault) und den Kern-Pfad POSIX-sicher gequotet", () => {
  const { h, v } = setup(); lauf(v, h);
  const cmd = JSON.parse(readFileSync(join(h, "settings.json"), "utf8")).hooks.UserPromptSubmit[0].hooks[0].command;
  assert.equal(cmd, hk("brain-hint"));
  assert.ok(!/--vault/.test(cmd) && !cmd.includes(v), cmd);
  const alle = JSON.stringify(JSON.parse(readFileSync(join(h, "settings.json"), "utf8")));
  assert.ok(!alle.includes("--vault") && !alle.includes(v.split("\\").join("/")), "weder --vault noch der Vault-Pfad steht in settings.json");
});

test("kaputtes settings.json: Exit 1, nichts geändert, kein Stacktrace", () => {
  const { h, v } = setup();
  const pfad = join(h, "settings.json");
  writeFileSync(pfad, "{ kaputt");
  const vorher = readFileSync(pfad, "utf8");
  let err = "", status = 0;
  try { lauf(v, h); assert.fail("hätte mit Exit 1 abbrechen müssen"); }
  catch (e) { status = e.status; err = String(e.stderr || ""); }
  assert.equal(status, 1);
  assert.match(err, /kein gültiges JSON/);
  assert.doesNotMatch(err, /^\s*at /m, `Stacktrace im stderr: ${err}`);
  assert.doesNotMatch(err, /SyntaxError/);
  assert.equal(readFileSync(pfad, "utf8"), vorher);
  assert.equal(readdirSync(h).filter(f => f.startsWith("settings.json.bak-")).length, 0);
});

test("kaputtes settings.json + fremder Command commands/ingest.md (Fix round 2 — Regression aus Round 1): Exit 1, Command UND settings.json byte-identisch, kein Backup irgendwo", () => {
  const { h, v } = setup();
  const pfad = join(h, "settings.json");
  writeFileSync(pfad, "{ kaputt");
  const vorherSettings = readFileSync(pfad, "utf8");
  const cmdDir = join(h, "commands");
  mkdirSync(cmdDir, { recursive: true });
  const ingestPfad = join(cmdDir, "ingest.md");
  const vorherIngest = "# Mein eigener Ingest-Command\nNicht von brain-kit, keine Marke.\n";
  writeFileSync(ingestPfad, vorherIngest);
  let err = "", status = 0;
  try { lauf(v, h); assert.fail("hätte mit Exit 1 abbrechen müssen"); }
  catch (e) { status = e.status; err = String(e.stderr || ""); }
  assert.equal(status, 1);
  assert.match(err, /kein gültiges JSON/);
  assert.doesNotMatch(err, /^\s*at /m, `Stacktrace im stderr: ${err}`);
  assert.equal(readFileSync(pfad, "utf8"), vorherSettings, "settings.json muss unverändert bleiben");
  assert.equal(readFileSync(ingestPfad, "utf8"), vorherIngest, "der fremde Command darf nicht angefasst werden — settings.json wird zuerst geprüft");
  assert.equal(readdirSync(h).filter(f => f.startsWith("settings.json.bak-")).length, 0);
  assert.equal(readdirSync(cmdDir).filter(f => f.startsWith("ingest.md.bak-")).length, 0, "kein Backup des fremden Commands");
});

test("ersetzt ältere Brain-Hooks derselben Vault statt zu duplizieren (.sh/.mjs, quotiert/unquotiert)", () => {
  const h = mkdtempSync(join(tmpdir(), "ch-"));
  const v = mkdtempSync(join(tmpdir(), "v2 "));
  writeFileSync(join(v, "brain.config.json"), "{}");
  const vf = v.split("\\").join("/");
  writeFileSync(join(h, "settings.json"), JSON.stringify({
    hooks: {
      SessionStart: [
        { hooks: [{ type: "command", command: `node "${vf}/.tools/session-start.mjs"` }] },
        { hooks: [{ type: "command", command: "fremd.sh" }] },
      ],
      UserPromptSubmit: [{ hooks: [{ type: "command", command: `node ${vf}/.tools/brain-hint.mjs` }] }],
      PreToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: `node "${vf}/.tools/wiki-guard.sh"` }] }],
    },
    statusLine: { type: "command", command: `node "${vf}/.tools/statusline.sh"` },
  }));
  const out = lauf(v, h);
  assert.match(out, /~ Hook PreToolUse ersetzt \(alte Fassung, matcher angepasst\)/, out);
  const s = JSON.parse(readFileSync(join(h, "settings.json"), "utf8"));
  for (const [e, datei] of [["SessionStart", "session-start.mjs"], ["UserPromptSubmit", "brain-hint.mjs"], ["PreToolUse", "wiki-guard.mjs"]]) {
    const cmds = s.hooks[e].flatMap(x => x.hooks.map(y => y.command));
    assert.equal(cmds.filter(c => ist(c, datei.replace(".mjs", ""))).length, 1, `${e}: ${JSON.stringify(cmds)}`);
  }
  const sessionCmds = s.hooks.SessionStart.flatMap(x => x.hooks.map(y => y.command));
  assert.ok(sessionCmds.includes("fremd.sh"), "fremder Hook im selben Event muss überleben");
  assert.equal(s.statusLine.command, hk("statusline"));
  assert.equal(s.hooks.PreToolUse[0].matcher, "Edit|Write|MultiEdit|NotebookEdit", "matcher muss beim Ersetzen auf den Zielwert gesetzt werden");
  assert.equal(s.hooks.PreToolUse.length, 3, "wiki-guard ersetzt + eigene Einträge für Werkzeug-Protokoll und Regeln am Read");
  assert.match(lauf(v, h), /unverändert/);
});

test("alter PreToolUse-Eintrag mit schon korrektem matcher: kein 'matcher angepasst' im Log", () => {
  const h = mkdtempSync(join(tmpdir(), "ch-"));
  const v = mkdtempSync(join(tmpdir(), "v5 "));
  writeFileSync(join(v, "brain.config.json"), "{}");
  const vf = v.split("\\").join("/");
  writeFileSync(join(h, "settings.json"), JSON.stringify({
    hooks: { PreToolUse: [{ matcher: "Edit|Write|MultiEdit|NotebookEdit", hooks: [{ type: "command", command: `node "${vf}/.tools/wiki-guard.sh"` }] }] },
  }));
  const out = lauf(v, h);
  assert.match(out, /~ Hook PreToolUse ersetzt \(alte Fassung\)$/m, out);
  assert.doesNotMatch(out, /matcher angepasst/, out);
});

test("entfernt veraltete Brain-Hooks, auch wenn schon ein aktueller Eintrag existiert", () => {
  const h = mkdtempSync(join(tmpdir(), "ch-"));
  const v = mkdtempSync(join(tmpdir(), "v6 "));
  writeFileSync(join(v, "brain.config.json"), "{}");
  const vf = v.split("\\").join("/");
  const aktuell = `node "${vf}/.tools/adapters/claude-code/session-start.mjs"`;
  writeFileSync(join(h, "settings.json"), JSON.stringify({
    hooks: {
      SessionStart: [
        { hooks: [{ type: "command", command: aktuell }] },
        { hooks: [{ type: "command", command: `node "${vf}/.tools/session-start.sh"` }] },
        { hooks: [{ type: "command", command: "fremd.sh" }] },
      ],
    },
  }));
  const out = lauf(v, h);
  assert.match(out, /- Hook SessionStart entfernt \(alte Fassung\)/, out);
  const s = JSON.parse(readFileSync(join(h, "settings.json"), "utf8"));
  const cmds = s.hooks.SessionStart.flatMap(x => x.hooks.map(y => y.command));
  assert.equal(cmds.filter(c => ist(c, "session-start")).length, 1, JSON.stringify(cmds));
  assert.ok(cmds.includes("fremd.sh"), "fremder Hook im selben Event muss überleben");
  assert.ok(!cmds.some(c => c.includes("/.tools/session-start.sh")), "veralteter Eintrag muss weg sein");
  assert.equal(s.hooks.SessionStart.length, 2, "leer gewordener Eintrag muss entfernt werden");
  assert.match(lauf(v, h), /unverändert/);
});

test("ersetzt die $HOME/brain-Schreibweise, wenn Vault == homedir()/brain", () => {
  const H = mkdtempSync(join(tmpdir(), "home-"));
  const v = join(H, "brain");
  mkdirSync(v, { recursive: true });
  writeFileSync(join(v, "brain.config.json"), "{}");
  const h = mkdtempSync(join(tmpdir(), "ch-"));
  writeFileSync(join(h, "settings.json"), JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: "command", command: 'node "$HOME/brain/.tools/session-start.mjs"' }] }] },
  }));
  lauf(v, h, H); // Windows: homedir() liest USERPROFILE
  const s = JSON.parse(readFileSync(join(h, "settings.json"), "utf8"));
  const cmds = s.hooks.SessionStart.flatMap(x => x.hooks.map(y => y.command));
  assert.equal(cmds.filter(c => ist(c, "session-start")).length, 1, JSON.stringify(cmds));
  assert.ok(!cmds.some(c => c.includes("$HOME/brain/.tools/session-start.mjs")), "alte $HOME-Form noch vorhanden");
});

test("~/.claude/commands existiert als reguläre Datei statt als Ordner: Exit 1, ein Alltagssatz, settings.json unverändert, kein Backup, kein Stacktrace", () => {
  const { h, v } = setup();
  const pfad = join(h, "settings.json");
  const vorher = readFileSync(pfad, "utf8");
  writeFileSync(join(h, "commands"), "ich bin eine Datei, kein Ordner");
  let err = "", status = 0;
  try { lauf(v, h); assert.fail("hätte mit Exit 1 abbrechen müssen"); }
  catch (e) { status = e.status; err = String(e.stderr || ""); }
  assert.equal(status, 1);
  assert.doesNotMatch(err, /^\s*at /m, `Stacktrace im stderr: ${err}`);
  assert.doesNotMatch(err, /Error:|ENOTDIR|EEXIST/);
  assert.equal(err.trim().split("\n").length, 1, `genau EIN Alltagssatz erwartet: ${JSON.stringify(err)}`);
  assert.equal(readFileSync(pfad, "utf8"), vorher, "settings.json darf unverändert bleiben");
  assert.equal(readdirSync(h).filter(f => f.startsWith("settings.json.bak-")).length, 0);
  assert.equal(readFileSync(join(h, "commands"), "utf8"), "ich bin eine Datei, kein Ordner", "die Datei commands darf nicht angefasst werden");
});

test("unerwartet kaputte Hook-Struktur (hooks:42 statt Array): Exit 1, Alltagssatz ohne Stacktrace, nichts geschrieben", () => {
  const { h, v } = setup();
  const pfad = join(h, "settings.json");
  const vorAlles = JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: 42 }] } });
  writeFileSync(pfad, vorAlles);
  let err = "", status = 0;
  try { lauf(v, h); assert.fail("hätte mit Exit 1 abbrechen müssen"); }
  catch (e) { status = e.status; err = String(e.stderr || ""); }
  assert.equal(status, 1);
  assert.doesNotMatch(err, /^\s*at /m, `Stacktrace im stderr: ${err}`);
  assert.doesNotMatch(err, /TypeError/);
  assert.ok(err.trim().length > 0, "muss einen Alltagssatz melden");
  assert.equal(readFileSync(pfad, "utf8"), vorAlles, "darf bei unerwartetem Fehler nichts geschrieben haben");
  assert.equal(readdirSync(h).filter(f => f.startsWith("settings.json.bak-")).length, 0);
});

test("fremder Hook ohne command (type:'prompt') neben altem Brain-Eintrag: Installer stürzt nicht ab, prompt-Hook bleibt unverändert", () => {
  const h = mkdtempSync(join(tmpdir(), "ch-"));
  const v = mkdtempSync(join(tmpdir(), "v7 "));
  writeFileSync(join(v, "brain.config.json"), "{}");
  const vf = v.split("\\").join("/");
  const promptHook = { type: "prompt", prompt: "Denk dran, höflich zu bleiben." };
  writeFileSync(join(h, "settings.json"), JSON.stringify({
    hooks: {
      UserPromptSubmit: [
        { hooks: [{ type: "command", command: `node "${vf}/.tools/brain-hint.mjs"` }] }, // alter Brain-Eintrag
        { hooks: [promptHook] }, // fremder Hook ohne command-Feld
      ],
    },
  }));
  const out = lauf(v, h); // darf nicht werfen/abstürzen (kein TypeError auf h.command.includes)
  assert.doesNotMatch(out, /^\s*at /m, out);
  const s = JSON.parse(readFileSync(join(h, "settings.json"), "utf8"));
  const eintraege = s.hooks.UserPromptSubmit;
  const promptEintrag = eintraege.flatMap(x => x.hooks).find(x => x.type === "prompt");
  assert.deepEqual(promptEintrag, promptHook, "fremder prompt-Hook muss unverändert bleiben");
  const cmds = eintraege.flatMap(x => x.hooks).filter(x => typeof x.command === "string").map(x => x.command);
  assert.equal(cmds.filter(c => ist(c, "brain-hint")).length, 1, JSON.stringify(cmds));
  assert.ok(!cmds.some(c => c.includes(`${vf}/.tools/brain-hint.mjs`)), "veralteter Eintrag muss ersetzt sein");
});

test("Hook-Befehle laufen über den Starter (kein fester Node-/Kern-Pfad); alter Eintrag mit nacktem node wird darauf gehoben", () => {
  const h = mkdtempSync(join(tmpdir(), "ch-")), v = mkdtempSync(join(tmpdir(), "v3 ")); writeFileSync(join(v, "brain.config.json"), "{}");
  const vf = v.split("\\").join("/");
  writeFileSync(join(h, "settings.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: `node "${vf}/.tools/adapters/claude-code/session-start.mjs"` }] }] },
    statusLine: { type: "command", command: `node "${vf}/.tools/adapters/claude-code/statusline.mjs"` } }));
  lauf(v, h);
  const s = JSON.parse(readFileSync(join(h, "settings.json"), "utf8"));
  for (const [e, n] of [["SessionStart", 1], ["UserPromptSubmit", 1], ["PreToolUse", 3], ["SessionEnd", 2], ["PreCompact", 2]]) {
    const cmds = s.hooks[e].flatMap(x => x.hooks.map(y => y.command)).filter(c => c.includes(" hook ") || c.includes("/adapters/claude-code/"));
    assert.equal(cmds.length, n, `${e}: ${JSON.stringify(cmds)}`);
    for (const c of cmds) {
      assert.ok(!c.includes("--vault") && !c.includes("node-start.sh") && !c.includes(".tools"), c);
      if (process.platform !== "win32") assert.ok(c.startsWith(`[ -x ${q(starterPfad())} ] && exec ${q(starterPfad())} hook `) && c.endsWith(" || exit 0"), c);
    }
  }
  assert.equal(s.statusLine.command, hk("statusline"));
  const cmdDir = join(h, "commands");
  assert.ok(readdirSync(cmdDir).includes("brain-backup.md"));
  assert.ok(!readdirSync(cmdDir).includes("update.md") && !readdirSync(cmdDir).includes("backup.md"));
});

// ---------- v0.3: Werkzeug-Protokoll, Ernte-Auslöser ----------
const befehle = (s, e) => (s.hooks[e] || []).flatMap(x => (x.hooks || []).map(y => y.command)).filter(c => typeof c === "string");
const lies = (h) => JSON.parse(readFileSync(join(h, "settings.json"), "utf8"));

test("v0.3: registriert Werkzeug-Protokoll (eigener PreToolUse-Eintrag), SessionEnd und PreCompact-Ernte — je genau einmal, auch nach zwei Läufen", () => {
  const { h, v } = setup(); lauf(v, h); lauf(v, h);
  const s = lies(h);
  const ptu = s.hooks.PreToolUse;
  const wg = ptu.filter(x => x.hooks.some(y => ist(y.command, "wiki-guard")));
  const wp = ptu.filter(x => x.hooks.some(y => ist(y.command, "werkzeug-protokoll")));
  assert.equal(wg.length, 1); assert.equal(wp.length, 1);
  assert.equal(wg[0].matcher, "Edit|Write|MultiEdit|NotebookEdit", "wiki-guard-Matcher unverändert");
  assert.equal(wp[0].matcher, "Read|mcp__.*");
  assert.notEqual(wg[0], wp[0]);
  assert.equal(wp[0].hooks.length, 1, "eigener Eintrag nur mit dem Protokoll-Hook");
  const se = befehle(s, "SessionEnd");
  assert.equal(se.filter(c => c === hk("ernte-ausloeser", " --art fakt")).length, 1, JSON.stringify(se));
  const pc = befehle(s, "PreCompact");
  assert.equal(pc.filter(c => c.startsWith("echo ") && c.includes("handoff")).length, 0, JSON.stringify(pc));
  assert.equal(pc.filter(c => ist(c, "kompakt-sichern")).length, 1, JSON.stringify(pc));
  assert.equal(pc.filter(c => c === hk("ernte-ausloeser", " --art fakt")).length, 1, JSON.stringify(pc));
  assert.equal(readdirSync(h).filter(f => f.startsWith("settings.json.bak-")).length, 1, "zweiter Lauf: kein neues Backup");
  // fremde Hooks unverändert
  assert.equal(s.hooks.Stop[0].hooks[0].command, "afplay glass");
  assert.ok(befehle(s, "SessionStart").includes("fremd.sh"));
});

test("v0.3: fremder PreToolUse-Eintrag mit Matcher Read (Fremd-Plugin) bleibt unverändert, Brain-Einträge kommen dazu", () => {
  const h = mkdtempSync(join(tmpdir(), "ch-")), v = mkdtempSync(join(tmpdir(), "v8 ")); writeFileSync(join(v, "brain.config.json"), "{}");
  const fremd = { matcher: "Read", hooks: [{ type: "command", command: "node /opt/fremd-plugin/lese-hook.mjs" }] };
  const fremdSE = { hooks: [{ type: "command", command: "fremd-ende.sh" }] };
  writeFileSync(join(h, "settings.json"), JSON.stringify({ hooks: { PreToolUse: [fremd], SessionEnd: [fremdSE] } }));
  lauf(v, h);
  const s = lies(h);
  assert.deepEqual(s.hooks.PreToolUse[0], fremd, "fremder Read-Eintrag byte-gleich");
  assert.equal(s.hooks.PreToolUse.length, 4);
  assert.deepEqual(s.hooks.SessionEnd[0], fremdSE);
  assert.equal(befehle(s, "SessionEnd").length, 3);
  assert.match(lauf(v, h), /unverändert/);
});

test("v0.3: Eintrag mit nacktem node für den Ernte-Auslöser wird auf den absoluten Node-Pfad gehoben, nicht verdoppelt", () => {
  const h = mkdtempSync(join(tmpdir(), "ch-")), v = mkdtempSync(join(tmpdir(), "v9 ")); writeFileSync(join(v, "brain.config.json"), "{}");
  const vf = v.split("\\").join("/");
  writeFileSync(join(h, "settings.json"), JSON.stringify({ hooks: { SessionEnd: [{ hooks: [{ type: "command", command: `node "${vf}/.tools/adapters/claude-code/ernte-ausloeser.mjs" --art fakt` }] }] } }));
  lauf(v, h);
  const se = befehle(lies(h), "SessionEnd").filter(c => c.includes("ernte-ausloeser"));
  assert.equal(se.length, 1, JSON.stringify(se));
  assert.equal(se[0], hk("ernte-ausloeser", " --art fakt"));
});

// ---------- v0.6 (M2a): Arbeitsstand statt echo-Hinweis, Sitzungsende, Regeln am Read ----------
test("M2a: alter echo-Hinweis „Skill handoff“ wird entfernt; kompakt-sichern, sitzung-ende und regeln-lesen (Read) je genau einmal", () => {
  const h = mkdtempSync(join(tmpdir(), "ch-")), v = mkdtempSync(join(tmpdir(), "v10 Ü ")); writeFileSync(join(v, "brain.config.json"), "{}");
  const echo = "echo 'Kontext-Kompression steht bevor: offenen Arbeitsstand sichern (Skill handoff).'";
  writeFileSync(join(h, "settings.json"), JSON.stringify({ hooks: { PreCompact: [{ hooks: [{ type: "command", command: echo }, { type: "command", command: "fremd-pc.sh" }] }] } }));
  const out = lauf(v, h);
  assert.match(out, /- Hook PreCompact entfernt \(Hinweis „Skill handoff“/, out);
  lauf(v, h);
  const s = lies(h);
  const pc = befehle(s, "PreCompact");
  assert.equal(pc.filter((c) => c.startsWith("echo ")).length, 0, JSON.stringify(pc));
  assert.ok(pc.includes("fremd-pc.sh"), "fremder PreCompact-Hook bleibt");
  assert.equal(pc.filter((c) => ist(c, "kompakt-sichern")).length, 1);
  assert.equal(befehle(s, "SessionEnd").filter((c) => ist(c, "sitzung-ende")).length, 1);
  const rl = s.hooks.PreToolUse.filter((x) => x.hooks.some((y) => ist(y.command, "regeln-lesen")));
  assert.equal(rl.length, 1);
  assert.equal(rl[0].matcher, "Read");
  assert.equal(rl[0].hooks.length, 1, "eigener Eintrag");
  assert.match(lauf(v, h), /unverändert/);
});

test("B3: Eintrag mit festem Node-Pfad wird auf node-start.sh gehoben, nicht verdoppelt", { skip: process.platform === "win32" }, () => {
  const { h, v } = setup();
  const vf = v.split("\\").join("/");
  writeFileSync(join(h, "settings.json"), JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command",
    command: `"/opt/homebrew/bin/node" "${vf}/.tools/adapters/claude-code/brain-hint.mjs"` }] }] } }));
  lauf(v, h);
  const c = JSON.parse(readFileSync(join(h, "settings.json"), "utf8")).hooks.UserPromptSubmit.flatMap((x) => x.hooks.map((y) => y.command));
  assert.deepEqual(c, [hk("brain-hint")]);
});


// ---------- Review-Fixes zu P2: Hooks folgen dem aktiven Vault, atomar, nur mit stabilem Kern ----------
test("Hooks sind vault-unabhängig: Einträge mit --vault oder fremdem Vault/Kern-Ort werden ersetzt, fremde Hooks bleiben, ein zweiter Lauf ändert nichts", () => {
  const { h, v } = setup();
  const anderer = mkdtempSync(join(tmpdir(), "anderer-vault ")).split("\\").join("/");
  writeFileSync(join(h, "settings.json"), JSON.stringify({ hooks: {
    SessionStart: [{ hooks: [{ type: "command", command: "fremd.sh" }, { type: "command", command: `/bin/sh "/alter/kern/node-start.sh" "/alter/kern/adapters/claude-code/session-start.mjs" --vault "${anderer}"` }] }],
    UserPromptSubmit: [{ hooks: [{ type: "command", command: `node "${anderer}/.tools/adapters/claude-code/brain-hint.mjs"` }] }],
    SessionEnd: [{ hooks: [{ type: "command", command: `/bin/sh "/alter/kern/node-start.sh" "/alter/kern/adapters/claude-code/ernte-ausloeser.mjs" --art fakt --vault "${anderer}"` }] },
      { hooks: [{ type: "command", command: `/bin/sh "/alter/kern/node-start.sh" "/alter/kern/adapters/claude-code/ernte-ausloeser.mjs" --art fakt` }] }],
  } }));
  lauf(v, h);
  const s = lies(h);
  assert.deepEqual(befehle(s, "SessionStart"), ["fremd.sh", hk("session-start")]);
  assert.deepEqual(befehle(s, "UserPromptSubmit"), [hk("brain-hint")]);
  assert.deepEqual(befehle(s, "SessionEnd").filter((c) => c.includes("ernte-ausloeser")), [hk("ernte-ausloeser", " --art fakt")], "Dublette entfernt");
  const vorher = readFileSync(join(h, "settings.json"), "utf8");
  assert.match(lauf(v, h), /unverändert/);
  assert.equal(readFileSync(join(h, "settings.json"), "utf8"), vorher);
});

test("settings.json wird atomar geschrieben (Temp + rename, keine Reste) und behält die Dateirechte", { skip: process.platform === "win32" }, () => {
  const { h, v } = setup();
  const datei = join(h, "settings.json");
  chmodSync(datei, 0o640);
  lauf(v, h);
  assert.equal(statSync(datei).mode & 0o777, 0o640);
  assert.deepEqual(readdirSync(h).filter((f) => f.includes(".tmp-")), []);
  assert.ok(JSON.parse(readFileSync(datei, "utf8")).hooks.SessionStart.length >= 2);
});

test("Ohne stabilen Kern-Pfad (KORTEX_KERN_PFAD fehlt oder ist unbeständig) trägt der Installer nichts ein: Exit 3 mit klarer Meldung", () => {
  const { h, v } = setup();
  const vorher = readFileSync(join(h, "settings.json"), "utf8");
  const ohne = { ...ohneGit(), HOME: TEMP_HOME, USERPROFILE: TEMP_HOME, KORTEX_KERN_UNSTABIL_ERLAUBT: "" };
  delete ohne.KORTEX_KERN_PFAD;
  for (const extra of [{}, { KORTEX_KERN_PFAD: "relativ/kern" }, { KORTEX_KERN_PFAD: join(tmpdir(), "gibt-es-nicht") }, { KORTEX_KERN_PFAD: tmpdir() }, { KORTEX_KERN_PFAD: "/Applications/Kortex.app/Contents/Resources/kern" }]) {
    const r = spawnSync(process.execPath, [inst, v, "--claude-home", h], { encoding: "utf8", env: { ...ohne, ...extra } });
    assert.equal(r.status, 3, `${JSON.stringify(extra)}: ${r.stderr}`);
    assert.match(r.stderr, /stabilen Kern-Pfad/);
  }
  assert.equal(readFileSync(join(h, "settings.json"), "utf8"), vorher, "nichts geändert");
  assert.equal(readdirSync(h).filter((f) => f.startsWith("settings.json.bak-")).length, 0);
});

test("Starter-Pfad mit $(), Backtick, \" und ' im Namen: die Hook-Befehle führt eine echte Shell als genau diesen Starter aus, nichts wird ausgeführt", { skip: process.platform === "win32" }, () => {
  const arbeitsdir = mkdtempSync(join(tmpdir(), "inj-arbeit "));                       // eine Injektion würde hier pwned1/pwned2 anlegen
  const bin = join(mkdtempSync(join(tmpdir(), "inj-starter ")), `bin "x" it's $(touch pwned1) \`touch pwned2\``);
  mkdirSync(bin);
  const starterDatei = join(bin, "kortex");
  writeFileSync(starterDatei, '#!/bin/sh\nprintf "ARGS:%s\\n" "$*"\n'); chmodSync(starterDatei, 0o755);
  const { h, v } = setup();
  execFileSync(process.execPath, [inst, v, "--claude-home", h], { encoding: "utf8", cwd: arbeitsdir, env: { ...ohneGit(), HOME: TEMP_HOME, USERPROFILE: TEMP_HOME, KORTEX_STARTER_PFAD: starterDatei } });
  const cmd = lies(h).hooks.UserPromptSubmit.flatMap((x) => x.hooks.map((y) => y.command))[0];
  assert.equal(cmd, hookBefehl(starterDatei, "brain-hint"));
  assert.ok(!cmd.includes(KERN), "kein Kern-Pfad in settings.json, nur der Starter");
  const r = spawnSync("/bin/sh", ["-c", cmd], { encoding: "utf8", cwd: arbeitsdir });
  assert.equal(r.stdout, "ARGS:hook brain-hint\n", r.stderr);
  assert.equal(r.status, 0);
  assert.deepEqual(readdirSync(arbeitsdir), [], "kein eingeschleuster Befehl ist gelaufen");
});
