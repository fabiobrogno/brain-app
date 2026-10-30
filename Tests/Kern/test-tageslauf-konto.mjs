// Tests/Kern/test-tageslauf-konto.mjs — KI-Konten (docs/plaene/ki-konten.md, Abschnitt 2a/2d): der Hintergrund-Tageslauf, die KI-Pflege (Pflege-Lauf), die Antwort-Messlatte und jeder
// rufeHaiku-Aufruf geben Vault-Inhalt nur an eine KI, wenn das Konto, das die Umgebung des PROZESSES bestimmt (CLAUDE_CONFIG_DIR, fehlt sie: Standardprofil), für den Vault mindestens
// „erweitert“ hat (Ernte/Nachernte: „posteingang“). Sonst läuft die Pflege ohne KI (die Schritte ohne KI laufen weiter, kein Absturz). Fehlt die Liste ohne Spur, gilt das bisherige Verhalten.
// Jede Kindprozess-Umgebung kommt aus baueTestUmgebung (nie ...process.env); die KI ist die Attrappe fake-ki-protokoll.mjs (strenges Argument-Parsing, protokolliert jeden Aufruf);
// kein echtes claude/launchctl, keine echten Nutzerorte (HOME, Support, Profile liegen unter dem Temp-Ordner).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, realpathSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { baueTestUmgebung } from "./konto-hilfe.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
const KERN = join(HIER, "..");
const FAKE = join(HIER, "fake-ki-protokoll.mjs");
const KIND = join(HIER, "konto-kind.mjs");
const temp = (p) => realpathSync(mkdtempSync(join(tmpdir(), p)));
const HOME = temp("tl-konto-home-");
const CACHE = temp("tl-konto-cache-");
const kennung = (p) => { const st = statSync(p); return `${st.dev}:${st.ino}:${st.birthtimeMs}`; };
const profil = (n) => { const p = join(HOME, n); mkdirSync(p, { recursive: true }); return realpathSync(p); };
const PROFIL_A = profil(".claude-a"), PROFIL_STD = profil(".claude"), PROFIL_FREMD = profil(".claude-fremd");

// Ein Szenario: eigener Support-Ordner, eigene Attrappen-Protokolldatei, die Liste mit Konto A und Standardkonto (Fremdes Profil ist NICHT in der Liste).
function szenario(vault, { stufeA = "erweitert", stufeStd = "gesperrt", vaultInListe = true } = {}) {
  const support = temp("tl-konto-support-");
  const log = join(support, "ki-aufrufe.jsonl");
  const liste = (eigene = {}) => JSON.stringify({ version: 1,
    konten: {
      k_aaaaaaaa: { programm: "claude", ordner: PROFIL_A, standard: false, name: "A", ordnerKennung: kennung(PROFIL_A) },
      k_cccccccc: { programm: "claude", ordner: PROFIL_STD, standard: true, name: "Standard", ordnerKennung: kennung(PROFIL_STD) },
    },
    vaults: vaultInListe ? { [vault]: { ordnerKennung: kennung(vault), neueKonten: "gesperrt", ohneKonto: "gesperrt", konten: { k_aaaaaaaa: stufeA, k_cccccccc: stufeStd, ...eigene } } } : {} });
  const schreibe = () => writeFileSync(join(support, "ki-konten.json"), liste());
  schreibe();
  const aufrufe = () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map((z) => JSON.parse(z)) : []);
  return { support, log, schreibe, aufrufe };
}
// Die Umgebung eines Kindprozesses; `profilDir`: CLAUDE_CONFIG_DIR (null = Variable fehlt = Standardprofil).
function umgebung(s, profilDir, extra = {}) {
  return baueTestUmgebung({ HOME, BRAIN_APP_SUPPORT: s.support, KORTEX_KERN_UNSTABIL_ERLAUBT: "1", KORTEX_VAULT_VERTRAUT: "alle", BRAIN_CLAUDE: FAKE, FAKE_KI_LOG: s.log,
    BRAIN_TAGESLAUF_CACHE: CACHE, ...(profilDir ? { CLAUDE_CONFIG_DIR: profilDir } : {}), ...extra });
}
const kind = (args, env) => spawnSync(process.execPath, args, { env, encoding: "utf8", windowsHide: true, timeout: 120000 });

// ---- Vaults ----
// Antwort-Messlatte: der kleinste Vault mit einem KI-Weg (eine Testfrage → ein Haiku-Aufruf).
function antwortVault() {
  const v = join(temp("tl-konto-antwort-"), "Jo's Vault Ü");
  mkdirSync(join(v, "09_wiki", "reise"), { recursive: true });
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ automatik: {} }));
  writeFileSync(join(v, "09_wiki", "reise", "thema_faehre.md"), "# Fähre\n\nDie erste Fähre fährt um 9 Uhr ab Dagebüll.\n");
  writeFileSync(join(v, "09_wiki", "_antworten.json"), JSON.stringify([{ frage: "Wann fährt die erste Fähre?", seite: "thema_faehre.md", kernfakten: ["9 Uhr"] }]));
  return v;
}
const antwortLauf = (v, s, profilDir) => kind([join(KERN, "antwort-messlatte.mjs"), "--anlass", "knopf", v], umgebung(s, profilDir));
const antwortLog = (v) => { try { return readFileSync(join(v, ".logs", "antwort-messlatte.log"), "utf8"); } catch { return ""; } }; // Protokollname siehe LOG in antwort-messlatte.mjs

// ---- Alle Fälle, in denen NICHT an die KI gehen darf ----
const KEIN_KI = [
  ["Konto posteingang", { stufeA: "posteingang" }, "a"],
  ["Konto lesen", { stufeA: "lesen" }, "a"],
  ["Konto gesperrt", { stufeA: "gesperrt" }, "a"],
  ["unbekanntes Konto (Profil nicht in der Liste)", {}, "fremd"],
  ["Vault nicht in der Liste", { vaultInListe: false }, "a"],
  ["Standardprofil (Variable fehlt) mit Stufe gesperrt", { stufeStd: "gesperrt" }, "std"],
  ["Standardprofil (Variable fehlt) mit Stufe posteingang", { stufeStd: "posteingang" }, "std"],
];
const PROFILE = { a: PROFIL_A, fremd: PROFIL_FREMD, std: null };

for (const [name, opt, wer] of KEIN_KI) {
  test(`Antwort-Messlatte (Dienst/Pflege): ${name} → kein KI-Aufruf, Lauf endet ohne Absturz, neutrale Meldung`, () => {
    const v = antwortVault();
    const s = szenario(v, opt);
    const r = antwortLauf(v, s, PROFILE[wer]);
    assert.equal(s.aufrufe().length, 0, `die Attrappe wurde nicht gerufen (${r.stderr})`);
    assert.equal(r.signal, null, "kein Absturz"); assert.ok(r.status === 0 || r.status === 1, `Exit ${r.status}: ${r.stderr}`);
    assert.doesNotMatch(r.stdout + r.stderr, /Traceback|TypeError|ReferenceError|at .*\.mjs:\d+/, "keine Fehlerausgabe des Programms");
    const log = antwortLog(v);
    assert.match(log, /grund=ki-konto/, `Protokoll: ${log}`);
    assert.ok(!log.includes(PROFIL_A) && !log.includes(HOME) && !log.includes(s.support), "die Meldung nennt weder Profile noch Pfade");
  });
}

test("Antwort-Messlatte: Konto erweitert → die KI wird aufgerufen (Gegenprobe, mit dem Konto der Umgebung)", () => {
  const v = antwortVault();
  const s = szenario(v, { stufeA: "erweitert" });
  const r = antwortLauf(v, s, PROFIL_A);
  assert.equal(r.status, 0, r.stderr);
  const a = s.aufrufe();
  assert.equal(a.length, 1, "genau ein Haiku-Aufruf (eine Testfrage)");
  assert.equal(a[0].konto, PROFIL_A, "der Aufruf lief mit dem Konto der Umgebung");
  assert.doesNotMatch(antwortLog(v), /ki-konto/);
});

test("Antwort-Messlatte: das Standardprofil (CLAUDE_CONFIG_DIR fehlt) mit Stufe erweitert darf", () => {
  const v = antwortVault();
  const s = szenario(v, { stufeStd: "erweitert" });
  const r = antwortLauf(v, s, null);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(s.aufrufe().length, 1);
  assert.equal(s.aufrufe()[0].konto, null);
});

test("defekte Liste → kein KI-Aufruf (fail-closed), kein Absturz", () => {
  const v = antwortVault();
  const s = szenario(v);
  writeFileSync(join(s.support, "ki-konten.json"), "{ das ist kein JSON");
  const r = antwortLauf(v, s, PROFIL_A);
  assert.equal(s.aufrufe().length, 0);
  assert.ok(r.status === 0 || r.status === 1, r.stderr);
  assert.match(antwortLog(v), /grund=ki-konto/);
});

test("gelöschte Liste (Datei fehlt, aber <support>/ki-konten.angelegt existiert) → kein KI-Aufruf", () => {
  const v = antwortVault();
  const s = szenario(v);
  writeFileSync(join(s.support, "ki-konten.angelegt"), "");
  rmSync(join(s.support, "ki-konten.json"));
  const r = antwortLauf(v, s, PROFIL_A);
  assert.equal(s.aufrufe().length, 0);
  assert.ok(r.status === 0 || r.status === 1, r.stderr);
  assert.match(antwortLog(v), /grund=ki-konto/);
});

test("fehlende Liste ohne Spur (Übergang vor dem ersten Start der neuen App) → bisheriges Verhalten: die KI darf", () => {
  const v = antwortVault();
  const s = szenario(v);
  rmSync(join(s.support, "ki-konten.json"));
  const r = antwortLauf(v, s, PROFIL_A);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(s.aufrufe().length, 1);
});

// ---- rufeHaiku: die letzte Sicherung vor dem Start (Ernte: posteingang, Dienst/Pflege: erweitert) ----
const haiku = (v, s, profilDir, stufe) => {
  const r = kind([KIND, "haiku", v, ...(stufe ? [stufe] : [])], umgebung(s, profilDir));
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim());
};

test("rufeHaiku: Standardstufe posteingang (Ernte) — posteingang darf, lesen/gesperrt nicht; erweitert verlangt erweitert", () => {
  const v = antwortVault();
  for (const [stufeA, verlangt, erwartet] of [["posteingang", undefined, true], ["lesen", undefined, false], ["gesperrt", undefined, false], ["posteingang", "erweitert", false], ["erweitert", "erweitert", true]]) {
    const s = szenario(v, { stufeA });
    const e = haiku(v, s, PROFIL_A, verlangt);
    assert.equal(e.ok, erwartet, `${stufeA} / verlangt ${verlangt ?? "Standard"}: ${JSON.stringify(e)}`);
    assert.equal(s.aufrufe().length, erwartet ? 1 : 0);
    if (!erwartet) assert.ok(!JSON.stringify(e).includes(HOME), "die Fehlermeldung nennt keine Pfade");
  }
});

test("rufeHaiku: defekte und gelöschte Liste → keine KI, unbekanntes Konto → keine KI", () => {
  const v = antwortVault();
  let s = szenario(v);
  writeFileSync(join(s.support, "ki-konten.json"), "[]");
  assert.equal(haiku(v, s, PROFIL_A).ok, false); assert.equal(s.aufrufe().length, 0);
  s = szenario(v);
  writeFileSync(join(s.support, "ki-konten.angelegt"), ""); rmSync(join(s.support, "ki-konten.json"));
  assert.equal(haiku(v, s, PROFIL_A).ok, false); assert.equal(s.aufrufe().length, 0);
  s = szenario(v);
  assert.equal(haiku(v, s, PROFIL_FREMD).ok, false); assert.equal(s.aufrufe().length, 0);
});

test("Nach-Ernte (nachernteAlle): ein Konto unter „posteingang“ endet mit abbruch=konto, ohne KI-Aufruf und ohne Absturz; mit posteingang läuft sie an", () => {
  const v = antwortVault();
  mkdirSync(join(v, ".logs", "transkript-sicherung"), { recursive: true });
  writeFileSync(join(v, ".logs", "transkript-sicherung", "sitzung1.jsonl"), JSON.stringify({ type: "user", cwd: HOME, message: { role: "user", content: "Hallo" } }) + "\n");
  let s = szenario(v, { stufeA: "lesen" });
  let r = kind([KIND, "nachernte", v], umgebung(s, PROFIL_A));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim()), { abbruch: "konto", aufrufe: 0 });
  assert.equal(s.aufrufe().length, 0);
  s = szenario(v, { stufeA: "posteingang" });
  r = kind([KIND, "nachernte", v], umgebung(s, PROFIL_A));
  assert.equal(r.status, 0, r.stderr);
  assert.notEqual(JSON.parse(r.stdout.trim()).abbruch, "konto");
});

// ---- Der Tageslauf selbst (Probelauf: schreibt nichts, ruft aber dieselben KI-Wege) ----
// Der Vault aus lauf-hilfe.mjs (Vorschläge mit Beleg). Die Hilfen setzen Umgebungsvariablen NUR im Testprozess; die Kindumgebung baut `umgebung`.
const { isoliere } = await import("./tageslauf-hilfe.mjs");
const { aufbau } = await import("./lauf-hilfe.mjs");
isoliere();
const tageslaufLauf = (v, s, profilDir) => kind([join(KERN, "tageslauf.mjs"), "--probe", v], umgebung(s, profilDir, { BRAIN_GIT_HOOKS_ERLAUBT: join(v, ".hooks") }));

test("Tageslauf: Konto erweitert → die KI wird aufgerufen; der Lauf endet normal", () => {
  const v = aufbau();
  const s = szenario(v, { stufeA: "erweitert" });
  const r = tageslaufLauf(v, s, PROFIL_A);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(s.aufrufe().length > 0, `die Attrappe wurde gerufen: ${r.stdout}`);
  assert.ok(s.aufrufe().every((a) => a.konto === PROFIL_A));
  assert.doesNotMatch(r.stdout, /ohne KI/);
});

for (const [name, opt, wer] of KEIN_KI) {
  test(`Tageslauf: ${name} → kein KI-Aufruf, der Lauf endet ohne Absturz als „ohne KI“, neutraler Grund`, () => {
    const v = aufbau();
    const s = szenario(v, opt);
    const r = tageslaufLauf(v, s, PROFILE[wer]);
    assert.equal(s.aufrufe().length, 0, `keine KI (${r.stdout}${r.stderr})`);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /ohne KI/);
    assert.match(r.stdout, /keine ausreichende Freigabe/);
    assert.ok(!r.stdout.includes(PROFIL_A) && !r.stdout.includes(HOME) && !r.stdout.includes(s.support), "die Meldung nennt weder Profile noch Pfade");
  });
}

test("Tageslauf: defekte Liste und gelöschte Liste → kein KI-Aufruf, ohne Absturz", () => {
  for (const art of ["defekt", "geloescht"]) {
    const v = aufbau();
    const s = szenario(v);
    if (art === "defekt") writeFileSync(join(s.support, "ki-konten.json"), "{ kaputt");
    else { writeFileSync(join(s.support, "ki-konten.angelegt"), ""); rmSync(join(s.support, "ki-konten.json")); }
    const r = tageslaufLauf(v, s, PROFIL_A);
    assert.equal(s.aufrufe().length, 0, art);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /ohne KI/, art);
  }
});

test("Tageslauf: fehlende Liste ohne Spur → bisheriges Verhalten (die KI darf)", () => {
  const v = aufbau();
  const s = szenario(v);
  rmSync(join(s.support, "ki-konten.json"));
  const r = tageslaufLauf(v, s, PROFIL_A);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(s.aufrufe().length > 0);
});

// ---- Pflege-Lauf (Haiku über die Berichte), per Kommandozeile wie der Dienst ----
function pflegeVault() {
  const v = join(temp("tl-konto-pflege-"), "Pflege Vault Ü");
  mkdirSync(join(v, "09_wiki", "garten"), { recursive: true });
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ automatik: {} }));
  for (const n of ["beet", "kompost"]) writeFileSync(join(v, "09_wiki", "garten", `thema_${n}.md`), `# ${n}\n\nText zu ${n}.\n`);
  const git = (...a) => spawnSync("git", ["-C", v, ...a], { encoding: "utf8", env: baueTestUmgebung({ HOME, BRAIN_APP_SUPPORT: HOME }) });
  git("init", "-q"); git("add", "--", "09_wiki", "brain.config.json");
  git("-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false", "commit", "-qm", "x");
  return v;
}
const pflegeLauf = (v, s, profilDir) => kind([join(KERN, "pflegelauf.mjs"), "--anlass", "knopf", v], umgebung(s, profilDir));
const pflegeLog = (v) => { try { return readFileSync(join(v, ".logs", "pflege-lauf.log"), "utf8"); } catch { return ""; } };

test("Pflege-Lauf: erweitert → KI; posteingang/gesperrt/unbekannt/defekt → keine KI, Protokollzeile grund=ki-konto, kein Absturz", () => {
  const v = pflegeVault();
  let s = szenario(v, { stufeA: "erweitert" });
  let r = pflegeLauf(v, s, PROFIL_A);
  assert.equal(r.status, 0, r.stderr);
  const mitKi = s.aufrufe().length;
  assert.ok(mitKi > 0, `die Pflege ruft die KI (Protokoll: ${pflegeLog(v)})`);
  for (const [opt, dir, info] of [[{ stufeA: "posteingang" }, PROFIL_A, "posteingang"], [{ stufeA: "gesperrt" }, PROFIL_A, "gesperrt"], [{}, PROFIL_FREMD, "unbekannt"]]) {
    rmSync(join(v, ".logs"), { recursive: true, force: true });
    s = szenario(v, opt);
    r = pflegeLauf(v, s, dir);
    assert.equal(s.aufrufe().length, 0, info);
    assert.equal(r.signal, null); assert.ok(r.status === 0 || r.status === 1, r.stderr);
    assert.match(pflegeLog(v), /grund=ki-konto/, info);
    assert.ok(!pflegeLog(v).includes(HOME), "kein Pfad im Protokoll");
  }
  rmSync(join(v, ".logs"), { recursive: true, force: true });
  s = szenario(v); writeFileSync(join(s.support, "ki-konten.json"), "kaputt");
  pflegeLauf(v, s, PROFIL_A);
  assert.equal(s.aufrufe().length, 0, "defekte Liste");
});
