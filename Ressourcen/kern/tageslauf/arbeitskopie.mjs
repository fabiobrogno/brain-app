// .tools/tageslauf/arbeitskopie.mjs — Schritt 6/7, Git-Teil (Spec §5.2): Arbeitskopie per `git worktree` AUSSERHALB des Vaults
// (~/Library/Caches/brain-tageslauf/<lauf>, Branch tageslauf/<lauf> von main), ein Commit je Auftrag mit normalem pre-commit
// (nie --no-verify; rot → Auftrag verworfen, Arbeitskopie zurückgesetzt), Übernehmen nur per `merge --ff-only` auf main,
// ist main weitergelaufen: einmal rebasen und neu versuchen, sonst Abbruch ohne Schaden. Commits als „Brain-Tageslauf".
// Probemodus: uebernehmen(…, { probe: true }) merged nie. Testhaken: BRAIN_TAGESLAUF_CACHE (Ordner der Arbeitskopien).
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, readFileSync, writeFileSync, unlinkSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir, tmpdir } from "node:os";
import { gitBefehl } from "../werkzeug.mjs";
import { ladeConfig } from "../pfade.mjs";
import { wendeAuftragAn } from "./schreiben.mjs";

export const AUTOR = { name: "Brain-Tageslauf", email: "tageslauf-noreply@brain.invalid" };   // „noreply“: bleibt für die Publish-Prüfung (EMAIL) unauffällig
const INGEST_SPERRE_MIN = 30;
const ohneGit = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));

export function cacheOrdner({ home = homedir(), plattform = process.platform } = {}) {
  if (process.env.BRAIN_TAGESLAUF_CACHE) return process.env.BRAIN_TAGESLAUF_CACHE;
  return plattform === "darwin" ? join(home, "Library", "Caches", "brain-tageslauf") : join(tmpdir(), "brain-tageslauf");
}
export function git(vault, cwd, args) {
  return execFileSync(gitBefehl({ cfg: ladeConfig(vault) }), ["-C", cwd, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true, maxBuffer: 64 * 1024 * 1024,
    env: { ...ohneGit(), GIT_AUTHOR_NAME: AUTOR.name, GIT_AUTHOR_EMAIL: AUTOR.email, GIT_COMMITTER_NAME: AUTOR.name, GIT_COMMITTER_EMAIL: AUTOR.email },
  }).trim();
}

export function legeArbeitskopieAn(vault, lauf, opt = {}) {
  const basis = cacheOrdner(opt);
  mkdirSync(basis, { recursive: true });
  const kopie = { pfad: join(basis, lauf), branch: `tageslauf/${lauf}` };
  git(vault, vault, ["worktree", "add", "-q", "-b", kopie.branch, kopie.pfad, "main"]);
  return kopie;
}
export function verwerfeArbeitskopie(vault, kopie) {
  try { git(vault, vault, ["worktree", "remove", "--force", kopie.pfad]); }
  catch { try { rmSync(kopie.pfad, { recursive: true, force: true }); } catch {} try { git(vault, vault, ["worktree", "prune"]); } catch {} }
  try { git(vault, vault, ["branch", "-D", kopie.branch]); } catch {}
}
// Reste abgebrochener Läufe (Absturz, Strom weg): alle tageslauf/*-Branches samt Arbeitskopie außer `ausser`.
export function raeumeResteAuf(vault, { ausser = null, ...opt } = {}) {
  let branches = [];
  try { branches = git(vault, vault, ["for-each-ref", "--format=%(refname:short)", "refs/heads/tageslauf/"]).split("\n").filter(Boolean); } catch {}
  const weg = branches.filter((b) => b !== ausser);
  for (const b of weg) verwerfeArbeitskopie(vault, { pfad: join(cacheOrdner(opt), b.slice("tageslauf/".length)), branch: b });
  try { git(vault, vault, ["worktree", "prune"]); } catch {}
  return weg.length;
}

function zuruecksetzen(vault, kopie) {
  try { git(vault, kopie.pfad, ["reset", "-q", "--hard", "HEAD"]); } catch {}
  try { git(vault, kopie.pfad, ["clean", "-qfd"]); } catch {}
}
export function commitAuftrag(vault, kopie, auftrag, { lauf, jetzt = Date.now() }) {
  let r;
  try { r = wendeAuftragAn(kopie.pfad, auftrag, { lauf, jetzt }); }
  catch (e) { zuruecksetzen(vault, kopie); return { ok: false, grund: e.grund || "schreiben-fehlgeschlagen", befund: "" }; }
  const id = auftrag.v?.id || auftrag.ref || "-";
  try {
    git(vault, kopie.pfad, ["add", "--", ...r.dateien]);
    git(vault, kopie.pfad, ["commit", "-q", "-m", `auto(${lauf}): ${r.titel.slice(0, 60)} → ${auftrag.seite.split("/").pop()} [${id}]`]);
    return { ok: true, commit: git(vault, kopie.pfad, ["rev-parse", "HEAD"]), beleg: r.beleg };
  } catch (e) {
    const aus = `${e.stdout || ""}\n${e.stderr || ""}`;
    const befund = aus.split("\n").map((z) => z.trim()).filter((z) => /^- |blockiert|SECRETS|REV|LOG|FAKT-BELEG/.test(z)).slice(0, 5).join(" | ").slice(0, 400);
    zuruecksetzen(vault, kopie);
    return { ok: false, grund: "pruefung-rot", befund: befund || "pre-commit rot" };
  }
}

// Zusatz zum Plan: optionales { probe } — im Probemodus wird NIE gemerged (Verteidigung in der Tiefe, der Orchestrator ruft es dort gar nicht erst auf).
export function uebernehmen(vault, kopie, { probe = false } = {}) {
  if (probe) return { ok: false, grund: "probe" };
  let kopf = "";
  try { kopf = git(vault, vault, ["symbolic-ref", "--short", "HEAD"]); } catch {}
  if (kopf !== "main") return { ok: false, grund: "vault-nicht-auf-main" };
  const n = Number(git(vault, vault, ["rev-list", "--count", `main..${kopie.branch}`]));
  if (!n) return { ok: true, commits: 0 };
  const versuch = () => { try { git(vault, vault, ["merge", "-q", "--ff-only", kopie.branch]); return true; } catch { return false; } };
  if (versuch()) return { ok: true, commits: n };
  let vorfahr = true;
  try { git(vault, vault, ["merge-base", "--is-ancestor", "main", kopie.branch]); } catch { vorfahr = false; }
  if (vorfahr) return { ok: false, grund: "lokale-aenderung" };
  try { git(vault, kopie.pfad, ["rebase", "-q", "main"]); }
  catch { try { git(vault, kopie.pfad, ["rebase", "--abort"]); } catch {} return { ok: false, grund: "konflikt" }; }
  return versuch() ? { ok: true, commits: n } : { ok: false, grund: "lokale-aenderung" };
}

// Betreff eines Übernahme-Commits: auto(<lauf>): <titel> → <seite> [<id>] — Gruppe 1 = Lauf-Nummer, Gruppe 2 = Vorschlags-/Auftrags-ID (siehe commitAuftrag).
export const BETREFF_MUSTER = /^auto\(([^)]+)\): .* \[([^\]]+)\]$/;

// Nach dem Merge (auch nach Rebase): Vorschlags-/Rückfrage-ID → Commit-Hash in main, aus den Commit-Betreffs des Laufs.
export function commitsDesLaufs(vault, lauf, n) {
  const m = new Map();
  if (!n) return m;
  for (const z of git(vault, vault, ["log", `-n${n}`, "--format=%H%x09%s", "main"]).split("\n")) {
    const [h, s = ""] = z.split("\t");
    const t = s.match(BETREFF_MUSTER);
    if (t && t[1] === lauf) m.set(t[2], h);
  }
  return m;
}

// Dieselbe Sperre wie `brain lock` (.logs/ingest.lock, frisch < 30 min): kein Schreiben, während /ingest arbeitet.
const pidLebt = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
export function nimmIngestSperre(vault) {
  const f = join(vault, ".logs", "ingest.lock");
  const ich = `tageslauf ${process.pid}\n`;
  try { mkdirSync(dirname(f), { recursive: true }); } catch { return false; }
  try { writeFileSync(f, ich, { flag: "wx" }); return true; } catch (e) { if (e.code !== "EEXIST") return false; }
  // Trägt die Sperre eine PID („tageslauf 123“, „ingest 123“) und der Prozess läuft nicht mehr, ist sie veraltet — auch vor Ablauf der 30 min.
  // (`brain lock` schreibt nur einen Zeitstempel: dort gilt allein das Alter.)
  let pid = NaN;
  try { pid = Number(/^[A-Za-z][\w-]*\s+(\d+)\s*$/m.exec(readFileSync(f, "utf8"))?.[1]); } catch {}
  const tot = Number.isInteger(pid) && pid > 0 && !pidLebt(pid);
  if (!tot) { try { if (Date.now() - statSync(f).mtimeMs < INGEST_SPERRE_MIN * 60000) return false; } catch {} }
  try { writeFileSync(f, ich); return true; } catch { return false; }
}
export function gibIngestSperreFrei(vault) {
  const f = join(vault, ".logs", "ingest.lock");
  try { if (readFileSync(f, "utf8") === `tageslauf ${process.pid}\n`) unlinkSync(f); } catch {}
}
