// Anmelden im Fenster (Paket E3): Kindprozess ohne Terminal mit gebauter Umgebung, Adresse/Code aus der Ausgabe, Fristen, Abbruch (Prozessgruppe), neues Konto erst nach Anmeldung.
// NUR Platzhalter für `claude` und `codex` (anmelden-hilfe.mjs) in Temp-Ordnern; nie ein echtes Programm, nie ein echtes Konto, nie der Schlüsselbund.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync, utimesSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmp, schreibe, pfad } from "./hilfe.mjs";
import { platzhalter, GEHEIM, GEHEIM_DATEI } from "./anmelden-hilfe.mjs";

for (const k of ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "CURSOR_CONFIG_DIR", "GEMINI_CLI_HOME", "XDG_CONFIG_HOME", "GIT_CONFIG_GLOBAL"]) delete process.env[k];
process.env.HOME = tmp("brain-home-");

const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
const A = await import(pfad("gemeinsam", "anmeldung.mjs"));

const neuesVault = () => { const d = tmp("brain-vault-"); schreibe(d, "brain.config.json", "{}\n"); schreibe(d, "00_inbox/n.md", "# N\n"); return realpathSync(d); };
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
async function bis(fn, ms = 6000) { const ende = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > ende) throw new Error("Zeit überschritten"); await warte(20); } }

// Auch nach einem fehlgeschlagenen Test endet alles Laufende (sonst hielten die Platzhalter den Testprozess offen).
const alle = [];
test.after(() => { for (const t of alle) { try { t.h.anmelden.beendeAlle(); } catch { /* egal */ } } });
// Eine Werkstatt mit Platzhaltern. Die Umgebung der Werkstatt ist absichtlich voller „Fremdvariablen“ (alle zeigen in den Temp-Ordner): keine darf im Kind landen.
function aufbau(szenario = {}, optionen = {}) {
  const p = platzhalter(szenario);
  const s = tmp("brain-support-"), v = neuesVault(), leck = tmp("brain-leck-");
  writeFileSync(join(s, "vaults.json"), JSON.stringify({ vaults: [{ name: "V", pfad: v, farbe: "#5B8DEF" }], aktiv: v }));
  const mcp = tmp("brain-mcpdir-"); schreibe(mcp, "brain-mcp.mjs", "//\n");
  const basis = { PATH: `${p.bin}:/usr/bin:/bin`, HOME: process.env.HOME, TERM: "xterm", LANG: "de_DE.UTF-8", BROWSER: "/bin/false",
    CLAUDE_CONFIG_DIR: leck, CODEX_HOME: leck, XDG_CONFIG_HOME: leck, XDG_DATA_HOME: leck, GIT_CONFIG_GLOBAL: join(leck, "gitconfig"), GIT_CONFIG_COUNT: "1",
    ANTHROPIC_API_KEY: "sk-ant-api-aus-der-werkstatt", OPENAI_API_KEY: "sk-aus-der-werkstatt", CLAUDE_CODE_OAUTH_TOKEN: "oauth-aus-der-werkstatt", CURSOR_CONFIG_DIR: leck,
    BRAIN_TESTMODUS: "1", KORTEX_VORSCHAU: "1", NODE_OPTIONS: "--no-warnings" };
  const protokoll = [];
  const h = erzeugeHandler({ vault: v, vaultOptionen: { support: s }, mcpPfad: join(mcp, "brain-mcp.mjs"),
    anmeldeOptionen: { findeProgramm: (n) => join(p.bin, n), basisUmgebung: () => basis, protokoll: (e) => protokoll.push(e), optionen: { takt: 30, fristen: { adresse: 2500, status: 4000 }, ...optionen } } });
  const antworten = [];
  const rufe = async (methode, pf, daten) => {
    const [weg, abfrage] = pf.split("?");
    const r = await h({ methode, pfad: weg, query: abfrage || null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) });
    const text = r.body.toString("utf8"); antworten.push(text);
    let j = null; try { j = JSON.parse(text); } catch { /* statisch */ }
    return { status: r.status, j };
  };
  const status = async (id) => (await rufe("GET", `/api/ki/anmeldelauf?id=${id}`)).j;
  const start = (daten) => rufe("POST", "/api/ki/anmeldelauf", daten);
  const warteAuf = (id, phasen) => bis(async () => { const z = await status(id); return phasen.includes(z.phase) ? z : null; });
  const staging = () => { try { return readdirSync(join(s, "ki-konten-ordner")).filter((n) => n.startsWith(".neu-")); } catch { return []; } };
  const konten = async () => (await rufe("GET", "/api/ki/konten")).j;
  const t = { p, s, h, leck, rufe, status, start, warteAuf, staging, konten, antworten, protokoll };
  alle.push(t);
  return t;
}
const lebt = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const umgebungen = (bin) => readdirSync(bin).filter((n) => n.startsWith("umgebung-")).map((n) => JSON.parse(readFileSync(join(bin, n), "utf8")));

test("Claude: neues Konto — Adresse über das BROWSER-Skript, Umgebung sauber, Konto erst nach der Anmeldung sichtbar, `.neu-…` danach weg", async () => {
  const t = aufbau({ modus: "ok", warteAufCode: true });
  const r = await t.start({ programm: "claude", neu: "Firma" });
  assert.equal(r.status, 200); assert.match(r.j.id, /^a_/);
  assert.equal(t.staging().length, 1, "der Ordner des neuen Kontos liegt unsichtbar bereit");
  const wait = await t.warteAuf(r.j.id, ["wait"]);
  assert.match(wait.url, /^https:\/\/claude\.ai\/oauth\/authorize\?/);
  assert.equal(wait.codeMoeglich, true); assert.equal(wait.code, null);
  assert.ok(wait.verbleibendMs > 0 && wait.verbleibendMs <= 600_000);
  const vorher = await t.konten();
  assert.ok(!Object.values(vorher.konten).some((k) => k.name === "Firma"), "vor der Anmeldung gibt es das Konto noch nicht");
  // Umgebung des Kindes
  const [env] = umgebungen(t.p.bin);
  const neuOrdner = join(t.s, "ki-konten-ordner", t.staging()[0]);
  assert.equal(env.konto, neuOrdner, "CLAUDE_CONFIG_DIR zeigt auf den neuen Ordner (und nur darauf)");
  for (const n of env.namen) assert.ok(n === "CLAUDE_CONFIG_DIR" || !/^(XDG_|GIT_|ANTHROPIC_|OPENAI_|CODEX_|CURSOR_|GEMINI_|CLAUDE|BRAIN_|KORTEX_|NODE_)/i.test(n), `Fremdvariable im Kind: ${n}`);
  assert.ok(!env.namen.includes("CODEX_HOME")); assert.ok(env.namen.includes("HOME") && env.namen.includes("PATH"));
  assert.match(env.browser, /kortex-anmelden-[^/]+\/kortex-browser$/, "BROWSER = das Kortex-Skript, nicht das aus der Werkstatt-Umgebung");
  // Code einfügen
  const schlecht = await t.rufe("POST", "/api/ki/anmeldelauf/code", { id: r.j.id, code: "mit Leerzeichen und\nZeile" });
  assert.equal(schlecht.status, 400);
  const gut = await t.rufe("POST", "/api/ki/anmeldelauf/code", { id: r.j.id, code: "abcd1234#zustand" });
  assert.equal(gut.status, 200);
  const ok = await t.warteAuf(r.j.id, ["ok", "error", "timeout"]);
  assert.equal(ok.phase, "ok"); assert.equal(ok.konto.name, "Firma"); assert.equal(ok.konto.programm, "claude");
  assert.equal(readFileSync(join(t.p.bin, "code-erhalten.txt"), "utf8"), "abcd1234#zustand", "der Code kam am Programm an");
  assert.deepEqual(t.staging(), []);
  const nach = await t.konten();
  const k = Object.values(nach.konten).find((x) => x.name === "Firma");
  assert.ok(k, "das Konto ist jetzt in der Liste");
  assert.ok(existsSync(join(t.s, "ki-konten-ordner", "claude-firma", "angemeldet")), "der Ordner wurde umbenannt, nicht neu angelegt");
});

test("Claude: eine Version, die die Adresse nur ausgibt (ohne BROWSER), geht auch — Adresse nur aus festen Hosts", async () => {
  const t = aufbau({ modus: "nur-ausgabe", verzoegerung: 600 });
  const r = await t.start({ programm: "claude", neu: "Zweit" });
  const w = await t.warteAuf(r.j.id, ["wait"]);
  assert.match(w.url, /^https:\/\/claude\.ai\//);
  assert.equal((await t.warteAuf(r.j.id, ["ok", "error"])).phase, "ok");
});

test("Codex: Gerätecode und Adresse nach dem Muster aus Orca, CODEX_HOME zeigt auf den neuen Ordner, nichts anderes im Kind", async () => {
  const t = aufbau({ modus: "ok", verzoegerung: 500 });
  const r = await t.start({ programm: "codex", neu: "Privat Codex" });
  const w = await t.warteAuf(r.j.id, ["wait"]);
  assert.equal(w.url, "https://auth.openai.com/codex/device"); assert.equal(w.code, "ABCD-12345"); assert.equal(w.codeMoeglich, false);
  assert.ok(w.verbleibendMs > 800_000 && w.verbleibendMs <= 900_000, "15 Minuten für den Gerätecode");
  const [env] = umgebungen(t.p.bin);
  assert.equal(env.konto, join(t.s, "ki-konten-ordner", t.staging()[0]));
  assert.ok(!env.namen.includes("CLAUDE_CONFIG_DIR") && !env.namen.includes("BROWSER") && !env.namen.some((n) => /^(XDG_|GIT_|ANTHROPIC_|OPENAI_)/.test(n)));
  assert.equal((await t.warteAuf(r.j.id, ["ok", "error"])).phase, "ok");
  assert.ok(existsSync(join(t.s, "ki-konten-ordner", "codex-privat-codex")));
  assert.deepEqual(readFileSync(join(t.p.bin, "aufrufe.jsonl"), "utf8").trim().split("\n").map((z) => JSON.parse(z).args), ["login --device-auth", "login status"]);
});

test("nichts außer Adresse und Code wird gelesen: Token aus Ausgabe und Anmeldedatei tauchen weder in Antworten noch im Protokoll auf", async () => {
  for (const programm of ["claude", "codex"]) {
    const t = aufbau({ modus: "ok", verzoegerung: 400 });
    const r = await t.start({ programm, neu: "Geheimtest" });
    await t.warteAuf(r.j.id, ["wait"]);
    await t.rufe("POST", "/api/ki/anmeldelauf/abbrechen", { id: (await t.start({ programm, neu: "Nebenher" })).j.id }); // auch Fehler- und Abbruchantworten zählen
    await t.warteAuf(r.j.id, ["ok", "error"]);
    const alles = t.antworten.join("\n") + JSON.stringify(t.protokoll) + JSON.stringify(await t.konten());
    assert.ok(alles.length > 200);
    for (const g of [GEHEIM, "GEHEIMER-TESTSCHLUESSEL", GEHEIM_DATEI, "sk-ant-api-aus-der-werkstatt", "sk-aus-der-werkstatt", "oauth-aus-der-werkstatt"]) assert.ok(!alles.includes(g), `${programm}: ${g} darf nirgends stehen`);
    const felder = new Set(Object.keys((await t.status(r.j.id))));
    for (const f of felder) assert.ok(["ok", "id", "programm", "neu", "phase", "url", "code", "codeMoeglich", "verbleibendMs", "grund", "rueckfall", "konto"].includes(f), `unerwartetes Feld ${f}`);
    // Protokoll: nur feste Ereignisnamen, nie die Adresse oder der Code
    for (const e of t.protokoll) { assert.ok(typeof e.ereignis === "string" || typeof e.phase === "string"); assert.ok(!JSON.stringify(e).includes("https://") && !JSON.stringify(e).includes("ABCD-12345")); }
  }
});

test("Abbrechen beendet die ganze Prozessgruppe und räumt den Ordner des neuen Kontos weg; kein Konto entsteht", async () => {
  const t = aufbau({ modus: "hang" });
  const r = await t.start({ programm: "claude", neu: "Abbruch" });
  await t.warteAuf(r.j.id, ["wait"]);
  const { haupt, kind } = JSON.parse(readFileSync(join(t.p.bin, "pids.json"), "utf8"));
  assert.ok(lebt(haupt) && lebt(kind));
  const a = await t.rufe("POST", "/api/ki/anmeldelauf/abbrechen", { id: r.j.id });
  assert.equal(a.j.phase, "abgebrochen"); assert.equal(a.j.verbleibendMs, null);
  await bis(() => !lebt(haupt) && !lebt(kind));
  assert.deepEqual(t.staging(), []);
  assert.ok(!Object.values((await t.konten()).konten).some((k) => k.name === "Abbruch"));
  assert.equal((await t.rufe("POST", "/api/ki/anmeldelauf/abbrechen", { id: r.j.id })).j.phase, "abgebrochen", "zweites Abbrechen ist harmlos");
  // danach darf dasselbe Konto wieder starten
  const neu = await t.start({ programm: "claude", neu: "Abbruch" });
  assert.equal(neu.status, 200); await t.rufe("POST", "/api/ki/anmeldelauf/abbrechen", { id: neu.j.id });
});

test("Frist abgelaufen: Phase timeout, Prozessgruppe weg, Ordner weg", async () => {
  const t = aufbau({ modus: "hang" }, { fristen: { adresse: 2500, gesamt: 500, status: 2000 } });
  const r = await t.start({ programm: "claude", neu: "Spaet" });
  const z = await t.warteAuf(r.j.id, ["timeout"]);
  assert.equal(z.grund, "abgelaufen"); assert.equal(z.rueckfall, false);
  const { haupt, kind } = JSON.parse(readFileSync(join(t.p.bin, "pids.json"), "utf8"));
  await bis(() => !lebt(haupt) && !lebt(kind));
  assert.deepEqual(t.staging(), []);
  // Codex: Gerätecode-Frist
  const c = aufbau({ modus: "hang" }, { fristen: { geraet: 400, status: 2000 } });
  const r2 = await c.start({ programm: "codex", neu: "CodexSpaet" });
  assert.equal((await c.warteAuf(r2.j.id, ["timeout"])).phase, "timeout");
  assert.deepEqual(c.staging(), []);
});

test("keine Adresse innerhalb der Frist: Fehler mit Rückfall „Im Terminal anmelden“, nie ein Hängen; Programm beendet", async () => {
  const t = aufbau({ modus: "keine-adresse" }, { fristen: { adresse: 400, status: 2000 } });
  const r = await t.start({ programm: "claude", neu: "Stumm" });
  const z = await t.warteAuf(r.j.id, ["error"]);
  assert.equal(z.grund, "keine-adresse"); assert.equal(z.rueckfall, true); assert.equal(z.url, null);
  const { haupt } = JSON.parse(readFileSync(join(t.p.bin, "pids.json"), "utf8"));
  await bis(() => !lebt(haupt));
  assert.deepEqual(t.staging(), []);
});

test("Programm scheitert oder meldet „fertig“ ohne angemeldet zu sein: Fehler, kein Konto, Ordner weg", async () => {
  const f = aufbau({ modus: "fehler" });
  const r = await f.start({ programm: "claude", neu: "Kaputt" });
  const z = await f.warteAuf(r.j.id, ["error"]);
  assert.equal(z.grund, "programm-fehler"); assert.equal(z.rueckfall, true);
  assert.deepEqual(f.staging(), []);
  const o = aufbau({ modus: "ohne-konto", verzoegerung: 100 });
  const r2 = await o.start({ programm: "codex", neu: "Leer" });
  const z2 = await o.warteAuf(r2.j.id, ["error"]);
  assert.equal(z2.grund, "nicht-angemeldet"); assert.equal(z2.konto, undefined);
  assert.deepEqual(o.staging(), []);
  assert.ok(!Object.values((await o.konten()).konten).some((k) => k.name === "Leer"));
});

test("bestehendes Konto: eigener Ordner als CLAUDE_CONFIG_DIR, Vermerk „angemeldet“, keine neuen Ordner", async () => {
  const t = aufbau({ modus: "ok", verzoegerung: 200 });
  const anlage = await t.rufe("POST", "/api/ki/konto-neu", { programm: "claude", name: "Alt" });
  const id = anlage.j.neuesKonto.id, ordner = anlage.j.neuesKonto.pfad;
  const r = await t.start({ programm: "claude", konto: id });
  assert.equal(r.status, 200); assert.equal(r.j.neu, false);
  const z = await t.warteAuf(r.j.id, ["ok", "error"]);
  assert.equal(z.phase, "ok"); assert.equal(z.konto.id, id);
  assert.equal(umgebungen(t.p.bin)[0].konto, ordner);
  assert.ok(existsSync(join(ordner, "angemeldet")));
  assert.deepEqual(t.staging(), []);
  const st = await t.rufe("POST", "/api/ki/anmeldung", { konto: id, zustand: "nicht-angemeldet" });
  assert.equal(st.j.zustand, "abgelaufen", "die Werkstatt hat sich die Anmeldung gemerkt");
});

test("Regeln: nur bekannte Programme und Konten, eine Anmeldung je Konto, höchstens 4 gleichzeitig, Drossel", async () => {
  const t = aufbau({ modus: "hang" });
  assert.equal((await t.start({ programm: "cursor", neu: "X" })).status, 400);
  assert.equal((await t.start({ programm: "claude" })).status, 400);
  assert.equal((await t.start({ programm: "claude", neu: "A", konto: "k_x" })).status, 400);
  assert.equal((await t.start({ programm: "claude", konto: "k_gibtesnicht" })).status, 404);
  assert.equal((await t.start({ programm: "claude", neu: "x".repeat(41) })).status, 400, "Name wird geprüft");
  assert.equal((await t.start({ programm: "claude", neu: "   " })).status, 400);
  assert.deepEqual(t.staging(), [], "abgewiesene Starts legen nichts an");
  assert.equal((await t.rufe("GET", "/api/ki/anmeldelauf?id=a_nix")).status, 404);
  assert.equal((await t.rufe("POST", "/api/ki/anmeldelauf/code", { id: "a_nix", code: "abcdefgh" })).status, 404);
  const ids = [];
  const a = await t.start({ programm: "claude", neu: "Eins" }); ids.push(a.j.id);
  const doppelt = await t.start({ programm: "claude", neu: "eins" });
  assert.equal(doppelt.status, 409); assert.equal(doppelt.j.art, "laeuft-schon"); assert.equal(doppelt.j.id, a.j.id);
  for (const n of ["Zwei", "Drei", "Vier"]) { const r = await t.start({ programm: "codex", neu: n }); assert.equal(r.status, 200); ids.push(r.j.id); }
  const fuenf = await t.start({ programm: "codex", neu: "Fuenf" });
  assert.equal(fuenf.status, 429); assert.equal(fuenf.j.art, "zu-viele");
  assert.equal(t.staging().length, 4, "der abgewiesene Start hat nichts angelegt");
  for (const id of ids) await t.rufe("POST", "/api/ki/anmeldelauf/abbrechen", { id });
  assert.deepEqual(t.staging(), []);
  // Drossel: 8 Starts je Minute (4 sind schon verbraucht)
  for (let i = 0; i < 4; i++) { const r = await t.start({ programm: "claude", neu: `Nochmal ${i}` }); assert.equal(r.status, 200); await t.rufe("POST", "/api/ki/anmeldelauf/abbrechen", { id: r.j.id }); }
  const zuoft = await t.start({ programm: "claude", neu: "Zuviel" });
  assert.equal(zuoft.status, 429); assert.equal(zuoft.j.art, "zu-oft");
});

test("fehlendes Programm: 409 mit Rückfall, nichts angelegt; Code nur während des Wartens und nur für Claude", async () => {
  const t = aufbau({ modus: "hang" });
  const ohne = erzeugeHandler({ vault: neuesVault(), vaultOptionen: { support: t.s }, anmeldeOptionen: { findeProgramm: () => null, basisUmgebung: () => ({}) } });
  const r = await ohne({ methode: "POST", pfad: "/api/ki/anmeldelauf", body: Buffer.from(JSON.stringify({ programm: "claude", neu: "Fehlt" })) });
  assert.equal(r.status, 409); const j = JSON.parse(r.body.toString()); assert.equal(j.art, "nicht-gefunden"); assert.equal(j.rueckfall, true);
  assert.deepEqual(t.staging(), []);
  const c = await t.start({ programm: "codex", neu: "OhneCode" });
  await t.warteAuf(c.j.id, ["wait"]);
  assert.equal((await t.rufe("POST", "/api/ki/anmeldelauf/code", { id: c.j.id, code: "abcdefgh" })).status, 409, "Codex braucht keinen Code");
  const k = await t.start({ programm: "claude", neu: "VorDerAdresse" });
  assert.ok([200, 409].includes((await t.rufe("POST", "/api/ki/anmeldelauf/code", { id: k.j.id, code: "abcdefgh" })).status));
  for (const id of [c.j.id, k.j.id]) await t.rufe("POST", "/api/ki/anmeldelauf/abbrechen", { id });
});

test("verwaiste `.neu-…`-Ordner (App während der Anmeldung beendet) räumt der nächste Start weg; Fremdes bleibt", async () => {
  const t = aufbau({ modus: "hang" });
  const wurzel = join(t.s, "ki-konten-ordner"); mkdirSync(wurzel, { recursive: true });
  const alt = join(wurzel, ".neu-0123456789abcdef"), jung = join(wurzel, ".neu-fedcba9876543210"), fremd = join(wurzel, ".neu-nicht-von-kortex");
  for (const d of [alt, jung, fremd]) { mkdirSync(d); writeFileSync(join(d, "x"), "x"); }
  const lang = new Date(Date.now() - 3 * 3600_000); utimesSync(alt, lang, lang); utimesSync(fremd, lang, lang);
  const r = await t.start({ programm: "claude", neu: "Aufraeumen" });
  assert.ok(!existsSync(alt), "alt und von Kortex: weg"); assert.ok(existsSync(jung), "jung: bleibt"); assert.ok(existsSync(fremd), "fremder Name: bleibt");
  await t.rufe("POST", "/api/ki/anmeldelauf/abbrechen", { id: r.j.id });
});

test("beendeAlle (Werkstatt endet): Prozesse und Ordner weg", async () => {
  const t = aufbau({ modus: "hang" });
  const r = await t.start({ programm: "codex", neu: "Ende" });
  await t.warteAuf(r.j.id, ["wait"]);
  const { haupt, kind } = JSON.parse(readFileSync(join(t.p.bin, "pids.json"), "utf8"));
  t.h.anmelden.beendeAlle();
  await bis(() => !lebt(haupt) && !lebt(kind));
  assert.deepEqual(t.staging(), []); assert.equal(t.h.anmelden.laufend(), 0);
});

// ───────────── Bausteine ohne Werkstatt ─────────────
test("anmeldeUmgebung: nur das gewählte Konto-Verzeichnis, Standardkonto ohne Variable, Fremdes weg, PATH nur absolut", () => {
  const basis = { PATH: "/usr/bin:relativ:/bin", HOME: "/h", CLAUDE_CONFIG_DIR: "/x", CODEX_HOME: "/y", XDG_CONFIG_HOME: "/z", XDG_RUNTIME_DIR: "/r", GIT_CONFIG_GLOBAL: "/g", GIT_CONFIG_SYSTEM: "/s", ANTHROPIC_AUTH_TOKEN: "t", BROWSER: "evil", NODE_OPTIONS: "--x", NODE_EXTRA_CA_CERTS: "/ca", DYLD_INSERT_LIBRARIES: "/d", TERM: "xterm" };
  const c = A.anmeldeUmgebung(basis, { programm: "claude", ordner: "/neu/ordner", browser: "/shim", pfadZusatz: ["/opt/bin"] });
  assert.deepEqual(Object.keys(c).sort(), ["BROWSER", "CLAUDE_CONFIG_DIR", "HOME", "NODE_EXTRA_CA_CERTS", "PATH", "TERM"]);
  assert.equal(c.CLAUDE_CONFIG_DIR, "/neu/ordner"); assert.equal(c.BROWSER, "/shim"); assert.equal(c.PATH, "/opt/bin:/usr/bin:/bin");
  const x = A.anmeldeUmgebung(basis, { programm: "codex", ordner: "/c" });
  assert.equal(x.CODEX_HOME, "/c"); assert.ok(!("CLAUDE_CONFIG_DIR" in x) && !("BROWSER" in x));
  const s = A.anmeldeUmgebung(basis, { programm: "claude", ordner: null });
  assert.ok(!("CLAUDE_CONFIG_DIR" in s) && !("CODEX_HOME" in s));
});

test("Adresse und Code: feste Hosts, nur https, Gerätecode nur nach der Marke und nur vollständig", () => {
  assert.equal(A.findeAdresse("claude", "Besuche https://claude.ai/oauth/authorize?x=1&y=2."), "https://claude.ai/oauth/authorize?x=1&y=2");
  assert.equal(A.findeAdresse("claude", "\u001b[32mhttps://claude.com/cai/oauth/authorize?code=true\u001b[0m"), "https://claude.com/cai/oauth/authorize?code=true");
  for (const schlecht of ["http://claude.ai/x", "https://claude.ai.evil.example/x", "https://evil.example/claude.ai", "https://user:pw@claude.ai/x", "https://claude.ai:8443/x", "file:///etc/passwd", "https://auth.openai.com/x"]) assert.equal(A.findeAdresse("claude", schlecht), null, schlecht);
  assert.equal(A.findeAdresse("codex", "https://auth.openai.com/codex/device"), "https://auth.openai.com/codex/device");
  assert.equal(A.findeAdresse("codex", "https://claude.ai/x"), null);
  const text = "1. Open https://auth.openai.com/codex/device\n2. Enter this one-time code (expires in 15 minutes)\n   ABCD-12345\n\nmehr";
  assert.equal(A.findeGeraetecode(text), "ABCD-12345");
  assert.equal(A.findeGeraetecode("2. Enter this one-time code\n   ABCD-123"), null, "noch nicht vollständig (kein Zeilenende dahinter)");
  assert.equal(A.findeGeraetecode("ABCD-12345 ohne Marke\n"), null);
  assert.equal(A.findeGeraetecode("Enter this one-time code\n   abcd-12345\n"), null, "nur Großbuchstaben/Ziffern");
  assert.ok(A.CODE_ERLAUBT.test("abcd1234#zustand") && !A.CODE_ERLAUBT.test("a b") && !A.CODE_ERLAUBT.test("ab") && !A.CODE_ERLAUBT.test("x".repeat(601)));
});

test("Attrappen brechen ab, wenn ihr Zielordner außerhalb des Temp-Ordners liegt", () => {
  const p = platzhalter();
  for (const [prog, v] of [["claude", "CLAUDE_CONFIG_DIR"], ["codex", "CODEX_HOME"]]) {
    const r = spawnSync(join(p.bin, prog), prog === "claude" ? ["auth", "status"] : ["login", "status"], { env: { PATH: "/usr/bin:/bin", [v]: "/usr" }, encoding: "utf8" });
    assert.equal(r.status, 99, `${prog}: Exit 99 außerhalb von Temp`);
  }
  assert.ok(!existsSync("/usr/.credentials.json"));
});
