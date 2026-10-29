// MCP-Eintrag und Kern (Kern-Umzug P4): Neue Einträge zeigen auf den MCP-Server im gebündelten Kern über den stabilen Pfad (<support>/bin/kern/mcp/
// brain-mcp.mjs, nicht aufgelöst) mit dem stabilen Node (BRAIN_MCP_NODE → nodePfad). Frühere Formen des Eintrags — App-Paket-Pfad, früherer
// Kern-Ordner, alter App-Node, Server im Vault (.tools) — werden beim nächsten Verbinden OHNE Rückfrage umgestellt; fremde Einträge nicht.
// Nur Wegwerf-Ordner und gefälschte `claude`/`codex`; nie die echten Programme, nie das echte ~/.cursor.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, symlinkSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmp, schreibe, pfad } from "./hilfe.mjs";
const HOME = tmp("brain-home-");
process.env.HOME = HOME; // os.homedir() liest $HOME

const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
const { kernOrdner, kernVorhanden } = await import(pfad("gemeinsam", "basis.mjs"));
const aufruf = (h) => async (methode, p, daten) => {
  const r = await h({ methode, pfad: p, query: null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) });
  let j = null; try { j = JSON.parse(r.body.toString("utf8")); } catch { /* statisch */ }
  return { ...r, j };
};
const STABIL = "/Users/x/Library/Application Support/Kortex/bin/node";
const ALT_NODE = "/Users/x/Library/Application Support/Kortex/node/v24.0.0/bin/node";
const vault = () => { const d = tmp(); schreibe(d, "00_inbox/n.md", "# Notiz\n"); return d; };

// Ein Kern mit MCP-Server, erreichbar über einen Symlink wie <support>/bin/kern → ../kern/<version> (der stabile Teil ist der Link).
function kernMitLink() {
  const support = tmp("brain-support-");
  schreibe(support, "kern/1.0.0/brain.mjs", "// kern\n");
  schreibe(support, "kern/1.0.0/mcp/brain-mcp.mjs", "// mcp im kern\n");
  mkdirSync(join(support, "bin"), { recursive: true });
  symlinkSync("../kern/1.0.0", join(support, "bin/kern"));
  return { support, kern: join(support, "bin/kern"), echt: realpathSync(join(support, "bin/kern")) };
}
const handlerFuer = (k, extra = {}) => aufruf(erzeugeHandler({ vault: vault(), kern: k.kern, nodePfad: STABIL, vaultOptionen: { support: tmp("brain-vsupport-") }, ...extra }));

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

// Früher mögliche Formen des Server-Pfads im Eintrag
const ALTE_SERVER = [
  "/Applications/Kortex.app/Contents/Resources/mcp/brain-mcp.mjs",                                   // App-Paket
  "/Users/x/Library/Application Support/Kortex/kern/0.9.0/mcp/brain-mcp.mjs",                         // früherer Kern-Ordner
];
const KIT_SERVER = "/Users/x/brain/.tools/mcp/brain-mcp.mjs"; // Kit-Zeit: Server im Vault

test("kernOrdner: KORTEX_KERN_PFAD gilt allein (auch wenn er fehlt), sonst Ressourcen/kern neben gemeinsam/", () => {
  assert.equal(kernOrdner({ env: { KORTEX_KERN_PFAD: "/x/bin/kern" } }), "/x/bin/kern");
  assert.equal(kernOrdner({ env: { KORTEX_KERN_PFAD: "" } }), join(pfad(), "kern"), "leer = nicht gesetzt");
  assert.equal(kernOrdner({ env: { KORTEX_KERN_PFAD: "relativ/kern" } }), join(pfad(), "kern"), "nur absolut");
  assert.equal(kernVorhanden(join(pfad(), "kern")), true);
  assert.equal(kernVorhanden(tmp()), false);
});

test("Neue Einträge nennen den stabilen Kern-Pfad (Link, nicht aufgelöst) und den stabilen Node", async () => {
  const k = kernMitLink();
  const info = (await handlerFuer(k)("GET", "/api/info")).j;
  const server = join(k.kern, "mcp/brain-mcp.mjs");
  assert.ok(info.mcpBefehle.claude.endsWith(` ${server}`) || info.mcpBefehle.claude.endsWith(`'${server}'`), info.mcpBefehle.claude);
  assert.ok(info.mcpBefehle.claude.includes("/bin/kern/mcp/brain-mcp.mjs"));
  assert.ok(!info.mcpBefehle.claude.includes("/kern/1.0.0/"), "nicht der aufgelöste Versionsordner");
  assert.ok(info.mcpBefehle.codex.includes("/bin/kern/mcp/brain-mcp.mjs"));
  assert.ok(info.mcpBefehle.claude.includes(STABIL.replace(/ /g, " ")), "der stabile Node");
  assert.ok(!JSON.stringify(info).includes(".tools"));
});

test("Ohne MCP-Server im Kern: Rückfall auf den Server im App-Paket (Ressourcen/mcp, aufgelöst)", async () => {
  const ohne = { kern: join(tmp("brain-ohne-kern-"), "bin/kern") };
  const info = (await handlerFuer(ohne)("GET", "/api/info")).j;
  assert.ok(info.mcpBefehle.claude.includes(realpathSync(pfad("mcp", "brain-mcp.mjs"))), info.mcpBefehle.claude);
  assert.ok(!info.mcpBefehle.claude.includes(ohne.kern));
});

test("Claude: früherer Eintrag (App-Paket-Pfad, früherer Kern, Server in .tools) → ohne Rückfrage auf den Kern umgestellt; danach schonVerbunden", async () => {
  const k = kernMitLink();
  const neu = join(k.kern, "mcp/brain-mcp.mjs");
  const rufe = handlerFuer(k);
  const faelle = [
    [STABIL, ALTE_SERVER[0]], [ALT_NODE, ALTE_SERVER[0]], [STABIL, ALTE_SERVER[1]], [ALT_NODE, ALTE_SERVER[1]],
    ["/opt/homebrew/bin/node", KIT_SERVER], ["/usr/local/bin/node", KIT_SERVER],
  ];
  for (const [befehl, server] of faelle) {
    const c = fakeClaude();
    writeFileSync(c.zustand, `${befehl}\n${server}\n`);
    await mitPfad(c.bin, async () => {
      const r = await rufe("POST", "/api/mcp/verbinden", { ziel: "claude" }); // ohne umstellen:true
      assert.equal(r.status, 200, `${befehl} ${server}: ${r.body.toString("utf8")}`); assert.notEqual(r.j.schonVerbunden, true);
      assert.deepEqual(c.aufrufe(), ["mcp get brain", "mcp remove -s user brain", `mcp add -s user brain -- ${STABIL} ${neu}`]);
      assert.equal(readFileSync(c.zustand, "utf8"), `${STABIL}\n${neu}\n`);
      assert.deepEqual((await rufe("POST", "/api/mcp/verbinden", { ziel: "claude" })).j, { ok: true, schonVerbunden: true });
    });
  }
});

test("Claude: fremde Befehle oder fremde Server → weiter 409 und unverändert", async () => {
  const k = kernMitLink();
  const rufe = handlerFuer(k);
  const faelle = [
    ["/usr/bin/fremd", ALTE_SERVER[0]],                     // fremder Befehl mit altem Server
    [ALT_NODE, "/anderer/server.mjs"],                       // alter Node mit fremdem Server
    [STABIL, "/Users/x/brain/.tools/lib/hilfe.mjs"],         // .tools, aber kein MCP-Server
    ["/usr/bin/fremd", KIT_SERVER],                          // .tools-Server mit Befehl, der kein node ist
    ["/Users/x/bin/node-fremd", KIT_SERVER],
    [STABIL, `${ALTE_SERVER[0]} --extra`],                   // zusätzliche Argumente
  ];
  for (const [befehl, args] of faelle) {
    const c = fakeClaude();
    writeFileSync(c.zustand, `${befehl}\n${args}\n`);
    await mitPfad(c.bin, async () => {
      const r = await rufe("POST", "/api/mcp/verbinden", { ziel: "claude" });
      assert.equal(r.status, 409, `${befehl} ${args}`); assert.equal(r.j.art, "anders");
      assert.equal(readFileSync(c.zustand, "utf8"), `${befehl}\n${args}\n`, "unverändert");
    });
  }
});

test("Codex: früherer Eintrag → ohne Rückfrage auf den Kern umgestellt; fremder → 409", async () => {
  const k = kernMitLink();
  const neu = join(k.kern, "mcp/brain-mcp.mjs");
  const rufe = handlerFuer(k);
  for (const [befehl, server] of [[STABIL, ALTE_SERVER[0]], [ALT_NODE, ALTE_SERVER[1]], ["/opt/homebrew/bin/node", KIT_SERVER]]) {
    const c = fakeCodex();
    writeFileSync(c.zustand, JSON.stringify({ name: "brain", transport: { type: "stdio", command: befehl, args: [server] } }));
    await mitPfad(c.bin, async () => {
      const r = await rufe("POST", "/api/mcp/verbinden", { ziel: "codex" });
      assert.equal(r.status, 200, r.body.toString("utf8")); assert.notEqual(r.j.schonVerbunden, true);
      assert.deepEqual(c.aufrufe(), ["mcp get brain --json", "mcp remove brain", `mcp add brain -- ${STABIL} ${neu}`]);
      assert.deepEqual(JSON.parse(readFileSync(c.zustand, "utf8")).transport, { type: "stdio", command: STABIL, args: [neu] });
      assert.deepEqual((await rufe("POST", "/api/mcp/verbinden", { ziel: "codex" })).j, { ok: true, schonVerbunden: true });
    });
  }
  const c = fakeCodex();
  writeFileSync(c.zustand, JSON.stringify({ name: "brain", transport: { type: "stdio", command: "/usr/bin/fremd", args: [ALTE_SERVER[0]] } }));
  await mitPfad(c.bin, async () => {
    const r = await rufe("POST", "/api/mcp/verbinden", { ziel: "codex" });
    assert.equal(r.status, 409); assert.equal(r.j.art, "anders");
  });
});

test("Cursor: früherer Eintrag → ohne Rückfrage auf den Kern umgestellt (mit Sicherung, andere Einträge bleiben); fremder → 409", async () => {
  const k = kernMitLink();
  const neu = join(k.kern, "mcp/brain-mcp.mjs");
  const rufe = handlerFuer(k);
  const datei = join(HOME, ".cursor", "mcp.json");
  mkdirSync(join(HOME, ".cursor"), { recursive: true });
  for (const [befehl, server] of [[STABIL, ALTE_SERVER[0]], [ALT_NODE, ALTE_SERVER[1]], ["/opt/homebrew/bin/node", KIT_SERVER]]) {
    const anderes = { command: "foo", env: { TOKEN: "geheim-77" } };
    writeFileSync(datei, JSON.stringify({ mcpServers: { anderes, brain: { command: befehl, args: [server] } } }));
    const r = await rufe("POST", "/api/mcp/verbinden", { ziel: "cursor" });
    assert.equal(r.status, 200, r.body.toString("utf8")); assert.notEqual(r.j.schonVerbunden, true); assert.ok(r.j.sicherung);
    assert.deepEqual(JSON.parse(readFileSync(datei, "utf8")), { mcpServers: { anderes, brain: { command: STABIL, args: [neu] } } });
    assert.deepEqual((await rufe("POST", "/api/mcp/verbinden", { ziel: "cursor" })).j, { ok: true, schonVerbunden: true });
  }
  const fremd = { mcpServers: { brain: { command: "/usr/bin/fremd", args: [KIT_SERVER] } } };
  writeFileSync(datei, JSON.stringify(fremd));
  assert.equal((await rufe("POST", "/api/mcp/verbinden", { ziel: "cursor" })).status, 409);
  assert.deepEqual(JSON.parse(readFileSync(datei, "utf8")), fremd, "unverändert");
});
