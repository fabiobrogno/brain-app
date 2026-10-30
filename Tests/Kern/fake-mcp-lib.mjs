// fake-mcp-lib.mjs — gemeinsamer Kern der Ersatzprogramme für `claude mcp …` und `codex mcp …` in Tests der Umstellung (Paket P7b). KEIN Test.
// Arbeitet nur auf Dateien im HOME der Umgebung: claude → $CLAUDE_CONFIG_DIR/.claude.json bzw. $HOME/.claude.json (mcpServers), codex → $HOME/.codex/config.toml.
//   mcp remove [-s user] brain          mcp add [-s user] [-e K=V]… brain -- <befehl> [argumente…]
// Jeder Aufruf wird (ohne Argumente) in $FAKE_MCP_LOG vermerkt, falls gesetzt.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";

export function lauf(art) {
  const a = process.argv.slice(2);
  if (process.env.FAKE_MCP_LOG) appendFileSync(process.env.FAKE_MCP_LOG, `${art} ${a[0]} ${a[1]}\n`);
  if (a[0] !== "mcp") process.exit(64);
  const sub = a[1];
  if (art === "claude") {
    const datei = process.env.CLAUDE_CONFIG_DIR ? join(process.env.CLAUDE_CONFIG_DIR, ".claude.json") : join(process.env.HOME, ".claude.json");
    let d = {}; try { d = JSON.parse(readFileSync(datei, "utf8")); } catch { /* neu */ }
    d.mcpServers ||= {};
    if (sub === "remove") { delete d.mcpServers.brain; }
    else if (sub === "add") {
      const rest = a.slice(2); const env = {}; let i = 0;
      while (rest[i] && rest[i].startsWith("-")) { if (rest[i] === "-e") { const [k, v] = rest[i + 1].split("="); env[k] = v; i += 2; } else i += 2; }
      const name = rest[i]; const sep = rest.indexOf("--");
      if (name !== "brain" || sep < 0) process.exit(2);
      d.mcpServers.brain = { type: "stdio", command: rest[sep + 1], args: rest.slice(sep + 2), ...(Object.keys(env).length ? { env } : {}) };
    } else process.exit(64);
    mkdirSync(dirname(datei), { recursive: true });
    writeFileSync(datei, JSON.stringify(d, null, 2) + "\n");
  } else {
    const datei = join(process.env.HOME, ".codex", "config.toml");
    let t = ""; try { t = readFileSync(datei, "utf8"); } catch { /* neu */ }
    const teile = t.split(/^(?=\[)/m).filter((x) => !/^\[mcp_servers\.brain(?:\.[^\]]*)?\]/.test(x));
    t = teile.join("");
    if (sub === "add") {
      const sep = a.indexOf("--");
      if (a[2] !== "brain" || sep < 0) process.exit(2);
      t = `${t}${t && !t.endsWith("\n") ? "\n" : ""}\n[mcp_servers.brain]\ncommand = ${JSON.stringify(a[sep + 1])}\nargs = ${JSON.stringify(a.slice(sep + 2))}\n`;
    } else if (sub !== "remove") process.exit(64);
    mkdirSync(dirname(datei), { recursive: true });
    writeFileSync(datei, t);
  }
}
