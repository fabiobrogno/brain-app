// umstellung/protokoll.mjs — Ablage, Zustand und Protokoll der Umstellung (Paket P7b, Plan docs/plaene/p7-umstellung.md Abschnitt 5).
//
//   <Support>/umstellung/<Kennung>/            (0700)
//     zustand.json       Phase, erledigte Schritte, Versionen (atomar, 0600) – keine Werte
//     protokoll.jsonl    je Zeile { zeit, lauf: probe|original, schritt, ereignis: start|ok|nichts|uebersprungen|fehler|rueckweg, sicherung?, hashVorher?, hashNachher?, anzahl?, grund? }
//                        – nie ein Wert (kein Hook-Befehl, kein git-Wert, keine Adresse); `grund` ist ein fester Kurztext aus dem Wortschatz der Schritte
//     sicherungen/<zeit>/…   Kopien und Rückweg-Angaben MIT Werten (0600) – nur hier
//     vor-kortex.bundle, probelauf.json, laeuft, bericht.txt
//   Der Probelauf-Merker (probelauf.json) gilt nur für denselben Stand (Fingerabdruck, siehe pruefung.mjs).
import { mkdirSync, writeFileSync, readFileSync, renameSync, rmSync, rmdirSync, openSync, closeSync, copyFileSync, chmodSync, appendFileSync, existsSync, readdirSync, lstatSync, statSync, realpathSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { createHash } from "node:crypto";
import { kennung } from "./ziele.mjs";

export const ZUSTAND_VERSION = 1;
export const ablageOrdner = (z) => join(z.support, "umstellung", kennung(z.vault));
export function oeffneAblage(z) {
  const a = ablageOrdner(z);
  mkdirSync(a, { recursive: true, mode: 0o700 });
  try { chmodSync(join(z.support, "umstellung"), 0o700); chmodSync(a, 0o700); } catch { /* best effort */ }
  return a;
}

export const jetztIso = () => new Date().toISOString();
export const lauf = (z) => (z.probe ? "probe" : "original");

// SHA-256 einer Datei (folgt einem Verweis, wie der Leser), null wenn es sie nicht gibt/nicht lesbar ist.
export function hashDatei(p) {
  try { return createHash("sha256").update(readFileSync(p)).digest("hex"); } catch { return null; }
}
export const hashText = (t) => createHash("sha256").update(t).digest("hex");

// Atomar schreiben (Temp im selben Ordner + rename); der Modus bleibt bei bestehenden Dateien erhalten, sonst `modus`. Folgt einem Verweis nicht: das Ziel ist `ziel`.
export function schreibeAtomar(ziel, inhalt, modus = 0o600) {
  mkdirSync(dirname(ziel), { recursive: true });
  let m = modus;
  try { m = statSync(ziel).mode & 0o777; } catch { /* neu */ }
  const tmp = `${ziel}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tmp, inhalt, { mode: m });
    chmodSync(tmp, m);
    renameSync(tmp, ziel);
  } catch (e) { try { rmSync(tmp, { force: true }); } catch { /* weg */ } throw e; }
}

// Wie git selbst schreibt: <Datei>.lock exklusiv anlegen (existiert sie schon, schreibt gerade jemand – dann KEIN Schreiben), Inhalt hineinschreiben, über die Datei umbenennen.
// Für die globale git-Konfiguration des Nutzers (~/.gitconfig): ein gleichzeitig laufendes `git config --global` verliert so nichts. `inhalt === null` löscht die Datei (unter derselben Sperre).
export function schreibeMitLock(ziel, inhalt, modus = 0o600) {
  const lock = `${ziel}.lock`;
  mkdirSync(dirname(ziel), { recursive: true });
  let fd = null;
  try { fd = openSync(lock, "wx", modus); } catch (e) { const f = new Error("git-config-gesperrt"); f.code = e && e.code; throw f; }
  try {
    if (inhalt === null) { closeSync(fd); fd = null; rmSync(ziel, { force: true }); rmSync(lock, { force: true }); return; }
    writeFileSync(fd, inhalt); closeSync(fd); fd = null;
    chmodSync(lock, modusVon(ziel, modus));
    renameSync(lock, ziel);
  } catch (e) {
    if (fd !== null) { try { closeSync(fd); } catch { /* weg */ } }
    try { rmSync(lock, { force: true }); } catch { /* weg */ }
    throw e;
  }
}

// Ein Verweis auf eine Datei (z. B. settings.json aus einem Dotfiles-Ordner) bleibt ein Verweis: geschrieben wird beim echten Ziel.
export const echtesDateiZiel = (datei) => { try { return lstatSync(datei).isSymbolicLink() ? realpathSync(datei) : datei; } catch { return datei; } };
// Stellt `datei` aus der Kopie `quelle` wieder her (atomar, über einen Verweis hinweg); die Rechte einer vorhandenen Datei bleiben, sonst `modus`.
export function stelleHer(datei, quelle, modus = 0o600) { schreibeAtomar(echtesDateiZiel(datei), readFileSync(quelle), modus); }
export function modusVon(datei, standard = 0o600) { try { return statSync(datei).mode & 0o777; } catch { return standard; } }

// --- Zustand -------------------------------------------------------------------------------------------------------------------
export function leerZustand() { return { version: ZUSTAND_VERSION, phase: null, kernVersion: null, schritte: {}, laeuft: null }; }
export function liesZustand(z) {
  try {
    const j = JSON.parse(readFileSync(join(ablageOrdner(z), "zustand.json"), "utf8"));
    return j && typeof j === "object" && !Array.isArray(j) ? { ...leerZustand(), ...j, schritte: { ...(j.schritte || {}) } } : leerZustand();
  } catch { return leerZustand(); }
}
export function schreibeZustand(z, zustand) {
  oeffneAblage(z);
  schreibeAtomar(join(ablageOrdner(z), "zustand.json"), JSON.stringify(zustand, null, 2) + "\n");
}

// --- Protokoll -----------------------------------------------------------------------------------------------------------------
const ERLAUBTE_FELDER = new Set(["zeit", "lauf", "schritt", "ereignis", "sicherung", "hashVorher", "hashNachher", "anzahl", "grund"]);
export function protokolliere(z, eintrag) {
  oeffneAblage(z);
  const zeile = { zeit: jetztIso(), lauf: lauf(z) };
  for (const [k, v] of Object.entries(eintrag)) if (ERLAUBTE_FELDER.has(k) && v !== undefined && v !== null) zeile[k] = v;
  if (zeile.lauf !== "probe" && zeile.lauf !== "original") zeile.lauf = lauf(z);
  const datei = join(ablageOrdner(z), "protokoll.jsonl");
  appendFileSync(datei, JSON.stringify(zeile) + "\n", { mode: 0o600 });
  try { chmodSync(datei, 0o600); } catch { /* best effort */ }
}
export function liesProtokoll(z) {
  try { return readFileSync(join(ablageOrdner(z), "protokoll.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; }
}

// --- Sicherungen (mit Werten, 0600) -------------------------------------------------------------------------------------------
// eindeutig auch bei zwei Läufen in derselben Sekunde (sonst überschriebe der zweite Lauf die Rückweg-Angaben des ersten): Millisekunden und eine Zufallszahl
export const stempel = () => `${new Date().toISOString().replace(/[-:]/g, "").replace(/\.(\d+)Z$/, "$1Z").replace("T", "-")}-${Math.random().toString(16).slice(2, 6)}`;
export function sicherungsOrdner(z, name) {
  const d = join(ablageOrdner(z), "sicherungen", name);
  mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
}
// Kopiert `quelle` nach <ordner>/<name> (0600) → { rel (relativ zur Ablage), hash } oder null, wenn es die Quelle nicht gibt.
export function sichereDatei(z, ordner, quelle, name) {
  if (!existsSync(quelle)) return null;
  const ziel = join(ordner, name);
  mkdirSync(dirname(ziel), { recursive: true, mode: 0o700 });
  copyFileSync(quelle, ziel);
  chmodSync(ziel, 0o600);
  return { rel: relative(ablageOrdner(z), ziel), hash: hashDatei(ziel) };
}
export const sicherungsPfad = (z, rel) => join(ablageOrdner(z), rel);

// Rückweg-Angaben eines Schritts (JSON, 0600) → relativer Pfad
export function schreibeUndo(z, ordner, schritt, objekt) {
  const datei = join(ordner, `${schritt}.undo.json`);
  schreibeAtomar(datei, JSON.stringify(objekt, null, 2) + "\n", 0o600);
  return relative(ablageOrdner(z), datei);
}
export function liesUndo(z, rel) {
  try { const j = JSON.parse(readFileSync(sicherungsPfad(z, rel), "utf8")); return j && typeof j === "object" ? j : null; } catch { return null; }
}

// --- Sperre --------------------------------------------------------------------------------------------------------------------
// <Ablage>/laeuft = { pid, zeit }: verhindert parallele Läufe. Eine Sperre eines toten Prozesses gilt als Rest eines Absturzes (→ "unterbrochen") und wird ersetzt.
export function pruefeSperre(z) {
  const datei = join(ablageOrdner(z), "laeuft");
  let j = null;
  try { j = JSON.parse(readFileSync(datei, "utf8")); } catch { return { belegt: false, unterbrochen: false }; }
  let lebt = false;
  try { process.kill(Number(j.pid), 0); lebt = Number(j.pid) !== process.pid; } catch (e) { lebt = !!(e && e.code === "EPERM"); }
  return lebt ? { belegt: true, unterbrochen: false } : { belegt: false, unterbrochen: true };
}
export function setzeSperre(z) {
  const s = pruefeSperre(z);
  if (s.belegt) return false;
  oeffneAblage(z);
  schreibeAtomar(join(ablageOrdner(z), "laeuft"), JSON.stringify({ pid: process.pid, zeit: jetztIso() }) + "\n");
  return true;
}
export function loeseSperre(z) { try { rmSync(join(ablageOrdner(z), "laeuft"), { force: true }); } catch { /* weg */ } }

// Vault-Sperre wie `brain lock` (.logs/ingest.lock, frisch < 30 Minuten): Pflege und Tageslauf schreiben währenddessen nicht. → true, wenn gesetzt (oder schon von uns)
export function setzeVaultSperre(z) {
  const f = join(z.vault, ".logs", "ingest.lock");
  try { const st = lstatSync(f); if (Date.now() - st.mtimeMs < 30 * 60_000) return { ok: false }; rmSync(f, { force: true }); } catch { /* keine */ }
  try { mkdirSync(join(z.vault, ".logs"), { recursive: true }); writeFileSync(f, `${jetztIso()}\n`, { flag: "wx" }); return { ok: true, datei: f }; } catch { return { ok: false }; }
}
export function loeseVaultSperre(z) {
  try { rmSync(join(z.vault, ".logs", "ingest.lock"), { force: true }); } catch { /* weg */ }
  try { rmdirSync(join(z.vault, ".logs")); } catch { /* nicht leer (üblich) oder weg */ }   // einen leeren .logs-Ordner, den wir angelegt haben, nicht hinterlassen
}

// Eigene Sperre für Phase B und ihren Rückweg (Review P7d): .logs/umstellung-phase-b.lock { pid, zeit }. Die Werkstatt (gemeinsam/umstellung-sperre.mjs) liest sie: Speichern/Abgleichen im
// Studio melden 409, solange sie da ist. Format und Lesen dort. Am Original nur (die Kopie des Probelaufs braucht sie nicht).
export function setzePhaseBSperre(z) {
  if (z.probe) return { ok: true, datei: null };
  const f = join(z.vault, ".logs", "umstellung-phase-b.lock");
  try { mkdirSync(join(z.vault, ".logs"), { recursive: true }); writeFileSync(f, JSON.stringify({ pid: process.pid, zeit: jetztIso() }) + "\n"); return { ok: true, datei: f }; } catch { return { ok: false }; }
}
export function loesePhaseBSperre(z) {
  if (z.probe) return;
  try { rmSync(join(z.vault, ".logs", "umstellung-phase-b.lock"), { force: true }); } catch { /* weg */ }
  try { rmdirSync(join(z.vault, ".logs")); } catch { /* nicht leer (üblich) oder weg */ }
}

export function listeSicherungen(z) {
  try { return readdirSync(join(ablageOrdner(z), "sicherungen")).sort(); } catch { return []; }
}
