// Hilfen für die Tests der KI-Konten (docs/plaene/ki-konten.md): eine Kindprozess-Umgebung, die nie etwas vom Rechner erbt, und Attrappen für `claude` und
// `codex` mit strengem Argument-Parsing (node:util#parseArgs, strict: eine unbekannte Option beendet sie mit Exit 1, wie die echten Programme).
import { realpathSync, writeFileSync, chmodSync, mkdirSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tmp } from "./hilfe.mjs";

const TEMP = realpathSync(tmpdir());
const imTemp = (p) => { try { const r = realpathSync(p); return r === TEMP || r.startsWith(`${TEMP}/`); } catch { return false; } };
const KONFIG_ORDNER = ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "CURSOR_CONFIG_DIR", "GEMINI_CLI_HOME"];

// Baut die Umgebung für einen Kindprozess AUSDRÜCKLICH (nie ...process.env). Wirft, wenn HOME oder BRAIN_APP_SUPPORT fehlen oder nicht im Temp-Ordner liegen
// oder wenn einer der Konfig-Ordner (CLAUDE_CONFIG_DIR, CODEX_HOME, CURSOR_CONFIG_DIR, GEMINI_CLI_HOME) auf einen Ort außerhalb des Temp-Ordners zeigt.
export function baueTestUmgebung(extra = {}) {
  const e = { PATH: "/usr/bin:/bin", BRAIN_TESTMODUS: "1", ...extra };
  for (const k of ["HOME", "BRAIN_APP_SUPPORT"]) {
    if (typeof e[k] !== "string" || !imTemp(e[k])) throw new Error(`baueTestUmgebung: ${k} muss ein Ordner unter dem Temp-Ordner sein (war: ${e[k]})`);
  }
  for (const k of KONFIG_ORDNER) {
    if (e[k] === undefined) continue;
    if (typeof e[k] !== "string" || !imTemp(e[k])) throw new Error(`baueTestUmgebung: ${k} zeigt außerhalb des Temp-Ordners (${e[k]})`);
  }
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  return e;
}

// Attrappen: ein Ordner mit `claude` und `codex` (Node-Skripte). Zustand und Aufrufe liegen im Ordner; die Attrappe verlangt BRAIN_TESTMODUS=1.
//   claude mcp get <name> | mcp add [-s <scope>] <name> -- <befehl> [args…] | mcp remove [-s <scope>] <name>
//   codex  mcp get <name> --json | mcp add <name> -- <befehl> [args…] | mcp remove <name>
// Der Zustand ist je Konto getrennt (Schlüssel = CLAUDE_CONFIG_DIR bzw. CODEX_HOME, sonst "STANDARD"): so sieht ein Test, welches Konto angesprochen wurde.
export function attrappen() {
  const bin = tmp("brain-attrappen-");
  const zustand = join(bin, "zustand");
  mkdirSync(zustand);
  const kopf = `#!${process.execPath}
const fs = require("node:fs"); const path = require("node:path"); const { parseArgs } = require("node:util");
if (process.env.BRAIN_TESTMODUS !== "1") { console.error("Attrappe nur im Testmodus"); process.exit(9); }
const roh = process.argv.slice(2);
const i = roh.indexOf("--");
const vor = i < 0 ? roh : roh.slice(0, i), nach = i < 0 ? [] : roh.slice(i + 1);
const strikt = (optionen) => { try { return parseArgs({ args: vor, options: optionen, allowPositionals: true, strict: true }); } catch (e) { console.error("error: " + e.message); process.exit(1); } };
const zustandDatei = (schluessel) => path.join(${JSON.stringify(zustand)}, PROGRAMM + "-" + Buffer.from(schluessel).toString("hex") + ".json");
const log = (extra) => fs.appendFileSync(path.join(${JSON.stringify(bin)}, "aufrufe.jsonl"), JSON.stringify({ programm: PROGRAMM, args: roh, claudeConfigDir: process.env.CLAUDE_CONFIG_DIR || "STANDARD", codexHome: process.env.CODEX_HOME || "STANDARD", ...extra }) + "\\n");
`;
  const claude = `${kopf}
const PROGRAMM = "claude";
const schluessel = process.env.CLAUDE_CONFIG_DIR || "STANDARD";
const datei = zustandDatei(schluessel);
log({});
const { values, positionals } = strikt({ scope: { type: "string", short: "s" } });
if (positionals[0] !== "mcp") { console.error("error: unbekannter Befehl"); process.exit(1); }
if (positionals[1] === "get") {
  if (positionals.length !== 3) process.exit(1);
  if (!fs.existsSync(datei)) { console.error("No MCP server found with name: " + positionals[2]); process.exit(1); }
  const e = JSON.parse(fs.readFileSync(datei, "utf8"));
  console.log(positionals[2] + ":\\n  Scope: User config (available in all your projects)\\n  Status: ok\\n  Type: stdio\\n  Command: " + e.command + "\\n  Args: " + e.args.join(" ") + "\\n  Environment:\\n");
  process.exit(0);
}
if (positionals[1] === "remove") { if (positionals.length !== 3) process.exit(1); fs.rmSync(datei, { force: true }); console.log("Removed MCP server " + positionals[2]); process.exit(0); }
if (positionals[1] === "add") {
  if (positionals.length !== 3 || nach.length < 1) { console.error("error: add braucht <name> -- <befehl>"); process.exit(1); }
  fs.writeFileSync(datei, JSON.stringify({ command: nach[0], args: nach.slice(1) }));
  console.log("Added stdio MCP server " + positionals[2]); process.exit(0);
}
process.exit(1);
`;
  const codex = `${kopf}
const PROGRAMM = "codex";
const schluessel = process.env.CODEX_HOME || "STANDARD";
const datei = zustandDatei(schluessel);
log({});
const { values, positionals } = strikt({ json: { type: "boolean" } });
if (positionals[0] !== "mcp") { console.error("error: unbekannter Befehl"); process.exit(1); }
if (positionals[1] === "get") {
  if (positionals.length !== 3 || values.json !== true) process.exit(1);
  if (!fs.existsSync(datei)) { console.error("No MCP server named '" + positionals[2] + "' found."); process.exit(1); }
  const e = JSON.parse(fs.readFileSync(datei, "utf8"));
  console.log(JSON.stringify({ name: positionals[2], transport: { type: "stdio", command: e.command, args: e.args } })); process.exit(0);
}
if (positionals[1] === "remove") { if (positionals.length !== 3) process.exit(1); fs.rmSync(datei, { force: true }); process.exit(0); }
if (positionals[1] === "add") {
  if (positionals.length !== 3 || nach.length < 1) process.exit(1);
  fs.writeFileSync(datei, JSON.stringify({ command: nach[0], args: nach.slice(1) }));
  console.log("Added global MCP server '" + positionals[2] + "'."); process.exit(0);
}
process.exit(1);
`;
  writeFileSync(join(bin, "claude"), claude); chmodSync(join(bin, "claude"), 0o755);
  writeFileSync(join(bin, "codex"), codex); chmodSync(join(bin, "codex"), 0o755);
  const aufrufe = () => (existsSync(join(bin, "aufrufe.jsonl")) ? readFileSync(join(bin, "aufrufe.jsonl"), "utf8").trim().split("\n").map((z) => JSON.parse(z)) : []);
  const eintraege = () => Object.fromEntries(readdirSync(zustand).map((n) => {
    const m = /^(claude|codex)-([0-9a-f]+)\.json$/.exec(n);
    return [`${m[1]}:${Buffer.from(m[2], "hex").toString("utf8")}`, JSON.parse(readFileSync(join(zustand, n), "utf8"))];
  }));
  return { bin, aufrufe, eintraege };
}
