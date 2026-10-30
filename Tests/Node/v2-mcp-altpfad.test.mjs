// MCP-Einträge nach der Umbenennung Brain → Kortex: neue Einträge nennen den stabilen Node-Pfad der App (nodePfad), alte Einträge mit dem
// früheren aufgelösten Pfad (…/Application Support/Brain|Kortex/node/<ver>/bin/node) werden beim nächsten Verbinden OHNE Rückfrage umgestellt.
// Nur Wegwerf-Ordner und gefälschte `claude`/`codex`; nie die echten Programme, nie das echte ~/.cursor.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, realpathSync } from "node:fs";
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
const STABIL = "/Users/x/Library/Application Support/Kortex/bin/node";
const ALT_PFADE = ["/Users/x/Library/Application Support/Brain/node/v24.0.0/bin/node", "/Users/x/Library/Application Support/Kortex/node/v24.0.0/bin/node"];
const vault = () => { const d = tmp(); schreibe(d, "00_inbox/n.md", "# Notiz\n"); return d; };
const mcpDatei = () => { const m = tmp("brain-mcpdir-"); schreibe(m, "brain-mcp.mjs", "// fake\n"); return join(m, "brain-mcp.mjs"); };
const handlerFuer = (mcp, extra = {}) => aufruf(erzeugeHandler({ kontenAus: true, vault: vault(), mcpPfad: mcp, nodePfad: STABIL, vaultOptionen: { support: tmp("brain-support-") }, ...extra }));
async function mitPfad(bin, fn) {
  const alt = { PATH: process.env.PATH, EXTRA: process.env.BRAIN_CLAUDE_EXTRA };
  process.env.PATH = `${bin}:${alt.PATH}`; process.env.BRAIN_CLAUDE_EXTRA = "";
  try { return await fn(); } finally { process.env.PATH = alt.PATH; if (alt.EXTRA === undefined) delete process.env.BRAIN_CLAUDE_EXTRA; else process.env.BRAIN_CLAUDE_EXTRA = alt.EXTRA; }
}

function fakeClaude() {
  const bin = tmp("brain-bin-"), zustand = join(bin, "zustand.txt"), log = join(bin, "aufrufe.log");
  writeFileSync(join(bin, "claude"), `#!/bin/sh
echo "$*" >> '${log}'
case "$1 $2" in
  "mcp get")
    if [ -f '${zustand}' ]; then
      echo "brain:"; echo "  Type: stdio"
      echo "  Command: $(sed -n 1p '${zustand}')"; echo "  Args: $(sed -n 2p '${zustand}')"; echo "  Environment:"; echo "    API_KEY=geheim-123"
      exit 0
    fi
    echo "No MCP server found with name: brain" >&2; exit 1;;
  "mcp remove") rm -f '${zustand}'; exit 0;;
  "mcp add")
    if [ -f '${zustand}' ]; then echo "MCP server brain already exists in user config" >&2; exit 1; fi
    shift 6; printf '%s\\n' "$1" > '${zustand}'; shift; printf '%s\\n' "$*" >> '${zustand}'
    echo "Added stdio MCP server brain to user config"; exit 0;;
esac
exit 3
`);
  chmodSync(join(bin, "claude"), 0o755);
  return { bin, zustand, aufrufe: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []) };
}

function fakeCodex() {
  const bin = tmp("brain-codexbin-"), zustand = join(bin, "zustand.json"), log = join(bin, "aufrufe.txt");
  writeFileSync(join(bin, "codex"), `#!${process.execPath}
const fs = require("node:fs"); const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, a.join(" ") + "\\n");
const hat = fs.existsSync(${JSON.stringify(zustand)});
if (a[0] === "mcp" && a[1] === "get") { if (!hat) { console.error("No MCP server named 'brain' found."); process.exit(1); } console.log(fs.readFileSync(${JSON.stringify(zustand)}, "utf8")); process.exit(0); }
if (a[0] === "mcp" && a[1] === "remove") { fs.rmSync(${JSON.stringify(zustand)}, { force: true }); process.exit(0); }
if (a[0] === "mcp" && a[1] === "add") { const i = a.indexOf("--"); fs.writeFileSync(${JSON.stringify(zustand)}, JSON.stringify({ name: "brain", transport: { type: "stdio", command: a[i + 1], args: a.slice(i + 2) } })); process.exit(0); }
process.exit(3);\n`);
  chmodSync(join(bin, "codex"), 0o755);
  return { bin, zustand, aufrufe: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []) };
}

test("Neue Einträge nennen den stabilen Node-Pfad (nodePfad), nicht process.execPath", async () => {
  const mcp = mcpDatei(), real = realpathSync(mcp);
  const info = (await handlerFuer(mcp)("GET", "/api/info")).j;
  assert.equal(info.mcpBefehle.claude, `claude mcp add -s user brain -- '${STABIL}' ${real}`);
  assert.equal(info.mcpBefehle.codex, `codex mcp add brain -- '${STABIL}' ${real}`);
  assert.ok(!JSON.stringify(info.mcpBefehle).includes(process.execPath) || process.execPath === STABIL);
});

test("Claude: alter App-Node-Pfad (Brain/Kortex …/node/<ver>) → ohne Rückfrage umgestellt; danach schonVerbunden", async () => {
  const mcp = mcpDatei(), real = realpathSync(mcp), rufe = handlerFuer(mcp);
  for (const alt of ALT_PFADE) {
    const c = fakeClaude();
    writeFileSync(c.zustand, `${alt}\n${real}\n`);
    await mitPfad(c.bin, async () => {
      const r = await rufe("POST", "/api/mcp/verbinden", { ziel: "claude" }); // ohne umstellen:true
      assert.equal(r.status, 200, r.body.toString("utf8")); assert.equal(r.j.ok, true); assert.notEqual(r.j.schonVerbunden, true);
      assert.deepEqual(c.aufrufe(), ["mcp get brain", "mcp remove -s user brain", `mcp add -s user brain -- ${STABIL} ${real}`]);
      assert.equal(readFileSync(c.zustand, "utf8"), `${STABIL}\n${real}\n`);
      assert.deepEqual((await rufe("POST", "/api/mcp/verbinden", { ziel: "claude" })).j, { ok: true, schonVerbunden: true });
    });
  }
});

test("Claude: fremder Befehl oder alter Pfad mit fremden Argumenten → weiter 409 und unverändert", async () => {
  const mcp = mcpDatei(), real = realpathSync(mcp), rufe = handlerFuer(mcp);
  for (const [befehl, args] of [["/usr/bin/fremd", real], [ALT_PFADE[0], "/anderer/server.mjs"], ["/Users/x/Library/Application Support/Brain/node/v24.0.0/bin/node-fremd", real]]) {
    const c = fakeClaude();
    writeFileSync(c.zustand, `${befehl}\n${args}\n`);
    await mitPfad(c.bin, async () => {
      const r = await rufe("POST", "/api/mcp/verbinden", { ziel: "claude" });
      assert.equal(r.status, 409, befehl); assert.equal(r.j.art, "anders");
      assert.equal(readFileSync(c.zustand, "utf8"), `${befehl}\n${args}\n`, "unverändert");
    });
  }
});

test("Codex: alter App-Node-Pfad → ohne Rückfrage umgestellt; fremder Befehl → 409", async () => {
  const mcp = mcpDatei(), real = realpathSync(mcp), rufe = handlerFuer(mcp);
  for (const alt of ALT_PFADE) {
    const c = fakeCodex();
    writeFileSync(c.zustand, JSON.stringify({ name: "brain", transport: { type: "stdio", command: alt, args: [real] } }));
    await mitPfad(c.bin, async () => {
      const r = await rufe("POST", "/api/mcp/verbinden", { ziel: "codex" });
      assert.equal(r.status, 200, r.body.toString("utf8")); assert.notEqual(r.j.schonVerbunden, true);
      assert.deepEqual(c.aufrufe(), ["mcp get brain --json", "mcp remove brain", `mcp add brain -- ${STABIL} ${real}`]);
      assert.deepEqual(JSON.parse(readFileSync(c.zustand, "utf8")).transport, { type: "stdio", command: STABIL, args: [real] });
    });
  }
  const c = fakeCodex();
  writeFileSync(c.zustand, JSON.stringify({ name: "brain", transport: { type: "stdio", command: "/usr/bin/fremd", args: [real] } }));
  await mitPfad(c.bin, async () => {
    const r = await rufe("POST", "/api/mcp/verbinden", { ziel: "codex" });
    assert.equal(r.status, 409); assert.equal(r.j.art, "anders");
  });
});

test("Cursor: alter App-Node-Pfad in ~/.cursor/mcp.json → ohne Rückfrage umgestellt (mit Sicherung); fremder Befehl → 409; andere Einträge bleiben", async () => {
  const mcp = mcpDatei(), real = realpathSync(mcp), rufe = handlerFuer(mcp);
  const datei = join(HOME, ".cursor", "mcp.json");
  mkdirSync(join(HOME, ".cursor"), { recursive: true });
  for (const alt of ALT_PFADE) {
    const anderes = { command: "foo", env: { TOKEN: "geheim-77" } };
    writeFileSync(datei, JSON.stringify({ mcpServers: { anderes, brain: { command: alt, args: [real] } } }));
    const r = await rufe("POST", "/api/mcp/verbinden", { ziel: "cursor" });
    assert.equal(r.status, 200, r.body.toString("utf8")); assert.notEqual(r.j.schonVerbunden, true); assert.ok(r.j.sicherung);
    assert.deepEqual(JSON.parse(readFileSync(datei, "utf8")), { mcpServers: { anderes, brain: { command: STABIL, args: [real] } } });
    assert.deepEqual((await rufe("POST", "/api/mcp/verbinden", { ziel: "cursor" })).j, { ok: true, schonVerbunden: true });
  }
  const fremd = { mcpServers: { brain: { command: "/usr/bin/fremd", args: [real] } } };
  writeFileSync(datei, JSON.stringify(fremd));
  const r = await rufe("POST", "/api/mcp/verbinden", { ziel: "cursor" });
  assert.equal(r.status, 409);
  assert.deepEqual(JSON.parse(readFileSync(datei, "utf8")), fremd, "unverändert");
});
