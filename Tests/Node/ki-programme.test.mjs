// KI-Programme mit Einstellungsdatei (Cursor, Claude Desktop, Gemini CLI, GitHub Copilot, Zed, OpenCode, Warp): derselbe Adapter,
// eine Tabelle mit den Formen je Programm. Nur Wegwerf-HOME unter dem Temp-Ordner; nie ein echter Nutzerort.
// Kindprozesse (Version der Attrappe) laufen mit gesäuberter Umgebung: keine Konfig-Ordner-Variablen des Rechners.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, readdirSync, realpathSync, statSync, symlinkSync, lstatSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { tmp, schreibe, pfad } from "./hilfe.mjs";

// Umgebung säubern: weder CLAUDE_CONFIG_DIR noch CODEX_HOME, XDG_*, GIT_CONFIG_* oder COPILOT_HOME dürfen auf echte Orte zeigen.
for (const k of Object.keys(process.env)) if (/^(CLAUDE_CONFIG_DIR|CODEX_HOME|COPILOT_HOME|GEMINI_.*|XDG_.*|GIT_CONFIG.*)$/.test(k)) delete process.env[k];
const ECHTES_HOME = process.env.HOME;
const HOME0 = tmp("brain-home-");
process.env.HOME = HOME0;
const TEMP = realpathSync(tmpdir());
const imTemp = (p) => realpathSync(p).startsWith(TEMP + "/");
assert.ok(imTemp(HOME0), "HOME muss im Temp-Ordner liegen");

const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
const { ADAPTER, erkenneProgramme } = await import(pfad("werkstatt", "ki-programme", "index.mjs"));
const { BESCHREIBUNGEN } = await import(pfad("werkstatt", "ki-programme", "programme.mjs"));

const aufruf = (h) => async (methode, p, daten) => {
  const [pf, query] = p.split("?");
  const r = await h({ methode, pfad: pf, query: query || null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) });
  let j = null; try { j = JSON.parse(r.body.toString("utf8")); } catch { /* statisch */ }
  return { ...r, j };
};
const mcpDatei = () => { const m = tmp("brain-mcpdir-"); schreibe(m, "brain-mcp.mjs", "// fake\n"); return join(m, "brain-mcp.mjs"); };
const vault = () => { const d = tmp(); schreibe(d, "00_inbox/n.md", "# Notiz\n"); return d; };
// Handler mit Wegwerf-Vault, eigenem MCP-Server-Attrappe und eigenem Support-Ordner
const handlerMit = (mcp = mcpDatei(), extra = {}) => aufruf(erzeugeHandler({ kontenAus: true, vault: vault(), mcpPfad: mcp, vaultOptionen: { support: tmp("brain-support-") }, ...extra }));
const handler = () => handlerMit();

// Ein frisches HOME je Test (homedir() liest $HOME bei jedem Aufruf).
async function mitHome(fn) {
  const home = tmp("brain-home-");
  process.env.HOME = home;
  try { return await fn(home); } finally { process.env.HOME = HOME0; }
}

const NODE = process.execPath;
// Form je Programm: wo die Datei liegt, unter welchem Schlüssel, wie der Eintrag von Kortex aussieht, wie ein fremder.
const stdArgs = (real) => ({ command: NODE, args: [real] });
const FORMEN = {
  cursor: { datei: ".cursor/mcp.json", schluessel: "mcpServers", unserer: stdArgs, fremd: { command: "/usr/bin/fremd", args: ["--key=geheim-88"] } },
  "claude-desktop": { datei: "Library/Application Support/Claude/claude_desktop_config.json", schluessel: "mcpServers", unserer: stdArgs, fremd: { command: "/usr/bin/fremd", args: ["--key=geheim-88"] } },
  gemini: { datei: ".gemini/settings.json", schluessel: "mcpServers", unserer: stdArgs, fremd: { command: "/usr/bin/fremd", args: ["--key=geheim-88"] } },
  copilot: { datei: ".copilot/mcp-config.json", schluessel: "mcpServers", unserer: (r) => ({ type: "local", command: NODE, args: [r], tools: ["*"] }), fremd: { type: "local", command: "/usr/bin/fremd", args: ["--key=geheim-88"], tools: ["*"] } },
  zed: { datei: ".config/zed/settings.json", schluessel: "context_servers", unserer: stdArgs, fremd: { command: "/usr/bin/fremd", args: ["--key=geheim-88"] } },
  opencode: { datei: ".config/opencode/opencode.json", schluessel: "mcp", unserer: (r) => ({ type: "local", command: [NODE, r], enabled: true }), fremd: { type: "local", command: ["/usr/bin/fremd", "--key=geheim-88"] } },
  warp: { datei: ".warp/.mcp.json", schluessel: "mcpServers", unserer: stdArgs, fremd: { command: "/usr/bin/fremd", args: ["--key=geheim-88"] } },
};

test("Die Tabelle deckt jedes Programm im Register ab, und jede Datei liegt unter HOME", async () => {
  assert.deepEqual(Object.keys(FORMEN).sort(), BESCHREIBUNGEN.map((b) => b.id).sort());
  await mitHome((home) => {
    for (const b of BESCHREIBUNGEN) {
      const d = b.datei({ home });
      assert.equal(d, join(home, FORMEN[b.id].datei), b.id);
      assert.ok(d.startsWith(home + "/") && !d.startsWith(ECHTES_HOME + "/Library/Application Support/Claude") || home.startsWith(ECHTES_HOME), b.id);
      assert.deepEqual(b.pfad, [FORMEN[b.id].schluessel], b.id);
    }
  });
});

for (const [id, F] of Object.entries(FORMEN)) {
  const dateiIn = (home) => join(home, F.datei);
  const lies = (home) => JSON.parse(readFileSync(dateiIn(home), "utf8"));
  const sicherungen = (home) => (existsSync(dirname(dateiIn(home))) ? readdirSync(dirname(dateiIn(home))).filter((n) => n.includes("brain-sicherung")) : []);
  const andere = { command: "foo", env: { TOKEN: "geheim-77" } };

  test(`${id}: verbinden — Datei fehlt → wird angelegt (0600); erneut → schonVerbunden; Konfiguration passt zum Eintrag`, async () => mitHome(async (home) => {
    const mcp = mcpDatei(), real = realpathSync(mcp);
    const rufe = handlerMit(mcp);
    let r = await rufe("POST", "/api/mcp/verbinden", { ziel: id });
    assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(r.j.ok, true); assert.equal(r.j.sicherung, undefined, "nichts zu sichern");
    assert.deepEqual(lies(home), { [F.schluessel]: { brain: F.unserer(real) } });
    assert.equal(statSync(dateiIn(home)).mode & 0o777, 0o600);
    r = await rufe("POST", "/api/mcp/verbinden", { ziel: id });
    assert.deepEqual(r.j, { ok: true, schonVerbunden: true });
    assert.deepEqual(sicherungen(home), [], "ohne Änderung keine Sicherung");
    // Konfiguration zum Kopieren: genau der Eintrag, den auch verbinden schreibt, plus der Ort der Datei
    const k = await rufe("GET", `/api/mcp/konfiguration?ziel=${id}`);
    assert.equal(k.status, 200); assert.equal(k.j.ort, ADAPTER[id].anzeige);
    assert.deepEqual(JSON.parse(k.j.json), { [F.schluessel]: { brain: F.unserer(real) } });
  }));

  test(`${id}: verbinden — fremde Einträge und Felder bleiben; fremdes „brain“ → 409 ohne Details, umstellen mit Sicherung`, async () => mitHome(async (home) => {
    const mcp = mcpDatei(), real = realpathSync(mcp);
    const rufe = handlerMit(mcp);
    mkdirSync(dirname(dateiIn(home)), { recursive: true });
    const fremdDoc = { theme: "x", [F.schluessel]: { anderes: andere, brain: F.fremd } };
    writeFileSync(dateiIn(home), JSON.stringify(fremdDoc));
    let r = await rufe("POST", "/api/mcp/verbinden", { ziel: id });
    assert.equal(r.status, 409); assert.equal(r.j.art, "anders");
    for (const g of ["geheim-77", "geheim-88", "fremd"]) assert.ok(!r.body.toString("utf8").includes(g), `„${g}“ darf nicht in der Antwort stehen`);
    assert.deepEqual(lies(home), fremdDoc, "unverändert");
    r = await rufe("POST", "/api/mcp/verbinden", { ziel: id, umstellen: true });
    assert.equal(r.status, 200); assert.ok(r.j.sicherung);
    assert.deepEqual(JSON.parse(readFileSync(r.j.sicherung, "utf8")), fremdDoc, "Sicherung = Datei von vorher");
    assert.deepEqual(lies(home), { theme: "x", [F.schluessel]: { anderes: andere, brain: F.unserer(real) } });
    // ohne brain, mit anderen Einträgen: ergänzen
    writeFileSync(dateiIn(home), JSON.stringify({ [F.schluessel]: { anderes: andere } }));
    r = await rufe("POST", "/api/mcp/verbinden", { ziel: id });
    assert.equal(r.status, 200); assert.ok(r.j.sicherung);
    assert.deepEqual(Object.keys(lies(home)[F.schluessel]).sort(), ["anderes", "brain"]);
    assert.ok(sicherungen(home).length <= 3);
  }));

  test(`${id}: kaputte oder anders geformte Datei wird nie überschrieben (422, Text zum Kopieren), auch nicht mit „umstellen“`, async () => mitHome(async (home) => {
    const rufe = handler();
    for (const inhalt of [`{ "${F.schluessel}": { kaputt`, "[1,2]", `{"${F.schluessel}": []}`, `{"${F.schluessel}": null}`, `{"${F.schluessel}": "text"}`, "nur text"]) {
      rmSync(dirname(dateiIn(home)), { recursive: true, force: true }); mkdirSync(dirname(dateiIn(home)), { recursive: true });
      writeFileSync(dateiIn(home), inhalt);
      for (const umstellen of [false, true]) {
        const r = await rufe("POST", "/api/mcp/verbinden", { ziel: id, ...(umstellen ? { umstellen } : {}) });
        assert.equal(r.status, 422, inhalt); assert.equal(r.j.art, "kaputt");
        assert.ok(JSON.parse(r.j.befehl)[F.schluessel].brain, "Text zum Kopieren");
        assert.equal(readFileSync(dateiIn(home), "utf8"), inhalt, "unverändert");
        assert.deepEqual(sicherungen(home), []);
      }
      const t = await rufe("POST", "/api/mcp/trennen", { ziel: id });
      assert.equal(t.status, 422, inhalt); assert.equal(readFileSync(dateiIn(home), "utf8"), inhalt, "trennen ändert nichts");
    }
  }));

  test(`${id}: Rechte bleiben; ein Symlink bleibt ein Symlink und das echte Ziel bekommt den Eintrag; keine Reste`, async () => mitHome(async (home) => {
    const rufe = handler();
    mkdirSync(dirname(dateiIn(home)), { recursive: true });
    const dot = tmp("brain-dotfiles-"), echt = join(dot, "einstellungen.json");
    writeFileSync(echt, JSON.stringify({ [F.schluessel]: { anderes: andere } })); chmodSync(echt, 0o640);
    symlinkSync(echt, dateiIn(home));
    const r = await rufe("POST", "/api/mcp/verbinden", { ziel: id });
    assert.equal(r.status, 200);
    assert.ok(lstatSync(dateiIn(home)).isSymbolicLink(), "Link bleibt Link");
    assert.equal(realpathSync(dateiIn(home)), realpathSync(echt));
    assert.ok(JSON.parse(readFileSync(echt, "utf8"))[F.schluessel].anderes, "andere Einträge bleiben");
    assert.ok(JSON.parse(readFileSync(echt, "utf8"))[F.schluessel].brain);
    assert.equal(statSync(echt).mode & 0o777, 0o640);
    assert.equal(statSync(r.j.sicherung).mode & 0o777, 0o640, "Sicherung mit den Rechten des Originals");
    assert.deepEqual(readdirSync(dot), ["einstellungen.json"], "keine Reste im Ordner des Ziels");
    const t = await rufe("POST", "/api/mcp/trennen", { ziel: id });
    assert.equal(t.status, 200);
    assert.ok(lstatSync(dateiIn(home)).isSymbolicLink());
    assert.equal(JSON.parse(readFileSync(echt, "utf8"))[F.schluessel].brain, undefined);
    assert.deepEqual(readdirSync(dot), ["einstellungen.json"]);
  }));

  test(`${id}: Kommentare, nachgestellte Kommas und Reihenfolge bleiben beim Verbinden und beim Trennen`, async () => mitHome(async (home) => {
    const rufe = handler();
    mkdirSync(dirname(dateiIn(home)), { recursive: true });
    const quelle = `{\n    // mein Kommentar\n    "theme": "dunkel", // hinten\n    "${F.schluessel}": {\n        "anderes": { "command": "foo" }, /* bleibt */\n    },\n}\n`;
    writeFileSync(dateiIn(home), quelle);
    let r = await rufe("POST", "/api/mcp/verbinden", { ziel: id });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    let neu = readFileSync(dateiIn(home), "utf8");
    for (const s of ["// mein Kommentar", "// hinten", "/* bleibt */", '"theme": "dunkel"', '"anderes": { "command": "foo" }']) assert.ok(neu.includes(s), `„${s}“ bleibt: ${neu}`);
    assert.ok(neu.indexOf("theme") < neu.indexOf("anderes") && neu.indexOf("anderes") < neu.indexOf("brain"), "Reihenfolge");
    r = await rufe("POST", "/api/mcp/trennen", { ziel: id });
    assert.equal(r.status, 200);
    neu = readFileSync(dateiIn(home), "utf8");
    for (const s of ["// mein Kommentar", "// hinten", "/* bleibt */", '"anderes": { "command": "foo" }']) assert.ok(neu.includes(s), `„${s}“ bleibt nach dem Trennen`);
    assert.ok(!neu.includes("brain"));
  }));

  test(`${id}: trennen — nur der eigene Eintrag geht (mit Sicherung); fremder bleibt (409); ohne Eintrag oder Datei ist nichts zu tun`, async () => mitHome(async (home) => {
    const mcp = mcpDatei(), real = realpathSync(mcp);
    const rufe = handlerMit(mcp);
    assert.deepEqual((await rufe("POST", "/api/mcp/trennen", { ziel: id })).j, { ok: true, warNichtVerbunden: true }, "Datei fehlt");
    mkdirSync(dirname(dateiIn(home)), { recursive: true });
    writeFileSync(dateiIn(home), "");
    assert.deepEqual((await rufe("POST", "/api/mcp/trennen", { ziel: id })).j, { ok: true, warNichtVerbunden: true }, "leere Datei");
    writeFileSync(dateiIn(home), JSON.stringify({ [F.schluessel]: { anderes: andere } }));
    assert.deepEqual((await rufe("POST", "/api/mcp/trennen", { ziel: id })).j, { ok: true, warNichtVerbunden: true }, "kein brain");
    writeFileSync(dateiIn(home), JSON.stringify({ x: 1, [F.schluessel]: { anderes: andere, brain: F.unserer(real) } }));
    const r = await rufe("POST", "/api/mcp/trennen", { ziel: id });
    assert.equal(r.status, 200); assert.ok(r.j.sicherung);
    assert.deepEqual(lies(home), { x: 1, [F.schluessel]: { anderes: andere } });
    // fremder Eintrag bleibt
    const fremdDoc = { [F.schluessel]: { brain: F.fremd, anderes: andere } };
    writeFileSync(dateiIn(home), JSON.stringify(fremdDoc));
    const f = await rufe("POST", "/api/mcp/trennen", { ziel: id });
    assert.equal(f.status, 409); assert.equal(f.j.art, "anders");
    for (const g of ["geheim-77", "geheim-88", "fremd"]) assert.ok(!f.body.toString("utf8").includes(g));
    assert.deepEqual(lies(home), fremdDoc);
  }));

  test(`${id}: eine frühere Form desselben Servers (alter Node im App-Ordner) wird ohne Rückfrage umgestellt`, async () => mitHome(async (home) => {
    const mcp = mcpDatei(), real = realpathSync(mcp);
    const rufe = handlerMit(mcp);
    const alt = F.unserer(real);
    const altNode = "/Users/jemand/Library/Application Support/Kortex/node/22.1.0/bin/node";
    if (Array.isArray(alt.command)) alt.command[0] = altNode; else alt.command = altNode;
    mkdirSync(dirname(dateiIn(home)), { recursive: true });
    writeFileSync(dateiIn(home), JSON.stringify({ [F.schluessel]: { brain: alt } }));
    const r = await rufe("POST", "/api/mcp/verbinden", { ziel: id });
    assert.equal(r.status, 200, JSON.stringify(r.j)); assert.ok(r.j.sicherung);
    assert.deepEqual(lies(home)[F.schluessel].brain, F.unserer(real));
  }));
}

test("Sicherungen: höchstens die letzten 3, ältere werden gelöscht; zwei Läufe in derselben Sekunde überschreiben sich nicht", async () => mitHome(async (home) => {
  const rufe = handler();
  const datei = join(home, FORMEN.zed.datei);
  mkdirSync(dirname(datei), { recursive: true });
  for (const z of ["20200101000001", "20200101000002", "20200101000003", "20200101000004", "20200101000005"]) writeFileSync(`${datei}.brain-sicherung-${z}`, "alt");
  writeFileSync(datei, JSON.stringify({ context_servers: { a: { command: "x" } } }));
  const r1 = await rufe("POST", "/api/mcp/verbinden", { ziel: "zed" });
  const namen = () => readdirSync(dirname(datei)).filter((n) => n.includes("brain-sicherung"));
  assert.equal(namen().length, 3); assert.ok(!namen().some((n) => n.endsWith("20200101000001")), "die älteste ist weg"); assert.ok(r1.j.sicherung);
  const a = JSON.stringify({ context_servers: { eins: { command: "e" } } }), b = JSON.stringify({ context_servers: { zwei: { command: "z" } } });
  writeFileSync(datei, a); const s1 = (await rufe("POST", "/api/mcp/verbinden", { ziel: "zed" })).j.sicherung;
  writeFileSync(datei, b); const s2 = (await rufe("POST", "/api/mcp/verbinden", { ziel: "zed" })).j.sicherung;
  assert.notEqual(s1, s2); assert.equal(readFileSync(s1, "utf8"), a); assert.equal(readFileSync(s2, "utf8"), b);
}));

test("Schreibfehler nennt den Fehlercode; die Temp-Datei bleibt nicht liegen; das Original bleibt", { skip: process.platform !== "darwin" }, async () => mitHome(async (home) => {
  const { execFileSync } = await import("node:child_process");
  const rufe = handler();
  const datei = join(home, FORMEN.warp.datei);
  mkdirSync(dirname(datei), { recursive: true });
  const original = JSON.stringify({ mcpServers: { a: { command: "x" } } });
  writeFileSync(datei, original);
  execFileSync("chflags", ["uchg", datei]); // unveränderlich: rename über die Datei schlägt mit EPERM fehl
  try {
    const r = await rufe("POST", "/api/mcp/verbinden", { ziel: "warp" });
    assert.equal(r.status, 502); assert.match(r.j.fehler, /EPERM/); assert.ok(r.j.befehl);
    assert.deepEqual(readdirSync(dirname(datei)).filter((n) => n.includes("brain-neu")), []);
    assert.equal(readFileSync(datei, "utf8"), original);
  } finally { execFileSync("chflags", ["nouchg", datei]); }
}));

test("Adapter mit eigenem Konfig-Ordner (für spätere Profile): schreibt dort, nie im Standardordner", async () => mitHome(async (home) => {
  const mcp = mcpDatei();
  const ctx = { home, a: [NODE, realpathSync(mcp)], art: () => "anders" };
  const profil = join(tmp("brain-profil-"), "mein-gemini");
  const r = ADAPTER.gemini.verbinde({ ...ctx, ordner: profil }, {});
  assert.equal(r.ok, true);
  assert.ok(existsSync(join(profil, "settings.json")));
  assert.ok(!existsSync(join(home, ".gemini")), "Standardordner bleibt unberührt");
  assert.equal(ADAPTER.gemini.trenne({ ...ctx, art: () => "gleich", ordner: profil }).ok, true);
  assert.equal(JSON.parse(readFileSync(join(profil, "settings.json"), "utf8")).mcpServers.brain, undefined);
}));

test("Unbekanntes Ziel → 400 bei verbinden, trennen und konfiguration; ohne Ziel das übliche mcpServers-Format", async () => mitHome(async () => {
  const mcp = mcpDatei(), real = realpathSync(mcp);
  const rufe = handlerMit(mcp);
  for (const [m, p] of [["POST", "/api/mcp/verbinden"], ["POST", "/api/mcp/trennen"]]) {
    const r = await rufe(m, p, { ziel: "gpt" });
    assert.equal(r.status, 400); assert.match(r.j.fehler, /claude-desktop/);
  }
  assert.equal((await rufe("GET", "/api/mcp/konfiguration?ziel=gpt")).status, 400);
  assert.equal((await rufe("GET", "/api/mcp/konfiguration?ziel=__proto__")).status, 400);
  assert.deepEqual(JSON.parse((await rufe("GET", "/api/mcp/konfiguration")).j.json), { mcpServers: { brain: { command: NODE, args: [real] } } });
  const info = (await rufe("GET", "/api/info")).j;
  assert.deepEqual(Object.keys(info.mcpBefehle).sort(), ["claude", "claude-desktop", "codex", "copilot", "cursor", "gemini", "opencode", "warp", "zed"]);
  // fehlt der MCP-Server: 404 mit befehl null
  const weg = handlerMit(join(tmp("brain-leer-"), "gibtsnicht.mjs"));
  assert.equal((await weg("POST", "/api/mcp/verbinden", { ziel: "gemini" })).status, 404);
  assert.equal((await weg("GET", "/api/mcp/konfiguration?ziel=gemini")).status, 404);
}));

// ── Erkennung ──
test("Erkennung: App im Programme-Ordner (mit Version aus Info.plist) oder Befehl im PATH; ein Konfigurationsordner allein zählt nicht", async () => mitHome(async (home) => {
  const apps = tmp("brain-apps-"), bin = tmp("brain-bin-");
  const plist = (v) => `<?xml version="1.0"?><plist><dict><key>CFBundleShortVersionString</key><string>${v}</string></dict></plist>`;
  schreibe(apps, "Claude.app/Contents/Info.plist", plist("1.4.2"));
  schreibe(join(home, "Applications"), "Zed.app/Contents/Info.plist", plist("0.230.1")); // auch ~/Applications zählt
  schreibe(bin, "gemini", "#!/bin/sh\nexit 0\n"); chmodSync(join(bin, "gemini"), 0o755);
  schreibe(bin, "opencode", "#!/bin/sh\nexit 0\n"); chmodSync(join(bin, "opencode"), 0o755);
  mkdirSync(join(home, ".warp"), { recursive: true }); // Warp: nur der Ordner, keine App
  mkdirSync(join(home, ".copilot"), { recursive: true });
  const env = { PATH: bin, BRAIN_TESTMODUS: "1", BRAIN_CLAUDE_EXTRA: "" };
  const liste = erkenneProgramme({ env, home, appOrdner: apps, agenten: [{ id: "gemini", pfad: join(bin, "gemini"), version: "0.9.1" }] });
  const nach = Object.fromEntries(liste.map((x) => [x.id, x]));
  assert.deepEqual(Object.keys(nach), ["claude-desktop", "gemini", "copilot", "zed", "opencode", "warp"], "feste Reihenfolge, ohne Cursor");
  assert.deepEqual(nach["claude-desktop"], { id: "claude-desktop", name: "Claude Desktop", gefunden: true, version: "1.4.2", quelle: "app" });
  assert.equal(nach.zed.gefunden, true); assert.equal(nach.zed.version, "0.230.1");
  assert.deepEqual([nach.gemini.gefunden, nach.gemini.quelle, nach.gemini.version], [true, "cli", "0.9.1"]);
  assert.deepEqual([nach.opencode.gefunden, nach.opencode.version], [true, null], "Befehl da, Version unbekannt");
  assert.equal(nach.warp.gefunden, false, "Ordner allein genügt nicht");
  assert.equal(nach.copilot.gefunden, false);
}));

test("Route /api/ki/erkennen: meldet `programme` zusätzlich; die Version des Befehls kommt aus einer Attrappe, die nur --version annimmt und außerhalb von Temp abbricht", async () => mitHome(async (home) => {
  const bin = tmp("brain-bin-");
  // Attrappe mit echtem Argument-Parsing: nur `--version`; alles andere (insbesondere `mcp add …`) ist ein Fehler; HOME muss im Temp-Ordner liegen.
  schreibe(bin, "gemini", `#!${NODE}
const a = process.argv.slice(2);
const fs = require("node:fs");
const temp = fs.realpathSync(${JSON.stringify(TEMP)});
const home = process.env.HOME ? fs.realpathSync(process.env.HOME) : "";
if (!home.startsWith(temp + "/")) { console.error("HOME liegt nicht im Temp-Ordner"); process.exit(99); }
for (const k of Object.keys(process.env)) if (/^(CLAUDE_CONFIG_DIR|CODEX_HOME|COPILOT_HOME|XDG_.*|GIT_CONFIG.*)$/.test(k)) { console.error("Umgebung nicht gesäubert: " + k); process.exit(98); }
if (a.length === 1 && a[0] === "--version") { console.log("gemini 0.12.3"); process.exit(0); }
console.error("unbekannte Argumente: " + a.join(" ")); process.exit(64);\n`);
  chmodSync(join(bin, "gemini"), 0o755);
  const rufe = handler();
  const alt = { P: process.env.PATH, E: process.env.BRAIN_CLAUDE_EXTRA };
  process.env.PATH = `${bin}:/usr/bin:/bin`; process.env.BRAIN_CLAUDE_EXTRA = "";
  try {
    const r = await rufe("GET", "/api/ki/erkennen?neu=1");
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.j.programme) && r.j.programme.length === 6);
    const g = r.j.programme.find((x) => x.id === "gemini");
    assert.deepEqual([g.gefunden, g.version, g.quelle], [true, "0.12.3", "cli"]);
    assert.equal(r.j.agenten.find((x) => x.id === "gemini").version, "0.12.3");
  } finally { process.env.PATH = alt.P; if (alt.E === undefined) delete process.env.BRAIN_CLAUDE_EXTRA; else process.env.BRAIN_CLAUDE_EXTRA = alt.E; }
}));

// ── Schutz vor Beschädigung (Befunde des Reviews) ──
test("Ungültiges UTF-8, schreibgeschützte Datei und toter Symlink: Kortex ändert nichts (422), die Datei bleibt Byte für Byte gleich", async () => mitHome(async (home) => {
  const rufe = handler();
  const datei = join(home, FORMEN.zed.datei);
  mkdirSync(dirname(datei), { recursive: true });
  // ungültiges UTF-8 (Byte 0xFC in einem Kommentar)
  const roh = Buffer.concat([Buffer.from("{\n  // gr"), Buffer.from([0xfc]), Buffer.from('n\n  "context_servers": {}\n}\n')]);
  writeFileSync(datei, roh);
  for (const [m, p] of [["POST", "/api/mcp/verbinden"], ["POST", "/api/mcp/trennen"]]) {
    const r = await rufe(m, p, { ziel: "zed" });
    assert.equal(r.status, 422); assert.equal(r.j.art, "kaputt"); assert.match(r.j.fehler, /UTF-8/);
    assert.ok(readFileSync(datei).equals(roh), "unverändert");
  }
  // schreibgeschützt
  writeFileSync(datei, '{"context_servers": {}}'); chmodSync(datei, 0o444);
  const s = await rufe("POST", "/api/mcp/verbinden", { ziel: "zed" });
  assert.equal(s.status, 422); assert.match(s.j.fehler, /schreibgeschützt/);
  assert.equal(readFileSync(datei, "utf8"), '{"context_servers": {}}'); assert.equal(statSync(datei).mode & 0o777, 0o444);
  chmodSync(datei, 0o644); rmSync(datei);
  // toter Symlink bleibt ein Symlink, nichts wird angelegt
  const dot = tmp("brain-dotfiles-");
  symlinkSync(join(dot, "fehlt.json"), datei);
  const l = await rufe("POST", "/api/mcp/verbinden", { ziel: "zed" });
  assert.equal(l.status, 422); assert.equal(l.j.art, "kaputt");
  assert.ok(lstatSync(datei).isSymbolicLink()); assert.deepEqual(readdirSync(dot), []);
  assert.equal((await rufe("POST", "/api/mcp/trennen", { ziel: "zed" })).j.art, "kaputt");
}));
