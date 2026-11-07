// electron/bruecke.mjs — Brücke zwischen Studiofenster und Werkstatt: dasselbe Zeilenprotokoll wie in der Swift-App (Ressourcen/werkstatt/werkstatt.mjs, Kopfzeile),
// die Werkstatt läuft als KINDPROZESS (Begründung im PR: ein hängender Handler friert die Oberfläche nicht ein, derselbe Code wie am Mac,
// kein Port und kein Token — es gibt keinen Netzwerkweg zur Werkstatt). Die Verbindung hier hält nur: starten, Anfragen mit Nummer und Frist, Antworten zuordnen, Neustart nach Absturz, sauber beenden.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readFileSync, accessSync, statSync, constants } from "node:fs";
import { join, delimiter, isAbsolute } from "node:path";

// Sperrliste wie in Swift (NodeUmgebung); Abgleich im Test Tests/Node/electron-huelle.test.mjs
const SPERRE = JSON.parse(readFileSync(new URL("./test-schalter.json", import.meta.url), "utf8"));

// Absolutes `node` aus dem PATH (nur absolute Einträge) oder null. NUR für die Entwicklung (`npm start`): die installierte App bringt ihr eigenes Node mit (laufzeit.mjs) und sucht nie im PATH.
export function findeNode(pfadText, { plattform = process.platform } = {}) {
  const ausfuehrbar = (p) => { try { accessSync(p, constants.X_OK); return statSync(p).isFile(); } catch { return false; } };
  for (const d of String(pfadText || "").split(plattform === "win32" ? ";" : delimiter).filter((e) => e && isAbsolute(e))) {
    const p = join(d, plattform === "win32" ? "node.exe" : "node");
    if (ausfuehrbar(p)) return p;
  }
  return null;
}

// Umgebung des Kindprozesses: ausdrücklich gebaut, nie ein Durchreichen von process.env. Pfad- und Systemvariablen, die Programme (git, claude, codex) zum Starten brauchen,
// dazu BRAIN_*/KORTEX_*. Nie CLAUDE_CONFIG_DIR, CODEX_HOME, GIT_CONFIG_*, Tokens; nie BRAIN_VAULT (der Vault kommt als Argument) und BRAIN_MCP_NODE (kommt von `node`). Im Paket (`gepackt`) zusätzlich
// die Testschalter und KORTEX_VORSCHAU wie in Swift. XDG_* nur außerhalb des Testmodus (dort wird alles ins Temp-HOME gelenkt).
const GRUND = ["PATH", "HOME", "USER", "USERNAME", "LOGNAME", "SHELL", "LANG", "TZ", "TMPDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)",
  "SYSTEMROOT", "SystemRoot", "SYSTEMDRIVE", "windir", "ComSpec", "PATHEXT", "HOMEDRIVE", "HOMEPATH", "COMPUTERNAME", "OS", "PROCESSOR_ARCHITECTURE"];
const XDG = ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"];
// node: stabiler Pfad des Node (BRAIN_MCP_NODE, für MCP-Einträge und Statuszeile), kern: stabiler Kern-Pfad (KORTEX_KERN_PFAD), githubClientId: öffentliche OAuth-Client-ID aus Ressourcen/Info.plist
// (info-plist.mjs; dieselbe Quelle wie die Mac-App, sie setzt sie ebenfalls als KORTEX_GITHUB_CLIENT_ID). Im Paket gilt die aus der Info.plist; in der Entwicklung darf eine gesetzte Variable sie überstimmen.
// vorschau: der geprüfte Ordner der Vorschau (scripts/vorschau-electron.sh); KORTEX_VORSCHAU geht sonst im Paket nie weiter.
export function baueKindUmgebung(env = process.env, { gepackt = false, node = null, kern = null, githubClientId = null, vorschau = null } = {}) {
  const aus = {};
  const nimm = (k) => { if (env[k] !== undefined) aus[k] = env[k]; };
  GRUND.forEach(nimm);
  for (const k of Object.keys(env)) if (/^(LC_|BRAIN_|KORTEX_)/.test(k)) nimm(k);
  if (env.BRAIN_TESTMODUS !== "1") XDG.forEach(nimm);
  delete aus.BRAIN_VAULT; delete aus.BRAIN_MCP_NODE; delete aus.KORTEX_KERN_PFAD;
  if (gepackt) for (const k of [SPERRE.testmodus, ...SPERRE.gesperrt, ...SPERRE.testSchalter]) delete aus[k];
  if (node) aus.BRAIN_MCP_NODE = node;
  if (kern) aus.KORTEX_KERN_PFAD = kern;
  if (vorschau) aus.KORTEX_VORSCHAU = vorschau; // nur ein geprüfter Vorschau-Ordner (gemeinsam/basis.mjs vorschauOrdnerAus): die Werkstatt hält sich dann selbst daran (Zugangsdaten nur im Ordner, nie im Schlüsselbund)
  if (githubClientId && (gepackt || !aus.KORTEX_GITHUB_CLIENT_ID)) aus.KORTEX_GITHUB_CLIENT_ID = githubClientId;
  return aus;
}

const MAX_NEUSTARTS = 3, FENSTER_MS = 60_000;

/**
 * Startet die Werkstatt. `programm` = ein echtes Node (das mitgelieferte, in der Entwicklung das aus dem PATH), `skript` = werkstatt.mjs.
 * fristMs: so lange darf eine Anfrage dauern (Status 504 bei der Hülle; die Werkstatt hat für lange Läufe eigene Fristen), hartMs: nach dem Schließen von stdin bis zum Beenden des Prozesses.
 * → { bereit: Promise<{version, vaultId}>, anfrage({methode, pfad, query, body}) → Promise<{status, headers, body}>, beende(): Promise<void>, lebt(): boolean }
 * Endet die Werkstatt vor dem ersten `bereit`, wird `bereit` abgelehnt (mit Exit-Code und letzter Fehlerausgabe), es gibt keinen Neustart.
 */
export function starteBruecke({ programm, skript, vault, env, protokoll = () => {}, timeoutMs = 20_000, fristMs = 300_000, hartMs = 3000, beendeBaum = (k) => { try { k.kill(); } catch { /* weg */ } } }) {
  let kind = null, naechsteId = 1, beendet = false, endeGemeldet;
  const offen = new Map(); // id → { ok, nein }
  const neustarts = [];
  let bereitOk, bereitNein;
  let bereit = new Promise((ok, nein) => { bereitOk = ok; bereitNein = nein; });
  const ende = new Promise((ok) => { endeGemeldet = ok; });

  function lauf() {
    const k = spawn(programm, [skript, ...(vault ? [vault] : [])], { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    kind = k;
    let istBereit = false, fehlerAusgabe = "";
    const frist = setTimeout(() => { bereitNein(new Error("Die Werkstatt meldet sich nicht")); beendeBaum(k); }, timeoutMs);
    const rl = createInterface({ input: k.stdout, crlfDelay: Infinity });
    rl.on("line", (zeile) => {
      let o; try { o = JSON.parse(zeile); } catch { return; }
      if (o?.bereit === true) { istBereit = true; clearTimeout(frist); bereitOk({ version: o.version, vaultId: o.vaultId }); return; }
      const w = offen.get(o?.id);
      if (!w) return;
      offen.delete(o.id);
      w.ok({ status: o.status, headers: o.headers || {}, body: Buffer.from(typeof o.body === "string" ? o.body : "", "base64") });
    });
    k.stderr.on("data", (d) => { fehlerAusgabe = (fehlerAusgabe + String(d)).slice(-500); protokoll(`werkstatt: ${String(d).trim().slice(0, 500)}`); });
    k.stdin.on("error", () => { /* das Ende kommt über „exit“ */ });
    k.on("error", (e) => { clearTimeout(frist); bereitNein(e); });
    k.on("exit", (code, signal) => {
      clearTimeout(frist);
      if (kind === k) kind = null;
      for (const [id, w] of offen) { offen.delete(id); w.nein(new Error("Die Werkstatt wurde beendet")); }
      if (beendet) return endeGemeldet();
      protokoll(`werkstatt beendet (${code ?? signal})`);
      // Vor dem ersten „bereit“ (kaputter Vault, fehlende Datei, Schutz der Vorschau): kein Neustart, die Hülle meldet den Grund und beendet sich
      if (!istBereit) { bereitNein(new Error(`Die Werkstatt endete vor dem Start (${code ?? signal})${fehlerAusgabe.trim() ? `: ${fehlerAusgabe.trim()}` : ""}`)); return; }
      const jetzt = Date.now();
      while (neustarts.length && jetzt - neustarts[0] > FENSTER_MS) neustarts.shift();
      if (neustarts.length >= MAX_NEUSTARTS) { bereit = Promise.reject(new Error("Die Werkstatt stürzt immer wieder ab")); bereit.catch(() => {}); return; }
      neustarts.push(jetzt);
      bereit = new Promise((ok, nein) => { bereitOk = ok; bereitNein = nein; });
      bereit.catch(() => {}); // wird bei der nächsten Anfrage gemeldet
      lauf();
    });
  }
  bereit.catch(() => {});
  lauf();

  async function anfrage({ methode, pfad, query, body }) {
    if (beendet) throw new Error("Die Werkstatt ist beendet");
    await bereit;
    const k = kind;
    if (!k || !k.stdin.writable) throw new Error("Die Werkstatt ist nicht erreichbar");
    const id = naechsteId++;
    const antwort = new Promise((ok, nein) => {
      const t = setTimeout(() => { offen.delete(id); const e = new Error("Die Werkstatt antwortet nicht innerhalb der Frist"); e.code = "frist"; nein(e); }, fristMs);
      offen.set(id, { ok: (r) => { clearTimeout(t); ok(r); }, nein: (e) => { clearTimeout(t); nein(e); } });
    });
    k.stdin.write(JSON.stringify({ id, methode, pfad, query: query || null, body: body && body.length ? Buffer.from(body).toString("base64") : null }) + "\n");
    return antwort;
  }

  // Ende: stdin zu (die Werkstatt schreibt alle Antworten und beendet sich selbst, auch wartende Abrufe); nach hartMs wird der Prozess beendet, und länger als hartMs + 3 s wartet die Hülle nie
  async function beende() {
    if (beendet) return ende;
    beendet = true;
    const k = kind;
    if (!k) { endeGemeldet(); return ende; }
    try { k.stdin.end(); } catch { /* egal */ }
    const hart = setTimeout(() => beendeBaum(k), hartMs);
    let obergrenze;
    await Promise.race([ende, new Promise((ok) => { obergrenze = setTimeout(ok, hartMs + 3000); })]);
    clearTimeout(hart); clearTimeout(obergrenze);
  }
  return { get bereit() { return bereit; }, anfrage, beende, lebt: () => !!kind && !beendet };
}
