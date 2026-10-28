// KI verbinden (FBL-70): Codex über ein gefälschtes `codex`, Cursor über ~/.cursor/mcp.json in einem Temp-HOME, Selbsttest über den echten MCP-Server.
// Nur Wegwerf-Ordner; nie das echte codex, nie das echte ~/.cursor.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, lstatSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmp, schreibe, pfad } from "./hilfe.mjs";
const HOME = tmp("brain-home-");
process.env.HOME = HOME; // os.homedir() liest $HOME

const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
const aufruf = (h) => async (methode, p, daten) => {
  const r = await h({ methode, pfad: p, query: null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) });
  let j = null; try { j = JSON.parse(r.body.toString("utf8")); } catch { /* statisch */ }
  return { ...r, j };
};
const vault = () => { const d = tmp(); schreibe(d, "00_inbox/n.md", "# Notiz\n\nDas Zebra frisst Gras.\n"); return d; };
const mcpDatei = () => { const m = tmp("brain-mcpdir-"); schreibe(m, "brain-mcp.mjs", "// fake\n"); return join(m, "brain-mcp.mjs"); };

// Gefälschtes codex (Node-Skript): Zustand = JSON-Datei mit dem Eintrag „brain“, jeder Aufruf eine Zeile im Log.
function fakeCodex({ ablehnen = false } = {}) {
  const bin = tmp("brain-codexbin-"), zustand = join(bin, "zustand.json"), log = join(bin, "aufrufe.txt");
  writeFileSync(join(bin, "codex"), `#!${process.execPath}
const fs = require("node:fs"); const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, a.join(" ") + "\\n");
const hat = fs.existsSync(${JSON.stringify(zustand)});
if (a[0] === "mcp" && a[1] === "get") { if (!hat) { console.error("No MCP server named 'brain' found."); process.exit(1); } console.log(fs.readFileSync(${JSON.stringify(zustand)}, "utf8")); process.exit(0); }
if (a[0] === "mcp" && a[1] === "remove") { fs.rmSync(${JSON.stringify(zustand)}, { force: true }); process.exit(0); }
if (a[0] === "mcp" && a[1] === "add") {
  if (${ablehnen}) { console.error("kaputt"); process.exit(2); }
  const i = a.indexOf("--"); fs.writeFileSync(${JSON.stringify(zustand)}, JSON.stringify({ name: "brain", transport: { type: "stdio", command: a[i + 1], args: a.slice(i + 2) } })); console.log("Added global MCP server 'brain'."); process.exit(0);
}
process.exit(3);\n`);
  chmodSync(join(bin, "codex"), 0o755);
  return { bin, zustand, aufrufe: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []) };
}
async function mitPfad(bin, fn) {
  const alt = process.env.PATH;
  process.env.PATH = `${bin}:${alt}`;
  try { return await fn(); } finally { process.env.PATH = alt; }
}

test("Codex verbinden: neu → eintragen; gleich → schonVerbunden; fremd → 409 ohne Details; umstellen → ersetzt", async () => {
  const mcp = mcpDatei(), real = realpathSync(mcp);
  const c = fakeCodex();
  const rufe = aufruf(erzeugeHandler({ vault: vault(), mcpPfad: mcp, vaultOptionen: { support: tmp("brain-support-") } }));
  await mitPfad(c.bin, async () => {
    const info = (await rufe("GET", "/api/info")).j;
    assert.equal(info.mcpBefehle.codex, `codex mcp add brain -- ${process.execPath} ${real}`);
    let r = await rufe("POST", "/api/mcp/verbinden", { ziel: "codex" });
    assert.equal(r.status, 200); assert.equal(r.j.ok, true);
    assert.deepEqual(c.aufrufe(), ["mcp get brain --json", `mcp add brain -- ${process.execPath} ${real}`]);

    r = await rufe("POST", "/api/mcp/verbinden", { ziel: "codex" });
    assert.deepEqual(r.j, { ok: true, schonVerbunden: true });
    assert.equal(c.aufrufe().length, 3, "nur get");

    writeFileSync(c.zustand, JSON.stringify({ name: "brain", transport: { type: "stdio", command: "/usr/bin/fremd", args: ["--key=geheim-9"] } }));
    r = await rufe("POST", "/api/mcp/verbinden", { ziel: "codex" });
    assert.equal(r.status, 409); assert.equal(r.j.art, "anders"); assert.equal(r.j.befehl, info.mcpBefehle.codex);
    for (const g of ["geheim-9", "fremd"]) assert.ok(!r.body.toString("utf8").includes(g), `„${g}“ darf nicht in der Antwort stehen`);
    assert.equal(c.aufrufe().length, 4, "ohne umstellen weder remove noch add");

    r = await rufe("POST", "/api/mcp/verbinden", { ziel: "codex", umstellen: true });
    assert.equal(r.status, 200);
    assert.deepEqual(c.aufrufe().slice(-3), ["mcp get brain --json", "mcp remove brain", `mcp add brain -- ${process.execPath} ${real}`]);
  });
});

test("Codex verbinden: nicht gefunden → 404 mit Befehl zum Kopieren; abgelehnt → 502 mit Befehl", async () => {
  const mcp = mcpDatei();
  const rufe = aufruf(erzeugeHandler({ vault: vault(), mcpPfad: mcp, vaultOptionen: { support: tmp("brain-support-") } }));
  const alt = { PATH: process.env.PATH, T: process.env.BRAIN_TESTMODUS, E: process.env.BRAIN_CLAUDE_EXTRA };
  process.env.PATH = tmp("brain-leer-"); process.env.BRAIN_TESTMODUS = "1"; process.env.BRAIN_CLAUDE_EXTRA = "";
  try {
    const n = await rufe("POST", "/api/mcp/verbinden", { ziel: "codex" });
    assert.equal(n.status, 404); assert.match(n.j.befehl, /^codex mcp add brain -- /); assert.match(n.j.fehler, /Codex/);
  } finally { process.env.PATH = alt.PATH; if (alt.T === undefined) delete process.env.BRAIN_TESTMODUS; else process.env.BRAIN_TESTMODUS = alt.T; if (alt.E === undefined) delete process.env.BRAIN_CLAUDE_EXTRA; else process.env.BRAIN_CLAUDE_EXTRA = alt.E; }
  const c = fakeCodex({ ablehnen: true });
  await mitPfad(c.bin, async () => {
    const f = await rufe("POST", "/api/mcp/verbinden", { ziel: "codex" });
    assert.equal(f.status, 502); assert.match(f.j.befehl, /^codex mcp add/); assert.match(f.j.ausgabe, /kaputt/);
  });
});

// ── Cursor ──
const cursorDatei = () => join(HOME, ".cursor", "mcp.json");
const cursorLeeren = () => rmSync(join(HOME, ".cursor"), { recursive: true, force: true });
const sicherungen = () => (existsSync(join(HOME, ".cursor")) ? readdirSync(join(HOME, ".cursor")).filter((n) => n.includes("brain-sicherung")) : []);

test("Cursor verbinden: Datei fehlt → wird angelegt; schon vorhanden → schonVerbunden; fremder Eintrag → 409, umstellen mit Sicherung; andere Einträge bleiben", async () => {
  const mcp = mcpDatei(), real = realpathSync(mcp);
  const rufe = aufruf(erzeugeHandler({ vault: vault(), mcpPfad: mcp, vaultOptionen: { support: tmp("brain-support-") } }));
  cursorLeeren();
  let r = await rufe("POST", "/api/mcp/verbinden", { ziel: "cursor" });
  assert.equal(r.status, 200); assert.equal(r.j.ok, true); assert.equal(r.j.sicherung, undefined, "nichts zu sichern");
  assert.deepEqual(JSON.parse(readFileSync(cursorDatei(), "utf8")), { mcpServers: { brain: { command: process.execPath, args: [real] } } });

  r = await rufe("POST", "/api/mcp/verbinden", { ziel: "cursor" });
  assert.deepEqual(r.j, { ok: true, schonVerbunden: true });
  assert.deepEqual(sicherungen(), [], "ohne Änderung keine Sicherung");

  // andere Einträge und Felder bleiben unverändert; fremdes „brain“ → erst fragen
  const fremd = { theme: "x", mcpServers: { anderes: { command: "foo", env: { TOKEN: "geheim-77" } }, brain: { command: "/usr/bin/fremd", args: ["--key=geheim-88"] } } };
  writeFileSync(cursorDatei(), JSON.stringify(fremd));
  r = await rufe("POST", "/api/mcp/verbinden", { ziel: "cursor" });
  assert.equal(r.status, 409); assert.equal(r.j.art, "anders");
  for (const g of ["geheim-77", "geheim-88", "fremd"]) assert.ok(!r.body.toString("utf8").includes(g), `„${g}“ darf nicht in der Antwort stehen`);
  assert.deepEqual(JSON.parse(readFileSync(cursorDatei(), "utf8")), fremd, "unverändert");

  r = await rufe("POST", "/api/mcp/verbinden", { ziel: "cursor", umstellen: true });
  assert.equal(r.status, 200); assert.ok(r.j.sicherung);
  assert.deepEqual(JSON.parse(readFileSync(r.j.sicherung, "utf8")), fremd, "Sicherung = Datei von vorher");
  assert.deepEqual(JSON.parse(readFileSync(cursorDatei(), "utf8")), { theme: "x", mcpServers: { anderes: fremd.mcpServers.anderes, brain: { command: process.execPath, args: [real] } } });

  // Datei ohne brain, mit anderen Einträgen: ergänzen
  writeFileSync(cursorDatei(), JSON.stringify({ mcpServers: { anderes: { url: "https://x.example" } } }));
  r = await rufe("POST", "/api/mcp/verbinden", { ziel: "cursor" });
  assert.equal(r.status, 200); assert.ok(r.j.sicherung);
  const neu = JSON.parse(readFileSync(cursorDatei(), "utf8"));
  assert.deepEqual(Object.keys(neu.mcpServers).sort(), ["anderes", "brain"]);
});

test("Cursor verbinden: kaputtes JSON (oder falsche Form) wird nie überschrieben → 422 mit Text zum Kopieren", async () => {
  const mcp = mcpDatei();
  const rufe = aufruf(erzeugeHandler({ vault: vault(), mcpPfad: mcp, vaultOptionen: { support: tmp("brain-support-") } }));
  for (const inhalt of ['{ "mcpServers": { kaputt', "[1,2]", '{"mcpServers": []}', '{"mcpServers": null}']) {
    cursorLeeren(); mkdirSync(join(HOME, ".cursor"));
    writeFileSync(cursorDatei(), inhalt);
    for (const umstellen of [false, true]) {
      const r = await rufe("POST", "/api/mcp/verbinden", { ziel: "cursor", ...(umstellen ? { umstellen } : {}) });
      assert.equal(r.status, 422, inhalt); assert.equal(r.j.art, "kaputt");
      assert.deepEqual(JSON.parse(r.j.befehl).mcpServers.brain.command, process.execPath);
      assert.equal(readFileSync(cursorDatei(), "utf8"), inhalt, "unverändert");
      assert.deepEqual(sicherungen(), []);
    }
  }
});

// ── Cursor: Rechte, Symlink, Sicherungen, Fehlermeldung ──
const modus = (p) => statSync(p).mode & 0o777;
const handlerCursor = () => aufruf(erzeugeHandler({ vault: vault(), mcpPfad: mcpDatei(), vaultOptionen: { support: tmp("brain-support-") } }));
const FREMD = JSON.stringify({ mcpServers: { anderes: { command: "foo", env: { TOKEN: "geheim-1" } } } });

test("Cursor verbinden: Rechte der vorhandenen Datei bleiben (0600 bleibt 0600), neue Datei bekommt 0600, Sicherung hat die Rechte des Originals", async () => {
  const rufe = handlerCursor();
  cursorLeeren();
  assert.equal((await rufe("POST", "/api/mcp/verbinden", { ziel: "cursor" })).status, 200);
  assert.equal(modus(cursorDatei()), 0o600, "neue Datei 0600");

  for (const m of [0o600, 0o640]) {
    writeFileSync(cursorDatei(), FREMD); chmodSync(cursorDatei(), m);
    const r = await rufe("POST", "/api/mcp/verbinden", { ziel: "cursor" });
    assert.equal(r.status, 200);
    assert.equal(modus(cursorDatei()), m, `Rechte ${m.toString(8)} bleiben`);
    assert.equal(modus(r.j.sicherung), m, "Sicherung hat die Rechte des Originals");
  }
});

test("Cursor verbinden: ist mcp.json ein Symlink, bleibt er einer und das Ziel bekommt den Eintrag", async () => {
  const rufe = handlerCursor();
  cursorLeeren(); mkdirSync(join(HOME, ".cursor"));
  const dot = tmp("brain-dotfiles-"), echt = join(dot, "mcp.json");
  writeFileSync(echt, FREMD); chmodSync(echt, 0o600);
  symlinkSync(echt, cursorDatei());
  const r = await rufe("POST", "/api/mcp/verbinden", { ziel: "cursor" });
  assert.equal(r.status, 200);
  assert.ok(lstatSync(cursorDatei()).isSymbolicLink(), "Link bleibt Link");
  assert.equal(realpathSync(cursorDatei()), realpathSync(echt));
  const doc = JSON.parse(readFileSync(echt, "utf8"));
  assert.equal(doc.mcpServers.brain.command, process.execPath);
  assert.ok(doc.mcpServers.anderes, "andere Einträge bleiben");
  assert.equal(modus(echt), 0o600);
  assert.deepEqual(readdirSync(dot), ["mcp.json"], "keine Reste im Ordner des Ziels");
});

test("Cursor verbinden: Sicherungen — höchstens die letzten 3, ältere werden gelöscht; zwei Läufe in derselben Sekunde überschreiben sich nicht", async () => {
  const rufe = handlerCursor();
  cursorLeeren(); mkdirSync(join(HOME, ".cursor"));
  for (const z of ["20200101000001", "20200101000002", "20200101000003", "20200101000004", "20200101000005"]) writeFileSync(`${cursorDatei()}.brain-sicherung-${z}`, "alt");
  writeFileSync(cursorDatei(), FREMD);
  const r1 = await rufe("POST", "/api/mcp/verbinden", { ziel: "cursor" });
  assert.equal(r1.status, 200);
  assert.equal(sicherungen().length, 3, "höchstens 3");
  assert.ok(sicherungen().some((n) => `${cursorDatei()}`.endsWith("mcp.json") && r1.j.sicherung.endsWith(n)), "die neue Sicherung bleibt");
  assert.ok(!sicherungen().some((n) => n.endsWith("20200101000001")), "die älteste ist weg");

  // zwei Läufe hintereinander (meist dieselbe Sekunde): verschiedene Dateien, beide mit dem richtigen Inhalt
  const a = FREMD, b = JSON.stringify({ mcpServers: { zweites: { command: "bar" } } });
  writeFileSync(cursorDatei(), a); const s1 = (await rufe("POST", "/api/mcp/verbinden", { ziel: "cursor" })).j.sicherung;
  writeFileSync(cursorDatei(), b); const s2 = (await rufe("POST", "/api/mcp/verbinden", { ziel: "cursor" })).j.sicherung;
  assert.notEqual(s1, s2);
  assert.equal(readFileSync(s1, "utf8"), a); assert.equal(readFileSync(s2, "utf8"), b);
  assert.equal(sicherungen().length, 3);
});

test("Cursor verbinden: Schreibfehler nennt den Fehlercode; die Temp-Datei bleibt nicht liegen", { skip: process.platform !== "darwin" }, async () => {
  const rufe = handlerCursor();
  cursorLeeren(); mkdirSync(join(HOME, ".cursor"));
  writeFileSync(cursorDatei(), FREMD);
  execFileSync("chflags", ["uchg", cursorDatei()]); // unveränderlich: rename über die Datei schlägt mit EPERM fehl
  try {
    const r = await rufe("POST", "/api/mcp/verbinden", { ziel: "cursor" });
    assert.equal(r.status, 502); assert.match(r.j.fehler, /EPERM/); assert.ok(r.j.befehl);
    assert.deepEqual(readdirSync(join(HOME, ".cursor")).filter((n) => n.includes("brain-neu")), [], "Temp-Datei entfernt");
    assert.equal(readFileSync(cursorDatei(), "utf8"), FREMD, "Original unverändert");
  } finally { execFileSync("chflags", ["nouchg", cursorDatei()]); }
});

test("Unbekanntes Ziel → 400", async () => {
  const rufe = aufruf(erzeugeHandler({ vault: vault(), mcpPfad: mcpDatei(), vaultOptionen: { support: tmp("brain-support-") } }));
  assert.equal((await rufe("POST", "/api/mcp/verbinden", { ziel: "gpt" })).status, 400);
});

// ── Selbsttest ──
test("Selbsttest: startet den echten MCP-Server, tools/list + eine Suche → ok mit Werkzeugen; nicht aktiver Vault → 409; Server fehlt/stumm → Fehler", async () => {
  const support = tmp("brain-support-");
  const d = vault();
  writeFileSync(join(support, "vaults.json"), JSON.stringify({ vaults: [{ name: "v", pfad: realpathSync(d), farbe: "#5B8DEF" }], aktiv: realpathSync(d) }));
  const rufe = aufruf(erzeugeHandler({ vault: d, vaultOptionen: { support } }));
  const r = await rufe("POST", "/api/mcp/selbsttest", {});
  assert.equal(r.status, 200); assert.equal(r.j.ok, true);
  assert.ok(r.j.werkzeuge.includes("brain_suchen"));
  assert.equal(typeof r.j.treffer, "number");

  const anderer = vault();
  writeFileSync(join(support, "vaults.json"), JSON.stringify({ vaults: [{ name: "v", pfad: realpathSync(anderer), farbe: "#5B8DEF" }], aktiv: realpathSync(anderer) }));
  assert.equal((await rufe("POST", "/api/mcp/selbsttest", {})).status, 409);

  writeFileSync(join(support, "vaults.json"), JSON.stringify({ vaults: [{ name: "v", pfad: realpathSync(d), farbe: "#5B8DEF" }], aktiv: realpathSync(d) }));
  const skripte = tmp("brain-fakemcp-");
  schreibe(skripte, "ohne-suche.mjs", `import { createInterface } from "node:readline";
createInterface({ input: process.stdin }).on("line", (z) => { const m = JSON.parse(z);
  if (m.method === "initialize") console.log(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "x", version: "1" } } }));
  if (m.method === "tools/list") console.log(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { tools: [{ name: "anderes" }] } }));
  if (m.method === "tools/call") console.log(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "x" }] } })); });\n`);
  const ohne = aufruf(erzeugeHandler({ vault: d, mcpPfad: join(skripte, "ohne-suche.mjs"), vaultOptionen: { support } }));
  const f = await ohne("POST", "/api/mcp/selbsttest", {});
  assert.equal(f.status, 502); assert.match(f.j.fehler, /brain_suchen/);
  const weg = aufruf(erzeugeHandler({ vault: d, mcpPfad: join(skripte, "gibtsnicht.mjs"), vaultOptionen: { support } }));
  assert.equal((await weg("POST", "/api/mcp/selbsttest", {})).status, 404);
});
