// tageslauf/protokoll.mjs — Lauf-Kontext, Aktionsprotokoll, Prüfungen, Cache, letzter.json (B2, Spec §5.2 Nr. 10, §6.3).
// Alles unter .logs/tageslauf/ (git-ignoriert). Probemodus: Aktionen nach probe-aktionen.jsonl, keine Prüfungen.
// Der Cache (Belege, Abgleich, Wahl der Seite, Richter) wird auch im Probemodus geschrieben — so kommen tägliche Probeläufe voran.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, renameSync, openSync, writeSync, readSync, fsyncSync, fstatSync, closeSync, unlinkSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { leseAutomatik, TAGESLAUF_BUDGETS } from "../einstellungen.mjs";
import { hitsSeiten } from "../logs.mjs";
import { neuesBudget } from "./ki.mjs";

export const TL_DIR = (vault) => join(vault, ".logs", "tageslauf");
const datei = (vault, name) => join(TL_DIR(vault), name);
const p2 = (n) => String(n).padStart(2, "0");

export function laufId(d = new Date()) {
  const z = d.toISOString();
  return `${z.slice(0, 4)}${z.slice(5, 7)}${z.slice(8, 10)}-${z.slice(11, 13)}${z.slice(14, 16)}${z.slice(17, 19)}`;
}
export function heute(d = new Date()) { return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; }

export function neuerLauf(vault, { probe = false, jetzt = Date.now(), claudeBefehl, budget = null, home, uhr = Date.now } = {}) {
  const { werte } = leseAutomatik(vault);
  const b = budget || TAGESLAUF_BUDGETS[werte.tageslaufBudget] || TAGESLAUF_BUDGETS.normal;
  return {
    vault, lauf: laufId(new Date(jetzt)), probe, jetzt, heute: heute(new Date(jetzt)), werte, home, claudeBefehl,
    budget: neuesBudget(b, uhr), tokens: { ein: 0, aus: 0 }, aufrufe: 0, ohneKi: false, kiFehlerFolge: 0, grund: null,
    aktionen: [], aktionenGeschrieben: 0, cache: ladeCache(vault), autostufe: "normal", quote: { fehler: 0, geprueft: 0 },
  };
}

export function notiere(ctx, a) {
  const e = { lauf: ctx.lauf, zeit: new Date(ctx.jetzt).toISOString(), ...a };
  ctx.aktionen.push(e);
  return e;
}
// Schreibt, was noch nicht in der Datei steht (ctx.aktionenGeschrieben = so viele Aktionen von vorn sind schon draußen) — wer früher
// schreibt (Übernahmen direkt nach dem Merge), schreibt am Laufende nichts doppelt. sicher: append + fsync (übersteht Absturz/Stromausfall).
// Der Zähler rückt erst nach geglücktem Schreiben vor; scheitert es, holt der nächste Aufruf (z. B. im finally) es nach.
export function schreibeAktionen(ctx, { sicher = false } = {}) {
  const ab = ctx.aktionenGeschrieben || 0;
  const offen = ctx.aktionen.slice(ab);
  if (!offen.length) return;
  mkdirSync(TL_DIR(ctx.vault), { recursive: true });
  const text = offen.map((a) => JSON.stringify(a)).join("\n") + "\n";
  const f = datei(ctx.vault, ctx.probe ? "probe-aktionen.jsonl" : "aktionen.jsonl");
  if (sicher) {
    const fd = openSync(f, "a");
    try { writeSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  } else appendFileSync(f, text);
  ctx.aktionenGeschrieben = ab + offen.length;
}
// Fail-closed-Vorprobe des Einschwing-Tors: Das Tor (einschwingen.mjs) zählt nur, was in aktionen.jsonl und pruefungen.jsonl steht. Sind sie nicht lesbar
// oder nicht anhängbar (Ordner statt Datei, Rechte, voller Datenträger), sähe das Tor „nichts“ und ginge ungeprüft auf. Darum vor dem Schreiben — OHNE je etwas in
// die Protokolldateien zu schreiben (ein Anhängen mit anschließendem Kürzen schnitt gleichzeitige fremde Anhänge ab: Stress ~10 000 von 20 000 Zeilen verloren;
// eine stehen gelassene Leerzeile würde jeden Leser verpflichten, sie zu überspringen):
//  - Rechte/Art: beide Dateien zum Lesen + Anhängen öffnen (O_APPEND|O_RDWR; legt eine fehlende Datei leer an), prüfen, dass es Dateien sind, 1 Byte lesen, schließen.
//  - Platz/Ordner: eine Schreibprobe (4 KiB + fsync) in eine Nachbardatei im selben Ordner — dasselbe Dateisystem, dieselben Ordnerrechte —, danach wieder gelöscht.
// → { ok: true } | { ok: false, grund: PROTOKOLL_GRUND, fehler }
export const PROTOKOLL_GRUND = "protokoll-nicht-schreibbar";
export function protokollGesund(vault) {
  let probe = null;
  try {
    mkdirSync(TL_DIR(vault), { recursive: true });
    for (const name of ["aktionen.jsonl", "pruefungen.jsonl"]) {
      const fd = openSync(datei(vault, name), "a+");
      try {
        if (!fstatSync(fd).isFile()) throw Object.assign(new Error("keine Datei"), { code: "ENOTFILE" });
        readSync(fd, Buffer.alloc(1), 0, 1, 0);
      } finally { closeSync(fd); }
    }
    probe = datei(vault, `.schreibprobe-${process.pid}-${randomBytes(4).toString("hex")}.tmp`);
    const fd = openSync(probe, "wx");
    try { writeSync(fd, Buffer.alloc(4096, 0x0a)); fsyncSync(fd); } finally { closeSync(fd); }
    return { ok: true };
  } catch (e) { return { ok: false, grund: PROTOKOLL_GRUND, fehler: String(e?.code || e?.message || e).slice(0, 40) }; }
  finally { if (probe) { try { unlinkSync(probe); } catch { /* nie gelungen oder schon weg */ } } }
}
// Ein Feld einer Aktion nachtragen (z. B. „verschoben“, das erst nach dem frühen Schreiben bekannt ist). Steht die Aktion noch gar nicht in der
// Datei, geht das Feld mit ihrer Zeile raus; sonst kommt eine Nachtrag-Zeile dazu, die leseAktionen wieder in die Aktion einschmilzt.
export function haengeNachtragAn(ctx, a, felder) {
  Object.assign(a, felder);
  if (ctx.probe || !(ctx.aktionen.indexOf(a) < (ctx.aktionenGeschrieben || 0))) return;
  appendFileSync(datei(ctx.vault, "aktionen.jsonl"), JSON.stringify({ lauf: a.lauf, zeit: a.zeit, id: a.id, stufe: a.stufe, nachtrag: true, ...felder }) + "\n");
}
// streng: ein Lesefehler (außer „Datei fehlt“) wirft, statt als „leer“ durchzugehen — für die Selbstheilung, die aus einem Lesefehler nichts folgern darf.
function leseJsonl(f, streng = false) {
  let t = "";
  try { t = readFileSync(f, "utf8"); } catch (e) { if (streng && e?.code !== "ENOENT") throw e; return []; }
  return t.split("\n").filter(Boolean).map((z) => { try { return JSON.parse(z); } catch { return null; } }).filter(Boolean);
}
// Nachtrag-Zeilen (haengeNachtragAn) werden in die Aktion mit gleichem lauf/id/stufe eingeschmolzen und tauchen selbst nicht auf; ohne Gegenstück verfallen sie.
function mitNachtraegen(liste) {
  const aus = [], je = new Map();
  for (const a of liste) {
    const schl = `${a.lauf}\u0000${a.id}\u0000${a.stufe}`;
    if (a.nachtrag !== true) { aus.push(a); je.set(schl, a); continue; }
    const ziel = je.get(schl);
    if (ziel) { const { nachtrag, lauf, zeit, id, stufe, ...rest } = a; Object.assign(ziel, rest); }
  }
  return aus;
}
export const leseAktionen = (vault) => mitNachtraegen(leseJsonl(datei(vault, "aktionen.jsonl")));
// Wie leseAktionen, wirft aber bei einem Lesefehler (Ordner statt Datei, keine Leserechte). Fehlende Datei = leer.
export const leseAktionenStreng = (vault) => mitNachtraegen(leseJsonl(datei(vault, "aktionen.jsonl"), true));
// Fertige Aktionszeilen (Objekte) an aktionen.jsonl hängen: ein Schreibvorgang, append + fsync (übersteht Absturz/Stromausfall). Wirft bei Fehlern.
export function haengeAktionenAn(vault, liste) {
  if (!liste.length) return;
  mkdirSync(TL_DIR(vault), { recursive: true });
  const fd = openSync(datei(vault, "aktionen.jsonl"), "a");
  try { writeSync(fd, liste.map((a) => JSON.stringify(a)).join("\n") + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
}
// Automatische Regel-Übernahmen mit Commit, die nicht zurückgenommen wurden (Basis für Stichprobe, „bewährt", W7).
export function autoUebernahmen(aktionen) {
  const zurueck = new Set(aktionen.filter((a) => a.stufe === "zurueck").map((a) => a.id));
  return aktionen.filter((a) => a.auto === true && a.commit && (a.stufe === "uebernehmen" || a.stufe === "stand") && !zurueck.has(a.id));
}

// Prüfungen (§6.3). „aufgehoben" mit ref nimmt eine frühere Prüfung mit derselben ref zurück (z. B. W7, Seite stimmt doch).
export function merkePruefung(ctx, p) {
  if (ctx.probe) return;
  mkdirSync(TL_DIR(ctx.vault), { recursive: true });
  appendFileSync(datei(ctx.vault, "pruefungen.jsonl"), JSON.stringify({ zeit: new Date(ctx.jetzt).toISOString(), ...p }) + "\n");
}
export function lesePruefungen(vault) {
  const alle = leseJsonl(datei(vault, "pruefungen.jsonl"));
  const weg = new Set(alle.filter((p) => p.art === "aufgehoben").map((p) => p.ref));
  return alle.filter((p) => p.art !== "aufgehoben" && !(p.ref && weg.has(p.ref)));
}

// Jeder Teil muss ein einfaches Objekt sein (eine kaputte cache.json mit Text, Zahl oder Liste darf den Lauf nicht zum Stolpern bringen).
const objekt = (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});
export function ladeCache(vault) {
  try { const c = JSON.parse(readFileSync(datei(vault, "cache.json"), "utf8")); return { belege: objekt(c.belege), abgleich: objekt(c.abgleich), wahl: objekt(c.wahl), richter: objekt(c.richter) }; }
  catch { return { belege: {}, abgleich: {}, wahl: {}, richter: {} }; }
}
export function speichereCache(ctx) {
  mkdirSync(TL_DIR(ctx.vault), { recursive: true });
  const tmp = datei(ctx.vault, `cache.json.${process.pid}.tmp`);
  writeFileSync(tmp, JSON.stringify(ctx.cache));
  renameSync(tmp, datei(ctx.vault, "cache.json"));
}
export function schreibeLetzter(vault, d) {
  mkdirSync(TL_DIR(vault), { recursive: true });
  const tmp = datei(vault, `letzter.json.${process.pid}.tmp`);
  writeFileSync(tmp, JSON.stringify(d, null, 2) + "\n");
  renameSync(tmp, datei(vault, "letzter.json"));
}
export function leseLetzter(vault) { try { return JSON.parse(readFileSync(datei(vault, "letzter.json"), "utf8")); } catch { return null; } }

// hint.log: wann wurde welche Seite als Brain-Hinweis gezeigt? → Map<seite (vault-relativ), [ms…]>
export function hinweisNutzung(vault, { seitMs = 0 } = {}) {
  const m = new Map();
  let inhalt = "";
  try { inhalt = readFileSync(join(vault, ".logs", "hint.log"), "utf8"); } catch { return m; }
  for (const z of inhalt.split(/\r?\n/)) {
    const t = Date.parse(`${z.slice(0, 19)}Z`);
    if (!(t >= seitMs)) continue;
    const h = z.match(/(?:^| )hits=(\S*)/);
    for (const s of hitsSeiten(h ? h[1] : "")) { if (!m.has(s)) m.set(s, []); m.get(s).push(t); }
  }
  return m;
}
