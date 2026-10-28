// gemeinsam/basis.mjs — Fehlerart mit HTTP-Status und der Pfad-Schutz (Studio-Spec §5). Keine Abhängigkeiten.
import { realpathSync, lstatSync, readdirSync, accessSync, statSync, constants } from "node:fs";
import { join, sep, dirname, delimiter, isAbsolute } from "node:path";
import { homedir } from "node:os";

// Fehler, die bis zur Oberfläche durchgereicht werden: Status + Alltagsmeldung (+ Zusatzfelder wie aktuellerHash).
export class HttpFehler extends Error {
  constructor(status, meldung, extra = {}) {
    super(meldung);
    this.status = status;
    this.extra = extra;
  }
}

export const MAX_DATEI = 5 * 1024 * 1024;

// Ablageort der App (Vault-Liste, Vertrauens-Merker): BRAIN_APP_SUPPORT oder ~/Library/Application Support/Brain.
export const supportOrdner = () => process.env.BRAIN_APP_SUPPORT || join(homedir(), "Library", "Application Support", "Brain");

// ───────────────────────────── Vorschau („wie frisch installiert“) ─────────────────────────────
// Die App setzt KORTEX_VORSCHAU=<Ordner> (Swift: VorschauModus). Dann liegt alles im Ordner: HOME, Support, Zugangsdaten, Vaults —
// nichts im echten Benutzerordner, nichts im Schlüsselbund. Gültig ist nur ein absoluter Pfad aus unbedenklichen Zeichen (er wandert in
// Git-Konfiguration und ssh-Befehle). Ist die Variable gesetzt, aber ungültig, ist das ein Fehler (vorschauFehler), kein stilles „aus“.
const VORSCHAU_PFAD = /^\/[A-Za-z0-9._+@=,/-]{1,500}$/;
export function vorschauOrdner() {
  const v = process.env.KORTEX_VORSCHAU;
  return typeof v === "string" && VORSCHAU_PFAD.test(v) && !v.endsWith("/") && !v.split("/").includes("..") ? v : null;
}
// → Text mit dem Grund, wenn die Vorschau gesetzt ist, aber nicht sicher läuft (ungültiger Pfad oder HOME nicht im Vorschau-Ordner); sonst null.
export function vorschauFehler() {
  if (process.env.KORTEX_VORSCHAU === undefined) return null;
  const o = vorschauOrdner();
  if (!o) return "KORTEX_VORSCHAU ist kein gültiger Ordnerpfad.";
  if (homedir() !== join(o, "home")) return "Der Benutzerordner (HOME) liegt nicht im Vorschau-Ordner.";
  return null;
}

// Vergleichsform für Namen: APFS unterscheidet weder Groß/klein noch NFC/NFD — Sperren und Schreibschutz dürfen es auch nicht.
export const falte = (s) => String(s).normalize("NFC").toLowerCase();

// ───────────────────────────── PATH und Programme ─────────────────────────────
// Ein leerer oder relativer PATH-Eintrag ("", ".", "node_modules/.bin") meint den ARBEITSORDNER des Kindprozesses — und der ist bei
// Git (cwd = Vault) der Ordner eines womöglich fremden Vaults: ein dort liegendes `git` würde gestartet, bevor jemand vertraut hat
// (Vertrauen v2 §8). Deshalb gilt in Node nur, was absolut ist.
export const bereinigterPfad = (pfad) => String(pfad ?? "").split(delimiter).filter((d) => d !== "" && isAbsolute(d)).join(delimiter);

// Entfernt leere und relative Einträge aus process.env.PATH (jeder Einstiegspunkt ruft das beim Start). Bleibt nichts übrig, fällt PATH
// ganz weg (Kindprozesse nehmen dann den Standardpfad des Systems) — ein leerer PATH-Text wäre selbst ein leerer Eintrag.
export function bereinigePfad() {
  const alt = process.env.PATH;
  if (alt === undefined) return;
  const neu = bereinigterPfad(alt);
  if (neu === alt) return;
  if (neu) process.env.PATH = neu; else delete process.env.PATH;
}

// Absoluter Pfad der ausführbaren Datei `name` (nur über absolute PATH-Einträge; nie ein Ordner) oder null. Gemerkt je PATH; ein
// gemerkter Treffer wird bei jedem Aufruf neu geprüft (die Datei kann verschwinden), PATH wird bei jedem Aufruf frisch gelesen.
const programmCache = new Map();
const ausfuehrbar = (p) => { try { accessSync(p, constants.X_OK); return statSync(p).isFile(); } catch { return false; } };
export function absoluterPfad(name) {
  const pfad = process.env.PATH ?? "";
  const schluessel = `${name}\0${pfad}`;
  const gemerkt = programmCache.get(schluessel);
  if (gemerkt !== undefined && (gemerkt === null || ausfuehrbar(gemerkt))) return gemerkt;
  let treffer = null;
  for (const d of new Set(bereinigterPfad(pfad).split(delimiter).filter(Boolean))) {
    const p = join(d, name);
    if (ausfuehrbar(p)) { treffer = p; break; }
  }
  if (programmCache.size > 50) programmCache.clear();
  programmCache.set(schluessel, treffer);
  return treffer;
}
// Git wird nur über diesen einmal aufgelösten absoluten Pfad gestartet (nie der nackte Name: der würde nach dem Wechsel in den Vault gesucht).
export const absoluterGitPfad = () => absoluterPfad("git");

// Umgebung für Kindprozesse (git, Kit, claude): nichts, womit sich fremder Code einschleusen ließe (NODE_OPTIONS,
// NODE_PATH, ELECTRON_RUN_AS_NODE, DYLD_*/LD_*) und kein leerer oder relativer PATH-Eintrag.
// NODE_EXTRA_CA_CERTS bleibt (Firmen-Zertifikate für claude).
export function kindUmgebung(zusatz = {}) {
  const e = { ...process.env };
  for (const k of Object.keys(e)) {
    if ((k.startsWith("NODE_") && k !== "NODE_EXTRA_CA_CERTS") || k.startsWith("ELECTRON_") || k.startsWith("DYLD_") || k.startsWith("LD_")) delete e[k];
  }
  const aus = { ...e, ...zusatz };
  if (typeof aus.PATH === "string") { const p = bereinigterPfad(aus.PATH); if (p) aus.PATH = p; else delete aus.PATH; }
  return aus;
}
export const testmodus = () => process.env.BRAIN_TESTMODUS === "1";

// Namensregeln, die Baum, Suche, Notiz-Index und Schreibschutz gemeinsam nutzen (Vergleich ohne Groß/klein, NFC).
export const BEARBEITBAR = /\.(md|txt)$/i;
const GENERIERT_NAMEN = new Set(["index.md", "_index.md", "graph.json"]);
export const generiertName = (name) => GENERIERT_NAMEN.has(falte(name));
// 09_wiki/_*.md ist generiert — außer _schema.md und _log.md
export const wikiGeneriert = (rel, name) => { const f = falte(rel); return f.startsWith("09_wiki/") && falte(name).startsWith("_") && falte(name) !== "_schema.md" && falte(name) !== "_log.md"; };
export const gesperrterName = (n) => n.startsWith(".") || falte(n) === "node_modules";

// Lexikalische Prüfung (ohne Plattenzugriff): relativer Vault-Pfad mit "/" → bereinigte Segmente.
// 400 bei Unsinn, 403 bei Ausbruch (.., absolut) und bei gesperrten Orten (führender Punkt, node_modules).
export function sauber(rel) {
  if (typeof rel !== "string" || !rel.trim() || rel.length > 1000) throw new HttpFehler(400, "Der Pfad fehlt oder ist ungültig.");
  if (/[\0\\]/.test(rel)) throw new HttpFehler(400, "Der Pfad enthält ungültige Zeichen.");
  if (rel.startsWith("/") || rel.startsWith("~") || /^[A-Za-z]:/.test(rel)) throw new HttpFehler(403, "Dieser Pfad liegt außerhalb des Vaults.");
  const segmente = [];
  for (const s of rel.split("/")) {
    if (s === "" || s === ".") continue;
    if (s === "..") throw new HttpFehler(403, "Dieser Pfad liegt außerhalb des Vaults.");
    if (s.startsWith(".") || falte(s) === "node_modules") throw new HttpFehler(403, "Dieser Ort ist gesperrt.");
    segmente.push(s);
  }
  if (!segmente.length) throw new HttpFehler(400, "Der Pfad fehlt oder ist ungültig.");
  return segmente;
}

// Schreibweise der vorhandenen Ordner/Datei übernehmen („index.md“ trifft eine vorhandene „INDEX.md“): auf APFS dieselbe Datei.
// Gibt es den Namen exakt, bleibt er; sonst der (eindeutige) Treffer ohne Groß/klein und Unicode-Form.
function kanonisch(wurzel, segmente) {
  const aus = [];
  let ordner = wurzel;
  for (const s of segmente) {
    let name = s, gefunden = false;
    try {
      const namen = readdirSync(ordner);
      if (namen.includes(s)) gefunden = true;
      else {
        const treffer = namen.filter((n) => falte(n) === falte(s));
        if (treffer.length) { name = treffer.sort()[0]; gefunden = true; }
      }
    } catch { /* Ordner gibt es (noch) nicht → Rest unverändert */ }
    aus.push(name);
    if (!gefunden) { aus.push(...segmente.slice(aus.length)); break; }
    ordner = join(ordner, name);
  }
  return aus;
}

const imVault = (echt, wurzel) => echt === wurzel || echt.startsWith(wurzel + sep);

// Absoluter Pfad im Vault; der nächste vorhandene Vorfahre (bzw. das Ziel selbst) muss per realpath im Vault liegen,
// damit kein Symlink nach draußen führt — auch beim Anlegen neuer Dateien.
export function loese(wurzel, rel) {
  const segmente = kanonisch(wurzel, sauber(rel));
  const abs = join(wurzel, ...segmente);
  let p = abs;
  for (;;) {
    try { lstatSync(p); break; } catch { /* gibt es noch nicht → Vorfahre prüfen */ }
    const oben = dirname(p);
    if (oben === p) break;
    p = oben;
  }
  let echt;
  try { echt = realpathSync(p); } catch { throw new HttpFehler(403, "Dieser Pfad ist nicht erreichbar."); }
  if (!imVault(echt, wurzel)) throw new HttpFehler(403, "Dieser Pfad liegt außerhalb des Vaults.");
  return { abs, rel: segmente.join("/"), segmente };
}

export { imVault };
