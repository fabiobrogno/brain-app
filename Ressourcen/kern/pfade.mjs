// pfade.mjs — einzige Stelle, die weiß, wo der Kern liegt, wo der Vault liegt und wie seine Ordner heißen.
//
// Zwei getrennte Orte (Kern-Umzug P2, docs/plaene/kern-umzug.md):
//   KERN  = der Ordner DIESER Datei (Code und gebündelte Daten, im App-Bundle bzw. unter Support/Kortex/kern). Nur lesen.
//   VAULT = der Datenordner des Nutzers. Dort liegen Wissen, brain.config.json und alle Laufzeitdaten (.logs/ …).
// Der Vault wird NIE aus dem Ort des Kerns abgeleitet und es gibt keinen Rückfall auf einen festen Ordner (auch nicht den Vault des Entwicklers).
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { join, dirname, resolve, delimiter, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

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

function pfadGleich(a, b) { return resolve(a) === resolve(b); }
// Aktiver Vault laut vaults.json (`{ "vaults":[{"pfad":…}], "aktiv":"<pfad>" }`, geführt von der App): `aktiv` zählt nur, wenn es einen
// Eintrag mit absolutem Pfad meint. Die erste vorhandene, lesbare Datei entscheidet (auch mit aktiv:null — dann gibt es keinen Vault).
export function aktiverVaultAusListe(opt = {}) {
  for (const ordner of supportOrte(opt)) {
    let j;
    try { j = JSON.parse(readFileSync(join(ordner, "vaults.json"), "utf8")); } catch { continue; }
    if (!j || typeof j !== "object" || !Array.isArray(j.vaults)) continue;
    const aktiv = j.aktiv;
    if (typeof aktiv !== "string" || !isAbsolute(aktiv)) return null;
    const eintrag = j.vaults.find((e) => e && typeof e.pfad === "string" && isAbsolute(e.pfad) && pfadGleich(e.pfad, aktiv));
    return eintrag ? resolve(eintrag.pfad) : null;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Vault bestimmen

export class KeinVaultFehler extends Error {
  constructor() {
    super("Kein Vault gefunden. Gib ihn mit --vault <pfad> an, setze BRAIN_VAULT oder wähle in der Kortex-App einen aktiven Vault.");
    this.name = "KeinVaultFehler";
    this.code = "KEIN_VAULT";
  }
}

// --vault <pfad> bzw. --vault=<pfad> steht an beliebiger Stelle der Kommandozeile. Beim Laden dieses Moduls wird die Angabe aus
// process.argv genommen und gemerkt: alle Werkzeuge mit eigener Argumentauswertung (Befehl an Stelle 2, Flags, Positionen) sehen sie
// nie und müssen sie nicht kennen.
export function nimmVaultArg(argv) {
  let vault = null;
  for (let i = 2; i < argv.length;) {
    const a = argv[i];
    if (a === "--vault" && typeof argv[i + 1] === "string" && argv[i + 1] !== "") { vault = argv[i + 1]; argv.splice(i, 2); continue; }
    if (typeof a === "string" && a.startsWith("--vault=") && a.length > 8) { vault = a.slice(8); argv.splice(i, 1); continue; }
    i++;
  }
  return vault;
}
const ARG_VAULT = nimmVaultArg(process.argv);

// Reihenfolge: --vault > (Altform, wo ein Werkzeug sie kennt) erstes Positionsargument von `argv` > BRAIN_VAULT > aktiver Vault der App.
// Keinen gefunden → KeinVaultFehler. Es gibt bewusst keinen Rückfall auf einen festen Ordner und keinen auf den Ort des Kerns.
export function vaultPfad(argv = process.argv, { env = process.env, support } = {}) {
  const lokal = Array.isArray(argv) && argv !== process.argv ? nimmVaultArg([...argv]) : null;
  const explizit = lokal || ARG_VAULT;
  if (explizit) return explizit;
  const positionell = Array.isArray(argv) ? argv.slice(2).find((a) => typeof a === "string" && a !== "" && !a.startsWith("--")) : null;
  if (positionell) return positionell;
  if (typeof env.BRAIN_VAULT === "string" && env.BRAIN_VAULT) return env.BRAIN_VAULT;
  const ausListe = aktiverVaultAusListe({ env, ...(support || {}) });
  if (ausListe) return ausListe;
  throw new KeinVaultFehler();
}
// Für Werkzeug-Einstiege: kein Vault → Meldung auf stderr und Exit 2. Hook-Einstiege (still:true) beenden sich leise mit Exit 0 —
// ein Hook darf nie eine Sitzung stören, nur weil gerade kein Vault gewählt ist.
export function vaultPfadOderEnde(argv = process.argv, { still = false, ...opt } = {}) {
  try { return vaultPfad(argv, opt); }
  catch (e) {
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
export function ordner(vault, cfg = ladeConfig(vault)) {
  return {
    inbox: cfg.ordner?.inbox || "00_inbox",
    wiki: cfg.ordner?.wiki || cfg.wiki?.ordner || "09_wiki",
    archiv: cfg.ordner?.archiv || "90_archiv",
  };
}

const fwd = (p) => String(p).split("\\").join("/");
// Kern-Pfad für gerenderte Befehle (AGENTS.md, Skills): ein stabiler Pfad, den der Starter in KORTEX_KERN_PFAD setzt (z. B. der Symlink
// Support/Kortex/bin/kern, der ein App-Update überlebt) — sonst der tatsächliche Ort dieses Kerns.
export function kernStabil({ env = process.env } = {}) {
  const v = env.KORTEX_KERN_PFAD;
  return typeof v === "string" && isAbsolute(v) ? v : KERN;
}
export function kernAnzeige(opt = {}) { return fwd(kernStabil(opt)); }
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
export function nodeBefehl() { return `"${fwd(nodePfad())}"`; }
// Nur fürs RENDERN von Vorlagen (AGENTS.md, Skills) — ein gequoteter Anzeige-String, kein argv[0] für
// execFileSync/spawnSync (dafür gibt es gitBefehl() in werkzeug.mjs; zwei Funktionen mit demselben
// Namen für zwei verschiedene Zwecke wären verwirrend, darum hier umbenannt). Bevorzugt werkzeuge.git aus
// der Vault-Config (von install.mjs gesetzt), sonst den bekannten MinGit-Ort unter diesem Home (win32),
// sonst das nackte "git".
export function gitAnzeige({ cfg = {}, plattform = process.platform, home = homedir() } = {}) {
  if (typeof cfg?.werkzeuge?.git === "string" && cfg.werkzeuge.git) return `"${fwd(cfg.werkzeuge.git)}"`;
  if (plattform === "win32") {
    for (const ort of kitOrte({ home, plattform })) {
      const mingit = join(ort, "git", "cmd", "git.exe");
      if (existsSync(mingit)) return `"${fwd(mingit)}"`;
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
  return bedingt.replaceAll("{{VAULT}}", fwd(vault)).replaceAll("{{INBOX}}", o.inbox).replaceAll("{{WIKI}}", o.wiki)
    .replaceAll("{{ARCHIV}}", o.archiv).replaceAll("{{KERN}}", kernAnzeige()).replaceAll("{{DATEN}}", fwd(supportOrdner()))
    .replaceAll("{{NODE}}", nodeBefehl()).replaceAll("{{GIT}}", gitAnzeige({ cfg }));
}
