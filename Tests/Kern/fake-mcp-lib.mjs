// fake-mcp-lib.mjs — gemeinsamer Kern der Ersatzprogramme für `claude mcp …` und `codex mcp …` in Tests der Umstellung (Paket P7b). KEIN Test.
// Bildet das Verhalten der echten Programme nach, das für die Umstellung zählt – mit echtem Argument-Parsing und Fehlercodes:
//   claude mcp remove [-s user] <name>                 Exit 1, wenn es den Eintrag nicht gibt
//   claude mcp add [-s user] [-e|--env K=V…] <name> -- <befehl> [argumente…]
//                                                      -e/--env ist VARIADISCH (wie in commander): es frisst alle folgenden Wörter bis zur nächsten Option, auch den Namen →
//                                                      „-e K=V brain -- cmd“ endet mit Exit 1 („missing required argument 'name'“). Exit 1, wenn der Name schon existiert.
//   claude mcp add-json [-s user] <name> <json>        legt den Eintrag verlustfrei an; Exit 1 bei kaputtem JSON oder wenn es ihn schon gibt
//   codex mcp remove <name> · codex mcp add <name> [--env K=V]… -- <befehl> [argumente…]   (Exit 1 bei fehlendem/vorhandenem Namen)
// Dateien: claude → $CLAUDE_CONFIG_DIR/.claude.json bzw. $HOME/.claude.json (mcpServers), codex → $HOME/.codex/config.toml ([mcp_servers.<name>] und [mcp_servers.<name>.env]).
// Jeder Aufruf wird (ohne Argumente) in $FAKE_MCP_LOG vermerkt, falls gesetzt. $FAKE_MCP_FAIL="add,add-json,remove" lässt diese Unterbefehle mit Exit 1 scheitern (ohne etwas zu ändern).
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir, homedir } from "node:os";

const fehler = (text, code = 1) => { process.stderr.write(`${text}\n`); process.exit(code); };

// Wörter nach den Optionen lesen: gibt { opts, positionell, nachDoppelstrich }. Variadische Optionen (env) fressen bis zur nächsten Option.
function parse(rest, { variadisch = ["-e", "--env"], mitWert = ["-s", "--scope", "-t", "--transport"] } = {}) {
  const o = { scope: null, env: [], positionell: [], rest: [] };
  let i = 0;
  while (i < rest.length) {
    const w = rest[i];
    if (w === "--") { o.rest = rest.slice(i + 1); break; }
    if (variadisch.includes(w)) { i++; while (i < rest.length && !rest[i].startsWith("-")) o.env.push(rest[i++]); continue; }
    if (mitWert.includes(w)) { if (w === "-s" || w === "--scope") o.scope = rest[i + 1]; i += 2; continue; }
    if (w.startsWith("-")) fehler(`error: unknown option '${w}'`);
    o.positionell.push(w); i++;
  }
  return o;
}

// SICHERHEIT: die Attrappe schreibt nur unter dem Temp-Ordner. Zeigt HOME oder CLAUDE_CONFIG_DIR woandershin (z. B. auf das echte Profil), bricht sie ab, ohne etwas zu lesen oder zu schreiben.
function nurTemp(pfad) {
  const echt = (p) => { try { return realpathSync(p); } catch { return p; } };
  const wurzeln = [tmpdir(), echt(tmpdir()), "/tmp", "/private/tmp", "/private/var/folders", "/var/folders"];
  const p = echt(pfad);
  if (!wurzeln.some((w) => p === w || p.startsWith(`${w}/`))) { process.stderr.write("Testattrappe: arbeitet nur im Temp-Ordner\n"); process.exit(99); }
}

export function lauf(art) {
  nurTemp(process.env.CLAUDE_CONFIG_DIR || homedir() || "/nicht-gesetzt");   // homedir() liest HOME (bzw. den Passwort-Eintrag)
  const a = process.argv.slice(2);
  if (process.env.FAKE_MCP_LOG) appendFileSync(process.env.FAKE_MCP_LOG, `${art} ${a[0]} ${a[1]}\n`);
  if (a[0] !== "mcp") fehler("unbekannter Befehl", 64);
  const sub = a[1];
  if ((process.env.FAKE_MCP_FAIL || "").split(",").includes(sub)) fehler(`${sub} scheitert (Testschalter)`);
  const o = parse(a.slice(2));
  const [name, json] = o.positionell;
  if (art === "claude") {
    const datei = process.env.CLAUDE_CONFIG_DIR ? join(process.env.CLAUDE_CONFIG_DIR, ".claude.json") : join(homedir(), ".claude.json");
    let d = {}; try { d = JSON.parse(readFileSync(datei, "utf8")); } catch { /* neu */ }
    d.mcpServers ||= {};
    if (o.scope && o.scope !== "user") fehler("nur -s user wird nachgebildet");
    if (sub === "remove") {
      if (!name) fehler("error: missing required argument 'name'");
      if (!(name in d.mcpServers)) fehler(`No MCP server found with name: ${name}`);
      delete d.mcpServers[name];
    } else if (sub === "add") {
      if (!name) fehler("error: missing required argument 'name'");
      if (!o.rest.length) fehler("error: missing required argument 'commandOrUrl'");
      if (name in d.mcpServers) fehler(`MCP server ${name} already exists in user config`);
      const env = Object.fromEntries(o.env.map((e) => e.split(/=(.*)/s).slice(0, 2)));
      d.mcpServers[name] = { type: "stdio", command: o.rest[0], args: o.rest.slice(1), ...(Object.keys(env).length ? { env } : {}) };
    } else if (sub === "add-json") {
      if (!name || json === undefined) fehler("error: missing required argument");
      if (name in d.mcpServers) fehler(`MCP server ${name} already exists in user config`);
      let e; try { e = JSON.parse(json); } catch { fehler("Invalid JSON"); }
      if (!e || typeof e !== "object" || Array.isArray(e)) fehler("Invalid JSON");
      d.mcpServers[name] = e;
    } else fehler("unbekannter Unterbefehl", 64);
    mkdirSync(dirname(datei), { recursive: true });
    writeFileSync(datei, JSON.stringify(d, null, 2) + "\n");
  } else {
    const datei = join(homedir(), ".codex", "config.toml");
    let t = ""; try { t = readFileSync(datei, "utf8"); } catch { /* neu */ }
    const teile = t.split(/^(?=\[)/m);
    const istUnser = (x) => new RegExp(`^\\[mcp_servers\\.${name}(?:\\.[^\\]]*)?\\]`).test(x);
    if (!name) fehler("error: missing required argument 'name'");
    const da = teile.some(istUnser);
    if (sub === "remove") { if (!da) fehler(`No MCP server named '${name}' found.`); t = teile.filter((x) => !istUnser(x)).join(""); }
    else if (sub === "add") {
      if (da) fehler(`MCP server '${name}' already exists`);
      if (!o.rest.length) fehler("error: missing command");
      const env = o.env.map((e) => e.split(/=(.*)/s).slice(0, 2));
      t = `${t}${t && !t.endsWith("\n") ? "\n" : ""}\n[mcp_servers.${name}]\ncommand = ${JSON.stringify(o.rest[0])}\nargs = ${JSON.stringify(o.rest.slice(1))}\n${env.length ? `\n[mcp_servers.${name}.env]\n${env.map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join("\n")}\n` : ""}`;
    } else fehler("unbekannter Unterbefehl", 64);
    mkdirSync(dirname(datei), { recursive: true });
    writeFileSync(datei, t);
  }
}
