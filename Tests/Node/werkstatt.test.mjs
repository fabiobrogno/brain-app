import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, cpSync, mkdirSync, chmodSync, existsSync, realpathSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { tmp, schreibe, repo, g, pfad } from "./hilfe.mjs";

const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
const kinder = [];
after(() => { for (const k of kinder) k.kill("SIGKILL"); });
const sha = (s) => createHash("sha256").update(s).digest("hex");

function studioOrdner() {
  const s = tmp("brain-studio-");
  schreibe(s, "index.html", "<!doctype html><title>Studio</title>");
  schreibe(s, "app.js", "console.log(1)");
  schreibe(s, "stil.css", "body{}");
  schreibe(s, "vendor/cm.js", "export{}");
  schreibe(s, "schrift.woff2", "x");
  schreibe(s, ".versteckt", "nein");
  return s;
}
function vaultMitWiki() {
  const d = tmp();
  schreibe(d, "00_inbox/alt.md", "# Alt\n");
  schreibe(d, "09_wiki/firma/thema_a.md", "---\nname: a\n---\n# Thema A\nAmazon-Inhalt\n");
  return d;
}
const aufruf = (h) => async (methode, p, daten, query) => {
  const r = await h({ methode, pfad: p, query: query ?? null, body: daten === undefined ? undefined : Buffer.from(typeof daten === "string" ? daten : JSON.stringify(daten)) });
  let j = null; try { j = JSON.parse(r.body.toString("utf8")); } catch { /* statisch */ }
  return { ...r, j };
};

test("Handler: info, baum, datei GET/PUT, 409, neu, merken, suche, pruefung", async () => {
  const d = vaultMitWiki();
  const rufe = aufruf(erzeugeHandler({ vault: d, studioDir: studioOrdner(), appVersion: "9.9.9" }));
  let r = await rufe("GET", "/api/info");
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.j).sort(), ["appVersion", "git", "kit", "kitVersion", "mcpBefehl", "mcpBefehle", "name", "vault", "vertrauen"]); // Vertrauen v2 (§8): info nennt den Vertrauensstand
  assert.equal(r.j.appVersion, "9.9.9"); assert.equal(r.j.kitVersion, null); assert.equal(r.j.git, false); assert.equal(r.j.vault, realpathSync(d));
  assert.match(r.headers["Content-Type"], /application\/json; charset=utf-8/);

  r = await rufe("GET", "/api/baum");
  assert.ok(r.j.eintraege.some((e) => e.pfad === "00_inbox/alt.md" && e.art === "datei"));

  r = await rufe("GET", "/api/datei", undefined, "pfad=00_inbox%2Falt.md");
  assert.equal(r.status, 200); assert.deepEqual(Object.keys(r.j).sort(), ["geaendert", "hash", "inhalt", "pfad", "schreibschutz"]);
  assert.equal(r.j.hash, sha("# Alt\n"));

  r = await rufe("PUT", "/api/datei", { pfad: "00_inbox/alt.md", inhalt: "# Alt\r\nneu\r\n", basisHash: sha("# Alt\n") });
  assert.equal(r.status, 200); assert.equal(r.j.hash, sha("# Alt\r\nneu\r\n")); assert.ok(r.j.geaendert);
  assert.equal(readFileSync(join(d, "00_inbox/alt.md"), "utf8"), "# Alt\r\nneu\r\n");

  r = await rufe("PUT", "/api/datei", { pfad: "00_inbox/alt.md", inhalt: "x", basisHash: sha("# Alt\n") });
  assert.equal(r.status, 409); assert.equal(r.j.aktuellerHash, sha("# Alt\r\nneu\r\n")); assert.ok(r.j.fehler);

  r = await rufe("PUT", "/api/datei", { pfad: "00_inbox/frisch.md", inhalt: "# f\n", basisHash: null });
  assert.equal(r.status, 200);
  r = await rufe("PUT", "/api/datei", { pfad: "00_inbox/frisch.md", inhalt: "# f\n", basisHash: null });
  assert.equal(r.status, 409);

  r = await rufe("POST", "/api/neu", { ordner: "00_inbox", titel: "Neue Seite" });
  assert.deepEqual(r.j, { pfad: "00_inbox/neue-seite.md" });
  r = await rufe("POST", "/api/merken", { text: "Merke dir das", titel: "Merkzettel" });
  assert.match(r.j.pfad, /^00_inbox\/\d{4}-\d\d-\d\d_merkzettel\.md$/);
  r = await rufe("GET", "/api/suche", undefined, "q=amazon");
  assert.deepEqual(r.j.treffer.map((t) => t.pfad), ["09_wiki/firma/thema_a.md"]);
  assert.deepEqual(Object.keys(r.j.treffer[0]).sort(), ["auszug", "pfad", "titel", "zeile"]);
  r = await rufe("GET", "/api/pruefung", undefined, "pfad=09_wiki/firma/thema_a.md");
  assert.ok(["gruen", "ohne", "gelb", "rot", "grau"].includes(r.j.stufe)); assert.ok(Array.isArray(r.j.signale)); assert.ok(r.j.zusammenfassung);
  r = await rufe("GET", "/api/gesundheit");
  assert.deepEqual(r.j, { verfuegbar: false });
});

test("Handler: Fehler immer {fehler}, Statuscodes, Pfad-Schutz über die Route", async () => {
  const rufe = aufruf(erzeugeHandler({ vault: vaultMitWiki(), studioDir: studioOrdner() }));
  for (const [m, p, daten, q, status] of [
    ["GET", "/api/datei", undefined, "pfad=../x.md", 403],
    ["GET", "/api/datei", undefined, "pfad=%2Fetc%2Fpasswd", 403],
    ["GET", "/api/datei", undefined, "pfad=.git/config", 403],
    ["GET", "/api/datei", undefined, "", 400],
    ["GET", "/api/datei", undefined, "pfad=fehlt.md", 404],
    ["PUT", "/api/datei", "kein json", null, 400],
    ["PUT", "/api/datei", undefined, null, 400],
    ["PUT", "/api/datei", [1], null, 400],
    ["POST", "/api/datei", {}, null, 405],
    ["GET", "/api/neu", undefined, null, 405],
    ["GET", "/api/gibtsnicht", undefined, null, 404],
    ["POST", "/api/git/sync", undefined, null, 400],
    ["GET", "/api/git/verlauf", undefined, "pfad=a.md", 400],
    ["POST", "/api/mcp/verbinden", { ziel: "gpt" }, null, 400],
  ]) {
    const r = await rufe(m, p, daten, q);
    assert.equal(r.status, status, `${m} ${p} ${q}`);
    assert.equal(typeof r.j.fehler, "string", `${m} ${p}`);
    assert.ok(r.j.fehler.length > 3);
  }
  const s = await rufe("GET", "/api/git/status");
  assert.equal(s.status, 200); assert.equal(s.j.repo, false);
});

test("Handler: Git-Routen end-to-end (status, commit, verlauf, diff, fassung)", async () => {
  const d = repo();
  const rufe = aufruf(erzeugeHandler({ vault: d, studioDir: studioOrdner() }));
  assert.equal((await rufe("GET", "/api/info")).j.git, true);
  schreibe(d, "a.md", "# a\n");
  let r = await rufe("GET", "/api/git/status");
  assert.deepEqual(r.j.geaendert, [{ pfad: "a.md", code: "??" }]);
  r = await rufe("POST", "/api/git/commit", { nachricht: "A dazu", dateien: ["a.md"] });
  assert.equal(r.status, 200); assert.match(r.j.sha, /^[0-9a-f]{40}$/);
  r = await rufe("GET", "/api/git/verlauf", undefined, "pfad=a.md&max=5");
  assert.equal(r.j.eintraege[0].nachricht, "A dazu");
  const sha1 = r.j.eintraege[0].sha;
  r = await rufe("GET", "/api/git/diff", undefined, `pfad=a.md&sha=${sha1}`);
  assert.match(r.j.diff, /\+# a/);
  r = await rufe("GET", "/api/git/fassung", undefined, `pfad=a.md&sha=${sha1}`);
  assert.deepEqual(r.j, { inhalt: "# a\n" });
});

test("Statische Dateien: Standard index.html, Content-Types, kein Pfad-Ausbruch", async () => {
  const s = studioOrdner();
  schreibe(s, "../brain-geheim.txt", "geheim");
  const draussen = tmp("brain-aus-"); schreibe(draussen, "x.js", "geheim");
  symlinkSync(join(draussen, "x.js"), join(s, "link.js"));
  const rufe = aufruf(erzeugeHandler({ vault: vaultMitWiki(), studioDir: s }));
  let r = await rufe("GET", "/");
  assert.equal(r.status, 200); assert.match(r.headers["Content-Type"], /^text\/html; charset=utf-8/); assert.match(r.body.toString(), /<title>Studio/);
  assert.match(r.headers["Content-Security-Policy"], /default-src 'self'/);
  assert.equal((await rufe("GET", "/index.html")).status, 200);
  assert.match((await rufe("GET", "/app.js")).headers["Content-Type"], /^text\/javascript/);
  assert.match((await rufe("GET", "/stil.css")).headers["Content-Type"], /^text\/css/);
  assert.match((await rufe("GET", "/vendor/cm.js")).headers["Content-Type"], /^text\/javascript/);
  assert.equal((await rufe("GET", "/schrift.woff2")).headers["Content-Type"], "font/woff2");
  for (const p of ["/nix.js", "/../brain-geheim.txt", "/%2e%2e/brain-geheim.txt", "/..%2fbrain-geheim.txt", "/.versteckt", "/vendor/../../brain-geheim.txt", "/link.js", "/a%00.js", "/%5c..%5cx", "/vendor/%2e%2e/%2e%2e/x"]) {
    const x = await rufe("GET", p);
    assert.equal(x.status, 404, p);
    assert.doesNotMatch(x.body.toString(), /geheim/);
  }
  assert.equal((await rufe("POST", "/app.js", {})).status, 405);
});

test("MCP verbinden: Fake-claude im PATH wird mit dem richtigen Befehl aufgerufen; ohne claude → 404 mit Befehl", async () => {
  const d = vaultMitWiki();
  const mcp = tmp("brain-mcpdir-"); schreibe(mcp, "brain-mcp.mjs", "// fake\n");
  const bin = tmp("brain-bin-");
  const log = join(bin, "aufruf.txt");
  // Attrappe: „mcp get brain“ → nicht vorhanden (Exit 1), „mcp add …“ → angelegt; jeder Aufruf steht als eine Zeile im Log
  writeFileSync(join(bin, "claude"), `#!/bin/sh\necho "$*" >> "${log}"\nif [ "$2" = "get" ]; then echo "No MCP server found with name: brain" >&2; exit 1; fi\necho "Added stdio MCP server brain"\nexit 0\n`);
  chmodSync(join(bin, "claude"), 0o755);
  const alt = { PATH: process.env.PATH, EXTRA: process.env.BRAIN_CLAUDE_EXTRA };
  try {
    process.env.BRAIN_CLAUDE_EXTRA = "";
    const h = aufruf(erzeugeHandler({ vault: d, studioDir: studioOrdner(), mcpPfad: join(mcp, "brain-mcp.mjs") }));
    const info = (await h("GET", "/api/info")).j;
    const mcpReal = realpathSync(join(mcp, "brain-mcp.mjs"));
    assert.equal(info.mcpBefehl, `claude mcp add -s user brain -- ${process.execPath} ${mcpReal}`, "Vertrauen v2 (§8): der Eintrag nennt keinen Vault, der MCP-Server folgt dem aktiven");

    process.env.PATH = bin;
    const r = await h("POST", "/api/mcp/verbinden", { ziel: "claude" });
    assert.equal(r.status, 200); assert.equal(r.j.ok, true); assert.match(r.j.ausgabe, /Added/);
    assert.deepEqual(readFileSync(log, "utf8").trim().split("\n"), ["mcp get brain", `mcp add -s user brain -- ${process.execPath} ${mcpReal}`]);

    process.env.PATH = tmp("brain-leer-"); // kein claude
    const n = await h("POST", "/api/mcp/verbinden", { ziel: "claude" });
    assert.equal(n.status, 404); assert.equal(n.j.befehl, info.mcpBefehl); assert.ok(n.j.fehler);

    writeFileSync(join(bin, "claude"), `#!/bin/sh\nif [ "$2" = "get" ]; then exit 1; fi\necho "MCP server brain already exists in user config" >&2\nexit 1\n`);
    process.env.PATH = bin;
    const e = await h("POST", "/api/mcp/verbinden", { ziel: "claude" });
    assert.equal(e.status, 409); assert.equal(e.j.art, "anders");
    writeFileSync(join(bin, "claude"), `#!/bin/sh\nif [ "$2" = "get" ]; then exit 1; fi\necho "kaputt" >&2\nexit 2\n`);
    const f = await h("POST", "/api/mcp/verbinden", { ziel: "claude" });
    assert.equal(f.status, 502); assert.match(f.j.ausgabe, /kaputt/);
  } finally {
    process.env.PATH = alt.PATH;
    if (alt.EXTRA === undefined) delete process.env.BRAIN_CLAUDE_EXTRA; else process.env.BRAIN_CLAUDE_EXTRA = alt.EXTRA;
  }
});

test("Info: Pfade mit Leerzeichen werden im Befehl gequotet; ohne MCP-Datei mcpBefehl null", async () => {
  const d = vaultMitWiki();
  const x = tmp("brain-x-"); mkdirSync(join(x, "Application Support"));
  schreibe(join(x, "Application Support"), "brain-mcp.mjs", "//\n");
  const h = aufruf(erzeugeHandler({ vault: d, studioDir: studioOrdner(), mcpPfad: join(x, "Application Support", "brain-mcp.mjs") }));
  assert.match((await h("GET", "/api/info")).j.mcpBefehl, /-- \S+ '.*Application Support\/brain-mcp\.mjs'$/);
  const h2 = aufruf(erzeugeHandler({ vault: d, studioDir: studioOrdner(), mcpPfad: join(x, "gibtsnicht.mjs") }));
  assert.equal((await h2("GET", "/api/info")).j.mcpBefehl, null);
});

// ---------- Brücken-Protokoll (Unterprozess) ----------
function kopieAnlage() {
  const w = tmp("brain-anlage-");
  for (const o of ["gemeinsam", "werkstatt", "mcp"]) cpSync(pfad(o), join(w, o), { recursive: true });
  schreibe(w, "studio/index.html", "<title>Kopie</title>");
  return w;
}
function starteBruecke(vault, anlage = kopieAnlage(), extraEnv = {}) {
  const p = spawn(process.execPath, [join(anlage, "werkstatt", "werkstatt.mjs"), vault], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...extraEnv } });
  kinder.push(p);
  const zeilen = [], wartende = [];
  const rl = createInterface({ input: p.stdout });
  rl.on("line", (z) => { const o = JSON.parse(z); const w = wartende.shift(); if (w) w(o); else zeilen.push(o); });
  const naechste = () => new Promise((ok) => { const z = zeilen.shift(); if (z) ok(z); else wartende.push(ok); });
  const ende = new Promise((ok) => p.on("close", (code, sig) => ok({ code, sig })));
  const sende = (o) => p.stdin.write(JSON.stringify(o) + "\n");
  return { p, naechste, ende, sende };
}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
const aus = (a) => JSON.parse(Buffer.from(a.body, "base64").toString("utf8"));

test("Brücke: Startzeile, Anfrage/Antwort mit base64, Query, statische Datei, ungültige Zeilen, stdin zu → Ende", async () => {
  const d = vaultMitWiki();
  const { naechste, ende, sende, p } = starteBruecke(d);
  const start = await naechste();
  assert.equal(start.bereit, true); assert.equal(typeof start.version, "string");
  assert.equal(start.vaultId, createHash("sha256").update(realpathSync(d)).digest("hex").slice(0, 16));
  assert.deepEqual(Object.keys(start).sort(), ["bereit", "vaultId", "version"]);

  sende({ id: 1, methode: "GET", pfad: "/api/datei", query: "pfad=00_inbox%2Falt.md", body: null });
  let a = await naechste();
  assert.equal(a.id, 1); assert.equal(a.status, 200); assert.match(a.headers["Content-Type"], /json/);
  assert.equal(aus(a).inhalt, "# Alt\n");

  sende({ id: 2, methode: "PUT", pfad: "/api/datei", query: null, body: b64({ pfad: "00_inbox/alt.md", inhalt: "# Neu\n", basisHash: aus(a).hash }) });
  a = await naechste(); assert.equal(a.id, 2); assert.equal(a.status, 200);
  assert.equal(readFileSync(join(d, "00_inbox/alt.md"), "utf8"), "# Neu\n");

  sende({ id: 3, methode: "GET", pfad: "/api/suche?q=amazon", query: null, body: null }); // Query im Pfad wird akzeptiert
  a = await naechste(); assert.equal(aus(a).treffer.length, 1);

  sende({ id: 4, methode: "GET", pfad: "/", query: null, body: null });
  a = await naechste(); assert.equal(a.status, 200); assert.match(Buffer.from(a.body, "base64").toString(), /Kopie/);
  sende({ id: 5, methode: "GET", pfad: "/../werkstatt/werkstatt.mjs", query: null, body: null });
  a = await naechste(); assert.equal(a.status, 404);

  p.stdin.write("kein json\n");
  a = await naechste(); assert.equal(a.id, null); assert.equal(a.status, 400);
  sende({ id: "x", methode: "GET", pfad: "/api/info" });
  a = await naechste(); assert.equal(a.status, 400); assert.equal(a.id, null);
  sende({ id: 6, methode: "GET", pfad: "api/info" });
  a = await naechste(); assert.equal(a.id, 6); assert.equal(a.status, 400);
  p.stdin.write("x".repeat(2 * 8 * 1024 * 1024 + 5000) + "\n");
  a = await naechste(); assert.equal(a.status, 413); assert.equal(a.id, null);

  // mehrere Anfragen ohne Warten → alle bekommen ihre Antwort, dann zu → Ende erst nach allen Antworten
  for (let i = 10; i < 20; i++) sende({ id: i, methode: "GET", pfad: "/api/baum", query: null, body: null });
  p.stdin.end();
  const ids = [];
  for (let i = 0; i < 10; i++) ids.push((await naechste()).id);
  assert.deepEqual(ids.sort((x, y) => x - y), [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  assert.deepEqual(await ende, { code: 0, sig: null });
});

test("Brücke: POST /api/stopp antwortet und beendet; SIGTERM beendet", async () => {
  const d = vaultMitWiki();
  const anlage = kopieAnlage();
  const a = starteBruecke(d, anlage);
  await a.naechste();
  a.sende({ id: 1, methode: "POST", pfad: "/api/stopp", query: null, body: null });
  const r = await a.naechste();
  assert.equal(r.id, 1); assert.equal(r.status, 200); assert.deepEqual(aus(r), { ok: true });
  assert.equal((await a.ende).code, 0);

  const b = starteBruecke(d, anlage);
  await b.naechste();
  b.p.kill("SIGTERM");
  assert.equal((await b.ende).code, 0);
});

test("Brücke: falscher Vault-Ordner → Exit 2; ohne Argument startet sie (ohne Vault, Ende bei geschlossenem stdin)", async () => {
  const anlage = kopieAnlage();
  const code = (args) => new Promise((ok) => { const p = spawn(process.execPath, [join(anlage, "werkstatt", "werkstatt.mjs"), ...args], { stdio: "ignore", env: { ...process.env, BRAIN_VAULT: "" } }); p.on("close", ok); });
  assert.equal(await code([join(tmp(), "gibtsnicht")]), 2);
  assert.equal(await code([]), 0);
});

// ---------- Entwicklung über HTTP ----------
test("entwicklung.mjs: Startzeile, nur 127.0.0.1, API und Statisches, Host-Prüfung, /api/stopp", async () => {
  const d = vaultMitWiki();
  const anlage = kopieAnlage();
  const p = spawn(process.execPath, [join(anlage, "werkstatt", "entwicklung.mjs"), d, "0"], { stdio: ["ignore", "pipe", "pipe"] });
  const url = await new Promise((ok, nein) => {
    let puffer = ""; p.stdout.on("data", (c) => { puffer += c; const m = /^Bereit: (http:\/\/127\.0\.0\.1:(\d+)\/)$/m.exec(puffer); if (m) ok(m[1]); });
    p.on("close", () => nein(new Error("vorzeitig beendet: " + puffer)));
  });
  try {
    let r = await fetch(url + "api/info"); assert.equal(r.status, 200); assert.equal((await r.json()).name.length > 0, true);
    r = await fetch(url); assert.match(await r.text(), /Kopie/);
    r = await fetch(url + "api/datei?pfad=00_inbox%2Falt.md"); const j = await r.json();
    r = await fetch(url + "api/datei", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pfad: "00_inbox/alt.md", inhalt: "# Http\n", basisHash: j.hash }) });
    assert.equal(r.status, 200);
    // CSRF: fremder Origin → 403; text/plain mit Inhalt → 415; eigener Origin und ohne Origin gehen
    const koerper = JSON.stringify({ pfad: "00_inbox/alt.md", inhalt: "# Böse\n", basisHash: "x" });
    const eigen = new URL(url).origin;
    r = await fetch(url + "api/datei", { method: "PUT", headers: { "Content-Type": "application/json", Origin: "https://boese.example" }, body: koerper }); assert.equal(r.status, 403);
    r = await fetch(url + "api/info", { headers: { Origin: "https://boese.example" } }); assert.equal(r.status, 403);
    r = await fetch(url + "api/info", { headers: { Origin: "null" } }); assert.equal(r.status, 403);
    r = await fetch(url + "api/datei", { method: "PUT", headers: { "Content-Type": "text/plain" }, body: koerper }); assert.equal(r.status, 415);
    r = await fetch(url + "api/neu", { method: "POST", body: koerper }); assert.equal(r.status, 415);
    r = await fetch(url + "api/info", { headers: { Origin: eigen } }); assert.equal(r.status, 200);
    r = await fetch(url + "api/info", { headers: { Origin: eigen.replace("127.0.0.1", "localhost") } }); assert.equal(r.status, 200);
    r = await fetch(url + "api/datei", { method: "PUT", headers: { "Content-Type": "application/json; charset=utf-8", Origin: eigen }, body: koerper }); assert.equal(r.status, 409);
    assert.equal(readFileSync(join(d, "00_inbox/alt.md"), "utf8"), "# Http\n");
    assert.equal(readFileSync(join(d, "00_inbox/alt.md"), "utf8"), "# Http\n");
    r = await fetch(url + "api/datei?pfad=..%2Fx.md"); assert.equal(r.status, 403);
    // fremder Host (DNS-Rebinding) wird abgewiesen
    const port = new URL(url).port;
    const roh = await new Promise((ok) => {
      import("node:net").then(({ createConnection }) => {
        const s = createConnection(+port, "127.0.0.1", () => s.write("GET /api/info HTTP/1.1\r\nHost: boese.example\r\nConnection: close\r\n\r\n"));
        let t = ""; s.on("data", (c) => (t += c)); s.on("close", () => ok(t));
      });
    });
    assert.match(roh, /^HTTP\/1\.1 403/);
    r = await fetch(url + "api/stopp", { method: "POST" }); assert.equal(r.status, 200);
    const ende = await new Promise((ok) => p.on("close", (c) => ok(c)));
    assert.equal(ende, 0);
  } finally { p.kill("SIGKILL"); }
});
