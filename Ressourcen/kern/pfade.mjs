// pfade.mjs — einzige Stelle, die weiß, wo der Kern liegt, wo der Vault liegt und wie seine Ordner heißen.
//
// Zwei getrennte Orte (Kern-Umzug P2, docs/plaene/kern-umzug.md):
//   KERN  = der Ordner DIESER Datei (Code und gebündelte Daten, im App-Bundle bzw. unter Support/Kortex/kern). Nur lesen.
//   VAULT = der Datenordner des Nutzers. Dort liegen Wissen, brain.config.json und alle Laufzeitdaten (.logs/ …).
// Der Vault wird NIE aus dem Ort des Kerns abgeleitet und es gibt keinen Rückfall auf einen festen Ordner (auch nicht den Vault des Entwicklers).
import { readFileSync, existsSync, realpathSync, statSync, lstatSync } from "node:fs";
import { join, dirname, resolve, delimiter, isAbsolute, sep } from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { registriereVault, registrierteVaults } from "./vault-schutz.mjs";
import { vertrauensStand, alleVertraut } from "./vertrauen.mjs";

export const KERN = dirname(fileURLToPath(import.meta.url));

// Kern-Version = App-Version. Die EINE Lesestelle ist die Datei VERSION im Kern-Ordner (status.mjs, brain.mjs `version`,
// wirkung.mjs, ansicht/bruecke.mjs und ansicht/dienst-lib.mjs lesen über kernVersion()). Der App-Bau schreibt dort die
// CFBundleShortVersionString hinein (Paket P3); bis dahin steht der Stand des importierten Kits darin.
export function kernVersion() {
  try { return readFileSync(join(KERN, "VERSION"), "utf8").trim() || "?"; } catch { return "?"; }
}

// Einzige erlaubte Nennung des alten Kit-Ordners im Vault (Erkennung/Migration, Schutz vor Schreibzugriffen der KI-Pflege
// auf noch nicht umgestellte Vaults). Der Lint-Test (Tests/Kern/test-keine-altpfade.mjs) erlaubt das Literal nur in dieser Datei.
export const ALT_KIT_ORDNER = ".tools";

// ---------------------------------------------------------------------------------------------------------------------
// App-Daten (Support-Ordner) und Vaultliste

const plattformBasis = (home, env, plattform) => {
  if (plattform === "darwin") return join(home, "Library", "Application Support");
  if (plattform === "win32") return env.APPDATA || join(home, "AppData", "Roaming");
  return env.XDG_DATA_HOME || join(home, ".local", "share");
};
// Support-Ordner der App in Suchreihenfolge: BRAIN_APP_SUPPORT (nur absolut; Tests/Rauchtests) allein, sonst …/Kortex und als Rückfall
// …/Brain (alter Name bis zum Umzug, Paket P3). Es wird nie verschoben, nur gelesen.
export function supportOrte({ home = homedir(), env = process.env, plattform = process.platform } = {}) {
  const vorgabe = env.BRAIN_APP_SUPPORT;
  if (typeof vorgabe === "string" && isAbsolute(vorgabe)) return [vorgabe];
  const basis = plattformBasis(home, env, plattform);
  return [join(basis, "Kortex"), join(basis, "Brain")];
}
// Der Ordner für neue App-weite Daten (Kortex; mit BRAIN_APP_SUPPORT dieser).
export function supportOrdner(opt = {}) { return supportOrte(opt)[0]; }
// Orte der App-weiten Werkzeuge (qmd unter bin/, privates Node/git/gh): zuerst der Support-Ordner, als Lese-Rückfall der alte Ort ~/.brain-kit.
export function kitOrte({ home = homedir(), env = process.env, plattform = process.platform } = {}) {
  return [supportOrdner({ home, env, plattform }), join(home, ".brain-kit")];
}

// Fragen für Messlatte, Karten-Tor und Lint-Ziel. Gebündelt (KERN): kit/vorlage-eval.json mit Platzhalter-Fragen. Nutzerdaten (VAULT):
// .logs/hint-eval.json — eigene Fragen ersetzen die Platzhalter, sobald die Datei existiert (nie im Repo); der Holdout liegt in .logs/holdout.json.
// BRAIN_EVAL_DATEI überschreibt (Tests).
export function evalFragenDatei(vault, { env = process.env } = {}) {
  if (env.BRAIN_EVAL_DATEI) return env.BRAIN_EVAL_DATEI;
  const eigene = join(vault, ".logs", "hint-eval.json");
  return existsSync(eigene) ? eigene : join(KERN, "kit", "vorlage-eval.json");
}
export function holdoutDatei(vault) { return join(vault, ".logs", "holdout.json"); }

// ---------------------------------------------------------------------------------------------------------------------
// Vault prüfen und aus der Vaultliste der App lesen

export class KeinVaultFehler extends Error {
  constructor(grund = null) {
    super(grund || "Kein Vault gefunden. Gib ihn mit --vault <pfad> an, setze BRAIN_VAULT oder wähle in der Kortex-App einen aktiven Vault.");
    this.name = "KeinVaultFehler";
    this.code = "KEIN_VAULT";
  }
}

// Ein Vault ist ein EXISTIERENDER Ordner (Symlinks werden aufgelöst) mit brain.config.json. Die Marke ist die Minimalbedingung, die jeder von
// Kortex angelegte Vault erfüllt; ohne sie würden Hooks und Werkzeuge in einem verwaisten oder falsch eingetragenen Pfad AGENTS.md, graph.json und
// .logs/ anlegen (Geister-Vault). → aufgelöster absoluter Pfad (lexikalisch, nicht realpath) oder KeinVaultFehler.
export function pruefeVault(pfad) {
  if (typeof pfad !== "string" || !pfad.trim() || pfad.includes("\0")) throw new KeinVaultFehler("Vault nicht gefunden: kein gültiger Pfad.");
  const p = resolve(pfad);
  let echt;
  try { echt = realpathSync(p); } catch { throw new KeinVaultFehler(`Vault nicht gefunden: ${p}`); }
  let istOrdner = false;
  try { istOrdner = statSync(echt).isDirectory(); } catch { /* fehlt */ }
  if (!istOrdner) throw new KeinVaultFehler(`Vault nicht gefunden: ${p} ist kein Ordner.`);
  if (!existsSync(join(echt, "brain.config.json"))) throw new KeinVaultFehler(`Das ist kein Kortex-Vault: in ${p} fehlt brain.config.json.`);
  zieleImVault(echt);
  registriereVault(p, echt); // ab jetzt bleiben alle Schreibzugriffe unter diesem Vault im Vault (vault-schutz.mjs)
  return p;
}

// --- vaults.json (Leseregel aus Ressourcen/gemeinsam/vaults.mjs, die auch VaultListe.swift befolgt) ---------------------
// Zustand der Datei je Support-Ordner: fehlt · defekt (nicht lesbar, kein JSON-Objekt, "vaults" da, aber kein Array) · ok. Ein Eintrag zählt, wenn er
// ein Objekt mit absolutem Text-"pfad" ohne NUL ist und die Ortsregeln ihn (geschrieben UND aufgelöst) erlauben; "aktiv" zählt nur, wenn es einen
// solchen Eintrag meint. Bei fehlt/defekt gilt der Vault der config.json DESSELBEN Ordners ({"vault": …}); eine defekte Datei fällt nie auf die
// Liste des nächsten Ordners (…/Brain) zurück. Zusätzlich verlangt der Kern wie überall pruefeVault (existiert, brain.config.json).
const falte = (s) => String(s).normalize("NFC").toLowerCase();
const teile = (p) => String(p).split(/[\\/]+/).filter(Boolean).map(falte);
const hatPraefix = (p, basis) => { const a = teile(p), b = teile(basis); return a.length >= b.length && b.every((x, i) => x === a[i]); };
const istGleich = (p, basis) => teile(p).length === teile(basis).length && hatPraefix(p, basis);
const istUnter = (p, basis) => teile(p).length > teile(basis).length && hatPraefix(p, basis);
const SYSTEM_PRAEFIXE = ["/System", "/bin", "/sbin", "/usr", "/etc", "/private/etc", "/dev", "/Library", "/Applications", "/cores", "/opt", "/private/var/db", "/var/db"];
const echterPfadOderSelbst = (p) => { try { return realpathSync(p); } catch { return p; } };

// Wahr, wenn die Ortsregeln den Pfad erlauben (Spiegel von pruefeRegeln in gemeinsam/vaults.mjs).
function ortErlaubt(p, home, support) {
  const segs = teile(p);
  if (!segs.length || (segs.length === 1 && (segs[0] === "users" || segs[0] === "volumes"))) return false;
  if (istGleich(p, home)) return false;
  for (const sp of SYSTEM_PRAEFIXE) if (hatPraefix(p, sp) || hatPraefix(sp, p)) return false;
  const lib = join(home, "Library");
  if (hatPraefix(p, lib) && !hatPraefix(p, join(lib, "Mobile Documents")) && !hatPraefix(p, join(lib, "CloudStorage"))) return false;
  if (hatPraefix(p, support)) return false;
  if (segs.includes(".git") || segs.includes("node_modules") || segs.some((x) => x.endsWith(".app"))) return false;
  if (istUnter(p, home)) {
    const rest = String(p).split(/[\\/]+/).filter(Boolean).slice(teile(home).length);
    if (rest.some((x) => x.startsWith("."))) return false;
  }
  return true;
}
function ortErlaubtBeide(p, home, support) {
  const lex = resolve(p);
  return ortErlaubt(lex, resolve(home), resolve(support))
    && ortErlaubt(echterPfadOderSelbst(lex), echterPfadOderSelbst(resolve(home)), echterPfadOderSelbst(resolve(support)));
}

function leseListeDatei(ordner) {
  let text;
  try { text = readFileSync(join(ordner, "vaults.json"), "utf8"); }
  catch (e) { return { zustand: e && (e.code === "ENOENT" || e.code === "ENOTDIR") ? "fehlt" : "defekt" }; }
  let wurzel;
  try { wurzel = JSON.parse(text); } catch { return { zustand: "defekt" }; }
  if (!wurzel || typeof wurzel !== "object" || Array.isArray(wurzel) || (wurzel.vaults !== undefined && !Array.isArray(wurzel.vaults))) return { zustand: "defekt" };
  return { zustand: "ok", wurzel };
}
function aktivAusListe(wurzel, home, support) {
  if (typeof wurzel.aktiv !== "string" || wurzel.aktiv.includes("\0") || !isAbsolute(wurzel.aktiv)) return null;
  const gesucht = [resolve(wurzel.aktiv), echterPfadOderSelbst(resolve(wurzel.aktiv))].map(falte);
  for (const e of wurzel.vaults || []) {
    if (!e || typeof e !== "object" || typeof e.pfad !== "string" || e.pfad.includes("\0") || !isAbsolute(e.pfad)) continue;
    const lex = resolve(e.pfad);
    if (!ortErlaubtBeide(lex, home, support)) continue;
    const formen = [lex, echterPfadOderSelbst(lex)].map(falte);
    if (formen.some((f) => gesucht.includes(f))) return lex;
  }
  return null;
}
function altVaultAusConfig(ordner, home, support) {
  try {
    const c = JSON.parse(readFileSync(join(ordner, "config.json"), "utf8"));
    const v = c && typeof c.vault === "string" ? c.vault.trim() : "";
    if (!v || v.includes("\0") || !isAbsolute(v)) return null;
    return ortErlaubtBeide(v, home, support) ? resolve(v) : null;
  } catch { return null; }
}

// → absoluter Pfad des aktiven App-Vaults oder null. Nur gültige Vaults (pruefeVault) werden geliefert.
export function aktiverVaultAusListe(opt = {}) {
  const home = opt.home || homedir();
  let kandidat = null;
  for (const ordner of supportOrte(opt)) {
    const r = leseListeDatei(ordner);
    if (r.zustand === "ok") { kandidat = aktivAusListe(r.wurzel, home, ordner); break; }
    const alt = altVaultAusConfig(ordner, home, ordner);
    if (alt) { kandidat = alt; break; }
    if (r.zustand === "defekt") break;   // defekt: kein Rückfall auf die Liste des nächsten Ordners
  }
  if (!kandidat) return null;
  try { return pruefeVault(kandidat); } catch { return null; }
}

// ---------------------------------------------------------------------------------------------------------------------
// Workspace-Trust (P5): vertraut ist ein Vault, den Kortex angelegt oder geklont hat oder den der Nutzer im Studio bestätigt hat (vertrauen.mjs).
// Ohne Vertrauen: kein git, kein Hintergrunddienst, keine Hooks, keine KI-Pflege — Lesen, Suchen und Ansehen gehen.
export function vaultVertraut(vault, opt = {}) {
  const env = opt.env || process.env;
  if (alleVertraut(env)) return true;
  return vertrauensStand(vault, { support: typeof opt.support === "string" ? opt.support : supportOrdner(opt),
    arbeitsbaumWurzeln: tageslaufArbeitsbaumWurzeln(env) }).vertraut;
}
// Wo der Tageslauf die verknüpften Arbeitsbäume eines Vaults anlegt (tageslauf/arbeitskopie.mjs; dieselbe Ausnahme kennt git-sicher). Der Testhaken
// BRAIN_TAGESLAUF_CACHE gilt nur in der Testumgebung.
export function tageslaufArbeitsbaumWurzeln(env = process.env) {
  const w = [process.platform === "darwin" ? join(homedir(), "Library", "Caches", "brain-tageslauf") : join(tmpdir(), "brain-tageslauf")];
  if ((env.KORTEX_KERN_UNSTABIL_ERLAUBT === "1" || env.BRAIN_TESTMODUS === "1") && env.BRAIN_TAGESLAUF_CACHE && isAbsolute(env.BRAIN_TAGESLAUF_CACHE)) w.push(env.BRAIN_TAGESLAUF_CACHE);
  return w;
}
export const NICHT_VERTRAUT_TEXT = "Dieser Vault ist in Kortex noch nicht als deiner bestätigt, darum tut der Kern hier nichts, was am Vault etwas ändert (kein git, kein Hintergrunddienst, keine KI-Pflege, keine Hooks). Bestätige ihn im Studio; Lesen und Suchen gehen schon jetzt.";
// Werkzeug-Einstiege, die am Vault etwas bewirken: ohne Vertrauen Meldung auf stderr und Exit 5.
export function vertrauterVaultOderEnde(vault, opt = {}) {
  if (vaultVertraut(vault, opt)) return vault;
  console.error(NICHT_VERTRAUT_TEXT);
  process.exit(5);
}
// Alle Vaults, die dieser Prozess über pruefeVault geprüft hat, sind vertraut. Ohne geprüften Vault: nein (fail-closed) — außer in der Testumgebung.
export function geprueftVaultsVertraut(opt = {}) {
  if (alleVertraut(opt.env || process.env)) return true;
  const alle = registrierteVaults();
  return alle.length > 0 && alle.every((v) => vaultVertraut(v, opt));
}

// ---------------------------------------------------------------------------------------------------------------------
// Vault bestimmen

// --vault <pfad> bzw. --vault=<pfad> steht an beliebiger Stelle der Kommandozeile (bis zu einem „--“). Beim Laden dieses Moduls wird die Angabe aus
// process.argv genommen und gemerkt: alle Werkzeuge mit eigener Argumentauswertung (Befehl an Stelle 2, Flags, Positionen) sehen sie nie und müssen
// sie nicht kennen. Ein Wert, der mit „-“ beginnt oder fehlt, ist ungültig: die Argumente bleiben stehen und vaultPfad() meldet den Fehler.
function nimm(argv) {
  let wert = null, fehler = null;
  for (let i = 2; i < argv.length;) {
    const a = argv[i];
    if (a === "--") break;
    if (a === "--vault") {
      const w = argv[i + 1];
      if (typeof w !== "string" || w === "" || w.startsWith("-")) { fehler = "--vault braucht einen Ordnerpfad (er darf nicht mit „-“ beginnen)."; i++; continue; }
      wert = w; argv.splice(i, 2); continue;
    }
    if (typeof a === "string" && a.startsWith("--vault=")) {
      const w = a.slice(8);
      if (!w || w.startsWith("-")) { fehler = "--vault braucht einen Ordnerpfad (er darf nicht mit „-“ beginnen)."; i++; continue; }
      wert = w; argv.splice(i, 1); continue;
    }
    i++;
  }
  return { wert, fehler };
}
export function nimmVaultArg(argv) { return nimm(argv).wert; }
const ARG = nimm(process.argv);
// Der mit --vault ausdrücklich angegebene Pfad (ungeprüft) – nur für den Befund der Umstellung (umstellung/cli.mjs), der auch einen Vault beschreibt, den pruefeVault ablehnt.
export const angegebenerVaultPfad = () => ARG.wert;

// Reihenfolge: --vault > (Altform, wo ein Werkzeug sie kennt) erstes Positionsargument von `argv` > BRAIN_VAULT > aktiver Vault der App.
// Wurde ein Vault ANGEGEBEN (Flag, Argument, BRAIN_VAULT), gilt genau dieser: ist er kein gültiger Vault, gibt es einen Fehler und nie einen Ausweichen
// auf den aktiven Vault. Jeder Pfad kommt absolut (resolve) zurück. Es gibt bewusst keinen Rückfall auf einen festen Ordner oder den Ort des Kerns.
export function vaultPfad(argv = process.argv, { env = process.env, support } = {}) {
  const lokal = Array.isArray(argv) && argv !== process.argv ? nimm([...argv]) : { wert: null, fehler: null };
  const fehler = lokal.fehler || ARG.fehler;
  if (fehler) throw new KeinVaultFehler(fehler);
  const explizit = lokal.wert || ARG.wert;
  if (explizit) return pruefeVault(explizit);
  const positionell = Array.isArray(argv) ? argv.slice(2).find((x) => typeof x === "string" && x !== "" && !x.startsWith("--")) : null;
  if (positionell) return pruefeVault(positionell);
  if (typeof env.BRAIN_VAULT === "string" && env.BRAIN_VAULT) return pruefeVault(env.BRAIN_VAULT);
  const ausListe = aktiverVaultAusListe({ env, ...(support || {}) });
  if (ausListe) return ausListe;
  throw new KeinVaultFehler();
}
// Schreibweise „<vault> <befehl> …“ (so ruft brain.mjs die Werkzeuge) oder „<befehl> …“ mit --vault/BRAIN_VAULT/aktivem App-Vault. Ist das erste Argument
// kein Befehl, IST es der Vault (auch relativ, auch ohne „/“): er wird aufgelöst und geprüft — nie weicht das Werkzeug dann still auf den aktiven Vault aus.
// → { vault, rest }
export function vaultUndRest(args, istBefehl, opt = {}) {
  if (args.length && !istBefehl(args[0])) return { vault: vaultPfadOderEnde(["", "", args[0]], opt), rest: args.slice(1) };
  return { vault: vaultPfadOderEnde([], opt), rest: args };
}
// Für Werkzeug-Einstiege: kein gültiger Vault → Meldung auf stderr und Exit 2. Hook-Einstiege (still:true) beenden sich leise mit Exit 0 —
// ein Hook darf nie eine Sitzung stören, nur weil gerade kein Vault gewählt ist.
export function vaultPfadOderEnde(argv = process.argv, { still = false, ...opt } = {}) {
  try {
    const v = vaultPfad(argv, opt);
    // Hook-Einstiege (still:true) wirken nur in einem vertrauten Vault (P5); sonst enden sie ebenso leise wie ohne Vault.
    if (still && !vaultVertraut(v, opt)) process.exit(0);
    return v;
  } catch (e) {
    if (!(e instanceof KeinVaultFehler)) throw e;
    if (!still) console.error(e.message);
    process.exit(still ? 0 : 2);
  }
}

export function ladeConfig(vault) {
  const f = join(vault, "brain.config.json");
  if (!existsSync(f)) return {};
  // Kaputtes JSON darf nie einen Hook/Hintergrundprozess mit Stacktrace abschießen — lieber Defaults.
  // entferneBom: JSON.parse steckt ein UTF-8-BOM NICHT selbst weg (JSON.parse("﻿{}") wirft) — eine
  // mit PowerShell 5.1 (`Set-Content -Encoding UTF8`) gespeicherte Config hätte sonst immer {} zur Folge.
  try { return JSON.parse(entferneBom(readFileSync(f, "utf8"))); } catch { return {}; }
}
// Fehlt die Datei oder ist sie gültiges JSON → null (alles in Ordnung). Sonst eine kurze
// Fehlermeldung (ohne Stacktrace) — für Fund-/Statusmeldungen, die den Nutzer informieren,
// statt den Defekt still über ladeConfig()s {}-Fallback zu verschweigen.
export function configFehler(vault) {
  const f = join(vault, "brain.config.json");
  if (!existsSync(f)) return null;
  try { JSON.parse(entferneBom(readFileSync(f, "utf8"))); return null; }
  catch (e) { return String(e.message || e).split("\n")[0]; }
}
// Liest brain.config.json GENAU EINMAL (ein readFileSync) und liefert daraus alles, was ein Schreiber mit
// optimistischem Sperren braucht: `stand` (SHA-256-Hex der rohen Bytes — robuster als mtime, denn manche
// Dateisysteme wie HFS+/exFAT/FAT lösen nur auf 1-2 s auf und würden eine Änderung im selben Fenster
// verpassen), den BOM-bereinigten Text (für eine byte-/inhaltsgetreue Kopie VOR dem Schreiben) und die
// geparste Config bzw. einen Fehlertext. Ohne eine einzige gemeinsame Lese-Stelle müsste ein Schreiber die
// Datei mehrfach lesen (Fehlerprüfung, Stand, Inhalt) — zwischen zwei Lesevorgängen kann ein zweiter,
// nicht-atomarer Schreiber die Datei kurz kaputt/leer hinterlassen, und der zweite Lesevorgang sähe das
// nicht mehr. Fehlt die Datei: `stand` bleibt "0" (wie bisher), kein Fehler.
export function liesConfigRoh(vault) {
  const f = join(vault, "brain.config.json");
  if (!existsSync(f)) return { stand: "0", text: null, cfg: {}, fehler: null };
  let buf;
  try { buf = readFileSync(f); } catch { return { stand: "0", text: null, cfg: {}, fehler: null }; }
  const stand = createHash("sha256").update(buf).digest("hex");
  const text = entferneBom(buf.toString("utf8"));
  try { return { stand, text, cfg: JSON.parse(text), fehler: null }; }
  catch (e) { return { stand, text, cfg: null, fehler: String(e.message || e).split("\n")[0] }; }
}
// Zentrale Stelle für alle Leser von Markdown/Frontmatter: ein UTF-8-BOM (meist von PowerShell 5.1,
// `> datei.md` unter Windows) vor "---" lässt die Frontmatter-Regex sonst scheitern — das Frontmatter
// gilt dann als gewöhnlicher Text.
export function entferneBom(text) {
  return String(text).replace(/^﻿/, "");
}
// Die Ordnernamen kommen aus brain.config.json (Vault-Daten) und landen in Dateipfaden, Hook-Befehlen und gerenderten Texten ({{WIKI}} …
// in Skills und AGENTS.md, die in ~/.claude*/commands/ geschrieben werden): nur ein einzelner relativer Name ist zulässig — Buchstaben, Ziffern,
// "_", "." und "-", kein "." oder ".." allein, kein Pfad, nichts Absolutes. Alles andere fällt auf den Standard zurück (nie ein Fehler).
const ORDNER_NAME = /^[\p{L}\p{N}_.-]+$/u;
export const istOrdnerName = (w) => typeof w === "string" && w !== "." && w !== ".." && ORDNER_NAME.test(w);
export function ordner(vault, cfg = ladeConfig(vault)) {
  const nimm = (wert, standard) => (istOrdnerName(wert) ? wert : standard);
  return {
    inbox: nimm(cfg.ordner?.inbox, "00_inbox"),
    wiki: nimm(cfg.ordner?.wiki, nimm(cfg.wiki?.ordner, "09_wiki")),
    archiv: nimm(cfg.ordner?.archiv, "90_archiv"),
    aufgaben: nimm(cfg.ordner?.aufgaben, "05_aufgaben"),   // je Aufgabe eine Markdown-Datei (aufgaben.mjs)
  };
}

// Schreibziele des Kerns, die als Ordner oder Datei im Vault liegen müssen (Symlink nach draußen: gesundheit schriebe nach <draußen>/…,
// AGENTS.md/graph.json/_index.md würden außerhalb überschrieben). Gibt es ein Ziel und löst es (realpath) nicht innerhalb des Vaults auf,
// ist der Ordner kein Vault für den Kern (Exit 2; Hooks enden still mit Exit 0).
function zieleImVault(echt) {
  const o = ordner(echt);
  const ziele = [".logs", o.inbox, o.wiki, o.archiv, o.aufgaben, "AGENTS.md", "CLAUDE.md", "graph.json", join(o.wiki, "_index.md"), join(o.wiki, "INDEX.md")];
  for (const rel of ziele) {
    const p = join(echt, rel);
    let real;
    try { real = realpathSync(p); } catch (e) {
      // fehlt das Ziel: harmlos, außer es ist ein Verweis ins Leere (ein Schreiben legte die Datei am Ziel draußen an)
      if (e && (e.code === "ENOENT" || e.code === "ENOTDIR")) { let verweis = false; try { lstatSync(p); verweis = true; } catch { /* fehlt wirklich */ } if (!verweis) continue; }
      real = null;
    }
    if (real === null || !(real === echt || real.startsWith(echt + sep))) {
      throw new KeinVaultFehler(`Kein sicherer Vault: ${rel} zeigt aus dem Ordner hinaus (Verweis nach außerhalb) und wird nicht beschrieben.`);
    }
  }
}

const fwd = (p) => String(p).split("\\").join("/");
// Shell-sicheres Quoten eines Arguments. POSIX: einfache Anführungszeichen, ein ' im Wert wird zu '\'' (nichts darin wird von der Shell
// ausgewertet: kein $(), kein Backtick, kein ", kein $VAR). Windows: doppelte Anführungszeichen mit Vorwärts-Schrägstrichen.
export function shellQuote(wert, plattform = process.platform) {
  const t = String(wert);
  if (plattform === "win32") return `"${fwd(t).replaceAll('"', '\\"')}"`;
  return `'${t.replaceAll("'", `'\\''`)}'`;
}

// --- Stabiler Kern-Pfad -----------------------------------------------------------------------------------------------------
// Hook-Einträge (settings.json), core.hooksPath und der LaunchAgent überleben nur dann ein App-Update, wenn sie auf einen Pfad zeigen, der sich nicht
// ändert: den Symlink Support/Kortex/bin/kern, den der Starter in KORTEX_KERN_PFAD meldet. Der tatsächliche Ort des Kerns (Bundle, Versionsordner,
// Temp, Worktree) ist dafür ungeeignet. stabilerKern() liefert den Pfad nur, wenn er gesetzt, absolut und vorhanden ist und weder in einem .app-Bundle
// noch unter dem Temp-Ordner noch in einem Worktree liegt (geschriebene UND aufgelöste Form); sonst null.
// Testhaken: KORTEX_KERN_TEMP_WURZELN (nur mit KORTEX_KERN_UNSTABIL_ERLAUBT=1) ersetzt die Temp-Ordner (":"-getrennt, leer = keine). So lässt sich der echte
// Weg (Starter → bin/kern) in einem Wegwerf-Support-Ordner prüfen, der selbst unter Temp liegt.
const TEMP_WURZELN = () => {
  const ersatz = process.env.KORTEX_KERN_UNSTABIL_ERLAUBT === "1" ? process.env.KORTEX_KERN_TEMP_WURZELN : undefined;
  if (typeof ersatz === "string") return ersatz.split(delimiter).filter(Boolean);
  return [...new Set([tmpdir(), echterPfadOderSelbst(tmpdir()), "/tmp", "/private/tmp", "/var/folders", "/private/var/folders"])];
};
function istUnbestaendig(pfad, tempWurzeln = TEMP_WURZELN()) {
  const formen = [resolve(pfad), echterPfadOderSelbst(resolve(pfad))];
  return formen.some((f) => {
    const segs = teile(f);
    if (segs.some((x) => x.endsWith(".app"))) return true;
    if (segs.includes("worktrees") && segs.includes(".claude")) return true;
    return tempWurzeln.some((t) => hatPraefix(f, t));
  });
}
export function stabilerKern({ env = process.env, tempWurzeln } = {}) {
  const v = env.KORTEX_KERN_PFAD;
  if (typeof v !== "string" || !isAbsolute(v) || !existsSync(v) || istUnbestaendig(v, tempWurzeln)) return null;
  return v;
}
export class KernNichtStabilFehler extends Error {
  constructor() {
    super("Es gibt keinen stabilen Kern-Pfad (KORTEX_KERN_PFAD fehlt, ist nicht vorhanden oder zeigt in ein App-Bundle, den Temp-Ordner oder einen Worktree). "
      + "Starte das über Kortex bzw. den Starter, damit Hooks, Git-Hooks und der Hintergrunddienst nach einem App-Update weiter funktionieren.");
    this.name = "KernNichtStabilFehler";
    this.code = "KERN_NICHT_STABIL";
  }
}
// Pfad zum Eintragen in Dateien außerhalb des Kerns (settings.json, core.hooksPath, LaunchAgent). Ohne stabilen Pfad: KernNichtStabilFehler — nie ein
// stiller Rückfall auf den tatsächlichen Ort. Nur die Testumgebung darf mit KORTEX_KERN_UNSTABIL_ERLAUBT=1 den tatsächlichen Ort nehmen.
export function kernStabil({ env = process.env, tempWurzeln } = {}) {
  const s = stabilerKern({ env, tempWurzeln });
  if (s) return s;
  if (env.KORTEX_KERN_UNSTABIL_ERLAUBT === "1") return KERN;
  throw new KernNichtStabilFehler();
}
// Für Anzeige/Rendering (AGENTS.md, Skills, Meldungen): stabiler Pfad, sonst der tatsächliche Ort — nur zum Lesen, nie zum Eintragen.
export function kernAnzeige({ env = process.env, tempWurzeln } = {}) { return fwd(stabilerKern({ env, tempWurzeln }) || KERN); }
// Für Werkzeug-Einstiege, die etwas eintragen: Fehlermeldung auf stderr und Exit 3.
export function kernStabilOderEnde(opt = {}) {
  try { return kernStabil(opt); }
  catch (e) { if (!(e instanceof KernNichtStabilFehler)) throw e; console.error(e.message); process.exit(3); }
}
// --- Starter und Hook-Befehle -------------------------------------------------------------------------------------------------
// Claude-Code-Hooks laufen bei JEDEM Prompt. Sie zeigen deshalb nie direkt auf Node oder den Kern, sondern auf den Starter der App
// (Support/Kortex/bin/kortex, neben dem Symlink bin/kern): `kortex hook <name>` startet adapters/claude-code/<name>.mjs. Fehlt der Starter,
// Node oder der Kern (App gelöscht, Update läuft gerade), beendet sich der Befehl still mit Exit 0 — nie eine Fehlermeldung in der Sitzung.
// KORTEX_STARTER_PFAD (nur mit KORTEX_KERN_UNSTABIL_ERLAUBT=1, für Tests) lenkt den Starter um.
export function starterPfad({ env = process.env, tempWurzeln } = {}) {
  if (env.KORTEX_KERN_UNSTABIL_ERLAUBT === "1" && typeof env.KORTEX_STARTER_PFAD === "string" && isAbsolute(env.KORTEX_STARTER_PFAD)) return env.KORTEX_STARTER_PFAD;
  return join(dirname(kernStabil({ env, tempWurzeln })), "kortex");
}
export class StarterFehltFehler extends Error {
  constructor(pfad) {
    super(`Der Starter von Kortex fehlt (${pfad}). Öffne die Kortex-App einmal, dann wird er angelegt, und versuche es danach noch einmal.`);
    this.name = "StarterFehltFehler";
  }
}
// Für Einstiege, die Hook-Befehle eintragen: Starter-Pfad, der vorhanden sein muss (sonst Exit 3 mit klarer Meldung). In der Testumgebung genügt der Pfad.
export function starterOderEnde(opt = {}) {
  const env = opt.env || process.env;
  kernStabilOderEnde(opt);
  const s = starterPfad(opt);
  if (env.KORTEX_KERN_UNSTABIL_ERLAUBT !== "1" && !existsSync(s)) { console.error(new StarterFehltFehler(s).message); process.exit(3); }
  return s;
}
// Befehlszeile für settings.json (POSIX-Shell): fehlt der Starter, Exit 0 ohne Ausgabe; sonst ersetzt der Starter die Shell (Exit-Code und stdin des Hooks bleiben erhalten).
export function hookBefehl(starter, name, args = "") {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`ungültiger Hook-Name: ${name}`);
  const q = shellQuote(fwd(starter), "linux");
  return `[ -x ${q} ] && exec ${q} hook ${name}${args} || exit 0`;
}
// Gehört dieser Befehl zu einem Kortex-Hook (neue Form, jeder Starter-Ort)? → Hook-Name oder null.
export function hookNameAusBefehl(befehl) {
  const m = typeof befehl === "string" ? /kortex' hook ([a-z][a-z0-9-]*)(?: |$)/.exec(befehl) : null;
  return m ? m[1] : null;
}
// Absolute, gequotete Programmpfade für gerenderte Befehle (AGENTS.md, Skills, Hook-Befehle): ein frisch
// eingerichteter Rechner hat das private Node/git oft NICHT im PATH — darum nie nackt "node"/"git".
// Bevorzugt ein stabiler PATH-Eintrag, der auf genau dieses Node zeigt (z. B. /opt/homebrew/bin/node statt des
// versionierten Cellar-Pfads, der nach einem Paket-Update verschwindet); sonst process.execPath selbst.
export function nodePfad({ env = process.env } = {}) {
  // Von außen vorgegeben (Brain-App: das Node, mit dem das Terminal die Hooks startet) — nur absolut und vorhanden.
  const vorgabe = env.BRAIN_NODE;
  if (typeof vorgabe === "string" && isAbsolute(vorgabe) && existsSync(vorgabe)) return vorgabe;
  const echt = (p) => { try { return realpathSync(p); } catch { return null; } };
  const ziel = echt(process.execPath);
  const namen = process.platform === "win32" ? ["node.exe"] : ["node"];
  for (const dir of String(env.PATH || "").split(delimiter)) {
    if (!dir || !isAbsolute(dir)) continue;
    for (const n of namen) { const p = join(dir, n); if (ziel && existsSync(p) && echt(p) === ziel) return p; }
  }
  return process.execPath;
}
export function nodeBefehl() { return shellQuote(nodePfad()); }
// Nur fürs RENDERN von Vorlagen (AGENTS.md, Skills) — ein gequoteter Anzeige-String, kein argv[0] für
// execFileSync/spawnSync (dafür gibt es gitBefehl() in werkzeug.mjs; zwei Funktionen mit demselben
// Namen für zwei verschiedene Zwecke wären verwirrend, darum hier umbenannt). Den bekannten MinGit-Ort unter diesem Home
// (win32), sonst das nackte "git". werkzeuge.git aus der Vault-Config zählt nicht (Programme kommen nie aus dem Vault, P4).
export function gitAnzeige({ plattform = process.platform, home = homedir() } = {}) {
  if (plattform === "win32") {
    for (const ort of kitOrte({ home, plattform })) {
      const mingit = join(ort, "git", "cmd", "git.exe");
      if (existsSync(mingit)) return shellQuote(mingit, plattform);
    }
  }
  return "git";
}
// Platzhalter in Vorlagen (kit/AGENTS.md, skills/*/SKILL.md) — von skills-build.mjs UND doctor.mjs genutzt,
// damit „AGENTS.md aktuell?" exakt dasselbe Rendering vergleicht. {{VAULT}} = Datenordner, {{KERN}} = Kern-Ordner (kernAnzeige),
// {{DATEN}} = Support-Ordner der App (App-weite Werkzeuge wie qmd), dazu {{NODE}}, {{GIT}}, {{INBOX}}, {{WIKI}}, {{ARCHIV}}.
// Bedingte Blöcke: {{WENN:<automatik-schluessel>}}…{{/WENN}} — der Inhalt bleibt nur stehen, wenn
// cfg.automatik[<schluessel>] === true ist (z. B. die Ich-Karte-Zeile, nur wenn `ichKarte` eingeschaltet
// ist). Unbekannte/fehlende Schlüssel gelten als aus (Standard false) — nie werfen, nie als Platzhalter
// stehen bleiben (beide Zweige werden vollständig ersetzt, auch wenn der Schlüssel aus ist).
export function renderVorlage(text, vault) {
  const cfg = ladeConfig(vault);
  const o = ordner(vault, cfg);
  const an = cfg.automatik && typeof cfg.automatik === "object" && !Array.isArray(cfg.automatik) ? cfg.automatik : {};
  const bedingt = text.replace(/\{\{WENN:([A-Za-z0-9_]+)\}\}([\s\S]*?)\{\{\/WENN\}\}\n?/g,
    (_, schluessel, innen) => (an[schluessel] === true ? innen : ""));
  const ersetze = (t) => t.replaceAll("{{VAULT}}", fwd(vault)).replaceAll("{{INBOX}}", o.inbox).replaceAll("{{WIKI}}", o.wiki)
    .replaceAll("{{ARCHIV}}", o.archiv).replaceAll("{{KERN}}", kernAnzeige()).replaceAll("{{DATEN}}", fwd(supportOrdner()));
  // Ein in "…" geschriebenes Argument mit Pfad-Platzhaltern wird als Ganzes shell-sicher gequotet (POSIX: einfache Anführungszeichen) — ein Vault-
  // oder Kernpfad mit $(), Backtick, " oder ' darf nie als Befehl laufen. Alles übrige (Fließtext, Pfade in Backticks der Doku) wird nur ersetzt.
  const gequotet = bedingt.replace(/"([^"\n]*\{\{(?:VAULT|KERN|DATEN)\}\}[^"\n]*)"/g, (_, innen) => shellQuote(ersetze(innen)));
  return ersetze(gequotet).replaceAll("{{NODE}}", nodeBefehl()).replaceAll("{{GIT}}", gitAnzeige({ cfg }));
}
