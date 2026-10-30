// KI-Konten (docs/plaene/ki-konten.md, P1): die Hooks von Claude Code liefern für einen Vault, den ihr Konto nicht sehen darf, NICHTS — keine Ausgabe, keine Datei im Vault.
// Schreibende Hooks (Ernte, Lektionen, W7, Gedächtnis-Teilen) brauchen mindestens „posteingang“. Das Konto kommt aus --konto (Hook-Befehl) und der Umgebung; bei Widerspruch gilt
// das strengere Recht; eine beschädigte oder verlinkte Liste heißt gesperrt. Jede Kindprozess-Umgebung wird ausdrücklich gebaut (baueTestUmgebung), keine Variable vom Rechner kommt hinein.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync, symlinkSync, rmSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { baueTestUmgebung } from "./konto-hilfe.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
const ADAPTER = join(HIER, "..", "adapters", "claude-code");
const hook = (n) => join(ADAPTER, `${n}.mjs`);
const temp = (p) => realpathSync(mkdtempSync(join(tmpdir(), p)));
const HOME = temp("konto-home-");
const LEER_PATH = temp("konto-leerer-path-");
const FAKE = temp("konto-fake-");
// Attrappen für die losgelösten Läufe der Ernte: schreiben nur eine Marke
for (const n of ["ernte", "lektionen", "w7"]) writeFileSync(join(FAKE, `${n}.mjs`), `import { writeFileSync } from "node:fs"; writeFileSync(process.env.FAKE_MARKE, JSON.stringify({ args: process.argv.slice(2) }));\n`);

const kennung = (p) => { const st = statSync(p); return `${st.dev}:${st.ino}:${st.birthtimeMs}`; };
const profil = (n) => { const p = join(HOME, n ? `.claude-${n}` : ".claude"); mkdirSync(p, { recursive: true }); return realpathSync(p); };
const PROFIL_A = profil("a"), PROFIL_B = profil("b"), PROFIL_STD = profil("");

function szenario({ automatik = {}, stufeA = "posteingang", stufeB = "gesperrt", stufeStd = "gesperrt", ohneKonto = "gesperrt" } = {}) {
  const support = temp("konto-support-");
  const vault = temp("konto vault, Jo's Ü ");
  writeFileSync(join(vault, "brain.config.json"), JSON.stringify({ automatik }));
  mkdirSync(join(vault, "00_inbox")); mkdirSync(join(vault, "09_wiki"));
  writeFileSync(join(vault, "00_inbox", "n.md"), "# N\n\nEine Notiz.\n");
  const schreibeListe = (a = stufeA, b = stufeB, std = stufeStd) => writeFileSync(join(support, "ki-konten.json"), JSON.stringify({ version: 1,
    konten: {
      k_aaaaaaaa: { programm: "claude", ordner: PROFIL_A, standard: false, name: "A", ordnerKennung: kennung(PROFIL_A) },
      k_bbbbbbbb: { programm: "claude", ordner: PROFIL_B, standard: false, name: "B", ordnerKennung: kennung(PROFIL_B) },
      k_cccccccc: { programm: "claude", ordner: PROFIL_STD, standard: true, name: "Standard", ordnerKennung: kennung(PROFIL_STD) },
    },
    vaults: { [vault]: { ordnerKennung: kennung(vault), neueKonten: "gesperrt", ohneKonto, konten: { k_aaaaaaaa: a, k_bbbbbbbb: b, k_cccccccc: std } } } }));
  schreibeListe();
  return { support, vault, schreibeListe };
}
const baum = (d, rel = "") => readdirSync(join(d, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? [`${join(rel, e.name)}/`, ...baum(d, join(rel, e.name))] : [join(rel, e.name)])).sort();
const umgebung = (s, extra = {}) => baueTestUmgebung({ HOME, BRAIN_APP_SUPPORT: s.support, KORTEX_KERN_UNSTABIL_ERLAUBT: "1", KORTEX_VAULT_VERTRAUT: "alle", BRAIN_EINMAL: "aus", BRAIN_VAULT: s.vault, PATH: LEER_PATH, ...extra });
// Ein Hook aus Profil A läuft in einer Sitzung mit CLAUDE_CONFIG_DIR=<Profil A> (so wählt der Nutzer das Profil); ohneProfil:true lässt die Variable weg (Standardprofil).
function lauf(name, s, { args = [], eingabe = {}, env = {}, ohneProfil = false } = {}) {
  const profilEnv = ohneProfil || Object.hasOwn(env, "CLAUDE_CONFIG_DIR") ? {} : { CLAUDE_CONFIG_DIR: PROFIL_A };
  const r = spawnSync(process.execPath, [hook(name), ...args], { input: JSON.stringify(eingabe), env: umgebung(s, { ...profilEnv, ...env }), encoding: "utf8", cwd: s.vault });
  return { code: r.status, aus: r.stdout, fehler: r.stderr };
}
const ALLE_LESENDEN = ["session-start", "brain-hint", "statusline", "regeln-lesen", "kompakt-sichern", "werkzeug-protokoll", "sitzung-ende"];
const eingabeFuer = (name) => ({ session_id: `sitzung-${name}`, prompt: "Wie ist der Stand zu meinem Projekt?", cwd: HOME, tool_name: "mcp__brain__brain_suchen", tool_input: { frage: "x" }, tool_use_id: `id-${name}`, hook_event_name: name, source: "startup", transcript_path: "" });
const hookEnv = { BRAIN_SESSION_NUR_STATUS: "1" };

test("gesperrt: kein Hook liefert eine Ausgabe oder schreibt etwas in den Vault (auch nicht .logs)", () => {
  const s = szenario({ stufeA: "gesperrt" });
  const vorher = baum(s.vault);
  for (const n of ALLE_LESENDEN) {
    const r = lauf(n, s, { args: ["--konto", "k_aaaaaaaa"], eingabe: eingabeFuer(n), env: hookEnv });
    assert.equal(r.code, 0, `${n}: ${r.fehler}`); assert.equal(r.aus, "", `${n} ist still`); assert.equal(r.fehler, "", `${n} meldet nichts auf stderr`);
  }
  assert.deepEqual(baum(s.vault), vorher, "im Vault ist nichts entstanden");
});

test("lesen: die Hooks arbeiten wie bisher (Gegenprobe: derselbe Aufruf liefert hier Ausgabe)", () => {
  const s = szenario({ stufeA: "lesen" });
  for (const n of ["statusline", "session-start"]) {
    const r = lauf(n, s, { args: ["--konto", "k_aaaaaaaa"], eingabe: eingabeFuer(n), env: hookEnv });
    assert.equal(r.code, 0, r.fehler); assert.notEqual(r.aus.trim(), "", `${n} liefert bei lesen eine Ausgabe`);
  }
  const t = lauf("werkzeug-protokoll", s, { args: ["--konto", "k_aaaaaaaa"], eingabe: eingabeFuer("werkzeug-protokoll") });
  assert.equal(t.code, 0); assert.ok(existsSync(join(s.vault, ".logs")), "das Werkzeug-Protokoll läuft bei lesen");
});

test("wiki-guard: für ein gesperrtes Konto wird Schreiben unter den Vault verweigert (Exit 2, ohne den Vault zu nennen), anderswo bleibt er still; sonst gilt seine übliche Regel", () => {
  const s = szenario({ stufeA: "gesperrt" });
  const imVault = join(s.vault, "00_inbox", "neu.md"), draussen = join(HOME, "irgendwo.md");
  const e = (datei) => ({ tool_name: "Write", tool_input: { file_path: datei }, cwd: HOME });
  let r = lauf("wiki-guard", s, { args: ["--konto", "k_aaaaaaaa"], eingabe: e(imVault) });
  assert.equal(r.code, 2); assert.match(r.fehler, /nicht freigegeben/); assert.ok(!r.fehler.includes(s.vault) && !r.fehler.includes("konto vault"));
  r = lauf("wiki-guard", s, { args: ["--konto", "k_aaaaaaaa"], eingabe: e(draussen) });
  assert.equal(r.code, 0); assert.equal(r.aus + r.fehler, "");
  // mit Stufe: die gewohnte Regel (hier: Posteingang frei, Wiki nur mit /ingest)
  s.schreibeListe("posteingang");
  assert.equal(lauf("wiki-guard", s, { args: ["--konto", "k_aaaaaaaa"], eingabe: e(imVault) }).code, 0);
  r = lauf("wiki-guard", s, { args: ["--konto", "k_aaaaaaaa"], eingabe: e(join(s.vault, "09_wiki", "seite.md")) });
  assert.equal(r.code, 2); assert.match(r.fehler, /Kortex-Riegel/);
});

test("Ernte, Lektionen und W7 starten erst ab „posteingang“; bei lesen und gesperrt wird auch kein Auftrag angelegt", async () => {
  const t = join(temp("konto-transkript-"), "sitzung.jsonl");
  writeFileSync(t, Array.from({ length: 6 }, (_, i) => JSON.stringify({ type: "user", message: { role: "user", content: `Wie plane ich Beet ${i} im Frühling?` } })).join("\n") + "\n");
  const marken = (s) => ({ ernte: join(s.support, "marke-ernte.json"), lektionen: join(s.support, "marke-lektionen.json"), w7: join(s.support, "marke-w7.json") });
  const warte = async (f, ms = 3000) => { const ende = Date.now() + ms; while (Date.now() < ende) { if (existsSync(f)) return true; await new Promise((r) => setTimeout(r, 40)); } return false; };
  for (const [stufe, soll] of [["gesperrt", false], ["lesen", false], ["posteingang", true], ["erweitert", true]]) {
    const s = szenario({ automatik: { ernteSitzungsende: true }, stufeA: stufe });
    const e = { session_id: "s1", transcript_path: t, cwd: HOME, hook_event_name: "SessionEnd" };
    // die Hook-Datei startet W7, den Session-Auswerter und die Ernte; alle drei Attrappen schreiben dieselbe Marke (FAKE_MARKE): es zählt, OB etwas gestartet wurde
    const envAlle = { BRAIN_ERNTE_SKRIPT: join(FAKE, "ernte.mjs"), BRAIN_LEKTIONEN_SKRIPT: join(FAKE, "lektionen.mjs"), BRAIN_W7_SKRIPT: join(FAKE, "w7.mjs"), FAKE_MARKE: marken(s).ernte };
    const r = lauf("ernte-ausloeser", s, { args: ["--art", "fakt", "--konto", "k_aaaaaaaa"], eingabe: e, env: envAlle });
    assert.equal(r.code, 0, r.fehler); assert.equal(r.aus, "");
    assert.equal(await warte(marken(s).ernte, soll ? 4000 : 700), soll, `Ernte bei ${stufe}`);
    if (!soll) assert.equal(existsSync(join(s.vault, ".logs")), false, `bei ${stufe} entsteht nichts im Vault`);
  }
});

test("Gedächtnis-Teilen: gestartet wird nur ab „posteingang“", () => {
  const skript = join(FAKE, "teilen.mjs");
  writeFileSync(skript, `import { starteAbgleichFuerSitzung } from ${JSON.stringify(join(HIER, "..", "gedaechtnis.mjs"))};
const ruf = [];
const r = starteAbgleichFuerSitzung({ vault: process.env.BRAIN_VAULT, eingabe: { transcript_path: ${JSON.stringify(join(HOME, ".claude", "projects", "-Users-test-meinprojekt", "s.jsonl"))} }, werte: { gedaechtnisTeilen: "an" }, starte: (x) => ruf.push(x.projekt) });
console.log(JSON.stringify({ r, ruf }));
`);
  for (const [stufe, soll] of [["gesperrt", false], ["lesen", false], ["posteingang", true]]) {
    const s = szenario({ stufeA: stufe });
    const r = spawnSync(process.execPath, [skript, "--konto", "k_aaaaaaaa"], { env: umgebung(s, { CLAUDE_CONFIG_DIR: PROFIL_A }), encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.r.gestartet, soll, `${stufe}: ${r.stdout}`);
    if (!soll) assert.equal(j.r.grund, "konto");
  }
});

test("Widerspruch --konto und Umgebung: das strengere Recht; Altform ohne --konto folgt der Umgebung; ohne beides das Standardprofil", () => {
  const s = szenario({ stufeA: "posteingang", stufeB: "gesperrt", stufeStd: "lesen", ohneKonto: "gesperrt" });
  const still = (args, env) => { const r = lauf("statusline", s, { args, eingabe: {}, env, ohneProfil: true }); assert.equal(r.code, 0); return r.aus.trim() === ""; };
  assert.equal(still(["--konto", "k_aaaaaaaa"], { CLAUDE_CONFIG_DIR: PROFIL_A }), false, "Argument und Umgebung stimmen überein");
  assert.equal(still(["--konto", "k_aaaaaaaa"], { CLAUDE_CONFIG_DIR: PROFIL_B }), true, "die Sitzung läuft im gesperrten Profil B: still");
  assert.equal(still(["--konto", "k_bbbbbbbb"], { CLAUDE_CONFIG_DIR: PROFIL_A }), true, "…und umgekehrt: das Argument nennt das gesperrte Konto");
  assert.equal(still([], { CLAUDE_CONFIG_DIR: PROFIL_A }), false, "Altform: die Umgebung bestimmt das Konto");
  assert.equal(still([], { CLAUDE_CONFIG_DIR: PROFIL_B }), true);
  assert.equal(still([], {}), false, "ohne Variable läuft das Standardprofil (hier: lesen)");
  assert.equal(still([], { CLAUDE_CONFIG_DIR: PROFIL_STD }), false, "~/.claude ausdrücklich gesetzt = Standardprofil");
  assert.equal(still(["--konto", "k_aaaaaaaa"], {}), false, "der Hook von Profil A läuft in einer Sitzung ohne Variable (Standardprofil, lesen): die Stufen werden verglichen, die schwächere gilt, und die ist lesen");
  assert.equal(still([], { CLAUDE_CONFIG_DIR: temp("konto-fremd-") }), true, "ein Ordner, den Kortex nicht kennt");
  assert.equal(still(["--konto", "k_99999999"], {}), true, "unbekannte Kennung");
  assert.equal(still(["--konto"], {}), true, "fehlender Wert");
  assert.equal(still(["--konto", "k_aaaaaaaa", "--konto", "k_cccccccc"], {}), true, "zwei verschiedene Werte");
});

test("Beschädigte, verlinkte oder fehlende Liste: defekt/Link → alle Hooks still (fail-closed); fehlt → bisheriges Verhalten", () => {
  const s = szenario({ stufeA: "erweitert" });
  const datei = join(s.support, "ki-konten.json");
  const alleStill = () => { for (const n of ALLE_LESENDEN) { const r = lauf(n, s, { args: ["--konto", "k_aaaaaaaa"], eingabe: eingabeFuer(n), env: hookEnv }); assert.equal(r.aus, "", n); } assert.equal(existsSync(join(s.vault, ".logs")), false); };
  for (const inhalt of ["{ kaputt", "[]", JSON.stringify({ version: 2, konten: {}, vaults: {} })]) { writeFileSync(datei, inhalt); alleStill(); }
  const ziel = join(temp("konto-ziel-"), "gueltig.json");
  s.schreibeListe(); writeFileSync(ziel, readFileSync(datei)); rmSync(datei); symlinkSync(ziel, datei);
  alleStill();
  rmSync(datei);
  const r = lauf("statusline", s, { args: [], eingabe: {} });
  assert.notEqual(r.aus.trim(), "", "Liste fehlt (die neue App lief noch nie): wie bisher");
});

test("Entzug wirkt sofort: derselbe Hook ist nach der Änderung der Liste still", () => {
  const s = szenario({ stufeA: "lesen" });
  assert.notEqual(lauf("statusline", s, { args: ["--konto", "k_aaaaaaaa"] }).aus.trim(), "");
  s.schreibeListe("gesperrt");
  assert.equal(lauf("statusline", s, { args: ["--konto", "k_aaaaaaaa"] }).aus, "");
});

test("Die Hilfe baueTestUmgebung bricht ab, wenn ein echtes HOME oder ein Konfig-Ordner außerhalb des Temp-Ordners hineinkommt", () => {
  assert.throws(() => baueTestUmgebung({ HOME: "/Users/jemand", BRAIN_APP_SUPPORT: HOME }), /HOME/);
  assert.throws(() => baueTestUmgebung({ HOME, BRAIN_APP_SUPPORT: "/Library/Application Support/Kortex" }), /BRAIN_APP_SUPPORT/);
  assert.throws(() => baueTestUmgebung({ HOME, BRAIN_APP_SUPPORT: HOME, CLAUDE_CONFIG_DIR: "/Users/jemand/.claude" }), /CLAUDE_CONFIG_DIR/);
  assert.throws(() => baueTestUmgebung({ HOME, BRAIN_APP_SUPPORT: HOME, CODEX_HOME: "/Users/jemand/.codex" }), /CODEX_HOME/);
  assert.throws(() => baueTestUmgebung({ HOME, BRAIN_APP_SUPPORT: HOME, CURSOR_CONFIG_DIR: "/x" }), /CURSOR_CONFIG_DIR/);
  assert.throws(() => baueTestUmgebung({ HOME, BRAIN_APP_SUPPORT: HOME, GEMINI_CLI_HOME: "/x" }), /GEMINI_CLI_HOME/);
  assert.throws(() => baueTestUmgebung({ BRAIN_APP_SUPPORT: HOME }), /HOME/);
  const e = baueTestUmgebung({ HOME, BRAIN_APP_SUPPORT: HOME, CLAUDE_CONFIG_DIR: PROFIL_A });
  assert.equal(e.CLAUDE_CONFIG_DIR, PROFIL_A); assert.equal(e.BRAIN_TESTMODUS, "1"); assert.ok(!("GIT_CONFIG_GLOBAL" in e));
});
