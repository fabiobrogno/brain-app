// gemeinsam/git.mjs — Git-Aufrufe für Studio (Spec §5, v2 §8): nie eine Shell, Pfade nach `--`, GIT_TERMINAL_PROMPT=0, nie --force,
// nie -A. Git startet nur über einen einmal aufgelösten absoluten Pfad (nie ein `git` aus dem Vault). Jeder Aufruf läuft gehärtet: ohne
// core.fsmonitor und ohne ext::-Transport, ohne Submodule (status/diff ignorieren sie, nichts holt oder sendet in ihnen), mit GIT_EDITOR=: ;
// Diff/Log/Show ohne externe Diff-Programme und Textconv. Solange dem Vault nicht vertraut ist (ctx.vertraut), laufen zusätzlich keine Hooks,
// keine Signierung aus der Vault-Konfiguration und Git nutzt unser (bzw. des Nutzers globales) GIT_SSH_COMMAND. Der Abgleich holt fremde
// Commits in den Arbeitsbaum und läuft deshalb immer ohne Hooks (siehe sync). Zeitlimits: je Aufruf und als Gesamtfrist je Route
// (ctx.frist) — bei Ablauf wird die ganze Prozessgruppe beendet.
// ctx = { vertraut, sshEigen, sshGlobal, gpgGlobal, frist } kommt von vault.mjs (aus vertrauen.mjs); ohne Angabe gilt „nicht vertraut“.
import { execFile, execFileSync } from "node:child_process";
import { realpathSync, readFileSync, writeFileSync, statSync, renameSync, lstatSync, unlinkSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { HttpFehler, sauber, kindUmgebung, falte, absoluterGitPfad, absoluterPfad } from "./basis.mjs";
import { berlinHeute } from "./pruefung.mjs";
import { starte, neueFrist, beendeAlleProzesse } from "./prozess.mjs";
import { pruefeGitUrl, uebersetzeGitFehler } from "./gitwerkzeug.mjs"; // (gitwerkzeug importiert git() von hier — Kreis ist harmlos: nur Funktionen, nichts beim Laden)

export { neueFrist };
const LIMIT = 60_000, LIMIT_SYNC = 120_000;
const LIMIT_COMMIT = 75_000, LIMIT_REMOTE = 120_000, LIMIT_ABGLEICH = 360_000; // Gesamtfristen je Route (Swift wartet 90 s / 150 s / 400 s)
const GNADE = 10_000; // Rückweg nach abgelaufener Frist (Index zurück, origin entfernen, Aufräumen): darf noch so lange laufen
const REPO_GEBUNDEN = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR", "GIT_PREFIX", "GIT_NAMESPACE", "GIT_QUARANTINE_PATH"];

// Für JEDEN Aufruf: Pfade unverfälscht, kein Dateisystem-Beobachter (core.fsmonitor ist sonst ein beliebiger Befehl), kein ext::-Transport.
// Submodule: Git geht für status/diff, fetch, push und die Checkout-Befehle in eingerichtete Submodule und nähme dort DEREN Konfiguration
// (clean-Filter, credential.helper, uploadpack …), die Vertrauen v2 nie prüft — also nirgends hinein (zusätzlich --ignore-submodules=all
// bei status/diff und --no-recurse-submodules beim Holen).
const GRUND = ["-c", "core.quotepath=false", "-c", "core.fsmonitor=false", "-c", "protocol.ext.allow=never",
  "-c", "submodule.recurse=false", "-c", "fetch.recurseSubmodules=false", "-c", "push.recurseSubmodules=no",
  "-c", "diff.ignoreSubmodules=all", "-c", "status.submoduleSummary=false"];
const OHNE_HOOKS = ["-c", "core.hooksPath=/dev/null"];
const OHNE_SUBMODULE = ["--ignore-submodules=all"];
// Ohne Vertrauen darf die Vault-Konfiguration nichts signieren lassen (Git riefe gpg/ssh-keygen aus der Vault-Konfiguration heraus): der
// Wert kommt vom Nutzer (System/global), sonst „false“. gpg = { commit, tag, push } aus vertrauen.mjs (nur gesetzte Werte).
const OHNE_SIGNIEREN = (gpg) => ["-c", `commit.gpgSign=${(gpg && gpg.commit) ?? "false"}`, "-c", `tag.gpgSign=${(gpg && gpg.tag) ?? "false"}`,
  "-c", `push.gpgSign=${(gpg && gpg.push) ?? "false"}`];
// Für Diff/Log/Show: keine externen Diff-Programme (diff.external, diff.*.command) und kein Textconv (diff.*.textconv).
const OHNE_EXTERN = ["--no-ext-diff", "--no-textconv"];

// Umgebung eines Git-Aufrufs. Laufen wir in einem Hook, darf kein fremdes Repo durchschlagen. GIT_SSH_COMMAND schlägt core.sshCommand:
// ohne Vertrauen setzen wir den Wert der Nutzer-Einstellung (sshGlobal: System/global — sie ist nicht die des Vaults), sonst unseren
// BatchMode-Befehl; eine core.sshCommand aus dem Vault bleibt so nie wirksam. Mit Vertrauen setzen wir nichts, wenn irgendwo eine
// core.sshCommand steht (ctx.sshEigen) — wer sich eine eigene eingerichtet hat, behält sie. Eine GIT_SSH_COMMAND aus der Umgebung des
// Nutzers bleibt in jedem Fall. BRAIN_VAULT: Das Kit (auch in einem Hook) soll mit dem Vault arbeiten, in dem Git läuft — nicht mit
// dem, mit dem die Werkstatt gestartet wurde (Wechsel in der Oberfläche); ohne vault entfällt die Variable.
export function gitUmgebung({ vertraut = false, sshEigen = false, sshGlobal = null, vault = null } = {}) {
  const e = kindUmgebung();
  for (const k of REPO_GEBUNDEN) delete e[k];
  delete e.BRAIN_VAULT;
  if (vault) e.BRAIN_VAULT = vault;
  e.GIT_TERMINAL_PROMPT = "0";
  e.GIT_LITERAL_PATHSPECS = "1"; // Pfade nach `--` sind Dateinamen, nie Muster (*, [..], :(glob))
  e.LC_ALL = "C";
  e.GIT_EDITOR = ":"; e.GIT_SEQUENCE_EDITOR = ":"; // nie ein Editor (weder core.editor noch sequence.editor aus der Vault-Konfiguration)
  if (!e.GIT_SSH_COMMAND && !(vertraut && sshEigen)) e.GIT_SSH_COMMAND = (!vertraut && sshGlobal) || "ssh -o BatchMode=yes"; // nie nach Passwort fragen
  return e;
}

// → {code, stdout, stderr}; wirft nur bei Zeitüberschreitung (HttpFehler 504, extra.gestartet = Startzeit ms; die ganze Prozessgruppe
// ist dann beendet) oder wenn git fehlt. frist = Gesamtfrist der Route: der Aufruf bekommt höchstens das Restbudget.
// ohneHooks: auch in einem vertrauten Vault ohne Hooks (Abgleich, Rückweg). vault: Wert für BRAIN_VAULT (Standard: cwd; null = keiner,
// z. B. beim Klonen, wo cwd der Elternordner ist). sshGlobal/gpgGlobal: Einstellungen des Nutzers (siehe gitUmgebung, OHNE_SIGNIEREN).
export function git(cwd, args, { timeout = LIMIT, buffer = false, vertraut = false, sshEigen = false, sshGlobal = null, gpgGlobal = null, ohneHooks = false, frist = null, vault = cwd } = {}) {
  const programm = absoluterGitPfad(); // nie der nackte Name „git“: der würde nach dem Wechsel in den (womöglich fremden) Vault gesucht
  if (!programm) return Promise.reject(new HttpFehler(500, "Git ist auf diesem Mac nicht installiert."));
  return starte(programm, [...GRUND, ...(vertraut ? [] : OHNE_SIGNIEREN(gpgGlobal)), ...(vertraut && !ohneHooks ? [] : OHNE_HOOKS), ...args],
    { cwd, env: gitUmgebung({ vertraut, sshEigen, sshGlobal, vault }), timeout, frist, buffer,
      fehlt: "Git ist auf diesem Mac nicht installiert.", zuLange: "Git hat zu lange gebraucht und wurde abgebrochen." });
}
// Git-Aufruf mit dem Kontext einer Route (Vertrauen, Frist); extra überschreibt (z. B. { frist: null, timeout: GNADE } für den Rückweg).
const binde = (wurzel, ctx = {}) => (args, extra) => git(wurzel, args, { ...ctx, ...extra });
const kontext = (o = {}, frist) => ({ vertraut: !!o.vertraut, sshEigen: !!o.sshEigen, sshGlobal: o.sshGlobal ?? null, gpgGlobal: o.gpgGlobal ?? null, frist });
const rueckweg = { frist: null, timeout: GNADE, ohneHooks: true };

const kuerze = (s, n = 4000) => (s.length > n ? s.slice(0, n) + "\n… (gekürzt)" : s);
const ausgabeVon = (r) => kuerze((String(r.stdout || "") + String(r.stderr || "")).trim());

// Ist der Vault selbst die Wurzel eines Git-Repos?
async function istRepoG(G, wurzel) {
  try {
    const r = await G(["rev-parse", "--show-toplevel"]);
    return r.code === 0 && realpathSync(r.stdout.trim()) === wurzel;
  } catch (e) { if (e instanceof HttpFehler && e.status === 500) return false; throw e; }
}
// ctx wie bei git(): { timeout, frist, vertraut, sshEigen } — z. B. istRepo(p, { timeout: 5000 }) für Prüfungen mit Budget.
export function istRepo(wurzel, ctx = {}) { return istRepoG(binde(wurzel, ctx), wurzel); }
async function brauchtRepo(G, wurzel) {
  if (!(await istRepoG(G, wurzel))) throw new HttpFehler(400, "Dieser Ordner ist (noch) kein Git-Repository.");
}

const SYNC_DATEI = (wurzel) => join(wurzel, ".git", "brain-studio.json");
export function letzterSync(wurzel) {
  try { return JSON.parse(readFileSync(SYNC_DATEI(wurzel), "utf8")).letzterSync || null; } catch { return null; }
}
function merkeSync(wurzel) {
  const zeit = new Date().toISOString();
  try {
    if (!statSync(join(wurzel, ".git")).isDirectory()) return zeit;
    const ziel = SYNC_DATEI(wurzel), tmp = ziel + ".tmp";
    writeFileSync(tmp, JSON.stringify({ letzterSync: zeit }) + "\n");
    renameSync(tmp, ziel);
  } catch { /* nur Komfort */ }
  return zeit;
}

async function zweig(G) {
  const r = await G(["symbolic-ref", "--short", "-q", "HEAD"]);
  return r.code === 0 ? r.stdout.trim() : "(losgelöst)";
}
async function hatCommits(G) { return (await G(["rev-parse", "--verify", "-q", "HEAD"])).code === 0; }
async function kopfSha(G, extra) { const r = await G(["rev-parse", "--verify", "-q", "HEAD"], extra); return r.code === 0 ? r.stdout.trim() : null; }
async function upstreamVon(G) {
  const r = await G(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  return r.code === 0 ? r.stdout.trim() : null;
}
async function vorZurueck(G) {
  const r = await G(["rev-list", "--left-right", "--count", "HEAD...@{u}"]);
  if (r.code !== 0) return { vor: 0, zurueck: 0 };
  const [vor, zurueck] = r.stdout.trim().split(/\s+/).map(Number);
  return { vor: vor || 0, zurueck: zurueck || 0 };
}
async function remotes(G) {
  const r = await G(["remote"]);
  return r.code === 0 ? r.stdout.split("\n").map((s) => s.trim()).filter(Boolean) : [];
}

// porcelain v1 -z ohne Rename-Erkennung: "XY pfad\0"
function parseStatus(roh) {
  const out = [];
  for (const eintrag of roh.split("\0")) {
    if (eintrag.length < 4) continue;
    const code = eintrag.slice(0, 2).trim() || "?";
    out.push({ pfad: eintrag.slice(3), code: code === "??" ? "??" : code });
  }
  return out.sort((a, b) => (a.pfad < b.pfad ? -1 : 1));
}
async function geaendert(G) {
  const r = await G(["status", "--porcelain=v1", "-z", "-uall", "--no-renames", ...OHNE_SUBMODULE]);
  if (r.code !== 0) throw new HttpFehler(500, "Git-Status war nicht lesbar.");
  return parseStatus(r.stdout);
}

export async function status(wurzel, ctx = {}) {
  const G = binde(wurzel, ctx);
  if (!(await istRepoG(G, wurzel))) {
    return { repo: false, zweig: null, upstream: null, vor: 0, zurueck: 0, geaendert: [], letzterCommit: null, letzterSync: null, remote: false };
  }
  const [z, up, ge, rem, hat] = await Promise.all([zweig(G), upstreamVon(G), geaendert(G), remotes(G), hatCommits(G)]);
  const zaehl = up ? await vorZurueck(G) : { vor: 0, zurueck: 0 };
  let letzterCommit = null;
  if (hat) {
    const r = await G(["log", "-1", ...OHNE_EXTERN, "--format=%H%x1f%h%x1f%s%x1f%cI"]);
    if (r.code === 0) { const [sha, kurz, nachricht, zeit] = r.stdout.trim().split("\x1f"); letzterCommit = { sha, kurz, nachricht, zeit }; }
  }
  return { repo: true, zweig: z, upstream: up, vor: zaehl.vor, zurueck: zaehl.zurueck, geaendert: ge, letzterCommit,
    letzterSync: letzterSync(wurzel), remote: rem.length > 0 };
}

// Je Vault nur ein Abgleich/Commit gleichzeitig (Sperre im Prozess). Wird synchron beim Aufruf genommen.
const laufend = new Set();
async function exklusiv(wurzel, fn) {
  if (laufend.has(wurzel)) throw new HttpFehler(409, "Abgleich läuft schon. Bitte kurz warten.");
  laufend.add(wurzel);
  try { return await fn(); } finally { laufend.delete(wurzel); }
}

// Gesamtfrist 75 s (ctx.limit überschreibt — nur für Tests): reicht sie nicht, wird die Prozessgruppe (auch ein hängender Hook) beendet,
// der Index wie vorher hergestellt und mit 504 geantwortet.
export function commit(wurzel, a, ctx = {}) {
  return exklusiv(wurzel, () => commitOhneSperre(wurzel, a || {}, kontext(ctx, ctx.frist || neueFrist(ctx.limit > 0 ? ctx.limit : LIMIT_COMMIT))));
}

async function commitOhneSperre(wurzel, { nachricht, dateien }, ctx) {
  const G = binde(wurzel, ctx);
  await brauchtRepo(G, wurzel);
  if (typeof nachricht !== "string" || !nachricht.trim()) throw new HttpFehler(400, "Bitte eine Commit-Nachricht eingeben.");
  if (!Array.isArray(dateien) || !dateien.length || dateien.some((d) => typeof d !== "string")) throw new HttpFehler(400, "Bitte mindestens eine Datei auswählen.");
  const offen = new Set((await geaendert(G)).map((e) => e.pfad));
  const pfade = [...new Set(dateien)];
  for (const p of pfade) {
    // erlaubt ist nur, was Git selbst als geändert meldet — dazu kein .git und keine ..-Segmente
    if (p.split("/").some((s) => s === ".." || s === ".git") || p.startsWith("/")) throw new HttpFehler(403, "Dieser Pfad ist gesperrt.");
    if (!offen.has(p)) throw new HttpFehler(400, `„${p}“ hat keine offenen Änderungen.`);
  }
  const gestartet = Date.now();
  const kopfVorher = await kopfSha(G);
  const sicherung = await indexSichern(G);
  let c;
  try {
    const a = await G(["add", "--", ...pfade]);
    if (a.code !== 0) {
      await indexZurueck(G, sicherung);
      throw new HttpFehler(422, "Die Dateien konnten nicht vorgemerkt werden.", { ausgabe: ausgabeVon(a) });
    }
    // --only + Pfade: committet genau diese Dateien, auch wenn sonst etwas vorgemerkt wäre
    c = await G(["commit", "-m", nachricht, "--only", "--", ...pfade]);
  } catch (e) {
    if (!(e instanceof HttpFehler) || e.status !== 504) throw e;
    // Frist abgelaufen (die Prozessgruppe ist beendet): Sperrdatei aufräumen; war der Commit schon fertig, gilt er — sonst Index zurück.
    await sperreAufraeumen(wurzel, gestartet);
    const kopfNachher = await kopfSha(G, rueckweg).catch(() => null);
    if (kopfNachher && kopfNachher !== kopfVorher) return { sha: kopfNachher };
    await indexZurueck(G, sicherung);
    const s = Math.round((ctx.frist ? ctx.frist.ms : LIMIT_COMMIT) / 1000);
    throw new HttpFehler(504, `Das Sichern hat zu lange gebraucht (nach ${s} Sekunden abgebrochen). Es wurde nichts gesichert, deine Änderungen sind unverändert. ` +
      "Meist hängt ein Prüfprogramm (Hook) — bitte später noch einmal versuchen.");
  }
  if (c.code !== 0) {
    await indexZurueck(G, sicherung); // Vormerkung exakt wie vorher (auch teilweise Vorgemerktes bleibt)
    throw new HttpFehler(422, "Der Commit wurde abgelehnt. Die Meldung steht unten.", { ausgabe: ausgabeVon(c) });
  }
  const h = await G(["rev-parse", "HEAD"]);
  return { sha: h.stdout.trim() };
}

// Index vor dem Vormerken sichern: Baum-SHA (git write-tree; im leeren Repo der leere Baum). Geht das nicht
// (z. B. ungelöste Einträge), bleibt die Index-Datei als Kopie.
async function indexSichern(G) {
  const w = await G(["write-tree"]);
  if (w.code === 0 && /^[0-9a-f]{40,64}$/.test(w.stdout.trim())) return { baum: w.stdout.trim() };
  try {
    const p = (await G(["rev-parse", "--path-format=absolute", "--git-path", "index"])).stdout.trim();
    return { datei: p, inhalt: readFileSync(p) };
  } catch { return { baum: null }; }
}
async function indexZurueck(G, s) { // läuft auch nach abgelaufener Frist (eigenes Kurzbudget)
  try {
    if (s.baum) await G(["read-tree", s.baum], rueckweg);
    else if (s.datei) { try { writeFileSync(s.datei, s.inhalt); } catch { /* nur Komfort */ } }
  } catch { /* nur Komfort */ }
}

async function konfliktDateien(G) {
  const r = await G(["diff", "--name-only", "--diff-filter=U", ...OHNE_EXTERN, ...OHNE_SUBMODULE]);
  return r.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
}

// Läuft ein von uns gestarteter Merge im Abgleich? (wurzel → Startzeit) — beim Beenden der Werkstatt wird er mit `git merge --abort` zurückgenommen.
const merges = new Map();
const mergeMarke = (wurzel) => { merges.set(wurzel, Date.now()); return () => merges.delete(wurzel); };

// Für externe Merge-Treiber legt Git die Hilfsdateien `.merge_file_XXXXXX` (%O, %A, %B) im Arbeitsordner an und räumt sie selbst weg —
// nur nicht, wenn es mit SIGKILL beendet wird (Zeitüberschreitung, Beenden der Werkstatt). Entfernt werden ausschließlich reguläre Dateien
// im Wurzelordner mit genau diesem Namensmuster, die nach dem Start des beendeten Aufrufs entstanden sind.
const MERGE_HILFSDATEI = /^\.merge_file_[A-Za-z0-9]{6}$/;
function mergeReste(wurzel, ab) {
  let namen;
  try { namen = readdirSync(wurzel); } catch { return; }
  for (const n of namen) {
    if (!MERGE_HILFSDATEI.test(n)) continue;
    const p = join(wurzel, n);
    try { const s = lstatSync(p); if (s.isFile() && s.mtimeMs >= ab - 1000) unlinkSync(p); } catch { /* schon weg */ }
  }
}

export function sync(wurzel, opt = {}) { return exklusiv(wurzel, () => syncOhneSperre(wurzel, opt)); }

// Läuft git in die Zeitüberschreitung (SIGKILL), kann Git eine halbe Zusammenführung und index.lock hinterlassen.
// Die Sperrdatei wird nur entfernt, wenn sie nach dem Start unseres Aufrufs entstand und kein git-Prozess mehr läuft.
// Läuft in genau diesem Vault noch ein git-Prozess? (lsof: Arbeitsordner aller git-Prozesse; lsof fehlt → „ja“, also vorsichtig)
function gitLaeuft(wurzel) {
  return new Promise((ok) => {
    execFile(absoluterPfad("lsof") || "/usr/sbin/lsof", ["-a", "-d", "cwd", "-c", "git", "-Fn"], { env: kindUmgebung(), maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
      if (err && err.code === "ENOENT") return ok(true);
      const orte = String(out || "").split("\n").filter((z) => z.startsWith("n")).map((z) => z.slice(1));
      ok(orte.some((o) => o === wurzel || o.startsWith(wurzel + "/")));
    });
  });
}
async function sperreAufraeumen(wurzel, gestartet) {
  const lock = join(wurzel, ".git", "index.lock");
  let lockZeit = null;
  try { lockZeit = lstatSync(lock).mtimeMs; } catch { /* keine Sperrdatei */ }
  if (lockZeit === null) return;
  if (lockZeit >= gestartet - 1000 && !(await gitLaeuft(wurzel))) { try { unlinkSync(lock); } catch { /* weg */ } }
  else throw new HttpFehler(409, "Git ist noch beschäftigt oder hat eine Sperrdatei hinterlassen (.git/index.lock). Bitte kurz warten und erneut versuchen; bleibt es so, schließe andere Git-Programme.");
}
async function nachAbbruchAufraeumen(G, wurzel, gestartet) {
  await sperreAufraeumen(wurzel, gestartet);
  await G(["merge", "--abort"], rueckweg); // schlägt harmlos fehl, wenn keine Zusammenführung läuft
  if (!(await gitLaeuft(wurzel))) mergeReste(wurzel, gestartet);
}
async function mitAbbruchSchutz(G, wurzel, lauf) {
  try { return await lauf(); }
  catch (e) {
    if (e instanceof HttpFehler && e.status === 504) {
      await nachAbbruchAufraeumen(G, wurzel, e.extra.gestartet || Date.now());
      throw new HttpFehler(504, "Der Abgleich hat zu lange gebraucht und wurde abgebrochen. Es wurde nichts verändert — bitte später noch einmal versuchen.");
    }
    throw e;
  }
}

// opt: limitSync = Frist je Git-Aufruf (Standard 120 s), limitGesamt = Gesamtfrist der Route (Standard 360 s), vertraut/sshEigen/… aus vault.mjs,
// neuBewerten = () => { vertraut, gesperrt } (Vertrauen NEU lesen; ohne Angabe wird nach dem Holen nicht neu bewertet).
// Der Abgleich bringt fremde Commits in den Arbeitsbaum — auch Hook-Dateien und Kit-Code (z. B. bei core.hooksPath=.tools/git-hooks). Holen und
// Zusammenführen laufen deshalb IMMER ohne Hooks, auch in einem vertrauten Vault: ein vom Server geholter Hook liefe sonst, bevor die Frage nach
// dem Vertrauen neu gestellt wird (§8). Nach dem Holen wird das Vertrauen neu bewertet; gilt es nicht mehr, wird nichts gesendet (der Hook
// pre-push wäre der neue, nicht freigegebene Code) und das Ergebnis trägt vertrauenGeaendert: die Oberfläche fragt neu, danach sendet der
// nächste Abgleich. Gilt es noch, laufen beim Senden die Hooks wie gewohnt.
async function syncOhneSperre(wurzel, opt = {}) {
  const limitSync = opt.limitSync > 0 ? opt.limitSync : LIMIT_SYNC;
  const frist = opt.frist || neueFrist(opt.limitGesamt > 0 ? opt.limitGesamt : LIMIT_ABGLEICH);
  const G = binde(wurzel, kontext(opt, frist));
  const OH = { ohneHooks: true };
  await brauchtRepo(G, wurzel);
  const rem = await remotes(G);
  if (!rem.length) throw new HttpFehler(400, "Es ist noch kein Remote (Server) eingetragen. Trage zuerst eins in Git ein.");
  const remote = rem.includes("origin") ? "origin" : rem[0];
  const f = await G(["fetch", "--quiet", "--no-recurse-submodules", remote], { ...OH, timeout: limitSync });
  if (f.code !== 0) throw new HttpFehler(502, "Der Server war nicht erreichbar.", { ausgabe: ausgabeVon(f) });
  if (!(await hatCommits(G))) throw new HttpFehler(400, "Es gibt noch keinen Commit zum Abgleichen.");
  const z = await zweig(G);
  if (z === "(losgelöst)") throw new HttpFehler(400, "Du bist auf keinem Zweig — bitte zuerst einen Zweig wählen.");

  let up = await upstreamVon(G);
  let neuerZweig = false;
  if (!up) {
    const gibts = await G(["rev-parse", "--verify", "-q", `refs/remotes/${remote}/${z}`]);
    if (gibts.code === 0) { await G(["branch", "--set-upstream-to", `${remote}/${z}`], OH); up = `${remote}/${z}`; }
    else neuerZweig = true;
  }

  let geholt = false, gesendet = false, vertrauenGeaendert = false;
  if (up) {
    const { zurueck } = await vorZurueck(G);
    if (zurueck > 0) {
      geholt = true;
      const markeWeg = mergeMarke(wurzel);
      try {
        let m = await mitAbbruchSchutz(G, wurzel, () => G(["merge", "--ff-only", "--quiet", "@{u}"], { ...OH, timeout: limitSync }));
        if (m.code !== 0) m = await mitAbbruchSchutz(G, wurzel, () => G(["merge", "--no-edit", "--quiet", "@{u}"], { ...OH, timeout: limitSync }));
        if (m.code !== 0) {
          const dateien = await konfliktDateien(G);
          await G(["merge", "--abort"], rueckweg); // Arbeitsstand wie vorher
          if (dateien.length) throw new HttpFehler(409, "Beim Zusammenführen gibt es Konflikte. Es wurde nichts verändert — bitte die Stellen mit einer Vertrauensperson oder in Git klären.", { dateien });
          throw new HttpFehler(409, "Ungesicherte Änderungen stehen im Weg. Bitte zuerst committen, dann abgleichen.", { dateien: [], ausgabe: ausgabeVon(m) });
        }
      } finally { markeWeg(); }
      if (opt.vertraut && typeof opt.neuBewerten === "function") { // das Geholte kann Hooks, Kit-Code oder Git-Einstellungen geändert haben
        let neu = null;
        try { neu = opt.neuBewerten(); } catch { /* nicht prüfbar: wie „nicht mehr vertraut“ */ }
        if (!neu || !neu.vertraut || neu.gesperrt) vertrauenGeaendert = true;
      }
    }
    const nach = await vorZurueck(G);
    if (nach.vor > 0 && !vertrauenGeaendert) {
      const p = await G(["push", "--quiet"], { timeout: limitSync });
      if (p.code !== 0) throw new HttpFehler(409, "Der Server hat das Senden abgelehnt (es gab dort inzwischen Neues). Bitte noch einmal abgleichen.", { dateien: [], ausgabe: ausgabeVon(p) });
      gesendet = true;
    }
  } else if (neuerZweig) {
    const p = await G(["push", "--quiet", "-u", remote, z], { timeout: limitSync });
    if (p.code !== 0) throw new HttpFehler(409, "Der Server hat das Senden abgelehnt.", { dateien: [], ausgabe: ausgabeVon(p) });
    gesendet = true;
  }
  const ergebnis = geholt && gesendet ? "beides" : geholt ? "geholt" : gesendet ? "gesendet" : "aktuell";
  return { ergebnis, letzterSync: merkeSync(wurzel), ...(vertrauenGeaendert ? { vertrauenGeaendert: true } : {}) };
}

const SHA = /^[0-9a-f]{4,64}$/i;
const pruefeSha = (sha) => { if (typeof sha !== "string" || !SHA.test(sha)) throw new HttpFehler(400, "Ungültige Versionsnummer."); return sha; };
const gitPfad = (rel) => sauber(rel).join("/");

export async function verlauf(wurzel, rel, max, ctx = {}) {
  const G = binde(wurzel, ctx);
  await brauchtRepo(G, wurzel);
  const p = gitPfad(rel);
  const n = Math.min(500, Math.max(1, Number.parseInt(max, 10) || 50));
  if (!(await hatCommits(G))) return { eintraege: [] };
  const r = await G(["log", "--follow", ...OHNE_EXTERN, `--max-count=${n}`, "--format=%H%x1f%h%x1f%an%x1f%cI%x1f%s%x1e", "--", p]);
  if (r.code !== 0) return { eintraege: [] };
  const eintraege = r.stdout.split("\x1e").map((s) => s.replace(/^\n/, "")).filter(Boolean).map((z) => {
    const [sha, kurz, autor, zeit, nachricht] = z.split("\x1f");
    return { sha, kurz, autor, zeit, nachricht };
  });
  return { eintraege };
}

export async function diff(wurzel, rel, sha, ctx = {}) {
  const G = binde(wurzel, ctx);
  await brauchtRepo(G, wurzel);
  const p = gitPfad(rel);
  const MAX = 400_000;
  let r;
  if (sha) {
    r = await G(["show", "--format=", "--no-color", ...OHNE_EXTERN, pruefeSha(sha), "--", p]);
    if (r.code !== 0) throw new HttpFehler(404, "Diese Version gibt es nicht.");
  } else {
    const verfolgt = (await G(["ls-files", "--error-unmatch", "--", p])).code === 0;
    if (verfolgt && (await hatCommits(G))) r = await G(["diff", "--no-color", ...OHNE_EXTERN, ...OHNE_SUBMODULE, "HEAD", "--", p]);
    else r = await G(["diff", "--no-color", "--no-index", ...OHNE_EXTERN, "--", "/dev/null", p]); // neu: Exit 1 ist normal
  }
  return { diff: r.stdout.length > MAX ? r.stdout.slice(0, MAX) + "\n… (gekürzt)\n" : r.stdout };
}

export async function fassung(wurzel, rel, sha, ctx = {}) {
  const G = binde(wurzel, ctx);
  await brauchtRepo(G, wurzel);
  const p = gitPfad(rel);
  const r = await G(["show", `${pruefeSha(sha)}:${p}`], { buffer: true });
  if (r.code !== 0) throw new HttpFehler(404, "Diese Fassung gibt es nicht.");
  if (r.stdout.length > 5 * 1024 * 1024) throw new HttpFehler(413, "Die Datei ist zu groß.");
  const text = r.stdout.toString("utf8");
  if (Buffer.compare(Buffer.from(text, "utf8"), r.stdout) !== 0) throw new HttpFehler(415, "Diese Fassung ist kein lesbarer Text.");
  return { inhalt: text };
}

// ── Beenden der Werkstatt (SIGTERM): laufende Git-Prozessgruppen beenden, Sperrdateien dieser Prozesse entfernen und einen gerade
// laufenden Merge des Abgleichs mit `git merge --abort` zurücknehmen (synchron, insgesamt höchstens ~1,5 s). Danach startet nichts mehr.
export function beendeLaufendes(budgetMs = 1500) {
  const ende = Date.now() + budgetMs;
  const infos = beendeAlleProzesse();
  const warte = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* egal */ } };
  const lebt = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  for (let i = 0; i < 15 && infos.some((x) => x.pid && lebt(x.pid)) && Date.now() < ende; i++) warte(10); // SIGKILL wirkt fast sofort
  const orte = new Map(); // Arbeitsordner → früheste Startzeit
  for (const x of infos) if (x.cwd) orte.set(x.cwd, Math.min(x.start, orte.get(x.cwd) ?? Infinity));
  for (const [w, start] of merges) orte.set(w, Math.min(start, orte.get(w) ?? Infinity));
  for (const [ort, start] of orte) { // Sperrdatei, die erst nach dem Start dieses (jetzt beendeten) Prozesses entstand, gehört uns
    const lock = join(ort, ".git", "index.lock");
    try { if (lstatSync(lock).mtimeMs >= start - 1000) unlinkSync(lock); } catch { /* keine */ }
    mergeReste(ort, start);
  }
  const programm = absoluterGitPfad();
  for (const [w] of merges) {
    const rest = ende - Date.now();
    if (rest <= 50 || !programm) break;
    try {
      execFileSync(programm, [...GRUND, ...OHNE_HOOKS, "merge", "--abort"], { cwd: w, env: gitUmgebung({ vault: w }), timeout: Math.min(1500, rest), killSignal: "SIGKILL", stdio: "ignore" });
    } catch { /* keine Zusammenführung oder nicht rechtzeitig: dann bleibt es wie es ist */ }
  }
  merges.clear();
}

// ══ Studio v2 ════════════════════════════════════════════════════════════════════════════════════════════════════════
// Ab hier nur Ergänzungen (v2-Spec §1 „Verlauf-Modus“, §2 „Remote hinzufügen“); alles darüber ist unverändert.

// ── Verlauf des ganzen Repos nach Tagen ──────────────────────────────────────────────────────────────────────────────
const LOG_STANDARD = 50, LOG_OBERGRENZE = 200, DATEIEN_JE_COMMIT = 300;
const TAG_NAME = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", weekday: "long", day: "numeric", month: "long", year: "numeric" });
// Kopfzeile je Commit: \x1e leitet sie ein, \x1f trennt die Felder; Freitext (Autor, Nachricht) steht hinten.
const LOG_FORMAT = "%x1e%H%x1f%h%x1f%P%x1f%cI%x1f%an%x1f%s";
const ROH_EINTRAG = /^:\d{6} \d{6} [0-9a-f]+ [0-9a-f]+ ([A-Za-z])\d*$/;
const ZAHLEN_EINTRAG = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/;
// Gesperrt wie in basis.sauber(): ein Segment beginnt mit „.“ oder ist node_modules (NFC/klein verglichen, wie APFS).
const istGesperrt = (pfad) => pfad.split("/").some((s) => s.startsWith(".") || falte(s) === "node_modules");

// Ausgabe von `git log -z --raw --numstat -M` zerlegen (Format per Versuch belegt): je Commit die Kopfzeile + NUL, dann —
// nach einem Zeilenumbruch — die Raw-Einträge und ohne Trennung die Numstat-Einträge, alles NUL-getrennt:
//   Raw:     ":100644 100644 aaa bbb M" NUL pfad NUL                (R/C: zwei Pfade, alt dann neu)
//   Numstat: "plus TAB minus TAB pfad" NUL                          (Umbenennung: "plus TAB minus TAB" NUL alt NUL neu NUL; Binärdatei: „-“)
// Pfade werden nie geraten: Nach einem Info-Eintrag steht fest, wie viele Pfad-Teile folgen (Tabs, „->“, Zeilenumbrüche im Namen sind egal).
// Merges und leere Commits haben keine Einträge.
function zerlegeLog(roh) {
  const teile = roh.split("\0");
  const commits = [];
  let akt = null;
  for (let i = 0; i < teile.length; i++) {
    let t = teile[i];
    if (t.startsWith("\x1e")) {
      const f = t.slice(1).split("\x1f");
      akt = { sha: f[0], kurz: f[1], eltern: (f[2] || "").split(" ").filter(Boolean), zeit: f[3] || "", autor: f[4] || "",
        nachricht: f.slice(5).join("\x1f"), eintraege: [], zahlen: new Map() };
      commits.push(akt);
      continue;
    }
    if (!akt) continue;
    if (t.startsWith("\n")) t = t.slice(1);
    let m = ROH_EINTRAG.exec(t);
    if (m) {
      const zwei = m[1] === "R" || m[1] === "C"; // Umbenennung/Kopie: alter und neuer Pfad
      const erster = teile[++i] ?? "", zweiter = zwei ? (teile[++i] ?? "") : null;
      akt.eintraege.push({ code: m[1].toUpperCase(), von: zwei ? erster : undefined, pfad: zwei ? zweiter : erster });
      continue;
    }
    m = ZAHLEN_EINTRAG.exec(t);
    if (m) {
      let von, pfad = m[3];
      if (pfad === "") { von = teile[++i] ?? ""; pfad = teile[++i] ?? ""; }
      akt.zahlen.set(von === undefined ? pfad : `${von}\0${pfad}`, { plus: m[1] === "-" ? 0 : Number(m[1]), minus: m[2] === "-" ? 0 : Number(m[2]) });
    }
  }
  return commits;
}

function baueCommit(c) {
  const merge = c.eltern.length >= 2; // bei Merges keine Dateien (egal, was Git geliefert hätte)
  const dateien = [];
  let plus = 0, geaendert = 0, geloescht = 0, zeilenPlus = 0, zeilenMinus = 0, versteckt = 0, gesamt = 0;
  if (!merge) {
    for (const e of c.eintraege) {
      const z = c.zahlen.get(e.von === undefined ? e.pfad : `${e.von}\0${e.pfad}`) || { plus: 0, minus: 0 };
      let status = e.code === "R" ? "R" : e.code === "A" || e.code === "C" ? "A" : e.code === "D" ? "D" : "M"; // C zählt als A, T und Rest als M
      let pfad = e.pfad, von = e.von;
      if (status === "R") {
        const neuGesperrt = istGesperrt(e.pfad), altGesperrt = istGesperrt(e.von);
        if (neuGesperrt && altGesperrt) { versteckt++; continue; }
        // Nur eine Seite gesperrt: die gesperrte Seite wird nie genannt — von außen ist die Datei neu (A) bzw. verschwunden (D),
        // genau wie `git show <sha> -- <pfad>` sie zeigen würde; die gesperrte Seite zählt zusätzlich als versteckt.
        if (neuGesperrt || altGesperrt) { versteckt++; status = neuGesperrt ? "D" : "A"; pfad = neuGesperrt ? e.von : e.pfad; von = undefined; }
      } else if (istGesperrt(pfad)) { versteckt++; continue; }
      if (status === "A") plus++; else if (status === "D") geloescht++; else geaendert++;
      zeilenPlus += z.plus; zeilenMinus += z.minus; gesamt++;
      if (dateien.length < DATEIEN_JE_COMMIT) dateien.push({ pfad, status, ...(von !== undefined ? { von } : {}), plus: z.plus, minus: z.minus });
    }
  }
  return { sha: c.sha, kurz: c.kurz, nachricht: c.nachricht, zeit: c.zeit, autor: c.autor, plus, geaendert, geloescht, zeilenPlus, zeilenMinus,
    merge, dateien, dateienGesamt: gesamt, versteckt };
}

// Commits des ganzen Repos nach Berliner Tagen gruppiert, neueste zuerst (Reihenfolge wie `git log`), seitenweise.
// vor = sha: geliefert werden die Commits NACH diesem in der Reihenfolge von `git rev-list HEAD` (Position + 1 als --skip, nicht
// über vor^ — wegen Merges). HEAD wird einmal aufgelöst und für beide Aufrufe benutzt, damit ein Commit zwischendurch nichts verschiebt.
export async function log(wurzel, { max, vor } = {}, ctx = {}) {
  const G = binde(wurzel, ctx);
  await brauchtRepo(G, wurzel);
  const n = Math.min(LOG_OBERGRENZE, Math.max(1, Number.parseInt(max, 10) || LOG_STANDARD));
  const hatVor = vor !== undefined && vor !== null && vor !== "";
  if (hatVor) pruefeSha(vor);
  if (!(await hatCommits(G))) return { tage: [], weitere: false, naechste: null };
  const k = await G(["rev-parse", "--verify", "-q", "HEAD^{commit}"]);
  if (k.code !== 0) return { tage: [], weitere: false, naechste: null };
  const kopf = k.stdout.trim();

  let ueberspringen = 0;
  if (hatVor) {
    const unbekannt = () => new HttpFehler(404, "Diese Version gibt es nicht.");
    const a = await G(["rev-parse", "--verify", "-q", `${vor}^{commit}`]);
    const voll = a.code === 0 ? a.stdout.trim() : "";
    // Ein Zweig- oder Tag-Name, der zufällig wie eine Hex-Zahl aussieht, ist keine Versionsnummer.
    if (!voll || !voll.startsWith(vor.toLowerCase())) throw unbekannt();
    const alle = await G(["rev-list", kopf]);
    if (alle.code !== 0) throw new HttpFehler(500, "Der Verlauf war nicht lesbar.", { ausgabe: ausgabeVon(alle) });
    const pos = alle.stdout.split("\n").indexOf(voll);
    if (pos < 0) throw unbekannt(); // gibt es, gehört aber nicht zum Verlauf dieses Zweigs
    ueberspringen = pos + 1;
  }

  const r = await G(["log", "-z", "--raw", "--numstat", "-M", "--root", "--no-color", "--no-show-signature", "--encoding=UTF-8", ...OHNE_EXTERN,
    `--skip=${ueberspringen}`, `--max-count=${n + 1}`, `--format=${LOG_FORMAT}`, kopf, "--"]);
  if (r.code !== 0) throw new HttpFehler(500, "Der Verlauf war nicht lesbar.", { ausgabe: ausgabeVon(r) });
  const commits = zerlegeLog(r.stdout);
  const weitere = commits.length > n;
  const seite = commits.slice(0, n);

  const tage = [];
  for (const c of seite) {
    const d = new Date(c.zeit);
    const gueltig = !Number.isNaN(d.getTime());
    const datum = gueltig ? berlinHeute(d) : "0000-00-00";
    let tag = tage[tage.length - 1];
    if (!tag || tag.datum !== datum) { tag = { datum, beschriftung: gueltig ? TAG_NAME.format(d) : "Ohne Datum", commits: [] }; tage.push(tag); }
    tag.commits.push(baueCommit(c));
  }
  return { tage, weitere, naechste: weitere && seite.length ? seite[seite.length - 1].sha : null };
}

// ── Remote hinzufügen mit Historien-Prüfung ──────────────────────────────────────────────────────────────────────────
const TEMP_REF = "refs/brain-studio/remote-pruefung"; // nur für die Prüfung; wird immer wieder gelöscht
const zeigeUrl = (u) => String(u || "").replace(/^([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/@]*@/, "$1"); // Zugangsdaten nie anzeigen

// Zeitüberschreitungen bekommen eine Alltagsmeldung (extra.freundlich: kein zweites Mal überschreiben).
const zeitFehler = (e, meldung) => (e instanceof HttpFehler && e.status === 504 ? new HttpFehler(504, meldung, { freundlich: true }) : e);
const LESEN_ZU_LANGE = "Der Server hat nicht rechtzeitig geantwortet. Es wurde nichts verändert — bitte später noch einmal versuchen.";
const gitFehler = (r, standard) => { const u = uebersetzeGitFehler(r.stderr, standard); return new HttpFehler(u.status, u.meldung, { ausgabe: ausgabeVon(r) }); };
function sendenFehler(r) {
  const u = uebersetzeGitFehler(r.stderr, "");
  if (u.meldung) return new HttpFehler(u.status, u.meldung, { ausgabe: ausgabeVon(r) });
  if (/rejected|non-fast-forward|fetch first|declined|denied|protected branch|hook/i.test(String(r.stderr || ""))) {
    return new HttpFehler(409, "Der Server hat das Senden abgelehnt (dort gibt es inzwischen Neues, oder eine Regel verbietet es). Es wurde nichts überschrieben und nichts eingetragen.", { ausgabe: ausgabeVon(r) });
  }
  return new HttpFehler(502, "Das Senden zum Server hat nicht geklappt. Es wurde nichts eingetragen.", { ausgabe: ausgabeVon(r) });
}

// → { zweige: Map(name → sha), haupt: Name des Hauptzweigs (Symref von HEAD) | null }; leere Map = leeres Repository.
async function remoteZweige(G, url, limit) {
  let r;
  try { r = await G(["ls-remote", "--symref", "--", url, "HEAD", "refs/heads/*"], { timeout: limit }); }
  catch (e) { throw zeitFehler(e, LESEN_ZU_LANGE); }
  if (r.code !== 0) throw gitFehler(r, "Der Server war nicht erreichbar.");
  const zweige = new Map();
  let haupt = null;
  for (const zeile of r.stdout.split("\n")) {
    let m = /^ref: refs\/heads\/(.+)\tHEAD$/.exec(zeile);
    if (m) { haupt = m[1]; continue; }
    m = /^([0-9a-f]{40,64})\trefs\/heads\/(.+)$/.exec(zeile);
    if (m) zweige.set(m[2], m[1]);
  }
  return { zweige, haupt };
}

// Gesamtfrist 120 s (opt.limit überschreibt — nur für Tests); jeder Git-Aufruf bekommt nur das Restbudget (lesen höchstens 60 s, senden 120 s).
export function remoteHinzufuegen(wurzel, url, opt = {}) { return exklusiv(wurzel, () => remoteHinzufuegenOhneSperre(wurzel, url, opt || {})); }

async function remoteHinzufuegenOhneSperre(wurzel, rohUrl, opt) {
  const frist = opt.frist || neueFrist(opt.limit > 0 ? opt.limit : LIMIT_REMOTE);
  const G = binde(wurzel, kontext(opt, frist));
  const Gh = (args, extra) => G(args, { ohneHooks: true, ...extra }); // Holen und Zusammenführen bringen fremde Commits (auch Hooks): ohne Hooks, wie im Abgleich
  await brauchtRepo(G, wurzel);
  const url = pruefeGitUrl(rohUrl);
  const limit = LIMIT, limitSenden = LIMIT_SYNC; // je Aufruf; gekappt durch das Restbudget der Frist
  const z = await zweig(G);
  if (z === "(losgelöst)") throw new HttpFehler(400, "Du bist auf keinem Zweig — bitte zuerst einen Zweig wählen.");

  // b) Schon ein Remote? Nur „origin mit derselben Adresse“ geht weiter (idempotent), alles andere ist ein Konflikt.
  let originSchonDa = false;
  const vorhandene = await remotes(G);
  if (vorhandene.length) {
    const name = vorhandene.includes("origin") ? "origin" : vorhandene[0];
    const u = await G(["config", "--get", `remote.${name}.url`]);
    const alt = u.code === 0 ? u.stdout.trim() : "";
    if (name !== "origin" || alt !== url) {
      throw new HttpFehler(409, `Es ist schon ein Remote eingetragen (${name}: ${zeigeUrl(alt) || "ohne Adresse"}). Dieser Vault verbindet sich mit genau einem Server — ` +
        "entferne das vorhandene Remote zuerst in Git, wenn du wechseln möchtest.", { remote: name, url: zeigeUrl(alt) });
    }
    originSchonDa = true;
  }

  // Origin wird erst gesetzt, wenn alle Prüfungen bestanden sind; schlägt danach etwas fehl, wird es zurückgenommen (nur, wenn wir es gesetzt haben).
  let neuGesetzt = false;
  const setzeOrigin = async () => {
    if (originSchonDa || neuGesetzt) return;
    const a = await G(["remote", "add", "origin", url]);
    if (a.code !== 0) throw new HttpFehler(500, "Das Remote konnte nicht eingetragen werden.", { ausgabe: ausgabeVon(a) });
    neuGesetzt = true;
  };
  const zuruecknehmen = async () => {
    if (!neuGesetzt) return;
    neuGesetzt = false;
    try { await G(["remote", "remove", "origin"], rueckweg); } catch { /* nichts mehr zu tun */ }
  };
  const tempLoeschen = async () => { try { await G(["update-ref", "-d", TEMP_REF], rueckweg); } catch { /* war ohnehin nicht da */ } };

  try {
    // c) Was liegt auf dem Server? (nur lesend)
    const { zweige, haupt } = await remoteZweige(G, url, limit);
    const serverLeer = zweige.size === 0;
    const hat = await hatCommits(G);

    const senden = async () => { // nie --force: ein abgelehntes Senden lässt den Server unverändert
      let p;
      try { p = await G(["push", "--quiet", "-u", "origin", `refs/heads/${z}:refs/heads/${z}`], { timeout: limitSenden }); }
      catch (e) { throw zeitFehler(e, "Das Senden hat zu lange gebraucht und wurde abgebrochen. Es wurde nichts eingetragen — bitte später noch einmal versuchen."); }
      if (p.code !== 0) throw sendenFehler(p);
    };
    const sendenMitRueckweg = async () => { try { await senden(); } catch (e) { await zuruecknehmen(); throw e; } };
    const fertig = async (ergebnis, nochHolen = true) => {
      if (nochHolen) { try { await Gh(["fetch", "--quiet", "--no-recurse-submodules", "origin"], { timeout: limit }); } catch { /* nur Komfort: damit origin/* existiert */ } }
      return { ok: true, ergebnis, remote: "origin", zweig: z, letzterSync: merkeSync(wurzel) };
    };

    // d) Lokal noch kein Commit
    if (!hat) {
      if (!serverLeer) throw new HttpFehler(409, "Dein Vault hat noch keinen Commit, das Repository enthält schon Inhalte. Lege zuerst einen Commit an.");
      await setzeOrigin();
      return await fertig("verbunden");
    }

    // e) Server leer → alles senden
    if (serverLeer) {
      await setzeOrigin();
      await sendenMitRueckweg();
      return await fertig("gesendet");
    }

    // f) Server hat Inhalte: Historien vergleichen. Zielzweig = gleichnamiger Zweig, sonst Hauptzweig des Servers, sonst der erste.
    const ziel = zweige.has(z) ? z : haupt && zweige.has(haupt) ? haupt : [...zweige.keys()][0];
    await tempLoeschen(); // Rest eines früheren Abbruchs
    try {
      let f;
      // „+“ gilt nur für unseren privaten Prüf-Ref (kein Senden, kein Force-Push)
      try { f = await Gh(["fetch", "--no-tags", "--quiet", "--no-recurse-submodules", "--", url, `+refs/heads/${ziel}:${TEMP_REF}`], { timeout: limit }); }
      catch (e) { throw zeitFehler(e, LESEN_ZU_LANGE); }
      if (f.code !== 0) throw gitFehler(f, "Der Server war nicht erreichbar.");
      const s = await G(["rev-parse", "--verify", "-q", `${TEMP_REF}^{commit}`]);
      const l = await G(["rev-parse", "--verify", "-q", "HEAD^{commit}"]);
      if (s.code !== 0 || l.code !== 0) throw new HttpFehler(502, "Der Server hat keinen lesbaren Stand geliefert.");
      const spitze = s.stdout.trim(), lokal = l.stdout.trim();
      const istVorfahr = async (a, b) => {
        const r = await G(["merge-base", "--is-ancestor", a, b]);
        if (r.code === 0) return true;
        if (r.code === 1) return false;
        throw new HttpFehler(500, "Die beiden Historien ließen sich nicht vergleichen.", { ausgabe: ausgabeVon(r) });
      };

      // Server ist gleich oder älter → senden (setzt notfalls nur den Upstream)
      if (await istVorfahr(spitze, lokal)) {
        await setzeOrigin();
        await sendenMitRueckweg();
        return await fertig(spitze === lokal && ziel === z ? "verbunden" : "gesendet");
      }

      // Wir sind älter → vorspulen (der Arbeitsstand muss nicht sauber sein, aber das Vorspulen muss gehen)
      if (await istVorfahr(lokal, spitze)) {
        if (ziel !== z) {
          throw new HttpFehler(409, `Das Repository hat schon Inhalte, aber unter dem Zweig „${ziel}“, dein Vault arbeitet auf „${z}“. ` +
            "Die Namen passen nicht zusammen — benenne in Git einen der beiden Zweige um und versuche es dann noch einmal.", { art: "zweigname", server: ziel, lokal: z });
        }
        const m = await mitAbbruchSchutz(G, wurzel, () => Gh(["merge", "--ff-only", "--quiet", TEMP_REF], { timeout: limitSenden }));
        if (m.code !== 0) throw new HttpFehler(409, "Ungesicherte Änderungen stehen im Weg. Bitte zuerst committen (oder sichern) und es dann noch einmal versuchen. Es wurde nichts verändert.", { ausgabe: ausgabeVon(m) });
        await setzeOrigin();
        let geholt = false;
        try { geholt = (await Gh(["fetch", "--quiet", "--no-recurse-submodules", "origin"], { timeout: limit })).code === 0; } catch { /* unten: Verfolgungs-Ref selbst anlegen */ }
        if (!geholt) await Gh(["update-ref", `refs/remotes/origin/${z}`, spitze]); // der Stand ist gerade geprüft worden
        const u = await Gh(["branch", "--set-upstream-to", `origin/${z}`]);
        if (u.code !== 0) throw new HttpFehler(500, "Der Server wurde verbunden, aber der Abgleich-Zweig konnte nicht eingetragen werden.", { ausgabe: ausgabeVon(u) });
        return await fertig("geholt", false);
      }

      // Beide haben Eigenes: verwandt (gemeinsamer Vorfahr) oder fremd?
      const mb = await G(["merge-base", lokal, spitze]);
      if (mb.code === 0 && mb.stdout.trim()) {
        throw new HttpFehler(409, "Die Historien sind verwandt, aber auseinandergelaufen. Dieses Repository und dein Vault haben denselben Ursprung, doch beide haben seitdem Neues. " +
          "Führe sie zuerst in Git zusammen und verbinde danach noch einmal. Es wurde nichts verändert.", { art: "auseinander" });
      }
      if (mb.code !== 1) throw new HttpFehler(500, "Die beiden Historien ließen sich nicht vergleichen.", { ausgabe: ausgabeVon(mb) });
      throw new HttpFehler(409, "Dieses Repository hat eine andere Geschichte. Es hat mit deinem Vault nichts gemeinsam und gehört vermutlich zu einem anderen Projekt. " +
        "Prüfe die Adresse. Es wurde nichts verändert.", { art: "fremd" });
    } finally {
      await tempLoeschen(); // immer aufräumen, auch bei Fehlern
    }
  } catch (e) {
    // Abgelaufene Frist an irgendeiner Stelle: nichts bleibt halb eingetragen (origin zurück), klare Meldung.
    if (e instanceof HttpFehler && e.status === 504) {
      await zuruecknehmen();
      if (e.extra && e.extra.freundlich) throw e;
      const s = Math.round(frist.ms / 1000);
      throw new HttpFehler(504, `Das Verbinden hat zu lange gebraucht (nach ${s} Sekunden abgebrochen). Es wurde nichts eingetragen — bitte später noch einmal versuchen.`, { freundlich: true });
    }
    throw e;
  }
}
