// Kontingent (Paket P7): Codex über das Programm selbst (`codex … app-server`, `account/rateLimits/read`), der Takt (15 Min, frühestens 5 Min nach der letzten Abfrage, Pause bei Fehlern,
// „veraltet“ nach 30 Min) und die ehrliche Anzeige „nicht abrufbar“. Kein echtes Codex: eine Attrappe (Node-Skript im Temp-Ordner) spricht das Protokoll nach und verlangt BRAIN_TESTMODUS=1
// sowie Home und CODEX_HOME im Temp-Ordner. Kein Token, kein Schlüsselbund, kein Netz.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, readFileSync, chmodSync, existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { tmp, pfad } from "./hilfe.mjs";

for (const k of ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "CURSOR_CONFIG_DIR", "GEMINI_CLI_HOME", "XDG_CONFIG_HOME", "GIT_CONFIG_GLOBAL"]) delete process.env[k];

const { liesCodexKontingent, klassifiziereCodex, CODEX_ARGS, stufe, fehlerPause, TAKT_MS, MIN_NEU_MS, VERALTET_MS } = await import(pfad("gemeinsam", "kontingent.mjs"));
const { erzeugeKontingent } = await import(pfad("werkstatt", "kontingent.mjs"));

const TEMP = realpathSync(tmpdir());
// Die Attrappe: Modus aus der Umgebungsvariable FAKE_MODUS (die der Test ausdrücklich setzt), Aufrufe und Prozess-Kennung im Ordner FAKE_ORDNER
const FAKE = (ex) => `#!${process.execPath}
const fs = require("node:fs"); const path = require("node:path");
const ordner = process.env.FAKE_ORDNER;
const imTemp = (p) => typeof p === "string" && fs.realpathSync(p).startsWith(${JSON.stringify(TEMP)} + "/");
if (process.env.BRAIN_TESTMODUS !== "1" || !imTemp(process.env.HOME) || (process.env.CODEX_HOME && !imTemp(process.env.CODEX_HOME))) { console.error("Attrappe nur im Testmodus mit Temp-Ordnern"); process.exit(9); }
const args = process.argv.slice(2);
fs.appendFileSync(path.join(ordner, "aufrufe.jsonl"), JSON.stringify({ args, codexHome: process.env.CODEX_HOME || null, pid: process.pid, cwd: process.cwd() }) + "\\n");
fs.writeFileSync(path.join(ordner, "pid"), String(process.pid));
const modus = process.env.FAKE_MODUS || "ok";
if (modus === "sofort-ende") { console.error("Please sign in again: your ChatGPT session expired"); process.exit(1); }
if (modus === "stumm-ende") process.exit(1);
let puffer = "";
const antwort = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
process.stdin.on("data", (d) => {
  puffer += d;
  let i;
  while ((i = puffer.indexOf("\\n")) >= 0) {
    const m = JSON.parse(puffer.slice(0, i)); puffer = puffer.slice(i + 1);
    fs.appendFileSync(path.join(ordner, "rpc.jsonl"), JSON.stringify(m) + "\\n");
    if (modus === "haengt-init") continue;
    if (m.method === "initialize") { antwort({ jsonrpc: "2.0", id: m.id, result: { userAgent: "fake" } }); continue; }
    if (m.method === "account/rateLimits/read") {
      if (modus === "haengt") continue;
      if (modus === "rpc-fehler") return antwort({ jsonrpc: "2.0", id: m.id, error: { code: -32000, message: "interner Fehler in /Users/x/.codex" } });
      if (modus === "auth-fehler") return antwort({ jsonrpc: "2.0", id: m.id, error: { code: -32001, message: "Not authenticated: please sign in" } });
      if (modus === "ohne-fenster") return antwort({ jsonrpc: "2.0", id: m.id, result: { rateLimits: { primary: null, secondary: null } } });
      if (modus === "muell") { process.stdout.write("kein json\\n"); return antwort({ jsonrpc: "2.0", id: m.id, result: { rateLimits: ${ex} } }); }
      return antwort({ jsonrpc: "2.0", id: m.id, result: { rateLimits: ${ex} } });
    }
  }
});
`;
const OK_FENSTER = `{ primary: { usedPercent: 9, windowDurationMins: 300, resetsAt: 1893456000 }, secondary: { usedPercent: 71, windowDurationMins: 10080, resetsAt: 1893888000 }, credits: { hasCredits: true, balance: "5" } }`;

function attrappe(ex = OK_FENSTER) {
  const bin = tmp("brain-fake-codex-");
  const codex = join(bin, "codex");
  writeFileSync(codex, FAKE(ex)); chmodSync(codex, 0o755);
  const home = tmp("brain-home-"), codexHome = tmp("brain-codexhome-");
  const env = (modus = "ok", extra = {}) => ({ PATH: "/usr/bin:/bin", HOME: home, CODEX_HOME: codexHome, BRAIN_TESTMODUS: "1", FAKE_ORDNER: bin, FAKE_MODUS: modus, ...extra });
  const aufrufe = () => (existsSync(join(bin, "aufrufe.jsonl")) ? readFileSync(join(bin, "aufrufe.jsonl"), "utf8").trim().split("\n").map((z) => JSON.parse(z)) : []);
  const rpc = () => (existsSync(join(bin, "rpc.jsonl")) ? readFileSync(join(bin, "rpc.jsonl"), "utf8").trim().split("\n").map((z) => JSON.parse(z)) : []);
  const tot = () => { try { process.kill(Number(readFileSync(join(bin, "pid"), "utf8")), 0); return false; } catch (e) { return e.code === "ESRCH"; } };
  return { bin, codex, home, codexHome, env, aufrufe, rpc, tot, cwd: tmp("brain-cwd-") };
}
const warte = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function bisTot(a) { for (let i = 0; i < 50 && !a.tot(); i++) await warte(50); return a.tot(); }

test("Orcas Aufruf: `codex -c approval_policy=never -c features.plugins=false -s read-only -a never app-server`, dann initialize → initialized → account/rateLimits/read; Fenster 5 Std und Woche mit Rücksetzzeit; das Programm wird danach beendet", async () => {
  const a = attrappe();
  const r = await liesCodexKontingent({ programm: a.codex, env: a.env(), cwd: a.cwd });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.session, { usedPercent: 9, windowMinutes: 300, resetsAt: 1893456000 * 1000 });
  assert.deepEqual(r.weekly, { usedPercent: 71, windowMinutes: 10080, resetsAt: 1893888000 * 1000 });
  const [lauf] = a.aufrufe();
  assert.deepEqual(lauf.args, CODEX_ARGS);
  assert.equal(lauf.codexHome, a.codexHome);
  assert.equal(realpathSync(lauf.cwd), realpathSync(a.cwd), "läuft im neutralen Ordner, nicht in einem Profil oder Vault");
  assert.deepEqual(a.rpc().map((m) => m.method), ["initialize", "initialized", "account/rateLimits/read"]);
  assert.equal(a.rpc()[0].params.clientInfo.name, "kortex");
  assert.equal(await bisTot(a), true, "der Prozess ist beendet — nichts bleibt im Hintergrund");
  assert.ok(!JSON.stringify(r).includes("credits"), "das Guthaben (Credits) wird nicht übernommen");
});

test("Zeilen, die nicht zum Protokoll gehören, stören nicht", async () => {
  const a = attrappe();
  const r = await liesCodexKontingent({ programm: a.codex, env: a.env("muell"), cwd: a.cwd });
  assert.equal(r.ok, true);
  assert.equal(r.session.usedPercent, 9);
  await bisTot(a);
});

test("Fehlerarten: Programm fehlt · beendet sich sofort (Anmeldung) · stumm beendet · Fehler in der Antwort · Anmeldefehler in der Antwort · keine Fenster · Zeitlimit", async () => {
  const a = attrappe();
  assert.deepEqual(await liesCodexKontingent({ programm: join(a.bin, "gibt-es-nicht"), env: a.env(), cwd: a.cwd }), { ok: false, art: "fehlt" });
  assert.deepEqual(await liesCodexKontingent({ programm: a.codex, env: a.env("sofort-ende"), cwd: a.cwd }), { ok: false, art: "anmeldung" });
  assert.deepEqual(await liesCodexKontingent({ programm: a.codex, env: a.env("stumm-ende"), cwd: a.cwd }), { ok: false, art: "beendet" });
  assert.deepEqual(await liesCodexKontingent({ programm: a.codex, env: a.env("rpc-fehler"), cwd: a.cwd }), { ok: false, art: "rpc" });
  assert.deepEqual(await liesCodexKontingent({ programm: a.codex, env: a.env("auth-fehler"), cwd: a.cwd }), { ok: false, art: "anmeldung" });
  assert.deepEqual(await liesCodexKontingent({ programm: a.codex, env: a.env("ohne-fenster"), cwd: a.cwd }), { ok: false, art: "form" });
  // nach außen gehen nur feste Arten, nie der Text der Antwort (er könnte Pfade enthalten)
  const f = await liesCodexKontingent({ programm: a.codex, env: a.env("rpc-fehler"), cwd: a.cwd });
  assert.ok(!JSON.stringify(f).includes("/Users"));
  const t0 = Date.now();
  assert.deepEqual(await liesCodexKontingent({ programm: a.codex, env: a.env("haengt"), cwd: a.cwd, rpcFrist: 400 }), { ok: false, art: "zeit" });
  assert.ok(Date.now() - t0 < 5000);
  assert.equal(await bisTot(a), true, "auch ein hängendes Programm wird beendet");
  assert.deepEqual(await liesCodexKontingent({ programm: a.codex, env: a.env("haengt-init"), cwd: a.cwd, initFrist: 400 }), { ok: false, art: "zeit" });
  assert.equal(await bisTot(a), true);
});

test("Abbrechen (z. B. beim Beenden der Werkstatt) beendet das Programm sofort", async () => {
  const a = attrappe();
  const ab = new AbortController();
  const p = liesCodexKontingent({ programm: a.codex, env: a.env("haengt"), cwd: a.cwd, signal: ab.signal, rpcFrist: 20_000 });
  await warte(300);
  ab.abort();
  assert.deepEqual(await p, { ok: false, art: "ende" });
  assert.equal(await bisTot(a), true);
});

test("Fenster erkennen (Orcas Fälle): Länge 300/10080 (±1 Min), Reihenfolge egal, unbekannte Länge = alte Zuordnung, Grenzen 0–100, fehlende Felder", () => {
  const w = (usedPercent, windowDurationMins, resetsAt) => ({ usedPercent, windowDurationMins, resetsAt });
  let k = klassifiziereCodex({ primary: w(50, 10080, 100), secondary: w(10, 300, 200) });
  assert.equal(k.session.usedPercent, 10); assert.equal(k.weekly.usedPercent, 50);
  k = klassifiziereCodex({ primary: w(5, 299, 100), secondary: w(6, 10081, 0) });
  assert.equal(k.session.usedPercent, 5); assert.equal(k.weekly.usedPercent, 6); assert.equal(k.weekly.resetsAt, null, "Zeit 0 = unbekannt");
  k = klassifiziereCodex({ primary: w(7, undefined, 100), secondary: w(8, undefined, undefined) });
  assert.equal(k.session.usedPercent, 7); assert.equal(k.weekly.usedPercent, 8);
  k = klassifiziereCodex({ primary: w(7, 60, 100), secondary: null });
  assert.equal(k.session.usedPercent, 7, "unbekannte Länge des ersten Fensters = 5 Std (alte Zuordnung)"); assert.equal(k.weekly, null);
  k = klassifiziereCodex({ primary: w(250, 300), secondary: w(-4, 10080) });
  assert.equal(k.session.usedPercent, 100); assert.equal(k.weekly.usedPercent, 0);
  assert.deepEqual(klassifiziereCodex(null), { session: null, weekly: null });
  assert.deepEqual(klassifiziereCodex({ primary: { usedPercent: "9" } }), { session: null, weekly: null });
});

test("Zahlen wie Orca: Balken grau < 60, gelb 60–79, rot ab 80; Takt 15 Min, Neu frühestens nach 5 Min, veraltet nach 30 Min; Fehlerpause 30 s … 15 Min", () => {
  assert.deepEqual([0, 59.9, 60, 79.9, 80, 100].map(stufe), ["grau", "grau", "gelb", "gelb", "rot", "rot"]);
  assert.equal(TAKT_MS, 15 * 60_000); assert.equal(MIN_NEU_MS, 5 * 60_000); assert.equal(VERALTET_MS, 30 * 60_000);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 12].map(fehlerPause), [30_000, 60_000, 120_000, 240_000, 480_000, 900_000, 900_000, 900_000]);
});

// ---------- Der Takt in der Werkstatt (mit eingesetztem Abfrage-Lauf und eigener Uhr) ----------
function takt(opt = {}) {
  const support = tmp("brain-support-"), home = tmp("brain-home-");
  const ordner = join(home, ".codex"); mkdirSync(ordner, { recursive: true });
  const daten = { konten: { k_cccc0001: { programm: "codex", ordner, standard: true, name: "Codex" }, ...(opt.zwei ? { k_cccc0002: { programm: "codex", ordner: join(home, ".codex-zweit"), standard: false, name: "Codex zweit" } } : {}) } };
  const z = { t: 1_800_000_000_000, aufrufe: [], antworten: [], gleichzeitig: 0, max: 0 };
  const lauf = async (o) => {
    z.aufrufe.push({ programm: o.programm, codexHome: o.env.CODEX_HOME || null, cwd: o.cwd });
    z.gleichzeitig++; z.max = Math.max(z.max, z.gleichzeitig);
    await warte(5);
    z.gleichzeitig--;
    const a = z.antworten.length ? z.antworten.shift() : { ok: true, session: { usedPercent: 12, windowMinutes: 300, resetsAt: z.t + 3_600_000 }, weekly: { usedPercent: 34, windowMinutes: 10080, resetsAt: z.t + 86_400_000 } };
    return a;
  };
  const kt = erzeugeKontingent({ support, konten: { lade: () => daten }, home: () => home, codexProgramm: () => opt.programm === undefined ? "/x/codex" : opt.programm, jetzt: () => z.t, codexLauf: lauf });
  return { z, kt, daten, holen: (id = "k_cccc0001", neu = false) => kt.stand({ neu }).konten.find((x) => x.id === id) };
}

test("Takt: die erste Frage startet die Abfrage („lädt“), danach stehen die Werte da; nicht öfter als alle 15 Minuten", async () => {
  const a = takt();
  assert.equal(a.holen().status, "laedt");
  await a.kt.warteAufAbfragen();
  let s = a.holen();
  assert.equal(s.status, "ok"); assert.equal(s.session.usedPercent, 12); assert.equal(s.weekly.usedPercent, 34);
  assert.equal(a.z.aufrufe.length, 1);
  assert.equal(a.z.aufrufe[0].codexHome, null, "das Standardkonto setzt kein CODEX_HOME");
  a.z.t += 14 * 60_000; a.holen(); await a.kt.warteAufAbfragen();
  assert.equal(a.z.aufrufe.length, 1, "nach 14 Minuten wird nicht neu gefragt");
  a.z.t += 61_000; a.holen(); await a.kt.warteAufAbfragen();
  assert.equal(a.z.aufrufe.length, 2, "nach 15 Minuten schon");
  // das Frage-Intervall ist unabhängig davon, wie oft die Oberfläche nachsieht
  for (let i = 0; i < 50; i++) a.holen();
  await a.kt.warteAufAbfragen();
  assert.equal(a.z.aufrufe.length, 2);
});

test("„Neu laden“ (neu=1) fragt frühestens 5 Minuten nach der letzten Abfrage", async () => {
  const a = takt();
  a.holen(); await a.kt.warteAufAbfragen();
  a.z.t += 2 * 60_000; a.holen("k_cccc0001", true); await a.kt.warteAufAbfragen();
  assert.equal(a.z.aufrufe.length, 1, "nach 2 Minuten bleibt es beim alten Stand");
  const s = a.holen();
  assert.ok(Date.parse(s.neuAb) > a.z.t, "die Oberfläche kann „frühestens ab …“ nennen");
  a.z.t += 3 * 60_000 + 1000; a.holen("k_cccc0001", true); await a.kt.warteAufAbfragen();
  assert.equal(a.z.aufrufe.length, 2, "nach 5 Minuten erlaubt");
});

test("Fehler: das letzte gute Ergebnis bleibt mit dem Fehler sichtbar; Pause 30 s, 60 s, … bis 15 Minuten; „veraltet“ nach 30 Minuten; erholt sich danach", async () => {
  const a = takt();
  a.holen(); await a.kt.warteAufAbfragen();
  a.z.antworten.push({ ok: false, art: "zeit" });
  a.z.t += 15 * 60_000 + 1; a.holen(); await a.kt.warteAufAbfragen();
  let s = a.holen();
  assert.equal(s.status, "fehler-mit-wert"); assert.equal(s.fehlerArt, "zeit"); assert.equal(s.session.usedPercent, 12, "der letzte gute Wert bleibt");
  const n = a.z.aufrufe.length;
  a.z.t += 20_000; a.holen(); await a.kt.warteAufAbfragen();
  assert.equal(a.z.aufrufe.length, n, "nach dem ersten Fehler 30 s Pause");
  a.z.antworten.push({ ok: false, art: "zeit" });
  a.z.t += 11_000; a.holen(); await a.kt.warteAufAbfragen();
  assert.equal(a.z.aufrufe.length, n + 1);
  a.z.t += 40_000; a.holen(); await a.kt.warteAufAbfragen();
  assert.equal(a.z.aufrufe.length, n + 1, "nach dem zweiten Fehler 60 s Pause");
  a.z.antworten.push({ ok: true, session: { usedPercent: 99, windowMinutes: 300, resetsAt: null }, weekly: null });
  a.z.t += 30_000; a.holen(); await a.kt.warteAufAbfragen();
  s = a.holen();
  assert.equal(s.status, "ok"); assert.equal(s.session.usedPercent, 99); assert.equal(s.fehlerArt, undefined);
  // über 30 Minuten ohne neue Werte (das Programm antwortet nicht mehr): der Wert bleibt, ist aber als veraltet markiert
  a.z.antworten.push({ ok: false, art: "zeit" }, { ok: false, art: "zeit" }, { ok: false, art: "zeit" }, { ok: false, art: "zeit" });
  for (let i = 0; i < 3; i++) { a.z.t += 16 * 60_000; a.holen(); await a.kt.warteAufAbfragen(); }
  s = a.holen();
  assert.equal(s.status, "fehler-mit-wert"); assert.equal(s.veraltet, true); assert.equal(s.session.usedPercent, 99);
});

test("Ohne Erfolg: Status „fehler“ mit der Art (kein Programm, Anmeldung …) — nie ein erfundener Wert", async () => {
  const a = takt({ programm: null });
  a.holen(); await a.kt.warteAufAbfragen();
  const s = a.holen();
  assert.equal(s.status, "fehler"); assert.equal(s.fehlerArt, "fehlt"); assert.equal(s.session, undefined);
  assert.equal(a.z.aufrufe.length, 0, "ohne Programm wird nichts gestartet");
  const b = takt();
  b.z.antworten.push({ ok: false, art: "anmeldung" });
  b.holen(); await b.kt.warteAufAbfragen();
  assert.equal(b.holen().fehlerArt, "anmeldung");
});

test("Zwei Codex-Konten werden nacheinander gefragt (nie zwei Programme gleichzeitig), das zweite mit seinem eigenen CODEX_HOME", async () => {
  const a = takt({ zwei: true });
  a.holen(); a.holen("k_cccc0002"); await a.kt.warteAufAbfragen();
  assert.equal(a.z.aufrufe.length, 2);
  assert.equal(a.z.max, 1);
  assert.equal(a.z.aufrufe.find((x) => x.codexHome)?.codexHome, join(a.daten.konten.k_cccc0002.ordner));
});

test("Im Testmodus ohne eingesetztes Programm fragt Kortex nie ein echtes Codex: „fehlt“", async () => {
  const support = tmp("brain-support-"), home = tmp("brain-home-");
  const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
  const vault = tmp("brain-vault-"); writeFileSync(join(vault, "brain.config.json"), "{}\n");
  writeFileSync(join(support, "vaults.json"), JSON.stringify({ vaults: [{ name: "V", pfad: vault, farbe: "#5B8DEF" }], aktiv: vault }));
  mkdirSync(join(home, ".codex"), { recursive: true }); writeFileSync(join(home, ".codex", "config.toml"), "");
  const h = erzeugeHandler({ vault, vaultOptionen: { support }, kontenHome: home });
  const rufe = async (p) => JSON.parse((await h({ methode: "GET", pfad: p, query: null })).body.toString("utf8"));
  await h({ methode: "POST", pfad: "/api/ki/konten/abgleich", query: null, body: Buffer.from("{}") }); // der ausdrückliche Abgleich legt die Konten an
  const s1 = (await rufe("/api/ki/kontingent")).konten.find((x) => x.programm === "codex");
  await h.kontingent.warteAufAbfragen();
  const s2 = (await rufe("/api/ki/kontingent")).konten.find((x) => x.programm === "codex");
  assert.equal(s1.status, "laedt");
  assert.equal(s2.status, "fehler"); assert.equal(s2.fehlerArt, "fehlt");
});

test("Kein Netz, kein Schlüsselbund, kein Token: der Quelltext des Kontingents ruft weder das Netz noch Anmeldedaten anderer Programme auf", async () => {
  const { readFileSync } = await import("node:fs");
  const ohneKommentare = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((z) => z.replace(/(^|\s)\/\/.*$/, "")).join("\n");
  const dateien = [["gemeinsam", "kontingent.mjs"], ["gemeinsam", "kortex-statuszeile.mjs"], ["werkstatt", "kontingent.mjs"], ["studio", "kontingent.js"], ["studio", "texte-kontingent.js"]];
  const verboten = [/\bfetch\s*\(/, /node:https?\b/, /node:net\b/, /node:dns\b/, /node:tls\b/, /XMLHttpRequest/, /WebSocket/, /sendBeacon/, /\bsecurity\b.*(find|dump)-/i, /keychain|schl[uü]sselbund/i, /\.credentials/, /auth\.json/, /api\.anthropic|openai\.com|chatgpt\.com/i, /access_token|refresh_token|Bearer /, /\bcurl\b/];
  for (const [ordner, name] of dateien) {
    const text = ohneKommentare(readFileSync(pfad(ordner, name), "utf8"));
    for (const v of verboten) assert.ok(!v.test(text), `${ordner}/${name}: ${v} darf im Code nicht vorkommen`);
  }
});

// ---------------------------------------------------------------------- Befunde des Sicherheits-Reviews
test("Das Codex-Programm bekommt keine Schlüssel, Tokens und Konto-Ordner anderer Programme (OPENAI_API_KEY, ANTHROPIC_*, … — dieselbe Liste wie für die KI-Programme), aber PATH und das eigene CODEX_HOME", async () => {
  const { codexUmgebung } = await import(pfad("gemeinsam", "kontingent.mjs"));
  const e = codexUmgebung({ PATH: "/usr/bin", HOME: "/h", LANG: "de", CODEX_HOME: "/x", CLAUDE_CONFIG_DIR: "/c", OPENAI_API_KEY: "sk-1", OPENAI_BASE_URL: "u", CODEX_API_KEY: "k", ANTHROPIC_API_KEY: "a", ANTHROPIC_AUTH_TOKEN: "t",
    CLAUDE_CODE_OAUTH_TOKEN: "o", GITHUB_TOKEN: "g", AWS_BEARER_TOKEN_BEDROCK: "b", XDG_CONFIG_HOME: "/q", GIT_CONFIG_GLOBAL: "/g", CURSOR_CONFIG_DIR: "/c2", GEMINI_CLI_HOME: "/g2", DB_SECRET: "s", NODE_EXTRA_CA_CERTS: "/ca.pem" });
  assert.deepEqual(Object.keys(e).sort(), ["HOME", "LANG", "NODE_EXTRA_CA_CERTS", "PATH"]);
  // und so kommt es in der Werkstatt an, auch wenn der Prozess selbst Schlüssel in der Umgebung hat
  const { erzeugeKontingent } = await import(pfad("werkstatt", "kontingent.mjs"));
  const alt = { o: process.env.OPENAI_API_KEY, a: process.env.ANTHROPIC_API_KEY, c: process.env.CODEX_HOME };
  process.env.OPENAI_API_KEY = "sk-geheim"; process.env.ANTHROPIC_API_KEY = "sk-ant-geheim"; process.env.CODEX_HOME = "/nicht/meins";
  try {
    const support = tmp("brain-support-"), home = tmp("brain-home-");
    const zweit = join(home, ".codex-zweit"); mkdirSync(zweit, { recursive: true });
    const daten = { konten: { k_cccc0001: { programm: "codex", ordner: join(home, ".codex"), standard: true, name: "Codex" }, k_cccc0002: { programm: "codex", ordner: zweit, standard: false, name: "Zweit" } } };
    const gesehen = [];
    const kt = erzeugeKontingent({ support, konten: { lade: () => daten }, home: () => home, codexProgramm: () => "/x/codex", codexLauf: async (o) => { gesehen.push(o.env); return { ok: false, art: "zeit" }; } });
    kt.stand({}); await kt.warteAufAbfragen();
    assert.equal(gesehen.length, 2);
    for (const env of gesehen) { assert.equal(env.OPENAI_API_KEY, undefined); assert.equal(env.ANTHROPIC_API_KEY, undefined); assert.ok(env.PATH.startsWith("/x:")); assert.equal(env.CI, "1"); }
    assert.equal(gesehen[0].CODEX_HOME, undefined, "das Standardkonto: kein CODEX_HOME aus der Umgebung des Prozesses");
    assert.equal(gesehen[1].CODEX_HOME, zweit);
  } finally { for (const [k, w] of [["OPENAI_API_KEY", alt.o], ["ANTHROPIC_API_KEY", alt.a], ["CODEX_HOME", alt.c]]) { if (w === undefined) delete process.env[k]; else process.env[k] = w; } }
});
