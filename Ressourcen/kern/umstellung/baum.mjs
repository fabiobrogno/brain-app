// umstellung/baum.mjs — Ordnerbäume vergleichen, verschieben und wieder zusammenführen (Paket P7d, Phase B: der alte Werkzeug-Ordner wandert ins Archiv und notfalls zurück).
//
// Verschieben = umbenennen (gleiches Laufwerk, atomar). Über eine Laufwerksgrenze (EXDEV) wird kopiert, die Kopie Datei für Datei mit der Quelle verglichen (Art, Rechte, Größe, SHA-256,
// Ziel von Verknüpfungen) und erst danach die Quelle entfernt. Verknüpfungen werden nie verfolgt. Es entstehen keine Werte, nur Hashes; Pfade sind relativ zur Wurzel.
import { lstatSync, readdirSync, readlinkSync, readFileSync, renameSync, mkdirSync, rmSync, existsSync, cpSync, symlinkSync, copyFileSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";

const sha = (t) => createHash("sha256").update(t).digest("hex");
export const lexists = (p) => { try { lstatSync(p); return true; } catch { return false; } };

function beschreibe(p, l, inhalt) {
  if (l.isSymbolicLink()) return `l ${readlinkSync(p)}`;
  if (l.isDirectory()) return `d ${l.mode & 0o777}`;
  if (l.isFile()) {
    let h = "-";
    if (inhalt) { try { h = sha(readFileSync(p)); } catch { h = "unlesbar"; } }
    return `f ${l.mode & 0o777} ${l.size} ${h}`;
  }
  return "o";
}
// → Map Pfad (relativ, "" = Wurzel) → Beschreibung. Die Wurzel selbst darf eine Verknüpfung oder Datei sein.
export function baumEintraege(wurzel, { inhalt = true } = {}) {
  const m = new Map();
  let l;
  try { l = lstatSync(wurzel); } catch { return m; }
  m.set("", beschreibe(wurzel, l, inhalt));
  if (!l.isDirectory()) return m;
  const lauf = (dir, rel) => {
    let namen = [];
    try { namen = readdirSync(dir).sort(); } catch { return; }
    for (const n of namen) {
      const p = join(dir, n), r = rel ? `${rel}/${n}` : n;
      let e; try { e = lstatSync(p); } catch { continue; }
      m.set(r, beschreibe(p, e, inhalt));
      if (e.isDirectory()) lauf(p, r);
    }
  };
  lauf(wurzel, "");
  return m;
}
export function baumHash(wurzel, opt) {
  const m = baumEintraege(wurzel, opt);
  return sha([...m.entries()].map(([k, v]) => `${k}\t${v}`).join("\n"));
}
// Grobe Größe (Dateien, Bytes), ohne Verknüpfungen zu folgen
export function baumGroesse(wurzel) {
  let dateien = 0, bytes = 0;
  const m = baumEintraege(wurzel, { inhalt: false });
  for (const v of m.values()) { const t = /^f \d+ (\d+)/.exec(v); if (t) { dateien++; bytes += Number(t[1]); } }
  return { dateien, bytes };
}
// Ist `teil` vollständig und gleich in `ganz` enthalten? (Beschreibungen müssen übereinstimmen)
export function baumEnthalten(teil, ganz) {
  const a = baumEintraege(teil), b = baumEintraege(ganz);
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

function kopiere(quelle, ziel) {
  const l = lstatSync(quelle);
  mkdirSync(dirname(ziel), { recursive: true });
  if (l.isSymbolicLink()) { symlinkSync(readlinkSync(quelle), ziel); return; }
  if (l.isDirectory()) { cpSync(quelle, ziel, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true, errorOnExist: true, force: false }); return; }
  copyFileSync(quelle, ziel); chmodSync(ziel, l.mode & 0o777);
}

// Verschiebt `quelle` nach `ziel` (das Ziel darf nicht existieren). Optionen: umbenenner (Test: simuliert EXDEV), platz(bytes) → bool vor dem Kopieren, pruefpunkt(name).
// → "umbenannt" | "kopiert"
export function verschiebeBaum(quelle, ziel, { umbenenner = renameSync, platz = null, pruefpunkt = () => {} } = {}) {
  if (lexists(ziel)) throw new Error("ziel-existiert");
  mkdirSync(dirname(ziel), { recursive: true });
  try { umbenenner(quelle, ziel); return "umbenannt"; } catch (e) { if (!e || e.code !== "EXDEV") throw e; }
  const vorher = baumEintraege(quelle);
  if (platz && platz(baumGroesse(quelle).bytes) === false) throw new Error("zu-wenig-platz");
  try {
    kopiere(quelle, ziel);
    pruefpunkt("nach-kopie");
    const nachher = baumEintraege(ziel);
    const gleich = nachher.size === vorher.size && [...vorher].every(([k, v]) => nachher.get(k) === v);
    if (!gleich) throw new Error("kopie-weicht-ab");
  } catch (e) {
    if (e && e.name === "TestAbbruch") throw e;     // ein simulierter Absturz lässt alles liegen, wie es ist
    try { rmSync(ziel, { recursive: true, force: true }); } catch { /* bleibt */ }
    throw e;
  }
  pruefpunkt("vor-entfernen");
  try { rmSync(quelle, { recursive: true, force: true }); } catch { /* unten geprüft */ }
  if (lexists(quelle)) throw new Error("quelle-nicht-entfernbar");
  return "kopiert";
}

// Bringt `archiv` an `ziel` zurück. Fehlt das Ziel, wandert der Baum zurück. Gibt es das Ziel schon (z. B. weil `git revert` die versionierten Dateien wiederhergestellt hat, oder weil
// ein Abbruch das Original nur halb entfernt hat), wird zusammengeführt: das Archiv ist der Stand vor Phase B und gewinnt; erst wenn alles gleich vorhanden ist, wird das Archiv entfernt.
// → "verschoben" | "zusammengefuehrt"
export function fuegeBaumZurueck(archiv, ziel, opt = {}) {
  if (!lexists(ziel)) { verschiebeBaum(archiv, ziel, opt); return "verschoben"; }
  const rl = lstatSync(archiv), zl = lstatSync(ziel);
  if (!rl.isDirectory() || !zl.isDirectory()) throw new Error("ziel-ist-anders");
  for (const [rel] of baumEintraege(archiv, { inhalt: false })) {
    if (rel === "") continue;
    const q = join(archiv, rel), z = join(ziel, rel);
    const ql = lstatSync(q);
    if (ql.isDirectory()) { if (lexists(z) && !lstatSync(z).isDirectory()) rmSync(z, { recursive: true, force: true }); mkdirSync(z, { recursive: true }); continue; }
    if (lexists(z)) {
      const zl2 = lstatSync(z);
      if (ql.isSymbolicLink() && zl2.isSymbolicLink() && readlinkSync(q) === readlinkSync(z)) continue;
      if (ql.isFile() && zl2.isFile() && (zl2.mode & 0o777) === (ql.mode & 0o777) && zl2.size === ql.size && sha(readFileSync(z)) === sha(readFileSync(q))) continue;
      rmSync(z, { recursive: true, force: true });
    }
    kopiere(q, z);
  }
  if (!baumEnthalten(archiv, ziel)) throw new Error("zusammenfuehren-unvollstaendig");
  rmSync(archiv, { recursive: true, force: true });
  return "zusammengefuehrt";
}

export const heuteTag = (d = new Date()) => d.toISOString().slice(0, 10);
export const gibtEs = (p) => existsSync(p);
