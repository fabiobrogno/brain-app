// vertrauen.mjs — Workspace-Trust je Vault (Kern-Umzug P5), die LESENDE Hälfte im Kern.
//
// Ein Vault, den Kortex selbst angelegt oder über den Assistenten von GitHub geklont hat, gilt als vertraut; ein von außen geöffneter Ordner
// (Zip, AirDrop, Cloud, „Ordner wählen“) erst nach der einmaligen Frage im Studio („Kommt dieser Vault von dir?“). Bis dahin tut der Kern
// nichts, was am Vault etwas bewirkt: kein git (werkzeug.mjs#gitBefehl), kein Hintergrunddienst, keine Hooks (pfade.mjs#vaultPfadOderEnde
// mit still:true), keine KI-Pflege (ernte.mjs#findeClaude, brain.mjs). Lesen, Suchen und Ansehen gehen weiter.
//
// Der Merker liegt außerhalb des Vaults: <Support>/vertrauen.json = { "<realpath>": { seit, ordner, quelle } }
//   ordner = "dev:ino:birthtimeMs" des Vault-Ordners (gelöscht und neu geklont oder durch eine Kopie ersetzt = neue Frage, auch am selben Pfad)
//   quelle = "angelegt" | "geklont" | "bestaetigt" | "migriert"
// Geschrieben wird er von der Werkstatt (Ressourcen/gemeinsam/vertrauen.mjs, atomar, Modus 0600); der Kern liest nur. Beide meinen dieselbe Datei
// und dieselbe Kennung (Test: Tests/Node/vertrauen-kern.test.mjs hält sie zusammen).
// Alter Merker (Werkstatt vor P5: { seit, ordner, code }): zählt als vertraut, wenn der Ordner derselbe ist UND der Vault in der Vaultliste der
// App steht (`imListe`) — das ist die Migration; die Werkstatt schreibt sie beim Start in das neue Format um.
// Jeder Fehler (Datei fehlt, kaputt, Ordner nicht lesbar) heißt „nicht vertraut“.
import { readFileSync, realpathSync, statSync, lstatSync } from "node:fs";
import { join, resolve, dirname, basename, sep } from "node:path";

export const merkerPfad = (support) => join(support, "vertrauen.json");
export const QUELLEN = ["angelegt", "geklont", "bestaetigt", "migriert"];

export function ordnerKennung(wurzel) {
  const st = statSync(wurzel);
  return `${st.dev}:${st.ino}:${st.birthtimeMs}`;
}

// Vergleichsform für Pfade: APFS unterscheidet weder Groß/klein noch die Unicode-Form.
const falte = (s) => String(s).normalize("NFC").toLowerCase();

function liesMerker(support) {
  try {
    const j = JSON.parse(readFileSync(merkerPfad(support), "utf8"));
    return j && typeof j === "object" && !Array.isArray(j) ? j : {};
  } catch { return {}; }
}

// Die Schreibweisen, unter denen der Eintrag für diesen Ordner stehen kann: wie angegeben, aufgelöst (JS-Fassung) und kanonisch (native).
function orte(vault) {
  const k = new Set([resolve(String(vault))]);
  for (const f of [realpathSync, realpathSync.native]) { try { k.add(f(vault)); } catch { /* Ordner gibt es nicht */ }; }
  return [...k];
}

// Verknüpfter Arbeitsbaum des Tageslaufs (git worktree, vom Kern selbst unter <arbeitsbaumWurzeln> angelegt, z. B. ~/Library/Caches/brain-tageslauf): → echter Pfad des
// Vaults, zu dem er gehört, sonst null. Nur unter diesen Wurzeln und nur, wenn beide Seiten einander bestätigen (.git des Arbeitsbaums → <vault>/.git/worktrees/<n> und
// dort `gitdir` zurück auf den Arbeitsbaum) — ein beliebiger Ordner mit einer erfundenen .git-Datei erbt kein Vertrauen. (Dieselbe Ausnahme macht git-sicher.)
function hauptVaultVon(echt, arbeitsbaumWurzeln) {
  try {
    const wurzeln = arbeitsbaumWurzeln.map((w) => { try { return realpathSync.native(w); } catch { return null; } }).filter(Boolean);
    if (!wurzeln.some((w) => echt.startsWith(w + sep))) return null;
    const punktGit = join(echt, ".git");
    if (!lstatSync(punktGit).isFile()) return null;
    const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(punktGit, "utf8"));
    if (!m) return null;
    const gitdir = realpathSync.native(resolve(echt, m[1].trim()));
    if (basename(dirname(gitdir)) !== "worktrees" || basename(dirname(dirname(gitdir))) !== ".git") return null;
    const zurueck = readFileSync(join(gitdir, "gitdir"), "utf8").trim();
    if (realpathSync.native(resolve(gitdir, zurueck)) !== realpathSync.native(punktGit)) return null;
    return dirname(dirname(dirname(gitdir)));
  } catch { return null; }
}

// → { vertraut: boolean, quelle: string|null }. `imListe`: (echterPfad) => boolean, ob der Vault in der Vaultliste der App steht (nur für alte Einträge).
// `arbeitsbaumWurzeln`: Ordner, unter denen der Kern verknüpfte Arbeitsbäume eines Vaults anlegt; sie gelten, wenn ihr Vault vertraut ist.
export function vertrauensStand(vault, { support, imListe = () => false, arbeitsbaumWurzeln = [] } = {}) {
  const nein = { vertraut: false, quelle: null };
  if (typeof vault !== "string" || !vault || !support) return nein;
  let echt, ordner;
  try { echt = realpathSync.native(vault); if (!statSync(echt).isDirectory()) return nein; ordner = ordnerKennung(echt); } catch { return nein; }
  const m = liesMerker(support);
  const wege = orte(vault).map(falte);
  const schluessel = Object.keys(m).find((k) => wege.includes(falte(k)));
  const e = schluessel === undefined ? null : m[schluessel];
  if (!e) {
    const haupt = arbeitsbaumWurzeln.length ? hauptVaultVon(echt, arbeitsbaumWurzeln) : null;
    return haupt ? vertrauensStand(haupt, { support, imListe }) : nein;
  }
  if (typeof e !== "object" || e.ordner !== ordner) return nein;
  if (typeof e.quelle === "string") return QUELLEN.includes(e.quelle) ? { vertraut: true, quelle: e.quelle } : nein;
  if (typeof e.code === "string") { let drin = false; try { drin = imListe(echt) === true; } catch { /* unbekannt = nein */ } return drin ? { vertraut: true, quelle: "migriert" } : nein; }
  return nein;
}

// Nur Testumgebungen: KORTEX_VAULT_VERTRAUT=alle lässt jeden Vault als vertraut gelten (Wegwerf-Vaults der Suiten). Greift nie ohne
// KORTEX_KERN_UNSTABIL_ERLAUBT=1 oder BRAIN_TESTMODUS=1; die Tests der Sperre entfernen die Variable im Kindprozess.
export function alleVertraut(env = process.env) {
  return env.KORTEX_VAULT_VERTRAUT === "alle" && (env.KORTEX_KERN_UNSTABIL_ERLAUBT === "1" || env.BRAIN_TESTMODUS === "1");
}
