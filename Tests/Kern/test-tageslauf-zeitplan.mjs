// .tools/tests/test-tageslauf-zeitplan.mjs — fällig, Strom/Leerlauf, Sperre, Rückfall-Start, Dienst (B2, Task 3).
// Nie echtes launchctl: Ersatzprogramm über BRAIN_LAUNCHCTL; ohne Ersatz verweigert dienst.mjs unter node --test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { userInfo } from "node:os";
import { isoliere, neuerTestVault, JETZT } from "./tageslauf-hilfe.mjs";
import { tempOrdner } from "./verlauf-fixture.mjs";
const Z = await import("../tageslauf/zeitplan.mjs");
const D = await import("../tageslauf/dienst.mjs");
const P = await import("../tageslauf/protokoll.mjs");
const HOME = isoliere();
const H = 3600e3;
async function warteAuf(datei, ms = 5000) {
  const t0 = Date.now();
  while (!existsSync(datei)) { if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 50)); }
  return true;
}
function fakeLaunchctl() {
  const d = tempOrdner("launchctl");
  const log = join(d, "aufrufe.txt"), skript = join(d, "launchctl.mjs");
  writeFileSync(skript, `import { appendFileSync } from "node:fs"; appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(" ") + "\\n");\n`);
  process.env.BRAIN_LAUNCHCTL = skript;
  return () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []);
}

test("faellig: ohne letzter.json ja; letzter Erfolg vor 19 h nein, vor 21 h ja", () => {
  const v = neuerTestVault();
  assert.equal(Z.faellig(v, { jetzt: JETZT }), true);
  P.schreibeLetzter(v, { letzterErfolg: new Date(JETZT - 19 * H).toISOString() });
  assert.equal(Z.faellig(v, { jetzt: JETZT }), false);
  assert.equal(Z.faellig(v, { jetzt: JETZT + 2 * H }), true);
});

test("pmset/ioreg/bedingungen: Akku, Netz, Desktop ohne Akku, benutzt, unlesbar", () => {
  const akku = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t80%; discharging";
  const netz = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t100%; charged";
  assert.equal(Z.parsePmset(akku).amNetz, false);
  assert.equal(Z.parsePmset(netz).amNetz, true);
  assert.equal(Z.parsePmset("Now drawing from 'UPS Power'\n").amNetz, true, "ohne Akku zählt als am Netz");
  assert.equal(Z.parseIoreg('    |   "HIDIdleTime" = 700000000000\n'), 700);
  assert.equal(Z.parseIoreg("nichts"), null);
  const ruhig = () => '"HIDIdleTime" = 900000000000';
  assert.deepEqual(Z.bedingungen({ pmset: () => akku, ioreg: ruhig }), { ok: false, grund: "läuft auf Akku" });
  assert.deepEqual(Z.bedingungen({ pmset: () => netz, ioreg: () => '"HIDIdleTime" = 5000000000' }), { ok: false, grund: "Mac wird benutzt" });
  assert.deepEqual(Z.bedingungen({ pmset: () => netz, ioreg: ruhig }), { ok: true });
  assert.equal(Z.bedingungen({ pmset: () => { throw new Error("x"); }, ioreg: ruhig }).ok, false);
});

test("Sperre: belegt bei lebender PID; frei bei toter PID oder > 2 h; freigeben nur die eigene", () => {
  const v = neuerTestVault();
  assert.equal(Z.nimmSperre(v, { jetzt: JETZT }), true);
  assert.equal(Z.nimmSperre(v, { jetzt: JETZT }), false);
  const f = join(P.TL_DIR(v), "lauf.lock");
  writeFileSync(f, JSON.stringify({ pid: 999999, start: new Date(JETZT).toISOString() }));
  assert.equal(Z.nimmSperre(v, { jetzt: JETZT, pidLebt: () => false }), true);
  writeFileSync(f, JSON.stringify({ pid: 4242, start: new Date(JETZT - 3 * H).toISOString() }));
  assert.equal(Z.nimmSperre(v, { jetzt: JETZT, pidLebt: () => true }), true);
  writeFileSync(f, JSON.stringify({ pid: 4242, start: new Date(JETZT).toISOString() }));
  Z.gibSperreFrei(v);
  assert.ok(existsSync(f), "fremde Sperre bleibt");
  writeFileSync(f, JSON.stringify({ pid: process.pid, start: new Date(JETZT).toISOString() }));
  Z.gibSperreFrei(v);
  assert.ok(!existsSync(f));
});

test("starteWennFaellig: ohne Dienst nur wenn fällig; mit Dienst nur nach > 36 h ohne Start; Schalter aus → nie", async () => {
  const v = neuerTestVault();
  const marke = join(tempOrdner("marke"), "gestartet");
  const skript = join(tempOrdner("skript"), "s.mjs");
  writeFileSync(skript, `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marke)}, process.argv.slice(2).join(" "));\n`);
  process.env.BRAIN_TAGESLAUF_SKRIPT = skript;
  try {
    P.schreibeLetzter(v, { letzterErfolg: new Date(JETZT - 2 * H).toISOString() });
    assert.equal(Z.starteWennFaellig(v, { jetzt: JETZT, dienstDa: () => false }), false);
    P.schreibeLetzter(v, { letzterErfolg: new Date(JETZT - 30 * H).toISOString() });
    assert.equal(Z.starteWennFaellig(v, { jetzt: JETZT, dienstDa: () => false }), true);
    assert.ok(await warteAuf(marke));
    assert.match(readFileSync(marke, "utf8"), /--wenn-faellig/);
    assert.equal(Z.starteWennFaellig(v, { jetzt: JETZT + 600e3, dienstDa: () => false }), false, "eben gestartet → nicht gleich nochmal");
    Z.markeStart(v, JETZT - 10 * H);
    assert.equal(Z.starteWennFaellig(v, { jetzt: JETZT, dienstDa: () => true }), false);
    Z.markeStart(v, JETZT - 40 * H);
    assert.equal(Z.starteWennFaellig(v, { jetzt: JETZT, dienstDa: () => true }), true);
    const aus = neuerTestVault({ automatik: { tageslauf: "aus" } });
    assert.equal(Z.starteWennFaellig(aus, { jetzt: JETZT, dienstDa: () => false }), false);
  } finally { delete process.env.BRAIN_TAGESLAUF_SKRIPT; }
});

test("plistInhalt: /bin/sh + node-start.sh (kein fester Node-Pfad), brain.mjs, --wenn-faellig --dienst, stündlich, PATH, XML-escaped", () => {
  const p = D.plistInhalt({ starter: "/V & W/.tools/node-start.sh", brain: "/V & W/.tools/brain.mjs", vault: "/V & W", pfad: "/opt/homebrew/bin:/usr/bin", log: "/V & W/.logs/tageslauf/dienst.log" });
  for (const s of ["<string>de.brain.tageslauf</string>", "<string>/bin/sh</string>", "<string>/V &amp; W/.tools/node-start.sh</string>",
    "<string>/V &amp; W/.tools/brain.mjs</string>", "<string>tageslauf</string>", "<string>--wenn-faellig</string>", "<string>--dienst</string>",
    "<key>StartInterval</key><integer>3600</integer>", "<string>/opt/homebrew/bin:/usr/bin</string>"]) assert.ok(p.includes(s), s);
  assert.ok(!p.includes("/V & W"));
  assert.ok(!p.includes("<string>/opt/homebrew/bin/node</string>"));
});

test("dienst an/status/aus: plist unter ~/Library/LaunchAgents, launchctl bootstrap/print/bootout (Ersatzprogramm)", () => {
  const v = neuerTestVault();
  const aufrufe = fakeLaunchctl();
  try {
    const an = D.dienstAn(v, { home: HOME, plattform: "darwin", node: process.execPath, claude: { befehl: "/opt/claude/bin/claude", args: [] } });
    assert.equal(an.ok, true);
    const plist = readFileSync(D.plistPfad({ home: HOME }), "utf8");
    assert.ok(plist.includes(`<string>${join(v, ".tools", "node-start.sh").replace(/&/g, "&amp;")}</string>`));
    assert.ok(!plist.includes(`<string>${process.execPath}</string>`), "kein fester Node-Pfad als Programm");
    assert.ok(plist.includes("/opt/claude/bin"), "PATH enthält den Ordner von claude");
    assert.equal(D.dienstStatus(v, { home: HOME }).geladen, true);
    D.dienstAus(v, { home: HOME });
    assert.equal(D.dienstEingerichtet({ home: HOME }), false);
    assert.deepEqual(aufrufe().map((z) => z.split(" ")[0]), ["bootstrap", "print", "bootout"]);
    assert.ok(aufrufe()[0].startsWith(`bootstrap gui/${userInfo().uid} `));
  } finally { delete process.env.BRAIN_LAUNCHCTL; }
});

test("dienst: nicht macOS → ok false; ohne Ersatzprogramm unter node --test wird echtes launchctl verweigert", () => {
  const v = neuerTestVault();
  assert.equal(D.dienstAn(v, { home: HOME, plattform: "linux" }).ok, false);
  assert.ok(process.env.NODE_TEST_CONTEXT, "läuft unter node --test");
  assert.throws(() => D.dienstAn(v, { home: HOME, plattform: "darwin", node: process.execPath, claude: null }), /launchctl/);
});
