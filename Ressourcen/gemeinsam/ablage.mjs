// gemeinsam/ablage.mjs — die Fassungs-Ablage von Kortex: bevor Kortex eine Notiz ersetzt, die jemand anderes geändert hat (KI, Abgleich, anderes Programm),
// oder eine Fassung verwirft, die du getippt hast, liegt sie hier. So geht nie still etwas verloren — auch nicht, wenn der Vault kein git hat oder die
// fremde Änderung noch nie committet war.
// Ablageort: <Support>/fassungen/<Kennung des Vaults>/<id>.json (Angaben) + <id>.txt (der Text, Byte für Byte). Ordner 0700, Dateien 0600 (es sind deine Notizen).
// Aufgeräumt wird beim Ablegen: nach 90 Tagen, und es bleiben höchstens 300 Fassungen je Vault (die ältesten gehen zuerst). Nichts davon verlässt den Mac.
import { mkdirSync, writeFileSync, readFileSync, readdirSync, renameSync, unlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { HttpFehler, MAX_DATEI } from "./basis.mjs";
import { kennung as vaultKennung } from "./sicherungsmerker.mjs";

export const ABLAGE_ORDNER = "fassungen";
const MAX_TAGE = 90, MAX_ANZAHL = 300;
const MAX_BYTES = 200 * 1024 * 1024;   // Gesamtgrenze je Vault: darüber gehen die ältesten Fassungen zuerst
const ID = /^f_[0-9a-z]{6,12}_[0-9a-f]{8}$/;
const STEUER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const kurz = (s, n) => String(s ?? "").replace(STEUER, " ").replace(/\s+/g, " ").trim().slice(0, n);

const ordner = (support, wurzel) => join(support, ABLAGE_ORDNER, vaultKennung(wurzel));
function schreibeAtomar(datei, inhalt) {
  const tmp = `${datei}.${process.pid}.${randomBytes(3).toString("hex")}.tmp`;
  try { writeFileSync(tmp, inhalt, { flag: "wx", mode: 0o600 }); renameSync(tmp, datei); }
  catch (e) { try { unlinkSync(tmp); } catch { /* schon weg */ } throw e; }
}
function lesenJson(datei) {
  try { const o = JSON.parse(readFileSync(datei, "utf8")); return o && typeof o === "object" && !Array.isArray(o) ? o : null; } catch { return null; }
}
const eintraege = (dir) => {
  let namen; try { namen = readdirSync(dir); } catch { return []; }
  return namen.filter((n) => n.endsWith(".json")).map((n) => ({ id: n.slice(0, -5), ...lesenJson(join(dir, n)) })).filter((o) => ID.test(o.id) && typeof o.pfad === "string" && typeof o.zeit === "string");
};

// Legt einen Text ab. a = { pfad (relativ im Vault), inhalt (Text), grund ("fremd-ueberschrieben" | "fremd-eingearbeitet" | "meine-verworfen" | …), quelle (z. B. "Claude Code") }.
// Gleicher Text für dieselbe Datei wie die jüngste Fassung → keine zweite Kopie. → { id, zeit, neu }. Wirft, wenn nicht geschrieben werden konnte (dann darf nichts überschrieben werden).
export function legeAb(support, wurzel, a) {
  if (typeof support !== "string" || !support) throw new HttpFehler(500, "Die Ablage für gesicherte Fassungen ist nicht verfügbar.");
  if (typeof a.inhalt !== "string" || typeof a.pfad !== "string" || !a.pfad) throw new HttpFehler(400, "Die Fassung konnte nicht abgelegt werden.");
  if (Buffer.byteLength(a.inhalt, "utf8") > MAX_DATEI) throw new HttpFehler(413, "Die Datei ist zu groß.");
  const dir = ordner(support, wurzel);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const hash = createHash("sha256").update(a.inhalt, "utf8").digest("hex");
  const vorhandene = eintraege(dir);
  const juengste = vorhandene.filter((e) => e.pfad === a.pfad && e.grund === (a.grund || null)).sort((x, y) => (x.zeit < y.zeit ? 1 : -1))[0];
  if (juengste && juengste.hash === hash) return { id: juengste.id, zeit: juengste.zeit, neu: false };
  const zeit = new Date().toISOString();
  const id = `f_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
  schreibeAtomar(join(dir, `${id}.txt`), a.inhalt);
  schreibeAtomar(join(dir, `${id}.json`), JSON.stringify({ pfad: a.pfad, zeit, grund: kurz(a.grund, 40) || null, quelle: kurz(a.quelle, 60) || null, hash, groesse: Buffer.byteLength(a.inhalt, "utf8") }) + "\n");
  aufraeumen(dir, id);
  return { id, zeit, neu: true };
}

function aufraeumen(dir, behalte) {
  try {
    const grenze = Date.now() - MAX_TAGE * 86_400_000;
    const alle = eintraege(dir).sort((x, y) => (x.zeit < y.zeit ? -1 : 1));
    const weg = new Set(alle.filter((e) => e.id !== behalte && Date.parse(e.zeit) < grenze).map((e) => e.id));
    const uebrig = alle.filter((e) => !weg.has(e.id));
    for (const e of uebrig.slice(0, Math.max(0, uebrig.length - MAX_ANZAHL))) if (e.id !== behalte) weg.add(e.id);
    let summe = uebrig.filter((e) => !weg.has(e.id)).reduce((n, e) => n + (Number(e.groesse) || 0), 0);
    for (const e of uebrig) { if (summe <= MAX_BYTES) break; if (e.id === behalte || weg.has(e.id)) continue; weg.add(e.id); summe -= Number(e.groesse) || 0; }
    for (const id of weg) for (const ende of [".json", ".txt"]) { try { unlinkSync(join(dir, id + ende)); } catch { /* schon weg */ } }
  } catch { /* Aufräumen ist beste Mühe */ }
}

// Die Fassungen einer Datei (oder aller), neueste zuerst. Ohne Text.
export function liste(support, wurzel, pfad = null) {
  return eintraege(ordner(support, wurzel)).filter((e) => !pfad || e.pfad === pfad).sort((x, y) => (x.zeit < y.zeit ? 1 : -1))
    .map(({ id, pfad: p, zeit, grund, quelle, hash, groesse }) => ({ id, pfad: p, zeit, grund: grund || null, quelle: quelle || null, hash, groesse }));
}

// Eine Fassung mit Text. Unbekannte oder ungültige Kennung → 404.
export function lese(support, wurzel, id) {
  if (typeof id !== "string" || !ID.test(id)) throw new HttpFehler(404, "Diese Fassung gibt es nicht.");
  const dir = ordner(support, wurzel);
  const o = lesenJson(join(dir, `${id}.json`));
  let text; try { text = readFileSync(join(dir, `${id}.txt`), "utf8"); } catch { text = null; }
  if (!o || text === null) throw new HttpFehler(404, "Diese Fassung gibt es nicht.");
  return { id, pfad: o.pfad, zeit: o.zeit, grund: o.grund || null, quelle: o.quelle || null, hash: o.hash, groesse: o.groesse, inhalt: text };
}

export const ablageGroesse = (support, wurzel) => { try { return statSync(ordner(support, wurzel)).isDirectory() ? eintraege(ordner(support, wurzel)).length : 0; } catch { return 0; } };
