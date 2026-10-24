// werkstatt/handler.mjs — die Routen von Brain Studio (Spec §5) als reine Funktion, ohne Socket:
//   erzeugeHandler({vault, ...}) → async ({methode, pfad, query, body}) => ({status, headers, body: Buffer, stopp?})
// Genutzt von werkstatt.mjs (Brücke zur App) und entwicklung.mjs (HTTP für Tests). Statische Dateien kommen aus ../studio/.
import { readFileSync, realpathSync, statSync, existsSync } from "node:fs";
import { join, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { oeffneVault, HttpFehler } from "../gemeinsam/vault.mjs";
import { kindUmgebung } from "../gemeinsam/basis.mjs";
import { findeProgramm, erkenneAgenten } from "../gemeinsam/ki.mjs";
import * as vaultsFn from "../gemeinsam/vaults.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
export const MAX_KOERPER = 8 * 1024 * 1024;

const CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; base-uri 'none'; object-src 'none'; form-action 'none'; frame-ancestors 'none'";
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

// `claude` im PATH und an den üblichen Orten suchen (Logik und Test-Schalter BRAIN_CLAUDE_EXTRA/BRAIN_TESTMODUS: gemeinsam/ki.mjs).
export const findeClaude = (env = process.env) => findeProgramm("claude", env);

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

const STANDARD_FARBE = "#7C8798";
const istOrdner = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const echterPfad = (p) => { try { return realpathSync(p); } catch { return p; } };

export function erzeugeHandler(o) {
  const vaultOpt = o.vaultOptionen || {};
  const optV = () => (vaultOpt.support ? { support: vaultOpt.support } : {});
  const studioDir = o.studioDir || join(HIER, "..", "studio");
  const appVersion = o.appVersion || appVersionLesen();
  const mcpPfad = o.mcpPfad || join(HIER, "..", "mcp", "brain-mcp.mjs");
  const nodePfad = o.nodePfad || process.execPath;

  // Der offene Vault kann zur Laufzeit wechseln (POST /api/vaults/…): jede Anfrage hält den bei ihrem Start offenen Vault fest.
  // Start: Vault-Argument hat Vorrang; sonst der aktive Vault aus vaults.json; sonst ohne Vault (Willkommen).
  let aktuell = null;
  const oeffne = (pfad) => oeffneVault(pfad, vaultOpt);
  const wechsleZu = (pfad) => { aktuell = pfad ? oeffne(pfad) : null; };
  if (o.vault) aktuell = oeffne(o.vault); // falscher Ordner → HttpFehler wie bisher
  else {
    const p = vaultsFn.aktiverVaultPfad(optV());
    if (p) { try { aktuell = oeffne(p); } catch { aktuell = null; } }
  }

  const mcpArgs = (v) => { try { statSync(mcpPfad); } catch { return null; } return [nodePfad, realpathSync(mcpPfad), v.wurzel]; };
  const mcpBefehl = (v) => { const a = mcpArgs(v); return a ? `claude mcp add -s user brain -- ${a.map(shellText).join(" ")}` : null; };

  // Liste für die Oberfläche: gespeicherte Vaults (+ ein nur für diesen Start geöffneter, der nicht in vaults.json steht).
  function vaultListe(v) {
    const l = vaultsFn.leseVaults(optV());
    const aktivPfad = v ? v.wurzel : null;
    const vaults = l.vaults.map((e) => ({ name: e.name, pfad: e.pfad, farbe: e.farbe, aktiv: echterPfad(e.pfad) === aktivPfad, vorhanden: istOrdner(e.pfad), git: existsSync(join(e.pfad, ".git")) }));
    if (v && !vaults.some((e) => e.aktiv)) vaults.unshift({ name: v.name, pfad: v.wurzel, farbe: STANDARD_FARBE, aktiv: true, vorhanden: true, git: existsSync(join(v.wurzel, ".git")), temporaer: true });
    return { vaults, aktiv: aktivPfad };
  }

  async function api(methode, pfad, q, koerper, v) {
    const eingabe = () => {
      if (!koerper || !koerper.length) throw new HttpFehler(400, "Die Anfrage hat keinen Inhalt.");
      try { const j = JSON.parse(koerper.toString("utf8")); if (j && typeof j === "object" && !Array.isArray(j)) return j; } catch { /* unten */ }
      throw new HttpFehler(400, "Die Anfrage ist kein gültiges JSON.");
    };
    const nur = (erlaubt) => { if (methode !== erlaubt) throw new HttpFehler(405, "Diese Methode ist hier nicht erlaubt."); };
    // Routen ohne Vault: info, vaults/*, ki/erkennen, stopp. Alle anderen brauchen einen offenen Vault.
    const V = () => { if (!v) throw new HttpFehler(409, "Es ist noch kein Vault geöffnet.", { keinVault: true }); return v; };
    const neuerStand = (r) => { wechsleZu(r.vault.pfad); return { ...vaultListe(aktuell), vault: r.vault, git: r.git }; };
    switch (pfad) {
      case "/api/info": {
        nur("GET");
        if (!v) return { vault: null, name: null, appVersion, kitVersion: null, git: false, mcpBefehl: null, kit: { vorhanden: false, vertraut: false }, vertrauen: null };
        const stand = v.vertrauenStand(); // einmal prüfen: kit.vertraut === vertrauen.erlaubt
        return { vault: v.wurzel, name: v.name, appVersion, kitVersion: v.kitVersion(), git: await v.istGitRepo(), mcpBefehl: mcpBefehl(v), kit: v.kit(stand), vertrauen: stand };
      }
      case "/api/kit/vertrauen": nur("POST"); return V().vertrauen(eingabe().erlauben);
      case "/api/baum": nur("GET"); return V().baum();
      case "/api/datei":
        if (methode === "GET") return V().lies(q.get("pfad"));
        if (methode === "PUT") { const e = eingabe(); return V().schreibe({ pfad: e.pfad, inhalt: e.inhalt, basisHash: e.basisHash }); }
        throw new HttpFehler(405, "Diese Methode ist hier nicht erlaubt.");
      case "/api/neu": nur("POST"); return V().neu(eingabe());
      case "/api/merken": nur("POST"); return V().merken(eingabe());
      case "/api/suche": nur("GET"); return V().suche(q.get("q"));
      case "/api/pruefung": nur("GET"); return V().pruefung(q.get("pfad"));
      case "/api/gesundheit": nur("GET"); return V().gesundheit();
      case "/api/rueckfragen": nur("GET"); return V().rueckfragen();
      case "/api/notizen": nur("GET"); return V().notizen();
      case "/api/notiz/kontext": nur("GET"); return V().notizKontext(q.get("pfad"));
      case "/api/typen": nur("GET"); return V().typen();
      case "/api/ansichten": nur("GET"); return V().ansichten();
      case "/api/probe": {
        nur("POST");
        const e = eingabe();
        if (typeof e.frage !== "string" || !e.frage.trim() || e.frage.length > 500) throw new HttpFehler(400, "Bitte eine Frage eingeben (höchstens 500 Zeichen).");
        const r = V().suchenFuerKi(e.frage, e.anzahl);
        return { frage: e.frage.trim(), treffer: r.treffer, text: r.text };
      }
      case "/api/git/status": nur("GET"); return V().gitStatus();
      case "/api/git/commit": nur("POST"); return V().gitCommit(eingabe());
      case "/api/git/sync": nur("POST"); return V().gitSync();
      case "/api/git/verlauf": nur("GET"); return V().gitVerlauf(q.get("pfad"), q.get("max"));
      case "/api/git/log": nur("GET"); return V().gitLog({ max: q.get("max"), vor: q.get("vor") || undefined });
      case "/api/git/remote": nur("POST"); return V().gitRemote(eingabe().url);
      case "/api/git/diff": nur("GET"); return V().gitDiff(q.get("pfad"), q.get("sha") || undefined);
      case "/api/git/fassung": nur("GET"); return V().gitFassung(q.get("pfad"), q.get("sha"));
      case "/api/mcp/verbinden": { nur("POST"); return verbinde(V(), eingabe()); }
      case "/api/ki/erkennen": nur("GET"); return erkenneAgenten({ neu: q.get("neu") === "1" });
      case "/api/vaults": nur("GET"); return vaultListe(v);
      case "/api/vaults/aktiv": {
        nur("POST");
        const l = vaultsFn.waehleAktiv(eingabe().pfad, optV());
        wechsleZu(l.aktiv);
        return vaultListe(aktuell);
      }
      case "/api/vaults/neu": nur("POST"); return neuerStand(await vaultsFn.neuesVault(eingabe(), optV()));
      case "/api/vaults/oeffnen": nur("POST"); return neuerStand(await vaultsFn.oeffneOrdner(eingabe(), optV()));
      case "/api/vaults/klonen": nur("POST"); return neuerStand(await vaultsFn.klone(eingabe(), optV()));
      case "/api/vaults/entfernen": {
        nur("POST");
        const e = eingabe();
        let weg = e.pfad; try { weg = realpathSync(e.pfad); } catch { /* Ordner schon weg: Pfad wie gegeben */ }
        const l = vaultsFn.entferne(e.pfad, optV());
        if (v && weg === v.wurzel) wechsleZu(l.aktiv); // der offene Vault wurde aus der Liste genommen → nächster oder Willkommen
        return vaultListe(aktuell);
      }
      case "/api/stopp": nur("POST"); return { __stopp: true };
      default: throw new HttpFehler(404, "nicht gefunden");
    }
  }

  function verbinde(v, e) {
    if (e.ziel !== "claude") throw new HttpFehler(400, "Unbekanntes Ziel — möglich ist: claude.");
    const a = mcpArgs(v), befehl = mcpBefehl(v);
    if (!a) throw new HttpFehler(404, "Der MCP-Server wurde nicht gefunden.", { befehl: null });
    const claude = findeClaude();
    if (!claude) throw new HttpFehler(404, "Claude Code wurde nicht gefunden. Kopiere den Befehl und führe ihn im Terminal aus.", { befehl });
    return new Promise((ok, nein) => {
      execFile(claude, ["mcp", "add", "-s", "user", "brain", "--", ...a], { timeout: 30_000, env: kindUmgebung({ CI: "1" }) }, (err, stdout, stderr) => {
        const ausgabe = (String(stdout || "") + String(stderr || "")).trim().slice(0, 2000);
        if (!err) return ok({ ok: true, ausgabe });
        if (/already exists/i.test(ausgabe)) return nein(new HttpFehler(409, "Brain ist bei Claude Code schon eingetragen.", { befehl, ausgabe }));
        nein(new HttpFehler(502, "Claude Code hat den Eintrag abgelehnt. Kopiere den Befehl und führe ihn im Terminal aus.", { befehl, ausgabe }));
      });
    });
  }

  async function behandle({ methode = "GET", pfad = "/", query, body }) {
    methode = String(methode).toUpperCase();
    if (!pfad.startsWith("/api/") && pfad !== "/api") {
      if (methode !== "GET" && methode !== "HEAD") return fehler(405, "Diese Methode ist hier nicht erlaubt.");
      return statisch(pfad, studioDir);
    }
    const q = query instanceof URLSearchParams ? query : new URLSearchParams(query || "");
    const v = aktuell; // dieser Vault gilt für die ganze Anfrage, auch wenn währenddessen gewechselt wird
    try {
      const erg = await api(methode, pfad, q, body, v);
      if (erg && erg.__stopp) return { ...json(200, { ok: true }), stopp: true };
      return json(200, erg === undefined ? { ok: true } : erg);
    } catch (e) {
      if (e instanceof HttpFehler) return fehler(e.status, e.message, e.extra);
      return fehler(500, "Interner Fehler");
    }
  }
  behandle.aktuellerVaultPfad = () => (aktuell ? aktuell.wurzel : null);
  return behandle;
}
