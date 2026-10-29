// umstellung/mcp-lage.mjs — Welche KI-Programme haben den Brain-Server (MCP) noch in alter Form eingetragen? (Paket P7a). NUR LESEN, ohne Programmaufruf.
//
// Statt `claude mcp get`/`codex mcp get` (die das jeweilige Programm starten würden) liest der Befund die Konfigurationsdateien selbst:
//   Claude Code: <Standardprofil: ~/.claude.json | anderes Profil: <Profil>/.claude.json> → mcpServers (Benutzerebene) und projects.*.mcpServers
//   Codex:       ~/.codex/config.toml → Abschnitte [mcp_servers.<name>]
//   Cursor:      ~/.cursor/mcp.json → mcpServers
// Einstufung des Eintrags „brain“ wie die Werkstatt (werkstatt/handler.mjs#befehlsArt): gleich · alt (derselbe Server in früherer Form, wird ohne Rückfrage
// umgestellt) · anders (fremder Eintrag: Rückfrage). Befehl und Argumente verlassen dieses Modul nie (fremde Einträge können Zugangsdaten enthalten).
import { readFileSync, statSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { ALT_KIT_ORDNER } from "../pfade.mjs";
import { nennt } from "./restverweise.mjs";

const maskiere = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ALTER_APP_NODE = /\/Application Support\/(?:Brain|Kortex)\/node\/[^/]+\/bin\/node$/;
const ALTER_MCP_PFAD = /^\/.*\/mcp\/brain-mcp\.mjs$/;
const ALTER_KIT_MCP = new RegExp(`^/.*/${maskiere(ALT_KIT_ORDNER)}/(?:.*/)?[^/]*mcp[^/]*\\.mjs$`);
const KIT_TEIL = new RegExp(`^(.*)/${maskiere(ALT_KIT_ORDNER)}/`);

const istObjekt = (x) => x && typeof x === "object" && !Array.isArray(x);
const echt = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
const falte = (s) => String(s).normalize("NFC").toLowerCase();

function leseText(datei, grenze = 20 * 1024 * 1024) {
  try { const st = statSync(datei); if (!st.isFile() || st.size > grenze) return null; return readFileSync(datei, "utf8"); } catch { return null; }
}
const eintragAus = (e) => (istObjekt(e) && typeof e.command === "string" ? { command: e.command, args: Array.isArray(e.args) ? e.args.filter((a) => typeof a === "string") : [], vollstaendig: !Array.isArray(e.args) || e.args.every((a) => typeof a === "string") } : { command: null, args: [], vollstaendig: false });

// --- Quellen -------------------------------------------------------------------------------------------------------------------
// → { servers: { <Name>: { command, args } }, lesbar } je Ziel. Mehrere Orte (Benutzerebene + Projekte) werden zusammengefasst; der erste Eintrag je Name gewinnt.
export function claudeServer(profil, home) {
  const datei = profil.standard ? join(home, ".claude.json") : join(profil.pfad, ".claude.json");
  const t = leseText(datei);
  if (t === null) return { servers: {}, lesbar: false };
  let doc;
  try { doc = JSON.parse(t); } catch { return { servers: {}, lesbar: false }; }
  const servers = {};
  const nimm = (m) => { if (istObjekt(m)) for (const [n, e] of Object.entries(m)) if (!(n in servers)) servers[n] = eintragAus(e); };
  nimm(doc.mcpServers);
  if (istObjekt(doc.projects)) for (const p of Object.values(doc.projects)) if (istObjekt(p)) nimm(p.mcpServers);
  return { servers, lesbar: true };
}
export function cursorServer(home) {
  const t = leseText(join(home, ".cursor", "mcp.json"));
  if (t === null) return { servers: {}, lesbar: false };
  try {
    const doc = JSON.parse(t);
    const servers = {};
    if (istObjekt(doc.mcpServers)) for (const [n, e] of Object.entries(doc.mcpServers)) servers[n] = eintragAus(e);
    return { servers, lesbar: true };
  } catch { return { servers: {}, lesbar: false }; }
}
// Minimaler TOML-Leser, nur für [mcp_servers.<name>] mit command = "…" und args = ["…", …] (mehrzeilig erlaubt).
export function codexServer(home) {
  const t = leseText(join(home, ".codex", "config.toml"), 5 * 1024 * 1024);
  if (t === null) return { servers: {}, lesbar: false };
  const servers = {};
  const teile = t.split(/^\s*\[/m);
  for (const teil of teile) {
    const m = /^\s*mcp_servers\.(?:"([^"]+)"|([A-Za-z0-9_-]+))\s*\]/.exec(teil);
    if (!m) continue;
    const name = m[1] || m[2];
    const koerper = teil.slice(m[0].length);
    const cmd = /^\s*command\s*=\s*("(?:[^"\\]|\\.)*")/m.exec(koerper);
    const args = /^\s*args\s*=\s*\[([\s\S]*?)\]/m.exec(koerper);
    let command = null, liste = [];
    try { command = cmd ? JSON.parse(cmd[1]) : null; } catch { command = null; }
    if (args) for (const s of args[1].match(/"(?:[^"\\]|\\.)*"/g) || []) { try { liste.push(JSON.parse(s)); } catch { /* ignorieren */ } }
    if (!(name in servers)) servers[name] = { command, args: liste, vollstaendig: command !== null };
  }
  return { servers, lesbar: true };
}

// --- Einstufung ----------------------------------------------------------------------------------------------------------------
// soll: { node, server } = die Pfade, die ein neuer Eintrag hätte (<Support>/bin/node, <Support>/bin/kern/mcp/brain-mcp.mjs).
// bekannt(ordner): gehört dieser Ordner (Elternordner des alten Kit-Ordners) zu einem bekannten Vault?
export function einstufung(e, soll, bekannt) {
  if (!e || typeof e.command !== "string") return "anders";
  const [a0, ...weitere] = e.args;
  if (e.args.length === 1 && e.command === soll.node && a0 === soll.server) return "gleich";
  if (e.args.length === 1 && typeof a0 === "string" && weitere.length === 0) {
    if (e.command !== soll.node && ALTER_APP_NODE.test(e.command) && a0 === soll.server) return "alt";
    if (ALTER_MCP_PFAD.test(a0) && !nennt(a0) && (e.command === soll.node || ALTER_APP_NODE.test(e.command))) return "alt";
    if (ALTER_KIT_MCP.test(a0) && /^\/(?:.*\/)?node$/.test(e.command)) {
      const m = KIT_TEIL.exec(a0);
      if (m && bekannt(m[1])) return "alt";
    }
  }
  return "anders";
}
export function vaultBekannt(vaults) {
  const formen = vaults.flatMap((v) => [falte(resolve(v)), falte(echt(v))]);
  return (ordner) => formen.includes(falte(resolve(ordner))) || formen.includes(falte(echt(ordner)));
}

// Einträge mit anderem Namen, die auf den alten Kit-Ordner zeigen (Befehl oder Argumente)
export const zeigtInKit = (e) => !!e && ((typeof e.command === "string" && nennt(e.command)) || e.args.some((a) => nennt(a)));

// → [{ ziel: "claude"|"codex"|"cursor", profil?, art: "gleich"|"alt"|"anders"|"fehlt", fremd: n (andere Namen mit Verweis) }]
export function mcpLage({ home, support, profile, vaults }) {
  const soll = { node: join(support, "bin", "node"), server: join(support, "bin", "kern", "mcp", "brain-mcp.mjs") };
  const bekannt = vaultBekannt(vaults);
  const lage = [];
  const bewerte = (ziel, profil, q) => {
    const brain = q.servers.brain;
    const fremd = Object.entries(q.servers).filter(([n, e]) => n !== "brain" && zeigtInKit(e)).length;
    lage.push({ ziel, ...(profil ? { profil: profil.pfad, profilName: profil.name } : {}), art: brain ? einstufung(brain, soll, bekannt) : "fehlt", fremd, lesbar: q.lesbar });
  };
  for (const p of profile) bewerte("claude", p, claudeServer(p, home));
  bewerte("codex", null, codexServer(home));
  bewerte("cursor", null, cursorServer(home));
  return lage;
}
