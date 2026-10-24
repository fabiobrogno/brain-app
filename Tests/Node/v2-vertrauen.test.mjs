// Vertrauen v2 (Studio-v2-Spec §8): Merker mit Ordner-Kennung und Code-Fingerabdruck, CLI für Swift, Git ohne Vertrauen
// (Hooks, gefährliche Einstellungen, fsmonitor/diff.external), Fristen, MCP verbinden, Probe über den MCP-Server.
// Nur Wegwerf-Ordner in os.tmpdir(); kein Netzwerk, nie das echte `claude`, nie der echte Support-Ordner.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, chmodSync, symlinkSync, statSync, appendFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmp, schreibe, repo, g, pfad } from "./hilfe.mjs";
process.env.HOME = tmp("brain-home-");          // os.homedir() liest $HOME: keine echte ~/.gitconfig
process.env.GIT_CONFIG_NOSYSTEM = "1";          // und keine System-Konfiguration

const { HttpFehler } = await import(pfad("gemeinsam", "basis.mjs"));
const V = await import(pfad("gemeinsam", "vertrauen.mjs"));
const { oeffneVault } = await import(pfad("gemeinsam", "vault.mjs"));
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
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

// ───────────────────────────── Merker und Fingerabdruck ─────────────────────────────

test("Vertrauen v2: Form der Antwort; ohne Code nichts nötig, mit Kit-Code nötig und noch nicht erlaubt", () => {
  const support = neuerSupport();
  const schlicht = tmp();
  assert.deepEqual(V.pruefeVertrauen(schlicht, { support }), { erlaubt: false, noetig: false, geaendert: false, gitGesperrt: false, gruende: [] });
  const d = kitVault();
  const r = V.pruefeVertrauen(d, { support });
  assert.deepEqual(Object.keys(r).sort(), ["erlaubt", "geaendert", "gitGesperrt", "gruende", "noetig"]);
  assert.equal(r.erlaubt, false); assert.equal(r.noetig, true); assert.equal(r.geaendert, false); assert.equal(r.gitGesperrt, false);
  assert.deepEqual(r.gruende.map((x) => x.art), ["kit"]); assert.ok(r.gruende[0].text.length > 20);
  assert.deepEqual(V.pruefeVertrauen(join(tmp(), "gibts-nicht"), { support }), { erlaubt: false, noetig: false, geaendert: false, gitGesperrt: false, gruende: [] });
});

test("Vertrauen v2: erlauben schreibt { seit, ordner, code } mit Modus 0600 und erhält andere Einträge; widerrufen löscht nur diesen", () => {
  const support = neuerSupport();
  const a = kitVault(), b = kitVault();
  V.erlaube(a, { support });
  const r = V.erlaube(b, { support });
  assert.equal(r.erlaubt, true);
  const m = merkerVon(support);
  assert.equal(Object.keys(m).length, 2);
  const e = m[oeffneVault(a).wurzel];
  assert.match(e.seit, /^\d{4}-\d\d-\d\dT/); assert.match(e.ordner, /^\d+:\d+:[\d.]+$/); assert.match(e.code, /^[0-9a-f]{64}$/);
  assert.equal(statSync(join(support, "vertrauen.json")).mode & 0o777, 0o600);
  assert.equal(V.widerrufe(a, { support }).erlaubt, false);
  assert.deepEqual(Object.keys(merkerVon(support)), [oeffneVault(b).wurzel], "der andere Vault bleibt erlaubt");
  assert.equal(V.pruefeVertrauen(b, { support }).erlaubt, true);
  assert.equal(statSync(join(support, "vertrauen.json")).mode & 0o777, 0o600);
});

test("Vertrauen v2: Ordner am selben Pfad gelöscht und neu angelegt (auch mit gleichem Inhalt) → nicht vertraut, neue Frage", () => {
  const support = neuerSupport();
  const d = kitVault();
  V.erlaube(d, { support });
  assert.equal(V.pruefeVertrauen(d, { support }).erlaubt, true);
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  schreibe(d, ".tools/brain.mjs", KIT); schreibe(d, "a.md", "# A\n"); // byte-gleicher Inhalt, aber ein anderer Ordner
  const r = V.pruefeVertrauen(d, { support });
  assert.equal(r.erlaubt, false); assert.equal(r.geaendert, true);
  assert.deepEqual(oeffneVault(d, { support }).kit(), { vorhanden: true, vertraut: false });
});

test("Vertrauen v2: .tools-Code geändert → geaendert:true; Daten-Datei ohne Code-Endung geändert → bleibt vertraut", () => {
  const support = neuerSupport();
  const d = kitVault();
  schreibe(d, ".tools/daten.json", "{\"a\":1}\n"); schreibe(d, ".tools/VERSION", "1.0\n"); schreibe(d, ".tools/doku.md", "# Doku\n");
  V.erlaube(d, { support });
  schreibe(d, ".tools/daten.json", "{\"a\":2}\n"); schreibe(d, ".tools/VERSION", "2.0\n"); schreibe(d, ".tools/doku.md", "# Neu\n"); schreibe(d, ".tools/neu.txt", "x\n");
  assert.equal(V.pruefeVertrauen(d, { support }).erlaubt, true, "Daten ändern den Fingerabdruck nicht");
  appendFileSync(join(d, ".tools/brain.mjs"), "// geändert\n");
  const r = V.pruefeVertrauen(d, { support });
  assert.equal(r.erlaubt, false); assert.equal(r.geaendert, true);
  V.erlaube(d, { support });
  assert.equal(V.pruefeVertrauen(d, { support }).erlaubt, true, "neu erlaubt");
  schreibe(d, ".tools/zusatz.sh", "echo hi\n"); // neue Code-Datei (Endung sh)
  assert.equal(V.pruefeVertrauen(d, { support }).geaendert, true);
});

test("Vertrauen v2: Ausführbar-Bit ohne Endung zählt als Code; node_modules zählt nicht; große Code-Datei: Änderung wird bemerkt", () => {
  const support = neuerSupport();
  const d = kitVault();
  schreibe(d, ".tools/lauf", "#!/bin/sh\necho 1\n"); chmodSync(join(d, ".tools/lauf"), 0o755);
  schreibe(d, ".tools/node_modules/x/index.js", "1\n");
  const gross = join(d, ".tools/gross.mjs"); writeFileSync(gross, Buffer.alloc(3 * 1024 * 1024, 97));
  V.erlaube(d, { support });
  schreibe(d, ".tools/node_modules/x/index.js", "2\n");
  assert.equal(V.pruefeVertrauen(d, { support }).erlaubt, true, "node_modules ist ausgenommen (§8)");
  writeFileSync(join(d, ".tools/lauf"), "#!/bin/sh\necho 2\n");
  assert.equal(V.pruefeVertrauen(d, { support }).geaendert, true, "Ausführbar-Bit ohne Endung");
  V.erlaube(d, { support });
  const neu = new Date(Date.now() + 5000);
  utimesSync(gross, neu, neu);
  assert.equal(V.pruefeVertrauen(d, { support }).geaendert, true, "Datei > 2 MB: Größe + Änderungszeit statt Inhalt, nie einfach ausgelassen");
});

test("Vertrauen v2: Verweise unter .tools zählen mit Ziel-Text und Inhalt des Ziels", () => {
  const support = neuerSupport();
  const d = kitVault();
  const draussen = tmp("brain-aus-"); schreibe(draussen, "ziel.mjs", "// 1\n");
  symlinkSync(join(draussen, "ziel.mjs"), join(d, ".tools/verweis.mjs"));
  V.erlaube(d, { support });
  assert.equal(V.pruefeVertrauen(d, { support }).erlaubt, true);
  schreibe(draussen, "ziel.mjs", "// 2 — ausgetauscht\n");
  assert.equal(V.pruefeVertrauen(d, { support }).geaendert, true, "Inhalt des Ziels geändert");
  V.erlaube(d, { support });
  rmSync(join(d, ".tools/verweis.mjs")); symlinkSync(join(draussen, "anders.mjs"), join(d, ".tools/verweis.mjs"));
  assert.equal(V.pruefeVertrauen(d, { support }).geaendert, true, "anderes Ziel (auch ins Leere)");
});

test("Vertrauen v2: alter Eintrag nur mit „seit“ ist ungültig (geaendert:true); kaputte Merker-Datei = nicht vertraut", () => {
  const support = neuerSupport();
  const d = kitVault();
  const wurzel = oeffneVault(d).wurzel;
  writeFileSync(join(support, "vertrauen.json"), JSON.stringify({ [wurzel]: { seit: "2026-10-01T00:00:00Z" } }));
  let r = V.pruefeVertrauen(d, { support });
  assert.equal(r.erlaubt, false); assert.equal(r.geaendert, true);
  assert.deepEqual(oeffneVault(d, { support }).kit(), { vorhanden: true, vertraut: false });
  writeFileSync(join(support, "vertrauen.json"), "{kaputt");
  r = V.pruefeVertrauen(d, { support });
  assert.equal(r.erlaubt, false); assert.equal(r.geaendert, false);
  V.erlaube(d, { support }); // überschreibt die kaputte Datei sauber
  assert.equal(V.pruefeVertrauen(d, { support }).erlaubt, true);
});

test("Vertrauen v2: Git-Hook zählt zum Fingerabdruck (nicht .sample); core.hooksPath aus der lokalen Konfiguration wird gelesen", () => {
  const support = neuerSupport();
  const d = repo();
  V.erlaube(d, { support });
  schreibe(d, ".git/hooks/pre-commit.sample", "#!/bin/sh\n# Beispiel\n");
  assert.equal(V.pruefeVertrauen(d, { support }).erlaubt, true, ".sample ist kein Hook");
  schreibe(d, ".git/hooks/pre-commit", "#!/bin/sh\nexit 0\n"); chmodSync(join(d, ".git/hooks/pre-commit"), 0o755);
  let r = V.pruefeVertrauen(d, { support });
  assert.equal(r.erlaubt, false); assert.equal(r.geaendert, true); assert.ok(r.gruende.some((x) => x.art === "hooks"));
  V.erlaube(d, { support });
  assert.equal(V.pruefeVertrauen(d, { support }).erlaubt, true);
  schreibe(d, ".git/hooks/pre-commit", "#!/bin/sh\nexit 1\n");
  assert.equal(V.pruefeVertrauen(d, { support }).geaendert, true, "Hook geändert");
  // eigener Hook-Ordner im Vault
  g(d, "config", "core.hooksPath", ".githooks");
  schreibe(d, ".githooks/pre-push", "#!/bin/sh\nexit 0\n"); chmodSync(join(d, ".githooks/pre-push"), 0o755);
  V.erlaube(d, { support });
  assert.equal(V.pruefeVertrauen(d, { support }).erlaubt, true);
  schreibe(d, ".githooks/pre-push", "#!/bin/sh\nexit 2\n");
  assert.equal(V.pruefeVertrauen(d, { support }).geaendert, true, "core.hooksPath: Hooks dort gehören zum Fingerabdruck");
});

// ───────────────────────────── CLI für Swift ─────────────────────────────

const cli = (args, env = {}) => spawnSync(process.execPath, [pfad("werkstatt", "vertrauen-pruefen.mjs"), ...args], { encoding: "utf8", env: { ...process.env, ...env } });

test("CLI vertrauen-pruefen.mjs: genau {\"erlaubt\":false|true}, Exit 0; startet nichts aus dem Vault; --erlauben nur im Testmodus", () => {
  const support = neuerSupport();
  const d = tmp(); // Kit, das eine Marke schreiben würde, wenn es liefe
  const marke = join(tmp(), "KIT-LIEF");
  schreibe(d, ".tools/brain.mjs", `import {writeFileSync} from "node:fs"; writeFileSync(${JSON.stringify(marke)}, "x");\n`);
  const env = { BRAIN_APP_SUPPORT: support, BRAIN_TESTMODUS: "0" };
  let r = cli([d], env);
  assert.equal(r.status, 0); assert.equal(r.stdout, '{"erlaubt":false}\n'); assert.equal(r.stderr, "");
  r = cli(["--erlauben", d], env);
  assert.equal(r.status, 2); assert.match(r.stderr, /BRAIN_TESTMODUS=1/); assert.equal(r.stdout, "");
  assert.equal(existsSync(join(support, "vertrauen.json")), false, "ohne Testmodus wird nichts erlaubt");
  r = cli(["--erlauben", d], { ...env, BRAIN_TESTMODUS: "1" });
  assert.equal(r.status, 0); assert.equal(r.stdout, '{"erlaubt":true}\n');
  r = cli([d], env);
  assert.equal(r.status, 0); assert.equal(r.stdout, '{"erlaubt":true}\n');
  appendFileSync(join(d, ".tools/brain.mjs"), "// geändert\n");
  assert.equal(cli([d], env).stdout, '{"erlaubt":false}\n');
  assert.equal(existsSync(marke), false, "Kit-Code wurde nie gestartet");
  // unbekannter Ordner und fehlendes Argument
  r = cli([join(tmp(), "gibts-nicht")], env); assert.equal(r.status, 0); assert.equal(r.stdout, '{"erlaubt":false}\n');
  assert.equal(cli([], env).status, 2);
  assert.equal(cli(["--erlauben"], { ...env, BRAIN_TESTMODUS: "1" }).status, 2);
});

test("CLI liest denselben Merker wie die Werkstatt (Einstellungen → Erlauben in der App, danach fragt Swift)", async () => {
  const support = neuerSupport();
  const d = kitVault();
  const env = { BRAIN_APP_SUPPORT: support };
  assert.equal(cli([d], env).stdout, '{"erlaubt":false}\n');
  const rufe = aufruf(erzeugeHandler({ vault: d, vaultOptionen: { support } }));
  const r = await rufe("POST", "/api/kit/vertrauen", { erlauben: true });
  assert.equal(r.status, 200);
  assert.equal(cli([d], env).stdout, '{"erlaubt":true}\n');
  await rufe("POST", "/api/kit/vertrauen", { erlauben: false });
  assert.equal(cli([d], env).stdout, '{"erlaubt":false}\n');
});

// ───────────────────────────── Schnittstelle ─────────────────────────────

test("API: /api/info nennt vertrauen (kit.vertraut === vertrauen.erlaubt); POST /api/kit/vertrauen → { kit, vertrauen }; ohne Vault null", async () => {
  const support = neuerSupport();
  const d = kitVault();
  const rufe = aufruf(erzeugeHandler({ vault: d, vaultOptionen: { support } }));
  let r = await rufe("GET", "/api/info");
  assert.deepEqual(Object.keys(r.j.vertrauen).sort(), ["erlaubt", "geaendert", "gitGesperrt", "gruende", "noetig"]);
  assert.equal(r.j.vertrauen.erlaubt, false); assert.equal(r.j.vertrauen.noetig, true); assert.equal(r.j.kit.vertraut, false);
  r = await rufe("POST", "/api/kit/vertrauen", { erlauben: true });
  assert.deepEqual(Object.keys(r.j).sort(), ["kit", "vertrauen"]);
  assert.equal(r.j.vertrauen.erlaubt, true); assert.equal(r.j.kit.vertraut, true);
  r = await rufe("GET", "/api/info");
  assert.equal(r.j.kit.vertraut, r.j.vertrauen.erlaubt); assert.equal(r.j.vertrauen.erlaubt, true);
  // Kit-Code geändert → die Erlaubnis gilt nicht mehr, Kit läuft nicht
  appendFileSync(join(d, ".tools/brain.mjs"), "// vom Abgleich\n");
  r = await rufe("GET", "/api/info");
  assert.equal(r.j.vertrauen.erlaubt, false); assert.equal(r.j.vertrauen.geaendert, true); assert.equal(r.j.kit.vertraut, false);
  assert.deepEqual((await rufe("GET", "/api/gesundheit")).j, { verfuegbar: false, grund: "nicht-vertraut" });
  assert.equal((await rufe("POST", "/api/kit/vertrauen", { erlauben: "ja" })).status, 400);

  const ohne = aufruf(erzeugeHandler({ vaultOptionen: { support: tmp("brain-leer-support-") } }));
  assert.equal((await ohne("GET", "/api/info")).j.vertrauen, null);
});
