// umstellung/git-lage.mjs — Befund über den Versionsverlauf eines Vaults (Paket P7a). NUR LESEN, und nie ein Programm aus dem Vault starten.
//
// Der Kern selbst startet git nur über git-sicher, das genau die Vaults sperrt, die dieser Befund beschreiben soll. Darum liest der Befund mit dem
// echten git von festen Orten (wie git-sicher), ohne Umgebung des Nutzers (kein GIT_DIR/GIT_CONFIG_*), ohne fsmonitor, ohne Hooks, ohne Index-Schreiben
// (--no-optional-locks) und nur mit Unterbefehlen, die keine Filter- oder Diff-Treiber starten (config, ls-files). `status` läuft erst, wenn die Prüfung
// der Erlaubnisliste (git-sicher-pruefung.pl --alle) keinen Schlüssel beanstandet hat — dann gibt es keinen Filter-Treiber, der laufen könnte.
//
// Datenschutz: Schlüssel*namen* ja, Werte nie. Werte werden nur intern gelesen, um zu klassifizieren (lokale Adresse? alter Hook-Ordner?), und verlassen
// dieses Modul nicht. Unterabschnitte von Schlüsseln können Adressen mit Zugangsdaten enthalten (url.<adresse>.insteadOf): ausgegeben wird nur die Form
// `abschnitt.*.variable`.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve, isAbsolute, sep } from "node:path";
import { homedir } from "node:os";
import { KERN } from "../pfade.mjs";

const TESTMODUS = (env) => env.KORTEX_KERN_UNSTABIL_ERLAUBT === "1" || env.BRAIN_TESTMODUS === "1";

// Feste Orte wie in git-sicher; BRAIN_GIT_PROGRAMM nur in der Testumgebung.
export function echtesGit(env = process.env) {
  if (TESTMODUS(env) && typeof env.BRAIN_GIT_PROGRAMM === "string" && isAbsolute(env.BRAIN_GIT_PROGRAMM) && existsSync(env.BRAIN_GIT_PROGRAMM)) return env.BRAIN_GIT_PROGRAMM;
  for (const g of ["/opt/homebrew/bin/git", "/usr/local/bin/git", "/usr/bin/git"]) if (existsSync(g)) return g;
  return null;
}

const saubereUmgebung = (home) => ({
  PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: home, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", GIT_NO_LAZY_FETCH: "1", GIT_CONFIG_NOSYSTEM: "1",
});
const HAERTUNG = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "protocol.ext.allow=never", "-c", "submodule.recurse=false",
  "-c", "diff.ignoreSubmodules=all", "-c", "status.submoduleSummary=false", "--no-optional-locks"];

// → Ausgabe als Text oder null (Fehler, Zeit, kein git). Nur für lesende Unterbefehle benutzen.
export function gitLesen(git, ordner, args, { home = homedir(), timeout = 20_000 } = {}) {
  if (!git) return null;
  try {
    return execFileSync(git, ["-C", ordner, ...HAERTUNG, ...args], { encoding: "utf8", env: saubereUmgebung(home), timeout, maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  } catch { return null; }
}

// Lokale Konfiguration des Repos: [{ schluessel, wert }] (Werte nur intern). null = nicht lesbar.
export function lokaleKonfiguration(git, vault, opt = {}) {
  const roh = gitLesen(git, vault, ["config", "--local", "--list", "-z"], opt);
  if (roh === null) return null;
  const teile = roh.split("\0");
  if (teile.length && teile[teile.length - 1] === "") teile.pop();
  return teile.map((e) => { const i = e.indexOf("\n"); return i < 0 ? { schluessel: e, wert: null } : { schluessel: e.slice(0, i), wert: e.slice(i + 1) }; });
}
export const werte = (konfig, schluessel) => (konfig || []).filter((e) => e.schluessel.toLowerCase() === schluessel.toLowerCase()).map((e) => e.wert);

// Wie git-sicher-pruefung.pl den Namen ausgibt: nur druckbares ASCII, höchstens 120 Zeichen.
const alsPrueflistenName = (s) => s.replace(/[^\x20-\x7e]/g, "?").slice(0, 120);

// Die Prüfung der Erlaubnisliste im Modus --alle → { ok, namen: [Schlüsselnamen], nichtPruefbar }. Die Umgebung ist die der Produktion (keine Testschalter),
// damit auch lokale Remote-Adressen als verboten gelten.
export function pruefungAlle(git, vault, { home = homedir(), perl = "/usr/bin/perl" } = {}) {
  const skript = join(KERN, "git-sicher-pruefung.pl");
  if (!git || !existsSync(perl) || !existsSync(skript)) return { ok: false, namen: [], nichtPruefbar: true };
  const r = spawnSync(perl, [skript, git, vault, "--alle"], { encoding: "utf8", env: saubereUmgebung(home), timeout: 30_000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
  if (r.error || r.status === null) return { ok: false, namen: [], nichtPruefbar: true };
  const namen = String(r.stdout || "").split("\n").filter((z) => z.startsWith("REFUSE\t")).map((z) => z.slice(7));
  if (r.status === 0) return { ok: true, namen: [], nichtPruefbar: false };
  // „(git config --list schlug fehl)“ und „(unerwartete Ausgabe …)“ sind Meldungen, keine Schlüssel
  const meldung = namen.some((n) => n.startsWith("("));
  return { ok: false, namen: namen.filter((n) => !n.startsWith("(")), nichtPruefbar: meldung && namen.every((n) => n.startsWith("(")) };
}

// Form eines Schlüssels ohne Unterabschnitt: `credential.https://host.helper` → `credential.*.helper`
export function formSchluessel(name) {
  const n = String(name).toLowerCase();
  const erster = n.indexOf("."), letzter = n.lastIndexOf(".");
  if (erster < 0) return n;
  if (erster === letzter) return n;
  return `${n.slice(0, erster)}.*.${n.slice(letzter + 1)}`;
}

// --- Einordnung der verbotenen Schlüssel (Plan P7 Abschnitt 3.3) -------------------------------------------------------------
//  strukturell: gehört zum Aufbau des Repositories, lässt sich nicht in die Konfiguration des Nutzers verschieben
//  repo-wert:   remote.*/branch.*-Schlüssel mit einem unzulässigen Wert (kein Schlüssel des Nutzers)
//  verschiebbar: alles übrige (Vorlieben und Programme des Nutzers, auch Schlüssel der Erlaubnisliste mit unzulässigem Wert)
const STRUKTUR = [/^core\.(worktree|bare)$/, /^extensions\./, /^remote\.\*\.(promisor|partialclonefilter)$/, /^submodule\./];
const REPO_WERT = [/^remote\.\*\.(?:url|pushurl|fetch)$/, /^branch\.\*\.(?:remote|pushremote|merge|rebase|description|vscode-merge-base)$/];
export function ordneSchluesselEin(formen) {
  const aus = { verschiebbar: [], strukturell: [], repoWert: [] };
  for (const f of formen) {
    if (STRUKTUR.some((m) => m.test(f))) aus.strukturell.push(f);
    else if (REPO_WERT.some((m) => m.test(f))) aus.repoWert.push(f);
    else aus.verschiebbar.push(f);
  }
  return aus;
}
export const zaehleFormen = (namen) => {
  const z = new Map();
  for (const n of namen) { const f = formSchluessel(n); z.set(f, (z.get(f) || 0) + 1); }
  return z;
};

// --- Adressen -----------------------------------------------------------------------------------------------------------------
export function adressArt(url) {
  const u = String(url || "");
  if (!u) return "keine";
  if (/^https:\/\//i.test(u)) return "https";
  if (/^ssh:\/\//i.test(u) || /^[A-Za-z0-9_][A-Za-z0-9_.-]*@[A-Za-z0-9[][A-Za-z0-9_.:\]-]*:\S*$/.test(u)) return "ssh";
  if (/^file:/i.test(u) || /^[/.~]/.test(u) || /^[A-Za-z]:[\\/]/.test(u)) return "lokal";
  return "andere";
}
export function lokaleRemotes(konfig) {
  return (konfig || []).filter((e) => /^remote\..+\.(url|pushurl)$/i.test(e.schluessel) && adressArt(e.wert) === "lokal").map((e) => alsPrueflistenName(e.schluessel));
}

// --- core.hooksPath -----------------------------------------------------------------------------------------------------------
// → "keiner" | "kortex" | "kit-alt" | "fremd" und die Schreibweise („relativ“/„absolut“) des alten Kit-Eintrags. Die relative Form des Kits (ein Kit-Ordner im
// Vault mit /git-hooks) kennt install-git-hooks.mjs#istKortex nicht und meldet sie als fremd (Exit 4): der Befund erkennt sie richtig (Lücke wird in P7b geschlossen).
export function hooksPfadArt(wert, vault, kitOrdner, support = null) {
  const w = String(wert || "").split("\\").join("/").replace(/\/+$/, "");
  if (!w) return { art: "keiner" };
  const s = support ? String(support).split("\\").join("/").replace(/\/+$/, "") : null;
  if (s && (w === `${s}/bin/kern/git-hooks` || new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/kern/[^/]+/git-hooks$`).test(w))) return { art: "kortex" };
  if (/\/Application Support\/(?:Kortex|Brain)\/(?:bin\/kern|kern\/[^/]+)\/git-hooks$/.test(w)) return { art: "kortex" };
  const v = String(vault).split("\\").join("/").replace(/\/+$/, "");
  if (w === `${kitOrdner}/git-hooks`) return { art: "kit-alt", form: "relativ" };
  if (w === `${v}/${kitOrdner}/git-hooks` || w.endsWith(`/${kitOrdner}/git-hooks`)) return { art: "kit-alt", form: "absolut" };
  return { art: "fremd" };
}

// --- Git-Verzeichnis (nur Dateisystem, kein git) --------------------------------------------------------------------------------
// → { art: "ordner"|"datei"|"keins"|"verweis", gitdir (aufgelöst oder null), draussen, alternates, verweise: [Namen], eigeneHooks: n }
export function gitVerzeichnis(vault) {
  const punktGit = join(vault, ".git");
  let st;
  try { st = lstatSync(punktGit); } catch { return { art: "keins", gitdir: null, draussen: false, alternates: false, verweise: [], eigeneHooks: 0 }; }
  const echterVault = (() => { try { return realpathSync(vault); } catch { return resolve(vault); } })();
  let gitdir = punktGit, art = "ordner";
  if (st.isSymbolicLink()) { art = "verweis"; }
  else if (st.isFile()) {
    art = "datei";
    let z = "";
    try { z = readFileSync(punktGit, "utf8").split("\n")[0]; } catch { /* unlesbar */ }
    const m = /^gitdir:\s*(.+?)\s*$/.exec(z);
    gitdir = m ? resolve(vault, m[1]) : null;
  }
  let echt = null;
  if (gitdir) { try { echt = realpathSync(gitdir); } catch { echt = gitdir; } }
  const draussen = art === "verweis" || !echt || !(echt === echterVault || echt.startsWith(echterVault + sep));
  const verweise = [];
  let eigeneHooks = 0, alternates = false;
  if (echt && !draussen) {
    alternates = existsSync(join(echt, "objects", "info", "alternates"));
    let zaehler = 0;
    const lauf = (dir, rel) => {
      let namen;
      try { namen = readdirSync(dir); } catch { return; }
      for (const n of namen) {
        if (++zaehler > 100_000) return;
        const r = rel ? `${rel}/${n}` : n;
        // Objektinhalte und Hook-Dateien werden wie in git-sicher übersprungen
        if (/^objects\/[0-9a-f]{2}$/.test(r) || r === "objects/pack" || r === "hooks") continue;
        const p = join(dir, n);
        let s;
        try { s = lstatSync(p); } catch { continue; }
        if (s.isSymbolicLink()) { verweise.push(r); continue; }
        if (s.isDirectory()) lauf(p, r);
      }
    };
    lauf(echt, "");
    try { eigeneHooks = readdirSync(join(echt, "hooks")).filter((n) => !n.endsWith(".sample")).length; } catch { /* kein hooks-Ordner */ }
  }
  return { art, gitdir: echt, draussen, alternates, verweise, eigeneHooks };
}
