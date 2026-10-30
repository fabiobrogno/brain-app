// Frag deinen Vault (P4, docs/plaene/ki-konten.md §4): Route, Streaming-Stand (Long-Poll), Abbruch, Grenzen, Konto- und Vault-Prüfung, Quellen, „nichts wird gespeichert“, Umgebung.
// Nie das echte `claude`: Tests/Kern/fake-claude-frage.mjs parst die Argumente streng wie die echte CLI, prüft die Schutzgeländer (Exit 4 bei Verletzung) und startet den
// ECHTEN brain-mcp.mjs aus --mcp-config. Jede Kindprozess-Umgebung kommt aus baueTestUmgebung (HOME, Support, PATH im Temp-Ordner); der Test ändert process.env nicht.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { writeFileSync, mkdirSync, realpathSync, readFileSync, existsSync, readdirSync, statSync, chmodSync, rmSync } from "node:fs";
import { join, relative, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { tmp, schreibe, pfad, echt } from "./hilfe.mjs";
import { baueTestUmgebung } from "./ki-konten-hilfe.mjs";

const K = await import(pfad("gemeinsam", "ki-konten.mjs"));
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
const { baueClaudeArgs, GRENZEN, baueFrageUmgebung } = await import(pfad("werkstatt", "frage.mjs"));
const { beendeAlleProzesse } = await import(pfad("gemeinsam", "prozess.mjs"));
const FAKE = fileURLToPath(new URL("../Kern/fake-claude-frage.mjs", import.meta.url));
after(() => { beendeAlleProzesse(); });

const frei = (p) => { try { process.kill(Number(p), 0); return false; } catch { return true; } }; // true = Prozess gibt es nicht mehr
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
async function bis(f, ms = 8000, text = "Bedingung") {
  const ende = Date.now() + ms;
  for (;;) { const w = await f(); if (w) return w; if (Date.now() > ende) assert.fail(`${text}: nicht rechtzeitig erfüllt`); await warte(25); }
}

// Ein Vault mit zwei Seiten, zwei Claude-Konten (A: „max“, nicht Standard · B gesperrt), einem Codex-Konto und dem Standard-Claude-Konto; alles unter dem Temp-Ordner.
function szenario({ grenzen = {}, mitClaude = true, stufeA = "lesen", tempImVault = false } = {}) {
  const home = realpathSync(tmp("brain-home-")), support = realpathSync(tmp("brain-support-")), bin = realpathSync(tmp("brain-bin-")), temp = realpathSync(tmp("brain-frage-temp-"));
  const vault = realpathSync(tmp("vault-")), anderer = realpathSync(tmp("vault-zwei-"));
  for (const v of [vault, anderer]) schreibe(v, "brain.config.json", "{}\n");
  schreibe(vault, "09_wiki/wissen/Kaffee.md", "---\ntitel: Kaffee\nstand: 2026-10-01\n---\n# Kaffee\n\nKaffee ist ein Heißgetränk aus gerösteten Bohnen.\n");
  schreibe(vault, "09_wiki/wissen/Mühle.md", "# Mühle\n\nEine Kaffeemühle mahlt Bohnen. Siehe [[Kaffee]].\n");
  schreibe(vault, "10_notizen/Reise.md", "# Reise\n\nFlug im Mai.\n");
  schreibe(anderer, "09_wiki/x/zwei.md", "# Zwei\n\nGeheim-Zwei.\n");
  const profil = (n) => { const p = join(home, n); mkdirSync(p, { recursive: true }); writeFileSync(join(p, "settings.json"), "{}"); return realpathSync(p); };
  const a = profil(".claude-a"), b = profil(".claude-b"), std = profil(".claude");
  const codex = join(home, ".codex"); mkdirSync(codex); writeFileSync(join(codex, "config.toml"), ""); const codexReal = realpathSync(codex);
  writeFileSync(join(support, "vaults.json"), JSON.stringify({ vaults: [{ name: "Eins", pfad: vault, farbe: "#5B8DEF" }, { name: "Zwei", pfad: anderer, farbe: "#E5734F" }], aktiv: vault }));
  const ein = (id, programm, ordner, name, extra = {}) => [id, { programm, ordner, standard: false, name, ordnerKennung: K.kennungVon(ordner), ...extra }];
  const setze = (stufen) => K.aendere(support, () => ({ version: 1,
    konten: Object.fromEntries([ein("k_aaaaaaaa", "claude", a, "Arbeit", { abo: "max" }), ein("k_bbbbbbbb", "claude", b, "Geheimkonto"), ein("k_cccccccc", "codex", codexReal, "CodexKonto"),
      ein("k_dddddddd", "claude", std, "Standard", { standard: true, abo: "api" })]),
    vaults: { [vault]: { ordnerKennung: K.kennungVon(vault), neueKonten: "gesperrt", ohneKonto: "gesperrt", konten: { k_aaaaaaaa: stufen.a, k_bbbbbbbb: "gesperrt", k_cccccccc: "lesen", k_dddddddd: stufen.d || "posteingang" } },
      [anderer]: { ordnerKennung: K.kennungVon(anderer), neueKonten: "gesperrt", ohneKonto: "gesperrt", konten: { k_aaaaaaaa: "lesen", k_bbbbbbbb: "gesperrt", k_cccccccc: "gesperrt", k_dddddddd: "lesen" } } } }));
  setze({ a: stufeA });
  // `claude` als Mini-Skript, das die Attrappe lädt; Szenario, Protokoll und PIDs liegen im bin-Ordner
  if (mitClaude) {
    writeFileSync(join(bin, "claude"), `#!${process.execPath}\nglobalThis.FAKE_ORDNER = ${JSON.stringify(bin)};\nimport(${JSON.stringify("file://" + FAKE)}).catch((e) => { console.error(String(e && e.stack || e)); process.exit(70); });\n`);
    chmodSync(join(bin, "claude"), 0o755);
  }
  const env = baueTestUmgebung({ HOME: home, BRAIN_APP_SUPPORT: support, PATH: `${bin}:/usr/bin:/bin`, BRAIN_CLAUDE_EXTRA: "" });
  const h = erzeugeHandler({ vault, vaultOptionen: { support }, kontenHome: home, kontenErkennung: () => [], frageEnv: env, frageGrenzen: grenzen, frageTemp: tempImVault ? (mkdirSync(join(vault, "tmp-in")), join(vault, "tmp-in")) : temp });
  const api = async (methode, p, daten) => {
    const q = p.indexOf("?");
    const r = await h({ methode, pfad: q < 0 ? p : p.slice(0, q), query: q < 0 ? null : p.slice(q + 1), body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) });
    let j = null; try { j = JSON.parse(r.body.toString("utf8")); } catch { /* statisch */ }
    return { status: r.status, j };
  };
  const szen = (o) => writeFileSync(join(bin, "szenario.json"), JSON.stringify(o));
  const aufrufe = () => (existsSync(join(bin, "aufrufe.jsonl")) ? readFileSync(join(bin, "aufrufe.jsonl"), "utf8").trim().split("\n").map((z) => JSON.parse(z)) : []);
  // Vault-Inhalt als Liste „Pfad Größe Zeit“ (auch versteckte Ordner wie .logs), um zu zeigen, dass nichts entsteht
  const abbild = (wurzel) => { const r = []; const geh = (d) => { for (const n of readdirSync(d, { withFileTypes: true })) { const p = join(d, n.name); if (n.isDirectory()) { r.push(`${relative(wurzel, p)}/`); geh(p); } else { const s = statSync(p); r.push(`${relative(wurzel, p)} ${s.size} ${s.mtimeMs}`); } } }; geh(wurzel); return r.sort(); };
  // Eine Frage bis zum Ende laufen lassen (Long-Poll wie das Studio): → letzter Stand mit allen Ereignissen
  async function frage(text, { konto = "k_aaaaaaaa", modell } = {}) {
    const s = await api("POST", "/api/frage/start", { frage: text, konto, ...(modell ? { modell } : {}) });
    assert.equal(s.status, 200, JSON.stringify(s.j));
    return { id: s.j.id, ...(await folge(s.j.id)) };
  }
  async function folge(id) {
    let ab = 0, textAb = 0, epoche = 0, text = "", ereignisse = [], letzter = null, runden = 0;
    for (;;) {
      const r = await api("GET", `/api/frage/stand?id=${id}&ab=${ab}&text=${textAb}&epoche=${epoche}`);
      assert.equal(r.status, 200, JSON.stringify(r.j));
      const j = r.j;
      if (j.epoche !== epoche) { text = j.text; epoche = j.epoche; } else text += j.text;
      textAb = j.textAb; ab = j.n; ereignisse = ereignisse.concat(j.ereignisse); letzter = j;
      if (j.fertig) return { ...j, text, ereignisse, runden };
      if (++runden > 400) assert.fail("Frage wird nicht fertig");
    }
  }
  return { home, support, bin, temp, vault, anderer, a, b, std, h, api, szen, aufrufe, abbild, frage, folge, setze, env };
}

test("Ablauf: Start → Stand (Long-Poll) → fertig; Antwort, Quellen nur aus dem Vault, Kosten; nichts im Vault, Temp-Ordner weg", async () => {
  const s = szenario();
  const vorher = s.abbild(s.vault);
  s.szen({ deltaMs: 15 });
  const r = await s.frage("Was ist Kaffee?");
  assert.equal(r.fertig, true);
  assert.equal(r.ergebnis.ok, true, JSON.stringify(r.ergebnis));
  assert.match(r.ergebnis.text, /Aus \[\[09_wiki\/wissen\/(Kaffee|Mühle)\.md\]\]/);
  assert.equal(r.text, r.ergebnis.text, "der gestreamte Text ist am Ende die fertige Antwort");
  assert.ok(r.runden >= 2, "die Antwort kam in mehreren Abrufen");
  assert.deepEqual(r.ereignisse.map((e) => `${e.art}:${e.name}`), ["werkzeug:suchen", "werkzeug:lesen"]);
  assert.equal(r.ereignisse[0].detail, "Was ist Kaffee?");
  // Quellen: nur Seiten, die es im Vault gibt, mit Prüf-Stufe; die gelesene und genannte Seite zuerst
  assert.ok(r.quellen.length >= 1);
  for (const q of r.quellen) { assert.ok(existsSync(join(s.vault, q.pfad)), q.pfad); assert.ok(["gruen", "gelb", "rot", "ohne", "grau"].includes(q.stufe), q.stufe); assert.ok(q.titel); }
  assert.equal(r.quellen[0].art, "genannt");
  // Kosten und Tokens aus dem result
  assert.equal(r.ergebnis.kosten, 0.0123);
  assert.deepEqual(r.ergebnis.tokens, { eingabe: 1200, ausgabe: 150, cacheSchreiben: 300, cacheLesen: 4000 });
  assert.equal(r.ergebnis.zuege, 3);
  // Nichts wird gespeichert: kein neuer Pfad im Vault (auch kein .logs/mcp.log), Temp-Ordner der Frage ist weg
  assert.deepEqual(s.abbild(s.vault), vorher, "im Vault ist nichts entstanden oder verändert");
  assert.deepEqual(readdirSync(s.temp), [], "der Temp-Ordner der Frage ist aufgeräumt");
  // Die Antwort ist nur im Speicher: eine neue Frage ersetzt sie, die alte id gibt es dann nicht mehr
  s.szen({});
  const r2 = await s.frage("Reise?");
  assert.equal(r2.ergebnis.ok, true);
  assert.equal((await s.api("GET", `/api/frage/stand?id=${r.id}`)).status, 404);
});

test("Aufruf: genau die dokumentierten Optionen, Frage über stdin, cwd leer und außerhalb des Vaults, Umgebung nur aus der erlaubten Liste", async () => {
  const s = szenario();
  const r = await s.frage("Wer ist Kaffee?", { konto: "k_aaaaaaaa", modell: "mittel" });
  assert.equal(r.ergebnis.ok, true, JSON.stringify(r.ergebnis));
  const [a] = s.aufrufe();
  assert.deepEqual(a.verletzt, []);
  assert.equal(a.stdin, "Wer ist Kaffee?");
  assert.ok(!a.args.some((x) => x.includes("Wer ist Kaffee")), "die Frage steht nicht in den Argumenten (nicht in ps sichtbar)");
  const opt = (n) => a.args[a.args.indexOf(n) + 1];
  assert.equal(opt("--model"), "sonnet");
  assert.equal(opt("--tools"), "");
  assert.equal(opt("--output-format"), "stream-json");
  for (const f of ["-p", "--verbose", "--include-partial-messages", "--strict-mcp-config", "--no-session-persistence", "--disable-slash-commands"]) assert.ok(a.args.includes(f), f);
  assert.equal(opt("--permission-mode"), "dontAsk");
  assert.deepEqual(JSON.parse(opt("--settings")), { disableAllHooks: true, autoMemoryEnabled: false });
  assert.equal(opt("--max-turns"), "10");
  assert.equal(opt("--max-budget-usd"), "1", "mittleres Modell: 1 $");
  assert.equal(opt("--setting-sources"), "user");
  assert.equal(opt("--allowedTools"), "mcp__brain__brain_suchen,mcp__brain__brain_lesen,mcp__brain__brain_kontext");
  const mcp = JSON.parse(opt("--mcp-config")).mcpServers;
  assert.deepEqual(Object.keys(mcp), ["brain"]);
  assert.deepEqual(mcp.brain.args.slice(-5), ["--konto", "k_aaaaaaaa", "--vault", s.vault, "--nur-lesen"]);
  assert.equal(mcp.brain.env.BRAIN_NUTZUNG, "aus");
  assert.equal(mcp.brain.env.BRAIN_APP_SUPPORT, s.support);
  assert.equal(mcp.brain.env.CLAUDE_CONFIG_DIR, s.a, "der MCP-Server sieht dasselbe Konto wie Claude Code");
  // cwd: ein leerer Ordner im Temp-Ordner, nicht der Vault
  assert.ok(a.cwd.startsWith(s.temp) && !a.cwd.startsWith(s.vault));
  // Umgebung: nichts außer der ausdrücklichen Liste (die Testumgebung selbst hat viel mehr: npm_*, NODE_*, evtl. ANTHROPIC_API_KEY …)
  const ERLAUBT = new Set(["PATH", "HOME", "LANG", "TMPDIR", "NODE_EXTRA_CA_CERTS", "CLAUDE_CONFIG_DIR", "BRAIN_ERNTE", "BRAIN_TESTMODUS", "CLAUDE_CODE_DISABLE_CLAUDE_MDS", "CLAUDE_CODE_DISABLE_AUTO_MEMORY", "__CF_USER_TEXT_ENCODING"]); // letzteres fügt macOS jedem Kindprozess selbst hinzu
  assert.deepEqual(a.envSchluessel.filter((k) => !ERLAUBT.has(k)), [], "keine fremde Variable in der Umgebung");
  assert.equal(a.claudeConfigDir, s.a);
});

test("Umgebung: Standard-Konto ohne CLAUDE_CONFIG_DIR; ein geerbtes CLAUDE_CONFIG_DIR der Werkstatt wirkt nie; HOME und PATH sind ausdrücklich", async () => {
  const s = szenario();
  const r = await s.frage("Kaffee?", { konto: "k_dddddddd" });
  assert.equal(r.ergebnis.ok, true, JSON.stringify(r.ergebnis));
  const [a] = s.aufrufe();
  assert.equal(a.claudeConfigDir, null);
  assert.ok(!a.envSchluessel.includes("CLAUDE_CONFIG_DIR"));
  // reine Funktion: ein geerbtes CLAUDE_CONFIG_DIR (fremdes Konto) verschwindet; ein fremder Schlüssel kommt nicht durch
  const e = baueFrageUmgebung({ basis: { PATH: "/usr/bin:relativ:", CLAUDE_CONFIG_DIR: "/fremd", ANTHROPIC_API_KEY: "geheim", GITHUB_TOKEN: "geheim", BRAIN_VAULT: "/x", LANG: "de_DE.UTF-8" }, home: s.home, claudePfad: join(s.bin, "claude"), konto: { ordner: s.std, standard: true } });
  assert.deepEqual(Object.keys(e).sort(), ["BRAIN_ERNTE", "CLAUDE_CODE_DISABLE_AUTO_MEMORY", "CLAUDE_CODE_DISABLE_CLAUDE_MDS", "HOME", "LANG", "PATH"]);
  assert.equal(e.PATH, `${s.bin}:/usr/bin:/usr/bin:/bin`, "ein relativer PATH-Eintrag fällt weg");
  assert.equal(e.HOME, s.home); assert.equal(e.LANG, "de_DE.UTF-8"); assert.equal(e.BRAIN_ERNTE, "1");
  assert.ok(!JSON.stringify(e).includes("geheim"));
});

test("Long-Poll: ohne Neues wartet der Stand, mit ab bekommt man nur Neues; fremde und unbekannte ids gibt es nicht", async () => {
  const s = szenario();
  s.szen({ warteMs: 30000 });
  const st = await s.api("POST", "/api/frage/start", { frage: "Kaffee?", konto: "k_aaaaaaaa" });
  const id = st.j.id;
  assert.match(id, /^[0-9a-f]{32}$/, "zufällige id");
  await bis(() => existsSync(join(s.bin, "wartet")), 8000, "Attrappe wartet");
  const erst = await s.api("GET", `/api/frage/stand?id=${id}&ab=0&text=0&epoche=0`);
  assert.equal(erst.j.fertig, false);
  const t0 = Date.now();
  const zweit = await s.api("GET", `/api/frage/stand?id=${id}&ab=${erst.j.n}&text=${erst.j.textAb}&epoche=${erst.j.epoche}`);
  const dauer = Date.now() - t0;
  assert.ok(dauer >= 600 && dauer < 2500, `der Long-Poll wartet etwa 800 ms (war ${dauer})`);
  assert.deepEqual(zweit.j.ereignisse, []);
  assert.equal(zweit.j.text, "");
  // fremde / ausgedachte ids
  assert.equal((await s.api("GET", "/api/frage/stand?id=0123456789abcdef0123456789abcdef")).status, 404);
  assert.equal((await s.api("GET", "/api/frage/stand")).status, 404);
  assert.equal((await s.api("POST", "/api/frage/abbrechen", { id: "x" })).status, 404);
  // ein anderer Vault kann die Frage nicht abrufen
  assert.equal((await s.api("POST", "/api/vaults/aktiv", { pfad: s.anderer })).status, 200);
  assert.equal((await s.api("GET", `/api/frage/stand?id=${id}`)).status, 404);
});

test("Abbruch: SIGINT beendet die Prozessgruppe samt MCP-Server, keine Waisen", async () => {
  const s = szenario();
  s.szen({ warteMs: 60000 });
  const st = await s.api("POST", "/api/frage/start", { frage: "Kaffee?", konto: "k_aaaaaaaa" });
  await bis(() => existsSync(join(s.bin, "wartet")), 8000, "Attrappe wartet");
  const pid = readFileSync(join(s.bin, "wartet"), "utf8"), mcp = readFileSync(join(s.bin, "mcp-pid"), "utf8");
  assert.equal(frei(pid), false); assert.equal(frei(mcp), false, "der MCP-Server läuft");
  const t0 = Date.now();
  assert.deepEqual((await s.api("POST", "/api/frage/abbrechen", { id: st.j.id })).j, { ok: true });
  const r = await s.folge(st.j.id);
  assert.equal(r.fertig, true);
  assert.equal(r.ergebnis.ok, false); assert.equal(r.ergebnis.abgebrochen, true); assert.equal(r.ergebnis.grund, "nutzer");
  assert.ok(Date.now() - t0 < 3500, "SIGINT genügt, kein Warten auf SIGTERM");
  await bis(() => frei(pid) && frei(mcp), 3000, "Prozesse beendet");
  assert.deepEqual(readdirSync(s.temp), []);
  // nochmaliges Abbrechen ist harmlos; danach geht eine neue Frage
  assert.deepEqual((await s.api("POST", "/api/frage/abbrechen", { id: st.j.id })).j, { ok: true, schonFertig: true });
  s.szen({});
  assert.equal((await s.frage("Kaffee?")).ergebnis.ok, true);
});

test("Abbruch eskaliert: ignoriert die Attrappe SIGINT, folgt nach 2 s SIGTERM; ignoriert sie auch das, nach 5 s SIGKILL", async () => {
  const s = szenario();
  s.szen({ warteMs: 60000, ignoriereSigint: true });
  let st = await s.api("POST", "/api/frage/start", { frage: "Kaffee?", konto: "k_aaaaaaaa" });
  await bis(() => existsSync(join(s.bin, "wartet")), 8000, "Attrappe wartet");
  let t0 = Date.now();
  await s.api("POST", "/api/frage/abbrechen", { id: st.j.id });
  let r = await s.folge(st.j.id);
  let dauer = Date.now() - t0;
  assert.equal(r.ergebnis.grund, "nutzer");
  assert.ok(dauer >= 1800 && dauer < 6000, `SIGTERM nach etwa 2 s (war ${dauer} ms)`);
  for (const n of ["wartet", "mcp-pid"]) rmSync(join(s.bin, n), { force: true });
  s.szen({ warteMs: 60000, ignoriereSigint: true, ignoriereSigterm: true });
  st = await s.api("POST", "/api/frage/start", { frage: "Kaffee?", konto: "k_aaaaaaaa" });
  await bis(() => existsSync(join(s.bin, "wartet")), 8000, "Attrappe wartet (2)");
  const pid = readFileSync(join(s.bin, "wartet"), "utf8"), mcp = readFileSync(join(s.bin, "mcp-pid"), "utf8");
  t0 = Date.now();
  await s.api("POST", "/api/frage/abbrechen", { id: st.j.id });
  r = await s.folge(st.j.id);
  dauer = Date.now() - t0;
  assert.ok(dauer >= 4500 && dauer < 10000, `SIGKILL nach etwa 5 s (war ${dauer} ms)`);
  await bis(() => frei(pid) && frei(mcp), 3000, "Prozesse beendet");
});

test("Grenzen: Frist, zu viel Ausgabe, zu lange Zeile, Länge der Frage, Leerlauf (Studio fragt nicht mehr nach)", async () => {
  // Frist
  let s = szenario({ grenzen: { frist: 600 } });
  s.szen({ warteMs: 60000 });
  let r = await s.frage("Kaffee?");
  assert.equal(r.ergebnis.grund, "frist"); assert.match(r.ergebnis.fehler, /zu lange/);
  // Ausgabe (40 × 60 KB > 1 MB)
  s = szenario();
  s.szen({ art: "gross", ohneMcp: true, mcpText: { brain_suchen: "1. 09_wiki/wissen/Kaffee.md — Kaffee [Notiz]\n" } });
  r = await s.frage("Kaffee?");
  assert.equal(r.ergebnis.grund, "ausgabe"); assert.match(r.ergebnis.fehler, /zu groß/);
  // eine einzige Zeile über 256 KB
  s = szenario();
  s.szen({ art: "lange-zeile", ohneMcp: true });
  r = await s.frage("Kaffee?");
  assert.equal(r.ergebnis.grund, "zeile");
  // Frage: leer / zu lang / kein Text
  s = szenario();
  for (const f of ["", "   ", "x".repeat(GRENZEN.frageMax + 1), 42, null]) {
    const x = await s.api("POST", "/api/frage/start", { frage: f, konto: "k_aaaaaaaa" });
    assert.equal(x.status, 400, String(f).slice(0, 20));
  }
  assert.equal((await s.api("POST", "/api/frage/start", { frage: "x".repeat(GRENZEN.frageMax), konto: "k_aaaaaaaa", modell: "riesig" })).status, 400, "unbekanntes Modell");
  assert.deepEqual(s.aufrufe(), [], "bei abgelehnter Eingabe startet nichts");
  // Leerlauf: niemand ruft den Stand ab → die Frage endet von selbst
  s = szenario({ grenzen: { leerlauf: 1500 } });
  s.szen({ warteMs: 60000 });
  const st = await s.api("POST", "/api/frage/start", { frage: "Kaffee?", konto: "k_aaaaaaaa" });
  await bis(() => existsSync(join(s.bin, "wartet")), 8000, "Attrappe wartet");
  const pid = readFileSync(join(s.bin, "wartet"), "utf8");
  await bis(() => frei(pid), 6000, "Leerlauf beendet die Frage");
  r = await s.folge(st.j.id);
  assert.equal(r.ergebnis.grund, "leerlauf");
});

test("Konto und Vault: nicht vertraut, gesperrtes, unbekanntes, fremdes (Codex) Konto, kein Claude, zweite Frage → 409/404 ohne Start", async () => {
  const s = szenario();
  const start = (konto, extra = {}) => s.api("POST", "/api/frage/start", { frage: "Kaffee?", konto, ...extra });
  // gesperrtes und unbekanntes Konto: dieselbe Antwort (nichts verrät, ob es das Konto gibt)
  const gesperrt = await start("k_bbbbbbbb"), unbekannt = await start("k_00000000"), ohne = await s.api("POST", "/api/frage/start", { frage: "Kaffee?" }), unsinn = await start({ x: 1 });
  for (const x of [gesperrt, unbekannt, ohne, unsinn]) { assert.equal(x.status, 409); assert.equal(x.j.art, "kein-zugriff"); }
  assert.equal(gesperrt.j.fehler, unbekannt.j.fehler);
  assert.ok(!JSON.stringify([gesperrt.j, unbekannt.j]).includes("Geheimkonto"));
  // Codex lässt sich nicht auf den Kortex-MCP beschränken → bisher nur Claude
  const codex = await start("k_cccccccc");
  assert.equal(codex.status, 409); assert.equal(codex.j.art, "programm");
  // nicht vertrauter Vault
  await echt(async () => {
    const t = szenario();
    const x = await t.api("POST", "/api/frage/start", { frage: "Kaffee?", konto: "k_aaaaaaaa" });
    assert.equal(x.status, 409); assert.equal(x.j.art, "nicht-vertraut");
    assert.deepEqual(t.aufrufe(), []);
    assert.equal((await t.api("GET", "/api/frage/bereit")).j.vertraut, false);
  });
  // Stufe entzogen wirkt sofort (ohne Neustart)
  s.setze({ a: "gesperrt" });
  assert.equal((await start("k_aaaaaaaa")).j.art, "kein-zugriff");
  s.setze({ a: "lesen" });
  // kein claude im Suchpfad
  const ohneClaude = szenario({ mitClaude: false });
  const k = await ohneClaude.api("POST", "/api/frage/start", { frage: "Kaffee?", konto: "k_aaaaaaaa" });
  assert.equal(k.status, 404); assert.equal(k.j.art, "kein-claude");
  assert.equal((await ohneClaude.api("GET", "/api/frage/bereit")).j.claude, false);
  assert.deepEqual(s.aufrufe(), [], "bis hierher wurde kein Prozess gestartet");
  // höchstens eine Frage zugleich
  s.szen({ warteMs: 60000 });
  const erste = await start("k_aaaaaaaa");
  assert.equal(erste.status, 200);
  const zweite = await start("k_dddddddd");
  assert.equal(zweite.status, 409); assert.equal(zweite.j.art, "laeuft");
  await bis(() => existsSync(join(s.bin, "wartet")), 8000, "Attrappe wartet");
  assert.equal(s.aufrufe().length, 1, "die zweite Frage hat keinen zweiten Prozess gestartet");
  await s.api("POST", "/api/frage/abbrechen", { id: erste.j.id });
  await s.folge(erste.j.id);
  // die Stufen „posteingang“ und „erweitert“ dürfen fragen (≥ lesen); der Server deckelt sie mit --nur-lesen
  for (const stufe of ["posteingang", "erweitert"]) { s.setze({ a: stufe }); s.szen({ ohneMcp: true, mcpText: { brain_suchen: "Keine Treffer." } }); assert.equal((await s.frage("Kaffee?")).ergebnis.ok, true, stufe); }
});

test("bereit: nur erlaubte Konten (gesperrte kommen weder mit Namen noch als Zahl vor), Codex gekennzeichnet; Vertrauen und Programm", async () => {
  const s = szenario();
  const b = (await s.api("GET", "/api/frage/bereit")).j;
  assert.equal(b.vault, basename(s.vault));
  assert.equal(b.claude, true); assert.equal(b.vertraut, true); assert.equal(b.kontenDefekt, false); assert.equal(b.laeuft, false);
  assert.deepEqual(b.konten.map((k) => k.id).sort(), ["k_aaaaaaaa", "k_cccccccc", "k_dddddddd"]);
  assert.equal(b.konten.find((k) => k.id === "k_aaaaaaaa").abo, "max");
  assert.equal(b.konten.find((k) => k.id === "k_cccccccc").erlaubt, false);
  assert.equal(b.konten.find((k) => k.id === "k_cccccccc").grund, "programm");
  assert.ok(!JSON.stringify(b).includes("Geheimkonto") && !JSON.stringify(b).includes("k_bbbbbbbb"));
  assert.ok(!JSON.stringify(b).includes(s.home), "keine Ordnerpfade der Konten");
  s.setze({ a: "gesperrt", d: "gesperrt" });
  assert.deepEqual((await s.api("GET", "/api/frage/bereit")).j.konten.map((k) => k.id), ["k_cccccccc"]);
});

test("Vault-Wechsel bricht eine laufende Frage ab; der Kindprozess samt MCP-Server endet", async () => {
  const s = szenario();
  s.szen({ warteMs: 60000 });
  const st = await s.api("POST", "/api/frage/start", { frage: "Kaffee?", konto: "k_aaaaaaaa" });
  await bis(() => existsSync(join(s.bin, "wartet")), 8000, "Attrappe wartet");
  const pid = readFileSync(join(s.bin, "wartet"), "utf8"), mcp = readFileSync(join(s.bin, "mcp-pid"), "utf8");
  assert.equal((await s.api("POST", "/api/vaults/aktiv", { pfad: s.anderer })).status, 200);
  await bis(() => frei(pid) && frei(mcp), 4000, "Prozesse beendet");
  // zurück: Die Frage gehört zum alten Vault und ist beendet; eine neue geht
  assert.equal((await s.api("POST", "/api/vaults/aktiv", { pfad: s.vault })).status, 200);
  const r = await s.folge(st.j.id);
  assert.equal(r.ergebnis.grund, "vault");
  s.szen({});
  assert.equal((await s.frage("Kaffee?")).ergebnis.ok, true);
});

test("Quellen: erfundene Pfade erscheinen nicht, [[Name]] wird aufgelöst, Verweise und Zahl der nicht gefundenen stehen im Stand", async () => {
  const s = szenario();
  s.szen({ ohneMcp: true, mcpText: { brain_suchen: "1. 09_wiki/wissen/Kaffee.md — Kaffee [Belegt]\n   Z.5: Kaffee\n2. 10_notizen/Reise.md — Reise [Notiz]\n   Z.3: Flug\n3. 09_wiki/gibt-es-nicht.md — Erfunden [Notiz]\n   Z.1: x\nWeiter: brain_lesen mit abschnitt oder von/bis." },
    lesen: [], antwort: "Siehe [[Mühle]] und [[09_wiki/wissen/Kaffee.md|Kaffee]] sowie [[09_wiki/erfunden.md]] und [[../../etc/passwd]]." });
  const r = await s.frage("Kaffee?");
  assert.equal(r.ergebnis.ok, true);
  assert.deepEqual(r.verweise, { "Mühle": "09_wiki/wissen/Mühle.md", "09_wiki/wissen/Kaffee.md|Kaffee": "09_wiki/wissen/Kaffee.md", "09_wiki/erfunden.md": null, "../../etc/passwd": null });
  assert.equal(r.unbekannt, 2);
  const pfade = r.quellen.map((q) => q.pfad);
  assert.deepEqual(pfade.filter((p) => r.quellen.find((q) => q.pfad === p).art === "genannt").sort(), ["09_wiki/wissen/Kaffee.md", "09_wiki/wissen/Mühle.md"]);
  assert.ok(pfade.includes("10_notizen/Reise.md"), "ein Suchtreffer erscheint als „gefunden“");
  assert.equal(r.quellen.find((q) => q.pfad === "10_notizen/Reise.md").art, "gefunden");
  assert.ok(!pfade.some((p) => /gibt-es-nicht|erfunden|passwd/.test(p)), "was es im Vault nicht gibt, ist keine Quelle");
});

test("Ergebnisse: Fehler von Claude Code, Programmabsturz, Limit der Arbeitsschritte, nicht erlaubtes Werkzeug", async () => {
  const s = szenario();
  s.szen({ art: "fehler", ohneMcp: true, mcpText: { brain_suchen: "Keine Treffer." }, lesen: [] });
  let r = await s.frage("Kaffee?");
  assert.equal(r.ergebnis.ok, false); assert.match(r.ergebnis.fehler, /Invalid API key/); assert.equal(r.ergebnis.abgebrochen, undefined);
  s.szen({ art: "kaputt", ohneMcp: true });
  r = await s.frage("Kaffee?");
  assert.equal(r.ergebnis.ok, false); assert.match(r.ergebnis.fehler, /mit einem Fehler beendet.*schiefgelaufen/);
  s.szen({ art: "max-turns", ohneMcp: true, mcpText: { brain_suchen: "Keine Treffer." }, lesen: [] });
  r = await s.frage("Kaffee?");
  assert.equal(r.ergebnis.ok, false); assert.match(r.ergebnis.fehler, /Limit an Arbeitsschritten/);
  s.szen({ art: "unerlaubt", ohneMcp: true, mcpText: { brain_suchen: "Keine Treffer." }, lesen: [] });
  r = await s.frage("Kaffee?");
  assert.equal(r.ergebnis.ok, true); assert.equal(r.ergebnis.abgelehnt, 1);
  assert.ok(r.ereignisse.some((e) => e.art === "werkzeug" && e.name === "abgelehnt" && e.detail === undefined), "ein nicht erlaubtes Werkzeug wird gemeldet, ohne den Befehl zu nennen");
});

test("Zwischentext vor Werkzeugaufrufen verschwindet (neue Epoche); ohne stream_event wird der Text der fertigen Nachricht genommen", async () => {
  const s = szenario();
  s.szen({ art: "nur-text", ohneMcp: true, mcpText: { brain_suchen: "1. 09_wiki/wissen/Kaffee.md — Kaffee [Belegt]\n" }, lesen: ["09_wiki/wissen/Kaffee.md"], antwort: "Kaffee ist Kaffee. [[09_wiki/wissen/Kaffee.md]]" });
  const r = await s.frage("Kaffee?");
  assert.equal(r.ergebnis.ok, true);
  assert.equal(r.text, "Kaffee ist Kaffee. [[09_wiki/wissen/Kaffee.md]]");
});

test("Der Aufruf von claude ist eine Argumentliste (keine Shell): Anführungszeichen, Leerzeichen und Zeilenumbrüche in Vault-Pfad und Frage bleiben, wie sie sind", async () => {
  const args = baueClaudeArgs({ modell: "haiku", mcpKonfig: { mcpServers: { brain: { command: "/n", args: ["x", "--vault", "/tmp/a b/'c\"$(x)`y"] } } } });
  assert.ok(Array.isArray(args) && args.every((x) => typeof x === "string"));
  assert.ok(args.includes(JSON.stringify({ mcpServers: { brain: { command: "/n", args: ["x", "--vault", "/tmp/a b/'c\"$(x)`y"] } } })));
  const s = szenario();
  s.szen({ ohneMcp: true, mcpText: { brain_suchen: "Keine Treffer." }, lesen: [] });
  const frage = "Was ist \"Kaffee\"?\n$(touch /tmp/kortex-test-nie) `x` ; rm -rf ~ '\\";
  const r = await s.frage(frage);
  assert.equal(r.ergebnis.ok, true, JSON.stringify(r.ergebnis));
  assert.equal(s.aufrufe()[0].stdin, frage);
  assert.equal(existsSync("/tmp/kortex-test-nie"), false);
});

test("Kosten und Runden: klein 0,25 $, mittel 1 $, höchstens 10 Runden; Limit erreicht → freundliche Meldung, der bisherige Text bleibt", async () => {
  const s = szenario();
  s.szen({ ohneMcp: true, mcpText: { brain_suchen: "Keine Treffer." }, lesen: [], art: "max-turns", antwort: "Zwischenstand zur Frage." });
  const r = await s.frage("Kaffee?");
  const opt = (n) => s.aufrufe()[0].args[s.aufrufe()[0].args.indexOf(n) + 1];
  assert.equal(opt("--model"), "haiku"); assert.equal(opt("--max-budget-usd"), "0.25"); assert.equal(opt("--max-turns"), "10");
  assert.equal(r.ergebnis.ok, false);
  assert.match(r.ergebnis.fehler, /Die Frage war zu umfangreich – frage genauer/);
  assert.equal(r.text, "Zwischenstand zur Frage.", "der bisher geschriebene Text bleibt stehen");
  assert.match(baueClaudeArgs({ modell: "haiku", mcpKonfig: {} }).at(-1), /höchstens 4 Seiten/);
});

test("Temp-Ordner wird bei einem frühen Fehler wieder gelöscht (hier: er läge im Vault)", async () => {
  const s = szenario({ tempImVault: true });
  const x = await s.api("POST", "/api/frage/start", { frage: "Kaffee?", konto: "k_aaaaaaaa" });
  assert.equal(x.status, 500);
  assert.deepEqual(readdirSync(join(s.vault, "tmp-in")), [], "kein kortex-frage-Ordner bleibt liegen");
  assert.deepEqual(s.aufrufe(), []);
});

test("Nach dem Abbruch ist sofort eine neue Frage möglich (Vault-Wechsel), auch wenn der alte Prozess noch endet", async () => {
  const s = szenario();
  s.szen({ warteMs: 60000, ignoriereSigint: true, ignoriereSigterm: true });
  const st = await s.api("POST", "/api/frage/start", { frage: "Kaffee?", konto: "k_aaaaaaaa" });
  await bis(() => existsSync(join(s.bin, "wartet")), 8000, "Attrappe wartet");
  const pid = readFileSync(join(s.bin, "wartet"), "utf8");
  assert.equal((await s.api("POST", "/api/vaults/aktiv", { pfad: s.anderer })).status, 200);
  s.szen({ ohneMcp: true, mcpText: { brain_suchen: "Keine Treffer." }, lesen: [] });
  const t0 = Date.now();
  const neu = await s.api("POST", "/api/frage/start", { frage: "Zwei?", konto: "k_aaaaaaaa" });
  assert.equal(neu.status, 200, JSON.stringify(neu.j));
  assert.ok(Date.now() - t0 < 1500, "keine Sperre durch die endende Frage");
  assert.equal((await s.folge(neu.j.id)).ergebnis.ok, true);
  // dasselbe im selben Vault: ein Abbruch gibt die Sperre sofort frei
  s.szen({ warteMs: 60000, ignoriereSigint: true, ignoriereSigterm: true });
  rmSync(join(s.bin, "wartet"), { force: true });
  const a = await s.api("POST", "/api/frage/start", { frage: "Drei?", konto: "k_aaaaaaaa" });
  await bis(() => existsSync(join(s.bin, "wartet")), 8000, "Attrappe wartet (2)");
  await s.api("POST", "/api/frage/abbrechen", { id: a.j.id });
  s.szen({ ohneMcp: true, mcpText: { brain_suchen: "Keine Treffer." }, lesen: [] });
  assert.equal((await s.api("POST", "/api/frage/start", { frage: "Vier?", konto: "k_aaaaaaaa" })).status, 200);
  beendeAlleProzesse();
  await bis(() => frei(pid), 4000, "alter Prozess beendet");
});

// Die Werkstatt endet (App beendet, stdin zu, /api/stopp, SIGTERM): `claude` samt MCP-Server darf nicht als Waise weiterlaufen — auch wenn er SIGINT und SIGTERM ignoriert.
for (const weg of ["stopp", "stdin", "sigterm"]) {
  test(`Werkstatt-Ende (${weg}) beendet eine laufende Frage samt Prozessgruppe, auch wenn claude SIGINT und SIGTERM ignoriert`, async () => {
    const s = szenario();
    const vertrauen = await import(pfad("gemeinsam", "vertrauen.mjs"));
    vertrauen.erlaube(s.vault, { support: s.support, quelle: "angelegt" });
    s.szen({ warteMs: 120000, ignoriereSigint: true, ignoriereSigterm: true });
    const p = spawn(process.execPath, [pfad("werkstatt", "werkstatt.mjs"), s.vault], { stdio: ["pipe", "pipe", "pipe"], env: s.env });
    const wartende = new Map(); let n = 0, bereit = null;
    const fertig = new Promise((ok) => bereit = ok);
    createInterface({ input: p.stdout }).on("line", (z) => { const o = JSON.parse(z); if (o.bereit) bereit(); else wartende.get(o.id)?.(o); });
    p.stderr.on("data", () => {});
    const ende = new Promise((ok) => p.on("exit", (code, sig) => ok({ code, sig })));
    await fertig;
    const rufe = (methode, pf, daten) => new Promise((ok) => { const id = ++n; wartende.set(id, ok); p.stdin.write(JSON.stringify({ id, methode, pfad: pf, query: null, body: daten === undefined ? null : Buffer.from(JSON.stringify(daten)).toString("base64") }) + "\n"); });
    const st = await rufe("POST", "/api/frage/start", { frage: "Kaffee?", konto: "k_aaaaaaaa" });
    assert.equal(st.status, 200, Buffer.from(st.body, "base64").toString());
    await bis(() => existsSync(join(s.bin, "wartet")), 10000, "Attrappe wartet");
    const pid = readFileSync(join(s.bin, "wartet"), "utf8"), mcp = readFileSync(join(s.bin, "mcp-pid"), "utf8");
    assert.equal(frei(pid), false);
    if (weg === "stopp") await rufe("POST", "/api/stopp", {});
    else if (weg === "stdin") p.stdin.end();
    else p.kill("SIGTERM");
    const e = await Promise.race([ende, warte(10000).then(() => ({ code: "haengt" }))]);
    assert.notEqual(e.code, "haengt", "die Werkstatt endet");
    await bis(() => frei(pid) && frei(mcp), 3000, "claude und MCP-Server sind weg (kein Waise)");
    try { p.kill("SIGKILL"); } catch { /* weg */ }
  });
}
