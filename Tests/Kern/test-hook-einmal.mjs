// .tools/tests/test-hook-einmal.mjs — Dubletten-Guard der Claude-Code-Hooks (adapters/claude-code/einmal.mjs).
// Anlass: Konto 2 liest die Einstellungen von Konto 1 zusätzlich als Projekt-Einstellung → jeder Brain-Hook läuft je Ereignis
// zweimal, teils gleichzeitig. Geprüft: zwei GLEICHZEITIGE Aufrufe mit identischer Eingabe → genau eine Ausgabe/Log-Zeile;
// verschiedene Prompts/Sitzungen/Quellen → beide; Marke älter als 30 s → läuft wieder; Eval-Sitzungen („eval-…") nie unterdrückt.
// setup.mjs schaltet den Guard für alle übrigen Tests ab (BRAIN_EINMAL=aus) — hier gezielt wieder an (Kind-Prozesse bekommen es explizit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, utimesSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { tempOrdner, tempVault, schreibeVerlauf, nutzer, assistent, TEMP_HOME, KIT } from "./verlauf-fixture.mjs";
import { messlatte } from "../messlatte.mjs";

process.env.BRAIN_EINMAL = "an";
const EINMAL = join(KIT, "adapters", "claude-code", "einmal.mjs");
const { ersterAufruf, markenOrdner, FENSTER_MS, FENSTER_HINT_MS, AUFBEWAHREN_MS } = await import(pathToFileURL(EINMAL).href);
const ADAPTER = join(KIT, "adapters", "claude-code");

const OHNE_GIT = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_") && !k.startsWith("BRAIN_")));
// Ursache des früheren Wackelns: „Dublette innerhalb des Fensters" (5 s bei brain-hint) wurde gegen die Wanduhr gemessen — von der Marke des ersten
// Hooks bis zur Prüfung des nächsten Prozesses, jeder mit eigenem Node-Start und Modul-Imports. Unter Last (CI, parallele Testdateien) dehnt sich das
// über das Fenster, und die Wiederholung lief fälschlich. Darum bekommen die Kindprozesse ein großes Fenster (BRAIN_EINMAL_FENSTER_MS, nur Prüfstand):
// „Dublette" hängt dann nicht mehr an der Startzeit. Schritte, die das ECHTE Fenster prüfen (Marke ist älter), laufen mit ECHTES_FENSTER; dort
// zählt nur „älter als das Fenster", und das macht Last nicht falsch (altern() setzt die Marke weit zurück).
const GROSSES_FENSTER = { BRAIN_EINMAL_FENSTER_MS: String(60 * 60 * 1000) };
const ECHTES_FENSTER = { BRAIN_EINMAL_FENSTER_MS: "" };   // leer = ungültig = die festen Fenster des Hooks
const hookEnv = (vault, extra = {}) => ({ ...OHNE_GIT, HOME: TEMP_HOME, USERPROFILE: TEMP_HOME, QMD_BIN: process.env.QMD_BIN, BRAIN_VAULT: vault, BRAIN_EINMAL: "an", ...GROSSES_FENSTER, ...extra });
// Startet einen Hook asynchron (damit zwei Aufrufe wirklich gleichzeitig laufen) → Promise<{ status, stdout, stderr }>
function starte(name, args, eingabe, env) {
  return new Promise((fertig) => {
    const kind = spawn(process.execPath, [join(ADAPTER, name), ...args], { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    kind.stdout.on("data", (c) => { stdout += c; });
    kind.stderr.on("data", (c) => { stderr += c; });
    kind.on("close", (status) => fertig({ status, stdout, stderr }));
    kind.stdin.on("error", () => {});
    kind.stdin.end(typeof eingabe === "string" ? eingabe : JSON.stringify(eingabe));
  });
}
const gleichzeitig = (...aufrufe) => Promise.all(aufrufe);
const zeilen = (datei) => (existsSync(datei) ? readFileSync(datei, "utf8").split("\n").filter(Boolean) : []);
const altern = (vault, sek) => {   // alle Marken um `sek` Sekunden altern lassen
  const dir = markenOrdner(vault), t = new Date(Date.now() - sek * 1000);
  for (const n of readdirSync(dir)) utimesSync(join(dir, n), t, t);
};
const HINT_PROMPT = "wie funktioniert das thema alpha genau";   // ohne wiki-map.json endet die Suche mit fehler=ENOENT → genau eine hint.log-Zeile je ausgeführtem Hook

// ------------------------------------------------------------------------------------------ Modul
test("ersterAufruf: erster true, gleicher Schlüssel danach false; andere Sitzung/Inhalt/Hook zählen einzeln", () => {
  const v = tempVault();
  assert.equal(ersterAufruf(v, "h", { sid: "s1", inhalt: "a" }), true);
  assert.equal(ersterAufruf(v, "h", { sid: "s1", inhalt: "a" }), false, "Dublette");
  assert.equal(ersterAufruf(v, "h", { sid: "s1", inhalt: "a" }), false, "und weiter Dublette");
  assert.equal(ersterAufruf(v, "h", { sid: "s1", inhalt: "b" }), true, "anderer Inhalt");
  assert.equal(ersterAufruf(v, "h", { sid: "s2", inhalt: "a" }), true, "andere Sitzung");
  assert.equal(ersterAufruf(v, "h2", { sid: "s1", inhalt: "a" }), true, "anderer Hook am selben Ereignis");
  assert.equal(ersterAufruf(v, "h", { sid: "s1" }), true, "ohne Inhalt ist ein eigener Schlüssel");
  assert.equal(ersterAufruf(v, "h", { sid: "s1" }), false);
});

test("ersterAufruf: Marke nur als Hash — kein Klartext von Prompt oder Sitzung im Dateinamen oder Inhalt", () => {
  const v = tempVault();
  ersterAufruf(v, "brain-hint", { sid: "geheime-sitzung", inhalt: "mein geheimer Prompt-Text" });
  const namen = readdirSync(markenOrdner(v));
  assert.equal(namen.length, 1);
  assert.match(namen[0], /^[0-9a-f]{40}$/);
  const inhalt = readFileSync(join(markenOrdner(v), namen[0]), "utf8");
  assert.doesNotMatch(namen[0] + inhalt, /geheim|Prompt/);
  assert.ok(markenOrdner(v).startsWith(join(v, ".logs")), "unter .logs/ (gitignored), nicht im Vault-Baum");
});

test("ersterAufruf: ohne session_id, Eval-Sitzung, BRAIN_EINMAL=aus, fehlender Vault → nie unterdrückt (und keine Marke)", () => {
  const v = tempVault();
  for (let i = 0; i < 3; i++) {
    assert.equal(ersterAufruf(v, "h", { sid: "", inhalt: "a" }), true, "ohne sid");
    assert.equal(ersterAufruf(v, "h", { sid: "eval-123-0", inhalt: "a" }), true, "Eval");
    assert.equal(ersterAufruf(join(v, "gibt-es-nicht"), "h", { sid: "s", inhalt: "a" }), true, "Vault fehlt");
  }
  assert.ok(!existsSync(join(v, ".logs", "hook-einmal")), "keine Marken ohne Guard");
  assert.ok(!existsSync(join(v, "gibt-es-nicht")), "legt den fehlenden Vault nicht an");
  process.env.BRAIN_EINMAL = "aus";
  try {
    assert.equal(ersterAufruf(v, "h", { sid: "s", inhalt: "a" }), true);
    assert.equal(ersterAufruf(v, "h", { sid: "s", inhalt: "a" }), true, "Notausgang BRAIN_EINMAL=aus");
  } finally { process.env.BRAIN_EINMAL = "an"; }
});

test("ersterAufruf: Marke älter als 30 s → läuft wieder (und die erneuerte Marke macht den nächsten wieder zur Dublette)", () => {
  const v = tempVault();
  assert.equal(ersterAufruf(v, "h", { sid: "s", inhalt: "x" }), true);
  assert.equal(ersterAufruf(v, "h", { sid: "s", inhalt: "x" }), false);
  altern(v, FENSTER_MS / 1000 + 2);
  assert.equal(ersterAufruf(v, "h", { sid: "s", inhalt: "x" }), true, "Marke > 30 s alt");
  assert.equal(ersterAufruf(v, "h", { sid: "s", inhalt: "x" }), false, "jetzt wieder frisch");
  assert.deepEqual(readdirSync(markenOrdner(v)).filter((n) => n.endsWith(".neu")), [], "Übernahme-Sperre wieder weg");
  // Knapp unter dem Fenster bleibt es eine Dublette
  const w = tempVault();
  ersterAufruf(w, "h", { sid: "s", inhalt: "y" });
  altern(w, 25);
  assert.equal(ersterAufruf(w, "h", { sid: "s", inhalt: "y" }), false, "25 s alt → noch Dublette");
  // Zeit per Parameter (jetzt) statt Dateizeit
  assert.equal(ersterAufruf(w, "h", { sid: "s", inhalt: "y", jetzt: Date.now() + FENSTER_MS + 1000 }), true);
});

test("ersterAufruf: alte Marken (> 10 min) werden nebenbei weggeräumt, frische bleiben", () => {
  const v = tempVault();
  ersterAufruf(v, "h", { sid: "s", inhalt: "alt" });
  ersterAufruf(v, "h", { sid: "s", inhalt: "frisch" });
  const dir = markenOrdner(v), namen = readdirSync(dir);
  const alt = new Date(Date.now() - AUFBEWAHREN_MS - 60000);
  utimesSync(join(dir, namen[0]), alt, alt);
  assert.equal(ersterAufruf(v, "h", { sid: "s", inhalt: "neu" }), true);
  const rest = readdirSync(dir);
  assert.ok(!rest.includes(namen[0]), "alte Marke weg");
  assert.ok(rest.includes(namen[1]) && rest.length === 2, `frische bleibt, neue dazu: ${rest.length}`);
});

test("ersterAufruf: Guard defekt (Marken-Ordner nicht anlegbar) → der Hook läuft normal weiter", () => {
  const v = tempVault();
  writeFileSync(join(v, ".logs"), "ich bin eine Datei, kein Ordner");   // mkdir .logs/hook-einmal scheitert
  assert.equal(ersterAufruf(v, "h", { sid: "s", inhalt: "a" }), true);
  assert.equal(ersterAufruf(v, "h", { sid: "s", inhalt: "a" }), true);
});

test("ersterAufruf: hängende Übernahme-Sperre (Absturz) blockiert nicht für immer; frische Sperre → Dublette", () => {
  const v = tempVault();
  ersterAufruf(v, "h", { sid: "s", inhalt: "x" });
  altern(v, 120);                                     // Marke veraltet
  const dir = markenOrdner(v), marke = readdirSync(dir)[0], sperre = join(dir, `${marke}.neu`);
  writeFileSync(sperre, "x");                         // jemand übernimmt gerade
  assert.equal(ersterAufruf(v, "h", { sid: "s", inhalt: "x" }), false, "frische Sperre: der andere übernimmt");
  const alt = new Date(Date.now() - 60000);
  utimesSync(sperre, alt, alt);                       // Sperre hängt seit einer Minute
  assert.equal(ersterAufruf(v, "h", { sid: "s", inhalt: "x" }), true, "abgestürzte Sperre: im Zweifel normal laufen");
  assert.ok(!existsSync(sperre), "hängende Sperre aufgeräumt");
  assert.equal(ersterAufruf(v, "h", { sid: "s", inhalt: "x" }), true, "Marke ist noch alt → nächster übernimmt sie");
  assert.equal(ersterAufruf(v, "h", { sid: "s", inhalt: "x" }), false);
});

test("ersterAufruf: sechs gleichzeitige Prozesse nach einer ALTEN Marke → genau einer läuft", async () => {
  const v = tempVault();
  ersterAufruf(v, "h", { sid: "s", inhalt: "x" });
  altern(v, 120);
  const code = `import { ersterAufruf } from ${JSON.stringify(pathToFileURL(EINMAL).href)}; process.stdout.write(String(ersterAufruf(${JSON.stringify(v)}, "h", { sid: "s", inhalt: "x" })));`;
  const lauf = () => new Promise((fertig) => {
    const k = spawn(process.execPath, ["--input-type=module", "-e", code], { env: { ...OHNE_GIT, BRAIN_EINMAL: "an" }, stdio: ["ignore", "pipe", "ignore"] });
    let o = ""; k.stdout.on("data", (c) => { o += c; }); k.on("close", () => fertig(o));
  });
  const erg = await Promise.all(Array.from({ length: 6 }, lauf));
  assert.equal(erg.filter((x) => x === "true").length, 1, `Ergebnisse: ${erg.join(",")}`);
  assert.equal(erg.filter((x) => x === "false").length, 5);
});

// ------------------------------------------------------------------------------------------ brain-hint
test("brain-hint: zwei gleichzeitige Aufrufe mit gleichem Prompt → genau eine hint.log-Zeile (20 Paare, nie zwei)", async () => {
  const v = tempVault();
  for (let i = 0; i < 20; i++) {
    const ein = { prompt: HINT_PROMPT, session_id: `${String(i).padStart(2, "0")}-paar-s` };   // hint.log kürzt die sid auf 8 Zeichen → die ersten 8 müssen eindeutig sein
    const [a, b] = await gleichzeitig(starte("brain-hint.mjs", [], ein, hookEnv(v)), starte("brain-hint.mjs", [], ein, hookEnv(v)));
    assert.equal(a.status, 0); assert.equal(b.status, 0);
    assert.equal(a.stderr + b.stderr, "");
  }
  const z = zeilen(join(v, ".logs", "hint.log"));
  assert.equal(z.length, 20, `20 Paare → 20 Zeilen, war ${z.length}`);
  assert.equal(new Set(z.map((l) => l.match(/sid=(\S+)/)[1])).size, 20, "je Sitzung genau eine");
});

test("brain-hint: verschiedene Prompts derselben Sitzung → beide laufen; Marke älter als das Hint-Fenster (5 s) → läuft wieder", async () => {
  const v = tempVault(), log = join(v, ".logs", "hint.log");
  const ein = (p) => ({ prompt: p, session_id: "s-viele" });
  await gleichzeitig(starte("brain-hint.mjs", [], ein(HINT_PROMPT), hookEnv(v)), starte("brain-hint.mjs", [], ein("wie funktioniert das thema beta genau"), hookEnv(v)));
  assert.equal(zeilen(log).length, 2, "zwei verschiedene Prompts → zwei Zeilen");
  await starte("brain-hint.mjs", [], ein(HINT_PROMPT), hookEnv(v));
  assert.equal(zeilen(log).length, 2, "derselbe Prompt gleich noch einmal (frische Marke, < 5 s) → Dublette");
  altern(v, 40);
  await gleichzeitig(starte("brain-hint.mjs", [], ein(HINT_PROMPT), hookEnv(v, ECHTES_FENSTER)), starte("brain-hint.mjs", [], ein(HINT_PROMPT), hookEnv(v, ECHTES_FENSTER)));
  assert.equal(zeilen(log).length, 3, "Marke > 5 s alt: von zwei gleichzeitigen läuft genau einer wieder");
});

// Befund 5: Esc + denselben Prompt noch einmal senden darf nicht still bleiben (die Dubletten laufen fast gleichzeitig, ~1 s — nicht 30 s auseinander).
test("brain-hint: derselbe Prompt nach Esc (Marke 6 s alt, Fenster 5 s) → Hinweis läuft wieder; FENSTER_HINT_MS ist 5 s, die anderen Hooks behalten 30 s", async () => {
  assert.equal(FENSTER_HINT_MS, 5000);
  assert.equal(FENSTER_MS, 30000);
  const v = tempVault(), log = join(v, ".logs", "hint.log");
  const ein = { prompt: HINT_PROMPT, session_id: "s-esc" };
  await starte("brain-hint.mjs", [], ein, hookEnv(v));
  assert.equal(zeilen(log).length, 1);
  altern(v, 6);                                                // der Nutzer drückt Esc und sendet denselben Prompt nach ein paar Sekunden noch einmal
  await starte("brain-hint.mjs", [], ein, hookEnv(v, ECHTES_FENSTER));
  assert.equal(zeilen(log).length, 2, "nach 6 s kein „Dublette“ mehr");
  // Unit: Fenster-Grenze mit der Zeit als Parameter
  const w = tempVault();
  assert.equal(ersterAufruf(w, "brain-hint", { sid: "s", inhalt: "x", fensterMs: FENSTER_HINT_MS }), true);
  assert.equal(ersterAufruf(w, "brain-hint", { sid: "s", inhalt: "x", fensterMs: FENSTER_HINT_MS, jetzt: Date.now() + 3000 }), false, "3 s später: Dublette");
  assert.equal(ersterAufruf(w, "brain-hint", { sid: "s", inhalt: "x", fensterMs: FENSTER_HINT_MS, jetzt: Date.now() + 7000 }), true, "7 s später: wieder");
});

test("brain-hint: Ereignis-Merkmal im Schlüssel — ist das Transkript seit dem ersten Aufruf gewachsen, ist derselbe Prompt (auch innerhalb des Fensters) ein neues Ereignis; gleichzeitige Dubletten (gleiche Größe) bleiben eine", async () => {
  const v = tempVault(), log = join(v, ".logs", "hint.log");
  const tr = join(tempOrdner("tr"), "s-merkmal.jsonl");
  writeFileSync(tr, '{"type":"user"}\n');
  const ein = { prompt: HINT_PROMPT, session_id: "s-merkmal", transcript_path: tr };
  const [a, b] = await gleichzeitig(starte("brain-hint.mjs", [], ein, hookEnv(v)), starte("brain-hint.mjs", [], ein, hookEnv(v)));
  assert.equal(a.status + b.status, 0);
  assert.equal(zeilen(log).length, 1, "zwei gleichzeitige Aufrufe, gleiche Transkript-Größe → eine Zeile");
  await starte("brain-hint.mjs", [], ein, hookEnv(v));
  assert.equal(zeilen(log).length, 1, "nichts Neues im Transkript, frische Marke → Dublette");
  appendFileSync(tr, '{"type":"assistant"}\n');              // Claude hat inzwischen geantwortet/abgebrochen: das Transkript ist gewachsen
  await starte("brain-hint.mjs", [], ein, hookEnv(v));
  assert.equal(zeilen(log).length, 2, "gewachsenes Transkript → neues Ereignis, auch innerhalb des Fensters");
  // fehlendes/unlesbares Transkript: kein Merkmal, der Guard arbeitet wie zuvor
  const ohne = { prompt: HINT_PROMPT, session_id: "s-ohne-tr", transcript_path: join(v, "gibt-es-nicht.jsonl") };
  await starte("brain-hint.mjs", [], ohne, hookEnv(v));
  await starte("brain-hint.mjs", [], ohne, hookEnv(v));
  assert.equal(zeilen(log).length, 3, "ohne lesbares Transkript: die Wiederholung bleibt eine Dublette");
});

test("brain-hint: Eval-Sitzungen und Aufrufe ohne session_id werden nie unterdrückt", async () => {
  const v = tempVault();
  const eval1 = { prompt: HINT_PROMPT, session_id: "eval-77-0" };
  await gleichzeitig(starte("brain-hint.mjs", [], eval1, hookEnv(v)), starte("brain-hint.mjs", [], eval1, hookEnv(v)));
  assert.equal(zeilen(join(v, ".logs", "hint-eval-runs.log")).length, 2, "gleiche Eval-Sitzung, gleicher Prompt, zweimal gleichzeitig → beide");
  const ohne = { prompt: HINT_PROMPT };
  await gleichzeitig(starte("brain-hint.mjs", [], ohne, hookEnv(v)), starte("brain-hint.mjs", [], ohne, hookEnv(v)));
  assert.equal(zeilen(join(v, ".logs", "hint.log")).length, 2, "ohne session_id → beide");
  assert.ok(!existsSync(join(v, ".logs", "hook-einmal")), "für beide Fälle entsteht keine Marke");
});

test("messlatte: derselbe Prompt mehrfach im Eval-Lauf wird jedes Mal gefragt (Eval-Sitzungs-IDs eval-<pid>-<n>)", () => {
  const v = tempVault();
  const fragen = join(tempOrdner("fragen"), "fragen.json");
  writeFileSync(fragen, JSON.stringify({
    positiv: [{ prompt: HINT_PROMPT, erwartet: ["x.md"] }, { prompt: HINT_PROMPT, erwartet: ["x.md"] }],
    negativ: [HINT_PROMPT, HINT_PROMPT],
  }));
  messlatte(v, { fragenDatei: fragen, holdoutDatei: join(v, "gibt-es-nicht.json") });
  assert.equal(zeilen(join(v, ".logs", "hint-eval-runs.log")).length, 4, "4 Fragen (2 doppelt) → 4 Hook-Läufe");
  assert.ok(!existsSync(join(v, ".logs", "hook-einmal")), "der Guard fasst Eval-Läufe nicht an");
});

// ------------------------------------------------------------------------------------------ session-start
test("session-start: zwei gleichzeitige Aufrufe → Meldung und hooks.log-Zeile genau einmal; andere Quelle oder Sitzung → läuft", async () => {
  const v = tempVault();
  mkdirSync(join(v, "00_inbox"), { recursive: true });
  writeFileSync(join(v, "00_inbox", "notiz.md"), "x");
  const env = hookEnv(v, { BRAIN_SESSION_NUR_STATUS: "1" });
  const ein = { session_id: "s-start", source: "startup", cwd: v };
  const [a, b] = await gleichzeitig(starte("session-start.mjs", [], ein, env), starte("session-start.mjs", [], ein, env));
  const aus = [a.stdout, b.stdout].filter(Boolean);
  assert.equal(aus.length, 1, `genau ein Aufruf gibt aus: [${a.stdout}] [${b.stdout}]`);
  assert.match(aus[0], /Kortex-Inbox: 1 Datei\(en\) warten auf \/ingest\./);
  assert.equal(zeilen(join(v, ".logs", "hooks.log")).filter((l) => l.includes("session-start")).length, 1, "eine Start-Zeile im Log");
  const c = await starte("session-start.mjs", [], { ...ein, source: "resume" }, env);
  assert.match(c.stdout, /Kortex-Inbox/, "andere Quelle (resume) ist kein Duplikat");
  const d = await starte("session-start.mjs", [], { ...ein, session_id: "s-anders" }, env);
  assert.match(d.stdout, /Kortex-Inbox/, "andere Sitzung");
  altern(v, 40);
  const e = await starte("session-start.mjs", [], ein, { ...env, ...ECHTES_FENSTER });
  assert.match(e.stdout, /Kortex-Inbox/, "Marke > 30 s alt → läuft wieder");
});

// ------------------------------------------------------------------------------------------ kompakt-sichern
test("kompakt-sichern: zwei gleichzeitige Aufrufe → eine Log-Zeile, ein Stand", async () => {
  const v = tempVault();
  const f = join(tempOrdner("Verläufe"), "s-kompakt.jsonl");
  schreibeVerlauf(f, [nutzer("Ziel: Export bauen"), assistent("ok")]);
  const ein = { session_id: "s-kompakt", transcript_path: f, cwd: v, hook_event_name: "PreCompact", trigger: "auto" };
  const [a, b] = await gleichzeitig(starte("kompakt-sichern.mjs", [], ein, hookEnv(v)), starte("kompakt-sichern.mjs", [], ein, hookEnv(v)));
  assert.equal(a.stdout + b.stdout, "");
  assert.equal(zeilen(join(v, ".logs", "hooks.log")).filter((l) => l.includes("kompakt-sichern")).length, 1);
  assert.ok(existsSync(join(v, ".logs", "sitzungen", "s-kompakt.md")));
});

// ------------------------------------------------------------------------------------------ werkzeug-protokoll
test("werkzeug-protokoll: zwei gleichzeitige Aufrufe mit derselben tool_use_id → eine Zeile; neue tool_use_id → eigene Zeile", async () => {
  const v = tempVault();
  const ein = (id) => ({ session_id: "s-werk", tool_name: "mcp__lager__bestand", tool_input: { sku: "A1" }, tool_use_id: id });
  await gleichzeitig(starte("werkzeug-protokoll.mjs", [], ein("toolu_1"), hookEnv(v)), starte("werkzeug-protokoll.mjs", [], ein("toolu_1"), hookEnv(v)));
  assert.equal(zeilen(join(v, ".logs", "werkzeug.log")).length, 1, "doppelte Registrierung → eine Zeile");
  await starte("werkzeug-protokoll.mjs", [], ein("toolu_2"), hookEnv(v));
  assert.equal(zeilen(join(v, ".logs", "werkzeug.log")).length, 2, "gleiches Werkzeug, aber ein neuer Aufruf (andere tool_use_id) zählt");
});

// ------------------------------------------------------------------------------------------ regeln-lesen
test("regeln-lesen: zwei gleichzeitige Aufrufe → die Lektion kommt nur einmal in den Kontext", async () => {
  const v = tempVault();
  writeFileSync(join(v, "09_wiki", "_lektionen.md"), "# Lektionen\n\n- **Swift bauen** — Swift-Dateien nur mit `xcrun swift build` bauen.\n  Gilt für: `*.swift`\n");
  const ein = { session_id: "s-regeln", tool_name: "Read", tool_input: { file_path: join(TEMP_HOME, "App.swift") }, tool_use_id: "toolu_r1", cwd: v };
  const [a, b] = await gleichzeitig(starte("regeln-lesen.mjs", [], ein, hookEnv(v)), starte("regeln-lesen.mjs", [], ein, hookEnv(v)));
  const aus = [a.stdout, b.stdout].filter(Boolean);
  assert.equal(aus.length, 1, `genau ein Aufruf spielt die Regel ein: [${a.stdout}] [${b.stdout}]`);
  assert.match(JSON.parse(aus[0]).hookSpecificOutput.additionalContext, /Swift bauen/);
});

// ------------------------------------------------------------------------------------------ ernte-ausloeser
test("ernte-ausloeser: zwei gleichzeitige Aufrufe → Ernte, W7 und Auswerter starten je einmal; SessionEnd und PreCompact bleiben getrennt", async () => {
  const v = tempVault();
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ automatik: { ernteSitzungsende: true, lektionen: "lokal" } }));
  const tr = join(tempOrdner("tr"), "s.jsonl");
  schreibeVerlauf(tr, [nutzer("Frage"), assistent("Antwort")]);
  const fake = join(tempOrdner("fake"), "fake.mjs");
  writeFileSync(fake, `import { appendFileSync } from "node:fs"; appendFileSync(process.env.FAKE_LOG, process.argv[1].split(/[\\\\/]/).pop() + "\\n");\n`);
  const log = join(tempOrdner("log"), "starts.txt");
  const env = hookEnv(v, { BRAIN_ERNTE_SKRIPT: fake, BRAIN_W7_SKRIPT: fake, BRAIN_LEKTIONEN_SKRIPT: fake, FAKE_LOG: log });
  const ende = { session_id: "s-ernte", transcript_path: tr, cwd: v, hook_event_name: "SessionEnd" };
  const warte = async (n) => { for (let i = 0; i < 80 && zeilen(log).length < n; i++) await new Promise((r) => setTimeout(r, 50)); await new Promise((r) => setTimeout(r, 400)); return zeilen(log).length; };
  const [a, b] = await gleichzeitig(starte("ernte-ausloeser.mjs", ["--art", "fakt"], ende, env), starte("ernte-ausloeser.mjs", ["--art", "fakt"], ende, env));
  assert.equal(a.stdout + b.stdout + a.stderr + b.stderr, "");
  assert.equal(await warte(3), 3, "ein Lauf = Ernte + W7 + Auswerter, nicht sechs");
  await starte("ernte-ausloeser.mjs", ["--art", "fakt"], { ...ende, hook_event_name: "PreCompact" }, env);
  assert.equal(await warte(6), 6, "PreCompact derselben Sitzung ist ein anderes Ereignis");
});
