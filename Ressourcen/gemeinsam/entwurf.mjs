// gemeinsam/entwurf.mjs — das Entwurfs-Journal: ungespeicherter Text einer offenen Notiz, damit er einen Absturz überlebt (Studio, WebView, Werkstatt).
// Ablageort: <Support>/entwuerfe/<Kennung des Vaults>/<Hash des Pfads>.json, Ordner 0700, Datei 0600 (es ist dein Text). Inhalt:
//   { v: 1, pfad, basisHash (Stand der Datei, auf dem der Text aufbaut), zeit (ISO), text }
// Ein Entwurf entsteht nur, wenn eine Eingabe länger ungespeichert bleibt (das Studio schreibt alle paar Sekunden und beim Verlassen des Fensters) und wird
// nach jedem erfolgreichen Speichern gelöscht. Beim Öffnen einer Notiz und beim Start prüft das Studio: ist ein Entwurf NEUER als die Datei und anders als ihr
// Inhalt, bietet es „Ungespeicherten Text wiederherstellen“ an. Entwürfe, die älter als 30 Tage sind, räumt das Auflisten weg — vorher legt es sie in die Ablage (nichts geht still verloren).
import { mkdirSync, writeFileSync, readFileSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { HttpFehler, MAX_DATEI, loese } from "./basis.mjs";
import { kennung as vaultKennung } from "./sicherungsmerker.mjs";
import { legeAb } from "./ablage.mjs";

export const ENTWURF_ORDNER = "entwuerfe";
const MAX_TAGE = 30;

const ordner = (support, wurzel) => join(support, ENTWURF_ORDNER, vaultKennung(wurzel));
const pfadHash = (rel) => createHash("sha256").update(rel, "utf8").digest("hex").slice(0, 32);
const datei = (support, wurzel, rel) => join(ordner(support, wurzel), `${pfadHash(rel)}.json`);
function relativ(wurzel, pfad) {
  if (typeof pfad !== "string" || !pfad) throw new HttpFehler(400, "Der Pfad fehlt.");
  return loese(wurzel, pfad).rel; // nur Pfade im Vault, ohne .., ohne gesperrte Namen
}
function lesenJson(d) {
  try { const o = JSON.parse(readFileSync(d, "utf8")); return o && o.v === 1 && typeof o.pfad === "string" && typeof o.text === "string" && Number.isFinite(Date.parse(o.zeit)) ? o : null; } catch { return null; }
}

// Entwürfe NEUER Notizen ohne Datei (⌘N, Tagesnotiz, Vorlage) liegen unter dem Schlüssel `entwurf:<Kennung>`; `meta` ({ pfad, ordner, tag }, klein) sagt, wohin sie gehören.
export const entwurfSchluessel = (id) => `entwurf:${id}`;
const MAX_META = 2000;

// Schreibt (ersetzt) den Entwurf der Datei. basisHash darf null sein (neue Datei). → { zeit }
export function schreibeEntwurf(support, wurzel, { pfad, basisHash = null, text, meta = null }) {
  if (typeof support !== "string" || !support) throw new HttpFehler(500, "Das Entwurfs-Journal ist nicht verfügbar.");
  if (typeof text !== "string") throw new HttpFehler(400, "Der Text fehlt.");
  if (basisHash !== null && typeof basisHash !== "string") throw new HttpFehler(400, "basisHash ist ein Text oder null.");
  if (Buffer.byteLength(text, "utf8") > MAX_DATEI) throw new HttpFehler(413, "Die Datei ist zu groß.");
  if (meta !== null && (typeof meta !== "object" || Array.isArray(meta) || JSON.stringify(meta).length > MAX_META)) throw new HttpFehler(400, "meta ist ein kleines Objekt oder null.");
  const rel = relativ(wurzel, pfad);
  const dir = ordner(support, wurzel);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const ziel = datei(support, wurzel, rel), tmp = `${ziel}.${process.pid}.${randomBytes(3).toString("hex")}.tmp`;
  const zeit = new Date().toISOString();
  try { writeFileSync(tmp, JSON.stringify({ v: 1, pfad: rel, basisHash, zeit, text, ...(meta ? { meta } : {}) }) + "\n", { flag: "wx", mode: 0o600 }); renameSync(tmp, ziel); }
  catch (e) { try { unlinkSync(tmp); } catch { /* schon weg */ } throw new HttpFehler(500, `Der Entwurf konnte nicht geschrieben werden (${e.code || "Fehler"}).`); }
  return { zeit };
}

// → { pfad, basisHash, zeit, text } oder null
export function leseEntwurf(support, wurzel, pfad) {
  const rel = relativ(wurzel, pfad);
  const o = lesenJson(datei(support, wurzel, rel));
  return o && o.pfad === rel ? { pfad: o.pfad, basisHash: o.basisHash ?? null, zeit: o.zeit, text: o.text, meta: o.meta ?? null } : null;
}

export function loescheEntwurf(support, wurzel, pfad) {
  const rel = relativ(wurzel, pfad);
  try { unlinkSync(datei(support, wurzel, rel)); return true; } catch { return false; }
}

// Alle Entwürfe des Vaults (ohne Text), neueste zuerst; Entwürfe über 30 Tage werden dabei entfernt.
export function listeEntwuerfe(support, wurzel) {
  const dir = ordner(support, wurzel);
  let namen; try { namen = readdirSync(dir); } catch { return []; }
  const grenze = Date.now() - MAX_TAGE * 86_400_000, aus = [];
  for (const n of namen) {
    if (!n.endsWith(".json")) continue;
    const o = lesenJson(join(dir, n));
    if (!o) continue;
    if (Date.parse(o.zeit) < grenze) {
      // erst in die Ablage, dann weg; lässt sich nicht ablegen, bleibt der Entwurf liegen
      try { legeAb(support, wurzel, { pfad: o.pfad, inhalt: o.text, grund: "entwurf-verworfen", quelle: "Entwurf (älter als 30 Tage)" }); unlinkSync(join(dir, n)); } catch { /* bleibt liegen, beim nächsten Mal wieder */ }
      continue;
    }
    aus.push({ pfad: o.pfad, basisHash: o.basisHash ?? null, zeit: o.zeit, groesse: Buffer.byteLength(o.text, "utf8"), ...(o.meta ? { meta: o.meta } : {}) });
  }
  return aus.sort((a, b) => (a.zeit < b.zeit ? 1 : -1));
}

// Eine Notiz (oder ein Ordner samt Inhalt) wurde umbenannt oder verschoben: ihre Entwürfe ziehen mit. Der Text bleibt; die Zeit wird erneuert, denn das Umbenennen hat die Datei
// neu geschrieben (Titel, Verweise) und der Entwurf wäre sonst „älter als die Datei“ und ginge in die Ablage statt wieder angeboten zu werden. Gibt es am neuen Pfad schon einen Entwurf, bleibt der neuere; der ältere kommt in die Ablage. → { bewegt }
export function verschiebeEntwuerfe(support, wurzel, von, nach) {
  const vonRel = relativ(wurzel, von), nachRel = relativ(wurzel, nach);
  const dir = ordner(support, wurzel);
  let namen; try { namen = readdirSync(dir); } catch { return { bewegt: 0 }; }
  let bewegt = 0;
  for (const n of namen) {
    if (!n.endsWith(".json")) continue;
    const o = lesenJson(join(dir, n));
    if (!o || o.pfad.startsWith("entwurf:") || !(o.pfad === vonRel || o.pfad.startsWith(vonRel + "/"))) continue;
    const neuRel = nachRel + o.pfad.slice(vonRel.length);
    const ziel = datei(support, wurzel, neuRel), vorhanden = lesenJson(ziel);
    let behalten = o;
    if (vorhanden) {
      const aelter = Date.parse(vorhanden.zeit) > Date.parse(o.zeit) ? o : vorhanden;
      if (aelter.text !== (vorhanden === aelter ? o : vorhanden).text) { try { legeAb(support, wurzel, { pfad: neuRel, inhalt: aelter.text, grund: "entwurf-verworfen", quelle: "Entwurf (beim Verschieben)" }); } catch { continue; } }
      behalten = aelter === o ? vorhanden : o;
    }
    const tmp = `${ziel}.${process.pid}.${randomBytes(3).toString("hex")}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify({ ...behalten, pfad: neuRel, zeit: new Date().toISOString() }) + "\n", { flag: "wx", mode: 0o600 }); renameSync(tmp, ziel);
      if (join(dir, n) !== ziel) unlinkSync(join(dir, n));
      bewegt++;
    } catch { try { unlinkSync(tmp); } catch { /* schon weg */ } }
  }
  return { bewegt };
}
