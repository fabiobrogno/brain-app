// werkstatt/handler.mjs — die Routen von Brain Studio (Spec §5) als reine Funktion, ohne Socket:
//   erzeugeHandler({vault, ...}) → async ({methode, pfad, query, body}) => ({status, headers, body: Buffer, stopp?})
// Genutzt von werkstatt.mjs (Brücke zur App) und entwicklung.mjs (HTTP für Tests). Statische Dateien kommen aus ../studio/.
import { readFileSync, realpathSync, statSync, accessSync, constants } from "node:fs";
import { join, dirname, sep, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { oeffneVault, HttpFehler } from "../gemeinsam/vault.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
export const MAX_KOERPER = 8 * 1024 * 1024;

const CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'";
const TYPEN = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json",
};
const JSON_KOPF = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

const json = (status, daten) => ({ status, headers: { ...JSON_KOPF }, body: Buffer.from(JSON.stringify(daten)) });
const fehler = (status, meldung, extra = {}) => json(status, { fehler: meldung, ...extra });

export function appVersionLesen() {
  if (process.env.BRAIN_APP_VERSION) return process.env.BRAIN_APP_VERSION;
  for (const p of [join(HIER, "..", "Info.plist"), join(HIER, "..", "..", "Info.plist")]) {
    try { const m = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(readFileSync(p, "utf8")); if (m) return m[1]; } catch { /* nächster */ }
  }
  return "dev";
}

const shellText = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

// `claude` im PATH suchen; zusätzlich die üblichen Orte (eine GUI-App hat nur einen knappen PATH).
// BRAIN_CLAUDE_EXTRA (Doppelpunkt-Liste, auch leer) ersetzt diese Zusatzorte — so bleiben Tests vom echten claude fern.
export function findeClaude(env = process.env) {
  const extra = env.BRAIN_CLAUDE_EXTRA !== undefined
    ? env.BRAIN_CLAUDE_EXTRA.split(delimiter).filter(Boolean)
    : [join(homedir(), ".local", "bin"), join(homedir(), ".claude", "local"), "/opt/homebrew/bin", "/usr/local/bin"];
  for (const d of [...(env.PATH || "").split(delimiter).filter(Boolean), ...extra]) {
    const p = join(d, "claude");
    try { accessSync(p, constants.X_OK); if (statSync(p).isFile()) return p; } catch { /* weiter */ }
  }
  return null;
}

function statisch(pfad, studioDir) {
  const nicht = fehler(404, "nicht gefunden");
  let dekodiert;
  try { dekodiert = decodeURIComponent(pfad); } catch { return nicht; }
  if (/[\\\0]/.test(dekodiert)) return nicht;
  const teile = dekodiert.split("/").filter((t) => t !== "");
  if (teile.some((t) => t === ".." || t === "." || t.startsWith("."))) return nicht;
  if (!teile.length) teile.push("index.html");
  try {
    const wurzel = realpathSync(studioDir);
    let echt = realpathSync(join(wurzel, ...teile));
    if (statSync(echt).isDirectory()) echt = realpathSync(join(echt, "index.html"));
    if (!echt.startsWith(wurzel + sep) || !statSync(echt).isFile()) return nicht;
    const i = echt.lastIndexOf(".");
    const typ = TYPEN[i > 0 ? echt.slice(i).toLowerCase() : ""] || "application/octet-stream";
    return { status: 200, headers: { "Content-Type": typ, "Cache-Control": "no-cache", "Content-Security-Policy": CSP,
      "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" }, body: readFileSync(echt) };
  } catch { return nicht; }
}

export function erzeugeHandler(o) {
  const v = oeffneVault(o.vault, o.vaultOptionen || {});
  const studioDir = o.studioDir || join(HIER, "..", "studio");
  const appVersion = o.appVersion || appVersionLesen();
  const mcpPfad = o.mcpPfad || join(HIER, "..", "mcp", "brain-mcp.mjs");
  const nodePfad = o.nodePfad || process.execPath;
  const mcpArgs = () => { try { statSync(mcpPfad); } catch { return null; } return [nodePfad, realpathSync(mcpPfad), v.wurzel]; };
  const mcpBefehl = () => { const a = mcpArgs(); return a ? `claude mcp add -s user brain -- ${a.map(shellText).join(" ")}` : null; };

  async function api(methode, pfad, q, koerper) {
    const eingabe = () => {
      if (!koerper || !koerper.length) throw new HttpFehler(400, "Die Anfrage hat keinen Inhalt.");
      try { const j = JSON.parse(koerper.toString("utf8")); if (j && typeof j === "object" && !Array.isArray(j)) return j; } catch { /* unten */ }
      throw new HttpFehler(400, "Die Anfrage ist kein gültiges JSON.");
    };
    const nur = (erlaubt) => { if (methode !== erlaubt) throw new HttpFehler(405, "Diese Methode ist hier nicht erlaubt."); };
    switch (pfad) {
      case "/api/info": nur("GET");
        return { vault: v.wurzel, name: v.name, appVersion, kitVersion: v.kitVersion(), git: await v.istGitRepo(), mcpBefehl: mcpBefehl() };
      case "/api/baum": nur("GET"); return v.baum();
      case "/api/datei":
        if (methode === "GET") return v.lies(q.get("pfad"));
        if (methode === "PUT") { const e = eingabe(); return v.schreibe({ pfad: e.pfad, inhalt: e.inhalt, basisHash: e.basisHash }); }
        throw new HttpFehler(405, "Diese Methode ist hier nicht erlaubt.");
      case "/api/neu": nur("POST"); return v.neu(eingabe());
      case "/api/merken": nur("POST"); return v.merken(eingabe());
      case "/api/suche": nur("GET"); return v.suche(q.get("q"));
      case "/api/pruefung": nur("GET"); return v.pruefung(q.get("pfad"));
      case "/api/gesundheit": nur("GET"); return v.gesundheit();
      case "/api/rueckfragen": nur("GET"); return v.rueckfragen();
      case "/api/git/status": nur("GET"); return v.gitStatus();
      case "/api/git/commit": nur("POST"); return v.gitCommit(eingabe());
      case "/api/git/sync": nur("POST"); return v.gitSync();
      case "/api/git/verlauf": nur("GET"); return v.gitVerlauf(q.get("pfad"), q.get("max"));
      case "/api/git/diff": nur("GET"); return v.gitDiff(q.get("pfad"), q.get("sha") || undefined);
      case "/api/git/fassung": nur("GET"); return v.gitFassung(q.get("pfad"), q.get("sha"));
      case "/api/mcp/verbinden": { nur("POST"); return verbinde(eingabe()); }
      case "/api/stopp": nur("POST"); return { __stopp: true };
      default: throw new HttpFehler(404, "nicht gefunden");
    }
  }

  function verbinde(e) {
    if (e.ziel !== "claude") throw new HttpFehler(400, "Unbekanntes Ziel — möglich ist: claude.");
    const a = mcpArgs(), befehl = mcpBefehl();
    if (!a) throw new HttpFehler(404, "Der MCP-Server wurde nicht gefunden.", { befehl: null });
    const claude = findeClaude();
    if (!claude) throw new HttpFehler(404, "Claude Code wurde nicht gefunden. Kopiere den Befehl und führe ihn im Terminal aus.", { befehl });
    return new Promise((ok, nein) => {
      execFile(claude, ["mcp", "add", "-s", "user", "brain", "--", ...a], { timeout: 30_000, env: { ...process.env, CI: "1" } }, (err, stdout, stderr) => {
        const ausgabe = (String(stdout || "") + String(stderr || "")).trim().slice(0, 2000);
        if (!err) return ok({ ok: true, ausgabe });
        if (/already exists/i.test(ausgabe)) return nein(new HttpFehler(409, "Brain ist bei Claude Code schon eingetragen.", { befehl, ausgabe }));
        nein(new HttpFehler(502, "Claude Code hat den Eintrag abgelehnt. Kopiere den Befehl und führe ihn im Terminal aus.", { befehl, ausgabe }));
      });
    });
  }

  return async function behandle({ methode = "GET", pfad = "/", query, body }) {
    methode = String(methode).toUpperCase();
    if (!pfad.startsWith("/api/") && pfad !== "/api") {
      if (methode !== "GET" && methode !== "HEAD") return fehler(405, "Diese Methode ist hier nicht erlaubt.");
      return statisch(pfad, studioDir);
    }
    const q = query instanceof URLSearchParams ? query : new URLSearchParams(query || "");
    try {
      const erg = await api(methode, pfad, q, body);
      if (erg && erg.__stopp) return { ...json(200, { ok: true }), stopp: true };
      return json(200, erg === undefined ? { ok: true } : erg);
    } catch (e) {
      if (e instanceof HttpFehler) return fehler(e.status, e.message, e.extra);
      return fehler(500, "Interner Fehler");
    }
  };
}
