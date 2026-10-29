#!/usr/bin/env node
// gedaechtnis.mjs — Gemeinsames Gedächtnis für mehrere Claude-Konten (Auto-Memory je Projekt), per 3-Wege-Abgleich.
// Claude Code legt das Auto-Memory je Konto unter <konto>/projects/<projekt-schlüssel>/memory/ ab (MEMORY.md als Index, dazu
// Themen-Dateien). Der Projekt-Schlüssel (Pfad, Nicht-Alphanumerisches → „-“) ist bei allen Konten gleich. JEDES Konto behält einen
// ECHTEN memory-Ordner (Claude darf dort schreiben, ein Konto mit Git sichert ihn weiter nach GitHub); die Wurzel (Standard
// ~/.claude-gedaechtnis, lokales Git-Repo ohne Remote) ist nur der Knoten, über den abgeglichen wird. Angefasst wird NUR
// projects/<P>/memory (Verläufe *.jsonl, Einstellungen usw. bleiben, wo sie sind).
//
// CLI:  node gedaechtnis.mjs [vault] [status|abgleichen] [--projekt <P>] [--anwenden] [--erzwingen] [--json] [--ins-log] [--warte <s>]   (brain gedaechtnis …)
//   status      je Projekt und Konto: abgeglichen oder was aussteht, offene Konflikte (nur lesend)
//   abgleichen  Plan als Trockenlauf; mit --anwenden ausführen. Idempotent: ein zweiter Lauf meldet „nichts zu tun“.
//   --projekt   nur dieses Projekt (Schlüssel, wie Claude ihn vergibt); --ins-log: Ergebniszeile in <vault>/.logs/hooks.log;
//   --warte     bei belegter Sperre bis zu so viele Sekunden warten (die Hook-Läufe tun das: 30)
//   --erzwingen hebt den Massenlöschungs-Riegel auf (siehe unten) — erst nach Prüfung des Trockenlaufs
// (verbinden/trennen der Symlink-Version gibt es nicht mehr.)
// Einstellungen (brain.config.json#automatik, brain einstellungen …): gedaechtnisTeilen aus|an (Standard aus: nur dann gleicht der
// Tageslauf von selbst ab und stoßen SessionStart/SessionEnd einen Abgleich des aktuellen Projekts an), gedaechtnisWurzel (Standard
// ~/.claude-gedaechtnis), gedaechtnisKonten (Standard nur ~/.claude — weitere Konten trägt man selbst ein; mit einem Konto bleibt es
// beim Verlauf in der Wurzel). Für andere Module: gedaechtnisPfade(werte) → { teilen, wurzel, konten } (aufgelöste, absolute Pfade).
//
// Modell: Wurzel <wurzel>/<P>/ = zusammengeführter Stand je Projekt (Git-Verlauf in der Wurzel). Je Konto und Projekt ein Manifest
// <wurzel>/.abgleich/<kontoname>/<P>.json { datei: blob-sha } = der Stand, den dieses Konto beim letzten Abgleich hatte (Basis). Die
// Blob-SHA ist die von `git hash-object`; die Basisinhalte liegen so in der Objektdatenbank der Wurzel (beim Abgleich mit
// `git hash-object -w` geschrieben, lesbar mit `git cat-file blob <sha>`).
//
// Ablauf je Projekt P (gleicheAb), Konten in der Reihenfolge der Liste:
//  1. Lesen: Dateien aus K/projects/P/memory/ (fehlt der Ordner: leer). Änderung des Kontos = Abweichung vom Manifest (neu/geändert/gelöscht).
//  2. Zusammenführen in die Wurzel, je Datei und Konto (aktuell = Wurzelstand inkl. der schon eingearbeiteten Konten, Basis = Manifest,
//     andere = Konto): gleich → ok · nur das Konto geändert → übernehmen (auch Löschen) · nur die Wurzel geändert (z. B. vom Traum oder
//     vom anderen Konto) → bleibt, wird nie zurückgedreht · beide verschieden → `git merge-file`; MEMORY.md (und _konflikte.md) mit
//     --union, danach exakte Doppelzeilen entfernt und Zeilen mit gleicher verlinkter Datei „(xyz.md)“ nach der Basis entschieden (bereinigeIndexBefund: hat nur das
//     Konto die Zeile geändert, gewinnt seine Fassung; haben beide sie verschieden geändert, bleibt die der Wurzel und die des Kontos wird MEMORY.konflikt-<konto>.md
//     + Eintrag in _konflikte.md — nie still verworfen); sonstige Dateien: Konfliktmarken
//     → die Wurzel behält ihre Fassung (die des ersten Kontos der Liste), die andere wird <stamm>.konflikt-<konto><endung> und in
//     _konflikte.md vermerkt (für den Traum). Gelöscht auf einer Seite, geändert auf der anderen → die Änderung gewinnt.
//     Erster Lauf (kein Manifest): Basis leer → alles ist „neu“; identische Dateien werden eins, verschiedene → MEMORY.md union, sonst Konflikt-Kopie.
//  3. Verteilen: Wurzelstand in jedes Konto schreiben (nur geänderte Dateien, atomar per Temp-Datei + rename; gelöschte entfernen).
//     Vorher je Datei prüfen, ob die Konto-Datei seit dem Lesen (Schritt 1) verändert wurde (Hash) — dann bleibt sie für dieses Konto
//     unangetastet (der nächste Abgleich holt sie). Fehlt K/projects/P/ ganz, wird es angelegt (die erste Sitzung sieht das Gedächtnis schon).
//     Die Temp-Dateien liegen in K/projects/P/ (nicht in memory/), damit ein `git add memory` der Konto-Sicherung (session-hintergrund.mjs)
//     nie eine halbfertige Datei erwischt.
//  4. Manifeste aktualisieren (nur bei vollständigem Erfolg des Kontos), Wurzel committen (Zähler in der Nachricht). Ohne Änderung kein Commit.
//  Symlinks: ein memory-Symlink aus der früheren Version (auf <wurzel>/<P>) wird durch einen echten Ordner mit dem Wurzelstand ersetzt;
//  ein Symlink auf etwas anderes oder eine Datei „memory“ bleibt unangetastet (Hinweis).
//  Fehlt ein memory-Ordner, obwohl das Konto ein Manifest hat, gilt das NICHT als „alles gelöscht“ (sonst löschte ein versehentlich
//  entfernter Ordner das gemeinsame Gedächtnis): die Dateien werden zurückgeschrieben.
//  Dasselbe gilt für die Wurzel: fehlt <wurzel>/<P>/ (oder ist leer), obwohl Manifeste mit Dateien stehen (z. B. ein versehentliches `rm -rf`), zählt das NICHT als „in der Wurzel
//  gelöscht“ — es gibt keine Löschungen, die Wurzel wird aus den Konten neu aufgebaut (Hinweis). Lässt sich eine Datei oder ein Ordner nicht lesen (EACCES, EIO; leseBaum.fehler),
//  wird das Projekt in diesem Lauf nicht angefasst (Fehler im Ergebnis, ok=false) — die Datei wäre sonst „gelöscht“ und wanderte in alle Konten.
//  Massenlöschungs-Riegel: würde ein Lauf in einem Konto mehr als die Hälfte seiner Dateien löschen (und mindestens 3), wird das Projekt nicht angewendet (Warnung mit dem
//  Befehl; vom Traum aufgelöste Konflikt-Kopien zählen nicht mit). Mit `--erzwingen` (gleicheAb: erzwingen) läuft es durch; Trockenlauf und Status zeigen die Warnung ebenfalls.
//  Konflikt-Kopien haben EIN Format, das von hier geschrieben und von allen Lesern (auch dem Traum) über dieselben Funktionen gelesen wird:
//  Name <stamm>.konflikt-<konto>[-n]<endung> (leseKonfliktName/istKonfliktKopie), Eintrag in <P>/_konflikte.md als Zeile
//  „- <Datum> · <konto>: `<datei>` weicht ab → Kopie `<kopie>`“ (konfliktZeile/leseKonfliktEintraege). Hat der Traum eine Kopie aufgelöst — Frontmatter
//  `status: aufgeloest` (istAufgeloesteKopie) —, räumt der nächste Abgleich sie auf: Kopie aus Wurzel UND Konten entfernen, Eintrag aus _konflikte.md streichen
//  (ist die Liste danach leer, entfällt auch sie). Das ist eine bewusste Löschung: nur Dateien mit Konflikt-Namensmuster UND status: aufgeloest UND vorhandenem
//  Original; sie steht im Plan („aufgeloeste“), in der Ergebniszeile/dem Commit der Wurzel, und die Sicherung (.tgz) davor enthält die Kopien noch.
//  Projekt-Schlüssel: projektKlasse/istEchterProjektSchluessel sind die EINE Definition (Aufbau + Temp-/Scratchpad-Ausschluss) für Abgleich und Traum.
//  Die Wurzel bekommt `git config gc.pruneExpire never` (beim Anlegen, bei älteren Wurzeln beim nächsten anwendenden Lauf): die Basis-Blobs übersprungener
//  Dateien sind unerreichbare Objekte und dürfen nicht nach zwei Wochen verschwinden.
//  Davor, nur wenn sich Dateien ändern: Sicherung als <wurzel>-sicherungen/<zeit>.tgz (Aufbau konten/<kontoname>/<P>/… und wurzel/<P>/…);
//  scheitert sie, wird nichts geändert. Danach wird rotiert: es bleiben die neuesten 30 UND alle, die jünger als 14 Tage sind (rotiereSicherungen).
//  Sperre <wurzel>.lock (eine veraltete, > 15 min, übernimmt genau einer: Wache + rename, siehe uebernimmVeraltete). git und tar laufen mit Zeitgrenzen
//  (git 60 s, tar 120 s, ZEIT_STANDARD): Überschreitung = Fehler (je Projekt bzw. „Sicherung fehlgeschlagen“), die Sperre wird in jedem Fall freigegeben.
//  Übersprungen werden Projekte mit „-private-…“, „-tmp…“ und anderen
//  Temp-/Scratchpad-Pfaden, Symlinks innerhalb von memory, Konten, die es nicht gibt oder die keine Claude-Konten sind (weder projects/
//  noch settings.json), und fremde Symlinks.
// Nur Node-Standardbibliothek und git. Nie echte Nutzerdaten in Tests: die Tests arbeiten mit zwei Fake-Konten in einem Temp-HOME.
import {
  readdirSync, readFileSync, writeFileSync, mkdirSync, lstatSync, statSync, realpathSync, readlinkSync, renameSync,
  rmSync, rmdirSync, utimesSync, existsSync, mkdtempSync, openSync, closeSync, unlinkSync, cpSync, appendFileSync,
} from "node:fs";
import { join, dirname, basename, resolve, sep } from "node:path";
import { homedir, tmpdir } from "node:os";
import { spawnSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { vaultPfadOderEnde, ladeConfig } from "./pfade.mjs";
import { leseAutomatik, STANDARD } from "./einstellungen.mjs";
import { gitBefehl } from "./werkzeug.mjs";

export const STANDARD_WURZEL = STANDARD.gedaechtnisWurzel;      // ~/.claude-gedaechtnis (einstellungen.mjs)
export const STANDARD_KONTEN = STANDARD.gedaechtnisKonten;      // ~/.claude (weitere Konten trägt man selbst ein)
const INDEX = "MEMORY.md";
const KONFLIKTE = "_konflikte.md";
const MANIFEST_ORDNER = ".abgleich";
const SPERRE_ALTER_MS = 15 * 60 * 1000;
const TEMP_ALTER_MS = 60 * 60 * 1000;
const NUR_ORDNER = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

// ------------------------------------------------------------------------------------------ Pfade und Einstellungen
export function expandiere(pfad, home = homedir()) {
  const s = String(pfad ?? "").trim();
  if (s === "~") return resolve(home);
  if (/^~[\\/]/.test(s)) return resolve(home, s.slice(2));
  return resolve(s);
}

// werte: leseAutomatik(vault).werte → { teilen, wurzel, konten } (absolut, Kontenliste ohne Dubletten)
export function gedaechtnisPfade(werte = {}, { home = homedir() } = {}) {
  const wurzel = expandiere(werte.gedaechtnisWurzel || STANDARD_WURZEL, home);
  const roh = Array.isArray(werte.gedaechtnisKonten) ? werte.gedaechtnisKonten : STANDARD_KONTEN;
  const konten = [...new Set(roh.filter((k) => typeof k === "string" && k.trim()).map((k) => expandiere(k, home)))];
  return { teilen: werte.gedaechtnisTeilen === "an", wurzel, konten };
}

export const projektSchluessel = (pfad) => String(pfad).replace(/[^A-Za-z0-9]/g, "-");

// Temp-/Scratchpad-Projekte (Schlüssel wie bei Claude Code): -private-…, -tmp…, -var-folders-…, …scratchpad…, Windows …-AppData-Local-Temp,
// sowie der Schlüssel des Temp-Ordners dieses Systems.
export function istTempProjekt(projekt, { temp = [tmpdir()] } = {}) {
  const p = String(projekt);
  if (/^-private-/.test(p) || /^-tmp/.test(p) || /^-var-folders-/.test(p) || /-scratchpad/i.test(p) || /-AppData-Local-Temp(-|$)/i.test(p)) return true;
  for (const t of temp) {
    const kandidaten = new Set([projektSchluessel(t)]);
    try { kandidaten.add(projektSchluessel(realpathSync(t))); } catch {}
    for (const k of kandidaten) if (p === k || p.startsWith(`${k}-`)) return true;
  }
  return false;
}

// Projekt-Schlüssel bestehen nur aus Buchstaben, Ziffern und „-“ (alles andere wurde zu „-“). Ordner mit anderen Namen in der Wurzel
// (z. B. „_traum“, „.git“, „.abgleich“) sind keine Projekte — andere Werkzeuge dürfen dort eigene Dinge ablegen, sie werden nie angefasst.
export const istProjektSchluessel = (name) => /^[A-Za-z0-9-]+$/.test(String(name));
// Die EINE Einordnung eines Ordnernamens: "projekt" | "temporaer" (Scratchpad/Temp) | "kein-schluessel". Abgleich und Traum fragen nur hier.
export function projektKlasse(name, opt = {}) {
  if (!istProjektSchluessel(name)) return "kein-schluessel";
  return istTempProjekt(name, opt) ? "temporaer" : "projekt";
}
export const istEchterProjektSchluessel = (name, opt = {}) => projektKlasse(name, opt) === "projekt";
const unter = (kind, eltern) => { const a = resolve(kind), b = resolve(eltern); return a === b || a.startsWith(b.endsWith(sep) ? b : b + sep); };
const kurzPfad = (p, home = homedir()) => (p === home ? "~" : p.startsWith(home + sep) ? `~${sep}${p.slice(home.length + 1)}` : p);
const zweistellig = (n) => String(n).padStart(2, "0");
export function zeitMarke(jetzt = Date.now()) {
  const d = new Date(jetzt);
  return `${d.getFullYear()}${zweistellig(d.getMonth() + 1)}${zweistellig(d.getDate())}-${zweistellig(d.getHours())}${zweistellig(d.getMinutes())}${zweistellig(d.getSeconds())}`;
}
const datumTag = (jetzt) => { const d = new Date(jetzt); return `${d.getFullYear()}-${zweistellig(d.getMonth() + 1)}-${zweistellig(d.getDate())}`; };
const ohneGitEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
const erste = (text) => String(text ?? "").split("\n")[0];

// Kontoname aus dem Ordnernamen (.claude-privat → claude-privat), eindeutig innerhalb der Liste
function kontoNamen(konten) {
  const belegt = new Set();
  return konten.map((pfad) => {
    const basis = basename(pfad).replace(/^\.+/, "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "konto";
    let name = basis, n = 2;
    while (belegt.has(name)) name = `${basis}-${n++}`;
    belegt.add(name);
    return name;
  });
}
const istKonto = (pfad) => NUR_ORDNER(pfad) && ["projects", "settings.json", ".claude.json", ".credentials.json"].some((n) => existsSync(join(pfad, n)));

// ------------------------------------------------------------------------------------------ Dateibäume im Speicher
// Dateinamen aus dem Dateisystem sind nie „..“ — trotzdem nie etwas schreiben, das aus dem Ordner herausführt.
const sicherRel = (rel) => rel && !rel.startsWith("/") && !rel.split("/").some((s) => s === "" || s === "." || s === "..");

// Alle Dateien unter dir → { dateien: Map<rel mit "/", { b: Buffer, t: mtimeMs }>, uebersprungen: [rel], fehler: [Text] }. Symlinks und Sonderdateien werden
// ausgelassen (uebersprungen). Eine Datei oder ein Ordner, der sich nicht lesen lässt (EACCES, EIO, …), kommt in `fehler` — nie stillschweigend in die Auslassung:
// der Abgleich bricht das Projekt dann ab, statt die Datei als „gelöscht“ zu werten. Was zwischen Auflisten und Lesen verschwindet (ENOENT), ist wirklich weg.
export function leseBaum(dir) {
  const dateien = new Map(), uebersprungen = [], fehler = [];
  const geh = (d, pre) => {
    let eintraege = [];
    try { eintraege = readdirSync(d, { withFileTypes: true }); }
    catch (e) { if (e.code !== "ENOENT") fehler.push(`${pre || "(oberster Ordner)"}: Ordner nicht lesbar (${e.code || erste(e.message)})`); return; }
    for (const e of eintraege) {
      if (e.name === ".DS_Store" || e.name === "Thumbs.db") continue;
      const rel = pre ? `${pre}/${e.name}` : e.name, p = join(d, e.name);
      if (e.isSymbolicLink()) uebersprungen.push(rel);
      else if (e.isDirectory()) geh(p, rel);
      else if (e.isFile()) {
        try { dateien.set(rel, { b: readFileSync(p), t: statSync(p).mtimeMs }); }
        catch (err) { if (err.code !== "ENOENT") fehler.push(`${rel}: nicht lesbar (${err.code || erste(err.message)})`); }
      }
      else uebersprungen.push(rel);
    }
  };
  geh(dir, "");
  return { dateien, uebersprungen, fehler };
}

// Blob-SHA wie `git hash-object` (Objektformat der Wurzel: sha1, selten sha256)
export const blobHash = (buf, algo = "sha1") => createHash(algo).update(`blob ${buf.length}\0`).update(buf).digest("hex");
const eintrag = (algo, b, t) => ({ b, sha: blobHash(b, algo), t });
const gleichBytes = (a, b) => a.length === b.length && a.equals(b);

// SHA der Datei auf der Platte (null = gibt es nicht; „?“ = nicht lesbar/keine Datei → gilt als verändert)
function dateiSha(pfad, algo) {
  try { return blobHash(readFileSync(pfad), algo); } catch (e) { return e.code === "ENOENT" ? null : "?"; }
}

let tempZaehler = 0;
// Atomar schreiben: Temp-Datei in tmpDir (gleiches Dateisystem), dann rename. pruefe() läuft unmittelbar vor dem rename; false → nichts geschrieben.
function schreibeAtomar(ziel, buf, t, tmpDir, pruefe = null) {
  mkdirSync(dirname(ziel), { recursive: true });
  const tmp = join(tmpDir, `.gedaechtnis-${process.pid}-${++tempZaehler}.tmp`);
  try {
    writeFileSync(tmp, buf);
    if (t) { try { utimesSync(tmp, new Date(t), new Date(t)); } catch {} }
    if (pruefe && !pruefe()) { rmSync(tmp, { force: true }); return false; }
    renameSync(tmp, ziel);
    return true;
  } catch (e) { try { rmSync(tmp, { force: true }); } catch {} throw e; }
}
// Datei löschen (nach pruefe()) und leer gewordene Unterordner bis ausschließlich `wurzelDir` entfernen
function entferneDatei(ziel, wurzelDir, pruefe = null) {
  if (pruefe && !pruefe()) return false;
  unlinkSync(ziel);
  for (let d = dirname(ziel); resolve(d) !== resolve(wurzelDir) && unter(d, wurzelDir); d = dirname(d)) {
    try { rmdirSync(d); } catch { break; }
  }
  return true;
}
// Reste abgebrochener Läufe (.gedaechtnis-*.tmp, älter als eine Stunde) wegräumen
function raeumeTempAuf(dir) {
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile() || !/^\.gedaechtnis-.*\.tmp$/.test(e.name)) continue;
      try { if (Date.now() - statSync(join(dir, e.name)).mtimeMs > TEMP_ALTER_MS) unlinkSync(join(dir, e.name)); } catch {}
    }
  } catch {}
}

// ------------------------------------------------------------------------------------------ Konflikt-Kopien und MEMORY.md
export function konfliktName(rel, konto, n = 1) {
  const i = rel.lastIndexOf("/"), pfad = i >= 0 ? rel.slice(0, i + 1) : "", name = rel.slice(i + 1);
  const punkt = name.lastIndexOf(".");
  const stamm = punkt > 0 ? name.slice(0, punkt) : name, ext = punkt > 0 ? name.slice(punkt) : ".md";
  return `${pfad}${stamm}.konflikt-${konto}${n > 1 ? `-${n}` : ""}${ext}`;
}

// Gegenstück zu konfliktName: <pfad><stamm>.konflikt-<konto>[-n]<endung> → { pfad, stamm, konto, n, endung, original } | null.
// Das Konto steht ohne „.“ (kontoNamen), die Endung ist der Rest nach dem letzten Punkt; „claude-2“ als Konto und „claude“ mit n=2 sind nicht zu unterscheiden (egal: nur das Original zählt).
const KONFLIKT_KOPIE = /^((?:.*\/)?)([^/]+?)\.konflikt-([A-Za-z0-9_-]+?)(?:-(\d+))?(\.[^./]+)$/;
export function leseKonfliktName(rel) {
  const m = KONFLIKT_KOPIE.exec(String(rel ?? ""));
  return m ? { pfad: m[1], stamm: m[2], konto: m[3], n: m[4] ? Number(m[4]) : 1, endung: m[5], original: `${m[1]}${m[2]}${m[5]}` } : null;
}
export const istKonfliktKopie = (rel) => leseKonfliktName(rel) !== null;

// _konflikte.md: Kopf + je Konflikt EINE Zeile. konfliktZeile schreibt sie, leseKonfliktEintraege liest exakt dieses Format (keine „toleranten“ Treffer).
export const KONFLIKT_KOPF = "# Offene Konflikte im gemeinsamen Gedächtnis\n\nBei jedem Eintrag gilt die Fassung in der Wurzel; die abweichende Fassung des Kontos liegt als Kopie daneben. "
  + "Prüfen, Wichtiges übernehmen, Kopie löschen und die Zeile hier entfernen.\n\n";
export const konfliktZeile = ({ datum, konto, datei, kopie }) => `- ${datum} · ${konto}: \`${datei}\` weicht ab → Kopie \`${kopie}\``;
const KONFLIKT_ZEILE = /^- (\d{4}-\d{2}-\d{2}) · ([A-Za-z0-9_-]+): `([^`\n]+)` weicht ab → Kopie `([^`\n]+)`\s*$/;
export function leseKonfliktEintraege(text) {
  const aus = [];
  String(text ?? "").split("\n").forEach((z, index) => { const m = KONFLIKT_ZEILE.exec(z); if (m) aus.push({ index, datum: m[1], konto: m[2], datei: m[3], kopie: m[4] }); });
  return aus;
}
// Zeilen streichen, deren Kopie in `kopien` (Set) steht; alles andere bleibt. Bleibt nur Kopf oder nichts übrig → "" (die Liste entfällt).
export function streicheKonfliktEintraege(text, kopien = new Set()) {
  const weg = new Set(leseKonfliktEintraege(text).filter((e) => kopien.has(e.kopie)).map((e) => e.index));
  const neu = String(text ?? "").split("\n").filter((_, i) => !weg.has(i)).join("\n");
  return leereKonfliktListe(neu) ? "" : neu;
}
export const leereKonfliktListe = (text) => {
  const t = String(text ?? "").replace(/\r/g, "").trim();
  return !leseKonfliktEintraege(text).length && (t === "" || t === KONFLIKT_KOPF.trim());
};
// Hat der Traum die Kopie aufgelöst? Konflikt-Name (.md) UND in der Kopfzeile des Frontmatters eine eigene Zeile „status: aufgeloest“ (ganz links).
export function istAufgeloesteKopie(rel, text) {
  if (!istKonfliktKopie(rel) || !/\.md$/i.test(String(rel))) return false;
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(String(text ?? ""));
  return !!m && /^status:[ \t]*["']?aufgeloest["']?[ \t]*\r?$/m.test(m[1]);
}

const linksVon = (zeile) => [...String(zeile).matchAll(/\(([^()\s]+\.md)\)/g)].map((m) => m[1]);
const ueberschrift = (zeile) => { const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(zeile); return m ? m[1].trim().toLowerCase() : null; };

// Nach einem --union-Merge von MEMORY.md aufräumen. `text` = Ergebnis des Merges, `aktuell` = die Fassung der Wurzel davor, `basis` = die Fassung, die das Konto beim
// letzten Abgleich hatte (null = unbekannt, erster Lauf). Zeilen der Wurzel-Fassung bleiben stehen (auch eigene Dubletten). Fremde Zeilen (vom Konto) entfallen, wenn es sie
// exakt schon gibt; eine fremde Überschrift, die es schon gibt, wird mit ihren Zeilen in den bestehenden Abschnitt eingeordnet (sonst landeten die Zeilen unter der falschen
// Überschrift). Verlinkt eine fremde Zeile eine Datei „(xyz.md)“, die in der Wurzel schon eine Zeile hat (samt eingerückter Folgezeilen), entscheidet die Basis:
//  · Konto-Zeile = Basiszeile → das Konto hat sie nicht angefasst (Merge-Artefakt): entfällt;
//  · Wurzelzeile = Basiszeile, Konto-Zeile anders → nur das Konto hat geändert: die Konto-Fassung ersetzt die Wurzelzeile an Ort und Stelle;
//  · beide verschieden geändert (oder keine Basis): die Wurzelzeile bleibt, die Konto-Zeile steht in `verloren` — der Aufrufer legt dafür eine Konflikt-Kopie an (nie still verwerfen).
// → { text, verloren: [Zeile, …] }
export function bereinigeIndexBefund(text, aktuell = "", basis = null) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const endetMitNl = /\n$/.test(text);
  const zeilen = text.replace(/\r\n/g, "\n").split("\n");
  if (zeilen.length && zeilen[zeilen.length - 1] === "") zeilen.pop();
  const eigen = new Map();
  for (const z of aktuell.replace(/\r\n/g, "\n").split("\n")) { const k = z.trimEnd(); if (k.trim()) eigen.set(k, (eigen.get(k) || 0) + 1); }
  const liste = zeilen.map((z) => {
    const k = z.trimEnd();
    if (!k.trim()) return { z, art: "leer" };
    const n = eigen.get(k) || 0;
    if (n > 0) { eigen.set(k, n - 1); return { z, art: "eigen" }; }
    return { z, art: "fremd" };
  });
  const exakt = new Set(), verlinkt = new Set(), eigenNachLink = new Map();
  for (const e of liste) if (e.art === "eigen") {
    exakt.add(e.z.trimEnd());
    for (const l of linksVon(e.z)) { verlinkt.add(l); if (!/^\s/.test(e.z) && !eigenNachLink.has(l)) eigenNachLink.set(l, e); }
  }
  const basisNachLink = new Map(), basisZeilen = new Set();
  if (basis !== null) for (const z of String(basis).replace(/\r\n/g, "\n").split("\n")) {
    const k = z.trimEnd();
    if (!k.trim()) continue;
    basisZeilen.add(k);
    if (!/^\s/.test(k) && ueberschrift(k) === null) for (const l of linksVon(k)) if (!basisNachLink.has(l)) basisNachLink.set(l, k);
  }
  const verloren = [];
  const behalten = [];
  let verwerfeFolge = false;
  for (const e of liste) {
    if (e.art === "leer") { behalten.push(e); continue; }
    if (e.art === "eigen") { behalten.push(e); if (!/^\s/.test(e.z)) verwerfeFolge = false; continue; }
    if (ueberschrift(e.z) !== null) { behalten.push(e); verwerfeFolge = false; continue; }
    const k = e.z.trimEnd();
    if (verwerfeFolge && /^\s+\S/.test(e.z)) { if (!exakt.has(k) && !basisZeilen.has(k)) verloren.push(k); continue; }
    const links = linksVon(e.z);
    if (exakt.has(k)) { verwerfeFolge = true; continue; }
    const l = links.find((x) => eigenNachLink.has(x)) ?? links.find((x) => verlinkt.has(x));
    if (l !== undefined) {
      const ea = eigenNachLink.get(l), lb = basisNachLink.get(l) ?? null;
      if (ea && !ea.ersetzt && lb !== null && k !== lb && ea.z.trimEnd() === lb) { ea.z = e.z; ea.ersetzt = true; exakt.add(k); }   // nur das Konto hat die Zeile geändert
      else if (lb !== null && k === lb) { /* vom Konto unverändert: Merge-Artefakt */ }
      else if (!exakt.has(k) && !basisZeilen.has(k)) verloren.push(k);                                                              // beide geändert / keine Basis
      verwerfeFolge = true; continue;
    }
    exakt.add(k); links.forEach((x) => verlinkt.add(x)); verwerfeFolge = false;
    behalten.push(e);
  }
  const abschnitte = [{ kopf: null, norm: null, fremd: false, zeilen: [] }];
  for (const e of behalten) {
    const h = ueberschrift(e.z);
    if (h !== null) abschnitte.push({ kopf: e.z, norm: h, fremd: e.art === "fremd", zeilen: [] });
    else abschnitte[abschnitte.length - 1].zeilen.push(e.z);
  }
  const einsortieren = (abschnitt, neue) => {
    let ende = abschnitt.zeilen.length;
    while (ende > 0 && !abschnitt.zeilen[ende - 1].trim()) ende--;
    abschnitt.zeilen.splice(ende, 0, ...neue);
  };
  const ergebnis = [];
  for (const a of abschnitte) {
    if (a.fremd) {
      const inhalt = a.zeilen.slice();
      while (inhalt.length && !inhalt[inhalt.length - 1].trim()) inhalt.pop();
      while (inhalt.length && !inhalt[0].trim()) inhalt.shift();
      if (!inhalt.length) continue;                                     // fremde Überschrift ohne verbliebene Zeilen
      const frueher = ergebnis.find((x) => x.kopf !== null && x.norm === a.norm);
      if (frueher) { einsortieren(frueher, inhalt); continue; }
    }
    ergebnis.push({ ...a, zeilen: a.zeilen.slice() });
  }
  const aus = [];
  for (const a of ergebnis) { if (a.kopf !== null) aus.push(a.kopf); aus.push(...a.zeilen); }
  return { text: aus.join(eol) + (endetMitNl && aus.length ? eol : ""), verloren };
}
export const bereinigeIndex = (text, aktuell = "", basis = null) => bereinigeIndexBefund(text, aktuell, basis).text;

function ergaenzeKonfliktDatei(wneu, rel, kopie, konto, jetzt, algo) {
  const vorhanden = wneu.get(KONFLIKTE);
  let text = vorhanden ? vorhanden.b.toString("utf8") : KONFLIKT_KOPF;
  if (!text.endsWith("\n")) text += "\n";
  text += `${konfliktZeile({ datum: datumTag(jetzt), konto, datei: rel, kopie })}\n`;
  wneu.set(KONFLIKTE, eintrag(algo, Buffer.from(text, "utf8"), jetzt));
}

// Aufgelöste Konflikt-Kopien (vom Traum: status: aufgeloest) aus dem neuen Wurzelstand nehmen — die Aufgaben je Konto löschen sie dort ebenfalls — und ihre
// Zeilen aus _konflikte.md streichen. Nur mit vorhandenem Original (die Auflösung hat ein Ziel) und nie eine Kopie, die dieser Lauf gerade erst angelegt hat.
// Eine leere _konflikte.md entfällt. → Namen der entfernten Kopien (sortiert)
function raeumeAufgeloeste(env, wneu, frisch, projekt) {
  const weg = [];
  for (const [rel, e] of wneu) {
    if (frisch.has(rel) || !istAufgeloesteKopie(rel, e.b.toString("utf8"))) continue;
    if (!wneu.has(leseKonfliktName(rel).original)) { env.warnungen.push(`${projekt}: ${rel} ist als aufgelöst markiert, aber ${leseKonfliktName(rel).original} fehlt — nicht entfernt.`); continue; }
    weg.push(rel);
  }
  for (const rel of weg) wneu.delete(rel);
  const liste = wneu.get(KONFLIKTE);
  if (liste) {
    const alt = liste.b.toString("utf8"), neu = streicheKonfliktEintraege(alt, new Set(weg));
    if (neu === "") wneu.delete(KONFLIKTE);
    else if (neu !== alt) wneu.set(KONFLIKTE, eintrag(env.algo, Buffer.from(neu, "utf8"), env.jetzt));
  }
  return weg.sort();
}

// ------------------------------------------------------------------------------------------ git
// Zeitgrenzen für die Kindprozesse (git, tar): ein hängendes git (Index-Sperre, Netzlaufwerk) oder tar darf den Abgleich — und damit den Tageslauf — nicht ewig blockieren.
// Überschreitung = Fehler (gitLauf wirft; je Projekt abgefangen, bei tar „Sicherung fehlgeschlagen“); die Sperre wird in jedem Fall freigegeben. gleicheAb({ zeitgrenzen }) überschreibt (Tests).
export const ZEIT_STANDARD = { git: 60_000, tar: 120_000 };
const ZEIT = { ...ZEIT_STANDARD };
const zeitUeberschritten = (r) => Boolean(r && r.error && r.error.code === "ETIMEDOUT");
const dauerText = (ms) => (ms < 1000 ? `${ms} ms` : `${Math.round(ms / 1000)} s`);
function gitLauf(wurzel, args, gitCmd, opts = {}) {
  const r = spawnSync(gitCmd, ["-C", wurzel, "-c", "user.name=brain-kit", "-c", "user.email=brain-kit@localhost", "-c", "commit.gpgsign=false",
    "-c", "core.autocrlf=false", "-c", "core.safecrlf=false", ...args], { encoding: opts.puffer ? null : "utf8", env: ohneGitEnv(), windowsHide: true, maxBuffer: 256 * 1024 * 1024, timeout: ZEIT.git, ...opts.spawn });
  if (zeitUeberschritten(r)) throw new Error(`git ${args[0]}: Zeitüberschreitung (${dauerText(ZEIT.git)}) — abgebrochen`);
  return r;
}
function objektFormat(wurzel, gitCmd) {
  if (!existsSync(join(wurzel, ".git"))) return "sha1";
  const r = gitLauf(wurzel, ["rev-parse", "--show-object-format"], gitCmd);
  return r.status === 0 && String(r.stdout).trim() === "sha256" ? "sha256" : "sha1";
}
// Repo anlegen (Objektformat sha1: die Blob-SHAs der Manifeste sind dann überall dieselben) und gc.pruneExpire auf „never“ stellen: Basis-Blobs übersprungener
// Dateien (schreibeBlobBytes) hängen an keinem Commit und würden sonst nach zwei Wochen weggeräumt; ein schon gesetzter Wert bleibt. → true, wenn die Wurzel ein Repo ist
function sorgeFuerRepo(wurzel, gitCmd, warnungen) {
  if (!existsSync(join(wurzel, ".git"))) {
    const i = spawnSync(gitCmd, ["-c", "init.defaultBranch=main", "init", "-q", wurzel], { encoding: "utf8", env: { ...ohneGitEnv(), GIT_DEFAULT_HASH: "sha1" }, windowsHide: true, timeout: ZEIT.git });
    if (i.error || i.status !== 0) { warnungen.push(`git init in der Wurzel gescheitert (${erste((i.error && i.error.message) || String(i.stderr || "").trim())}) — kein Verlauf, keine Basis-Blobs.`); return false; }
  }
  if (gitLauf(wurzel, ["config", "--local", "--get", "gc.pruneExpire"], gitCmd).status !== 0) {
    const c = gitLauf(wurzel, ["config", "--local", "gc.pruneExpire", "never"], gitCmd);
    if (c.status !== 0) warnungen.push(`git config gc.pruneExpire in der Wurzel nicht gesetzt (${erste(String(c.stderr || "").trim())}) — Basis-Blobs könnten nach zwei Wochen wegfallen.`);
  }
  return true;
}
// Blobs der Dateien in die Objektdatenbank der Wurzel schreiben (git hash-object -w). Gibt sha je Pfad zurück ([] bei Fehler).
function schreibeBlobs(wurzel, pfade, gitCmd) {
  const brauchbar = pfade.filter((p) => !/[\r\n]/.test(p));
  if (!brauchbar.length) return [];
  const r = gitLauf(wurzel, ["hash-object", "-w", "--no-filters", "--stdin-paths"], gitCmd, { spawn: { input: brauchbar.join("\n") + "\n" } });
  if (r.status !== 0) return [];
  const aus = String(r.stdout).trim().split("\n");
  return aus.length === brauchbar.length ? brauchbar.map((p, i) => [p, aus[i].trim()]) : [];
}
function schreibeBlobBytes(wurzel, buf, gitCmd) {
  const r = gitLauf(wurzel, ["hash-object", "-w", "--no-filters", "--stdin"], gitCmd, { spawn: { input: buf } });
  return r.status === 0 ? String(r.stdout).trim() : null;
}
function commitWurzel(wurzel, text, gitCmd, warnungen) {
  try {
    if (!existsSync(join(wurzel, ".git"))) return null;
    const a = gitLauf(wurzel, ["add", "-A"], gitCmd);
    if (a.status !== 0) throw new Error(`git add: ${String(a.stderr || "").trim()}`);
    const d = gitLauf(wurzel, ["diff", "--cached", "--quiet"], gitCmd);
    if (d.status === 0) return null;                                    // nichts Neues
    const c = gitLauf(wurzel, ["commit", "-q", "--no-verify", "-m", text], gitCmd);
    if (c.status !== 0) throw new Error(`git commit: ${String(c.stderr || c.stdout || "").trim()}`);
    const h = gitLauf(wurzel, ["rev-parse", "--short", "HEAD"], gitCmd);
    return String(h.stdout || "").trim() || null;
  } catch (e) {
    warnungen.push(`Git-Commit in der Wurzel übersprungen (${erste(e.message)}).`);
    return null;
  }
}

// ------------------------------------------------------------------------------------------ Manifeste
const manifestPfad = (wurzel, konto, projekt) => join(wurzel, MANIFEST_ORDNER, konto, `${projekt}.json`);
const serialisiere = (map) => `${JSON.stringify(Object.fromEntries([...map].sort((a, b) => (a[0] < b[0] ? -1 : 1))), null, 1)}\n`;
// → { vorhanden, map: Map<rel, sha>, text } (kaputtes Manifest gilt als nicht vorhanden: Basis leer, nur Konflikt-Kopien, nie Löschungen)
function leseManifest(wurzel, konto, projekt, warnungen) {
  let text;
  try { text = readFileSync(manifestPfad(wurzel, konto, projekt), "utf8"); } catch { return { vorhanden: false, map: new Map(), text: null }; }
  try {
    const o = JSON.parse(text), map = new Map();
    if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error("kein Objekt");
    for (const [rel, sha] of Object.entries(o)) if (typeof sha === "string" && /^[0-9a-f]{40,64}$/.test(sha)) map.set(rel, sha);
    return { vorhanden: true, map, text };
  } catch (e) {
    warnungen.push(`${konto}/${projekt}: Manifest unlesbar (${erste(e.message)}) — gilt als nicht vorhanden.`);
    return { vorhanden: false, map: new Map(), text: null };
  }
}

// ------------------------------------------------------------------------------------------ Zustand eines memory-Ordners
function zustandVon(memory, ziel) {
  let st;
  try { st = lstatSync(memory); } catch { return { art: "fehlt" }; }
  if (st.isSymbolicLink()) {
    let roh = ""; try { roh = resolve(dirname(memory), readlinkSync(memory)); } catch {}
    let ist = null; try { ist = realpathSync(memory); } catch {}
    let soll; try { soll = realpathSync(ziel); } catch { soll = resolve(ziel); }
    // Symlink der früheren Version (zeigt auf <wurzel>/<P>), auch wenn das Ziel fehlt → wird durch einen echten Ordner ersetzt
    if ((ist && ist === soll) || (roh && resolve(roh) === resolve(ziel))) return { art: "symlink" };
    return { art: "fremd", ziel: ist || roh };
  }
  if (st.isDirectory()) return { art: "echt" };
  return { art: "datei" };
}
const altOrdner = (projektDir) => {
  try { return readdirSync(projektDir, { withFileTypes: true }).filter((e) => e.isDirectory() && /^memory\.alt-/.test(e.name)).map((e) => join(projektDir, e.name)).sort(); }
  catch { return []; }
};

// ------------------------------------------------------------------------------------------ Umgebung eines Laufs
// Bündelt, was Plan und Anwenden gemeinsam brauchen: git, Objektformat, Basis-Blobs lesen, git merge-file. aufraeumen() am Ende aufrufen.
function baueUmgebung({ wurzel, konten, jetzt, temp, gitCmd, erzwingen = false }) {
  const git = gitCmd || gitBefehl({ cfg: {} });
  const env = { wurzel, konten, jetzt, temp, git, algo: objektFormat(wurzel, git), warnungen: [], gitBereit: existsSync(join(wurzel, ".git")), scratch: null, erzwingen };
  env.holeBlob = (sha) => {
    if (!sha || !/^[0-9a-f]{40,64}$/.test(sha) || !existsSync(join(wurzel, ".git"))) return null;
    const r = gitLauf(wurzel, ["cat-file", "blob", sha], git, { puffer: true });
    return r.status === 0 && Buffer.isBuffer(r.stdout) ? r.stdout : null;
  };
  // → Buffer (sauber zusammengeführt) oder null (Konflikt, Binärdatei, git fehlt)
  env.merge = (aktuell, basis, andere, { union = false } = {}) => {
    try {
      if (!env.scratch) env.scratch = mkdtempSync(join(tmpdir(), "gedaechtnis-merge-"));
      writeFileSync(join(env.scratch, "a"), aktuell); writeFileSync(join(env.scratch, "b"), basis); writeFileSync(join(env.scratch, "c"), andere);
      const r = spawnSync(git, ["merge-file", "-p", ...(union ? ["--union"] : []), "-L", "wurzel", "-L", "basis", "-L", "konto", "a", "b", "c"],
        { cwd: env.scratch, env: ohneGitEnv(), windowsHide: true, maxBuffer: 256 * 1024 * 1024, timeout: ZEIT.git });
      if (r.error || r.status !== 0 || !Buffer.isBuffer(r.stdout)) return null;
      return r.stdout;
    } catch { return null; }
  };
  env.aufraeumen = () => { if (env.scratch) { try { rmSync(env.scratch, { recursive: true, force: true }); } catch {} env.scratch = null; } };
  return env;
}

// ------------------------------------------------------------------------------------------ Zusammenführen einer Datei (3 Wege)
// a = Wurzelstand (aktuell), sb = Basis-SHA des Kontos (Manifest, null = nicht vorhanden), c = Stand des Kontos; a/c: { b, sha, t } | undefined.
// wurzelWeg: der Wurzel-Projektordner fehlt/ist leer, obwohl Konten abgeglichen waren — „in der Wurzel gelöscht“ ist dann keine Aussage (siehe berechneProjekt).
// → { art: "gleich" | "wurzel" | "konto" | "merge" | "konflikt", neu?: Eintrag|undefined, kopie?: Eintrag }
function entscheideDatei(env, rel, a, sb, c, { wurzelWeg = false } = {}) {
  const sa = a ? a.sha : null, sc = c ? c.sha : null;
  if (sa === sc) return { art: "gleich" };
  if (sc === sb) return wurzelWeg && !a && c ? { art: "konto", neu: c } : { art: "wurzel" };   // Konto unverändert → die Wurzel gilt (auch Löschen) — außer die Wurzel ist weg: dann baut das Konto sie neu auf
  if (sa === sb) return { art: "konto", neu: c };                       // Wurzel unverändert → Änderung des Kontos (auch Löschen)
  // beide verschieden geändert
  if (!a) return { art: "konto", neu: c };                              // gelöscht gegen geändert: die Änderung gewinnt
  if (!c) return { art: "wurzel" };
  const basis = sb ? env.holeBlob(sb) : null;
  if (rel === INDEX || rel === KONFLIKTE) {
    const m = env.merge(a.b, basis || Buffer.alloc(0), c.b, { union: true });
    if (m) {
      const b = bereinigeIndexBefund(m.toString("utf8"), a.b.toString("utf8"), basis ? basis.toString("utf8") : null);
      // Gingen Zeilen des Kontos verloren (beide Seiten haben dieselbe Zeile verschieden geändert), bleibt seine Fassung als Konflikt-Kopie erhalten (nur MEMORY.md, nie _konflikte.md selbst)
      return { art: "merge", neu: eintrag(env.algo, Buffer.from(b.text, "utf8"), env.jetzt), ...(rel === INDEX && b.verloren.length ? { kopie: c } : {}) };
    }
  } else if (basis) {                                                   // ohne Basis (erster Lauf) gibt es nur die Konflikt-Kopie
    const m = env.merge(a.b, basis, c.b);
    if (m) return { art: "merge", neu: eintrag(env.algo, m, env.jetzt) };
  }
  return { art: "konflikt", kopie: c };
}

function legeKonfliktKopieAn(env, wneu, rel, konto, c) {
  let n = 1, kopie = konfliktName(rel, konto, n);
  for (; wneu.has(kopie); kopie = konfliktName(rel, konto, ++n)) if (wneu.get(kopie).sha === c.sha) return { kopie, neu: false };   // gleiche Kopie gibt es schon
  wneu.set(kopie, { b: c.b, sha: c.sha, t: c.t });
  ergaenzeKonfliktDatei(wneu, rel, kopie, konto, env.jetzt, env.algo);
  return { kopie, neu: true };
}

// ------------------------------------------------------------------------------------------ Plan (nur lesend)
// Liest ein Projekt (Wurzel + alle Konten) und rechnet den neuen Wurzelstand und die Aufgaben je Konto aus. Schreibt nichts.
// Massenlöschungs-Riegel: ab so vielen Löschungen in einem Konto UND mehr als der Hälfte seiner Dateien wird das Projekt nicht angewendet (--erzwingen hebt ihn auf).
const MASSEN_MIN = 3;
function berechneProjekt(env, p, aktive) {
  const T = join(env.wurzel, p);
  const W = new Map(), fehler = [];
  if (NUR_ORDNER(T)) {
    const baum = leseBaum(T);
    for (const f of baum.fehler) fehler.push(`${p}: Wurzel, ${f}`);
    for (const [rel, e] of baum.dateien) if (sicherRel(rel)) W.set(rel, eintrag(env.algo, e.b, e.t));
  }
  const kp = [];
  for (const k of aktive) {
    const projektDir = join(k.pfad, "projects", p), memory = join(projektDir, "memory");
    const zustand = zustandVon(memory, T);
    const x = { konto: k.name, kontoPfad: k.pfad, projektDir, memory, zustand: zustand.art, stand: new Map(), manifest: leseManifest(env.wurzel, k.name, p, env.warnungen),
      aktiv: ["fehlt", "echt", "symlink"].includes(zustand.art), zaehler: { neu: 0, geaendert: 0, geloescht: 0, gemerged: 0 }, ohneLoeschen: false };
    for (const alt of altOrdner(projektDir)) env.warnungen.push(`${k.name}/${p}: ${basename(alt)} stammt aus der früheren Symlink-Version und wird nicht angefasst — bitte prüfen und von Hand aufräumen.`);
    if (zustand.art === "fremd") env.warnungen.push(`${k.name}/${p}: memory ist ein Symlink auf etwas anderes (${kurzPfad(zustand.ziel || "?")}) — nicht angefasst.`);
    else if (zustand.art === "datei") env.warnungen.push(`${k.name}/${p}: memory ist eine Datei — nicht angefasst.`);
    if (zustand.art === "echt" || zustand.art === "symlink") {
      const baum = leseBaum(memory);
      for (const f of baum.fehler) fehler.push(`${k.name}/${p}: ${f}`);
      for (const u of baum.uebersprungen) env.warnungen.push(`${k.name}/${p}: „${u}“ ist ein Symlink/Sonderdatei und wird nicht übernommen.`);
      for (const [rel, e] of baum.dateien) if (sicherRel(rel)) x.stand.set(rel, eintrag(env.algo, e.b, e.t));
    }
    // fehlender Ordner trotz Manifest ≠ „alles gelöscht“ (siehe Kopfkommentar)
    if (zustand.art === "fehlt" && x.manifest.map.size) { x.ohneLoeschen = true; env.warnungen.push(`${k.name}/${p}: memory fehlt, obwohl das Konto abgeglichen war — wird aus der Wurzel wiederhergestellt (nicht als Löschung gewertet).`); }
    kp.push(x);
  }
  // Etwas ließ sich nicht lesen (EACCES, EIO, …): das Projekt wird in diesem Lauf nicht angefasst — eine fehlende Datei wäre sonst eine „Löschung“, die in alle Konten wandert.
  if (fehler.length) {
    for (const x of kp) { x.aufgabe = { schreiben: [], loeschen: [], ersetzeLink: false }; x.manifestNeu = null; x.manifestSchreiben = false; }
    return { projekt: p, ziel: T, W, wneu: W, geaendertW: new Map(), konten: kp, konflikte: [], merges: [], aufgeloeste: [], datenAenderung: false, noetig: false, fehler, blockiert: [] };
  }
  // Wurzel-Ordner des Projekts fehlt oder ist leer, obwohl Konten schon abgeglichen waren (Manifest mit Dateien): „in der Wurzel gelöscht“ ist dann keine Aussage, sondern
  // meist ein versehentliches `rm -rf` — wie bei einem fehlenden memory-Ordner keine Löschungen, die Wurzel wird aus den Konten neu aufgebaut.
  const wurzelWeg = W.size === 0 && kp.some((x) => x.aktiv && x.manifest.map.size > 0);
  if (wurzelWeg) env.warnungen.push(`${p}: Wurzel-Ordner fehlt oder ist leer, obwohl Konten abgeglichen waren (Manifest) — keine Löschungen, der Stand wird aus den Konten neu aufgebaut.`);

  // Zusammenführen: Konten der Reihe nach in die Wurzel (wneu = Wurzelstand inkl. bereits eingearbeiteter Konten)
  const wneu = new Map(W);
  const konflikte = [], merges = [];
  for (const x of kp.filter((y) => y.aktiv)) {
    for (const rel of [...new Set([...wneu.keys(), ...x.stand.keys()])].sort()) {
      const a = wneu.get(rel), c = x.stand.get(rel), sb = x.manifest.map.get(rel) ?? null;
      if (x.ohneLoeschen && !c && sb) continue;
      const d = entscheideDatei(env, rel, a, sb, c, { wurzelWeg });
      if (d.art === "konto") {
        if (d.neu) wneu.set(rel, d.neu); else wneu.delete(rel);
        if (!a) x.zaehler.neu++; else if (!c) x.zaehler.geloescht++; else x.zaehler.geaendert++;
      } else if (d.art === "merge") {
        wneu.set(rel, d.neu); x.zaehler.gemerged++; merges.push(rel);
        if (d.kopie) { const k = legeKonfliktKopieAn(env, wneu, rel, x.konto, d.kopie); if (k.neu) konflikte.push({ datei: rel, kopie: k.kopie, konto: x.konto }); }
      } else if (d.art === "konflikt") {
        const k = legeKonfliktKopieAn(env, wneu, rel, x.konto, d.kopie);
        if (k.neu) konflikte.push({ datei: rel, kopie: k.kopie, konto: x.konto });
      }
    }
  }
  // Vom Traum aufgelöste Kopien aufräumen (bewusste, protokollierte Löschung; nie eine Kopie, die dieser Lauf gerade angelegt hat)
  const aufgeloeste = raeumeAufgeloeste(env, wneu, new Set(konflikte.map((k) => k.kopie)), p);
  const geaendertW = new Map();
  for (const rel of new Set([...W.keys(), ...wneu.keys()])) {
    const alt = W.get(rel), neu = wneu.get(rel);
    if ((alt ? alt.sha : null) !== (neu ? neu.sha : null)) geaendertW.set(rel, !alt ? "neu" : !neu ? "geloescht" : "geaendert");
  }

  // Aufgaben je Konto und neues Manifest
  for (const x of kp) {
    x.aufgabe = { schreiben: [], loeschen: [], ersetzeLink: false };
    x.manifestNeu = null; x.manifestSchreiben = false;
    if (!x.aktiv) continue;
    if (x.zustand === "symlink") { x.aufgabe.ersetzeLink = true; x.aufgabe.schreiben = [...wneu.keys()].sort(); }
    else for (const rel of [...new Set([...wneu.keys(), ...x.stand.keys()])].sort()) {
      const soll = wneu.get(rel), ist = x.stand.get(rel);
      if (soll && (!ist || ist.sha !== soll.sha)) x.aufgabe.schreiben.push(rel);
      else if (!soll && ist) x.aufgabe.loeschen.push(rel);
    }
    const m = new Map([...wneu].map(([rel, e]) => [rel, e.sha]));
    if (x.manifest.vorhanden || m.size || x.stand.size) { x.manifestNeu = m; x.manifestSchreiben = serialisiere(m) !== x.manifest.text; }
  }
  // Massenlöschungs-Riegel: vom Traum aufgelöste Konflikt-Kopien sind bewusste, protokollierte Löschungen und zählen nicht mit.
  const blockiert = [];
  if (!env.erzwingen) for (const x of kp) {
    if (!x.aktiv) continue;
    const n = x.aufgabe.loeschen.filter((rel) => !aufgeloeste.includes(rel)).length;
    if (n >= MASSEN_MIN && n * 2 > x.stand.size) blockiert.push({ konto: x.konto, loeschen: n, von: x.stand.size });
  }
  if (blockiert.length) env.warnungen.push(`${p}: Massenlöschung — bitte prüfen: brain gedaechtnis abgleichen --projekt ${p} --erzwingen (${blockiert.map((b) => `${b.konto}: ${b.loeschen} von ${b.von} Dateien würden gelöscht`).join(", ")}; Projekt in diesem Lauf nicht angewendet)`);
  const datenAenderung = geaendertW.size > 0 || kp.some((x) => x.aufgabe.schreiben.length || x.aufgabe.loeschen.length || x.aufgabe.ersetzeLink);
  return { projekt: p, ziel: T, W, wneu, geaendertW, konten: kp, konflikte, merges, aufgeloeste, datenAenderung, noetig: datenAenderung || kp.some((x) => x.manifestSchreiben), fehler: [], blockiert };
}

// → { plan, intern }; plan ist JSON-fähig (CLI --json), intern hält die Daten für das Anwenden (Dateiinhalte).
function erstellePlan(env, { projekt = null } = {}) {
  const { wurzel, konten, temp } = env;
  const namen = kontoNamen(konten);
  const plan = { wurzel, wurzelVorhanden: NUR_ORDNER(wurzel), gitRepo: existsSync(join(wurzel, ".git")), konten: [], projekte: [], uebersprungen: [], warnungen: env.warnungen, fehler: [], aenderungen: 0 };
  const aktive = [];
  konten.forEach((pfad, i) => {
    const k = { name: namen[i], pfad, status: !NUR_ORDNER(pfad) ? "fehlt" : istKonto(pfad) ? "ok" : "kein-konto", git: existsSync(join(pfad, ".git")) };
    plan.konten.push(k);
    if (k.status === "ok") aktive.push(k);
    else plan.warnungen.push(k.status === "fehlt" ? `Konto ${k.name} (${kurzPfad(pfad)}) gibt es nicht — übersprungen.` : `${kurzPfad(pfad)} sieht nicht wie ein Claude-Konto aus (weder projects/ noch settings.json) — übersprungen.`);
  });
  // Konten dürfen nicht in der Wurzel liegen und umgekehrt (sonst Schleife)
  for (const k of aktive) if (unter(k.pfad, wurzel) || unter(wurzel, k.pfad)) throw new Error(`Wurzel (${kurzPfad(wurzel)}) und Konto ${k.name} (${kurzPfad(k.pfad)}) dürfen nicht ineinander liegen.`);

  // Projekte einsammeln
  const projekte = new Set();
  const merkeProjekt = (p, quelle) => {
    const klasse = projektKlasse(p, { temp });
    if (klasse === "kein-schluessel") return;
    if (klasse === "temporaer") { plan.uebersprungen.push({ projekt: p, quelle, grund: "temporär" }); return; }
    projekte.add(p);
  };
  if (projekt) {
    if (!istProjektSchluessel(projekt)) throw new Error(`„${projekt}“ ist kein Projekt-Schlüssel (nur Buchstaben, Ziffern und „-“).`);
    merkeProjekt(projekt, "angegeben");
  } else {
    for (const k of aktive) {
      let es = []; try { es = readdirSync(join(k.pfad, "projects"), { withFileTypes: true }); } catch {}
      for (const e of es) if (e.isDirectory() || (e.isSymbolicLink() && NUR_ORDNER(join(k.pfad, "projects", e.name)))) merkeProjekt(e.name, k.name);
    }
    if (plan.wurzelVorhanden) for (const e of readdirSync(wurzel, { withFileTypes: true })) if (e.isDirectory()) merkeProjekt(e.name, "wurzel");
  }
  const gesehen = new Set();
  plan.uebersprungen = plan.uebersprungen.filter((u) => { if (gesehen.has(u.projekt)) return false; gesehen.add(u.projekt); return true; });

  const intern = new Map();
  for (const p of [...projekte].sort()) {
    let pr;
    try { pr = berechneProjekt(env, p, aktive); }
    catch (e) {                                                          // z. B. git-Zeitüberschreitung: dieses Projekt fällt aus, die anderen laufen weiter
      plan.fehler.push(`${p}: ${erste(e.message)}`);
      plan.projekte.push({ projekt: p, ziel: join(wurzel, p), noetig: false, datenAenderung: false, manifestNeu: false, wurzel: { neu: 0, geaendert: 0, geloescht: 0 }, dateienInWurzel: 0,
        konflikte: [], merges: [], aufgeloeste: [], konten: [], fehler: [erste(e.message)], blockiert: [] });
      continue;
    }
    const zeilen = pr.konten.map((x) => ({
      konto: x.konto, zustand: x.zustand,
      vonKonto: { ...x.zaehler },
      schreiben: x.aufgabe.schreiben.length, loeschen: x.aufgabe.loeschen.length,
      aktion: !x.aktiv ? "uebersprungen" : x.aufgabe.ersetzeLink ? "symlink-ersetzen" : (x.aufgabe.schreiben.length || x.aufgabe.loeschen.length) ? "verteilen" : "ok",
    }));
    const zaehl = (art) => [...pr.geaendertW.values()].filter((v) => v === art).length;
    plan.projekte.push({ projekt: p, ziel: pr.ziel, noetig: pr.noetig, datenAenderung: pr.datenAenderung, manifestNeu: pr.konten.some((x) => x.manifestSchreiben),
      wurzel: { neu: zaehl("neu"), geaendert: zaehl("geaendert"), geloescht: zaehl("geloescht") }, dateienInWurzel: pr.wneu.size,
      konflikte: pr.konflikte, merges: pr.merges, aufgeloeste: pr.aufgeloeste, konten: zeilen, fehler: pr.fehler, blockiert: pr.blockiert });
    plan.fehler.push(...pr.fehler);
    if (pr.noetig && !pr.blockiert.length) plan.aenderungen++;
    intern.set(p, pr);
  }
  return { plan, intern };
}

// ------------------------------------------------------------------------------------------ Anwenden
function leereSicherung(sicherungen, jetzt) {
  mkdirSync(sicherungen, { recursive: true });
  let archiv = join(sicherungen, `${zeitMarke(jetzt)}.tgz`);
  for (let n = 2; existsSync(archiv); n++) archiv = join(sicherungen, `${zeitMarke(jetzt)}-${n}.tgz`);
  return archiv;
}

// Rotation der Sicherungen: behalten werden die neuesten `anzahl` (nach Änderungszeit) UND alle, die jünger als `tage` Tage sind — gelöscht wird nur, was beides verletzt.
// Nur Dateien in der Namensform dieses Werkzeugs (<zeit>[-n].tgz); `behalte` (die gerade angelegte) wird nie gelöscht. Wirft nie. → Namen der gelöschten
const SICHERUNG_NAME = /^\d{8}-\d{6}(?:-\d+)?\.tgz$/;
export function rotiereSicherungen(ordner, jetzt = Date.now(), { anzahl = 30, tage = 14, behalte = null } = {}) {
  const geloescht = [];
  try {
    const alle = [];
    for (const name of readdirSync(ordner)) {
      if (!SICHERUNG_NAME.test(name)) continue;
      try { const st = statSync(join(ordner, name)); if (st.isFile()) alle.push({ name, t: st.mtimeMs }); } catch {}
    }
    alle.sort((x, y) => y.t - x.t || (x.name < y.name ? 1 : -1));                // neueste zuerst
    for (const e of alle.slice(anzahl)) {
      if (join(ordner, e.name) === behalte || jetzt - e.t <= tage * 24 * 60 * 60 * 1000) continue;
      try { unlinkSync(join(ordner, e.name)); geloescht.push(e.name); } catch {}
    }
  } catch {}
  return geloescht;
}

// Sicherung als .tgz: Aufbau konten/<kontoname>/<P>/memory und wurzel/<P>/… (über einen Zwischenordner im Temp-Ordner); danach rotiert (rotiereSicherungen)
function sichere(wurzel, eintraege, jetzt, info = {}) {
  const sicherungen = join(dirname(wurzel), `${basename(wurzel)}-sicherungen`);
  let archiv = null, staging = null;
  try {
    archiv = leereSicherung(sicherungen, jetzt);
    staging = mkdtempSync(join(tmpdir(), "gedaechtnis-sicherung-"));
    for (const e of eintraege) {
      const ziel = join(staging, ...e.als.split("/"));
      mkdirSync(dirname(ziel), { recursive: true });
      cpSync(e.von, ziel, { recursive: true, dereference: false, preserveTimestamps: true });
    }
    const r = spawnSync("tar", ["-czf", archiv, "-C", staging, "."], { encoding: "utf8", windowsHide: true, timeout: ZEIT.tar });
    if (zeitUeberschritten(r)) throw new Error(`tar: Zeitüberschreitung (${dauerText(ZEIT.tar)}) — abgebrochen`);
    if (r.error || r.status !== 0) throw new Error((r.error && r.error.message) || String(r.stderr || "").trim().split("\n")[0] || `tar Exit ${r.status}`);
  } catch (e) {
    try { if (archiv) rmSync(archiv, { force: true }); } catch {}
    throw new Error(`Sicherung fehlgeschlagen (${erste(e.message)}) — nichts geändert.`);
  } finally { try { if (staging) rmSync(staging, { recursive: true, force: true }); } catch {} }
  info.rotiert = rotiereSicherungen(sicherungen, jetzt, { behalte: archiv }).length;
  return archiv;
}

const schlafe = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch {} };
const SPERRE_RESTE_MS = 60 * 1000;                                       // Reste einer Übernahme (<sperre>.alt-<pid>-<zeit>) räumt auf, wer sie nach so langer Zeit noch findet
const WACHE_ALTER_MS = 30 * 1000;                                        // die Übernahme-Wache wird nur Millisekunden gehalten; älter = Rest eines Absturzes
// Übernahme einer veralteten Sperre. Nur löschen und neu anlegen (oder nur per rename wegschieben) reicht nicht: Wer die Sperre vorher als veraltet gesehen hat, kann dem
// Gewinner die frisch angelegte neue Sperre wegnehmen — zwei Läufe hielten dann „die“ Sperre. Darum geht die Übernahme durch eine kurze Wache (<sperre>.uebernahme, O_EXCL):
// nur wer sie hält, prüft NOCHMAL, ob die Sperre veraltet ist, und schiebt sie dann per rename auf einen eindeutigen Namen (<sperre>.alt-<pid>-<zeit>) und löscht sie dort. Alle
// anderen (Wache belegt, rename verloren) tun nichts; wer die Wache später bekommt, sieht eine frische Sperre. Angelegt wird danach vom Aufrufer, wieder mit O_EXCL — gewinnt
// genau einer. → true, wenn wir die veraltete Sperre weggeräumt haben (oder sie schon weg war): der Aufrufer darf sofort neu anlegen.
export function uebernimmVeraltete(datei) {
  const wache = `${datei}.uebernahme`;
  let fd;
  try { fd = openSync(wache, "wx"); }
  catch (e) {
    if (e.code === "EEXIST") { try { if (Date.now() - statSync(wache).mtimeMs > WACHE_ALTER_MS) unlinkSync(wache); } catch {} }
    return false;
  }
  try {
    closeSync(fd);
    let veraltet;
    try { veraltet = Date.now() - statSync(datei).mtimeMs > SPERRE_ALTER_MS; } catch (e) { return e.code === "ENOENT"; }   // schon weg → anlegen darf jeder
    if (!veraltet) return false;                                         // inzwischen hat jemand eine frische Sperre angelegt
    const weg = `${datei}.alt-${process.pid}-${Date.now()}`;
    try { renameSync(datei, weg); } catch { return false; }              // wer das rename nicht gewinnt, legt nichts an
    try { unlinkSync(weg); } catch {}
    return true;
  } finally { try { unlinkSync(wache); } catch {} }
}
function raeumeSperrenReste(datei) {
  const ordner = dirname(datei), praefix = `${basename(datei)}.alt-`;
  try {
    for (const n of readdirSync(ordner)) {
      if (!n.startsWith(praefix)) continue;
      const m = /-(\d+)$/.exec(n);
      if (Date.now() - (m ? Number(m[1]) : 0) > SPERRE_RESTE_MS) { try { unlinkSync(join(ordner, n)); } catch {} }
    }
  } catch {}
}
// Sperre <wurzel>.lock. warteMs > 0: bei belegter Sperre bis zu so lange erneut versuchen (die Hook-Läufe von SessionStart/-Ende stoßen sich sonst gegenseitig weg).
// → Pfad der Sperrdatei (für gibSperre)
export function nimmSperre(wurzel, jetzt, warteMs = 0) {
  const datei = `${wurzel}.lock`;
  const lege = () => { const fd = openSync(datei, "wx"); try { writeFileSync(fd, `${process.pid} ${new Date(jetzt).toISOString()}\n`); } finally { closeSync(fd); } };
  const belegt = () => new Error("Das gemeinsame Gedächtnis wird gerade von einem anderen Lauf bearbeitet — bitte später erneut versuchen.");
  mkdirSync(dirname(datei), { recursive: true });
  const ende = Date.now() + Math.max(0, warteMs);
  for (;;) {
    try { lege(); raeumeSperrenReste(datei); return datei; }
    catch (e) {
      if (e.code !== "EEXIST") throw e;
      let alt = false; try { alt = Date.now() - statSync(datei).mtimeMs > SPERRE_ALTER_MS; } catch { alt = true; }
      if (alt && uebernimmVeraltete(datei)) continue;                  // frei geräumt: sofort neu anlegen (gewinnt nur einer, die anderen sehen eine frische Sperre)
      if (Date.now() >= ende) throw belegt();
      schlafe(200);
    }
  }
}

// Gegenstück zu nimmSperre (auch für den Traum beim Anwenden eines Patches in der Wurzel)
export function gibSperre(datei) { if (datei) { try { unlinkSync(datei); } catch {} } }

// Symlink der früheren Version durch einen echten Ordner mit dem Wurzelstand ersetzen (Ordner nebenan fertig bauen, Link entfernen, umbenennen)
function ersetzeSymlinkDurchOrdner(x, wneu) {
  const neu = join(x.projektDir, `.memory-neu-${process.pid}`);
  rmSync(neu, { recursive: true, force: true });
  mkdirSync(neu, { recursive: true });
  try {
    for (const [rel, e] of wneu) {
      const ziel = join(neu, ...rel.split("/"));
      mkdirSync(dirname(ziel), { recursive: true });
      writeFileSync(ziel, e.b);
      if (e.t) { try { utimesSync(ziel, new Date(e.t), new Date(e.t)); } catch {} }
    }
    try { unlinkSync(x.memory); } catch { rmdirSync(x.memory); }          // Link (Windows: Junction) entfernen
    try { renameSync(neu, x.memory); }
    catch {                                                              // jemand hat memory inzwischen neu angelegt: Dateien hineinlegen
      mkdirSync(x.memory, { recursive: true });
      for (const [rel, e] of wneu) { const z = join(x.memory, ...rel.split("/")); if (!existsSync(z)) schreibeAtomar(z, e.b, e.t, x.projektDir); }
    }
  } finally { rmSync(neu, { recursive: true, force: true }); }
}

// Wurzelstand in ein Konto schreiben. Je Datei: erst prüfen, ob sie seit dem Lesen verändert wurde → dann überspringen.
// → { geschrieben, geloescht, uebersprungen: Map<rel, Eintrag|null> (Stand des Kontos beim Lesen), fehler: [] }
function verteileAnKonto(env, pr, x, haken) {
  const erg = { geschrieben: 0, geloescht: 0, uebersprungen: new Map(), fehler: [] };
  if (haken.vorVerteilen) haken.vorVerteilen({ projekt: pr.projekt, konto: x.konto, memory: x.memory });
  raeumeTempAuf(x.projektDir);
  const a = x.aufgabe;
  if (a.ersetzeLink) { ersetzeSymlinkDurchOrdner(x, pr.wneu); erg.geschrieben = pr.wneu.size; return erg; }
  if (!a.schreiben.length && !a.loeschen.length) return erg;
  mkdirSync(x.memory, { recursive: true });
  const algo = env.algo;
  const pfad = (rel) => join(x.memory, ...rel.split("/"));
  const unveraendert = (rel) => () => dateiSha(pfad(rel), algo) === (x.stand.get(rel)?.sha ?? null);
  for (const rel of a.loeschen) {
    try {
      if (entferneDatei(pfad(rel), x.memory, unveraendert(rel))) erg.geloescht++;
      else erg.uebersprungen.set(rel, x.stand.get(rel) || null);
    } catch (e) { erg.fehler.push(`${x.konto}/${pr.projekt}: ${rel} nicht gelöscht (${e.code || erste(e.message)})`); erg.uebersprungen.set(rel, x.stand.get(rel) || null); }
  }
  for (const rel of a.schreiben) {
    try {
      const e = pr.wneu.get(rel);
      if (schreibeAtomar(pfad(rel), e.b, e.t, x.projektDir, unveraendert(rel))) erg.geschrieben++;
      else erg.uebersprungen.set(rel, x.stand.get(rel) || null);
    } catch (e) { erg.fehler.push(`${x.konto}/${pr.projekt}: ${rel} nicht geschrieben (${e.code || erste(e.message)})`); erg.uebersprungen.set(rel, x.stand.get(rel) || null); }
  }
  return erg;
}

// Ein Projekt anwenden: Wurzel schreiben (nach Prüfung), Basis-Blobs, Konten verteilen, Manifeste. Wirft nur, wenn die Wurzel sich während des Laufs geändert hat.
function wendeProjektAn(env, pr, haken, erg) {
  const T = pr.ziel;
  for (const [rel] of pr.geaendertW) {
    if (dateiSha(join(T, ...rel.split("/")), env.algo) !== (pr.W.get(rel)?.sha ?? null)) throw new Error(`${pr.projekt}: Wurzel-Datei ${rel} hat sich während des Laufs geändert — der nächste Lauf gleicht ab.`);
  }
  mkdirSync(T, { recursive: true });
  for (const [rel, art] of [...pr.geaendertW].sort((p, q) => (p[0] < q[0] ? -1 : 1))) {
    const ziel = join(T, ...rel.split("/"));
    if (art === "geloescht") entferneDatei(ziel, T);
    else { const e = pr.wneu.get(rel); schreibeAtomar(ziel, e.b, e.t, env.wurzel); }
    erg.zaehler.wurzel++;
  }
  // Basis-Blobs: alle Dateien des neuen Wurzelstands in die Objektdatenbank (gleiche SHA wie berechnet, sonst Warnung)
  if (env.gitBereit) {
    const pfade = [...pr.wneu.keys()].map((rel) => join(T, ...rel.split("/")));
    const geschrieben = schreibeBlobs(env.wurzel, pfade, env.git);
    const falsch = geschrieben.filter(([p, sha]) => sha !== pr.wneu.get(relativ(T, p))?.sha);
    if (!geschrieben.length && pfade.length) erg.warnungen.push(`${pr.projekt}: Basis-Blobs konnten nicht geschrieben werden — Konflikte werden ohne Basis als Konflikt-Kopie behandelt.`);
    else if (falsch.length) erg.warnungen.push(`${pr.projekt}: ${falsch.length} Blob-SHA(s) weichen von git hash-object ab (Objektformat?) — die Basis kann beim nächsten Mal fehlen.`);
  }
  for (const x of pr.konten.filter((y) => y.aktiv)) {
    let v;
    try { v = verteileAnKonto(env, pr, x, haken); }
    catch (e) { erg.fehler.push(`${x.konto}/${pr.projekt}: ${erste(e.message)}`); continue; }          // Manifest bleibt: der nächste Lauf rechnet neu
    erg.zaehler.konten += v.geschrieben + v.geloescht;
    erg.fehler.push(...v.fehler);
    if (v.uebersprungen.size) erg.warnungen.push(`${x.konto}/${pr.projekt}: ${v.uebersprungen.size} Datei(en) während des Laufs verändert — unangetastet, der nächste Lauf holt sie.`);
    if (!x.manifestNeu) continue;
    const m = new Map(x.manifestNeu);
    for (const [rel, alt] of v.uebersprungen) {
      if (alt) { m.set(rel, alt.sha); if (env.gitBereit) schreibeBlobBytes(env.wurzel, alt.b, env.git); } else m.delete(rel);
    }
    const text = serialisiere(m);
    if (text === x.manifest.text || (!x.manifest.vorhanden && !m.size)) continue;
    const mp = manifestPfad(env.wurzel, x.konto, pr.projekt);
    mkdirSync(dirname(mp), { recursive: true });
    schreibeAtomar(mp, Buffer.from(text, "utf8"), null, dirname(mp));
  }
}
const relativ = (basis, pfad) => resolve(pfad).slice(resolve(basis).length + 1).split(sep).join("/");

// ------------------------------------------------------------------------------------------ abgleichen
const MASSEN_ZEILE = (plan) => { const n = plan.projekte.filter((p) => p.blockiert.length).length; return n ? `, ${n} Projekt(e) wegen Massenlöschung nicht angewendet` : ""; };
function planZeile(plan) {
  const hinten = `${MASSEN_ZEILE(plan)}${plan.fehler.length ? `, ${plan.fehler.length} Fehler` : ""}`;
  if (!plan.aenderungen) {
    const n = plan.projekte.filter((p) => p.dateienInWurzel > 0).length;
    return `Gedächtnis: nichts zu tun${n ? ` (${n} Projekt(e) abgeglichen)` : ""}${hinten}`;
  }
  const arbeit = plan.projekte.filter((p) => p.noetig && !p.blockiert.length);
  const konfl = arbeit.reduce((x, p) => x + p.konflikte.length, 0);
  const aufg = arbeit.reduce((x, p) => x + p.aufgeloeste.length, 0);
  const inW = arbeit.reduce((x, p) => x + p.wurzel.neu + p.wurzel.geaendert + p.wurzel.geloescht, 0);
  const inK = arbeit.reduce((x, p) => x + p.konten.reduce((y, k) => y + k.schreiben + k.loeschen, 0), 0);
  return `${arbeit.length} Projekt(e) abzugleichen, ${inW} Datei(en) in der Wurzel, ${inK} in den Konten${konfl ? `, ${konfl} Konflikt(e)` : ""}${aufg ? `, ${aufg} aufgelöste Konflikt-Kopie(n) zu entfernen` : ""}${hinten}`;
}

// gleicheAb({ wurzel, konten, projekt?, anwenden }) — Trockenlauf (Standard) oder Ausführen. Optional: jetzt (Zeitstempel), temp (Temp-Ordner, deren
// Projekt-Schlüssel übersprungen werden), gitCmd, warteMs (bei belegter Sperre so lange warten), haken.nachPlan() (Testhaken: nach dem Lesen/Rechnen, vor dem ersten Schreiben),
// haken.vorVerteilen({ projekt, konto, memory }) (Testhaken: vor dem Verteilen an ein Konto — hier „verändert“ ein Test eine Konto-Datei mitten im Lauf).
// zeitgrenzen: { git, tar } in ms (Standard ZEIT_STANDARD; nur für Tests kürzer). erzwingen: der Massenlöschungs-Riegel (mehr als die Hälfte der Dateien eines Kontos, mindestens 3) wird übergangen — erst nach Prüfung des Trockenlaufs.
// → { anwenden, nichtsZuTun, zeile, plan, sicherung, commit, zaehler, fehler: [], warnungen: [], ok }   (Lesefehler und nicht angewendete Projekte stehen in fehler bzw. warnungen)
export function gleicheAb({ wurzel, konten, projekt = null, anwenden = false, jetzt = Date.now(), temp = [tmpdir()], gitCmd = null, haken = {}, warteMs = 0, erzwingen = false, zeitgrenzen = {} } = {}) {
  if (!wurzel || !Array.isArray(konten)) throw new Error("gleicheAb braucht wurzel und konten.");
  wurzel = resolve(wurzel); konten = konten.map((k) => resolve(k));
  const sperre = anwenden ? nimmSperre(wurzel, jetzt, warteMs) : null;
  let env = null;
  try {
    Object.assign(ZEIT, ZEIT_STANDARD, Object.fromEntries(Object.entries(zeitgrenzen ?? {}).filter(([k, v]) => k in ZEIT_STANDARD && Number(v) > 0)));
    env = baueUmgebung({ wurzel, konten, jetzt, temp, gitCmd, erzwingen });
    const { plan, intern } = erstellePlan(env, { projekt });
    const blockiert = plan.projekte.filter((x) => x.blockiert.length).map((x) => x.projekt);
    const erg = { anwenden: Boolean(anwenden), nichtsZuTun: plan.aenderungen === 0 && !blockiert.length && !plan.fehler.length, plan, sicherung: null, commit: null, zaehler: { projekte: 0, wurzel: 0, konten: 0, konflikte: 0, aufgeloest: 0 },
      blockiert, fehler: [...plan.fehler], warnungen: plan.warnungen, ok: plan.fehler.length === 0, zeile: "" };
    if (erg.nichtsZuTun) { erg.zeile = planZeile(plan); return erg; }
    if (!anwenden) { erg.zeile = `${plan.aenderungen ? "Gedächtnis (Trockenlauf): " : ""}${planZeile(plan)}`; return erg; }

    const arbeit = plan.projekte.filter((x) => x.noetig && !x.blockiert.length).map((x) => intern.get(x.projekt));
    if (!arbeit.length) { erg.zeile = planZeile(plan); return erg; }          // nur blockierte oder fehlerhafte Projekte: es gibt nichts anzuwenden
    if (haken.nachPlan) haken.nachPlan();
    // Sicherung nur, wenn Dateien überschrieben/gelöscht werden: Wurzel-Ordner und die memory-Ordner der Konten (nicht die Symlinks)
    const sich = [];
    for (const pr of arbeit.filter((y) => y.datenAenderung)) {
      if (existsSync(pr.ziel)) sich.push({ von: pr.ziel, als: `wurzel/${pr.projekt}` });
      for (const x of pr.konten) if (x.aktiv && x.zustand === "echt") sich.push({ von: x.memory, als: `konten/${x.konto}/${pr.projekt}/memory` });
    }
    if (sich.length) { const info = {}; erg.sicherung = sichere(wurzel, sich, jetzt, info); erg.sicherungenEntfernt = info.rotiert || 0; }
    mkdirSync(wurzel, { recursive: true });
    raeumeTempAuf(wurzel);
    env.gitBereit = sorgeFuerRepo(wurzel, env.git, erg.warnungen);
    for (const pr of arbeit) {
      try { wendeProjektAn(env, pr, haken, erg); erg.zaehler.projekte++; erg.zaehler.konflikte += pr.konflikte.length; erg.zaehler.aufgeloest += pr.aufgeloeste.length; }
      catch (e) { const m = erste(e.message); erg.fehler.push(m.startsWith(`${pr.projekt}:`) ? m : `${pr.projekt}: ${m}`); }
    }
    const z = erg.zaehler;
    erg.commit = commitWurzel(wurzel, `gedaechtnis: abgleichen — ${z.projekte} Projekt(e), ${z.wurzel} Datei(en) in der Wurzel, ${z.konten} in Konten verteilt${z.konflikte ? `, ${z.konflikte} Konflikt(e)` : ""}${z.aufgeloest ? `, ${z.aufgeloest} aufgelöste Konflikt-Kopie(n) entfernt` : ""}`, env.git, erg.warnungen);
    erg.ok = erg.fehler.length === 0;
    erg.zeile = `Gedächtnis: ${z.projekte} Projekt(e) abgeglichen, ${z.wurzel} Datei(en) in der Wurzel geändert, ${z.konten} in den Konten${z.konflikte ? `, ${z.konflikte} Konflikt(e) (${kurzPfad(join(wurzel, "<Projekt>", KONFLIKTE))})` : ""}${z.aufgeloest ? `, ${z.aufgeloest} aufgelöste Konflikt-Kopie(n) entfernt` : ""}${MASSEN_ZEILE(plan)}${erg.fehler.length ? `, ${erg.fehler.length} Fehler` : ""}`;
    return erg;
  } finally {
    Object.assign(ZEIT, ZEIT_STANDARD);
    if (env) env.aufraeumen();
    if (sperre) { try { unlinkSync(sperre); } catch {} }
  }
}

// ------------------------------------------------------------------------------------------ status
export function statusGedaechtnis({ wurzel, konten, temp = [tmpdir()], gitCmd = null } = {}) {
  wurzel = resolve(wurzel); konten = konten.map((k) => resolve(k));
  let env = null;
  try {
    env = baueUmgebung({ wurzel, konten, jetzt: Date.now(), temp, gitCmd });
    const { plan } = erstellePlan(env);
    let offeneKonflikte = 0;
    const projekte = plan.projekte.map((p) => {
      const konflikteKopien = NUR_ORDNER(p.ziel) ? [...leseBaum(p.ziel).dateien].filter(([r, e]) => istKonfliktKopie(r) && !istAufgeloesteKopie(r, e.b.toString("utf8"))).length : 0;
      offeneKonflikte += konflikteKopien;
      return { projekt: p.projekt, wurzelVorhanden: NUR_ORDNER(p.ziel), abgeglichen: !p.noetig && !p.fehler.length && p.konten.every((k) => k.aktion !== "uebersprungen"), blockiert: p.blockiert.length > 0, fehler: p.fehler,
        konten: p.konten.map((k) => ({ konto: k.konto, zustand: k.zustand, vonKonto: k.vonKonto.neu + k.vonKonto.geaendert + k.vonKonto.geloescht + k.vonKonto.gemerged, nachKonto: k.schreiben + k.loeschen })),
        konflikte: konflikteKopien };
    });
    return { wurzel, wurzelVorhanden: plan.wurzelVorhanden, konten: plan.konten, projekte, uebersprungen: plan.uebersprungen.length, offeneKonflikte, warnungen: plan.warnungen, fehler: plan.fehler,
      abgeglichenGanz: projekte.filter((p) => p.abgeglichen).length };
  } finally { if (env) env.aufraeumen(); }
}

// ------------------------------------------------------------------------------------------ Tageslauf-Schritt
// Am Anfang des Tageslaufs, nur mit gedaechtnisTeilen=an. Wirft nie. Im Probelauf nur Plan (Trockenlauf). Ergebnis: ctx.gedaechtnis (eine Zeile).
export function gedaechtnisSchritt(ctx) {
  try {
    if (ctx?.werte?.gedaechtnisTeilen !== "an") return;
    const p = gedaechtnisPfade(ctx.werte, { home: ctx.home || homedir() });
    const r = gleicheAb({ wurzel: p.wurzel, konten: p.konten, anwenden: !ctx.probe, jetzt: ctx.jetzt, gitCmd: ctx.vault ? gitBefehl({ cfg: ladeConfig(ctx.vault) }) : null });
    ctx.gedaechtnis = r.zeile;
    if (r.fehler.length) ctx.gedaechtnis += ` — ${r.fehler.slice(0, 2).join("; ")}`;
  } catch (e) { ctx.gedaechtnis = `Gedächtnis: Fehler — ${erste(e?.message || e).slice(0, 240)}`; }
}

// ------------------------------------------------------------------------------------------ Hook-Auslöser (SessionStart/SessionEnd)
// Projekt-Schlüssel = Name des Elternordners von transcript_path (das ist exakt Claudes Schlüssel); ohne gültigen Schlüssel null.
export function projektAusTranskript(pfad) {
  if (typeof pfad !== "string" || !pfad.trim()) return null;
  const p = basename(dirname(pfad.trim().replace(/\\/g, "/")));
  return istEchterProjektSchluessel(p) ? p : null;
}
function starteLosgeloest({ vault, projekt }) {
  const kind = spawn(process.execPath, [fileURLToPath(import.meta.url), vault, "abgleichen", "--projekt", projekt, "--anwenden", "--ins-log", "--warte", "30"],
    { detached: true, stdio: "ignore", windowsHide: true, env: { ...process.env, BRAIN_VAULT: vault } });
  kind.on("error", () => {});
  kind.unref();
}
// Nur mit gedaechtnisTeilen=an: stößt den Abgleich des aktuellen Projekts losgelöst im Hintergrund an (der Hook wartet nie). Wirft nie.
// starte (Testhaken) ersetzt den echten Start. → { gestartet, grund?, projekt? }
export function starteAbgleichFuerSitzung({ vault, eingabe, werte, starte = starteLosgeloest } = {}) {
  try {
    if (werte?.gedaechtnisTeilen !== "an") return { gestartet: false, grund: "aus" };
    const projekt = projektAusTranskript(eingabe?.transcript_path);
    if (!projekt) return { gestartet: false, grund: "kein-projekt" };
    starte({ vault, projekt });
    return { gestartet: true, projekt };
  } catch { return { gestartet: false, grund: "fehler" }; }
}

// ------------------------------------------------------------------------------------------ Ausgabe und CLI
function planText(erg, home = homedir()) {
  const p = erg.plan, z = [], fertig = erg.anwenden;
  z.push(`Gedächtnis abgleichen — ${fertig ? "ANGEWENDET" : "TROCKENLAUF (es wird nichts geändert)"}`);
  z.push(`Wurzel: ${kurzPfad(p.wurzel, home)}${fertig || p.wurzelVorhanden ? "" : " (wird angelegt)"}${fertig || p.gitRepo ? "" : " · lokales Git-Repo wird beim ersten Lauf angelegt"}`);
  z.push(`Konten: ${p.konten.map((k) => `${k.name} (${kurzPfad(k.pfad, home)}${k.status === "ok" ? "" : `, ${k.status === "fehlt" ? "nicht vorhanden" : "kein Claude-Konto"}`})`).join(", ") || "keine"}`);
  const arbeit = p.projekte.filter((x) => x.noetig);
  if (!arbeit.length) z.push(p.fehler.length ? "Projekte: nichts anzuwenden." : "Projekte: nichts zu tun.");
  for (const x of arbeit) {
    const teile = [];
    const w = x.wurzel;
    if (w.neu + w.geaendert + w.geloescht) teile.push(`Wurzel: ${[w.neu && `${w.neu} neu`, w.geaendert && `${w.geaendert} geändert`, w.geloescht && `${w.geloescht} gelöscht`].filter(Boolean).join(", ")}`);
    if (x.merges.length) teile.push(`${x.merges.length} zusammengeführt (${x.merges.join(", ")})`);
    if (x.konflikte.length) teile.push(`${x.konflikte.length} Konflikt(e) (${x.konflikte.map((k) => k.datei).join(", ")})`);
    if (x.aufgeloeste.length) teile.push(`aufgelöste Konflikt-Kopie(n) entfernt: ${x.aufgeloeste.join(", ")}`);
    if (!x.datenAenderung) teile.push("nur Manifest");
    if (x.blockiert.length) teile.push("NICHT angewendet (Massenlöschung — siehe Hinweis)");
    z.push(`  ${x.projekt}${teile.length ? ` — ${teile.join(" · ")}` : ""}`);
    for (const k of x.konten) {
      const v = k.vonKonto, an = [];
      const von = [v.neu && `${v.neu} neu`, v.geaendert && `${v.geaendert} geändert`, v.geloescht && `${v.geloescht} gelöscht`, v.gemerged && `${v.gemerged} gemergt`].filter(Boolean);
      if (von.length) an.push(`von ${k.konto} in die Wurzel: ${von.join(", ")}`);
      if (k.aktion === "symlink-ersetzen") an.push("Symlink → echter Ordner");
      if (k.schreiben + k.loeschen && k.aktion !== "symlink-ersetzen") an.push(`${k.schreiben} schreiben, ${k.loeschen} löschen`);
      if (an.length) z.push(`      ${k.konto}: ${an.join(" · ")}`);
    }
  }
  if (p.uebersprungen.length) z.push(`Übersprungen: ${p.uebersprungen.length} temporäre(s) Projekt(e) (-private-…, -tmp…, Scratchpad)`);
  for (const w of erg.warnungen) z.push(`Hinweis: ${w}`);
  if (erg.sicherung) z.push(`Sicherung: ${kurzPfad(erg.sicherung, home)}${erg.sicherungenEntfernt ? ` (${erg.sicherungenEntfernt} alte Sicherung(en) rotiert)` : ""}`);
  if (erg.commit) z.push(`Git: Commit ${erg.commit} in der Wurzel`);
  for (const f of erg.fehler) z.push(`FEHLER: ${f}`);
  if (!fertig && !erg.nichtsZuTun) z.push("Zum Ausführen: brain gedaechtnis abgleichen --anwenden");
  z.push(erg.zeile);
  return z.join("\n");
}
function statusText(s, werte, home = homedir()) {
  const z = [`Gemeinsames Gedächtnis — Wurzel ${kurzPfad(s.wurzel, home)}${s.wurzelVorhanden ? "" : " (noch nicht angelegt)"}`];
  z.push(`Schalter gedaechtnisTeilen: ${werte.gedaechtnisTeilen} (nur bei „an“ gleichen Tageslauf und Sitzungsstart/-ende von selbst ab)`);
  z.push(`Konten: ${s.konten.map((k) => `${k.name}${k.status === "ok" ? "" : ` (${k.status === "fehlt" ? "nicht vorhanden" : "kein Claude-Konto"})`}`).join(", ") || "keine"}`);
  if (!s.projekte.length) z.push("Keine Projekte mit Gedächtnis gefunden.");
  const zustandText = { symlink: "Symlink der alten Version (wird ersetzt)", fremd: "Symlink auf etwas anderes", datei: "memory ist eine Datei", fehlt: "memory fehlt" };
  for (const p of s.projekte) {
    const konfl = p.konflikte ? ` · ${p.konflikte} Konflikt-Kopie(n)` : "";
    if (p.abgeglichen) { z.push(`  ✓ ${p.projekt} — abgeglichen${konfl}`); continue; }
    const teile = p.konten.map((k) => {
      const t = [];
      if (zustandText[k.zustand] && k.zustand !== "fehlt") t.push(zustandText[k.zustand]);
      if (k.vonKonto) t.push(`${k.vonKonto} Änderung(en) einzuarbeiten`);
      if (k.nachKonto) t.push(`${k.nachKonto} Datei(en) zu verteilen`);
      return t.length ? `${k.konto}: ${t.join(", ")}` : null;
    }).filter(Boolean);
    z.push(`  ⚠ ${p.projekt} — ${teile.join("; ") || "Manifest fehlt (noch nie abgeglichen)"}${konfl}`);
  }
  if (s.uebersprungen) z.push(`${s.uebersprungen} temporäre(s) Projekt(e) ausgelassen`);
  for (const w of s.warnungen) z.push(`Hinweis: ${w}`);
  for (const f of s.fehler) z.push(`FEHLER: ${f}`);
  z.push(s.offeneKonflikte ? `Offene Konflikte: ${s.offeneKonflikte} (je Projekt in ${KONFLIKTE})` : "Keine offenen Konflikte.");
  z.push(`${s.abgeglichenGanz} von ${s.projekte.length} Projekt(en) abgeglichen`);
  return z.join("\n");
}

export function leseArgs(argv) {
  const o = { befehl: "status", anwenden: false, json: false, insLog: false, projekt: null, warte: 0, vault: null, erzwingen: false };
  let befehlGesetzt = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--anwenden") o.anwenden = true;
    else if (a === "--json") o.json = true;
    else if (a === "--ins-log") o.insLog = true;
    else if (a === "--erzwingen") o.erzwingen = true;
    else if (a === "--projekt") { if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error("--projekt braucht einen Projekt-Schlüssel"); o.projekt = argv[++i]; }
    else if (a === "--warte") { const n = Number(argv[++i]); if (!Number.isFinite(n) || n < 0 || n > 600) throw new Error("--warte braucht eine Zahl Sekunden (0–600)"); o.warte = n; }
    else if (a.startsWith("--")) throw new Error(`Unbekannte Angabe: ${a}`);
    else if (a === "verbinden" || a === "trennen") throw new Error(`„${a}“ gibt es nicht mehr — die Konten behalten echte Ordner; jetzt: abgleichen`);
    else if (!befehlGesetzt && ["status", "abgleichen"].includes(a)) { o.befehl = a; befehlGesetzt = true; }
    else if (!o.vault) o.vault = a;
    else throw new Error(`Unbekannte Angabe: ${a}`);
  }
  return o;
}

let aufruf = "";
try { aufruf = realpathSync(process.argv[1] || ""); } catch {}
if (aufruf && aufruf === realpathSync(fileURLToPath(import.meta.url))) {
  let o;
  try { o = leseArgs(process.argv.slice(2)); }
  catch (e) { console.error(`${e.message}\nNutzung: brain gedaechtnis [status|abgleichen] [--projekt <P>] [--anwenden] [--erzwingen] [--json]`); process.exit(64); }
  const vault = o.vault || vaultPfadOderEnde([]);
  const ins = (text) => { if (!o.insLog) return; try { mkdirSync(join(vault, ".logs"), { recursive: true }); appendFileSync(join(vault, ".logs", "hooks.log"), `${text}\n`); } catch {} };
  try {
    const werte = leseAutomatik(vault).werte;
    const p = gedaechtnisPfade(werte);
    const gitCmd = gitBefehl({ cfg: ladeConfig(vault) });
    let ausgabe, code = 0;
    if (o.befehl === "status") {
      const s = statusGedaechtnis({ ...p, gitCmd });
      ausgabe = o.json ? JSON.stringify({ ...s, schalter: werte.gedaechtnisTeilen }) : statusText(s, werte);
    } else {
      const r = gleicheAb({ ...p, projekt: o.projekt, anwenden: o.anwenden, gitCmd, warteMs: o.warte * 1000, erzwingen: o.erzwingen });
      ausgabe = o.json ? JSON.stringify(r) : planText(r);
      if (!r.ok) code = 1;
      if (!r.nichtsZuTun || !r.ok) ins(`gedaechtnis${o.projekt ? ` ${o.projekt}` : ""}: ${r.zeile}${r.fehler.length ? ` — ${r.fehler.slice(0, 2).join("; ")}` : ""}`);
    }
    console.log(ausgabe);
    process.exitCode = code;
  } catch (e) {
    ins(`gedaechtnis: Fehler — ${erste(e?.message || e)}`);
    console.error(`Fehler: ${erste(e?.message || e)}`);
    process.exitCode = 1;
  }
}
