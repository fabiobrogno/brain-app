#!/usr/bin/env node
// Tests/Kern/fake-ki-protokoll.mjs — Attrappe für `claude -p` in den Konto-Tests (Testhaken BRAIN_CLAUDE). Ruft NIE das echte claude.
// - strenges Argument-Parsing (node:util parseArgs, strict): jede unbekannte Option beendet den Aufruf mit Exit 4
// - verlangt BRAIN_ERNTE=1 (Selbstaufruf-Schutz), sonst Exit 3
// - protokolliert JEDEN Aufruf als eine JSON-Zeile in $FAKE_KI_LOG ({ modell, konto: CLAUDE_CONFIG_DIR | null, eingabe: erste 40 Zeichen })
// - antwortet wie `claude -p --output-format json` mit dem Text aus $FAKE_KI_ANTWORT (Standard: NICHTS)
import { appendFileSync } from "node:fs";
import { parseArgs } from "node:util";

if (process.env.BRAIN_ERNTE !== "1") process.exit(3);
let opt;
try {
  opt = parseArgs({ args: process.argv.slice(2), strict: true, allowPositionals: true, options: {
    p: { type: "boolean", short: "p" }, model: { type: "string" }, tools: { type: "string" }, "strict-mcp-config": { type: "boolean" }, "mcp-config": { type: "string" },
    "system-prompt": { type: "string" }, "no-session-persistence": { type: "boolean" }, "setting-sources": { type: "string" }, "output-format": { type: "string" },
    // nur der Sonnet-/Traum-Weg (pflege-ki.mjs#sonnetArgs); die Werte hinter --allowedTools/--disallowedTools erscheinen als Positionen
    allowedTools: { type: "boolean" }, disallowedTools: { type: "boolean" }, "max-turns": { type: "string" }, "max-budget-usd": { type: "string" },
    "permission-mode": { type: "string" }, settings: { type: "string" },
  } });
} catch (e) { process.stderr.write(`fake-ki-protokoll: ${e.message}\n`); process.exit(4); }
const v = opt.values;
if (!v.p || !["haiku", "sonnet"].includes(v.model) || v["output-format"] !== "json") { process.stderr.write("fake-ki-protokoll: Aufruf unvollständig\n"); process.exit(4); }

const teile = [];
for await (const c of process.stdin) teile.push(c);
const eingabe = Buffer.concat(teile).toString("utf8");
if (process.env.FAKE_KI_LOG) appendFileSync(process.env.FAKE_KI_LOG, JSON.stringify({ modell: v.model, konto: process.env.CLAUDE_CONFIG_DIR ?? null, eingabe: eingabe.slice(0, 40) }) + "\n");
process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: process.env.FAKE_KI_ANTWORT ?? "NICHTS", usage: { input_tokens: 10, output_tokens: 2 } }));
