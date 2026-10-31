// werkstatt/ki-programme/programme.mjs — die KI-Programme, in deren Einstellungsdatei Kortex den MCP-Server „brain“ einträgt.
// Jedes Programm ist nur eine BESCHREIBUNG; das Verhalten (Sicherung, atomar schreiben, Symlinks, kaputte Dateien nie anfassen,
// nur den eigenen Eintrag trennen) steckt einmal in datei-adapter.mjs. Quellen und Stand der Formate: docs/plaene/ki-programme.md.
//   id          Wert von `ziel` bei /api/mcp/verbinden|trennen|konfiguration (gleich KiZiel.ziel in Swift)
//   name        Anzeigename
//   anzeige     Dateiort für Menschen („~/…“)
//   datei       ({ home, ordner? }) → absoluter Pfad. `ordner` ersetzt den Standard-Konfigurationsordner (für spätere Profile je Programm).
//   pfad        Schlüsselpfad des Server-Verzeichnisses in der Datei
//   baue(a)     a = [node, mcp.mjs] → der Eintrag im Format des Programms
//   lies(obj)   Eintrag des Programms → { command, args } (zum Vergleichen), sonst null
//   erkennung   { apps: ["X.app"], cli: ["befehl"] } aus dem KI-Katalog (aus(id)); ohne Angabe wird das Programm anderswo erkannt (Cursor: `cursorDa`)
import { join } from "node:path";
import { erzeugeDateiAdapter } from "./datei-adapter.mjs";
import { katalogEintrag } from "../../gemeinsam/ki-katalog.mjs";

// Der häufigste Fall: { command, args } wie im Modell-Context-Protokoll-Beispiel.
// a = [node, mcp.mjs] oder mit Konto [node, mcp.mjs, "--konto", id]: alle Argumente nach dem Programm gehören in den Eintrag.
const standard = (a) => ({ command: a[0], args: a.slice(1) });
const liesStandard = (o) => (typeof o.command === "string" ? { command: o.command, args: o.args } : null);
// Erkennung (Mac-Apps und Befehle) steht im KI-Katalog (gemeinsam/ki-katalog.json) — dort ist sie für Studio, Kern und App dieselbe.
const aus = (id) => ({ apps: katalogEintrag(id).apps, cli: katalogEintrag(id).befehle });
const inHome = (...teile) => ({ home, ordner }) => join(ordner || join(home, ...teile.slice(0, -1)), teile[teile.length - 1]);

export const BESCHREIBUNGEN = [
  { id: "cursor", name: "Cursor", anzeige: "~/.cursor/mcp.json", datei: inHome(".cursor", "mcp.json"),
    pfad: ["mcpServers"], baue: standard, lies: liesStandard },
  { id: "claude-desktop", name: "Claude Desktop", anzeige: "~/Library/Application Support/Claude/claude_desktop_config.json",
    datei: inHome("Library", "Application Support", "Claude", "claude_desktop_config.json"),
    pfad: ["mcpServers"], baue: standard, lies: liesStandard, erkennung: aus("claude-desktop") },
  { id: "gemini", name: "Gemini CLI", anzeige: "~/.gemini/settings.json", datei: inHome(".gemini", "settings.json"),
    pfad: ["mcpServers"], baue: standard, lies: liesStandard, erkennung: aus("gemini") },
  // Copilot CLI: gemeinsame Copilot-Datei; `type` und `tools` stehen so in der Doku von GitHub.
  { id: "copilot", name: "GitHub Copilot", anzeige: "~/.copilot/mcp-config.json", datei: inHome(".copilot", "mcp-config.json"),
    pfad: ["mcpServers"], baue: (a) => ({ type: "local", command: a[0], args: a.slice(1), tools: ["*"] }), lies: liesStandard, erkennung: aus("copilot") },
  // Zed: die Einstellungen sind JSONC (Kommentare sind üblich) — der Adapter lässt sie stehen.
  { id: "zed", name: "Zed", anzeige: "~/.config/zed/settings.json", datei: inHome(".config", "zed", "settings.json"),
    pfad: ["context_servers"], baue: standard, lies: liesStandard, erkennung: aus("zed") },
  // OpenCode: `command` ist EIN Feld mit Liste (Programm und Argumente zusammen), kein getrenntes `args`.
  { id: "opencode", name: "OpenCode", anzeige: "~/.config/opencode/opencode.json", datei: inHome(".config", "opencode", "opencode.json"),
    pfad: ["mcp"], baue: (a) => ({ type: "local", command: [...a], enabled: true }),
    lies: (o) => (Array.isArray(o.command) && typeof o.command[0] === "string" ? { command: o.command[0], args: o.command.slice(1) } : null),
    erkennung: aus("opencode") },
  { id: "warp", name: "Warp", anzeige: "~/.warp/.mcp.json", datei: inHome(".warp", ".mcp.json"),
    pfad: ["mcpServers"], baue: standard, lies: liesStandard, erkennung: aus("warp") },
];

export const ADAPTER = Object.fromEntries(BESCHREIBUNGEN.map((b) => [b.id, erzeugeDateiAdapter(b)]));
/** Beschreibungen, die dieses Modul selbst erkennt (alle außer Cursor). */
export const ERKENNBAR = BESCHREIBUNGEN.filter((b) => b.erkennung);
