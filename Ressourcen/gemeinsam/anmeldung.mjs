// gemeinsam/anmeldung.mjs — Anmelden bei Claude Code und Codex im Fenster (Paket E3, Plan docs/plaene/einrichtung-und-konten-wie-orca.md 4.4), ohne Terminalfenster.
// Die Logik liegt hier in Node (nicht in Swift), damit eine spätere Electron-Hülle sie unverändert nutzt; die Hülle öffnet nur die Adresse (Aktion `extern`).
//
// Ablauf: das Programm läuft als Kindprozess mit EXPLIZIT gebauter Umgebung (nur das Konto-Verzeichnis des gewählten Kontos, alle anderen Konto-/XDG-/Git-Variablen weg),
// in eigener Prozessgruppe, mit Fristen. Claude: `claude auth login`, `BROWSER` zeigt auf ein winziges Kortex-Skript, das nur die Adresse in eine Datei schreibt (öffnet nichts);
// stdin bleibt offen für einen eingefügten Code. Codex: `codex login --device-auth`, Adresse und Gerätecode stehen in der Ausgabe.
// Fertig erkennt Kortex mit `claude auth status` / `codex login status` — NUR am Exit-Code (die Ausgabe wird nie gelesen: stdio „ignore“).
//
// GRUNDSATZ: Kortex liest aus der Ausgabe ausschließlich die Adresse (https, feste Hosts) und den Gerätecode; nie Token, nie Anmeldedateien, nie den Schlüsselbund.
// Die Ausgabe wird nur in einem kleinen Fenster im Speicher nach diesen zwei Mustern durchsucht, nirgends gespeichert und nie protokolliert (das Protokoll kennt nur feste Ereignisnamen).
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, delimiter, isAbsolute } from "node:path";
import { registriere, beendetGerade } from "./prozess.mjs";
import { beendeBaum, eigeneGruppe } from "./plattform.mjs";

// Fristen (Orca-Werte). Claude: 10 min für die ganze Anmeldung (Zeit zum Kopieren in ein Privatfenster). Codex: 3 min bis Adresse und Code da sind, danach 15 min (Gültigkeit des Gerätecodes).
// `adresse`: so lange wartet Kortex auf die Adresse, bevor es aufgibt und den Weg über das Terminal zeigt (Claude 30 s: die Adresse kommt sofort oder gar nicht; Codex = sein Start).
export const FRISTEN = { claude: { gesamt: 600_000, adresse: 30_000 }, codex: { start: 180_000, geraet: 900_000, adresse: 180_000 }, status: 15_000 };
export const PROGRAMME = ["claude", "codex"];

// Adressen, die Kortex überhaupt weitergibt: https, ohne Zugangsdaten und Port, Host aus der Liste des Programms. (Dieselbe Liste kennt `EinrichtungsOverlay.externErlaubt` in Swift.)
const HOSTS = {
  claude: /^(?:[a-z0-9-]+\.)*(?:claude\.ai|claude\.com|anthropic\.com)$/,
  codex: /^(?:[a-z0-9-]+\.)*(?:openai\.com|chatgpt\.com)$/,
};
export function pruefeAdresse(programm, text) {
  try {
    if (typeof text !== "string" || text.length > 2048 || !HOSTS[programm]) return null;
    const u = new URL(text);
    if (u.protocol !== "https:" || u.username || u.password || u.port || !HOSTS[programm].test(u.hostname.toLowerCase())) return null;
    return u.toString();
  } catch { return null; }
}

// ───────────── Muster in der Ausgabe ─────────────
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;
export const ohneAnsi = (t) => String(t).replace(ANSI, "");
const URL_MUSTER = /https:\/\/[^\s"'<>\u001b]+/g;
// Claude bricht die Adresse in der Ausgabe (Ink, ~80 Spalten) um: ein abgeschnittenes erstes Stück darf nie als Adresse gelten. Darum nimmt Kortex aus der Ausgabe nur eine Adresse,
// die `state` und `code_challenge` enthält; sonst wartet es auf die Datei des BROWSER-Skripts (vollständig) bzw. zeigt den Weg über das Terminal.
const CLAUDE_PFLICHT = ["state", "code_challenge"];
export function findeAdresse(programm, text) {
  for (const m of ohneAnsi(text).matchAll(URL_MUSTER)) {
    const u = pruefeAdresse(programm, m[0].replace(/[.,;:)\]]+$/, ""));
    if (u && (programm !== "claude" || CLAUDE_PFLICHT.every((k) => new URL(u).searchParams.get(k)))) return u;
  }
  return null;
}
// Codex (nach Orcas `parseCodexDeviceAuthPrompt`): die Adresse steht vor „one-time code“, der Code in der Zeile danach; ein Leerzeichen/Zeilenende dahinter beweist, dass er vollständig ist.
const CODE_MARKE = "one-time code";
const CODE_MUSTER = /^\s*([A-Z0-9]{4,}(?:-[A-Z0-9]{4,})+)\s/;
export function findeGeraetecode(text) {
  const klar = ohneAnsi(text);
  const i = klar.toLowerCase().indexOf(CODE_MARKE);
  if (i < 0) return null;
  const danach = klar.slice(i).replace(/^[^\n]*\n/, "");
  if (danach === klar.slice(i)) return null;
  const m = CODE_MUSTER.exec(danach);
  return m ? m[1] : null;
}
// Eingefügter Code für Claude: eine Zeile, nur übliche Zeichen eines Anmelde-Codes.
export const CODE_ERLAUBT = /^[A-Za-z0-9._~#:/+=-]{4,600}$/;

// ───────────── Umgebung des Kindprozesses ─────────────
// Alles, was ein KI-Programm auf ein anderes Konto/einen anderen Ordner lenkt oder einen Schlüssel trägt, kommt nie aus der Umgebung der Werkstatt in das Kind (Muster: KiErkennung.gesperrteVariablen,
// hier gröber: ganze Familien). Das Konto-Verzeichnis (`ordner`) wird danach gezielt gesetzt; `ordner: null` = Standardkonto (Variable bleibt weg, wie beim Pflege-Lauf).
const FREMD = /^(?:XDG_|GIT_|CLAUDE|ANTHROPIC_|CODEX_|OPENAI_|CURSOR_|GEMINI_|GOOGLE_|BROWSER$|NODE_|ELECTRON_|DYLD_|LD_|BRAIN_|KORTEX_|NPM_|SSH_)/i;
export function anmeldeUmgebung(basis, { programm, ordner = null, browser = null, pfadZusatz = [] } = {}) {
  const e = {};
  for (const [k, v] of Object.entries(basis || {})) {
    if (typeof v !== "string" || k.includes("=") || k.includes("\0")) continue;
    if (k === "NODE_EXTRA_CA_CERTS" || !FREMD.test(k)) e[k] = v;
  }
  const teile = [...pfadZusatz, ...String(e.PATH || "").split(delimiter)].filter((p) => p && isAbsolute(p));
  e.PATH = [...new Set(teile)].join(delimiter);
  if (ordner) e[programm === "claude" ? "CLAUDE_CONFIG_DIR" : "CODEX_HOME"] = ordner;
  if (browser) e.BROWSER = browser;
  return e;
}

const shellText = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const ARGUMENTE = {
  claude: { login: ["auth", "login"], status: ["auth", "status"] },
  codex: { login: ["login", "--device-auth"], status: ["login", "status"] },
};

// Startet die Anmeldung. o: { programm, programmPfad, ordner|null, basisUmgebung, fristen, takt, tempWurzel, protokoll, plattform }
// → { zustand(), sendeCode(text), abbrechen(), ende: Promise<zustand> }
// zustand(): { phase: "start"|"wait"|"ok"|"timeout"|"error"|"abgebrochen", url, code, codeMoeglich, verbleibendMs, grund, rueckfall }
//   grund (nur bei error/timeout): "keine-adresse" | "start-fehlgeschlagen" | "programm-fehler" | "nicht-angemeldet" | "abgelaufen"; rueckfall = true → die Oberfläche bietet den Weg über das Terminal an.
export function starteAnmeldung(o) {
  const { programm, programmPfad, ordner = null, basisUmgebung = process.env, tempWurzel = tmpdir(), protokoll = null, plattform = process.platform } = o;
  if (!PROGRAMME.includes(programm)) throw new Error("unbekanntes Programm");
  if (!isAbsolute(String(programmPfad))) throw new Error("Programmpfad muss absolut sein");
  if (beendetGerade()) throw new Error("beendet");
  const F = { ...FRISTEN[programm], ...(o.fristen || {}) };
  const takt = o.takt || 250;
  const log = (ereignis, extra = {}) => { try { protokoll?.({ ereignis, programm, ...extra }); } catch { /* Protokoll ist Beiwerk */ } };

  const start = Date.now();
  let phase = "start", url = null, code = null, grund = null, rueckfall = false, fertig = false;
  let frist = start + (programm === "codex" ? Math.min(F.start, F.adresse) : F.adresse); // bis zur Adresse
  let puffer = "", uhr = null, kind = null, aufgeloest = null;
  const ende = new Promise((r) => { aufgeloest = r; });

  // Das Skript für BROWSER: schreibt nur die erste Adresse an die Datei und beendet sich; öffnet nichts.
  let dir = null, urlDatei = null, browser = null;
  if (programm === "claude") {
    dir = mkdtempSync(join(tempWurzel, "kortex-anmelden-"));
    chmodSync(dir, 0o700);
    urlDatei = join(dir, "adresse.txt");
    if (plattform === "win32") {
      // Windows: Stapeldatei. `set "u=%~1"` und verzögerte Ausdehnung, damit & | ^ in der Adresse nie als Befehl gelten; % im Pfad der Datei wird verdoppelt.
      browser = join(dir, "kortex-browser.cmd");
      writeFileSync(browser, ["@echo off", "setlocal EnableDelayedExpansion", 'set "u=%~1"', `>>"${urlDatei.replaceAll("%", "%%")}" echo(!u!`, "exit /b 0", ""].join("\r\n"));
    } else {
    browser = join(dir, "kortex-browser");
    writeFileSync(browser, `#!/bin/sh\n# Kortex: meldet nur die Adresse zurück, öffnet keinen Browser.\nprintf '%s\\n' "$1" >> ${shellText(urlDatei)}\nexit 0\n`, { mode: 0o700 });
    chmodSync(browser, 0o700);
    }
  }
  const raeumeTemp = () => { if (dir) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* egal */ } dir = null; } };

  const zustand = () => {
    const verbleibend = fertig ? null : Math.max(0, frist - Date.now());
    return { phase, url, code, codeMoeglich: programm === "claude" && phase === "wait", verbleibendMs: verbleibend, grund, rueckfall };
  };
  const schliesse = (neuePhase, g = null, rf = false) => {
    if (fertig) return;
    fertig = true; phase = neuePhase; grund = g; rueckfall = rf;
    clearInterval(uhr);
    beendeBaum(kind);
    raeumeTemp();
    log("ende", { phase, grund });
    aufgeloest(zustand());
  };
  const wartet = () => {
    if (fertig || phase !== "start") return;
    if (programm === "codex" ? !(url && code) : !url) return;
    phase = "wait";
    frist = programm === "claude" ? start + F.gesamt : Date.now() + F.geraet;
    log("wait");
  };
  const lies = (text) => {
    if (fertig) return;
    // Nur ein kleines Fenster der Ausgabe bleibt im Speicher (zum Durchsuchen von Zeilen, die über zwei Stücke gehen)
    puffer = (puffer + text).slice(-16384);
    if (!url) { const u = findeAdresse(programm, puffer); if (u) { url = u; log("adresse"); } }
    if (programm === "codex" && !code) { const c = findeGeraetecode(puffer); if (c) code = c; }
    wartet();
  };
  const leseUrlDatei = () => {
    if (url || !urlDatei) return;
    let t = ""; try { t = readFileSync(urlDatei, "utf8"); } catch { return; }
    for (const z of t.split("\n")) { const u = pruefeAdresse(programm, z.trim()); if (u) { url = u; log("adresse"); wartet(); return; } }
  };

  const env = anmeldeUmgebung(basisUmgebung, { programm, ordner, browser, pfadZusatz: [dirname(programmPfad)] });
  try {
    kind = spawn(programmPfad, ARGUMENTE[programm].login, { env, detached: eigeneGruppe(), windowsHide: true, stdio: [programm === "claude" ? "pipe" : "ignore", "pipe", "pipe"] });
  } catch { raeumeTemp(); fertig = true; phase = "error"; grund = "start-fehlgeschlagen"; rueckfall = true; log("ende", { phase, grund }); aufgeloest(zustand()); return { zustand, sendeCode: () => ({ ok: false }), abbrechen: () => zustand(), ende }; }
  registriere(kind);
  log("start");
  kind.stdout.on("data", (d) => lies(d.toString("utf8")));
  kind.stderr.on("data", (d) => lies(d.toString("utf8")));
  if (kind.stdin) kind.stdin.on("error", () => { /* Programm schon fertig */ });
  kind.once("error", () => schliesse("error", "start-fehlgeschlagen", true));
  kind.once("exit", (exitCode) => {
    if (fertig) return;
    clearInterval(uhr); // sonst meldet der Takt während der Statusprüfung „abgelaufen“, obwohl die Anmeldung gelang
    leseUrlDatei();
    if (exitCode !== 0) { schliesse("error", url ? "programm-fehler" : "keine-adresse", true); return; }
    // Programm sagt „fertig“: ja/nein fragt Kortex das Programm selbst (Exit-Code von `auth status`)
    const statusEnv = { ...env }; delete statusEnv.BROWSER;
    pruefeStatus({ programm, programmPfad, env: statusEnv, frist: F.status }).then((angemeldet) => {
      if (fertig) return;
      if (angemeldet) schliesse("ok"); else schliesse("error", "nicht-angemeldet", false);
    });
  });
  uhr = setInterval(() => {
    if (fertig) return;
    leseUrlDatei();
    if (Date.now() < frist) return;
    if (phase === "start") schliesse("error", "keine-adresse", true); // nie hängen: Adresse kam nicht → Weg über das Terminal
    else schliesse("timeout", "abgelaufen", false);
  }, takt);
  uhr.unref?.();

  return {
    pid: kind.pid,
    zustand,
    ende,
    // Eingefügter Code → stdin des Programms (nur Claude, nur während des Wartens). Der Code wird weder gespeichert noch protokolliert.
    sendeCode(text) {
      if (fertig || phase !== "wait" || programm !== "claude" || !kind?.stdin || kind.stdin.destroyed) return { ok: false, grund: "nicht-moeglich" };
      const t = String(text ?? "").trim();
      if (!CODE_ERLAUBT.test(t)) return { ok: false, grund: "ungueltig" };
      try { kind.stdin.write(t + "\n"); } catch { return { ok: false, grund: "nicht-moeglich" }; }
      log("code-gesendet");
      return { ok: true };
    },
    abbrechen() { schliesse("abgebrochen"); return zustand(); },
  };
}

// `<programm> auth status` bzw. `login status`: nur der Exit-Code zählt (0 = angemeldet). Die Ausgabe geht ins Leere (stdio „ignore“): Kortex kann sie gar nicht lesen.
export function pruefeStatus({ programm, programmPfad, env, frist = FRISTEN.status }) {
  return new Promise((ok) => {
    let kind, fertig = false, t;
    const ende = (v) => { if (fertig) return; fertig = true; clearTimeout(t); ok(v); };
    try { kind = spawn(programmPfad, ARGUMENTE[programm].status, { env, detached: eigeneGruppe(), windowsHide: true, stdio: "ignore" }); } catch { return ende(false); }
    registriere(kind);
    t = setTimeout(() => { beendeBaum(kind); ende(false); }, frist);
    kind.once("error", () => ende(false));
    kind.once("exit", (c) => ende(c === 0));
  });
}
