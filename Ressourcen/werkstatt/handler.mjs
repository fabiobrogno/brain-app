// werkstatt/handler.mjs — die Routen von Brain Studio (Spec §5) als reine Funktion, ohne Socket:
//   erzeugeHandler({vault, ...}) → async ({methode, pfad, query, body}) => ({status, headers, body: Buffer, stopp?})
// Genutzt von werkstatt.mjs (Brücke zur App) und entwicklung.mjs (HTTP für Tests). Statische Dateien kommen aus ../studio/.
import { readFileSync, realpathSync, statSync, existsSync, writeFileSync, copyFileSync, mkdirSync, renameSync, readdirSync, rmSync, chmodSync, constants as fsKonst } from "node:fs";
import { join, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { oeffneVault, HttpFehler } from "../gemeinsam/vault.mjs";
import { kindUmgebung, supportOrdner, falte } from "../gemeinsam/basis.mjs";
import { starte, neueFrist, registriere, beendeGruppe } from "../gemeinsam/prozess.mjs";
import { findeProgramm, erkenneAgenten } from "../gemeinsam/ki.mjs";
import * as vaultsFn from "../gemeinsam/vaults.mjs";
import { erzeugeGitHub } from "../gemeinsam/github.mjs";
import { sicherungStand } from "../gemeinsam/gitsicherung.mjs";
import { erzeugeVerdrahtung } from "./verdrahtung.mjs";
import { profilZuPfad, mitProfil } from "./profile.mjs";

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
// Derselbe Ordner? (kanonische Pfade, ohne Groß/klein und Unicode-Form; ein Pfad, den es nicht gibt, ist nie derselbe)
const gleicherOrdner = (a, b) => { try { return falte(realpathSync.native(a)) === falte(realpathSync.native(b)); } catch { return false; } };

export function erzeugeHandler(o) {
  const vaultOpt = o.vaultOptionen || {};
  const optV = () => (vaultOpt.support ? { support: vaultOpt.support } : {});
  const studioDir = o.studioDir || join(HIER, "..", "studio");
  const appVersion = o.appVersion || appVersionLesen();
  const mcpPfad = o.mcpPfad || join(HIER, "..", "mcp", "brain-mcp.mjs");
  const nodePfad = o.nodePfad || process.execPath;

  // GitHub-Anmeldung (Gerätecode): die Client-ID kommt aus der Umgebung (Info.plist → App), nie aus dem Code. o.github = Ersatz für Tests.
  const github = o.github || erzeugeGitHub({ clientId: process.env.KORTEX_GITHUB_CLIENT_ID, basis: process.env.BRAIN_GITHUB_BASIS, apiBasis: process.env.BRAIN_GITHUB_API,
    helper: process.env.BRAIN_GITHUB_HELPER });

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

  // Der Eintrag bei Claude Code nennt keinen Vault: der MCP-Server folgt dem aktiven Vault aus vaults.json (Spec v2 §8).
  const mcpArgs = () => { try { statSync(mcpPfad); } catch { return null; } return [nodePfad, realpathSync(mcpPfad)]; };
  const mcpBefehl = () => { const a = mcpArgs(); return a ? `claude mcp add -s user brain -- ${a.map(shellText).join(" ")}` : null; };
  const codexBefehl = () => { const a = mcpArgs(); return a ? `codex mcp add brain -- ${a.map(shellText).join(" ")}` : null; };
  const cursorEintrag = () => { const a = mcpArgs(); return a ? { command: a[0], args: [a[1]] } : null; };
  // Text zum Kopieren für Cursor: der Eintrag für ~/.cursor/mcp.json
  const cursorText = () => { const e = cursorEintrag(); return e ? JSON.stringify({ mcpServers: { brain: e } }, null, 2) : null; };
  // Gesamtfristen je Route in ms (nur im Test kürzer): mcp/verbinden 25 s, Probe über den MCP-Server 10 s.
  const fristen = { mcpVerbinden: 25_000, probe: 10_000, ...(o.fristen || {}) };
  // Einrichtung über den Starter der App (Hooks bei Claude Code, Prüfung vor dem Speichern, Hintergrunddienst): werkstatt/verdrahtung.mjs. o.starter = Ersatz für Tests.
  const verdrahtung = erzeugeVerdrahtung({ starter: o.starter || join(vaultOpt.support || supportOrdner(), "bin", "kortex"), support: vaultOpt.support || supportOrdner() });

  // Liste für die Oberfläche: gespeicherte Vaults (+ ein nur für diesen Start geöffneter, der nicht in vaults.json steht).
  function vaultListe(v) {
    const l = vaultsFn.leseVaults(optV());
    const aktivPfad = v ? v.wurzel : null;
    const vaults = l.vaults.map((e) => ({ name: e.name, pfad: e.pfad, farbe: e.farbe, aktiv: echterPfad(e.pfad) === aktivPfad, vorhanden: istOrdner(e.pfad), git: existsSync(join(e.pfad, ".git")) }));
    if (v && !vaults.some((e) => e.aktiv)) vaults.unshift({ name: v.name, pfad: v.wurzel, farbe: STANDARD_FARBE, aktiv: true, vorhanden: true, git: existsSync(join(v.wurzel, ".git")), temporaer: true });
    return { vaults, aktiv: aktivPfad, ...(l.defekt ? { defekt: true } : {}) }; // defekt: eine kaputte vaults.json wurde gesichert und ersetzt
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
        return { vault: v.wurzel, name: v.name, appVersion, kitVersion: v.kitVersion(), git: await v.istGitRepo(), mcpBefehl: mcpBefehl(), mcpBefehle: { claude: mcpBefehl(), codex: codexBefehl(), cursor: cursorText() }, kit: v.kit(stand), vertrauen: stand };
      }
      case "/api/kit/vertrauen": {
        // { erlauben, vault }: vault ist der Pfad, den der Dialog gezeigt hat. Der offene Vault kann zwischen Anzeige und Klick gewechselt haben
        // (Vault-Wechsel, Abgleich, anderes Fenster) — freigegeben (oder widerrufen) wird nie ein Vault, den der Nutzer nicht vor sich hatte.
        nur("POST");
        const e = eingabe();
        if (typeof e.erlauben !== "boolean") throw new HttpFehler(400, "„erlauben“ muss true oder false sein.");
        const offen = V();
        if (typeof e.vault !== "string" || !e.vault.trim()) throw new HttpFehler(400, "Der Vault fehlt: Die Anfrage nennt den Ordner, den der Dialog gezeigt hat.");
        if (!gleicherOrdner(e.vault, offen.wurzel)) {
          throw new HttpFehler(409, "Der geöffnete Vault ist inzwischen ein anderer als der, für den die Frage galt. Es wurde nichts geändert — bitte noch einmal prüfen.", { art: "anderer-vault" });
        }
        return offen.vertrauen(e.erlauben);
      }
      case "/api/baum": nur("GET"); return V().baum();
      case "/api/datei":
        if (methode === "GET") return V().lies(q.get("pfad"));
        if (methode === "PUT") { const e = eingabe(); return V().schreibe({ pfad: e.pfad, inhalt: e.inhalt, basisHash: e.basisHash }); }
        throw new HttpFehler(405, "Diese Methode ist hier nicht erlaubt.");
      case "/api/neu": nur("POST"); return V().neu(eingabe());
      case "/api/merken": nur("POST"); return V().merken(eingabe());
      case "/api/posteingang/verwerfen": nur("POST"); return V().posteingangVerwerfen(eingabe());
      case "/api/posteingang/spaeter": nur("POST"); return V().posteingangSpaeter(eingabe());
      case "/api/posteingang/uebernehmen": nur("POST"); return V().posteingangUebernehmen(eingabe());
      case "/api/suche": nur("GET"); return V().suche(q.get("q"));
      case "/api/pruefung": nur("GET"); return V().pruefung(q.get("pfad"));
      case "/api/gesundheit": nur("GET"); return V().gesundheit();
      case "/api/rueckfragen": nur("GET"); return V().rueckfragen();
      case "/api/nutzung": nur("GET"); return V().nutzung();
      case "/api/notizen": nur("GET"); return V().notizen();
      case "/api/notiz/kontext": nur("GET"); return V().notizKontext(q.get("pfad"));
      case "/api/typen": nur("GET"); return V().typen();
      case "/api/ansichten": nur("GET"); return V().ansichten();
      case "/api/probe": {
        nur("POST");
        const e = eingabe();
        if (typeof e.frage !== "string" || !e.frage.trim() || e.frage.length > 500) throw new HttpFehler(400, "Bitte eine Frage eingeben (höchstens 500 Zeichen).");
        return probeUeberMcp(V(), e.frage.trim(), e.anzahl);
      }
      case "/api/mcp/selbsttest": nur("POST"); return probeUeberMcp(V(), "Brain", 1, { liste: true, wer: "die KI" });
      case "/api/git/status": nur("GET"); return V().gitStatus();
      case "/api/git/commit": nur("POST"); return V().gitCommit(eingabe());
      case "/api/git/sync": nur("POST"); return V().gitSync(koerper && koerper.length ? eingabe() : {});
      case "/api/git/konflikt": nur("GET"); return V().gitKonflikte(q.get("pfad") || undefined);
      case "/api/git/konflikt/loesen": nur("POST"); return V().gitKonfliktAbschliessen(eingabe());
      case "/api/git/konflikt/abbrechen": nur("POST"); return V().gitKonfliktAbbrechen();
      case "/api/git/nachsehen": nur("POST"); return V().gitNachsehen();
      case "/api/git/wiederherstellen/vorschau": nur("GET"); return V().gitWiederherstellenVorschau(q.get("pfad"), q.get("sha"));
      case "/api/git/wiederherstellen": nur("POST"); return V().gitWiederherstellen(eingabe());
      case "/api/git/verlauf": nur("GET"); return V().gitVerlauf(q.get("pfad"), q.get("max"));
      case "/api/git/log": nur("GET"); return V().gitLog({ max: q.get("max"), vor: q.get("vor") || undefined });
      case "/api/git/remote": nur("POST"); return V().gitRemote(eingabe().url);
      case "/api/git/diff": nur("GET"); return V().gitDiff(q.get("pfad"), q.get("sha") || undefined);
      case "/api/git/fassung": nur("GET"); return V().gitFassung(q.get("pfad"), q.get("sha"));
      case "/api/kern/stand": nur("GET"); return verdrahtung.stand(v);
      case "/api/kern/verdrahten": nur("POST"); return verdrahtung.verdrahte(v, eingabe());
      case "/api/mcp/verbinden": { nur("POST"); V(); return verbinde(eingabe()); }
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
        if (v && weg === v.wurzel) { // der offene Vault wurde aus der Liste genommen → nächster oder Willkommen
          // Der Nachfolger ist schon gespeichert: lässt er sich nicht öffnen, ist jetzt eben kein Vault offen (200, aktiv: null — die
          // Oberfläche zeigt Willkommen). Ein 400 NACH dem Speichern ließe die Oberfläche beim entfernten Vault stehen.
          try { wechsleZu(l.aktiv); } catch { aktuell = null; }
        }
        return vaultListe(aktuell);
      }
      case "/api/github/anmelden":
        if (methode === "POST") return github.anmelden();
        nur("GET"); return github.status();
      case "/api/github/konto": nur("GET"); return github.konto();
      case "/api/github/abmelden": nur("POST"); return github.abmelden();
      case "/api/github/abbrechen": nur("POST"); return github.abbrechen(); // nur das Warten beenden, nie den Schlüsselbund anfassen
      case "/api/github/repos": nur("GET"); return github.repos(); // eigene PRIVATE Repositories (Sicherung)
      case "/api/github/repo-anlegen": nur("POST"); return github.repoAnlegen(eingabe()); // legt immer ein privates Repository an
      // Sicherung (Assistent): bereit? — und verbinden mit einem PRIVATEN Repository des Kontos (nur besitzer/name; die Adresse baut die Werkstatt).
      case "/api/sicherung/bereit": nur("GET"); return sicherungStand(await V().gitStatus());
      case "/api/sicherung/verbinden": {
        nur("POST");
        const e = eingabe();
        const stand = sicherungStand(await V().gitStatus());
        if (stand.zustand === "gesichert") throw new HttpFehler(409, "Dein Brain ist schon mit einem Server verbunden.", { art: "gesichert" });
        if (stand.zustand !== "bereit") throw new HttpFehler(409, stand.text, { art: "blockiert", grund: stand.grund });
        const repo = await github.repoPruefen(e.besitzer, e.name); // gibt es, privat, beschreibbar — sonst Fehler, bevor etwas gesendet wird
        return V().gitRemote(repo.url, { githubHelper: github.helper });
      }
      case "/api/stopp": nur("POST"); return { __stopp: true };
      default: throw new HttpFehler(404, "nicht gefunden");
    }
  }

  // Vergleich NUR intern: Command/Args des vorhandenen Eintrags stehen nie in einer Antwort oder im Log (fremde Einträge können
  // Zugangsdaten enthalten). Unlesbar oder anderer Typ (http/sse) zählt als „anders“.
  // Ergebnis: "gleich" (schon richtig eingetragen), "alt" (derselbe Server, nur der Node-Pfad ist ein früherer der App — wird ohne
  // Rückfrage auf den stabilen Pfad umgestellt) oder "anders" (fremder Eintrag: Rückfrage). Alte App-Pfade:
  // …/Application Support/Brain/node/<ver>/bin/node (vor der Umbenennung) und …/Kortex/node/<ver>/bin/node (aufgelöster Pfad).
  const ALTER_APP_NODE = /\/Application Support\/(?:Brain|Kortex)\/node\/[^/]+\/bin\/node$/;
  const befehlsArt = (cmd, argsGleich, a) => {
    if (!argsGleich) return "anders";
    if (cmd === a[0]) return "gleich";
    return typeof cmd === "string" && ALTER_APP_NODE.test(cmd) ? "alt" : "anders";
  };
  const artClaude = (text, a) => {
    const cmd = /^\s*Command:\s*(.+?)\s*$/m.exec(text), args = /^\s*Args:\s*(.*?)\s*$/m.exec(text);
    return cmd ? befehlsArt(cmd[1], (args ? args[1] : "") === a.slice(1).join(" "), a) : "anders";
  };

  // Gesamtfrist 25 s für get/remove/add zusammen; bei Ablauf wird der laufende Aufruf samt Prozessgruppe beendet.
  function verbinde(e) {
    if (e.ziel === "codex") return verbindeCodex(e);
    if (e.ziel === "cursor") return verbindeCursor(e);
    if (e.ziel !== "claude") throw new HttpFehler(400, "Unbekanntes Ziel — möglich ist: claude, codex, cursor.");
    return verbindeClaude(e);
  }

  // Codex: `codex mcp get brain --json` (nur zum Vergleichen), bei fremdem Eintrag nach Rückfrage `remove`, dann `add`.
  async function verbindeCodex(e) {
    const a = mcpArgs(), befehl = codexBefehl();
    if (!a) throw new HttpFehler(404, "Der MCP-Server wurde nicht gefunden.", { befehl: null });
    const codex = findeProgramm("codex");
    if (!codex) throw new HttpFehler(404, "Codex wurde nicht gefunden. Kopiere den Befehl und führe ihn im Terminal aus.", { befehl });
    const frist = neueFrist(fristen.mcpVerbinden);
    const lauf = (args) => starte(codex, args, { cwd: homedir(), env: kindUmgebung({ CI: "1" }), frist, timeout: fristen.mcpVerbinden, fehlt: "Codex wurde nicht gefunden.", zuLange: "Codex hat nicht rechtzeitig geantwortet." });
    const ausgabeVon = (r) => (String(r.stdout || "") + String(r.stderr || "")).trim().slice(0, 2000);
    const art = (text) => { // Vergleich nur intern, nichts davon in Antworten
      try { const t = JSON.parse(text).transport; return !t ? "anders" : befehlsArt(t.command, JSON.stringify(t.args || []) === JSON.stringify(a.slice(1)), a); } catch { return "anders"; }
    };
    try {
      const vorher = await lauf(["mcp", "get", "brain", "--json"]);
      if (vorher.code === 0) {
        const vergleich = art(String(vorher.stdout || ""));
        if (vergleich === "gleich") return { ok: true, schonVerbunden: true };
        if (vergleich !== "alt" && e.umstellen !== true) throw new HttpFehler(409, "Bei Codex ist unter dem Namen „brain“ schon ein anderer Server eingetragen. Möchtest du ihn auf Brain Studio umstellen?", { art: "anders", befehl });
        const weg = await lauf(["mcp", "remove", "brain"]);
        if (weg.code !== 0) throw new HttpFehler(502, "Codex konnte den alten Eintrag nicht entfernen. Kopiere den Befehl und führe ihn im Terminal aus.", { befehl });
      }
      const neu = await lauf(["mcp", "add", "brain", "--", ...a]);
      const ausgabe = ausgabeVon(neu);
      if (neu.code === 0) return { ok: true, ausgabe };
      throw new HttpFehler(502, "Codex hat den Eintrag abgelehnt. Kopiere den Befehl und führe ihn im Terminal aus.", { befehl, ausgabe });
    } catch (err) {
      if (err instanceof HttpFehler && err.status === 504) throw new HttpFehler(504, "Codex hat nicht rechtzeitig geantwortet (nach 25 Sekunden abgebrochen). Kopiere den Befehl und führe ihn im Terminal aus.", { befehl });
      throw err;
    }
  }

  // Cursor: Eintrag „brain“ in ~/.cursor/mcp.json. Vorher Sicherung; andere Einträge bleiben unverändert; kaputtes JSON wird nie überschrieben.
  function verbindeCursor(e) {
    const eintrag = cursorEintrag(), befehl = cursorText();
    if (!eintrag) throw new HttpFehler(404, "Der MCP-Server wurde nicht gefunden.", { befehl: null });
    const ordner = join(homedir(), ".cursor"), datei = join(ordner, "mcp.json");
    let doc = {}, vorhanden = false;
    try {
      const roh = readFileSync(datei, "utf8");
      vorhanden = true;
      if (roh.trim()) { // leere Datei zählt wie neu
        try { doc = JSON.parse(roh); } catch { doc = null; }
        if (!doc || typeof doc !== "object" || Array.isArray(doc) || (doc.mcpServers !== undefined && (!doc.mcpServers || typeof doc.mcpServers !== "object" || Array.isArray(doc.mcpServers)))) {
          throw new HttpFehler(422, "Die Datei ~/.cursor/mcp.json ist kein gültiges JSON in der erwarteten Form. Brain Studio ändert sie deshalb nicht. Ergänze den Eintrag von Hand:", { art: "kaputt", befehl });
        }
      }
    } catch (err) {
      if (err instanceof HttpFehler) throw err;
      if (err && err.code !== "ENOENT") throw new HttpFehler(502, "Die Datei ~/.cursor/mcp.json ließ sich nicht lesen. Ergänze den Eintrag von Hand:", { befehl });
    }
    const alt = doc.mcpServers && doc.mcpServers.brain;
    if (alt !== undefined) {
      const vergleich = alt && typeof alt === "object" ? befehlsArt(alt.command, JSON.stringify(alt.args || []) === JSON.stringify(eintrag.args), [eintrag.command]) : "anders";
      if (vergleich === "gleich") return { ok: true, schonVerbunden: true };
      if (vergleich !== "alt" && e.umstellen !== true) throw new HttpFehler(409, "Bei Cursor ist unter dem Namen „brain“ schon ein anderer Server eingetragen. Möchtest du ihn auf Brain Studio umstellen?", { art: "anders", befehl });
    }
    let tmp = null;
    try {
      let sicherung = null, modus = 0o600; // neue Datei: nur für den Nutzer lesbar (andere MCP-Server tragen oft Tokens ein)
      let ziel = datei; // ein Symlink (Dotfiles) bleibt ein Symlink: geschrieben wird beim echten Ziel
      if (vorhanden) {
        try { ziel = realpathSync(datei); } catch { /* bleibt datei */ }
        modus = statSync(ziel).mode & 0o777;
        sicherung = sichereCursorDatei(ordner, datei, ziel, modus);
      } else mkdirSync(ordner, { recursive: true });
      const neu = { ...doc, mcpServers: { ...(doc.mcpServers || {}), brain: eintrag } };
      tmp = `${ziel}.brain-neu`;
      writeFileSync(tmp, JSON.stringify(neu, null, 2) + "\n", { mode: modus });
      chmodSync(tmp, modus); // umask darf die Rechte nicht verändern
      renameSync(tmp, ziel);
      tmp = null;
      return { ok: true, ...(sicherung ? { sicherung } : {}) };
    } catch (err) {
      if (err instanceof HttpFehler) throw err;
      throw new HttpFehler(502, `Cursor ließ sich nicht einrichten (Fehler ${err && err.code ? err.code : "unbekannt"} bei ~/.cursor/mcp.json). Ergänze den Eintrag von Hand:`, { befehl });
    } finally {
      if (tmp) try { rmSync(tmp, { force: true }); } catch { /* egal */ }
    }
  }

  // Sicherung neben der Datei (mit den Rechten des Originals, nie eine vorhandene überschreiben); nur die letzten 3 bleiben, sie enthalten fremde Tokens.
  function sichereCursorDatei(ordner, datei, ziel, modus) {
    const stamm = `${datei}.brain-sicherung-`, zeit = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    let sicherung = null;
    for (let i = 1; i <= 50 && !sicherung; i++) {
      const name = `${stamm}${zeit}${i > 1 ? `-${i}` : ""}`;
      try { copyFileSync(ziel, name, fsKonst.COPYFILE_EXCL); sicherung = name; } catch (err) { if (!err || err.code !== "EEXIST") throw err; }
    }
    if (!sicherung) throw Object.assign(new Error("Sicherung"), { code: "EEXIST" });
    chmodSync(sicherung, modus);
    try {
      const praefix = stamm.slice(ordner.length + 1);
      const alle = readdirSync(ordner).filter((n) => n.startsWith(praefix)).sort();
      for (const n of alle.slice(0, Math.max(0, alle.length - 3))) try { rmSync(join(ordner, n), { force: true }); } catch { /* egal */ }
    } catch { /* Aufräumen ist nicht kritisch */ }
    return sicherung;
  }

  async function verbindeClaude(e) {
    const a = mcpArgs(), befehl = mcpBefehl();
    if (!a) throw new HttpFehler(404, "Der MCP-Server wurde nicht gefunden.", { befehl: null });
    const claude = findeClaude();
    if (!claude) throw new HttpFehler(404, "Claude Code wurde nicht gefunden. Kopiere den Befehl und führe ihn im Terminal aus.", { befehl });
    const frist = neueFrist(fristen.mcpVerbinden);
    // Claude-Profil (Auswahl im Assistenten): nur ein erkanntes Profil; das Standardprofil nutzt ~/.claude.json, ein anderes <Profil>/.claude.json (CLAUDE_CONFIG_DIR).
    const profil = e.profil === undefined ? null : profilZuPfad(e.profil);
    if (e.profil !== undefined && !profil) throw new HttpFehler(400, "Dieses Claude-Profil gibt es nicht (mehr). Suche die Profile bitte neu.", { befehl });
    const lauf = (args) => starte(claude, args, { cwd: homedir(), env: profil ? mitProfil(kindUmgebung({ CI: "1" }), profil) : kindUmgebung({ CI: "1" }), frist, timeout: fristen.mcpVerbinden, fehlt: "Claude Code wurde nicht gefunden.", zuLange: "Claude Code hat nicht rechtzeitig geantwortet." });
    const ausgabeVon = (r) => (String(r.stdout || "") + String(r.stderr || "")).trim().slice(0, 2000);
    try {
      const vorher = await lauf(["mcp", "get", "brain"]); // Ausgabe nur zum Vergleichen
      if (vorher.code === 0) {
        const art = artClaude(String(vorher.stdout || "") + "\n" + String(vorher.stderr || ""), a);
        if (art === "gleich") return { ok: true, schonVerbunden: true };
        if (art !== "alt" && e.umstellen !== true) throw new HttpFehler(409, "Bei Claude Code ist unter dem Namen „brain“ schon ein anderer Server eingetragen. Möchtest du ihn auf Brain Studio umstellen?", { art: "anders", befehl });
        const weg = await lauf(["mcp", "remove", "-s", "user", "brain"]);
        if (weg.code !== 0) throw new HttpFehler(502, "Claude Code konnte den alten Eintrag nicht entfernen. Kopiere den Befehl und führe ihn im Terminal aus.", { befehl });
      }
      const neu = await lauf(["mcp", "add", "-s", "user", "brain", "--", ...a]);
      const ausgabe = ausgabeVon(neu);
      if (neu.code === 0) return { ok: true, ausgabe };
      if (/already exists/i.test(ausgabe)) throw new HttpFehler(409, "Bei Claude Code ist unter dem Namen „brain“ schon ein Server eingetragen.", { art: "anders", befehl, ausgabe });
      throw new HttpFehler(502, "Claude Code hat den Eintrag abgelehnt. Kopiere den Befehl und führe ihn im Terminal aus.", { befehl, ausgabe });
    } catch (err) {
      // 504 (nicht 409): der Server — hier Claude Code — hat nicht rechtzeitig geantwortet; es wurde nichts Halbes hinterlassen, denn jeder Aufruf
      // ist einzeln atomar und der Umstellen-Weg entfernt erst, wenn noch Zeit für den neuen Eintrag bleibt.
      if (err instanceof HttpFehler && err.status === 504) throw new HttpFehler(504, "Claude Code hat nicht rechtzeitig geantwortet (nach 25 Sekunden abgebrochen). Kopiere den Befehl und führe ihn im Terminal aus.", { befehl });
      throw err;
    }
  }

  // Probe-Frage über den MCP-Server selbst (stdio, JSON-RPC): initialize, dann tools/call brain_suchen — so, wie Claude es tun würde.
  // Der Server wird OHNE Vault-Argument gestartet und folgt dem aktiven Vault aus vaults.json (derselbe Support-Ordner wie wir).
  // Gesamtfrist 10 s; danach (oder nach der Antwort) wird die Prozessgruppe beendet.
  async function probeUeberMcp(v, frage, anzahl, { liste = false, wer = "Claude" } = {}) {
    const a = mcpArgs();
    if (!a) throw new HttpFehler(404, "Der MCP-Server wurde nicht gefunden.");
    let aktivPfad = null; try { aktivPfad = vaultsFn.aktiverVaultPfad(optV()); } catch { /* keine Liste */ }
    if (!aktivPfad || echterPfad(aktivPfad) !== v.wurzel) {
      throw new HttpFehler(409, `Dieser Vault ist in Brain Studio nicht als aktiver Vault eingetragen — ${wer} würde ihn so nicht finden. Wähle ihn zuerst aus.`, { art: "nicht-aktiv" });
    }
    const env = kindUmgebung({ BRAIN_APP_SUPPORT: vaultOpt.support || supportOrdner(), BRAIN_NUTZUNG: "aus" }); // Probe und Selbsttest sind keine KI-Nutzung
    delete env.BRAIN_VAULT;
    const frist = neueFrist(fristen.probe);
    const nachricht = (m) => JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n";
    return new Promise((ok, nein) => {
      let kind, uhr = null, fertig = false, werkzeuge = null, suche = null;
      // fertig, sobald die Suche (und beim Selbsttest auch die Werkzeugliste) geantwortet hat
      const pruefe = () => {
        if (!suche || (liste && !werkzeuge)) return;
        const r = suche.result;
        const text = r && Array.isArray(r.content) ? r.content.map((c) => (c && typeof c.text === "string" ? c.text : "")).join("\n") : "";
        if (suche.error || !r || r.isError) return ende(new HttpFehler(502, text || "Der MCP-Server konnte die Suche nicht ausführen.", { art: "mcp" }));
        const treffer = r._meta && Array.isArray(r._meta["brain-studio/treffer"]) ? r._meta["brain-studio/treffer"] : [];
        ende(null, liste ? { ok: true, werkzeuge, treffer: treffer.length } : { frage, treffer, text });
      };
      const ende = (fehler, wert) => {
        if (fertig) return;
        fertig = true; clearTimeout(uhr);
        beendeGruppe(kind);
        if (fehler) nein(fehler); else ok(wert);
      };
      try { kind = spawn(a[0], [a[1]], { cwd: homedir(), env, detached: true, stdio: ["pipe", "pipe", "ignore"], windowsHide: true }); }
      catch { return nein(new HttpFehler(502, "Der MCP-Server ließ sich nicht starten.", { art: "mcp" })); }
      registriere(kind, null);
      const nichtAntwort = () => ende(new HttpFehler(502, `Der MCP-Server hat nicht geantwortet — ${wer} würde dein Brain so nicht finden.`, { art: "mcp" }));
      kind.on("error", nichtAntwort);
      kind.stdin.on("error", () => { /* Server schon weg */ });
      kind.on("exit", () => setTimeout(nichtAntwort, 300).unref());
      uhr = setTimeout(() => ende(new HttpFehler(504, "Der MCP-Server hat nicht rechtzeitig geantwortet (nach 10 Sekunden abgebrochen).", { art: "mcp" })), Math.max(1, frist.rest()));
      createInterface({ input: kind.stdout, crlfDelay: Infinity }).on("line", (zeile) => {
        let m; try { m = JSON.parse(zeile); } catch { return; }
        if (!m || m.jsonrpc !== "2.0") return;
        if (m.id === 1) {
          if (m.error || !m.result) return nichtAntwort();
          kind.stdin.write(nachricht({ method: "notifications/initialized" }));
          if (liste) kind.stdin.write(nachricht({ id: 3, method: "tools/list" }));
          kind.stdin.write(nachricht({ id: 2, method: "tools/call", params: { name: "brain_suchen", arguments: { frage, ...(anzahl ? { anzahl } : {}) } } }));
        } else if (m.id === 3) {
          const t = m.result && Array.isArray(m.result.tools) ? m.result.tools.map((x) => x && x.name).filter((x) => typeof x === "string") : null;
          if (!t || !t.includes("brain_suchen")) return ende(new HttpFehler(502, "Der MCP-Server meldet keine Suche (brain_suchen) — das Werkzeug fehlt.", { art: "mcp" }));
          werkzeuge = t; pruefe();
        } else if (m.id === 2) { suche = m; pruefe(); }
      });
      kind.stdin.write(nachricht({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "brain-studio-probe", version: appVersion } } }));
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
