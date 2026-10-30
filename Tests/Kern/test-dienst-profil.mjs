// .tools/tests/test-dienst-profil.mjs — Befund #8, seit P3 (Pflege-Konto je Vault) angepasst: Die plist des Dienstes trägt KEIN festes CLAUDE_CONFIG_DIR mehr
// (nur `--profil-behalten` der Umstellung als Rückfall); „brain dienst status“ zeigt ein altes Profil, und der KI-Aufruf (Tageslauf, Ernte, Nach-Ernte) erbt die Variable der Umgebung.
// Nur Temp-HOME, nie echtes launchctl (Ersatzprogramm über BRAIN_LAUNCHCTL), nie echtes claude (fake-claude).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { isoliere, neuerTestVault, FAKE_BEFEHL, KIT } from "./tageslauf-hilfe.mjs";
import { tempOrdner, nutzer, assistent, schreibeVerlauf } from "./verlauf-fixture.mjs";

const HOME = isoliere();
const PROFIL = join(HOME, "Profile & Mehr", ".claude-zweit");
const D = await import("../tageslauf/dienst.mjs");
const { supportOrdner } = await import("../pfade.mjs");
const { kindUmgebung, rufeHaiku, ernte } = await import("../ernte.mjs");
const { kiAufruf, neuesBudget } = await import("../tageslauf/ki.mjs");
const DIENST_CLI = join(KIT, "tageslauf", "dienst.mjs");

function fakeLaunchctl() {
  const d = tempOrdner("launchctl");
  const skript = join(d, "launchctl.mjs");
  writeFileSync(skript, "process.exit(0);\n");
  return skript;
}
// Umgebung: CLAUDE_CONFIG_DIR gesetzt oder gelöscht, danach wiederherstellen.
async function mitProfil(wert, f) {
  const alt = process.env.CLAUDE_CONFIG_DIR;
  if (wert === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = wert;
  try { return await f(); } finally { if (alt === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = alt; }
}
// Die Werkstatt hat das feste Profil in die Pflege-Einstellung übernommen: Vermerk `pflegeMigration` in ki-konten.json (erst dann darf `dienst an` die Variable entfernen).
const markiereMigriert = () => { mkdirSync(supportOrdner(), { recursive: true }); writeFileSync(join(supportOrdner(), "ki-konten.json"), JSON.stringify({ version: 1, konten: {}, vaults: {}, pflegeMigration: { seit: "2026-10-30T10:00:00.000Z", hinweise: [] } })); };
const unmarkiere = () => rmSync(join(supportOrdner(), "ki-konten.json"), { force: true });
const schluessel = (plist) => [...plist.split("<key>EnvironmentVariables</key>")[1].split("</dict>")[0].matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1]);
const DIENST_AN = (v, extra = {}) => D.dienstAn(v, { home: HOME, plattform: "darwin", node: process.execPath, claude: { befehl: "/opt/claude/bin/claude", args: [] }, ...extra });

test("plistInhalt: mit profil steht CLAUDE_CONFIG_DIR (XML-escaped) in den EnvironmentVariables, ohne profil fehlt der Schlüssel", () => {
  const basis = { starter: "/S/bin/kortex", pfad: "/usr/bin", log: "/S/logs/dienst.log" };
  const mit = D.plistInhalt({ ...basis, profil: "/Users/USER/Profil & Co/.claude" });
  assert.ok(mit.includes("<key>CLAUDE_CONFIG_DIR</key><string>/Users/USER/Profil &amp; Co/.claude</string>"));
  assert.deepEqual(schluessel(mit), ["PATH", "CLAUDE_CONFIG_DIR"], "nur diese eine Variable kommt zusätzlich dazu");
  for (const leer of [undefined, null, "", "   "]) {
    const ohne = D.plistInhalt({ ...basis, profil: leer });
    assert.ok(!ohne.includes("CLAUDE_CONFIG_DIR"), JSON.stringify(leer));
    assert.deepEqual(schluessel(ohne), ["PATH"]);
  }
});

test("dienstAn: die plist trägt KEIN CLAUDE_CONFIG_DIR mehr, auch wenn die Umgebung eines hat (das Konto kommt je Vault aus der Pflege-Einstellung); nur ein ausdrücklich übergebenes Profil (Umstellung) bleibt als Rückfall", async () => {
  const v = neuerTestVault();
  process.env.BRAIN_LAUNCHCTL = fakeLaunchctl();
  const fremd = "DIENST_PROFIL_PROBE_" + process.pid;
  process.env[fremd] = "x";
  try {
    const an = await mitProfil(PROFIL, () => DIENST_AN(v));
    assert.equal(an.ok, true);
    assert.equal(an.profil, null);
    assert.match(an.text, /KI-Konten/, "der Text verweist auf die Einstellung je Vault");
    const plist = readFileSync(D.plistPfad({ home: HOME }), "utf8");
    assert.ok(!plist.includes("CLAUDE_CONFIG_DIR") && !plist.includes(PROFIL), "kein festes Profil in der plist");
    assert.deepEqual(schluessel(plist), ["PATH"]);
    assert.ok(!plist.includes(fremd), "keine weitere Umgebungsvariable wird übernommen");
    // Ausdrücklich übergebenes Profil (Umstellung der Kit-Zeit: --profil-behalten) steht als Rückfall drin.
    const behalten = await mitProfil(undefined, () => DIENST_AN(v, { profil: "/anderes/profil" }));
    assert.equal(behalten.profil, "/anderes/profil");
    assert.ok(readFileSync(D.plistPfad({ home: HOME }), "utf8").includes("<key>CLAUDE_CONFIG_DIR</key><string>/anderes/profil</string>"));
    // Solange die Werkstatt das Profil nicht übernommen hat (kein Vermerk), behält ein erneutes „dienst an“ die Variable: sie ist bis dahin das Konto der Pflege.
    unmarkiere();
    const bleibt = await mitProfil(PROFIL, () => DIENST_AN(v));
    assert.equal(bleibt.profil, "/anderes/profil");
    assert.ok(readFileSync(D.plistPfad({ home: HOME }), "utf8").includes("<string>/anderes/profil</string>"), "ohne Vermerk bleibt das feste Profil");
    // Nach dem Vermerk schreibt „dienst an“ die plist ohne die Variable neu; die alte Fassung bleibt als *.vor-pflege.
    markiereMigriert();
    await mitProfil(PROFIL, () => DIENST_AN(v));
    assert.ok(!readFileSync(D.plistPfad({ home: HOME }), "utf8").includes("CLAUDE_CONFIG_DIR"));
    assert.ok(readFileSync(`${D.plistPfad({ home: HOME })}.vor-pflege`, "utf8").includes("<string>/anderes/profil</string>"), "Sicherung der alten plist");
  } finally { D.dienstAus(v, { home: HOME }); unmarkiere(); rmSync(`${D.plistPfad({ home: HOME })}.vor-pflege`, { force: true }); delete process.env.BRAIN_LAUNCHCTL; delete process.env[fremd]; }
});

test("dienstAn mit ausdrücklichem Profil: ein relativer oder ~-Pfad wird absolut gemacht (launchd kennt weder Arbeitsordner noch ~)", async () => {
  const v = neuerTestVault();
  process.env.BRAIN_LAUNCHCTL = fakeLaunchctl();
  try {
    const rel = await mitProfil(undefined, () => DIENST_AN(v, { profil: "profile/zweit" }));
    assert.ok(rel.profil.startsWith("/") && rel.profil.endsWith("/profile/zweit"), rel.profil);
    const tilde = await mitProfil(undefined, () => DIENST_AN(v, { profil: "~/.claude-zweit" }));
    assert.equal(tilde.profil, join(HOME, ".claude-zweit"));
  } finally { D.dienstAus(v, { home: HOME }); delete process.env.BRAIN_LAUNCHCTL; }
});

test("dienstStatus: zeigt das Profil, das eine ältere plist noch trägt (Pfad), sonst null; nicht eingerichtet → null", async () => {
  const v = neuerTestVault();
  process.env.BRAIN_LAUNCHCTL = fakeLaunchctl();
  try {
    assert.equal(D.dienstStatus(v, { home: HOME }).profil, null, "nicht eingerichtet");
    await mitProfil(undefined, () => DIENST_AN(v, { profil: PROFIL }));
    assert.equal(D.dienstStatus(v, { home: HOME }).profil, PROFIL, "XML-Escaping wird rückgängig gemacht");
    markiereMigriert();                                    // erst nach der Übernahme in die Pflege-Einstellung entfernt „dienst an“ das Profil
    await mitProfil(PROFIL, () => DIENST_AN(v));
    const s = D.dienstStatus(v, { home: HOME });
    assert.equal(s.eingerichtet, true);
    assert.equal(s.profil, null, "die neue plist trägt kein Profil");
  } finally { D.dienstAus(v, { home: HOME }); unmarkiere(); rmSync(`${D.plistPfad({ home: HOME })}.vor-pflege`, { force: true }); delete process.env.BRAIN_LAUNCHCTL; }
});

test("brain dienst an/status (CLI): `an` schreibt kein Profil (auch nicht aus der Sitzung), `an --profil-behalten` schon; status weist auf ein altes Profil in der plist hin", async () => {
  const v = neuerTestVault();
  const launchctl = fakeLaunchctl();
  const lauf = (args, profilDerSitzung) => {
    // KORTEX_DIENST_PLATTFORM: `dienst an` gibt es nur auf dem Mac; die Testumgebung (KORTEX_KERN_UNSTABIL_ERLAUBT) darf die Plattform vorgeben, damit der Test auch auf Linux-Runnern läuft
    const env = { ...process.env, HOME, USERPROFILE: HOME, BRAIN_LAUNCHCTL: launchctl, KORTEX_KERN_UNSTABIL_ERLAUBT: "1", KORTEX_DIENST_PLATTFORM: "darwin" };
    delete env.CLAUDE_CONFIG_DIR;
    if (profilDerSitzung) env.CLAUDE_CONFIG_DIR = profilDerSitzung;
    const r = spawnSync(process.execPath, [DIENST_CLI, v, ...args], { encoding: "utf8", env });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  const plistText = () => readFileSync(D.plistPfad({ home: HOME }), "utf8");
  process.env.BRAIN_LAUNCHCTL = launchctl;
  try {
    assert.ok(!/Profil/.test(lauf(["status"])), "nicht eingerichtet → keine Profil-Zeile");
    lauf(["an"], PROFIL);
    assert.ok(!plistText().includes("CLAUDE_CONFIG_DIR"), "`an` übernimmt das Profil der Sitzung nicht mehr");
    assert.ok(!/Profil/.test(lauf(["status"], PROFIL)), "ohne festes Profil keine Hinweiszeile");
    lauf(["an", "--profil-behalten"], PROFIL);
    assert.ok(plistText().includes(`<key>CLAUDE_CONFIG_DIR</key><string>${PROFIL.replace(/&/g, "&amp;")}</string>`), "Rückfall für die Umstellung");
    const mit = lauf(["status"]);
    assert.ok(mit.includes(PROFIL) && /festes Claude-Profil/.test(mit) && /KI-Konto der Pflege/.test(mit) && /Öffne dazu Kortex/.test(mit), mit);
    lauf(["an"]);
    assert.ok(plistText().includes("CLAUDE_CONFIG_DIR"), "ohne Vermerk der Übernahme bleibt das feste Profil");
    markiereMigriert();
    assert.ok(/Die Einstellung des Dienstes trägt noch ein festes Claude-Profil/.test(lauf(["status"])), "nach dem Vermerk der Hinweis auf `dienst an`");
    lauf(["an"]);
    assert.ok(!plistText().includes("CLAUDE_CONFIG_DIR"), "nach dem Vermerk entfernt ein erneutes `an` es");
    assert.ok(existsSync(`${D.plistPfad({ home: HOME })}.vor-pflege`));
    unmarkiere();
  } finally { D.dienstAus(v, { home: HOME }); unmarkiere(); rmSync(`${D.plistPfad({ home: HOME })}.vor-pflege`, { force: true }); delete process.env.BRAIN_LAUNCHCTL; }
});

test("kindUmgebung: CLAUDE_CONFIG_DIR bleibt erhalten (wird nicht als Sitzungsvariable weggefiltert)", () => {
  const aus = kindUmgebung({ PATH: "/bin", CLAUDE_CONFIG_DIR: PROFIL, CLAUDECODE: "1", GIT_DIR: "/x" });
  assert.equal(aus.CLAUDE_CONFIG_DIR, PROFIL);
  assert.equal(aus.CLAUDECODE, undefined);
  assert.equal(aus.BRAIN_ERNTE, "1");
});

// ---- Der echte KI-Aufruf erbt die Variable: fake-claude schreibt sie ins Protokoll (claudeConfigDir) ----
function fakeUmgebung() {
  const d = tempOrdner("fake-claude");
  const aus = join(d, "ausgabe.txt");
  writeFileSync(aus, "NICHTS\n");
  process.env.FAKE_CLAUDE_AUSGABE = aus;
  process.env.FAKE_CLAUDE_LOG = join(d, "eingabe.txt");
  const protokoll = () => JSON.parse(readFileSync(process.env.FAKE_CLAUDE_LOG + ".json", "utf8"));
  return { protokoll, weg: () => { delete process.env.FAKE_CLAUDE_AUSGABE; delete process.env.FAKE_CLAUDE_LOG; } };
}

test("rufeHaiku und kiAufruf (Tageslauf): das Kind sieht dasselbe CLAUDE_CONFIG_DIR wie der Aufrufer; ohne Variable keins", async () => {
  const v = neuerTestVault();
  const f = fakeUmgebung();
  try {
    await mitProfil(PROFIL, async () => {
      const r = await rufeHaiku(FAKE_BEFEHL, "System", "Eingabe", v);
      assert.equal(r.fehler, undefined);
      assert.equal(f.protokoll().claudeConfigDir, PROFIL, "rufeHaiku");
      rmDatei(process.env.FAKE_CLAUDE_LOG + ".json");
      const ctx = { vault: v, claudeBefehl: FAKE_BEFEHL, budget: neuesBudget(), aufrufe: 0, tokens: { ein: 0, aus: 0 }, kiFehlerFolge: 0 };
      const k = await kiAufruf(ctx, { system: "System", eingabe: "Eingabe", zweck: "probe" });
      assert.equal(k.fehler, undefined);
      assert.equal(f.protokoll().claudeConfigDir, PROFIL, "kiAufruf des Tageslaufs");
    });
    await mitProfil(undefined, async () => {
      rmDatei(process.env.FAKE_CLAUDE_LOG + ".json");
      await rufeHaiku(FAKE_BEFEHL, "System", "Eingabe", v);
      assert.equal(f.protokoll().claudeConfigDir, null);
    });
  } finally { f.weg(); }
});

const rmDatei = (p) => rmSync(p, { force: true });

test("Ernte und Nach-Ernte: der KI-Aufruf erbt CLAUDE_CONFIG_DIR", async () => {
  const f = fakeUmgebung();
  try {
    const v = tempOrdner("ernte-profil");
    writeFileSync(join(v, "brain.config.json"), JSON.stringify({ automatik: {} }));
    const transkript = join(tempOrdner("transkript"), "s.jsonl");
    const zeilen = [];
    for (let i = 1; i <= 6; i++) zeilen.push(nutzer(`Frage ${i} zum Testbrett`), assistent(`Antwort ${i}: erledigt.`));
    schreibeVerlauf(transkript, zeilen);
    await mitProfil(PROFIL, async () => {
      const r = await ernte(v, { art: "fakt", transkript, sid: "s-profil", cwd: "/projekte/offen", claudeBefehl: FAKE_BEFEHL });
      assert.equal(r.status, "ok", JSON.stringify(r));
      assert.equal(f.protokoll().claudeConfigDir, PROFIL, "Ernte");
      rmDatei(process.env.FAKE_CLAUDE_LOG + ".json");
      const n = await ernte(v, { art: "fakt", transkript, sid: "s-profil-2", cwd: "/projekte/offen", claudeBefehl: FAKE_BEFEHL, nachernte: true });
      assert.ok(["ok", "teilweise"].includes(n.status), JSON.stringify(n));
      assert.ok(n.aufrufe >= 1);
      assert.equal(f.protokoll().claudeConfigDir, PROFIL, "Nach-Ernte");
    });
  } finally { f.weg(); }
});

// launchctl-Attrappe: scheitert beim ersten `bootstrap` (nach dem Zähler) und protokolliert jeden Aufruf
function launchctlMitFehler(scheitern) {
  const d = tempOrdner("launchctl-fehler"); const skript = join(d, "launchctl.mjs"); const log = join(d, "aufrufe.log");
  writeFileSync(skript, `import { appendFileSync, readFileSync, writeFileSync, existsSync } from "node:fs";
const a = process.argv.slice(2); appendFileSync(${JSON.stringify(log)}, a[0] + "\\n");
if (a[0] === "bootstrap") { const z = ${JSON.stringify(join(d, "zaehler"))}; const n = existsSync(z) ? Number(readFileSync(z, "utf8")) : 0; writeFileSync(z, String(n + 1)); if (n < ${scheitern}) process.exit(1); }
process.exit(0);\n`);
  return { skript, aufrufe: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []) };
}

test("dienstAn: scheitert das Laden der neuen plist, kommt die alte (mit ihrem Profil) zurück und wird erneut geladen — die Sicherung *.vor-pflege bleibt", async () => {
  const v = neuerTestVault();
  const l = launchctlMitFehler(0);
  process.env.BRAIN_LAUNCHCTL = l.skript;
  try {
    markiereMigriert();
    await mitProfil(undefined, () => DIENST_AN(v, { profil: "/altes/profil" }));          // alte Fassung mit Profil (bootstrap klappt: Zähler 0 → scheitert nie)
    const alt = readFileSync(D.plistPfad({ home: HOME }), "utf8");
    assert.ok(alt.includes("/altes/profil"));
    const f = launchctlMitFehler(1);                                                          // das nächste bootstrap scheitert, das danach klappt
    process.env.BRAIN_LAUNCHCTL = f.skript;
    const r = await mitProfil(undefined, () => DIENST_AN(v));
    assert.equal(r.ok, false); assert.equal(r.alteWiederHergestellt, true); assert.equal(r.alteGeladen, true);
    assert.match(r.text, /Die bisherige ist wieder eingetragen und geladen/);
    assert.equal(readFileSync(D.plistPfad({ home: HOME }), "utf8"), alt, "die alte plist liegt wieder da");
    assert.ok(readFileSync(`${D.plistPfad({ home: HOME })}.vor-pflege`, "utf8").includes("/altes/profil"));
    assert.deepEqual(f.aufrufe(), ["bootout", "bootstrap", "bootout", "bootstrap"], "bootout, neu laden (Fehler), bootout, alte laden");
  } finally { D.dienstAus(v, { home: HOME }); rmSync(`${D.plistPfad({ home: HOME })}.vor-pflege`, { force: true }); unmarkiere(); delete process.env.BRAIN_LAUNCHCTL; }
});
