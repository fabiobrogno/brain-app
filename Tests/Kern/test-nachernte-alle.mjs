// .tools/tests/test-nachernte-alle.mjs — Sammelbefehl der Nach-Ernte (nachernte.mjs / „brain nachernte“): alle Transkripte aus
// <vault>/.logs/transkript-sicherung/*.jsonl nacheinander, Budget an KI-Aufrufen, Marken, cwd aus dem Transkript.
// Nur erfundene Sitzungen in Temp-Vaults, fake-claude, leerer PATH — nie echte Transkripte, nie ein echtes claude.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, utimesSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HIER = dirname(fileURLToPath(import.meta.url));
const LEER_PATH = mkdtempSync(join(tmpdir(), "nachernte-alle-path-"));
const { isoliere, fakeKi, FAKE, FAKE_BEFEHL } = await import("./tageslauf-hilfe.mjs");
const TEMP_HOME = isoliere();
Object.assign(process.env, { PATH: LEER_PATH });   // nach isoliere(): auch kein echtes claude im PATH
const { tempVault, schreibeVerlauf } = await import("./verlauf-fixture.mjs");
const N = await import("../nachernte.mjs");
const E = await import("../ernte.mjs");

const JETZT = Date.UTC(2026, 9, 21, 9, 0, 0);
const TR = (v) => join(v, ".logs", "transkript-sicherung");
const marke = (v, sid) => join(v, ".logs", "ernte", "nachernte", sid);
const lies = (f) => JSON.parse(readFileSync(f, "utf8"));
const vorschlaege = (v) => { const d = join(v, "00_inbox", "_vorschlaege"); try { return readdirSync(d).map((n) => readFileSync(join(d, n), "utf8")); } catch { return []; } };

// Erfundene Sitzung: 6 Nutzer-Prompts (der dritte trägt den Fakt), cwd in jeder Zeile — alterSek Sekunden vor „jetzt“ zuletzt geändert.
function sitzung(v, sid, { cwd = "/projekte/alpha", prompts = 6, alterSek = 0, cwdSpaeter = null } = {}) {
  const zeilen = [];
  for (let i = 1; i <= prompts; i++) {
    const text = i === 3 ? `Bitte merke dir: ${sid} steht in Beet 3.` : `Frage ${i} zu ${sid}`;
    const c = cwd === null ? {} : { cwd: cwdSpaeter && i >= 5 ? cwdSpaeter : cwd };
    zeilen.push({ type: "user", uuid: `u-${sid}-${i}`, timestamp: `2026-10-20T08:0${i}:00.000Z`, sessionId: sid, ...c, message: { role: "user", content: text } });
    zeilen.push({ type: "assistant", uuid: `a-${sid}-${i}`, timestamp: `2026-10-20T08:0${i}:30.000Z`, sessionId: sid, ...c, message: { role: "assistant", content: [{ type: "text", text: `Antwort ${i}` }] } });
  }
  const pfad = join(TR(v), `${sid}.jsonl`);
  schreibeVerlauf(pfad, zeilen);
  const t = new Date(JETZT - alterSek * 1000);
  utimesSync(pfad, t, t);
  return pfad;
}
const regeln = (...sids) => sids.map((sid) => ({ wenn: `Bitte merke dir: ${sid} steht`, antwort: `### Fakt ${sid}\n${sid} steht in Beet 3.\nZitat: Bitte merke dir: ${sid} steht in Beet 3.\n` }));
const lauf = (v, opt = {}) => N.nachernteAlle(v, { claudeBefehl: FAKE_BEFEHL, jetzt: JETZT, warteMs: 0, ...opt });

test("Budget: höchstens N KI-Aufrufe je Lauf, die neueste Sitzung zuerst; Marken überspringen Erledigtes — drei Läufe", async () => {
  const v = tempVault();
  sitzung(v, "alpha", { alterSek: 300 }); sitzung(v, "beta", { alterSek: 200 }); sitzung(v, "gamma", { alterSek: 100 });
  const ki = fakeKi(regeln("alpha", "beta", "gamma"));
  const r1 = await lauf(v, { budget: 2 });
  assert.deepEqual([r1.gesamt, r1.erledigt, r1.geerntet, r1.vorschlaege, r1.aufrufe, r1.offen, r1.abbruch], [3, 0, 2, 2, 2, 1, "budget"]);
  assert.match(ki.aufrufe()[0].eingabe, /gamma steht in Beet 3/);
  assert.match(ki.aufrufe()[1].eingabe, /beta steht in Beet 3/);
  assert.ok(existsSync(marke(v, "gamma")) && existsSync(marke(v, "beta")) && !existsSync(marke(v, "alpha")));
  assert.equal(vorschlaege(v).length, 2);
  assert.match(vorschlaege(v).join("\n"), /\nnachernte: true\n/);

  const r2 = await lauf(v);
  assert.deepEqual([r2.erledigt, r2.geerntet, r2.aufrufe, r2.offen, r2.abbruch], [2, 1, 1, 0, null]);
  assert.equal(ki.anzahl(), 3);
  const r3 = await lauf(v);
  assert.deepEqual([r3.erledigt, r3.geerntet, r3.aufrufe, r3.offen, r3.abbruch], [3, 0, 0, 0, null]);
  assert.equal(ki.anzahl(), 3, "nichts doppelt geerntet");
  assert.equal(vorschlaege(v).length, 3);
});

test("Standard-Budget 250 (und 8 Fenster je Sitzung); ungültiges Budget wirft; nurZaehlen fasst nichts an", async () => {
  assert.equal(N.STANDARD_AUFRUFE, 250);
  assert.equal(N.STANDARD_FENSTER, 8);
  const v = tempVault();
  sitzung(v, "alpha"); sitzung(v, "beta");
  const ki = fakeKi(regeln("alpha", "beta"));
  E.schreibeNachernteMarke(v, "alpha", { status: "ok", vorschlaege: 1, zeit: "2026-10-21T08:00:00Z" });
  const z = await lauf(v, { nurZaehlen: true });
  assert.deepEqual([z.gesamt, z.erledigt, z.offen, z.aufrufe], [2, 1, 1, 0]);
  assert.equal(ki.anzahl(), 0);
  assert.ok(!existsSync(marke(v, "beta")));
  for (const kaputt of [0, -1, 1.5, "x", 10001]) await assert.rejects(() => lauf(v, { budget: kaputt }), /Budget/);
  const r = await lauf(v);
  assert.equal(r.aufrufe, 1, "Standard 250 reicht für beide");
  for (const kaputt of [0, -1, 1.5, "x", 101]) await assert.rejects(() => lauf(v, { maxFenster: kaputt }), /Fenster/);
});

test("Ordner kommt aus dem Transkript (erste cwd); ausgeschlossene oder wechselnde Ordner → kein Aufruf, Marke; ohne cwd → übersprungen, bleibt offen", async () => {
  const v = tempVault();
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ automatik: { ernteNichtIn: ["/projekte/privat"] } }));
  sitzung(v, "alpha", { cwd: "/projekte/alpha", alterSek: 10 });
  sitzung(v, "privat", { cwd: "/projekte/privat/geheim", alterSek: 20 });
  sitzung(v, "wechsel", { cwd: "/projekte/alpha", cwdSpaeter: "/projekte/privat", alterSek: 30 });
  sitzung(v, "ohnecwd", { cwd: null, alterSek: 40 });
  const ki = fakeKi(regeln("alpha", "privat", "wechsel", "ohnecwd"));
  const r = await lauf(v);
  assert.deepEqual([r.gesamt, r.geerntet, r.uebersprungen, r.aufrufe, r.offen, r.abbruch], [4, 1, 3, 1, 1, null]);
  assert.equal(ki.anzahl(), 1);
  assert.match(vorschlaege(v)[0], /\nquelle_ordner: "\/projekte\/alpha"\n/);
  assert.deepEqual(lies(marke(v, "privat")), { status: "uebersprungen", grund: "ausgeschlossener Ordner", zeit: "2026-10-21T09:00:00Z" });
  assert.equal(lies(marke(v, "wechsel")).status, "uebersprungen");
  assert.ok(!existsSync(marke(v, "ohnecwd")), "ohne Ordner keine Marke — vielleicht fehlt er nur in dieser Sicherung");
});

test("zu kurze Sitzung verbraucht kein Budget (kein Aufruf), bekommt aber eine Marke „uebersprungen“", async () => {
  const v = tempVault();
  sitzung(v, "kurz", { prompts: 2, alterSek: 10 });
  sitzung(v, "lang", { alterSek: 20 });
  const ki = fakeKi(regeln("kurz", "lang"));
  const r = await lauf(v, { budget: 1 });
  assert.deepEqual([r.geerntet, r.uebersprungen, r.aufrufe, r.offen, r.abbruch], [1, 1, 1, 0, null]);
  assert.equal(ki.anzahl(), 1);
  assert.deepEqual(lies(marke(v, "kurz")), { status: "uebersprungen", grund: "zu kurze Sitzung", zeit: "2026-10-21T09:00:00Z" });
  assert.equal(lies(marke(v, "lang")).status, "ok");
});

test("claude-Fehler: nach drei Fehlern in Folge Schluss, keine Marken — der nächste Lauf versucht es wieder; claude fehlt → sofort Abbruch", async () => {
  const v = tempVault();
  for (const [i, sid] of ["a1", "a2", "a3", "a4"].entries()) sitzung(v, sid, { alterSek: i * 10 });
  const ki = fakeKi(regeln("a1", "a2", "a3", "a4"), { exit: 1 });
  const r = await lauf(v);
  assert.deepEqual([r.fehler, r.aufrufe, r.geerntet, r.offen, r.abbruch], [3, 3, 0, 4, "claude-fehler"]);
  assert.equal(ki.anzahl(), 3);
  assert.ok(!existsSync(join(v, ".logs", "ernte", "nachernte")) || readdirSync(join(v, ".logs", "ernte", "nachernte")).length === 0);
  const ki2 = fakeKi(regeln("a1", "a2", "a3", "a4"));
  const r2 = await lauf(v);
  assert.deepEqual([r2.geerntet, r2.fehler, r2.offen, r2.abbruch], [4, 0, 0, null]);
  assert.equal(ki2.anzahl(), 4);

  const w = tempVault();
  sitzung(w, "b1");
  const keins = fakeKi(regeln("b1"));
  const r3 = await lauf(w, { claudeBefehl: null });
  assert.deepEqual([r3.abbruch, r3.aufrufe, r3.offen], ["claude-fehlt", 0, 1]);
  assert.equal(keins.anzahl(), 0);
});

test("läuft schon (Ernte-Sperre): Wiederholungen mit Wartezeit, dann Abbruch ohne Marke", async () => {
  const v = tempVault();
  sitzung(v, "alpha");
  const ki = fakeKi(regeln("alpha"));
  mkdirSync(join(v, ".logs", "ernte"), { recursive: true });
  const sperre = join(v, ".logs", "ernte", "lauf.lock");
  writeFileSync(sperre, `${process.pid}\n`);
  const r = await lauf(v, { versuche: 3 });
  assert.deepEqual([r.abbruch, r.aufrufe, r.offen], ["läuft schon", 0, 1]);
  assert.equal(ki.anzahl(), 0);
  assert.ok(!existsSync(marke(v, "alpha")));
  const gewartet = [];
  const frei = await lauf(v, { versuche: 3, warte: async () => { gewartet.push(1); unlinkSync(sperre); } });
  assert.deepEqual([frei.geerntet, frei.abbruch, gewartet.length], [1, null, 1], "Sperre weg → die Sitzung wird beim Wiederholen geerntet");
});

test("nur gültige Transkripte: *.jsonl mit Sitzungs-Namen; andere Dateien, Ordner und fremde Zeichen zählen nicht", async () => {
  const v = tempVault();
  sitzung(v, "alpha");
  mkdirSync(TR(v), { recursive: true });
  writeFileSync(join(TR(v), "notiz.txt"), "kein Transkript");
  writeFileSync(join(TR(v), "mit leerzeichen.jsonl"), "{}\n");
  mkdirSync(join(TR(v), "ordner.jsonl"));
  const z = await lauf(v, { nurZaehlen: true });
  assert.deepEqual([z.gesamt, z.offen], [1, 1]);
  const leer = await lauf(tempVault(), { nurZaehlen: true });
  assert.deepEqual([leer.gesamt, leer.offen], [0, 0], "kein Sicherungsordner → nichts zu tun");
});

// Lange Sitzung (45 Prompts à ~1 500 Zeichen → mehrere Fenster), Fakten in den Prompts 3, 22 und 44 (Namen „<sid>3“ …).
function langeSitzung(v, sid, { nrs = [3, 22, 44], prompts = 45, alterSek = 0 } = {}) {
  const zeilen = [];
  for (let i = 1; i <= prompts; i++) {
    const text = nrs.includes(i) ? `Bitte merke dir: ${sid}${i} steht in Beet 3. ${"Beet ".repeat(280)}` : `Frage ${i} zu ${sid} ${"Beet ".repeat(300)}`;
    const zeit = `2026-10-20T08:${String(i).padStart(2, "0")}:00.000Z`;
    zeilen.push({ type: "user", uuid: `u-${sid}-${i}`, timestamp: zeit, sessionId: sid, cwd: "/projekte/alpha", message: { role: "user", content: text } });
    zeilen.push({ type: "assistant", uuid: `a-${sid}-${i}`, timestamp: zeit, sessionId: sid, cwd: "/projekte/alpha", message: { role: "assistant", content: [{ type: "text", text: `Antwort ${i}` }] } });
  }
  const pfad = join(TR(v), `${sid}.jsonl`);
  schreibeVerlauf(pfad, zeilen);
  const t = new Date(JETZT - alterSek * 1000);
  utimesSync(pfad, t, t);
  return pfad;
}

test("Fenster: das Budget zählt Aufrufe je Fenster; eine angefangene Sitzung bleibt offen und wird fortgesetzt — nichts doppelt", async () => {
  const v = tempVault();
  const pfad = langeSitzung(v, "lang");
  const n = E.leseFenster(pfad, { sperr: [v] }).fenster.length;
  assert.ok(n >= 3);
  const ki = fakeKi(regeln("lang3", "lang22", "lang44"));
  const r1 = await lauf(v, { budget: 2 });
  assert.deepEqual([r1.aufrufe, r1.geerntet, r1.vorschlaege, r1.offen, r1.abbruch], [2, 0, 2, 1, "budget"]);
  assert.equal(lies(marke(v, "lang")).status, "laeuft");
  const z = await lauf(v, { nurZaehlen: true });
  assert.deepEqual([z.gesamt, z.erledigt, z.offen], [1, 0, 1], "angefangen zählt nicht als erledigt");
  const r2 = await lauf(v);
  assert.deepEqual([r2.aufrufe, r2.geerntet, r2.vorschlaege, r2.offen, r2.abbruch], [n - 2, 1, 1, 0, null]);
  assert.equal(ki.anzahl(), n);
  assert.equal(vorschlaege(v).length, 3);
  assert.equal(lies(marke(v, "lang")).status, "ok");
  const r3 = await lauf(v);
  assert.deepEqual([r3.erledigt, r3.aufrufe], [1, 0]);
});

test("Fenster: maxFenster begrenzt die Aufrufe je Sitzung (gleichmäßig verteilt), das Budget gilt über alle Sitzungen", async () => {
  const v = tempVault();
  langeSitzung(v, "lang", { alterSek: 10 });
  sitzung(v, "klein", { alterSek: 20 });
  const ki = fakeKi(regeln("lang3", "lang22", "lang44", "klein"));
  const r = await lauf(v, { maxFenster: 2 });
  assert.deepEqual([r.geerntet, r.aufrufe, r.vorschlaege, r.abbruch], [2, 3, 3, null], "2 Fenster der langen + 1 der kleinen Sitzung");
  assert.equal(ki.anzahl(), 3);
  assert.match(ki.aufrufe()[0].eingabe, /Frage 1 /);
  assert.match(ki.aufrufe()[1].eingabe, /Frage 45 /);
  assert.equal(vorschlaege(v).length, 3, "früher und später Fakt der langen Sitzung plus der kleine");
});

test("CLI: node nachernte.mjs <vault> --budget-aufrufe N, --zaehlen, falscher Aufruf → 64; brain nachernte geht an dasselbe Werkzeug", () => {
  const v = tempVault();
  sitzung(v, "alpha", { alterSek: 30 }); sitzung(v, "beta", { alterSek: 20 }); sitzung(v, "gamma", { alterSek: 10 });
  fakeKi(regeln("alpha", "beta", "gamma"));
  const env = { ...process.env, BRAIN_CLAUDE: FAKE, PATH: LEER_PATH, HOME: TEMP_HOME, USERPROFILE: TEMP_HOME };
  delete env.BRAIN_ERNTE;
  const cli = (...a) => spawnSync(process.execPath, [join(HIER, "..", "nachernte.mjs"), ...a], { env, encoding: "utf8", windowsHide: true });
  const z = cli(v, "--zaehlen");
  assert.equal(z.status, 0, z.stderr);
  assert.equal(z.stdout, "Nach-Ernte: 3 Sitzungen, 0 erledigt, 3 offen.\n");
  const r = cli(v, "--budget-aufrufe", "2");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Nach-Ernte: geerntet 2 Sitzungen \(2 Vorschläge\) · übersprungen 0 · Fehler 0 · KI-Aufrufe 2 von 2 · noch offen 1 — Budget aufgebraucht\.\n$/);
  for (const kaputt of [["--budget-aufrufe", "0"], ["--budget-aufrufe", "viele"], ["--unbekannt"], ["--budget-aufrufe"], ["--max-fenster", "0"], ["--max-fenster", "x"], ["--max-fenster"]]) {
    const k = cli(v, ...kaputt);
    assert.equal(k.status, 64, kaputt.join(" "));
    assert.match(k.stderr, /Nutzung: brain nachernte/);
  }
  const mf = cli(v, "--max-fenster", "3", "--budget-aufrufe", "5");
  assert.equal(mf.status, 0, mf.stderr);
  assert.match(mf.stdout, /KI-Aufrufe 1 von 5/);
  const b = spawnSync(process.execPath, [join(HIER, "..", "brain.mjs"), "nachernte", "--zaehlen"], { env: { ...env, BRAIN_VAULT: v }, encoding: "utf8", windowsHide: true });
  assert.equal(b.status, 0, b.stderr);
  assert.equal(b.stdout, "Nach-Ernte: 3 Sitzungen, 3 erledigt, 0 offen.\n");
});
