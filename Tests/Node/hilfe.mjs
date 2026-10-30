// Hilfen für die Node-Tests: Wegwerf-Vaults und Git-Repos in os.tmpdir().
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const WURZEL = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "Ressourcen");
export const pfad = (...t) => join(WURZEL, ...t);
const aufraeumen = [];
// Tests nie gegen echte Nutzerdaten: eigener Support-Ordner (Vertrauens-Merker), Test-Schalter an.
process.env.BRAIN_TESTMODUS = "1";
// Workspace-Trust (P5): die Wegwerf-Vaults der Suite gelten als vertraut (sonst bliebe Git gesperrt). Die Tests der Sperre (vertrauen*.test.mjs) entfernen die Variable.
process.env.KORTEX_VAULT_VERTRAUT = "alle";
process.env.BRAIN_APP_SUPPORT = realpathSync(mkdtempSync(join(tmpdir(), "brain-support-")));
aufraeumen.push(process.env.BRAIN_APP_SUPPORT);
process.on("exit", () => { for (const d of aufraeumen) try { rmSync(d, { recursive: true, force: true }); } catch { /* egal */ } });

// Führt fn ohne den Testschalter KORTEX_VAULT_VERTRAUT aus: es gilt die echte Vertrauensprüfung (Workspace-Trust, P5). Für Tests, die „nicht vertraut“ brauchen.
// Der Schalter hängt an process.env und wäre sonst nach einer Zeitüberschreitung des Tests (node:test bricht fn nicht ab) im nächsten Test gelöscht oder
// später wieder gesetzt. Der Timer bleibt absichtlich referenziert (kein unref): sonst läuft die Event-Loop leer, bevor er feuert, wenn der Test auf ein nie aufgelöstes Promise wartet. Darum stellt echt() ihn selbst nach spätestens `zeit` ms wieder her (und nie ein zweites Mal): ein hängender Test lässt den
// Schalter nicht in den Folgetest durchschlagen, und ein Nachzügler überschreibt nichts.
export async function echt(fn, { zeit = 45_000 } = {}) {
  const alt = process.env.KORTEX_VAULT_VERTRAUT;
  delete process.env.KORTEX_VAULT_VERTRAUT;
  let zurueck = false, uhr;
  const stelleHer = () => { if (zurueck) return; zurueck = true; clearTimeout(uhr); if (alt !== undefined) process.env.KORTEX_VAULT_VERTRAUT = alt; };
  const frist = new Promise((_, nein) => { uhr = setTimeout(() => { stelleHer(); nein(new Error(`echt(): Zeitüberschreitung nach ${zeit} ms — der Testschalter ist wiederhergestellt`)); }, zeit); });
  try { return await Promise.race([Promise.resolve().then(fn), frist]); } finally { stelleHer(); }
}

export function tmp(praefix = "brain-test-") {
  const d = realpathSync(mkdtempSync(join(tmpdir(), praefix)));
  aufraeumen.push(d);
  return d;
}
export function schreibe(wurzel, rel, inhalt) {
  const p = join(wurzel, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, inhalt);
  return p;
}
const GIT_ENV = () => { const e = { ...process.env }; for (const k of Object.keys(e)) if (k.startsWith("GIT_")) delete e[k];
  return { ...e, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.org", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.org" }; };
export const g = (cwd, ...args) => execFileSync("git", args, { cwd, env: GIT_ENV(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// Attrappen-Kern (Kern-Umzug P4): ein Ordner mit den Dateien des gebündelten Kerns, die die Werkstatt benutzt (brain.mjs, rueckfragen.mjs,
// VERSION). Übergeben wird er als `kern` (oeffneVault/erzeugeHandler) bzw. als KORTEX_KERN_PFAD (Kindprozesse). Der Vault trägt nur Daten.
export function kernAttrappe(dateien = {}) {
  const k = tmp("brain-kern-");
  for (const [rel, inhalt] of Object.entries(dateien)) schreibe(k, rel, inhalt);
  return k;
}
// Macht einen Ordner zu einem Vault im Sinne des Kerns (brain.config.json).
export function brainVault(d) { schreibe(d, "brain.config.json", "{}\n"); return d; }

// Wegwerf-Repo auf Zweig main mit Startdatei und einem Commit.
export function repo(praefix = "brain-git-") {
  const d = tmp(praefix);
  g(d, "init", "-q", "-b", "main");
  g(d, "config", "user.name", "T"); g(d, "config", "user.email", "t@example.org");
  schreibe(d, "start.md", "# Start\n");
  g(d, "add", "--", "start.md"); g(d, "commit", "-q", "-m", "Start");
  return d;
}
