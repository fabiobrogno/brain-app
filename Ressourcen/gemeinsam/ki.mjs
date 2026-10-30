// gemeinsam/ki.mjs — Erkennung installierter KI-Programme (v2-Spec §2 „KI verbinden“): wo liegt `claude`, `codex` …, und welche Version?
// Gleiche Suche wie findeClaude in werkstatt/handler.mjs (PATH + übliche Orte, eine GUI-App hat nur einen knappen PATH).
// Keine Abhängigkeiten außer basis.mjs. Es wird nur `<programm> --version` gestartet (ohne Shell), nie etwas anderes.
import { accessSync, constants, statSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, delimiter, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { kindUmgebung, vorschauOrdner } from "./basis.mjs";

// Feste Reihenfolge und Anzeigenamen; der Programmname ist die id.
const AGENTEN = [
  { id: "claude", name: "Claude Code" },
  { id: "codex", name: "Codex" },
  { id: "gemini", name: "Gemini CLI" },
  { id: "cursor-agent", name: "Cursor Agent" },
  { id: "opencode", name: "OpenCode" },
];

const NAME_OK = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// Numerisch absteigend: v22.1.0 vor v20.11.0 vor v9.0.0 (neueste Version zuerst).
function versionAbsteigend(a, b) {
  const z = (s) => String(s).replace(/^v/i, "").split(".").map((t) => Number.parseInt(t, 10) || 0);
  const [x, y] = [z(a), z(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (y[i] || 0) - (x[i] || 0); if (d) return d; }
  return String(b).localeCompare(String(a));
}

// Zusatzorte neben PATH. BRAIN_CLAUDE_EXTRA (Doppelpunkt-Liste, auch leer) ersetzt sie — NUR im Testmodus (BRAIN_TESTMODUS=1),
// sonst ließe sich die Suche von außen umlenken. home wird bei jedem Aufruf frisch gelesen.
function zusatzOrte(env) {
  if (env.BRAIN_TESTMODUS === "1" && env.BRAIN_CLAUDE_EXTRA !== undefined) return env.BRAIN_CLAUDE_EXTRA.split(delimiter).filter(Boolean);
  const home = homedir();
  // Vorschau: ein frisch installierter Mac — die Programme dieses Rechners (Homebrew, /usr/local) gehören nicht dazu.
  const system = vorschauOrdner() ? [] : ["/opt/homebrew/bin", "/usr/local/bin"];
  const orte = [join(home, ".local", "bin"), join(home, ".claude", "local"), ...system, join(home, ".opencode", "bin"),
    join(home, ".cursor", "bin"), join(home, ".bun", "bin"), join(home, ".npm-global", "bin"), join(home, ".volta", "bin"), join(home, ".cargo", "bin")];
  try {
    const nvm = join(home, ".nvm", "versions", "node");
    for (const v of readdirSync(nvm).sort(versionAbsteigend)) orte.push(join(nvm, v, "bin"));
  } catch { /* kein nvm */ }
  return orte;
}

// Absoluter Pfad der ausführbaren Datei `name` (nie ein Ordner) oder null. Relative PATH-Einträge zählen nicht (sie hingen vom Arbeitsordner ab).
export function findeProgramm(name, env = process.env) {
  if (typeof name !== "string" || !NAME_OK.test(name)) return null;
  const orte = [...(env.PATH || "").split(delimiter).filter(Boolean), ...zusatzOrte(env)];
  for (const d of new Set(orte)) {
    if (!isAbsolute(d)) continue;
    const p = join(d, name);
    try { accessSync(p, constants.X_OK); if (statSync(p).isFile()) return p; } catch { /* weiter */ }
  }
  return null;
}

// Versionsnummer aus der Ausgabe von `--version`: erste nicht leere Zeile von stdout (sonst stderr); keine erkennbare Nummer → die Zeile, gekürzt.
const VERSION = /\d+\.\d+(?:\.\d+)?(?:[-+.][\w.]+)?/;
export function versionAus(stdout, stderr) {
  const zeile = (s) => String(s || "").split(/\r?\n/).map((t) => t.trim()).find(Boolean) || "";
  const z = zeile(stdout) || zeile(stderr);
  if (!z) return null;
  const m = VERSION.exec(z);
  return m ? m[0] : z.slice(0, 60);
}

// `<pfad> --version`: keine Shell, Argumente als Liste (wie execFile); Zeitlimit hart (SIGKILL), stdin sofort zu, nie ein Fehler nach außen (→ null).
// Bewusst spawn statt execFile: nur spawn reicht `detached` durch. Das Programm läuft dadurch in einer eigenen Prozessgruppe, und bei Fehler oder
// Zeitlimit wird die ganze Gruppe beendet — sonst bliebe ein Kindprozess (z. B. unter einem Startskript) übrig und hielte die Kanäle offen.
function versionLesen(pfad, env, limit) {
  return new Promise((fertig) => {
    let erledigt = false, uhr = null, kind = null, aus = "", fehl = "";
    const gruppeBeenden = () => {
      try { process.kill(-kind.pid, "SIGKILL"); } catch { try { kind.kill("SIGKILL"); } catch { /* schon weg */ } }
    };
    const ende = (v) => { if (erledigt) return; erledigt = true; clearTimeout(uhr); fertig(v); };
    const schluss = (v) => { if (v === null) gruppeBeenden(); ende(v); };
    try {
      // Der Ordner des Programms kommt in den PATH: Node-Skripte (`#!/usr/bin/env node`) finden so das danebenliegende node auch mit knappem GUI-PATH.
      const umgebung = kindUmgebung({ PATH: [dirname(pfad), env.PATH || ""].filter(Boolean).join(delimiter), NO_COLOR: "1", CI: "1" });
      kind = spawn(pfad, ["--version"], { env: umgebung, detached: true, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      kind.stdout.setEncoding("utf8"); kind.stderr.setEncoding("utf8");
      kind.stdout.on("data", (d) => { if (aus.length < 65536) aus += d; });
      kind.stderr.on("data", (d) => { if (fehl.length < 65536) fehl += d; });
      kind.stdout.on("error", () => { /* Kanal zu: egal */ }); kind.stderr.on("error", () => { /* Kanal zu: egal */ });
      kind.stdin.on("error", () => { /* Programm liest nichts: egal */ });
      kind.on("error", () => schluss(null)); // z. B. unmöglicher Interpreter (ENOENT) oder keine Berechtigung
      kind.on("close", (code) => schluss(code === 0 ? versionAus(aus, fehl) : null));
      kind.stdin.end();
      uhr = setTimeout(() => { // Zeitlimit: Gruppe beenden, Kanäle freigeben, nicht länger warten
        try { kind.stdout.destroy(); kind.stderr.destroy(); } catch { /* weg */ }
        schluss(null);
      }, limit);
    } catch { schluss(null); }
  });
}

async function pruefeAgent(a, env, limit) {
  try {
    const pfad = findeProgramm(a.id, env);
    if (!pfad) return { id: a.id, name: a.name, version: null, pfad: null };
    return { id: a.id, name: a.name, version: await versionLesen(pfad, env, limit), pfad };
  } catch { return { id: a.id, name: a.name, version: null, pfad: null }; }
}

// Zwischenspeicher im Prozess: 10 Minuten, je Suchumgebung (PATH, Testschalter, home). Gespeichert wird das Versprechen — gleichzeitige Aufrufe teilen sich einen Lauf.
const CACHE_ZEIT = 10 * 60_000;
const cache = new Map();
const schluessel = (env) => JSON.stringify([env.PATH || "", env.BRAIN_CLAUDE_EXTRA ?? null, env.BRAIN_TESTMODUS === "1", homedir()]);

// Cursor ist auch ohne `cursor-agent` verbindbar, wenn die App oder ihr Konfigurationsordner da ist. Immer frisch geprüft (zwei stat-Aufrufe), nicht im Zwischenspeicher.
// home und appOrdner sind nur für Tests austauschbar.
export function cursorVorhanden(home, appOrdner) {
  // Vorschau: nur das Vorschau-Home zählt — die Apps dieses Rechners gehören nicht zu einem frisch installierten Mac.
  const apps = vorschauOrdner() ? [] : [join(appOrdner, "Cursor.app")];
  try { return existsSync(join(home, ".cursor")) || apps.some((a) => existsSync(a)) || existsSync(join(home, "Applications", "Cursor.app")); } catch { return false; }
}

// → { agenten:[{ id, name, version|null, pfad|null }], cursorDa } in fester Reihenfolge; neu:true umgeht und überschreibt den Zwischenspeicher.
export async function erkenneAgenten({ env = process.env, neu = false, limit = 5000, home = homedir(), appOrdner = "/Applications" } = {}) {
  const jetzt = Date.now();
  const key = schluessel(env);
  let eintrag = cache.get(key);
  if (neu || !eintrag || jetzt - eintrag.zeit > CACHE_ZEIT) {
    for (const [k, e] of cache) if (jetzt - e.zeit > CACHE_ZEIT) cache.delete(k); // Altes verwerfen
    if (cache.size >= 20) cache.delete(cache.keys().next().value);
    eintrag = { zeit: jetzt, ergebnis: Promise.all(AGENTEN.map((a) => pruefeAgent(a, env, limit))) };
    cache.set(key, eintrag);
  }
  const agenten = await eintrag.ergebnis;
  return { agenten: agenten.map((a) => ({ ...a })), cursorDa: cursorVorhanden(home, appOrdner) }; // Kopie: Aufrufer können den Zwischenspeicher nicht verändern
}
