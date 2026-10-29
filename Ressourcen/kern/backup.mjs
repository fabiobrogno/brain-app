// backup.mjs — Sicherung: github (push) | ordner (git bundle, 7 behalten) | keins. Alltagssprache, nie Abbruch im Alltag.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync, lstatSync, rmSync, writeFileSync, readFileSync, mkdirSync, realpathSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { ladeConfig, supportOrdner } from "./pfade.mjs";
import { gitBefehl } from "./werkzeug.mjs";
const git = (v, ...a) => execFileSync(gitBefehl({ cfg: ladeConfig(v) }), ["-C", v, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

// Der Sicherungsordner steht NICHT in der brain.config.json des Vaults (Vault-Daten dürfen nicht bestimmen, wohin der Kern schreibt), sondern je
// Vault im Support-Ordner der App: <Support>/backup/<Kennung des Vaults>.json = { "pfad": "<absoluter Ordner>" }. Gesetzt wird er nur von
// `brain backup einrichten ordner:<pfad>` (Kern/App). Ein „pfad“ in der Vault-Config (ältere Vaults) zählt nicht mehr — neu einrichten.
const kennung = (vault) => { let e = vault; try { e = realpathSync(vault); } catch {} return createHash("sha256").update(e).digest("hex").slice(0, 16); };
const backupDatei = (vault) => join(supportOrdner(), "backup", `${kennung(vault)}.json`);
// Absolut, ein Ordner (falls schon vorhanden), kein Verweis. → Fehlertext oder null
export function pruefeBackupPfad(p) {
  if (typeof p !== "string" || !p || p.includes("\0") || !isAbsolute(p)) return "Der Sicherungsordner muss ein absoluter Pfad sein.";
  let st = null;
  try { st = lstatSync(p); } catch { /* noch nicht da (Stick abgezogen) ist erlaubt */ }
  if (st && st.isSymbolicLink()) return "Der Sicherungsordner darf kein Verweis (Symlink) sein.";
  if (st && !st.isDirectory()) return "Der Sicherungsordner ist kein Ordner.";
  return null;
}
// → absoluter Pfad oder null (nicht eingerichtet / ungültig)
export function leseBackupOrdner(vault) {
  try {
    const p = JSON.parse(readFileSync(backupDatei(vault), "utf8")).pfad;
    return pruefeBackupPfad(p) ? null : p;
  } catch { return null; }
}
// Datum nach Ortszeit (wie der Kalender des Nutzers), nicht UTC — gilt für den Dateinamen und die „heute schon gesichert“-Prüfung des Sitzungsstarts
export function ortstag(h = new Date()) { return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-${String(h.getDate()).padStart(2, "0")}`; }

export function einrichten(vault, wahl) {
  const cfg = ladeConfig(vault);
  const ordnerPfad = wahl.startsWith("ordner:") ? wahl.slice(7) : null;
  if (ordnerPfad !== null) {
    const fehler = pruefeBackupPfad(ordnerPfad);
    if (fehler) throw new Error(fehler);
  }
  cfg.backup = wahl === "github" ? { art: "github" } : ordnerPfad !== null ? { art: "ordner" } : { art: "keins" };
  try {
    if (ordnerPfad !== null) { mkdirSync(join(supportOrdner(), "backup"), { recursive: true }); writeFileSync(backupDatei(vault), JSON.stringify({ pfad: ordnerPfad }) + "\n"); }
    else rmSync(backupDatei(vault), { force: true });
  } catch (e) { throw new Error(`Der Sicherungsordner konnte nicht gemerkt werden (${e && e.code ? e.code : "Fehler"}).`); }
  writeFileSync(join(vault, "brain.config.json"), JSON.stringify(cfg, null, 2) + "\n");
  // Config-Änderung sofort sichern (wie bei systemVersion im Skill update) — per Pfadangabe NUR diese
  // Datei stagen und committen, damit andere bereits gestagte (fremde) Änderungen unangetastet bleiben.
  try {
    // Ohne git-Identität (frischer Rechner, wiederhergestellter Vault) scheiterte der Commit sonst still —
    // gleicher Rückfall wie in install.mjs, nur für diesen Vault.
    try { git(vault, "config", "user.email"); } catch { git(vault, "config", "user.email", "brain@localhost"); git(vault, "config", "user.name", "Second Brain"); }
    git(vault, "add", "--", "brain.config.json");
    git(vault, "commit", "-q", "-m", "brain: Sicherung eingerichtet", "--", "brain.config.json");
  } catch {}
  return ordnerPfad !== null ? { ...cfg.backup, pfad: ordnerPfad } : cfg.backup;
}

// Wie viele Notizen sind noch nicht eingearbeitet (uncommitted/untracked) — die Sicherung sichert nur den
// committeten Stand, also müssen wir sagen, was dabei fehlt, statt es still zu verschweigen.
function nichtEingearbeitet(vault) {
  try {
    const out = execFileSync(gitBefehl({ cfg: ladeConfig(vault) }), ["-C", vault, "status", "--porcelain"], { encoding: "utf8", windowsHide: true });
    const n = out.split("\n").filter(Boolean).length;
    return n > 0 ? ` Achtung: ${n} Notiz(en) sind noch nicht eingearbeitet und deshalb nicht in der Sicherung — sag ‚arbeite meine Notizen ein‘.` : "";
  } catch { return ""; }
}

export function sichern(vault) {
  let b = ladeConfig(vault).backup;
  // Ohne backup-Eintrag, aber mit eingerichtetem Git-Remote: pushen wie bisher (gleiche Rückfall-Regel wie
  // im Sitzungsstart — ältere Vaults vor dieser Sicherungs-Funktion sichern unverändert weiter).
  if (!b) { let remote = ""; try { remote = git(vault, "remote").trim(); } catch {} b = remote ? { art: "github" } : { art: "keins" }; }
  if (b.art === "keins") return "Keine Sicherung eingerichtet. Sag „richte mir eine Sicherung ein“, wenn du eine möchtest.";
  const hinweis = nichtEingearbeitet(vault);
  if (b.art === "github") { try { git(vault, "push", "-q"); return "Online gesichert." + hinweis; } catch { return "Online-Sicherung hat gerade nicht geklappt (kein Internet?). Ich versuche es beim nächsten Mal wieder."; } }
  // Der Ordner kommt aus dem Support-Ordner (nie aus der Vault-Config) und wird vor jedem Gebrauch neu geprüft
  const ziel = leseBackupOrdner(vault);
  if (!ziel) return "Für diesen Vault ist kein gültiger Sicherungsordner eingerichtet (absoluter Ordner, kein Verweis). Sag „richte mir eine Sicherung ein“ oder: brain backup einrichten ordner:<Ordner>.";
  if (!existsSync(ziel)) return "Der Sicherungsordner ist gerade nicht da (Stick oder Platte nicht angeschlossen?). Ich sichere beim nächsten Mal.";
  const datei = join(ziel, `brain-${ortstag()}.bundle`);
  git(vault, "bundle", "create", datei, "--all");
  const alle = readdirSync(ziel).filter(f => /^brain-.*\.bundle$/.test(f)).sort((x, y) => statSync(join(ziel, y)).mtimeMs - statSync(join(ziel, x)).mtimeMs);
  for (const alt of alle.slice(7)) rmSync(join(ziel, alt));
  return `Gesichert in ${ziel}.` + hinweis;
}

export function wiederherstellen(quelle, ziel) {
  let nichtLeer = false;
  try { nichtLeer = existsSync(ziel) && readdirSync(ziel).length > 0; } catch { nichtLeer = true; }
  if (nichtLeer) return { ok: false, text: `Der Zielordner ${ziel} ist nicht leer — ich stelle nur in einen leeren oder neuen Ordner wieder her.` };
  try {
    execFileSync(gitBefehl(), ["clone", "-q", quelle, ziel], { stdio: "ignore", windowsHide: true });
    return { ok: true, text: `Wiederhergestellt nach ${ziel}.` };
  } catch {
    return { ok: false, text: "Wiederherstellen hat nicht geklappt — ist die Sicherungsdatei bzw. die Adresse richtig?" };
  }
}
