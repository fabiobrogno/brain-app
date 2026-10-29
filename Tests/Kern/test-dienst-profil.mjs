// .tools/tests/test-dienst-profil.mjs — Befund #8: Der Hintergrunddienst übernimmt das Claude-Profil (CLAUDE_CONFIG_DIR) des
// Einrichtens, „brain dienst status“ zeigt es, und der KI-Aufruf (Tageslauf, Ernte, Nach-Ernte) erbt die Variable.
// Nur Temp-HOME, nie echtes launchctl (Ersatzprogramm über BRAIN_LAUNCHCTL), nie echtes claude (fake-claude).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { isoliere, neuerTestVault, FAKE_BEFEHL, KIT } from "./tageslauf-hilfe.mjs";
import { tempOrdner, nutzer, assistent, schreibeVerlauf } from "./verlauf-fixture.mjs";

const HOME = isoliere();
const PROFIL = join(HOME, "Profile & Mehr", ".claude-zweit");
const D = await import("../tageslauf/dienst.mjs");
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

test("dienstAn: ein gesetztes CLAUDE_CONFIG_DIR der Umgebung kommt in die plist, nichts sonst aus der Umgebung", async () => {
  const v = neuerTestVault();
  process.env.BRAIN_LAUNCHCTL = fakeLaunchctl();
  const fremd = "DIENST_PROFIL_PROBE_" + process.pid;
  process.env[fremd] = "x";
  try {
    const an = await mitProfil(PROFIL, () => DIENST_AN(v));
    assert.equal(an.ok, true);
    assert.equal(an.profil, PROFIL);
    const plist = readFileSync(D.plistPfad({ home: HOME }), "utf8");
    assert.ok(plist.includes(`<key>CLAUDE_CONFIG_DIR</key><string>${PROFIL.replace(/&/g, "&amp;")}</string>`));
    assert.deepEqual(schluessel(plist), ["PATH", "CLAUDE_CONFIG_DIR"]);
    assert.ok(!plist.includes(fremd), "keine weitere Umgebungsvariable wird übernommen");

    const ohne = await mitProfil(undefined, () => DIENST_AN(v));
    assert.equal(ohne.profil, null);
    assert.ok(!readFileSync(D.plistPfad({ home: HOME }), "utf8").includes("CLAUDE_CONFIG_DIR"), "ohne Variable keine Zeile (Standardprofil)");
    const leer = await mitProfil("  ", () => DIENST_AN(v));
    assert.equal(leer.profil, null, "leere Variable zählt als nicht gesetzt");
    // Ausdrücklich übergebenes Profil gewinnt gegen die Umgebung.
    const ausdruecklich = await mitProfil(PROFIL, () => DIENST_AN(v, { profil: "/anderes/profil" }));
    assert.equal(ausdruecklich.profil, "/anderes/profil");
    assert.ok(readFileSync(D.plistPfad({ home: HOME }), "utf8").includes("<string>/anderes/profil</string>"));
  } finally { D.dienstAus(v, { home: HOME }); delete process.env.BRAIN_LAUNCHCTL; delete process.env[fremd]; }
});

test("dienstAn: ein relativer oder ~-Pfad wird absolut gemacht (launchd kennt weder Arbeitsordner noch ~)", async () => {
  const v = neuerTestVault();
  process.env.BRAIN_LAUNCHCTL = fakeLaunchctl();
  try {
    const rel = await mitProfil("profile/zweit", () => DIENST_AN(v));
    assert.ok(rel.profil.startsWith("/") && rel.profil.endsWith("/profile/zweit"), rel.profil);
    const tilde = await mitProfil("~/.claude-zweit", () => DIENST_AN(v));
    assert.equal(tilde.profil, join(HOME, ".claude-zweit"));
  } finally { D.dienstAus(v, { home: HOME }); delete process.env.BRAIN_LAUNCHCTL; }
});

test("dienstStatus: zeigt das Profil aus der plist (Pfad) bzw. null für das Standardprofil; nicht eingerichtet → null", async () => {
  const v = neuerTestVault();
  process.env.BRAIN_LAUNCHCTL = fakeLaunchctl();
  try {
    assert.equal(D.dienstStatus(v, { home: HOME }).profil, null, "nicht eingerichtet");
    await mitProfil(PROFIL, () => DIENST_AN(v));
    assert.equal(D.dienstStatus(v, { home: HOME }).profil, PROFIL, "XML-Escaping wird rückgängig gemacht");
    await mitProfil(undefined, () => DIENST_AN(v));
    const s = D.dienstStatus(v, { home: HOME });
    assert.equal(s.eingerichtet, true);
    assert.equal(s.profil, null);
  } finally { D.dienstAus(v, { home: HOME }); delete process.env.BRAIN_LAUNCHCTL; }
});

test("brain dienst status (CLI): nennt das verwendete Profil als Pfad bzw. „Standardprofil“, warnt bei abweichender Sitzung", async () => {
  const v = neuerTestVault();
  const launchctl = fakeLaunchctl();
  const status = (profilDerSitzung) => {
    const env = { ...process.env, HOME, USERPROFILE: HOME, BRAIN_LAUNCHCTL: launchctl };
    delete env.CLAUDE_CONFIG_DIR;
    if (profilDerSitzung) env.CLAUDE_CONFIG_DIR = profilDerSitzung;
    const r = spawnSync(process.execPath, [DIENST_CLI, v, "status"], { encoding: "utf8", env });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  process.env.BRAIN_LAUNCHCTL = launchctl;
  try {
    assert.ok(!/Profil/.test(status()), "nicht eingerichtet → keine Profil-Zeile");
    await mitProfil(PROFIL, () => DIENST_AN(v));
    const mit = status(PROFIL);
    assert.ok(mit.includes(`Profil: ${PROFIL}`), mit);
    assert.ok(!/anderes Profil/.test(status()), "Dienst mit Profil, Sitzung ohne Variable → keine Warnung (nur Rauschen)");
    assert.ok(!/Standardprofil/.test(mit) && !/anderes Profil/.test(mit), "Sitzung und Dienst gleich → keine Warnung");
    const abweichend = status("/ganz/anderes/profil");
    assert.ok(abweichend.includes(`Profil: ${PROFIL}`) && /anderes Profil/.test(abweichend) && abweichend.includes("/ganz/anderes/profil"), abweichend);
    await mitProfil(undefined, () => DIENST_AN(v));
    assert.ok(/Profil: Standardprofil/.test(status()), "ohne Variable beim Einrichten");
    assert.ok(/anderes Profil/.test(status(PROFIL)), "Sitzung hat ein Profil, Dienst nicht → Hinweis");
  } finally { D.dienstAus(v, { home: HOME }); delete process.env.BRAIN_LAUNCHCTL; }
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
