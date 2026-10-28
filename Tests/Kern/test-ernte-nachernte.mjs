// .tools/tests/test-ernte-nachernte.mjs — Nach-Ernte EINER Sitzung (Nachbesserung nach dem Probelauf): erntet ohne die Byte-Marke
// (.logs/ernte/<sid>.fakt) von vorn, mit allen B1-Prüfungen, schreibt Vorschläge mit nachernte: true und merkt sich den Erfolg in
// .logs/ernte/nachernte/<sid>. Nur fake-claude, erfundene Garten-Sitzung, Temp-HOME, leerer PATH — nie ein echtes claude.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HIER = dirname(fileURLToPath(import.meta.url));
const FAKE = join(HIER, "fake-claude.mjs");
const ERNTE_CLI = join(HIER, "..", "ernte.mjs");
const LEER_PATH = mkdtempSync(join(tmpdir(), "nachernte-path-"));
const TEMP_HOME = mkdtempSync(join(tmpdir(), "nachernte-home-"));
Object.assign(process.env, { PATH: LEER_PATH, HOME: TEMP_HOME, USERPROFILE: TEMP_HOME });
delete process.env.BRAIN_CLAUDE;
delete process.env.BRAIN_ERNTE;
for (const k of Object.keys(process.env)) if (k.startsWith("GIT_")) delete process.env[k];

const E = await import("../ernte.mjs");
const { tempVault, tempOrdner, schreibeVerlauf, nutzer, assistent } = await import("./verlauf-fixture.mjs");
const { gartenEintraege, GARTEN_SITZUNG, GARTEN_CWD } = await import("./fixture-garten.mjs");
const { fakeKi } = await import("./tageslauf-hilfe.mjs");

const FAKE_BEFEHL = { befehl: process.execPath, args: [FAKE] };
const KOEDER_PW = ["pass", "word"].join("") + "=Koeder123";
const JETZT = Date.UTC(2026, 9, 21, 9, 0, 0);

function fakeAusgabe(ausgabe, { exit = 0 } = {}) {
  const d = mkdtempSync(join(tmpdir(), "nachernte-fake-"));
  writeFileSync(join(d, "ausgabe.txt"), ausgabe);
  Object.assign(process.env, { FAKE_CLAUDE_LOG: join(d, "eingabe.txt"), FAKE_CLAUDE_AUSGABE: join(d, "ausgabe.txt"), FAKE_CLAUDE_WARTE: "0",
    FAKE_CLAUDE_EXIT: String(exit), FAKE_CLAUDE_ROH: "", FAKE_CLAUDE_OHNE_USAGE: "", FAKE_CLAUDE_REGELN: "", FAKE_CLAUDE_ZAEHLER: "" });
  return join(d, "eingabe.txt");
}
function verlauf(v, extra = []) {
  const f = join(tempOrdner("Verlauf Brän"), "sitzung nach.jsonl");
  schreibeVerlauf(f, [...gartenEintraege({ vault: v }), ...extra]);
  return f;
}
const nach = (v, tr, extra = {}) => E.ernte(v, { nachernte: true, transkript: tr, sid: GARTEN_SITZUNG, cwd: GARTEN_CWD, claudeBefehl: FAKE_BEFEHL, jetzt: JETZT, ...extra });
const live = (v, tr) => E.ernte(v, { art: "fakt", transkript: tr, sid: GARTEN_SITZUNG, cwd: GARTEN_CWD, claudeBefehl: FAKE_BEFEHL, jetzt: JETZT });
const inboxDatei = (v, id) => readFileSync(join(v, "00_inbox", "_vorschlaege", `${id}.md`), "utf8");
const logZeile = (v) => readFileSync(join(v, ".logs", "ernte.log"), "utf8").trim().split("\n").pop();
const fakt = (v) => join(v, ".logs", "ernte", `${GARTEN_SITZUNG}.fakt`);
const marke = (v, sid = GARTEN_SITZUNG) => join(v, ".logs", "ernte", "nachernte", sid);
const lies = (f) => JSON.parse(readFileSync(f, "utf8"));
const MOEHREN = ["### Möhren", "Möhren werden ab Mitte April gesät.", "Zitat: Werkzeug (Bash): Möhren säen ab Mitte April in Reihe 3.", ""].join("\n");

test("nachernte: erntet von vorn, obwohl die Byte-Marke „nichts Neues“ sagt — .fakt wird weder gelesen noch angefasst; Vorschlag trägt nachernte: true", async () => {
  const v = tempVault();
  const tr = verlauf(v);
  mkdirSync(join(v, ".logs", "ernte"), { recursive: true });
  writeFileSync(fakt(v), JSON.stringify({ bis: statSync(tr).size }) + "\n");
  const vorher = readFileSync(fakt(v), "utf8");
  fakeAusgabe(MOEHREN);
  const l = await live(v, tr);
  assert.deepEqual([l.status, l.grund], ["uebersprungen", "nichts Neues"], "Gegenprobe: die laufende Ernte ist mit dieser Sitzung fertig");
  const r = await nach(v, tr);
  assert.equal(r.status, "ok");
  assert.equal(r.aufrufe, 1);
  assert.equal(r.vorschlaege.length, 1);
  const text = inboxDatei(v, r.vorschlaege[0]);
  assert.match(text, /\nart: fakt\n/);
  assert.match(text, /\nzitat: "Möhren säen ab Mitte April in Reihe 3\."\nherkunft: tool\nfundstelle: "sitzung-beleg#u06 2026-10-21T08:06:00\.000Z"\nnachernte: true\nerstellt: /);
  assert.equal(readFileSync(fakt(v), "utf8"), vorher, ".fakt bleibt, wie es war");
  assert.match(logZeile(v), / art=fakt status=ok .* vorschlaege=1 verworfen=0 ohneBeleg=0 nurKi=0 ungedeckt=0 dubletten=0 nachernte=1 fenster=1\/1$/);
  const m = lies(marke(v));
  assert.deepEqual([m.status, m.vorschlaege, m.fenster, m.zeit], ["ok", 1, 1, "2026-10-21T09:00:00Z"]);
});

test("nachernte: ohne vorhandene Byte-Marke wird auch keine angelegt; „art“ ist immer fakt (ein Stand wird nie nachgeerntet)", async () => {
  const v = tempVault();
  const log = fakeAusgabe(MOEHREN);
  const r = await nach(v, verlauf(v), { art: "stand" });
  assert.equal(r.status, "ok");
  assert.ok(!existsSync(fakt(v)));
  const { args } = JSON.parse(readFileSync(log + ".json", "utf8"));
  assert.equal(args[args.indexOf("--system-prompt") + 1], E.auftrag("fakt"));
  assert.match(inboxDatei(v, r.vorschlaege[0]), /\nart: fakt\n/);
});

test("nachernte: alle B1-Prüfungen — Zugangsdaten im Zitat, nur KI/Wiki, ohne oder abgewandeltes Zitat, ungedeckte Zahl; die laufende Ernte zählt dasselbe", async () => {
  const v = tempVault();
  const ausgabe = [
    MOEHREN,
    "### Zugang", "Siehe Zitat.", `Zitat: Bitte notieren ${KOEDER_PW}`, "",
    "### Schneckenkragen", "Das Hochbeet Süd hat Schneckenkragen.", "Zitat: Das Hochbeet Süd bekommt Schneckenkragen.", "",
    "### Regentonne", "Die Regentonne fasst 500 Liter.", "Zitat: Die Regentonne fasst 300 Liter.", "",
    "### Rasenmäher", "Der Rasenmäher steht im Schuppen.", "",
  ].join("\n");
  fakeAusgabe(ausgabe);
  const r = await nach(v, verlauf(v));
  assert.equal(r.vorschlaege.length, 1);
  const nachLog = logZeile(v).replace(/^\S+ /, "").replace(/ ein=\d+ aus=\d+ tokEin=\d+ tokAus=\d+/, "");
  assert.equal(nachLog, "art=fakt status=ok vorschlaege=1 verworfen=1 ohneBeleg=2 nurKi=1 ungedeckt=1 dubletten=0 nachernte=1 fenster=1/1");
  const v2 = tempVault();
  fakeAusgabe(ausgabe);
  const l = await live(v2, verlauf(v2));
  assert.equal(l.vorschlaege.length, 1);
  assert.match(logZeile(v2), / vorschlaege=1 verworfen=1 ohneBeleg=2 nurKi=1 ungedeckt=1$/);
});

test("nachernte: Marke nur bei Erfolg und bei dauerhaftem Überspringen — Fehler, „läuft schon“, unbekannte Sitzung hinterlassen keine", async () => {
  const v = tempVault();
  const tr = verlauf(v);
  fakeAusgabe("NICHTS\n", { exit: 1 });
  const f = await nach(v, tr);
  assert.deepEqual([f.status, f.aufrufe], ["fehler", 1]);
  assert.ok(!existsSync(marke(v)), "claude-Fehler: nächster Versuch möglich");

  fakeAusgabe(MOEHREN);
  mkdirSync(join(v, ".logs", "ernte"), { recursive: true });
  writeFileSync(join(v, ".logs", "ernte", "lauf.lock"), `${process.pid}\n`);
  const s = await nach(v, tr);
  assert.deepEqual([s.status, s.grund, s.aufrufe], ["uebersprungen", "läuft schon", 0]);
  assert.ok(!existsSync(marke(v)));
  unlinkSync(join(v, ".logs", "ernte", "lauf.lock"));

  const u = await nach(v, tr, { sid: "" });
  assert.deepEqual([u.status, u.grund], ["uebersprungen", "Sitzung unbekannt"]);
  assert.ok(!existsSync(join(v, ".logs", "ernte", "nachernte")) || readdirSync(join(v, ".logs", "ernte", "nachernte")).length === 0);

  const ok = await nach(v, tr);
  assert.equal(ok.status, "ok");
  assert.equal(lies(marke(v)).status, "ok");
  assert.equal(E.leseNachernteMarken(v).get(GARTEN_SITZUNG).status, "ok");
});

test("nachernte: zu kurze Sitzung und ausgeschlossener Ordner → kein claude-Aufruf, Marke „uebersprungen“ (zählt nie als nachgeerntet)", async () => {
  const v = tempVault();
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ automatik: { ernteNichtIn: ["/projekte/privat"] } }));
  const kurz = join(tempOrdner("Kurz"), "kurz.jsonl");
  schreibeVerlauf(kurz, [nutzer("Eine Frage."), assistent("Eine Antwort."), nutzer("Noch eine Frage.")]);
  const log = fakeAusgabe(MOEHREN);
  const k = await nach(v, kurz, { sid: "kurz-1" });
  assert.deepEqual([k.status, k.grund, k.aufrufe], ["uebersprungen", "zu kurze Sitzung", 0]);
  assert.deepEqual(lies(marke(v, "kurz-1")), { status: "uebersprungen", grund: "zu kurze Sitzung", zeit: "2026-10-21T09:00:00Z" });
  const p = await nach(v, verlauf(v), { sid: "privat-1", cwd: "/projekte/privat/geheim" });
  assert.deepEqual([p.status, p.grund], ["uebersprungen", "ausgeschlossener Ordner"]);
  assert.equal(lies(marke(v, "privat-1")).status, "uebersprungen");
  assert.ok(!existsSync(log), "claude wurde nie gestartet");
  const alle = E.leseNachernteMarken(v);
  assert.deepEqual([...alle.keys()].sort(), ["kurz-1", "privat-1"]);
});

test("leseArgs: --nachernte ist ein Schalter und schluckt das nächste Argument nicht", () => {
  const { flags, vault } = E.leseArgs(["--nachernte", "--transkript", "/t.jsonl", "--sid", "s1", "--cwd", "/p", "/mein/vault"]);
  assert.deepEqual(flags, { nachernte: true, transkript: "/t.jsonl", sid: "s1", cwd: "/p" });
  assert.equal(vault, "/mein/vault");
  assert.equal(E.leseArgs(["--art", "fakt", "/v"]).flags.nachernte, undefined);
});

test("CLI --nachernte: erntet die Sitzung von vorn (ohne Byte-Marke), eine Zeile Ergebnis, Marke und Vorschlag mit nachernte: true", () => {
  const v = tempVault();
  const tr = verlauf(v);
  mkdirSync(join(v, ".logs", "ernte"), { recursive: true });
  writeFileSync(fakt(v), JSON.stringify({ bis: statSync(tr).size }) + "\n");
  const log = fakeAusgabe(MOEHREN);
  const env = { ...process.env, BRAIN_CLAUDE: FAKE, PATH: LEER_PATH, HOME: TEMP_HOME, USERPROFILE: TEMP_HOME };
  delete env.BRAIN_ERNTE;
  const r = spawnSync(process.execPath, [ERNTE_CLI, "--nachernte", "--transkript", tr, "--sid", "sid-cli", "--cwd", GARTEN_CWD, v], { env, encoding: "utf8", windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Nach-Ernte sid-cli: ok, 1 Vorschlag\.\n$/);
  assert.ok(existsSync(log));
  const dateien = readdirSync(join(v, "00_inbox", "_vorschlaege"));
  assert.equal(dateien.length, 1);
  assert.match(readFileSync(join(v, "00_inbox", "_vorschlaege", dateien[0]), "utf8"), /\nnachernte: true\n/);
  assert.equal(lies(marke(v, "sid-cli")).status, "ok");
  assert.ok(!existsSync(join(v, ".logs", "ernte", "sid-cli.fakt")));
});

// ---------- ganze Sitzung in Fenstern (à ~24 000 Zeichen) ----------

// Lange erfundene Sitzung: je Prompt ~1 500 Zeichen Füllwerk; „fakten“ = { nr: Prompt-Nummer, name } — der Fakt steht im Prompt.
const LANG_SID = "sitzung-lang";
function langerVerlauf(v, fakten, { prompts = 45 } = {}) {
  const zeilen = [];
  for (let i = 1; i <= prompts; i++) {
    const f = fakten.find((x) => x.nr === i);
    const text = f ? `Bitte merke dir: ${f.name} steht in Beet 3. ${"Beet ".repeat(280)}` : `Frage ${i} zum Garten ${"Beet ".repeat(300)}`;
    const zeit = `2026-10-20T08:${String(i).padStart(2, "0")}:00.000Z`;
    zeilen.push({ type: "user", uuid: `l${i}`, timestamp: zeit, sessionId: LANG_SID, cwd: GARTEN_CWD, message: { role: "user", content: text } });
    zeilen.push({ type: "assistant", uuid: `m${i}`, timestamp: zeit, sessionId: LANG_SID, cwd: GARTEN_CWD, message: { role: "assistant", content: [{ type: "text", text: `Antwort ${i}` }] } });
  }
  const f = join(tempOrdner("Lang Brän"), "lang.jsonl");
  schreibeVerlauf(f, zeilen);
  return f;
}
const FAKTEN = [{ nr: 3, name: "Fruehfakt" }, { nr: 22, name: "Mittelfakt" }, { nr: 44, name: "Spaetfakt" }];
const regelnFuer = (...namen) => namen.map((n) => ({ wenn: `Bitte merke dir: ${n} steht`, antwort: `### Fakt ${n}\n${n} steht in Beet 3.\nZitat: Bitte merke dir: ${n} steht in Beet 3.\n` }));
const langNach = (v, tr, extra = {}) => nach(v, tr, { sid: LANG_SID, ...extra });
const titel = (v) => vorschlaegeTexte(v).map((t) => t.match(/^titel: "(.*)"$/m)[1]).sort();
const vorschlaegeTexte = (v) => { const d = join(v, "00_inbox", "_vorschlaege"); try { return readdirSync(d).map((n) => readFileSync(join(d, n), "utf8")); } catch { return []; } };

test("leseFenster: aufeinanderfolgende Fenster ≤ 24 000 Zeichen, jeder Prompt genau einmal in Zeitfolge; ein kleiner Verlauf = ein Fenster wie leseTranskript", () => {
  const v = tempVault();
  const lang = E.leseFenster(langerVerlauf(v, FAKTEN), { sperr: [v] });
  assert.ok(lang.fenster.length >= 3, `mindestens 3 Fenster, waren ${lang.fenster.length}`);
  assert.equal(lang.prompts, 45);
  for (const f of lang.fenster) assert.ok(f.text.length + (f.werkzeuge ? E.WERKZEUG_KOPF.length + f.werkzeuge.length + 1 : 0) <= E.MAX_TRANSKRIPT);
  const nummern = lang.fenster.flatMap((f) => [...f.text.matchAll(/^Nutzer: (?:Frage|Bitte merke dir: \S+ steht in Beet) ?(\d+)?/gm)].map((m) => m[0]));
  assert.equal(nummern.length, 45, "jeder Nutzer-Prompt kommt genau einmal vor");
  const fragen = lang.fenster.flatMap((f) => [...f.text.matchAll(/^Nutzer: Frage (\d+) /gm)].map((m) => Number(m[1])));
  assert.deepEqual(fragen, fragen.slice().sort((a, b) => a - b), "Zeitfolge bleibt erhalten");
  assert.ok(lang.fenster[0].text.includes("Fruehfakt") && !lang.fenster[0].text.includes("Spaetfakt"));
  assert.ok(lang.fenster.at(-1).text.includes("Spaetfakt") && !lang.fenster.at(-1).text.includes("Fruehfakt"));

  const garten = verlauf(v);
  const klein = E.leseFenster(garten, { sperr: [v] });
  const alt = E.leseTranskript(garten, { sperr: [v] });
  assert.equal(klein.fenster.length, 1);
  assert.deepEqual([klein.fenster[0].text, klein.fenster[0].werkzeuge, klein.prompts], [alt.text, alt.werkzeuge, alt.prompts]);
});

test("leseFenster: Werkzeug-Ausgaben stehen im Fenster ihrer Zeit, höchstens 8 000 Zeichen je Fenster, nie Zugangsdaten", () => {
  const v = tempVault();
  const zeilen = [];
  for (let i = 1; i <= 40; i++) {
    const zeit = `2026-10-20T08:${String(i).padStart(2, "0")}:00.000Z`;
    zeilen.push({ type: "user", uuid: `l${i}`, timestamp: zeit, sessionId: LANG_SID, cwd: GARTEN_CWD, message: { role: "user", content: `Frage ${i} ${"Beet ".repeat(260)}` } });
    zeilen.push({ type: "assistant", uuid: `a${i}`, timestamp: zeit, sessionId: LANG_SID, cwd: GARTEN_CWD, message: { role: "assistant", content: [{ type: "tool_use", id: `t${i}`, name: "Bash", input: { command: "cat saat.txt" } }] } });
    zeilen.push({ type: "user", uuid: `r${i}`, timestamp: zeit, sessionId: LANG_SID, cwd: GARTEN_CWD, message: { role: "user", content: [{ type: "tool_result", tool_use_id: `t${i}`, content: `Ausgabe ${i}: ${"Saat ".repeat(150)}` }] } });
  }
  const f = join(tempOrdner("Werk Brän"), "werk.jsonl");
  schreibeVerlauf(f, zeilen);
  const { fenster } = E.leseFenster(f, { sperr: [v] });
  assert.ok(fenster.length >= 2);
  assert.ok(fenster.every((w) => w.werkzeuge.length <= 8000 + 2 * 20));
  const erste = fenster[0], letzte = fenster.at(-1);
  assert.match(erste.werkzeuge, /Werkzeug \(Bash\): Ausgabe 1: /);
  const nr = (w) => [...w.werkzeuge.matchAll(/Ausgabe (\d+):/g)].map((m) => Number(m[1]));
  assert.ok(Math.max(...nr(erste)) < Math.min(...nr(letzte)), "Ausgaben wandern mit ihrer Zeit");
  assert.ok(!fenster.some((w, i) => i > 0 && nr(w).some((x) => nr(fenster[i - 1]).includes(x))), "keine Ausgabe in zwei Fenstern");
});

test("waehleFenster: alle, wenn es nicht mehr als max sind; sonst gleichmäßig über die Sitzung verteilt (erstes und letztes dabei), nie nur die letzten", () => {
  assert.deepEqual(E.waehleFenster(3, 8), [0, 1, 2]);
  assert.deepEqual(E.waehleFenster(8, 8), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(E.waehleFenster(0, 8), []);
  assert.deepEqual(E.waehleFenster(20, 8), [0, 3, 5, 8, 11, 14, 16, 19]);
  assert.deepEqual(E.waehleFenster(9, 8), [0, 1, 2, 3, 5, 6, 7, 8]);
  assert.deepEqual(E.waehleFenster(10, 2), [0, 9]);
  assert.deepEqual(E.waehleFenster(10, 1), [9], "ein einziges: das jüngste");
  for (const [n, m] of [[100, 8], [17, 5], [8, 7], [250, 12]]) {
    const w = E.waehleFenster(n, m);
    assert.equal(w.length, m);
    assert.equal(new Set(w).size, m, "keine doppelten");
    assert.deepEqual([w[0], w.at(-1)], [0, n - 1]);
    const luecken = w.slice(1).map((x, i) => x - w[i]);
    assert.ok(Math.max(...luecken) - Math.min(...luecken) <= 1, `gleichmäßig: ${luecken}`);
  }
});

test("nachernte: die GANZE Sitzung — je Fenster ein Aufruf, Fakten aus frühem, mittlerem und spätem Teil werden geerntet (alle B1-Prüfungen gegen das ganze Transkript)", async () => {
  const v = tempVault();
  const tr = langerVerlauf(v, FAKTEN);
  const ki = fakeKi(regelnFuer("Fruehfakt", "Mittelfakt", "Spaetfakt"));
  const n = E.leseFenster(tr, { sperr: [v] }).fenster.length;
  const r = await langNach(v, tr);
  assert.deepEqual([r.status, r.aufrufe, r.vorschlaege.length], ["ok", n, 3]);
  assert.equal(ki.anzahl(), n);
  assert.deepEqual(titel(v), ["Fakt Fruehfakt", "Fakt Mittelfakt", "Fakt Spaetfakt"]);
  assert.match(ki.aufrufe()[0].eingabe, /Frage 1 /);
  assert.doesNotMatch(ki.aufrufe()[0].eingabe, /Frage 45 /, "das erste Fenster ist nicht das Ende");
  assert.match(ki.aufrufe().at(-1).eingabe, /Frage 45 /);
  const zeilen = readFileSync(join(v, ".logs", "ernte.log"), "utf8").trim().split("\n");
  assert.equal(zeilen.length, n, "eine Protokollzeile je Fenster");
  assert.match(zeilen[0], new RegExp(`nachernte=1 fenster=1/${n}$`));
  assert.match(zeilen.at(-1), new RegExp(`nachernte=1 fenster=${n}/${n}$`));
  const m = lies(marke(v, LANG_SID));
  assert.deepEqual([m.status, m.vorschlaege, m.fenster], ["ok", 3, n]);
});

test("nachernte: maxFenster — bei mehr Fenstern gleichmäßig verteilt gewählt (erstes und letztes), nicht nur die letzten", async () => {
  const v = tempVault();
  const tr = langerVerlauf(v, FAKTEN);
  const ki = fakeKi(regelnFuer("Fruehfakt", "Mittelfakt", "Spaetfakt"));
  const n = E.leseFenster(tr, { sperr: [v] }).fenster.length;
  assert.ok(n >= 3);
  const r = await langNach(v, tr, { maxFenster: 2 });
  assert.deepEqual([r.status, r.aufrufe], ["ok", 2]);
  assert.equal(ki.anzahl(), 2);
  assert.deepEqual(titel(v), ["Fakt Fruehfakt", "Fakt Spaetfakt"], "Anfang und Ende, die Mitte fehlt");
  assert.match(ki.aufrufe()[0].eingabe, /Frage 1 /);
  assert.match(ki.aufrufe()[1].eingabe, /Frage 45 /);
  assert.match(logZeile(v), new RegExp(`fenster=2/2$`));
  assert.deepEqual(lies(marke(v, LANG_SID)).gewaehlt, undefined, "fertige Marke trägt keinen Zwischenstand");
});

test("nachernte: Fortsetzen — nach Abbruch (Budget) geht es bei den noch offenen Fenstern weiter, nichts wird doppelt geerntet", async () => {
  const v = tempVault();
  const tr = langerVerlauf(v, FAKTEN);
  const ki = fakeKi(regelnFuer("Fruehfakt", "Mittelfakt", "Spaetfakt"));
  const n = E.leseFenster(tr, { sperr: [v] }).fenster.length;
  const a = await langNach(v, tr, { maxAufrufe: 1 });
  assert.deepEqual([a.status, a.grund, a.aufrufe, a.vorschlaege.length], ["teilweise", "budget", 1, 1]);
  const z = lies(marke(v, LANG_SID));
  assert.deepEqual([z.status, z.fertig, z.fenster], ["laeuft", [0], n]);
  assert.equal(E.nachernteFertig(z), false);
  assert.equal(E.nachernteFertig(lies(marke(v, LANG_SID))), false);
  const b = await langNach(v, tr, { maxAufrufe: 1 });
  assert.deepEqual([b.status, b.aufrufe], ["teilweise", 1]);
  assert.deepEqual(lies(marke(v, LANG_SID)).fertig, [0, 1]);
  const c = await langNach(v, tr);
  assert.deepEqual([c.status, c.aufrufe], ["ok", n - 2]);
  assert.equal(ki.anzahl(), n, "jedes Fenster genau einmal");
  assert.deepEqual(titel(v), ["Fakt Fruehfakt", "Fakt Mittelfakt", "Fakt Spaetfakt"]);
  const m = lies(marke(v, LANG_SID));
  assert.deepEqual([m.status, m.vorschlaege, m.fenster], ["ok", 3, n]);
  assert.equal(E.nachernteFertig(m), true);
});

test("nachernte: ein claude-Fehler mitten in der Sitzung hält den Zwischenstand; der nächste Lauf setzt dort an", async () => {
  const v = tempVault();
  const tr = langerVerlauf(v, FAKTEN);
  const ki = fakeKi(regelnFuer("Fruehfakt", "Mittelfakt", "Spaetfakt"));
  const n = E.leseFenster(tr, { sperr: [v] }).fenster.length;
  await langNach(v, tr, { maxAufrufe: 1 });
  fakeKi([], { exit: 1 });
  const f = await langNach(v, tr);
  assert.deepEqual([f.status, f.aufrufe], ["fehler", 1]);
  assert.deepEqual(lies(marke(v, LANG_SID)).fertig, [0], "das fehlgeschlagene Fenster bleibt offen");
  const ki2 = fakeKi(regelnFuer("Fruehfakt", "Mittelfakt", "Spaetfakt"));
  const ok = await langNach(v, tr);
  assert.deepEqual([ok.status, ok.aufrufe], ["ok", n - 1]);
  assert.equal(ki2.anzahl(), n - 1);
  assert.equal(titel(v).length, 3);
  assert.equal(ki.anzahl(), 1);
});

test("nachernte: exakte Dubletten (gleicher normalisierter Titel + Zitat) innerhalb einer Sitzung werden nur einmal geschrieben — auch über einen Abbruch hinweg", async () => {
  const v = tempVault();
  const tr = langerVerlauf(v, [{ nr: 2, name: "Doppelfakt" }, { nr: 40, name: "Doppelfakt" }, { nr: 30, name: "Einzelfakt" }]);
  const n = E.leseFenster(tr, { sperr: [v] }).fenster.length;
  fakeKi(regelnFuer("Doppelfakt", "Einzelfakt"));
  const r = await langNach(v, tr);
  assert.equal(r.status, "ok");
  assert.deepEqual(titel(v), ["Fakt Doppelfakt", "Fakt Einzelfakt"]);
  assert.match(readFileSync(join(v, ".logs", "ernte.log"), "utf8"), / dubletten=1 nachernte=1 /);

  const v2 = tempVault();
  fakeKi(regelnFuer("Doppelfakt", "Einzelfakt"));
  const a = await langNach(v2, tr, { maxAufrufe: 1 });
  assert.equal(a.status, "teilweise");
  assert.equal(titel(v2).filter((t) => t === "Fakt Doppelfakt").length, 1);
  const b = await langNach(v2, tr);
  assert.equal(b.status, "ok");
  assert.deepEqual(titel(v2), ["Fakt Doppelfakt", "Fakt Einzelfakt"], "der Zwischenstand kennt den schon geschriebenen Fakt");
  assert.ok(n >= 3);
});

test("nachernte: wächst das Transkript zwischen zwei Läufen, beginnt es von vorn — schon geschriebene Fakten werden trotzdem nicht doppelt", async () => {
  const v = tempVault();
  const tr = langerVerlauf(v, FAKTEN);
  fakeKi(regelnFuer("Fruehfakt", "Mittelfakt", "Spaetfakt"));
  await langNach(v, tr, { maxAufrufe: 2 });
  assert.equal(titel(v).length, 2);
  const alt = readFileSync(tr, "utf8");
  writeFileSync(tr, alt + JSON.stringify({ type: "user", uuid: "neu1", timestamp: "2026-10-21T07:00:00.000Z", sessionId: LANG_SID, cwd: GARTEN_CWD, message: { role: "user", content: "Noch eine Frage zum Garten." } }) + "\n");
  const r = await langNach(v, tr);
  assert.equal(r.status, "ok");
  assert.deepEqual(titel(v), ["Fakt Fruehfakt", "Fakt Mittelfakt", "Fakt Spaetfakt"], "Früh- und Mittelfakt nicht doppelt");
});

test("CLI --nachernte --max-fenster N: die ganze lange Sitzung in höchstens N gleichmäßig verteilten Fenstern", () => {
  const v = tempVault();
  const tr = langerVerlauf(v, FAKTEN);
  fakeKi(regelnFuer("Fruehfakt", "Mittelfakt", "Spaetfakt"));
  const env = { ...process.env, BRAIN_CLAUDE: FAKE, PATH: LEER_PATH, HOME: TEMP_HOME, USERPROFILE: TEMP_HOME };
  delete env.BRAIN_ERNTE;
  const cli = (...extra) => spawnSync(process.execPath, [ERNTE_CLI, "--nachernte", "--transkript", tr, "--sid", LANG_SID, "--cwd", GARTEN_CWD, ...extra, v], { env, encoding: "utf8", windowsHide: true });
  const r = cli("--max-fenster", "2");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `Nach-Ernte ${LANG_SID}: ok, 2 Vorschläge.\n`);
  assert.deepEqual(titel(v), ["Fakt Fruehfakt", "Fakt Spaetfakt"]);
  const ungueltig = cli("--max-fenster", "0");   // ungültig → Standard (8): jetzt die ganze Sitzung, schon Geschriebenes nicht doppelt
  assert.equal(ungueltig.status, 0, ungueltig.stderr);
  assert.deepEqual(titel(v), ["Fakt Fruehfakt", "Fakt Mittelfakt", "Fakt Spaetfakt"]);
});
