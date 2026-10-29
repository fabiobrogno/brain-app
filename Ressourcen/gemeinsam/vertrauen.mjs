// gemeinsam/vertrauen.mjs — Workspace-Trust je Vault (Kern-Umzug P5; löst „Vertrauen v2“ ab, das Programmcode unter .tools, Hooks und
// Git-Einstellungen mit einem Fingerabdruck band).
//
// Vertraut ist ein Vault, wenn
//   · Kortex ihn selbst angelegt hat (Assistent „neu“, quelle „angelegt“) oder über den Assistenten/das Studio von GitHub geklont hat („geklont“),
//   · der Nutzer im Studio „Vertrauen“ gesagt hat („bestaetigt“; die Frage „Kommt dieser Vault von dir?“ stellt das Studio einmal je von außen
//     geöffnetem Ordner), oder
//   · der Vault schon in der Vaultliste stand und die Werkstatt vor diesem Stand ihm vertraut hatte („migriert“, siehe migriereAltesVertrauen).
// Bis dahin: Lesen, Suchen und Ansehen gehen; es läuft aber KEIN git (weder in der Werkstatt noch im Kern), kein Hintergrunddienst, keine
// Hooks, keine KI-Pflege. Der Rückweg ist widerrufe() („Vertrauen entziehen“ in den Einstellungen des Studios).
//
// Der Merker liegt außerhalb des Vaults: <support>/vertrauen.json = { "<realpath>": { seit, ordner, quelle } }
//   ordner = "dev:ino:birthtimeMs" des Vault-Ordners (gelöscht und neu geklont oder durch eine Kopie ersetzt = neue Frage, auch am selben Pfad)
// Der Schlüssel ist der kanonische Pfad (realpath.native: Groß/klein und Unicode-Form wie auf der Platte); gelesen und gelöscht wird ohne
// Groß/klein und Unicode-Form — der Ordner selbst ist durch „ordner“ gebunden. Atomar geschrieben (Temp + rename), Modus 0600.
// Gelesen wird derselbe Merker vom Kern (Ressourcen/kern/vertrauen.mjs; Test: Tests/Node/vertrauen-kern.test.mjs). Nichts hier führt Code aus
// dem Vault aus — nur Dateien lesen und, bei einem vertrauten Vault, `git config --list`.
import { realpathSync, statSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { HttpFehler, supportOrdner, kindUmgebung, falte, absoluterGitPfad, testmodus } from "./basis.mjs";
import { sicherungFuer } from "./sicherung.mjs";

export const QUELLEN = ["angelegt", "geklont", "bestaetigt", "migriert"];

// Nur Testumgebungen (BRAIN_TESTMODUS=1 oder KORTEX_KERN_UNSTABIL_ERLAUBT=1): KORTEX_VAULT_VERTRAUT=alle lässt jeden Vault als vertraut gelten.
const alleVertraut = () => process.env.KORTEX_VAULT_VERTRAUT === "alle" && (testmodus() || process.env.KORTEX_KERN_UNSTABIL_ERLAUBT === "1");

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
  } catch { throw new HttpFehler(500, "Das Vertrauen konnte nicht gespeichert werden."); }
}

// Der kanonische Pfad des Ordners (Schreibweise wie auf der Platte). Auf einem case-insensitiven APFS liefert realpathSync (die JS-Fassung)
// die Schreibweise der Eingabe zurück, realpathSync.native die gespeicherte — nur so wird aus „…/MeinVault“ und „…/meinvault“ derselbe Schlüssel.
const echterPfad = (p) => realpathSync.native(p);
// Alle Schreibweisen, unter denen ein Eintrag für diesen Pfad stehen kann (ohne Groß/klein und Unicode-Form verglichen).
function kandidaten(pfad) {
  const k = new Set([resolve(String(pfad))]);
  for (const f of [realpathSync, realpathSync.native]) { try { k.add(f(pfad)); } catch { /* Ordner gibt es nicht (mehr) */ } }
  return [...k];
}
const gleicherOrt = (a, b) => falte(a) === falte(b);
const schluesselFuer = (m, wurzel) => (Object.hasOwn(m, wurzel) ? wurzel : Object.keys(m).find((k) => gleicherOrt(k, wurzel)) ?? null);

export function ordnerKennung(wurzel) {
  const st = statSync(wurzel);
  return `${st.dev}:${st.ino}:${st.birthtimeMs}`;
}

// ───────────────────────────── Stand ─────────────────────────────
const LEER = { erlaubt: false, noetig: false, gitGesperrt: false, quelle: null };

// → { erlaubt, noetig, gitGesperrt, quelle }. noetig: die Frage ist offen (nicht vertraut) · gitGesperrt: ohne Vertrauen läuft kein git.
//   imListe: (echterPfad) => boolean — nur für Einträge im alten Format (siehe migriereAltesVertrauen); ohne Angabe gelten sie nicht.
export function pruefeVertrauen(vault, { support, imListe } = {}) {
  let wurzel, ordner;
  try { wurzel = echterPfad(vault); if (!statSync(wurzel).isDirectory()) throw 0; ordner = ordnerKennung(wurzel); } catch { return { ...LEER }; }
  const gesperrt = { erlaubt: false, noetig: true, gitGesperrt: true, quelle: null };
  if (alleVertraut()) return { erlaubt: true, noetig: false, gitGesperrt: false, quelle: "bestaetigt" };
  const m = leseMerker(support);
  const k = schluesselFuer(m, wurzel);
  const e = k === null ? null : m[k];
  if (!e || typeof e !== "object" || e.ordner !== ordner) return gesperrt;
  let quelle = null;
  if (typeof e.quelle === "string") quelle = QUELLEN.includes(e.quelle) ? e.quelle : null;
  else if (typeof e.code === "string" && typeof imListe === "function") { try { if (imListe(wurzel) === true) quelle = "migriert"; } catch { /* unbekannt = nein */ } }
  return quelle ? { erlaubt: true, noetig: false, gitGesperrt: false, quelle } : gesperrt;
}

// Vertraut den Vault ab jetzt (genau diesen Ordner). Wirft 400, wenn es den Ordner nicht gibt, 500, wenn der Merker nicht geschrieben werden konnte.
export function erlaube(vault, { support, quelle = "bestaetigt" } = {}) {
  if (!QUELLEN.includes(quelle)) throw new HttpFehler(500, "Unbekannte Herkunft des Vertrauens.");
  let wurzel, ordner;
  try { wurzel = echterPfad(vault); if (!statSync(wurzel).isDirectory()) throw 0; ordner = ordnerKennung(wurzel); }
  catch { throw new HttpFehler(400, "Der Vault-Ordner existiert nicht."); }
  const m = leseMerker(support);
  for (const k of Object.keys(m)) if (gleicherOrt(k, wurzel)) delete m[k]; // eine andere Schreibweise desselben Ordners wird ersetzt
  m[wurzel] = { seit: new Date().toISOString(), ordner, quelle };
  schreibeMerker(support, m);
  return pruefeVertrauen(wurzel, { support });
}

// Nimmt das Vertrauen zurück (der Eintrag verschwindet, in jeder Schreibweise; andere Vaults bleiben).
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

// Migration (einmal beim Start der Werkstatt, idempotent): Einträge im alten Format ({ seit, ordner, code }) für Vaults, die in der Vaultliste
// stehen UND deren Ordner noch derselbe ist, werden zu { seit, ordner, quelle: "migriert" }. Alle anderen alten oder kaputten Einträge fallen weg
// (für sie gilt wieder die Frage). Neue Einträge bleiben unberührt. → Zahl der übernommenen Einträge.
export function migriereAltesVertrauen({ support, vaultPfade = [] } = {}) {
  const m = leseMerker(support);
  const listen = [];
  for (const p of vaultPfade) { try { listen.push(echterPfad(p)); } catch { /* Ordner fehlt */ } }
  let geaendert = false, uebernommen = 0;
  for (const k of Object.keys(m)) {
    const e = m[k];
    if (e && typeof e === "object" && typeof e.quelle === "string" && QUELLEN.includes(e.quelle) && typeof e.ordner === "string") continue;
    geaendert = true;
    let ok = false;
    try {
      const echt = echterPfad(k);
      ok = !!e && typeof e === "object" && typeof e.code === "string" && typeof e.ordner === "string" && e.ordner === ordnerKennung(echt) && listen.some((l) => gleicherOrt(l, echt));
      if (ok) m[k] = { seit: typeof e.seit === "string" ? e.seit : new Date().toISOString(), ordner: e.ordner, quelle: "migriert" };
    } catch { /* Ordner fehlt: kein Vertrauen */ }
    if (ok) uebernommen++; else delete m[k];
  }
  if (geaendert) schreibeMerker(support, m);
  return uebernommen;
}

// ───────────────────────────── Git-Konfiguration eines vertrauten Vaults ─────────────────────────────
// Gelesen wird mit Git selbst (`git config --list --show-scope --show-origin --null`): so gibt es keinen Parser-Unterschied zu Git
// (include.path, Anführungszeichen, Escapes). Nur für einen VERTRAUTEN Vault; core.fsmonitor/hooksPath sind dabei trotzdem aus.
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
//   vorhanden: der Ordner hat ein .git; lesbar: false, wenn Git die Einstellungen nicht ausgeben konnte.
//   frisch: den kurzen Zwischenspeicher übergehen.
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

const sshEigenGesetzt = (eintraege) => eintraege.some((e) => e.key.toLowerCase() === "core.sshcommand" && e.scope !== "command");

// Was der Nutzer selbst eingestellt hat (System und global, nie lokal): core.sshCommand und die Signierwünsche.
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

// Für die Git-Aufrufe der Werkstatt. Nicht vertraut: gesperrt (+ grund) — es läuft gar kein git. Vertraut: Hooks und Repo-Konfiguration wie gewohnt,
// sshEigen (core.sshCommand ist irgendwo gesetzt — dann setzen wir kein eigenes GIT_SSH_COMMAND), sshGlobal und gpgGlobal (was der Nutzer selbst eingestellt hat).
export const GRUND_GESPERRT = "Dieser Vault ist in Kortex noch nicht als deiner bestätigt. Bestätige ihn in der Statusleiste („Nur ansehen“), dann geht Git.";
export function gitSicht(vault, { support, imListe } = {}) {
  const v = pruefeVertrauen(vault, { support, imListe });
  if (!v.erlaubt) return { vertraut: false, gesperrt: true, grund: GRUND_GESPERRT, sshEigen: false, sshGlobal: null, gpgGlobal: {} };
  let wurzel;
  try { wurzel = echterPfad(vault); } catch { return { vertraut: false, gesperrt: true, grund: GRUND_GESPERRT, sshEigen: false, sshGlobal: null, gpgGlobal: {} }; }
  const k = liesGitKonfiguration(wurzel);
  return { vertraut: true, gesperrt: false, grund: null, sshEigen: sshEigenGesetzt(k.eintraege), ...nutzerEinstellungen(k.eintraege) };
}
