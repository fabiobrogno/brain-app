#!/usr/bin/env node
// Tests/Kern/fake-claude-frage.mjs — Attrappe für `claude -p … --output-format stream-json` (Frag deinen Vault, P4). Ruft NIE das echte claude.
// Strenges Argument-Parsing wie die echte CLI: `node:util#parseArgs` mit strict, die echten Optionsnamen (Stand der Claude-Code-Doku „CLI reference“); eine unbekannte Option oder eine
// falsche Kombination endet mit Exit 1 und einer Meldung auf stderr — genau das würde die echte CLI tun. Zusätzlich prüft sie die Schutzgeländer der Frage-Funktion und endet bei
// einer Verletzung mit Exit 4: keine eingebauten Werkzeuge, nur der Kortex-MCP (fest an Konto und Vault gebunden, --nur-lesen), dontAsk, Hooks aus, nur Benutzer-Einstellungen,
// keine Sitzung, Frage über stdin (kein Positionsargument), Arbeitsordner leer und nicht im Vault.
// Ablauf: startet den ECHTEN brain-mcp.mjs aus --mcp-config (Befehl, Argumente, env genau wie angegeben), ruft brain_suchen und brain_lesen auf und gibt system / stream_event /
// assistant / user (tool_result) / result als JSON-Zeilen aus. Die Attrappe läuft in der Umgebung, die die Werkstatt ihr gibt (sie liest sonst nichts vom Rechner).
// Szenario: `szenario.json` NEBEN dieser Datei (der Test schreibt sie vor dem Lauf), Felder:
//   warteMs        so lange hält die Attrappe nach dem Start des MCP-Servers an (Datei „wartet“ enthält dann ihre PID) (Abbruch-Tests); SIGINT → Exit 130, SIGTERM → Exit 143 (beide beenden den MCP-Kindprozess mit)
//   ignoriereSigint / ignoriereSigterm   reagiert nicht (der Test wartet auf SIGKILL)
//   ohneMcp        den MCP-Server nicht starten, sondern festen Text liefern (schnelle Tests)
//   lesen          Liste von Pfaden, die per brain_lesen gelesen werden (Standard: der erste Treffer der Suche)
//   antwort        Text der Antwort (Standard: aus der gelesenen Seite gebaut)
//   art            "fehler" (result is_error) | "max-turns" | "kaputt" (Exit 2 ohne result) | "gross" (zu viel Ausgabe) | "lange-zeile" | "unerlaubt" (tool_use Bash) | "nur-text" (ohne stream_event)
//   kosten         total_cost_usd (Standard 0.0123)
// Protokoll: jede Zeile in <ordner>/aufrufe.jsonl: { args, cwd, envSchluessel, claudeConfigDir, stdin, mcp }.
import { parseArgs } from "node:util";
import { readFileSync, appendFileSync, writeFileSync, readdirSync, realpathSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
// Der Test legt `claude` als Mini-Skript in einen eigenen Ordner, das diese Datei lädt und globalThis.FAKE_ORDNER setzt (Szenario, Protokoll und PIDs liegen dort).
const ORDNER = globalThis.FAKE_ORDNER || HIER;
if (process.env.BRAIN_TESTMODUS !== "1") { process.stderr.write("fake-claude-frage: nur im Testmodus\n"); process.exit(9); }

const OPTIONEN = {
  print: { type: "boolean", short: "p" },
  "output-format": { type: "string" }, "input-format": { type: "string" },
  verbose: { type: "boolean" }, "include-partial-messages": { type: "boolean" },
  model: { type: "string" }, tools: { type: "string" },
  "strict-mcp-config": { type: "boolean" }, "mcp-config": { type: "string", multiple: true },
  allowedTools: { type: "string", multiple: true }, "allowed-tools": { type: "string", multiple: true },
  disallowedTools: { type: "string", multiple: true }, "disallowed-tools": { type: "string", multiple: true },
  "permission-mode": { type: "string" }, settings: { type: "string" }, "setting-sources": { type: "string" },
  "no-session-persistence": { type: "boolean" }, "max-turns": { type: "string" }, "max-budget-usd": { type: "string" },
  "append-system-prompt": { type: "string" }, "disable-slash-commands": { type: "boolean" },
};
let p;
try { p = parseArgs({ args: process.argv.slice(2), options: OPTIONEN, allowPositionals: true, strict: true }); }
catch (e) { process.stderr.write(`error: ${e.message}\n`); process.exit(1); }
const v = p.values;
const fehl = (t) => { process.stderr.write(`error: ${t}\n`); process.exit(1); };
// Kombinationen, die die echte CLI ablehnt
if (v["output-format"] !== undefined && !["text", "json", "stream-json"].includes(v["output-format"])) fehl(`Invalid --output-format "${v["output-format"]}"`);
if (v["output-format"] === "stream-json" && !v.print) fehl("--output-format=stream-json requires --print");
if (v["output-format"] === "stream-json" && !v.verbose) fehl("When using --print, --output-format=stream-json requires --verbose");
if (v["include-partial-messages"] && !(v.print && v["output-format"] === "stream-json")) fehl("--include-partial-messages requires --print and --output-format=stream-json");
if (v["permission-mode"] !== undefined && !["default", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions", "manual"].includes(v["permission-mode"])) fehl(`Invalid permission mode "${v["permission-mode"]}"`);
if (v["max-turns"] !== undefined && !/^\d+$/.test(v["max-turns"])) fehl("--max-turns must be a number");
if (v["max-budget-usd"] !== undefined && !(Number(v["max-budget-usd"]) > 0)) fehl("--max-budget-usd must be a positive number");
if (v["no-session-persistence"] && !v.print) fehl("--no-session-persistence only works with --print");
if (v["setting-sources"] !== undefined && !v["setting-sources"].split(",").every((x) => ["user", "project", "local"].includes(x))) fehl("Invalid setting source");
if (v.settings !== undefined) { try { JSON.parse(v.settings); } catch { fehl("Invalid --settings JSON"); } }

// Schutzgeländer der Frage-Funktion
const verletzt = [];
const liste = (...n) => n.flatMap((k) => v[k] || []).flatMap((x) => x.split(/[,\s]+/)).filter(Boolean);
if (!v.print) verletzt.push("-p fehlt");
if (v.tools !== "") verletzt.push('--tools "" fehlt');
if (!v["strict-mcp-config"]) verletzt.push("--strict-mcp-config fehlt");
if (v["permission-mode"] !== "dontAsk") verletzt.push("--permission-mode dontAsk fehlt");
if (!v["no-session-persistence"]) verletzt.push("--no-session-persistence fehlt");
if (v["setting-sources"] !== "user") verletzt.push("--setting-sources user fehlt");
if (!v["disable-slash-commands"]) verletzt.push("--disable-slash-commands fehlt");
if (!v["append-system-prompt"]) verletzt.push("--append-system-prompt fehlt");
if (p.positionals.length) verletzt.push(`Positionsargumente (die Frage darf nicht im Aufruf stehen): ${p.positionals.length}`);
try { if (JSON.parse(v.settings).disableAllHooks !== true) verletzt.push("disableAllHooks fehlt"); } catch { verletzt.push("--settings fehlt"); }
const erlaubt = liste("allowedTools", "allowed-tools");
const soll = ["mcp__brain__brain_suchen", "mcp__brain__brain_lesen", "mcp__brain__brain_kontext"];
if (JSON.stringify([...erlaubt].sort()) !== JSON.stringify([...soll].sort())) verletzt.push(`--allowedTools ist nicht genau die drei Lesewerkzeuge: ${erlaubt.join(",")}`);
const entfernt = liste("disallowedTools", "disallowed-tools");
for (const n of ["Bash", "Edit", "Write", "WebFetch", "WebSearch", "mcp__brain__brain_merken"]) if (!entfernt.includes(n)) verletzt.push(`--disallowedTools ohne ${n}`);
let mcp = null;
try {
  const cfg = JSON.parse((v["mcp-config"] || [])[0]);
  const namen = Object.keys(cfg.mcpServers || {});
  if ((v["mcp-config"] || []).length !== 1 || namen.length !== 1 || namen[0] !== "brain") verletzt.push("--mcp-config: genau ein Server „brain“ erwartet");
  mcp = cfg.mcpServers.brain;
  const a = mcp.args || [];
  const nach = (k) => a[a.indexOf(k) + 1];
  if (!/^k_[0-9a-f]{8}$/.test(nach("--konto") || "")) verletzt.push("MCP ohne --konto");
  if (!nach("--vault")) verletzt.push("MCP ohne --vault");
  if (!a.includes("--nur-lesen")) verletzt.push("MCP ohne --nur-lesen");
  if (mcp.env && mcp.env.BRAIN_NUTZUNG !== "aus") verletzt.push("MCP ohne BRAIN_NUTZUNG=aus (würde im Vault protokollieren)");
} catch { verletzt.push("--mcp-config fehlt oder ist kein JSON"); }
const cwd = realpathSync(process.cwd());
if (mcp) {
  const a = mcp.args || [];
  const vault = a[a.indexOf("--vault") + 1];
  try { const rv = realpathSync(vault); if (cwd === rv || cwd.startsWith(rv + sep)) verletzt.push("Arbeitsordner liegt im Vault"); } catch { /* Vault fehlt: der MCP meldet es */ }
}
if (readdirSync(cwd).length) verletzt.push("Arbeitsordner ist nicht leer");
const stdinTeile = [];
for await (const c of process.stdin) stdinTeile.push(c);
const stdin = Buffer.concat(stdinTeile).toString("utf8");
if (!stdin.trim()) verletzt.push("keine Frage über stdin");
appendFileSync(join(ORDNER, "aufrufe.jsonl"), JSON.stringify({ args: process.argv.slice(2), cwd, envSchluessel: Object.keys(process.env).sort(), claudeConfigDir: process.env.CLAUDE_CONFIG_DIR ?? null, stdin, pid: process.pid, verletzt }) + "\n");
if (verletzt.length) { process.stderr.write(`fake-claude-frage: Schutzgeländer verletzt: ${verletzt.join("; ")}\n`); process.exit(4); }

// ---------- Szenario ----------
let S = {};
try { S = JSON.parse(readFileSync(join(ORDNER, "szenario.json"), "utf8")); } catch { /* Standard */ }
const schreib = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let mcpKind = null;
const aufraeumen = (code) => { try { if (mcpKind) process.kill(-mcpKind.pid, "SIGKILL"); } catch { try { mcpKind?.kill("SIGKILL"); } catch { /* weg */ } } process.exit(code); };
process.on("SIGINT", () => { if (!S.ignoriereSigint) aufraeumen(130); });
process.on("SIGTERM", () => { if (!S.ignoriereSigterm) aufraeumen(143); });

const sitzung = "sitzung-test";
schreib({ type: "system", subtype: "init", session_id: sitzung, model: v.model, tools: soll, mcp_servers: [{ name: "brain", status: "connected" }], permissionMode: v["permission-mode"] });

// MCP-Client (der echte Server)
let naechsteId = 0;
const wartende = new Map();
async function mcpStart() {
  const env = { ...(mcp.env || {}) };
  mcpKind = spawn(mcp.command, mcp.args, { env, cwd, detached: true, stdio: ["pipe", "pipe", "pipe"] });
  writeFileSync(join(ORDNER, "mcp-pid"), String(mcpKind.pid));
  createInterface({ input: mcpKind.stdout }).on("line", (z) => { try { const o = JSON.parse(z); const w = wartende.get(o.id); if (w) { wartende.delete(o.id); w(o); } } catch { /* keine JSON-Zeile */ } });
  mcpKind.stderr.on("data", () => {});
  mcpKind.stdin.on("error", () => {});
  await rufe("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "0.0.0-test" } });
  mcpKind.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
}
const rufe = (method, params) => new Promise((ok, nein) => {
  const id = ++naechsteId;
  const t = setTimeout(() => nein(new Error(`MCP ${method}: keine Antwort`)), 10000);
  wartende.set(id, (o) => { clearTimeout(t); ok(o); });
  mcpKind.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
});
const werkzeug = async (name, args) => {
  if (S.ohneMcp) return { text: S.mcpText?.[name] || "", fehler: false };
  const r = (await rufe("tools/call", { name, arguments: args })).result || {};
  return { text: (r.content || []).map((c) => c.text).join("\n"), fehler: r.isError === true };
};

let nr = 0;
const nachricht = (inhalt) => { const id = `msg_${++nr}`; if (S.art !== "nur-text") schreib({ type: "stream_event", event: { type: "message_start", message: { id, role: "assistant", content: [] } } }); schreib({ type: "assistant", message: { id, role: "assistant", content: inhalt } }); };
async function benutze(name, eingabe, id) {
  nachricht([{ type: "tool_use", id, name: `mcp__brain__${name}`, input: eingabe }]);
  const r = await werkzeug(name, eingabe);
  schreib({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text: r.text }], is_error: r.fehler }] } });
  return r;
}

if (S.art === "kaputt") { process.stderr.write("claude: etwas ist schiefgelaufen\n"); aufraeumen(2); }
if (!S.ohneMcp) await mcpStart();
if (S.warteMs) { writeFileSync(join(ORDNER, "wartet"), String(process.pid)); await pause(S.warteMs); } // erst nach dem Start des MCP-Servers: so zeigt ein Abbruch-Test auch, ob er mit endet
const frage = stdin.trim().split("\n")[0].slice(0, 200);
const suche = await benutze("brain_suchen", { frage }, "tu_1");
const treffer = [...suche.text.matchAll(/^\s*\d+\.\s+(.+?) — /gm)].map((m) => m[1]);
const lesen = S.lesen || treffer.slice(0, 1);
let gelesen = "";
let k = 1;
for (const pfad of lesen) { const r = await benutze("brain_lesen", { pfad }, `tu_${++k}`); gelesen += r.text.split("\n---\n").slice(1).join("\n").slice(0, 200); }
if (S.art === "unerlaubt") { nachricht([{ type: "tool_use", id: "tu_x", name: "Bash", input: { command: "cat /etc/hosts" } }]); schreib({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_x", content: "Permission denied", is_error: true }] } }); }

const antwort = S.antwort ?? (lesen.length ? `Aus [[${lesen[0]}]]: ${gelesen.replace(/\s+/g, " ").trim().slice(0, 120)}` : "Dazu steht nichts im Vault.");
const id = `msg_${++nr}`;
if (S.art !== "nur-text") {
  schreib({ type: "stream_event", event: { type: "message_start", message: { id, role: "assistant", content: [] } } });
  schreib({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } });
  for (let i = 0; i < antwort.length; i += 12) { schreib({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: antwort.slice(i, i + 12) } } }); if (S.deltaMs) await pause(S.deltaMs); }
  schreib({ type: "stream_event", event: { type: "content_block_stop", index: 0 } });
}
schreib({ type: "assistant", message: { id, role: "assistant", content: [{ type: "text", text: antwort }] } });
if (S.art === "gross") { const zeile = JSON.stringify({ type: "system", subtype: "fuellung", text: "x".repeat(60_000) }) + "\n"; for (let i = 0; i < 40; i++) process.stdout.write(zeile); await pause(300); }
if (S.art === "lange-zeile") { process.stdout.write(JSON.stringify({ type: "system", subtype: "fuellung", text: "y".repeat(400_000) }) + "\n"); await pause(300); }
schreib({ type: "result", subtype: S.art === "max-turns" ? "error_max_turns" : "success", is_error: S.art === "fehler" || S.art === "max-turns", duration_ms: 1234, num_turns: 3, session_id: sitzung,
  result: S.art === "fehler" ? "Invalid API key · Please run /login" : antwort, total_cost_usd: S.kosten ?? 0.0123,
  usage: { input_tokens: 1200, output_tokens: 150, cache_creation_input_tokens: 300, cache_read_input_tokens: 4000 }, modelUsage: { [v.model]: { inputTokens: 1200, outputTokens: 150, costUSD: S.kosten ?? 0.0123 } },
  permission_denials: S.art === "unerlaubt" ? [{ tool_name: "Bash", tool_use_id: "tu_x", tool_input: {} }] : [] });
aufraeumen(S.art === "fehler" ? 1 : 0);
