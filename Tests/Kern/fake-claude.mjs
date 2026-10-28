#!/usr/bin/env node
// .tools/tests/fake-claude.mjs — Ersatz für `claude -p` in Tests (Testhaken BRAIN_CLAUDE). Ruft NIE das echte claude.
// - verlangt BRAIN_ERNTE=1 (Selbstaufruf-Schutz), sonst Exit 3
// - prüft den schlanken Aufruf (Final-Review #3): -p, --model haiku|sonnet, --tools "", --strict-mcp-config,
//   --mcp-config mit leerem mcpServers, --system-prompt (nicht leer), --no-session-persistence,
//   --setting-sources project, --output-format json — fehlt etwas: Meldung auf stderr, Exit 4
// - schreibt stdin nach $FAKE_CLAUDE_LOG und {args, cwd} nach $FAKE_CLAUDE_LOG.json
// - gibt den Inhalt der Datei $FAKE_CLAUDE_AUSGABE als JSON aus, wie `claude -p --output-format json`:
//   { type: "result", subtype: "success", is_error: false, result, usage: { input_tokens, output_tokens, … } }
//   $FAKE_CLAUDE_ROH=1 → Inhalt unverändert (prüft das defensive Parsen), $FAKE_CLAUDE_OHNE_USAGE=1 → ohne usage
// - optional: $FAKE_CLAUDE_WARTE (ms) vor der Antwort, $FAKE_CLAUDE_EXIT (Exit-Code)
// - Tageslauf (B2): $FAKE_CLAUDE_REGELN (mehrere Antworten je Eingabe), $FAKE_CLAUDE_ZAEHLER (eine JSON-Zeile je Aufruf)
import { writeFileSync, readFileSync, appendFileSync } from "node:fs";

if (process.env.BRAIN_ERNTE !== "1") process.exit(3);
const args = process.argv.slice(2);

function pruefeArgs(a) {
  const wert = (flag) => { const i = a.indexOf(flag); return i >= 0 && i + 1 < a.length ? a[i + 1] : undefined; };
  const fehlt = [];
  if (!a.includes("-p")) fehlt.push("-p");
  if (!["haiku", "sonnet"].includes(wert("--model"))) fehlt.push("--model haiku|sonnet");   // sonnet: der Richter des Tageslaufs
  if (wert("--tools") !== "") fehlt.push('--tools ""');
  if (!a.includes("--strict-mcp-config")) fehlt.push("--strict-mcp-config");
  try {
    const m = JSON.parse(wert("--mcp-config"));
    if (!m || typeof m.mcpServers !== "object" || Object.keys(m.mcpServers).length) fehlt.push("--mcp-config leer");
  } catch { fehlt.push("--mcp-config"); }
  if (!String(wert("--system-prompt") || "").trim()) fehlt.push("--system-prompt");
  if (!a.includes("--no-session-persistence")) fehlt.push("--no-session-persistence");
  if (wert("--setting-sources") !== "project") fehlt.push("--setting-sources project");
  if (wert("--output-format") !== "json") fehlt.push("--output-format json");
  return fehlt;
}
const fehlt = pruefeArgs(args);
if (fehlt.length) { process.stderr.write(`fake-claude: Aufruf unvollständig: ${fehlt.join(", ")}\n`); process.exit(4); }

const teile = [];
for await (const c of process.stdin) teile.push(c);
const eingabe = Buffer.concat(teile).toString("utf8");
if (process.env.FAKE_CLAUDE_LOG) {
  writeFileSync(process.env.FAKE_CLAUDE_LOG, eingabe);
  writeFileSync(process.env.FAKE_CLAUDE_LOG + ".json", JSON.stringify({ args, cwd: process.cwd(), claudeConfigDir: process.env.CLAUDE_CONFIG_DIR ?? null }));
}
// Tageslauf-Tests: $FAKE_CLAUDE_REGELN = JSON-Datei [{ "wenn": "<Teilstring>" | ["<Teilstring>", …], "antwort": "<Text>" }] — die erste
// Regel, deren `wenn` in der Eingabe oder im Systemprompt steht (bei einer Liste: JEDER Teilstring, je in Eingabe oder Systemprompt),
// gewinnt; sonst $FAKE_CLAUDE_AUSGABE.
// $FAKE_CLAUDE_ZAEHLER = Datei: je Aufruf (auch bei simuliertem Exit) eine JSON-Zeile { system (40 Zeichen), eingabe, modell }.
const system = args[args.indexOf("--system-prompt") + 1] || "";
if (process.env.FAKE_CLAUDE_ZAEHLER) appendFileSync(process.env.FAKE_CLAUDE_ZAEHLER, JSON.stringify({ system: system.slice(0, 40), eingabe, modell: args[args.indexOf("--model") + 1] }) + "\n");
const warte = Number(process.env.FAKE_CLAUDE_WARTE || 0);
if (warte > 0) await new Promise(r => setTimeout(r, warte));
if (process.env.FAKE_CLAUDE_EXIT && process.env.FAKE_CLAUDE_EXIT !== "0") process.exit(Number(process.env.FAKE_CLAUDE_EXIT));
let text = null;
if (process.env.FAKE_CLAUDE_REGELN) {
  const regeln = JSON.parse(readFileSync(process.env.FAKE_CLAUDE_REGELN, "utf8"));
  // FAKT/ZITAT stehen im Tageslauf als JSON-Text in Anführungszeichen (Datenrahmen): ein `wenn` darf auch ohne das öffnende Anführungszeichen schreiben.
  const ohneRahmen = eingabe.replace(/^(FAKT|ZITAT): "/gm, "$1: ");
  const steht = (t) => eingabe.includes(t) || ohneRahmen.includes(t) || system.includes(t);
  const r = regeln.find((x) => (Array.isArray(x.wenn) ? x.wenn.every(steht) : steht(x.wenn)));
  if (r) text = String(r.antwort);
}
if (text === null && process.env.FAKE_CLAUDE_AUSGABE) text = readFileSync(process.env.FAKE_CLAUDE_AUSGABE, "utf8");
if (text !== null) {
  if (process.env.FAKE_CLAUDE_ROH === "1") process.stdout.write(text);
  else {
    const antwort = { type: "result", subtype: "success", is_error: false, result: text };
    // Erfundene, aber nachvollziehbare Zahlen: ~4 Zeichen je Token, plus ein fester Cache-Anteil.
    if (process.env.FAKE_CLAUDE_OHNE_USAGE !== "1") {
      antwort.usage = { input_tokens: Math.ceil((system.length + eingabe.length) / 4), cache_creation_input_tokens: 0, cache_read_input_tokens: 100, output_tokens: Math.ceil(text.length / 4) };
    }
    process.stdout.write(JSON.stringify(antwort));
  }
}
