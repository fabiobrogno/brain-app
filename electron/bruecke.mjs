// electron/bruecke.mjs — Brücke zwischen Studiofenster und Werkstatt: dasselbe Zeilenprotokoll wie in der Swift-App (Ressourcen/werkstatt/werkstatt.mjs, Kopfzeile),
// die Werkstatt läuft als KINDPROZESS (Begründung im PR: eigene Node-Laufzeit für `process.execPath`-Kinder, ein hängender Handler friert die Oberfläche nicht ein, derselbe Code wie am Mac,
// kein Port und kein Token — es gibt keinen Netzwerkweg zur Werkstatt). Die Verbindung hier hält nur: starten, Anfragen mit Nummer, Antworten zuordnen, Neustart nach Absturz, sauber beenden.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

// Umgebung des Kindprozesses: ausdrücklich gebaut, nie ein Durchreichen von process.env. Pfad- und Systemvariablen, die Programme (git, claude, codex) zum Starten brauchen,
// dazu unsere eigenen BRAIN_*/KORTEX_*. Nie CLAUDE_CONFIG_DIR, CODEX_HOME, GIT_CONFIG_* oder Tokens. XDG_* nur außerhalb des Testmodus (dort wird alles ins Temp-HOME gelenkt).
const GRUND = ["PATH", "HOME", "USER", "USERNAME", "LOGNAME", "SHELL", "LANG", "TZ", "TMPDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)",
  "SYSTEMROOT", "SystemRoot", "SYSTEMDRIVE", "windir", "ComSpec", "PATHEXT", "HOMEDRIVE", "HOMEPATH", "COMPUTERNAME", "OS", "PROCESSOR_ARCHITECTURE"];
const XDG = ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"];
export function baueKindUmgebung(env = process.env) {
  const aus = {};
  const nimm = (k) => { if (env[k] !== undefined) aus[k] = env[k]; };
  GRUND.forEach(nimm);
  for (const k of Object.keys(env)) if (/^(LC_|BRAIN_|KORTEX_)/.test(k)) nimm(k);
  if (env.BRAIN_TESTMODUS !== "1") XDG.forEach(nimm);
  aus.ELECTRON_RUN_AS_NODE = "1"; // die Electron-Datei läuft als Node (kein Fenster); gemeinsam/basis.mjs#kindUmgebung reicht das an Kinder weiter, die `process.execPath` starten
  return aus;
}

const MAX_NEUSTARTS = 3, FENSTER_MS = 60_000;

/**
 * Startet die Werkstatt. `programm` = Programm, das Node-Skripte ausführt (Electron mit ELECTRON_RUN_AS_NODE, oder ein Node), `skript` = werkstatt.mjs.
 * → { bereit: Promise<{version, vaultId}>, anfrage({methode, pfad, query, body}) → Promise<{status, headers, body}>, beende(): Promise<void>, lebt(): boolean }
 */
export function starteBruecke({ programm, skript, vault, env, protokoll = () => {}, timeoutMs = 20_000 }) {
  let kind = null, naechsteId = 1, beendet = false, endeGemeldet;
  const offen = new Map(); // id → { ok, nein }
  const neustarts = [];
  let bereitOk, bereitNein;
  let bereit = new Promise((ok, nein) => { bereitOk = ok; bereitNein = nein; });
  const ende = new Promise((ok) => { endeGemeldet = ok; });

  function lauf() {
    const k = spawn(programm, [skript, ...(vault ? [vault] : [])], { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    kind = k;
    const frist = setTimeout(() => bereitNein(new Error("Die Werkstatt meldet sich nicht")), timeoutMs);
    const rl = createInterface({ input: k.stdout, crlfDelay: Infinity });
    rl.on("line", (zeile) => {
      let o; try { o = JSON.parse(zeile); } catch { return; }
      if (o?.bereit === true) { clearTimeout(frist); bereitOk({ version: o.version, vaultId: o.vaultId }); return; }
      const w = offen.get(o?.id);
      if (!w) return;
      offen.delete(o.id);
      w.ok({ status: o.status, headers: o.headers || {}, body: Buffer.from(typeof o.body === "string" ? o.body : "", "base64") });
    });
    k.stderr.on("data", (d) => protokoll(`werkstatt: ${String(d).trim().slice(0, 500)}`));
    k.stdin.on("error", () => { /* das Ende kommt über „exit“ */ });
    k.on("error", (e) => { clearTimeout(frist); bereitNein(e); });
    k.on("exit", (code, signal) => {
      clearTimeout(frist);
      if (kind === k) kind = null;
      for (const [id, w] of offen) { offen.delete(id); w.nein(new Error("Die Werkstatt wurde beendet")); }
      if (beendet) return endeGemeldet();
      protokoll(`werkstatt beendet (${code ?? signal})`);
      const jetzt = Date.now();
      while (neustarts.length && jetzt - neustarts[0] > FENSTER_MS) neustarts.shift();
      if (neustarts.length >= MAX_NEUSTARTS) { bereitNein(new Error("Die Werkstatt stürzt immer wieder ab")); return; }
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
    const antwort = new Promise((ok, nein) => offen.set(id, { ok, nein }));
    k.stdin.write(JSON.stringify({ id, methode, pfad, query: query || null, body: body && body.length ? Buffer.from(body).toString("base64") : null }) + "\n");
    return antwort;
  }

  // Ende: stdin zu (die Werkstatt schreibt alle Antworten und beendet sich selbst, auch wartende Abrufe), nach 3 s hart
  async function beende() {
    if (beendet) return ende;
    beendet = true;
    const k = kind;
    if (!k) { endeGemeldet(); return ende; }
    try { k.stdin.end(); } catch { /* egal */ }
    const hart = setTimeout(() => { try { k.kill(); } catch { /* weg */ } }, 3000);
    await ende;
    clearTimeout(hart);
  }
  return { get bereit() { return bereit; }, anfrage, beende, lebt: () => !!kind && !beendet };
}
