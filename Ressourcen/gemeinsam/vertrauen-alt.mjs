// gemeinsam/vertrauen-alt.mjs — der Code-Fingerabdruck des früheren Werkstatt-Vertrauens („Vertrauen v2“, bis P4), NUR noch für die Migration.
// Alte Merker-Einträge { seit, ordner, code } trugen diesen Fingerabdruck über Programmcode unter .tools, Git-Hooks, brain.config.json und die Git-Schlüssel,
// die Programme starten. vertrauen.mjs#migriereAltesVertrauen übernimmt einen alten Eintrag nur, wenn dieser Fingerabdruck heute noch zu dem Stand passt, dem
// der Nutzer zugestimmt hatte — sonst (er hatte „Nur ansehen“ gewählt oder der Vault hat sich verändert) kommt die Frage. Rechnet nur, startet nichts.
import { realpathSync, statSync, lstatSync, readdirSync, readFileSync, readlinkSync, existsSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { falte } from "./basis.mjs";

const echterPfad = (p) => realpathSync.native(p);
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


// → der Fingerabdruck wie ihn Vertrauen v2 für diesen Vault berechnet hat. `eintraege`: die Git-Konfiguration (liesGitKonfiguration), `gitVorhanden`: der Ordner hat ein .git.
export function alterFingerabdruck(wurzel, eintraege, gitVorhanden) {
  const kit = sammleZeilen(join(wurzel, ".tools"), "tools:", { nurCode: true });
  const hookDir = gitVorhanden ? hooksVerzeichnis(wurzel, eintraege) : null;
  const hooks = hookDir ? sammleZeilen(hookDir, "hooks:", { ohneSample: true }) : { zeilen: [], bedeutend: 0 };
  const wurzelZeilen = [];
  const cfg = configAngabe(join(wurzel, "brain.config.json")), pkg = dateiAngabe(join(wurzel, "package.json"));
  if (cfg !== null) wurzelZeilen.push(`config:brain.config.json\0${cfg}`);
  if (pkg !== null) wurzelZeilen.push(`wurzel:package.json\0${pkg}`);
  return fingerabdruck([...kit.zeilen, ...hooks.zeilen, ...wurzelZeilen, ...gitZeilen(eintraege)]);
}
