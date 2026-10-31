// aktivitaet.mjs — das Aktivitätsprotokoll (Paket P8a), die SCHREIBENDE Hälfte im Kern (Hooks, Tageslauf/Pflege, Online-Sicherung).
// Ein Protokoll je Vault im Support-Ordner der App: <support>/aktivitaet/<Kennung>.jsonl (Format, Rotation, Grenzen: gemeinsam/aktivitaet.mjs, die Werkstatt
// und MCP-Server benutzen). Der Kern ist in sich geschlossen und importiert nichts aus gemeinsam/: der Abschnitt zwischen den beiden LOG-Marken (Anfang und Ende)
// ist darum wortgleich in beiden Dateien (Tests/Node/aktivitaet-paritaet.test.mjs vergleicht beide). Geändert wird er immer an beiden Stellen.
// Nie im Protokoll: Inhalt von Notizen, Titel, Zugangsdaten (Pfade sind Dateinamen und können den Titel als Kurzform enthalten). Das Protokoll ist ein Hinweis, nie eine Berechtigung. Schreiben wirft nie — ein Hook darf wegen des Protokolls nie ausfallen.
import { appendFileSync, readFileSync, mkdirSync, statSync, renameSync, openSync, readSync, closeSync, realpathSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";

// LOG-BEGINN
export const AKTIVITAET_ORDNER = "aktivitaet";
// Ereignisarten. „abweisung“ hat einen Grund (grund): gesperrt (Konto im Vault gesperrt) · stufe (Stufe zu niedrig für das Werkzeug) · leseverbot (Leseverbot/Strenger Schutz).
export const ARTEN = ["ablage-aufgabe", "ablage-notiz", "aenderung", "abweisung", "pflege", "pflege-fehler", "sicherung-konflikt", "sicherung-fehler", "anmeldung-abgelaufen", "rueckgaengig"];
export const MAX_BYTES = 256 * 1024;      // je Datei; mit der Vorfassung höchstens etwa das Doppelte
export const MAX_TEXT = 240;
const MAX_PFADE = 10;
const MAX_PFAD = 300;
const STUFEN_NAMEN = ["gesperrt", "lesen", "posteingang", "erweitert"];

// Kennung eines Vaults: SHA-256 des echten Pfads (realpath.native), 16 Hex — derselbe Weg wie backup/<Kennung>.json (gemeinsam/sicherungsmerker.mjs).
export function kennungVault(wurzel) {
  let p = String(wurzel);
  try { p = realpathSync.native(p); } catch { /* wie angegeben */ }
  return createHash("sha256").update(p).digest("hex").slice(0, 16);
}
export const KENNUNG = /^[0-9a-f]{16}$/;
export const aktivitaetOrdner = (support) => join(support, AKTIVITAET_ORDNER);
export const ereignisDatei = (support, kennung) => join(aktivitaetOrdner(support), `${kennung}.jsonl`);

const STEUER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const STEUER_EINZEL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
// Bekannte Schlüsselformen (GitHub, Slack, Anthropic/OpenAI, Bearer, AWS, JWT) — Vorsichtsnetz; es gehört ohnehin nie etwas Derartiges hinein.
const SCHLUESSEL = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,})\b|\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g;
const einzeilig = (s, max) => String(s ?? "").normalize("NFC").replace(STEUER, " ").replace(SCHLUESSEL, "[entfernt]").replace(/\s+/g, " ").trim().slice(0, max);
function relPfad(p) {
  if (typeof p !== "string" || !p || p.length > MAX_PFAD) return null;
  const s = p.normalize("NFC");
  if (STEUER_EINZEL.test(s)) return null;
  if (s.startsWith("/") || s.includes("\\") || s.split("/").some((t) => t === ".." || t === "." || t === "")) return null;
  return s;
}

// Ein Ereignis in die gespeicherte Form bringen (oder null, wenn die Art unbekannt ist). Nur bekannte Felder, alle begrenzt.
export function bereinige(e, { kennung = null } = {}) {
  if (!e || typeof e !== "object" || !ARTEN.includes(e.art)) return null;
  const r = { v: 1, id: typeof e.id === "string" && /^a_[0-9a-z]{6,12}_[0-9a-f]{6}$/.test(e.id) ? e.id : `a_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`,
    zeit: typeof e.zeit === "string" && Number.isFinite(Date.parse(e.zeit)) ? new Date(Math.min(Date.parse(e.zeit), Date.now() + 60_000)).toISOString() : new Date().toISOString(), art: e.art }; // höchstens 60 s in der Zukunft (eine falsche Uhr oder ein gefälschter Eintrag soll nichts verschieben)
  if (kennung && KENNUNG.test(kennung)) r.vault = kennung;
  const vn = einzeilig(e.vaultName, 60); if (vn) r.vaultName = vn;
  r.konto = typeof e.konto === "string" && /^k_[0-9a-f]{8}$/.test(e.konto) ? e.konto : null;
  const pg = typeof e.programm === "string" ? e.programm.toLowerCase() : "";
  r.programm = /^[a-z0-9][a-z0-9._-]{0,39}$/.test(pg) ? pg : null;
  if (typeof e.quelle === "string" && /^ki:[a-z0-9][a-z0-9._@-]{0,39}$/.test(e.quelle)) r.quelle = e.quelle;
  const wer = einzeilig(e.wer, 60); if (wer) r.wer = wer;
  if (typeof e.grund === "string" && /^[a-z0-9-]{1,30}$/.test(e.grund)) r.grund = e.grund;
  if (typeof e.werkzeug === "string" && /^[a-z0-9_]{1,60}$/.test(e.werkzeug)) r.werkzeug = e.werkzeug;
  if (STUFEN_NAMEN.includes(e.mindest)) r.mindest = e.mindest;
  if (Number.isInteger(e.anzahl) && e.anzahl >= 1 && e.anzahl <= 9999) r.anzahl = e.anzahl;
  r.text = einzeilig(e.text, MAX_TEXT);
  const pfade = (Array.isArray(e.pfade) ? e.pfade : []).map(relPfad).filter(Boolean).slice(0, MAX_PFADE);
  if (pfade.length) r.pfade = pfade;
  const rg = e.rueckgaengig;
  // Rückgängig nur für genau die Datei, die der Eintrag als ersten Pfad nennt (die Oberfläche zeigt sie an): so weiß der Nutzer, was entfernt würde
  if (rg && typeof rg === "object" && rg.art === "ablage-entfernen" && relPfad(rg.pfad) && pfade[0] === relPfad(rg.pfad) && typeof rg.hash === "string" && /^[0-9a-f]{64}$/.test(rg.hash)) r.rueckgaengig = { art: "ablage-entfernen", pfad: relPfad(rg.pfad), hash: rg.hash };
  if (typeof e.dk === "string" && e.dk) r.dk = einzeilig(e.dk, 120);
  return r;
}

// Letzte Bytes einer Datei (für die Drossel: nur der Schwanz wird gelesen). Nie ein Fehler.
function schwanz(datei, bytes = 16384) {
  let fd;
  try {
    fd = openSync(datei, "r");
    const st = statSync(datei);
    const n = Math.min(bytes, st.size), b = Buffer.alloc(n);
    readSync(fd, b, 0, n, st.size - n);
    return b.toString("utf8");
  } catch { return ""; } finally { if (fd !== undefined) try { closeSync(fd); } catch { /* egal */ } }
}

function rotiere(datei, max) {
  const sperre = `${datei}.lock`;
  try { closeSync(openSync(sperre, "wx", 0o600)); }
  catch { try { if (Date.now() - statSync(sperre).mtimeMs > 10_000) unlinkSync(sperre); } catch { /* weg */ } return; } // ein anderer Prozess rotiert gerade
  try { if (statSync(datei).size > max) renameSync(datei, `${datei}.alt`); } catch { /* schon rotiert */ }
  finally { try { unlinkSync(sperre); } catch { /* weg */ } }
}

// Hängt ein Ereignis an das Protokoll des Vaults an. → das gespeicherte Ereignis | null (ungültig, gedrosselt, nicht schreibbar).
//   opt.drossel = { schluessel, sekunden }: dieselbe Meldung (gleicher Schlüssel) wird innerhalb dieser Zeit nicht noch einmal geschrieben (Abweisungen von Hooks und MCP).
//   opt.maxBytes: Rotationsgrenze (Standard MAX_BYTES; Tests).
export function schreibeEreignis(support, wurzel, e, opt = {}) {
  try {
    if (typeof support !== "string" || !support) return null;
    const kennung = kennungVault(wurzel);
    const datei = ereignisDatei(support, kennung);
    const dk = opt.drossel && typeof opt.drossel.schluessel === "string" ? opt.drossel.schluessel : null;
    const r = bereinige({ ...e, ...(dk ? { dk } : {}) }, { kennung });
    if (!r) return null;
    if (dk) {
      const grenze = Date.now() - Math.max(0, Number(opt.drossel.sekunden) || 0) * 1000;
      for (const z of schwanz(datei).split("\n").reverse()) {
        if (!z) continue;
        try { const o = JSON.parse(z); if (o && o.dk === r.dk && Date.parse(o.zeit) >= grenze) return null; } catch { /* halbe Zeile am Anfang des Schwanzes */ }
      }
    }
    mkdirSync(aktivitaetOrdner(support), { recursive: true, mode: 0o700 });
    appendFileSync(datei, JSON.stringify(r) + "\n", { mode: 0o600 });
    // Rotieren: zu groß → die Datei wird zur Vorfassung (rename ist atomar; wer gleichzeitig noch anhängt, landet in der Vorfassung, die weiter gelesen wird).
    // Nur ein Prozess rotiert (Sperrdatei „wx“, nach 10 s gilt sie als verwaist) und prüft die Größe unter der Sperre noch einmal: zwei Prozesse überschreiben so nie die Vorfassung
    // mit einer fast leeren Datei.
    const max = Number.isFinite(opt.maxBytes) && opt.maxBytes > 0 ? opt.maxBytes : MAX_BYTES;
    try { if (statSync(datei).size > max) rotiere(datei, max); } catch { /* schon rotiert */ }
    return r;
  } catch { return null; }
}

const lies = (datei) => { try { return readFileSync(datei, "utf8"); } catch { return ""; } };
// Alle Ereignisse eines Vaults, älteste zuerst (Vorfassung + aktuelle Datei). Zeilen, die nicht passen, werden übersprungen.
//   opt.seit (ISO, ausschließlich) · opt.arten (Liste) · opt.limit (die letzten N)
export function leseEreignisse(support, kennung, opt = {}) {
  if (typeof support !== "string" || !KENNUNG.test(String(kennung))) return [];
  const datei = ereignisDatei(support, kennung);
  const seit = opt.seit ? Date.parse(opt.seit) : NaN;
  const arten = Array.isArray(opt.arten) && opt.arten.length ? new Set(opt.arten) : null;
  const aus = [];
  for (const t of [lies(`${datei}.alt`), lies(datei)]) {
    for (const z of t.split("\n")) {
      if (!z) continue;
      let o; try { o = JSON.parse(z); } catch { continue; }
      if (!o || typeof o !== "object" || o.v !== 1 || typeof o.id !== "string" || !ARTEN.includes(o.art) || !Number.isFinite(Date.parse(o.zeit))) continue;
      if (Number.isFinite(seit) && !(Date.parse(o.zeit) > seit)) continue;
      if (arten && !arten.has(o.art)) continue;
      aus.push(o);
    }
  }
  aus.sort((a, b) => (a.zeit < b.zeit ? -1 : a.zeit > b.zeit ? 1 : 0));
  return opt.limit > 0 ? aus.slice(-opt.limit) : aus;
}
// LOG-ENDE
