// gemeinsam/vertrauen.mjs — Vertrauen v2 (Studio-v2-Spec §8): Nichts aus einem Vault startet ein Programm, bevor der Nutzer
// diesem Vault vertraut hat — weder Kit-Code (.tools) noch Git-Hooks noch Git-Einstellungen, die Programme starten.
// Der Merker liegt außerhalb des Vaults: <support>/vertrauen.json = { "<realpath>": { seit, ordner, code } }.
//   ordner = "dev:ino:birthtimeMs" des Vault-Ordners (gelöscht und neu geklont = neue Frage, auch am selben Pfad)
//   code   = sha256 über alles, was Programme starten oder laden kann (Änderung = neue Frage): Code unter .tools samt package.json,
//            node_modules (Metadaten) und den Zielen von Ordner-Verweisen, die Hook-Dateien, brain.config.json, package.json der
//            Vault-Wurzel und die Werte der Git-Schlüssel, die Programme starten (lokal, auch über include.path)
// Der Schlüssel ist der kanonische Pfad (realpath.native: Groß/klein und Unicode-Form wie auf der Platte); gelesen und gelöscht wird
// ohne Groß/klein und Unicode-Form — der Ordner selbst ist durch „ordner“ gebunden.
// Einträge im alten Format (nur „seit“) sind ungültig. Dieselbe Logik nutzen Werkstatt, MCP-Server und die CLI für Swift
// (werkstatt/vertrauen-pruefen.mjs); nichts davon führt Code aus dem Vault aus — nur Dateien lesen und `git config --list`.
import { realpathSync, statSync, lstatSync, readdirSync, readFileSync, readlinkSync, writeFileSync, mkdirSync, renameSync, unlinkSync, existsSync } from "node:fs";
import { join, resolve, dirname, isAbsolute } from "node:path";
import { homedir, tmpdir } from "node:os";
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { HttpFehler, supportOrdner, kindUmgebung, falte, absoluterGitPfad } from "./basis.mjs";
import { sicherungFuer } from "./sicherung.mjs";

// ───────────────────────────── Merker ─────────────────────────────
const merkerDatei = (support) => join(support || supportOrdner(), "vertrauen.json");
const alsObjekt = (text) => { try { const j = JSON.parse(text); return j && typeof j === "object" && !Array.isArray(j) ? j : null; } catch { return null; } };
function leseMerker(support) {
  try { return alsObjekt(readFileSync(merkerDatei(support), "utf8")) ?? {}; } catch { return {}; }
}

// Inhaltlich kaputt (leer, „[]“, kein JSON): Der Merker gilt als „nichts freigegeben“ (neue Frage). Damit nichts still verloren geht, wird die
// Datei vor dem Überschreiben nach vertrauen.json.defekt-<JJJJMMTT-HHMMSS> gesichert (beiseite gelegt, nie überschrieben; die 5 neuesten bleiben).
// Eine leere Datei hat nichts zu bewahren. Lesefehler (Rechte, Ordner statt Datei) sichern nichts. → true, wenn gesichert wurde.
const MERKER_SICHERUNG = sicherungFuer("vertrauen.json");
export function sichereDefektenMerker(support, { jetzt } = {}) {
  const datei = merkerDatei(support);
  let text;
  try { text = readFileSync(datei, "utf8"); } catch { return false; }
  if (!text.trim() || alsObjekt(text) !== null) return false;
  try { MERKER_SICHERUNG.sichere(dirname(datei), datei, { jetzt, verschieben: true }); return true; }
  catch (e) { if (e && e.code === "ENOENT") return false; /* ein anderer Prozess war schneller */ throw e; }
}

// Atomar (Temp-Datei + rename), Modus 0600; die Einträge anderer Vaults bleiben erhalten.
function schreibeMerker(support, m) {
  const datei = merkerDatei(support);
  try {
    mkdirSync(dirname(datei), { recursive: true, mode: 0o700 });
    sichereDefektenMerker(support);
    const tmp = `${datei}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    try { writeFileSync(tmp, JSON.stringify(m, null, 2) + "\n", { mode: 0o600, flag: "wx" }); renameSync(tmp, datei); }
    catch (e) { try { unlinkSync(tmp); } catch { /* schon weg */ } throw e; }
  } catch { throw new HttpFehler(500, "Die Freigabe konnte nicht gespeichert werden."); }
}

// Der kanonische Pfad des Ordners (Schreibweise wie auf der Platte). Auf einem case-insensitiven APFS liefert realpathSync (die JS-Fassung)
// die Schreibweise der Eingabe zurück, realpathSync.native die gespeicherte — nur so wird aus „…/MeinBrain“ und „…/meinbrain“ derselbe Schlüssel.
const echterPfad = (p) => realpathSync.native(p);
// Alle Schreibweisen, unter denen ein Eintrag für diesen Pfad stehen kann (ohne Groß/klein und Unicode-Form verglichen).
function kandidaten(pfad) {
  const k = new Set([resolve(String(pfad))]);
  for (const f of [realpathSync, realpathSync.native]) { try { k.add(f(pfad)); } catch { /* Ordner gibt es nicht (mehr) */ } }
  return [...k];
}
const gleicherOrt = (a, b) => falte(a) === falte(b);
const schluesselFuer = (m, wurzel) => (Object.hasOwn(m, wurzel) ? wurzel : Object.keys(m).find((k) => gleicherOrt(k, wurzel)) ?? null);

// ───────────────────────────── Ordner-Kennung ─────────────────────────────
export function ordnerKennung(wurzel) {
  const st = statSync(wurzel);
  return `${st.dev}:${st.ino}:${st.birthtimeMs}`;
}

// ───────────────────────────── Code-Fingerabdruck ─────────────────────────────
const CODE_ENDUNGEN = new Set(["mjs", "js", "cjs", "ts", "sh", "py", "rb", "pl", "bash", "zsh",
  "node", "wasm", "dylib", "so", "mts", "cts", "command"]); // die zweite Reihe ist eine Ergänzung zu §8: lädt Node/ein Programm ebenfalls als Code
const GROSS = 2 * 1024 * 1024; // größere Dateien: Größe + Änderungszeit statt Inhalt (nie einfach auslassen)
const MAX_EINTRAEGE = 50_000;  // je Durchlauf (Schutz vor Verweisen auf riesige Ordner); danach eine feste Marke, nie ein stilles Abschneiden
const dateiCache = new Map(); // abs → { size, mtimeMs, ino, wert } (sha256 je Datei, nur gültig bei gleicher Größe/Zeit/Inode)
const sha = (daten) => createHash("sha256").update(daten).digest("hex");

function inhaltsAngabe(abs, st) {
  if (st.size > GROSS) return `gross:${st.mtimeMs}`;
  const c = dateiCache.get(abs);
  if (c && c.size === st.size && c.mtimeMs === st.mtimeMs && c.ino === st.ino) return c.wert;
  let wert;
  try { wert = sha(readFileSync(abs)); } catch { wert = "unlesbar"; }
  if (dateiCache.size > 50_000) dateiCache.clear();
  dateiCache.set(abs, { size: st.size, mtimeMs: st.mtimeMs, ino: st.ino, wert });
  return wert;
}

const istCode = (name, st) => {
  const i = name.lastIndexOf(".");
  return (i > 0 && CODE_ENDUNGEN.has(name.slice(i + 1).toLowerCase())) || (st.mode & 0o111) !== 0;
};

// Verweis: Text des Ziels (so steht er im Fingerabdruck) — zusätzlich der Inhalt des Ziels, wenn es eine Datei ist (strenger als §8: ein
// Verweis auf eine Datei außerhalb des Vaults darf nicht nachträglich ausgetauscht werden; unter node_modules nur Größe und Änderungszeit).
// Ein Ziel, das ein Ordner ist, wird in sammleZeilen verfolgt (sein Inhalt steht dort Zeile für Zeile im Fingerabdruck).
function verweisAngabe(abs, nurMeta) {
  let text = "?";
  try { text = readlinkSync(abs); } catch { /* unlesbar */ }
  let ziel = "-";
  try {
    const st = statSync(abs);
    if (st.isFile()) ziel = nurMeta ? `meta:${st.size}:${st.mtimeMs}` : `${st.size}:${inhaltsAngabe(abs, st)}`;
    else if (st.isDirectory()) ziel = "ordner";
  } catch { /* Verweis ins Leere */ }
  return `link\0${text}\0${ziel}`;
}

// Zeilen „<vorsatz><relativer Pfad>\0<Größe>\0<sha256>“ für alle passenden Dateien unter basis. → { zeilen, bedeutend }
//   bedeutend: Zahl der Zeilen, die Programme sind oder sein können (Code, Verweise, Hooks) — ohne package.json und node_modules-Metadaten.
// Was Node oder ein Programm laden kann, steht drin:
//  · package.json (überall, auch unter node_modules): sie steuert type/main/exports/imports, also WELCHER Code geladen wird — mit Inhalt.
//  · Alles unter einem Ordner „node_modules“: Pfad, Größe und Änderungszeit (nicht der Inhalt: die Ordner sind groß; ein Kit aus fremder Hand
//    gehört nicht mit node_modules ausgeliefert). Eine neue oder geänderte Datei dort ändert den Fingerabdruck.
//  · Verweise auf Ordner werden verfolgt: das Ziel zählt mit seinem Inhalt (auch außerhalb des Vaults; Kreise und doppelte Ziele einmal).
// Die Reihenfolge ist fest (nach Namen), damit auch die Marke bei zu vielen Einträgen immer dieselbe ist.
function sammleZeilen(basis, vorsatz, { nurCode = false, ohneSample = false } = {}) {
  const zeilen = [];
  let bedeutend = 0, zaehler = 0, voll = false;
  const besucht = new Set();
  try { besucht.add(echterPfad(basis)); } catch { /* Ordner gibt es nicht → unten nichts zu lesen */ }
  const geh = (abs, rel, tiefe, inModules) => {
    if (tiefe > 40 || voll) return;
    let liste;
    try { liste = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    liste.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const d of liste) {
      if (voll) return;
      if (++zaehler > MAX_EINTRAEGE) { voll = true; zeilen.push(`${vorsatz}!zu-viele-eintraege`); return; }
      const a = join(abs, d.name), r = rel ? `${rel}/${d.name}` : d.name;
      const imModules = inModules || falte(d.name) === "node_modules";
      let st;
      try { st = lstatSync(a); } catch { continue; }
      if (st.isSymbolicLink()) {
        zeilen.push(`${vorsatz}${r}\0${verweisAngabe(a, imModules)}`); bedeutend++;
        let ziel;
        try { ziel = statSync(a); } catch { continue; } // ins Leere: steht mit „-“ schon drin
        if (!ziel.isDirectory()) continue;
        let echt;
        try { echt = echterPfad(a); } catch { continue; }
        if (!besucht.has(echt)) { besucht.add(echt); geh(a, r, tiefe + 1, imModules); }
        continue;
      }
      if (st.isDirectory()) { geh(a, r, tiefe + 1, imModules); continue; }
      if (!st.isFile()) continue;
      if (ohneSample && d.name.endsWith(".sample")) continue;
      if (falte(d.name) === "package.json") { zeilen.push(`${vorsatz}${r}\0${st.size}\0${inhaltsAngabe(a, st)}`); continue; }
      if (imModules) { zeilen.push(`${vorsatz}${r}\0meta\0${st.size}\0${st.mtimeMs}`); continue; }
      if (nurCode && !istCode(d.name, st)) continue;
      zeilen.push(`${vorsatz}${r}\0${st.size}\0${inhaltsAngabe(a, st)}`); bedeutend++;
    }
  };
  geh(basis, "", 0, false);
  return { zeilen, bedeutend };
}

// Einzelne Datei in der Vault-Wurzel: null = gibt es nicht (kein Eintrag im Fingerabdruck), sonst Größe + Inhalt.
function dateiAngabe(abs) {
  let st;
  try { st = statSync(abs); } catch { return null; }
  return st.isFile() ? `${st.size}:${inhaltsAngabe(abs, st)}` : "keine-datei";
}
const kanonisch = (v) => JSON.stringify(v, (_, w) => (w && typeof w === "object" && !Array.isArray(w) ? Object.fromEntries(Object.keys(w).sort().map((k) => [k, w[k]])) : w));
// brain.config.json: das Kit liest dort Programmangaben (z. B. werkzeuge.git) — und startet sie, auch von Swifts `brain status`. Gezählt wird der
// Inhalt als JSON (Schlüssel sortiert, Formatierung egal), OHNE den Teilbaum „automatik“: den schreibt die Steuerzentrale des Kits im Alltag
// (schemageprüfte Einstellungen wie Schalter, Stufen und Zahlen, keine Programmangaben) — sonst fragte jeder Klick dort neu nach dem Vertrauen.
function configAngabe(abs) {
  let st;
  try { st = statSync(abs); } catch { return null; }
  if (!st.isFile()) return "keine-datei";
  if (st.size > GROSS) return `gross:${st.size}:${st.mtimeMs}`;
  let roh;
  try { roh = readFileSync(abs); } catch { return "unlesbar"; }
  let j;
  try { j = JSON.parse(roh.toString("utf8")); } catch { return `roh:${sha(roh)}`; } // kein JSON: Byte für Byte
  if (j && typeof j === "object" && !Array.isArray(j)) delete j.automatik;
  return `json:${sha(kanonisch(j))}`;
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

// `git config --list …` in cwd → { vorhanden: true, lesbar, eintraege: [{ scope, quelle, key, wert }], quellen: [abs] }.
// Git steht nur über den absoluten Pfad (nie ein `git` aus dem Vault); fehlt Git, läuft ohnehin nichts (lesbar: true, nichts darin).
function fuehreKonfigurationAus(cwd) {
  const git = absoluterGitPfad();
  if (!git) return { vorhanden: true, lesbar: true, eintraege: [], quellen: [] };
  const env = kindUmgebung({ GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" });
  for (const k of REPO_GEBUNDEN) delete env[k];
  const r = spawnSync(git, ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "protocol.ext.allow=never",
    "config", "--list", "--show-scope", "--show-origin", "--null", "--includes"],
  { cwd, env, timeout: 5000, killSignal: "SIGKILL", maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  if (r.error && r.error.code === "ENOENT") return { vorhanden: true, lesbar: true, eintraege: [], quellen: [] };
  if (r.error || r.status !== 0) return { vorhanden: true, lesbar: false, eintraege: [], quellen: [] };
  const teile = String(r.stdout).split("\0");
  if (teile[teile.length - 1] === "") teile.pop();
  const eintraege = [], quellen = new Set();
  let ok = teile.length % 3 === 0;
  for (let i = 0; ok && i < teile.length; i += 3) {
    const scope = teile[i], herkunft = teile[i + 1], kw = teile[i + 2];
    if (!SCOPES.has(scope) || !/^(file|blob|standard input|command line):?/.test(herkunft)) { ok = false; break; }
    const nl = kw.indexOf("\n");
    const key = nl < 0 ? kw : kw.slice(0, nl), w = nl < 0 ? "" : kw.slice(nl + 1);
    const quelle = herkunft.startsWith("file:") ? resolve(cwd, herkunft.slice(5)) : null;
    if (quelle) quellen.add(quelle);
    eintraege.push({ scope, quelle, key, wert: w });
  }
  return ok ? { vorhanden: true, lesbar: true, eintraege, quellen: [...quellen] } : { vorhanden: true, lesbar: false, eintraege: [], quellen: [] };
}

// → { vorhanden, lesbar, eintraege: [{ scope, quelle, key, wert }], quellen: [abs] }
//   vorhanden: der Ordner hat ein .git; lesbar: false, wenn Git die Einstellungen nicht ausgeben konnte (dann gilt Git als gesperrt).
//   frisch: den kurzen Zwischenspeicher übergehen (nach einem Abgleich, der Dateien ausgetauscht haben kann).
export function liesGitKonfiguration(wurzel, { frisch = false } = {}) {
  const gitEintrag = join(wurzel, ".git");
  if (!existsSync(gitEintrag)) return { vorhanden: false, lesbar: true, eintraege: [], quellen: [] };
  const alt = konfigCache.get(wurzel);
  const dateien = [gitEintrag, join(gitEintrag, "config"), join(gitEintrag, "config.worktree"), ...(alt ? alt.wert.quellen : [])];
  const sig = dateien.map(sigVon).join("|");
  if (!frisch && alt && alt.sig === sig && Date.now() - alt.zeit < KONFIG_TTL) return alt.wert;
  const wert = fuehreKonfigurationAus(wurzel);
  if (konfigCache.size > 100) konfigCache.clear();
  konfigCache.set(wurzel, { sig: [gitEintrag, join(gitEintrag, "config"), join(gitEintrag, "config.worktree"), ...wert.quellen].map(sigVon).join("|"), zeit: Date.now(), wert });
  return wert;
}

// Schlüssel aus der lokalen Konfiguration (auch config.worktree und alles, was per include.path dazukommt), die Git ein Programm starten
// lassen — Liste aus §8; ergänzt um credential.<url>.helper (dasselbe wie credential.helper je Adresse), remote.*.vcs und die Programm-
// schlüssel der Signierung (gpg.program, gpg.<Format>.program, gpg.ssh.defaultKeyCommand und alles unter gpg.ssh., das auf program/command endet).
const GEFAEHRLICH = [/^credential(\..+)?\.helper$/, /^core\.askpass$/, /^core\.gitproxy$/, /^core\.alternaterefscommand$/, /^gpg\.program$/, /^gpg\..+\.program$/,
  /^gpg\.ssh\..*(program|command)$/, /^merge\..+\.driver$/, /^filter\..+\.(clean|smudge|process)$/, /^remote\..+\.(uploadpack|receivepack|vcs)$/];
const lokal = (e) => e.scope === "local" || e.scope === "worktree";
export function gefaehrlicheSchluessel(eintraege) {
  const aus = [];
  for (const e of eintraege) {
    if (!lokal(e)) continue;
    const k = e.key.toLowerCase();
    if (GEFAEHRLICH.some((re) => re.test(k)) || (/^protocol(\..+)?\.allow$/.test(k) && e.wert.trim().toLowerCase() !== "never")) aus.push(e.key);
  }
  return [...new Set(aus)];
}
// Was an der Git-Konfiguration zum Fingerabdruck gehört: die gefährlichen Schlüssel (mit Wert, auch protocol.*.allow = never) und die zwei,
// die wir mit Vertrauen nicht mehr entschärfen — core.sshCommand (lokal) und core.hooksPath. Ändert sich einer, gilt die Freigabe nicht mehr.
function gitZeilen(eintraege) {
  const z = [];
  for (const e of eintraege) {
    if (!lokal(e)) continue;
    const k = e.key.toLowerCase();
    if (GEFAEHRLICH.some((re) => re.test(k)) || /^protocol(\..+)?\.allow$/.test(k) || k === "core.sshcommand" || k === "core.hookspath") z.push(`git:${k}\0${e.wert}`);
  }
  return z;
}
const sshEigenGesetzt = (eintraege) => eintraege.some((e) => e.key.toLowerCase() === "core.sshcommand" && e.scope !== "command");

// Was der Nutzer selbst eingestellt hat (System und global, nie lokal): core.sshCommand und die Signierwünsche. Ohne Vertrauen ersetzen wir
// nur die Einstellungen des Vaults, nie die des Nutzers: GIT_SSH_COMMAND bekommt seinen Wert (sonst unser BatchMode-Befehl), und commit/tag/
// push.gpgSign bekommen seinen Wert (sonst „false“).
const nutzerWert = (eintraege, key) => { let w = null; for (const e of eintraege) if ((e.scope === "system" || e.scope === "global") && e.key.toLowerCase() === key) w = e.wert; return w; };
function nutzerEinstellungen(eintraege) {
  const gpg = {};
  for (const art of ["commit", "tag", "push"]) { const w = nutzerWert(eintraege, `${art}.gpgsign`); if (w !== null) gpg[art] = w; }
  return { sshGlobal: nutzerWert(eintraege, "core.sshcommand") || null, gpgGlobal: gpg };
}
// Für Git-Aufrufe, die noch zu keinem Vault gehören (Klonen): → { sshGlobal, gpgGlobal } aus System und global (Git läuft in einem neutralen Ordner).
export function nutzerGitEinstellungen() {
  const k = fuehreKonfigurationAus(tmpdir());
  return k.lesbar ? nutzerEinstellungen(k.eintraege) : { sshGlobal: null, gpgGlobal: {} };
}

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

function analysiere(vault, support, { frisch = false } = {}) {
  let wurzel;
  try { wurzel = echterPfad(vault); if (!statSync(wurzel).isDirectory()) throw 0; } catch { return null; }
  const konfig = liesGitKonfiguration(wurzel, { frisch });
  const gefaehrlich = gefaehrlicheSchluessel(konfig.eintraege);
  const kit = sammleZeilen(join(wurzel, ".tools"), "tools:", { nurCode: true });
  const hookDir = konfig.vorhanden ? hooksVerzeichnis(wurzel, konfig.eintraege) : null;
  const hooks = hookDir ? sammleZeilen(hookDir, "hooks:", { ohneSample: true }) : { zeilen: [], bedeutend: 0 };
  const wurzelZeilen = [];
  const cfg = configAngabe(join(wurzel, "brain.config.json")), pkg = dateiAngabe(join(wurzel, "package.json"));
  if (cfg !== null) wurzelZeilen.push(`config:brain.config.json\0${cfg}`);
  if (pkg !== null) wurzelZeilen.push(`wurzel:package.json\0${pkg}`);
  const code = fingerabdruck([...kit.zeilen, ...hooks.zeilen, ...wurzelZeilen, ...gitZeilen(konfig.eintraege)]);
  const ordner = ordnerKennung(wurzel);
  const m = leseMerker(support);
  const schluessel = schluesselFuer(m, wurzel);
  const e = schluessel === null ? undefined : m[schluessel];
  const erlaubt = !!e && typeof e === "object" && e.ordner === ordner && e.code === code;
  const geaendert = !!e && !erlaubt; // Eintrag da, aber Ordner ersetzt, Code geändert oder altes Format
  const gruende = [];
  if (kit.bedeutend) gruende.push({ art: "kit", text: "Dieser Ordner enthält Programmcode (das Brain-Kit unter „.tools“). Er läuft erst, wenn du diesem Vault vertraust." });
  if (hooks.bedeutend) gruende.push({ art: "hooks", text: "Dieser Ordner hat Git-Hooks — Programme, die Git beim Sichern oder Senden ausführt. Sie laufen erst, wenn du diesem Vault vertraust." });
  let gitGrund = null;
  if (gefaehrlich.length) gitGrund = `Die Git-Einstellungen dieses Ordners können Programme starten (${KURZ(gefaehrlich)}). Git bleibt gesperrt, bis du diesem Vault vertraust.`;
  else if (konfig.vorhanden && !konfig.lesbar) gitGrund = "Die Git-Einstellungen dieses Ordners ließen sich nicht lesen. Git bleibt gesperrt, bis du diesem Vault vertraust.";
  if (gitGrund) gruende.push({ art: "git", text: gitGrund });
  return { wurzel, ordner, code, erlaubt, geaendert, gruende, gitGrund, sshEigen: sshEigenGesetzt(konfig.eintraege), ...nutzerEinstellungen(konfig.eintraege) };
}

const LEER = { erlaubt: false, noetig: false, geaendert: false, gitGesperrt: false, gruende: [] };

// → { erlaubt, noetig, geaendert, gitGesperrt, gruende:[{art:"kit"|"hooks"|"git", text}] }
//   noetig: es gibt etwas, das Programme starten würde · geaendert: es gab eine Erlaubnis, sie gilt nicht mehr (neuer Ordner, neuer Code, altes Format)
//   gitGesperrt: gefährliche Git-Einstellungen und (noch) kein Vertrauen — Git läuft dann gar nicht.
export function pruefeVertrauen(vault, { support, frisch } = {}) {
  const a = analysiere(vault, support, { frisch });
  if (!a) return { ...LEER, gruende: [] };
  return { erlaubt: a.erlaubt, noetig: a.gruende.length > 0, geaendert: a.geaendert, gitGesperrt: !a.erlaubt && a.gitGrund !== null, gruende: a.gruende };
}

// Für die Git-Aufrufe: vertraut (Hooks und Repo-Konfiguration wie gewohnt), gesperrt (+ grund), sshEigen (core.sshCommand ist irgendwo
// gesetzt — dann setzen wir bei Vertrauen kein eigenes GIT_SSH_COMMAND), sshGlobal und gpgGlobal (was der Nutzer selbst eingestellt hat;
// ohne Vertrauen ersetzen wir nur die Einstellungen des Vaults). frisch: Konfiguration neu lesen (nach einem Abgleich).
export function gitSicht(vault, { support, frisch } = {}) {
  const a = analysiere(vault, support, { frisch });
  if (!a) return { vertraut: false, gesperrt: false, grund: null, sshEigen: false, sshGlobal: null, gpgGlobal: {} };
  return { vertraut: a.erlaubt, gesperrt: !a.erlaubt && a.gitGrund !== null, grund: !a.erlaubt ? a.gitGrund : null, sshEigen: a.sshEigen, sshGlobal: a.sshGlobal, gpgGlobal: a.gpgGlobal };
}

// Erlaubt genau den heutigen Stand (Ordner + Code). Wirft 400, wenn es den Ordner nicht gibt.
export function erlaube(vault, { support } = {}) {
  const a = analysiere(vault, support, { frisch: true });
  if (!a) throw new HttpFehler(400, "Der Vault-Ordner existiert nicht.");
  const m = leseMerker(support);
  for (const k of Object.keys(m)) if (gleicherOrt(k, a.wurzel)) delete m[k]; // eine andere Schreibweise desselben Ordners wird ersetzt
  m[a.wurzel] = { seit: new Date().toISOString(), ordner: a.ordner, code: a.code };
  schreibeMerker(support, m);
  return pruefeVertrauen(a.wurzel, { support });
}

// Nimmt die Erlaubnis zurück (der Eintrag verschwindet, in jeder Schreibweise; andere Vaults bleiben).
export function widerrufe(vault, { support } = {}) {
  const orte = kandidaten(vault);
  const m = leseMerker(support);
  const weg = Object.keys(m).filter((k) => orte.some((o) => gleicherOrt(k, o)));
  if (weg.length) { for (const k of weg) delete m[k]; schreibeMerker(support, m); }
  return pruefeVertrauen(orte[orte.length - 1], { support });
}

// Für Neuanlage, Klonen und Entfernen (vaults.mjs): den Eintrag eines Zielpfads löschen — mit und ohne Auflösung des Pfads.
export function vergissVertrauen(pfad, { support } = {}) {
  const orte = kandidaten(pfad);
  const m = leseMerker(support);
  const weg = Object.keys(m).filter((k) => orte.some((o) => gleicherOrt(k, o)));
  if (!weg.length) return;
  for (const k of weg) delete m[k];
  schreibeMerker(support, m);
}
