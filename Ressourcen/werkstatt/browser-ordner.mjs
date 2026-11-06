// werkstatt/browser-ordner.mjs — was die Browser-Hülle vom Rechner des Dienstes braucht, weil ein Browser keinen Ordner-Dialog mit echtem Pfad kennt (Paket W1):
// Ordner prüfen (wie `ordner-waehlen` am Mac: breit?, notizen, ordner, mehr), Unterordner auflisten (die Auswahl der Seite läuft über diese Liste), zuletzt benutzte Ordner,
// git-Prüfung ohne Dialog. Läuft im Dienst, also auf dem Rechner des Benutzers; erreichbar nur mit gültiger Sitzung (browser-dienst.mjs).
import { readdirSync, statSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, basename, isAbsolute, parse, sep, resolve } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { istWindows } from "../gemeinsam/plattform.mjs";

const NOTIZ_ENDUNGEN = new Set([".md", ".txt"]);
const ZEITLIMIT_MS = 1500, MAX_EINTRAEGE = 20_000, MAX_LISTE = 500, MAX_ZULETZT = 8;

export function erweitere(eingabe, home = homedir()) {
  let p = String(eingabe ?? "").trim();
  if (p.length > 1000 || p.includes("\0")) return null;
  if (p === "~") p = home; else if (/^~[\\/]/.test(p)) p = join(home, p.slice(2));
  return isAbsolute(p) ? resolve(p) : null;
}

function zaehle(wurzel) {
  const z = { notizen: 0, ordner: 0, mehr: false };
  const ende = Date.now() + ZEITLIMIT_MS;
  let besucht = 0;
  const stapel = [wurzel];
  while (stapel.length) {
    const dir = stapel.pop();
    let eintraege; try { eintraege = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of eintraege) {
      if (e.name.startsWith(".")) continue;
      if (++besucht > MAX_EINTRAEGE || Date.now() >= ende) { z.mehr = true; return z; }
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { if (e.name === "node_modules") continue; z.ordner++; stapel.push(join(dir, e.name)); }
      else if (NOTIZ_ENDUNGEN.has(parse(e.name).ext.toLowerCase())) z.notizen++;
    }
  }
  return z;
}

// Ist der Ort als Vault zu breit (Benutzerordner, Laufwerk/Wurzel, Schreibtisch, Dokumente, Downloads)?
export function breiterOrt(pfad, home = homedir()) {
  const norm = (p) => (istWindows() ? p.toLowerCase() : p);
  const p = norm(pfad);
  const breit = parse(pfad).root === pfad || p === norm(resolve(home))
    || ["Desktop", "Documents", "Downloads", "Schreibtisch", "Dokumente"].some((n) => p === norm(join(resolve(home), n)));
  return breit ? { name: basename(pfad) || pfad, vorschlag: join(pfad, "Kortex") } : null;
}

export function pruefeOrdner(eingabe, { home = homedir() } = {}) {
  const pfad = erweitere(eingabe, home);
  if (!pfad) return { ok: false, grund: "kein-absoluter-pfad" };
  let st; try { st = statSync(pfad); } catch { return { ok: false, grund: "nicht-gefunden" }; }
  if (!st.isDirectory()) return { ok: false, grund: "kein-ordner" };
  const antwort = { ok: true, pfad };
  const b = breiterOrt(pfad, home);
  if (b) antwort.breit = b;
  const z = zaehle(pfad);
  antwort.notizen = z.notizen; antwort.ordner = z.ordner; if (z.mehr) antwort.mehr = true;
  return antwort;
}

// Unterordner (ohne versteckte, ohne Verknüpfungen auf Dateien) in Namensreihenfolge. Leerer Pfad: unter Windows die Laufwerke, sonst der Benutzerordner.
export function listeOrdner(eingabe, { home = homedir() } = {}) {
  if (istWindows() && (eingabe === "" || eingabe === null || eingabe === undefined)) {
    const laufwerke = [];
    for (let c = 65; c <= 90; c++) { const l = `${String.fromCharCode(c)}:\\`; try { if (existsSync(l)) laufwerke.push(l); } catch { /* weiter */ } }
    return { ok: true, pfad: "", eltern: null, ordner: laufwerke.map((l) => ({ name: l, pfad: l })) };
  }
  const pfad = erweitere(eingabe === "" || eingabe === null || eingabe === undefined ? home : eingabe, home);
  if (!pfad) return { ok: false, grund: "kein-absoluter-pfad" };
  let eintraege; try { eintraege = readdirSync(pfad, { withFileTypes: true }); } catch { return { ok: false, grund: "nicht-lesbar" }; }
  const ordner = [];
  for (const e of eintraege) {
    if (e.name.startsWith(".")) continue;
    let istDir = e.isDirectory();
    if (!istDir && e.isSymbolicLink()) { try { istDir = statSync(join(pfad, e.name)).isDirectory(); } catch { istDir = false; } }
    if (istDir) ordner.push({ name: e.name, pfad: join(pfad, e.name) });
  }
  ordner.sort((a, b) => a.name.localeCompare(b.name, "de"));
  const eltern = dirname(pfad) !== pfad ? dirname(pfad) : (istWindows() ? "" : null);
  return { ok: true, pfad, eltern, ordner: ordner.slice(0, MAX_LISTE), mehr: ordner.length > MAX_LISTE || undefined };
}

// Zuletzt benutzte Ordner: eine kleine Datei im Support-Ordner (nicht im Browser gemerkt — der Port wechselt bei jedem Start, und damit die Herkunft der Seite).
const zuletztDatei = (support) => join(support, "browser-zuletzt.json");
export function leseZuletzt(support) {
  try { const l = JSON.parse(readFileSync(zuletztDatei(support), "utf8")); return Array.isArray(l) ? l.filter((p) => typeof p === "string" && isAbsolute(p) && existsSync(p)).slice(0, MAX_ZULETZT) : []; } catch { return []; }
}
export function merkeZuletzt(support, pfad) {
  const neu = [pfad, ...leseZuletzt(support).filter((p) => p !== pfad)].slice(0, MAX_ZULETZT);
  try { mkdirSync(support, { recursive: true }); writeFileSync(zuletztDatei(support), JSON.stringify(neu), { mode: 0o600 }); } catch { /* nur eine Bequemlichkeit */ }
  return neu;
}
export function startAuswahl(support, { home = homedir() } = {}) {
  const orte = [home, ...["Documents", "Dokumente", "Desktop", "Schreibtisch"].map((n) => join(home, n))].filter((p) => { try { return statSync(p).isDirectory(); } catch { return false; } });
  return { ok: true, home, trenner: sep, zuletzt: leseZuletzt(support), orte };
}

// git ohne Dialog prüfen (wie die App: `git-pruefen` → stand). Nur `git --version`, nie eine Installation.
export function pruefeGit({ lauf = spawnSync } = {}) {
  let r;
  try { r = lauf("git", ["--version"], { encoding: "utf8", timeout: 8000, windowsHide: true }); } catch { return { stand: "nicht-pruefbar" }; }
  if (r?.error) return r.error.code === "ENOENT" ? { stand: "fehlt" } : { stand: "nicht-pruefbar", meldung: String(r.error.message).slice(0, 200) };
  if (r?.status === 0) return { stand: "vorhanden", version: String(r.stdout || "").trim().replace(/^git version\s+/, "") };
  return { stand: "defekt", meldung: String(r?.stderr || "").trim().slice(0, 200) };
}
export const gitInstallHinweis = (plattform = process.platform) => (plattform === "win32"
  ? "Installiere Git für Windows von git-scm.com und starte Kortex danach neu."
  : "Installiere Git mit dem Paketmanager deines Systems (zum Beispiel `sudo apt install git`) und starte Kortex danach neu.");

// Stand der Einrichtung (E1/E2) im Browser: die App führt ihn in Swift, hier eine kleine Datei im Support-Ordner. { letzterSchritt: null|"vault"|"ki"|"sicherung", ende: null|"fertig"|"spaeter" }
const SCHRITTE = ["vault", "ki", "sicherung"];
const einrichtungsDatei = (support) => join(support, "browser-einrichtung.json");
export function leseEinrichtung(support) {
  try { const o = JSON.parse(readFileSync(einrichtungsDatei(support), "utf8")); return { letzterSchritt: SCHRITTE.includes(o?.letzterSchritt) ? o.letzterSchritt : null, ende: ["fertig", "spaeter"].includes(o?.ende) ? o.ende : null }; }
  catch { return { letzterSchritt: null, ende: null }; }
}
export function schreibeEinrichtung(support, { schritt, ende } = {}) {
  const o = leseEinrichtung(support);
  if (SCHRITTE.indexOf(schritt) > SCHRITTE.indexOf(o.letzterSchritt)) o.letzterSchritt = schritt; // nie rückwärts (indexOf(null) = -1)
  if (["fertig", "spaeter"].includes(ende)) o.ende = ende;
  try { mkdirSync(support, { recursive: true }); writeFileSync(einrichtungsDatei(support), JSON.stringify(o), { mode: 0o600 }); } catch { /* der Stand ist eine Bequemlichkeit */ }
  return o;
}
