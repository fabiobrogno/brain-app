// gemeinsam/git.mjs — Git-Aufrufe für Studio (Spec §5): immer execFile (keine Shell), Pfade nach `--`,
// GIT_TERMINAL_PROMPT=0, Zeitlimits (60 s, Sync 120 s), nie --force, nie -A.
import { execFile } from "node:child_process";
import { realpathSync, readFileSync, writeFileSync, statSync, renameSync } from "node:fs";
import { join } from "node:path";
import { HttpFehler, sauber } from "./basis.mjs";

const LIMIT = 60_000, LIMIT_SYNC = 120_000;
const REPO_GEBUNDEN = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR", "GIT_PREFIX", "GIT_NAMESPACE", "GIT_QUARANTINE_PATH"];

function umgebung() {
  const e = { ...process.env };
  for (const k of REPO_GEBUNDEN) delete e[k]; // laufen wir in einem Hook, darf kein fremdes Repo durchschlagen
  e.GIT_TERMINAL_PROMPT = "0";
  e.LC_ALL = "C";
  if (!e.GIT_SSH_COMMAND) e.GIT_SSH_COMMAND = "ssh -o BatchMode=yes"; // nie nach Passwort fragen
  return e;
}

// → {code, stdout, stderr}; wirft nur bei Zeitüberschreitung oder wenn git fehlt.
export function git(cwd, args, { timeout = LIMIT, buffer = false } = {}) {
  return new Promise((aufloesen, ablehnen) => {
    execFile("git", ["-c", "core.quotepath=false", ...args],
      { cwd, env: umgebung(), timeout, maxBuffer: 64 * 1024 * 1024, encoding: buffer ? "buffer" : "utf8", killSignal: "SIGKILL" },
      (err, stdout, stderr) => {
        if (err && err.killed) return ablehnen(new HttpFehler(504, "Git hat zu lange gebraucht und wurde abgebrochen."));
        if (err && err.code === "ENOENT") return ablehnen(new HttpFehler(500, "Git ist auf diesem Mac nicht installiert."));
        aufloesen({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr: String(stderr || "") });
      });
  });
}

const kuerze = (s, n = 4000) => (s.length > n ? s.slice(0, n) + "\n… (gekürzt)" : s);
const ausgabeVon = (r) => kuerze((String(r.stdout || "") + String(r.stderr || "")).trim());

// Ist der Vault selbst die Wurzel eines Git-Repos?
export async function istRepo(wurzel) {
  try {
    const r = await git(wurzel, ["rev-parse", "--show-toplevel"]);
    return r.code === 0 && realpathSync(r.stdout.trim()) === wurzel;
  } catch (e) { if (e instanceof HttpFehler && e.status === 500) return false; throw e; }
}
async function brauchtRepo(wurzel) {
  if (!(await istRepo(wurzel))) throw new HttpFehler(400, "Dieser Ordner ist (noch) kein Git-Repository.");
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

async function zweig(wurzel) {
  const r = await git(wurzel, ["symbolic-ref", "--short", "-q", "HEAD"]);
  return r.code === 0 ? r.stdout.trim() : "(losgelöst)";
}
async function hatCommits(wurzel) { return (await git(wurzel, ["rev-parse", "--verify", "-q", "HEAD"])).code === 0; }
async function upstreamVon(wurzel) {
  const r = await git(wurzel, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  return r.code === 0 ? r.stdout.trim() : null;
}
async function vorZurueck(wurzel) {
  const r = await git(wurzel, ["rev-list", "--left-right", "--count", "HEAD...@{u}"]);
  if (r.code !== 0) return { vor: 0, zurueck: 0 };
  const [vor, zurueck] = r.stdout.trim().split(/\s+/).map(Number);
  return { vor: vor || 0, zurueck: zurueck || 0 };
}
async function remotes(wurzel) {
  const r = await git(wurzel, ["remote"]);
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
async function geaendert(wurzel) {
  const r = await git(wurzel, ["status", "--porcelain=v1", "-z", "-uall", "--no-renames"]);
  if (r.code !== 0) throw new HttpFehler(500, "Git-Status war nicht lesbar.");
  return parseStatus(r.stdout);
}

export async function status(wurzel) {
  if (!(await istRepo(wurzel))) {
    return { repo: false, zweig: null, upstream: null, vor: 0, zurueck: 0, geaendert: [], letzterCommit: null, letzterSync: null, remote: false };
  }
  const [z, up, ge, rem, hat] = await Promise.all([zweig(wurzel), upstreamVon(wurzel), geaendert(wurzel), remotes(wurzel), hatCommits(wurzel)]);
  const zaehl = up ? await vorZurueck(wurzel) : { vor: 0, zurueck: 0 };
  let letzterCommit = null;
  if (hat) {
    const r = await git(wurzel, ["log", "-1", "--format=%H%x1f%h%x1f%s%x1f%cI"]);
    if (r.code === 0) { const [sha, kurz, nachricht, zeit] = r.stdout.trim().split("\x1f"); letzterCommit = { sha, kurz, nachricht, zeit }; }
  }
  return { repo: true, zweig: z, upstream: up, vor: zaehl.vor, zurueck: zaehl.zurueck, geaendert: ge, letzterCommit,
    letzterSync: letzterSync(wurzel), remote: rem.length > 0 };
}

export async function commit(wurzel, { nachricht, dateien }) {
  await brauchtRepo(wurzel);
  if (typeof nachricht !== "string" || !nachricht.trim()) throw new HttpFehler(400, "Bitte eine Commit-Nachricht eingeben.");
  if (!Array.isArray(dateien) || !dateien.length || dateien.some((d) => typeof d !== "string")) throw new HttpFehler(400, "Bitte mindestens eine Datei auswählen.");
  const offen = new Set((await geaendert(wurzel)).map((e) => e.pfad));
  const pfade = [...new Set(dateien)];
  for (const p of pfade) {
    // erlaubt ist nur, was Git selbst als geändert meldet — dazu kein .git und keine ..-Segmente
    if (p.split("/").some((s) => s === ".." || s === ".git") || p.startsWith("/")) throw new HttpFehler(403, "Dieser Pfad ist gesperrt.");
    if (!offen.has(p)) throw new HttpFehler(400, `„${p}“ hat keine offenen Änderungen.`);
  }
  const a = await git(wurzel, ["add", "--", ...pfade]);
  if (a.code !== 0) throw new HttpFehler(422, "Die Dateien konnten nicht vorgemerkt werden.", { ausgabe: ausgabeVon(a) });
  // --only + Pfade: committet genau diese Dateien, auch wenn sonst etwas vorgemerkt wäre
  const c = await git(wurzel, ["commit", "-m", nachricht, "--only", "--", ...pfade]);
  if (c.code !== 0) {
    await git(wurzel, ["reset", "-q", "--", ...pfade]); // Vormerkung zurücknehmen: alles bleibt wie vorher
    throw new HttpFehler(422, "Der Commit wurde abgelehnt. Die Meldung steht unten.", { ausgabe: ausgabeVon(c) });
  }
  const h = await git(wurzel, ["rev-parse", "HEAD"]);
  return { sha: h.stdout.trim() };
}

async function konfliktDateien(wurzel) {
  const r = await git(wurzel, ["diff", "--name-only", "--diff-filter=U"]);
  return r.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
}

export async function sync(wurzel) {
  await brauchtRepo(wurzel);
  const rem = await remotes(wurzel);
  if (!rem.length) throw new HttpFehler(400, "Es ist noch kein Remote (Server) eingetragen. Trage zuerst eins in Git ein.");
  const remote = rem.includes("origin") ? "origin" : rem[0];
  const f = await git(wurzel, ["fetch", "--quiet", remote], { timeout: LIMIT_SYNC });
  if (f.code !== 0) throw new HttpFehler(502, "Der Server war nicht erreichbar.", { ausgabe: ausgabeVon(f) });
  if (!(await hatCommits(wurzel))) throw new HttpFehler(400, "Es gibt noch keinen Commit zum Abgleichen.");
  const z = await zweig(wurzel);
  if (z === "(losgelöst)") throw new HttpFehler(400, "Du bist auf keinem Zweig — bitte zuerst einen Zweig wählen.");

  let up = await upstreamVon(wurzel);
  let neuerZweig = false;
  if (!up) {
    const gibts = await git(wurzel, ["rev-parse", "--verify", "-q", `refs/remotes/${remote}/${z}`]);
    if (gibts.code === 0) { await git(wurzel, ["branch", "--set-upstream-to", `${remote}/${z}`]); up = `${remote}/${z}`; }
    else neuerZweig = true;
  }

  let geholt = false, gesendet = false;
  if (up) {
    const { zurueck } = await vorZurueck(wurzel);
    if (zurueck > 0) {
      geholt = true;
      let m = await git(wurzel, ["merge", "--ff-only", "--quiet", "@{u}"], { timeout: LIMIT_SYNC });
      if (m.code !== 0) m = await git(wurzel, ["merge", "--no-edit", "--quiet", "@{u}"], { timeout: LIMIT_SYNC });
      if (m.code !== 0) {
        const dateien = await konfliktDateien(wurzel);
        await git(wurzel, ["merge", "--abort"]); // Arbeitsstand wie vorher
        if (dateien.length) throw new HttpFehler(409, "Beim Zusammenführen gibt es Konflikte. Es wurde nichts verändert — bitte die Stellen mit einer Vertrauensperson oder in Git klären.", { dateien });
        throw new HttpFehler(409, "Ungesicherte Änderungen stehen im Weg. Bitte zuerst committen, dann abgleichen.", { dateien: [], ausgabe: ausgabeVon(m) });
      }
    }
    const nach = await vorZurueck(wurzel);
    if (nach.vor > 0) {
      const p = await git(wurzel, ["push", "--quiet"], { timeout: LIMIT_SYNC });
      if (p.code !== 0) throw new HttpFehler(409, "Der Server hat das Senden abgelehnt (es gab dort inzwischen Neues). Bitte noch einmal abgleichen.", { dateien: [], ausgabe: ausgabeVon(p) });
      gesendet = true;
    }
  } else if (neuerZweig) {
    const p = await git(wurzel, ["push", "--quiet", "-u", remote, z], { timeout: LIMIT_SYNC });
    if (p.code !== 0) throw new HttpFehler(409, "Der Server hat das Senden abgelehnt.", { dateien: [], ausgabe: ausgabeVon(p) });
    gesendet = true;
  }
  const ergebnis = geholt && gesendet ? "beides" : geholt ? "geholt" : gesendet ? "gesendet" : "aktuell";
  return { ergebnis, letzterSync: merkeSync(wurzel) };
}

const SHA = /^[0-9a-f]{4,64}$/i;
const pruefeSha = (sha) => { if (typeof sha !== "string" || !SHA.test(sha)) throw new HttpFehler(400, "Ungültige Versionsnummer."); return sha; };
const gitPfad = (rel) => sauber(rel).join("/");

export async function verlauf(wurzel, rel, max) {
  await brauchtRepo(wurzel);
  const p = gitPfad(rel);
  const n = Math.min(500, Math.max(1, Number.parseInt(max, 10) || 50));
  if (!(await hatCommits(wurzel))) return { eintraege: [] };
  const r = await git(wurzel, ["log", "--follow", `--max-count=${n}`, "--format=%H%x1f%h%x1f%an%x1f%cI%x1f%s%x1e", "--", p]);
  if (r.code !== 0) return { eintraege: [] };
  const eintraege = r.stdout.split("\x1e").map((s) => s.replace(/^\n/, "")).filter(Boolean).map((z) => {
    const [sha, kurz, autor, zeit, nachricht] = z.split("\x1f");
    return { sha, kurz, autor, zeit, nachricht };
  });
  return { eintraege };
}

export async function diff(wurzel, rel, sha) {
  await brauchtRepo(wurzel);
  const p = gitPfad(rel);
  const MAX = 400_000;
  let r;
  if (sha) {
    r = await git(wurzel, ["show", "--format=", "--no-color", pruefeSha(sha), "--", p]);
    if (r.code !== 0) throw new HttpFehler(404, "Diese Version gibt es nicht.");
  } else {
    const verfolgt = (await git(wurzel, ["ls-files", "--error-unmatch", "--", p])).code === 0;
    if (verfolgt && (await hatCommits(wurzel))) r = await git(wurzel, ["diff", "--no-color", "HEAD", "--", p]);
    else r = await git(wurzel, ["diff", "--no-color", "--no-index", "--", "/dev/null", p]); // neu: Exit 1 ist normal
  }
  return { diff: r.stdout.length > MAX ? r.stdout.slice(0, MAX) + "\n… (gekürzt)\n" : r.stdout };
}

export async function fassung(wurzel, rel, sha) {
  await brauchtRepo(wurzel);
  const p = gitPfad(rel);
  const r = await git(wurzel, ["show", `${pruefeSha(sha)}:${p}`], { buffer: true });
  if (r.code !== 0) throw new HttpFehler(404, "Diese Fassung gibt es nicht.");
  if (r.stdout.length > 5 * 1024 * 1024) throw new HttpFehler(413, "Die Datei ist zu groß.");
  const text = r.stdout.toString("utf8");
  if (Buffer.compare(Buffer.from(text, "utf8"), r.stdout) !== 0) throw new HttpFehler(415, "Diese Fassung ist kein lesbarer Text.");
  return { inhalt: text };
}
