// gemeinsam/vertrauen.mjs — Vertrauen v2 (Studio-v2-Spec §8): Nichts aus einem Vault startet ein Programm, bevor der Nutzer
// diesem Vault vertraut hat — weder Kit-Code (.tools) noch Git-Hooks noch Git-Einstellungen, die Programme starten.
// Der Merker liegt außerhalb des Vaults: <support>/vertrauen.json = { "<realpath>": { seit, ordner, code } }.
//   ordner = "dev:ino:birthtimeMs" des Vault-Ordners (gelöscht und neu geklont = neue Frage, auch am selben Pfad)
//   code   = sha256 über den Code unter .tools und die Hook-Dateien, die Git ausführen würde (Änderung = neue Frage)
// Einträge im alten Format (nur „seit“) sind ungültig. Dieselbe Logik nutzen Werkstatt, MCP-Server und die CLI für Swift
// (werkstatt/vertrauen-pruefen.mjs); nichts davon führt Code aus dem Vault aus — nur Dateien lesen und `git config --list`.
import { realpathSync, statSync, lstatSync, readdirSync, readFileSync, readlinkSync, writeFileSync, mkdirSync, renameSync, unlinkSync, existsSync } from "node:fs";
import { join, resolve, dirname, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { HttpFehler, supportOrdner, kindUmgebung, falte } from "./basis.mjs";

// ───────────────────────────── Merker ─────────────────────────────
const merkerDatei = (support) => join(support || supportOrdner(), "vertrauen.json");
function leseMerker(support) {
  try { const j = JSON.parse(readFileSync(merkerDatei(support), "utf8")); return j && typeof j === "object" && !Array.isArray(j) ? j : {}; } catch { return {}; }
}
// Atomar (Temp-Datei + rename), Modus 0600; die Einträge anderer Vaults bleiben erhalten.
function schreibeMerker(support, m) {
  const datei = merkerDatei(support);
  try {
    mkdirSync(dirname(datei), { recursive: true, mode: 0o700 });
    const tmp = `${datei}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    try { writeFileSync(tmp, JSON.stringify(m, null, 2) + "\n", { mode: 0o600, flag: "wx" }); renameSync(tmp, datei); }
    catch (e) { try { unlinkSync(tmp); } catch { /* schon weg */ } throw e; }
  } catch { throw new HttpFehler(500, "Die Freigabe konnte nicht gespeichert werden."); }
}

// ───────────────────────────── Ordner-Kennung ─────────────────────────────
export function ordnerKennung(wurzel) {
  const st = statSync(wurzel);
  return `${st.dev}:${st.ino}:${st.birthtimeMs}`;
}

// ───────────────────────────── Code-Fingerabdruck ─────────────────────────────
const CODE_ENDUNGEN = new Set(["mjs", "js", "cjs", "ts", "sh", "py", "rb", "pl", "bash", "zsh",
  "node", "wasm", "dylib", "so", "mts", "cts", "command"]); // die zweite Reihe ist eine Ergänzung zu §8: lädt Node/ein Programm ebenfalls als Code
const GROSS = 2 * 1024 * 1024; // größere Dateien: Größe + Änderungszeit statt Inhalt (nie einfach auslassen)
const dateiCache = new Map(); // abs → { size, mtimeMs, ino, wert } (sha256 je Datei, nur gültig bei gleicher Größe/Zeit/Inode)

function inhaltsAngabe(abs, st) {
  if (st.size > GROSS) return `gross:${st.mtimeMs}`;
  const c = dateiCache.get(abs);
  if (c && c.size === st.size && c.mtimeMs === st.mtimeMs && c.ino === st.ino) return c.wert;
  let wert;
  try { wert = createHash("sha256").update(readFileSync(abs)).digest("hex"); } catch { wert = "unlesbar"; }
  if (dateiCache.size > 50_000) dateiCache.clear();
  dateiCache.set(abs, { size: st.size, mtimeMs: st.mtimeMs, ino: st.ino, wert });
  return wert;
}

const istCode = (name, st) => {
  const i = name.lastIndexOf(".");
  return (i > 0 && CODE_ENDUNGEN.has(name.slice(i + 1).toLowerCase())) || (st.mode & 0o111) !== 0;
};

// Verweis: Text des Ziels (so steht er im Fingerabdruck) — zusätzlich der Inhalt des Ziels, wenn es eine Datei ist (strenger als §8: ein
// Verweis auf eine Datei außerhalb des Vaults darf nicht nachträglich ausgetauscht werden). Ordner-Verweise werden nie verfolgt.
function verweisAngabe(abs) {
  let text = "?";
  try { text = readlinkSync(abs); } catch { /* unlesbar */ }
  let ziel = "-";
  try { const st = statSync(abs); if (st.isFile()) ziel = `${st.size}:${inhaltsAngabe(abs, st)}`; } catch { /* Verweis ins Leere */ }
  return `link\0${text}\0${ziel}`;
}

// Zeilen „<vorsatz><relativer Pfad>\0<Größe>\0<sha256>“ für alle passenden Dateien unter basis (ohne Verweise auf Ordner zu verfolgen).
function sammleZeilen(basis, vorsatz, { nurCode = false, ohneSample = false, ohneNodeModules = false } = {}) {
  const zeilen = [];
  const geh = (abs, rel, tiefe) => {
    if (tiefe > 40) return;
    let liste;
    try { liste = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const d of liste) {
      if (ohneNodeModules && falte(d.name) === "node_modules") continue;
      const a = join(abs, d.name), r = rel ? `${rel}/${d.name}` : d.name;
      let st;
      try { st = lstatSync(a); } catch { continue; }
      if (st.isSymbolicLink()) { zeilen.push(`${vorsatz}${r}\0${verweisAngabe(a)}`); continue; }
      if (st.isDirectory()) { geh(a, r, tiefe + 1); continue; }
      if (!st.isFile()) continue;
      if (ohneSample && d.name.endsWith(".sample")) continue;
      if (nurCode && !istCode(d.name, st)) continue;
      zeilen.push(`${vorsatz}${r}\0${st.size}\0${inhaltsAngabe(a, st)}`);
    }
  };
  geh(basis, "", 0);
  return zeilen;
}

const fingerabdruck = (zeilen) => createHash("sha256").update("brain-vertrauen-v2\n" + [...zeilen].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join("\n")).digest("hex");

// ───────────────────────────── Git-Konfiguration des Vaults ─────────────────────────────
// Gelesen wird mit Git selbst (`git config --list --show-scope --show-origin --null`): so gibt es keinen Parser-Unterschied zu Git
// (include.path, Anführungszeichen, Escapes). Das startet nichts aus dem Vault; core.fsmonitor/hooksPath sind zusätzlich aus.
const REPO_GEBUNDEN = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR", "GIT_PREFIX", "GIT_NAMESPACE", "GIT_QUARANTINE_PATH"];
const SCOPES = new Set(["system", "global", "local", "worktree", "command"]);
const konfigCache = new Map(); // wurzel → { sig, zeit, wert }
const KONFIG_TTL = 3000;
const sigVon = (p) => { try { const s = statSync(p); return `${s.size}:${s.mtimeMs}:${s.ino}`; } catch { return "-"; } };

// → { vorhanden, lesbar, eintraege: [{ scope, quelle, key, wert }], quellen: [abs] }
//   vorhanden: der Ordner hat ein .git; lesbar: false, wenn Git die Einstellungen nicht ausgeben konnte (dann gilt Git als gesperrt).
export function liesGitKonfiguration(wurzel) {
  const gitEintrag = join(wurzel, ".git");
  if (!existsSync(gitEintrag)) return { vorhanden: false, lesbar: true, eintraege: [], quellen: [] };
  const alt = konfigCache.get(wurzel);
  const dateien = [gitEintrag, join(gitEintrag, "config"), join(gitEintrag, "config.worktree"), ...(alt ? alt.wert.quellen : [])];
  const sig = dateien.map(sigVon).join("|");
  if (alt && alt.sig === sig && Date.now() - alt.zeit < KONFIG_TTL) return alt.wert;
  const env = kindUmgebung({ GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" });
  for (const k of REPO_GEBUNDEN) delete env[k];
  const r = spawnSync("git", ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "protocol.ext.allow=never",
    "config", "--list", "--show-scope", "--show-origin", "--null", "--includes"],
  { cwd: wurzel, env, timeout: 5000, killSignal: "SIGKILL", maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  let wert;
  if (r.error && r.error.code === "ENOENT") wert = { vorhanden: true, lesbar: true, eintraege: [], quellen: [] }; // kein Git installiert: es läuft ohnehin nichts
  else if (r.error || r.status !== 0) wert = { vorhanden: true, lesbar: false, eintraege: [], quellen: [] };
  else {
    const teile = String(r.stdout).split("\0");
    if (teile[teile.length - 1] === "") teile.pop();
    const eintraege = [], quellen = new Set();
    let ok = teile.length % 3 === 0;
    for (let i = 0; ok && i < teile.length; i += 3) {
      const scope = teile[i], herkunft = teile[i + 1], kw = teile[i + 2];
      if (!SCOPES.has(scope) || !/^(file|blob|standard input|command line):?/.test(herkunft)) { ok = false; break; }
      const nl = kw.indexOf("\n");
      const key = nl < 0 ? kw : kw.slice(0, nl), w = nl < 0 ? "" : kw.slice(nl + 1);
      const quelle = herkunft.startsWith("file:") ? resolve(wurzel, herkunft.slice(5)) : null;
      if (quelle) quellen.add(quelle);
      eintraege.push({ scope, quelle, key, wert: w });
    }
    wert = ok ? { vorhanden: true, lesbar: true, eintraege, quellen: [...quellen] } : { vorhanden: true, lesbar: false, eintraege: [], quellen: [] };
  }
  if (konfigCache.size > 100) konfigCache.clear();
  konfigCache.set(wurzel, { sig: [gitEintrag, join(gitEintrag, "config"), join(gitEintrag, "config.worktree"), ...wert.quellen].map(sigVon).join("|"), zeit: Date.now(), wert });
  return wert;
}

// Schlüssel aus der lokalen Konfiguration (auch config.worktree und alles, was per include.path dazukommt), die Git ein Programm starten
// lassen — Liste aus §8; ergänzt um credential.<url>.helper (dasselbe wie credential.helper je Adresse) und remote.*.vcs.
const GEFAEHRLICH = [/^credential(\..+)?\.helper$/, /^core\.askpass$/, /^core\.gitproxy$/, /^core\.alternaterefscommand$/, /^gpg\.program$/, /^gpg\..+\.program$/,
  /^merge\..+\.driver$/, /^filter\..+\.(clean|smudge|process)$/, /^remote\..+\.(uploadpack|receivepack|vcs)$/];
export function gefaehrlicheSchluessel(eintraege) {
  const aus = [];
  for (const e of eintraege) {
    if (e.scope !== "local" && e.scope !== "worktree") continue;
    const k = e.key.toLowerCase();
    if (GEFAEHRLICH.some((re) => re.test(k)) || (/^protocol(\..+)?\.allow$/.test(k) && e.wert.trim().toLowerCase() !== "never")) aus.push(e.key);
  }
  return [...new Set(aus)];
}
const sshEigenGesetzt = (eintraege) => eintraege.some((e) => e.key.toLowerCase() === "core.sshcommand" && e.scope !== "command");

// Verzeichnis, aus dem Git Hooks ausführen würde: core.hooksPath aus der lokalen Konfiguration (relativ = zum Arbeitsordner), sonst <gitdir>/hooks
// (bei „.git“ als Datei: Verweis auf das Git-Verzeichnis, bei Worktrees das gemeinsame).
function hooksVerzeichnis(wurzel, eintraege) {
  let pfad = null;
  for (const e of eintraege) if ((e.scope === "local" || e.scope === "worktree") && e.key.toLowerCase() === "core.hookspath") pfad = e.wert;
  if (pfad !== null && pfad.trim() !== "") {
    if (pfad === "~" || pfad.startsWith("~/")) pfad = join(homedir(), pfad.slice(1));
    return isAbsolute(pfad) ? pfad : resolve(wurzel, pfad);
  }
  let gitDir = join(wurzel, ".git");
  try {
    if (lstatSync(gitDir).isFile()) {
      const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(gitDir, "utf8"));
      if (!m) return null;
      gitDir = resolve(wurzel, m[1].trim());
      try { gitDir = resolve(gitDir, readFileSync(join(gitDir, "commondir"), "utf8").trim()); } catch { /* kein Worktree */ }
    }
  } catch { return null; }
  return join(gitDir, "hooks");
}

// ───────────────────────────── Prüfung ─────────────────────────────
const KURZ = (liste, n = 4) => liste.slice(0, n).join(", ") + (liste.length > n ? " …" : "");

function analysiere(vault, support) {
  let wurzel;
  try { wurzel = realpathSync(vault); if (!statSync(wurzel).isDirectory()) throw 0; } catch { return null; }
  const konfig = liesGitKonfiguration(wurzel);
  const gefaehrlich = gefaehrlicheSchluessel(konfig.eintraege);
  const kitZeilen = sammleZeilen(join(wurzel, ".tools"), "tools:", { nurCode: true, ohneNodeModules: true });
  const hookDir = konfig.vorhanden ? hooksVerzeichnis(wurzel, konfig.eintraege) : null;
  const hookZeilen = hookDir ? sammleZeilen(hookDir, "hooks:", { ohneSample: true }) : [];
  const code = fingerabdruck([...kitZeilen, ...hookZeilen]);
  const ordner = ordnerKennung(wurzel);
  const e = leseMerker(support)[wurzel];
  const erlaubt = !!e && typeof e === "object" && e.ordner === ordner && e.code === code;
  const geaendert = !!e && !erlaubt; // Eintrag da, aber Ordner ersetzt, Code geändert oder altes Format
  const gruende = [];
  if (kitZeilen.length) gruende.push({ art: "kit", text: "Dieser Ordner enthält Programmcode (das Brain-Kit unter „.tools“). Er läuft erst, wenn du diesem Vault vertraust." });
  if (hookZeilen.length) gruende.push({ art: "hooks", text: "Dieser Ordner hat Git-Hooks — Programme, die Git beim Sichern oder Senden ausführt. Sie laufen erst, wenn du diesem Vault vertraust." });
  let gitGrund = null;
  if (gefaehrlich.length) gitGrund = `Die Git-Einstellungen dieses Ordners können Programme starten (${KURZ(gefaehrlich)}). Git bleibt gesperrt, bis du diesem Vault vertraust.`;
  else if (konfig.vorhanden && !konfig.lesbar) gitGrund = "Die Git-Einstellungen dieses Ordners ließen sich nicht lesen. Git bleibt gesperrt, bis du diesem Vault vertraust.";
  if (gitGrund) gruende.push({ art: "git", text: gitGrund });
  return { wurzel, ordner, code, erlaubt, geaendert, gruende, gitGrund, sshEigen: sshEigenGesetzt(konfig.eintraege) };
}

const LEER = { erlaubt: false, noetig: false, geaendert: false, gitGesperrt: false, gruende: [] };

// → { erlaubt, noetig, geaendert, gitGesperrt, gruende:[{art:"kit"|"hooks"|"git", text}] }
//   noetig: es gibt etwas, das Programme starten würde · geaendert: es gab eine Erlaubnis, sie gilt nicht mehr (neuer Ordner, neuer Code, altes Format)
//   gitGesperrt: gefährliche Git-Einstellungen und (noch) kein Vertrauen — Git läuft dann gar nicht.
export function pruefeVertrauen(vault, { support } = {}) {
  const a = analysiere(vault, support);
  if (!a) return { ...LEER, gruende: [] };
  return { erlaubt: a.erlaubt, noetig: a.gruende.length > 0, geaendert: a.geaendert, gitGesperrt: !a.erlaubt && a.gitGrund !== null, gruende: a.gruende };
}

// Für die Git-Aufrufe: vertraut (Hooks und Repo-Konfiguration wie gewohnt), gesperrt (+ grund), sshEigen (core.sshCommand ist irgendwo
// gesetzt — dann setzen wir bei Vertrauen kein eigenes GIT_SSH_COMMAND).
export function gitSicht(vault, { support } = {}) {
  const a = analysiere(vault, support);
  if (!a) return { vertraut: false, gesperrt: false, grund: null, sshEigen: false };
  return { vertraut: a.erlaubt, gesperrt: !a.erlaubt && a.gitGrund !== null, grund: !a.erlaubt ? a.gitGrund : null, sshEigen: a.sshEigen };
}

// Erlaubt genau den heutigen Stand (Ordner + Code). Wirft 400, wenn es den Ordner nicht gibt.
export function erlaube(vault, { support } = {}) {
  const a = analysiere(vault, support);
  if (!a) throw new HttpFehler(400, "Der Vault-Ordner existiert nicht.");
  const m = leseMerker(support);
  m[a.wurzel] = { seit: new Date().toISOString(), ordner: a.ordner, code: a.code };
  schreibeMerker(support, m);
  return pruefeVertrauen(a.wurzel, { support });
}

// Nimmt die Erlaubnis zurück (der Eintrag verschwindet; andere Vaults bleiben).
export function widerrufe(vault, { support } = {}) {
  let wurzel = null;
  try { wurzel = realpathSync(vault); } catch { wurzel = resolve(String(vault)); }
  const m = leseMerker(support);
  if (wurzel in m) { delete m[wurzel]; schreibeMerker(support, m); }
  return pruefeVertrauen(wurzel, { support });
}

// Für Neuanlage, Klonen und Entfernen (vaults.mjs): den Eintrag eines Zielpfads löschen — mit und ohne Auflösung des Pfads.
export function vergissVertrauen(pfad, { support } = {}) {
  const m = leseMerker(support);
  let geaendert = false;
  const kandidaten = new Set([resolve(String(pfad))]);
  try { kandidaten.add(realpathSync(pfad)); } catch { /* Ordner gibt es nicht (mehr) */ }
  for (const k of kandidaten) if (k in m) { delete m[k]; geaendert = true; }
  if (geaendert) schreibeMerker(support, m);
}
