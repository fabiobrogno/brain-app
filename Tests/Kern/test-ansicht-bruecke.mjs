// Ansicht für die Brain-App: transportunabhängiger Kern (behandleIntern, erzeugeHandler) und die
// stdin/stdout-Brücke (bruecke.mjs). Kernrisiko: dieselben Routen wie der HTTP-Dienst, aber kein Port.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, copyFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname as dn } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { behandle, behandleIntern } from "../ansicht/dienst-lib.mjs";
import { erzeugeHandler } from "../ansicht/handler.mjs";

const VAULT = mkdtempSync(join(tmpdir(), "bruecke-kern-"));
const ANSICHT = join(VAULT, "ansicht");
mkdirSync(ANSICHT, { recursive: true });
writeFileSync(join(ANSICHT, "index.html"), "<!doctype html><title>Brain</title>");
writeFileSync(join(ANSICHT, "data.js"), "window.BRAIN_DATA = {\"geheim\":1};");
process.on("exit", () => rmSync(VAULT, { recursive: true, force: true }));

const kontext = (handler = {}) => ({ vault: VAULT, handler, ansichtDir: ANSICHT, vaultId: "abc", version: "9.9.9" });

test("behandleIntern: liefert die Startseite ohne Host und ohne Token", async () => {
  const r = await behandleIntern({ methode: "GET", pfad: "/", headers: {} }, kontext());
  assert.equal(r.status, 200);
  assert.match(r.body.toString("utf8"), /<title>Brain<\/title>/);
});

test("behandleIntern: data.js bleibt gesperrt", async () => {
  const r = await behandleIntern({ methode: "GET", pfad: "/data.js", headers: {} }, kontext());
  assert.equal(r.status, 404);
});

test("behandleIntern: /api/ping ohne Token", async () => {
  const r = await behandleIntern({ methode: "GET", pfad: "/api/ping", headers: {} }, kontext());
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body.toString("utf8")), { vaultId: "abc", version: "9.9.9" });
});

test("behandleIntern: zu großer Körper → 413", async () => {
  const r = await behandleIntern({ methode: "PUT", pfad: "/api/einstellungen", headers: {}, body: Buffer.alloc(64 * 1024 + 1) }, kontext());
  assert.equal(r.status, 413);
});

test("behandle (HTTP): ohne passenden Host weiterhin 403", async () => {
  const r = await behandle({ methode: "GET", pfad: "/", headers: {} }, { ...kontext(), port: 4242, "token": "cd".repeat(32) });
  assert.equal(r.status, 403);
});

test("erzeugeHandler: liefert alle Handler, die das Routing braucht", () => {
  const h = erzeugeHandler();
  for (const k of ["daten", "einstellungenLesen", "einstellungenSchreiben", "analyse", "vorschlaegeListe",
    "vorschlagEntscheiden", "gelesen", "pflege", "konfliktEntscheiden", "pflegeLauf"]) {
    assert.equal(typeof h[k], "function", k);
  }
});

test("erzeugeHandler: zwei Instanzen haben getrennte Daten-Caches", async () => {
  const basis = mkdtempSync(join(tmpdir(), "bruecke-cache-"));
  process.on("exit", () => rmSync(basis, { recursive: true, force: true }));
  const v = join(basis, "vault");
  cpSync(join(dn(fileURLToPath(import.meta.url)), "fixture"), v, { recursive: true });
  const a = erzeugeHandler(), b = erzeugeHandler();
  const a1 = await a.daten(v);
  assert.equal(await a.daten(v), a1, "dieselbe Instanz liefert aus dem Cache");
  const b1 = await b.daten(v);
  assert.notEqual(b1, a1, "die andere Instanz sieht den Cache nicht und baut selbst");
  assert.equal(await b.daten(v), b1);
  assert.equal(await a.daten(v), a1, "der Cache von a bleibt unberührt");
});

test("erzeugeHandler: pflegeLauf ohne Pflege-Modul → Route antwortet 503", async () => {
  // Kopie von handler.mjs in einen Baum ohne ../pflegelauf.mjs: ladeModul findet es nicht → „nicht verfügbar“
  const basis = mkdtempSync(join(tmpdir(), "bruecke-leer-"));
  process.on("exit", () => rmSync(basis, { recursive: true, force: true }));
  mkdirSync(join(basis, "ansicht"));
  copyFileSync(join(dn(fileURLToPath(import.meta.url)), "..", "ansicht", "handler.mjs"), join(basis, "ansicht", "handler.mjs"));
  writeFileSync(join(basis, "ansicht", "dienst-lib.mjs"), "export const laufErgebnis = (r) => r;\n"); // Stub für den Import
  const { erzeugeHandler: leer } = await import(pathToFileURL(join(basis, "ansicht", "handler.mjs")).href);
  const r = await behandleIntern({ methode: "POST", pfad: "/api/pflege/lauf", headers: {} }, kontext(leer()));
  assert.equal(r.status, 503);
});

// ------------------------------------------------------------------------------- bruecke.mjs (Prozess)
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { statSync } from "node:fs";

const KIT_ANSICHT = join(dn(fileURLToPath(import.meta.url)), "..", "ansicht");
const FIXTURE = join(dn(fileURLToPath(import.meta.url)), "fixture");

function testVault(name = "Test Brän") {
  const basis = mkdtempSync(join(tmpdir(), "bruecke-"));
  const v = join(basis, name);
  cpSync(FIXTURE, v, { recursive: true });
  process.on("exit", () => rmSync(basis, { recursive: true, force: true }));
  return v;
}

function starte(vault) {
  const p = spawn(process.execPath, [join(KIT_ANSICHT, "bruecke.mjs"), vault], { stdio: ["pipe", "pipe", "inherit"] });
  const rl = createInterface({ input: p.stdout });
  const warten = new Map();
  const ohneId = [];
  let bereitOk;
  const bereit = new Promise((ok) => { bereitOk = ok; });
  rl.on("line", (zeile) => {
    const o = JSON.parse(zeile);
    if (o.bereit) return bereitOk(o);
    if (o.id === null) { const w = ohneId.shift(); if (w) w(o); return; }
    const w = warten.get(o.id); if (w) { warten.delete(o.id); w(o); }
  });
  let n = 0;
  const frage = (a) => new Promise((ok) => { const id = ++n; warten.set(id, ok); p.stdin.write(JSON.stringify({ id, ...a }) + "\n"); });
  const roh = (zeile) => new Promise((ok) => { ohneId.push(ok); p.stdin.write(zeile + "\n"); });
  const ende = new Promise((ok) => p.on("exit", (code) => ok(code)));
  return { p, bereit, frage, roh, ende };
}
const text = (a) => Buffer.from(a.body, "base64").toString("utf8");

test("brücke: meldet sich mit version und vaultId (Pfad mit Leerzeichen und Umlaut)", async () => {
  const b = starte(testVault("Mein Brän"));
  const o = await b.bereit;
  assert.match(o.version, /^\d+\.\d+\.\d+/);
  assert.match(o.vaultId, /^[0-9a-f]{16}$/);
  const ping = await b.frage({ methode: "GET", pfad: "/api/ping" });
  assert.equal(ping.status, 200);
  assert.equal(JSON.parse(text(ping)).vaultId, o.vaultId);
  b.p.stdin.end();
  assert.equal(await b.ende, 0);
});

test("brücke: Startseite, data.js gesperrt, Daten als JSON, Query im Pfad", async () => {
  const b = starte(testVault());
  await b.bereit;
  const start = await b.frage({ methode: "GET", pfad: "/" });
  assert.equal(start.status, 200);
  assert.match(text(start), /<script src="api\.js"><\/script>/);
  assert.equal((await b.frage({ methode: "GET", pfad: "/data.js" })).status, 404);
  const daten = await b.frage({ methode: "GET", pfad: "/api/daten" });
  assert.equal(daten.status, 200);
  assert.ok(Array.isArray(JSON.parse(text(daten)).nodes));
  const gelesen = await b.frage({ methode: "GET", pfad: "/api/gelesen?seit=1" });
  assert.notEqual(gelesen.status, 404);
  b.p.stdin.end();
  assert.equal(await b.ende, 0);
});

test("brücke: große Datei kommt vollständig an", async () => {
  const b = starte(testVault());
  await b.bereit;
  const r = await b.frage({ methode: "GET", pfad: "/vendor/three.bundle.js" });
  assert.equal(r.status, 200);
  assert.equal(Buffer.from(r.body, "base64").length, statSync(join(KIT_ANSICHT, "vendor", "three.bundle.js")).size);
  b.p.stdin.end();
  await b.ende;
});

test("brücke: viele gleichzeitige Anfragen werden über die id richtig zugeordnet", async () => {
  const b = starte(testVault());
  await b.bereit;
  const antworten = await Promise.all(Array.from({ length: 20 }, () => b.frage({ methode: "GET", pfad: "/api/ping" })));
  assert.ok(antworten.every((a) => a.status === 200));
  b.p.stdin.end();
  await b.ende;
});

test("brücke: unlesbare Zeile → 400 mit id null, Brücke läuft weiter", async () => {
  const b = starte(testVault());
  await b.bereit;
  const f = await b.roh("das ist kein json");
  assert.equal(f.status, 400);
  assert.equal((await b.frage({ methode: "GET", pfad: "/api/ping" })).status, 200);
  b.p.stdin.end();
  await b.ende;
});

test("brücke: POST /api/stopp beendet nach der Antwort mit Exit 0", async () => {
  const b = starte(testVault());
  await b.bereit;
  const r = await b.frage({ methode: "POST", pfad: "/api/stopp", body: Buffer.from("{}").toString("base64") });
  assert.equal(r.status, 200);
  assert.equal(await b.ende, 0);
});
