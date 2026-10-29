// test-vault-sicherheit.mjs — Review-Befunde zu P2, auf Prozessebene (echte Aufrufe der Werkzeuge und Hooks):
//  (1) Geister-Vault: ein nicht vorhandener Vault (BRAIN_VAULT, --vault, aktiv in vaults.json) legt nirgends etwas an — Hooks enden still mit Exit 0,
//      Werkzeuge mit Exit 2.
//  (2) Relative Vault-Angaben werden aufgelöst; ein angegebener, aber ungültiger Vault weicht nie still auf BRAIN_VAULT/den aktiven Vault aus.
//  (4) search-refresh startet hint-warm mit dem Vault.
//  (6) Ohne stabilen Kern-Pfad tragen Git-Hooks und LaunchAgent nichts ein.
//  (9) BRAIN_LINT_SKRIPT gilt nur unter dem Temp-Ordner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, utimesSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync, execFileSync } from "node:child_process";
import { KERN } from "../pfade.mjs";
const D = await import("../tageslauf/dienst.mjs");

const temp = (n) => mkdtempSync(join(tmpdir(), `${n} `));
const gueltig = () => { const v = join(temp("vs-vault"), "Brain"); mkdirSync(v); writeFileSync(join(v, "brain.config.json"), "{}"); return v; };
const ohneGit = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_") && k !== "BRAIN_VAULT"));
const lauf = (skript, args, { env = {}, input, cwd } = {}) => spawnSync(process.execPath, [join(KERN, skript), ...args], {
  encoding: "utf8", input, cwd, env: { ...ohneGit(), BRAIN_APP_SUPPORT: join(tmpdir(), "vs-leer-nie-vorhanden"), HOME: temp("vs-home"), ...env } });
const HOOKS = [["adapters/claude-code/session-start.mjs", "{}"], ["adapters/claude-code/brain-hint.mjs", JSON.stringify({ prompt: "wie funktioniert das Backup der Seiten", session_id: "s1" })],
  ["adapters/claude-code/wiki-guard.mjs", JSON.stringify({ tool_name: "Edit", tool_input: { file_path: "/x/09_wiki/a.md" } })],
  ["adapters/claude-code/sitzung-ende.mjs", "{}"], ["adapters/claude-code/kompakt-sichern.mjs", "{}"], ["adapters/claude-code/regeln-lesen.mjs", JSON.stringify({ tool_input: { file_path: "/x/a.md" } })],
  ["adapters/claude-code/werkzeug-protokoll.mjs", JSON.stringify({ tool_name: "Read", tool_input: { file_path: "/x/a.md" } })]];

test("Geister-Vault: BRAIN_VAULT auf einen nicht vorhandenen Ordner → Hooks enden still mit Exit 0 und legen nichts an, Werkzeuge enden mit Exit 2", () => {
  const weg = join(temp("vs-weg"), "alter-vault");           // existiert nicht (abgezogener Stick, umbenannter Ordner)
  for (const [hook, eingabe] of HOOKS) {
    const r = lauf(hook, [], { env: { BRAIN_VAULT: weg }, input: eingabe });
    assert.equal(r.status, 0, `${hook}: ${r.stderr}`);
    assert.equal(r.stdout, "", `${hook} gibt nichts aus`);
  }
  assert.ok(!existsSync(weg), "kein Geister-Ordner angelegt");
  for (const [skript, args] of [["brain.mjs", ["status"]], ["brain.mjs", ["lint"]], ["pflege.mjs", []], ["doctor.mjs", []]]) {
    const r = lauf(skript, args, { env: { BRAIN_VAULT: weg } });
    assert.equal(r.status, 2, `${skript}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /Vault nicht gefunden/);
  }
  assert.ok(!existsSync(weg));
});

test("Geister-Vault: aktiv in vaults.json zeigt auf einen nicht vorhandenen Ordner bzw. einen Ordner ohne brain.config.json → kein Vault, nichts wird angelegt", () => {
  const support = temp("vs-support");
  const weg = join(temp("vs-weg"), "vault"), ohneConfig = temp("vs-ohne-config");
  for (const pfad of [weg, ohneConfig]) {
    writeFileSync(join(support, "vaults.json"), JSON.stringify({ vaults: [{ pfad }], aktiv: pfad }));
    const r = lauf("adapters/claude-code/session-start.mjs", [], { env: { BRAIN_APP_SUPPORT: support }, input: "{}" });
    assert.equal(r.status, 0); assert.equal(r.stdout, "");
    const t = lauf("brain.mjs", ["status"], { env: { BRAIN_APP_SUPPORT: support } });
    assert.equal(t.status, 2, t.stderr);
  }
  assert.ok(!existsSync(weg));
  assert.deepEqual(readdirSync(ohneConfig), [], "in den Ordner ohne Konfiguration wurde nichts geschrieben (AGENTS.md, .logs …)");
});

test("Relativer Vault: --vault, Positionsargument und BRAIN_VAULT werden aufgelöst; der Vault ist dann derselbe wie mit absolutem Pfad", () => {
  const v = gueltig();
  for (const [args, env] of [[["status", "--json", "--vault", basename(v)], {}], [["status", "--json"], { BRAIN_VAULT: basename(v) }]]) {
    const r = lauf("brain.mjs", args, { cwd: dirname(v), env });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout.trim()).zustand === "problem", false);
  }
  const r = lauf("rueckfragen.mjs", [basename(v), "liste"], { cwd: dirname(v) });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { fragen: [], wartend: 0 });
});

test("Ein angegebener, ungültiger Vault weicht nie still auf BRAIN_VAULT oder den aktiven Vault aus (rueckfragen, zurueck, dienst, brain)", () => {
  const aktiv = gueltig(), support = temp("vs-support"), ungueltig = join(temp("vs-weg"), "nicht-da");
  writeFileSync(join(support, "vaults.json"), JSON.stringify({ vaults: [{ pfad: aktiv }], aktiv }));
  const env = { BRAIN_VAULT: aktiv, BRAIN_APP_SUPPORT: support };
  for (const [skript, args] of [
    ["rueckfragen.mjs", [ungueltig, "liste"]],
    ["tageslauf/zurueck.mjs", [ungueltig, "20261001-101010"]],
    ["tageslauf/dienst.mjs", [ungueltig, "status"]],
    ["brain.mjs", ["status", "--vault", ungueltig]],
    ["brain.mjs", ["rueckfragen", "liste", "--vault", ungueltig]],
  ]) {
    const r = lauf(skript, args, { env });
    assert.equal(r.status, 2, `${skript} ${args.join(" ")}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /Vault nicht gefunden/);
    assert.equal(r.stdout, "", "nichts wurde stattdessen im aktiven Vault getan");
  }
  // Kontrolle: ohne die ungültige Angabe nimmt dasselbe Werkzeug den Vault aus BRAIN_VAULT
  const ok = lauf("rueckfragen.mjs", ["liste"], { env });
  assert.equal(ok.status, 0, ok.stderr);
});

test("search-refresh gibt den Vault an hint-warm weiter (Positionsargument, ohne BRAIN_VAULT in der Umgebung)", () => {
  const v = gueltig();
  mkdirSync(join(v, "20_firma"), { recursive: true });
  writeFileSync(join(v, "20_firma", "a.md"), "# a\n");
  mkdirSync(join(v, ".logs"), { recursive: true });
  const stempel = join(v, ".logs", "search-refreshed"); writeFileSync(stempel, "");
  const spaeter = new Date(Date.now() + 60000); utimesSync(stempel, spaeter, spaeter);     // frisch → nichts zu indexieren, nur aufwärmen
  const r = lauf("search-refresh.mjs", [v], { env: { BRAIN_HINT_SEARCH_MODULE: join(tmpdir(), "gibt-es-nicht.mjs") } });
  assert.equal(r.status, 0, r.stderr);
  const log = existsSync(join(v, ".logs", "hooks.log")) ? readFileSync(join(v, ".logs", "hooks.log"), "utf8") : "";
  assert.match(log, / warm /, "hint-warm kannte den Vault und hat protokolliert");
});

test("BRAIN_LINT_SKRIPT wirkt nur unter dem Temp-Ordner: ein Pfad außerhalb wird ignoriert, das echte Struktur-Lint blockiert den toten Link", () => {
  const v = gueltig(); mkdirSync(join(v, "09_wiki", "firma"), { recursive: true });
  const seite = (n, r) => `---\nname: ${n}\ndescription: ${n}\ntyp: thema\nquellen: []\nquellen_sha: []\nrev: ${r}\n---\n# ${n}\n\n[[gibt_es_nicht]]\n`;
  writeFileSync(join(v, "09_wiki", "firma", "thema_a.md"), seite("thema_a", 1));
  const g = (...a) => execFileSync("git", ["-C", v, "-c", "user.email=t@t", "-c", "user.name=t", ...a], { encoding: "utf8", env: ohneGit() });
  g("init", "-q", "-b", "main"); g("add", "--", "brain.config.json"); g("commit", "-qm", "init", "--no-verify");
  g("add", "--", "09_wiki");
  const pruefe = (lint) => spawnSync(process.execPath, [join(KERN, "commit-pruefung.mjs"), v], { encoding: "utf8", env: { ...ohneGit(), BRAIN_LINT_SKRIPT: lint } });
  const draussen = pruefe("/usr/lib/gibt-es-nicht-lint.mjs");
  assert.equal(draussen.status, 2, draussen.stdout);
  assert.match(draussen.stdout, /TOTER LINK/);
  const drinnen = pruefe(join(tmpdir(), "gibt-es-nicht-lint.mjs"));
  assert.equal(drinnen.status, 0, drinnen.stdout);
  assert.match(drinnen.stdout, /Struktur-Lint abgestürzt/);
});

test("Ohne stabilen Kern-Pfad setzt install-git-hooks core.hooksPath nicht (Exit 3, klare Meldung); mit Testschalter schon", () => {
  const v = gueltig();
  const g = (...a) => execFileSync("git", ["-C", v, ...a], { encoding: "utf8", env: ohneGit() });
  g("init", "-q", "-b", "main");
  const ohne = lauf("install-git-hooks.mjs", [v], { env: { KORTEX_KERN_UNSTABIL_ERLAUBT: "", BRAIN_TESTMODUS: "1" } }); // BRAIN_TESTMODUS: der Wegwerf-Vault gilt als vertraut (P5)
  assert.equal(ohne.status, 3, ohne.stderr);
  assert.match(ohne.stderr, /stabilen Kern-Pfad/);
  assert.throws(() => g("config", "core.hooksPath"), "core.hooksPath bleibt ungesetzt");
  const mit = lauf("install-git-hooks.mjs", [v], { env: { KORTEX_KERN_UNSTABIL_ERLAUBT: "1" } });
  assert.equal(mit.status, 0, mit.stderr);
  assert.match(g("config", "core.hooksPath").trim(), /git-hooks$/);
});

test("Ohne stabilen Kern-Pfad schreibt dienstAn keine plist und lädt nichts (ok:false, nichtStabil), mit Testschalter schon", () => {
  const v = gueltig(), home = temp("vs-heim");
  const alt = process.env.KORTEX_KERN_UNSTABIL_ERLAUBT, altTest = process.env.BRAIN_TESTMODUS;
  try {
    process.env.KORTEX_KERN_UNSTABIL_ERLAUBT = "";
    process.env.BRAIN_TESTMODUS = "1"; // der Wegwerf-Vault gilt als vertraut (P5)
    const r = D.dienstAn(v, { home, plattform: "darwin", node: process.execPath, claude: null });
    assert.equal(r.ok, false);
    assert.equal(r.nichtStabil, true);
    assert.match(r.text, /stabilen Kern-Pfad/);
    assert.equal(D.dienstEingerichtet({ home }), false, "keine plist geschrieben");
  } finally {
    if (alt === undefined) delete process.env.KORTEX_KERN_UNSTABIL_ERLAUBT; else process.env.KORTEX_KERN_UNSTABIL_ERLAUBT = alt;
    if (altTest === undefined) delete process.env.BRAIN_TESTMODUS; else process.env.BRAIN_TESTMODUS = altTest;
  }
});
