// Tests/Kern/test-pflege-konto.mjs — Pflege-Konto und KI-Stufe je Vault (docs/plaene/ki-konten.md, Abschnitt 5, Paket P3).
// Der Tageslauf nimmt für den Vault, den er bearbeitet, vaults[v].pflege = { konto, stufe } aus <support>/ki-konten.json und setzt daraus die Umgebung JEDES claude-Aufrufs
// (CLAUDE_CONFIG_DIR des Kontos; Standardprofil = Variable entfernt). Stufe klein: nur Haiku, keine Schreibpflege/kein Traum · mittel: wie bisher · aus: kein Aufruf, Lauf gilt als erfolgreich.
// Die KI ist die Attrappe fake-ki-protokoll.mjs (strenges Argument-Parsing, protokolliert Modell und CLAUDE_CONFIG_DIR jedes Aufrufs); kein echtes claude, keine echten Nutzerorte.
// Die Aufrufe laufen im Testprozess (Temp-HOME aus isoliere()); Kindprozesse der Attrappe bekommen ihre Umgebung aus kindUmgebung(env) des Kerns, getestet wird genau das.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, realpathSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { isoliere } from "./tageslauf-hilfe.mjs";
import { baueTestUmgebung } from "./konto-hilfe.mjs";

const HOME = isoliere();
const HIER = dirname(fileURLToPath(import.meta.url));
const FAKE = join(HIER, "fake-ki-protokoll.mjs");
const BEFEHL = { befehl: process.execPath, args: [FAKE] };
const { aufbau, lauf } = await import("./lauf-hilfe.mjs");
const { kiAufruf, kiBefehl, neuesBudget, pflegeVon } = await import("../tageslauf/ki.mjs");
const { neuerLauf, leseLetzter } = await import("../tageslauf/protokoll.mjs");
const { pflegeAufloesen, umgebungFuer } = await import("../pflege-konto.mjs");
const { rufeSonnet } = await import("../tageslauf/pflege-ki.mjs");
const { sonnetUmgebung } = await import("../tageslauf/pflege-ki.mjs");

const kennung = (p) => { const st = statSync(p); return `${st.dev}:${st.ino}:${st.birthtimeMs}`; };
const profil = (n) => { const p = join(HOME, n); mkdirSync(p, { recursive: true }); return realpathSync(p); };
const PROFIL_STD = profil(".claude"), PROFIL_A = profil(".claude-a"), PROFIL_B = profil(".claude-b");
const SUPPORT = realpathSync(mkdtempSync(join(tmpdir(), "pflege-konto-support-")));
const LOG = join(SUPPORT, "ki-aufrufe.jsonl");
process.env.BRAIN_APP_SUPPORT = SUPPORT;
process.env.FAKE_KI_LOG = LOG;
const aufrufe = () => (existsSync(LOG) ? readFileSync(LOG, "utf8").split("\n").filter(Boolean).map((z) => JSON.parse(z)) : []);
const leereLog = () => writeFileSync(LOG, "");

const KONTEN = {
  k_00000001: { programm: "claude", ordner: PROFIL_STD, standard: true, name: "Standard", ordnerKennung: kennung(PROFIL_STD) },
  k_0000000a: { programm: "claude", ordner: PROFIL_A, standard: false, name: "A", ordnerKennung: kennung(PROFIL_A) },
  k_0000000b: { programm: "claude", ordner: PROFIL_B, standard: false, name: "B", ordnerKennung: kennung(PROFIL_B) },
  k_0000000c: { programm: "codex", ordner: join(HOME, ".codex"), standard: true, name: "Codex", ordnerKennung: "" },
};
// vaults: { <pfad>: { konten: { <id>: <stufe> }, pflege? } }
function schreibeListe(vaults) {
  const v = {};
  for (const [pfad, e] of Object.entries(vaults)) v[realpathSync(pfad)] = { ordnerKennung: kennung(pfad), neueKonten: "gesperrt", ohneKonto: "gesperrt", konten: e.konten, ...(e.pflege !== undefined ? { pflege: e.pflege } : {}) };
  writeFileSync(join(SUPPORT, "ki-konten.json"), JSON.stringify({ version: 1, konten: KONTEN, vaults: v }));
}
const ALLE_ERWEITERT = { k_00000001: "erweitert", k_0000000a: "erweitert", k_0000000b: "erweitert", k_0000000c: "erweitert" };
const mitProzessKonto = async (dir, f) => {
  const alt = process.env.CLAUDE_CONFIG_DIR;
  if (dir) process.env.CLAUDE_CONFIG_DIR = dir; else delete process.env.CLAUDE_CONFIG_DIR;
  try { return await f(); } finally { if (alt === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = alt; }
};
const frischerCtx = (v) => neuerLauf(v, { claudeBefehl: BEFEHL, budget: { aufrufe: 10, minuten: 5 } });

test("Pflege-Konto B für Vault 1, A für Vault 2: jeder Aufruf läuft im Konto seines Vaults, egal welches Konto die Umgebung des Prozesses trägt", async () => {
  const v1 = aufbau(), v2 = aufbau();
  schreibeListe({ [v1]: { konten: ALLE_ERWEITERT, pflege: { konto: "k_0000000b", stufe: "mittel" } }, [v2]: { konten: ALLE_ERWEITERT, pflege: { konto: "k_0000000a", stufe: "mittel" } } });
  await mitProzessKonto(PROFIL_A, async () => {
    for (const [v, erwartet] of [[v1, PROFIL_B], [v2, PROFIL_A]]) {
      leereLog();
      const r = await lauf(v, { claudeBefehl: BEFEHL });
      assert.notEqual(r.status, "fehler", JSON.stringify(r));
      assert.ok(aufrufe().length > 0, "die Attrappe wurde gerufen");
      assert.ok(aufrufe().every((a) => a.konto === erwartet), `Konto je Aufruf: ${JSON.stringify(aufrufe().map((a) => a.konto))}`);
      assert.equal(leseLetzter(v).ki.modus, "konto");
    }
  });
});

test("Standardprofil als Pflege-Konto: die Variable CLAUDE_CONFIG_DIR wird für den Aufruf entfernt, auch wenn der Prozess ein anderes Profil trägt", async () => {
  const v = aufbau();
  schreibeListe({ [v]: { konten: ALLE_ERWEITERT, pflege: { konto: "k_00000001", stufe: "mittel" } } });
  await mitProzessKonto(PROFIL_A, async () => {
    leereLog();
    await lauf(v, { claudeBefehl: BEFEHL });
    assert.ok(aufrufe().length > 0);
    assert.ok(aufrufe().every((a) => a.konto === null), JSON.stringify(aufrufe().map((a) => a.konto)));
  });
});

test("ohne Pflege-Einstellung (alter Weg): das Konto der Prozess-Umgebung, geprüft wie bisher", async () => {
  const v = aufbau();
  schreibeListe({ [v]: { konten: ALLE_ERWEITERT } });
  await mitProzessKonto(PROFIL_A, async () => {
    leereLog();
    const r = await lauf(v, { claudeBefehl: BEFEHL });
    assert.ok(aufrufe().length > 0 && aufrufe().every((a) => a.konto === PROFIL_A));
    assert.equal(leseLetzter(v).ki.modus, "alt");
    assert.notEqual(r.status, "fehler");
  });
  schreibeListe({ [v]: { konten: { ...ALLE_ERWEITERT, k_0000000a: "posteingang" } } });
  await mitProzessKonto(PROFIL_A, async () => {
    leereLog();
    const r = await lauf(v, { claudeBefehl: BEFEHL });
    assert.equal(aufrufe().length, 0, "Stufe unter erweitert: keine KI");
    assert.equal(r.status, "ohne-ki");
  });
});

test("Ohne KI bewusst gewählt: kein claude-Aufruf, Status ok-ohne-ki, der Lauf gilt als erfolgreich ohne Grund und ohne Warnung; die Schritte ohne KI laufen", async () => {
  const v = aufbau();
  schreibeListe({ [v]: { konten: ALLE_ERWEITERT, pflege: { konto: null, stufe: "aus" } } });
  leereLog();
  const r = await mitProzessKonto(PROFIL_A, () => lauf(v, { claudeBefehl: BEFEHL }));
  assert.equal(aufrufe().length, 0, "kein claude-Aufruf");
  assert.equal(r.status, "ok-ohne-ki", JSON.stringify(r));
  assert.equal(r.grund, null, "kein Grund, keine Warnung");
  const l = leseLetzter(v);
  assert.equal(l.erfolgreich, true);
  assert.ok(l.letzterErfolg, "ein Erfolg wird vermerkt (der Rückfall beim Sitzungsstart und die Morgenzeile sehen keinen Rückstand)");
  assert.deepEqual([l.ki.modus, l.ki.stufe, l.ki.bewusst], ["aus", "aus", true]);
  const bericht = readFileSync(join(v, r.bericht), "utf8");
  assert.match(bericht, /fertig, ohne KI \(so eingestellt\)/);
  assert.match(bericht, /KI der Pflege: ohne KI/);
});

test("Ohne KI mit einem gewählten Konto bleibt bewusst (stufe aus gewinnt); ein Konto ohne erweitert, kein gewähltes Konto, unbekanntes Konto, kaputte Einstellung → ohne KI als WARNUNG (nicht erfolgreich) mit Grund", async () => {
  const v = aufbau();
  const faelle = [
    ["Konto unter erweitert", { konten: { ...ALLE_ERWEITERT, k_0000000b: "posteingang" }, pflege: { konto: "k_0000000b", stufe: "mittel" } }, /keine ausreichende Freigabe/],
    ["Konto gesperrt", { konten: { ...ALLE_ERWEITERT, k_0000000b: "gesperrt" }, pflege: { konto: "k_0000000b", stufe: "klein" } }, /keine ausreichende Freigabe/],
    ["kein Konto gewählt", { konten: ALLE_ERWEITERT, pflege: { konto: null, stufe: "mittel" } }, /kein KI-Konto gewählt/],
    ["unbekanntes Konto", { konten: ALLE_ERWEITERT, pflege: { konto: "k_deadbeef", stufe: "mittel" } }, /kein KI-Konto gewählt/],
    ["Codex-Konto", { konten: ALLE_ERWEITERT, pflege: { konto: "k_0000000c", stufe: "mittel" } }, /kein Claude-Code-Konto/],
    ["kaputte Stufe", { konten: ALLE_ERWEITERT, pflege: { konto: "k_0000000b", stufe: "riesig" } }, /nicht lesbar/],
    ["kein Objekt", { konten: ALLE_ERWEITERT, pflege: "mittel" }, /nicht lesbar/],
  ];
  for (const [name, e, grund] of faelle) {
    schreibeListe({ [v]: e });
    leereLog();
    const r = await mitProzessKonto(PROFIL_B, () => lauf(v, { claudeBefehl: BEFEHL }));
    assert.equal(aufrufe().length, 0, `${name}: keine KI`);
    assert.equal(r.status, "ohne-ki", name);
    assert.match(r.grund, grund, name);
    assert.ok(!r.grund.includes(HOME) && !r.grund.includes(SUPPORT), `${name}: der Grund nennt keine Pfade`);
    assert.equal(leseLetzter(v).erfolgreich, false, name);
  }
  schreibeListe({ [v]: { konten: { ...ALLE_ERWEITERT, k_0000000b: "gesperrt" }, pflege: { konto: "k_0000000b", stufe: "aus" } } });
  const r = await lauf(v, { claudeBefehl: BEFEHL });
  assert.equal(r.status, "ok-ohne-ki", "stufe aus ist bewusst, auch wenn das gewählte Konto nichts darf");
});

test("Stufe klein: jeder Aufruf fragt haiku (auch der Richter, der sonnet verlangt); die Schreibpflege (Sonnet) und der Traum laufen nicht", async () => {
  const v = aufbau();
  schreibeListe({ [v]: { konten: ALLE_ERWEITERT, pflege: { konto: "k_0000000a", stufe: "klein" } } });
  const ctx = frischerCtx(v);
  leereLog();
  const r = await kiAufruf(ctx, { system: "S", eingabe: "E", zweck: "richter", modell: "sonnet" });
  assert.equal(r.fehler, undefined);
  assert.deepEqual(aufrufe().map((a) => [a.modell, a.konto]), [["haiku", PROFIL_A]]);
  // mittel: der Richter bekommt sein sonnet
  schreibeListe({ [v]: { konten: ALLE_ERWEITERT, pflege: { konto: "k_0000000a", stufe: "mittel" } } });
  const ctx2 = frischerCtx(v);
  leereLog();
  await kiAufruf(ctx2, { system: "S", eingabe: "E", zweck: "richter", modell: "sonnet" });
  await kiAufruf(ctx2, { system: "S", eingabe: "E", zweck: "abgleich" });
  assert.deepEqual(aufrufe().map((a) => a.modell), ["sonnet", "haiku"]);
  // klein im ganzen Lauf: nie sonnet; B3 und Traum melden es im Bericht
  schreibeListe({ [v]: { konten: ALLE_ERWEITERT, pflege: { konto: "k_0000000a", stufe: "klein" } } });
  const v2 = aufbau({ automatik: { tageslauf: "an", einschwingen: 0, pflegeIntelligenz: "an", traum: "an" } });
  schreibeListe({ [v2]: { konten: ALLE_ERWEITERT, pflege: { konto: "k_0000000a", stufe: "klein" } } });
  leereLog();
  const lauf2 = await lauf(v2, { claudeBefehl: BEFEHL });
  assert.notEqual(lauf2.status, "fehler", JSON.stringify(lauf2));
  assert.ok(aufrufe().every((a) => a.modell === "haiku"), JSON.stringify(aufrufe().map((a) => a.modell)));
  const bericht = readFileSync(join(v2, lauf2.bericht), "utf8");
  assert.match(bericht, /KI der Pflege: klein/);
  assert.match(bericht, /Pflege-Stufe „klein“: die Schreibpflege \(Sonnet\) läuft nicht/);
  assert.equal(leseLetzter(v2).ki.stufe, "klein");
});

test("Sonnet-Weg (B3/Traum) mit Konto: die gehärtete Umgebung bekommt nur CLAUDE_CONFIG_DIR des Pflege-Kontos dazu, sonst keine BRAIN_*-Variablen außer BRAIN_ERNTE und BRAIN_VAULT (Kopie)", async () => {
  const v = aufbau();
  schreibeListe({ [v]: { konten: ALLE_ERWEITERT, pflege: { konto: "k_0000000b", stufe: "mittel" } } });
  const ctx = frischerCtx(v);
  const env = sonnetUmgebung("/tmp/kopie", pflegeVon(ctx).env);
  assert.equal(env.CLAUDE_CONFIG_DIR, PROFIL_B);
  assert.deepEqual(Object.keys(env).filter((k) => k.startsWith("BRAIN_")).sort(), ["BRAIN_ERNTE", "BRAIN_VAULT"]);
  // Standardprofil: Variable entfernt, auch wenn die Prozess-Umgebung eine hat
  schreibeListe({ [v]: { konten: ALLE_ERWEITERT, pflege: { konto: "k_00000001", stufe: "mittel" } } });
  const env2 = await mitProzessKonto(PROFIL_A, () => sonnetUmgebung("/tmp/kopie", pflegeVon(frischerCtx(v)).env));
  assert.equal(env2.CLAUDE_CONFIG_DIR, undefined);
  // ohne KI: rufeSonnet startet nichts
  schreibeListe({ [v]: { konten: ALLE_ERWEITERT, pflege: { konto: null, stufe: "aus" } } });
  leereLog();
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "pflege-konto-cwd-")));
  assert.deepEqual(await rufeSonnet(frischerCtx(v), { system: "S", eingabe: "x", cwd }), { ohneKi: true });
  assert.equal(aufrufe().length, 0);
});

test("pflegeAufloesen: Liste fehlt → alter Weg; Liste beschädigt → alter Weg (kiKontoDarf sperrt fail-closed); umgebungFuer ändert die übergebene Umgebung nicht", () => {
  const v = aufbau();
  const basis = { PATH: "/usr/bin", CLAUDE_CONFIG_DIR: "/x" };
  const leerSupport = realpathSync(mkdtempSync(join(tmpdir(), "pflege-konto-leer-")));
  assert.equal(pflegeAufloesen(v, { support: leerSupport, env: basis }).modus, "alt");
  writeFileSync(join(leerSupport, "ki-konten.json"), "{ kaputt");
  assert.equal(pflegeAufloesen(v, { support: leerSupport, env: basis }).modus, "alt");
  const ctx = { vault: v, claudeBefehl: BEFEHL, ...{} };
  process.env.BRAIN_APP_SUPPORT = leerSupport;
  try { assert.equal(kiBefehl(ctx), null, "beschädigte Liste: keine KI"); assert.equal(ctx.kiKontoGesperrt, true); } finally { process.env.BRAIN_APP_SUPPORT = SUPPORT; }
  const daten = { konten: KONTEN };
  const e = umgebungFuer(daten, "k_0000000a", basis);
  assert.equal(e.CLAUDE_CONFIG_DIR, PROFIL_A);
  assert.equal(basis.CLAUDE_CONFIG_DIR, "/x", "die Eingabe bleibt unverändert");
  assert.equal(umgebungFuer(daten, "k_00000001", basis).CLAUDE_CONFIG_DIR, undefined);
  assert.equal(umgebungFuer(daten, "k_unbekannt", basis).CLAUDE_CONFIG_DIR, undefined);
});

test("Attrappe und Umgebung: baueTestUmgebung lehnt Orte außerhalb des Temp-Ordners ab (Schutz der Tests selbst)", () => {
  assert.throws(() => baueTestUmgebung({ HOME, BRAIN_APP_SUPPORT: SUPPORT, CLAUDE_CONFIG_DIR: "/Users/jemand/.claude" }), /außerhalb des Temp-Ordners/);
  assert.doesNotThrow(() => baueTestUmgebung({ HOME, BRAIN_APP_SUPPORT: SUPPORT, CLAUDE_CONFIG_DIR: PROFIL_A }));
});

test("Fremde Zugangsdaten: im Pflege-Konto erreichen ANTHROPIC_* und CLAUDE_CODE_* (außer der Erlaubt-Liste) weder den Haiku- noch den Sonnet-Aufruf — das Konto der Liste bleibt das einzige, mit dem sich claude anmeldet", async () => {
  const v = aufbau();
  const fremd = { ANTHROPIC_API_KEY: "sk-test-1", ANTHROPIC_AUTH_TOKEN: "t-2", CLAUDE_CODE_OAUTH_TOKEN: "o-3", ANTHROPIC_BASE_URL: "https://fremd.example", CLAUDE_CODE_USE_BEDROCK: "1", CLAUDE_CODE_USE_VERTEX: "1", ANTHROPIC_MODEL: "x", AWS_BEARER_TOKEN_BEDROCK: "b-4", CLAUDE_CODE_GIT_BASH_PATH: "/opt/bash" };
  const alt = {};
  for (const [k, w] of Object.entries(fremd)) { alt[k] = process.env[k]; process.env[k] = w; }
  try {
    for (const [pflege, erwartetKonto] of [[{ konto: "k_0000000b", stufe: "mittel" }, PROFIL_B], [{ konto: "k_00000001", stufe: "klein" }, null]]) {
      schreibeListe({ [v]: { konten: ALLE_ERWEITERT, pflege } });
      leereLog();
      assert.equal((await kiAufruf(frischerCtx(v), { system: "S", eingabe: "E" })).fehler, undefined);
      assert.deepEqual(aufrufe().map((a) => [a.konto, a.fremd]), [[erwartetKonto, ["CLAUDE_CODE_GIT_BASH_PATH"]]], "Haiku: nur die Erlaubt-Liste bleibt");
      const env = sonnetUmgebung("/tmp/kopie", pflegeVon(frischerCtx(v)).env);
      assert.deepEqual(Object.keys(env).filter((k) => /^(ANTHROPIC_|CLAUDE_CODE_|AWS_BEARER_)/.test(k)), ["CLAUDE_CODE_GIT_BASH_PATH"], "Sonnet-Weg (B3, Traum)");
    }
    // der Sonnet-Weg ist auch ohne Pflege-Einstellung (alter Weg) sauber
    assert.deepEqual(Object.keys(sonnetUmgebung("/tmp/kopie", process.env)).filter((k) => /^(ANTHROPIC_|CLAUDE_CODE_|AWS_BEARER_)/.test(k)), ["CLAUDE_CODE_GIT_BASH_PATH"]);
    // umgebungFuer allein
    const e = umgebungFuer({ konten: KONTEN }, "k_0000000a", process.env);
    assert.ok(!Object.keys(e).some((k) => /^(ANTHROPIC_|AWS_BEARER_)/.test(k)) && e.CLAUDE_CONFIG_DIR === PROFIL_A);
  } finally { for (const [k, w] of Object.entries(alt)) { if (w === undefined) delete process.env[k]; else process.env[k] = w; } }
});
